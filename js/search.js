/* =====================================================================
   search.js — client-side full-text search across lessons, commands,
   concepts, interview questions, patterns, problems, troubleshooting,
   projects, diagrams and labs. Index is built lazily on first search.
   ===================================================================== */
(function () {
  'use strict';
  var PGM = window.PGM = window.PGM || {};
  var index = null;

  function strip(html) { return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' '); }
  function levelName(n) { var l = (PGM.LEVELS || [])[n - 1]; return l ? l.name : ''; }

  function build() {
    var items = [];
    function add(o) { o.hay = (o.title + ' ' + (o.desc || '') + ' ' + (o.extra || '')).toLowerCase(); o.tl = o.title.toLowerCase(); items.push(o); }

    (PGM.MODULES || []).forEach(function (m) {
      add({ title: m.title, category: 'Module ' + m.num, level: levelName(m.level), desc: m.desc, href: '#/module/' + m.id, kind: 'module' });
    });
    (PGM.LESSONS || []).forEach(function (l) {
      var m = PGM.MODULE_BY_ID[l.module] || {};
      add({ title: l.title, category: 'Lesson · ' + (m.title || ''), level: levelName(l.level), desc: l.summary, href: '#/lesson/' + l.id, kind: 'lesson',
        extra: (l.objectives || []).join(' ') + ' ' + (l.syntax || '').slice(0, 400) + ' ' + strip(l.concept).slice(0, 1500) +
          ' ' + (l.examples || []).map(function (e) { return e.title + ' ' + e.sql.slice(0, 300); }).join(' ') });
    });
    (PGM.CHEATSHEET || []).forEach(function (c, i) {
      add({ title: c.cmd, category: 'Command · ' + c.category, desc: strip(c.explain), href: '#/cheatsheet?q=' + encodeURIComponent(c.cmd), kind: 'command', extra: c.syntax + ' ' + c.example });
    });
    (PGM.PATTERNS || []).forEach(function (p) {
      add({ title: p.title, category: 'SQL pattern · ' + (p.category || ''), desc: strip(p.explain).slice(0, 180), href: '#/patterns?id=' + p.id, kind: 'pattern', extra: p.sql });
    });
    (PGM.PROBLEMS || []).forEach(function (p) {
      add({ title: p.title, category: 'Exercise · ' + p.topic, level: p.difficulty, desc: strip(p.statement).slice(0, 180), href: '#/problem/' + p.id, kind: 'problem' });
    });
    (PGM.TROUBLESHOOTING || []).forEach(function (t) {
      add({ title: t.title, category: 'Troubleshooting', level: t.severity, desc: (t.symptoms || []).map(strip).join('; ').slice(0, 180), href: '#/troubleshooting?id=' + t.id, kind: 'trouble',
        extra: (t.causes || []).join(' ') });
    });
    (PGM.PROJECTS || []).forEach(function (p) {
      add({ title: p.title, category: 'Project', desc: p.summary, href: '#/project/' + p.id, kind: 'project', extra: (p.entities || []).map(function (e) { return e.name; }).join(' ') });
    });
    (PGM.SYSTEM_DESIGN || []).forEach(function (p) {
      add({ title: p.title, category: 'Design interview', desc: (p.requirements && p.requirements.functional || []).slice(0, 3).join('; '), href: '#/design/' + p.id, kind: 'design' });
    });
    var IV = PGM.INTERVIEW || {};
    Object.keys(IV).forEach(function (k) {
      IV[k].forEach(function (q, i) {
        add({ title: strip(q.q), category: 'Interview · ' + k, desc: strip(q.a).slice(0, 160), href: '#/interview?cat=' + k + '&i=' + i, kind: 'interview', extra: (q.tags || []).join(' ') });
      });
    });
    (PGM.DESIGN_RULES || []).forEach(function (s) {
      add({ title: s.title, category: 'Design rules', desc: s.rules.map(function (r) { return r.rule; }).join('; ').slice(0, 180), href: '#/rules', kind: 'rules', extra: s.rules.map(function (r) { return r.why; }).join(' ') });
    });
    (PGM.CHECKLIST || []).forEach(function (s) {
      add({ title: 'Production checklist: ' + s.section, category: 'Checklist', desc: s.items.map(function (r) { return r.text; }).join('; ').slice(0, 180), href: '#/checklist', kind: 'checklist' });
    });
    if (PGM.Visual) {
      Object.keys(PGM.Visual.DIAGRAMS || {}).forEach(function (k) {
        var d = PGM.Visual.DIAGRAMS[k];
        add({ title: d.title, category: 'Diagram', desc: d.desc, href: '#/architecture?d=' + k, kind: 'diagram' });
      });
      Object.keys(PGM.Visual.LABS || {}).forEach(function (k) {
        var d = PGM.Visual.LABS[k];
        add({ title: d.title, category: 'Interactive lab', desc: d.desc, href: '#/lab/' + k, kind: 'lab' });
      });
    }
    [['SQL Playground', '#/playground', 'Run real PostgreSQL in the browser'], ['Final assessment', '#/final', '100-question PostgreSQL Mastery test'],
     ['Learning paths', '#/paths', 'Backend, data, DBE, architect and AI paths'], ['Command cheat sheet', '#/cheatsheet', 'Searchable command reference'],
     ['Production checklist', '#/checklist', 'Go-live checklist'], ['Troubleshooting guide', '#/troubleshooting', 'Fix common production problems']
    ].forEach(function (p) { add({ title: p[0], category: 'Page', desc: p[2], href: p[1], kind: 'page' }); });
    return items;
  }

  PGM.Search = {
    reset: function () { index = null; },
    query: function (q, limit) {
      if (!index) index = build();
      q = String(q || '').toLowerCase().trim();
      if (!q) return [];
      var terms = q.split(/\s+/).filter(Boolean);
      var kindWeight = { module: 6, lesson: 5, command: 4, lab: 4, diagram: 3, pattern: 3, problem: 2, trouble: 3, project: 2, design: 2, rules: 2, checklist: 1, interview: 0, page: 3 };
      var out = [];
      for (var i = 0; i < index.length; i++) {
        var it = index[i], s = 0, ok = true;
        for (var j = 0; j < terms.length; j++) {
          var t = terms[j];
          if (it.tl.indexOf(t) >= 0) s += 10 + (it.tl.indexOf(t) === 0 ? 6 : 0);
          else if (it.hay.indexOf(t) >= 0) s += 2;
          else { ok = false; break; }
        }
        if (!ok) continue;
        if (it.tl === q) s += 30;
        else if (it.tl.indexOf(q) >= 0) s += 12;
        s += kindWeight[it.kind] || 0;
        out.push([s, it]);
      }
      out.sort(function (a, b) { return b[0] - a[0]; });
      return out.slice(0, limit || 50).map(function (x) { return x[1]; });
    },
    /** Wrap matched terms in <mark> (input must be plain text). */
    mark: function (text, q) {
      var e = PGM.esc(text);
      String(q || '').trim().split(/\s+/).filter(function (t) { return t.length > 1; }).forEach(function (t) {
        e = e.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
      });
      return e;
    }
  };
})();
