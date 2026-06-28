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
`useReducer` state machine with steps `upload → overview → select → room`):

1. **Upload** a 2D plan image (`components/PlanUploader.tsx`).
2. **Generate overview** — POST the plan to `/api/overview`; Nano Banana 2
   returns an axonometric overview of the whole plan (`components/OverviewView.tsx`).
3. **Proceed** → enter room-selection mode.
4. **Draw a box** around a room on the plan (`components/RoomSelector.tsx`); the
   selection is captured in **natural image pixels** and cropped client-side
   (`lib/crop.ts`).
5. **Build the room in 3D** — POST the crop to `/api/room`; the model returns a
   3D axonometric render (`components/RoomResult.tsx`).
6. **Regenerate** — re-POST the same crop with an incremented `variation`
   counter; every version is kept in `roomVersions[]` and is navigable.
7. **Pick another room** and repeat.

Key principles: user-confirmed incremental generation, draw-a-box selection,
and regeneration as a first-class action that preserves the selected room.

## Tech stack

- **Next.js** (App Router) + **React 19** + **TypeScript** (strict).
- **Tailwind CSS** for styling.
- **kie.ai** job API, server-side only, model `nano-banana-2`.
- The kie.ai API key (`KIE_API_KEY`) is read **only** in server code
  (`lib/kie.ts`, which imports `server-only`); it is never bundled into the
  client. Override the model with `KIE_IMAGE_MODEL` and resolution with
  `KIE_IMAGE_RESOLUTION` (`1K`|`2K`|`4K`, default `1K`).

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

## Project structure

```
app/
  layout.tsx            # root layout
  page.tsx              # mounts the flow
  globals.css           # Tailwind entry
  PlanToThreeD.tsx      # client state machine (the whole flow)
  components/
    PlanUploader.tsx    # file → data URL
    OverviewView.tsx    # plan + overview + Generate/Proceed
    RoomSelector.tsx    # canvas-free box drawing over the plan
    RoomResult.tsx      # room render + Regenerate + version history
  api/
    overview/route.ts   # POST { plan }            → { image, mimeType }
    room/route.ts        # POST { room, variation } → { image, mimeType }
lib/
  kie.ts                # server-only kie.ai client (upload + createTask + poll)
  prompts.ts            # axonometric overview + per-room prompt templates
  crop.ts               # rect math + crop a region of the plan → PNG data URL
  api.ts                # client fetch helpers (requestOverview/requestRoom)
  image.ts              # data URL validation helper (dataUrlToInline)
  types.ts              # shared types
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
