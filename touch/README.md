# Touch — Spatial Sonar for Foundry VTT

**System agnostic · Foundry v12+ (verified v14) · MIT**

Touch turns any scene into a living sonar field. Tokens, lights, sounds and
interior walls emit expanding pings; six perimeter cameras (top, bottom and the
four sides) watch the echoes and reconstruct the scene into a **4D room**
(x, y, z, t) rendered entirely with CSS.

## Features

- **Sonar emitters** — tokens (colored by disposition), ambient lights, ambient
  sounds, interior walls and **deployable waypoints** all ring. Every object
  stores its own **intensity (0–100)**, **mute**, **emission mode**
  (sound / light / both), **facing cone** (angle + field of view), **ping
  frequency** (its own seconds-per-ping, 0 = follow the global pulse) and
  **feedback tone** (low / mid / high); nothing about your system is required.
- **Scene controls** — Touch installs its own top-level control group
  (broadcast-tower icon, reachable with the **T** hotkey cycle) holding the
  **Sonar Viewer**, the **Sonar GM Hub** (GM only), and the Waypoint and
  Pathway placement tools. The hub is one click away, no macro needed.
- **Deployable waypoints** — hit the Waypoint tool (or `window.touch.armWaypointDeploy()`)
  and click the scene to drop a free-standing sonar emitter. Drag to move,
  set its height, aim its cone, choose what it emits, and delete it from the
  GM Hub. Waypoints live in scene flags — no tokens or actors needed.
- **Sonar pathways** — hit the Pathway tool and click two points on the
  scene: the line between them emits pings along its whole length, sampled
  every *N* grid units (endpoints included, capped at 64 points). Drag either
  endpoint to reshape (it re-pings along the new line), and tune intensity,
  mode, rate, tone, elevation, and spacing from the GM Hub.
- **Surface traces** — when a token crosses a pathway, the exact chord of
  line passing through the token's footprint is measured (Liang–Barsky clip)
  and emitted as hollow *trace* pings: a surface profile of whatever broke
  the line, chord width included.
- **Junction waypoints** — where two pathways cross, a shared junction
  waypoint (amber cross-in-diamond) is created automatically and removed if
  the crossing disappears. Move a line and its junctions follow.
- **3D sonar lattice** — extend the scene grid into a full 3D lattice from
  the GM Hub: *W × D* plan gridlines replicated on every storey (height).
  Each gridline is a real pathway — it pings, traces, and passes through the
  whole pipeline — and every **same-storey** crossing becomes a junction
  waypoint node automatically. Crossings on different storeys never create
  nodes (elevation-gated), so the lattice reads as a true 3D cage of sonar
  rails with nodes where rails of one floor meet. Regenerate or clear at any
  time; hand-drawn pathways are never touched. Hard-capped at 600 lines.
- **Six perimeter cameras** — top/bottom/left/right/front/back, each projecting
  pings into its own frame via CSS custom properties (`--u`, `--v`, `--s`,
  `--el`, `--az`, `--d`).
- **Sonar Viewer** — a dedicated window: reconstructed 4D room plus six camera
  tiles, scan/pause/calibrate controls.
- **Quantum Portal** — the six-camera array rendered as a real 3D CSS cube
  (`preserve-3d`, one face per camera) in both the viewer and the GM Hub.
  Click a face to snap the room stage to that camera's angle; orbit buttons
  and drag-to-orbit rotate the whole reconstruction in space, every floor
  becomes a translucent storey plane, and blips lift off the stage by
  elevation. Ships with the portal glow pulse, quantum hue shimmer, and
  glass window chrome (all `prefers-reduced-motion` safe).
- **Per-emitter ping frequency** — any object can ring on its own cadence
  instead of waiting for the global pulse; fast emitters are staggered so they
  don't blink in unison, while rate-0 objects all ring together on the global
  interval like a classic sonar sweep.
- **Heartbeat timers** — every row in the GM Hub carries a live pulse countdown
  to that object's next ping (exact same cadence math the pinger uses),
  beating faster as the ping approaches. The viewer's status line carries a
  heartbeat monitor for the whole room, racing as the next beat nears.
