/**
 * FastStream 真实网络下载交叉验证套件 (Live Network Cross-Validation)
 */

import { DownloadEngine } from '../src/core/download_engine';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.join('/tmp', 'faststream_cross_val_' + Date.now());
fs.mkdirSync(TEST_DIR, { recursive: true });

async function runCrossValidation() {
  console.log('====================================================');
  console.log('   FastStream 真实网络多线程下载交叉验证测试套件   ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 3;

  // 测试 1: 真实高清 MP4 视频 8 线程并发下载与原子分段合并
  console.log('▶ [测试 1/3] 真实高清 MP4 视频 (5MB, 8 并发连接)...');
  const mp4Url = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4';
  const mp4Engine = new DownloadEngine({
    url: mp4Url,
    dir: TEST_DIR,
    filename: 'sample_video.mp4',
    connections: 8,
  });

  await mp4Engine.start();
  const mp4Snap = mp4Engine.getSnapshot();
  const mp4File = path.join(TEST_DIR, 'sample_video.mp4');
  const mp4Stat = fs.existsSync(mp4File) ? fs.statSync(mp4File) : null;

  if (mp4Snap.status === 'done' && mp4Stat && mp4Stat.size === 4999379 && mp4Stat.size === mp4Snap.downloaded) {
    console.log(`   ✅ 通过: 8 线程下载成功并合并! 大小: ${mp4Stat.size} 字节 (100% 吻合)\n`);
    passed++;
  } else {
    throw new Error(`测试 1 失败: 状态=${mp4Snap.status}, 实际大小=${mp4Stat?.size}`);
  }

  // 测试 2: 真实 Cloudflare CDN 10MB 极速测速包并发下载
  console.log('▶ [测试 2/3] 真实 Cloudflare CDN 10MB 测速包 (4 并发连接)...');
  const cfUrl = 'https://speed.cloudflare.com/__down?bytes=10485760';
  const cfEngine = new DownloadEngine({
    url: cfUrl,
    dir: TEST_DIR,
    filename: 'cloudflare_10mb.bin',
    connections: 4,
  });

  await cfEngine.start();
  const cfSnap = cfEngine.getSnapshot();
  const cfFile = path.join(TEST_DIR, 'cloudflare_10mb.bin');
  const cfStat = fs.existsSync(cfFile) ? fs.statSync(cfFile) : null;

  if (cfSnap.status === 'done' && cfStat && cfStat.size === 10485760 && cfStat.size === cfSnap.downloaded) {
    console.log(`   ✅ 通过: 10MB 分段下载成功并合并! 大小: ${cfStat.size} 字节 (100% 吻合)\n`);
    passed++;
  } else {
    throw new Error(`测试 2 失败: 状态=${cfSnap.status}, 实际大小=${cfStat?.size}`);
  }

  // 测试 3: 无效/404 链接智能错误捕获与提示
  console.log('▶ [测试 3/3] 无效/404 链接 (example.com/testfile.zip) 异常诊断捕获...');
  const deadUrl = 'https://example.com/testfile.zip';
  const deadEngine = new DownloadEngine({
    url: deadUrl,
    dir: TEST_DIR,
    filename: 'testfile.zip',
  });

  let threw = false;
  try {
    await deadEngine.start();
  } catch (err: any) {
    threw = true;
  }
  const deadSnap = deadEngine.getSnapshot();
  if (threw && deadSnap.status === 'error' && deadSnap.error?.includes('404')) {
    console.log(`   ✅ 通过: 准确捕获 404 错误并提供明确定位信息: "${deadSnap.error}"\n`);
    passed++;
  } else {
    throw new Error(`测试 3 失败: 未能正确上报 404: ${deadSnap.error}`);
  }

  console.log('====================================================');
  console.log(`   🎉 全部通过! 交叉验证成功率: ${passed}/${total} (100%) `);
  console.log('====================================================');

  // 清理临时文件
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

runCrossValidation().catch((err) => {
  console.error('❌ 交叉验证未通过:', err);
  process.exit(1);
});
