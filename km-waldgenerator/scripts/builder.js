import { MODULE_ID } from "./config.js";
import { loadAssets } from "./assets.js";
import { planForest } from "./generator.js";

const CHUNK = 500;

export function sceneDimensions(scene) {
  return scene.dimensions ?? scene.getDimensions();
}

/* -------------------------------------------- */
/*  Szene                                       */
/* -------------------------------------------- */

export async function createScene(cfg) {
  const scene = await getDocumentClass("Scene").create({
    name: cfg.sceneName || "Wald",
    width: cfg.widthF * cfg.gridPx,
    height: cfg.heightF * cfg.gridPx,
    padding: cfg.padding,
    grid: { type: CONST.GRID_TYPES.SQUARE, size: cfg.gridPx, distance: 5, units: "ft" },
    backgroundColor: cfg.bgColor,
    tokenVision: true,
    navigation: true
  });
  // Ab v14 liegt die Hintergrundfarbe auf der Ebene (Level) statt auf der Szene
  const level = scene.levels?.contents?.[0];
  if (level) {
    try {
      await level.update({ "background.color": cfg.bgColor });
    } catch (err) {
      console.warn(`${MODULE_ID} | Hintergrundfarbe konnte nicht gesetzt werden`, err);
    }
  }
  await scene.view();
  return scene;
}

/* -------------------------------------------- */
/*  Planen                                      */
/* -------------------------------------------- */

export async function preparePlan(scene, cfg) {
  const assets = await loadAssets(cfg);
  const drawings = scene.drawings.contents.filter((d) => !d.getFlag(MODULE_ID, "generated"));
  const plan = planForest(sceneDimensions(scene), cfg, assets, drawings);
  plan.warnings = assets.warnings;
  plan.docs = buildDocuments(plan, cfg, sceneDimensions(scene));
  return plan;
}

/* -------------------------------------------- */
/*  Dokumentdaten                               */
/* -------------------------------------------- */

function faShadowFlags(cfg) {
  if (!cfg.faShadows || !game.modules.get("fa-nexus")?.active) return {};
  return {
    "fa-nexus": {
      shadow: true,
      shadowAlpha: 0.65,
      shadowDilation: 1.6,
      shadowBlur: 1.8,
      shadowOffsetDistance: 0,
      shadowOffsetAngle: 135,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowOnly: false
    }
  };
}

function occlusionData(cfg) {
  const mode = CONST.OCCLUSION_MODES[cfg.occlusion] ?? CONST.OCCLUSION_MODES.FADE;
  // v14 erlaubt mehrere Modi gleichzeitig (Array), v13 nur einen
  if (game.release.generation >= 14) return { modes: [mode], alpha: cfg.occlusionAlpha };
  return { mode, alpha: cfg.occlusionAlpha };
}

function tileData(src, cx, cy, w, h, rotation, kind, sort, cfg, extra = {}) {
  const base = {
    texture: { src },
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    width: Math.round(w),
    height: Math.round(h),
    rotation,
    elevation: 0,
    sort,
    hidden: false,
    locked: cfg.lockTiles,
    restrictions: { light: false, weather: false },
    flags: { [MODULE_ID]: { generated: true, kind } }
  };
  return foundry.utils.mergeObject(base, extra, { inplace: false });
}

function difficultBehavior(level) {
  const models = CONFIG.RegionBehavior?.dataModels ?? {};
  // PF2e: eigenes "Environment Feature"-Verhalten mit difficult 1 (schwierig) / 2 (größer schwierig)
  const pf2e = Object.keys(models).find((k) => k === "environmentFeature" || k.endsWith(".environmentFeature"));
  if (pf2e) return { type: pf2e, name: "Unterholz", system: { terrain: { difficult: level } } };
  // Fallback: Kern-Verhalten "Bewegungskosten ändern"
  const core = models.modifyMovementCost;
  if (core) {
    const difficulties = {};
    for (const key of Object.keys(core.schema?.fields?.difficulties?.fields ?? {})) difficulties[key] = level + 1;
    return { type: "modifyMovementCost", name: "Unterholz", system: { difficulties } };
  }
  return null;
}

/** Bodentextur als Raster aus Tiles über die ganze Szenenfläche. */
export function groundTileData(dims, cfg) {
  if (!cfg.groundTexture) return [];
  const ts = cfg.groundTileSize * dims.size;
  const tiles = [];
  let i = 0;
  for (let y = dims.sceneY; y < dims.sceneY + dims.sceneHeight; y += ts) {
    for (let x = dims.sceneX; x < dims.sceneX + dims.sceneWidth; x += ts) {
      const rot = cfg.groundRotate ? 90 * ((i * 7 + Math.floor(y / ts) * 3) % 4) : 0;
      tiles.push(tileData(cfg.groundTexture, x + ts / 2, y + ts / 2, ts, ts, rot, "ground", 0, cfg, { locked: true }));
      i++;
    }
  }
  return tiles;
}

