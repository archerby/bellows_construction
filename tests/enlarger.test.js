'use strict';
// Фотоувеличитель: оптика, детали, расстановка, столкновения, крепёж, зонды светового замка и плоскостей.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry.js');
const C = require('../js/camera.js');
const E = require('../js/enlarger.js');
const { CSG } = require('../js/csg.js');

const edgesUnpaired = (tris) => {
  const k = (p) => p.map((x) => x.toFixed(6)).join(',');
  const m = new Map();
  for (const t of tris) for (let i = 0; i < 3; i++) {
    const e = k(t[i]) + '>' + k(t[(i + 1) % 3]);
    m.set(e, (m.get(e) || 0) + 1);
  }
  let bad = 0;
  for (const [e, n] of m) { const [a, b] = e.split('>'); if (m.get(b + '>' + a) !== n) bad++; }
  return bad;
};

// [название, мех, параметры] — разные форматы, крепления, колонны и способы компенсации веса
const CASES = [
  ['4×5, f 150, M39, фрикцион', {}, { camStyle: 'enlarger' }],
  ['6×6, f 80, Copal 1, пружина, колонна 4040', {}, { camStyle: 'enlarger', enlFormat: '66', enlMount: 'copal1', enlRange: 'mag', enlMagMin: 2, enlMagMax: 8, enlBalance: 'spring', enlColumn: '4040' }],
  ['35 мм, f 75, противовес, колонна 2020', { frontW: 80, frontH: 80, rearW: 100, rearH: 100, maxExt: 260, pitch: 9 }, { camStyle: 'enlarger', enlFormat: '35', enlFocal: 75, enlRange: 'mag', enlMagMin: 1, enlMagMax: 3, enlBalance: 'weight', enlColumn: '2020', camBoard: 'technika' }],
];
const make = (bp, cp) => { const bm = G.computeBellows(bp); return { bm, enl: C.computeCamera(bm, cp) }; };

test('увеличитель: оптика тонкой линзы — u = f(1 + 1/m), v = f(1 + m), растяжение = u − фланцы', () => {
  for (const [f, m] of [[50, 2], [80, 4.5], [105, 1], [150, 0.8], [150, 3.13]]) {
    const { enl } = make({ maxExt: 500 }, { camStyle: 'enlarger', enlFocal: f, enlRange: 'mag', enlMagMin: Math.min(m, 1), enlMagMax: Math.max(m, 1.5) });
    const s = enl.dims.st(m);
    assert.ok(Math.abs(s.u - f * (1 + 1 / m)) < 1e-9, `u при f=${f}, m=${m}`);
    assert.ok(Math.abs(s.v - f * (1 + m)) < 1e-9, `v при f=${f}, m=${m}`);
    assert.ok(Math.abs(1 / s.u + 1 / s.v - 1 / f) < 1e-12, 'формула линзы');
    if (s.u - enl.dims.Fst >= enl.dims.eLo && s.u - enl.dims.Fst <= enl.dims.eHi) {
      assert.ok(Math.abs(s.e - (s.u - enl.dims.Fst)) < 1e-9, 'растяжение меха = u − фланцевый пакет');
      // в сборке: плёнка над фланцем объектива ровно на u, объектив над бумагой — на v
      assert.ok(Math.abs(s.yN - s.yL - s.u) < 1e-9, 'плоскость плёнки над фланцем на u');
      assert.ok(Math.abs(s.yL - enl.params.enlEasel - s.v) < 1e-9, 'фланец над бумагой на v');
    }
  }
});

