// The live 3D view and the raw-shot renderer. One WebGL renderer with a
// physically based pipeline — soft image-based light, a shadow-casting sun,
// area light at the windows, ground-truth ambient occlusion (GTAO), a touch of
// bloom on lamps and windows, filmic tone mapping — so a "raw shot" of the
// model already reads as a semi-rendered interior, like a Blender Eevee frame.
//
// Browser only. Everything three.js is loaded dynamically.

import type { RoomModel, Shot } from "./types";
import { loadThree, type ThreeBundle } from "./kit";
import { buildRoomScene, type RoomScene } from "./scene";
import { moodSpec } from "./moods";

type THREEType = typeof import("three");

interface ViewportModules {
  T: ThreeBundle;
  OrbitControls: typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
  EffectComposer: typeof import("three/examples/jsm/postprocessing/EffectComposer.js").EffectComposer;
  RenderPass: typeof import("three/examples/jsm/postprocessing/RenderPass.js").RenderPass;
  GTAOPass: typeof import("three/examples/jsm/postprocessing/GTAOPass.js").GTAOPass;
  UnrealBloomPass: typeof import("three/examples/jsm/postprocessing/UnrealBloomPass.js").UnrealBloomPass;
  OutputPass: typeof import("three/examples/jsm/postprocessing/OutputPass.js").OutputPass;
  RoomEnvironment: typeof import("three/examples/jsm/environments/RoomEnvironment.js").RoomEnvironment;
  Reflector: typeof import("three/examples/jsm/objects/Reflector.js").Reflector;
}

let modules: Promise<ViewportModules> | null = null;

