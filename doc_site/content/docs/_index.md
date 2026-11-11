---
title: 概覽
weight: 1
---

**Open-PETs 是一套資料去識別化工具。** 它用 K-匿名化與差分隱私兩種方式保護資料，處理完會模擬「有人想把資料認回是誰」的攻擊並評估風險，最後產出可以交付的資料與檢測報告。

它裝在一台電腦或主機上，使用者用瀏覽器操作。**所有運算都在這台主機上進行，資料不會傳到其他地方。**

## 我要做什麼？

{{< cards >}}
  {{< card link="quickstart" title="我要安裝" icon="play" subtitle="第一次安裝、不熟指令：選模式、用小工具安裝、隨時切換" >}}
  {{< card link="frontend" title="我要使用" icon="cursor-click" subtitle="登入後怎麼做去識別化、管理帳號" >}}
  {{< card link="faq" title="我遇到問題" icon="question-mark-circle" subtitle="連不上、登入失敗、上傳失敗等常見狀況" >}}
  {{< card link="deploy" title="資訊人員：完整參考" icon="server" subtitle="手動設定、反向代理、更新、備份、驗證與授權" >}}
  {{< card link="api" title="系統整合：API" icon="code" subtitle="端點與呼叫範例" >}}
  {{< card link="cli" title="資訊人員：命令列" icon="terminal" subtitle="批次作業與帳號維護" >}}
{{< /cards >}}

## 三種使用方式

同一份軟體，依你的情況選一種，之後隨時可以切換，資料都會保留：

| | 誰會用 | 網址 |
| --- | --- | --- |
| **本地**（預設） | 只有你自己，在這台電腦上 | `http://localhost:8080` |
| **內網** | 同一個辦公室或內網的同事（內建 HTTPS） | `https://你電腦的IP` |
| **線上** | 網際網路上的人（需要網域與反向代理） | `https://你的網域` |

不確定就先選「本地」。詳細說明見[新手快速上手](quickstart/)，技術細節見[安裝教學第 8 節](deploy/#8-三種模式本地線上內網)。

## 帳號

- 系統**沒有預設帳號**。安裝時會建立第一個管理員（Admin），見[新手快速上手](quickstart/)；手動安裝見[安裝教學第 7 節](deploy/#7-啟動後建立管理員並確認)。
- 一般使用者（User）由管理員在「系統設定 → 帳號與權限管理」建立，**不開放自行註冊**。
- 權責分離：Admin 管理帳號與設定，User 執行去識別化作業。

## 使用需求

- 使用者：Chrome、Edge 或 Firefox 的最新版本。
- 單次上傳上限 1 GB，最多 50 個欄位。
- 安裝主機：Windows 10／11＋Docker Desktop，或 Linux＋Docker Engine。

## 資料存放在哪裡

資料都在 Docker 的「資料磁碟區」`open-pets-data`（容器內的 `/data`），更新或重建不會影響它：

| 位置（容器內） | 內容 |
| --- | --- |
| `/data/.secrets.env` | 第一次啟動自動產生的金鑰（雜湊鹽值、稽核紀錄簽章金鑰、登入權杖金鑰） |
| `/data/users.db` | 帳號資料庫 |
| `/data/system.db` | 處理紀錄、系統設定、介面偏好 |
| `/data/audit.jsonl` | 稽核紀錄，有簽章，可驗證是否被竄改 |

- 去識別化的結果、設定檔、檢測報告由使用者從瀏覽器下載，存在使用者自己的電腦。
- 備份與還原：用 `.\open-pets.ps1 backup`，或見[安裝教學第 11 節](deploy/#11-備份與還原)。

{{< callout type="warning" >}}
**請務必定期備份資料磁碟區，並當作機密保管。** 磁碟區裡的鹽值遺失或變更後，新的雜湊結果就對不上以前的資料；簽章金鑰變更後，舊的稽核紀錄無法再驗證。
{{< /callout >}}

## 程式碼與移轉

前端與後端原始碼都在 GitHub [`ttcdog115016/Demo`](https://github.com/ttcdog115016/Demo)（後端在 `backend/`）。日後正式上線會改放到甲方的 GitHub 帳號，移轉方式見[安裝教學第 14 節](deploy/#14-移轉到甲方-github-帳號)。
