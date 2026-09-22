/** Context and DOM bindings for the Touch GM Hub. */
import { MODULE_ID, INTENSITY_MIN, INTENSITY_MAX, DEFAULTS, CAMERAS } from "./constants.js";
import { collectEmitters } from "./emitters.js";
import { getLattice } from "./lattice.js";
import {
  getEmitterElevation,
  getLevelsRange,
  getWallHeightRange,
  levelsActive,
  wallHeightActive,
} from "./elevation.js";
import { TONE_IDS } from "./constants.js";

export function getQuantumFaces() {
  const labels = { top: "TP", bottom: "BT", left: "LT", right: "RT", front: "FR", back: "BK" };
  return CAMERAS.map((camera) => ({
    cam: camera.id,
    label: camera.label,
    face: camera.id,
    glyph: labels[camera.id] ?? camera.label[0],
  }));
}

export function prepareHubContext() {
  const scene = canvas.scene;
  const emitters = collectEmitters(scene);
  const seenPathways = new Set();
  const rows = [];
  for (const emitter of emitters) {
    if (emitter.kind === "pathway") {
      if (seenPathways.has(emitter.pathwayId)) continue;
      seenPathways.add(emitter.pathwayId);
      rows.push({
        id: emitter.id,
        pathwayId: emitter.pathwayId,
        kind: emitter.kind,
        name: emitter.name,
        x: Math.round(emitter.x),
        y: Math.round(emitter.y),
        elevation: emitter.elevation,
        spacing: emitter.spacing ?? 2,
        intensity: emitter.config.intensity,
        muted: emitter.config.muted,
        mode: emitter.config.mode ?? "both",
        angle: emitter.config.angle ?? 0,
        fov: emitter.config.fov ?? 360,
        rate: emitter.config.rate ?? 0,
        tone: emitter.config.tone ?? "mid",
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
      id: emitter.id,
      kind: emitter.kind,
      name: emitter.name,
      x: Math.round(emitter.x),
      y: Math.round(emitter.y),
      intensity: emitter.config.intensity,
      muted: emitter.config.muted,
      elevation: getEmitterElevation(emitter),
      mode: emitter.config.mode ?? "both",
      angle: emitter.config.angle ?? 0,
      fov: emitter.config.fov ?? 360,
      rate: emitter.config.rate ?? 0,
      tone: emitter.config.tone ?? "mid",
      tones: TONE_IDS,
      isWaypoint: emitter.kind === "waypoint",
      isPathway: false,
      pathwayId: null,
      spacing: null,
      isMonitor: Boolean(emitter.cornerMonitor),
      levelsRange: getLevelsRange(emitter.doc),
      canLevel: levelsActive() && (emitter.kind === "token" || emitter.kind === "wall"),
      wallHeightRange: getWallHeightRange(emitter.doc),
      canWallHeight: wallHeightActive() && (emitter.kind === "wall" || emitter.kind === "light"),
      kindLabel: emitter.cornerMonitor
        ? game.i18n.localize("TOUCH.Lattice.Monitor")
        : game.i18n.localize(`TOUCH.Hub.Type.${emitter.kind.charAt(0).toUpperCase() + emitter.kind.slice(1)}`),
      identity: emitter.identity ?? null,
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
    quantumFaces: getQuantumFaces(),
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
    monitors: { count: rows.filter((row) => row.isMonitor).length },
    memory: {
      count: window.touch?.memoryMap?.().length ?? 0,
      retention: game.settings.get(MODULE_ID, "memoryRetention") ?? 3600,
      tracks: window.touch?.trackListGrouped?.().slice(0, 12).map((track) => ({
        id: track.id,
        label: track.label,
        points: track.points.length,
        cells: track.cells.length,
        assigned: Boolean(track.assigned),
        groupId: track.groupId ?? null,
      })) ?? [],
      groups: window.touch?.groups?.().slice(0, 6).map((group) => ({
        id: group.id,
        label: group.label ?? game.i18n.localize("TOUCH.Groups.Unnamed"),
        count: group.members.length,
        names: group.members.map((member) => member.label).slice(0, 4).join(", "),
        speed: Math.round(group.vector?.speed ?? 0),
        heading: Math.round(group.vector?.heading ?? 0),
        timeline: window.touch.formationTimeline(group.id, 12)?.events ?? [],
      })) ?? [],
    },
  };
}

export function bindHubEvents(root) {
  root.querySelectorAll('input[type="range"].touch-intensity').forEach((slider) => {
    slider.addEventListener("input", () => {
      const row = slider.closest(".touch-row");
      row.querySelector(".touch-intensity-value").textContent = slider.value;
    });
    slider.addEventListener("change", () => {
      const row = slider.closest(".touch-row");
      window.touch?.setEmitterConfig(row.dataset.id, { intensity: Number(slider.value) });
    });
  });
  root.querySelectorAll(".touch-mute").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".touch-row");
      window.touch?.setEmitterConfig(row.dataset.id, { muted: !button.classList.contains("active") });
      button.classList.toggle("active");
    });
  });
  root.querySelector('[name="globalIntensity"]')?.addEventListener("change", (event) => {
    window.touch?.setGlobalIntensity(Number(event.target.value));
  });
  root.querySelector('[name="globalMuted"]')?.addEventListener("change", (event) => {
    window.touch?.setGlobalMuted(event.target.checked);
  });

  root.querySelectorAll(".touch-elev").forEach((input) => input.addEventListener("change", () => {
    window.touch?.setEmitterElevation(input.closest(".touch-row").dataset.id, Number(input.value));
  }));
  root.querySelectorAll(".touch-level").forEach((input) => input.addEventListener("change", () => {
    const value = input.value === "" ? null : Number(input.value);
    window.touch?.setEmitterLevels(input.closest(".touch-row").dataset.id, value, input.dataset.bound);
  }));
  root.querySelectorAll(".touch-wall-height").forEach((input) => input.addEventListener("change", () => {
    const value = input.value === "" ? null : Number(input.value);
    window.touch?.setEmitterWallHeight(input.closest(".touch-row").dataset.id, value, input.dataset.bound);
  }));
  root.querySelectorAll(".touch-mode").forEach((select) => select.addEventListener("change", () => {
    window.touch?.setEmitterMode(select.closest(".touch-row").dataset.id, select.value);
  }));
  root.querySelectorAll(".touch-angle, .touch-fov").forEach((input) => input.addEventListener("change", () => {
    const patch = input.classList.contains("touch-angle") ? { angle: Number(input.value) } : { fov: Number(input.value) };
    window.touch?.setEmitterFacing(input.closest(".touch-row").dataset.id, patch);
  }));
  root.querySelectorAll(".touch-rate").forEach((input) => input.addEventListener("change", () => {
    window.touch?.setEmitterRate(input.closest(".touch-row").dataset.id, Number(input.value));
  }));
  root.querySelectorAll(".touch-tone").forEach((select) => select.addEventListener("change", () => {
    window.touch?.setEmitterRate(select.closest(".touch-row").dataset.id, null, select.value);
  }));
  root.querySelectorAll(".touch-wp-name").forEach((input) => input.addEventListener("change", () => {
    window.touch?.renameWaypoint(input.closest(".touch-row").dataset.id, input.value);
  }));
  root.querySelectorAll(".touch-wp-elev").forEach((input) => input.addEventListener("change", () => {
    window.touch?.setWaypointElevation(input.closest(".touch-row").dataset.id, Number(input.value));
  }));
  root.querySelectorAll(".touch-pw-name").forEach((input) => input.addEventListener("change", () => {
    window.touch?.renamePathway(input.closest(".touch-row").dataset.pathwayId, input.value);
  }));
  root.querySelectorAll(".touch-pw-elev").forEach((input) => input.addEventListener("change", () => {
    window.touch?.setPathwayElevation(input.closest(".touch-row").dataset.pathwayId, Number(input.value));
  }));
  root.querySelectorAll(".touch-pw-spacing").forEach((input) => input.addEventListener("change", () => {
    window.touch?.setPathwaySpacing(input.closest(".touch-row").dataset.pathwayId, Number(input.value));
  }));
}
