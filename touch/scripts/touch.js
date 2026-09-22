/**
 * Touch — main module bootstrap.
 * Registers settings, layers, socket handlers, hooks, and wires the app up.
 */
import { MODULE_ID, SOCKET_NAME, SOCKET_MESSAGES, DEFAULTS, CAMERAS, SETTINGS, FLAG_SCOPE } from "./constants.js";
import { WaveField } from "./wavefield.js";
import { NodeMemory, TrackRegistry, heatColor, captureSignature } from "./memory.js";
import { RingLayer } from "./rings.js";
import { Pinger } from "./pinger.js";
import { CameraArray } from "./cameras.js";
import { SonarViewer } from "./viewer.js";
import { SonarHub } from "./hub.js";
import { collectEmitters, collectWalls, getConfig, setConfig } from "./emitters.js";
import { registerHelpers } from "./helpers.js";
import { levelsActive, wallHeightActive, getLevelsRange, getWallHeightRange, setLevelsRange, setWallHeightRange, pingDocument } from "./elevation.js";
import { TONE_IDS } from "./constants.js";
import { deployWaypoint, updateWaypoint, removeWaypoint, getWaypoints } from "./waypoints.js";
import { WaypointLayer } from "./waypointLayer.js";
import { PathwayLayer } from "./pathwayLayer.js";
import { updatePathway, removePathway, getPathways, traceTokenPathwayCrossing, syncJunctionWaypoints } from "./pathways.js";
import { getLattice, generateLattice, clearLattice, deployCornerMonitors, removeCornerMonitors, getCornerMonitors } from "./lattice.js";

