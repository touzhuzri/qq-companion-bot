#!/usr/bin/env bash
# 启动本地推理服务(文本 + 视觉),OpenAI 兼容端点:http://127.0.0.1:8080/v1
#
# 默认按 models/qwen3-vl-4b/ 下的两个 gguf 启动;换模型时用环境变量覆盖:
#   MODEL_DIR=... MODEL_FILE=... MMPROJ_FILE=... LLAMA_PORT=... ./scripts/start-llama.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_DIR="${MODEL_DIR:-$ROOT/models/qwen3-vl-4b}"
# 本机布局:模型放在项目同级的 models/ 下
if [ "$MODEL_DIR" = "$ROOT/models/qwen3-vl-4b" ] && [ ! -d "$MODEL_DIR" ] && [ -d "$ROOT/../models/qwen3-vl-4b" ]; then
  MODEL_DIR="$ROOT/../models/qwen3-vl-4b"
fi
MODEL_FILE="${MODEL_FILE:-Qwen3VL-4B-Instruct-Q4_K_M.gguf}"
MMPROJ_FILE="${MMPROJ_FILE:-mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf}"
PORT="${LLAMA_PORT:-8080}"

# Q8_0 投影不存在时退回 F16
if [ ! -f "$MODEL_DIR/$MMPROJ_FILE" ] && [ -f "$MODEL_DIR/mmproj-Qwen3VL-4B-Instruct-F16.gguf" ]; then
  MMPROJ_FILE="mmproj-Qwen3VL-4B-Instruct-F16.gguf"
fi

if [ ! -f "$MODEL_DIR/$MODEL_FILE" ]; then
  echo "!! 找不到模型文件 $MODEL_DIR/$MODEL_FILE" >&2
  echo "   把 gguf 放进该目录,或用 MODEL_DIR/MODEL_FILE 指定;也可以改用任意 OpenAI 兼容端点。" >&2
  exit 1
fi
if [ ! -f "$MODEL_DIR/$MMPROJ_FILE" ]; then
  echo "!! 找不到视觉投影文件 $MODEL_DIR/$MMPROJ_FILE(纯文本模型可去掉 --mmproj)" >&2
  exit 1
fi

exec llama-server \
  -m "$MODEL_DIR/$MODEL_FILE" \
  --mmproj "$MODEL_DIR/$MMPROJ_FILE" \
  --host 127.0.0.1 \
  --port "$PORT" \
  -ngl 99 \
  -c 4096
