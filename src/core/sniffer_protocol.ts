/**
 * 媒体嗅探与标题清洗规范协议 (Sniffer Protocol & Title Normalizer)
 * 提取自原生嗅探模块与 newdownload.js 算法规范，纯函数无副作用。
 */

/**
 * 清理插件嗅探到的网页标题（去除平台后缀、通知数、非法文件名符号）
 * 例如："(153) 标题 - YouTube" -> "标题"
 */
export function cleanTitle(name: string): string {
  if (!name) return name;
  let n = String(name).trim();

  // 1. YouTube 未读通知数 "(153) "
  n = n.replace(/^\(\d+\+?\)\s*/, '');

  // 2. 主流视频平台后缀
  n = n.replace(/\s*[-–|]\s*(YouTube( Music)?|Bilibili|TikTok|Vimeo|Twitch|Instagram|Facebook|Dailymotion|Reddit|微博|小红书)\s*$/i, '');
  n = n.replace(/_哔哩哔哩_bilibili\s*$/i, '').replace(/[-_]\s*bilibili\s*$/i, '');
  n = n.replace(/\s*-\s*抖音\s*$/, '');
  n = n.replace(/\s+(on|\/)\s+X(:.*)?$/i, '').replace(/\s*\/\s*Twitter$/i, '');

  // 3. 文件系统非法路径字符转为空格，并合并连续空格
  n = n.replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // 4. 截断最大长度 150 字符
  return n.slice(0, 150) || String(name).trim();
}

/**
 * 依据文件扩展名推断所属分类
 */
export function guessCategory(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mkv', 'avi', 'mov', 'flv', 'webm', 'ts', 'm4v'].includes(ext)) return '视频';
  if (['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg'].includes(ext)) return '音乐';
  if (['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm'].includes(ext)) return '程序';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz'].includes(ext)) return '压缩包';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub', 'gguf'].includes(ext)) return '文档';
  return '常规';
}

/**
 * 从 URL 中提取合法默认文件名
 */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const n = decodeURIComponent(u.pathname.split('/').pop() || '');
    return n.split('?')[0] || 'download';
  } catch (e) {
    return 'download';
  }
}
