/* =====================================================================
   app.js — application shell: router, sidebar, navbar, shared UI
   components (code blocks, accordions, tabs) and every page renderer.
   Content comes from data.js + js/content/*.js; interactive diagrams
   and labs from visualizer.js; SQL execution from sql-playground.js.
   ===================================================================== */
(function () {
  'use strict';
  var PGM = window.PGM = window.PGM || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = PGM.esc;
  var main;

  /* ------------------------------------------------------------------
     Derived data
     ------------------------------------------------------------------ */
  var ORDER = [];          // all lessons in course order
  var BY_ID = {};
  function prepare() {
    PGM.MODULES.forEach(function (m) {
      m.lessons = PGM.LESSONS.filter(function (l) { return l.module === m.id; });
      Array.prototype.push.apply(ORDER, m.lessons);
    });
    ORDER.forEach(function (l, i) { l.index = i; BY_ID[l.id] = l; });
    PGM.ORDER = ORDER; PGM.LESSON_BY_ID = BY_ID;
  }
  function level(n) { return PGM.LEVELS[(n || 1) - 1]; }
  function levelBadge(n, solid) {
    var L = level(n);
    return '<span class="badge' + (solid ? ' solid' : '') + '" style="color:' + L.color + (solid ? ';background:' + L.color + '22' : '') + '">' + esc(L.name) + '</span>';
  }

  /* ------------------------------------------------------------------
     Shared UI helpers
     ------------------------------------------------------------------ */
  PGM.copy = function (text) {
    var done = function () { toast('Copied to clipboard'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — select and copy manually'); }
      t.remove();
    }
  };
  /** In-page confirmation (native confirm() is blocked in sandboxed hosts): first click arms, second click confirms. */
  PGM.confirmClick = function (btn, armedLabel) {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; return true; }
    btn.dataset.label = btn.textContent; btn.dataset.armed = '1'; btn.textContent = armedLabel;
    setTimeout(function () { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
    return false;
  };
  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  PGM.toast = toast;

  /* Code store: code blocks reference their source by id (avoids escaping issues in attributes). */
  var CODE = [];
  /**
   * Render a code block with line numbers, highlighting, copy and (optionally) run.
   * opts: { lang, title, run (bool), expected (text shown if engine unavailable), plain (no highlight) }
   */
  PGM.codeBlock = function (code, opts) {
    opts = opts || {};
    code = String(code || '').replace(/\s+$/, '');
    var id = CODE.push({ code: code, expected: opts.expected }) - 1;
    var lines = code.split('\n').length;
    var lang = opts.lang || 'PostgreSQL';
    var isSql = !opts.plain && /sql|postgres/i.test(lang);
    return '<div class="code' + (opts.out ? ' out' : '') + '"><div class="code-head"><span class="code-lang">' + esc(lang) + '</span>' +
      (opts.title ? '<span class="code-title">' + esc(opts.title) + '</span>' : '') +
      '<div class="code-actions"><button data-code-act="copy" data-code="' + id + '" aria-label="Copy code">Copy</button>' +
      (isSql && !opts.out ? '<button data-code-act="open" data-code="' + id + '" aria-label="Open in SQL Playground">Playground</button>' : '') +
      (opts.run ? '<button class="run" data-code-act="run" data-code="' + id + '" aria-label="Run in PostgreSQL">▶ Run</button>' : '') +
      '</div></div><div class="code-body"><div class="code-gutter" aria-hidden="true">' +
      Array.from({ length: lines }, function (_, i) { return i + 1; }).join('<br>') + '</div><pre><code>' +
      (isSql ? PGM.SQL.highlight(code) : esc(code)) + '</code></pre></div>' +
      (opts.run ? '<div class="code-result" data-result="' + id + '" hidden></div>' : '') + '</div>';
  };
  function outBlock(text) { return text ? PGM.codeBlock(text, { lang: 'Output', out: true, plain: true }) : ''; }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-code-act]');
    if (b) {
      var c = CODE[+b.dataset.code]; if (!c) return;
      var act = b.dataset.codeAct;
      if (act === 'copy') PGM.copy(c.code);
      else if (act === 'open') { PGM.Playground.load(c.code); location.hash = '#/playground'; }
      else if (act === 'run') {
        var out = b.closest('.code').querySelector('[data-result="' + b.dataset.code + '"]');
        PGM.runInline(c.code, out, { expected: c.expected });
      }
      return;
    }
    var acc = e.target.closest('.acc > button');
    if (acc) { var a = acc.parentNode; a.classList.toggle('open'); acc.setAttribute('aria-expanded', a.classList.contains('open')); return; }
    var tab = e.target.closest('.tabs button[data-tab]');
    if (tab) {
      var group = tab.closest('[data-tabs]');
      $$('.tabs button', group).forEach(function (t) { t.setAttribute('aria-selected', t === tab); });
      $$('.tab-panel', group).forEach(function (p) { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    }
  });

  function acc(title, body, opts) {
    opts = opts || {};
    return '<div class="acc' + (opts.open ? ' open' : '') + '"><button aria-expanded="' + !!opts.open + '">' + (opts.num ? '<span class="qn">' + opts.num + '</span>' : '') +
      '<span>' + title + '</span><span class="chev">›</span></button><div class="acc-body">' + body + '</div></div>';
  }
  function tabs(items) {
    return '<div data-tabs><div class="tabs" role="tablist">' + items.map(function (t, i) {
      return '<button role="tab" data-tab="' + i + '" aria-selected="' + (i === 0) + '">' + t.label + '</button>';
    }).join('') + '</div>' + items.map(function (t, i) {
      return '<div class="tab-panel" role="tabpanel" data-panel="' + i + '"' + (i ? ' hidden' : '') + '>' + t.body + '</div>';
    }).join('') + '</div>';
  }
  function sectionTitle(t, extra) { return '<div class="section-title"><h2>' + t + '</h2><span class="line"></span>' + (extra || '') + '</div>'; }
  function qs() {
    var q = location.hash.split('?')[1] || '', o = {};
    q.split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) o[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
    return o;
  }
  function strip(h) { return String(h || '').replace(/<[^>]+>/g, ''); }
  function lessonDone(l) { return PGM.Progress.isDone(l.id); }
  function moduleCard(m) {
    var s = m.lessons.length, d = m.lessons.filter(lessonDone).length;
    return '<a class="card module-card" href="#/module/' + m.id + '"><div class="top"><span class="n">' + String(m.num).padStart(2, '0') + '</span>' + levelBadge(m.level) +
      '<span class="spacer"></span><span class="small muted">' + d + '/' + s + '</span></div><h3>' + esc(m.title) + '</h3><p>' + esc(m.desc) + '</p>' +
      '<div class="progress-bar"><span style="width:' + (s ? Math.round(100 * d / s) : 0) + '%"></span></div></a>';
  }
  function lessonRow(l) {
    var q = PGM.Progress.quiz(l.id);
    return '<a class="search-result" href="#/lesson/' + l.id + '"><div class="row"><span class="t">' + (lessonDone(l) ? '<span style="color:var(--success)">✓</span> ' : '') + esc(l.title) +
      '</span><span class="spacer"></span>' + levelBadge(l.level) + '<span class="chip">' + (l.minutes || 10) + ' min</span>' +
      (q ? '<span class="chip">quiz ' + q.score + '/' + q.total + '</span>' : '') + '</div><div class="d">' + esc(l.summary) + '</div></a>';
  }

  /* ------------------------------------------------------------------
     Sidebar
     ------------------------------------------------------------------ */
  var REF_LINKS = [
    ['#/', '⌂', 'Dashboard'], ['#/paths', '➜', 'Learning paths'], ['#/playground', '▶', 'SQL Playground'], ['#/labs', '◎', 'Interactive labs'],
    ['#/architecture', '▦', 'Architecture diagrams'], ['#/exercises', '✎', 'SQL exercises'], ['#/patterns', '≡', 'SQL pattern library'],
    ['#/cheatsheet', '⌘', 'Command cheat sheet'], ['#/rules', '§', 'Database design rules'], ['#/checklist', '☑', 'Production checklist'],
    ['#/troubleshooting', '⚠', 'Troubleshooting'], ['#/interview', '?', 'Interview questions'], ['#/design', '◇', 'Design interviews'],
    ['#/projects', '◫', 'Real-world projects'], ['#/final', '★', 'Final assessment']
  ];
  function renderSidebar() {
    var sb = $('#sidebar');
    var f = (sb.dataset.filter || '').toLowerCase(), lv = +(sb.dataset.level || 0);
    var html = '<div class="side-filter"><label class="sr-only" for="side-q">Filter lessons</label><input id="side-q" type="search" placeholder="Filter lessons…" value="' + esc(sb.dataset.filter || '') + '">' +
      '<label class="sr-only" for="side-lv">Level</label><select id="side-lv"><option value="0">All levels</option>' +
      PGM.LEVELS.map(function (L) { return '<option value="' + L.id + '"' + (lv === L.id ? ' selected' : '') + '>' + L.name + '</option>'; }).join('') + '</select></div>';
    html += '<div class="side-links">' + REF_LINKS.slice(0, 4).map(link).join('') + '</div>';
    html += '<div class="side-group-title">Course · 57 sections</div>';
    var open = JSON.parse(sb.dataset.open || '{}');
    PGM.MODULES.forEach(function (m) {
      var ls = m.lessons.filter(function (l) {
        return (!lv || l.level === lv) && (!f || l.title.toLowerCase().indexOf(f) >= 0 || m.title.toLowerCase().indexOf(f) >= 0);
      });
      if ((f || lv) && !ls.length) return;
      var d = m.lessons.filter(lessonDone).length;
      var isOpen = open[m.id] || !!f;
      html += '<div class="side-module' + (isOpen ? ' open' : '') + '" data-mod="' + m.id + '"><button aria-expanded="' + isOpen + '"><span class="num">' + m.num +
        '</span><span class="t">' + esc(m.title) + '</span><span class="mini' + (d && d === m.lessons.length ? ' done' : '') + '">' + d + '/' + m.lessons.length +
        '</span><span class="chev">›</span></button><ul class="side-lessons">' +
        '<li><a href="#/module/' + m.id + '"><span class="dot" style="background:transparent;border:1px solid var(--border-strong)"></span>Module overview</a></li>' +
        ls.map(function (l) {
          return '<li><a href="#/lesson/' + l.id + '" data-lesson="' + l.id + '" class="' + (lessonDone(l) ? 'done' : '') + '"><span class="dot"></span><span>' + esc(l.title) + '</span></a></li>';
        }).join('') + '</ul></div>';
    });
    html += '<div class="side-group-title">Practice & reference</div><div class="side-links">' + REF_LINKS.slice(4).map(link).join('') + '</div>';
    sb.innerHTML = html;
    function link(r) { return '<a href="' + r[0] + '"><span class="ico">' + r[1] + '</span>' + r[2] + '</a>'; }
    markSidebar();
  }
  function markSidebar() {
    var h = location.hash || '#/';
    $$('#sidebar a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === h.split('?')[0]); });
    var act = $('#sidebar a.active[data-lesson]');
    if (act) {
      var mod = act.closest('.side-module');
      if (mod && !mod.classList.contains('open')) mod.classList.add('open');
      var sb = $('#sidebar'), r = act.getBoundingClientRect(), sr = sb.getBoundingClientRect();
      if (r.top < sr.top || r.bottom > sr.bottom) act.scrollIntoView({ block: 'center' });
    }
  }
  function wireSidebar() {
    var sb = $('#sidebar');
    sb.addEventListener('click', function (e) {
      var b = e.target.closest('.side-module > button');
      if (b) {
        var m = b.parentNode; m.classList.toggle('open');
        b.setAttribute('aria-expanded', m.classList.contains('open'));
        var open = JSON.parse(sb.dataset.open || '{}'); open[m.dataset.mod] = m.classList.contains('open'); sb.dataset.open = JSON.stringify(open);
        return;
      }
      if (e.target.closest('a')) document.body.classList.remove('drawer-open');
    });
    sb.addEventListener('input', function (e) {
      if (e.target.id === 'side-q') { sb.dataset.filter = e.target.value; renderSidebar(); var i = $('#side-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    });
    sb.addEventListener('change', function (e) { if (e.target.id === 'side-lv') { sb.dataset.level = e.target.value; renderSidebar(); } });
  }

  /* ------------------------------------------------------------------
     Navbar progress ring + theme
     ------------------------------------------------------------------ */
  function updateNavProgress() {
    var s = PGM.Progress.stats();
    var c = 2 * Math.PI * 9, off = c * (1 - s.pct / 100);
    $('#nav-progress').innerHTML = '<svg class="ring" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="none" stroke="var(--surface-3)" stroke-width="3"/>' +
      '<circle cx="11" cy="11" r="9" fill="none" stroke="var(--success)" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) +
      '" transform="rotate(-90 11 11)"/></svg><span>' + s.pct + '% complete</span>';
    $('#nav-progress').setAttribute('aria-label', 'Course progress ' + s.pct + ' percent');
  }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('pgm.theme', t); } catch (e) { /* ignore */ }
    $('#theme-btn').setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    $('#theme-btn').innerHTML = t === 'dark'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  }

  /* ------------------------------------------------------------------
     Search modal (Ctrl+K or "/")
     ------------------------------------------------------------------ */
  function openSearch() {
    var m = $('#search-modal'); m.classList.add('open');
    var i = $('#modal-q'); i.value = ''; $('#modal-results').innerHTML = '<div class="empty small">Search lessons, commands, concepts, interview questions, labs…</div>'; i.focus();
  }
  function closeSearch() { $('#search-modal').classList.remove('open'); }
  function wireSearch() {
    var sel = 0;
    $('#search-btn').onclick = openSearch;
    $('#search-modal').addEventListener('click', function (e) { if (e.target.id === 'search-modal' || e.target.closest('#modal-results a')) closeSearch(); });
    $('#modal-q').addEventListener('input', function (e) {
      var q = e.target.value; sel = 0;
      var r = PGM.Search.query(q, 30);
      $('#modal-results').innerHTML = r.length ? r.map(function (x, i) {
        return '<a href="' + x.href + '" class="' + (i === 0 ? 'sel' : '') + '"><div class="row"><span class="t">' + PGM.Search.mark(x.title, q) + '</span><span class="spacer"></span><span class="chip">' +
          esc(x.category) + '</span></div><div class="d">' + esc(x.desc || '') + '</div></a>';
      }).join('') : (q ? '<div class="empty small">No results for “' + esc(q) + '”.</div>' : '');
    });
    $('#modal-q').addEventListener('keydown', function (e) {
      var items = $$('#modal-results a');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!items.length) return;
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach(function (a, i) { a.classList.toggle('sel', i === sel); }); items[sel].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (items[sel]) { location.hash = items[sel].getAttribute('href'); closeSearch(); }
        else { location.hash = '#/search?q=' + encodeURIComponent(e.target.value); closeSearch(); }
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSearch(); document.body.classList.remove('drawer-open'); }
      var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openSearch(); }
    });
  }

  /* ------------------------------------------------------------------
     Pages
     ------------------------------------------------------------------ */
  var Pages = {};

  Pages.dashboard = function () {
    var s = PGM.Progress.stats();
    var lastId = PGM.Progress.last();
    var cont = BY_ID[lastId] || ORDER.find(function (l) { return !lessonDone(l); }) || ORDER[0];
    var cm = PGM.MODULE_BY_ID[cont.module];
    var cmDone = cm.lessons.filter(lessonDone).length;
    var featured = ['indexes-what-is-an-index', 'mvcc-tuple-versions', 'explain-analyze', 'pgvector-hnsw-index', 'sharding-shard-key', 'window-functions-ranking'];
    var html = '<div class="page">' +
      '<section class="hero"><svg class="hero-art" viewBox="0 0 220 160" aria-hidden="true"><defs><linearGradient id="hg" x1="0" x2="1"><stop offset="0" stop-color="var(--primary)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>' +
      '<g fill="none" stroke="url(#hg)" stroke-width="2"><ellipse cx="110" cy="30" rx="70" ry="18"/><path d="M40 30v90c0 10 31 18 70 18s70-8 70-18V30"/><path d="M40 60c0 10 31 18 70 18s70-8 70-18M40 90c0 10 31 18 70 18s70-8 70-18"/></g>' +
      '<g fill="var(--accent)"><circle cx="70" cy="108" r="3"/><circle cx="90" cy="112" r="3"/><circle cx="110" cy="113" r="3"/></g></svg>' +
      '<div class="eyebrow">PostgreSQL Mastery · Beginner → Architect</div><h1>Master PostgreSQL from <span>Zero to Production</span></h1>' +
      '<p>Learn SQL, database internals, performance engineering, replication, sharding, vector search and production architecture — with a real PostgreSQL 18 engine running right in your browser.</p>' +
      '<div class="row"><a class="btn primary" href="#/lesson/' + cont.id + '">' + (s.lessonsDone ? 'Continue learning' : 'Start the course') + ' →</a><a class="btn" href="#/playground">Open SQL Playground</a><a class="btn ghost" href="#/paths">Choose a learning path</a></div></section>' +
      '<div class="kpi-row" style="margin-top:16px">' +
      kpi('Course progress', s.pct + '%', s.lessonsDone + ' of ' + s.lessonsTotal + ' lessons', s.pct) +
      kpi('SQL exercises', s.problemsSolved + ' / ' + s.problemsTotal, 'LeetCode-style problems solved', s.problemsTotal ? Math.round(100 * s.problemsSolved / s.problemsTotal) : 0) +
      kpi('Quiz score', s.quizzesTaken ? s.quizAvg + '%' : '—', s.quizzesTaken + ' quizzes taken', s.quizAvg) +
      kpi('Projects explored', s.projectsViewed + ' / ' + s.projectsTotal, 'real-world database projects', s.projectsTotal ? Math.round(100 * s.projectsViewed / s.projectsTotal) : 0) + '</div>' +
      '<div class="card continue" style="margin-top:16px"><div><div class="eyebrow">Continue learning</div><h2 style="margin:0 0 4px">' + esc(cont.title) + '</h2>' +
      '<div class="lesson-meta">' + levelBadge(cont.level) + '<span>Module ' + cm.num + ' · ' + esc(cm.title) + '</span><span>·</span><span>Module progress ' + Math.round(100 * cmDone / cm.lessons.length) + '%</span></div>' +
      '<div class="progress-bar" style="margin-top:10px;max-width:520px"><span style="width:' + Math.round(100 * cmDone / cm.lessons.length) + '%"></span></div></div>' +
      '<a class="btn primary" href="#/lesson/' + cont.id + '">Continue</a></div>';

    html += sectionTitle('Explore the platform') + '<div class="grid c4">' + [
      ['▶', 'SQL Playground', 'Real PostgreSQL 18 + pgvector in the browser, with company_db.', '#/playground'],
      ['◎', 'Interactive labs', 'B-tree, query plans, transactions, MVCC, sharding, vector search.', '#/labs'],
      ['▦', 'Architecture', '24 clickable diagrams from processes to production clusters.', '#/architecture'],
      ['✎', 'SQL exercises', (PGM.PROBLEMS || []).length + ' problems with hints and optimized solutions.', '#/exercises'],
      ['⚡', 'Performance', 'EXPLAIN, indexing, tuning and real production scenarios.', '#/performance'],
      ['⚙', 'Internals', 'Pages, tuples, MVCC, WAL, buffers and processes.', '#/internals'],
      ['?', 'Interview prep', countInterview() + ' questions plus ' + (PGM.SYSTEM_DESIGN || []).length + ' system design problems.', '#/interview'],
      ['★', 'Final assessment', '100 certification-style questions with a level rating.', '#/final']
    ].map(function (f) { return '<a class="card feature-card" href="' + f[3] + '"><div class="ico">' + f[0] + '</div><h3>' + f[1] + '</h3><p>' + f[2] + '</p></a>'; }).join('') + '</div>';

    html += sectionTitle('Learning paths', '<a class="small" href="#/paths">All paths →</a>') + '<div class="grid c3">' + PGM.PATHS.slice(0, 5).map(pathCard).join('') + '</div>';

    html += sectionTitle('Featured concepts') + '<div class="grid c3">' + featured.map(function (id) {
      var m = PGM.MODULE_BY_ID[id]; var l = BY_ID[id];
      if (l) return '<a class="card module-card" href="#/lesson/' + l.id + '"><div class="top">' + levelBadge(l.level) + '</div><h3>' + esc(l.title) + '</h3><p>' + esc(l.summary) + '</p></a>';
      return m ? moduleCard(m) : '';
    }).join('') + '</div>';

    html += sectionTitle('Course modules by level', '<a class="small" href="#/learn">Full curriculum →</a>');
    PGM.LEVELS.forEach(function (L) {
      var ms = PGM.MODULES.filter(function (m) { return m.level === L.id; });
      html += '<div class="level-band"><div class="level-band-head"><h2 style="color:' + L.color + '">Level ' + L.id + ' — ' + L.name + '</h2><span class="muted small">' + esc(L.blurb) + '</span></div><div class="grid c3">' +
        ms.map(moduleCard).join('') + '</div></div>';
    });

    html += sectionTitle('Quick SQL reference') + '<div class="grid c2">' +
      PGM.codeBlock("-- Top 3 earners per department\nSELECT dept, first_name, salary\nFROM (\n  SELECT d.name AS dept, e.first_name, e.salary,\n         rank() OVER (PARTITION BY d.id ORDER BY e.salary DESC) AS r\n  FROM employees e JOIN departments d ON d.id = e.department_id\n) t\nWHERE r <= 3;", { title: 'Window functions', run: true }) +
      PGM.codeBlock("-- Upsert: insert or update in one statement\nINSERT INTO products (sku, name, category, price)\nVALUES ('SKU-9999', 'Desk Lamp', 'furniture', 1499)\nON CONFLICT (sku)\nDO UPDATE SET price = EXCLUDED.price\nRETURNING id, sku, price;", { title: 'INSERT … ON CONFLICT', run: true }) +
      '</div></div>';
    main.innerHTML = html;
    function kpi(label, value, sub, pct) {
      return '<div class="card stat"><span class="label">' + label + '</span><span class="value">' + value + '</span><span class="sub">' + sub + '</span>' +
        '<div class="progress-bar" style="margin-top:6px"><span style="width:' + (pct || 0) + '%"></span></div></div>';
    }
  };
  function countInterview() { var n = 0, I = PGM.INTERVIEW || {}; Object.keys(I).forEach(function (k) { n += I[k].length; }); return n; }
  function pathCard(p) {
    return '<div class="card path-card"><div class="row"><span class="ico" style="font-size:1.2rem;color:var(--accent)">' + p.icon + '</span><h3 style="margin:0">' + esc(p.name) + '</h3></div>' +
      '<p class="muted small" style="margin:6px 0 0">' + esc(p.desc) + '</p><div class="steps">' + p.modules.map(function (id, i) {
        var m = PGM.MODULE_BY_ID[id];
        var d = m.lessons.length && m.lessons.every(lessonDone);
        return (i ? '<span class="arrow">→</span>' : '') + '<a class="chip" href="#/module/' + id + '"' + (d ? ' style="border-color:var(--success);color:var(--success)"' : '') + '>' + esc(m.title) + '</a>';
      }).join('') + '</div></div>';
  }

  Pages.paths = function () {
    main.innerHTML = '<div class="page"><div class="page-head"><div class="eyebrow">Guided</div><h1>Learning paths</h1><p>Pick the path that matches your role. Each path is an ordered list of modules; completed modules turn green.</p></div>' +
      '<div class="grid c2">' + PGM.PATHS.map(pathCard).join('') + '</div>' +
      sectionTitle('Levels') + '<div class="grid c3">' + PGM.LEVELS.map(function (L) {
        var ls = ORDER.filter(function (l) { return l.level === L.id; });
        return '<div class="card"><h3 style="color:' + L.color + '">Level ' + L.id + ' · ' + L.name + '</h3><p class="muted small">' + esc(L.blurb) + '</p><div class="small">' + ls.length + ' lessons · ' +
          ls.filter(lessonDone).length + ' completed</div></div>';
      }).join('') + '</div></div>';
  };

  Pages.learn = function () {
    var html = '<div class="page"><div class="page-head"><div class="eyebrow">Curriculum</div><h1>Learn PostgreSQL A → Z</h1><p>' + PGM.MODULES.length + ' sections and ' + ORDER.length +
      ' lessons across seven levels. Every lesson follows the same structure: objectives, concept, why it exists, real-world use, syntax, three runnable examples, mistakes, best practices, performance, security, interview questions, exercises, a challenge and a quiz.</p></div>';
    PGM.LEVELS.forEach(function (L) {
      var ms = PGM.MODULES.filter(function (m) { return m.level === L.id; });
      html += '<div class="level-band"><div class="level-band-head"><h2 style="color:' + L.color + '">' + L.name + '</h2><span class="muted small">' + esc(L.blurb) + '</span></div>';
      html += ms.map(function (m) {
        return acc('<span class="n" style="font-family:var(--mono);color:var(--faint);margin-right:8px">' + String(m.num).padStart(2, '0') + '</span>' + esc(m.title) +
          ' <span class="muted small" style="font-weight:400">· ' + m.lessons.length + ' lessons · ' + m.lessons.filter(lessonDone).length + ' done</span>',
          '<p class="muted small">' + esc(m.desc) + '</p>' + m.lessons.map(lessonRow).join('') + '<p style="margin-top:10px"><a href="#/module/' + m.id + '">Module overview & quiz →</a></p>');
      }).join('') + '</div>';
    });
    main.innerHTML = html + '</div>';
  };

  Pages.module = function (id) {
    var m = PGM.MODULE_BY_ID[id]; if (!m) return Pages.notFound();
    var quizQs = [];
    m.lessons.forEach(function (l) { (l.quiz || []).slice(0, 2).forEach(function (q) { quizQs.push(q); }); });
    var idx = PGM.MODULES.indexOf(m), prev = PGM.MODULES[idx - 1], next = PGM.MODULES[idx + 1];
    var d = m.lessons.filter(lessonDone).length;
    main.innerHTML = '<div class="page narrow"><div class="breadcrumbs"><a href="#/learn">Learn</a>›<span>Module ' + m.num + '</span></div>' +
      '<div class="page-head"><div class="row">' + levelBadge(m.level, true) + '<span class="chip">' + m.lessons.length + ' lessons</span><span class="chip">' +
      m.lessons.reduce(function (a, l) { return a + (l.minutes || 10); }, 0) + ' min</span></div><h1 style="margin-top:10px">' + m.num + '. ' + esc(m.title) + '</h1><p>' + esc(m.desc) + '</p>' +
      '<div class="progress-bar" style="max-width:420px"><span style="width:' + Math.round(100 * d / Math.max(1, m.lessons.length)) + '%"></span></div><p class="small muted" style="margin-top:6px">' + d + ' of ' + m.lessons.length + ' completed</p></div>' +
      sectionTitle('Lessons') + m.lessons.map(lessonRow).join('') +
      (quizQs.length ? sectionTitle('Module quiz') + '<div id="module-quiz"></div>' : '') +
      '<div class="prevnext">' + (prev ? '<a href="#/module/' + prev.id + '"><div class="dir">← Previous module</div>' + esc(prev.title) + '</a>' : '<span></span>') +
      (next ? '<a class="next" href="#/module/' + next.id + '"><div class="dir">Next module →</div>' + esc(next.title) + '</a>' : '<span></span>') + '</div></div>';
    if (quizQs.length) PGM.Quiz.render($('#module-quiz'), quizQs, { id: 'module:' + m.id });
  };

  /* ---------- Lesson page: the 22-part structure ---------- */
  Pages.lesson = function (id) {
    var l = BY_ID[id]; if (!l) return Pages.notFound();
    var m = PGM.MODULE_BY_ID[l.module];
    var prev = ORDER[l.index - 1], next = ORDER[l.index + 1];
    PGM.Progress.setLast(l.id);
    var n = 0, toc = [];
    function sec(key, title, body) {
      if (!body) return '';
      n++; toc.push([key, title]);
      return '<section class="lesson-section" id="s-' + key + '"><h2><span class="n">' + String(n).padStart(2, '0') + '</span>' + title + '</h2>' + body + '</section>';
    }
    function prose(h) { return h ? '<div class="prose">' + h + '</div>' : ''; }
    function list(items, cls) { return items && items.length ? '<ul class="check-list ' + cls + '">' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : ''; }

    var ex = (l.examples || []).map(function (e) {
      return { label: esc(e.label), body: '<h3>' + esc(e.title || e.label) + '</h3>' + PGM.codeBlock(e.sql, { title: e.label + ' example', run: !!e.run, expected: e.output }) +
        prose(e.explain) + '<div class="output-label">Expected output</div>' + outBlock(e.output) };
    });
    var compare = l.compare ? '<div class="compare"><div class="bad"><h4>✕ Avoid this</h4>' + PGM.codeBlock(l.compare.bad.sql, { run: !!l.compare.bad.run }) + '<p class="small">' + l.compare.bad.why + '</p></div>' +
      '<div class="good"><h4>✓ Do this</h4>' + PGM.codeBlock(l.compare.good.sql, { run: !!l.compare.good.run }) + '<p class="small">' + l.compare.good.why + '</p></div></div>' : '';
    var widgets = (l.widgets || []).map(function (w) { return '<div class="widget-slot" data-widget="' + esc(w) + '"></div>'; }).join('');
    var scenario = l.scenario ? '<div class="card scenario"><h3>' + esc(l.scenario.title) + '</h3><ol>' + l.scenario.steps.map(function (s) { return '<li>' + s.replace(/^\s*\d+[.)]\s*/, '') + '</li>'; }).join('') + '</ol></div>' : '';
    var interview = (l.interview || []).map(function (q, i) { return acc(esc(q.q), prose(q.a), { num: 'Q' + (i + 1) }); }).join('');
    var exercises = (l.exercises || []).map(function (x, i) {
      return '<div class="card"><div class="row"><strong>Exercise ' + (i + 1) + '</strong><span class="spacer"></span>' + (x.run ? '<span class="chip">runnable</span>' : '') + '</div>' +
        '<div class="prose" style="margin-top:6px">' + x.task + '</div><div class="q-write"><label class="sr-only" for="ex-' + i + '">Your answer</label><textarea id="ex-' + i + '" class="sql-input" spellcheck="false" placeholder="-- write your SQL, then run it"></textarea>' +
        '<div class="row" style="margin-top:8px"><button class="btn sm primary" data-try="' + i + '">▶ Run my SQL</button></div><div class="code-result" data-tryout="' + i + '" hidden></div></div>' +
        acc('Show solution', PGM.codeBlock(x.solution, { run: !!x.run })) + '</div>';
    }).join('');
    var ch = l.challenge ? '<div class="card" style="border-color:var(--warning)"><div class="row"><span class="badge" style="color:var(--warning)">CHALLENGE</span></div><div class="prose" style="margin-top:8px">' + l.challenge.task + '</div>' +
      (l.challenge.hint ? acc('Hint', '<p>' + l.challenge.hint + '</p>') : '') + acc('Solution', PGM.codeBlock(l.challenge.solution, { run: !!l.challenge.run })) + '</div>' : '';
    var related = (l.related || []).map(function (r) {
      var rl = BY_ID[r], rm = PGM.MODULE_BY_ID[r];
      if (rl) return '<a class="chip" href="#/lesson/' + rl.id + '">' + esc(rl.title) + '</a>';
      if (rm) return '<a class="chip" href="#/module/' + rm.id + '">Module: ' + esc(rm.title) + '</a>';
      return '';
    }).join(' ');

    var body =
      sec('objectives', 'Learning objectives', '<ul class="objectives">' + (l.objectives || []).map(function (o) { return '<li>' + o + '</li>'; }).join('') + '</ul>') +
      sec('concept', 'Concept', prose(l.concept)) +
      sec('why', 'Why it exists', prose(l.why)) +
      sec('usecase', 'Real-world use case', prose(l.useCase)) +
      sec('internals', 'How it works internally', prose(l.internals)) +
      sec('syntax', 'Syntax', PGM.codeBlock(l.syntax, { title: 'Syntax' })) +
      sec('examples', 'Examples: basic → intermediate → advanced', ex.length ? tabs(ex) : '') +
      sec('compare', 'Avoid this vs. do this', compare) +
      sec('interactive', 'Interactive', widgets) +
      sec('whennot', 'When NOT to use it', prose(l.whenNot)) +
      sec('mistakes', 'Common mistakes', list(l.mistakes, 'bad')) +
      sec('best', 'Best practices', list(l.best, 'good')) +
      sec('performance', 'Performance considerations', prose(l.performance)) +
      sec('security', 'Security considerations', prose(l.security)) +
      sec('scenario', 'Production scenario', scenario) +
      sec('interview', 'Interview questions', interview) +
      sec('exercises', 'Practice exercises', exercises) +
      sec('challenge', 'Challenge problem', ch) +
      sec('quiz', 'Quiz', '<div id="lesson-quiz"></div>') +
      sec('related', 'Related topics', related ? '<div class="row">' + related + '</div>' : '');

    var done = lessonDone(l);
    main.innerHTML = '<div class="page"><div class="lesson-layout"><article>' +
      '<div class="breadcrumbs"><a href="#/learn">Learn</a>›<a href="#/module/' + m.id + '">' + m.num + '. ' + esc(m.title) + '</a>›<span>Lesson ' + (m.lessons.indexOf(l) + 1) + ' of ' + m.lessons.length + '</span></div>' +
      '<header class="lesson-header"><h1>' + esc(l.title) + '</h1><div class="lesson-meta">' + levelBadge(l.level, true) + '<span>⏱ ' + (l.minutes || 10) + ' min</span><span>·</span><span>' +
      esc(m.title) + '</span>' + (lessonDone(l) ? '<span class="badge" style="color:var(--success)">✓ Completed</span>' : '') + '</div><p class="muted" style="margin-top:10px">' + esc(l.summary) + '</p></header>' +
      '<div class="engine-status" id="lesson-engine" style="margin-top:10px"><span class="dotl"></span><span class="msg small"></span></div>' +
      body +
      '<div class="lesson-complete"><div><strong>' + (done ? 'Lesson completed ✓' : 'Finished this lesson?') + '</strong><div class="small muted">Completion feeds your course progress.</div></div>' +
      '<button class="btn ' + (done ? '' : 'success') + '" id="complete-btn">' + (done ? 'Mark as not complete' : 'Mark as complete') + '</button></div>' +
      '<nav class="prevnext" aria-label="Lesson navigation">' + (prev ? '<a href="#/lesson/' + prev.id + '"><div class="dir">← Previous lesson</div>' + esc(prev.title) + '</a>' : '<span></span>') +
      (next ? '<a class="next" href="#/lesson/' + next.id + '"><div class="dir">Next lesson →</div>' + esc(next.title) + '</a>' : '<span></span>') + '</nav>' +
      '</article><aside class="lesson-toc" aria-label="On this page"><div class="h">On this page</div>' +
      toc.map(function (t) { return '<a href="#/lesson/' + l.id + '?s=' + t[0] + '" data-s="' + t[0] + '">' + t[1] + '</a>'; }).join('') + '</aside></div></div>';

    PGM.Quiz.render($('#lesson-quiz'), l.quiz || [], { id: l.id });
    $('#complete-btn').onclick = function () {
      PGM.Progress.complete(l.id, !lessonDone(l));
      if (lessonDone(l)) { toast('Lesson completed — nice work!'); if (next) location.hash = '#/lesson/' + next.id; else Pages.lesson(id); }
      else Pages.lesson(id);
    };
    main.addEventListener('click', tryHandler);
    function tryHandler(e) {
      var b = e.target.closest('[data-try]'); if (!b) return;
      var i = b.dataset.try, sql = $('#ex-' + i).value;
      if (sql.trim()) PGM.runInline(sql, $('[data-tryout="' + i + '"]'));
    }
    // engine status line
    var es = $('#lesson-engine');
    PGM.db.onChange(function (d) {
      if (!document.body.contains(es)) return;
      es.className = 'engine-status ' + (d.state === 'ready' ? 'ready' : d.state === 'loading' ? 'loading' : d.state === 'error' ? 'demo' : '');
      es.querySelector('.msg').innerHTML = d.state === 'idle' ? 'Examples marked <strong>▶ Run</strong> execute in real PostgreSQL in your browser against <code>company_db</code> (changes are rolled back).' : esc(d.message);
    });
    // TOC scroll-spy
    var secs = $$('.lesson-section');
    var spy = function () {
      var y = window.scrollY + 120, cur = secs[0];
      secs.forEach(function (s) { if (s.offsetTop <= y) cur = s; });
      $$('.lesson-toc a').forEach(function (a) { a.classList.toggle('active', cur && a.dataset.s === cur.id.slice(2)); });
    };
    window.onscroll = spy; spy();
  };

  /* ---------- Exercises ---------- */
  Pages.exercises = function () {
    var P = PGM.PROBLEMS || [];
    var topics = Array.from(new Set(P.map(function (p) { return p.topic; })));
    main.innerHTML = '<div class="page"><div class="page-head"><div class="eyebrow">Practice</div><h1>SQL Exercises</h1><p>' + P.length +
      ' LeetCode-style problems on <code>company_db</code>. Each has a hint, a solution, an optimized solution and an explanation — and you can run everything in PostgreSQL.</p></div>' +
      '<div class="filters"><input type="search" id="ex-q" placeholder="Search problems…" aria-label="Search problems"><select id="ex-d" aria-label="Difficulty"><option value="">All difficulties</option><option>Easy</option><option>Medium</option><option>Hard</option></select>' +
      '<select id="ex-t" aria-label="Topic"><option value="">All topics</option>' + topics.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div><div id="ex-list"></div></div>';
    function draw() {
      var q = $('#ex-q').value.toLowerCase(), d = $('#ex-d').value, t = $('#ex-t').value;
      var list = P.filter(function (p) { return (!d || p.difficulty === d) && (!t || p.topic === t) && (!q || (p.title + ' ' + p.topic + ' ' + strip(p.statement)).toLowerCase().indexOf(q) >= 0); });
      $('#ex-list').innerHTML = list.map(function (p, i) {
        return '<a class="search-result" href="#/problem/' + p.id + '"><div class="row"><span class="t">' + (PGM.Progress.isSolved(p.id) ? '<span style="color:var(--success)">✓</span> ' : '') + esc(p.title) +
          '</span><span class="spacer"></span><span class="badge diff-' + p.difficulty + '">' + p.difficulty + '</span><span class="chip">' + esc(p.topic) + '</span></div><div class="d">' + esc(strip(p.statement).slice(0, 170)) + '…</div></a>';
      }).join('') || '<div class="empty">No problems match.</div>';
    }
    ['#ex-q', '#ex-d', '#ex-t'].forEach(function (s) { $(s).addEventListener('input', draw); });
    draw();
  };
  Pages.problem = function (id) {
    var P = PGM.PROBLEMS || [], i = P.findIndex(function (p) { return p.id === id; }), p = P[i];
    if (!p) return Pages.notFound();
    var setup = p.setup ? p.setup.trim() + '\n\n' : '';
    main.innerHTML = '<div class="page narrow"><div class="breadcrumbs"><a href="#/exercises">Exercises</a>›<span>' + esc(p.topic) + '</span></div>' +
      '<div class="page-head"><div class="row"><span class="badge diff-' + p.difficulty + '">' + p.difficulty + '</span><span class="chip">' + esc(p.topic) + '</span></div><h1 style="margin-top:8px">' + esc(p.title) + '</h1></div>' +
      '<div class="card prose">' + p.statement + '</div>' +
      (p.schema ? '<h3 style="margin-top:20px">Schema</h3>' + PGM.codeBlock(p.schema, { lang: 'Schema', plain: true }) : '') +
      (p.setup ? '<h3>Setup (creates the tables for this problem)</h3>' + PGM.codeBlock(p.setup, { run: true }) : '') +
      (p.sampleData ? '<h3>Sample data</h3>' + outBlock(p.sampleData) : '') +
      '<h3>Expected output</h3>' + outBlock(p.expected) +
      '<h3>Your solution</h3><textarea class="sql-input" id="prob-sql" spellcheck="false" placeholder="-- write your query here"></textarea>' +
      '<div class="row" style="margin:8px 0"><button class="btn primary" id="prob-run">▶ Run</button><button class="btn" id="prob-check">Check against solution</button>' +
      '<button class="btn ghost" id="prob-solved">' + (PGM.Progress.isSolved(p.id) ? '✓ Solved (undo)' : 'Mark as solved') + '</button></div><div class="code-result" id="prob-out" hidden></div>' +
      acc('💡 Hint', '<p>' + esc(p.hint) + '</p>') + acc('Solution', PGM.codeBlock(p.solution, { run: true })) +
      (p.optimized ? acc('Optimized solution', PGM.codeBlock(p.optimized, { run: true })) : '') +
      acc('Explanation', '<div class="prose">' + p.explanation + '</div>') +
      '<div class="prevnext">' + (P[i - 1] ? '<a href="#/problem/' + P[i - 1].id + '"><div class="dir">← Previous</div>' + esc(P[i - 1].title) + '</a>' : '<span></span>') +
      (P[i + 1] ? '<a class="next" href="#/problem/' + P[i + 1].id + '"><div class="dir">Next →</div>' + esc(P[i + 1].title) + '</a>' : '<span></span>') + '</div></div>';
    // solution code blocks that need the setup: prepend it at run time
    $$('[data-code-act="run"]').forEach(function (b) { var c = CODE[+b.dataset.code]; if (setup && c.code.indexOf(p.setup.trim()) !== 0 && c.code !== p.setup.trim()) c.code = setup + c.code; });
    $('#prob-run').onclick = function () { var s = $('#prob-sql').value; if (s.trim()) PGM.runInline(setup + s, $('#prob-out')); };
    $('#prob-check').onclick = function () {
      var s = $('#prob-sql').value; if (!s.trim()) return;
      var out = $('#prob-out'); out.hidden = false; out.innerHTML = '<div class="result-meta">Checking…</div>';
      Promise.all([PGM.db.exec(setup + s, { sandbox: true }), PGM.db.exec(setup + p.solution, { sandbox: true })]).then(function (r) {
        var a = r[0][r[0].length - 1], b = r[1][r[1].length - 1];
        var ok = a && b && !a.error && !b.error && JSON.stringify(a.arrays) === JSON.stringify(b.arrays);
        var okUnordered = !ok && a && b && !a.error && !b.error && JSON.stringify(a.arrays.map(JSON.stringify).sort()) === JSON.stringify(b.arrays.map(JSON.stringify).sort());
        out.innerHTML = '<div class="result-meta"><span class="' + (ok || okUnordered ? 'ok' : 'err') + '">' + (ok ? '✓ Correct — your result matches the expected output exactly.' : okUnordered ? '✓ Same rows, different order — check your ORDER BY.' : '✕ Result differs from the expected output.') + '</span></div>' + PGM.renderResults(r[0], { maxRows: 50 });
        if (ok) { PGM.Progress.solve(p.id); $('#prob-solved').textContent = '✓ Solved (undo)'; toast('Problem solved!'); }
      }).catch(function () { out.innerHTML = '<div class="result-error">' + esc(PGM.db.message) + '</div>'; });
    };
    $('#prob-solved').onclick = function () { PGM.Progress.solve(p.id, !PGM.Progress.isSolved(p.id)); Pages.problem(id); };
  };

  Pages.patterns = function () {
    var P = PGM.PATTERNS || [], want = qs().id;
    main.innerHTML = '<div class="page narrow"><div class="page-head"><div class="eyebrow">Reference</div><h1>SQL Pattern Library</h1><p>Ready-to-use, tested PostgreSQL patterns for everyday problems. Every pattern runs against <code>company_db</code>.</p></div>' +
      '<div class="filters"><input type="search" id="pat-q" placeholder="Filter patterns…" aria-label="Filter patterns"></div><div id="pat-list"></div></div>';
    function draw() {
      var q = $('#pat-q').value.toLowerCase();
      $('#pat-list').innerHTML = P.filter(function (p) { return !q || (p.title + ' ' + p.category + ' ' + p.sql).toLowerCase().indexOf(q) >= 0; }).map(function (p) {
        return '<div id="pat-' + p.id + '">' + acc(esc(p.title) + ' <span class="chip" style="margin-left:6px">' + esc(p.category || '') + '</span>', PGM.codeBlock(p.sql, { run: !!p.run }) + '<div class="prose">' + p.explain + '</div>', { open: p.id === want }) + '</div>';
      }).join('');
    }
    $('#pat-q').addEventListener('input', draw); draw();
    if (want && $('#pat-' + want)) $('#pat-' + want).scrollIntoView();
  };

  /* ---------- Visual pages ---------- */
  Pages.architecture = function () {
    var V = PGM.Visual, keys = V.ARCH_PAGE || Object.keys(V.DIAGRAMS), want = qs().d;
    main.innerHTML = '<div class="page"><div class="page-head"><div class="eyebrow">Visual</div><h1>Architecture diagrams</h1><p>Click any component to see what it does. Third-party tools and extensions are labelled as such.</p></div>' +
      '<div class="filters" id="arch-chips">' + keys.map(function (k) { return '<button class="chip' + (k === want ? ' active' : '') + '" data-d="' + k + '">' + esc(V.DIAGRAMS[k].title) + '</button>'; }).join('') + '</div>' +
      keys.map(function (k) { return '<section class="card" id="d-' + k + '" style="margin-bottom:16px"><h2>' + esc(V.DIAGRAMS[k].title) + '</h2><p class="muted">' + esc(V.DIAGRAMS[k].desc) + '</p>' + V.diagram(k) + '</section>'; }).join('') + '</div>';
    if (V.bind) V.bind(main);
    $('#arch-chips').onclick = function (e) { var b = e.target.closest('[data-d]'); if (b) $('#d-' + b.dataset.d).scrollIntoView({ behavior: 'smooth' }); };
    if (want && $('#d-' + want)) setTimeout(function () { $('#d-' + want).scrollIntoView(); }, 30);
  };
  Pages.labs = function () {
    var L = PGM.Visual.LABS;
    main.innerHTML = '<div class="page"><div class="page-head"><div class="eyebrow">Hands-on</div><h1>Interactive labs</h1><p>Simulations that make invisible database mechanics visible: index traversal, query plans, locks, snapshots, shard distribution and nearest-neighbour search.</p></div>' +
      '<div class="grid c3">' + Object.keys(L).map(function (k) { return '<a class="card feature-card" href="#/lab/' + k + '"><div class="ico">◎</div><h3>' + esc(L[k].title) + '</h3><p>' + esc(L[k].desc) + '</p></a>'; }).join('') + '</div></div>';
  };
  Pages.lab = function (k) {
    var L = PGM.Visual.LABS[k]; if (!L) return Pages.notFound();
    var keys = Object.keys(PGM.Visual.LABS), i = keys.indexOf(k);
    main.innerHTML = '<div class="page"><div class="breadcrumbs"><a href="#/labs">Labs</a>›<span>' + esc(L.title) + '</span></div><div class="page-head"><h1>' + esc(L.title) + '</h1><p>' + esc(L.desc) + '</p></div><div id="lab-mount"></div>' +
      '<div class="prevnext">' + (keys[i - 1] ? '<a href="#/lab/' + keys[i - 1] + '"><div class="dir">← Previous lab</div>' + esc(PGM.Visual.LABS[keys[i - 1]].title) + '</a>' : '<span></span>') +
      (keys[i + 1] ? '<a class="next" href="#/lab/' + keys[i + 1] + '"><div class="dir">Next lab →</div>' + esc(PGM.Visual.LABS[keys[i + 1]].title) + '</a>' : '<span></span>') + '</div></div>';
    PGM.Visual.mountLab(k, $('#lab-mount'));
  };
  function hub(title, eyebrow, intro, labs, diagrams, modules, extra) {
    var html = '<div class="page"><div class="page-head"><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p>' + intro + '</p></div>';
    html += '<div class="grid c3">' + labs.map(function (k) { var L = PGM.Visual.LABS[k]; return '<a class="card feature-card" href="#/lab/' + k + '"><div class="ico">◎</div><h3>' + esc(L.title) + '</h3><p>' + esc(L.desc) + '</p></a>'; }).join('') + '</div>';
    if (diagrams.length) html += sectionTitle('Diagrams') + diagrams.map(function (k) { return '<section class="card" style="margin-bottom:14px"><h3>' + esc(PGM.Visual.DIAGRAMS[k].title) + '</h3>' + PGM.Visual.diagram(k) + '</section>'; }).join('');
    html += extra || '';
    modules.forEach(function (id) { var m = PGM.MODULE_BY_ID[id]; html += sectionTitle(esc(m.title), '<a class="small" href="#/module/' + id + '">Module →</a>') + m.lessons.map(lessonRow).join(''); });
    main.innerHTML = html + '</div>';
    if (PGM.Visual.bind) PGM.Visual.bind(main);
  }
  Pages.performance = function () {
    var perf = (PGM.TROUBLESHOOTING || []).filter(function (t) { return /slow|cpu|io|memory|bloat|autovacuum|wal|connections/i.test(t.title); });
    var steps = ['Measure: find the queries that cost the most total time (pg_stat_statements).', 'EXPLAIN (ANALYZE, BUFFERS) the worst offenders.', 'Check indexes: missing, unused, wrong column order, non-sargable predicates.',
      'Check statistics: estimated vs actual rows; ANALYZE; CREATE STATISTICS for correlated columns.', 'Check bloat and vacuum health (n_dead_tup, last_autovacuum).', 'Check locks and waits (pg_stat_activity.wait_event, pg_blocking_pids).',
      'Check IO and memory: cache hit ratio, temp files (work_mem), checkpoints.', 'Consider partitioning for very large, time-based tables.', 'Offload reads to replicas; add a connection pooler.', 'Only then consider sharding / distributed PostgreSQL.'];
    hub('Performance engineering', 'Speed', 'Everything about making PostgreSQL fast — reading plans, choosing indexes, tuning configuration and handling real production slowdowns.',
      ['plan', 'index', 'btree'], ['query-pipeline'], ['explain', 'query-optimization', 'indexes', 'advanced-indexing', 'query-analysis', 'production-optimization'],
      sectionTitle('Playbook: “500 million rows and queries became slow”') + '<div class="card scenario"><ol>' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>' +
      sectionTitle('Bad query vs good query') + '<div class="compare"><div class="bad"><h4>✕ Function on an indexed column</h4>' +
      PGM.codeBlock("EXPLAIN ANALYZE\nSELECT id, name\nFROM customers\nWHERE lower(email) = 'customer42@example.com';", { run: true }) +
      '<p class="small">The UNIQUE index is on <code>email</code>, not <code>lower(email)</code>, so PostgreSQL must evaluate the function on every row (sequential scan).</p></div>' +
      '<div class="good"><h4>✓ Expression index that matches the predicate</h4>' +
      PGM.codeBlock("CREATE INDEX idx_customers_lower_email ON customers (lower(email));\n\nEXPLAIN ANALYZE\nSELECT id, name\nFROM customers\nWHERE lower(email) = 'customer42@example.com';", { run: true }) +
      '<p class="small">The planner can now use an Index Scan. Index expressions must match the query expression exactly.</p></div></div>' +
      (perf.length ? sectionTitle('Troubleshooting') + perf.map(function (t) { return '<a class="search-result" href="#/troubleshooting?id=' + t.id + '"><span class="t">' + esc(t.title) + '</span><div class="d">' + esc((t.symptoms || []).map(strip).join('; ')) + '</div></a>'; }).join('') : ''));
  };
  Pages.internals = function () {
    hub('PostgreSQL internals', 'Under the hood', 'How PostgreSQL really works: processes and memory, 8 KB pages and tuple headers, MVCC visibility, the write-ahead log, vacuum and the system catalogs.',
      ['mvcc', 'btree', 'txn'], ['pg-arch', 'process-model', 'memory', 'storage-page', 'mvcc', 'wal'],
      ['internals', 'mvcc', 'wal', 'vacuum', 'transaction-internals', 'system-catalogs', 'locks']);
  };

  /* ---------- Search page ---------- */
  Pages.search = function () {
    var q = qs().q || '';
    main.innerHTML = '<div class="page narrow"><div class="page-head"><div class="eyebrow">Search</div><h1>Search everything</h1><p>Lessons, SQL commands, concepts, functions, index types, configuration, interview questions, patterns and examples.</p></div>' +
      '<div class="search-box"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<label class="sr-only" for="page-q">Search</label><input id="page-q" type="search" placeholder="e.g. covering index, SKIP LOCKED, hnsw, wraparound…" value="' + esc(q) + '"></div>' +
      '<div class="filters" id="s-kinds" style="margin-top:12px"></div><div id="s-results" style="margin-top:6px"></div></div>';
    var kind = '';
    function draw() {
      var v = $('#page-q').value, r = PGM.Search.query(v, 200);
      var counts = {}; r.forEach(function (x) { counts[x.category.split(' ·')[0]] = (counts[x.category.split(' ·')[0]] || 0) + 1; });
      $('#s-kinds').innerHTML = v ? '<button class="chip' + (!kind ? ' active' : '') + '" data-k="">All ' + r.length + '</button>' + Object.keys(counts).map(function (k) { return '<button class="chip' + (kind === k ? ' active' : '') + '" data-k="' + esc(k) + '">' + esc(k) + ' ' + counts[k] + '</button>'; }).join('') : '';
      var list = kind ? r.filter(function (x) { return x.category.split(' ·')[0] === kind; }) : r;
      $('#s-results').innerHTML = !v ? '<div class="empty">Type to search ' + ORDER.length + ' lessons, ' + (PGM.CHEATSHEET || []).length + ' commands and ' + countInterview() + ' interview questions.</div>' :
        list.length ? list.slice(0, 80).map(function (x) {
          return '<a class="search-result" href="' + x.href + '"><div class="row"><span class="t">' + PGM.Search.mark(x.title, v) + '</span><span class="spacer"></span>' + (x.level ? '<span class="chip">' + esc(x.level) + '</span>' : '') +
            '<span class="chip">' + esc(x.category) + '</span></div><div class="d">' + esc(x.desc || '') + '</div></a>';
        }).join('') : '<div class="empty">No results.</div>';
    }
    $('#page-q').addEventListener('input', function () { kind = ''; draw(); history.replaceState(null, '', '#/search?q=' + encodeURIComponent($('#page-q').value)); });
    $('#s-kinds').onclick = function (e) { var b = e.target.closest('[data-k]'); if (b) { kind = b.dataset.k; draw(); } };
    draw(); $('#page-q').focus();
  };

  /* ---------- Progress page ---------- */
  Pages.progress = function () {
    var s = PGM.Progress.stats();
    var bar = function (pct) { var n = Math.round(pct / 100 * 24); return '█'.repeat(n) + '░'.repeat(24 - n); };
    main.innerHTML = '<div class="page"><div class="page-head"><div class="eyebrow">You</div><h1>Your progress</h1></div>' +
      '<div class="card"><div style="font:600 1.05rem var(--mono);color:var(--text-strong)">PostgreSQL Mastery</div><div style="font:1.2rem var(--mono);color:var(--accent);letter-spacing:1px">' + bar(s.pct) + ' ' + s.pct + '%</div></div>' +
      '<div class="kpi-row" style="margin-top:14px">' +
      [['Lessons completed', s.lessonsDone + ' / ' + s.lessonsTotal], ['Modules completed', s.modulesDone + ' / ' + PGM.MODULES.length], ['Average quiz score', s.quizzesTaken ? s.quizAvg + '%' : '—'],
       ['Quizzes taken', s.quizzesTaken], ['Exercises solved', s.problemsSolved + ' / ' + s.problemsTotal], ['Queries run in playground', s.queries],
       ['Final assessment', s.final ? s.final.score + ' / ' + s.final.total : 'not taken']].map(function (k) {
        return '<div class="card stat"><span class="label">' + k[0] + '</span><span class="value">' + k[1] + '</span></div>';
      }).join('') + '</div>' +
      sectionTitle('By module') + '<div class="card"><table><thead><tr><th>#</th><th>Module</th><th>Level</th><th style="width:40%">Progress</th></tr></thead><tbody>' +
      PGM.MODULES.map(function (m, i) {
        var x = s.modules[i];
        return '<tr><td>' + m.num + '</td><td><a href="#/module/' + m.id + '">' + esc(m.title) + '</a></td><td>' + levelBadge(m.level) + '</td><td><div class="row"><div class="progress-bar" style="flex:1"><span style="width:' + x.pct + '%"></span></div><span class="small muted">' + x.done + '/' + x.total + '</span></div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      sectionTitle('Data') + '<div class="row"><button class="btn" id="pr-export">Export progress</button><button class="btn" id="pr-import">Import progress</button><button class="btn" id="pr-reset" style="color:var(--danger)">Reset progress</button></div>' +
      '<p class="small muted" style="margin-top:8px">Progress is stored in this browser only (localStorage).</p><textarea id="pr-box" class="sql-input" hidden></textarea></div>';
    $('#pr-export').onclick = function () { var b = $('#pr-box'); b.hidden = false; b.value = PGM.Progress.exportJSON(); b.select(); PGM.copy(b.value); };
    $('#pr-import').onclick = function () {
      var b = $('#pr-box');
      if (b.hidden) { b.hidden = false; b.value = ''; b.placeholder = 'Paste exported JSON, then click Import again'; b.focus(); return; }
      try { PGM.Progress.importJSON(b.value); toast('Progress imported'); Pages.progress(); } catch (e) { toast('Invalid JSON'); }
    };
    $('#pr-reset').onclick = function () { if (PGM.confirmClick(this, 'Click again to erase all progress')) { PGM.Progress.reset(); Pages.progress(); } };
  };

  /* ---------- Interview ---------- */
  Pages.interview = function () {
    var I = PGM.INTERVIEW || {}, p = qs();
    var cats = [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced'], ['postgresql', 'PostgreSQL-specific'], ['architecture', 'Database architecture'], ['performance', 'Performance'], ['scenario', 'Scenario-based']]
      .filter(function (c) { return I[c[0]] && I[c[0]].length; });
    var cur = p.cat && I[p.cat] ? p.cat : cats[0][0];
    main.innerHTML = '<div class="page narrow"><div class="page-head"><div class="eyebrow">Interview preparation</div><h1>' + countInterview() + ' interview questions with answers</h1>' +
      '<p>Grouped by difficulty and domain. Try answering out loud before expanding. See also <a href="#/design">database design interviews</a> and the <a href="#/final">final assessment</a>.</p></div>' +
      '<div class="filters">' + cats.map(function (c) { return '<button class="chip' + (c[0] === cur ? ' active' : '') + '" data-cat="' + c[0] + '">' + c[1] + ' · ' + I[c[0]].length + '</button>'; }).join('') + '</div>' +
      '<div class="filters"><input type="search" id="iv-q" placeholder="Filter questions…" aria-label="Filter questions"><button class="btn sm" id="iv-expand">Expand all</button></div><div id="iv-list"></div></div>';
    function draw() {
      var q = $('#iv-q').value.toLowerCase();
      $('#iv-list').innerHTML = I[cur].map(function (x, i) { return [x, i]; }).filter(function (p) { return !q || (p[0].q + ' ' + p[0].a).toLowerCase().indexOf(q) >= 0; }).map(function (p) {
        return '<div id="iv-' + p[1] + '">' + acc(esc(strip(p[0].q)), '<div class="prose">' + p[0].a + '</div>' + (p[0].tags ? '<div class="row">' + p[0].tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') + '</div>' : ''),
          { num: p[1] + 1, open: String(p[1]) === p.i }) + '</div>';
      }).join('');
    }
    $$('[data-cat]').forEach(function (b) { b.onclick = function () { location.hash = '#/interview?cat=' + b.dataset.cat; }; });
    $('#iv-q').addEventListener('input', draw);
    $('#iv-expand').onclick = function () { $$('#iv-list .acc').forEach(function (a) { a.classList.add('open'); }); };
    draw();
    if (p.i && $('#iv-' + p.i)) { $('#iv-' + p.i + ' .acc').classList.add('open'); $('#iv-' + p.i).scrollIntoView(); }
  };

  /* ---------- ER diagram (auto-layout grid) ---------- */
  function erDiagram(entities, rels) {
    if (!entities || !entities.length) return '';
    var cols = Math.min(4, Math.ceil(Math.sqrt(entities.length * 1.6))), W = 150, H = 40, GX = 110, GY = 90;
    var pos = {};
    entities.forEach(function (e, i) { pos[e.name] = { x: 20 + (i % cols) * (W + GX), y: 60 + Math.floor(i / cols) * (H + GY) }; });
    var rows = Math.ceil(entities.length / cols);
    var vw = 40 + cols * W + (cols - 1) * GX, vh = 84 + rows * H + (rows - 1) * GY;
    // clip a segment from box centre to the box border so arrowheads stay visible
    function edge(cx, cy, tx, ty) {
      var dx = tx - cx, dy = ty - cy, sx = (W / 2 + 4) / Math.abs(dx || 1e-9), sy = (H / 2 + 4) / Math.abs(dy || 1e-9), k = Math.min(sx, sy);
      return [cx + dx * k, cy + dy * k];
    }
    var seen = {}, placed = [];
    var lines = (rels || []).map(function (r) {
      var a = pos[r.from], b = pos[r.to]; if (!a || !b || a === b) return '';
      var key = [r.from, r.to].sort().join('|'), nth = seen[key] = (seen[key] || 0) + 1;
      var ax = a.x + W / 2, ay = a.y + H / 2, bx = b.x + W / 2, by = b.y + H / 2;
      var off = (nth - 1) * 26 * (nth % 2 ? 1 : -1);           // fan out parallel relationships
      // bend the edge when a straight line would cross another entity box
      var blocked = entities.some(function (e) {
        var p = pos[e.name]; if (p === a || p === b) return false;
        for (var t = 0.1; t < 0.9; t += 0.05) { var x = ax + (bx - ax) * t, y = ay + (by - ay) * t; if (x > p.x - 6 && x < p.x + W + 6 && y > p.y - 6 && y < p.y + H + 6) return true; }
        return false;
      });
      var nx = -(by - ay), ny = bx - ax, len = Math.hypot(nx, ny) || 1;
      if (blocked && !off) off = (H + 26) * (ny > 0 ? -1 : 1) * (Math.abs(ny) < 1 ? 1 : 1);   // bend towards the top
      var mx = (ax + bx) / 2 + nx / len * off, my = (ay + by) / 2 + ny / len * off;
      var p1 = edge(ax, ay, off ? mx : bx, off ? my : by), p2 = edge(bx, by, off ? mx : ax, off ? my : ay);
      var d = off ? 'M' + p1[0] + ' ' + p1[1] + ' Q' + mx + ' ' + my + ' ' + p2[0] + ' ' + p2[1] : 'M' + p1[0] + ' ' + p1[1] + ' L' + p2[0] + ' ' + p2[1];
      var lx = off ? (p1[0] + 2 * mx + p2[0]) / 4 : (p1[0] + p2[0]) / 2, ly = off ? (p1[1] + 2 * my + p2[1]) / 4 : (p1[1] + p2[1]) / 2;
      var label = (r.type || '') + (r.label ? ' ' + r.label : ''), lw = label.length * 6;
      ly -= 4;
      for (var tries = 0; tries < 6 && placed.some(function (q) { return Math.abs(q[0] - lx) < (q[2] + lw) / 2 && Math.abs(q[1] - ly) < 13; }); tries++) ly += 13;
      placed.push([lx, ly, lw]);
      return '<path class="rel" d="' + d + '" marker-end="url(#er-arrow)"/><text class="rl" text-anchor="middle" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '">' +
        esc(r.type || '') + (r.label ? ' ' + esc(r.label) : '') + '</text>';
    }).join('');
    var boxes = entities.map(function (e) {
      var p = pos[e.name];
      return '<g class="ent"><title>' + esc(e.desc || '') + '</title><rect x="' + p.x + '" y="' + p.y + '" width="' + W + '" height="' + H + '" rx="8"/><text x="' + (p.x + W / 2) + '" y="' + (p.y + H / 2 + 4) + '" text-anchor="middle">' + esc(e.name) + '</text></g>';
    }).join('');
    return '<div class="card" style="overflow-x:auto"><svg class="er" viewBox="0 0 ' + vw + ' ' + vh + '" style="min-width:' + Math.min(vw, 640) + 'px" role="img" aria-label="Entity relationship diagram">' +
      '<defs><marker id="er-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--muted)"/></marker></defs>' + lines.replace(/<text[^>]*>[^<]*<\/text>/g, '') + boxes + (lines.match(/<text[^>]*>[^<]*<\/text>/g) || []).join('') + '</svg></div>';
  }

  Pages.projects = function () {
    var P = PGM.PROJECTS || [];
    main.innerHTML = '<div class="page"><div class="page-head"><div class="eyebrow">Build</div><h1>Real-world projects</h1><p>' + P.length + ' complete database projects: requirements, ER diagram, DDL, sample data, indexes, transactions, queries and scaling notes — all runnable.</p></div>' +
      '<div class="grid c3">' + P.map(function (p) {
        return '<a class="card feature-card" href="#/project/' + p.id + '"><div class="ico">' + esc(p.icon || '◫') + '</div><h3>' + esc(p.title) + '</h3><p>' + esc(p.summary) + '</p>' +
          '<div class="row" style="margin-top:10px">' + (p.level ? levelBadge(p.level) : '') + '<span class="chip">' + (p.entities || []).length + ' tables</span></div></a>';
      }).join('') + '</div></div>';
  };
  Pages.project = function (id) {
    var p = (PGM.PROJECTS || []).find(function (x) { return x.id === id; }); if (!p) return Pages.notFound();
    PGM.Progress.viewProject(p.id);
    var schema = p.id.replace(/-/g, '_');
    var pre = 'CREATE SCHEMA IF NOT EXISTS ' + schema + ';\nSET search_path = ' + schema + ', public;\n\n';
    main.innerHTML = '<div class="page narrow"><div class="breadcrumbs"><a href="#/projects">Projects</a>›<span>' + esc(p.title) + '</span></div><div class="page-head"><h1>' + esc(p.title) + '</h1><p>' + esc(p.summary) + '</p></div>' +
      (p.requirements ? '<div class="card"><h3>Requirements</h3><ul class="check-list good">' + p.requirements.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul></div>' : '') +
      sectionTitle('ER diagram') + erDiagram(p.entities, p.relationships) +
      '<div class="card" style="margin-top:12px"><table><thead><tr><th>Table</th><th>Purpose</th></tr></thead><tbody>' + (p.entities || []).map(function (e) { return '<tr><td><code>' + esc(e.name) + '</code></td><td>' + esc(e.desc) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      sectionTitle('Build it') + '<p class="muted small">Runs in its own schema <code>' + schema + '</code> inside a rolled-back transaction, so it never touches company_db. Use “Playground” to keep it.</p>' +
      tabs([{ label: 'DDL', body: PGM.codeBlock(pre + p.ddl, { run: true }) }, { label: 'Sample data', body: PGM.codeBlock(pre + p.ddl + '\n\n' + p.sampleData, { run: true, title: 'DDL + data' }) },
        { label: 'Indexes', body: PGM.codeBlock(p.indexes) }, { label: 'Transactions', body: PGM.codeBlock(p.transactions) }]) +
      sectionTitle('Queries') + (p.queries || []).map(function (q) {
        return acc(esc(q.title), PGM.codeBlock(pre + p.ddl + '\n\n' + p.sampleData + '\n\n-- ===== query =====\n' + q.sql, { run: true, title: 'full script (schema + data + query)' }) + '<div class="prose">' + (q.explain || '') + '</div>');
      }).join('') +
      sectionTitle('Optimization & scaling') + '<div class="card prose">' + (p.optimization || '') + '</div>' +
      (p.advanced ? sectionTitle('Advanced topics') + '<div class="card prose">' + p.advanced + '</div>' : '') + '</div>';
  };

  Pages.design = function () {
    var D = PGM.SYSTEM_DESIGN || [];
    main.innerHTML = '<div class="page"><div class="page-head"><div class="eyebrow">Interview</div><h1>Database design interviews</h1><p>System design problems answered the way strong candidates do: requirements, scale estimates, entities, tables, indexes, transactions, partitioning, replication, sharding and failure handling.</p></div>' +
      '<div class="grid c3">' + D.map(function (d) {
        return '<a class="card feature-card" href="#/design/' + d.id + '"><div class="ico">◇</div><h3>' + esc(d.title) + '</h3><p>' + esc((d.requirements && d.requirements.functional || []).slice(0, 2).join(' · ')) + '</p></a>';
      }).join('') + '</div></div>';
  };
  Pages.designItem = function (id) {
    var d = (PGM.SYSTEM_DESIGN || []).find(function (x) { return x.id === id; }); if (!d) return Pages.notFound();
    var block = function (t, h) { return h ? sectionTitle(t) + '<div class="card prose">' + h + '</div>' : ''; };
    main.innerHTML = '<div class="page narrow"><div class="breadcrumbs"><a href="#/design">Design interviews</a>›<span>' + esc(d.title) + '</span></div><div class="page-head"><h1>' + esc(d.title) + '</h1></div>' +
      '<div class="grid c2"><div class="card"><h3>Functional requirements</h3><ul class="check-list good">' + (d.requirements.functional || []).map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul></div>' +
      '<div class="card"><h3>Non-functional requirements</h3><ul class="check-list good">' + (d.requirements.nonFunctional || []).map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul></div></div>' +
      block('Scale estimates', d.scale) + sectionTitle('Entities & ER diagram') + erDiagram(d.entities, d.relationships) +
      sectionTitle('Tables') + PGM.codeBlock(d.tables) + sectionTitle('Indexes') + PGM.codeBlock(d.indexes) +
      block('Critical transactions', d.transactions) + block('Scaling', d.scaling) + block('Partitioning', d.partitioning) + block('Replication', d.replication) +
      block('Sharding', d.sharding) + block('Failure handling', d.failures) + block('Trade-offs', d.tradeoffs) + '</div>';
  };

  Pages.cheatsheet = function () {
    var C = PGM.CHEATSHEET || [], cats = Array.from(new Set(C.map(function (c) { return c.category; })));
    main.innerHTML = '<div class="page narrow"><div class="page-head"><div class="eyebrow">Reference</div><h1>PostgreSQL command cheat sheet</h1><p>' + C.length + ' commands with syntax, example and explanation. Runnable examples execute against company_db.</p></div>' +
      '<div class="filters"><input type="search" id="cs-q" placeholder="Search commands…" aria-label="Search commands" value="' + esc(qs().q || '') + '"><select id="cs-c" aria-label="Category"><option value="">All categories</option>' +
      cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div><div id="cs-list" class="cheat"></div></div>';
    function draw() {
      var q = $('#cs-q').value.toLowerCase(), c = $('#cs-c').value;
      var list = C.filter(function (x) { return (!c || x.category === c) && (!q || (x.cmd + ' ' + x.explain + ' ' + x.syntax).toLowerCase().indexOf(q) >= 0); });
      $('#cs-list').innerHTML = list.slice(0, 120).map(function (x) {
        return '<div class="cheat-item"><div class="row"><span class="cmd">' + esc(x.cmd) + '</span><span class="spacer"></span><span class="chip">' + esc(x.category) + '</span></div>' +
          '<p class="small" style="margin:6px 0 0">' + x.explain + '</p>' + PGM.codeBlock(x.syntax, { title: 'Syntax', plain: x.category === 'psql', lang: x.category === 'psql' ? 'psql' : 'PostgreSQL' }) +
          PGM.codeBlock(x.example, { title: 'Example', run: !!x.run, lang: x.run ? 'PostgreSQL' : (/^\s*(pg_|psql|\$|sudo|createdb|initdb)/.test(x.example) ? 'shell' : 'PostgreSQL') }) + '</div>';
      }).join('') + (list.length > 120 ? '<p class="muted small">Showing 120 of ' + list.length + ' — refine your search.</p>' : '') + (list.length ? '' : '<div class="empty">No commands match.</div>');
    }
    $('#cs-q').addEventListener('input', draw); $('#cs-c').addEventListener('change', draw); draw();
  };

  Pages.rules = function () {
    var R = PGM.DESIGN_RULES || [];
    main.innerHTML = '<div class="page narrow"><div class="page-head"><div class="eyebrow">Reference</div><h1>Database design rules</h1><p>Opinionated, production-tested rules for PostgreSQL schemas — with the reasoning behind each one.</p></div>' +
      R.map(function (s) {
        return sectionTitle(esc(s.title)) + s.rules.map(function (r) {
          return acc(esc(r.rule), '<p>' + r.why + '</p>' + (r.good || r.bad ? '<div class="compare">' + (r.bad ? '<div class="bad"><h4>✕ Avoid</h4>' + PGM.codeBlock(r.bad) + '</div>' : '') +
            (r.good ? '<div class="good"><h4>✓ Prefer</h4>' + PGM.codeBlock(r.good) + '</div>' : '') + '</div>' : ''));
        }).join('');
      }).join('') + '</div>';
  };

  Pages.checklist = function () {
    var C = PGM.CHECKLIST || [];
    var total = 0, done = 0;
    C.forEach(function (s, i) { s.items.forEach(function (it, j) { total++; if (PGM.Progress.checklist(i + ':' + j)) done++; }); });
    main.innerHTML = '<div class="page narrow"><div class="page-head"><div class="eyebrow">Go-live</div><h1>PostgreSQL production checklist</h1><p>Tick items as you verify them for your system. Your ticks are saved in this browser.</p>' +
      '<div class="row"><div class="progress-bar" style="flex:1;max-width:400px"><span style="width:' + Math.round(100 * done / Math.max(total, 1)) + '%"></span></div><span class="small muted">' + done + ' / ' + total + '</span></div></div>' +
      C.map(function (s, i) {
        return sectionTitle(esc(s.section)) + '<div class="card">' + s.items.map(function (it, j) {
          var k = i + ':' + j, c = PGM.Progress.checklist(k);
          return '<label class="checklist-item' + (c ? ' checked' : '') + '"><input type="checkbox" data-k="' + k + '"' + (c ? ' checked' : '') + '><div><div class="tx"><strong>' + it.text + '</strong></div><div class="small muted">' + it.detail + '</div></div></label>';
        }).join('') + '</div>';
      }).join('') + '</div>';
    main.onchange = function (e) { if (e.target.dataset.k) { PGM.Progress.checklist(e.target.dataset.k, e.target.checked); e.target.closest('.checklist-item').classList.toggle('checked', e.target.checked); } };
  };

  Pages.troubleshooting = function () {
    var T = PGM.TROUBLESHOOTING || [], want = qs().id;
    main.innerHTML = '<div class="page narrow"><div class="page-head"><div class="eyebrow">Operations</div><h1>Troubleshooting guide</h1><p>Symptom → cause → diagnosis → fix → prevention, for the problems that page DBAs at 3 a.m.</p></div>' +
      T.map(function (t) {
        return '<div id="tr-' + t.id + '">' + acc('<span class="badge sev-' + t.severity + '" style="margin-right:8px">' + esc(t.severity) + '</span>' + esc(t.title),
          '<div class="grid c2"><div><h4>Symptoms</h4><ul class="check-list bad">' + t.symptoms.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' +
          '<div><h4>Likely causes</h4><ul class="prose">' + t.causes.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div></div>' +
          '<h4>Diagnose</h4>' + PGM.codeBlock(t.diagnose) + '<h4>Fix</h4><div class="scenario"><ol>' + t.fix.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol></div>' +
          '<h4>Prevent</h4><ul class="check-list good">' + t.prevent.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>', { open: t.id === want }) + '</div>';
      }).join('') + '</div>';
    if (want && $('#tr-' + want)) $('#tr-' + want).scrollIntoView();
  };

  Pages.final = function () {
    var Q = PGM.FINAL_TEST || [], best = PGM.Progress.final();
    var bands = [[0, 40, 'Beginner'], [41, 60, 'Intermediate'], [61, 75, 'Advanced'], [76, 90, 'Database Engineer'], [91, 100, 'PostgreSQL Architect']];
    function bandHtml(score) {
      var pct = score == null ? -1 : score;
      return '<div class="score-band">' + bands.map(function (b) { return '<div class="' + (pct >= b[0] && pct <= b[1] ? 'me' : '') + '"><span>' + b[0] + '–' + b[1] + '</span><strong>' + b[2] + '</strong></div>'; }).join('') + '</div>';
    }
    main.innerHTML = '<div class="page narrow"><div class="page-head"><div class="eyebrow">Certification-style</div><h1>PostgreSQL Mastery — final assessment</h1>' +
      '<p>' + Q.length + ' questions across SQL, design, indexes, transactions, MVCC, performance, security, replication, partitioning, sharding, pgvector and architecture. Answer everything, then submit to see your score, level and explanations.</p></div>' +
      '<div class="grid c2"><div class="card"><h3>Score bands</h3>' + bandHtml(best ? Math.round(100 * best.score / best.total) : null) + '</div><div class="card"><h3>Your best</h3>' +
      (best ? '<div class="stat"><span class="value">' + best.score + ' / ' + best.total + '</span><span class="sub">' + new Date(best.at).toLocaleDateString() + '</span></div>' : '<p class="muted">Not taken yet.</p>') +
      '<div id="topic-break"></div></div></div>' + sectionTitle('Questions') + '<div id="final-quiz"></div></div>';
    PGM.Quiz.render($('#final-quiz'), Q, {
      id: 'final', mode: 'exam', showTopic: true,
      onDone: function (score, total, st) {
        PGM.Progress.setFinal(score, total);
        var pct = Math.round(100 * score / total), b = bands.find(function (x) { return pct >= x[0] && pct <= x[1]; });
        var by = {};
        Q.forEach(function (q, i) { var t = q.topic || 'General'; by[t] = by[t] || [0, 0]; by[t][1]++; if (st[i].correct) by[t][0]++; });
        $('#topic-break').innerHTML = '<h4>Latest attempt: ' + pct + '% — ' + b[2] + '</h4><table><tbody>' + Object.keys(by).map(function (t) {
          return '<tr><td>' + esc(t) + '</td><td style="width:50%"><div class="progress-bar"><span style="width:' + Math.round(100 * by[t][0] / by[t][1]) + '%"></span></div></td><td>' + by[t][0] + '/' + by[t][1] + '</td></tr>';
        }).join('') + '</tbody></table>';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  };

  Pages.notFound = function () {
    main.innerHTML = '<div class="page narrow"><div class="empty"><h1>Page not found</h1><p>That page does not exist. <a href="#/">Go to the dashboard</a> or <a href="#/search">search</a>.</p></div></div>';
  };

  /* ------------------------------------------------------------------
     Router
     ------------------------------------------------------------------ */
  var ROUTES = [
    [/^$/, 'dashboard'], [/^learn$/, 'learn'], [/^paths$/, 'paths'], [/^module\/(.+)$/, 'module'], [/^lesson\/(.+)$/, 'lesson'],
    [/^playground$/, 'playground'], [/^exercises$/, 'exercises'], [/^problem\/(.+)$/, 'problem'], [/^patterns$/, 'patterns'],
    [/^architecture$/, 'architecture'], [/^labs$/, 'labs'], [/^lab\/(.+)$/, 'lab'], [/^performance$/, 'performance'], [/^internals$/, 'internals'],
    [/^search$/, 'search'], [/^progress$/, 'progress'], [/^interview$/, 'interview'], [/^projects$/, 'projects'], [/^project\/(.+)$/, 'project'],
    [/^design$/, 'design'], [/^design\/(.+)$/, 'designItem'], [/^cheatsheet$/, 'cheatsheet'], [/^rules$/, 'rules'], [/^checklist$/, 'checklist'],
    [/^troubleshooting$/, 'troubleshooting'], [/^final$/, 'final']
  ];
  var NAV_MATCH = { learn: /^(learn|module|lesson|paths)/, playground: /^playground/, exercises: /^(exercises|problem|patterns)/, architecture: /^(architecture|labs|lab)/,
    performance: /^performance/, internals: /^internals/, search: /^search/, progress: /^progress/ };
  var lastPath = null;

  function route() {
    var h = location.hash.replace(/^#\/?/, ''), path = h.split('?')[0], params = qs();
    window.onscroll = null; main.onchange = null;
    // the lesson TOC uses ?s=section without re-rendering
    if (path === lastPath && path.indexOf('lesson/') === 0 && params.s) {
      var t = document.getElementById('s-' + params.s); if (t) t.scrollIntoView({ behavior: 'smooth' }); return;
    }
    var fresh = main.cloneNode(false); main.parentNode.replaceChild(fresh, main); main = fresh;   // drop old listeners
    CODE.length = 0;
    var r = ROUTES.find(function (x) { return x[0].test(path); });
    try {
      if (!r) Pages.notFound();
      else if (r[1] === 'playground') PGM.Playground.render(main);
      else Pages[r[1]].apply(null, (path.match(r[0]) || []).slice(1).map(decodeURIComponent));
    } catch (e) {
      console.error(e);
      main.innerHTML = '<div class="page narrow"><div class="result-error">Something went wrong rendering this page: ' + esc(e.message) + '</div></div>';
    }
    // mount interactive widgets declared by lessons
    $$('[data-widget]', main).forEach(function (el) { try { PGM.Visual.mountWidget(el.dataset.widget, el); } catch (e) { console.error(e); } });
    if (PGM.Visual && PGM.Visual.bind) PGM.Visual.bind(main);
    if (path !== lastPath) window.scrollTo(0, 0);
    if (params.s) { var s = document.getElementById('s-' + params.s); if (s) s.scrollIntoView(); }
    lastPath = path;
    $$('.nav-links a').forEach(function (a) { var k = a.dataset.nav; a.classList.toggle('active', !!(NAV_MATCH[k] && NAV_MATCH[k].test(path))); if (a.classList.contains('active')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    markSidebar();
    var title = $('h1', main);
    document.title = (title && path ? title.textContent + ' · ' : '') + 'PostgreSQL Mastery';
    main.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  function init() {
    prepare();
    main = $('#main');
    var t = 'dark';
    try { t = localStorage.getItem('pgm.theme') || 'dark'; } catch (e) { /* ignore */ }
    setTheme(t);
    $('#theme-btn').onclick = function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
    $('#menu-btn').onclick = function () { document.body.classList.toggle('drawer-open'); };
    $('.backdrop').onclick = function () { document.body.classList.remove('drawer-open'); };
    renderSidebar(); wireSidebar(); wireSearch(); updateNavProgress();
    PGM.Progress.onChange(function () { updateNavProgress(); renderSidebar(); });
    window.addEventListener('hashchange', route);
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
