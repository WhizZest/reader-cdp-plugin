#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CDP_SCRIPT = resolve(__dirname, '..', 'cdp.mjs');

function printUsage() {
    console.log(`
微信读书章节提取工具

用法:
  node extract-chapter.mjs <target> <output-path> [options]

参数:
  <target>       标签页ID（Chrome DevTools Protocol target ID）
  <output-path>  输出HTML文件的完整路径

选项:
  --keep-fragments  保留中间片段文件（e0.txt, e1.txt, e3.txt），便于调试
  --verbose         显示详细输出

示例:
  node extract-chapter.mjs 9AC2EE05 D:\\output\\chapter1.html
  node extract-chapter.mjs 9AC2EE05 D:\\output\\chapter1.html --keep-fragments
  node extract-chapter.mjs 9AC2EE05 D:\\output\\chapter1.html --verbose

说明:
  1. 自动提取当前章节的响应体片段（e0, e1, e3）
  2. 解码片段（跳过固定字符数）
  3. 合并为完整的HTML文件
  4. 使用--keep-fragments保留片段文件，便于调试问题
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
    const keepFragments = args.includes('--keep-fragments');
    const verbose = args.includes('--verbose');

    return { target, outputPath, keepFragments, verbose };
}

function getResponseBody(target, requestId, savePath) {
    if (savePath) {
        const cmd = `node "${CDP_SCRIPT}" net ${target} ${requestId} --body --raw --save "${savePath}"`;
        try {
            execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
            return readFileSync(savePath, 'utf8');
        } catch (error) {
            if (verbose) {
                console.error(`提取响应体失败: ${error.message}`);
            }
            return null;
        }
    } else {
        const cmd = `node "${CDP_SCRIPT}" net ${target} ${requestId} --body --raw`;
        try {
            const output = execSync(cmd, { encoding: 'utf8' });
            return output;
        } catch (error) {
            if (verbose) {
                console.error(`提取响应体失败: ${error.message}`);
            }
            return null;
        }
    }
}

function getChapterRequests(target) {
    const cmd = `node "${CDP_SCRIPT}" net ${target}`;
    try {
        const output = execSync(cmd, { encoding: 'utf8' });
        const lines = output.split('\n');
        const chapterRequests = [];

        for (const line of lines) {
            if (line.includes('chapter/e_')) {
                const match = line.match(/\[(\d+)\].*chapter\/e_(\d)/);
                if (match) {
                    const requestId = match[1];
                    const fragmentType = match[2];
                    chapterRequests.push({ requestId, fragmentType });
                }
            }
        }

        return chapterRequests;
    } catch (error) {
        console.error(`获取章节请求失败: ${error.message}`);
        return [];
    }
}

function decodeFragment(content, skip) {
    const b64 = content.substring(skip);
    const bytes = Buffer.from(b64, 'base64');
    return bytes.toString('utf8');
}

function findBestSkip(content) {
    let bestSkip = 33;
    let minGarbled = Infinity;
    
    for (let skip = 30; skip <= 35; skip++) {
        const b64 = content.substring(skip);
        try {
            const bytes = Buffer.from(b64, 'base64');
            const decoded = bytes.toString('utf8');
            const garbled = (decoded.match(/\ufffd/g) || []).length;
            
            if (garbled < minGarbled) {
                minGarbled = garbled;
                bestSkip = skip;
            }
        } catch (e) {
        }
    }
    
    return bestSkip;
}

function extractChapter(target, outputPath, keepFragments, verbose) {
    console.log('=== 微信读书章节提取工具 ===\n');

    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    console.log(`目标标签页: ${target}`);
    console.log(`输出文件: ${outputPath}\n`);

    console.log('步骤1: 获取章节请求...');
    const chapterRequests = getChapterRequests(target);

    if (chapterRequests.length === 0) {
        console.error('错误: 未找到章节请求');
        console.error('请确保已打开微信读书页面并加载了章节内容');
        process.exit(1);
    }

    if (verbose) {
        console.log('找到的章节请求:');
        chapterRequests.forEach(req => {
            console.log(`  - 请求ID: ${req.requestId}, 片段类型: e${req.fragmentType}`);
        });
    }

    const e0Request = chapterRequests.findLast(r => r.fragmentType === '0');
    const e1Request = chapterRequests.findLast(r => r.fragmentType === '1');
    const e3Request = chapterRequests.findLast(r => r.fragmentType === '3');

    if (!e0Request || !e1Request || !e3Request) {
        console.error('\n错误: 缺少必要的片段请求');
        console.error(`  e0: ${e0Request ? '✓' : '✗'}`);
        console.error(`  e1: ${e1Request ? '✓' : '✗'}`);
        console.error(`  e3: ${e3Request ? '✓' : '✗'}`);
        console.error('\n可能的原因:');
        console.error('  1. 页面未加载章节内容');
        console.error('  2. 网络请求缓存已清空');
        console.error('\n解决方法:');
        console.error('  1. 刷新微信读书页面');
        console.error('  2. 在页面中翻页或滚动，触发章节加载');
        console.error('  3. 等待章节内容完全加载后重新运行脚本');
        process.exit(1);
    }

    console.log('\n步骤2: 提取响应体片段...');
    
    let e0Path = null, e1Path = null, e3Path = null;
    let tempDir = null;
    
    if (keepFragments) {
        tempDir = resolve(outputDir, '.temp_fragments');
        if (!existsSync(tempDir)) {
            mkdirSync(tempDir, { recursive: true });
        }
        e0Path = resolve(tempDir, 'e0.txt');
        e1Path = resolve(tempDir, 'e1.txt');
        e3Path = resolve(tempDir, 'e3.txt');
    }

    const e0Content = getResponseBody(target, e0Request.requestId, e0Path);
    const e1Content = getResponseBody(target, e1Request.requestId, e1Path);
    const e3Content = getResponseBody(target, e3Request.requestId, e3Path);

    if (!e0Content || !e1Content || !e3Content) {
        console.error('错误: 提取响应体失败');
        process.exit(1);
    }

    console.log('  ✓ e0片段已提取');
    console.log('  ✓ e1片段已提取');
    console.log('  ✓ e3片段已提取');

    console.log('\n步骤3: 解码片段...');
    if (verbose) {
        console.log(`  e0文件大小: ${e0Content.length} 字节`);
        console.log(`  e1文件大小: ${e1Content.length} 字节`);
        console.log(`  e3文件大小: ${e3Content.length} 字节`);
        console.log(`  e0前缀: ${e0Content.substring(0, 32)}`);
        console.log(`  e1前缀: ${e1Content.substring(0, 32)}`);
        console.log(`  e3前缀: ${e3Content.substring(0, 32)}`);
    }

    const e0Skip = findBestSkip(e0Content);
    const e1Skip = findBestSkip(e1Content);
    const e3Skip = findBestSkip(e3Content);

    if (verbose) {
        console.log(`  e0最佳跳过: ${e0Skip} 字符`);
        console.log(`  e1最佳跳过: ${e1Skip} 字符`);
        console.log(`  e3最佳跳过: ${e3Skip} 字符`);
    }

    const e0Decoded = decodeFragment(e0Content, e0Skip);
    const e1Decoded = decodeFragment(e1Content, e1Skip);
    const e3Decoded = decodeFragment(e3Content, e3Skip);

    console.log(`  ✓ e0解码完成: ${e0Decoded.length} 字符`);
    console.log(`  ✓ e1解码完成: ${e1Decoded.length} 字符`);
    console.log(`  ✓ e3解码完成: ${e3Decoded.length} 字符`);

    console.log('\n步骤4: 合并为HTML文件...');
    const fullContent = e0Decoded + e1Decoded + e3Decoded;
    const garbledCount = (fullContent.match(/\ufffd/g) || []).length;

    writeFileSync(outputPath, fullContent, 'utf8');

    console.log(`  ✓ HTML文件已保存: ${outputPath}`);
    console.log(`  ✓ 总大小: ${fullContent.length} 字符`);
    console.log(`  ✓ 乱码数: ${garbledCount}`);

    if (keepFragments && tempDir) {
        console.log(`\n片段文件已保存到: ${tempDir}`);
        console.log('  - e0.txt');
        console.log('  - e1.txt');
        console.log('  - e3.txt');
        console.log('  请手动删除临时文件');
    }

    console.log('\n=== 提取完成 ===');
    console.log(`\nHTML文件路径: ${outputPath}`);
    console.log(`文件大小: ${fullContent.length} 字符`);
    console.log(`乱码数量: ${garbledCount}`);

    return {
        success: true,
        outputPath,
        size: fullContent.length,
        garbledCount
    };
}

const args = process.argv.slice(2);
const { target, outputPath, keepFragments, verbose } = parseArgs(args);

extractChapter(target, outputPath, keepFragments, verbose);