- **Corner heartbeat monitors** — deploy a sonar waypoint on every plan-grid
  corner of the 3D lattice (one per storey) with one click. Each monitor
  pings on its own cadence, shows its live countdown in the hub table, and
  anchors the lattice's pulse to the corners of every room. Re-deploying
  after regenerating the lattice re-anchors them; stale corners are removed
  automatically.
- **Persistent node memory** — every coordinate remembers its sonar history:
  grid cells store ping counts, surface traces (what broke a pathway, when,
  and its name), and echo returns at corner monitors — each with a decaying
  **heat** (teal → amber → red in the viewer). Memory persists in the scene
  (survives saves/reloads, copies with the scene), fades over a configurable
  retention window (default 1 hour, 0 = forever), and is capped at 2000
  cells with coldest-first eviction. Query it via `touch.memoryAt(x, y,
  storey)`, `touch.memoryAtMonitor(id)`, or `touch.memoryMap()`; the hub's
  Node Memory section reports coverage and can forget everything.
- **Track continuity with snapshot matching** — the first time an object
  crosses a zone (pathway beam), it is **stamped with a persistent track id
  flag tied to a captured snapshot** ("image") of the object: name,
  footprint, disposition, elevation band, and its actor/texture link.
  Every later crossing **re-captures the object and checks it against that
  stored image**: match → the path simply continues (no new event logged);
  snapshot contradicts the image → a genuinely new object and a new track.
  Even a *flagless* object (flag stripped, a copy, or a re-imported scene)
  is re-identified by its snapshot against known tracks and resumes the
  same path. Strong links (same actor or texture) always match; a
  configurable tolerance (default 0.25) sets how much an object may drift
  — grow, change elevation — and still be recognized. API:
  `touch.captureSignature(doc)`, `touch.trackOf(doc)`, `touch.trackGet(id)`
  (includes `sig` and `matches`), `touch.trackList()`.
- **Explicit persistent identities** — the GM can hand any object a
  **permanent identity id** (hub row identity button, or the API): the id is written
  to the document (`flags.touch.identity`), registered as a track tied to the
  object's snapshot, and every zone the object crosses thereafter continues
  that same id. Assigned ids are **permanent** — even "Forget All" only
  wipes the history; the next crossing re-registers the *same* id instead of
  forging a new one. Ids can be chosen by the GM (e.g. `trk.prisoner-1`) and
  are rejected if already owned by another object. Revoke strips the flags
  and the record, so the next crossing starts fresh. API:
  `touch.assignIdentity(doc, id?, label?)`, `touch.identityOf(doc)`,
  `touch.revokeIdentity(doc)`.
- **Snapshot re-capture** — after a disguise, polymorph, or actor swap, the
  GM can **re-capture** an identified object's snapshot from its hub row
  (or `touch.recaptureSignature(doc, label?)`): the stored image is replaced
  with the object's current appearance **in place**, so the same track —
  with its whole history — continues under the new image instead of forking
  a new contact. Optionally renames the track in the same stroke; also
  re-registers a track that Forget All wiped.
- **Track trails** — every active track's position history is drawn in the
  room view as a **fading dotted path**: older fixes dim and shrink toward
  the trail's tail, the newest fix pulses as the trail head, and each
  continuing path keeps its own stable hue so multiple contacts never blur
  together. Trails honor the floor selector, cap at 24 dots per track (16
  freshest tracks), and clear with Forget All.
- **Marching groups** — tokens moving **together** (freshest fixes within
  ±30u/s speed and ±15° heading) are folded into **one shared group
  contact** with a stable id: a marching patrol reads as a single contact,
  not a dozen separate alarms. Association re-derives on every crossing,
  so members joining or leaving the formation re-shuffle automatically;
  group ids stay stable while the group keeps marching and groups persist
  with the scene. The GM Hub lists live group contacts (members, shared
  speed/heading) with a manual dissolve button, member trail chips are
  marked, and grouped trails **share the group's hue** in the room view.
  API: `touch.groups()`, `touch.groupOf(docOrTrackId)`,
  `touch.trackListGrouped()`, `touch.dissolveGroup(id)`.
- **Formation timeline** — every membership flip is written to a per-group
  ledger: formed / joined / left / dissolved events with timestamps, shown
  under each group chip in the GM Hub (a track's own last 3 flips are also
  stamped on its chip hover). Departures need evidence — an incompatible
  crossing, or silence past the 30s freshness window — and a manually
  dissolved group's ledger stays readable until the stale sweep deletes it.
  API: `touch.formationTimeline(groupId?, perGroup?)`.
