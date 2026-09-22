/** DOM reconciliation for Touch viewer frames, trails, and wave physics. */
import { CAMERAS, TONES } from "./constants.js";
import { projectPointForRoom } from "./cameras.js";
import { getPathways } from "./pathways.js";

const STOREY_SPAN = 14;

function trackHue(id) {
  let hue = 0;
  for (const char of String(id)) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return hue;
}

function inFloorBand(filter, elevation, storeyHeight) {
  return filter === null ||
    ((elevation / storeyHeight) * storeyHeight >= filter * storeyHeight &&
      (elevation / storeyHeight) * storeyHeight < (filter + 1) * storeyHeight);
}

export function flushTrails(viewer, now) {
  const room = viewer.element?.querySelector(".touch-room-space");
  const host = room?.querySelector(".touch-track-trails");
  if (!host) return;
  const tracks = window.touch?.trackList?.() ?? [];
  const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
  const inBand = (point) => viewer.floorFilter === null || (point.storey ?? 0) === viewer.floorFilter;
  const camera = CAMERAS.find((item) => item.id === "front") ?? CAMERAS[0];
  const existing = [...host.children];
  let index = 0;
  for (const track of tracks.slice(0, 16)) {
    const points = track.points.slice(-24);
    const groupId = track.groupId ?? null;
    const hue = trackHue(groupId ?? track.id);
    const age = (now - (track.points[track.points.length - 1]?.t ?? now)) / 1000;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex];
      if (!inBand(point)) continue;
      const vars = projectPointForRoom(point.x, point.y, (point.storey ?? 0) * storeyHeight, camera, { storeyHeight });
      let dot = existing[index];
      if (!dot) {
        dot = document.createElement("div");
        host.appendChild(dot);
      }
      const recency = pointIndex / Math.max(1, points.length - 1);
      const quiet = Math.max(0, 1 - age / 600);
      dot.className = "touch-track-dot";
      dot.dataset.track = track.id;
      dot.dataset.head = pointIndex === points.length - 1 ? "1" : "0";
      dot.style.setProperty("--u", vars["--u"]);
      dot.style.setProperty("--v", vars["--v"]);
      dot.style.setProperty("--hue", String(hue));
      dot.style.setProperty("--a", ((0.12 + 0.55 * recency) * (0.25 + 0.75 * quiet)).toFixed(3));
      dot.style.setProperty("--s", (0.5 + 0.5 * recency).toFixed(3));
      dot.title = track.label ?? track.id;
      if (groupId) {
        dot.dataset.group = groupId;
        dot.title += `\n${game.i18n.localize("TOUCH.Groups.MemberHint")}`;
      }
      index++;
    }
  }
  existing.slice(index).forEach((element) => element.remove());
}

