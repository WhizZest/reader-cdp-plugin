#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { injectHook, isHookActive, waitForData, extractChapterData, runCdp } from './lib/atob-extract.mjs';

function printUsage() {
  console.log(`
微信读书章节提取工具

用法:
  node extract-chapter.mjs <target> <output-path> [options]

参数:
  <target>       标签页ID（Chrome DevTools Protocol target ID）
  <output-path>  输出文件的完整路径

选项:
  --no-reload    不重载页面，等待已注入的 Hook 捕获数据后直接提取
  --markdown     输出 Markdown 格式（默认输出 HTML）
  --verbose      显示详细输出

依赖:
  本脚本依赖 turndown 库进行 HTML→Markdown 转换。
  首次使用 --markdown 前请运行: npm install

示例:
  node extract-chapter.mjs 9AC2EE05 D:\\output\\chapter1.html
  node extract-chapter.mjs 9AC2EE05 D:\\output\\chapter1.md --markdown
  node extract-chapter.mjs 9AC2EE05 D:\\output\\chapter1.html --verbose

说明:
  通过拦截页面 atob 调用来获取章节原始 base64 数据，解码后得到完整 HTML。
  默认会重载页面以触发章节重新加载，确保捕获到 atob 调用。
  使用 --markdown 可将 HTML 自动转换为 Markdown 格式。

注意事项:
  仅能提取当前账户已购买/可阅读的章节内容。
  未购买章节可能返回不完整或空内容，请确保已在微信读书中打开目标章节。
`);
}

function parseArgs(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const target = args[0];
  const outputPath = args[1];
  const noReload = args.includes('--no-reload');
  const markdown = args.includes('--markdown');
  const verbose = args.includes('--verbose');

  return { target, outputPath, noReload, markdown, verbose };
}

function validateTarget(target) {
  if (!/^[A-Za-z0-9]+$/.test(target)) {
    console.error(`target 格式无效: ${target}`);
    return false;
  }
  return true;
}

async function extractChapter(target, outputPath, noReload, markdown, verbose) {
  console.log('=== 微信读书章节提取工具 ===\n');

  if (!validateTarget(target)) {
    process.exit(1);
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log(`目标标签页: ${target}`);
  console.log(`输出文件: ${outputPath}\n`);

  if (!noReload) {
    if (!injectHook(target, verbose)) {
      process.exit(1);
    }

    console.log('重载页面以触发章节加载...');
    const reloadResult = runCdp(['eval', target, 'location.reload()']);
    if (!reloadResult.success) {
      console.error('错误: 重载页面失败');
      process.exit(1);
    }

    console.log('等待页面加载...');
    await waitForData(target, 30, verbose);
  } else {
    if (!isHookActive(target, verbose)) {
      console.error('错误: atob hook 未激活');
      console.error('请先不带 --no-reload 运行一次以注入持久化 hook');
      process.exit(1);
    }
    console.log('等待 atob 数据就绪...');
    await waitForData(target, 30, verbose);
  }

  console.log('搜索章节 atob 调用...');
  let data;
  try {
    data = extractChapterData(target, { markdown, verbose });
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }

  const outputContent = markdown ? data.markdown : data.html;
  const outputFormat = markdown ? 'Markdown' : 'HTML';

  writeFileSync(outputPath, outputContent, 'utf8');

  if (data.title) {
    console.log(`  章节标题: ${data.title}`);
  }

  console.log(`\n=== 提取完成 ===`);
  console.log(`格式: ${outputFormat}`);
  console.log(`输出文件: ${outputPath}`);
  console.log(`文件大小: ${outputContent.length} 字符`);
  console.log(`数据质量: ${data.garbled === 0 && data.ctrl === 0 ? '✅ 完美' : '⚠ 有异常字符'}`);

  return {
    success: true,
    outputPath,
    format: outputFormat,
    size: outputContent.length,
    garbledCount: data.garbled,
    ctrlCount: data.ctrl,
    title: data.title
  };
}

const args = process.argv.slice(2);
const { target, outputPath, noReload, markdown, verbose } = parseArgs(args);

extractChapter(target, outputPath, noReload, markdown, verbose).catch(e => {
  console.error('未预期的错误:', e);
  process.exit(1);
});
