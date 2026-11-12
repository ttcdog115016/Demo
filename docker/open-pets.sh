#!/usr/bin/env bash
# Open-PETs 安裝與模式切換小工具（Linux／macOS，bash）
#
# 最常用的三個指令（在這個檔案所在的資料夾執行）：
#   ./open-pets.sh setup                  第一次安裝：用問答幫你選模式、填網址、啟動、建立管理員
#   ./open-pets.sh mode local|lan  切換模式（本地／內網），資料不會不見
#   ./open-pets.sh status                 看目前是什麼模式、有沒有在運作、要開哪個網址
#
# 其他指令：start、stop、logs、create-admin、reset-password、export-ca、backup、update <版本>、help
# 進階參數：--mode --hosts --version --port --https-port --container-name --project-name --image --yes（全部用預設值、不詢問）
#
# 這個工具只做三件事：寫同資料夾的 .env、需要時下載缺少的設定檔、呼叫 docker compose。
# 它不會修改這台電腦的系統設定（防火牆請依畫面提示自己設定；憑證信任由各台電腦自己安裝）。
#
# 注意：這個 Linux 版與 Windows 版（open-pets.ps1）功能相同，但 Windows 版有在真實環境完整測試；
# 本檔以 shellcheck 與容器內的非互動測試驗證，沒有在真實的 Linux 主機上做完整的 HTTPS／防火牆流程測試。

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/.env"
RELEASE_BASE='https://github.com/ttcdog115016/Demo/releases/download'
GHCR_IMAGE='ghcr.io/ttcdog115016/open-pets-app'
DEFAULT_VERSION='__DEFAULT_VERSION__'   # 發佈時由打包流程換成該版本；開發時保持原樣＝不預設版本
case "$DEFAULT_VERSION" in __*) DEFAULT_VERSION='' ;; esac

COMMAND="${1:-help}"
[ $# -gt 0 ] && shift
ARG1=''
case "$COMMAND" in mode | update) if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then ARG1="$1"; shift; fi ;; esac
OPT_MODE=''; OPT_HOSTS=''; OPT_VERSION=''; OPT_PORT=0; OPT_HTTPS_PORT=0
OPT_CONTAINER=''; OPT_PROJECT=''; OPT_IMAGE=''; YES=0; NO_ADMIN=0; NO_BACKUP=0
while [ $# -gt 0 ]; do
    case "$1" in
        --mode) OPT_MODE="${2:-}"; shift 2 ;;
        --hosts) OPT_HOSTS="${2:-}"; shift 2 ;;
        --version) OPT_VERSION="${2:-}"; shift 2 ;;
        --port) OPT_PORT="${2:-0}"; shift 2 ;;
        --https-port) OPT_HTTPS_PORT="${2:-0}"; shift 2 ;;
        --container-name) OPT_CONTAINER="${2:-}"; shift 2 ;;
        --project-name) OPT_PROJECT="${2:-}"; shift 2 ;;
        --image) OPT_IMAGE="${2:-}"; shift 2 ;;
        --yes | -y) YES=1; shift ;;
        --no-create-admin) NO_ADMIN=1; shift ;;
        --no-backup) NO_BACKUP=1; shift ;;
        *) echo "不認得的參數：$1（./open-pets.sh help 看用法）"; exit 1 ;;
    esac
done

# ------------------------------------------------------------------ 輸出
if [ -t 1 ]; then C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_C=$'\033[36m'; C_D=$'\033[90m'; C_0=$'\033[0m'; else C_R=''; C_G=''; C_Y=''; C_C=''; C_D=''; C_0=''; fi
say() { printf '%s\n' "$1"; }
title() { printf '\n%s== %s%s\n' "$C_C" "$1" "$C_0"; }
ok() { printf '%s  [完成] %s%s\n' "$C_G" "$1" "$C_0"; }
note() { printf '%s  %s%s\n' "$C_D" "$1" "$C_0"; }
warn() { printf '%s  [注意] %s%s\n' "$C_Y" "$1" "$C_0"; }
stop_tool() {
    printf '\n%s[無法繼續] %s%s\n' "$C_R" "$1" "$C_0"
    shift
    for fix in "$@"; do printf '%s  → %s%s\n' "$C_Y" "$fix" "$C_0"; done
    exit 1
}
ask() { # ask "問題" "預設值"
    if [ "$YES" -eq 1 ]; then printf '%s' "${2:-}"; return; fi
    local suffix='' answer=''
    [ -n "${2:-}" ] && suffix="（直接按 Enter＝$2）"
    read -r -p "$1$suffix " answer
    [ -z "$answer" ] && answer="${2:-}"
    printf '%s' "$answer"
}
confirm_step() {
    [ "$YES" -eq 1 ] && return 0
    local answer=''
    read -r -p "$1（輸入 Y 繼續，其他任何輸入都取消）" answer
    case "$answer" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# ------------------------------------------------------------------ .env
env_get() { # env_get KEY
    [ -f "$ENV_FILE" ] || return 0
    local line
    line="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1)"
    printf '%s' "${line#*=}" | tr -d '\r'
}
env_has() { [ -f "$ENV_FILE" ] && grep -qE "^[[:space:]]*$1=" "$ENV_FILE"; }
env_set() { # env_set KEY VALUE（更新或新增；其他行原樣保留）
    local key="$1" value="$2" tmp
    tmp="$(mktemp)"
    if [ -f "$ENV_FILE" ] && grep -qE "^[[:space:]]*$key=" "$ENV_FILE"; then
        awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} { if ($1 ~ "^[ \t]*" k "$") { print k "=" v } else { print $0 } }' "$ENV_FILE" > "$tmp"
    else
        { [ -f "$ENV_FILE" ] && cat "$ENV_FILE"; printf '%s=%s\n' "$key" "$value"; } > "$tmp"
    fi
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
}
env_unset() { # env_unset KEY
    [ -f "$ENV_FILE" ] || return 0
    local tmp
    tmp="$(mktemp)"
    grep -vE "^[[:space:]]*$1=" "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
}

