# Voxa render server (Blender Cycles)

Renders the app's shots with **real Blender Cycles**, from the exact model and
the exact camera of each raw shot. In the app, every shot card gets
**🎬 Render in Blender**, with Draft or Final quality.

- The app sends a zip with the room as glTF (`room.glb`, the same scene the app
  shows) and `scene.json` (cameras and lights). The server validates both and
  renders them with its own copy of `voxa_render.py`. It **never runs code it
  receives**.
- `voxa_render.py` is also the script inside the app's "Download for Blender"
  package. The app imports this very file, so the two cannot drift.
- One render runs at a time. Jobs and images expire after an hour.
- It uses only the Python standard library plus Blender as the `bpy` module.

## API

| Method and path | What it does |
| --- | --- |
| `POST /jobs?shots=entry&samples=128&percent=100` | Body: `application/zip`. Returns `202` with the job. |
| `GET /jobs/<id>` | Returns `queued`, `running`, `done` or `failed`, plus progress. |
| `GET /jobs/<id>/<shot>.png` | Returns a finished render. |
| `GET /health` | Returns the Blender version, device, queue length and whether your token is accepted. |

Send the token as `Authorization: Bearer <RENDER_TOKEN>`.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `RENDER_TOKEN` | none | Bearer token every request must carry. **Set it.** Without it anyone can use your GPU. |
| `ALLOWED_ORIGINS` | `*` | Sites allowed to call the server from a browser, e.g. `https://argaurshar.github.io`. |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Where the server listens. |
| `RENDER_DEVICE` | `auto` | `auto` (best GPU: OptiX, CUDA, HIP, oneAPI or Metal, else CPU), `gpu` or `cpu`. |
| `BLENDER_BIN` | none | Path to a Blender executable to use instead of the `bpy` module. |
| `MAX_SAMPLES`, `MAX_UPLOAD_MB`, `MAX_QUEUE` | 512, 80, 8 | Limits. |
| `JOB_TIMEOUT`, `JOB_TTL` | 1500 s, 3600 s | Per-job time limit and how long results are kept. |

## Run it

On any machine with Python 3.11:

```bash
pip install bpy==5.0.1
RENDER_TOKEN=change-me ALLOWED_ORIGINS=http://localhost:3000 python server.py
python smoke_test.py http://127.0.0.1:8080 change-me   # renders a tiny room
```

With Docker (CPU, or an NVIDIA GPU with `--gpus all`):

```bash
docker build -t voxa-render blender-server
docker run -d -p 8080:8080 --gpus all \
  -e RENDER_TOKEN=change-me -e ALLOWED_ORIGINS=https://argaurshar.github.io voxa-render
```

The `Render server image` workflow builds the same image in CI and renders a
test room inside it. On `main` it publishes the image as
`ghcr.io/argaurshar/planto3d-render:latest`. To pull it without logging in,
make the package public on GitHub.

## Host it

The app on GitHub Pages is served over HTTPS, so the server must be HTTPS too.
Use one of these:

**Google Cloud Run with an NVIDIA L4 GPU (recommended).** It scales to zero, so
you pay only while renders run, and gives HTTPS out of the box. Run this from
the repo root:

```bash
gcloud run deploy voxa-render --source blender-server --region us-central1 \
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy \
  --cpu 8 --memory 32Gi --max-instances 1 --concurrency 8 \
  --no-cpu-throttling --timeout 3600 --allow-unauthenticated \
  --set-env-vars RENDER_TOKEN=change-me,ALLOWED_ORIGINS=https://argaurshar.github.io
```

- `--max-instances 1` keeps every job on the one instance that holds it.
- `--no-cpu-throttling` lets renders continue after the upload request returns.
- `--allow-unauthenticated` lets the browser reach the server; `RENDER_TOKEN`
  is what protects it.

**Any GPU machine** (RunPod, Lambda, Vast.ai, your own PC): run the Docker image
with `--gpus all` behind an HTTPS proxy such as Caddy, or behind the host's own
HTTPS endpoint.

**A CPU-only host** (Render.com, Fly.io, Railway) also works, just slowly. On 4
CPU cores a Draft render took about 3 minutes in testing. A Final render takes
far longer.

## Connect the app

At the bottom of the app, open **Connect a Blender render server**, enter the
URL and token, and press **Test & save**. Both are stored in that browser only.

To build the URL into the GitHub Pages site, set the repository variable
`BLENDER_SERVER_URL` (Settings → Secrets and variables → Actions → Variables).
The token is never built in; each user types it once.