Hooks.once("init", () => {
  console.debug("Touch | init");
  registerHelpers();

  game.touch = {
    viewer: null,
    hub: null,
    pinger: null,
    cameras: null,
  };

  // ------------------------------------------------------------- settings
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);

  register(SETTINGS.PING_INTERVAL, {
    name: "TOUCH.Settings.PingIntervalName",
    hint: "TOUCH.Settings.PingIntervalHint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.pingInterval,
  });
  register(SETTINGS.PING_DURATION, {
    name: "TOUCH.Settings.PingDurationName",
    hint: "TOUCH.Settings.PingDurationHint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.pingDuration,
  });
  register(SETTINGS.MAX_RINGS, {
    name: "TOUCH.Settings.MaxRingsName",
    hint: "TOUCH.Settings.MaxRingsHint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.maxRings,
  });
  register(SETTINGS.DB_PER_INTENSITY, {
    name: "TOUCH.Settings.DbPerIntensityName",
    hint: "TOUCH.Settings.DbPerIntensityHint",
    scope: "world",
    config: false,
    type: Number,
    default: DEFAULTS.dbPerIntensity,
  });
  register(SETTINGS.MAX_LISTENERS, {
    name: "TOUCH.Settings.MaxListenersName",
    hint: "TOUCH.Settings.MaxListenersHint",
    scope: "world",
    config: false,
    type: Number,
    default: DEFAULTS.maxListeners,
  });
  register(SETTINGS.ECHO_ATTENUATION, {
    name: "TOUCH.Settings.EchoAttenuationName",
    hint: "TOUCH.Settings.EchoAttenuationHint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.echoAttenuation,
  });
  register(SETTINGS.SHOW_RING_SPRITES, {
    name: "TOUCH.Settings.ShowRingSpritesName",
    hint: "TOUCH.Settings.ShowRingSpritesHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULTS.showRingSprites,
  });
  register(SETTINGS.WAVE_ENABLED, {
    name: "TOUCH.Settings.WaveEnabledName",
    hint: "TOUCH.Settings.WaveEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULTS.wavePhysics,
  });
  register(SETTINGS.WAVE_REFLECTIONS, {
    name: "TOUCH.Settings.WaveReflectionsName",
    hint: "TOUCH.Settings.WaveReflectionsHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULTS.waveReflections,
  });
  register(SETTINGS.WAVE_SPEED, {
    name: "TOUCH.Settings.WaveSpeedName",
    hint: "TOUCH.Settings.WaveSpeedHint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.waveSpeed,
  });
  register(SETTINGS.MEMORY_ENABLED, {
    name: "TOUCH.Settings.MemoryEnabledName",
    hint: "TOUCH.Settings.MemoryEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULTS.memoryEnabled,
  });
  register(SETTINGS.MEMORY_RETENTION, {
    name: "TOUCH.Settings.MemoryRetentionName",
    hint: "TOUCH.Settings.MemoryRetentionHint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.memoryRetention,
  });
  register(SETTINGS.TRACK_MATCH_TOLERANCE, {
    name: "TOUCH.Settings.TrackToleranceName",
    hint: "TOUCH.Settings.TrackToleranceHint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 0.9, step: 0.05 },
    default: DEFAULTS.trackMatchTolerance,
  });
  register(SETTINGS.VIEWER_FPS, {
    name: "TOUCH.Settings.ViewerFpsName",
    hint: "TOUCH.Settings.ViewerFpsHint",
    scope: "client",
    config: true,
    type: Number,
    default: DEFAULTS.viewerFps,
  });

  // Per-camera configuration { id: { enabled, name, angle, elev, tilt, mode } }.
  register(SETTINGS.CAMS, {
    scope: "world",
    config: false,
    type: Object,
    default: Object.fromEntries(CAMERAS.map((c) => [c.id, { enabled: true }])),
  });

  // Grid units of height per floor storey (Levels integration).
  register(SETTINGS.STOREY_HEIGHT, {
    name: "TOUCH.Settings.StoreyHeightName",
    hint: "TOUCH.Settings.StoreyHeightHint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.storeyHeight,
  });

  // Hub convenience values.
  register("globalIntensity", { scope: "world", config: false, type: Number, default: 60 });
  register("globalMuted", { scope: "world", config: false, type: Boolean, default: false });

  // ----------------------------------------------------------- scene controls
  Hooks.on("getSceneControlButtons", (controls) => {
    const token = controls.find((c) => c.name === "token");
    if (token) {
      token.tools.push({
        name: "touch-viewer",
        title: "TOUCH.Controls.Viewer",
        icon: "fa-solid fa-tower-broadcast",
        button: true,
        onClick: () => window.touch?.openViewer(),
      });
  token.tools.push({
    name: "touch-waypoint",
    title: "TOUCH.Controls.Waypoint",
    icon: "fa-solid fa-location-dot",
    button: true,
    onClick: () => window.touch?.armWaypointDeploy(),
  });
  token.tools.push({
    name: "touch-pathway",
    title: "TOUCH.Controls.Pathway",
    icon: "fa-solid fa-route",
    button: true,
    onClick: () => window.touch?.armPathwayDraw(),
  });
      if (game.user.isGM) {
        token.tools.push({
          name: "touch-hub",
          title: "TOUCH.Controls.Hub",
          icon: "fa-solid fa-sliders",
          button: true,
          onClick: () => window.touch?.openHub(),
        });
      }
    }
  });

  // -------------------------------------------------------------- socket
  game.socket.register(SOCKET_NAME, (payload) => {
    if (!payload?.type) return;
    switch (payload.type) {
      case SOCKET_MESSAGES.PINGS:
        window.touch?.pinger?.receive(payload);
        break;
      case SOCKET_MESSAGES.SYNC:
        // Future: full state sync from GM.
        break;
      case SOCKET_MESSAGES.REQUEST_SYNC:
        if (game.user.isGM) window.touch?.syncTo?.(payload.userId);
        break;
    }
  });
});

Hooks.once("canvasInit", () => {
  // Register the ring layer for visual pings and the waypoint marker layer.
  if (CONFIG.Canvas.layers?.touchRings === undefined) {
    CONFIG.Canvas.layers.touchRings = {
      layerClass: RingLayer,
      group: "effects",
    };
  }
  if (CONFIG.Canvas.layers?.touchWaypoints === undefined) {
    CONFIG.Canvas.layers.touchWaypoints = {
      layerClass: WaypointLayer,
      group: "effects",
    };
  }
  if (CONFIG.Canvas.layers?.touchPathways === undefined) {
    CONFIG.Canvas.layers.touchPathways = {
      layerClass: PathwayLayer,
      group: "effects",
    };
  }
});

