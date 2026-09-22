/**
 * Touch — pinger.
 * Drives automatic ping waves and per-object one-off pings. The GM client is
 * the single clock; it broadcasts every emission so all clients stay in phase.
 */
import { MODULE_ID, SOCKET_NAME, SOCKET_MESSAGES, DEFAULTS } from "./constants.js";
import { collectEmitters } from "./emitters.js";
import { getLevelsRange, getWallHeightRange } from "./elevation.js";
import { zoneAddress } from "./zoneGridLayer.js";

export class Pinger {
  constructor(socket) {
    this.socket = socket;
    this.timer = null;
    this.phase = 0; // seconds since scheduler start (for per-emitter phase)
  }

  /** Settings snapshot shipped with every ping batch. */
  get settings() {
    return {
      interval: game.settings.get(MODULE_ID, "pingInterval") ?? DEFAULTS.pingInterval,
      duration: game.settings.get(MODULE_ID, "pingDuration") ?? DEFAULTS.pingDuration,
      maxRings: game.settings.get(MODULE_ID, "maxRings") ?? DEFAULTS.maxRings,
      showRings: game.settings.get(MODULE_ID, "showRingSprites") ?? DEFAULTS.showRingSprites,
      echoAttenuation: game.settings.get(MODULE_ID, "echoAttenuation") ?? DEFAULTS.echoAttenuation,
      globalIntensity: game.settings.get(MODULE_ID, "globalIntensity") ?? 100,
      globalMuted: game.settings.get(MODULE_ID, "globalMuted") ?? false,
      storeyHeight: game.settings.get(MODULE_ID, "storeyHeight") ?? DEFAULTS.storeyHeight,
      waveReflections: game.settings.get(MODULE_ID, "waveReflections") ?? DEFAULTS.waveReflections,
      waveSpeed: game.settings.get(MODULE_ID, "waveSpeed") ?? DEFAULTS.waveSpeed,
      wavePhysics: game.settings.get(MODULE_ID, "wavePhysics") ?? DEFAULTS.wavePhysics,
      memoryEnabled: game.settings.get(MODULE_ID, "memoryEnabled") ?? DEFAULTS.memoryEnabled,
      memoryRetention: game.settings.get(MODULE_ID, "memoryRetention") ?? DEFAULTS.memoryRetention,
    };
  }

