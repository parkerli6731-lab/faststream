/**
 * 确定性下载任务有限状态机 (Download Task Finite State Machine)
 * 物理隔离架构核心：纯函数无副作用、确定性步进。
 */

import {
  DownloadStatus,
  DownloadSegment,
  TaskSnapshot,
  FSMAction,
} from '../contracts/downloader.contract';
import { sliceSegments } from './segment_slicer';
import { guessCategory } from './sniffer_protocol';

export interface FSMInitParams {
  id: number;
  url: string;
  dir: string;
  filename: string;
  category?: string;
}

export class DownloadFSM {
  private readonly id: number;
  private readonly url: string;
  private readonly dir: string;
  private readonly filename: string;
  private readonly category: string;
  private readonly status: DownloadStatus;
  private readonly size: number | null;
  private readonly downloaded: number;
  private readonly speed: number;
  private readonly eta: number | null;
  private readonly resumable: boolean;
  private readonly segments: readonly DownloadSegment[];
  private readonly error: string | null;

  constructor(params: FSMInitParams, internalState?: Partial<TaskSnapshot>) {
    this.id = params.id;
    this.url = params.url;
    this.dir = params.dir;
    this.filename = params.filename;
    this.category = params.category || guessCategory(params.filename);

    this.status = internalState?.status ?? 'queued';
    this.size = internalState?.size ?? null;
    this.downloaded = internalState?.downloaded ?? 0;
    this.speed = internalState?.speed ?? 0;
    this.eta = internalState?.eta ?? null;
    this.resumable = internalState?.resumable ?? true;
    this.segments = internalState?.segments ?? [];
    this.error = internalState?.error ?? null;
  }

  /**
   * 纯函数步进：接收动作，返回全新的状态机实例 (不可变状态流)
   */
  public dispatch(action: FSMAction): DownloadFSM {
    const p: FSMInitParams = {
      id: this.id,
      url: this.url,
      dir: this.dir,
      filename: this.filename,
      category: this.category,
    };

    switch (action.type) {
      case 'START': {
        if (this.status === 'queued' || this.status === 'paused' || this.status === 'error') {
          return new DownloadFSM(p, {
            ...this.getSnapshot(),
            status: 'connecting',
            error: null,
          });
        }
        return this;
      }

      case 'PROBE_SUCCESS': {
        const segs = sliceSegments(action.totalSize, action.connections);
        return new DownloadFSM(p, {
          ...this.getSnapshot(),
          status: 'downloading',
          size: action.totalSize,
          resumable: action.resumable,
          segments: segs,
          error: null,
        });
      }

      case 'SEGMENT_CHUNK': {
        if (this.status !== 'downloading') return this;
        const newSegs = this.segments.map((s) => {
          if (s.index === action.segmentIndex) {
            const newCur = s.cur + action.bytes;
            return {
              ...s,
              cur: newCur,
              done: s.end != null ? newCur >= (s.end + 1) : false,
            };
          }
          return s;
        });
        const totalDl = this.downloaded + action.bytes;
        return new DownloadFSM(p, {
          ...this.getSnapshot(),
          downloaded: totalDl,
          segments: newSegs,
        });
      }

      case 'SEGMENT_COMPLETE': {
        const newSegs = this.segments.map((s) =>
          s.index === action.segmentIndex ? { ...s, done: true } : s
        );
        const allDone = newSegs.length > 0 && newSegs.every((s) => s.done);
        return new DownloadFSM(p, {
          ...this.getSnapshot(),
          status: allDone ? 'merging' : this.status,
          segments: newSegs,
        });
      }

      case 'SPEED_TICK': {
        return new DownloadFSM(p, {
          ...this.getSnapshot(),
          speed: action.speed,
          eta: action.eta,
        });
      }

      case 'PAUSE': {
        if (['downloading', 'connecting', 'queued'].includes(this.status)) {
          return new DownloadFSM(p, {
            ...this.getSnapshot(),
            status: 'paused',
            speed: 0,
            eta: null,
          });
        }
        return this;
      }

      case 'RESUME': {
        if (this.status === 'paused' || this.status === 'error') {
          return new DownloadFSM(p, {
            ...this.getSnapshot(),
            status: this.segments.length > 0 ? 'downloading' : 'connecting',
            error: null,
          });
        }
        return this;
      }

      case 'MERGE_PROGRESS': {
        return new DownloadFSM(p, {
          ...this.getSnapshot(),
          status: 'merging',
        });
      }

      case 'MERGE_COMPLETE': {
        return new DownloadFSM(p, {
          ...this.getSnapshot(),
          status: 'done',
          downloaded: action.finalSize,
          speed: 0,
          eta: 0,
        });
      }

      case 'FAIL': {
        return new DownloadFSM(p, {
          ...this.getSnapshot(),
          status: 'error',
          error: action.error,
          speed: 0,
          eta: null,
        });
      }

      default:
        return this;
    }
  }

  public getSnapshot(): TaskSnapshot {
    return {
      id: this.id,
      url: this.url,
      dir: this.dir,
      filename: this.filename,
      status: this.status,
      size: this.size,
      downloaded: this.downloaded,
      speed: this.speed,
      eta: this.eta,
      resumable: this.resumable,
      segments: this.segments,
      error: this.error,
      category: this.category,
    };
  }
}
