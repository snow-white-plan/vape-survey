(function () {
  const CFG = window.SURVEY_CONFIG;
  const STORE_KEY = "ecig_survey_state_v1";
  const QUEUE_KEY = "ecig_survey_queue_v1";
  const TOTAL_PAGES = 5;
  const PAGE_ICONS = ["🙋", "🧠", "🎬", "💪", "💬"];

  const UI = {
    zh: {
      loading: "載入中…",
      loadError: "問卷載入失敗，請檢查網路後重新整理頁面。",
      step: (n) => `第 ${n} / ${TOTAL_PAGES} 步`,
      next: "下一步",
      submit: "送出",
      start: "開始填答",
      required: "此題為必填",
      requiredNote: " 為必填題",
      otherRequired: "請填寫「其他」的內容",
      numberRange: (min, max) => `請輸入 ${min} 到 ${max} 之間的整數`,
      consent: "我已閱讀上述說明，同意參加",
      consentRequired: "請勾選同意後再繼續",
      videoHint: "請完整觀看影片後，再進入下一步。",
      videoDone: "影片已看完，可以進入下一步。",
      videoError: "影片無法播放，請點下一步繼續。",
      revealTitle: "答案揭曉",
      correctAnswer: "正確答案",
      yourPre: "您的前測答案",
      yourPost: "您的後測答案",
      noAnswer: "未作答",
      done: "完成",
      restart: "開始新的填答",
      restartConfirm: "確定要開始新的填答嗎？",
      statusPending: (n) => `資料上傳中（${n}）…`,
      statusRetry: (n) => `網路不穩，將自動重試（尚有 ${n} 筆）`,
      statusSaved: "資料已上傳",
      statusLocal: "測試模式：尚未設定上傳網址，資料僅暫存於本機",
      langBtn: "EN"
    },
    en: {
      loading: "Loading…",
      loadError: "Failed to load the survey. Please check your connection and reload.",
      step: (n) => `Step ${n} of ${TOTAL_PAGES}`,
      next: "Next",
      submit: "Submit",
      start: "Start",
      required: "This question is required",
      requiredNote: " Required",
      otherRequired: "Please specify \"Other\"",
      numberRange: (min, max) => `Please enter a whole number from ${min} to ${max}`,
      consent: "I have read the information above and agree to take part",
      consentRequired: "Please tick the box to continue",
      videoHint: "Please watch the whole video before moving on.",
      videoDone: "Video finished. You can continue.",
      videoError: "The video cannot be played. Tap Next to continue.",
      revealTitle: "Answer",
      correctAnswer: "Correct answer",
      yourPre: "Your pre-test answer",
      yourPost: "Your post-test answer",
      noAnswer: "No answer",
      done: "Finish",
      restart: "Start a new response",
      restartConfirm: "Start a new response?",
      statusPending: (n) => `Uploading (${n})…`,
      statusRetry: (n) => `Connection unstable, retrying automatically (${n} left)`,
      statusSaved: "Responses uploaded",
      statusLocal: "Test mode: no upload URL configured, data kept on this device only",
      langBtn: "中文"
    }
  };

  let db = null;
  let state = null;
  let flushing = false;
  let retryTimer = null;
  let retryDelay = 1000;
  let lastError = false;

  const app = document.getElementById("app");
  const langBtn = document.getElementById("langBtn");
  const brand = document.getElementById("brand");
  const progressBar = document.getElementById("progressBar");
  const statusEl = document.getElementById("status");
  const params = new URLSearchParams(location.search);

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function store(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function saveState() {
    store(STORE_KEY, state);
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function ui() {
    return UI[state.lang] || UI.zh;
  }

  function txt(row, field) {
    return row[`${state.lang}_${field}`] || row[`${field}_${state.lang}`] || row[`zh_${field}`] || row[`${field}_zh`] || "";
  }

  function setting(key) {
    const s = db.settings;
    return s[`${key}_${state.lang}`] || s[`${key}_zh`] || s[key] || "";
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === false || v === null || v === undefined) return;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function seconds(start) {
    return Math.round((Date.now() - start) / 100) / 10;
  }

  function resolveSession() {
    const raw = (params.get("s") || "").trim();
    const hit = db.sessions.find((s) => s.active && s.code === raw);
    return { session: hit ? hit.code.slice(0, 64) : CFG.defaultSession, sessionRaw: raw.replace(/[\u0000-\u001f]/g, "").slice(0, 64) };
  }

  function langParam() {
    const p = (params.get("lang") || "").trim().toLowerCase();
    if (/^en/.test(p)) return "en";
    if (/^(zh|tw|ch|cht|tc)/.test(p)) return "zh";
    return "";
  }

  function initialLang() {
    return langParam() || "zh";
  }

  function newState(lang) {
    const s = resolveSession();
    return {
      pairId: uuid(),
      session: s.session,
      sessionRaw: s.sessionRaw,
      lang: lang || initialLang(),
      page: 1,
      answers: {},
      starts: {},
      preSeconds: null,
      postSeconds: null,
      videoCompleted: 0,
      startedAt: new Date().toISOString()
    };
  }

  function pageItems(p) {
    const qs = db.questions;
    const mirror = (suffix) => qs.filter((q) => q.prepost).map((q) => ({ ...q, key: `${q.id}${suffix}` }));
    if (p === 2) return mirror("_pre");
    if (p === 4) return [...mirror("_post"), ...qs.filter((q) => !q.prepost && q.page === 4).map((q) => ({ ...q, key: q.id }))];
    return qs.filter((q) => !q.prepost && q.page === p).map((q) => ({ ...q, key: q.id }));
  }

  function optionsFor(q) {
    return db.options[q.option_set] || [];
  }

  function optionLabel(q, value) {
    const o = optionsFor(q).find((x) => x.value === value);
    return o ? txt(o, "label") : "";
  }

  function setAnswer(key, value) {
    state.answers[key] = value;
    saveState();
  }

  function renderHeading(q) {
    const lines = txt(q, "text").split("\n");
    return el("div", { class: "q-heading" }, el("h3", {}, lines[0]), lines.length > 1 ? el("p", {}, lines.slice(1).join("\n")) : null);
  }

  function renderSingle(q) {
    const name = q.key;
    const otherKey = `${q.key}_other`;
    const isScale = /^likert/i.test(q.option_set);
    const box = el("div", { class: isScale ? "options scale" : "options", role: "radiogroup" });
    optionsFor(q).forEach((o) => {
      const id = `${name}__${o.value}`;
      const input = el("input", {
        type: "radio",
        name,
        id,
        value: o.value,
        checked: state.answers[name] === o.value,
        onchange: () => {
          setAnswer(name, o.value);
          box.querySelectorAll(".other-input").forEach((n) => {
            n.hidden = n.dataset.for !== o.value;
          });
          clearError(name);
        }
      });
      const text = txt(o, "label");
      const content = isScale
        ? [el("span", { class: "scale-num" }, o.value), el("span", { class: "scale-text" }, text.replace(/^\d+\s*/, ""))]
        : [el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "opt-text" }, text)];
      const label = el("label", { class: `opt${isScale ? ` lv${o.value}` : ""}`, for: id }, input, content);
      box.append(label);
      if (o.has_other) {
        const other = el("input", {
          type: "text",
          class: "other-input",
          "data-for": o.value,
          maxlength: "100",
          value: state.answers[otherKey] || "",
          "aria-label": txt(o, "label"),
          oninput: (e) => {
            setAnswer(otherKey, e.target.value);
            clearError(name);
          }
        });
        other.hidden = state.answers[name] !== o.value;
        box.append(other);
      }
    });
    return box;
  }

  function renderNumber(q) {
    const unit = txt(q, "unit");
    const input = el("input", {
      type: "number",
      inputmode: "numeric",
      class: "num-input",
      min: q.min === null ? false : String(q.min),
      max: q.max === null ? false : String(q.max),
      step: "1",
      value: state.answers[q.key] || "",
      oninput: (e) => {
        setAnswer(q.key, e.target.value.trim());
        clearError(q.key);
      }
    });
    return el("div", { class: "num-row" }, input, unit ? el("span", { class: "unit" }, unit) : null);
  }

  function renderText(q) {
    const area = el("textarea", {
      class: "text-input",
      rows: "4",
      maxlength: "500",
      oninput: (e) => {
        setAnswer(q.key, e.target.value);
        clearError(q.key);
      }
    });
    area.value = state.answers[q.key] || "";
    return area;
  }

  function renderQuestion(q) {
    if (q.type === "heading") return renderHeading(q);
    const body = q.type === "number" ? renderNumber(q) : q.type === "text" ? renderText(q) : renderSingle(q);
    return el(
      "fieldset",
      { class: "q", "data-key": q.key },
      el("legend", {}, q.required ? el("span", { class: "req", title: ui().required }, "*") : null, txt(q, "text")),
      txt(q, "hint") ? el("p", { class: "hint" }, txt(q, "hint")) : null,
      body,
      el("p", { class: "err", hidden: true, role: "alert" })
    );
  }

  function showError(key, msg) {
    const box = app.querySelector(`[data-key="${key}"]`);
    if (!box) return;
    box.classList.add("invalid");
    const e = box.querySelector(".err");
    e.textContent = msg;
    e.hidden = false;
  }

  function clearError(key) {
    const box = app.querySelector(`[data-key="${key}"]`);
    if (!box) return;
    box.classList.remove("invalid");
    box.querySelector(".err").hidden = true;
  }

  function validate(items) {
    let first = null;
    items.forEach((q) => {
      if (q.type === "heading") return;
      const v = state.answers[q.key];
      const empty = v === undefined || v === null || String(v).trim() === "";
      let msg = "";
      if (empty) {
        if (q.required) msg = ui().required;
      } else if (q.type === "number") {
        const n = Number(v);
        const min = q.min === null ? -Infinity : q.min;
        const max = q.max === null ? Infinity : q.max;
        if (!Number.isInteger(n) || n < min || n > max) msg = ui().numberRange(q.min ?? "", q.max ?? "");
      } else if (q.type === "single") {
        const o = optionsFor(q).find((x) => x.value === v);
        if (o && o.has_other && q.required && !(state.answers[`${q.key}_other`] || "").trim()) msg = ui().otherRequired;
      }
      if (msg) {
        showError(q.key, msg);
        if (!first) first = q.key;
      }
    });
    if (first) {
      const node = app.querySelector(`[data-key="${first}"]`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return !first;
  }

  function collect(items) {
    const data = {};
    items.forEach((q) => {
      if (q.type === "heading") return;
      const v = state.answers[q.key];
      data[q.key] = v === undefined ? "" : v;
      if (q.type === "single" && optionsFor(q).some((o) => o.has_other)) {
        const o = optionsFor(q).find((x) => x.value === v);
        data[`${q.key}_other`] = o && o.has_other ? state.answers[`${q.key}_other`] || "" : "";
      }
    });
    return data;
  }

  function pageShell(p, ...content) {
    const stepper = el(
      "ol",
      { class: "stepper", "aria-label": ui().step(p) },
      [1, 2, 3, 4, 5].map((i) =>
        el(
          "li",
          { class: i < p ? "is-done" : i === p ? "is-current" : "", "aria-current": i === p ? "step" : false },
          el("span", { class: "step-icon", "aria-hidden": "true" }, i < p ? "✓" : PAGE_ICONS[i - 1]),
          el("span", { class: "step-name" }, setting(`page${i}_title`))
        )
      )
    );
    const hasRequired = p === 1 || pageItems(p).some((q) => q.required && q.type !== "heading");
    const nodes = [
      stepper,
      el(
        "div",
        { class: "page-head" },
        el("span", { class: "page-emoji", "aria-hidden": "true" }, PAGE_ICONS[p - 1]),
        el("div", {}, el("p", { class: "step" }, ui().step(p)), el("h2", { class: "page-title" }, setting(`page${p}_title`)))
      ),
      setting(`page${p}_intro`) ? el("p", { class: "intro" }, setting(`page${p}_intro`)) : null,
      hasRequired ? el("p", { class: "req-note" }, el("span", { class: "req" }, "*"), ui().requiredNote) : null,
      ...content
    ];
    app.replaceChildren(...nodes.flat().filter(Boolean));
    app.classList.remove("enter");
    void app.offsetWidth;
    app.classList.add("enter");
    window.scrollTo(0, 0);
  }

  function goTo(p) {
    state.page = p;
    saveState();
    render();
  }

  function renderPage1() {
    const items = pageItems(1);
    const consentErr = el("p", { class: "err", hidden: true, role: "alert" });
    const consentBox = el(
      "div",
      { class: "consent", "data-key": "consent" },
      el("p", { class: "consent-text" }, setting("consent")),
      el(
        "label",
        { class: "opt check" },
        el("input", {
          type: "checkbox",
          checked: state.answers.consent === "1",
          onchange: (e) => {
            setAnswer("consent", e.target.checked ? "1" : "");
            consentErr.hidden = true;
          }
        }),
        el("span", { class: "opt-text" }, el("span", { class: "req" }, "*"), ui().consent)
      ),
      consentErr
    );
    pageShell(
      1,
      consentBox,
      items.map(renderQuestion),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => {
            let ok = validate(items);
            if (state.answers.consent !== "1") {
              consentErr.textContent = ui().consentRequired;
              consentErr.hidden = false;
              if (ok) consentBox.scrollIntoView({ behavior: "smooth", block: "center" });
              ok = false;
            }
            if (ok) goTo(2);
          }
        },
        ui().next
      )
    );
  }

  function renderPrePost(p) {
    const items = pageItems(p);
    const startKey = `p${p}`;
    if (!state.starts[startKey]) {
      state.starts[startKey] = Date.now();
      saveState();
    }
    pageShell(
      p,
      items.map(renderQuestion),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => {
            if (!validate(items)) return;
            const secs = seconds(state.starts[startKey]);
            if (p === 2) {
              state.preSeconds = secs;
              const data = { consent: state.answers.consent || "", ...collect(pageItems(1)), ...collect(items), pre_duration: secs };
              enqueue("pre", data);
              goTo(3);
            } else {
              state.postSeconds = secs;
              const data = { video_completed: state.videoCompleted, ...collect(items), post_duration: secs };
              enqueue("post", data);
              goTo(5);
            }
          }
        },
        ui().next
      )
    );
  }

  function renderVideo() {
    const hint = el("p", { class: "video-hint" }, state.videoCompleted ? ui().videoDone : ui().videoHint);
    const next = el("button", { class: "btn", type: "button", disabled: !state.videoCompleted, onclick: () => goTo(4) }, ui().next);
    const video = el("video", {
      class: "video",
      controls: true,
      playsinline: true,
      preload: "auto",
      poster: setting("video_poster") || false
    });
    video.src = setting("video_url");
    const sub = setting("video_subtitle");
    if (sub) {
      video.append(el("track", { kind: "subtitles", src: sub, srclang: state.lang === "en" ? "en" : "zh-Hant", label: state.lang === "en" ? "English" : "中文", default: true }));
    }
    let maxWatched = 0;
    video.addEventListener("timeupdate", () => {
      if (!video.seeking && video.currentTime > maxWatched) maxWatched = video.currentTime;
    });
    video.addEventListener("seeking", () => {
      if (!state.videoCompleted && video.currentTime > maxWatched + 1) video.currentTime = maxWatched;
    });
    video.addEventListener("ended", () => {
      state.videoCompleted = 1;
      saveState();
      hint.textContent = ui().videoDone;
      next.disabled = false;
    });
    video.addEventListener("error", () => {
      hint.textContent = ui().videoError;
      next.disabled = false;
    });
    pageShell(3, el("div", { class: "video-wrap" }, video), hint, next);
  }

  function renderReveal() {
    const items = db.questions.filter((q) => q.prepost && q.reveal && q.correct_answer);
    if (!items.length) return null;
    return el(
      "section",
      { class: "reveal" },
      el("h3", {}, ui().revealTitle),
      items.map((q) => {
        const pre = state.answers[`${q.id}_pre`];
        const post = state.answers[`${q.id}_post`];
        const mark = (v) => (v === q.correct_answer ? "✓" : "✗");
        const line = (label, v) =>
          el("li", { class: v === q.correct_answer ? "ok" : "ng" }, `${label}：${v ? optionLabel(q, v) : ui().noAnswer} ${v ? mark(v) : ""}`);
        return el(
          "div",
          { class: "reveal-item" },
          el("p", { class: "reveal-q" }, txt(q, "text")),
          el("p", { class: "reveal-a" }, `${ui().correctAnswer}：${optionLabel(q, q.correct_answer)}`),
          txt(q, "explain") ? el("p", { class: "reveal-x" }, txt(q, "explain")) : null,
          el("ul", {}, line(ui().yourPre, pre), line(ui().yourPost, post))
        );
      })
    );
  }

  function renderPage5() {
    const items = pageItems(5);
    pageShell(
      5,
      renderReveal(),
      items.map(renderQuestion),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => {
            if (!validate(items)) return;
            enqueue("feedback", collect(items));
            state = { pairId: state.pairId, lang: state.lang, page: 6, done: true };
            saveState();
            render();
          }
        },
        items.length ? ui().submit : ui().done
      )
    );
  }

  function renderDone() {
    app.replaceChildren(
      el(
        "section",
        { class: "done" },
        el(
          "div",
          { class: "confetti", "aria-hidden": "true" },
          Array.from({ length: 24 }, (_, i) => el("i", { style: `--i:${i};--x:${(i * 37) % 100}%;--d:${(i % 5) * 0.15}s` }))
        ),
        el("div", { class: "done-icon", "aria-hidden": "true" }, "🏆"),
        el("h2", {}, setting("completion")),
        el(
          "button",
          {
            class: "btn ghost",
            type: "button",
            onclick: () => {
              if (!confirm(ui().restartConfirm)) return;
              state = newState(state.lang);
              saveState();
              render();
            }
          },
          ui().restart
        )
      )
    );
    window.scrollTo(0, 0);
  }

  function render() {
    document.documentElement.lang = state.lang === "en" ? "en" : "zh-Hant";
    document.title = setting("title");
    brand.textContent = setting("title");
    langBtn.textContent = ui().langBtn;
    progressBar.style.width = `${(Math.min(state.page, TOTAL_PAGES + 1) - 1) / TOTAL_PAGES * 100}%`;
    if (state.page === 1) renderPage1();
    else if (state.page === 2) renderPrePost(2);
    else if (state.page === 3) renderVideo();
    else if (state.page === 4) renderPrePost(4);
    else if (state.page === 5) renderPage5();
    else renderDone();
    updateStatus();
  }

  function enqueue(stage, data) {
    const hp = document.getElementById("hp");
    const queue = load(QUEUE_KEY, []);
    queue.push({
      submission_id: uuid(),
      pair_id: state.pairId,
      stage,
      session: state.session,
      session_raw: state.sessionRaw,
      lang: state.lang,
      questions_version: db.settings.questions_version || "",
      client_time: new Date().toISOString(),
      user_agent: (navigator.userAgent || "").slice(0, 300),
      website: hp ? hp.value : "",
      data
    });
    store(QUEUE_KEY, queue);
    flush();
  }

  function scheduleRetry() {
    if (retryTimer) return;
    const delay = retryDelay + Math.random() * 1000;
    retryDelay = Math.min(retryDelay * 2, 60000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flush();
    }, delay);
  }

  async function flush() {
    if (flushing || !CFG.submitUrl) {
      updateStatus();
      return;
    }
    flushing = true;
    updateStatus();
    try {
      let queue = load(QUEUE_KEY, []);
      while (queue.length) {
        const item = queue[0];
        const res = await fetch(CFG.submitUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(item)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json.ok && !json.rejected) throw new Error(json.error || "failed");
        queue = load(QUEUE_KEY, []).filter((x) => x.submission_id !== item.submission_id);
        store(QUEUE_KEY, queue);
        retryDelay = 1000;
        lastError = false;
      }
    } catch (e) {
      lastError = true;
      scheduleRetry();
    } finally {
      flushing = false;
      updateStatus();
    }
  }

  function updateStatus() {
    if (!state || !db) return;
    const n = load(QUEUE_KEY, []).length;
    let msg = "";
    if (!CFG.submitUrl) msg = n ? ui().statusLocal : "";
    else if (n) msg = lastError ? ui().statusRetry(n) : ui().statusPending(n);
    else if (state.done) msg = ui().statusSaved;
    statusEl.textContent = msg;
    statusEl.hidden = !msg;
  }

  langBtn.addEventListener("click", () => {
    if (!state) return;
    state.lang = state.lang === "en" ? "zh" : "en";
    saveState();
    render();
  });

  window.addEventListener("online", flush);

  async function boot() {
    try {
      db = await window.SurveyData.load(CFG);
    } catch (e) {
      app.replaceChildren(el("p", { class: "err-page" }, UI.zh.loadError), el("p", { class: "err-page" }, UI.en.loadError));
      return;
    }
    const saved = load(STORE_KEY, null);
    state = saved && saved.pairId ? saved : newState();
    const p = langParam();
    if (p) state.lang = p;
    saveState();
    render();
    flush();
  }

  boot();
})();
