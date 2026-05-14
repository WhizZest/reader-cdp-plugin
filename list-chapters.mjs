#!/usr/bin/env node

import { extractBookId, getChapterList, normalizeBookId } from './lib/book-info.mjs';

function printUsage() {
  console.log(`
微信读书章节目录列表工具

列出当前书籍的完整章节目录，包含章节标题和 UID。

用法:
  node list-chapters.mjs <target> [options]

参数:
  <target>       标签页ID（Chrome DevTools Protocol target ID）
                 需在微信读书书籍页面运行

选项:
  --book-id <id>  书籍 ID（支持两种格式）
                   encodeId: b0132ec0813abb496g019430
                   纯数字:   3300199909
  --json          输出 JSON 格式（默认表格）
  --verbose       显示详细输出

示例:
  node list-chapters.mjs 483DB8D1
  node list-chapters.mjs 483DB8D1 --book-id b0132ec0813abb496g019430
  node list-chapters.mjs 483DB8D1 --json
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const target = args[0];
  if (!/^[A-Za-z0-9]+$/.test(target)) {
    console.error(`错误: target 格式无效: ${target}`);
    process.exit(1);
  }

  const opts = { target, bookId: null, json: false, verbose: false };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--book-id' && args[i + 1]) {
      opts.bookId = args[++i];
    } else if (args[i] === '--json') {
      opts.json = true;
    } else if (args[i] === '--verbose') {
      opts.verbose = true;
    }
  }

  return opts;
}

function printTable(bookTitle, chapters) {
  console.log(`书名: ${bookTitle}`);
  console.log(`章节数: ${chapters.length}\n`);

  if (chapters.length === 0) {
    console.log('该书暂无章节目录');
    return;
  }

  const uidWidth = Math.max(3, ...chapters.map(c => String(c.uid).length));
  const headerUid = 'uid'.padEnd(uidWidth);

  console.log(`  #  ${headerUid}  标题`);
  console.log(`  --  ${'-'.repeat(uidWidth)}  ----`);

  chapters.forEach((c, i) => {
    const idx = String(i + 1).padStart(2);
    const uid = String(c.uid).padEnd(uidWidth);
    console.log(`  ${idx}  ${uid}  ${c.title}`);
  });
}

function main() {
  const opts = parseArgs();
  const { target, json, verbose, bookId: inputBookId } = opts;

  try {
    const bookId = inputBookId ? normalizeBookId(inputBookId) : extractBookId(target);
    if (verbose) console.log(`bookId: ${bookId} (来源: ${inputBookId ? '参数' : '页面提取'})`);

    const { bookTitle, chapters } = getChapterList(target, bookId);

    if (json) {
      console.log(JSON.stringify({ bookTitle, bookId, chapters }, null, 2));
    } else {
      printTable(bookTitle, chapters);
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
    process.exit(1);
  }
}

main();