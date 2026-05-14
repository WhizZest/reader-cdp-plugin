# 微信读书专用插件

微信读书专用插件，基于chrome-cdp-skill开发，提供微信读书相关的自动化功能。

## 插件功能

本插件提供以下功能：

### extract-chapter - 章节提取

通过拦截页面 `atob` 调用获取章节原始 base64 数据，解码后输出为完整 HTML 文件（0 乱码）。

**功能特点**：
- 拦截页面 `atob` 调用，获取页面实际解码的 base64 数据
- 保留完整 HTML 结构（图片、代码块、格式等）
- 0 乱码、0 控制字符
- 默认重载页面以确保捕获到 atob 调用

**使用方法**：
```bash
node extract-chapter.mjs <target> <output-path> [options]
```

**参数**：
- `<target>`: Chrome DevTools Protocol 标签页ID
- `<output-path>`: 输出HTML文件的完整路径

**选项**：
- `-h, --help`: 显示详细用法
- `--no-reload`: 不重载页面（需提前注入 hook）
- `--markdown`: 输出 Markdown 格式（默认输出 HTML）
- `--verbose`: 显示详细输出

**示例**：
```bash
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.md --markdown
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html --verbose
```

**注意**：默认会重载页面以触发章节重新加载。如果不想重载，需提前通过其他方式注入 atob hook，然后使用 `--no-reload`。

### capture-book - 全书捕获

通过 atob Hook + 章节 URL 跳转方案获取全书内容。自动获取章节目录，按章节顺序跳转并逐章提取，输出为 Markdown 文件。

**功能特点**：
- atob Hook 拦截章节原始 HTML，保留完整结构（图片、代码块等）
- 自动从当前页面提取 book_id，或手动指定
- 自动获取章节目录，按章节 URL 跳转
- 断点续传：已提取的章节自动跳过
- 章节间随机延迟，避免触发反爬
- 合并输出全书 Markdown（标题层级自动调整）

**使用方法**：
```bash
node capture-book.mjs <target> <output-dir> [options]
```

**参数**：
- `<target>`: Chrome DevTools Protocol 标签页ID
- `<output-dir>`: 输出目录路径

**选项**：
- `-h, --help`: 显示详细用法
- `--book-id <id>`: 书籍 ID（如 b0132ec0813abb496g019430），不提供则从当前页面 URL 自动提取
- `--max-chapters <n>`: 最多提取 n 章（默认全部）
- `--delay <ms>`: 章节间延迟毫秒数（默认 2000）
- `--verbose`: 显示详细输出

**示例**：
```bash
node capture-book.mjs FCE786BC D:\output\book
node capture-book.mjs FCE786BC D:\output\book --book-id b0132ec0813abb496g019430
node capture-book.mjs FCE786BC D:\output\book --max-chapters 10 --delay 3000 --verbose
```

### list-chapters - 章节目录列表

列出当前书籍的完整章节目录，包含章节标题和 UID。

**功能特点**：
- 通过 CDP eval 执行 fetch 获取书籍主页数据
- 解析 `__INITIAL_STATE__` 提取章节目录
- 支持表格和 JSON 两种输出格式
- 轻量快速，无需重载页面

**使用方法**：
```bash
node list-chapters.mjs <target> [options]
```

**参数**：
- `<target>`: Chrome DevTools Protocol 标签页ID（需在微信读书书籍页面运行）

**选项**：
- `-h, --help`: 显示详细用法
- `--book-id <id>`: 书籍 ID，不提供则从当前页面 URL 自动提取
- `--json`: 输出 JSON 格式（默认表格）
- `--verbose`: 显示详细输出

**示例**：
```bash
node list-chapters.mjs 483DB8D1
node list-chapters.mjs 483DB8D1 --book-id b0132ec0813abb496g019430
node list-chapters.mjs 483DB8D1 --json
```

### navigate-chapter - 章节导航

通过 chapterUid 直接跳转到指定章节。

**功能特点**：
- 使用 `wr_hash` 算法自动构造章节 URL
- 底层 CDP nav 自动等待页面加载完成
- 导航后验证是否成功跳转到预期地址
- 超时自动输出诊断信息

**使用方法**：
```bash
node navigate-chapter.mjs <target> <chapterUid> [options]
```

**参数**：
- `<target>`: Chrome DevTools Protocol 标签页ID（需在微信读书书籍页面运行）
- `<chapterUid>`: 章节 UID（数字或字符串）

**选项**：
- `-h, --help`: 显示详细用法
- `--book-id <id>`: 书籍 ID，不提供则从当前页面 URL 自动提取
- `--verbose`: 显示详细输出

**示例**：
```bash
node navigate-chapter.mjs 483DB8D1 50
node navigate-chapter.mjs 483DB8D1 50 --book-id b0132ec0813abb496g019430
```

## 四种方案对比

