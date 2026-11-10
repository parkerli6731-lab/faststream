/**
 * 不变量盒子契约定义 (Downloader Invariant Box Contracts)
 * 严格遵循 ai-reverse-rebuild SOP 3 规范：
 * 强制解耦 Core Logic (计算/调度/状态机) 与 Product UI (表现层/窗口/平台 API)。
 * 核心逻辑保持纯函数与无副作用状态机。
 */

export type DownloadStatus =
  | 'queued'        // 排队中
  | 'connecting'    // 正在连接/探测
  | 'downloading'   // 正在多线程接收数据
  | 'merging'       // 正在合并分段
  | 'paused'        // 已暂停
  | 'done'          // 下载完成
  | 'error';        // 发生错误

export interface DownloadSegment {
  readonly index: number;        // 分段序号 (0-based)
  readonly start: number;        // 分段起始字节偏移 (inclusive)
  readonly end: number | null;   // 分段结束字节偏移 (inclusive，流媒体未知大小时为 null)
  readonly cur: number;          // 当前下载进度游标 (inclusive)
  readonly done: boolean;        // 是否已完成该分段下载
  readonly partFile?: string;    // 临时分段文件后缀或路径 (e.g. .tdmpart.0)
}

export interface TaskSnapshot {
  readonly id: number;
  readonly url: string;
  readonly dir: string;
  readonly filename: string;
  readonly status: DownloadStatus;
  readonly size: number | null;          // 目标文件总字节数
  readonly downloaded: number;           // 已下载累计字节数
  readonly speed: number;                // 瞬时/平滑速率 (bytes/sec)
  readonly eta: number | null;           // 预估剩余时间 (seconds)
  readonly resumable: boolean;           // 服务端是否支持 Range 断点续传
  readonly segments: readonly DownloadSegment[];
  readonly error: string | null;
  readonly category: string;
}

export type FSMAction =
  | { type: 'START' }
  | { type: 'PROBE_SUCCESS'; totalSize: number | null; resumable: boolean; connections: number }
  | { type: 'SEGMENT_CHUNK'; segmentIndex: number; bytes: number }
  | { type: 'SEGMENT_COMPLETE'; segmentIndex: number }
  | { type: 'SPEED_TICK'; speed: number; eta: number | null }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'MERGE_PROGRESS'; mergedBytes: number }
  | { type: 'MERGE_COMPLETE'; finalSize: number }
  | { type: 'FAIL'; error: string };

export interface ISegmentSlicer {
  slice(totalSize: number | null, connections: number): DownloadSegment[];
  formatRangeHeader(segment: DownloadSegment): string;
}

export interface IRateLimiter {
  readonly rateKB: number;
  tryConsume(requestedBytes: number, elapsedSec: number): number;
  reset(): void;
}

export interface ISniffServerProtocol {
  cleanTitle(rawTitle: string): string;
  guessCategory(filename: string): string;
  nameFromUrl(url: string): string;
}
