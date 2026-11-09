/**
 * 多线程分段切片与区间不变量引擎 (Segment Slicer Core)
 * 纯数学纯函数计算，零外部副作用。
 */

import { DownloadSegment } from '../contracts/downloader.contract';

/**
 * 依据文件总大小与请求连接数切分区间
 * @param totalSize 文件字节数（若为未知大小或流式则为 null）
 * @param connections 请求并发连接数 (通常为 8)
 */
export function sliceSegments(totalSize: number | null, connections: number): DownloadSegment[] {
  // 未知大小或流式响应：退化为单段流式下载
  if (totalSize == null || totalSize <= 0) {
    return [
      {
        index: 0,
        start: 0,
        end: null,
        cur: 0,
        done: false,
        partFile: '.fspart.0',
      },
    ];
  }

  // 小文件防御：若文件总字节数小于连接数，夹持连接数，防止空段
  const effectiveConns = Math.max(1, Math.min(connections, totalSize));
  const chunkSize = Math.floor(totalSize / effectiveConns);
  const segments: DownloadSegment[] = [];

  for (let i = 0; i < effectiveConns; i++) {
    const start = i * chunkSize;
    // 最后一包覆盖全部剩余字节，确保字节总数无缝吻合
    const end = (i === effectiveConns - 1) ? totalSize - 1 : (i + 1) * chunkSize - 1;

    segments.push({
      index: i,
      start,
      end,
      cur: start,
      done: false,
      partFile: `.fspart.${i}`,
    });
  }

  return segments;
}

/**
 * 格式化 HTTP Range 请求头字符串
 * @param seg 当前分段
 */
export function formatRangeHeader(seg: DownloadSegment): string {
  if (seg.end == null) {
    return `bytes=${seg.cur}-`;
  }
  return `bytes=${seg.cur}-${seg.end}`;
}
