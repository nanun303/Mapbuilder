import { MODULE_ID } from "./config.js";
import { ForestGeneratorApp } from "./app.js";
import { clearPreview } from "./preview.js";

let app = null;

export function openGenerator() {
  if (!game.user.isGM) {
    ui.notifications.warn("Der Waldgenerator ist nur für die Spielleitung verfügbar.");
    return null;
  }
  app ??= new ForestGeneratorApp();
  app.render(true);
  return app;
}

/** Startet aus dem Einstellungsmenü immer dasselbe Fenster. */
class GeneratorLauncher {
  render() {
    openGenerator();
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "config", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.registerMenu(MODULE_ID, "open", {
    name: "KMWALD.Title",
    label: "KMWALD.Open",
    hint: "KMWALD.MenuHint",
    icon: "fa-solid fa-tree",
    type: GeneratorLauncher,
    restricted: true
  });

  game.modules.get(MODULE_ID).api = { open: openGenerator };
});

// Button in der Tile-Werkzeugleiste
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const tiles = Array.isArray(controls) ? controls.find((c) => c.name === "tiles") : controls.tiles;
  if (!tiles) return;
  const tool = {
    name: MODULE_ID,
    title: "Waldgenerator",
    icon: "fa-solid fa-tree",
    button: true,
    visible: true,
    order: Object.keys(tiles.tools ?? {}).length + 1,
    onChange: () => openGenerator(),
    onClick: () => openGenerator()
  };
  if (Array.isArray(tiles.tools)) tiles.tools.push(tool);
  else tiles.tools[MODULE_ID] = tool;
});

Hooks.on("canvasTearDown", () => clearPreview());
