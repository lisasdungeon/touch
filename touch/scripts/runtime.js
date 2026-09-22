/** Ready-time Touch runtime: pings, APIs, persistence, and reactive hooks. */
import { MODULE_ID, SOCKET_NAME, DEFAULTS, CAMERAS, SETTINGS, FLAG_SCOPE } from "./constants.js";
import { WaveField } from "./wavefield.js";
import { NodeMemory, heatColor, captureSignature } from "./memory.js";
import { TrackRegistry } from "./tracks.js";
import { Pinger } from "./pinger.js";
import { CameraArray } from "./cameras.js";
import { collectEmitters, collectWalls, getConfig, setConfig } from "./emitters.js";
import { levelsActive, wallHeightActive, getLevelsRange, getWallHeightRange, setLevelsRange, setWallHeightRange, pingDocument } from "./elevation.js";
import { TONE_IDS } from "./constants.js";
import { updateWaypoint, removeWaypoint, getWaypoints } from "./waypoints.js";
import { updatePathway, removePathway, getPathways, traceTokenPathwayCrossing, syncJunctionWaypoints } from "./pathways.js";
import { getLattice, generateLattice, clearLattice, deployCornerMonitors, removeCornerMonitors, getCornerMonitors } from "./lattice.js";
import {
  changedPosition,
  isWaypointId,
  isPathwayId,
  pathwayBaseId,
  findDocumentByEmitterId,
  pingWaypoint,
  makeEmitter,
} from "./runtime-helpers.js";

