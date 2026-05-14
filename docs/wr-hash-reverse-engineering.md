# wr_hash 算法逆向文档

## 概述

`wr_hash` 是微信读书用于构造章节 URL 的哈希算法。章节 URL 格式为：

```
https://weread.qq.com/web/reader/<bookId>k<wr_hash(chapterUid)>
```

例如 chapterUid 为 `50` 时，hash 为 `c0c320a0232c0c7c76d365a`，完整 URL 为：

```
https://weread.qq.com/web/reader/b0132ec0813abb496g019430kc0c320a0232c0c7c76d365a
```

该算法使得 `capture-book.mjs` 可以直接从 `chapterUid` 构造出可导航的章节 URL，彻底绕过了"下一页/下一章"按钮的复杂性。

## 逆向方法

通过 Chrome CDP 动态调试，从微信读书混淆源码中逆向提取。完整路径：

1. **Hook 注入** — 在 `pushState` / `replaceState` 上挂载追踪，捕获导航调用栈
2. **调用栈分析** — 定位到 URL 构造函数 `horizontalReaderURL`
3. **断点调试** — 在构造函数调用处设断点，确认参数和返回值
4. **源码搜索** — 在 `app.d90b89fe.js` 中搜索 `'e':function`，提取模块 0x9c 的完整源码
5. **交叉验证** — 本地实现与浏览器 `_0x25e920['e']` 对比，确保一致性

## 原始混淆源码

以下是从 `app.d90b89fe.js` 模块 0x9c 中提取的原始函数（已去除字符串混淆）：

```javascript
'e': function(input) {
  if (typeof input === 'number') input = input.toString();
  if (typeof input !== 'string') return input;

  var hash = createHash('md5').update(input).digest('hex');
  var result = hash.substr(0, 3);

  var encodeChunks = function(s) {
    if (/^\d*$/.test(s)) {
      var chunks = [];
      for (var i = 0; i < s.length; i += 9) {
        var chunk = s.slice(i, Math.min(i + 9, s.length));
        chunks.push(parseInt(chunk).toString(16));
      }
      return ['3', chunks];
    }
    var hex = '';
    for (var i = 0; i < s.length; i++) {
      hex += s.charCodeAt(i).toString(16);
    }
    return ['4', [hex]];
  }(input);

  result += encodeChunks[0];                          // 类型标记: '3' 或 '4'
  result += '2' + hash.substr(hash.length - 2, 2);    // 固定字符 '2' + MD5 末2位

  var chunks = encodeChunks[1];
  for (var i = 0; i < chunks.length; i++) {
    var hexLen = chunks[i].length.toString(16);
    if (hexLen.length === 1) hexLen = '0' + hexLen;
    result += hexLen + chunks[i];
    if (i < chunks.length - 1) result += 'g';
  }

  if (result.length < 20) {
    result += hash.substr(0, 20 - result.length);
  }
  result += createHash('md5').update(result).digest('hex').substr(0, 3);
  return result;
}
```

## 算法结构

```
wr_hash(input):
  1. 数字类型 → toString()
  2. 非字符串 → 直接返回原值
  3. md5 = MD5(input)
  4. result = md5[0:3]                              // MD5 前3位
  5. 类型判断:
     - 纯数字 → type = '3', chunks = parseInt 分块转 hex（每9字符一组）
     - 含非数字 → type = '4', chunks = [charCodeAt 逐字转 hex]
  6. result += type + '2' + md5[-2:]                // 类型标记 + 固定'2' + MD5末2位
  7. 遍历 chunks:
     - result += hexLen(2位补零) + chunkHex
     - 非最后一块 → result += 'g'
  8. result.length < 20 → 用 md5 前缀补齐到20位
  9. result += MD5(result)[0:3]                     // 校验尾缀
```

## 关键发现

### "32" 不是魔数

之前误以为 `"32"` 是固定魔数。实际上它是两部分拼接：

| 部分 | 含义 | 值 |
|------|------|-----|
| 类型标记 | 纯数字输入 | `'3'` |
| 类型标记 | 含非数字输入 | `'4'` |
| 固定字符 | 始终为 | `'2'` |
| MD5末2位 | 动态 | `hash[-2:]` |

所以数字输入的前缀是 `"3" + "2" + last2` = `"32" + last2`，看起来像固定魔数 `"32"`，但 `"3"` 实际是动态的类型标记。非数字输入的前缀为 `"42" + last2`。

### 双路径编码

输入类型决定编码方式：

| 输入类型 | 编码方式 | 分块策略 | 示例 |
|---------|---------|---------|------|
| 纯数字 | `parseInt(chunk).toString(16)` | 每9字符一组 | `"42557145"` → `["28956d9"]` |
| 含非数字 | `charCodeAt(i).toString(16)` | 全部放入一个chunk | `"test"` → `["74657374"]` |

## 本地实现

实现代码位于 [`lib/wr-hash.mjs`](../lib/wr-hash.mjs)，核心逻辑与上述原始混淆源码一一对应。以下仅列出关键差异点：

- **模块化**：使用 ES module `export` 替代 webpack 模块系统
- **MD5**：使用 Node.js `crypto.createHash('md5')` 替代浏览器环境的 `createHash`
- **类型守卫**：新增空字符串守卫（`s.length === 0`），避免静默生成无意义 hash
- **`parseInt` 行为**：与原始混淆代码一致，会丢失前导零（如 `parseInt("000123")` → `123`），这是有意为之

详细实现请直接阅读源文件。

## 测试用例

与浏览器 `_0x25e920['e']` 交叉验证通过：

| 输入 | 类型 | 输出 | 验证 |
|------|------|------|------|
| `"42557145"` | 纯数字 | `f343248072895ed9f34f408` | ✅ |
| `"14"` | 纯数字 | `aab325601eaab3238922e53` | ✅ |
| `"50"` | 纯数字 | `c0c320a0232c0c7c76d365a` | ✅ |
| `"test"` | 含非数字 | `09842f60874657374098bf5` | ✅ |

## 相关文件

- `lib/wr-hash.mjs` — 算法实现
- `capture-book.mjs` — 使用 wr_hash 构造章节 URL 进行全书捕获