test('увеличитель: растяжение, ход винта и колонна покрывают диапазон, иначе — предупреждения', () => {
  for (const [title, bp, cp] of CASES) {
    const { enl } = make(bp, cp);
    assert.equal(enl.ok, true, title + ': ' + enl.errors.join('; '));
    assert.deepEqual(enl.warnings, [], title + ': лишние предупреждения');
    const D = enl.dims;
    assert.ok(D.eLo <= D.eNeed[0] && D.eHi >= D.eNeed[1], title + ': ход меха покрывает нужное растяжение');
    assert.ok(D.eLo >= D.eMinB && D.eHi <= D.eMaxB, title + ': в пределах меха');
    // шпилька: при наибольшем расстоянии плит проходит гайку верхней полки
    assert.ok(D.rodL >= D.rodSpan(D.eHi) + 1, title + ': длина шпильки');
    for (let i = 0; i <= 20; i++) {
      const m = D.mMin * (D.mMax / D.mMin) ** (i / 20), s = D.st(m);
      assert.ok(s.hcTop <= D.colTop + D.stopLocal - 3 + 1e-9, `${title}: ×${m.toFixed(2)} каретка головки ниже заглушки`);
      assert.ok(s.lcBot >= D.sockTop + 3 - 1e-9, `${title}: ×${m.toFixed(2)} каретка объектива выше кронштейна`);
    }
  }
  const tr = (cp, bp) => make(bp || {}, Object.assign({ camStyle: 'enlarger' }, cp)).enl.warnings.join(' | ');
  assert.match(tr({ enlFormat: '35', enlRange: 'mag', enlMagMin: 2, enlMagMax: 12 }), /не сжимается/, 'f 50 с мехом от камеры 4×5');
  assert.match(tr({}, { maxExt: 200 }), /даёт 200/, 'короткий мех');
  assert.match(tr({ enlColumnLength: 400 }), /Колонна 400/, 'короткая колонна');
  const bad = make({}, { camStyle: 'enlarger', enlFocal: 5 }).enl;
  assert.equal(bad.ok, false);
});

test('увеличитель: равномерность света, рассеиватель по диагонали кадра, вылет косого луча', () => {
  const { enl } = make({}, { camStyle: 'enlarger' });
  const D = enl.dims, L = D.light;
  assert.ok(L.U >= 0.9, 'спад к углам поля ≤ 10 %: ' + L.U);
  assert.ok(L.H >= 1.5 * Math.max(enl.params.enlLedPitch, 1000 / 60) - 1e-9, 'высота смешения ≥ 1,5 шага светодиодов');
  assert.ok(L.ripple < 1, 'пульсация от отдельных светодиодов < 1 %: ' + L.ripple);
  const k = 1 + D.g / D.st(D.mMax).u;
  assert.ok(D.aNeed >= D.diag * k, 'освещённое окно не меньше диагонали кадра с поправкой на ход лучей');
  // без белых стенок (rho = 0) равномерность хуже — стенки работают
  const a = D.a, p = [L.need[0] / 2, L.need[1] / 2];
  assert.ok(E.irradiance(...p, a, L.H, 0) / E.irradiance(0, 0, a, L.H, 0) < L.U);
});

test('увеличитель: все детали замкнуты, лежат на столе, помещаются на 220×220 или режутся с замками', () => {
  for (const [title, bp, cp] of CASES) {
    const { enl } = make(bp, cp);
    for (const p of enl.parts) {
      const s = C.printOriented(p, p.build());
      assert.ok(s.volume() > 0, `${title}: ${p.key} объём`);
      assert.equal(edgesUnpaired(s.toTriangles()), 0, `${title}: ${p.key} незамкнутые рёбра`);
      assert.ok(Math.abs(s.bounds().min[2]) < 1e-9, `${title}: ${p.key} не на столе`);
      if (C.fitsBed(s, 220, 220)) continue;
      assert.ok(!['carrier_bottom', 'carrier_top', 'lens_board'].includes(p.key), `${title}: ${p.key} нельзя резать`);
      const pcs = C.splitForBed(s, 220, 220, 0.3), bb = pcs.map((x) => x.bounds());
      assert.ok(pcs.length > 1 && pcs.every((x) => C.fitsBed(x, 220, 220)), `${title}: ${p.key} не режется под стол`);
      for (let i = 0; i < pcs.length; i++) {
        assert.equal(edgesUnpaired(C.layPiece(pcs[i], 220, 220).toTriangles()), 0, `${title}: ${p.key} часть ${i + 1} замкнута`);
        for (let j = i + 1; j < pcs.length; j++) {
          const ov = [0, 1].map((q) => Math.min(bb[i].max[q], bb[j].max[q]) - Math.max(bb[i].min[q], bb[j].min[q]));
          if (!(ov[0] > 30 || ov[1] > 30)) continue;
          const lock = pcs[i].intersect(CSG.box(bb[j].min, bb[j].max)).volume() + pcs[j].intersect(CSG.box(bb[i].min, bb[i].max)).volume();
          assert.ok(lock > 100, `${title}: ${p.key} части ${i + 1} и ${j + 1} без замка`);
        }
      }
    }
  }
});

