# PostgreSQL Mastery

An interactive PostgreSQL learning platform, from absolute beginner to database architect, built with plain HTML, CSS and JavaScript. You don't need a build step, a framework or a backend.

## Run it

Open `index.html` in Chrome, Edge, Firefox or Safari.

The SQL playground and every **▶ Run** button use **PGlite**, which is real PostgreSQL 18 compiled to WebAssembly. It is downloaded from the jsDelivr CDN the first time you run a query (about 8 MB, then cached). If the CDN can't be reached, the app switches to **demo mode**. You can still read all lessons and expected outputs, and run the SQL in your own PostgreSQL with `psql`.

> Tip: serving the folder over http uses the bundled `vendor/` copy of the engine, so it works offline and with no CDN:
> `python -m http.server 8000`, then open http://localhost:8000.

### Use your own PostgreSQL server
Every lesson uses the shared sample database **company_db**. To create it on a real server:

```bash
createdb company_db
psql -d company_db -f company_db.sql
```

## What's inside

| Area | Content |
|---|---|
| Course | 57 sections, 200 lessons, 7 levels (Beginner → AI + Vector Databases) |
| Lesson structure | Objectives, concept, why it exists, real-world use case, internals, syntax, 3 examples (basic / intermediate / advanced) with expected output, avoid-vs-do comparison, when not to use, mistakes, best practices, performance, security, production scenario, interview questions, exercises, challenge, quiz, related topics, previous/next |
| Runnable SQL | ≈1,600 SQL items tested automatically against real PostgreSQL 18 + company_db |
| Labs | B-tree search, EXPLAIN visualizer (also parses your own JSON plans), index chooser, two-session transaction & lock simulator, MVCC, sharding, vector search (HNSW / IVFFlat), security / RLS, joins, partition pruning |
| Diagrams | 24 clickable SVG architecture diagrams |
| Practice | 36 LeetCode-style problems with "check against solution", 27 SQL patterns |
| Interview | 650 Q&A in 7 categories, plus 10 database system-design problems |
| Projects | 12 real-world database projects with ER diagrams, DDL, data, queries, transactions and scaling notes |
| Reference | 195-command cheat sheet, design rules, production checklist, 20 troubleshooting playbooks |
| Assessment | 100-question final test with level bands and per-topic breakdown |
| Progress | Lessons, quizzes, exercises, projects, checklist and final score, saved in `localStorage`; export/import from the Progress page |

## File structure

```
index.html              app shell (navbar, sidebar, search modal)
css/styles.css          design system: dark/light themes, layout, components
css/visualizer.css      diagram & lab styles
js/data.js              levels, 57 modules, learning paths, lesson registry
js/seed.js              company_db DDL + deterministic sample data (≈23k rows)
company_db.sql          the same sample database as a plain SQL script
js/sqlsplit.js          SQL statement splitter (strings, $$ bodies, comments)
js/content/lessons-*.js lesson content (this is "lessons.js", split by part)
js/content/problems.js  exercises + SQL pattern library
js/content/reference*.js final test, cheat sheet, troubleshooting, rules, checklist
js/content/projects*.js real-world projects + system design interviews
js/content/interview-*.js interview question bank
js/progress.js          progress tracking (localStorage, fails safe)
js/search.js            client-side search index
js/quiz.js              quiz engine (practice + exam modes, SQL-checked answers)
js/sql-playground.js    PGlite engine wrapper, highlighter, formatter, playground
js/visualizer.js        diagrams + interactive labs
js/app.js               router, pages, lesson renderer, shared components
vendor/                 PGlite 0.5.8 + pgvector runtime (Apache-2.0), used when served over http(s)
```

## Adding a lesson

Add an object to any `js/content/lessons-*.js` file (or a new file listed in `index.html`):

```js
PGM.addLessons([{ id: 'indexes-my-topic', module: 'indexes', title: '…', level: 2, minutes: 12,
  summary: '…', objectives: [], concept: '<p>…</p>', why: '', useCase: '', internals: '', whenNot: '',
  syntax: '', examples: [{ label: 'Basic', title: '', sql: '', explain: '', output: '', run: true }, …],
  mistakes: [], best: [], performance: '', security: '', interview: [{ q: '', a: '' }],
  exercises: [{ task: '', solution: '', run: true }], challenge: { task: '', hint: '', solution: '' },
  related: [], quiz: [{ type: 'mcq', q: '', options: [], answer: 0, explain: '' }] }]);
```

`run: true` adds a Run button. Lesson runs happen inside `BEGIN … ROLLBACK`, so learners never damage company_db. Scripts that manage their own transactions instead have the objects they create cleaned up afterwards.

## Accuracy notes

- **Extensions are not core features.** pgvector, pg_trgm, pgcrypto and the others are labelled as extensions.
- **Third-party tools are labelled too.** PgBouncer, Patroni, HAProxy, pgBackRest and Citus are separate projects, not part of PostgreSQL.
- **Single-session engine.** The in-browser engine runs one session, so multi-session behaviour is taught with simulators and timelines: locks, isolation anomalies, replication and HA. Server-level setup (`pg_hba.conf`, replication, `ALTER SYSTEM`) is shown as configuration, not executed.
- **Engine differences.** The engine has no parallel workers, no JIT and no lz4. Lessons point this out where it changes the output.
