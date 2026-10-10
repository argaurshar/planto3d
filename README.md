# planto3d (Voxa)

Upload the plan of a room (JPEG, PNG or PDF) and get an **exact, true-scale 3D
model** of it, shot like an interior photographer would: from the **main door
at eye level**, from **behind the bed or the sofa**, from the corners and from
above. Change anything by typing ("add bed back", "change side table design",
"delete that"), turn any shot into a **photoreal render** with Google's Nano
Banana, or take the model to **Blender**.

## How it works

1. **Upload** a room plan (JPEG / PNG / PDF; draw a box if the drawing has
   several rooms).
2. **Read once.** A Gemini vision model reports what is drawn: the room's inner
   wall lines, the printed dimensions, a box per door, window and furniture
   symbol. That is the only AI step in building the model.
3. **Exact model.** Deterministic code turns that reading into a `RoomModel`
   in metres: true scale from the printed dimensions, doors and windows on
   their walls, every piece of furniture at a real size, turned so its back is
   on its wall and pushed flush against it.
4. **Raw shots.** The model is built in Three.js with a physically based
   pipeline (image-based light, a shadow-casting sun through the window, area
   light at the windows, ambient occlusion, filmic tone mapping), so a raw shot
   already reads like a semi-rendered Blender frame. The first shot is taken
   from the main door at eye level (1.55 m). Others: behind the bed or sofa,
   facing it, the corners and a top view.
5. **Edit** by typing or in the panels. Commands compile to small, validated
   operations on the model, with undo and redo. Phrasing the local parser does
   not know goes to the AI, which returns the same operations.
6. **Make realistic** (optional) sends a raw shot to Nano Banana (Pro) with
   instructions to keep every wall, opening and piece exactly where it is and
   change only materials and light.
7. **Download for Blender**: `room.glb` plus `render_in_blender.py`, which
   adds every camera, the lighting and Cycles settings.

No AI ever draws or places the room, so there is nothing for it to
hallucinate. The model is the single source of truth for the 3D view, every
shot, every edit and the Blender export.

## AI keys

One key, either kind:

- a **Google AI Studio** key (`AIza…`, <https://aistudio.google.com/apikey>):
  Gemini reads the plan and handles free-form commands, and Nano Banana makes
  the realistic renders. The app picks the best models the key can use.
- a **kie.ai** key (<https://kie.ai/api-key>): the same jobs through kie.ai's
  Gemini and `nano-banana-pro` endpoints.

The 3D model, shots, edits and the Blender export need no key.

## Setup and run

```bash
npm install
cp .env.local.example .env.local   # optional: a server key for the server build
npm run dev        # http://localhost:3000
npm run build      # production build (also lints and typechecks)
npm run start
npm run lint
npm run typecheck
```

## Deploy

- **GitHub Pages (static):** `.github/workflows/pages.yml` builds a static
  export on every push to `main`. Visitors paste their own key at the bottom of
  the page; it stays in their browser's `localStorage` and goes only to Google
  or kie.ai.
- **Server (Vercel / Node):** the default build adds `app/api/ai`, which uses
  `GOOGLE_API_KEY` (or `GEMINI_API_KEY`, or `KIE_API_KEY`) for visitors who have
  not saved a key of their own.

## Blender

Unzip the package, then in Blender go to Scripting, open
`render_in_blender.py` and run it. Or render every shot from a terminal:

```bash
blender --background --python render_in_blender.py -- --render --samples 128
```

Cameras that stand behind a wall cut it away with Blender's clip start, the
same "clipping camera" the app uses.
