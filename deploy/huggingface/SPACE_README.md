---
title: VoxelRad
thumbnail: https://huggingface.co/spaces/hitheshkaranth/VoxelRad/resolve/main/app/public/skanda-mark.png
emoji: 🩻
colorFrom: blue
colorTo: green
sdk: gradio
sdk_version: 6.32.0
python_version: 3.12
app_file: deploy/huggingface/space_app.py
fullWidth: true
startup_duration_timeout: 1h
suggested_hardware: zero-a10g
---

<p align="center"><img src="app/public/skanda-mark.png" width="104" alt="VoxelRad logo"></p>

# VoxelRad

The complete radiology application with Skanda V1 bf16, using ZeroGPU's
96 GB `xlarge` allocation for queued, occasional research reads.
The application is public; the Skanda V1 model repository and weights remain private.

Open **/workspace** to sign in. The root page is the application landing page.
The original application documentation is in [APPLICATION_README.md](APPLICATION_README.md).
Deployment details and storage limitations are in [docs/huggingface.md](docs/huggingface.md).

Research use only. Not a medical device. Every finding requires qualified review.
