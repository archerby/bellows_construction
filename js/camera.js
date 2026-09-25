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
    '4x5': { name: '4×5″ (9×12)', film: [97, 122], holderW: 121, holderT: 10.5, holderL: 165, depth: 5.0 },
    '5x7': { name: '5×7″ (13×18)', film: [122, 173], holderW: 147, holderT: 11, holderL: 218, depth: 5.8 },
    '8x10': { name: '8×10″ (18×24)', film: [198, 249], holderW: 250, holderT: 12, holderL: 300, depth: 6.6 },
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
  const FW = { M5: 1, M3: 0.5 }; // толщина шайб DIN 125

  const STYLES = {
    monorail: { name: 'монорельсовая (студийная)' },
    field: { name: 'складная полевая (коробка + откидная станина)' },
  };

  const CAM_DEFAULTS = {
    camStyle: 'monorail',
    camFieldRise: 15, // подъём/опускание у складной камеры, ±мм
    camLensFold: 30, // насколько объектив выступает вперёд от платы — должен поместиться в сложенную коробку
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
    camSplit: true, // разбивать детали, не влезающие на стол
    camBedW: 220,
    camBedH: 220,
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
    if (!STYLES[p.camStyle]) p.camStyle = CAM_DEFAULTS.camStyle;
    p.camFieldRise = Math.max(0, p.camFieldRise);
    p.camLensFold = Math.max(0, p.camLensFold);
    if (!FORMATS[p.camFormat]) p.camFormat = CAM_DEFAULTS.camFormat;
    if (!BOARDS[p.camBoard]) p.camBoard = CAM_DEFAULTS.camBoard;
    if (!SHUTTERS[p.camShutter]) p.camShutter = CAM_DEFAULTS.camShutter;
    if (!RAILS[p.camRail]) p.camRail = CAM_DEFAULTS.camRail;
    if (!TRIPOD[p.camTripod]) p.camTripod = CAM_DEFAULTS.camTripod;
    p.camClearance = Math.max(0, Math.min(1, p.camClearance));
    p.camRise = Math.max(0, p.camRise);
    p.camShift = Math.max(0, p.camShift);
    p.camBedW = Math.max(60, p.camBedW);
    p.camBedH = Math.max(60, p.camBedH);
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
    triFloor: 2.5, // пластик под штативной гайкой
    triBoltFloor: 5, // полка под головками винтов Т-гаек штативной площадки
    capLip: 3, // заглушка рельса шире профиля — упор для кареток
    corner: 8, // отступ крепёжных винтов рамок от края
  };

  // Складная камера
  const FK = {
    wall: 5, // стенки коробки
    floorT: 8, // дно коробки
    Trw: 10, // задняя стенка (к ней крепится задник)
    railH: 5, railWb: 8, railWt: 11, // рельсы «ласточкин хвост»: низ 8, верх 11, высота 5
    bedT: 8, // толщина станины
    sledBody: 8, // салазки над пазами
    tc: 6, // щёки шарнира станины
    gap: 0.5,
    earR: 9, // проушины шарнира на боковинах
    lockZ: 9, // фиксатор салазок — от переднего края
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
    if (cp.camStyle === 'monorail' && cp.camRailLength > 0 && cp.camRailLength < railNeed) {
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

    // глухое отверстие оси наклона в боковине рамки: как можно глубже, но не ближе 1,5 мм к окну
    const tiltHole = (S, open) => Math.min(16, (S - open) / 2 - 1.5);
    const dims = {
      hdF: tiltHole(Sf, boardOpen[0]), hdR: tiltHole(Sr, Or),
      style: cp.camStyle, rise: cp.camRise,
      c, film, holderW, holderT: F.holderT, holderL: F.holderL, depth, board, shutterD, rail, tri, boardOpen, Or, Sf, Sr, guideIn, guideOut, guideC, guideH, Tg, glass,
      wrap, baseTop, A, HuF, HuR, eMin, eMax, railL, railNeed, railZ0, bfF, bfR, K,
    };
    let zF = (e) => 0; // передняя плоскость передней рамки (монорельс: всегда 0)
    if (cp.camStyle === 'field') {
      const fb = fieldDims(dims, cp, bm, warnings);
      Object.assign(dims, { fb, rise: cp.camFieldRise, A: fb.A, HuF: fb.HuF, baseTop: fb.sledTop, eMin: fb.eMin, eMax: fb.eMax });
      zF = fb.zF;
    }
    const parts = buildPartList(dims, cp);
    const cam = { ok: true, params: cp, errors, warnings, dims, parts, zR, zF };
    // длины крепежа — из геометрии сборки (от растяжения не зависят)
    cam.fasteners = fastenerLayout(cam, dims.eMin, false, {});
    const bad = [...new Set(cam.fasteners.filter((x) => !x.len).map((x) => FX_LABEL[x.key]))];
    for (const b of bad) warnings.push(`Не удаётся подобрать стандартную длину винта: ${b}. Проверьте размеры.`);
    cam.spring = springCalc(dims);
    cam.hardware = hardwareList(dims, cp, bm, cam);
    return cam;
  }

  /**
   * Размеры складной камеры. Начало координат: y = 0 — верх дна коробки (и верх открытой станины),
   * z = 0 — передняя плоскость коробки (ось шарнира станины), коробка — z ∈ [0, depth].
   */
  function fieldDims(D, cp, bm, warnings) {
    const d = bm.derived, bp = bm.params;
    const rise = cp.camFieldRise;
    const sledTop = FK.railH + FK.sledBody;
    const uxFace = D.Sf / 2 + K.washer + K.Tu; // наружная плоскость вертикалей
    const rx = Math.max(25, Math.min(D.Sf / 2 - 12, uxFace - 20)); // оси рельсов
    // ось объектива: рамка при опускании не задевает фиксатор, задняя рамка меха и окно — над рельсами
    const A = Math.ceil(Math.max(
      sledTop + D.Sf / 2 + rise + K.knobSH + 4,
      D.Sr / 2 + sledTop + 2,
    ));
    // задняя рамка меха (размер задника) стоит внутри коробки — внутренняя высота и ширина не меньше неё
    const Htop = Math.ceil(A + Math.max(D.Sr / 2 + 1, rise + 16 + 3, D.Sf / 2 + rise + 3) + FK.wall);
    // ширина: стойка с барашками проходит в проём, щёки шарнира — снаружи пути салазок
    const W = Math.ceil(Math.max(D.Sr + 2 * FK.wall + 2, 2 * (uxFace + K.knobSH + 2 + FK.wall), 2 * (uxFace + 1 + FK.gap + FK.tc + FK.wall)));
    const eMin = Math.max(d.minFrame, D.bfF.lipLen + D.bfR.lipLen + 2);
    // глубина: задняя стенка + сложенный мех + рамка + выступ объектива + рельсы закрытой станины
    const depth = Math.ceil(FK.Trw + 2 * K.tPlate + eMin + K.Tf + cp.camLensFold + FK.railH + 3);
    const zRW = depth - FK.Trw; // внутренняя плоскость задней стенки
    const Lbed = Htop - 2;
    const zF = (e) => zRW - 2 * K.tPlate - e - K.Tf;
    const zFmin = -Lbed + 2 + K.Du / 2 - K.Tf / 2; // салазки доходят до конца станины
    const eMaxGeom = Math.floor(zRW - 2 * K.tPlate - K.Tf - zFmin);
    const eMax = Math.min(bp.maxExt, eMaxGeom);
    if (bp.maxExt > eMaxGeom + 1) {
      warnings.push(`Станина складной камеры позволяет растянуть мех только до ${eMaxGeom} мм (у меха задано ${bp.maxExt}). Уменьшите растяжение меха до ${eMaxGeom} мм — мех станет короче и компактнее.`);
    }
    if (eMax < 120) warnings.push(`Растяжение складной камеры всего ${Math.round(eMax)} мм — подойдут только короткофокусные объективы.`);
    const HuF = Math.ceil(A - sledTop + rise + 14);
    return {
      W, Htop, floorT: FK.floorT, depth, zRW, Lbed, A, sledTop, rx, uxFace, eMin, eMax, eMaxGeom, HuF, zF,
      lensFold: cp.camLensFold,
      closed: { w: W + 2 * 3, h: Htop + FK.floorT, d: depth + FK.bedT + K.backT + D.Tg + K.barT },
    };
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
        // гнездо открыто к рельсу: винт, упираясь в рельс, прижимает гайку к стенке (снаружи она выпала бы)
        hexX(hw - 1, hw + nutH, ly, 0, nutAF),
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
    const upF = upright(D.HuF, D.A - D.baseTop, 2 * D.rise);
    const upR = upright(D.HuR, D.A - D.baseTop, 0);
    const mirror = M.S(-1, 1, 1);
    add('upright_front_R', 'Вертикаль передней стойки, правая', 1, COL.struct, upF, face.xUp);
    add('upright_front_L', 'Вертикаль передней стойки, левая', 1, COL.struct, () => upF().transform(mirror), M.Ry(90));
    add('upright_rear_R', 'Вертикаль задней стойки, правая', 1, COL.struct, upR, face.xUp);
    add('upright_rear_L', 'Вертикаль задней стойки, левая', 1, COL.struct, () => upR().transform(mirror), M.Ry(90));

    // --- Общая часть рамок: скруглённый контур с фасками, окно, оси наклона.
    // Гнёзда гаек открыты на ту сторону, которую закрывает рамка меха, — снаружи их не видно.
    const frameBase = (S, ow, oh, pocketFromRear, hd) => {
      const s = chamferPrism(rrect(-S / 2, -S / 2, S / 2, S / 2, K.R, 10), 0, K.Tf, K.ch, K.ch)
        .subtract(box(-ow / 2, -oh / 2, -1, ow / 2, oh / 2, K.Tf + 1));
      const cuts = [];
      for (const sx of [-1, 1]) {
        const px = sx * (S / 2 - 7);
        cuts.push(cylX(sx * (S / 2 + 1), sx * (S / 2 - hd), 0, K.Tf / 2, HW.M5.hole));
        const [z0, z1] = pocketFromRear ? [K.Tf / 2 - nutR, K.Tf + 1] : [-1, K.Tf / 2 + nutR];
        cuts.push(box(px - nutH / 2, -nutAF / 2, z0, px + nutH / 2, nutAF / 2, z1));
      }
      return { s, cuts };
    };
    const cornerHoles = (S) => [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => [sx * (S / 2 - K.corner), sy * (S / 2 - K.corner)]);

    // --- Передняя рамка (под объективную плату): лицевая сторона чистая
    add('frame_front', 'Передняя рамка (под плату)', 1, COL.frame, () => {
      const { s, cuts } = frameBase(D.Sf, D.boardOpen[0], D.boardOpen[1], true, D.hdF);
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
      const { s, cuts } = frameBase(D.Sr, D.Or, D.Or, false, D.hdR);
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
      // заход 45° по лицевой стороне у торцов: вставляемая кассета сама приподнимает рамку на пружинах
      const r = 2.5;
      for (const sy of [-1, 1]) {
        const y0 = sy * Hg / 2;
        const tri = [[y0 - sy * r, -0.01], [y0 + sy * 0.01, -0.01], [y0 + sy * 0.01, r]];
        cuts.push(CSG.prism(tri, -Wg / 2 - 1, Wg / 2 + 1).transform(ALONG.x));
      }
      // упор для пальца сверху — приподнять рамку, чтобы посмотреть на кассету или вынуть её
      const grip = chamferPrism(rrect(-18, Hg / 2 - 10, 18, Hg / 2 - 4, 3), D.Tg - 0.5, D.Tg + 3, 0, 0.6);
      return s.union(grip).subtractAll(cuts);
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
    if (D.style === 'field') {
      add('knob_small', 'Барашек: наклон, шарнир станины, фиксатор салазок', 5, COL.accent, knob(K.knobSD, K.knobSH, 18), face.up);
    } else {
      add('knob', 'Барашек наклона (под болт M5)', 4, COL.accent, knob(K.knobD, K.knobH, 24), face.up);
      add('knob_small', 'Малый барашек: поворот стойки, фиксатор каретки', 4, COL.accent, knob(K.knobSD, K.knobSH, 18), face.up);
    }

    // --- Штативная площадка
    const slotsX = D.rail.w >= 40 ? [-10, 10] : [0];
    add('tripod_block', `Штативная площадка (гайка ${D.tri.name})`, 1, COL.carriage, () => {
      const W = Math.max(D.rail.w, 30) + 10;
      const s = chamferPrism(rrect(-W / 2, -24, W / 2, 24, 5), -12, 0, 1, 0).transform(ALONG.y);
      // гайка опускается сверху до дна гнезда: под ней 2,5 мм — винт штатива (5–6 мм) достаёт до резьбы
      const cuts = [cylY(-13, 1, 0, 0, D.tri.hole), hexY(-12 + K.triFloor, 1, 0, 0, D.tri.nutAF + c)];
      for (const x of slotsX) for (const z of [-15, 15]) cuts.push(cylY(-13, 1, x, z, HW.M5.hole), cylY(-13, -K.triBoltFloor, x, z, 9.5));
      return s.subtractAll(cuts);
    }, face.yUp);

    // --- Заглушки рельса
    add('end_cap', 'Заглушка торца рельса', 2, COL.carriage, () => {
      // выступает за профиль сбоку и сверху: в неё упираются стенки и полка каретки
      const s = chamferPrism(rrect(-D.rail.w / 2 - K.capLip, -D.rail.h, D.rail.w / 2 + K.capLip, K.capLip + 1, 2, 4), 0, 4, 0, 0.8);
      const cuts = [];
      for (let i = 0; i < D.rail.w / 20; i++) for (let j = 0; j < D.rail.h / 20; j++) {
        cuts.push(cylZ(-1, 5, -D.rail.w / 2 + 10 + i * 20, -10 - j * 20, HW.M5.hole));
      }
      return s.subtractAll(cuts);
    }, face.up);

    if (D.style === 'field') {
      const MONO_ONLY = new Set(['carriage', 'base_front', 'base_rear', 'upright_rear_R', 'upright_rear_L', 'frame_rear', 'tripod_block', 'end_cap']);
      const keep = L.filter((x) => !MONO_ONLY.has(x.key));
      L.length = 0;
      L.push(...fieldParts(D, cp, { nutAF, nutH, pinwheel, cornerHoles }), ...keep);
    }
    return L;
  }

  // ---------------------------------------------------------------------
  // Детали складной камеры
  // ---------------------------------------------------------------------
  /** Рельс «ласточкин хвост» вдоль Z: низ railWb (+2e), верх railWt (+2e), от z0 до z1. */
  function dovetail(x, z0, z1, e, yBottom) {
    const b = FK.railWb / 2 + e, t = FK.railWt / 2 + e, h = FK.railH + e;
    return CSG.prism([[x - b, yBottom], [x + b, yBottom], [x + t, h], [x - t, h]], z0, z1);
  }

  function fieldParts(D, cp, h) {
    const f = D.fb, c = D.c;
    const out = [];
    const add = (key, name, qty, color, build, printT, note) => out.push({ key, name, qty, color, build, printT: printT || M.I(), note: note || '' });
    const W = f.W, wall = FK.wall;
    const cheekX0 = W / 2 - wall - FK.gap - FK.tc, cheekX1 = W / 2 - wall - FK.gap; // щёки станины (внутри боковин)

    // --- Корпус: коробка со скруглёнными рёбрами, задняя стенка под задник, рельсы на дне, проушины шарнира
    add('body', 'Корпус (коробка)', 1, COL.frame, () => {
      const y0 = -FK.floorT, y1 = f.Htop, Dz = f.depth;
      let s = chamferPrism(rrect(-W / 2, y0, W / 2, y1, [[5, 6], [K.R, 10], [K.R, 10], [5, 6]]), 0, Dz, K.ch, K.ch);
      s = s.subtract(box(-W / 2 + wall, 0, -1, W / 2 - wall, y1 - wall, f.zRW));
      const adds = [];
      for (const sx of [-1, 1]) {
        adds.push(CSG.cylinder([sx * (W / 2 - wall), 0, 0], [sx * W / 2, 0, 0], FK.earR, 48));
        // рельсы дна начинаются за зоной, куда заходят рельсы закрытой станины
        adds.push(dovetail(sx * f.rx, FK.railH + 1.5, f.zRW + 0.5, 0, -0.5));
      }
      s = s.unionAll(adds);
      const cuts = [box(-D.Or / 2, f.A - D.Or / 2, f.zRW - 1, D.Or / 2, f.A + D.Or / 2, Dz + 1)];
      for (const [x, y] of h.cornerHoles(D.Sr)) {
        cuts.push(cylZ(f.zRW - 1, Dz + 1, x, f.A + y, HW.M3.hole), cylZ(Dz - HW.M3.cbH, Dz + 1, x, f.A + y, HW.M3.cbD));
      }
      for (const [x, y] of h.pinwheel(D.Sr)) cuts.push(cylZ(Dz - 9, Dz + 1, x, f.A + y, HW.M3.selfTap));
      for (const sx of [-1, 1]) {
        cuts.push(cylX(sx * (W / 2 + 1), sx * (W / 2 - wall - 1), 0, 0, HW.M5.hole));
        // выемка в дне под щёку станины
        const a = sx * (cheekX0 - 0.5), b = sx * (cheekX1 + 0.3);
        cuts.push(CSG.cylinder([Math.min(a, b), 0, 0], [Math.max(a, b), 0, 0], FK.earR + 0.6, 48));
      }
      // штативная гайка в дне (вставляется изнутри, тянется винтом штатива вниз — упирается в дно)
      cuts.push(cylY(-FK.floorT - 1, 1, 0, Dz / 2, D.tri.hole), hexY(-(D.tri.nutH + c), 1, 0, Dz / 2, D.tri.nutAF + c));
      return s.subtractAll(cuts);
    }, M.Ry(180), 'задней стенкой на стол');

    // --- Станина: откидывается вниз и становится направляющей; закрытая — крышка коробки
    add('bed', 'Откидная станина (крышка)', 1, COL.struct, () => {
      const L = f.Lbed, T = FK.bedT;
      let s = chamferPrism(rrect(-W / 2, 0, W / 2, L, [[0, 1], [K.R, 10], [K.R, 10], [0, 1]]), -T, 0, 0.6, 1).transform(ALONG.y);
      const adds = [];
      for (const sx of [-1, 1]) {
        adds.push(dovetail(sx * f.rx, -L + 4, -0.5, 0, -0.5));
        const a = sx * cheekX0, b = sx * cheekX1;
        adds.push(CSG.cylinder([Math.min(a, b), 0, 0], [Math.max(a, b), 0, 0], FK.earR, 48));
        adds.push(box(Math.min(a, b), -T, -24, Math.max(a, b), 0, 0));
      }
      s = s.unionAll(adds);
      const cuts = [];
      for (const sx of [-1, 1]) {
        // место под проушины корпуса
        const a = sx * (W / 2 - wall - FK.gap), b = sx * (W / 2 + 1);
        cuts.push(CSG.cylinder([Math.min(a, b), 0, 0], [Math.max(a, b), 0, 0], FK.earR + FK.gap, 48));
        cuts.push(cylX(sx * cheekX1 + sx, sx * cheekX0 - sx, 0, 0, HW.M5.hole));
        const xi = sx * cheekX0; // внутренняя сторона щеки — гнездо гайки
        cuts.push(sx > 0 ? hexX(xi - 1, xi + h.nutH, 0, 0, h.nutAF) : hexX(xi - h.nutH, xi + 1, 0, 0, h.nutAF));
      }
      return s.subtractAll(cuts);
    }, M.Rx(90), 'рельсами вверх');

    // --- Салазки передней стойки: пазы под рельсы, фиксатор сверху, крепление вертикалей снизу (головки утоплены)
    add('sled', 'Салазки передней стойки', 1, COL.carriage, () => {
      const hx = f.uxFace, L = K.Du, yb = 0.3, yt = f.sledTop;
      const s = chamferPrism(rrect(-hx, -L / 2, hx, L / 2, 5), yb, yt, 0.6, 1).transform(ALONG.y);
      const cuts = [];
      for (const sx of [-1, 1]) cuts.push(dovetail(sx * f.rx, -L / 2 - 1, L / 2 + 1, c, -1));
      const zl = -L / 2 + FK.lockZ, yg = FK.railH + c; // фиксатор над правым рельсом, перед рамкой
      cuts.push(cylY(yg - 1, yt + 1, f.rx, zl, HW.M5.hole), hexY(yg - 0.01, yg + h.nutH, f.rx, zl, h.nutAF));
      const ux = D.Sf / 2 + K.washer + K.Tu / 2;
      for (const sx of [-1, 1]) for (const sz of [-K.footZ, K.footZ]) {
        cuts.push(cylY(yb - 1, yt + 1, sx * ux, sz, HW.M5.hole), cylY(yb - 1, yb + HW.M5.headH + 1.7, sx * ux, sz, 9.5));
      }
      return s.subtractAll(cuts);
    }, M.Rx(-90), 'пазами вверх');
    return out;
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
  /** Защёлки платы: лежат на лицевой стороне рамки (z = zF), скруглённой стороной наружу, плечо — на плату. */
  function latchPlacements(D, A, zF) {
    const y = D.board.h / 2 + D.c + 6;
    return [
      M.chain(M.T(0, A + y, zF), M.Rz(-90), M.Rx(180)),
      M.chain(M.T(0, A - y, zF), M.Rz(90), M.Rx(180)),
    ];
  }

  function placements(cam, e, folded, opts) {
    if (cam.dims.style === 'field') return fieldPlacements(cam, e, folded, opts);
    const D = cam.dims;
    const lift = opts && opts.holder ? D.holderT : 0; // вставленная кассета приподнимает рамку стекла
    const zr = cam.zR(e);
    const A = D.A, bt = D.baseTop;
    const zcF = K.Tf / 2, zcR = zr + K.Tf / 2; // стойки симметричны относительно оси наклона
    const T = M.T;
    const uxF = D.Sf / 2 + K.washer + K.Tu / 2, uxR = D.Sr / 2 + K.washer + K.Tu / 2;
    const lockX = D.rail.w / 2 + D.c + K.Tw;
    const zb = zr + K.Tf + K.backT + D.Tg + lift;
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
      latch: latchPlacements(D, A, 0),
      back_plate: [T(0, A, zr + K.Tf)],
      gg_frame: [T(0, A, zr + K.Tf + K.backT + lift)],
      spring_bar: [T(0, A, zb), M.chain(T(0, A, zb + K.barT), M.Ry(180))],
      knob: [
        M.chain(T(uxF + K.Tu / 2, A, zcF), M.Ry(90)), M.chain(T(-uxF - K.Tu / 2, A, zcF), M.Ry(-90)),
        M.chain(T(uxR + K.Tu / 2, A, zcR), M.Ry(90)), M.chain(T(-uxR - K.Tu / 2, A, zcR), M.Ry(-90)),
      ],
      knob_small: [
        M.chain(T(0, bt + FW.M5, zcF), M.Rx(-90)), M.chain(T(0, bt + FW.M5, zcR), M.Rx(-90)), // на шайбе
        M.chain(T(lockX, -D.wrap / 2, zcF), M.Ry(90)), M.chain(T(lockX, -D.wrap / 2, zcR), M.Ry(90)),
      ],
      tripod_block: [T(0, -D.rail.h, (zcF + zcR) / 2)],
      end_cap: [M.chain(T(0, 0, D.railZ0), M.Ry(180)), T(0, 0, D.railZ0 + D.railL)],
    };
  }

  /** Складная камера: открыта (станина вниз, стойка на расстоянии e) или сложена (стойка в коробке, станина закрыта). */
  function fieldPlacements(cam, e, folded, opts) {
    const D = cam.dims, f = D.fb, T = M.T;
    const ee = folded ? f.eMin : e;
    const zF = f.zF(ee), zc = zF + K.Tf / 2, A = f.A, st = f.sledTop;
    const ux = D.Sf / 2 + K.washer + K.Tu / 2;
    const lift = opts && opts.holder ? D.holderT : 0;
    const zb = f.depth + K.backT + D.Tg + lift;
    return {
      body: [M.I()],
      bed: [folded ? M.Rx(90) : M.I()],
      sled: [T(0, 0, zc)],
      upright_front_R: [T(ux, st, zc)],
      upright_front_L: [T(-ux, st, zc)],
      frame_front: [T(0, A, zF)],
      lens_board: [T(0, A, zF)],
      latch: latchPlacements(D, A, zF),
      bellows_frame_front: [T(0, A, zF + K.Tf)],
      bellows_frame_rear: [M.mul(T(0, A, f.zRW), M.Ry(180))],
      back_plate: [T(0, A, f.depth)],
      gg_frame: [T(0, A, f.depth + K.backT + lift)],
      spring_bar: [T(0, A, zb), M.chain(T(0, A, zb + K.barT), M.Ry(180))],
      knob_small: [
        M.chain(T(ux + K.Tu / 2, A, zc), M.Ry(90)), M.chain(T(-ux - K.Tu / 2, A, zc), M.Ry(-90)),
        M.chain(T(f.W / 2 + FW.M5, 0, 0), M.Ry(90)), M.chain(T(-f.W / 2 - FW.M5, 0, 0), M.Ry(-90)), // на шайбах
        M.chain(T(f.rx, st, zc - K.Du / 2 + FK.lockZ), M.Rx(-90)),
      ],
    };
  }

  // ---------------------------------------------------------------------
  // Крепёж: где стоит каждый болт и винт, через что проходит, во что вворачивается.
  // Длина подбирается из стандартного ряда по геометрии: болт должен пройти гайку,
  // но не упереться в дно глухого отверстия или в рельс. Тесты проверяют это на телах деталей.
  // ---------------------------------------------------------------------
  const STD_LEN = { M5: [8, 10, 12, 16, 20, 25, 30, 35, 40], M3: [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50] };
  const THREAD_MIN = { nut: 3.2, M3: 4.5 }; // зацепление: гайка — 4 витка из 5, саморез M3 — 1,5 d
  const SPRING_SOLID = 7; // пружина задника, сжатая вставленной кассетой, не короче этого

  function pickLen(size, lo, hi, pick) {
    const ok = STD_LEN[size].filter((L) => L >= lo - 1e-6 && L <= hi + 1e-6);
    if (!ok.length) return null;
    return pick === 'min' ? ok[0] : ok[ok.length - 1];
  }

  const FX_LABEL = {
    tilt: 'оси наклона рамок, головка в барашке',
    pivot: 'оси поворота стоек, в малых барашках, шайба под барашек',
    lock: 'фиксаторы кареток, в малых барашках (упираются в рельс)',
    feet: 'вертикали к основаниям, снизу, с шайбой',
    hinge: 'шарнир станины, в малых барашках, шайба под барашек',
    sledlock: 'фиксатор салазок, в малом барашке (упирается в рельс)',
    sledup: 'вертикали к салазкам, снизу, головки в цековках',
    bfF: 'передняя рамка меха, саморезом в пластик',
    bfR: 'задняя рамка меха, саморезом в пластик',
    back: 'плита задника, головки утоплены',
    latch: 'защёлки платы, с шайбой',
    bar: 'пружинные планки к рамке стекла, с шайбой',
    spring: 'оси пружин задника',
    tripod: 'штативная площадка, в Т-гайки M5 под паз 6 мм',
    cap: 'заглушки рельса, нарезать M5 в канале профиля',
  };

  /**
   * Весь крепёж сборки в положении (e, folded). Для каждого экземпляра: size, kind (hex — DIN 933,
   * socket — DIN 912), p — точка под головкой, d — направление стержня, washer — шайба под головкой (мм),
   * nut — расстояние от головки до ближней грани гайки, thread — [s0, s1] резьба в пластике,
   * free — докуда стержень должен проходить свободно, len — подобранная длина.
   */
  function fastenerLayout(cam, e, folded, opts) {
    const D = cam.dims, c = D.c, field = D.style === 'field';
    const P = placements(cam, e, folded, opts);
    const at = (m, p) => M.apply(m, p);
    const dirOf = (m, d) => { const a = at(m, [0, 0, 0]), b = at(m, d); return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; };
    const nutHp = HW.M5.nutH + c; // высота гнезда гайки
    const out = [];
    const add = (key, o) => out.push(Object.assign({ key, size: 'M5', kind: 'hex', washer: 0, nut: null, thread: null, stack: 0 }, o));
    const knob = (m) => ({ p: at(m, [0, 0, 0]), d: dirOf(m, [0, 0, -1]) });
    const nutJoint = (s0, end) => ({ nut: s0, lo: s0 + THREAD_MIN.nut, hi: end - 0.5, pick: 'max' });
    const tapM3 = (s0, s1, tail) => ({ size: 'M3', kind: 'socket', thread: [s0, s1], lo: s0 + THREAD_MIN.M3, hi: s1 + tail, pick: 'max' });
    const setScrew = (s0, stop) => ({ nut: s0, stop, lo: stop + 1.5, hi: stop + 4, pick: 'min', free: stop - 0.05 });

    // оси наклона: барашек на вертикали → вертикаль → шайба → гайка в боковине рамки → глухое отверстие
    const tiltKnobs = field ? P.knob_small.slice(0, 2) : P.knob;
    tiltKnobs.forEach((m, i) => {
      const hd = !field && i >= 2 ? D.hdR : D.hdF, s = K.Tu + K.washer;
      add('tilt', Object.assign(knob(m), { stack: 1 }, nutJoint(s + 7 - nutHp / 2, s + hd)));
    });

    if (!field) {
      // ось поворота стойки: барашек на шайбе → основание → верх каретки → гайка снизу; дальше рельс
      P.knob_small.slice(0, 2).forEach((m) => {
        const k = knob(m), y = k.p[1];
        add('pivot', Object.assign(k, { washer: FW.M5 }, nutJoint(y - nutHp, y + 0.2)));
      });
      // фиксатор каретки: винт через стенку упирается в рельс
      P.knob_small.slice(2, 4).forEach((m) => add('lock', Object.assign(knob(m), setScrew(K.Tw - nutHp, K.Tw + c))));
      // вертикали к основаниям: болт снизу через основание в гайку ножки
      for (const k of ['upright_front_R', 'upright_front_L', 'upright_rear_R', 'upright_rear_L']) {
        const o = at(P[k][0], [0, 0, 0]);
        for (const dz of [-K.footZ, K.footZ]) {
          const su = FW.M5 + K.Tb;
          add('feet', Object.assign({ p: [o[0], o[1] - su, o[2] + dz], d: [0, 1, 0], washer: FW.M5 },
            nutJoint(su + K.footNutY - nutHp / 2, su + K.footNutY + 8)));
        }
      }
      // штативная площадка к рельсу: винт снизу через полку в Т-гайку в пазу (паз ~6 мм глубиной)
      const mt = P.tripod_block[0];
      for (const x of D.rail.w >= 40 ? [-10, 10] : [0]) for (const z of [-15, 15]) {
        const s0 = K.triBoltFloor;
        add('tripod', { p: at(mt, [x, -K.triBoltFloor, z]), d: dirOf(mt, [0, 1, 0]), kind: 'socket', lo: s0 + 1.8 + 2.5, hi: s0 + 6, pick: 'max', free: s0 + 1.8 });
      }
      // заглушки рельса: винт в центральный канал профиля
      for (const m of P.end_cap) {
        for (let i = 0; i < D.rail.w / 20; i++) for (let j = 0; j < D.rail.h / 20; j++) {
          add('cap', { p: at(m, [-D.rail.w / 2 + 10 + i * 20, -10 - j * 20, 4]), d: dirOf(m, [0, 0, -1]), lo: 10, hi: 14, pick: 'min', free: 4 });
        }
      }
    } else {
      const f = D.fb;
      // шарнир станины: барашек на шайбе → проушина корпуса → зазор → щека станины с гайкой внутри
      P.knob_small.slice(2, 4).forEach((m) => {
        const cheekIn = FW.M5 + FK.wall + FK.gap + FK.tc;
        add('hinge', Object.assign(knob(m), { washer: FW.M5 }, nutJoint(cheekIn - nutHp, cheekIn + 1)));
      });
      // фиксатор салазок: винт через гайку упирается в верх рельса
      add('sledlock', Object.assign(knob(P.knob_small[4]), setScrew(f.sledTop - (FK.railH + c + nutHp), f.sledTop - FK.railH)));
      // вертикали к салазкам: винт DIN 912 снизу из цековки
      const yCb = 0.3 + HW.M5.headH + 1.7;
      for (const k of ['upright_front_R', 'upright_front_L']) {
        const o = at(P[k][0], [0, 0, 0]);
        for (const dz of [-K.footZ, K.footZ]) {
          const su = f.sledTop - yCb;
          add('sledup', Object.assign({ p: [o[0], yCb, o[2] + dz], d: [0, 1, 0], kind: 'socket' },
            nutJoint(su + K.footNutY - nutHp / 2, su + K.footNutY + 8)));
        }
      }
    }

    // рамки меха: винт M3 из цековки рамки стойки (или задней стенки коробки) насквозь в пластину рамки меха
    const corners = (S) => [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => [sx * (S / 2 - K.corner), sy * (S / 2 - K.corner)]);
    const mf = P.frame_front[0];
    for (const [x, y] of corners(D.Sf)) {
      const s0 = K.Tf - HW.M3.cbH;
      add('bfF', Object.assign({ p: at(mf, [x, y, HW.M3.cbH]), d: dirOf(mf, [0, 0, 1]) }, tapM3(s0, s0 + K.tPlate, 0.5)));
    }
    for (const [x, y] of corners(D.Sr)) {
      if (field) {
        const s0 = FK.Trw - HW.M3.cbH;
        add('bfR', Object.assign({ p: [x, D.A + y, D.fb.depth - HW.M3.cbH], d: [0, 0, -1] }, tapM3(s0, s0 + K.tPlate, 0.5)));
      } else {
        const mr = P.frame_rear[0], s0 = K.Tf - HW.M3.cbH;
        add('bfR', Object.assign({ p: at(mr, [x, y, K.Tf - HW.M3.cbH]), d: dirOf(mr, [0, 0, -1]) }, tapM3(s0, s0 + K.tPlate, 0.5)));
      }
    }
    // плита задника: винт из цековки в глухое отверстие задней рамки (задней стенки коробки) глубиной 9 мм
    const mb = P.back_plate[0], S = D.Sr, pa = S / 4, pb = S / 2 - 7;
    for (const [x, y] of [[pa, pb], [-pb, pa], [-pa, -pb], [pb, -pa]]) {
      const s0 = K.backT - HW.M3.cbH;
      add('back', Object.assign({ p: at(mb, [x, y, K.backT - HW.M3.cbH]), d: dirOf(mb, [0, 0, -1]) }, tapM3(s0, s0 + 9, -0.5)));
    }
    // защёлки: винт с шайбой через защёлку в рамку (глухое 8 мм)
    for (const m of P.latch) {
      const t = 2.5, s0 = t + FW.M3;
      add('latch', Object.assign({ p: at(m, [0, 0, t + FW.M3]), d: dirOf(m, [0, 0, -1]), washer: FW.M3 }, tapM3(s0, s0 + 8, -0.5)));
    }
    // пружинные планки к рамке стекла (глухое 7 мм)
    const Wg = D.holderW - 1, Hg = D.Sr - 10;
    for (const m of P.spring_bar) {
      const z = Math.max(at(m, [0, 0, 0])[2], at(m, [0, 0, K.barT])[2]);
      for (const sy of [1, 0, -1]) {
        const q = at(m, [Wg / 2 - 3.5, sy * (Hg / 2 - 20), 0]), s0 = FW.M3 + K.barT;
        add('bar', Object.assign({ p: [q[0], q[1], z + FW.M3], d: [0, 0, -1], washer: FW.M3 }, tapM3(s0, s0 + 7, -0.5)));
      }
    }
    // оси пружин: ввёрнуты в направляющие плиты задника, конец в 2 мм от лицевой стороны
    const zBack = at(mb, [0, 0, 0])[2], sp = springCalc(D);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const L = sp.len;
      add('spring', { size: 'M3', kind: 'socket', p: [sx * D.guideC, D.A + sy * (S / 2 - 15), zBack + 2 + L], d: [0, 0, -1],
        thread: [L + 2 - (K.backT + D.guideH), L + 1], lo: L, hi: L, pick: 'min' });
    }

    // длина — одна на группу: самая строгая по всем экземплярам
    const byKey = {};
    for (const x of out) {
      const g = byKey[x.key] || (byKey[x.key] = { lo: -Infinity, hi: Infinity, pick: x.pick, size: x.size });
      g.lo = Math.max(g.lo, x.lo); g.hi = Math.min(g.hi, x.hi);
    }
    for (const k of Object.keys(byKey)) byKey[k].len = pickLen(byKey[k].size, byKey[k].lo, byKey[k].hi, byKey[k].pick);
    for (const x of out) { x.len = byKey[x.key].len; if (x.free === undefined) x.free = x.len; }
    return out;
  }

  const HEAD = { hex: { M5: { r: HW.M5.headAF / 2, h: HW.M5.headH } }, socket: { M5: { r: 4.25, h: 5 }, M3: { r: 2.75, h: 3 } } };
  const WASHER_R = { M5: 5, M3: 3.5 };
  const MAJOR = { M5: 5, M3: 3 };

  /**
   * Тела крепежа для показа и проверок: shank — стержень (номинальный Ø), head, washer, nut (гайка — описанным
   * шестигранником не нужна: берём вписанный цилиндр Ø под ключ). r — радиус стержня (по умолчанию номинальный).
   */
  function fastenerSolids(x, opt) {
    const o = opt || {};
    const pt = (s) => [x.p[0] + x.d[0] * s, x.p[1] + x.d[1] * s, x.p[2] + x.d[2] * s];
    const cyl = (s0, s1, r, n) => CSG.cylinder(pt(s0), pt(s1), r, n || 24);
    const hd = HEAD[x.kind][x.size];
    const out = {
      shank: cyl(o.from || 0, o.to !== undefined ? o.to : x.len, o.r || MAJOR[x.size] / 2),
      head: cyl(-hd.h, -0.05, hd.r, x.kind === 'hex' ? 6 : 24),
    };
    if (x.washer) out.washer = cyl(0.02, x.washer - 0.02, WASHER_R[x.size]);
    if (x.nut !== null) out.nut = cyl(x.nut + 0.05, x.nut + HW.M5.nutH - 0.05, HW.M5.nutAF / 2, 6);
    return out;
  }

  /** Пружины задника: длина осей и рабочая длина пружин (кассета поднимает рамку стекла на свою толщину). */
  function springCalc(D) {
    const barTop = K.backT + D.Tg + K.barT; // от лицевой стороны плиты задника до верха планки
    const need = barTop + D.holderT + SPRING_SOLID - 2;
    const len = STD_LEN.M3.find((L) => L >= need) || STD_LEN.M3[STD_LEN.M3.length - 1];
    const open = len + 2 - barTop; // промежуток головка–планка без кассеты
    return { len, open, closed: open - D.holderT, free: Math.round(open + 4) };
  }

  /** Сводная спецификация крепежа по группам: [{name, qty, note}]. */
  function fastenerBOM(fx) {
    const rows = new Map();
    const name = (x) => (x.size === 'M5'
      ? `${x.kind === 'hex' ? 'Болт' : 'Винт'} M5×${x.len} (DIN ${x.kind === 'hex' ? 933 : 912})`
      : `Винт M3×${x.len} (DIN 912)`);
    for (const x of fx) {
      const n = name(x), r = rows.get(n) || { name: n, qty: 0, groups: new Map() };
      r.qty++;
      r.groups.set(x.key, (r.groups.get(x.key) || 0) + 1);
      rows.set(n, r);
    }
    const list = [...rows.values()].map((r) => ({
      name: r.name, qty: r.qty,
      note: [...r.groups].map(([k, n]) => (r.groups.size > 1 ? `${FX_LABEL[k]} (${n})` : FX_LABEL[k])).join('; '),
    }));
    const count = (pred) => fx.filter(pred).length;
    const nuts = count((x) => x.size === 'M5' && x.nut !== null);
    const w5 = count((x) => x.size === 'M5' && x.washer > 0) + fx.reduce((s, x) => s + x.stack, 0);
    const WN = { tilt: 'между вертикалью и рамкой', pivot: 'под барашки поворота', feet: 'под головки болтов вертикалей', hinge: 'под барашки шарнира' };
    const wg = {};
    for (const x of fx) if (x.size === 'M5') wg[x.key] = (wg[x.key] || 0) + (x.washer > 0 ? 1 : 0) + x.stack;
    const wNote = Object.keys(wg).filter((k) => wg[k]).map((k) => `${WN[k]} (${wg[k]})`).join('; ');
    const w3 = count((x) => x.size === 'M3' && x.washer > 0);
    if (nuts) list.push({ name: 'Гайка M5 (DIN 934)', qty: nuts, note: 'вставляются в гнёзда деталей' });
    if (w5) list.push({ name: 'Шайба M5 (DIN 125)', qty: w5, note: wNote });
    if (w3) list.push({ name: 'Шайба M3 (DIN 125)', qty: w3, note: 'под винты защёлок и пружинных планок' });
    const tn = count((x) => x.key === 'tripod');
    if (tn) list.push({ name: 'Т-гайка M5 под паз 6 мм (серия 20)', qty: tn, note: 'штативная площадка' });
    return list;
  }

  /** Где начинается мех в сборке (передняя пластина рамки меха): {y, z}; мех идёт от z до z + e. */
  function bellowsOrigin(cam, e, folded) {
    const D = cam.dims;
    if (D.style === 'field') {
      const ee = folded ? D.fb.eMin : e;
      return { y: D.fb.A, z: D.fb.zF(ee) + K.Tf + K.tPlate, e: ee };
    }
    return { y: D.A, z: K.Tf + K.tPlate, e };
  }

  /** Опорная плоскость задника (лицевая сторона кассеты / рамки стекла) в сборке. */
  function backRefZ(cam, e, folded) {
    const D = cam.dims;
    if (D.style === 'field') return D.fb.depth + K.backT;
    return cam.zR(e) + K.Tf + K.backT;
  }

  /** Матовое стекло (покупное) — в гнезде рамки, матовой стороной на плоскости плёнки. */
  function groundGlassDummy(cam, e, folded, opts) {
    const D = cam.dims;
    const z = backRefZ(cam, e, folded) + D.depth + (opts && opts.holder ? D.holderT : 0);
    return CSG.box([-D.glass[0] / 2, D.A - D.glass[1] / 2, z], [D.glass[0] / 2, D.A + D.glass[1] / 2, z + cam.params.camGlassT]);
  }

  /** Условная кассета (покупная), вставленная сверху между плитой задника и рамкой стекла. */
  function holderDummy(cam, e, folded) {
    const D = cam.dims;
    const z = backRefZ(cam, e, folded);
    const w = D.holderW / 2 - 0.3, L = D.holderL, t = D.holderT;
    const yTop = D.A + D.film[1] / 2 + 22; // верхний край — клапан с тёмной шторкой торчит над камерой
    const body = CSG.box([-w, yTop - L, z], [w, yTop, z + t]);
    const flap = CSG.box([-w + 6, yTop, z + 1], [w - 6, yTop + 12, z + t - 1]);
    return { body, flap };
  }

  /** Условный объектив (для показа и проверки складывания): цилиндр перед платой. */
  function lensDummy(cam, e, folded) {
    const D = cam.dims;
    const len = D.style === 'field' ? D.fb.lensFold : 35;
    const zF = D.style === 'field' ? D.fb.zF(folded ? D.fb.eMin : e) : 0;
    const r = D.shutterD / 2 + 4;
    return CSG.cylinder([0, D.A, zF - len], [0, D.A, zF], r, 48);
  }

  /** Деталь в ориентации для печати: на столе (z ≥ 0), по центру XY. */
  function printOriented(part, csg) {
    const r = csg.transform(part.printT);
    const b = r.bounds();
    return r.translate(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]);
  }

  // ---------------------------------------------------------------------
  // Разбиение больших деталей под стол принтера
  // ---------------------------------------------------------------------
  const DOVETAIL_L = 8; // глубина «ласточкина хвоста»

  /** Периметр сечения сетки плоскостью {axis} = t (сумма длин отрезков сечения). */
  function sectionSegments(tris, axis, t) {
    const segs = [];
    for (const tr of tris) {
      const d0 = tr[0][axis] - t, d1 = tr[1][axis] - t, d2 = tr[2][axis] - t;
      const ds = [d0, d1, d2], pts = [];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3, da = ds[i], db = ds[j];
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const k = da / (da - db), a = tr[i], b = tr[j];
          pts.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
        }
      }
      if (pts.length === 2) segs.push(pts);
    }
    return segs;
  }
  const segLen = (segs) => segs.reduce((s, [a, b]) => s + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 0);

  /** Участки материала вдоль оси other на линии разреза: [[v0, v1], …]. */
  function sectionIslands(segs, other) {
    const iv = segs.map(([a, b]) => [Math.min(a[other], b[other]), Math.max(a[other], b[other])]).sort((p, q) => p[0] - q[0]);
    const out = [];
    for (const [a, b] of iv) {
      if (out.length && a <= out[out.length - 1][1] + 0.3) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
      else out.push([a, b]);
    }
    return out;
  }

  /**
   * Тонкие стенки в сечении (толщина 1,6…9 мм по оси other), идущие по высоте печати не меньше 10 мм:
   * [{v0, v1, za, zb}]. Сечение обходится горизонталями через 1 мм.
   */
  function thinWalls(segs, other, z0, z1) {
    const runs = [];
    for (let z = z0 + 0.37; z < z1; z += 1) {
      const vs = [];
      for (const [a, b] of segs) {
        if ((a[2] - z) * (b[2] - z) < 0) vs.push(a[other] + ((b[other] - a[other]) * (z - a[2])) / (b[2] - a[2]));
      }
      vs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < vs.length; i += 2) {
        const a = vs[i], b = vs[i + 1], w = b - a;
        if (w < 1.6 || w >= 9) continue;
        const r = runs.find((q) => Math.abs(q.v0 - a) < 0.3 && Math.abs(q.v1 - b) < 0.3 && q.zb >= z - 1.01);
        if (r) r.zb = z; else runs.push({ v0: a, v1: b, za: z, zb: z });
      }
    }
    return runs.filter((r) => r.zb - r.za >= 10);
  }

  /**
   * Выбор положения разреза: ищем место, где сечение «чистое» (без отверстий, гнёзд, пазов) —
   * там периметр сечения минимален — с запасом под шип, как можно ближе к середине допустимого диапазона.
   */
  function chooseCut(tris, b, axis, La) {
    const L = DOVETAIL_L, lo = b.min[axis], hi = b.max[axis];
    let t0 = hi - La, t1 = lo + La - L - 1, ideal;
    if (t0 <= t1) ideal = (t0 + t1) / 2;
    else { t1 = lo + La - L - 1; t0 = Math.max(lo + 15, t1 - 40); ideal = t1; } // понадобится ещё разрез
    if (t1 < lo + 5) return null;
    const step = 1, w0 = 4, w1 = L + 4;
    const grid = new Map();
    const per = (t) => {
      const k = Math.round(t / step);
      if (!grid.has(k)) grid.set(k, segLen(sectionSegments(tris, axis, k * step + 0.0137)));
      return grid.get(k);
    };
    let best = null;
    for (let t = Math.ceil(t0); t <= Math.floor(t1); t += step) {
      let m = 0;
      for (let u = t - w0; u <= t + w1; u += step) m = Math.max(m, per(u));
      const score = m + 0.05 * Math.abs(t - ideal);
      if (!best || score < best.score) best = { t: t + 0.0137, score };
    }
    return best;
  }

  /** Разрез по плоскости {axis} = t с «ласточкиными хвостами» на каждом участке материала. */
  function cutWithDovetails(piece, b, axis, t, c) {
    const other = 1 - axis, L = DOVETAIL_L, pad = 5;
    const zr = [b.min[2] - pad, b.max[2] + pad];
    const region = (u0, u1, v0, v1) => {
      const mn = [0, 0, zr[0]], mx = [0, 0, zr[1]];
      mn[axis] = u0; mx[axis] = u1; mn[other] = v0; mx[other] = v1;
      return CSG.box(mn, mx);
    };
    const trap = (u0, u1, vc, h0, h1) => {
      const uv = [[u0, vc - h0], [u1, vc - h1], [u1, vc + h1], [u0, vc + h0]];
      const pts = uv.map(([u, v]) => (axis === 0 ? [u, v] : [v, u]));
      return CSG.prism(pts, zr[0], zr[1]);
    };
    const segs = sectionSegments(piece.toTrianglesRaw(), axis, t);
    const islands = sectionIslands(segs, other);
    const tongues = [], sockets = [];
    for (const [v0, v1] of islands) {
      const w = v1 - v0;
      if (w < 9) continue;
      // на длинном сечении — несколько шипов (через ~60 мм): при следующем разрезе у каждой части останется свой
      const n = Math.max(1, Math.round(w / 60)), ws = w / n;
      for (let k = 0; k < n; k++) {
        const vc = v0 + ws * (k + 0.5), hw = Math.min(ws * 0.32, 9), nw = hw * 0.62;
        const slope = (hw - nw) / L, nw0 = nw - 0.5 * slope;
        tongues.push(trap(t - 0.5, t + L, vc, nw0, hw));
        sockets.push(trap(t - 0.5, t + L + c, vc, nw0 + c, hw + c * (1 + slope)));
      }
    }
    // тонкие высокие стенки (коробка) — соединение «в полдерева»: половина толщины стенки заходит
    // на L за линию реза по всей высоте, от стола (без нависаний)
    for (const r of thinWalls(segs, other, b.min[2], b.max[2])) {
      const vm = (r.v0 + r.v1) / 2, top = r.zb >= b.max[2] - 1.5 ? b.max[2] + pad : r.zb + 0.5;
      const lap = (u1, cv) => {
        const mn = [0, 0, b.min[2] - pad], mx = [0, 0, top];
        mn[axis] = t - 0.5; mx[axis] = u1; mn[other] = r.v0 - 0.2; mx[other] = vm + cv;
        return CSG.box(mn, mx);
      };
      tongues.push(lap(t + L, 0));
      sockets.push(lap(t + L + c, c));
    }
    const lo = b.min[axis] - pad, hi = b.max[axis] + pad, vlo = b.min[other] - pad, vhi = b.max[other] + pad;
    let regA = region(lo, t, vlo, vhi);
    if (tongues.length) regA = regA.unionAll(tongues);
    const A = piece.intersect(regA);
    const B = piece.intersect(region(t, hi, vlo, vhi)).subtractAll(sockets);
    return [A, B, tongues.length];
  }

  /**
   * Разбить деталь (уже в ориентации печати, z — вверх) на части, помещающиеся на стол bedW×bedH
   * (с поворотом на 90°). Возвращает массив CSG в тех же координатах.
   */
  function splitForBed(csg, bedW, bedH, c) {
    const W = bedW - 6, H = bedH - 6;
    const out = [], queue = [csg];
    let guard = 0;
    while (queue.length && guard++ < 40) {
      const piece = queue.shift();
      const b = piece.bounds();
      if (fitsBed(piece, bedW, bedH)) { out.push(piece); continue; }
      const axis = b.size[0] >= b.size[1] ? 0 : 1;
      const La = b.size[1 - axis] <= Math.min(W, H) ? Math.max(W, H) : Math.min(W, H);
      const cut = chooseCut(piece.toTrianglesRaw(), b, axis, La);
      if (!cut) { out.push(piece); continue; }
      const [A, B] = cutWithDovetails(piece, b, axis, cut.t, c);
      queue.push(A, B);
    }
    return out.concat(queue);
  }

  /** Деталь или часть для печати: на столе, по центру; повёрнута так, чтобы поместиться (в т.ч. по диагонали). */
  function layPiece(csg, bedW, bedH) {
    let r = csg;
    const ang = bedFitAngle(csg, bedW, bedH);
    if (ang) r = r.transform(M.Rz(ang));
    const b = r.bounds();
    return r.translate(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]);
  }

  /** Выпуклая оболочка точек в плоскости XY (монотонная цепь). */
  function hull2d(points) {
    const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  /**
   * Под каким углом (в градусах) деталь помещается на стол bedW×bedH с полями по 3 мм:
   * 0 или 90 — прямо, другой — по диагонали; null — не помещается.
   */
  function bedFitAngle(csg, bedW, bedH) {
    const W = bedW - 6, H = bedH - 6;
    const pts = [];
    for (const p of csg.polygons) for (const v of p.vertices) pts.push(v);
    const hull = hull2d(pts);
    const tryAngle = (deg) => {
      const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of hull) {
        const u = x * c - y * s, v = x * s + y * c;
        if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
      }
      return x1 - x0 <= W && y1 - y0 <= H;
    };
    if (tryAngle(0)) return 0;
    if (tryAngle(90)) return 90;
    for (let d = 1; d < 180; d += 0.5) if (d !== 90 && tryAngle(d)) return d;
    return null;
  }
  const fitsBed = (csg, bedW, bedH) => bedFitAngle(csg, bedW, bedH) !== null;

  /** Обратная к матрице поворота (без переноса). */
  const invRot = (m) => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0];

  // ---------------------------------------------------------------------
  // Покупные изделия
  // ---------------------------------------------------------------------
  function hardwareList(D, cp, bm, cam) {
    const tri = D.tri, sp = cam.spring;
    const list = fastenerBOM(cam.fasteners);
    const extra = [
      { name: `Пружина сжатия, внутр. Ø ≥ 3,5, нар. Ø ≤ 7, длина ≈ ${sp.free} мм`, qty: 4,
        note: `на оси пружин: без кассеты сжата до ${Math.round(sp.open)} мм, с кассетой — до ${Math.round(sp.closed)} мм (витки не должны сомкнуться)` },
      { name: `Гайка ${tri.name} (штативная)`, qty: 1, note: D.style === 'field' ? 'в гнездо на дне коробки, изнутри' : 'в штативную площадку, сверху' },
      { name: `Матовое стекло ${D.glass[0]}×${D.glass[1]}×${cp.camGlassT} мм`, qty: 1, note: 'матовой стороной к объективу' },
      { name: `Объектив в затворе ${cp.camShutter === 'custom' ? `Ø${D.shutterD}` : SHUTTERS[cp.camShutter].name}`, qty: 1, note: '' },
      { name: `Кассеты ${FORMATS[cp.camFormat].name}`, qty: 1, note: `ширина ${D.holderW} мм, толщина ${String(D.holderT).replace('.', ',')} мм` },
      { name: 'Материал меха (наружный + подкладка)', qty: 1, note: `≈ ${(bm.derived.fabricArea / 1e6).toFixed(2).replace('.', ',')} м² каждого` },
    ];
    if (D.style !== 'field') extra.unshift({ name: `Алюминиевый профиль ${D.rail.name}, паз 6 мм (серия 20)`, qty: 1, note: `длина ${D.railL} мм` });
    return list.concat(extra);
  }

  function splitNote(L, split) {
    if (!split || !split.length) return;
    L.push('   СОСТАВНЫЕ ДЕТАЛИ. Не поместившиеся на стол детали разрезаны на части (номер части — в имени файла):');
    for (const x of split) L.push(`     ${x.name} — ${x.n} ч.`);
    L.push('   Части соединяются «ласточкиными хвостами», тонкие стенки — внахлёст «в полдерева»; зазор заложен.');
    L.push('   Клей: PLA — цианоакрилат или эпоксидка, PETG — эпоксидка или дихлорметан. Склеивайте на ровном стекле;');
    L.push('   опорные плоскости после склейки проверьте линейкой.');
  }

  /** Обозначение крепежа группы для текста: «M5×25». */
  const fxName = (cam, key) => { const x = cam.fasteners.find((q) => q.key === key); return x ? `${x.size}×${x.len || '?'}` : ''; };

  function backAssemblyLines(cam, L) {
    const sp = cam.spring, n = (k) => fxName(cam, k);
    L.push('   Задник: матовое стекло вложить в рамку матовой стороной к объективу, закрепить каплями силикона.');
    L.push(`   Рамку положить на плиту между направляющими, сверху пружинные планки (6× ${n('bar')} с шайбами),`);
    L.push(`   через планки — 4 оси ${n('spring')} с пружинами в направляющие плиты. Оси вворачивать, пока между головкой`);
    L.push(`   и планкой не останется ≈ ${Math.round(sp.open)} мм: пружина поджата, а вставленная кассета (+${String(cam.dims.holderT).replace('.', ',')} мм) не сожмёт её до упора.`);
    L.push('   Кассета вставляется между плитой и рамкой стекла, приподнимая её (заход-фаска на торцах рамки).');
  }

  function fieldAssemblyText(cam, bm, split) {
    const D = cam.dims, f = D.fb, p = cam.params, F = FORMATS[p.camFormat];
    const n = (k) => fxName(cam, k);
    const r = (x) => Math.round(x);
    const L = [];
    L.push(`СКЛАДНАЯ ПОЛЕВАЯ КАМЕРА ${F.name} — КОМПЛЕКТ ДЛЯ 3D-ПЕЧАТИ`);
    L.push('');
    L.push(`Коробка ${f.W}×${r(f.Htop + f.floorT)}×${f.depth} мм, в сложенном виде ≈ ${r(f.closed.w)}×${r(f.closed.h)}×${r(f.closed.d)} мм.`);
    L.push(`Плата объектива ${D.board.w}×${D.board.h} мм, затвор Ø${D.shutterD} мм. Растяжение меха ${r(f.eMin)}…${r(f.eMax)} мм.`);
    L.push(`Объектив при складывании должен выступать вперёд от платы не больше чем на ${f.lensFold} мм.`);
    L.push(`Подвижки: подъём/опускание передней рамки ±${p.camFieldRise} мм и наклон. Задник неподвижный, поворачивается на 90° (4 винта).`);
    L.push('');
    L.push('ВНИМАНИЕ. Размеры кассет и глубина плоскости плёнки — справочные; измерьте свои кассеты.');
    L.push('');
    L.push('1. ПЕЧАТЬ');
    L.push('   PETG (лучше) или PLA, 4 периметра, заполнение 30–40 %. Коробку — задней стенкой на стол (опорная плоскость');
    L.push('   задника получается ровной), станину — рельсами вверх, салазки — пазами вверх. Поддержки не нужны.');
    L.push('   Плиту задника и рамку матового стекла — слоем 0,1 мм. Внутренние детали — чёрным пластиком.');
    splitNote(L, split);
    L.push('');
    L.push('2. СБОРКА');
    L.push('   В барашки вклеить (или вдавить) головки болтов (DIN 933): оси наклона — 2×' + ` ${n('tilt')}, шарнир — 2× ${n('hinge')},`);
    L.push(`   фиксатор салазок — 1× ${n('sledlock')}.`);
    L.push('   Коробка: штативную гайку вдавить изнутри в гнездо на дне. Мех: манжеты вклеить на бортики рамок меха.');
    L.push(`   Заднюю рамку меха привернуть к задней стенке изнутри: винты ${n('bfR')} вставляются снаружи, со стороны задника.`);
    L.push(`   Затем плиту задника — 4 винтами ${n('back')} (головки утоплены).`);
    L.push('   Станина: гайки M5 вдавить в гнёзда на внутренних сторонах щёк. Щёки заводятся внутрь коробки у дна,');
    L.push(`   барашки ${n('hinge')} с шайбами — снаружи через проушины. Затянули — станина держится открытой или закрытой.`);
    L.push(`   Салазки: гайку M5 вдавить в гнездо над правым пазом; барашек ${n('sledlock')} сверху — фиксатор фокусировки.`);
    L.push(`   Вертикали: гайки M5 в гнёзда ножек (открыты внутрь), привернуть к салазкам снизу винтами ${n('sledup')} (DIN 912).`);
    L.push(`   Рамка: гайки M5 в пазы со стороны меха, поставить между вертикалями с шайбами, барашки ${n('tilt')} снаружи.`);
    L.push(`   Переднюю рамку меха привернуть к рамке винтами ${n('bfF')} спереди. Плата — в гнездо рамки, 2 защёлки ${n('latch')}.`);
    L.push('   Салазки со стойкой надвигаются на рельсы с дальнего конца открытой станины и задвигаются в коробку.');
    backAssemblyLines(cam, L);
    L.push('');
    L.push('3. РАБОТА И СКЛАДЫВАНИЕ');
    L.push('   Открыть: ослабить барашки шарнира, опустить станину до упора (она ложится вровень с дном), затянуть.');
    L.push('   Вывести стойку на станину, сфокусироваться, затянуть фиксатор салазок.');
    L.push('   Сложить: вернуть рамку в ноль (без подъёма и наклона), задвинуть стойку до упора внутрь коробки,');
    L.push('   поднять станину — она закрывает коробку. Затянуть барашки шарнира.');
    L.push('');
    L.push('4. ЮСТИРОВКА — как у любой камеры: фокус по матовому стеклу, тестовый кадр, при необходимости прокладки');
    L.push('   под уступ стекла. Проверьте светонепроницаемость фонариком в тёмной комнате.');
    L.push('');
    L.push('5. ДЕТАЛИ ДЛЯ ПЕЧАТИ');
    for (const part of cam.parts) L.push(`   ${part.qty} × ${part.name}${part.note ? ` (${part.note})` : ''}`);
    L.push('');
    L.push('6. ПОКУПНОЕ');
    for (const h of cam.hardware) L.push(`   ${h.qty} × ${h.name}${h.note ? ` — ${h.note}` : ''}`);
    L.push('');
    L.push('7. МЕХ — папка bellows: развёртка 1:1 (SVG, DXF), чертёж меха, STL плашек с картами раскладки.');
    L.push('');
    return L.join('\n');
  }

  /** Текст README для архива: печать, сборка, юстировка, списки деталей. */
  function assemblyText(cam, bm, split) {
    if (cam.dims.style === 'field') return fieldAssemblyText(cam, bm, split);
    const D = cam.dims, p = cam.params, F = FORMATS[p.camFormat];
    const f = (x) => (Math.round(x * 10) / 10).toString().replace('.', ',');
    const n = (k) => fxName(cam, k);
    const nTri = cam.fasteners.filter((x) => x.key === 'tripod').length;
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
    L.push('   Каретки: гайки M5 вдавить в гнездо снизу верхней полки (ось поворота) и в гнездо на внутренней стороне');
    L.push('   боковой стенки (фиксатор; гнездо открыто к рельсу — упор винта прижимает гайку к стенке).');
    L.push(`   В барашки вклеить (или вдавить) головки болтов (DIN 933): большие — 4× ${n('tilt')} (наклон),`);
    L.push(`   малые — 2× ${n('pivot')} (поворот), 2× ${n('lock')} (фиксаторы).`);
    L.push(`   Стойки: гайки M5 вставить сбоку в ножки вертикалей, привернуть вертикали к основаниям снизу болтами ${n('feet')} с шайбами.`);
    L.push(`   Основание ставится на каретку, барашек ${n('pivot')} (под ним шайба) проходит через паз основания в гайку каретки:`);
    L.push('   ослабили — стойка поворачивается и сдвигается вбок; затянули — зафиксирована.');
    L.push('   Рамки: гайки M5 вставить в пазы боковин со стороны меха. Рамку поставить между вертикалями,');
    L.push(`   шайбы между рамкой и вертикалью, барашки ${n('tilt')} снаружи. Ослабили — рамка наклоняется и (спереди) поднимается.`);
    L.push(`   Мех: манжеты вклеить на бортики рамок меха (клей для кожи/ткани), рамки меха привернуть винтами ${n('bfF')}`);
    L.push('   к стойкам: спереди — винты со стороны объектива, сзади — со стороны задника (до установки задника).');
    L.push(`   Объективная плата: затвор в отверстие платы, плата в гнездо передней рамки, 2 защёлки на винтах ${n('latch')} с шайбами.`);
    L.push(`   Плиту задника привернуть к задней рамке 4 винтами ${n('back')} (головки утоплены).`);
    backAssemblyLines(cam, L);
    L.push(`   Штативная площадка: штативную гайку опустить сверху до дна гнезда, площадку привернуть под рельс ${nTri} винтами`);
    L.push(`   ${n('tripod')} в Т-гайки. Заглушки рельса (${n('cap')} в канал профиля) шире профиля — каретки в них упираются.`);
    L.push('');
    if (split && split.length) {
      L.push('   СОСТАВНЫЕ ДЕТАЛИ. Не поместившиеся на стол детали разрезаны на части (номер части — в имени файла):');
      for (const x of split) L.push(`     ${x.name} — ${x.n} ч.`);
      L.push('   Части соединяются «ласточкиными хвостами» с зазором и клеем (для PLA — цианоакрилат или эпоксидная смола,');
      L.push('   для PETG — эпоксидка или дихлорметан). Шип вставляется сверху. Склеивайте на ровном стекле, лицевой');
      L.push('   стороной вниз, и прижмите до высыхания. Плиту задника и рамку матового стекла после склейки проверьте');
      L.push('   линейкой на плоскость: опорная поверхность должна остаться ровной.');
    }
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
    normalizeCamParams, computeCamera, placements, printOriented, assemblyText, railCSG, bellowsOrigin, lensDummy, STYLES, FK,
    backRefZ, groundGlassDummy, holderDummy,
    splitForBed, layPiece, invRot, fitsBed, bedFitAngle, sectionSegments, DOVETAIL_L,
    fastenerLayout, fastenerSolids, springCalc, FX_LABEL,
  };
});
