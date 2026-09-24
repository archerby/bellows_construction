/*
 * Экспорт: чертёж (SVG), развёртка (SVG / DXF / печать 1:1 плиткой),
 * плашки (STL, раскладка на стол принтера), ZIP-архив без сжатия.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geometry.js'));
  else root.BellowsExport = factory(root.BellowsGeometry);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Geo) {
  'use strict';
  const U = Geo.util;
  const { add, sub, mul, dot, len, norm, bbox, polyArea, polyCentroid } = U;

  const fmt = (n) => {
    const r = Math.round(n * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
  };
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const COLORS = {
    cut: '#111111',
    mountain: '#d0342c',
    valley: '#1f5fbf',
    diag: '#1d8a4a',
    corner: '#9a9a9a',
    stiffFill: '#f4b860',
    stiffStroke: '#a8641a',
    flap: '#eeeeee',
    dim: '#333333',
    text: '#111111',
  };
  const DASH = { M: '4 1.2 0.8 1.2', V: '2.2 1.2' };

  const pathOf = (poly, closed = true) =>
    'M' + poly.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join(' L') + (closed ? ' Z' : '');
  const lineEl = (a, b, attrs) =>
    `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" ${attrs}/>`;
  const textEl = (x, y, s, size, extra = '') =>
    `<text x="${fmt(x)}" y="${fmt(y)}" font-family="Arial, Helvetica, sans-serif" font-size="${fmt(size)}" fill="${COLORS.text}" ${extra}>${esc(s)}</text>`;

  // =====================================================================
  //  Развёртка
  // =====================================================================
  function patternBody(model, opt) {
    const P = model.pattern, d = model.derived;
    const o = [];
    if (P.flap) o.push(`<path d="${pathOf(P.flap)}" fill="${COLORS.flap}" stroke="none"/>`);
    o.push('<g id="corners">');
    for (const c of P.cornerLines) o.push(lineEl(c.a, c.b, `stroke="${COLORS.corner}" stroke-width="0.2" stroke-dasharray="0.6 0.8"`));
    o.push(lineEl(P.seamLine.a, P.seamLine.b, `stroke="${COLORS.corner}" stroke-width="0.25" stroke-dasharray="3 1"`));
    o.push('</g>');
    if (opt.stiffeners) {
      o.push('<g id="stiffeners">');
      for (const s of P.stiffeners) {
        o.push(`<path d="${pathOf(s.poly)}" fill="${COLORS.stiffFill}" fill-opacity="0.55" stroke="${COLORS.stiffStroke}" stroke-width="0.15"/>`);
      }
      o.push('</g>');
    }
    o.push('<g id="folds">');
    for (const l of P.foldLines) {
      o.push(lineEl(l.a, l.b, `stroke="${l.type === 'M' ? COLORS.mountain : COLORS.valley}" stroke-width="0.25" stroke-dasharray="${DASH[l.type]}"`));
    }
    for (const l of P.flapGuides) o.push(lineEl(l.a, l.b, `stroke="${COLORS.corner}" stroke-width="0.15" stroke-dasharray="1 1"`));
    o.push('</g><g id="diagonals">');
    for (const l of P.diagonals) o.push(lineEl(l.a, l.b, `stroke="${COLORS.diag}" stroke-width="0.25"`));
    o.push('</g>');
    o.push(`<path id="outline" d="${pathOf(P.outline)}" fill="none" stroke="${COLORS.cut}" stroke-width="0.35" stroke-linejoin="round"/>`);

    if (opt.labels) {
      const fs = Math.max(1.2, Math.min(3, d.hAct * 0.28));
      o.push('<g id="labels">');
      if (opt.stiffeners) {
        for (const s of P.stiffeners) {
          const c = polyCentroid(s.poly);
          o.push(textEl(c[0], c[1] + fs * 0.35, s.id, fs, 'text-anchor="middle" fill-opacity="0.8"'));
        }
      }
      const big = Math.max(3, Math.min(7, Math.min(P.width, P.height) / 40));
      const small = Math.max(2, Math.min(4, Math.min(model.params.collarF, model.params.collarR) * 0.45));
      for (const L of P.labels) {
        const pn = model.panels[L.panel];
        const ang = (Math.atan2(L.axis[1], L.axis[0]) * 180) / Math.PI - 90;
        const rotAttr = (pt) => `text-anchor="middle" transform="rotate(${fmt(ang)} ${fmt(pt[0])} ${fmt(pt[1])})"`;
        o.push(textEl(L.center[0], L.center[1], `${pn.name} — ${pn.title}`, big, `${rotAttr(L.center)} font-weight="bold" fill-opacity="0.45"`));
        if (L.panel === 1 || L.panel === 2) {
          if (model.params.collarF >= 4) o.push(textEl(L.front[0], L.front[1] + small * 0.35, 'ПЕРЕД (объектив)', small, rotAttr(L.front)));
          if (model.params.collarR >= 4) o.push(textEl(L.rear[0], L.rear[1] + small * 0.35, 'ЗАД (кассета)', small, rotAttr(L.rear)));
        }
      }
      o.push('</g>');
    }
    return o.join('\n');
  }

  function patternLegend(model, x, y, width) {
    const d = model.derived, p = model.params;
    const o = [];
    const fs = 3.2;
    const items = [
      [`stroke="${COLORS.cut}" stroke-width="0.35"`, 'контур — резать'],
      [`stroke="${COLORS.mountain}" stroke-width="0.35" stroke-dasharray="${DASH.M}"`, 'горная складка (гребень наружу)'],
      [`stroke="${COLORS.valley}" stroke-width="0.35" stroke-dasharray="${DASH.V}"`, 'долинная складка (гребень внутрь)'],
      [`stroke="${COLORS.diag}" stroke-width="0.35"`, 'угловые диагонали 45°'],
      [`stroke="${COLORS.corner}" stroke-width="0.35" stroke-dasharray="0.6 0.8"`, 'рёбра (не сгибать)'],
    ];
    let cx = x, cy = y + 4;
    const colW = Math.max(62, (width - 10) / 3);
    items.forEach((it, idx) => {
      o.push(lineEl([cx, cy - 1], [cx + 12, cy - 1], it[0]));
      o.push(textEl(cx + 14, cy, it[1], fs));
      cx += colW;
      if ((idx + 1) % 3 === 0) { cx = x; cy += 6; }
    });
    o.push(`<rect x="${fmt(cx)}" y="${fmt(cy - 3)}" width="12" height="4" fill="${COLORS.stiffFill}" fill-opacity="0.55" stroke="${COLORS.stiffStroke}" stroke-width="0.15"/>`);
    o.push(textEl(cx + 14, cy, `плашки ${p.tStiff} мм (${d.stiffenerCount} шт.)`, fs));
    cy += 8;
    // масштабная линейка 100 мм — для проверки масштаба при печати
    const sx = x, sy = cy;
    o.push(`<rect x="${fmt(sx)}" y="${fmt(sy - 2)}" width="100" height="2" fill="none" stroke="#000" stroke-width="0.2"/>`);
    for (let i = 0; i < 10; i += 2) o.push(`<rect x="${fmt(sx + i * 10)}" y="${fmt(sy - 2)}" width="10" height="2" fill="#000"/>`);
    o.push(textEl(sx + 102, sy, '100 мм — проверьте масштаб после печати', fs));
    o.push(textEl(sx, sy + 6,
      `Складок: ${d.N} на сторону · шаг ${f1(d.hAct)} мм · зазор ${f1(p.hingeGap)} мм · манжеты ${f1(p.collarF)}/${f1(p.collarR)} мм · клапан ${f1(p.flap)} мм · габарит ${f1(model.pattern.width)} × ${f1(model.pattern.height)} мм`, fs));
    return o.join('\n');
  }

  function patternLayout(model) {
    const P = model.pattern;
    const m = 10, titleH = 10, legendH = 32;
    return { m, titleH, legendH, W: Math.max(P.width, 200) + 2 * m, H: P.height + 2 * m + titleH + legendH };
  }

  function patternInner(model, opt) {
    const P = model.pattern, L = patternLayout(model);
    const d = model.derived, p = model.params;
    const o = [];
    o.push(`<rect x="0" y="0" width="${fmt(L.W)}" height="${fmt(L.H)}" fill="#ffffff"/>`);
    o.push(textEl(L.m, L.m + 4, `Развёртка меха: рамки ${f1(d.mid.fW)}×${f1(d.mid.fH)} → ${f1(d.mid.rW)}×${f1(d.mid.rH)} мм, растяжение до ${f1(p.maxExt)} мм`, 4.2, 'font-weight="bold"'));
    o.push(`<g transform="translate(${fmt(L.m)} ${fmt(L.m + L.titleH)})">${patternBody(model, opt)}</g>`);
    if (opt.legend) o.push(patternLegend(model, L.m, L.m + L.titleH + P.height + 6, L.W - 2 * L.m));
    return o.join('\n');
  }

  function patternSVG(model, options) {
    const opt = Object.assign({ stiffeners: true, labels: true, legend: true, physical: true }, options);
    const L = patternLayout(model);
    const size = opt.physical ? `width="${fmt(L.W)}mm" height="${fmt(L.H)}mm" ` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${size}viewBox="0 0 ${fmt(L.W)} ${fmt(L.H)}">\n${patternInner(model, opt)}\n</svg>\n`;
  }

  // =====================================================================
  //  Печать 1:1 плиткой
  // =====================================================================
  const PAPER = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };

  function tilePlan(model, paper, pageMargin, overlap) {
    const L = patternLayout(model);
    const [pw0, ph0] = PAPER[paper] || PAPER.A4;
    const opts = [false, true].map((landscape) => {
      const pw = (landscape ? ph0 : pw0) - 2 * pageMargin, ph = (landscape ? pw0 : ph0) - 2 * pageMargin;
      const cols = Math.max(1, Math.ceil((L.W - overlap) / (pw - overlap)));
      const rows = Math.max(1, Math.ceil((L.H - overlap) / (ph - overlap)));
      return { landscape, pw, ph, cols, rows, pages: cols * rows };
    });
    const best = opts[0].pages <= opts[1].pages ? opts[0] : opts[1];
    return Object.assign(best, { paper, pageMargin, overlap, W: L.W, H: L.H });
  }

  function printTilesHTML(model, options) {
    const opt = Object.assign({ paper: 'A4', pageMargin: 8, overlap: 10, stiffeners: true, labels: true }, options);
    const plan = tilePlan(model, opt.paper, opt.pageMargin, opt.overlap);
    const inner = patternInner(model, { stiffeners: opt.stiffeners, labels: opt.labels, legend: true });
    const { pw, ph, cols, rows, overlap } = plan;
    const pages = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * (pw - overlap), y0 = r * (ph - overlap);
        const marks = [];
        // зона перекрытия
        const st = 'stroke="#888" stroke-width="0.2" stroke-dasharray="2 2" fill="none"';
        if (c > 0) marks.push(lineEl([x0 + overlap, y0], [x0 + overlap, y0 + ph], st));
        if (r > 0) marks.push(lineEl([x0, y0 + overlap], [x0 + pw, y0 + overlap], st));
        // крестики совмещения
        const cross = (x, y) => lineEl([x - 3, y], [x + 3, y], 'stroke="#000" stroke-width="0.2"') + lineEl([x, y - 3], [x, y + 3], 'stroke="#000" stroke-width="0.2"');
        marks.push(cross(x0 + overlap / 2, y0 + overlap / 2), cross(x0 + pw - overlap / 2, y0 + overlap / 2),
          cross(x0 + overlap / 2, y0 + ph - overlap / 2), cross(x0 + pw - overlap / 2, y0 + ph - overlap / 2));
        marks.push(`<rect x="${fmt(x0 + pw - 34)}" y="${fmt(y0 + ph - 7)}" width="33" height="6" fill="#fff" fill-opacity="0.85"/>`);
        marks.push(textEl(x0 + pw - 33, y0 + ph - 2.6, `лист ${r + 1}-${c + 1} (${rows}×${cols})`, 3));
        pages.push(`<div class="print-page"><svg xmlns="http://www.w3.org/2000/svg" width="${fmt(pw)}mm" height="${fmt(ph)}mm" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(pw)} ${fmt(ph)}">${inner}${marks.join('')}</svg></div>`);
      }
    }
    const pageCss = `@page { size: ${opt.paper} ${plan.landscape ? 'landscape' : 'portrait'}; margin: ${opt.pageMargin}mm; }`;
    return { html: pages.join('\n'), css: pageCss, plan };
  }

  // =====================================================================
  //  Чертёж
  // =====================================================================
  function arrowHead(tip, dir, size) {
    const n = [-dir[1], dir[0]];
    const b = sub(tip, mul(dir, size));
    const p1 = add(b, mul(n, size * 0.3)), p2 = sub(b, mul(n, size * 0.3));
    return `<path d="${pathOf([tip, p1, p2])}" fill="${COLORS.dim}"/>`;
  }

  /** Размерная линия между точками a и b, смещённая на off по левой нормали. */
  function dim(a, b, off, text, fs) {
    const dir = norm(sub(b, a));
    const n = [dir[1], -dir[0]];
    const a2 = add(a, mul(n, off)), b2 = add(b, mul(n, off));
    const ext = (p, q) => lineEl(add(p, mul(n, Math.sign(off) * 1)), add(q, mul(n, Math.sign(off) * 1.5)), `stroke="${COLORS.dim}" stroke-width="0.15"`);
    const o = [ext(a, a2), ext(b, b2)];
    o.push(lineEl(a2, b2, `stroke="${COLORS.dim}" stroke-width="0.18"`));
    const as = Math.min(fs * 0.9, len(sub(b2, a2)) / 4);
    o.push(arrowHead(a2, mul(dir, -1), as), arrowHead(b2, dir, as));
    const mid = mul(add(a2, b2), 0.5);
    let ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    if (ang > 90.01 || ang < -89.99) ang += 180;
    const tp = add(mid, mul(n, 0));
    o.push(`<text x="${fmt(tp[0])}" y="${fmt(tp[1] - fs * 0.35)}" font-family="Arial, Helvetica, sans-serif" font-size="${fmt(fs)}" text-anchor="middle" fill="${COLORS.dim}" transform="rotate(${fmt(ang)} ${fmt(tp[0])} ${fmt(tp[1])})">${esc(text)}</text>`);
    return o.join('');
  }

  function drawingSVG(model, options) {
    const opt = Object.assign({ physical: true }, options);
    const p = model.params, d = model.derived;
    const mesh = Geo.buildMesh3D(model, p.maxExt);
    const rings = mesh.rings;
    const E = mesh.ext;
    const maxY = Math.max(...rings.map((r) => r.Y)), maxX = Math.max(...rings.map((r) => r.X));
    const fs = Math.max(3, Math.min(7, (E + 2 * Math.max(maxX, maxY)) / 110));
    const frameT = Math.max(4, fs * 1.2), frameOver = Math.max(8, fs * 2.5);
    const m = 12 + fs * 3;

    const o = [];
    const outW = Math.max(d.outerFront.w, d.outerRear.w), outH = Math.max(d.outerFront.h, d.outerRear.h);
    // Габариты видов
    const viewH1 = 2 * (maxY + frameOver);
    const viewH2 = 2 * (maxX + frameOver);
    const x0 = m + frameT; // начало меха по оси
    const y1 = m + fs * 2 + viewH1 / 2; // ось вида сбоку
    const y2 = y1 + viewH1 / 2 + fs * 6 + viewH2 / 2; // ось вида сверху
    const endCx = x0 + E + frameT + m + fs * 4 + outW / 2 + 10;
    const endCy = y1;
    const tableX = x0 + E + frameT + m + fs * 2;
    const tableY = endCy + outH / 2 + fs * 8;
    const rowsTable = drawingTable(model, mesh);
    const tableH = rowsTable.length * fs * 1.6 + fs * 2;
    const W = Math.max(endCx + outW / 2 + m + fs * 4, tableX + fs * 60);
    const H = Math.max(y2 + viewH2 / 2 + m + fs * 4, tableY + tableH + m);

    o.push(`<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="#ffffff"/>`);
    o.push(`<rect x="3" y="3" width="${fmt(W - 6)}" height="${fmt(H - 6)}" fill="none" stroke="#000" stroke-width="0.5"/>`);

    // Профили видов сбоку (по Y) и сверху (по X)
    const view = (cy, key, frontSize, rearSize, title) => {
      const top = rings.map((r) => [x0 + r.z, cy - r[key]]);
      const bot = rings.map((r) => [x0 + r.z, cy + r[key]]);
      const g = [];
      g.push(textEl(x0, cy - Math.max(frontSize, rearSize) / 2 - frameOver - fs * 1.2, title, fs * 1.1, 'font-weight="bold"'));
      g.push(`<path d="${pathOf(top.concat(bot.slice().reverse()))}" fill="#3a3a3e" fill-opacity="0.12" stroke="none"/>`);
      // поперечные линии складок (видимые рёбра боковой стороны)
      for (let i = 1; i < rings.length - 1; i++) g.push(lineEl(top[i], bot[i], 'stroke="#666" stroke-width="0.12"'));
      g.push(`<path d="${pathOf(top, false)}" fill="none" stroke="#111" stroke-width="0.35" stroke-linejoin="round"/>`);
      g.push(`<path d="${pathOf(bot, false)}" fill="none" stroke="#111" stroke-width="0.35" stroke-linejoin="round"/>`);
      g.push(lineEl([x0 - frameT - 6, cy], [x0 + E + frameT + 6, cy], 'stroke="#555" stroke-width="0.15" stroke-dasharray="8 1.5 1.5 1.5"'));
      // рамки
      g.push(`<rect x="${fmt(x0 - frameT)}" y="${fmt(cy - frontSize / 2 - frameOver)}" width="${fmt(frameT)}" height="${fmt(frontSize + 2 * frameOver)}" fill="#bbb" stroke="#000" stroke-width="0.3"/>`);
      g.push(`<rect x="${fmt(x0 + E)}" y="${fmt(cy - rearSize / 2 - frameOver)}" width="${fmt(frameT)}" height="${fmt(rearSize + 2 * frameOver)}" fill="#bbb" stroke="#000" stroke-width="0.3"/>`);
      // размеры
      g.push(dim([x0, cy + Math.max(frontSize, rearSize) / 2 + frameOver], [x0 + E, cy + Math.max(frontSize, rearSize) / 2 + frameOver], -fs * 2.2, `${f1(E)} (макс. растяжение)`, fs));
      g.push(dim([x0 - frameT, cy + frontSize / 2], [x0 - frameT, cy - frontSize / 2], -fs * 1.8, f1(frontSize), fs));
      g.push(dim([x0 + E + frameT, cy - rearSize / 2], [x0 + E + frameT, cy + rearSize / 2], -fs * 1.8, f1(rearSize), fs));
      return g.join('\n');
    };
    o.push(view(y1, 'Y', d.mid.fH, d.mid.rH, 'Вид сбоку (растянут)'));
    o.push(view(y2, 'X', d.mid.fW, d.mid.rW, 'Вид сверху (растянут)'));
    o.push(textEl(x0 - frameT, y2 + viewH2 / 2 + fs * 0.5, 'передняя рамка (объектив)', fs * 0.8));
    o.push(textEl(x0 + E + frameT, y2 + viewH2 / 2 + fs * 0.5, 'задняя рамка (кассета)', fs * 0.8, 'text-anchor="end"'));

    // Вид сзади
    const rect = (w, h, attrs) => `<rect x="${fmt(endCx - w / 2)}" y="${fmt(endCy - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" ${attrs}/>`;
    o.push(textEl(endCx - outW / 2, endCy - outH / 2 - fs * 3.2, 'Вид со стороны кассеты', fs * 1.1, 'font-weight="bold"'));
    o.push(rect(d.outerRear.w, d.outerRear.h, 'fill="#3a3a3e" fill-opacity="0.12" stroke="#111" stroke-width="0.25" stroke-dasharray="4 1 1 1"'));
    o.push(rect(d.mid.rW, d.mid.rH, 'fill="none" stroke="#111" stroke-width="0.4"'));
    o.push(rect(d.clearRear.w, d.clearRear.h, 'fill="#fff" stroke="#1f5fbf" stroke-width="0.3" stroke-dasharray="2 1"'));
    o.push(rect(d.mid.fW, d.mid.fH, 'fill="none" stroke="#111" stroke-width="0.3"'));
    o.push(rect(d.clearFront.w, d.clearFront.h, 'fill="none" stroke="#1f5fbf" stroke-width="0.25" stroke-dasharray="2 1"'));
    o.push(lineEl([endCx - outW / 2 - 4, endCy], [endCx + outW / 2 + 4, endCy], 'stroke="#555" stroke-width="0.12" stroke-dasharray="8 1.5 1.5 1.5"'));
    o.push(lineEl([endCx, endCy - outH / 2 - 4], [endCx, endCy + outH / 2 + 4], 'stroke="#555" stroke-width="0.12" stroke-dasharray="8 1.5 1.5 1.5"'));
    const ow = d.outerRear.w, oh = d.outerRear.h;
    o.push(dim([endCx - ow / 2, endCy - oh / 2], [endCx + ow / 2, endCy - oh / 2], fs * 1.6, `${f1(ow)} (сложен)`, fs * 0.85));
    o.push(dim([endCx + ow / 2, endCy - oh / 2], [endCx + ow / 2, endCy + oh / 2], fs * 1.6, `${f1(oh)}`, fs * 0.85));
    o.push(dim([endCx - d.mid.rW / 2, endCy + d.mid.rH / 2], [endCx + d.mid.rW / 2, endCy + d.mid.rH / 2], -fs * 2.4 - (oh - d.mid.rH) / 2, `${f1(d.mid.rW)} (рамка)`, fs * 0.85));
    o.push(dim([endCx - d.clearRear.w / 2, endCy + d.clearRear.h / 2], [endCx + d.clearRear.w / 2, endCy + d.clearRear.h / 2], fs * 1.5, `${f1(d.clearRear.w)} просвет`, fs * 0.75));
    o.push(dim([endCx - d.clearFront.w / 2, endCy - d.clearFront.h / 2], [endCx + d.clearFront.w / 2, endCy - d.clearFront.h / 2], -fs * 1.5, `${f1(d.clearFront.w)} просвет спереди`, fs * 0.7));

    // Таблица
    o.push(textEl(tableX, tableY, 'Параметры меха', fs * 1.1, 'font-weight="bold"'));
    rowsTable.forEach((r, i) => {
      const yy = tableY + fs * 1.9 + i * fs * 1.6;
      o.push(textEl(tableX, yy, r[0], fs * 0.85));
      o.push(textEl(tableX + fs * 34, yy, r[1], fs * 0.85, 'font-weight="bold"'));
      o.push(lineEl([tableX, yy + fs * 0.45], [tableX + fs * 50, yy + fs * 0.45], 'stroke="#ccc" stroke-width="0.1"'));
    });

    const size = opt.physical ? `width="${fmt(W)}mm" height="${fmt(H)}mm" ` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${size}viewBox="0 0 ${fmt(W)} ${fmt(H)}">\n${o.join('\n')}\n</svg>\n`;
  }

  function drawingTable(model) {
    const p = model.params, d = model.derived;
    return [
      ['Рамка передняя (по манжете)', `${f1(d.mid.fW)} × ${f1(d.mid.fH)} мм`],
      ['Рамка задняя (по манжете)', `${f1(d.mid.rW)} × ${f1(d.mid.rH)} мм`],
      ['Просвет в складках, перед', `${f1(d.clearFront.w)} × ${f1(d.clearFront.h)} мм`],
      ['Просвет в складках, зад', `${f1(d.clearRear.w)} × ${f1(d.clearRear.h)} мм`],
      ['Габарит сложенного меха, зад', `${f1(d.outerRear.w)} × ${f1(d.outerRear.h)} мм`],
      ['Макс. растяжение', `${f1(p.maxExt)} мм`],
      ['Мин. расстояние между рамками ≈', `${f1(d.minFrame)} мм`],
      ['Длина развёртки (по оси)', `${f1(d.Lt)} мм`],
      ['Складок (граней) на сторону', `${d.N}`],
      ['Ширина плашки / глубина складки', `${f1(d.hAct)} мм`],
      ['Зазор на сгибе / у диагонали', `${f1(p.hingeGap)} / ${f1(p.cornerGap)} мм`],
      ['Манжеты перед / зад', `${f1(p.collarF)} / ${f1(p.collarR)} мм`],
      ['Плашек всего', `${d.stiffenerCount} шт., ${p.tStiff} мм`],
      ['Материал: наружный / подкладка', `${p.tOuter} / ${p.tLining} мм`],
    ];
  }

  // =====================================================================
  //  DXF (R12, только LINE — читается любой CAD/лазерной программой)
  // =====================================================================
  function dxfPattern(model, options) {
    const opt = Object.assign({ stiffeners: true }, options);
    const P = model.pattern;
    const H = P.height;
    const layers = [['CUT', 7], ['MOUNTAIN', 1], ['VALLEY', 5], ['DIAGONAL', 3], ['EDGE', 8], ['STIFFENERS', 30], ['FLAP_GUIDE', 9]];
    const out = [];
    const w = (code, val) => out.push(String(code), String(val));
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSUNITS'); w(70, 4); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'TABLES');
    w(0, 'TABLE'); w(2, 'LTYPE'); w(70, 1);
    w(0, 'LTYPE'); w(2, 'CONTINUOUS'); w(70, 0); w(3, 'Solid line'); w(72, 65); w(73, 0); w(40, 0.0);
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, layers.length);
    for (const [name, color] of layers) { w(0, 'LAYER'); w(2, name); w(70, 0); w(62, color); w(6, 'CONTINUOUS'); }
    w(0, 'ENDTAB'); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    const line = (a, b, layer) => {
      w(0, 'LINE'); w(8, layer);
      w(10, fmt(a[0])); w(20, fmt(H - a[1])); w(30, 0);
      w(11, fmt(b[0])); w(21, fmt(H - b[1])); w(31, 0);
    };
    const poly = (pts, layer) => { for (let i = 0; i < pts.length; i++) line(pts[i], pts[(i + 1) % pts.length], layer); };
    poly(P.outline, 'CUT');
    for (const l of P.foldLines) line(l.a, l.b, l.type === 'M' ? 'MOUNTAIN' : 'VALLEY');
    for (const l of P.diagonals) line(l.a, l.b, 'DIAGONAL');
    for (const l of P.cornerLines) line(l.a, l.b, 'EDGE');
    line(P.seamLine.a, P.seamLine.b, 'EDGE');
    for (const l of P.flapGuides) line(l.a, l.b, 'FLAP_GUIDE');
    if (opt.stiffeners) for (const s of P.stiffeners) poly(s.poly, 'STIFFENERS');
    w(0, 'ENDSEC'); w(0, 'EOF');
    return out.join('\r\n') + '\r\n';
  }

  // =====================================================================
  //  STL
  // =====================================================================
  function pointInTri(p, a, b, c) {
    const c1 = U.cross(sub(b, a), sub(p, a)), c2 = U.cross(sub(c, b), sub(p, b)), c3 = U.cross(sub(a, c), sub(p, c));
    return c1 >= -1e-12 && c2 >= -1e-12 && c3 >= -1e-12;
  }

  /** Триангуляция простого многоугольника методом отсечения ушей. */
  function triangulate(poly) {
    const n = poly.length;
    if (n < 3) return [];
    let idx = [...Array(n).keys()];
    if (polyArea(poly) < 0) idx.reverse();
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      const m = idx.length;
      let cut = false;
      for (let i = 0; i < m; i++) {
        const a = idx[(i - 1 + m) % m], b = idx[i], c = idx[(i + 1) % m];
        if (U.cross(sub(poly[b], poly[a]), sub(poly[c], poly[b])) <= 1e-12) continue;
        let ok = true;
        for (const j of idx) {
          if (j === a || j === b || j === c) continue;
          if (pointInTri(poly[j], poly[a], poly[b], poly[c])) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push([a, b, c]);
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) tris.push(idx);
    else if (idx.length > 3) for (let i = 1; i < idx.length - 1; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
    return tris;
  }

  /** Экструзия плоских многоугольников на толщину t → список треугольников [[p,q,r],...]. */
  function extrudePolys(polys, t) {
    const tris = [];
    for (let poly of polys) {
      if (polyArea(poly) < 0) poly = poly.slice().reverse();
      const tr = triangulate(poly);
      for (const [a, b, c] of tr) {
        tris.push([[...poly[a], t], [...poly[b], t], [...poly[c], t]]);
        tris.push([[...poly[a], 0], [...poly[c], 0], [...poly[b], 0]]);
      }
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        tris.push([[...p, 0], [...q, 0], [...q, t]]);
        tris.push([[...p, 0], [...q, t], [...p, t]]);
      }
    }
    return tris;
  }

  function stlBinary(tris, header) {
    const buf = new ArrayBuffer(84 + 50 * tris.length);
    const dv = new DataView(buf);
    const h = String(header || 'bellows').slice(0, 79);
    for (let i = 0; i < h.length; i++) dv.setUint8(i, h.charCodeAt(i) & 0x7f);
    dv.setUint32(80, tris.length, true);
    let off = 84;
    for (const [a, b, c] of tris) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = n.map((x) => x / l);
      for (const x of n) { dv.setFloat32(off, x, true); off += 4; }
      for (const p of [a, b, c]) for (const x of p) { dv.setFloat32(off, x, true); off += 4; }
      dv.setUint16(off, 0, true);
      off += 2;
    }
    return new Uint8Array(buf);
  }

  function stiffenersSTL(polys, t, header) {
    return stlBinary(extrudePolys(polys, t), header || `bellows stiffeners t=${t}mm`);
  }

  /** Поверхность меха (без толщины) — для примерки в CAD. */
  function meshSTL(mesh) {
    const tris = [];
    for (const f of mesh.faces) {
      const [a, b, c, d] = f.quad;
      tris.push([a, b, c], [a, c, d]);
    }
    return stlBinary(tris, `bellows surface ext=${fmt(mesh.ext)}mm`);
  }

  // =====================================================================
  //  Раскладка плашек на стол принтера
  // =====================================================================
  function orientStiffener(poly) {
    // самое длинное ребро (линия сгиба) — горизонтально
    let best = 0, bl = -1;
    for (let i = 0; i < poly.length; i++) {
      const l = len(sub(poly[(i + 1) % poly.length], poly[i]));
      if (l > bl) { bl = l; best = i; }
    }
    const d = sub(poly[(best + 1) % poly.length], poly[best]);
    const a = -Math.atan2(d[1], d[0]);
    const c = Math.cos(a), s = Math.sin(a);
    const r = poly.map((p) => [c * p[0] - s * p[1], s * p[0] + c * p[1]]);
    const bb = bbox(r);
    return r.map((p) => [p[0] - bb.minx, p[1] - bb.miny]);
  }

  /**
   * Раскладка по диагонали стола — для плашек длиннее стороны стола.
   * Работаем в повёрнутой системе координат (u — вдоль диагонали, v — поперёк, начало — центр стола):
   * плашки кладутся рядами вдоль диагонали, ряды заполняются от центра к углам.
   * Свободные крайние ряды потом добирают короткими плашками.
   */
  function diagonalPacker(bedW, bedH, gap, margin, rowH) {
    const x0 = margin, y0 = margin, x1 = bedW - margin, y1 = bedH - margin;
    const theta = Math.atan2(y1 - y0, x1 - x0);
    const c = Math.cos(theta), s = Math.sin(theta);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const toR = (p) => { const dx = p[0] - cx, dy = p[1] - cy; return [c * dx + s * dy, -s * dx + c * dy]; };
    const fromR = (p) => [cx + c * p[0] - s * p[1], cy + s * p[0] + c * p[1]];
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(toR);
    // хорда стола на уровне v: интервал u, лежащий внутри стола
    const chord = (v) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        if ((a[1] - v) * (b[1] - v) > 0 || a[1] === b[1]) continue;
        const u = a[0] + ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]);
        lo = Math.min(lo, u);
        hi = Math.max(hi, u);
      }
      return lo <= hi ? [lo, hi] : null;
    };
    const vmin = Math.min(...corners.map((p) => p[1])), vmax = Math.max(...corners.map((p) => p[1]));
    const slots = [];
    for (let k = 0; k < 1000; k++) {
      const cand = k === 0 ? [-rowH / 2] : [-rowH / 2 + k * (rowH + gap), -rowH / 2 - k * (rowH + gap)];
      const inside = cand.filter((v) => v >= vmin && v + rowH <= vmax);
      if (!inside.length) break;
      slots.push(...inside);
    }
    const beds = [];
    const tryPlace = (bed, it) => {
      if (it.h > rowH + 1e-9) return false;
      const flipped = it.poly.map((p) => [it.w - p[0], it.h - p[1]]); // та же плашка, повёрнутая на 180°
      for (let si = 0; si < slots.length; si++) {
        const vOff = slots[si] + (rowH - it.h) / 2;
        for (const poly of [it.poly, flipped]) {
          let lo = bed.cursors[si] === null ? -Infinity : bed.cursors[si] + gap, hi = Infinity, ok = true;
          for (const p of poly) {
            const ch = chord(p[1] + vOff);
            if (!ch) { ok = false; break; }
            lo = Math.max(lo, ch[0] - p[0]);
            hi = Math.min(hi, ch[1] - p[0]);
          }
          if (!ok || lo > hi + 1e-9) continue;
          bed.items.push({
            id: it.s.id, panel: it.s.panel, angle: theta, th: it.h,
            poly: poly.map((p) => fromR([p[0] + lo, p[1] + vOff])),
          });
          bed.cursors[si] = lo + it.w;
          return true;
        }
      }
      return false;
    };
    return {
      beds,
      /** Положить на существующий диагональный стол; allowNew — можно начать новый. */
      place(it, allowNew) {
        if (beds.some((bed) => tryPlace(bed, it))) return true;
        if (!allowNew) return false;
        const bed = { items: [], cursors: slots.map(() => null), diagonal: true };
        if (!tryPlace(bed, it)) return false;
        beds.push(bed);
        return true;
      },
    };
  }

  function packStiffeners(stiffeners, bedW, bedH, gap, margin, options) {
    const opt = Object.assign({ diagonal: true }, options);
    gap = gap === undefined ? 2 : gap;
    margin = margin === undefined ? 3 : margin;
    const beds = [], overflow = [];
    const usableW = bedW - 2 * margin, usableH = bedH - 2 * margin;

    // 1. Ориентация: длинная сторона горизонтально; если не влезает — поворот на 90°.
    const normal = [], long = [];
    for (const s of stiffeners) {
      const base = orientStiffener(s.poly);
      let poly = base;
      let bb = bbox(poly);
      if (bb.w > usableW || bb.h > usableH) {
        poly = poly.map((p) => [bb.h - p[1], p[0]]);
        bb = bbox(poly);
        poly = poly.map((p) => [p[0] - bb.minx, p[1] - bb.miny]);
        bb = bbox(poly);
      }
      if (bb.w > usableW + 1e-6 || bb.h > usableH + 1e-6) {
        const b0 = bbox(base);
        if (opt.diagonal) long.push({ s, poly: base, w: b0.w, h: b0.h });
        else overflow.push(s.id);
      } else {
        const b0 = bbox(base);
        normal.push({ s, poly, bb, diagPoly: base, w: b0.w, h: b0.h });
      }
    }

    // 2. Длинные плашки — по диагонали, от самой длинной к короткой.
    let diag = null, diagonalCount = 0;
    if (long.length) {
      diag = diagonalPacker(bedW, bedH, gap, margin, Math.max(...long.map((i) => i.h)));
      for (const it of long.sort((a, b) => b.w - a.w)) {
        if (diag.place(it, true)) diagonalCount++;
        else overflow.push(it.s.id);
      }
    }

    // 3. Остальные: сначала добираем свободные ряды диагональных столов, потом обычные ряды.
    for (const n of normal) {
      if (diag && diag.place({ s: n.s, poly: n.diagPoly, w: n.w, h: n.h }, false)) continue;
      const { s, poly, bb } = n;
      let placed = false;
      for (const bed of beds) {
        for (const row of bed.rows) {
          if (row.x + bb.w <= bedW - margin + 1e-6 && bb.h <= row.h + 1e-6) {
            bed.items.push({ id: s.id, panel: s.panel, poly: poly.map((p) => [p[0] + row.x, p[1] + row.y]) });
            row.x += bb.w + gap;
            placed = true;
            break;
          }
        }
        if (placed) break;
        if (bed.nextY + bb.h <= bedH - margin + 1e-6) {
          const row = { y: bed.nextY, h: bb.h, x: margin };
          bed.rows.push(row);
          bed.nextY += bb.h + gap;
          bed.items.push({ id: s.id, panel: s.panel, poly: poly.map((p) => [p[0] + row.x, p[1] + row.y]) });
          row.x += bb.w + gap;
          placed = true;
          break;
        }
      }
      if (!placed) {
        const bed = { items: [], rows: [], nextY: margin };
        beds.push(bed);
        const row = { y: margin, h: bb.h, x: margin };
        bed.rows.push(row);
        bed.nextY = margin + bb.h + gap;
        bed.items.push({ id: s.id, panel: s.panel, poly: poly.map((p) => [p[0] + row.x, p[1] + row.y]) });
        row.x += bb.w + gap;
      }
    }
    const out = (diag ? diag.beds.map((b) => ({ items: b.items, diagonal: true })) : [])
      .concat(beds.map((b) => ({ items: b.items })));
    return { beds: out, overflow, diagonalCount, bedW, bedH };
  }

  const PANEL_FILL = ['#f4b860', '#8cc2e8', '#a8d69a', '#e8a3c7'];

  function bedSVG(bed, bedW, bedH, index, options) {
    const opt = Object.assign({ physical: false, labels: true }, options);
    const o = [];
    const m = 6;
    o.push(`<rect x="0" y="0" width="${fmt(bedW + 2 * m)}" height="${fmt(bedH + 2 * m + 8)}" fill="#fff"/>`);
    o.push(textEl(m, 5.5, `Стол ${index + 1}: ${bed.items.length} плашек (${fmt(bedW)}×${fmt(bedH)} мм)${bed.diagonal ? ' — по диагонали' : ''}`, 4, 'font-weight="bold"'));
    // В слайсере начало координат стола — внизу слева; в SVG ось Y направлена вниз, поэтому отражаем.
    o.push(`<g transform="translate(${m} ${m + 8 + bedH}) scale(1 -1)">`);
    o.push(`<rect x="0" y="0" width="${fmt(bedW)}" height="${fmt(bedH)}" fill="#f6f6f6" stroke="#444" stroke-width="0.4"/>`);
    for (const it of bed.items) o.push(`<path d="${pathOf(it.poly)}" fill="${PANEL_FILL[it.panel]}" stroke="#333" stroke-width="0.2"/>`);
    o.push('</g>');
    if (opt.labels) {
      for (const it of bed.items) {
        const c = polyCentroid(it.poly);
        const th = it.th || bbox(it.poly).h;
        const fs = Math.max(1.5, Math.min(4, th * 0.45));
        const x = m + c[0], y = m + 8 + bedH - c[1];
        // ось Y в SVG направлена вниз, поэтому угол подписи меняет знак
        const rot = it.angle ? ` transform="rotate(${fmt((-it.angle * 180) / Math.PI)} ${fmt(x)} ${fmt(y)})"` : '';
        o.push(textEl(x, y + fs * 0.35, it.id, fs, `text-anchor="middle"${rot}`));
      }
    }
    const W = bedW + 2 * m, H = bedH + 2 * m + 8;
    const size = opt.physical ? `width="${fmt(W)}mm" height="${fmt(H)}mm" ` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" ${size}viewBox="0 0 ${fmt(W)} ${fmt(H)}">${o.join('')}</svg>`;
  }

  // =====================================================================
  //  ZIP (метод «store», без сжатия)
  // =====================================================================
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  }

  function makeZip(files) {
    const chunks = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = utf8(f.name);
      const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const total = all.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of all) { out.set(c, pos); pos += c.length; }
    return out;
  }

  // =====================================================================
  //  Пакеты экспорта плашек
  // =====================================================================
  function stiffenerFiles(model, options) {
    const opt = Object.assign({ mode: 'bed', bedW: 220, bedH: 220, gap: 2, margin: 3, diagonal: true }, options);
    const t = model.params.tStiff;
    const S = model.pattern.stiffeners;
    const files = [];
    const note = [
      'Плашки (рёбра жёсткости) для меха крупноформатной камеры',
      `Толщина: ${t} мм — ${Math.round(t / 0.2) === 1 ? 'один слой высотой 0,2 мм' : `${Math.round(t / 0.2)} слоя по 0,2 мм`}.`,
      'Обозначения: буква — сторона меха (A — низ, B — правая, C — верх, D — левая),',
      'число — номер складки от передней рамки (объектива).',
      'Карта расположения на столе — в SVG-файлах рядом с STL.',
      '',
    ];
    if (opt.mode === 'pattern') {
      files.push({ name: 'stiffeners_pattern.stl', data: stiffenersSTL(S.map((s) => flipY(s.poly, model.pattern.height)), t) });
      note.push('stiffeners_pattern.stl — все плашки в точных позициях развёртки (удобно, если развёртка помещается на стол).');
    } else if (opt.mode === 'panels') {
      for (let i = 0; i < 4; i++) {
        // поворачиваем сторону так, чтобы её ось (перед → зад) шла вертикально
        const ax = model.pattern.labels[i].axis;
        const a = Math.PI / 2 - Math.atan2(ax[1], ax[0]);
        const c = Math.cos(a), s = Math.sin(a);
        const polys = S.filter((st) => st.panel === i).map((st) => st.poly.map((p) => [c * p[0] - s * p[1], s * p[0] + c * p[1]]));
        if (!polys.length) continue;
        const bb = bbox([].concat(...polys));
        const moved = polys.map((pl) => pl.map((p) => [p[0] - bb.minx, bb.maxy - p[1]]));
        files.push({ name: `stiffeners_panel_${Geo.PANEL_NAMES[i]}.stl`, data: stiffenersSTL(moved, t) });
      }
      note.push('stiffeners_panel_X.stl — плашки каждой стороны в позициях развёртки.');
    } else {
      const pack = packStiffeners(S, opt.bedW, opt.bedH, opt.gap, opt.margin, { diagonal: opt.diagonal });
      pack.beds.forEach((bed, i) => {
        const n = String(i + 1).padStart(2, '0');
        files.push({ name: `bed_${n}.stl`, data: stiffenersSTL(bed.items.map((it) => it.poly), t) });
        files.push({ name: `bed_${n}_map.svg`, data: bedSVG(bed, opt.bedW, opt.bedH, i, { physical: true }) });
      });
      if (pack.diagonalCount) note.push(`Длинные плашки (${pack.diagonalCount} шт.) уложены по диагонали стола — в заголовке карты такого стола стоит «по диагонали».`);
      if (pack.overflow.length) note.push(`Не поместились на стол: ${pack.overflow.join(', ')}`);
      note.push(`Столов: ${pack.beds.length}, размер ${opt.bedW}×${opt.bedH} мм.`);
    }
    files.push({ name: 'README.txt', data: note.join('\r\n') + '\r\n' });
    return files;
  }

  function flipY(poly, H) {
    return poly.map((p) => [p[0], H - p[1]]);
  }

  return {
    patternSVG, patternInner, patternLayout, printTilesHTML, tilePlan,
    drawingSVG, dxfPattern,
    triangulate, extrudePolys, stlBinary, stiffenersSTL, meshSTL,
    packStiffeners, bedSVG, stiffenerFiles, makeZip, crc32,
    PANEL_FILL,
  };
});
