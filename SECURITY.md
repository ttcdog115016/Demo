# 資安問題通報

## 發現弱點時請這樣通報

請**不要**在公開的 Issue 或 Pull Request 裡寫出弱點細節。請用 GitHub 的私人通報功能：

1. 開啟本 repo 的 **Security** 分頁。
2. 按 **Report a vulnerability**（直接連結：<https://github.com/ttcdog115016/Demo/security/advisories/new>）。
3. 寫下：受影響的版本、重現步驟、可能造成的影響。有截圖或紀錄檔更好，但請先遮掉個資與密碼。

通報內容只有你與維護者看得到，確認處理後再決定是否公開。

> 看不到 **Report a vulnerability** 按鈕，代表 repo 管理員還沒啟用私人通報
> （Settings → Code security → Private vulnerability reporting）。這時請改用 repo 擁有者在 GitHub 個人頁面公布的聯絡方式，同樣不要公開弱點細節。

## 支援的版本

只維護**最新發佈的版本**（見 [Releases](https://github.com/ttcdog115016/Demo/releases)）。舊版本的問題請先升級再確認是否仍存在。映像檔升級方式見安裝教學的「更新與退回」。

## 範圍

- 在範圍內：本 repo 的前端、後端（`backend/`）、`docker/` 的容器與安裝工具、發版流程（`.github/workflows/`）。
- 不在範圍內：基底映像檔與第三方套件本身的弱點（請通報給上游；我們會用 Dependabot 與 Trivy 掃描追蹤並升級）、對外網際網路直接開放服務的部署（本專案不提供這種模式）、需要實體接觸主機才能達成的攻擊。

## 驗證你拿到的版本

映像檔與離線交付包都有簽章與校驗碼，驗證方式見安裝教學的「驗證映像檔來源」。
