import { MODULE_ID } from "./config.js";

const ASSET_DIR = `modules/${MODULE_ID}/assets/`;
const IMAGE_RX = /\.(webp|png|jpe?g|svg|avif|gif)$/i;
const SIZE_RX = /[_\-\s](\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?=[_\-\s.]|$)/gi;

/** Eingebaute Platzhalter, damit das Modul ohne eigene Grafiken testbar ist. */
export const BUILTIN = {
  "builtin:laub": [
    { crown: `${ASSET_DIR}laub-krone.svg`, trunk: `${ASSET_DIR}stamm.svg`, placeholderTrunk: true, sx: 4, sy: 4 },
    { crown: `${ASSET_DIR}laub-krone-herbst.svg`, trunk: `${ASSET_DIR}stamm.svg`, placeholderTrunk: true, sx: 4, sy: 4 }
  ],
  "builtin:nadel": [
    { crown: `${ASSET_DIR}nadel-krone.svg`, trunk: `${ASSET_DIR}stamm.svg`, placeholderTrunk: true, sx: 3, sy: 3 }
  ]
};
export const PLACEHOLDER_TRUNK = `${ASSET_DIR}stamm.svg`;
export const PLACEHOLDER_BUSH = `${ASSET_DIR}busch.svg`;

/* -------------------------------------------- */
/*  Ordner durchsuchen (lokal und The Forge)    */
/* -------------------------------------------- */

function filePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

function isForge() {
  return !!globalThis.ForgeVTT?.usingTheForge;
}

