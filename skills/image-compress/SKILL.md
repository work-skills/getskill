---
name: image-compress
description: 图片压缩与格式转换技能：批量压缩 PNG/JPG、转 WebP、生成缩略图。当用户需要优化图片体积时使用。
---

# Image Compress

批量图片压缩与格式转换。

## 功能

- 批量压缩 PNG / JPG（可控质量）
- 转换为 WebP / AVIF 格式
- 按最长边生成缩略图
- 保留 EXIF 或按需剥离

## 使用方法

依赖 `Pillow`：

```bash
pip install Pillow
```

### 批量转 WebP

```python
from pathlib import Path
from PIL import Image

for p in Path("images").glob("*.jpg"):
    img = Image.open(p)
    img.save(p.with_suffix(".webp"), "WEBP", quality=82, method=6)
```

### 生成缩略图

```python
img = Image.open("photo.jpg")
img.thumbnail((800, 800))
img.save("photo_thumb.jpg", quality=85, optimize=True)
```

## 注意事项

- WebP quality 建议 75–85，肉眼几乎无损
- 含透明通道的 PNG 转 JPG 前需先铺白底
- 处理前备份原图，压缩为有损操作