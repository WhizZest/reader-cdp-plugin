import crypto from 'crypto';

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

/**
 * 计算微信读书章节 URL 中的 hash 值。
 * 算法通过 Chrome CDP 动态调试从微信读书混淆源码中逆向提取。
 *
 * 原始源码位于 app.d90b89fe.js 模块 0x9c，函数签名:
 *   'e': function(input) { ... }
 *
 * 算法核心:
 *   1. MD5(input) 取前3位
 *   2. 类型标记: 纯数字='3', 含非数字='4'
 *   3. 拼接 "2" + MD5末2位
 *   4. 分块编码: 数字用 parseInt 转 hex（与原始混淆代码一致，会丢失前导零）,
 *      非数字用 charCodeAt 逐字转 hex
 *   5. 每块前加2位hex长度, 块间用 "g" 分隔
 *   6. 不足20位用 MD5 前缀补齐
 *   7. 最后追加 MD5(result) 前3位
 *
 * @param {string|number} s - 输入字符串（如 chapterUid "50"）
 * @returns {string} hash 值
 *
 * 测试用例（与浏览器 _0x25e920['e'] 交叉验证通过）:
 *   wr_hash("42557145") === "f343248072895ed9f34f408"
 *   wr_hash("14")       === "aab325601eaab3238922e53"
 *   wr_hash("50")       === "c0c320a0232c0c7c76d365a"
 *   wr_hash("test")     === "09842f60874657374098bf5"
 */
export function wr_hash(s) {
  if (typeof s === 'number') {
    s = s.toString();
  }
  if (typeof s !== 'string' || s.length === 0) {
    return typeof s === 'string' ? s : '';
  }

  const hash_str = md5(s);
  let result = hash_str.substring(0, 3);

  const isNumeric = /^\d*$/.test(s);
  const chunks = [];

  if (isNumeric) {
    for (let i = 0; i < s.length; i += 9) {
      const chunk = s.slice(i, i + 9);
      chunks.push(parseInt(chunk).toString(16));
    }
    result += '3';
  } else {
    let hexStr = '';
    for (let i = 0; i < s.length; i++) {
      hexStr += s.charCodeAt(i).toString(16);
    }
    chunks.push(hexStr);
    result += '4';
  }

  result += '2' + hash_str.substring(hash_str.length - 2);

  for (let i = 0; i < chunks.length; i++) {
    let hex_len = chunks[i].length.toString(16);
    if (hex_len.length === 1) {
      hex_len = '0' + hex_len;
    }
    result += hex_len + chunks[i];
    if (i < chunks.length - 1) {
      result += 'g';
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
