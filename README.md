# 微信读书专用插件

微信读书专用插件，基于chrome-cdp-skill开发，提供微信读书相关的自动化功能。

## 插件功能

本插件提供以下功能：

### extract-chapter - 章节提取

提取微信读书当前章节内容并转换为HTML文件。

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
# 基本用法
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html

# 保留片段文件（调试用）
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html --keep-fragments

# 详细输出
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html --verbose
```

## 查看插件信息

```bash
# 查看所有可用插件
node ../plugin.mjs --help

# 查看微信读书插件详情
node ../plugin.mjs weread

# 查看脚本详细用法
node extract-chapter.mjs --help
```

## 前置条件

1. **Chrome浏览器**: 需要启用远程调试模式
   ```bash
   # Windows
   chrome.exe --remote-debugging-port=9222
   
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   
   # Linux
   google-chrome --remote-debugging-port=9222
   ```

2. **微信读书页面**: 在Chrome中打开微信读书页面

3. **获取标签页ID**: 使用cdp工具获取标签页ID
   ```bash
   node ../cdp.mjs list
   ```

**前置条件仓库**: [chrome-cdp-skill](https://github.com/WhizZest/chrome-cdp-skill.git)

## 技术细节

### 章节提取技术细节

#### 响应体格式

微信读书的章节响应体格式：
- 前32字符：十六进制前缀（可能用于校验）
- 第33字符：标记字符
- 后续内容：Base64编码的HTML内容

#### 解码策略

脚本会自动尝试不同的跳过字符数（30-35），选择乱码最少的解码方式。通常最佳跳过字符数为33。

#### 乱码问题

解码后的HTML文件可能包含少量乱码（通常少于20个），这些乱码主要出现在：
- HTML属性中的特殊字符
- 某些UTF-8编码的特殊字符

这些乱码不影响正文内容的阅读。

## 相关文件

- `info.json`: 插件元数据
- `extract-chapter.mjs`: 章节提取脚本
- `../plugin.mjs`: 插件管理工具
- `../cdp.mjs`: Chrome DevTools Protocol CLI工具

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

### 乱码过多

**原因**: 解码参数不正确

**解决**:
1. 使用`--verbose`选项查看解码参数
2. 检查跳过字符数是否正确
3. 如果问题持续，提交issue并附上详细输出

## 许可证

MIT License
