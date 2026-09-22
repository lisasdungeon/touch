/** Marching-group association and formation timelines for track records. */

const GROUP_SPEED_PX_S = 30;
const GROUP_DEG = 15;
const GROUP_STALE_MS = 5 * 60 * 1000;
const GROUP_VECTOR_FRESH_MS = 30 * 1000;
const MAX_GROUPS = 64;

function newGroupId() {
  return `grp.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class TrackGroups {
  constructor(registry) {
    this.registry = registry;
    this.groups = new Map();
  }

  load(rawGroups) {
    this.groups.clear();
    if (!rawGroups || typeof rawGroups !== "object") return;
    for (const [id, value] of Object.entries(rawGroups)) {
      if (value && typeof value === "object") {
        this.groups.set(id, {
          ...value,
          memberIds: [...(value.memberIds ?? [])],
          events: [...(value.events ?? [])],
        });
      }
    }
  }

  #vectorOf(track) {
    const points = track.points;
    if (!points || points.length < 2) return null;
    const latest = points[points.length - 1];
    let previous = null;
    for (let i = points.length - 2; i >= 0; i--) {
      if (latest.t - points[i].t >= 1500) {
        previous = points[i];
        break;
      }
    }
    if (!previous) return null;
    const seconds = (latest.t - previous.t) / 1000;
    if (seconds <= 0) return null;
    const dx = latest.x - previous.x;
    const dy = latest.y - previous.y;
    return {
      x: latest.x,
      y: latest.y,
      speed: Math.hypot(dx, dy) / seconds,
      heading: (Math.atan2(dy, dx) / Math.PI * 180 + 360) % 360,
      t: latest.t,
    };
  }

  recompute(now) {
    const vectors = new Map();
    for (const [id, track] of this.registry.tracks) {
      const vector = this.#vectorOf(track);
      if (vector && now - vector.t <= GROUP_VECTOR_FRESH_MS) vectors.set(id, vector);
    }

    const previous = new Map();
    for (const [id, track] of this.registry.tracks) {
      if (track.groupId) previous.set(id, track.groupId);
    }

    const compatible = (vector, group) =>
      Math.abs(vector.speed - group.vector.speed) <= GROUP_SPEED_PX_S &&
      Math.abs(((vector.heading - group.vector.heading + 540) % 360) - 180) <= GROUP_DEG;
    const desired = new Map();

    for (const [id, vector] of vectors) {
      let best = null;
      for (const [groupId, group] of this.groups) {
        if ((group.lastSeen ?? 0) < now - GROUP_STALE_MS || group.dissolved) continue;
        if (group.memberIds.length < 2 && this.registry.tracks.get(id)?.groupId === groupId) continue;
        if (!compatible(vector, group)) continue;
        const distance = Math.hypot(vector.x - group.vector.x, vector.y - group.vector.y);
        if (!best || distance < best.distance) best = { groupId, distance };
      }
      const groupId = best?.groupId ?? this.#create(vector, now);
      const group = this.groups.get(groupId);
      group.lastSeen = now;
      group.vector = { ...vector };
      desired.set(id, groupId);
    }

    for (const group of this.groups.values()) group.memberIds = [];
    for (const [id, groupId] of desired) {
      const group = this.groups.get(groupId);
      if (group && !group.memberIds.includes(id)) group.memberIds.push(id);
    }
    for (const groupId of new Set(desired.values())) {
      const group = this.groups.get(groupId);
      if (group && group.memberIds.length > 1 && !group.label) {
        group.label = this.registry.tracks.get(group.memberIds[0])?.label ?? null;
      }
    }

    for (const [groupId, group] of [...this.groups]) {
      if ((group.lastSeen ?? 0) < now - GROUP_STALE_MS) this.groups.delete(groupId);
    }
    while (this.groups.size > MAX_GROUPS) {
      const oldest = [...this.groups.entries()]
        .sort((a, b) => (a[1].lastSeen ?? 0) - (b[1].lastSeen ?? 0))[0];
      this.groups.delete(oldest[0]);
    }

    for (const [id, groupId] of desired) {
      const group = this.groups.get(groupId);
      const track = this.registry.tracks.get(id);
      const previousGroup = previous.get(id);
      if (!group) {
        if (previousGroup && track) {
          this.logTransition(previousGroup, id, "left", now);
          track.groupId = null;
        }
        continue;
      }
      if (previousGroup && previousGroup !== groupId) this.logTransition(previousGroup, id, "left", now);
      if (previousGroup !== groupId) this.logTransition(groupId, id, "joined", now);
      if (track) track.groupId = groupId;
    }
    for (const [id, previousGroup] of previous) {
      if (desired.has(id)) continue;
      this.logTransition(previousGroup, id, "left", now);
      const track = this.registry.tracks.get(id);
      if (track && track.groupId === previousGroup) track.groupId = null;
    }
    for (const track of this.registry.tracks.values()) {
      if (track.groupId && (!this.groups.has(track.groupId) || this.groups.get(track.groupId).memberIds.length < 2)) {
        track.groupId = null;
      }
    }
  }

  #create(vector, now) {
    const id = newGroupId();
    this.groups.set(id, {
      label: null,
      created: now,
      lastSeen: now,
      vector: { ...vector },
      memberIds: [],
      events: [{ tid: null, label: null, t: now, event: "formed" }],
    });
    return id;
  }

  logTransition(groupId, trackId, event, time) {
    const track = this.registry.tracks.get(trackId);
    const label = track?.label ?? "?";
    if (track) {
      track.groupLog = track.groupLog ?? [];
      const last = track.groupLog[track.groupLog.length - 1];
      if (!last || last.gid !== groupId || last.event !== event) {
        track.groupLog.push({ gid: groupId, t: time, event });
        if (track.groupLog.length > 24) track.groupLog.shift();
      }
    }
    const group = this.groups.get(groupId);
    if (!group || (event === "joined" && (group.memberIds?.length ?? 0) < 2)) return;
    group.events = group.events ?? [];
    const last = group.events[group.events.length - 1];
    if (!last || last.tid !== trackId || last.event !== event) {
      group.events.push({ tid: trackId, label, t: time, event });
      if (group.events.length > 64) group.events.shift();
    }
  }

  groupOfTrack(trackId) {
    const groupId = this.registry.tracks.get(trackId)?.groupId ?? null;
    const group = groupId ? this.groups.get(groupId) : null;
    return group && group.memberIds.length >= 2 ? groupId : null;
  }

  list() {
    const result = [];
    for (const [id, group] of this.groups) {
      const members = group.memberIds
        .map((memberId) => this.registry.tracks.has(memberId)
          ? { id: memberId, label: this.registry.tracks.get(memberId).label }
          : null)
        .filter(Boolean);
      if (members.length <= 1) continue;
      result.push({
        id,
        label: group.label,
        created: group.created,
        lastSeen: group.lastSeen,
        vector: group.vector ? { ...group.vector } : null,
        members,
      });
    }
    return result.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  }

  dissolve(groupId) {
    const group = this.groups.get(groupId);
    if (!group) return false;
    const now = Date.now();
    for (const memberId of group.memberIds) this.logTransition(groupId, memberId, "left", now);
    group.events.push({ tid: null, label: null, t: now, event: "dissolved" });
    group.dissolved = true;
    group.memberIds = [];
    group.lastSeen = now;
    for (const track of this.registry.tracks.values()) {
      if (track.groupId === groupId) track.groupId = null;
    }
    this.registry.markDirty();
    return true;
  }

  serialize() {
    const result = {};
    for (const [id, group] of this.groups) {
      result[id] = {
        ...group,
        memberIds: [...group.memberIds],
        events: (group.events ?? []).slice(-64).map((event) => ({ ...event })),
      };
    }
    return result;
  }

  timeline(perGroup = 12) {
    const result = [];
    for (const [id, group] of this.groups) {
      const members = group.memberIds
        .map((memberId) => this.registry.tracks.has(memberId)
          ? { id: memberId, label: this.registry.tracks.get(memberId).label }
          : null)
        .filter(Boolean);
      if (members.length <= 1 && !(group.events ?? []).length) continue;
      const events = (group.events ?? []).slice(-perGroup).map((event) => ({ ...event }));
      for (const member of members) {
        const own = (this.registry.tracks.get(member.id)?.groupLog ?? [])
          .filter((event) => event.gid === id)
          .slice(-3)
          .map((event) => ({ ...event, tid: member.id, label: member.label }));
        for (const event of own) {
          if (!events.some((item) => item.tid === event.tid && item.event === event.event && item.t === event.t)) {
            events.push(event);
          }
        }
      }
      events.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      result.push({
        id,
        label: group.label,
        created: group.created,
        lastSeen: group.lastSeen,
        dissolved: !!group.dissolved,
        vector: group.vector ? { ...group.vector } : null,
        members,
        events,
      });
    }
    return result.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  }
}