function scene(enl, m) {
  const P = C.placements(enl, m, false, {});
  const objs = [];
  for (const p of enl.parts) {
    const body = p.csg || (p.csg = p.build());
    (P[p.key] || []).forEach((mm, i) => { const s = body.transform(mm); objs.push({ key: p.key, name: `${p.key}#${i}`, csg: s, b: s.bounds() }); });
  }
  const col = E.columnCSG(enl.dims), lens = C.lensDummy(enl, m);
  objs.push({ key: 'колонна', name: 'колонна', csg: col, b: col.bounds() }, { key: 'объектив', name: 'объектив', csg: lens, b: lens.bounds() });
  return objs;
}
const overlaps = (a, b) => [0, 1, 2].every((k) => a.max[k] > b.min[k] - 0.01 && b.max[k] > a.min[k] - 0.01);

test('увеличитель: расстановка = количеству; ничего не сталкивается на мин. и макс. увеличении', () => {
  for (const [title, bp, cp] of CASES) {
    const { enl } = make(bp, cp);
    const D = enl.dims;
    for (const m of [D.mMin, D.mMax]) {
      const P = C.placements(enl, m, false, {});
      for (const p of enl.parts) assert.equal((P[p.key] || []).length, p.qty, `${title}: ${p.key} экземпляров`);
      const objs = scene(enl, m);
      for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
        if (!overlaps(objs[i].b, objs[j].b)) continue;
        const v = objs[i].csg.intersect(objs[j].csg).volume();
        assert.ok(v < 0.5, `${title} ×${m}: ${objs[i].name} × ${objs[j].name} = ${v.toFixed(1)} мм³`);
      }
    }
  }
});

test('увеличитель: крепёж стыкуется с деталями (стержень свободен, гайки в гнёздах с упором, у саморезов есть пластик)', () => {
  for (const [title, bp, cp] of CASES) {
    const { enl } = make(bp, cp);
    const D = enl.dims;
    for (const m of [D.mMin, D.mMax]) {
      const objs = scene(enl, m).filter((o) => o.key !== 'объектив');
      const hit = (solid, skip) => { const b = solid.bounds(); let v = 0; for (const o of objs) if (!(skip && skip(o)) && overlaps(o.b, b)) v += o.csg.intersect(solid).volume(); return v; };
      for (const x of C.fastenerLayout(enl, m, false, {})) {
        const id = `${title} ×${m} ${C.fxLabel(x.key)} ${x.size}×${x.len}`;
        assert.ok(x.len, id + ': нет стандартной длины');
        const minor = { M5: 4.1, M3: 2.4, M6: 4.9 }[x.size];
        const S = C.fastenerSolids(x, { r: minor / 2, to: x.free });
        assert.ok(hit(S.shank) < 0.05, `${id}: стержень упирается (${hit(S.shank).toFixed(2)} мм³)`);
        if (S.head) assert.ok(hit(S.head) < 0.05, `${id}: головка не помещается (${hit(S.head).toFixed(2)})`);
        if (S.washer) assert.ok(hit(S.washer) < 0.05, `${id}: шайба не помещается`);
        const pt = (s) => x.p.map((q, k) => q + x.d[k] * s);
        if (S.nut) {
          assert.ok(hit(S.nut) < 0.05, `${id}: гайка не помещается (${hit(S.nut).toFixed(2)})`);
          const nr = x.size === 'M6' ? [4.9, 4] : [3.9, 3.2];
          const ring = CSG.cylinder(pt(x.nut - 0.4), pt(x.nut - 0.1), nr[0], 24).subtract(CSG.cylinder(pt(x.nut - 1), pt(x.nut + 1), nr[1], 24));
          assert.ok(hit(ring, (o) => o.key.startsWith('knob')) > 0.5, `${id}: гайке не во что упереться`);
          assert.ok(x.len >= x.nut + 3.2 || x.free < x.len, `${id}: не проходит гайку`);
        }
        if (x.thread) {
          const s1 = Math.min(x.len, x.thread[1]);
          assert.ok(s1 - x.thread[0] >= 4.5, `${id}: зацепление ${(s1 - x.thread[0]).toFixed(1)} мм`);
          const ring = CSG.cylinder(pt(x.thread[0] + 0.2), pt(s1 - 0.2), 1.5, 24).subtract(CSG.cylinder(pt(x.thread[0]), pt(s1), 1.43, 24));
          const exp = Math.PI * (1.5 ** 2 - 1.43 ** 2) * (s1 - x.thread[0] - 0.4);
          assert.ok(hit(ring) > 0.6 * exp, `${id}: резьбе не во что врезаться`);
        }
      }
    }
  }
});

