import { MODULE_ID } from "./config.js";
import { applyCover, coverData, removeCover } from "./cover.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const COVER_DEFAULTS = { dc: 10, outline: "auto", inset: 10, blockSight: false };

/** Fenster, um beliebige Tiles mit denselben Regeln wie das Totholz zu belegen (Cover + Klettern). */
export class CoverApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options) {
    super(options);
    this.opts = { ...COVER_DEFAULTS, ...(game.settings.get(MODULE_ID, "coverConfig") ?? {}) };
    this.busy = false;
    this.hook = Hooks.on("controlTile", () => this.rendered && this.render());
  }

  static DEFAULT_OPTIONS = {
    id: "km-waldgenerator-cover",
    tag: "form",
    classes: ["km-wald", "km-cover"],
    window: { title: "Cover", icon: "fa-solid fa-shield-halved", resizable: true },
    position: { width: 460, height: "auto" },
    form: { handler: CoverApp.#onApply, submitOnChange: false, closeOnSubmit: false },
    actions: { remove: CoverApp.#onRemove }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/cover.hbs` }
  };

  async _prepareContext() {
    const tiles = (canvas.tiles?.controlled ?? []).map((t) => {
      const src = t.document.texture?.src ?? "";
      const cover = coverData(t.document);
      return {
        src,
        name: decodeURIComponent(src.split("?")[0].split("/").pop() || t.id),
        cover: cover ? `Cover, SG ${cover.dc}` : null
      };
    });
    return {
      opts: this.opts,
      tiles,
      hasTiles: tiles.length > 0,
      outlines: { auto: "Automatisch (Bildumriss)", rect: "Rechteck" }
    };
  }

  async close(options) {
    Hooks.off("controlTile", this.hook);
    return super.close(options);
  }

  async #readForm() {
    const FDE = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;
    const data = new FDE(this.element).object;
    this.opts = {
      dc: Math.max(0, Number(data.dc) || 0),
      outline: data.outline === "rect" ? "rect" : "auto",
      inset: Math.min(45, Math.max(0, Number(data.inset) || 0)),
      blockSight: !!data.blockSight
    };
    await game.settings.set(MODULE_ID, "coverConfig", this.opts);
    return this.opts;
  }

  #selectedTiles() {
    const tiles = (canvas.tiles?.controlled ?? []).map((t) => t.document);
    if (!tiles.length) ui.notifications.warn("Wähle zuerst auf der Karte ein oder mehrere Tiles aus (Tile-Ebene).");
    return tiles;
  }

  async #run(fn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(`Cover: ${err.message}`);
    } finally {
      this.busy = false;
      if (this.rendered) this.render();
    }
  }

  static async #onApply() {
    await this.#run(async () => {
      const opts = await this.#readForm();
      const tiles = this.#selectedTiles();
      if (!tiles.length) return;
      const walls = await applyCover(canvas.scene, tiles, opts);
      ui.notifications.info(`Cover gesetzt: ${tiles.length} Objekt(e), ${walls} Wände.`);
    });
  }

  static async #onRemove() {
    await this.#run(async () => {
      const tiles = this.#selectedTiles().filter((t) => coverData(t));
      if (!tiles.length) return;
      const walls = await removeCover(canvas.scene, tiles);
      ui.notifications.info(`Cover entfernt: ${tiles.length} Objekt(e), ${walls} Wände gelöscht.`);
    });
  }
}
