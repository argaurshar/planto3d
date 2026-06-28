# planto3d

Turn a **2D floor plan** into AI-generated **3D axonometric** views, room by
room, with you in the loop. Powered by **Nano Banana 2** (the `nano-banana-2`
model on [kie.ai](https://kie.ai)).

## How it works

1. **Upload** a 2D plan image.
2. **Generate overview** — an axonometric map of the whole plan.
3. **Proceed** and **draw a box** around any room.
4. The app crops that room and generates a **3D axonometric render** of it.
5. **Regenerate** until you're happy — every version is kept so you can flip
   back through them.
6. Pick another room and repeat.

All image generation runs through kie.ai **server-side**; your API key never
reaches the browser.

## Tech stack

- **Next.js** (App Router) + **React** + **TypeScript**
- **Tailwind CSS** for styling
- **kie.ai** job API, model `nano-banana-2`
- Two server route handlers: `app/api/overview` and `app/api/room`

## How the kie.ai integration works

kie.ai is an asynchronous job API, so each generation does three things
server-side (see `lib/kie.ts`):

1. **Upload** the (client-cropped) base64 image to kie.ai's base64 upload
   endpoint, which returns a temporary hosted URL.
2. **Create a task** (`createTask`) with the prompt + image URL → `taskId`.
3. **Poll** `recordInfo` until the task succeeds, then return the result image
   URL, which the UI renders directly.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then add your key
```

Set `KIE_API_KEY` in `.env.local` to your kie.ai API key (with access to
`nano-banana-2`). Get / manage it at <https://kie.ai/api-key>.

## Run

```bash
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
npm run typecheck
```

## Project layout

```
app/
  page.tsx            # mounts the flow
  PlanToThreeD.tsx    # client state machine (upload → overview → select → room)
  components/         # PlanUploader, OverviewView, RoomSelector, RoomResult
  api/
    overview/route.ts # POST plan image  → axonometric overview
    room/route.ts     # POST room crop   → 3D room render
lib/
  kie.ts              # server-only kie.ai client: upload + createTask + poll
  prompts.ts          # axonometric overview + per-room prompts
  crop.ts             # client-side rectangle crop of the plan
  api.ts              # client fetch helpers
  image.ts            # data URL validation helper
  types.ts            # shared types
```

## Notes

- Live generation requires a kie.ai key with credit and `nano-banana-2` access.
  Without it the UI still runs, but generation calls return an error shown in
  the UI.
- Output resolution defaults to `1K`; override with `KIE_IMAGE_RESOLUTION`
  (`1K` | `2K` | `4K`) or the model with `KIE_IMAGE_MODEL` in `.env.local`.
- kie.ai-hosted uploads and results are temporary (deleted after a few days);
  the app treats results as ephemeral image URLs.