function resolveSource(path) {
  const forgeUrl = path.match(/^https?:\/\/assets\.forge-vtt\.com\/[^/]+\/(.*)$/i);
  if (forgeUrl) return { source: "forgevtt", target: decodeURIComponent(forgeUrl[1]) };
  if (isForge() && !/^(modules|systems)\//.test(path)) return { source: "forgevtt", target: path };
  return { source: "data", target: path };
}

async function browse(path) {
  const { source, target } = resolveSource(path);
  try {
    return await filePicker().browse(source, target);
  } catch (err) {
    if (source === "data" && isForge()) return filePicker().browse("forgevtt", target);
    throw err;
  }
}

/** Liefert alle Bilddateien eines Ordners inkl. Unterordnern (sortiert, damit der Seed reproduzierbar bleibt). */
export async function scanFolder(path, maxDepth = 6) {
  const files = [];
  const seen = new Set();
  const queue = [[path.replace(/\/+$/, ""), 0]];
  while (queue.length) {
    const [dir, depth] = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const result = await browse(dir);
    for (const f of result.files ?? []) if (IMAGE_RX.test(f.split("?")[0])) files.push(f);
    if (depth < maxDepth) for (const d of result.dirs ?? []) queue.push([d, depth + 1]);
  }
  return files.sort();
}

/* -------------------------------------------- */
/*  Dateinamen auswerten                        */
/* -------------------------------------------- */

function baseName(src) {
  const clean = decodeURIComponent(src.split("?")[0]);
  return clean.substring(clean.lastIndexOf("/") + 1).replace(IMAGE_RX, "");
}

/** Liest die Feldgröße aus FA-Dateinamen wie "Tree_Oak_A1_6x6.webp". */
export function parseSize(src) {
  const matches = [...baseName(src).matchAll(SIZE_RX)];
  if (!matches.length) return {};
  const m = matches[matches.length - 1];
  return { sx: Number(m[1]), sy: Number(m[2]) };
}

function wordRegex(words) {
  const list = String(words ?? "")
    .split(",")
    .map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
  if (!list.length) return null;
  return new RegExp(`(^|[_\\-\\s])(${list.join("|")})(?=$|[_\\-\\s\\d])`, "i");
}

function pairKey(name, rxs) {
  let key = name.toLowerCase().replace(SIZE_RX, "");
  for (const rx of rxs) if (rx) key = key.replace(new RegExp(rx.source, "gi"), "$1");
  return key.replace(/[_\-\s]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Ordnet Kronen- und Stamm-Bilder einander zu. Bilder ohne Stichwort gelten als ganze Bäume
 * und werden als Krone verwendet.
 * @returns {{crown: string|null, trunk: string|null, placeholderTrunk: boolean, sx?: number, sy?: number}[]}
 */
export function pairTreeFiles(files, crownWords, trunkWords) {
  const crownRx = wordRegex(crownWords);
  const trunkRx = wordRegex(trunkWords);
  const groups = new Map();
  for (const src of files) {
    const name = baseName(src);
    const role = crownRx?.test(name) ? "crown" : trunkRx?.test(name) ? "trunk" : "full";
    const key = pairKey(name, [crownRx, trunkRx]);
    if (!groups.has(key)) groups.set(key, { crown: [], trunk: [], full: [] });
    groups.get(key)[role].push(src);
  }

  const entries = [];
  for (const g of groups.values()) {
    g.crown.forEach((crown, i) => {
      const trunk = g.trunk.length ? g.trunk[i % g.trunk.length] : null;
      entries.push({ crown, trunk, placeholderTrunk: false, ...parseSize(crown) });
    });
    if (!g.crown.length) for (const trunk of g.trunk) entries.push({ crown: null, trunk, placeholderTrunk: false, ...parseSize(trunk) });
    for (const full of g.full) entries.push({ crown: full, trunk: null, placeholderTrunk: false, ...parseSize(full) });
  }
  return entries;
}

/* -------------------------------------------- */
/*  Alles laden                                 */
/* -------------------------------------------- */

/**
 * Lädt alle Baumarten und Büsche gemäß Einstellungen.
 * @returns {Promise<{species: object[], bushes: object[], warnings: string[]}>}
 */
export async function loadAssets(cfg) {
  const warnings = [];
  const species = [];
  for (const sp of cfg.species) {
    const folder = String(sp.folder ?? "").trim();
    let entries = [];
    if (!folder) continue;
    if (BUILTIN[folder]) entries = BUILTIN[folder].map((e) => ({ ...e }));
    else {
      try {
        entries = pairTreeFiles(await scanFolder(folder), cfg.crownWords, cfg.trunkWords);
      } catch (err) {
        console.error(`${MODULE_ID} | Ordner konnte nicht gelesen werden: ${folder}`, err);
        warnings.push(`Ordner nicht lesbar: ${folder}`);
      }
    }
    entries = usableEntries(entries, cfg);
    if (!entries.length) warnings.push(`Keine passenden Bilder in: ${folder}`);
    species.push({ ...sp, entries });
  }

  let bushes = [];
  if (cfg.undergrowth !== "none") {
    const folder = String(cfg.bushFolder ?? "").trim();
    if (folder) {
      try {
        bushes = (await scanFolder(folder)).map((src) => ({ src, ...parseSize(src) }));
      } catch (err) {
        console.error(`${MODULE_ID} | Busch-Ordner konnte nicht gelesen werden: ${folder}`, err);
        warnings.push(`Busch-Ordner nicht lesbar: ${folder}`);
      }
    }
    if (!bushes.length) bushes = [{ src: PLACEHOLDER_BUSH }];
  }
  return { species, bushes, warnings };
}

/** Filtert Einträge, die im gewählten Kronen-Modus nutzbar sind, und ergänzt Platzhalter-Stämme. */
function usableEntries(entries, cfg) {
  const out = [];
  for (const e of entries) {
    if (cfg.crownMode === "trunks") {
      if (e.trunk) out.push(e);
      else out.push({ ...e, trunk: PLACEHOLDER_TRUNK, placeholderTrunk: true });
      continue;
    }
    if (!e.crown) continue;
    if (!e.trunk && cfg.placeholderTrunks) out.push({ ...e, trunk: PLACEHOLDER_TRUNK, placeholderTrunk: true });
    else out.push(e);
  }
  return out;
}
