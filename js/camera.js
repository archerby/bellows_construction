/*
 * Параметрический монорельсовый крупноформатный фотоаппарат для 3D-печати.
 *
 * Покупное: алюминиевый профиль (рельс), болты/гайки/шайбы M5 и M3, 4 пружины,
 * матовое стекло, объектив в затворе, кассеты. Всё остальное печатается.
 *
 * Мировые координаты сборки: X — вправо, Y — вверх, Z — вдоль оптической оси
 * от объектива к кассете. Верх рельса — y = 0, передняя плоскость передней рамки — z = 0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./csg.js'), require('./geometry.js'));
  else root.BellowsCamera = factory(root.BellowsCSG, root.BellowsGeometry);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (K3, Geo) {
  'use strict';
  const { CSG, M } = K3;

  // ---------------------------------------------------------------------
  // Справочные данные (ориентировочные — сверяйте со своими кассетами и платами)
  // ---------------------------------------------------------------------
  const FORMATS = {
    '4x5': { name: '4×5″ (9×12)', film: [97, 122], holderW: 121, holderT: 10.5, depth: 5.0 },
    '5x7': { name: '5×7″ (13×18)', film: [122, 173], holderW: 147, holderT: 11, depth: 5.8 },
    '8x10': { name: '8×10″ (18×24)', film: [198, 249], holderW: 250, holderT: 12, depth: 6.6 },
  };
  const BOARDS = {
    technika: { name: 'Linhof Technika / Wista / Chamonix — 96×99', w: 96, h: 99 },
    graflex: { name: 'Graflex (Crown/Speed) — 102×102', w: 102, h: 102 },
    toyo: { name: 'Toyo — 110×110', w: 110, h: 110 },
    sinar: { name: 'Sinar — 140×140', w: 140, h: 140 },
    custom: { name: 'свой размер', w: 0, h: 0 },
  };
  const SHUTTERS = {
    copal0: { name: 'Copal 0 — Ø34,6', d: 34.6 },
    copal1: { name: 'Copal 1 — Ø41,6', d: 41.6 },
    copal3: { name: 'Copal 3 — Ø65', d: 65 },
    custom: { name: 'свой диаметр', d: 0 },
  };
  const RAILS = {
    '2020': { name: '2020 (20×20)', w: 20, h: 20 },
    '2040': { name: '2040 стоя (20 шир. × 40 выс.)', w: 20, h: 40 },
    '4020': { name: '2040 плашмя (40 шир. × 20 выс.)', w: 40, h: 20 },
    '4040': { name: '4040 (40×40)', w: 40, h: 40 },
  };
  const TRIPOD = {
    '1/4': { name: '1/4″-20', hole: 6.8, nutAF: 11.11, nutH: 5.56 },
    '3/8': { name: '3/8″-16', hole: 9.9, nutAF: 14.29, nutH: 8.33 },
  };
  const HW = {
    M5: { hole: 5.4, nutAF: 8.0, nutH: 4.0, headAF: 8.0, headH: 3.5 },
    M3: { hole: 3.4, selfTap: 2.8, cbD: 6.5, cbH: 3.2 },
  };

  const CAM_DEFAULTS = {
    camFormat: '4x5',
    camBoard: 'technika',
    camBoardW: 96,
    camBoardH: 99,
    camShutter: 'copal1',
    camShutterD: 41.6,
    camRail: '2040',
    camRailLength: 0, // 0 — подобрать автоматически
    camRise: 25, // подъём/опускание передней рамки, ±мм
    camShift: 15, // сдвиг вбок, ±мм
    camFilmDepth: 0, // 0 — по формату
    camHolderW: 0, // 0 — по формату
    camGlassT: 2,
    camGroove: true,
    camTripod: '1/4',
    camClearance: 0.3,
  };

  function normalizeCamParams(input) {
    const p = Object.assign({}, CAM_DEFAULTS);
    if (!input) return p;
    for (const key of Object.keys(CAM_DEFAULTS)) {
      const val = input[key];
      if (val === undefined || val === null || val === '') continue;
      const def = CAM_DEFAULTS[key];
      if (typeof def === 'number') { const v = Number(val); if (Number.isFinite(v)) p[key] = v; }
      else if (typeof def === 'boolean') p[key] = val === true || val === 'true' || val === 1 || val === '1';
      else p[key] = String(val);
    }
    if (!FORMATS[p.camFormat]) p.camFormat = CAM_DEFAULTS.camFormat;
    if (!BOARDS[p.camBoard]) p.camBoard = CAM_DEFAULTS.camBoard;
    if (!SHUTTERS[p.camShutter]) p.camShutter = CAM_DEFAULTS.camShutter;
    if (!RAILS[p.camRail]) p.camRail = CAM_DEFAULTS.camRail;
    if (!TRIPOD[p.camTripod]) p.camTripod = CAM_DEFAULTS.camTripod;
    p.camClearance = Math.max(0, Math.min(1, p.camClearance));
    p.camRise = Math.max(0, p.camRise);
    p.camShift = Math.max(0, p.camShift);
    return p;
  }

  // ---------------------------------------------------------------------
  // Примитивы-помощники
  // ---------------------------------------------------------------------
  const box = (x0, y0, z0, x1, y1, z1) =>
    CSG.box([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)]);
  // отверстие: многоугольник описан вокруг окружности нужного диаметра
  const holeR = (d, n) => d / 2 / Math.cos(Math.PI / n);
  const cylX = (x0, x1, y, z, d, n = 32) => CSG.cylinder([x0, y, z], [x1, y, z], holeR(d, n), n);
  const cylY = (y0, y1, x, z, d, n = 32) => CSG.cylinder([x, y0, z], [x, y1, z], holeR(d, n), n);
  const cylZ = (z0, z1, x, y, d, n = 32) => CSG.cylinder([x, y, z0], [x, y, z1], holeR(d, n), n);
  const hexPoly = (af) => {
    const r = af / Math.sqrt(3);
    return [0, 1, 2, 3, 4, 5].map((i) => [r * Math.cos((i * Math.PI) / 3), r * Math.sin((i * Math.PI) / 3)]);
  };
  const hexZ = (z0, z1, x, y, af) => CSG.prism(hexPoly(af), z0, z1).translate(x, y, 0);
  // шестигранник вдоль X: призма вдоль Z, повернутая Ry(90) (z → x); вершина смотрит вверх по Y
  // локальная z → мировая x, локальная x (вершина шестигранника) → мировая y, локальная y → мировая z
  const hexX = (x0, x1, y, z, af) => CSG.prism(hexPoly(af), x0, x1).transform([0, 0, 1, 0, 1, 0, 0, y, 0, 1, 0, z]);
  const hexY = (y0, y1, x, z, af) => CSG.prism(hexPoly(af), y0, y1).transform(M.chain(M.T(x, 0, z), M.Rx(-90)));
  // паз (скруглённая прорезь) в плоскости, перпендикулярной оси axis, вытянутый вдоль dir
  function slot(axis, a0, a1, c1, c2, len, d) {
    // axis: 'x' | 'y' | 'z' — направление сквозного реза; вытянут вдоль следующей оси (x→y, y→x, z→x)
    const r = d / 2, parts = [];
    if (axis === 'x') {
      parts.push(cylX(a0, a1, c1 - len / 2, c2, d), cylX(a0, a1, c1 + len / 2, c2, d));
      if (len > 0) parts.push(box(a0, c1 - len / 2, c2 - r, a1, c1 + len / 2, c2 + r));
    } else if (axis === 'y') {
      parts.push(cylY(a0, a1, c1 - len / 2, c2, d), cylY(a0, a1, c1 + len / 2, c2, d));
      if (len > 0) parts.push(box(c1 - len / 2, a0, c2 - r, c1 + len / 2, a1, c2 + r));
    } else {
      parts.push(cylZ(a0, a1, c1 - len / 2, c2, d), cylZ(a0, a1, c1 + len / 2, c2, d));
      if (len > 0) parts.push(box(c1 - len / 2, c2 - r, a0, c1 + len / 2, c2 + r, a1));
    }
    if (len <= 0) return parts[0];
    return parts[0].union(parts[1]).union(parts[2]);
  }

  // ---------------------------------------------------------------------
  // Скругления и фаски
  // ---------------------------------------------------------------------
  const { Polygon } = K3;
  const area2 = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - a[1] * b[0]; }, 0) / 2;

  /**
   * Прямоугольник со скруглёнными (seg > 1) или срезанными (seg = 1) углами, обход против часовой стрелки.
   * corners — одно число (радиус для всех) или [[r, seg], …] для углов (x1,y0), (x1,y1), (x0,y1), (x0,y0).
   */
  function rrect(x0, y0, x1, y1, corners, segDefault) {
    const sd = segDefault || 6;
    const cs = Array.isArray(corners) ? corners : [0, 1, 2, 3].map(() => [corners, sd]);
    const at = [[x1, y0, -90, -1, 1], [x1, y1, 0, -1, -1], [x0, y1, 90, 1, -1], [x0, y0, 180, 1, 1]];
    const pts = [];
    cs.forEach(([r, seg], i) => {
      const [cx, cy, a0, sx, sy] = at[i];
      if (!(r > 0)) { pts.push([cx, cy]); return; }
      const ox = cx + sx * r, oy = cy + sy * r;
      for (let k = 0; k <= seg; k++) {
        const a = ((a0 + (90 * k) / seg) * Math.PI) / 180;
        pts.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]);
      }
    });
    // соседние дуги могут сойтись в одну точку (например, у «стадиона») — убираем дубли
    return pts.filter((q, i) => { const n = pts[(i + 1) % pts.length]; return Math.hypot(q[0] - n[0], q[1] - n[1]) > 1e-7; });
  }

  /** Скругление выбранных вершин выпуклого многоугольника (против часовой стрелки). */
  function fillet(poly, radii, seg) {
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const r = radii[i] || 0, q = poly[i];
      if (!r) { out.push(q); continue; }
      const p = poly[(i - 1 + n) % n], w = poly[(i + 1) % n];
      const u1 = [q[0] - p[0], q[1] - p[1]], u2 = [w[0] - q[0], w[1] - q[1]];
      const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
      const e1 = [u1[0] / l1, u1[1] / l1], e2 = [u2[0] / l2, u2[1] / l2];
      const turn = Math.acos(Math.max(-1, Math.min(1, e1[0] * e2[0] + e1[1] * e2[1]))); // угол поворота
      const t = r * Math.tan(turn / 2);
      const t1 = [q[0] - e1[0] * t, q[1] - e1[1] * t];
      const cen = [t1[0] - e1[1] * r, t1[1] + e1[0] * r];
      const a0 = Math.atan2(t1[1] - cen[1], t1[0] - cen[0]);
      for (let k = 0; k <= seg; k++) {
        const a = a0 + (turn * k) / seg;
        out.push([cen[0] + r * Math.cos(a), cen[1] + r * Math.sin(a)]);
      }
    }
    return out;
  }

  /** Смещение выпуклого многоугольника (против часовой стрелки) внутрь на d (d < 0 — наружу). */
  function offsetConvex(poly, d) {
    const n = poly.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = poly[(i - 1 + n) % n], q = poly[i], r = poly[(i + 1) % n];
      const u1 = [q[0] - p[0], q[1] - p[1]], u2 = [r[0] - q[0], r[1] - q[1]];
      const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
      const e1 = [u1[0] / l1, u1[1] / l1], e2 = [u2[0] / l2, u2[1] / l2];
      const a = [p[0] - e1[1] * d, p[1] + e1[0] * d], b = [q[0] - e2[1] * d, q[1] + e2[0] * d];
      const den = e1[0] * e2[1] - e1[1] * e2[0];
      if (Math.abs(den) < 1e-9) { out.push(b); continue; }
      const t = ((b[0] - a[0]) * e2[1] - (b[1] - a[1]) * e2[0]) / den;
      out.push([a[0] + e1[0] * t, a[1] + e1[1] * t]);
    }
    return out;
  }

  /** Тело по кольцам сечений {p, z} с одинаковым числом вершин (выпуклые, против часовой стрелки). */
  function loft(rings) {
    const polys = [], n = rings[0].p.length;
    const P = (ring, i) => [ring.p[i][0], ring.p[i][1], ring.z];
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        polys.push(new Polygon([P(rings[k], i), P(rings[k], j), P(rings[k + 1], j), P(rings[k + 1], i)]));
      }
    }
    const top = rings[rings.length - 1], bot = rings[0];
    polys.push(new Polygon(top.p.map((_, i) => P(top, i))));
    polys.push(new Polygon(bot.p.map((_, i) => P(bot, i)).reverse()));
    return new CSG(polys);
  }

  /** Призма с фасками по нижнему (cb) и верхнему (ct) контуру. */
  function chamferPrism(poly, z0, z1, cb, ct) {
    const pts = area2(poly) < 0 ? poly.slice().reverse() : poly;
    const rings = [];
    if (cb > 0) rings.push({ p: offsetConvex(pts, cb), z: z0 });
    rings.push({ p: pts, z: z0 + (cb || 0) });
    rings.push({ p: pts, z: z1 - (ct || 0) });
    if (ct > 0) rings.push({ p: offsetConvex(pts, ct), z: z1 });
    return loft(rings);
  }

  const circle = (r, n) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);

  // Перевод «призмы вдоль z» в нужную ось
  const ALONG = {
    y: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0], // z → y, y → −z
    x: [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0], // z → x, x → y, y → z
    yProfileXZ: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0], // профиль в (x, z), вытяжка вдоль y
  };

  // ---------------------------------------------------------------------
  // Расчёт размеров
  // ---------------------------------------------------------------------
  const K = {
    Tf: 14, // толщина рамок стоек
    tPlate: 5, // пластина рамки меха
    lipWall: 2, // стенка бортика рамки меха
    border: 14, // минимальная ширина обода рамки
    R: 8, // радиус скругления рамок
    ch: 1.2, // фаска рамок
    Tc: 8, // верх каретки
    Tw: 9, // боковая стенка каретки
    Lc: 36, // длина каретки = глубина основания = глубина стойки внизу
    Tb: 8, // основание стойки
    Db: 36,
    Tu: 12, // толщина вертикали
    Du: 36, // глубина вертикали внизу
    DuTop: 24, // глубина вертикали вверху
    footZ: 9, // крепёжные болты вертикали: ±9 мм по глубине
    footNutY: 12, // высота гайки в ножке вертикали
    washer: 1, // зазор под шайбу между вертикалью и рамкой
    knobD: 26, knobH: 12, // барашки наклона
    knobSD: 19, knobSH: 9, // малые барашки: поворот стойки, фиксатор каретки
    tBoard: 3, // фланец объективной платы
    boardLip: 5, // световой замок платы
    plugH: 3,
    backT: 6, // плита задника
    guideW: 12, // направляющие кассеты
    barT: 4, // пружинные планки
    ledge: 3.5, // уступ под матовое стекло
    corner: 8, // отступ крепёжных винтов рамок от края
  };

  const COL = {
    frame: [0.21, 0.21, 0.23],
    plate: [0.16, 0.16, 0.18],
    struct: [0.56, 0.57, 0.61],
    carriage: [0.3, 0.3, 0.33],
    back: [0.27, 0.28, 0.31],
    glass: [0.42, 0.45, 0.5],
    accent: [0.9, 0.46, 0.13],
    board: [0.1, 0.1, 0.11],
  };

  function computeCamera(bm, input) {
    const cp = normalizeCamParams(input);
    const errors = [], warnings = [];
    if (!bm || !bm.ok) return { ok: false, params: cp, errors: ['Сначала исправьте параметры меха.'], warnings };
    const c = cp.camClearance;
    const F = FORMATS[cp.camFormat];
    const film = F.film;
    const holderW = cp.camHolderW > 0 ? cp.camHolderW : F.holderW;
    const depth = cp.camFilmDepth > 0 ? cp.camFilmDepth : F.depth;
    const board = cp.camBoard === 'custom' ? { w: cp.camBoardW, h: cp.camBoardH } : BOARDS[cp.camBoard];
    const shutterD = cp.camShutter === 'custom' ? cp.camShutterD : SHUTTERS[cp.camShutter].d;
    const rail = RAILS[cp.camRail];
    const tri = TRIPOD[cp.camTripod];
    const d = bm.derived, bp = bm.params;
    const tMat = bp.tOuter + bp.tLining;

    if (!(board.w > 20 && board.h > 20)) errors.push('Укажите размер объективной платы.');
    if (!(shutterD > 5)) errors.push('Укажите диаметр затвора.');
    if (errors.length) return { ok: false, params: cp, errors, warnings };

    const boardOpen = [board.w - 2 * K.boardLip, board.h - 2 * K.boardLip];
    const Or = Math.max(film[0], film[1]) + 4; // квадратное окно задней рамки (задник поворачивается)
    const guideIn = holderW / 2 + c, guideOut = guideIn + K.guideW, guideC = guideIn + K.guideW / 2;
    // Рамка стойки, рамка меха и задник — одного размера: получается единый «пакет» со скруглёнными углами
    const Sf = Math.ceil(Math.max(board.w + 2 * c + 2 * K.border, board.h + 2 * c + 2 * K.border, d.mid.fW + 24, d.mid.fH + 24));
    const Sr = Math.ceil(Math.max(Or + 2 * K.border, d.mid.rW + 24, d.mid.rH + 24, 2 * (guideOut + 10)));
    const bellowsFrame = (S, mw, mh, collar) => ({
      mw, mh, plateW: S, plateH: S,
      lipW: mw - tMat, lipH: mh - tMat,
      lipLen: Math.max(4, collar),
    });
    const bfF = bellowsFrame(Sf, d.mid.fW, d.mid.fH, bp.collarF);
    const bfR = bellowsFrame(Sr, d.mid.rW, d.mid.rH, bp.collarR);

    const guideH = Math.max(3, Math.min(6, F.holderT - 3));
    const Tg = Math.max(guideH + 1.5, depth + cp.camGlassT + 1.5);
    const glass = [film[0] + 2 + 2 * K.ledge, film[1] + 2 + 2 * K.ledge];
    const wrap = Math.min(rail.h, 12);
    const baseTop = K.Tc + K.Tb;
    const A = baseTop + Math.max(Sf / 2 + cp.camRise, Sr / 2) + K.knobSH + 4; // высота оптической оси над рельсом
    const HuF = Math.ceil(A - baseTop + cp.camRise + 16);
    const HuR = Math.ceil(A - baseTop + 16);

    // Минимальное растяжение по механике: каретки не должны упираться друг в друга
    const eMech = Math.ceil(K.Lc + 2 - K.Tf - 2 * K.tPlate);
    const eMin = Math.max(d.minFrame, eMech, 10);
    const eMax = bp.maxExt;
    const zR = (e) => K.Tf + 2 * K.tPlate + e; // передняя плоскость задней рамки
    const railZ0 = -50;
    const railNeed = Math.ceil((zR(eMax) + K.Tf / 2 + K.Lc / 2 + 30 - railZ0) / 50) * 50;
    const railL = cp.camRailLength > 0 ? cp.camRailLength : railNeed;
    if (cp.camRailLength > 0 && cp.camRailLength < railNeed) {
      warnings.push(`Рельс ${cp.camRailLength} мм короче нужного (${railNeed} мм): полное растяжение меха будет недоступно.`);
    }

    // Проверки
    const minClearR = Math.min(d.clearRear.w, d.clearRear.h);
    if (minClearR < Math.max(film[0], film[1])) {
      warnings.push(`Просвет меха у кассеты (${minClearR.toFixed(0)} мм) меньше длинной стороны кадра (${film[1]} мм): при повороте задника мех срежет углы кадра. Увеличьте заднюю рамку меха.`);
    }
    if (shutterD + 6 > Math.min(boardOpen[0], boardOpen[1]) - 2 * c) {
      warnings.push(`Затвор Ø${shutterD} почти не помещается на плату ${board.w}×${board.h}: отверстие шире светового замка платы.`);
    }
    if (d.clearFront.w < shutterD || d.clearFront.h < shutterD) {
      warnings.push('Передний просвет меха меньше диаметра затвора — задняя линза объектива может упереться в мех.');
    }
    if (cp.camFilmDepth <= 0) {
      warnings.push(`Глубина плоскости плёнки взята по справочнику (${String(depth).replace('.', ',')} мм для ${F.name}). Измерьте свои кассеты — от этого зависит резкость.`);
    }

    const dims = {
      c, film, holderW, depth, board, shutterD, rail, tri, boardOpen, Or, Sf, Sr, guideIn, guideOut, guideC, guideH, Tg, glass,
      wrap, baseTop, A, HuF, HuR, eMin, eMax, railL, railNeed, railZ0, bfF, bfR, K,
    };
    const parts = buildPartList(dims, cp);
    const hardware = hardwareList(dims, cp, bm);
    return { ok: true, params: cp, errors, warnings, dims, parts, hardware, zR };
  }

  // ---------------------------------------------------------------------
  // Детали
  // ---------------------------------------------------------------------
  function buildPartList(D, cp) {
    const { c } = D;
    const nutAF = HW.M5.nutAF + c, nutH = HW.M5.nutH + c, nutR = nutAF / Math.sqrt(3);
    const L = [];
    const add = (key, name, qty, color, build, printT, note) => L.push({ key, name, qty, color, build, printT: printT || M.I(), note: note || '' });
    const face = { up: M.I(), down: M.Rx(180), yUp: M.Rx(90), yDown: M.Rx(-90), xUp: M.Ry(-90) };
    // отверстие с фаской на входе (конус 45°)
    const csink = (z, x, y, d, depthC, dir) => {
      const r0 = holeR(d, 32) + depthC, r1 = holeR(d, 32);
      return dir > 0
        ? CSG.cylinder([x, y, z - 0.01], [x, y, z + depthC], r0, 32, r1)
        : CSG.cylinder([x, y, z + 0.01], [x, y, z - depthC], r0, 32, r1);
    };

    // --- Каретка: седло на рельс, фиксатор сбоку, ось поворота стойки сверху
    add('carriage', 'Каретка', 2, COL.carriage, () => {
      const hw = D.rail.w / 2 + c, W = hw + K.Tw;
      const prof = rrect(-W, -D.wrap, W, K.Tc, [[3, 5], [1.5, 1], [1.5, 1], [3, 5]]);
      let s = chamferPrism(prof, -K.Lc / 2, K.Lc / 2, 1, 1);
      s = s.subtract(box(-hw, -D.wrap - 1, -K.Lc / 2 - 1, hw, 0, K.Lc / 2 + 1));
      const ly = -D.wrap / 2;
      return s.subtractAll([
        cylX(hw - 1, W + 1, ly, 0, HW.M5.hole),
        hexX(W - nutH, W + 1, ly, 0, nutAF),
        cylY(-1, K.Tc + 1, 0, 0, HW.M5.hole),
        hexY(-1, nutH, 0, 0, nutAF),
      ]);
    }, face.yDown, 'печатать верхом вниз');

    // --- Основание стойки: скруглённая плита, паз оси поворота/сдвига
    const base = (S, shift) => () => {
      const Wb = S + 2 * (K.washer + K.Tu);
      const s = chamferPrism(rrect(-Wb / 2, -K.Db / 2, Wb / 2, K.Db / 2, 5), 0, K.Tb, 0.6, 1).transform(ALONG.y);
      const cuts = [slot('y', -1, K.Tb + 1, 0, 0, 2 * shift, HW.M5.hole)];
      for (const sx of [-1, 1]) for (const sz of [-K.footZ, K.footZ]) cuts.push(cylY(-1, K.Tb + 1, sx * (S / 2 + K.washer + K.Tu / 2), sz, HW.M5.hole));
      return s.subtractAll(cuts);
    };
    add('base_front', 'Основание передней стойки', 1, COL.struct, base(D.Sf, cp.camShift), face.yUp);
    add('base_rear', 'Основание задней стойки', 1, COL.struct, base(D.Sr, cp.camShift), face.yUp);

    // --- Вертикали: сужаются кверху, верх скруглён, фаски по контуру
    const upright = (H, axleY, slotLen) => () => {
      // профиль в плоскости (высота, глубина)
      let prof = [[0, -K.Du / 2], [H, -K.DuTop / 2], [H, K.DuTop / 2], [0, K.Du / 2]];
      if (area2(prof) < 0) prof = prof.reverse();
      const idxTop = prof.map((p, i) => (p[0] === H ? 10 : 0));
      prof = fillet(prof, idxTop, 12);
      const s = chamferPrism(prof, -K.Tu / 2, K.Tu / 2, 1, 1).transform(ALONG.x);
      const cuts = [slot('x', -K.Tu, K.Tu, axleY, 0, slotLen, HW.M5.hole)];
      for (const z of [-K.footZ, K.footZ]) {
        cuts.push(cylY(-1, K.footNutY + 8, 0, z, HW.M5.hole));
        // гнездо гайки открыто внутрь, к рамке — снаружи вертикаль гладкая
        cuts.push(box(-K.Tu / 2 - 1, K.footNutY - nutH / 2, z - nutAF / 2, nutR, K.footNutY + nutH / 2, z + nutAF / 2));
      }
      return s.subtractAll(cuts);
    };
    const upF = upright(D.HuF, D.A - D.baseTop, 2 * cp.camRise);
    const upR = upright(D.HuR, D.A - D.baseTop, 0);
    const mirror = M.S(-1, 1, 1);
    add('upright_front_R', 'Вертикаль передней стойки, правая', 1, COL.struct, upF, face.xUp);
    add('upright_front_L', 'Вертикаль передней стойки, левая', 1, COL.struct, () => upF().transform(mirror), M.Ry(90));
    add('upright_rear_R', 'Вертикаль задней стойки, правая', 1, COL.struct, upR, face.xUp);
    add('upright_rear_L', 'Вертикаль задней стойки, левая', 1, COL.struct, () => upR().transform(mirror), M.Ry(90));

    // --- Общая часть рамок: скруглённый контур с фасками, окно, оси наклона.
    // Гнёзда гаек открыты на ту сторону, которую закрывает рамка меха, — снаружи их не видно.
    const frameBase = (S, ow, oh, pocketFromRear) => {
      const s = chamferPrism(rrect(-S / 2, -S / 2, S / 2, S / 2, K.R, 10), 0, K.Tf, K.ch, K.ch)
        .subtract(box(-ow / 2, -oh / 2, -1, ow / 2, oh / 2, K.Tf + 1));
      const cuts = [];
      for (const sx of [-1, 1]) {
        const px = sx * (S / 2 - 7);
        cuts.push(cylX(sx * (S / 2 + 1), sx * (S / 2 - 12), 0, K.Tf / 2, HW.M5.hole));
        const [z0, z1] = pocketFromRear ? [K.Tf / 2 - nutR, K.Tf + 1] : [-1, K.Tf / 2 + nutR];
        cuts.push(box(px - nutH / 2, -nutAF / 2, z0, px + nutH / 2, nutAF / 2, z1));
      }
      return { s, cuts };
    };
    const cornerHoles = (S) => [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => [sx * (S / 2 - K.corner), sy * (S / 2 - K.corner)]);

    // --- Передняя рамка (под объективную плату): лицевая сторона чистая
    add('frame_front', 'Передняя рамка (под плату)', 1, COL.frame, () => {
      const { s, cuts } = frameBase(D.Sf, D.boardOpen[0], D.boardOpen[1], true);
      const bw = D.board.w / 2 + c, bh = D.board.h / 2 + c;
      cuts.push(box(-bw, -bh, -1, bw, bh, K.tBoard));
      for (const sy of [-1, 1]) cuts.push(cylZ(-1, 8, 0, sy * (bh + 6), HW.M3.selfTap));
      for (const [x, y] of cornerHoles(D.Sf)) {
        cuts.push(cylZ(-1, K.Tf + 1, x, y, HW.M3.hole), cylZ(-1, HW.M3.cbH, x, y, HW.M3.cbD));
      }
      return s.subtractAll(cuts);
    }, face.down, 'печатать лицевой стороной вверх');

    // --- Задняя рамка (к ней крепится поворотный задник)
    const pinwheel = (S) => { const a = S / 4, b = S / 2 - 7; return [[a, b], [-b, a], [-a, -b], [b, -a]]; };
    add('frame_rear', 'Задняя рамка', 1, COL.frame, () => {
      const { s, cuts } = frameBase(D.Sr, D.Or, D.Or, false);
      for (const [x, y] of cornerHoles(D.Sr)) {
        cuts.push(cylZ(-1, K.Tf + 1, x, y, HW.M3.hole), cylZ(K.Tf - HW.M3.cbH, K.Tf + 1, x, y, HW.M3.cbD));
      }
      for (const [x, y] of pinwheel(D.Sr)) cuts.push(cylZ(K.Tf - 9, K.Tf + 1, x, y, HW.M3.selfTap));
      return s.subtractAll(cuts);
    }, face.up);

    // --- Рамки меха: того же контура, что и рамка стойки; мех вклеивается манжетой на бортик
    const bellowsFrame = (S, bf) => () => {
      let s = chamferPrism(rrect(-S / 2, -S / 2, S / 2, S / 2, K.R, 10), 0, K.tPlate, 0.8, K.ch);
      s = s.union(box(-bf.lipW / 2, -bf.lipH / 2, K.tPlate - 0.5, bf.lipW / 2, bf.lipH / 2, K.tPlate + bf.lipLen));
      const iw = bf.lipW / 2 - K.lipWall, ih = bf.lipH / 2 - K.lipWall;
      const cuts = [box(-iw, -ih, -1, iw, ih, K.tPlate + bf.lipLen + 1)];
      for (const [x, y] of cornerHoles(S)) cuts.push(cylZ(-1, K.tPlate + 1, x, y, HW.M3.selfTap));
      return s.subtractAll(cuts);
    };
    add('bellows_frame_front', 'Рамка меха передняя', 1, COL.plate, bellowsFrame(D.Sf, D.bfF), face.up);
    add('bellows_frame_rear', 'Рамка меха задняя', 1, COL.plate, bellowsFrame(D.Sr, D.bfR), face.up);

    // --- Объективная плата: скруглённые углы, фаски по лицу и отверстию
    add('lens_board', `Объективная плата ${D.board.w}×${D.board.h}, затвор Ø${D.shutterD}`, 1, COL.board, () => {
      let s = chamferPrism(rrect(-D.board.w / 2, -D.board.h / 2, D.board.w / 2, D.board.h / 2, 2.5), 0, K.tBoard, 0.8, 0);
      const pw = D.boardOpen[0] / 2 - c, ph = D.boardOpen[1] / 2 - c;
      s = s.union(box(-pw, -ph, K.tBoard - 0.5, pw, ph, K.tBoard + K.plugH));
      return s.subtractAll([
        cylZ(-1, K.tBoard + K.plugH + 1, 0, 0, D.shutterD + c, 96),
        CSG.cylinder([0, 0, -0.01], [0, 0, 1], holeR(D.shutterD + c, 96) + 1, 96, holeR(D.shutterD + c, 96)),
      ]);
    }, face.up);

    // --- Защёлки платы
    add('latch', 'Поворотная защёлка платы', 2, COL.accent, () => {
      const t = 2.5;
      const s = chamferPrism(rrect(-4, -4, 18, 4, 4, 8), 0, t, 0, 0.5);
      return s.subtractAll([cylZ(-1, t + 1, 0, 0, HW.M3.hole), csink(t, 0, 0, HW.M3.hole, 0.6, -1)]);
    }, face.up);

    // --- Задник: плита с направляющими (фаска-заход для кассеты), канавка светового замка
    add('back_plate', 'Плита задника (поворотная)', 1, COL.back, () => {
      const S = D.Sr, T = K.backT;
      let s = chamferPrism(rrect(-S / 2, -S / 2, S / 2, S / 2, K.R, 10), 0, T, K.ch, 0.8);
      for (const sx of [-1, 1]) {
        const xi = sx * D.guideIn, xo = sx * D.guideOut;
        const [x0, x1] = [Math.min(xi, xo), Math.max(xi, xo)];
        // фаска 1,5 мм у внутренней кромки — заход для кассеты
        const corners = sx > 0 ? [[0, 1], [1, 1], [1.5, 1], [0, 1]] : [[0, 1], [1.5, 1], [1, 1], [0, 1]];
        const prof = rrect(x0, T - 0.5, x1, T + D.guideH, corners);
        s = s.union(CSG.prism(prof, -S / 2 + 0.8, S / 2 - 0.8).transform(ALONG.yProfileXZ));
      }
      const ow = (D.film[0] + 2) / 2, oh = (D.film[1] + 2) / 2;
      const cuts = [box(-ow, -oh, -1, ow, oh, T + D.guideH + 1)];
      if (cp.camGroove) {
        const gi = [ow + 2, oh + 2], gw = 2.5;
        cuts.push(box(-gi[0] - gw, -gi[1] - gw, T - 1.2, gi[0] + gw, gi[1] + gw, T + 1).subtract(box(-gi[0], -gi[1], T - 2, gi[0], gi[1], T + 2)));
      }
      for (const [x, y] of pinwheel(S)) cuts.push(cylZ(-1, T + D.guideH + 1, x, y, HW.M3.hole), cylZ(T - HW.M3.cbH, T + D.guideH + 1, x, y, HW.M3.cbD));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) cuts.push(cylZ(1, T + D.guideH + 1, sx * D.guideC, sy * (S / 2 - 15), HW.M3.selfTap));
      return s.subtractAll(cuts);
    }, face.up, 'опорная плоскость — вверху; слой 0,1 мм');

    // --- Рамка матового стекла
    const Wg = D.holderW - 1, Hg = D.Sr - 10;
    const barHoles = [1, 0, -1].map((sy) => sy * (Hg / 2 - 20));
    add('gg_frame', 'Рамка матового стекла', 1, COL.glass, () => {
      const s = chamferPrism(rrect(-Wg / 2, -Hg / 2, Wg / 2, Hg / 2, 4), 0, D.Tg, 0.5, 0.8);
      const ow = (D.film[0] + 2) / 2, oh = (D.film[1] + 2) / 2;
      const pw = (D.glass[0] + 0.6) / 2, ph = (D.glass[1] + 0.6) / 2;
      const cuts = [box(-ow, -oh, -1, ow, oh, D.Tg + 1), box(-pw, -ph, D.depth, pw, ph, D.Tg + 1)];
      for (const sx of [-1, 1]) for (const y of barHoles) cuts.push(cylZ(D.Tg - 7, D.Tg + 1, sx * (Wg / 2 - 3.5), y, HW.M3.selfTap));
      return s.subtractAll(cuts);
    }, face.up, 'лицевой стороной вниз; слой 0,1 мм');

    // --- Пружинные планки
    add('spring_bar', 'Пружинная планка задника', 2, COL.frame, () => {
      const x0 = Wg / 2 - 7, x1 = D.guideC + 7;
      const s = chamferPrism(rrect(x0, -Hg / 2, x1, Hg / 2, 3), 0, K.barT, 0.6, 0.6);
      const cuts = barHoles.map((y) => cylZ(-1, K.barT + 1, Wg / 2 - 3.5, y, HW.M3.hole));
      for (const sy of [-1, 1]) cuts.push(cylZ(-1, K.barT + 1, D.guideC, sy * (D.Sr / 2 - 15), HW.M3.hole));
      return s.subtractAll(cuts);
    }, face.up);

    // --- Барашки: диск с фасками и мелким рифлением, гнездо под головку болта M5 снизу
    const knob = (Dk, Hk, flutes) => () => {
      const r = Dk / 2, n = 72;
      const s = loft([
        { p: circle(r - 0.8, n), z: 0 }, { p: circle(r, n), z: 0.8 },
        { p: circle(r, n), z: Hk - 1.8 }, { p: circle(r - 1.8, n), z: Hk },
      ]);
      const cuts = [];
      for (let i = 0; i < flutes; i++) {
        const a = ((i + 0.5) / flutes) * Math.PI * 2, rr = r + 0.45;
        cuts.push(CSG.cylinder([Math.cos(a) * rr, Math.sin(a) * rr, -1], [Math.cos(a) * rr, Math.sin(a) * rr, Hk + 1], 1.1, 12));
      }
      cuts.push(hexZ(-1, HW.M5.headH + c, 0, 0, HW.M5.headAF + c), cylZ(-1, Hk + 1, 0, 0, HW.M5.hole));
      return s.subtractAll(cuts);
    };
    add('knob', 'Барашек наклона (под болт M5)', 4, COL.accent, knob(K.knobD, K.knobH, 24), face.up);
    add('knob_small', 'Малый барашек: поворот стойки, фиксатор каретки', 4, COL.accent, knob(K.knobSD, K.knobSH, 18), face.up);

    // --- Штативная площадка
    const slotsX = D.rail.w >= 40 ? [-10, 10] : [0];
    add('tripod_block', `Штативная площадка (гайка ${D.tri.name})`, 1, COL.carriage, () => {
      const W = Math.max(D.rail.w, 30) + 10;
      const s = chamferPrism(rrect(-W / 2, -24, W / 2, 24, 5), -12, 0, 1, 0).transform(ALONG.y);
      const cuts = [cylY(-13, 1, 0, 0, D.tri.hole), hexY(-(D.tri.nutH + c), 1, 0, 0, D.tri.nutAF + c)];
      for (const x of slotsX) for (const z of [-15, 15]) cuts.push(cylY(-13, 1, x, z, HW.M5.hole), cylY(-13, -12 + 5.5, x, z, 9.5));
      return s.subtractAll(cuts);
    }, face.yUp);

    // --- Заглушки рельса
    add('end_cap', 'Заглушка торца рельса', 2, COL.carriage, () => {
      const s = chamferPrism(rrect(-D.rail.w / 2, -D.rail.h, D.rail.w / 2, 0, 1.5, 4), 0, 4, 0, 0.8);
      const cuts = [];
      for (let i = 0; i < D.rail.w / 20; i++) for (let j = 0; j < D.rail.h / 20; j++) {
        cuts.push(cylZ(-1, 5, -D.rail.w / 2 + 10 + i * 20, -10 - j * 20, HW.M5.hole));
      }
      return s.subtractAll(cuts);
    }, face.up);

    return L;
  }

  /** Рельс (покупной профиль) — только для показа: фаски и пазы серии 20. */
  function railCSG(D) {
    const w = D.rail.w, h = D.rail.h, z0 = D.railZ0, z1 = D.railZ0 + D.railL;
    let s = CSG.prism(rrect(-w / 2, -h, w / 2, 0, 1, 1), z0, z1);
    const g = [];
    for (let i = 0; i < w / 20; i++) {
      const x = -w / 2 + 10 + i * 20;
      g.push(box(x - 3, -1.8, z0 - 1, x + 3, 1, z1 + 1), box(x - 3, -h - 1, z0 - 1, x + 3, -h + 1.8, z1 + 1));
    }
    for (let j = 0; j < h / 20; j++) {
      const y = -10 - j * 20;
      g.push(box(w / 2 - 1.8, y - 3, z0 - 1, w / 2 + 1, y + 3, z1 + 1), box(-w / 2 - 1, y - 3, z0 - 1, -w / 2 + 1.8, y + 3, z1 + 1));
    }
    return s.subtractAll(g);
  }

  // ---------------------------------------------------------------------
  // Расстановка деталей в сборке при растяжении e
  // ---------------------------------------------------------------------
  function placements(cam, e) {
    const D = cam.dims;
    const zr = cam.zR(e);
    const A = D.A, bt = D.baseTop;
    const zcF = K.Tf / 2, zcR = zr + K.Tf / 2; // стойки симметричны относительно оси наклона
    const T = M.T;
    const uxF = D.Sf / 2 + K.washer + K.Tu / 2, uxR = D.Sr / 2 + K.washer + K.Tu / 2;
    const lockX = D.rail.w / 2 + D.c + K.Tw;
    const zb = zr + K.Tf + K.backT + D.Tg;
    return {
      carriage: [T(0, 0, zcF), T(0, 0, zcR)],
      base_front: [T(0, K.Tc, zcF)],
      base_rear: [T(0, K.Tc, zcR)],
      upright_front_R: [T(uxF, bt, zcF)],
      upright_front_L: [T(-uxF, bt, zcF)],
      upright_rear_R: [T(uxR, bt, zcR)],
      upright_rear_L: [T(-uxR, bt, zcR)],
      frame_front: [T(0, A, 0)],
      frame_rear: [T(0, A, zr)],
      bellows_frame_front: [T(0, A, K.Tf)],
      bellows_frame_rear: [M.mul(T(0, A, zr), M.Ry(180))],
      lens_board: [T(0, A, 0)],
      latch: [
        M.chain(T(0, A + D.board.h / 2 + D.c + 6, -2.5), M.Rz(-90)),
        M.chain(T(0, A - D.board.h / 2 - D.c - 6, -2.5), M.Rz(90)),
      ],
      back_plate: [T(0, A, zr + K.Tf)],
      gg_frame: [T(0, A, zr + K.Tf + K.backT)],
      spring_bar: [T(0, A, zb), M.chain(T(0, A, zb + K.barT), M.Ry(180))],
      knob: [
        M.chain(T(uxF + K.Tu / 2, A, zcF), M.Ry(90)), M.chain(T(-uxF - K.Tu / 2, A, zcF), M.Ry(-90)),
        M.chain(T(uxR + K.Tu / 2, A, zcR), M.Ry(90)), M.chain(T(-uxR - K.Tu / 2, A, zcR), M.Ry(-90)),
      ],
      knob_small: [
        M.chain(T(0, bt, zcF), M.Rx(-90)), M.chain(T(0, bt, zcR), M.Rx(-90)),
        M.chain(T(lockX, -D.wrap / 2, zcF), M.Ry(90)), M.chain(T(lockX, -D.wrap / 2, zcR), M.Ry(90)),
      ],
      tripod_block: [T(0, -D.rail.h, (zcF + zcR) / 2)],
      end_cap: [M.chain(T(0, 0, D.railZ0), M.Ry(180)), T(0, 0, D.railZ0 + D.railL)],
    };
  }

  /** Деталь в ориентации для печати: на столе (z ≥ 0), по центру XY. */
  function printOriented(part, csg) {
    const r = csg.transform(part.printT);
    const b = r.bounds();
    return r.translate(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]);
  }

  // ---------------------------------------------------------------------
  // Покупные изделия
  // ---------------------------------------------------------------------
  function hardwareList(D, cp, bm) {
    const tri = D.tri;
    return [
      { name: `Алюминиевый профиль ${D.rail.name}, паз 6 мм (серия 20)`, qty: 1, note: `длина ${D.railL} мм` },
      { name: 'Болт M5×30 (DIN 933, шестигранная головка)', qty: 4, note: 'оси наклона рамок, в барашках' },
      { name: 'Болт M5×25 (DIN 933)', qty: 2, note: 'оси поворота стоек, в малых барашках' },
      { name: 'Болт M5×16 (DIN 933)', qty: 2, note: 'фиксаторы кареток, в малых барашках' },
      { name: 'Болт M5×25 (DIN 912 или 933)', qty: 8, note: 'вертикали к основаниям' },
      { name: 'Гайка M5 (DIN 934)', qty: 16, note: 'вставляются в гнёзда деталей' },
      { name: 'Шайба M5', qty: 12, note: 'между вертикалью и рамкой, под головки' },
      { name: 'Болт M5×10 + Т-гайка M5 под паз 6 мм', qty: 2, note: 'штативная площадка' },
      { name: `Гайка ${tri.name} (штативная)`, qty: 1, note: 'в штативную площадку' },
      { name: 'Винт M3×16', qty: 8, note: 'рамки меха (саморезом в пластик)' },
      { name: 'Винт M3×12', qty: 4, note: 'плита задника к задней рамке' },
      { name: 'Винт M3×8 + шайба', qty: 8, note: 'защёлки платы (2), пружинные планки (6)' },
      { name: 'Винт M3×35', qty: 4, note: 'оси пружин задника' },
      { name: 'Пружина сжатия, внутр. Ø ≥ 3,5, нар. Ø ≤ 7, длина 12–15 мм', qty: 4, note: 'прижим матового стекла' },
      { name: 'Болт M5×10', qty: 2, note: 'заглушки рельса (нарезать M5 в центральном канале профиля)' },
      { name: `Матовое стекло ${D.glass[0]}×${D.glass[1]}×${cp.camGlassT} мм`, qty: 1, note: 'матовой стороной к объективу' },
      { name: `Объектив в затворе ${cp.camShutter === 'custom' ? `Ø${D.shutterD}` : SHUTTERS[cp.camShutter].name}`, qty: 1, note: '' },
      { name: `Кассеты ${FORMATS[cp.camFormat].name}`, qty: 1, note: `ширина ${D.holderW} мм` },
      { name: 'Материал меха (наружный + подкладка)', qty: 1, note: `≈ ${(bm.derived.fabricArea / 1e6).toFixed(2).replace('.', ',')} м² каждого` },
    ];
  }

  /** Текст README для архива: печать, сборка, юстировка, списки деталей. */
  function assemblyText(cam, bm) {
    const D = cam.dims, p = cam.params, F = FORMATS[p.camFormat];
    const f = (x) => (Math.round(x * 10) / 10).toString().replace('.', ',');
    const L = [];
    L.push(`МОНОРЕЛЬСОВАЯ КАМЕРА ${F.name} — КОМПЛЕКТ ДЛЯ 3D-ПЕЧАТИ`);
    L.push('');
    L.push(`Плата объектива ${D.board.w}×${D.board.h} мм, затвор Ø${D.shutterD} мм.`);
    L.push(`Мех: рамки ${f(bm.derived.mid.fW)}×${f(bm.derived.mid.fH)} → ${f(bm.derived.mid.rW)}×${f(bm.derived.mid.rH)} мм, растяжение ${f(D.eMin)}…${f(D.eMax)} мм.`);
    L.push(`Оптическая ось на высоте ${f(D.A)} мм над рельсом. Рельс ${D.rail.name}, ${D.railL} мм.`);
    L.push(`Подвижки: передняя рамка — подъём/опускание ±${p.camRise} мм, сдвиг ±${p.camShift} мм, наклон, поворот;`);
    L.push(`задняя — сдвиг ±${p.camShift} мм, наклон, поворот. Задник поворачивается на 90° (4 винта).`);
    L.push('');
    L.push('ВНИМАНИЕ. Размеры кассет и глубина плоскости плёнки взяты по справочным данным.');
    L.push('До печати задника измерьте свою кассету и введите ширину и глубину в параметрах.');
    L.push('');
    L.push('1. ПЕЧАТЬ');
    L.push('   Пластик — PETG (лучше) или PLA. 4 периметра, 4 слоя сверху и снизу, заполнение 30–40 %.');
    L.push('   Слой 0,2 мм; плиту задника и рамку матового стекла — слоем 0,1 мм (от них зависит резкость).');
    L.push('   Файлы уже развёрнуты для печати без поддержек. Число в имени файла после «x» — сколько штук печатать.');
    L.push('   Отверстия M3 под саморез — 2,8 мм, сквозные M3 — 3,4 мм, M5 — 5,4 мм. Гнёзда гаек рассчитаны');
    L.push(`   с зазором ${p.camClearance} мм: если гайка не входит, прогрейте её паяльником и вдавите.`);
    L.push('   Для непрозрачности внутренние детали (рамки, задник) печатайте чёрным пластиком.');
    L.push('');
    L.push('2. СБОРКА');
    L.push('   Каретки: гайку M5 вдавить в гнездо снизу верхней полки (ось поворота) и в боковое гнездо (фиксатор).');
    L.push('   В барашки вклеить (или вдавить) головки болтов: большие — 4× M5×30 (наклон), малые — 2× M5×25 (поворот), 2× M5×16 (фиксаторы).');
    L.push('   Стойки: гайки M5 вставить сбоку в ножки вертикалей, привернуть вертикали к основаниям снизу болтами M5×25.');
    L.push('   Основание ставится на каретку, барашек M5×25 проходит через паз основания в гайку каретки:');
    L.push('   ослабили — стойка поворачивается и сдвигается вбок; затянули — зафиксирована.');
    L.push('   Рамки: гайки M5 вставить в пазы с лицевой стороны боковин. Рамку поставить между вертикалями,');
    L.push('   шайбы между рамкой и вертикалью, барашки M5×30 снаружи. Ослабили — рамка наклоняется и (спереди) поднимается.');
    L.push('   Мех: манжеты вклеить на бортики рамок меха (клей для кожи/ткани), рамки меха привернуть винтами M3×16');
    L.push('   к стойкам: спереди — винты со стороны объектива, сзади — со стороны задника (до установки задника).');
    L.push('   Объективная плата: затвор в отверстие платы, плата в гнездо передней рамки, фиксация двумя защёлками (M3×8).');
    L.push('   Задник: плиту привернуть к задней рамке 4 винтами M3×12 (головки утоплены). Матовое стекло вложить');
    L.push('   в рамку матовой стороной к объективу, закрепить каплями силикона. Рамку положить на плиту между');
    L.push('   направляющими, сверху пружинные планки (6× M3×8), через планки — 4 винта M3×35 с пружинами в плиту.');
    L.push('   Кассета вставляется между плитой и рамкой стекла, приподнимая её.');
    L.push('   Штативная площадка: гайка штативной резьбы в гнездо сверху, площадка крепится под рельс двумя');
    L.push('   Т-гайками M5. Заглушки на торцы рельса — чтобы каретки не соскочили.');
    L.push('');
    L.push('3. ЮСТИРОВКА');
    L.push('   Сфокусируйтесь по матовому стеклу на резкий объект (лупа), снимите тестовый кадр при открытой диафрагме.');
    L.push('   Если плёнка нерезкая — плоскость стекла не совпадает с плоскостью плёнки: подложите тонкие прокладки');
    L.push('   под уступ стекла (стекло дальше от объектива) или измените «глубину плоскости плёнки» и перепечатайте рамку стекла.');
    L.push('   Проверьте светонепроницаемость: фонариком внутри камеры в тёмной комнате.');
    L.push('');
    L.push('4. ДЕТАЛИ ДЛЯ ПЕЧАТИ');
    for (const part of cam.parts) L.push(`   ${part.qty} × ${part.name}${part.note ? ` (${part.note})` : ''}`);
    L.push('');
    L.push('5. ПОКУПНОЕ');
    for (const h of cam.hardware) L.push(`   ${h.qty} × ${h.name}${h.note ? ` — ${h.note}` : ''}`);
    L.push('');
    L.push('6. МЕХ');
    L.push('   Папка bellows: развёртка 1:1 (SVG, DXF), чертёж меха, STL плашек с картами раскладки на стол.');
    L.push('');
    return L.join('\n');
  }

  return {
    FORMATS, BOARDS, SHUTTERS, RAILS, TRIPOD, CAM_DEFAULTS, K,
    normalizeCamParams, computeCamera, placements, printOriented, assemblyText, railCSG,
  };
});