# ------------------------------------------------------------------ Docker 與檢查
need_docker() {
    command -v docker > /dev/null 2>&1 || stop_tool '找不到 Docker：這台電腦還沒有安裝 Docker。' \
        '請依 https://docs.docker.com/engine/install/ 安裝 Docker Engine 與 Compose 外掛，再重新執行這個工具。'
    # shellcheck disable=SC2016  # 下面訊息裡的 $USER 是要讓使用者看到的指令文字，不是要在這裡展開
    docker version --format '{{.Server.Version}}' > /dev/null 2>&1 || stop_tool 'Docker 沒有在執行，或目前的使用者沒有權限使用它。' \
        '啟動 Docker：sudo systemctl start docker' \
        '沒有權限的話，把自己加進 docker 群組（sudo usermod -aG docker $USER，重新登入），或在指令前加 sudo。'
    docker compose version > /dev/null 2>&1 || stop_tool '這個 Docker 沒有 Compose 外掛。' '請安裝 docker-compose-plugin（新版 Docker 內建）。'
}
port_busy() { # port_busy PORT：被占用回傳 0
    local p="$1"
    if command -v ss > /dev/null 2>&1; then ss -ltn 2> /dev/null | awk '{print $4}' | grep -qE "[:.]$p$"; return $?; fi
    if command -v lsof > /dev/null 2>&1; then lsof -iTCP:"$p" -sTCP:LISTEN > /dev/null 2>&1; return $?; fi
    (exec 3<> "/dev/tcp/127.0.0.1/$p") 2> /dev/null
}
find_free_port() { # find_free_port START
    local p="$1" end=$(($1 + 60))
    while [ "$p" -lt "$end" ]; do port_busy "$p" || { printf '%s' "$p"; return; }; p=$((p + 1)); done
    printf '0'
}
container_line() { docker ps -a --filter "name=^/$1\$" --format '{{.Names}}|{{.Status}}|{{.Labels}}' 2> /dev/null | head -n 1; }
project_name() {
    if [ -n "$OPT_PROJECT" ]; then printf '%s' "$OPT_PROJECT"; return; fi
    local p; p="$(env_get COMPOSE_PROJECT_NAME)"
    if [ -n "$p" ]; then printf '%s' "$p"; else printf 'open-pets'; fi
}
is_own_container() { # is_own_container "<container_line>"
    local labels="${1#*|}"; labels="${labels#*|}"
    local proj='' wd=''
    case ",$labels" in *",com.docker.compose.project="*) proj="${labels#*com.docker.compose.project=}"; proj="${proj%%,*}" ;; esac
    case ",$labels" in *",com.docker.compose.project.working_dir="*) wd="${labels#*com.docker.compose.project.working_dir=}"; wd="${wd%%,*}" ;; esac
    [ "$proj" = "$(project_name)" ] && [ "${wd%/}" = "${DIR%/}" ]
}
compose() { (cd "$DIR" && docker compose "$@"); }
wait_healthy() { # wait_healthy CONTAINER
    local waited=0 state
    while [ "$waited" -lt 150 ]; do
        state="$(docker inspect --format '{{.State.Health.Status}}' "$1" 2> /dev/null)"
        [ "$state" = healthy ] && { echo; return 0; }
        [ "$state" = unhealthy ] && break
        printf '.'; sleep 3; waited=$((waited + 3))
    done
    echo
    return 1
}

