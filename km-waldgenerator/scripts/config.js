export const MODULE_ID = "km-waldgenerator";

export const DEFAULTS = {
  // Szene
  target: "new",
  sceneName: "Wald",
  widthF: 60,
  heightF: 60,
  gridPx: 100,
  padding: 0.1,
  bgColor: "#2c3b1f",

  // Baumarten
  species: [
    { folder: "builtin:laub", weight: 3, baseSize: 4, scaleMin: 0.8, scaleMax: 1.3 },
    { folder: "builtin:nadel", weight: 2, baseSize: 3, scaleMin: 0.8, scaleMax: 1.2 }
  ],
  crownWords: "canopy, canopies, crown, crowns, krone, treetop, treetops, top, leaves, foliage",
  trunkWords: "trunk, trunks, stump, stamm, roots, base",

  // Verteilung
  minDist: 2.5,
  density: 80,
  clumping: 50,
  edgeMargin: 0,
  seed: "",
  useDrawings: true,
  clearings: 2,
  clearingMin: 4,
  clearingMax: 8,
  paths: 1,
  pathWidth: 2,

  // Kronen
  crownMode: "overhead",
  occlusion: "RADIAL",
  occlusionAlpha: 0,
  crownElevation: 20,
  randomRotation: true,
  placeholderTrunks: true,
  trunkRatio: 0.22,
  faShadows: true,
  lockTiles: true,
  replaceExisting: true,

  // Hindernisse
  walls: true,
  wallMinSize: 3,
  wallMove: true,
  wallSight: false,
  wallSides: 6,

  // Unterholz
  undergrowth: "patches",
  patchCount: 5,
  patchMin: 4,
  patchMax: 9,
  difficulty: 1,
  bushFolder: "",
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
  "wallMinSize", "wallSides", "patchCount", "patchMin", "patchMax", "difficulty", "bushDensity", "bushSize",
  "groundTileSize"
];

/** Füllt fehlende Werte auf und wandelt Formularwerte in die richtigen Typen um. */
export function normalizeConfig(raw = {}) {
  const cfg = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), raw, { inplace: false, insertKeys: true });
  for (const key of NUMBERS) {
    const n = Number(cfg[key]);
    cfg[key] = Number.isFinite(n) ? n : DEFAULTS[key];
  }
  let species = raw.species ?? cfg.species;
  if (!Array.isArray(species)) species = Object.values(species ?? {});
  cfg.species = species.map((s) => ({
    folder: String(s.folder ?? ""),
    weight: Number(s.weight) || 0,
    baseSize: Number(s.baseSize) || 3,
    scaleMin: Number(s.scaleMin) || 1,
    scaleMax: Number(s.scaleMax) || 1
  }));
  cfg.widthF = Math.max(5, Math.round(cfg.widthF));
  cfg.heightF = Math.max(5, Math.round(cfg.heightF));
  cfg.gridPx = Math.max(50, Math.round(cfg.gridPx));
  cfg.minDist = Math.max(0.5, cfg.minDist);
  cfg.bushSize = Math.max(0.25, cfg.bushSize);
  cfg.groundTileSize = Math.max(1, cfg.groundTileSize);
  cfg.seed = String(cfg.seed ?? "").trim();
  return cfg;
}
