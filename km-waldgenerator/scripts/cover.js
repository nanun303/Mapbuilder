/**
 * Cover-Objekte: Tiles mit einem Umriss (Hitbox), um den Wände gelegt werden.
 * Die Wände blockieren Bewegung, aber keine Sicht. PF2e Toolbelt (Auto Cover) wertet solche
 * Wände standardmäßig als Cover. Spieler können ein Cover-Objekt per Klick überklettern (climb.js).
 *
 * Tile-Flag "km-waldgenerator.cover": { hull: number[] (Bild-Anteile 0..1), dc, blockSight, outline, src }
 * Wand-Flag "km-waldgenerator.coverOf": ID des zugehörigen Tiles
 */
import { MODULE_ID } from "./config.js";
import { DEFAULT_HULL, hullToWorld } from "./generator.js";

const MAX_HULL_POINTS = 10;
const SAMPLE_SIZE = 128;
/** Anteil der dicksten Stelle, ab dem Teile als "dünn" (Ast, Wurzel) gelten und nicht zur Hitbox gehören. */
const OPEN_FACTOR = 0.5;

/* -------------------------------------------- */
/*  Umriss aus Bildpixeln                       */
/* -------------------------------------------- */

const hullCache = new Map();

/** Konvexer Umriss der sichtbaren Pixel eines Bildes, in Anteilen der Bildgröße. Null bei Fehler. */
export function imageHull(src) {
  if (!src) return Promise.resolve(null);
  if (!hullCache.has(src)) {
    hullCache.set(
      src,
      computeHull(src).catch((err) => {
        console.warn(`${MODULE_ID} | Umriss konnte nicht gelesen werden: ${src}`, err);
        return null;
      })
    );
  }
  return hullCache.get(src);
}

async function loadImage(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  return img;
}

async function computeHull(src) {
  const img = await loadImage(src);
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cnv = document.createElement("canvas");
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 128 ? 1 : 0;
  const hull = bodyHull(mask, w, h);
  return hull ? hull.flatMap(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]) : null;
}

/**
 * Hülle des Hauptkörpers einer Maske (Stamm, Schnittfläche), ohne dünne Teile wie Äste und Wurzeln:
 * Pixel, die näher als r am Rand liegen, fallen weg (r = Anteil der dicksten Stelle). Vom größten
 * verbleibenden Stück wird die konvexe Hülle gebildet und wieder um r aufgeweitet.
 * Exportiert für Tests; arbeitet auf einer 0/1-Maske in Pixeln.
 */
export function bodyHull(mask, w, h, openFactor = OPEN_FACTOR) {
  const dist = distanceTransform(mask, w, h);
  let maxD = 0;
  for (const d of dist) maxD = Math.max(maxD, d);
  if (maxD === 0) return null;
  const r = maxD >= 3 ? openFactor * maxD : 0;

  // größtes zusammenhängendes Stück, das dicker als 2r ist
  const core = largestComponent(dist, w, h, r);
  const pts = [];
  for (const i of core) {
    const x = i % w;
    const y = (i - x) / w;
    pts.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
  }
  if (pts.length < 3) return null;
  let hull = convexHull(pts);
  if (r > 0) {
    // um r aufweiten: Kreis um jede Ecke, davon wieder die Hülle
    const grown = [];
    for (const [x, y] of hull) {
      for (let k = 0; k < 12; k++) grown.push([x + Math.cos((k * Math.PI) / 6) * r, y + Math.sin((k * Math.PI) / 6) * r]);
    }
    hull = convexHull(grown);
  }
  return simplifyHull(hull, MAX_HULL_POINTS);
}

