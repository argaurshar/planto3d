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

## Deploy

Two supported targets:

### Vercel (recommended — keeps your key server-side)

The default build runs the API routes, so your `KIE_API_KEY` stays on the
server. Import the repo at [vercel.com](https://vercel.com), add a `KIE_API_KEY`
environment variable, and deploy. (Free-tier function timeout is 60s, which a
slow generation can exceed; bump to Pro or another Node host if you hit it.)

### GitHub Pages (static — bring your own key in the browser)

Pages can only serve static files, so there is **no server** and **no place to
hide a key**. The repo ships a static build mode for this:

- `.github/workflows/pages.yml` builds a fully static export
  (`STATIC_EXPORT=true`) and deploys it to Pages on every push to `main`.
- In the static build there are no API routes — generation runs **in your
  browser**, so the app shows an **API-key field**; the key you paste is stored
  only in your browser's `localStorage` and is **never committed**.

To enable it: in the repo, **Settings → Pages → Build and deployment →
Source: GitHub Actions**. The site publishes at
`https://<owner>.github.io/planto3d/`.

> ⚠️ Caveat: browser → kie.ai calls only work if kie.ai sends permissive **CORS**
> headers. If they don't, the front end still loads but generation fails with a
> network error — use the Vercel/server deploy in that case.

## Notes

- Live generation requires a kie.ai key with credit and `nano-banana-2` access.
  Without it the UI still runs, but generation calls return an error shown in
  the UI.
- Output resolution defaults to `1K`; override with `KIE_IMAGE_RESOLUTION`
  (`1K` | `2K` | `4K`) or the model with `KIE_IMAGE_MODEL` (server build) /
  `NEXT_PUBLIC_KIE_*` (static build).
- kie.ai-hosted uploads and results are temporary (deleted after a few days);
  the app treats results as ephemeral image URLs.