| 特性 | extract-chapter | capture-book | list-chapters | navigate-chapter |
|------|----------------|--------------|---------------|------------------|
| 数据来源 | 拦截页面 atob 调用 | 拦截页面 atob 调用 | CDP eval fetch | CDP nav |
| 输出格式 | HTML / Markdown | Markdown | 表格 / JSON | 导航结果 |
| 乱码情况 | 无乱码 | 无乱码 | N/A | N/A |
| 捕获范围 | 单章节 | 全书 | 目录信息 | 单章跳转 |
| 速度 | 快（重载一次页面） | 较慢（需逐章跳转） | 快（一次 fetch） | 快（一次导航） |
| 保留格式 | 完整 HTML 结构 | 完整 Markdown（图片、代码块等） | N/A | N/A |

四种命令互补使用：extract-chapter 适合快速提取单章，capture-book 适合批量获取全书，list-chapters 适合浏览目录，navigate-chapter 适合手动跳转章节。

## 查看插件信息

```bash
node ../plugin.mjs --help
node ../plugin.mjs weread
node extract-chapter.mjs --help
node capture-book.mjs --help
node list-chapters.mjs --help
node navigate-chapter.mjs --help
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

#### atob Hook 原理

微信读书在渲染章节内容时，会调用 `window.atob` 对 base64 编码的 HTML 数据进行解码。通过 `Page.addScriptToEvaluateOnNewDocument` 注入持久化 hook，拦截 `atob` 调用并捕获其输入参数。

#### 数据流程

1. 注入 hook：`Page.addScriptToEvaluateOnNewDocument` 确保 hook 在每次页面加载时自动运行
2. 重载页面：`location.reload()` 触发章节重新加载
3. 捕获数据：hook 用 `btoa` 编码 `atob` 的输入并存入数组（避免 CDP eval 传输时的字符截断问题）
4. 识别章节：章节数据的 base64 以 `PD94bWwg`（`<?xml`）开头
5. 解码输出：`Buffer.from(input, 'base64')` 解码得到完整 HTML

#### 为什么 0 乱码

旧方案通过 CDP `Network.getResponseBody` 获取原始响应体，但页面 JS 在调用 `atob` 前会对响应体做额外处理（截断前缀、重排序片段），这些处理逻辑无法精确还原。新方案直接拦截 `atob` 调用，拿到页面真正解码的那份 base64 数据，从根本上消除了乱码。

### capture-book 技术细节

#### atob Hook + 章节 URL 跳转

与 `extract-chapter` 共用同一套 atob Hook 机制（`lib/atob-extract.mjs`），拦截 `window.atob` 调用获取章节原始 HTML。区别在于 capture-book 自动遍历全书所有章节。

#### 数据流程

1. 获取 book_id：从当前页面 URL 自动提取，或通过 `--book-id` 手动指定
2. 获取章节目录：CDP eval 执行 `fetch()` 获取书籍主页 HTML，括号计数法提取 `__INITIAL_STATE__` 中的 `chapterInfos`
3. 注入 Hook：`Page.addScriptToEvaluateOnNewDocument` 注入持久化 atob Hook
4. 逐章跳转：通过 `wr_hash(chapterUid)` 算法生成章节 URL，`cdp nav` 跳转
5. 提取内容：等待 atob 数据就绪 → 识别 `PD94bWwg` 前缀的章节记录 → base64 解码 → turndown 转 Markdown
6. 合并输出：以 `# 书名` 开头，各章标题降一级（`headingLevelShift: +1`），拼接为 `full-book.md`

#### wr_hash 算法

章节 URL 格式为 `https://weread.qq.com/web/reader/{book_id}k{wr_hash(chapterUid)}`。`wr_hash` 基于 MD5 和分段十六进制编码，实现在 `lib/wr-hash.mjs`。

#### 断点续传

每章独立输出文件 `<序号>-<chapterUid>.md`，提取前检查文件是否已存在且非空，存在则跳过。中断后重新运行自动从断点继续。

#### 反爬措施

章节间添加随机延迟（默认 2000ms ±20%），避免固定间隔被识别为机器行为。

## 相关文件

- `info.json`: 插件元数据
- `extract-chapter.mjs`: 章节提取脚本
- `capture-book.mjs`: 全书捕获脚本
- `list-chapters.mjs`: 章节目录列表脚本
- `navigate-chapter.mjs`: 章节导航脚本
- `lib/atob-extract.mjs`: atob Hook 和 CDP 工具函数
- `lib/wr-hash.mjs`: wr_hash 算法和章节 URL 构造
- `lib/book-info.mjs`: 书籍信息获取（bookId 提取、章节目录）
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

### capture-book book_id 提取失败

**原因**: 当前页面不是微信读书的书籍阅读页或书籍详情页

**解决**:
1. 在浏览器中打开目标书籍的任意章节
2. 或使用 `--book-id` 手动指定书籍 ID
3. 书架页面无法自动提取 book_id，必须使用 `--book-id`

### capture-book 章节提取超时

**原因**: atob 数据在 30 秒内未就绪，可能是网络慢或页面加载异常

**解决**:
1. 检查网络连接是否正常
2. 增加 `--delay` 参数值（如 3000）
3. 重新运行脚本（已提取的章节会自动跳过）

### 未登录微信读书

**原因**: 浏览器中微信读书未登录或登录已过期

**解决**:
1. 在浏览器中打开微信读书并登录
2. 登录后重新运行脚本

## 许可证

MIT License