test('увеличитель: спецификация = модели крепежа; шпилька, гайки M6 и пружина/дробь в покупном', () => {
  for (const [title, bp, cp] of CASES) {
    const { enl } = make(bp, cp);
    const n = (re) => enl.hardware.filter((h) => re.test(h.name)).reduce((s, h) => s + h.qty, 0);
    assert.equal(n(/^(Болт|Винт) M/), enl.fasteners.filter((x) => x.kind !== 'rod').length, title);
    assert.equal(n(/^Гайка M5/), enl.fasteners.filter((x) => x.size === 'M5' && x.nut !== null).length, title);
    assert.equal(n(/^Шпилька M6/), 1, title);
    if (cp.enlBalance === 'spring') assert.equal(n(/^Пружина постоянного усилия/), 1);
    if (cp.enlBalance === 'weight') assert.equal(n(/^Дробь/), 1);
  }
});

test('зонд: окно рамки негатива ровно по кадру', () => {
  for (const [title, bp, cp] of CASES) {
    const { enl } = make(bp, cp);
    const D = enl.dims, EK = E.EK, [fx, fz] = D.frame;
    const leaf = enl.parts.find((p) => p.key === 'carrier_bottom').build();
    const y0 = 0.05, y1 = EK.tLb - EK.rec - 0.05; // маска — под углублением для плёнки
    const probe = (x0, z0, x1, z1) => leaf.intersect(CSG.box([x0, y0, z0], [x1, y1, z1])).volume();
    const full = (x0, z0, x1, z1) => (x1 - x0) * (z1 - z0) * (y1 - y0);
    assert.ok(probe(-fx / 2 + 0.02, -fz / 2 + 0.02, fx / 2 - 0.02, fz / 2 - 0.02) < 1e-6, title + ': в окне нет материала');
    const t = 0.5;
    for (const [x0, z0, x1, z1] of [[fx / 2 + 0.02, -fz / 2, fx / 2 + t, fz / 2], [-fx / 2 - t, -fz / 2, -fx / 2 - 0.02, fz / 2], [-fx / 2, fz / 2 + 0.02, fx / 2, fz / 2 + t], [-fx / 2, -fz / 2 - t, fx / 2, -fz / 2 - 0.02]]) {
      assert.ok(Math.abs(probe(x0, z0, x1, z1) - full(x0, z0, x1, z1)) < 1e-6, `${title}: за краем кадра — сплошная маска`);
    }
  }
});

