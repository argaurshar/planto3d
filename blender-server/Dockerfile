# Voxa render server: Blender 5.0 (as the bpy Python module) + a small job API.
#
#   docker build -t voxa-render blender-server
#   docker run -p 8080:8080 -e RENDER_TOKEN=change-me voxa-render            # CPU
#   docker run --gpus all -p 8080:8080 -e RENDER_TOKEN=change-me voxa-render # NVIDIA GPU (OptiX/CUDA)
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics

# The X11/GL libraries bpy links against (it bundles the rest: Cycles, OIDN, OpenVDB…).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libx11-6 libxrender1 libxfixes3 libxi6 libxkbcommon0 libxext6 libxxf86vm1 libsm6 libgl1 \
 && rm -rf /var/lib/apt/lists/*

# Same Python (3.11) and Blender module version the server was tested with.
RUN pip install bpy==5.0.1

RUN useradd --create-home --uid 10001 render
WORKDIR /app
COPY server.py voxa_render.py smoke_test.py ./
USER render

ENV PORT=8080 RENDER_DEVICE=auto
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8080'), timeout=4)"
CMD ["python", "server.py"]