# ------------------------------------------------------------------ 輸入檢查
normalize_hosts() { printf '%s' "$1" | sed -E 's/[[:space:]]*,[[:space:]]*/,/g; s/^,+//; s/,+$//; s/^[[:space:]]+//; s/[[:space:]]+$//'; }
check_hosts() { # 回傳錯誤訊息（空字串＝沒問題）
    local list="$1" h
    [ -z "$list" ] && { printf '還沒有填網址。'; return; }
    if printf '%s' "$list" | grep -qE '[:/[:space:]]'; then
        printf '網址只要寫主機名稱或 IP（例如 192.168.1.20），不要加 http://、https://、斜線、埠號或空格。多個請用逗號分隔。'; return
    fi
    local IFS=','
    for h in $list; do
        printf '%s' "$h" | grep -qE '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' || { printf '「%s」不是正確的主機名稱或 IP。' "$h"; return; }
    done
}
lan_ips() {
    if command -v ip > /dev/null 2>&1; then
        ip -4 -o addr show scope global 2> /dev/null | awk '{print $4 " " $2}' | sed 's#/[0-9]* # #' | grep -vE ' (docker|br-|veth|virbr)' || true
    elif command -v hostname > /dev/null 2>&1; then
        for a in $(hostname -I 2> /dev/null); do printf '%s eth\n' "$a"; done
    fi
}
valid_mode() { case "$1" in local | lan) return 0 ;; *) return 1 ;; esac; }
# 線上（online）模式已移除：舊的資料夾可能還留著 OPEN_PETS_MODE=online，標籤要看得懂，但不能再選、不能再套用
mode_label() { case "$1" in local) printf '本地' ;; lan) printf '內網' ;; online) printf '線上（已移除）' ;; *) printf '%s' "$1" ;; esac; }
stop_removed_online() {
    stop_tool '線上（online）模式已移除。' \
        '同一個內網的多台電腦用：./open-pets.sh mode lan --hosts <這台電腦的內網IP>' \
        '只有這台電腦用：./open-pets.sh mode local' \
        '資料（帳號、處理紀錄、稽核紀錄、金鑰）都在資料磁碟區裡，切換不會刪除。'
}
compose_file_value() { case "$1" in lan) printf 'docker-compose.yml:docker-compose.lan.yml' ;; *) printf 'docker-compose.yml' ;; esac; }

# ------------------------------------------------------------------ 取得設定檔與映像檔
default_version() {
    [ -n "$OPT_VERSION" ] && { printf '%s' "$OPT_VERSION"; return; }
    local v; v="$(env_get OPEN_PETS_VERSION)"
    [ -n "$v" ] && { printf '%s' "$v"; return; }
    local t; t="$(find "$DIR" -maxdepth 1 -name 'open-pets-app_*.tar.gz' | head -n 1)"
    if [ -n "$t" ]; then t="${t##*/open-pets-app_}"; printf '%s' "${t%.tar.gz}"; return; fi
    printf '%s' "$DEFAULT_VERSION"
}
confirm_files() { # confirm_files MODE VERSION
    local mode="$1" ver="$2" need='docker-compose.yml' f
    [ "$mode" = lan ] && need="$need docker-compose.lan.yml Caddyfile.lan"
    for f in $need; do
        [ -f "$DIR/$f" ] && continue
        [ -z "$ver" ] && stop_tool "資料夾裡缺少 $f，又不知道要下載哪一版。" '請加上 --version 2.0.0-rc4（換成你要的版本）再執行一次。'
        note "下載 $f ..."
        local url="$RELEASE_BASE/v$ver/$f"
        if command -v curl > /dev/null 2>&1; then curl -fsSL -o "$DIR/$f" "$url" || { rm -f "$DIR/$f"; false; }
        else wget -q -O "$DIR/$f" "$url" || { rm -f "$DIR/$f"; false; }; fi
        [ -f "$DIR/$f" ] || stop_tool "下載不到 $f（$url）。" \
            '確認這台電腦連得上網路，以及版本號有沒有打對（到 GitHub 的 Releases 頁看，不含開頭的 v）。' \
            "注意：$f 是 2.0.0-rc2 之後的版本才有；rc2（含）以前沒有內網與模式切換的檔案。" \
            '沒有網路的話，請改用離線交付包（裡面已經有全部檔案），把檔案放在這個資料夾。'
    done
}
resolve_image() { # 設定 IMG_NAME、IMG_PULL
    local ver="$1"
    IMG_PULL=0
    if [ -n "$OPT_IMAGE" ]; then
        IMG_NAME="$OPT_IMAGE"
        docker image inspect "$IMG_NAME:$ver" > /dev/null 2>&1 || IMG_PULL=1
        return
    fi
    if docker image inspect "open-pets-app:$ver" > /dev/null 2>&1; then IMG_NAME='open-pets-app'; return; fi
    if [ -f "$DIR/open-pets-app_$ver.tar.gz" ]; then
        note "匯入資料夾裡的離線映像檔（open-pets-app_$ver.tar.gz），約需一兩分鐘 ..."
        docker load -i "$DIR/open-pets-app_$ver.tar.gz" || stop_tool '匯入離線映像檔失敗（檔案可能不完整）。' '重新複製或下載一次，並核對 SHA256SUMS.txt。'
        IMG_NAME='open-pets-app'; return
    fi
    IMG_NAME="$GHCR_IMAGE"; IMG_PULL=1
}

