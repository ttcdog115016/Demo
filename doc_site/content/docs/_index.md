---
title: 概覽
weight: 1
---

Open-PETs 是一套資料去識別化工具。它提供 K-匿名化與差分隱私兩種保護方式，處理完會模擬再識別攻擊並評估風險，最後產出可交付的資料和檢測報告。

線上版部署在一台主機上，使用者用瀏覽器連線操作。所有運算都在這台主機進行，資料不會傳到其他地方。

{{< callout type="info" >}}
本網站是線上版的先行實作文件。前端原始碼在 GitHub [`ttcdog115016/Demo`](https://github.com/ttcdog115016/Demo)；日後正式線上版會改放到甲方的 GitHub 帳號。
{{< /callout >}}

## 文件導覽

{{< cards >}}
  {{< card link="deploy" title="部署教學" icon="server" subtitle="IT／維運人員：建置、啟動、對外開放、更新、備份" >}}
  {{< card link="frontend" title="前端操作說明" icon="cursor-click" subtitle="所有使用者、管理員：四步驟去識別化與帳號管理" >}}
  {{< card link="api" title="API 使用說明" icon="code" subtitle="系統整合、開發人員：端點與呼叫範例" >}}
  {{< card link="cli" title="命令列使用說明" icon="terminal" subtitle="IT 人員：批次作業與帳號維護" >}}
  {{< card link="faq" title="常見問題" icon="question-mark-circle" subtitle="部署與使用時的常見狀況" >}}
{{< /cards >}}

## 架構

線上版由兩個 Docker 容器組成：

```text
使用者瀏覽器
    │  http://<主機>:8080
    ▼
前端容器 open-pets-web（nginx，埠 8080）
    │  網頁畫面；/api/ 開頭的請求轉給後端
    ▼
後端容器 open-pets（FastAPI，埠 8000，只接受本機連線）
    │  去識別化運算、帳號、稽核紀錄
    ▼
C:\open-pets-data   帳號資料庫、處理紀錄、稽核紀錄
C:\open-pets\.env   鹽值與金鑰
```

| 元件 | 來源 | 容器名稱 | 埠 |
| --- | --- | --- | --- |
| 前端 | GitHub `ttcdog115016/Demo` | `open-pets-web` | 8080 |
| 後端 | 交付套件 `01_程式原始碼`（v2.0.0） | `open-pets` | 127.0.0.1:8000 |

## 使用需求

- 使用者：Chrome、Edge 或 Firefox 的最新版本。
- 單次上傳上限 1 GB，最多 50 個欄位。
- 部署主機：Windows 10／11 與 Docker Desktop，詳見[部署教學](deploy/)。

## 帳號

- 系統沒有預設帳號。部署時用命令建立第一個管理員（Admin），見[部署教學](deploy/#5-建立第一個管理員)。
- 一般使用者（User）由管理員在「系統設定 → 帳號與權限管理」建立，系統不開放自行註冊。
- 基於權責分離，Admin 管理帳號與設定，User 執行去識別化作業。

## 資料存放位置

| 主機路徑 | 內容 |
| --- | --- |
| `C:\open-pets\.env` | 設定檔，含雜湊鹽值與金鑰 |
| `C:\open-pets-data\users.db` | 帳號資料庫 |
| `C:\open-pets-data\system.db` | 處理紀錄、系統設定、介面偏好 |
| `C:\open-pets-data\audit.jsonl` | 稽核紀錄，具簽章，可驗證是否被竄改 |

- 去識別化結果、設定檔、檢測報告由使用者從瀏覽器下載，存在使用者自己的電腦。
- 更新或重建容器不會影響這些資料。

{{< callout type="warning" >}}
**請務必備份 `.env`，並當作機密保管。** `.env` 裡的 `OPEN_PETS_DEFAULT_SALT` 是雜湊用的鹽值。鹽值遺失或變更後，新的雜湊結果就對不上以前的資料。
{{< /callout >}}
