/**
 * Touch — sonar wavefield.
 * A deterministic, client-side physics simulation layered on top of pings:
 * every received ping becomes an expanding circular wavefront that
 *   • attenuates with distance (1/√r falloff),
 *   • reflects off scene walls as weaker, opposing wavefronts ("bounce back"),
 *   • decays/dissipates over its lifetime, and
 *   • interferes with every other wavefront where fronts overlap:
 *       in phase  → constructive (amplified intensity dot),
 *       anti-phase → destructive (nodal null).
 *
 * Determinism: each client computes the same field from the same ping
 * payloads — reflection segments are derived from a per-uid pseudo-random
 * seed over the ping's position, so no client needs extra network traffic.
 *
 * The wall list is pushed by the GM via `setWalls(scene)` on scene load and
 * whenever walls change; other clients keep a stale-free cache keyed by the
 * scene id.
 */

const MAX_WAVES = 160;          // hard cap on concurrent wavefronts
const MAX_REFLECTIONS = 3;      // ray-cast reflection probes per wave
const WAVE_SPEED = 400;         // px per second in scene units
const BASE_LIFE = 5;            // seconds a wavefront survives unattenuated
const INTENSITY_LIFETIME = 3;   // intensity contributions decay over N seconds

/** Parse a hex color string to {r,g,b}; returns null when unparseable. */
function parseColor(hex) {
  if (typeof hex !== "string") return null;
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Deterministic hash → [0,1) from a string seed. */
function seedFloat(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Project point P onto segment AB; returns {x, y, t, dist}.
 * t in [0,1] along the segment, dist = distance from P to the segment.
 */
function projectOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const x = ax + abx * t, y = ay + aby * t;
  return { x, y, t, dist: Math.hypot(px - x, py - y) };
}

/**
 * Segments intersection: returns {x, y} or null.
 * Uses the standard parametric crossing test with an inclusive epsilon so
 * endpoint touches count as hits (waves grazing a wall tip still reflect).
 */
function segmentCross(px, py, qx, qy, ax, ay, bx, by) {
  const d1x = qx - px, d1y = qy - py;
  const d2x = bx - ax, d2y = by - ay;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - px) * d2y - (ay - py) * d2x) / den;
  const u = ((ax - px) * d1y - (ay - py) * d1x) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { x: px + d1x * t, y: py + d1y * t };
}

export class WaveField {
  constructor() {
    this.waves = [];      // expanding wavefronts
    this.echos = [];      // reflected fronts
    /** Interference dots keyed `wx|wy` → {x, y, i, born, color, tone} */
    this.interference = new Map();
    /** Lattice gridline excitation keyed `lineKey` → {hits, born} */
    this.latticeHits = new Map();
    /** Per-gridline direction bias (-1..1): net wave direction across the line. */
    this.latticeBias = new Map();
    this.walls = [];      // [{c: [x1,y1,x2,y2], elevation, whTop, whBottom, reflect}]
    this.sceneId = null;
  }

  /**
   * Amplitude of a front at time `now`: inverse-√r falloff × linear
   * dissipation over life × the wave's own intensity. Computed on demand so
   * samplers never read a stale/undefined amp before the first tick.
   */
  static amplitudeOf(w, now = Date.now(), speed = WAVE_SPEED) {
    const age = (now - w.born) / 1000;
    if (age < 0 || age >= w.life) return 0;
    const r = age * speed;
    return (w.intensity / 100) * (1 / Math.sqrt(1 + r / 40)) * (1 - age / w.life);
  }

  /** Replace the reflection surface list (walls that bounce waves). */
  setWalls(sceneId, walls) {
    if (sceneId !== undefined) this.sceneId = sceneId;
    this.walls = Array.isArray(walls) ? walls : [];
  }

