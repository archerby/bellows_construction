'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry.js');
const E = require('../js/exporters.js');

const { util: U } = G;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), `${msg || ''} ${a} ≠ ${b}`);

test('расчёт по умолчанию проходит без ошибок', () => {
  const m = G.computeBellows({});
  assert.equal(m.ok, true, m.errors.join('; '));
  assert.ok(m.derived.N >= 20 && m.derived.N <= 60);
  assert.equal(m.derived.stiffenerCount, 4 * m.derived.N);
  // фактический шаг близок к желаемому
  assert.ok(Math.abs(m.derived.hAct - m.params.pitch) < m.params.pitch / m.derived.N + 1e-9);
});

test('прямой мех: развёртка — прямоугольник 2(Ш+В) + клапан', () => {
  const m = G.computeBellows({ frontW: 150, frontH: 120, rearW: 150, rearH: 120, flap: 8 });
  near(m.pattern.width, 2 * (150 + 120) + 8, 1e-6, 'ширина');
  near(m.pattern.height, m.derived.Lt, 1e-6, 'высота');
  // все линии сгиба одной длины для каждой панели
  for (const l of m.pattern.foldLines) {
    near(U.len(U.sub(l.b, l.a)), l.panel % 2 === 0 ? 150 : 120, 1e-6, 'длина линии');
  }
});

test('конический мех: соседние панели стыкуются по общему ребру', () => {
  const m = G.computeBellows({ frontW: 90, frontH: 70, rearW: 160, rearH: 130 });
  assert.equal(m.ok, true);
  const byPanel = (i, k) => m.pattern.foldLines.find((l) => l.panel === i && l.k === k);
  for (let i = 0; i < 3; i++) {
    for (const k of [0, 5, m.derived.N]) {
      const a = byPanel(i, k).b, b = byPanel(i + 1, k).a;
      near(U.len(U.sub(a, b)), 0, 1e-6, `угол ${i}/${k}`);
    }
  }
});

test('чётность складок: у соседних сторон противоположная', () => {
  const m = G.computeBellows({});
  for (let k = 1; k < m.derived.N; k++) {
    const t = (i) => m.pattern.foldLines.find((l) => l.panel === i && l.k === k).type;
    assert.notEqual(t(0), t(1));
    assert.equal(t(0), t(2));
    assert.equal(t(1), t(3));
    const t2 = m.pattern.foldLines.find((l) => l.panel === 0 && l.k === k + 1).type;
    assert.notEqual(t(0), t2);
  }
});

test('плашки не заходят на линии сгиба (прямой мех)', () => {
  const p = { frontW: 120, frontH: 120, rearW: 120, rearH: 120, hingeGap: 1.6 };
  const m = G.computeBellows(p);
  const lines = m.pattern.foldLines;
  for (const s of m.pattern.stiffeners) {
    const lk = lines.find((l) => l.panel === s.panel && l.k === s.k);
    const lk1 = lines.find((l) => l.panel === s.panel && l.k === s.k + 1);
    const y0 = lk.a[1], y1 = lk1.a[1];
    for (const pt of s.poly) {
      assert.ok(pt[1] >= Math.min(y0, y1) + p.hingeGap / 2 - 1e-6, `${s.id} у линии ${s.k}`);
      assert.ok(pt[1] <= Math.max(y0, y1) - p.hingeGap / 2 + 1e-6, `${s.id} у линии ${s.k + 1}`);
    }
  }
});

test('плашки не пересекают угловые диагонали', () => {
  const m = G.computeBellows({ frontW: 90, frontH: 80, rearW: 150, rearH: 140 });
  const segDist = (p, a, b) => {
    const ab = U.sub(b, a);
    const t = Math.max(0, Math.min(1, U.dot(U.sub(p, a), ab) / U.dot(ab, ab)));
    return U.len(U.sub(p, U.add(a, U.mul(ab, t))));
  };
  const diagsByK = new Map();
  for (const d of m.pattern.diagonals) {
    if (!diagsByK.has(d.k)) diagsByK.set(d.k, []);
    diagsByK.get(d.k).push(d);
  }
  for (const s of m.pattern.stiffeners) {
    for (const d of diagsByK.get(s.k)) {
      for (const pt of s.poly) {
        assert.ok(segDist(pt, d.a, d.b) >= m.params.cornerGap - 1e-6, `${s.id} слишком близко к диагонали`);
      }
    }
  }
});

