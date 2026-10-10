#!/usr/bin/env python3
"""Voxa render server: real Blender (Cycles) renders of the app's exact rooms.

The app sends a zip with two files, the room as glTF (room.glb, the same scene
the app shows) and scene.json (cameras and lights). The server validates both,
queues a job, and renders it with its own trusted copy of voxa_render.py,
through the `bpy` module or a Blender executable (BLENDER_BIN). It never runs
code it receives.

    POST /jobs?shots=entry,back&samples=128&percent=100   body: application/zip
    GET  /jobs/<id>                 status: queued | running | done | failed
    GET  /jobs/<id>/<shot>.png      a finished render
    GET  /health                    version, device, queue, whether your token is accepted

Standard library only. One render at a time; jobs and images expire after JOB_TTL.

Environment:
    HOST (0.0.0.0)  PORT (8080)  RENDER_TOKEN (required bearer token, recommended)
    ALLOWED_ORIGINS ("*" or a comma list, e.g. https://you.github.io)
    BLENDER_BIN (use a Blender executable instead of the bpy module)
    RENDER_DEVICE (auto | gpu | cpu)  MAX_SAMPLES (512)  MAX_UPLOAD_MB (80)
    JOB_TIMEOUT (1500 s)  JOB_TTL (3600 s)  MAX_QUEUE (8)  WORK_DIR (temp)
"""

import hmac
import io
import json
import math
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERSION = "1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "voxa_render.py")
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
TOKEN = os.environ.get("RENDER_TOKEN", "")
ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
BLENDER_BIN = os.environ.get("BLENDER_BIN", "")
DEVICE = os.environ.get("RENDER_DEVICE", "auto")
MAX_SAMPLES = int(os.environ.get("MAX_SAMPLES", "512"))
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "80")) * 1024 * 1024
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "1500"))
JOB_TTL = int(os.environ.get("JOB_TTL", "3600"))
MAX_QUEUE = int(os.environ.get("MAX_QUEUE", "8"))
WORK = os.environ.get("WORK_DIR") or tempfile.mkdtemp(prefix="voxa-jobs-")

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
LIGHT_KINDS = {"sun", "area", "spot", "point"}

jobs = {}
jobs_lock = threading.Lock()
work_queue = queue.Queue()
info = {"blender": None, "device": None}


class BadRequest(Exception):
    pass


# ----------------------------------------------------------------- validation


def num(v, lo, hi, what):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < lo or v > hi:
        raise BadRequest(f"{what} must be a number between {lo} and {hi}")
    return float(v)


def vec(v, n, lo, hi, what):
    if not isinstance(v, list) or len(v) != n:
        raise BadRequest(f"{what} must be a list of {n} numbers")
    return [num(x, lo, hi, what) for x in v]


def text(v, limit, what):
    if not isinstance(v, str) or not v.strip() or len(v) > limit or any(ord(c) < 32 for c in v):
        raise BadRequest(f"{what} must be a short single-line string")
    return v


def clean_scene(raw):
    """Rebuild scene.json from validated values only."""
    if not isinstance(raw, dict):
        raise BadRequest("scene.json must be an object")
    shots = raw.get("shots")
    if not isinstance(shots, list) or not 1 <= len(shots) <= 40:
        raise BadRequest("scene.json needs 1 to 40 shots")
    out_shots, seen = [], set()
    for s in shots:
        if not isinstance(s, dict):
            raise BadRequest("each shot must be an object")
        sid = text(s.get("id"), 64, "shot id")
        if not ID_RE.match(sid) or sid in seen:
            raise BadRequest("shot ids must be unique letters, digits, - or _")
        seen.add(sid)
        hide = s.get("hide", [])
        if not isinstance(hide, list) or len(hide) > 100:
            raise BadRequest("shot.hide must be a list")
        out_shots.append(
            {
                "id": sid,
                "name": text(s.get("name"), 80, "shot name"),
                "loc": vec(s.get("loc"), 3, -1000, 1000, "shot.loc"),
                "target": vec(s.get("target"), 3, -1000, 1000, "shot.target"),
                "fov": num(s.get("fov"), 5, 150, "shot.fov"),
                "shift_y": num(s.get("shift_y"), -2, 2, "shot.shift_y"),
                "clip_start": num(s.get("clip_start"), 0.001, 50, "shot.clip_start"),
                "hide": [text(h, 80, "shot.hide entry") for h in hide],
            }
        )
    lights = raw.get("lights", [])
    if not isinstance(lights, list) or len(lights) > 300:
        raise BadRequest("scene.json lights must be a list of at most 300")
    out_lights = []
    for l in lights:
        if not isinstance(l, dict) or l.get("kind") not in LIGHT_KINDS:
            raise BadRequest("each light needs a kind: sun, area, spot or point")
        item = {
            "kind": l["kind"],
            "name": text(l.get("name"), 40, "light name"),
            "loc": vec(l.get("loc"), 3, -1000, 1000, "light.loc"),
            "target": vec(l.get("target"), 3, -1000, 1000, "light.target"),
            "power": num(l.get("power"), 0, 100000, "light.power"),
            "color": vec(l.get("color"), 3, 0, 1, "light.color"),
        }
        if l["kind"] == "area":
            item["size"] = vec(l.get("size"), 2, 0.001, 50, "light.size")
        out_lights.append(item)
    room = raw.get("room") if isinstance(raw.get("room"), dict) else {}
    out = {
        "room": {
            "name": text(room.get("name", "Room"), 80, "room name"),
            "width": num(room.get("width", 4), 0.5, 100, "room width"),
            "depth": num(room.get("depth", 4), 0.5, 100, "room depth"),
            "height": num(room.get("height", 3), 1.5, 20, "room height"),
        },
        "shots": out_shots,
        "lights": out_lights,
    }
    # Lighting mood: the sky colour and strength, and the view exposure (all optional).
    world = raw.get("world")
    if world is not None:
        if not isinstance(world, dict):
            raise BadRequest("scene.json world must be an object")
        out["world"] = {
            "color": vec(world.get("color", [0.78, 0.84, 0.95]), 3, 0, 1, "world.color"),
            "strength": num(world.get("strength", 0.6), 0, 10, "world.strength"),
        }
    if raw.get("exposure") is not None:
        out["exposure"] = num(raw.get("exposure"), -10, 10, "exposure")
    return out


