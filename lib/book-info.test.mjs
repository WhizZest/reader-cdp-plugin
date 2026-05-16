import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBookId, extractInitialState } from './book-info.mjs';

describe('normalizeBookId', () => {
  describe('纯数字 bookId', () => {
    it('转换为 encodeId 格式', () => {
      const result = normalizeBookId('3300199909');
      assert.equal(result, 'b0132ec0813abb496g019430');
    });

    it('短数字也正确转换', () => {
      const result = normalizeBookId('50');
      assert.equal(typeof result, 'string');
      assert.ok(result.length >= 20);
    });
  });

  describe('encodeId 格式', () => {
    it('原样返回', () => {
      assert.equal(normalizeBookId('b0132ec0813abb496g019430'), 'b0132ec0813abb496g019430');
    });

    it('含大写字母也原样返回', () => {
      assert.equal(normalizeBookId('A0132EC0813ABB496G019430'), 'A0132EC0813ABB496G019430');
    });
  });

  describe('输入清理', () => {
    it('去除首尾空格', () => {
      assert.equal(normalizeBookId('  3300199909  '), 'b0132ec0813abb496g019430');
    });

    it('number 类型自动转字符串', () => {
      assert.equal(normalizeBookId(3300199909), 'b0132ec0813abb496g019430');
    });
  });

  describe('无效格式', () => {
    it('非数字非 encodeId 抛出错误', () => {
      assert.throws(() => normalizeBookId(''), /无效的 bookId 格式/);
      assert.throws(() => normalizeBookId('abc'), /无效的 bookId 格式/);
      assert.throws(() => normalizeBookId('abc123'), /无效的 bookId 格式/);
    });

    it('过短的 encodeId 抛出错误', () => {
      assert.throws(() => normalizeBookId('abc12'), /无效的 bookId 格式/);
    });
  });
});

describe('extractInitialState', () => {
  it('解析有效的 __INITIAL_STATE__', () => {
    const html = '<script>window.__INITIAL_STATE__={"reader":{"bookInfo":{"bookId":"123"}}};</script>';
    const result = extractInitialState(html);
    assert.equal(result.reader.bookInfo.bookId, '123');
  });

  it('解析嵌套对象和数组', () => {
    const html = 'window.__INITIAL_STATE__={"a":{"b":[1,2,{"c":"d"}]}}';
    const result = extractInitialState(html);
    assert.deepEqual(result, { a: { b: [1, 2, { c: 'd' }] } });
  });

  it('处理 JSON 字符串中包含花括号的情况', () => {
    const html = 'window.__INITIAL_STATE__={"text":"hello {world}"}';
    const result = extractInitialState(html);
    assert.equal(result.text, 'hello {world}');
  });

  it('处理转义字符', () => {
    const html = 'window.__INITIAL_STATE__={"text":"hello \\"world\\""}';
    const result = extractInitialState(html);
    assert.equal(result.text, 'hello "world"');
  });

  it('未找到 __INITIAL_STATE__ 时抛出错误', () => {
    assert.throws(() => extractInitialState('<html></html>'), /未找到 __INITIAL_STATE__/);
  });

  it('JSON 未闭合时抛出错误', () => {
    assert.throws(() => extractInitialState('window.__INITIAL_STATE__={"a":1'), /未闭合/);
  });
});