Hooks.on("canvasReady", () => {
  // Start the pinger on the GM client; keep the viewer title fresh.
  if (game.user.isGM) window.touch?.pinger?.start();
  if (window.touch?.viewer?.rendered) window.touch.viewer.render();

  // Wave physics: refresh the reflection surface cache (walls move between
  // scenes; also synced on wall create/update/delete hooks below).
  window.touch?.wavefield?.setWalls(canvas.scene?.id, collectWalls(canvas.scene));
  window.touch?.wavefield?.clear();
  // Node memory: load persisted per-coordinate history for this scene.
  window.touch?.memory?.load(canvas.scene);
  window.touch?.tracks?.load(canvas.scene);
  // Click-to-deploy / click-click-draw while a Touch placement tool is armed.
  // The stage-level handler is registered once per stage (guarded by a tag on
  // the stage itself, since canvasReady fires on every scene load) and is
  // arm-gated so it no-ops outside deploy/draw mode.
  if (canvas.stage && !canvas.stage._touchDeployHooked) {
    canvas.stage.on("pointerdown", (event) => {
      const pos = event.getWorldPosition?.(event.target) ?? event.global;
      const world = canvas.worldTransform ?
        canvas.worldTransform.applyInverse({ x: pos.x, y: pos.y }) :
        pos;
      const wpLayer = canvas.touchWaypoints;
      if (wpLayer?.armed) {
        wpLayer.deployAt(world);
        return;
      }
      const pwLayer = canvas.touchPathways;
      if (pwLayer?.armed) pwLayer.clickAt(world);
    });
    canvas.stage._touchDeployHooked = true;
  }
});

Hooks.on("canvasTearDown", () => {
  window.touch.pinger?.stop();
});

