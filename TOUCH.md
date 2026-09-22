# TOUCH

**Spatiotemporal perception and reconstruction layer** for C.E.R.E.B.R.U.M.

Not a camera system. Not a motion detector. Not merely a sensor network.

> **TOUCH converts interactions with a mapped environment into persistent, addressable spatial evidence, allowing CEREBRUM to reconstruct where something was, how it moved, what it interacted with, and when it happened.**

## Short form

> **E.Y.E. sees. E.A.R. hears. TOUCH knows where.**
>
> **TOUCH knows where, when, and how it moved.**

| Sense | Role |
| --- | --- |
| E.Y.E. | what something looks like |
| E.A.R. | what happens (audio) |
| TOUCH | where things physically exist and how they move through space |

## World model

```text
ZONE
  ↓
X / Y
  ↓
Z
  ↓
HEARTBEAT / TIME
  ↓
OBJECT / EVENT
```

The mapped environment is part of the sensing mechanism: waypoints, paths, beams, emitters, viewpoints, and propagation relationships. An interaction at one location can produce responses in surrounding pathways. Propagation carries origin, direction, distance, intensity, frequency, and time.

TOUCH does not stop at `MOTION DETECTED`. It reconstructs:

```text
ROOT EVENT
    ↓
beam/path interrupted
    ↓
known X/Y/Z location
    ↓
heartbeat …
    ↓
surrounding pathways respond
    ↓
propagation/reverb continues
    ↓
multiple viewpoints observe response
    ↓
object continuity maintained
    ↓
spatial event reconstructed
```

## Sparse persistent state

Coordinates retain persistent state **sparsely**. TOUCH does not continuously record an entire room.

If nothing changes:

```text
STATE A ───────────────────── STATE A
```

Nothing meaningful is written.

When something changes:

```text
11:32:08  STATE A

11:41:17  STATE B
```

A query for an in-between time resolves against the persisted state. **Time is an addressable dimension**, not only a timestamp attached afterward.

Example queries:

- What was happening in Zone 2 at this coordinate at heartbeat/time X?
- Where was OBJECT-0042 throughout June 30?

## Object continuity

The room owns its coordinates. The object owns its continuity.

```text
OBJECT-0042

Zone 1
  ↓
Zone 2
  ↓
Zone 3

SAME OBJECT
SAME TRACE
```

Crossing a zone boundary does not manufacture a new entity.

## Evidence join

On a meaningful interruption, E.Y.E. may capture the relevant face/object image and associate that evidence with the heartbeat/event instead of continuous video. Later reconstruction can combine:

```text
TOUCH     where / movement / spatial interaction / time
E.Y.E.    visual evidence
E.A.R.    audio evidence
HEARTBEAT common temporal reference
```

## Authority boundary

TOUCH does **not** decide authority, intent, or policy.

TOUCH:

> OBJECT-0042 is here, and here is the evidence/history supporting that observation.

Not:

> OBJECT-0042 is unauthorized.

**GUARD** compares observed state against the authorization envelope established elsewhere (e.g. **RECEPTION**).

## Formal description

> **TOUCH is a persistent spatiotemporal sensing and reconstruction system that maps physical environments into addressable volumetric zones and records meaningful state transitions through distributed spatial interactions. It maintains coordinate state, event propagation, object continuity, provenance, and heartbeat-based temporal relationships, allowing past physical states and movement to be reconstructed from sparse evidence rather than continuous recording. TOUCH establishes what occupied or interacted with a location and when; it does not independently determine authority, intent, or policy compliance.**

## Seat lock

- TOUCH = evidence / reconstruction seat
- GUARD = authorization check seat
- RECEPTION = authorization envelope / intake seat
- Do not collapse these seats

