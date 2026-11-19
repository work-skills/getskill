---
name: web-scraper
description: 网页抓取技能：抓取页面、解析结构化数据、导出 CSV/JSON，内置限速与重试。当用户需要采集网页数据时使用。
---

# Web Scraper

轻量网页数据采集流程。

## 功能

- 抓取静态页面并解析 HTML
- CSS 选择器提取结构化字段
- 导出 CSV / JSON
- 请求限速、失败重试、UA 设置

## 使用方法

依赖 `requests` 与 `beautifulsoup4`：

```bash
pip install requests beautifulsoup4
```

### 抓取示例

```python
import time
import requests
from bs4 import BeautifulSoup

def fetch(url, retries=3):
    for i in range(retries):
        try:
            r = requests.get(url, timeout=10,
                             headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            return r.text
        except requests.RequestException:
            time.sleep(2 ** i)
    return None

soup = BeautifulSoup(fetch("https://example.com"), "html.parser")
items = [
    {"title": a.get_text(strip=True), "url": a["href"]}
    for a in soup.select("a.item-link")
]
```

## 注意事项

- 遵守目标站点 robots.txt 与服务条款
- 每次请求间隔至少 1 秒，避免对目标站点造成压力
- 动态渲染页面需改用浏览器自动化方案