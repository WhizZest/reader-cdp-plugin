#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CDP_SCRIPT = resolve(__dirname, '..', 'cdp.mjs');

function runCdp(args, verbose = false) {
    try {
        const output = execFileSync('node', [CDP_SCRIPT, ...args], { encoding: 'utf8' });
        return { success: true, output: output.trim(), error: null };
    } catch (e) {
        const error = e.stderr || e.message || 'Unknown error';
        if (verbose) console.error(`CDP error: ${error}`);
        return { success: false, output: null, error };
    }
}

function evalJs(target, expr) {
    const result = runCdp(['eval', target, expr]);
    return result.success ? result.output : null;
}

function evalJsOrThrow(target, expr, context = '') {
    const result = runCdp(['eval', target, expr]);
    if (!result.success) {
        console.error(`CDP 失败${context ? ` (${context})` : ''}: ${result.error}`);
        process.exit(1);
    }
    return result.output;
}

function keypress(target, key) {
    const keyCode = key === 'ArrowRight' ? 39 : key === 'ArrowLeft' ? 37 : 0;
    const code = `document.dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',code:'${key}',keyCode:${keyCode},bubbles:true}))`;
    return evalJs(target, code);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeJsString(str) {
    return JSON.stringify(str);
}

function printUsage() {
    console.log(`
微信读书全书捕获工具（Canvas Hook 方案）

通过 Canvas fillText Hook 捕获浏览器渲染后的文本，逐页翻页获取全书内容。
输出为 Markdown 格式，天然无乱码。

用法:
  node capture-book.mjs <target> <output-dir> [options]

参数:
  <target>       标签页ID（Chrome DevTools Protocol target ID）
  <output-dir>   输出目录路径

选项:
  --start-url <url>   书籍开头的URL（必填，从该URL开始向后翻页）
  --max-pages <n>     最多翻n页（默认500）
  --delay <ms>        翻页间隔毫秒数（默认2500）

示例:
  node capture-book.mjs FCE786BC D:\\output\\book --start-url "https://weread.qq.com/web/reader/b0132ec0813abb496g019430kc0c320a0232c0c7c76d365a"
  node capture-book.mjs FCE786BC D:\\output\\book --start-url "https://weread.qq.com/web/reader/b0132ec0813abb496g019430kc0c320a0232c0c7c76d365a" --max-pages 100 --delay 1500
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
        console.error(`错误: target 格式无效，应为字母数字组合: ${target}`);
        process.exit(1);
    }
    const outputDir = resolve(args[1]);
    const opts = { target, outputDir, startUrl: '', maxPages: 500, delay: 2500 };
    for (let i = 2; i < args.length; i++) {
        if (args[i] === '--start-url' && args[i + 1]) opts.startUrl = args[++i];
        else if (args[i] === '--max-pages' && args[i + 1]) {
            const val = parseInt(args[++i]);
            if (!Number.isFinite(val) || val <= 0) {
                console.error(`错误: --max-pages 必须是正整数: ${args[i]}`);
                process.exit(1);
            }
            opts.maxPages = val;
        }
        else if (args[i] === '--delay' && args[i + 1]) {
            const val = parseInt(args[++i]);
            if (!Number.isFinite(val) || val <= 0) {
                console.error(`错误: --delay 必须是正整数: ${args[i]}`);
                process.exit(1);
            }
            opts.delay = val;
        }
    }
    if (!opts.startUrl) {
        console.error('错误: 必须提供 --start-url 参数（书籍开头的URL）');
        process.exit(1);
    }
    return opts;
}

const HOOK_CODE = `(function(){
    window.__cbTexts = [];
    window.__cbMap = new WeakMap();
    document.querySelectorAll('canvas').forEach((c, i) => window.__cbMap.set(c, i));
    const orig = CanvasRenderingContext2D.prototype.fillText.__orig ||
                 CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, mw) {
        if (text && text.length > 0) {
            const ci = window.__cbMap.has(this.canvas) ? window.__cbMap.get(this.canvas) : -1;
            window.__cbTexts.push({
                t: text,
                x: Math.round(x * 10) / 10,
                y: Math.round(y * 10) / 10,
                c: ci,
                f: this.font || ''
            });
        }
        return orig.apply(this, arguments);
    };
    CanvasRenderingContext2D.prototype.fillText.__orig = orig;
    return 'hooked ' + document.querySelectorAll('canvas').length + ' canvases';
})()`;

function buildProcessPageCode(leftC, rightC) {
    return `(function(){
    const raw = window.__cbTexts || [];
    if (!raw.length) return JSON.stringify({left:'',right:'',summary:'',headings:[]});

    const seen = new Set();
    const deduped = [];
    for (const item of raw) {
        const key = item.t + '|' + item.x + '|' + item.y + '|' + item.c;
        if (!seen.has(key)) { seen.add(key); deduped.push(item); }
    }

    const leftC = ${leftC};
    const rightC = ${rightC};

    const processCanvas = (texts, ci) => {
        const f = texts.filter(t => t.c === ci);
        if (!f.length) return [];
        const s = [...f].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
        const lines = [];
        let cur = null;
        for (const t of s) {
            if (!cur || Math.abs(t.y - cur.y) > 3) {
                if (cur) { cur.text = cur.parts.sort((a,b) => a.x - b.x).map(p => p.text).join(''); lines.push(cur); }
                cur = { y: t.y, parts: [{ text: t.t, x: t.x, font: t.f }] };
            } else {
                cur.parts.push({ text: t.t, x: t.x, font: t.f });
            }
        }
        if (cur) { cur.text = cur.parts.sort((a,b) => a.x - b.x).map(p => p.text).join(''); lines.push(cur); }
        return lines;
    };

    const getFontInfo = (font) => {
        const m = font && font.match(/(\\d+(?:\\.\\d+)?)px/);
        return { size: m ? parseFloat(m[1]) : 0, bold: /bold/i.test(font || '') };
    };

    const classifyLine = (line) => {
        const avg = line.parts.reduce((s, p) => s + getFontInfo(p.font).size, 0) / line.parts.length;
        const bold = line.parts.some(p => getFontInfo(p.font).bold);
        const text = line.text.trim();
        if (!text) return 'empty';
        if (avg >= 26) return 'h1';
        if (avg >= 23) return 'h2';
        if (avg >= 20) return 'h3';
        if (avg >= 17 && bold) return 'h4';
        if (bold) return 'bold';
        return 'normal';
    };

    const formatLine = (line) => {
        const type = classifyLine(line);
        const text = line.text.trim();
        if (!text) return '';
        switch (type) {
            case 'h1': return '# ' + text;
            case 'h2': return '## ' + text;
            case 'h3': return '### ' + text;
            case 'h4': return '#### ' + text;
            case 'bold': return '**' + text + '**';
            default: return text;
        }
    };

    const leftLines = processCanvas(deduped, leftC);
    const rightLines = processCanvas(deduped, rightC);
    const leftText = leftLines.map(formatLine).filter(l => l).join('\\n\\n');
    const rightText = rightLines.map(formatLine).filter(l => l).join('\\n\\n');
    const summary = (leftLines.map(l => l.text).join(' ') + ' ' + rightLines.map(l => l.text).join(' ')).trim();
    const headings = [];
    for (const l of leftLines) { const t = classifyLine(l); if (t === 'h1' || t === 'h2') headings.push({type:t, text:l.text.trim()}); }
    for (const l of rightLines) { const t = classifyLine(l); if (t === 'h1' || t === 'h2') headings.push({type:t, text:l.text.trim()}); }

    return JSON.stringify({left:leftText, right:rightText, summary:summary, headings:headings});
})()`;
}

async function captureBook(opts) {
    const { target, outputDir, startUrl, maxPages, delay } = opts;

    console.log('=== 微信读书全书捕获 ===\n');
    console.log(`目标: ${target}`);
    console.log(`输出: ${outputDir}`);
    console.log(`起始URL: ${startUrl}`);
    console.log(`最大页数: ${maxPages}, 翻页间隔: ${delay}ms\n`);

    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    const outputFile = resolve(outputDir, 'full-book.md');
    if (existsSync(outputFile)) unlinkSync(outputFile);

    let totalChars = 0;
    let pageCount = 0;

    const appendPage = (text) => {
        if (!text || !text.trim()) return;
        const content = pageCount > 0 ? '\n\n---\n\n' + text : text;
        appendFileSync(outputFile, content, 'utf8');
        totalChars += text.length;
        pageCount++;
    };

    console.log('[1/4] 导航到书籍开头');
    const navCode = `location.href = ${escapeJsString(startUrl)}`;
    const navResult = evalJs(target, navCode);
    if (navResult === null) {
        console.error('错误: 导航失败，CDP 连接异常');
        process.exit(1);
    }
    await sleep(5000);

    const currentUrl = evalJsOrThrow(target, 'location.href', '获取当前URL');
    const currentTitle = evalJsOrThrow(target, 'document.title', '获取页面标题');
    console.log(`  当前: ${currentTitle}`);
    console.log(`  URL: ${currentUrl}`);

    console.log('\n[2/4] 注入 Canvas Hook 并获取布局');
    const canvasOrderResult = evalJsOrThrow(target, `(function(){
        const cs = document.querySelectorAll('canvas');
        return JSON.stringify(Array.from(cs).map((c,i) => ({i, l:Math.round(c.getBoundingClientRect().left)})));
    })()`, '获取Canvas布局');
    let leftC = 0, rightC = 1;
    try {
        const co = JSON.parse(canvasOrderResult || '[]').sort((a, b) => a.l - b.l);
        leftC = co[0]?.i ?? 0;
        rightC = co[1]?.i ?? 1;
        console.log(`  Canvas 布局: 左=${leftC}, 右=${rightC}`);
    } catch { console.log('  Canvas 布局获取失败，使用默认值'); }

    const hookResult = evalJsOrThrow(target, HOOK_CODE, '注入Canvas Hook');
    console.log(`  Hook: ${hookResult}`);

    console.log('  触发首页重绘...');
    evalJs(target, 'window.__cbTexts = []');
    evalJs(target, 'window.dispatchEvent(new Event("resize"))');
    await sleep(2000);

    const firstCountStr = evalJsOrThrow(target, 'window.__cbTexts ? window.__cbTexts.length : 0', '获取首页文本数量');
    const firstCount = parseInt(firstCountStr) || 0;
    console.log(`  首页文本: ${firstCount} 条`);

    const getTextCount = () => {
        const result = evalJs(target, 'window.__cbTexts ? window.__cbTexts.length : 0');
        return result ? parseInt(result) || 0 : 0;
    };
    const clearTexts = () => { evalJs(target, 'window.__cbTexts = []'); };

    const processPageCode = buildProcessPageCode(leftC, rightC);
    const processPage = () => {
        const result = evalJs(target, processPageCode);
        if (result === null) return null;
        try { return JSON.parse(result || '{}'); }
        catch { return { left: '', right: '', summary: '', headings: [] }; }
    };

    if (firstCount > 0) {
        const firstPage = processPage();
        if (firstPage) {
            const firstContent = [];
            if (firstPage.left && firstPage.left.trim()) firstContent.push(firstPage.left);
            if (firstPage.right && firstPage.right.trim()) firstContent.push(firstPage.right);
            const firstText = firstContent.join('\n\n');
            if (firstText.trim()) {
                appendPage(firstText);
                console.log(`  首页捕获: ${firstText.length} 字符`);
            }
        }
    }

    console.log('\n[3/4] 逐页向后捕获全书内容');
    let sameCount = 0;
    let lastSummary = '';

    for (let i = 0; i < maxPages; i++) {
        clearTexts();
        keypress(target, 'ArrowRight');
        await sleep(delay);

        const count = getTextCount();
        if (count === 0) {
            sameCount++;
            if (sameCount >= 5) {
                console.log(`  页 ${i + 1}: 连续5页无内容，停止`);
                break;
            }
            continue;
        }

        const page = processPage();
        if (page === null) {
            console.error(`  页 ${i + 1}: CDP 失败，停止`);
            break;
        }
        if (!page.summary || page.summary.trim().length === 0) {
            sameCount++;
            if (sameCount >= 5) break;
            continue;
        }

        if (page.summary === lastSummary) {
            sameCount++;
            if (sameCount >= 3) {
                console.log(`  页 ${i + 1}: 连续3页内容相同，停止`);
                break;
            }
            continue;
        }
        sameCount = 0;
        lastSummary = page.summary;

        const pageContent = [];
        if (page.left && page.left.trim()) pageContent.push(page.left);
        if (page.right && page.right.trim()) pageContent.push(page.right);
        const pageText = pageContent.join('\n\n');

        if (pageText.trim()) {
            appendPage(pageText);
        }

        if ((i + 1) % 10 === 0) {
            console.log(`  已捕获 ${i + 1} 页, ${totalChars} 字符`);
        }

        if (page.summary.includes('已读完') || page.summary.includes('已 读 完')) {
            console.log(`  页 ${i + 1}: 到达书末`);
            break;
        }
    }

    console.log('\n[4/4] 保存输出');
    let chineseCount = 0;
    if (totalChars > 0 && existsSync(outputFile)) {
        chineseCount = (readFileSync(outputFile, 'utf8').match(/[\u4e00-\u9fa5]/g) || []).length;
    }
    console.log(`  已保存: ${outputFile}`);
    console.log(`  总字符: ${totalChars}, 中文字符: ${chineseCount}`);
    console.log(`  总页数: ${pageCount}`);

    console.log('\n=== 完成 ===');
}

const opts = parseArgs();
captureBook(opts);