# ------------------------------------------------------------------ 套用設定（setup 與 mode 共用）
# 使用全域 CFG_MODE CFG_VERSION CFG_IMAGE CFG_PULL CFG_HOSTS CFG_PORT CFG_HTTPS CFG_CONTAINER
apply_config() {
    confirm_files "$CFG_MODE" "$CFG_VERSION"
    title '寫入設定'
    env_set OPEN_PETS_MODE "$CFG_MODE"
    env_set OPEN_PETS_VERSION "$CFG_VERSION"
    env_set OPEN_PETS_IMAGE "$CFG_IMAGE"
    env_set OPEN_PETS_PORT "$CFG_PORT"
    env_set OPEN_PETS_CONTAINER_NAME "$CFG_CONTAINER"
    env_set COMPOSE_PATH_SEPARATOR ':'
    env_set COMPOSE_FILE "$(compose_file_value "$CFG_MODE")"
    [ -n "$OPT_PROJECT" ] && env_set COMPOSE_PROJECT_NAME "$OPT_PROJECT"
    if [ "$CFG_MODE" = local ]; then env_unset OPEN_PETS_ALLOWED_HOSTS; else env_set OPEN_PETS_ALLOWED_HOSTS "$CFG_HOSTS"; fi
    if [ "$CFG_MODE" = lan ] && [ "$CFG_HTTPS" -gt 0 ]; then env_set OPEN_PETS_HTTPS_PORT "$CFG_HTTPS"; else env_unset OPEN_PETS_HTTPS_PORT; fi
    ok '設定已寫入 .env'

    if [ "$CFG_PULL" -eq 1 ]; then
        title '下載映像檔（第一次約需幾分鐘）'
        compose pull || stop_tool '下載映像檔失敗。' '確認這台電腦連得上網路。' "確認版本號打對了（到 GitHub 的 Releases 頁看，不含開頭的 v）：$CFG_VERSION" \
            '套件如果是私有的，需要先登入：docker login ghcr.io -u <GitHub 帳號>' '沒有網路的話，請改用離線交付包。'
    fi
    title '啟動'
    compose up -d --remove-orphans || stop_tool '啟動失敗。' '執行 ./open-pets.sh logs 看原因；常見原因是網址沒填、埠被占用、或同名容器已經存在。'
    printf '  等待系統就緒'
    if ! wait_healthy "$CFG_CONTAINER"; then
        warn '等了一段時間還沒有就緒。請執行 ./open-pets.sh logs 看原因（剛啟動可能還在準備，也可以稍後再執行 ./open-pets.sh status）。'
        return 1
    fi
    ok '系統已經就緒'
}
show_access() {
    local h suffix=''
    title '怎麼開啟'
    case "$CFG_MODE" in
        local) printf '%s  在這台電腦的瀏覽器開：http://localhost:%s%s\n' "$C_G" "$CFG_PORT" "$C_0"; note '只有這台電腦連得進來。' ;;
        lan)
            [ "$CFG_HTTPS" -gt 0 ] && [ "$CFG_HTTPS" -ne 443 ] && suffix=":$CFG_HTTPS"
            for h in $(printf '%s' "$CFG_HOSTS" | tr ',' ' '); do printf '%s  同一個內網的電腦在瀏覽器開：https://%s%s%s\n' "$C_G" "$h" "$suffix" "$C_0"; done
            note '每台要使用的電腦第一次要先信任憑證，否則瀏覽器會顯示警告：執行 ./open-pets.sh export-ca，把產生的說明檔交給同事。' ;;
        online)
            warn '這個資料夾還是舊版的「線上模式」設定，線上模式已移除。請改用內網或本地（資料不會不見）：'
            say '    ./open-pets.sh mode lan --hosts <這台電腦的內網IP>'
            say '    ./open-pets.sh mode local' ;;
    esac
}
firewall_hint() {
    title '防火牆（讓同事連得進來）'
    warn "同一個內網的電腦要連到這台電腦的 $1 埠，防火牆要開放。依你的系統擇一（需要 sudo）："
    say "  sudo ufw allow $1/tcp"
    say "  sudo firewall-cmd --permanent --add-port=$1/tcp && sudo firewall-cmd --reload"
}
load_current() { # 把 .env 讀進 CFG_* 全域變數
    env_has OPEN_PETS_VERSION || stop_tool '這個資料夾還沒有安裝過（找不到 .env）。' '請先執行 ./open-pets.sh setup。'
    CFG_MODE="$(env_get OPEN_PETS_MODE)"; [ -z "$CFG_MODE" ] && CFG_MODE=local
    [ "$CFG_MODE" = offline ] && CFG_MODE=local
    CFG_VERSION="$(env_get OPEN_PETS_VERSION)"
    CFG_IMAGE="$(env_get OPEN_PETS_IMAGE)"; [ -z "$CFG_IMAGE" ] && CFG_IMAGE=open-pets-app
    CFG_HOSTS="$(env_get OPEN_PETS_ALLOWED_HOSTS)"
    CFG_PORT="$(env_get OPEN_PETS_PORT)"; [ -z "$CFG_PORT" ] && CFG_PORT=8080
    CFG_HTTPS="$(env_get OPEN_PETS_HTTPS_PORT)"
    if [ -z "$CFG_HTTPS" ]; then if [ "$CFG_MODE" = lan ]; then CFG_HTTPS=443; else CFG_HTTPS=0; fi; fi
    CFG_CONTAINER="$(env_get OPEN_PETS_CONTAINER_NAME)"; [ -z "$CFG_CONTAINER" ] && CFG_CONTAINER=open-pets
    CFG_PULL=0
}

