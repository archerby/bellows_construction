/* Интерфейс приложения «Расчёт меха». */
(function () {
  'use strict';
  const Geo = window.BellowsGeometry;
  const Ex = window.BellowsExport;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const STORAGE_KEY = 'bellows.params.v1';
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

  // ---------------------------------------------------------------------
  // Параметры: схема формы и пресеты
  // ---------------------------------------------------------------------
  const SCHEMA = [
    {
      legend: 'Рамки',
      fields: [
        { key: 'sizeMode', label: 'Размеры задают', type: 'select', options: [['frame', 'по рамкам (манжетам)'], ['clear', 'по просвету в складках']],
          hint: '«По рамкам» — размер, по которому мех вклеивается в рамку. «По просвету» — минимальное внутреннее отверстие в складках.' },
        { pair: ['frontW', 'frontH'], label: 'Передняя (объектив), Ш × В' },
        { pair: ['rearW', 'rearH'], label: 'Задняя (кассета), Ш × В' },
      ],
    },
    {
      legend: 'Длина',
      fields: [
        { key: 'maxExt', label: 'Макс. растяжение, мм', hint: 'Расстояние между рамками при полностью растянутом мехе.' },
        { key: 'collarF', label: 'Манжета спереди, мм' },
        { key: 'collarR', label: 'Манжета сзади, мм' },
        { key: 'reserve', label: 'Запас длины, %', hint: 'На максимальном растяжении складки не распрямляются до конца — мех остаётся светонепроницаемым и жёстким.' },
      ],
    },
    {
      legend: 'Складки',
      fields: [
        { key: 'pitch', label: 'Ширина плашки, мм', step: 0.5, hint: 'Она же глубина складки. Обычно 8–15 мм; итоговая подгоняется под целое число складок.' },
        { key: 'hingeGap', label: 'Зазор на сгибе, мм', step: 0.1, hint: 'Промежуток между соседними плашками — сюда ложится сгиб.' },
        { key: 'cornerGap', label: 'Отступ от диагонали, мм', step: 0.1 },
        { key: 'startOut', label: 'Первая складка верха', type: 'select', options: [['true', 'гребнем наружу'], ['false', 'гребнем внутрь']] },
      ],
    },
    {
      legend: 'Материалы',
      fields: [
        { key: 'tStiff', label: 'Толщина плашки, мм', step: 0.05 },
        { key: 'tOuter', label: 'Наружный материал, мм', step: 0.05 },
        { key: 'tLining', label: 'Подкладка, мм', step: 0.05 },
        { key: 'flap', label: 'Клапан шва, мм', step: 0.5 },
      ],
    },
  ];

  const PRESETS = {
    '4x5t': { name: '4×5″ конический', frontW: 100, frontH: 100, rearW: 150, rearH: 150, maxExt: 400, pitch: 12 },
    '4x5s': { name: '4×5″ прямой', frontW: 150, frontH: 150, rearW: 150, rearH: 150, maxExt: 400, pitch: 12 },
    '4x5w': { name: '4×5″ широкоугольный (короткий)', frontW: 130, frontH: 130, rearW: 150, rearH: 150, maxExt: 180, pitch: 10 },
    '5x7t': { name: '5×7″ конический', frontW: 120, frontH: 120, rearW: 210, rearH: 210, maxExt: 480, pitch: 14 },
    '8x10t': { name: '8×10″ конический', frontW: 160, frontH: 160, rearW: 310, rearH: 310, maxExt: 650, pitch: 16 },
    '6x9t': { name: '6×9 / 6×12 (среднеформатный задник)', frontW: 80, frontH: 80, rearW: 120, rearH: 100, maxExt: 260, pitch: 9 },
  };

  let params = Object.assign({}, Geo.DEFAULTS);
  let model = null;
  let activeTab = 'drawing';
  const dirty = { drawing: true, pattern: true, view3d: true, stl: true };
  let viewer = null;
  let extValue = null;

  // ---------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------
  function numberInput(key, step) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.id = 'p-' + key;
    inp.dataset.key = key;
    inp.step = step || 1;
    inp.min = 0;
    return inp;
  }

  function buildForm() {
    const root = $('#params');
    root.innerHTML = '';
    const pf = document.createElement('fieldset');
    pf.innerHTML = '<legend>Пресет</legend>';
    const sel = document.createElement('select');
    sel.className = 'preset';
    sel.id = 'preset';
    sel.innerHTML = '<option value="">— выбрать типовой мех —</option>' +
      Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    sel.addEventListener('change', () => {
      const pr = PRESETS[sel.value];
      if (!pr) return;
      const copy = Object.assign({}, pr);
      delete copy.name;
      params = Object.assign({}, Geo.DEFAULTS, copy);
      fillForm();
      update();
    });
    const wrap = document.createElement('div');
    wrap.className = 'field wide';
    wrap.appendChild(sel);
    pf.appendChild(wrap);
    const note = document.createElement('div');
    note.className = 'field-hint';
    note.textContent = 'Размеры пресетов ориентировочные — измерьте свои рамки.';
    pf.appendChild(note);
    root.appendChild(pf);

    for (const group of SCHEMA) {
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = group.legend;
      fs.appendChild(lg);
      for (const f of group.fields) {
        const row = document.createElement('div');
        row.className = 'field';
        const label = document.createElement('label');
        label.textContent = f.label;
        row.appendChild(label);
        if (f.pair) {
          row.classList.add('pair');
          const a = numberInput(f.pair[0], f.step), b = numberInput(f.pair[1], f.step);
          label.htmlFor = a.id;
          const x = document.createElement('span');
          x.className = 'x';
          x.textContent = '×';
          row.append(a, x, b);
        } else if (f.type === 'select') {
          const s = document.createElement('select');
          s.id = 'p-' + f.key;
          s.dataset.key = f.key;
          s.innerHTML = f.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
          label.htmlFor = s.id;
          row.appendChild(s);
        } else {
          const inp = numberInput(f.key, f.step);
          label.htmlFor = inp.id;
          row.appendChild(inp);
        }
        if (f.hint) {
          const h = document.createElement('div');
          h.className = 'field-hint';
          h.textContent = f.hint;
          row.appendChild(h);
        }
        fs.appendChild(row);
      }
      root.appendChild(fs);
    }
    let timer = null;
    root.addEventListener('input', (e) => {
      const key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      params[key] = e.target.type === 'number' ? e.target.value : e.target.value;
      $('#preset').value = '';
      clearTimeout(timer);
      timer = setTimeout(update, 120);
    });
  }

  function fillForm() {
    for (const el of $$('#params [data-key]')) {
      const v = params[el.dataset.key];
      el.value = typeof v === 'boolean' ? String(v) : v;
    }
  }

  // ---------------------------------------------------------------------
  // Хранение
  // ---------------------------------------------------------------------
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Geo.normalizeParams(params))); } catch (e) { /* приватный режим */ }
    try {
      const diff = {};
      const np = Geo.normalizeParams(params);
      for (const k of Object.keys(Geo.DEFAULTS)) if (np[k] !== Geo.DEFAULTS[k]) diff[k] = np[k];
      const hash = Object.keys(diff).length ? '#p=' + encodeURIComponent(JSON.stringify(diff)) : '';
      history.replaceState(null, '', location.pathname + location.search + hash);
    } catch (e) { /* file:// в некоторых браузерах */ }
  }

  function load() {
    let loaded = null;
    const m = location.hash.match(/^#p=(.+)$/);
    if (m) {
      try { loaded = JSON.parse(decodeURIComponent(m[1])); } catch (e) { loaded = null; }
    }
    if (!loaded) {
      try { loaded = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { loaded = null; }
    }
    params = Geo.normalizeParams(loaded || {});
  }

  // ---------------------------------------------------------------------
  // Расчёт и сводка
  // ---------------------------------------------------------------------
  function update() {
    model = Geo.computeBellows(params);
    save();
    renderSummary();
    renderMessages();
    for (const k of Object.keys(dirty)) dirty[k] = true;
    extValue = null;
    renderActive();
  }

  function card(k, v, s) {
    return `<div class="card"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  }

  function renderSummary() {
    const el = $('#summary');
    if (!model.derived) { el.innerHTML = ''; return; }
    const d = model.derived, p = model.params;
    el.innerHTML = [
      card('Складок на сторону', d.N, `плашка ${f1(d.hAct)} мм`),
      card('Плашек', d.stiffenerCount, `по ${p.tStiff} мм`),
      card('Просвет в складках', `${f1(d.clearRear.w)}×${f1(d.clearRear.h)}`, `спереди ${f1(d.clearFront.w)}×${f1(d.clearFront.h)} мм`),
      card('Габарит сложенного', `${f1(d.outerRear.w)}×${f1(d.outerRear.h)}`, 'сзади, мм'),
      card('Растяжение', `${f1(d.minFrame)}…${f1(p.maxExt)}`, 'мм, мин. — оценка'),
      card('Развёртка', `${f1(model.pattern.width)}×${f1(model.pattern.height)}`, `мм, ткань ≈ ${(d.fabricArea / 1e6).toFixed(2).replace('.', ',')} м²`),
    ].join('');
  }

  function renderMessages() {
    const el = $('#messages');
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    el.innerHTML = model.errors.map((m) => `<div class="msg err">${esc(m)}</div>`).join('') +
      model.warnings.map((m) => `<div class="msg warn">${esc(m)}</div>`).join('');
  }

  // ---------------------------------------------------------------------
  // Вкладки
  // ---------------------------------------------------------------------
  function setTab(name) {
    activeTab = name;
    for (const b of $$('.tabs button')) b.classList.toggle('active', b.dataset.tab === name);
    for (const p of $$('.tab-panel')) p.classList.toggle('active', p.id === 'tab-' + name);
    renderActive();
  }

  function renderActive() {
    if (!model || !model.ok) {
      for (const id of ['#drawing-view', '#pattern-view', '#stl-view']) $(id).innerHTML = '';
      if (viewer) viewer.setData({ tris: new Float32Array(0), lines: new Float32Array(0) }, true);
      return;
    }
    if (!dirty[activeTab]) return;
    dirty[activeTab] = false;
    if (activeTab === 'drawing') renderDrawing();
    else if (activeTab === 'pattern') renderPattern();
    else if (activeTab === 'view3d') render3D(false);
    else if (activeTab === 'stl') renderStl();
  }

  function mountSvg(container, svgText) {
    container.innerHTML = svgText.replace(/^<\?xml[^>]*>\s*/, '');
    const svg = container.querySelector('svg');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.dataset.base = svg.getAttribute('viewBox');
  }

  function renderDrawing() {
    mountSvg($('#drawing-view'), Ex.drawingSVG(model, { physical: false }));
  }

  function patternOpts() {
    return { stiffeners: $('#pat-stiff').checked, labels: $('#pat-labels').checked };
  }

  function renderPattern() {
    mountSvg($('#pattern-view'), Ex.patternSVG(model, Object.assign({ physical: false }, patternOpts())));
    const plan = Ex.tilePlan(model, $('#print-paper').value, 8, 10);
    $('#print-hint').textContent = `${plan.pages} лист(ов) ${plan.paper}, ${plan.landscape ? 'альбомная' : 'книжная'}, перекрытие 10 мм`;
  }

  // Масштаб и сдвиг SVG-видов через viewBox
  function attachPanZoom(container) {
    let drag = null;
    const vb = (svg) => svg.getAttribute('viewBox').split(/\s+/).map(Number);
    container.addEventListener('wheel', (e) => {
      const svg = container.querySelector('svg');
      if (!svg) return;
      e.preventDefault();
      const [x, y, w, h] = vb(svg);
      const r = svg.getBoundingClientRect();
      const scale = Math.min(r.width / w, r.height / h);
      const offX = (r.width - w * scale) / 2, offY = (r.height - h * scale) / 2;
      const mx = x + (e.clientX - r.left - offX) / scale, my = y + (e.clientY - r.top - offY) / scale;
      const k = Math.exp(e.deltaY * 0.0015);
      const nw = w * k, nh = h * k;
      svg.setAttribute('viewBox', `${mx - (mx - x) * k} ${my - (my - y) * k} ${nw} ${nh}`);
    }, { passive: false });
    container.addEventListener('pointerdown', (e) => {
      const svg = container.querySelector('svg');
      if (!svg) return;
      container.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, vb: vb(svg) };
    });
    container.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const svg = container.querySelector('svg');
      const [x, y, w, h] = drag.vb;
      const r = svg.getBoundingClientRect();
      const scale = Math.min(r.width / w, r.height / h);
      svg.setAttribute('viewBox', `${x - (e.clientX - drag.x) / scale} ${y - (e.clientY - drag.y) / scale} ${w} ${h}`);
    });
    const end = () => { drag = null; };
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
    container.addEventListener('dblclick', () => {
      const svg = container.querySelector('svg');
      if (svg && svg.dataset.base) svg.setAttribute('viewBox', svg.dataset.base);
    });
  }

  // ---------------------------------------------------------------------
  // 3D
  // ---------------------------------------------------------------------
  function ensureViewer() {
    if (viewer) return viewer;
    try {
      viewer = new window.BellowsViewer($('#gl'));
    } catch (e) {
      $('.canvas-wrap').innerHTML = `<div class="msg err" style="margin:12px">Не удалось запустить 3D: ${e.message}</div>`;
      viewer = null;
    }
    return viewer;
  }

  function extRange() {
    const d = model.derived, p = model.params;
    return { min: Math.ceil(d.minFrame * 2) / 2, max: p.maxExt };
  }

  function render3D(keepCamera) {
    const v = ensureViewer();
    if (!v) return;
    const r = extRange();
    const range = $('#ext-range');
    range.min = r.min;
    range.max = r.max;
    if (extValue === null) extValue = Math.round((r.min + (r.max - r.min) * 0.75) * 2) / 2;
    extValue = Math.max(r.min, Math.min(r.max, extValue));
    range.value = extValue;
    $('#ext-out').textContent = `${f1(extValue)} мм`;

    const showFabric = $('#v-fabric').checked, showStiff = $('#v-stiff').checked, showEdges = $('#v-edges').checked;
    const mesh = Geo.buildMesh3D(model, extValue, { stiffOffset: showFabric ? 0.5 : 0 });
    const half = mesh.ext / 2;
    const T = (q) => [q[2] - half, q[1], -q[0]];
    const TN = (n) => [n[2], n[1], -n[0]];
    const tris = [], lines = [];
    const pushTri = (a, b, c, n, col) => { for (const q of [a, b, c]) tris.push(...T(q), ...TN(n), ...col); };
    if (showFabric) {
      for (const f of mesh.faces) {
        const col = f.collar ? [0.36, 0.33, 0.3] : (f.panel % 2 ? [0.2, 0.2, 0.22] : [0.24, 0.24, 0.26]);
        const [a, b, c, d] = f.quad;
        pushTri(a, b, c, f.normal, col);
        pushTri(a, c, d, f.normal, col);
      }
    }
    if (showStiff) {
      const byId = new Map(model.pattern.stiffeners.map((s) => [s.id, s]));
      for (const s of mesh.stiffeners) {
        const src = byId.get(s.id);
        const idx = Ex.triangulate(src.poly);
        const col = [0.95, 0.62, 0.25];
        for (const [a, b, c] of idx) pushTri(s.poly[a], s.poly[b], s.poly[c], s.normal, col);
      }
    }
    if (showEdges) {
      const rings = mesh.rings;
      const corner = (r, i) => [[-r.X, -r.Y, r.z], [r.X, -r.Y, r.z], [r.X, r.Y, r.z], [-r.X, r.Y, r.z]][i];
      for (const r of rings) for (let i = 0; i < 4; i++) lines.push(...T(corner(r, i)), ...T(corner(r, (i + 1) % 4)));
      for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < 4; i++) lines.push(...T(corner(rings[k], i)), ...T(corner(rings[k + 1], i)));
    }
    const d = model.derived;
    const radius = Math.max(model.params.maxExt / 2, d.outerRear.w / 2, d.outerRear.h / 2, d.outerFront.w / 2) * 1.1;
    v.setData({ tris: new Float32Array(tris), lines: new Float32Array(lines), center: [0, 0, 0], radius }, keepCamera);
  }

  // ---------------------------------------------------------------------
  // Плашки / STL
  // ---------------------------------------------------------------------
  function stlOpts() {
    return {
      mode: $('#stl-mode').value,
      bedW: Math.max(50, Number($('#bed-w').value) || 220),
      bedH: Math.max(50, Number($('#bed-h').value) || 220),
      gap: Math.max(0.5, Number($('#bed-gap').value) || 2),
      margin: 3,
    };
  }

  function renderStl() {
    const o = stlOpts();
    const info = $('#stl-info');
    const P = model.pattern;
    if (o.mode === 'bed') {
      const pack = Ex.packStiffeners(P.stiffeners, o.bedW, o.bedH, o.gap, o.margin);
      const n = pack.beds.length;
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const cw = o.bedW + 12, ch = o.bedH + 20;
      const rows = Math.ceil(n / cols);
      const parts = pack.beds.map((b, i) => {
        const x = (i % cols) * (cw + 10), y = Math.floor(i / cols) * (ch + 10);
        return Ex.bedSVG(b, o.bedW, o.bedH, i).replace('<svg ', `<svg x="${x}" y="${y}" width="${cw}" height="${ch}" `);
      });
      const W = cols * (cw + 10), H = rows * (ch + 10);
      mountSvg($('#stl-view'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`);
      info.innerHTML = `<b>${P.stiffeners.length}</b> плашек толщиной <b>${model.params.tStiff} мм</b> → <b>${n}</b> стол(ов) ${o.bedW}×${o.bedH} мм. ` +
        'В архиве для каждого стола STL и SVG-карта с номерами плашек. Цвет — сторона меха: A низ, B правая, C верх, D левая.' +
        (pack.overflow.length ? ` <span style="color:#c0392b">Не помещаются на стол: ${pack.overflow.join(', ')}</span>` : '');
    } else {
      mountSvg($('#stl-view'), Ex.patternSVG(model, { physical: false, stiffeners: true, labels: true, legend: false }));
      if (o.mode === 'pattern') {
        const fits = (P.width <= o.bedW && P.height <= o.bedH) || (P.height <= o.bedW && P.width <= o.bedH);
        info.innerHTML = `Все плашки одним файлом в позициях развёртки: <b>${f1(P.width)} × ${f1(P.height)} мм</b>. ` +
          (fits ? 'Помещается на стол.' : '<span style="color:#c0392b">Не помещается на стол — выберите «раскладку на стол» или печать по сторонам.</span>');
      } else {
        const sizes = [0, 1, 2, 3].map((i) => {
          const ax = P.labels[i].axis;
          const a = Math.PI / 2 - Math.atan2(ax[1], ax[0]), c = Math.cos(a), s = Math.sin(a);
          const pts = [].concat(...P.stiffeners.filter((st) => st.panel === i).map((st) => st.poly))
            .map((p) => [c * p[0] - s * p[1], s * p[0] + c * p[1]]);
          const bb = Geo.util.bbox(pts);
          return `${Geo.PANEL_NAMES[i]}: ${f1(bb.w)}×${f1(bb.h)}`;
        });
        info.innerHTML = `Четыре файла, по одному на сторону, плашки в позициях развёртки (удобно накладывать ткань прямо на стол). Габариты, мм — ${sizes.join('; ')}.`;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Скачивание
  // ---------------------------------------------------------------------
  function download(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function baseName() {
    const d = model.derived;
    return `bellows_${Math.round(d.mid.fW)}x${Math.round(d.mid.fH)}-${Math.round(d.mid.rW)}x${Math.round(d.mid.rH)}_L${Math.round(model.params.maxExt)}`;
  }

  const ACTIONS = {
    'drawing-svg': () => download(baseName() + '_drawing.svg', Ex.drawingSVG(model), 'image/svg+xml'),
    'pattern-svg': () => download(baseName() + '_pattern.svg', Ex.patternSVG(model, patternOpts()), 'image/svg+xml'),
    'pattern-dxf': () => download(baseName() + '_pattern.dxf', Ex.dxfPattern(model, { stiffeners: $('#pat-stiff').checked }), 'application/dxf'),
    'pattern-print': () => {
      const t = Ex.printTilesHTML(model, Object.assign({ paper: $('#print-paper').value }, patternOpts()));
      $('#print-area').innerHTML = t.html;
      $('#page-style').textContent = t.css;
      setTimeout(() => window.print(), 50);
    },
    'mesh-stl': () => {
      const mesh = Geo.buildMesh3D(model, extValue || model.params.maxExt, { stiffOffset: 0 });
      download(`${baseName()}_surface_${Math.round(mesh.ext)}mm.stl`, Ex.meshSTL(mesh), 'model/stl');
    },
    'view-png': () => {
      if (!viewer) return;
      viewer.render();
      $('#gl').toBlob((b) => b && download(baseName() + '_3d.png', b));
    },
    'view-reset': () => viewer && viewer.resetView(),
    'stl-export': () => {
      const o = stlOpts();
      const files = Ex.stiffenerFiles(model, o);
      const stls = files.filter((f) => f.name.endsWith('.stl'));
      if (stls.length === 1 && o.mode === 'pattern') {
        download(`${baseName()}_stiffeners.stl`, stls[0].data, 'model/stl');
      } else {
        download(`${baseName()}_stiffeners_${o.mode}.zip`, Ex.makeZip(files), 'application/zip');
      }
    },
  };

  // ---------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------
  function init() {
    load();
    buildForm();
    fillForm();
    for (const b of $$('.tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || !model || !model.ok) return;
      const fn = ACTIONS[btn.dataset.action];
      if (fn) fn();
    });
    for (const id of ['#drawing-view', '#pattern-view', '#stl-view']) attachPanZoom($(id));
    for (const id of ['#pat-stiff', '#pat-labels', '#print-paper']) $(id).addEventListener('change', () => { dirty.pattern = true; renderActive(); });
    for (const id of ['#stl-mode', '#bed-w', '#bed-h', '#bed-gap']) $(id).addEventListener('change', () => { dirty.stl = true; renderActive(); });
    for (const id of ['#v-fabric', '#v-stiff', '#v-edges']) $(id).addEventListener('change', () => model && model.ok && render3D(true));
    $('#ext-range').addEventListener('input', (e) => {
      extValue = Number(e.target.value);
      if (model && model.ok) render3D(true);
    });

    $('#btn-reset').addEventListener('click', () => {
      params = Object.assign({}, Geo.DEFAULTS);
      $('#preset').value = '';
      fillForm();
      update();
    });
    $('#btn-save-json').addEventListener('click', () => {
      download('bellows_params.json', JSON.stringify(Geo.normalizeParams(params), null, 2), 'application/json');
    });
    $('#file-json').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((txt) => {
        try {
          params = Geo.normalizeParams(JSON.parse(txt));
          fillForm();
          update();
        } catch (err) {
          alert('Не удалось прочитать файл параметров: ' + err.message);
        }
      });
      e.target.value = '';
    });
    window.addEventListener('afterprint', () => { $('#print-area').innerHTML = ''; });
    update();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
