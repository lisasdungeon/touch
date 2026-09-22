/** Touch GM Hub application and action handlers. */
import { MODULE_ID } from "./constants.js";
import { prepareHubContext, bindHubEvents } from "./hub-render.js";

export class SonarHub extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "touch-hub",
    tag: "div",
    window: { title: "TOUCH.Hub.Title", icon: "fa-solid fa-sliders" },
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
    form: { template: "modules/touch/templates/hub.hbs", classes: ["touch-hub"] },
  };

  get title() {
    return `${game.i18n.localize("TOUCH.Hub.Title")} — ${canvas.scene?.name ?? ""}`;
  }

  async _prepareContext(options) {
    return prepareHubContext(this, options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#startBeatTicker();
    if (this.element) bindHubEvents(this.element);
  }

  static async #onGoto(event, target) {
    const row = target.closest(".touch-row");
    const id = row?.dataset?.id;
    const emitter = id ? window.touch?.emitters?.()?.find((item) => item.id === id) : null;
    if (emitter && canvas.ready) canvas.animatePan({ x: emitter.x, y: emitter.y, duration: 300 });
  }

  static async #onBulkIntensity(event, target) {
    const form = target.closest("form") ?? this.element;
    const input = form.querySelector('[name="bulkIntensity"]');
    const raw = input?.value ?? "";
    if (String(raw).trim() === "") return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    await window.touch?.bulkSetIntensity(value);
    this.render();
  }

  #bulkVertsFromUI(clear) {
    const root = this.element;
    const moduleName = root.querySelector('[name="bulkVertsModule"]')?.value ?? "levels";
    const kinds = [...root.querySelectorAll('input[name="bulkVertKind"]:checked')]
      .filter((box) => box.dataset.module === moduleName)
      .map((box) => box.value);
    const number = (selector) => {
      const raw = root.querySelector(selector)?.value;
      return raw === "" || raw === undefined ? null : Number(raw);
    };
    return window.touch?.bulkSetVerticals({
      module: moduleName,
      kinds,
      bottom: number('[name="bulkVertsBottom"]'),
      top: number('[name="bulkVertsTop"]'),
      clear,
    });
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
    await window.touch?.removeWaypoint(target.closest(".touch-row")?.dataset.id);
    this.render();
  }

  static async #onRemovePathway(event, target) {
    await window.touch?.removePathway(target.closest(".touch-row")?.dataset.pathwayId);
    this.render();
  }

  static async #onLatticeGenerate() {
    const root = this.element;
    const number = (name, fallback) => {
      const raw = root.querySelector(`[name="${name}"]`)?.value;
      const value = Number(raw);
      return Number.isFinite(value) && String(raw).trim() !== "" ? value : fallback;
    };
    const current = window.touch?.getLattice?.() ?? {};
    await window.touch?.generateLattice({
      cellW: Math.max(1, Math.round(number("latticeCellW", current.cellW ?? 4))),
      cellD: Math.max(1, Math.round(number("latticeCellD", current.cellD ?? 3))),
      storeys: Math.max(1, Math.round(number("latticeStoreys", current.storeys ?? 2))),
      intensity: Math.max(0, Math.min(100, number("latticeIntensity", current.intensity ?? 25))),
    });
    ui.notifications.info("Touch | Sonar lattice generated — gridlines are live pathways.");
  }

  static async #onLatticeClear() {
    const result = await window.touch?.clearLattice();
    ui.notifications.info(`Touch | Lattice cleared (${result?.removed ?? 0} lines removed).`);
  }

  static async #onWavesTest() {
    const root = this.element;
    const checked = (name) => Boolean(root.querySelector(`[name="${name}"]`)?.checked);
    const speed = Number(root.querySelector('[name="waveSpeed"]')?.value);
    if (Number.isFinite(speed) && speed >= 50) await game.settings.set(MODULE_ID, "waveSpeed", speed);
    await game.settings.set(MODULE_ID, "wavePhysics", checked("wavePhysics"));
    await game.settings.set(MODULE_ID, "waveReflections", checked("waveReflections"));
    await window.touch?.pinger?.pulse({ broadcast: true });
    ui.notifications.info("Touch | Wave test fired — watch the room view.");
  }

  static async #onMonitorsDeploy() { await window.touch?.setLatticeMonitors({ deploy: true }); }
  static async #onMonitorsClear() { await window.touch?.setLatticeMonitors({ deploy: false }); }
  static async #onMemoryClear() { await window.touch?.clearMemory(); }

  static async #onGroupDissolve(event, target) {
    const id = target.closest("[data-group-id]")?.dataset.groupId;
    if (id && window.touch.dissolveGroup(id)) {
      ui.notifications.info(game.i18n.localize("TOUCH.Groups.Dissolved"));
      this.render();
    }
  }

  static async #onIdentityAssign(event, target) {
    const row = target.closest(".touch-row");
    const emitter = window.touch?.emitters?.()?.find((item) => item.id === row?.dataset?.id);
    if (!emitter?.doc) return;
    const current = window.touch.identityOf(emitter.doc) ?? "";
    const wanted = await Dialog.prompt({
      title: game.i18n.localize("TOUCH.Identity.AssignTitle"),
      content: `<p>${game.i18n.localize("TOUCH.Identity.AssignHint")}</p><input name="id" value="${current}" placeholder="trk.custom" style="width:100%">`,
      label: game.i18n.localize("TOUCH.Identity.AssignLabel"),
      callback: (html) => html.querySelector("input[name=id]")?.value.trim() || null,
      rejectClose: false,
    });
    if (wanted === null) return;
    const assigned = await window.touch.assignIdentity(emitter.doc, wanted || undefined);
    if (!assigned) {
      ui.notifications.error(game.i18n.localize("TOUCH.Identity.Taken"));
      return;
    }
    ui.notifications.info(game.i18n.format("TOUCH.Identity.Assigned", { id: assigned }));
    this.render();
  }

  static async #onIdentityRevoke(event, target) {
    const row = target.closest(".touch-row");
    const emitter = window.touch?.emitters?.()?.find((item) => item.id === row?.dataset?.id);
    if (!emitter?.doc) return;
    await window.touch.revokeIdentity(emitter.doc);
    ui.notifications.info(game.i18n.localize("TOUCH.Identity.Revoked"));
    this.render();
  }

  static async #onIdentityRecapture(event, target) {
    const row = target.closest(".touch-row");
    const emitter = window.touch?.emitters?.()?.find((item) => item.id === row?.dataset?.id);
    if (!emitter?.doc) return;
    if (!window.touch.identityOf(emitter.doc)) {
      ui.notifications.warn(game.i18n.localize("TOUCH.Identity.RecaptureUnidentified"));
      return;
    }
    const result = await window.touch.recaptureSignature(emitter.doc);
    if (result?.id) ui.notifications.info(game.i18n.format("TOUCH.Identity.Recaptured", { id: result.id }));
    this.render();
  }

  static async #onMemoryRetention(event, target) {
    const value = Number(target.value);
    if (Number.isFinite(value) && value >= 0) {
      await game.settings.set(MODULE_ID, "memoryRetention", value);
      ui.notifications.info(`Touch | Memory retention: ${value === 0 ? "forever" : `${value}s`}`);
    }
  }

  static async #onReset() {
    await window.touch?.resetSettings();
    this.render();
  }

  static async #onOpenQuantum() {
    await window.touch?.openViewer?.();
  }

  #beatTicker = null;

  #startBeatTicker() {
    this.#stopBeatTicker();
    const step = () => {
      if (!this.rendered || !this.element) {
        this.#beatTicker = null;
        return;
      }
      const beats = window.touch?.heartbeats?.() ?? new Map();
      this.element.querySelectorAll("[data-beat-id]").forEach((element) => {
        const id = element.dataset.beatId;
        let due = beats.get(id);
        if (due === undefined && id?.startsWith("pw.")) {
          for (const [key, value] of beats) {
            if (key.startsWith(`${id}#`)) { due = value; break; }
          }
        }
        const output = element.querySelector(".touch-beat-value");
        if (output) output.textContent = due === undefined ? "—" : `${due}s`;
        element.classList.toggle("touch-beat-near", due !== undefined && due <= 1);
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