export function loadViewportModules(): Promise<ViewportModules> {
  if (!modules) {
    modules = (async () => {
      const [T, oc, ec, rp, gt, ub, op, re, ra, rf] = await Promise.all([
        loadThree(),
        import("three/examples/jsm/controls/OrbitControls.js"),
        import("three/examples/jsm/postprocessing/EffectComposer.js"),
        import("three/examples/jsm/postprocessing/RenderPass.js"),
        import("three/examples/jsm/postprocessing/GTAOPass.js"),
        import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
        import("three/examples/jsm/postprocessing/OutputPass.js"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
        import("three/examples/jsm/lights/RectAreaLightUniformsLib.js"),
        import("three/examples/jsm/objects/Reflector.js"),
      ]);
      ra.RectAreaLightUniformsLib.init();
      return {
        T,
        OrbitControls: oc.OrbitControls,
        EffectComposer: ec.EffectComposer,
        RenderPass: rp.RenderPass,
        GTAOPass: gt.GTAOPass,
        UnrealBloomPass: ub.UnrealBloomPass,
        OutputPass: op.OutputPass,
        RoomEnvironment: re.RoomEnvironment,
        Reflector: rf.Reflector,
      };
    })();
  }
  return modules;
}

export interface ViewportOptions {
  clay?: boolean;
}

type Composer = import("three/examples/jsm/postprocessing/EffectComposer.js").EffectComposer;

export class RoomViewport {
  readonly mods: ViewportModules;
  readonly THREE: THREEType;
  readonly renderer: import("three").WebGLRenderer;
  readonly camera: import("three").PerspectiveCamera;
  readonly controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
  readonly canvas: HTMLCanvasElement;
  private composer: Composer | null = null;
  private room: RoomScene | null = null;
  private model: RoomModel | null = null;
  private env: import("three").Texture | null = null;
  private shot: Shot | null = null;
  private hidden: import("three").Object3D[] = [];
  private selectionBox: import("three").BoxHelper | null = null;
  private selectedId: string | null = null;
  private frame = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  private clay = false;
  private reflectors: import("three/examples/jsm/objects/Reflector.js").Reflector[] = [];
  /** Called when the user orbits away from a preset shot. */
  onFreeCamera: (() => void) | null = null;

  private constructor(mods: ViewportModules, host: HTMLElement) {
    this.mods = mods;
    this.THREE = mods.T.THREE;
    const THREE = this.THREE;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.canvas.style.touchAction = "none";
    host.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(62, 4 / 3, 0.05, 200);
    this.controls = new mods.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomToCursor = true;
    // Leaving a preset shot only when the camera really moves (a click to
    // select a piece must not drop the shot's framing).
    let grabbed = false;
    this.controls.addEventListener("start", () => {
      grabbed = true;
    });
    this.controls.addEventListener("end", () => {
      grabbed = false;
    });
    this.controls.addEventListener("change", () => {
      if (grabbed && this.shot) {
        this.camera.clearViewOffset();
        this.camera.updateProjectionMatrix();
        this.showAll();
        this.shot = null;
        this.onFreeCamera?.();
      }
      this.requestRender();
    });

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new mods.RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const size = () => {
      const w = host.clientWidth || 800;
      const h = host.clientHeight || Math.round(w * 0.75);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.shot) this.applyLens(this.shot, w, h);
      this.buildComposer(w, h);
      this.requestRender();
    };
    this.ro = new ResizeObserver(size);
    this.ro.observe(host);
    size();
  }

  static async create(host: HTMLElement): Promise<RoomViewport> {
    const mods = await loadViewportModules();
    return new RoomViewport(mods, host);
  }

  private buildComposer(w: number, h: number): void {
    const THREE = this.THREE;
    this.composer?.dispose();
    const pr = this.renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new this.mods.EffectComposer(this.renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    if (this.room) {
      composer.addPass(new this.mods.RenderPass(this.room.scene, this.camera));
      const ao = new this.mods.GTAOPass(this.room.scene, this.camera, w, h);
      ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.1 });
      ao.blendIntensity = this.clay ? 1.0 : 0.85;
      composer.addPass(ao);
      // Only lamps, LEDs and the sky outside bloom; lit walls stay crisp.
      composer.addPass(new this.mods.UnrealBloomPass(new THREE.Vector2(w, h), 0.12, 0.4, 1.6));
      composer.addPass(new this.mods.OutputPass());
    }
    this.composer = composer;
  }

  /** Build (or rebuild) the room. Keeps the current camera. */
  setRoom(model: RoomModel, opts: ViewportOptions = {}): void {
    const keepShot = this.shot;
    this.clay = Boolean(opts.clay);
    this.disposeMirrors();
    this.room?.dispose();
    this.selectionBox = null;
    this.model = model;
    this.room = buildRoomScene(this.mods.T, model, { clay: this.clay });
    this.addMirrors();
    const mood = moodSpec(model);
    this.room.scene.environment = this.env;
    this.room.scene.environmentIntensity = this.clay ? Math.max(0.3, mood.env * 2) : mood.env;
    this.renderer.toneMappingExposure = mood.exposure;
    this.hidden = [];
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.buildComposer(w, h);
    if (keepShot) this.setShot(keepShot);
    else if (!this.camera.position.lengthSq()) this.frameRoom();
    if (this.selectedId) this.select(this.selectedId);
    this.requestRender();
  }

  /**
   * Mirrors reflect the room. The scene (shared with the Blender export) gives
   * them a mirror material, which Cycles renders correctly; here each one also
   * gets a planar reflector on its face, since a WebGL mirror material only
   * shows the environment map (it read as a flat white panel).
   */
  private addMirrors(): void {
    if (!this.room || this.clay) return;
    const THREE = this.THREE;
    const mirrorMat = this.room.materials.mirror();
    const meshes: import("three").Mesh[] = [];
    this.room.root.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.isMesh && mesh.material === mirrorMat) meshes.push(mesh);
    });
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox!;
      const flat = bb.max.z - bb.min.z < 1e-4;
      const geo = flat ? mesh.geometry.clone() : new THREE.PlaneGeometry(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
      const r = new this.mods.Reflector(geo, { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0xc9cfd2 });
      r.name = "mirror";
      r.userData.itemId = mesh.userData.itemId;
      r.quaternion.copy(mesh.quaternion);
      r.scale.copy(mesh.scale);
      const offset = flat ? new THREE.Vector3(0, 0, 0.0015) : new THREE.Vector3((bb.max.x + bb.min.x) / 2, (bb.max.y + bb.min.y) / 2, bb.max.z + 0.0015);
      r.position.copy(mesh.position).add(offset.applyQuaternion(mesh.quaternion));
      mesh.parent?.add(r);
      this.reflectors.push(r);
    }
  }

  private disposeMirrors(): void {
    for (const r of this.reflectors) {
      r.removeFromParent();
      r.dispose();
    }
    this.reflectors = [];
  }

  /** An overview from above one corner, used before any shot is chosen. */
  frameRoom(): void {
    if (!this.model) return;
    const { width: W, depth: D, height: H } = this.model;
    this.shot = null;
    this.showAll();
    this.camera.clearViewOffset();
    this.camera.fov = 50;
    this.camera.position.set(W * 1.15, H + Math.max(W, D) * 0.9, D * 1.35);
    this.controls.target.set(W / 2, 0.6, D / 2);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  private applyLens(shot: Shot, w: number, h: number): void {
    this.camera.fov = shot.fov;
    this.camera.aspect = w / h;
    if (shot.shiftY) this.camera.setViewOffset(w, h, 0, (-shot.shiftY * h) / 2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private showAll(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
  }

  private applyHide(names: string[]): void {
    this.showAll();
    if (!this.room || !names.length) return;
    const set = new Set(names);
    this.room.root.traverse((o) => {
      if (set.has(o.name) && o.visible) {
        o.visible = false;
        this.hidden.push(o);
      }
    });
  }

  /** Put the camera exactly on a preset shot. */
  setShot(shot: Shot): void {
    this.shot = shot;
    this.camera.position.set(...shot.pos);
    this.controls.target.set(...shot.target);
    this.camera.lookAt(...shot.target);
    this.applyLens(shot, this.canvas.clientWidth || 800, this.canvas.clientHeight || 600);
    this.applyHide(shot.hide);
    this.controls.update();
    this.requestRender();
  }

  /** The current camera as a shot (for "capture this view" after orbiting). */
  currentShot(label = "Custom view"): Shot {
    const p = this.camera.position;
    const t = this.controls.target;
    return {
      id: `custom-${Date.now()}`,
      label,
      pos: [p.x, p.y, p.z],
      target: [t.x, t.y, t.z],
      fov: this.camera.fov,
      shiftY: 0,
      hide: this.shot?.hide ?? [],
      note: "Your own camera position.",
    };
  }

  /** The model currently built in the scene. */
  get currentModel(): RoomModel | null {
    return this.model;
  }

  get isClay(): boolean {
    return this.clay;
  }

  get activeShot(): Shot | null {
    return this.shot;
  }

  /** The item under a screen point, if any. */
  pick(clientX: number, clientY: number): string | null {
    if (!this.room) return null;
    const THREE = this.THREE;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.room.root.children, true);
    for (const h of hits) {
      if (!visibleChain(h.object)) continue;
      const id = h.object.userData?.itemId as string | undefined;
      if (id) return id;
      if (h.object.name !== "glass" && h.object.name !== "curtains") return null;
    }
    return null;
  }

  /** Plan point (x, z) on the floor under a screen point. */
  floorPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const THREE = this.THREE;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { x: p.x, z: p.z } : null;
  }

  select(id: string | null): void {
    this.selectedId = id;
    if (this.selectionBox && this.room) {
      this.room.scene.remove(this.selectionBox);
      this.selectionBox.geometry.dispose();
      this.selectionBox = null;
    }
    const g = id ? this.room?.items.get(id) : null;
    if (g && this.room) {
      this.selectionBox = new this.THREE.BoxHelper(g, 0x5fe0b0);
      this.room.scene.add(this.selectionBox);
    }
    this.requestRender();
  }

  /** Move an item's group without rebuilding (live drag preview). */
  previewMove(id: string, x: number, z: number): void {
    const g = this.room?.items.get(id);
    if (!g) return;
    g.position.x = x;
    g.position.z = z;
    this.selectionBox?.update();
    this.requestRender();
  }

  /** Plan position of an item's group as currently shown. */
  itemPosition(id: string): { x: number; z: number } | null {
    const g = this.room?.items.get(id);
    return g ? { x: g.position.x, z: g.position.z } : null;
  }

  setOrbitEnabled(on: boolean): void {
    this.controls.enabled = on;
  }

  requestRender(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.controls.update()) this.requestRender();
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (!this.room) return;
    if (this.composer && this.composer.passes.length) this.composer.render();
    else this.renderer.render(this.room.scene, this.camera);
  }

  /**
   * Render a shot to a PNG data URL at a fixed size (default 1600×1200), then
   * restore the live view. The selection outline is never in a capture.
   */
  async capture(shot: Shot, width = 1600, height = 1200): Promise<string> {
    if (!this.room) throw new Error("No room to render yet.");
    const prev = {
      shot: this.shot,
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
      pr: this.renderer.getPixelRatio(),
      w: this.canvas.clientWidth || 800,
      h: this.canvas.clientHeight || 600,
    };
    const sel = this.selectionBox;
    if (sel) sel.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.position.set(...shot.pos);
    this.camera.lookAt(...shot.target);
    this.controls.target.set(...shot.target);
    this.applyLens(shot, width, height);
    this.applyHide(shot.hide);
    this.buildComposer(width, height);
    this.renderNow();
    const url = this.canvas.toDataURL("image/png");
    // Restore the live view.
    if (sel) sel.visible = true;
    this.renderer.setPixelRatio(prev.pr);
    this.renderer.setSize(prev.w, prev.h, false);
    if (prev.shot) {
      this.setShot(prev.shot);
    } else {
      this.camera.position.copy(prev.pos);
      this.controls.target.copy(prev.target);
      this.camera.fov = prev.fov;
      this.camera.aspect = prev.w / prev.h;
      this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      this.showAll();
    }
    this.buildComposer(prev.w, prev.h);
    this.requestRender();
    return url;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.ro?.disconnect();
    this.controls.dispose();
    this.composer?.dispose();
    this.disposeMirrors();
    this.room?.dispose();
    this.env?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

function visibleChain(o: import("three").Object3D | null): boolean {
  for (let cur = o; cur; cur = cur.parent) if (!cur.visible) return false;
  return true;
}
