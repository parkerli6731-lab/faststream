/**
 * 现代下载执行器 (Modern Download Engine)
 * 物理隔离：只依赖通用 Node/Bun 标准库与 DownloadFSM 状态机。
 * 零 UI 依赖，可直接作为 CLI、微服务或集成至现代桌面/Web端。
 */

import * as fs from 'fs';
import * as path from 'path';
import { DownloadFSM } from './download_fsm';
import { TaskSnapshot } from '../contracts/downloader.contract';
import { formatRangeHeader } from './segment_slicer';
import { validateMergeIntegrity } from './merge_pipeline';
import { TokenBucketLimiter } from './rate_limiter';

export interface DownloadOptions {
  id?: number;
  url: string;
  dir: string;
  filename: string;
  connections?: number;
  maxRateKB?: number;
  headers?: Record<string, string>;
  onSnapshot?: (snapshot: TaskSnapshot) => void;
}

export class DownloadEngine {
  private fsm: DownloadFSM;
  private readonly options: DownloadOptions;
  private readonly limiter: TokenBucketLimiter;
  private abortControllers: AbortController[] = [];
  private speedTimer: any = null;
  private defaultUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  constructor(options: DownloadOptions) {
    this.options = {
      connections: 8,
      maxRateKB: 0,
      ...options,
      id: options.id || Date.now(),
    };
    this.fsm = new DownloadFSM({
      id: this.options.id!,
      url: this.options.url,
      dir: this.options.dir,
      filename: this.options.filename,
    });
    this.limiter = new TokenBucketLimiter(this.options.maxRateKB || 0);
  }

  public getSnapshot(): TaskSnapshot {
    return this.fsm.getSnapshot();
  }

  private emitUpdate(): void {
    if (this.options.onSnapshot) {
      this.options.onSnapshot(this.fsm.getSnapshot());
    }
  }

  private startSpeedTicker(): void {
    this.stopSpeedTicker();
    let lastBytes = this.fsm.getSnapshot().downloaded;
    this.speedTimer = setInterval(() => {
      const snap = this.fsm.getSnapshot();
      if (snap.status !== 'downloading') return;
      const currentBytes = snap.downloaded;
      const delta = Math.max(0, currentBytes - lastBytes);
      lastBytes = currentBytes;
      const speed = delta * 2; // sampled every 500ms
      let eta: number | null = null;
      if (snap.size && snap.size > currentBytes && speed > 0) {
        eta = Math.ceil((snap.size - currentBytes) / speed);
      }
      this.fsm = this.fsm.dispatch({ type: 'SPEED_TICK', speed, eta });
      this.emitUpdate();
    }, 500);
  }

  private stopSpeedTicker(): void {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
  }

