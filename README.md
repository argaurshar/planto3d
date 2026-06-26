# planto3d

Turn a **2D floor plan** into AI-generated **3D axonometric** views, room by
room, with you in the loop. Powered by **Nano Banana Pro** (Google's Gemini 3
Pro Image model).

## How it works

1. **Upload** a 2D plan image.
2. **Generate overview** — an axonometric map of the whole plan.
3. **Proceed** and **draw a box** around any room.
4. The app crops that room and generates a **3D axonometric render** of it.
5. **Regenerate** until you're happy — every version is kept so you can flip
   back through them.
6. Pick another room and repeat.

All image generation runs through the Gemini API **server-side**; your API key
never reaches the browser.

## Tech stack

- **Next.js** (App Router) + **React** + **TypeScript**
- **Tailwind CSS** for styling
- **`@google/genai`** SDK calling model `gemini-3-pro-image-preview`
- Two server route handlers: `app/api/overview` and `app/api/room`

## Setup

```bash
npm install
cp .env.local.example .env.local   # then add your key
```

Set `GEMINI_API_KEY` in `.env.local` to a Google Gemini API key that has access
to Nano Banana Pro (`gemini-3-pro-image-preview`). Get one at
<https://aistudio.google.com/apikey>.

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
  gemini.ts           # server-only GenAI client + generateImage()
  prompts.ts          # axonometric overview + per-room prompts
  crop.ts             # client-side rectangle crop of the plan
  api.ts              # client fetch helpers
  image.ts            # data URL <-> inline image helpers
  types.ts            # shared types
```

## Notes

- Live generation requires a valid (paid) Gemini key with Nano Banana Pro
  access. Without it the UI still runs, but generation calls return an auth
  error shown in the UI.
- Override the model with `GEMINI_IMAGE_MODEL` in `.env.local` if needed.
