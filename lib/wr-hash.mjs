import crypto from 'crypto';

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

/**
 * 计算微信读书章节 URL 中的 hash 值。
 * 算法从 weread-exporter 逆向，用于构造章节跳转 URL。
 *
 * @param {string} s - chapterUid 字符串（如 "50"）
 * @returns {string} hash 值
 *
 * 测试用例:
 *   wr_hash("42557145") === "f343248072895ed9f34f408"
 *   wr_hash("14")       === "aab325601eaab3238922e53"
 */
export function wr_hash(s) {
  const hash_str = md5(s);
  let result = hash_str.substring(0, 3) + "32" + hash_str.substring(hash_str.length - 2);

  const chunks = [];
  for (let i = 0; i < s.length; i += 9) {
    chunks.push(parseInt(s.substring(i, Math.min(i + 9, s.length))).toString(16));
  }

  for (let i = 0; i < chunks.length; i++) {
    let hex_len = chunks[i].length.toString(16);
    if (hex_len.length === 1) {
      hex_len = "0" + hex_len;
    }
    result += hex_len + chunks[i];
    if (i < chunks.length - 1) {
      result += "g";
    }
  }

  if (result.length < 20) {
    result += hash_str.substring(0, 20 - result.length);
  }
  result += md5(result).substring(0, 3);
  return result;
}

/**
 * 构造章节 URL
 * @param {string} bookId - URL 中的 book_id（如 "b0132ec0813abb496g019430"）
 * @param {number|string} chapterUid - 章节 ID
 * @returns {string} 完整章节 URL
 */
export function buildChapterUrl(bookId, chapterUid) {
  const hash = wr_hash(String(chapterUid));
  return `https://weread.qq.com/web/reader/${bookId}k${hash}`;
}
