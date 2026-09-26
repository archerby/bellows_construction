/*
 * Геометрия меха крупноформатной камеры.
 *
 * Модель: мех — усечённая прямоугольная пирамида (или прямая труба), собранная из
 * четырёх панелей A (низ), B (правая), C (верх), D (левая). Каждая панель разбита
 * поперечными линиями сгиба на N граней одинаковой ширины h (ширина плашки / глубина
 * складки). Соседние панели имеют противоположную чётность: там, где у верха гребень
 * наружу (горная складка), у боковин гребень внутрь (долинная). Благодаря этому периметр
 * любого поперечного сечения остаётся постоянным, а на углах образуются диагональные
 * сгибы под 45° («ёлочка»), которые проходят через ребро развёртки зигзагом с амплитудой h/2.
 *
 * Все размеры — в миллиметрах. Модуль не зависит от DOM: работает в браузере
 * (window.BellowsGeometry) и в Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n.js'));
  else root.BellowsGeometry = factory(root.BellowsI18n);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (I18n) {
  'use strict';
  const { t, num } = I18n;

  const DEFAULTS = {
    sizeMode: 'frame', // 'frame' — размеры по рамкам (манжетам), 'clear' — внутренний просвет в складках
    frontW: 100,
    frontH: 100,
    rearW: 150,
    rearH: 150,
    maxExt: 400, // максимальное рабочее растяжение, расстояние рамка–рамка
    collarF: 10, // длина передней манжеты (гладкий поясок для вклейки в рамку)
    collarR: 10, // длина задней манжеты
    reserve: 10, // запас по длине, %: при максимальном растяжении складки не распрямляются полностью
    pitch: 12, // желаемая ширина плашки (глубина складки)
    hingeGap: 1.5, // зазор между соседними плашками на линии сгиба
    cornerGap: 1.5, // отступ плашки от угловой диагонали
    startOut: true, // первая складка верха/низа — гребнем наружу
    tStiff: 0.2, // толщина плашки: 0,2 мм (один слой) или 0,4 мм (два слоя)
    tOuter: 0.3, // толщина внешнего материала
    tLining: 0.15, // толщина подкладки
    flap: 8, // ширина клапана для склейки шва
  };

  // Допустимые толщины плашек для печати: один или два слоя по 0,2 мм.
  const STIFF_THICKNESSES = [0.2, 0.4];

  const PANEL_NAMES = ['A', 'B', 'C', 'D'];
  const panelTitle = (i) => t('panel.' + PANEL_NAMES[i]); // низ, правая, верх, левая — на языке интерфейса

  // ---------- 2D-векторы ----------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, s) => [a[0] * s, a[1] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const len = (a) => Math.hypot(a[0], a[1]);
  const norm = (a) => {
    const l = len(a);
    return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  function polyArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
    return s / 2;
  }

  function polyCentroid(poly) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const c = cross(p, q);
      a += c;
      cx += (p[0] + q[0]) * c;
      cy += (p[1] + q[1]) * c;
    }
    if (Math.abs(a) < 1e-12) {
      const s = poly.reduce((acc, p) => add(acc, p), [0, 0]);
      return mul(s, 1 / poly.length);
    }
    return [cx / (3 * a), cy / (3 * a)];
  }

  function bbox(points) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of points) {
      if (p[0] < minx) minx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] > maxy) maxy = p[1];
    }
    return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny };
  }

  function lineIntersect(p, d, q, e) {
    const den = cross(d, e);
    if (Math.abs(den) < 1e-12) return null;
    const t = cross(sub(q, p), e) / den;
    return add(p, mul(d, t));
  }

  /**
   * Смещение многоугольника (против часовой стрелки) внутрь, для каждого ребра —
   * своё расстояние. Возвращает null, если многоугольник вырождается.
   */
  function insetPolygon(pts, dists) {
    const n = pts.length;
    const dirs = [], norms = [];
    for (let i = 0; i < n; i++) {
      const d = norm(sub(pts[(i + 1) % n], pts[i]));
      dirs.push(d);
      norms.push([-d[1], d[0]]);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const ip = (i - 1 + n) % n;
      const p1 = add(pts[i], mul(norms[ip], dists[ip]));
      const p2 = add(pts[i], mul(norms[i], dists[i]));
      let x = null;
      if (Math.abs(cross(dirs[ip], dirs[i])) > 1e-6) x = lineIntersect(p1, dirs[ip], p2, dirs[i]);
      out.push(x || mul(add(p1, p2), 0.5));
    }
    for (let i = 0; i < n; i++) {
      if (dot(sub(out[(i + 1) % n], out[i]), dirs[i]) <= 1e-9) return null;
    }
    if (polyArea(out) <= 0) return null;
    return out;
  }

  /** Отсечение многоугольника полуплоскостью dot(p - p0, n) >= minDist (Сазерленд–Ходжман). */
  function clipHalfPlane(poly, p0, n, minDist) {
    const f = (p) => dot(sub(p, p0), n) - minDist;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) out.push(add(a, mul(sub(b, a), fa / (fa - fb))));
    }
    return out;
  }

  /** Отсечение отрезка полуплоскостью; null — если отрезок целиком снаружи. */
  function clipSegment(a, b, p0, n, minDist) {
    const fa = dot(sub(a, p0), n) - (minDist || 0);
    const fb = dot(sub(b, p0), n) - (minDist || 0);
    if (fa < 0 && fb < 0) return null;
    if (fa >= 0 && fb >= 0) return [a, b];
    const x = add(a, mul(sub(b, a), fa / (fa - fb)));
    return fa >= 0 ? [a, x] : [x, b];
  }

  /** Обратное билинейное отображение: точка p в четырёхугольнике a,b,c,d → (u, v). */
  function invBilinear(p, a, b, c, d) {
    const e = sub(b, a), f = sub(d, a), g = add(sub(a, b), sub(c, d)), h = sub(p, a);
    const k2 = cross(g, f), k1 = cross(e, f) + cross(h, g), k0 = cross(h, e);
    let v;
    if (Math.abs(k2) < 1e-9 * Math.max(1, Math.abs(k1))) {
      v = -k0 / k1;
    } else {
      let w = k1 * k1 - 4 * k0 * k2;
      w = Math.sqrt(Math.max(0, w));
      const v1 = (-k1 - w) / (2 * k2), v2 = (-k1 + w) / (2 * k2);
      v = Math.abs(v1 - 0.5) <= Math.abs(v2 - 0.5) ? v1 : v2;
    }
    const dx = e[0] + g[0] * v, dy = e[1] + g[1] * v;
    const u = Math.abs(dx) >= Math.abs(dy) ? (h[0] - f[0] * v) / dx : (h[1] - f[1] * v) / dy;
    return [u, v];
  }

  function bilinear3(q, u, v) {
    const r = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      r[i] = (1 - u) * (1 - v) * q[0][i] + u * (1 - v) * q[1][i] + u * v * q[2][i] + (1 - u) * v * q[3][i];
    }
    return r;
  }

  // ---------- Параметры ----------
  function normalizeParams(input) {
    const p = Object.assign({}, DEFAULTS);
    if (!input) return p;
    for (const key of Object.keys(DEFAULTS)) {
      const val = input[key];
      if (val === undefined || val === null || val === '') continue;
      const def = DEFAULTS[key];
      if (typeof def === 'number') {
        const v = Number(val);
        if (Number.isFinite(v)) p[key] = v;
      } else if (typeof def === 'boolean') {
        p[key] = val === true || val === 'true' || val === 1 || val === '1' || val === 'on';
      } else {
        p[key] = String(val);
      }
    }
    // толщина плашки — только из допустимого набора (ближайшее значение)
    p.tStiff = STIFF_THICKNESSES.reduce((best, t) => (Math.abs(t - p.tStiff) < Math.abs(best - p.tStiff) ? t : best));
    return p;
  }

  function panelDims(i, mid) {
    const even = i % 2 === 0; // A и C — «широкие» (ширина рамки), B и D — «высокие»
    return {
      Wf: even ? mid.fW : mid.fH,
      Wr: even ? mid.rW : mid.rH,
      Of: even ? mid.fH : mid.fW,
      Or: even ? mid.rH : mid.rW,
    };
  }

  const applyT = (T, p) => [T.c * p[0] - T.s * p[1] + T.tx, T.s * p[0] + T.c * p[1] + T.ty];
  const rotT = (T, p) => [T.c * p[0] - T.s * p[1], T.s * p[0] + T.c * p[1]];

  function bestRotation(pts) {
    let best = null;
    for (let deg = -90; deg < 90; deg += 0.25) {
      const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of pts) {
        const x = c * p[0] - s * p[1], y = s * p[0] + c * p[1];
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
      const w = maxx - minx, h = maxy - miny;
      const score = w * h * (w >= h ? 1 : 1.0001);
      if (!best || score < best.score * (1 - 1e-9)) best = { score, a, minx, miny, w, h };
    }
    return best;
  }

  /**
   * Главный расчёт. Возвращает модель: параметры, производные величины, развёртку
   * (контур, складки, диагонали, плашки) и сведения о панелях.
   */
  function computeBellows(input) {
    const p = normalizeParams(input);
    const errors = [], warnings = [];
    const tSand = p.tStiff + p.tOuter + p.tLining;

    for (const k of ['frontW', 'frontH', 'rearW', 'rearH', 'maxExt', 'pitch', 'tStiff']) {
      if (!(p[k] > 0)) errors.push(t('geo.err.positive', { name: t('geo.param.' + k) }));
    }
    for (const k of ['collarF', 'collarR', 'hingeGap', 'cornerGap', 'flap', 'tOuter', 'tLining', 'reserve']) {
      if (p[k] < 0) errors.push(t('geo.err.negative', { name: t('geo.param.' + k) }));
    }
    const Lw = p.maxExt - p.collarF - p.collarR;
    if (!(Lw > 0)) errors.push(t('geo.err.collars'));
    if (errors.length) return { ok: false, params: p, errors, warnings };

    const Lp = Lw * (1 + p.reserve / 100); // длина гофрированной части в развёртке (по оси)
    const Lt = p.collarF + Lp + p.collarR; // полная длина «плоского» усечённого конуса по оси
    const slantK = (Of, Or) => Math.sqrt(1 + Math.pow((Or - Of) / (2 * Lt), 2));

    let hAct = p.pitch, mid, N, kList;
    for (let it = 0; it < 3; it++) {
      const extra = p.sizeMode === 'clear' ? hAct + tSand : 0;
      mid = { fW: p.frontW + extra, fH: p.frontH + extra, rW: p.rearW + extra, rH: p.rearH + extra };
      kList = [0, 1, 2, 3].map((i) => {
        const d = panelDims(i, mid);
        return slantK(d.Of, d.Or);
      });
      const kMax = Math.max(...kList);
      N = Math.max(2, Math.round((Lp * kMax) / p.pitch));
      hAct = (Lp * kMax) / N;
    }

    const axPitch = Lp / N;
    const zk = [];
    for (let k = 0; k <= N; k++) zk.push(p.collarF + k * axPitch);

    const panels = [0, 1, 2, 3].map((i) => {
      const d = panelDims(i, mid);
      return {
        index: i, name: PANEL_NAMES[i], title: panelTitle(i),
        Wf: d.Wf, Wr: d.Wr, Of: d.Of, Or: d.Or, k: kList[i], h: axPitch * kList[i], T: null,
      };
    });
    const hw = (i, z) => lerp(panels[i].Wf, panels[i].Wr, z / Lt) / 2;
    const local = (i, u, z) => [u, z * panels[i].k];

    // Раскладка панелей в плоскости: каждая следующая пристыкована к правому ребру предыдущей.
    panels[0].T = { c: 1, s: 0, tx: 0, ty: 0 };
    for (let i = 0; i < 3; i++) {
      const A = applyT(panels[i].T, local(i, hw(i, 0), 0));
      const B = applyT(panels[i].T, local(i, hw(i, Lt), Lt));
      const a = local(i + 1, -hw(i + 1, 0), 0);
      const b = local(i + 1, -hw(i + 1, Lt), Lt);
      const ang = Math.atan2(B[1] - A[1], B[0] - A[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
      const c = Math.cos(ang), s = Math.sin(ang);
      const Ra = [c * a[0] - s * a[1], s * a[0] + c * a[1]];
      panels[i + 1].T = { c, s, tx: A[0] - Ra[0], ty: A[1] - Ra[1] };
    }
    const G = (i, u, z) => applyT(panels[i].T, local(i, u, z));
    const R = (i, v) => rotT(panels[i].T, v);
    const mountain = (i, k) => (k + i + (p.startOut ? 1 : 0)) % 2 === 0;
    const cAmp = (panels[0].h + panels[1].h) / 4; // полуамплитуда угловой диагонали (≈ h/2)

    // Точка излома угловой диагонали на линии k (с точки зрения панели i).
    function endpoint(i, side, k) {
      const z = zk[k];
      const sgn = side === 'right' ? 1 : -1;
      const corner = G(i, sgn * hw(i, z), z);
      if (k === 0 || k === N) return { pt: corner, inside: true, corner };
      if (mountain(i, k)) return { pt: add(corner, mul(R(i, [-sgn, 0]), cAmp)), inside: true, corner };
      const j = i + sgn;
      const dir = j >= 0 && j <= 3 ? R(j, [sgn, 0]) : R(i, [sgn, 0]); // у шва — продолжение своей линии
      return { pt: add(corner, mul(dir, cAmp)), inside: false, corner };
    }

    // ---------- Контур и клапан ----------
    const outline = [];
    for (let i = 0; i < 4; i++) outline.push(G(i, -hw(i, 0), 0));
    const F = G(3, hw(3, 0), 0), Rr = G(3, hw(3, Lt), Lt);
    const eSeam = norm(sub(Rr, F));
    let nFlap = [eSeam[1], -eSeam[0]];
    if (dot(nFlap, R(3, [1, 0])) < 0) nFlap = mul(nFlap, -1);
    const fl = Math.min(p.flap, len(sub(Rr, F)) / 2.5);
    const flap = fl > 0
      ? [F, add(add(F, mul(nFlap, fl)), mul(eSeam, fl)), add(sub(Rr, mul(eSeam, fl)), mul(nFlap, fl)), Rr]
      : null;
    if (flap) outline.push(...flap);
    else outline.push(F, Rr);
    for (let i = 3; i >= 0; i--) outline.push(G(i, -hw(i, Lt), Lt));

    // ---------- Линии ----------
    const cornerLines = [];
    for (let j = 0; j < 3; j++) cornerLines.push({ a: G(j, hw(j, 0), 0), b: G(j, hw(j, Lt), Lt) });
    const seamLine = { a: F, b: Rr };

    const foldLines = [];
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k <= N; k++) {
        const z = zk[k];
        foldLines.push({ a: G(i, -hw(i, z), z), b: G(i, hw(i, z), z), type: mountain(i, k) ? 'M' : 'V', panel: i, k });
      }
    }
    // Направляющие на клапане (продолжение линий панели D).
    const flapGuides = [];
    if (flap) {
      for (let k = 0; k <= N; k++) {
        const z = zk[k];
        let seg = [G(3, hw(3, z), z), add(G(3, hw(3, z), z), mul(R(3, [1, 0]), fl * 3))];
        for (let e = 0; e < flap.length && seg; e++) {
          const a = flap[e], b = flap[(e + 1) % flap.length];
          const d = norm(sub(b, a));
          // клапан обходится по часовой или против — выбираем нормаль к центру клапана
          const cen = polyCentroid(flap);
          let n = [-d[1], d[0]];
          if (dot(sub(cen, a), n) < 0) n = mul(n, -1);
          seg = clipSegment(seg[0], seg[1], a, n, 0);
        }
        if (seg && len(sub(seg[1], seg[0])) > 0.5) flapGuides.push({ a: seg[0], b: seg[1], k });
      }
    }

    const A0 = G(0, -hw(0, 0), 0), B0 = G(0, -hw(0, Lt), Lt);
    let nIn0 = (() => { const d = norm(sub(B0, A0)); return [d[1], -d[0]]; })();
    if (dot(nIn0, R(0, [1, 0])) < 0) nIn0 = mul(nIn0, -1);
    const nIn3 = mul(nFlap, -1);

    const diagonals = [];
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < 4; j++) {
        const a = endpoint(j, 'right', k).pt, b = endpoint(j, 'right', k + 1).pt;
        diagonals.push({ a, b, corner: j, k });
      }
      const seg = clipSegment(endpoint(0, 'left', k).pt, endpoint(0, 'left', k + 1).pt, A0, nIn0, 0);
      if (seg && len(sub(seg[1], seg[0])) > 0.05) diagonals.push({ a: seg[0], b: seg[1], corner: -1, k });
    }

    // ---------- Плашки ----------
    const stiffeners = [];
    let dropped = 0;
    const minArea = Math.max(2, 0.5 * hAct);
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < N; k++) {
        const Lk = endpoint(i, 'left', k), Rk = endpoint(i, 'right', k);
        const Lk1 = endpoint(i, 'left', k + 1), Rk1 = endpoint(i, 'right', k + 1);
        let pts = [], types = [];
        const push = (pt, t) => { pts.push(pt); types.push(t); };
        push(Lk.pt, 'fold');
        if (!Lk.inside) push(Lk.corner, 'fold');
        if (!Rk.inside) push(Rk.corner, 'fold');
        push(Rk.pt, 'diag');
        push(Rk1.pt, 'fold');
        if (!Rk1.inside) push(Rk1.corner, 'fold');
        if (!Lk1.inside) push(Lk1.corner, 'fold');
        push(Lk1.pt, 'diag');
        // удалить совпадающие точки
        const P2 = [], T2 = [];
        for (let m = 0; m < pts.length; m++) {
          const nx = pts[(m + 1) % pts.length];
          if (len(sub(nx, pts[m])) < 1e-9) continue;
          P2.push(pts[m]);
          T2.push(types[m]);
        }
        pts = P2; types = T2;
        if (polyArea(pts) < 0) {
          const n = pts.length;
          const rp = pts.slice().reverse();
          const rt = rp.map((_, m) => types[(n - 2 - m + n) % n]);
          pts = rp; types = rt;
        }
        const face = pts.slice();
        let poly = insetPolygon(pts, types.map((t) => (t === 'fold' ? p.hingeGap / 2 : p.cornerGap)));
        if (poly && i === 0) poly = clipHalfPlane(poly, A0, nIn0, fl + p.cornerGap);
        if (poly && i === 3) poly = clipHalfPlane(poly, F, nIn3, p.cornerGap);
        if (!poly || poly.length < 3 || polyArea(poly) < minArea) {
          dropped++;
          continue;
        }
        stiffeners.push({
          id: `${PANEL_NAMES[i]}${String(k + 1).padStart(2, '0')}`,
          panel: i, k, poly, face,
          quad: [Lk.pt, Rk.pt, Rk1.pt, Lk1.pt],
          area: polyArea(poly),
        });
      }
    }

    // ---------- Поворот развёртки для минимального габарита ----------
    const rot = bestRotation(outline);
    const rc = Math.cos(rot.a), rs = Math.sin(rot.a);
    const margin = 0;
    const tf = (q) => [rc * q[0] - rs * q[1] - rot.minx + margin, rs * q[0] + rc * q[1] - rot.miny + margin];
    const tfSeg = (s) => Object.assign({}, s, { a: tf(s.a), b: tf(s.b) });
    const labelPts = panels.map((pn, i) => ({
      panel: i,
      center: tf(G(i, 0, p.collarF + Lp / 2)),
      front: tf(G(i, 0, p.collarF / 2)),
      rear: tf(G(i, 0, Lt - p.collarR / 2)),
      axis: norm(rotT({ c: rc, s: rs }, R(i, [0, 1]))),
    }));
    const pattern = {
      width: rot.w, height: rot.h,
      outline: outline.map(tf),
      flap: flap ? flap.map(tf) : null,
      seamLine: tfSeg(seamLine),
      cornerLines: cornerLines.map(tfSeg),
      foldLines: foldLines.map(tfSeg),
      flapGuides: flapGuides.map(tfSeg),
      diagonals: diagonals.map(tfSeg),
      stiffeners: stiffeners.map((s) => Object.assign({}, s, { poly: s.poly.map(tf), face: s.face.map(tf), quad: s.quad.map(tf) })),
      labels: labelPts,
    };

    // ---------- Сводка ----------
    const packLength = N * tSand * 1.3;
    const minFrame = p.collarF + p.collarR + packLength;
    const clear = (w) => w - hAct - tSand;
    const derived = {
      N, Lp, Lt, Lw, axPitch, hAct, cAmp, tSand,
      facePitch: panels.map((pn) => pn.h),
      mid,
      clearFront: { w: clear(mid.fW), h: clear(mid.fH) },
      clearRear: { w: clear(mid.rW), h: clear(mid.rH) },
      outerFront: { w: mid.fW + hAct + tSand, h: mid.fH + hAct + tSand },
      outerRear: { w: mid.rW + hAct + tSand, h: mid.rH + hAct + tSand },
      packLength, minFrame,
      stiffenerCount: stiffeners.length, dropped,
      fabricArea: Math.abs(polyArea(pattern.outline)),
      stiffenerArea: stiffeners.reduce((s, x) => s + x.area, 0),
    };

    // ---------- Предупреждения ----------
    const minClear = Math.min(derived.clearFront.w, derived.clearFront.h, derived.clearRear.w, derived.clearRear.h);
    if (minClear <= 0) errors.push(t('geo.err.clearZero'));
    else if (minClear < 3 * hAct) warnings.push(t('geo.warn.clearSmall', { clear: num(minClear, 1) }));
    if (p.flap < cAmp) warnings.push(t('geo.warn.flap', { flap: num(p.flap), half: num(cAmp, 1) }));
    if (p.hingeGap < 2 * tSand) warnings.push(t('geo.warn.hingeGap', { gap: num(p.hingeGap), pack: num(2 * tSand, 2) }));
    if (N < 6) warnings.push(t('geo.warn.fewFolds'));
    if (dropped > 0) warnings.push(t('geo.warn.dropped', { n: dropped }));
    const taper = Math.max(...panels.map((pn) => Math.abs(pn.Or - pn.Of) / (2 * Lt)));
    if (taper > 0.35) warnings.push(t('geo.warn.taper'));

    return {
      ok: errors.length === 0, params: p, errors, warnings, derived, panels, zk, pattern,
    };
  }

  /**
   * Трёхмерная модель меха при заданном растяжении ext (расстояние между рамками).
   * Возвращает кольца сечений, грани (четырёхугольники) и плашки, отображённые на грани.
   */
  function buildMesh3D(model, ext, opts) {
    const o = Object.assign({ stiffOffset: 0.4 }, opts || {});
    const p = model.params, d = model.derived;
    const { N, Lt, axPitch, mid } = d;
    const e = Math.max(d.minFrame, Math.min(ext, p.collarF + p.collarR + d.Lp));
    const dz = (e - p.collarF - p.collarR) / N;
    const depth = Math.sqrt(Math.max(0, axPitch * axPitch - dz * dz));
    const mountain = (i, k) => (k + i + (p.startOut ? 1 : 0)) % 2 === 0;

    const rings = [{ z: 0, X: mid.fW / 2, Y: mid.fH / 2 }];
    for (let k = 0; k <= N; k++) {
      const zf = model.zk[k];
      const W = lerp(mid.fW, mid.rW, zf / Lt), H = lerp(mid.fH, mid.rH, zf / Lt);
      const delta = k === 0 || k === N ? 0 : depth / 2;
      rings.push({
        z: p.collarF + k * dz,
        X: W / 2 + (mountain(1, k) ? 1 : -1) * delta,
        Y: H / 2 + (mountain(0, k) ? 1 : -1) * delta,
      });
    }
    rings.push({ z: e, X: mid.rW / 2, Y: mid.rH / 2 });

    const corners = (r) => [[-r.X, -r.Y, r.z], [r.X, -r.Y, r.z], [r.X, r.Y, r.z], [-r.X, r.Y, r.z]];
    const outward = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const faces = [];
    for (let r = 0; r < rings.length - 1; r++) {
      const c0 = corners(rings[r]), c1 = corners(rings[r + 1]);
      for (let i = 0; i < 4; i++) {
        const quad = [c0[i], c0[(i + 1) % 4], c1[(i + 1) % 4], c1[i]];
        faces.push({ panel: i, strip: r - 1, collar: r === 0 || r === rings.length - 2, quad, normal: faceNormal(quad, outward[i]) });
      }
    }

    const stiff3d = [];
    for (const s of model.pattern.stiffeners) {
      const face = faces.find((f) => f.panel === s.panel && f.strip === s.k);
      if (!face) continue;
      const [a, b, c, dd] = s.quad;
      const n = face.normal;
      const poly = s.poly.map((pt) => {
        const [u, v] = invBilinear(pt, a, b, c, dd);
        const q = bilinear3(face.quad, u, v);
        return [q[0] + n[0] * o.stiffOffset, q[1] + n[1] * o.stiffOffset, q[2] + n[2] * o.stiffOffset];
      });
      stiff3d.push({ id: s.id, panel: s.panel, k: s.k, poly, normal: n });
    }
    return { ext: e, depth, dz, rings, faces, stiffeners: stiff3d };
  }

  function faceNormal(q, out2) {
    const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
    const v = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((x) => x / l);
    if (n[0] * out2[0] + n[1] * out2[1] < 0) n = n.map((x) => -x);
    return n;
  }

  return {
    DEFAULTS, PANEL_NAMES, panelTitle, STIFF_THICKNESSES,
    normalizeParams, computeBellows, buildMesh3D,
    // утилиты (используются экспортом и тестами)
    util: { add, sub, mul, dot, cross, len, norm, lerp, polyArea, polyCentroid, bbox, insetPolygon, clipHalfPlane, clipSegment, invBilinear, bilinear3 },
  };
});
