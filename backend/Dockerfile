# ---------- 第一階段：依 uv.lock 建出只含執行相依的虛擬環境 ----------
FROM python:3.12-slim AS builder

# uv 版本鎖定，確保每次建置使用同一版工具
COPY --from=ghcr.io/astral-sh/uv:0.11.15 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /srv

# 只複製相依定義：此層僅在 pyproject.toml／uv.lock 變動時重建
COPY pyproject.toml uv.lock ./

# --locked：lock 檔與 pyproject 不同步時直接失敗，避免裝出與開發環境不一致的相依
# --no-default-groups：排除 dev／test／scripts 群組，只裝服務執行必要的套件
RUN uv sync --locked --no-default-groups

# ---------- 第二階段：只帶走裝好的環境與程式碼（uv 不進入交付映像檔）----------
FROM python:3.12-slim

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Taipei

WORKDIR /srv

COPY app/ ./app/

# 帳號資料庫與稽核日誌的落點。這類檔案屬於部署環境的資料而非程式碼，
# 集中在此目錄才能與程式碼分離保管；部署時掛載外部目錄到 /data，
# 資料即可跨容器重建保存。
ENV OPEN_PETS_DATA_DIR=/data

# 服務以非 root 身分執行，且僅對存放執行期資料的 /data 具寫入權。
# 程式碼目錄不開放寫入，容器遭突破時無法改寫程式本身。
RUN mkdir -p /data \
 && useradd --create-home --uid 10001 appuser \
 && chown -R appuser:appuser /data
USER appuser

EXPOSE 8000

# 監聽位址與埠號由指令參數決定，可於啟動容器時覆寫。
# CLI 亦使用同一映像檔，覆寫指令即可：
#   docker run --rm -v "$PWD:/work" <image> python -m app.cli.main k-anonymity -i /work/...
# --no-server-header：不在回應標頭揭露伺服器軟體名稱與版本，
# 免得省去攻擊者辨識實作、比對已知漏洞的工夫。
CMD ["uvicorn", "app.api.server:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
