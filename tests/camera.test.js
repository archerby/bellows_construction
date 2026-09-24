'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry.js');
const C = require('../js/camera.js');
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

test('CSG: объёмы булевых операций', () => {
  const b = CSG.box([0, 0, 0], [10, 10, 10]);
  assert.ok(Math.abs(b.volume() - 1000) < 1e-9);
  assert.ok(Math.abs(b.union(CSG.box([5, 5, 5], [15, 15, 15])).volume() - 1875) < 1e-6);
  assert.ok(Math.abs(b.subtract(CSG.box([5, 5, 5], [15, 15, 15])).volume() - 875) < 1e-6);
  assert.ok(Math.abs(b.intersect(CSG.box([5, 5, 5], [15, 15, 15])).volume() - 125) < 1e-6);
  const holes = b.subtractAll([CSG.cylinder([3, 3, -1], [3, 3, 11], 1, 16), CSG.cylinder([7, 7, -1], [7, 7, 11], 1, 16)]);
  assert.equal(edgesUnpaired(holes.toTriangles()), 0);
});

test('камера 4×5 по умолчанию: все детали — замкнутые тела на столе', () => {
  const cam = C.computeCamera(G.computeBellows({}), {});
  assert.equal(cam.ok, true, cam.errors.join('; '));
  for (const p of cam.parts) {
    const s = C.printOriented(p, p.build());
    assert.ok(s.volume() > 0, p.key + ': объём');
    assert.equal(edgesUnpaired(s.toTriangles()), 0, p.key + ': незамкнутые рёбра');
    assert.ok(Math.abs(s.bounds().min[2]) < 1e-9, p.key + ': не лежит на столе');
  }
});

test('расстановка: у каждой детали столько экземпляров, сколько штук', () => {
  const cam = C.computeCamera(G.computeBellows({}), {});
  const P = C.placements(cam, 200);
  for (const p of cam.parts) assert.equal((P[p.key] || []).length, p.qty, p.key);
});

test('плоскость матового стекла на глубине плоскости плёнки', () => {
  const depth = 4.85;
  const cam = C.computeCamera(G.computeBellows({}), { camFilmDepth: depth });
  const D = cam.dims;
  const gg = cam.parts.find((p) => p.key === 'gg_frame').build();
  // полоса над уступом (между окном и краем стекла), посередине длинной стороны
  const x0 = (D.film[0] + 2) / 2 + 0.3, x1 = D.glass[0] / 2 - 0.3;
  const probe = (z0, z1) => gg.intersect(CSG.box([x0, -5, z0], [x1, 5, z1])).volume();
  const full = (z0, z1) => (x1 - x0) * 10 * (z1 - z0);
  assert.ok(Math.abs(probe(0, depth) - full(0, depth)) < 1e-6, 'уступ сплошной до глубины плёнки');
  assert.ok(probe(depth, D.Tg) < 1e-6, 'над уступом — гнездо стекла');
});

test('размеры согласованы с мехом и форматом', () => {
  for (const [b, c] of [[{}, {}], [{ frontW: 120, frontH: 120, rearW: 210, rearH: 210, maxExt: 480 }, { camFormat: '5x7', camBoard: 'sinar' }]]) {
    const bm = G.computeBellows(b);
    const cam = C.computeCamera(bm, c);
    const D = cam.dims;
    assert.ok(D.Sf >= D.bfF.plateW && D.Sf >= D.board.w + 2 * D.c, 'передняя рамка вмещает плату и рамку меха');
    assert.ok(D.Sr >= D.bfR.plateW && D.Sr / 2 > D.guideOut, 'задняя рамка вмещает рамку меха и задник');
    assert.ok(D.bfF.lipW > 0 && D.bfF.lipW < bm.derived.mid.fW, 'бортик меньше манжеты');
    assert.ok(D.railL >= D.railNeed, 'рельса хватает на полное растяжение');
    assert.ok(D.A - D.Sr / 2 >= D.baseTop + C.K.knobSH, 'задняя рамка не задевает барашек');
    assert.ok(D.A - cam.params.camRise - D.Sf / 2 >= D.baseTop + C.K.knobSH, 'опущенная передняя рамка не задевает барашек');
  }
});

test('короткий рельс и слишком маленький мех дают предупреждения', () => {
  const cam = C.computeCamera(G.computeBellows({}), { camRailLength: 200 });
  assert.ok(cam.warnings.some((w) => w.includes('Рельс')));
  const small = C.computeCamera(G.computeBellows({ rearW: 100, rearH: 100 }), {});
  assert.ok(small.warnings.some((w) => w.includes('срежет')));
  assert.equal(C.computeCamera(G.computeBellows({ pitch: 0 }), {}).ok, false);
});

test('README сборки перечисляет все детали и покупное', () => {
  const bm = G.computeBellows({});
  const cam = C.computeCamera(bm, {});
  const txt = C.assemblyText(cam, bm);
  for (const p of cam.parts) assert.ok(txt.includes(p.name), p.name);
  for (const h of cam.hardware) assert.ok(txt.includes(h.name), h.name);
});
