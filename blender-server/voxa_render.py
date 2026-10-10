# Voxa room renderer for Blender (Cycles).
#
# One script, two uses:
#   * In the app's "Download for Blender" package it is render_in_blender.py,
#     with the room's scene data embedded above this code as DATA_JSON.
#   * On the Voxa render server it is run with --job scene.json --glb room.glb
#     --out DIR. The server only ever runs this trusted copy; it never runs
#     code it was sent.
#
# It imports room.glb (the exact room from the app), adds one camera per shot
# (vertical FOV, lens shift, a clip start that cuts away the wall behind the
# camera), the room's lights, a sky, and Cycles render settings.
#
# Options after "--":
#   --render                 render the shots (otherwise just set the scene up)
#   --samples N              Cycles samples (default 128)
#   --percent P              resolution percentage of 1600x1200 (default 100)
#   --time-limit S           stop sampling a frame after S seconds (0 = off)
#   --device auto|cpu|gpu    render device (default auto: the best GPU, else CPU)
#   --job FILE --glb FILE --out DIR   (render server) scene data, model, output
#   shot ids                 render only these shots (default: all)

import bpy, json, math, os, re, sys
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VALUE_FLAGS = {"--job", "--glb", "--out", "--samples", "--percent", "--time-limit", "--device"}
GLB_NAME = "room.glb"


def arg(name, default=None):
    if name in ARGV:
        i = ARGV.index(name)
        if i + 1 < len(ARGV):
            return ARGV[i + 1]
    return default


def positional():
    out, skip = [], False
    for a in ARGV:
        if skip:
            skip = False
        elif a in VALUE_FLAGS:
            skip = True
        elif not a.startswith("--"):
            out.append(a)
    return out


def load_data():
    job = arg("--job")
    if job:
        with open(job, encoding="utf-8") as f:
            return json.load(f)
    try:
        return json.loads(DATA_JSON)  # noqa: F821 (embedded by the app's download)
    except NameError:
        raise SystemExit("No scene data: run render_in_blender.py from the Voxa download, or pass --job scene.json")


DATA = load_data()


def here_candidates():
    c = []
    try:
        c.append(os.path.dirname(os.path.abspath(__file__)))
    except NameError:
        pass
    for t in bpy.data.texts:
        if t.filepath:
            c.append(os.path.dirname(bpy.path.abspath(t.filepath)))
    if bpy.data.filepath:
        c.append(os.path.dirname(bpy.data.filepath))
    c += [os.getcwd(), os.path.expanduser("~/Downloads")]
    return c


def find_glb():
    explicit = arg("--glb")
    if explicit:
        if os.path.isfile(explicit):
            return explicit
        raise FileNotFoundError(explicit)
    for d in here_candidates():
        p = os.path.join(d, GLB_NAME)
        if os.path.isfile(p):
            return p
    raise FileNotFoundError("room.glb not found: keep it in the same folder as this script")


def base(name):
    return re.sub(r"\.\d{3}$", "", name)


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def setup():
    # Fresh scene.
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=find_glb())
    root_col = bpy.context.scene.collection

    cams = bpy.data.collections.new("Shots")
    root_col.children.link(cams)
    for s in DATA["shots"]:
        cd = bpy.data.cameras.new(s["name"])
        cd.lens_unit = "FOV"
        cd.sensor_fit = "VERTICAL"
        cd.angle = math.radians(s["fov"])
        cd.shift_y = s["shift_y"]
        cd.clip_start = s["clip_start"]
        cd.clip_end = 200
        ob = bpy.data.objects.new(s["name"], cd)
        ob.location = s["loc"]
        look_at(ob, s["target"])
        ob["voxa_shot"] = s["id"]
        cams.objects.link(ob)

    lights = bpy.data.collections.new("Lights")
    root_col.children.link(lights)
    for i, l in enumerate(DATA["lights"]):
        kind = {"sun": "SUN", "area": "AREA", "spot": "SPOT", "point": "POINT"}[l["kind"]]
        ld = bpy.data.lights.new(f'{l["name"]} {i + 1}', kind)
        ld.color = l["color"]
        ld.energy = l["power"]
        if kind == "AREA":
            ld.shape = "RECTANGLE"
            ld.size, ld.size_y = l["size"]
        if kind == "SPOT":
            ld.spot_size = math.radians(90)
            ld.spot_blend = 0.6
            ld.shadow_soft_size = 0.05
        if kind == "POINT":
            ld.shadow_soft_size = 0.08
        if kind == "SUN":
            ld.angle = math.radians(1.5)
        ob = bpy.data.objects.new(ld.name, ld)
        ob.location = l["loc"]
        look_at(ob, l["target"])
        lights.objects.link(ob)

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    # The sky for the room's lighting mood (day, evening, night).
    sky = DATA.get("world") or {}
    if bg:
        r, g, b = sky.get("color", (0.78, 0.84, 0.95))
        bg.inputs[0].default_value = (r, g, b, 1)
        bg.inputs[1].default_value = sky.get("strength", 0.6)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 128
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1200
    try:
        sc.view_settings.view_transform = "AgX"
    except TypeError:
        sc.view_settings.view_transform = "Filmic"
    sc.view_settings.exposure = DATA.get("exposure", 0.3)
    sc.camera = bpy.data.objects[DATA["shots"][0]["name"]]
    return cams


