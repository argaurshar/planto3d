# CLAUDE.md

Guidance for AI assistants (and humans) working in the **planto3d** repository.

> **Status: implemented (v0).** The core flow described below is built and
> compiles (`npm run build` passes). Keep this file accurate as the code
> changes — regenerate sections from the actual files, configs, and CI.

## Product vision

`planto3d` ("plan to 3D") turns a **2D plan** (e.g. a floor plan) into
**3D isometric / axonometric** views, room by room, under user control. The
user is in the loop at every step: upload a plan, generate an overview, proceed,
pick a room by drawing a box, and regenerate any 3D result they don't like.

All image generation is done by **Nano Banana 2** — the `nano-banana-2` model on
**[kie.ai](https://kie.ai)**, called via kie.ai's asynchronous job API. There is
**no procedural geometry**; the 3D views are AI-generated images.

## Interaction flow

This is the canonical user journey (implemented in `app/PlanToThreeD.tsx` as a
`useReducer` state machine with steps
`upload → overview → select → roomPrompt → room`):

1. **Upload** a 2D plan image (`components/PlanUploader.tsx`).
2. **Design brief** — pick a style preset, lighting, and optional plan metadata
   (`components/DesignBrief.tsx`); threaded into every prompt.
3. **Generate overview** — POST `{ plan, brief }` to `/api/overview`; Nano
   Banana 2 returns an **axonometric** top-view of the whole plan
   (`components/OverviewView.tsx`). **Approve** to continue.
4. **Draw a box** around a room **on the 2D plan** (`components/RoomSelector.tsx`;
   the generated 3D overview is shown beside it as a *reference only*). The
   plan is the geometric source of truth: it is exact and top-down, so crop
   coordinates are floor coordinates — which is what detection and the blockout
   assume. (Cropping from the axonometric overview was the old behaviour and
   compounded error: the overview is itself an AI drawing that drifts from the
   plan, and its image-y mixes height with depth, skewing the blockout.) The
   selection is captured in **natural image pixels** and cropped client-side
   (`lib/crop.ts`; remote images go through the CORS proxy `lib/imageProxy.ts`
   so the canvas isn't tainted). Then a per-room
   **setup table** (`components/RoomSetup.tsx`) picks the **interior type +
   style** (overrides the brief's style for this room only).
5. **Two-stage room render:**
   - **3a — prompt writer** — `/api/room` `action:"write"` calls a kie.ai vision
     LLM (`lib/kieChat.ts`) to auto-write a **photorealistic interior** prompt,
     shown in an **editable** box (`components/RoomPrompt.tsx`). It first runs a
     **spatial-extraction pass** (`lib/spatial.ts`): the same Gemini vision model
     returns **2D bounding boxes** of the room's furniture/fixtures, windows and
     doors, which are converted to a **detected layout** string and fed to the
     writer as ground truth so the prompt **enumerates the exact spatial
     arrangement** (positions/counts, windows on which wall, doors) instead of
     guessing. Detection is best-effort — if it fails, the writer degrades to
     describing the crop directly. The approved overview is passed as a 2nd image
     here for whole-home style consistency. NOTE: this **grounds** the prompt but
     does not hard-enforce geometry — the render (3b) is still text-to-image, so
     layout fidelity is improved, not guaranteed (true enforcement would need
     ControlNet/structural conditioning, which nano-banana / Gemini image models
     don't expose).
   - **3a.5 — layout lock (blockout)** — from the detected boxes, the client
     builds an eye-level **matte clay massing model** of the room with Three.js
     (`lib/blockout.ts`): floor, ceiling and walls, a massing box per furniture
     item (height by label prior), and panels marking windows/doors on the
     nearest wall. Lambert materials plus a hemisphere/sun/ambient rig give it
     real shading. **Its tones are muted real-material colours** (cream bed, sage
     seating, walnut storage, light-wood tables, sand rug) rather than a
     saturated segmentation palette: Kontext preserves colour as part of
     structure, so the old blue/orange/purple legend came back out of the
     renderer as a teal panel, an orange wardrobe and a purple bench. Colour
     carry-over is now harmless because the massing already looks like a sane
     room. The camera stands **outside** the wall carrying the detected door
     (that wall is culled), and the floor, ceiling and flanking walls are
     stretched by the same offset so the frame stays bounded by real surfaces —
     standing inside a 3.4x3.0m bedroom put the eye on top of a wardrobe. The
     viewpoint is pulled toward the middle of its wall for framing. The footprint is scaled from the
     plan's **printed dimensions** when they can be read (`ROOM_DIMENSION_PROMPT`
     / `parseRoomDimensions`, axes auto-corrected against the crop aspect), else
     from the crop aspect at an assumed size. Three.js is
     dynamically imported (browser-only; code-split out of SSR). A small preview
     ("Layout lock") is shown in `components/RoomPrompt.tsx`.
   - **3b — render** — when a blockout is present, `action:"render"` renders via
     **FLUX.1 Kontext** (`flux-kontext-max`, kie.ai's structure-preserving edit
     API): the clay massing is the input image, so the composition is enforced by
     the model's own design rather than soft instruction → a photorealistic
     **eye-level interior** (`components/RoomResult.tsx`). `kontextRenderPrompt`
     is written as an **edit instruction** ("rephotograph this room…"), which is
     what Kontext responds to with a start image, and spends its budget on
     materials and photographic language (lens, daylight, PBR materials, "a
     photograph, NOT a 3D render") since the geometry already lives in the image.
     Kontext exposes no output-resolution parameter, so realism has to come from
     the input image and the wording.
   - **3c — verify & retry** — the finished render is checked by the vision LLM
     against the detected layout (counts + which wall for each item, window/door
     placement). On mismatch it re-renders ONCE with the verifier's corrections,
     then reports the result as a **Verified ✓ / Check failed** badge. Fallbacks:
     Kontext unavailable → nano-banana image-to-image from the blockout; no
     blockout at all (detection/WebGL failed) → **text-to-image**. The top-down
     crop is still **never** fed to the renderer. Style/lighting from the brief
     are re-injected.
6. **Regenerate** (vary the render) / **Edit prompt** / **Rewrite with AI**;
   every version is kept in `roomVersions[]` and is navigable.
7. **Pick another room** and repeat.

Key principles: a global **design brief**, user-confirmed incremental
generation, draw-a-box selection, a **transparent editable prompt** between
selection and render, and regeneration as a first-class action that preserves
the selected room. The overview is **axonometric**; rooms are **photorealistic
eye-level interiors**, rendered **image-to-image from an eye-level 3D blockout**
built from the detected layout (the blockout locks the camera viewpoint and the
wall/window/door/furniture positions so the render can't rearrange them); it
falls back to **text-to-image** when no blockout is available.

## Tech stack

- **Next.js** (App Router) + **React 19** + **TypeScript** (strict).
- **Tailwind CSS** for styling.
- **kie.ai**, server-side only. Models:
  - **`flux-kontext-max`** (FLUX.1 Kontext) via kie.ai's dedicated Kontext API
    (`/api/v1/flux/kontext/generate` + `record-info`) — a **structure-preserving
    edit model** used for the layout-locked room render: the blockout image
    fixes the composition, the prompt says what to turn each block into.
  - **`nano-banana-2`** image model via the **job API** (`lib/kie.ts`) — the
    overview render + the room-render fallback when Kontext/blockout is
    unavailable.
  - a **vision chat model** (`gemini-3-flash`) via the **OpenAI-compatible
    chat endpoint** for the prompt-writer and the post-render **layout
    verifier** (`lib/kieChat.ts`).
  - a **detection model** (`gemini-3-pro`) for the spatial-extraction pass that
    builds the blockout — stronger spatial reasoning than flash, with a
    retry-on-too-few guard (`lib/spatial.ts` / `lib/kieChat.ts`).
    (The earlier `gemini-2.5-flash`/`-pro` were retired by Google, which returns
    a 404 through kie.ai's proxy — keep these on a current Gemini generation.)
- The kie.ai API key (`KIE_API_KEY`) is read **only** in server code
  (`lib/kie.ts` / `lib/kieChat.ts`, which import `server-only`); it is never
  bundled into the client. Overrides: `KIE_IMAGE_MODEL`, `KIE_IMAGE_RESOLUTION`
  (`1K`|`2K`|`4K`, default `1K`), `KIE_CHAT_MODEL` (default `gemini-3-flash`),
  `KIE_DETECT_MODEL` (default `gemini-3-pro`), `KIE_KONTEXT_MODEL` (default
  `flux-kontext-max`).

### kie.ai job flow (in `lib/kie.ts`)

kie.ai is asynchronous and `image_input` requires hosted **URLs**, not base64,
so each generation does three steps server-side:
1. `uploadBase64` — POST the client's base64 crop to
   `https://kieai.redpandaai.co/api/file-base64-upload` → temporary `downloadUrl`.
2. `createTask` — POST `{ model, input: { prompt, image_input:[url], ... } }` to
   `https://api.kie.ai/api/v1/jobs/createTask` → `taskId`.
3. `pollTask` — GET `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...` until
   `state:success`, then read `resultJson.resultUrls[0]`.

The routes return `{ image, mimeType }` where **`image` is a remote URL** the UI
drops straight into `<img src>`.

### Two-stage room pipeline (`/api/room`)

`/api/room` takes an `action`:
- `"write"` → `lib/kieChat.ts` `writeRoomPrompt` (vision LLM) returns
  `{ prompt, boxes, roomSize }`. It runs a Gemini **spatial-extraction** pass
  (`lib/spatial.ts`: bounding boxes → detected-layout string) and, concurrently,
  a cheap **dimension read** (`ROOM_DIMENSION_PROMPT` → `parseRoomDimensions`,
  on the chat model) to ground the prompt, then writes the interior prompt
  (falls back to a templated prompt if the LLM call fails, so the user can
  always render). The `boxes` and `roomSize` are returned so the client can
  build the eye-level blockout at true scale (`lib/blockout.ts`). The layout
  string is written **relative to the viewer** standing where the blockout
  camera stands (`cameraSpot` — one pure function shared by the blockout, the
  prompt writer and the verifier, so all three agree on which wall is "back").
  The `auto` action passes `needRoomSize: false` since it never returns it.
- Every generation in a route draws from one budget derived from `maxDuration`
  (`ROUTE_BUDGET_MS`); `renderLocked` skips the fallback/corrective retry when
  under `MIN_RENDER_MS` remains so an already-billed image is returned instead
  of lost to a platform kill.
- `"render"` → with a `blockout` (colour-coded eye-level massing PNG) it runs
  `renderLocked`: **FLUX.1 Kontext** edit from the blockout
  (`generateKontextImage`, `kontextRenderPrompt`), then `verifyRenderLayout`
  (vision check vs the `layout` text) with ONE corrective retry → returns
  `{ image, verified? }`. Kontext failure falls back to nano-banana
  image-to-image from the blockout; no blockout → **text-to-image**.
- `"auto"` → write (from the crop) then the same render path in one call.

The optional `reference` (the overview URL) is accepted by `write`/`auto` and
**host-validated** via `lib/refs.ts` `isAllowedReference` (https + a kie.ai host)
before being forwarded to the prompt writer for whole-home consistency. The
`blockout` (a base64 data URL) is accepted by `render`/`auto`, size-capped and
data-URL-validated; if malformed it is dropped and the render falls back to
text-to-image.

## Project structure

```
app/
  layout.tsx            # root layout
  page.tsx              # mounts the flow
  globals.css           # Tailwind entry
  PlanToThreeD.tsx      # client state machine (the whole flow)
  components/
    KeyManager.tsx      # static build: bottom-of-app user API-key entry
    Hero.tsx            # upload-step landing: headline + CTA + live CSS-3D demo of the pipeline
    StepBar.tsx         # progress bar shown on every step after upload
    PlanUploader.tsx    # file → data URL (click, drag-and-drop, or paste)
    DesignBrief.tsx     # style preset + lighting + plan metadata
    OverviewView.tsx    # brief + plan + overview + 2D↔3D CompareSlider + Approve
    CompareSlider.tsx   # before/after drag slider (2D vs 3D)
    DownloadButton.tsx  # blob-fetch download for remote images
    RoomSelector.tsx    # box drawing over the plan
    RoomSetup.tsx       # per-room interior type + style table
    RoomPrompt.tsx      # editable auto-written interior prompt + Render
    RoomResult.tsx      # interior render + Regenerate/Edit prompt + download + history
  api/
    overview/route.ts   # POST { plan, brief }                  → { image, mimeType }
    room/route.ts        # POST { action, room, brief, prompt… } → { image|prompt }
lib/
  kie.ts                # server-only kie.ai image client (upload + createTask + poll)
  kieChat.ts            # server-only kie.ai vision-LLM prompt writer (Stage 3a)
  spatial.ts            # Stage 3a grounding: detect boxes → viewer-relative layout string;
                        #   printed-dimension reader; cameraSpot (shared viewpoint)
  kiePoll.ts            # shared poll policy for both clients: 5-min window, transient
                        #   "generate task timeout" grace (120s), timeout messages
  blockout.ts           # eye-level 3D blockout (Three.js) from boxes → render lock
  prompts.ts            # overview + prompt-writer system + room render templates
  styles.ts             # interior-design style presets + brief resolution
  kieBrowser.ts         # static build: browser-side kie.ai client (user key)
  crop.ts               # rect math + crop a region of the plan → PNG data URL
  download.ts           # download a remote/data-URL image (blob + fallback)
  refs.ts               # isAllowedReference host allowlist for the overview ref
  api.ts                # client fetch helpers; branches on IS_STATIC
  image.ts              # data URL validation helper (dataUrlToInline)
  types.ts              # shared types (DesignBrief, RoomType, responses)
```

### Where things live
- **Prompt / "geometry" tuning:** `lib/prompts.ts`. Both prompts request a true
  parallel (axonometric/isometric) projection — no perspective foreshortening.
  The room prompt varies furnishing/styling by `variation` so Regenerate
  produces a genuinely different take while keeping the same walls.
- **Model call + error handling:** `lib/kie.ts` (`generateImage`,
  `KieError` with an HTTP status; maps kie.ai codes 401/402/429 etc.). Routes
  map errors to clean JSON responses.
- **Selection → crop (of the 2D plan):** `RoomSelector.tsx` reports a rect in natural pixels;
  `lib/crop.ts` does the full-resolution crop on a `<canvas>`.

## Development workflow

```bash
npm install
cp .env.local.example .env.local   # set KIE_API_KEY
npm run dev        # http://localhost:3000
npm run build      # production build (also runs lint + typecheck)
npm run start      # serve the production build
npm run lint       # eslint (next lint)
npm run typecheck  # tsc --noEmit
```

Live generation needs a kie.ai key with credit and `nano-banana-2` access.
Without it the UI runs but generation calls return an error surfaced in the UI.

## Conventions

- TypeScript strict mode; path alias `@/*` maps to the repo root.
- Server-only modules import `"server-only"` and read secrets from `process.env`.
- API routes validate input (image present, size cap) and return
  `{ image, mimeType }` on success or `{ error }` with a proper status.
- Keep the kie.ai key server-side: never import `lib/kie.ts` into a client
  component (`"use client"` files).

## Build modes (server vs static)

- **Server (default):** API routes hold `KIE_API_KEY`; deploy to Vercel/Node.
- **Static (GitHub Pages):** `STATIC_EXPORT=true` + `NEXT_PUBLIC_STATIC=true`
  builds a client-only export (`next.config.js` switches on these). There are no
  API routes, so generation runs in the browser via `lib/kieBrowser.ts`, using a
  user-supplied key entered in `components/ApiKeyBar.tsx` (localStorage, never
  committed). `lib/api.ts` branches on `IS_STATIC`. The Pages workflow
  (`.github/workflows/pages.yml`) strips `app/api` before the export build (POST
  route handlers can't be statically exported) and deploys to Pages.
- Browser → kie.ai calls in the static build depend on kie.ai CORS; if blocked,
  use the server build. Keep both paths working when changing the kie.ai layer.

## Git workflow

- Develop on feature branches; do not push directly to the default branch.
- Write clear, descriptive commit messages.
- Open pull requests (draft first) for review before merging.

## Open / future decisions

- **Automatic room detection** (so the user doesn't have to draw boxes).
- **Projection default** — currently the prompt allows isometric-ish
  axonometric; pin an exact angle if consistency matters.
- **Persistence/history** across sessions (currently in-memory React state).
- **Multi-image consistency** — `nano-banana-2` accepts up to 14 input images
  (`image_input`); could feed the overview + crop together for more faithful
  rooms (`generateImage` already takes an array of inputs).

## Notes for AI assistants

- This file is the source of truth for product intent and conventions — keep it
  accurate; fix anything outdated as part of your change.
- Don't invent commands or structure; the layout above reflects real files.
- When the structure changes, regenerate the relevant sections from the actual
  files and `package.json` scripts.
