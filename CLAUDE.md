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
- `studio/ShotGallery.tsx` shows the captured shots. Each has "Make
  realistic" with an optional direction, a raw ↔ realistic compare slider,
  downloads, and "Retake with changes" when the model has changed since.
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

- `types.ts`: `RoomModel`, `Item`, `Opening`, `Shot`.
- `catalog.ts` defines every `ItemType`: its label, aliases used for commands
  and plan labels (longest alias wins, so "bed back" is not "bed"), standard
  size, plausible size range, `againstWall` / `wallMounted` / `flat`, material
  role and design variants. It also holds `MAIN_ITEM_ORDER` (what "main
  element" means per room kind) and `kindFromWords`.
- `styles.ts`: five style palettes (`modern-warm`, `scandinavian`, `luxury`,
  `minimal`, `indian-contemporary`), plus colour and wood words.
- `materials.ts` paints procedural canvas textures (wood, planks, marble,
  tiles, fabric, cane, rugs, art, exterior) and supplies a `Materials` cache
  with a clay mode. `resolveFinish` reads finish words such as "walnut",
  "emerald velvet", "white marble" or "#aabbcc".
- `kit.ts`: `loadThree()`, `Kit` (box/rbox/cyl… helpers) and `worldUV` (UVs in
  world metres).
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
  camera actually moves.
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
- `geometry.ts`: footprints, `wallBehind`, `mainDoor`, `mainItem`,
  `itemsAgainst` and `formatSize` (m + ft).
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
    main door.
  - Each piece is typed, sized into its catalog range, faced (bed `head`,
    `front`, or its nearest wall) and pushed flush.
- `furnish.ts`: `autoFurnish` gives a standard layout per room kind using the
  same placement. `blankRoom` makes an empty room.
- `samples.ts`: a sample bedroom (12′×14′) and a sample living room
  (4.5×5.5 m).
- `blender.ts` builds the Blender package:
  - `roomGlb` uses GLTFExporter on the same scene.
  - `blenderScript` writes Python that imports the GLB, creates a camera per
    shot (vertical FOV, lens shift, clip start that cuts away walls behind the
    camera), lights collected from the scene (sun, window and cove area
    lights, downlights, lamps), the world and Cycles/AgX settings, and a
    `-- --render [--samples N] [--percent P] [ids]` loop that also hides each
    shot's `hide` list.
  - A dependency-free store-only `zip`.
  - Verified with real Blender 5.0 (bpy) Cycles renders.

## AI (lib/ai) — three jobs only

- `prompts.ts` holds the prompts for each job:
  - `PLAN_READER_SYSTEM` asks for JSON with `room_box`, `printed_size`
    (verbatim), `openings[]` and `items[]` as Gemini-native
    `[ymin,xmin,ymax,xmax]` 0-1000 boxes, bed `head`, and `front`. It says
    never compute or guess numbers and never invent furniture.
  - `COMMAND_SYSTEM` + `commandUser` describe the Op schema, the catalog and
    the room JSON.
  - `realisticPrompt` keeps the camera, geometry and every piece exactly, and
    changes only materials and light.
- `google.ts` (key `AIza…`) talks to the Gemini API `v1beta` and lists the
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
`cropPlan` crops them. `lib/download.ts` and `lib/imageProxy.ts` download
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
    studio/  Viewport3D.tsx  ShotBar.tsx  CommandBar.tsx  ElementsPanel.tsx  RoomPanel.tsx  ShotGallery.tsx
lib/
  room/   types catalog styles materials kit constants geometry shell scene viewport
          shots place commands read furnish samples blender  furniture/{index,bedroom,living,other}
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
- **Real Blender rendering in the app** would need a render server (Blender
  on a GPU host) behind `/api`. Today the app exports a package that renders
  in the user's Blender.
- **Plan reading accuracy** depends on the drawing. Low-contrast scans or
  plans without printed dimensions get an estimated scale, flagged in the UI.
- **Shots/realistic history** is in memory. Only the room model autosaves.

## Notes for AI assistants

- This file is the source of truth for product intent: keep it accurate, and
  fix anything outdated as part of your change.
- Don't invent commands or structure. The layout above lists the real files.
