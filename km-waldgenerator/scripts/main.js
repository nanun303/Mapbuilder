import { MODULE_ID } from "./config.js";
import { ForestGeneratorApp } from "./app.js";
import { CoverApp } from "./cover-app.js";
import { registerCoverHooks } from "./cover.js";
import { registerClimb } from "./climb.js";
import { clearPreview } from "./preview.js";

const apps = {};

function openApp(key, Cls) {
  if (!game.user.isGM) {
    ui.notifications.warn("Nur für die Spielleitung verfügbar.");
    return null;
  }
  apps[key] ??= new Cls();
  apps[key].render(true);
  return apps[key];
}

export const openGenerator = () => openApp("generator", ForestGeneratorApp);
export const openCover = () => openApp("cover", CoverApp);

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

  game.settings.register(MODULE_ID, "coverConfig", {
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

  game.modules.get(MODULE_ID).api = { open: openGenerator, openCover };
  registerCoverHooks();
  registerClimb();
});

// Buttons in der Tile-Werkzeugleiste
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const tiles = Array.isArray(controls) ? controls.find((c) => c.name === "tiles") : controls.tiles;
  if (!tiles) return;
  const count = Object.keys(tiles.tools ?? {}).length;
  const tools = [
    { name: MODULE_ID, title: "Waldgenerator", icon: "fa-solid fa-tree", order: count + 1, open: openGenerator },
    { name: `${MODULE_ID}-cover`, title: "Cover", icon: "fa-solid fa-shield-halved", order: count + 2, open: openCover }
  ];
  for (const { open, ...tool } of tools) {
    const data = { ...tool, button: true, visible: true, onChange: () => open(), onClick: () => open() };
    if (Array.isArray(tiles.tools)) tiles.tools.push(data);
    else tiles.tools[data.name] = data;
  }
});

Hooks.on("canvasTearDown", () => clearPreview());