test('обратное билинейное отображение', () => {
  const q = [[0, 0], [10, 1], [12, 9], [-1, 8]];
  for (const [u, v] of [[0.2, 0.3], [0.9, 0.1], [0.5, 0.5], [0, 1]]) {
    const p = [0, 1].map((i) => (1 - u) * (1 - v) * q[0][i] + u * (1 - v) * q[1][i] + u * v * q[2][i] + (1 - u) * v * q[3][i]);
    const [uu, vv] = U.invBilinear(p, ...q);
    near(uu, u, 1e-9);
    near(vv, v, 1e-9);
  }
});

test('3D: периметр сечения в складках постоянен', () => {
  const m = G.computeBellows({ frontW: 140, frontH: 110, rearW: 140, rearH: 110 });
  const mesh = G.buildMesh3D(m, 250);
  for (const r of mesh.rings) near(r.X + r.Y, (140 + 110) / 2, 1e-9);
  // при растяжении почти до «плоского» состояния глубина складки → 0
  const flat = G.buildMesh3D(m, m.params.collarF + m.params.collarR + m.derived.Lp);
  near(flat.depth, 0, 1e-6);
  assert.equal(mesh.stiffeners.length, m.pattern.stiffeners.length);
});

test('режим «по просвету» увеличивает рамки на глубину складки', () => {
  const m = G.computeBellows({ sizeMode: 'clear', frontW: 90, frontH: 90, rearW: 130, rearH: 130 });
  near(m.derived.clearFront.w, 90, 1e-6);
  near(m.derived.clearRear.h, 130, 1e-6);
});

test('ошибки ввода', () => {
  assert.equal(G.computeBellows({ maxExt: 15, collarF: 10, collarR: 10 }).ok, false);
  assert.equal(G.computeBellows({ frontW: 20, frontH: 20, pitch: 25 }).ok, false);
  assert.equal(G.computeBellows({ pitch: 0 }).ok, false);
});

test('STL: размер файла и число треугольников', () => {
  const poly = [[0, 0], [10, 0], [8, 5], [2, 5]];
  const tris = E.extrudePolys([poly], 0.2);
  assert.equal(tris.length, 2 * 2 + 2 * 4);
  const stl = E.stlBinary(tris);
  assert.equal(stl.length, 84 + 50 * tris.length);
  assert.equal(new DataView(stl.buffer).getUint32(80, true), tris.length);
});

test('STL плашек: замкнутая оболочка (каждое ребро у двух треугольников)', () => {
  const m = G.computeBellows({});
  const tris = E.extrudePolys(m.pattern.stiffeners.slice(0, 20).map((s) => s.poly), 0.2);
  const key = (p) => p.map((x) => x.toFixed(5)).join(',');
  const edges = new Map();
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const a = key(t[i]), b = key(t[(i + 1) % 3]);
      const k = a + '>' + b;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  for (const [k, n] of edges) {
    const [a, b] = k.split('>');
    assert.equal(edges.get(b + '>' + a), n, 'ребро без пары: ' + k);
  }
});

test('раскладка на стол: все плашки на столах и внутри стола', () => {
  const m = G.computeBellows({});
  const pack = E.packStiffeners(m.pattern.stiffeners, 220, 220, 2, 3);
  const n = pack.beds.reduce((s, b) => s + b.items.length, 0);
  assert.equal(n + pack.overflow.length, m.pattern.stiffeners.length);
  for (const b of pack.beds) {
    for (const it of b.items) {
      const bb = U.bbox(it.poly);
      assert.ok(bb.minx >= 3 - 1e-6 && bb.miny >= 3 - 1e-6 && bb.maxx <= 217 + 1e-6 && bb.maxy <= 217 + 1e-6, it.id);
    }
  }
});

test('ZIP: сигнатуры и CRC', () => {
  const zip = E.makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(E.crc32(new TextEncoder().encode('hello')), 0x3610a686);
});

test('экспорт SVG и DXF формируется', () => {
  const m = G.computeBellows({});
  const svg = E.patternSVG(m);
  assert.match(svg, /<svg[^>]+width="[\d.]+mm"/);
  const dxf = E.dxfPattern(m);
  assert.match(dxf, /ENTITIES/);
  assert.match(dxf, /EOF\r\n$/);
  const dr = E.drawingSVG(m);
  assert.match(dr, /Вид сбоку/);
  const tiles = E.printTilesHTML(m, { paper: 'A4' });
  assert.equal((tiles.html.match(/print-page/g) || []).length, tiles.plan.pages);
});
