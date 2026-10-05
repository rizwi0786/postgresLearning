/* =====================================================================
   quiz.js — reusable quiz engine.
   Types: mcq, tf, predict, bug, optimize, index, design, scenario (all
   choice-based) and write (free SQL; checked by running both the
   learner's query and the model solution in PostgreSQL and comparing
   the result sets).
   Modes: 'practice' (instant feedback) and 'exam' (submit at the end).
   ===================================================================== */
(function () {
  'use strict';
  var PGM = window.PGM = window.PGM || {};
  var esc = function (s) { return PGM.esc(s); };
  var TYPE_LABEL = { mcq: 'Multiple choice', tf: 'True / False', predict: 'Predict the output', bug: 'Find the bug',
    optimize: 'Optimize the query', index: 'Choose the index', design: 'Design the schema', scenario: 'Architecture scenario', write: 'Write SQL' };

  function optionsOf(q) { return q.type === 'tf' ? ['True', 'False'] : q.options; }
  function answerIdx(q) { return q.type === 'tf' ? (q.answer ? 0 : 1) : q.answer; }

  /** Compare two result lists (last statement of each) ignoring column names. */
  function sameResult(a, b) {
    var ra = a[a.length - 1], rb = b[b.length - 1];
    if (!ra || !rb || ra.error || rb.error) return false;
    var norm = function (r) { return (r.arrays || []).map(function (row) { return JSON.stringify(row.map(function (v) { return v instanceof Date ? v.toISOString() : typeof v === 'number' ? Number(v.toFixed(6)) : v; })); }); };
    var x = norm(ra), y = norm(rb);
    if (x.length !== y.length) return false;
    if (JSON.stringify(x) === JSON.stringify(y)) return true;
    return JSON.stringify(x.slice().sort()) === JSON.stringify(y.slice().sort()); // order-insensitive fallback
  }

  PGM.Quiz = {
    TYPE_LABEL: TYPE_LABEL,
    /**
     * el: container; qs: questions; opts: { id, mode: 'practice'|'exam', onDone(score,total,answers), title, showTopic }
     */
    render: function (el, qs, opts) {
      opts = opts || {};
      var mode = opts.mode || 'practice';
      var state = qs.map(function () { return { answered: false, correct: false, choice: null }; });

      el.innerHTML = '<div class="quiz">' + qs.map(function (q, i) {
        var body = '';
        if (q.code) body += PGM.codeBlock(q.code, { lang: 'SQL', run: false, title: '' });
        if (q.type === 'write') {
          body += '<div class="q-write"><label class="sr-only" for="qw-' + i + '">Your SQL</label><textarea id="qw-' + i + '" spellcheck="false" placeholder="-- write your query here"></textarea>' +
            '<div class="row" style="margin-top:8px"><button class="btn sm primary" data-check="' + i + '">Check with PostgreSQL</button>' +
            '<button class="btn sm" data-reveal="' + i + '">Show solution</button></div><div class="code-result" data-wout="' + i + '" hidden></div></div>';
        } else {
          body += '<div class="q-options" role="group" aria-label="Answer options">' + optionsOf(q).map(function (o, k) {
            return '<button class="q-opt" data-q="' + i + '" data-k="' + k + '"><span class="k">' + String.fromCharCode(65 + k) + '</span><span>' + esc(o) + '</span></button>';
          }).join('') + '</div>';
        }
        return '<div class="q-card" id="q-' + (opts.id || 'x') + '-' + i + '"><div class="q-head"><span class="q-num">Q' + (i + 1) + '</span><span class="q-type">' +
          (TYPE_LABEL[q.type] || q.type) + '</span>' + (opts.showTopic && q.topic ? '<span class="chip">' + esc(q.topic) + '</span>' : '') +
          '</div><div class="q-text">' + esc(q.q) + '</div>' + body + '<div class="q-feedback"></div></div>';
      }).join('') + '</div>' +
        (mode === 'exam' ? '<div class="row" style="margin-top:16px"><button class="btn primary" data-submit>Submit answers</button><span class="muted small" data-count></span></div>' : '') +
        '<div data-score style="margin-top:14px"></div>';

      var cards = el.querySelectorAll('.q-card');
      function feedback(i, ok, extra) {
        var q = qs[i];
        cards[i].querySelector('.q-feedback').innerHTML = '<div class="q-explain ' + (ok ? 'ok' : 'no') + '"><strong>' + (ok ? 'Correct.' : 'Not quite.') + '</strong> ' +
          (extra || '') + esc(q.explain) + '</div>';
      }
      function revealChoice(i) {
        var q = qs[i], ans = answerIdx(q), st = state[i];
        cards[i].querySelectorAll('.q-opt').forEach(function (b) {
          var k = +b.dataset.k;
          b.disabled = true;
          b.classList.remove('picked');
          if (k === ans) b.classList.add('correct');
          else if (k === st.choice) b.classList.add('wrong');
        });
        feedback(i, st.correct, st.choice === null ? 'Unanswered. ' : '');
      }
      function maybeDone() {
        if (mode !== 'practice') return;
        if (!state.every(function (s) { return s.answered; })) return;
        finish();
      }
      function finish() {
        var score = state.filter(function (s) { return s.correct; }).length;
        if (opts.id) PGM.Progress.setQuiz(opts.id, score, qs.length);
        var pct = Math.round(100 * score / qs.length);
        el.querySelector('[data-score]').innerHTML = '<div class="quiz-score"><div class="big">' + score + ' / ' + qs.length + '</div><div><div><strong>' + pct + '%</strong> ' +
          (pct >= 80 ? '— excellent, you have mastered this.' : pct >= 60 ? '— good, review the explanations you missed.' : '— revisit the lesson and try again.') +
          '</div><div class="muted small">Best scores are saved to your progress.</div></div><span class="spacer"></span><button class="btn sm" data-retry>Retry</button></div>';
        el.querySelector('[data-retry]').onclick = function () { PGM.Quiz.render(el, qs, opts); };
        if (opts.onDone) opts.onDone(score, qs.length, state);
      }

      el.addEventListener('click', function (e) {
        var opt = e.target.closest('.q-opt');
        if (opt && !opt.disabled) {
          var i = +opt.dataset.q, k = +opt.dataset.k, st = state[i];
          st.choice = k; st.answered = true; st.correct = k === answerIdx(qs[i]);
          if (mode === 'practice') { revealChoice(i); maybeDone(); }
          else {
            cards[i].querySelectorAll('.q-opt').forEach(function (b) { b.classList.toggle('picked', b === opt); b.style.borderColor = b === opt ? 'var(--primary)' : ''; b.style.background = b === opt ? 'var(--primary-soft)' : ''; });
            var c = el.querySelector('[data-count]');
            if (c) c.textContent = state.filter(function (s) { return s.answered; }).length + ' / ' + qs.length + ' answered';
          }
          return;
        }
        var chk = e.target.closest('[data-check]'), rev = e.target.closest('[data-reveal]');
        if (chk || rev) {
          var j = +(chk || rev).dataset[chk ? 'check' : 'reveal'];
          var out = el.querySelector('[data-wout="' + j + '"]');
          var q = qs[j];
          if (rev) {
            out.hidden = false;
            out.innerHTML = '<div class="result-meta">Model solution</div><pre class="result-plan">' + PGM.SQL.highlight(q.solution) + '</pre>';
            if (!state[j].answered) { state[j].answered = true; state[j].correct = false; feedback(j, false, 'Solution revealed. '); maybeDone(); }
            return;
          }
          var mine = el.querySelector('#qw-' + j).value;
          if (!mine.trim()) return;
          out.hidden = false; out.innerHTML = '<div class="result-meta">Running your query and the model solution…</div>';
          Promise.all([PGM.db.exec(mine, { sandbox: true }), PGM.db.exec(q.solution, { sandbox: true })]).then(function (r) {
            var ok = sameResult(r[0], r[1]);
            out.innerHTML = '<div class="result-meta">Your result</div>' + PGM.renderResults(r[0], { maxRows: 20 }) +
              (ok ? '' : '<div class="result-meta">Expected (model solution)</div>' + PGM.renderResults(r[1], { maxRows: 20 }) +
                '<button class="btn sm" data-self="' + j + '">My answer is equivalent — mark correct</button>');
            if (!state[j].answered || ok) { state[j].answered = true; state[j].correct = ok; feedback(j, ok, ok ? 'Your result set matches the model solution. ' : 'Result sets differ. '); maybeDone(); }
          }).catch(function () {
            out.innerHTML = '<div class="result-error">' + esc(PGM.db.message) + '</div><pre class="result-plan">' + PGM.SQL.highlight(q.solution) + '</pre>' +
              '<button class="btn sm" data-self="' + j + '">My answer matches — mark correct</button>';
          });
          return;
        }
        var self = e.target.closest('[data-self]');
        if (self) { var s = +self.dataset.self; state[s].answered = true; state[s].correct = true; feedback(s, true, 'Self-assessed. '); self.remove(); maybeDone(); return; }
        if (e.target.closest('[data-submit]')) {
          var un = state.filter(function (s) { return !s.answered; }).length;
          if (un && !PGM.confirmClick(e.target.closest('[data-submit]'), un + ' unanswered — click again to submit')) return;
          qs.forEach(function (_, i) { if (qs[i].type !== 'write') revealChoice(i); });
          e.target.closest('[data-submit]').disabled = true;
          finish();
          el.querySelector('[data-score]').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }
  };
})();
