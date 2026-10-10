#!/usr/bin/env python3
"""End-to-end check of a running Voxa render server.

Builds a tiny room (a floor and a box) as room.glb with Blender itself,
submits one shot at low quality, waits for the job and checks that a PNG comes
back. Also checks that a bad token and a bad upload are refused.

    python smoke_test.py http://127.0.0.1:8080 <RENDER_TOKEN>

Needs the bpy module (or run it inside the server's Docker image).
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080").rstrip("/")
TOKEN = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("RENDER_TOKEN", "")

MAKE_GLB = r"""
import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_plane_add(size=4, location=(2, -2, 0))
bpy.ops.mesh.primitive_cube_add(size=1, location=(2, -2, 0.5))
bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format="GLB")
"""

SCENE = {
    "room": {"name": "Smoke test", "width": 4, "depth": 4, "height": 3},
    "shots": [{"id": "entry", "name": "Entry view", "loc": [2, -5.5, 1.55], "target": [2, 0, 1.0], "fov": 62, "shift_y": -0.05, "clip_start": 0.05, "hide": []}],
    "lights": [{"kind": "sun", "name": "Sun", "loc": [0, -6, 6], "target": [2, -2, 0], "power": 3, "color": [1, 0.95, 0.9]}],
}


def request(method, path, body=None, token=TOKEN, ctype=None):
    req = urllib.request.Request(URL + path, data=body, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    status, body = request("GET", "/health")
    health = json.loads(body)
    assert status == 200 and health.get("service") == "voxa-render", body
    print("health:", health)
    if health["authRequired"]:
        assert request("POST", "/jobs", b"x", token="wrong", ctype="application/zip")[0] == 401, "a wrong token must be refused"
    assert request("POST", "/jobs", b"not a zip", ctype="application/zip")[0] == 400, "a bad upload must be refused"

    with tempfile.TemporaryDirectory() as d:
        glb = os.path.join(d, "room.glb")
        subprocess.run([sys.executable, "-c", MAKE_GLB, glb], check=True, capture_output=True)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.write(glb, "room.glb")
            z.writestr("scene.json", json.dumps(SCENE))
            z.writestr("render_in_blender.py", "raise SystemExit('the server must never run uploaded code')")
    status, body = request("POST", "/jobs?shots=entry&samples=8&percent=20", buf.getvalue(), ctype="application/zip")
    assert status == 202, body
    job = json.loads(body)
    print("job:", job["id"])
    deadline = time.time() + 600
    while job["status"] in ("queued", "running"):
        assert time.time() < deadline, "the render took too long"
        time.sleep(2)
        job = json.loads(request("GET", f"/jobs/{job['id']}")[1])
    assert job["status"] == "done", job
    status, png = request("GET", f"/jobs/{job['id']}/entry.png")
    assert status == 200 and png[:8] == b"\x89PNG\r\n\x1a\n", "no PNG came back"
    print(f"ok: {len(png)} byte PNG rendered on {job['device']} in {job['elapsed']} s")


if __name__ == "__main__":
    main()
