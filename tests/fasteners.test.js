'use strict';
// Крепёж стыкуется с деталями: каждый болт и винт проверяется на телах деталей в сборке.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry.js');
const C = require('../js/camera.js');
const { CSG } = require('../js/csg.js');

const CASES = [
  ['монорельсовая 4×5', {}, {}],
  ['монорельсовая 5×7, профиль 4040', { frontW: 120, frontH: 120, rearW: 210, rearH: 210, maxExt: 480 }, { camFormat: '5x7', camBoard: 'sinar', camRail: '4040' }],
  ['складная 4×5', { maxExt: 260 }, { camStyle: 'field' }],
  ['складная 5×7', { frontW: 120, frontH: 120, rearW: 210, rearH: 210, maxExt: 300, pitch: 14 }, { camStyle: 'field', camFormat: '5x7', camBoard: 'sinar', camShutter: 'copal3' }],
];

const overlaps = (a, b) => [0, 1, 2].every((k) => a.max[k] > b.min[k] - 0.01 && b.max[k] > a.min[k] - 0.01);
function scene(cam, e, folded) {
  const P = C.placements(cam, e, folded, {});
  const objs = [];
  for (const p of cam.parts) {
    const body = p.csg || (p.csg = p.build());
    for (const m of P[p.key] || []) { const s = body.transform(m); objs.push({ key: p.key, csg: s, b: s.bounds() }); }
  }
  if (cam.dims.style !== 'field') { const r = C.railCSG(cam.dims); objs.push({ key: 'рельс', csg: r, b: r.bounds() }); }
  return objs;
}
const hitVolume = (objs, solid, skip) => {
  const b = solid.bounds();
  let v = 0;
  for (const o of objs) if (!(skip && skip(o)) && overlaps(o.b, b)) v += o.csg.intersect(solid).volume();
  return v;
};

for (const [title, bp, cp] of CASES) {
  test(`крепёж стыкуется с деталями: ${title}`, () => {
    const cam = C.computeCamera(G.computeBellows(bp), cp);
    assert.equal(cam.ok, true);
    const D = cam.dims;
    // проверяем в нескольких положениях: подвижные детали не должны задевать концы болтов
    const states = D.style === 'field' ? [[D.eMin, false], [(D.eMin + D.eMax) / 2, false], [D.eMax, false], [0, true]] : [[D.eMin, false], [D.eMax, false]];
    for (const [e, folded] of states) {
      const objs = scene(cam, e, folded);
      const fx = C.fastenerLayout(cam, e, folded, {});
      for (const x of fx) {
        const id = `${folded ? 'сложена' : 'e=' + Math.round(e)} ${C.fxLabel(x.key)} ${x.size}×${x.len}`;
        assert.ok(x.len, id + ': нет стандартной длины');
        const minor = x.size === 'M5' ? 4.1 : 2.4;
        const S = C.fastenerSolids(x, { r: minor / 2, to: x.free });
        assert.ok(hitVolume(objs, S.shank) < 0.05, `${id}: стержень упирается в деталь (${hitVolume(objs, S.shank).toFixed(2)} мм³)`);
        assert.ok(hitVolume(objs, S.head) < 0.05, `${id}: головка не помещается`);
        if (S.washer) assert.ok(hitVolume(objs, S.washer) < 0.05, `${id}: шайба не помещается`);
        if (S.nut) {
          assert.ok(hitVolume(objs, S.nut) < 0.05, `${id}: гайка не помещается в гнездо`);
          // гайку тянет к головке — со стороны головки у неё должен быть упор из пластика (барашки не в счёт)
          const pt = (s) => x.p.map((q, k) => q + x.d[k] * s);
          const ring = CSG.cylinder(pt(x.nut - 0.4), pt(x.nut - 0.1), 3.9, 24).subtract(CSG.cylinder(pt(x.nut - 1), pt(x.nut + 1), 3.2, 24));
          assert.ok(hitVolume(objs, ring, (o) => o.key.startsWith('knob')) > 0.5, `${id}: гайке не во что упереться — вытянется из гнезда`);
          assert.ok(x.len >= x.nut + 3.2 || x.free < x.len, `${id}: болт не проходит гайку`);
        }
        if (x.thread) {
          // саморез M3 режет резьбу в отверстии 2,8: на глубине зацепления вокруг стержня Ø3 есть пластик
          const s1 = Math.min(x.len, x.thread[1]);
          assert.ok(s1 - x.thread[0] >= 4.5, `${id}: зацепление ${(s1 - x.thread[0]).toFixed(1)} мм`);
          const pt = (s) => x.p.map((q, k) => q + x.d[k] * s);
          const ring = CSG.cylinder(pt(x.thread[0] + 0.2), pt(s1 - 0.2), 1.5, 24).subtract(CSG.cylinder(pt(x.thread[0]), pt(s1), 1.43, 24));
          const exp = Math.PI * (1.5 ** 2 - 1.43 ** 2) * (s1 - x.thread[0] - 0.4);
          assert.ok(hitVolume(objs, ring) > 0.6 * exp, `${id}: резьбе не во что врезаться`);
        }
      }
    }
  });
}

test('спецификация = модели крепежа, пружины задника не сжимаются до упора', () => {
  for (const [, bp, cp] of CASES) {
    const cam = C.computeCamera(G.computeBellows(bp), cp);
    const n = (re) => cam.hardware.filter((h) => re.test(h.name)).reduce((s, h) => s + h.qty, 0);
    assert.equal(n(/^(Болт|Винт) M/), cam.fasteners.length);
    assert.equal(n(/^Гайка M5/), cam.fasteners.filter((x) => x.nut !== null).length);
    assert.ok(cam.spring.closed >= 7 && cam.spring.free > cam.spring.open + 2, 'пружина: ' + JSON.stringify(cam.spring));
  }
});

test('штатив: гайка у нижней грани — винт штатива (5 мм) достаёт до резьбы', () => {
  const cam = C.computeCamera(G.computeBellows({}), {});
  const part = cam.parts.find((p) => p.key === 'tripod_block');
  const s = part.build(); // низ площадки — y = −12
  const probe = (y0, y1) => s.intersect(CSG.box([-3.6, y0, -3.6], [3.6, y1, 3.6])).volume();
  // над полом 2,5 мм сразу гнездо гайки: на высоте −9,4…−4 материала нет (Ø под ключ 11,1 > 7,2)
  assert.ok(probe(-9.4, -4) < 1e-6);
  assert.ok(probe(-12, -9.6) > 10, 'пол под гайкой есть');
});

test('заглушки рельса — упор для кареток', () => {
  const cam = C.computeCamera(G.computeBellows({}), {});
  const P = C.placements(cam, 200);
  const cap = cam.parts.find((p) => p.key === 'end_cap').build().transform(P.end_cap[1]);
  const car = cam.parts.find((p) => p.key === 'carriage').build();
  // каретка, доехавшая до конца рельса, упирается в заглушку
  const zEnd = cam.dims.railZ0 + cam.dims.railL;
  assert.ok(car.transform(require('../js/csg.js').M.T(0, 0, zEnd - C.K.Lc / 2 + 2)).intersect(cap).volume() > 10);
});
