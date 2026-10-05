/* =====================================================================
   progress.js — learner progress stored in localStorage.
   Every read/write is wrapped in try/catch so the app works in private
   windows or sandboxes where storage is blocked (progress then lasts
   for the session only).
   ===================================================================== */
(function () {
  'use strict';
  var PGM = window.PGM = window.PGM || {};
  var KEY = 'pgm.progress.v1';
  var listeners = [];

  function blank() {
    return { lessons: {}, quizzes: {}, problems: {}, projects: {}, checklist: {}, final: null, last: null, counters: {}, started: Date.now() };
  }
  var data = blank();
  try { var raw = localStorage.getItem(KEY); if (raw) data = Object.assign(blank(), JSON.parse(raw)); } catch (e) { /* storage blocked */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
  }

  PGM.Progress = {
    onChange: function (fn) { listeners.push(fn); },
    data: function () { return data; },
    isDone: function (id) { return !!data.lessons[id]; },
    complete: function (id, done) {
      if (done === false) delete data.lessons[id]; else data.lessons[id] = Date.now();
      save();
    },
    setLast: function (id) { data.last = id; save(); },
    last: function () { return data.last; },
    /** Keep the best score per quiz. */
    setQuiz: function (id, score, total) {
      var prev = data.quizzes[id];
      if (!prev || score / total >= prev.score / prev.total) data.quizzes[id] = { score: score, total: total, at: Date.now() };
      save();
    },
    quiz: function (id) { return data.quizzes[id] || null; },
    solve: function (id, solved) { if (solved === false) delete data.problems[id]; else data.problems[id] = Date.now(); save(); },
    isSolved: function (id) { return !!data.problems[id]; },
    viewProject: function (id) { if (!data.projects[id]) { data.projects[id] = Date.now(); save(); } },
    checklist: function (id, val) { if (val === undefined) return !!data.checklist[id]; if (val) data.checklist[id] = 1; else delete data.checklist[id]; save(); },
    setFinal: function (score, total) {
      if (!data.final || score > data.final.score) data.final = { score: score, total: total, at: Date.now() };
      save();
    },
    final: function () { return data.final; },
    bump: function (k) { data.counters[k] = (data.counters[k] || 0) + 1; save(); },
    reset: function () { data = blank(); save(); },
    exportJSON: function () { return JSON.stringify(data, null, 2); },
    importJSON: function (txt) { data = Object.assign(blank(), JSON.parse(txt)); save(); },

    /** Aggregate numbers for the dashboard / progress page. */
    stats: function () {
      var lessons = PGM.LESSONS || [];
      var done = lessons.filter(function (l) { return data.lessons[l.id]; }).length;
      var qs = Object.keys(data.quizzes).map(function (k) { return data.quizzes[k]; });
      var qAvg = qs.length ? Math.round(100 * qs.reduce(function (a, q) { return a + q.score / q.total; }, 0) / qs.length) : 0;
      var modules = (PGM.MODULES || []).map(function (m) {
        var ls = lessons.filter(function (l) { return l.module === m.id; });
        var d = ls.filter(function (l) { return data.lessons[l.id]; }).length;
        return { id: m.id, total: ls.length, done: d, pct: ls.length ? Math.round(100 * d / ls.length) : 0 };
      });
      return {
        lessonsDone: done, lessonsTotal: lessons.length,
        pct: lessons.length ? Math.round(100 * done / lessons.length) : 0,
        quizzesTaken: qs.length, quizAvg: qAvg,
        problemsSolved: Object.keys(data.problems).length, problemsTotal: (PGM.PROBLEMS || []).length,
        projectsViewed: Object.keys(data.projects).length, projectsTotal: (PGM.PROJECTS || []).length,
        modules: modules,
        modulesDone: modules.filter(function (m) { return m.total && m.done === m.total; }).length,
        queries: data.counters.queries || 0,
        final: data.final
      };
    }
  };
})();
