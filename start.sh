#!/usr/bin/env bash
# 一键启动:
#   1. Qwen3-VL 本地视觉模型 (llama-server :8080) —— 读表情包
#   2. GPT-SoVITS 语音模型 (api_v2 :9880) —— 当前使用现有权重
#   3. bot 本体 (Anthropic 桥 :8090 / 语音控制页 :5100)
#   4. SnowLuma QQ 网关 (WebUI :5099)
#
# Ctrl+C 会关停本脚本拉起的后台服务。
#
# 可用环境变量:
#   START_VISION=0      跳过本地视觉模型
#   START_TTS=0         跳过 GPT-SoVITS
#   MODEL_DIR=...       视觉模型目录(默认 ../models/qwen3-vl-4b)
#   SOVITS_DIR=...      GPT-SoVITS repo 目录(默认 ../GPT-SoVITS/repo)
#   SNOWLUMA_DIR=...    SnowLuma release 目录(默认 ../SnowLuma)
#   SNOWLUMA_CMD=...    直接指定 SnowLuma 启动命令
#   LOG_DIR=...         日志目录(默认 ./logs)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
START_VISION="${START_VISION:-${START_LLAMA:-1}}"
START_TTS="${START_TTS:-1}"
SNOWLUMA_CMD="${SNOWLUMA_CMD:-}"

MODEL_DIR="${MODEL_DIR:-$ROOT/../models/qwen3-vl-4b}"
[ -d "$MODEL_DIR" ] || MODEL_DIR="$ROOT/models/qwen3-vl-4b"

SOVITS_DIR="${SOVITS_DIR:-$ROOT/../GPT-SoVITS/repo}"
[ -d "$SOVITS_DIR" ] || SOVITS_DIR="$ROOT/GPT-SoVITS/repo"

SNOWLUMA_DIR="${SNOWLUMA_DIR:-$ROOT/../SnowLuma}"
[ -d "$SNOWLUMA_DIR" ] || SNOWLUMA_DIR="$ROOT/SnowLuma"
# 兼容 SnowLuma-vX.Y.Z-<platform>/ 这种按版本命名的解压目录
if [ ! -x "$SNOWLUMA_DIR/launcher.sh" ]; then
  for candidate in "$ROOT"/SnowLuma-*/launcher.sh "$ROOT"/../SnowLuma-*/launcher.sh; do
    if [ -x "$candidate" ]; then
      SNOWLUMA_DIR="$(cd "$(dirname "$candidate")" && pwd)"
      break
    fi
  done
fi

mkdir -p "$LOG_DIR"

PIDS=()
CLEANED=0
track_pid() {
  case "${1:-}" in
    '' | 0 | 1 | *[!0-9]*) return ;;
  esac
  PIDS+=("$1")
}

cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  echo ""
  echo "==> 正在关闭所有服务…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  # 等模型/服务真正释放端口,避免刚退出就重启时误判"已在运行"
  if [ "${#PIDS[@]}" -gt 0 ]; then
    for port in 8080 9880 8090 5100; do
      for _ in $(seq 1 10); do
        port_busy "$port" || break
        sleep 0.5
      done
    done
  fi
  echo "==> 已全部退出"
}
trap cleanup EXIT INT TERM

port_busy() {
  curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$1/"
}

wait_port() {
  local port=$1 name=$2 tries=${3:-40} pid=${4:-}
  for _ in $(seq 1 "$tries"); do
    if port_busy "$port"; then
      echo "==> $name 就绪(:$port)"
      return 0
    fi
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      echo "!! $name 进程已退出,查看日志: $LOG_DIR"
      return 1
    fi
    sleep 1
  done
  echo "!! $name 在 ${tries}s 内未就绪,继续执行(日志见 $LOG_DIR)"
  return 1
}

echo "=========================================="
echo " QQ bot 一键启动"
echo " 视觉: llama-server   :8080"
echo " 语音: GPT-SoVITS     :9880"
echo " bot : 控制页         :5100"
echo " 网关: SnowLuma       :5099"
echo "=========================================="

# ---------- 0. 配置预检 ----------
if [ ! -f "$ROOT/config.json" ]; then
  echo "!! 缺少 $ROOT/config.json。先复制 config.example.json 并填写。" >&2
  exit 1
