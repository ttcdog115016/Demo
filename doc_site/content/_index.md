---
title: Open-PETs 線上版文件
layout: hextra-home
---

{{< hextra/hero-badge >}}
  <span>後端 v2.0.2・線上版</span>
{{< /hextra/hero-badge >}}

<div class="hx:mt-6 hx:mb-6">
{{< hextra/hero-headline >}}
  Open-PETs&nbsp;<br class="hx:sm:block hx:hidden" />資料隱私保護技術套件
{{< /hextra/hero-headline >}}
</div>

<div class="hx:mb-12">
{{< hextra/hero-subtitle >}}
  用瀏覽器完成資料去識別化：K-匿名化與差分隱私，&nbsp;<br class="hx:sm:block hx:hidden" />處理後模擬再識別攻擊評估風險，產出合規報告。
{{< /hextra/hero-subtitle >}}
</div>

<div class="hx:mb-6">
{{< hextra/hero-button text="開始部署" link="docs/deploy" >}}
</div>

<div class="hx:mt-6"></div>

{{< hextra/feature-grid >}}
  {{< hextra/feature-card
    title="部署教學"
    icon="server"
    subtitle="從 GitHub 取得前端，用 Docker Desktop 建置啟動、對外開放、更新與備份。"
    link="docs/deploy"
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
    subtitle="登入與權杖、端點總覽、curl 與 Python 呼叫範例、錯誤格式。"
    link="docs/api"
  >}}
  {{< hextra/feature-card
    title="命令列使用說明"
    icon="terminal"
    subtitle="在後端容器內批次執行去識別化、風險評估、產生報告與帳號維護。"
    link="docs/cli"
  >}}
  {{< hextra/feature-card
    title="常見問題"
    icon="question-mark-circle"
    subtitle="502、登入 503、上傳 413、埠被占用、帳號鎖定等狀況的處理方式。"
    link="docs/faq"
  >}}
  {{< hextra/feature-card
    title="資料不離開主機"
    icon="shield-check"
    subtitle="所有運算在部署主機上進行；處理紀錄只保存設定與結果摘要，不保存原始資料。"
  >}}
{{< /hextra/feature-grid >}}
