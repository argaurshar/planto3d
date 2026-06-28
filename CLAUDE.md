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
4. **Draw a box** around a room (`components/RoomSelector.tsx`) and pick a room
   type; the selection is captured in **natural image pixels** and cropped
   client-side (`lib/crop.ts`).
5. **Two-stage room render:**
   - **3a — prompt writer** — `/api/room` `action:"write"` calls a kie.ai vision
     LLM (`lib/kieChat.ts`) to auto-write a **photorealistic interior** prompt,
     shown in an **editable** box (`components/RoomPrompt.tsx`).
   - **3b — render** — `action:"render"` sends the (possibly edited) prompt +
     the crop to Nano Banana 2 → a photorealistic eye-level interior
     (`components/RoomResult.tsx`). The crop is framed in the prompt as a
     top-down **layout reference only**; style/lighting from the brief are
     re-injected so every render stays consistent.
6. **Regenerate** (vary the render) / **Edit prompt** / **Rewrite with AI**;
   every version is kept in `roomVersions[]` and is navigable.
7. **Pick another room** and repeat.

Key principles: a global **design brief**, user-confirmed incremental
generation, draw-a-box selection, a **transparent editable prompt** between
selection and render, and regeneration as a first-class action that preserves
the selected room. The overview is **axonometric**; rooms are **photorealistic
interiors**.

## Tech stack

- **Next.js** (App Router) + **React 19** + **TypeScript** (strict).
- **Tailwind CSS** for styling.
- **kie.ai**, server-side only. Two models:
  - **`nano-banana-2`** image model via the **job API** (`lib/kie.ts`).
  - a **vision chat model** (`gemini-2.5-flash`) via the **OpenAI-compatible
    chat endpoint** for the prompt-writer (`lib/kieChat.ts`).
- The kie.ai API key (`KIE_API_KEY`) is read **only** in server code
  (`lib/kie.ts` / `lib/kieChat.ts`, which import `server-only`); it is never
  bundled into the client. Overrides: `KIE_IMAGE_MODEL`, `KIE_IMAGE_RESOLUTION`
  (`1K`|`2K`|`4K`, default `1K`), `KIE_CHAT_MODEL` (default `gemini-2.5-flash`).

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
  `{ prompt }` (falls back to a templated prompt if the LLM call fails, so the
  user can always render).
- `"render"` → `generateImage(roomRenderPrompt(prompt, variation, brief), [crop])`
  returns `{ image }`. The render prompt frames the crop as a **top-down layout
  reference only** and re-injects the brief's style/lighting, so the output is a
  photoreal eye-level interior (not a copied plan) and stays on-style.
- `"auto"` → write then render in one call.

> `generateImage` still accepts already-hosted `http(s)` URL inputs (passed
> through without re-upload), but the room render currently sends only the crop.

## Project structure

```
app/
  layout.tsx            # root layout
  page.tsx              # mounts the flow
  globals.css           # Tailwind entry
  PlanToThreeD.tsx      # client state machine (the whole flow)
  components/
    PlanUploader.tsx    # file → data URL
    DesignBrief.tsx     # style preset + lighting + plan metadata
    OverviewView.tsx    # brief + plan + overview + Generate/Approve
    RoomSelector.tsx    # box drawing over the plan + room-type selector
    RoomPrompt.tsx      # editable auto-written interior prompt + Render
    RoomResult.tsx      # interior render + Regenerate/Edit prompt + history
  api/
    overview/route.ts   # POST { plan, brief }                  → { image, mimeType }
    room/route.ts        # POST { action, room, brief, prompt… } → { image|prompt }
lib/
  kie.ts                # server-only kie.ai image client (upload + createTask + poll)
  kieChat.ts            # server-only kie.ai vision-LLM prompt writer (Stage 3a)
  prompts.ts            # overview + prompt-writer system + room render templates
  styles.ts             # interior-design style presets + brief resolution
  crop.ts               # rect math + crop a region of the plan → PNG data URL
  api.ts                # client fetch helpers (overview/roomPrompt/roomRender)
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
- **Selection → crop:** `RoomSelector.tsx` reports a rect in natural pixels;
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
