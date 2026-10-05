/* =====================================================================
   visualizer.js — PGM.Visual
   Interactive, theme-aware diagrams (inline SVG) and hands-on labs for
   the PostgreSQL course. No frameworks, no build step, no external
   images. Everything is styled through the app's CSS variables (see
   css/visualizer.css), so both light and dark themes work.

   Public API:
     PGM.Visual.DIAGRAMS        { key: { title, desc } }
     PGM.Visual.LABS            { key: { title, desc } }
     PGM.Visual.ARCH_PAGE       ordered diagram keys for a gallery page
     PGM.Visual.diagram(key)    -> HTML string (<figure class="viz-figure">)
     PGM.Visual.mountLab(key,el)
     PGM.Visual.mountWidget('diagram:x' | 'lab:y', el)
     PGM.Visual.bind(container) (optional; clicks are delegated globally)
   ===================================================================== */
(function () {
  'use strict';
  window.PGM = window.PGM || {};
  var PGM = window.PGM;

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */
  var UID = 0;
  function uid(p) { UID += 1; return (p || 'viz') + UID; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, d) {
    if (n == null || isNaN(n)) return '–';
    var v = Number(n);
    if (d == null) d = Math.abs(v) >= 100 ? 0 : (Math.abs(v) >= 10 ? 1 : 2);
    return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function $(root, sel) { return root.querySelector(sel); }
  function $$(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  /* Deterministic PRNG (mulberry32) so labs look identical for everyone. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* 32-bit FNV-1a string hash (stand-in for PostgreSQL's hash functions). */
  function fnv(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    /* final avalanche so sequential ints spread well */
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
    return h >>> 0;
  }

  /* Create a fresh root inside `el` so re-mounting drops old listeners. */
  function freshRoot(el, cls) {
    el.innerHTML = '';
    var root = document.createElement('div');
    root.className = cls;
    el.appendChild(root);
    return root;
  }
  function labHead(key, extra) {
    var L = LAB_META[key] || { title: key, desc: '' };
    return '<div class="viz-lab-head"><div><span class="viz-badge viz-badge-lab">Lab</span>' +
      '<h3 class="viz-lab-title">' + esc(L.title) + '</h3></div>' +
      '<p class="viz-lab-desc">' + esc(L.desc) + '</p>' + (extra || '') + '</div>';
  }
  function btn(act, label, opts) {
    opts = opts || {};
    return '<button type="button" class="viz-btn' + (opts.cls ? ' ' + opts.cls : '') + '" data-act="' + esc(act) + '"' +
      (opts.val != null ? ' data-val="' + esc(opts.val) + '"' : '') +
      (opts.pressed != null ? ' aria-pressed="' + (opts.pressed ? 'true' : 'false') + '"' : '') +
      (opts.disabled ? ' disabled' : '') +
      (opts.title ? ' title="' + esc(opts.title) + '"' : '') +
      (opts.aria ? ' aria-label="' + esc(opts.aria) + '"' : '') + '>' + label + '</button>';
  }
  function reducedMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  /* Activate on click or Enter/Space for elements with role=button that are not <button>. */
  function onActivate(root, selector, fn) {
    root.addEventListener('click', function (ev) {
      var t = ev.target.closest(selector);
      if (t && root.contains(t)) fn(t, ev);
    });
    root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var t = ev.target.closest(selector);
      if (t && root.contains(t) && t.tagName !== 'BUTTON') { ev.preventDefault(); fn(t, ev); }
    });
  }

  /* ------------------------------------------------------------------
     Diagram engine
     A diagram definition = { w, h, groups[], nodes[], edges[], under, over }
     Node: { id, x, y, w, h, kind, label, sub, info, shape, draw, cls }
     Edge: { from, to, l(label), dash, bi, hl, bad, pts[[x,y]], curve, vx, li, lx, ly, flow }
     ------------------------------------------------------------------ */
  function N(id, x, y, w, h, kind, label, sub, info, extra) {
    var n = { id: id, x: x, y: y, w: w, h: h, kind: kind, label: label, sub: sub, info: info };
    if (extra) for (var k in extra) n[k] = extra[k];
    return n;
  }
  function E(from, to, opts) {
    var e = { from: from, to: to };
    if (typeof opts === 'string') e.l = opts;
    else if (opts) for (var k in opts) e[k] = opts[k];
    return e;
  }
  function G(x, y, w, h, label, extra) {
    var g = { x: x, y: y, w: w, h: h, label: label };
    if (extra) for (var k in extra) g[k] = extra[k];
    return g;
  }

  function center(r) { return [r.x + r.w / 2, r.y + r.h / 2]; }
  /* Point where the ray from rect centre towards p leaves the rect. */
  function clipRect(r, p) {
    var c = center(r), dx = p[0] - c[0], dy = p[1] - c[1];
    if (!dx && !dy) return c;
    var tx = dx ? (r.w / 2) / Math.abs(dx) : Infinity;
    var ty = dy ? (r.h / 2) / Math.abs(dy) : Infinity;
    var t = Math.min(tx, ty);
    return [c[0] + dx * t, c[1] + dy * t];
  }
  /* Approximate text width so labels never overflow their boxes. */
  function fitSize(text, maxW, base, ratio) {
    var len = String(text).length || 1;
    var size = Math.min(base, maxW / (len * ratio));
    return Math.max(8, Math.round(size * 10) / 10);
  }

  function textBlock(n, cx, cy, maxW) {
    var labels = String(n.label || '').split('\n');
    var subs = n.sub == null ? [] : [].concat(n.sub);
    var LH = 16, SH = 14;
    var total = labels.length * LH + subs.length * SH;
    var y = cy - total / 2 + 12;
    var out = '';
    labels.forEach(function (t) {
      var fs = fitSize(t, maxW, 13, 0.6);
      out += '<text class="viz-t" x="' + cx + '" y="' + y + '" style="font-size:' + fs + 'px">' + esc(t) + '</text>';
      y += LH;
    });
    y -= 1;
    subs.forEach(function (t) {
      var fs = fitSize(t, maxW, 11, 0.56);
      out += '<text class="viz-s" x="' + cx + '" y="' + y + '" style="font-size:' + fs + 'px">' + esc(t) + '</text>';
      y += SH;
    });
    return out;
  }

  function cylinder(n) {
    var ry = Math.min(9, n.h / 6), x = n.x, y = n.y + ry, w = n.w, h = n.h - ry * 2, rx = w / 2;
    return '<path class="viz-box" d="M' + x + ',' + y + ' a' + rx + ',' + ry + ' 0 0 0 ' + w + ',0 v' + h +
      ' a' + rx + ',' + ry + ' 0 0 1 ' + (-w) + ',0 z"/>' +
      '<path class="viz-box viz-cyl-top" d="M' + x + ',' + y + ' a' + rx + ',' + ry + ' 0 0 1 ' + w + ',0 a' + rx + ',' + ry + ' 0 0 1 ' + (-w) + ',0 z"/>';
  }

  function nodeSvg(n) {
    var cls = 'viz-node viz-k-' + (n.kind || 'proc') + (n.cls ? ' ' + n.cls : '');
    var shape, text = '';
    var c = center(n);
    if (n.shape === 'cyl') {
      shape = cylinder(n);
      text = textBlock(n, c[0], c[1] + Math.min(9, n.h / 6) / 2, n.w - 12);
    } else if (n.draw) {
      shape = n.draw(n);
    } else {
      shape = '<rect class="viz-box" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8"/>';
      text = textBlock(n, c[0], c[1], n.w - 12);
    }
    var aria = String(n.label || '').replace(/\n/g, ' ') + (n.sub ? ' — ' + [].concat(n.sub).join(', ') : '');
    return '<g class="' + cls + '" data-node="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(aria + '. Press Enter for details.') + '">' +
      shape + text + '</g>';
  }

  function edgeSvg(e, map, mk) {
    var a = map[e.from], b = map[e.to];
    if (!a || !b) return '';
    var d, mid, p0, p1;
    if (e.vx != null) {
      /* vertical connector at a fixed x */
      var down = a.y < b.y;
      p0 = [e.vx, down ? a.y + a.h : a.y];
      p1 = [e.vx, down ? b.y : b.y + b.h];
      d = 'M' + p0 + ' L' + p1;
      mid = [e.vx, (p0[1] + p1[1]) / 2];
    } else if (e.hy != null) {
      /* horizontal connector at a fixed y */
      var right = a.x < b.x;
      p0 = [right ? a.x + a.w : a.x, e.hy];
      p1 = [right ? b.x : b.x + b.w, e.hy];
      d = 'M' + p0 + ' L' + p1;
      mid = [(p0[0] + p1[0]) / 2, e.hy];
    } else {
      var pts = e.pts || [];
      var ca = center(a), cb = center(b);
      p0 = clipRect(a, pts.length ? pts[0] : cb);
      p1 = clipRect(b, pts.length ? pts[pts.length - 1] : ca);
      if (e.curve) {
        /* quadratic curve bent perpendicular to the straight line */
        var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
        var dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
        var cx = mx - dy / len * e.curve, cy = my + dx / len * e.curve;
        d = 'M' + p0 + ' Q' + cx + ',' + cy + ' ' + p1;
        mid = [0.25 * p0[0] + 0.5 * cx + 0.25 * p1[0], 0.25 * p0[1] + 0.5 * cy + 0.25 * p1[1]];
      } else {
        var all = [p0].concat(pts, [p1]);
        d = 'M' + all.map(function (p) { return p[0] + ',' + p[1]; }).join(' L');
        var si = e.li != null ? e.li : Math.floor((all.length - 1) / 2);
        si = clamp(si, 0, all.length - 2);
        mid = [(all[si][0] + all[si + 1][0]) / 2, (all[si][1] + all[si + 1][1]) / 2];
      }
    }
    var cls = 'viz-edge' + (e.dash ? ' viz-e-dash' : '') + (e.hl ? ' viz-e-hl' : '') + (e.bad ? ' viz-e-bad' : '') +
      (e.flow ? ' viz-e-flow' : '') + (e.dim ? ' viz-e-dim' : '');
    var m = e.hl ? mk + '-h' : (e.bad ? mk + '-b' : mk);
    var out = '<path class="' + cls + '" d="' + d + '"' + (e.noarrow ? '' : ' marker-end="url(#' + m + ')"') +
      (e.bi ? ' marker-start="url(#' + m + ')"' : '') + '/>';
    if (e.l) {
      var lx = mid[0] + (e.lx || 0), ly = mid[1] + (e.ly || 0);
      var tw = e.l.length * 5.9 + 10;
      out += '<g class="viz-elabel' + (e.hl ? ' viz-elabel-hl' : '') + '"><rect x="' + (lx - tw / 2) + '" y="' + (ly - 9) + '" width="' + tw +
        '" height="17" rx="4"/><text x="' + lx + '" y="' + (ly + 4) + '">' + esc(e.l) + '</text></g>';
    }
    return out;
  }

  function markerDefs(mk) {
    function one(id, cls) {
      return '<marker id="' + id + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
        '<path d="M0,1 L9,5 L0,9 z" class="' + cls + '"/></marker>';
    }
    return '<defs>' + one(mk, 'viz-mk') + one(mk + '-h', 'viz-mk viz-mk-hl') + one(mk + '-b', 'viz-mk viz-mk-bad') + '</defs>';
  }

  function renderSvg(def, title, extraCls) {
    var mk = uid('vzm');
    var map = {};
    def.nodes.forEach(function (n) { map[n.id] = n; });
    (def.groups || []).forEach(function (g) { if (g.id) map[g.id] = g; });
    var s = '<svg class="viz-svg' + (extraCls ? ' ' + extraCls : '') + '" viewBox="0 0 ' + def.w + ' ' + def.h + '" role="group" aria-label="' + esc(title) + ' diagram" preserveAspectRatio="xMidYMid meet">';
    s += markerDefs(mk);
    (def.groups || []).forEach(function (g) {
      s += '<g class="viz-group' + (g.kind ? ' viz-gk-' + g.kind : '') + '"><rect x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="12"/>' +
        '<text class="viz-group-label" x="' + (g.x + 12) + '" y="' + (g.y + 17) + '">' + esc(g.label) + '</text></g>';
    });
    if (def.under) s += def.under;
    def.edges.forEach(function (e) { s += edgeSvg(e, map, mk); });
    def.nodes.forEach(function (n) { s += nodeSvg(n); });
    if (def.over) s += def.over;
    s += '</svg>';
    return s;
  }

  /* SVG text helper for decorations */
  function T(x, y, text, cls, anchor) {
    return '<text class="' + (cls || 'viz-s') + '" x="' + x + '" y="' + y + '"' + (anchor ? ' style="text-anchor:' + anchor + '"' : '') + '>' + esc(text) + '</text>';
  }

  /* ------------------------------------------------------------------
     Diagram definitions. Each build() returns a fresh definition.
     Coordinates are in viewBox units; SVG scales to 100% width.
     ------------------------------------------------------------------ */
  var D = {};

  D['pg-arch'] = {
    title: 'PostgreSQL architecture',
    desc: 'One postmaster forks a backend per client connection. All processes share memory (shared buffers, WAL buffers, lock tables); background processes move data between memory and disk.',
    build: function () {
      var bx = [30, 152, 274, 396, 518, 640, 762];
      return {
        w: 900, h: 530,
        groups: [
          G(16, 10, 392, 80, 'Clients'),
          G(16, 104, 392, 80, 'Backend processes — one per connection'),
          G(16, 200, 868, 98, 'Shared memory', { kind: 'mem' }),
          G(16, 312, 868, 98, 'Background (auxiliary) processes'),
          G(16, 424, 612, 98, 'Disk (PGDATA)', { kind: 'disk' }),
          G(636, 424, 248, 98, 'Outside this server', { kind: 'ext' })
        ],
        nodes: [
          N('c1', 30, 36, 112, 44, 'client', 'psql', 'CLI client', 'psql is the interactive terminal shipped with PostgreSQL. Like every client it speaks the frontend/backend wire protocol over TCP or a Unix socket.'),
          N('c2', 152, 36, 112, 44, 'client', 'Application', 'libpq / JDBC', 'Your application connects through a driver (libpq, JDBC, psycopg, node-postgres, Npgsql). Each open connection costs one backend process on the server — which is why pooling matters.'),
          N('c3', 274, 36, 120, 44, 'client', 'pgAdmin / BI', 'GUI & tools', 'GUI and BI tools are just more clients. They get no special path into the server.'),
          N('pm', 520, 36, 250, 44, 'proc', 'postmaster', 'listens on :5432, forks processes', 'The postmaster is the first PostgreSQL process. It listens for connections, authenticates them via pg_hba.conf (in the forked child), forks one backend per connection, starts the background processes and restarts them if they crash.'),
          N('b1', 30, 130, 112, 44, 'proc', 'backend', 'pid 4101', 'A backend (shown as "postgres: user db ..." in ps) parses, plans and executes the queries of exactly one client session. It has private memory such as work_mem for sorts and hashes.'),
          N('b2', 152, 130, 112, 44, 'proc', 'backend', 'pid 4102', 'Backends never write data files directly in the normal path: they modify pages in shared buffers and write WAL records describing the change.'),
          N('b3', 274, 130, 120, 44, 'proc', 'backend', 'pid 4103', 'Every backend is a separate OS process (not a thread). That gives isolation — one crashing backend makes the postmaster reset the cluster, but memory corruption cannot silently spread.'),
          N('sb', 30, 226, 470, 56, 'mem', 'Shared buffers', ['8 KB page cache shared by all processes (shared_buffers)'], 'The main data cache. Table and index pages are read from disk into 8 KB buffers here; modified ("dirty") pages are written back later by the checkpointer and bgwriter. A common starting size is ~25% of RAM.'),
          N('wb', 518, 226, 234, 56, 'mem', 'WAL buffers', 'wal_buffers', 'WAL records (descriptions of every change) are first placed in WAL buffers, then written and fsynced to pg_wal — at the latest when a transaction commits.'),
          N('lk', 762, 226, 112, 56, 'mem', 'Locks & CLOG', ['lock table,', 'xact status'], 'Shared memory also holds the heavyweight lock table, the proc array (who is running which transaction — used to build snapshots) and CLOG buffers (commit status of each transaction id).'),
          N('ckpt', bx[0], 338, 112, 52, 'bg', 'checkpointer', 'flushes all dirty', 'At every checkpoint (checkpoint_timeout / max_wal_size) the checkpointer writes all dirty buffers to the data files and records a REDO point. Crash recovery only needs WAL after the last checkpoint.'),
          N('bgw', bx[1], 338, 112, 52, 'bg', 'bgwriter', 'trickles dirty pages', 'The background writer writes some dirty buffers ahead of time so that backends rarely have to write a page themselves when they need a free buffer.'),
          N('avl', bx[2], 338, 112, 52, 'bg', 'autovacuum', 'launcher', 'The autovacuum launcher wakes up every autovacuum_naptime and decides which tables need VACUUM / ANALYZE based on dead-tuple and change counters.'),
          N('avw', bx[3], 338, 112, 52, 'bg', 'autovacuum', 'worker(s)', 'Workers (up to autovacuum_max_workers) do the actual VACUUM — removing dead tuple versions left by MVCC, updating the visibility map and freezing old xids — and ANALYZE.'),
          N('ww', bx[4], 338, 112, 52, 'bg', 'walwriter', 'flushes WAL', 'The WAL writer periodically writes and flushes WAL buffers to disk, so asynchronous commits become durable quickly and backends rarely wait.'),
          N('ws', bx[5], 338, 112, 52, 'bg', 'WAL sender', 'replication', 'One walsender process runs per connected standby (or logical replication subscriber) and streams WAL records to it over the replication protocol.'),
          N('arc', bx[6], 338, 112, 52, 'bg', 'archiver', 'archive_command', 'When archive_mode is on, the archiver copies each completed 16 MB WAL segment to an archive (via archive_command or archive_library) — the basis of PITR.'),
          N('df', 30, 450, 470, 56, 'disk', 'Data files', 'base/<db oid>/<relfilenode> — tables, indexes, 1 GB segments', 'Each table and index is stored as one or more 1 GB files of 8 KB pages under PGDATA/base. Free space map (_fsm) and visibility map (_vm) forks live beside them.', { shape: 'cyl' }),
          N('wal', 518, 450, 112, 56, 'disk', 'pg_wal/', '16 MB segments', 'The write-ahead log: sequential segment files. A commit is durable once its WAL is flushed here — data files can be updated later.', { shape: 'cyl' }),
          N('stb', 646, 450, 112, 56, 'ext', 'Standby', 'replica server', 'A standby server receives the WAL stream and replays it, staying a near-real-time copy that can serve read-only queries or be promoted.'),
          N('arch', 766, 450, 108, 56, 'ext', 'WAL archive', 'S3, NFS, repo', 'An external archive of WAL segments (plus base backups) lets you restore the cluster to any point in time.', { shape: 'cyl' })
        ],
        edges: [
          E('c1', 'b1', { bi: true, vx: 86 }), E('c2', 'b2', { bi: true, vx: 208 }), E('c3', 'b3', { bi: true, vx: 334 }),
          E('c3', 'pm', { dash: true, l: '1 connect' }),
          E('pm', 'b3', { dash: true, l: '2 fork()' }),
          E('b2', 'sb', { vx: 208, l: 'read / modify pages', bi: true }),
          E('b3', 'wb', { l: 'WAL records' }),
          E('sb', 'ckpt', { vx: 86 }), E('ckpt', 'df', { vx: 86, l: 'checkpoint' }),
          E('sb', 'bgw', { vx: 208 }), E('bgw', 'df', { vx: 208 }),
          E('avl', 'avw', { hy: 364 }), E('avw', 'sb', { vx: 452, l: 'VACUUM' }),
          E('wb', 'ww', { vx: 574 }), E('ww', 'wal', { vx: 574, l: 'flush' }),
          E('wal', 'ws'), E('ws', 'stb', { vx: 702 }),
          E('wal', 'arc', { dash: true }), E('arc', 'arch', { vx: 818 })
        ]
      };
    }
  };

  D['client-server'] = {
    title: 'Client–server model',
    desc: 'Clients talk to PostgreSQL over the network with the frontend/backend protocol. The postmaster authenticates the connection and hands it to a dedicated backend process.',
    build: function () {
      return {
        w: 940, h: 290,
        nodes: [
          N('app', 16, 117, 120, 56, 'client', 'Application', 'your code', 'Your program never touches data files. It sends SQL text (or prepared statements with parameters) and receives rows.'),
          N('drv', 216, 117, 140, 56, 'client', 'Driver', 'libpq · JDBC · psycopg', 'The driver implements the wire protocol: startup, authentication (SCRAM), simple and extended query messages, COPY and notifications.'),
          N('net', 436, 117, 140, 56, 'net', 'Network', 'TCP :5432 or Unix socket', 'Remote clients use TCP (default port 5432), ideally with TLS (hostssl in pg_hba.conf). Local clients can use a Unix-domain socket, which is faster and allows peer authentication.'),
          N('pm', 620, 24, 130, 56, 'proc', 'postmaster', 'listener', 'The postmaster accepts the TCP connection and immediately forks a backend, which reads the startup packet (user, database) and checks pg_hba.conf.'),
          N('hba', 800, 24, 124, 56, 'note', 'pg_hba.conf', 'who may connect, how', 'Host-based authentication: the first line matching connection type, database, user and client address decides the method (scram-sha-256, cert, peer, reject …).'),
          N('be', 620, 210, 130, 56, 'proc', 'Backend', 'one per session', 'After authentication the backend serves this client for the lifetime of the connection: parsing, planning and executing every statement.'),
          N('db', 800, 205, 124, 66, 'disk', 'Database', 'tables & indexes', 'The backend reads and writes pages through shared buffers; results are streamed back to the client as DataRow messages.', { shape: 'cyl' })
        ],
        edges: [
          E('app', 'drv', { bi: true, l: 'API calls' }),
          E('drv', 'net', { bi: true, l: 'wire protocol' }),
          E('net', 'pm', { l: '1 startup' }),
          E('pm', 'hba', { l: '2 auth' }),
          E('pm', 'be', { vx: 685, dash: true, l: '3 fork' }),
          E('net', 'be', { bi: true, l: '4 SQL ⇄ rows', hl: true, lx: 46, ly: -6 }),
          E('be', 'db', { bi: true })
        ]
      };
    }
  };

  D['process-model'] = {
    title: 'Process model',
    desc: 'PostgreSQL is multi-process: the postmaster forks one backend per connection plus a fixed set of auxiliary processes, all attached to the same shared memory.',
    build: function () {
      return {
        w: 860, h: 400,
        groups: [G(540, 96, 304, 200, 'Auxiliary / background processes', { id: 'aux' })],
        nodes: [
          N('pm', 300, 16, 180, 52, 'proc', 'postmaster', 'parent of every process', 'The postmaster supervises everything. If any child crashes it terminates the other backends and reinitialises shared memory, because shared state might be corrupted.'),
          N('c1', 16, 110, 110, 44, 'client', 'Client 1', null, 'Each client connection gets its own server process. 500 connections = 500 processes, each using memory even while idle.'),
          N('c2', 16, 180, 110, 44, 'client', 'Client 2', null, 'Idle connections still hold a process and memory. Use a pooler such as PgBouncer when you have many short-lived or mostly idle connections.'),
          N('c3', 16, 250, 110, 44, 'client', 'Client 3', null, 'This client runs a big analytical query, so its backend recruits parallel workers.'),
          N('be1', 190, 110, 130, 44, 'proc', 'backend', 'serves client 1', 'A backend handles one session: it parses, plans and executes queries and keeps per-session caches (catalog cache, prepared statements).'),
          N('be2', 190, 180, 130, 44, 'proc', 'backend', 'serves client 2', 'Backends communicate only through shared memory and signals — e.g. lock waits, snapshot building from the proc array, and invalidation messages.'),
          N('be3', 190, 250, 130, 44, 'proc', 'backend', 'leader', 'For a parallel plan this backend becomes the leader: it starts parallel workers and merges their output in a Gather / Gather Merge node.'),
          N('pw', 370, 250, 130, 44, 'proc', 'parallel worker', 'max_parallel_workers', 'Parallel workers are background workers started on demand (limited by max_parallel_workers_per_gather) that scan parts of a table and send tuples to the leader through shared-memory queues.'),
          N('ckpt', 552, 124, 136, 44, 'bg', 'checkpointer', null, 'Writes dirty buffers at checkpoints and records the REDO point used by crash recovery.'),
          N('bgw', 698, 124, 136, 44, 'bg', 'bgwriter', null, 'Writes dirty buffers in the background so backends find clean buffers to reuse.'),
          N('ww', 552, 180, 136, 44, 'bg', 'walwriter', null, 'Flushes WAL buffers to pg_wal periodically (wal_writer_delay).'),
          N('avl', 698, 180, 136, 44, 'bg', 'autovacuum', 'launcher → workers', 'Schedules autovacuum workers, which VACUUM and ANALYZE tables in the background.'),
          N('arc', 552, 236, 136, 44, 'bg', 'archiver', null, 'Copies completed WAL segments to the archive when archive_mode = on.'),
          N('lrl', 698, 236, 136, 44, 'bg', 'logical rep.', 'launcher', 'Starts apply workers for logical-replication subscriptions. Others you may see: startup (recovery), walsender, walreceiver, walsummarizer (PG 17).'),
          N('shm', 190, 330, 654, 52, 'mem', 'Shared memory', 'shared buffers · WAL buffers · lock table · proc array · CLOG — every process attaches', 'One shared memory segment is created by the postmaster at startup; all children inherit it. This is why shared_buffers changes need a restart.')
        ],
        edges: [
          E('c1', 'be1', { bi: true }), E('c2', 'be2', { bi: true }), E('c3', 'be3', { bi: true }),
          E('pm', 'be1', { dash: true, pts: [[345, 90], [345, 132]], l: 'fork()', li: 1 }), E('pm', 'be2', { dash: true, pts: [[345, 90], [345, 202]] }), E('pm', 'be3', { dash: true, pts: [[345, 90], [345, 262]] }),
          E('pm', 'aux', { dash: true, l: 'starts & restarts' }),
          E('be3', 'pw', { l: 'Gather' }),
          E('be3', 'shm', { vx: 255, l: 'attach' }), E('pw', 'shm', { vx: 435 }), E('aux', 'shm', { vx: 692 })
        ]
      };
    }
  };

  D['memory'] = {
    title: 'Memory architecture',
    desc: 'Shared memory is allocated once for the whole instance; local memory is allocated per backend and per operation — so total RAM ≈ shared_buffers + connections × (work_mem × operations) + OS cache.',
    build: function () {
      return {
        w: 820, h: 470,
        groups: [
          G(16, 12, 788, 130, 'Shared memory — one per instance (sized at startup)', { kind: 'mem' }),
          G(16, 160, 788, 130, 'Local memory — per backend process (× connections)')
        ],
        nodes: [
          N('sb', 30, 40, 270, 86, 'mem', 'shared_buffers', ['cache of 8 KB table & index pages', 'start at ~25% of RAM'], 'The database buffer cache. Hit ratio here (pg_stat_database blks_hit vs blks_read) is a key health metric. Changing it requires a restart.'),
          N('wb', 316, 40, 150, 86, 'mem', 'wal_buffers', ['WAL records before', 'they are flushed'], 'Holds WAL not yet written to disk. Default -1 = 1/32 of shared_buffers (max one 16 MB segment). Rarely needs tuning.'),
          N('clog', 482, 40, 150, 86, 'mem', 'CLOG (pg_xact)', ['commit status of', 'each transaction'], 'Two bits per transaction id: in progress, committed, aborted, sub-committed. MVCC visibility checks consult it (and cache the answer in tuple hint bits).'),
          N('lk', 648, 40, 142, 86, 'mem', 'Lock table', ['heavyweight locks', 'max_locks_per_transaction'], 'Table-level and advisory locks live in a fixed-size shared hash table. Row locks are stored in the tuple itself (xmax), not here.'),
          N('wm', 30, 188, 200, 86, 'proc', 'work_mem', ['per sort / hash node', 'may be used many times'], 'Memory for one sort or hash operation. A query with 5 hash joins can use 5 × work_mem (×hash_mem_multiplier), per backend and per parallel worker. When exceeded, data spills to temp files.'),
          N('mwm', 246, 188, 200, 86, 'proc', 'maintenance_work_mem', ['VACUUM, CREATE INDEX,', 'ALTER TABLE ADD FOREIGN KEY'], 'Used by maintenance operations. Larger values make index builds and vacuum faster; autovacuum workers use autovacuum_work_mem if set.'),
          N('tb', 462, 188, 150, 86, 'proc', 'temp_buffers', ['buffers for', 'temporary tables'], 'Temporary tables are private to a session, so their pages are cached in local temp_buffers instead of shared buffers.'),
          N('cc', 628, 188, 162, 86, 'proc', 'Caches', ['catalog, relcache,', 'plan cache'], 'Each backend caches catalog rows and prepared-statement plans. Thousands of tables × many connections can make these caches surprisingly large.'),
          N('os', 30, 312, 560, 58, 'note', 'OS page cache (kernel)', 'PostgreSQL uses buffered I/O, so file pages are also cached by the operating system', 'PostgreSQL relies on the OS cache as a second-level cache (double buffering). That is why shared_buffers is not set to 90% of RAM.'),
          N('ecs', 606, 312, 184, 58, 'note', 'effective_cache_size', 'planner hint only', 'Not an allocation. It tells the planner how much data is probably cached (shared_buffers + OS cache), making index scans look cheaper. Often ~50–75% of RAM.'),
          N('disk', 30, 392, 760, 64, 'disk', 'Disk', 'data files · pg_wal · temp files (when work_mem is exceeded: "Sort Method: external merge")', 'Spills to temp files show up in EXPLAIN ANALYZE and in pg_stat_database.temp_bytes; log_temp_files helps find the offending queries.', { shape: 'cyl' })
        ],
        edges: [
          E('sb', 'os', { vx: 238, bi: true, l: '8 KB pages' }),
          E('os', 'disk', { vx: 310, bi: true }),
          E('wm', 'os', { vx: 130, dash: true, l: 'spill' })
        ]
      };
    }
  };

  D['storage-page'] = {
    title: 'Heap page layout (8 KB)',
    desc: 'Every table and index file is a sequence of 8 KB pages. Line pointers grow from the front, tuples grow from the back, and free space sits in the middle.',
    build: function () {
      var lpDraw = function (n) {
        var s = '<rect class="viz-box" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="6"/>';
        for (var i = 0; i < 4; i++) {
          var x = n.x + 6 + i * 50;
          s += '<rect class="viz-cell" x="' + x + '" y="' + (n.y + 5) + '" width="44" height="' + (n.h - 10) + '" rx="3"/>' +
            '<text class="viz-s viz-mono" x="' + (x + 22) + '" y="' + (n.y + n.h / 2 + 4) + '">lp ' + (i + 1) + '</text>';
        }
        return s + '<text class="viz-t" x="' + (n.x + 214) + '" y="' + (n.y + n.h / 2 + 4) + '" style="text-anchor:start">Line pointers (ItemIdData, 4 B each)</text>';
      };
      /* curved arrows lp i -> tuple i (tuples are stored back-to-front) */
      var tgt = { 1: [405, 312], 2: [150, 312], 3: [450, 266], 4: [295, 266] };
      var arrows = '';
      for (var i = 1; i <= 4; i++) {
        var sx = 30 + 6 + (i - 1) * 50 + 22, sy = 124, t = tgt[i];
        arrows += '<path class="viz-edge viz-e-thin" d="M' + sx + ',' + sy + ' C' + sx + ',' + (sy + 70) + ' ' + t[0] + ',' + (t[1] - 70) + ' ' + t[0] + ',' + t[1] + '"/>';
      }
      return {
        w: 860, h: 440,
        groups: [G(16, 14, 528, 400, '8 KB heap page (block)', { kind: 'disk' }), G(566, 14, 278, 400, 'Inside one heap tuple')],
        under: '',
        over: arrows +
          T(258, 140, 'pd_lower ↑', 'viz-s viz-mono', 'start') + T(232, 262, 'pd_upper ↓', 'viz-s viz-mono', 'end') +
          T(30, 432, 'ctid = (block number, line pointer index), e.g. (0,3)', 'viz-s viz-mono', 'start'),
        nodes: [
          N('hdr', 30, 40, 500, 44, 'proc', 'PageHeaderData — 24 bytes', 'pd_lsn · checksum · flags · pd_lower · pd_upper · pd_special', 'The header stores the LSN of the last WAL record that changed the page (so recovery knows whether to replay), an optional checksum, and offsets to the start/end of free space.'),
          N('lps', 30, 92, 500, 32, 'accent', 'Line pointers', null, 'An array of 4-byte item identifiers pointing to tuples in this page. Indexes point to (page, line pointer) rather than byte offsets, so tuples can be moved within the page (e.g. by pruning) without touching indexes.', { draw: lpDraw }),
          N('free', 30, 146, 500, 110, 'note', 'Free space', 'new line pointers grow down · new tuples grow up', 'The hole between pd_lower and pd_upper. When an UPDATE fits in the same page and no indexed column changes, PostgreSQL can do a HOT update here. fillfactor < 100 reserves room for that.', { cls: 'viz-dashed' }),
          N('t4', 240, 266, 110, 38, 'mem', 'tuple 4', 'newest', 'Tuples are added from the end of the page towards the front, so the newest tuple sits at pd_upper.'),
          N('t3', 360, 266, 170, 38, 'mem', 'tuple 3', null, 'Each tuple has a 23-byte header plus its column data, aligned to 8 bytes (MAXALIGN). Column order affects padding!'),
          N('t2', 30, 312, 240, 38, 'mem', 'tuple 2', null, 'An UPDATE writes a new tuple version (maybe in another page) and sets xmax on the old one; the old version becomes dead once no snapshot needs it.'),
          N('t1', 280, 312, 250, 38, 'mem', 'tuple 1', 'oldest, at the end', 'The first tuple inserted into a page is stored at the very end, just before the special space.'),
          N('sp', 30, 360, 500, 40, 'warn', 'Special space', 'empty on heap pages · index pages keep e.g. B-tree sibling links here', 'Access-method specific area at the end of the page. B-tree pages store left/right sibling pointers and the tree level here.'),
          N('th', 580, 44, 250, 100, 'proc', 'HeapTupleHeader (23 B)', ['t_xmin · t_xmax  (MVCC)', 't_cid · t_ctid (→ newer version)', 't_infomask · t_hoff'], 'xmin = inserting transaction id, xmax = deleting/locking transaction id, t_ctid points to the newer version after an UPDATE, infomask holds hint bits (e.g. "xmin committed").'),
          N('nb', 580, 156, 250, 50, 'note', 'Null bitmap', 'present only if a column is NULL', 'One bit per column. NULLs take no space in the data area, only a bit here.'),
          N('ud', 580, 218, 250, 86, 'mem', 'User data', ['column values, aligned', 'values > ~2 KB → TOAST table'], 'The actual column values. Large variable-length values are compressed and/or moved out-of-line into the table\'s TOAST relation, leaving an 18-byte pointer.'),
          N('tmx', 580, 318, 250, 80, 'note', 'Tuple size limit', ['a row must fit in one page', '(TOAST makes big rows possible)'], 'Rows cannot span pages; TOAST keeps rows small. Max columns per table is 1600.')
        ],
        edges: [E('t1', 'th', { dash: true })]
      };
    }
  };

  D['query-pipeline'] = {
    title: 'Query processing pipeline',
    desc: 'Every statement goes through parse → analyze → rewrite → plan → execute. The planner picks the cheapest plan using table statistics; the executor pulls rows through the plan tree.',
    build: function () {
      var st = [['sql', 16, 110], ['parser', 156, 124], ['analyzer', 310, 124], ['rewriter', 464, 124], ['planner', 618, 140], ['executor', 788, 136]];
      return {
        w: 940, h: 320,
        nodes: [
          N('sql', 16, 40, 110, 60, 'client', 'SQL text', 'SELECT … FROM …', 'The client sends a query string (simple protocol) or Parse/Bind/Execute messages (extended protocol, used for prepared statements).'),
          N('parser', 156, 40, 124, 60, 'proc', 'Parser', 'grammar → parse tree', 'Lexer + Bison grammar check syntax only and build a raw parse tree. Typos like SELEC fail here. No catalog lookups yet.'),
          N('analyzer', 310, 40, 124, 60, 'proc', 'Analyzer', 'names → catalog OIDs', 'Semantic analysis: resolves table/column names, types, functions and operators via the system catalog. "column does not exist" errors come from here.'),
          N('rewriter', 464, 40, 124, 60, 'proc', 'Rewriter', 'views & rules', 'Applies the rule system: references to views are replaced by the view definition, and row-level security policies are added as extra quals.'),
          N('planner', 618, 40, 140, 60, 'accent', 'Planner / Optimizer', 'cheapest plan wins', 'Generates alternative plans (scan types, join orders, join methods), estimates their cost from statistics and cost parameters (seq_page_cost, random_page_cost …) and keeps the cheapest. Many tables → genetic optimizer (geqo).'),
          N('executor', 788, 40, 136, 60, 'proc', 'Executor', 'demand-pull plan tree', 'Runs the plan as a tree of nodes; each node returns one row at a time to its parent (Volcano model). EXPLAIN ANALYZE instruments exactly this tree.'),
          N('pt', 156, 150, 100, 40, 'note', 'raw parse tree', null, 'Pure syntax structure — no knowledge of whether tables exist.'),
          N('qt', 310, 150, 100, 40, 'note', 'query tree', null, 'The Query node: range table (tables referenced), target list, quals — all resolved to OIDs.'),
          N('rqt', 464, 150, 100, 40, 'note', 'rewritten tree', null, 'Zero or more query trees after rule expansion (views inlined).'),
          N('plan', 618, 150, 100, 40, 'note', 'plan tree', null, 'What EXPLAIN shows: e.g. Hash Join → Seq Scan + Hash → Index Scan, with estimated costs and rows.'),
          N('rows', 788, 150, 100, 40, 'success', 'result rows', null, 'Rows stream back to the client as they are produced (unless a node like Sort must consume all input first).'),
          N('cat', 310, 240, 124, 56, 'disk', 'System catalog', 'pg_class, pg_attribute', 'Catalog tables describe every object. Backends cache them (syscache/relcache) to avoid repeated lookups.', { shape: 'cyl' }),
          N('stats', 618, 240, 140, 56, 'disk', 'Statistics', 'pg_statistic (ANALYZE)', 'Per-column stats: null fraction, distinct count, most-common values, histogram, correlation. Stale stats → bad row estimates → bad plans. Run ANALYZE after bulk loads.', { shape: 'cyl' }),
          N('bufs', 788, 240, 136, 56, 'mem', 'Buffer manager', 'shared buffers → disk', 'Scan nodes request pages from the buffer manager; EXPLAIN (BUFFERS) shows hits (in cache) vs reads (from OS/disk).')
        ],
        edges: [
          E('sql', 'parser', { flow: true }), E('parser', 'analyzer', { flow: true }), E('analyzer', 'rewriter', { flow: true }),
          E('rewriter', 'planner', { flow: true }), E('planner', 'executor', { flow: true }),
          E('parser', 'pt', { vx: 196, dash: true }), E('analyzer', 'qt', { vx: 350, dash: true }), E('rewriter', 'rqt', { vx: 504, dash: true }),
          E('planner', 'plan', { vx: 658, dash: true }), E('executor', 'rows', { vx: 828, dash: true }),
          E('cat', 'analyzer', { vx: 422, l: 'lookups', lx: 26 }), E('stats', 'planner', { vx: 743, l: 'estimates', lx: 32 }), E('executor', 'bufs', { vx: 908, bi: true })
        ]
      };
    }
  };

  D['mvcc'] = {
    title: 'MVCC: tuple versions & snapshots',
    desc: 'An UPDATE never overwrites a row: it writes a new version and stamps the old one with xmax. Each transaction’s snapshot decides which version it can see — readers never block writers.',
    build: function () {
      return {
        w: 900, h: 390,
        under: '<line class="viz-axis" x1="30" y1="42" x2="880" y2="42"/>' + T(880, 96, 'time →', 'viz-s', 'end'),
        nodes: [
          N('e1', 40, 20, 170, 46, 'proc', 'xid 100: INSERT', 'balance = 500 · committed', 'Transaction 100 inserted the row and committed. The tuple header records xmin = 100.'),
          N('sa', 255, 20, 180, 46, 'accent', 'Snapshot A taken', 'xid 105 still in progress', 'A snapshot lists which transactions count as committed for its owner: xmin, xmax and the in-progress list (xip). 105 is in the list, so its effects are invisible to A — even after 105 commits.'),
          N('e2', 480, 20, 170, 46, 'proc', 'xid 105: UPDATE', 'balance → 400 · commits', 'UPDATE = mark old version (xmax = 105) + insert new version (xmin = 105). Both versions exist in the heap at the same time.'),
          N('sb', 695, 20, 180, 46, 'accent', 'Snapshot B taken', 'after 105 committed', 'Taken after 105 committed, so B sees 105’s work.'),
          N('v1', 190, 150, 230, 92, 'note', 'Tuple v1 · ctid (0,1)', ['xmin 100 · xmax 105', 'balance = 500'], 'The old version. It becomes a dead tuple once no running snapshot can still see it; VACUUM then reclaims its space.', { cls: 'viz-old' }),
          N('v2', 480, 150, 230, 92, 'mem', 'Tuple v2 · ctid (0,2)', ['xmin 105 · xmax 0', 'balance = 400'], 'The new version. xmax = 0 means nobody has deleted or updated it yet.'),
          N('ta', 30, 296, 260, 74, 'accent', 'Txn A (snapshot A)', ['105 counts as in progress →', 'sees v1: balance 500'], 'With REPEATABLE READ, A keeps the same snapshot for the whole transaction, so it keeps reading 500 — consistent, without any read lock.'),
          N('rule', 320, 296, 260, 74, 'note', 'Visibility rule', ['visible if xmin committed in my snapshot', 'AND xmax not committed in my snapshot'], 'Simplified HeapTupleSatisfiesMVCC: a version is visible when its inserter is committed-and-visible to me (or is me), and its deleter is not.'),
          N('tb', 610, 296, 260, 74, 'accent', 'Txn B (snapshot B)', ['105 committed & visible →', 'sees v2: balance 400'], 'For B, v1 is hidden because its xmax (105) is committed in B’s snapshot; v2 is visible because its xmin (105) is.')
        ],
        edges: [
          E('e1', 'sa'), E('sa', 'e2'), E('e2', 'sb'),
          E('v1', 'v2', { l: 't_ctid', ly: -14 }),
          E('ta', 'v1', { hl: true, l: 'visible' }),
          E('tb', 'v2', { hl: true, l: 'visible' }),
          E('ta', 'v2', { bad: true, dash: true, l: 'invisible' })
        ]
      };
    }
  };

  D['wal'] = {
    title: 'Write-Ahead Log (WAL)',
    desc: 'Log first, data later: a commit is durable once its WAL record is flushed. Dirty data pages are written lazily at checkpoints; after a crash, WAL since the last checkpoint is replayed.',
    build: function () {
      return {
        w: 900, h: 400,
        groups: [G(16, 278, 868, 104, 'Crash recovery', { kind: 'danger' })],
        nodes: [
          N('be', 16, 30, 140, 60, 'client', 'Backend', 'UPDATE …; COMMIT', 'A transaction modifies a page in shared buffers and generates a WAL record describing the change, tagged with an LSN (log sequence number).'),
          N('wb', 216, 30, 150, 60, 'mem', 'WAL buffers', 'record @ LSN 0/3A1F28', 'WAL records are appended to the in-memory WAL buffers first.'),
          N('walf', 426, 24, 150, 72, 'disk', 'pg_wal/', 'fsync at COMMIT', 'At COMMIT the WAL up to the commit record is written and fsynced (synchronous_commit = on). Sequential writes are cheap compared to random data-file writes.', { shape: 'cyl' }),
          N('ack', 636, 30, 140, 60, 'success', 'COMMIT ok', 'durable now', 'The client gets success only after WAL is safely on disk — even though the table file itself has not been updated yet.'),
          N('sbuf', 216, 170, 150, 60, 'mem', 'Shared buffers', 'page modified (dirty)', 'The data page is changed only in memory. The page LSN is set so it is never written to disk before its WAL (the WAL rule).'),
          N('ckpt', 426, 170, 150, 60, 'proc', 'Checkpointer', 'checkpoint_timeout / max_wal_size', 'A checkpoint writes all dirty pages and fsyncs the data files, then writes a checkpoint record. Older WAL is no longer needed for crash recovery (it may still be needed for archiving/replicas). The first change to a page after a checkpoint logs a full-page image (full_page_writes) to protect against torn pages.'),
          N('df', 636, 164, 150, 72, 'disk', 'Data files', 'heap & index pages', 'Data files can lag behind WAL; they are only guaranteed consistent at a checkpoint (and after recovery).', { shape: 'cyl' }),
          N('crash', 30, 306, 130, 58, 'danger', 'Crash!', 'power loss / kill -9', 'Uncommitted work and dirty buffers in memory are lost. Committed work is safe in WAL.'),
          N('start', 196, 306, 170, 58, 'proc', 'Startup process', 'reads last checkpoint', 'On restart, the startup process reads pg_control to find the latest checkpoint and its REDO location.'),
          N('replay', 400, 306, 190, 58, 'proc', 'Replay WAL from REDO', 'apply records ≥ REDO LSN', 'Every WAL record after REDO is re-applied if the page LSN is older than the record — redo is idempotent. Standby servers run exactly this loop forever.'),
          N('ok', 640, 306, 230, 58, 'success', 'Consistent again', 'accept connections', 'After replay all committed transactions are present, uncommitted ones are simply invisible (their xids never committed in CLOG). No undo phase is needed thanks to MVCC.')
        ],
        edges: [
          E('be', 'wb', { l: '1 log first', hl: true }), E('wb', 'walf', { l: '2 flush', hl: true }), E('walf', 'ack', { l: '3', hl: true }),
          E('be', 'sbuf', { l: 'change page' }), E('sbuf', 'ckpt', { l: 'dirty' }), E('ckpt', 'df', { l: '4 write' }),
          E('ckpt', 'walf', { vx: 501, dash: true, l: 'REDO point' }),
          E('crash', 'start'), E('start', 'replay'), E('replay', 'ok'),
          E('walf', 'replay', { dash: true, pts: [[606, 92], [606, 290]], l: 'replay', li: 1, ly: 50 })
        ]
      };
    }
  };

  D['btree'] = {
    title: 'B-tree index',
    desc: 'A balanced tree of 8 KB pages: root → branch (internal) → leaf. Leaves are sorted, linked to siblings, and point to heap tuples by TID. Highlighted: lookup of id = 67.',
    build: function () {
      var leaves = ['5 · 12 · 17', '20 · 26 · 33', '41 · 48 · 55', '60 · 67 · 74', '80 · 85 · 88', '90 · 94 · 99'];
      var nodes = [
        N('root', 350, 20, 180, 46, 'accent', 'Root: 40 | 80', '3 child pointers', 'The root page holds separator keys. Comparing 67 with 40 and 80 sends the search to the middle child. Real root pages hold hundreds of keys, so trees stay 3–4 levels deep even for billions of rows.', { cls: 'viz-on' }),
        N('b1', 77, 115, 150, 44, 'proc', 'Branch: 20', 'keys < 40', 'Internal (branch) page covering keys below 40. Keys < 20 go left, ≥ 20 go right.'),
        N('b2', 365, 115, 150, 44, 'proc', 'Branch: 60', 'keys 40 – 79', 'Internal page for 40–79. 67 ≥ 60, so the search continues to the right child leaf.', { cls: 'viz-on' }),
        N('b3', 653, 115, 150, 44, 'proc', 'Branch: 90', 'keys ≥ 80', 'Internal page for keys from 80 upwards.')
      ];
      leaves.forEach(function (k, i) {
        nodes.push(N('l' + (i + 1), 20 + i * 144, 210, 120, 42, 'mem', k, 'leaf page', i === 3 ?
          'Leaf page holding 60, 67, 74. Each entry stores the key and a TID (heap block, line pointer). 67 → (7,3).' :
          'Leaf pages hold every indexed key in sorted order with a TID pointing to the heap row. Leaves are doubly linked, so range scans (BETWEEN, ORDER BY) walk sideways without going back up.', i === 3 ? { cls: 'viz-on' } : null));
      });
      nodes.push(N('h2', 150, 320, 220, 52, 'disk', 'Heap page 2', 'rows in insertion order', 'The table (heap) is unordered. An index scan does one random heap fetch per matching TID — unless the index covers all needed columns (Index Only Scan with an up-to-date visibility map).'));
      nodes.push(N('h7', 500, 320, 220, 52, 'disk', 'Heap page 7', 'tuple (7,3): id = 67', 'The heap fetch also checks MVCC visibility — the index itself does not know which transactions can see the row.', { cls: 'viz-on' }));
      return {
        w: 900, h: 400,
        nodes: nodes,
        over: T(450, 394, 'WHERE id = 67 → root + branch + leaf + 1 heap page = 4 page reads (a seq scan reads every page)', 'viz-s viz-cap', 'middle'),
        edges: [
          E('root', 'b1'), E('root', 'b2', { hl: true }), E('root', 'b3'),
          E('b1', 'l1'), E('b1', 'l2'), E('b2', 'l3'), E('b2', 'l4', { hl: true }), E('b3', 'l5'), E('b3', 'l6'),
          E('l1', 'l2', { bi: true, dash: true }), E('l2', 'l3', { bi: true, dash: true }), E('l3', 'l4', { bi: true, dash: true }),
          E('l4', 'l5', { bi: true, dash: true }), E('l5', 'l6', { bi: true, dash: true }),
          E('l4', 'h7', { hl: true, l: 'TID (7,3)' }), E('l3', 'h2', { dash: true })
        ]
      };
    }
  };

  D['joins'] = {
    title: 'Join types',
    desc: 'Which rows of A and B survive each join. Shaded area = rows in the result; unmatched rows of the preserved side are padded with NULLs.',
    build: function () {
      var types = [
        ['inner', 'INNER JOIN', 'matching rows only', 'A JOIN B ON a.id = b.a_id', 'lens', 'Only pairs where the ON condition is true. Rows without a partner disappear from both sides.'],
        ['left', 'LEFT JOIN', 'all of A + matches', 'A LEFT JOIN B ON …', 'A', 'Every row of A appears at least once; where B has no match, B’s columns are NULL. Filtering B in WHERE (not ON) silently turns it back into an inner join!'],
        ['right', 'RIGHT JOIN', 'all of B + matches', 'A RIGHT JOIN B ON …', 'B', 'Mirror of LEFT JOIN — usually rewritten as a LEFT JOIN with the tables swapped for readability.'],
        ['full', 'FULL JOIN', 'everything, NULL-padded', 'A FULL JOIN B ON …', 'AB', 'All rows from both sides; unmatched rows get NULLs on the other side. Useful for reconciliation (what is only in A, only in B).'],
        ['anti', 'ANTI JOIN', 'A rows with no match', 'WHERE NOT EXISTS (…)', 'Aonly', 'Rows of A that have no partner in B. Write it as NOT EXISTS (or LEFT JOIN … WHERE b.id IS NULL); avoid NOT IN with nullable columns — one NULL makes it return nothing. EXPLAIN shows "Hash Anti Join".']
      ];
      var nodes = types.map(function (t, i) {
        var x = i * 180;
        return N(t[0], x + 6, 10, 168, 236, 'note', t[1], t[2], t[5], {
          draw: function (n) {
            var cx = x + 90, cy = 92, r = 44, o = 25, hh = Math.sqrt(r * r - o * o);
            var p1 = cx + ',' + (cy - hh), p2 = cx + ',' + (cy + hh);
            var A = '<circle cx="' + (cx - o) + '" cy="' + cy + '" r="' + r + '"', B = '<circle cx="' + (cx + o) + '" cy="' + cy + '" r="' + r + '"';
            var lens = '<path class="viz-venn-fill" d="M' + p1 + ' A' + r + ',' + r + ' 0 0 1 ' + p2 + ' A' + r + ',' + r + ' 0 0 1 ' + p1 + 'z"/>';
            var aOnly = '<path class="viz-venn-fill" d="M' + p1 + ' A' + r + ',' + r + ' 0 1 0 ' + p2 + ' A' + r + ',' + r + ' 0 0 1 ' + p1 + 'z"/>';
            var fill = '';
            if (t[4] === 'lens') fill = lens;
            else if (t[4] === 'A') fill = A + ' class="viz-venn-fill"/>';
            else if (t[4] === 'B') fill = B + ' class="viz-venn-fill"/>';
            else if (t[4] === 'AB') fill = A + ' class="viz-venn-fill"/>' + B + ' class="viz-venn-fill"/>';
            else fill = aOnly;
            return '<rect class="viz-box" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="10"/>' + fill +
              A + ' class="viz-venn"/>' + B + ' class="viz-venn"/>' +
              T(cx - o - 16, cy + 5, 'A', 'viz-t') + T(cx + o + 16, cy + 5, 'B', 'viz-t') +
              T(cx, 170, t[1], 'viz-t') + T(cx, 190, t[2], 'viz-s') + T(cx, 220, t[3], 'viz-s viz-mono viz-xs');
          }
        });
      });
      return { w: 900, h: 256, nodes: nodes, edges: [] };
    }
  };

  D['read-replica'] = {
    title: 'Read replicas',
    desc: 'Writes go to the single primary; read-only queries can be spread across streaming replicas. Replicas are asynchronous by default, so they may lag slightly behind.',
    build: function () {
      return {
        w: 860, h: 330,
        nodes: [
          N('app', 20, 135, 150, 60, 'client', 'Application', 'routes reads & writes', 'The app (or a proxy such as HAProxy/pgpool, or a driver with target_session_attrs / load_balance_hosts) sends writes to the primary and reads to replicas.'),
          N('pri', 330, 24, 190, 70, 'proc', 'Primary', 'read-write', 'The only node that accepts writes. It generates WAL and ships it to every replica.', { shape: 'cyl' }),
          N('r1', 330, 140, 190, 64, 'mem', 'Replica 1', 'read-only (hot standby)', 'A physical standby with hot_standby = on serves SELECTs. Any write attempt fails with "cannot execute … in a read-only transaction".', { shape: 'cyl' }),
          N('r2', 330, 246, 190, 64, 'mem', 'Replica 2', 'read-only (hot standby)', 'Add replicas to scale reads. They are byte-for-byte copies of the whole cluster (all databases).', { shape: 'cyl' }),
          N('lag', 636, 130, 210, 76, 'warn', 'Replication lag', ['replicas may be ms–s behind', 'read-your-writes → primary'], 'Check pg_stat_replication.replay_lag on the primary or now() - pg_last_xact_replay_timestamp() on the replica. Long queries on replicas can also be cancelled by recovery conflicts (see hot_standby_feedback, max_standby_streaming_delay).')
        ],
        edges: [
          E('app', 'pri', { l: 'writes', hl: true }), E('app', 'r1', { l: 'reads' }), E('app', 'r2', { l: 'reads' }),
          E('pri', 'r1', { vx: 425, l: 'WAL stream' }),
          E('pri', 'r2', { pts: [[570, 59], [570, 278]], l: 'WAL (async)', li: 1 })
        ]
      };
    }
  };

  D['streaming-replication'] = {
    title: 'Physical streaming replication',
    desc: 'The primary’s walsender streams WAL records to the standby’s walreceiver; the standby’s startup process replays them continuously. The standby reports back how far it has written, flushed and replayed.',
    build: function () {
      return {
        w: 920, h: 400,
        groups: [G(16, 16, 420, 300, 'Primary server'), G(484, 16, 420, 300, 'Standby server (hot standby)')],
        nodes: [
          N('bk', 36, 50, 160, 52, 'client', 'Backends', 'write transactions', 'Normal read-write sessions generate WAL on the primary.'),
          N('wbuf', 36, 130, 160, 52, 'mem', 'WAL buffers', null, 'WAL is staged in memory and flushed to pg_wal.'),
          N('pgw', 36, 210, 160, 70, 'disk', 'pg_wal/', 'WAL segments', 'WAL files on the primary. They are recycled after checkpoints unless a replication slot or wal_keep_size retains them.', { shape: 'cyl' }),
          N('slot', 256, 50, 160, 52, 'note', 'Replication slot', 'retains needed WAL', 'A physical slot remembers how far the standby has consumed, so the primary never deletes WAL it still needs. Danger: an abandoned slot makes pg_wal grow until the disk fills (cap with max_slot_wal_keep_size).'),
          N('ws', 256, 210, 160, 70, 'proc', 'walsender', 'streams from an LSN', 'Started when the standby connects with a replication connection (pg_hba.conf "replication" database). Sends WAL as soon as it is flushed — or even before for remote_write tracking.'),
          N('wr', 504, 210, 160, 70, 'proc', 'walreceiver', 'writes & flushes WAL', 'Connects to the primary using primary_conninfo, receives WAL, writes it to the standby’s pg_wal and reports positions back.'),
          N('spgw', 724, 210, 160, 70, 'disk', 'pg_wal/', 'standby copy', 'The standby keeps its own WAL copy; it could also restore segments from an archive with restore_command if streaming falls behind.', { shape: 'cyl' }),
          N('startup', 724, 130, 160, 52, 'proc', 'startup process', 'replays WAL', 'The same redo loop used in crash recovery — running forever until the standby is promoted (pg_ctl promote / pg_promote()).'),
          N('sdf', 724, 46, 160, 60, 'disk', 'Data files', 'identical blocks', 'A physical replica is block-for-block identical to the primary: same major version, same architecture, whole cluster.', { shape: 'cyl' }),
          N('ro', 504, 50, 160, 52, 'client', 'Read-only queries', 'hot_standby = on', 'Queries see a consistent snapshot of replayed data. If replay must remove rows a query still needs, the query may be cancelled (recovery conflict) — hot_standby_feedback trades this for bloat on the primary.')
        ],
        edges: [
          E('bk', 'wbuf', { vx: 116 }), E('wbuf', 'pgw', { vx: 116 }), E('pgw', 'ws', { l: 'read' }),
          E('ws', 'wr', { curve: -26, hl: true, l: 'WAL records (XLogData)', ly: -44 }),
          E('wr', 'ws', { curve: -26, dash: true, l: 'feedback: flush / replay LSN', ly: 44 }),
          E('wr', 'spgw'), E('spgw', 'startup', { vx: 804 }), E('startup', 'sdf', { vx: 804 }),
          E('ro', 'sdf', { dash: true, l: 'reads' }), E('slot', 'ws', { vx: 336, dash: true, l: 'restart_lsn' })
        ],
        over: '',
        extraNodes: null
      };
    }
  };
  /* add the synchronous_commit note node to streaming replication */
  (function () {
    var b = D['streaming-replication'].build;
    D['streaming-replication'].build = function () {
      var d = b();
      d.nodes.push(N('sync', 16, 332, 888, 54, 'note', 'synchronous_commit', 'off · local · remote_write · on (standby flushed) · remote_apply (standby replayed) — how long COMMIT waits', 'With synchronous_standby_names set, COMMIT waits for the chosen standbys according to synchronous_commit. remote_apply gives read-your-writes on the standby but costs the most latency.'));
      return d;
    };
  })();

  D['logical-replication'] = {
    title: 'Logical replication',
    desc: 'Row-level changes are decoded from WAL and sent per table: publication (what) → replication slot (where we are) → subscription (who receives). Works across major versions.',
    build: function () {
      return {
        w: 940, h: 360,
        groups: [G(16, 16, 440, 252, 'Publisher (source database)'), G(484, 16, 440, 252, 'Subscriber (target database)')],
        nodes: [
          N('tbl', 36, 50, 170, 56, 'proc', 'Tables', 'orders, customers', 'Ordinary tables. For UPDATE/DELETE to replicate they need a REPLICA IDENTITY (primary key by default).'),
          N('pub', 236, 46, 200, 64, 'accent', 'Publication', ['CREATE PUBLICATION pub', 'FOR TABLE orders;'], 'A publication is a named set of tables (optionally with row filters and column lists, PG 15+) whose changes are published.'),
          N('wal', 36, 150, 170, 70, 'disk', 'WAL', 'wal_level = logical', 'Logical decoding needs extra information in WAL, enabled by wal_level = logical (requires restart).', { shape: 'cyl' }),
          N('dec', 236, 134, 200, 50, 'proc', 'Logical decoding', 'pgoutput plugin', 'The walsender decodes WAL into logical row changes, reassembled per transaction, and the pgoutput plugin filters them by publication.'),
          N('slot', 236, 204, 200, 50, 'note', 'Replication slot', 'remembers confirmed LSN', 'A logical slot is created per subscription. It guarantees no change is lost while the subscriber is down — and retains WAL meanwhile. Monitor pg_replication_slots!'),
          N('sub', 504, 46, 200, 64, 'accent', 'Subscription', ['CREATE SUBSCRIPTION sub', 'CONNECTION … PUBLICATION pub'], 'Creating a subscription creates the remote slot, copies existing data, then streams changes.'),
          N('apply', 504, 150, 200, 54, 'proc', 'Apply worker', 'replays row changes', 'Applies INSERT/UPDATE/DELETE in commit order using normal SQL execution, so triggers (if ENABLE REPLICA/ALWAYS) and constraints fire. Conflicts (e.g. duplicate key) stop replication until fixed.'),
          N('sync', 504, 214, 200, 44, 'proc', 'Table sync worker', 'initial COPY', 'For each table, a sync worker copies the existing rows first, then catches up to the stream.'),
          N('stbl', 736, 140, 170, 74, 'mem', 'Tables', ['schema created first;', 'may have extra indexes'], 'Subscriber tables are normal, writable tables — you can add indexes or even different columns. Used for upgrades, consolidation and CDC.')
        ],
        edges: [
          E('tbl', 'wal', { vx: 121, l: 'DML' }), E('wal', 'dec'), E('pub', 'dec', { vx: 336, dash: true, l: 'filter' }),
          E('dec', 'slot', { vx: 336 }), E('slot', 'apply', { hl: true, l: 'changes', ly: 22 }),
          E('sub', 'apply', { vx: 604, dash: true }), E('apply', 'stbl'), E('sync', 'stbl', { dash: true })
        ],
        over: ''
      };
    }
  };
  (function () {
    var b = D['logical-replication'].build;
    D['logical-replication'].build = function () {
      var d = b();
      d.nodes.push(N('what', 16, 286, 908, 58, 'warn', 'What is (not) replicated', 'row changes + TRUNCATE — NOT DDL, sequences or large objects: create/alter tables on the subscriber yourself', 'Logical replication copies data, not schema. Run schema migrations on both sides (subscriber first for added columns). Sequence values must be synced separately before a cut-over.'));
      return d;
    };
  })();

  D['ha'] = {
    title: 'High availability with Patroni',
    desc: 'Patroni (third-party) runs next to every PostgreSQL node and uses etcd (third-party DCS) to elect one leader. HAProxy (third-party) asks Patroni’s REST API who the leader is and routes connections.',
    build: function () {
      var nodes = [
        N('cl', 350, 16, 200, 46, 'client', 'Applications', null, 'Apps connect to a stable HAProxy address instead of a specific database host, so failover needs no app config change.'),
        N('hap', 330, 92, 240, 58, 'ext', 'HAProxy (third-party)', ':5000 read-write · :5001 read-only', 'HAProxy health-checks each node’s Patroni REST API (GET /primary returns 200 only on the leader, /replica on healthy replicas) and routes accordingly.')
      ];
      var groups = [];
      ['node1', 'node2', 'node3'].forEach(function (nm, i) {
        var x = 16 + i * 300;
        groups.push(G(x, 186, 268, 156, nm, { id: 'g' + (i + 1) }));
        nodes.push(N('pt' + (i + 1), x + 14, 214, 240, 48, 'ext', 'Patroni agent (third-party)', 'REST API :8008', 'Patroni manages the local PostgreSQL: starts/stops it, renews the leader key in etcd (leader) or follows the leader (replica), and performs failover/switchover with pg_rewind when needed.'));
        nodes.push(N('pg' + (i + 1), x + 14, 274, 240, 54, i === 0 ? 'proc' : 'mem', i === 0 ? 'PostgreSQL — primary' : 'PostgreSQL — replica', i === 0 ? 'holds the leader key' : 'streaming from primary',
          i === 0 ? 'The current leader. If it stops renewing its leader key (TTL ~30 s), replicas race to acquire it and the most up-to-date healthy one is promoted.' :
            'A streaming replica managed by Patroni. With synchronous_mode Patroni only promotes a replica that is known to have all committed data.'));
      });
      groups.push(G(186, 368, 528, 90, 'etcd cluster — distributed configuration store (third-party)', { id: 'etcd', kind: 'ext' }));
      ['e1', 'e2', 'e3'].forEach(function (id, i) {
        nodes.push(N(id, 206 + i * 170, 396, 148, 46, 'ext', 'etcd ' + (i + 1), 'Raft member', 'etcd (or Consul / ZooKeeper) stores the cluster state and the leader lock. Three or five members give a Raft quorum that survives one (or two) failures and prevents split brain.'));
      });
      return {
        w: 900, h: 470, groups: groups, nodes: nodes,
        edges: [
          E('cl', 'hap', { vx: 450 }),
          E('hap', 'g1', { hl: true, l: 'RW → leader' }), E('hap', 'g2', { l: 'RO' }), E('hap', 'g3', { l: 'RO' }),
          E('pg1', 'pg2', { l: 'WAL' }),
          E('pg1', 'pg3', { pts: [[150, 354], [750, 354]], l: 'WAL stream', li: 1 }),
          E('g1', 'etcd', { dash: true }), E('g3', 'etcd', { dash: true })
        ]
      };
    }
  };

  D['pgbouncer'] = {
    title: 'Connection pooling with PgBouncer',
    desc: 'PgBouncer (third-party) accepts thousands of cheap client connections and multiplexes them onto a small pool of real PostgreSQL connections.',
    build: function () {
      var nodes = [], edges = [];
      for (var i = 0; i < 7; i++) {
        var last = i === 6;
        nodes.push(N('c' + i, 16, 24 + i * 48, 130, 38, 'client', last ? '… client 1,000' : 'client ' + (i + 1), null,
          'Each client holds a connection to PgBouncer, which costs only a few KB — not a whole PostgreSQL process. Most clients are idle most of the time.'));
        edges.push(E('c' + i, 'pgb'));
      }
      nodes.push(N('pgb', 300, 120, 210, 120, 'ext', 'PgBouncer (third-party)', ['pool_mode = transaction', 'default_pool_size = 20', 'max_client_conn = 1000'], 'A lightweight single-process pooler. In transaction mode a server connection is assigned only for the duration of a transaction, so 1,000 clients can share 20 connections.'));
      for (var j = 0; j < 3; j++) {
        nodes.push(N('s' + j, 580, 110 + j * 56, 130, 40, 'proc', 'server conn ' + (j + 1), null, 'A real PostgreSQL backend process, reused by many clients over time. Fewer backends = less memory, less contention, better throughput.'));
        edges.push(E('pgb', 's' + j));
        edges.push(E('s' + j, 'pg'));
      }
      nodes.push(N('pg', 760, 110, 110, 152, 'disk', 'PostgreSQL', ['max_connections', '= 100'], 'PostgreSQL itself stays at a modest max_connections; throughput usually peaks around a few × CPU cores of active connections.', { shape: 'cyl' }));
      nodes.push(N('modes', 300, 268, 210, 92, 'note', 'Pool modes', ['session — 1 server conn per client', 'transaction — per transaction', 'statement — per statement'], 'Transaction mode is the common choice, but session state does not survive between transactions: SET, advisory locks, LISTEN, temp tables and (before PgBouncer 1.21) protocol-level prepared statements need care.'));
      return {
        w: 890, h: 380, nodes: nodes, edges: edges,
        over: T(580, 96, '20 server connections', 'viz-s viz-cap', 'start') + T(16, 16, '1,000 client connections', 'viz-s viz-cap', 'start')
      };
    }
  };

  D['partitioning'] = {
    title: 'Declarative partitioning & pruning',
    desc: 'One logical table split into monthly partitions. A WHERE clause on the partition key lets the planner skip (prune) partitions that cannot contain matching rows.',
    build: function () {
      var months = ['2026_01', '2026_02', '2026_03', '2026_04', '2026_05', '2026_06'];
      var mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
      var nodes = [
        N('q', 16, 20, 320, 66, 'client', 'Query', ["WHERE order_date >= '2026-04-01'", "AND order_date <  '2026-06-01'"], 'Because the filter is on the partition key with constants, pruning happens at plan time. With parameters or join keys it can happen at execution time instead.'),
        N('parent', 420, 20, 330, 66, 'proc', 'orders (partitioned table)', 'PARTITION BY RANGE (order_date)', 'The parent holds no rows itself; it routes INSERTs to the right partition and is what queries reference. Indexes created on it cascade to all partitions.')
      ];
      var edges = [E('q', 'parent', { l: 'plan', hl: true })];
      months.forEach(function (m, i) {
        var hit = i === 3 || i === 4;
        nodes.push(N('p' + i, 16 + i * 124, 160, 112, 66, hit ? 'mem' : 'note', 'orders_' + m, [mn[i] + ' 2026', hit ? 'scanned' : 'pruned'],
          hit ? 'This partition’s range overlaps the WHERE clause, so it appears in the plan.' :
            'Its bounds (FOR VALUES FROM … TO …) cannot match, so it is pruned — never opened, never scanned. Old partitions can be detached and dropped instantly instead of a huge DELETE.', { cls: hit ? 'viz-on' : 'viz-dim' }));
        edges.push(E('parent', 'p' + i, hit ? { hl: true } : { dash: true, dim: true }));
      });
      nodes.push(N('pd', 16 + 6 * 124, 160, 112, 66, 'note', 'orders_default', ['DEFAULT', 'pruned'], 'Catches rows that fit no other partition. Keep it empty: adding a new partition must scan the default partition to check that no rows belong to the new range.', { cls: 'viz-dim' }));
      edges.push(E('parent', 'pd', { dash: true, dim: true }));
      nodes.push(N('res', 16, 266, 868, 62, 'success', 'Plan: Append → 2 partition scans  (Subplans Removed: 5 when pruned at run time)', 'enable_partition_pruning = on · keep partitions in the hundreds, not tens of thousands', 'EXPLAIN shows only the surviving partitions. Too many partitions increase planning time and lock overhead; monthly or daily granularity is typical for time series.'));
      return { w: 900, h: 344, nodes: nodes, edges: edges };
    }
  };

  D['sharding'] = {
    title: 'Hash sharding',
    desc: 'Rows are spread across independent PostgreSQL servers by hashing a shard key. Queries that include the key go to one shard; others must fan out to all shards.',
    build: function () {
      var nodes = [
        N('app', 350, 16, 200, 46, 'client', 'Application', null, 'The app sends queries to the router (or embeds the routing logic itself in a library).'),
        N('rt', 290, 94, 320, 70, 'proc', 'Router / coordinator', ['shard = hash(customer_id) % 4', 'single-shard or fan-out'], 'Computes the target shard from the shard key. WHERE customer_id = 42 → one shard. A query without the key (e.g. by email) must ask all shards and merge results.')
      ];
      var edges = [E('app', 'rt', { vx: 450 })];
      var keys = ['7, 19, 42 …', '3, 11, 28 …', '1, 15, 33 …', '5, 8, 60 …'];
      for (var i = 0; i < 4; i++) {
        nodes.push(N('s' + i, 16 + i * 222, 220, 200, 96, 'disk', 'Shard ' + i, ['hash % 4 = ' + i, 'customer_id ' + keys[i]], 'An independent PostgreSQL server (with its own replicas) holding about a quarter of the data. All rows of one customer live together, so joins on customer_id stay local.', { shape: 'cyl' }));
        edges.push(E('rt', 's' + i, i === 2 ? { hl: true, l: 'id 42' } : null));
      }
      nodes.push(N('warn', 16, 330, 868, 44, 'warn', 'Trade-offs', 'cross-shard joins/transactions are hard · resharding moves data · pick a high-cardinality, evenly spread key', 'Sharding adds operational complexity. Exhaust vertical scaling, read replicas, partitioning and caching first.'));
      return { w: 900, h: 390, nodes: nodes, edges: edges };
    }
  };

  D['citus'] = {
    title: 'Citus distributed PostgreSQL',
    desc: 'Citus (an open-source PostgreSQL extension) turns a coordinator plus worker nodes into one logical database: distributed tables are split into shards across workers; reference tables are copied to every worker.',
    build: function () {
      var nodes = [
        N('app', 360, 14, 200, 44, 'client', 'Application', 'normal SQL', 'Apps connect to the coordinator as if it were a single PostgreSQL server.'),
        N('co', 300, 86, 320, 76, 'proc', 'Coordinator', ['Citus (extension) metadata:', 'pg_dist_partition, pg_dist_shard'], 'The coordinator stores shard metadata, plans distributed queries, pushes fragments to workers in parallel and merges results. With Citus 11+ any node can also route queries.')
      ];
      var groups = [], edges = [E('app', 'co', { vx: 460 })];
      var sid = 102008;
      for (var w = 0; w < 3; w++) {
        var x = 16 + w * 302;
        groups.push(G(x, 196, 284, 214, 'Worker ' + (w + 1) + ' — PostgreSQL + Citus', { id: 'w' + w }));
        for (var k = 0; k < 2; k++) {
          nodes.push(N('s' + w + k, x + 14 + k * 132, 228, 124, 70, 'mem', 'orders_' + (sid++), ['distributed', 'shard'], 'A shard of the distributed table orders: a regular PostgreSQL table holding the rows whose hash(customer_id) falls into this shard’s range. Created by SELECT create_distributed_table(\'orders\', \'customer_id\').'));
        }
        nodes.push(N('ref' + w, x + 14, 316, 256, 76, 'accent', 'countries', ['reference table:', 'full copy on every worker'], 'Small lookup tables are replicated to every node with SELECT create_reference_table(\'countries\'), so joins with any shard stay local.'));
        edges.push(E('co', 'w' + w, { l: w === 1 ? 'parallel fragments' : null }));
      }
      return { w: 920, h: 424, nodes: nodes, groups: groups, edges: edges };
    }
  };

  D['vector-db'] = {
    title: 'PostgreSQL as a vector database',
    desc: 'An embedding model turns content into vectors; pgvector (extension) stores them in a vector column and an HNSW index finds the nearest neighbours of a query vector.',
    build: function () {
      return {
        w: 920, h: 340,
        nodes: [
          N('doc', 16, 30, 150, 64, 'client', 'Content', ['text, images,', 'product data'], 'Anything you want to search by meaning. Long documents are usually split into chunks first.'),
          N('emb', 206, 30, 170, 64, 'ext', 'Embedding model', ['external API or local', 'e.g. 768–1536 dims'], 'A neural network maps text to a fixed-length vector so that similar meanings are close together. Use the same model for documents and queries.'),
          N('vec', 416, 30, 200, 64, 'note', 'Vector', '[0.021, −0.334, …, 0.118]', 'Just an array of floats. pgvector’s vector type stores up to 16,000 dims (indexable up to 2,000; halfvec up to 4,000).'),
          N('col', 656, 22, 248, 80, 'disk', 'documents.embedding', ['vector(1536) column', 'pgvector (extension)'], 'CREATE EXTENSION vector; then a column of type vector(n) next to your normal columns — so you can filter, join and do transactions in the same database.', { shape: 'cyl' }),
          N('q', 16, 200, 150, 64, 'client', 'User query', '“tune autovacuum?”', 'At query time the user’s text is embedded with the same model.'),
          N('qemb', 206, 200, 170, 64, 'ext', 'Same model', 'query → vector', 'Mixing models (or versions) makes distances meaningless.'),
          N('sql', 416, 196, 200, 72, 'accent', 'kNN SQL', ['ORDER BY embedding <=> $1', 'LIMIT 5'], 'Operators: <-> L2 distance, <=> cosine distance, <#> negative inner product. ORDER BY … LIMIT k is what lets the planner use a vector index.'),
          N('hnsw', 656, 196, 248, 72, 'proc', 'HNSW index', ['multi-layer neighbour graph', 'approximate top-k in ms'], 'CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops); Tunables: m, ef_construction (build) and hnsw.ef_search (query recall vs speed). IVFFlat is the alternative (lists/probes).'),
          N('res', 656, 290, 248, 40, 'success', 'Top-k nearest rows', null, 'Approximate: an ANN index may miss a true neighbour. Measure recall against an exact (sequential) search.')
        ],
        edges: [
          E('doc', 'emb'), E('emb', 'vec'), E('vec', 'col'),
          E('q', 'qemb'), E('qemb', 'sql'), E('sql', 'hnsw', { hl: true }),
          E('col', 'hnsw', { vx: 780, dash: true, l: 'CREATE INDEX … USING hnsw' }), E('hnsw', 'res', { vx: 780 })
        ]
      };
    }
  };

  D['rag'] = {
    title: 'Retrieval-Augmented Generation (RAG)',
    desc: 'The question is embedded, PostgreSQL + pgvector retrieves the most similar chunks, and the LLM answers using that retrieved context.',
    build: function () {
      return {
        w: 940, h: 370,
        groups: [G(16, 282, 908, 76, 'Offline ingestion', { kind: 'ext' })],
        nodes: [
          N('user', 16, 40, 120, 56, 'client', 'User', 'asks a question', 'Example: “How do I find slow queries?”'),
          N('app', 166, 40, 130, 56, 'proc', 'App / API', 'orchestrates', 'Your backend coordinates the steps (directly or with a framework). It also applies permissions — e.g. only retrieve chunks this user may see (RLS works great here).'),
          N('emb', 326, 40, 150, 56, 'ext', 'Embedding model', 'question → vector', 'The same embedding model used at ingestion time.'),
          N('pg', 506, 32, 190, 72, 'disk', 'PostgreSQL + pgvector', 'chunks + embeddings', 'Stores chunk text, metadata and embeddings together. You can combine vector similarity with SQL filters and full-text search (hybrid search).', { shape: 'cyl' }),
          N('sim', 726, 40, 198, 56, 'accent', 'Similarity search', 'top-k chunks (<=>)', 'SELECT content FROM chunks ORDER BY embedding <=> $1 LIMIT 5; — optionally re-ranked.'),
          N('llm', 726, 176, 198, 64, 'ext', 'LLM', ['prompt = question', '+ retrieved chunks'], 'The model is instructed to answer from the provided context and cite it, which reduces hallucination and keeps answers current without retraining.'),
          N('ans', 446, 176, 170, 64, 'success', 'Answer', 'grounded, with sources', 'Returned to the user, ideally with links to the source chunks.'),
          N('d1', 150, 310, 150, 36, 'note', 'Documents', null, 'Docs, tickets, wiki pages, PDFs…'),
          N('d2', 340, 310, 150, 36, 'note', 'Chunk', null, 'Split into overlapping chunks of a few hundred tokens so each embedding captures one idea.'),
          N('d3', 530, 310, 150, 36, 'note', 'Embed chunks', null, 'Batch-embed every chunk; re-embed when content or model changes.'),
          N('d4', 720, 310, 190, 36, 'note', 'INSERT INTO chunks', null, 'Store text + metadata + embedding, then build an HNSW index.')
        ],
        edges: [
          E('user', 'app', { l: '1' }), E('app', 'emb', { l: '2' }), E('emb', 'pg', { l: '3' }), E('pg', 'sim', { l: '4', hl: true }),
          E('sim', 'llm', { vx: 825, l: '5 context' }), E('llm', 'ans', { l: '6' }),
          E('ans', 'user', { pts: [[76, 208]], l: '7 answer', li: 0 }),
          E('d1', 'd2'), E('d2', 'd3'), E('d3', 'd4'),
          E('d4', 'pg', { dash: true, pts: [[711, 296], [711, 130]], li: 1 })
        ]
      };
    }
  };

  D['multi-tenant'] = {
    title: 'Multi-tenant designs',
    desc: 'Three ways to isolate SaaS customers: a database per tenant, a schema per tenant, or shared tables with a tenant_id column enforced by Row-Level Security.',
    build: function () {
      var tableDraw = function (n) {
        var rows = [[1, 101, '50.00'], [2, 102, '75.00'], [1, 103, '20.00'], [3, 104, '90.00'], [2, 105, '15.00']];
        var s = '<rect class="viz-box" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8"/>' +
          T(n.x + n.w / 2, n.y + 20, 'app.orders (shared)', 'viz-t');
        var y0 = n.y + 34;
        s += T(n.x + 20, y0 + 12, 'tenant_id', 'viz-s viz-mono', 'start') + T(n.x + 120, y0 + 12, 'id', 'viz-s viz-mono', 'start') + T(n.x + 180, y0 + 12, 'total', 'viz-s viz-mono', 'start');
        rows.forEach(function (r, i) {
          var y = y0 + 20 + i * 22;
          s += '<rect class="viz-tenant viz-tenant-' + r[0] + '" x="' + (n.x + 12) + '" y="' + y + '" width="' + (n.w - 24) + '" height="18" rx="3"/>' +
            T(n.x + 20, y + 13, String(r[0]), 'viz-s viz-mono', 'start') + T(n.x + 120, y + 13, String(r[1]), 'viz-s viz-mono', 'start') + T(n.x + 180, y + 13, r[2], 'viz-s viz-mono', 'start');
        });
        return s;
      };
      return {
        w: 920, h: 372,
        groups: [G(16, 16, 288, 340, 'Database per tenant'), G(316, 16, 288, 340, 'Schema per tenant'), G(616, 16, 288, 340, 'Shared tables + RLS'), G(330, 46, 260, 242, 'app_db (one database)', { kind: 'disk' })],
        nodes: [
          N('d1', 36, 52, 248, 66, 'disk', 'acme_db', 'tenant: Acme', 'Each tenant gets its own database (possibly its own server). Easiest per-tenant backup/restore, noisy neighbours can be moved — but every DB needs its own connections/pool, migrations run N times.', { shape: 'cyl' }),
          N('d2', 36, 132, 248, 66, 'disk', 'globex_db', 'tenant: Globex', 'Connections cannot cross databases in PostgreSQL, so cross-tenant analytics need an extra pipeline (FDW, ETL).', { shape: 'cyl' }),
          N('d3', 36, 212, 248, 66, 'disk', 'initech_db', 'tenant: Initech', 'Works well for tens–hundreds of large tenants; poorly for 100k small ones.', { shape: 'cyl' }),
          N('s1', 346, 78, 228, 56, 'mem', 'schema acme', 'acme.orders, acme.users', 'Same table names in each schema; the app sets search_path = acme. Per-tenant pg_dump -n is easy.'),
          N('s2', 346, 146, 228, 56, 'mem', 'schema globex', 'globex.orders, globex.users', 'One database, one connection pool. Migrations still run once per schema.'),
          N('s3', 346, 214, 228, 56, 'mem', 'schema initech', 'initech.orders, …', 'Thousands of schemas × dozens of tables = huge catalogs, slower pg_dump and planning, and large per-backend caches.'),
          N('tbl', 636, 46, 248, 170, 'note', 'app.orders (shared)', 'rows tagged with tenant_id', 'All tenants share one set of tables. Cheapest and simplest to scale (and to shard by tenant_id with Citus), but one missing WHERE clause leaks data — unless RLS enforces it.', { draw: tableDraw }),
          N('pol', 636, 226, 248, 62, 'accent', 'RLS policy', ['USING (tenant_id =', "current_setting('app.tenant_id')::int)"], 'ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON app.orders USING (…). The app sets app.tenant_id per transaction (SET LOCAL). Table owners and BYPASSRLS roles skip policies unless FORCE ROW LEVEL SECURITY.'),
          N('x1', 36, 300, 248, 46, 'success', 'Strongest isolation', 'most overhead per tenant', 'Pick for strict compliance or very large tenants.'),
          N('x2', 336, 300, 248, 46, 'warn', 'Good isolation', 'catalog bloat at thousands', 'Pick for a moderate number of mid-sized tenants.'),
          N('x3', 636, 300, 248, 46, 'accent', 'Cheapest at scale', 'needs RLS discipline + tenant_id in every index', 'Pick for many small tenants (typical B2B SaaS). Put tenant_id first in composite indexes.')
        ],
        edges: [E('pol', 'tbl', { vx: 760 })]
      };
    }
  };

  D['prod-cluster'] = {
    title: 'Production PostgreSQL architecture',
    desc: 'A typical highly-available setup: pooled app connections, HAProxy routing to a Patroni-managed primary with a synchronous and an asynchronous replica, a DR standby cluster in another region, pgBackRest backups to object storage, and monitoring.',
    build: function () {
      return {
        w: 960, h: 560,
        groups: [G(16, 16, 640, 528, 'Region A (primary site)'), G(676, 16, 268, 330, 'Region B (disaster recovery)')],
        nodes: [
          N('a1', 36, 50, 180, 44, 'client', 'App server 1', null, 'Stateless application instances behind a load balancer.'),
          N('a2', 236, 50, 180, 44, 'client', 'App server 2', null, 'Stateless application instances behind a load balancer.'),
          N('a3', 436, 50, 180, 44, 'client', 'App server 3', null, 'Stateless application instances behind a load balancer.'),
          N('pgb', 136, 124, 380, 50, 'ext', 'PgBouncer (third-party)', 'transaction pooling — thousands of clients → tens of server conns', 'Pools connections so the database sees a small, steady number of backends. Often run on each app host or as a small HA pair.'),
          N('hap', 136, 200, 380, 50, 'ext', 'HAProxy (third-party)', 'RW → current leader · RO → replicas (Patroni health checks)', 'Routes to whichever node Patroni reports as leader; failover is transparent apart from dropped in-flight transactions.'),
          N('pri', 36, 290, 180, 64, 'proc', 'Primary', 'Patroni-managed', 'Accepts all writes. synchronous_commit waits for the sync replica, giving RPO = 0 within the region.'),
          N('syn', 236, 290, 180, 64, 'mem', 'Sync replica', 'synchronous_standby_names', 'Failover target with zero data loss. Patroni synchronous_mode ensures only an up-to-date replica can be promoted.'),
          N('asy', 436, 290, 180, 64, 'mem', 'Async replica', 'reporting / read scaling', 'Serves read-only and reporting traffic without slowing commits.'),
          N('etcd', 36, 396, 180, 50, 'ext', 'etcd ×3 (third-party)', 'leader election (DCS)', 'Distributed configuration store used by Patroni for the leader lock. Run 3 members on separate hosts/zones.'),
          N('br', 236, 396, 180, 50, 'ext', 'pgBackRest (third-party)', 'full/diff/incr + WAL archive', 'Takes parallel, compressed, encrypted backups (often from a replica) and archives WAL continuously (archive_command = pgbackrest archive-push). Enables point-in-time recovery.'),
          N('mon', 436, 396, 180, 64, 'ext', 'Monitoring', ['postgres_exporter →', 'Prometheus → Grafana'], 'Track replication lag, connections, TPS, cache hit ratio, long transactions, bloat, disk/WAL growth, checkpoints and slow queries (pg_stat_statements). Alert before disks fill.'),
          N('dr', 696, 170, 228, 70, 'proc', 'DR standby cluster', ['async streaming, cross-region', 'Patroni standby_cluster'], 'A cascading standby (cluster) in another region; promote it if region A is lost. RPO = replication lag, RTO = minutes.'),
          N('s3', 680, 372, 264, 92, 'disk', 'Object storage (S3/GCS/Azure)', ['backups + WAL archive', 'versioned, cross-region, encrypted'], 'Backup repository off the database hosts. Test restores regularly — an untested backup is not a backup.', { shape: 'cyl' })
        ],
        edges: [
          E('a1', 'pgb'), E('a2', 'pgb', { vx: 326 }), E('a3', 'pgb'), E('pgb', 'hap', { vx: 326 }),
          E('hap', 'pri', { hl: true, l: 'RW' }), E('hap', 'asy', { l: 'RO' }),
          E('pri', 'syn', { hl: true }),
          E('pri', 'asy', { pts: [[180, 374], [526, 374]], l: 'async WAL', li: 1 }),
          E('pri', 'etcd', { vx: 70, dash: true, bi: true }),
          E('pri', 'dr', { pts: [[26, 322], [26, 109], [664, 109], [664, 205]], l: 'cross-region WAL', li: 3, ly: -14, dash: true }),
          E('br', 's3', { pts: [[326, 500], [812, 500]], l: 'backups + WAL', li: 1 }),
          E('s3', 'dr', { vx: 812, dash: true, l: 'restore_command' })
        ]
      };
    }
  };

  D['backup-pitr'] = {
    title: 'Backup & point-in-time recovery',
    desc: 'A base backup plus the continuous WAL archive lets you replay history up to any moment — e.g. one second before an accidental DROP TABLE — and continue on a new timeline.',
    build: function () {
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
      var axis = '';
      days.forEach(function (d, i) { var x = 40 + i * 172; axis += '<line class="viz-axis" x1="' + x + '" y1="132" x2="' + x + '" y2="140"/>' + T(x + 4, 152, d, 'viz-s', 'start'); });
      var bar = function (n) {
        var s = '<rect class="viz-box" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="5"/>';
        for (var x = n.x + 28; x < n.x + n.w; x += 28) s += '<line class="viz-seg" x1="' + x + '" y1="' + (n.y + 3) + '" x2="' + x + '" y2="' + (n.y + n.h - 3) + '"/>';
        return s + '<text class="viz-s viz-onbar" x="' + (n.x + n.w / 2) + '" y="' + (n.y + 16) + '">continuous WAL archive — every 16 MB segment (archive_command / pgbackrest archive-push)</text>';
      };
      return {
        w: 940, h: 392,
        groups: [G(16, 240, 908, 136, 'Restore procedure')],
        under: axis +
          '<line class="viz-marker" x1="54" y1="92" x2="54" y2="108"/>' +
          '<line class="viz-marker viz-marker-bad" x1="664" y1="92" x2="664" y2="108"/>' +
          '<path class="viz-edge viz-e-hl viz-e-dash" d="M658,132 C700,175 780,190 900,196"/>' + T(900, 214, 'timeline 2 (after promote)', 'viz-s', 'end'),
        nodes: [
          N('base', 16, 40, 200, 52, 'proc', 'Base backup', 'Sun 02:00 · pg_basebackup / pgBackRest', 'A consistent physical copy of the data directory, taken online. Weekly full + daily differential/incremental backups are common (PG 17 adds incremental pg_basebackup).'),
          N('walbar', 40, 108, 860, 24, 'mem', 'WAL archive', null, 'Every completed WAL segment is archived. Without an unbroken WAL chain from the base backup to the target time, PITR is impossible — monitor archiving failures (pg_stat_archiver).', { draw: bar }),
          N('inc', 580, 40, 180, 52, 'danger', 'Oops: DROP TABLE', 'Wed 14:32:10', 'Human error is the most common reason for PITR. Replicas don’t help — they replay the DROP within milliseconds.'),
          N('tgt', 430, 162, 200, 52, 'accent', 'recovery_target_time', "'Wed 14:32:00'", 'Recovery stops just before this time (recovery_target_inclusive). Alternatives: recovery_target_xid, _lsn or a named restore point (pg_create_restore_point).'),
          N('r1', 30, 278, 200, 70, 'proc', '1. Restore base backup', 'into an empty data directory', 'pgbackrest restore --type=time "--target=…" does steps 1–2 for you. Restore to a separate server first, then copy the missing table back if you only need one table.'),
          N('r2', 256, 278, 200, 70, 'proc', '2. Configure target', ['recovery.signal +', 'restore_command, target'], 'Since PG 12 there is no recovery.conf: set the parameters in postgresql.conf and create recovery.signal.'),
          N('r3', 482, 278, 200, 70, 'proc', '3. Replay WAL', 'segments fetched from the archive', 'The startup process fetches each segment via restore_command and replays it until the target is reached, then pauses or promotes (recovery_target_action).'),
          N('r4', 708, 278, 200, 70, 'success', '4. Promote', 'new timeline 2 begins', 'After promotion the server starts timeline 2 (a .history file records the fork) so its WAL never collides with the original timeline’s WAL.')
        ],
        edges: [
          E('r1', 'r2'), E('r2', 'r3'), E('r3', 'r4'),
          E('tgt', 'r2', { dash: true }),
          E('base', 'r1', { dash: true, pts: [[24, 120], [24, 300]], l: 'copy', li: 1 })
        ]
      };
    }
  };

  D['normalization'] = {
    title: 'Normalization: UNF → 1NF → 2NF → 3NF',
    desc: 'Each normal form removes one kind of redundancy: repeating groups, partial dependencies on part of a composite key, and transitive dependencies between non-key columns.',
    build: function () {
      var stages = [
        ['unf', 'Unnormalized', 'danger', ['order | customer   | items', '1     | Asha, Pune | pen×2, ink×1', '2     | Ben, Goa   | pad×5'], 'repeating group in one cell', 'Lists inside a cell can’t be indexed, constrained or summed reliably. "Find all orders with ink" needs string parsing.'],
        ['nf1', '1NF', 'warn', ['order|item|qty|cust|city', '1    |pen |2  |Asha|Pune', '1    |ink |1  |Asha|Pune', '2    |pad |5  |Ben |Goa'], 'atomic values · key (order, item)', 'First normal form: one value per cell, no repeating groups, each row identified by a key — here the composite (order, item). Customer data now repeats on every item row.'],
        ['nf2', '2NF', 'accent', ['order_items(order, item, qty)', '  1 | pen | 2', '  1 | ink | 1', 'orders(order, cust, city)', '  1 | Asha | Pune'], 'no partial dependency', 'Second normal form: every non-key column depends on the whole key. cust and city depended only on order (part of the key), so they move to orders.'],
        ['nf3', '3NF', 'success', ['order_items(order_id, item, qty)', 'orders(order_id, customer_id)', 'customers(id, name, city)', '  7 | Asha | Pune'], 'no transitive dependency', 'Third normal form: non-key columns depend only on the key. city depends on the customer, not on the order (order → customer → city), so customers becomes its own table. Update Asha’s city once.']
      ];
      var nodes = stages.map(function (s, i) {
        var x = 16 + i * 238;
        return N(s[0], x, 24, 220, 200, s[2], s[1], s[4], s[5], {
          draw: function (n) {
            var out = '<rect class="viz-box" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="10"/>' +
              T(n.x + n.w / 2, n.y + 26, s[1], 'viz-t viz-big');
            out += '<rect class="viz-cell" x="' + (n.x + 10) + '" y="' + (n.y + 42) + '" width="' + (n.w - 20) + '" height="' + (s[3].length * 18 + 14) + '" rx="6"/>';
            s[3].forEach(function (line, j) {
              out += '<text class="viz-s viz-mono viz-left" x="' + (n.x + 18) + '" y="' + (n.y + 62 + j * 18) + '" style="font-size:' + fitSize(line, n.w - 34, 10.5, 0.64) + 'px">' + esc(line) + '</text>';
            });
            out += T(n.x + n.w / 2, n.y + n.h - 20, s[4], 'viz-s');
            return out;
          }
        });
      });
      return {
        w: 960, h: 240, nodes: nodes,
        edges: [E('unf', 'nf1', { hl: true }), E('nf1', 'nf2', { hl: true }), E('nf2', 'nf3', { hl: true })]
      };
    }
  };

  /* Public metadata + cache of built definitions */
  var DIAGRAMS = {};
  Object.keys(D).forEach(function (k) { DIAGRAMS[k] = { title: D[k].title, desc: D[k].desc }; });
  var BUILT = {};
  function getDef(key) {
    if (!BUILT[key]) BUILT[key] = D[key].build();
    return BUILT[key];
  }

  function diagram(key) {
    var meta = D[key];
    if (!meta) {
      return '<figure class="viz-figure viz-missing"><p class="viz-muted">Diagram “' + esc(key) + '” is not available.</p></figure>';
    }
    var def = getDef(key);
    var id = uid('vzx');
    return '<figure class="viz-figure" data-viz-diagram="' + esc(key) + '">' +
      '<div class="viz-figure-head"><span class="viz-badge">Diagram</span><strong class="viz-figure-title">' + esc(meta.title) + '</strong></div>' +
      '<div class="viz-svg-wrap">' + renderSvg(def, meta.title) + '</div>' +
      '<div class="viz-explain" id="' + id + '" aria-live="polite"><span class="viz-explain-hint">Click (or Tab + Enter) any box to see what it does.</span></div>' +
      '<figcaption class="viz-caption">' + esc(meta.desc) + '</figcaption></figure>';
  }

  /* Global delegation for diagram node clicks — works for any diagram HTML
     inserted anywhere, without explicit binding. */
  function showNodeInfo(g) {
    var fig = g.closest('[data-viz-diagram]');
    if (!fig) return;
    var key = fig.getAttribute('data-viz-diagram'), def = D[key] && getDef(key);
    if (!def) return;
    var id = g.getAttribute('data-node'), n = null;
    for (var i = 0; i < def.nodes.length; i++) if (def.nodes[i].id === id) { n = def.nodes[i]; break; }
    if (!n) return;
    $$(fig, '.viz-node.viz-sel').forEach(function (x) { x.classList.remove('viz-sel'); });
    g.classList.add('viz-sel');
    var panel = $(fig, '.viz-explain');
    if (panel) {
      panel.innerHTML = '<div class="viz-explain-body viz-k-' + esc(n.kind || 'proc') + '"><strong>' + esc(String(n.label).replace(/\n/g, ' ')) + '</strong>' +
        (n.sub ? ' <span class="viz-muted">— ' + esc([].concat(n.sub).join(' · ')) + '</span>' : '') +
        '<p>' + esc(n.info || '') + '</p></div>';
      panel.classList.remove('viz-flash'); void panel.offsetWidth; panel.classList.add('viz-flash');
    }
  }
  var delegated = false;
  function installDelegation() {
    if (delegated || typeof document === 'undefined') return;
    delegated = true;
    document.addEventListener('click', function (ev) {
      var g = ev.target.closest && ev.target.closest('[data-viz-diagram] .viz-node');
      if (g) showNodeInfo(g);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var g = ev.target.closest && ev.target.closest('[data-viz-diagram] .viz-node');
      if (g) { ev.preventDefault(); showNodeInfo(g); }
    });
  }

  /* ==================================================================
     LABS
     ================================================================== */
  var LAB_META = {
    btree: { title: 'B-tree search, step by step', desc: 'Type a key and watch PostgreSQL descend from the root page to a leaf, then fetch the row from the heap. Compare pages read with a sequential scan.' },
    plan: { title: 'EXPLAIN ANALYZE visualizer', desc: 'Explore real-looking execution plans as a tree. Spot row misestimates, expensive nodes, loops and buffer reads — or paste your own EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) output.' },
    index: { title: 'Index type explorer', desc: 'Compare PostgreSQL’s index access methods side by side, then let the wizard recommend one for your workload.' },
    txn: { title: 'Transaction & locking lab', desc: 'Drive two concurrent sessions against a tiny accounts table. Watch row locks block, deadlocks get detected, and isolation levels change what each session sees.' },
    mvcc: { title: 'MVCC tuple-version lab', desc: 'Run INSERT / UPDATE / DELETE in two transactions and watch tuple versions with xmin, xmax and ctid. See which versions each snapshot can see — and what VACUUM is allowed to remove.' },
    shard: { title: 'Sharding lab', desc: 'Distribute 2,000 generated rows over shards with different keys and strategies. Measure skew, find hot shards, then add a shard and see how much data has to move.' },
    vector: { title: 'Vector search lab', desc: 'Forty documents embedded in 2-D. Search by text or click the plot, switch distance metrics, and see how HNSW and IVFFlat approximate nearest-neighbour search.' },
    security: { title: 'Roles, privileges & RLS lab', desc: 'Toggle GRANTs, schema USAGE and Row-Level Security, then see exactly what each role can do and which rows it sees — with the SQL to reproduce it. Includes a pg_hba.conf line explainer.' },
    join: { title: 'Join visualizer', desc: 'Pick a join type and see which customer and order rows match, which are kept with NULLs, and the resulting rows.' },
    partition: { title: 'Partition pruning lab', desc: 'A monthly-partitioned orders table. Choose a date filter to see which partitions are scanned or pruned, then manage the partition lifecycle.' }
  };

  /* ------------------------------------------------------------------
     LAB: btree — animated B-tree descent
     ------------------------------------------------------------------ */
  function labBtree(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-btree');
    /* Build a deterministic 3-level tree: 48 keys, 12 leaves × 4 keys,
       4 branch pages × 3 leaves, 1 root with 4 children. */
    var r = rng(7), keys = [], v = 1;
    for (var i = 0; i < 48; i++) { v += 1 + Math.floor(r() * 4); keys.push(v); }
    var leaves = [];
    for (i = 0; i < 12; i++) leaves.push(keys.slice(i * 4, i * 4 + 4));
    var branches = [];
    for (i = 0; i < 4; i++) {
      var ls = [i * 3, i * 3 + 1, i * 3 + 2];
      branches.push({ leaves: ls, seps: [leaves[ls[1]][0], leaves[ls[2]][0]] });
    }
    var rootSeps = [leaves[3][0], leaves[6][0], leaves[9][0]];
    /* heap: 12 pages × 4 rows, rows placed in shuffled (insertion) order */
    var order = keys.slice();
    for (i = order.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    var tid = {};
    order.forEach(function (k, idx) { tid[k] = [Math.floor(idx / 4), (idx % 4) + 1]; });

    var W = 900;
    var leafX = function (li) { return 12 + li * 74; };
    var brX = function (bi) { return leafX(bi * 3) + (3 * 74 - 8) / 2 - 95; };

    var state = { steps: [], at: -1, timer: null, reads: 0, target: null };

    root.innerHTML = labHead('btree') +
      '<div class="viz-controls">' +
      '<label class="viz-field"><span>Search key</span><input type="number" class="viz-input" data-in="key" value="' + keys[29] + '" min="0" max="999" aria-label="Key to search"></label>' +
      btn('search', 'Search (animate)', { cls: 'viz-btn-primary' }) + btn('step', 'Step ▸') + btn('reset', 'Reset') +
      btn('random', 'Random existing key') +
      '</div>' +
      '<div class="viz-stats" data-out="stats"></div>' +
      '<div class="viz-svg-wrap">' + '<svg class="viz-svg" viewBox="0 0 ' + W + ' 400" role="group" aria-label="B-tree with root, branch and leaf pages and heap pages" data-out="svg"></svg></div>' +
      '<div class="viz-grid2"><ol class="viz-steps" data-out="log" aria-live="polite"></ol><div class="viz-explain" data-out="info"><span class="viz-explain-hint">Click any page in the tree for details.</span></div></div>' +
      '<p class="viz-note">Keys stored: ' + keys[0] + ' … ' + keys[47] + ' (48 rows). Real B-tree pages hold hundreds of keys, so even 1 billion rows need only ~4 levels.</p>';

    var svg = $(root, '[data-out=svg]');

    function draw() {
      var path = {};
      for (var s = 0; s <= state.at && s < state.steps.length; s++) path[state.steps[s].node] = true;
      var cur = state.at >= 0 && state.steps[state.at] ? state.steps[state.at].node : null;
      var mk = uid('vzm');
      var out = markerDefs(mk);
      function cls(id) { return (path[id] ? ' viz-on' : '') + (cur === id ? ' viz-cur' : ''); }
      function edge(x1, y1, x2, y2, on) {
        return '<path class="viz-edge' + (on ? ' viz-e-hl' : ' viz-e-thin') + '" d="M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2 + '" marker-end="url(#' + (on ? mk + '-h' : mk) + ')"/>';
      }
      /* edges */
      branches.forEach(function (b, bi) {
        var bx = brX(bi) + 95;
        out += edge(450, 58, bx, 110, path['r'] && path['b' + bi]);
        b.leaves.forEach(function (li) {
          out += edge(bx, 152, leafX(li) + 33, 212, path['b' + bi] && path['l' + li]);
        });
      });
      for (var li = 0; li < 11; li++) {
        out += '<path class="viz-edge viz-e-dash viz-e-thin" d="M' + (leafX(li) + 66) + ',' + 238 + ' L' + (leafX(li + 1)) + ',' + 238 + '"/>';
      }
      var hp = state.target != null && tid[state.target] ? tid[state.target][0] : null;
      if (path['h' + hp] && state.lastLeaf != null) {
        out += edge(leafX(state.lastLeaf) + 33, 266, leafX(hp) + 33, 322, true);
      }
      /* root */
      out += '<g class="viz-node viz-k-accent' + cls('r') + '" data-node="r" tabindex="0" role="button" aria-label="Root page, separators ' + rootSeps.join(', ') + '">' +
        '<rect class="viz-box" x="350" y="14" width="200" height="44" rx="8"/>' +
        '<text class="viz-t" x="450" y="33">Root page</text><text class="viz-s viz-mono" x="450" y="50">' + rootSeps.join(' | ') + '</text></g>';
      branches.forEach(function (b, bi) {
        var x = brX(bi);
        out += '<g class="viz-node viz-k-proc' + cls('b' + bi) + '" data-node="b' + bi + '" tabindex="0" role="button" aria-label="Branch page ' + (bi + 1) + ', separators ' + b.seps.join(', ') + '">' +
          '<rect class="viz-box" x="' + x + '" y="110" width="190" height="42" rx="8"/>' +
          '<text class="viz-t" x="' + (x + 95) + '" y="128">Branch ' + (bi + 1) + '</text><text class="viz-s viz-mono" x="' + (x + 95) + '" y="144">' + b.seps.join(' | ') + '</text></g>';
      });
      leaves.forEach(function (lk, li2) {
        var x = leafX(li2);
        var keyTxt = '';
        lk.forEach(function (k, ki) {
          var hit = state.target === k && path['l' + li2];
          keyTxt += '<text class="viz-s viz-mono' + (hit ? ' viz-hit' : '') + '" x="' + (x + 18 + (ki % 2) * 32) + '" y="' + (232 + Math.floor(ki / 2) * 16) + '">' + k + '</text>';
        });
        out += '<g class="viz-node viz-k-mem' + cls('l' + li2) + '" data-node="l' + li2 + '" tabindex="0" role="button" aria-label="Leaf page ' + (li2 + 1) + ', keys ' + lk.join(', ') + '">' +
          '<rect class="viz-box" x="' + x + '" y="212" width="66" height="54" rx="7"/>' + keyTxt + '</g>';
      });
      for (var p = 0; p < 12; p++) {
        var x2 = leafX(p);
        out += '<g class="viz-node viz-k-disk' + cls('h' + p) + '" data-node="h' + p + '" tabindex="0" role="button" aria-label="Heap page ' + p + '">' +
          '<rect class="viz-box" x="' + x2 + '" y="322" width="66" height="44" rx="6"/>' +
          '<text class="viz-s" x="' + (x2 + 33) + '" y="340">heap</text><text class="viz-t viz-mono" x="' + (x2 + 33) + '" y="357" style="font-size:12px">page ' + p + '</text></g>';
      }
      out += T(450, 392, 'Index pages: root → branch → leaf (leaves are linked left ↔ right).  Heap: table pages in insertion order.', 'viz-s viz-cap', 'middle');
      svg.innerHTML = out;
    }

    function plan(k) {
      var steps = [];
      var c = 0; while (c < 3 && k >= rootSeps[c]) c++;
      var cmpR = rootSeps.map(function (s) { return k + (k >= s ? ' ≥ ' : ' < ') + s; }).join(', ');
      steps.push({ node: 'r', msg: 'Read root page. Compare: ' + cmpR + ' → follow child pointer #' + (c + 1) + '.' });
      var b = branches[c], lc = 0; while (lc < 2 && k >= b.seps[lc]) lc++;
      var cmpB = b.seps.map(function (s) { return k + (k >= s ? ' ≥ ' : ' < ') + s; }).join(', ');
      steps.push({ node: 'b' + c, msg: 'Read branch page ' + (c + 1) + ' [' + b.seps.join(' | ') + ']. ' + cmpB + ' → child #' + (lc + 1) + '.' });
      var li = b.leaves[lc], leaf = leaves[li];
      var found = leaf.indexOf(k) >= 0;
      steps.push({ node: 'l' + li, leaf: li, msg: 'Read leaf page [' + leaf.join(', ') + ']. Binary search for ' + k + ' → ' + (found ? 'found, TID = (' + tid[k].join(',') + ').' : 'not present. Stop: no heap access needed.') });
      if (found) steps.push({ node: 'h' + tid[k][0], msg: 'Fetch heap page ' + tid[k][0] + ', line pointer ' + tid[k][1] + ' → row id = ' + k + ' (and check MVCC visibility).' });
      return steps;
    }

    function renderStats() {
      var done = state.at >= state.steps.length - 1 && state.steps.length;
      $(root, '[data-out=stats]').innerHTML =
        '<div class="viz-stat"><span>Pages read (index scan)</span><strong>' + state.reads + '</strong></div>' +
        '<div class="viz-stat"><span>Pages read (seq scan)</span><strong>12</strong><small>every heap page, all 48 rows compared</small></div>' +
        '<div class="viz-stat"><span>At 10 M rows</span><strong>~4 vs ~54,000</strong><small>index levels + heap vs all pages</small></div>' +
        (done ? '<div class="viz-stat viz-stat-ok"><span>Result</span><strong>' + (state.found ? 'found' : 'no match') + '</strong></div>' : '');
    }
    function renderLog() {
      var html = '';
      for (var s = 0; s <= state.at && s < state.steps.length; s++) {
        html += '<li' + (s === state.at ? ' class="viz-cur"' : '') + '><strong>Page read ' + (s + 1) + ':</strong> ' + esc(state.steps[s].msg) + '</li>';
      }
      $(root, '[data-out=log]').innerHTML = html || '<li class="viz-muted">Press Search or Step to start.</li>';
    }
    function start() {
      stopTimer();
      var k = parseInt($(root, '[data-in=key]').value, 10);
      if (isNaN(k)) k = keys[0];
      state.target = k; state.steps = plan(k); state.at = -1; state.reads = 0; state.lastLeaf = null;
      state.found = keys.indexOf(k) >= 0;
    }
    function step() {
      if (!state.steps.length || state.at >= state.steps.length - 1) start();
      state.at++;
      var s = state.steps[state.at];
      if (s.leaf != null) state.lastLeaf = s.leaf;
      state.reads = state.at + 1;
      draw(); renderLog(); renderStats();
    }
    function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }
    function animate() {
      start(); draw(); renderLog(); renderStats();
      var delay = reducedMotion() ? 120 : 850;
      state.timer = setInterval(function () {
        if (!root.isConnected) return stopTimer();
        if (state.at >= state.steps.length - 1) return stopTimer();
        step();
      }, delay);
      step();
    }
    function info(id) {
      var html;
      if (id === 'r') html = '<strong>Root page</strong><p>Entry point of every search (its location is stored in the index metapage, block 0). Separator keys ' + rootSeps.join(', ') + ' divide the key space into 4 subtrees.</p>';
      else if (id[0] === 'b') { var b = branches[+id.slice(1)]; html = '<strong>Branch (internal) page ' + (+id.slice(1) + 1) + '</strong><p>Separators ' + b.seps.join(', ') + ' route the search to one of 3 leaf pages. Internal pages contain only keys + downlinks, never TIDs of heap rows.</p>'; }
      else if (id[0] === 'l') { var li = +id.slice(1); html = '<strong>Leaf page ' + (li + 1) + '</strong><p>Keys ' + leaves[li].map(function (k) { return k + '→(' + tid[k].join(',') + ')'; }).join(', ') + '. Each entry = key + heap TID. Right/left links let range scans continue to the neighbouring leaf.</p>'; }
      else { var p = +id.slice(1); var rows = keys.filter(function (k) { return tid[k][0] === p; }); html = '<strong>Heap page ' + p + '</strong><p>Contains rows with id ' + rows.join(', ') + ' — stored in insertion order, not key order. Following TIDs causes random I/O, which is why the planner prefers a seq scan when many rows match.</p>'; }
      $(root, '[data-out=info]').innerHTML = '<div class="viz-explain-body">' + html + '</div>';
      $$(svg, '.viz-node').forEach(function (g) { g.classList.toggle('viz-sel', g.getAttribute('data-node') === id); });
    }

    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'search') animate();
      else if (a === 'step') { stopTimer(); step(); }
      else if (a === 'reset') { stopTimer(); state.steps = []; state.at = -1; state.reads = 0; state.target = null; draw(); renderLog(); renderStats(); }
      else if (a === 'random') { $(root, '[data-in=key]').value = keys[Math.floor(Math.random() * keys.length)]; animate(); }
    });
    $(root, '[data-in=key]').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') animate(); });
    onActivate(svg, '.viz-node', function (g) { info(g.getAttribute('data-node')); });
    draw(); renderLog(); renderStats();
  }

  /* ------------------------------------------------------------------
     LAB: plan — EXPLAIN ANALYZE tree visualizer
     ------------------------------------------------------------------ */
  var OPS = {
    'Seq Scan': ['Reads every page of the table and applies the filter to each row.', 'Fine for small tables or when a large fraction of rows match. Bad sign: big "Rows Removed by Filter" with few rows returned → consider an index on the filter column.'],
    'Index Scan': ['Walks a B-tree (or other) index to find matching TIDs, then fetches each row from the heap.', 'Great for selective lookups. Many loops × heap fetches can be slow; check that row estimates are right and consider a covering index.'],
    'Index Only Scan': ['Answers the query from the index alone, visiting the heap only for pages not marked all-visible.', 'Watch "Heap Fetches": high numbers mean the visibility map is stale → VACUUM the table.'],
    'Bitmap Index Scan': ['Scans the index and builds an in-memory bitmap of matching heap pages/tuples. Several bitmaps can be ANDed/ORed.', 'Used for medium selectivity or to combine indexes. Feeds a Bitmap Heap Scan.'],
    'Bitmap Heap Scan': ['Visits heap pages in physical order using the bitmap, rechecking the condition where needed.', '"Lossy" heap blocks mean the bitmap exceeded work_mem and degraded to page granularity → more rechecks.'],
    'BitmapAnd': ['Intersects bitmaps from several Bitmap Index Scans (e.g. two single-column indexes).', 'A composite index might be cheaper if this combination is frequent.'],
    'BitmapOr': ['Unions bitmaps — typical for OR conditions or IN lists across indexes.', 'Usually good. Without it, OR conditions often force a Seq Scan.'],
    'Hash Join': ['Builds a hash table from the inner (smaller) input, then probes it with each outer row.', 'Best for large unsorted inputs with equality conditions. "Batches > 1" means the hash spilled to disk → raise work_mem or reduce rows.'],
    'Hash': ['Builds the in-memory hash table for the parent Hash Join.', 'Check Memory Usage and Batches. Estimates here decide whether the hash fits in work_mem × hash_mem_multiplier.'],
    'Nested Loop': ['For each outer row, runs the inner side (often an Index Scan) again.', 'Perfect when the outer side is small. Disaster when the outer row estimate is far too low — look at "loops" on the inner node.'],
    'Merge Join': ['Merges two inputs already sorted on the join key.', 'Good for big inputs sorted by indexes. Extra Sort nodes underneath can make it expensive.'],
    'Sort': ['Sorts its input for ORDER BY, merge joins, DISTINCT or grouping.', '"Sort Method: external merge Disk: …" = spilled to temp files; raise work_mem for this query or add an index that provides the order.'],
    'Incremental Sort': ['Sorts input that is already sorted by a prefix of the keys, group by group.', 'Usually cheap; appears with indexes on leading columns.'],
    'Aggregate': ['Computes aggregates (count, sum …) over all input rows.', 'Cost is dominated by its input — optimise the scan beneath.'],
    'HashAggregate': ['Groups rows in a hash table keyed by GROUP BY columns.', 'If the hash exceeds work_mem it spills to disk ("Batches", "Disk Usage" in PG 13+).'],
    'GroupAggregate': ['Groups rows that arrive sorted by the GROUP BY columns.', 'Needs sorted input — look for a Sort or an index below it.'],
    'Limit': ['Stops after N rows.', 'With ORDER BY + LIMIT, an index providing the order lets the plan stop early (Top-N). Without one, everything must be sorted first.'],
    'Gather': ['Collects rows from parallel workers.', 'Compare "Workers Planned" vs "Workers Launched" — fewer launched means max_parallel_workers was exhausted.'],
    'Gather Merge': ['Collects already-sorted rows from parallel workers, preserving order.', 'Same checks as Gather.'],
    'Materialize': ['Caches its input so it can be rescanned cheaply (e.g. inner side of a nested loop).', 'Usually harmless.'],
    'Memoize': ['Caches inner-side results of a nested loop by parameter value (PG 14+).', 'Check hits vs misses; low hit ratios add overhead.'],
    'Append': ['Concatenates results from several children — partitions or UNION ALL.', 'For partitioned tables, check that pruning removed irrelevant partitions ("Subplans Removed").'],
    'CTE Scan': ['Reads the result of a materialized CTE.', 'Since PG 12, CTEs referenced once are inlined unless MATERIALIZED is specified.'],
    'Subquery Scan': ['Scans the output of a subquery.', 'Usually flattened away by the planner.'],
    'Unique': ['Removes adjacent duplicates from sorted input (DISTINCT).', 'Needs sorted input.'],
    'WindowAgg': ['Computes window functions over partitions/frames.', 'Needs sorted input by PARTITION BY / ORDER BY.'],
    'Result': ['Computes a constant result or a one-time filter.', 'Cheap.'],
    'Values Scan': ['Produces rows from a VALUES list.', 'Cheap.'],
    'Function Scan': ['Calls a set-returning function (e.g. generate_series).', 'Row estimates for functions default to 1000 — set ROWS on your function if it matters.'],
    'ModifyTable': ['Performs INSERT/UPDATE/DELETE on rows from its child.', 'Time inside triggers and FK checks is listed separately at the bottom of EXPLAIN ANALYZE.']
  };
  function opKey(op) {
    if (OPS[op]) return op;
    if (/Join$/.test(op)) { var b = op.replace(/ (Left|Right|Full|Anti|Semi|Right Anti|Right Semi) Join$/, ' Join'); if (OPS[b]) return b; }
    if (/Insert|Update|Delete|Merge/.test(op) && !/Join/.test(op)) return 'ModifyTable';
    if (/Parallel /.test(op)) return opKey(op.replace('Parallel ', ''));
    return null;
  }

  /* sample plans: [op, details, cost[s,t], estRows, width, actual[first,last], actRows, loops, buffers[hit,read], extra[], children] */
  function P(op, info, cost, rows, width, at, arows, loops, buf, extra, kids) {
    return { op: op, rel: info.rel, alias: info.alias, idx: info.idx, startup: cost[0], total: cost[1], planRows: rows, width: width,
      aFirst: at ? at[0] : null, aTime: at ? at[1] : null, aRows: arows, loops: loops, hit: buf ? buf[0] : null, read: buf ? buf[1] : null,
      extra: extra || [], children: kids || [] };
  }
  var PLANS = [
    { id: 'hash', name: 'Hash Join (healthy)', planning: 0.41, exec: 24.9,
      sql: "SELECT o.id, o.total_amount, c.name\nFROM orders o JOIN customers c ON c.id = o.customer_id\nWHERE c.country = 'India';",
      plan: P('Hash Join', {}, [9.84, 2181.4], 4920, 24, [0.21, 23.1], 4875, 1, [598, 210], ['Hash Cond: (o.customer_id = c.id)'], [
        P('Seq Scan', { rel: 'orders', alias: 'o' }, [0, 1834], 50000, 18, [0.01, 9.3], 50000, 1, [512, 210], []),
        P('Hash', {}, [8.6, 8.6], 98, 14, [0.17, 0.17], 98, 1, [86, 0], ['Buckets: 1024  Batches: 1  Memory Usage: 13kB'], [
          P('Index Scan', { rel: 'customers', alias: 'c', idx: 'customers_country_idx' }, [0.29, 8.6], 98, 14, [0.02, 0.12], 98, 1, [86, 0], ["Index Cond: (country = 'India'::text)"])
        ])
      ]) },
    { id: 'sort', name: 'Aggregate + Sort spilling to disk', planning: 0.29, exec: 412.7,
      sql: 'SELECT product_id, sum(quantity * unit_price) AS revenue\nFROM order_items\nGROUP BY product_id\nORDER BY revenue DESC;',
      plan: P('Sort', {}, [61250, 61775], 210000, 40, [398.2, 411.0], 200000, 1, [0, 4410], ['Sort Key: (sum(((quantity)::numeric * unit_price))) DESC', 'Sort Method: external merge  Disk: 9840kB'], [
        P('HashAggregate', {}, [33120, 37845], 210000, 40, [180.5, 301.2], 200000, 1, [0, 2650], ['Group Key: product_id', 'Batches: 5  Memory Usage: 4145kB  Disk Usage: 12280kB'], [
          P('Seq Scan', { rel: 'order_items' }, [0, 18334], 1000000, 14, [0.01, 61.7], 1000000, 1, [3120, 5214], [])
        ])
      ]) },
    { id: 'bitmap', name: 'Bitmap Heap Scan (BitmapAnd)', planning: 0.33, exec: 6.8,
      sql: "SELECT * FROM orders\nWHERE status = 'pending'\n  AND order_date >= now() - interval '7 days';",
      plan: P('Bitmap Heap Scan', { rel: 'orders' }, [96.4, 1210.6], 410, 52, [1.9, 6.4], 388, 1, [402, 12], ["Recheck Cond: ((status = 'pending'::text) AND (order_date >= (now() - '7 days'::interval)))", 'Heap Blocks: exact=371'], [
        P('BitmapAnd', {}, [96.4, 96.4], 410, 0, [1.7, 1.7], 0, 1, [31, 0], [], [
          P('Bitmap Index Scan', { idx: 'orders_status_idx' }, [0, 41.9], 2650, 0, [0.6, 0.6], 2601, 1, [12, 0], ["Index Cond: (status = 'pending'::text)"]),
          P('Bitmap Index Scan', { idx: 'orders_order_date_idx' }, [0, 54.2], 7700, 0, [0.9, 0.9], 7655, 1, [19, 0], ["Index Cond: (order_date >= (now() - '7 days'::interval))"])
        ])
      ]) },
    { id: 'nl', name: 'Nested Loop with a bad estimate', planning: 0.52, exec: 1873.4,
      sql: "SELECT c.name, o.id, o.total_amount\nFROM customers c JOIN orders o ON o.customer_id = c.id\nWHERE c.segment = 'enterprise' AND c.country = 'India';",
      plan: P('Nested Loop', {}, [0.29, 145.2], 12, 30, [0.05, 1862.0], 48210, 1, [98510, 24301], [], [
        P('Seq Scan', { rel: 'customers', alias: 'c' }, [0, 112.5], 3, 18, [0.02, 2.4], 1210, 1, [38, 0], ["Filter: ((segment = 'enterprise'::text) AND (country = 'India'::text))", 'Rows Removed by Filter: 3790']),
        P('Index Scan', { rel: 'orders', alias: 'o', idx: 'orders_customer_id_idx' }, [0.29, 10.9], 4, 16, [0.03, 1.5], 40, 1210, [98472, 24301], ['Index Cond: (customer_id = c.id)'])
      ]) },
    { id: 'seq', name: 'Seq Scan where an index is missing', planning: 0.12, exec: 38.6,
      sql: "SELECT * FROM payments WHERE status = 'failed';",
      plan: P('Gather', {}, [1000, 4380.3], 210, 40, [0.4, 38.2], 200, 1, [612, 2110], ['Workers Planned: 2', 'Workers Launched: 2'], [
        P('Parallel Seq Scan', { rel: 'payments' }, [0, 3359.3], 88, 40, [0.3, 35.1], 67, 3, [612, 2110], ["Filter: (status = 'failed'::text)", 'Rows Removed by Filter: 66600'])
      ]) }
  ];

  /* Convert PostgreSQL's FORMAT JSON plan to our node shape. */
  function fromPgJson(p) {
    var op = p['Node Type'];
    if (op === 'Aggregate' && p.Strategy === 'Hashed') op = 'HashAggregate';
    else if (op === 'Aggregate' && p.Strategy === 'Sorted') op = 'GroupAggregate';
    if (/Join|Nested Loop/.test(op) && p['Join Type'] && p['Join Type'] !== 'Inner') op = op.replace(/ Join$/, '') + ' ' + p['Join Type'] + ' Join';
    if (op === 'Nested Loop' && p['Join Type'] && p['Join Type'] !== 'Inner') op = 'Nested Loop ' + p['Join Type'] + ' Join';
    if (p['Parallel Aware']) op = 'Parallel ' + op;
    var extra = [];
    ['Hash Cond', 'Merge Cond', 'Index Cond', 'Recheck Cond', 'Join Filter', 'Filter', 'Sort Key', 'Group Key'].forEach(function (k) {
      if (p[k] != null) extra.push(k + ': ' + (Array.isArray(p[k]) ? p[k].join(', ') : p[k]));
    });
    if (p['Rows Removed by Filter'] != null) extra.push('Rows Removed by Filter: ' + p['Rows Removed by Filter']);
    if (p['Rows Removed by Index Recheck']) extra.push('Rows Removed by Index Recheck: ' + p['Rows Removed by Index Recheck']);
    if (p['Sort Method']) extra.push('Sort Method: ' + p['Sort Method'] + '  ' + (p['Sort Space Type'] || '') + ': ' + (p['Sort Space Used'] || '?') + 'kB');
    if (p['Hash Batches'] != null) extra.push('Buckets: ' + p['Hash Buckets'] + '  Batches: ' + p['Hash Batches'] + '  Memory Usage: ' + p['Peak Memory Usage'] + 'kB');
    if (p['HashAgg Batches'] != null) extra.push('Batches: ' + p['HashAgg Batches'] + '  Memory Usage: ' + (p['Peak Memory Usage'] || '?') + 'kB' + (p['Disk Usage'] ? '  Disk Usage: ' + p['Disk Usage'] + 'kB' : ''));
    if (p['Heap Fetches'] != null) extra.push('Heap Fetches: ' + p['Heap Fetches']);
    if (p['Exact Heap Blocks'] != null) extra.push('Heap Blocks: exact=' + p['Exact Heap Blocks'] + (p['Lossy Heap Blocks'] ? ' lossy=' + p['Lossy Heap Blocks'] : ''));
    if (p['Workers Planned'] != null) extra.push('Workers Planned: ' + p['Workers Planned'] + (p['Workers Launched'] != null ? '  Launched: ' + p['Workers Launched'] : ''));
    if (p['Subplans Removed']) extra.push('Subplans Removed: ' + p['Subplans Removed']);
    if (p['Cache Hits'] != null) extra.push('Hits: ' + p['Cache Hits'] + '  Misses: ' + p['Cache Misses']);
    return {
      op: op, rel: p['Relation Name'], alias: p.Alias && p.Alias !== p['Relation Name'] ? p.Alias : null, idx: p['Index Name'],
      startup: p['Startup Cost'], total: p['Total Cost'], planRows: p['Plan Rows'], width: p['Plan Width'],
      aFirst: p['Actual Startup Time'], aTime: p['Actual Total Time'], aRows: p['Actual Rows'], loops: p['Actual Loops'],
      hit: p['Shared Hit Blocks'], read: p['Shared Read Blocks'], extra: extra,
      children: (p.Plans || []).map(fromPgJson)
    };
  }
  /* Accept raw JSON, psql-formatted output (with "+" line continuations), or a JS object. */
  function parsePlanText(text) {
    var obj = text;
    if (typeof text === 'string') {
      var t = text.trim();
      try { obj = JSON.parse(t); }
      catch (e) {
        var cleaned = t.split('\n').filter(function (l) { return !/^\s*(QUERY PLAN|-{3,}|\(\d+ rows?\))\s*$/.test(l); })
          .map(function (l) { return l.replace(/\s*\+\s*$/, ''); }).join('\n');
        var s = cleaned.indexOf('['), s2 = cleaned.indexOf('{');
        var from = s === -1 ? s2 : (s2 === -1 ? s : Math.min(s, s2));
        obj = JSON.parse(cleaned.slice(from));
      }
    }
    if (Array.isArray(obj)) obj = obj[0];
    if (obj && obj['QUERY PLAN']) return parsePlanText(obj['QUERY PLAN']);
    if (!obj || !obj.Plan) throw new Error('No "Plan" key found — use EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON).');
    return { plan: fromPgJson(obj.Plan), planning: obj['Planning Time'], exec: obj['Execution Time'] };
  }

  function labPlan(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-plan');
    var hasDb = !!(PGM.db && typeof PGM.db.exec === 'function');
    var state = { cur: PLANS[0], sel: null, flat: [] };
    root.innerHTML = labHead('plan') +
      '<div class="viz-controls" role="group" aria-label="Sample plans">' +
      PLANS.map(function (p, i) { return btn('sample', esc(p.name), { val: i, pressed: i === 0, cls: 'viz-chip' }); }).join('') + '</div>' +
      '<pre class="viz-code" data-out="sql"></pre>' +
      '<div class="viz-stats" data-out="sum"></div>' +
      '<div class="viz-plan-wrap"><div class="viz-ptree-scroll" data-out="tree"></div>' +
      '<div class="viz-explain viz-plan-explain" data-out="info" aria-live="polite"><span class="viz-explain-hint">Click a plan node to learn what it does and what to look for.</span></div></div>' +
      '<details class="viz-details"><summary>Paste your own EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) output</summary>' +
      '<textarea class="viz-textarea" data-in="json" rows="7" spellcheck="false" aria-label="EXPLAIN JSON output" placeholder=\'[ { "Plan": { "Node Type": "Seq Scan", … }, "Execution Time": 1.23 } ]\'></textarea>' +
      '<div class="viz-controls">' + btn('paste', 'Visualize JSON', { cls: 'viz-btn-primary' }) + '<span class="viz-msg" data-out="pmsg"></span></div></details>' +
      '<details class="viz-details"' + (hasDb ? '' : '') + '><summary>Run EXPLAIN ANALYZE on the sample database (in-browser PostgreSQL)</summary>' +
      '<textarea class="viz-textarea" data-in="run" rows="4" spellcheck="false" aria-label="SQL to explain">SELECT c.country, count(*) AS orders, sum(o.total_amount) AS revenue\nFROM orders o JOIN customers c ON c.id = o.customer_id\nWHERE o.status = \'delivered\'\nGROUP BY c.country ORDER BY revenue DESC;</textarea>' +
      '<div class="viz-controls">' + btn('run', 'Run EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)', { cls: 'viz-btn-primary', disabled: !hasDb }) +
      '<span class="viz-msg" data-out="rmsg">' + (hasDb ? 'Statements that modify data are run inside BEGIN … ROLLBACK.' : 'The in-browser database is not available on this page — use the samples or paste JSON.') + '</span></div></details>';

    function ratioInfo(n) {
      if (n.aRows == null || n.planRows == null) return null;
      var est = Math.max(n.planRows, 1), act = Math.max(n.aRows, 1);
      var r = Math.max(est / act, act / est);
      return { r: r, under: act > est };
    }
    function nodeTotal(n) { return n.aTime == null ? null : n.aTime * (n.loops || 1); }
    function exclusive(n) {
      var t = nodeTotal(n); if (t == null) return null;
      var c = 0;
      n.children.forEach(function (k) { var kt = nodeTotal(k); if (kt != null) c += kt; });
      /* parallel children report per-worker averages; clamp to sane range */
      return Math.max(0, t - c);
    }
    function nodeHtml(n, path) {
      state.flat[path] = n;
      var rr = ratioInfo(n), ex = exclusive(n), exec = state.cur.exec || nodeTotal(state.cur.plan) || 1;
      var pct = ex == null ? 0 : clamp(ex / exec * 100, 0, 100);
      var title = esc(n.op) + (n.idx ? ' <span class="viz-muted">using</span> ' + esc(n.idx) : '') +
        (n.rel ? ' <span class="viz-muted">on</span> ' + esc(n.rel) + (n.alias ? ' ' + esc(n.alias) : '') : '');
      var badge = '';
      if (rr && rr.r >= 10) badge = '<span class="viz-pill viz-pill-bad" title="Row estimate off by ' + fmt(rr.r, 0) + '×">rows ' + fmt(rr.r, 0) + '× ' + (rr.under ? 'under' : 'over') + '-estimated</span>';
      else if (rr && rr.r >= 3) badge = '<span class="viz-pill viz-pill-warn">rows ' + fmt(rr.r, 1) + '× off</span>';
      var html = '<li><div class="viz-pnode' + (pct > 40 ? ' viz-hot' : '') + '" data-path="' + path + '" tabindex="0" role="button" aria-label="' + esc(n.op) + ' node, press Enter for explanation">' +
        '<div class="viz-pnode-title">' + title + '</div>' +
        '<div class="viz-pnode-meta">' +
        '<span title="startup..total cost (arbitrary units)">cost ' + fmt(n.startup, 2) + '..' + fmt(n.total, 2) + '</span>' +
        '<span>rows est <b>' + fmt(n.planRows, 0) + '</b>' + (n.aRows != null ? ' · actual <b>' + fmt(n.aRows, 0) + '</b>' : '') + '</span>' +
        (n.aTime != null ? '<span>time ' + fmt(n.aFirst, 3) + '..' + fmt(n.aTime, 3) + ' ms</span>' : '') +
        (n.loops != null ? '<span' + (n.loops > 100 ? ' class="viz-warnt"' : '') + '>loops ' + fmt(n.loops, 0) + '</span>' : '') +
        (n.hit != null ? '<span>buffers hit ' + fmt(n.hit, 0) + (n.read ? ' · <span class="viz-warnt">read ' + fmt(n.read, 0) + '</span>' : '') + '</span>' : '') +
        '</div>' + badge +
        (ex != null ? '<div class="viz-bar" title="Exclusive time ≈ ' + fmt(ex, 2) + ' ms"><i style="width:' + pct.toFixed(1) + '%"></i><span>' + fmt(pct, 0) + '% self time</span></div>' : '') +
        '</div>';
      if (n.children.length) html += '<ul>' + n.children.map(function (c, i) { return nodeHtml(c, path + '.' + i); }).join('') + '</ul>';
      return html + '</li>';
    }
    function render() {
      state.flat = {};
      $(root, '[data-out=sql]').textContent = state.cur.sql || '(your plan)';
      $(root, '[data-out=tree]').innerHTML = '<ul class="viz-ptree">' + nodeHtml(state.cur.plan, '0') + '</ul>';
      var worst = null;
      Object.keys(state.flat).forEach(function (k) { var n = state.flat[k], r = ratioInfo(n); if (r && (!worst || r.r > worst.r)) worst = { r: r.r, n: n }; });
      $(root, '[data-out=sum]').innerHTML =
        '<div class="viz-stat"><span>Planning time</span><strong>' + (state.cur.planning != null ? fmt(state.cur.planning, 2) + ' ms' : '–') + '</strong></div>' +
        '<div class="viz-stat"><span>Execution time</span><strong>' + (state.cur.exec != null ? fmt(state.cur.exec, 1) + ' ms' : '–') + '</strong></div>' +
        '<div class="viz-stat' + (worst && worst.r >= 10 ? ' viz-stat-bad' : '') + '"><span>Worst row misestimate</span><strong>' + (worst ? fmt(worst.r, 0) + '×' : '–') + '</strong>' +
        (worst ? '<small>' + esc(worst.n.op) + '</small>' : '') + '</div>';
      $(root, '[data-out=info]').innerHTML = '<span class="viz-explain-hint">Click a plan node to learn what it does and what to look for. Read plans bottom-up: leaves produce rows, parents consume them.</span>';
    }
    function explain(path) {
      var n = state.flat[path]; if (!n) return;
      $$(root, '.viz-pnode').forEach(function (x) { x.classList.toggle('viz-sel', x.getAttribute('data-path') === path); });
      var k = opKey(n.op), d = k ? OPS[k] : ['A plan node of type ' + n.op + '.', 'Compare estimated vs actual rows and look at where time is spent.'];
      var tips = [];
      var rr = ratioInfo(n);
      if (rr && rr.r >= 10) tips.push('Estimated ' + fmt(n.planRows, 0) + ' rows but got ' + fmt(n.aRows, 0) + ' (' + fmt(rr.r, 0) + '× off). Bad estimates lead to bad join choices. Run ANALYZE; for correlated columns try CREATE STATISTICS (dependencies, mcv); raise the column’s statistics target.');
      if (n.loops > 100) tips.push('Executed ' + fmt(n.loops, 0) + ' times (loops). Times and rows shown are per loop — total ≈ ' + fmt(nodeTotal(n), 1) + ' ms.');
      n.extra.forEach(function (x) {
        var m = /Rows Removed by Filter: (\d+)/.exec(x);
        if (m && +m[1] > 10 * Math.max(n.aRows || 1, 1)) tips.push('The filter discarded ' + fmt(+m[1], 0) + ' rows to return ' + fmt(n.aRows, 0) + ' — an index (maybe partial) on the filtered column would avoid reading them.');
        if (/external merge|Disk:/.test(x) && /Sort/.test(n.op)) tips.push('Sort spilled to disk. Increase work_mem for this query (SET LOCAL work_mem = \'64MB\') or provide the order via an index.');
        if (/Batches: ([2-9]|\d\d)/.test(x)) tips.push('Hash spilled into multiple batches (temp files). More work_mem / hash_mem_multiplier or fewer rows would keep it in memory.');
        if (/lossy=/.test(x)) tips.push('Lossy bitmap blocks: the bitmap exceeded work_mem, so whole pages are rechecked.');
        var hf = /Heap Fetches: (\d+)/.exec(x);
        if (hf && +hf[1] > 0) tips.push('Heap fetches mean pages were not all-visible; VACUUM keeps index-only scans truly index-only.');
        if (/Launched: (\d+)/.test(x) && /Planned: (\d+)/.test(x)) { var pl = +/Planned: (\d+)/.exec(x)[1], la = +/Launched: (\d+)/.exec(x)[1]; if (la < pl) tips.push('Fewer workers launched than planned — max_parallel_workers / max_worker_processes exhausted.'); }
      });
      if (n.read && n.hit != null && n.read > n.hit) tips.push('More pages read from disk/OS (' + fmt(n.read, 0) + ') than found in shared buffers (' + fmt(n.hit, 0) + '). A second run is often faster (cache warm-up).');
      if (/Seq Scan/.test(n.op) && n.aRows != null && n.aRows < 1000 && (n.total || 0) > 1000) tips.push('Few rows returned by an expensive sequential scan → a good index candidate.');
      $(root, '[data-out=info]').innerHTML = '<div class="viz-explain-body"><strong>' + esc(n.op) + '</strong>' +
        (n.rel ? ' <span class="viz-muted">on ' + esc(n.rel) + '</span>' : '') +
        '<p>' + esc(d[0]) + '</p><p><em>What to look for:</em> ' + esc(d[1]) + '</p>' +
        (n.extra.length ? '<pre class="viz-code viz-code-sm">' + esc(n.extra.join('\n')) + '</pre>' : '') +
        (tips.length ? '<ul class="viz-tips">' + tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '<p class="viz-ok">No red flags on this node.</p>') +
        '</div>';
    }
    function load(p) { state.cur = p; render(); }
    async function runDb() {
      var msg = $(root, '[data-out=rmsg]');
      var sql = $(root, '[data-in=run]').value.trim().replace(/;\s*$/, '');
      if (!sql) return;
      if (/^\s*explain\b/i.test(sql)) sql = sql.replace(/^\s*explain\s*(\([^)]*\))?/i, '');
      var dml = /^\s*(insert|update|delete|merge|with[\s\S]*\b(insert|update|delete)\b)/i.test(sql);
      msg.textContent = 'Starting PostgreSQL…';
      try {
        if (PGM.db.ensure) await PGM.db.ensure();
        msg.textContent = 'Running…';
        if (dml) await PGM.db.exec('BEGIN');
        var res = await PGM.db.exec('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql);
        if (dml) await PGM.db.exec('ROLLBACK');
        var r = Array.isArray(res) ? res[res.length - 1] : res;
        if (!r) throw new Error('No result returned.');
        if (r.error) throw new Error(r.error.message || r.error);
        var row = r.rows && r.rows[0];
        if (!row) throw new Error('EXPLAIN returned no rows.');
        var val = row['QUERY PLAN'] != null ? row['QUERY PLAN'] : row[Object.keys(row)[0]];
        var parsed = parsePlanText(val);
        parsed.sql = sql + ';';
        load(parsed);
        msg.textContent = 'Done — plan from the real engine' + (dml ? ' (changes rolled back)' : '') + '.';
        $$(root, '[data-act=sample]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      } catch (e) {
        msg.innerHTML = '<span class="viz-err">' + esc(e.message || String(e)) + '</span>' + (/does not exist/.test(String(e.message)) ? ' — create the sample database first.' : '');
      }
    }
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (b) {
        var a = b.getAttribute('data-act');
        if (a === 'sample') {
          $$(root, '[data-act=sample]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          load(PLANS[+b.getAttribute('data-val')]);
        } else if (a === 'paste') {
          var m = $(root, '[data-out=pmsg]');
          try {
            var parsed = parsePlanText($(root, '[data-in=json]').value);
            parsed.sql = '-- pasted plan';
            load(parsed); m.textContent = 'Plan loaded.';
            $$(root, '[data-act=sample]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
          } catch (e) { m.innerHTML = '<span class="viz-err">Could not parse: ' + esc(e.message) + '</span>'; }
        } else if (a === 'run') runDb();
        return;
      }
    });
    onActivate(root, '.viz-pnode', function (n) { explain(n.getAttribute('data-path')); });
    render();
  }

  /* ------------------------------------------------------------------
     LAB: index — index type explorer + wizard
     ------------------------------------------------------------------ */
  var INDEX_TYPES = {
    btree: { name: 'B-tree', tag: 'The default. Sorted, balanced tree for equality, ranges and ordering.',
      uses: ['Primary keys & UNIQUE constraints', 'WHERE col = / < / > / BETWEEN / IN', 'ORDER BY … LIMIT (top-N)', "LIKE 'abc%' (C collation or text_pattern_ops)"],
      sql: 'CREATE INDEX orders_customer_date_idx\n  ON orders (customer_id, order_date DESC)\n  INCLUDE (total_amount);  -- covering',
      ops: '<  <=  =  >=  >  BETWEEN  IN  IS NULL',
      pros: ['Supports almost every scalar type', 'Gives sorted output, avoids Sort nodes', 'Multicolumn, UNIQUE, INCLUDE, partial, expression indexes', 'Deduplication (PG 13+) shrinks repeated keys'],
      cons: ['Not useful for containment (@>), full-text or geometry', 'Bloats under heavy updates; REINDEX CONCURRENTLY to fix', 'Leading-column rule for multicolumn indexes'],
      cx: 'O(log n) lookup; ~3–4 page reads for millions of rows', storage: 'Medium — roughly key size + 8–16 bytes per row', write: 'Moderate — every INSERT and every non-HOT UPDATE touches it',
      workload: 'OLTP lookups: SELECT * FROM orders WHERE customer_id = $1 ORDER BY order_date DESC LIMIT 20' },
    hash: { name: 'Hash', tag: 'Stores a 32-bit hash of the key. Equality only.',
      uses: ['= lookups on long values (URLs, tokens, hashes)', 'Large keys where B-tree would be big'],
      sql: 'CREATE INDEX sessions_token_idx\n  ON sessions USING hash (token);',
      ops: '=  only',
      pros: ['Index size independent of key length', 'O(1) lookups', 'WAL-logged and crash-safe since PG 10'],
      cons: ['No range scans, no ordering', 'Cannot be UNIQUE or multicolumn', 'Often no faster than B-tree in practice'],
      cx: 'O(1) average lookup', storage: 'Small for long keys (4-byte hash codes)', write: 'Low–moderate; bucket splits on growth',
      workload: 'WHERE api_key = $1 on a 300-byte random token column' },
    gin: { name: 'GIN', tag: 'Generalized Inverted Index: maps each element/word to the rows containing it.',
      uses: ['JSONB containment (@>, ?, ?|, ?&)', 'Arrays (@>, <@, &&)', 'Full-text search (tsvector @@ tsquery)', "Trigram LIKE '%abc%' with pg_trgm"],
      sql: "CREATE INDEX products_attr_idx ON products USING gin (attributes jsonb_path_ops);\nCREATE INDEX docs_fts_idx ON documents USING gin (search);",
      ops: '@>  <@  &&  ?  ?|  ?&  @@  @?  (opclass-dependent)',
      pros: ['Very fast "contains" lookups on composite values', 'Handles many keys per row', 'jsonb_path_ops variant is smaller & faster for @>'],
      cons: ['Slow to update — each row adds many entries (fastupdate pending list helps)', 'Larger than B-tree', 'No ordering, no ranking by itself'],
      cx: 'O(log k) per searched key + merging posting lists', storage: 'Large — one entry per element/word per row', write: 'High; pending list flushed by VACUUM or gin_pending_list_limit',
      workload: "SELECT * FROM products WHERE attributes @> '{\"color\":\"red\"}' or tags && ARRAY['sale']" },
    gist: { name: 'GiST', tag: 'Generalized Search Tree: balanced tree of bounding predicates (boxes, ranges).',
      uses: ['Geometry / PostGIS (&&, ST_Intersects)', 'Range types overlap (&&) and containment', 'Nearest-neighbour ORDER BY col <-> point', 'Exclusion constraints (no overlapping bookings)'],
      sql: 'ALTER TABLE bookings ADD CONSTRAINT no_overlap\n  EXCLUDE USING gist (room_id WITH =, during WITH &&);  -- needs btree_gist',
      ops: '&&  @>  <@  <<  >>  ~=  <->  (opclass-dependent)',
      pros: ['Extensible to many data types', 'K-nearest-neighbour searches', 'Powers exclusion constraints'],
      cons: ['Lossy — results are rechecked', 'Slower than GIN for full-text lookups', 'Build quality depends on data insertion order'],
      cx: 'O(log n) typical; overlapping regions can widen the search', storage: 'Medium', write: 'Moderate (faster to update than GIN)',
      workload: 'SELECT * FROM stores ORDER BY location <-> point(77.2, 28.6) LIMIT 5' },
    spgist: { name: 'SP-GiST', tag: 'Space-partitioned trees (quadtree, k-d tree, radix tree) for non-overlapping partitions.',
      uses: ['IP addresses & subnets (inet_ops: <<, >>=)', 'Points (quad / kd trees)', 'Text prefix search (^@, starts_with)', 'Range types'],
      sql: 'CREATE INDEX logs_ip_idx ON access_logs USING spgist (client_ip inet_ops);',
      ops: '<<  <<=  >>  >>=  ^@  <->  ~=  (opclass-dependent)',
      pros: ['Efficient for skewed, clustered data', 'Small for data with common prefixes', 'Supports KNN for points'],
      cons: ['Fewer operator classes', 'No multicolumn support', 'Less commonly used — less tooling knowledge'],
      cx: 'O(depth) — depth depends on data distribution', storage: 'Small–medium', write: 'Moderate',
      workload: "SELECT count(*) FROM access_logs WHERE client_ip << '10.20.0.0/16'" },
    brin: { name: 'BRIN', tag: 'Block Range INdex: stores min/max per range of pages (default 128 pages).',
      uses: ['Huge append-only tables (logs, events, IoT)', 'Columns correlated with physical order (created_at, id)', 'Time-range queries on partitions'],
      sql: 'CREATE INDEX events_ts_brin ON events USING brin (created_at)\n  WITH (pages_per_range = 64, autosummarize = on);',
      ops: '<  <=  =  >=  >  (minmax);  &&  @>  (inclusion);  bloom, minmax-multi (PG 14+)',
      pros: ['Tiny: kilobytes for gigabytes of table', 'Almost free to maintain on INSERT', 'Great with time-ordered data'],
      cons: ['Lossy — reads whole block ranges', 'Useless if values are randomly placed (low correlation)', 'Needs summarization of new ranges (autosummarize/VACUUM)'],
      cx: 'Linear scan of a tiny summary, then matching block ranges', storage: 'Tiny (≈ 1 entry per 128 pages)', write: 'Very low',
      workload: "SELECT avg(value) FROM sensor_readings WHERE created_at >= now() - interval '1 day'  (2 TB table)" },
    bloom: { name: 'Bloom', tag: 'Extension: a signature per row so equality on ANY combination of columns can be filtered.',
      uses: ['Ad-hoc equality filters on many columns', 'Wide tables where a B-tree per column combination is impractical'],
      sql: 'CREATE EXTENSION bloom;\nCREATE INDEX products_bloom ON products USING bloom (category_id, brand_id, color_id, size_id)\n  WITH (length = 80, col1 = 2, col2 = 2);',
      ops: '=  only (int4 and text opclasses shipped)',
      pros: ['One index serves many column combinations', 'Compact relative to many B-trees'],
      cons: ['Lossy — false positives are rechecked', 'Equality only, no ordering, no UNIQUE', 'Full index scan every time (just a small one)'],
      cx: 'O(n) over compact signatures + heap rechecks', storage: 'Small–medium (fixed signature per row)', write: 'Low–moderate',
      workload: 'Product filtering UI where users pick any 2–3 of 10 attributes' }
  };
  var WIZ = {
    start: { q: 'What will your WHERE / ORDER BY mostly do?', opts: [
      ['Equality, ranges or sorting on a scalar (number, date, short text)', 'size'],
      ['“Contains” on JSONB, arrays, or full-text search', '=gin'],
      ["Substring / fuzzy text match (LIKE '%abc%', similarity)", '=gin-trgm'],
      ['Geometry, range overlap, nearest-neighbour, or no-overlap constraint', '=gist'],
      ['IP subnets, points, or text-prefix search on skewed data', '=spgist'],
      ['Equality on any combination of many columns', '=bloom']] },
    size: { q: 'How large is the table and how is the column filled?', opts: [
      ['Very large (100M+ rows), append-only, value grows with time (timestamps, serial ids)', '=brin'],
      ['Anything else', 'order']] },
    order: { q: 'Do you need ranges, ORDER BY, UNIQUE, or multiple columns?', opts: [
      ['Yes, or not sure', '=btree'],
      ['No — only = lookups on long values (URLs, tokens)', '=hash']] }
  };
  var WIZ_RES = {
    btree: ['btree', 'B-tree is the right default. Put equality columns first, then the range/sort column, and consider INCLUDE for index-only scans.'],
    hash: ['hash', 'A hash index stays small for long keys. A B-tree would also work and supports more operators, so benchmark both.'],
    gin: ['gin', 'Use GIN. For JSONB containment-only queries, jsonb_path_ops is smaller and faster; for full-text, index a stored tsvector column.'],
    'gin-trgm': ['gin', "Use GIN with pg_trgm: CREATE EXTENSION pg_trgm; CREATE INDEX … USING gin (name gin_trgm_ops); — it accelerates LIKE/ILIKE '%…%' and similarity (%)."],
    gist: ['gist', 'Use GiST (with PostGIS for geometry, btree_gist to mix scalar = in exclusion constraints).'],
    spgist: ['spgist', 'SP-GiST fits partitioned search spaces such as inet subnets and quadtrees of points.'],
    brin: ['brin', 'BRIN is tiny and nearly free to maintain — verify correlation with SELECT correlation FROM pg_stats WHERE tablename = … (close to ±1 is ideal).'],
    bloom: ['bloom', 'The bloom extension filters any combination of equality columns with one index; check false-positive rechecks in EXPLAIN ANALYZE.']
  };

  function labIndex(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-index');
    var keys = Object.keys(INDEX_TYPES);
    var state = { sel: 'btree', wiz: ['start'], res: null };
    root.innerHTML = labHead('index') +
      '<div class="viz-tabs" role="tablist" aria-label="Index types">' +
      keys.map(function (k) { return '<button type="button" role="tab" class="viz-tab" data-act="type" data-val="' + k + '" aria-selected="' + (k === state.sel) + '">' + esc(INDEX_TYPES[k].name) + '</button>'; }).join('') +
      '</div><div class="viz-index-card" role="tabpanel" data-out="card"></div>' +
      '<div class="viz-wizard"><h4 class="viz-h4">Which index should I use?</h4><div data-out="wiz" aria-live="polite"></div></div>';

    function list(a) { return '<ul>' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }
    function meter(label, text, level) {
      return '<div class="viz-meter"><span>' + label + '</span><div class="viz-meter-bar" aria-hidden="true">' +
        [1, 2, 3, 4, 5].map(function (i) { return '<i class="' + (i <= level ? 'on' : '') + '"></i>'; }).join('') + '</div><small>' + esc(text) + '</small></div>';
    }
    var LEVELS = { btree: [3, 3], hash: [2, 2], gin: [5, 5], gist: [3, 3], spgist: [2, 3], brin: [1, 1], bloom: [2, 2] };
    function renderCard() {
      var t = INDEX_TYPES[state.sel], lv = LEVELS[state.sel];
      $$(root, '.viz-tab').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-val') === state.sel ? 'true' : 'false'); });
      $(root, '[data-out=card]').innerHTML =
        '<div class="viz-index-top"><h4 class="viz-h4">' + esc(t.name) + '</h4><p>' + esc(t.tag) + '</p></div>' +
        '<div class="viz-index-grid">' +
        '<section><h5>Best use cases</h5>' + list(t.uses) + '</section>' +
        '<section><h5>Operators</h5><code class="viz-ops">' + esc(t.ops) + '</code><h5>Lookup complexity</h5><p>' + esc(t.cx) + '</p></section>' +
        '<section class="viz-good"><h5>Advantages</h5>' + list(t.pros) + '</section>' +
        '<section class="viz-badsec"><h5>Disadvantages</h5>' + list(t.cons) + '</section>' +
        '</div>' +
        '<div class="viz-meters">' + meter('Storage', t.storage, lv[0]) + meter('Write cost', t.write, lv[1]) + '</div>' +
        '<h5>Example SQL</h5><pre class="viz-code">' + esc(t.sql) + '</pre>' +
        '<p class="viz-workload"><strong>Example workload:</strong> <code>' + esc(t.workload) + '</code></p>';
    }
    function renderWiz() {
      var html = '';
      state.wiz.forEach(function (stepId, i) {
        var s = WIZ[stepId];
        html += '<div class="viz-wiz-step"><p class="viz-wiz-q"><span class="viz-num">' + (i + 1) + '</span>' + esc(s.q) + '</p><div class="viz-wiz-opts">' +
          s.opts.map(function (o, oi) {
            var pressed = (state.wiz[i + 1] && o[1] === state.wiz[i + 1]) || (state.res && state.res.step === i && state.res.oi === oi);
            return btn('wiz', esc(o[0]), { val: i + ':' + oi, pressed: !!pressed, cls: 'viz-chip viz-wiz-opt' });
          }).join('') + '</div></div>';
      });
      if (state.res) {
        var r = WIZ_RES[state.res.key];
        html += '<div class="viz-wiz-result"><strong>Recommendation: ' + esc(INDEX_TYPES[r[0]].name) + '</strong><p>' + esc(r[1]) + '</p>' +
          btn('type', 'Open the ' + esc(INDEX_TYPES[r[0]].name) + ' card', { val: r[0], cls: 'viz-btn-primary' }) + ' ' + btn('wizreset', 'Start over') + '</div>';
      }
      $(root, '[data-out=wiz]').innerHTML = html;
    }
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'type') { state.sel = b.getAttribute('data-val'); renderCard(); if (b.classList.contains('viz-btn-primary')) $(root, '[data-out=card]').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); }
      else if (a === 'wiz') {
        var p = b.getAttribute('data-val').split(':'), si = +p[0], oi = +p[1];
        var opt = WIZ[state.wiz[si]].opts[oi];
        state.wiz = state.wiz.slice(0, si + 1); state.res = null;
        if (opt[1][0] === '=') state.res = { key: opt[1].slice(1), step: si, oi: oi };
        else state.wiz.push(opt[1]);
        renderWiz();
      } else if (a === 'wizreset') { state.wiz = ['start']; state.res = null; renderWiz(); }
    });
    root.addEventListener('keydown', function (ev) {
      /* arrow-key navigation between tabs (WAI-ARIA tabs pattern) */
      var t = ev.target.closest('.viz-tab'); if (!t) return;
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      var tabs = $$(root, '.viz-tab'), i = tabs.indexOf(t);
      var n = tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); n.click();
    });
    renderCard(); renderWiz();
  }

  /* ------------------------------------------------------------------
     LAB: txn — two concurrent sessions, row locks, deadlocks, isolation
     A compact simulation of PostgreSQL semantics:
       * every UPDATE creates a new tuple version (xmin/xmax), row locks
         are held until COMMIT/ROLLBACK;
       * a conflicting UPDATE / SELECT FOR UPDATE waits for the holder;
       * READ COMMITTED takes a snapshot per statement and, after waiting,
         re-checks the newest row version (EvalPlanQual);
       * REPEATABLE READ / SERIALIZABLE take one snapshot at the first
         statement and fail with SQLSTATE 40001 if the row was changed by
         a transaction they cannot see;
       * SERIALIZABLE also tracks reads/writes (simplified SSI) and fails a
         COMMIT that would complete a rw-dependency cycle (write skew);
       * deadlocks are detected via a wait-for graph; the session whose
         wait closes the cycle gets "deadlock detected" (40P01).
     ------------------------------------------------------------------ */
  var ISO = { rc: 'READ COMMITTED', rr: 'REPEATABLE READ', ser: 'SERIALIZABLE' };
  var TXN_PRESETS = [
    { id: 'lock', name: 'Row lock: B waits for A', iso: ['rc', 'rc'],
      intro: 'Both sessions update the same row. B must wait until A finishes, then (READ COMMITTED) re-reads the newest version.',
      steps: [['A', 'begin'], ['A', 'update', 1], ['B', 'begin'], ['B', 'update', 1], ['A', 'commit'], ['B', 'select'], ['B', 'commit']],
      outro: 'B blocked on A’s row lock and, after A committed, applied its −10 on top of A’s change: 100 → 90 → 80. No update was lost because balance = balance − 10 is evaluated against the newest version.' },
    { id: 'deadlock', name: 'Deadlock', iso: ['rc', 'rc'],
      intro: 'A locks row 1, B locks row 2, then each wants the other’s row.',
      steps: [['A', 'begin'], ['B', 'begin'], ['A', 'update', 1], ['B', 'update', 2], ['A', 'update', 2], ['B', 'update', 1], ['A', 'commit'], ['B', 'rollback']],
      outro: 'A waits for B and B waits for A — a cycle. After deadlock_timeout (1 s) PostgreSQL detects it and aborts one transaction (here B, whose wait closed the cycle), releasing its locks so A continues. Prevention: always lock rows in a consistent order (e.g. ORDER BY id … FOR UPDATE).' },
    { id: 'lost', name: 'Lost update (read-modify-write)', iso: ['rc', 'rc'],
      intro: 'Both sessions read the balance into the application, subtract 10 there, and write the computed value back.',
      steps: [['A', 'begin'], ['A', 'select'], ['B', 'begin'], ['B', 'select'], ['A', 'appset', 1], ['A', 'commit'], ['B', 'appset', 1], ['B', 'commit'], ['A', 'select']],
      outro: 'Two withdrawals of 10 but the balance is 90, not 80: B overwrote A’s change with a value computed from a stale read. Fixes: UPDATE … SET balance = balance − 10 (atomic), SELECT … FOR UPDATE before reading, or REPEATABLE READ (B would get a serialization error and retry).' },
    { id: 'nrr', name: 'Non-repeatable read (READ COMMITTED)', iso: ['rc', 'rc'],
      intro: 'A reads twice inside one transaction while B commits a change in between.',
      steps: [['A', 'begin'], ['A', 'select'], ['B', 'update', 1], ['A', 'select'], ['A', 'commit']],
      outro: 'In READ COMMITTED every statement takes a new snapshot, so A’s second SELECT sees B’s committed update: the same query returned different results within one transaction.' },
    { id: 'rr', name: 'REPEATABLE READ snapshot + 40001', iso: ['rr', 'rc'],
      intro: 'Same as before, but A uses REPEATABLE READ — then tries to update the row B changed.',
      steps: [['A', 'begin'], ['A', 'select'], ['B', 'update', 1], ['A', 'select'], ['A', 'update', 1], ['A', 'rollback']],
      outro: 'A keeps seeing 100 because its snapshot was taken at its first statement. When A tries to update a row that was changed by a transaction it cannot see, PostgreSQL raises "could not serialize access due to concurrent update" (SQLSTATE 40001). The application must retry the whole transaction.' },
    { id: 'skew', name: 'SERIALIZABLE write skew', iso: ['ser', 'ser'],
      intro: 'Rule: the sum of both balances must stay ≥ 100. Each session checks the sum, then withdraws from a different account.',
      steps: [['A', 'begin'], ['B', 'begin'], ['A', 'select'], ['B', 'select'], ['A', 'update', 1], ['B', 'update', 2], ['A', 'commit'], ['B', 'commit']],
      outro: 'No row was written by both, so there was no lock conflict — under REPEATABLE READ both would commit (write skew). SERIALIZABLE (SSI) tracks that each transaction read what the other wrote and aborts the second COMMIT with "could not serialize access due to read/write dependencies among transactions".' }
  ];

  function labTxn(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-txn');
    var S; /* simulation state */
    var NAMES = { 1: 'alice', 2: 'bob' };

    function reset(isoA, isoB) {
      S = {
        versions: [{ row: 1, bal: 100, xmin: 1, xmax: 0 }, { row: 2, bal: 100, xmin: 1, xmax: 0 }],
        status: { 1: 'committed' }, locks: {}, nextXid: 501, t: 0, log: [],
        ser: [], /* serializable txn records for SSI */
        sess: {
          A: newSess('A', isoA || (S && S.sess.A.iso) || 'rc'),
          B: newSess('B', isoB || (S && S.sess.B.iso) || 'rc')
        },
        preset: null, pi: 0
      };
    }
    function newSess(name, iso) {
      return { name: name, iso: iso, xid: null, block: false, implicit: false, aborted: false, snap: null, lastRead: {}, waiting: null, result: null, row: 1, rec: null };
    }
    function other(s) { return s.name === 'A' ? S.sess.B : S.sess.A; }
    function sessByXid(x) { return S.sess.A.xid === x ? S.sess.A : (S.sess.B.xid === x ? S.sess.B : null); }
    function inProgress(x) { return S.status[x] === 'in-progress'; }

    function log(who, sql, out, kind) { S.t++; S.log.push({ t: S.t, who: who, sql: sql, out: out, kind: kind || '' }); }

    function takeSnap() {
      var xip = {};
      Object.keys(S.status).forEach(function (x) { if (S.status[x] === 'in-progress') xip[x] = true; });
      return { xmax: S.nextXid, xip: xip };
    }
    function xidVisible(x, snap, me) {
      if (x === me) return true;
      return S.status[x] === 'committed' && x < snap.xmax && !snap.xip[x];
    }
    function visibleVersion(row, snap, me) {
      for (var i = S.versions.length - 1; i >= 0; i--) {
        var v = S.versions[i];
        if (v.row !== row) continue;
        if (!xidVisible(v.xmin, snap, me)) continue;
        if (v.xmax && S.status[v.xmax] !== 'aborted' && xidVisible(v.xmax, snap, me)) continue;
        return v;
      }
      return null;
    }
    function latestVersion(row) {
      for (var i = S.versions.length - 1; i >= 0; i--) {
        var v = S.versions[i];
        if (v.row === row && S.status[v.xmin] !== 'aborted' && (!v.xmax || S.status[v.xmax] === 'aborted')) return v;
      }
      return null;
    }

    /* Start a transaction if needed (explicit BEGIN or implicit autocommit). */
    function ensureXid(s) {
      if (!s.xid) {
        s.xid = S.nextXid++;
        S.status[s.xid] = 'in-progress';
        if (!s.block) s.implicit = true;
        if (s.iso === 'ser') { s.rec = { xid: s.xid, reads: {}, writes: {}, snap: null, status: 'in-progress' }; S.ser.push(s.rec); }
      }
    }
    function snapFor(s) {
      if (s.iso === 'rc' || !s.block) return takeSnap();
      if (!s.snap) { s.snap = takeSnap(); if (s.rec) s.rec.snap = s.snap; }
      return s.snap;
    }

    /* Finish a transaction: commit or abort, release locks, wake waiters. */
    function finish(s, commit) {
      var x = s.xid;
      if (x) {
        S.status[x] = commit ? 'committed' : 'aborted';
        if (s.rec) s.rec.status = S.status[x];
        Object.keys(S.locks).forEach(function (r) { if (S.locks[r] === x) delete S.locks[r]; });
      }
      s.xid = null; s.block = false; s.implicit = false; s.aborted = false; s.snap = null; s.lastRead = {}; s.rec = null;
      if (x) wake(x);
    }
    /* Error inside a transaction: PostgreSQL aborts it immediately (locks are
       released) but an explicit block stays in "aborted" state until ROLLBACK. */
    function fail(s, sql, msg) {
      var x = s.xid, wasBlock = s.block;
      log(s.name, sql, 'ERROR:  ' + msg, 'err');
      if (x) {
        S.status[x] = 'aborted';
        if (s.rec) s.rec.status = 'aborted';
        Object.keys(S.locks).forEach(function (r) { if (S.locks[r] === x) delete S.locks[r]; });
      }
      s.waiting = null;
      if (wasBlock) { s.aborted = true; s.result = { err: msg }; }
      else { s.xid = null; s.implicit = false; s.snap = null; s.result = { err: msg }; }
      if (x) wake(x);
    }
    function wake(x) {
      ['A', 'B'].forEach(function (n) {
        var w = S.sess[n];
        if (w.waiting && w.waiting.on === x) {
          var op = w.waiting.op, row = w.waiting.row, snap = w.waiting.snap;
          w.waiting = null;
          log(w.name, '', 'lock acquired — transaction ' + x + ' ' + S.status[x] + ', statement resumes', 'info');
          run(w, op, row, snap);
        }
      });
    }

    function sqlText(op, row, s) {
      if (op === 'update') return 'UPDATE accounts SET balance = balance - 10 WHERE id = ' + row + ';';
      if (op === 'appset') {
        var base = s.lastRead[row];
        return 'UPDATE accounts SET balance = ' + (base != null ? base - 10 : '?') + ' WHERE id = ' + row + ';  -- app computed';
      }
      if (op === 'forupdate') return 'SELECT * FROM accounts WHERE id = ' + row + ' FOR UPDATE;';
      if (op === 'select') return 'SELECT * FROM accounts;';
      if (op === 'begin') return 'BEGIN ISOLATION LEVEL ' + ISO[s.iso] + ';';
      return op.toUpperCase() + ';';
    }

    function run(s, op, row, savedSnap) {
      var sql = sqlText(op, row, s);
      if (s.waiting) return;
      if (op === 'begin') {
        if (s.block) { log(s.name, sql, 'WARNING:  there is already a transaction in progress', 'warn'); return; }
        s.block = true; s.result = null; log(s.name, sql, 'BEGIN'); return;
      }
      if (op === 'commit' || op === 'rollback') {
        if (!s.block) { log(s.name, sql, 'WARNING:  there is no transaction in progress', 'warn'); return; }
        if (s.aborted) { log(s.name, sql, 'ROLLBACK', 'warn'); finish(s, false); return; }
        if (op === 'commit' && s.rec && ssiConflict(s.rec)) {
          log(s.name, sql, 'ERROR:  could not serialize access due to read/write dependencies among transactions (SQLSTATE 40001)', 'err');
          s.result = { err: 'serialization failure — retry the transaction' };
          finish(s, false); return;
        }
        log(s.name, sql, op === 'commit' ? 'COMMIT' : 'ROLLBACK', op === 'commit' ? 'ok' : '');
        finish(s, op === 'commit'); return;
      }
      if (s.aborted) { log(s.name, sql, 'ERROR:  current transaction is aborted, commands ignored until end of transaction block', 'err'); return; }

      ensureXid(s);
      /* a statement resumed after a lock wait keeps the snapshot it started with */
      var snap = savedSnap || snapFor(s);

      if (op === 'select') {
        var rows = [1, 2].map(function (r) { var v = visibleVersion(r, snap, s.xid); return v ? { id: r, bal: v.bal } : null; }).filter(Boolean);
        rows.forEach(function (r) { s.lastRead[r.id] = r.bal; if (s.rec) s.rec.reads[r.id] = true; });
        s.result = { rows: rows };
        log(s.name, sql, rows.map(function (r) { return 'id ' + r.id + ' → ' + r.bal; }).join(',  '));
        autocommit(s); return;
      }
      /* UPDATE / app-side UPDATE / SELECT FOR UPDATE need the row lock */
      var holder = S.locks[row];
      if (holder && holder !== s.xid && inProgress(holder)) {
        var hs = sessByXid(holder);
        if (hs && hs.waiting && hs.xid && hs.waiting.on === s.xid) {
          fail(s, sql, 'deadlock detected (SQLSTATE 40P01)\nDETAIL: Process ' + s.name + ' waits for ShareLock on transaction ' + holder + '; blocked by process ' + hs.name + '.\nProcess ' + hs.name + ' waits for ShareLock on transaction ' + s.xid + '; blocked by process ' + s.name + '.');
          return;
        }
        s.waiting = { op: op, row: row, on: holder, snap: snap };
        log(s.name, sql, 'waiting… row ' + row + ' is locked by transaction ' + holder + ' (session ' + (hs ? hs.name : '?') + ')', 'wait');
        return;
      }
      var vis = visibleVersion(row, snap, s.xid), latest = latestVersion(row);
      if (!latest) { log(s.name, sql, 'UPDATE 0'); autocommit(s); return; }
      var target = latest;
      if (vis !== latest) {
        /* the row was changed by a transaction our snapshot cannot see */
        if (s.iso !== 'rc' && s.block) {
          fail(s, sql, 'could not serialize access due to concurrent update (SQLSTATE 40001)');
          return;
        }
        /* READ COMMITTED: EvalPlanQual — use the newest committed version */
        if (savedSnap) log(s.name, '', 'READ COMMITTED re-checks the newest row version (balance ' + latest.bal + ')', 'info');
      }
      S.locks[row] = s.xid;
      if (op === 'forupdate') {
        s.lastRead[row] = target.bal;
        if (s.rec) s.rec.reads[row] = true;
        s.result = { rows: [{ id: row, bal: target.bal }] };
        log(s.name, sql, 'id ' + row + ' → ' + target.bal + '   (row now locked)');
        autocommit(s); return;
      }
      var nb = op === 'update' ? target.bal - 10 : ((s.lastRead[row] != null ? s.lastRead[row] : (vis ? vis.bal : target.bal)) - 10);
      target.xmax = s.xid;
      S.versions.push({ row: row, bal: nb, xmin: s.xid, xmax: 0 });
      if (s.rec) s.rec.writes[row] = true;
      s.result = { msg: 'UPDATE 1 (balance ' + target.bal + ' → ' + nb + ')' };
      log(s.name, sql, 'UPDATE 1   (new version: balance ' + nb + ')');
      autocommit(s);
    }
    function autocommit(s) {
      if (s.implicit && !s.waiting && s.xid) {
        if (s.rec && ssiConflict(s.rec)) { fail(s, '(autocommit)', 'could not serialize access due to read/write dependencies among transactions'); return; }
        log(s.name, '', '(autocommit) COMMIT', 'ok');
        finish(s, true);
      }
    }
    /* Simplified SSI: T conflicts if there is another concurrent serializable
       txn U (not aborted) with rw-edges in BOTH directions (T read what U
       wrote and U read what T wrote) — a dangerous structure. */
    function ssiConflict(T) {
      return S.ser.some(function (U) {
        /* first committer wins: only an already-committed partner forces abort */
        if (U === T || U.status !== 'committed') return false;
        var tSeesU = T.snap && xidVisibleIn(U.xid, T.snap), uSeesT = U.snap && xidVisibleIn(T.xid, U.snap);
        if (tSeesU || uSeesT) return false;
        var t2u = Object.keys(T.reads).some(function (r) { return U.writes[r]; });
        var u2t = Object.keys(U.reads).some(function (r) { return T.writes[r]; });
        return t2u && u2t;
      });
    }
    function xidVisibleIn(x, snap) { return x < snap.xmax && !snap.xip[x] && S.status[x] === 'committed'; }

    /* ---------------- rendering ---------------- */
    root.innerHTML = labHead('txn') +
      '<div class="viz-controls" role="group" aria-label="Scenarios"><span class="viz-label">Scenario:</span>' +
      TXN_PRESETS.map(function (p, i) { return btn('preset', esc(p.name), { val: i, cls: 'viz-chip' }); }).join('') +
      btn('clear', 'Reset (free play)') + '</div>' +
      '<div class="viz-preset" data-out="preset" aria-live="polite"></div>' +
      '<div class="viz-txn-grid">' + sessPanel('A') + '<div class="viz-txn-mid"><h4 class="viz-h4">accounts</h4><div data-out="table"></div><div data-out="wfg"></div></div>' + sessPanel('B') + '</div>' +
      '<h4 class="viz-h4">Event log</h4><div class="viz-log-wrap"><table class="viz-log"><thead><tr><th>#</th><th>Session A</th><th>Session B</th></tr></thead><tbody data-out="log"></tbody></table></div>';

    function sessPanel(n) {
      return '<section class="viz-sess" data-sess="' + n + '" aria-label="Session ' + n + '">' +
        '<header><span class="viz-sess-name">Session ' + n + '</span>' +
        '<label class="viz-field viz-field-inline"><span>Isolation</span><select class="viz-select" data-iso="' + n + '" aria-label="Isolation level for session ' + n + '">' +
        Object.keys(ISO).map(function (k) { return '<option value="' + k + '">' + ISO[k] + '</option>'; }).join('') + '</select></label></header>' +
        '<div class="viz-sess-status" data-status="' + n + '"></div>' +
        '<div class="viz-sess-btns">' +
        btn('op', 'BEGIN', { val: n + ':begin' }) + btn('op', 'SELECT *', { val: n + ':select' }) +
        '<label class="viz-field viz-field-inline"><span>row</span><select class="viz-select" data-row="' + n + '" aria-label="Row id for session ' + n + '"><option value="1">id 1</option><option value="2">id 2</option></select></label>' +
        btn('op', 'UPDATE −10', { val: n + ':update', title: 'UPDATE accounts SET balance = balance - 10 WHERE id = ?' }) +
        btn('op', 'UPDATE = read−10', { val: n + ':appset', title: 'Application computes the new balance from its last SELECT (read-modify-write)' }) +
        btn('op', 'SELECT … FOR UPDATE', { val: n + ':forupdate' }) +
        btn('op', 'COMMIT', { val: n + ':commit', cls: 'viz-btn-ok' }) + btn('op', 'ROLLBACK', { val: n + ':rollback', cls: 'viz-btn-bad' }) +
        '</div><div class="viz-sess-result" data-result="' + n + '"></div></section>';
    }
    function render() {
      ['A', 'B'].forEach(function (n) {
        var s = S.sess[n];
        var st = s.waiting ? '<span class="viz-pill viz-pill-wait">waiting for lock (txn ' + s.waiting.on + ')</span>' :
          s.aborted ? '<span class="viz-pill viz-pill-bad">aborted — ROLLBACK required</span>' :
            s.block ? '<span class="viz-pill viz-pill-on">in transaction' + (s.xid ? ' · xid ' + s.xid : '') + '</span>' :
              '<span class="viz-pill">idle (autocommit)</span>';
        st += ' <span class="viz-muted">' + ISO[s.iso] + (s.block && s.iso !== 'rc' ? (s.snap ? ' · snapshot taken' : ' · snapshot at first query') : '') + '</span>';
        $(root, '[data-status=' + n + ']').innerHTML = st;
        var panel = $(root, '[data-sess=' + n + ']');
        panel.classList.toggle('viz-waiting', !!s.waiting);
        panel.classList.toggle('viz-aborted', !!s.aborted);
        panel.classList.toggle('viz-intx', s.block && !s.aborted && !s.waiting);
        $(root, '[data-iso=' + n + ']').value = s.iso;
        $(root, '[data-iso=' + n + ']').disabled = s.block;
        $(root, '[data-row=' + n + ']').value = String(s.row);
        $$(panel, '[data-act=op]').forEach(function (b) { b.disabled = !!s.waiting || !!S.preset; });
        $(root, '[data-row=' + n + ']').disabled = !!S.preset;
        var r = s.result, rh = '';
        if (s.waiting) rh = '<div class="viz-waitbox">⏳ blocked: <code>' + esc(sqlText(s.waiting.op, s.waiting.row, s)) + '</code></div>';
        else if (r && r.err) rh = '<div class="viz-err">' + esc(r.err.split('\n')[0]) + '</div>';
        else if (r && r.rows) rh = '<table class="viz-mini"><tr><th>id</th><th>owner</th><th>balance</th></tr>' + r.rows.map(function (x) { return '<tr><td>' + x.id + '</td><td>' + NAMES[x.id] + '</td><td>' + x.bal + '</td></tr>'; }).join('') + '</table>';
        else if (r && r.msg) rh = '<div class="viz-ok">' + esc(r.msg) + '</div>';
        $(root, '[data-result=' + n + ']').innerHTML = rh;
      });
      /* tuple versions table */
      var th = '<table class="viz-mini viz-versions"><tr><th>id</th><th>balance</th><th>xmin</th><th>xmax</th><th>state</th></tr>';
      S.versions.forEach(function (v) {
        var dead = S.status[v.xmin] === 'aborted' || (v.xmax && S.status[v.xmax] === 'committed');
        var unc = S.status[v.xmin] === 'in-progress';
        var lock = S.locks[v.row] && latestVersion(v.row) === v ? S.locks[v.row] : null;
        var who = lock ? sessByXid(lock) : null;
        th += '<tr class="' + (dead ? 'viz-dead' : unc ? 'viz-unc' : '') + '"><td>' + v.row + '</td><td>' + v.bal + '</td><td>' + xidLabel(v.xmin) + '</td><td>' + (v.xmax ? xidLabel(v.xmax) : '0') + '</td><td>' +
          (dead ? 'dead' : unc ? 'uncommitted' : 'live') + (lock ? ' <span class="viz-lock" title="row lock">🔒 ' + (who ? who.name : lock) + '</span>' : '') + '</td></tr>';
      });
      $(root, '[data-out=table]').innerHTML = th + '</table>';
      /* wait-for graph */
      var A = S.sess.A, B = S.sess.B, w = '';
      if (A.waiting || B.waiting) {
        var aw = A.waiting && sessByXid(A.waiting.on) === B, bw = B.waiting && sessByXid(B.waiting.on) === A;
        w = '<svg class="viz-svg viz-wfg" viewBox="0 0 220 70" role="img" aria-label="Wait-for graph">' +
          '<g class="viz-node viz-k-accent"><rect class="viz-box" x="6" y="18" width="56" height="34" rx="8"/><text class="viz-t" x="34" y="40">A</text></g>' +
          '<g class="viz-node viz-k-accent"><rect class="viz-box" x="158" y="18" width="56" height="34" rx="8"/><text class="viz-t" x="186" y="40">B</text></g>' +
          (aw ? '<path class="viz-edge viz-e-bad viz-e-flow" d="M64,28 Q110,6 156,28"/>' + T(110, 12, 'A waits for B', 'viz-s') : '') +
          (bw ? '<path class="viz-edge viz-e-bad viz-e-flow" d="M156,44 Q110,66 64,44"/>' + T(110, 68, 'B waits for A', 'viz-s') : '') + '</svg>';
      }
      $(root, '[data-out=wfg]').innerHTML = w;
      /* log */
      $(root, '[data-out=log]').innerHTML = S.log.map(function (e) {
        var cell = '<div class="viz-logcell viz-log-' + e.kind + '">' + (e.sql ? '<code>' + esc(e.sql) + '</code>' : '') + '<div>' + esc(e.out).replace(/\n/g, '<br>') + '</div></div>';
        return '<tr><td>' + e.t + '</td><td>' + (e.who === 'A' ? cell : '') + '</td><td>' + (e.who === 'B' ? cell : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="viz-muted">Run a statement or pick a scenario.</td></tr>';
      var wrap = $(root, '.viz-log-wrap'); wrap.scrollTop = wrap.scrollHeight;
      /* preset panel */
      var pp = $(root, '[data-out=preset]');
      if (S.preset) {
        var p = S.preset, done = S.pi >= p.steps.length;
        var next = done ? null : p.steps[S.pi];
        pp.innerHTML = '<p><strong>' + esc(p.name) + ':</strong> ' + esc(p.intro) + '</p>' +
          '<div class="viz-controls">' + (done ? '' : '<span class="viz-muted">Next: session ' + next[0] + ' → <code>' + esc(sqlText(next[1], next[2] || 1, S.sess[next[0]])) + '</code></span>') +
          btn('pstep', 'Next step ▸', { cls: 'viz-btn-primary', disabled: done }) + btn('pall', 'Run all', { disabled: done }) + btn('free', 'Switch to free play') + '</div>' +
          (done ? '<div class="viz-conclusion">' + esc(p.outro) + '</div>' : '');
        pp.hidden = false;
      } else {
        pp.innerHTML = '<p class="viz-muted">Free play: use the buttons in each session. Statements outside BEGIN run in autocommit mode. Try updating the same row from both sessions.</p>';
      }
    }
    function xidLabel(x) {
      if (x === 1) return '1 (frozen)';
      var s = sessByXid(x);
      return x + (S.status[x] === 'aborted' ? ' ✗' : S.status[x] === 'in-progress' ? (s ? ' (' + s.name + ')' : '') : ' ✓');
    }
    function doStep() {
      var p = S.preset; if (!p || S.pi >= p.steps.length) return;
      var st = p.steps[S.pi++];
      var s = S.sess[st[0]];
      if (st[2]) s.row = st[2];
      run(s, st[1], st[2] || s.row);
      render();
    }
    var timer = null;
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'op') {
        var v = b.getAttribute('data-val').split(':'), s = S.sess[v[0]];
        run(s, v[1], s.row); render();
      } else if (a === 'preset') {
        if (timer) { clearInterval(timer); timer = null; }
        var p = TXN_PRESETS[+b.getAttribute('data-val')];
        reset(p.iso[0], p.iso[1]); S.preset = p; S.pi = 0; render();
        $$(root, '[data-act=preset]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      } else if (a === 'pstep') doStep();
      else if (a === 'pall') {
        if (timer) clearInterval(timer);
        timer = setInterval(function () {
          if (!root.isConnected || !S.preset || S.pi >= S.preset.steps.length) { clearInterval(timer); timer = null; return; }
          doStep();
        }, reducedMotion() ? 60 : 650);
      } else if (a === 'free') { S.preset = null; render(); $$(root, '[data-act=preset]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); }
      else if (a === 'clear') { if (timer) { clearInterval(timer); timer = null; } reset(); render(); $$(root, '[data-act=preset]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); }
    });
    root.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.hasAttribute('data-iso')) { S.sess[t.getAttribute('data-iso')].iso = t.value; render(); }
      if (t.hasAttribute('data-row')) { S.sess[t.getAttribute('data-row')].row = +t.value; }
    });
    reset('rc', 'rc'); render();
  }

  /* ------------------------------------------------------------------
     LAB: mvcc — tuple versions, snapshots and VACUUM
     Snapshots are taken at BEGIN (like REPEATABLE READ) so the effect of
     each action on visibility is easy to follow.
     ------------------------------------------------------------------ */
  function labMvcc(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-mvcc');
    var M;
    var NEWNAMES = ['dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy'];
    function reset() {
      M = { tuples: [], status: { 100: 'committed' }, nextXid: 101, msg: '', T: { T1: blank('T1'), T2: blank('T2') }, nameI: 0, vac: null };
      [['alice', 500], ['bob', 300], ['carol', 200]].forEach(function (r, i) {
        M.tuples.push({ lp: i + 1, key: r[0], val: r[1], xmin: 100, xmax: 0, next: null, unused: false });
      });
    }
    function blank(n) { return { name: n, xid: null, snap: null, target: 'alice' }; }
    function snapNow() {
      var xip = {};
      Object.keys(M.status).forEach(function (x) { if (M.status[x] === 'in-progress') xip[x] = true; });
      return { xmin: Math.min.apply(null, Object.keys(xip).map(Number).concat([M.nextXid])), xmax: M.nextXid, xip: xip };
    }
    function sees(x, snap, me) { return x === me || (M.status[x] === 'committed' && x < snap.xmax && !snap.xip[x]); }
    function visible(t, snap, me) {
      if (t.unused) return false;
      if (!sees(t.xmin, snap, me)) return false;
      if (t.xmax && M.status[t.xmax] !== 'aborted' && sees(t.xmax, snap, me)) return false;
      return true;
    }
    /* Dead to everyone? (the tuple can be removed by VACUUM) */
    function horizon() {
      /* oldest xid any running snapshot may still treat as in-progress */
      var h = M.nextXid;
      ['T1', 'T2'].forEach(function (n) {
        var t = M.T[n];
        if (t.xid) { h = Math.min(h, t.xid, t.snap.xmin); }
      });
      return h;
    }
    function tupleState(t) {
      if (t.unused) return 'unused';
      if (M.status[t.xmin] === 'aborted') return 'dead';
      if (M.status[t.xmin] === 'in-progress') return 'uncommitted';
      if (t.xmax && M.status[t.xmax] === 'committed') return t.xmax < horizon() ? 'dead' : 'recently dead';
      if (t.xmax && M.status[t.xmax] === 'in-progress') return 'being deleted';
      return 'live';
    }
    function visibleFor(n, key) {
      var t = M.T[n];
      var snap = t.xid ? t.snap : snapNow(), me = t.xid;
      return M.tuples.filter(function (x) { return visible(x, snap, me) && (!key || x.key === key); });
    }
    function act(n, a) {
      var t = M.T[n]; M.msg = '';
      if (a === 'begin') {
        if (t.xid) { M.msg = n + ' is already in a transaction.'; return; }
        t.xid = M.nextXid++; M.status[t.xid] = 'in-progress'; t.snap = snapNow();
        M.msg = n + ': BEGIN → xid ' + t.xid + ', snapshot taken (in-progress: ' + (Object.keys(t.snap.xip).filter(function (x) { return +x !== t.xid; }).join(', ') || 'none') + ').';
        return;
      }
      if (!t.xid) { M.msg = 'Press BEGIN for ' + n + ' first.'; return; }
      if (a === 'commit' || a === 'rollback') {
        M.status[t.xid] = a === 'commit' ? 'committed' : 'aborted';
        M.msg = n + ': ' + a.toUpperCase() + ' (xid ' + t.xid + ' ' + M.status[t.xid] + ' in CLOG — no tuple is touched).';
        t.xid = null; t.snap = null; return;
      }
      if (a === 'insert') {
        var name = NEWNAMES[M.nameI++ % NEWNAMES.length];
        M.tuples.push({ lp: M.tuples.length + 1, key: name, val: 100, xmin: t.xid, xmax: 0, next: null, unused: false });
        M.msg = n + ": INSERT ('" + name + "', 100) → new tuple ctid (0," + M.tuples.length + ') with xmin = ' + t.xid + '.';
        return;
      }
      var cur = visibleFor(n, t.target)[0];
      if (!cur) { M.msg = n + ': no visible row "' + t.target + '" (UPDATE 0 / DELETE 0).'; return; }
      if (cur.xmax && M.status[cur.xmax] === 'in-progress' && cur.xmax !== t.xid) {
        M.msg = n + ': row is being modified by xid ' + cur.xmax + ' — in PostgreSQL this statement would WAIT for that transaction to finish. Commit or roll it back first.'; return;
      }
      if (cur.xmax && M.status[cur.xmax] === 'committed') {
        M.msg = n + ': ERROR could not serialize access due to concurrent update — the row was changed by a transaction this snapshot cannot see (READ COMMITTED would re-check the newest version instead).'; return;
      }
      cur.xmax = t.xid;
      if (a === 'delete') { M.msg = n + ': DELETE → only sets xmax = ' + t.xid + ' on ctid (0,' + cur.lp + '). The tuple stays on the page.'; return; }
      var nt = { lp: M.tuples.length + 1, key: cur.key, val: cur.val + 50, xmin: t.xid, xmax: 0, next: null, unused: false };
      M.tuples.push(nt); cur.next = nt.lp;
      M.msg = n + ': UPDATE → old version (0,' + cur.lp + ') gets xmax = ' + t.xid + ', new version (0,' + nt.lp + ') with xmin = ' + t.xid + '; t_ctid links old → new.';
    }
    function vacuum() {
      var removed = 0, kept = 0;
      M.tuples.forEach(function (t) {
        var s = tupleState(t);
        if (s === 'dead') { t.unused = true; t.removedNow = true; removed++; }
        else if (s === 'recently dead') kept++;
      });
      M.msg = 'VACUUM: removed ' + removed + ' dead tuple' + (removed === 1 ? '' : 's') + ' (line pointers marked unused, space reusable)' +
        (kept ? '; kept ' + kept + ' “recently dead” tuple' + (kept === 1 ? '' : 's') + ' because a running snapshot may still need ' + (kept === 1 ? 'it' : 'them') + '.' : '.');
      M.vac = Date.now();
    }

    root.innerHTML = labHead('mvcc') +
      '<div class="viz-mvcc-ctl">' + mvSess('T1') + mvSess('T2') +
      '<div class="viz-sess viz-sess-vac"><header><span class="viz-sess-name">Maintenance</span></header>' + btn('vacuum', 'VACUUM accounts', { cls: 'viz-btn-primary' }) + btn('reset', 'Reset') +
      '<p class="viz-note">VACUUM removes only versions that are dead to <em>every</em> snapshot (older than the xmin horizon).</p></div></div>' +
      '<div class="viz-msgbar" data-out="msg" aria-live="polite"></div>' +
      '<div class="viz-table-scroll"><table class="viz-mini viz-mvcc-table"><thead><tr><th>ctid</th><th>name</th><th>balance</th><th>xmin</th><th>xmax</th><th>t_ctid →</th><th>state</th><th>T1 sees</th><th>T2 sees</th><th>new query sees</th></tr></thead><tbody data-out="rows"></tbody></table></div>' +
      '<div class="viz-legend"><span class="viz-lg viz-lg-live">live</span><span class="viz-lg viz-lg-unc">uncommitted</span><span class="viz-lg viz-lg-rd">recently dead</span><span class="viz-lg viz-lg-dead">dead (VACUUM can remove)</span><span class="viz-lg viz-lg-unused">unused line pointer</span></div>';

    function mvSess(n) {
      return '<div class="viz-sess" data-sess="' + n + '"><header><span class="viz-sess-name">' + n + '</span><span data-st="' + n + '"></span></header>' +
        '<div class="viz-sess-btns">' + btn('mv', 'BEGIN', { val: n + ':begin' }) + btn('mv', 'INSERT', { val: n + ':insert' }) +
        '<label class="viz-field viz-field-inline"><span>row</span><select class="viz-select" data-target="' + n + '" aria-label="Row for ' + n + '"></select></label>' +
        btn('mv', 'UPDATE +50', { val: n + ':update' }) + btn('mv', 'DELETE', { val: n + ':delete' }) +
        btn('mv', 'COMMIT', { val: n + ':commit', cls: 'viz-btn-ok' }) + btn('mv', 'ROLLBACK', { val: n + ':rollback', cls: 'viz-btn-bad' }) + '</div></div>';
    }
    function render() {
      var keys = [];
      M.tuples.forEach(function (t) { if (!t.unused && keys.indexOf(t.key) < 0) keys.push(t.key); });
      ['T1', 'T2'].forEach(function (n) {
        var t = M.T[n];
        $(root, '[data-st=' + n + ']').innerHTML = t.xid ? '<span class="viz-pill viz-pill-on">xid ' + t.xid + ' · snapshot ' + (Object.keys(t.snap.xip).filter(function (x) { return +x !== t.xid; }).length ? 'ignores ' + Object.keys(t.snap.xip).filter(function (x) { return +x !== t.xid; }).join(',') : 'sees all committed') + '</span>' : '<span class="viz-pill">idle</span>';
        var sel = $(root, '[data-target=' + n + ']');
        if (keys.indexOf(t.target) < 0) t.target = keys[0];
        sel.innerHTML = keys.map(function (k) { return '<option' + (k === t.target ? ' selected' : '') + '>' + k + '</option>'; }).join('');
        $$(root, '[data-sess=' + n + '] [data-act=mv]').forEach(function (b) {
          var a = b.getAttribute('data-val').split(':')[1];
          b.disabled = a === 'begin' ? !!t.xid : !t.xid;
        });
        $(root, '[data-sess=' + n + ']').classList.toggle('viz-intx', !!t.xid);
      });
      $(root, '[data-out=msg]').textContent = M.msg || 'Start with BEGIN in T1, then UPDATE a row and compare what T1, T2 and a new query can see.';
      var ns = snapNow();
      $(root, '[data-out=rows]').innerHTML = M.tuples.map(function (t) {
        var st = tupleState(t);
        function v(n) {
          var T_ = M.T[n];
          if (!T_.xid) return '<span class="viz-muted">–</span>';
          return visible(t, T_.snap, T_.xid) ? '<span class="viz-yes viz-yes-' + n + '">✓ visible</span>' : '<span class="viz-no">·</span>';
        }
        var cls = 'viz-st-' + st.replace(/ /g, '-') + (t.removedNow ? ' viz-just-removed' : '');
        if (t.unused) return '<tr class="' + cls + '"><td>(0,' + t.lp + ')</td><td colspan="9" class="viz-muted">unused — line pointer free for reuse</td></tr>';
        return '<tr class="' + cls + '"><td>(0,' + t.lp + ')</td><td>' + esc(t.key) + '</td><td>' + t.val + '</td><td>' + xl(t.xmin) + '</td><td>' + (t.xmax ? xl(t.xmax) : '0') + '</td><td>' + (t.next ? '(0,' + t.next + ')' : 'self') + '</td>' +
          '<td><span class="viz-state">' + st + '</span></td><td>' + v('T1') + '</td><td>' + v('T2') + '</td><td>' + (visible(t, ns, null) ? '<span class="viz-yes">✓</span>' : '<span class="viz-no">·</span>') + '</td></tr>';
      }).join('');
      M.tuples.forEach(function (t) { t.removedNow = false; });
    }
    function xl(x) {
      var st = M.status[x];
      var who = M.T.T1.xid === x ? ' T1' : M.T.T2.xid === x ? ' T2' : '';
      return '<span class="viz-xid viz-xid-' + st + '" title="' + st + '">' + x + who + (st === 'committed' ? ' ✓' : st === 'aborted' ? ' ✗' : ' …') + '</span>';
    }
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'mv') { var v = b.getAttribute('data-val').split(':'); act(v[0], v[1]); }
      else if (a === 'vacuum') vacuum();
      else if (a === 'reset') reset();
      render();
    });
    root.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.hasAttribute('data-target')) M.T[t.getAttribute('data-target')].target = t.value;
    });
    reset(); render();
  }

  /* ------------------------------------------------------------------
     LAB: shard — keys, strategies, skew and rebalancing
     ------------------------------------------------------------------ */
  var SHARD_KEYS = {
    user_id: { label: 'user_id', note: 'High cardinality and evenly spread: the textbook shard key. But per-tenant or per-country queries now fan out to every shard.' },
    country: { label: 'country', note: 'Only ~10 distinct values and very uneven (India ≈ 42% of rows). One value can never be split, so the shard holding India is hot whatever the strategy.' },
    tenant_id: { label: 'tenant_id', note: 'Keeps each tenant’s data together (great for joins and tenant isolation), but one giant tenant (“BigCorp” ≈ 38%) creates a hot shard. Large tenants may need a dedicated shard.' },
    month: { label: 'created_at (month)', note: 'Time-based keys put all new writes on the newest shard (write hotspot) and recent months are bigger. Good for archiving old data, bad for spreading load.' }
  };
  var SHARD_STRATS = {
    hash: 'Hash: shard = f(hash(key)). Spreads keys pseudo-randomly; range queries on the key must hit all shards.',
    range: 'Range: each shard owns a contiguous key range. Range scans stay local, but sequential or skewed keys pile onto one shard.',
    directory: 'Directory: a lookup table maps every key value to a shard. Most flexible (you can place big keys deliberately) but the directory itself must be stored, cached and kept highly available.'
  };
  function shardData() {
    var r = rng(2026), recs = [];
    var countries = [['India', 0.42], ['USA', 0.14], ['Brazil', 0.08], ['Germany', 0.07], ['UK', 0.06], ['Japan', 0.05], ['France', 0.05], ['Mexico', 0.05], ['Canada', 0.04], ['Australia', 0.04]];
    var mw = []; var mt = 0;
    for (var m = 0; m < 12; m++) { mt += 1 + m * 0.25; mw.push(mt); }
    function pick(list) { var u = r(), acc = 0; for (var i = 0; i < list.length; i++) { acc += list[i][1]; if (u <= acc) return list[i][0]; } return list[list.length - 1][0]; }
    for (var i = 0; i < 2000; i++) {
      var u = r() * mt, mi = 0; while (mw[mi] < u) mi++;
      recs.push({ user_id: i + 1, country: pick(countries), tenant_id: r() < 0.38 ? 7 : 1 + Math.floor(r() * 40), month: '2026-' + (mi < 9 ? '0' : '') + (mi + 1) });
    }
    return recs;
  }
  function labShard(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-shard');
    var recs = shardData();
    var st = { key: 'user_id', strat: 'hash', mode: 'mod', N: 4, assign: null, prev: null, moved: 0, ranges: null, dir: null, note: '' };

    function kv(rec) { return st.key === 'tenant_id' ? rec.tenant_id : rec[st.key]; }
    /* ordinal position of a key value for range sharding */
    var distinct = {};
    ['user_id', 'country', 'tenant_id', 'month'].forEach(function (k) {
      var s = {}; recs.forEach(function (x) { s[k === 'tenant_id' ? x.tenant_id : x[k]] = 1; });
      distinct[k] = Object.keys(s).sort(function (a, b) { return isNaN(a) ? (a < b ? -1 : a > b ? 1 : 0) : a - b; });
    });
    function ord(rec) { return distinct[st.key].indexOf(String(kv(rec))); }
    function ringLookup(h, N) {
      /* consistent hashing: 40 virtual nodes per shard on a 32-bit ring */
      var best = null, first = null;
      for (var s = 0; s < N; s++) for (var v = 0; v < 40; v++) {
        var p = fnv('shard-' + s + '#' + v);
        if (first === null || p < first.p) first = { p: p, s: s };
        if (p >= h && (best === null || p < best.p)) best = { p: p, s: s };
      }
      return (best || first).s;
    }
    function equalRanges(N) {
      var n = distinct[st.key].length, out = [];
      for (var s = 0; s < N; s++) out.push({ lo: Math.floor(s * n / N), hi: Math.floor((s + 1) * n / N) - 1, shard: s });
      return out.filter(function (x) { return x.hi >= x.lo; });
    }
    function greedyDirectory(N) {
      var sizes = {}; recs.forEach(function (x) { var k = String(kv(x)); sizes[k] = (sizes[k] || 0) + 1; });
      var keys = Object.keys(sizes).sort(function (a, b) { return sizes[b] - sizes[a]; });
      var load = []; for (var s = 0; s < N; s++) load.push(0);
      var dir = {};
      keys.forEach(function (k) { var m = load.indexOf(Math.min.apply(null, load)); dir[k] = m; load[m] += sizes[k]; });
      return { dir: dir, sizes: sizes };
    }
    function compute() {
      if (st.strat === 'hash') {
        if (st.mode === 'mod') return recs.map(function (x) { return fnv(kv(x)) % st.N; });
        return recs.map(function (x) { return ringLookup(fnv(kv(x)), st.N); });
      }
      if (st.strat === 'range') {
        return recs.map(function (x) { var o = ord(x); for (var i = 0; i < st.ranges.length; i++) if (o >= st.ranges[i].lo && o <= st.ranges[i].hi) return st.ranges[i].shard; return 0; });
      }
      return recs.map(function (x) { return st.dir.dir[String(kv(x))]; });
    }
    function rebuild() {
      st.N = 4; st.prev = null; st.moved = 0; st.note = '';
      st.ranges = equalRanges(st.N); st.dir = greedyDirectory(st.N);
      st.assign = compute();
    }
    function counts(a, N) { var c = []; for (var i = 0; i < N; i++) c.push(0); a.forEach(function (s) { c[s]++; }); return c; }
    function addShard() {
      if (st.N >= 8) { st.note = 'Maximum of 8 shards in this lab.'; return; }
      var old = st.assign, N0 = st.N;
      st.N++;
      var ns = st.N - 1;
      if (st.strat === 'range') {
        /* split the most loaded range at its median key */
        var c = counts(old, N0);
        var order = st.ranges.slice().sort(function (a, b) { return c[b.shard] - c[a.shard]; });
        var done = false;
        for (var i = 0; i < order.length && !done; i++) {
          var rg = order[i];
          if (rg.hi > rg.lo) {
            var inR = recs.map(ord).filter(function (o) { return o >= rg.lo && o <= rg.hi; }).sort(function (a, b) { return a - b; });
            var med = inR[Math.floor(inR.length / 2)];
            if (med <= rg.lo) med = rg.lo + 1;
            st.ranges.push({ lo: med, hi: rg.hi, shard: ns }); rg.hi = med - 1; done = true;
            st.note = 'Split the busiest range of shard ' + rg.shard + ' at “' + distinct[st.key][med] + '”; only that shard’s upper half moves.';
          }
        }
        if (!done) st.note = 'No range can be split — every busy range is a single key value.';
      } else if (st.strat === 'directory') {
        /* move whole keys from overloaded shards until the new shard reaches the average */
        var load = counts(old, st.N), avg = recs.length / st.N, sizes = st.dir.sizes;
        var ks = Object.keys(st.dir.dir).sort(function (a, b) { return sizes[a] - sizes[b]; });
        ks.forEach(function (k) {
          var s = st.dir.dir[k];
          if (load[ns] + sizes[k] <= avg * 1.05 && load[s] - sizes[k] >= avg * 0.95) { st.dir.dir[k] = ns; load[s] -= sizes[k]; load[ns] += sizes[k]; }
        });
        st.note = 'Directory updated: selected keys re-pointed to the new shard; nothing else moves.';
      } else {
        st.note = st.mode === 'mod' ? 'hash % N changed from ' + N0 + ' to ' + st.N + ': most keys now map to a different shard.' : 'Consistent hashing: the new shard takes over arcs of the ring from its neighbours; only ~1/N of keys move.';
      }
      st.assign = compute();
      st.prev = old;
      st.moved = st.assign.filter(function (s, i) { return s !== old[i]; }).length;
    }

    root.innerHTML = labHead('shard') +
      '<div class="viz-controls"><span class="viz-label">Shard key:</span>' +
      Object.keys(SHARD_KEYS).map(function (k) { return btn('key', esc(SHARD_KEYS[k].label), { val: k, pressed: k === st.key, cls: 'viz-chip' }); }).join('') + '</div>' +
      '<div class="viz-controls"><span class="viz-label">Strategy:</span>' +
      ['hash', 'range', 'directory'].map(function (k) { return btn('strat', k, { val: k, pressed: k === st.strat, cls: 'viz-chip' }); }).join('') +
      '<span class="viz-sep"></span><span class="viz-label" data-out="hmlabel">Hashing:</span>' + btn('mode', 'hash % N', { val: 'mod', pressed: true, cls: 'viz-chip' }) + btn('mode', 'consistent hashing', { val: 'ring', pressed: false, cls: 'viz-chip' }) + '</div>' +
      '<div class="viz-controls">' + btn('add', '+ Add a shard', { cls: 'viz-btn-primary' }) + btn('reset', 'Reset to 4 shards') + '</div>' +
      '<div class="viz-stats" data-out="stats"></div>' +
      '<div class="viz-svg-wrap"><svg class="viz-svg" viewBox="0 0 720 300" data-out="chart" role="img" aria-label="Rows per shard bar chart"></svg></div>' +
      '<div class="viz-callouts" data-out="notes" aria-live="polite"></div>';

    function render() {
      var N = st.N, c = counts(st.assign, N), total = recs.length, avg = total / N, max = Math.max.apply(null, c), min = Math.min.apply(null, c);
      var skew = (max - avg) / avg * 100;
      var movedPer = []; for (var s = 0; s < N; s++) movedPer.push(0);
      if (st.prev) st.assign.forEach(function (sh, i) { if (sh !== st.prev[i]) movedPer[sh]++; });
      /* top key values per shard for labels */
      var top = [];
      for (s = 0; s < N; s++) top.push({});
      recs.forEach(function (x, i) { var k = String(kv(x)); top[st.assign[i]][k] = (top[st.assign[i]][k] || 0) + 1; });
      var W = 720, H = 300, padL = 50, padB = 56, ch = H - padB - 30, bw = Math.min(90, (W - padL - 20) / N - 16), gap = (W - padL - 20 - bw * N) / N;
      var yMax = Math.max(max, avg * 1.6, 1);
      var svg = '<defs><pattern id="vzstripe" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" class="viz-stripe"/></pattern></defs>';
      [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
        var y = 30 + ch - f * ch, v = Math.round(f * yMax);
        svg += '<line class="viz-grid" x1="' + padL + '" x2="' + (W - 10) + '" y1="' + y + '" y2="' + y + '"/>' + T(padL - 8, y + 4, String(v), 'viz-s viz-tick', 'end');
      });
      for (s = 0; s < N; s++) {
        var x = padL + gap / 2 + s * (bw + gap), h = c[s] / yMax * ch, y = 30 + ch - h;
        var hot = c[s] > avg * 1.5;
        var mh = movedPer[s] / yMax * ch;
        var tk = Object.keys(top[s]).sort(function (a, b) { return top[s][b] - top[s][a]; });
        var lbl = st.key === 'user_id' ? tk.length + ' users' : (st.key === 'tenant_id' && tk[0] === '7' ? 'BigCorp…' : (tk[0] ? (st.key === 'tenant_id' ? 't' : '') + tk[0] + (tk.length > 1 ? ' +' + (tk.length - 1) : '') : 'empty'));
        svg += '<g class="viz-barg' + (hot ? ' viz-hotbar' : '') + '"><rect class="viz-barrect" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, 0.5) + '" rx="4"><title>Shard ' + s + ': ' + c[s] + ' rows</title></rect>' +
          (mh > 0 ? '<rect x="' + x + '" y="' + (30 + ch - mh) + '" width="' + bw + '" height="' + mh + '" fill="url(#vzstripe)" class="viz-moved"><title>' + movedPer[s] + ' rows moved here</title></rect>' : '') +
          T(x + bw / 2, y - 6, c[s] + (hot ? ' HOT' : ''), 'viz-t viz-barval') +
          T(x + bw / 2, 30 + ch + 18, 'shard ' + s, 'viz-s') + T(x + bw / 2, 30 + ch + 34, lbl, 'viz-s viz-xs') + '</g>';
      }
      var ay = 30 + ch - avg / yMax * ch;
      svg += '<line class="viz-avg" x1="' + padL + '" x2="' + (W - 10) + '" y1="' + ay + '" y2="' + ay + '"/>' + T(W - 12, ay - 5, 'ideal ' + Math.round(avg), 'viz-s viz-avgt', 'end');
      $(root, '[data-out=chart]').innerHTML = svg;
      $(root, '[data-out=stats]').innerHTML =
        '<div class="viz-stat"><span>Shards</span><strong>' + N + '</strong></div>' +
        '<div class="viz-stat' + (skew > 50 ? ' viz-stat-bad' : skew > 15 ? ' viz-stat-warn' : ' viz-stat-ok') + '"><span>Skew (max vs ideal)</span><strong>+' + fmt(skew, 0) + '%</strong><small>max ' + max + ' · min ' + min + ' · ideal ' + Math.round(avg) + '</small></div>' +
        (st.prev ? '<div class="viz-stat' + (st.moved / total > 0.5 ? ' viz-stat-bad' : ' viz-stat-ok') + '"><span>Rows moved by last change</span><strong>' + st.moved + ' (' + fmt(st.moved / total * 100, 0) + '%)</strong><small>striped = moved data</small></div>' : '');
      var notes = '<div class="viz-callout"><strong>Key:</strong> ' + esc(SHARD_KEYS[st.key].note) + '</div>' +
        '<div class="viz-callout"><strong>Strategy:</strong> ' + esc(SHARD_STRATS[st.strat]) + '</div>';
      if (max > avg * 1.5) notes += '<div class="viz-callout viz-callout-bad"><strong>Hot shard:</strong> shard ' + c.indexOf(max) + ' holds ' + fmt(max / total * 100, 0) + '% of rows (ideal ' + fmt(100 / N, 0) + '%). It will saturate CPU/IO first and limit the whole cluster.</div>';
      if (st.key === 'month' && st.strat === 'range') notes += '<div class="viz-callout viz-callout-warn"><strong>Write hotspot:</strong> every new order lands on the shard that owns the newest month.</div>';
      if (st.note) notes += '<div class="viz-callout viz-callout-info">' + esc(st.note) + '</div>';
      $(root, '[data-out=notes]').innerHTML = notes;
      $$(root, '[data-act=key]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-val') === st.key ? 'true' : 'false'); });
      $$(root, '[data-act=strat]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-val') === st.strat ? 'true' : 'false'); });
      $$(root, '[data-act=mode]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-val') === st.mode ? 'true' : 'false'); b.disabled = st.strat !== 'hash'; });
    }
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'key') { st.key = b.getAttribute('data-val'); rebuild(); }
      else if (a === 'strat') { st.strat = b.getAttribute('data-val'); rebuild(); }
      else if (a === 'mode') { st.mode = b.getAttribute('data-val'); rebuild(); }
      else if (a === 'add') addShard();
      else if (a === 'reset') rebuild();
      render();
    });
    rebuild(); render();
  }

  /* ------------------------------------------------------------------
     LAB: vector — 2-D embeddings, distance metrics, HNSW & IVFFlat
     ------------------------------------------------------------------ */
  var VEC_TOPICS = [
    { id: 'db', name: 'Databases', ang: 30, docs: ['Tuning autovacuum', 'B-tree index internals', 'Writing faster SQL joins', 'PostgreSQL replication guide', 'Understanding MVCC', 'Partitioning large tables', 'Query planner statistics', 'Connection pooling basics'] },
    { id: 'cook', name: 'Cooking', ang: 122, docs: ['Perfect pasta carbonara', 'Easy weeknight curry', 'Sourdough for beginners', 'Spicy paneer tikka', 'Chocolate lava cake', 'Knife skills 101', 'Fresh garden salads', 'Slow-cooked dal'] },
    { id: 'sport', name: 'Sports', ang: 198, docs: ['Cricket World Cup recap', 'Football tactics explained', 'Marathon training plan', 'Tennis serve technique', 'Olympic sprint records', 'Basketball analytics', 'Yoga for athletes', 'Chess openings for club players'] },
    { id: 'travel', name: 'Travel', ang: 268, docs: ['Weekend in Paris', 'Backpacking Southeast Asia', 'Cheap flight hacks', 'Best beaches in Goa', 'Visa checklist', 'Himalayan trekking routes', 'Hotel loyalty programs', 'Train journeys in Europe'] },
    { id: 'fin', name: 'Finance', ang: 335, docs: ['Index funds vs stocks', 'Personal budgeting', 'How bank loans work', 'Tax saving tips', 'Crypto risk explained', 'Retirement planning', 'Reading a balance sheet', 'Payments and fraud detection'] }
  ];
  var VEC_WORDS = {
    postgres: 30, postgresql: 30, sql: 26, index: 36, database: 30, query: 24, vacuum: 34, table: 32, replication: 28, join: 26,
    recipe: 122, pasta: 115, bake: 128, cook: 122, cooking: 122, spicy: 118, curry: 120, dessert: 130, food: 122, dinner: 118,
    football: 198, cricket: 192, match: 196, goal: 204, olympics: 200, tennis: 194, score: 190, training: 206, sport: 198, sports: 198,
    flight: 262, hotel: 270, beach: 276, visa: 264, trip: 268, travel: 268, paris: 272, train: 258, holiday: 274,
    stock: 336, stocks: 336, bank: 330, loan: 328, invest: 340, investing: 340, tax: 332, budget: 338, crypto: 344, money: 335, payments: 322, fraud: 318
  };
  function vecDocs() {
    var r = rng(42), docs = [];
    VEC_TOPICS.forEach(function (t, ti) {
      t.docs.forEach(function (title, i) {
        var a = (t.ang + (r() - 0.5) * 30) * Math.PI / 180, rad = 0.35 + r() * 0.62;
        docs.push({ id: docs.length + 1, title: title, topic: ti, v: [Math.cos(a) * rad, Math.sin(a) * rad] });
      });
    });
    return docs;
  }
  function vdist(metric, a, b) {
    if (metric === 'l2') return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
    var dot = a[0] * b[0] + a[1] * b[1];
    if (metric === 'ip') return -dot;
    var na = Math.sqrt(a[0] * a[0] + a[1] * a[1]) || 1e-9, nb = Math.sqrt(b[0] * b[0] + b[1] * b[1]) || 1e-9;
    return 1 - dot / (na * nb);
  }
  var METRICS = { cos: ['cosine distance', '<=>', 'vector_cosine_ops', '1 − cos(angle). Ignores length: only direction matters. The usual choice for text embeddings.'],
    l2: ['Euclidean (L2)', '<->', 'vector_l2_ops', 'Straight-line distance. Sensitive to vector length as well as direction.'],
    ip: ['inner product', '<#>', 'vector_ip_ops', 'pgvector returns the NEGATIVE inner product so that ORDER BY … ASC still gives the best match first. Longer vectors win — equal to cosine for normalized vectors.'] };

  function labVector(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-vector');
    var docs = vecDocs();
    var st = { q: null, qtext: 'postgres index', metric: 'cos', k: 5, mode: 'exact', ef: 8, probes: 1, matched: [] };

    /* ---- HNSW: deterministic layer assignment + neighbour lists ---- */
    var hr = rng(9), M = 4, mL = 1 / Math.log(M);
    var level = docs.map(function () { return Math.min(2, Math.floor(-Math.log(1 - hr()) * mL)); });
    if (level.indexOf(2) < 0) level[3] = 2;
    var entry = level.indexOf(2);
    function neighbours(layer) {
      var ids = docs.map(function (d, i) { return i; }).filter(function (i) { return level[i] >= layer; });
      var adj = {}; ids.forEach(function (i) { adj[i] = {}; });
      ids.forEach(function (i) {
        ids.filter(function (j) { return j !== i; })
          .sort(function (a, b) { return vdist('l2', docs[i].v, docs[a].v) - vdist('l2', docs[i].v, docs[b].v); })
          .slice(0, layer === 0 ? M : Math.min(M, ids.length - 1)).forEach(function (j) { adj[i][j] = 1; adj[j][i] = 1; });
      });
      var out = {}; Object.keys(adj).forEach(function (i) { out[i] = Object.keys(adj[i]).map(Number); });
      return { ids: ids, adj: out };
    }
    var layers = [neighbours(0), neighbours(1), neighbours(2)];
    function hnswSearch(q) {
      var d = function (i) { return vdist(st.metric, docs[i].v, q); };
      var cur = entry, hops = { 2: [cur], 1: [], 0: [] };
      for (var L = 2; L >= 1; L--) {
        if (L < 2) hops[L].push(cur);
        var improved = true;
        while (improved) {
          improved = false;
          (layers[L].adj[cur] || []).forEach(function (n) { if (d(n) < d(cur) - 1e-12) { cur = n; improved = true; } });
          if (improved) hops[L].push(cur);
        }
      }
      /* layer 0: best-first beam search with ef candidates */
      var ef = Math.max(st.ef, st.k), visited = {}, cand = [cur], best = [cur];
      visited[cur] = true; hops[0].push(cur);
      while (cand.length) {
        cand.sort(function (a, b) { return d(a) - d(b); });
        var c = cand.shift();
        best.sort(function (a, b) { return d(a) - d(b); });
        if (best.length >= ef && d(c) > d(best[best.length - 1])) break;
        layers[0].adj[c].forEach(function (n) {
          if (visited[n]) return; visited[n] = true; hops[0].push(n);
          best.sort(function (a, b) { return d(a) - d(b); });
          if (best.length < ef || d(n) < d(best[best.length - 1])) { cand.push(n); best.push(n); if (best.length > ef) { best.sort(function (a, b) { return d(a) - d(b); }); best.pop(); } }
        });
      }
      best.sort(function (a, b) { return d(a) - d(b); });
      return { result: best.slice(0, st.k), hops: hops, visited: Object.keys(visited).length };
    }
    /* ---- IVFFlat: k-means into 5 lists ---- */
    var cents = [0, 8, 16, 24, 32].map(function (i) { return docs[i].v.slice(); }), list = [];
    for (var it = 0; it < 12; it++) {
      list = docs.map(function (dd) { var b = 0; cents.forEach(function (c, ci) { if (vdist('l2', dd.v, c) < vdist('l2', dd.v, cents[b])) b = ci; }); return b; });
      cents = cents.map(function (c, ci) {
        var m = docs.filter(function (dd, i) { return list[i] === ci; });
        return m.length ? [m.reduce(function (s, x) { return s + x.v[0]; }, 0) / m.length, m.reduce(function (s, x) { return s + x.v[1]; }, 0) / m.length] : c;
      });
    }
    function ivfSearch(q) {
      var order = cents.map(function (c, i) { return i; }).sort(function (a, b) { return vdist('l2', q, cents[a]) - vdist('l2', q, cents[b]); });
      var probed = order.slice(0, st.probes);
      var cand = docs.map(function (dd, i) { return i; }).filter(function (i) { return probed.indexOf(list[i]) >= 0; });
      cand.sort(function (a, b) { return vdist(st.metric, docs[a].v, q) - vdist(st.metric, docs[b].v, q); });
      return { result: cand.slice(0, st.k), probed: probed, scanned: cand.length };
    }
    function exact(q) {
      return docs.map(function (dd, i) { return i; }).sort(function (a, b) { return vdist(st.metric, docs[a].v, q) - vdist(st.metric, docs[b].v, q); }).slice(0, st.k);
    }
    function embed(text) {
      var words = String(text).toLowerCase().match(/[a-z]+/g) || [], sx = 0, sy = 0, n = 0, matched = [];
      words.forEach(function (w) {
        var a = VEC_WORDS[w] != null ? VEC_WORDS[w] : VEC_WORDS[w.replace(/s$/, '')];
        if (a != null) { sx += Math.cos(a * Math.PI / 180) * 0.8; sy += Math.sin(a * Math.PI / 180) * 0.8; n++; matched.push(w); }
      });
      st.matched = matched;
      return n ? [sx / n, sy / n] : null;
    }

    root.innerHTML = labHead('vector') +
      '<div class="viz-controls"><label class="viz-field viz-grow"><span>Query text</span><input class="viz-input" data-in="q" value="' + esc(st.qtext) + '" aria-label="Search query text"></label>' +
      btn('search', 'Embed & search', { cls: 'viz-btn-primary' }) + '</div>' +
      '<p class="viz-note">Known words: ' + Object.keys(VEC_WORDS).slice(0, 60).filter(function (w, i) { return i % 2 === 0; }).join(', ') + ' … Or click anywhere on the plot to place the query vector. Try “bank database” to land between two clusters.</p>' +
      '<div class="viz-controls"><span class="viz-label">Metric:</span>' + Object.keys(METRICS).map(function (m) { return btn('metric', METRICS[m][0] + ' ' + METRICS[m][1], { val: m, pressed: m === st.metric, cls: 'viz-chip' }); }).join('') +
      '<label class="viz-field viz-field-inline"><span>k</span><input type="range" min="1" max="10" value="' + st.k + '" data-in="k" aria-label="Number of neighbours k"><b data-out="kv">' + st.k + '</b></label></div>' +
      '<div class="viz-controls"><span class="viz-label">Search with:</span>' +
      [['exact', 'Exact (seq scan)'], ['hnsw', 'HNSW index'], ['ivf', 'IVFFlat index']].map(function (m) { return btn('mode', m[1], { val: m[0], pressed: m[0] === st.mode, cls: 'viz-chip' }); }).join('') +
      '<label class="viz-field viz-field-inline" data-show="hnsw"><span>hnsw.ef_search</span><input type="range" min="1" max="40" value="' + st.ef + '" data-in="ef" aria-label="HNSW ef_search"><b data-out="efv">' + st.ef + '</b></label>' +
      '<label class="viz-field viz-field-inline" data-show="ivf"><span>ivfflat.probes</span><input type="range" min="1" max="5" value="' + st.probes + '" data-in="probes" aria-label="IVFFlat probes"><b data-out="pv">' + st.probes + '</b></label></div>' +
      '<div class="viz-vec-grid"><div class="viz-svg-wrap viz-vec-plot"><svg class="viz-svg" viewBox="0 0 400 400" data-out="plot" role="img" aria-label="Scatter plot of document embeddings. Click to set the query point." tabindex="0"></svg></div>' +
      '<div class="viz-vec-side"><div class="viz-legend" data-out="legend"></div><ol class="viz-results" data-out="res"></ol><div class="viz-stats" data-out="stats"></div></div></div>' +
      '<div data-out="layers"></div>' +
      '<pre class="viz-code" data-out="sql"></pre><div class="viz-callouts" data-out="explain"></div>';

    var X = function (v) { return 200 + v * 160; }, Y = function (v) { return 200 - v * 160; };
    function render() {
      var q = st.q, metric = METRICS[st.metric];
      var ex = q ? exact(q) : [], res = ex, info = null, recall = null;
      if (q && st.mode === 'hnsw') { info = hnswSearch(q); res = info.result; }
      if (q && st.mode === 'ivf') { info = ivfSearch(q); res = info.result; }
      if (q && st.mode !== 'exact') recall = res.filter(function (i) { return ex.indexOf(i) >= 0; }).length / ex.length;
      var s = '';
      /* IVF cells as a coarse background grid coloured by nearest centroid */
      if (st.mode === 'ivf') {
        for (var gx = 0; gx < 40; gx++) for (var gy = 0; gy < 40; gy++) {
          var p = [(gx * 10 + 5 - 200) / 160, (200 - (gy * 10 + 5)) / 160], b = 0;
          cents.forEach(function (c, ci) { if (vdist('l2', p, c) < vdist('l2', p, cents[b])) b = ci; });
          var probed = info && info.probed.indexOf(b) >= 0;
          s += '<rect x="' + gx * 10 + '" y="' + gy * 10 + '" width="10" height="10" class="viz-cell-bg viz-c' + b + (probed ? ' viz-probed' : '') + '"/>';
        }
      }
      s += '<line class="viz-axis" x1="0" y1="200" x2="400" y2="200"/><line class="viz-axis" x1="200" y1="0" x2="200" y2="400"/>';
      s += T(394, 194, 'dim 1', 'viz-s viz-xs', 'end') + T(206, 12, 'dim 2', 'viz-s viz-xs', 'start');
      if (st.mode === 'hnsw') {
        layers[0].ids.forEach(function (i) { layers[0].adj[i].forEach(function (j) { if (j > i) s += '<line class="viz-hnsw-edge" x1="' + X(docs[i].v[0]) + '" y1="' + Y(docs[i].v[1]) + '" x2="' + X(docs[j].v[0]) + '" y2="' + Y(docs[j].v[1]) + '"/>'; }); });
      }
      if (st.mode === 'ivf') cents.forEach(function (c, ci) {
        var cx = X(c[0]), cy = Y(c[1]);
        s += '<path class="viz-centroid" d="M' + (cx - 6) + ',' + (cy - 6) + ' L' + (cx + 6) + ',' + (cy + 6) + ' M' + (cx + 6) + ',' + (cy - 6) + ' L' + (cx - 6) + ',' + (cy + 6) + '"/>' + T(cx + 8, cy - 6, 'list ' + (ci + 1), 'viz-s viz-xs', 'start');
      });
      if (q) {
        res.forEach(function (i) { s += '<line class="viz-nn-line" x1="' + X(q[0]) + '" y1="' + Y(q[1]) + '" x2="' + X(docs[i].v[0]) + '" y2="' + Y(docs[i].v[1]) + '"/>'; });
        if (st.metric === 'cos') s += '<line class="viz-ray" x1="200" y1="200" x2="' + X(q[0] * 1.6) + '" y2="' + Y(q[1] * 1.6) + '"/>';
      }
      docs.forEach(function (dd, i) {
        var inRes = res.indexOf(i) >= 0, missed = q && st.mode !== 'exact' && ex.indexOf(i) >= 0 && !inRes;
        var vis = st.mode === 'hnsw' && info && info.hops[0].indexOf(i) >= 0;
        s += '<circle class="viz-pt viz-c' + dd.topic + (inRes ? ' viz-pt-hit' : '') + (vis ? ' viz-pt-visited' : '') + '" cx="' + X(dd.v[0]) + '" cy="' + Y(dd.v[1]) + '" r="' + (inRes ? 7 : 5) + '"><title>' + esc(dd.title) + '</title></circle>';
        if (missed) s += '<circle class="viz-missed" cx="' + X(dd.v[0]) + '" cy="' + Y(dd.v[1]) + '" r="11"><title>Missed true neighbour: ' + esc(dd.title) + '</title></circle>';
      });
      if (q) s += '<path class="viz-query" d="M' + X(q[0]) + ',' + (Y(q[1]) - 10) + ' L' + (X(q[0]) + 9) + ',' + Y(q[1]) + ' L' + X(q[0]) + ',' + (Y(q[1]) + 10) + ' L' + (X(q[0]) - 9) + ',' + Y(q[1]) + 'z"><title>query vector</title></path>';
      $(root, '[data-out=plot]').innerHTML = s;
      $(root, '[data-out=legend]').innerHTML = VEC_TOPICS.map(function (t, i) { return '<span class="viz-lg"><i class="viz-dot viz-c' + i + '"></i>' + t.name + '</span>'; }).join('') + '<span class="viz-lg"><i class="viz-dot viz-dot-q"></i>query</span>';
      $(root, '[data-out=res]').innerHTML = q ? res.map(function (i) {
        var dd = docs[i];
        return '<li><span class="viz-dot viz-c' + dd.topic + '"></span><span class="viz-res-title">' + esc(dd.title) + '</span><code>' + vdist(st.metric, dd.v, q).toFixed(3) + '</code></li>';
      }).join('') : '<li class="viz-muted">No query vector yet — none of the words are in the toy vocabulary.</li>';
      var stats = '';
      if (q) {
        stats += '<div class="viz-stat"><span>Query vector</span><strong class="viz-mono">[' + q[0].toFixed(2) + ', ' + q[1].toFixed(2) + ']</strong>' + (st.matched.length ? '<small>from: ' + esc(st.matched.join(', ')) + '</small>' : '<small>clicked on plot</small>') + '</div>';
        stats += '<div class="viz-stat"><span>Distance computations</span><strong>' + (st.mode === 'exact' ? docs.length : st.mode === 'hnsw' ? info.visited : info.scanned) + ' / ' + docs.length + '</strong></div>';
        if (recall != null) stats += '<div class="viz-stat ' + (recall < 1 ? 'viz-stat-bad' : 'viz-stat-ok') + '"><span>Recall@' + st.k + '</span><strong>' + Math.round(recall * 100) + '%</strong><small>' + (recall < 1 ? 'red rings = missed true neighbours' : 'same as exact search') + '</small></div>';
      }
      $(root, '[data-out=stats]').innerHTML = stats;
      /* HNSW layer panels */
      var lay = '';
      if (st.mode === 'hnsw' && info) {
        lay = '<div class="viz-layers">' + [2, 1, 0].map(function (L) {
          var g = layers[L], sx = function (v) { return 100 + v * 80; }, sy = function (v) { return 100 - v * 80; };
          var t = '';
          g.ids.forEach(function (i) { g.adj[i].forEach(function (j) { if (j > i) t += '<line class="viz-hnsw-edge" x1="' + sx(docs[i].v[0]) + '" y1="' + sy(docs[i].v[1]) + '" x2="' + sx(docs[j].v[0]) + '" y2="' + sy(docs[j].v[1]) + '"/>'; }); });
          var hp = info.hops[L];
          if (L > 0) for (var h = 1; h < hp.length; h++) t += '<line class="viz-hop" x1="' + sx(docs[hp[h - 1]].v[0]) + '" y1="' + sy(docs[hp[h - 1]].v[1]) + '" x2="' + sx(docs[hp[h]].v[0]) + '" y2="' + sy(docs[hp[h]].v[1]) + '"/>';
          g.ids.forEach(function (i) { t += '<circle class="viz-pt viz-c' + docs[i].topic + (hp.indexOf(i) >= 0 ? ' viz-pt-visited' : '') + '" cx="' + sx(docs[i].v[0]) + '" cy="' + sy(docs[i].v[1]) + '" r="' + (hp.indexOf(i) >= 0 ? 4.5 : 3) + '"/>'; });
          t += '<path class="viz-query" d="M' + sx(q[0]) + ',' + (sy(q[1]) - 6) + ' l5,6 l-5,6 l-5,-6z"/>';
          return '<figure class="viz-layer"><svg class="viz-svg" viewBox="0 0 200 200" role="img" aria-label="HNSW layer ' + L + '">' + t + '</svg><figcaption>Layer ' + L + ' · ' + g.ids.length + ' nodes · ' + (L > 0 ? (hp.length - 1) + ' greedy hop' + (hp.length === 2 ? '' : 's') : hp.length + ' nodes visited (ef=' + Math.max(st.ef, st.k) + ')') + '</figcaption></figure>';
        }).join('') + '</div>';
      }
      $(root, '[data-out=layers]').innerHTML = lay;
      var lit = q ? "'[" + q[0].toFixed(3) + ',' + q[1].toFixed(3) + "]'" : '$1';
      var pre = st.mode === 'hnsw' ? 'CREATE INDEX ON docs USING hnsw (embedding ' + metric[2] + ') WITH (m = 4, ef_construction = 64);\nSET hnsw.ef_search = ' + st.ef + ';\n' :
        st.mode === 'ivf' ? 'CREATE INDEX ON docs USING ivfflat (embedding ' + metric[2] + ') WITH (lists = 5);\nSET ivfflat.probes = ' + st.probes + ';\n' : '-- no index: exact scan of all rows\n';
      $(root, '[data-out=sql]').textContent = pre + 'SELECT title, embedding ' + metric[1] + ' ' + lit + ' AS distance\nFROM docs\nORDER BY embedding ' + metric[1] + ' ' + lit + '\nLIMIT ' + st.k + ';';
      var exp = '<div class="viz-callout"><strong>' + esc(metric[0]) + ' (' + esc(metric[1]) + '):</strong> ' + esc(metric[3]) + '</div>';
      if (st.mode === 'hnsw') exp += '<div class="viz-callout viz-callout-info"><strong>HNSW:</strong> start at the entry point on the sparse top layer, greedily hop to whichever neighbour is closer to the query, drop a layer and repeat; on layer 0 keep the best ef_search candidates. Higher ef_search = better recall, slower queries. Builds slower and uses more memory than IVFFlat, but needs no training data.</div>';
      if (st.mode === 'ivf') exp += '<div class="viz-callout viz-callout-info"><strong>IVFFlat:</strong> k-means splits vectors into lists (coloured cells, × = centroids). A query scans only the ' + st.probes + ' list' + (st.probes > 1 ? 's' : '') + ' whose centroid is nearest. Neighbours just across a cell border are missed when probes is low — raise probes (or lists ≈ rows/1000) to trade speed for recall. Build the index after loading data.</div>';
      $(root, '[data-out=explain]').innerHTML = exp;
      $$(root, '[data-show]').forEach(function (x) { x.hidden = x.getAttribute('data-show') !== st.mode; });
      $$(root, '[data-act=metric]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-val') === st.metric ? 'true' : 'false'); });
      $$(root, '[data-act=mode]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-val') === st.mode ? 'true' : 'false'); });
    }
    function search() { st.qtext = $(root, '[data-in=q]').value; st.q = embed(st.qtext); render(); }
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (b) {
        var a = b.getAttribute('data-act');
        if (a === 'search') search();
        else if (a === 'metric') { st.metric = b.getAttribute('data-val'); render(); }
        else if (a === 'mode') { st.mode = b.getAttribute('data-val'); render(); }
        return;
      }
      var svg = ev.target.closest('[data-out=plot]');
      if (svg) {
        var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
        var m = svg.getScreenCTM(); if (!m) return;
        var loc = pt.matrixTransform(m.inverse());
        st.q = [(loc.x - 200) / 160, (200 - loc.y) / 160]; st.matched = [];
        render();
      }
    });
    $(root, '[data-out=plot]').addEventListener('keydown', function (ev) {
      /* keyboard: arrow keys nudge the query point */
      var d = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[ev.key];
      if (!d) return;
      ev.preventDefault();
      st.q = st.q || [0, 0]; st.q = [clamp(st.q[0] + d[0], -1.2, 1.2), clamp(st.q[1] + d[1], -1.2, 1.2)]; st.matched = [];
      render();
    });
    root.addEventListener('input', function (ev) {
      var t = ev.target, k = t.getAttribute('data-in');
      if (k === 'k') { st.k = +t.value; $(root, '[data-out=kv]').textContent = st.k; render(); }
      else if (k === 'ef') { st.ef = +t.value; $(root, '[data-out=efv]').textContent = st.ef; render(); }
      else if (k === 'probes') { st.probes = +t.value; $(root, '[data-out=pv]').textContent = st.probes; render(); }
    });
    $(root, '[data-in=q]').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') search(); });
    search();
  }

  /* ------------------------------------------------------------------
     LAB: security — roles, GRANTs, schema USAGE, RLS, pg_hba.conf
     ------------------------------------------------------------------ */
  var SEC_TABLES = [
    { id: 'orders', schema: 'app', name: 'app.orders', tenant: true },
    { id: 'customers', schema: 'app', name: 'app.customers', tenant: true },
    { id: 'audit', schema: 'app', name: 'app.audit_log', tenant: false },
    { id: 'sales', schema: 'reporting', name: 'reporting.daily_sales', tenant: false }
  ];
  var SEC_LEVELS = [['none', '—', []], ['r', 'SELECT', ['S']], ['rw', 'SELECT, INSERT, UPDATE', ['S', 'I', 'U']], ['rwd', 'ALL DML (+DELETE)', ['S', 'I', 'U', 'D']]];
  var SEC_ORDERS = [[1001, 1, 'Acme', 250], [1002, 2, 'Globex', 80], [1003, 1, 'Acme', 120], [1004, 2, 'Globex', 60], [1005, 1, 'Acme', 45], [1006, 3, 'Initech', 300]];
  var HBA_SAMPLES = [
    'hostssl  appdb  app_rw  10.0.0.0/16  scram-sha-256',
    'local    all    postgres             peer',
    'host     all    all     0.0.0.0/0    trust',
    'hostssl  all    +admins 192.168.1.0/24 cert clientcert=verify-full',
    'host     replication replicator 10.0.5.12/32 scram-sha-256',
    'host     all    all     ::1/128      md5',
    'host     all    all     0.0.0.0/0    reject'
  ];
  function labSecurity(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-security');
    var st = {
      grants: { app_rw: { orders: 'rwd', customers: 'rw', audit: 'none', sales: 'none' },
        app_ro: { orders: 'r', customers: 'r', audit: 'none', sales: 'none' },
        analyst: { orders: 'r', customers: 'none', audit: 'none', sales: 'r' } },
      usage: { app_rw: { app: true, reporting: false }, app_ro: { app: true, reporting: false }, analyst: { app: false, reporting: true } },
      inherit: true, rls: true, force: false, bypass: false, as: 'tenant_a', cell: null, revokePublic: true
    };
    var ROLES = [
      { id: 'app_owner', desc: 'owns schemas & tables (migrations)', login: false },
      { id: 'app_rw', desc: 'group role for the application', login: false },
      { id: 'app_ro', desc: 'read-only group role', login: false },
      { id: 'analyst', desc: 'BI / reporting login', login: true },
      { id: 'tenant_a', desc: 'app login for tenant 1 (Acme)', login: true, tenant: 1 },
      { id: 'tenant_b', desc: 'app login for tenant 2 (Globex)', login: true, tenant: 2 }
    ];
    function baseRole(r) { return (r === 'tenant_a' || r === 'tenant_b') ? (st.inherit ? 'app_rw' : null) : r; }
    /* Evaluate whether role r may perform privilege p on table t, with reasons. */
    function check(r, t, p) {
      var T_ = SEC_TABLES.filter(function (x) { return x.id === t; })[0];
      var steps = [];
      if (r === 'app_owner') {
        steps.push(['ok', 'Owner of ' + T_.schema + ' and ' + T_.name + ' — owners have all privileges.']);
        return finishRls(r, T_, p, steps);
      }
      var b = baseRole(r);
      if (!b) { steps.push(['bad', r + ' is not a member of app_rw and has no direct grants.']); return { ok: false, steps: steps }; }
      if (b !== r) steps.push(['ok', r + ' inherits privileges from app_rw (GRANT app_rw TO ' + r + ').']);
      if (!st.usage[b][T_.schema]) { steps.push(['bad', 'No USAGE on schema ' + T_.schema + ' → ERROR: permission denied for schema ' + T_.schema + '.']); return { ok: false, steps: steps }; }
      steps.push(['ok', 'USAGE on schema ' + T_.schema + '.']);
      var lv = SEC_LEVELS.filter(function (x) { return x[0] === st.grants[b][t]; })[0];
      if (lv[2].indexOf(p) < 0) { steps.push(['bad', 'No ' + PRIV[p] + ' privilege on ' + T_.name + ' → ERROR: permission denied for table ' + T_.name.split('.')[1] + '.']); return { ok: false, steps: steps }; }
      steps.push(['ok', PRIV[p] + ' granted on ' + T_.name + '.']);
      return finishRls(r, T_, p, steps);
    }
    function finishRls(r, T_, p, steps) {
      var rows = null;
      if (T_.tenant && st.rls) {
        var bypass = (r === 'app_owner' && !st.force) || (r === 'analyst' && st.bypass);
        if (bypass) { steps.push(['warn', r === 'app_owner' ? 'RLS enabled but the table owner bypasses it (no FORCE ROW LEVEL SECURITY).' : 'analyst has BYPASSRLS — policies are ignored.']); rows = 'all'; }
        else {
          var role = ROLES.filter(function (x) { return x.id === r; })[0];
          if (role.tenant) { steps.push(['ok', "Policy tenant_isolation: tenant_id = current_setting('app.tenant_id') = " + role.tenant + ' → only tenant ' + role.tenant + ' rows.']); rows = role.tenant; }
          else { steps.push(['warn', 'Policy applies but app.tenant_id is not set for ' + r + ' → the condition is NULL, so no rows match' + (p === 'I' ? ' and every INSERT fails WITH CHECK' : '') + '.']); rows = 0; }
        }
      } else if (T_.tenant) { steps.push(['warn', 'RLS disabled — every privileged role sees all tenants’ rows.']); rows = 'all'; }
      else rows = 'all';
      return { ok: true, steps: steps, rows: rows };
    }
    var PRIV = { S: 'SELECT', I: 'INSERT', U: 'UPDATE', D: 'DELETE' };

    root.innerHTML = labHead('security') +
      '<div class="viz-sec-grid"><section class="viz-panel"><h4 class="viz-h4">1 · Privileges (GRANT / REVOKE)</h4><div class="viz-table-scroll" data-out="grants"></div>' +
      '<div class="viz-toggles">' +
      tog('inherit', 'tenant_a / tenant_b are members of app_rw') + tog('rls', 'ENABLE ROW LEVEL SECURITY on app.orders, app.customers') +
      tog('force', 'FORCE ROW LEVEL SECURITY (applies to the owner too)') + tog('bypass', 'analyst has BYPASSRLS') +
      tog('revokePublic', 'REVOKE CREATE ON SCHEMA public FROM PUBLIC') + '</div></section>' +
      '<section class="viz-panel"><h4 class="viz-h4">2 · Effective access <span class="viz-muted">(click a cell for the reasoning)</span></h4><div class="viz-table-scroll" data-out="matrix"></div><div class="viz-explain" data-out="why" aria-live="polite"><span class="viz-explain-hint">Each cell shows S I U D. Green = allowed, red = denied.</span></div></section></div>' +
      '<section class="viz-panel"><h4 class="viz-h4">3 · Rows of app.orders visible to <select class="viz-select" data-in="as" aria-label="Role to preview">' + ROLES.map(function (r) { return '<option value="' + r.id + '"' + (r.id === st.as ? ' selected' : '') + '>' + r.id + '</option>'; }).join('') + '</select></h4><div data-out="rows"></div></section>' +
      '<details class="viz-details" open><summary>Generated SQL for this configuration</summary><pre class="viz-code" data-out="sql"></pre></details>' +
      '<section class="viz-panel"><h4 class="viz-h4">pg_hba.conf line explainer</h4>' +
      '<div class="viz-controls"><label class="viz-field viz-grow"><span>Line</span><input class="viz-input viz-mono" data-in="hba" value="' + esc(HBA_SAMPLES[0]) + '" aria-label="pg_hba.conf line" spellcheck="false"></label></div>' +
      '<div class="viz-controls">' + HBA_SAMPLES.map(function (s, i) { return btn('hba', 'Example ' + (i + 1), { val: i, cls: 'viz-chip', title: s }); }).join('') + '</div>' +
      '<div data-out="hbaout"></div></section>';

    function tog(k, label) { return '<label class="viz-check"><input type="checkbox" data-tog="' + k + '"' + (st[k] ? ' checked' : '') + '> <span>' + esc(label) + '</span></label>'; }
    function renderGrants() {
      var h = '<table class="viz-mini viz-grant-table"><tr><th>role</th><th>USAGE app</th><th>USAGE reporting</th>' + SEC_TABLES.map(function (t) { return '<th>' + t.name + '</th>'; }).join('') + '</tr>';
      Object.keys(st.grants).forEach(function (r) {
        h += '<tr><th scope="row">' + r + '</th>' + ['app', 'reporting'].map(function (s) { return '<td><input type="checkbox" data-usage="' + r + ':' + s + '"' + (st.usage[r][s] ? ' checked' : '') + ' aria-label="USAGE on schema ' + s + ' for ' + r + '"></td>'; }).join('') +
          SEC_TABLES.map(function (t) {
            return '<td><select class="viz-select viz-select-sm" data-grant="' + r + ':' + t.id + '" aria-label="' + r + ' privileges on ' + t.name + '">' +
              SEC_LEVELS.map(function (l) { return '<option value="' + l[0] + '"' + (st.grants[r][t.id] === l[0] ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select></td>';
          }).join('') + '</tr>';
      });
      $(root, '[data-out=grants]').innerHTML = h + '</table>';
    }
    function render() {
      var m = '<table class="viz-mini viz-matrix"><tr><th>role</th>' + SEC_TABLES.map(function (t) { return '<th>' + t.name + '</th>'; }).join('') + '</tr>';
      ROLES.forEach(function (r) {
        m += '<tr><th scope="row"><span class="viz-role">' + r.id + '</span><small>' + esc(r.desc) + '</small></th>';
        SEC_TABLES.forEach(function (t) {
          var pills = '', rowsNote = '';
          ['S', 'I', 'U', 'D'].forEach(function (p) {
            var c = check(r.id, t.id, p);
            pills += '<span class="viz-priv ' + (c.ok ? 'viz-priv-ok' : 'viz-priv-no') + '" title="' + PRIV[p] + (c.ok ? ' allowed' : ' denied') + '">' + p + '</span>';
            if (p === 'S' && c.ok && t.tenant) rowsNote = c.rows === 'all' ? 'all rows' : c.rows === 0 ? '0 rows' : 'tenant ' + c.rows + ' only';
          });
          var sel = st.cell && st.cell[0] === r.id && st.cell[1] === t.id;
          m += '<td><div class="viz-cellbtn' + (sel ? ' viz-sel' : '') + '" tabindex="0" role="button" data-cell="' + r.id + ':' + t.id + '" aria-label="Explain ' + r.id + ' on ' + t.name + '">' + pills + (rowsNote ? '<small class="viz-rows-' + (rowsNote === 'all rows' ? 'all' : rowsNote === '0 rows' ? 'none' : 'some') + '">' + rowsNote + '</small>' : '') + '</div></td>';
        });
        m += '</tr>';
      });
      $(root, '[data-out=matrix]').innerHTML = m + '</table>';
      if (st.cell) explainCell(st.cell[0], st.cell[1]);
      /* row preview */
      var c = check(st.as, 'orders', 'S');
      var rh = '';
      if (!c.ok) rh = '<div class="viz-err">' + esc(c.steps[c.steps.length - 1][1]) + '</div>';
      else {
        rh = '<table class="viz-mini"><tr><th>id</th><th>tenant_id</th><th>tenant</th><th>total</th></tr>' + SEC_ORDERS.map(function (o) {
          var vis = c.rows === 'all' || c.rows === o[1];
          return '<tr class="' + (vis ? 'viz-row-vis' : 'viz-row-hidden') + '"><td>' + o[0] + '</td><td><span class="viz-tenant-tag viz-tt-' + o[1] + '">' + o[1] + '</span></td><td>' + o[2] + '</td><td>' + o[3] + '</td></tr>';
        }).join('') + '</table><p class="viz-note">' + (c.rows === 'all' ? 'All 6 rows visible.' : c.rows === 0 ? 'Query succeeds but returns 0 rows (no matching policy).' : SEC_ORDERS.filter(function (o) { return o[1] === c.rows; }).length + ' of 6 rows visible; the rest are filtered by the policy — not an error, they simply don’t exist for this role.') + '</p>';
      }
      $(root, '[data-out=rows]').innerHTML = rh;
      $(root, '[data-out=sql]').textContent = genSql();
    }
    function explainCell(r, t) {
      var T_ = SEC_TABLES.filter(function (x) { return x.id === t; })[0];
      var h = '<div class="viz-explain-body"><strong>' + r + ' on ' + T_.name + '</strong>';
      ['S', 'I', 'U', 'D'].forEach(function (p) {
        var c = check(r, t, p);
        h += '<div class="viz-why"><span class="viz-priv ' + (c.ok ? 'viz-priv-ok' : 'viz-priv-no') + '">' + p + '</span> ' + PRIV[p] + ': <ul>' + c.steps.map(function (s) { return '<li class="viz-why-' + s[0] + '">' + esc(s[1]) + '</li>'; }).join('') + '</ul></div>';
      });
      $(root, '[data-out=why]').innerHTML = h + '</div>';
    }
    function genSql() {
      var L = [];
      L.push('-- roles (NOLOGIN group roles + LOGIN users)');
      L.push('CREATE ROLE app_owner NOLOGIN;', 'CREATE ROLE app_rw NOLOGIN;', 'CREATE ROLE app_ro NOLOGIN;');
      L.push("CREATE ROLE analyst LOGIN PASSWORD '…'" + (st.bypass ? ' BYPASSRLS' : '') + ';');
      L.push("CREATE ROLE tenant_a LOGIN PASSWORD '…';", "CREATE ROLE tenant_b LOGIN PASSWORD '…';");
      if (st.inherit) L.push('GRANT app_rw TO tenant_a, tenant_b;');
      L.push("ALTER ROLE tenant_a SET app.tenant_id = '1';", "ALTER ROLE tenant_b SET app.tenant_id = '2';");
      L.push('', '-- schemas owned by app_owner');
      L.push('CREATE SCHEMA app AUTHORIZATION app_owner;', 'CREATE SCHEMA reporting AUTHORIZATION app_owner;');
      if (st.revokePublic) L.push('REVOKE CREATE ON SCHEMA public FROM PUBLIC;  -- default since PG 15');
      L.push('REVOKE ALL ON ALL TABLES IN SCHEMA app, reporting FROM PUBLIC;');
      L.push('', '-- schema USAGE (needed before any table privilege matters)');
      Object.keys(st.usage).forEach(function (r) { ['app', 'reporting'].forEach(function (s) { if (st.usage[r][s]) L.push('GRANT USAGE ON SCHEMA ' + s + ' TO ' + r + ';'); }); });
      L.push('', '-- table privileges');
      Object.keys(st.grants).forEach(function (r) {
        SEC_TABLES.forEach(function (t) {
          var lv = st.grants[r][t.id];
          if (lv === 'none') return;
          var privs = SEC_LEVELS.filter(function (x) { return x[0] === lv; })[0][2].map(function (p) { return PRIV[p]; }).join(', ');
          L.push('GRANT ' + privs + ' ON ' + t.name + ' TO ' + r + ';');
        });
      });
      if (st.rls) {
        L.push('', '-- row-level security for tenant isolation');
        ['app.orders', 'app.customers'].forEach(function (t) {
          L.push('ALTER TABLE ' + t + ' ENABLE ROW LEVEL SECURITY;');
          if (st.force) L.push('ALTER TABLE ' + t + ' FORCE ROW LEVEL SECURITY;');
          L.push('CREATE POLICY tenant_isolation ON ' + t, "  USING      (tenant_id = current_setting('app.tenant_id', true)::int)", "  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::int);");
        });
      } else L.push('', '-- RLS disabled: ALTER TABLE app.orders DISABLE ROW LEVEL SECURITY;');
      L.push('', '-- future tables get the same grants', 'ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app', '  GRANT SELECT ON TABLES TO app_ro;');
      return L.join('\n');
    }
    function hba(line) {
      var raw = line.replace(/#.*$/, '').trim();
      if (!raw) return '<p class="viz-muted">Empty or comment line — ignored.</p>';
      var f = raw.split(/\s+/), out = [], warn = [];
      var type = f[0], i = 1;
      var TYPES = { local: 'Unix-domain socket connections only (no network).', host: 'TCP/IP, with or without SSL.', hostssl: 'TCP/IP only when SSL/TLS is used.', hostnossl: 'TCP/IP only WITHOUT SSL (for explicitly rejecting or allowing plain connections).', hostgssenc: 'TCP/IP with GSSAPI encryption.', hostnogssenc: 'TCP/IP without GSSAPI encryption.' };
      if (!TYPES[type]) return '<div class="viz-err">Unknown connection type “' + esc(type) + '”. Use local, host, hostssl, hostnossl, hostgssenc or hostnogssenc.</div>';
      out.push(['TYPE', type, TYPES[type]]);
      if (type === 'host') warn.push(['warn', '“host” also accepts unencrypted connections; prefer hostssl for remote access.']);
      var db = f[i++] || '';
      out.push(['DATABASE', db, db === 'all' ? 'Matches every database.' : db === 'replication' ? 'Special keyword: physical replication connections (pg_basebackup, standbys). It does NOT match normal databases.' : db === 'sameuser' ? 'Database with the same name as the user.' : 'Matches database(s): ' + db + '.']);
      var user = f[i++] || '';
      out.push(['USER', user, user === 'all' ? 'Matches every role.' : user[0] === '+' ? 'Any role that is a member of group role ' + user.slice(1) + '.' : 'Role(s): ' + user + '.']);
      if (type !== 'local') {
        var addr = f[i++] || '';
        var ad = 'Client address range ' + addr + '.';
        if (/^0\.0\.0\.0\/0$|^::\/0$|^all$/.test(addr)) { ad = 'ANY IPv4/IPv6 address — the whole internet if the port is reachable.'; warn.push(['warn', 'Open to every address. Restrict to your app subnets and use a firewall.']); }
        else if (/\/32$|\/128$/.test(addr)) ad = 'Exactly one host: ' + addr.split('/')[0] + '.';
        else if (/\//.test(addr)) { var bits = +addr.split('/')[1]; ad = 'CIDR range ' + addr + (addr.indexOf(':') < 0 && bits <= 32 ? ' (' + Math.pow(2, 32 - bits).toLocaleString('en-US') + ' addresses).' : '.'); }
        else if (f[i] && /^\d+\.\d+\.\d+\.\d+$/.test(f[i])) { ad = 'Address ' + addr + ' with netmask ' + f[i] + '.'; i++; }
        out.push(['ADDRESS', addr, ad]);
      }
      var method = f[i++] || '';
      var METHODS = { 'scram-sha-256': ['ok', 'Salted challenge-response password auth — the recommended password method.'], md5: ['warn', 'Legacy MD5 password hashing; deprecated — migrate to scram-sha-256 (password_encryption).'],
        password: ['bad', 'Sends the password in clear text! Only ever over SSL, better never.'], trust: ['bad', 'NO authentication: anyone matching this line connects as any role it names, including superusers.'],
        reject: ['ok', 'Explicitly refuses matching connections — useful to block a range before a broader rule.'], peer: ['ok', 'Local only: OS user name must equal the database role (or map via pg_ident.conf).'],
        ident: ['warn', 'Asks an ident server for the client OS user — rarely appropriate today.'], cert: ['ok', 'TLS client certificate authentication; the certificate CN must match the role (or a map).'],
        ldap: ['ok', 'Password verified against an LDAP server.'], gss: ['ok', 'Kerberos/GSSAPI authentication.'], radius: ['ok', 'RADIUS server authentication.'], pam: ['ok', 'Pluggable Authentication Modules.'], sspi: ['ok', 'Windows SSPI (Kerberos/NTLM).'] };
      var mm = METHODS[method];
      out.push(['METHOD', method, mm ? mm[1] : 'Unknown method.']);
      if (mm && mm[0] !== 'ok') warn.push([mm[0], mm[1]]);
      var opts = f.slice(i);
      if (opts.length) out.push(['OPTIONS', opts.join(' '), 'Method options, e.g. clientcert=verify-full (also require a valid client certificate) or map=… (pg_ident.conf mapping).']);
      return '<table class="viz-mini viz-hba"><tr><th>field</th><th>value</th><th>meaning</th></tr>' + out.map(function (r) { return '<tr><th>' + r[0] + '</th><td><code>' + esc(r[1]) + '</code></td><td>' + esc(r[2]) + '</td></tr>'; }).join('') + '</table>' +
        warn.map(function (w) { return '<div class="viz-callout viz-callout-' + (w[0] === 'bad' ? 'bad' : 'warn') + '">' + esc(w[1]) + '</div>'; }).join('') +
        '<p class="viz-note">Lines are checked top to bottom; the <strong>first</strong> line matching type, database, user and address decides — later lines are never consulted. Reload with SELECT pg_reload_conf(); and inspect with SELECT * FROM pg_hba_file_rules;</p>';
    }
    root.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.hasAttribute('data-grant')) { var g = t.getAttribute('data-grant').split(':'); st.grants[g[0]][g[1]] = t.value; }
      else if (t.hasAttribute('data-usage')) { var u = t.getAttribute('data-usage').split(':'); st.usage[u[0]][u[1]] = t.checked; }
      else if (t.hasAttribute('data-tog')) st[t.getAttribute('data-tog')] = t.checked;
      else if (t.getAttribute('data-in') === 'as') st.as = t.value;
      else return;
      render();
    });
    root.addEventListener('input', function (ev) { if (ev.target.getAttribute('data-in') === 'hba') $(root, '[data-out=hbaout]').innerHTML = hba(ev.target.value); });
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act=hba]');
      if (b) { var v = HBA_SAMPLES[+b.getAttribute('data-val')]; $(root, '[data-in=hba]').value = v; $(root, '[data-out=hbaout]').innerHTML = hba(v); }
    });
    onActivate(root, '[data-cell]', function (c) { st.cell = c.getAttribute('data-cell').split(':'); render(); var n = $(root, '[data-cell="' + st.cell.join(':') + '"]'); if (n) n.focus(); });
    renderGrants(); render();
    $(root, '[data-out=hbaout]').innerHTML = hba(HBA_SAMPLES[0]);
  }

  /* ------------------------------------------------------------------
     LAB: join — row matching visualizer
     ------------------------------------------------------------------ */
  var J_CUST = [[1, 'Asha', 'Pune'], [2, 'Ben', 'Goa'], [3, 'Chen', 'Delhi'], [4, 'Dana', 'Mumbai']];
  var J_ORD = [[101, 1, 250], [102, 1, 80], [103, 3, 120], [104, 5, 60]];
  var J_TYPES = {
    inner: ['INNER JOIN', 'SELECT c.name, o.id, o.amount\nFROM customers c\nJOIN orders o ON o.customer_id = c.id;', 'Only matching pairs. Ben and Dana (no orders) and order 104 (customer 5 does not exist) disappear. Asha appears twice because she has two orders.'],
    left: ['LEFT JOIN', 'SELECT c.name, o.id, o.amount\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id;', 'Every customer is kept. Customers without orders get NULL order columns. Order 104 has no customer and is dropped.'],
    right: ['RIGHT JOIN', 'SELECT c.name, o.id, o.amount\nFROM customers c\nRIGHT JOIN orders o ON o.customer_id = c.id;', 'Every order is kept; order 104 gets NULL customer columns. Usually written as a LEFT JOIN with the tables swapped.'],
    full: ['FULL OUTER JOIN', 'SELECT c.name, o.id, o.amount\nFROM customers c\nFULL JOIN orders o ON o.customer_id = c.id;', 'Matches plus the unmatched rows of both sides, NULL-padded. Great for reconciliation: “what exists only on one side?”'],
    cross: ['CROSS JOIN', 'SELECT c.name, o.id\nFROM customers c\nCROSS JOIN orders o;', 'Every customer paired with every order: 4 × 4 = 16 rows, no condition. Accidental cross joins (a missing ON) explode row counts.'],
    anti: ['ANTI JOIN (NOT EXISTS)', 'SELECT c.*\nFROM customers c\nWHERE NOT EXISTS (\n  SELECT 1 FROM orders o WHERE o.customer_id = c.id);', 'Customers with NO orders. EXPLAIN shows “Hash Anti Join”. Avoid NOT IN (subquery) when the subquery column can be NULL — it then returns no rows at all.'],
    semi: ['SEMI JOIN (EXISTS)', 'SELECT c.*\nFROM customers c\nWHERE EXISTS (\n  SELECT 1 FROM orders o WHERE o.customer_id = c.id);', 'Customers with at least one order — each returned once, even Asha with two orders, and no order columns. EXPLAIN shows “Hash Semi Join”.']
  };
  function labJoin(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-join');
    var st = { t: 'inner' };
    root.innerHTML = labHead('join') +
      '<div class="viz-controls" role="group" aria-label="Join type">' + Object.keys(J_TYPES).map(function (k) { return btn('jt', J_TYPES[k][0], { val: k, pressed: k === st.t, cls: 'viz-chip' }); }).join('') + '</div>' +
      '<div class="viz-svg-wrap"><svg class="viz-svg" viewBox="0 0 880 210" data-out="svg" role="img" aria-label="customers and orders tables with join lines"></svg></div>' +
      '<div class="viz-legend"><span class="viz-lg viz-lg-live">matched</span><span class="viz-lg viz-lg-unc">kept, NULL-padded</span><span class="viz-lg viz-lg-unused">excluded</span></div>' +
      '<div class="viz-grid2"><div><h4 class="viz-h4">SQL</h4><pre class="viz-code" data-out="sql"></pre><p class="viz-callout" data-out="exp"></p></div>' +
      '<div><h4 class="viz-h4">Result <span class="viz-muted" data-out="cnt"></span></h4><div class="viz-table-scroll" data-out="res"></div></div></div>';
    function compute(t) {
      var rows = [], cm = {}, om = {};
      J_CUST.forEach(function (c) {
        J_ORD.forEach(function (o) {
          var m = o[1] === c[0];
          if (t === 'cross' || m) { if (m) { cm[c[0]] = 1; om[o[0]] = 1; } }
          if (t === 'cross' || (m && ['inner', 'left', 'right', 'full'].indexOf(t) >= 0)) rows.push([c[1], o[0], o[2]]);
        });
      });
      if (t === 'cross') { cm = {}; om = {}; J_ORD.forEach(function (o) { J_CUST.forEach(function (c) { if (o[1] === c[0]) { cm[c[0]] = 1; om[o[0]] = 1; } }); }); }
      if (t === 'left' || t === 'full') J_CUST.forEach(function (c) { if (!cm[c[0]]) rows.push([c[1], null, null]); });
      if (t === 'right' || t === 'full') J_ORD.forEach(function (o) { if (!om[o[0]]) rows.push([null, o[0], o[2]]); });
      if (t === 'anti') J_CUST.forEach(function (c) { if (!cm[c[0]]) rows.push([c[0], c[1], c[2]]); });
      if (t === 'semi') J_CUST.forEach(function (c) { if (cm[c[0]]) rows.push([c[0], c[1], c[2]]); });
      return { rows: rows, cm: cm, om: om };
    }
    function render() {
      var r = compute(st.t), t = st.t;
      function cState(id) {
        if (t === 'cross') return 'm';
        if (r.cm[id]) return t === 'anti' ? 'x' : 'm';
        return (t === 'left' || t === 'full') ? 'k' : t === 'anti' ? 'k' : 'x';
      }
      function oState(id) {
        if (t === 'cross') return 'm';
        if (t === 'anti' || t === 'semi') return r.om[id] ? 'm' : 'x';
        if (r.om[id]) return 'm';
        return (t === 'right' || t === 'full') ? 'k' : 'x';
      }
      var s = T(160, 18, 'customers', 'viz-t') + T(700, 18, 'orders', 'viz-t');
      var RH = 34, y0 = 30;
      s += '<g class="viz-thead"><rect x="20" y="' + y0 + '" width="300" height="28" rx="6"/>' + T(50, y0 + 19, 'id', 'viz-s viz-mono', 'start') + T(110, y0 + 19, 'name', 'viz-s viz-mono', 'start') + T(210, y0 + 19, 'city', 'viz-s viz-mono', 'start') + '</g>';
      s += '<g class="viz-thead"><rect x="540" y="' + y0 + '" width="320" height="28" rx="6"/>' + T(570, y0 + 19, 'id', 'viz-s viz-mono', 'start') + T(650, y0 + 19, 'customer_id', 'viz-s viz-mono', 'start') + T(770, y0 + 19, 'amount', 'viz-s viz-mono', 'start') + '</g>';
      /* connector lines first, rows on top */
      J_CUST.forEach(function (c, ci) {
        J_ORD.forEach(function (o, oi) {
          var m = o[1] === c[0];
          if (!(m || t === 'cross')) return;
          var ya = y0 + 36 + ci * RH + 13, yb = y0 + 36 + oi * RH + 13;
          var cls = t === 'cross' ? 'viz-jl viz-jl-cross' : (t === 'anti' ? 'viz-jl viz-jl-dim' : 'viz-jl');
          s += '<path class="' + cls + '" d="M320,' + ya + ' C430,' + ya + ' 430,' + yb + ' 540,' + yb + '"/>';
        });
      });
      J_CUST.forEach(function (c, ci) {
        var y = y0 + 36 + ci * RH, k = cState(c[0]);
        s += '<g class="viz-jrow viz-jr-' + k + '"><rect x="20" y="' + y + '" width="300" height="26" rx="5"/>' + T(50, y + 18, String(c[0]), 'viz-s viz-mono', 'start') + T(110, y + 18, c[1], 'viz-s', 'start') + T(210, y + 18, c[2], 'viz-s', 'start') + '</g>';
      });
      J_ORD.forEach(function (o, oi) {
        var y = y0 + 36 + oi * RH, k = oState(o[0]);
        s += '<g class="viz-jrow viz-jr-' + k + '"><rect x="540" y="' + y + '" width="320" height="26" rx="5"/>' + T(570, y + 18, String(o[0]), 'viz-s viz-mono', 'start') + T(650, y + 18, String(o[1]), 'viz-s viz-mono', 'start') + T(770, y + 18, String(o[2]), 'viz-s viz-mono', 'start') + '</g>';
      });
      s += T(430, 200, t === 'cross' ? 'no condition: every pair' : 'ON o.customer_id = c.id', 'viz-s viz-mono', 'middle');
      $(root, '[data-out=svg]').innerHTML = s;
      var cols = (t === 'anti' || t === 'semi') ? ['id', 'name', 'city'] : t === 'cross' ? ['name', 'order id', 'amount'] : ['name', 'order id', 'amount'];
      $(root, '[data-out=res]').innerHTML = '<table class="viz-mini viz-jres"><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>' +
        r.rows.map(function (row) { return '<tr>' + row.map(function (v) { return v === null ? '<td class="viz-null">NULL</td>' : '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
      $(root, '[data-out=cnt]').textContent = '(' + r.rows.length + ' row' + (r.rows.length === 1 ? '' : 's') + ')';
      $(root, '[data-out=sql]').textContent = J_TYPES[t][1];
      $(root, '[data-out=exp]').textContent = J_TYPES[t][2];
      $$(root, '[data-act=jt]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-val') === t ? 'true' : 'false'); });
    }
    root.addEventListener('click', function (ev) { var b = ev.target.closest('[data-act=jt]'); if (b) { st.t = b.getAttribute('data-val'); render(); } });
    render();
  }

  /* ------------------------------------------------------------------
     LAB: partition — pruning + lifecycle
     ------------------------------------------------------------------ */
  function labPartition(el) {
    var root = freshRoot(el, 'viz-lab viz-lab-partition');
    var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function mk(y, m) { return { y: y, m: m, rows: Math.round(42000 + (y - 2026) * 24000 + m * 2100 + (m % 3) * 900) }; }
    function nm(p) { return 'orders_' + p.y + '_' + (p.m < 9 ? '0' : '') + (p.m + 1); }
    function idx(p) { return p.y * 12 + p.m; }
    function dstr(p, end) { var v = idx(p) + (end ? 1 : 0); var y = Math.floor(v / 12), m = v % 12; return y + '-' + (m < 9 ? '0' : '') + (m + 1) + '-01'; }
    var st = { parts: [], detached: [], from: null, to: null, filter: 'range', log: [] };
    for (var m = 0; m < 12; m++) st.parts.push(mk(2026, m));
    st.from = idx(st.parts[3]); st.to = idx(st.parts[5]);
    var PRESETS = [['q2', 'Q2 2026'], ['last3', 'Last 3 months'], ['day', 'Single day'], ['all', 'No date filter'], ['cust', 'WHERE customer_id = 42']];

    root.innerHTML = labHead('partition') +
      '<div class="viz-controls"><label class="viz-field viz-field-inline"><span>order_date from</span><select class="viz-select" data-in="from" aria-label="From month"></select></label>' +
      '<label class="viz-field viz-field-inline"><span>to (inclusive)</span><select class="viz-select" data-in="to" aria-label="To month"></select></label></div>' +
      '<div class="viz-controls"><span class="viz-label">Presets:</span>' + PRESETS.map(function (p) { return btn('pp', p[1], { val: p[0], cls: 'viz-chip' }); }).join('') + '</div>' +
      '<pre class="viz-code" data-out="q"></pre>' +
      '<div class="viz-stats" data-out="stats"></div>' +
      '<div class="viz-parts" data-out="parts" aria-live="polite"></div>' +
      '<div class="viz-controls">' + btn('detach', 'Detach oldest partition', { cls: 'viz-btn-primary' }) + btn('drop', 'Drop detached tables', { cls: 'viz-btn-bad' }) + btn('add', 'Add next month') + '</div>' +
      '<div data-out="detached"></div>' +
      '<div class="viz-grid2"><div><h4 class="viz-h4">EXPLAIN (simplified)</h4><pre class="viz-code" data-out="plan"></pre></div><div><h4 class="viz-h4">DDL log</h4><pre class="viz-code" data-out="log"></pre></div></div>';

    function options() {
      var o = st.parts.map(function (p) { return '<option value="' + idx(p) + '">' + MN[p.m] + ' ' + p.y + '</option>'; }).join('');
      var f = $(root, '[data-in=from]'), t = $(root, '[data-in=to]');
      f.innerHTML = o; t.innerHTML = o;
      if (st.from != null) f.value = String(st.from);
      if (st.to != null) t.value = String(st.to);
    }
    function scanned(p) {
      if (st.filter === 'all' || st.filter === 'cust') return true;
      return idx(p) >= st.from && idx(p) <= st.to;
    }
    function render() {
      if (st.parts.length) {
        var lo = idx(st.parts[0]), hi = idx(st.parts[st.parts.length - 1]);
        if (st.from == null || st.from < lo) st.from = lo;
        if (st.to == null || st.to > hi) st.to = hi;
        if (st.from > hi) st.from = hi;
        if (st.to < st.from) st.to = st.from;
      }
      options();
      var where;
      var fp = st.parts.filter(function (p) { return idx(p) === st.from; })[0], tp = st.parts.filter(function (p) { return idx(p) === st.to; })[0];
      if (st.filter === 'all') where = '-- no WHERE clause on order_date';
      else if (st.filter === 'cust') where = 'WHERE customer_id = 42   -- not the partition key';
      else if (st.filter === 'day') where = "WHERE order_date >= '" + dstr(fp).slice(0, 8) + "15' AND order_date < '" + dstr(fp).slice(0, 8) + "16'";
      else where = "WHERE order_date >= '" + (fp ? dstr(fp) : '?') + "' AND order_date < '" + (tp ? dstr(tp, true) : '?') + "'";
      $(root, '[data-out=q]').textContent = 'SELECT count(*), sum(total_amount)\nFROM orders\n' + where + ';';
      var sc = st.parts.filter(scanned), total = 0, scRows = 0;
      st.parts.forEach(function (p) { total += p.rows; if (scanned(p)) scRows += p.rows; });
      $(root, '[data-out=parts]').innerHTML = st.parts.map(function (p) {
        var s = scanned(p);
        return '<div class="viz-part ' + (s ? 'viz-part-scan' : 'viz-part-pruned') + '" title="' + nm(p) + ': FOR VALUES FROM (\'' + dstr(p) + '\') TO (\'' + dstr(p, true) + '\')"><strong>' + MN[p.m] + ' ' + p.y + '</strong><span class="viz-mono">' + nm(p) + '</span><small>' + fmt(p.rows, 0) + ' rows</small><em>' + (s ? 'scanned' : 'pruned') + '</em></div>';
      }).join('') || '<p class="viz-muted">No partitions left — add one.</p>';
      $(root, '[data-out=stats]').innerHTML =
        '<div class="viz-stat ' + (sc.length === st.parts.length && st.parts.length > 1 ? 'viz-stat-bad' : 'viz-stat-ok') + '"><span>Partitions scanned</span><strong>' + sc.length + ' of ' + st.parts.length + '</strong></div>' +
        '<div class="viz-stat"><span>Rows read</span><strong>' + fmt(st.filter === 'day' ? Math.round(scRows / 30) : scRows, 0) + '</strong><small>of ' + fmt(total, 0) + (st.filter === 'day' ? ' (≈ one day via index inside the partition)' : '') + '</small></div>' +
        (st.filter === 'cust' ? '<div class="viz-stat viz-stat-warn"><span>Pruning</span><strong>impossible</strong><small>filter is not on the partition key</small></div>' : '');
      var lines = ['Aggregate'];
      if (sc.length > 1) lines.push('  ->  Append');
      sc.forEach(function (p) {
        var ind = sc.length > 1 ? '        ->  ' : '  ->  ';
        lines.push(ind + (st.filter === 'cust' ? 'Index Scan using ' + nm(p) + '_customer_id_idx on ' + nm(p) : 'Seq Scan on ' + nm(p)));
        if (st.filter !== 'all' && st.filter !== 'cust') lines.push(ind.replace('->', '  ') + '    Filter: (order_date >= … AND order_date < …)');
      });
      if (!sc.length) lines.push('  ->  Result  (One-Time Filter: false)');
      $(root, '[data-out=plan]').textContent = lines.join('\n') + '\n\n-- ' + (st.parts.length - sc.length) + ' partition(s) pruned at plan time (they do not appear at all)';
      $(root, '[data-out=detached]').innerHTML = st.detached.length ? '<p class="viz-note"><strong>Detached (standalone tables, data still on disk — archive them, then drop):</strong> ' + st.detached.map(function (p) { return '<code>' + nm(p) + '</code>'; }).join(' ') + '</p>' : '';
      $(root, '[data-out=log]').textContent = st.log.length ? st.log.join('\n') : "CREATE TABLE orders (… order_date timestamptz NOT NULL …)\n  PARTITION BY RANGE (order_date);\n-- one partition per month, e.g.\nCREATE TABLE orders_2026_01 PARTITION OF orders\n  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');";
      $$(root, '[data-act=pp]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-val') === st.preset ? 'true' : 'false'); });
    }
    root.addEventListener('change', function (ev) {
      var k = ev.target.getAttribute('data-in');
      if (k === 'from') st.from = +ev.target.value;
      else if (k === 'to') st.to = +ev.target.value;
      else return;
      if (st.to < st.from) { if (k === 'from') st.to = st.from; else st.from = st.to; }
      st.filter = 'range'; st.preset = null; render();
    });
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'pp') {
        var v = b.getAttribute('data-val'); st.preset = v;
        var parts = st.parts, n = parts.length;
        if (!n) return;
        if (v === 'q2') { var q = parts.filter(function (p) { return p.y === 2026 && p.m >= 3 && p.m <= 5; }); if (q.length) { st.from = idx(q[0]); st.to = idx(q[q.length - 1]); } st.filter = 'range'; }
        else if (v === 'last3') { st.from = idx(parts[Math.max(0, n - 3)]); st.to = idx(parts[n - 1]); st.filter = 'range'; }
        else if (v === 'day') { var mid = parts[Math.min(2, n - 1)]; st.from = st.to = idx(mid); st.filter = 'day'; }
        else st.filter = v;
      } else if (a === 'detach') {
        if (!st.parts.length) return;
        var p = st.parts.shift(); st.detached.push(p);
        st.log.push('ALTER TABLE orders DETACH PARTITION ' + nm(p) + ' CONCURRENTLY;  -- PG 14+, no long lock');
      } else if (a === 'drop') {
        if (!st.detached.length) { st.log.push('-- nothing detached yet'); }
        st.detached.forEach(function (p) { st.log.push('DROP TABLE ' + nm(p) + ';  -- instant, no DELETE, no bloat, no VACUUM'); });
        st.detached = [];
      } else if (a === 'add') {
        var last = st.parts[st.parts.length - 1] || st.detached[st.detached.length - 1] || mk(2025, 11);
        var ni = idx(last) + 1, np = mk(Math.floor(ni / 12), ni % 12);
        st.parts.push(np);
        st.log.push('CREATE TABLE ' + nm(np) + ' PARTITION OF orders\n  FOR VALUES FROM (\'' + dstr(np) + '\') TO (\'' + dstr(np, true) + '\');');
      }
      render();
    });
    render();
  }

  /* ==================================================================
     Public API
     ================================================================== */
  var LAB_FN = { btree: labBtree, plan: labPlan, index: labIndex, txn: labTxn, mvcc: labMvcc, shard: labShard, vector: labVector, security: labSecurity, join: labJoin, partition: labPartition };
  var LABS = {};
  Object.keys(LAB_META).forEach(function (k) { LABS[k] = { title: LAB_META[k].title, desc: LAB_META[k].desc }; });

  function mountLab(key, el) {
    if (!el) return;
    installDelegation();
    var fn = LAB_FN[key];
    if (!fn) { el.innerHTML = '<div class="viz-lab viz-missing"><p class="viz-muted">Lab “' + esc(key) + '” is not available.</p></div>'; return; }
    try { fn(el); }
    catch (e) {
      if (window.console) console.error('[PGM.Visual] lab ' + key + ' failed:', e);
      el.innerHTML = '<div class="viz-lab viz-missing"><p class="viz-err">This lab could not start: ' + esc(e.message) + '</p></div>';
    }
  }
  function mountWidget(spec, el) {
    if (!el) return;
    var m = /^(diagram|lab):(.+)$/.exec(String(spec || '').trim());
    if (!m) { el.innerHTML = '<p class="viz-muted">Unknown widget “' + esc(spec) + '”.</p>'; return; }
    if (m[1] === 'diagram') { installDelegation(); el.innerHTML = diagram(m[2]); }
    else mountLab(m[2], el);
  }
  function bind(container) {
    /* Diagram clicks are handled by document-level delegation; this also
       mounts any [data-viz-widget] placeholders inside `container`. */
    installDelegation();
    if (container && container.querySelectorAll) {
      $$(container, '[data-viz-widget]').forEach(function (n) {
        if (n.getAttribute('data-viz-mounted')) return;
        n.setAttribute('data-viz-mounted', '1');
        mountWidget(n.getAttribute('data-viz-widget'), n);
      });
    }
    return container;
  }

  PGM.Visual = {
    DIAGRAMS: DIAGRAMS,
    LABS: LABS,
    ARCH_PAGE: ['pg-arch', 'client-server', 'process-model', 'memory', 'storage-page', 'query-pipeline', 'mvcc', 'wal',
      'btree', 'backup-pitr', 'streaming-replication', 'read-replica', 'logical-replication', 'ha', 'pgbouncer',
      'partitioning', 'sharding', 'citus', 'prod-cluster', 'multi-tenant', 'vector-db', 'rag', 'joins', 'normalization'],
    diagram: function (key) { installDelegation(); return diagram(key); },
    mountLab: mountLab,
    mountWidget: mountWidget,
    bind: bind
  };
  installDelegation();
})();
