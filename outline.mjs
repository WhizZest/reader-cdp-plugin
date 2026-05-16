#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { extractBookId, getChapterList, getOutline, normalizeBookId } from './lib/book-info.mjs';

function printUsage() {
  console.log(`
微信读书大纲工具

获取微信读书 AI 生成的章节大纲（章节要点摘要）。

用法:
  node outline.mjs <target> [options]

参数:
  <target>       标签页ID（Chrome DevTools Protocol target ID）
                 需在微信读书书籍页面运行

选项:
  --book-id <id>  书籍 ID（支持两种格式）
                   encodeId: b0132ec0813abb496g019430
                   纯数字:   3300199909
  --chapter <uid> 只获取指定章节的大纲（正整数，默认全部）
  --output <file> 导出为 Markdown 文件（与 --json 互斥）
  --json          输出 JSON 格式（与 --output 互斥）
  --verbose       显示详细输出

示例:
  node outline.mjs 483DB8D1
  node outline.mjs 483DB8D1 --book-id b0132ec0813abb496g019430
  node outline.mjs 483DB8D1 --chapter 5
  node outline.mjs 483DB8D1 --output ./outline.md
  node outline.mjs 483DB8D1 --json
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

  const opts = { target, bookId: null, chapter: null, output: null, json: false, verbose: false };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--book-id' && args[i + 1]) {
      opts.bookId = args[++i];
    } else if (args[i] === '--chapter' && args[i + 1]) {
      const val = parseInt(args[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        console.error(`错误: --chapter 必须是正整数: ${args[i]}`);
        process.exit(1);
      }
      opts.chapter = val;
    } else if (args[i] === '--output' && args[i + 1]) {
      opts.output = resolve(args[++i]);
    } else if (args[i] === '--json') {
      opts.json = true;
    } else if (args[i] === '--verbose') {
      opts.verbose = true;
    }
  }

  if (opts.json && opts.output) {
    console.error('错误: --json 与 --output 不能同时使用');
    process.exit(1);
  }

  return opts;
}

function printOutline(bookTitle, outlines, chapterTitleMap) {
  console.log(`书名: 《${bookTitle}》`);
  console.log(`大纲章节数: ${outlines.length}\n`);

  if (outlines.length === 0) {
    console.log('该书暂无大纲');
    return;
  }

  for (const outline of outlines) {
    const title = chapterTitleMap.get(outline.chapterUid) || `章节 ${outline.chapterUid}`;
    console.log(`--- ${title} ---`);

    for (const item of outline.items) {
      const indent = '  '.repeat(item.level - 1);
      console.log(`${indent}${item.level}. ${item.text}`);
    }
    console.log('');
  }
}

function formatToMarkdown(bookTitle, outlines, chapterTitleMap) {
  const lines = [];
  lines.push(`# 《${bookTitle}》大纲\n`);

  for (const outline of outlines) {
    const title = chapterTitleMap.get(outline.chapterUid) || `章节 ${outline.chapterUid}`;
    lines.push(`## ${title}\n`);

    for (const item of outline.items) {
      const indent = '  '.repeat(item.level - 1);
      lines.push(`${indent}- ${item.text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  const opts = parseArgs();
  const { target, json, verbose, bookId: inputBookId, chapter: targetChapterUid, output } = opts;

  try {
    const bookId = normalizeBookId(inputBookId || extractBookId(target));
    if (verbose) console.log(`bookId: ${bookId} (来源: ${inputBookId ? '参数' : '页面提取'})`);

    const { bookTitle, numericBookId, chapters } = getChapterList(target, bookId);
    if (verbose) console.log(`numericBookId: ${numericBookId}`);

    if (!numericBookId) {
      console.error('错误: 无法获取数字 bookId，大纲功能不可用');
      process.exit(1);
    }

    const chapterTitleMap = new Map();
    for (const c of chapters) {
      chapterTitleMap.set(c.uid, c.title);
    }

    const chapterUids = targetChapterUid
      ? [targetChapterUid]
      : chapters.map(c => c.uid);

    if (verbose) {
      console.log(`获取大纲: ${chapterUids.length} 个章节`);
    }

    const outlines = getOutline(target, numericBookId, chapterUids);

    if (targetChapterUid && outlines.length === 0) {
      console.log('该章节暂无大纲');
      return;
    }

    if (json) {
      const result = outlines.map(o => ({
        chapterUid: o.chapterUid,
        title: chapterTitleMap.get(o.chapterUid) || `章节 ${o.chapterUid}`,
        items: o.items
      }));
      console.log(JSON.stringify({ bookTitle, bookId, numericBookId, outlines: result }, null, 2));
    } else if (output) {
      const markdown = formatToMarkdown(bookTitle, outlines, chapterTitleMap);
      writeFileSync(output, markdown, 'utf-8');
      console.log(`已导出 ${outlines.length} 个章节的大纲到 ${output}`);
    } else {
      printOutline(bookTitle, outlines, chapterTitleMap);
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
    process.exit(1);
  }
}

main();