/** Abstand jedes deckenden Pixels zum nächsten transparenten Pixel oder Bildrand (Chamfer 3-4), in Pixeln. */
function distanceTransform(mask, w, h) {
  const INF = 1e9;
  const d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

/** Pixel-Indizes des größten zusammenhängenden Bereichs mit Abstand > r. */
function largestComponent(dist, w, h, r) {
  const seen = new Uint8Array(w * h);
  let best = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || dist[start] <= r) continue;
    const comp = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const x = i % w;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (j < 0 || j >= w * h || seen[j] || dist[j] <= r) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Entfernt so lange die Ecke mit der kleinsten Dreiecksfläche, bis höchstens maxPoints übrig sind. */
function simplifyHull(hull, maxPoints) {
  const pts = hull.slice();
  const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (pts.length > maxPoints) {
    let min = Infinity;
    let idx = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = area(pts[(i + pts.length - 1) % pts.length], pts[i], pts[(i + 1) % pts.length]);
      if (a < min) {
        min = a;
        idx = i;
      }
    }
    pts.splice(idx, 1);
  }
  return pts;
}

/** Rechteckiger Umriss mit Rand in Prozent. */
export function rectHull(insetPercent) {
  const i = Math.min(45, Math.max(0, insetPercent)) / 100;
  return [i, i, 1 - i, i, 1 - i, 1 - i, i, 1 - i];
}

/* -------------------------------------------- */
/*  Tile-Geometrie                              */
/* -------------------------------------------- */

/** Mittelpunkt, Größe und Drehung eines Tiles, für v13 (x/y = Ecke) und v14 (x/y = Anker). */
export function tileGeometry(doc) {
  const w = Math.abs(doc.width);
  const h = Math.abs(doc.height);
  const rotation = doc.rotation ?? 0;
  let cx = doc.x + w / 2;
  let cy = doc.y + h / 2;
  if (game.release.generation >= 14) {
    const ox = (0.5 - (doc.anchorX ?? 0.5)) * w;
    const oy = (0.5 - (doc.anchorY ?? 0.5)) * h;
    const a = (rotation * Math.PI) / 180;
    cx = doc.x + ox * Math.cos(a) - oy * Math.sin(a);
    cy = doc.y + ox * Math.sin(a) + oy * Math.cos(a);
  }
  const flipX = (doc.texture?.scaleX ?? 1) < 0;
  const flipY = (doc.texture?.scaleY ?? 1) < 0;
  return { cx, cy, w, h, rotation, flipX, flipY };
}

export function coverData(doc) {
  return doc.getFlag(MODULE_ID, "cover") ?? null;
}

/** Umriss eines Cover-Tiles in Kartenkoordinaten. */
export function tileFootprint(doc) {
  const cover = coverData(doc);
  if (!cover) return null;
  const g = tileGeometry(doc);
  return hullToWorld(cover.hull?.length >= 6 ? cover.hull : DEFAULT_HULL, g.cx, g.cy, g.w, g.h, g.rotation, g.flipX, g.flipY);
}

/* -------------------------------------------- */
/*  Wände                                       */
/* -------------------------------------------- */

/** Wand-Daten entlang eines Umrisses. */
export function coverWalls(points, cover, extraFlags = {}) {
  const M = CONST.WALL_MOVEMENT_TYPES;
  const S = CONST.WALL_SENSE_TYPES;
  const sense = cover.blockSight ? S.NORMAL : S.NONE;
  const walls = [];
  const n = points.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const c = [points[i * 2], points[i * 2 + 1], points[j * 2], points[j * 2 + 1]];
    if (c[0] === c[2] && c[1] === c[3]) continue;
    walls.push({ c, move: M.NORMAL, sight: sense, light: sense, sound: S.NONE, flags: { [MODULE_ID]: { ...extraFlags } } });
  }
  return walls;
}

function wallsOf(scene, tileIds) {
  const ids = new Set(tileIds);
  return scene.walls.filter((w) => ids.has(w.getFlag(MODULE_ID, "coverOf"))).map((w) => w.id);
}

