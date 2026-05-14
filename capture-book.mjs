#!/usr/bin/env node

import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import { injectHook, waitForData, extractChapterData, runCdp } from './lib/atob-extract.mjs';
import { buildChapterUrl } from './lib/wr-hash.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printUsage() {
  console.log(`
微信读书全书捕获工具（atob Hook + 章节 URL 跳转方案）

通过 atob Hook 拦截章节原始 HTML，按章节 URL 跳转获取全书内容。
输出为 Markdown 格式，保留完整 HTML 结构（图片、代码块等）。

用法:
  node capture-book.mjs <target> <output-dir> [options]

参数:
  <target>       标签页ID（Chrome DevTools Protocol target ID）
  <output-dir>   输出目录路径

选项:
  --book-id <id>      书籍 ID（如 b0132ec0813abb496g019430）
                       若不提供，将从当前页面 URL 自动提取
  --max-chapters <n>  最多提取 n 章（默认全部）
  --delay <ms>        章节间延迟毫秒数（默认 2000，避免触发反爬）
  --verbose           显示详细输出

示例:
  node capture-book.mjs FCE786BC D:\\output --book-id b0132ec0813abb496g019430
  node capture-book.mjs FCE786BC D:\\output
  node capture-book.mjs FCE786BC D:\\output --book-id b0132ec0813abb496g019430 --delay 3000 --max-chapters 10
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

  const outputDir = resolve(args[1]);
  const opts = { target, outputDir, bookId: null, maxChapters: 0, delay: 2000, verbose: false };

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--book-id' && args[i + 1]) {
      opts.bookId = args[++i];
    } else if (args[i] === '--max-chapters' && args[i + 1]) {
      const val = parseInt(args[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        console.error(`错误: --max-chapters 必须是正整数: ${args[i]}`);
        process.exit(1);
      }
      opts.maxChapters = val;
    } else if (args[i] === '--delay' && args[i + 1]) {
      const val = parseInt(args[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        console.error(`错误: --delay 必须是正整数: ${args[i]}`);
        process.exit(1);
      }
      opts.delay = val;
    } else if (args[i] === '--verbose') {
      opts.verbose = true;
    }
  }

  return opts;
}

function extractBookId(target) {
  const urlResult = runCdp(['eval', target, 'location.href']);
  if (urlResult.success) {
    const url = urlResult.output;
    const m = url.match(/(?:reader|bookDetail)\/([a-zA-Z0-9]+?)(?:k[0-9a-f]{3}[34]2[0-9a-f]{2}|[?#]|$)/);
    if (m) return m[1];
  }

  const htmlResult = runCdp(['eval', target, 'document.documentElement.innerHTML']);
  if (htmlResult.success) {
    try {
      const data = extractInitialState(htmlResult.output);
      const bookId = data.reader?.bookInfo?.bookId || data.book?.bookId;
      if (bookId) return bookId;
    } catch (e) {}
  }

  console.error('错误: 无法从当前页面提取 book_id');
  console.error('  请确保已打开微信读书的某本书，或使用 --book-id 手动指定');
  process.exit(1);
}

function extractInitialState(html) {
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

function getChapterList(target, bookId, verbose) {
  console.log('获取章节目录...');

  const script = `fetch('https://weread.qq.com/web/bookDetail/${bookId}').then(r => r.text())`;
  const result = runCdp(['eval', target, script]);
  if (!result.success) {
    console.error('错误: 获取书籍主页失败');
    console.error(result.error);
    process.exit(1);
  }

  let data;
  try {
    data = extractInitialState(result.output);
  } catch (e) {
    console.error('错误: 解析书籍信息失败: ' + e.message);
    process.exit(1);
  }

  const chapterInfos = data.reader?.chapterInfos;
  if (!chapterInfos || !Array.isArray(chapterInfos) || chapterInfos.length === 0) {
    console.error('错误: 未找到章节目录');
    process.exit(1);
  }

  const bookTitle = data.reader?.bookInfo?.title || data.book?.title || '';

  const chapters = chapterInfos.map(c => ({
    uid: c.chapterUid,
    title: c.title || '',
    level: c.level || 0,
    url: buildChapterUrl(bookId, c.chapterUid)
  }));

  console.log(`  书名: ${bookTitle}`);
  console.log(`  章节数: ${chapters.length}`);
  if (verbose) {
    chapters.slice(0, 5).forEach((c, i) => {
      console.log(`  [${i + 1}] ${c.title} (uid=${c.uid})`);
    });
    if (chapters.length > 5) console.log(`  ... 共 ${chapters.length} 章`);
  }

  return { bookTitle, chapters };
}

function padNum(n, width) {
  return String(n).padStart(width, '0');
}

function checkLoginState(target) {
  const result = runCdp(['eval', target,
    `(function(){
      var m = document.cookie.match(/wr_localvid=([^;]+)/);
      return m ? (m[1].trim().length > 0 ? '1' : '0') : '0';
    })()`
  ]);
  if (!result.success) {
    console.error('错误: CDP 通信异常，无法检测登录状态');
    console.error('  请检查 Chrome 远程调试是否已启动（--remote-debugging-port=9222）');
    process.exit(1);
  }
  return result.output.trim() === '1';
}

async function captureBook(opts) {
  const { target, outputDir, bookId: inputBookId, maxChapters, delay, verbose } = opts;

  console.log('=== 微信读书全书捕获 ===\n');
  console.log(`目标: ${target}`);
  console.log(`输出: ${outputDir}`);

  const bookId = inputBookId || extractBookId(target);
  console.log(`书籍ID: ${bookId}`);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const chaptersDir = join(outputDir, 'chapters');
  if (!existsSync(chaptersDir)) {
    mkdirSync(chaptersDir, { recursive: true });
  }

  const { bookTitle, chapters } = getChapterList(target, bookId, verbose);

  if (!checkLoginState(target)) {
    console.error('\n错误: 未登录微信读书');
    console.error('  请先在浏览器中登录微信读书后再运行本脚本');
    process.exit(1);
  }

  const effectiveChapters = maxChapters > 0 ? chapters.slice(0, maxChapters) : chapters;
  const totalChapters = effectiveChapters.length;
  const padWidth = String(totalChapters).length;

  console.log(`\n开始逐章提取 (共 ${totalChapters} 章)...\n`);

  console.log('[1/2] 注入 atob Hook...');
  if (!injectHook(target, verbose)) {
    console.error('错误: Hook 注入失败');
    process.exit(1);
  }

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < totalChapters; i++) {
    const chapter = effectiveChapters[i];
    const seq = padNum(i + 1, padWidth);
    const chapterFile = join(chaptersDir, `${seq}-${chapter.uid}.md`);

    if (existsSync(chapterFile) && readFileSync(chapterFile, 'utf8').trim().length > 0) {
      console.log(`[${i + 1}/${totalChapters}] ${chapter.title} - 已存在，跳过`);
      skipCount++;
      continue;
    }

    console.log(`[${i + 1}/${totalChapters}] ${chapter.title}`);

    try {
      if (verbose) console.log(`  导航: ${chapter.url}`);
      const navResult = runCdp(['nav', target, chapter.url]);
      if (!navResult.success) {
        console.error(`  错误: 导航失败 - ${navResult.error}`);
        failCount++;
        continue;
      }

      await waitForData(target, 30, verbose);

      const data = extractChapterData(target, { markdown: true, verbose, headingLevelShift: 1 });
      writeFileSync(chapterFile, data.markdown, 'utf8');

      const quality = data.garbled === 0 && data.ctrl === 0 ? '✅' : '⚠';
      console.log(`  ${quality} ${data.markdown.length} 字符`);
      successCount++;

    } catch (e) {
      console.error(`  错误: ${e.message}`);
      failCount++;
    }

    if (i < totalChapters - 1) {
      const jitterRange = Math.floor(delay * 0.2);
      const randomJitter = Math.floor(Math.random() * jitterRange * 2) - jitterRange;
      const waitMs = delay + randomJitter;
      if (verbose) console.log(`  等待 ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }

  console.log(`\n[2/2] 合并输出...`);
  const fullBookFile = join(outputDir, 'full-book.md');

  if (existsSync(fullBookFile)) {
    unlinkSync(fullBookFile);
  }

  if (bookTitle) {
    writeFileSync(fullBookFile, `# ${bookTitle}\n\n`, 'utf8');
  } else {
    writeFileSync(fullBookFile, '', 'utf8');
  }

  for (let i = 0; i < totalChapters; i++) {
    const chapter = effectiveChapters[i];
    const seq = padNum(i + 1, padWidth);
    const chapterFile = join(chaptersDir, `${seq}-${chapter.uid}.md`);

    if (!existsSync(chapterFile)) continue;

    let content = readFileSync(chapterFile, 'utf8');
    if (/^#/.test(content)) {
      appendFileSync(fullBookFile, content, 'utf8');
    } else {
      appendFileSync(fullBookFile, `## ${chapter.title}\n\n`, 'utf8');
      appendFileSync(fullBookFile, content, 'utf8');
    }
    appendFileSync(fullBookFile, '\n\n', 'utf8');
  }

  console.log(`\n=== 捕获完成 ===`);
  console.log(`成功: ${successCount} 章`);
  if (skipCount > 0) console.log(`跳过: ${skipCount} 章（已存在）`);
  if (failCount > 0) console.log(`失败: ${failCount} 章`);
  console.log(`输出: ${fullBookFile}`);
}

const opts = parseArgs();
captureBook(opts).catch(e => {
  console.error('未预期的错误:', e);
  process.exit(1);
});
