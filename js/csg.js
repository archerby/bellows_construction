/*
 * Минимальное твердотельное моделирование (CSG) на BSP-деревьях:
 * объединение, вычитание и пересечение многогранников.
 * Алгоритм — классический (как в csg.js Эвана Уоллеса), реализация своя,
 * без рекурсии при построении дерева.
 *
 * Точки — массивы [x, y, z]; многоугольники выпуклые, обход против часовой
 * стрелки, если смотреть снаружи тела.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BellowsCSG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-5;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  class Plane {
    constructor(normal, w) { this.normal = normal; this.w = w; }
    clone() { return new Plane(this.normal.slice(), this.w); }
    flip() { this.normal = scale(this.normal, -1); this.w = -this.w; }
    static fromPoints(a, b, c) {
      const n = unit(cross(sub(b, a), sub(c, a)));
      return new Plane(n, dot(n, a));
    }
    splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
      const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
      let type = 0;
      const types = [];
      for (const v of polygon.vertices) {
        const t = dot(this.normal, v) - this.w;
        const ty = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
        type |= ty;
        types.push(ty);
      }
      if (type === COPLANAR) {
        (dot(this.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
      } else if (type === FRONT) {
        front.push(polygon);
      } else if (type === BACK) {
        back.push(polygon);
      } else {
        const f = [], b = [];
        const vs = polygon.vertices, n = vs.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ti = types[i], tj = types[j], vi = vs[i], vj = vs[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(vi);
          if ((ti | tj) === SPANNING) {
            const t = (this.w - dot(this.normal, vi)) / dot(this.normal, sub(vj, vi));
            const v = lerp(vi, vj, t);
            f.push(v);
            b.push(v);
          }
        }
        if (f.length >= 3) front.push(new Polygon(f, polygon.shared, polygon.plane.clone()));
        if (b.length >= 3) back.push(new Polygon(b, polygon.shared, polygon.plane.clone()));
      }
    }
  }

  class Polygon {
    constructor(vertices, shared, plane) {
      this.vertices = vertices;
      this.shared = shared;
      this.plane = plane || Polygon.planeOf(vertices);
    }
    static planeOf(vs) {
      // нормаль по Ньюэллу — устойчива к почти коллинеарным первым вершинам
      let n = [0, 0, 0];
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i], b = vs[(i + 1) % vs.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      n = unit(n);
      return new Plane(n, dot(n, vs[0]));
    }
    clone() { return new Polygon(this.vertices.slice(), this.shared, this.plane.clone()); }
    flip() { this.vertices = this.vertices.slice().reverse(); this.plane.flip(); }
  }

  class Node {
    constructor(polygons) {
      this.plane = null; this.front = null; this.back = null; this.polygons = [];
      if (polygons) this.build(polygons);
    }
    nodes() {
      const out = [], stack = [this];
      while (stack.length) {
        const n = stack.pop();
        out.push(n);
        if (n.front) stack.push(n.front);
        if (n.back) stack.push(n.back);
      }
      return out;
    }
    invert() {
      for (const n of this.nodes()) {
        for (const p of n.polygons) p.flip();
        if (n.plane) n.plane.flip();
        const t = n.front; n.front = n.back; n.back = t;
      }
    }
    clipPolygons(polygons) {
      // обход без рекурсии: [узел, многоугольники] → оставшиеся спереди/сзади
      const result = [];
      const stack = [[this, polygons]];
      while (stack.length) {
        const [node, polys] = stack.pop();
        if (!node.plane) { for (const p of polys) result.push(p); continue; }
        const front = [], back = [];
        for (const p of polys) node.plane.splitPolygon(p, front, back, front, back);
        if (front.length) {
          if (node.front) stack.push([node.front, front]);
          else for (const p of front) result.push(p);
        }
        if (back.length && node.back) stack.push([node.back, back]);
      }
      return result;
    }
    clipTo(bsp) {
      for (const n of this.nodes()) n.polygons = bsp.clipPolygons(n.polygons);
    }
    allPolygons() {
      const out = [];
      for (const n of this.nodes()) for (const p of n.polygons) out.push(p);
      return out;
    }
    build(polygons) {
      const stack = [[this, polygons]];
      while (stack.length) {
        const [node, polys] = stack.pop();
        if (!polys.length) continue;
        if (!node.plane) node.plane = polys[0].plane.clone();
        const front = [], back = [];
        for (const p of polys) node.plane.splitPolygon(p, node.polygons, node.polygons, front, back);
        if (front.length) { if (!node.front) node.front = new Node(); stack.push([node.front, front]); }
        if (back.length) { if (!node.back) node.back = new Node(); stack.push([node.back, back]); }
      }
    }
  }

  // ---------- Матрицы 3×4: [r00 r01 r02 tx  r10 r11 r12 ty  r20 r21 r22 tz] ----------
  const M = {
    I: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    T: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
    S: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0],
    Rx: (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
    Ry: (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
    Rz: (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
    /** a·b — сначала применяется b, потом a */
    mul(a, b) {
      const o = new Array(12);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          let s = c === 3 ? a[r * 4 + 3] : 0;
          for (let k = 0; k < 3; k++) s += a[r * 4 + k] * b[k * 4 + c];
          o[r * 4 + c] = s;
        }
      }
      return o;
    },
    chain(...ms) { return ms.reduce((acc, m) => M.mul(acc, m), M.I()); },
    apply(m, p) {
      return [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
      ];
    },
    applyDir(m, p) {
      return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[4] * p[0] + m[5] * p[1] + m[6] * p[2], m[8] * p[0] + m[9] * p[1] + m[10] * p[2]];
    },
    det(m) {
      return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
    },
  };

  class CSG {
    constructor(polygons) { this.polygons = polygons || []; }
    clone() { return new CSG(this.polygons.map((p) => p.clone())); }

    union(other) {
      const a = new Node(this.clone().polygons), b = new Node(other.clone().polygons);
      a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
      a.build(b.allPolygons());
      return new CSG(a.allPolygons());
    }
    subtract(other) {
      const a = new Node(this.clone().polygons), b = new Node(other.clone().polygons);
      a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
      a.build(b.allPolygons()); a.invert();
      return new CSG(a.allPolygons());
    }
    intersect(other) {
      const a = new Node(this.clone().polygons), b = new Node(other.clone().polygons);
      a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a);
      a.build(b.allPolygons()); a.invert();
      return new CSG(a.allPolygons());
    }
    /** Вычесть много тел: сначала объединяем их (дешевле), потом одно вычитание. */
    subtractAll(list) {
      const cut = list.filter(Boolean);
      if (!cut.length) return this;
      // непересекающиеся (по габаритам) тела просто складываем — булева операция не нужна
      let u = new CSG([]);
      const boxes = [];
      const overlap = (a, b) => a.min.every((_, i) => a.min[i] <= b.max[i] + EPS && b.min[i] <= a.max[i] + EPS);
      for (const c of cut) {
        const bb = c.bounds();
        if (boxes.some((b) => overlap(b, bb))) u = u.union(c);
        else u = new CSG(u.polygons.concat(c.clone().polygons));
        boxes.push(bb);
      }
      return this.subtract(u);
    }
    unionAll(list) {
      let u = this;
      for (const x of list) if (x) u = u.union(x);
      return u;
    }

    transform(m) {
      const flip = M.det(m) < 0;
      return new CSG(this.polygons.map((p) => {
        let vs = p.vertices.map((v) => M.apply(m, v));
        if (flip) vs = vs.reverse();
        return new Polygon(vs, p.shared);
      }));
    }
    translate(x, y, z) { return this.transform(M.T(x, y, z)); }

    /** Треугольники [[a,b,c], ...] (веер по выпуклым многоугольникам), без исправлений — для просмотра. */
    toTrianglesRaw() {
      const out = [];
      for (const p of this.polygons) {
        const v = p.vertices;
        for (let i = 1; i < v.length - 1; i++) out.push([v[0], v[i], v[i + 1]]);
      }
      return out;
    }

    /**
     * Замкнутая (водонепроницаемая) сетка треугольников для STL: вершины сваривались,
     * Т-образные стыки (вершина соседней грани посреди ребра) вставлены в рёбра.
     */
    toTriangles() {
      const TOL = 1e-5, CELL = 4;
      const ck = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
      const grid = new Map();
      const weld = (v) => {
        const cx = Math.floor(v[0] / CELL), cy = Math.floor(v[1] / CELL), cz = Math.floor(v[2] / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const w of list) if (Math.abs(w[0] - v[0]) < TOL && Math.abs(w[1] - v[1]) < TOL && Math.abs(w[2] - v[2]) < TOL) return w;
        }
        const k = `${cx},${cy},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(v);
        return v;
      };
      const polys = [];
      for (const p of this.polygons) {
        const vs = [];
        for (const v of p.vertices) {
          const w = weld(v);
          if (vs[vs.length - 1] !== w) vs.push(w);
        }
        while (vs.length > 1 && vs[0] === vs[vs.length - 1]) vs.pop();
        if (vs.length >= 3) polys.push(vs);
      }
      const out = [];
      for (const vs of polys) {
        const full = [];
        let inserted = false;
        for (let i = 0; i < vs.length; i++) {
          const a = vs[i], b = vs[(i + 1) % vs.length];
          full.push(a);
          const ab = sub(b, a), L2 = dot(ab, ab);
          if (L2 < 1e-18) continue;
          const found = [];
          const x0 = Math.floor((Math.min(a[0], b[0]) - TOL) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + TOL) / CELL);
          const y0 = Math.floor((Math.min(a[1], b[1]) - TOL) / CELL), y1 = Math.floor((Math.max(a[1], b[1]) + TOL) / CELL);
          const z0 = Math.floor((Math.min(a[2], b[2]) - TOL) / CELL), z1 = Math.floor((Math.max(a[2], b[2]) + TOL) / CELL);
          for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
            const list = grid.get(`${x},${y},${z}`);
            if (!list) continue;
            for (const v of list) {
              if (v === a || v === b) continue;
              const av = sub(v, a);
              const t = dot(av, ab) / L2;
              if (t <= 1e-9 || t >= 1 - 1e-9) continue;
              const pr = sub(av, scale(ab, t));
              if (dot(pr, pr) < TOL * TOL) found.push([t, v]);
            }
          }
          if (found.length) {
            found.sort((p, q) => p[0] - q[0]);
            for (const [, v] of found) full.push(v);
            inserted = true;
          }
        }
        if (!inserted) {
          for (let i = 1; i < full.length - 1; i++) out.push([full[0], full[i], full[i + 1]]);
        } else {
          // веер из центра — не даёт вырожденных треугольников на коллинеарных вершинах
          const cen = scale(full.reduce((s, v) => add(s, v), [0, 0, 0]), 1 / full.length);
          for (let i = 0; i < full.length; i++) out.push([cen, full[i], full[(i + 1) % full.length]]);
        }
      }
      return out;
    }

    bounds() {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const p of this.polygons) for (const v of p.vertices) for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
      return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
    }

    /** Объём по теореме о дивергенции (для проверки замкнутости и знака). */
    volume() {
      let v = 0;
      for (const [a, b, c] of this.toTrianglesRaw()) v += dot(a, cross(b, c)) / 6;
      return v;
    }

    // ---------- Примитивы ----------
    static box(min, max, shared) {
      const faces = [[[0, 4, 6, 2]], [[1, 3, 7, 5]], [[0, 1, 5, 4]], [[2, 6, 7, 3]], [[0, 2, 3, 1]], [[4, 5, 7, 6]]];
      const pt = (i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
      return new CSG(faces.map(([idx]) => new Polygon(idx.map(pt), shared)));
    }

    /** Цилиндр (или конус) от start до end. */
    static cylinder(start, end, radius, slices, radiusEnd, shared) {
      slices = slices || 32;
      const r1 = radiusEnd === undefined ? radius : radiusEnd;
      const ray = sub(end, start);
      const axisZ = unit(ray);
      const isY = Math.abs(axisZ[1]) > 0.5;
      const axisX = unit(cross(isY ? [1, 0, 0] : [0, 1, 0], axisZ));
      const axisY = unit(cross(axisX, axisZ));
      const point = (stack, t) => {
        const a = t * Math.PI * 2;
        const out = add(scale(axisX, Math.cos(a)), scale(axisY, Math.sin(a)));
        return add(add(start, scale(ray, stack)), scale(out, stack ? r1 : radius));
      };
      const polys = [];
      for (let i = 0; i < slices; i++) {
        const t0 = i / slices, t1 = (i + 1) / slices;
        polys.push(new Polygon([start, point(0, t0), point(0, t1)], shared));
        polys.push(new Polygon([point(0, t1), point(0, t0), point(1, t0), point(1, t1)], shared));
        polys.push(new Polygon([end, point(1, t1), point(1, t0)], shared));
      }
      return new CSG(polys);
    }

    /** Призма: многоугольник в плоскости XY (любой простой), выдавленный по Z от z0 до z1. */
    static prism(poly, z0, z1, shared) {
      let pts = poly.slice();
      if (area2(pts) < 0) pts.reverse();
      const polys = [];
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        polys.push(new Polygon([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], shared));
      }
      for (const [i, j, k] of earClip(pts)) {
        polys.push(new Polygon([[...pts[i], z1], [...pts[j], z1], [...pts[k], z1]], shared));
        polys.push(new Polygon([[...pts[i], z0], [...pts[k], z0], [...pts[j], z0]], shared));
      }
      return new CSG(polys);
    }
  }

  function area2(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      s += a[0] * b[1] - a[1] * b[0];
    }
    return s / 2;
  }

  function earClip(pts) {
    const idx = pts.map((_, i) => i);
    const tris = [];
    const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12;
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const a = idx[(i - 1 + idx.length) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
        if (cr(pts[a], pts[b], pts[c]) <= 1e-12) continue;
        let ok = true;
        for (const j of idx) {
          if (j === a || j === b || j === c) continue;
          if (inside(pts[j], pts[a], pts[b], pts[c])) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push([a, b, c]);
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) tris.push(idx.slice());
    else for (let i = 1; i < idx.length - 1; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
    return tris;
  }

  return { CSG, Polygon, Plane, M };
});
