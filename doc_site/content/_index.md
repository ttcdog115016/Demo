---
title: Open-PETs 使用手冊
layout: hextra-home
---

{{< hextra/hero-badge >}}
  <span>v2.0.0・單一映像檔・本地／內網</span>
{{< /hextra/hero-badge >}}

<div class="hx:mt-6 hx:mb-6">
{{< hextra/hero-headline >}}
  Open-PETs&nbsp;<br class="hx:sm:block hx:hidden" />資料隱私保護技術套件
{{< /hextra/hero-headline >}}
</div>

<div class="hx:mb-12">
{{< hextra/hero-subtitle >}}
  用瀏覽器完成資料去識別化：K-匿名化與差分隱私，&nbsp;<br class="hx:sm:block hx:hidden" />處理後模擬再識別攻擊評估風險，產出檢測報告。
{{< /hextra/hero-subtitle >}}
</div>

<div class="hx:mb-6">
{{< hextra/hero-button text="新手快速上手" link="docs/quickstart" >}}
</div>

<div class="hx:mt-6"></div>

{{< hextra/feature-grid >}}
  {{< hextra/feature-card
    title="新手快速上手"
    icon="server"
    subtitle="不熟指令也能裝：選本地或內網，用問答式小工具安裝並隨時切換模式。"
    link="docs/quickstart"
  >}}
  {{< hextra/feature-card
    title="前端操作說明"
    icon="cursor-click"
    subtitle="四個步驟完成一次去識別化，處理紀錄與交付，以及管理員的帳號管理。"
    link="docs/frontend"
  >}}
  {{< hextra/feature-card
    title="API 使用說明"
    icon="code"
    subtitle="登入與憑證、端點總覽、curl 與 Python 呼叫範例、錯誤格式。"
    link="docs/api"
  >}}
  {{< hextra/feature-card
    title="命令列使用說明"
    icon="terminal"
    subtitle="在容器內批次執行去識別化、風險評估、產生報告與帳號維護。"
    link="docs/cli"
  >}}
  {{< hextra/feature-card
    title="常見問題"
    icon="question-mark-circle"
    subtitle="埠被占用、400、上傳 413、容器不健康、校驗碼對不上、帳號鎖定等狀況的處理方式。"
    link="docs/faq"
  >}}
  {{< hextra/feature-card
    title="資料不離開主機"
    icon="shield-check"
    subtitle="所有運算在部署主機上進行；處理紀錄只保存設定與結果摘要，不保存原始資料。"
  >}}
{{< /hextra/feature-grid >}}
