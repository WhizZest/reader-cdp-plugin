import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const CDP_SCRIPT = resolve(__dirname, '..', '..', '..', 'cdp.mjs');

let TurndownService = null;
try {
  TurndownService = require('turndown');
} catch (e) {
  // turndown not installed
}

export function runCdp(args) {
  try {
    const output = execFileSync('node', [CDP_SCRIPT, ...args], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, output: null, error: error.message };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const HOOK_SOURCE = `(function(){
if (window.__weread_atob_hooked) return;
window.__weread_atob_b64=[];
var o=window.atob;
window.atob=function(s){window.__weread_atob_b64.push(btoa(s));return o.call(window,s)};
window.__weread_atob_hooked=true;
})()`;

/**
 * 注入持久化 atob Hook（Page.addScriptToEvaluateOnNewDocument）
 * 注入后每次页面加载都会自动运行 Hook。
 * @param {string} target - CDP target ID
 * @param {boolean} verbose - 是否输出详细日志
 * @returns {boolean} 是否成功
 */
export function injectHook(target, verbose = false) {
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

/**
 * 检查 Hook 是否已激活（不注入新 Hook，仅检查状态）
 * @param {string} target
 * @param {boolean} verbose
 * @returns {boolean}
 */
export function isHookActive(target, verbose = false) {
  const result = runCdp(['eval', target, 'window.__weread_atob_hooked === true']);
  if (!result.success || result.output !== 'true') {
    return false;
  }
  if (verbose) console.log('atob hook 已激活');
  return true;
}

function getHookCount(target) {
  const result = runCdp(['eval', target, 'window.__weread_atob_b64 ? window.__weread_atob_b64.length : -1']);
  if (!result.success) return -1;
  return parseInt(result.output);
}

function getAtobInput(target, index) {
  const result = runCdp(['eval', target, `window.__weread_atob_b64[${index}]`]);
  if (!result.success || !result.output) return null;
  const b64 = result.output;
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
  return result.success ? result.output : '';
}

/**
 * 轮询等待 atob 数据就绪
 * @param {string} target
 * @param {number} timeoutSec - 超时秒数，默认 30
 * @param {boolean} verbose
 * @throws {Error} 超时时抛出
 */
export async function waitForData(target, timeoutSec = 30, verbose = false) {
  let waited = 0;
  while (waited < timeoutSec) {
    const count = getHookCount(target);
    if (count > 0) {
      if (verbose) console.log(`  atob 数据已就绪，记录数: ${count}`);
      return;
    }
    await sleep(1000);
    waited++;
  }

  if (verbose) {
    const hooked = runCdp(['eval', target, 'window.__weread_atob_hooked === true']);
    console.log(`  等待超时 (${waited}s)`);
    console.log(`  hook 已生效: ${hooked.success ? hooked.output : '无法检测'}`);
    console.log(`  可能原因: 页面加载缓慢、网络问题、或页面未使用 atob 解码章节`);
  }
  throw new Error(`等待 atob 数据超时 (${timeoutSec}s)`);
}

/**
 * 从 atob 记录中提取章节数据
 * @param {string} target
 * @param {object} options
 * @param {boolean} options.markdown - 是否转换为 Markdown
 * @param {boolean} options.verbose
 * @param {number} options.headingLevelShift - 标题层级偏移（默认 0，全书捕获时传 1）
 * @returns {{ html: string, markdown?: string, title: string, garbled: number, ctrl: number }}
 * @throws {Error} 未找到章节数据或 turndown 未安装时抛出
 */
export function extractChapterData(target, { markdown = false, verbose = false, headingLevelShift = 0 } = {}) {
  const countAfter = getHookCount(target);
  if (verbose) console.log(`atob 总记录数: ${countAfter}`);

  let chapterInput = null;
  let foundIndex = -1;

  for (let i = 0; i < countAfter; i++) {
    const input = getAtobInput(target, i);
    if (input && input.length > 500 && input.startsWith('PD94bWwg')) {
      chapterInput = input;
      foundIndex = i;
      break;
    }
  }

  if (!chapterInput) {
    const details = [];
    for (let i = 0; i < countAfter; i++) {
      const input = getAtobInput(target, i);
      if (input) {
        details.push(`  [${i}] len=${input.length} preview=${input.substring(0, 30)}`);
      }
    }
    throw new Error(`未找到章节 atob 调用\n已检查的 atob 调用:\n${details.join('\n')}`);
  }

  if (verbose) console.log(`  找到章节数据: index=${foundIndex}, base64长度=${chapterInput.length}`);

  const decoded = Buffer.from(chapterInput, 'base64');
  const html = decoded.toString('utf8');

  const garbled = (html.match(/\ufffd/g) || []).length;
  const ctrl = (html.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g) || []).length;

  if (verbose) {
    console.log(`  解码完成: ${decoded.length} 字节`);
    console.log(`  乱码(\uFFFD): ${garbled}`);
    console.log(`  控制字符: ${ctrl}`);
  }

  const title = getChapterTitle(target);
  if (!title && verbose) {
    console.warn('  警告: 未能提取章节标题（CSS 选择器可能已变更）');
  }

  const result = { html, title, garbled, ctrl };

  if (markdown) {
    if (!TurndownService) {
      throw new Error('turndown 库未安装，无法转换为 Markdown。请运行: npm install');
    }

    if (verbose) console.log('转换为 Markdown...');
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    });
    if (headingLevelShift > 0) {
      td.addRule('headingShift', {
        filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        replacement: function (content, node) {
          const level = parseInt(node.nodeName.charAt(1));
          const newLevel = Math.min(level + headingLevelShift, 6);
          return '\n\n' + '#'.repeat(newLevel) + ' ' + content + '\n\n';
        }
      });
    }
    td.addRule('preWithoutCode', {
      filter: function (node) {
        return node.nodeName.toUpperCase() === 'PRE' && !node.querySelector('code');
      },
      replacement: function (content, node) {
        return '\n\n```\n' + node.textContent.trimEnd() + '\n```\n\n';
      }
    });
    result.markdown = td.turndown(html);
    if (verbose) console.log(`  转换完成: ${result.markdown.length} 字符`);
  }

  return result;
}