def read_package(body):
    """Take only room.glb and scene.json out of the uploaded zip, with size checks."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile:
        raise BadRequest("the body must be a zip with room.glb and scene.json")
    try:
        glb_info = zf.getinfo("room.glb")
        scene_info = zf.getinfo("scene.json")
    except KeyError:
        raise BadRequest("the zip must contain room.glb and scene.json")
    if glb_info.file_size > MAX_UPLOAD or scene_info.file_size > 2 * 1024 * 1024:
        raise BadRequest("room.glb or scene.json is too large")
    glb = zf.read(glb_info)
    if glb[:4] != b"glTF":
        raise BadRequest("room.glb is not a binary glTF file")
    try:
        scene = clean_scene(json.loads(zf.read(scene_info).decode("utf-8")))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BadRequest("scene.json is not valid JSON")
    return glb, scene


# ----------------------------------------------------------------------- jobs


def public(job):
    with jobs_lock:
        ahead = sum(1 for j in jobs.values() if j["status"] == "queued" and j["created"] < job["created"])
        now = time.time()
        return {
            "id": job["id"],
            "status": job["status"],
            "position": ahead if job["status"] == "queued" else 0,
            "shots": [{"id": s, "done": s in job["done"], "image": f"/jobs/{job['id']}/{s}.png" if s in job["done"] else None} for s in job["shots"]],
            "samples": job["samples"],
            "percent": job["percent"],
            "device": job.get("device"),
            "elapsed": round((job.get("finished") or now) - job["started"], 1) if job.get("started") else 0,
            "error": job.get("error"),
        }


def run_job(job):
    d = job["dir"]
    out = os.path.join(d, "renders")
    if BLENDER_BIN:
        cmd = [BLENDER_BIN, "--background", "--factory-startup", "--python", SCRIPT, "--"]
    else:
        cmd = [sys.executable, SCRIPT, "--"]
    cmd += [
        "--job", os.path.join(d, "scene.json"),
        "--glb", os.path.join(d, "room.glb"),
        "--out", out,
        "--render",
        "--samples", str(job["samples"]),
        "--percent", str(job["percent"]),
        "--time-limit", str(job["time_limit"]),
        "--device", DEVICE,
    ] + job["shots"]
    tail = []
    proc = subprocess.Popen(cmd, cwd=d, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
    timer = threading.Timer(JOB_TIMEOUT, proc.kill)
    timer.start()
    try:
        for line in proc.stdout:
            line = line.rstrip()
            if line.startswith("VOXA_DEVICE "):
                job["device"] = line.split(" ", 1)[1]
                info["device"] = job["device"]
            elif line.startswith("VOXA_RENDERED "):
                job["done"].add(line.split(" ")[1])
            elif line and not line.startswith("Fra:"):
                tail.append(line)
                del tail[:-30]
        code = proc.wait()
    finally:
        timer.cancel()
    missing = [s for s in job["shots"] if not os.path.isfile(os.path.join(out, f"{s}.png"))]
    if code != 0 or missing:
        reason = "the render timed out" if code in (-9, 137) else f"Blender exited with code {code}" if code else f"no image for {', '.join(missing)}"
        raise RuntimeError(f"{reason}. " + " | ".join(tail[-6:]))


def worker():
    while True:
        job = work_queue.get()
        job["status"] = "running"
        job["started"] = time.time()
        try:
            run_job(job)
            job["status"] = "done"
        except Exception as e:  # report every failure to the client
            job["status"] = "failed"
            job["error"] = str(e)[:1500]
        job["finished"] = time.time()
        print(f"job {job['id']} {job['status']} in {job['finished'] - job['started']:.1f}s", flush=True)


def janitor():
    while True:
        time.sleep(60)
        cutoff = time.time() - JOB_TTL
        with jobs_lock:
            old = [j for j in jobs.values() if j.get("finished") and j["finished"] < cutoff]
            for j in old:
                jobs.pop(j["id"], None)
        for j in old:
            shutil.rmtree(j["dir"], ignore_errors=True)


def probe_blender():
    cmd = [BLENDER_BIN, "--background", "--factory-startup", "--python-expr", "import bpy; print('VOXA_VERSION', bpy.app.version_string)"] if BLENDER_BIN else [sys.executable, "-c", "import bpy; print('VOXA_VERSION', bpy.app.version_string)"]
    try:
        outp = subprocess.run(cmd, capture_output=True, text=True, timeout=120).stdout
        m = re.search(r"VOXA_VERSION (\S+)", outp)
        info["blender"] = m.group(1) if m else "unavailable"
    except Exception:
        info["blender"] = "unavailable"


# ----------------------------------------------------------------------- http


class Handler(BaseHTTPRequestHandler):
    server_version = f"VoxaRender/{VERSION}"

    def cors(self):
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if "*" in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", "*")
        elif origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Max-Age", "600")

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        if not TOKEN:
            return True
        got = self.headers.get("Authorization", "")
        return got.startswith("Bearer ") and hmac.compare_digest(got[7:].strip().encode(), TOKEN.encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")
        if path in ("", "/health"):
            with jobs_lock:
                waiting = sum(1 for j in jobs.values() if j["status"] in ("queued", "running"))
            return self.send_json(200, {"ok": True, "service": "voxa-render", "version": VERSION, "blender": info["blender"], "device": info["device"] or DEVICE, "queue": waiting, "authRequired": bool(TOKEN), "authorized": self.authorized()})
        if not self.authorized():
            return self.send_json(401, {"error": "Missing or wrong render token."})
        m = re.match(r"^/jobs/([0-9a-f]{32})(?:/([A-Za-z0-9_-]{1,64})\.png)?$", path)
        if not m:
            return self.send_json(404, {"error": "Not found."})
        with jobs_lock:
            job = jobs.get(m.group(1))
        if not job:
            return self.send_json(404, {"error": "No such job (it may have expired)."})
        if not m.group(2):
            return self.send_json(200, public(job))
        file = os.path.join(job["dir"], "renders", f"{m.group(2)}.png")
        if m.group(2) not in job["shots"] or not os.path.isfile(file):
            return self.send_json(404, {"error": "That render is not ready."})
        with open(file, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path.rstrip("/") != "/jobs":
            return self.send_json(404, {"error": "Not found."})
        if not self.authorized():
            return self.send_json(401, {"error": "Missing or wrong render token."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            return self.send_json(411, {"error": "Send the zip with a Content-Length."})
        if length > MAX_UPLOAD:
            return self.send_json(413, {"error": f"The upload is larger than {MAX_UPLOAD // (1024 * 1024)} MB."})
        body = self.rfile.read(length)
        q = parse_qs(url.query)
        try:
            glb, scene = read_package(body)
            ids = [s["id"] for s in scene["shots"]]
            wanted = [s for s in ",".join(q.get("shots", [""])).split(",") if s] or ids[:1]
            if any(s not in ids for s in wanted) or len(wanted) > 12:
                raise BadRequest("shots must name up to 12 shot ids from scene.json")
            samples = int(num(float(q.get("samples", ["128"])[0]), 1, MAX_SAMPLES, "samples"))
            percent = int(num(float(q.get("percent", ["100"])[0]), 10, 100, "percent"))
            time_limit = int(num(float(q.get("timeLimit", ["0"])[0]), 0, JOB_TIMEOUT, "timeLimit"))
        except BadRequest as e:
            return self.send_json(400, {"error": str(e)})
        except ValueError:
            return self.send_json(400, {"error": "samples, percent and timeLimit must be numbers."})
        with jobs_lock:
            waiting = sum(1 for j in jobs.values() if j["status"] in ("queued", "running"))
        if waiting >= MAX_QUEUE:
            return self.send_json(429, {"error": "The render queue is full, try again in a few minutes."})
        jid = uuid.uuid4().hex
        d = os.path.join(WORK, jid)
        os.makedirs(d)
        with open(os.path.join(d, "room.glb"), "wb") as f:
            f.write(glb)
        with open(os.path.join(d, "scene.json"), "w", encoding="utf-8") as f:
            json.dump(scene, f)
        job = {"id": jid, "dir": d, "status": "queued", "created": time.time(), "shots": wanted, "done": set(), "samples": samples, "percent": percent, "time_limit": time_limit}
        with jobs_lock:
            jobs[jid] = job
        work_queue.put(job)
        print(f"job {jid} queued: {','.join(wanted)} samples={samples} percent={percent}", flush=True)
        self.send_json(202, public(job))

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def main():
    if not TOKEN:
        print("WARNING: RENDER_TOKEN is not set; anyone who can reach this server can render on it.", flush=True)
    threading.Thread(target=probe_blender, daemon=True).start()
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=janitor, daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.daemon_threads = True
    print(f"Voxa render server on :{PORT} (work dir {WORK}, device {DEVICE}, {'Blender ' + BLENDER_BIN if BLENDER_BIN else 'bpy module'})", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