/** Erstellt die Wände für mehrere Cover-Tiles neu (alte werden entfernt). */
export async function rebuildCoverWalls(scene, tiles, extraFlags = {}) {
  const old = wallsOf(scene, tiles.map((t) => t.id));
  if (old.length) await scene.deleteEmbeddedDocuments("Wall", old, { kmwCover: true });
  const data = [];
  for (const t of tiles) {
    const cover = coverData(t);
    const pts = tileFootprint(t);
    if (cover && pts) data.push(...coverWalls(pts, cover, { ...extraFlags, coverOf: t.id }));
  }
  for (let i = 0; i < data.length; i += 500) await scene.createEmbeddedDocuments("Wall", data.slice(i, i + 500), { kmwCover: true });
  return data.length;
}

/**
 * Macht Tiles zu Cover-Objekten.
 * @param {object} opts { dc, blockSight, outline: "auto"|"rect", inset }
 */
export async function applyCover(scene, tiles, opts) {
  const updates = [];
  for (const t of tiles) {
    const src = t.texture?.src;
    let hull = null;
    if (opts.outline === "auto") hull = await imageHull(src);
    if (!hull) hull = rectHull(opts.outline === "auto" ? 10 : opts.inset);
    updates.push({
      _id: t.id,
      [`flags.${MODULE_ID}.cover`]: { hull, dc: opts.dc, blockSight: !!opts.blockSight, outline: opts.outline, src }
    });
  }
  await scene.updateEmbeddedDocuments("Tile", updates, { kmwCover: true });
  return rebuildCoverWalls(scene, tiles.map((t) => scene.tiles.get(t.id)).filter(Boolean));
}

export async function removeCover(scene, tiles) {
  const ids = tiles.map((t) => t.id);
  const walls = wallsOf(scene, ids);
  if (walls.length) await scene.deleteEmbeddedDocuments("Wall", walls, { kmwCover: true });
  for (const t of tiles) await t.unsetFlag(MODULE_ID, "cover");
  return walls.length;
}

/* -------------------------------------------- */
/*  Wände aktuell halten                        */
/* -------------------------------------------- */

const GEOMETRY_KEYS = ["x", "y", "width", "height", "rotation", "anchorX", "anchorY", "texture"];

export function registerCoverHooks() {
  // Verschobene, gedrehte oder skalierte Cover-Tiles bekommen neue Wände
  Hooks.on("updateTile", async (doc, changes, options, userId) => {
    if (userId !== game.user.id || options.kmwCover || !coverData(doc)) return;
    if (!GEOMETRY_KEYS.some((k) => k in changes)) return;
    const cover = coverData(doc);
    // Neues Bild: Umriss neu lesen, falls er automatisch bestimmt wurde
    if (cover.outline === "auto" && doc.texture?.src !== cover.src) {
      const hull = (await imageHull(doc.texture.src)) ?? rectHull(10);
      await doc.update({ [`flags.${MODULE_ID}.cover`]: { ...cover, hull, src: doc.texture.src } }, { kmwCover: true });
    }
    await rebuildCoverWalls(doc.parent, [doc], doc.getFlag(MODULE_ID, "generated") ? { generated: true } : {});
  });

  // Kopierte Cover-Tiles (Strg+C/V) bekommen eigene Wände
  Hooks.on("createTile", async (doc, options, userId) => {
    if (userId !== game.user.id || options.kmwCover || !coverData(doc)) return;
    await rebuildCoverWalls(doc.parent, [doc], doc.getFlag(MODULE_ID, "generated") ? { generated: true } : {});
  });

  // Gelöschte Cover-Tiles nehmen ihre Wände mit
  Hooks.on("deleteTile", async (doc, options, userId) => {
    if (userId !== game.user.id || options.kmwCover || options.kmwBulk || !coverData(doc)) return;
    const walls = wallsOf(doc.parent, [doc.id]);
    if (walls.length) await doc.parent.deleteEmbeddedDocuments("Wall", walls, { kmwCover: true });
  });
}
