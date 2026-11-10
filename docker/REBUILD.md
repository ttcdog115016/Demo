# 重新建置映像檔、替換第三方元件

映像檔 `open-pets-app` 內含 LGPL-3.0 的 fpdf2 與 MPL-2.0 的 certifi 等第三方元件（授權說明在映像檔內 `/licenses/THIRD_PARTY_NOTICES.txt`，與交付包的 `THIRD_PARTY_NOTICES.txt` 相同）。
本文說明如何取得原始碼、用同一份 `Dockerfile` 重新建置，以及如何替換其中的 Python 元件（例如 fpdf2）。

## 需要的檔案
交付包內的 `open-pets-source_<版本>.zip` 就是全部原始碼，解開後是一個 `open-pets/` 資料夾：

| 內容 | 位置 |
|---|---|
| 前端原始碼 | `src/`、`public/`、`package.json`、`package-lock.json` |
| 後端原始碼（含 `pyproject.toml`、`uv.lock`） | `backend/` |
| 建置檔 | `docker/Dockerfile` |

需要 Docker Desktop／Docker Engine（含 `buildx`），並且重新建置時需要連網（下載基底映像檔與套件）。

## 重新建置
在解開的 `open-pets/` 資料夾執行：

```
docker buildx build -f docker/Dockerfile --build-arg OPEN_PETS_VERSION=2.0.2 -t open-pets-app:2.0.2-custom --load .
```

Windows 也可以用 `docker\build_image.ps1 -Version 2.0.2`，它會同時輸出離線交付包（需要在 git 工作樹內執行，因為原始碼壓縮檔以 `git archive` 產生）。
建好後把 `.env` 的 `OPEN_PETS_VERSION`（以及 `OPEN_PETS_IMAGE`，如果有設）改成您的標籤即可。

## 替換 Python 元件（例如 fpdf2）
1. 在 `backend/` 修改 `pyproject.toml` 內該套件的版本，例如把 `"fpdf2==2.8.9"` 改成您要的版本。
2. 在同一個資料夾（`backend/`）執行 `uv lock`（需安裝 [uv](https://docs.astral.sh/uv/)），讓 `uv.lock` 對應新版本。
3. 依上一節重新建置。建置會用 `uv sync --locked`，所以 `pyproject.toml` 與 `uv.lock` 不一致時會直接失敗，不會悄悄裝錯版本。
4. fpdf2 在映像檔內是原始碼檔（`/opt/venv/lib/python3.12/site-packages/fpdf/`），沒有被編譯或合併進其他檔案。
5. 建好後請實際產生一份 PDF 報告確認功能正常；更換版本後的相容性由更換者負責。

certifi 等其他套件的替換方式相同。

## 基底映像檔固定在 digest
`Dockerfile` 的 `FROM` 寫成 `名稱:標籤@sha256:…`：標籤給人看，digest 才是實際使用的內容，所以同一份原始碼在不同時間建出來的基底相同。代價是基底不會自動更新，要手動或靠 Dependabot 換新：
1. `docker buildx imagetools inspect python:3.12-slim`，取得最上面的 `Digest:`（多平台索引的 digest）。
2. 把 `Dockerfile` 內對應的 `@sha256:…` 換成新值（`node:20-alpine`、`python:3.12-slim`、`ghcr.io/astral-sh/uv` 共四處，其中 `python:3.12-slim` 出現兩次要一起換）。
3. 重新建置並做弱點掃描，確認沒有新增的可修補 HIGH／CRITICAL。
建置時仍會執行 `apt-get upgrade`，所以系統套件的修補不必等基底更新。

## 注意
- 重新建置的映像檔與原交付映像檔的內容雜湊不同（基底映像檔與系統套件更新、建置時間不同），這是正常的。
- 本專案自己的程式碼為 MIT 授權（見 `LICENSE`，後端另見 `backend/LICENSE`）。