  /**
   * 启动探测与分段下载流水线
   */
  public async start(): Promise<void> {
    this.fsm = this.fsm.dispatch({ type: 'START' });
    this.emitUpdate();

    try {
      fs.mkdirSync(this.options.dir, { recursive: true });

      const reqHeaders: Record<string, string> = {
        'User-Agent': this.defaultUA,
        ...this.options.headers,
      };

      // 阶段 1: 弹性探测请求 (优先 HEAD，若遇 403/405/501 则降级为 GET Range 探测)
      let probeRes: Response | null = null;
      let probeMethod = 'HEAD';
      try {
        probeRes = await fetch(this.options.url, {
          method: 'HEAD',
          headers: reqHeaders,
        });
        if (!probeRes.ok && [403, 405, 501].includes(probeRes.status)) {
          probeRes = null;
        }
      } catch (e) {
        probeRes = null;
      }

      if (!probeRes) {
        probeMethod = 'GET';
        probeRes = await fetch(this.options.url, {
          method: 'GET',
          headers: {
            ...reqHeaders,
            Range: 'bytes=0-0',
          },
        });
      }

      if (!probeRes.ok && probeRes.status !== 206) {
        throw new Error(`HTTP 探测失败: ${probeRes.status} ${probeRes.statusText || ''}`.trim());
      }

      let totalSize: number | null = null;
      let resumable = false;

      // 优先从 Content-Range 获取总长度 (如 bytes 0-0/1048576)
      const contentRange = probeRes.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)/);
        if (match) {
          totalSize = parseInt(match[1], 10);
          resumable = true;
        }
      }

      // 其次从 Content-Length 获取
      if (totalSize == null) {
        const contentLength = probeRes.headers.get('content-length');
        if (contentLength) {
          const parsed = parseInt(contentLength, 10);
          if (!isNaN(parsed) && parsed > 0) {
            totalSize = parsed;
          }
        }
      }

      const acceptRanges = probeRes.headers.get('accept-ranges');
      if (acceptRanges === 'bytes' || probeRes.status === 206) {
        resumable = true;
      }

      if (probeMethod === 'GET' && probeRes.body) {
        try { await probeRes.body.cancel(); } catch (e) {}
      }

      // 阶段 2: 状态机进入 downloading 并完成切片
      const conns = resumable && totalSize && totalSize > 1024 ? (this.options.connections || 8) : 1;
      this.fsm = this.fsm.dispatch({
        type: 'PROBE_SUCCESS',
        totalSize,
        resumable,
        connections: conns,
      });
      this.emitUpdate();

      // 启动实时速率计算器
      this.startSpeedTicker();

      // 阶段 3: 并发拉取各分段
      const currentSnap = this.fsm.getSnapshot();
      const segPromises = currentSnap.segments.map((seg) => this.downloadSegment(seg));
      await Promise.all(segPromises);

      // 阶段 4: 所有分段完成，执行无损原子合并
      await this.mergeSegments();
      this.stopSpeedTicker();
    } catch (err: any) {
      this.stopSpeedTicker();
      this.fsm = this.fsm.dispatch({ type: 'FAIL', error: err.message || String(err) });
      this.emitUpdate();
      throw err;
    }
  }

  private async downloadSegment(segment: any): Promise<void> {
    const partPath = path.join(this.options.dir, `${this.options.filename}.fspart.${segment.index}`);
    const controller = new AbortController();
    this.abortControllers.push(controller);

    const headers: Record<string, string> = {
      'User-Agent': this.defaultUA,
      ...this.options.headers,
    };
    if (segment.end != null) {
      headers.Range = formatRangeHeader(segment);
    }

    const res = await fetch(this.options.url, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok && res.status !== 206 && res.status !== 200) {
      throw new Error(`分段 ${segment.index} 请求失败: HTTP ${res.status}`);
    }

    const fileStream = fs.createWriteStream(partPath, { flags: 'w' });
    const reader = res.body?.getReader();
    if (!reader) throw new Error(`分段 ${segment.index} 无可读数据流`);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          fileStream.write(Buffer.from(value));
          this.fsm = this.fsm.dispatch({
            type: 'SEGMENT_CHUNK',
            segmentIndex: segment.index,
            bytes: value.length,
          });
          this.emitUpdate();
        }
      }
    } finally {
      await new Promise<void>((resolve) => fileStream.end(() => resolve()));
    }

    this.fsm = this.fsm.dispatch({
      type: 'SEGMENT_COMPLETE',
      segmentIndex: segment.index,
    });
    this.emitUpdate();
  }

  private async mergeSegments(): Promise<void> {
    this.fsm = this.fsm.dispatch({ type: 'MERGE_PROGRESS', mergedBytes: 0 });
    this.emitUpdate();

    const targetPath = path.join(this.options.dir, this.options.filename);
    const targetStream = fs.createWriteStream(targetPath, { flags: 'w' });
    const snap = this.fsm.getSnapshot();

    let totalWritten = 0;
    for (const seg of snap.segments) {
      const partPath = path.join(this.options.dir, `${this.options.filename}.fspart.${seg.index}`);
      if (fs.existsSync(partPath)) {
        const data = fs.readFileSync(partPath);
        targetStream.write(data);
        totalWritten += data.length;
        fs.unlinkSync(partPath); // 清理临时分段
      }
    }
    await new Promise<void>((resolve) => targetStream.end(() => resolve()));

    // 完整性判定
    const validation = validateMergeIntegrity(totalWritten, snap.size);
    if (!validation.valid) {
      throw new Error(validation.error!);
    }

    this.fsm = this.fsm.dispatch({ type: 'MERGE_COMPLETE', finalSize: totalWritten });
    this.emitUpdate();
  }

  public pause(): void {
    this.stopSpeedTicker();
    this.abortControllers.forEach((c) => c.abort());
    this.abortControllers = [];
    this.fsm = this.fsm.dispatch({ type: 'PAUSE' });
    this.emitUpdate();
  }
}
