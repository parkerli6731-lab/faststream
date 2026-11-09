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

  /**
   * 启动探测与分段下载流水线
   */
  public async start(): Promise<void> {
    this.fsm = this.fsm.dispatch({ type: 'START' });
    this.emitUpdate();

    try {
      fs.mkdirSync(this.options.dir, { recursive: true });

      // 阶段 1: 探测请求 (Probe HTTP HEAD or Range bytes=0-0)
      const probeRes = await fetch(this.options.url, {
        method: 'HEAD',
        headers: {
          ...this.options.headers,
          'User-Agent': 'FastStream/1.0.0 (Macintosh; Apple Silicon)',
        },
      });

      if (!probeRes.ok) {
        throw new Error(`HTTP 探测失败: ${probeRes.status} ${probeRes.statusText}`);
      }

      const contentLength = probeRes.headers.get('content-length');
      const acceptRanges = probeRes.headers.get('accept-ranges');
      const totalSize = contentLength ? parseInt(contentLength, 10) : null;
      const resumable = acceptRanges === 'bytes' || probeRes.status === 206;

      // 阶段 2: 状态机进入 downloading 并完成切片
      const conns = resumable && totalSize ? (this.options.connections || 8) : 1;
      this.fsm = this.fsm.dispatch({
        type: 'PROBE_SUCCESS',
        totalSize,
        resumable,
        connections: conns,
      });
      this.emitUpdate();

      // 阶段 3: 并发拉取各分段
      const currentSnap = this.fsm.getSnapshot();
      const segPromises = currentSnap.segments.map((seg) => this.downloadSegment(seg));
      await Promise.all(segPromises);

      // 阶段 4: 所有分段完成，执行无损原子合并
      await this.mergeSegments();
    } catch (err: any) {
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
      ...this.options.headers,
      Range: formatRangeHeader(segment),
    };

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
    this.abortControllers.forEach((c) => c.abort());
    this.abortControllers = [];
    this.fsm = this.fsm.dispatch({ type: 'PAUSE' });
    this.emitUpdate();
  }
}
