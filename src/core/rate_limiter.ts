/**
 * 确定性令牌桶限速器与速率平滑估算器 (Deterministic Token Bucket Limiter)
 */

import { IRateLimiter } from '../contracts/downloader.contract';

export class TokenBucketLimiter implements IRateLimiter {
  public readonly rateKB: number;
  private tokens: number;

  constructor(rateKB: number, initialTokens = 0) {
    this.rateKB = rateKB;
    // 初始令牌数：默认为 0，依时间增量积累生成
    this.tokens = rateKB > 0 ? initialTokens : Infinity;
  }

  /**
   * 依据时间增量与请求量消耗令牌
   * @param requestedBytes 请求获取的字节数
   * @param elapsedSec 距上次请求消耗的时间增量 (秒)
   * @returns 允许放行的字节数
   */
  public tryConsume(requestedBytes: number, elapsedSec: number): number {
    if (this.rateKB <= 0) {
      return requestedBytes; // 0 表示不限速
    }

    const maxCapacity = this.rateKB * 1024;
    // 令牌生成：时间 * 速率
    this.tokens = Math.min(maxCapacity, this.tokens + elapsedSec * maxCapacity);

    if (this.tokens <= 0) {
      return 0;
    }

    const allowed = Math.min(requestedBytes, Math.floor(this.tokens));
    this.tokens -= allowed;
    return allowed;
  }

  public reset(): void {
    this.tokens = this.rateKB > 0 ? this.rateKB * 1024 : Infinity;
  }
}

/**
 * 平滑速率估算（基于滑动窗口加权平均）
 */
export function calculateSmoothSpeed(
  previousSpeed: number,
  instantSpeed: number,
  alpha = 0.3
): number {
  if (previousSpeed <= 0) return instantSpeed;
  return Math.round(previousSpeed * (1 - alpha) + instantSpeed * alpha);
}

/**
 * 剩余时间估算 (ETA in seconds)
 */
export function estimateEta(remainingBytes: number, speedBytesPerSec: number): number | null {
  if (remainingBytes <= 0) return 0;
  if (!speedBytesPerSec || speedBytesPerSec <= 0) return null;
  const sec = remainingBytes / speedBytesPerSec;
  return isFinite(sec) ? Math.ceil(sec) : null;
}