  /**
   * Begin the automatic cycle (GM only).
   * A 1 Hz scheduler fires each emitter on its own cadence: rate 0 follows the
   * global interval, rate > 0 pings every `rate` seconds. Emitters are
   * staggered by index so multiple fast sources don't blink in unison.
   */
  start() {
    if (this.timer) this.stop();
    this.phase = 0;
    const tick = () => {
      this.timer = setTimeout(() => {
        this.phase += 1;
        try {
          this.tick();
        } catch (err) {
          console.error("Touch | pinger tick failed:", err);
        }
        tick();
      }, 1000);
      this.timer.unref?.();
    };
    tick();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * One scheduler tick: emit from every emitter whose cadence is due.
   * Rate>0 emitters run their own fast cadence, staggered by index so
   * multiple fast sources don't blink in unison. Rate 0 emitters follow
   * the global interval and all ring together (classic sonar pulse).
   * @returns {string[]} emitter ids that pinged this tick
   */
  tick() {
    const scene = canvas.scene;
    if (!scene || game.settings.get(MODULE_ID, "globalMuted")) return [];
    const interval = Math.max(1, game.settings.get(MODULE_ID, "pingInterval") ?? DEFAULTS.pingInterval);
    const due = [];
    const emitters = collectEmitters(scene).filter(
      (e) => !e.config.muted && e.config.intensity > 0
    );
    emitters.forEach((e, i) => {
      const rate = Math.max(0, Number(e.config.rate) || 0);
      if (rate > 0) {
        const period = Math.max(1, Math.round(rate));
        const offset = i % period; // stagger within the period
        if ((this.phase - offset) % period === 0) due.push(e);
      } else if (this.phase % interval === 0) {
        due.push(e);
      }
    });
    if (due.length) this.#emitBatch(due);
    return due.map((e) => e.id);
  }

  /**
   * Heartbeat timer: seconds until each emitter's next ping, keyed by
   * emitter id. Uses the exact same ordering/cadence math as tick() so the
   * countdown always agrees with what actually fires. Pathway sample points
   * appear under their own compound ids — the hub collapses them per line.
   * Muted/zero-intensity emitters (and everything while globally muted)
   * are omitted.
   * @returns {Map<string, number>}
   */
  heartbeats() {
    const map = new Map();
    const scene = canvas.scene;
    if (!scene || game.settings.get(MODULE_ID, "globalMuted")) return map;
    const interval = Math.max(1, Number(game.settings.get(MODULE_ID, "pingInterval")) || DEFAULTS.pingInterval);
    const audible = collectEmitters(scene).filter(
      (e) => !e.config.muted && e.config.intensity > 0
    );
    audible.forEach((e, i) => {
      const rate = Math.max(0, Number(e.config.rate) || 0);
      let k;
      if (rate > 0) {
        const period = Math.max(1, Math.round(rate));
        const offset = i % period; // same stagger as tick()
        k = (((offset - this.phase) % period) + period) % period || period;
      } else {
        k = (interval - (this.phase % interval)) % interval || interval;
      }
      map.set(e.id, k);
    });
    return map;
  }

  /** Emit pings for a set of emitters and broadcast them. */
  #emitBatch(emitters) {
    const scene = canvas.scene;
    if (!scene) return;
    const settings = this.settings;
    const pings = emitters.map((e) => this.#makePing(e, settings));
    const payload = { scene: scene.id, pings, settings };
    this.receive(payload);
    this.socket?.emit(SOCKET_NAME, { type: SOCKET_MESSAGES.PINGS, ...payload });
  }

  /**
   * One full sonar pulse: every audible emitter rings once.
   * @param {object} [opts]
   * @param {boolean} [opts.broadcast=true]  also send to other clients
   * @param {boolean} [opts.local=true]      render locally
   */
  pulse({ broadcast = true, local = true } = {}) {
    const scene = canvas.scene;
    if (!scene) return;
    const settings = this.settings;
    if (settings.globalMuted) return;

    const pings = [];
    for (const emitter of collectEmitters(scene)) {
      if (emitter.config.muted || emitter.config.intensity <= 0) continue;
      pings.push(this.#makePing(emitter, settings));
    }
    if (!pings.length) return;
    const payload = { scene: scene.id, pings, settings };
    if (local) this.receive(payload);
    if (broadcast && this.socket) {
      this.socket.emit(SOCKET_NAME, { type: SOCKET_MESSAGES.PINGS, ...payload });
    }
  }

  /** Single ping from one object (used on create/update hooks and manual triggers). */
  emitOne(emitter, { broadcast = true } = {}) {
    this.emitMany([emitter], { broadcast });
  }

  /**
   * Pings from several emitters at once (pathway sample points), in one
   * payload so remote clients render the whole line together.
   */
  emitMany(emitters, { broadcast = true } = {}) {
    const scene = canvas.scene;
    if (!scene || !emitters?.length) return;
    const settings = this.settings;
    if (settings.globalMuted) return;
    const pings = emitters
      .filter((e) => e)
      .map((e) => this.#makePing(e, settings));
    if (!pings.length) return;
    const payload = { scene: scene.id, settings, pings };
    this.receive(payload);
    if (broadcast && this.socket) {
      this.socket.emit(SOCKET_NAME, { type: SOCKET_MESSAGES.PINGS, ...payload });
    }
  }

  #makePing(emitter, settings) {
    // Global intensity acts as a master scale (100 = neutral).
    const master = (settings.globalIntensity ?? 100) / 100;
    // Vertical placement: Levels floor ranges win; Wall Height extents are the
    // fallback (a wall's bottom edge is where its echo sits).
    const lvRange = getLevelsRange(emitter.doc);
    const whRange = getWallHeightRange(emitter.doc);
    const hasLevels = lvRange.bottom !== null || lvRange.top !== null;
    const lv = hasLevels ? lvRange : whRange;
    const elevation = emitter.elevation ?? 0;
    const addressElevation = lv.bottom ?? elevation;
    return {
      uid: `${emitter.id}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      id: emitter.id,
      kind: emitter.kind,
      name: emitter.name,
      x: emitter.x,
      y: emitter.y,
      elevation,
      address: zoneAddress(emitter.x, emitter.y, addressElevation),
      levels: {
        bottom: lv.bottom ?? null,
        top: lv.top ?? null,
      },
      intensity: Math.round((emitter.config.intensity ?? 60) * master),
      // Emission mode + facing cone + feedback signature.
      config: {
        mode: emitter.config.mode ?? "both",
        angle: emitter.config.angle ?? 0,
        fov: emitter.config.fov ?? 360,
        rate: emitter.config.rate ?? 0,
        tone: emitter.config.tone ?? "mid",
      },
      color: emitter.color ?? null,
      born: Date.now(),
      // The object's persistent identity id, when it has been assigned or
      // stamped by a prior crossing — surfaced on viewer blips.
      identity: emitter.identity ?? null,
      // Surface traces (pathway × token): carry chord geometry through.
      // trackId links the event into the object's persistent track.
      ...(emitter.trace
        ? {
            trace: true,
            traceTokenId: emitter.traceTokenId ?? null,
            x2: emitter.x2,
            y2: emitter.y2,
            chord: emitter.chord ?? null,
            surface: emitter.surface ?? null,
            trackId: emitter.trackId ?? null,
            trackContinued: Boolean(emitter.trackContinued),
          }
        : {}),
    };
  }

  /**
   * Receive a batch of pings: hand to the ring layer and to the cameras/viewer.
   * Called on every client; the GM also calls it directly for local rendering.
   */
  receive(payload) {
    if (!canvas?.scene || !canvas.dimensions || payload.scene !== canvas.scene.id) return;
    const d = canvas.dimensions;
    const diag = Math.hypot(d.sceneWidth, d.sceneHeight) || 1;

    for (const p of payload.pings) {
      // Louder rings live longer, min 1s.
      const life = Math.max(1, (p.intensity / 100) * (payload.settings.duration ?? 4));
      const origin = { x: p.x, y: p.y };

      // 1) canvas ring sprite — arc sweep when the emitter has a cone,
      //    ring weight from the emitter's feedback tone
      if (payload.settings.showRings && canvas.touchRings?.active) {
        canvas.touchRings.emit(origin, {
          color: p.color ?? 0x5eead4,
          duration: life,
          maxRadius: diag,
          angle: p.config?.angle ?? 0,
          fov: p.config?.fov ?? 360,
          mode: p.config?.mode ?? "both",
          tone: p.config?.tone ?? "mid",
        });
      }

      // 1.5) wave physics — every ping becomes an expanding wavefront that
      //      attenuates, reflects off walls, and interferes with other fronts.
      //      Deterministic per-client, so no extra network traffic.
      if (payload.settings.wavePhysics !== false) {
        window.touch?.wavefield?.ingestPing(p);
        window.touch?.ensureWaveLoop?.();
      }

      // 1.6) node memory — the sonar remembers what happened at every
      //      coordinate: ping counts, surface traces, echo returns. Trace
      //      pings carrying a trackId continue an existing track.
      if (payload.settings.memoryEnabled !== false) {
        const mem = window.touch?.memory;
        if (mem) {
          const storey = Number.isFinite(p.storey)
            ? p.storey
            : Math.round((p.elevation ?? 0) / Math.max(1, payload.settings.storeyHeight ?? 10));
          if (p.trace) {
            mem.recordTrace((p.x + (p.x2 ?? p.x)) / 2, (p.y + (p.y2 ?? p.y)) / 2, storey, p.name ?? null, p.trackId ?? null);
          } else {
            mem.recordPing(p.x, p.y, storey, p.name ?? null, p.trackId ?? null);
          }
        }
      }

      // 2) camera array — one frame per camera, fed to the viewer
      const frames = window.touch?.cameras?.observe(p, payload.settings) ?? [];
      for (const frame of frames) window.touch?.viewer?.ingestFrame(frame);
    }
    window.touch?.viewer?.flush?.();
    canvas.touchHypergrid?.refreshHypergrid?.();
  }
}
