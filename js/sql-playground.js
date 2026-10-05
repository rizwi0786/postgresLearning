/* =====================================================================
   sql-playground.js
   1. PGM.db       — boots REAL PostgreSQL 18 inside the browser using
                     PGlite (PostgreSQL compiled to WebAssembly) plus
                     extensions (pgvector, pg_trgm, pgcrypto, ...).
                     Falls back to "demo mode" if it cannot load.
   2. PGM.SQL      — syntax highlighter + simple formatter.
   3. PGM.renderResults — result-set / error / plan rendering.
   4. PGM.Playground   — the SQL Playground page.
   ===================================================================== */
(function () {
  'use strict';
  var PGM = window.PGM = window.PGM || {};

  var PGLITE_VER = '0.5.8', VECTOR_VER = '0.0.9';
  var CDN = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@' + PGLITE_VER + '/dist/';
  var CONTRIB = ['pg_trgm', 'pgcrypto', 'citext', 'btree_gin', 'btree_gist', 'bloom', 'pageinspect',
    'pg_visibility', 'pg_buffercache', 'hstore', 'ltree', 'uuid_ossp', 'pg_freespacemap'];
  var DB_NAME = 'idb://pgmastery-company-db-v1';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  PGM.esc = PGM.esc || esc;

  /* ------------------------------------------------------------------
     PGM.db — engine wrapper
     ------------------------------------------------------------------ */
  var listeners = [];
  var db = null, bootPromise = null, queue = Promise.resolve();

  // Statements that cannot run inside our automatic BEGIN … ROLLBACK sandbox.
  var TXN_CTL = /\b(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|END|VACUUM|CONCURRENTLY|ALTER\s+SYSTEM|CREATE\s+DATABASE|DROP\s+DATABASE|CHECKPOINT|CALL|PREPARE\s+TRANSACTION)\b/i;

  PGM.db = {
    state: 'idle',            // idle | loading | ready | error
    message: 'PostgreSQL is not started yet.',
    persistent: false,
    version: '',
    onChange: function (fn) { listeners.push(fn); fn(PGM.db); },
    _set: function (state, message) {
      PGM.db.state = state; PGM.db.message = message;
      listeners.forEach(function (fn) { try { fn(PGM.db); } catch (e) { /* ignore */ } });
    },

    /** Boot the engine (once) and make sure company_db is seeded. */
    ensure: function () {
      if (bootPromise) return bootPromise;
      bootPromise = boot().catch(function (e) {
        PGM.db._set('error', 'Demo mode — the in-browser PostgreSQL engine could not load (' + (e && e.message || e) +
          '). Connect PostgreSQL for real execution.');
        bootPromise = null;
        throw e;
      });
      return bootPromise;
    },

    /**
     * Execute a script. Each statement runs separately (so VACUUM etc. work).
     * opts.sandbox: wrap in BEGIN … ROLLBACK so learners never damage company_db
     *               (skipped automatically when the script controls transactions itself).
     * Returns [{ sql, fields, rows, arrays, affectedRows, command, ms, error }]
     */
    exec: function (sql, opts) {
      opts = opts || {};
      var run = function () { return execNow(sql, opts); };
      var p = queue.then(run, run);           // serialize: PGlite is single-connection
      queue = p.catch(function () {});
      return p;
    },

    /** Drop everything in public and re-create company_db. */
    reset: function () {
      return PGM.db.ensure().then(function () {
        PGM.db._set('loading', 'Re-creating company_db…');
        return db.exec('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public; RESET ALL;')
          .then(seed).then(function () { PGM.db._set('ready', readyMsg()); });
      });
    },
    isTxnControl: function (sql) { return TXN_CTL.test(String(sql).replace(/--.*$/mg, '').replace(/'[^']*'/g, "''")); }
  };

  function readyMsg() {
    return 'Real ' + (PGM.db.version || 'PostgreSQL') + ' is running in your browser (PGlite / WebAssembly)' +
      (PGM.db.persistent ? ' — your changes persist between visits.' : ' — in-memory session.');
  }

  /* Engine sources, tried in order: a same-origin copy in vendor/ (works offline and inside
     sandboxed hosts) and the jsDelivr CDN (works when index.html is opened from file://). */
  function sources() {
    var list = [];
    if (location.protocol !== 'file:') list.push({ vendor: true, base: new URL('vendor/pglite/', location.href).href, vector: new URL('vendor/pglite-pgvector/index.js', location.href).href });
    list.push({ base: CDN, vector: 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite-pgvector@' + VECTOR_VER + '/dist/index.js' });
    return list;
  }

  async function boot() {
    PGM.db._set('loading', 'Downloading PostgreSQL engine (≈ 8 MB, cached after first load)…');
    var mod = null, src = null, lastErr = null, list = sources();
    for (var i = 0; i < list.length && !mod; i++) {
      try { mod = await import(list[i].base + 'index.js'); src = list[i]; } catch (e) { lastErr = e; }
    }
    if (!mod) throw lastErr || new Error('engine unavailable');
    var extensions = {};
    var loaded = await Promise.all(CONTRIB.map(function (name) {
      return import(src.base + 'contrib/' + name + '.js').then(function (m) { return [name, m[name]]; })
        .catch(function () { return [name, null]; });
    }));
    loaded.forEach(function (p) { if (p[1]) extensions[p[0]] = p[1]; });
    try {
      var v = await import(src.vector);
      if (v.vector) extensions.vector = v.vector;
    } catch (e) { /* pgvector optional */ }

    var options = { extensions: extensions };
    if (src.vendor) {
      // The vendored copy stores binary bundles under .wasm names (hosts that only serve web
      // file types). Load them ourselves and hand PGlite Blobs / blob: URLs instead.
      var bin = function (name) { return fetch(src.base + name).then(function (r) { if (!r.ok) throw new Error(name + ' ' + r.status); return r.arrayBuffer(); }); };
      options.fsBundle = new Blob([await bin('pglite-data.wasm')]);
      Object.keys(extensions).forEach(function (key) {
        var ext = extensions[key], file = 'ext/' + (key === 'uuid_ossp' ? 'uuid-ossp' : key) + '.tgz.wasm';
        extensions[key] = { name: ext.name, setup: async function (a, b, c) {
          var r = await ext.setup(a, b, c);
          r.bundlePath = new URL(URL.createObjectURL(new Blob([await bin(file)])));
          return r;
        } };
      });
    }
    PGM.db._set('loading', 'Starting PostgreSQL…');
    // Try IndexedDB persistence first, fall back to memory (private windows, sandboxes).
    try {
      db = new mod.PGlite(DB_NAME, options);
      await db.waitReady;
      PGM.db.persistent = true;
    } catch (e) {
      db = new mod.PGlite(options);
      await db.waitReady;
      PGM.db.persistent = false;
    }
    var ver = await db.query("SELECT split_part(version(), ' ', 2) AS v");
    PGM.db.version = 'PostgreSQL ' + ver.rows[0].v;
    var has = await db.query("SELECT to_regclass('public.audit_logs') IS NOT NULL AS ok");
    if (!has.rows[0].ok) await seed();
    PGM.db._set('ready', readyMsg());
    return PGM.db;
  }

  async function seed() {
    PGM.db._set('loading', 'Creating company_db sample database (12 tables, ~23,000 rows)…');
    await db.exec(PGM.SEED_SQL);
  }

  var SNAP_SQL = "SELECT 'rel' AS k, c.oid::regclass::text AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p','f') AND NOT c.relispartition " +
    "UNION ALL SELECT 'fn', p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') " +
    "UNION ALL SELECT 'type', t.oid::regtype::text FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e','d','r','c') AND t.typrelid = 0 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e') " +
    "UNION ALL SELECT 'schema', quote_ident(nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('public','information_schema') " +
    "UNION ALL SELECT 'role', quote_ident(rolname) FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' AND NOT rolsuper";
  async function catalogSnapshot() {
    var r = await db.query(SNAP_SQL), o = {};
    r.rows.forEach(function (x) { o[x.k + ':' + x.n] = 1; });
    return o;
  }
  async function dropNewObjects(before) {
    var r = await db.query(SNAP_SQL);
    var add = r.rows.filter(function (x) { return !before[x.k + ':' + x.n]; });
    var order = { schema: 0, rel: 1, fn: 2, type: 3, role: 4 };
    add.sort(function (a, b) { return order[a.k] - order[b.k]; });
    for (var i = 0; i < add.length; i++) {
      var x = add[i], stmt = { schema: 'DROP SCHEMA IF EXISTS %s CASCADE', rel: 'DROP TABLE IF EXISTS %s CASCADE', fn: 'DROP ROUTINE IF EXISTS %s CASCADE',
        type: 'DROP TYPE IF EXISTS %s CASCADE', role: 'DROP OWNED BY %s CASCADE; DROP ROLE IF EXISTS %s' }[x.k].replace(/%s/g, x.n);
      if (x.k === 'rel') {
        var kind = await db.query("SELECT relkind FROM pg_class WHERE oid = to_regclass($1)", [x.n]);
        var rk = kind.rows[0] && kind.rows[0].relkind;
        if (!rk) continue;
        stmt = (rk === 'v' ? 'DROP VIEW' : rk === 'm' ? 'DROP MATERIALIZED VIEW' : rk === 'f' ? 'DROP FOREIGN TABLE' : 'DROP TABLE') + ' IF EXISTS ' + x.n + ' CASCADE';
      }
      try { await db.exec(stmt); } catch (e) { /* object may already be gone via CASCADE */ }
    }
  }

  function friendlyError(e) {
    var msg = (e && e.message) || String(e);
    var parts = ['ERROR:  ' + msg];
    if (e && e.detail) parts.push('DETAIL:  ' + e.detail);
    if (e && e.hint) parts.push('HINT:  ' + e.hint);
    if (e && e.code) parts.push('SQLSTATE: ' + e.code);
    return { message: msg, text: parts.join('\n'), code: e && e.code };
  }

  function commandOf(s) {
    var w = s.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, '').split(/\s+/).map(function (x) { return x.toUpperCase(); });
    if (/^(CREATE|DROP|ALTER)$/.test(w[0])) {
      var i = 1; while (/^(OR|REPLACE|UNIQUE|TEMP|TEMPORARY|UNLOGGED|MATERIALIZED|IF|NOT|EXISTS)$/.test(w[i] || '')) i++;
      return w[0] + ' ' + (w[i] || '').replace(/[^A-Z_]/g, '');
    }
    return (w[0] || '').replace(/[^A-Z_]/g, '');
  }

  async function execNow(sql, opts) {
    await PGM.db.ensure();
    var stmts = PGM.splitSQL(sql);
    var out = [];
    var sandbox = opts.sandbox && !PGM.db.isTxnControl(sql);
    // Scripts that manage their own transactions cannot be wrapped in BEGIN … ROLLBACK.
    // Instead we snapshot the catalog and drop whatever new objects they created afterwards.
    var snap = opts.sandbox && !sandbox ? await catalogSnapshot() : null;
    if (sandbox) await db.query('BEGIN');
    try {
      for (var i = 0; i < stmts.length; i++) {
        var s = stmts[i], t0 = performance.now();
        try {
          var r = await db.query(s, [], { rowMode: 'array' });
          var fields = (r.fields || []).map(function (f) { return f.name; });
          var rows = (r.rows || []).map(function (arr) {
            var o = {}; fields.forEach(function (f, k) { if (!(f in o)) o[f] = arr[k]; }); return o;
          });
          out.push({ sql: s, fields: fields, arrays: r.rows || [], rows: rows, affectedRows: r.affectedRows,
            command: commandOf(s),
            ms: performance.now() - t0 });
        } catch (e) {
          out.push({ sql: s, error: friendlyError(e), ms: performance.now() - t0 });
          break;                         // stop at the first error, like psql -v ON_ERROR_STOP=1
        }
      }
    } finally {
      if (sandbox) { try { await db.query('ROLLBACK'); } catch (e) { /* ignore */ } }
      else {
        // leave no aborted / open transaction behind for the next run
        try { await db.query('ROLLBACK'); } catch (e) { /* not in a transaction */ }
        if (snap) { try { await dropNewObjects(snap); out.cleaned = true; } catch (e) { /* best effort */ } }
      }
    }
    out.sandboxed = sandbox;
    return out;
  }

  /* ------------------------------------------------------------------
     PGM.SQL — highlighter and formatter
     ------------------------------------------------------------------ */
  var KW = ('select from where and or not in is null as on join inner left right full outer cross natural lateral using group by order having ' +
    'limit offset fetch first next rows row only with recursive union all intersect except distinct case when then else end insert into values ' +
    'update set delete returning create table index unique primary key foreign references constraint check default drop alter add column rename to ' +
    'if exists cascade restrict view materialized refresh concurrently function procedure returns return language begin commit rollback savepoint ' +
    'release transaction isolation level read write committed repeatable serializable explain analyze verbose buffers format costs settings vacuum full ' +
    'grant revoke all privileges usage schema role user login nologin password superuser createdb createrole inherit trigger before after instead of ' +
    'for each statement execute declare loop while foreach exit continue raise notice exception perform elsif conflict do nothing over partition ' +
    'range rows preceding following unbounded current filter within asc desc nulls last between like ilike similar any some array cast true false ' +
    'extension policy enable disable security definer invoker immutable stable volatile strict parallel safe include tablespace generated always identity ' +
    'stored virtual temp temporary truncate copy share lock nowait skip locked mode only show reset local session cluster reindex comment ' +
    'publication subscription replication attach detach of window collate tablesample merge matched source target without overlaps period ' +
    'deferrable initially deferred immediate valid validate owner owned call prepare deallocate listen notify unlisten database replace setof ' +
    'out inout variadic leakproof cost support handler domain type enum sequence start increment minvalue maxvalue cycle restart groups ties others ' +
    'checkpoint discard load analyse system statistics ordinality search depth breadth').split(' ');
  var TYPES = ('int integer bigint smallint serial bigserial smallserial numeric decimal real double precision float text varchar char character ' +
    'varying boolean bool date time timestamp timestamptz interval uuid json jsonb bytea inet cidr macaddr point line circle polygon box path ' +
    'tsvector tsquery money xml int4range int8range numrange tsrange tstzrange daterange vector halfvec sparsevec bit regclass oid record void ' +
    'trigger name citext hstore ltree xid xid8 pg_lsn int2 int4 int8 float4 float8').split(' ');
  var KWSET = {}, TYSET = {};
  KW.forEach(function (k) { KWSET[k] = 1; });
  TYPES.forEach(function (k) { TYSET[k] = 1; });

  var TOKEN_RE = /(--[^\n]*|\/\*[\s\S]*?\*\/)|(\$([A-Za-z_]\w*)?\$[\s\S]*?\$\3\$)|([eE]?'(?:[^'\\]|''|\\.)*'?)|("(?:[^"]|"")*")|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\\[a-zA-Z+]+)|([A-Za-z_][A-Za-z0-9_]*)|(::|<=>|<->|<#>|<\+>|@>|<@|\?\||\?&|->>|->|#>>|#>|\|\||&&|!=|<>|<=|>=|[=<>+\-*\/%~!@#?|&^])/g;

  PGM.SQL = {
    highlight: function (code) {
      var out = '', last = 0, m;
      var re = new RegExp(TOKEN_RE.source, 'g');   // fresh instance: highlight() recurses into $$ bodies
      while ((m = re.exec(code))) {
        if (!m[0]) { re.lastIndex++; continue; }
        out += esc(code.slice(last, m.index));
        var t = m[0];
        if (m[1]) out += '<span class="tok-com">' + esc(t) + '</span>';
        else if (m[2]) {
          // dollar-quoted body: highlight its content recursively (function bodies)
          var tag = t.match(/^\$[A-Za-z_\w]*\$/)[0];
          var inner = t.slice(tag.length, t.length - tag.length);
          out += '<span class="tok-str">' + esc(tag) + '</span>' + PGM.SQL.highlight(inner) + '<span class="tok-str">' + esc(tag) + '</span>';
        }
        else if (m[4]) out += '<span class="tok-str">' + esc(t) + '</span>';
        else if (m[5]) out += esc(t);
        else if (m[6]) out += '<span class="tok-num">' + t + '</span>';
        else if (m[7]) out += '<span class="tok-meta">' + esc(t) + '</span>';
        else if (m[8]) {
          var lw = t.toLowerCase();
          var next = code.slice(re.lastIndex).match(/^\s*\(/);
          if (TYSET[lw]) out += '<span class="tok-type">' + t + '</span>';
          else if (KWSET[lw]) out += '<span class="tok-kw">' + t + '</span>';
          else if (next) out += '<span class="tok-fn">' + t + '</span>';
          else out += t;
        }
        else if (m[9]) out += '<span class="tok-op">' + esc(t) + '</span>';
        last = re.lastIndex;
      }
      return out + esc(code.slice(last));
    },
    /** Light-weight formatter: uppercases keywords and breaks major clauses. */
    format: function (sql) {
      return PGM.splitSQL(sql).map(function (stmt) {
        var parts = [], re = /('(?:[^']|'')*'|\$([A-Za-z_]\w*)?\$[\s\S]*?\$\2\$|"(?:[^"]|"")*"|--[^\n]*)/g, last = 0, m;
        while ((m = re.exec(stmt))) { parts.push([0, stmt.slice(last, m.index)]); parts.push([1, m[0]]); last = re.lastIndex; }
        parts.push([0, stmt.slice(last)]);
        return parts.map(function (p) {
          if (p[0]) return p[1];
          var s = p[1].replace(/[ \t]+/g, ' ');
          s = s.replace(/\b([A-Za-z_]+)\b/g, function (w) { return KWSET[w.toLowerCase()] ? w.toUpperCase() : w; });
          s = s.replace(/\s*\b(FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|UNION ALL|UNION|RETURNING|WINDOW|(?:LEFT |RIGHT |FULL |INNER |CROSS )?(?:OUTER )?JOIN|VALUES|SET|ON CONFLICT)\b/g, '\n$1');
          s = s.replace(/\s+\b(AND|OR)\b\s+/g, '\n  $1 ');
          return s;
        }).join('').replace(/^\n+/, '').replace(/\n{2,}/g, '\n').trim() + ';';
      }).join('\n\n');
    }
  };

  /* ------------------------------------------------------------------
     Result rendering (shared by playground, lessons, quizzes)
     ------------------------------------------------------------------ */
  function cell(v) {
    if (v === null || v === undefined) return '<td class="null">NULL</td>';
    if (v instanceof Date) return '<td>' + esc(v.toISOString().replace('T', ' ').replace('.000Z', '+00')) + '</td>';
    if (v instanceof Uint8Array) return '<td>\\x' + Array.prototype.map.call(v.slice(0, 32), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('') + (v.length > 32 ? '…' : '') + '</td>';
    if (typeof v === 'object') return '<td>' + esc(JSON.stringify(v)) + '</td>';
    return '<td>' + esc(String(v)) + '</td>';
  }
  PGM.renderResults = function (results, opts) {
    opts = opts || {};
    if (!results || !results.length) return '<div class="muted small">No statements to run.</div>';
    var max = opts.maxRows || 500;
    var html = results.map(function (r, i) {
      var head = '<div class="result-meta"><span>#' + (i + 1) + ' ' + esc(r.command || '') + '</span>';
      if (r.error) return '<div class="result-block">' + head + '<span class="err">failed</span></div><div class="result-error">' + esc(r.error.text) + '</div></div>';
      head += '<span class="ok">' + (r.fields && r.fields.length ? r.arrays.length + ' row' + (r.arrays.length === 1 ? '' : 's') : (r.affectedRows != null ? r.affectedRows + ' affected' : 'OK')) +
        '</span><span>' + r.ms.toFixed(1) + ' ms</span></div>';
      if (!r.fields || !r.fields.length) return '<div class="result-block">' + head + '</div>';
      // EXPLAIN text output: render as preformatted plan
      if (r.fields.length === 1 && r.fields[0] === 'QUERY PLAN') {
        var plan = r.arrays.map(function (a) { return typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0], null, 2); }).join('\n');
        return '<div class="result-block">' + head + '<div class="result-plan">' + esc(plan) + '</div></div>';
      }
      var rows = r.arrays.slice(0, max);
      return '<div class="result-block">' + head + '<div class="result-table-wrap"><table class="result-table"><thead><tr>' +
        r.fields.map(function (f) { return '<th>' + esc(f) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (a) { return '<tr>' + a.map(cell).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
        (r.arrays.length > max ? '<div class="result-meta">showing first ' + max + ' of ' + r.arrays.length + ' rows</div>' : '') + '</div>';
    }).join('');
    if (results.cleaned) html += '<div class="result-meta">↺ this script manages its own transactions, so its data changes were committed; objects it created were dropped afterwards. Use Playground → Reset DB to restore company_db completely.</div>';
    if (results.sandboxed) html += '<div class="result-meta">↺ ran inside BEGIN … ROLLBACK — company_db is unchanged. Use the Playground to make permanent changes.</div>';
    return html;
  };

  /** Inline "Run" for any code block. el = container to fill. */
  PGM.runInline = function (sql, el, opts) {
    el.hidden = false;
    el.innerHTML = '<div class="result-meta">' + (PGM.db.state === 'ready' ? 'Running…' : esc(PGM.db.state === 'error' ? PGM.db.message : 'Starting PostgreSQL in your browser… (first run takes a few seconds)')) + '</div>';
    var unsub = function (d) {
      if (d.state === 'loading' && el.firstChild && /Starting|Downloading|Creating/.test(el.textContent)) el.firstChild.textContent = d.message;
    };
    listeners.push(unsub);
    return PGM.db.exec(sql, { sandbox: !(opts && opts.persist) }).then(function (res) {
      el.innerHTML = PGM.renderResults(res);
    }).catch(function () {
      el.innerHTML = '<div class="result-error">' + esc(PGM.db.message) + '</div>' +
        (opts && opts.expected ? '<div class="result-meta" style="margin-top:8px">Expected output (from the lesson):</div><div class="result-plan">' + esc(opts.expected) + '</div>' : '');
    }).finally(function () { listeners.splice(listeners.indexOf(unsub), 1); });
  };

  /* ------------------------------------------------------------------
     Playground page
     ------------------------------------------------------------------ */
  var SAMPLES = [
    ['Explore employees', "SELECT id, first_name, last_name, job_title, salary\nFROM employees\nORDER BY salary DESC\nLIMIT 10;"],
    ['Join + aggregate', "SELECT d.name AS department, count(e.id) AS headcount,\n       round(avg(e.salary), 2) AS avg_salary\nFROM departments d\nLEFT JOIN employees e ON e.department_id = d.id\nGROUP BY d.name\nORDER BY avg_salary DESC;"],
    ['Window: top 3 per department', "SELECT *\nFROM (\n  SELECT d.name AS dept, e.first_name, e.salary,\n         dense_rank() OVER (PARTITION BY d.id ORDER BY e.salary DESC) AS rnk\n  FROM employees e JOIN departments d ON d.id = e.department_id\n) t\nWHERE rnk <= 3\nORDER BY dept, rnk;"],
    ['Monthly revenue + running total', "SELECT date_trunc('month', order_date)::date AS month,\n       sum(total_amount) AS revenue,\n       sum(sum(total_amount)) OVER (ORDER BY date_trunc('month', order_date)) AS running_total\nFROM orders\nWHERE status <> 'cancelled'\nGROUP BY 1\nORDER BY 1;"],
    ['Recursive org chart', "WITH RECURSIVE org AS (\n  SELECT id, first_name, manager_id, 1 AS depth, first_name::text AS path\n  FROM employees WHERE manager_id IS NULL\n  UNION ALL\n  SELECT e.id, e.first_name, e.manager_id, o.depth + 1, o.path || ' > ' || e.first_name\n  FROM employees e JOIN org o ON e.manager_id = o.id\n)\nSELECT * FROM org ORDER BY path LIMIT 25;"],
    ['Index experiment (EXPLAIN)', "EXPLAIN ANALYZE\nSELECT * FROM orders WHERE customer_id = 42;\n\nCREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);\n\nEXPLAIN ANALYZE\nSELECT * FROM orders WHERE customer_id = 42;"],
    ['JSONB queries', "SELECT name, attributes->>'brand' AS brand,\n       (attributes #>> '{specs,weight_kg}')::numeric AS weight_kg\nFROM products\nWHERE attributes @> '{\"color\": \"black\"}'\nORDER BY weight_kg DESC\nLIMIT 10;"],
    ['Arrays', "SELECT tag, count(*)\nFROM products, unnest(tags) AS tag\nGROUP BY tag\nORDER BY count(*) DESC;"],
    ['Full-text search', "SELECT title, ts_rank(search, q) AS rank\nFROM documents, websearch_to_tsquery('english', 'replication standby') q\nWHERE search @@ q\nORDER BY rank DESC;"],
    ['Fuzzy search (pg_trgm)', "CREATE EXTENSION IF NOT EXISTS pg_trgm;\n\nSELECT name, similarity(name, 'Laptp Pro') AS sim\nFROM products\nWHERE name % 'Laptp Pro'\nORDER BY sim DESC\nLIMIT 5;"],
    ['Vector search (pgvector)', "CREATE EXTENSION IF NOT EXISTS vector;\n\nCREATE TABLE IF NOT EXISTS items (id int PRIMARY KEY, label text, embedding vector(3));\nINSERT INTO items VALUES\n  (1, 'database', '[0.9, 0.1, 0.0]'), (2, 'postgres', '[0.85, 0.15, 0.05]'),\n  (3, 'cooking',  '[0.0, 0.9, 0.2]'),  (4, 'travel',   '[0.1, 0.2, 0.95]')\nON CONFLICT DO NOTHING;\n\nSELECT label, embedding <=> '[0.88, 0.12, 0.02]' AS cosine_distance\nFROM items\nORDER BY embedding <=> '[0.88, 0.12, 0.02]'\nLIMIT 3;"],
    ['MVCC: see xmin / xmax / ctid', "SELECT ctid, xmin, xmax, id, name FROM departments ORDER BY id;\n\nUPDATE departments SET budget = budget + 1 WHERE id = 1;\n\nSELECT ctid, xmin, xmax, id, name FROM departments ORDER BY id;"],
    ['Transactions & savepoints', "BEGIN;\nUPDATE employees SET salary = salary * 1.10 WHERE department_id = 1;\nSAVEPOINT before_bonus;\nUPDATE employees SET salary = salary + 100000 WHERE id = 1;\nROLLBACK TO SAVEPOINT before_bonus;\nSELECT id, salary FROM employees WHERE id IN (1, 9);\nROLLBACK;"],
    ['Catalog: table sizes', "SELECT relname AS table, n_live_tup AS rows_est,\n       pg_size_pretty(pg_total_relation_size(relid)) AS total_size\nFROM pg_stat_user_tables\nORDER BY pg_total_relation_size(relid) DESC;"],
    ['Settings', "SELECT name, setting, unit, context\nFROM pg_settings\nWHERE name IN ('shared_buffers','work_mem','maintenance_work_mem','max_connections','random_page_cost','wal_level')\nORDER BY name;"]
  ];

  function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } }

  PGM.Playground = {
    SAMPLES: SAMPLES,
    /** Put SQL into the editor (used by lesson "Open in Playground"). */
    load: function (sql) { store('pgm.pg.editor', sql); },
    render: function (el) {
      var saved = store('pgm.pg.editor') || SAMPLES[0][1];
      el.innerHTML =
        '<div class="page">' +
        '<div class="page-head"><div class="eyebrow">Hands-on</div><h1>SQL Playground</h1>' +
        '<p>Write and run SQL against <strong>company_db</strong> in a real PostgreSQL server compiled to WebAssembly — no installation. ' +
        'Changes here are permanent until you press <em>Reset</em>. <span class="kbd">Ctrl</span> + <span class="kbd">Enter</span> runs.</p></div>' +
        '<div class="engine-status" id="pg-status"><span class="dotl"></span><span class="msg"></span><span class="spacer"></span>' +
        '<button class="btn sm" id="pg-start">Create sample database</button></div>' +
        '<div class="pg-layout">' +
        '<aside class="card pg-schema" aria-label="Database schema"><div class="row" style="margin-bottom:6px"><strong>company_db</strong><span class="spacer"></span><span class="chip">public</span></div>' +
        PGM.SCHEMA.map(function (t) {
          return '<details><summary><span>▸</span>' + t.table + '<span class="rc">' + t.rows + '</span></summary><ul>' +
            '<li><button data-ins="SELECT * FROM ' + t.table + ' LIMIT 20;" title="Insert a query">⤷ SELECT * FROM ' + t.table + '</button></li>' +
            t.cols.map(function (c) { return '<li><button data-col="' + esc(c.split(' ')[0]) + '">' + esc(c) + '</button></li>'; }).join('') + '</ul></details>';
        }).join('') + '</aside>' +
        '<section>' +
        '<div class="pg-editor-wrap"><div class="pg-toolbar">' +
        '<button class="btn primary sm" id="pg-run">▶ Run</button>' +
        '<button class="btn sm" id="pg-explain" title="EXPLAIN (ANALYZE, BUFFERS) the last statement">Explain</button>' +
        '<button class="btn sm" id="pg-format">Format</button>' +
        '<button class="btn sm" id="pg-copy">Copy</button>' +
        '<button class="btn sm" id="pg-clear">Clear</button>' +
        '<button class="btn sm" id="pg-reset" title="Drop everything and re-create company_db">Reset DB</button>' +
        '<span class="spacer"></span><label class="sr-only" for="pg-samples">Sample queries</label><select id="pg-samples"><option value="">Sample queries…</option>' +
        SAMPLES.map(function (s, i) { return '<option value="' + i + '">' + esc(s[0]) + '</option>'; }).join('') + '</select></div>' +
        '<div class="pg-editor"><div class="code-gutter" id="pg-gutter" aria-hidden="true"></div><div class="stack"><pre id="pg-hl" aria-hidden="true"></pre>' +
        '<label class="sr-only" for="pg-input">SQL editor</label><textarea id="pg-input" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div></div></div>' +
        '<div class="pg-results" id="pg-results" aria-live="polite"><div class="muted small">Results appear here. Try a sample query from the menu, or explore the schema on the left.</div></div>' +
        '</section></div></div>';

      var ta = el.querySelector('#pg-input'), hl = el.querySelector('#pg-hl'), gutter = el.querySelector('#pg-gutter'), res = el.querySelector('#pg-results');
      var status = el.querySelector('#pg-status');
      ta.value = saved;
      function sync() {
        hl.innerHTML = PGM.SQL.highlight(ta.value) + '\n';
        var n = ta.value.split('\n').length;
        gutter.innerHTML = Array.from({ length: n }, function (_, i) { return i + 1; }).join('<br>');
        ta.style.height = 'auto';
        ta.style.height = Math.max(240, ta.scrollHeight) + 'px';
        store('pgm.pg.editor', ta.value);
      }
      ta.addEventListener('input', sync);
      ta.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
        else if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          var s = ta.selectionStart;
          ta.setRangeText('    ', s, ta.selectionEnd, 'end'); sync();
        }
      });
      sync();

      PGM.db.onChange(function (d) {
        if (!document.body.contains(status)) return;
        status.className = 'engine-status ' + (d.state === 'ready' ? 'ready' : d.state === 'loading' ? 'loading' : d.state === 'error' ? 'demo' : '');
        status.querySelector('.msg').textContent = d.state === 'idle' ? 'PostgreSQL starts automatically when you run your first query.' : d.message;
        var b = status.querySelector('#pg-start');
        b.hidden = d.state === 'ready' || d.state === 'loading';
        b.textContent = d.state === 'error' ? 'Retry' : 'Create sample database';
      });

      function selectedOrAll() {
        var s = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        return s.trim() ? s : ta.value;
      }
      function run(sqlOverride) {
        var sql = sqlOverride || selectedOrAll();
        if (!sql.trim()) return;
        res.innerHTML = '<div class="result-meta">Running…</div>';
        PGM.db.exec(sql).then(function (r) {
          res.innerHTML = PGM.renderResults(r);
          if (PGM.Progress) PGM.Progress.bump('queries');
        }).catch(function () {
          res.innerHTML = '<div class="result-error">' + esc(PGM.db.message) + '</div><p class="muted small" style="margin-top:10px">' +
            'Demo mode: copy the query and run it with <code>psql</code> against your own PostgreSQL server after loading the sample database script ' +
            '(<a href="#/cheatsheet">see the cheat sheet</a> or the README for <code>company_db</code> setup).</p>';
        });
      }
      el.querySelector('#pg-run').onclick = function () { run(); };
      el.querySelector('#pg-start').onclick = function () { PGM.db.ensure().catch(function () {}); };
      el.querySelector('#pg-explain').onclick = function () {
        var stmts = PGM.splitSQL(selectedOrAll());
        var last = stmts[stmts.length - 1];
        if (!last) return;
        if (/^\s*explain\b/i.test(last)) return run(last);
        var dml = /^\s*(insert|update|delete|merge)\b/i.test(last);
        var sql = (dml ? 'BEGIN;\n' : '') + 'EXPLAIN (ANALYZE, BUFFERS) ' + last + ';' + (dml ? '\nROLLBACK;' : '');
        run(sql);
      };
      el.querySelector('#pg-format').onclick = function () { ta.value = PGM.SQL.format(ta.value); sync(); };
      el.querySelector('#pg-copy').onclick = function () { PGM.copy(ta.value); };
      el.querySelector('#pg-clear').onclick = function () { ta.value = ''; sync(); res.innerHTML = '<div class="muted small">Cleared.</div>'; ta.focus(); };
      el.querySelector('#pg-reset').onclick = function () {
        if (!PGM.confirmClick(this, 'Click again to reset')) return;
        res.innerHTML = '<div class="result-meta">Resetting…</div>';
        PGM.db.reset().then(function () { res.innerHTML = '<div class="result-meta"><span class="ok">company_db re-created.</span></div>'; })
          .catch(function () { res.innerHTML = '<div class="result-error">' + esc(PGM.db.message) + '</div>'; });
      };
      el.querySelector('#pg-samples').onchange = function (e) {
        var i = e.target.value; if (i === '') return;
        ta.value = SAMPLES[+i][1]; sync(); e.target.value = ''; ta.focus();
      };
      el.querySelector('.pg-schema').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var text = b.dataset.ins ? '\n' + b.dataset.ins : b.dataset.col;
        var s = ta.selectionStart;
        ta.setRangeText(text, s, ta.selectionEnd, 'end'); sync(); ta.focus();
      });
    }
  };
})();
