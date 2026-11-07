import { MODULE_ID } from "./config.js";
import { imageHull } from "./cover.js";

const ASSET_DIR = `modules/${MODULE_ID}/assets/`;
const IMAGE_RX = /\.(webp|png|jpe?g|svg|avif|gif)$/i;
const SIZE_RX = /[_\-\s](\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?=[_\-\s.]|$)/gi;

/** Eingebaute Platzhalter, damit das Modul ohne eigene Grafiken testbar ist. */
const BUILTIN = {
  "builtin:laub": [
    { src: `${ASSET_DIR}laub-krone.svg`, sx: 4, sy: 4 },
    { src: `${ASSET_DIR}laub-krone-herbst.svg`, sx: 4, sy: 4 }
  ],
  "builtin:nadel": [{ src: `${ASSET_DIR}nadel-krone.svg`, sx: 3, sy: 3 }],
  "builtin:stamm": [{ src: `${ASSET_DIR}stamm.svg` }],
  "builtin:busch": [{ src: `${ASSET_DIR}busch.svg` }]
};
export const BUILTIN_NAMES = Object.keys(BUILTIN);

/* -------------------------------------------- */
/*  Ordner lesen (lokal und The Forge)          */
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

/** Bilddateien eines Ordners, ohne Unterordner, sortiert (damit der Seed reproduzierbar bleibt). */
async function listImages(path) {
  const result = await browse(path.replace(/\/+$/, ""));
  return (result.files ?? []).filter((f) => IMAGE_RX.test(f.split("?")[0])).sort();
}

/* -------------------------------------------- */
/*  Dateinamen                                  */
/* -------------------------------------------- */

function fileName(src) {
  const clean = decodeURIComponent(src.split("?")[0]);
  return clean.substring(clean.lastIndexOf("/") + 1);
}

/** Liest die Feldgröße aus FA-Dateinamen wie "Tree_Green_A1_6x6.webp". */
export function parseSize(src) {
  const matches = [...fileName(src).replace(IMAGE_RX, "").matchAll(SIZE_RX)];
  if (!matches.length) return {};
  const m = matches[matches.length - 1];
  return { sx: Number(m[1]), sy: Number(m[2]) };
}

/**
 * Baut aus "Stump_Ashen_B*, Stump_Dark_B*" einen Test für Dateinamen.
 * "*" steht für beliebig viele Zeichen, "?" für genau eins. Leer = alles.
 */
export function filterMatcher(filter) {
  const patterns = String(filter ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!patterns.length) return () => true;
  const rxs = patterns.map((p) => {
    const body = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${body}$`, "i");
  });
  return (src) => {
    const name = fileName(src);
    const stem = name.replace(IMAGE_RX, "");
    return rxs.some((rx) => rx.test(name) || rx.test(stem));
  };
}

/* -------------------------------------------- */
/*  Laden                                       */
/* -------------------------------------------- */

/** Liest Ordner und merkt sich das Ergebnis, damit z.B. der Stumps-Ordner nur einmal gelesen wird. */
class FolderCache {
  #folders = new Map();

  constructor(warnings) {
    this.warnings = warnings;
  }

  /** @returns {Promise<{src: string, sx?: number, sy?: number}[]>} */
  async files(folder, filter) {
    folder = String(folder ?? "").trim();
    if (!folder) return [];
    if (BUILTIN[folder]) return BUILTIN[folder].map((e) => ({ ...e }));
    if (!this.#folders.has(folder)) {
      this.#folders.set(
        folder,
        listImages(folder).catch((err) => {
          console.error(`${MODULE_ID} | Ordner konnte nicht gelesen werden: ${folder}`, err);
          this.warnings.push(`Ordner nicht lesbar: ${folder}`);
          return [];
        })
      );
    }
    const match = filterMatcher(filter);
    const files = (await this.#folders.get(folder)).filter(match).map((src) => ({ src, ...parseSize(src) }));
    if (!files.length) this.warnings.push(`Keine Bilder gefunden: ${folder}${filter ? ` (Filter: ${filter})` : ""}`);
    return files;
  }
}

async function loadSets(cache, sets) {
  const out = [];
  for (const set of sets) {
    if (!set.folder || set.weight <= 0) continue;
    const files = await cache.files(set.folder, set.filter);
    if (files.length) out.push({ ...set, files });
  }
  return out;
}

/**
 * Lädt alle Bilder gemäß Einstellungen.
 * @returns {Promise<{crowns: object[], trunks: object[], logs: object[], bushes: object[], warnings: string[]}>}
 */
export async function loadAssets(cfg) {
  const warnings = [];
  const cache = new FolderCache(warnings);

  let crowns = await loadSets(cache, cfg.crowns);
  // Im Modus "nur Stämme" bestimmen die Kronen nur die Baumgröße; ohne Kronen-Ordner reicht eine Standardgröße
  if (!crowns.length && cfg.crownMode === "trunks") {
    crowns = [{ weight: 1, baseSize: 5, scaleMin: 0.8, scaleMax: 1.2, files: [{ src: null }] }];
  }

  let trunks = [];
  if (cfg.crownMode !== "flat") {
    trunks = await loadSets(cache, cfg.trunks);
    if (!trunks.length && (cfg.placeholderTrunks || cfg.crownMode === "trunks")) {
      trunks = [{ weight: 1, files: BUILTIN["builtin:stamm"] }];
    }
  }

  const logs = cfg.logDensity > 0 ? await cache.files(cfg.logFolder, cfg.logFilter) : [];
  // Hitbox: Umriss der sichtbaren Pixel jedes Totholz-Bildes, für Cover-Wände und Klettern
  if (cfg.logCover) {
    await Promise.all(logs.map(async (l) => (l.hull = await imageHull(l.src))));
  }

  let bushes = [];
  if (cfg.undergrowth !== "none" && cfg.bushDensity > 0) {
    bushes = await cache.files(cfg.bushFolder, cfg.bushFilter);
    if (!bushes.length) bushes = BUILTIN["builtin:busch"].map((e) => ({ ...e }));
  }

  return { crowns, trunks, logs, bushes, warnings };
}
