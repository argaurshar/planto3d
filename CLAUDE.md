# CLAUDE.md

Guidance for AI assistants (and humans) working in the **planto3d** repository.

> **Status: pre-code / specification.** As of the last update this repository
> contained no source code yet — only this document. The **Product vision** and
> **Interaction flow** below reflect the project owner's stated intent and are
> the source of truth for *what we are building*. The **Architecture** and
> **Tech stack** sections are a *recommended* starting point, not yet
> implemented. As real code lands, replace recommendations with observed facts
> (run the build, read the configs) and remove this notice.

## Product vision

`planto3d` ("plan to 3D") is a tool that turns a **2D plan** (e.g. a floor
plan) into a **3D isometric / axonometric** view, room by room, under user
control.

Core idea: the user is in the loop at every step. They upload a plan, confirm
when to proceed, choose which room to build, and can regenerate any 3D result
they are not happy with.

## Interaction flow (the spec)

This is the canonical user journey. Implement to match it; update it here if the
product decision changes.

1. **Input** — The user provides a 2D plan (image upload, or later a vector/CAD
   file). The app parses or displays it.
2. **2D → axonometric map** — The app generates an isometric/axonometric
   overview map of the whole plan from the 2D input.
3. **"Proceed"** — When the user says/clicks **proceed**, the app asks **which
   room** to build in 3D.
4. **Pick a room** — The user selects a room (e.g. by **clicking** it on the
   map).
5. **Build the room in 3D** — The app generates a 3D (axonometric) model of that
   specific room, driven by the user's selection/click.
6. **Regenerate** — If the user is **not satisfied** with the axonometric view,
   clicking **Regenerate** produces a new version of that room.
7. Repeat steps 4–6 for additional rooms.

Key principles:
- **User-confirmed, incremental** generation (one room at a time, on demand).
- **Click-to-select** interaction on the map.
- **Regeneration** is a first-class action with a stable selection (regenerating
  a room must not lose which room was chosen).

## Recommended architecture

> Recommended, not yet built. Confirm with the project owner before committing
> to a stack (see "Open decisions").

A browser-based app is the natural fit for click interaction, live 3D, and a
Regenerate button:

- **Frontend / UI** — Web app. Canvas/DOM for the 2D plan and room picking; a 3D
  engine for the axonometric view.
- **3D rendering** — A WebGL library such as **Three.js**, using an
  **orthographic camera** to get true isometric/axonometric projection (no
  perspective foreshortening).
- **Plan parsing → geometry** — A module that converts the 2D plan into room
  polygons and walls. Phase 1 can be **manual/assisted** (user traces rooms);
  later phases can add **automatic detection** (image processing / vectorization
  of raster plans).
- **Room model** — Extrude room floor polygons to wall height to produce the 3D
  room; place openings (doors/windows) from the plan.
- **Regeneration** — Keep generation **parameterized** (seed, wall height,
  style, detail level) so "Regenerate" re-runs the pipeline for the *selected*
  room with varied parameters while preserving the selection.

Suggested module boundaries (create as code lands):

```
planto3d/
├── src/
│   ├── plan/        # load + parse 2D plan into rooms/walls geometry
│   ├── geometry/    # polygon → 3D extrusion, isometric/axonometric projection
│   ├── render/      # Three.js scene, orthographic camera, materials
│   ├── ui/          # upload, map view, room picking, Proceed/Regenerate
│   └── state/       # selected room, generation params, history
├── tests/
└── docs/
```

## Geometry notes

- **Isometric vs axonometric:** axonometric is the general family of parallel
  projections; isometric is the special case where all three axes are equally
  foreshortened (120° apart on screen). Decide and document which the product
  defaults to. Use an **orthographic** (parallel) camera either way.
- Represent each room as a 2D **floor polygon** plus a **wall height**; extrude
  to get walls. Keep units consistent (document the unit — e.g. metres).
- Keep the projection/camera setup in one place (`render/`) so all rooms share a
  consistent view angle.

## Development workflow

_No tooling exists yet._ Once the stack is chosen, document the **real**
commands here and keep them matching CI:

- **Setup** — install dependencies (e.g. `npm install`).
- **Run locally** — start the dev server (e.g. `npm run dev`).
- **Build** — production build.
- **Test** — run the suite, and how to run a single test.
- **Lint / format / typecheck** — the exact commands CI enforces.

## Conventions

Document real conventions as they emerge: language(s) and versions, formatter +
linter config, naming patterns, where tests live, and commit/branch
conventions.

## Git workflow

- Develop on feature branches; do not push directly to the default branch.
- Write clear, descriptive commit messages.
- Open pull requests (draft first) for review before merging.

## Open decisions (resolve, then record here)

- **Tech stack:** confirm web + Three.js (recommended) vs another approach.
- **Plan input format:** raster image vs vector/CAD; manual tracing vs automatic
  room detection for phase 1.
- **Projection default:** isometric vs a specific axonometric angle.
- **What "Regenerate" varies:** style, layout interpretation, random seed, or
  detail level.

## Notes for AI assistants

- This file is the source of truth for product intent and conventions — **keep
  it accurate**. Fix anything outdated as part of your change.
- Do **not** invent commands, architecture, or conventions as if they were real.
  Distinguish *spec/recommended* from *implemented*, as this file does.
- When real code exists, regenerate the structure/workflow sections from the
  actual files, configs, and CI pipeline.
