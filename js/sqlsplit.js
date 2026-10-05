/* =====================================================================
   sqlsplit.js — splits a SQL script into individual statements.
   Understands '...' strings, E'...' escapes, "identifiers",
   dollar-quoted bodies ($$ ... $$, $fn$ ... $fn$), -- line comments
   and nested block comments. Running statements one at a time lets
   commands such as VACUUM or CREATE INDEX CONCURRENTLY work, because
   PostgreSQL wraps a multi-statement simple query in one implicit
   transaction.
   ===================================================================== */
window.PGM = window.PGM || {};
PGM.splitSQL = function (sql) {
  var out = [], cur = '', i = 0, n = sql.length;
  while (i < n) {
    var c = sql[i], c2 = sql.substr(i, 2);
    if (c2 === '--') {                                   // line comment
      var e = sql.indexOf('\n', i); if (e < 0) e = n;
      cur += sql.slice(i, e); i = e; continue;
    }
    if (c2 === '/*') {                                   // nested block comment
      var depth = 1, j = i + 2;
      while (j < n && depth) {
        if (sql.substr(j, 2) === '/*') { depth++; j += 2; }
        else if (sql.substr(j, 2) === '*/') { depth--; j += 2; }
        else j++;
      }
      cur += sql.slice(i, j); i = j; continue;
    }
    if (c === "'" ) {                                    // string literal ('' escapes)
      var esc = /[eE]$/.test(cur) && !/[A-Za-z0-9_][eE]$/.test(cur);
      var k = i + 1;
      while (k < n) {
        if (esc && sql[k] === '\\') { k += 2; continue; }
        if (sql[k] === "'") { if (sql[k + 1] === "'") { k += 2; continue; } break; }
        k++;
      }
      cur += sql.slice(i, k + 1); i = k + 1; continue;
    }
    if (c === '"') {                                     // quoted identifier
      var q = sql.indexOf('"', i + 1); if (q < 0) q = n - 1;
      cur += sql.slice(i, q + 1); i = q + 1; continue;
    }
    if (c === '$') {                                     // dollar quoting
      var m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m && !/[A-Za-z0-9_]$/.test(cur)) {
        var tag = m[0], end = sql.indexOf(tag, i + tag.length);
        if (end < 0) end = n - tag.length;
        cur += sql.slice(i, end + tag.length); i = end + tag.length; continue;
      }
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  // drop statements that are only comments
  return out.filter(function (s) {
    return s.replace(/--.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0;
  });
};
