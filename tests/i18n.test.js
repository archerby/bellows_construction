'use strict';
// Словари языков: те же ключи, что в русском, те же подстановки {…}; все ключи, которые использует код, есть.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('../js/i18n.js');

const ru = I18n.dicts.ru;
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const ROOT = path.join(__dirname, '..');

test('код использует только ключи из словаря', () => {
  const src = ['js/app.js', 'js/geometry.js', 'js/exporters.js', 'js/camera.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/\btr?\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\btr?\([a-zA-Z.]+ \? '([a-zA-Z0-9_.]+)' : '([a-zA-Z0-9_.]+)'/g)) { keys.add(m[1]); keys.add(m[2]); }
  for (const m of html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) keys.add(m[1]);
  // составные ключи формы: field.<ключ>, hint.<ключ>, opt.<ключ>.<значение>
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  for (const m of app.matchAll(/\{ key: '(\w+)'([^}]*)\}/g)) {
    keys.add('field.' + m[1]);
    if (/hint: true/.test(m[2])) keys.add('hint.' + m[1]);
    const opts = m[2].match(/options: \[([^\]]+)\]/);
    if (opts && !/optLabel/.test(m[2])) for (const v of opts[1].match(/'[^']+'/g)) keys.add(`opt.${m[1]}.${v.slice(1, -1)}`);
  }
  for (const m of app.matchAll(/pair: \['(\w+)'/g)) keys.add('field.' + m[1]);
  for (const m of app.matchAll(/legend: '(\w+)'/g)) keys.add('legend.' + m[1]);
  for (const m of app.matchAll(/'(\w+)': \{ frontW/g)) keys.add('preset.' + m[1]);
  for (const x of ['A', 'B', 'C', 'D']) keys.add('panel.' + x);
  for (const x of ['frontW', 'frontH', 'rearW', 'rearH', 'maxExt', 'pitch', 'tStiff', 'collarF', 'collarR', 'hingeGap', 'cornerGap', 'flap', 'tOuter', 'tLining', 'reserve']) keys.add('geo.param.' + x);
  for (const x of require('../js/camera.js').FX_KEYS) keys.add('fx.' + x);
  for (const x of ['tilt', 'pivot', 'feet', 'hinge']) keys.add('hw.w.' + x);
  const missing = [...keys].filter((k) => !k.endsWith('.') && !(k in ru));
  assert.deepEqual(missing, []);
});

for (const { code } of I18n.LANGS) {
  test(`[${code}] словарь полный, подстановки совпадают`, () => {
    const d = I18n.dicts[code];
    const missing = Object.keys(ru).filter((k) => !(k in d));
    const extra = Object.keys(d).filter((k) => !(k in ru));
    assert.deepEqual(missing, [], 'нет ключей');
    assert.deepEqual(extra, [], 'лишние ключи');
    for (const k of Object.keys(ru)) {
      assert.equal(typeof d[k], 'string', k);
      assert.ok(d[k].trim().length > 0, k + ': пусто');
      assert.equal(ph(d[k]), ph(ru[k]), k + ': подстановки {…} не совпадают');
    }
    if (code === 'en' || code === 'pl') {
      const cyr = Object.keys(d).filter((k) => /[А-Яа-яЁёІіЇїЄєЎў]/.test(d[k]));
      assert.deepEqual(cyr, [], 'кириллица в латинском словаре');
    }
  });
}

test('язык браузера и числа', () => {
  assert.equal(I18n.detect(['be-BY', 'ru']), 'be');
  assert.equal(I18n.detect(['de-DE']), 'en');
  assert.equal(I18n.detect(['uk']), 'uk');
  const was = I18n.getLang();
  I18n.setLang('en'); assert.equal(I18n.num(41.6), '41.6');
  I18n.setLang('pl'); assert.equal(I18n.num(41.6), '41,6');
  I18n.setLang(was);
});

test('экспорт на английском и польском — без русских строк (ничего не забыто в коде)', () => {
  const G = require('../js/geometry.js'), C = require('../js/camera.js'), Ex = require('../js/exporters.js');
  const was = I18n.getLang();
  try {
    for (const code of ['en', 'pl']) {
      I18n.setLang(code);
      const cyr = /[А-Яа-яЁё]/;
      for (const [b, c] of [[{ rearW: 100, rearH: 100 }, {}], [{ maxExt: 400 }, { camStyle: 'field', camRailLength: 100 }]]) {
        const bm = G.computeBellows(b);
        const cam = C.computeCamera(bm, c);
        const texts = [
          C.assemblyText(cam, bm, [{ name: cam.parts[0].name, n: 2 }]),
          Ex.drawingSVG(bm), Ex.patternSVG(bm), Ex.printTilesHTML(bm, { paper: 'A4' }).html,
          ...Ex.stiffenerFiles(bm, { mode: 'bed' }).filter((f) => /\.(txt|svg)$/.test(f.name)).map((f) => f.data),
          ...bm.warnings, ...cam.warnings,
          ...Object.values(C.STYLES).map((x) => x.name), ...Object.values(C.BOARDS).map((x) => x.name), ...Object.values(C.RAILS).map((x) => x.name),
        ];
        for (const tx of texts) assert.ok(!cyr.test(tx), `${code}: ${String(tx).match(/.{0,40}[А-Яа-яЁё].{0,40}/)}`);
      }
      assert.ok(!cyr.test(G.computeBellows({ pitch: 0 }).errors.join(' ')));
    }
  } finally { I18n.setLang(was); }
});
