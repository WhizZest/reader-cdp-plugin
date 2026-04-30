# 微信读书专用插件

微信读书专用插件，基于chrome-cdp-skill开发，提供微信读书相关的自动化功能。

## 插件功能

本插件提供以下功能：

### extract-chapter - 章节提取

从网络请求中提取微信读书当前章节内容，解码后输出为HTML文件。

**功能特点**：
- 自动提取章节片段（e0, e1, e3）
- 自动解码和合并内容
- 支持调试模式查看中间文件
- 智能选择最佳解码参数

**使用方法**：
```bash
node extract-chapter.mjs <target> <output-path> [options]
```

**参数**：
- `<target>`: Chrome DevTools Protocol 标签页ID
- `<output-path>`: 输出HTML文件的完整路径

**选项**：
- `-h, --help`: 显示详细用法
- `--keep-fragments`: 保留中间片段文件（e0.txt, e1.txt, e3.txt）
- `--verbose`: 显示详细输出

**示例**：
```bash
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html --keep-fragments
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html --verbose
```

**注意**：解码后的HTML文件可能包含少量乱码，如需无乱码内容请使用 capture-book。

### capture-book - 全书捕获

通过Canvas fillText Hook捕获浏览器渲染文本，逐页翻页获取全书内容，输出为无乱码Markdown文件。

**功能特点**：
- Canvas fillText Hook捕获渲染后文本，天然无乱码
- 自动识别标题层级（h1-h4）和加粗文本
- 支持左右双Canvas布局
- 内容去重和重复页检测
- 自动检测书末（"已读完"）

**使用方法**：
```bash
node capture-book.mjs <target> <output-dir> --start-url <url> [options]
```

**参数**：
- `<target>`: Chrome DevTools Protocol 标签页ID
- `<output-dir>`: 输出目录路径

**选项**：
- `-h, --help`: 显示详细用法
- `--start-url <url>`: 书籍开头的URL（必填）
- `--max-pages <n>`: 最多翻n页（默认500）
- `--delay <ms>`: 翻页间隔毫秒数（默认2500）

**示例**：
```bash
node capture-book.mjs FCE786BC D:\output\book --start-url "https://weread.qq.com/web/reader/b0132ec0813abb496g019430kc0c320a0232c0c7c76d365a"
node capture-book.mjs FCE786BC D:\output\book --start-url "https://weread.qq.com/web/reader/b0132ec0813abb496g019430kc0c320a0232c0c7c76d365a" --max-pages 100 --delay 1500
```

**获取书籍开头URL**：
1. 在微信读书中打开目标书籍
2. 跳转到书籍开头（第一页）
3. 复制浏览器地址栏中的URL作为 `--start-url` 参数

## 两种方案对比

| 特性 | extract-chapter | capture-book |
|------|----------------|--------------|
| 数据来源 | 网络请求响应体 | Canvas渲染文本 |
| 输出格式 | HTML | Markdown |
| 乱码情况 | 可能有少量乱码 | 无乱码 |
| 捕获范围 | 单章节 | 全书 |
| 速度 | 快（无需翻页） | 慢（需逐页翻页） |
| 保留格式 | 原始HTML结构 | 标题层级+加粗 |

两种方案互补使用：extract-chapter 适合快速提取单章，capture-book 适合需要无乱码全文的场景。

## 查看插件信息

```bash
node ../plugin.mjs --help
node ../plugin.mjs weread
node extract-chapter.mjs --help
node capture-book.mjs --help
```

## 前置条件

1. **Chrome浏览器**: 需要启用远程调试模式
   ```bash
   chrome.exe --remote-debugging-port=9222
   ```

2. **微信读书页面**: 在Chrome中打开微信读书页面

3. **获取标签页ID**: 使用cdp工具获取标签页ID
   ```bash
   node ../../cdp.mjs list
   ```

**前置条件仓库**: [chrome-cdp-skill](https://github.com/WhizZest/chrome-cdp-skill.git)

## 技术细节

### extract-chapter 技术细节

#### 响应体格式

微信读书的章节响应体格式：
- 前32字符：十六进制前缀（可能用于校验）
- 第33字符：标记字符
- 后续内容：Base64编码的HTML内容

#### 解码策略

脚本会自动尝试不同的跳过字符数（30-35），选择乱码最少的解码方式。通常最佳跳过字符数为33。

#### 乱码问题

解码后的HTML文件可能包含少量乱码，这些乱码主要出现在HTML属性中的特殊字符和某些UTF-8编码的特殊字符，不影响正文内容的阅读。

### capture-book 技术细节

#### Canvas Hook原理

微信读书使用Canvas渲染书籍内容（文字保护措施）。通过Hook `CanvasRenderingContext2D.prototype.fillText` 方法，捕获每次渲染的文本及其坐标信息。

#### 文本处理流程

1. **去重**：基于文本+坐标+Canvas索引的唯一键去重
2. **排序**：按Y坐标分行，行内按X坐标排序
3. **分类**：根据字体大小和粗细识别标题层级（h1-h4）和加粗文本
4. **格式化**：转换为Markdown格式

#### 翻页机制

使用CDP的 `Input.dispatchKeyEvent` 发送键盘事件（ArrowRight），模拟用户翻页操作。每次翻页后等待渲染完成再捕获内容。

#### 章节编码

微信读书URL中的章节编码是加密的，无法从chapterUid直接推导。因此需要用户提供书籍开头的URL作为起点。

## 相关文件

- `info.json`: 插件元数据
- `extract-chapter.mjs`: 章节提取脚本
- `capture-book.mjs`: 全书捕获脚本
- `../plugin.mjs`: 插件管理工具
- `../../cdp.mjs`: Chrome DevTools Protocol CLI工具

## 注意事项

1. 确保Chrome浏览器已启用远程调试模式
2. 确保微信读书页面已加载章节内容（需要滚动页面触发加载）
3. 如果提取失败，尝试刷新页面或重新加载章节
4. 输出目录会自动创建，无需手动创建
5. **新增脚本时，需要更新info.json文件**，在features数组中添加新脚本的元数据

## 故障排除

### 错误: 未找到章节请求

**原因**: 微信读书页面未加载章节内容

**解决**:
1. 在微信读书页面中滚动或翻页
2. 等待章节内容加载完成
3. 重新运行脚本

### 错误: 提取响应体失败

**原因**: 网络请求缓存被清空

**解决**:
1. 刷新微信读书页面
2. 重新加载章节内容
3. 重新运行脚本

### capture-book 首页内容为空

**原因**: resize事件未触发Canvas重绘

**解决**:
1. 检查页面是否完全加载
2. 增加导航后的等待时间
3. 手动在页面上操作触发重绘后重新运行

### capture-book 翻页后无内容

**原因**: 翻页间隔太短，页面未渲染完成

**解决**:
1. 增加 `--delay` 参数值（如3000）
2. 检查网络连接是否正常

## 许可证

MIT License
