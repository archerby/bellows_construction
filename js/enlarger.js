/*
 * Фотоувеличитель для 3D-печати под тот же мех — «камера наоборот», только компактнее.
 *
 * Вертикальная колонна (алюминиевый профиль серии 20). На ней две каретки:
 *   верхняя — головка: негативная плита с рамкой негатива и осветителем (LED + камера смешения + рассеиватель);
 *   нижняя — объективная рамка с платой; висит на ходовом винте M6, который точно фокусирует (растягивает мех).
 * Масштаб — подъём всей головки по колонне, фокус — маховик винта. Подвижек нет.
 * Головка снимается с колонны без инструмента (барашек заглушки), колонна — с кронштейна доски (два барашка).
 *
 * Покупное: профиль, крепёж M3/M5, шпилька M6, Т-гайки, молочное оргстекло, светодиодная лента или панель,
 * блок питания, объектив. Остальное печатается.
 *
 * Мировые координаты: X — вправо, Y — вверх, Z — к оператору; y = 0 — верх доски, оптическая ось — x = 0, z = 0,
 * колонна позади оси (z < 0). Модуль подключается к camera.js (init) и берёт оттуда общие помощники.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./csg.js'), require('./i18n.js'));
  else root.BellowsEnlarger = factory(root.BellowsCSG, root.BellowsI18n);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (K3, I18n) {
  'use strict';
  const tr = I18n.t, num = I18n.num;
  const { CSG, M } = K3;
  let H = null; // помощники camera.js: примитивы, фаски, крепёж, справочники
  function init(helpers) { H = helpers; }

  // ---------------------------------------------------------------------
  // Справочные данные
  // ---------------------------------------------------------------------
  // frame — кадр [поперёк плёнки (X), вдоль полосы (Z)], film — ширина плёнки или размер листа, pitch — шаг кадров
  const ENL_FORMATS = {
    '35': { frame: [24, 36], film: [35, 0], pitch: 38, f: 50 },
    '645': { frame: [56, 41.5], film: [61.5, 0], pitch: 45, f: 80 },
    '66': { frame: [56, 56], film: [61.5, 0], pitch: 60, f: 80 },
    '67': { frame: [56, 69.5], film: [61.5, 0], pitch: 72.5, f: 105 },
    '69': { frame: [56, 84], film: [61.5, 0], pitch: 87, f: 105 },
    '4x5': { frame: [96, 120], film: [101.6, 127], sheet: true, f: 150 },
  };
  for (const k of Object.keys(ENL_FORMATS)) Object.defineProperty(ENL_FORMATS[k], 'name', { get: () => tr('opt.enlFormat.' + k) });
  // отверстие в плате: резьбу M39 не печатаем — объектив проходит в отверстие и зажимается ответным кольцом
  const ENL_MOUNTS = {
    m39: { hole: 39.6, r: 24, g: 150 },
    copal0: { hole: 34.6, r: 23, g: 220 },
    copal1: { hole: 41.6, r: 28, g: 300 },
  };
  for (const k of Object.keys(ENL_MOUNTS)) Object.defineProperty(ENL_MOUNTS[k], 'name', { get: () => tr('opt.enlMount.' + k) });
  const COLUMNS = { '2020': [20, 20], '2040': [20, 40], '4040': [40, 40] }; // ширина (X) × глубина (Z)
  const PRINTS = {
    '9x13': [90, 130], '10x15': [100, 150], '13x18': [130, 180], '18x24': [180, 240], '20x25': [203, 254],
    '24x30': [240, 300], '30x40': [300, 400], '40x50': [400, 500], '50x60': [500, 600],
  };
  const BALANCE = ['friction', 'spring', 'weight'];
  const LEDS = ['strip', 'panel'];
  const SPRING_N = [5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50]; // пружины постоянного усилия: типовой ряд, Н
  const M6 = { hole: 6.6, nutAF: 10, nutH: 5, washerT: 1.6 };
  const STRIP = { wpm: 4.8, cut: 50, v: 12, perM: 60 }; // лента 12 В, 60 LED/м: ~4,8 Вт/м, резать через 50 мм
  const SHOT = 4.5; // насыпная плотность стальной дроби, г/см³

  const ENL_DEFAULTS = {
    enlFormat: '4x5',
    enlFocal: 0, // 0 — по формату
    enlMount: 'm39',
    enlRange: 'print', // 'print' — по размерам отпечатка, 'mag' — по увеличениям
    enlPrintMin: '9x13',
    enlPrintMax: '30x40',
    enlMagMin: 2,
    enlMagMax: 8,
    enlColumn: '2040',
    enlColumnLength: 0, // 0 — подобрать
    enlEasel: 0, // высота бумаги над доской (рамка-маска)
    enlBalance: 'friction',
    enlSpringD: 25, // внутренний диаметр пружины постоянного усилия
    enlLed: 'strip',
    enlLedPitch: 15, // шаг рядов ленты / светодиодов панели
  };

  /** Проверка значений увеличителя (общая нормализация чисел и строк — в camera.js). */
  function normalize(p) {
    const pick = (key, ok) => { if (!ok(p[key])) p[key] = ENL_DEFAULTS[key]; };
    pick('enlFormat', (v) => !!ENL_FORMATS[v]);
    pick('enlMount', (v) => !!ENL_MOUNTS[v]);
    pick('enlRange', (v) => v === 'print' || v === 'mag');
    pick('enlPrintMin', (v) => !!PRINTS[v]);
    pick('enlPrintMax', (v) => !!PRINTS[v]);
    pick('enlColumn', (v) => !!COLUMNS[v]);
    pick('enlBalance', (v) => BALANCE.includes(v));
    pick('enlLed', (v) => LEDS.includes(v));
    p.enlFocal = Math.max(0, p.enlFocal);
    p.enlColumnLength = Math.max(0, p.enlColumnLength);
    p.enlEasel = Math.max(0, p.enlEasel);
    p.enlSpringD = Math.max(10, Math.min(60, p.enlSpringD));
    p.enlLedPitch = Math.max(3, Math.min(40, p.enlLedPitch));
    return p;
  }

  // ---------------------------------------------------------------------
  // Константы конструкции
  // ---------------------------------------------------------------------
  const EK = {
    Tl: 10, // объективная рамка
    Tnb: 10, // негативная плита (держит консоль головки)
    tLb: 2, tLt: 1.6, rec: 0.2, play: 0.6, // створки рамки негатива, углубление под плёнку, зазор по высоте паза
    Tr: 6, // крыша негативного столика
    Ww: 12, Wb: 6, // боковые и задняя стенки столика
    ov: 6, // створки заходят за окно крыши
    capT: 4, // крышка рамки негатива (световой замок спереди)
    wall: 3, flangeT: 5, ledge: 3, ledgeH: 2, diffT: 3, // корпус осветителя
    ledT: 3, ventGap: 5, capTop: 3, skirt: 2.4, // светодиодная плита и крышка-лабиринт
    sealW: 1.4, sealD: 1.6, sealH: 3, // кольцо светового замка между крышей столика и осветителем
    cw: 6, cwR: 10, Hh: 60, Hl: 45, Ts: 8, tailL: 24, // каретки и полки
    mixMargin: 6, rho: 0.8, Uok: 0.9, // камера смешения: запас по краю, отражение белых стенок, порог равномерности
    colCapT: 5, skirtH: 10, // заглушка колонны
    sock: 6, sockH: 40, Tbb: 8, jack: 2, // кронштейн доски: стенки гнезда, его высота, фланец, ход юстировочных винтов
    knobF: 36, knobFH: 14, // маховик фокусировки
    padX: 3.1, // толщина тормозной колодки
  };
  const PAD = { y: 25, z: 15 };

  const magFit = (print, frame) => Math.min(Math.max(...print) / Math.max(...frame), Math.min(...print) / Math.min(...frame));
  const opt = (f, m) => ({ u: f * (1 + 1 / m), v: f * (1 + m) });

  // ---------------------------------------------------------------------
  // Свет: равномерность освещения рассеивателя
  // ---------------------------------------------------------------------
  /** Коэффициент облучённости площадки, параллельной светящемуся прямоугольнику [x0,x1]×[z0,z1] на высоте h. */
  function viewF(x0, x1, z0, z1, h) {
    const G = (x, z) => {
      const X = Math.abs(x) / h, Z = Math.abs(z) / h, sx = Math.sqrt(1 + X * X), sz = Math.sqrt(1 + Z * Z);
      return Math.sign(x) * Math.sign(z) * ((X / sx) * Math.atan(Z / sx) + (Z / sz) * Math.atan(X / sz)) / (2 * Math.PI);
    };
    return G(x1, z1) - G(x0, z1) - G(x1, z0) + G(x0, z0);
  }
  /** Освещённость точки рассеивателя от светящегося потолка a×a в белой камере (стенки — зеркала с отражением rho). */
  function irradiance(px, pz, a, h, rho) {
    let s = 0;
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const w = rho ** (Math.abs(i) + Math.abs(j)), cx = i * a, cz = j * a;
      s += w * viewF(cx - a / 2 - px, cx + a / 2 - px, cz - a / 2 - pz, cz + a / 2 - pz, h);
    }
    return s;
  }

  /**
   * Камера смешения. Луч от объектива через угол кадра продолжается до рассеивателя (он выше негатива на g),
   * поэтому равномерно освещённая часть рассеивателя больше кадра в k = 1 + g/u раз — по диагонали плюс запас.
   * Высота смешения — не меньше 1,5 шага светодиодов (отдельные точки сливаются); затем проверяем спад
   * освещённости к углам освещаемого поля и при нужде расширяем камеру.
   */
  function lightCalc(frame, uMin, g, pitch, led) {
    const k = 1 + g / uMin;
    const need = [frame[0] * k, frame[1] * k];
    // шаг светодиодов: ряды ленты и точки вдоль ленты (60 на метр) или сетка панели
    const pAlong = led === 'panel' ? pitch : 1000 / STRIP.perM;
    const Hm = Math.max(25, Math.ceil(1.5 * Math.max(pitch, pAlong)));
    let aNeed = Math.ceil(Math.hypot(need[0], need[1]) + 2 * EK.mixMargin), U = 0;
    for (let i = 0; i < 40; i++) {
      const a = aNeed + 2 * EK.ledge;
      U = irradiance(need[0] / 2, need[1] / 2, a, Hm, EK.rho) / irradiance(0, 0, a, Hm, EK.rho);
      if (U >= EK.Uok) break;
      aNeed += 4;
    }
    return { k, need, aNeed, a: aNeed + 2 * EK.ledge, H: Hm, U, ratio: Hm / pitch, ripple: ripple(Hm, pAlong, pitch), pAlong };
  }

  /** Пульсация освещённости рассеивателя от сетки точечных ламбертовых светодиодов (шаг px × pz) на высоте h, %. */
  function ripple(h, px, pz) {
    const E = (x, z) => {
      let s = 0;
      for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) { const dx = i * px - x, dz = j * pz - z; s += (h * h) / (h * h + dx * dx + dz * dz) ** 2; }
      return s;
    };
    const v = [E(0, 0), E(px / 2, 0), E(0, pz / 2), E(px / 2, pz / 2)], hi = Math.max(...v), lo = Math.min(...v);
    return ((hi - lo) / ((hi + lo) / 2)) * 100;
  }

  /** Светодиоды: ряды ленты поперёк камеры (или панель), мощность, ток, блок питания. */
  function ledCalc(a, cp) {
    if (cp.enlLed === 'panel') {
      const P = Math.max(5, Math.round((a * a) / 1e6 * 320)); // та же плотность, что у ленты с шагом 15 мм
      return { panel: true, P, I: Math.round((P / STRIP.v) * 10) / 10, psu: Math.ceil((P * 1.5) / STRIP.v) };
    }
    const rows = Math.max(1, Math.floor((a - 2) / cp.enlLedPitch));
    const rowL = Math.max(STRIP.cut, Math.floor((a - 4) / STRIP.cut) * STRIP.cut);
    const L = rows * rowL, P = Math.round((L / 1000) * STRIP.wpm * 10) / 10;
    return { panel: false, rows, rowL, L, P, I: Math.round((P / STRIP.v) * 100) / 100, psu: Math.max(1, Math.ceil((P * 1.5) / STRIP.v)) };
  }

  // ---------------------------------------------------------------------
  // Размеры
  // ---------------------------------------------------------------------
  function computeEnlarger(bm, cp) {
    const errors = [], warnings = [];
    if (!bm || !bm.ok) return { ok: false, params: cp, errors: [tr('cam.err.bellows')], warnings };
    const K = H.K, c = cp.camClearance;
    const F = ENL_FORMATS[cp.enlFormat], frame = F.frame, diag = Math.hypot(frame[0], frame[1]);
    const f = cp.enlFocal > 0 ? cp.enlFocal : F.f;
    const mount = ENL_MOUNTS[cp.enlMount];
    let mMin, mMax;
    if (cp.enlRange === 'print') { mMin = magFit(PRINTS[cp.enlPrintMin], frame); mMax = magFit(PRINTS[cp.enlPrintMax], frame); }
    else { mMin = cp.enlMagMin; mMax = cp.enlMagMax; }
    if (mMin > mMax) [mMin, mMax] = [mMax, mMin];
    mMin = Math.round(mMin * 100) / 100; mMax = Math.round(mMax * 100) / 100;
    if (!(f >= 20 && f <= 400)) errors.push(tr('enl.err.focal'));
    if (!(mMin >= 0.2 && mMax <= 30)) errors.push(tr('enl.err.mag'));
    // рамки меха, плата и защёлки — те же, что у камеры: мех с рамками переставляется между камерой и увеличителем
    const ref = H.computeCamera(bm, Object.assign({}, cp, { camStyle: 'monorail', camShutter: 'custom', camShutterD: mount.hole }));
    if (!ref.ok) errors.push(...ref.errors);
    if (errors.length) return { ok: false, params: cp, errors, warnings };
    const R = ref.dims, d = bm.derived, bp = bm.params;
    const board = R.board, Sf = R.Sf, Sr = R.Sr;

    // --- оптика и мех
    const slotH = EK.tLb + EK.tLt + EK.play + c;
    const Fst = EK.Tl + 2 * K.tPlate + EK.Tnb + EK.tLb - EK.rec; // от фланца объектива до плёнки сверх растяжения меха
    const g = slotH + EK.Tr + EK.ledgeH - (EK.tLb - EK.rec); // от плёнки до рассеивателя
    const eNeed = [opt(f, mMax).u - Fst, opt(f, mMin).u - Fst];
    const eMinB = Math.ceil(Math.max(d.minFrame, R.bfF.lipLen + R.bfR.lipLen + 2));
    const eMaxB = bp.maxExt;
    const mOfE = (e) => { const u = e + Fst; return u > f ? f / (u - f) : Infinity; };
    const mTxt = (m) => (m === Infinity ? '∞' : num(m, 2));
    if (eNeed[1] > eMaxB) warnings.push(tr('enl.warn.extLong', { m: num(mMin, 2), need: Math.ceil(eNeed[1]), max: Math.round(eMaxB), ach: mTxt(mOfE(eMaxB)) }));
    if (eNeed[0] < eMinB) warnings.push(tr('enl.warn.extShort', { m: num(mMax, 2), need: Math.floor(eNeed[0]), min: eMinB, ach: mTxt(mOfE(eMinB)) }));
    let eLo = Math.max(eMinB, Math.floor(eNeed[0] - 5)), eHi = Math.min(eMaxB, Math.ceil(eNeed[1] + 5));
    if (eHi < eLo + 10) eHi = Math.min(Math.max(eMaxB, eLo), eLo + 10);
    const eAt = (m) => Math.max(eLo, Math.min(eHi, opt(f, m).u - Fst));

    // --- свет
    const light = lightCalc(frame, opt(f, mMax).u, g, cp.enlLedPitch, cp.enlLed);
    if (light.U < EK.Uok) warnings.push(tr('enl.warn.light', { u: Math.round(light.U * 100) }));
    const aNeed = light.aNeed, a = light.a;
    const Hb = EK.ledgeH + EK.diffT + 0.4 + light.H;
    const led = ledCalc(a, cp);

    // --- в плане
    const Wc = aNeed + 2 * EK.ov, slotHalf = Wc / 2 + c;
    const Su = Math.ceil(Math.max(Sr, 2 * (slotHalf + EK.Ww), a + 22));
    const col = COLUMNS[cp.enlColumn], hw = col[0] / 2 + c, hd = col[1] / 2 + c;
    const zT0 = -Su / 2 - EK.tailL; // начало хвостов плит у колонны
    const zCC = zT0 - c - EK.cw - hd; // ось колонны
    const xS = hw + EK.cw + EK.knobF / 2 + 3, zS = zT0 + 12; // ходовой винт
    const xB = hw + EK.cw + 7, zB = zT0 + 10; // болты негативной плиты
    const Wtail = 2 * (xS + 10);
    const zLe = -(board.h / 2 + c + 4); // язык нижней полки — до кармана платы
    const lev = [[-xB, zT0 + 8], [xB, zT0 + 8], [0, zLe - 6]]; // три точки юстировки объективной рамки
    const padH = 2 * H.FW.M3; // две шайбы M3 — прокладки юстировки
    const bossC = a / 2 + 4.5, cornerR = Sr / 2 - K.corner;
    const xw = slotHalf + EK.Ww / 2;
    let zw = Su / 4, best = -1;
    for (let z = 12; z <= Su / 2 - 8; z += 0.5) { // винты столика — подальше от бобышек осветителя и винтов рамки меха
      const dm = Math.min(Math.hypot(xw - bossC, z - bossC), Math.hypot(xw - cornerR, z - cornerR));
      if (dm > best + 1e-9) { best = dm; zw = z; }
    }
    const gc = a / 2 + EK.wall / 2; // ось кольца светового замка

    // --- компенсация веса: барабан пружины или блок противовеса под заглушкой колонны (координаты от оси колонны)
    const zAnch = -(hd + EK.cwR / 2);
    let BG = null;
    if (cp.enlBalance === 'spring') {
      const r = cp.enlSpringD / 2, Rf = r + 3, w = 28;
      BG = { kind: 'spring', r, R: Rf, w, z: zAnch - r - 1.5, y: -(Rf + 3), earT: 5, earR: 8 };
    } else if (cp.enlBalance === 'weight') {
      const Dp = 30, Ro = Dp / 2 + 4, w = 10;
      BG = { kind: 'weight', Dp, r: Dp / 2, R: Ro, w, z: zAnch - Dp / 2, y: -(Ro + 3), earT: 5, earR: 8 };
    }
    const stopLocal = BG ? Math.min(-EK.skirtH, BG.y - Math.max(BG.R, BG.earR)) : -EK.skirtH;

    // --- по вертикали
    const st = (m) => {
      const o = opt(f, m), e = eAt(m), yL = cp.enlEasel + o.v;
      const yNB = yL + EK.Tl + 2 * K.tPlate + e, yS = yNB + EK.Tnb, yRT = yS + slotH + EK.Tr;
      return {
        m, u: o.u, v: o.v, e, yL, yNB, yS, yN: yS + EK.tLb - EK.rec, yRT,
        yTop: yRT + Hb + EK.ledT + EK.ventGap + EK.capTop,
        hcBot: yNB - EK.Ts, hcTop: yNB - EK.Ts + EK.Hh, lcTop: yL - padH, lcBot: yL - padH - EK.Hl,
      };
    };
    const samples = [];
    for (let i = 0; i <= 60; i++) samples.push(mMin * (mMax / mMin) ** (i / 60));
    if (mMin < 1 && mMax > 1) samples.push(1);
    const S = samples.map(st);
    const hcTopMin = Math.min(...S.map((s) => s.hcTop)), hcTopMax = Math.max(...S.map((s) => s.hcTop));
    const colBot = EK.jack + EK.Tbb, sockTop = colBot + EK.sockH;

    // масса головки (всё, что едет по колонне) — для пружины и противовеса
    const D0 = { Su, Sf, Sr, a, aNeed, Wc, slotH, Hb, Wtail, zT0, zCC, hw, hd, frame, board, R, bm, mount, zLe, c };
    const mass = massEstimate(D0);
    let wb = null;
    if (BG && BG.kind === 'weight') {
      const W = Math.max(40, col[0] + 30), Dz = 30, t = 2.4;
      const V = ((mass.total / SHOT) * 1.15) * 1000; // мм³ с запасом
      const Hw = Math.ceil(V / ((W - 2 * t) * (Dz - 2 * t)) + 8);
      wb = { W, D: Dz, t, H: Hw, lidT: 3, z: zAnch - BG.Dp };
    }
    let colTopNeed = hcTopMax + 3 - stopLocal;
    if (wb) colTopNeed = Math.max(colTopNeed, colBot + 5 + wb.H + wb.lidT + (hcTopMax - hcTopMin) + 5 + BG.R - BG.y);
    const colNeed = Math.ceil((colTopNeed - colBot) / 50) * 50;
    const colL = cp.enlColumnLength > 0 ? cp.enlColumnLength : colNeed;
    const colTop = colBot + colL;
    if (cp.enlColumnLength > 0 && cp.enlColumnLength < colNeed) {
      const okM = S.filter((s) => s.hcTop <= colTop + stopLocal - 3).map((s) => s.m);
      warnings.push(tr('enl.warn.column', { len: cp.enlColumnLength, need: colNeed, m: okM.length ? num(Math.max(...okM), 2) : '—' }));
    }
    const sLow = st(mMin);
    if (sLow.lcBot < sockTop + 3) {
      const vMin = sockTop + 3 + EK.Hl + padH - cp.enlEasel;
      warnings.push(tr('enl.warn.low', { m: num(mMin, 2), ach: num(Math.max(0, vMin / f - 1), 2) }));
    }
    // мех и объектив
    if (Math.min(d.clearRear.w, d.clearRear.h) < Math.max(frame[0], frame[1])) {
      warnings.push(tr('enl.warn.rearClear', { clear: Math.round(Math.min(d.clearRear.w, d.clearRear.h)), fx: frame[0], fz: frame[1] }));
    }
    if (Math.min(d.clearFront.w, d.clearFront.h) < mount.hole) warnings.push(tr('enl.warn.frontClear', { d: num(mount.hole) }));
    if (mount.hole + 6 > Math.min(R.boardOpen[0], R.boardOpen[1]) - 2 * c) warnings.push(tr('enl.warn.mountBoard', { d: num(mount.hole), w: board.w, h: board.h }));

    // доска (не печатается): отпечаток при максимальном увеличении перед колонной
    const flX = hw + EK.sock + 26, flZB = -(hd + EK.sock + 22), flZF = hd + EK.sock + 30;
    const boardW = Math.ceil(Math.max(frame[0] * mMax + 100, 2 * flX + 80) / 10) * 10;
    const boardZ0 = zCC + flZB - 30, boardZ1 = Math.max(frame[1] * mMax / 2 + 60, 80);
    const boardD = Math.ceil((boardZ1 - boardZ0) / 10) * 10;

    // пружина постоянного усилия
    let spring = null;
    if (BG && BG.kind === 'spring') {
      const Fw = mass.total * 9.81 / 1000;
      const Fn = SPRING_N.reduce((b, x) => (Math.abs(x - Fw) < Math.abs(b - Fw) ? x : b), SPRING_N[0]);
      spring = { need: Fw, F: Fn, ext: Math.ceil((colTop + BG.y - (hcTopMin - (EK.Hh - EK.Ts)) + 40) / 50) * 50 };
    }

    const D = {
      style: 'enlarger', c, F, frame, diag, f, mount, mMin, mMax, slotH, Fst, g, eNeed, eMinB, eMaxB, eLo, eHi,
      light, aNeed, a, Hb, led, Wc, slotHalf, Su, Sf, Sr, board, R, col, hw, hd, zT0, zCC, xS, zS, xB, zB, Wtail, zLe, lev, padH,
      bossC, xw, zw, gc, BG, zAnch, stopLocal, colBot, sockTop, colL, colNeed, colTop, mass, wb, spring,
      flX, flZB, flZF, boardW, boardD, boardZ0, rodL: 0, travel: eHi - eLo,
      eMin: mMin, eMax: mMax, // ползунок сцены — увеличение
      jacks: [[-(flX - 9), flZF - 9], [flX - 9, flZF - 9], [0, flZB + 9]],
      woods: [[-(flX - 9), flZB + 9], [flX - 9, flZB + 9]],
      capK: [-col[0] / 2 + 10, col[1] / 2 - 10],
      yLk: EK.Ts + (EK.Hh - EK.Ts) / 2,
      zk: col[1] / 2 - 10, // паз колонны под барашки кронштейна
      EK, K,
    };
    // ходовой винт: от низа (в маховике) до гайки в верхней полке при наибольшем растоянии плит, с выходом над плитой
    const rodSpan = (e) => EK.Tl + 2 * K.tPlate + e + padH + EK.Ts + M6.washerT + EK.knobFH - 1;
    D.rodL = Math.ceil((rodSpan(eHi) + 1) / 5) * 5;
    D.rodSpan = rodSpan;
    D.st = st;
    D.mOfE = mOfE;

    const enl = { ok: true, params: cp, errors, warnings, dims: D, ref };
    enl.parts = buildParts(D, cp, ref);
    enl.fasteners = fastenerLayout(enl, mMin, false, {});
    const bad = [...new Set(enl.fasteners.filter((x) => !x.len).map((x) => H.fxLabel(x.key)))];
    for (const b of bad) warnings.push(tr('cam.warn.noLen', { what: b }));
    enl.hardware = hardwareList(enl, bm);
    return enl;
  }

  /** Масса головки (всё, что едет по колонне), г: пластик по упрощённым объёмам + покупное. */
  function massEstimate(D) {
    const K = H.K, { Su, Sf, Sr, a, aNeed, Wc, slotH, Hb, Wtail, zT0, hw, hd, frame, board, R, bm, mount, zLe } = D;
    const blockA = 2 * (hw + EK.cw) * (2 * hd + EK.cw + EK.cwR) - 4 * hw * hd;
    const v = {
      head_carriage: blockA * EK.Hh + Wtail * EK.tailL * EK.Ts,
      lens_carriage: blockA * EK.Hl + (Wtail * (-Sf / 2 - zT0) + 24 * (zLe + Sf / 2)) * EK.Ts,
      neg_base: (Su * Su + Wtail * EK.tailL - (frame[0] + 4) * (frame[1] + 4)) * EK.Tnb,
      neg_stage: Su * Su * (slotH + EK.Tr) - 2 * (Wc / 2) * (Su - EK.Wb) * slotH - aNeed * aNeed * EK.Tr,
      carrier: Wc * Su * (EK.tLb + EK.tLt) + (Wc + 18) * (slotH + EK.Tr) * EK.capT,
      lamp_body: ((a + 6) ** 2 - a * a) * Hb + (Su * Su - (a + 6) ** 2) * EK.flangeT + (a * a - aNeed * aNeed) * EK.ledgeH,
      led_plate: (a + 18) ** 2 * EK.ledT,
      vent_cap: (a + 18) ** 2 * EK.capTop + 4 * (a + 18) * EK.skirt * EK.ventGap,
      lens_frame: (Sf * Sf + Wtail * (-Sf / 2 - zT0) - R.boardOpen[0] * R.boardOpen[1]) * EK.Tl,
      lens_board: board.w * board.h * K.tBoard,
      bellows_frames: (Sf * Sf + Sr * Sr - R.bfF.lipW * R.bfF.lipH - R.bfR.lipW * R.bfR.lipH) * K.tPlate,
      knobs: Math.PI * 18 * 18 * EK.knobFH + Math.PI * 9.5 * 9.5 * 9,
    };
    const plasticVol = Object.values(v).reduce((s, x) => s + x, 0);
    const plastic = plasticVol * 1.27e-3 * 0.6;
    const bought = mount.g + a * a * EK.diffT * 1.19e-3 + 40 + 60 + (bm.derived.fabricArea / 1e6) * 500;
    return { plastic: Math.round(plastic), bought: Math.round(bought), total: Math.round(plastic + bought) };
  }

  // ---------------------------------------------------------------------
  // Детали
  // ---------------------------------------------------------------------
  /** Профиль в плоскости (x, z) → тело вдоль y от y0 до y1 с фасками снизу (cb) и сверху (ct). */
  const prismXZ = (poly, y0, y1, cb, ct) => H.chamferPrism(poly.map(([x, z]) => [x, -z]), y0, y1, cb || 0, ct || 0).transform(H.ALONG.y);
  const rectXZ = (x0, z0, x1, z1, r, seg) => H.rrect(x0, z0, x1, z1, r || 0, seg || 4);
  /** Треугольный гребень (45°) вдоль x: сечение в плоскости (y, z). */
  const ridgeX = (yc, zFace, h, x0, x1, grow) => {
    const e = grow || 0;
    return CSG.prism([[yc - h - e, zFace - 0.3], [yc + h + e, zFace - 0.3], [yc, zFace + h + e]], x0, x1).transform(H.ALONG.x);
  };
  /** Тот же гребень вдоль y (сечение в плоскости (x, z)). */
  const ridgeY = (xc, zFace, h, y0, y1, grow) => {
    const e = grow || 0;
    return prismXZ([[xc - h - e, zFace - 0.3], [xc + h + e, zFace - 0.3], [xc, zFace + h + e]], y0, y1);
  };

  function buildParts(D, cp, ref) {
    const { box, cylX, cylY, cylZ, hexY, rrect, loft, circle, HW, COL, K } = H;
    const c = D.c, nutAF = HW.M5.nutAF + c, nutHp = HW.M5.nutH + c, nutR = nutAF / Math.sqrt(3);
    const L = [];
    const add = (key, name, qty, color, build, printT, note) => L.push({ key, name, qty, color, build, printT: printT || M.I(), note: note || '' });
    const yUp = M.Rx(90), yDown = M.Rx(-90);
    const { Su, Sf, a, aNeed, Wc, slotH, slotHalf, Hb, Wtail, zT0, zCC, hw, hd, xS, zS, xB, zB, frame, board, BG } = D;
    const xo = hw + EK.cw, zf = hd + EK.cw, zr = -(hd + EK.cwR);
    const fx = frame[0], fz = frame[1];
    const corners = (S) => [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => [sx * (S / 2 - K.corner), sz * (S / 2 - K.corner)]);
    const sgn4 = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    const refPart = (k) => ref.parts.find((p) => p.key === k);

    // --- Кронштейн колонны к доске: фланец с юстировочными винтами (три точки) и гнездо колонны с барашками
    add('base_bracket', tr('part.enl_base'), 1, COL.struct, () => {
      const T = EK.Tbb, xs = hw + EK.sock, zs = hd + EK.sock;
      let s = prismXZ(rectXZ(-D.flX, D.flZB, D.flX, D.flZF, 6, 6), 0, T, 0.8, 1);
      s = s.union(prismXZ(rectXZ(-xs, -zs, xs, zs, 2, 3), T - 0.5, T + EK.sockH, 0, 1));
      const cuts = [box(-hw, T, -hd, hw, T + EK.sockH + 1, hd)];
      for (const sx of [-1, 1]) cuts.push(cylX(sx * (hw - 1), sx * (xs + 1), T + 22, D.zk, HW.M5.hole));
      // юстировочные винты: гайка снизу (упор вверх в пластик), винт упирается в доску
      for (const [x, z] of D.jacks) cuts.push(cylY(-1, T + 1, x, z, HW.M5.hole), hexY(-1, nutHp, x, z, nutAF));
      // шурупы по дереву — с потаем
      for (const [x, z] of D.woods) cuts.push(cylY(-1, T + 1, x, z, 4.5), CSG.cylinder([x, T - 2.3, z], [x, T + 0.01, z], 2.4, 24, 4.6));
      return s.subtractAll(cuts);
    }, yUp, tr('part.note.flangeDown'));

    // --- Заглушка колонны: упор для головки; снимается барашком — головка снимается вверх
    add('column_cap', tr(BG ? (BG.kind === 'spring' ? 'part.enl_cap_spring' : 'part.enl_cap_pulley') : 'part.enl_cap'), 1, COL.carriage, () => {
      const T = EK.colCapT, cx = hw + 3, cz = hd + 3;
      const zBack = BG ? Math.min(-cz, BG.z - BG.earR) : -cz;
      let s = prismXZ(rectXZ(-cx, zBack, cx, cz, 2, 3), 0, T, 0, 1);
      s = s.union(prismXZ(rectXZ(-cx, -cz, cx, cz, 2, 3), -EK.skirtH, 0.5, 0.6, 0));
      const cuts = [box(-hw, -EK.skirtH - 1, -hd, hw, 0, hd), cylY(-1, T + 1, D.capK[0], D.capK[1], HW.M5.hole)];
      if (BG) {
        const x0 = BG.w / 2 + 0.5, x1 = x0 + BG.earT;
        const ears = [];
        for (const sx of [-1, 1]) {
          const [a0, a1] = [Math.min(sx * x0, sx * x1), Math.max(sx * x0, sx * x1)];
          ears.push(box(a0, BG.y, BG.z - BG.earR, a1, 0.5, BG.z + BG.earR), CSG.cylinder([a0, BG.y, BG.z], [a1, BG.y, BG.z], BG.earR, 32));
        }
        s = s.unionAll(ears);
        cuts.push(cylX(-x1 - 1, x1 + 1, BG.y, BG.z, HW.M5.hole));
      }
      return s.subtractAll(cuts);
    }, yDown, tr('part.note.topDown'));

    // --- Каретка головки: обойма на колонне, полка под хвост негативной плиты, фиксатор с колодкой, гайка винта M6
    const shelfEndH = -Su / 2 - 0.5 - zCC;
    add('head_carriage', tr('part.enl_head_carriage'), 1, COL.carriage, () => {
      let s = prismXZ(rectXZ(-xo, zr, xo, zf, 3, 4), 0, EK.Hh, 0.8, 1);
      s = s.union(prismXZ(rectXZ(-Wtail / 2, zf - 2, Wtail / 2, shelfEndH, 3, 4), 0, EK.Ts, 0.8, 1));
      s = s.union(prismXZ(rectXZ(xo - 1, -8, xo + 6, 8, 2, 3), 0, EK.Hh, 0.8, 1)); // бобышка фиксатора — от стола
      const y = D.yLk, xn = hw + 4.2;
      const cuts = [
        box(-hw, -1, -hd, hw, EK.Hh + 1, hd),
        box(hw - 0.01, y - PAD.y / 2 - 0.5, -PAD.z / 2 - 0.5, hw + EK.padX + 0.3, y + PAD.y / 2 + 0.5, PAD.z / 2 + 0.5), // карман колодки
        cylX(hw - 1, xo + 7, y, 0, HW.M5.hole),
        box(xn, y - nutR, -nutAF / 2, xn + nutHp, EK.Hh + 1, nutAF / 2), // гайка фиксатора опускается сверху
        cylY(-1, EK.Ts + 1, xS, zS - zCC, 7),
        hexY(EK.Ts - (M6.nutH + c), EK.Ts + 1, xS, zS - zCC, M6.nutAF + c), // гайка ходового винта: снизу упор, сверху закрыта плитой
      ];
      for (const sx of [-1, 1]) cuts.push(cylY(-1, EK.Ts + 1, sx * xB, zB - zCC, HW.M5.hole));
      if (BG && BG.kind === 'spring') cuts.push(cylY(EK.Hh - 10, EK.Hh + 1, 0, D.zAnch, HW.M3.selfTap));
      if (BG && BG.kind === 'weight') cuts.push(cylY(EK.Hh - 12, EK.Hh + 1, 0, D.zAnch, 3.2), cylX(-xo - 1, xo + 1, EK.Hh - 8, D.zAnch, 3.2));
      return s.subtractAll(cuts);
    }, yUp, tr('part.note.shelfDown'));

    add('brake_pad', tr('part.enl_pad'), 1, COL.accent, () =>
      prismXZ(rectXZ(0, -PAD.z / 2, EK.padX, PAD.z / 2, 0.8, 2), -PAD.y / 2, PAD.y / 2, 0.4, 0.4), M.Ry(-90), tr('part.note.flat'));

    // --- Каретка объектива: обойма висит под полкой; полка с языком — три точки юстировки, винт M6 с маховиком снизу
    const zA = -Sf / 2 - 1 - zCC;
    add('lens_carriage', tr('part.enl_lens_carriage'), 1, COL.carriage, () => {
      let s = prismXZ(rectXZ(-xo, zr, xo, zf, 3, 4), -EK.Hl, 0, 1, 0.8);
      s = s.union(prismXZ(rectXZ(-Wtail / 2, zf - 2, Wtail / 2, zA, 3, 4), -EK.Ts, 0, 1, 0.8));
      s = s.union(prismXZ([[-14, zA - 4], [14, zA - 4], [12, D.zLe - zCC], [-12, D.zLe - zCC]], -EK.Ts, 0, 1, 0.8));
      const cuts = [box(-hw, -EK.Hl - 1, -hd, hw, 1, hd), cylY(-EK.Ts - 1, 1, xS, zS - zCC, 6.6)];
      for (const [x, z] of D.lev) cuts.push(cylY(-EK.Ts - 1, 1, x, z - zCC, HW.M3.hole), cylY(-EK.Ts - 1, -EK.Ts + HW.M3.cbH, x, z - zCC, HW.M3.cbD));
      return s.subtractAll(cuts);
    }, yDown, tr('part.note.shelfDown'));

    // --- Негативная плита: снизу задняя рамка меха, сверху столик; хвост на полке каретки головки
    add('neg_base', tr('part.enl_neg_base'), 1, COL.frame, () => {
      const T = EK.Tnb;
      let s = prismXZ(rectXZ(-Su / 2, -Su / 2, Su / 2, Su / 2, 6, 6), 0, T, 0.8, 1);
      s = s.union(prismXZ(rectXZ(-Wtail / 2, zT0, Wtail / 2, -Su / 2 + 4, 3, 4), 0, T, 0.8, 1));
      const cuts = [box(-(fx / 2 + 2), -1, -(fz / 2 + 2), fx / 2 + 2, T + 1, fz / 2 + 2), cylY(-1, T + 1, xS, zS, 8)];
      for (const [x, z] of corners(D.Sr)) cuts.push(cylY(-1, T + 1, x, z, HW.M3.hole), cylY(T - HW.M3.cbH, T + 1, x, z, HW.M3.cbD));
      for (const [sx, sz] of sgn4) cuts.push(cylY(T - 9, T + 1, sx * D.xw, sz * D.zw, HW.M3.selfTap));
      for (const sx of [-1, 1]) cuts.push(cylY(-1, T + 1, sx * xB, zB, HW.M5.hole), hexY(T - nutHp, T + 1, sx * xB, zB, nutAF));
      return s.subtractAll(cuts);
    }, yUp, tr('part.note.flat'));

    // --- Столик: паз рамки негатива (открыт спереди, гребень светового замка вокруг), окно в крыше, канавка кольца
    const Ht = slotH + EK.Tr, yr = slotH + 2.5, xr = slotHalf + 2.5, z1 = Su / 2;
    add('neg_stage', tr('part.enl_neg_stage'), 1, COL.frame, () => {
      let s = prismXZ(rectXZ(-Su / 2, -Su / 2, Su / 2, Su / 2, 5, 6), 0, Ht, 0.6, 1);
      s = s.unionAll([ridgeX(yr, z1, 2, -xr - 2, xr + 2), ridgeY(-xr, z1, 2, 0, yr), ridgeY(xr, z1, 2, 0, yr)]);
      const w2 = (EK.sealW + 2 * c) / 2;
      const cuts = [
        box(-slotHalf, -1, -Su / 2 + EK.Wb, slotHalf, slotH, Su / 2 + 3),
        box(-aNeed / 2, slotH - 1, -aNeed / 2, aNeed / 2, Ht + 1, aNeed / 2),
        box(-(D.gc + w2), Ht - EK.sealD, -(D.gc + w2), D.gc + w2, Ht + 1, D.gc + w2).subtract(box(-(D.gc - w2), Ht - EK.sealD - 1, -(D.gc - w2), D.gc - w2, Ht + 2, D.gc - w2)),
      ];
      for (const [sx, sz] of sgn4) cuts.push(cylY(-1, Ht + 1, sx * D.xw, sz * D.zw, HW.M3.hole));
      return s.subtractAll(cuts);
    }, yDown, tr('part.note.roofDown'));

    // --- Рамка негатива: нижняя створка с маской точно по кадру, крышкой светового замка и штифтами; верхняя — прижим
    const zc0 = -Su / 2 + EK.Wb + c, zc1 = z1 + EK.capT;
    const pins = sgn4.map(([sx, sz]) => [sx * (D.F.film[0] / 2 + 4), sz * (fz / 2 + 6)]);
    const capH = Ht, capW = 2 * (slotHalf + 9);
    add('carrier_bottom', tr('part.enl_carrier_bottom', { format: D.F.name }), 1, COL.board, () => {
      let s = prismXZ(rectXZ(-Wc / 2, zc0, Wc / 2, zc1, 2, 3), 0, EK.tLb, 0, 0.3);
      const adds = [
        CSG.prism(rrect(-capW / 2, 0, capW / 2, capH, [[0, 1], [2, 4], [2, 4], [0, 1]]), z1, zc1),
        prismXZ(rectXZ(-10, zc1 - 0.5, 10, zc1 + 5, 2, 4), 0, capH, 0, 0.8), // ручка
      ];
      for (const [x, z] of pins) adds.push(cylY(EK.tLb - 0.01, EK.tLb + 1.2, x, z, 2.6));
      s = s.unionAll(adds);
      const film = D.F.film;
      const cuts = [
        box(-fx / 2, -1, -fz / 2, fx / 2, EK.tLb + 1, fz / 2), // окно — ровно кадр
        D.F.sheet
          ? box(-(film[0] / 2 + 0.2), EK.tLb - EK.rec, -(film[1] / 2 + 0.2), film[0] / 2 + 0.2, EK.tLb + 0.01, film[1] / 2 + 0.2)
          : box(-(film[0] / 2 + 0.2), EK.tLb - EK.rec, zc0 - 1, film[0] / 2 + 0.2, EK.tLb + 0.01, z1 - 0.5),
        ridgeX(yr, z1, 2, -xr - 2 - c, xr + 2 + c, c),
        ridgeY(-xr, z1, 2, -1, yr + 0.1, c), ridgeY(xr, z1, 2, -1, yr + 0.1, c),
      ];
      return s.subtractAll(cuts);
    }, yUp, tr('part.note.flat'));
    add('carrier_top', tr('part.enl_carrier_top'), 1, COL.board, () => {
      const s = prismXZ(rectXZ(-Wc / 2, zc0, Wc / 2, z1 - 0.5, 2, 3), 0, EK.tLt, 0, 0.3);
      const cuts = [box(-(fx / 2 + 1), -1, -(fz / 2 + 1), fx / 2 + 1, EK.tLt + 1, fz / 2 + 1)];
      for (const [x, z] of pins) cuts.push(cylY(-1, EK.tLt + 1, x, z, 2.6 + 2 * c));
      return s.subtractAll(cuts);
    }, yUp, tr('part.note.flat'));

    // --- Кольцо светового замка: лежит в канавках крыши столика и дна осветителя
    add('seal_ring', tr('part.enl_seal'), 1, COL.frame, () => {
      const o = D.gc + EK.sealW / 2, i = D.gc - EK.sealW / 2;
      return box(-o, 0, -o, o, EK.sealH, o).subtract(box(-i, -1, -i, i, EK.sealH + 1, i));
    }, yUp);

    // --- Осветитель: камера смешения (белая внутри), уступ под рассеиватель, бобышки для светодиодной плиты
    add('lamp_body', tr('part.enl_lamp'), 1, COL.back, () => {
      const ao = a / 2 + EK.wall, fl = Su / 2 - 1;
      let s = prismXZ(rectXZ(-ao, -ao, ao, ao, 3, 4), 0, Hb, 0.6, 1);
      s = s.union(prismXZ(rectXZ(-fl, -fl, fl, fl, 5, 6), 0, EK.flangeT, 0.6, 1));
      s = s.unionAll(sgn4.map(([sx, sz]) => CSG.cylinder([sx * D.bossC, 0, sz * D.bossC], [sx * D.bossC, Hb, sz * D.bossC], 4.5, 32)));
      const w2 = (EK.sealW + 2 * c) / 2;
      const cuts = [
        box(-a / 2, EK.ledgeH, -a / 2, a / 2, Hb + 1, a / 2),
        box(-aNeed / 2, -1, -aNeed / 2, aNeed / 2, EK.ledgeH + 0.01, aNeed / 2),
        box(-(D.gc + w2), -1, -(D.gc + w2), D.gc + w2, EK.sealD, D.gc + w2).subtract(box(-(D.gc - w2), -2, -(D.gc - w2), D.gc - w2, EK.sealD + 1, D.gc - w2)),
      ];
      for (const [sx, sz] of sgn4) {
        cuts.push(cylY(Hb - 10, Hb + 1, sx * D.bossC, sz * D.bossC, HW.M3.selfTap));
        cuts.push(cylY(-1, EK.flangeT + 1, sx * D.xw, sz * D.zw, HW.M3.hole), cylY(EK.flangeT - HW.M3.cbH, EK.flangeT + 1, sx * D.xw, sz * D.zw, HW.M3.cbD));
      }
      return s.subtractAll(cuts);
    }, yUp, tr('part.note.flangeDown'));

    // --- Светодиодная плита: ряды ленты снизу, щели вентиляции у краёв, отверстие под провод
    const po = a / 2 + 9;
    add('led_plate', tr('part.enl_led_plate'), 1, COL.plate, () => {
      const s = prismXZ(rectXZ(-po, -po, po, po, 4, 6), 0, EK.ledT, 0.5, 0.8);
      const cuts = [cylY(-1, EK.ledT + 1, -(a / 2 - 6), 0, 5)];
      for (const [x, len] of ventSlots(a)) for (const sz of [-1, 1]) cuts.push(H.slot('y', -1, EK.ledT + 1, x, sz * (a / 2 - 5), len, 3));
      for (const [sx, sz] of sgn4) cuts.push(cylY(-1, EK.ledT + 1, sx * D.bossC, sz * D.bossC, HW.M3.hole));
      return s.subtractAll(cuts);
    }, yUp, tr('part.note.flat'));

    // --- Крышка-лабиринт: юбка по периметру, выходные щели в середине — далеко от щелей плиты (прямого луча нет)
    add('vent_cap', tr('part.enl_vent_cap'), 1, COL.back, () => {
      const Hc = EK.ventGap + EK.capTop, pi = po - EK.skirt;
      let s = prismXZ(rectXZ(-po, -po, po, po, 4, 6), EK.ventGap, Hc, 0, 1);
      s = s.union(prismXZ(rectXZ(-po, -po, po, po, 4, 6), 0, EK.ventGap + 0.5, 0.5, 0).subtract(box(-pi, -1, -pi, pi, EK.ventGap + 1, pi)));
      s = s.unionAll(sgn4.map(([sx, sz]) => CSG.cylinder([sx * D.bossC, 0, sz * D.bossC], [sx * D.bossC, EK.ventGap + 0.5, sz * D.bossC], 4, 32)));
      const cuts = [box(po - 3, -1, -3.5, po + 1, 3.5, 3.5)];
      for (const [x, z, len] of capSlots(a)) cuts.push(len > 0 ? H.slot('y', EK.ventGap - 1, Hc + 1, x, z, len, 3) : cylY(EK.ventGap - 1, Hc + 1, x, z, 3));
      for (const [sx, sz] of sgn4) cuts.push(cylY(-1, Hc + 1, sx * D.bossC, sz * D.bossC, HW.M3.hole), cylY(Hc - HW.M3.cbH, Hc + 1, sx * D.bossC, sz * D.bossC, HW.M3.cbD));
      return s.subtractAll(cuts);
    }, yDown, tr('part.note.topDown'));

    // --- Объективная рамка: карман платы снизу, защёлки по бокам, хвост на трёх точках юстировки
    add('lens_frame', tr('part.enl_lens_frame'), 1, COL.frame, () => {
      const T = EK.Tl, bw = board.w / 2 + c, bh = board.h / 2 + c, bo = D.R.boardOpen;
      let s = prismXZ(rectXZ(-Sf / 2, -Sf / 2, Sf / 2, Sf / 2, K.R, 10), 0, T, K.ch, K.ch);
      s = s.union(prismXZ(rectXZ(-Wtail / 2, zT0, Wtail / 2, -Sf / 2 + 4, 3, 4), 0, T, 0.8, 1));
      const cuts = [
        box(-bo[0] / 2, -1, -bo[1] / 2, bo[0] / 2, T + 1, bo[1] / 2),
        box(-bw, -1, -bh, bw, K.tBoard, bh),
        cylY(-1, T + 1, xS, zS, 8),
        cylY(-1, M6.washerT + M6.nutH + 0.6 - D.padH, xS, zS, 14), // гайка-упор винта над нижней полкой
      ];
      for (const sx of [-1, 1]) cuts.push(cylY(-1, 8, sx * (bw + 6), 0, HW.M3.selfTap));
      for (const [x, z] of corners(Sf)) cuts.push(cylY(-1, T + 1, x, z, HW.M3.hole), cylY(-1, HW.M3.cbH, x, z, HW.M3.cbD));
      for (const [x, z] of D.lev) cuts.push(cylY(-1, 9, x, z, HW.M3.selfTap));
      return s.subtractAll(cuts);
    }, yUp, tr('part.note.pocketDown'));

    // --- те же, что у камеры: плата (отверстие под крепление объектива), защёлки, рамки меха
    const lb = refPart('lens_board');
    L.push(Object.assign({}, lb, { name: tr('part.enl_lens_board', { w: board.w, h: board.h, mount: D.mount.name }) }));
    L.push(Object.assign({}, refPart('latch')));
    L.push(Object.assign({}, refPart('bellows_frame_front')));
    L.push(Object.assign({}, refPart('bellows_frame_rear')));

    // --- Маховик фокусировки: гайка M6 сверху, контргайка снизу
    add('focus_knob', tr('part.enl_focus_knob'), 1, COL.accent, () => {
      const r = EK.knobF / 2, Hk = EK.knobFH, n = 72;
      const s = loft([
        { p: circle(r - 1, n), z: 0 }, { p: circle(r, n), z: 1 },
        { p: circle(r, n), z: Hk - 1.5 }, { p: circle(r - 1.5, n), z: Hk },
      ]);
      const cuts = [];
      for (let i = 0; i < 18; i++) {
        const ang = ((i + 0.5) / 18) * Math.PI * 2, rr = r + 0.6;
        cuts.push(CSG.cylinder([Math.cos(ang) * rr, Math.sin(ang) * rr, -1], [Math.cos(ang) * rr, Math.sin(ang) * rr, Hk + 1], 2, 16));
      }
      cuts.push(cylZ(-1, Hk + 1, 0, 0, 6.4), H.hexZ(Hk - (M6.nutH + c), Hk + 1, 0, 0, M6.nutAF + c), H.hexZ(-1, M6.nutH + c, 0, 0, M6.nutAF + c));
      return s.subtractAll(cuts);
    }, M.I());

    const kn = refPart('knob_small');
    L.push(Object.assign({}, kn, { name: tr('part.enl_knob'), qty: 4 }));

    if (BG && BG.kind === 'spring') {
      add('spring_drum', tr('part.enl_drum', { d: num(cp.enlSpringD) }), 1, COL.accent, () => {
        const r = BG.r, Rf = BG.R, w = BG.w, n = 64;
        const s = loft([
          { p: circle(Rf - 0.5, n), z: 0 }, { p: circle(Rf, n), z: 0.5 }, { p: circle(Rf, n), z: 1.5 },
          { p: circle(r, n), z: 1.5 + (Rf - r) }, { p: circle(r, n), z: w - (Rf - r) }, { p: circle(Rf, n), z: w },
        ]);
        return s.subtract(cylZ(-1, w + 1, 0, 0, 5.8));
      }, M.I());
    }
    if (BG && BG.kind === 'weight') {
      add('pulley', tr('part.enl_pulley'), 1, COL.accent, () => {
        const Ro = BG.R, rg = BG.r, w = BG.w, n = 64;
        const s = loft([
          { p: circle(Ro - 0.5, n), z: 0 }, { p: circle(Ro, n), z: 0.5 }, { p: circle(Ro, n), z: 1 },
          { p: circle(rg, n), z: w / 2 }, { p: circle(Ro, n), z: w - 1 }, { p: circle(Ro, n), z: w },
        ]);
        return s.subtract(cylZ(-1, w + 1, 0, 0, 5.8));
      }, M.I());
      const wb = D.wb;
      add('weight_box', tr('part.enl_weight_box', { g: Math.round(D.mass.total) }), 1, COL.struct, () => {
        const t = wb.t, hx = wb.W / 2, hz = wb.D / 2;
        let s = prismXZ(rectXZ(-hx, -hz, hx, hz, 3, 4), 0, wb.H, 0.6, 0).subtract(box(-hx + t, t, -hz + t, hx - t, wb.H + 1, hz - t));
        s = s.unionAll([-1, 1].map((sx) => CSG.cylinder([sx * (hx - t - 3), t, 0], [sx * (hx - t - 3), wb.H, 0], 3.5, 24)));
        return s.subtractAll([-1, 1].map((sx) => cylY(wb.H - 8, wb.H + 1, sx * (hx - t - 3), 0, HW.M3.selfTap)));
      }, yUp, tr('part.note.flangeDown'));
      add('weight_lid', tr('part.enl_weight_lid'), 1, COL.struct, () => {
        const hx = wb.W / 2, hz = wb.D / 2;
        const s = prismXZ(rectXZ(-hx, -hz, hx, hz, 3, 4), 0, wb.lidT, 0.4, 0.6);
        const cuts = [cylY(-1, wb.lidT + 1, 0, 0, 3.2)];
        for (const sx of [-1, 1]) cuts.push(cylY(-1, wb.lidT + 1, sx * (hx - wb.t - 3), 0, HW.M3.hole));
        return s.subtractAll(cuts);
      }, yUp, tr('part.note.flat'));
    }
    return L;
  }

  /** Щели вентиляции светодиодной плиты (у двух краёв): [[x, длина], …]. */
  function ventSlots(a) {
    const x1 = a / 2 - 15;
    if (x1 - 2 >= 9) { const len = x1 - 2 - 3; return [[-(2 + x1) / 2, len], [(2 + x1) / 2, len]]; }
    return [[0, Math.max(0, a - 36)]];
  }
  /** Выходные щели крышки — в середине, на расстоянии от щелей плиты и провода больше «вылета» косого луча. */
  function capSlots(a) {
    const zMax = a / 2 - 21, xMax = a / 2 - 22, out = [];
    const len = Math.max(0, 2 * xMax - 3);
    for (let z = 0; z <= zMax + 1e-9; z += 8) { out.push([0, z, len]); if (z > 0) out.push([0, -z, len]); }
    if (!out.length) out.push([0, 0, 0]);
    return out;
  }

  // ---------------------------------------------------------------------
  // Расстановка при увеличении m
  // ---------------------------------------------------------------------
  function placements(enl, m, folded, opts) {
    const D = enl.dims, T = M.T, s = D.st(m);
    const { zCC, hw, BG } = D;
    const xo = hw + EK.cw;
    const bw = D.board.w / 2 + D.c + 6;
    const P = {
      base_bracket: [T(0, EK.jack, zCC)],
      column_cap: [T(0, D.colTop, zCC)],
      head_carriage: [T(0, s.hcBot, zCC)],
      brake_pad: [T(D.col[0] / 2 + 0.1, s.hcBot + D.yLk, zCC)],
      lens_carriage: [T(0, s.lcTop, zCC)],
      neg_base: [T(0, s.yNB, 0)],
      neg_stage: [T(0, s.yS, 0)],
      carrier_bottom: [T(0, s.yS, 0)],
      carrier_top: [T(0, s.yS + EK.tLb, 0)],
      seal_ring: [T(0, s.yRT - EK.sealD + 0.1, 0)],
      lamp_body: [T(0, s.yRT, 0)],
      led_plate: [T(0, s.yRT + D.Hb, 0)],
      vent_cap: [T(0, s.yRT + D.Hb + EK.ledT, 0)],
      lens_frame: [T(0, s.yL, 0)],
      lens_board: [M.chain(T(0, s.yL, 0), M.Rx(-90))],
      // защёлки лежат на нижней грани рамки, толщиной вниз, плечом к плате
      latch: [[-1, 0, 0, bw, 0, 0, -1, s.yL, 0, -1, 0, 0], [1, 0, 0, -bw, 0, 0, -1, s.yL, 0, 1, 0, 0]],
      bellows_frame_front: [M.chain(T(0, s.yL + EK.Tl, 0), M.Rx(-90))],
      bellows_frame_rear: [M.chain(T(0, s.yNB, 0), M.Rx(90))],
      focus_knob: [M.chain(T(D.xS, s.lcTop - EK.Ts - M6.washerT - EK.knobFH, D.zS), M.Rx(-90))],
      knob_small: [
        M.chain(T(xo + 6, s.hcBot + D.yLk, zCC), M.Ry(90)), // фиксатор головки
        M.chain(T(D.capK[0], D.colTop + EK.colCapT, zCC + D.capK[1]), M.Rx(-90)), // заглушка
        M.chain(T(hw + EK.sock, EK.jack + EK.Tbb + 22, zCC + D.zk), M.Ry(90)), // кронштейн
        M.chain(T(-hw - EK.sock, EK.jack + EK.Tbb + 22, zCC + D.zk), M.Ry(-90)),
      ],
    };
    if (BG) {
      const axis = M.chain(T(-BG.w / 2, D.colTop + BG.y, zCC + BG.z), M.Ry(90));
      if (BG.kind === 'spring') P.spring_drum = [axis];
      else {
        P.pulley = [axis];
        const yb = weightBoxY(D, s);
        P.weight_box = [T(0, yb, zCC + D.wb.z)];
        P.weight_lid = [T(0, yb + D.wb.H, zCC + D.wb.z)];
      }
    }
    return P;
  }

  /** Низ противовеса: шнур постоянной длины — головка вверх, груз вниз (у нижней головки груз под самым блоком). */
  function weightBoxY(D, s) {
    const samples = [];
    for (let i = 0; i <= 60; i++) samples.push(D.st(D.mMin * (D.mMax / D.mMin) ** (i / 60)).hcTop);
    if (D.mMin < 1 && D.mMax > 1) samples.push(D.st(1).hcTop);
    const hcMin = Math.min(...samples);
    const topAtMin = D.colTop + D.BG.y - D.BG.R - 5;
    return topAtMin - D.wb.lidT - D.wb.H - (s.hcTop - hcMin);
  }

  // ---------------------------------------------------------------------
  // Крепёж (модель та же, что у камеры: p — точка под головкой, d — направление стержня)
  // ---------------------------------------------------------------------
  const FX_KEYS = ['eArm', 'eLevel', 'eLock', 'eStage', 'eBfR', 'eBfF', 'eLatch', 'eLed', 'eCap', 'eBase', 'eJack', 'eFocus', 'eDrum', 'eTape', 'ePulley', 'eWLid'];

  function fastenerLayout(enl, m, folded, opts) {
    const D = enl.dims, c = D.c, K = H.K, HW = H.HW, FW = H.FW, s = D.st(m);
    const P = placements(enl, m, folded, opts);
    const at = (mm, p) => M.apply(mm, p);
    const dirOf = (mm, d) => { const a = at(mm, [0, 0, 0]), b = at(mm, d); return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; };
    const nutHp = HW.M5.nutH + c;
    const out = [];
    const add = (key, o) => out.push(Object.assign({ key, size: 'M5', kind: 'hex', washer: 0, nut: null, thread: null, stack: 0 }, o));
    const knob = (mm) => ({ p: at(mm, [0, 0, 0]), d: dirOf(mm, [0, 0, -1]) });
    const tapM3 = (s0, s1, tail) => ({ size: 'M3', kind: 'socket', thread: [s0, s1], lo: s0 + H.THREAD_MIN.M3, hi: s1 + tail, pick: 'max' });
    const { zCC, hw, BG } = D;

    // негативная плита к полке каретки: болт снизу с шайбой, гайка в гнезде хвоста (сверху)
    for (const sx of [-1, 1]) {
      const su = FW.M5 + EK.Ts + EK.Tnb;
      add('eArm', { p: [sx * D.xB, s.hcBot - FW.M5, D.zB], d: [0, 1, 0], washer: FW.M5, nut: su - nutHp, lo: su - nutHp + H.THREAD_MIN.nut, hi: su + 1.5, pick: 'max' }); // конец болта — не выше 1,5 мм над хвостом
    }
    // объективная рамка к нижней полке: винт M3 из цековки полки, через две шайбы-прокладки, в пластик рамки
    for (const [x, z] of D.lev) {
      const s0 = EK.Ts - HW.M3.cbH + D.padH;
      add('eLevel', Object.assign({ p: [x, s.lcTop - EK.Ts + HW.M3.cbH, z], d: [0, 1, 0] }, tapM3(s0, s0 + 9, -0.5)));
    }
    // фиксатор головки: винт в барашке через гайку в бобышке давит на колодку
    {
      const k = knob(P.knob_small[0]), xo = hw + EK.cw + 6, xn = hw + 4.2;
      const stop = xo - (D.col[0] / 2 + 0.1 + EK.padX);
      add('eLock', Object.assign(k, { nut: xo - xn - nutHp, stop, lo: stop + 1.5, hi: stop + 4, pick: 'min', free: stop - 0.05 }));
    }
    // осветитель + столик к негативной плите: винт из цековки фланца через крышу и стенку
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const s0 = EK.flangeT - HW.M3.cbH + D.slotH + EK.Tr;
      add('eStage', Object.assign({ p: [sx * D.xw, s.yRT + EK.flangeT - HW.M3.cbH, sz * D.zw], d: [0, -1, 0] }, tapM3(s0, s0 + 9, -0.5)));
    }
    // задняя рамка меха: винт из цековки негативной плиты вниз, в пластину рамки меха
    const cornerPts = (S) => [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => [a * (S / 2 - K.corner), b * (S / 2 - K.corner)]);
    for (const [x, z] of cornerPts(D.Sr)) {
      const s0 = EK.Tnb - HW.M3.cbH;
      add('eBfR', Object.assign({ p: [x, s.yS - HW.M3.cbH, z], d: [0, -1, 0] }, tapM3(s0, s0 + K.tPlate, 0.5)));
    }
    // передняя рамка меха: винт из цековки объективной рамки вверх
    for (const [x, z] of cornerPts(D.Sf)) {
      const s0 = EK.Tl - HW.M3.cbH;
      add('eBfF', Object.assign({ p: [x, s.yL + HW.M3.cbH, z], d: [0, 1, 0] }, tapM3(s0, s0 + K.tPlate, 0.5)));
    }
    // защёлки платы
    for (const mm of P.latch) {
      const t = 2.5, s0 = t + FW.M3;
      add('eLatch', Object.assign({ p: at(mm, [0, 0, t + FW.M3]), d: dirOf(mm, [0, 0, -1]), washer: FW.M3 }, tapM3(s0, s0 + 8, -0.5)));
    }
    // светодиодная плита и крышка: винт из цековки крышки через стойку и плиту в бобышку корпуса
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const top = s.yRT + D.Hb + EK.ledT + EK.ventGap + EK.capTop, s0 = EK.ventGap + EK.capTop - HW.M3.cbH + EK.ledT;
      add('eLed', Object.assign({ p: [sx * D.bossC, top - HW.M3.cbH, sz * D.bossC], d: [0, -1, 0] }, tapM3(s0, s0 + 10, -0.5)));
    }
    // заглушка колонны: барашек, винт в центральный канал профиля (нарезать M5)
    add('eCap', Object.assign(knob(P.knob_small[1]), { lo: EK.colCapT + 6, hi: EK.colCapT + 10, pick: 'min', free: EK.colCapT }));
    // кронштейн: барашки через стенку гнезда в Т-гайки в пазу колонны
    for (const mm of P.knob_small.slice(2, 4)) {
      const s0 = EK.sock + c;
      add('eBase', Object.assign(knob(mm), { lo: s0 + 1.8 + 2.5, hi: s0 + 6, pick: 'max', free: s0 + 1.8, tnut: true }));
    }
    // юстировочные винты кронштейна: головка над фланцем, гайка в гнезде снизу, конец упирается в доску
    for (const [x, z] of D.jacks) {
      const top = EK.jack + EK.Tbb + EK.jack;
      add('eJack', { p: [x, top, zCC + z], d: [0, -1, 0], nut: top - EK.jack - nutHp, lo: top, hi: top, pick: 'min' });
    }
    // ходовой винт: шпилька M6 от маховика, свободно через нижнюю полку и рамку, резьба — в гайке верхней полки
    {
      const p0 = s.lcTop - EK.Ts - M6.washerT - EK.knobFH + 1;
      const nutY = s.yNB - (M6.nutH + c);
      add('eFocus', { size: 'M6', kind: 'rod', p: [D.xS, p0, D.zS], d: [0, 1, 0], nut: nutY - p0, len: D.rodL, lo: D.rodL, hi: D.rodL, pick: 'min', fixedLen: true });
    }
    if (BG) {
      // ось барабана или блока: болт через уши заглушки, гайка снаружи
      const x1 = BG.w / 2 + 0.5 + BG.earT, span = 2 * x1;
      add(BG.kind === 'spring' ? 'eDrum' : 'ePulley', { p: [x1, D.colTop + BG.y, zCC + BG.z], d: [-1, 0, 0], nut: span, lo: span + HW.M5.nutH + 1, hi: span + HW.M5.nutH + 6, pick: 'min' });
      if (BG.kind === 'spring') {
        const s0 = 0.3 + FW.M3; // конец ленты пружины под шайбой
        add('eTape', Object.assign({ p: [0, s.hcTop + 0.3 + FW.M3, zCC + D.zAnch], d: [0, -1, 0], washer: FW.M3 }, tapM3(s0, s0 + 10, -0.5)));
      } else {
        const yb = weightBoxY(D, s) + D.wb.H + D.wb.lidT;
        for (const sx of [-1, 1]) add('eWLid', Object.assign({ p: [sx * (D.wb.W / 2 - D.wb.t - 3), yb, zCC + D.wb.z], d: [0, -1, 0] }, tapM3(D.wb.lidT, D.wb.lidT + 8, -0.5)));
      }
    }

    const byKey = {};
    for (const x of out) {
      const g = byKey[x.key] || (byKey[x.key] = { lo: -Infinity, hi: Infinity, pick: x.pick, size: x.size, fixed: x.fixedLen ? x.len : 0 });
      g.lo = Math.max(g.lo, x.lo); g.hi = Math.min(g.hi, x.hi);
    }
    for (const k of Object.keys(byKey)) byKey[k].len = byKey[k].fixed || H.pickLen(byKey[k].size, byKey[k].lo, byKey[k].hi, byKey[k].pick);
    for (const x of out) { x.len = byKey[x.key].len; if (x.free === undefined) x.free = x.len; }
    return out;
  }

  // ---------------------------------------------------------------------
  // Покупное
  // ---------------------------------------------------------------------
  function fastenerBOM(fx) {
    const rows = new Map();
    const name = (x) => tr(x.kind === 'hex' ? 'hw.bolt' : 'hw.screw', { size: x.size, len: x.len, din: x.kind === 'hex' ? 933 : 912 });
    for (const x of fx) {
      if (x.kind === 'rod') continue;
      const n = name(x), r = rows.get(n) || { name: n, qty: 0, groups: new Map() };
      r.qty++;
      r.groups.set(x.key, (r.groups.get(x.key) || 0) + 1);
      rows.set(n, r);
    }
    const list = [...rows.values()].map((r) => ({
      name: r.name, qty: r.qty,
      note: [...r.groups].map(([k, n]) => (r.groups.size > 1 ? `${H.fxLabel(k)} (${n})` : H.fxLabel(k))).join('; '),
    }));
    const count = (pred) => fx.filter(pred).length;
    const nuts = count((x) => x.size === 'M5' && x.nut !== null);
    const w5 = count((x) => x.size === 'M5' && x.washer > 0);
    const w3 = fx.filter((x) => x.size === 'M3').reduce((s, x) => s + (x.washer > 0 ? 1 : 0) + (x.key === 'eLevel' ? 2 : 0), 0);
    if (nuts) list.push({ name: tr('hw.nut'), qty: nuts, note: tr('hw.nutNote') });
    if (w5) list.push({ name: tr('hw.washer', { size: 'M5' }), qty: w5, note: tr('hw.e.w5') });
    if (w3) list.push({ name: tr('hw.washer', { size: 'M3' }), qty: w3, note: tr('hw.e.w3') });
    const tn = count((x) => x.tnut);
    if (tn) list.push({ name: tr('hw.tnut'), qty: tn, note: tr('hw.e.tnut') });
    return list;
  }

  function hardwareList(enl, bm) {
    const D = enl.dims, cp = enl.params, list = fastenerBOM(enl.fasteners), led = D.led;
    const extra = [
      { name: tr('hw.e.column', { col: tr('opt.enlColumn.' + cp.enlColumn) }), qty: 1, note: tr('hw.profileNote', { len: D.colL }) },
      { name: tr('hw.e.rod', { len: D.rodL }), qty: 1, note: tr('hw.e.rodNote', { travel: Math.round(D.travel) }) },
      { name: tr('hw.e.nut6'), qty: 4, note: tr('hw.e.nut6Note') },
      { name: tr('hw.washer', { size: 'M6' }), qty: 1, note: tr('hw.e.w6Note') },
      { name: tr('hw.e.diffuser', { a: Math.floor(D.a - 0.6), t: num(EK.diffT) }), qty: 1, note: tr('hw.e.diffuserNote') },
      led.panel
        ? { name: tr('hw.e.panel', { a: Math.floor(D.a), p: led.P }), qty: 1, note: tr('hw.e.panelNote') }
        : { name: tr('hw.e.strip', { len: num(led.L / 1000, 2) }), qty: 1, note: tr('hw.e.stripNote', { rows: led.rows, row: led.rowL, p: num(led.P), i: num(led.I) }) },
      { name: tr('hw.e.psu', { a: led.psu }), qty: 1, note: tr('hw.e.psuNote') },
      { name: tr('hw.e.dimmer'), qty: 1, note: tr('hw.e.dimmerNote') },
      { name: tr('hw.e.lens', { f: D.f, mount: D.mount.name }), qty: 1, note: '' },
      { name: tr('hw.e.wood'), qty: D.woods.length, note: tr('hw.e.woodNote') },
      { name: tr('hw.e.board', { w: D.boardW, d: D.boardD }), qty: 1, note: tr('hw.e.boardNote') },
      { name: tr('hw.e.bellows'), qty: 1, note: tr('hw.e.bellowsNote', { area: num(bm.derived.fabricArea / 1e6, 2) }) },
    ];
    if (D.spring) extra.push({ name: tr('hw.e.spring', { f: num(D.spring.F), d: num(cp.enlSpringD), len: D.spring.ext }), qty: 1, note: tr('hw.e.springNote', { need: num(D.spring.need, 1) }) });
    if (D.wb) {
      extra.push({ name: tr('hw.e.cord', { len: Math.ceil((D.colL + 300) / 100) * 100 }), qty: 1, note: tr('hw.e.cordNote') });
      extra.push({ name: tr('hw.e.shot', { g: D.mass.total }), qty: 1, note: tr('hw.e.shotNote') });
    }
    return list.concat(extra);
  }

  // ---------------------------------------------------------------------
  // Показ: колонна, условный объектив, начало меха
  // ---------------------------------------------------------------------
  function columnCSG(D) {
    const { box } = H;
    const w = D.col[0], dd = D.col[1], y0 = D.colBot, y1 = D.colTop, zc = D.zCC;
    let s = prismXZ(rectXZ(-w / 2, zc - dd / 2, w / 2, zc + dd / 2, 1, 1), y0, y1);
    const g = [];
    for (let i = 0; i < w / 20; i++) {
      const x = -w / 2 + 10 + i * 20;
      g.push(box(x - 3, y0 - 1, zc + dd / 2 - 1.8, x + 3, y1 + 1, zc + dd / 2 + 1), box(x - 3, y0 - 1, zc - dd / 2 - 1, x + 3, y1 + 1, zc - dd / 2 + 1.8));
    }
    for (let j = 0; j < dd / 20; j++) {
      const z = zc - dd / 2 + 10 + j * 20;
      g.push(box(w / 2 - 1.8, y0 - 1, z - 3, w / 2 + 1, y1 + 1, z + 3), box(-w / 2 - 1, y0 - 1, z - 3, -w / 2 + 1.8, y1 + 1, z + 3));
    }
    return s.subtractAll(g);
  }

  function lensDummy(enl, m) {
    const D = enl.dims, s = D.st(m);
    return CSG.cylinder([0, s.yL - 35, 0], [0, s.yL, 0], D.mount.r, 48);
  }

  /** Начало меха: передняя пластина рамки меха; мех идёт вверх. m — матрица из системы меха (ось z) в мир. */
  function bellowsOrigin(enl, m) {
    const D = enl.dims, s = D.st(m);
    return { e: s.e, m: M.chain(M.T(0, s.yL + EK.Tl + H.K.tPlate, 0), M.Rx(-90)) };
  }

  /** Условные доска, бумага с изображением и лучи от углов кадра через объектив. */
  function sceneExtras(enl, m) {
    const D = enl.dims, s = D.st(m);
    const board = CSG.box([-D.boardW / 2, -18, D.boardZ0], [D.boardW / 2, 0, D.boardZ0 + D.boardD]);
    const iw = D.frame[0] * m / 2, iz = D.frame[1] * m / 2;
    const paper = CSG.box([-iw - 15, enl.params.enlEasel, -iz - 15], [iw + 15, enl.params.enlEasel + 0.6, iz + 15]);
    const image = CSG.box([-iw, enl.params.enlEasel + 0.6, -iz], [iw, enl.params.enlEasel + 0.9, iz]);
    const lines = [];
    const fxh = D.frame[0] / 2, fzh = D.frame[1] / 2, yP = enl.params.enlEasel + 1;
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      lines.push(sx * fxh, s.yN, sz * fzh, 0, s.yL, 0, 0, s.yL, 0, -sx * iw, yP, -sz * iz);
    }
    return { board, paper, image, lines };
  }

  // ---------------------------------------------------------------------
  // Инструкция
  // ---------------------------------------------------------------------
  function assemblyText(enl, bm, split) {
    const D = enl.dims, p = enl.params, F = D.F, r = (x) => Math.round(x);
    const n = (k) => H.fxName(enl, k);
    const doc = H.textDoc();
    const sMin = D.st(D.mMin), sMax = D.st(D.mMax);
    doc.head(tr('rd.e.title', { format: F.name }));
    doc.blank();
    doc.text(tr('rd.e.neg', { fx: num(D.frame[0]), fz: num(D.frame[1]), diag: num(D.diag, 1), wc: r(D.Wc), lc: r(D.Su - EK.Wb + EK.capT) }));
    doc.text(tr('rd.e.lens', { f: D.f, mount: D.mount.name, w: D.board.w, h: D.board.h }));
    doc.text(tr('rd.e.range', { min: num(D.mMin, 2), max: num(D.mMax, 2), pmin: imgCm(D, D.mMin), pmax: imgCm(D, D.mMax) }));
    doc.text(tr('rd.e.optics', { umax: r(sMin.u), umin: r(sMax.u), vmin: r(sMin.v), vmax: r(sMax.v) }));
    doc.text(tr('rd.e.ext', { emin: r(D.eNeed[0]), emax: r(D.eNeed[1]), fst: num(D.Fst, 1), bmin: D.eMinB, bmax: r(D.eMaxB) }));
    doc.text(tr('rd.e.column', { len: D.colL, travel: r(Math.max(...[sMin, sMax].map((s) => s.hcBot)) - Math.min(sMin.hcBot, sMax.hcBot)), rod: D.rodL, turns: r(D.travel) }));
    doc.text(tr('rd.e.light', { a: D.aNeed, h: D.light.H, g: num(D.g, 1), k: num(D.light.k, 3), u: r(D.light.U * 100), d: Math.floor(D.a - 0.6) }));
    doc.text(tr('rd.e.ripple', { r: num(D.light.ripple, 2), p: num(Math.round(Math.max(p.enlLedPitch, D.light.pAlong) * 10) / 10) }));
    doc.text(tr('rd.e.mass', { g: D.mass.total }));
    for (const w of enl.warnings) doc.text('! ' + w);
    doc.blank();
    doc.text(tr('rd.e.attention'));
    doc.blank();
    doc.head(`1. ${tr('rd.h.print')}`);
    doc.para(tr('rd.e.print1'));
    doc.para(tr('rd.m.print2', { c: num(p.camClearance) }));
    doc.para(tr('rd.e.print2'));
    H.splitNote(doc, split);
    doc.blank();
    doc.head(`2. ${tr('rd.h.assembly')}`);
    doc.para(tr('rd.e.base', { jack: n('eJack'), base: n('eBase') }));
    doc.para(tr('rd.e.carriages', { lock: n('eLock'), cap: n('eCap') }));
    doc.para(tr('rd.e.lensStage', { level: n('eLevel'), bfF: n('eBfF'), latch: n('eLatch') }));
    doc.para(tr('rd.e.negStage', { arm: n('eArm'), bfR: n('eBfR'), stage: n('eStage') }));
    doc.para(tr('rd.e.focus', { rod: D.rodL }));
    doc.para(tr('rd.e.lamp', { led: n('eLed'), d: Math.floor(D.a - 0.6) }));
    doc.para(F.sheet ? tr('rd.e.carrierSheet') : tr('rd.e.carrier', { n: Math.max(1, Math.floor((D.Su - EK.Wb - 2) / F.pitch)) }));
    if (D.BG) doc.para(tr(D.BG.kind === 'spring' ? 'rd.e.springAsm' : 'rd.e.weightAsm', { drum: n('eDrum'), tape: n('eTape'), pulley: n('ePulley'), lid: n('eWLid') }));
    doc.blank();
    doc.head(`3. ${tr('rd.e.h.led')}`);
    if (D.led.panel) doc.para(tr('rd.e.ledPanel', { p: D.led.P, i: num(D.led.I), psu: D.led.psu }));
    else doc.para(tr('rd.e.ledStrip', { rows: D.led.rows, row: D.led.rowL, pitch: num(p.enlLedPitch), p: num(D.led.P), i: num(D.led.I), psu: D.led.psu }));
    doc.para(tr('rd.e.ledSafety'));
    doc.blank();
    doc.head(`4. ${tr('rd.h.adjust')}`);
    doc.para(tr('rd.e.adjust1', { jack: n('eJack') }));
    doc.para(tr('rd.e.adjust2'));
    doc.para(tr('rd.e.adjust3'));
    doc.blank();
    doc.head(`5. ${tr('rd.e.h.work')}`);
    doc.para(tr('rd.e.work'));
    for (const row of tableRows(D)) doc.item(row);
    doc.blank();
    doc.head(`6. ${tr('rd.e.h.balance')}`);
    doc.para(tr('rd.e.balance.' + p.enlBalance, D.spring ? { f: num(D.spring.F), need: num(D.spring.need, 1) } : { g: D.mass.total }));
    doc.para(tr('rd.e.balanceCmp'));
    doc.blank();
    doc.head(`7. ${tr('rd.e.h.store')}`);
    doc.para(tr('rd.e.store', { h: r(D.st(D.mMin).yTop - D.st(D.mMin).lcBot), w: D.Su, len: D.colL }));
    doc.blank();
    doc.head(`8. ${tr('rd.h.parts')}`);
    for (const part of enl.parts) doc.item(`${part.qty} × ${part.name}${part.note ? ` (${part.note})` : ''}`);
    doc.blank();
    doc.head(`9. ${tr('rd.h.hw')}`);
    for (const h of enl.hardware) doc.item(`${h.qty} × ${h.name}${h.note ? ` — ${h.note}` : ''}`);
    doc.blank();
    doc.head(`10. ${tr('rd.h.bellows')}`);
    doc.para(tr('rd.e.bellowsFolder'));
    doc.blank();
    return doc.L.join('\n');
  }

  /** Размер изображения при увеличении m, см: «24×30». */
  const imgCm = (D, m) => `${num(Math.round(D.frame[0] * m) / 10, 1)}×${num(Math.round(D.frame[1] * m) / 10, 1)}`;

  /** Таблица «увеличение → изображение → высота объектива и каретки → растяжение меха → обороты винта»: шапка и 8 строк. */
  function tableRows(D) {
    const head = ['mag', 'img', 'lens', 'carriage', 'ext', 'turns'].map((k) => tr('rd.e.col.' + k));
    const rows = [], n = 8;
    for (let i = 0; i < n; i++) {
      const m = Math.round((D.mMin + ((D.mMax - D.mMin) * i) / (n - 1)) * 100) / 100, s = D.st(m);
      rows.push(['×' + num(m, 2), imgCm(D, m), Math.round(s.yL), Math.round(s.hcBot), Math.round(s.e), Math.round(Math.max(0, s.e - D.eLo))].map(String));
    }
    const w = head.map((h, k) => Math.max(h.length, ...rows.map((r) => r[k].length)));
    return [head, ...rows].map((r) => r.map((c, k) => c.padStart(w[k])).join('  '));
  }

  return {
    ENL_FORMATS, ENL_MOUNTS, COLUMNS, PRINTS, BALANCE, LEDS, ENL_DEFAULTS, EK, FX_KEYS, SPRING_N, M6,
    init, normalize, computeEnlarger, placements, fastenerLayout, assemblyText, columnCSG, lensDummy, bellowsOrigin,
    sceneExtras, lightCalc, irradiance, magFit, tableRows, weightBoxY,
  };
});