# ------------------------------------------------------------------ 指令：setup
cmd_setup() {
    title 'Open-PETs 安裝'
    need_docker
    ok 'Docker 正在運作'
    local m="$OPT_MODE" choice ver hostlist='' problem app_port https_port=0 container existing alt free ips d
    if [ -z "$m" ]; then
        say ''
        say '請選擇你要怎麼使用 Open-PETs：'
        say '  1. 本地   只有我自己，在這一台電腦上用                         （最簡單）'
        say '  2. 內網   同一個辦公室／內網的同事，用他們自己的電腦連進來      （需要信任憑證）'
        choice="$(ask '輸入 1 或 2' '1')"
        case "$choice" in 1) m=local ;; 2) m=lan ;; *) m="$(printf '%s' "$choice" | tr '[:upper:]' '[:lower:]')" ;; esac
    fi
    [ "$m" = online ] && stop_removed_online
    valid_mode "$m" || stop_tool "不認得的模式：$m" '模式只有兩種：local（本地）、lan（內網）。'

    ver="$(default_version)"
    [ -z "$ver" ] && ver="$(ask '要安裝哪一版（到 GitHub 的 Releases 頁看，不含開頭的 v，例如 2.0.0-rc4）' '')"
    [ -z "$ver" ] && stop_tool '需要版本號才能安裝。' '請加上 --version 2.0.0-rc4（換成你要的版本）再執行一次。'
    resolve_image "$ver"

    if [ "$m" = lan ]; then
        ips="$(lan_ips)"
        say ''
        say '同事要用哪個網址連進來？請填這台電腦在內網的 IP（或內網的主機名稱）。'
        if [ -n "$ips" ]; then
            say '這台電腦偵測到的內網 IP：'
            printf '%s\n' "$ips" | awk '{printf "    %s    （%s）\n", $1, $2}'
            note '建議把這台電腦的 IP 固定下來（路由器的 DHCP 保留，或在系統設定固定 IP），否則 IP 變了同事就連不上。'
        fi
        d="$OPT_HOSTS"; [ -z "$d" ] && d="$(printf '%s\n' "$ips" | head -n 1 | awk '{print $1}')"
        hostlist="$(normalize_hosts "$(ask '網址（多個請用逗號分隔，例如 192.168.1.20,pets-server）' "$d")")"
    fi
    if [ "$m" != local ]; then
        problem="$(check_hosts "$hostlist")"
        [ -n "$problem" ] && stop_tool "$problem" '範例：192.168.1.20 或 192.168.1.20,pets-server'
    fi

    # 名稱與埠：避開別人已經在用的；但「這個資料夾自己」之前安裝的就沿用原本的名稱與埠（重新執行 setup 不該換掉它們）
    local own=0 env_app=0 env_https=0
    container="$OPT_CONTAINER"
    if [ -z "$container" ]; then container="$(env_get OPEN_PETS_CONTAINER_NAME)"; [ -z "$container" ] && container=open-pets; fi
    existing="$(container_line "$container")"
    if [ -n "$existing" ] && is_own_container "$existing"; then own=1; fi
    if [ -n "$existing" ] && [ "$own" -eq 0 ]; then
        alt=open-pets-app; [ -n "$(container_line "$alt")" ] && alt="open-pets-app-$RANDOM"
        warn "這台電腦上已經有一個叫「$container」的容器（狀態：$(printf '%s' "$existing" | cut -d'|' -f2)），不是這個資料夾安裝的（可能是舊版或別的安裝）。為了不動到它，新的會改叫「$alt」。"
        container="$alt"
    fi
    if [ "$own" -eq 1 ]; then env_app="$(env_get OPEN_PETS_PORT)"; env_https="$(env_get OPEN_PETS_HTTPS_PORT)"; env_app="${env_app:-0}"; env_https="${env_https:-0}"; fi
    app_port="$OPT_PORT"
    if [ "$app_port" -le 0 ]; then if [ "$env_app" -gt 0 ]; then app_port="$env_app"; else app_port=8080; fi; fi
    if port_busy "$app_port" && [ "$app_port" -ne "$env_app" ]; then free="$(find_free_port $((app_port + 1)))"; warn "這台電腦的 $app_port 埠已經有別的程式在用，改用 $free。"; app_port="$free"; fi
    if [ "$m" = lan ]; then
        https_port="$OPT_HTTPS_PORT"
        if [ "$https_port" -le 0 ]; then if [ "$env_https" -gt 0 ]; then https_port="$env_https"; else https_port=443; fi; fi
        if port_busy "$https_port" && [ "$https_port" -ne "$env_https" ]; then free="$(find_free_port 8443)"; warn "這台電腦的 $https_port 埠已經有別的程式在用，HTTPS 改用 $free（同事的網址要加上 :$free）。"; https_port="$free"; fi
    fi

    title '請確認'
    say "  模式　　：$(mode_label "$m")（$m）"
    say "  版本　　：$ver"
    if [ "$IMG_PULL" -eq 1 ]; then say "  映像檔　：$IMG_NAME（會從網路下載）"; else say "  映像檔　：$IMG_NAME（本機已有）"; fi
    [ "$m" != local ] && say "  網址　　：$hostlist"
    say "  本機的埠：$app_port"
    [ "$m" = lan ] && say "  HTTPS 埠：$https_port"
    say "  容器名稱：$container"
    say "  安裝資料夾：$DIR"
    confirm_step '要開始安裝嗎' || { printf '%s已取消，沒有做任何變更。%s\n' "$C_Y" "$C_0"; return 0; }

    CFG_MODE="$m"; CFG_VERSION="$ver"; CFG_IMAGE="$IMG_NAME"; CFG_PULL="$IMG_PULL"; CFG_HOSTS="$hostlist"
    CFG_PORT="$app_port"; CFG_HTTPS="$https_port"; CFG_CONTAINER="$container"
    apply_config || return 0
    show_access
    [ "$m" = lan ] && firewall_hint "$https_port"

    if [ "$NO_ADMIN" -eq 0 ] && [ "$YES" -eq 0 ]; then
        title '建立第一個管理員'
        note '系統一開始沒有任何帳號，要先建立一個管理員才能登入。帳號建議用 Email；密碼至少 12 個字元，要有大寫、小寫、數字與符號。'
        docker exec -it "$container" python /opt/openpets/openpets_server.py create-admin || note '（如果顯示「已經有帳號了」，代表這個資料夾之前已經建立過，可以直接登入。）'
    fi
    title '全部完成'
    say '  之後常用：'
    note '  ./open-pets.sh status        看目前狀態與網址'
    note '  ./open-pets.sh mode lan      切換模式（local／lan）'
    note '  ./open-pets.sh stop          停止（資料會保留）'
    note '  ./open-pets.sh help          看全部指令'
}