// ------------------------------------------------------------ lifecycle wiring

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

  // ------------------------------------------------------ wave physics loop
  // Lazily started when a ping enters the wavefield; advances the simulation
  // ~15 Hz while waves are alive and drives the viewer's wave layer. Self-
  // stops when the field drains so an idle Foundry session runs no timers.
  // unref'd (when available) so headless/test environments exit cleanly.
  touch.waveLoop = null;
  touch.ensureWaveLoop = () => {
    if (touch.waveLoop) return;
    const speed = game.settings.get(MODULE_ID, "waveSpeed") ?? DEFAULTS.waveSpeed;
    const attenuation = game.settings.get(MODULE_ID, "echoAttenuation") ?? DEFAULTS.echoAttenuation;
    const dt = 1 / 15;
    let last = Date.now();
    const step = () => {
      const wf = touch.wavefield;
      if (!wf) return;
      const now = Date.now();
      wf.tick(dt, attenuation, speed);
      wf.sampleInterference();
      // Lattice rails glow where fronts cross them.
      const lines = getPathways(canvas.scene)
        .filter((p) => p.lattice)
        .map((p) => ({ id: p.id, c: p.c, elevation: p.elevation ?? 0 }));
      wf.latticeIntensity(lines);
      // Memory: echo returns reaching corner monitors are remembered per node.
      if (game.settings.get(MODULE_ID, "memoryEnabled") ?? DEFAULTS.memoryEnabled) {
        const mem = touch.memory;
        const monitors = getWaypoints(canvas.scene).filter((w) => w.cornerMonitor);
        if (monitors.length) {
          const RAD = 60; // echo front passing within this range "rings" the monitor
          for (const echo of wf.echos) {
            if (echo._memDone) continue;
            for (const m of monitors) {
              const d = Math.hypot(echo.x - m.x, echo.y - m.y);
              const r = ((Date.now() - echo.born) / 1000) * speed;
              if (Math.abs(d - r) < RAD) {
                mem?.recordEcho(m.id, m.x, m.y, Math.round((m.elevation ?? 0) / 10), echo.seed ?? null);
                echo._memDone = true;
                break;
              }
            }
          }
        }
      }
      const alive = wf.waves.length + wf.echos.length + wf.interference.size + wf.latticeHits.size;
      touch.viewer?.flushWaves?.();
      if (alive === 0) {
        touch.waveLoop = null;
        return;
      }
      last = now;
      touch.waveLoop = setTimeout(step, 66);
      touch.waveLoop.unref?.();
    };
    step();
  };

  touch.openViewer = async () => {
    touch.viewer?.close?.({ force: true }).catch(() => {});
    touch.viewer = new SonarViewer();
    await touch.viewer.render({ force: true });
    if (canvas.touchRings) canvas.touchRings.active = true;
  };

  touch.openHub = async () => {
    if (!game.user.isGM) return ui.notifications.error("TOUCH.Errors.GmOnly");
    touch.hub?.close?.({ force: true }).catch(() => {});
    touch.hub = new SonarHub();
    await touch.hub.render({ force: true });
  };

  touch.closeViewer = () => {
    touch.viewer?.close?.({ force: true }).catch(() => {});
    touch.viewer = null;
    if (canvas.touchRings) canvas.touchRings.active = false;
  };

  /** Set per-object sonar config. Accepts "token.xxx" / "light.xxx" ids. */
  touch.setEmitterConfig = async (id, patch) => {
    if (isPathwayId(id)) return touch.setPathwayConfig(pathwayBaseId(id), patch);
    const doc = findDocumentByEmitterId(id);
    if (!doc) return;
    await setConfig(doc, patch);
    touch.hub?.render();
  };

  /**
   * Set an emitter's elevation. Tokens, lights and sounds use their native
   * elevation field; walls get a touch flag. Fires a one-off ping on change.
   */
  touch.setEmitterElevation = async (id, elevation) => {
    const doc = findDocumentByEmitterId(id);
    if (!doc || !Number.isFinite(elevation)) return;
    const kind = id.split(".")[0];
    if (kind === "wall") {
      await doc.setFlag(FLAG_SCOPE, "elevation", elevation);
    } else {
      await doc.update({ elevation });
    }
    pingDocument(doc, kind);
    touch.hub?.render();
  };

  /** Set emission mode: "sound" | "light" | "both". Works for waypoints too. */
  touch.setEmitterMode = async (id, mode) => {
    if (isPathwayId(id)) return touch.setPathwayConfig(pathwayBaseId(id), { mode });
    if (isWaypointId(id)) {
      const wp = await updateWaypoint(canvas.scene, id, { config: { mode } });
      canvas.touchWaypoints?.refreshWaypoints();
      if (wp) pingWaypoint(wp);
      touch.hub?.render();
      return;
    }
    const doc = findDocumentByEmitterId(id);
    if (!doc) return;
    await setConfig(doc, { mode });
    touch.hub?.render();
  };

  /** Set facing angle and/or cone width (fov). Works for waypoints too. */
  touch.setEmitterFacing = async (id, patch) => {
    if (isPathwayId(id)) return touch.setPathwayConfig(pathwayBaseId(id), patch);
    if (isWaypointId(id)) {
      const wp = await updateWaypoint(canvas.scene, id, { config: patch });
      canvas.touchWaypoints?.refreshWaypoints();
      if (wp) pingWaypoint(wp);
      touch.hub?.render();
      return;
    }
    const doc = findDocumentByEmitterId(id);
    if (!doc) return;
    await setConfig(doc, patch);
    touch.hub?.render();
  };

  /**
   * Set an emitter's ping cadence and/or feedback tone.
   * rate 0 = follow the global interval; rate > 0 = seconds between pings.
   * tone: "low" | "mid" | "high" — distinct return signature per emitter.
   */
  touch.setEmitterRate = async (id, rate, tone) => {
    const patch = {};
    if (Number.isFinite(rate) && rate !== null) patch.rate = Math.max(0, rate);
    if (typeof tone === "string" && TONE_IDS.includes(tone)) patch.tone = tone;
    else if (tone) console.warn(`Touch | Unknown tone "${tone}" ignored.`);
    if (!Object.keys(patch).length) return;
    if (isPathwayId(id)) return touch.setPathwayConfig(pathwayBaseId(id), patch);
    if (isWaypointId(id)) {
      const wp = await updateWaypoint(canvas.scene, id, { config: patch });
      canvas.touchWaypoints?.refreshWaypoints();
      if (wp) pingWaypoint(wp);
      touch.hub?.render();
      return;
    }
    const doc = findDocumentByEmitterId(id);
    if (!doc) return;
    await setConfig(doc, patch);
    touch.hub?.render();
  };

  /** Rename a waypoint. */
  touch.renameWaypoint = async (id, name) => {
    await updateWaypoint(canvas.scene, id, { name });
    touch.hub?.render();
  };

  /** Set a waypoint's height (its own elevation field). */
  touch.setWaypointElevation = async (id, elevation) => {
    if (!Number.isFinite(elevation)) return;
    const wp = await updateWaypoint(canvas.scene, id, { elevation });
    canvas.touchWaypoints?.refreshWaypoints();
    if (wp) pingWaypoint(wp);
    touch.hub?.render();
  };

  /** Delete a waypoint. */
  touch.removeWaypoint = async (id) => {
    await removeWaypoint(canvas.scene, id);
    canvas.touchWaypoints?.refreshWaypoints();
    touch.hub?.render();
  };

  /** Arm the waypoint deploy tool: next scene click deploys. */
  touch.armWaypointDeploy = () => canvas.touchWaypoints?.setArmed(true);
  touch.disarmWaypointDeploy = () => canvas.touchWaypoints?.setArmed(false);

  /** Arm the pathway draw tool: next two scene clicks create a pathway. */
  touch.armPathwayDraw = () => canvas.touchPathways?.setArmed(true);
  touch.disarmPathwayDraw = () => canvas.touchPathways?.setArmed(false);

  /** Pathway management (rename, geometry, config, remove). */
  touch.renamePathway = async (id, name) => {
    await updatePathway(canvas.scene, id, { name });
    touch.hub?.render();
  };

  touch.setPathwayElevation = async (id, elevation) => {
    if (!Number.isFinite(elevation)) return;
    const pw = await updatePathway(canvas.scene, id, { elevation });
    if (pw) canvas.touchPathways?.pingPathway(pw);
    touch.hub?.render();
  };

  touch.setPathwaySpacing = async (id, spacing) => {
    if (!Number.isFinite(spacing)) return;
    const pw = await updatePathway(canvas.scene, id, { spacing });
    if (pw) {
      canvas.touchPathways?.refreshPathways();
      canvas.touchPathways?.pingPathway(pw);
    }
    touch.hub?.render();
  };

  touch.setPathwayConfig = async (id, patch) => {
    const pw = await updatePathway(canvas.scene, id, { config: patch });
    if (pw) canvas.touchPathways?.pingPathway(pw);
    touch.hub?.render();
  };

  touch.removePathway = async (id) => {
    await removePathway(canvas.scene, id);
    canvas.touchPathways?.refreshPathways();
    canvas.touchWaypoints?.refreshWaypoints();
    await syncJunctionWaypoints(canvas.scene);
    touch.hub?.render();
  };

  /**
   * 3D sonar lattice: extend the scene grid into width × depth × height.
   * Every gridline becomes a pathway; every same-storey crossing becomes a
   * junction waypoint node. Pass a patch (cellW, cellD, storeys, intensity,
   * mode, tone) or no args to regenerate with current settings.
   */
  touch.generateLattice = async (patch = {}) => {
    const res = await generateLattice(canvas.scene, patch);
    canvas.touchPathways?.refreshPathways();
    canvas.touchWaypoints?.refreshWaypoints();
    touch.hub?.render();
    return res;
  };

  /** Remove the lattice (lattice-tagged lines + their junction nodes only). */
  touch.clearLattice = async () => {
    const res = await clearLattice(canvas.scene);
    canvas.touchPathways?.refreshPathways();
    canvas.touchWaypoints?.refreshWaypoints();
    touch.hub?.render();
    return res;
  };

  touch.getLattice = () => getLattice(canvas.scene);

  /**
   * Corner heartbeat monitors: deploy waypoint emitters on every plan-grid
   * corner of the lattice (per storey). Each carries a live heartbeat —
   * countdown shown in the hub, pulse rendered in the viewer.
   */
  touch.setLatticeMonitors = async ({ deploy = true } = {}) => {
    if (!canvas.scene) return null;
    let res;
    if (deploy) {
      res = await deployCornerMonitors(canvas.scene);
      ui.notifications.info(
        game.i18n.format("TOUCH.Lattice.MonitorsDeployed", { n: res.added + res.updated })
      );
    } else {
      res = await removeCornerMonitors(canvas.scene);
      ui.notifications.info(
        game.i18n.format("TOUCH.Lattice.MonitorsCleared", { n: res.removed })
      );
    }
    canvas.touchWaypoints?.refreshWaypoints();
    touch.hub?.render();
    return res;
  };

  /** Corner monitors with heartbeat status (hub + viewer consumers). */
  touch.getCornerMonitors = () => getCornerMonitors(canvas.scene);
  /** Per-emitter seconds-to-next-ping map (pinger heartbeat clock). */
  touch.heartbeats = () => touch.pinger?.heartbeats() ?? new Map();

  /** Persistent node memory API. */
  touch.memoryAt = (x, y, storey = 0) => touch.memory?.atPosition(x, y, storey) ?? null;
  touch.memoryAtMonitor = (monitorId) => touch.memory?.atMonitor(monitorId) ?? null;
  touch.memoryMap = () => touch.memory?.map() ?? [];
  /** Track API: the continuing event chain stamped on crossing objects. */
  touch.trackOf = (doc) => touch.tracks?.trackIdOf(doc) ?? null;
  touch.trackGet = (id) => touch.tracks?.get(id) ?? null;
  touch.trackList = () => touch.tracks?.list() ?? [];
  /** Tracks with their marching-group association (shared contacts). */
  touch.trackListGrouped = () => touch.tracks?.groupedList() ?? [];
  /** The group id a track currently marches with, if any. */
  touch.groupOf = (docOrTrackId) => {
    const tid = typeof docOrTrackId === "object" ? touch.trackOf(docOrTrackId) : docOrTrackId;
    return tid ? touch.tracks?.groupOfTrack(tid) ?? null : null;
  };
  /** All live marching groups (freshest first). */
  touch.groups = () => touch.tracks?.groupsList() ?? [];
  /** Formation timelines: join/leave ledgers per live marching group. */
  touch.formationTimeline = (groupId, perGroup = 12) => {
    const all = touch.tracks?.formationTimeline?.(perGroup) ?? [];
    return groupId ? all.find((g) => g.id === groupId) ?? null : all;
  };
  /** Manually dissolve a group; members keep their own tracks. */
  touch.dissolveGroup = (groupId) => touch.tracks?.dissolveGroup(groupId) ?? false;
  /** Capture the sonar snapshot (identity image) of an object. */
  touch.captureSignature = (doc) => captureSignature(doc);
  /**
   * Assign a persistent identity id to an object. The id is written to the
   * document, registered in the track registry, and every zone the object
   * crosses thereafter continues that same id. Pass a custom id string or
   * let Touch forge one; a taken id (owned by another object) is rejected.
   * @returns {Promise<string|null>}
   */
  touch.assignIdentity = (doc, id, label) => {
    if (!doc) return Promise.resolve(null);
    const p = touch.tracks.assignIdentity(doc, id ?? null, label ?? null);
    touch.hub?.render();
    return p;
  };
  /** The persistent identity id of an object, if any. */
  touch.identityOf = (doc) => touch.tracks?.identityOf(doc) ?? null;
  /**
   * Re-capture an object's snapshot against its track: use after a disguise,
   * polymorph, or actor swap so the track continues under the new image.
   * @returns {Promise<{id: string|null, sig: object|null}>}
   */
  touch.recaptureSignature = (doc, label) => {
    if (!doc) return Promise.resolve({ id: null, sig: null });
    const p = touch.tracks.recapture(doc, label ?? null);
    touch.hub?.render();
    return p;
  };
  /** Remove an object's persistent identity (flags + assigned track record). */
  touch.revokeIdentity = async (doc) => {
    await touch.tracks?.revokeIdentity(doc);
    touch.hub?.render();
  };
  touch.clearMemory = async () => {
    await touch.memory?.clear();
    touch.hub?.render();
    ui.notifications.info(game.i18n.localize("TOUCH.Memory.Cleared"));
  };

  /**
   * Set the Wall Height extent (bottom/top) for a wall or light.
   * Pass null for a bound to make it infinite; both null clears the override.
   * No-op without the Wall Height module.
   */
  touch.setEmitterWallHeight = async (id, value, bound) => {
    const doc = findDocumentByEmitterId(id);
    if (!doc) return;
    if (!wallHeightActive()) {
      ui.notifications.warn("Touch | The Wall Height module is not active; wall extents are unavailable.");
      return;
    }
    const kind = id.split(".")[0];
    if (kind !== "wall" && kind !== "light") return;
    const existing = doc.flags?.["wall-height"] ?? doc.flags?.wallHeight ?? {};
    const clear = value === null || value === "" || Number.isNaN(value);
    const bottom = clear ? null : (bound === "bottom" ? value : (existing.bottom ?? null));
    const top = clear ? null : (bound === "top" ? value : (existing.top ?? null));
    await setWallHeightRange(doc, bottom, top);
    pingDocument(doc, kind);
    touch.hub?.render();
  };

  /**
   * Set the Levels floor range (rangeBottom/rangeTop) for a token or wall.
   * Pass null for both bounds to clear the override. No-op without Levels.
   */
  touch.setEmitterLevels = async (id, value, bound) => {
    const doc = findDocumentByEmitterId(id);
    if (!doc) return;
    if (!levelsActive()) {
      ui.notifications.warn("Touch | The Levels module is not active; floor ranges are unavailable.");
      return;
    }
    const [kind, docId] = [id.split(".")[0], id.split(".")[1]];
    if (kind !== "token" && kind !== "wall") return;
    const existing = doc.flags?.levels ?? {};
    const clear = value === null || value === "" || Number.isNaN(value);
    const bottom = clear ? null : (bound === "bottom" ? value : (existing.rangeBottom ?? null));
    const top = clear ? null : (bound === "top" ? value : (existing.rangeTop ?? null));
    await setLevelsRange(doc, bottom, top);
    pingDocument(doc, kind);
    touch.hub?.render();
  };

  /** Bulk set intensity on every echogenic object (waypoints included). */
  touch.bulkSetIntensity = async (value) => {
    const scene = canvas.scene;
    const updates = [];
    for (const e of collectEmitters(scene)) {
      if (e.kind === "waypoint") {
        updates.push(updateWaypoint(scene, e.id, { config: { intensity: value } }));
      } else {
        updates.push(setConfig(e.doc, { intensity: value }));
      }
    }
    await Promise.allSettled(updates);
  };

  /**
   * Bulk verticals: apply one Levels floor range ("levels") or Wall Height
   * extent ("wallHeight") to every emitter of the selected kinds. null bounds
   * mean one-sided; pass both null with clear=true to remove the override.
   * Returns the number of documents updated. Each target pings so its band
   * and blip re-seat in the viewer immediately.
   */
  touch.bulkSetVerticals = async ({ module: moduleName = "levels", kinds = [], bottom = null, top = null, clear = false } = {}) => {
    const useLevels = moduleName !== "wallHeight";
    const active = useLevels ? levelsActive() : wallHeightActive();
    if (!active) {
      ui.notifications.warn(
        `Touch | The ${useLevels ? "Levels" : "Wall Height"} module is not active; ${useLevels ? "floor ranges" : "wall extents"} are unavailable.`
      );
      return 0;
    }
    kinds = kinds.filter((k) =>
      useLevels ? k === "token" || k === "wall" : k === "wall" || k === "light"
    );
    if (!kinds.length) return 0;
    const scene = canvas.scene;
    const b = clear ? null : bottom;
    const t = clear ? null : top;
    let count = 0;
    const jobs = [];
    for (const e of collectEmitters(scene)) {
      if (!kinds.includes(e.kind)) continue;
      jobs.push(
        (useLevels ? setLevelsRange(e.doc, b, t) : setWallHeightRange(e.doc, b, t)).then(() => {
          count++;
          pingDocument(e.doc, e.kind);
        })
      );
    }
    await Promise.allSettled(jobs);
    touch.hub?.render();
    return count;
  };

  touch.bulkSetMuted = async (muted) => {
    const updates = [];
    for (const e of collectEmitters(canvas.scene)) {
      if (e.kind === "waypoint") {
        updates.push(updateWaypoint(canvas.scene, e.id, { config: { muted } }));
      } else {
        updates.push(setConfig(e.doc, { muted }));
      }
    }
    await Promise.allSettled(updates);
  };

  touch.setGlobalIntensity = async (v) => game.settings.set(MODULE_ID, "globalIntensity", v);
  touch.setGlobalMuted = async (v) => game.settings.set(MODULE_ID, "globalMuted", v);

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
      [SETTINGS.CAMS]: Object.fromEntries(CAMERAS.map((c) => [c.id, { enabled: true }])),
    };
    for (const [key, value] of Object.entries(defaults)) {
      await game.settings.set(MODULE_ID, key, value);
    }
  };

  /** Emitter lookup for pan-to-object in the hub. */
  touch.emitters = () => collectEmitters(canvas.scene);

  // Surface-trace pings: when a token's footprint crosses a pathway, emit
  // hollow profile pings along the exact chord of line passing through it.
  // The token is stamped with a persistent track id on its first crossing;
  // every later crossing links into the same continuing track.
  function emitPathwayTraces(doc) {
    let crossed = false;
    for (const pw of getPathways(canvas.scene)) {
      const traces = traceTokenPathwayCrossing(pw, doc);
      if (traces.length) {
        crossed = true;
        const assigned = touch.tracks.assign(doc, doc.x, doc.y, Math.round((doc.elevation ?? 0) / 10), doc.name ?? null);
        touch.lastTrackEvent = { ...assigned };
        for (const t of traces) {
          t.trackId = assigned.id;
          t.trackContinued = assigned.continued;
        }
        touch.pinger?.emitMany(traces);
      }
    }
    if (crossed) touch.hub?.render();
  }

  // Hooks for reactive one-off pings.
  Hooks.on("createToken", (doc) => {
    touch.pinger?.emitOne(makeEmitter(doc, "token"));
    emitPathwayTraces(doc);
  });
  Hooks.on("updateToken", (doc, change) => {
    // A track-flag stamp fires a flags-only update: never re-ping on it.
    if (doc._touchStamping) return;
    if (changedPosition(change)) {
      touch.pinger?.emitOne(makeEmitter(doc, "token"));
      emitPathwayTraces(doc);
    }
  });
  Hooks.on("createAmbientLight", (doc) => touch.pinger?.emitOne(makeEmitter(doc, "light")));
  Hooks.on("createAmbientSound", (doc) => touch.pinger?.emitOne(makeEmitter(doc, "sound")));
  // Wall edits change reflection surfaces: keep the wavefield's cache fresh.
  const syncWalls = () => {
    const scene = canvas.scene;
    if (scene) touch.wavefield?.setWalls(scene.id, collectWalls(scene));
  };
  Hooks.on("createWall", syncWalls);
  Hooks.on("updateWall", syncWalls);
  Hooks.on("deleteWall", syncWalls);

  console.debug("Touch | ready");
});

