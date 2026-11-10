/**
 * 分段合并与完整性判定逻辑 (Merge Pipeline & Integrity Verification)
 * 严格遵照原生二进制中的不变量提示：
 * "文件大小不符：实际 X / 期望 Y"
 */

export interface MergeValidationResult {
  readonly valid: boolean;
  readonly actualSize: number;
  readonly expectedSize: number | null;
  readonly error: string | null;
}

/**
 * 校验合并后的文件完整性与字节数一致性
 */
export function validateMergeIntegrity(
  actualSize: number,
  expectedSize: number | null
): MergeValidationResult {
  if (expectedSize == null || expectedSize <= 0) {
    // 流式未知大小，只要实际大小大于 0 即可认为有效
    return {
      valid: actualSize > 0,
      actualSize,
      expectedSize,
      error: actualSize > 0 ? null : '文件内容为空 (0 字节)',
    };
  }

  if (actualSize === expectedSize) {
    return {
      valid: true,
      actualSize,
      expectedSize,
      error: null,
    };
  }

  return {
    valid: false,
    actualSize,
    expectedSize,
    error: `文件大小不符：实际 ${actualSize} / 期望 ${expectedSize}`,
  };
}