# ------------------------------------------------------------------ 指令：mode
cmd_mode() {
    need_docker
    load_current
    local current="$CFG_MODE" new="${ARG1:-$OPT_MODE}" hostlist='' problem ips d free
    [ -z "$new" ] && stop_tool '請指定要切換到哪個模式。' '例如：./open-pets.sh mode lan （local＝本地、lan＝內網）'
    new="$(printf '%s' "$new" | tr '[:upper:]' '[:lower:]')"
    [ "$new" = online ] && stop_removed_online
    valid_mode "$new" || stop_tool "不認得的模式：$new" '模式只有兩種：local（本地）、lan（內網）。'

    if [ "$new" != local ]; then
        hostlist="$OPT_HOSTS"; [ -z "$hostlist" ] && hostlist="$CFG_HOSTS"
        if [ -z "$hostlist" ]; then
            if [ "$new" = lan ]; then
                ips="$(lan_ips)"; d="$(printf '%s\n' "$ips" | head -n 1 | awk '{print $1}')"
                hostlist="$(ask '同事要用哪個網址連進來（內網 IP 或主機名稱，多個用逗號分隔）' "$d")"
            fi
        fi
        hostlist="$(normalize_hosts "$hostlist")"
        problem="$(check_hosts "$hostlist")"
        [ -n "$problem" ] && stop_tool "$problem" '範例：192.168.1.20 或 192.168.1.20,pets-server'
    fi

    title "切換模式：$(mode_label "$current") → $(mode_label "$new")"
    printf '%s  資料（帳號、處理紀錄、稽核紀錄、金鑰）都在資料磁碟區裡，切換模式不會刪除。%s\n' "$C_G" "$C_0"
    [ "$current" = "$new" ] && note '目前已經是這個模式，會用現在的設定重新套用一次。'
    case "$new" in
        local) note '切換後：只有這台電腦能開 http://localhost；同一個內網的同事會連不上。'
            [ "$current" = lan ] && note '內網的 HTTPS 容器會停掉並移除；它保存的憑證資料會保留，之後切回內網沿用，同事不用重新信任。' ;;
        lan) note '切換後：同事改用 https://<網址> 連進來；每台電腦第一次要信任憑證；這台電腦的防火牆要開放 HTTPS 埠。'
            note '「系統設定」裡的「系統維運日誌」分頁會顯示給管理員。' ;;
    esac
    confirm_step '要切換嗎' || { printf '%s已取消，沒有做任何變更。%s\n' "$C_Y" "$C_0"; return 0; }

    if [ "$new" = lan ]; then
        [ "$OPT_HTTPS_PORT" -gt 0 ] && CFG_HTTPS="$OPT_HTTPS_PORT"
        [ "$CFG_HTTPS" -le 0 ] && CFG_HTTPS=443
        if [ "$current" != lan ] && port_busy "$CFG_HTTPS"; then free="$(find_free_port 8443)"; warn "這台電腦的 $CFG_HTTPS 埠已經有別的程式在用，HTTPS 改用 $free（同事的網址要加上 :$free）。"; CFG_HTTPS="$free"; fi
    else CFG_HTTPS=0; fi
    CFG_MODE="$new"; CFG_HOSTS="$hostlist"
    apply_config || return 0
    show_access
    [ "$new" = lan ] && firewall_hint "$CFG_HTTPS"
    say ''
    printf '%s切換完成。用 ./open-pets.sh status 可以隨時查看目前狀態。%s\n' "$C_G" "$C_0"
}

