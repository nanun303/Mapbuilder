import { MODULE_ID, DEFAULTS, normalizeConfig } from "./config.js";
import { applyPlan, createChunked, createScene, groundTileData, preparePlan, removeGenerated, sceneDimensions } from "./builder.js";
import { clearPreview, drawPreview } from "./preview.js";
import { BUILTIN_NAMES } from "./assets.js";

const NEW_ROWS = {
  crowns: { folder: "", filter: "", weight: 1, baseSize: 5, scaleMin: 0.9, scaleMax: 1.1 },
  trunks: { folder: "", filter: "", weight: 1 }
};

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LARGE_MAP = 150 * 150;
const MANY_DOCUMENTS = 5000;

export class ForestGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options) {
    super(options);
    this.config = normalizeConfig(game.settings.get(MODULE_ID, "config") ?? {});
    this.busy = false;
  }

  static DEFAULT_OPTIONS = {
    id: "km-waldgenerator",
    tag: "form",
    classes: ["km-wald"],
    window: { title: "Waldgenerator", icon: "fa-solid fa-tree", resizable: true },
    position: { width: 640, height: 820 },
    form: { handler: ForestGeneratorApp.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      addRow: ForestGeneratorApp.#onAddRow,
      removeRow: ForestGeneratorApp.#onRemoveRow,
      browse: ForestGeneratorApp.#onBrowse,
      rollSeed: ForestGeneratorApp.#onRollSeed,
      preview: ForestGeneratorApp.#onPreview,
      clearPreview: ForestGeneratorApp.#onClearPreview,
      createEmpty: ForestGeneratorApp.#onCreateEmpty,
      removeForest: ForestGeneratorApp.#onRemoveForest,
      resetDefaults: ForestGeneratorApp.#onResetDefaults
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/generator.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/footer.hbs` }
  };

  async _prepareContext(options) {
    const cfg = this.config;
    return {
      cfg,
      crowns: cfg.crowns.map((s, index) => ({ ...s, index })),
      trunks: cfg.trunks.map((s, index) => ({ ...s, index })),
      builtins: BUILTIN_NAMES.join(", "),
      sceneName: canvas.scene?.name ?? "–",
      faActive: !!game.modules.get("fa-nexus")?.active,
      targets: { new: "Neue Szene erstellen", current: "In aktuelle Szene einfügen" },
      crownModes: {
        overhead: "Kronen über Tokens (blenden aus, wenn ein Token darunter steht)",
        trunks: "Ohne Kronen (nur Stämme)",
        flat: "Ganze Bäume flach am Boden (ohne Ausblenden)"
      },
      occlusions: { RADIAL: "Radial: Kreis um das Token", FADE: "Ausblenden: ganze Krone", VISION: "Sicht: nach Token-Sicht" },
      undergrowths: { none: "Kein Unterholz", patches: "Unterholz-Flecken", everywhere: "Ganzer Wald" },
      difficulties: { 1: "Schwieriges Gelände", 2: "Größeres schwieriges Gelände" }
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Schieberegler-Werte live anzeigen
    for (const range of this.element.querySelectorAll('input[type="range"]')) {
      const label = range.nextElementSibling;
      if (label?.classList.contains("kmw-val")) range.addEventListener("input", () => (label.textContent = range.value));
    }
  }

  async close(options) {
    clearPreview();
    return super.close(options);
  }

  /* -------------------------------------------- */

  /** Liest das Formular in this.config und speichert es. */
  async #readForm() {
    const FDE = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;
    const data = foundry.utils.expandObject(new FDE(this.element).object);
    // Leere Tabellen erscheinen nicht im Formular, sollen aber leer bleiben statt auf Standard zurückzufallen
    data.crowns ??= [];
    data.trunks ??= [];
    this.config = normalizeConfig(data);
    await game.settings.set(MODULE_ID, "config", this.config);
    return this.config;
  }

  async #ensureSeed() {
    if (this.config.seed) return;
    this.config.seed = foundry.utils.randomID(8);
    const input = this.element.querySelector('[name="seed"]');
    if (input) input.value = this.config.seed;
    await game.settings.set(MODULE_ID, "config", this.config);
  }

  async #setTargetCurrent() {
    this.config.target = "current";
    await game.settings.set(MODULE_ID, "config", this.config);
    await this.render();
  }

  async #run(fn) {
    if (this.busy) return;
    this.busy = true;
    this.element.classList.add("busy");
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(`Waldgenerator: ${err.message}`);
    } finally {
      this.busy = false;
      this.element?.classList.remove("busy");
    }
  }

  static #confirm(title, content) {
    return foundry.applications.api.DialogV2.confirm({ window: { title }, content: `<p>${content}</p>` });
  }

  static #summary(plan) {
    const { tiles, walls, regions } = plan.docs;
    return `${plan.trees.length} Bäume, ${plan.logs.length} Totholz, ${plan.bushes.length} Büsche → ${tiles.length} Tiles, ${walls.length} Wände, ${regions.length} Regionen`;
  }

  /* -------------------------------------------- */
  /*  Aktionen                                    */
  /* -------------------------------------------- */

  static async #onSubmit() {
    await this.#run(async () => {
      const cfg = await this.#readForm();
      await this.#ensureSeed();

      if (cfg.target === "current" && !canvas.scene) throw new Error("Keine aktive Szene.");
      if (cfg.target === "new" && cfg.widthF * cfg.heightF > LARGE_MAP) {
        const ok = await ForestGeneratorApp.#confirm(
          "Sehr große Karte",
          `${cfg.widthF} × ${cfg.heightF} Felder ist sehr groß und kann auf schwächeren Rechnern ruckeln. Trotzdem erstellen?`
        );
        if (!ok) return;
      }

      const scene = cfg.target === "new" ? await createScene(cfg) : canvas.scene;
      const plan = await preparePlan(scene, cfg);
      for (const w of plan.warnings) ui.notifications.warn(`Waldgenerator: ${w}`);
      if (!plan.trees.length && !plan.bushes.length) throw new Error("Keine Bäume platziert. Ordner und Dichte prüfen.");

      const count = plan.docs.tiles.length + plan.docs.walls.length;
      if (count > MANY_DOCUMENTS) {
        const ok = await ForestGeneratorApp.#confirm(
          "Viele Objekte",
          `${ForestGeneratorApp.#summary(plan)}. Das kann die Szene verlangsamen. Fortfahren?`
        );
        if (!ok) return;
      }

      clearPreview();
      await applyPlan(scene, plan, cfg);
      ui.notifications.info(`Waldgenerator: fertig. ${ForestGeneratorApp.#summary(plan)}.`);
      // Weitere Durchläufe sollen die eben erstellte Szene ersetzen statt eine neue anzulegen
      if (cfg.target === "new") await this.#setTargetCurrent();
    });
  }

  static async #onPreview() {
    await this.#run(async () => {
      const cfg = await this.#readForm();
      if (cfg.target === "new" || !canvas.scene) {
        ui.notifications.warn("Die Vorschau funktioniert in der aktuellen Szene. Erstelle zuerst eine leere Szene oder wähle „In aktuelle Szene einfügen“.");
        return;
      }
      await this.#ensureSeed();
      const plan = await preparePlan(canvas.scene, cfg);
      for (const w of plan.warnings) ui.notifications.warn(`Waldgenerator: ${w}`);
      drawPreview(plan, cfg);
      ui.notifications.info(`Vorschau: ${ForestGeneratorApp.#summary(plan)}`);
    });
  }

  static async #onRollSeed() {
    await this.#readForm();
    this.config.seed = foundry.utils.randomID(8);
    await game.settings.set(MODULE_ID, "config", this.config);
    await this.render();
    if (this.config.target === "current" && canvas.scene) await ForestGeneratorApp.#onPreview.call(this);
  }

  static #onClearPreview() {
    clearPreview();
  }

  static async #onCreateEmpty() {
    await this.#run(async () => {
      const cfg = await this.#readForm();
      const scene = await createScene(cfg);
      const ground = groundTileData(sceneDimensions(scene), cfg);
      if (ground.length) await createChunked(scene, "Tile", ground, "Boden-Tiles");
      ui.notifications.info("Leere Szene erstellt. Zeichne jetzt Freiflächen (Rechteck, Ellipse, Polygon) und nutze dann „Vorschau“.");
      await this.#setTargetCurrent();
    });
  }

  static async #onRemoveForest() {
    await this.#run(async () => {
      if (!canvas.scene) throw new Error("Keine aktive Szene.");
      const ok = await ForestGeneratorApp.#confirm(
        "Wald entfernen",
        `Alle vom Waldgenerator erzeugten Tiles, Wände und Regionen in „${canvas.scene.name}“ löschen? Andere Objekte bleiben erhalten.`
      );
      if (!ok) return;
      clearPreview();
      const n = await removeGenerated(canvas.scene);
      ui.notifications.info(`Waldgenerator: ${n} Objekte entfernt.`);
    });
  }

  static async #onAddRow(event, target) {
    const list = target.dataset.list;
    await this.#readForm();
    this.config[list].push({ ...NEW_ROWS[list] });
    await this.render();
  }

  static async #onRemoveRow(event, target) {
    await this.#readForm();
    this.config[target.dataset.list].splice(Number(target.dataset.index), 1);
    await this.render();
  }

  static async #onResetDefaults() {
    this.config = normalizeConfig(foundry.utils.deepClone(DEFAULTS));
    await game.settings.set(MODULE_ID, "config", this.config);
    await this.render();
  }

  static #onBrowse(event, target) {
    const input = this.element.querySelector(`[name="${target.dataset.target}"]`);
    if (!input) return;
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const current = input.value.startsWith("builtin:") ? "" : input.value;
    new FP({
      type: target.dataset.type,
      current,
      callback: (path) => {
        input.value = path;
      }
    }).render(true);
  }
}
