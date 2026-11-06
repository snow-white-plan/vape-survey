(function () {
  const TABLES = ["questions", "options", "settings", "sessions"];

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const s = text.replace(/^﻿/, "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        quoted = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    const header = (rows.shift() || []).map((h) => h.trim());
    return rows
      .filter((r) => r.some((v) => v.trim() !== ""))
      .map((r) => {
        const o = {};
        header.forEach((h, i) => {
          if (h) o[h] = r[i] === undefined ? "" : r[i];
        });
        return o;
      });
  }

  function str(v) {
    return v === undefined || v === null ? "" : String(v).trim();
  }

  function bool(v) {
    return /^(true|1|y|yes|是)$/i.test(str(v));
  }

  function num(v) {
    const s = str(v);
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function normalize(raw) {
    const questions = (raw.questions || [])
      .map((q) => ({
        id: str(q.id),
        page: num(q.page) || 0,
        prepost: bool(q.prepost),
        type: str(q.type).toLowerCase() || "single",
        option_set: str(q.option_set),
        required: bool(q.required),
        min: num(q.min),
        max: num(q.max),
        zh_text: str(q.zh_text),
        en_text: str(q.en_text),
        hint_zh: str(q.hint_zh),
        hint_en: str(q.hint_en),
        unit_zh: str(q.unit_zh),
        unit_en: str(q.unit_en),
        correct_answer: str(q.correct_answer),
        reveal: bool(q.reveal),
        explain_zh: str(q.explain_zh),
        explain_en: str(q.explain_en),
        order: num(q.order) || 0,
        active: str(q.active) === "" ? true : bool(q.active)
      }))
      .filter((q) => q.id && q.active)
      .sort((a, b) => a.page - b.page || a.order - b.order);

    const options = {};
    (raw.options || []).forEach((o) => {
      const set = str(o.set);
      if (!set) return;
      (options[set] = options[set] || []).push({
        value: str(o.value),
        zh_label: str(o.zh_label),
        en_label: str(o.en_label),
        order: num(o.order) || 0,
        has_other: bool(o.has_other)
      });
    });
    Object.keys(options).forEach((k) => options[k].sort((a, b) => a.order - b.order));

    const settings = {};
    (raw.settings || []).forEach((s) => {
      const k = str(s.key);
      if (k) settings[k] = str(s.value);
    });

    const sessions = (raw.sessions || [])
      .map((s) => ({ code: str(s.code), name: str(s.name), active: str(s.active) === "" ? true : bool(s.active) }))
      .filter((s) => s.code);

    return { questions, options, settings, sessions };
  }

  async function fetchText(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadFromSheet(cfg) {
    const urls = cfg.sheetCsv || {};
    if (!TABLES.every((t) => urls[t])) throw new Error("sheet not configured");
    const texts = await Promise.all(TABLES.map((t) => fetchText(urls[t], cfg.loadTimeoutMs || 8000)));
    const raw = {};
    TABLES.forEach((t, i) => {
      raw[t] = parseCsv(texts[i]);
    });
    const data = normalize(raw);
    if (!data.questions.length) throw new Error("no questions");
    return data;
  }

  async function loadFromFallback(cfg) {
    const text = await fetchText(cfg.fallbackUrl, cfg.loadTimeoutMs || 8000);
    return normalize(JSON.parse(text));
  }

  async function load(cfg) {
    try {
      const data = await loadFromSheet(cfg);
      data.source = "sheet";
      return data;
    } catch (e) {
      const data = await loadFromFallback(cfg);
      data.source = "fallback";
      return data;
    }
  }

  window.SurveyData = { load, parseCsv, normalize };
})();