- **Feedback tones** — low / mid / high per object. Tones ride the ping
  payload, tint the viewer blips' blink rate, and change ring weight on the
  game canvas (4 / 2 / 1 px strokes) so each object returns visually distinct
  feedback.
- **Wave physics** — every ping becomes a true expanding wavefront in the
  room view: it attenuates with distance (inverse-√ falloff), **dissipates**
  over its lifetime, and **bounces off walls** as dashed echo fronts that
  reflect back into the room. Where fronts overlap they **interfere**:
  bright cyan dots where fronts reinforce, dark nodal nulls where an echo
  meets an outgoing front anti-phase. **Lattice gridlines glow with incident
  intensity** as fronts sweep across them, with a directional bias showing
  which way the wave is travelling. All computed deterministically on each
  client from the ping stream — zero extra network traffic. Toggle physics
  and reflections, tune wave speed, and fire a test pulse from the GM Hub.
- **GM Hub** — per-object intensity sliders, mute toggles, pan-to-object,
  bulk set/mute, **bulk verticals** (apply one Levels floor range or Wall
  Height extent to every selected kind at once), ping-all, rate/tone editing,
  wave-physics controls, and sonar tuning (interval, duration, rings,
  attenuation).
- **Elevation editing** — set any token, light or sound's elevation (and wall
  height via a `touch.elevation` flag) right from the hub; every change fires
  a fresh sonar ping. With **theripper93's Levels** active, the hub also edits
  each token/wall's floor range (`rangeBottom` / `rangeTop`) directly, and
  with **Wall Height** active it edits wall/light extents (`top` / `bottom`).
- **Floor-aware projection** — pings are placed on their floor storey in the
  viewer: Levels floor ranges win, otherwise elevation ÷ the "grid units per
  floor storey" setting. Dashed floor guide lines (F0, F1, …) appear for every
  occupied storey in the room view. A **floor selector** in the viewer header
  filters the sonogram to one elevation band (`F2 · 20–30u`) or shows all floors.
- **Vertical extent bands** — walls and lights with Levels floor ranges or
  Wall Height extents are drawn as translucent colored columns in the room
  view at their plan position, spanning their real vertical extent (slate for
  walls, the light's own tint for lights). Levels wins over Wall Height, and
  bands update live as flags change.
- **Canvas rings** — optional expanding ring sprites drawn on the game canvas
  so everyone sees the pings in-world.
- **Socketed** — the GM clock broadcasts pings so every client stays in phase.

## Usage

1. Enable the module. A **Sonar** tool appears in the token control palette.
2. **Open Sonar Viewer** — the 4D room + six cameras. Pings arrive
   automatically every *Ping frequency* seconds.
3. As GM, **Open Sonar GM Hub** — tune per-object intensity, mute, bulk ops.
4. Optional: adjust world settings (interval, duration, attenuation, camera
   enable flags) in *Configure Settings*.

## Emitter ids

Emitters are addressed as `token.<id>`, `light.<id>`, `sound.<id>`,
`wall.<id>`. Sonar config is stored per document in flags under scope `touch`,
key `sonar`: `{ intensity: 0-100, muted: bool }`.

## API

```js
window.touch.openViewer();
window.touch.openHub();          // GM
window.touch.pinger.pulse();     // force a full sonar pulse
window.touch.setEmitterConfig("token.abc123", { intensity: 80, muted: false });
window.touch.setEmitterRate("token.abc123", 2, "low"); // ping every 2s, deep tone
window.touch.setEmitterMode("token.abc123", "sound");   // sound | light | both
window.touch.setEmitterFacing("token.abc123", { angle: 90, fov: 60 });
window.touch.armWaypointDeploy(); // next scene click deploys a waypoint
window.touch.bulkSetIntensity(50);
window.touch.emitters();         // current echogenic objects
```

## Roadmap

- Wall occlusion of camera sight (echo shadows behind interior walls)
- Audio ping feedback (WebAudio, intensity → dB)
- 3D CSS transforms for the room (true z from token elevation)
- Per-camera projection modes (orthographic / perspective)

## License

MIT
