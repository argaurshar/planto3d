# CLAUDE.md

Guidance for AI assistants (and humans) working in the **planto3d** (Voxa)
repository.

> **Status: v1 — exact-model redesign.** The earlier pipeline (an AI redrew
> every room from a clay blockout) hallucinated layouts and was removed. The
> app now builds one exact, true-scale room model and renders it itself. AI
> only reads the plan once, translates free-form commands into model edits,
> and optionally re-lights a finished shot. `npm run build` passes in both
> build modes. Keep this file accurate as the code changes.

## Product

The user uploads the plan of **one room** (JPEG / PNG / PDF; a multi-room
drawing is cropped with a box). The app:

1. **Reads the plan once** into a `RoomModel` (`lib/room/types.ts`): interior
   width × depth in metres, ceiling height, doors and windows on their walls,
   and every drawn piece of furniture with its real size, position and facing.
2. Builds the **exact 3D room** in the browser (Three.js) and gives a **raw
   shot** — a semi-rendered frame of the model — from the **main door at
   human eye level** first.
3. On request, takes **other shots**: from **behind the main element** (bed
   back in a bedroom, sofa back in a drawing room, desk, dining table…),
   facing it, from the corners and from the top.
4. Applies **edits by command**: "add bed back", "change the bed design",
   "change side table design", "make the sofa emerald velvet", "move the bed
   30 cm left", "delete that", "paint the walls sage", "remove false ceiling",
   "take shot from bed back"… plus panels for everything, undo and redo.
5. **Make realistic** (only when asked) sends a raw shot to Google Nano
   Banana with "keep everything exactly; change only materials and light".
6. **Download for Blender**: `room.glb` + `render_in_blender.py` (cameras,
   lights, Cycles) + `room.json`, zipped.
7. **Render in Blender** (optional): any shot is rendered with real Blender
   Cycles on the user's own render server (`blender-server/`), from the same
   model and the same camera.

**Principle:** the `RoomModel` is the single source of truth. The live view,
every shot, every edit, the realistic pass and the Blender export are built
from it, so they cannot disagree. AI never draws or places the room.

## Flow (app/Studio.tsx)