/** Пересечение луча с треугольником (Мёллер–Трумбор): расстояние или −1. */
function rayTri(o, d, t) {
  const e1 = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], e2 = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return -1;
  const s = [o[0] - t[0][0], o[1] - t[0][1], o[2] - t[0][2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
  if (u < 0 || u > 1) return -1;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
  if (v < 0 || u + v > 1) return -1;
  return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
}

test('зонд: световая ловушка вентиляции не сквозная по прямой', () => {
  for (const [title, bp, cp] of CASES) {
    const { enl } = make(bp, cp);
    const D = enl.dims, EK = E.EK, m = D.mMin, P = C.placements(enl, m, false, {});
    const s = D.st(m), yPlate = s.yRT + D.Hb, yTop = yPlate + EK.ledT + EK.ventGap + EK.capTop;
    const bodies = ['lamp_body', 'led_plate', 'vent_cap'].map((k) => enl.parts.find((p) => p.key === k).build().transform(P[k][0]));
    const all = bodies[0].union(bodies[1]).union(bodies[2]);
    // зонды intersect(box): тонкий брусок вдоль луча из камеры наружу должен задеть материал.
    // Сборку обрезаем вокруг отверстия (дешевле), брусок поворачиваем вдоль луча.
    const along = (o, d, len) => {
      const w = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = [d[1] * w[2] - d[2] * w[1], d[2] * w[0] - d[0] * w[2], d[0] * w[1] - d[1] * w[0]], ul = Math.hypot(...u);
      const ux = u.map((q) => q / ul), vy = [d[1] * ux[2] - d[2] * ux[1], d[2] * ux[0] - d[0] * ux[2], d[0] * ux[1] - d[1] * ux[0]];
      return CSG.box([-0.1, -0.1, 0], [0.1, 0.1, len]).transform([ux[0], vy[0], d[0], o[0], ux[1], vy[1], d[1], o[1], ux[2], vy[2], d[2], o[2]]);
    };
    const reachY = yTop + 1 - (yPlate - 0.05);
    const probeHole = (x, z, dirs) => {
      const local = all.intersect(CSG.box([x - reachY - 2, yPlate - 1, z - reachY - 2], [x + reachY + 2, yTop + 2, z + reachY + 2]));
      return dirs.map(([dx, dz]) => {
        const d = [dx, 1, dz], l = Math.hypot(...d);
        return local.intersect(along([x, yPlate - 0.05, z], d.map((q) => q / l), reachY * l)).volume();
      });
    };
    const holes = [[-(D.a / 2 - 6), 0]]; // провод
    const a2 = D.a / 2 - 5;
    for (const sz of [-1, 1]) for (const fx of [-0.45, -0.2, 0, 0.2, 0.45]) holes.push([fx * D.a, sz * a2]); // щели плиты
    const DIRS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    for (const [x, z] of holes) probeHole(x, z, DIRS).forEach((v, i) => {
      assert.ok(v > 1e-3, `${title}: луч из (${x.toFixed(0)}, ${z.toFixed(0)}) в сторону (${DIRS[i]}) проходит насквозь`);
    });
    // плотная проверка лучами: старт в каждой щели плиты и в отверстии провода, все направления вверх.
    // Треугольники разложены по клеткам 8×8 мм в плане — луч проверяет только клетки вдоль своего пути.
    const tris = all.toTrianglesRaw(), CELL = 8, grid = new Map();
    for (const t of tris) {
      const x0 = Math.floor(Math.min(t[0][0], t[1][0], t[2][0]) / CELL), x1 = Math.floor(Math.max(t[0][0], t[1][0], t[2][0]) / CELL);
      const z0 = Math.floor(Math.min(t[0][2], t[1][2], t[2][2]) / CELL), z1 = Math.floor(Math.max(t[0][2], t[1][2], t[2][2]) / CELL);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
    }
    const starts = [];
    for (let x = -D.a / 2; x <= D.a / 2; x += 2) for (const z of [-a2 - 1.2, -a2, -a2 + 1.2, a2 - 1.2, a2, a2 + 1.2]) starts.push([x, z]);
    for (let r = 0; r < 2.4; r += 0.8) for (let k = 0; k < 8; k++) starts.push([holes[0][0] + r * Math.cos(k * 0.785), r * Math.sin(k * 0.785)]);
    let leaks = 0;
    const reach = yTop + 1 - yPlate;
    for (const [x, z] of starts) {
      const o = [x, yPlate - 0.02, z];
      for (const el of [8, 20, 35, 50, 70, 90]) for (let az = 0; az < 360; az += 30) {
        const e = (el * Math.PI) / 180, a = (az * Math.PI) / 180, d = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
        const run = reach / Math.tan(Math.max(e, 1e-6)), cand = new Set();
        for (let t = 0; t <= Math.min(run, 400) + CELL; t += CELL / 2) {
          const i = Math.floor((x + Math.cos(a) * t) / CELL), j = Math.floor((z + Math.sin(a) * t) / CELL);
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const tri of grid.get(i + di + ',' + (j + dj)) || []) cand.add(tri);
        }
        let blocked = false;
        for (const t of cand) { const h = rayTri(o, d, t); if (h > 1e-6) { blocked = true; break; } }
        if (!blocked) leaks++;
      }
    }
    assert.equal(leaks, 0, title + ': прямых лучей наружу');
  }
});

