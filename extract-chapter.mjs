#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CDP_SCRIPT = resolve(__dirname, '..', '..', 'cdp.mjs');

function printUsage() {
    console.log(`
微信读书章节提取工具

用法:
  node extract-chapter.mjs <target> <output-path> [options]

参数:
  <target>       标签页ID（Chrome DevTools Protocol target ID）
  <output-path>  输出HTML文件的完整路径

选项:
  --no-reload    不重载页面（直接读取已捕获的atob数据，需先不带此选项运行过一次）
  --verbose      显示详细输出

示例:
  node extract-chapter.mjs 9AC2EE05 D:\\output\\chapter1.html
  node extract-chapter.mjs 9AC2EE05 D:\\output\\chapter1.html --verbose

说明:
  通过拦截页面 atob 调用来获取章节原始 base64 数据，解码后得到完整 HTML。
  默认会重载页面以触发章节重新加载，确保捕获到 atob 调用。
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
    const verbose = args.includes('--verbose');

    return { target, outputPath, noReload, verbose };
}

function validateTarget(target) {
    if (!/^[A-Za-z0-9]+$/.test(target)) {
        console.error(`Invalid target format: ${target}`);
        return false;
    }
    return true;
}

function runCdp(args) {
    try {
        const output = execFileSync('node', [CDP_SCRIPT, ...args], {
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024
        });
        return { success: true, output };
    } catch (error) {
        return { success: false, output: null, error: error.message };
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 压缩为一行：通过 JSON.stringify 传给 evalraw，避免换行符导致 JSON 转义问题
const HOOK_SOURCE = `(function(){
if (window.__weread_atob_hooked) return;
window.__weread_atob_b64=[];
var o=window.atob;
window.atob=function(s){window.__weread_atob_b64.push(btoa(s));return o.call(window,s)};
window.__weread_atob_hooked=true;
})()`;

function injectHookPersistent(target, verbose) {
    if (verbose) console.log('注入持久化 atob hook (Page.addScriptToEvaluateOnNewDocument)...');
    const paramsJson = JSON.stringify({ source: HOOK_SOURCE });
    const result = runCdp(['evalraw', target, 'Page.addScriptToEvaluateOnNewDocument', paramsJson]);
    if (!result.success) {
        console.error('错误: 注入持久化 hook 失败');
        console.error(result.error);
        return false;
    }
    if (verbose) console.log('  hook 已注入，将在每次页面加载时自动运行');
    return true;
}

function verifyHookActive(target, verbose) {
    const result = runCdp(['eval', target, 'window.__weread_atob_hooked === true']);
    if (!result.success || result.output.trim() !== 'true') {
        console.error('错误: atob hook 未激活');
        console.error('请先不带 --no-reload 运行一次以注入持久化 hook');
        return false;
    }
    if (verbose) console.log('atob hook 已激活，跳过注入和重载');
    return true;
}

function getHookCount(target) {
    const result = runCdp(['eval', target, 'window.__weread_atob_b64 ? window.__weread_atob_b64.length : -1']);
    if (!result.success) return -1;
    return parseInt(result.output.trim());
}

function getAtobInput(target, index) {
    const result = runCdp(['eval', target, `window.__weread_atob_b64[${index}]`]);
    if (!result.success || !result.output) return null;
    const b64 = result.output.trim();
    if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
    try {
        return Buffer.from(b64, 'base64').toString('utf8');
    } catch (e) {
        return null;
    }
}

function getChapterTitle(target) {
    const result = runCdp(['eval', target, `(function(){
        var el = document.querySelector('.readerTopBar_title_link');
        return el ? el.textContent.trim() : '';
    })()`]);
    return result.success ? result.output.trim() : '';
}

async function extractChapter(target, outputPath, noReload, verbose) {
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
        if (!injectHookPersistent(target, verbose)) {
            process.exit(1);
        }

        console.log('重载页面以触发章节加载...');
        const reloadResult = runCdp(['eval', target, 'location.reload()']);
        if (!reloadResult.success) {
            console.error('错误: 重载页面失败');
            process.exit(1);
        }

        console.log('等待页面加载...');

        let waited = 0;
        let timedOut = true;
        while (waited < 30) {
            const count = getHookCount(target);
            if (count > 0) {
                if (verbose) console.log(`  页面已加载，atob 记录数: ${count}`);
                timedOut = false;
                break;
            }
            await sleep(1000);
            waited++;
        }

        if (timedOut && verbose) {
            const hooked = runCdp(['eval', target, 'window.__weread_atob_hooked === true']);
            console.log(`  等待超时 (${waited}s)`);
            console.log(`  hook 已生效: ${hooked.success ? hooked.output.trim() : '无法检测'}`);
            console.log(`  可能原因: 页面加载缓慢、网络问题、或页面未使用 atob 解码章节`);
        }
    } else {
        if (!verifyHookActive(target, verbose)) {
            process.exit(1);
        }
    }

    const countAfter = getHookCount(target);
    if (verbose) console.log(`atob 总记录数: ${countAfter}`);

    if (countAfter <= 0) {
        console.error('错误: 未捕获到 atob 调用');
        console.error('请确保微信读书页面已打开且章节内容可见');
        process.exit(1);
    }

    console.log('搜索章节 atob 调用...');
    let chapterInput = null;
    let foundIndex = -1;

    for (let i = 0; i < countAfter; i++) {
        const input = getAtobInput(target, i);
        if (input && input.length > 500 && input.startsWith('PD94bWwg')) { // "<?xml" 的 base64 前缀
            chapterInput = input;
            foundIndex = i;
            break;
        }
    }

    if (!chapterInput) {
        console.error('错误: 未找到章节 atob 调用');
        console.error('已检查的 atob 调用:');
        for (let i = 0; i < countAfter; i++) {
            const input = getAtobInput(target, i);
            if (input) {
                console.error(`  [${i}] len=${input.length} preview=${input.substring(0, 30)}`);
            }
        }
        process.exit(1);
    }

    console.log(`  找到章节数据: index=${foundIndex}, base64长度=${chapterInput.length}`);

    console.log('解码章节内容...');
    const decoded = Buffer.from(chapterInput, 'base64');
    const text = decoded.toString('utf8');

    const garbled = (text.match(/\ufffd/g) || []).length;
    const ctrl = (text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g) || []).length;

    console.log(`  解码完成: ${decoded.length} 字节`);
    console.log(`  乱码(\uFFFD): ${garbled}`);
    console.log(`  控制字符: ${ctrl}`);

    writeFileSync(outputPath, text, 'utf8');

    const title = getChapterTitle(target);
    if (title) {
        console.log(`  章节标题: ${title}`);
    }

    console.log(`\n=== 提取完成 ===`);
    console.log(`HTML文件: ${outputPath}`);
    console.log(`文件大小: ${text.length} 字符`);
    console.log(`数据质量: ${garbled === 0 && ctrl === 0 ? '✅ 完美' : '⚠ 有异常字符'}`);

    return {
        success: true,
        outputPath,
        size: text.length,
        garbledCount: garbled,
        ctrlCount: ctrl,
        title
    };
}

const args = process.argv.slice(2);
const { target, outputPath, noReload, verbose } = parseArgs(args);

extractChapter(target, outputPath, noReload, verbose).catch(e => {
    console.error('未预期的错误:', e);
    process.exit(1);
});
