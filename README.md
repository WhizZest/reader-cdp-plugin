# 微信读书章节提取工具

## 功能

自动提取微信读书当前章节内容并转换为HTML文件。

## 使用方法

### 基本用法

```bash
node extract-chapter.mjs <target> <output-path>
```

### 参数说明

- `<target>`: Chrome DevTools Protocol 标签页ID
- `<output-path>`: 输出HTML文件的完整路径

### 选项

- `--keep-fragments`: 保留中间片段文件（e0.txt, e1.txt, e3.txt）
- `--verbose`: 显示详细输出

### 示例

```bash
# 基本用法
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html

# 保留片段文件
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html --keep-fragments

# 详细输出
node extract-chapter.mjs 9AC2EE05 D:\output\chapter1.html --verbose
```

## 工作流程

1. **获取章节请求**: 从Chrome网络请求中识别章节片段请求（e0, e1, e3）
2. **提取响应体**: 使用CDP提取每个片段的响应体
3. **解码片段**: 自动检测最佳跳过字符数，解码Base64内容
4. **合并HTML**: 将解码后的片段合并为完整的HTML文件
5. **清理临时文件**: 默认删除中间片段文件

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

2. **微信读书页面**: 在Chrome中打开微信读书页面并加载章节内容

3. **获取标签页ID**: 使用cdp工具获取标签页ID
   ```bash
   node ../cdp.mjs ls
   ```

**前置条件仓库**: [chrome-cdp-skill](https://github.com/WhizZest/chrome-cdp-skill.git)

## 技术细节

### 响应体格式

微信读书的章节响应体格式：
- 前32字符：十六进制前缀（可能用于校验）
- 第33字符：标记字符
- 后续内容：Base64编码的HTML内容

### 解码策略

脚本会自动尝试不同的跳过字符数（30-35），选择乱码最少的解码方式。通常最佳跳过字符数为33。

### 乱码问题

解码后的HTML文件可能包含少量乱码（通常少于20个），这些乱码主要出现在：
- HTML属性中的特殊字符
- 某些UTF-8编码的特殊字符

这些乱码不影响正文内容的阅读。

## 相关文件

- `extract-chapter.mjs`: 主脚本
- `../cdp.mjs`: Chrome DevTools Protocol CLI工具

## 注意事项

1. 确保Chrome浏览器已启用远程调试模式
2. 确保微信读书页面已加载章节内容（需要滚动页面触发加载）
3. 如果提取失败，尝试刷新页面或重新加载章节
4. 输出目录会自动创建，无需手动创建

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