fi
if (cd "$ROOT" && node --input-type=module -e "
  import { loadConfig } from './src/config.js'
  loadConfig('./config.json')
"); then
  echo "==> 配置校验通过"
else
  echo "!! config.json 校验失败,请先修正上面的错误。" >&2
  exit 1
fi

# ---------- 1. Qwen 视觉模型 ----------
echo "==> [1/4] Qwen 视觉模型"
if [ "$START_VISION" != "1" ]; then
  echo "    已跳过(START_VISION=0)"
elif port_busy 8080; then
  echo "    已在运行,跳过"
elif [ ! -f "$MODEL_DIR/Qwen3VL-4B-Instruct-Q4_K_M.gguf" ]; then
  echo "!! 找不到模型文件 $MODEL_DIR/Qwen3VL-4B-Instruct-Q4_K_M.gguf" >&2
  echo "   表情包识别会降级;可用 MODEL_DIR=/path 指定。" >&2
else
  MODEL_DIR="$MODEL_DIR" nohup "$ROOT/scripts/start-llama.sh" \
    > "$LOG_DIR/vision.log" 2>&1 &
  VISION_PID=$!
  track_pid "$VISION_PID"
  wait_port 8080 "Qwen 视觉模型" 90 "$VISION_PID" ||
    echo "!! 视觉模型未就绪,表情包将使用通用描述" >&2
fi

# ---------- 2. GPT-SoVITS 语音模型 ----------
echo "==> [2/4] GPT-SoVITS 语音模型"
if [ "$START_TTS" != "1" ]; then
  echo "    已跳过(START_TTS=0)"
elif port_busy 9880; then
  echo "    已在运行,跳过"
elif [ ! -x "$SOVITS_DIR/.venv/bin/python" ] || [ ! -f "$SOVITS_DIR/api_v2.py" ]; then
  echo "!! 找不到 $SOVITS_DIR/.venv/bin/python 或 api_v2.py" >&2
  echo "   语音会降级为文字;可用 SOVITS_DIR=/path 指定。" >&2
elif [ ! -e "$SOVITS_DIR/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large" ]; then
  echo "!! GPT-SoVITS 预训练模型不可用(通常是 pretrained_models 软链接失效)" >&2
  echo "   检查: $SOVITS_DIR/GPT_SoVITS/pretrained_models" >&2
  echo "   语音会降级为文字。" >&2
else
  (
    cd "$SOVITS_DIR" || exit 1
    PYTHONPATH="$(pwd):$(pwd)/GPT_SoVITS" \
      nohup .venv/bin/python api_v2.py -a 127.0.0.1 -p 9880 \
        -c GPT_SoVITS/configs/tts_infer.yaml > "$LOG_DIR/tts.log" 2>&1 &
    echo $!
  ) > "$LOG_DIR/tts.pid"
  TTS_PID="$(cat "$LOG_DIR/tts.pid" 2>/dev/null || echo 0)"
  track_pid "$TTS_PID"
  wait_port 9880 "GPT-SoVITS" 120 "$TTS_PID" ||
    echo "!! 语音服务未就绪,语音会降级为文字" >&2
fi

# ---------- 3. bot 本体 ----------
echo "==> [3/4] bot 本体"
if pgrep -f '^node src/bot\.js$' > /dev/null; then
  echo "    已在运行,跳过"
else
  (
    cd "$ROOT" || exit 1
    nohup node src/bot.js > "$LOG_DIR/bot.log" 2>&1 &
    echo $!
  ) > "$LOG_DIR/bot.pid"
  BOT_PID="$(cat "$LOG_DIR/bot.pid" 2>/dev/null || echo 0)"
  track_pid "$BOT_PID"
  sleep 2
  if ! kill -0 "$BOT_PID" 2>/dev/null; then
    echo "!! bot 启动失败:" >&2
    tail -n 20 "$LOG_DIR/bot.log" >&2
  else
    grep -E "Anthropic 桥已启动|语音控制页" "$LOG_DIR/bot.log" | tail -n 2
    echo "    语音开关: http://127.0.0.1:5100"
  fi
fi

# ---------- 4. SnowLuma ----------
echo "==> [4/4] SnowLuma QQ 网关"
echo "    WebUI: http://127.0.0.1:5099"
echo "    首次运行: 登录 → 接受 EULA → 接入 QQ → 配置 OneBot WS 127.0.0.1:3001"
echo "    access token 建议留空以匹配 config.json;若保留 token,请复制到 onebot.accessToken"
echo "------------------------------------------"
SNOWLUMA_PID=""
if port_busy 5099; then
  echo "    已在运行,跳过(外部启动的 SnowLuma)"
  while :; do sleep 3600; done
elif [ -n "$SNOWLUMA_CMD" ]; then
  sh -c "$SNOWLUMA_CMD" &
  SNOWLUMA_PID=$!
elif [ -x "$SNOWLUMA_DIR/launcher.sh" ]; then
  (
    cd "$SNOWLUMA_DIR" || exit 1
    exec ./launcher.sh
  ) &
  SNOWLUMA_PID=$!
elif command -v snowluma > /dev/null 2>&1; then
  snowluma &
  SNOWLUMA_PID=$!
else
  echo "!! 未找到 SnowLuma 发行包。" >&2
  echo "   从 https://github.com/SnowLuma/SnowLuma/releases 下载后解压到:" >&2
  echo "     $SNOWLUMA_DIR" >&2
  echo "   或用 SNOWLUMA_DIR=/path/to/SnowLuma 指定。" >&2
  echo "==> 其余服务已在后台运行,日志目录: $LOG_DIR" >&2
  echo "    Ctrl+C 结束全部服务。" >&2
  while :; do sleep 3600; done
fi

track_pid "$SNOWLUMA_PID"
wait "$SNOWLUMA_PID"
