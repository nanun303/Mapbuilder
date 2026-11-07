/**
 * Klettern über Cover-Objekte: Steht ein Token an einem Cover-Tile und der Spieler klickt darauf,
 * würfelt das Token Athletik (Klettern) und landet bei Erfolg auf der anderen Seite.
 */
import { MODULE_ID } from "./config.js";
import { pointInPolygon } from "./generator.js";
import { coverData, tileFootprint } from "./cover.js";

/* -------------------------------------------- */
/*  Geometrie                                   */
/* -------------------------------------------- */

export function distanceToPolygon(px, py, poly) {
  if (pointInPolygon(px, py, poly)) return 0;
  let min = Infinity;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2];
    const ay = poly[i * 2 + 1];
    const bx = poly[((i + 1) % n) * 2];
    const by = poly[((i + 1) % n) * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    min = Math.min(min, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return min;
}

/**
 * Verschiebung (in ganzen Feldern), die ein Token von seiner Seite des Hindernisses auf die andere bringt.
 * Die Längsachse des Hindernisses wird aus dem Umriss bestimmt; das Token behält seine Position entlang der Achse.
 * @returns {{dx: number, dy: number} | null}  null, wenn kein Platz gefunden wurde
 */
export function crossingDelta(poly, cx, cy, tokenHalf, grid) {
  const n = poly.length / 2;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += poly[i * 2] / n;
    my += poly[i * 2 + 1] / n;
  }
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = poly[i * 2] - mx;
    const dy = poly[i * 2 + 1] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  let thick = 0;
  for (let i = 0; i < n; i++) thick = Math.max(thick, Math.abs((poly[i * 2] - mx) * nx + (poly[i * 2 + 1] - my) * ny));

  const s = (cx - mx) * nx + (cy - my) * ny;
  const side = s >= 0 ? 1 : -1;
  const target = -side * (thick + tokenHalf + grid * 0.05);
  const clear = (dx, dy) => {
    const px = cx + dx;
    const py = cy + dy;
    const ns = (px - mx) * nx + (py - my) * ny;
    return Math.sign(ns) === -side && Math.abs(ns) >= thick + tokenHalf * 0.5 && distanceToPolygon(px, py, poly) >= tokenHalf * 0.5;
  };

  let dx = Math.round((nx * (target - s)) / grid) * grid;
  let dy = Math.round((ny * (target - s)) / grid) * grid;
  const stepX = Math.abs(nx) > 0.38 ? Math.sign(-side * nx) * grid : 0;
  const stepY = Math.abs(ny) > 0.38 ? Math.sign(-side * ny) * grid : 0;
  for (let i = 0; i < 4 && !clear(dx, dy); i++) {
    dx += stepX;
    dy += stepY;
  }
  return clear(dx, dy) ? { dx, dy } : null;
}

/* -------------------------------------------- */
/*  Klick auf ein Cover-Objekt                  */
/* -------------------------------------------- */

const CLICK_TOLERANCE = 6;
let pending = null;

function toWorld(event) {
  if (typeof canvas.canvasCoordinatesFromClient === "function") {
    return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  }
  const rect = event.target.getBoundingClientRect();
  return canvas.stage.worldTransform.applyInverse({ x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function findCoverTile(point) {
  let best = null;
  const tolerance = canvas.grid.size * 0.15;
  for (const tile of canvas.scene.tiles) {
    if (!coverData(tile) || (tile.hidden && !game.user.isGM)) continue;
    const poly = tileFootprint(tile);
    if (!poly || distanceToPolygon(point.x, point.y, poly) > tolerance) continue;
    if (!best || tile.elevation > best.elevation || (tile.elevation === best.elevation && tile.sort > best.sort)) best = tile;
  }
  return best;
}

async function rollClimb(actor, dc, label) {
  if (!(dc > 0)) return 3; // kein Wurf nötig
  const stat = actor.skills?.athletics ?? actor.getStatistic?.("athletics");
  if (!stat) {
    ui.notifications.warn(`${actor.name} hat keinen Athletik-Wert.`);
    return null;
  }
  const roll = await stat.roll({ dc: { value: dc }, extraRollOptions: ["action:climb"], label });
  if (!roll) return null;
  return roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess ?? null;
}

async function moveToken(token, { dx, dy }) {
  const doc = token.document;
  const dest = { x: doc.x + dx, y: doc.y + dy };
  if (typeof doc.move === "function") {
    try {
      await doc.move([{ ...dest, action: "climb" }], { constrainOptions: { ignoreWalls: true, ignoreCost: true } });
      return;
    } catch (err) {
      console.warn(`${MODULE_ID} | move() fehlgeschlagen, setze Position direkt`, err);
    }
  }
  await doc.update(dest);
}

async function tryClimb(token, point) {
  const tile = findCoverTile(point);
  if (!tile) return;
  // Klick auf ein Token hat Vorrang
  if (canvas.tokens.placeables.some((t) => t.visible && t.bounds?.contains(point.x, point.y))) return;

  const grid = canvas.grid.size;
  const poly = tileFootprint(tile);
  const center = token.center;
  const half = Math.max(token.w, token.h) / 2;
  if (distanceToPolygon(center.x, center.y, poly) > half + grid * 0.6) {
    ui.notifications.warn(`${token.name} steht nicht direkt am Hindernis.`);
    return;
  }
  const delta = crossingDelta(poly, center.x, center.y, half, grid);
  if (!delta) {
    ui.notifications.warn("Auf der anderen Seite ist kein Platz.");
    return;
  }
  const actor = token.actor;
  if (!actor) return;
  const { dc } = coverData(tile);
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Klettern", icon: "fa-solid fa-person-hiking" },
    content: `<p><strong>${token.name}</strong> klettert über das Hindernis.</p>${dc > 0 ? `<p>Athletik (Klettern) gegen SG ${dc}.</p>` : ""}`
  });
  if (!ok) return;

  const degree = await rollClimb(actor, dc, `Klettern (SG ${dc})`);
  if (degree === null) return;
  if (degree >= 2) {
    await moveToken(token, delta);
    token.control({ releaseOthers: true });
  } else if (degree === 0) {
    ui.notifications.info(`${token.name} rutscht ab und liegt am Boden.`);
    await actor.increaseCondition?.("prone");
  } else {
    ui.notifications.info(`${token.name} schafft es nicht hinüber.`);
  }
}

function onPointerDown(event) {
  pending = null;
  if (event.button !== 0 || !canvas.ready || !canvas.tokens?.active) return;
  const controlled = canvas.tokens.controlled;
  if (controlled.length !== 1 || !controlled[0].isOwner) return;
  pending = { x: event.clientX, y: event.clientY, token: controlled[0] };
}

function onPointerUp(event) {
  const p = pending;
  pending = null;
  if (!p || event.button !== 0) return;
  if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > CLICK_TOLERANCE) return;
  tryClimb(p.token, toWorld(event)).catch((err) => {
    console.error(`${MODULE_ID} | Klettern fehlgeschlagen`, err);
    ui.notifications.error(`Klettern: ${err.message}`);
  });
}

export function registerClimb() {
  Hooks.on("canvasReady", () => {
    const view = canvas.app?.canvas ?? canvas.app?.view;
    if (!view || view.dataset.kmwClimb) return;
    view.dataset.kmwClimb = "1";
    view.addEventListener("pointerdown", onPointerDown, true);
    view.addEventListener("pointerup", onPointerUp, true);
  });
}
