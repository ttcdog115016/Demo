# 重新建置映像檔、替換第三方元件

映像檔 `open-pets-app` 內含 LGPL-3.0 的 fpdf2 與 MPL-2.0 的 certifi 等第三方元件（授權說明在映像檔內 `/licenses/THIRD_PARTY_NOTICES.txt`，與交付包的 `THIRD_PARTY_NOTICES.txt` 相同）。
本文說明如何取得原始碼、用同一份 `Dockerfile` 重新建置，以及如何替換其中的 Python 元件（例如 fpdf2）。

## 需要的檔案
| 內容 | 在交付包的位置 |
|---|---|
| 前端原始碼與 `docker/Dockerfile` | `open-pets-frontend-source_<版本>.zip` |
| 後端原始碼（`app/`、`pyproject.toml`、`uv.lock`） | 期末交付套件 `01_程式原始碼` 資料夾 |

需要 Docker Desktop／Docker Engine（含 `buildx`），並且重新建置時需要連網（下載基底映像檔與套件）。

## 重新建置
解壓縮前端原始碼，在該資料夾執行（`<後端路徑>` 換成 `01_程式原始碼` 的實際位置）：

```
docker buildx build -f docker/Dockerfile --build-context backend="<後端路徑>" --build-arg OPEN_PETS_VERSION=2.0.2 -t open-pets-app:2.0.2-custom --load .
```

Windows 可改用 `docker\build_image.ps1 -BackendSrc "<後端路徑>" -Version 2.0.2`，它會同時輸出離線交付包。
建好後把 `docker-compose.yml`（或 `.env` 的 `OPEN_PETS_VERSION`）改成你的標籤即可。

## 替換 Python 元件（例如 fpdf2）
1. 在後端原始碼資料夾修改 `pyproject.toml` 內該套件的版本，例如把 `"fpdf2==2.8.9"` 改成您要的版本。
2. 在同一個資料夾執行 `uv lock`（需安裝 [uv](https://docs.astral.sh/uv/)），讓 `uv.lock` 對應新版本。
3. 依上一節重新建置。建置會用 `uv sync --locked`，所以 `pyproject.toml` 與 `uv.lock` 不一致時會直接失敗，不會悄悄裝錯版本。
4. fpdf2 在映像檔內是原始碼檔（`/opt/venv/lib/python3.12/site-packages/fpdf/`），沒有被編譯或合併進其他檔案。
5. 建好後請實際產生一份 PDF 報告確認功能正常；更換版本後的相容性由更換者負責。

certifi 等其他套件的替換方式相同。

## 注意
- 重新建置的映像檔與原交付映像檔的內容雜湊不同（基底映像檔與系統套件更新、建置時間不同），這是正常的。
- 本專案自己的程式碼為 MIT 授權（見 `LICENSE`）。