export function registerRuntime(loadViewerClass, loadHubClass) {
  Hooks.on("ready", () => {
    const touch = (window.touch = window.touch ?? {});
    touch.cameras = new CameraArray();
    touch.pinger = new Pinger(game.socket);
    touch.wavefield = new WaveField();
    touch.memory = new NodeMemory();
    touch.tracks = new TrackRegistry(touch.memory);
    touch.memory.attachTracks(touch.tracks);
    touch.heatColor = heatColor;
    touch.viewer = null;
    touch.hub = null;

    touch.waveLoop = null;
    touch.ensureWaveLoop = () => {
      if (touch.waveLoop) return;
      const speed = game.settings.get(MODULE_ID, "waveSpeed") ?? DEFAULTS.waveSpeed;
      const attenuation = game.settings.get(MODULE_ID, "echoAttenuation") ?? DEFAULTS.echoAttenuation;
      const step = () => {
        const field = touch.wavefield;
        if (!field) return;
        field.tick(1 / 15, attenuation, speed);
        field.sampleInterference();
        field.latticeIntensity(getPathways(canvas.scene).filter((pathway) => pathway.lattice)
          .map((pathway) => ({ id: pathway.id, c: pathway.c, elevation: pathway.elevation ?? 0 })));
        if (game.settings.get(MODULE_ID, "memoryEnabled") ?? DEFAULTS.memoryEnabled) {
          const monitors = getWaypoints(canvas.scene).filter((waypoint) => waypoint.cornerMonitor);
          for (const echo of field.echos) {
            if (echo._memDone) continue;
            for (const monitor of monitors) {
              const distance = Math.hypot(echo.x - monitor.x, echo.y - monitor.y);
              const radius = ((Date.now() - echo.born) / 1000) * speed;
              if (Math.abs(distance - radius) < 60) {
                touch.memory.recordEcho(monitor.id, monitor.x, monitor.y, Math.round((monitor.elevation ?? 0) / 10), echo.seed ?? null);
                echo._memDone = true;
                break;
              }
            }
          }
        }
        touch.viewer?.flushWaves?.();
        const alive = field.waves.length + field.echos.length + field.interference.size + field.latticeHits.size;
        if (!alive) {
          touch.waveLoop = null;
          return;
        }
        touch.waveLoop = setTimeout(step, 66);
        touch.waveLoop.unref?.();
      };
      step();
    };

    touch.openViewer = async () => {
      const previous = touch.viewer;
      touch.viewer = null;
      if (previous) await previous.close?.({ force: true }).catch(() => {});
      const Viewer = await loadViewerClass();
      touch.viewer = new Viewer();
      await touch.viewer.render({ force: true });
      if (canvas.touchRings) canvas.touchRings.active = true;
    };
    touch.openHub = async () => {
      if (!game.user.isGM) return ui.notifications.error("TOUCH.Errors.GmOnly");
      const previous = touch.hub;
      touch.hub = null;
      if (previous) await previous.close?.({ force: true }).catch(() => {});
      const Hub = await loadHubClass();
      touch.hub = new Hub();
      await touch.hub.render({ force: true });
    };
    touch.closeViewer = () => {
      touch.viewer?.close?.({ force: true }).catch(() => {});
      touch.viewer = null;
      if (canvas.touchRings) canvas.touchRings.active = false;
    };

    touch.setEmitterConfig = async (id, patch) => {
      if (isPathwayId(id)) return touch.setPathwayConfig(pathwayBaseId(id), patch);
      const doc = findDocumentByEmitterId(id);
      if (!doc) return;
      await setConfig(doc, patch);
      touch.hub?.render();
    };
    touch.setEmitterElevation = async (id, elevation) => {
      const doc = findDocumentByEmitterId(id);
      if (!doc || !Number.isFinite(elevation)) return;
      const kind = id.split(".")[0];
      if (kind === "wall") await doc.setFlag(FLAG_SCOPE, "elevation", elevation);
      else await doc.update({ elevation });
      pingDocument(doc, kind);
      touch.hub?.render();
    };
    touch.setEmitterMode = async (id, mode) => {
      if (isPathwayId(id)) return touch.setPathwayConfig(pathwayBaseId(id), { mode });
      if (isWaypointId(id)) {
        const waypoint = await updateWaypoint(canvas.scene, id, { config: { mode } });
        canvas.touchWaypoints?.refreshWaypoints();
        if (waypoint) pingWaypoint(waypoint);
        touch.hub?.render();
        return;
      }
      const doc = findDocumentByEmitterId(id);
      if (doc) {
        await setConfig(doc, { mode });
        touch.hub?.render();
      }
    };
    touch.setEmitterFacing = async (id, patch) => {
      if (isPathwayId(id)) return touch.setPathwayConfig(pathwayBaseId(id), patch);
      if (isWaypointId(id)) {
        const waypoint = await updateWaypoint(canvas.scene, id, { config: patch });
        canvas.touchWaypoints?.refreshWaypoints();
        if (waypoint) pingWaypoint(waypoint);
        touch.hub?.render();
        return;
      }
      const doc = findDocumentByEmitterId(id);
      if (doc) {
        await setConfig(doc, patch);
        touch.hub?.render();
      }
    };
    touch.setEmitterRate = async (id, rate, tone) => {
      const patch = {};
      if (Number.isFinite(rate) && rate !== null) patch.rate = Math.max(0, rate);
      if (typeof tone === "string" && TONE_IDS.includes(tone)) patch.tone = tone;
      else if (tone) console.warn(`Touch | Unknown tone "${tone}" ignored.`);
      if (!Object.keys(patch).length) return;
      if (isPathwayId(id)) return touch.setPathwayConfig(pathwayBaseId(id), patch);
      if (isWaypointId(id)) {
        const waypoint = await updateWaypoint(canvas.scene, id, { config: patch });
        canvas.touchWaypoints?.refreshWaypoints();
        if (waypoint) pingWaypoint(waypoint);
        touch.hub?.render();
        return;
      }
      const doc = findDocumentByEmitterId(id);
      if (doc) {
        await setConfig(doc, patch);
        touch.hub?.render();
      }
    };
    touch.renameWaypoint = async (id, name) => { await updateWaypoint(canvas.scene, id, { name }); touch.hub?.render(); };
    touch.setWaypointElevation = async (id, elevation) => {
      if (!Number.isFinite(elevation)) return;
      const waypoint = await updateWaypoint(canvas.scene, id, { elevation });
      canvas.touchWaypoints?.refreshWaypoints();
      if (waypoint) pingWaypoint(waypoint);
      touch.hub?.render();
    };
    touch.removeWaypoint = async (id) => {
      await removeWaypoint(canvas.scene, id);
      canvas.touchWaypoints?.refreshWaypoints();
      touch.hub?.render();
    };
    touch.armWaypointDeploy = () => canvas.touchWaypoints?.setArmed(true);
    touch.disarmWaypointDeploy = () => canvas.touchWaypoints?.setArmed(false);
    touch.armPathwayDraw = () => canvas.touchPathways?.setArmed(true);
    touch.disarmPathwayDraw = () => canvas.touchPathways?.setArmed(false);

    touch.renamePathway = async (id, name) => { await updatePathway(canvas.scene, id, { name }); touch.hub?.render(); };
    touch.setPathwayElevation = async (id, elevation) => {
      if (!Number.isFinite(elevation)) return;
      const pathway = await updatePathway(canvas.scene, id, { elevation });
      if (pathway) canvas.touchPathways?.pingPathway(pathway);
      touch.hub?.render();
    };
    touch.setPathwaySpacing = async (id, spacing) => {
      if (!Number.isFinite(spacing)) return;
      const pathway = await updatePathway(canvas.scene, id, { spacing });
      if (pathway) {
        canvas.touchPathways?.refreshPathways();
        canvas.touchPathways?.pingPathway(pathway);
      }
      touch.hub?.render();
    };
    touch.setPathwayConfig = async (id, patch) => {
      const pathway = await updatePathway(canvas.scene, id, { config: patch });
      if (pathway) canvas.touchPathways?.pingPathway(pathway);
      touch.hub?.render();
    };
    touch.removePathway = async (id) => {
      await removePathway(canvas.scene, id);
      canvas.touchPathways?.refreshPathways();
      canvas.touchWaypoints?.refreshWaypoints();
      await syncJunctionWaypoints(canvas.scene);
      touch.hub?.render();
    };
    touch.generateLattice = async (patch = {}) => {
      const result = await generateLattice(canvas.scene, patch);
      canvas.touchPathways?.refreshPathways();
      canvas.touchWaypoints?.refreshWaypoints();
      touch.hub?.render();
      return result;
    };
    touch.clearLattice = async () => {
      const result = await clearLattice(canvas.scene);
      canvas.touchPathways?.refreshPathways();
      canvas.touchWaypoints?.refreshWaypoints();
      touch.hub?.render();
      return result;
    };
    touch.getLattice = () => getLattice(canvas.scene);
    touch.setLatticeMonitors = async ({ deploy = true } = {}) => {
      if (!canvas.scene) return null;
      const result = deploy ? await deployCornerMonitors(canvas.scene) : await removeCornerMonitors(canvas.scene);
      ui.notifications.info(game.i18n.format(deploy ? "TOUCH.Lattice.MonitorsDeployed" : "TOUCH.Lattice.MonitorsCleared", { n: deploy ? result.added + result.updated : result.removed }));
      canvas.touchWaypoints?.refreshWaypoints();
      touch.hub?.render();
      return result;
    };
    touch.getCornerMonitors = () => getCornerMonitors(canvas.scene);
    touch.heartbeats = () => touch.pinger?.heartbeats() ?? new Map();

    touch.memoryAt = (x, y, storey = 0) => touch.memory?.atPosition(x, y, storey) ?? null;
    touch.memoryAtMonitor = (id) => touch.memory?.atMonitor(id) ?? null;
    touch.memoryMap = () => touch.memory?.map() ?? [];
    touch.trackOf = (doc) => touch.tracks?.trackIdOf(doc) ?? null;
    touch.trackGet = (id) => touch.tracks?.get(id) ?? null;
    touch.trackList = () => touch.tracks?.list() ?? [];
    touch.trackListGrouped = () => touch.tracks?.groupedList() ?? [];
    touch.groupOf = (value) => {
      const id = typeof value === "object" ? touch.trackOf(value) : value;
      return id ? touch.tracks?.groupOfTrack(id) ?? null : null;
    };
    touch.groups = () => touch.tracks?.groupsList() ?? [];
    touch.formationTimeline = (id, perGroup = 12) => {
      const all = touch.tracks?.formationTimeline?.(perGroup) ?? [];
      return id ? all.find((group) => group.id === id) ?? null : all;
    };
    touch.dissolveGroup = (id) => touch.tracks?.dissolveGroup(id) ?? false;
    touch.captureSignature = (doc) => captureSignature(doc);
    touch.assignIdentity = (doc, id, label) => {
      if (!doc) return Promise.resolve(null);
      const result = touch.tracks.assignIdentity(doc, id ?? null, label ?? null);
      touch.hub?.render();
      return result;
    };
    touch.identityOf = (doc) => touch.tracks?.identityOf(doc) ?? null;
    touch.recaptureSignature = (doc, label) => {
      if (!doc) return Promise.resolve({ id: null, sig: null });
      const result = touch.tracks.recapture(doc, label ?? null);
      touch.hub?.render();
      return result;
    };
    touch.revokeIdentity = async (doc) => { await touch.tracks?.revokeIdentity(doc); touch.hub?.render(); };
    touch.clearMemory = async () => {
      await touch.memory?.clear();
      touch.hub?.render();
      ui.notifications.info(game.i18n.localize("TOUCH.Memory.Cleared"));
    };

    touch.setEmitterWallHeight = async (id, value, bound) => {
      const doc = findDocumentByEmitterId(id);
      if (!doc) return;
      if (!wallHeightActive()) return ui.notifications.warn("Touch | The Wall Height module is not active; wall extents are unavailable.");
      const kind = id.split(".")[0];
      if (kind !== "wall" && kind !== "light") return;
      const existing = doc.flags?.["wall-height"] ?? doc.flags?.wallHeight ?? {};
      const clear = value === null || value === "" || Number.isNaN(value);
      await setWallHeightRange(doc, clear ? null : bound === "bottom" ? value : existing.bottom ?? null, clear ? null : bound === "top" ? value : existing.top ?? null);
      pingDocument(doc, kind);
      touch.hub?.render();
    };
    touch.setEmitterLevels = async (id, value, bound) => {
      const doc = findDocumentByEmitterId(id);
      if (!doc) return;
      if (!levelsActive()) return ui.notifications.warn("Touch | The Levels module is not active; floor ranges are unavailable.");
      const kind = id.split(".")[0];
      if (kind !== "token" && kind !== "wall") return;
      const existing = doc.flags?.levels ?? {};
      const clear = value === null || value === "" || Number.isNaN(value);
      await setLevelsRange(doc, clear ? null : bound === "bottom" ? value : existing.rangeBottom ?? null, clear ? null : bound === "top" ? value : existing.rangeTop ?? null);
      pingDocument(doc, kind);
      touch.hub?.render();
    };
    touch.bulkSetIntensity = async (value) => {
      const updates = collectEmitters(canvas.scene).map((emitter) => emitter.kind === "waypoint"
        ? updateWaypoint(canvas.scene, emitter.id, { config: { intensity: value } })
        : setConfig(emitter.doc, { intensity: value }));
      await Promise.allSettled(updates);
    };
    touch.bulkSetVerticals = async ({ module: name = "levels", kinds = [], bottom = null, top = null, clear = false } = {}) => {
      const useLevels = name !== "wallHeight";
      if (!(useLevels ? levelsActive() : wallHeightActive())) {
        ui.notifications.warn(`Touch | The ${useLevels ? "Levels" : "Wall Height"} module is not active; ${useLevels ? "floor ranges" : "wall extents"} are unavailable.`);
        return 0;
      }
      kinds = kinds.filter((kind) => useLevels ? kind === "token" || kind === "wall" : kind === "wall" || kind === "light");
      if (!kinds.length) return 0;
      let count = 0;
      const jobs = collectEmitters(canvas.scene).filter((emitter) => kinds.includes(emitter.kind)).map((emitter) =>
        (useLevels ? setLevelsRange(emitter.doc, clear ? null : bottom, clear ? null : top) : setWallHeightRange(emitter.doc, clear ? null : bottom, clear ? null : top))
          .then(() => { count++; pingDocument(emitter.doc, emitter.kind); }));
      await Promise.allSettled(jobs);
      touch.hub?.render();
      return count;
    };
    touch.bulkSetMuted = async (muted) => {
      const updates = collectEmitters(canvas.scene).map((emitter) => emitter.kind === "waypoint"
        ? updateWaypoint(canvas.scene, emitter.id, { config: { muted } })
        : setConfig(emitter.doc, { muted }));
      await Promise.allSettled(updates);
    };
    touch.setGlobalIntensity = (value) => game.settings.set(MODULE_ID, "globalIntensity", value);
    touch.setGlobalMuted = (value) => game.settings.set(MODULE_ID, "globalMuted", value);
    touch.resetSettings = async () => {
      const defaults = {
        [SETTINGS.PING_INTERVAL]: DEFAULTS.pingInterval,
        [SETTINGS.PING_DURATION]: DEFAULTS.pingDuration,
        [SETTINGS.MAX_RINGS]: DEFAULTS.maxRings,
        [SETTINGS.DB_PER_INTENSITY]: DEFAULTS.dbPerIntensity,
        [SETTINGS.MAX_LISTENERS]: DEFAULTS.maxListeners,
        [SETTINGS.ECHO_ATTENUATION]: DEFAULTS.echoAttenuation,
        [SETTINGS.SHOW_RING_SPRITES]: DEFAULTS.showRingSprites,
        [SETTINGS.VIEWER_FPS]: DEFAULTS.viewerFps,
        [SETTINGS.CAMS]: Object.fromEntries(CAMERAS.map((camera) => [camera.id, { enabled: true }])),
      };
      for (const [key, value] of Object.entries(defaults)) await game.settings.set(MODULE_ID, key, value);
    };
    touch.emitters = () => collectEmitters(canvas.scene);

    const emitPathwayTraces = (doc) => {
      let crossed = false;
      for (const pathway of getPathways(canvas.scene)) {
        const traces = traceTokenPathwayCrossing(pathway, doc);
        if (!traces.length) continue;
        crossed = true;
        const assigned = touch.tracks.assign(doc, doc.x, doc.y, Math.round((doc.elevation ?? 0) / 10), doc.name ?? null);
        touch.lastTrackEvent = { ...assigned };
        for (const trace of traces) {
          trace.trackId = assigned.id;
          trace.trackContinued = assigned.continued;
        }
        touch.pinger?.emitMany(traces);
      }
      if (crossed) touch.hub?.render();
    };
    Hooks.on("createToken", (doc) => { touch.pinger?.emitOne(makeEmitter(doc, "token")); emitPathwayTraces(doc); });
    Hooks.on("updateToken", (doc, change) => {
      if (doc._touchStamping || !changedPosition(change)) return;
      touch.pinger?.emitOne(makeEmitter(doc, "token"));
      emitPathwayTraces(doc);
    });
    Hooks.on("createAmbientLight", (doc) => touch.pinger?.emitOne(makeEmitter(doc, "light")));
    Hooks.on("createAmbientSound", (doc) => touch.pinger?.emitOne(makeEmitter(doc, "sound")));
    const syncWalls = () => { if (canvas.scene) touch.wavefield?.setWalls(canvas.scene.id, collectWalls(canvas.scene)); };
    Hooks.on("createWall", syncWalls);
    Hooks.on("updateWall", syncWalls);
    Hooks.on("deleteWall", syncWalls);
    console.debug("Touch | ready");
  });
}
