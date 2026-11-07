/**
 * Zeichnet eine Vorschau des Plans auf die Karte, ohne Dokumente zu erzeugen.
 * Funktioniert mit PIXI v7 (beginFill/drawCircle) und PIXI v8 (circle().fill()).
 */

let previewGraphics = null;

function fillCircle(g, x, y, r, color, alpha) {
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
    g.drawCircle(x, y, r);
    g.endFill();
  } else g.circle(x, y, r).fill({ color, alpha });
}

function fillPolygon(g, pts, color, alpha) {
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
    g.drawPolygon(pts);
    g.endFill();
  } else g.poly(pts).fill({ color, alpha });
}

function strokePolygon(g, pts, color, alpha, width) {
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.drawPolygon(pts);
    g.lineStyle(0);
  } else g.poly(pts, true).stroke({ color, alpha, width });
}

function strokeLine(g, c, color, alpha, width) {
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.moveTo(c[0], c[1]);
    g.lineTo(c[2], c[3]);
    g.lineStyle(0);
  } else g.moveTo(c[0], c[1]).lineTo(c[2], c[3]).stroke({ color, alpha, width });
}

export function clearPreview() {
  if (!previewGraphics) return;
  previewGraphics.parent?.removeChild(previewGraphics);
  previewGraphics.destroy({ children: true });
  previewGraphics = null;
}

export function drawPreview(plan, cfg) {
  clearPreview();
  if (!canvas.ready) return;
  const g = new PIXI.Graphics();
  const lw = Math.max(4, canvas.dimensions.size / 12);

  strokePolygon(g, plan.rectPts, 0xffffff, 0.6, lw);
  for (const p of plan.patches) fillPolygon(g, p.pts, 0xc8b400, 0.25);
  for (const ex of plan.exclusions) {
    fillPolygon(g, ex.pts, ex.kind === "path" ? 0xb07a3a : 0xff4040, 0.25);
    strokePolygon(g, ex.pts, 0xff4040, 0.8, lw);
  }
  for (const b of plan.bushes) fillCircle(g, b.x, b.y, b.w / 2, 0x9acd32, 0.5);
  if (cfg.crownMode !== "trunks") for (const t of plan.trees) fillCircle(g, t.x, t.y, t.size / 2, 0x2e8b57, 0.35);
  for (const t of plan.trees) fillCircle(g, t.x, t.y, Math.max(canvas.dimensions.size * 0.2, (t.size * cfg.trunkRatio) / 2), 0x5b3a1a, 0.9);
  for (const w of plan.walls) strokeLine(g, w, 0xff00ff, 0.9, lw / 2);

  const layer = canvas.controls ?? canvas.interface ?? canvas.stage;
  layer.addChild(g);
  previewGraphics = g;
}
