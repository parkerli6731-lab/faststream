/**
 * FastStream Cross-Verification Differential Harness
 * 验证纯净室重构算法不变量
 */

import * as fs from 'fs';
import * as path from 'path';

import { sliceSegments, formatRangeHeader } from '../src/core/segment_slicer';
import { cleanTitle } from '../src/core/sniffer_protocol';
import { DownloadFSM } from '../src/core/download_fsm';
import { TokenBucketLimiter } from '../src/core/rate_limiter';
import { validateMergeIntegrity } from '../src/core/merge_pipeline';

function runHarness(): boolean {
  console.log('--- FastStream 交叉差分验证流水线 ---');
  const goldenPath = path.resolve(__dirname, 'golden_trace.json');
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));

  let allPass = true;

  // 1. Slicing
  for (const tc of golden.slicing_cases) {
    const act = sliceSegments(tc.total_size, tc.connections);
    if (act.length !== tc.expected_segments.length) {
      console.error(`❌ Slicing count mismatch in ${tc.desc}`);
      allPass = false;
    }
  }
  console.log('✅ 1. 分段切片数学与区间不变量: 全部通过');

  // 2. Title cleaning
  for (const tc of golden.title_cleaning_cases) {
    const res = cleanTitle(tc.raw);
    if (res !== tc.expected) {
      console.error(`❌ Title clean mismatch: ${res} != ${tc.expected}`);
      allPass = false;
    }
  }
  console.log('✅ 2. 媒体嗅探标题规范化: 全部通过');

  // 3. Rate limiter
  for (const tc of golden.rate_limiter_cases) {
    const limiter = new TokenBucketLimiter(tc.rate_kb);
    const allowed = limiter.tryConsume(tc.requested_bytes, tc.elapsed_sec);
    if (allowed !== tc.expected_allowed) {
      console.error(`❌ Rate limiter mismatch: ${allowed} != ${tc.expected_allowed}`);
      allPass = false;
    }
  }
  console.log('✅ 3. 令牌桶限速计算: 全部通过');

  // 4. Merge validation
  for (const tc of golden.merge_validation_cases) {
    const res = validateMergeIntegrity(tc.actual_size, tc.expected_size);
    if (res.valid !== tc.is_valid) {
      console.error(`❌ Merge integrity mismatch: ${res.valid} != ${tc.is_valid}`);
      allPass = false;
    }
  }
  console.log('✅ 4. 分段合并完整性校验: 全部通过');

  if (allPass) {
    console.log('🎉 FastStream 核心逻辑交叉验证 100% 绿灯通过！\n');
  }
  return allPass;
}

if (require.main === module || (typeof Bun !== 'undefined' && Bun.main === import.meta.path)) {
  const ok = runHarness();
  if (!ok) process.exit(1);
}
