#!/usr/bin/env bash
# 一键启动:本地模型 → GPT-SoVITS(可选) → bot → NapCat(前台显示登录二维码)
# Ctrl+C 退出时自动关停本脚本拉起的后台服务( NapCat 由它自己管理)。
#
# 可用的环境变量:
#   START_LLAMA=0       不启动本地 llama-server(改用远程 endpoint 时)
#   SOVITS_DIR=/path    设置后启动 GPT-SoVITS api_v2(:9880),否则跳过
#   NAPCAT_CMD=napcat-qq  NapCat 启动命令
#   LOG_DIR=...         日志目录,默认 ./logs
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
NAPCAT_CMD="${NAPCAT_CMD:-napcat-qq}"
mkdir -p "$LOG_DIR"

PIDS=()
track_pid() {
  case "${1:-}" in
    '' | 0 | 1 | *[!0-9]*) return ;;
  esac
  PIDS+=("$1")
}
cleanup() {
  echo ""
  echo "==> 正在关闭所有服务…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  echo "==> 已全部退出"
}
trap cleanup EXIT INT TERM

port_busy() {
  curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$1/"
}

wait_port() {
  local port=$1 name=$2 tries=${3:-40}
  for _ in $(seq 1 "$tries"); do
    if port_busy "$port"; then
      echo "==> $name 就绪(:$port)"
      return 0
    fi
    sleep 1
  done
  echo "!! $name 在 ${tries}s 内未就绪,继续执行(日志见 $LOG_DIR)"
  return 1
}

echo "=========================================="
echo " QQ bot 一键启动"
echo "=========================================="

# ---------- 1. 本地模型 (llama-server :8080) ----------
if [ "${START_LLAMA:-1}" != "1" ]; then
  echo "==> [1/4] 跳过本地模型(使用 config.llm.endpoint 指向的远程服务)"
elif port_busy 8080; then
  echo "==> [1/4] 本地模型已在运行,跳过"
else
  echo "==> [1/4] 启动本地模型…"
  nohup "$ROOT/scripts/start-llama.sh" > "$LOG_DIR/llama.log" 2>&1 &
  track_pid $!
  wait_port 8080 "本地模型" 60
fi

# ---------- 2. GPT-SoVITS 语音 (api_v2 :9880,可选) ----------
if [ -z "${SOVITS_DIR:-}" ]; then
  echo "==> [2/4] 未设置 SOVITS_DIR,跳过语音服务"
elif port_busy 9880; then
  echo "==> [2/4] 语音服务已在运行,跳过"
else
  echo "==> [2/4] 启动语音服务(api_v2)…"
  (
    cd "$SOVITS_DIR" || exit 1
    PYTHONPATH="$(pwd):$(pwd)/GPT_SoVITS" \
      nohup .venv/bin/python api_v2.py -a 127.0.0.1 -p 9880 \
        -c GPT_SoVITS/configs/tts_infer.yaml >> "$LOG_DIR/tts.log" 2>&1 &
    echo $!
  ) > "$LOG_DIR/tts.pid"
  track_pid "$(cat "$LOG_DIR/tts.pid" 2>/dev/null || echo 0)"
  wait_port 9880 "语音服务" 60
fi

# ---------- 3. bot 本体 ----------
if pgrep -f "node src/bot.js" > /dev/null; then
  echo "==> [3/4] bot 已在运行,跳过"
else
  echo "==> [3/4] 启动 bot…"
  (cd "$ROOT" && nohup node src/bot.js > "$LOG_DIR/bot.log" 2>&1 & echo $!) > "$LOG_DIR/bot.pid"
  track_pid "$(cat "$LOG_DIR/bot.pid" 2>/dev/null || echo 0)"
fi

sleep 2
if tail -n 5 "$LOG_DIR/bot.log" 2>/dev/null | grep -q "OneBot 已连接"; then
  echo "==> bot 已连上 NapCat"
else
  echo "==> bot 启动中(NapCat 登录后会自动连上,日志: $LOG_DIR/bot.log)"
fi

# ---------- 4. NapCat 前台运行(二维码显示在这里) ----------
echo "==> [4/4] 启动 NapCat(如需扫码,二维码显示在下方)"
echo "------------------------------------------"
if command -v "$NAPCAT_CMD" > /dev/null 2>&1; then
  "$NAPCAT_CMD"
else
  echo "!! 找不到命令 $NAPCAT_CMD,请手动启动 NapCat。" >&2
fi