`start` (`components/StartScreen.tsx`: upload, samples, blank room of a given
size, continue the autosaved room) → `plan` (`components/PlanStep.tsx`:
preview, PDF page picker, optional crop box, room type, hint, "Read plan &
build 3D", or skip the AI and enter the size) → `studio`:

- `studio/Viewport3D.tsx` wraps `RoomViewport`. Click a piece to select it,
  drag the selected piece on the floor to move it, and drag empty space to
  orbit. Its `capture(shot)` renders 1600×1200 PNG shots. It waits for WebGL
  and re-syncs to the latest model first.
- `studio/PlanCheck.tsx` is the **plan check** view. When the room has a plan
  image, a "3D model | Plan check" switch lays it over the viewport (the 3D
  view stays mounted, so shots still work). It is an SVG over the plan in
  image pixels:
  - The dashed outline is the walls. Furniture is green with its front edge
    drawn heavy, wall-hung pieces are violet, doors orange, windows blue.
  - Drag a piece to move it (an `update` op). Drag a door or window onto any
    wall (`placeOpening`). Drag the outline's handles onto the drawing's inner
    wall lines (`refitPlan`, previewed live).
  - A room set up by hand ("skip the AI") has no fit yet: drag a box over the
    room's inner walls to place it.
  - It also has a whole-sheet/zoom toggle, labels and a model-strength slider.
- `studio/ShotBar.tsx` lists the preset shots and has "Take this shot", which
  captures the preset or, after orbiting, the free camera.
- `studio/CommandBar.tsx` holds the command box, contextual suggestions, undo
  and redo, and the log.
- `studio/ElementsPanel.tsx` lists the elements. The selected-element editor
  has design (variant), finish chips and free text, W/D/H, x/z, facing,
  rotate, nudge and delete. It also adds elements and has "Furnish it for me".
- `studio/RoomPanel.tsx` edits the name, kind, style, size, wall colour,
  floor, false ceiling and curtains, plus doors and windows (kind, wall, centre
  offset, width, sill, main door).
- `studio/ShotGallery.tsx` shows the captured shots. Each has "🎬 Render in
  Blender" (Draft or Final, with progress), "Make realistic" with an optional
  direction, a compare slider against the raw shot (toggle between Blender and
  AI results when both exist), downloads, and "Retake with changes" when the
  model has changed since.
- State: a reducer with `room`, `past`, `future`, `version`, `selectedId` and
  `lastId` (up to 80 undo steps). The room autosaves to localStorage
  (`planto3d_room_v1`). Preset shots follow the model: move the bed and the
  bed back view moves with it. Keyboard: Delete removes the selection,
  Ctrl/Cmd+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes, and Esc deselects.

## The room model (lib/room)

Plan coordinates in **metres**, as drawn: x → right, z → down the plan,
interior floor (0,0)–(width, depth). Walls are `top|bottom|left|right`. An
item's `facing` is where its **front** looks (`up|down|left|right`), so its
back is on the opposite side. An opening's `offset` is its centre measured
from the left end of top/bottom walls and from the top end of left/right
walls.

- `types.ts`: `RoomModel`, `Item`, `Opening`, `Shot`, `PlanFit` (the room's
  interior box in plan-image pixels, `RoomModel.plan`, so undo restores it
  with the model).
- `catalog.ts` defines every `ItemType`: its label, aliases used for commands
  and plan labels (longest alias wins, so "bed back" is not "bed"), standard
  size, plausible size range, `againstWall` / `wallMounted` / `flat`, material
  role and design variants. It also holds `MAIN_ITEM_ORDER` (what "main
  element" means per room kind) and `kindFromWords`.
- `styles.ts`: five style palettes (`modern-warm`, `scandinavian`, `luxury`,
  `minimal`, `indian-contemporary`), plus colour and wood words.
- `materials.ts` paints procedural canvas textures (wood, planks, marble,
  tiles, fabric, cane, rugs, art, exterior) and supplies a `Materials` cache
  with a clay mode. Fabric is a fine, even weave; large-scale mottling read as
  stains. TV screens are satin rather than mirror-glossy, so lamps don't show
  as hot spots. `resolveFinish` reads finish words such as "walnut",
  "emerald velvet", "white marble" or "#aabbcc".
- `kit.ts`: `loadThree()`, `Kit` (box/rbox/cyl… helpers) and `worldUV` (UVs in
  world metres). `Kit.pillow` makes a real pillow shape: puffy in the middle,
  pinched to a seam, with the sides drawn in. Beds are dressed with sleeping
  pillows leaning on the headboard, a square cushion in front of each, and a
  lumbar cushion; the old tube-shaped rounded boxes read as bones.
- `furniture/{bedroom,living,other}.ts` hold one builder per type and
  variant, in a local frame (front +z). `furniture/index.ts` `buildItem`
  names each group `item:<id>`.
- `shell.ts` builds the floor, walls of real thickness with openings cut in
  (frames, leaves, glass, sills, an exterior backdrop), skirting, curtains, the
  ceiling and an optional false ceiling with cove and downlights, plus
  `buildDaylight`. Groups are named so a shot can hide them: `wall:<side>`,
  `door:<id>`, `ceiling`, `curtains`, `exterior`.
- `scene.ts`: `buildRoomScene(T, room, {clay, lights})` is the ONE scene
  builder, used by the viewport, the shots and the Blender export.
- `viewport.ts`: `RoomViewport` has a PBR pipeline (RoomEnvironment PMREM,
  ACES, exposure 0.85, PCF shadows, GTAO, bloom only above 1.6, OutputPass).
  It offers `setRoom`, `setShot` (level camera plus lens shift), `capture`,
  `pick`, `floorPoint` and `previewMove`. A preset shot is left only when the
  camera actually moves. Meshes with the mirror material also get a planar
  `Reflector` on their face in the viewport only; the Blender export keeps the
  plain mirror material, which Cycles renders correctly. Without it a WebGL
  mirror showed only the environment map, as a flat white panel.
- `shots.ts` computes the preset shots from the model:
  - **Entry** stands 0.5 m inside the main door at eye level 1.55 m, looking
    between the room centre and the main piece.
  - **Back** stands behind the main piece, far enough that its back sits in
    the bottom of the frame. If that spot is outside the room or blocked, the
    camera stands behind the wall and the wall plus what hangs on it are
    hidden: the "clipping camera".
  - **Front** looks from the opposite wall, with that wall clipped.
  - **Corners** must be standable: on free floor, clear of tall furniture.
  - **Top** is the last shot.
  - `itemsInView(room, shot)` lists the pieces inside a shot's frame
    (projected box samples, hidden pieces excluded). The realistic prompt
    names only those.
- `geometry.ts`: footprints, `wallBehind`, `mainDoor`, `mainItem`,
  `itemsAgainst` and `formatSize` (m + ft).
- `planFit.ts` keeps the model and its plan in step:
  - `toPlan` / `fromPlan` map metres to plan-image pixels and back. The box
    maps the whole room, so the overlay stays aligned after a resize.
  - `resizeRoom` sets the size (room op, Room panel). Pieces against a wall
    stay flush. With a plan, everything else keeps its place on the drawing
    (it is a correction, not an extension); without one, positions stay in
    metres. It sets `scaleSource: "manual"`.
  - `refitPlan(room, box)` moves the walls on the drawing: openings and loose
    pieces keep their place on it, and flush pieces stay flush. A printed or
    typed size is kept (the scale was off); an estimated one keeps its scale.
  - `placeOpening` drops a door or window on the nearest wall at a point.
- `place.ts` decides where a new piece goes:
  - A bed back panel spans the wall behind the bed, and side tables flank the
    bed's head.
  - A wardrobe goes on a side wall, in the foot-end corner. A TV unit faces the
    bed or sofa, and a coffee table sits in front of the sofa.
  - `fits` keeps pieces out of door swings and keeps tall pieces away from
    windows.
  - `settle` pushes pieces in front of a wall-hung panel.
  - `normalizeRoom` runs after room edits.
- `commands.ts`: `parseCommand` → `Op[]` (`add` / `remove` / `update` /
  `room` / `shot`) → `applyOps`, which validates, places and never throws.
  `runCommand` = parse + apply. `sanitizeOps` validates AI-proposed ops.
  Room sizes read metres, mm, feet and feet-inches ("room size 11'8\" x
  20'").
  Clause splitting keeps the verb across "and" ("add a bed back and side
  tables"). "that/it" means the selection, or the last piece touched. "move
  the bed back" means backwards.
- `read.ts`: `readingToRoom(reading, imageSize, hint)` turns the AI's plan
  reading into the model:
  - Scale comes from the printed dimensions, parsed by `parseDimension` (12'0",
    3600 mm, 3.6 m…) and axis-checked against the drawn aspect. Otherwise it
    is estimated from door and bed sizes, then from a typical area, and
    flagged `estimated`.
  - Each opening is snapped to its wall, deduplicated, and one is made the
    main door. A "slider window" is a window; only a `sliding_door` (or
    balcony / french door) is full height.
  - The room box is kept as `room.plan` for the plan check view.
  - Each piece is typed, sized into its catalog range, faced (bed `head`,
    `front`, or its nearest wall) and pushed flush.
- `furnish.ts`: `autoFurnish` gives a standard layout per room kind using the
  same placement. `blankRoom` makes an empty room.
- `samples.ts`: a sample bedroom (12′×14′) and a sample living room
  (4.5×5.5 m).
- `blender.ts` builds what Blender needs:
  - `roomGlb` uses GLTFExporter on the same scene.
  - `sceneData` gives the cameras (vertical FOV, lens shift, a clip start
    just past the inner face of the wall a camera stands behind) and the lights
    collected from the scene (sun, window and cove area lights, downlights,
    lamps), in Blender coordinates.
  - `blenderScript` writes `render_in_blender.py` for the download: a
    `DATA_JSON` raw string with the scene data, followed by
    `blender-server/voxa_render.py`. That file is imported as text
    (`next.config.js` treats `*.py` as `asset/source`; `types/assets.d.ts`
    declares it), so the download and the render server run the same script.
  - `renderJobZip(room, shots)` is the render-server job: `room.glb` +
    `scene.json` only, never a script.
  - A dependency-free store-only `zip`.
- `renderServer.ts` is the browser client for the render server:
  - The URL and token live in localStorage (`planto3d_render_server`). The URL
    can also come from `NEXT_PUBLIC_BLENDER_SERVER_URL`. The token is never
    built in.
  - It offers `serverHealth`, and `renderInBlender(room, shot, quality,
    onStatus)`, which packs, posts, polls and returns a PNG data URL.
  - `QUALITIES`: Draft is 48 samples at 60 %, Final is 256 samples at 100 %.

## Blender render server (blender-server/)

- `voxa_render.py` is the one Blender script. It takes `--render`,
  `--samples`, `--percent`, `--time-limit`, `--device auto|cpu|gpu`, `--job`,
  `--glb`, `--out` and shot ids.
  - It imports the GLB, adds the cameras, lights, world and Cycles/AgX
    settings, and renders with the best GPU (OptiX, CUDA, HIP, oneAPI, Metal),
    else the CPU.
  - When rendering, it hides each shot's `hide` list. Interactively, a
    `depsgraph_update_post` handler hides that list whenever the active camera
    changes.
  - It prints `VOXA_DEVICE` and `VOXA_RENDERED <id>` for the server.
- `server.py` uses the standard library only.
  - Routes: `POST /jobs?shots=&samples=&percent=` (a zip containing only
    `room.glb` and `scene.json`, validated and rebuilt field by field; it
    never runs uploaded code), `GET /jobs/<id>`, `GET /jobs/<id>/<shot>.png`
    and `GET /health`.
  - It runs one job at a time as a subprocess: the `bpy` module, or
    `BLENDER_BIN`.
  - It enforces a bearer `RENDER_TOKEN` and `ALLOWED_ORIGINS` CORS, plus size,
    samples and queue limits, a per-job timeout, and a TTL cleanup.
- `smoke_test.py` builds a tiny GLB with Blender, checks that a bad token and
  a bad upload are refused, then renders one shot and checks the PNG.
- `Dockerfile`: `python:3.11-slim-bookworm` + the X11/GL libraries +
  `bpy==5.0.1`, run as a non-root user on port 8080.
- `.github/workflows/render-server.yml` builds the image, runs
  `smoke_test.py` inside it, and on `main` pushes
  `ghcr.io/<owner>/<repo>-render`.
- Hosting is in `blender-server/README.md`. The recommended host is Cloud Run
  with an L4 GPU, with `--max-instances 1` (jobs live in memory) and
  `--no-cpu-throttling` (renders continue after the POST returns).
- Verified: the app → server → Cycles round trip, the smoke test, and the
  downloaded package, all run against bpy 5.0.1 on Python 3.11. The Docker
  image build itself is verified only by the CI workflow (no Docker daemon in
  the dev sandbox).

## AI (lib/ai) — three jobs only

- `prompts.ts` holds the prompts for each job:
  - `PLAN_READER_SYSTEM` asks for JSON with `room_box`, `printed_size`
    (verbatim), `openings[]` and `items[]` as Gemini-native
    `[ymin,xmin,ymax,xmax]` 0-1000 boxes, bed `head`, and `front`. Opening
    kinds are `door | window | sliding_door | opening`. It says never compute
    or guess numbers and never invent furniture.
  - `COMMAND_SYSTEM` + `commandUser` describe the Op schema, the catalog and
    the room JSON.
  - `realisticPrompt` keeps the camera, geometry and every piece exactly, and
    changes only materials and light.
    - It names only the pieces in frame (`itemsInView`). Naming an
      out-of-frame piece made Nano Banana paint it in: a real plan's entry
      shot gained the wardrobe that stands behind the camera.
    - It says plain wall stays plain.
    - It names the floor's tone ("light honey-coloured oak", from the style's
      accent wood), and says no rug unless one is in view and do not darken
      the floor.
- `google.ts` (keys `AIza…` or the newer `AQ.…` form) talks to the Gemini API `v1beta` and lists the
  key's models to pick the best of each: reader = newest pro, fast = newest
  flash, image = best `gemini-*-image` (Nano Banana Pro first). `geminiText`
  uses JSON mode. `geminiImage` returns an image data URL, with 4:3 output and
  2K on newer models.
- `kie.ts` (any other key) handles kie.ai upload → jobs `createTask` → poll,
  plus the chat endpoint. Models: `gemini-3-pro` reader, `gemini-3-flash` chat
  and `nano-banana-pro` render, overridable with `KIE_READER_MODEL`,
  `KIE_CHAT_MODEL`, `KIE_RENDER_MODEL` and `KIE_RENDER_RESOLUTION`.
  `kiePoll.ts` sets a 5-minute window and tolerates transient
  "generate task timeout" fails for 120 s.
- `run.ts`: `providerFor(key)`, `runReadPlan` (one retry on bad JSON, falls
  back to the fast model), `runCommand` and `runRealistic`. It is isomorphic.
- `client.ts` is the browser entry. A key saved in this browser
  (`planto3d_ai_key`; the legacy `planto3d_kie_key` is still read) is used
  directly. Otherwise the server build POSTs to `/api/ai`, and the static
  build throws `NeedKeyError`.
- `app/api/ai/route.ts` serves the server build only. It uses
  `GOOGLE_API_KEY` / `GEMINI_API_KEY` / `KIE_API_KEY` from env, validates
  input (data-URL images under ~10 MB, room shape) and maps errors to
  401/429/502.

Other: `lib/planFile.ts` loads images or PDFs (pdf.js **legacy** build, which
carries polyfills the modern build needs). Images are capped at 2400 px and
`cropPlan` crops them. `savePlanImage` / `loadPlanImage` keep a ≤1600 px JPEG
of the read plan in localStorage (`planto3d_plan_v1`, keyed by the fit's
`ref`), so the plan check survives a reload. `lib/download.ts` and `lib/imageProxy.ts` download
remote kie.ai images through a CORS proxy. `components/KeyManager.tsx` is the
one key field, auto-detecting Google vs kie.ai, and it fires a
`planto3d-key` event.

## Project structure

```
app/
  layout.tsx, page.tsx, globals.css
  Studio.tsx                  # the whole app (start → plan → studio)
  api/ai/route.ts             # server build: AI jobs with the server key
  components/
    StartScreen.tsx  PlanStep.tsx  KeyManager.tsx  CompareSlider.tsx  DownloadButton.tsx
    studio/  Viewport3D.tsx  PlanCheck.tsx  ShotBar.tsx  CommandBar.tsx  ElementsPanel.tsx  RoomPanel.tsx  ShotGallery.tsx
    RenderServerManager.tsx   # footer: Blender render server URL + token, Test & save
blender-server/
  voxa_render.py  server.py  smoke_test.py  Dockerfile  README.md
types/assets.d.ts            # *.py imported as text
lib/
  room/   types catalog styles materials kit constants geometry shell scene viewport
          shots place planFit commands read furnish samples blender renderServer  furniture/{index,bedroom,living,other}
  ai/     client run google kie kiePoll prompts
  planFile.ts  download.ts  imageProxy.ts
```

## Development

```bash
npm install
cp .env.local.example .env.local   # optional server key (GOOGLE_API_KEY or KIE_API_KEY)
npm run dev        # http://localhost:3000
npm run build      # production build (also runs lint + typecheck)
npm run start
npm run lint       # next lint
npm run typecheck  # tsc --noEmit
```

Verifying rendering headlessly is done with Playwright and Chromium:
`executablePath: /opt/pw-browsers/chromium` with args `--use-gl=angle
--use-angle=swiftshader --enable-unsafe-swiftshader`. A throwaway page can
call `RoomViewport.capture` and save the PNGs.

## Build modes

- **Server (default):** `app/api/ai` exists, and visitors without a key use
  the server's.
- **Static (GitHub Pages):** set `STATIC_EXPORT=true`,
  `NEXT_PUBLIC_STATIC=true` and `NEXT_PUBLIC_BASE_PATH=/planto3d`.
  `.github/workflows/pages.yml` removes `app/api` before the export. Every AI
  call runs in the browser with the visitor's key. Google's Gemini API allows
  browser calls. kie.ai calls depend on kie.ai CORS.
- `.github/workflows/ci.yml` runs lint, typecheck and build.
  `.github/workflows/render-server.yml` builds and smoke-tests the render
  server image. `pages.yml` passes the repo variable `BLENDER_SERVER_URL` in
  as `NEXT_PUBLIC_BLENDER_SERVER_URL`.

## Conventions

- TypeScript strict, and `@/*` maps to the repo root.
- `lib/room` is three.js-free except `kit`, `materials`, `shell`, `scene`,
  `viewport`, `blender` and `furniture/*`. Those are loaded dynamically
  (browser only).
- Every model change goes through `applyOps` or the reducer's `edit`, so undo
  works. Never mutate a `RoomModel` in place.
- Keys: never commit one, and never bundle a server key. Browser keys live
  only in localStorage and go only to the chosen provider.

## Git workflow

- Develop on feature branches. Never push directly to the default branch.
- Write clear commit messages, and open draft PRs for review.

## Open / future decisions

- **Rectangular rooms only:** L-shaped rooms and angled walls are not modelled
  yet.
- **One room at a time:** the whole-house model of the old pipeline was
  removed with it.
- **Render server hosting** is the user's: the repo ships the server, the
  image and the deploy guide, but someone must create the GPU host (for
  example Cloud Run) and set `RENDER_TOKEN` / `ALLOWED_ORIGINS`. Jobs live in
  memory, so it runs as a single instance.
- **Plan reading accuracy** depends on the drawing. Low-contrast scans or
  plans without printed dimensions get an estimated scale, flagged in the UI.
- **Shots/realistic history** is in memory. Only the room model and its plan
  image autosave.

## Notes for AI assistants

- This file is the source of truth for product intent: keep it accurate, and
  fix anything outdated as part of your change.
- Don't invent commands or structure. The layout above lists the real files.
