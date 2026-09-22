/**
 * Touch — Sonar GM Hub.
 * GM-only control room: per-object intensity, mute, bulk operations.
 */
import { MODULE_ID, INTENSITY_MIN, INTENSITY_MAX, DEFAULTS, CAMERAS } from "./constants.js";
import { collectEmitters, getConfig, setConfig } from "./emitters.js";
import { getLattice } from "./lattice.js";
import {
  getEmitterElevation,
  getLevelsRange,
  getWallHeightRange,
  levelsActive,
  wallHeightActive,
} from "./elevation.js";
import { EMISSION_MODES, TONE_IDS, RATE_MIN, RATE_MAX, ANGLE_MIN, ANGLE_MAX, FOV_MIN, FOV_MAX } from "./constants.js";

export class SonarHub extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "touch-hub",
    tag: "div",
    window: {
      title: "TOUCH.Hub.Title",
      icon: "fa-solid fa-sliders",
    },
    position: { width: 640, height: "auto" },
    actions: {
      goto: SonarHub.#onGoto,
      removeWaypoint: SonarHub.#onRemoveWaypoint,
      bulkIntensity: SonarHub.#onBulkIntensity,
      bulkVerticalsApply: SonarHub.#onBulkVerticalsApply,
      bulkVerticalsClear: SonarHub.#onBulkVerticalsClear,
      removePathway: SonarHub.#onRemovePathway,
      latticeGenerate: SonarHub.#onLatticeGenerate,
      latticeClear: SonarHub.#onLatticeClear,
      monitorsDeploy: SonarHub.#onMonitorsDeploy,
      monitorsClear: SonarHub.#onMonitorsClear,
      memoryClear: SonarHub.#onMemoryClear,
      groupDissolve: SonarHub.#onGroupDissolve,
      identityAssign: SonarHub.#onIdentityAssign,
      identityRevoke: SonarHub.#onIdentityRevoke,
      identityRecapture: SonarHub.#onIdentityRecapture,
      wavesTest: SonarHub.#onWavesTest,
      muteAll: SonarHub.#onMuteAll,
      unmuteAll: SonarHub.#onUnmuteAll,
      pingAll: SonarHub.#onPingAll,
      openQuantum: SonarHub.#onOpenQuantum,
      reset: SonarHub.#onReset,
    },
  };

  static PARTS = {
    form: {
      template: "modules/touch/templates/hub.hbs",
      classes: ["touch-hub"],
    },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize("TOUCH.Hub.Title")} — ${canvas.scene?.name ?? ""}`;
  }

  /** @override */
  async _prepareContext(_options) {
    const scene = canvas.scene;
    const emitters = collectEmitters(scene);
    // Pathway sample points collapse to one row per pathway ("pw.xxx#3" ->
    // "pw.xxx") so the table stays readable; edits route back to the line.
    const seenPathways = new Set();
    const rows = [];
    for (const e of emitters) {
      if (e.kind === "pathway") {
        if (seenPathways.has(e.pathwayId)) continue;
        seenPathways.add(e.pathwayId);
        rows.push({
          id: e.id,
          pathwayId: e.pathwayId,
          kind: e.kind,
          name: e.name,
          x: Math.round(e.x),
          y: Math.round(e.y),
          elevation: e.elevation,
          spacing: e.spacing ?? 2,
          intensity: e.config.intensity,
          muted: e.config.muted,
          mode: e.config.mode ?? "both",
          angle: e.config.angle ?? 0,
          fov: e.config.fov ?? 360,
          rate: e.config.rate ?? 0,
          tone: e.config.tone ?? "mid",
          tones: TONE_IDS,
          isWaypoint: false,
          isPathway: true,
          isMonitor: false,
          levelsRange: { bottom: null, top: null },
          canLevel: false,
          wallHeightRange: { bottom: null, top: null },
          canWallHeight: false,
          kindLabel: game.i18n.localize("TOUCH.Hub.Type.Pathway"),
        });
        continue;
      }
      rows.push({
        id: e.id,
        kind: e.kind,
        name: e.name,
        x: Math.round(e.x),
        y: Math.round(e.y),
        intensity: e.config.intensity,
        muted: e.config.muted,
        elevation: getEmitterElevation(e),
        mode: e.config.mode ?? "both",
        angle: e.config.angle ?? 0,
        fov: e.config.fov ?? 360,
        rate: e.config.rate ?? 0,
        tone: e.config.tone ?? "mid",
        tones: TONE_IDS,
        isWaypoint: e.kind === "waypoint",
        isPathway: false,
        pathwayId: null,
        spacing: null,
        isMonitor: Boolean(e.cornerMonitor),
        levelsRange: getLevelsRange(e.doc),
        canLevel: levelsActive() && (e.kind === "token" || e.kind === "wall"),
        wallHeightRange: getWallHeightRange(e.doc),
        canWallHeight: wallHeightActive() && (e.kind === "wall" || e.kind === "light"),
        kindLabel: e.cornerMonitor
          ? game.i18n.localize("TOUCH.Lattice.Monitor")
          : game.i18n.localize(`TOUCH.Hub.Type.${e.kind.charAt(0).toUpperCase() + e.kind.slice(1)}`),
        identity: e.identity ?? null,
      });
    }
    return {
      emitters: rows,
      count: rows.length,
      min: INTENSITY_MIN,
      max: INTENSITY_MAX,
      defaults: DEFAULTS,
      globalIntensity: game.settings.get(MODULE_ID, "globalIntensity") ?? 60,
      globalMuted: game.settings.get(MODULE_ID, "globalMuted") ?? false,
      quantumFaces: SonarHub.#quantumFaces(),
      levelsOn: levelsActive(),
      lattice: getLattice(canvas.scene),
      waves: {
        enabled: game.settings.get(MODULE_ID, "wavePhysics") ?? true,
        reflections: game.settings.get(MODULE_ID, "waveReflections") ?? true,
        speed: game.settings.get(MODULE_ID, "waveSpeed") ?? 400,
      },
      wallHeightOn: wallHeightActive(),
      vertKinds: [
        { module: "levels", kind: "token", label: game.i18n.localize("TOUCH.Hub.Type.Token"), on: levelsActive() },
        { module: "levels", kind: "wall", label: game.i18n.localize("TOUCH.Hub.Type.Wall"), on: levelsActive() },
        { module: "wallHeight", kind: "wall", label: game.i18n.localize("TOUCH.Hub.Type.Wall"), on: wallHeightActive() },
        { module: "wallHeight", kind: "light", label: game.i18n.localize("TOUCH.Hub.Type.Light"), on: wallHeightActive() },
      ],
      settings: {
        pingInterval: game.settings.get(MODULE_ID, "pingInterval"),
        pingDuration: game.settings.get(MODULE_ID, "pingDuration"),
        maxRings: game.settings.get(MODULE_ID, "maxRings"),
        echoAttenuation: game.settings.get(MODULE_ID, "echoAttenuation"),
        showRingSprites: game.settings.get(MODULE_ID, "showRingSprites"),
      },
      monitors: {
        count: rows.filter((r) => r.isMonitor).length,
      },
      memory: {
        count: window.touch?.memoryMap?.().length ?? 0,
        retention: game.settings.get(MODULE_ID, "memoryRetention") ?? 3600,
        tracks: window.touch?.trackListGrouped?.().slice(0, 12).map((t) => ({
          id: t.id,
          label: t.label,
          points: t.points.length,
          cells: t.cells.length,
          assigned: Boolean(t.assigned),
          groupId: t.groupId ?? null,
        })) ?? [],
        groups: window.touch?.groups?.().slice(0, 6).map((g) => ({
          id: g.id,
          label: g.label ?? game.i18n.localize("TOUCH.Groups.Unnamed"),
          count: g.members.length,
          names: g.members.map((m) => m.label).slice(0, 4).join(", "),
          speed: Math.round(g.vector?.speed ?? 0),
          heading: Math.round(g.vector?.heading ?? 0),
          timeline: (window.touch.formationTimeline(g.id, 12)?.events ?? []),
        })) ?? [],
      },
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#startBeatTicker();
    const root = this.element;
    if (!root) return;
    // Live slider -> number readout, and mute toggle styling.
    root.querySelectorAll('input[type="range"].touch-intensity').forEach((slider) => {
      slider.addEventListener("input", () => {
        const row = slider.closest(".touch-row");
        row.querySelector(".touch-intensity-value").textContent = slider.value;
      });
      slider.addEventListener("change", () => {
        const row = slider.closest(".touch-row");
        const id = row.dataset.id;
        window.touch?.setEmitterConfig(id, { intensity: Number(slider.value) });
      });
    });
    root.querySelectorAll(".touch-mute").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".touch-row");
        window.touch?.setEmitterConfig(row.dataset.id, { muted: btn.classList.contains("active") ? false : true });
        btn.classList.toggle("active");
      });
    });
    // Global controls.
    const gi = root.querySelector('[name="globalIntensity"]');
    if (gi) gi.addEventListener("change", () => window.touch?.setGlobalIntensity(Number(gi.value)));
    const gm = root.querySelector('[name="globalMuted"]');
    if (gm) gm.addEventListener("change", () => window.touch?.setGlobalMuted(gm.checked));

    // Elevation editing (native, all emitters).
    root.querySelectorAll(".touch-elev").forEach((input) => {
      input.addEventListener("change", () => {
        const row = input.closest(".touch-row");
        window.touch?.setEmitterElevation(row.dataset.id, Number(input.value));
      });
    });

    // Levels floor ranges (only when the Levels module is active).
    root.querySelectorAll(".touch-level").forEach((input) => {
      input.addEventListener("change", () => {
        const row = input.closest(".touch-row");
        const bound = input.dataset.bound; // "bottom" | "top"
        window.touch?.setEmitterLevels(row.dataset.id, input.value === "" ? null : Number(input.value), bound);
      });
    });

    // Wall Height extents (only when the Wall Height module is active).
    root.querySelectorAll(".touch-wall-height").forEach((input) => {
      input.addEventListener("change", () => {
        const row = input.closest(".touch-row");
        const bound = input.dataset.bound; // "bottom" | "top"
        window.touch?.setEmitterWallHeight(row.dataset.id, input.value === "" ? null : Number(input.value), bound);
      });
    });

    // Emission mode: sound / light / both.
    root.querySelectorAll(".touch-mode").forEach((sel) => {
      sel.addEventListener("change", () => {
        const row = sel.closest(".touch-row");
        const mode = EMISSION_MODES.has(sel.value) ? sel.value : "both";
        window.touch?.setEmitterMode(row.dataset.id, mode);
      });
    });

    // Facing angle + cone width.
    root.querySelectorAll(".touch-angle, .touch-fov").forEach((input) => {
      input.addEventListener("change", () => {
        const row = input.closest(".touch-row");
        const patch = input.classList.contains("touch-angle")
          ? { angle: Number(input.value) }
          : { fov: Number(input.value) };
        window.touch?.setEmitterFacing(row.dataset.id, patch);
      });
    });

    // Ping rate (0 = global cadence) + feedback tone.
    root.querySelectorAll(".touch-rate").forEach((input) => {
      input.addEventListener("change", () => {
        const row = input.closest(".touch-row");
        window.touch?.setEmitterRate(row.dataset.id, Number(input.value));
      });
    });
    root.querySelectorAll(".touch-tone").forEach((sel) => {
      sel.addEventListener("change", () => {
        window.touch?.setEmitterRate(sel.closest(".touch-row").dataset.id, null, sel.value);
      });
    });

    // Waypoint name + elevation + delete.
    root.querySelectorAll(".touch-wp-name").forEach((input) => {
      input.addEventListener("change", () => {
        window.touch?.renameWaypoint(input.closest(".touch-row").dataset.id, input.value);
      });
    });
    root.querySelectorAll(".touch-wp-elev").forEach((input) => {
      input.addEventListener("change", () => {
        window.touch?.setWaypointElevation(input.closest(".touch-row").dataset.id, Number(input.value));
      });
    });

    // Pathway name + elevation + spacing.
    root.querySelectorAll(".touch-pw-name").forEach((input) => {
      input.addEventListener("change", () => {
        window.touch?.renamePathway(input.closest(".touch-row").dataset.pathwayId, input.value);
      });
    });
    root.querySelectorAll(".touch-pw-elev").forEach((input) => {
      input.addEventListener("change", () => {
        window.touch?.setPathwayElevation(input.closest(".touch-row").dataset.pathwayId, Number(input.value));
      });
    });
    root.querySelectorAll(".touch-pw-spacing").forEach((input) => {
      input.addEventListener("change", () => {
        window.touch?.setPathwaySpacing(input.closest(".touch-row").dataset.pathwayId, Number(input.value));
      });
    });
  }

  // ---------------------------------------------------------------- actions

  static async #onGoto(event, target) {
    const row = target.closest(".touch-row");
    const id = row?.dataset?.id;
    const e = id ? window.touch?.emitters?.()?.find((x) => x.id === id) : null;
    if (e && canvas.ready) {
      canvas.animatePan({ x: e.x, y: e.y, duration: 300 });
    }
  }

  static async #onBulkIntensity(event, target) {
    const form = target.closest("form") ?? this.element;
    const input = form.querySelector('[name="bulkIntensity"]');
    const raw = input?.value ?? "";
    if (String(raw).trim() === "") return; // empty input: do nothing
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    await window.touch?.bulkSetIntensity(value);
    this.render();
  }

  /** Read the bulk-verticals fieldset and call the API (apply or clear). */
  #bulkVertsFromUI(clear) {
    const root = this.element;
    const moduleName = root.querySelector('[name="bulkVertsModule"]')?.value ?? "levels";
    const kinds = [...root.querySelectorAll('input[name="bulkVertKind"]:checked')]
      .filter((box) => box.dataset.module === moduleName)
      .map((box) => box.value);
    const num = (sel) => {
      const raw = root.querySelector(sel)?.value;
      return raw === "" || raw === undefined ? null : Number(raw);
    };
    const bottom = num('[name="bulkVertsBottom"]');
    const top = num('[name="bulkVertsTop"]');
    return window.touch?.bulkSetVerticals({ module: moduleName, kinds, bottom, top, clear });
  }

  static async #onBulkVerticalsApply() {
    const count = await this.#bulkVertsFromUI(false);
    if (count) ui.notifications.info(`Touch | Applied vertical extent to ${count} object${count === 1 ? "" : "s"}.`);
  }

  static async #onBulkVerticalsClear() {
    const count = await this.#bulkVertsFromUI(true);
    if (count) ui.notifications.info(`Touch | Cleared vertical extents on ${count} object${count === 1 ? "" : "s"}.`);
  }

  static async #onMuteAll() {
    await window.touch?.bulkSetMuted(true);
    this.render();
  }

  static async #onUnmuteAll() {
    await window.touch?.bulkSetMuted(false);
    this.render();
  }

  static async #onPingAll() {
    window.touch?.pinger?.pulse({ broadcast: true });
  }

  static async #onRemoveWaypoint(event, target) {
    const row = target.closest(".touch-row");
    await window.touch?.removeWaypoint(row.dataset.id);
    this.render();
  }

  static async #onRemovePathway(event, target) {
    const row = target.closest(".touch-row");
    await window.touch?.removePathway(row.dataset.pathwayId);
    this.render();
  }

  static async #onLatticeGenerate() {
    const root = this.element;
    const num = (name, fallback) => {
      const raw = root.querySelector(`[name="${name}"]`)?.value;
      const v = Number(raw);
      return Number.isFinite(v) && String(raw).trim() !== "" ? v : fallback;
    };
    const cur = window.touch?.getLattice?.() ?? {};
    await window.touch?.generateLattice({
      cellW: Math.max(1, Math.round(num("latticeCellW", cur.cellW ?? 4))),
      cellD: Math.max(1, Math.round(num("latticeCellD", cur.cellD ?? 3))),
      storeys: Math.max(1, Math.round(num("latticeStoreys", cur.storeys ?? 2))),
      intensity: Math.max(0, Math.min(100, num("latticeIntensity", cur.intensity ?? 25))),
    });
    ui.notifications.info("Touch | Sonar lattice generated — gridlines are live pathways.");
  }

  static async #onLatticeClear() {
    const res = await window.touch?.clearLattice();
    ui.notifications.info(`Touch | Lattice cleared (${res?.removed ?? 0} lines removed).`);
  }

  static async #onWavesTest() {
    const root = this.element;
    // Persist the wave toggles, then fire a full pulse so every emitter's
    // wavefront rolls through the field at once — interference everywhere.
    const checked = (name) => Boolean(root.querySelector(`[name="${name}"]`)?.checked);
    const speed = Number(root.querySelector('[name="waveSpeed"]')?.value);
    if (Number.isFinite(speed) && speed >= 50) {
      await game.settings.set(MODULE_ID, "waveSpeed", speed);
    }
    await game.settings.set(MODULE_ID, "wavePhysics", checked("wavePhysics"));
    await game.settings.set(MODULE_ID, "waveReflections", checked("waveReflections"));
    await window.touch?.pinger?.pulse({ broadcast: true });
    ui.notifications.info("Touch | Wave test fired — watch the room view.");
  }

  static async #onMonitorsDeploy() {
    await window.touch?.setLatticeMonitors({ deploy: true });
  }

  static async #onMonitorsClear() {
    await window.touch?.setLatticeMonitors({ deploy: false });
  }

  static async #onMemoryClear() {
    await window.touch?.clearMemory();
  }

  /** Manually split a marching group into individual tracks. */
  static async #onGroupDissolve(event, target) {
    const gid = target.closest("[data-group-id]")?.dataset.groupId;
    if (gid && window.touch.dissolveGroup(gid)) {
      ui.notifications.info(game.i18n.localize("TOUCH.Groups.Dissolved"));
      this.render();
    }
  }

  /** Prompt for an identity id and stamp it on the row's document. */
  static async #onIdentityAssign(event, target) {
    const row = target.closest(".touch-row");
    const id = row?.dataset?.id;
    const e = id ? window.touch?.emitters?.()?.find((x) => x.id === id) : null;
    if (!e?.doc) return;
    const current = window.touch.identityOf(e.doc) ?? "";
    const wanted = await Dialog.prompt({
      title: game.i18n.localize("TOUCH.Identity.AssignTitle"),
      content: `<p>${game.i18n.localize("TOUCH.Identity.AssignHint")}</p>
        <input name="id" value="${current}" placeholder="trk.custom" style="width:100%">`,
      label: game.i18n.localize("TOUCH.Identity.AssignLabel"),
      callback: (html) => html.querySelector("input[name=id]")?.value.trim() || null,
      rejectClose: false,
    });
    if (wanted === null) return;
    const assigned = await window.touch.assignIdentity(e.doc, wanted || undefined);
    if (!assigned) {
      ui.notifications.error(game.i18n.localize("TOUCH.Identity.Taken"));
      return;
    }
    ui.notifications.info(game.i18n.format("TOUCH.Identity.Assigned", { id: assigned }));
    this.render();
  }

  /** Strip the persistent identity from a row's document. */
  static async #onIdentityRevoke(event, target) {
    const row = target.closest(".touch-row");
    const id = row?.dataset?.id;
    const e = id ? window.touch?.emitters?.()?.find((x) => x.id === id) : null;
    if (!e?.doc) return;
    await window.touch.revokeIdentity(e.doc);
    ui.notifications.info(game.i18n.localize("TOUCH.Identity.Revoked"));
    this.render();
  }

  /** Re-capture the snapshot of an identified object (disguise/polymorph). */
  static async #onIdentityRecapture(event, target) {
    const row = target.closest(".touch-row");
    const id = row?.dataset?.id;
    const e = id ? window.touch?.emitters?.()?.find((x) => x.id === id) : null;
    if (!e?.doc) return;
    if (!window.touch.identityOf(e.doc)) {
      ui.notifications.warn(game.i18n.localize("TOUCH.Identity.RecaptureUnidentified"));
      return;
    }
    const res = await window.touch.recaptureSignature(e.doc);
    if (res?.id) {
      ui.notifications.info(game.i18n.format("TOUCH.Identity.Recaptured", { id: res.id }));
    }
    this.render();
  }

  static async #onMemoryRetention(event, target) {
    const v = Number(target.value);
    if (Number.isFinite(v) && v >= 0) {
      await game.settings.set(MODULE_ID, "memoryRetention", v);
      ui.notifications.info(`Touch | Memory retention: ${v === 0 ? "forever" : `${v}s`}`);
    }
  }

  static async #onReset() {
    await window.touch?.resetSettings();
    this.render();
  }

  /** Quantum Portal: open (or focus) the sonar viewer. */
  static async #onOpenQuantum() {
    await window.touch?.openViewer?.();
  }

  /** The six camera faces of the hub's quantum cube (mirrors the viewer's). */
  static #quantumFaces() {
    const glyphs = { top: "✦", bottom: "✧", left: "◀", right: "▶", front: "◆", back: "◇" };
    return CAMERAS.map((c) => ({ cam: c.id, label: c.label, face: c.id, glyph: glyphs[c.id] ?? c.label[0] }));
  }

  /**
   * Heartbeat ticker: every second, refresh each row's ♥ countdown from the
   * pinger's heartbeat clock. Runs only while rendered; cleared on close.
   */
  #beatTicker = null;

  #startBeatTicker() {
    this.#stopBeatTicker();
    const step = () => {
      if (!this.rendered || !this.element) {
        this.#beatTicker = null;
        return;
      }
      const beats = window.touch?.heartbeats?.() ?? new Map();
      this.element.querySelectorAll("[data-beat-id]").forEach((el) => {
        const id = el.dataset.beatId;
        // Pathway rows collapse samples: use any sample of the line.
        let v = beats.get(id);
        if (v === undefined && id?.startsWith("pw.")) {
          for (const [k, val] of beats) {
            if (k.startsWith(`${id}#`)) { v = val; break; }
          }
        }
        const out = el.querySelector(".touch-beat-value");
        if (out) out.textContent = v === undefined ? "—" : `${v}s`;
        el.classList.toggle("touch-beat-near", v !== undefined && v <= 1);
      });
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
}
