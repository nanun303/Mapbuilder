export const MODULE_ID = "km-waldgenerator";

/** Erhöhen, wenn sich der Aufbau der Einstellungen ändert: alte gespeicherte Werte werden dann verworfen. */
const SCHEMA = 2;

const FA_FLORA = "fa-nexus-assets/Woodlands/!Wilderness/Flora";
export const FA_PATHS = {
  trees: `${FA_FLORA}/Trees`,
  stumps: `${FA_FLORA}/Trees/Stumps`,
  logs: `${FA_FLORA}/Trees/Logs`,
  bushes: `${FA_FLORA}/Bushes`
};

export const DEFAULTS = {
  schema: SCHEMA,

  // Szene
  target: "new",
  sceneName: "Wald",
  widthF: 60,
  heightF: 60,
  gridPx: 100,
  padding: 0.1,
  bgColor: "#2c3b1f",

  // Kronen: alle Bäume aus dem FA-Ordner (Unterordner wie Stumps/Logs werden nicht mitgelesen)
  crowns: [{ folder: FA_PATHS.trees, filter: "Tree_*", weight: 1, baseSize: 5, scaleMin: 0.9, scaleMax: 1.1 }],

  // Stämme: nur Version B, je eine Zeile pro Holzart
  trunks: [
    { folder: FA_PATHS.stumps, filter: "Stump_Ashen_B*", weight: 1 },
    { folder: FA_PATHS.stumps, filter: "Stump_Dark_B*", weight: 1 },
    { folder: FA_PATHS.stumps, filter: "Stump_Light_B*", weight: 1 }
  ],

  // Verteilung
  minDist: 3,
  density: 85,
  clumping: 50,
  edgeMargin: 0,
  seed: "",
  useDrawings: true,
  clearings: 2,
  clearingMin: 4,
  clearingMax: 8,
  paths: 1,
  pathWidth: 2,

  // Kronen-Darstellung
  crownMode: "overhead",
  occlusion: "RADIAL",
  occlusionAlpha: 0,
  crownElevation: 20,
  randomRotation: true,
  placeholderTrunks: true,
  trunkRatio: 0.45,
  faShadows: true,
  lockTiles: true,
  replaceExisting: true,

  // Hindernisse
  walls: true,
  wallMinSize: 3,
  wallMove: true,
  wallSight: false,
  wallSides: 6,

  // Totholz
  logFolder: FA_PATHS.logs,
  logFilter: "",
  logDensity: 1.5,
  logScale: 1,
  logDifficult: true,

  // Unterholz
  undergrowth: "patches",
  patchCount: 5,
  patchMin: 4,
  patchMax: 9,
  difficulty: 1,
  bushFolder: FA_PATHS.bushes,
  bushFilter: "",
  bushDensity: 50,
  bushSize: 1.5,

  // Boden
  groundTexture: "",
  groundTileSize: 10,
  groundRotate: false
};

const NUMBERS = [
  "widthF", "heightF", "gridPx", "padding", "minDist", "density", "clumping", "edgeMargin", "clearings",
  "clearingMin", "clearingMax", "paths", "pathWidth", "occlusionAlpha", "crownElevation", "trunkRatio",
  "wallMinSize", "wallSides", "logDensity", "logScale", "patchCount", "patchMin", "patchMax", "difficulty",
  "bushDensity", "bushSize", "groundTileSize"
];

function rows(value) {
  if (Array.isArray(value)) return value;
  return Object.values(value ?? {});
}

/** Füllt fehlende Werte auf und wandelt Formularwerte in die richtigen Typen um. */
export function normalizeConfig(raw = {}) {
  if (raw.schema !== undefined && raw.schema !== SCHEMA) raw = {};
  if (raw.species) raw = {}; // gespeicherte Werte aus Version 0.1
  const cfg = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), raw, { inplace: false, insertKeys: true });
  cfg.schema = SCHEMA;
  for (const key of NUMBERS) {
    const n = Number(cfg[key]);
    cfg[key] = Number.isFinite(n) ? n : DEFAULTS[key];
  }
  cfg.crowns = rows(raw.crowns ?? DEFAULTS.crowns).map((s) => ({
    folder: String(s.folder ?? "").trim(),
    filter: String(s.filter ?? "").trim(),
    weight: Number(s.weight) || 0,
    baseSize: Number(s.baseSize) || 5,
    scaleMin: Number(s.scaleMin) || 1,
    scaleMax: Number(s.scaleMax) || 1
  }));
  cfg.trunks = rows(raw.trunks ?? DEFAULTS.trunks).map((s) => ({
    folder: String(s.folder ?? "").trim(),
    filter: String(s.filter ?? "").trim(),
    weight: Number(s.weight) || 0
  }));
  cfg.widthF = Math.max(5, Math.round(cfg.widthF));
  cfg.heightF = Math.max(5, Math.round(cfg.heightF));
  cfg.gridPx = Math.max(50, Math.round(cfg.gridPx));
  cfg.minDist = Math.max(0.5, cfg.minDist);
  cfg.bushSize = Math.max(0.25, cfg.bushSize);
  cfg.logScale = Math.max(0.1, cfg.logScale);
  cfg.trunkRatio = Math.min(1.5, Math.max(0.05, cfg.trunkRatio));
  cfg.groundTileSize = Math.max(1, cfg.groundTileSize);
  cfg.seed = String(cfg.seed ?? "").trim();
  return cfg;
}