test('зонд: плоскости негатива и объективной платы параллельны (и параллельны доске)', () => {
  for (const [title, bp, cp] of CASES) {
    const { enl } = make(bp, cp);
    const D = enl.dims, EK = E.EK, [fx, fz] = D.frame;
    for (const m of [D.mMin, (D.mMin + D.mMax) / 2, D.mMax]) {
      const P = C.placements(enl, m, false, {}), s = D.st(m);
      const body = (k) => enl.parts.find((p) => p.key === k).build().transform(P[k][0]);
      const leaf = body('carrier_bottom'), board = body('lens_board');
      // высота поверхности по зондам: материал в полоске под плоскостью есть, над ней — нет
      const surface = (solid, x, z, y, up) => {
        const below = solid.intersect(CSG.box([x - 0.3, y - 0.1, z - 0.3], [x + 0.3, y - 0.02, z + 0.3])).volume();
        const above = solid.intersect(CSG.box([x - 0.3, y + 0.02, z - 0.3], [x + 0.3, y + 0.1, z + 0.3])).volume();
        return up ? below > 0.02 && above < 1e-9 : above > 0.02 && below < 1e-9;
      };
      // плёнка лежит на дне углубления нижней створки: три точки у краёв кадра
      for (const [x, z] of [[fx / 2 + 1.2, 0], [-(fx / 2 + 1.2), 0], [0, fz / 2 + 1.2]]) {
        assert.ok(surface(leaf, x, z, s.yN, true), `${title} ×${m.toFixed(2)}: опора плёнки в (${x}, ${z}) не на высоте ${s.yN.toFixed(2)}`);
      }
      // фланец объектива — нижняя грань платы: три точки вокруг отверстия
      const r = D.mount.hole / 2 + 4;
      for (const [x, z] of [[r, 0], [-r, 0], [0, r]]) {
        assert.ok(surface(board, x, z, s.yL, false), `${title} ×${m.toFixed(2)}: фланец платы в (${x}, ${z}) не на высоте ${s.yL.toFixed(2)}`);
      }
      assert.ok(Math.abs(s.yN - s.yL - (s.e + D.Fst)) < 1e-9);
      void EK;
    }
  }
});

test('увеличитель: README — все детали, покупное, таблица увеличений, юстировка и хранение', () => {
  for (const [title, bp, cp] of CASES) {
    const { bm, enl } = make(bp, cp);
    const txt = C.assemblyText(enl, bm, [{ name: enl.parts[0].name, n: 2 }]);
    for (const p of enl.parts) assert.ok(txt.includes(p.name), `${title}: ${p.name}`);
    for (const h of enl.hardware) assert.ok(txt.includes(h.name), `${title}: ${h.name}`);
    assert.match(txt, /ЮСТИРОВКА/);
    assert.match(txt, /ХРАНЕНИЕ/);
    assert.equal(E.tableRows(enl.dims).length, 9); // шапка и 8 строк
    assert.ok(!/undefined|NaN|\{\w+\}/.test(txt), title + ': пустые подстановки');
  }
});
