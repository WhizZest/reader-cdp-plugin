import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed++;
    const detail = e.stderr?.toString().trim() || e.stdout?.toString().trim() || e.message;
    console.log(`  ✘ ${name}`);
    console.log(`    错误: ${detail.trim().split('\n')[0]}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `期望 "${expected}", 实际 "${actual}"`);
  }
}

function assertThrows(fn, expectedMsg) {
  try {
    fn();
    throw new Error('expected error but none thrown');
  } catch (e) {
    if (expectedMsg && !e.message.includes(expectedMsg)) {
      throw new Error(`错误信息不匹配，期望包含 "${expectedMsg}", 实际: "${e.message}"`);
    }
  }
}

function collectMjsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      files.push(...collectMjsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(full);
    }
  }
  return files;
}

console.log('=== 微信读书插件 离线测试 ===\n');

console.log('1. 语法检查 (node --check)');
const mjsFiles = collectMjsFiles(ROOT);
for (const file of mjsFiles) {
  const rel = file.slice(ROOT.length + 1);
  test(rel, () => {
    execFileSync('node', ['--check', file], { stdio: 'pipe' });
  });
}

console.log('\n2. wr_hash 单元测试');
test('wr-hash.test.mjs', () => {
  execFileSync('node', ['--test', 'lib/wr-hash.test.mjs'], {
    cwd: ROOT,
    stdio: 'pipe'
  });
});

console.log('\n3. normalizeBookId 功能测试');
try {
  const { normalizeBookId, extractInitialState } = await import('./book-info.mjs');

  test('纯数字转换', () => {
    assertEqual(normalizeBookId('3300199909'), 'b0132ec0813abb496g019430');
  });

  test('encodeId 原样返回', () => {
    assertEqual(normalizeBookId('b0132ec0813abb496g019430'), 'b0132ec0813abb496g019430');
  });

  test('trim 空白', () => {
    assertEqual(normalizeBookId('  3300199909  '), 'b0132ec0813abb496g019430');
  });

  test('数字类型转字符串', () => {
    assertEqual(normalizeBookId(3300199909), 'b0132ec0813abb496g019430');
  });

  test('非法格式报错', () => {
    assertThrows(() => normalizeBookId('abc'), '无效的 bookId 格式');
    assertThrows(() => normalizeBookId(''), '无效的 bookId 格式');
  });

  test('空字符串加 trim 后报错', () => {
    assertThrows(() => normalizeBookId('   '), '无效的 bookId 格式');
  });

  console.log('\n4. extractInitialState 功能测试');
  test('解析标准 __INITIAL_STATE__ ', () => {
    const html = '<html><script>window.__INITIAL_STATE__={"a":1,"b":{"c":[1,2,3]}}</script></html>';
    const data = extractInitialState(html);
    assertEqual(data.a, 1);
    assertEqual(data.b.c[2], 3);
  });

  test('未找到抛错', () => {
    assertThrows(() => extractInitialState('<html></html>'), '未找到 __INITIAL_STATE__');
  });

  test('未闭合抛错', () => {
    assertThrows(() => extractInitialState('window.__INITIAL_STATE__={'), '未闭合');
  });

  test('嵌套字符串中的花括号', () => {
    const html = 'window.__INITIAL_STATE__={"text":"hello {world}","nested":{"key":"val}"}}';
    const data = extractInitialState(html);
    assertEqual(data.text, 'hello {world}');
    assertEqual(data.nested.key, 'val}');
  });

  test('转义引号', () => {
    const html = 'window.__INITIAL_STATE__={"msg":"say \\"hello\\"","ok":true}';
    const data = extractInitialState(html);
    assertEqual(data.msg, 'say "hello"');
    assert(data.ok);
  });

} catch (e) {
  console.log(`  ⚠ 跳过 normalize/extract 测试（依赖 chrome-cdp 根目录，CI 环境预期）`);
}

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
