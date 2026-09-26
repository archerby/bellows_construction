/*
 * Локализация: словари по языкам (js/lang/*.js), t('ключ', {параметры}), числа с десятичным разделителем языка.
 * Работает в браузере (window.BellowsI18n, словари подключаются отдельными <script> после этого файла) и в Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    for (const l of api.LANGS) api.register(l.code, require(`./lang/${l.code}.js`));
  } else root.BellowsI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LANGS = [
    { code: 'en', name: 'English', decimal: '.' },
    { code: 'pl', name: 'Polski', decimal: ',' },
    { code: 'be', name: 'Беларуская', decimal: ',' },
    { code: 'uk', name: 'Українська', decimal: ',' },
    { code: 'ru', name: 'Русский', decimal: ',' },
  ];
  const dicts = {};
  let lang = 'ru';

  function register(code, dict) { dicts[code] = dict; }
  function setLang(code) { if (LANGS.some((l) => l.code === code)) lang = code; return lang; }
  const getLang = () => lang;

  /** Строка по ключу с подстановкой {имя}; если в языке нет — английская, затем русская, затем сам ключ. */
  function t(key, params) {
    let s = dicts[lang] && dicts[lang][key];
    if (s === undefined) s = (dicts.en && dicts.en[key]) !== undefined ? dicts.en[key] : dicts.ru && dicts.ru[key];
    if (s === undefined) return key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
    return s;
  }
  const has = (key) => !!(dicts[lang] && dicts[lang][key] !== undefined);

  /** Число с десятичным разделителем языка: digits — знаков после запятой (без — как есть). */
  function num(x, digits) {
    const s = digits === undefined ? String(Math.round(x * 1000) / 1000) : (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits);
    const dec = (LANGS.find((l) => l.code === lang) || LANGS[0]).decimal;
    return dec === '.' ? s : s.replace('.', dec);
  }

  /** Язык браузера → один из поддерживаемых (белорусский, украинский, польский, русский), иначе английский. */
  function detect(list) {
    for (const x of list || []) {
      const c = String(x).toLowerCase().slice(0, 2);
      if (LANGS.some((l) => l.code === c)) return c;
    }
    return 'en';
  }

  /** Перенос абзаца по ширине width с отступом indent (для текстовых README). */
  const GLUE_PREV = /^(мм|mm|%|м²|m²|см³|cm³|г|g|°)[.,:;)]*$|^[—–]/; // не отрывать единицы и тире от предыдущего слова
  const GLUE_NEXT = /^(≈|±|~|×|→)$/; // и знаки — от следующего
  function wrap(text, width, indent) {
    const pad = indent || '';
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = [];
      for (const w of para.split(/ +/)) {
        if (words.length && (GLUE_PREV.test(w) || GLUE_NEXT.test(words[words.length - 1].split(' ').pop()))) words[words.length - 1] += ' ' + w;
        else words.push(w);
      }
      let line = '';
      for (const w of words) {
        if (line && (pad + line + ' ' + w).length > width) { out.push(pad + line); line = w; }
        else line = line ? line + ' ' + w : w;
      }
      out.push(pad + line);
    }
    return out;
  }

  return { LANGS, register, setLang, getLang, t, has, num, detect, wrap, dicts };
});
