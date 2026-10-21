#!/usr/bin/env bash
# 一键启动:本地模型 → GPT-SoVITS(可选) → bot → SnowLuma(前台,WebUI :5099)
# Ctrl+C 退出时自动关停本脚本拉起的后台服务(SnowLuma 由它自己管理)。
#
# 可用的环境变量:
#   START_LLAMA=0       不启动本地 llama-server(改用远程 endpoint 时)
#   SOVITS_DIR=/path    设置后启动 GPT-SoVITS api_v2(:9880),否则跳过
#   SNOWLUMA_DIR=/path  SnowLuma release 目录(默认 ./SnowLuma)
#   SNOWLUMA_CMD=...    直接指定 SnowLuma 启动命令,优先于 SNOWLUMA_DIR
#   LOG_DIR=...         日志目录,默认 ./logs
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
SNOWLUMA_DIR="${SNOWLUMA_DIR:-$ROOT/SnowLuma}"
SNOWLUMA_CMD="${SNOWLUMA_CMD:-}"
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
  echo "==> bot 已连上 SnowLuma"
else
  echo "==> bot 启动中(SnowLuma 就绪后会自动连上,日志: $LOG_DIR/bot.log)"
fi

# ---------- 4. SnowLuma 前台运行(WebUI: http://127.0.0.1:5099) ----------
echo "==> [4/4] 启动 SnowLuma(WebUI: http://127.0.0.1:5099)"
echo "------------------------------------------"
if [ -n "$SNOWLUMA_CMD" ]; then
  # 允许带参数,例如 SNOWLUMA_CMD="node dist/index.mjs"
  sh -c "$SNOWLUMA_CMD"
elif [ -x "$SNOWLUMA_DIR/launcher.sh" ]; then
  (cd "$SNOWLUMA_DIR" && ./launcher.sh)
elif command -v snowluma > /dev/null 2>&1; then
  snowluma
else
  echo "!! 未找到 SnowLuma。请从官方 Releases 下载并解压到 $SNOWLUMA_DIR," >&2
  echo "   或用 SNOWLUMA_DIR / SNOWLUMA_CMD 指定启动位置。" >&2
fi
