(function () {
  "use strict";

  var CONFIG = window.REDDEES_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var API = (CONFIG.apiUrl || "").trim();
  var DEMO = !API || params.has("demo");

  var ME_KEY = "reddees.me";
  var DEMO_KEY = "reddees.demoAnswers";

  var state = {
    data: null,
    me: null,               // { name, code }
    answers: {},            // qid -> { answer, name, time }
    filter: "pending",
    justAnswered: {},       // qids answered since the filter was last changed (kept visible)
    editing: {},            // qids whose editor is open over an existing answer
    drafts: {},             // qid -> { text, option, checked }
    lastSync: null
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---------- storage helpers (never fail the page) ----------
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // ---------- backend ----------
  function apiList() {
    if (DEMO) {
      return Promise.resolve({ ok: true, answers: Object.values(load(DEMO_KEY, {})) });
    }
    var url = API + (API.indexOf("?") === -1 ? "?" : "&") +
      "action=list&code=" + encodeURIComponent(state.me.code);
    return fetch(url, { method: "GET" }).then(function (r) { return r.json(); });
  }

  function apiSave(payload) {
    if (DEMO) {
      var all = load(DEMO_KEY, {});
      var row = { qid: payload.qid, answer: payload.answer, name: payload.name, time: new Date().toISOString() };
      all[payload.qid] = row;
      save(DEMO_KEY, all);
      return new Promise(function (res) { setTimeout(function () { res({ ok: true, row: row }); }, 250); });
    }
    payload.code = state.me.code;
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  // ---------- question helpers ----------
  function allQuestions() {
    var out = [];
    state.data.sections.forEach(function (s) {
      s.questions.forEach(function (q) { out.push({ section: s, q: q }); });
    });
    return out;
  }
  function isAnswered(qid) {
    var a = state.answers[qid];
    return !!(a && String(a.answer).trim());
  }
  function typeOf(q) { return q.type || "text"; }

  // Turn a stored answer back into editor fields.
  function parseAnswer(q, answer) {
    answer = String(answer || "");
    var t = typeOf(q);
    if (t === "choice") {
      var opts = q.options || [];
      for (var i = 0; i < opts.length; i++) {
        if (answer === opts[i]) return { option: opts[i], text: "" };
        if (answer.indexOf(opts[i] + " — ") === 0) return { option: opts[i], text: answer.slice(opts[i].length + 3) };
      }
      return { option: "", text: answer };
    }
    if (t === "photo") {
      if (answer === "Sent") return { checked: true, text: "" };
      if (answer.indexOf("Sent — ") === 0) return { checked: true, text: answer.slice(7) };
      return { checked: false, text: answer };
    }
    return { text: answer };
  }

  // Turn editor fields into the answer we store.
  function composeAnswer(q, d) {
    var note = (d.text || "").trim();
    var t = typeOf(q);
    if (t === "choice") {
      if (d.option) return note ? d.option + " — " + note : d.option;
      return note;
    }
    if (t === "photo") {
      if (d.checked) return note ? "Sent — " + note : "Sent";
      return note;
    }
    return note;
  }

  function draftFor(q) {
    if (!state.drafts[q.id]) {
      var existing = state.answers[q.id];
      state.drafts[q.id] = parseAnswer(q, existing ? existing.answer : "");
    }
    return state.drafts[q.id];
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    try {
      return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    } catch (e) { return d.toLocaleString(); }
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === "text") n.textContent = v;
        else if (k === "className") n.className = v;
        else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- rendering ----------
  function visible(qid) {
    if (state.filter === "all") return true;
    if (state.filter === "answered") return isAnswered(qid);
    return !isAnswered(qid) || !!state.justAnswered[qid];
  }

  function renderSummary() {
    var qs = allQuestions();
    var done = qs.filter(function (x) { return isAnswered(x.q.id); }).length;
    $("doneCount").textContent = done;
    $("totalCount").textContent = qs.length;
    $("barFill").style.width = (qs.length ? Math.round(done / qs.length * 100) : 0) + "%";
    $("bar").setAttribute("aria-valuenow", String(done));
    $("bar").setAttribute("aria-valuemax", String(qs.length));
    $("lastSync").textContent = state.lastSync ? "Updated " + fmtTime(state.lastSync.toISOString()) : "";
    document.querySelectorAll(".chip").forEach(function (c) {
      c.setAttribute("aria-selected", String(c.getAttribute("data-filter") === state.filter));
    });
  }

  function renderQuestion(section, q) {
    var answered = isAnswered(q.id);
    var a = state.answers[q.id];
    var card = el("article", { className: "q card" + (answered ? " done" : ""), id: "q-" + q.id });

    card.appendChild(el("p", { className: "q-text", text: q.text }));
    if (q.hint) card.appendChild(el("p", { className: "q-hint", text: q.hint }));

    var showEditor = !answered || state.editing[q.id];

    if (answered && !state.editing[q.id]) {
      card.appendChild(el("div", { className: "answer" }, [
        el("p", { className: "answer-text", text: a.answer }),
        el("div", { className: "answer-meta" }, [
          el("span", { text: (a.name || "Someone") + " · " + fmtTime(a.time) }),
          el("button", {
            type: "button", className: "link", text: "Change answer",
            onclick: function () {
              state.editing[q.id] = true;
              state.drafts[q.id] = parseAnswer(q, a.answer);
              replaceCard(section, q, true);
            }
          })
        ])
      ]));
    }

    if (showEditor) card.appendChild(renderEditor(section, q));
    return card;
  }

  function renderEditor(section, q) {
    var d = draftFor(q);
    var t = typeOf(q);
    var editor = el("div", { className: "editor" });
    var status = el("span", { className: "status", "aria-live": "polite" });
    var saveBtn = el("button", { type: "button", className: "btn primary", text: "Save" });

    function refreshButton() {
      var composed = composeAnswer(q, d);
      saveBtn.disabled = !composed && !isAnswered(q.id);
    }

    if (t === "choice") {
      var opts = el("div", { className: "options", role: "group", "aria-label": "Choose one" });
      (q.options || []).forEach(function (o) {
        var b = el("button", {
          type: "button", className: "option", text: o, "aria-pressed": String(d.option === o),
          onclick: function () {
            d.option = d.option === o ? "" : o;
            opts.querySelectorAll(".option").forEach(function (x) {
              x.setAttribute("aria-pressed", String(x.textContent === d.option));
            });
            refreshButton();
          }
        });
        opts.appendChild(b);
      });
      editor.appendChild(opts);
    }

    if (t === "photo") {
      var cb = el("input", { type: "checkbox" });
      cb.checked = !!d.checked;
      cb.addEventListener("change", function () { d.checked = cb.checked; refreshButton(); });
      editor.appendChild(el("label", { className: "check" }, [cb, el("span", { text: "Photos sent" })]));
    }

    var placeholder = t === "text" ? "Type the answer here…" : "Anything to add? (optional)";
    var ta = el("textarea", { rows: t === "text" ? "3" : "2", placeholder: placeholder, "aria-label": "Answer: " + q.text });
    ta.value = d.text || "";
    ta.addEventListener("input", function () { d.text = ta.value; refreshButton(); });
    editor.appendChild(ta);

    var actions = el("div", { className: "editor-actions" }, [saveBtn]);
    if (state.editing[q.id]) {
      actions.appendChild(el("button", {
        type: "button", className: "link", text: "Cancel",
        onclick: function () {
          delete state.editing[q.id];
          delete state.drafts[q.id];
          replaceCard(section, q);
        }
      }));
    }
    actions.appendChild(status);
    editor.appendChild(actions);

    saveBtn.addEventListener("click", function () {
      var answer = composeAnswer(q, d);
      saveBtn.disabled = true;
      status.className = "status";
      status.textContent = "Saving…";
      apiSave({
        qid: q.id,
        section: section.title,
        question: q.text,
        answer: answer,
        name: state.me.name
      }).then(function (res) {
        if (!res || !res.ok) {
          if (res && res.error === "bad_code") return signOut("That access code no longer works. Please enter it again.");
          throw new Error((res && res.error) || "save_failed");
        }
        state.answers[q.id] = res.row;
        delete state.editing[q.id];
        delete state.drafts[q.id];
        if (answer) state.justAnswered[q.id] = true;
        replaceCard(section, q);
        renderSummary();
        renderSectionCounts();
        toast(answer ? "Saved. Thank you!" : "Answer cleared.");
      }).catch(function () {
        status.className = "status err";
        status.textContent = "Couldn't save. Check the internet and try again.";
        refreshButton();
      });
    });

    refreshButton();
    return editor;
  }

  function replaceCard(section, q, focus) {
    var old = $("q-" + q.id);
    if (!old) return;
    var fresh = renderQuestion(section, q);
    old.replaceWith(fresh);
    if (focus) {
      var f = fresh.querySelector("textarea");
      if (f) f.focus();
    }
  }

  function renderSectionCounts() {
    state.data.sections.forEach(function (s) {
      var n = $("count-" + s.id);
      if (!n) return;
      var done = s.questions.filter(function (q) { return isAnswered(q.id); }).length;
      n.textContent = done + " of " + s.questions.length;
    });
  }

  function render() {
    var wrap = $("sections");
    wrap.innerHTML = "";
    var shown = 0;
    state.data.sections.forEach(function (s) {
      var qs = s.questions.filter(function (q) { return visible(q.id); });
      if (!qs.length) return;
      shown += qs.length;
      var sec = el("section", { className: "section", "aria-labelledby": "h-" + s.id }, [
        el("div", { className: "section-head" }, [
          el("h2", { id: "h-" + s.id, text: s.title }),
          el("span", { className: "section-count", id: "count-" + s.id })
        ])
      ]);
      if (s.intro) sec.appendChild(el("p", { className: "section-intro", text: s.intro }));
      qs.forEach(function (q) { sec.appendChild(renderQuestion(s, q)); });
      wrap.appendChild(sec);
    });
    var empty = $("emptyState");
    empty.hidden = shown > 0;
    if (!shown) {
      empty.textContent = state.filter === "pending"
        ? "Everything has been answered. Thank you!"
        : "Nothing answered yet.";
    }
    renderSummary();
    renderSectionCounts();
  }

  // ---------- flow ----------
  function showGate(message) {
    $("loading").hidden = true;
    $("main").hidden = true;
    $("who").hidden = true;
    $("gate").hidden = false;
    $("codeField").hidden = DEMO;
    $("codeInput").required = !DEMO;
    var me = state.me || load(ME_KEY, null);
    if (me && me.name) $("nameInput").value = me.name;
    $("gateError").hidden = !message;
    $("gateError").textContent = message || "";
  }

  function signOut(message) {
    var me = load(ME_KEY, null);
    if (me) { delete me.code; save(ME_KEY, me); }
    showGate(message);
  }

  function refresh(quiet) {
    var btn = $("refreshBtn");
    btn.disabled = true;
    return apiList().then(function (res) {
      if (!res || !res.ok) {
        if (res && res.error === "bad_code") { signOut("That access code didn't work. Please check it and try again."); return false; }
        throw new Error("list_failed");
      }
      var map = {};
      (res.answers || []).forEach(function (row) { map[row.qid] = row; });
      state.answers = map;
      state.lastSync = new Date();
      // Drop drafts that were only pre-filled from old answers; keep ones being edited.
      Object.keys(state.drafts).forEach(function (k) { if (!state.editing[k] && isAnswered(k)) delete state.drafts[k]; });
      render();
      if (!quiet) toast("Up to date.");
      return true;
    }).catch(function () {
      toast("Couldn't load the latest answers. Check the internet.");
      return false;
    }).then(function (ok) { btn.disabled = false; return ok; });
  }

  function enter() {
    $("gate").hidden = true;
    $("loading").hidden = false;
    $("whoName").textContent = state.me.name;
    refresh(true).then(function (ok) {
      if (ok === false && !$("gate").hidden) return;
      $("loading").hidden = true;
      $("main").hidden = false;
      $("who").hidden = false;
      $("demoBanner").hidden = !DEMO;
      if (ok !== true) render();
    });
  }

  function wire() {
    $("gateForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("nameInput").value.trim();
      var code = $("codeInput").value.trim();
      if (!name) return;
      if (!DEMO && !code) return;
      state.me = { name: name, code: DEMO ? "" : code };
      save(ME_KEY, state.me);
      enter();
    });
    $("switchUser").addEventListener("click", function () {
      state.me = load(ME_KEY, null);
      showGate();
      $("nameInput").focus();
      $("nameInput").select();
    });
    $("refreshBtn").addEventListener("click", function () { refresh(false); });
    document.querySelectorAll(".chip").forEach(function (c) {
      c.addEventListener("click", function () {
        state.filter = c.getAttribute("data-filter");
        state.justAnswered = {};
        render();
      });
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || $("main").hidden) return;
      if (!state.lastSync || Date.now() - state.lastSync.getTime() > 60000) refresh(true);
    });
  }

  function start() {
    wire();
    fetch("questions.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("questions"); return r.json(); })
      .then(function (data) {
        state.data = data;
        if (data.title) { $("gateTitle").textContent = data.title; }
        if (data.intro) { $("gateIntro").textContent = data.intro; }
        var me = load(ME_KEY, null);
        if (me && me.name && (DEMO || me.code)) {
          state.me = { name: me.name, code: me.code || "" };
          enter();
        } else {
          showGate();
        }
      })
      .catch(function () {
        $("loading").textContent = "Couldn't load the questions. Please refresh the page.";
      });
  }

  start();
})();
