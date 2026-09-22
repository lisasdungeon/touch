/**
 * Touch — Sonar Viewer.
 * An ApplicationV2 window rendering the 4D sonogram: six camera tiles (the
 * perimeter) and one reconstructed room view. Pure CSS visuals; JS only feeds
 * CSS custom properties.
 */
import { CAMERAS, TONES } from "./constants.js";
import { levelsActive, getLevelsRange, getWallHeightRange } from "./elevation.js";
import { projectPointForRoom } from "./cameras.js";
import { getPathways } from "./pathways.js";

const STOREY_SPAN = 14; // visual percent per storey — keep in sync with cameras.js
const hexColor = (c, fallback) =>
  typeof c === "number" ? `#${c.toString(16).padStart(6, "0")}` : (c ?? fallback);

export class SonarViewer extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "touch-viewer",
    tag: "div",
    window: {
      title: "TOUCH.Viewer.Title",
      icon: "fa-solid fa-tower-broadcast",
      contentTag: "div",
      contentClasses: ["touch-viewer"],
    },
    position: { width: 760, height: 560 },
    actions: {
      scan: SonarViewer.#onScan,
      calibrate: SonarViewer.#onCalibrate,
      togglePause: SonarViewer.#onTogglePause,
      quantumCube: SonarViewer.#onQuantumCube,
      orbitLeft: SonarViewer.#onOrbitLeft,
      orbitRight: SonarViewer.#onOrbitRight,
      orbitTilt: SonarViewer.#onOrbitTilt,
      orbitReset: SonarViewer.#onOrbitReset,
    },
  };

  static PARTS = {
    main: { template: "modules/touch/templates/viewer.hbs" },
  };

  /** Latest frames per camera: Map<cameraId, Map<emitterId, frame>>. */
  frames = new Map();

  paused = false;

  /** Active floor band filter (storey base) or null for all floors. */
  floorFilter = null;

  /** @override */
  get title() {
    return `${game.i18n.localize("TOUCH.Viewer.Title")} — ${canvas.scene?.name ?? ""}`;
  }

  /** @override */
  async _prepareContext(_options) {
    const context = await super._prepareContext(_options);
    const count = window.touch?.emitters?.().length ?? 0;
    const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
    return {
      ...context,
      scene: { id: canvas.scene?.id ?? "", name: canvas.scene?.name ?? "" },
      cameras: CAMERAS.map((c) => ({ ...c })),
      quantumFaces: this.#quantumFaces(),
      paused: this.paused,
      storeyHeight,
      storeySpan: STOREY_SPAN,
      floors: this.#floorLines(),
      floorOptions: this.#floorOptions(),
      floorFilter: this.floorFilter,
      bands: this.#bands(),
      levelsOn: levelsActive(),
      objects: game.i18n.format("TOUCH.Viewer.Objects", { count }),
    };
  }

  /**
   * Floor guide lines: every storey band that has at least one emitter, plus
   * the ground floor. Each line knows its offset in room percent below the
   * middle. Bands are floor() based so they match the filter.
   */
  #floorLines() {
    const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
    const storeys = new Set([0]);
    for (const e of window.touch?.emitters?.() ?? []) {
      const lv = e.doc?.flags?.levels ?? {};
      const z = Number.isFinite(lv.rangeBottom)
        ? lv.rangeBottom
        : Number.isFinite(lv.rangeTop)
          ? lv.rangeTop - storeyHeight
          : (e.elevation ?? 0);
      storeys.add(Math.floor(z / storeyHeight));
    }
    return [...storeys].sort((a, b) => b - a).map((s) => ({ storey: s, offset: s * STOREY_SPAN }));
  }

  /** Dropdown options: "All floors" plus one entry per band with its range. */
  #floorOptions() {
    const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
    const options = [{ value: "", label: game.i18n.localize("TOUCH.Viewer.FloorAll") }];
    for (const { storey } of [...this.#floorLines()].sort((a, b) => a.storey - b.storey)) {
      options.push({
        value: String(storey),
        label: game.i18n.format("TOUCH.Viewer.FloorOption", {
          storey,
          from: storey * storeyHeight,
          to: (storey + 1) * storeyHeight,
        }),
        selected: this.floorFilter === storey,
      });
    }
    return options;
  }

  /**
   * Vertical extent bands: walls and lights whose Levels floor range or Wall
   * Height extent gives them vertical presence. Rendered as translucent
   * columns in the room view, positioned with the same math as blips
   * (--u plan position, STOREY_SPAN per storey). Levels wins over Wall Height,
   * matching the pinger's vertical-placement precedence.
   */
  #bands() {
    const unit = Math.abs(Number(game.settings.get("touch", "storeyHeight")) || 10);
    const d = canvas.dimensions;
    const bands = [];
    for (const e of window.touch?.emitters?.() ?? []) {
      if (e.kind !== "wall" && e.kind !== "light") continue;
      const lv = getLevelsRange(e.doc);
      const wh = getWallHeightRange(e.doc);
      const hasLv = lv.bottom !== null || lv.top !== null;
      const hasWh = wh.bottom !== null || wh.top !== null;
      if (!hasLv && !hasWh) continue;
      const bottom = hasLv ? lv.bottom : wh.bottom;
      const top = hasLv ? lv.top : wh.top;
      // Lights hang below a ceiling bound when no floor is set.
      const rawBottom = bottom ?? (top !== null ? top - unit : null);
      const rawTop = top ?? (bottom !== null ? bottom + unit : null);
      if (rawBottom == null && rawTop == null) continue; // fully infinite
      // Clamp to the visible z window: at least one storey tall, no deeper
      // than one storey below ground, at most three storeys up.
      const low = Math.max(rawBottom ?? rawTop - unit, -unit);
      const high = Math.min(rawTop ?? low + unit, unit * 3);
      const fmt = (v) => (v == null ? "∞" : `${v}u`);
      bands.push({
        key: e.id,
        kind: e.kind,
        label: `${e.name ?? game.i18n.localize(e.kind === "wall" ? "TOUCH.Viewer.BandWall" : "TOUCH.Viewer.BandLight")} — ${hasLv ? "Levels" : "Wall Height"} ${fmt(rawBottom)}→${fmt(rawTop)}`,
        u: ((e.x - d.sceneX) / d.sceneWidth) * 200 - 100, // unitless, like blip --u
        bottom: (low / unit) * STOREY_SPAN,
        top: ((high - low) / unit) * STOREY_SPAN,
        accent: e.kind === "wall" ? "#94a3b8" : hexColor(e.color, "#ffd88a"),
      });
    }
    return bands;
  }

  /**
   * Create/update/remove extent band elements without a re-render, so bands
   * track flag edits the same way floor lines and blips do.
   */
  reconcileBands(bands) {
    const room = this.element?.querySelector(".touch-room-space");
    if (!room) return;
    const keys = new Set();
    for (const b of bands) {
      keys.add(b.key);
      let el = room.querySelector(`.touch-extent-band[data-key="${b.key}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "touch-extent-band";
        el.dataset.key = b.key;
        room.appendChild(el);
      }
      el.dataset.kind = b.kind;
      el.title = b.label;
      el.style.setProperty("--u", b.u.toFixed(2));
      el.style.setProperty("--b", `${b.bottom.toFixed(2)}%`);
      el.style.setProperty("--bh", `${Math.max(4, b.top).toFixed(2)}%`);
      el.style.color = b.accent;
    }
    for (const el of room.querySelectorAll(".touch-extent-band")) {
      if (!keys.has(el.dataset.key)) el.remove();
    }
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.dataset.paused = String(this.paused);
    // Floor selector (change event; ActionsManager only covers clicks).
    this.element.querySelector(".touch-floor-select")?.addEventListener("change", (event) => {
      const value = event.target.value;
      this.floorFilter = value === "" ? null : Number(value);
      this.flush();
    });
    this.#syncStatus();
    this.#startBeatTicker();
    this.#bindOrbitDrag();
    this.reconcileBands(this.#bands());
  }

  /**
   * Heartbeat monitor: a 1 Hz ticker that drives the status line's ♥ with
   * the seconds until the room's next ping — the heart races as the beat
   * approaches and rests right after it fires.
   */
  #beatTicker = null;

  #startBeatTicker() {
    this.#stopBeatTicker();
    const step = () => {
      if (!this.rendered || !this.element) {
        this.#beatTicker = null;
        return;
      }
      const status = this.element.querySelector("[data-status]");
      if (status) {
        let heart = status.querySelector(".touch-heart");
        if (!heart) {
          heart = document.createElement("span");
          heart.className = "touch-heart";
          heart.textContent = "♥";
          status.appendChild(heart);
        }
        const beats = window.touch?.heartbeats?.() ?? new Map();
        let dueIn = null;
        for (const v of beats.values()) dueIn = dueIn === null ? v : Math.min(dueIn, v);
        if (dueIn !== null && !this.paused) {
          heart.style.animationDuration = `${Math.max(0.3, Math.min(1.3, 0.3 + dueIn * 0.12))}s`;
          heart.dataset.due = String(dueIn);
          heart.title = game.i18n.format("TOUCH.Viewer.NextBeat", { n: dueIn });
        } else {
          heart.style.animationDuration = "1.6s";
          heart.dataset.due = "";
        }
      }
      this.#beatTicker = setTimeout(step, 1000);
      this.#beatTicker.unref?.();
    };
    step();
  }

  #stopBeatTicker() {
    if (this.#beatTicker) {
      clearTimeout(this.#beatTicker);
      this.#beatTicker = null;
    }
  }

  async close(options) {
    this.#stopBeatTicker();
    return super.close(options);
  }

  /**
   * Track trails: each active track's position history drawn as a fading
   * dotted path through the room. Reconciled on every flush; the newest fix
   * pulses as the trail head. Cheap no-op when closed, paused, or empty.
   */
  #flushTrails(now) {
    const room = this.element?.querySelector(".touch-room-space");
    const trailsHost = room?.querySelector(".touch-track-trails");
    if (!trailsHost) return;
    const tracks = window.touch?.trackList?.() ?? [];
    const settings = {
      storeyHeight: game.settings.get("touch", "storeyHeight") ?? 10,
      echoAttenuation: game.settings.get("touch", "echoAttenuation") ?? 0.5,
    };
    const storeyHeight = settings.storeyHeight;
    // Same floor-band rule as blips: null shows all, a storey filters to its
    // [base, base+storeyHeight) elevation band.
    const inBandLocal = (pt) =>
      this.floorFilter === null ||
      Math.floor(((pt.storey ?? 0) * storeyHeight) / storeyHeight) === this.floorFilter;
    const front = CAMERAS.find((c) => c.id === "front") ?? CAMERAS[0];
    const MAX_DOTS = 24;             // per trail (oldest dropped from view)
    const MAX_TRAILS = 16;           // freshest tracks only
    const existing = [...trailsHost.children];
    let i = 0;
    for (const track of tracks.slice(0, MAX_TRAILS)) {
      const pts = track.points.slice(-MAX_DOTS);
      // Marching-group contacts share the group's hue: a convoy reads as one
      // colored column, not a bundle of unrelated paths.
      const gid = track.groupId ?? null;
      const hue = gid ? this.#trackHue(gid) : this.#trackHue(track.id);
      const age0 = (now - (track.points[track.points.length - 1]?.t ?? now)) / 1000;
      for (let p = 0; p < pts.length; p++) {
        const pt = pts[p];
        if (!inBandLocal(pt)) continue; // i only advances for written dots
        const vars = projectPointForRoom(pt.x, pt.y, (pt.storey ?? 0) * (settings.storeyHeight), front, settings);
        let dot = existing[i];
        if (!dot) {
          dot = document.createElement("div");
          trailsHost.appendChild(dot);
        }
        // Fresher fixes ride higher opacity and scale: the trail fades with
        // age along its length AND as the whole track goes quiet. p=0 is the
        // oldest fix, so recency grows toward the head.
        const recency = p / Math.max(1, pts.length - 1);
        const quiet = Math.max(0, 1 - age0 / 600); // 10 min to vanish
        const alpha = (0.12 + 0.55 * recency) * (0.25 + 0.75 * quiet);
        dot.className = "touch-track-dot";
        dot.dataset.track = track.id;
        dot.style.setProperty("--u", vars["--u"]);
        dot.style.setProperty("--v", vars["--v"]);
        dot.style.setProperty("--hue", String(hue));
        dot.style.setProperty("--a", alpha.toFixed(3));
        dot.style.setProperty("--s", (0.5 + 0.5 * recency).toFixed(3));
        dot.dataset.head = p === pts.length - 1 ? "1" : "0";
        dot.title = track.label ?? track.id;
        if (gid) {
          dot.dataset.group = gid;
          dot.title += `\n${game.i18n.localize("TOUCH.Groups.MemberHint")}`;
        }
        i++;
      }
    }
    existing.slice(i).forEach((el) => el.remove());
  }

  /** Stable hue per track id, so each continuing path keeps its color. */
  #trackHue(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  /**
   * Wave-physics layer: reconcile expanding wavefronts, interference dots,
   * and lattice rails into the room view. Called by the wave loop (~15 Hz);
   * cheap no-op when the viewer is closed, paused, or physics is off.
   */
  flushWaves() {
    const wf = window.touch?.wavefield;
    if (!wf || !this.rendered || this.paused) return;
    const room = this.element?.querySelector(".touch-room-space");
    if (!room) return;
    const settings = {
      storeyHeight: game.settings.get("touch", "storeyHeight") ?? 10,
      echoAttenuation: game.settings.get("touch", "echoAttenuation") ?? 0.5,
    };
    const ff = this.floorFilter;
    const storeyHeight = settings.storeyHeight;
    const inBand = (elev) =>
      ff === null ||
      ((elev / storeyHeight) * storeyHeight >= ff * storeyHeight &&
        (elev / storeyHeight) * storeyHeight < (ff + 1) * storeyHeight);
    const now = Date.now();

    // ---------------------------------------------------- wavefront rings
    // Each live front is an expanding circle in plan projection; side views
    // squash it via scaleY. Echos (reflections) render dashed.
    const ringsHost = room.querySelector(".touch-wave-rings");
    if (ringsHost) {
      const fronts = [...wf.waves, ...wf.echos];
      const existing = [...ringsHost.children];
      const seen = new Set();
      let ri = 0;
      for (const w of fronts) {
        if (!inBand(w.elevation ?? 0)) continue;
        const age = (now - w.born) / 1000;
        const speed = game.settings.get("touch", "waveSpeed") ?? 400;
        // Just-born fronts render as a 2px seed rather than vanishing.
        const radius = Math.max(2, age * speed);
        const vars = projectPointForRoom(w.x, w.y, w.elevation ?? 0, CAMERAS.find((c) => c.id === "front") ?? CAMERAS[0], settings);
        let ring = existing[ri];
        if (!ring) {
          ring = document.createElement("div");
          ringsHost.appendChild(ring);
        }
        ring.className = `touch-wave-ring${w.echo ? " touch-wave-echo" : ""}`;
        ring.style.setProperty("--u", vars["--u"]);
        ring.style.setProperty("--v", vars["--v"]);
        ring.style.setProperty("--r", `${Math.min(radius, 4000)}px`);
        ring.style.setProperty("--a", Math.max(0, Math.min(0.85, (w.amp ?? 0.3) * 1.6)).toFixed(3));
        ring.style.setProperty("--age", age.toFixed(2));
        seen.add(ring);
        ri++;
      }
      existing.slice(ri).forEach((el) => el.remove());
    }

    // ---------------------------------------------------- interference dots
    const nodesHost = room.querySelector(".touch-wave-nodes");
    if (nodesHost) {
      const dots = wf.dots.filter((dot) => inBand(0));
      const existing = [...nodesHost.children];
      let ni = 0;
      for (const dot of dots) {
        const vars = projectPointForRoom(dot.x, dot.y, 0, CAMERAS.find((c) => c.id === "front") ?? CAMERAS[0], settings);
        let node = existing[ni];
        if (!node) {
          node = document.createElement("div");
          nodesHost.appendChild(node);
        }
        node.className = `touch-wave-node${dot.phase === "destructive" ? " touch-wave-null" : ""}`;
        node.style.setProperty("--u", vars["--u"]);
        node.style.setProperty("--v", vars["--v"]);
        node.style.setProperty("--amp", dot.amp.toFixed(3));
        node.style.setProperty("--age", ((now - dot.born) / 1000).toFixed(2));
        node.title = dot.phase === "destructive"
          ? game.i18n.localize("TOUCH.Waves.NodeDestructive")
          : game.i18n.localize("TOUCH.Waves.NodeConstructive");
        ni++;
      }
      existing.slice(ni).forEach((el) => el.remove());
    }

    // ---------------------------------------------------- lattice rails
    const railsHost = room.querySelector(".touch-wave-rails");
    if (railsHost) {
      const rails = wf.latticeIntensity(
        getPathways(canvas.scene)
          .filter((p) => p.lattice)
          .map((p) => ({ id: p.id, c: p.c, elevation: p.elevation ?? 0 }))
      );
      const existing = [...railsHost.children];
      let li = 0;
      for (const rail of rails) {
        if (!inBand(rail.elevation)) continue;
        const a = projectPointForRoom(rail.x1, rail.y1, rail.elevation, CAMERAS.find((c) => c.id === "front") ?? CAMERAS[0], settings);
        const b = projectPointForRoom(rail.x2, rail.y2, rail.elevation, CAMERAS.find((c) => c.id === "front") ?? CAMERAS[0], settings);
        let el = existing[li];
        if (!el) {
          el = document.createElement("div");
          railsHost.appendChild(el);
        }
        el.className = "touch-wave-rail";
        el.style.setProperty("--u", a["--u"]);
        el.style.setProperty("--v", a["--v"]);
        el.style.setProperty("--u2", b["--u"]);
        el.style.setProperty("--v2", b["--v"]);
        el.style.setProperty("--glow", (rail.glow / 100).toFixed(3));
        el.style.setProperty("--bias", rail.bias.toFixed(2));
        el.dataset.key = rail.key;
        li++;
      }
      existing.slice(li).forEach((el) => el.remove());
    }
  }

  /** Ingest a frame from the camera array (one per camera per ping). */
  ingestFrame(frame) {
    if (!this.frames.has(frame.cam)) this.frames.set(frame.cam, new Map());
    this.frames.get(frame.cam).set(frame.id, frame);
  }

  /** Push frames into the DOM as CSS custom properties on each camera tile. */
  flush() {
    this.reconcileBands(this.#bands());
    if (!this.rendered || this.paused) return;
    const root = this.element;
    if (!root) return;
    const now = Date.now();
    const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
    this.#flushTrails(now);

    // Floor filter: null shows all; a number filters to that elevation band
    // [base, base+storeyHeight) using each frame's exact storey value.
    const ff = this.floorFilter;
    const bandBase = ff === null ? null : ff * storeyHeight;
    const inBand = (f) =>
      ff === null ||
      ((f.storey ?? 0) * storeyHeight >= bandBase && (f.storey ?? 0) * storeyHeight < bandBase + storeyHeight);

    for (const cam of CAMERAS) {
      const tile = root.querySelector(`[data-camera="${cam.id}"]`);
      if (!tile) continue;
      const latest = this.frames.get(cam.id);
      const blipHost = tile.querySelector(".touch-cam-blips") ?? tile;
      const existing = [...blipHost.querySelectorAll(".touch-blip")];
      let index = 0;
      if (latest) {
        for (const f of latest.values()) {
          if (!inBand(f)) continue;
          let blip = existing[index];
          if (!blip) {
            blip = document.createElement("div");
            blip.className = "touch-blip";
            blipHost.appendChild(blip);
          }
          for (const [k, v] of Object.entries(f.vars)) blip.style.setProperty(k, v);
          blip.style.setProperty("--age", ((now - f.born) / 1000).toFixed(2));
          if (f.facing) {
            // Directional cone wedge (rotates with facing rel. to camera)
            blip.style.setProperty("--fang", `${f.facing.relDeg.toFixed(1)}deg`);
            blip.style.setProperty("--ffov", `${f.facing.fov}deg`);
          }
          blip.dataset.kind = f.kind;
          blip.dataset.mode = f.mode ?? "both";
          blip.dataset.omni = String((f.facing?.fov ?? 360) >= 360);
          // Feedback tone drives blink cadence (slow = deep return)
          const blink = TONES[f.tone ?? "mid"]?.blink ?? 2;
          blip.style.animationDuration = `${blink}s`;
          blip.dataset.name = f.name ?? "";
          blip.title = f.name ?? "";
          // A persistent sonar identity id is surfaced on the blip: class for
          // the badge styling, title for the hover readout.
          if (f.identity) {
            blip.classList.add("touch-identified");
            blip.title += `\n${game.i18n.format("TOUCH.Viewer.Identity", { id: f.identity })}`;
          }
          if (f.color) blip.style.color = f.color;
          index++;
        }
      }
      // Fade out stale blips beyond the live set.
      existing.slice(index).forEach((el) => el.style.setProperty("--s", "0.12"));
    }

    // Reconstructed room: mirror the front camera's projection (fallback top).
    const room = root.querySelector(".touch-room-space");
    if (room) {
      const source = this.frames.get("front") ?? this.frames.get("top");
      const roomBlips = [...room.querySelectorAll(".touch-room-blip")];
      let ri = 0;
      if (source) {
        for (const f of source.values()) {
          if (!inBand(f)) continue;
          let blip = roomBlips[ri];
          if (!blip) {
            blip = document.createElement("div");
            blip.className = "touch-room-blip";
            room.appendChild(blip);
          }
          for (const [k, v] of Object.entries(f.vars)) blip.style.setProperty(k, v);
          blip.style.setProperty("--age", ((now - f.born) / 1000).toFixed(2));
          blip.style.setProperty("--floor-offset", `${(f.storey ?? 0) * STOREY_SPAN}%`);
          // Quantum 3D: the blip's lift off the stage plane in px.
          blip.style.setProperty("--storey-z", String(Math.round((f.storey ?? 0) * 40)));
          blip.dataset.floor = String(Math.round(f.storey ?? 0));
          blip.dataset.kind = f.kind;
          blip.dataset.mode = f.mode ?? "both";
          if (f.trace) {
            // Surface trace: hollow segment blip spanning the chord fragment.
            blip.dataset.trace = "true";
            blip.dataset.traceToken = f.traceTokenId ?? "";
            blip.dataset.track = f.trackId ?? "";
            blip.title = `${f.name ?? ""} — surface trace (${f.chord ?? "?"}u chord)` +
              (f.trackContinued ? ` · ${game.i18n.localize("TOUCH.Memory.TrackContinued")}` : "");
            if (f.vars && f.vars["--v2"] !== undefined) {
              blip.style.setProperty("--v2", f.vars["--v2"]);
            }
          } else if (blip.dataset.trace) {
            delete blip.dataset.trace;
            delete blip.dataset.track;
          }
          blip.dataset.omni = String((f.facing?.fov ?? 360) >= 360);
          blip.style.animationDuration = `${TONES[f.tone ?? "mid"]?.blink ?? 2}s`;
          if (f.facing) {
            // Room cones use the front camera's relative facing
            blip.style.setProperty("--fang", `${f.facing.relDeg.toFixed(1)}deg`);
            blip.style.setProperty("--ffov", `${f.facing.fov}deg`);
          }
          blip.title = f.name ? `${f.name} — floor ${Math.round(f.storey ?? 0)}` : "";
          if (f.color) blip.style.color = f.color;
          // Node memory: tint blips by remembered activity heat at this spot.
          const mem = window.touch?.memoryAt?.(f.x, f.y, Math.round(f.storey ?? 0));
          if (mem && mem.currentHeat > 0.05) {
            blip.style.setProperty("--mem-heat", mem.currentHeat.toFixed(2));
            blip.style.setProperty("--mem-color", window.touch.heatColor(mem.currentHeat));
            const what = game.i18n.localize(`TOUCH.Memory.Whats.${mem.lastWhat ?? "ping"}`);
            const ago = Math.round((Date.now() - mem.lastSeen) / 1000);
            blip.title = `${blip.title}\n${game.i18n.format("TOUCH.Memory.LastSeen", { what, label: mem.lastLabel ?? "?", n: ago })}`;
          } else {
            blip.style.removeProperty("--mem-heat");
          }
          this.#ensureFloorLine(room, Math.round(f.storey ?? 0));
          ri++;
        }
      }
      roomBlips.slice(ri).forEach((el) => el.remove());
    }
    this.#syncStatus();
  }

  /** Ensure a floor guide line exists for a storey (live, no re-render). */
  #ensureFloorLine(room, storey) {
    if (!room.querySelector(`.touch-floor-line[data-floor="${storey}"]`)) {
      const line = document.createElement("div");
      line.className = "touch-floor-line";
      line.dataset.floor = String(storey);
      line.style.setProperty("--floor-offset", `${storey * STOREY_SPAN}%`);
      const label = document.createElement("span");
      label.className = "touch-floor-label";
      label.textContent = `F${storey}`;
      line.appendChild(label);
      room.appendChild(line);
    }
    this.#ensureFloorOption(storey);
  }

  /** Ensure the floor selector offers a given storey (live, keeps listener). */
  #ensureFloorOption(storey) {
    const select = this.element?.querySelector(".touch-floor-select");
    if (!select || select.querySelector(`option[value="${storey}"]`)) return;
    const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
    const option = document.createElement("option");
    option.value = String(storey);
    option.textContent = game.i18n.format("TOUCH.Viewer.FloorOption", {
      storey,
      from: storey * storeyHeight,
      to: (storey + 1) * storeyHeight,
    });
    // Keep ascending storey order, after the "All floors" entry.
    const later = [...select.options].find(
      (o) => o.value !== "" && Number(o.value) > storey
    );
    select.insertBefore(option, later ?? null);
  }

  #syncStatus() {
    const el = this.element?.querySelector("[data-status]");
    if (!el) return;
    const base = this.paused
      ? `⏸ ${game.i18n.localize("TOUCH.Viewer.Paused")}`
      : `● ${game.i18n.localize("TOUCH.Viewer.Running")}`;
    el.textContent =
      this.floorFilter === null ? base : `${base} · F${this.floorFilter}`;
  }

  static #onScan() {
    window.touch?.pinger?.pulse({ broadcast: true });
  }

  // ------------------------------------------------------- quantum portal

  /** The six camera faces of the quantum cube, with glyphs. */
  #quantumFaces() {
    const glyphs = { top: "✦", bottom: "✧", left: "◀", right: "▶", front: "◆", back: "◇" };
    return CAMERAS.map((c) => ({ cam: c.id, label: c.label, face: c.id, glyph: glyphs[c.id] ?? c.label[0] }));
  }

  /**
   * Click a cube face: snap the 3D stage to that camera's angle (the plan
   * cameras look straight down/up, the side cameras face their wall).
   */
  static #onQuantumCube(event, target) {
    // The action target is the button; the clicked face is inside it.
    const face = event.target?.closest?.("[data-face]")?.dataset.face;
    if (!face) return;
    this.#applyOrbit(face);
  }

  /** Orbit actions: yaw/tilt nudges and reset. */
  static #onOrbitLeft() { this.#applyOrbit(null, -30); }
  static #onOrbitRight() { this.#applyOrbit(null, +30); }
  static #onOrbitTilt() { this.#applyOrbit(null, 0, 0.35); }
  static #onOrbitReset() { this.#applyOrbit("reset"); }

  /**
   * Apply an orbit to the room stage: a camera preset, a yaw delta, a tilt
   * delta, or "reset". Values live as CSS vars on the stage. Instance
   * method — ApplicationV2 hands actions the app instance as receiver.
   */
  #applyOrbit(preset, yawDelta = 0, tiltDelta = 0) {
    const stage = this.element?.querySelector("[data-room-space]");
    if (!stage) return;
    const cur = {
      yaw: Number(stage.style.getPropertyValue("--yaw")) || 0,
      tilt: Number(stage.style.getPropertyValue("--tilt")) || 0.35,
    };
    let { yaw, tilt } = cur;
    const presets = { top: 0.0, bottom: 1.0, left: 0.3, right: 0.3, front: 0.35, back: 0.35, reset: 0.35 };
    if (preset === "reset") {
      yaw = 0;
      tilt = 0.35;
    } else if (preset && preset in presets) {
      tilt = presets[preset];
      yaw = { left: -90, right: 90, front: 0, back: 180, top: 0, bottom: 0 }[preset] ?? yaw;
    } else {
      yaw += yawDelta;
      tilt = Math.max(0, Math.min(1, tilt + tiltDelta));
    }
    stage.classList.add("touch-3d");
    stage.style.setProperty("--yaw", String(yaw));
    stage.style.setProperty("--tilt", String(tilt));
  }

  /**
   * Drag-to-orbit: pointer drag across the room rotates the quantum stage.
   * Horizontal drag = yaw, vertical drag = tilt. Bound once per render.
   */
  #bindOrbitDrag() {
    const room = this.element?.querySelector("[data-room]");
    const stage = this.element?.querySelector("[data-room-space]");
    if (!room || !stage || room.dataset.orbitBound) return;
    room.dataset.orbitBound = "true";
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let yaw0 = 0;
    let tilt0 = 0.35;
    room.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      dragging = true;
      sx = ev.clientX;
      sy = ev.clientY;
      yaw0 = Number(stage.style.getPropertyValue("--yaw")) || 0;
      tilt0 = Number(stage.style.getPropertyValue("--tilt")) || 0.35;
      room.setPointerCapture?.(ev.pointerId);
    });
    room.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      stage.classList.add("touch-3d");
      stage.style.setProperty("--yaw", String(yaw0 + (ev.clientX - sx) * 0.5));
      stage.style.setProperty("--tilt", String(Math.max(0, Math.min(1, tilt0 + (ev.clientY - sy) * 0.004))));
    });
    const stop = () => {
      dragging = false;
    };
    room.addEventListener("pointerup", stop);
    room.addEventListener("pointercancel", stop);
  }

  static #onCalibrate() {
    this.frames.clear();
    this.floorFilter = null;
    this.element?.querySelectorAll(".touch-blip, .touch-room-blip").forEach((el) => el.remove());
    const sel = this.element?.querySelector(".touch-floor-select");
    if (sel) sel.value = "";
    this.render();
  }

  static #onTogglePause() {
    this.paused = !this.paused;
    this.element.dataset.paused = String(this.paused);
    this.#syncStatus();
  }
}
