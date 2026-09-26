/*
 * Минимальный WebGL-просмотрщик: треугольники с освещением + линии, орбитальная камера.
 * Управление: левая кнопка — вращение, правая / Shift — сдвиг, колесо / щипок — масштаб,
 * двойной щелчок — исходный вид.
 */
(function (root) {
  'use strict';

  const M4 = {
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    },
    lookAt(eye, target, up) {
      let z = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
      let l = Math.hypot(...z); z = z.map((v) => v / l);
      let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
      l = Math.hypot(...x) || 1; x = x.map((v) => v / l);
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      const d = (a) => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -d(x), -d(y), -d(z), 1];
    },
    mul(a, b) {
      const o = new Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
      return o;
    },
  };

  const VS_TRI = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;
    uniform mat4 uMVP; varying vec3 vNor; varying vec3 vCol;
    void main(){ gl_Position = uMVP * vec4(aPos,1.0); vNor = aNor; vCol = aCol; }`;
  const FS_TRI = `
    precision mediump float; varying vec3 vNor; varying vec3 vCol;
    uniform vec3 uL1; uniform vec3 uL2;
    void main(){
      vec3 n = normalize(vNor);
      float d = 0.32 + 0.55*abs(dot(n,uL1)) + 0.25*abs(dot(n,uL2));
      gl_FragColor = vec4(vCol*d, 1.0);
    }`;
  const VS_LINE = `attribute vec3 aPos; uniform mat4 uMVP; void main(){ gl_Position = uMVP*vec4(aPos,1.0); }`;
  const FS_LINE = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = uColor; }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function Viewer(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.triProg = compile(gl, VS_TRI, FS_TRI);
    this.lineProg = compile(gl, VS_LINE, FS_LINE);
    this.triBuf = gl.createBuffer();
    this.lineBuf = gl.createBuffer();
    this.triCount = 0;
    this.lineCount = 0;
    this.cam = { yaw: -0.55, pitch: 0.32, dist: 800, target: [0, 0, 0] };
    this.home = null;
    this.background = [0.965, 0.965, 0.97];
    this._bindEvents();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.render()) : null;
    if (ro) ro.observe(canvas);
    else window.addEventListener('resize', () => this.render());
  }

  /**
   * data.tris: Float32Array [x,y,z, nx,ny,nz, r,g,b] * 3 * n
   * data.lines: Float32Array [x,y,z] * 2 * n
   */
  Viewer.prototype.setData = function (data, keepCamera) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.tris, gl.STATIC_DRAW);
    this.triCount = data.tris.length / 9;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.lines, gl.STATIC_DRAW);
    this.lineCount = data.lines.length / 3;
    this.radius = data.radius || 300;
    if (!keepCamera || !this.home) {
      if (this.home) { this.cam.yaw = this.home.yaw; this.cam.pitch = this.home.pitch; }
      this.cam.target = data.center ? data.center.slice() : [0, 0, 0];
      this.cam.dist = this.radius * 2.6;
      this.home = JSON.parse(JSON.stringify(this.cam));
    }
    this.render();
  };

  Viewer.prototype.resetView = function () {
    if (this.home) this.cam = JSON.parse(JSON.stringify(this.home));
    this.render();
  };

  Viewer.prototype.render = function () {
    const gl = this.gl, c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(...this.background, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const { yaw, pitch, dist, target } = this.cam;
    const eye = [
      target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[1] + dist * Math.sin(pitch),
      target[2] + dist * Math.cos(pitch) * Math.cos(yaw),
    ];
    const r = this.radius || 300;
    const proj = M4.perspective((35 * Math.PI) / 180, w / h, Math.max(0.5, dist - r * 3), dist + r * 3);
    const view = M4.lookAt(eye, target, [0, 1, 0]);
    const mvp = M4.mul(proj, view);
    let l1 = [eye[0] - target[0], eye[1] - target[1] + dist * 0.5, eye[2] - target[2]];
    const n1 = Math.hypot(...l1); l1 = l1.map((v) => v / n1);

    if (this.triCount) {
      gl.useProgram(this.triProg);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf);
      const P = this.triProg;
      const aPos = gl.getAttribLocation(P, 'aPos'), aNor = gl.getAttribLocation(P, 'aNor'), aCol = gl.getAttribLocation(P, 'aCol');
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(aNor); gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 36, 24);
      gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uMVP'), false, new Float32Array(mvp));
      gl.uniform3fv(gl.getUniformLocation(P, 'uL1'), l1);
      gl.uniform3fv(gl.getUniformLocation(P, 'uL2'), [0.3, 0.9, -0.3]);
      gl.drawArrays(gl.TRIANGLES, 0, this.triCount);
      gl.disableVertexAttribArray(aNor); gl.disableVertexAttribArray(aCol);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    if (this.lineCount) {
      gl.useProgram(this.lineProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      const aPos = gl.getAttribLocation(this.lineProg, 'aPos');
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 12, 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uMVP'), false, new Float32Array(mvp));
      gl.uniform4fv(gl.getUniformLocation(this.lineProg, 'uColor'), [0.55, 0.55, 0.6, 1]);
      gl.drawArrays(gl.LINES, 0, this.lineCount);
    }
  };

  Viewer.prototype._bindEvents = function () {
    const c = this.canvas;
    const pointers = new Map();
    let mode = null, last = null, pinch = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: this.cam.dist };
        mode = 'pinch';
      } else {
        mode = e.button === 2 || e.shiftKey ? 'pan' : 'rotate';
        last = [e.clientX, e.clientY];
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (mode === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.cam.dist = Math.max(this.radius * 0.2, Math.min(this.radius * 20, pinch.dist * (pinch.d / Math.max(1, d))));
        this.render();
        return;
      }
      if (!last) return;
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      if (mode === 'rotate') {
        this.cam.yaw -= dx * 0.008;
        this.cam.pitch = Math.max(-1.5, Math.min(1.5, this.cam.pitch + dy * 0.008));
      } else if (mode === 'pan') {
        const s = (this.cam.dist * 0.0012);
        const { yaw, pitch } = this.cam;
        const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
        const up = [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)];
        for (let i = 0; i < 3; i++) this.cam.target[i] += (-dx * right[i] + dy * up[i]) * s;
      }
      this.render();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) { mode = null; last = null; }
      else { const v = [...pointers.values()][0]; last = [v[0], v[1]]; mode = 'rotate'; }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(e.deltaY * 0.0012);
      this.cam.dist = Math.max(this.radius * 0.2, Math.min(this.radius * 20, this.cam.dist * k));
      this.render();
    }, { passive: false });
    c.addEventListener('dblclick', () => this.resetView());
  };

  root.BellowsViewer = Viewer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
