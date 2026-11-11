---
title: 概覽
weight: 1
---

Open-PETs 是一套資料去識別化工具。它提供 K-匿名化與差分隱私兩種保護方式，處理完會模擬再識別攻擊並評估風險，最後產出可交付的資料和檢測報告。

Open-PETs 以單一 Docker 映像檔交付，裝在一台電腦或主機上，使用者用瀏覽器連線操作。所有運算都在這台主機進行，資料不會傳到其他地方。同一份映像檔有三種模式：**本地**（一台電腦，預設）、**內網**（同一個內網的多台電腦，內建 HTTPS）、**線上**（以對外網域提供服務），見[安裝教學第 8 節](deploy/#8-三種模式本地線上內網)。

{{< callout type="info" >}}
前端與後端原始碼都在 GitHub [`ttcdog115016/Demo`](https://github.com/ttcdog115016/Demo)（後端在 `backend/`）；日後正式上線會改放到甲方的 GitHub 帳號，移轉方式見[安裝教學](deploy/#14-移轉到甲方-github-帳號)。
{{< /callout >}}

## 文件導覽

{{< cards >}}
  {{< card link="deploy" title="安裝教學" icon="server" subtitle="IT／維運人員：三種取得方式、啟動、對外開放、更新、備份" >}}
  {{< card link="frontend" title="前端操作說明" icon="cursor-click" subtitle="所有使用者、管理員：四步驟去識別化與帳號管理" >}}
  {{< card link="api" title="API 使用說明" icon="code" subtitle="系統整合、開發人員：端點與呼叫範例" >}}
  {{< card link="cli" title="命令列使用說明" icon="terminal" subtitle="IT 人員：批次作業與帳號維護" >}}
  {{< card link="faq" title="常見問題" icon="question-mark-circle" subtitle="部署與使用時的常見狀況" >}}
{{< /cards >}}

## 架構

前端與後端合在**同一個容器、同一個埠（8080）**：

```text
使用者瀏覽器
    │  http://<主機>:8080（對外開放時前面放反向代理，改走 https）
    ▼
容器 open-pets（埠 8080）
    │  網頁畫面（前端）＋去識別化運算、帳號、稽核紀錄（後端）
    ▼
Docker 磁碟區 open-pets-data   帳號資料庫、處理紀錄、稽核紀錄、自動產生的金鑰
```

映像檔有三種取得方式，內容是同一個版本：

| 方式 | 說明 |
| --- | --- |
| 容器映像檔（GHCR） | `ghcr.io/ttcdog115016/open-pets-app:<版本>`，有網路時用 `docker compose pull` |
| 離線安裝 | 交付包的 `open-pets-app_<版本>.tar.gz`，`docker load -i` 後以 compose 啟動 |
| 原始碼 | 交付包的 `open-pets-source_<版本>.zip` 或 GitHub repo，依 `REBUILD.md` 重新建置 |

## 使用需求

- 使用者：Chrome、Edge 或 Firefox 的最新版本。
- 單次上傳上限 1 GB，最多 50 個欄位。
- 安裝主機：Windows 10／11＋Docker Desktop，或 Linux＋Docker Engine，詳見[安裝教學](deploy/)。

## 帳號

- 系統沒有預設帳號。安裝後用命令建立第一個管理員（Admin），見[安裝教學](deploy/#7-啟動後建立管理員並確認)。
- 一般使用者（User）由管理員在「系統設定 → 帳號與權限管理」建立，系統不開放自行註冊。
- 基於權責分離，Admin 管理帳號與設定，User 執行去識別化作業。

## 資料存放位置

資料都在 Docker 磁碟區 `open-pets-data`（容器內的 `/data`），更新或重建容器不會影響它：

| 位置（容器內） | 內容 |
| --- | --- |
| `/data/.secrets.env` | 第一次啟動自動產生的金鑰：雜湊鹽值、稽核紀錄簽章金鑰、登入權杖金鑰（權限 600） |
| `/data/users.db` | 帳號資料庫 |
| `/data/system.db` | 處理紀錄、系統設定、介面偏好 |
| `/data/audit.jsonl` | 稽核紀錄，具簽章，可驗證是否被竄改 |

- 去識別化結果、設定檔、檢測報告由使用者從瀏覽器下載，存在使用者自己的電腦。
- 備份與還原的做法見[安裝教學第 11 節](deploy/#11-備份與還原)。

{{< callout type="warning" >}}
**請務必備份資料磁碟區，並當作機密保管。** 磁碟區裡的鹽值（`OPEN_PETS_DEFAULT_SALT`）是雜湊用的，遺失或變更後，新的雜湊結果就對不上以前的資料；簽章金鑰變更後，舊的稽核紀錄無法再驗證。
{{< /callout >}}