export function flushWaves(viewer) {
  const field = window.touch?.wavefield;
  if (!field || !viewer.rendered || viewer.paused) return;
  const room = viewer.element?.querySelector(".touch-room-space");
  if (!room) return;
  const settings = {
    storeyHeight: game.settings.get("touch", "storeyHeight") ?? 10,
    echoAttenuation: game.settings.get("touch", "echoAttenuation") ?? 0.5,
  };
  const now = Date.now();
  const inBand = (elevation) => inFloorBand(viewer.floorFilter, elevation, settings.storeyHeight);
  const camera = CAMERAS.find((item) => item.id === "front") ?? CAMERAS[0];

  const ringsHost = room.querySelector(".touch-wave-rings");
  if (ringsHost) {
    const existing = [...ringsHost.children];
    let index = 0;
    for (const wave of [...field.waves, ...field.echos]) {
      if (!inBand(wave.elevation ?? 0)) continue;
      const age = (now - wave.born) / 1000;
      const radius = Math.max(2, age * (game.settings.get("touch", "waveSpeed") ?? 400));
      const vars = projectPointForRoom(wave.x, wave.y, wave.elevation ?? 0, camera, settings);
      let ring = existing[index];
      if (!ring) {
        ring = document.createElement("div");
        ringsHost.appendChild(ring);
      }
      ring.className = `touch-wave-ring${wave.echo ? " touch-wave-echo" : ""}`;
      ring.style.setProperty("--u", vars["--u"]);
      ring.style.setProperty("--v", vars["--v"]);
      ring.style.setProperty("--r", `${Math.min(radius, 4000)}px`);
      ring.style.setProperty("--a", Math.max(0, Math.min(0.85, (wave.amp ?? 0.3) * 1.6)).toFixed(3));
      ring.style.setProperty("--age", age.toFixed(2));
      index++;
    }
    existing.slice(index).forEach((element) => element.remove());
  }

  const nodesHost = room.querySelector(".touch-wave-nodes");
  if (nodesHost) {
    const existing = [...nodesHost.children];
    let index = 0;
    for (const dot of field.dots.filter(() => inBand(0))) {
      const vars = projectPointForRoom(dot.x, dot.y, 0, camera, settings);
      let node = existing[index];
      if (!node) {
        node = document.createElement("div");
        nodesHost.appendChild(node);
      }
      node.className = `touch-wave-node${dot.phase === "destructive" ? " touch-wave-null" : ""}`;
      node.style.setProperty("--u", vars["--u"]);
      node.style.setProperty("--v", vars["--v"]);
      node.style.setProperty("--amp", dot.amp.toFixed(3));
      node.style.setProperty("--age", ((now - dot.born) / 1000).toFixed(2));
      node.title = game.i18n.localize(dot.phase === "destructive" ? "TOUCH.Waves.NodeDestructive" : "TOUCH.Waves.NodeConstructive");
      index++;
    }
    existing.slice(index).forEach((element) => element.remove());
  }

  const railsHost = room.querySelector(".touch-wave-rails");
  if (!railsHost) return;
  const rails = field.latticeIntensity(getPathways(canvas.scene)
    .filter((pathway) => pathway.lattice)
    .map((pathway) => ({ id: pathway.id, c: pathway.c, elevation: pathway.elevation ?? 0 })));
  const existing = [...railsHost.children];
  let index = 0;
  for (const rail of rails) {
    if (!inBand(rail.elevation)) continue;
    const start = projectPointForRoom(rail.x1, rail.y1, rail.elevation, camera, settings);
    const end = projectPointForRoom(rail.x2, rail.y2, rail.elevation, camera, settings);
    let element = existing[index];
    if (!element) {
      element = document.createElement("div");
      railsHost.appendChild(element);
    }
    element.className = "touch-wave-rail";
    element.style.setProperty("--u", start["--u"]);
    element.style.setProperty("--v", start["--v"]);
    element.style.setProperty("--u2", end["--u"]);
    element.style.setProperty("--v2", end["--v"]);
    element.style.setProperty("--glow", (rail.glow / 100).toFixed(3));
    element.style.setProperty("--bias", rail.bias.toFixed(2));
    element.dataset.key = rail.key;
    index++;
  }
  existing.slice(index).forEach((element) => element.remove());
}

function ensureFloorOption(viewer, storey) {
  const select = viewer.element?.querySelector(".touch-floor-select");
  if (!select || select.querySelector(`option[value="${storey}"]`)) return;
  const height = game.settings.get("touch", "storeyHeight") ?? 10;
  const option = document.createElement("option");
  option.value = String(storey);
  option.textContent = game.i18n.format("TOUCH.Viewer.FloorOption", {
    storey,
    from: storey * height,
    to: (storey + 1) * height,
  });
  const later = [...select.options].find((item) => item.value !== "" && Number(item.value) > storey);
  select.insertBefore(option, later ?? null);
}

function ensureFloorLine(viewer, room, storey) {
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
  ensureFloorOption(viewer, storey);
}

function syncStatus(viewer) {
  const element = viewer.element?.querySelector("[data-status]");
  if (!element) return;
  const base = viewer.paused
    ? game.i18n.localize("TOUCH.Viewer.Paused")
    : game.i18n.localize("TOUCH.Viewer.Running");
  element.textContent = viewer.floorFilter === null ? base : `${base} · F${viewer.floorFilter}`;
}