/** Wandelt den Plan in Tile-, Wall- und Region-Daten um. */
export function buildDocuments(plan, cfg, dims) {
  const g = dims.size;
  const flags = { [MODULE_ID]: { generated: true } };
  const shadow = faShadowFlags(cfg);
  const tiles = groundTileData(dims, cfg);

  // Büsche
  for (const b of plan.bushes) {
    tiles.push(tileData(b.src, b.x, b.y, b.w, b.h, b.rotation, "bush", 1, cfg, { flags: shadow }));
  }

  // Totholz
  for (const l of plan.logs) {
    tiles.push(tileData(l.src, l.x, l.y, l.w, l.h, l.rotation, "log", 2, cfg, { flags: shadow }));
  }

  // Bäume
  const occlusion = occlusionData(cfg);
  plan.trees.forEach((t, i) => {
    if (t.trunk) tiles.push(tileData(t.trunk, t.x, t.y, t.trunkSize, t.trunkSize, t.trunkRotation, "trunk", 3, cfg));
    if (cfg.crownMode === "overhead") {
      tiles.push(tileData(t.crown, t.x, t.y, t.w, t.h, t.rotation, "crown", 10 + i, cfg, {
        elevation: cfg.crownElevation,
        occlusion,
        flags: shadow
      }));
    } else if (cfg.crownMode === "flat") {
      tiles.push(tileData(t.crown, t.x, t.y, t.w, t.h, t.rotation, "tree", 10 + i, cfg, { flags: shadow }));
    }
  });

  // Wände
  const M = CONST.WALL_MOVEMENT_TYPES;
  const S = CONST.WALL_SENSE_TYPES;
  const walls = plan.walls.map((c) => ({
    c,
    move: cfg.wallMove ? M.NORMAL : M.NONE,
    sight: cfg.wallSight ? S.NORMAL : S.NONE,
    light: cfg.wallSight ? S.NORMAL : S.NONE,
    sound: S.NONE,
    flags
  }));

  // Regionen (schwieriges Gelände)
  const regions = [];
  const areas = cfg.undergrowth === "patches" ? plan.patches.map((p) => p.pts) : cfg.undergrowth === "everywhere" ? [plan.rectPts] : [];
  if (cfg.logDifficult && cfg.undergrowth !== "everywhere") areas.push(...plan.logs.map((l) => l.pts));
  if (areas.length) {
    const behavior = difficultBehavior(cfg.difficulty);
    const shapes = areas.map((points) => ({ type: "polygon", points, hole: false }));
    for (const ex of plan.exclusions) shapes.push({ type: "polygon", points: ex.pts, hole: true });
    regions.push({
      name: "Unterholz (Waldgenerator)",
      color: "#7a8f2a",
      shapes,
      elevation: { bottom: null, top: null },
      behaviors: behavior ? [behavior] : [],
      flags
    });
    if (!behavior) plan.warnings?.push("Kein Verhalten für schwieriges Gelände gefunden, Region ohne Wirkung erstellt.");
  }

  return { tiles, walls, regions };
}

/* -------------------------------------------- */
/*  Erzeugen und Entfernen                      */
/* -------------------------------------------- */

export async function createChunked(scene, type, data, label) {
  for (let i = 0; i < data.length; i += CHUNK) {
    ui.notifications.info(`Waldgenerator: ${label} ${i + 1}–${Math.min(i + CHUNK, data.length)} von ${data.length} …`);
    await scene.createEmbeddedDocuments(type, data.slice(i, i + CHUNK));
  }
}

export async function removeGenerated(scene) {
  let total = 0;
  for (const type of ["Tile", "Wall", "Region"]) {
    const ids = scene.getEmbeddedCollection(type).filter((d) => d.getFlag(MODULE_ID, "generated")).map((d) => d.id);
    for (let i = 0; i < ids.length; i += CHUNK) await scene.deleteEmbeddedDocuments(type, ids.slice(i, i + CHUNK));
    total += ids.length;
  }
  return total;
}

export async function applyPlan(scene, plan, cfg) {
  if (cfg.replaceExisting) await removeGenerated(scene);
  const { tiles, walls, regions } = plan.docs;
  await createChunked(scene, "Tile", tiles, "Tiles");
  if (walls.length) await createChunked(scene, "Wall", walls, "Wände");
  if (regions.length) await scene.createEmbeddedDocuments("Region", regions);
}