def choose_device(want):
    """Use the best GPU Cycles can see (OptiX, CUDA, HIP, oneAPI, Metal), else the CPU."""
    sc = bpy.context.scene
    if want == "cpu":
        sc.cycles.device = "CPU"
        return "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        sc.cycles.device = "CPU"
        return "CPU"
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        refresh = getattr(prefs, "refresh_devices", None)
        if refresh:
            refresh()
        else:
            prefs.get_devices()
        found = [d for d in prefs.devices if d.type == kind]
        if found:
            for d in prefs.devices:
                d.use = d.type == kind
            sc.cycles.device = "GPU"
            return kind
    if want == "gpu":
        print("VOXA_WARNING no GPU found, rendering on the CPU", flush=True)
    try:
        prefs.compute_device_type = "NONE"
    except TypeError:
        pass
    sc.cycles.device = "CPU"
    return "CPU"


def objects_named(names):
    want = set(names)
    out = []
    for o in bpy.data.objects:
        if base(o.name) in want:
            out.append(o)
            out.extend(o.children_recursive)
    return out


def sync_camera(scene, _depsgraph=None):
    """Interactive use: whenever the active camera changes, hide what that shot
    hides (the wall it stands behind and what hangs or stands against it)."""
    cam = scene.camera.name if scene.camera else None
    state = bpy.app.driver_namespace.setdefault("voxa_camera", {"camera": None, "hidden": []})
    if cam == state["camera"]:
        return
    state["camera"] = cam
    for name in state["hidden"]:
        o = bpy.data.objects.get(name)
        if o:
            o.hide_render = False
            try:
                o.hide_set(False)
            except RuntimeError:
                pass
    shot = next((s for s in DATA["shots"] if s["name"] == cam), None)
    hide = objects_named(shot["hide"]) if shot else []
    state["hidden"] = [o.name for o in hide]
    for o in hide:
        o.hide_render = True
        try:
            o.hide_set(True)
        except RuntimeError:
            pass


def watch_cameras():
    handlers = bpy.app.handlers.depsgraph_update_post
    for h in [h for h in handlers if getattr(h, "__name__", "") == "sync_camera"]:
        handlers.remove(h)
    handlers.append(sync_camera)
    sync_camera(bpy.context.scene)


def render_all(only, samples, out_dir):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    os.makedirs(out_dir, exist_ok=True)
    for s in DATA["shots"]:
        if only and s["id"] not in only:
            continue
        hidden = [o for o in objects_named(s["hide"]) if not o.hide_render]
        for o in hidden:
            o.hide_render = True
        sc.camera = bpy.data.objects[s["name"]]
        sc.render.filepath = os.path.join(out_dir, f'{s["id"]}.png')
        bpy.ops.render.render(write_still=True)
        for o in hidden:
            o.hide_render = False
        print("VOXA_RENDERED", s["id"], sc.render.filepath, flush=True)


setup()
if "--render" not in ARGV:
    watch_cameras()
else:
    sc = bpy.context.scene
    print("VOXA_DEVICE", choose_device(arg("--device", "auto")), flush=True)
    sc.render.resolution_percentage = max(10, min(100, int(arg("--percent", "100"))))
    limit = float(arg("--time-limit", "0"))
    if limit > 0:
        sc.cycles.time_limit = limit
    out_dir = arg("--out") or os.path.join(os.path.dirname(os.path.abspath(find_glb())), "renders")
    render_all(positional(), max(1, int(arg("--samples", "128"))), out_dir)
