---
name: pdf-toolkit
description: PDF 文档处理技能：提取文本、合并拆分、页面旋转与加水印。当用户需要处理 PDF 文件时使用。
---

# PDF Toolkit

处理 PDF 文件的常用操作集合。

## 功能

- **提取文本**：从 PDF 中提取纯文本，支持按页范围提取
- **合并 / 拆分**：将多个 PDF 合并为一个，或按页拆分成多个文件
- **页面操作**：旋转、删除、重排页面
- **加水印**：为每页添加文字水印

## 使用方法

依赖 Python 库 `pypdf`：

```bash
pip install pypdf
```

### 提取文本

```python
from pypdf import PdfReader

reader = PdfReader("input.pdf")
text = "\n".join(page.extract_text() for page in reader.pages)
```

### 合并 PDF

```python
from pypdf import PdfWriter

writer = PdfWriter()
for path in ["a.pdf", "b.pdf"]:
    writer.append(path)
writer.write("merged.pdf")
writer.close()
```

## 注意事项

- 扫描版 PDF 无法直接提取文本，需先做 OCR
- 加密 PDF 需先调用 `reader.decrypt(password)`