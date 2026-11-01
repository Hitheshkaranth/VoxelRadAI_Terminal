#!/bin/bash
# Download the pinned Skanda release and produce a local MLX Q4 package.
set -euo pipefail
cd "$(dirname "$0")/../.."
revision=a9c61d4aac36868f0b077d013e6e3b7745fadbea
runtime="$PWD/model-runtime"
mkdir -p "$runtime"
if [ ! -x "$runtime/.venv/bin/python" ]; then
  uv venv "$runtime/.venv" --python 3.12
fi
UV_HTTP_TIMEOUT=120 uv pip install --python "$runtime/.venv/bin/python" mlx safetensors numpy
"$runtime/.venv/bin/python" app/scripts/convert-skanda-q4.py --self-test
HF_HUB_DISABLE_XET=1 HF_HUB_DOWNLOAD_TIMEOUT=120 hf download hitheshkaranth/skanda-grounding \
  --revision "$revision" --local-dir "$runtime/skanda-r3-bf16" --max-workers 2
"$runtime/.venv/bin/python" -u app/scripts/convert-skanda-q4.py \
  --source "$runtime/skanda-r3-bf16" --output "$runtime/skanda-r3-q4-mlx" --revision "$revision"
