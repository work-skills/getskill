---
name: excel-report
description: Excel 报表生成技能：读取数据、透视汇总、生成带样式的 xlsx 报表。当用户需要生成 Excel 报表时使用。
---

# Excel Report

从原始数据快速生成带样式的 Excel 报表。

## 功能

- 读取 CSV / JSON / 数据库查询结果
- 分组汇总、透视表计算
- 输出带表头样式、冻结首行、自动列宽的 xlsx

## 使用方法

依赖 `openpyxl` 与 `pandas`：

```bash
pip install pandas openpyxl
```

### 生成报表

```python
import pandas as pd

df = pd.read_csv("sales.csv")
summary = df.groupby("region")["amount"].sum().reset_index()

with pd.ExcelWriter("report.xlsx", engine="openpyxl") as writer:
    summary.to_excel(writer, sheet_name="汇总", index=False)
    df.to_excel(writer, sheet_name="明细", index=False)
```

### 添加样式

```python
from openpyxl.styles import Font, PatternFill

ws = writer.sheets["汇总"]
for cell in ws[1]:
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor="4F6EF7")
ws.freeze_panes = "A2"
```

## 注意事项

- 超过 100 万行请改用 CSV 或分 sheet 输出
- 日期列先转 `pd.to_datetime` 再写入，避免格式错乱