  /**
   * Ingest one ping (or echo) as an expanding wavefront.
   * Echos (reflections) carry `echo: true` and do not spawn further echos.
   */
  ingestPing(p) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") return;
    if (this.waves.length >= MAX_WAVES) this.waves.shift();
    this.waves.push({
      x: p.x,
      y: p.y,
      intensity: Math.max(0, Math.min(100, Number(p.intensity) || 0)),
      elevation: Number(p.elevation) || 0,
      tone: p.config?.tone ?? "mid",
      color: parseColor(p.color) ?? { r: 94, g: 234, b: 212 },
      born: Date.now(),
      life: BASE_LIFE,
      reflections: p.echo ? 0 : MAX_REFLECTIONS,
      seed: String(p.uid ?? `${p.x},${p.y}`),
      wallsSnapshot: p.echo ? null : this.walls,
    });
  }

  /** Remove waves born before the given scene/epoch (scene switch hygiene). */
  clear() {
    this.waves = [];
    this.echos = [];
    this.interference.clear();
    this.latticeHits.clear();
    this.latticeBias.clear();
  }

  /** Age out expired fronts and interference dots. */
  gc(now = Date.now()) {
    this.waves = this.waves.filter((w) => now - w.born < w.life * 1000);
    this.echos = this.echos.filter((w) => now - w.born < w.life * 1000);
    for (const [k, v] of this.interference) {
      if (now - v.born > INTENSITY_LIFETIME * 1000) this.interference.delete(k);
    }
    for (const [k, v] of this.latticeHits) {
      if (now - v.born > INTENSITY_LIFETIME * 1000) {
        this.latticeHits.delete(k);
        this.latticeBias.delete(k);
      }
    }
  }

  /**
   * Advance the simulation one frame.
   * @param {number} dt          seconds since last tick
   * @param {number} attenuation echo distance dimming (0..1), from settings
   * @param {number} speed       wave speed px/s
   * @returns {{echos: number}}  echos spawned this tick
   */
  tick(dt, attenuation = 0.5, speed = WAVE_SPEED) {
    const now = Date.now();
    const spawned = [];
    const active = [...this.waves, ...this.echos];

    for (const w of active) {
      w.amp = WaveField.amplitudeOf(w, now, speed);
      if (w.amp <= 0.001) continue;
      if (w.reflections > 0 && w.wallsSnapshot?.length) {
        // Reflect off the nearest walls: project the wave center onto every
        // segment; the front reaches the closest wall first and bounces.
        // Deterministic and angle-independent (a random probe can miss a
        // wall entirely; the dominant reflection path cannot).
        const walls = w.wallsSnapshot
          .map((wall, index) => ({ wall, index, ...projectOnSegment(w.x, w.y, wall.c[0], wall.c[1], wall.c[2], wall.c[3]) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, w.reflections);
        for (const { wall, index, x: hx, y: hy, dist } of walls) {
          if (dist > w.intensity * 40) continue; // too far for this wave's energy
          const reflectAt = w.born + (dist / speed) * 1000;
          const uid = `${w.seed}:w${index}`;
          if (reflectAt > now || spawned.some((s) => s.uid === uid)) continue;
          spawned.push({
            uid,
            echo: {
              x: hx,
              y: hy,
              intensity: Math.round(w.intensity * (1 - attenuation) * (1 - dist / 3000)),
              tone: w.tone,
              color: w.color,
              born: reflectAt,
              seed: uid,
              elevation: w.elevation ?? 0,
            },
          });
        }
      }
    }

    // Launch due echoes (fronts that reached a wall this tick).
    for (const s of spawned) {
      if (now >= s.echo.born) {
        if (this.echos.length >= MAX_WAVES) this.echos.shift();
        this.echos.push({
          x: s.echo.x,
          y: s.echo.y,
          intensity: Math.max(1, s.echo.intensity),
          elevation: s.echo.elevation ?? 0,
          tone: s.echo.tone,
          color: s.echo.color,
          born: now,
          life: BASE_LIFE * 0.6,
          reflections: 0,
          seed: s.echo.seed,
          wallsSnapshot: null,
          echo: true,
        });
      }
    }
    this.gc(now);
    return { echos: spawned.filter((s) => now >= s.echo.born).length };
  }

  /**
   * Sample interference where two or more fronts' circumferences pass near
   * the same point. Pairwise fronts: sample points on A's rim; if another
   * front's rim passes within `tol`, the rims interfere there.
   * In phase (both outgoing, or both reflected) → constructive: bright dot.
   * Out of phase (outgoing × reflected) → destructive: dark nodal dot.
   * @returns {Array<{x, y, amp, phase, key}>}
   */
  sampleInterference(tol = 14, samplesPerRim = 24) {
    const now = Date.now();
    const speed = WAVE_SPEED;
    const active = [...this.waves, ...this.echos];
    const rims = active
      .map((w) => ({ w, r: ((now - w.born) / 1000) * speed, amp: WaveField.amplitudeOf(w, now, speed) }))
      .filter(({ amp }) => amp > 0.02);
    for (const rim of rims) rim.w.amp = rim.amp;
    const out = [];
    for (let i = 0; i < rims.length; i++) {
      const A = rims[i];
      if (A.r <= 0) continue;
      for (let s = 0; s < samplesPerRim; s++) {
        const ang = (s / samplesPerRim) * Math.PI * 2 + seedFloat(A.w.seed) * Math.PI * 2;
        const px = A.w.x + Math.cos(ang) * A.r;
        const py = A.w.y + Math.sin(ang) * A.r;
        let best = null;
        for (let j = 0; j < rims.length; j++) {
          if (j === i) continue;
          const B = rims[j];
          if (B.r <= 0) continue;
          const d = Math.abs(Math.hypot(px - B.w.x, py - B.w.y) - B.r);
          if (d < tol && (!best || d < best.d)) best = { d, B };
        }
        if (!best) continue;
        const amp = A.w.amp * best.B.w.amp;
        if (amp < 0.004) continue;
        const key = `${Math.round(px / tol)}|${Math.round(py / tol)}`;
        out.push({
          x: px,
          y: py,
          amp,
          // Outgoing × reflected fronts are anti-phase → destructive node.
          phase: A.w.echo !== best.B.w.echo ? "destructive" : "constructive",
          key,
        });
      }
    }
    // Keep the strongest contribution per cell; merge into the persistent map
    // so dots linger and fade (dissipate) after the fronts pass.
    const merged = new Map();
    for (const dot of out) {
      const prev = merged.get(dot.key);
      if (!prev || dot.amp > prev.amp) merged.set(dot.key, dot);
    }
    for (const [key, dot] of merged) {
      const prev = this.interference.get(key);
      if (!prev || dot.amp >= prev.amp * 0.9) {
        this.interference.set(key, { ...dot, born: prev?.born ?? now });
      }
    }
    return [...this.interference.values()];
  }

  /**
   * Lattice gridline excitation: for each gridline (from `lines`), find waves
   * whose front is currently crossing it and accumulate incident intensity.
   * `lines` are pathway objects: { c: [x1,y1,x2,y2], elevation, spacing }.
   * @returns {Array<{key, x1, y1, x2, y2, elevation, glow, bias}>}
   */
  latticeIntensity(lines) {
    const now = Date.now();
    const speed = WAVE_SPEED;
    const active = [...this.waves, ...this.echos]
      .map((w) => ({ w, amp: WaveField.amplitudeOf(w, now, speed) }))
      .filter(({ amp }) => amp > 0.01);
    for (const { w, amp } of active) w.amp = amp;
    const results = [];
    for (const line of lines ?? []) {
      const [x1, y1, x2, y2] = line.c;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      // Sample points along the gridline every ~40px.
      const n = Math.max(2, Math.min(24, Math.round(len / 40)));
      let sum = 0;
      let biasSum = 0;
      let biasCount = 0;
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        for (const { w } of active) {
          const r = ((now - w.born) / 1000) * speed;
          const d = Math.hypot(px - w.x, py - w.y);
          const crossing = Math.abs(d - r) < 26;
          if (!crossing) continue;
          // Incident intensity at this point: wave amplitude × radial decay
          // already inside amp; add inverse-distance weight for near misses.
          const radial = 1 / (1 + Math.abs(d - r) / 26);
          sum += w.amp * radial * 100;
          // Direction bias: does the front arrive moving +t or -t along the line?
          const grad = ((px - w.x) * (x2 - x1) + (py - w.y) * (y2 - y1)) / len;
          biasSum += Math.sign(grad) * radial;
          biasCount++;
        }
      }
      if (sum > 0.5) {
        const key = line.id ?? `l${Math.round(x1)},${Math.round(y1)},${Math.round(x2)},${Math.round(y2)}`;
        const prev = this.latticeHits.get(key);
        // Temporal smoothing: new excitation ramps in, old decays out.
        const glow = prev ? Math.max(sum, prev.glow * 0.75) : sum;
        this.latticeHits.set(key, {
          glow,
          born: sum >= (prev?.glow ?? 0) ? now : prev.born,
        });
        this.latticeBias.set(key, biasCount ? biasSum / biasCount : 0);
        results.push({
          key,
          x1, y1, x2, y2,
          elevation: line.elevation ?? 0,
          glow: Math.min(100, glow),
          bias: this.latticeBias.get(key) ?? 0,
        });
      }
    }
    return results;
  }

  /** Convenience accessor: current interference dots (for the viewer layer). */
  get dots() {
    return [...this.interference.values()];
  }
}
