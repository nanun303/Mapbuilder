/**
 * Reine Platzierungslogik: berechnet aus Szenenmaßen, Einstellungen und Assets einen "Plan"
 * (Bäume, Büsche, Ausschlussflächen, Unterholz-Flecken, Wände). Erzeugt selbst keine Dokumente.
 */

/* -------------------------------------------- */
/*  Zufall                                      */
/* -------------------------------------------- */

function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reproduzierbarer Zufallsgenerator: gleicher Seed ergibt den gleichen Wald. */
export class Random {
  constructor(seed) {
    this.next = mulberry32(hashString(String(seed)));
    this.noiseSeed = hashString(`${seed}#noise`) | 0;
  }

  float(min = 0, max = 1) {
    return min + (max - min) * this.next();
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted(items, weightOf) {
    const total = items.reduce((s, i) => s + Math.max(0, weightOf(i)), 0);
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (const item of items) {
      r -= Math.max(0, weightOf(item));
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }
}

/* -------------------------------------------- */
/*  Rauschen (für natürliche Baumgruppen)       */
/* -------------------------------------------- */

function lattice(ix, iy, seed) {
  let h = (seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Zwei Oktaven Value-Noise, auf ca. 0..1 gestreckt. */
function forestNoise(x, y, seed) {
  const n = valueNoise(x, y, seed) * 0.65 + valueNoise(x * 2.3, y * 2.3, seed + 1013) * 0.35;
  return Math.min(1, Math.max(0, (n - 0.5) * 2.2 + 0.5));
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/* -------------------------------------------- */
/*  Poisson-Disc-Sampling (Bridson)             */
/* -------------------------------------------- */

const MAX_POINTS = 40000;

export function poissonDisc(x0, y0, w, h, r, rng, k = 30) {
  if (w <= 0 || h <= 0 || r <= 0) return [];
  const cell = r / Math.SQRT2;
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  const r2 = r * r;

  const add = (x, y) => {
    const i = pts.length;
    pts.push([x, y]);
    active.push(i);
    grid[Math.floor((y - y0) / cell) * gw + Math.floor((x - x0) / cell)] = i;
  };

  add(x0 + rng.next() * w, y0 + rng.next() * h);
  while (active.length && pts.length < MAX_POINTS) {
    const ai = Math.floor(rng.next() * active.length);
    const [px, py] = pts[active[ai]];
    let found = false;
    for (let j = 0; j < k; j++) {
      const a = rng.next() * Math.PI * 2;
      const d = r * (1 + rng.next());
      const x = px + Math.cos(a) * d;
      const y = py + Math.sin(a) * d;
      if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) continue;
      const gx = Math.floor((x - x0) / cell);
      const gy = Math.floor((y - y0) / cell);
      let ok = true;
      for (let yy = Math.max(0, gy - 2); ok && yy <= Math.min(gh - 1, gy + 2); yy++) {
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
          const n = grid[yy * gw + xx];
          if (n < 0) continue;
          const dx = pts[n][0] - x;
          const dy = pts[n][1] - y;
          if (dx * dx + dy * dy < r2) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        add(x, y);
        found = true;
        break;
      }
    }
    if (!found) {
      active[ai] = active[active.length - 1];
      active.pop();
    }
  }
  return pts;
}

/* -------------------------------------------- */
/*  Geometrie                                   */
/* -------------------------------------------- */

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function boundsOf(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function makeArea(kind, pts) {
  return { kind, pts: pts.map(Math.round), bounds: boundsOf(pts) };
}

function blobPolygon(cx, cy, r, rng, n = 20, jitter = 0.22) {
  const radii = Array.from({ length: n }, () => 1 + (rng.next() * 2 - 1) * jitter);
  const pts = [];
  for (let i = 0; i < n; i++) {
    // Nachbarradien mitteln, damit die Kontur weich bleibt
    const rr = r * (radii[(i + n - 1) % n] + 2 * radii[i] + radii[(i + 1) % n]) / 4;
    const a = (i / n) * Math.PI * 2;
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  return pts;
}

function rotatePoints(pts, cx, cy, deg) {
  if (!deg) return pts;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - cx;
    const dy = pts[i + 1] - cy;
    out.push(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
  }
  return out;
}

/** Ersatz-Umriss (Anteile des Bildes), falls der Bildumriss nicht gelesen werden kann. */
export const DEFAULT_HULL = [0.1, 0.15, 0.9, 0.15, 0.9, 0.85, 0.1, 0.85];

/**
 * Überträgt einen Umriss in Bild-Anteilen (0..1) auf die Karte.
 * @param {number[]} hull  [u0, v0, u1, v1, ...]
 */
export function hullToWorld(hull, cx, cy, w, h, rotation = 0, flipX = false, flipY = false) {
  const a = (rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out = [];
  for (let i = 0; i < hull.length; i += 2) {
    const u = flipX ? 1 - hull[i] : hull[i];
    const v = flipY ? 1 - hull[i + 1] : hull[i + 1];
    const lx = (u - 0.5) * w;
    const ly = (v - 0.5) * h;
    out.push(Math.round(cx + lx * cos - ly * sin), Math.round(cy + lx * sin + ly * cos));
  }
  return out;
}

/** Wandelt ein Zeichnungs-Dokument (Rechteck, Ellipse, Polygon, Freihand) in ein Polygon um. */
export function drawingToPolygon(d) {
  const s = d.shape ?? {};
  const w = s.width ?? 0;
  const h = s.height ?? 0;
  let pts;
  switch (s.type) {
    case "r":
      pts = [0, 0, w, 0, w, h, 0, h];
      break;
    case "e":
      pts = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        pts.push(w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2);
      }
      break;
    case "p":
    case "f":
      pts = Array.from(s.points ?? []);
      break;
    default:
      return null;
  }
  if (pts.length < 6) return null;
  pts = rotatePoints(pts, w / 2, h / 2, d.rotation ?? 0);
  return pts.map((v, i) => v + (i % 2 ? d.y : d.x));
}

/** Gewundener Weg quer über die Karte, als Polygon (gepufferte Linie). */
function pathPolygon(rect, widthPx, grid, rng) {
  const horizontal = rng.next() < 0.5;
  const length = horizontal ? rect.w : rect.h;
  const span = horizontal ? rect.h : rect.w;
  const step = grid * 2;
  let pos = span * (0.2 + rng.next() * 0.6);
  let dir = (rng.next() - 0.5) * 0.6;
  const line = [];
  for (let t = -step; t <= length + step; t += step) {
    dir = Math.min(0.7, Math.max(-0.7, dir + (rng.next() - 0.5) * 0.5));
    pos = Math.min(span * 0.92, Math.max(span * 0.08, pos + Math.sin(dir) * step));
    line.push(horizontal ? [rect.x + t, rect.y + pos] : [rect.x + pos, rect.y + t]);
  }
  const left = [];
  const right = [];
  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const hw = (widthPx / 2) * (0.85 + rng.next() * 0.3);
    left.push(line[i][0] + nx * hw, line[i][1] + ny * hw);
    right.push([line[i][0] - nx * hw, line[i][1] - ny * hw]);
  }
  return left.concat(right.reverse().flat());
}

function inAnyArea(x, y, areas, pad) {
  for (const a of areas) {
    const b = a.bounds;
    if (x < b.x - pad || x > b.x + b.w + pad || y < b.y - pad || y > b.y + b.h + pad) continue;
    if (pointInPolygon(x, y, a.pts)) return true;
    if (pad > 0) {
      if (pointInPolygon(x + pad, y, a.pts) || pointInPolygon(x - pad, y, a.pts)) return true;
      if (pointInPolygon(x, y + pad, a.pts) || pointInPolygon(x, y - pad, a.pts)) return true;
    }
  }
  return false;
}

/* -------------------------------------------- */
/*  Planung                                     */
/* -------------------------------------------- */

/**
 * @param {object} dims       Szenenmaße (sceneX, sceneY, sceneWidth, sceneHeight, size)
 * @param {object} cfg        Einstellungen aus dem Fenster
 * @param {object} assets     { crowns: [{weight, baseSize, scaleMin, scaleMax, files}], trunks: [{weight, files}], logs: [], bushes: [] }
 * @param {object[]} drawings Zeichnungen der Szene (für Freiflächen)
 */
export function planForest(dims, cfg, assets, drawings = []) {
  const rng = new Random(cfg.seed);
  const g = dims.size;
  const rect = { x: dims.sceneX, y: dims.sceneY, w: dims.sceneWidth, h: dims.sceneHeight };
  const rectPts = [rect.x, rect.y, rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h];

  // Freiflächen: Zeichnungen, zufällige Lichtungen, Wege
  const exclusions = [];
  if (cfg.useDrawings) {
    for (const d of drawings) {
      const pts = drawingToPolygon(d);
      if (pts) exclusions.push(makeArea("drawing", pts));
    }
  }
  for (let i = 0; i < cfg.clearings; i++) {
    const r = (rng.float(cfg.clearingMin, Math.max(cfg.clearingMin, cfg.clearingMax)) / 2) * g;
    const cx = rect.x + r + rng.next() * Math.max(0, rect.w - 2 * r);
    const cy = rect.y + r + rng.next() * Math.max(0, rect.h - 2 * r);
    exclusions.push(makeArea("clearing", blobPolygon(cx, cy, r, rng)));
  }
  for (let i = 0; i < cfg.paths; i++) {
    exclusions.push(makeArea("path", pathPolygon(rect, cfg.pathWidth * g, g, rng)));
  }

  // Bäume: Krone aus einem Kronen-Set, Stamm aus einem Stamm-Set (beides nach Gewicht gewählt)
  const trees = [];
  if (assets.crowns.length) {
    const margin = Math.max(0, cfg.edgeMargin) * g;
    const pts = poissonDisc(rect.x + margin, rect.y + margin, rect.w - 2 * margin, rect.h - 2 * margin, cfg.minDist * g, rng);
    const density = cfg.density / 100;
    const clump = cfg.clumping / 100;
    const noiseCell = 8 * g;
    for (const [x, y] of pts) {
      const n = forestNoise(x / noiseCell, y / noiseCell, rng.noiseSeed);
      const keep = density * ((1 - clump) + clump * 2 * smoothstep(0.3, 0.7, n));
      if (rng.next() > keep) continue;
      if (inAnyArea(x, y, exclusions, g * 0.5)) continue;
      const set = rng.weighted(assets.crowns, (s) => s.weight);
      const crown = rng.pick(set.files);
      const scale = rng.float(set.scaleMin, Math.max(set.scaleMin, set.scaleMax));
      const w = (crown.sx ?? set.baseSize) * scale * g;
      const h = (crown.sy ?? crown.sx ?? set.baseSize) * scale * g;
      const size = Math.max(w, h);
      const rotation = cfg.randomRotation ? Math.round(rng.float(0, 360)) : 0;
      const tree = { x, y, w, h, rotation, size, crown: crown.src, trunk: null, trunkSize: 0, trunkRotation: 0 };
      if (assets.trunks.length) {
        tree.trunk = rng.pick(rng.weighted(assets.trunks, (s) => s.weight).files).src;
        tree.trunkSize = Math.max(g * 1.2, size * cfg.trunkRatio);
        tree.trunkRotation = Math.round(rng.float(0, 360));
      }
      trees.push(tree);
    }
  }

  // Totholz: liegende Stämme zwischen den Bäumen
  const logs = [];
  if (assets.logs?.length && cfg.logDensity > 0) {
    const target = Math.round((cfg.logDensity * (rect.w / g) * (rect.h / g)) / 100);
    for (let attempt = 0; logs.length < target && attempt < target * 20; attempt++) {
      const file = rng.pick(assets.logs);
      const scale = cfg.logScale * rng.float(0.9, 1.1);
      const w = (file.sx ?? 3) * scale * g;
      const h = (file.sy ?? 1) * scale * g;
      const x = rect.x + rng.next() * rect.w;
      const y = rect.y + rng.next() * rect.h;
      const reach = Math.max(w, h) / 2;
      if (x - reach < rect.x || y - reach < rect.y || x + reach > rect.x + rect.w || y + reach > rect.y + rect.h) continue;
      if (inAnyArea(x, y, exclusions, reach * 0.5)) continue;
      // nicht auf einen Stamm und nicht auf anderes Totholz legen
      if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < Math.max(t.trunkSize, g) / 2 + reach * 0.6)) continue;
      if (logs.some((l) => Math.hypot(l.x - x, l.y - y) < (l.reach + reach) * 0.8)) continue;
      const rotation = Math.round(rng.float(0, 360));
      // Umriss aus den sichtbaren Pixeln des Bildes (Hitbox), sonst ein Rechteck mit Rand
      const hull = file.hull ?? DEFAULT_HULL;
      logs.push({ x, y, w, h, rotation, reach, src: file.src, hull, pts: hullToWorld(hull, x, y, w, h, rotation) });
    }
  }

  // Unterholz-Flecken und Büsche
  const patches = [];
  if (cfg.undergrowth === "patches") {
    for (let i = 0; i < cfg.patchCount; i++) {
      const r = (rng.float(cfg.patchMin, Math.max(cfg.patchMin, cfg.patchMax)) / 2) * g;
      const cx = rect.x + rng.next() * rect.w;
      const cy = rect.y + rng.next() * rect.h;
      patches.push(makeArea("patch", blobPolygon(cx, cy, r, rng, 22, 0.3)));
    }
  }
  const bushes = [];
  if (cfg.undergrowth !== "none" && assets.bushes.length && cfg.bushDensity > 0) {
    const areas = cfg.undergrowth === "patches" ? patches : [makeArea("all", rectPts)];
    const dens = (cfg.bushDensity / 100) * (cfg.undergrowth === "everywhere" ? 0.35 : 1);
    for (const area of areas) {
      const b = area.bounds;
      for (const [x, y] of poissonDisc(b.x, b.y, b.w, b.h, cfg.bushSize * g * 0.8, rng)) {
        if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) continue;
        if (!pointInPolygon(x, y, area.pts)) continue;
        if (rng.next() > dens) continue;
        if (inAnyArea(x, y, exclusions, 0)) continue;
        const entry = rng.pick(assets.bushes);
        const s = (entry.sx ?? cfg.bushSize) * rng.float(0.8, 1.25) * g;
        bushes.push({ x, y, w: s, h: s, rotation: Math.round(rng.float(0, 360)), src: entry.src });
      }
    }
  }

  // Wände um dicke Stämme
  const walls = [];
  if (cfg.walls && (cfg.wallMove || cfg.wallSight)) {
    const sides = Math.max(3, Math.round(cfg.wallSides));
    for (const t of trees) {
      if (t.size < cfg.wallMinSize * g) continue;
      // Der eigentliche Stamm füllt etwa die Hälfte des Stamm-Bildes, der Rest sind Wurzeln
      const r = Math.max(g * 0.15, (t.trunkSize || t.size * cfg.trunkRatio) * 0.22);
      const off = rng.next() * Math.PI * 2;
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = off + (i / sides) * Math.PI * 2;
        pts.push([Math.round(t.x + Math.cos(a) * r), Math.round(t.y + Math.sin(a) * r)]);
      }
      for (let i = 0; i < sides; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % sides];
        walls.push([p[0], p[1], q[0], q[1]]);
      }
    }
  }

  return { rect, rectPts, exclusions, trees, logs, patches, bushes, walls };
}
