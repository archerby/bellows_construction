/* Интерфейс приложения «Расчёт меха». */
(function () {
  'use strict';
  const Geo = window.BellowsGeometry;
  const Ex = window.BellowsExport;
  const Cam = window.BellowsCamera;
  const CSGM = window.BellowsCSG.M;
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
        { key: 'tStiff', label: 'Толщина плашки', type: 'select',
          options: [['0.2', '0,2 мм'], ['0.4', '0,4 мм']],
          hint: '0,2 мм — один слой: мягче, мех складывается плотнее. 0,4 мм — два слоя: жёстче, для крупных мехов (5×7″, 8×10″).' },
        { key: 'tOuter', label: 'Наружный материал, мм', step: 0.05 },
        { key: 'tLining', label: 'Подкладка, мм', step: 0.05 },
        { key: 'flap', label: 'Клапан шва, мм', step: 0.5 },
      ],
    },
  ];

  const PRESETS = {
    '4x5t': { name: '4×5″ конический', frontW: 100, frontH: 100, rearW: 150, rearH: 150, maxExt: 400, pitch: 12, camFormat: '4x5' },
    '4x5s': { name: '4×5″ прямой', frontW: 150, frontH: 150, rearW: 150, rearH: 150, maxExt: 400, pitch: 12, camFormat: '4x5' },
    '4x5w': { name: '4×5″ широкоугольный (короткий)', frontW: 130, frontH: 130, rearW: 150, rearH: 150, maxExt: 180, pitch: 10, camFormat: '4x5' },
    '5x7t': { name: '5×7″ конический', frontW: 120, frontH: 120, rearW: 210, rearH: 210, maxExt: 480, pitch: 14, camFormat: '5x7' },
    '8x10t': { name: '8×10″ конический', frontW: 160, frontH: 160, rearW: 310, rearH: 310, maxExt: 650, pitch: 16, camFormat: '8x10' },
    '6x9t': { name: '6×9 / 6×12 (среднеформатный задник)', frontW: 80, frontH: 80, rearW: 120, rearH: 100, maxExt: 260, pitch: 9 },
  };

  const opts = (obj) => Object.entries(obj).map(([k, v]) => [k, v.name]);
  const CAM_SCHEMA = [
    {
      legend: 'Тип камеры',
      fields: [
        { key: 'camStyle', label: 'Конструкция', type: 'select', options: opts(Cam.STYLES),
          hint: 'Монорельсовая — все подвижки, для студии. Складная — компактная коробка с откидной станиной: подъём и наклон спереди, задник неподвижный.' },
        { key: 'camFieldRise', label: 'Подъём у складной, ±мм', hint: 'Больше подъём — выше коробка.' },
        { key: 'camLensFold', label: 'Выступ объектива, мм', hint: 'Насколько объектив выступает вперёд от платы. Складная коробка делается такой глубины, чтобы он поместился внутрь.' },
      ],
    },
    {
      legend: 'Формат и кассеты',
      fields: [
        { key: 'camFormat', label: 'Формат', type: 'select', options: opts(Cam.FORMATS) },
        { key: 'camHolderW', label: 'Ширина кассеты, мм', step: 0.1, hint: '0 — справочное значение для формата. Лучше измерить свою кассету.' },
        { key: 'camFilmDepth', label: 'Глубина плоскости плёнки, мм', step: 0.05, hint: 'От лицевой плоскости кассеты до плёнки. 0 — справочное. Определяет резкость!' },
        { key: 'camGroove', label: 'Канавка светового замка', type: 'select', options: [['true', 'есть'], ['false', 'нет (флок/уплотнитель)']] },
        { key: 'camGlassT', label: 'Толщина матового стекла, мм', step: 0.1 },
      ],
    },
    {
      legend: 'Объектив',
      fields: [
        { key: 'camBoard', label: 'Объективная плата', type: 'select', options: opts(Cam.BOARDS) },
        { pair: ['camBoardW', 'camBoardH'], label: 'Своя плата, Ш × В' },
        { key: 'camShutter', label: 'Затвор', type: 'select', options: opts(Cam.SHUTTERS) },
        { key: 'camShutterD', label: 'Свой диаметр затвора, мм', step: 0.1 },
      ],
    },
    {
      legend: 'Рельс и подвижки',
      fields: [
        { key: 'camRail', label: 'Профиль', type: 'select', options: opts(Cam.RAILS) },
        { key: 'camRailLength', label: 'Длина рельса, мм', hint: '0 — подобрать по растяжению меха.' },
        { key: 'camRise', label: 'Подъём/опускание, ±мм', hint: 'Передняя рамка. Сдвиг и поворот — у обеих стоек, наклон — у обеих рамок.' },
        { key: 'camShift', label: 'Сдвиг вбок, ±мм' },
        { key: 'camTripod', label: 'Штативная резьба', type: 'select', options: opts(Cam.TRIPOD) },
      ],
    },
    {
      legend: 'Печать',
      fields: [
        { pair: ['camBedW', 'camBedH'], label: 'Стол принтера, Ш × В' },
        { key: 'camSplit', label: 'Большие детали', type: 'select', options: [['true', 'разрезать на части с «ласточкиным хвостом»'], ['false', 'не разрезать']],
          hint: 'Место разреза выбирается автоматически — в стороне от отверстий, пазов и гнёзд гаек.' },
        { key: 'camClearance', label: 'Зазор посадок, мм', step: 0.05, hint: 'Добавляется к отверстиям под гайки, платам и шипам составных деталей. 0,2–0,4 мм для FDM.' },
      ],
    },
  ];

  let params = Object.assign({}, Geo.DEFAULTS, Cam.CAM_DEFAULTS);
  let camera = null;
  let camViewer = null;
  let camExt = null;
  let lastCamStyle = null;
  let model = null;
  let activeTab = 'drawing';
  const dirty = { drawing: true, pattern: true, view3d: true, stl: true, camera: true };
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
      params = Object.assign({}, params, Geo.DEFAULTS, copy);
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

    buildGroups(root, SCHEMA);
    buildGroups($('#cam-params'), CAM_SCHEMA);
    attachInput(root);
    attachInput($('#cam-params'));
  }

  function attachInput(root) {
    let timer = null;
    root.addEventListener('input', (e) => {
      const key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      params[key] = e.target.value;
      if (!key.startsWith('cam')) $('#preset').value = '';
      clearTimeout(timer);
      timer = setTimeout(update, 150);
    });
  }

  function buildGroups(root, schema) {
    for (const group of schema) {
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
          row.classList.add('sel');
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
  }

  function fillForm() {
    for (const el of $$('#params [data-key], #cam-params [data-key]')) {
      const v = params[el.dataset.key];
      el.value = typeof v === 'boolean' ? String(v) : v;
    }
  }

  // ---------------------------------------------------------------------
  // Хранение
  // ---------------------------------------------------------------------
  const ALL_DEFAULTS = Object.assign({}, Geo.DEFAULTS, Cam.CAM_DEFAULTS);
  const allParams = (src) => Object.assign({}, Geo.normalizeParams(src), Cam.normalizeCamParams(src));

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(allParams(params))); } catch (e) { /* приватный режим */ }
    try {
      const diff = {};
      const np = allParams(params);
      for (const k of Object.keys(ALL_DEFAULTS)) if (np[k] !== ALL_DEFAULTS[k]) diff[k] = np[k];
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
    params = allParams(loaded || {});
  }

  // ---------------------------------------------------------------------
  // Расчёт и сводка
  // ---------------------------------------------------------------------
  function update() {
    model = Geo.computeBellows(params);
    camera = Cam.computeCamera(model, params);
    const cpNorm = Cam.normalizeCamParams(params);
    $('#bed-w').value = cpNorm.camBedW;
    $('#bed-h').value = cpNorm.camBedH;
    save();
    renderSummary();
    renderMessages();
    for (const k of Object.keys(dirty)) dirty[k] = true;
    extValue = null;
    renderActive();
    renderCamMessages();
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
      card('Плашек', d.stiffenerCount, `по ${String(p.tStiff).replace('.', ',')} мм`),
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
    if (activeTab === 'camera') {
      // при смене типа камеры — исходный вид, иначе сохраняем ракурс
      const sameStyle = camera && camera.params.camStyle === lastCamStyle;
      if (camera) lastCamStyle = camera.params.camStyle;
      if (dirty.camera) { dirty.camera = false; renderCamera(sameStyle); }
      return;
    }
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
      diagonal: $('#bed-diag').checked,
    };
  }

  function renderStl() {
    const o = stlOpts();
    const info = $('#stl-info');
    const P = model.pattern;
    if (o.mode === 'bed') {
      const pack = Ex.packStiffeners(P.stiffeners, o.bedW, o.bedH, o.gap, o.margin, { diagonal: o.diagonal });
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
      info.innerHTML = `<b>${P.stiffeners.length}</b> плашек толщиной <b>${String(model.params.tStiff).replace('.', ',')} мм</b> → <b>${n}</b> стол(ов) ${o.bedW}×${o.bedH} мм. ` +
        (pack.diagonalCount ? `Длинных плашек уложено по диагонали: <b>${pack.diagonalCount}</b>. ` : '') +
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
  // Камера
  // ---------------------------------------------------------------------
  const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function renderCamMessages() {
    const el = $('#cam-messages');
    if (!el) return;
    if (!camera) { el.innerHTML = ''; return; }
    el.innerHTML = camera.errors.map((m) => `<div class="msg err">${escHtml(m)}</div>`).join('') +
      camera.warnings.map((m) => `<div class="msg warn">${escHtml(m)}</div>`).join('');
  }

  function ensureCamViewer() {
    if (camViewer) return camViewer;
    try {
      camViewer = new window.BellowsViewer($('#gl-cam'));
      camViewer.cam.yaw = -2.35;
      camViewer.cam.pitch = 0.32;
    } catch (e) {
      $('#tab-camera .canvas-wrap').innerHTML = `<div class="msg err" style="margin:12px">Не удалось запустить 3D: ${escHtml(e.message)}</div>`;
      camViewer = null;
    }
    return camViewer;
  }

  function camBedSize() {
    return [camera.params.camBedW, camera.params.camBedH];
  }

  function buildCamParts() {
    const [W, H] = camBedSize();
    const cp = camera.params;
    const splitKey = `${cp.camSplit}|${W}x${H}`;
    for (const part of camera.parts) {
      if (!part.csg) {
        part.csg = part.build();
        part.printed = part.csg.transform(part.printT);
        part.printBounds = part.printed.bounds();
        part.volume = part.csg.volume();
      }
      if (part.splitKey !== splitKey) {
        part.splitKey = splitKey;
        part.fitAngle = Cam.bedFitAngle(part.printed, W, H);
        const fits = part.fitAngle !== null;
        let pieces = !fits && cp.camSplit ? Cam.splitForBed(part.printed, W, H, cp.camClearance) : null;
        if (pieces && pieces.length < 2) pieces = null;
        part.pieces = pieces;
        part.piecesLocal = pieces ? pieces.map((pc) => pc.transform(Cam.invRot(part.printT))) : null;
        part.fits = pieces ? pieces.every((pc) => Cam.fitsBed(pc, W, H)) : fits;
      }
    }
  }

  /** Файлы STL детали: одна деталь или её части. */
  function camPartFiles(part) {
    const [W, H] = camBedSize();
    if (!part.pieces) return [{ name: `${part.key}_x${part.qty}.stl`, data: camPartSTL(part) }];
    const n = part.pieces.length;
    return part.pieces.map((pc, i) => ({
      name: `${part.key}_part${i + 1}of${n}_x${part.qty}.stl`,
      data: Ex.stlBinary(Cam.layPiece(pc, W, H).toTriangles(), `bellows camera: ${part.key} ${i + 1}/${n}`),
    }));
  }

  function renderCamera(keepCamera) {
    renderCamMessages();
    if (!camera || !camera.ok) {
      $('#cam-summary').innerHTML = '';
      $('#cam-parts').innerHTML = '';
      $('#cam-bom').innerHTML = '';
      if (camViewer) camViewer.setData({ tris: new Float32Array(0), lines: new Float32Array(0) }, true);
      return;
    }
    buildCamParts();
    renderCamSummary();
    renderCamTables();
    renderCamScene(keepCamera);
  }

  function renderCamSummary() {
    const D = camera.dims;
    const count = camera.parts.reduce((s, p) => s + p.qty * (p.pieces ? p.pieces.length : 1), 0);
    const nSplit = camera.parts.filter((p) => p.pieces).length;
    const vol = camera.parts.reduce((s, p) => s + p.qty * p.volume, 0) / 1000;
    if (D.style === 'field') {
      const fb = D.fb;
      $('#cam-summary').innerHTML = [
        card('Сложенная камера', `${Math.round(fb.closed.w)}×${Math.round(fb.closed.h)}×${Math.round(fb.closed.d)}`, 'мм, с задником'),
        card('Растяжение', `${Math.round(fb.eMin)}…${Math.round(fb.eMax)}`, `мм на станине ${Math.round(fb.Lbed)} мм`),
        card('Объектив', `≤ ${fb.lensFold} мм`, 'выступ вперёд, чтобы сложилась'),
        card('Подвижки', `±${camera.params.camFieldRise} мм`, 'подъём и наклон спереди'),
        card('Деталей для печати', count, nSplit ? `${camera.parts.length} видов, ${nSplit} разрезаны на части` : `${camera.parts.length} видов`),
        card('Пластик', `≈ ${Math.round(vol * 1.25 * 0.6)} г`, `объём тел ${Math.round(vol)} см³, заполнение ~40 %`),
      ].join('');
      return;
    }
    $('#cam-summary').innerHTML = [
      card('Ось над рельсом', f1(D.A), 'мм'),
      card('Передняя рамка', `${D.Sf}×${D.Sf}`, `плата ${D.board.w}×${D.board.h}`),
      card('Задняя рамка', `${D.Sr}×${D.Sr}`, `кадр ${D.film[0]}×${D.film[1]}, задник поворотный`),
      card('Рельс', `${D.railL}`, `мм, ${D.rail.name}`),
      card('Деталей для печати', count, nSplit ? `${camera.parts.length} видов, ${nSplit} разрезаны на части` : `${camera.parts.length} видов`),
      card('Пластик', `≈ ${Math.round(vol * 1.25 * 0.6)} г`, `объём тел ${Math.round(vol)} см³, заполнение ~40 %`),
    ].join('');
  }

  function renderCamTables() {
    const [bw, bh] = camBedSize();
    const rows = camera.parts.map((p) => {
      const [sx, sy, sz] = p.printBounds.size;
      let fitCell;
      if (p.pieces) {
        const sizes = p.pieces.map((pc) => { const b = pc.bounds().size; return `${Math.round(b[0])}×${Math.round(b[1])}`; }).join(', ');
        fitCell = `<td class="${p.fits ? 'ok' : 'bad'}">разрезана на ${p.pieces.length} ч.<div class="hint">${sizes}</div></td>`;
      } else {
        const diag = p.fits && p.fitAngle !== 0 && p.fitAngle !== 90;
        fitCell = `<td class="${p.fits ? 'ok' : 'bad'}">${p.fits ? (diag ? 'да, по диагонали' : 'да') : 'не влезает'}</td>`;
      }
      return `<tr><td>${escHtml(p.name)}${p.note ? `<div class="hint">${escHtml(p.note)}</div>` : ''}</td>` +
        `<td class="num">${p.qty}</td><td class="num">${f1(sx)} × ${f1(sy)} × ${f1(sz)}</td>` + fitCell +
        `<td><button type="button" data-action="cam-part" data-part="${p.key}">STL</button></td></tr>`;
    }).join('');
    $('#cam-parts').innerHTML = `<thead><tr><th>Деталь</th><th>Шт.</th><th>Габарит при печати, мм</th><th>Стол ${bw}×${bh}</th><th></th></tr></thead><tbody>${rows}</tbody>`;
    $('#cam-bom').innerHTML = '<thead><tr><th>Покупное</th><th>Шт.</th><th>Где</th></tr></thead><tbody>' +
      camera.hardware.map((h) => `<tr><td>${escHtml(h.name)}</td><td class="num">${h.qty}</td><td>${escHtml(h.note)}</td></tr>`).join('') + '</tbody>';
  }

  function renderCamScene(keepCamera) {
    const v = ensureCamViewer();
    if (!v) return;
    const D = camera.dims;
    const range = $('#cam-ext');
    const lo = Math.ceil(D.eMin), hi = D.eMax;
    range.min = lo;
    range.max = hi;
    if (camExt === null) camExt = Math.round(lo + (hi - lo) * 0.45);
    camExt = Math.max(lo, Math.min(hi, camExt));
    range.value = camExt;
    const isField = D.style === 'field';
    const folded = isField && $('#cv-folded').checked;
    $('#cv-folded-wrap').hidden = !isField;
    $('#cv-rail-wrap').hidden = isField;
    range.disabled = folded;
    $('#cam-ext-out').textContent = folded ? 'сложена' : `${f1(camExt)} мм`;

    const tris = [];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const pushPoly = (vs, col) => {
      let n = [0, 0, 0];
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i], b = vs[(i + 1) % vs.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = n.map((x) => x / l);
      for (const q of vs) for (let i = 0; i < 3; i++) { if (q[i] < min[i]) min[i] = q[i]; if (q[i] > max[i]) max[i] = q[i]; }
      for (let i = 1; i < vs.length - 1; i++) for (const q of [vs[0], vs[i], vs[i + 1]]) tris.push(q[0], q[1], q[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    };
    const holderIn = $('#cv-holder').checked;
    const P = Cam.placements(camera, camExt, folded, { holder: holderIn });
    for (const part of camera.parts) {
      const bodies = part.piecesLocal || [part.csg];
      for (const m of P[part.key] || []) {
        const flip = CSGM.det(m) < 0;
        bodies.forEach((body, bi) => {
          // части составной детали — чуть разными оттенками, чтобы были видны швы
          const k = bodies.length > 1 && bi % 2 ? 0.78 : 1;
          const col = part.color.map((x) => Math.min(1, x * k + (k < 1 ? 0.03 : 0)));
          for (const poly of body.polygons) {
            let vs = poly.vertices.map((q) => CSGM.apply(m, q));
            if (flip) vs = vs.reverse();
            pushPoly(vs, col);
          }
        });
      }
    }
    if ($('#cv-bellows').checked) {
      const o = Cam.bellowsOrigin(camera, camExt, folded);
      const mesh = Geo.buildMesh3D(model, o.e, { stiffOffset: 0 });
      for (const f of mesh.faces) pushPoly(f.quad.map((q) => [q[0], q[1] + o.y, q[2] + o.z]), f.collar ? [0.3, 0.28, 0.26] : [0.17, 0.17, 0.19]);
    }
    // матовое стекло (покупное) — в рамке на плоскости плёнки; кассета — между плитой задника и рамкой
    for (const poly of Cam.groundGlassDummy(camera, camExt, folded, { holder: holderIn }).polygons) pushPoly(poly.vertices, [0.8, 0.82, 0.84]);
    if (holderIn) {
      const h = Cam.holderDummy(camera, camExt, folded);
      for (const poly of h.body.polygons) pushPoly(poly.vertices, [0.1, 0.1, 0.11]);
      for (const poly of h.flap.polygons) pushPoly(poly.vertices, [0.55, 0.12, 0.1]);
    }
    if ($('#cv-fx').checked) {
      // покупной крепёж на своих местах: болты, винты, шайбы, гайки
      for (const x of Cam.fastenerLayout(camera, camExt, folded, { holder: holderIn })) {
        if (!x.len) continue;
        const S = Cam.fastenerSolids(x);
        for (const [k, body] of Object.entries(S)) {
          const col = k === 'nut' || k === 'washer' ? [0.62, 0.64, 0.68] : [0.78, 0.8, 0.83];
          for (const poly of body.polygons) pushPoly(poly.vertices, col);
        }
      }
    }
    if ($('#cv-lens').checked) {
      // условный объектив — показывает, помещается ли он в сложенную коробку
      for (const poly of Cam.lensDummy(camera, camExt, folded).polygons) pushPoly(poly.vertices, [0.08, 0.08, 0.09]);
    }
    if (!isField && $('#cv-rail').checked) {
      if (!camera.railCsg) camera.railCsg = Cam.railCSG(D);
      for (const poly of camera.railCsg.polygons) pushPoly(poly.vertices, [0.74, 0.76, 0.8]);
    }
    const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
    const radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.6;
    v.setData({ tris: new Float32Array(tris), lines: new Float32Array(0), center, radius }, keepCamera);
  }

  function camPartSTL(part) {
    const [W, H] = camBedSize();
    return Ex.stlBinary(Cam.layPiece(part.printed, W, H).toTriangles(), `bellows camera: ${part.key}`);
  }

  function camZip() {
    buildCamParts();
    const files = [];
    camera.parts.forEach((p, i) => {
      for (const f of camPartFiles(p)) files.push({ name: `camera/${String(i + 1).padStart(2, '0')}_${f.name}`, data: f.data });
    });
    const split = camera.parts.filter((p) => p.pieces).map((p) => ({ name: p.name, n: p.pieces.length }));
    files.push({ name: 'README.txt', data: Cam.assemblyText(camera, model, split).replace(/\n/g, '\r\n') });
    files.push({ name: 'params.json', data: JSON.stringify(allParams(params), null, 2) });
    files.push({ name: 'bellows/pattern.svg', data: Ex.patternSVG(model) });
    files.push({ name: 'bellows/pattern.dxf', data: Ex.dxfPattern(model) });
    files.push({ name: 'bellows/drawing.svg', data: Ex.drawingSVG(model) });
    for (const f of Ex.stiffenerFiles(model, stlOpts())) files.push({ name: 'bellows/stiffeners/' + f.name, data: f.data });
    return Ex.makeZip(files);
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
    'cam-part': (btn) => {
      const part = camera && camera.ok && camera.parts.find((p) => p.key === btn.dataset.part);
      if (!part) return;
      buildCamParts();
      const files = camPartFiles(part);
      if (files.length === 1) download(files[0].name, files[0].data, 'model/stl');
      else download(`${part.key}_parts.zip`, Ex.makeZip(files), 'application/zip');
    },
    'cam-zip': (btn) => {
      if (!camera || !camera.ok) return;
      const old = btn.textContent;
      btn.textContent = 'Собираю архив…';
      btn.disabled = true;
      setTimeout(() => {
        try {
          download(`camera_${camera.params.camFormat}_${baseName()}.zip`, camZip(), 'application/zip');
        } finally {
          btn.textContent = old;
          btn.disabled = false;
        }
      }, 30);
    },
    'cam-png': () => {
      if (!camViewer) return;
      camViewer.render();
      $('#gl-cam').toBlob((b) => b && download(`camera_${camera.params.camFormat}_3d.png`, b));
    },
    'cam-view-reset': () => camViewer && camViewer.resetView(),
    'stl-export': () => {
      const o = stlOpts();
      const files = Ex.stiffenerFiles(model, o);
      const stls = files.filter((f) => f.name.endsWith('.stl'));
      if (stls.length === 1 && o.mode === 'pattern') {
        download(`${baseName()}_stiffeners_t${model.params.tStiff}.stl`, stls[0].data, 'model/stl');
      } else {
        download(`${baseName()}_stiffeners_${o.mode}_t${model.params.tStiff}.zip`, Ex.makeZip(files), 'application/zip');
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
      if (fn) fn(btn);
    });
    for (const id of ['#drawing-view', '#pattern-view', '#stl-view']) attachPanZoom($(id));
    for (const id of ['#pat-stiff', '#pat-labels', '#print-paper']) $(id).addEventListener('change', () => { dirty.pattern = true; renderActive(); });
    for (const id of ['#stl-mode', '#bed-w', '#bed-h', '#bed-gap', '#bed-diag']) $(id).addEventListener('change', () => { dirty.stl = true; renderActive(); });
    for (const id of ['#v-fabric', '#v-stiff', '#v-edges']) $(id).addEventListener('change', () => model && model.ok && render3D(true));
    for (const id of ['#cv-bellows', '#cv-rail', '#cv-folded', '#cv-lens', '#cv-holder', '#cv-fx']) $(id).addEventListener('change', () => camera && camera.ok && renderCamScene(true));
    $('#cam-ext').addEventListener('input', (e) => {
      camExt = Number(e.target.value);
      if (camera && camera.ok) renderCamScene(true);
    });
    // размер стола общий для плашек и деталей камеры
    for (const [id, key] of [['#bed-w', 'camBedW'], ['#bed-h', 'camBedH']]) {
      $(id).addEventListener('change', (e) => { params[key] = e.target.value; fillForm(); update(); });
    }
    $('#ext-range').addEventListener('input', (e) => {
      extValue = Number(e.target.value);
      if (model && model.ok) render3D(true);
    });

    $('#btn-reset').addEventListener('click', () => {
      params = Object.assign({}, ALL_DEFAULTS);
      $('#preset').value = '';
      fillForm();
      update();
    });
    $('#btn-save-json').addEventListener('click', () => {
      download('bellows_params.json', JSON.stringify(allParams(params), null, 2), 'application/json');
    });
    $('#file-json').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((txt) => {
        try {
          params = allParams(JSON.parse(txt));
          fillForm();
          update();
        } catch (err) {
          alert('Не удалось прочитать файл параметров: ' + err.message);
        }
      });
      e.target.value = '';
    });
    window.addEventListener('afterprint', () => { $('#print-area').innerHTML = ''; });
    // ссылка с параметрами, открытая в уже загруженной вкладке, — перечитать параметры
    window.addEventListener('hashchange', () => { load(); fillForm(); update(); });
    update();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