export function flushFrames(viewer) {
  viewer.reconcileBands(viewer.getBands());
  if (!viewer.rendered || viewer.paused || !viewer.element) return;
  const root = viewer.element;
  const now = Date.now();
  const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
  flushTrails(viewer, now);
  const filter = viewer.floorFilter;
  const base = filter === null ? null : filter * storeyHeight;
  const inBand = (frame) => filter === null ||
    ((frame.storey ?? 0) * storeyHeight >= base && (frame.storey ?? 0) * storeyHeight < base + storeyHeight);

  for (const camera of CAMERAS) {
    const tile = root.querySelector(`[data-camera="${camera.id}"]`);
    if (!tile) continue;
    const latest = viewer.frames.get(camera.id);
    const host = tile.querySelector(".touch-cam-blips") ?? tile;
    const existing = [...host.querySelectorAll(".touch-blip")];
    let index = 0;
    if (latest) for (const frame of latest.values()) {
      if (!inBand(frame)) continue;
      let blip = existing[index];
      if (!blip) {
        blip = document.createElement("div");
        blip.className = "touch-blip";
        host.appendChild(blip);
      }
      for (const [key, value] of Object.entries(frame.vars)) blip.style.setProperty(key, value);
      blip.style.setProperty("--age", ((now - frame.born) / 1000).toFixed(2));
      if (frame.facing) {
        blip.style.setProperty("--fang", `${frame.facing.relDeg.toFixed(1)}deg`);
        blip.style.setProperty("--ffov", `${frame.facing.fov}deg`);
      }
      blip.dataset.kind = frame.kind;
      blip.dataset.mode = frame.mode ?? "both";
      blip.dataset.omni = String((frame.facing?.fov ?? 360) >= 360);
      blip.style.animationDuration = `${TONES[frame.tone ?? "mid"]?.blink ?? 2}s`;
      blip.dataset.name = frame.name ?? "";
      blip.title = frame.name ?? "";
      if (frame.identity) {
        blip.classList.add("touch-identified");
        blip.title += `\n${game.i18n.format("TOUCH.Viewer.Identity", { id: frame.identity })}`;
      }
      if (frame.color) blip.style.color = frame.color;
      index++;
    }
    existing.slice(index).forEach((element) => element.style.setProperty("--s", "0.12"));
  }

  const room = root.querySelector(".touch-room-space");
  if (room) {
    const source = viewer.frames.get("front") ?? viewer.frames.get("top");
    const existing = [...room.querySelectorAll(".touch-room-blip")];
    let index = 0;
    if (source) for (const frame of source.values()) {
      if (!inBand(frame)) continue;
      let blip = existing[index];
      if (!blip) {
        blip = document.createElement("div");
        blip.className = "touch-room-blip";
        room.appendChild(blip);
      }
      for (const [key, value] of Object.entries(frame.vars)) blip.style.setProperty(key, value);
      blip.style.setProperty("--age", ((now - frame.born) / 1000).toFixed(2));
      blip.style.setProperty("--floor-offset", `${(frame.storey ?? 0) * STOREY_SPAN}%`);
      blip.style.setProperty("--storey-z", String(Math.round((frame.storey ?? 0) * 40)));
      blip.dataset.floor = String(Math.round(frame.storey ?? 0));
      blip.dataset.kind = frame.kind;
      blip.dataset.mode = frame.mode ?? "both";
      if (frame.trace) {
        blip.dataset.trace = "true";
        blip.dataset.traceToken = frame.traceTokenId ?? "";
        blip.dataset.track = frame.trackId ?? "";
        blip.title = `${frame.name ?? ""} — surface trace (${frame.chord ?? "?"}u chord)` +
          (frame.trackContinued ? ` · ${game.i18n.localize("TOUCH.Memory.TrackContinued")}` : "");
        if (frame.vars?.["--v2"] !== undefined) blip.style.setProperty("--v2", frame.vars["--v2"]);
      } else if (blip.dataset.trace) {
        delete blip.dataset.trace;
        delete blip.dataset.track;
      }
      blip.dataset.omni = String((frame.facing?.fov ?? 360) >= 360);
      blip.style.animationDuration = `${TONES[frame.tone ?? "mid"]?.blink ?? 2}s`;
      if (frame.facing) {
        blip.style.setProperty("--fang", `${frame.facing.relDeg.toFixed(1)}deg`);
        blip.style.setProperty("--ffov", `${frame.facing.fov}deg`);
      }
      blip.title = frame.name ? `${frame.name} — floor ${Math.round(frame.storey ?? 0)}` : "";
      if (frame.color) blip.style.color = frame.color;
      const memory = window.touch?.memoryAt?.(frame.x, frame.y, Math.round(frame.storey ?? 0));
      if (memory && memory.currentHeat > 0.05) {
        blip.style.setProperty("--mem-heat", memory.currentHeat.toFixed(2));
        blip.style.setProperty("--mem-color", window.touch.heatColor(memory.currentHeat));
        const what = game.i18n.localize(`TOUCH.Memory.Whats.${memory.lastWhat ?? "ping"}`);
        const ago = Math.round((Date.now() - memory.lastSeen) / 1000);
        blip.title += `\n${game.i18n.format("TOUCH.Memory.LastSeen", { what, label: memory.lastLabel ?? "?", n: ago })}`;
      } else blip.style.removeProperty("--mem-heat");
      ensureFloorLine(viewer, room, Math.round(frame.storey ?? 0));
      index++;
    }
    existing.slice(index).forEach((element) => element.remove());
  }
  syncStatus(viewer);
}

export { syncStatus };
