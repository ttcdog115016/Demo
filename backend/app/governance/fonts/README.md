# PDF 報告內建字型

`NotoSansTC-Regular.ttf` 隨程式一併發布，供 `app/governance/report.py` 產出中文 PDF 報告使用。
報告不依賴部署環境是否安裝中文字型，在 Linux 或容器中同樣產得出中文報告。

## 來源與授權

- 字型：Noto Sans TC（繁體中文）
- 授權：SIL Open Font License 1.1，全文見同目錄 `OFL.txt`（允許商用與再散布，散布時須附授權全文）
- 原始檔：<https://github.com/google/fonts/blob/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf>

## 產製方式

原始檔為可變字型，其預設粗細為 Thin（極細），直接嵌入報告會過淡而不利閱讀，
故取其 Regular（wght=400）產生固定粗細的字型檔後納入版本庫：

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

f = TTFont("NotoSansTC[wght].ttf")
instancer.instantiateVariableFont(f, {"wght": 400}, updateFontNames=True, inplace=True)
f.save("NotoSansTC-Regular.ttf")
```

粗體樣式沿用同一個字型檔；若需要真正的粗體，
另以 `wght=700` 產生一份字型檔並於 `report.py` 中分別註冊即可。
