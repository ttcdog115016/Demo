#!/usr/bin/env bash
# ============================================================================
# Open-PETs 映像檔冒煙測試（發版流程 docker-image.yml 與 PR 的映像檔建置檢查 docker-build-check.yml 共用）
#
# 用法：bash docker/smoke_test.sh <映像檔名稱:標籤>
#   例：bash docker/smoke_test.sh open-pets-app:2.0.0-rc4
#
# 驗證：
#   1. 三個容器都能以「唯讀根檔案系統、cap_drop ALL、no-new-privileges」啟動並轉為 healthy；
#   2. /api/v1/status 有回應；
#   3. /runtime-config.js 回報的模式正確：未設定→local、舊名稱 offline→local、lan；
#   4. 不合法的 OPEN_PETS_MODE 會讓容器拒絕啟動（不可悄悄退回預設）。
#
# 為什麼抽成共用腳本：rc3 第一次發版就是因為這段測試寫在 workflow 裡、期望值（offline）沒跟著改名（local）而失敗。
# 只維護這一份，發版流程與 PR 檢查就不會漂移。
#
# 容器與磁碟區名稱一律以 smoke- 開頭，埠 18080～18083 只綁 127.0.0.1；結束（含失敗）時一律清理。
# 需要：docker、curl、timeout（GNU coreutils）。
# ============================================================================
set -euo pipefail

IMAGE="${1:?用法：bash docker/smoke_test.sh <映像檔名稱:標籤>}"
NAMES=(smoke-default smoke-alias smoke-lan)

cleanup() {
  docker rm -f "${NAMES[@]}" >/dev/null 2>&1 || true
  docker volume rm "${NAMES[@]}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup   # 前一次中斷留下的同名容器與磁碟區先清掉

wait_healthy() {
  local name="$1"
  for _ in $(seq 1 40); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$name")" = healthy ]; then
      echo "OK: $name 已 healthy"
      return 0
    fi
    sleep 2
  done
  echo "FAIL: $name 沒有在 80 秒內轉為 healthy，容器日誌如下："
  docker logs "$name" || true
  return 1
}

# 起一個容器：名稱 埠 [額外的 docker run 參數…]
start() {
  local name="$1" port="$2"
  shift 2
  docker run -d --name "$name" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    -p "127.0.0.1:$port:8080" -v "$name:/data" "$@" "$IMAGE" >/dev/null
}

expect_mode() {
  local port="$1" mode="$2" body
  body="$(curl -fsS "http://127.0.0.1:$port/runtime-config.js")"
  # 不用管線：開了 pipefail，grep -q 提早結束可能讓上游回非零，造成偶發的假失敗
  if ! grep -q "\"mode\": \"$mode\"" <<<"$body"; then
    echo "FAIL: 埠 $port 應回報 mode=$mode，實際回應：$body"
    exit 1
  fi
  echo "OK: 埠 $port 回報 mode=$mode"
}

echo "== 啟動三個容器（$IMAGE）"
# 預設（不設定 OPEN_PETS_MODE）＝ local；舊值 offline 仍視為 local；lan 需要 OPEN_PETS_ALLOWED_HOSTS
start smoke-default 18080
start smoke-alias   18082 -e OPEN_PETS_MODE=offline
start smoke-lan     18083 -e OPEN_PETS_MODE=lan    -e OPEN_PETS_ALLOWED_HOSTS=192.0.2.10
for name in "${NAMES[@]}"; do wait_healthy "$name"; done

echo "== 服務與模式"
# /api/v1/status 的 version 是後端程式內的版本字串，只確認服務名稱，不比對版本（避免兩邊漏改一處就讓檢查失敗）
status_body="$(curl -fsS http://127.0.0.1:18080/api/v1/status)"
if ! grep -q 'Open-PETs' <<<"$status_body"; then
  echo "FAIL: /api/v1/status 的回應不含 Open-PETs：$status_body"
  exit 1
fi
echo "OK: /api/v1/status 有回應"
expect_mode 18080 local
expect_mode 18082 local
expect_mode 18083 lan

echo "== 不合法的模式值必須被拒絕"
rc=0
timeout 60 docker run --rm --read-only --cap-drop ALL -e OPEN_PETS_MODE=bogus "$IMAGE" >/dev/null 2>&1 || rc=$?
if [ "$rc" = 0 ] || [ "$rc" = 124 ]; then
  echo "FAIL: OPEN_PETS_MODE=bogus 應該要啟動失敗（結束碼 $rc）"
  exit 1
fi
echo "OK: OPEN_PETS_MODE=bogus 被拒絕（結束碼 $rc）"

echo "== 已移除的 online 模式必須被拒絕，並提示改用 lan"
rc=0
online_output="$(timeout 60 docker run --rm --read-only --cap-drop ALL -e OPEN_PETS_MODE=online -e OPEN_PETS_ALLOWED_HOSTS=example.test "$IMAGE" 2>&1)" || rc=$?
if [ "$rc" = 0 ] || [ "$rc" = 124 ]; then
  echo "FAIL: OPEN_PETS_MODE=online（已移除）應該要啟動失敗（結束碼 $rc）"
  exit 1
fi
if ! grep -q '已移除' <<<"$online_output" || ! grep -q 'lan' <<<"$online_output"; then
  echo "FAIL: 拒絕訊息沒有說明 online 已移除、要改用 lan：$online_output"
  exit 1
fi
echo "OK: OPEN_PETS_MODE=online 被拒絕，並提示改用 lan（結束碼 $rc）"

echo "冒煙測試全部通過"