# ------------------------------------------------------------------ 其他指令
cmd_status() {
    need_docker
    load_current
    title 'Open-PETs 目前狀態'
    say "  模式　　：$(mode_label "$CFG_MODE")（$CFG_MODE）"
    say "  版本　　：$CFG_VERSION"
    local line health actual
    line="$(container_line "$CFG_CONTAINER")"
    if [ -z "$line" ]; then warn "找不到容器「$CFG_CONTAINER」。執行 ./open-pets.sh start 啟動，或 ./open-pets.sh setup 重新安裝。"; return 0; fi
    health="$(docker inspect --format '{{.State.Health.Status}}' "$CFG_CONTAINER" 2> /dev/null)"
    say "  容器　　：$CFG_CONTAINER　$(printf '%s' "$line" | cut -d'|' -f2)　健康狀態：$health"
    actual="$(curl -fsS -m 5 "http://127.0.0.1:$CFG_PORT/runtime-config.js" 2> /dev/null | sed -nE 's/.*"mode": "([a-z]+)".*/\1/p')"
    if [ -n "$actual" ]; then note "系統回報的模式：$actual"; else note '（暫時連不到本機的服務；剛啟動的話請稍等一下再查）'; fi
    show_access
    [ "$health" != healthy ] && note '狀態不是 healthy 的話，執行 ./open-pets.sh logs 看原因。'
    return 0
}
cmd_start() { need_docker; load_current; compose up -d --remove-orphans && { printf '  等待系統就緒'; wait_healthy "$CFG_CONTAINER" && { ok '已啟動'; show_access; }; }; }
cmd_stop() { need_docker; load_current; compose stop && ok '已停止（資料都還在，用 ./open-pets.sh start 再啟動）'; }
cmd_logs() { need_docker; load_current; compose logs --tail 80 open-pets; }
cmd_admin() { need_docker; load_current; docker exec -it "$CFG_CONTAINER" python /opt/openpets/openpets_server.py "$1"; }
cmd_export_ca() {
    need_docker
    load_current
    [ "$CFG_MODE" = lan ] || stop_tool '只有「內網」模式才有憑證要匯出。' "目前是$(mode_label "$CFG_MODE")模式。要用內網請先執行 ./open-pets.sh mode lan"
    local target="$DIR/open-pets-ca.crt" guide="$DIR/open-pets-colleague-guide.txt" fp suffix='' urls='' h
    compose cp proxy:/data/caddy/pki/authorities/local/root.crt "$target" || stop_tool '匯出憑證失敗。' '確認系統已經啟動（./open-pets.sh status）。'
    fp="$(openssl x509 -in "$target" -noout -fingerprint -sha256 2> /dev/null | sed 's/.*=//; s/://g')"
    [ -z "$fp" ] && fp='（這台電腦沒有 openssl，無法計算指紋；請在能用的電腦上執行 openssl x509 -in open-pets-ca.crt -noout -fingerprint -sha256）'
    [ "$CFG_HTTPS" -gt 0 ] && [ "$CFG_HTTPS" -ne 443 ] && suffix=":$CFG_HTTPS"
    for h in $(printf '%s' "$CFG_HOSTS" | tr ',' ' '); do urls="${urls:+$urls、}https://$h$suffix"; done
    cat > "$guide" << EOF
Open-PETs 使用說明（給同事）

1. 用瀏覽器（Chrome 或 Edge）開啟：$urls
2. 第一次連線，瀏覽器會顯示「您的連線不是私人連線」之類的警告，這是因為這台電腦還沒有信任公司內部的憑證。
   請先照下面做一次「信任憑證」，之後就不會再出現警告。

信任憑證（每台電腦只要做一次）：
  1. 把管理員給你的檔案 open-pets-ca.crt 存到這台電腦。
  2. Windows：用「系統管理員身分」開 PowerShell，在檔案所在的資料夾執行：
       certutil -addstore -f Root open-pets-ca.crt
     （或用滑鼠雙擊這個檔案 → 安裝憑證 → 本機電腦 → 選「將所有憑證放入以下的存放區」→「受信任的根憑證授權單位」）
     macOS：sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain open-pets-ca.crt
  3. 完全關閉瀏覽器再重新開啟。
  4. Firefox 使用者：設定 → 隱私權與安全性 → 憑證 → 檢視憑證 → 憑證機構 → 匯入 open-pets-ca.crt，勾選「信任這個 CA 來識別網站」。

確認拿到的是正確的憑證（防止被人掉包）：憑證的 SHA-256 指紋應該是
  $fp
（雙擊 open-pets-ca.crt → 詳細資料 → 指紋，兩個要一致；不一致就不要安裝，請回報管理員。）

登入帳號請向管理員索取。系統不開放自行註冊。
EOF
    ok "已匯出憑證：$target"
    ok "已產生給同事的說明：$guide"
    say "  憑證 SHA-256 指紋：$fp"
    warn '只把 open-pets-ca.crt 與說明檔交給同事。憑證的私鑰在這台電腦的資料磁碟區裡，請當作機密，不要外流。'
}
cmd_backup() {
    need_docker
    load_current
    local proj volume stamp file code
    proj="$(project_name)"
    volume="$(docker volume ls --filter "label=com.docker.compose.project=$proj" --filter 'label=com.docker.compose.volume=open-pets-data' -q 2> /dev/null | head -n 1)"
    [ -z "$volume" ] && stop_tool '找不到資料磁碟區。' '請先執行 ./open-pets.sh setup 安裝並使用過一次。'
    mkdir -p "$DIR/backups"
    stamp="$(date +%Y%m%d-%H%M%S)"; file="open-pets-data_$stamp.tgz"
    title '備份（會短暫停止服務）'
    compose stop
    docker run --rm --user root --entrypoint tar -v "$volume:/data" -v "$DIR/backups:/backup" "$CFG_IMAGE:$CFG_VERSION" czf "/backup/$file" -C /data .
    code=$?
    compose start
    [ "$code" -ne 0 ] && stop_tool '備份失敗。' '確認磁碟空間足夠，再試一次。'
    ok "備份完成：$DIR/backups/$file"
    warn '備份裡有帳號、紀錄與金鑰，請當作機密保管；金鑰遺失會讓以前的雜湊結果與稽核紀錄無法對上。'
}
cmd_update() {
    need_docker
    load_current
    [ "$CFG_MODE" = online ] && stop_removed_online   # 新版不含線上用的設定檔，先切換模式再更新
    local newv="${ARG1:-$OPT_VERSION}"
    [ -z "$newv" ] && stop_tool '請指定要更新到哪一版。' '例如：./open-pets.sh update 2.0.0-rc4（版本號到 GitHub 的 Releases 頁看，不含開頭的 v）'
    title "更新：$CFG_VERSION → $newv"
    printf '%s  資料不會不見；更新前會先自動備份。%s\n' "$C_G" "$C_0"
    confirm_step '要更新嗎' || { printf '%s已取消，沒有做任何變更。%s\n' "$C_Y" "$C_0"; return 0; }
    [ "$NO_BACKUP" -eq 0 ] && cmd_backup
    resolve_image "$newv"
    CFG_VERSION="$newv"; CFG_IMAGE="$IMG_NAME"; CFG_PULL="$IMG_PULL"
    apply_config && { ok "已更新到 $newv"; show_access; }
}
cmd_help() {
    cat << 'EOF'

Open-PETs 安裝與模式切換小工具

  第一次安裝　　　　./open-pets.sh setup
  切換模式　　　　　./open-pets.sh mode local    （本地：只有這台電腦用）
　　　　　　　　　　./open-pets.sh mode lan      （內網：同一個辦公室的同事連進來，內建 HTTPS）
  看狀態與網址　　　./open-pets.sh status
  啟動／停止　　　　./open-pets.sh start      ./open-pets.sh stop
  看日誌（出問題時）./open-pets.sh logs
  建立管理員　　　　./open-pets.sh create-admin
  忘記管理員密碼　　./open-pets.sh reset-password
  給同事的憑證與說明./open-pets.sh export-ca    （內網模式）
  備份　　　　　　　./open-pets.sh backup
  更新版本　　　　　./open-pets.sh update 2.0.0-rc4

  不想回答問題、全部用預設值：加上 --yes。進階參數見檔案開頭的說明。
EOF
}

case "$COMMAND" in
    setup) cmd_setup ;;
    mode) cmd_mode ;;
    status) cmd_status ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    logs) cmd_logs ;;
    create-admin) cmd_admin create-admin ;;
    reset-password) cmd_admin reset-password ;;
    export-ca) cmd_export_ca ;;
    backup) cmd_backup ;;
    update) cmd_update ;;
    *) cmd_help ;;
esac
