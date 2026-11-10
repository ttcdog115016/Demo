# syntax=docker/dockerfile:1.7
# ============================================================================
# Open-PETs 單一映像檔（前端＋後端同一個容器、同一個行程、同一個埠 8080）
#
# 建置（在本 repo 根目錄，後端原始碼以具名 context「backend」傳入）：
#   docker buildx build -f docker/Dockerfile --build-context backend="<01_程式原始碼 路徑>" -t open-pets-app:2.0.2 --load .
# 一鍵建置、輸出離線交付包：docker\build_image.ps1
#
# 後端原始碼一行都不改：前端靜態檔、SPA 路由、安全標頭由 docker/openpets_server.py
# （沿用 packaging/launcher.py，與單機版 exe 同一份程式）掛到後端的 FastAPI app 上。
# ============================================================================

# ---------- 第一階段：建置前端 ----------
FROM node:20-alpine AS frontend

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src

# --mode desktop：交付版不顯示 Demo 測試帳號、API 錯誤不送出到外部表單（旗標見 src/config/featureFlags.ts）
# .env* 被 .gitignore 排除，故直接以環境變數指定
ENV VITE_BUILD_TARGET=desktop
RUN npx tsc -b && npx vite build --mode desktop --outDir /out --emptyOutDir

# /docs 的 API 互動文件改用本機 Swagger UI（CDN 版會被 CSP 擋下，內網也連不到 CDN）
RUN mkdir -p /out/swagger-ui \
 && for f in swagger-ui-bundle.js swagger-ui.css LICENSE NOTICE; do \
      cp "node_modules/swagger-ui-dist/$f" /out/swagger-ui/; \
    done

# ---------- 第二階段：依 uv.lock 建出後端執行相依（與後端自己的 Dockerfile 相同做法）----------
FROM python:3.12-slim AS backend-deps

COPY --from=ghcr.io/astral-sh/uv:0.11.15 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /srv
COPY --from=backend pyproject.toml uv.lock ./
RUN uv sync --locked --no-default-groups

# ---------- 授權聲明：由實際安裝的 Python 套件產生（pip-licenses 只在這個階段，不進交付映像檔）----------
FROM backend-deps AS notices

RUN uv pip install --python /opt/venv/bin/python pip-licenses==5.0.0
COPY docker/THIRD_PARTY_NOTICES.header.txt /tmp/header.txt
RUN mkdir -p /licenses \
 && /opt/venv/bin/pip-licenses --from=mixed --format=plain-vertical --with-urls --with-license-file --no-license-path \
      --ignore-packages pip-licenses prettytable wcwidth > /tmp/python-licenses.txt \
 && cat /tmp/header.txt /tmp/python-licenses.txt > /licenses/THIRD_PARTY_NOTICES.txt

# ---------- 第四階段：交付映像檔（不含 node、uv、建置工具）----------
FROM python:3.12-slim

ARG OPEN_PETS_VERSION=dev
ARG OPEN_PETS_SOURCE_URL=https://github.com/ttcdog115016/Demo
LABEL org.opencontainers.image.title="Open-PETs" \
      org.opencontainers.image.description="Open-PETs 資料隱私保護工具（前端＋後端單一映像檔）" \
      org.opencontainers.image.version="${OPEN_PETS_VERSION}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="${OPEN_PETS_SOURCE_URL}"

COPY --from=backend-deps /opt/venv /opt/venv

# 弱點修補（Trivy 掃描，2026-11-10）：
#  1. 基底映像檔的系統套件（例如 zlib1g）可能落後於 Debian 安全更新，建置時一併升級。
#  2. pip 只用於建置，執行時用不到；基底映像檔附的 pip 25.0.1 有 5 項 MEDIUM 弱點，移除以縮小攻擊面。
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && (python -m pip uninstall -y pip setuptools wheel || true)

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Taipei \
    PYTHONPATH=/srv:/opt/openpets \
    OPEN_PETS_DATA_DIR=/data \
    OPEN_PETS_FRONTEND_DIR=/srv/frontend \
    OPEN_PETS_LOG_FILE=/data/logs/open-pets.log \
    TMPDIR=/data/tmp

WORKDIR /srv
COPY --from=backend app/ ./app/
COPY --from=frontend /out ./frontend

# 授權聲明（MIT、第三方元件）：二進位散布時隨映像檔附上，見 /licenses/THIRD_PARTY_NOTICES.txt 開頭的 LGPL／MPL 說明
COPY --from=notices /licenses /licenses
COPY LICENSE sbom/FRONTEND_THIRD_PARTY_LICENSES.md /licenses/
COPY packaging/launcher.py /opt/openpets/launcher.py
COPY docker/openpets_server.py /opt/openpets/openpets_server.py

# 帳號資料庫、稽核日誌、系統日誌、上傳暫存都在 /data（部署時掛載外部磁碟區）；
# 程式與前端目錄唯讀（只有 root 可寫），容器遭突破時無法改寫程式本身。
RUN mkdir -p /data \
 && useradd --create-home --uid 10001 appuser \
 && chown -R appuser:appuser /data
USER appuser

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if b'Open-PETs' in urllib.request.urlopen('http://127.0.0.1:8080/api/v1/status', timeout=4).read() else 1)"]

# --factory：啟動時才組裝 app（先補齊金鑰環境變數，再載入後端）
# --no-server-header：不在回應標頭揭露伺服器軟體名稱與版本
# 管理指令（建立管理員、重設密碼、後端 CLI）：docker exec -it open-pets python /opt/openpets/openpets_server.py <指令>
CMD ["uvicorn", "openpets_server:build_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--no-server-header"]