// ------------------------------------------------------------------- helpers

function changedPosition(change) {
  return change?.x !== undefined || change?.y !== undefined;
}

/** True if the emitter id refers to a deployable waypoint ("wp.*"). */
function isWaypointId(id) {
  return typeof id === "string" && id.startsWith("wp.");
}

/** True if the emitter id refers to a pathway sample point ("pw.*#n"). */
function isPathwayId(id) {
  return typeof id === "string" && id.startsWith("pw.");
}

/** Strip the sample suffix: "pw.abc#3" -> "pw.abc". */
function pathwayBaseId(id) {
  return id.split("#")[0];
}

function findDocumentByEmitterId(id) {
  if (typeof id !== "string" || !id) return null;
  const dot = id.indexOf(".");
  if (dot === -1) return null;
  const kind = id.slice(0, dot);
  const docId = id.slice(dot + 1);
  if (!docId) return null;
  const scene = canvas.scene;
  if (!scene) return null;
  switch (kind) {
    case "token": return scene.tokens.get(docId) ?? null;
    case "light": return scene.lights.get(docId) ?? null;
    case "sound": return scene.sounds.get(docId) ?? null;
    case "wall": return scene.walls.get(docId) ?? null;
    default: return null;
  }
}

/** Fire a one-off ping from a waypoint object. */
function pingWaypoint(wp) {
  window.touch?.pinger?.emitOne({
    id: wp.id,
    kind: "waypoint",
    name: wp.name,
    x: wp.x,
    y: wp.y,
    elevation: wp.elevation ?? 0,
    color: null,
    config: wp.config,
  });
}

/** Turn a freshly hooked document into an emitter-shaped object for emitOne. */
function makeEmitter(doc, kind) {
  const obj = doc.object;
  if (!obj?.center && !obj?.source) return null;
  const pos = obj.center ?? obj.source;
  const cfg = getConfig(doc);
  if (cfg.muted || cfg.intensity <= 0) return null;
  // Same vertical precedence as the pinger: Levels wins, Wall Height fallback.
  const lvRange = getLevelsRange(doc);
  const whRange = getWallHeightRange(doc);
  const hasLevels = lvRange.bottom !== null || lvRange.top !== null;
  return {
    id: `${kind}.${doc.id}`,
    kind,
    name: doc.name ?? "",
    x: pos.x,
    y: pos.y,
    elevation: doc.elevation ?? 0,
    levels: hasLevels ? lvRange : whRange,
    color: null,
    config: cfg,
    identity: doc.getFlag?.(MODULE_ID, "identity") ?? doc.getFlag?.(MODULE_ID, "trackId") ?? null,
  };
}
