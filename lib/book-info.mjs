import { runCdp } from './atob-extract.mjs';
import { buildChapterUrl } from './wr-hash.mjs';

/**
 * 从当前页面提取书籍 ID
 *
 * 优先从 URL 中匹配 reader/bookDetail 路径提取，
 * 失败则从页面 HTML 的 __INITIAL_STATE__ 中提取。
 *
 * @param {string} target - CDP 标签页 ID
 * @returns {string} 书籍 ID
 * @throws {Error} 无法提取 bookId 时抛出
 */
export function extractBookId(target) {
  const urlResult = runCdp(['eval', target, 'location.href']);
  if (urlResult.success) {
    const url = urlResult.output;
    const m = url.match(/(?:reader|bookDetail)\/([a-zA-Z0-9]+?)(?:k[0-9a-f]{3}[34]2[0-9a-f]{2}|[?#]|$)/);
    if (m) return m[1];
  }

  let htmlError = null;
  const htmlResult = runCdp(['eval', target, 'document.documentElement.innerHTML']);
  if (htmlResult.success) {
    try {
      const data = extractInitialState(htmlResult.output);
      const bookId = data.reader?.bookInfo?.bookId || data.book?.bookId;
      if (bookId) return bookId;
    } catch (e) {
      htmlError = e.message;
    }
  } else {
    htmlError = htmlResult.error || 'CDP 通信失败';
  }

  const parts = ['无法从当前页面提取 book_id'];
  if (htmlError) parts.push(`  HTML 解析失败: ${htmlError}`);
  parts.push('  请确保已打开微信读书的某本书，或使用 --book-id 手动指定');
  throw new Error(parts.join('\n'));
}

/**
 * 从 HTML 中解析 __INITIAL_STATE__ JSON 数据
 *
 * 使用括号计数法定位 JSON 边界，不依赖正则或固定偏移。
 *
 * @param {string} html - 页面 HTML 源码
 * @returns {object} 解析后的 __INITIAL_STATE__ 对象
 * @throws {Error} 未找到或 JSON 格式异常时抛出
 */
export function extractInitialState(html) {
  const start = html.indexOf('window.__INITIAL_STATE__=');
  if (start === -1) {
    throw new Error('未找到 __INITIAL_STATE__');
  }
  const jsonStart = start + 'window.__INITIAL_STATE__='.length;
  let depth = 0, inStr = false, esc = false;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        return JSON.parse(html.substring(jsonStart, i + 1));
      }
    }
  }
  throw new Error('__INITIAL_STATE__ JSON 未闭合');
}

/**
 * 获取书籍章节目录
 *
 * 通过 CDP eval 在浏览器中执行 fetch 获取书籍主页，
 * 解析 __INITIAL_STATE__ 提取 chapterInfos。
 *
 * 依赖浏览器当前页面在 weread.qq.com 域下（同源策略）。
 *
 * @param {string} target - CDP 标签页 ID
 * @param {string} bookId - 书籍 ID
 * @returns {{ bookTitle: string, chapters: Array<{uid: number, title: string, level: number, url: string}> }}
 * @throws {Error} 获取或解析失败时抛出
 */
export function getChapterList(target, bookId) {
  const script = `fetch('https://weread.qq.com/web/bookDetail/${bookId}').then(r => r.text())`;
  const result = runCdp(['eval', target, script]);
  if (!result.success) {
    throw new Error('获取书籍主页失败: ' + (result.error || '未知错误'));
  }

  let data;
  try {
    data = extractInitialState(result.output);
  } catch (e) {
    throw new Error('解析书籍信息失败: ' + e.message);
  }

  const chapterInfos = data.reader?.chapterInfos;
  if (!chapterInfos || !Array.isArray(chapterInfos) || chapterInfos.length === 0) {
    throw new Error('未找到章节目录');
  }

  const bookTitle = data.reader?.bookInfo?.title || data.book?.title || '';

  const chapters = chapterInfos.map(c => ({
    uid: c.chapterUid,
    title: c.title || '',
    level: c.level || 0,
    url: buildChapterUrl(bookId, c.chapterUid)
  }));

  return { bookTitle, chapters };
}