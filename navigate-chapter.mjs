#!/usr/bin/env node

import { runCdp } from './lib/atob-extract.mjs';
import { buildChapterUrl } from './lib/wr-hash.mjs';
import { extractBookId, normalizeBookId } from './lib/book-info.mjs';

function printUsage() {
  console.log(`
微信读书章节导航工具

通过 chapterUid 直接跳转到指定章节。

用法:
  node navigate-chapter.mjs <target> <chapterUid> [options]

参数:
  <target>       标签页ID（Chrome DevTools Protocol target ID）
                 需在微信读书书籍页面运行
  <chapterUid>   章节 UID（数字或字符串）

选项:
  --book-id <id>  书籍 ID（支持两种格式）
                   encodeId: b0132ec0813abb496g019430
                   纯数字:   3300199909
  --verbose       显示详细输出

示例:
  node navigate-chapter.mjs 483DB8D1 50
  node navigate-chapter.mjs 483DB8D1 50 --book-id b0132ec0813abb496g019430
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const target = args[0];
  if (!/^[A-Za-z0-9]+$/.test(target)) {
    console.error(`错误: target 格式无效: ${target}`);
    process.exit(1);
  }

  const chapterUid = args[1];
  if (!chapterUid || !chapterUid.trim()) {
    console.error('错误: chapterUid 不能为空');
    process.exit(1);
  }
  const opts = { target, chapterUid, bookId: null, verbose: false };

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--book-id' && args[i + 1]) {
      opts.bookId = args[++i];
    } else if (args[i] === '--verbose') {
      opts.verbose = true;
    }
  }

  return opts;
}

function main() {
  const opts = parseArgs();
  const { target, chapterUid, verbose, bookId: inputBookId } = opts;

  try {
    const bookId = normalizeBookId(inputBookId || extractBookId(target));
    if (verbose) console.log(`bookId: ${bookId} (来源: ${inputBookId ? '参数' : '页面提取'})`);

    const url = buildChapterUrl(bookId, chapterUid);
    console.log(`导航到章节 ${chapterUid}...`);

    const result = runCdp(['nav', target, url]);
    if (!result.success) {
      console.error(`导航失败:\n${result.error}`);
      process.exit(1);
    }

    const urlCheck = runCdp(['eval', target, 'location.href']);
    if (urlCheck.success && urlCheck.output.includes(url)) {
      console.log(`导航成功: ${url}`);
    } else {
      console.error('导航可能失败：页面未跳转到预期地址');
      console.error(`当前 URL: ${urlCheck.output || '无法获取'}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
    process.exit(1);
  }
}

main();