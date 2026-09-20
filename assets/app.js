/* ==========================================================================
   Pre Cybersecurity — student-facing behaviour
   --------------------------------------------------------------------------
   Everything here runs against REAL data: the week/lesson/stage catalogue is
   emitted by build.py into a <script id="pc-data"> JSON block, and progress is
   the student's own record in localStorage. Nothing is mocked, and nothing is
   invented — if a student has done nothing, the UI says so and tells them
   where to start.

   Progress model (v2)
     { v: 2, sec: { "1": ["theory", "lab"] }, days: ["2026-09-19"] }
   v1 was a bare array of week numbers. It is migrated on read, so a student
   who already had ticks under the old build keeps every one of them.
   ========================================================================== */
(function () {
  "use strict";

  /* Keys are namespaced pc-*. The old tz-* keys are still read, once, so an
     existing student's language, theme and progress survive the redesign. */
  var LANG_KEY = "pc-lang", OLD_LANG = "tz-lang";
  var THEME_KEY = "pc-theme", OLD_THEME = "tz-theme";
  var PROG_KEY = "pc-progress", OLD_PROG = "tz-progress";

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function readAny(k, old) { var v = read(k); return v === null ? read(old) : v; }

  /* Set by the week page once its section rail exists. Language is the reason it
     is a hook and not a local call: the pill labels are bilingual and swapping
     them changes how wide the row is, so a rail that fit in English can start
     scrolling in Arabic. */
  var refreshRail = null;

  /* ------------------------------------------------------------------ data */
  var DATA = { weeks: [], stages: [], practice: [], totalLessons: 0 };
  (function loadData() {
    var el = document.getElementById("pc-data");
    if (!el) return;
    try {
      var parsed = JSON.parse(el.textContent);
      if (parsed && parsed.weeks) DATA = parsed;
    } catch (e) { /* keep the empty default; every renderer no-ops on it */ }
  })();

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* Hours, not minutes: a section's load comes from its curriculum heading and
     the shortest one on the whole site is half an hour, so "30 min" is the
     floor and "≈7h" is the common case. */
  function fmtHours(h) {
    if (!h) return "";
    if (h < 1) return L("30 min", "٣٠ دقيقة");
    var n = (h === Math.floor(h)) ? h : h.toFixed(1);
    return L("≈" + n + "h", "≈" + n + " ساعة");
  }

  /* ----------------------------------------------------------- progress --- */
  var Progress = (function () {
    var state = null;

    function blank() { return { v: 2, sec: {}, days: [] }; }

    function load() {
      if (state) return state;
      var raw = readAny(PROG_KEY, OLD_PROG);
      state = blank();
      if (!raw) return state;
      var parsed;
      try { parsed = JSON.parse(raw); } catch (e) { return state; }

      if (parsed instanceof Array) {
        /* v1 migration: a ticked week meant the whole week was done, so mark
           every countable lesson in it rather than silently dropping the tick */
        for (var i = 0; i < parsed.length; i++) {
          var wk = String(parseInt(parsed[i], 10));
          var meta = week(wk);
          state.sec[wk] = meta ? meta.lessons.map(function (l) { return l.key; }) : [];
        }
      } else if (parsed && typeof parsed === "object") {
        state.v = 2;
        state.sec = (parsed.sec && typeof parsed.sec === "object") ? parsed.sec : {};
        state.days = (parsed.days instanceof Array) ? parsed.days : [];
      }
      return state;
    }

    function save() { store(PROG_KEY, JSON.stringify(load())); }

    function week(n) {
      n = String(n);
      for (var i = 0; i < DATA.weeks.length; i++) {
        if (String(DATA.weeks[i].n) === n) return DATA.weeks[i];
      }
      return null;
    }

    function today() {
      var d = new Date();
      return d.getFullYear() + "-" +
             String(d.getMonth() + 1).padStart(2, "0") + "-" +
             String(d.getDate()).padStart(2, "0");
    }

    function markDay() {
      var s = load(), t = today();
      if (s.days.indexOf(t) === -1) { s.days.push(t); save(); }
    }

    /* consecutive days ending today (or yesterday — a streak survives until
       the day it is actually broken, so a student who studied last night
       still sees their number when they open the site this morning) */
    function streak() {
      var s = load();
      if (!s.days.length) return 0;
      var have = {};
      for (var i = 0; i < s.days.length; i++) have[s.days[i]] = 1;
      var d = new Date(), n = 0;
      if (!have[fmt(d)]) d.setDate(d.getDate() - 1);
      while (have[fmt(d)]) { n++; d.setDate(d.getDate() - 1); }
      return n;
    }
    function fmt(d) {
      return d.getFullYear() + "-" +
             String(d.getMonth() + 1).padStart(2, "0") + "-" +
             String(d.getDate()).padStart(2, "0");
    }

    return {
      week: week,
      streak: streak,
      markDay: markDay,
      days: function () { return load().days.slice(); },

      sections: function (n) {
        var s = load().sec[String(n)];
        return (s instanceof Array) ? s : [];
      },
      sectionDone: function (n, key) {
        return this.sections(n).indexOf(key) !== -1;
      },
      toggle: function (n, key) {
        var s = load(), k = String(n);
        var list = s.sec[k];
        if (!(list instanceof Array)) { list = []; s.sec[k] = list; }
        var i = list.indexOf(key);
        if (i === -1) { list.push(key); } else { list.splice(i, 1); }
        markDay();
        save();
        return i === -1;
      },

      /* lessons that actually count — reference tables and the concept notes
         are reading material, not work, so they are excluded from every
         percentage on the site */
      counted: function (n) {
        var m = week(n);
        if (!m) return [];
        return m.lessons.filter(function (l) { return l.counts; });
      },
      weekDone: function (n) {
        var c = this.counted(n);
        if (!c.length) return false;
        for (var i = 0; i < c.length; i++) {
          if (!this.sectionDone(n, c[i].key)) return false;
        }
        return true;
      },
      weekCount: function (n) {
        var c = this.counted(n), d = 0;
        for (var i = 0; i < c.length; i++) {
          if (this.sectionDone(n, c[i].key)) d++;
        }
        return { done: d, total: c.length, pct: c.length ? Math.round(d / c.length * 100) : 0 };
      },
      weekCountDone: function (n) {
        var m = week(n);
        if (!m) return false;
        return m.lessons.length ? this.weekCount(n).done === this.counted(n).length : false;
      },

      totals: function () {
        var done = 0, total = 0, weeksDone = 0, weeksStarted = 0;
        for (var i = 0; i < DATA.weeks.length; i++) {
          var w = DATA.weeks[i];
          var c = this.weekCount(w.n);
          done += c.done; total += c.total;
          if (c.total && c.done === c.total) weeksDone++;
          if (c.done > 0) weeksStarted++;
        }
        return {
          done: done, total: total, weeksDone: weeksDone, weeksStarted: weeksStarted,
          pct: total ? Math.round(done / total * 100) : 0
        };
      },

      /* the single next thing to do: first unfinished countable lesson in the
         first week that still has one */
      next: function () {
        for (var i = 0; i < DATA.weeks.length; i++) {
          var w = DATA.weeks[i];
          var c = this.counted(w.n);
          for (var j = 0; j < c.length; j++) {
            if (!this.sectionDone(w.n, c[j].key)) {
              return { week: w, lesson: c[j] };
            }
          }
        }
        return null;
      },

      recent: function (limit) {
        var out = [];
        for (var i = 0; i < DATA.weeks.length; i++) {
          var w = DATA.weeks[i];
          var c = this.counted(w.n), last = null;
          for (var j = 0; j < c.length; j++) {
            if (this.sectionDone(w.n, c[j].key)) last = c[j];
          }
          if (last) out.push({ week: w, lesson: last, index: i });
        }
        out.reverse();
        return out.slice(0, limit || 4);
      },

      /* terms from every week the student has finished — the vocabulary they
         have actually been exposed to, not a badge count */
      skills: function () {
        var seen = {}, out = [];
        for (var i = 0; i < DATA.weeks.length; i++) {
          var w = DATA.weeks[i];
          if (!this.weekCount(w.n).done) continue;
          for (var j = 0; j < (w.skills || []).length; j++) {
            if (!seen[w.skills[j]]) { seen[w.skills[j]] = 1; out.push(w.skills[j]); }
          }
        }
        return out;
      },

      reset: function () { state = blank(); save(); }
    };
  })();

  /* ------------------------------------------------------------- language - */
  window.pcSetLang = function (lang) {
    var root = document.documentElement;
    root.setAttribute("data-lang", lang);
    root.setAttribute("lang", lang);
    root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    store(LANG_KEY, lang);
    syncPressed();
    /* copy is bilingual in the DOM, so almost nothing needs re-rendering —
       but anything JS built does */
    renderAll();
    if (refreshRail) refreshRail();
  };

  window.pcSetTheme = function (t) {
    if (t !== "light" && t !== "dark") t = "auto";
    var root = document.documentElement;
    /* "auto" must leave the attribute OFF so prefers-color-scheme applies */
    if (t === "auto") { root.removeAttribute("data-theme"); }
    else { root.setAttribute("data-theme", t); }
    store(THEME_KEY, t);
    syncPressed();
  };

  /* both segmented controls read their state from the document, so this stays
     correct no matter which of them triggered the change */
  function syncPressed() {
    var lang = document.documentElement.getAttribute("data-lang") || "en";
    var theme = read(THEME_KEY) || read(OLD_THEME) || "light";
    var ls = document.querySelectorAll("[data-setlang]");
    for (var i = 0; i < ls.length; i++) ls[i].setAttribute("aria-pressed", String(ls[i].getAttribute("data-setlang") === lang));
    var ts = document.querySelectorAll("[data-settheme]");
    for (var j = 0; j < ts.length; j++) ts[j].setAttribute("aria-pressed", String(ts[j].getAttribute("data-settheme") === theme));
  }

  var L = function (en, ar) {
    return document.documentElement.getAttribute("data-lang") === "ar" ? ar : en;
  };

  /* L() picks a language *now*, which is right for anything renderAll() rebuilds
     when the language changes. Three controls are not rebuilt that way — the
     week page's section buttons, the code-block copy button, and the collapse-all
     button — and writing one string into one of them froze it in whichever
     language happened to be current: a student reading Arabic who switched to
     English kept "Mark complete" in Arabic, or the reverse. They get both
     languages in the DOM instead, the same as every other label on the page, and
     the stylesheet decides which to show. */
  function setLabel(host, en, ar) {
    host.innerHTML = '<span class="only-en">' + en + '</span>'
                   + '<span class="only-ar">' + ar + '</span>';
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target : null;
    if (!t || !t.closest) return;
    var lb = t.closest("[data-setlang]");
    if (lb) { window.pcSetLang(lb.getAttribute("data-setlang")); return; }
    var tb = t.closest("[data-settheme]");
    if (tb) { window.pcSetTheme(tb.getAttribute("data-settheme")); return; }
    var bg = t.closest("#pc-burger");
    if (bg) {
      var sheet = document.getElementById("pc-sheet");
      if (sheet) {
        var open = sheet.classList.toggle("open");
        bg.setAttribute("aria-expanded", String(open));
      }
    }
  });

  /* ------------------------------------------------------------------ svg - */
  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    lab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6.5L4.2 18A2 2 0 0 0 6 21h12a2 2 0 0 0 1.8-3L15 9.5V3"/><path d="M8 3h8M7.5 14h9"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4M4 4h12l-1.5 4L16 12H4"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l3.5-4 3 2.5L20 7"/></svg>',
    route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5.5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/></svg>'
  };

  /* --------------------------------------------------------------- render - */
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function progressBar(pct, cls) {
    var bar = el("div", "bar" + (cls ? " " + cls : ""));
    var fill = el("i");
    fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    bar.appendChild(fill);
    return bar;
  }

  function lessonURL(week, key) { return week.url + "#" + key; }

  /* --- dashboard ---------------------------------------------------------- */
  function renderDashboard() {
    var host = document.getElementById("pc-dash");
    if (!host) return;
    clear(host);

    var t = Progress.totals();
    var next = Progress.next();
    var started = t.done > 0;

    if (!started) {
      /* Name the real first course and link straight into it. A generic
         "get started" button leaves a beginner to work out where to begin,
         which is the exact moment they leave. */
      var first = DATA.weeks[0];
      var empty = el("div", "empty reveal");
      var ico = el("div", "empty-ico");
      ico.innerHTML = ICON.route;
      empty.appendChild(ico);
      empty.appendChild(el("h2", null, L("You haven't started a course yet", "لم تبدأ أي مسار بعد")));
      empty.appendChild(el("p", null, L(
        "Begin with Week 01 — " + first.en + ". It assumes no prior experience: "
          + "you will learn what a terminal is, why security work happens there, "
          + "and build your own practice lab. Mark each lesson complete as you go, "
          + "and your progress is saved on this device.",
        "ابدأ بالأسبوع ٠١ — " + first.ar + ". لا يفترض أي خبرة سابقة: "
          + "ستتعلّم ما هي الطرفية (Terminal)، ولماذا يحدث العمل الأمني فيها، "
          + "وتبني مختبر تدريب خاصاً بك. علّم كل درس كمكتمل أثناء تقدّمك، "
          + "ويُحفظ تقدّمك على هذا الجهاز."
      )));
      var cta = el("a", "btn btn-primary btn-lg");
      cta.href = first.url;
      cta.innerHTML = ICON.play + "<span>" + L("Start Week 01", "ابدأ الأسبوع ٠١") + "</span>";
      var alt = el("a", "btn btn-secondary btn-lg");
      alt.href = "learn.html";
      alt.innerHTML = ICON.grid + "<span>" + L("Browse all courses", "تصفّح كل المسارات") + "</span>";
      var row = el("div", "hero-actions");
      row.style.justifyContent = "center";
      row.appendChild(cta); row.appendChild(alt);
      empty.appendChild(row);
      host.appendChild(empty);
      return;
    }

    /* continue card — the exact lesson to open next */
    if (next) {
      var c = el("div", "continue reveal");
      var left = el("div");
      left.appendChild(el("span", "eyebrow", L("Continue learning", "تابع التعلّم")));
      left.appendChild(el("h2", null, L(next.week.en, next.week.ar)));
      left.appendChild(el("p", null, (next.week.difficulty_label_en
        ? L(next.week.difficulty_label_en, next.week.difficulty_label_ar) + " · " : "") +
        L("Next up: ", "التالي: ") + L(next.lesson.en, next.lesson.ar)));

      var meta = el("div", "continue-meta");
      /* hours is the section's real load from its curriculum heading — some
         sections (payoff, terms) carry none, and those show no time at all
         rather than a zero */
      var hrs = next.lesson.hours;
      if (hrs) {
        var m1 = el("span");
        m1.innerHTML = ICON.clock + "<span>" + fmtHours(hrs) + "</span>";
        meta.appendChild(m1);
      }
      var m2 = el("span");
      m2.innerHTML = ICON.book + "<span>" + L("Week ", "الأسبوع ") + next.week.n + " · " + L(next.lesson.en, next.lesson.ar) + "</span>";
      meta.appendChild(m2);
      left.appendChild(meta);

      var right = el("div");
      var go = el("a", "btn btn-primary btn-lg");
      go.href = lessonURL(next.week, next.lesson.key);
      go.innerHTML = ICON.arrow + "<span>" + L("Continue", "تابع") + "</span>";
      right.appendChild(go);

      c.appendChild(left); c.appendChild(right);
      host.appendChild(c);
    } else {
      var fin = el("div", "empty reveal");
      var fi = el("div", "empty-ico"); fi.innerHTML = ICON.check;
      fin.appendChild(fi);
      fin.appendChild(el("h2", null, L("You've completed every lesson", "أكملت كل الدروس")));
      fin.appendChild(el("p", null, L(
        "All 13 weeks are marked complete. Revisit any week to revise, or explore where to go next.",
        "الأسابيع الثلاثة عشر كلها مكتملة. راجع أي أسبوع، أو استكشف أين تتجه بعد ذلك."
      )));
      var nxt = el("a", "btn btn-primary");
      nxt.href = "specializations.html";
      nxt.innerHTML = "<span>" + L("Choose your direction", "اختر مسارك") + "</span>";
      fin.appendChild(nxt);
      host.appendChild(fin);
    }
  }

  /* --- course cards (learn.html) ------------------------------------------ */
  function renderCourses() {
    var cards = document.querySelectorAll("[data-course-wk]");
    if (!cards.length) return;
    for (var i = 0; i < cards.length; i++) {
      var wk = cards[i].getAttribute("data-course-wk");
      var c = Progress.weekCount(wk);
      var host = cards[i].querySelector("[data-prog]");
      if (host) {
        clear(host);
        var wrap = el("div", "course-prog");
        wrap.appendChild(progressBar(c.pct, c.pct === 100 ? "is-good" : ""));
        /* dir=ltr keeps "0/4" reading left-to-right inside the Arabic layout */
        var lab = el("b", null, c.done + "/" + c.total);
        lab.setAttribute("dir", "ltr");
        wrap.appendChild(lab);
        host.appendChild(wrap);
      }
      cards[i].classList.toggle("is-done", c.total > 0 && c.done === c.total);
    }
  }

  /* --- learning path (path.html + dashboard) ------------------------------ */
  function renderPath() {
    var hosts = document.querySelectorAll("[data-path]");
    if (!hosts.length) return;

    var currentSet = false;
    var hasProgress = Progress.totals().done > 0;
    for (var i = 0; i < hosts.length; i++) {
      var stageEls = hosts[i].querySelectorAll("[data-stage]");
      for (var j = 0; j < stageEls.length; j++) {
        var sn = stageEls[j].getAttribute("data-stage");
        var st = stage(sn);
        if (!st) continue;
        var done = 0, total = 0;
        for (var k = 0; k < st.weeks.length; k++) {
          total += Progress.weekCount(st.weeks[k]).total;
          done += Progress.weekCount(st.weeks[k]).done;
        }
        var complete = total > 0 && done === total;
        stageEls[j].classList.toggle("is-done", complete);
        var isCurrent = !complete && !currentSet;
        if (isCurrent) currentSet = true;
        stageEls[j].classList.toggle("is-current", isCurrent);
        stageEls[j].classList.toggle("is-locked", !complete && !isCurrent);

        var dot = stageEls[j].querySelector("[data-stage-dot]");
        if (dot) dot.innerHTML = complete ? ICON.check : (isCurrent ? ICON.play : String(st.n));

        var badge = stageEls[j].querySelector("[data-stage-state]");
        if (badge) {
          /* Nothing is "in progress" before the first lesson is ticked, and
             "Start here" belongs only to the stage that actually is the
             starting point — labelling all seven that way loses the sequence. */
          badge.textContent = complete
            ? L("Completed", "مكتملة")
            : isCurrent ? (hasProgress ? L("In progress", "قيد التقدم")
                                      : L("Start here", "ابدأ من هنا"))
            : L("Up next", "لاحقاً");
          badge.className = "chip " +
            (complete ? "chip-good" : isCurrent ? "chip-accent" : "");
        }

        /* week pills inside the stage */
        var pills = stageEls[j].querySelectorAll("[data-pill-wk]");
        for (var p = 0; p < pills.length; p++) {
          var w = Progress.weekCount(pills[p].getAttribute("data-pill-wk"));
          pills[p].classList.toggle("is-done", w.total > 0 && w.done === w.total);
        }
      }
      break; /* one host is enough; the loop above already covered it */
    }
  }

  function stage(n) {
    for (var i = 0; i < DATA.stages.length; i++) {
      if (String(DATA.stages[i].n) === String(n)) return DATA.stages[i];
    }
    return null;
  }

  /* --- progress page ------------------------------------------------------ */
  function renderProgressPage() {
    var host = document.getElementById("pc-progress-page");
    if (!host) return;
    clear(host);

    var t = Progress.totals();
    if (!t.done) {
      var e = el("div", "empty");
      var ei = el("div", "empty-ico"); ei.innerHTML = ICON.chart;
      e.appendChild(ei);
      e.appendChild(el("h2", null, L("No progress yet — and that's fine", "لا يوجد تقدم بعد — وهذا طبيعي")));
      e.appendChild(el("p", null, L(
        "Your progress appears here as soon as you complete your first lesson. Start with Week 1: it sets up the lab everything else runs in.",
        "سيظهر تقدمك هنا بمجرد إكمال أول درس. ابدأ من الأسبوع الأول: فيه تُجهَّز المختبر الذي يعمل داخله كل ما بعده."
      )));
      var b = el("a", "btn btn-primary");
      b.href = "week-01.html";
      b.innerHTML = "<span>" + L("Open Week 1", "افتح الأسبوع الأول") + "</span>";
      e.appendChild(b);
      host.appendChild(e);
      return;
    }

    /* stat row */
    var row = el("div", "grid grid-4");
    var stats = [
      [t.pct + "%", L("Course complete", "إتمام المسار"), ICON.chart],
      [t.done + " / " + t.total, L("Lessons completed", "دروس مكتملة"), ICON.book],
      [String(t.weeksDone) + " / " + DATA.weeks.length, L("Weeks finished", "أسابيع مكتملة"), ICON.flag],
      [String(Progress.streak()), L("Day streak", "أيام متتابعة"), ICON.spark]
    ];
    for (var i = 0; i < stats.length; i++) {
      var s = el("div", "stat");
      var n = el("div", "stat-n", stats[i][0]);
      var l = el("div", "stat-l");
      l.innerHTML = stats[i][2] + "<span>" + stats[i][1] + "</span>";
      s.appendChild(n); s.appendChild(l);
      row.appendChild(s);
    }
    host.appendChild(row);

    /* per-stage breakdown */
    var breakdown = el("div", "card");
    var bh = el("div", "card-head");
    bh.appendChild(el("h3", null, L("Progress by stage", "التقدم حسب المرحلة")));
    breakdown.appendChild(bh);
    var bb = el("div", "card-pad");
    bb.style.display = "flex"; bb.style.flexDirection = "column"; bb.style.gap = "16px";
    for (var si = 0; si < DATA.stages.length; si++) {
      var st = DATA.stages[si];
      var d = 0, tot = 0;
      for (var wj = 0; wj < st.weeks.length; wj++) {
        d += Progress.weekCount(st.weeks[wj]).done;
        tot += Progress.weekCount(st.weeks[wj]).total;
      }
      var pct = tot ? Math.round(d / tot * 100) : 0;
      var line = el("div");
      var head = el("div");
      head.style.cssText = "display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:7px";
      head.appendChild(el("span", null, L(st.en, st.ar)));
      var b2 = el("b", null, pct + "%");
      b2.style.cssText = "font-size:.84rem;color:var(--accent);font-variant-numeric:tabular-nums";
      head.appendChild(b2);
      line.appendChild(head);
      line.appendChild(progressBar(pct, pct === 100 ? "is-good" : ""));
      bb.appendChild(line);
    }
    breakdown.appendChild(bb);
    host.appendChild(breakdown);

    /* skills acquired — real terms from completed weeks */
    var skills = Progress.skills();
    var sk = el("div", "card");
    var skh = el("div", "card-head");
    skh.appendChild(el("h3", null, L("Terms you've covered", "المصطلحات التي غطيتها")));
    var cnt = el("span", "chip");
    cnt.textContent = skills.length;
    skh.appendChild(cnt);
    sk.appendChild(skh);
    var skb = el("div", "card-pad");
    if (skills.length) {
      var chips = el("div", "chips");
      for (var c2 = 0; c2 < skills.length; c2++) {
        chips.appendChild(el("span", "chip chip-accent", skills[c2]));
      }
      skb.appendChild(chips);
      var note = el("p", null, L(
        "These are the English technical terms from the weeks you've finished. They're the vocabulary you'll meet in tools, documentation and interviews — keep them in English.",
        "هذه هي المصطلحات التقنية الإنجليزية من الأسابيع التي أكملتها. هي المفردات التي ستقابلها في الأدوات والوثائق والمقابلات — أبقِها بالإنجليزية."
      ));
      note.style.cssText = "margin-top:14px;font-size:.85rem;color:var(--muted)";
      skb.appendChild(note);
    } else {
      skb.appendChild(el("p", null, L(
        "Finish a full week to collect its terms here.",
        "أكمل أسبوعاً كاملاً لتظهر مصطلحاته هنا."
      )));
    }
    sk.appendChild(skb);
    host.appendChild(sk);

    /* recently completed */
    var rec = Progress.recent(5);
    if (rec.length) {
      var rc = el("div", "card");
      var rch = el("div", "card-head");
      rch.appendChild(el("h3", null, L("Recently completed", "أُكمل حديثاً")));
      rc.appendChild(rch);
      var list = el("div");
      list.style.cssText = "display:flex;flex-direction:column";
      for (var r = 0; r < rec.length; r++) {
        var a = el("a");
        a.href = lessonURL(rec[r].week, rec[r].lesson.key);
        a.style.cssText = "display:flex;align-items:center;gap:12px;padding:13px 18px;text-decoration:none;color:var(--ink);border-bottom:1px solid var(--line-soft)";
        var tick = el("span");
        tick.innerHTML = ICON.check;
        tick.style.cssText = "width:26px;height:26px;border-radius:999px;background:var(--good-soft);color:var(--good);display:grid;place-items:center;flex:none";
        tick.firstChild.style.width = "14px";
        tick.firstChild.style.height = "14px";
        a.appendChild(tick);
        var txt = el("div");
        txt.style.cssText = "min-width:0";
        var t1 = el("div", null, L(rec[r].lesson.en, rec[r].lesson.ar));
        t1.style.cssText = "font-weight:600;font-size:.92rem";
        var t2 = el("div", null, L("Week ", "الأسبوع ") + rec[r].week.n + " · " + L(rec[r].week.en, rec[r].week.ar));
        t2.style.cssText = "font-size:.8rem;color:var(--muted)";
        txt.appendChild(t1); txt.appendChild(t2);
        a.appendChild(txt);
        list.appendChild(a);
      }
      list.lastChild.style.borderBottom = "0";
      rc.appendChild(list);
      host.appendChild(rc);
    }

    /* reset */
    var foot = el("div");
    foot.style.cssText = "margin-top:22px;display:flex;justify-content:flex-end";
    var rst = el("button", "btn btn-secondary btn-sm");
    rst.type = "button";
    rst.textContent = L("Reset my progress", "تصفير تقدمي");
    rst.addEventListener("click", function () {
      if (window.confirm(L(
        "Reset all progress? Every completed lesson will be cleared. This cannot be undone.",
        "تصفير كل التقدم؟ سيُمسح كل درس مكتمل. لا يمكن التراجع."))) {
        Progress.reset();
        renderAll();
      }
    });
    foot.appendChild(rst);
    host.appendChild(foot);
  }

  /* --- practice filters --------------------------------------------------- */
  function renderPractice() {
    var host = document.getElementById("pc-practice");
    if (!host) return;
    var cards = host.querySelectorAll("[data-ex]");
    var filter = "all";
    var buttons = document.querySelectorAll("[data-pfilter]");

    function apply() {
      var shown = 0;
      for (var i = 0; i < cards.length; i++) {
        var d = cards[i].getAttribute("data-difficulty");
        var hit = filter === "all" || filter === d;
        cards[i].hidden = !hit;
        if (hit) shown++;
      }
      var out = document.getElementById("pc-ex-count");
      if (out) out.textContent = shown + " / " + cards.length;
    }

    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", function () {
        filter = this.getAttribute("data-pfilter");
        for (var k = 0; k < buttons.length; k++) {
          buttons[k].setAttribute("aria-pressed", String(buttons[k] === this));
        }
        apply();
      });
    }
    apply();
  }

  /* --- glossary filter ---------------------------------------------------- */
  function renderGlossary() {
    var search = document.getElementById("pc-search");
    if (!search) return;
    var rows = document.querySelectorAll("[data-term]");
    var out = document.getElementById("pc-found");
    var total = rows.length;

    function filter() {
      var q = search.value.trim().toLowerCase();
      var shown = 0;
      for (var i = 0; i < rows.length; i++) {
        var hay = rows[i].getAttribute("data-term");
        var hit = !q || hay.indexOf(q) !== -1;
        rows[i].hidden = !hit;
        if (hit) shown++;
      }
      var wraps = document.querySelectorAll(".tablewrap");
      for (var w = 0; w < wraps.length; w++) {
        var vis = wraps[w].querySelectorAll("[data-term]:not([hidden])").length;
        var head = wraps[w].querySelectorAll("[data-term]").length;
        if (head > 0) wraps[w].hidden = vis === 0;
      }
      if (out) out.textContent = shown + " / " + total;
    }
    search.addEventListener("input", filter);
    filter();
  }

  /* --- week page: section completion, rail, collapse ---------------------- */
  function renderLesson() {
    var secs = document.querySelectorAll(".lesson-sec[data-sec]");
    if (!secs.length) return;

    var wk = document.body.getAttribute("data-week");
    if (!wk) return;

    var rail = document.querySelector(".wk-rail");

    /* fold state + tick state */
    for (var i = 0; i < secs.length; i++) {
      (function (sec) {
        var key = sec.getAttribute("data-sec");
        var btn = sec.querySelector("[data-done]");
        if (btn) {
          var on = Progress.sectionDone(wk, key);
          btn.setAttribute("aria-pressed", String(on));
          setDoneLabel(btn, on);
          sec.classList.toggle("is-done", on);
          btn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var now = Progress.toggle(wk, key);
            btn.setAttribute("aria-pressed", String(now));
            setDoneLabel(btn, now);
            sec.classList.toggle("is-done", now);
            paintRail();
            paintWeekBar();
          });
        }
      })(secs[i]);
    }

    function setDoneLabel(btn, on) {
      /* the label span wraps the two language spans, so replacing its text would
         throw them both away */
      var span = btn.querySelector("span");
      if (span) setLabel(span,
        on ? "Completed" : "Mark complete",
        on ? "مكتمل" : "علّم كمكتمل");
    }

    var railLinks = rail ? rail.querySelectorAll("a") : [];
    var railBox = rail ? rail.querySelector(".wk-rail-links") : null;

    /* The pill row scrolls sideways when a week has more sections than fit, which
       most of them do — week 13 hides six of its thirteen. Two things follow from
       that, and neither was true before: the pill for the section you are reading
       has to be brought into view, and the edge with content past it has to look
       like it, or the row just appears to be cut off. */

    function railEdges() {
      if (!railBox) return;
      var max = railBox.scrollWidth - railBox.clientWidth;
      if (max < 2) { railBox.removeAttribute("data-edge"); return; }
      /* scrollLeft runs negative in RTL, so compare magnitudes, and ask the box
         itself which way it reads rather than trusting the document direction. */
      var rtl = getComputedStyle(railBox).direction === "rtl";
      var pos = Math.abs(railBox.scrollLeft);
      var ahead = pos < max - 1;   /* content still to come, in reading order */
      var behind = pos > 1;        /* content already scrolled past */
      var right = rtl ? behind : ahead;
      var left = rtl ? ahead : behind;
      railBox.setAttribute("data-edge",
        left && right ? "both" : right ? "right" : left ? "left" : "");
    }

    function railReveal(link) {
      if (!railBox || !link) return;
      /* Moved by hand rather than with scrollIntoView, which scrolls every
         scrollable ancestor — including the page, and the student is mid-read.
         Only the pill row should move. */
      var box = railBox.getBoundingClientRect();
      var pill = link.getBoundingClientRect();
      var gap = 16;
      var delta = 0;
      if (pill.left < box.left) delta = pill.left - box.left - gap;
      else if (pill.right > box.right) delta = pill.right - box.right + gap;
      if (delta) railBox.scrollLeft += delta;
    }

    if (railBox) {
      railBox.addEventListener("scroll", railEdges, { passive: true });
      window.addEventListener("resize", railEdges);
      refreshRail = function () { railEdges(); railReveal(rail.querySelector("a.is-current")); };
      railEdges();
      /* Measuring once is a race. At DOMContentLoaded a bar that ends up fitting
         can still read as overflowing by ~18px — the row is a few px narrower and
         its pills wider than they will be a moment later — and the answer decides
         whether the last pill is faded. It is not even consistent between loads,
         so measure again once layout has settled. */
      window.addEventListener("load", railEdges);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { railEdges(); });
      }
    }
    function paintRail() {
      for (var i = 0; i < railLinks.length; i++) {
        var id = railLinks[i].getAttribute("href").slice(1);
        if (Progress.sectionDone(wk, id)) railLinks[i].classList.add("is-done");
        else railLinks[i].classList.remove("is-done");
      }
    }
    paintRail();

    function paintWeekBar() {
      var host = document.getElementById("pc-weekbar");
      if (!host) return;
      var c = Progress.weekCount(wk);
      clear(host);
      host.appendChild(progressBar(c.pct, c.pct === 100 ? "is-good" : ""));
      var lab = document.getElementById("pc-weekbar-label");
      if (lab) lab.textContent = c.done + " / " + c.total;
    }
    paintWeekBar();

    /* a jump link to a folded section must open it */
    function openTarget() {
      var id = location.hash.slice(1);
      if (!id) return;
      var node = document.getElementById(id);
      if (node && node.tagName === "DETAILS") node.open = true;
    }
    window.addEventListener("hashchange", openTarget);
    openTarget();

    /* The observer's band is a quarter of the way down the viewport, and the page
       head fills that on load — so the rail used to open with no pill lit at all.
       Section one is where you are until you scroll; the observer corrects this
       the moment anything else reaches the band. */
    if (railLinks.length) railLinks[0].classList.add("is-current");

    /* which section am I in? drives the rail pill */
    if (railLinks.length && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (!entries[e].isIntersecting) continue;
          var id = entries[e].target.id;
          for (var j = 0; j < railLinks.length; j++) {
            var on = railLinks[j].getAttribute("href") === "#" + id;
            railLinks[j].classList.toggle("is-current", on);
            /* the pill that says where you are is no use off-screen */
            if (on) railReveal(railLinks[j]);
          }
          railEdges();
        }
      }, { rootMargin: "-25% 0px -65% 0px" });
      for (var s = 0; s < secs.length; s++) io.observe(secs[s]);
    }

    /* collapse / expand all */
    var all = document.getElementById("pc-collapse");
    if (all) {
      all.addEventListener("click", function () {
        var collapse = all.getAttribute("aria-pressed") !== "true";
        for (var i = 0; i < secs.length; i++) secs[i].open = !collapse;
        all.setAttribute("aria-pressed", String(collapse));
        setLabel(all,
          collapse ? "Expand all" : "Collapse all",
          collapse ? "افتح الكل" : "اطوِ الكل");
      });
    }

    /* paper has no fold */
    var was = [];
    window.addEventListener("beforeprint", function () {
      was = [];
      for (var i = 0; i < secs.length; i++) { was.push(secs[i].open); secs[i].open = true; }
    });
    window.addEventListener("afterprint", function () {
      for (var i = 0; i < secs.length && i < was.length; i++) secs[i].open = was[i];
    });
  }

  /* --- code blocks: label + copy ------------------------------------------ */
  function renderCode() {
    var pres = document.querySelectorAll(".highlight, .prose > pre");
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i].tagName === "PRE" ? pres[i] : pres[i].querySelector("pre");
      if (!pre || pre.closest(".codeblock")) continue;

      var wrap = el("div", "codeblock");
      var bar = el("div", "codeblock-bar");
      var code = pre.querySelector("code");
      var cls = code ? (code.className || "") : "";
      var langMatch = cls.match(/language-([a-z0-9]+)/i);
      var lang = langMatch ? langMatch[1] : "";
      bar.appendChild(el("span", "codeblock-lang", lang || L("terminal", "terminal")));

      var btn = el("button", "copy");
      btn.type = "button";
      btn.innerHTML = ICON.copy + '<span><span class="only-en">Copy</span>'
                    + '<span class="only-ar">انسخ</span></span>';
      btn.addEventListener("click", function () {
        var target = this.closest(".codeblock").querySelector("pre");
        var text = target ? target.innerText : "";
        copyText(text, this);
      });
      bar.appendChild(btn);

      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(bar);
      wrap.appendChild(pre);
    }
  }

  function copyText(text, btn) {
    var done = function () {
      btn.classList.add("is-ok");
      var span = btn.querySelector("span");
      /* both languages back, not one — the button is bilingual in the DOM like
         everything else, and copying is no reason to make it otherwise */
      var old = span ? span.innerHTML : "";
      if (span) setLabel(span, "Copied", "تم النسخ");
      setTimeout(function () {
        btn.classList.remove("is-ok");
        if (span) span.innerHTML = old;
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }
  function fallback(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:absolute;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) {}
  }

  /* --- callouts: markdown blockquotes with a leading emoji ----------------- */
  function renderCallouts() {
    var bqs = document.querySelectorAll(".prose blockquote");
    for (var i = 0; i < bqs.length; i++) {
      var first = bqs[i].querySelector("p");
      if (!first) continue;
      var html = first.innerHTML;
      var kind = null;
      if (/^\s*(?:⚠️|⚠|🚫)/.test(html)) kind = "callout-warn";
      else if (/^\s*(?:💡|✅|🎯)/.test(html)) kind = "callout-tip";
      else if (/^\s*(?:📌|ℹ️|🔎)/.test(html)) kind = "callout-note";
      if (!kind) continue;
      bqs[i].classList.add("callout", kind);
    }
  }

  /* --- reveal on scroll --------------------------------------------------- */
  var revealObserver = null;
  function renderReveal() {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          entries[i].target.classList.add("is-in");
          revealObserver.unobserve(entries[i].target);
        }
      }, { rootMargin: "0px 0px -8% 0px", threshold: .06 });
    }
    var nodes = document.querySelectorAll(".reveal:not(.is-in)");
    for (var i = 0; i < nodes.length; i++) revealObserver.observe(nodes[i]);
  }

  /* ---------------------------------------------------------------- boot -- */
  function renderAll() {
    renderDashboard();
    renderCourses();
    renderPath();
    renderProgressPage();
    renderPractice();
  }

  function boot() {
    syncPressed();
    Progress.markDay();
    renderAll();
    renderLesson();
    renderGlossary();
    renderCode();
    renderCallouts();
    renderReveal();
    /* JS built the dashboard after the load event may already have fired */
    window.requestAnimationFrame(renderReveal);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
