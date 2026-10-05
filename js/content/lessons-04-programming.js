/* =====================================================================
   lessons-04-programming.js
   Modules: functions, procedures, triggers, views, materialized-views,
            extensions, jsonb, arrays, full-text-search
   All runnable examples target company_db (PostgreSQL 18 / PGlite).
   ===================================================================== */

/* ---------------------------------------------------------------------
   MODULE: functions
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'functions-sql-functions',
  module: 'functions',
  title: 'SQL Functions: CREATE FUNCTION, Return Types and Volatility',
  level: 3,
  minutes: 22,
  summary: 'Write reusable SQL-language functions that return scalars, rows or sets, and declare volatility, STRICT and PARALLEL SAFE correctly so the planner can optimise them.',
  objectives: [
    'Create SQL-language functions with CREATE [OR REPLACE] FUNCTION',
    'Choose between a scalar return, RETURNS TABLE and RETURNS SETOF',
    'Explain IMMUTABLE, STABLE and VOLATILE and how the planner uses them',
    'Use STRICT and PARALLEL SAFE deliberately rather than by accident',
    'Understand function inlining and why simple SQL functions are nearly free',
    'Use the SQL-standard body (RETURN / BEGIN ATOMIC) introduced in PostgreSQL 14'
  ],
  concept: `<p>A <strong>function</strong> is a named, stored piece of logic that takes arguments and returns a value (or a set of rows). Think of it like a <em>recipe card pinned in the kitchen</em>: instead of every cook remembering how to make the house sauce, the recipe lives in one place, everyone calls it by name, and when the chef improves it, every dish improves at once.</p>
<p>PostgreSQL functions can be written in several languages <span class="tag core">core</span>: plain <code>sql</code>, <code>plpgsql</code> (procedural, next lesson), <code>c</code>, and — via extensions — PL/Python, PL/Perl, PL/v8 and others. This lesson focuses on <strong>LANGUAGE sql</strong> functions: a body made of ordinary SQL statements, where the result of the last statement is the return value.</p>
<h4>Three shapes of return value</h4>
<ul>
<li><strong>Scalar</strong> — <code>RETURNS numeric</code>: one value per call, usable anywhere an expression is allowed (<code>SELECT</code> list, <code>WHERE</code>, index expressions).</li>
<li><strong>RETURNS TABLE (col type, ...)</strong> — a set of rows with an ad-hoc shape. Called in <code>FROM</code> like a table: <code>SELECT * FROM top_customers('India', 5)</code>.</li>
<li><strong>RETURNS SETOF some_table</strong> — a set of rows shaped exactly like an existing table or composite type. Great for "filtered views with parameters".</li>
</ul>
<h4>Volatility: a promise you make to the planner</h4>
<table>
<tr><th>Category</th><th>Promise</th><th>Examples</th><th>Planner may...</th></tr>
<tr><td><code>IMMUTABLE</code></td><td>Same inputs give the same output forever; no table reads</td><td><code>lower()</code>, arithmetic, <code>net_price(p, tax)</code></td><td>pre-evaluate at plan time, use in index expressions and generated columns</td></tr>
<tr><td><code>STABLE</code></td><td>Same output within one statement; may read tables</td><td><code>now()</code>, lookups in a config table</td><td>evaluate once per scan for index comparisons</td></tr>
<tr><td><code>VOLATILE</code> (default)</td><td>No promise; may change data or return different values each call</td><td><code>random()</code>, <code>nextval()</code>, anything that writes</td><td>must call it for every row, never inline into index conditions</td></tr>
</table>
<p><strong>STRICT</strong> (alias <code>RETURNS NULL ON NULL INPUT</code>) means "if any argument is NULL, skip the body and return NULL". <strong>PARALLEL SAFE</strong> tells the planner the function can run inside parallel worker processes; the default is <code>PARALLEL UNSAFE</code>, which silently disables parallel query for any statement that calls it.</p>
<div class="callout info">Since PostgreSQL 14 you can write a <strong>SQL-standard function body</strong>: <code>RETURN expression</code> or <code>BEGIN ATOMIC ... END</code>. Unlike a string body (<code>AS $$ ... $$</code>), it is parsed at creation time and PostgreSQL records dependencies on the tables and columns it uses, so a <code>DROP COLUMN</code> cannot silently break it.</div>`,
  why: `<p>Without functions, business rules get copy-pasted into dozens of queries, reports and microservices. When "net price = price + 18% GST, rounded to 2 decimals" changes, someone has to hunt down every copy. Functions centralise logic <em>next to the data</em>, give it a name, make it indexable (if immutable), and let you grant <code>EXECUTE</code> on a well-defined interface instead of raw table access. Set-returning functions also act as <strong>parameterised views</strong>, something plain views cannot do.</p>`,
  useCase: `<p>An Indian e-commerce company with 40 microservices computed GST-inclusive prices in Java, Python and in BI tools — three slightly different rounding rules produced invoice mismatches of a few paise on ~0.3% of 2 million monthly orders, enough to fail a GST audit. They moved the rule into one <code>IMMUTABLE</code> SQL function <code>net_price(price, tax_pct)</code>, built an expression index on <code>net_price(price, 18)</code> for the "under ₹X incl. tax" filter on the catalogue page, and exposed <code>top_customers(country, limit)</code> as a <code>RETURNS TABLE</code> function for the analytics team. Mismatches dropped to zero and the price filter went from a 600 ms sequential scan to a 4 ms index scan.</p>`,
  internals: `<p>Functions live in the catalog <code>pg_proc</code>: <code>provolatile</code> (<code>i</code>/<code>s</code>/<code>v</code>), <code>proisstrict</code>, <code>proparallel</code> (<code>s</code>/<code>r</code>/<code>u</code>), <code>prokind</code> (<code>f</code> function, <code>p</code> procedure, <code>a</code> aggregate, <code>w</code> window), <code>prosrc</code> (the body text) or <code>prosqlbody</code> (the pre-parsed standard body).</p>
<p><strong>Inlining:</strong> a scalar SQL function whose body is a single <code>SELECT</code> expression, that is not <code>SECURITY DEFINER</code>, has no <code>SET</code> clauses and whose declared volatility is not stricter than its body, is <em>inlined</em> — the planner substitutes the expression directly into the calling query. That is why <code>EXPLAIN</code> shows <code>round((price * 1.18), 2)</code> rather than <code>net_price(...)</code>, and why an index on the function expression still matches. Set-returning SQL functions that are a single <code>SELECT</code> and are <code>STABLE</code> or <code>IMMUTABLE</code> can also be inlined into <code>FROM</code>, letting outer <code>WHERE</code> clauses push down into them. PL/pgSQL functions are never inlined: they are black boxes with a default row estimate of 1000 rows (<code>ROWS</code>) and cost 100 (<code>COST</code>).</p>
<p>IMMUTABLE functions with constant arguments are <strong>constant-folded</strong> at plan time. That is a feature for arithmetic and a trap if you lie: a function marked IMMUTABLE that reads a table will have its result frozen into cached plans and expression indexes.</p>`,
  whenNot: `<p>Do not wrap a whole report query in a function just to "hide SQL" — a plain view is simpler, inlines better and is visible to tools. Avoid functions for logic that must call external services (HTTP, email): that belongs in the application or a job queue. Do not mark a function <code>IMMUTABLE</code> to "make it faster" when it reads tables, depends on <code>TimeZone</code>/<code>DateStyle</code> settings, or calls <code>now()</code>; you will get silently wrong index results. If you need transaction control (<code>COMMIT</code> in the middle), use a <strong>procedure</strong>, not a function.</p>`,
  syntax: `CREATE [ OR REPLACE ] FUNCTION name ( [ [argmode] [argname] argtype [ DEFAULT expr ] [, ...] ] )
  RETURNS rettype | RETURNS TABLE ( colname coltype [, ...] ) | RETURNS SETOF type
  LANGUAGE sql | plpgsql | ...
  [ IMMUTABLE | STABLE | VOLATILE ]
  [ CALLED ON NULL INPUT | RETURNS NULL ON NULL INPUT | STRICT ]
  [ PARALLEL { UNSAFE | RESTRICTED | SAFE } ]
  [ SECURITY INVOKER | SECURITY DEFINER ]
  [ COST n ] [ ROWS n ] [ SET config_param = value ]
  AS 'definition'                      -- string body, e.g. AS $$ SELECT ... $$
  | RETURN expression                  -- SQL-standard body (PG14+)
  | BEGIN ATOMIC statement; ... END    -- SQL-standard body (PG14+)

DROP FUNCTION [ IF EXISTS ] name ( argtypes ) [ CASCADE ];`,
  examples: [
    { label: 'Basic', title: 'A scalar STABLE function: active headcount per department',
      sql: `CREATE FUNCTION dept_headcount(p_dept_id int)
RETURNS bigint
LANGUAGE sql
STABLE                      -- reads a table, same answer within one statement
AS $$
  SELECT count(*)
  FROM employees
  WHERE department_id = p_dept_id
    AND is_active
$$;

SELECT d.name, dept_headcount(d.id) AS active_staff
FROM departments d
ORDER BY active_staff DESC;`,
      explain: `<p><code>LANGUAGE sql</code>: the body is plain SQL; the value of the last statement is returned. <code>STABLE</code> is correct because the function reads <code>employees</code> (so it cannot be IMMUTABLE) but does not modify anything. The parameter is prefixed <code>p_</code> so it can never be confused with a column name. The function is then used like any built-in, once per department row.</p>`,
      output: ` name        | active_staff
-------------+--------------
 Sales       | 25
 Marketing   | 24
 Engineering | 24
 Support     | 23
 Finance     | 23
 Research    | 22
 HR          | 22
 Operations  | 22
(8 rows)`, run: true },
    { label: 'Intermediate', title: 'RETURNS TABLE: a parameterised "view" of top customers',
      sql: `CREATE FUNCTION top_customers(p_country text, p_limit int DEFAULT 5)
RETURNS TABLE (customer_id int, customer_name text, orders bigint, revenue numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT c.id, c.name, count(o.id), sum(o.total_amount)
  FROM customers c
  JOIN orders o ON o.customer_id = c.id
  WHERE c.country = p_country
    AND o.status <> 'cancelled'
  GROUP BY c.id, c.name
  ORDER BY sum(o.total_amount) DESC
  LIMIT p_limit
$$;

SELECT * FROM top_customers('India', 5);`,
      explain: `<p><code>RETURNS TABLE (...)</code> declares the output columns; the body's final <code>SELECT</code> must produce exactly those columns, in order, with compatible types. The function is called in <code>FROM</code>, so callers can join, filter and sort its output like a table. <code>p_limit</code> has a <code>DEFAULT</code>, so <code>top_customers('India')</code> also works. A view cannot take the country as a parameter — that is the key advantage here.</p>`,
      output: ` customer_id | customer_name | orders | revenue
-------------+---------------+--------+------------
 178         | Customer 178  | 15     | 4579508.68
 424         | Customer 424  | 17     | 4475977.96
 321         | Customer 321  | 15     | 4339871.88
 418         | Customer 418  | 15     | 4192514.55
 72          | Customer 72   | 16     | 4080224.30
(5 rows)`, run: true },
    { label: 'Advanced', title: 'IMMUTABLE + PARALLEL SAFE + STRICT, inlined into an expression index',
      sql: `-- SQL-standard body (PG14+): parsed now, dependencies tracked
CREATE FUNCTION net_price(p_price numeric, p_tax_pct numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
RETURN round(p_price * (1 + p_tax_pct / 100), 2);

-- Only IMMUTABLE functions are allowed in index expressions
CREATE INDEX idx_products_net_price ON products (net_price(price, 18));

-- How the catalog records our promises
SELECT proname, provolatile, proisstrict, proparallel,
       net_price(100, 18)   AS with_tax,
       net_price(100, NULL) AS strict_null
FROM pg_proc
WHERE proname IN ('net_price', 'now', 'clock_timestamp')
ORDER BY proname;`,
      explain: `<p><code>RETURN expr</code> is the SQL-standard body. <code>IMMUTABLE</code> lets PostgreSQL use the function in <code>CREATE INDEX</code> (it refuses STABLE/VOLATILE functions there). <code>STRICT</code> short-circuits NULL input — note <code>strict_null</code> is NULL without running the body. <code>PARALLEL SAFE</code> keeps parallel plans possible. In <code>pg_proc</code>, <code>provolatile</code> shows <code>i</code>/<code>s</code>/<code>v</code> (compare <code>now()</code>, STABLE, with <code>clock_timestamp()</code>, VOLATILE) and <code>proparallel</code> shows <code>s</code> safe, <code>r</code> restricted or <code>u</code> unsafe. Because the function is inlined, a query with <code>WHERE net_price(price, 18) &gt; 90000</code> matches <code>idx_products_net_price</code>.</p>`,
      output: ` proname         | provolatile | proisstrict | proparallel | with_tax | strict_null
-----------------+-------------+-------------+-------------+----------+-------------
 clock_timestamp | v           | t           | s           | 118.00   |
 net_price       | i           | t           | s           | 118.00   |
 now             | s           | t           | s           | 118.00   |
(3 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Lies to the planner: reads a table but claims IMMUTABLE
CREATE FUNCTION dept_budget_bad(p_id int) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$ SELECT budget FROM departments WHERE id = p_id $$;

SELECT name FROM departments WHERE budget > dept_budget_bad(4);`,
      why: 'An IMMUTABLE function that reads a table may be constant-folded and cached in plans or indexes, so later budget changes are silently ignored.', run: true },
    good: { sql: `CREATE FUNCTION dept_budget(p_id int) RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT budget FROM departments WHERE id = p_id $$;

SELECT name FROM departments WHERE budget > dept_budget(4);`,
      why: 'STABLE is the honest label for a read-only lookup: still evaluated once per statement for index comparisons, but never frozen into indexes or cached plans.', run: true }
  },
  mistakes: [
    `Leaving every function at the default <code>VOLATILE PARALLEL UNSAFE</code>. The function is then re-evaluated per row and the whole query loses parallelism.`,
    `Marking a function <code>IMMUTABLE</code> when it calls <code>now()</code>, reads a table or depends on a session setting such as <code>TimeZone</code> — indexes built on it become silently wrong.`,
    `Naming parameters the same as columns (<code>email</code> vs <code>email</code>). In SQL functions the column wins, in PL/pgSQL you get an "ambiguous" error; prefix parameters (<code>p_email</code>).`,
    `Using <code>CREATE OR REPLACE</code> to change the return type or argument types — that is not allowed (or creates a new overload). Drop and recreate instead.`,
    `Calling a set-returning function in the <code>SELECT</code> list (<code>SELECT top_customers('India')</code>) and getting composite values instead of columns; call it in <code>FROM</code>.`
  ],
  best: [
    `Declare the strictest honest volatility: IMMUTABLE &gt; STABLE &gt; VOLATILE.`,
    `Add <code>PARALLEL SAFE</code> to read-only functions that do not touch temp tables, sequences or session state.`,
    `Prefer the SQL-standard body (<code>RETURN</code> / <code>BEGIN ATOMIC</code>) for SQL functions so dependencies are tracked.`,
    `Keep SQL functions to a single <code>SELECT</code> where possible so they can be inlined.`,
    `Use <code>RETURNS TABLE</code> for parameterised reports instead of building dynamic SQL in the application.`
  ],
  performance: `<p>Inlined SQL functions cost nothing extra: the planner sees the underlying expression, uses indexes and statistics normally. Non-inlined functions (PL/pgSQL, SECURITY DEFINER, functions with <code>SET</code>) are opaque: per-call overhead is small (microseconds), but for a query over 10 million rows that adds up, and the planner guesses <code>ROWS 1000</code> for set-returning functions — set <code>ROWS</code> and <code>COST</code> explicitly when you know better. A scalar function that runs its own <code>SELECT</code> per row (like <code>dept_headcount</code>) is effectively a correlated subquery: fine for 8 departments, a disaster for 5 million customers — rewrite as a join with <code>GROUP BY</code> at scale.</p>`,
  security: `<p>Functions run with the caller's privileges by default (<code>SECURITY INVOKER</code>). <code>EXECUTE</code> is granted to <code>PUBLIC</code> by default on new functions — revoke it for sensitive ones (<code>REVOKE EXECUTE ON FUNCTION f(int) FROM PUBLIC</code>) or change default privileges. <code>SECURITY DEFINER</code> functions are covered in the error-handling lesson along with <code>search_path</code> hardening.</p>`,
  scenario: { title: 'The catalogue price filter is slow and occasionally wrong', steps: [
    '1. EXPLAIN shows a Seq Scan on products with Filter: price * 1.18 > ... — no index on the expression.',
    '2. Find duplicated GST logic in three services; agree on one rounding rule.',
    '3. Create net_price(numeric, numeric) as IMMUTABLE STRICT PARALLEL SAFE with a RETURN body.',
    '4. CREATE INDEX ON products (net_price(price, 18)); confirm EXPLAIN now shows an index scan.',
    '5. Replace application-side calculations with SELECT net_price(...) or a generated column.',
    '6. Audit pg_proc for other functions with provolatile = \'i\' that read tables, and fix their labels.'
  ] },
  interview: [
    { q: 'What is the difference between IMMUTABLE, STABLE and VOLATILE?', a: 'They are promises about determinism. IMMUTABLE: same inputs always give the same result and no database access, so it can be constant-folded and used in indexes. STABLE: consistent within a single statement, may read tables (now() is STABLE). VOLATILE: may return different values per call or have side effects, so it is evaluated for every row and never optimised away.' },
    { q: 'When is a SQL function inlined, and why does it matter?', a: 'A scalar SQL function with a single SELECT expression, no SECURITY DEFINER, no SET clause, and an honest volatility is replaced by its body at plan time. That lets the planner use indexes on the underlying expression, estimate selectivity with real statistics and avoid per-call overhead. PL/pgSQL functions are never inlined.' },
    { q: 'RETURNS TABLE vs RETURNS SETOF — when do you use each?', a: 'RETURNS SETOF existing_type returns rows of an existing table or composite type, ideal when you want whole rows (SETOF employees). RETURNS TABLE(...) declares an ad-hoc result shape inline, ideal for reports and aggregates. Both are called in FROM.' },
    { q: 'Why might adding PARALLEL SAFE to a function speed up a query?', a: 'Functions default to PARALLEL UNSAFE, and a single unsafe function anywhere in a query forces a fully serial plan. Marking a pure function PARALLEL SAFE allows Gather plans with parallel workers, which can make large scans and aggregates several times faster.' }
  ],
  exercises: [
    { task: 'Create an IMMUTABLE, STRICT, PARALLEL SAFE SQL function full_name(first text, last text) that returns "First Last" and use it to list the first 5 employees.', solution: `CREATE FUNCTION full_name(p_first text, p_last text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN p_first || ' ' || p_last;

SELECT id, full_name(first_name, last_name) FROM employees ORDER BY id LIMIT 5;`, run: true },
    { task: 'Create a function active_employees_in(p_dept text) RETURNS SETOF employees that returns active employees of a department by name, then count them for Engineering.', solution: `CREATE FUNCTION active_employees_in(p_dept text)
RETURNS SETOF employees
LANGUAGE sql STABLE
AS $$
  SELECT e.*
  FROM employees e
  JOIN departments d ON d.id = e.department_id
  WHERE d.name = p_dept AND e.is_active
$$;

SELECT count(*) FROM active_employees_in('Engineering');`, run: true }
  ],
  challenge: { task: 'Write a SQL function monthly_revenue(p_year int) RETURNS TABLE(month int, revenue numeric, orders bigint), excluding cancelled orders, mark it with the correct volatility and PARALLEL SAFE, and return the 3 best months of 2025.', hint: 'Use extract(month FROM order_date)::int and GROUP BY 1. In psql you could also write the body as BEGIN ATOMIC ... END; (the in-browser runner splits statements on semicolons, so use a $$ body here).', solution: `CREATE FUNCTION monthly_revenue(p_year int)
RETURNS TABLE (month int, revenue numeric, orders bigint)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT extract(month FROM order_date)::int, sum(total_amount), count(*)
  FROM orders
  WHERE order_date >= make_date(p_year, 1, 1)
    AND order_date <  make_date(p_year + 1, 1, 1)
    AND status <> 'cancelled'
  GROUP BY 1
$$;

SELECT * FROM monthly_revenue(2025) ORDER BY revenue DESC LIMIT 3;`, run: true },
  related: ['functions-plpgsql-basics', 'functions-parameters', 'indexes', 'procedures', 'views'],
  quiz: [
    { type: 'mcq', q: 'Which volatility is required for a function used in an index expression?', options: ['VOLATILE', 'STABLE', 'IMMUTABLE', 'Any, if marked PARALLEL SAFE'], answer: 2, explain: 'Only IMMUTABLE functions are allowed in index expressions and generated columns, because the stored result must never change for the same input.' },
    { type: 'tf', q: 'now() is IMMUTABLE because it returns the same value for the whole transaction.', answer: false, explain: 'now() is STABLE: constant within a statement/transaction but different in the next one, so it cannot be IMMUTABLE.' },
    { type: 'predict', q: 'What does this return?', code: `CREATE FUNCTION add_tax(p numeric) RETURNS numeric
LANGUAGE sql STRICT RETURN p * 1.18;
SELECT add_tax(NULL) IS NULL;`, options: ['true', 'false', 'ERROR: null value', '0'], answer: 0, explain: 'STRICT functions return NULL immediately when any argument is NULL, so the IS NULL test is true.' },
    { type: 'bug', q: 'Why does this function return different results than expected after departments.budget changes?', code: `CREATE FUNCTION budget_of(p int) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$ SELECT budget FROM departments WHERE id = p $$;`, options: ['Missing STRICT', 'It reads a table yet is marked IMMUTABLE, so results can be pre-computed and cached', 'LANGUAGE sql cannot SELECT', 'Needs RETURNS SETOF'], answer: 1, explain: 'A function that reads a table must be STABLE (or VOLATILE). IMMUTABLE lets the planner constant-fold it and cache the result.' },
    { type: 'optimize', q: 'A query over 50M rows calls a pure arithmetic SQL function and never uses parallel workers. Best fix?', code: `CREATE FUNCTION margin(p numeric, c numeric) RETURNS numeric
LANGUAGE sql AS $$ SELECT p - c $$;`, options: ['Add IMMUTABLE PARALLEL SAFE', 'Rewrite in PL/pgSQL', 'Add SECURITY DEFINER', 'Increase work_mem'], answer: 0, explain: 'The default VOLATILE PARALLEL UNSAFE disables parallelism and some optimisations. A pure arithmetic function should be IMMUTABLE PARALLEL SAFE.' }
  ]
},
{
  id: 'functions-plpgsql-basics',
  module: 'functions',
  title: 'PL/pgSQL Basics: Variables, Control Flow and Loops',
  level: 3,
  minutes: 25,
  summary: 'Write procedural PL/pgSQL functions with DECLARE blocks, %TYPE/%ROWTYPE variables, IF/CASE branching, LOOP/FOR/WHILE/FOREACH iteration, and RETURN NEXT / RETURN QUERY.',
  objectives: [
    'Structure a PL/pgSQL block with DECLARE, BEGIN and END',
    'Declare variables anchored to columns and rows with %TYPE and %ROWTYPE',
    'Branch with IF/ELSIF/ELSE and CASE',
    'Iterate with LOOP, WHILE, FOR (integer and query) and FOREACH over arrays',
    'Return sets with RETURN NEXT and RETURN QUERY',
    'Recognise when a set-based SQL statement beats a loop'
  ],
  concept: `<p><strong>PL/pgSQL</strong> <span class="tag core">core</span> is PostgreSQL's built-in procedural language. Where a SQL function is a single recipe step, PL/pgSQL is a <em>full recipe with decisions</em>: "if the dough is too dry, add water; repeat kneading until smooth". It adds variables, branching, loops and error handling on top of SQL, and every SQL statement inside it runs in the same server process with no network round trip.</p>
<h4>Block structure</h4>
<ul>
<li><code>DECLARE</code> — variables, with optional <code>:=</code> default, <code>CONSTANT</code> and <code>NOT NULL</code>.</li>
<li><code>BEGIN ... END</code> — statements, each ending in <code>;</code>. Blocks can nest; an inner block can have its own <code>DECLARE</code> and <code>EXCEPTION</code>.</li>
<li><code>SELECT ... INTO var</code> stores a single-row result; add <code>STRICT</code> (<code>INTO STRICT</code>) to raise an error when zero or more than one row comes back.</li>
</ul>
<h4>Anchored types</h4>
<p><code>v_salary employees.salary%TYPE</code> takes the column's type, so changing <code>numeric(10,2)</code> to <code>numeric(12,2)</code> later does not break the function. <code>v_emp employees%ROWTYPE</code> holds a whole row; access fields as <code>v_emp.first_name</code>. <code>RECORD</code> is a shape-less row variable whose structure is set by whatever is assigned to it.</p>
<h4>Control flow</h4>
<ul>
<li><code>IF cond THEN ... ELSIF cond THEN ... ELSE ... END IF;</code></li>
<li><code>CASE x WHEN 1 THEN ... ELSE ... END CASE;</code> (statement form; raises <code>CASE_NOT_FOUND</code> if no branch matches and there is no ELSE)</li>
<li><code>LOOP ... EXIT WHEN cond; END LOOP;</code>, <code>WHILE cond LOOP ... END LOOP;</code></li>
<li><code>FOR i IN 1..10 [BY 2] LOOP</code>, <code>FOR rec IN SELECT ... LOOP</code> (uses a cursor internally, fetching rows in batches)</li>
<li><code>FOREACH x IN ARRAY arr LOOP</code> (with <code>SLICE n</code> for multi-dimensional arrays)</li>
<li><code>CONTINUE [WHEN cond]</code> skips to the next iteration; labels (<code>&lt;&lt;outer&gt;&gt;</code>) let you exit nested loops.</li>
</ul>
<h4>Returning sets</h4>
<p>In a <code>RETURNS TABLE</code> or <code>RETURNS SETOF</code> function, <code>RETURN NEXT</code> appends the current values of the output columns (or a given row) to the result; <code>RETURN QUERY SELECT ...</code> appends a whole query's rows. Neither leaves the function — a final bare <code>RETURN;</code> (or reaching <code>END</code>) finishes it. The rows are accumulated in a tuplestore and handed back at the end.</p>`,
  why: `<p>Some logic is naturally step-by-step: tiered commission rules, validation with several early exits, iterating over a list of categories and building a combined report, or computing something that needs intermediate state. Doing that in the application means many round trips (each costing 0.2–2 ms over a network). PL/pgSQL keeps it next to the data, within one transaction, with plan caching for every embedded query.</p>`,
  useCase: `<p>A staffing company classifies 200 000 contractors into salary bands every night to feed a compensation dashboard. The original Python job fetched each contractor, computed the band, and wrote it back: 400 000 round trips, 25 minutes. A PL/pgSQL function <code>salary_band(employee_id)</code> with <code>%TYPE</code>-anchored variables and an <code>IF/ELSIF</code> ladder, called from a single <code>UPDATE ... SET band = salary_band(id)</code>, finished in 9 seconds. Later they replaced the function call with a pure <code>CASE</code> expression in SQL and it dropped to 2 seconds — a good illustration of the "procedural is fine, set-based is better" rule.</p>`,
  internals: `<p>PL/pgSQL source is stored as text in <code>pg_proc.prosrc</code> and only syntax-checked at <code>CREATE</code> time; table and column names are resolved the <em>first time</em> each statement runs in a session. Each embedded SQL statement is prepared through SPI (Server Programming Interface) and its plan cached per session; after five executions the plan cache may switch to a generic plan (controlled by <code>plan_cache_mode</code>). Simple expressions such as <code>v_total := v_total + 1</code> are evaluated by a fast path that skips the full executor.</p>
<p>Variables that collide with column names trigger <code>column reference "x" is ambiguous</code> by default (<code>plpgsql.variable_conflict = error</code>); you can change per function with <code>#variable_conflict use_column</code>. <code>FOR rec IN SELECT</code> opens an implicit cursor and fetches 10 rows at a time, so iterating a large result does not load it all into memory — but <code>RETURN NEXT</code> accumulates the output in a tuplestore that spills to disk beyond <code>work_mem</code>.</p>`,
  whenNot: `<p>Do not use a <code>FOR</code> loop to do what one <code>UPDATE ... FROM</code>, <code>INSERT ... SELECT</code> or window function can do: row-by-row processing ("RBAR") is typically 10–100× slower than a set-based statement. Avoid PL/pgSQL for heavy string/number crunching (PL/Python or the application is better), and do not use it when a SQL function would suffice — SQL functions can be inlined, PL/pgSQL ones cannot.</p>`,
  syntax: `CREATE FUNCTION name(args) RETURNS type LANGUAGE plpgsql AS $$
[ <<label>> ]
DECLARE
  v_name   type [ NOT NULL ] [ { := | DEFAULT } expr ];
  v_col    table.column%TYPE;
  v_row    table%ROWTYPE;
  v_rec    RECORD;
BEGIN
  SELECT ... INTO [STRICT] v_name ...;
  IF cond THEN ... ELSIF cond THEN ... ELSE ... END IF;
  CASE expr WHEN v1 THEN ... ELSE ... END CASE;
  LOOP ... EXIT WHEN cond; END LOOP;
  WHILE cond LOOP ... END LOOP;
  FOR i IN [REVERSE] 1..n [BY step] LOOP ... END LOOP;
  FOR v_rec IN SELECT ... LOOP ... END LOOP;
  FOREACH v_elem [SLICE n] IN ARRAY arr LOOP ... END LOOP;
  RETURN NEXT; | RETURN QUERY SELECT ...; | RETURN expr;
END [ label ];
$$;`,
  examples: [
    { label: 'Basic', title: '%TYPE variables and an IF/ELSIF ladder',
      sql: `CREATE FUNCTION salary_band(p_employee_id int)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_salary employees.salary%TYPE;    -- follows the column type
  v_band   text;
BEGIN
  SELECT salary INTO v_salary
  FROM employees
  WHERE id = p_employee_id;

  IF NOT FOUND THEN                  -- FOUND is set by SELECT INTO
    RETURN 'unknown employee';
  ELSIF v_salary >= 200000 THEN
    v_band := 'executive';
  ELSIF v_salary >= 120000 THEN
    v_band := 'senior';
  ELSIF v_salary >= 60000 THEN
    v_band := 'mid';
  ELSE
    v_band := 'junior';
  END IF;

  RETURN v_band;
END;
$$;

SELECT id, first_name, salary, salary_band(id) AS band
FROM employees
WHERE id IN (1, 3, 9, 10, 11, 99999)
ORDER BY id;`,
      explain: `<p><code>v_salary employees.salary%TYPE</code> anchors the variable to the column type. <code>SELECT ... INTO</code> fills it; the special variable <code>FOUND</code> is false when no row matched, which handles the non-existent id gracefully (id 99999 is not returned by the outer query, but calling <code>salary_band(99999)</code> directly would return <code>unknown employee</code>). The <code>IF/ELSIF/ELSE</code> ladder is evaluated top-down and stops at the first true branch.</p>`,
      output: ` id | first_name | salary    | band
----+------------+-----------+-----------
 1  | Asha       | 187500.00 | senior
 3  | Meera      | 202500.00 | executive
 9  | Myra       | 121700.00 | senior
 10 | Sai        | 47100.00  | junior
 11 | Anika      | 94000.00  | mid
(5 rows)`, run: true },
    { label: 'Intermediate', title: '%ROWTYPE, a FOR-over-query loop, CASE and RETURN NEXT',
      sql: `CREATE FUNCTION dept_payroll_report()
RETURNS TABLE (department text, staff int, payroll numeric, health text)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dept departments%ROWTYPE;        -- a whole departments row
BEGIN
  FOR v_dept IN SELECT * FROM departments ORDER BY id LOOP
    department := v_dept.name;

    SELECT count(*), coalesce(sum(e.salary), 0)
      INTO staff, payroll
    FROM employees e
    WHERE e.department_id = v_dept.id AND e.is_active;

    health := CASE
                WHEN payroll > v_dept.budget        THEN 'over budget'
                WHEN payroll > v_dept.budget * 0.8  THEN 'tight'
                ELSE 'ok'
              END;

    RETURN NEXT;                     -- emit current output columns as a row
  END LOOP;
END;
$$;

SELECT * FROM dept_payroll_report();`,
      explain: `<p>In a <code>RETURNS TABLE</code> PL/pgSQL function the output columns (<code>department</code>, <code>staff</code>, ...) are ordinary variables. The <code>FOR v_dept IN SELECT</code> loop walks departments via an implicit cursor; each iteration assigns the output variables and calls <code>RETURN NEXT</code> to append a row. Note the inner query aliases <code>employees e</code> and qualifies columns, avoiding conflicts with output-column variable names. A <code>CASE</code> expression classifies payroll against budget.</p>`,
      output: ` department  | staff | payroll    | health
-------------+-------+------------+-------------
 Engineering | 24    | 2335300.00 | ok
 Sales       | 25    | 2816900.00 | over budget
 Marketing   | 24    | 2408900.00 | over budget
 Finance     | 23    | 2334600.00 | over budget
 HR          | 22    | 2304900.00 | over budget
 Operations  | 22    | 2251100.00 | over budget
 Support     | 23    | 2434600.00 | over budget
 Research    | 22    | 2119900.00 | tight
(8 rows)`, run: true },
    { label: 'Advanced', title: 'FOREACH over an array, WHILE, CONTINUE and RETURN QUERY',
      sql: `CREATE FUNCTION restock_plan(p_categories text[], p_min_stock int DEFAULT 150)
RETURNS TABLE (category text, sku text, stock int, suggested_order int)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cat   text;
  v_batch int;
BEGIN
  FOREACH v_cat IN ARRAY p_categories LOOP
    CONTINUE WHEN v_cat IS NULL OR v_cat = '';   -- skip junk input

    RETURN QUERY
      SELECT p.category, p.sku, p.stock,
             -- order in batches of 50 until we are above the minimum
             (ceil((p_min_stock - p.stock) / 50.0) * 50)::int
      FROM products p
      WHERE p.category = v_cat
        AND p.stock < p_min_stock
      ORDER BY p.stock;
  END LOOP;

  -- WHILE demo: smallest batch size (power of two) that covers 75 units
  v_batch := 1;
  WHILE v_batch < 75 LOOP
    v_batch := v_batch * 2;
  END LOOP;
  RAISE NOTICE 'power-of-two batch covering 75 units: %', v_batch;
END;
$$;

SELECT * FROM restock_plan(ARRAY['audio', '', 'networking', 'storage'], 120);`,
      explain: `<p><code>FOREACH v_cat IN ARRAY p_categories</code> iterates the array elements; <code>CONTINUE WHEN</code> skips the empty string. <code>RETURN QUERY</code> appends all rows of the query to the result <em>without leaving the function</em>, so three categories produce one combined result. The <code>WHILE</code> loop shows condition-first iteration, and <code>RAISE NOTICE</code> prints a diagnostic message (shown in the output as <code>NOTICE</code>). Column references in the query are qualified with <code>p.</code> because <code>category</code>, <code>sku</code> and <code>stock</code> are also output-column variables.</p>`,
      output: `NOTICE:  power-of-two batch covering 75 units: 128
 category   | sku      | stock | suggested_order
------------+----------+-------+-----------------
 audio      | SKU-0044 | 54    | 100
 audio      | SKU-0064 | 89    | 50
 networking | SKU-0078 | 23    | 100
 networking | SKU-0098 | 25    | 100
(4 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Row-by-row: one UPDATE per employee inside a loop
CREATE FUNCTION raise_engineering_slow() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id FROM employees WHERE department_id = 1 LOOP
    UPDATE employees SET salary = salary * 1.05 WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
SELECT raise_engineering_slow();`,
      why: 'Executes one UPDATE (index lookup + new tuple + WAL) per row; on 1M rows that is 1M executor start-ups.', run: true },
    good: { sql: `CREATE FUNCTION raise_engineering() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE employees SET salary = salary * 1.05 WHERE department_id = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
SELECT raise_engineering();`,
      why: 'One set-based UPDATE does the same work in a single pass; GET DIAGNOSTICS ROW_COUNT still reports how many rows changed.', run: true }
  },
  mistakes: [
    `Variables or OUT columns named like table columns, causing <code>column reference "x" is ambiguous</code>. Prefix variables (<code>v_</code>, <code>p_</code>) and qualify columns with table aliases.`,
    `Using <code>SELECT ... INTO</code> without checking <code>FOUND</code> or using <code>INTO STRICT</code>; a missing row silently leaves the variable NULL.`,
    `Forgetting that <code>RETURN NEXT</code>/<code>RETURN QUERY</code> do not exit — code after them keeps running.`,
    `Writing a statement-form <code>CASE</code> without <code>ELSE</code>; unmatched values raise <code>case not found</code> at runtime.`,
    `Looping over rows to do updates that a single set-based statement could do.`
  ],
  best: [
    `Anchor types with <code>%TYPE</code>/<code>%ROWTYPE</code> so schema changes do not break functions.`,
    `Use <code>INTO STRICT</code> when exactly one row is expected; it turns silent bugs into clear errors.`,
    `Use <code>GET DIAGNOSTICS v = ROW_COUNT</code> after DML instead of re-counting.`,
    `Keep loops for genuinely sequential logic; push bulk work into single SQL statements.`,
    `Install the <code>plpgsql_check</code> extension <span class="tag ext">extension</span> in development to catch errors that CREATE FUNCTION does not.`
  ],
  performance: `<p>Each embedded query's plan is cached per session, so repeated calls are cheap. The expensive pattern is a query <em>per row</em> inside a loop. <code>RETURN NEXT</code> buffers the whole result before returning (no streaming), so a function returning 10 million rows needs memory or temp disk; the planner also assumes 1000 rows unless you set <code>ROWS</code>. Calling a PL/pgSQL function per row of a large scan costs roughly 1–5 µs per call plus whatever queries it runs.</p>`,
  security: `<p>Static SQL inside PL/pgSQL is automatically parameterised — variables are passed as bind parameters, never concatenated, so it is immune to SQL injection. Only dynamic SQL (<code>EXECUTE 'string'</code>) can be injected; build it with <code>format('%I', ident)</code> and <code>format('%L', literal)</code> or <code>EXECUTE ... USING</code>.</p>`,
  scenario: { title: 'A nightly PL/pgSQL job takes 40 minutes', steps: [
    '1. Enable track_functions = pl and check pg_stat_user_functions for total_time and calls.',
    '2. Use auto_explain with log_nested_statements = on to see which inner query dominates.',
    '3. Find FOR loops issuing one UPDATE/INSERT per row.',
    '4. Rewrite the loop as UPDATE ... FROM (SELECT ...) or INSERT ... SELECT.',
    '5. Keep PL/pgSQL only for orchestration and validation; re-measure.'
  ] },
  interview: [
    { q: 'What is the difference between RETURN NEXT and RETURN QUERY?', a: 'RETURN NEXT appends one row (the current OUT variables or a given row value) to the result set; RETURN QUERY appends all rows of a query. Neither exits the function; a final RETURN or reaching END finishes it. Both accumulate into a tuplestore returned at the end.' },
    { q: 'Why use %TYPE and %ROWTYPE?', a: 'They anchor variable types to table columns or rows, so if the column changes type or the table gains columns, the function adapts automatically without edits, and it documents intent.' },
    { q: 'How does PL/pgSQL avoid SQL injection for normal statements?', a: 'Static SQL statements are prepared with PL/pgSQL variables passed as parameters, so values are never interpolated into the SQL text. Only EXECUTE with string concatenation is vulnerable; use format with %I/%L or EXECUTE ... USING.' },
    { q: 'Why are PL/pgSQL functions often slower than equivalent SQL?', a: 'They cannot be inlined, so the planner treats them as black boxes with default cost and row estimates, and logic written as loops executes per-row statements instead of one set-based operation.' }
  ],
  exercises: [
    { task: 'Write a PL/pgSQL function order_size(p_order_id bigint) that returns small (< 5000), medium (< 50000) or large based on orders.total_amount, using INTO STRICT. Test it on order 1.', solution: `CREATE FUNCTION order_size(p_order_id bigint) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total orders.total_amount%TYPE;
BEGIN
  SELECT total_amount INTO STRICT v_total FROM orders WHERE id = p_order_id;
  IF v_total < 5000 THEN RETURN 'small';
  ELSIF v_total < 50000 THEN RETURN 'medium';
  ELSE RETURN 'large';
  END IF;
END $$;

SELECT order_size(1);`, run: true },
    { task: 'Write a function fib(n int) RETURNS SETOF bigint that returns the first n Fibonacci numbers using a FOR loop and RETURN NEXT.', solution: `CREATE FUNCTION fib(n int) RETURNS SETOF bigint
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a bigint := 0; b bigint := 1; t bigint;
BEGIN
  FOR i IN 1..n LOOP
    RETURN NEXT a;
    t := a + b; a := b; b := t;
  END LOOP;
END $$;

SELECT * FROM fib(10);`, run: true }
  ],
  challenge: { task: 'Write manager_chain(p_employee_id int) RETURNS TABLE(level int, employee_id int, name text) that walks manager_id upwards with a LOOP and EXIT WHEN, returning the employee and each manager above them.', hint: 'Use a loop variable for the current id; SELECT ... INTO the next manager_id; EXIT WHEN it is NULL.', solution: `CREATE FUNCTION manager_chain(p_employee_id int)
RETURNS TABLE (level int, employee_id int, name text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_current int := p_employee_id;
  v_mgr     int;
BEGIN
  level := 0;
  LOOP
    SELECT e.id, e.first_name || ' ' || e.last_name, e.manager_id
      INTO employee_id, name, v_mgr
    FROM employees e WHERE e.id = v_current;
    EXIT WHEN NOT FOUND;
    RETURN NEXT;
    EXIT WHEN v_mgr IS NULL;
    v_current := v_mgr;
    level := level + 1;
  END LOOP;
END $$;

SELECT * FROM manager_chain(150);`, run: true },
  related: ['functions-sql-functions', 'functions-parameters', 'functions-error-handling', 'triggers'],
  quiz: [
    { type: 'mcq', q: 'Which statement appends a whole query result to a set-returning PL/pgSQL function without exiting?', options: ['RETURN', 'RETURN NEXT', 'RETURN QUERY', 'EXIT'], answer: 2, explain: 'RETURN QUERY appends all rows of a query; RETURN NEXT appends one row; RETURN alone ends the function.' },
    { type: 'tf', q: 'After SELECT ... INTO v that matches no rows, PL/pgSQL raises an error by default.', answer: false, explain: 'Without STRICT, the variable is set to NULL and FOUND becomes false. INTO STRICT raises NO_DATA_FOUND.' },
    { type: 'bug', q: 'This function fails at runtime with "column reference is ambiguous". Why?', code: `CREATE FUNCTION f() RETURNS TABLE (name text) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY SELECT name FROM departments;
END $$;`, options: ['RETURN QUERY is not allowed with RETURNS TABLE', 'The OUT column "name" is a variable that clashes with departments.name', 'Missing DECLARE', 'Needs LANGUAGE sql'], answer: 1, explain: 'RETURNS TABLE columns are variables in PL/pgSQL; "name" could mean the variable or the column. Qualify it: SELECT d.name FROM departments d.' },
    { type: 'predict', q: 'What does SELECT count(*) FROM f(); return?', code: `CREATE FUNCTION f() RETURNS SETOF int LANGUAGE plpgsql AS $$
BEGIN
  FOR i IN 1..10 BY 3 LOOP RETURN NEXT i; END LOOP;
END $$;`, options: ['3', '4', '10', '1'], answer: 1, explain: 'The loop visits 1, 4, 7, 10 — four values.' }
  ]
},
{
  id: 'functions-parameters',
  module: 'functions',
  title: 'Function Parameters: IN/OUT/INOUT, VARIADIC, Defaults, Named Notation and Overloading',
  level: 3,
  minutes: 20,
  summary: 'Design clean function signatures with OUT parameters, defaults, named notation, VARIADIC arrays and overloads — and avoid the ambiguity traps they create.',
  objectives: [
    'Return multiple values with OUT and INOUT parameters',
    'Give parameters defaults and call functions with named notation (=>)',
    'Accept a variable number of arguments with VARIADIC',
    'Overload a function name and understand how PostgreSQL resolves calls',
    'Avoid ambiguous overloads and default-parameter collisions'
  ],
  concept: `<p>A function's <strong>signature</strong> is its name plus its <em>input</em> argument types. Think of it like a <em>form at a government office</em>: some fields are mandatory, some have a pre-filled default, some boxes are filled in <em>by the clerk</em> and handed back to you (OUT), and some forms accept "attach as many supporting documents as you like" (VARIADIC).</p>
<h4>Parameter modes</h4>
<ul>
<li><code>IN</code> (default) — input only.</li>
<li><code>OUT</code> — output only. Not part of the call signature. One OUT parameter makes the function return that type; several make it return a record with those columns. <code>RETURNS TABLE(...)</code> is shorthand for OUT parameters plus <code>SETOF</code>.</li>
<li><code>INOUT</code> — passed in and returned (common in procedures).</li>
<li><code>VARIADIC</code> — the last parameter, declared as an array type; callers pass any number of comma-separated values, which arrive as one array. Pass an existing array with <code>VARIADIC ARRAY[...]</code>.</li>
</ul>
<h4>Defaults and calling notation</h4>
<p>Parameters can have <code>DEFAULT expr</code>; all parameters after the first defaulted one must also have defaults. Callers can use <strong>positional</strong> notation (<code>f(1, 2)</code>), <strong>named</strong> notation (<code>f(p_limit =&gt; 3)</code>) or <strong>mixed</strong> (positional first, then named). Named notation makes calls self-documenting and lets you skip middle defaults.</p>
<h4>Overloading</h4>
<p>Several functions may share a name if their input argument types differ: <code>format_price(numeric)</code> and <code>format_price(numeric, text)</code>. PostgreSQL resolves calls by exact type match first, then implicit casts, preferring "preferred types" within a category (e.g. <code>numeric</code> → <code>double precision</code>, <code>text</code> for strings). If more than one candidate remains, you get <code>function ... is not unique</code>. Because <code>DROP FUNCTION</code> and <code>GRANT</code> identify a function by name <em>and argument types</em>, overloading also means you must always spell out the types in DDL.</p>`,
  why: `<p>Good signatures make functions safe to evolve. OUT parameters avoid creating one-off composite types for multi-value results. Defaults let you add a new optional argument without breaking existing callers. Named notation removes the "what was the 4th argument?" class of bugs. VARIADIC gives SQL-friendly APIs such as <code>greatest()</code>-style helpers, and overloading lets one conceptual operation accept different input types.</p>`,
  useCase: `<p>A B2B SaaS platform exposes product search to 30 internal reporting jobs through <code>search_products(p_category, p_max_price, p_brand, p_limit)</code>. When they added <code>p_in_stock_only boolean DEFAULT false</code> at the end, no caller broke. Jobs written with named notation (<code>search_products(p_brand =&gt; 'Acme', p_limit =&gt; 20)</code>) were also immune to a later reordering of the first two parameters. A <code>VARIADIC</code> helper <code>tag_union(VARIADIC text[])</code> powered ad-hoc dashboards that combine any number of tag filters.</p>`,
  internals: `<p><code>pg_proc.proargtypes</code> holds input types only (the identity); <code>proallargtypes</code> and <code>proargmodes</code> (<code>i</code>,<code>o</code>,<code>b</code>=INOUT,<code>v</code>=VARIADIC,<code>t</code>=TABLE) include output columns; <code>proargdefaults</code> stores default expressions. Resolution happens in the parser (<code>func_get_detail</code>): candidates with the right name and number of arguments (counting defaults and variadic expansion) are filtered by exact match, then by implicit coercibility, then by preferred-type heuristics. A call with an <code>unknown</code>-typed literal (<code>'abc'</code>) is resolved as <code>text</code> when possible.</p>`,
  whenNot: `<p>Avoid overloads that differ only by types in the same category (<code>int</code> vs <code>bigint</code>, <code>text</code> vs <code>varchar</code>) — callers with literals hit "not unique" errors. Avoid both an overload <em>and</em> a default that make the same call valid twice (<code>f(int)</code> plus <code>f(int, int DEFAULT 0)</code>). If a function grows beyond ~6 parameters, consider passing a <code>jsonb</code> options object or a composite type instead.</p>`,
  syntax: `CREATE FUNCTION name (
  [ IN | OUT | INOUT | VARIADIC ] [ argname ] argtype [ { DEFAULT | = } expr ] [, ...]
) ...

-- calling
SELECT f(1, 2);                     -- positional
SELECT f(p_a => 1, p_b => 2);       -- named
SELECT f(1, p_b => 2);              -- mixed (positional first)
SELECT f(VARIADIC ARRAY[1,2,3]);    -- pass an array to a VARIADIC param

DROP FUNCTION f(int, int);          -- types required when overloaded`,
  examples: [
    { label: 'Basic', title: 'Several OUT parameters return one record',
      sql: `CREATE FUNCTION customer_stats(
  p_customer_id int,
  OUT order_count  bigint,
  OUT lifetime_value numeric,
  OUT last_order   date
)
LANGUAGE sql
STABLE
AS $$
  SELECT count(*), coalesce(sum(total_amount), 0), max(order_date)::date
  FROM orders
  WHERE customer_id = p_customer_id
    AND status <> 'cancelled'
$$;

-- call in FROM to get columns
SELECT * FROM customer_stats(42);`,
      explain: `<p>No <code>RETURNS</code> clause is needed: three OUT parameters make the return type an anonymous record with columns <code>order_count</code>, <code>lifetime_value</code>, <code>last_order</code>. The call signature is just <code>customer_stats(int)</code>. Calling it in <code>FROM</code> expands the record into columns; <code>SELECT customer_stats(42)</code> would return one composite value like <code>(9,...,...)</code>.</p>`,
      output: ` order_count | lifetime_value | last_order
-------------+----------------+------------
 10          | 2388715.89     | 2025-08-18
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Defaults and named notation',
      sql: `CREATE FUNCTION search_products(
  p_category  text    DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_brand     text    DEFAULT NULL,
  p_limit     int     DEFAULT 5
)
RETURNS TABLE (sku text, name text, price numeric, brand text)
LANGUAGE sql
STABLE
AS $$
  SELECT p.sku, p.name, p.price, p.attributes ->> 'brand'
  FROM products p
  WHERE (p_category  IS NULL OR p.category = p_category)
    AND (p_max_price IS NULL OR p.price <= p_max_price)
    AND (p_brand     IS NULL OR p.attributes ->> 'brand' = p_brand)
  ORDER BY p.price
  LIMIT p_limit
$$;

-- skip category and max price, set brand and limit by name
SELECT * FROM search_products(p_brand => 'Acme', p_limit => 4);`,
      explain: `<p>Every parameter has a default, so the function can be called with zero to four arguments. Named notation (<code>=&gt;</code>) skips <code>p_category</code> and <code>p_max_price</code> entirely and makes the call readable. The <code>(p_x IS NULL OR col = p_x)</code> pattern implements optional filters. Note: this "catch-all" pattern can produce mediocre generic plans on big tables — see Performance.</p>`,
      output: ` sku      | name            | price    | brand
----------+-----------------+----------+-------
 SKU-0084 | Headset Plus 84 | 534.46   | Acme
 SKU-0060 | Laptop Pro 60   | 8659.25  | Acme
 SKU-0052 | Keyboard Max 52 | 9529.04  | Acme
 SKU-0072 | Keyboard Max 72 | 10997.80 | Acme
(4 rows)`, run: true },
    { label: 'Advanced', title: 'VARIADIC, INOUT and overloading with explicit resolution',
      sql: `-- VARIADIC: any number of numeric arguments arrive as numeric[]
CREATE FUNCTION sum_of(VARIADIC p_values numeric[])
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN (SELECT sum(v) FROM unnest(p_values) AS v);

-- INOUT: value goes in and comes back modified
CREATE FUNCTION apply_discount(INOUT p_amount numeric, p_pct numeric DEFAULT 10)
LANGUAGE sql IMMUTABLE
AS $$ SELECT round(p_amount * (1 - p_pct / 100), 2) $$;

-- Overloads: same name, different input types
CREATE FUNCTION format_price(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE RETURN 'INR ' || to_char(p, 'FM99,99,99,990.00');
CREATE FUNCTION format_price(p numeric, p_currency text) RETURNS text
LANGUAGE sql IMMUTABLE RETURN p_currency || ' ' || to_char(p, 'FM999,999,990.00');

SELECT sum_of(10, 20, 30.5)                 AS variadic_list,
       sum_of(VARIADIC ARRAY[1, 2, 3]::numeric[]) AS variadic_array,
       apply_discount(1999)                 AS default_10pct,
       apply_discount(1999, p_pct => 25)    AS named_25pct,
       format_price(1234567.5)              AS one_arg,
       format_price(1234567.5, 'USD')       AS two_args;`,
      explain: `<p><code>sum_of(10, 20, 30.5)</code> packs the arguments into <code>numeric[]</code>; <code>VARIADIC ARRAY[...]</code> passes an existing array directly. <code>apply_discount</code> uses <code>INOUT</code>: the amount is both input and the returned value, and <code>p_pct</code> defaults to 10. The two <code>format_price</code> overloads are distinguished by argument count; the one-argument version uses the Indian digit grouping pattern. To drop one you must write <code>DROP FUNCTION format_price(numeric, text)</code>.</p>`,
      output: ` variadic_list | variadic_array | default_10pct | named_25pct | one_arg          | two_args
---------------+----------------+---------------+-------------+------------------+------------------
 60.5          | 6              | 1799.10       | 1499.25     | INR 12,34,567.50 | USD 1,234,567.50
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Overload + default make f(1) ambiguous
CREATE FUNCTION f_amb(a int) RETURNS int LANGUAGE sql RETURN a;
CREATE FUNCTION f_amb(a int, b int DEFAULT 0) RETURNS int LANGUAGE sql RETURN a + b;
-- SELECT f_amb(1);  -> ERROR: function f_amb(integer) is not unique
SELECT f_amb(1, 2);`,
      why: 'Both overloads accept a single int argument, so f_amb(1) fails with "function is not unique" — a time bomb for every caller.', run: true },
    good: { sql: `-- One function with a default covers both call shapes
CREATE FUNCTION f_one(a int, b int DEFAULT 0) RETURNS int LANGUAGE sql RETURN a + b;
SELECT f_one(1) AS one_arg, f_one(1, 2) AS two_args, f_one(a => 5, b => 1) AS named;`,
      why: 'A single signature with a default supports every call shape without ambiguity.', run: true }
  },
  mistakes: [
    `Creating overloads that a defaulted parameter also covers, producing <code>function ... is not unique</code> errors.`,
    `Overloading on <code>int</code> vs <code>bigint</code> or <code>text</code> vs <code>varchar</code>; literal arguments become ambiguous.`,
    `Running <code>DROP FUNCTION name;</code> when overloads exist — PostgreSQL requires the argument types to pick one.`,
    `Adding a new parameter in the middle of the list; positional callers silently pass values to the wrong parameter. Add new optional parameters at the end.`,
    `Expecting OUT parameters to be passed in the call; they are not part of the call signature.`
  ],
  best: [
    `Add new optional parameters at the end with a <code>DEFAULT</code>.`,
    `Encourage named notation for functions with more than two or three parameters.`,
    `Prefer one function with defaults over multiple overloads.`,
    `Always use full signatures in DDL: <code>GRANT EXECUTE ON FUNCTION f(int, text)</code>.`,
    `Use OUT parameters (or RETURNS TABLE) instead of creating single-use composite types.`
  ],
  performance: `<p>The "optional filter" pattern <code>(p IS NULL OR col = p)</code> works for small tables but defeats index usage in generic plans, because the planner must handle both branches. For large tables, generate the query dynamically in PL/pgSQL (<code>EXECUTE format(...)</code>) adding only the filters supplied, or keep custom plans (SQL functions inlined into the caller see actual constant values). VARIADIC has a small array-construction cost; negligible except in hot per-row calls.</p>`,
  security: `<p>Default expressions are evaluated with the caller's privileges. When a function is <code>SECURITY DEFINER</code>, validate every parameter: callers control their values. Remember to revoke <code>EXECUTE</code> from <code>PUBLIC</code> on every overload, not just one.</p>`,
  scenario: { title: "A new optional parameter broke half the reports", steps: [
    "1. Reports fail with function ... is not unique after a release.",
    "2. Inspect overloads: SELECT oid::regprocedure FROM pg_proc WHERE proname = 'search_products';",
    "3. Find that a new overload duplicates a call shape covered by defaults.",
    "4. Drop the redundant overload with its full signature; keep one function with trailing defaults.",
    "5. Switch callers with 3+ arguments to named notation (p_limit => 20).",
    "6. Add a CI test that calls every public function with its documented argument shapes."
  ] },
  interview: [
    { q: 'Are OUT parameters part of a function signature?', a: 'No. The identity of a function is its name plus input argument types (IN, INOUT, VARIADIC). OUT parameters only define the result shape, which is why DROP FUNCTION f(int) works for a function with extra OUT params.' },
    { q: 'How does VARIADIC work?', a: 'The last parameter is declared VARIADIC with an array type. Callers pass any number of individual values, which PostgreSQL packs into an array. To pass an existing array, prefix it with the VARIADIC keyword in the call.' },
    { q: 'What causes "function is not unique" errors?', a: 'Two or more candidates match the call equally well after implicit casts and default/variadic expansion — typically overloads on similar types or an overload that duplicates a defaulted call shape. Fix by removing the redundant overload or adding explicit casts.' }
  ],
  exercises: [
    { task: 'Create dept_salary_range(p_dept_id int, OUT min_salary numeric, OUT max_salary numeric, OUT avg_salary numeric) and call it for department 1.', solution: `CREATE FUNCTION dept_salary_range(p_dept_id int,
  OUT min_salary numeric, OUT max_salary numeric, OUT avg_salary numeric)
LANGUAGE sql STABLE AS $$
  SELECT min(salary), max(salary), round(avg(salary), 2)
  FROM employees WHERE department_id = p_dept_id
$$;

SELECT * FROM dept_salary_range(1);`, run: true },
    { task: 'Create a VARIADIC function any_low_stock(p_threshold int, VARIADIC p_skus text[]) RETURNS boolean that is true if any of the given SKUs has stock below the threshold. Call it with three SKUs.', solution: `CREATE FUNCTION any_low_stock(p_threshold int, VARIADIC p_skus text[])
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM products WHERE sku = ANY (p_skus) AND stock < p_threshold)
$$;

SELECT any_low_stock(100, 'SKU-0001', 'SKU-0010', 'SKU-0020');`, run: true }
  ],
  challenge: { task: 'Create an overload pair employee_label(int) and employee_label(int, boolean) where the boolean controls whether to append the job title. Then rewrite it as a single function with a DEFAULT and named notation, dropping both overloads with full signatures.', hint: 'DROP FUNCTION employee_label(int), employee_label(int, boolean);', solution: `CREATE FUNCTION employee_label(p_id int) RETURNS text LANGUAGE sql STABLE
AS $$ SELECT first_name || ' ' || last_name FROM employees WHERE id = p_id $$;
CREATE FUNCTION employee_label(p_id int, p_with_title boolean) RETURNS text LANGUAGE sql STABLE
AS $$ SELECT first_name || ' ' || last_name || CASE WHEN p_with_title THEN ' (' || job_title || ')' ELSE '' END
      FROM employees WHERE id = p_id $$;

DROP FUNCTION employee_label(int), employee_label(int, boolean);

CREATE FUNCTION employee_label(p_id int, p_with_title boolean DEFAULT false) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT first_name || ' ' || last_name || CASE WHEN p_with_title THEN ' (' || job_title || ')' ELSE '' END
  FROM employees WHERE id = p_id
$$;

SELECT employee_label(9), employee_label(9, p_with_title => true);`, run: true },
  related: ['functions-sql-functions', 'functions-plpgsql-basics', 'functions-error-handling', 'procedures'],
  quiz: [
    { type: 'mcq', q: 'Which call is valid for f(a int, b int DEFAULT 1, c int DEFAULT 2) to set only c?', options: ['f(5, , 9)', 'f(5, c => 9)', 'f(c => 9, 5)', 'f(5, 9)'], answer: 1, explain: 'Mixed notation: positional arguments first, then named ones. f(5, 9) would set b, not c.' },
    { type: 'tf', q: 'DROP FUNCTION f(int) can drop a function declared as f(p int, OUT x int, OUT y int).', answer: true, explain: 'OUT parameters are not part of the identity; the input types are just (int).' },
    { type: 'predict', q: 'What does this return?', code: `CREATE FUNCTION cnt(VARIADIC a int[]) RETURNS int LANGUAGE sql RETURN cardinality(a);
SELECT cnt(4, 5, 6, 7);`, options: ['1', '4', '22', 'ERROR'], answer: 1, explain: 'The four values are packed into one int[] of cardinality 4.' },
    { type: 'design', q: 'You must add an optional p_currency parameter to a widely used function price_label(numeric). Best approach?', options: ['Create a new overload price_label(numeric, text) and keep the old one', 'Replace it with price_label(p numeric, p_currency text DEFAULT \'INR\') after dropping the old one', 'Add p_currency as the first parameter', 'Use a global variable'], answer: 1, explain: 'One function with a trailing default supports old and new calls and avoids an ambiguous overload pair.' }
  ]
},
{
  id: 'functions-error-handling',
  module: 'functions',
  title: 'Error Handling and Secure Functions: RAISE, EXCEPTION, SQLSTATE, SECURITY DEFINER',
  level: 4,
  minutes: 25,
  summary: 'Raise and catch errors in PL/pgSQL with RAISE, EXCEPTION blocks, SQLSTATE codes and GET STACKED DIAGNOSTICS, and write SECURITY DEFINER functions that cannot be hijacked through search_path.',
  objectives: [
    'Emit messages with RAISE at DEBUG/LOG/NOTICE/WARNING/EXCEPTION levels',
    'Raise custom errors with ERRCODE, DETAIL and HINT',
    'Catch errors with EXCEPTION WHEN and understand the implicit savepoint',
    'Inspect errors via SQLSTATE, SQLERRM and GET STACKED DIAGNOSTICS',
    'Write SECURITY DEFINER functions with a pinned search_path and revoked PUBLIC execute'
  ],
  concept: `<p>Error handling in PL/pgSQL works like a <em>circuit breaker in a building</em>: when something goes wrong inside one room (a block), the breaker trips, everything done in that room since the breaker was armed is undone, and the rest of the building keeps its power — if you installed a breaker (an <code>EXCEPTION</code> clause). Without one, the fault propagates up and the whole transaction is aborted.</p>
<h4>RAISE</h4>
<ul>
<li><code>RAISE NOTICE 'Processed % rows', n;</code> — <code>%</code> placeholders are filled from the following arguments. Levels: <code>DEBUG</code>, <code>LOG</code>, <code>INFO</code>, <code>NOTICE</code>, <code>WARNING</code>, <code>EXCEPTION</code> (the default). Only <code>EXCEPTION</code> aborts.</li>
<li><code>RAISE EXCEPTION 'Insufficient stock for %', sku USING ERRCODE = 'P0001', DETAIL = '...', HINT = '...';</code></li>
<li>Raise by condition name: <code>RAISE unique_violation USING MESSAGE = '...'</code>, or by code: <code>USING ERRCODE = '23505'</code>.</li>
<li><code>ASSERT condition, 'message';</code> for invariants (can be disabled with <code>plpgsql.check_asserts</code>).</li>
</ul>
<h4>Catching</h4>
<p>A block with <code>EXCEPTION WHEN condition [OR condition] THEN handler</code> catches matching errors raised in its <code>BEGIN</code> section. Conditions are names from the SQLSTATE appendix (<code>unique_violation</code>, <code>foreign_key_violation</code>, <code>division_by_zero</code>, <code>check_violation</code>, <code>no_data_found</code>, <code>too_many_rows</code>), <code>SQLSTATE '22012'</code>, or <code>OTHERS</code> (everything except query cancel and assert failures). Inside the handler, <code>SQLSTATE</code> and <code>SQLERRM</code> hold the code and message, and <code>GET STACKED DIAGNOSTICS</code> retrieves more: <code>MESSAGE_TEXT</code>, <code>RETURNED_SQLSTATE</code>, <code>PG_EXCEPTION_DETAIL</code>, <code>PG_EXCEPTION_HINT</code>, <code>PG_EXCEPTION_CONTEXT</code>, <code>CONSTRAINT_NAME</code>, <code>TABLE_NAME</code>, <code>COLUMN_NAME</code>, <code>SCHEMA_NAME</code>.</p>
<div class="callout warn">Entering a block that has an <code>EXCEPTION</code> clause creates a <strong>subtransaction (savepoint)</strong>. If an error is caught, all changes made inside that block are rolled back; changes made before the block survive. Subtransactions are not free — see Performance.</div>
<h4>SECURITY DEFINER</h4>
<p>By default a function runs with the <em>caller's</em> privileges (<code>SECURITY INVOKER</code>). <code>SECURITY DEFINER</code> runs it with the <em>owner's</em> privileges — like a <code>sudo</code> wrapper exposing one narrow operation (e.g. "deactivate a user") without granting <code>UPDATE</code> on the table. The danger: unqualified names inside the function are resolved through the caller-controlled <code>search_path</code>, so an attacker could create a malicious <code>public.lower()</code> or a temp table that shadows yours. Always pin it: <code>SET search_path = pg_catalog, public, pg_temp</code> (with <code>pg_temp</code> explicitly last), or schema-qualify every object, and <code>REVOKE EXECUTE ... FROM PUBLIC</code>.</p>`,
  why: `<p>Business rules must fail loudly and descriptively ("Insufficient stock for SKU-0010: requested 50, available 11") so applications can show useful messages and map SQLSTATE codes to HTTP statuses. Some operations need to tolerate expected failures (a duplicate insert in an idempotent import) without aborting the whole transaction. And security-sensitive operations need controlled privilege escalation without handing out table rights.</p>`,
  useCase: `<p>A fintech wallet service processes 3 million UPI top-ups per day. Its <code>debit_wallet()</code> function raises <code>SQLSTATE 'P0001'</code> with a <code>DETAIL</code> containing the shortfall; the Go service maps P0001 to HTTP 422 and 40001 (serialization failure) to automatic retry. A nightly import loop uses an inner <code>BEGIN ... EXCEPTION WHEN unique_violation</code> block to skip ~2 000 duplicate merchant rows and log them to an errors table with <code>GET STACKED DIAGNOSTICS</code>. A <code>SECURITY DEFINER</code> function <code>reset_password(token)</code> is the only way the web role can touch the <code>users</code> table, with <code>search_path</code> pinned after a penetration test showed a temp-table shadowing attack.</p>`,
  internals: `<p>Errors are reported through <code>ereport()</code> with a five-character SQLSTATE: the first two characters are the class (<code>23</code> integrity constraint violation, <code>22</code> data exception, <code>40</code> transaction rollback, <code>P0</code> PL/pgSQL). <code>RAISE EXCEPTION</code> without ERRCODE uses <code>P0001</code> (<code>raise_exception</code>). An <code>EXCEPTION</code> block calls <code>BeginInternalSubTransaction()</code> on entry; on error it rolls back to that point (releasing locks acquired inside, undoing changes), on success it releases it. Each subtransaction that writes gets its own XID; more than 64 open subtransactions in one backend overflow the per-backend cache in shared memory (the <code>PGPROC</code> subxid array), which forces other sessions to consult <code>pg_subtrans</code> for visibility checks — a known source of severe slowdowns on busy systems, especially with replicas.</p>
<p><code>SECURITY DEFINER</code> switches the current user for the duration of the call; <code>SET</code> clauses on a function save and restore the GUC around each call (and prevent inlining).</p>`,
  whenNot: `<p>Do not wrap every statement in <code>EXCEPTION WHEN OTHERS THEN NULL</code> — swallowing errors hides bugs and corrupts data silently. Do not use exception blocks in a loop over millions of rows for "expected" duplicates; use <code>INSERT ... ON CONFLICT DO NOTHING</code> instead, which needs no subtransaction. Avoid <code>SECURITY DEFINER</code> when row-level security policies or a narrowly granted role would solve the problem more transparently.</p>`,
  syntax: `RAISE [ level ] 'format %', expr [, ...] [ USING option = expr [, ...] ];
  -- level: DEBUG | LOG | INFO | NOTICE | WARNING | EXCEPTION
  -- options: MESSAGE, DETAIL, HINT, ERRCODE, COLUMN, CONSTRAINT, DATATYPE, TABLE, SCHEMA
RAISE condition_name [ USING ... ];
ASSERT condition [, message];

BEGIN
  statements;
EXCEPTION
  WHEN condition [ OR condition ... ] THEN handler_statements;
  WHEN SQLSTATE '22012' THEN ...;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v = MESSAGE_TEXT, v2 = PG_EXCEPTION_CONTEXT;
    RAISE;                         -- re-throw the current error
END;

CREATE FUNCTION f(...) ... SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE EXECUTE ON FUNCTION f(argtypes) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION f(argtypes) TO app_role;`,
  examples: [
    { label: 'Basic', title: 'RAISE levels and a custom business error caught by the caller',
      sql: `CREATE FUNCTION reserve_stock(p_sku text, p_qty int)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock products.stock%TYPE;
BEGIN
  SELECT stock INTO v_stock FROM products WHERE sku = p_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown SKU %', p_sku USING ERRCODE = 'no_data_found';
  END IF;

  IF v_stock < p_qty THEN
    RAISE EXCEPTION 'Insufficient stock for %', p_sku
      USING ERRCODE = 'P0001',
            DETAIL  = format('requested %s, available %s', p_qty, v_stock),
            HINT    = 'Reduce the quantity or back-order the item.';
  END IF;

  UPDATE products SET stock = stock - p_qty WHERE sku = p_sku;
  RAISE NOTICE 'Reserved % x %, % left', p_qty, p_sku, v_stock - p_qty;
  RETURN v_stock - p_qty;
END;
$$;

DO $$
BEGIN
  PERFORM reserve_stock('SKU-0001', 5);       -- succeeds
  PERFORM reserve_stock('SKU-0010', 50);      -- only 11 in stock
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RAISE NOTICE 'caught: % (SQLSTATE %)', SQLERRM, SQLSTATE;
END $$;`,
      explain: `<p><code>FOR UPDATE</code> locks the product row so two concurrent reservations cannot oversell. <code>RAISE EXCEPTION ... USING</code> sets a custom code, detail and hint that clients receive as separate protocol fields. <code>RAISE NOTICE</code> is informational. The <code>DO</code> block shows a caller catching the business error by <code>SQLSTATE</code>; <code>SQLERRM</code> is the message. Note that because the handler belongs to the DO block, the successful first reservation was <em>also</em> rolled back — the whole block is the savepoint scope.</p>`,
      output: `NOTICE:  Reserved 5 x SKU-0001, 124 left
NOTICE:  caught: Insufficient stock for SKU-0010 (SQLSTATE P0001)
DO`, run: true },
    { label: 'Intermediate', title: 'Per-row exception blocks: skip bad rows and keep the good ones',
      sql: `CREATE TABLE import_errors (
  row_no int, sqlstate text, message text, detail text, constraint_name text
);

CREATE FUNCTION import_departments(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_item     jsonb;
  v_ok       int := 0;
  v_i        int := 0;
  v_msg text; v_state text; v_detail text; v_con text;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_i := v_i + 1;
    BEGIN                                   -- inner block = savepoint per row
      INSERT INTO departments (name, location, budget)
      VALUES (v_item ->> 'name', v_item ->> 'location', (v_item ->> 'budget')::numeric);
      v_ok := v_ok + 1;
    EXCEPTION
      WHEN unique_violation OR check_violation OR not_null_violation THEN
        GET STACKED DIAGNOSTICS
          v_state  = RETURNED_SQLSTATE,
          v_msg    = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_con    = CONSTRAINT_NAME;
        INSERT INTO import_errors VALUES (v_i, v_state, v_msg, v_detail, v_con);
    END;
  END LOOP;
  RETURN v_ok;
END;
$$;

SELECT import_departments('[
  {"name":"Legal",       "location":"Delhi",  "budget":300000},
  {"name":"Engineering", "location":"Pune",   "budget":100},
  {"name":"Procurement", "location":"Noida",  "budget":-5},
  {"name":null,          "location":"Kochi",  "budget":10}
]') AS inserted;

SELECT row_no, sqlstate, constraint_name, left(message, 60) AS message
FROM import_errors ORDER BY row_no;`,
      explain: `<p>The inner <code>BEGIN ... EXCEPTION ... END</code> wraps each insert in its own savepoint, so a failed row is rolled back alone while successful rows stay. <code>GET STACKED DIAGNOSTICS</code> captures the SQLSTATE (<code>23505</code> unique, <code>23514</code> check, <code>23502</code> not-null), the message and the violated constraint name into an errors table. Only "Legal" is inserted. For pure duplicate-skipping, <code>ON CONFLICT DO NOTHING</code> would be cheaper — this pattern shines when you must record <em>why</em> each row failed.</p>`,
      output: ` row_no | sqlstate | constraint_name          | message
--------+----------+--------------------------+--------------------------------------------------------------
 2      | 23505    | departments_name_key     | duplicate key value violates unique constraint "departments_
 3      | 23514    | departments_budget_check | new row for relation "departments" violates check constraint
 4      | 23502    |                          | null value in column "name" of relation "departments" violat
(3 rows)`, run: true },
    { label: 'Advanced', title: 'A hardened SECURITY DEFINER function',
      sql: `CREATE FUNCTION deactivate_user(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER                               -- runs with the owner's rights
SET search_path = pg_catalog, public, pg_temp  -- caller cannot hijack name lookup
AS $$
DECLARE
  v_id int;
BEGIN
  IF p_username IS NULL OR length(p_username) > 64 THEN
    RAISE EXCEPTION 'invalid username' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.users                          -- schema-qualified anyway
     SET is_active = false
   WHERE username = p_username
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

-- Only the application role should call it, not every role
REVOKE EXECUTE ON FUNCTION deactivate_user(text) FROM PUBLIC;

SELECT deactivate_user('user7') AS deactivated,
       deactivate_user('nobody') AS missing;

SELECT proname, prosecdef, proconfig
FROM pg_proc WHERE proname = 'deactivate_user';`,
      explain: `<p><code>SECURITY DEFINER</code> lets a low-privilege role deactivate users without <code>UPDATE</code> on <code>users</code>. <code>SET search_path = pg_catalog, public, pg_temp</code> pins name resolution: <code>pg_temp</code> last means a caller's temp table named <code>users</code> cannot shadow the real one, and <code>pg_catalog</code> first prevents fake operator/function overrides. <code>REVOKE ... FROM PUBLIC</code> removes the default execute grant; in production you would then <code>GRANT EXECUTE ... TO app_role</code>. The catalog shows <code>prosecdef = true</code> and the pinned setting in <code>proconfig</code>.</p>`,
      output: ` proname         | prosecdef | proconfig
-----------------+-----------+---------------------------------------------
 deactivate_user | t         | {"search_path=pg_catalog, public, pg_temp"}
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `CREATE FUNCTION safe_div_bad(a numeric, b numeric) RETURNS numeric
LANGUAGE plpgsql AS $$
BEGIN
  RETURN a / b;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;           -- swallows EVERY error, including bugs
END $$;
SELECT safe_div_bad(10, 0);`,
      why: 'WHEN OTHERS THEN RETURN NULL hides every failure (including typos and permission errors) and creates a subtransaction on every call.', run: true },
    good: { sql: `CREATE FUNCTION safe_div(a numeric, b numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN a / nullif(b, 0);
SELECT safe_div(10, 0) AS div_zero, safe_div(10, 4) AS normal;`,
      why: 'Prevent the expected case (zero divisor) with NULLIF instead of catching it; no subtransaction, inlinable, and real errors still surface.', run: true }
  },
  mistakes: [
    `<code>EXCEPTION WHEN OTHERS THEN NULL</code> — silently swallowing all errors, including programming mistakes.`,
    `Forgetting that catching an error rolls back <em>everything</em> done inside that block, not just the failing statement.`,
    `Exception blocks inside hot loops over millions of rows: each iteration creates a subtransaction and consumes an XID if it writes.`,
    `<code>SECURITY DEFINER</code> without <code>SET search_path</code>; callers can shadow tables or functions with objects in their own schema or <code>pg_temp</code>.`,
    `Leaving the default <code>EXECUTE</code> grant to <code>PUBLIC</code> on privileged functions.`,
    `Using the generic <code>P0001</code> code for every error, so clients cannot distinguish "not found" from "insufficient funds".`
  ],
  best: [
    `Use specific SQLSTATE codes (or your own class like <code>'U0001'</code>) and document them for API clients.`,
    `Prefer prevention (<code>ON CONFLICT</code>, <code>NULLIF</code>, <code>EXISTS</code> checks) over catching expected errors.`,
    `Re-throw with bare <code>RAISE;</code> after logging when you cannot truly handle an error.`,
    `For SECURITY DEFINER: pin <code>search_path</code> with <code>pg_temp</code> last, schema-qualify objects, validate inputs, revoke PUBLIC execute, and keep the owner a non-superuser.`,
    `Include <code>DETAIL</code> and <code>HINT</code> so the message is actionable for application developers.`
  ],
  performance: `<p>An exception block costs a subtransaction: on the order of microseconds to enter, but each one that writes consumes a transaction ID (accelerating wraparound pressure) and more than 64 nested/active subtransactions in a session cause <strong>subtransaction overflow</strong>, which can slow every session's visibility checks (<code>SubtransSLRU</code> waits). Benchmarks commonly show a loop with a per-row exception block running 2–3× slower than without. Use a single block around the whole operation where possible, and <code>ON CONFLICT</code> for duplicates.</p>`,
  security: `<p>SECURITY DEFINER functions are privilege escalation by design — treat each as an API endpoint. Pin <code>search_path</code>, never build dynamic SQL from parameters without <code>format('%I')</code>/<code>%L</code> or <code>USING</code>, avoid returning more data than needed, and do not let a superuser own them. Error messages can leak data (e.g. the <code>DETAIL</code> of a unique violation includes the duplicate key value); consider what you expose to end users.</p>`,
  scenario: { title: 'A security review flags a SECURITY DEFINER function', steps: [
    '1. List them: SELECT proname, proowner::regrole, proconfig FROM pg_proc WHERE prosecdef;',
    '2. For any with proconfig NULL, add ALTER FUNCTION ... SET search_path = pg_catalog, public, pg_temp.',
    '3. Check for EXECUTE with concatenated parameters; rewrite with format(%I/%L) or USING.',
    '4. REVOKE EXECUTE FROM PUBLIC and GRANT only to the roles that need it.',
    '5. Change ownership from postgres to a dedicated, minimally privileged owner role.',
    '6. Add tests that call the function as the low-privilege role.'
  ] },
  widgets: ['lab:security', 'lab:txn'],
  interview: [
    { q: 'What happens to changes made in a PL/pgSQL block when an exception is caught by that block?', a: 'Entering a block with an EXCEPTION clause starts a subtransaction. When an error is caught, the subtransaction is rolled back, undoing all database changes made in that block, while changes made before the block are kept. Variables keep their values.' },
    { q: 'Why must SECURITY DEFINER functions set search_path?', a: 'Unqualified names inside the function are resolved using the caller’s search_path, which the caller controls. A malicious user can create objects (including temp tables) that shadow the intended ones and run arbitrary code with the owner’s privileges. Setting search_path with pg_temp last, or schema-qualifying everything, closes this hole.' },
    { q: 'How would you capture the constraint name and context of a caught error?', a: 'Inside the handler, use GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME, v_ctx = PG_EXCEPTION_CONTEXT, v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE, then log them.' },
    { q: 'What is subtransaction overflow?', a: 'Each backend caches up to 64 subtransaction XIDs in shared memory. Beyond that, visibility checks by any session must look up pg_subtrans on disk/SLRU, which can cause severe contention. Heavy use of exception blocks or savepoints in long transactions triggers it.' }
  ],
  exercises: [
    { task: 'Write a function get_employee_email(p_id int) that uses SELECT ... INTO STRICT and converts NO_DATA_FOUND into a friendly exception with HINT. Call it inside a DO block that catches and prints the message.', solution: `CREATE FUNCTION get_employee_email(p_id int) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
  SELECT email INTO STRICT v FROM employees WHERE id = p_id;
  RETURN v;
EXCEPTION WHEN no_data_found THEN
  RAISE EXCEPTION 'Employee % does not exist', p_id USING HINT = 'Check the id';
END $$;

DO $$
BEGIN
  PERFORM get_employee_email(999999);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'error: % / %', SQLSTATE, SQLERRM;
END $$;`, run: true },
    { task: 'Show that an exception block undoes its own changes: inside a DO block, update department 1 budget in an inner block that then divides by zero; catch it and print the budget afterwards.', solution: `DO $$
DECLARE b numeric;
BEGIN
  BEGIN
    UPDATE departments SET budget = 1 WHERE id = 1;
    PERFORM 1 / 0;
  EXCEPTION WHEN division_by_zero THEN
    RAISE NOTICE 'caught division by zero';
  END;
  SELECT budget INTO b FROM departments WHERE id = 1;
  RAISE NOTICE 'budget is still %', b;
END $$;`, run: true }
  ],
  challenge: { task: 'Create a SECURITY DEFINER function change_role(p_user_id int, p_role text) with a pinned search_path that validates p_role against the allowed list, raises invalid_parameter_value otherwise, writes the change to audit_logs, and revoke PUBLIC execute. Test with one valid and one invalid call (catch the invalid one).', hint: 'Use p_role = ANY(ARRAY[...]); INSERT INTO public.audit_logs(table_name, operation, row_id, old_data, new_data).', solution: `CREATE FUNCTION change_role(p_user_id int, p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_old text;
BEGIN
  IF NOT p_role = ANY (ARRAY['admin','manager','analyst','viewer']) THEN
    RAISE EXCEPTION 'invalid role %', p_role USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.users u SET role = p_role
  FROM (SELECT id, role FROM public.users WHERE id = p_user_id FOR UPDATE) old
  WHERE u.id = old.id
  RETURNING old.role INTO v_old;
  IF v_old IS NULL THEN RAISE EXCEPTION 'user % not found', p_user_id; END IF;
  INSERT INTO public.audit_logs (table_name, operation, row_id, old_data, new_data)
  VALUES ('users', 'UPDATE', p_user_id, jsonb_build_object('role', v_old), jsonb_build_object('role', p_role));
END $$;

REVOKE EXECUTE ON FUNCTION change_role(int, text) FROM PUBLIC;

SELECT change_role(3, 'analyst');
DO $$ BEGIN
  PERFORM change_role(3, 'superhero');
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'rejected: %', SQLERRM;
END $$;
SELECT operation, row_id, old_data, new_data FROM audit_logs ORDER BY id DESC LIMIT 1;`, run: true },
  related: ['functions-plpgsql-basics', 'transactions', 'security', 'triggers-audit-logging'],
  quiz: [
    { type: 'mcq', q: 'Which RAISE level aborts the current transaction?', options: ['NOTICE', 'WARNING', 'EXCEPTION', 'LOG'], answer: 2, explain: 'Only EXCEPTION (the default level) raises an error; the others just emit messages.' },
    { type: 'tf', q: 'Entering a BEGIN block that has an EXCEPTION clause creates a subtransaction even if no error occurs.', answer: true, explain: 'The savepoint is established on entry so it can be rolled back if an error happens; it is released on normal exit.' },
    { type: 'bug', q: 'What is the security problem?', code: `CREATE FUNCTION purge_user(p text) RETURNS void
LANGUAGE sql SECURITY DEFINER
AS $$ DELETE FROM users WHERE username = p $$;`, options: ['DELETE is not allowed in SQL functions', 'No pinned search_path and EXECUTE is granted to PUBLIC by default', 'It should be STABLE', 'It needs RETURNS boolean'], answer: 1, explain: 'Any role can call it (default PUBLIC execute) and the unqualified "users" can be shadowed via search_path, e.g. a temp table.' },
    { type: 'optimize', q: 'A loader inserts 5M rows, each in its own BEGIN ... EXCEPTION WHEN unique_violation block. Best fix?', code: `FOR r IN ... LOOP
  BEGIN INSERT INTO t VALUES (r.*);
  EXCEPTION WHEN unique_violation THEN NULL; END;
END LOOP;`, options: ['Increase work_mem', 'Use INSERT ... SELECT ... ON CONFLICT DO NOTHING', 'Use WHEN OTHERS instead', 'Add SECURITY DEFINER'], answer: 1, explain: 'ON CONFLICT handles duplicates without subtransactions and as a single set-based statement.' },
    { type: 'mcq', q: 'Which SQLSTATE class indicates integrity constraint violations such as unique_violation (23505)?', options: ['22', '23', '40', 'P0'], answer: 1, explain: 'Class 23 is integrity constraint violation; 22 is data exception, 40 transaction rollback, P0 PL/pgSQL.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: procedures
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'procedures-create-call',
  module: 'procedures',
  title: 'CREATE PROCEDURE, CALL and Transaction Control in Batches',
  level: 3,
  minutes: 22,
  summary: 'Write stored procedures, invoke them with CALL, return values through INOUT/OUT parameters, and COMMIT inside a procedure to process huge tables in small, safe batches.',
  objectives: [
    'Create a procedure with CREATE PROCEDURE and run it with CALL',
    'Return values from a procedure with INOUT and OUT parameters',
    'Use COMMIT and ROLLBACK inside a procedure body',
    'Process millions of rows in chunks to keep locks, WAL bursts and bloat small',
    'Know the restrictions: no COMMIT inside an explicit transaction block, SECURITY DEFINER or SET clauses'
  ],
  concept: `<p>A <strong>procedure</strong> <span class="tag core">core</span> (PostgreSQL 11+) is a stored routine invoked with <code>CALL</code> rather than inside a query. The headline difference from a function: a procedure may <strong>control transactions</strong> — it can <code>COMMIT</code> or <code>ROLLBACK</code> partway through and keep going in a fresh transaction.</p>
<p>Analogy: a function is a <em>calculator</em> you use while filling in one form — it cannot submit the form. A procedure is a <em>clerk processing a stack of 10 000 forms</em>: every 500 forms they file the batch (COMMIT), so a power cut at form 9 800 loses only the current batch, and the filing cabinet is never locked for the whole afternoon.</p>
<h4>Key facts</h4>
<ul>
<li><code>CALL proc(args)</code> is a top-level statement; procedures cannot be used in <code>SELECT</code>.</li>
<li>Procedures have no <code>RETURNS</code>. They return values through <code>INOUT</code> parameters and, since PostgreSQL 14, <code>OUT</code> parameters (pass <code>NULL</code> as a placeholder for them in <code>CALL</code>). <code>CALL</code> returns one row with those values.</li>
<li><code>COMMIT</code>/<code>ROLLBACK</code> in a procedure ends the current transaction and starts a new one automatically. Add <code>AND CHAIN</code> to keep the same isolation characteristics.</li>
<li>Transaction control only works when the <code>CALL</code> is <em>not</em> inside an explicit <code>BEGIN ... COMMIT</code> block, and only through a chain of <code>CALL</code>/<code>DO</code> — if a procedure is reached via a function or <code>SELECT</code>, <code>COMMIT</code> raises <code>invalid transaction termination</code>.</li>
<li>A procedure that commits cannot be <code>SECURITY DEFINER</code> or carry <code>SET</code> clauses, and cannot commit inside a block with an <code>EXCEPTION</code> clause.</li>
</ul>
<div class="callout info">Batch processing with intermediate commits works because each committed chunk releases its row locks and lets autovacuum clean up dead tuples from earlier chunks while the job continues.</div>`,
  why: `<p>Before PostgreSQL 11, any server-side routine ran inside the caller's single transaction. Archiving 50 million audit rows in one <code>DELETE</code> meant one gigantic transaction: millions of row locks, a huge WAL burst that lags replicas, dead tuples that cannot be vacuumed until the end, and a full rollback of hours of work if anything fails at 99%. Procedures let you keep that logic in the database while committing in chunks.</p>`,
  useCase: `<p>A logistics company keeps 18 months of tracking events (2.4 billion rows) and must archive anything older nightly — roughly 6 million rows per night. A procedure <code>archive_events(p_before, p_batch =&gt; 20000)</code> moves rows with <code>WITH moved AS (DELETE ... RETURNING *) INSERT INTO archive ...</code>, commits after each batch, and sleeps briefly between batches with <code>pg_sleep(0.05)</code>. Replica lag stayed under 2 seconds (versus 4 minutes for the single-statement version), and a failure at batch 250 only redid one batch on retry.</p>`,
  internals: `<p>Procedures are stored in <code>pg_proc</code> with <code>prokind = 'p'</code>. When <code>CALL</code> is executed at top level (a "non-atomic" context), PL/pgSQL is told it may manage transactions. <code>COMMIT</code> inside the procedure calls <code>SPI_commit()</code>, which commits the current transaction and immediately starts a new one; open <code>FOR</code> loop cursors are converted to holdable cursors so the loop can continue. If the call stack contains a function or a <code>SELECT</code>, the context is "atomic" and transaction control raises SQLSTATE <code>2D000</code>. Each committed batch gets its own XID and its own WAL commit record, so <code>synchronous_commit</code> latency applies per batch.</p>`,
  whenNot: `<p>Do not use a procedure when you need a value inside a query — that is a function's job. Do not commit in chunks when the operation must be all-or-nothing (e.g. moving money between two accounts): partial completion would be a correctness bug. For scheduled jobs, the procedure still needs a scheduler — the <code>pg_cron</code> extension <span class="tag ext">extension</span> or an external one; PostgreSQL has no built-in job scheduler. And remember connection poolers in transaction mode (PgBouncer <span class="tag tool">third-party tool</span>) are fine with CALL, but a long batch procedure holds its server connection for the whole run.</p>`,
  syntax: `CREATE [ OR REPLACE ] PROCEDURE name ( [ [ IN | OUT | INOUT | VARIADIC ] argname argtype [ DEFAULT expr ] [, ...] ] )
  LANGUAGE plpgsql | sql
  [ SECURITY INVOKER | SECURITY DEFINER ]   -- DEFINER cannot COMMIT
  AS $$ ... COMMIT; ... ROLLBACK; ... $$;

CALL name ( args );                  -- OUT params: pass NULL placeholders
COMMIT [ AND CHAIN ];  ROLLBACK [ AND CHAIN ];   -- inside the body
DROP PROCEDURE [ IF EXISTS ] name ( argtypes );`,
  examples: [
    { label: 'Basic', title: 'A simple procedure invoked with CALL',
      sql: `CREATE PROCEDURE give_department_raise(p_dept_id int, p_pct numeric)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_pct <= 0 OR p_pct > 20 THEN
    RAISE EXCEPTION 'raise % %% is outside the allowed 0-20 %% range', p_pct;
  END IF;

  UPDATE employees
     SET salary = round(salary * (1 + p_pct / 100), 2)
   WHERE department_id = p_dept_id
     AND is_active;

  RAISE NOTICE 'department %: % employees updated', p_dept_id, (SELECT count(*) FROM employees WHERE department_id = p_dept_id AND is_active);
END;
$$;

CALL give_department_raise(5, 3);

SELECT round(avg(salary), 2) AS hr_avg_salary
FROM employees WHERE department_id = 5 AND is_active;`,
      explain: `<p><code>CREATE PROCEDURE</code> has no <code>RETURNS</code> clause. <code>CALL</code> runs it as a standalone statement. Inside a RAISE format string, <code>%%</code> prints a literal percent sign. The procedure validates its input first, then performs a set-based <code>UPDATE</code>. Without any <code>COMMIT</code> in the body it behaves like a function that is called differently — it simply joins the caller's transaction.</p>`,
      output: `NOTICE:  department 5: 22 employees updated
 hr_avg_salary
---------------
 107911.23
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Returning values: INOUT and OUT parameters',
      sql: `CREATE PROCEDURE transfer_budget(
  p_from_dept int,
  p_to_dept   int,
  p_amount    numeric,
  OUT from_budget numeric,      -- OUT params in procedures: PostgreSQL 14+
  OUT to_budget   numeric
)
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE departments SET budget = budget - p_amount
   WHERE id = p_from_dept
  RETURNING budget INTO from_budget;

  IF from_budget < 0 THEN
    RAISE EXCEPTION 'department % would go negative', p_from_dept;
  END IF;

  UPDATE departments SET budget = budget + p_amount
   WHERE id = p_to_dept
  RETURNING budget INTO to_budget;
END;
$$;

-- pass NULL as a placeholder for each OUT parameter
CALL transfer_budget(1, 8, 250000, NULL, NULL);`,
      explain: `<p>OUT parameters are filled by the body (<code>RETURNING ... INTO</code>), and <code>CALL</code> returns them as a one-row result. In the <code>CALL</code> you must supply something for OUT parameters — conventionally <code>NULL</code>. Because there is no intermediate <code>COMMIT</code>, the exception path rolls back both updates: a budget transfer must be atomic, so this procedure deliberately does <em>not</em> commit in the middle.</p>`,
      output: ` from_budget | to_budget
-------------+------------
 4950000.00  | 2750000.00
(1 row)`, run: true },
    { label: 'Advanced', title: 'Archiving in chunks with COMMIT inside the procedure',
      sql: `CREATE TABLE audit_logs_archive (LIKE audit_logs INCLUDING ALL);

CREATE PROCEDURE archive_audit_logs(p_before timestamptz, p_batch int DEFAULT 100)
LANGUAGE plpgsql
AS $$
DECLARE
  v_moved int;
  v_total int := 0;
  v_round int := 0;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM audit_logs
      WHERE changed_at < p_before
      ORDER BY id
      LIMIT p_batch
      FOR UPDATE SKIP LOCKED          -- do not fight with concurrent writers
    ), moved AS (
      DELETE FROM audit_logs a
      USING batch b
      WHERE a.id = b.id
      RETURNING a.*
    )
    INSERT INTO audit_logs_archive OVERRIDING SYSTEM VALUE
    SELECT * FROM moved;

    GET DIAGNOSTICS v_moved = ROW_COUNT;
    EXIT WHEN v_moved = 0;

    v_total := v_total + v_moved;
    v_round := v_round + 1;
    COMMIT;                            -- release locks, make progress durable
    RAISE NOTICE 'batch %: moved % rows (total %)', v_round, v_moved, v_total;
  END LOOP;
END;
$$;

-- must run outside an explicit BEGIN ... COMMIT block
CALL archive_audit_logs('2026-01-11', 100);

SELECT (SELECT count(*) FROM audit_logs)         AS remaining,
       (SELECT count(*) FROM audit_logs_archive) AS archived;`,
      explain: `<p>Each loop iteration selects up to 100 old rows (<code>FOR UPDATE SKIP LOCKED</code> avoids blocking on rows another session is touching), deletes them and inserts the deleted rows into the archive in one statement via a data-modifying CTE. <code>OVERRIDING SYSTEM VALUE</code> keeps the original identity ids. <code>COMMIT</code> ends the transaction after every batch, so locks are released and finished work is durable; PL/pgSQL automatically starts a new transaction for the next batch. Rows before <code>2026-01-11</code> (the first 239 hourly audit events) are moved in three batches.</p>`,
      output: `NOTICE:  batch 1: moved 100 rows (total 100)
NOTICE:  batch 2: moved 100 rows (total 200)
NOTICE:  batch 3: moved 39 rows (total 239)
 remaining | archived
-----------+----------
 61        | 239
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- One giant transaction: every row locked until the end, one WAL burst,
-- and a failure at the last row undoes everything
CREATE TABLE audit_archive_bad (LIKE audit_logs INCLUDING ALL);
WITH moved AS (DELETE FROM audit_logs WHERE changed_at < '2026-01-11' RETURNING *)
INSERT INTO audit_archive_bad OVERRIDING SYSTEM VALUE SELECT * FROM moved;`,
      why: 'Fine for 239 rows, dangerous for 50 million: long-held locks, replica lag, bloat that vacuum cannot clean until the end, and all-or-nothing retries.', run: true },
    good: { sql: `CREATE TABLE audit_archive_good (LIKE audit_logs INCLUDING ALL);
CREATE PROCEDURE archive_good(p_before timestamptz, p_batch int) LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  LOOP
    WITH moved AS (
      DELETE FROM audit_logs WHERE id IN (
        SELECT id FROM audit_logs WHERE changed_at < p_before ORDER BY id LIMIT p_batch)
      RETURNING *)
    INSERT INTO audit_archive_good OVERRIDING SYSTEM VALUE SELECT * FROM moved;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    COMMIT;
  END LOOP;
END $$;
CALL archive_good('2026-01-11', 100);
SELECT count(*) AS archived FROM audit_archive_good;`,
      why: 'Chunks with COMMIT keep each transaction short, so locks are brief, vacuum can work in parallel, and progress survives failures.', run: true }
  },
  mistakes: [
    `Calling a committing procedure inside <code>BEGIN; ... COMMIT;</code> — it fails with <code>invalid transaction termination</code>. Many drivers open a transaction implicitly (autocommit off); make sure autocommit is on for the CALL.`,
    `Trying to <code>SELECT my_procedure()</code>; procedures are only invoked with <code>CALL</code>.`,
    `Committing in the middle of logic that must be atomic, such as debit + credit.`,
    `Using <code>OFFSET</code>-based batching (<code>LIMIT 1000 OFFSET n</code>) — it gets slower each batch and skips rows when earlier rows are deleted. Use keyset/id-based batching.`,
    `Forgetting OUT-parameter placeholders in <code>CALL</code> (PG14+ requires an argument for each OUT parameter).`,
    `Wrapping a <code>COMMIT</code> inside a <code>BEGIN ... EXCEPTION</code> block, which is not allowed.`
  ],
  best: [
    `Use procedures for batch jobs, maintenance and ETL; use functions for computations used in queries.`,
    `Batch by primary key ranges or <code>ORDER BY id LIMIT n</code> with an index, never with <code>OFFSET</code>.`,
    `Pick batch sizes that keep each transaction under a second or two (typically 1 000–50 000 rows).`,
    `Make batch procedures idempotent and restartable: each batch should be safe to re-run.`,
    `Log progress with <code>RAISE NOTICE</code> or into a progress table so operators can see where a job is.`
  ],
  performance: `<p>Each <code>COMMIT</code> forces a WAL flush (unless <code>synchronous_commit = off</code>), costing roughly 0.1–2 ms on SSD storage; batches that are too small (10 rows) spend more time committing than working, batches that are too large recreate the giant-transaction problem. Short transactions also let autovacuum reclaim dead tuples created by earlier batches and keep the <code>xmin</code> horizon moving, which matters on busy OLTP systems. For index-friendly batching, make sure the batch predicate (<code>changed_at &lt; ...</code>) and ordering column are indexed; otherwise every batch re-scans the table.</p>`,
  security: `<p>Procedures are invoked with <code>EXECUTE</code> privilege like functions, granted to <code>PUBLIC</code> by default — revoke it for maintenance procedures. A procedure that needs to commit cannot be <code>SECURITY DEFINER</code>; instead, run the job as a dedicated maintenance role that has exactly the privileges it needs.</p>`,
  scenario: { title: 'Deleting 40 million expired sessions without hurting production', steps: [
    '1. Verify an index exists on the expiry column used to find candidate rows.',
    '2. Write a procedure that deletes WHERE id IN (SELECT id ... ORDER BY id LIMIT 10000) and COMMITs per batch.',
    '3. Add pg_sleep(0.05) between batches if replicas lag; log progress with RAISE NOTICE.',
    '4. Run CALL from psql or the scheduler with autocommit on (not inside BEGIN).',
    '5. Watch pg_stat_activity, replication lag and autovacuum on the table while it runs.',
    '6. After completion, consider partitioning by time so future purges are DROP PARTITION.'
  ] },
  widgets: ['lab:txn'],
  interview: [
    { q: 'What can a procedure do that a function cannot?', a: 'A procedure invoked with CALL in a non-atomic context can COMMIT or ROLLBACK and continue in a new transaction. A function always runs inside the caller’s transaction and cannot end it.' },
    { q: 'Why would CALL my_proc() fail with "invalid transaction termination"?', a: 'Because the call happened in an atomic context: inside an explicit transaction block, from a function, or via SELECT. Transaction control is only allowed when CALL is issued at top level (or nested through CALL/DO chains) with no surrounding transaction block.' },
    { q: 'How do you return values from a procedure?', a: 'With INOUT parameters, and since PostgreSQL 14 also OUT parameters. CALL returns a single row containing their final values; callers pass NULL placeholders for OUT arguments.' },
    { q: 'Why batch large deletes instead of using one statement?', a: 'One huge transaction holds row locks and a snapshot for its whole duration, generates a WAL burst that lags replicas, blocks vacuum from cleaning dead tuples, and must be fully rolled back on failure. Batches keep each transaction short and the job restartable.' }
  ],
  exercises: [
    { task: 'Create a procedure deactivate_stale_users(p_before timestamptz, INOUT p_count int DEFAULT 0) that sets is_active = false for users whose last_login is before p_before and returns how many were changed. CALL it with 2026-02-15.', solution: `CREATE PROCEDURE deactivate_stale_users(p_before timestamptz, INOUT p_count int DEFAULT 0)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users SET is_active = false
  WHERE last_login < p_before AND is_active;
  GET DIAGNOSTICS p_count = ROW_COUNT;
END $$;

CALL deactivate_stale_users('2026-02-15');`, run: true },
    { task: 'Write a procedure that marks orders older than 2024-03-01 with status pending as cancelled in batches of 20, committing after each batch, then CALL it and count the remaining old pending orders.', solution: `CREATE PROCEDURE cancel_old_pending(p_before timestamptz, p_batch int) LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  LOOP
    UPDATE orders SET status = 'cancelled'
    WHERE id IN (SELECT id FROM orders
                 WHERE status = 'pending' AND order_date < p_before
                 ORDER BY id LIMIT p_batch);
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    COMMIT;
  END LOOP;
END $$;

CALL cancel_old_pending('2024-03-01', 20);
SELECT count(*) FROM orders WHERE status = 'pending' AND order_date < '2024-03-01';`, run: true }
  ],
  challenge: { task: 'Write a procedure recalc_order_totals(p_batch int) that recomputes orders.total_amount from order_items in id ranges of p_batch orders (keyset pagination on id), commits after each range, and raises a NOTICE every range. Call it with 1000.', hint: 'Track v_last_id; UPDATE orders o SET total_amount = s.total FROM (SELECT order_id, sum(quantity*unit_price) total FROM order_items WHERE order_id > v_last_id AND order_id <= v_last_id + p_batch GROUP BY order_id) s WHERE o.id = s.order_id.', solution: `CREATE PROCEDURE recalc_order_totals(p_batch int) LANGUAGE plpgsql AS $$
DECLARE
  v_last bigint := 0;
  v_max  bigint;
  n int;
BEGIN
  SELECT max(id) INTO v_max FROM orders;
  WHILE v_last < v_max LOOP
    UPDATE orders o SET total_amount = s.total
    FROM (SELECT order_id, sum(quantity * unit_price) AS total
          FROM order_items
          WHERE order_id > v_last AND order_id <= v_last + p_batch
          GROUP BY order_id) s
    WHERE o.id = s.order_id AND o.total_amount IS DISTINCT FROM s.total;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'ids % - %: % orders corrected', v_last + 1, v_last + p_batch, n;
    v_last := v_last + p_batch;
    COMMIT;
  END LOOP;
END $$;

CALL recalc_order_totals(1000);`, run: true },
  related: ['procedures-vs-functions', 'functions-plpgsql-basics', 'transactions', 'vacuum'],
  quiz: [
    { type: 'mcq', q: 'How is a procedure invoked?', options: ['SELECT proc()', 'PERFORM proc()', 'CALL proc()', 'EXECUTE proc()'], answer: 2, explain: 'Procedures are invoked with CALL; they cannot appear in SELECT.' },
    { type: 'tf', q: 'A procedure containing COMMIT works when called inside BEGIN; CALL p(); COMMIT;', answer: false, explain: 'Inside an explicit transaction block the call is atomic, so COMMIT raises invalid transaction termination.' },
    { type: 'bug', q: 'This batch job gets slower every batch and misses rows. Why?', code: `LOOP
  DELETE FROM sessions WHERE id IN
    (SELECT id FROM sessions WHERE expired ORDER BY id LIMIT 1000 OFFSET v_offset);
  v_offset := v_offset + 1000;
  COMMIT;
END LOOP;`, options: ['COMMIT is not allowed in loops', 'OFFSET skips rows that shifted after deletes and rescans more each time', 'LIMIT must be 100', 'ORDER BY is not allowed in subqueries'], answer: 1, explain: 'After deleting the first 1000 rows, the next 1000 expired rows are now at offset 0; OFFSET 1000 skips them. Just repeat LIMIT without OFFSET, or use keyset ranges.' },
    { type: 'design', q: 'You need to move money between two accounts. Should the procedure COMMIT after the debit?', options: ['Yes, to release locks early', 'No, debit and credit must be in the same transaction', 'Only if the amount is large', 'Yes, with AND CHAIN'], answer: 1, explain: 'Transfers must be atomic; committing between the debit and credit would allow a state where money disappeared.' }
  ]
},
{
  id: 'procedures-vs-functions',
  module: 'procedures',
  title: 'Functions vs Procedures: Choosing the Right Routine',
  level: 3,
  minutes: 15,
  summary: 'A side-by-side comparison of functions and procedures — invocation, return values, transaction control, usage in queries — with rules of thumb for choosing between them.',
  objectives: [
    'Compare functions and procedures across invocation, return values and transaction control',
    'Demonstrate why a function cannot COMMIT',
    'Use ROLLBACK inside a procedure to implement a dry-run mode',
    'Choose functions, procedures, DO blocks or plain SQL for a given task'
  ],
  concept: `<p>Functions and procedures share the same catalog (<code>pg_proc</code>), languages and parameter syntax, but they play different roles. Analogy: a <strong>function</strong> is a <em>measuring tool</em> — you use it while doing something else (inside a query) and it hands back a value. A <strong>procedure</strong> is a <em>work order</em> — you dispatch it on its own (<code>CALL</code>), it performs a job, and it may close out several pieces of work (transactions) along the way.</p>
<table>
<tr><th>Aspect</th><th>Function</th><th>Procedure</th></tr>
<tr><td>Created with</td><td><code>CREATE FUNCTION</code></td><td><code>CREATE PROCEDURE</code> (PG11+)</td></tr>
<tr><td>Invoked with</td><td>Any expression: <code>SELECT f()</code>, <code>WHERE</code>, <code>FROM f()</code>, triggers, defaults, indexes</td><td>Only <code>CALL p()</code> (or from another procedure / DO block)</td></tr>
<tr><td>Return value</td><td>Required: scalar, composite, <code>SETOF</code>, <code>TABLE</code>, <code>void</code>, <code>trigger</code></td><td>None; results via <code>INOUT</code> / <code>OUT</code> (PG14+) as one row</td></tr>
<tr><td>Returns a set of rows</td><td>Yes</td><td>No (use a function, or a refcursor INOUT)</td></tr>
<tr><td>COMMIT / ROLLBACK inside</td><td>Never</td><td>Yes, when called in a non-atomic context</td></tr>
<tr><td>Volatility / PARALLEL / STRICT / COST / ROWS</td><td>Yes — used by the planner</td><td>Not applicable</td></tr>
<tr><td>Usable in index, generated column, CHECK</td><td>Yes (IMMUTABLE)</td><td>No</td></tr>
<tr><td>Trigger function</td><td>Yes (<code>RETURNS trigger</code>)</td><td>No</td></tr>
<tr><td>Inlining by planner</td><td>Possible for simple SQL functions</td><td>No</td></tr>
<tr><td><code>pg_proc.prokind</code></td><td><code>f</code></td><td><code>p</code></td></tr>
</table>
<p>The third option is the anonymous <strong>DO block</strong>: PL/pgSQL code run once without being stored. It returns nothing, can commit (PG11+) when not inside a transaction block, and is ideal for one-off migrations and scripts.</p>`,
  why: `<p>Choosing the wrong routine type causes avoidable pain: a "procedure-like" function that tries to commit fails at runtime; a "function-like" procedure cannot be used in a report query; a migration written as a stored function clutters the schema forever. Knowing the matrix lets you put each piece of logic where it fits naturally.</p>`,
  useCase: `<p>A retail analytics team standardised on three rules: (1) <strong>functions</strong> for anything a query needs — pricing, classification, parameterised reports (<code>RETURNS TABLE</code>); (2) <strong>procedures</strong> for nightly jobs — order archiving, recalculating loyalty points for 8 million customers in 50 000-row commits, with a <code>p_dry_run</code> flag that rolls back; (3) <strong>DO blocks</strong> in migration files only. Their Flyway <span class="tag tool">third-party tool</span> migrations stayed free of throwaway stored routines, and on-call engineers always knew that "CALL" means "batch job, may commit".</p>`,
  internals: `<p>Both kinds are executed by the same language handlers (e.g. <code>plpgsql_call_handler</code>). The difference is the <em>execution context</em>: <code>ExecuteCallStmt</code> passes a non-atomic flag when the CALL is at top level and outside a transaction block, which allows <code>SPI_commit</code>/<code>SPI_rollback</code>. Function calls from the executor are always atomic. Procedures return their INOUT/OUT values as a single tuple built after the body finishes.</p>`,
  whenNot: `<p>Do not create stored routines at all for logic that is simply a query — a view or a plain query in the application is easier to version and review. Do not use procedures merely because "procedure" sounds like the traditional term from other databases (e.g. SQL Server stored procedures that return result sets); in PostgreSQL, routines that return rows are functions.</p>`,
  syntax: `-- function: used in expressions, must return something
CREATE FUNCTION f(args) RETURNS type LANGUAGE ... AS $$ ... $$;
SELECT f(1);   SELECT * FROM f(1);

-- procedure: invoked alone, may manage transactions
CREATE PROCEDURE p(args, INOUT x type, OUT y type) LANGUAGE ... AS $$ ... COMMIT; ... $$;
CALL p(1, NULL, NULL);

-- anonymous block: run once, nothing stored
DO $$ BEGIN ... END $$;`,
  examples: [
    { label: 'Basic', title: 'The same logic as a function and as a procedure',
      sql: `-- Function: value usable inside queries
CREATE FUNCTION project_load(p_project_id int) RETURNS int
LANGUAGE sql STABLE
AS $$ SELECT coalesce(sum(allocation_pct), 0)::int
      FROM employee_projects WHERE project_id = p_project_id $$;

-- Procedure: returns its result through an INOUT parameter
CREATE PROCEDURE project_load_proc(p_project_id int, INOUT p_load int DEFAULT NULL)
LANGUAGE sql
AS $$ SELECT coalesce(sum(allocation_pct), 0)::int
      FROM employee_projects WHERE project_id = p_project_id $$;

CALL project_load_proc(1);   -- returns one row with p_load

SELECT p.name, project_load(p.id) AS total_allocation
FROM projects p
ORDER BY total_allocation DESC, p.name
LIMIT 5;`,
      explain: `<p>The function plugs straight into a <code>SELECT</code> over all projects. The procedure can only be <code>CALL</code>ed one at a time and hands back its value as a single-row result (<code>p_load</code>). For "compute a value per row", the function is the natural fit. The output shows the function result; the <code>CALL</code> would return a one-row table with column <code>p_load</code>.</p>`,
      output: ` name             | total_allocation
------------------+------------------
 Project Borealis | 1200
 Project Delta    | 1200
 Project Falcon   | 1200
 Project Helix    | 1200
 Project Jupiter  | 1200
(5 rows)`, run: true },
    { label: 'Intermediate', title: 'Proof: a function cannot COMMIT',
      sql: `CREATE FUNCTION try_commit() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE departments SET budget = budget WHERE id = 1;
  COMMIT;                              -- not allowed in a function
END;
$$;

DO $$
BEGIN
  PERFORM try_commit();
EXCEPTION WHEN invalid_transaction_termination THEN
  RAISE NOTICE 'SQLSTATE %: %', SQLSTATE, SQLERRM;
END $$;

SELECT prokind, count(*)
FROM pg_proc
WHERE pronamespace = 'pg_catalog'::regnamespace
GROUP BY prokind
ORDER BY prokind;`,
      explain: `<p>PostgreSQL accepts the function definition (PL/pgSQL is only syntax-checked), but at runtime <code>COMMIT</code> raises SQLSTATE <code>2D000</code> <em>invalid transaction termination</em>, which we catch and print. The catalog query shows how <code>pg_proc.prokind</code> separates kinds in <code>pg_catalog</code>: <code>a</code> aggregate, <code>f</code> function, <code>w</code> window function. There are no built-in procedures, so <code>p</code> only appears once you create one.</p>`,
      output: `NOTICE:  SQLSTATE 2D000: invalid transaction termination
 prokind | count
---------+-------
 a       | 161
 f       | 3226
 w       | 15
(3 rows)`, run: true },
    { label: 'Advanced', title: 'ROLLBACK inside a procedure: a dry-run switch for a batch job',
      sql: `CREATE PROCEDURE close_finished_projects(
  p_dry_run boolean DEFAULT true,
  INOUT p_closed int DEFAULT 0)
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE projects
     SET status = 'completed'
   WHERE status = 'planned'             -- still "planned" although the
     AND end_date IS NOT NULL           -- end date has already passed
     AND end_date < DATE '2025-06-01';
  GET DIAGNOSTICS p_closed = ROW_COUNT;

  IF p_dry_run THEN
    RAISE NOTICE 'dry run: would close % projects, rolling back', p_closed;
    ROLLBACK;                         -- undo, but keep the count in p_closed
  ELSE
    COMMIT;
  END IF;
END;
$$;

CALL close_finished_projects();                    -- dry run (default)
SELECT count(*) AS still_planned_but_finished
FROM projects
WHERE status = 'planned' AND end_date < DATE '2025-06-01';`,
      explain: `<p>The procedure performs the real update, counts the affected rows, and then either <code>ROLLBACK</code>s (dry run) or <code>COMMIT</code>s. Variables such as <code>p_closed</code> survive the rollback because they live in PL/pgSQL memory, not in the database. Operators can safely preview a job's impact before running it for real with <code>CALL close_finished_projects(false)</code>. A function could not do this — it can neither commit nor roll back the surrounding transaction.</p>`,
      output: `NOTICE:  dry run: would close 4 projects, rolling back
 still_planned_but_finished
----------------------------
 4
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Using a procedure for a per-row calculation forces clumsy one-at-a-time calls
CREATE PROCEDURE tax_of(p numeric, INOUT t numeric DEFAULT NULL)
LANGUAGE sql AS $$ SELECT round(p * 0.18, 2) $$;
CALL tax_of(1000);`,
      why: 'A procedure cannot be used in SELECT, so computing tax for 100 products needs 100 CALLs from the application.', run: true },
    good: { sql: `CREATE FUNCTION tax_of_fn(p numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURN round(p * 0.18, 2);
SELECT sku, price, tax_of_fn(price) AS gst FROM products ORDER BY id LIMIT 3;`,
      why: 'Calculations belong in functions: usable in any query, inlinable, indexable.', run: true }
  },
  mistakes: [
    `Writing a function that needs to commit, then discovering at runtime that it raises <code>invalid transaction termination</code>.`,
    `Writing a procedure where a function is needed (a value inside a query or an index).`,
    `Expecting a procedure to return a result set like SQL Server's stored procedures; use a set-returning function instead.`,
    `Storing one-time migration logic as permanent functions instead of DO blocks.`
  ],
  best: [
    `Function = computation or query helper; procedure = job with transaction control; DO = one-off script.`,
    `Give batch procedures a <code>p_dry_run boolean DEFAULT true</code> flag so the safe behaviour is the default.`,
    `Return job statistics (rows processed, batches) via INOUT/OUT parameters for logging.`,
    `Revoke PUBLIC execute on both functions and procedures that change data.`
  ],
  performance: `<p>There is no meaningful per-call performance difference between the two; the difference is what they allow. Functions get optimiser benefits (inlining, volatility-based caching, parallel safety) that procedures never participate in. Procedures enable operational performance: shorter transactions, less bloat, lower replica lag.</p>`,
  security: `<p>Both default to SECURITY INVOKER and both grant EXECUTE to PUBLIC. A procedure that uses transaction control cannot be SECURITY DEFINER, so privilege separation for batch jobs is done through roles: run the job as a role with exactly the needed table privileges.</p>`,
  scenario: { title: "A nightly job written as a function keeps failing", steps: [
    "1. Logs show: invalid transaction termination (SQLSTATE 2D000) at COMMIT.",
    "2. The routine is a FUNCTION invoked with SELECT nightly_job(); functions cannot commit.",
    "3. Convert it to CREATE PROCEDURE and invoke it with CALL from the scheduler.",
    "4. Make sure the scheduler connection uses autocommit (no surrounding BEGIN).",
    "5. Return statistics through INOUT/OUT parameters for the job log.",
    "6. Add a p_dry_run flag that ROLLBACKs, defaulting to true."
  ] },
  interview: [
    { q: 'Summarise the main differences between a function and a procedure in PostgreSQL.', a: 'Functions are called inside SQL expressions, must declare a return type, can return sets, have volatility/parallel attributes and can be used in indexes and triggers, but cannot control transactions. Procedures are invoked with CALL, return values only through INOUT/OUT parameters as a single row, and can COMMIT/ROLLBACK when called in a non-atomic context.' },
    { q: 'How would you return a large result set from a procedure?', a: 'Normally you would not — use a set-returning function. If a procedure must, it can open a cursor and return a refcursor through an INOUT parameter, and the client then FETCHes from it in the same transaction.' },
    { q: 'When would you use a DO block instead of either?', a: 'For one-off procedural logic such as data migrations or conditional DDL in deployment scripts. Nothing is stored in the catalog, and since PG11 a DO block can also COMMIT when run outside a transaction block.' }
  ],
  exercises: [
    { task: 'Write a DO block that loops over all departments and RAISEs a NOTICE with the department name and number of active projects.', solution: `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT d.name, count(p.id) FILTER (WHERE p.status = 'active') AS n
           FROM departments d LEFT JOIN projects p ON p.department_id = d.id
           GROUP BY d.name ORDER BY d.name LOOP
    RAISE NOTICE '%: % active projects', r.name, r.n;
  END LOOP;
END $$;`, run: true },
    { task: 'List every procedure in the public schema with its argument signature using pg_proc and pg_get_function_identity_arguments, after creating a small procedure noop(int).', solution: `CREATE PROCEDURE noop(p int) LANGUAGE sql AS $$ SELECT 1 $$;

SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE prokind = 'p' AND pronamespace = 'public'::regnamespace;`, run: true }
  ],
  challenge: { task: 'Write a procedure purge_cancelled_orders(p_dry_run boolean DEFAULT true, INOUT p_deleted int DEFAULT 0) that deletes cancelled orders before 2024-04-01 (their order_items cascade; payments must be deleted first), counts the deleted orders and rolls back on dry run. Call it in dry-run mode and confirm nothing was deleted.', hint: 'Delete payments for those orders first, then orders; GET DIAGNOSTICS after the orders delete; ROLLBACK when p_dry_run.', solution: `CREATE PROCEDURE purge_cancelled_orders(p_dry_run boolean DEFAULT true, INOUT p_deleted int DEFAULT 0)
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM payments WHERE order_id IN
    (SELECT id FROM orders WHERE status = 'cancelled' AND order_date < '2024-04-01');
  DELETE FROM orders WHERE status = 'cancelled' AND order_date < '2024-04-01';
  GET DIAGNOSTICS p_deleted = ROW_COUNT;
  IF p_dry_run THEN
    RAISE NOTICE 'dry run: % orders would be deleted', p_deleted;
    ROLLBACK;
  ELSE
    COMMIT;
  END IF;
END $$;

CALL purge_cancelled_orders();
SELECT count(*) FROM orders WHERE status = 'cancelled' AND order_date < '2024-04-01';`, run: true },
  related: ['procedures-create-call', 'functions-sql-functions', 'functions', 'transactions'],
  quiz: [
    { type: 'mcq', q: 'Which can be used inside an index expression?', options: ['An IMMUTABLE function', 'A procedure', 'A DO block', 'A STABLE procedure'], answer: 0, explain: 'Only IMMUTABLE functions are allowed in index expressions; procedures cannot appear in expressions at all.' },
    { type: 'tf', q: 'A procedure can return multiple rows directly from CALL.', answer: false, explain: 'CALL returns at most one row containing INOUT/OUT values. Use a set-returning function for row sets.' },
    { type: 'scenario', q: 'You need a routine that recalculates loyalty points for 8M customers nightly without long locks. What do you write?', options: ['IMMUTABLE function', 'Procedure that commits every N customers', 'View', 'Trigger'], answer: 1, explain: 'A batch job that must commit in chunks is the textbook use of a procedure.' },
    { type: 'predict', q: 'What is the value of pg_proc.prokind for an object created with CREATE PROCEDURE?', options: ["'f'", "'p'", "'a'", "'w'"], answer: 1, explain: 'p = procedure, f = function, a = aggregate, w = window function.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: triggers
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'triggers-fundamentals',
  module: 'triggers',
  title: 'Trigger Fundamentals: Timing, Level, NEW/OLD and TG_ Variables',
  level: 3,
  minutes: 25,
  summary: 'Understand how triggers fire — BEFORE, AFTER and INSTEAD OF; per row or per statement — and how trigger functions use NEW, OLD, TG_OP, TG_TABLE_NAME and WHEN conditions.',
  objectives: [
    'Write a trigger function (RETURNS trigger) and attach it with CREATE TRIGGER',
    'Explain BEFORE vs AFTER vs INSTEAD OF and ROW vs STATEMENT level',
    'Read and modify NEW/OLD, and know what returning NULL does',
    'Use TG_OP, TG_WHEN, TG_LEVEL, TG_TABLE_NAME and TG_ARGV',
    'Filter trigger execution cheaply with WHEN conditions and UPDATE OF column lists'
  ],
  concept: `<p>A <strong>trigger</strong> <span class="tag core">core</span> tells PostgreSQL: "whenever this kind of change happens to this table, run this function automatically". Analogy: a <em>motion-sensor light</em>. You do not switch it on yourself; the event (someone walks in) fires it. You decide <em>when</em> it reacts (before the door opens, or after), and <em>how often</em> (once per person, or once per group walking in).</p>
<h4>Two pieces</h4>
<ol>
<li>A <strong>trigger function</strong>: <code>CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql</code>, with no declared arguments (arguments come via <code>TG_ARGV</code>).</li>
<li>A <strong>trigger</strong> binding it to a table and event: <code>CREATE TRIGGER name BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION f();</code></li>
</ol>
<h4>Timing and level</h4>
<table>
<tr><th></th><th>FOR EACH ROW</th><th>FOR EACH STATEMENT</th></tr>
<tr><td><strong>BEFORE</strong></td><td>Runs before each row is written. Can <em>modify</em> <code>NEW</code> or return <code>NULL</code> to skip that row. Validation, normalisation, derived columns.</td><td>Runs once before the statement. Cannot see rows.</td></tr>
<tr><td><strong>AFTER</strong></td><td>Runs after each row is written (queued until end of statement). Sees final row values. Auditing, cascading changes to other tables.</td><td>Runs once after the statement, even if 0 rows changed. With transition tables can see all changed rows.</td></tr>
<tr><td><strong>INSTEAD OF</strong></td><td>Only on <em>views</em>; replaces the INSERT/UPDATE/DELETE on the view with your own logic.</td><td>Not supported.</td></tr>
</table>
<h4>Special variables in PL/pgSQL trigger functions</h4>
<ul>
<li><code>NEW</code> — the new row for INSERT/UPDATE (row-level); <code>OLD</code> — the old row for UPDATE/DELETE. In statement-level triggers both are NULL.</li>
<li><code>TG_OP</code> (<code>'INSERT'</code>, <code>'UPDATE'</code>, <code>'DELETE'</code>, <code>'TRUNCATE'</code>), <code>TG_WHEN</code> (<code>BEFORE</code>/<code>AFTER</code>/<code>INSTEAD OF</code>), <code>TG_LEVEL</code> (<code>ROW</code>/<code>STATEMENT</code>), <code>TG_TABLE_NAME</code>, <code>TG_TABLE_SCHEMA</code>, <code>TG_NAME</code>, <code>TG_RELID</code>, <code>TG_NARGS</code>/<code>TG_ARGV[]</code>.</li>
</ul>
<h4>What the function returns</h4>
<ul>
<li>BEFORE ROW: return <code>NEW</code> (possibly modified) to proceed, <code>OLD</code> for DELETE to proceed, or <code>NULL</code> to silently skip the operation for that row.</li>
<li>AFTER triggers and statement-level triggers: the return value is ignored — use <code>RETURN NULL</code>.</li>
</ul>
<p><strong>WHEN (condition)</strong> on <code>CREATE TRIGGER</code> is evaluated before the function is called — e.g. <code>WHEN (OLD.salary IS DISTINCT FROM NEW.salary)</code> — so non-matching rows cost almost nothing. <code>UPDATE OF col1, col2</code> fires only if those columns appear in the <code>SET</code> list. Multiple triggers on the same event fire in <strong>alphabetical order by name</strong>.</p>`,
  why: `<p>Some rules must hold no matter which application, script, ORM or DBA changes the data: emails are always lower-case, salary changes are always logged, a row's <code>updated_at</code> is always bumped. Putting these in every client is error-prone; one forgotten code path (a hot-fix SQL script at 2 a.m.) breaks the invariant. Triggers enforce it at the single choke point every write passes through.</p>`,
  useCase: `<p>An HR SaaS stores payroll for 1 200 client companies. Regulations require every salary change to be recorded with old and new value. Changes come from the web app, a bulk CSV importer, an integration API and occasional manual SQL. An <code>AFTER UPDATE OF salary ... FOR EACH ROW WHEN (OLD.salary IS DISTINCT FROM NEW.salary)</code> trigger writes to <code>salary_history</code>; a <code>BEFORE</code> trigger rejects raises above 50% unless a session flag is set. Auditors accepted the design because no code path can bypass it short of disabling the trigger, which itself requires table ownership and is logged.</p>`,
  internals: `<p>Triggers are stored in <code>pg_trigger</code> (<code>tgtype</code> is a bitmask of timing, level and events; <code>tgqual</code> stores the WHEN expression). The executor fires BEFORE ROW triggers inside <code>ExecInsert</code>/<code>ExecUpdate</code> just before the heap tuple is formed, so modifications to <code>NEW</code> are what gets stored. AFTER ROW triggers are queued in the <strong>after-trigger event queue</strong> (memory, spilling to disk only for transition tables) and fired at the end of the statement — or at commit if the trigger is a <code>DEFERRABLE INITIALLY DEFERRED</code> constraint trigger. Foreign keys themselves are implemented as internal AFTER triggers (<code>RI_FKey_*</code>), which is why you see them in <code>pg_trigger</code> with <code>tgisinternal = true</code>.</p>`,
  whenNot: `<p>Avoid triggers for complex business workflows (sending emails, calling APIs, multi-step orchestration) — they run synchronously inside the writer's transaction, are invisible to application developers reading code, and make bulk loads slow. Prefer <code>CHECK</code> constraints, <code>NOT NULL</code>, foreign keys, generated columns and <code>DEFAULT</code>s where they suffice: they are declarative and faster. For "notify something outside", write to an outbox table (or use <code>LISTEN/NOTIFY</code>) and let a worker do the external call.</p>`,
  syntax: `CREATE FUNCTION trg_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- NEW, OLD, TG_OP, TG_WHEN, TG_LEVEL, TG_TABLE_NAME, TG_ARGV[...]
  RETURN NEW;      -- BEFORE ROW: NEW / OLD / NULL(skip); AFTER: NULL
END $$;

CREATE [ OR REPLACE ] [ CONSTRAINT ] TRIGGER name
  { BEFORE | AFTER | INSTEAD OF } { INSERT | UPDATE [ OF col [, ...] ] | DELETE | TRUNCATE } [ OR ... ]
  ON table_or_view
  [ REFERENCING { OLD | NEW } TABLE [ AS ] transition_name [ ... ] ]
  [ FOR [ EACH ] { ROW | STATEMENT } ]
  [ WHEN ( condition ) ]
  EXECUTE FUNCTION trg_fn ( [ 'arg' [, ...] ] );

ALTER TABLE t { ENABLE | DISABLE } TRIGGER { name | ALL | USER };
DROP TRIGGER [ IF EXISTS ] name ON table;`,
  examples: [
    { label: 'Basic', title: 'BEFORE ROW trigger that normalises data',
      sql: `CREATE FUNCTION normalize_customer() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email   := lower(trim(NEW.email));     -- modify the row being written
  NEW.name    := initcap(trim(NEW.name));
  NEW.country := initcap(trim(NEW.country));
  RETURN NEW;                                -- proceed with the modified row
END;
$$;

CREATE TRIGGER trg_customers_normalize
BEFORE INSERT OR UPDATE OF email, name, country ON customers
FOR EACH ROW
EXECUTE FUNCTION normalize_customer();

INSERT INTO customers (name, email, country, city, segment)
VALUES ('  ananya SHARMA ', '  Ananya.Sharma@Example.COM ', 'india', 'Pune', 'consumer')
RETURNING id, name, email, country;`,
      explain: `<p>The function assigns to <code>NEW</code> fields; because it is a <strong>BEFORE ROW</strong> trigger and returns <code>NEW</code>, the cleaned values are what get stored — and what <code>RETURNING</code> shows. <code>UPDATE OF email, name, country</code> means updates touching only <code>city</code> do not fire the trigger. Every client — app, import job or manual SQL — now gets the same normalisation.</p>`,
      output: ` id  | name          | email                     | country
-----+---------------+---------------------------+---------
 529 | Ananya Sharma | ananya.sharma@example.com | India
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Watching the firing order: TG_ variables, ROW vs STATEMENT',
      sql: `CREATE FUNCTION trace_trigger() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_LEVEL = 'ROW' THEN
    RAISE NOTICE '% % % on % row id=%', TG_WHEN, TG_LEVEL, TG_OP, TG_TABLE_NAME,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    RAISE NOTICE '% % % on %', TG_WHEN, TG_LEVEL, TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;  -- NULL for statement level
END;
$$;

CREATE TRIGGER t1_before_stmt BEFORE UPDATE ON departments
  FOR EACH STATEMENT EXECUTE FUNCTION trace_trigger();
CREATE TRIGGER t2_before_row  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION trace_trigger();
CREATE TRIGGER t3_after_row   AFTER UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION trace_trigger();
CREATE TRIGGER t4_after_stmt  AFTER UPDATE ON departments
  FOR EACH STATEMENT EXECUTE FUNCTION trace_trigger();

UPDATE departments SET budget = budget * 1.01 WHERE id IN (4, 5);`,
      explain: `<p>Four triggers on one table show the firing sequence for an <code>UPDATE</code> of two rows: the BEFORE STATEMENT trigger first, then BEFORE ROW for each row as it is written, then — after the statement has processed all rows — the queued AFTER ROW events, and finally AFTER STATEMENT. In statement-level triggers <code>NEW</code>/<code>OLD</code> are NULL, so the function returns NULL there (which is ignored).</p>`,
      output: `NOTICE:  BEFORE STATEMENT UPDATE on departments
NOTICE:  BEFORE ROW UPDATE on departments row id=4
NOTICE:  BEFORE ROW UPDATE on departments row id=5
NOTICE:  AFTER ROW UPDATE on departments row id=4
NOTICE:  AFTER ROW UPDATE on departments row id=5
NOTICE:  AFTER STATEMENT UPDATE on departments
UPDATE 2`, run: true },
    { label: 'Advanced', title: 'Guard rails + history with WHEN conditions and TG_ARGV',
      sql: `CREATE TABLE salary_history (
  employee_id int, old_salary numeric, new_salary numeric,
  pct_change numeric, changed_at timestamptz DEFAULT now()
);

-- BEFORE: block excessive raises; the limit is passed as a trigger argument
CREATE FUNCTION guard_salary() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_max_pct numeric := TG_ARGV[0]::numeric;
BEGIN
  IF NEW.salary > OLD.salary * (1 + v_max_pct / 100) THEN
    RAISE EXCEPTION 'raise for employee % exceeds % %%', NEW.id, v_max_pct
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER: record the change; only called when salary really changed
CREATE FUNCTION log_salary() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO salary_history (employee_id, old_salary, new_salary, pct_change)
  VALUES (NEW.id, OLD.salary, NEW.salary,
          round((NEW.salary / OLD.salary - 1) * 100, 2));
  RETURN NULL;                         -- ignored for AFTER triggers
END;
$$;

CREATE TRIGGER trg_salary_guard
BEFORE UPDATE OF salary ON employees
FOR EACH ROW
WHEN (NEW.salary > OLD.salary)         -- only raises are checked
EXECUTE FUNCTION guard_salary('50');

CREATE TRIGGER trg_salary_history
AFTER UPDATE OF salary ON employees
FOR EACH ROW
WHEN (OLD.salary IS DISTINCT FROM NEW.salary)
EXECUTE FUNCTION log_salary();

UPDATE employees SET salary = salary * 1.10 WHERE id IN (20, 21, 22);
UPDATE employees SET salary = salary WHERE id = 1;          -- no-op: not logged

DO $$ BEGIN
  UPDATE employees SET salary = salary * 2 WHERE id = 9;    -- blocked
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'blocked: %', SQLERRM;
END $$;

SELECT employee_id, old_salary, new_salary, pct_change
FROM salary_history ORDER BY employee_id;`,
      explain: `<p><code>TG_ARGV[0]</code> receives the <code>'50'</code> passed in <code>EXECUTE FUNCTION guard_salary('50')</code>, so one function can be reused with different limits. The <code>WHEN</code> clauses are evaluated by the executor <em>before</em> calling the function: the guard only runs for raises, and the history trigger skips the no-op update on employee 1. The 100% raise for employee 9 is rejected with a <code>check_violation</code>, caught by the DO block. Only the genuine 10% raises appear in history.</p>`,
      output: `NOTICE:  blocked: raise for employee 9 exceeds 50 %
 employee_id | old_salary | new_salary | pct_change
-------------+------------+------------+------------
 20          | 83300.00   | 91630.00   | 10.00
 21          | 134000.00  | 147400.00  | 10.00
 22          | 59900.00   | 65890.00   | 10.00
(3 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Trigger fires for every update and filters inside the function
CREATE TABLE sal_log_bad (id int, old numeric, new numeric);
CREATE FUNCTION log_any() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.salary IS DISTINCT FROM NEW.salary THEN
    INSERT INTO sal_log_bad VALUES (NEW.id, OLD.salary, NEW.salary);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_bad AFTER UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION log_any();
UPDATE employees SET is_active = is_active;   -- 200 function calls, 0 useful`,
      why: 'Every UPDATE on any column calls the PL/pgSQL function for every row, just to discover there is nothing to do.', run: true },
    good: { sql: `CREATE TABLE sal_log_good (id int, old numeric, new numeric);
CREATE FUNCTION log_sal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sal_log_good VALUES (NEW.id, OLD.salary, NEW.salary);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_good AFTER UPDATE OF salary ON employees FOR EACH ROW
  WHEN (OLD.salary IS DISTINCT FROM NEW.salary) EXECUTE FUNCTION log_sal();
UPDATE employees SET is_active = is_active;   -- trigger never even considered`,
      why: 'UPDATE OF salary skips statements that do not set salary, and WHEN filters rows without entering PL/pgSQL.', run: true }
  },
  mistakes: [
    `Returning <code>NULL</code> from a BEFORE ROW trigger by accident (e.g. forgetting <code>RETURN NEW</code>) — the row is silently not inserted or updated, with no error.`,
    `Modifying <code>NEW</code> in an AFTER trigger and expecting it to be saved; the row is already written.`,
    `Using <code>NEW</code> in a DELETE trigger or <code>OLD</code> in an INSERT trigger (they are NULL).`,
    `Relying on the order of multiple triggers without naming them deliberately — they fire alphabetically by name.`,
    `Filtering inside the function instead of using <code>WHEN</code> and <code>UPDATE OF</code>.`,
    `Writing triggers that do slow external work (HTTP calls via extensions) inside the writer's transaction.`
  ],
  best: [
    `Use BEFORE ROW triggers for validating/normalising the row itself; AFTER triggers for side effects on other tables.`,
    `Name triggers with a prefix that encodes order and purpose (<code>t10_normalize</code>, <code>t20_audit</code>).`,
    `Put cheap filters in <code>WHEN</code> and <code>UPDATE OF</code> clauses.`,
    `Keep trigger functions small, fast and side-effect free outside the database.`,
    `Document triggers (<code>COMMENT ON TRIGGER</code>) — they are invisible from application code.`
  ],
  performance: `<p>A row-level PL/pgSQL trigger typically adds a few microseconds per row; a trigger that also inserts into another table roughly doubles write cost (extra heap insert, index inserts and WAL). On a 10-million-row bulk load this is the difference between 40 seconds and several minutes. <code>WHEN</code> conditions are evaluated in C without entering PL/pgSQL, making non-matching rows nearly free. AFTER ROW triggers queue an event per row in memory; huge single statements with AFTER ROW triggers consume memory proportional to the rows changed.</p>`,
  security: `<p>Trigger functions run with the privileges of the user performing the DML (unless the function is <code>SECURITY DEFINER</code>). If an audit trigger must write to a table normal users cannot touch, make the trigger function <code>SECURITY DEFINER</code> with a pinned <code>search_path</code>. Only the table owner (or a superuser) can create, drop or disable triggers; <code>session_replication_role = replica</code> disables ordinary triggers and requires superuser, so it is a deliberate administrative bypass.</p>`,
  scenario: { title: 'Rows silently disappear on insert', steps: [
    '1. Reproduce: INSERT returns INSERT 0 0 with no error.',
    '2. List triggers: SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = \'t\'::regclass AND NOT tgisinternal;',
    '3. Read each BEFORE ROW function with pg_get_functiondef; look for paths that RETURN NULL or reach END without RETURN NEW.',
    '4. Fix the function to RETURN NEW on every non-skipping path.',
    '5. Add a test that inserts a representative row and checks it exists.'
  ] },
  interview: [
    { q: 'What happens if a BEFORE ROW trigger returns NULL?', a: 'The operation for that row is skipped silently — no insert, update or delete happens, and subsequent triggers for that row do not fire. For AFTER triggers the return value is ignored.' },
    { q: 'Explain the firing order for an UPDATE that touches three rows with all four kinds of trigger.', a: 'BEFORE STATEMENT once; then for each row, BEFORE ROW fires as the row is processed; after the statement finishes all rows, the queued AFTER ROW triggers fire for each row; finally AFTER STATEMENT fires once.' },
    { q: 'What is a WHEN clause on a trigger and why use it?', a: 'A boolean condition evaluated before the trigger function is called, which can reference OLD and NEW for row triggers. It avoids entering the function for rows that need no work, which is much cheaper than filtering inside the function.' },
    { q: 'When is INSTEAD OF used?', a: 'Only on views, as row-level triggers that replace the INSERT, UPDATE or DELETE against the view with custom logic — e.g. making a complex join view writable or implementing soft deletes through a view.' }
  ],
  exercises: [
    { task: 'Create a BEFORE INSERT OR UPDATE trigger on products that rejects negative stock by raising an exception, and one that upper-cases the sku. Insert a product with sku "sku-new-1" and show it.', solution: `CREATE FUNCTION products_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stock < 0 THEN
    RAISE EXCEPTION 'stock cannot be negative for %', NEW.sku;
  END IF;
  NEW.sku := upper(NEW.sku);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_products_check BEFORE INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION products_check();

INSERT INTO products (sku, name, category, price, stock)
VALUES ('sku-new-1', 'Cable Basic', 'accessories', 199, 10)
RETURNING sku, name, stock;`, run: true },
    { task: 'List all non-internal triggers in the database with table name, trigger name and whether they are enabled, after creating one trigger on departments.', solution: `CREATE FUNCTION noop_trg() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_dept_noop BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION noop_trg();

SELECT tgrelid::regclass AS table_name, tgname, tgenabled
FROM pg_trigger
WHERE NOT tgisinternal
ORDER BY 1, 2;`, run: true }
  ],
  challenge: { task: 'Write a BEFORE DELETE trigger on employees that prevents deleting any employee who still manages someone (raise an exception with a HINT), and verify it by trying to delete employee 1 inside a DO block that catches the error.', hint: 'EXISTS (SELECT 1 FROM employees WHERE manager_id = OLD.id); return OLD to allow other deletes.', solution: `CREATE FUNCTION protect_managers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM employees WHERE manager_id = OLD.id) THEN
    RAISE EXCEPTION 'employee % still manages staff', OLD.id
      USING HINT = 'Reassign their reports first';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER trg_protect_managers BEFORE DELETE ON employees
FOR EACH ROW EXECUTE FUNCTION protect_managers();

DO $$ BEGIN
  DELETE FROM employees WHERE id = 1;
EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'blocked: %', SQLERRM;
END $$;`, run: true },
  related: ['triggers-updated-at', 'triggers-audit-logging', 'triggers-soft-delete-advanced', 'functions-plpgsql-basics', 'constraints'],
  quiz: [
    { type: 'mcq', q: 'Which trigger type can change the values being stored?', options: ['AFTER ROW', 'BEFORE ROW', 'AFTER STATEMENT', 'BEFORE STATEMENT'], answer: 1, explain: 'Only BEFORE ROW triggers can modify NEW before it is written.' },
    { type: 'tf', q: 'INSTEAD OF triggers can be created on ordinary tables.', answer: false, explain: 'INSTEAD OF triggers are only allowed on views (row level).' },
    { type: 'bug', q: 'Why are no rows inserted into orders?', code: `CREATE FUNCTION set_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS NULL THEN NEW.status := 'pending'; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER t BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION set_defaults();`, options: ['status cannot be assigned', 'RETURN NULL in a BEFORE ROW trigger skips the row', 'Must be AFTER INSERT', 'Needs FOR EACH STATEMENT'], answer: 1, explain: 'Returning NULL tells PostgreSQL to skip the row. It must RETURN NEW.' },
    { type: 'predict', q: 'Two BEFORE INSERT ROW triggers exist on a table: "b_audit" and "a_clean". Which fires first?', options: ['b_audit', 'a_clean', 'Creation order decides', 'Random'], answer: 1, explain: 'Triggers of the same kind fire in alphabetical order of their names.' },
    { type: 'optimize', q: 'An AFTER UPDATE trigger logs email changes but slows every update. Best improvement?', options: ['Make it BEFORE', 'Add UPDATE OF email and WHEN (OLD.email IS DISTINCT FROM NEW.email)', 'Use FOR EACH STATEMENT without transition tables', 'Add an index on email'], answer: 1, explain: 'Column lists and WHEN conditions prevent the function from being called for irrelevant updates.' }
  ]
},
{
  id: 'triggers-updated-at',
  module: 'triggers',
  title: 'The Classic: An Automatic updated_at Trigger',
  level: 3,
  minutes: 15,
  summary: 'Build the most common production trigger — a reusable function that keeps updated_at correct on every table — and learn its subtleties: now() vs clock_timestamp(), no-op updates and attaching it to many tables.',
  objectives: [
    'Write a reusable BEFORE UPDATE trigger function that sets updated_at',
    'Attach the same function to many tables with a DO block and format()',
    'Choose between now() and clock_timestamp() knowingly',
    'Skip bumping updated_at on no-op updates with a WHEN clause',
    'Prevent clients from forging updated_at values'
  ],
  concept: `<p>Almost every production schema has <code>created_at</code> and <code>updated_at</code> columns. <code>created_at</code> is easy — a <code>DEFAULT now()</code>. <code>updated_at</code> is not: a default only applies on INSERT. You need something that runs on every UPDATE. That is the textbook <strong>BEFORE UPDATE ... FOR EACH ROW</strong> trigger.</p>
<p>Analogy: the <em>"last modified" stamp in a shared document editor</em>. You do not trust each editor to type the date by hand; the system stamps it whenever anyone saves.</p>
<h4>Design decisions</h4>
<ul>
<li><strong>One function, many tables.</strong> The function only touches <code>NEW.updated_at</code>, so it works on any table that has that column.</li>
<li><strong><code>now()</code> vs <code>clock_timestamp()</code>.</strong> <code>now()</code> (= <code>transaction_timestamp()</code>) is the start time of the transaction: every row changed in one transaction gets the <em>same</em> value, which is consistent and makes "everything changed together" easy to see. <code>clock_timestamp()</code> is the actual wall clock at the moment of the call, different for each row. Most systems use <code>now()</code>; use <code>clock_timestamp()</code> if a long transaction must record when each row was really touched.</li>
<li><strong>No-op updates.</strong> ORMs often write every column even when nothing changed. Adding <code>WHEN (OLD.* IS DISTINCT FROM NEW.*)</code> keeps <code>updated_at</code> meaningful (it only moves when data actually changed).</li>
<li><strong>Forgery.</strong> Because the BEFORE trigger overwrites whatever the client sent, <code>UPDATE ... SET updated_at = '2000-01-01'</code> has no effect.</li>
</ul>`,
  why: `<p><code>updated_at</code> drives incremental ETL ("give me rows changed since my last sync"), cache invalidation, optimistic concurrency checks and debugging. If any code path forgets to set it, downstream systems silently miss changes — the worst kind of bug, because nothing errors. A trigger makes the column trustworthy.</p>`,
  useCase: `<p>A marketplace syncs 30 million product rows to its search cluster every 5 minutes using <code>WHERE updated_at &gt; :last_sync</code> on an index. Before the trigger existed, a bulk price-update script written by the pricing team never set <code>updated_at</code>, so 400 000 price changes never reached search and customers saw stale prices for two days. After adding a shared <code>set_updated_at()</code> trigger to all 46 tables via a migration DO block, the sync became reliable regardless of who writes.</p>`,
  internals: `<p>Within a transaction, <code>now()</code> returns a value cached at transaction start, so it costs nothing to call per row. The comparison <code>OLD.* IS DISTINCT FROM NEW.*</code> compares the row values column by column in C before the function runs. Note that row-wise comparison considers <code>updated_at</code> itself too — if a client explicitly sets <code>updated_at</code> to a different value, the rows differ and the trigger fires (and overwrites it), which is the desired behaviour.</p>`,
  whenNot: `<p>Skip the trigger on append-only tables (events, logs) that are never updated. For extremely hot update paths (millions of updates per minute on one table) the trigger overhead may matter; there you might set <code>updated_at = now()</code> explicitly in the single code path that updates the table. If you need a full history of changes rather than the last-change time, use an audit trigger or temporal tables pattern instead.</p>`,
  syntax: `CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_<table>_updated_at
BEFORE UPDATE ON <table>
FOR EACH ROW
[ WHEN (OLD.* IS DISTINCT FROM NEW.*) ]
EXECUTE FUNCTION set_updated_at();`,
  examples: [
    { label: 'Basic', title: 'Add updated_at to products and keep it current',
      sql: `ALTER TABLE products
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- pretend the row was last touched long ago
ALTER TABLE products DISABLE TRIGGER trg_products_updated_at;
UPDATE products SET updated_at = '2024-01-01' WHERE id IN (1, 2);
ALTER TABLE products ENABLE TRIGGER trg_products_updated_at;

UPDATE products SET price = price * 0.95 WHERE id = 1;

SELECT id, sku, price,
       CASE WHEN updated_at = now() THEN 'now (bumped)'
            ELSE updated_at::date::text END AS updated_at
FROM products WHERE id IN (1, 2) ORDER BY id;`,
      explain: `<p>The new column gets <code>DEFAULT now()</code> for inserts. The trigger function overwrites <code>NEW.updated_at</code> on every update. To demonstrate, we temporarily disable the trigger to back-date two rows, then update only product 1: its <code>updated_at</code> now equals <code>now()</code> (the transaction start time), while product 2 keeps its old date.</p>`,
      output: ` id | sku      | price    | updated_at
----+----------+----------+--------------
 1  | SKU-0001 | 4754.60  | now (bumped)
 2  | SKU-0002 | 55051.52 | 2024-01-01
(2 rows)`, run: true },
    { label: 'Intermediate', title: 'Attach the same trigger to many tables in one migration',
      sql: `CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments', 'employees', 'projects', 'customers'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', 'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;

SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname LIKE '%updated_at'
ORDER BY 1;`,
      explain: `<p>A DO block loops over table names and builds DDL with <code>format('%I', ...)</code>, which safely quotes identifiers. <code>ADD COLUMN IF NOT EXISTS</code> and <code>CREATE OR REPLACE TRIGGER</code> (PG14+) make the migration idempotent — it can be re-run safely. The catalog query confirms each table has its trigger.</p>`,
      output: ` table_name  | trigger_name
-------------+----------------------------
 customers   | trg_customers_updated_at
 departments | trg_departments_updated_at
 employees   | trg_employees_updated_at
 projects    | trg_projects_updated_at
(4 rows)`, run: true },
    { label: 'Advanced', title: 'Skip no-op updates and resist forged timestamps',
      sql: `ALTER TABLE departments ADD COLUMN updated_at timestamptz NOT NULL DEFAULT '2025-01-01';

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_departments_updated_at
BEFORE UPDATE ON departments
FOR EACH ROW
WHEN (OLD.* IS DISTINCT FROM NEW.*)    -- only when something actually changed
EXECUTE FUNCTION set_updated_at();

UPDATE departments SET location = location WHERE id = 1;            -- ORM-style no-op
UPDATE departments SET budget = budget + 1000 WHERE id = 2;         -- real change
UPDATE departments SET updated_at = '1999-12-31' WHERE id = 3;      -- forgery attempt

SELECT id, name,
       CASE WHEN updated_at = now() THEN 'now (bumped)'
            ELSE updated_at::date::text END AS updated_at
FROM departments WHERE id IN (1, 2, 3) ORDER BY id;`,
      explain: `<p>With <code>WHEN (OLD.* IS DISTINCT FROM NEW.*)</code>, the no-op update on department 1 does not call the function, so its timestamp stays at the original value. The real change on department 2 is stamped. The forgery attempt on department 3 changes a column (so the trigger fires) and the trigger replaces the forged value with <code>now()</code>. <code>IS DISTINCT FROM</code> treats NULLs as comparable values, unlike <code>&lt;&gt;</code>.</p>`,
      output: ` id | name        | updated_at
----+-------------+--------------
 1  | Engineering | 2025-01-01
 2  | Sales       | now (bumped)
 3  | Marketing   | now (bumped)
(3 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Relying on every caller to remember
ALTER TABLE projects ADD COLUMN updated_at timestamptz NOT NULL DEFAULT '2025-01-01';
UPDATE projects SET status = 'active' WHERE id = 4;    -- caller forgot updated_at
SELECT id, status, updated_at::date FROM projects WHERE id = 4;`,
      why: 'One forgotten code path and incremental syncs silently miss the change.', run: true },
    good: { sql: `ALTER TABLE projects ADD COLUMN updated_at timestamptz NOT NULL DEFAULT '2025-01-01';
CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_projects_touch BEFORE UPDATE ON projects
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION touch();
UPDATE projects SET status = 'active' WHERE id = 4;
SELECT id, status, updated_at = now() AS bumped FROM projects WHERE id = 4;`,
      why: 'The database guarantees the timestamp regardless of which client performs the update.', run: true }
  },
  mistakes: [
    `Using an AFTER trigger and running a second <code>UPDATE ... SET updated_at</code> inside it — doubles the work and can recurse.`,
    `Using <code>DEFAULT now()</code> alone and assuming it applies on UPDATE (defaults only apply on INSERT or explicit <code>SET col = DEFAULT</code>).`,
    `Forgetting to add the trigger to new tables; enforce it with a migration checklist or a CI test that queries <code>pg_trigger</code>.`,
    `Using <code>timestamp</code> (without time zone) for <code>updated_at</code>, which breaks across servers in different time zones; use <code>timestamptz</code>.`,
    `Expecting <code>now()</code> to differ between rows updated in the same transaction.`
  ],
  best: [
    `Use one shared <code>set_updated_at()</code> function for every table.`,
    `Add <code>WHEN (OLD.* IS DISTINCT FROM NEW.*)</code> so <code>updated_at</code> reflects real changes.`,
    `Index <code>updated_at</code> on tables used for incremental sync.`,
    `Use <code>timestamptz</code> and <code>now()</code> unless you specifically need per-row wall-clock time.`,
    `Add a CI check listing tables with an <code>updated_at</code> column but no matching trigger.`
  ],
  performance: `<p>The function is tiny: overhead is a few microseconds per updated row, negligible for OLTP. On bulk updates of tens of millions of rows it can add seconds to minutes; temporarily disabling it (as table owner) during a controlled backfill and setting <code>updated_at</code> in the same statement is a valid technique. Remember that bumping <code>updated_at</code> changes an indexed column if you index it, which prevents HOT (heap-only tuple) updates and adds index maintenance.</p>`,
  security: `<p>Because the BEFORE trigger always overwrites <code>updated_at</code>, clients cannot forge it. Disabling triggers requires table ownership; in production, restrict ownership to a migration role so application roles cannot <code>ALTER TABLE ... DISABLE TRIGGER</code>.</p>`,
  scenario: { title: "The incremental sync misses changed rows", steps: [
    "1. Downstream search shows stale prices although products were updated.",
    "2. Check for a trigger: SELECT tgname FROM pg_trigger WHERE tgrelid = 'products'::regclass;",
    "3. None exists; a bulk script updated prices without touching updated_at.",
    "4. Create the shared set_updated_at() function and BEFORE UPDATE triggers on all synced tables.",
    "5. Backfill: UPDATE ... SET updated_at = now() for the rows the script changed, to re-sync them.",
    "6. Add a CI check for tables with updated_at but no trigger, and index updated_at for the sync query."
  ] },
  interview: [
    { q: 'Why use a trigger for updated_at instead of a default?', a: 'DEFAULT values only apply on INSERT. An UPDATE leaves the column unchanged unless the client sets it, so you need a BEFORE UPDATE row trigger to stamp it reliably for every code path.' },
    { q: 'now() or clock_timestamp() for updated_at?', a: 'now() returns the transaction start time, so all rows changed in one transaction share a timestamp and the call is cheap; clock_timestamp() returns the actual time of each call. now() is the usual choice; clock_timestamp() when per-row timing within long transactions matters.' },
    { q: 'How do you avoid bumping updated_at when nothing changed?', a: 'Add WHEN (OLD.* IS DISTINCT FROM NEW.*) to the trigger definition so the function only runs when at least one column value differs.' }
  ],
  exercises: [
    { task: 'Add updated_at to users, attach a set_updated_at trigger, update user 1 role and show that updated_at equals now().', solution: `ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT '2025-01-01';
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
UPDATE users SET role = 'analyst' WHERE id = 1;
SELECT id, role, updated_at = now() AS bumped FROM users WHERE id = 1;`, run: true },
    { task: 'Write a query that lists tables in public that have an updated_at column but no trigger whose name ends with updated_at.', solution: `ALTER TABLE customers ADD COLUMN updated_at timestamptz DEFAULT now();

SELECT c.table_name
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  AND NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
      AND t.tgname LIKE '%updated_at');`, run: true }
  ],
  challenge: { task: 'Create a generic trigger function set_audit_columns() that on INSERT sets created_at and created_by (current_user) and on UPDATE preserves the original created_at/created_by (ignoring client changes) and sets updated_at. Attach it to a new table notes(id, body, created_at, created_by, updated_at) and prove a client cannot change created_by.', hint: 'Branch on TG_OP; on UPDATE assign NEW.created_at := OLD.created_at.', solution: `CREATE TABLE notes (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  body text, created_at timestamptz, created_by text, updated_at timestamptz);

CREATE FUNCTION set_audit_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := current_user;
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notes_audit BEFORE INSERT OR UPDATE ON notes
FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

INSERT INTO notes (body, created_by) VALUES ('hello', 'someone_else');
UPDATE notes SET created_by = 'hacker', body = 'edited';
SELECT body, created_by = current_user AS creator_preserved FROM notes;`, run: true },
  related: ['triggers-fundamentals', 'triggers-audit-logging', 'data-types', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Which trigger timing is correct for setting updated_at?', options: ['AFTER UPDATE FOR EACH ROW', 'BEFORE UPDATE FOR EACH ROW', 'AFTER UPDATE FOR EACH STATEMENT', 'INSTEAD OF UPDATE'], answer: 1, explain: 'Only a BEFORE ROW trigger can modify NEW before it is stored.' },
    { type: 'tf', q: 'All rows updated in one transaction get the same now() value.', answer: true, explain: 'now() returns the transaction start time.' },
    { type: 'predict', q: 'With WHEN (OLD.* IS DISTINCT FROM NEW.*), does UPDATE t SET a = a bump updated_at?', options: ['Yes', 'No', 'Only if a is NULL', 'Error'], answer: 1, explain: 'No column value changes, so the WHEN condition is false and the function is not called.' },
    { type: 'bug', q: 'Why does updated_at never change?', code: `CREATE TRIGGER t AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();`, options: ['Function must be IMMUTABLE', 'AFTER triggers cannot modify the stored row', 'Needs FOR EACH STATEMENT', 'updated_at needs an index'], answer: 1, explain: 'Assigning NEW in an AFTER trigger has no effect; the row is already written. Use BEFORE.' }
  ]
},
{
  id: 'triggers-audit-logging',
  module: 'triggers',
  title: 'Audit Logging with Triggers and to_jsonb(OLD/NEW)',
  level: 4,
  minutes: 25,
  summary: 'Build a generic, reusable audit trigger that writes INSERT/UPDATE/DELETE history into audit_logs as JSONB, records who made the change, stores only changed columns and ignores noise.',
  objectives: [
    'Write one audit trigger function that works for any table using to_jsonb(OLD/NEW) and TG_ variables',
    'Record the application user via a session setting (current_setting with missing_ok)',
    'Store only the changed columns (a JSONB diff) for UPDATEs',
    'Exclude noisy columns via trigger arguments',
    'Query the audit trail to reconstruct a row’s history'
  ],
  concept: `<p>An <strong>audit trail</strong> answers "who changed what, when, from which value to which value". Analogy: a <em>CCTV camera on the filing room door</em> — it does not stop anyone, but every entry and exit is recorded with a timestamp, and the recording is kept in a place the visitors cannot edit.</p>
<p>The <code>company_db</code> already has an <code>audit_logs</code> table: <code>table_name</code>, <code>operation</code>, <code>row_id</code>, <code>old_data jsonb</code>, <code>new_data jsonb</code>, <code>changed_by</code>, <code>changed_at</code>. The trick that makes <em>one</em> trigger work for <em>every</em> table is <code>to_jsonb(OLD)</code> / <code>to_jsonb(NEW)</code>: they turn any row, whatever its columns, into a JSONB object.</p>
<h4>Building blocks</h4>
<ul>
<li><code>TG_TABLE_NAME</code> and <code>TG_OP</code> fill <code>table_name</code> and <code>operation</code>.</li>
<li><code>to_jsonb(OLD)</code> is NULL for INSERT; <code>to_jsonb(NEW)</code> is NULL for DELETE.</li>
<li><strong>Who?</strong> <code>current_user</code> is the database role — often the same pooled <code>app</code> role for every end user. Applications pass the real user with <code>SET LOCAL app.username = 'asha@corp'</code> (or <code>set_config('app.username', ..., true)</code>) at the start of each transaction, and the trigger reads <code>current_setting('app.username', true)</code> (the <code>true</code> means "return NULL instead of error if unset").</li>
<li><strong>Diffs.</strong> For UPDATE, comparing the two JSONB objects key by key with <code>jsonb_each</code> lets you keep only changed columns — 10× smaller logs on wide tables.</li>
<li><strong>AFTER, not BEFORE.</strong> Audit triggers run AFTER ROW so they record what was actually written (after any BEFORE triggers modified it) and only for rows that really changed.</li>
</ul>`,
  why: `<p>Regulations (SOX, GDPR access logs, RBI/SEBI guidelines for financial data, HIPAA) and plain operational sanity require knowing how data reached its current state. Application-level logging misses manual fixes, scripts and other services. A trigger-based audit captures every change made through SQL in the same transaction — if the change rolls back, so does its audit record, so the log never claims a change that did not happen.</p>`,
  useCase: `<p>A lending platform must show regulators the full history of every loan application's status and limits. A generic <code>audit_row()</code> trigger is attached to 22 tables. The API sets <code>SET LOCAL app.username</code> and <code>app.request_id</code> per request, so each audit row links to the end user and the request log. Storing only changed columns kept the audit table at ~40 GB/year instead of ~300 GB. Disputes ("I never changed my income") are resolved with one query over <code>audit_logs WHERE table_name = 'applications' AND row_id = ...</code>.</p>`,
  internals: `<p><code>to_jsonb(record)</code> serialises each column using its type's JSON conversion (numbers stay numbers, timestamps become ISO strings, arrays become JSON arrays). The AFTER ROW trigger runs at the end of the statement from the after-trigger queue, inserting one audit row per changed row — so audit writes roughly double the heap and WAL volume of audited tables. The audit row is part of the same transaction; it becomes visible to others only on commit. <code>SET LOCAL</code> values live until the end of the current transaction, which plays well with transaction-mode connection poolers.</p>`,
  whenNot: `<p>Trigger auditing is synchronous and adds write amplification. For very high-volume tables (hundreds of thousands of writes/second), consider <strong>logical decoding / CDC</strong> (Debezium <span class="tag tool">third-party tool</span>, or built-in logical replication) to stream changes out asynchronously. For auditing <em>reads</em> or DDL/session activity, triggers cannot help — use <code>pgaudit</code> <span class="tag ext">extension</span> and server logs. Triggers also do not capture <code>TRUNCATE</code> per row (only a statement-level TRUNCATE trigger is possible).</p>`,
  syntax: `CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
          coalesce(current_setting('app.username', true), current_user));
  RETURN NULL;
END $$;

CREATE TRIGGER trg_<table>_audit
AFTER INSERT OR UPDATE OR DELETE ON <table>
FOR EACH ROW EXECUTE FUNCTION audit_row();

-- in the application, per transaction:
SET LOCAL app.username = 'asha@company.com';`,
  examples: [
    { label: 'Basic', title: 'A generic audit trigger on departments',
      sql: `CREATE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) - 'created_at' END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) - 'created_at' END,
    coalesce(current_setting('app.username', true), current_user)
  );
  RETURN NULL;                                  -- AFTER trigger: ignored
END;
$$;

CREATE TRIGGER trg_departments_audit
AFTER INSERT OR UPDATE OR DELETE ON departments
FOR EACH ROW EXECUTE FUNCTION audit_row();

INSERT INTO departments (name, location, budget) VALUES ('Legal', 'Delhi', 300000);
UPDATE departments SET budget = 350000 WHERE name = 'Legal';
DELETE FROM departments WHERE name = 'Legal';

SELECT operation, row_id, old_data, new_data, changed_by
FROM audit_logs
WHERE table_name = 'departments'
ORDER BY id;`,
      explain: `<p>The same function can be attached to any table with an <code>id</code> column. <code>to_jsonb(OLD)</code>/<code>to_jsonb(NEW)</code> capture complete rows; we drop <code>created_at</code> with the JSONB <code>-</code> operator to keep the output short. Each of the three statements produces exactly one audit row: INSERT (no old data), UPDATE (both), DELETE (no new data). <code>changed_by</code> falls back to <code>current_user</code> because no <code>app.username</code> was set.</p>`,
      output: ` operation | row_id | old_data                                                              | new_data                                                              | changed_by
-----------+--------+-----------------------------------------------------------------------+-----------------------------------------------------------------------+------------
 INSERT    | 34     |                                                                       | {"id": 34, "name": "Legal", "budget": 300000.00, "location": "Delhi"} | postgres
 UPDATE    | 34     | {"id": 34, "name": "Legal", "budget": 300000.00, "location": "Delhi"} | {"id": 34, "name": "Legal", "budget": 350000.00, "location": "Delhi"} | postgres
 DELETE    | 34     | {"id": 34, "name": "Legal", "budget": 350000.00, "location": "Delhi"} |                                                                       | postgres
(3 rows)`, run: true },
    { label: 'Intermediate', title: 'Store only changed columns and the real application user',
      sql: `CREATE FUNCTION audit_diff() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_id  bigint := (coalesce(v_new, v_old) ->> 'id')::bigint;
  v_changed_old jsonb;
  v_changed_new jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- keep only keys whose value differs
    SELECT jsonb_object_agg(o.key, o.value), jsonb_object_agg(o.key, v_new -> o.key)
      INTO v_changed_old, v_changed_new
    FROM jsonb_each(v_old) AS o
    WHERE o.value IS DISTINCT FROM v_new -> o.key;

    IF v_changed_old IS NULL THEN          -- nothing really changed
      RETURN NULL;
    END IF;
    v_old := v_changed_old;
    v_new := v_changed_new;
  END IF;

  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (TG_TABLE_NAME, TG_OP, v_id, v_old, v_new,
          coalesce(current_setting('app.username', true), current_user));
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_employees_audit
AFTER UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION audit_diff();

-- the application identifies the end user for this transaction
SET LOCAL app.username = 'hr.manager@company.com';

UPDATE employees SET salary = salary + 5000, job_title = 'Senior Engineer' WHERE id = 12;
UPDATE employees SET is_active = is_active WHERE id = 13;    -- no-op: not logged

SELECT row_id, old_data, new_data, changed_by
FROM audit_logs WHERE table_name = 'employees';`,
      explain: `<p>For UPDATEs, <code>jsonb_each(v_old)</code> walks every column; the <code>WHERE</code> keeps keys whose new value differs, and <code>jsonb_object_agg</code> rebuilds two small objects with only those keys. If nothing differs, the trigger returns without logging. <code>SET LOCAL app.username</code> sets a custom setting (any name with a dot is allowed) for the current transaction; <code>current_setting('app.username', true)</code> reads it. The audit row now says <em>who</em> in business terms and contains only <code>salary</code> and <code>job_title</code>.</p>`,
      output: ` row_id | old_data                                       | new_data                                              | changed_by
--------+------------------------------------------------+-------------------------------------------------------+------------------------
 12     | {"salary": 122900.00, "job_title": "Engineer"} | {"salary": 127900.00, "job_title": "Senior Engineer"} | hr.manager@company.com
(1 row)`, run: true },
    { label: 'Advanced', title: 'Exclusions via TG_ARGV, a protected audit table and history reconstruction',
      sql: `CREATE FUNCTION audit_row_excluding() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER                                   -- writers need no rights on audit_logs
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_skip text[] := TG_ARGV;                         -- columns to ignore, from CREATE TRIGGER
  v_old  jsonb  := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - TG_ARGV END;
  v_new  jsonb  := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - TG_ARGV END;
BEGIN
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN
    RETURN NULL;                                    -- only ignored columns changed
  END IF;
  INSERT INTO public.audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (TG_TABLE_NAME, TG_OP, (coalesce(v_new, v_old) ->> 'id')::bigint, v_old, v_new,
          coalesce(current_setting('app.username', true), current_user));
  RETURN NULL;
END;
$$;

-- ignore stock churn and timestamps; audit everything else on products
CREATE TRIGGER trg_products_audit
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION audit_row_excluding('stock', 'created_at', 'attributes', 'tags');

UPDATE products SET stock = stock - 1 WHERE id = 5;              -- ignored column only
UPDATE products SET price = 49999.00 WHERE id = 5;
UPDATE products SET price = 47999.00, name = 'Webcam Pro 5 (2025)' WHERE id = 5;

-- reconstruct the history of product 5
SELECT id - min(id) OVER () + 1 AS version,
       operation,
       old_data ->> 'price' AS old_price,
       new_data ->> 'price' AS new_price,
       new_data ->> 'name'  AS name_after
FROM audit_logs
WHERE table_name = 'products' AND row_id = 5
ORDER BY id;`,
      explain: `<p>Trigger arguments (<code>'stock', 'created_at', ...</code>) arrive in <code>TG_ARGV</code> as a <code>text[]</code>, and <code>jsonb - text[]</code> removes all those keys in one go. If only excluded columns changed, the two objects are equal and nothing is logged. The function is <code>SECURITY DEFINER</code> with a pinned <code>search_path</code>, so application roles can be denied <code>INSERT/UPDATE/DELETE</code> on <code>audit_logs</code> entirely — they cannot tamper with the trail. The final query rebuilds the product's price history from the log.</p>`,
      output: ` version | operation | old_price | new_price | name_after
---------+-----------+-----------+-----------+---------------------
 1       | UPDATE    | 54244.73  | 49999.00  | Webcam Pro 5
 2       | UPDATE    | 49999.00  | 47999.00  | Webcam Pro 5 (2025)
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- One hand-written trigger per table with hard-coded columns
CREATE FUNCTION audit_departments_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_logs (table_name, operation, row_id, new_data)
  VALUES ('departments', TG_OP, NEW.id,
          jsonb_build_object('name', NEW.name, 'budget', NEW.budget));  -- location forgotten
  RETURN NULL;
END $$;
CREATE TRIGGER trg_a AFTER INSERT OR UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION audit_departments_only();
UPDATE departments SET location = 'Noida' WHERE id = 4;
SELECT new_data FROM audit_logs WHERE table_name = 'departments';`,
      why: 'Hard-coded column lists drift from the schema (location changes are invisible), there is no old value, and every table needs its own function.', run: true },
    good: { sql: `CREATE FUNCTION audit_generic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data)
  VALUES (TG_TABLE_NAME, TG_OP, NEW.id, to_jsonb(OLD) - 'created_at', to_jsonb(NEW) - 'created_at');
  RETURN NULL;
END $$;
CREATE TRIGGER trg_g AFTER UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION audit_generic();
UPDATE departments SET location = 'Noida' WHERE id = 4;
SELECT old_data ->> 'location' AS old_loc, new_data ->> 'location' AS new_loc
FROM audit_logs WHERE table_name = 'departments';`,
      why: 'to_jsonb(OLD/NEW) automatically includes every current and future column, with before and after values, from one shared function.', run: true }
  },
  mistakes: [
    `Using a BEFORE trigger for auditing: it logs values that a later BEFORE trigger may still change, and logs rows that another trigger then skips.`,
    `Recording only <code>current_user</code> when the application connects as one shared role — every change looks like "app".`,
    `Using <code>SET</code> instead of <code>SET LOCAL</code> for the application user with a connection pooler; the value leaks to the next client using that connection.`,
    `Granting application roles <code>UPDATE/DELETE</code> on the audit table, allowing tampering.`,
    `Never partitioning or archiving the audit table; it becomes the largest table in the database within months.`
  ],
  best: [
    `One generic AFTER ROW function using <code>to_jsonb(OLD/NEW)</code>, attached to each audited table.`,
    `Pass end-user identity via <code>SET LOCAL app.username</code> (and a request id) and read it with <code>current_setting(..., true)</code>.`,
    `Store only changed columns for UPDATEs and exclude noisy columns via trigger arguments.`,
    `Make the audit function SECURITY DEFINER with pinned search_path and revoke DML on the audit table from app roles.`,
    `Partition the audit table by month and index <code>(table_name, row_id)</code> for history lookups.`
  ],
  performance: `<p>Each audited row change adds one insert into <code>audit_logs</code> plus its index entries and WAL — roughly 1.5–2× the write cost of the original change. JSONB serialisation of wide rows is the main CPU cost; diff-only storage reduces storage and WAL but adds a <code>jsonb_each</code> pass. For bulk operations of millions of rows, a statement-level trigger with transition tables (next lesson) can insert all audit rows with one <code>INSERT ... SELECT</code>, which is noticeably faster than per-row inserts.</p>`,
  security: `<p>Audit integrity depends on privileges: only the audit function's owner should be able to write to <code>audit_logs</code>; application roles get <code>SELECT</code> at most. Table owners and superusers can still disable triggers — monitor DDL with <code>pgaudit</code> <span class="tag ext">extension</span> or event triggers. Be careful what you store: auditing a <code>users</code> table copies <code>password_hash</code> into the log unless you exclude it; exclude secrets and consider masking personal data to comply with GDPR/DPDP "right to erasure".</p>`,
  scenario: { title: 'Compliance asks: who changed this customer’s credit limit?', steps: [
    '1. Query audit_logs WHERE table_name = \'customers\' AND row_id = 4711 ORDER BY changed_at.',
    '2. Discover changed_by = app for every row: the application never set app.username.',
    '3. Add SET LOCAL app.username and app.request_id in the data-access layer for every transaction.',
    '4. Switch the audit function to diff-only storage and exclude password_hash and other secrets.',
    '5. Revoke DML on audit_logs from application roles; make the function SECURITY DEFINER.',
    '6. Partition audit_logs by month and define a retention policy.'
  ] },
  widgets: ['lab:security'],
  interview: [
    { q: 'How can one audit trigger function serve every table?', a: 'By using TG_TABLE_NAME and TG_OP for metadata and to_jsonb(OLD)/to_jsonb(NEW) to serialise whatever columns the row has into JSONB. Nothing table-specific is hard-coded.' },
    { q: 'How do you record the real end user when the app uses one database role?', a: 'The application runs SET LOCAL app.username = ... (or set_config with is_local = true) at the start of each transaction, and the trigger reads current_setting(\'app.username\', true). SET LOCAL scopes the value to the transaction, which is safe with connection pooling.' },
    { q: 'Why AFTER rather than BEFORE for audit triggers?', a: 'AFTER triggers see the final row as stored, after all BEFORE triggers ran and only for rows actually written. A BEFORE audit trigger could log values that are later modified or rows that another trigger skips.' },
    { q: 'What are the downsides of trigger-based auditing?', a: 'Synchronous write amplification (extra insert, index and WAL per change), growth of the audit table, and it can be bypassed by owners disabling triggers. At very high volume, CDC via logical decoding is an alternative.' }
  ],
  exercises: [
    { task: 'Attach the generic audit_row() trigger to projects, change the status of project 4, and show old and new status from audit_logs.', solution: `CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data)
  VALUES (TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_projects_audit AFTER INSERT OR UPDATE OR DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION audit_row();
UPDATE projects SET status = 'active' WHERE id = 4;
SELECT old_data ->> 'status' AS old_status, new_data ->> 'status' AS new_status
FROM audit_logs WHERE table_name = 'projects';`, run: true },
    { task: 'Using the existing seed data in audit_logs, count changes per changed_by and operation for the orders table.', solution: `SELECT changed_by, operation, count(*)
FROM audit_logs
WHERE table_name = 'orders'
GROUP BY changed_by, operation
ORDER BY changed_by, operation;`, run: true }
  ],
  challenge: { task: 'Audit the users table but never store password_hash: attach audit_row_excluding-style logic with TG_ARGV, set app.username with set_config(..., true), change a user role and password_hash, and show that the audit row contains the role change but no password_hash key.', hint: 'to_jsonb(NEW) - TG_ARGV removes all listed keys; set_config(\'app.username\', \'admin@corp\', true) is the function form of SET LOCAL.', solution: `CREATE FUNCTION audit_excl() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - TG_ARGV END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - TG_ARGV END;
BEGIN
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN RETURN NULL; END IF;
  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (TG_TABLE_NAME, TG_OP, (coalesce(v_new, v_old) ->> 'id')::bigint, v_old, v_new,
          coalesce(current_setting('app.username', true), current_user));
  RETURN NULL;
END $$;
CREATE TRIGGER trg_users_audit AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_excl('password_hash', 'last_login');

SELECT set_config('app.username', 'admin@corp', true);
UPDATE users SET role = 'manager', password_hash = 'new-secret-hash' WHERE id = 2;

SELECT changed_by, old_data ->> 'role' AS old_role, new_data ->> 'role' AS new_role,
       new_data ? 'password_hash' AS leaked_password
FROM audit_logs WHERE table_name = 'users';`, run: true },
  related: ['triggers-fundamentals', 'triggers-soft-delete-advanced', 'jsonb', 'security', 'functions-error-handling'],
  quiz: [
    { type: 'mcq', q: 'Which expression converts an arbitrary row in a trigger into JSONB?', options: ['row_to_json(TG_TABLE_NAME)', 'to_jsonb(NEW)', 'jsonb_build_object(NEW)', 'NEW::text::jsonb'], answer: 1, explain: 'to_jsonb(record) converts any composite value, including NEW/OLD, into a JSONB object.' },
    { type: 'tf', q: 'If a transaction that changed audited rows rolls back, its audit rows remain in audit_logs.', answer: false, explain: 'Trigger inserts are part of the same transaction and are rolled back with it.' },
    { type: 'predict', q: 'In a pooled app, what does current_setting(\'app.username\', true) return in a transaction that never set it?', options: ['An error', 'NULL (or an empty string if the setting was ever set earlier in that session)', 'current_user', '\'app.username\''], answer: 1, explain: 'With missing_ok = true it returns NULL when the parameter has never been defined; if the session previously defined it (even with SET LOCAL), it may return an empty string — coalesce(nullif(..., \'\'), current_user) is a robust pattern.' },
    { type: 'design', q: 'Auditing a 50k writes/sec event table makes writes too slow. Best alternative?', options: ['BEFORE trigger', 'Statement-level trigger without transition tables', 'Change data capture via logical decoding', 'Disable WAL'], answer: 2, explain: 'Logical decoding (e.g. Debezium) captures changes asynchronously from WAL without adding synchronous work to each write.' }
  ]
},
{
  id: 'triggers-soft-delete-advanced',
  module: 'triggers',
  title: 'Soft Deletes, INSTEAD OF Triggers, Transition Tables and Trigger Pitfalls',
  level: 4,
  minutes: 28,
  summary: 'Implement soft deletes with a BEFORE DELETE trigger or an INSTEAD OF trigger on a view, process bulk changes efficiently with transition tables (REFERENCING NEW TABLE), and avoid the classic trigger performance and recursion traps.',
  objectives: [
    'Turn DELETE into an UPDATE of deleted_at with a BEFORE DELETE trigger',
    'Expose only live rows through a view and implement writes with INSTEAD OF triggers',
    'Use statement-level triggers with REFERENCING OLD/NEW TABLE for set-based processing',
    'Detect and prevent trigger recursion with pg_trigger_depth() and WHEN clauses',
    'Recognise trigger patterns that destroy bulk-load and update performance'
  ],
  concept: `<p><strong>Soft delete</strong> means "do not physically remove the row; mark it as deleted". Analogy: a <em>recycle bin</em>. Pressing delete moves the file to the bin; normal folder views hide it; you can restore it; and something must eventually empty the bin.</p>
<h4>Two ways to implement it with triggers</h4>
<ol>
<li><strong>BEFORE DELETE trigger on the table</strong>: the trigger runs <code>UPDATE ... SET deleted_at = now()</code> and returns <code>NULL</code>, cancelling the physical delete. Applications keep issuing ordinary <code>DELETE</code>s.</li>
<li><strong>View + INSTEAD OF trigger</strong>: a view <code>active_x</code> shows only rows <code>WHERE deleted_at IS NULL</code>; applications read and write the view; an <code>INSTEAD OF DELETE</code> trigger on the view turns deletes into updates of the base table. The base table stays a normal table that admins can really purge.</li>
</ol>
<h4>Transition tables</h4>
<p>Row-level triggers fire once per row. For a bulk <code>UPDATE</code> of 500 000 rows that is 500 000 function calls. A <strong>statement-level AFTER trigger</strong> with <code>REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows</code> (PG10+) fires <em>once</em> and sees every affected row as an ephemeral table you can join, aggregate and insert from in a single set-based statement. Restrictions: only AFTER triggers, not on views, and an UPDATE trigger with transition tables cannot have a column list.</p>
<h4>Recursion</h4>
<p>A trigger on table A that updates table A fires itself again. PostgreSQL does not stop this automatically; it ends only when the stack overflows (<code>stack depth limit exceeded</code>). <code>pg_trigger_depth()</code> returns the current nesting level (0 outside triggers), so <code>WHEN (pg_trigger_depth() &lt; 1)</code> on the trigger — or a check inside it — breaks loops. The soft-delete trigger's own <code>UPDATE</code> fires UPDATE triggers, not DELETE triggers, so it does not recurse.</p>`,
  why: `<p>Hard deletes are irreversible and break history: invoices that referenced a deleted customer, analytics that suddenly lose last year's revenue, and "I deleted it by mistake" tickets that need a restore from backup. Soft deletes keep the data while hiding it. Transition tables exist because row-by-row trigger logic does not scale to bulk operations, and recursion control exists because triggers that write are easy to wire into loops.</p>`,
  useCase: `<p>A B2B CRM with 900 tenants lets users delete projects; 3% of deletes are followed by a "please restore" ticket within a week. They implemented <code>deleted_at</code> + an <code>INSTEAD OF DELETE</code> trigger on the <code>projects_live</code> view the ORM uses, so restoring is <code>UPDATE projects SET deleted_at = NULL</code>. A nightly job hard-deletes rows soft-deleted more than 90 days ago. Their order-status dashboard is maintained by a statement-level trigger with transition tables: a carrier-update job that changes 200 000 order statuses now fires the trigger once (0.4 s) instead of 200 000 times (38 s).</p>`,
  internals: `<p>Transition tables are stored in a <strong>tuplestore</strong> filled by the executor while the statement runs (in memory up to <code>work_mem</code>, then spilled to a temp file) and exposed to the trigger function as ephemeral named relations queryable by SQL. Only rows actually changed appear. INSTEAD OF triggers replace the view's rewrite rule: the executor scans the view's query to find the target rows (exposed as <code>OLD</code>), calls the function per row, and counts the row as processed if the function returns non-NULL. <code>pg_trigger_depth()</code> reads a backend-local counter incremented around every trigger function invocation.</p>`,
  whenNot: `<p>Soft deletes complicate every query (each must filter <code>deleted_at IS NULL</code>), break <code>UNIQUE</code> constraints (a deleted "asha@x.com" blocks a new one — use a partial unique index <code>WHERE deleted_at IS NULL</code>), keep personal data you may be legally required to erase, and bloat tables. If you only need recoverability, an archive table (move rows on delete) or an audit log may be cleaner. Do not use transition tables when a row trigger with a selective <code>WHEN</code> clause fires rarely — the simpler tool is fine.</p>`,
  syntax: `-- soft delete via BEFORE DELETE
CREATE TRIGGER trg_soft_delete BEFORE DELETE ON t
FOR EACH ROW EXECUTE FUNCTION soft_delete();     -- function: UPDATE ...; RETURN NULL;

-- soft delete via view + INSTEAD OF
CREATE VIEW t_live AS SELECT * FROM t WHERE deleted_at IS NULL;
CREATE TRIGGER trg_t_live_delete INSTEAD OF DELETE ON t_live
FOR EACH ROW EXECUTE FUNCTION soft_delete_via_view();   -- RETURN OLD to count the row

-- transition tables (AFTER, statement or row level)
CREATE TRIGGER trg_bulk AFTER UPDATE ON t
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION f();

-- recursion guard
CREATE TRIGGER ... WHEN (pg_trigger_depth() < 1) EXECUTE FUNCTION f();`,
  examples: [
    { label: 'Basic', title: 'BEFORE DELETE trigger that converts DELETE into a soft delete',
      sql: `ALTER TABLE projects ADD COLUMN deleted_at timestamptz;

CREATE FUNCTION soft_delete_project() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE projects SET deleted_at = now() WHERE id = OLD.id;
  RETURN NULL;                     -- cancel the physical DELETE
END;
$$;

CREATE TRIGGER trg_projects_soft_delete
BEFORE DELETE ON projects
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL)      -- already soft-deleted rows: nothing to do
EXECUTE FUNCTION soft_delete_project();

DELETE FROM projects WHERE status = 'on_hold';      -- the app thinks it deleted

SELECT count(*)                                   AS total_rows,
       count(*) FILTER (WHERE deleted_at IS NULL) AS live_rows,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
FROM projects;`,
      explain: `<p>The <code>DELETE</code> reports <code>DELETE 0</code> because the trigger returned NULL for every row, but each row was marked with <code>deleted_at</code> first. The 6 on-hold projects still exist (and their <code>employee_projects</code> rows were not cascaded away). The <code>WHEN</code> clause skips rows already soft-deleted. The inner <code>UPDATE</code> fires UPDATE triggers, not DELETE triggers, so there is no recursion.</p>`,
      output: ` total_rows | live_rows | soft_deleted
------------+-----------+--------------
 24         | 18        | 6
(1 row)`, run: true },
    { label: 'Intermediate', title: 'A live view with INSTEAD OF triggers (delete + restore-friendly)',
      sql: `ALTER TABLE customers ADD COLUMN deleted_at timestamptz;

CREATE VIEW customers_live AS
SELECT id, name, email, country, city, segment
FROM customers
WHERE deleted_at IS NULL;

CREATE FUNCTION customers_live_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE customers SET deleted_at = now() WHERE id = OLD.id;
  RETURN OLD;                       -- non-NULL: count the row as "deleted"
END;
$$;

CREATE TRIGGER trg_customers_live_delete
INSTEAD OF DELETE ON customers_live
FOR EACH ROW EXECUTE FUNCTION customers_live_delete();

DELETE FROM customers_live WHERE id IN (10, 11, 12);   -- app talks to the view

SELECT (SELECT count(*) FROM customers_live)                      AS visible,
       (SELECT count(*) FROM customers WHERE deleted_at IS NOT NULL) AS in_recycle_bin;

-- restore one customer
UPDATE customers SET deleted_at = NULL WHERE id = 11;
SELECT id, name FROM customers_live WHERE id BETWEEN 10 AND 12 ORDER BY id;`,
      explain: `<p>The application reads and deletes through <code>customers_live</code>. The <code>INSTEAD OF DELETE</code> trigger receives each target row as <code>OLD</code> and marks the base row instead; returning <code>OLD</code> makes the command tag report <code>DELETE 3</code>, so ORMs that check affected-row counts stay happy. Orders referencing these customers are untouched (a hard delete would have failed on the foreign key anyway). Restoring is just clearing <code>deleted_at</code>.</p>`,
      output: ` id | name
----+-------------
 11 | Customer 11
(1 row)`, run: true },
    { label: 'Advanced', title: 'Transition tables for bulk changes, with a recursion guard',
      sql: `CREATE TABLE order_status_counts (status text PRIMARY KEY, n bigint NOT NULL);
INSERT INTO order_status_counts SELECT status, count(*) FROM orders GROUP BY status;

CREATE FUNCTION orders_status_summary() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_changed bigint;
BEGIN
  SELECT count(*) INTO v_changed
  FROM old_rows o JOIN new_rows n ON n.id = o.id
  WHERE o.status IS DISTINCT FROM n.status;
  RAISE NOTICE 'trigger depth %, fired once for % changed rows', pg_trigger_depth(), v_changed;

  -- apply all deltas in ONE set-based statement
  INSERT INTO order_status_counts AS c (status, n)
  SELECT status, sum(delta) FROM (
    SELECT o.status, -1 AS delta FROM old_rows o JOIN new_rows n USING (id) WHERE o.status <> n.status
    UNION ALL
    SELECT n.status, +1 FROM old_rows o JOIN new_rows n USING (id) WHERE o.status <> n.status
  ) d
  GROUP BY status
  ON CONFLICT (status) DO UPDATE SET n = c.n + EXCLUDED.n;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_orders_status_summary
AFTER UPDATE ON orders
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
WHEN (pg_trigger_depth() < 1)           -- never re-enter from nested triggers
EXECUTE FUNCTION orders_status_summary();

UPDATE orders SET status = 'delivered'
WHERE status = 'shipped' AND order_date < '2025-01-01';

SELECT c.status, c.n AS counter, t.actual
FROM order_status_counts c
JOIN (SELECT status, count(*) AS actual FROM orders GROUP BY status) t USING (status)
ORDER BY c.status;`,
      explain: `<p>The statement-level trigger fires <strong>once</strong> for the bulk update and receives every changed row in <code>old_rows</code> and <code>new_rows</code>. One <code>INSERT ... ON CONFLICT</code> applies the −1/+1 deltas per status. <code>pg_trigger_depth()</code> is 1 inside the trigger; the <code>WHEN (pg_trigger_depth() &lt; 1)</code> guard means that if another trigger updates <code>orders</code> while handling this one, the summary trigger will not run recursively. The final check shows the counters match a full recount.</p>`,
      output: `NOTICE:  trigger depth 1, fired once for 465 changed rows
 status    | counter | actual
-----------+---------+--------
 cancelled | 428     | 428
 delivered | 2992    | 2992
 paid      | 808     | 808
 pending   | 415     | 415
 shipped   | 357     | 357
(5 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Row-level trigger recalculating a whole aggregate for every changed row
CREATE TABLE status_counts_bad (status text PRIMARY KEY, n bigint);
CREATE FUNCTION recount_all() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM status_counts_bad;
  INSERT INTO status_counts_bad SELECT status, count(*) FROM orders GROUP BY status;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_recount AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION recount_all();
UPDATE orders SET status = 'delivered' WHERE status = 'shipped' AND order_date < '2024-03-01';`,
      why: 'Each changed row triggers a full scan of orders: O(changed rows × table size). 1 000 changed rows on a 5 000-row table already means 5 million row reads.', run: true },
    good: { sql: `CREATE TABLE status_counts_good (status text PRIMARY KEY, n bigint);
INSERT INTO status_counts_good SELECT status, count(*) FROM orders GROUP BY status;
CREATE FUNCTION apply_deltas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO status_counts_good AS c (status, n)
  SELECT status, sum(d) FROM (
    SELECT status, -1 AS d FROM old_rows UNION ALL SELECT status, 1 FROM new_rows) x
  GROUP BY status
  ON CONFLICT (status) DO UPDATE SET n = c.n + EXCLUDED.n;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_deltas AFTER UPDATE ON orders
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION apply_deltas();
UPDATE orders SET status = 'delivered' WHERE status = 'shipped' AND order_date < '2024-03-01';
SELECT * FROM status_counts_good ORDER BY status;`,
      why: 'One trigger call per statement applying incremental deltas from transition tables: O(changed rows).', run: true }
  },
  mistakes: [
    `Soft-deleting without a partial unique index: <code>UNIQUE (email)</code> blocks re-registering an address whose old row is soft-deleted. Use <code>CREATE UNIQUE INDEX ... (email) WHERE deleted_at IS NULL</code>.`,
    `Forgetting to filter <code>deleted_at IS NULL</code> in some queries — exposing "deleted" data. A live view or row-level security policy centralises the filter.`,
    `A trigger on table A that updates table A without a guard, ending in <code>stack depth limit exceeded</code>.`,
    `Returning NULL from an INSTEAD OF trigger and then wondering why the ORM reports "0 rows deleted" and raises a stale-object error.`,
    `Using row-level triggers that run aggregate queries over the whole table — quadratic cost on bulk statements.`,
    `Leaving triggers enabled during huge backfills where the side effects are not wanted; plan maintenance windows explicitly.`
  ],
  best: [
    `Combine <code>deleted_at</code> with a partial index for live-row queries: <code>CREATE INDEX ... WHERE deleted_at IS NULL</code>.`,
    `Expose live rows through a view (or RLS policy) so applications cannot forget the filter.`,
    `Use statement-level triggers with transition tables for summaries, audits and validations on bulk operations.`,
    `Guard self-modifying triggers with <code>WHEN (pg_trigger_depth() &lt; 1)</code> or precise <code>WHEN</code>/<code>UPDATE OF</code> conditions.`,
    `Schedule a purge job that hard-deletes rows soft-deleted beyond the retention period.`
  ],
  performance: `<p>Row-level triggers cost per row: a PL/pgSQL call plus whatever SQL it executes. On bulk statements, a trigger issuing one extra <code>INSERT</code> per row can make a 10-second update take minutes. Transition tables convert that into one set-based statement per DML statement; the tuplestore is cheap but uses <code>work_mem</code>, spilling to temp files for very large statements. Soft-deleted rows still occupy heap and index space: on tables where most rows end up deleted, partial indexes on <code>WHERE deleted_at IS NULL</code> keep index scans small, and periodic purging keeps the heap from bloating.</p>`,
  security: `<p>Soft deletes keep personal data. Under GDPR / India's DPDP Act an erasure request needs a real delete or anonymisation — make sure your purge job or a dedicated "forget customer" procedure handles it, including copies in audit logs. If you rely on a view to hide deleted rows, revoke direct <code>SELECT</code> on the base table from application roles (or use row-level security), otherwise the "deleted" data is one query away.</p>`,
  scenario: { title: 'A bulk carrier update takes 40 seconds and the summary table drifts', steps: [
    '1. Look at pg_trigger for orders: an AFTER UPDATE FOR EACH ROW trigger recalculates the summary per row.',
    '2. Measure with EXPLAIN (ANALYZE) on the UPDATE: "Trigger trg_x: time=... calls=200000".',
    '3. Replace it with an AFTER UPDATE FOR EACH STATEMENT trigger using REFERENCING OLD/NEW TABLE.',
    '4. Apply deltas with a single INSERT ... ON CONFLICT DO UPDATE.',
    '5. Add WHEN (pg_trigger_depth() < 1) to avoid nested re-entry.',
    '6. Reconcile once with a full recount, then verify counters after each deployment.'
  ] },
  interview: [
    { q: 'How do transition tables improve trigger performance?', a: 'A statement-level AFTER trigger with REFERENCING OLD/NEW TABLE fires once per statement and can query all affected rows as tables, so it can do the work in a few set-based SQL statements instead of executing PL/pgSQL and SQL once per row.' },
    { q: 'How would you implement soft delete so applications cannot forget to filter?', a: 'Add deleted_at, expose a view WHERE deleted_at IS NULL (with INSTEAD OF DELETE converting deletes to updates) or a row-level security policy, revoke direct access to the base table, and add partial unique/regular indexes on live rows.' },
    { q: 'How can a trigger cause infinite recursion and how do you prevent it?', a: 'If a trigger on a table modifies the same table (or tables whose triggers modify it back), it fires again indefinitely until the stack depth limit is hit. Prevent it with pg_trigger_depth() checks in a WHEN clause, precise WHEN/UPDATE OF conditions, or restructuring so the modification is done in a BEFORE trigger via NEW.' },
    { q: 'What does an INSTEAD OF trigger function return?', a: 'For INSERT/UPDATE it returns NEW (possibly modified, which feeds RETURNING), for DELETE it returns OLD; returning NULL signals that no row was processed, which reduces the command’s row count.' }
  ],
  exercises: [
    { task: 'Create a partial unique index so that only live (non-deleted) customers must have unique emails, after adding deleted_at to customers. Then soft-delete customer 1 and insert a new customer with the same email.', solution: `ALTER TABLE customers ADD COLUMN deleted_at timestamptz;
ALTER TABLE customers DROP CONSTRAINT customers_email_key;
CREATE UNIQUE INDEX customers_email_live_uq ON customers (email) WHERE deleted_at IS NULL;

UPDATE customers SET deleted_at = now() WHERE id = 1;
INSERT INTO customers (name, email, country, city, segment)
VALUES ('Customer 1 (new)', 'customer1@example.com', 'India', 'Mumbai', 'consumer');

SELECT id, email, deleted_at IS NOT NULL AS deleted
FROM customers WHERE email = 'customer1@example.com' ORDER BY id;`, run: true },
    { task: 'Write a statement-level AFTER INSERT trigger on order_items with a NEW TABLE transition table that raises a NOTICE with the number of rows and total value inserted. Insert two items in one statement.', solution: `CREATE FUNCTION items_inserted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint; v numeric;
BEGIN
  SELECT count(*), sum(quantity * unit_price) INTO n, v FROM new_items;
  RAISE NOTICE '% items inserted, value %', n, v;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_items_inserted AFTER INSERT ON order_items
REFERENCING NEW TABLE AS new_items
FOR EACH STATEMENT EXECUTE FUNCTION items_inserted();

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
VALUES (1, 1, 2, 5004.84), (1, 2, 1, 55051.52);`, run: true }
  ],
  challenge: { task: 'Build a self-protecting trigger: an AFTER UPDATE row trigger on departments that, when budget changes, also updates a "budget_updated_note" in the same row (location stays, use a new column note text). Show that without a guard it would recurse, and add WHEN (pg_trigger_depth() < 1) to make it run exactly once.', hint: 'The trigger’s own UPDATE fires the trigger again; with the depth guard the nested call is skipped.', solution: `ALTER TABLE departments ADD COLUMN note text;

CREATE FUNCTION note_budget_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE departments
     SET note = format('budget %s -> %s (depth %s)', OLD.budget, NEW.budget, pg_trigger_depth())
   WHERE id = NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_note_budget AFTER UPDATE ON departments
FOR EACH ROW
WHEN (pg_trigger_depth() < 1 AND OLD.budget IS DISTINCT FROM NEW.budget)
EXECUTE FUNCTION note_budget_change();

UPDATE departments SET budget = budget + 1 WHERE id = 5;
SELECT id, budget, note FROM departments WHERE id = 5;`, run: true },
  related: ['triggers-fundamentals', 'triggers-audit-logging', 'views-basics', 'materialized-views', 'row-level-security'],
  quiz: [
    { type: 'mcq', q: 'Which clause gives a trigger access to all rows affected by a statement?', options: ['FOR EACH ROW', 'REFERENCING NEW TABLE AS ...', 'WHEN (NEW.*)', 'TG_ARGV'], answer: 1, explain: 'Transition tables are declared with REFERENCING OLD TABLE / NEW TABLE.' },
    { type: 'tf', q: 'Transition tables can be used with BEFORE triggers.', answer: false, explain: 'Transition tables are only available for AFTER triggers.' },
    { type: 'predict', q: 'A BEFORE DELETE trigger updates deleted_at and returns NULL. What command tag does DELETE FROM t WHERE id IN (1,2) return?', options: ['DELETE 2', 'DELETE 0', 'UPDATE 2', 'ERROR'], answer: 1, explain: 'Returning NULL skips the physical delete for each row, so zero rows count as deleted (although they were updated).' },
    { type: 'bug', q: 'This fails with "stack depth limit exceeded". Why?', code: `CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE t SET touched = now() WHERE id = NEW.id; RETURN NULL; END $$;
CREATE TRIGGER tr AFTER UPDATE ON t FOR EACH ROW EXECUTE FUNCTION f();`, options: ['now() is not allowed', 'The trigger’s own UPDATE fires the trigger again, endlessly', 'AFTER triggers cannot UPDATE', 'Missing RETURN NEW'], answer: 1, explain: 'Self-updating AFTER triggers recurse. Use a BEFORE trigger setting NEW.touched, or guard with pg_trigger_depth().' },
    { type: 'design', q: 'With soft deletes, how should you keep emails unique among active users?', options: ['UNIQUE (email)', 'UNIQUE (email, deleted_at)', 'Partial unique index on (email) WHERE deleted_at IS NULL', 'No constraint'], answer: 2, explain: 'A partial unique index enforces uniqueness only for live rows; (email, deleted_at) would allow duplicates among live rows because NULLs are distinct.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: views
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'views-basics',
  module: 'views',
  title: 'Views: CREATE, REPLACE, DROP, Updatable Views and WITH CHECK OPTION',
  level: 2,
  minutes: 20,
  summary: 'Create named, reusable queries with CREATE VIEW, evolve them safely with CREATE OR REPLACE, write through simple views, and stop invalid writes with WITH CHECK OPTION.',
  objectives: [
    'Create, replace and drop views and understand what is stored',
    'Know the rules for CREATE OR REPLACE VIEW (append-only columns)',
    'Insert, update and delete through automatically updatable views',
    'Use WITH LOCAL / CASCADED CHECK OPTION to keep writes inside the view',
    'Recognise when a view hurts performance or maintainability'
  ],
  concept: `<p>A <strong>view</strong> <span class="tag std">SQL standard</span> is a <em>stored query with a name</em>. It holds no data; every time you select from it, PostgreSQL substitutes the query text into yours. Analogy: a <em>saved filter on an email inbox</em> — "Unread from my manager". The emails are not copied anywhere; the filter just shows a particular slice of the same inbox, always up to date.</p>
<h4>Lifecycle</h4>
<ul>
<li><code>CREATE VIEW v AS SELECT ...</code> — stores the parsed query (as a rewrite rule).</li>
<li><code>CREATE OR REPLACE VIEW v AS ...</code> — replaces the definition, but the new query must produce the <em>same columns with the same names and types in the same order</em>; it may only <strong>add new columns at the end</strong>. Renaming, dropping or retyping columns needs <code>DROP VIEW</code> + <code>CREATE VIEW</code> (and dependent views must be dropped too — <code>DROP VIEW ... CASCADE</code>).</li>
<li><code>ALTER VIEW v RENAME COLUMN a TO b</code>, <code>ALTER VIEW v SET (...)</code>, <code>DROP VIEW [IF EXISTS] v [CASCADE]</code>.</li>
<li>Because the stored query references objects by OID, tables used by a view cannot be dropped (or have referenced columns dropped/retyped) without <code>CASCADE</code>.</li>
</ul>
<h4>Automatically updatable views</h4>
<p>A view is automatically updatable (you can <code>INSERT</code>/<code>UPDATE</code>/<code>DELETE</code>/<code>MERGE</code> through it) when it selects from exactly one table or updatable view, with no <code>DISTINCT</code>, <code>GROUP BY</code>, <code>HAVING</code>, aggregates, window functions, <code>LIMIT</code>/<code>OFFSET</code>, set operations or top-level <code>WITH</code>. Individual computed columns (<code>salary * 12</code>) are read-only, but the other columns remain writable. Anything more complex needs an <code>INSTEAD OF</code> trigger.</p>
<h4>WITH CHECK OPTION</h4>
<p>Without it, you can insert or update rows through a filtered view so that they no longer match the filter — they "disappear" from the view. <code>WITH CHECK OPTION</code> rejects such writes. <code>LOCAL</code> checks only this view's condition; <code>CASCADED</code> (the default when you just write <code>WITH CHECK OPTION</code>) also checks the conditions of underlying views.</p>`,
  why: `<p>Views give complex queries a name and a single definition, simplify application code (<code>SELECT * FROM employee_directory</code> instead of a 4-way join), provide a stable interface while base tables are refactored, and — combined with privileges — expose only certain rows and columns. Updatable views let you keep that interface for writes too.</p>`,
  useCase: `<p>An HR platform split <code>employees</code> into <code>employees</code> and <code>employee_contacts</code> during a GDPR refactor. 140 reports used <code>SELECT ... FROM employees</code>. The team renamed the table, created a view with the old name and old column list joining both tables, and the reports kept working unchanged while being migrated over three months. A separate updatable view <code>my_team</code> with <code>WITH CHECK OPTION</code> let line managers edit job titles of their own reports without being able to "move" employees to another manager.</p>`,
  internals: `<p>A view is a <code>pg_class</code> entry with <code>relkind = 'v'</code> and an <code>_RETURN</code> rule in <code>pg_rewrite</code>. During query <strong>rewriting</strong> (after parsing, before planning), every reference to the view is replaced by its query as a subquery. The planner then usually <strong>flattens</strong> that subquery ("pull-up"), so <code>WHERE</code> conditions from the outer query are pushed into it and indexes on the base tables are used — a simple view has no runtime cost. Updatable views are handled by the rewriter translating the DML into DML on the base table, adding the view's <code>WHERE</code> clause; with <code>CHECK OPTION</code>, the executor evaluates the view's conditions against the new row (<code>WithCheckOption</code> nodes in the plan). <code>pg_get_viewdef()</code> shows the stored definition (normalised, with <code>*</code> already expanded).</p>`,
  whenNot: `<p>Avoid stacking views on views on views: the definitions become hard to read, every query plans the whole tower, and changing a base column means dropping the stack. Do not use views to "cache" expensive aggregations — they recompute every time; use a materialized view or summary table. <code>SELECT *</code> in a view is expanded at creation: new table columns do not appear in the view automatically.</p>`,
  syntax: `CREATE [ OR REPLACE ] [ TEMP ] VIEW name [ ( column_name [, ...] ) ]
  [ WITH ( security_barrier [= bool], security_invoker [= bool], check_option = local|cascaded ) ]
  AS query
  [ WITH [ CASCADED | LOCAL ] CHECK OPTION ];

ALTER VIEW name RENAME [ COLUMN ] old TO new;
DROP VIEW [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ];
SELECT pg_get_viewdef('name'::regclass, true);`,
  examples: [
    { label: 'Basic', title: 'A directory view that hides a join',
      sql: `CREATE VIEW employee_directory AS
SELECT e.id,
       e.first_name || ' ' || e.last_name AS full_name,
       e.email,
       e.job_title,
       d.name     AS department,
       d.location AS office,
       m.first_name || ' ' || m.last_name AS manager
FROM employees e
JOIN departments d    ON d.id = e.department_id
LEFT JOIN employees m ON m.id = e.manager_id
WHERE e.is_active;

SELECT full_name, job_title, department, office, manager
FROM employee_directory
WHERE office = 'Gurugram'
ORDER BY full_name
LIMIT 5;`,
      explain: `<p>The view stores the three-table join once. Consumers query it like a table; the outer <code>WHERE office = 'Gurugram'</code> is pushed down into the join by the planner, so no extra cost is paid. Note the <code>LEFT JOIN</code> for managers (heads of department have none) and that inactive employees are excluded centrally.</p>`,
      output: ` full_name   | job_title       | department | office   | manager
-------------+-----------------+------------+----------+--------------
 Anika Bhat  | Associate       | Finance    | Gurugram | Vikram Singh
 Anika Gupta | Specialist      | Finance    | Gurugram | Vikram Singh
 Anika Gupta | Specialist      | Finance    | Gurugram | Vikram Singh
 Anika Menon | Senior Engineer | Finance    | Gurugram | Vikram Singh
 Isha Bose   | Associate       | Finance    | Gurugram | Vikram Singh
(5 rows)`, run: true },
    { label: 'Intermediate', title: 'CREATE OR REPLACE rules and writing through a simple view',
      sql: `CREATE VIEW product_catalog AS
SELECT id, sku, name, category, price
FROM products
WHERE stock > 0;

-- allowed: same columns in the same order, plus a NEW column at the end
CREATE OR REPLACE VIEW product_catalog AS
SELECT id, sku, name, category, price, attributes ->> 'brand' AS brand
FROM products
WHERE stock > 0;

-- not allowed (would raise "cannot drop columns from view"):
-- CREATE OR REPLACE VIEW product_catalog AS SELECT id, sku FROM products;

-- the view is automatically updatable: this UPDATE hits products
UPDATE product_catalog SET price = price * 0.9 WHERE category = 'audio';

SELECT is_updatable, is_insertable_into
FROM information_schema.views
WHERE table_name = 'product_catalog';`,
      explain: `<p>The second definition keeps the five original columns unchanged and appends <code>brand</code>, so <code>CREATE OR REPLACE</code> succeeds. The view selects from one table without aggregates, so PostgreSQL rewrites the <code>UPDATE</code> into an update of <code>products</code> (with the view's <code>stock &gt; 0</code> condition added). The <code>brand</code> column is an expression and therefore read-only, but the others are writable. <code>information_schema.views</code> reports the view as updatable and insertable.</p>`,
      output: ` is_updatable | is_insertable_into
--------------+--------------------
 YES          | YES
(1 row)`, run: true },
    { label: 'Advanced', title: 'WITH CHECK OPTION: LOCAL vs CASCADED',
      sql: `CREATE VIEW premium_products AS
SELECT id, sku, name, category, price, stock
FROM products
WHERE price >= 50000;

CREATE VIEW premium_audio_local AS
SELECT * FROM premium_products WHERE category = 'audio'
WITH LOCAL CHECK OPTION;          -- checks only category = 'audio'

CREATE VIEW premium_audio_cascaded AS
SELECT * FROM premium_products WHERE category = 'audio'
WITH CASCADED CHECK OPTION;       -- checks category AND price >= 50000

DO $$
BEGIN
  -- LOCAL: price drop below 50000 is allowed (only category is checked)
  UPDATE premium_audio_local SET price = 999 WHERE sku = 'SKU-0044';
  RAISE NOTICE 'local view accepted the price change';

  -- CASCADED: the same kind of change is rejected
  UPDATE premium_audio_cascaded SET price = 999 WHERE sku = 'SKU-0064';
EXCEPTION WHEN with_check_option_violation THEN      -- SQLSTATE 44000
  RAISE NOTICE 'cascaded view rejected: %', SQLERRM;
END $$;

SELECT sku, price FROM products WHERE sku IN ('SKU-0044', 'SKU-0064') ORDER BY sku;`,
      explain: `<p>Both views add <code>category = 'audio'</code> on top of <code>premium_products</code> (<code>price &gt;= 50000</code>). With <code>LOCAL</code>, only the outer view's condition is enforced, so a premium audio product can be repriced to 999 and silently drop out of both views. With <code>CASCADED</code>, the underlying view's condition is checked too, and the update fails with SQLSTATE <code>44000</code> (<code>with_check_option_violation</code> — note this is <em>not</em> the same code as a table CHECK constraint, <code>23514</code>). Because the error is raised inside the DO block, the block's earlier successful update is rolled back as well, so both prices are unchanged in the final query.</p>`,
      output: `NOTICE:  local view accepted the price change
NOTICE:  cascaded view rejected: new row violates check option for view "premium_products"
 sku      | price
----------+----------
 SKU-0044 | 72587.30
 SKU-0064 | 68547.40
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `CREATE VIEW india_customers AS
SELECT * FROM customers WHERE country = 'India';
-- write through the view creates a row the view cannot see
INSERT INTO india_customers (name, email, country, city, segment)
VALUES ('Ghost Ltd', 'ghost@example.com', 'UK', 'London', 'smb');
SELECT count(*) AS visible_in_view FROM india_customers WHERE email = 'ghost@example.com';`,
      why: 'Without CHECK OPTION, writes through a filtered view can produce rows outside the view, defeating its purpose as a boundary.', run: true },
    good: { sql: `CREATE VIEW india_customers AS
SELECT * FROM customers WHERE country = 'India'
WITH CHECK OPTION;
DO $$ BEGIN
  INSERT INTO india_customers (name, email, country, city, segment)
  VALUES ('Ghost Ltd', 'ghost@example.com', 'UK', 'London', 'smb');
EXCEPTION WHEN with_check_option_violation THEN
  RAISE NOTICE 'rejected: %', SQLERRM;
END $$;`,
      why: 'WITH CHECK OPTION guarantees every row written through the view is visible through it.', run: true }
  },
  mistakes: [
    `Expecting <code>CREATE OR REPLACE VIEW</code> to drop, rename or reorder columns — it can only append columns.`,
    `Assuming <code>SELECT *</code> in a view picks up columns added to the table later; it was expanded at creation time.`,
    `Using views as a cache for heavy aggregations — they are recomputed on every query.`,
    `Building deep view hierarchies that make schema changes require dropping and recreating a dozen views in the right order.`,
    `Writing through a filtered view without <code>WITH CHECK OPTION</code> and creating "invisible" rows.`
  ],
  best: [
    `List columns explicitly in view definitions instead of <code>SELECT *</code>.`,
    `Keep view definitions in version-controlled migrations; use <code>pg_get_viewdef</code> to inspect what is deployed.`,
    `Add <code>WITH CASCADED CHECK OPTION</code> to filtered views that accept writes.`,
    `Use views as a stable interface during table refactors.`,
    `Limit view nesting to one or two levels.`
  ],
  performance: `<p>Simple views are flattened into the calling query, so they cost nothing and use base-table indexes. Performance problems arise when a view contains something that blocks flattening — aggregates, <code>DISTINCT</code>, window functions, <code>LIMIT</code> — and callers filter on top: the planner may compute the whole view and then filter (although it can still push some predicates into grouped subqueries). Also beware of views joining tables the caller does not need: unless the join is to a unique key with a <code>LEFT JOIN</code> (which the planner can remove), every query pays for it.</p>`,
  security: `<p>Views are a classic permission layer: grant <code>SELECT</code> on the view but not the base table, and users see only the chosen columns/rows. By default a view accesses base tables with the <em>view owner's</em> privileges. The next lesson covers <code>security_barrier</code> and <code>security_invoker</code>, which are essential when views are used for row-level restrictions.</p>`,
  interview: [
    { q: 'Does a view store data?', a: 'No. A regular view stores only its query (as a rewrite rule). Each query against the view is rewritten to include the view’s query, usually flattened by the planner. Materialized views are the variant that stores results.' },
    { q: 'What can and cannot CREATE OR REPLACE VIEW change?', a: 'It can change the query and append new columns at the end, but existing output columns must keep their names, types and order. To drop, rename (other than via ALTER VIEW RENAME COLUMN) or retype columns you must drop and recreate the view.' },
    { q: 'What makes a view automatically updatable?', a: 'Exactly one base relation in FROM, and no DISTINCT, GROUP BY, HAVING, aggregates, window functions, set operations, LIMIT/OFFSET or top-level WITH. Computed columns are read-only but other columns stay updatable.' },
    { q: 'LOCAL vs CASCADED CHECK OPTION?', a: 'LOCAL checks only the conditions of the view on which it is defined; CASCADED also checks the conditions of all underlying views. CASCADED is the default when CHECK OPTION is specified without a qualifier.' }
  ],
  exercises: [
    { task: 'Create a view order_summary showing order id, customer name, country, status, order_date::date and number of items per order, then list the 5 orders with the most items.', solution: `CREATE VIEW order_summary AS
SELECT o.id, c.name AS customer, c.country, o.status, o.order_date::date AS order_day,
       count(oi.id) AS items
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, c.name, c.country;

SELECT * FROM order_summary ORDER BY items DESC, id LIMIT 5;`, run: true },
    { task: 'Create an updatable view active_users(id, username, role, tenant_id) over users WHERE is_active WITH CHECK OPTION, then update the role of user 2 through it.', solution: `CREATE VIEW active_users AS
SELECT id, username, role, tenant_id FROM users WHERE is_active
WITH CHECK OPTION;

UPDATE active_users SET role = 'viewer' WHERE id = 2;
SELECT id, username, role FROM active_users WHERE id = 2;`, run: true }
  ],
  challenge: { task: 'Create a view dept_stats (department, headcount, avg_salary). Then try to change avg_salary to be rounded to 0 decimals AND rename headcount to staff with CREATE OR REPLACE — observe why it fails — and achieve it correctly with DROP VIEW + CREATE VIEW in one transaction.', hint: 'Renaming a column is not allowed by CREATE OR REPLACE; ALTER VIEW ... RENAME COLUMN or DROP/CREATE.', solution: `CREATE VIEW dept_stats AS
SELECT d.name AS department, count(e.id) AS headcount, round(avg(e.salary), 2) AS avg_salary
FROM departments d LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.name;

DROP VIEW dept_stats;
CREATE VIEW dept_stats AS
SELECT d.name AS department, count(e.id) AS staff, round(avg(e.salary), 0) AS avg_salary
FROM departments d LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.name;

SELECT * FROM dept_stats ORDER BY staff DESC LIMIT 3;`, run: true },
  related: ['views-security', 'materialized-views', 'triggers-soft-delete-advanced', 'roles-permissions'],
  quiz: [
    { type: 'mcq', q: 'Which change is allowed with CREATE OR REPLACE VIEW?', options: ['Dropping a column', 'Changing a column type', 'Adding a column at the end', 'Reordering columns'], answer: 2, explain: 'Only appending new columns is allowed; existing columns must stay identical.' },
    { type: 'tf', q: 'A view defined as SELECT * FROM t automatically includes columns added to t later.', answer: false, explain: 'The * is expanded when the view is created; later columns are not included.' },
    { type: 'predict', q: 'v = SELECT * FROM products WHERE price > 100 (no check option). What happens to UPDATE v SET price = 50 WHERE id = 1 (price was 500)?', options: ['Error', 'Row updated and no longer visible in v', 'Nothing happens', 'v is refreshed'], answer: 1, explain: 'Without CHECK OPTION the update succeeds and the row drops out of the view.' },
    { type: 'bug', q: 'Why does UPDATE on this view fail?', code: `CREATE VIEW dept_totals AS
SELECT department_id, sum(salary) AS total FROM employees GROUP BY department_id;
UPDATE dept_totals SET total = 0 WHERE department_id = 1;`, options: ['Missing CHECK OPTION', 'Views with GROUP BY/aggregates are not automatically updatable', 'department_id is not a PK', 'Needs security_barrier'], answer: 1, explain: 'Aggregating views are not automatically updatable; you would need an INSTEAD OF trigger, and it would make little sense here.' }
  ]
},
{
  id: 'views-security',
  module: 'views',
  title: 'Views as a Security Layer: security_barrier and security_invoker',
  level: 3,
  minutes: 22,
  summary: 'Use views as an API and permission layer, understand how a "leaky" function can expose hidden rows through a normal view, and fix it with security_barrier; use security_invoker (PG15+) to make views respect the caller’s privileges and RLS.',
  objectives: [
    'Grant access to a view without granting access to its base tables',
    'Explain the leaky-view problem and how security_barrier prevents it',
    'Understand LEAKPROOF functions and their effect on barrier views',
    'Use security_invoker views so the caller’s privileges and RLS apply',
    'Design a view-based API schema for applications and analysts'
  ],
  concept: `<p>A view can act like a <em>reception desk</em>: visitors (roles) never enter the archive room (the base table); they ask the desk, and the desk only hands over certain files (rows) and certain pages (columns). Two subtleties decide whether the desk is actually secure.</p>
<h4>1. Whose privileges does the view use?</h4>
<p>By default a view accesses its base tables with the privileges of the <strong>view owner</strong> ("security definer" behaviour). That is exactly what lets you <code>GRANT SELECT ON view</code> without granting the table. Since PostgreSQL 15, <code>WITH (security_invoker = true)</code> makes the view check the base tables with the <strong>caller's</strong> privileges — and apply the caller's row-level security policies — which is what you want when the view is a convenience (a join, a rename) rather than a security boundary.</p>
<h4>2. Can a clever query see rows the view filters out?</h4>
<p>The planner flattens views and is free to reorder <code>WHERE</code> conditions, evaluating cheap ones first. If a user writes <code>SELECT * FROM tenant1_users WHERE leak(email)</code>, where <code>leak()</code> is a function they created that prints its argument and claims to be very cheap, the planner may call <code>leak()</code> on <em>every</em> row of the base table before applying the view's <code>tenant_id = 1</code> filter — the hidden rows leak through <code>NOTICE</code> messages or errors. <code>WITH (security_barrier)</code> forces the view's own conditions to be evaluated first; user-supplied conditions are only pushed down if their functions are marked <code>LEAKPROOF</code> (built-in operators such as <code>=</code> on integers are; only superusers can mark functions leakproof).</p>
<table>
<tr><th>Option</th><th>Purpose</th><th>Cost</th></tr>
<tr><td><code>security_barrier</code></td><td>Stop leaky functions from seeing filtered-out rows</td><td>Some plans become worse because non-leakproof conditions cannot be pushed into the view</td></tr>
<tr><td><code>security_invoker</code> (PG15+)</td><td>Use the caller's privileges and RLS on base tables</td><td>Callers need privileges on base tables</td></tr>
</table>`,
  why: `<p>Multi-tenant SaaS, HR systems and analytics platforms need to give different audiences different slices of the same tables. Views are the simplest, most portable tool for that — but a view that only <em>looks</em> secure is worse than no view. Understanding barrier and invoker semantics is what turns a convenience view into an actual security control.</p>`,
  useCase: `<p>A data platform team gives 300 analysts read access through an <code>analytics</code> schema containing only views: <code>analytics.orders</code> exposes orders without customer emails, <code>analytics.customers</code> masks phone numbers. Analysts have <code>USAGE</code> on <code>analytics</code> only. A penetration test showed a user-defined function could print masked rows of a filtered view; the fix was <code>security_barrier</code> on all row-filtering views. For internal convenience views over tables protected by row-level security, they switched to <code>security_invoker = true</code> so each tenant's RLS policies apply to the caller, not to the view owner.</p>`,
  internals: `<p><code>security_barrier</code> is stored in <code>pg_class.reloptions</code>. In the planner, quals from a barrier view's subquery are marked with a higher <code>security_level</code>; a qual from the outer query can only be evaluated before them if it is <code>LEAKPROOF</code> (<code>pg_proc.proleakproof</code>). Row-level security policies are implemented with the same machinery, which is why RLS policy conditions are always applied before user conditions. <code>security_invoker</code> changes the permission check performed by the rewriter: instead of checking base-table access as the view owner, it checks as the current user, and RLS policies are applied for the current user.</p>`,
  whenNot: `<p>Do not implement per-tenant isolation with one view per tenant across hundreds of tenants — use <strong>row-level security</strong> on the tables (with <code>security_invoker</code> views on top if needed). Do not mark your own functions <code>LEAKPROOF</code> to "fix" performance unless you have verified they can never reveal their inputs via errors or messages (even a cast that can fail can leak). Views do not hide data from superusers or the table owner.</p>`,
  syntax: `CREATE VIEW v WITH (security_barrier = true) AS SELECT ... WHERE tenant_id = 1;
CREATE VIEW v WITH (security_invoker = true) AS SELECT ...;   -- PG15+
ALTER VIEW v SET (security_barrier = true);
ALTER VIEW v SET (security_invoker = true);

GRANT USAGE ON SCHEMA api TO app_role;
GRANT SELECT ON api.v TO app_role;          -- no grant on the base table`,
  examples: [
    { label: 'Basic', title: 'A view as a permission layer: columns and rows',
      sql: `CREATE ROLE support_agent NOLOGIN;

-- expose customers without email, and only consumer/smb segments
CREATE VIEW support_customers AS
SELECT id, name, country, city, segment
FROM customers
WHERE segment IN ('consumer', 'smb');

GRANT SELECT ON support_customers TO support_agent;

SET ROLE support_agent;
SELECT segment, count(*) FROM support_customers GROUP BY segment ORDER BY segment;

DO $$ BEGIN
  PERFORM email FROM customers LIMIT 1;           -- base table: no privilege
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'direct access denied: %', SQLERRM;
END $$;
RESET ROLE;`,
      explain: `<p><code>support_agent</code> can read the view because the view accesses <code>customers</code> with its owner's privileges. The agent never sees <code>email</code> or enterprise customers, and selecting from <code>customers</code> directly fails with <code>permission denied</code> (SQLSTATE <code>42501</code>, <code>insufficient_privilege</code>). <code>SET ROLE</code> / <code>RESET ROLE</code> switch the current user for testing.</p>`,
      output: `NOTICE:  direct access denied: permission denied for table customers
 segment  | count
----------+-------
 consumer | 250
 smb      | 125
(2 rows)`, run: true },
    { label: 'Intermediate', title: 'The leaky view attack and security_barrier',
      sql: `-- a "cheap" function that prints everything it sees
CREATE FUNCTION peek(text) RETURNS boolean
LANGUAGE plpgsql COST 0.0000001
AS $$ BEGIN RAISE NOTICE 'peek saw: %', $1; RETURN true; END $$;

CREATE VIEW tenant1_users_leaky AS
SELECT username, email FROM users WHERE tenant_id = 1 AND id <= 6;

CREATE VIEW tenant1_users_safe WITH (security_barrier = true) AS
SELECT username, email FROM users WHERE tenant_id = 1 AND id <= 6;

SET LOCAL enable_seqscan = off;   -- use the PK index for id <= 6: keeps the demo output short
DO $$ BEGIN RAISE NOTICE '--- leaky view ---'; END $$;
SELECT count(*) FROM tenant1_users_leaky WHERE peek(email);

DO $$ BEGIN RAISE NOTICE '--- security_barrier view ---'; END $$;
SELECT count(*) FROM tenant1_users_safe WHERE peek(email);`,
      explain: `<p>Because <code>peek()</code> claims to be extremely cheap, the planner evaluates it <em>before</em> the view's <code>tenant_id = 1</code> condition on the plain view — it sees emails from tenants 2 and 3 (the view's <code>id &lt;= 6</code> filter is applied as a primary-key index condition first — we disable sequential scans only to keep the demo output short; on a real table the leak would cover every row scanned). On the <code>security_barrier</code> view, the view's own conditions are applied first, so <code>peek()</code> only ever sees tenant 1 rows. Both queries return the same count; only the side channel differs.</p>`,
      output: `NOTICE:  --- leaky view ---
NOTICE:  peek saw: user1@tenant2.com
NOTICE:  peek saw: user2@tenant3.com
NOTICE:  peek saw: user3@tenant1.com
NOTICE:  peek saw: user4@tenant2.com
NOTICE:  peek saw: user5@tenant3.com
NOTICE:  peek saw: user6@tenant1.com
NOTICE:  --- security_barrier view ---
NOTICE:  peek saw: user3@tenant1.com
NOTICE:  peek saw: user6@tenant1.com
 count
-------
 2
(1 row)`, run: true },
    { label: 'Advanced', title: 'security_invoker (PG15+): respect the caller’s privileges',
      sql: `CREATE ROLE report_reader NOLOGIN;

CREATE VIEW dept_overview_definer AS
SELECT name, location, budget FROM departments;

CREATE VIEW dept_overview_invoker WITH (security_invoker = true) AS
SELECT name, location, budget FROM departments;

GRANT SELECT ON dept_overview_definer, dept_overview_invoker TO report_reader;

SET ROLE report_reader;
SELECT count(*) AS rows_via_definer_view FROM dept_overview_definer;

DO $$ BEGIN
  PERFORM count(*) FROM dept_overview_invoker;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'invoker view: % (caller needs SELECT on departments)', SQLERRM;
END $$;
RESET ROLE;

SELECT relname, reloptions
FROM pg_class
WHERE relname LIKE 'dept_overview%'
ORDER BY relname;`,
      explain: `<p>The default (definer-style) view lets <code>report_reader</code> read <code>departments</code> through the owner's privileges. The <code>security_invoker</code> view checks the base table as the <em>caller</em>, so the same role is refused until it is granted <code>SELECT</code> on <code>departments</code> — and if <code>departments</code> had row-level security, the caller's policies would apply. <code>pg_class.reloptions</code> shows which views carry the option.</p>`,
      output: `NOTICE:  invoker view: permission denied for table departments (caller needs SELECT on departments)
 relname               | reloptions
-----------------------+-------------------------
 dept_overview_definer |
 dept_overview_invoker | {security_invoker=true}
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Row filter view without security_barrier: user functions may run on hidden rows
CREATE VIEW enterprise_hidden AS
SELECT id, name, country FROM customers WHERE segment <> 'enterprise';
SELECT relname, reloptions FROM pg_class WHERE relname = 'enterprise_hidden';`,
      why: 'A non-barrier view used as a row-level security boundary can leak filtered rows to any user-defined function in the caller’s WHERE clause.', run: true },
    good: { sql: `CREATE VIEW enterprise_hidden WITH (security_barrier = true) AS
SELECT id, name, country FROM customers WHERE segment <> 'enterprise';
SELECT relname, reloptions FROM pg_class WHERE relname = 'enterprise_hidden';`,
      why: 'security_barrier ensures the view’s filter runs before any non-leakproof caller condition.', run: true }
  },
  mistakes: [
    `Using a plain view as a row-level security boundary without <code>security_barrier</code>.`,
    `Assuming views always use the caller's privileges — by default they use the owner's, which can unintentionally bypass RLS on base tables when the owner is the table owner.`,
    `Owning views with a superuser; superusers bypass RLS, so a definer-style view owned by a superuser bypasses all policies.`,
    `Marking custom functions <code>LEAKPROOF</code> to get better plans without auditing them.`,
    `Forgetting <code>GRANT USAGE ON SCHEMA</code> when exposing views in a separate API schema.`
  ],
  best: [
    `Put externally consumed views in a dedicated schema (<code>api</code>, <code>analytics</code>) and grant only that schema.`,
    `Use <code>security_barrier</code> for views whose purpose is hiding rows.`,
    `Use <code>security_invoker = true</code> for convenience views over RLS-protected tables.`,
    `Own security views with a dedicated non-superuser role.`,
    `Test views by actually <code>SET ROLE</code>-ing to the consumer role in CI.`
  ],
  performance: `<p><code>security_barrier</code> can make queries slower: a user predicate using a non-leakproof function (e.g. <code>lower(email) = ...</code>, <code>LIKE</code> on some types) cannot be pushed below the view's filter, so indexes matching it may not be used and more rows are processed. Built-in comparison operators on common types are leakproof and still push down. <code>security_invoker</code> has no performance cost by itself, but if it activates RLS policies those add their own filter conditions.</p>`,
  security: `<p>This lesson is the security story: definer vs invoker semantics decide whose privileges and policies apply; barrier semantics decide whether filtered rows can leak through side channels (notices, errors, timing). For tenant isolation at scale prefer row-level security policies on tables, with <code>FORCE ROW LEVEL SECURITY</code> if the owner should also be restricted, and keep views as an interface layer.</p>`,
  widgets: ['lab:security'],
  scenario: { title: "A pen test extracts hidden rows through a view", steps: [
    "1. Tester creates a cheap function that RAISEs NOTICE its argument and filters the view with it.",
    "2. NOTICE output contains rows of other tenants: the view lacks security_barrier.",
    "3. ALTER VIEW ... SET (security_barrier = true) on every row-filtering view.",
    "4. Check view owners: superuser-owned views bypass RLS; change ownership to a non-superuser role.",
    "5. For convenience views over RLS tables, set security_invoker = true.",
    "6. Re-run the attack as the low-privilege role in CI."
  ] },
  interview: [
    { q: 'What is a leaky view and how do you prevent it?', a: 'A view used to hide rows where the planner can evaluate a caller-supplied function before the view’s own filter, letting that function observe hidden rows (e.g. via RAISE NOTICE). Defining the view WITH (security_barrier) forces the view’s conditions to be evaluated first; only LEAKPROOF functions may be pushed below them.' },
    { q: 'What does security_invoker change?', a: 'Since PG15, a view with security_invoker = true checks permissions on underlying relations as the user executing the query instead of the view owner, and applies that user’s RLS policies. Default views behave like security definer for base-table access.' },
    { q: 'Why can a view owned by a superuser be dangerous with RLS?', a: 'Default views access base tables as the owner. Superusers (and table owners, unless FORCE ROW LEVEL SECURITY) bypass RLS, so every caller of the view effectively bypasses the policies.' }
  ],
  exercises: [
    { task: 'Create a role analyst and a view api_orders exposing id, status, order_date and total_amount of orders (no customer_id). Grant it, switch role and count orders by status through the view.', solution: `CREATE ROLE analyst NOLOGIN;
CREATE VIEW api_orders AS SELECT id, status, order_date, total_amount FROM orders;
GRANT SELECT ON api_orders TO analyst;
SET ROLE analyst;
SELECT status, count(*) FROM api_orders GROUP BY status ORDER BY status;
RESET ROLE;`, run: true },
    { task: 'Convert an existing view to security_barrier with ALTER VIEW and confirm via pg_class.reloptions.', solution: `CREATE VIEW live_products AS SELECT id, sku, name FROM products WHERE stock > 0;
ALTER VIEW live_products SET (security_barrier = true);
SELECT relname, reloptions FROM pg_class WHERE relname = 'live_products';`, run: true }
  ],
  challenge: { task: 'Combine RLS and security_invoker: enable row-level security on users with a policy tenant_id = current_setting(\'app.tenant\')::int for role tenant_app, create a security_invoker view users_api(id, username, role), grant SELECT on both to tenant_app, set app.tenant = 2 and show the view returns only tenant 2 users.', hint: 'ALTER TABLE users ENABLE ROW LEVEL SECURITY; CREATE POLICY ... TO tenant_app USING (...); set_config(\'app.tenant\', \'2\', true).', solution: `CREATE ROLE tenant_app NOLOGIN;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users TO tenant_app
  USING (tenant_id = current_setting('app.tenant')::int);
CREATE VIEW users_api WITH (security_invoker = true) AS
  SELECT id, username, role, tenant_id FROM users;
GRANT SELECT ON users, users_api TO tenant_app;

SELECT set_config('app.tenant', '2', true);
SET ROLE tenant_app;
SELECT tenant_id, count(*) FROM users_api GROUP BY tenant_id;
RESET ROLE;`, run: true },
  related: ['views-basics', 'row-level-security', 'roles-permissions', 'security'],
  quiz: [
    { type: 'mcq', q: 'By default, whose privileges are used to access a view’s base tables?', options: ['The caller', 'The view owner', 'The superuser', 'PUBLIC'], answer: 1, explain: 'Default views check base-table access as the view owner; security_invoker changes that.' },
    { type: 'tf', q: 'security_barrier prevents built-in leakproof operators such as integer = from being pushed into the view.', answer: false, explain: 'LEAKPROOF functions/operators may still be pushed down; only non-leakproof ones are held back.' },
    { type: 'scenario', q: 'Tables are protected by RLS. You create a convenience view joining two of them for the app role, owned by the table owner. Users suddenly see other tenants’ rows. Fix?', options: ['Add security_barrier', 'Set security_invoker = true on the view', 'Grant SELECT on the tables', 'Use a materialized view'], answer: 1, explain: 'The view accesses tables as its owner, who bypasses RLS. security_invoker makes the caller’s policies apply.' },
    { type: 'mcq', q: 'Who can mark a function LEAKPROOF?', options: ['Any function owner', 'Only superusers', 'Database owner', 'Members of pg_read_all_data'], answer: 1, explain: 'Only superusers can set LEAKPROOF because it is a security promise the planner relies on.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: materialized-views
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'materialized-views-basics',
  module: 'materialized-views',
  title: 'Materialized Views: CREATE, REFRESH and REFRESH CONCURRENTLY',
  level: 3,
  minutes: 22,
  summary: 'Store the result of an expensive query on disk with CREATE MATERIALIZED VIEW, index it like a table, and keep it fresh with REFRESH — concurrently, without blocking readers, when it has a unique index.',
  objectives: [
    'Create a materialized view and query it like a table',
    'Explain why materialized data goes stale and how REFRESH works',
    'Index a materialized view for fast lookups',
    'Use REFRESH MATERIALIZED VIEW CONCURRENTLY and its unique-index requirement',
    'Compare the locking of plain vs concurrent refresh'
  ],
  concept: `<p>A <strong>materialized view</strong> (MV) <span class="tag core">core</span> is a view whose result is <em>computed once and saved</em> as a real table on disk. Analogy: a regular view is a <em>live camera feed</em> — always current, but every viewer makes the camera work. A materialized view is a <em>photograph</em> taken at a moment — instantly viewable by anyone, but it shows the scene as it was when the photo was taken, until you take a new one (<code>REFRESH</code>).</p>
<h4>Lifecycle</h4>
<ul>
<li><code>CREATE MATERIALIZED VIEW mv AS query [WITH [NO] DATA]</code> — runs the query and stores the rows (or creates it empty and unscannable with <code>WITH NO DATA</code>).</li>
<li>You can create <strong>indexes</strong> on it, <code>ANALYZE</code> it, and query it like any table. You cannot <code>INSERT/UPDATE/DELETE</code> it.</li>
<li><code>REFRESH MATERIALIZED VIEW mv</code> — re-runs the query and <em>replaces</em> the contents. It takes an <code>ACCESS EXCLUSIVE</code> lock: readers block for the duration.</li>
<li><code>REFRESH MATERIALIZED VIEW CONCURRENTLY mv</code> — computes the new result into a temp table, diffs it against the current contents and applies only the changes with ordinary inserts/updates/deletes, holding only an <code>EXCLUSIVE</code> lock that <em>allows concurrent SELECTs</em>. Requirements: the MV must already be populated and must have at least one <strong>UNIQUE index</strong> on plain columns (no <code>WHERE</code> clause, no expressions) covering all rows.</li>
</ul>
<div class="callout warn">PostgreSQL has no built-in automatic or incremental refresh. Data is only as fresh as the last <code>REFRESH</code>. Scheduling is up to you — <code>pg_cron</code> <span class="tag ext">extension</span>, an external scheduler, or application events.</div>`,
  why: `<p>Dashboards and reports often run the same heavy aggregation (millions of order rows joined and grouped) many times per minute, while the business is fine with numbers that are a few minutes old. Recomputing on every page view wastes CPU and I/O; an MV turns a 3-second aggregation into a 2-millisecond indexed lookup, at the price of controlled staleness.</p>`,
  useCase: `<p>An e-commerce company's seller dashboard showed daily revenue per seller computed from 400 million order lines; each page load ran a 6-second query and peak traffic (4 000 sellers checking at 9 a.m.) saturated the primary. They created <code>mv_seller_daily_revenue</code> with a unique index on <code>(seller_id, day)</code>, refreshed <code>CONCURRENTLY</code> every 10 minutes by <code>pg_cron</code>. Page loads dropped to 3 ms, primary CPU fell from 85% to 30%, and sellers accepted the "updated 10 minutes ago" label shown in the UI.</p>`,
  internals: `<p>An MV is a <code>pg_class</code> entry with <code>relkind = 'm'</code>, with its own heap and indexes plus a rewrite rule holding the query (visible in <code>pg_matviews.definition</code>). A plain refresh builds a <em>new heap file</em> with the fresh result and swaps the relfilenode, like <code>TRUNCATE</code> + reload, then rebuilds indexes — fast and compact, but under <code>ACCESS EXCLUSIVE</code>. A concurrent refresh runs the query into a temporary table, performs a <code>FULL OUTER JOIN</code> between old and new contents using the unique index columns to find differences, and applies them as DML: it generates dead tuples (needing vacuum) and is usually slower than a plain refresh when much of the data changes, but readers never wait. Only one refresh of a given MV can run at a time.</p>`,
  whenNot: `<p>Avoid MVs when users need real-time accuracy (account balances, stock levels at checkout), when the base data changes so much that each refresh costs as much as querying live, or when refresh takes longer than the desired freshness interval. For incremental maintenance of simple aggregates, a summary table updated by triggers or batch upserts (next lesson) can be fresher and cheaper. Indexes on the base tables may make the live query fast enough that no MV is needed at all.</p>`,
  syntax: `CREATE MATERIALIZED VIEW [ IF NOT EXISTS ] name [ (column_name [, ...]) ]
  [ USING method ] [ WITH ( storage_parameter = value ) ] [ TABLESPACE ts ]
  AS query
  [ WITH [ NO ] DATA ];

REFRESH MATERIALIZED VIEW [ CONCURRENTLY ] name [ WITH [ NO ] DATA ];
CREATE UNIQUE INDEX ON name (key_columns);      -- required for CONCURRENTLY
DROP MATERIALIZED VIEW [ IF EXISTS ] name [ CASCADE ];
SELECT * FROM pg_matviews;`,
  examples: [
    { label: 'Basic', title: 'Precompute monthly revenue per country',
      sql: `CREATE MATERIALIZED VIEW mv_monthly_revenue AS
SELECT date_trunc('month', o.order_date)::date AS month,
       c.country,
       count(*)              AS orders,
       sum(o.total_amount)   AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled'
GROUP BY 1, 2;

CREATE INDEX ON mv_monthly_revenue (country, month);

SELECT month, country, orders, revenue
FROM mv_monthly_revenue
WHERE country = 'India'
ORDER BY month DESC
LIMIT 4;`,
      explain: `<p>The MV runs the join and aggregation once and stores the ~130 result rows. Subsequent queries read the small stored table — here using an ordinary index on <code>(country, month)</code> — instead of scanning 5 000 orders and 500 customers each time. On a production-size orders table this is the difference between seconds and milliseconds.</p>`,
      output: ` month      | country | orders | revenue
------------+---------+--------+-------------
 2025-10-01 | India   | 2      | 1317553.04
 2025-09-01 | India   | 76     | 17875585.94
 2025-08-01 | India   | 87     | 22935278.30
 2025-07-01 | India   | 70     | 16119558.63
(4 rows)`, run: true },
    { label: 'Intermediate', title: 'Staleness in action, then REFRESH',
      sql: `CREATE MATERIALIZED VIEW mv_customer_totals AS
SELECT customer_id, count(*) AS orders, sum(total_amount) AS spent
FROM orders
WHERE status <> 'cancelled'
GROUP BY customer_id;

-- a new big order arrives
INSERT INTO orders (customer_id, status, order_date, total_amount)
VALUES (7, 'paid', now(), 999999);

CREATE TEMP TABLE snapshot AS
SELECT 1 AS step, 'MV before refresh' AS phase, orders, spent FROM mv_customer_totals WHERE customer_id = 7
UNION ALL
SELECT 2, 'live query', count(*), sum(total_amount) FROM orders
WHERE customer_id = 7 AND status <> 'cancelled';

REFRESH MATERIALIZED VIEW mv_customer_totals;

SELECT phase, orders, spent FROM snapshot
UNION ALL
SELECT 'MV after refresh', orders, spent FROM mv_customer_totals WHERE customer_id = 7;`,
      explain: `<p>Right after the insert, the MV still reports the old totals while the live query already includes the new order — this is <strong>staleness</strong> (we save both numbers in a temp table so all three phases appear in one result). A plain <code>REFRESH</code> recomputes everything and swaps in the new result (blocking readers of the MV meanwhile). The last query shows the MV has caught up; it now matches the live numbers.</p>`,
      output: ` phase             | orders | spent
-------------------+--------+------------
 MV before refresh | 10     | 3240748.98
 live query        | 11     | 4240747.98
 MV after refresh  | 11     | 4240747.98
(3 rows)`, run: true },
    { label: 'Advanced', title: 'REFRESH CONCURRENTLY with the required unique index',
      sql: `CREATE MATERIALIZED VIEW mv_product_sales AS
SELECT p.id AS product_id, p.sku, p.category,
       coalesce(sum(oi.quantity), 0)                 AS units,
       coalesce(sum(oi.quantity * oi.unit_price), 0) AS revenue
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id, p.sku, p.category;

-- without this, CONCURRENTLY fails with:
-- "cannot refresh materialized view concurrently ... create a unique index with no WHERE clause"
CREATE UNIQUE INDEX mv_product_sales_pk ON mv_product_sales (product_id);

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
VALUES (1, 3, 2000, 27311.98);       -- a huge B2B order for product 3

-- readers can keep querying mv_product_sales while this runs
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_sales;

SELECT matviewname, ispopulated, hasindexes
FROM pg_matviews WHERE matviewname = 'mv_product_sales';

SELECT product_id, sku, units, revenue
FROM mv_product_sales
ORDER BY revenue DESC
LIMIT 3;`,
      explain: `<p>The unique index on <code>product_id</code> lets the concurrent refresh match old and new rows and apply only the differences — here a single changed row for product 3, which jumps to the top. Plain refresh would lock out readers; <code>CONCURRENTLY</code> only blocks other refreshes and writes-to-MV (which do not exist). It must run outside a transaction block in some clients' autocommit modes, and on the first population you must use a plain refresh (it requires an already-populated MV). <code>pg_matviews</code> shows the state.</p>`,
      output: ` product_id | sku      | units | revenue
------------+----------+-------+-------------
 3          | SKU-0003 | 2121  | 57928709.58
 36         | SKU-0036 | 507   | 40644303.96
 76         | SKU-0076 | 509   | 39513934.68
(3 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Dashboard recomputes the aggregation on every page view
SELECT c.country, date_trunc('month', o.order_date)::date AS month, sum(o.total_amount) AS revenue
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled' AND c.country = 'UK'
GROUP BY 1, 2 ORDER BY 2 DESC LIMIT 3;`,
      why: 'Every viewer re-scans and re-aggregates all orders; cost grows with the table and the number of dashboard users.', run: true },
    good: { sql: `CREATE MATERIALIZED VIEW mv_rev AS
SELECT c.country, date_trunc('month', o.order_date)::date AS month, sum(o.total_amount) AS revenue
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled'
GROUP BY 1, 2;
CREATE UNIQUE INDEX ON mv_rev (country, month);
SELECT * FROM mv_rev WHERE country = 'UK' ORDER BY month DESC LIMIT 3;`,
      why: 'Aggregation runs once per refresh; each page view is an index lookup on a tiny table.', run: true }
  },
  mistakes: [
    `Expecting a materialized view to update itself when base tables change. It never does without <code>REFRESH</code>.`,
    `Running plain <code>REFRESH</code> on an MV that a busy dashboard reads — every reader blocks until it finishes.`,
    `Trying <code>CONCURRENTLY</code> without a suitable unique index (or with a partial/expression unique index) — it fails.`,
    `Using <code>CONCURRENTLY</code> on the first population (the MV must already be populated).`,
    `Forgetting to index the MV; a large MV without indexes is just a big table to scan.`,
    `Scheduling refreshes more often than a refresh takes, so they queue up behind each other.`
  ],
  best: [
    `Always give MVs a unique index on their natural key so you can refresh concurrently.`,
    `Show data freshness ("as of 10:20") in the UI and agree on an acceptable staleness with the business.`,
    `Schedule refreshes with <code>pg_cron</code> or your job scheduler, and monitor duration.`,
    `Run <code>ANALYZE</code> on big MVs after refresh if autovacuum is slow to notice.`,
    `Keep MV queries deterministic; avoid <code>now()</code>-dependent filters unless you refresh accordingly.`
  ],
  performance: `<p>Reads from an MV are as fast as from a table of the same size. Refresh cost equals the cost of running the full query, plus for <code>CONCURRENTLY</code> a diff join and DML (dead tuples, WAL for each changed row). Rule of thumb: if a large fraction of rows changes every refresh, plain refresh is faster (it writes a fresh compact heap) — use it during low-traffic windows or behind a swap pattern; if only a small fraction changes, <code>CONCURRENTLY</code> is cheaper in WAL and keeps readers unblocked. MVs are WAL-logged and replicated, so read replicas can serve them too.</p>`,
  security: `<p>An MV stores a copy of data; privileges on the MV are independent of privileges on the base tables (like a table). Row-level security policies on base tables are applied <em>at refresh time as the MV owner</em>, not per reader — an MV can therefore expose rows that RLS would hide from a given reader. Grant access to MVs with the same care as to tables; refresh requires ownership of the MV (or membership in <code>pg_maintain</code> in PG17+).</p>`,
  scenario: { title: "Dashboard freezes every 10 minutes", steps: [
    "1. Users report the dashboard hangs for ~40 seconds at :00, :10, :20 ...",
    "2. pg_stat_activity shows SELECTs waiting on a lock held by REFRESH MATERIALIZED VIEW.",
    "3. Plain refresh takes ACCESS EXCLUSIVE; create a UNIQUE index on the MV's key columns.",
    "4. Switch the scheduled job to REFRESH MATERIALIZED VIEW CONCURRENTLY.",
    "5. Monitor refresh duration and dead tuples on the MV; tune autovacuum for it.",
    "6. Display 'data as of' time in the dashboard."
  ] },
  interview: [
    { q: 'What is the difference between a view and a materialized view?', a: 'A view stores only its query and recomputes results at every access, always current. A materialized view stores the result rows on disk, can be indexed, and is only as current as its last REFRESH.' },
    { q: 'What does REFRESH MATERIALIZED VIEW CONCURRENTLY require and what does it buy you?', a: 'It requires the MV to be populated and to have a unique index on plain columns without a WHERE clause. It computes the new result, diffs it against the old one and applies changes with DML under an EXCLUSIVE lock, so SELECTs on the MV continue during the refresh.' },
    { q: 'When is plain REFRESH preferable to CONCURRENTLY?', a: 'When most rows change each time or nobody reads the MV during the refresh: plain refresh rewrites a compact new heap quickly without dead tuples, whereas the concurrent diff generates lots of DML and bloat.' },
    { q: 'Does PostgreSQL support incremental materialized view maintenance natively?', a: 'No. Built-in MVs are refreshed by recomputing the whole query. Incremental maintenance requires summary tables with triggers/batch upserts or third-party extensions such as pg_ivm.' }
  ],
  exercises: [
    { task: 'Create a materialized view mv_category_stock with category, number of products, total stock and average price, add a unique index on category and refresh it concurrently.', solution: `CREATE MATERIALIZED VIEW mv_category_stock AS
SELECT category, count(*) AS products, sum(stock) AS total_stock, round(avg(price), 2) AS avg_price
FROM products GROUP BY category;

CREATE UNIQUE INDEX ON mv_category_stock (category);
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_category_stock;
SELECT * FROM mv_category_stock ORDER BY total_stock DESC;`, run: true },
    { task: 'Create a materialized view WITH NO DATA, show it is not populated using pg_matviews, then populate it with REFRESH.', solution: `CREATE MATERIALIZED VIEW mv_payment_methods AS
SELECT method, status, count(*) AS n, sum(amount) AS amount FROM payments GROUP BY method, status
WITH NO DATA;

SELECT matviewname, ispopulated FROM pg_matviews WHERE matviewname = 'mv_payment_methods';
REFRESH MATERIALIZED VIEW mv_payment_methods;
SELECT * FROM mv_payment_methods WHERE status = 'failed' ORDER BY n DESC;`, run: true }
  ],
  challenge: { task: 'Build mv_daily_sales(day, orders, revenue) for non-cancelled orders with a unique index on day. Insert a new order dated 2025-10-15, refresh concurrently, and prove the day’s numbers changed by comparing to a value captured before the refresh.', hint: 'Use a temp table or CTE to keep the before value; date_trunc or ::date on order_date.', solution: `CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT order_date::date AS day, count(*) AS orders, sum(total_amount) AS revenue
FROM orders WHERE status <> 'cancelled' GROUP BY 1;
CREATE UNIQUE INDEX ON mv_daily_sales (day);

CREATE TABLE before_refresh AS SELECT * FROM mv_daily_sales WHERE day = '2025-10-15';
INSERT INTO orders (customer_id, status, order_date, total_amount)
VALUES (5, 'paid', '2025-10-15 12:00', 12345);
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales;

SELECT b.orders AS orders_before, m.orders AS orders_after,
       m.revenue - coalesce(b.revenue, 0) AS revenue_delta
FROM mv_daily_sales m LEFT JOIN before_refresh b USING (day)
WHERE m.day = '2025-10-15';`, run: true },
  related: ['materialized-views-strategies', 'views-basics', 'indexes', 'aggregations'],
  quiz: [
    { type: 'mcq', q: 'What is required for REFRESH MATERIALIZED VIEW CONCURRENTLY?', options: ['A primary key on the base table', 'A unique index on the MV without WHERE clause, on plain columns', 'pg_cron', 'security_barrier'], answer: 1, explain: 'The concurrent refresh needs a unique index on the MV to match old and new rows.' },
    { type: 'tf', q: 'A materialized view is automatically refreshed when its base tables change.', answer: false, explain: 'PostgreSQL never refreshes MVs automatically.' },
    { type: 'mcq', q: 'Which lock does a plain REFRESH take on the MV?', options: ['ROW EXCLUSIVE', 'SHARE', 'ACCESS EXCLUSIVE — blocks readers', 'None'], answer: 2, explain: 'Plain refresh takes ACCESS EXCLUSIVE, blocking even SELECTs until it commits.' },
    { type: 'scenario', q: 'A dashboard MV takes 4 minutes to refresh and dashboards freeze during refresh. Best fix?', options: ['Refresh more often', 'Add a unique index and use REFRESH ... CONCURRENTLY', 'Convert to a normal view', 'Drop all indexes on the MV'], answer: 1, explain: 'Concurrent refresh keeps readers unblocked; the unique index is required for it.' }
  ]
},
{
  id: 'materialized-views-strategies',
  module: 'materialized-views',
  title: 'Refresh Strategies and Choosing Views vs Materialized Views vs Summary Tables',
  level: 4,
  minutes: 22,
  summary: 'Decide how and when to refresh, track and expose staleness, and choose between a plain view, a materialized view and an incrementally maintained summary table based on freshness, cost and scale.',
  objectives: [
    'Design refresh schedules based on freshness requirements and refresh cost',
    'Track the last refresh time and expose data age',
    'Build an incrementally maintained summary table with upserts',
    'Compare views, materialized views and summary tables on freshness, read cost and write cost',
    'Avoid common operational pitfalls (overlapping refreshes, dependency chains, bloat)'
  ],
  concept: `<p>Precomputed data is always a trade-off between <strong>freshness</strong>, <strong>read cost</strong> and <strong>write/refresh cost</strong>. Analogy: three ways to know how many people are in a stadium. A <em>view</em> is counting heads every time someone asks (always right, slow). A <em>materialized view</em> is a headcount photo every 10 minutes (fast to read, up to 10 minutes wrong). A <em>summary table</em> is a turnstile counter that adds or subtracts as each person passes (fast and nearly real-time, but every entry pays a tiny cost and the counter must be designed carefully so it never drifts).</p>
<table>
<tr><th></th><th>View</th><th>Materialized view</th><th>Summary table (incremental)</th></tr>
<tr><td>Freshness</td><td>Always current</td><td>As of last refresh</td><td>Real-time (trigger) or near real-time (batch upserts)</td></tr>
<tr><td>Read cost</td><td>Full query every time</td><td>Table/index lookup</td><td>Table/index lookup</td></tr>
<tr><td>Write overhead on base tables</td><td>None</td><td>None</td><td>Per-write (trigger) or per-batch</td></tr>
<tr><td>Refresh cost</td><td>n/a</td><td>Full recomputation</td><td>Proportional to changes</td></tr>
<tr><td>Complexity</td><td>Lowest</td><td>Low + scheduling</td><td>Highest: deltas, races, reconciliation</td></tr>
<tr><td>Best for</td><td>Simple joins, security layer, cheap queries</td><td>Heavy reports tolerating minutes/hours of lag</td><td>High-traffic counters, large data with small change rate</td></tr>
</table>
<h4>Refresh strategies for MVs</h4>
<ul>
<li><strong>Time-based</strong>: every N minutes via <code>pg_cron</code> <span class="tag ext">extension</span> or an external scheduler. Choose N ≥ 2–3× refresh duration.</li>
<li><strong>Event-based</strong>: after an ETL load finishes, the loader calls REFRESH.</li>
<li><strong>On-demand with debounce</strong>: writers set a "dirty" flag; a job refreshes only if dirty.</li>
<li><strong>Dependency order</strong>: MVs built on MVs must be refreshed bottom-up.</li>
</ul>`,
  why: `<p>Teams often pick the wrong tool: a view for a 10-second aggregation hit 50 times per second, or a nightly MV for data the operations team needs in real time, or a trigger-maintained summary for a monthly report nobody looks at. Making the trade-offs explicit avoids both overloaded databases and misleading dashboards.</p>`,
  useCase: `<p>A food-delivery company uses all three. Restaurant menus with prices are a <strong>view</strong> joining menu items and current price rules (cheap, must be exact). The city-level weekly KPI report is a <strong>materialized view</strong> refreshed at 02:00 after the ETL load (heavy, daily freshness is fine). Live "orders in progress per restaurant" — read 20 000 times per minute by restaurant tablets — is a <strong>summary table</strong> updated by batch upserts every 5 seconds from an outbox, with an hourly reconciliation job that recomputes from scratch and corrects drift.</p>`,
  internals: `<p>REFRESH holds locks for the entire duration: <code>ACCESS EXCLUSIVE</code> (plain) or <code>EXCLUSIVE</code> (concurrent). Two concurrent refreshes of the same MV serialise. A concurrent refresh produces dead tuples equal to the number of changed rows, so frequently refreshed MVs need autovacuum attention. Summary tables updated via <code>INSERT ... ON CONFLICT DO UPDATE</code> take row locks on the summary row: if thousands of writers increment the <em>same</em> counter row per second, that row becomes a hot spot (lock contention, many dead tuples) — mitigations are batching deltas or sharding counters into N slots summed on read.</p>`,
  whenNot: `<p>Do not precompute at all until you have measured that the live query is too slow even with proper indexes. Do not build trigger-maintained summaries on tables with very high write rates without considering hot-row contention. Avoid MV chains more than two levels deep; each layer multiplies refresh time and operational fragility. For analytics at very large scale, a columnar store or OLAP system (ClickHouse, BigQuery, or columnar extensions like Citus columnar / Hydra <span class="tag ext">extension</span>) may be the better architecture.</p>`,
  syntax: `-- time-based refresh with pg_cron (extension, not core):
-- SELECT cron.schedule('refresh-sales', '*/10 * * * *',
--        'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sales');

-- incremental summary table pattern
INSERT INTO summary AS s (key, value)
SELECT key, sum(delta) FROM changes GROUP BY key
ON CONFLICT (key) DO UPDATE SET value = s.value + EXCLUDED.value;`,
  examples: [
    { label: 'Basic', title: 'Tracking refresh time and exposing data age',
      sql: `CREATE TABLE mv_refresh_log (
  mv_name      text PRIMARY KEY,
  refreshed_at timestamptz NOT NULL,
  duration_ms  numeric NOT NULL
);

CREATE MATERIALIZED VIEW mv_segment_revenue AS
SELECT c.segment, count(*) AS orders, sum(o.total_amount) AS revenue
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled'
GROUP BY c.segment;

CREATE PROCEDURE refresh_mv(p_name text)
LANGUAGE plpgsql
AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
BEGIN
  EXECUTE format('REFRESH MATERIALIZED VIEW %I', p_name);
  INSERT INTO mv_refresh_log (mv_name, refreshed_at, duration_ms)
  VALUES (p_name, now(), round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1))
  ON CONFLICT (mv_name) DO UPDATE
    SET refreshed_at = EXCLUDED.refreshed_at, duration_ms = EXCLUDED.duration_ms;
END;
$$;

CALL refresh_mv('mv_segment_revenue');

SELECT r.segment, r.orders, r.revenue,
       now() - l.refreshed_at < interval '1 minute' AS fresh
FROM mv_segment_revenue r
CROSS JOIN mv_refresh_log l
WHERE l.mv_name = 'mv_segment_revenue'
ORDER BY r.revenue DESC;`,
      explain: `<p>A procedure wraps the refresh, timing it with <code>clock_timestamp()</code> and recording the time in a log table (<code>format('%I')</code> safely quotes the MV name for dynamic SQL). Readers join the log to show freshness — the UI can display "updated N minutes ago" and alerting can fire when an MV is older than its SLA. Duration history tells you whether the refresh interval is still realistic as data grows.</p>`,
      output: ` segment    | orders | revenue      | fresh
------------+--------+--------------+-------
 consumer   | 2303   | 564205944.30 | t
 enterprise | 1148   | 292585413.41 | t
 smb        | 1121   | 276976135.03 | t
(3 rows)`, run: true },
    { label: 'Intermediate', title: 'An incrementally maintained summary table',
      sql: `CREATE TABLE product_sales_summary (
  product_id int PRIMARY KEY,
  units      bigint  NOT NULL,
  revenue    numeric NOT NULL
);
INSERT INTO product_sales_summary
SELECT product_id, sum(quantity), sum(quantity * unit_price)
FROM order_items GROUP BY product_id;

-- maintain it set-based, once per statement, from the transition table
CREATE FUNCTION apply_item_inserts() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO product_sales_summary AS s (product_id, units, revenue)
  SELECT product_id, sum(quantity), sum(quantity * unit_price)
  FROM new_items GROUP BY product_id
  ON CONFLICT (product_id) DO UPDATE
    SET units = s.units + EXCLUDED.units,
        revenue = s.revenue + EXCLUDED.revenue;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_items_summary
AFTER INSERT ON order_items
REFERENCING NEW TABLE AS new_items
FOR EACH STATEMENT EXECUTE FUNCTION apply_item_inserts();

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
VALUES (10, 7, 3, 60912.97), (11, 7, 2, 60912.97), (12, 8, 1, 68905.19);

-- summary vs full recomputation: must match
SELECT s.product_id, s.units, s.revenue,
       (SELECT sum(quantity) FROM order_items WHERE product_id = s.product_id) AS units_check
FROM product_sales_summary s
WHERE s.product_id IN (7, 8)
ORDER BY s.product_id;`,
      explain: `<p>The summary is seeded once, then every <code>INSERT</code> into <code>order_items</code> fires one statement-level trigger that aggregates the new rows and upserts deltas. Reads are instant and always current; the cost is a small extra write per insert statement. The check column proves no drift. A complete implementation would also handle <code>UPDATE</code> and <code>DELETE</code> (with negative deltas) and run a periodic reconciliation job.</p>`,
      output: ` product_id | units | revenue     | units_check
------------+-------+-------------+-------------
 7          | 129   | 7857773.13  | 129
 8          | 517   | 35623983.23 | 517
(2 rows)`, run: true },
    { label: 'Advanced', title: 'Refresh only when dirty, and refresh dependent MVs in order',
      sql: `CREATE TABLE mv_dirty (mv_name text PRIMARY KEY, dirty boolean NOT NULL DEFAULT true);

CREATE MATERIALIZED VIEW mv_order_facts AS
SELECT o.id, o.customer_id, o.status, o.order_date::date AS day, o.total_amount
FROM orders o WHERE o.status <> 'cancelled';
CREATE UNIQUE INDEX ON mv_order_facts (id);

CREATE MATERIALIZED VIEW mv_daily_kpis AS          -- depends on mv_order_facts
SELECT day, count(*) AS orders, sum(total_amount) AS revenue
FROM mv_order_facts GROUP BY day;
CREATE UNIQUE INDEX ON mv_daily_kpis (day);

INSERT INTO mv_dirty VALUES ('mv_order_facts', false), ('mv_daily_kpis', false);

-- writers just flag the data as dirty (cheap, statement level)
CREATE FUNCTION mark_orders_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE mv_dirty SET dirty = true WHERE NOT dirty;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_orders_dirty AFTER INSERT OR UPDATE OR DELETE ON orders
FOR EACH STATEMENT EXECUTE FUNCTION mark_orders_dirty();

-- the scheduled job refreshes bottom-up, only if needed
CREATE PROCEDURE refresh_if_dirty()
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['mv_order_facts', 'mv_daily_kpis'] LOOP   -- dependency order
    IF (SELECT dirty FROM mv_dirty WHERE mv_name = v) THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW %I', v);
      UPDATE mv_dirty SET dirty = false WHERE mv_name = v;
      RAISE NOTICE 'refreshed %', v;
    END IF;
  END LOOP;
END $$;

CALL refresh_if_dirty();                       -- nothing to do
UPDATE orders SET status = 'delivered' WHERE id = 2;
CALL refresh_if_dirty();                       -- refreshes both, in order

SELECT * FROM mv_dirty ORDER BY mv_name;`,
      explain: `<p>Writers pay only for a tiny statement-level flag update. The scheduled procedure skips refreshes when nothing changed (the first <code>CALL</code> prints nothing) and, when data is dirty, refreshes the base MV <em>before</em> the MV that depends on it — refreshing <code>mv_daily_kpis</code> first would recompute from stale facts. In production the procedure would use <code>CONCURRENTLY</code> (the unique indexes are already in place) and be triggered by <code>pg_cron</code>.</p>`,
      output: `NOTICE:  refreshed mv_order_facts
NOTICE:  refreshed mv_daily_kpis
 mv_name        | dirty
----------------+-------
 mv_daily_kpis  | f
 mv_order_facts | f
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Row-level trigger refreshing the whole MV on every insert
CREATE MATERIALIZED VIEW mv_bad AS SELECT status, count(*) FROM orders GROUP BY status;
CREATE FUNCTION refresh_bad() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN REFRESH MATERIALIZED VIEW mv_bad; RETURN NULL; END $$;
CREATE TRIGGER trg_refresh_bad AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION refresh_bad();
INSERT INTO orders (customer_id, status, order_date)
SELECT 1, 'pending', now() FROM generate_series(1, 20);`,
      why: 'Each inserted row recomputes the full aggregation and takes an ACCESS EXCLUSIVE lock — 20 full refreshes for 20 rows, and every writer serialises on the MV lock.', run: true },
    good: { sql: `CREATE TABLE status_counter (status text PRIMARY KEY, n bigint NOT NULL);
INSERT INTO status_counter SELECT status, count(*) FROM orders GROUP BY status;
CREATE FUNCTION count_new() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO status_counter AS c SELECT status, count(*) FROM new_orders GROUP BY status
  ON CONFLICT (status) DO UPDATE SET n = c.n + EXCLUDED.n;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_count_new AFTER INSERT ON orders REFERENCING NEW TABLE AS new_orders
FOR EACH STATEMENT EXECUTE FUNCTION count_new();
INSERT INTO orders (customer_id, status, order_date)
SELECT 1, 'pending', now() FROM generate_series(1, 20);
SELECT * FROM status_counter WHERE status = 'pending';`,
      why: 'Incremental deltas applied once per statement keep the counter exact at a cost proportional to the change, not the table.', run: true }
  },
  mistakes: [
    `Refreshing an MV from a row-level trigger — turns every write into a full recomputation and serialises writers.`,
    `Refreshing dependent MVs in the wrong order, producing results built on stale inputs.`,
    `Scheduling refreshes without monitoring duration; as data grows, refreshes overlap and pile up.`,
    `Incremental summaries without a reconciliation job; a missed code path or bug makes them drift forever.`,
    `Single hot counter rows updated by thousands of concurrent transactions, causing lock waits and bloat.`
  ],
  best: [
    `Start with a view; move to an MV only when measured performance requires it; move to summary tables only when freshness requires it.`,
    `Record refresh time and duration; alert when data is older than its SLA.`,
    `Use dirty flags or event-based refreshes to avoid pointless work.`,
    `Maintain summaries set-based (transition tables, batch upserts) and reconcile periodically.`,
    `Document freshness guarantees next to each precomputed object (<code>COMMENT ON MATERIALIZED VIEW</code>).`
  ],
  performance: `<p>For an MV, total cost ≈ refresh cost × refresh frequency, independent of read traffic; for a view, cost ≈ query cost × read frequency; for a summary table, cost ≈ per-change overhead × write rate. Example: a 3-second aggregation read 600 times per minute costs 30 CPU-minutes per minute as a view (impossible), 3 seconds per 5 minutes as an MV, or a few milliseconds per write batch as a summary table. Concurrent refreshes and summary upserts create dead tuples — tune autovacuum (<code>autovacuum_vacuum_scale_factor</code> per table) for these small, hot relations.</p>`,
  security: `<p>Refresh jobs typically run as the MV owner; grant readers only <code>SELECT</code> on the MV or summary table. Procedures that build <code>REFRESH</code> commands dynamically must quote names with <code>format('%I')</code> and should only accept names from an allow-list table, never arbitrary user input.</p>`,
  scenario: { title: 'The 5-minute KPI MV now takes 7 minutes to refresh', steps: [
    '1. Check mv_refresh_log: duration has grown linearly with the orders table.',
    '2. Overlapping refreshes queue on the MV lock; freshness is effectively 14+ minutes.',
    '3. Split the MV: freeze closed months into a static summary table; keep the MV only for the current month.',
    '4. Or replace it with an incremental summary maintained from an outbox in batch upserts.',
    '5. Add a reconciliation job comparing summary totals with a full recomputation nightly.',
    '6. Alert when refreshed_at is older than 2× the SLA.'
  ] },
  interview: [
    { q: 'How do you choose between a view, a materialized view and a summary table?', a: 'Views when the query is cheap enough to run on every read or must be exact. Materialized views when the query is expensive, reads are frequent and some staleness is acceptable. Summary tables when you need near real-time aggregates on large data with a small change rate, accepting write overhead and maintenance complexity.' },
    { q: 'How would you implement near real-time aggregates without refreshing an MV constantly?', a: 'Maintain a summary table incrementally: statement-level triggers with transition tables or batch jobs reading an outbox apply deltas with INSERT ... ON CONFLICT DO UPDATE, plus a periodic reconciliation that recomputes and corrects drift.' },
    { q: 'What problems arise with frequent concurrent refreshes?', a: 'Each refresh still runs the full query and then a diff, generating dead tuples and WAL for changed rows; refreshes cannot overlap so they queue if the interval is shorter than the duration; and the MV needs aggressive vacuuming.' }
  ],
  exercises: [
    { task: 'Create a summary table customer_order_counts(customer_id PK, orders) seeded from orders, and a statement-level AFTER INSERT trigger with a transition table that increments it. Insert two orders for customer 3 and show its count before and after.', solution: `CREATE TABLE customer_order_counts (customer_id int PRIMARY KEY, orders bigint NOT NULL);
INSERT INTO customer_order_counts SELECT customer_id, count(*) FROM orders GROUP BY customer_id;
CREATE FUNCTION inc_customer_orders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO customer_order_counts AS c
  SELECT customer_id, count(*) FROM new_rows GROUP BY customer_id
  ON CONFLICT (customer_id) DO UPDATE SET orders = c.orders + EXCLUDED.orders;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_inc_customer_orders AFTER INSERT ON orders
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION inc_customer_orders();

SELECT orders AS before FROM customer_order_counts WHERE customer_id = 3;
INSERT INTO orders (customer_id, status, order_date) VALUES (3, 'pending', now()), (3, 'paid', now());
SELECT orders AS after FROM customer_order_counts WHERE customer_id = 3;`, run: true },
    { task: 'Write a reconciliation query that lists any product whose product_sales_summary-style aggregate differs from a fresh recomputation (create the summary from order_items first, then corrupt one row and detect it).', solution: `CREATE TABLE pss AS
SELECT product_id, sum(quantity) AS units FROM order_items GROUP BY product_id;
UPDATE pss SET units = units + 1 WHERE product_id = 5;   -- simulate drift

SELECT coalesce(s.product_id, f.product_id) AS product_id, s.units AS summary, f.units AS actual
FROM pss s
FULL JOIN (SELECT product_id, sum(quantity) AS units FROM order_items GROUP BY product_id) f
  USING (product_id)
WHERE s.units IS DISTINCT FROM f.units;`, run: true }
  ],
  challenge: { task: 'Create an MV of monthly revenue and a log table; write a procedure that refreshes the MV CONCURRENTLY only if its last refresh is older than a given interval, logging the time. Call it twice in a row with interval 1 hour and show only one refresh happened.', hint: 'Compare now() - refreshed_at with the interval; use EXECUTE format for the refresh; REFRESH CONCURRENTLY needs a unique index on month.', solution: `CREATE MATERIALIZED VIEW mv_month_rev AS
SELECT date_trunc('month', order_date)::date AS month, sum(total_amount) AS revenue
FROM orders WHERE status <> 'cancelled' GROUP BY 1;
CREATE UNIQUE INDEX ON mv_month_rev (month);
CREATE TABLE refresh_log (mv text PRIMARY KEY, refreshed_at timestamptz, refreshes int DEFAULT 0);

CREATE PROCEDURE refresh_if_older(p_mv text, p_max_age interval) LANGUAGE plpgsql AS $$
DECLARE v_last timestamptz;
BEGIN
  SELECT refreshed_at INTO v_last FROM refresh_log WHERE mv = p_mv;
  IF v_last IS NULL OR clock_timestamp() - v_last > p_max_age THEN
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', p_mv);
    INSERT INTO refresh_log VALUES (p_mv, clock_timestamp(), 1)
    ON CONFLICT (mv) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at,
                                   refreshes = refresh_log.refreshes + 1;
  END IF;
END $$;

CALL refresh_if_older('mv_month_rev', interval '1 hour');
CALL refresh_if_older('mv_month_rev', interval '1 hour');
SELECT mv, refreshes FROM refresh_log;`, run: true },
  related: ['materialized-views-basics', 'triggers-soft-delete-advanced', 'views-basics', 'procedures-create-call', 'production-optimization'],
  quiz: [
    { type: 'mcq', q: 'Read-heavy dashboard, expensive aggregate, 15-minute staleness acceptable. Best choice?', options: ['Plain view', 'Materialized view refreshed every 5–15 minutes', 'Trigger-maintained summary', 'Function'], answer: 1, explain: 'A materialized view gives cheap reads with bounded, acceptable staleness and low complexity.' },
    { type: 'tf', q: 'If mv_b is built on mv_a, refreshing mv_b first and then mv_a gives fully up-to-date data in mv_b.', answer: false, explain: 'mv_b would be computed from mv_a’s old contents. Refresh dependencies bottom-up.' },
    { type: 'design', q: 'Restaurant tablets read "orders in progress" 20k times/minute and need data within seconds. Best design?', options: ['View', 'MV refreshed hourly', 'Summary table updated incrementally with batch upserts and periodic reconciliation', 'Full-text index'], answer: 2, explain: 'Near-real-time freshness plus very high read rate calls for an incrementally maintained summary.' },
    { type: 'bug', q: 'Why does every INSERT into orders become slow and serialised?', code: `CREATE TRIGGER t AFTER INSERT ON orders FOR EACH ROW
EXECUTE FUNCTION refresh_sales_mv();  -- runs REFRESH MATERIALIZED VIEW mv_sales`, options: ['Missing unique index', 'Each row triggers a full MV recomputation under an exclusive lock', 'AFTER triggers are slow', 'MVs cannot be refreshed in functions'], answer: 1, explain: 'Refreshing from a row trigger recomputes the whole MV per inserted row and all writers queue on the MV lock.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: extensions
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'extensions-intro',
  module: 'extensions',
  title: 'PostgreSQL Extensions: CREATE EXTENSION, Versions and Trust',
  level: 3,
  minutes: 20,
  summary: 'Understand what an extension is, how to discover, install, upgrade and remove one, which extensions ship with PostgreSQL (contrib) versus third-party projects, and how to evaluate whether an extension is safe for production.',
  objectives: [
    'Explain what an extension packages (types, functions, operators, index methods) and why it exists',
    'Discover extensions with pg_available_extensions and pg_available_extension_versions',
    'Install, upgrade, relocate and drop extensions safely',
    'Distinguish core contrib modules from third-party extensions and managed-cloud support',
    'Evaluate trust: trusted extensions, superuser requirements and supply-chain risk'
  ],
  concept: `<p>An <strong>extension</strong> is a package of SQL objects — data types, functions, operators, index access methods, sometimes background workers — installed into a database as one unit with <code>CREATE EXTENSION</code>. Analogy: <em>apps on a smartphone</em>. The phone (PostgreSQL) is useful on its own, but you add apps for maps or banking. Apps are installed and removed as a unit, have versions you can upgrade, and some come from the phone maker (contrib) while others come from third parties you must decide to trust.</p>
<h4>Two layers</h4>
<ol>
<li><strong>Files on the server</strong>: a control file (<code>name.control</code>), SQL scripts per version (<code>name--1.5--1.6.sql</code>) and usually a shared library (<code>.so</code>). These come from your OS package or a build. Without them, <code>CREATE EXTENSION</code> fails.</li>
<li><strong>Installation in a database</strong>: <code>CREATE EXTENSION name</code> runs the script, creating objects that are recorded as members of the extension (<code>pg_extension</code>, <code>pg_depend</code>). It is per database — installing in <code>company_db</code> does not install in <code>postgres</code>.</li>
</ol>
<h4>Common extensions — know which is which</h4>
<table>
<tr><th>Extension</th><th>Origin</th><th>What it adds</th></tr>
<tr><td><code>pg_stat_statements</code></td><td><span class="tag ext">extension</span> contrib (ships with PostgreSQL)</td><td>Per-query execution statistics; needs <code>shared_preload_libraries</code></td></tr>
<tr><td><code>pgcrypto</code></td><td>contrib</td><td>Hashing, password hashing (<code>crypt</code>), symmetric/PGP encryption</td></tr>
<tr><td><code>uuid-ossp</code></td><td>contrib</td><td>UUID generators v1/v3/v4/v5 (v4 is core since PG13 via <code>gen_random_uuid()</code>)</td></tr>
<tr><td><code>citext</code></td><td>contrib</td><td>Case-insensitive text type</td></tr>
<tr><td><code>pg_trgm</code></td><td>contrib</td><td>Trigram similarity, fuzzy search, index support for <code>LIKE '%x%'</code></td></tr>
<tr><td><code>btree_gin</code>, <code>btree_gist</code></td><td>contrib</td><td>B-tree-like operator classes for GIN/GiST (mixed indexes, exclusion constraints)</td></tr>
<tr><td><code>PostGIS</code></td><td><span class="tag ext">extension</span> third-party (OSGeo)</td><td>Geospatial types, functions and indexes</td></tr>
<tr><td><code>pgvector</code> (<code>vector</code>)</td><td>third-party</td><td>Vector type and HNSW/IVFFlat indexes for embeddings</td></tr>
<tr><td><code>TimescaleDB</code></td><td>third-party (Timescale; parts under a source-available licence)</td><td>Hypertables, compression, continuous aggregates for time series</td></tr>
<tr><td><code>Citus</code></td><td>third-party (Microsoft, open source)</td><td>Distributed PostgreSQL: sharded tables across nodes — not the same as native partitioning</td></tr>
</table>
<div class="callout info">"contrib" modules are maintained by the PostgreSQL project and released with each version, but they are still <em>extensions</em>: not installed by default, enabled per database with <code>CREATE EXTENSION</code>.</div>`,
  why: `<p>Extensions keep the core small and stable while letting the ecosystem add major capabilities — geospatial, vector search, time series, sharding — without forking PostgreSQL. They also make upgrades manageable: an extension's objects are tracked as a unit, dumped as a single <code>CREATE EXTENSION</code> line by <code>pg_dump</code>, and upgraded with <code>ALTER EXTENSION ... UPDATE</code>.</p>`,
  useCase: `<p>A logistics SaaS on a managed PostgreSQL service uses five extensions: <code>pg_stat_statements</code> for performance monitoring, <code>pgcrypto</code> for hashing API keys, <code>pg_trgm</code> for fuzzy address search, PostGIS for delivery zones and <code>pgvector</code> for semantic search over support tickets. Their platform runbook pins extension versions in migrations (<code>CREATE EXTENSION ... VERSION '0.8.0'</code>), checks the cloud provider's supported-extension list before every major upgrade, and runs <code>ALTER EXTENSION ... UPDATE</code> as an explicit migration step after binary upgrades.</p>`,
  internals: `<p><code>pg_available_extensions</code> reads the control files in the server's <code>SHAREDIR/extension</code> directory; <code>pg_extension</code> lists what is installed in the current database. Each member object has a <code>pg_depend</code> row with <code>deptype = 'e'</code>, so you cannot drop a member individually and <code>pg_dump</code> emits just <code>CREATE EXTENSION</code>. Extensions with C code load their shared library on first use; those that need shared memory or hooks at startup (<code>pg_stat_statements</code>, <code>auto_explain</code>, TimescaleDB, Citus) must be listed in <code>shared_preload_libraries</code>, which requires a restart. Since PG13, a control file can mark an extension <code>trusted</code>, allowing non-superusers with <code>CREATE</code> privilege on the database to install it.</p>`,
  whenNot: `<p>Do not install extensions "just in case": each adds objects, upgrade steps and potential security surface. Check that your hosting provider supports an extension before designing around it (managed services allow only a curated list). Avoid unmaintained third-party extensions for core data paths — if a major PostgreSQL upgrade arrives and the extension is not ported, you are stuck on the old version.</p>`,
  syntax: `SELECT * FROM pg_available_extensions;                 -- what can be installed
SELECT * FROM pg_available_extension_versions;
SELECT * FROM pg_extension;                            -- what is installed here

CREATE EXTENSION [ IF NOT EXISTS ] name [ WITH ] [ SCHEMA schema ] [ VERSION 'v' ] [ CASCADE ];
ALTER EXTENSION name UPDATE [ TO 'v' ];
ALTER EXTENSION name SET SCHEMA new_schema;            -- if relocatable
DROP EXTENSION [ IF EXISTS ] name [ CASCADE ];`,
  examples: [
    { label: 'Basic', title: 'Discover what is available and what is installed',
      sql: `SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name IN ('pg_trgm', 'pgcrypto', 'citext', 'uuid-ossp', 'btree_gin', 'btree_gist', 'hstore', 'plpgsql')
ORDER BY name;`,
      explain: `<p><code>pg_available_extensions</code> lists extensions whose files exist on the server. <code>installed_version</code> is NULL for those not yet installed in <em>this</em> database; <code>plpgsql</code> is installed by default in every database. On a self-managed server the full list includes every contrib module (around 50); on managed clouds it reflects the provider's allow-list. In this in-browser sandbox only a subset is bundled.</p>`,
      output: ` name       | default_version | installed_version
------------+-----------------+-------------------
 btree_gin  | 1.3             |
 btree_gist | 1.8             |
 citext     | 1.8             |
 hstore     | 1.8             |
 pg_trgm    | 1.6             |
 pgcrypto   | 1.4             |
 plpgsql    | 1.0             | 1.0
 uuid-ossp  | 1.1             |
(8 rows)`, run: true },
    { label: 'Intermediate', title: 'Install an extension and inspect what it created',
      sql: `CREATE EXTENSION IF NOT EXISTS citext;

SELECT extname, extversion, extnamespace::regnamespace AS schema, extrelocatable
FROM pg_extension
WHERE extname = 'citext';

-- objects that belong to the extension (what \\dx+ citext shows in psql)
SELECT pg_describe_object(classid, objid, 0) AS member
FROM pg_depend
WHERE refobjid = (SELECT oid FROM pg_extension WHERE extname = 'citext')
  AND deptype = 'e'
ORDER BY member
LIMIT 8;`,
      explain: `<p><code>IF NOT EXISTS</code> makes migrations idempotent. <code>pg_extension</code> records the installed version and schema. Every object the install script created is tied to the extension via a <code>pg_depend</code> row with <code>deptype = 'e'</code>; <code>pg_describe_object</code> turns those catalog references into readable names — the first eight alphabetically are casts to and from other text types; further down come the type <code>citext</code> itself, its I/O functions, operators, operator classes and more. These cannot be dropped individually, only via <code>DROP EXTENSION</code>.</p>`,
      output: ` member
---------------------------------------
 cast from boolean to citext
 cast from character to citext
 cast from character varying to citext
 cast from citext to character
 cast from citext to character varying
 cast from citext to text
 cast from inet to citext
 cast from text to citext
(8 rows)`, run: true },
    { label: 'Advanced', title: 'Versions, trust and a dedicated schema',
      sql: `-- which versions could we upgrade to, and who may install them?
SELECT name, version, trusted, superuser, relocatable
FROM pg_available_extension_versions
WHERE name IN ('pg_trgm', 'pgcrypto')
ORDER BY name, version;

-- keep extension objects out of the application schema
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- upgrade in place to the newest packaged version (no-op if already current)
ALTER EXTENSION pg_trgm UPDATE;

SELECT extname, extversion, extnamespace::regnamespace AS schema
FROM pg_extension WHERE extname = 'pg_trgm';`,
      explain: `<p><code>pg_available_extension_versions</code> shows every version script shipped; <code>trusted = true</code> means a non-superuser with <code>CREATE</code> on the database can install it (PG13+), <code>superuser = true</code> means installation normally requires superuser unless trusted. Installing into a dedicated <code>extensions</code> schema keeps <code>public</code> clean and makes privileges easier to manage — remember to add it to <code>search_path</code> or schema-qualify calls (<code>extensions.similarity(...)</code>). <code>ALTER EXTENSION ... UPDATE</code> runs the upgrade scripts after you install new binaries.</p>`,
      output: `NOTICE:  version "1.6" of extension "pg_trgm" is already installed
 extname | extversion | schema
---------+------------+------------
 pg_trgm | 1.6        | extensions
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Fails on a fresh database (or a new environment) if already installed / not idempotent
CREATE EXTENSION pg_trgm;
CREATE EXTENSION pg_trgm;   -- ERROR: extension "pg_trgm" already exists`,
      why: 'Non-idempotent migrations break when re-run; also no version pinning, so environments may silently differ.', run: false },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- NOTICE only
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';`,
      why: 'IF NOT EXISTS makes the migration repeatable; recording the version lets you verify all environments match.', run: true }
  },
  mistakes: [
    `Assuming an extension installed in one database is available in another — extensions are per database.`,
    `Calling contrib modules "core features": <code>pg_trgm</code> or <code>pgcrypto</code> functions do not exist until <code>CREATE EXTENSION</code>.`,
    `Forgetting <code>shared_preload_libraries</code> (and a restart) for extensions like <code>pg_stat_statements</code>.`,
    `Upgrading PostgreSQL binaries but never running <code>ALTER EXTENSION ... UPDATE</code>, leaving old SQL definitions in place.`,
    `Designing around an extension your managed cloud provider does not support.`,
    `Running <code>DROP EXTENSION ... CASCADE</code> casually — it drops every column, index and view that uses the extension's types or functions.`
  ],
  best: [
    `Install extensions in migrations with <code>CREATE EXTENSION IF NOT EXISTS</code>, optionally pinning <code>VERSION</code>.`,
    `Consider a dedicated <code>extensions</code> schema for third-party objects.`,
    `Track extension versions per environment (<code>SELECT extname, extversion FROM pg_extension</code>) in health checks.`,
    `Prefer well-maintained extensions with broad cloud support for critical paths.`,
    `Review release notes for extension upgrades as carefully as for PostgreSQL itself.`
  ],
  performance: `<p>Extensions run inside the server process: well-written C extensions (pg_trgm, PostGIS, pgvector) are as fast as built-ins, but a buggy one can crash a backend (taking down all connections) or leak memory. Preloaded extensions such as <code>pg_stat_statements</code> add small constant overhead to every query (typically a few percent at most). Extension-provided index types (GIN trigram, HNSW) can be expensive to build — plan <code>maintenance_work_mem</code> accordingly.</p>`,
  security: `<p>C extensions execute arbitrary native code with the server's OS privileges, which is why installing untrusted extensions requires superuser. Only install extensions from trusted sources (PGDG packages, vendor repositories), keep them patched, and restrict who has <code>CREATE</code> on databases if trusted extensions are present. Extension scripts are run with <code>search_path</code> set to the target schema — install into schemas that untrusted users cannot write to.</p>`,
  scenario: { title: "Major version upgrade blocked by an extension", steps: [
    "1. Planning an upgrade from PostgreSQL 15 to 18 with pg_upgrade.",
    "2. List extensions and versions: SELECT extname, extversion FROM pg_extension; in every database.",
    "3. Check the target version and cloud provider support each extension (especially third-party ones).",
    "4. Install the new extension packages for the target version on the new server.",
    "5. After pg_upgrade, run ALTER EXTENSION ... UPDATE in each database.",
    "6. Re-run application tests that exercise extension functions and indexes."
  ] },
  interview: [
    { q: 'What is the difference between a contrib module and a third-party extension?', a: 'Contrib modules (pg_trgm, pgcrypto, citext, pg_stat_statements...) are maintained and shipped by the PostgreSQL project with each release, but they are still optional extensions installed per database. Third-party extensions (PostGIS, pgvector, TimescaleDB, Citus) are maintained by other organisations and must be installed from their packages; managed clouds support only selected ones.' },
    { q: 'Why does pg_stat_statements need shared_preload_libraries?', a: 'It allocates shared memory and installs executor hooks at server start so it can collect statistics from all backends. That can only happen at startup, so the library must be preloaded and the server restarted; CREATE EXTENSION then exposes the view and functions.' },
    { q: 'What does a trusted extension mean?', a: 'Since PG13, an extension’s control file can mark it trusted, allowing non-superusers who have CREATE privilege on the database to install it; its objects are then owned by the bootstrap superuser. Untrusted extensions require superuser to install because they can execute arbitrary C code.' }
  ],
  exercises: [
    { task: 'Install pgcrypto and hstore if missing, then list every installed extension with its version and schema.', solution: `CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS hstore;
SELECT extname, extversion, extnamespace::regnamespace AS schema
FROM pg_extension ORDER BY extname;`, run: true },
    { task: 'Count how many objects (by object type, e.g. function, type, operator) pg_trgm adds to the database.', solution: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT split_part(pg_describe_object(classid, objid, 0), ' ', 1) AS kind, count(*)
FROM pg_depend
WHERE refobjid = (SELECT oid FROM pg_extension WHERE extname = 'pg_trgm') AND deptype = 'e'
GROUP BY 1 ORDER BY 2 DESC;`, run: true }
  ],
  challenge: { task: 'Install citext into a dedicated schema named ext, create a table app_users(email ext.citext UNIQUE) and show that the column type resolves to ext.citext. Then move the extension to schema public with ALTER EXTENSION ... SET SCHEMA and show the column type again.', hint: 'format_type(atttypid, atttypmod) or pg_typeof; citext is relocatable.', solution: `CREATE SCHEMA ext;
CREATE EXTENSION citext WITH SCHEMA ext;
CREATE TABLE app_users (email ext.citext UNIQUE);
SELECT atttypid::regtype AS before_move FROM pg_attribute
WHERE attrelid = 'app_users'::regclass AND attname = 'email';
ALTER EXTENSION citext SET SCHEMA public;
SELECT atttypid::regtype AS after_move FROM pg_attribute
WHERE attrelid = 'app_users'::regclass AND attname = 'email';`, run: true },
  related: ['extensions-crypto-uuid-citext', 'extensions-pg-trgm', 'pgvector', 'monitoring'],
  quiz: [
    { type: 'mcq', q: 'Which of these is NOT shipped with PostgreSQL as a contrib module?', options: ['pg_trgm', 'pgcrypto', 'pgvector', 'citext'], answer: 2, explain: 'pgvector is a third-party extension; the others are contrib modules.' },
    { type: 'tf', q: 'Running CREATE EXTENSION pg_trgm in database A makes similarity() available in database B on the same server.', answer: false, explain: 'Extensions are installed per database.' },
    { type: 'mcq', q: 'Which view shows extensions installed in the current database?', options: ['pg_available_extensions', 'pg_extension', 'pg_settings', 'pg_language'], answer: 1, explain: 'pg_extension lists installed extensions; pg_available_extensions lists what could be installed.' },
    { type: 'scenario', q: 'After upgrading the pg_trgm package on the server, extversion still shows the old version. Why?', options: ['Restart needed', 'You must run ALTER EXTENSION pg_trgm UPDATE in each database', 'pg_trgm cannot be upgraded', 'VACUUM needed'], answer: 1, explain: 'New files only provide the upgrade scripts; ALTER EXTENSION ... UPDATE applies them per database.' }
  ]
},
{
  id: 'extensions-crypto-uuid-citext',
  module: 'extensions',
  title: 'Practical Extensions: pgcrypto, UUIDs and citext',
  level: 3,
  minutes: 22,
  summary: 'Generate UUIDs (core gen_random_uuid(), PG18 uuidv7(), uuid-ossp), hash passwords properly with pgcrypto crypt()/gen_salt(), compute digests and HMACs, and build case-insensitive unique emails with citext.',
  objectives: [
    'Generate UUIDs with core gen_random_uuid() and uuidv7() (PG18), and know when uuid-ossp is still needed',
    'Hash and verify passwords with crypt() and gen_salt(\'bf\')',
    'Use digest(), hmac() and symmetric encryption functions appropriately',
    'Store case-insensitive identifiers with citext and compare with lower() + unique index',
    'Avoid common cryptography mistakes in the database'
  ],
  concept: `<p>Three small, practical tools that appear in almost every application schema.</p>
<h4>UUIDs</h4>
<ul>
<li><code>gen_random_uuid()</code> <span class="tag core">core</span> since PostgreSQL 13 — random version-4 UUID. Before PG13 it lived in pgcrypto.</li>
<li><code>uuidv7()</code> <span class="tag core">core</span> since <strong>PostgreSQL 18</strong> — time-ordered UUID (48-bit Unix millisecond timestamp prefix + randomness). New values are roughly increasing, so B-tree inserts go to the right edge of the index like a sequence, instead of random pages. PG18 also adds <code>uuidv4()</code> as an alias and <code>uuid_extract_timestamp()</code>.</li>
<li><code>uuid-ossp</code> <span class="tag ext">extension</span> — <code>uuid_generate_v1()</code> (MAC + time), <code>v3</code>/<code>v5</code> (name-based, deterministic from a namespace + name), <code>v4</code>. Only needed today for v1/v3/v5.</li>
</ul>
<h4>pgcrypto <span class="tag ext">extension</span></h4>
<ul>
<li><code>crypt(password, gen_salt('bf', cost))</code> — adaptive password hashing (bcrypt). The output contains algorithm, cost and salt, so verifying is <code>stored_hash = crypt(input, stored_hash)</code>. Cost 10–12 is typical; each +1 doubles the work.</li>
<li><code>digest(data, 'sha256')</code> — plain hash (checksums, fingerprints — <em>not</em> passwords). <code>hmac(data, key, 'sha256')</code> — keyed hash for signing tokens/webhooks.</li>
<li><code>pgp_sym_encrypt(data, key)</code>/<code>pgp_sym_decrypt</code> — symmetric encryption of a column.</li>
</ul>
<h4>citext <span class="tag ext">extension</span></h4>
<p>A <code>text</code>-like type whose comparisons are case-insensitive (it lower-cases both sides before comparing). <code>UNIQUE</code> on a <code>citext</code> column means "Asha@X.com" and "asha@x.com" cannot both exist. Analogy: a <em>hotel guest list where names are compared ignoring capitalisation</em> — "RAO" at the front desk finds "Rao" in the list.</p>`,
  why: `<p>Identifiers need to be globally unique without a central sequence (UUIDs across microservices and offline clients). Passwords must never be stored in plain text or with fast hashes such as MD5/SHA-256, which GPUs crack by the billions per second. And users type emails in any capitalisation — without case-insensitive uniqueness you get duplicate accounts and failed logins.</p>`,
  useCase: `<p>A ride-hailing platform migrated its trips table (1.2 billion rows) from random v4 UUID primary keys to time-ordered keys: index size dropped ~30% and insert throughput improved noticeably because new keys hit the same few "hot" right-most B-tree pages, keeping them in shared buffers. Their driver portal hashes passwords with bcrypt cost 12 (either in the app or via pgcrypto), and emails are <code>citext UNIQUE</code>, which removed ~4 000 duplicate accounts that had been created by differently-capitalised sign-ups.</p>`,
  internals: `<p>A <code>uuid</code> is stored as 16 bytes (vs 36+ bytes as text). Random v4 values spread inserts uniformly across the B-tree, so every insert touches a random leaf page — with tables larger than RAM that means random I/O and more full-page writes in WAL. UUIDv7's timestamp prefix makes inserts mostly sequential. <code>crypt()</code> with <code>bf</code> runs 2^cost Blowfish key-setup rounds — cost 8 ≈ a few ms, cost 12 ≈ ~200 ms of CPU per call — deliberately slow. <code>citext</code> comparison calls <code>lower()</code> on both values under the database collation for every comparison; its B-tree indexes therefore sort by lower-cased value.</p>`,
  whenNot: `<p>Hashing passwords inside SQL means the plaintext password travels to the database and may appear in logs (<code>log_statement = 'all'</code>, <code>pg_stat_statements</code> normalises constants but auto_explain and error logs may not) — many teams hash in the application (argon2/bcrypt libraries) and store only the hash. Prefer <code>bigint</code> identity keys for internal tables that never leave the database; they are smaller and faster than UUIDs. Instead of <code>citext</code>, a nondeterministic ICU collation (PG12+) or a unique index on <code>lower(email)</code> also works and avoids an extension dependency.</p>`,
  syntax: `SELECT gen_random_uuid();                    -- core, PG13+
SELECT uuidv7();                             -- core, PG18+
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SELECT uuid_generate_v5(uuid_ns_url(), 'https://example.com/a');

CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT crypt('password', gen_salt('bf', 12));             -- hash
SELECT stored_hash = crypt('attempt', stored_hash);       -- verify
SELECT encode(digest('data', 'sha256'), 'hex');
SELECT encode(hmac('payload', 'secret', 'sha256'), 'hex');

CREATE EXTENSION IF NOT EXISTS citext;
CREATE TABLE t (email citext UNIQUE);`,
  examples: [
    { label: 'Basic', title: 'UUID generation: core v4, PG18 v7 and name-based v5',
      sql: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

SELECT gen_random_uuid()                      AS v4_core,
       uuidv7()                               AS v7_pg18,
       uuid_generate_v5(uuid_ns_url(), 'https://shop.example.com/products/SKU-0001') AS v5_deterministic;

-- v7 values sort by creation time; v5 is the same for the same input
SELECT uuid_extract_version(uuidv7())                                   AS v7_version,
       uuid_extract_timestamp(uuidv7())::date = current_date            AS v7_has_today,
       uuid_generate_v5(uuid_ns_url(), 'a') = uuid_generate_v5(uuid_ns_url(), 'a') AS v5_repeatable;`,
      explain: `<p><code>gen_random_uuid()</code> is core (no extension) and returns a random v4 UUID. <code>uuidv7()</code> is core in PostgreSQL 18 and embeds the current timestamp, which <code>uuid_extract_timestamp()</code> can read back. <code>uuid_generate_v5</code> from <span class="tag ext">uuid-ossp</span> derives a UUID deterministically from a namespace and a name — handy for idempotent imports where the same source record must always map to the same id. (The first query's UUIDs differ on every run; the output shows the second query.)</p>`,
      output: ` v7_version | v7_has_today | v5_repeatable
------------+--------------+---------------
 7          | t            | t
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Password hashing and verification with pgcrypto',
      sql: `CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_accounts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL
);

INSERT INTO app_accounts (username, password_hash)
VALUES ('asha',  crypt('Correct-Horse-42', gen_salt('bf', 8))),
       ('rohan', crypt('Correct-Horse-42', gen_salt('bf', 8)));   -- same password

SELECT username,
       left(password_hash, 7)                                   AS algo_and_cost,
       length(password_hash)                                    AS hash_len,
       password_hash = crypt('Correct-Horse-42', password_hash) AS right_pw_ok,
       password_hash = crypt('correct-horse-42', password_hash) AS wrong_pw_ok,
       -- different salts: identical passwords produce different hashes
       (SELECT count(DISTINCT password_hash) FROM app_accounts) AS distinct_hashes
FROM app_accounts
ORDER BY username;`,
      explain: `<p><code>gen_salt('bf', 8)</code> creates a random bcrypt salt with cost 8 (use 10–12 in production; 8 keeps the demo fast). The stored hash begins with <code>$2a$08$</code> — algorithm and cost — followed by salt and hash, 60 characters total. Verification re-hashes the attempt using the stored hash as the salt source and compares. Because each password gets its own random salt, two users with the same password have different hashes, defeating precomputed rainbow tables.</p>`,
      output: ` username | algo_and_cost | hash_len | right_pw_ok | wrong_pw_ok | distinct_hashes
----------+---------------+----------+-------------+-------------+-----------------
 asha     | $2a$08$       | 60       | t           | f           | 2
 rohan    | $2a$08$       | 60       | t           | f           | 2
(2 rows)`, run: true },
    { label: 'Advanced', title: 'citext uniqueness, digests and HMAC-signed tokens',
      sql: `CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE newsletter (
  email      citext PRIMARY KEY,
  token_hash text   NOT NULL
);

INSERT INTO newsletter
VALUES ('Asha.Rao@Example.com', encode(digest('tok-123', 'sha256'), 'hex'));

DO $$ BEGIN
  INSERT INTO newsletter VALUES ('asha.rao@example.COM', 'x');   -- same email, other case
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'duplicate rejected: %', SQLERRM;
END $$;

SELECT email,
       email = 'ASHA.RAO@EXAMPLE.COM'                             AS ci_match,
       token_hash = encode(digest('tok-123', 'sha256'), 'hex')    AS token_ok,
       left(encode(hmac('user=1;exp=2026-12-31', 'server-secret', 'sha256'), 'hex'), 16) AS signature_prefix
FROM newsletter;`,
      explain: `<p>The <code>citext</code> primary key rejects the differently-capitalised duplicate, and equality with an upper-case literal matches. Unsubscribe tokens are stored only as SHA-256 digests (a leaked table does not reveal usable tokens; tokens are long and random, so a fast hash is fine here — unlike passwords). <code>hmac()</code> signs a payload with a server secret; recomputing and comparing the signature detects tampering. In real systems keep the secret outside SQL text (application config) so it never appears in logs.</p>`,
      output: `NOTICE:  duplicate rejected: duplicate key value violates unique constraint "newsletter_pkey"
 email                | ci_match | token_ok | signature_prefix
----------------------+----------+----------+------------------
 Asha.Rao@Example.com | t        | t        | 4b424532c98ee0f8
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- fast, unsalted hash: identical passwords -> identical hashes, GPU-crackable
SELECT username, encode(digest('Welcome@123', 'md5'), 'hex') AS weak_hash
FROM users WHERE id IN (1, 2);`,
      why: 'MD5/SHA without salt and work factor can be brute-forced at billions of guesses per second, and equal passwords are visible as equal hashes.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT username, crypt('Welcome@123', gen_salt('bf', 8)) AS bcrypt_hash
FROM users WHERE id IN (1, 2);`,
      why: 'bcrypt via crypt()/gen_salt(\'bf\') is salted and deliberately slow; equal passwords produce different hashes.', run: true }
  },
  mistakes: [
    `Hashing passwords with <code>md5()</code> or <code>digest(..., 'sha256')</code> — fast hashes are wrong for passwords.`,
    `Comparing <code>crypt(input, gen_salt('bf'))</code> to the stored hash — a new salt gives a different hash; pass the stored hash as the salt.`,
    `Installing <code>uuid-ossp</code> just for v4 UUIDs when <code>gen_random_uuid()</code> is core since PG13.`,
    `Storing UUIDs as <code>text</code> (36+ bytes, slower comparisons) instead of the <code>uuid</code> type (16 bytes).`,
    `Putting encryption keys or plaintext passwords in SQL statements that end up in server logs.`,
    `Using <code>lower(email) = lower($1)</code> in queries but a unique index on plain <code>email</code> — duplicates with different case slip in.`
  ],
  best: [
    `Use <code>uuidv7()</code> (PG18) or application-generated time-ordered UUIDs for UUID primary keys on large tables.`,
    `Use bcrypt/argon2 with a tuned work factor; consider hashing in the application to keep plaintext out of the database.`,
    `Store only digests of API keys and tokens; compare digests.`,
    `Use <code>citext</code> or a unique index on <code>lower(col)</code> for emails/usernames.`,
    `Keep secrets in a KMS or application config, not in SQL scripts.`
  ],
  performance: `<p><code>crypt()</code> with <code>bf</code> cost 12 costs ~0.2 s of CPU per call by design — a login storm of 500 requests/second would need ~100 CPU cores if done in the database, another reason to hash in the stateless application tier. UUID v4 primary keys on tables much larger than RAM cause random index I/O and higher WAL volume (full-page writes after checkpoints); v7 keys largely avoid that. <code>citext</code> comparisons are slower than plain <code>text</code> (extra <code>lower()</code> per comparison) — negligible for lookups, noticeable for large sorts and joins.</p>`,
  security: `<p>pgcrypto's encryption functions encrypt data at rest inside columns, but keys passed in SQL are visible to anyone who can read logs or <code>pg_stat_activity</code>. Prefer encryption in the application (or transparent disk encryption) for most needs, and TLS for data in transit. For tokens, compare digests rather than raw values, and generate randomness with <code>gen_random_bytes()</code> (pgcrypto) or <code>gen_random_uuid()</code>, never <code>random()</code>, which is not cryptographically secure.</p>`,
  scenario: { title: "Duplicate accounts and slow inserts on a UUID-keyed table", steps: [
    "1. Support finds users with two accounts: Asha@x.com and asha@x.com.",
    "2. Convert email to citext (or add a unique index on lower(email)) after merging duplicates.",
    "3. Insert latency on the 800M-row events table grows; its PK is a random v4 UUID.",
    "4. EXPLAIN/pg_stat_io show random index page reads; switch new ids to uuidv7() (PG18) or app-side v7.",
    "5. Audit password storage: replace md5 hashes with bcrypt on next login.",
    "6. Remove plaintext secrets from SQL logs (log_statement, auto_explain parameters)."
  ] },
  interview: [
    { q: 'How do you verify a password hashed with crypt()?', a: 'Compute crypt(attempt, stored_hash) and compare to stored_hash. crypt extracts the algorithm, cost and salt from the stored hash, so the same password reproduces the same hash.' },
    { q: 'Why might you prefer UUIDv7 over UUIDv4 for primary keys?', a: 'UUIDv7 starts with a millisecond timestamp, so new keys are roughly increasing; B-tree inserts concentrate at the right edge of the index, improving cache locality, reducing page splits and WAL volume. v4 keys are random, scattering inserts across the whole index.' },
    { q: 'citext vs unique index on lower(email)?', a: 'citext makes every comparison case-insensitive automatically, including equality in queries and the UNIQUE constraint, but adds an extension dependency and slower comparisons. A unique index on lower(email) works with plain text but every query must also use lower(email) to use the index and to compare correctly.' }
  ],
  exercises: [
    { task: 'Add a uuid column public_id with default uuidv7() to customers, and show the first 3 customers with their new ids sorted by public_id (order should match creation order of the defaults).', solution: `ALTER TABLE customers ADD COLUMN public_id uuid NOT NULL DEFAULT uuidv7();
SELECT id, uuid_extract_version(public_id) AS version
FROM customers ORDER BY public_id LIMIT 3;`, run: true },
    { task: 'Using pgcrypto, set password_hash for user1 to a bcrypt hash of "S3cure!pass" (cost 8) and write the login check query returning true.', solution: `CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE users SET password_hash = crypt('S3cure!pass', gen_salt('bf', 8)) WHERE username = 'user1';
SELECT password_hash = crypt('S3cure!pass', password_hash) AS login_ok
FROM users WHERE username = 'user1';`, run: true }
  ],
  challenge: { task: 'Make users.email case-insensitively unique without citext: create a unique index on lower(email), show that inserting USER1@TENANT2.COM fails, and write a lookup that uses the index.', hint: 'CREATE UNIQUE INDEX ... (lower(email)); queries must use WHERE lower(email) = lower($1).', solution: `CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
DO $$ BEGIN
  INSERT INTO users (username, email, password_hash, role, tenant_id)
  VALUES ('dup', 'USER1@TENANT2.COM', 'x', 'viewer', 2);
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'rejected: %', SQLERRM;
END $$;
SELECT id, username FROM users WHERE lower(email) = lower('User1@Tenant2.com');`, run: true },
  related: ['extensions-intro', 'extensions-pg-trgm', 'data-types', 'security', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Which UUID function is core PostgreSQL (no extension) since PG13?', options: ['uuid_generate_v4()', 'gen_random_uuid()', 'uuid_generate_v1()', 'uuid_nil()'], answer: 1, explain: 'gen_random_uuid() moved into core in PG13; the uuid_generate_* functions belong to uuid-ossp.' },
    { type: 'tf', q: 'crypt(\'pw\', gen_salt(\'bf\')) returns the same value every time for the same password.', answer: false, explain: 'gen_salt generates a random salt, so each hash differs; verification uses the stored hash as the salt.' },
    { type: 'bug', q: 'Why does login always fail?', code: `SELECT password_hash = crypt($1, gen_salt('bf', 10)) FROM users WHERE username = $2;`, options: ['bf is not supported', 'A fresh salt is used instead of the stored hash', 'Needs digest()', 'Cost too high'], answer: 1, explain: 'Pass the stored hash as the second argument: crypt($1, password_hash).' },
    { type: 'design', q: 'Large write-heavy table needs UUID primary keys generated in the database on PG18. Best choice?', options: ['gen_random_uuid()', 'uuidv7()', 'md5(random()::text)::uuid', 'uuid_generate_v1()'], answer: 1, explain: 'uuidv7() is time-ordered, giving index-friendly inserts; v1 leaks MAC addresses and is not sorted in byte order.' }
  ]
},
{
  id: 'extensions-pg-trgm',
  module: 'extensions',
  title: 'pg_trgm Deep Dive: Fuzzy Matching, Typo Tolerance and Fast LIKE',
  level: 4,
  minutes: 28,
  summary: 'Use the pg_trgm extension to measure string similarity, find names and addresses despite typos with the % operator and thresholds, rank by distance, and accelerate LIKE/ILIKE \'%x%\' with GIN or GiST trigram indexes.',
  objectives: [
    'Explain trigrams and compute similarity(), word_similarity() and strict_word_similarity()',
    'Filter with %, <% and %> and tune pg_trgm.similarity_threshold (set_limit)',
    'Rank fuzzy matches with the <-> distance operator',
    'Build GIN and GiST trigram indexes and know when each is better',
    'Accelerate LIKE / ILIKE / regex searches with leading wildcards'
  ],
  concept: `<p><code>pg_trgm</code> <span class="tag ext">extension</span> (contrib) breaks text into <strong>trigrams</strong> — every sequence of three consecutive characters, after lower-casing and padding each word with two spaces in front and one behind. "Kumar" becomes <code>"  k"</code>, <code>" ku"</code>, <code>"kum"</code>, <code>"uma"</code>, <code>"mar"</code>, <code>"ar "</code>. Two strings are similar when they share many trigrams.</p>
<p>Analogy: comparing two <em>torn-up photographs by counting matching jigsaw pieces</em>. Even if one photo has a scratch (a typo), most pieces still match, so you can tell they show the same scene.</p>
<h4>Functions and operators</h4>
<table>
<tr><th>Expression</th><th>Meaning</th></tr>
<tr><td><code>similarity(a, b)</code></td><td>shared trigrams / union of trigrams, 0–1</td></tr>
<tr><td><code>a % b</code></td><td>true if <code>similarity(a, b) &gt;= pg_trgm.similarity_threshold</code> (default 0.3)</td></tr>
<tr><td><code>word_similarity(a, b)</code>, <code>a &lt;% b</code></td><td>how well <code>a</code> matches <em>some part</em> of <code>b</code> (threshold <code>pg_trgm.word_similarity_threshold</code>, default 0.6)</td></tr>
<tr><td><code>strict_word_similarity(a, b)</code>, <code>a &lt;&lt;% b</code></td><td>like word_similarity but aligned to whole word boundaries (default threshold 0.5)</td></tr>
<tr><td><code>a &lt;-&gt; b</code></td><td>distance = 1 − similarity; use in <code>ORDER BY</code> for nearest matches (indexable with GiST)</td></tr>
<tr><td><code>show_trgm(text)</code></td><td>the trigram set, for debugging</td></tr>
<tr><td><code>set_limit(real)</code> / <code>show_limit()</code></td><td>older functional interface to <code>pg_trgm.similarity_threshold</code></td></tr>
</table>
<h4>Indexes</h4>
<ul>
<li><code>USING gin (col gin_trgm_ops)</code> — fast lookups for <code>%</code>, <code>LIKE</code>, <code>ILIKE</code>, <code>~</code>, <code>~*</code> and equality; larger build, slower updates; does <em>not</em> support <code>ORDER BY &lt;-&gt;</code>.</li>
<li><code>USING gist (col gist_trgm_ops)</code> — supports the same filters <em>and</em> KNN ordering by <code>&lt;-&gt;</code>; lossy signature, usually slower for plain filtering, cheaper to update.</li>
</ul>`,
  why: `<p>Users misspell: "Rajes Kumaar", "Bengaluru" vs "Bangalore", "MG Raod". Exact match (<code>=</code>) and prefix B-tree search fail completely. And <code>LIKE '%phone%'</code> — searching inside strings — cannot use a B-tree at all, forcing a sequential scan of the table. pg_trgm solves both with one index type, inside PostgreSQL, without an external search engine.</p>`,
  useCase: `<p>A KYC (know-your-customer) team at an Indian NBFC deduplicates 18 million customer records where names and addresses were typed by agents in branches: "Mohd. Imran Shaikh" vs "Mohammed Imran Sheikh", "Flat 4B, MG Road, Pune" vs "4-B MG Rd Pune". A GIN trigram index on a normalised <code>name || ' ' || pincode</code> column and the <code>%</code> operator with a tuned threshold (0.45) produce candidate pairs in ~20 ms per lookup; a reviewer confirms matches. The support portal's "search order notes containing…" box went from 9-second sequential scans to 30 ms with the same index type on <code>ILIKE '%term%'</code>.</p>`,
  internals: `<p>A GIN trigram index stores, for each distinct trigram, a posting list of row TIDs. A <code>%</code> or <code>LIKE '%abc%'</code> query extracts the query's trigrams, fetches the posting lists, and keeps rows that share enough trigrams (for LIKE: all required trigrams), then <strong>rechecks</strong> candidates against the heap (the index is lossy with respect to order and exact matching). Patterns with fewer than 3 characters inside wildcards yield few or no trigrams and degrade to a near-full scan. GiST stores a fixed-size bit signature per row (hashed trigrams, size tunable with <code>siglen</code>), allowing distance estimates for KNN ordering. Similarity thresholds are GUCs, so they can be set per session or per transaction (<code>SET LOCAL</code>).</p>`,
  whenNot: `<p>Trigram similarity is character-based, not linguistic: it does not know that "ran" and "running" are the same word, or that "car" and "automobile" are synonyms — use full-text search for word-based search and pgvector/embeddings for meaning. Very short strings (2–3 characters) have few trigrams and give noisy scores. For phonetic matching across spellings ("Smith" vs "Smyth") consider <code>fuzzystrmatch</code> (soundex, metaphone, levenshtein). For large-scale, multi-field relevance tuning, Elasticsearch/OpenSearch <span class="tag tool">third-party tool</span> may be a better fit.</p>`,
  syntax: `CREATE EXTENSION IF NOT EXISTS pg_trgm;

SELECT similarity('abc', 'abd'), word_similarity('kumar', 'rajesh kumar');
SELECT * FROM t WHERE col % 'query';                       -- similarity filter
SELECT * FROM t WHERE 'query' <% col;                      -- word similarity filter
SELECT col, col <-> 'query' AS dist FROM t ORDER BY col <-> 'query' LIMIT 10;

SET pg_trgm.similarity_threshold = 0.4;                    -- or SELECT set_limit(0.4);
SET pg_trgm.word_similarity_threshold = 0.5;

CREATE INDEX ON t USING gin  (col gin_trgm_ops);           -- filters, LIKE/ILIKE/regex
CREATE INDEX ON t USING gist (col gist_trgm_ops);          -- also ORDER BY <->`,
  examples: [
    { label: 'Basic', title: 'Trigrams and similarity scores',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;

SELECT show_trgm('Kumar') AS trigrams;

SELECT a, b,
       round(similarity(a, b)::numeric, 3)             AS similarity,
       round(word_similarity(a, b)::numeric, 3)        AS word_sim,
       round(strict_word_similarity(a, b)::numeric, 3) AS strict_word_sim,
       a % b                                           AS matches_default_0_3
FROM (VALUES ('Rajesh Kumar', 'Rajes Kumaar'),
             ('Rajesh Kumar', 'Kumar Rajesh'),
             ('kumar',        'Rajesh Kumar'),
             ('Bengaluru',    'Bangalore'),
             ('MG Road',      'M.G. Raod')) AS t(a, b);`,
      explain: `<p><code>show_trgm</code> reveals the padded, lower-cased trigrams. A typo ("Rajes Kumaar") keeps most trigrams, so similarity stays high. Word order does not matter ("Kumar Rajesh" has the same trigram set). <code>word_similarity('kumar', ...)</code> is 1 because "kumar" appears as a whole inside the longer string, while plain similarity penalises the extra text. "Bengaluru" vs "Bangalore" is only weakly similar — different names for a city are better handled with a synonym table than with trigrams. "MG Road" vs "M.G. Raod" scores low because punctuation splits "M.G." into two one-letter words: normalise (strip punctuation, expand abbreviations) before comparing.</p>`,
      output: ` a            | b            | similarity | word_sim | strict_word_sim | matches_default_0_3
--------------+--------------+------------+----------+-----------------+---------------------
 Rajesh Kumar | Rajes Kumaar | 0.625      | 0.643    | 0.625           | t
 Rajesh Kumar | Kumar Rajesh | 1.000      | 1.000    | 1.000           | t
 kumar        | Rajesh Kumar | 0.462      | 1.000    | 1.000           | t
 Bengaluru    | Bangalore    | 0.176      | 0.231    | 0.176           | f
 MG Road      | M.G. Raod    | 0.133      | 0.182    | 0.133           | f
(5 rows)`, run: true },
    { label: 'Intermediate', title: 'Typo-tolerant name and address matching with thresholds',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE kyc_customers (id int PRIMARY KEY, full_name text, address text);
INSERT INTO kyc_customers VALUES
 (1, 'Rajesh Kumar',          'Flat 4B, MG Road, Pune 411001'),
 (2, 'Rajeev Kumar',          '12 Park Street, Kolkata 700016'),
 (3, 'Mohammed Imran Sheikh', '22 Linking Road, Bandra, Mumbai 400050'),
 (4, 'Mohd Imran Shaikh',     '22 Linking Rd, Bandra West, Mumbai 400050'),
 (5, 'Priya Nair',            '7 Marine Drive, Kochi 682031'),
 (6, 'Priyanka Nair',         '9 MG Road, Bengaluru 560001'),
 (7, 'Suresh Kumar Reddy',    '45 Banjara Hills, Hyderabad 500034');

CREATE INDEX kyc_name_trgm ON kyc_customers USING gin (full_name gin_trgm_ops);

-- 1) typo search with the default threshold 0.3
SELECT id, full_name, round(similarity(full_name, 'Rajes Kumaar')::numeric, 2) AS score
FROM kyc_customers
WHERE full_name % 'Rajes Kumaar'
ORDER BY score DESC;

-- 2) stricter threshold for this transaction only
SET LOCAL pg_trgm.similarity_threshold = 0.45;

-- 3) candidate duplicate pairs on name AND address
SELECT a.id AS id_a, b.id AS id_b, a.full_name, b.full_name AS similar_name,
       round(similarity(a.full_name, b.full_name)::numeric, 2) AS name_sim,
       round(similarity(a.address,  b.address)::numeric, 2)    AS addr_sim
FROM kyc_customers a
JOIN kyc_customers b ON a.id < b.id AND a.full_name % b.full_name
WHERE similarity(a.address, b.address) > 0.4
ORDER BY name_sim DESC;`,
      explain: `<p>The first query finds "Rajesh Kumar" and "Rajeev Kumar" for the misspelled input (output not shown). <code>SET LOCAL pg_trgm.similarity_threshold = 0.45</code> raises the bar for the <code>%</code> operator for this transaction only (<code>set_limit(0.45)</code> is the older equivalent). The self-join then finds likely duplicates: names similar at 0.45 or more <em>and</em> addresses similar above 0.4. "Mohammed Imran Sheikh" / "Mohd Imran Shaikh" at the same Bandra address surfaces as a candidate pair, while "Priya Nair" / "Priyanka Nair" is excluded by the address check — exactly the behaviour a KYC reviewer wants.</p>`,
      output: ` id_a | id_b | full_name             | similar_name      | name_sim | addr_sim
------+------+-----------------------+-------------------+----------+----------
 3    | 4    | Mohammed Imran Sheikh | Mohd Imran Shaikh | 0.48     | 0.75
(1 row)`, run: true },
    { label: 'Advanced', title: 'Index-accelerated LIKE \'%x%\' and KNN ordering with GiST',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX products_name_gin  ON products USING gin  (name gin_trgm_ops);
CREATE INDEX products_name_gist ON products USING gist (name gist_trgm_ops);

SET LOCAL enable_seqscan = off;   -- products has only 100 rows; force index use for the demo

-- substring search with a leading wildcard: B-tree cannot help, trigram GIN can
EXPLAIN (COSTS OFF)
SELECT sku, name FROM products WHERE name ILIKE '%board max%';

-- "did you mean": nearest names to a misspelled query, ordered by distance
SELECT name, round((name <-> 'keybord mx')::numeric, 3) AS distance
FROM products
ORDER BY name <-> 'keybord mx'
LIMIT 4;`,
      explain: `<p>The GIN trigram index answers <code>ILIKE '%board max%'</code> — a leading-wildcard, case-insensitive substring search — with a <em>Bitmap Index Scan</em> plus a recheck, instead of reading every row (the EXPLAIN output is not shown above; it lists <code>Bitmap Index Scan on products_name_gin</code>). The GiST index supports <code>ORDER BY name &lt;-&gt; 'keybord mx'</code> as a KNN index scan, returning the closest names without computing the distance for every row. On 100 rows the planner would naturally prefer a sequential scan, so the demo disables it.</p>`,
      output: ` name            | distance
-----------------+----------
 Keyboard Max 2  | 0.632
 Keyboard Max 12 | 0.650
 Keyboard Max 22 | 0.650
 Keyboard Max 32 | 0.650
(4 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- B-tree cannot serve a leading wildcard: full scan every time
CREATE INDEX products_name_btree ON products (name);
EXPLAIN (COSTS OFF) SELECT sku FROM products WHERE name ILIKE '%lite%';`,
      why: 'A B-tree only helps anchored prefixes (LIKE \'abc%\' with C collation or text_pattern_ops); \'%lite%\' scans every row.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
SET LOCAL enable_seqscan = off;   -- tiny demo table
EXPLAIN (COSTS OFF) SELECT sku FROM products WHERE name ILIKE '%lite%';`,
      why: 'A GIN trigram index turns substring and case-insensitive searches into index lookups.', run: true }
  },
  mistakes: [
    `Forgetting the operator class: <code>CREATE INDEX ... USING gin (name)</code> fails for text — you need <code>gin_trgm_ops</code>.`,
    `Writing <code>WHERE similarity(a, b) &gt; 0.4</code> and expecting index use — only the operators (<code>%</code>, <code>&lt;%</code>, <code>&lt;-&gt;</code>, LIKE...) are indexable; set the threshold GUC and use <code>%</code>.`,
    `Using GIN and expecting <code>ORDER BY col &lt;-&gt; 'x'</code> to be index-assisted — that needs GiST.`,
    `Searching with 1–2 character patterns (<code>'%ab%'</code>), which produce almost no trigrams and scan most of the index.`,
    `Changing <code>pg_trgm.similarity_threshold</code> with plain <code>SET</code> in a pooled connection and leaking it to other clients — use <code>SET LOCAL</code>.`,
    `Comparing unnormalised data: strip punctuation, expand abbreviations ("Rd" → "Road") before matching for much better scores.`
  ],
  best: [
    `Normalise text first (lower-case, remove punctuation, expand common abbreviations) — often in a generated column that you index.`,
    `Use GIN for filtering and substring search; GiST when you need nearest-neighbour ordering.`,
    `Tune thresholds on real data: measure precision/recall on a labelled sample.`,
    `Combine trigram similarity with an exact filter (pincode, date of birth, tenant) to cut candidates.`,
    `Use <code>word_similarity</code> / <code>&lt;%</code> when the query is a fragment of a longer field.`
  ],
  performance: `<p>GIN trigram indexes are typically 1–3× the size of the indexed text and slow down writes (each insert adds ~N trigram entries; the GIN pending list with <code>fastupdate</code> batches them). Lookups are usually milliseconds on tens of millions of rows for selective queries; non-selective queries (common trigrams like "the") produce large posting lists and many rechecks. Fuzzy self-joins for deduplication are O(n × candidates): always restrict with a blocking key (pincode, city, first letter) to avoid comparing every pair. GiST index builds are slower than GIN for large tables; increasing <code>siglen</code> improves accuracy at the cost of size.</p>`,
  security: `<p>Fuzzy search endpoints are easy to abuse with patterns that match everything (<code>'%a%'</code>), consuming CPU. Enforce minimum query length (≥3 characters), <code>LIMIT</code> results, and use <code>statement_timeout</code> for search queries. If you build <code>LIKE</code> patterns from user input, escape <code>%</code> and <code>_</code> in the input so users cannot inject wildcards unintentionally.</p>`,
  scenario: { title: 'Customer support search box takes 9 seconds', steps: [
    '1. EXPLAIN ANALYZE shows Seq Scan with Filter: (notes ~~* \'%refund%\') on 30M rows.',
    '2. CREATE EXTENSION pg_trgm; CREATE INDEX CONCURRENTLY ... USING gin (notes gin_trgm_ops);',
    '3. Re-run EXPLAIN ANALYZE: Bitmap Index Scan on the trigram index, recheck on a few thousand rows.',
    '4. Enforce minimum 3-character search terms and LIMIT 50 in the API.',
    '5. Add statement_timeout for the search role.',
    '6. If users need word stemming and ranking, add full-text search alongside trigram matching.'
  ] },
  interview: [
    { q: 'How does pg_trgm make LIKE \'%term%\' fast?', a: 'A GIN (or GiST) index with gin_trgm_ops indexes every trigram of the column. The query’s pattern is decomposed into trigrams that must all be present; the index returns candidate rows containing them, which are rechecked against the actual LIKE condition. This avoids scanning the whole table even with a leading wildcard.' },
    { q: 'GIN vs GiST for trigram indexes?', a: 'GIN is generally faster for filtering (%, LIKE, ILIKE, regex) but larger and slower to update, and cannot order by distance. GiST supports KNN ORDER BY col <-> query, is cheaper to update, but uses lossy signatures and is often slower for plain filtering.' },
    { q: 'Difference between similarity and word_similarity?', a: 'similarity compares the full trigram sets of both strings; word_similarity measures how well the first string matches the most similar contiguous part of the second, so a short query against a long field scores high when it appears inside it.' },
    { q: 'How do you tune fuzzy match strictness?', a: 'Set pg_trgm.similarity_threshold (or set_limit) for %, and pg_trgm.word_similarity_threshold / strict_word_similarity_threshold for the word operators, ideally per transaction with SET LOCAL, choosing values from measured precision and recall.' }
  ],
  exercises: [
    { task: 'Find products whose name is similar to "Hedset Pluss" (typos) using the % operator and order by similarity, showing the top 3.', solution: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT name, round(similarity(name, 'Hedset Pluss')::numeric, 3) AS score
FROM products
WHERE name % 'Hedset Pluss'
ORDER BY score DESC, name
LIMIT 3;`, run: true },
    { task: 'Create a trigram GIN index on documents.body and show with EXPLAIN that a search for \'%replica%\' can use it (disable seqscan for the demo).', solution: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX documents_body_trgm ON documents USING gin (body gin_trgm_ops);
SET LOCAL enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT id, title FROM documents WHERE body ILIKE '%replica%';`, run: true }
  ],
  challenge: { task: 'Build a "did you mean" helper: a SQL function suggest_city(p_input text) RETURNS TABLE(city text, score real) that returns the 3 distinct customer cities most similar to the input using word_similarity, and test it with "Banglore" and "Hydrabad".', hint: 'SELECT DISTINCT city FROM customers in a subquery; order by word_similarity(p_input, city) DESC.', solution: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE FUNCTION suggest_city(p_input text)
RETURNS TABLE (city text, score real)
LANGUAGE sql STABLE AS $$
  SELECT c.city, word_similarity(p_input, c.city)
  FROM (SELECT DISTINCT city FROM customers) c
  ORDER BY 2 DESC, 1
  LIMIT 3
$$;

SELECT 'Banglore' AS input, * FROM suggest_city('Banglore')
UNION ALL
SELECT 'Hydrabad', * FROM suggest_city('Hydrabad');`, run: true },
  related: ['extensions-intro', 'full-text-search-production', 'indexes', 'advanced-indexing'],
  quiz: [
    { type: 'mcq', q: 'Which index supports ORDER BY name <-> \'query\' LIMIT 10 efficiently?', options: ['B-tree on name', 'GIN gin_trgm_ops', 'GiST gist_trgm_ops', 'Hash'], answer: 2, explain: 'Only GiST trigram indexes support KNN distance ordering.' },
    { type: 'tf', q: 'similarity(\'Rajesh Kumar\', \'Kumar Rajesh\') is 1.', answer: true, explain: 'Both strings produce exactly the same set of trigrams, so similarity is 1 regardless of word order.' },
    { type: 'index', q: 'A support tool runs WHERE notes ILIKE \'%refund%\' on 30M rows. Which index?', options: ['CREATE INDEX ON t (notes)', 'CREATE INDEX ON t (lower(notes))', 'CREATE INDEX ON t USING gin (notes gin_trgm_ops)', 'CREATE INDEX ON t USING hash (notes)'], answer: 2, explain: 'Leading-wildcard and case-insensitive substring search needs a trigram index.' },
    { type: 'bug', q: 'Why is the trigram index never used?', code: `CREATE INDEX ON customers USING gin (name gin_trgm_ops);
SELECT * FROM customers WHERE similarity(name, 'Rajes') > 0.4;`, options: ['GIN cannot index text', 'Only operators such as % are indexable, not the similarity() function call', 'Threshold too high', 'Needs GiST'], answer: 1, explain: 'Use SET pg_trgm.similarity_threshold = 0.4 and WHERE name % \'Rajes\'.' },
    { type: 'predict', q: 'With the default threshold, what does SELECT \'abc\' % \'xyz\'; return?', options: ['true', 'false', 'NULL', 'ERROR'], answer: 1, explain: 'They share no trigrams: similarity 0 < 0.3.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: jsonb
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'jsonb-json-vs-jsonb',
  module: 'jsonb',
  title: 'json vs jsonb: Storage, Semantics and When to Use JSON Columns',
  level: 3,
  minutes: 18,
  summary: 'Understand how json (text) and jsonb (decomposed binary) differ in storage, key order, duplicate keys, whitespace and indexing, and decide when a JSON column is the right modelling choice versus normal relational columns.',
  objectives: [
    'Explain how json and jsonb store data and why jsonb is the default choice',
    'Predict jsonb behaviour for key order, duplicate keys, whitespace and numbers',
    'Validate JSON structure with CHECK constraints and jsonb_typeof',
    'Decide between relational columns, a jsonb column and a hybrid design'
  ],
  concept: `<p>PostgreSQL has two JSON types <span class="tag core">core</span>:</p>
<ul>
<li><code>json</code> — stores the <strong>exact input text</strong>. Validated on input, but every operation must re-parse it. Preserves whitespace, key order and duplicate keys.</li>
<li><code>jsonb</code> — stores a <strong>decomposed binary tree</strong>. Parsed once on input; operators navigate it directly. Removes insignificant whitespace, does not preserve key order (keys are sorted by length, then bytes), and keeps only the <strong>last</strong> value for duplicate keys. Supports GIN indexing, containment (<code>@&gt;</code>) and existence (<code>?</code>) operators, and equality comparison.</li>
</ul>
<p>Analogy: <code>json</code> is a <em>photocopy of a filled-in form</em> — an exact image, but to find "date of birth" you must read the whole page every time. <code>jsonb</code> is the <em>form typed into a database with labelled fields</em> — the original handwriting and layout are lost, but any field can be looked up instantly and compared.</p>
<h4>When is a JSON column the right model?</h4>
<ul>
<li><strong>Yes</strong>: sparse or highly variable attributes (product specs that differ per category), payloads you store and replay (API responses, webhooks, event bodies), user preferences, feature flags, data whose schema is owned by another system.</li>
<li><strong>No</strong>: data you filter, join, aggregate or constrain on regularly (prices, foreign keys, statuses, dates) — those belong in typed columns with constraints and statistics.</li>
<li><strong>Hybrid (most common)</strong>: core fields as columns, the long tail in a <code>jsonb</code> column — exactly how <code>products</code> is modelled in <code>company_db</code> (<code>price</code>, <code>category</code> as columns; brand, colour, warranty and specs in <code>attributes</code>).</li>
</ul>
<div class="callout tip">Use <code>jsonb</code> unless you have a specific need for the exact original text (e.g. a signed webhook body whose signature is computed over the raw bytes — then store it as <code>json</code> or <code>text</code>).</div>`,
  why: `<p>Modern applications exchange JSON everywhere. Before JSON types, teams either forced variable attributes into rigid columns (dozens of mostly-NULL columns or an EAV table) or stored opaque text blobs that could not be queried. <code>jsonb</code> gives document-database flexibility inside a relational, transactional database — one system instead of PostgreSQL plus MongoDB.</p>`,
  useCase: `<p>An electronics marketplace has 400 categories with different specs: laptops have RAM and CPU, TVs have panel type and refresh rate, chairs have material and max load. Instead of 1 200 sparse columns, they store specs in <code>attributes jsonb</code>, with a GIN index for filter facets, while price, stock, category and seller stay typed columns with foreign keys and CHECKs. A CHECK constraint guarantees <code>attributes</code> is always an object and that <code>warranty_months</code>, when present, is a number.</p>`,
  internals: `<p><code>jsonb</code> values are stored as a header with offsets to keys and values, keys sorted for binary search within each object, and scalar values in native representations (numbers as <code>numeric</code>, so <code>1.0</code> and <code>1.00</code> are equal but printed as given). This makes key lookup O(log n) without parsing. Large values are TOAST-compressed and stored out of line (more in the indexing lesson). <code>json</code> is a varlena text value; each <code>-&gt;</code> re-parses the document. Input conversion makes <code>jsonb</code> slightly slower to insert, but every subsequent read is faster.</p>`,
  whenNot: `<p>Do not use JSON to avoid schema design: once you need foreign keys, NOT NULL, uniqueness, frequent aggregation or column statistics on a field, promote it to a real column (possibly a generated column extracted from the JSON). Do not use <code>json</code> (text) for data you query — every access re-parses it.</p>`,
  syntax: `col json                        -- exact text
col jsonb                       -- binary, indexable (preferred)
'{"a": 1}'::jsonb
jsonb_typeof(v)                 -- object | array | string | number | boolean | null
jsonb_pretty(v)
CHECK (jsonb_typeof(col) = 'object')`,
  examples: [
    { label: 'Basic', title: 'Same input, different storage semantics',
      sql: `SELECT '{"b": 1,   "a": 2, "a": 3}'::json  AS as_json,
       '{"b": 1,   "a": 2, "a": 3}'::jsonb AS as_jsonb,
       '{"x": 1.50}'::jsonb = '{"x": 1.5}'::jsonb      AS numeric_equal,
       '{"a":1,"b":2}'::jsonb = '{"b":2, "a":1}'::jsonb AS order_ignored;`,
      explain: `<p><code>json</code> returns the input text untouched — extra spaces, original order and both <code>"a"</code> keys. <code>jsonb</code> normalises: whitespace removed, keys reordered (shorter keys first, then by bytes), and only the <em>last</em> duplicate key kept (<code>"a": 3</code>). Numbers are compared numerically, and key order never affects equality. (Equality operators exist only for <code>jsonb</code>, not <code>json</code>.)</p>`,
      output: ` as_json                    | as_jsonb         | numeric_equal | order_ignored
----------------------------+------------------+---------------+---------------
 {"b": 1,   "a": 2, "a": 3} | {"a": 3, "b": 1} | t             | t
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Size, type introspection and the products.attributes column',
      sql: `SELECT id, name,
       attributes,
       jsonb_typeof(attributes)                     AS top_type,
       jsonb_typeof(attributes -> 'specs')          AS specs_type,
       jsonb_typeof(attributes -> 'warranty_months') AS warranty_type,
       pg_column_size(attributes::text::json)       AS bytes_as_json,
       pg_column_size(attributes)                   AS bytes_as_jsonb
FROM products
ORDER BY id
LIMIT 3;`,
      explain: `<p><code>jsonb_typeof</code> reports the JSON type of any element — useful for validation and for handling mixed data. <code>pg_column_size</code> shows that <code>jsonb</code> is often <em>larger</em> than the equivalent <code>json</code> text for small documents (it stores offsets and headers) — you trade some space for fast access. For large documents both are TOAST-compressed.</p>`,
      output: ` id | name           | attributes                                                               | top_type | specs_type | warranty_type | bytes_as_json | bytes_as_jsonb
----+----------------+--------------------------------------------------------------------------+----------+------------+---------------+---------------+----------------
 1  | Monitor Air 1  | {"brand": "Zenit", "color": "silver", "specs": {"weight_kg": 12.4}, "... | object   | object     | number        | 94            | 125
 2  | Keyboard Max 2 | {"brand": "Orbit", "color": "white", "specs": {"weight_kg": 13.3}, "w... | object   | object     | number        | 93            | 121
 3  | Mouse Lite 3   | {"brand": "Nimbus", "color": "black", "specs": {"weight_kg": 11.7}, "... | object   | object     | number        | 93            | 125
(3 rows)`, run: true },
    { label: 'Advanced', title: 'A hybrid table with JSON validation constraints',
      sql: `CREATE TABLE catalog_items (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku        text    NOT NULL UNIQUE,              -- relational: unique, joined, filtered
  price      numeric(10,2) NOT NULL CHECK (price >= 0),
  attributes jsonb   NOT NULL DEFAULT '{}',        -- flexible long tail
  CONSTRAINT attributes_is_object
    CHECK (jsonb_typeof(attributes) = 'object'),
  CONSTRAINT warranty_is_number
    CHECK (NOT attributes ? 'warranty_months'
           OR jsonb_typeof(attributes -> 'warranty_months') = 'number')
);

INSERT INTO catalog_items (sku, price, attributes)
VALUES ('CAB-001', 199, '{"brand":"Acme","warranty_months":6}');

DO $$ BEGIN
  INSERT INTO catalog_items (sku, price, attributes) VALUES ('CAB-002', 99, '["not","an","object"]');
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'rejected 1: %', SQLERRM; END $$;

DO $$ BEGIN
  INSERT INTO catalog_items (sku, price, attributes) VALUES ('CAB-003', 99, '{"warranty_months":"six"}');
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'rejected 2: %', SQLERRM; END $$;

SELECT sku, price, attributes FROM catalog_items;`,
      explain: `<p>Core fields are typed columns with real constraints; the JSON column holds the flexible part but is still guarded: it must be an object, and if <code>warranty_months</code> exists it must be numeric. Both invalid inserts are rejected by CHECK constraints. This hybrid gives schema flexibility without accepting garbage. For full JSON Schema validation, extensions such as <code>pg_jsonschema</code> <span class="tag ext">extension</span> exist, but simple CHECKs cover most needs.</p>`,
      output: `NOTICE:  rejected 1: new row for relation "catalog_items" violates check constraint "attributes_is_object"
NOTICE:  rejected 2: new row for relation "catalog_items" violates check constraint "warranty_is_number"
 sku     | price  | attributes
---------+--------+-----------------------------------------
 CAB-001 | 199.00 | {"brand": "Acme", "warranty_months": 6}
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Everything in one JSON blob: no types, no constraints, no statistics
CREATE TABLE orders_doc (id bigint PRIMARY KEY, doc jsonb);
INSERT INTO orders_doc
SELECT id, jsonb_build_object('customer_id', customer_id, 'status', status, 'total', total_amount)
FROM orders;
SELECT count(*) FROM orders_doc WHERE (doc ->> 'total')::numeric > 100000;`,
      why: 'Core fields hidden in JSON lose foreign keys, NOT NULL/CHECK constraints, typed comparisons and planner statistics; every query casts.', run: true },
    good: { sql: `-- Typed columns for core fields, jsonb only for the variable part
SELECT count(*) FROM orders WHERE total_amount > 100000;`,
      why: 'Typed, constrained columns are smaller, faster, indexable with B-trees and have accurate statistics.', run: true }
  },
  mistakes: [
    `Choosing <code>json</code> instead of <code>jsonb</code> for data you query — every access re-parses the text and GIN indexing is impossible.`,
    `Relying on key order or duplicate keys in <code>jsonb</code>; they are not preserved.`,
    `Putting foreign keys, statuses and amounts inside JSON, losing constraints and statistics.`,
    `Not validating the JSON shape at all, so code must defend against arrays, strings or nulls where objects were expected.`,
    `Comparing JSON numbers as text (<code>-&gt;&gt;</code>) — <code>'10' &lt; '9'</code> as strings.`
  ],
  best: [
    `Default to <code>jsonb</code>; use <code>json</code>/<code>text</code> only to preserve exact bytes.`,
    `Use the hybrid pattern: relational columns for core fields, <code>jsonb</code> for the variable tail.`,
    `Add CHECK constraints with <code>jsonb_typeof</code> and <code>?</code> for critical keys.`,
    `Promote frequently filtered keys to (generated) columns.`,
    `Keep documents reasonably small (KBs, not MBs) — see the indexing and design lesson.`
  ],
  performance: `<p>Reading a key from <code>jsonb</code> is fast (binary search in the object header), while <code>json</code> requires parsing the whole text per access. Insert cost is slightly higher for <code>jsonb</code> due to conversion. For small documents <code>jsonb</code> takes somewhat more space; beyond ~2 KB both are compressed by TOAST, and very large documents cost a lot to read and rewrite even for tiny changes (any update rewrites the entire value).</p>`,
  security: `<p>JSON columns often hold data from external systems; treat it as untrusted input. Never interpolate JSON values into dynamic SQL. Be aware that personal data hidden in JSON (emails, phone numbers in an API payload) is easy to forget in data-protection reviews and masking rules — document what JSON columns may contain.</p>`,
  scenario: { title: "A webhook table cannot be queried efficiently", steps: [
    "1. Webhook payloads were stored in a json column; filters take seconds.",
    "2. Keep the raw text only if signatures must be re-verified; otherwise convert: ALTER COLUMN payload TYPE jsonb USING payload::jsonb.",
    "3. Promote event_type and received_at to columns; index them.",
    "4. Add CHECK (jsonb_typeof(payload) = 'object').",
    "5. Add a GIN jsonb_path_ops index for containment filters.",
    "6. Set a retention policy and redact secrets inside payloads."
  ] },
  interview: [
    { q: 'What are the main differences between json and jsonb?', a: 'json stores the exact text (whitespace, key order, duplicate keys) and re-parses on every access. jsonb stores a parsed binary representation: whitespace removed, keys de-duplicated (last wins) and reordered, faster to query, supports equality, containment/existence operators and GIN indexes.' },
    { q: 'When would you still use json?', a: 'When the exact original text must be preserved — for example to verify a signature computed over the raw webhook body, or for audit of the exact payload received. Even then many teams store it as text plus a parsed jsonb copy.' },
    { q: 'When should a JSON field become a real column?', a: 'When it is used for joins, frequent filtering or aggregation, needs constraints (NOT NULL, FK, UNIQUE), or benefits from planner statistics. A generated column extracted from the JSON is an easy migration path.' }
  ],
  exercises: [
    { task: 'Show for each JSON type (object, array, string, number, boolean, null) an example literal and confirm jsonb_typeof for each.', solution: `SELECT v, jsonb_typeof(v)
FROM (VALUES ('{"a":1}'::jsonb), ('[1,2]'), ('"text"'), ('42'), ('true'), ('null')) t(v);`, run: true },
    { task: 'Count products per JSON type of attributes->\'specs\'->\'weight_kg\' to check the data is consistently numeric.', solution: `SELECT jsonb_typeof(attributes -> 'specs' -> 'weight_kg') AS t, count(*)
FROM products GROUP BY 1;`, run: true }
  ],
  challenge: { task: 'Add a CHECK constraint to products that requires attributes to be an object containing a string "brand" key, verify existing rows pass, and show an insert without brand is rejected.', hint: 'ALTER TABLE ... ADD CONSTRAINT ... CHECK (jsonb_typeof(attributes) = \'object\' AND jsonb_typeof(attributes -> \'brand\') = \'string\').', solution: `ALTER TABLE products ADD CONSTRAINT attributes_has_brand
  CHECK (jsonb_typeof(attributes) = 'object' AND jsonb_typeof(attributes -> 'brand') = 'string');

DO $$ BEGIN
  INSERT INTO products (sku, name, category, price, attributes)
  VALUES ('SKU-X', 'No Brand Cable', 'accessories', 99, '{"color":"red"}');
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'rejected: %', SQLERRM;
END $$;`, run: true },
  related: ['jsonb-operators', 'jsonb-path-and-updates', 'jsonb-indexing-design', 'data-types', 'database-design'],
  quiz: [
    { type: 'predict', q: 'What does SELECT \'{"a":1,"a":2}\'::jsonb; return?', options: ['{"a": 1, "a": 2}', '{"a": 1}', '{"a": 2}', 'ERROR'], answer: 2, explain: 'jsonb keeps only the last value for duplicate keys.' },
    { type: 'tf', q: 'jsonb preserves the order of keys as written.', answer: false, explain: 'Keys are stored sorted (by length, then bytes); use json if you must preserve order.' },
    { type: 'mcq', q: 'Which type supports GIN indexing and the @> containment operator?', options: ['json', 'jsonb', 'text', 'both json and jsonb'], answer: 1, explain: 'Only jsonb has containment/existence operators and GIN operator classes.' },
    { type: 'design', q: 'Products have 5 core fields used in every query and ~40 category-specific optional specs. Best model?', options: ['All 45 as columns', 'Everything in one jsonb', 'Core fields as columns + specs in jsonb', 'EAV table'], answer: 2, explain: 'The hybrid model keeps core fields typed and constrained, and the variable tail flexible.' }
  ]
},
{
  id: 'jsonb-operators',
  module: 'jsonb',
  title: 'JSONB Operators and Functions: ->, ->>, #>, @>, ?, jsonb_each and Friends',
  level: 3,
  minutes: 22,
  summary: 'Navigate and filter JSONB with -> ->> #> #>>, test containment and key existence with @> <@ ? ?| ?&, and explode documents into rows with jsonb_each, jsonb_object_keys and jsonb_array_elements — all on products.attributes and documents.metadata.',
  objectives: [
    'Extract values as jsonb (->, #>) or text (->>, #>>) and cast them correctly',
    'Filter with containment (@>, <@) and key existence (?, ?|, ?&)',
    'Turn objects and arrays into rows with jsonb_each, jsonb_object_keys and jsonb_array_elements(_text)',
    'Build JSON output with jsonb_build_object and jsonb_agg',
    'Choose the operator that can use a GIN index'
  ],
  concept: `<p>JSONB operators are a <em>set of keys for a filing cabinet</em>: some open a drawer and hand you the folder still in its sleeve (<code>-&gt;</code> returns <code>jsonb</code>), others hand you the paper itself (<code>-&gt;&gt;</code> returns <code>text</code>); some walk a path of drawers in one go (<code>#&gt;</code>, <code>#&gt;&gt;</code>); and some just answer "is there a folder like this in the drawer?" (<code>@&gt;</code>, <code>?</code>).</p>
<table>
<tr><th>Operator</th><th>Example</th><th>Result</th></tr>
<tr><td><code>-&gt;</code> key / index</td><td><code>attributes -&gt; 'specs'</code>, <code>tags -&gt; 0</code></td><td>jsonb</td></tr>
<tr><td><code>-&gt;&gt;</code></td><td><code>attributes -&gt;&gt; 'brand'</code></td><td>text</td></tr>
<tr><td><code>#&gt;</code> path</td><td><code>attributes #&gt; '{specs,weight_kg}'</code></td><td>jsonb</td></tr>
<tr><td><code>#&gt;&gt;</code> path</td><td><code>attributes #&gt;&gt; '{specs,weight_kg}'</code></td><td>text</td></tr>
<tr><td><code>@&gt;</code> contains</td><td><code>attributes @&gt; '{"brand":"Acme"}'</code></td><td>boolean</td></tr>
<tr><td><code>&lt;@</code> contained in</td><td><code>'{"brand":"Acme"}' &lt;@ attributes</code></td><td>boolean</td></tr>
<tr><td><code>?</code> key / array string exists</td><td><code>metadata -&gt; 'tags' ? 'vacuum'</code></td><td>boolean</td></tr>
<tr><td><code>?|</code> any of / <code>?&amp;</code> all of</td><td><code>attributes ?| array['color','size']</code></td><td>boolean</td></tr>
</table>
<p>Modern subscript syntax (PG14+) also works: <code>attributes['specs']['weight_kg']</code> returns <code>jsonb</code> and can be used in <code>UPDATE ... SET attributes['color'] = '"red"'</code>.</p>
<h4>Set-returning functions</h4>
<ul>
<li><code>jsonb_each(obj)</code> / <code>jsonb_each_text(obj)</code> — one row per key: <code>(key, value)</code>.</li>
<li><code>jsonb_object_keys(obj)</code> — one row per key.</li>
<li><code>jsonb_array_elements(arr)</code> / <code>jsonb_array_elements_text(arr)</code> — one row per array element.</li>
<li>Aggregates: <code>jsonb_agg(expr)</code>, <code>jsonb_object_agg(k, v)</code>; constructors: <code>jsonb_build_object</code>, <code>jsonb_build_array</code>, <code>to_jsonb</code>.</li>
</ul>`,
  why: `<p>Storing JSON is only useful if you can query it precisely. These operators let you filter documents, extract typed values for comparison and aggregation, and flatten nested structures into relational rows so the rest of SQL — joins, GROUP BY, window functions — works on them.</p>`,
  useCase: `<p>A product-listing API serves faceted filters ("brand = Acme, colour = black, warranty ≥ 12 months") over 3 million products. Facet filters translate to a single <code>attributes @&gt; '{"brand":"Acme","color":"black"}'</code> predicate served by a GIN index (≈5 ms), the numeric warranty range uses <code>(attributes -&gt;&gt; 'warranty_months')::int &gt;= 12</code> with an expression index, and the facet counts sidebar uses <code>jsonb_each_text</code> + <code>GROUP BY</code> on the filtered set.</p>`,
  internals: `<p><code>-&gt;</code> on an object performs a binary search over the sorted keys in the jsonb header; on arrays it indexes by position (negative indexes count from the end). <code>-&gt;&gt;</code> additionally converts the found value to text (strings unquoted, objects serialised). <code>@&gt;</code> implements a structural containment check: every key/value in the right operand must exist in the left, recursively; for arrays, every element on the right must appear somewhere on the left (order and duplicates ignored). The default <code>jsonb_ops</code> GIN operator class supports <code>@&gt;</code>, <code>?</code>, <code>?|</code>, <code>?&amp;</code> (and jsonpath <code>@?</code>/<code>@@</code>); <code>-&gt;&gt;</code> comparisons need expression B-tree indexes instead.</p>`,
  whenNot: `<p>Avoid <code>-&gt;&gt;</code> comparisons on unindexed large tables for frequent filters — promote the key or add an expression index. Do not explode huge arrays with <code>jsonb_array_elements</code> in hot OLTP queries; if you constantly need array elements as rows, they probably belong in a child table.</p>`,
  syntax: `doc -> 'key'        doc -> 0          doc ->> 'key'
doc #> '{a,b,0}'    doc #>> '{a,b,0}'
doc @> '{"k":"v"}'  '{"k":"v"}' <@ doc
doc ? 'key'         doc ?| array['a','b']    doc ?& array['a','b']
doc['key']['sub']                         -- subscripting, PG14+
jsonb_each(doc)  jsonb_each_text(doc)  jsonb_object_keys(doc)
jsonb_array_elements(arr)  jsonb_array_elements_text(arr)  jsonb_array_length(arr)
jsonb_build_object(k, v, ...)  jsonb_agg(x)  jsonb_object_agg(k, v)`,
  examples: [
    { label: 'Basic', title: 'Extracting values: jsonb vs text, keys vs paths',
      sql: `SELECT sku,
       attributes -> 'brand'                         AS brand_jsonb,
       attributes ->> 'brand'                        AS brand_text,
       attributes -> 'specs' -> 'weight_kg'          AS weight_jsonb,
       attributes #>> '{specs,weight_kg}'            AS weight_text,
       (attributes #>> '{specs,weight_kg}')::numeric AS weight_num,
       attributes['warranty_months']                 AS warranty_subscript
FROM products
ORDER BY id
LIMIT 4;`,
      explain: `<p><code>-&gt;</code> returns <code>jsonb</code> (strings keep their quotes); <code>-&gt;&gt;</code> returns <code>text</code>. Chained <code>-&gt;</code> or a path with <code>#&gt;</code>/<code>#&gt;&gt;</code> reaches nested values. To compare or compute numerically, cast the text: <code>(... #&gt;&gt; ...)::numeric</code>. The subscript form <code>attributes['warranty_months']</code> (PG14+) is equivalent to <code>-&gt;</code>.</p>`,
      output: ` sku      | brand_jsonb | brand_text | weight_jsonb | weight_text | weight_num | warranty_subscript
----------+-------------+------------+--------------+-------------+------------+--------------------
 SKU-0001 | "Zenit"     | Zenit      | 12.4         | 12.4        | 12.4       | 12
 SKU-0002 | "Orbit"     | Orbit      | 13.3         | 13.3        | 13.3       | 24
 SKU-0003 | "Nimbus"    | Nimbus     | 11.7         | 11.7        | 11.7       | 6
 SKU-0004 | "Acme"      | Acme       | 2.5          | 2.5         | 2.5        | 12
(4 rows)`, run: true },
    { label: 'Intermediate', title: 'Filtering with containment and key existence',
      sql: `SELECT
  count(*) FILTER (WHERE attributes @> '{"brand":"Acme","color":"black"}')       AS acme_black,
  count(*) FILTER (WHERE attributes @> '{"specs":{"weight_kg":12.4}}')           AS weight_12_4,
  count(*) FILTER (WHERE (attributes ->> 'warranty_months')::int >= 24)         AS warranty_24_plus,
  count(*) FILTER (WHERE attributes ? 'specs')                                  AS has_specs,
  count(*) FILTER (WHERE attributes ?| array['size', 'color'])                  AS has_size_or_color,
  count(*) FILTER (WHERE attributes ?& array['size', 'color'])                  AS has_size_and_color
FROM products;

-- existence inside an array: documents tagged "vacuum"
SELECT id, title, metadata -> 'tags' AS tags
FROM documents
WHERE metadata -> 'tags' ? 'vacuum'
ORDER BY id;`,
      explain: `<p><code>@&gt;</code> checks that the left document contains the right one — any depth, any number of keys at once; it is the most index-friendly filter. Range conditions need extraction and a cast (<code>-&gt;&gt;</code> then <code>::int</code>). <code>?</code> tests whether a key exists in an object, <em>or</em> whether a string is an element of an array — handy for tag arrays such as <code>metadata-&gt;'tags'</code>. <code>?|</code> means "any of these keys", <code>?&amp;</code> "all of them" (no product has a <code>size</code> key). The output shows the second query.</p>`,
      output: ` id | title              | tags
----+--------------------+----------------------
 2  | Understanding MVCC | ["mvcc", "vacuum"]
 15 | Tuning autovacuum  | ["vacuum", "tuning"]
(2 rows)`, run: true },
    { label: 'Advanced', title: 'Exploding JSON into rows and rebuilding JSON',
      sql: `-- 1) facet counts: every key/value pair of attributes as rows
WITH facets AS (
  SELECT kv.key, kv.value
  FROM products p, jsonb_each_text(p.attributes) AS kv
  WHERE kv.key IN ('brand', 'color')
)
SELECT key, value, count(*) AS products
FROM facets
GROUP BY key, value
ORDER BY key, products DESC, value;

-- 2) tag usage across documents, rebuilt as a JSON report per level
SELECT level, jsonb_object_agg(tag, n ORDER BY tag) AS tag_counts
FROM (
  SELECT d.metadata ->> 'level' AS level, tag, count(*) AS n
  FROM documents d, jsonb_array_elements_text(d.metadata -> 'tags') AS tag
  GROUP BY 1, 2
) t
GROUP BY level
ORDER BY 1;`,
      explain: `<p><code>jsonb_each_text</code> in a lateral join turns each product's attributes into key/value rows, so ordinary <code>GROUP BY</code> produces facet counts for a filter sidebar (first query; output not shown). The second query explodes the <code>tags</code> array of every document with <code>jsonb_array_elements_text</code>, counts each tag per level, and folds the counts back into one JSON object per level with <code>jsonb_object_agg</code> — relational processing in the middle, JSON at both ends.</p>`,
      output: ` level        | tag_counts
--------------+--------------------------------------------------------------------------
 advanced     | {"ai": 1, "ha": 1, "rls": 1, "wal": 1, "mvcc": 1, "pitr": 1, "backup"...
 beginner     | {"jsonb": 1, "design": 1, "laptop": 1, "refund": 1, "shipping": 1, "w...
 intermediate | {"cte": 1, "llm": 1, "rag": 1, "tls": 1, "btree": 1, "index": 1, "sea...
(3 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Text comparison on extracted values: not indexable by GIN, wrong for numbers
SELECT count(*) FROM products
WHERE attributes ->> 'brand' = 'Acme'
  AND attributes ->> 'warranty_months' > '9';   -- text: '12' > '9' is false!`,
      why: 'Comparing numbers as text gives wrong answers (\'12\' < \'9\'), and ->> equality cannot use a jsonb GIN index.', run: true },
    good: { sql: `SELECT count(*) FROM products
WHERE attributes @> '{"brand":"Acme"}'
  AND (attributes ->> 'warranty_months')::int > 9;`,
      why: 'Containment is GIN-indexable; numeric values are cast before comparing.', run: true }
  },
  mistakes: [
    `Using <code>-&gt;</code> where you need text: <code>attributes -&gt; 'brand' = 'Acme'</code> fails because the right side would need to be JSON (<code>'"Acme"'</code>).`,
    `Comparing numeric JSON values as text with <code>-&gt;&gt;</code> without casting.`,
    `Expecting <code>?</code> to find a key nested deeper than the top level; it only checks the top level of the operand.`,
    `Using the <code>?</code> operator from JDBC/PDO where <code>?</code> is a parameter placeholder — escape it (<code>??</code>) or use <code>jsonb_exists()</code>/<code>@&gt;</code>.`,
    `Exploding arrays with <code>jsonb_array_elements</code> in a SELECT list along with other set-returning functions and getting confusing row multiplication; put it in <code>FROM</code> with LATERAL.`
  ],
  best: [
    `Prefer <code>@&gt;</code> for equality-style filters on JSON: one operator, any depth, GIN-indexable.`,
    `Use <code>-&gt;&gt;</code> plus an explicit cast for range filters and aggregates; index the expression if hot.`,
    `Put set-returning JSON functions in <code>FROM</code> (implicit LATERAL), not the SELECT list.`,
    `Use <code>jsonb_build_object</code>/<code>jsonb_agg</code> to return API-shaped JSON directly from SQL.`,
    `Handle missing keys explicitly: <code>coalesce((doc -&gt;&gt; 'k')::int, 0)</code>.`
  ],
  performance: `<p>Operators on jsonb are fast per row, but filtering a big table still needs an index: <code>@&gt;</code>/<code>?</code> via GIN, <code>-&gt;&gt;</code> comparisons via expression B-tree. The planner has no statistics on keys inside JSON by default, so selectivity estimates for <code>@&gt;</code> are crude constants (often 0.1% for containment) — misestimates can lead to bad join plans. Extended statistics on expressions (<code>CREATE STATISTICS ... ON ((attributes -&gt;&gt; 'brand'))</code>, PG14+) or promoting keys to columns fix that.</p>`,
  security: `<p>When building JSON filters from user input, pass the JSON as a bound parameter (<code>attributes @&gt; $1::jsonb</code>) rather than concatenating strings. Allow-list which keys users may filter on, otherwise any internal attribute becomes queryable through your API.</p>`,
  scenario: { title: "Facet filter returns wrong counts", steps: [
    "1. 'Warranty > 9 months' shows fewer products than expected.",
    "2. Query uses attributes ->> 'warranty_months' > '9': a text comparison where '12' sorts before '9'.",
    "3. Fix with (attributes ->> 'warranty_months')::int > 9.",
    "4. Replace ->> equality filters with @> containment so the GIN index applies.",
    "5. Add an expression index for the numeric range filter.",
    "6. Add tests with values around 9/10/12 to catch text-vs-number bugs."
  ] },
  interview: [
    { q: 'Difference between -> and ->>?', a: '-> returns the element as jsonb (keeping JSON typing and quotes), ->> returns it as text. Use -> to keep navigating or compare JSON values, ->> to compare with text or cast to numeric/date.' },
    { q: 'How do you check whether a JSON array contains a particular string?', a: 'Use the ? operator on the array (doc -> \'tags\' ? \'vacuum\') or containment (doc @> \'{"tags":["vacuum"]}\'), which is GIN-indexable on the whole document.' },
    { q: 'How would you compute facet counts from JSON attributes?', a: 'Explode the attributes with jsonb_each_text in a lateral join, filter to the facet keys, and GROUP BY key, value with count(*). For large data, precompute or materialize the counts.' }
  ],
  exercises: [
    { task: 'List the average price per brand (from attributes) for products with a warranty of at least 12 months.', solution: `SELECT attributes ->> 'brand' AS brand, round(avg(price), 2) AS avg_price, count(*)
FROM products
WHERE (attributes ->> 'warranty_months')::int >= 12
GROUP BY 1 ORDER BY avg_price DESC;`, run: true },
    { task: 'Find documents whose metadata contains the tag "security" or "rls" using ?|.', solution: `SELECT id, title, metadata -> 'tags' AS tags
FROM documents
WHERE metadata -> 'tags' ?| array['security', 'rls']
ORDER BY id;`, run: true }
  ],
  challenge: { task: 'Return one JSON array per category containing objects {sku, brand, weight_kg} for the 3 heaviest products of that category, using jsonb_build_object and jsonb_agg with ORDER BY.', hint: 'Rank with row_number() over (partition by category order by weight desc) in a subquery, then jsonb_agg(... ORDER BY weight DESC) FILTER or WHERE rn <= 3.', solution: `SELECT category,
       jsonb_agg(jsonb_build_object('sku', sku, 'brand', brand, 'weight_kg', weight)
                 ORDER BY weight DESC) AS heaviest
FROM (
  SELECT category, sku, attributes ->> 'brand' AS brand,
         (attributes #>> '{specs,weight_kg}')::numeric AS weight,
         row_number() OVER (PARTITION BY category
                            ORDER BY (attributes #>> '{specs,weight_kg}')::numeric DESC) AS rn
  FROM products
) x
WHERE rn <= 3
GROUP BY category
ORDER BY category;`, run: true },
  related: ['jsonb-json-vs-jsonb', 'jsonb-path-and-updates', 'jsonb-indexing-design', 'arrays'],
  quiz: [
    { type: 'predict', q: 'What is the type of attributes -> \'brand\'?', options: ['text', 'jsonb', 'varchar', 'record'], answer: 1, explain: '-> returns jsonb; ->> returns text.' },
    { type: 'mcq', q: 'Which predicate can use a default GIN (jsonb_ops) index on attributes?', options: ['attributes ->> \'brand\' = \'Acme\'', 'attributes @> \'{"brand":"Acme"}\'', '(attributes ->> \'warranty_months\')::int > 6', 'lower(attributes ->> \'brand\') = \'acme\''], answer: 1, explain: 'GIN jsonb_ops supports @>, ?, ?|, ?& and jsonpath operators, not ->> comparisons.' },
    { type: 'tf', q: 'doc ? \'weight_kg\' is true when weight_kg exists only inside doc->\'specs\'.', answer: false, explain: '? checks only top-level keys (or top-level array elements) of its left operand.' },
    { type: 'bug', q: 'Why does this return no rows even though 25 products are from Acme?', code: `SELECT * FROM products WHERE attributes -> 'brand' = '"acme"';`, options: ['-> cannot compare', 'Case: the stored value is "Acme"', 'Needs #>', 'jsonb is unordered'], answer: 1, explain: 'JSON string comparison is case-sensitive; the stored value is "Acme".' }
  ]
},
{
  id: 'jsonb-path-and-updates',
  module: 'jsonb',
  title: 'SQL/JSON Path, JSON_TABLE and Updating JSONB Documents',
  level: 4,
  minutes: 26,
  summary: 'Query documents with SQL/JSON path expressions (jsonb_path_query, @?, @@), use the SQL-standard JSON_TABLE, JSON_VALUE, JSON_QUERY and JSON_EXISTS (PostgreSQL 17+), and modify JSONB with jsonb_set, ||, -, #- — including a pattern for storing API responses.',
  objectives: [
    'Write jsonpath expressions with filters (?), comparisons and methods',
    'Use jsonb_path_query / _first / _exists and the @? and @@ operators',
    'Turn JSON into relational rows with JSON_TABLE (PG17+) and extract values with JSON_VALUE / JSON_QUERY',
    'Update documents with jsonb_set, jsonb_insert, ||, -, #- and subscripts',
    'Store and query raw API responses safely'
  ],
  concept: `<p><strong>SQL/JSON path</strong> <span class="tag std">SQL standard</span> (PG12+) is a small query language for JSON, like a <em>GPS route for a document</em>: <code>$.specs.weight_kg</code> says "from the root, go to specs, then weight_kg"; filters such as <code>? (@ &gt; 12)</code> say "only stop where the value is above 12".</p>
<h4>jsonpath essentials</h4>
<ul>
<li><code>$</code> root, <code>.key</code> member, <code>[*]</code> all array elements, <code>[0]</code>, <code>[last]</code>, <code>.**</code> any depth.</li>
<li>Filters: <code>$.items[*] ? (@.qty &gt; 2 &amp;&amp; @.sku starts with "SKU")</code>; <code>@</code> is the current item. Operators: <code>== != &lt; &lt;= &gt; &gt;= &amp;&amp; || !</code>, <code>like_regex</code>, <code>starts with</code>, <code>exists()</code>.</li>
<li>Methods: <code>.size()</code>, <code>.type()</code>, <code>.double()</code>, <code>.keyvalue()</code>, <code>.datetime()</code>; PG17 adds <code>.bigint()</code>, <code>.boolean()</code>, <code>.date()</code>, <code>.decimal()</code>, <code>.integer()</code>, <code>.number()</code>, <code>.string()</code>, <code>.time()</code>, <code>.timestamp()</code> and more.</li>
<li>Variables: <code>jsonb_path_query(doc, '$.x ? (@ &gt; $min)', '{"min": 10}')</code>.</li>
<li><code>lax</code> mode (default) tolerates missing keys and auto-unwraps arrays; <code>strict</code> raises errors on structural mismatches.</li>
</ul>
<h4>Functions and operators</h4>
<ul>
<li><code>jsonb_path_query(doc, path)</code> (set-returning), <code>jsonb_path_query_first</code>, <code>jsonb_path_query_array</code>, <code>jsonb_path_exists</code>, <code>jsonb_path_match</code>.</li>
<li><code>doc @? 'path'</code> — does the path return any item? <code>doc @@ 'predicate'</code> — is the predicate true? Both are GIN-indexable.</li>
</ul>
<h4>SQL/JSON query functions — PostgreSQL 17+</h4>
<ul>
<li><code>JSON_EXISTS(doc, path)</code>, <code>JSON_VALUE(doc, path RETURNING type)</code> (a scalar), <code>JSON_QUERY(doc, path [WITH WRAPPER])</code> (an object/array).</li>
<li><code>JSON_TABLE(doc, path COLUMNS (...))</code> — turns JSON into a relational table in <code>FROM</code>, with typed columns, <code>NESTED PATH</code> for child arrays and <code>FOR ORDINALITY</code>. On PG16 and earlier, use <code>jsonb_to_recordset</code> / <code>jsonb_array_elements</code> instead.</li>
</ul>
<h4>Updating</h4>
<ul>
<li><code>jsonb_set(doc, '{path}', new_value [, create_missing])</code>, <code>jsonb_insert(doc, '{arr,0}', v)</code>, <code>jsonb_set_lax</code> (NULL handling).</li>
<li><code>doc || '{"k": v}'</code> — shallow merge (right side wins, top level only); <code>doc - 'key'</code>, <code>doc - array[...]</code>, <code>arr - 0</code>; <code>doc #- '{a,b}'</code> removes a nested path.</li>
<li>Subscript assignment (PG14+): <code>UPDATE t SET doc['a']['b'] = '1'</code>.</li>
</ul>`,
  why: `<p>Real JSON is nested: orders with line items, API responses with pages of results, configuration trees. Arrow operators get clumsy beyond two levels and cannot filter inside arrays. jsonpath expresses "items where qty &gt; 2" directly, and JSON_TABLE bridges documents into ordinary relational processing. Update functions let you change one field without the application round-tripping and rewriting the whole document.</p>`,
  useCase: `<p>A payments aggregator stores every gateway response (Razorpay, Stripe, PayU) in <code>gateway_responses(payload jsonb)</code> — 25 million rows per month — for reconciliation and disputes. Analysts use <code>JSON_TABLE</code> to flatten <code>payload</code> into (payment_id, amount, status, error_code) rows for daily reports; the dispute tool finds failed attempts with <code>payload @? '$.error ? (@.code == "BAD_REQUEST_ERROR")'</code> using a GIN <code>jsonb_path_ops</code> index; and a nightly job redacts card details with <code>payload #- '{card,number}'</code>.</p>`,
  internals: `<p>jsonpath expressions are parsed into a binary <code>jsonpath</code> value (you can store them in columns). Execution walks the jsonb tree; in lax mode, arrays are unwrapped automatically when a member accessor is applied to them. <code>@?</code> and <code>@@</code> can use GIN indexes (both <code>jsonb_ops</code> and <code>jsonb_path_ops</code>) when the path consists of equality-style conditions the operator class can extract; range filters are rechecked. JSON_TABLE is planned as a table function scan. Any JSONB update — even changing one key — produces a <strong>new complete value</strong>: the row gets a new version, and the whole (possibly TOASTed) document is rewritten and WAL-logged.</p>`,
  whenNot: `<p>Do not use frequent small updates on large JSON documents (counters, timestamps inside a 200 KB document): each update rewrites the whole value and generates proportional WAL. Keep hot, frequently changing fields in columns. JSON_TABLE/JSON_VALUE require PG17; on older versions use the jsonb_* functions. For heavy, ad-hoc analytics over raw JSON event streams, a columnar/OLAP engine may be a better home.</p>`,
  syntax: `jsonb_path_query(doc, 'lax $.items[*] ? (@.qty > $n)', '{"n": 2}')
doc @? '$.items[*] ? (@.sku == "A1")'          -- path returns any item?
doc @@ '$.total > 1000'                         -- predicate true?

JSON_VALUE(doc, '$.a.b' RETURNING numeric [DEFAULT 0 ON EMPTY])     -- PG17+
JSON_QUERY(doc, '$.items' [WITH WRAPPER])                            -- PG17+
JSON_EXISTS(doc, '$.error')                                          -- PG17+
JSON_TABLE(doc, '$.items[*]' COLUMNS (
  n FOR ORDINALITY, sku text PATH '$.sku', qty int PATH '$.qty',
  NESTED PATH '$.discounts[*]' COLUMNS (code text PATH '$.code'))) AS jt

jsonb_set(doc, '{a,b}', '1'::jsonb, true)   jsonb_insert(doc, '{arr,0}', '"x"')
doc || '{"k":"v"}'    doc - 'k'    doc - '{k1,k2}'::text[]    doc #- '{a,b}'
UPDATE t SET doc['a']['b'] = '1';          -- PG14+`,
  examples: [
    { label: 'Basic', title: 'jsonpath queries and the @? / @@ operators',
      sql: `SELECT sku,
       jsonb_path_query_first(attributes, '$.specs.weight_kg')               AS weight,
       jsonb_path_exists(attributes, '$.specs.weight_kg ? (@ > 14)')        AS heavy,
       attributes @@ '$.warranty_months >= 24'                               AS long_warranty,
       jsonb_path_query_first(attributes, '$.brand ? (@ starts with "Or")') AS orbit_brand
FROM products
WHERE attributes @? '$.specs.weight_kg ? (@ > 14)'      -- only heavy products
ORDER BY sku
LIMIT 5;`,
      explain: `<p><code>jsonb_path_query_first</code> returns the first match (or NULL). The filter <code>? (@ &gt; 14)</code> keeps values above 14; <code>@?</code> asks "does this path yield anything?" and <code>@@</code> evaluates a boolean predicate — both are GIN-indexable. <code>starts with</code> is a jsonpath string predicate; for products whose brand does not match, the result is NULL.</p>`,
      output: ` sku      | weight | heavy | long_warranty | orbit_brand
----------+--------+-------+---------------+-------------
 SKU-0007 | 14.1   | t     | f             |
 SKU-0008 | 14.9   | t     | t             |
 SKU-0017 | 14.9   | t     | t             |
 SKU-0025 | 14.4   | t     | f             |
 SKU-0028 | 14.3   | t     | f             |
(5 rows)`, run: true },
    { label: 'Intermediate', title: 'JSON_TABLE, JSON_VALUE and JSON_QUERY (PostgreSQL 17+)',
      sql: `CREATE TABLE api_orders (id int PRIMARY KEY, payload jsonb NOT NULL);
INSERT INTO api_orders VALUES
(1, '{"order_ref":"WEB-1001","customer":{"name":"Asha","city":"Pune"},
      "items":[{"sku":"SKU-0001","qty":2,"price":5004.84},
               {"sku":"SKU-0009","qty":1,"price":4256.97,"discounts":[{"code":"FEST10"}]}]}'),
(2, '{"order_ref":"APP-2002","customer":{"name":"Ravi","city":"Chennai"},
      "items":[{"sku":"SKU-0004","qty":3,"price":35504.07}]}');

SELECT o.id,
       JSON_VALUE(o.payload, '$.customer.city')                    AS city,
       JSON_QUERY(o.payload, '$.items[*].sku' WITH WRAPPER)        AS skus,
       jt.*
FROM api_orders o,
     JSON_TABLE(o.payload, '$.items[*]'
       COLUMNS (
         line      FOR ORDINALITY,
         sku       text          PATH '$.sku',
         qty       int           PATH '$.qty',
         price     numeric(10,2) PATH '$.price',
         NESTED PATH '$.discounts[*]' COLUMNS (discount text PATH '$.code')
       )) AS jt
ORDER BY o.id, jt.line;`,
      explain: `<p><code>JSON_TABLE</code> (PG17+) iterates <code>$.items[*]</code> and produces typed columns per line item; <code>FOR ORDINALITY</code> numbers the lines, and <code>NESTED PATH</code> flattens the optional child array of discounts (NULL when absent). <code>JSON_VALUE</code> extracts a scalar as text by default (use <code>RETURNING</code> for other types); <code>JSON_QUERY ... WITH WRAPPER</code> collects multiple matches into a JSON array. The result is ordinary relational data ready for joins with <code>products</code>.</p>`,
      output: ` id | city    | skus                     | line | sku      | qty | price    | discount
----+---------+--------------------------+------+----------+-----+----------+----------
 1  | Pune    | ["SKU-0001", "SKU-0009"] | 1    | SKU-0001 | 2   | 5004.84  |
 1  | Pune    | ["SKU-0001", "SKU-0009"] | 2    | SKU-0009 | 1   | 4256.97  | FEST10
 2  | Chennai | ["SKU-0004"]             | 1    | SKU-0004 | 3   | 35504.07 |
(3 rows)`, run: true },
    { label: 'Advanced', title: 'Updating documents and redacting an API response',
      sql: `CREATE TABLE gateway_responses (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider    text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL
);

INSERT INTO gateway_responses (provider, payload) VALUES
('payu', '{"txn":"T1","status":"failed","amount":4999,
          "card":{"number":"4111111111111111","network":"VISA"},
          "error":{"code":"BAD_REQUEST_ERROR","retries":0}}');

UPDATE gateway_responses
SET payload = ((jsonb_set(payload, '{error,retries}',                     -- nested set
                          to_jsonb((payload #>> '{error,retries}')::int + 1))
               || '{"reconciled": true}')                                 -- shallow merge
               #- '{card,number}')                                        -- redact PAN
               - 'amount'                                                 -- drop a key
WHERE payload @> '{"txn":"T1"}';

UPDATE gateway_responses SET payload['card']['last4'] = '"1111"';        -- subscript (PG14+)

SELECT payload FROM gateway_responses;     -- jsonb_pretty(payload) for indented output`,
      explain: `<p>One <code>UPDATE</code> chains several modifications: <code>jsonb_set</code> increments a nested counter, <code>||</code> merges a top-level key, <code>#-</code> removes the card number at a nested path, and <code>-</code> drops a top-level key. The parentheses matter: <code>-</code> binds more tightly than <code>||</code> and <code>#-</code>, so without them PostgreSQL would try to evaluate <code>'{card,number}' - 'amount'</code> first and fail with <code>operator is not unique</code>. Then subscript assignment adds <code>card.last4</code>. (<code>jsonb_pretty()</code> would print it indented over several lines.) Remember each of these updates rewrites the entire document — fine for occasional changes, costly for hot counters.</p>`,
      output: ` payload
-----------------------------------------------------------------------------------------------------------------------------------------------------------
 {"txn": "T1", "card": {"last4": "1111", "network": "VISA"}, "error": {"code": "BAD_REQUEST_ERROR", "retries": 1}, "status": "failed", "reconciled": true}
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Read-modify-write in the application: two round trips and a lost-update race
SELECT attributes FROM products WHERE id = 1;          -- app edits JSON in memory...
UPDATE products SET attributes = '{"brand":"Zenit","color":"silver","specs":{"weight_kg":12.4},"warranty_months":36}'
WHERE id = 1;                                           -- ...and overwrites the whole doc`,
      why: 'Two round trips; a concurrent change to another key between SELECT and UPDATE is silently overwritten (lost update).', run: true },
    good: { sql: `UPDATE products
SET attributes = jsonb_set(attributes, '{warranty_months}', '36')
WHERE id = 1
RETURNING attributes -> 'warranty_months' AS warranty;`,
      why: 'An atomic in-database change of a single key: no lost updates of other keys, one round trip.', run: true }
  },
  mistakes: [
    `Expecting <code>||</code> to deep-merge nested objects — it replaces top-level keys entirely: <code>'{"a":{"x":1}}' || '{"a":{"y":2}}'</code> gives <code>{"a":{"y":2}}</code>.`,
    `<code>jsonb_set</code> with a NULL new value returns NULL and wipes the column — use <code>jsonb_set_lax</code> or coalesce.`,
    `Forgetting that <code>jsonb_set</code> does not create intermediate missing objects for deep paths.`,
    `Using JSON_TABLE / JSON_VALUE on PostgreSQL 16 or earlier — they arrived in PG17.`,
    `Using strict mode paths on inconsistent data and getting errors; or lax mode and silently missing data — choose deliberately.`,
    `Storing full card numbers or secrets from API responses; redact before or immediately after storing.`
  ],
  best: [
    `Use <code>@?</code>/<code>@@</code> or <code>@&gt;</code> for filters so GIN indexes apply.`,
    `Pass jsonpath variables via the <code>vars</code> argument instead of concatenating values into the path.`,
    `Update single keys in SQL (<code>jsonb_set</code>, subscripts) to avoid read-modify-write races.`,
    `For API responses, keep metadata (provider, ids, status, received_at) in columns and the raw payload in jsonb.`,
    `Use JSON_TABLE (PG17+) to expose JSON as relational rows for reporting.`
  ],
  performance: `<p>jsonpath evaluation is CPU work per row; with GIN indexes on <code>@?</code>/<code>@@</code>, only candidate rows are evaluated. Updating a document of size S writes ~S bytes of new heap/TOAST data plus WAL, regardless of how small the change is — a 100 KB document updated 10 times per second is ~1 MB/s of WAL from one row. JSON_TABLE over millions of documents in reports is fine in batch jobs but should not sit on the OLTP hot path.</p>`,
  security: `<p>Raw API responses can contain secrets, tokens and personal data. Redact at ingestion (<code>#-</code>, <code>-</code>), restrict access to raw payload tables, and set retention periods. Never build jsonpath strings from user input — use the <code>vars</code> parameter, just as you would bind SQL parameters.</p>`,
  scenario: { title: "WAL volume explodes after a feature launch", steps: [
    "1. Replication lag and WAL generation rise 10x after launching 'last seen' tracking.",
    "2. pg_stat_statements shows UPDATE users SET profile = jsonb_set(profile, '{last_seen}', ...) thousands of times per second.",
    "3. profile documents are ~60 KB: each update rewrites the whole TOASTed value.",
    "4. Move last_seen to its own timestamptz column (HOT-update friendly, no TOAST rewrite).",
    "5. Keep the JSON document for rarely-changing profile data.",
    "6. Verify WAL rate with pg_stat_wal before and after."
  ] },
  interview: [
    { q: 'What is the difference between @? and @@?', a: '@? returns true if the jsonpath expression returns at least one item (existence); @@ evaluates a jsonpath predicate and returns its boolean result. Both can use GIN indexes.' },
    { q: 'How do you change a nested value in a jsonb column without overwriting other keys?', a: 'Use UPDATE ... SET doc = jsonb_set(doc, \'{a,b}\', new_value) or subscript assignment SET doc[\'a\'][\'b\'] = value (PG14+). The change is atomic in the database, avoiding lost updates from application read-modify-write.' },
    { q: 'What does JSON_TABLE do and since which version?', a: 'Since PostgreSQL 17, JSON_TABLE turns JSON into a relational table in FROM: a row path selects items, COLUMNS define typed columns via paths, FOR ORDINALITY numbers rows, and NESTED PATH flattens child arrays.' }
  ],
  exercises: [
    { task: 'Using jsonb_path_query, list every document tag (from metadata.tags) for documents of level "advanced", one row per tag.', solution: `SELECT id, jsonb_path_query(metadata, '$.tags[*]') #>> '{}' AS tag
FROM documents
WHERE metadata @@ '$.level == "advanced"'
ORDER BY id, tag;`, run: true },
    { task: 'Add a "verified": true key to products.attributes of all Acme products and remove the color key from product 2. Show both rows.', solution: `UPDATE products SET attributes = attributes || '{"verified": true}'
WHERE attributes @> '{"brand":"Acme"}';
UPDATE products SET attributes = attributes - 'color' WHERE id = 2;
SELECT id, attributes FROM products WHERE id IN (2, 4) ORDER BY id;`, run: true }
  ],
  challenge: { task: 'Use JSON_TABLE to flatten documents.metadata into (id, author, level, tag) rows (one per tag), then count tags per author for advanced documents.', hint: 'JSON_TABLE(metadata, \'$\' COLUMNS (author text PATH \'$.author\', level text PATH \'$.level\', NESTED PATH \'$.tags[*]\' COLUMNS (tag text PATH \'$\')))', solution: `SELECT jt.author, count(jt.tag) AS tags
FROM documents d,
     JSON_TABLE(d.metadata, '$' COLUMNS (
       author text PATH '$.author',
       level  text PATH '$.level',
       NESTED PATH '$.tags[*]' COLUMNS (tag text PATH '$')
     )) AS jt
WHERE jt.level = 'advanced'
GROUP BY jt.author
ORDER BY tags DESC, jt.author;`, run: true },
  related: ['jsonb-operators', 'jsonb-indexing-design', 'jsonb-json-vs-jsonb', 'arrays'],
  quiz: [
    { type: 'predict', q: 'What does SELECT \'{"a":{"x":1}}\'::jsonb || \'{"a":{"y":2}}\'::jsonb; return?', options: ['{"a": {"x": 1, "y": 2}}', '{"a": {"y": 2}}', '{"a": {"x": 1}}', 'ERROR'], answer: 1, explain: '|| is a shallow merge: the top-level key "a" is replaced entirely.' },
    { type: 'mcq', q: 'Which version introduced JSON_TABLE?', options: ['PostgreSQL 12', 'PostgreSQL 14', 'PostgreSQL 16', 'PostgreSQL 17'], answer: 3, explain: 'JSON_TABLE and the SQL/JSON query functions JSON_VALUE/JSON_QUERY/JSON_EXISTS arrived in PG17.' },
    { type: 'bug', q: 'Why did the whole attributes column become NULL?', code: `UPDATE products SET attributes = jsonb_set(attributes, '{color}', to_jsonb(NULL::text));`, options: ['color does not exist', 'jsonb_set is STRICT: a NULL new value returns NULL', 'Needs create_missing', 'to_jsonb cannot take text'], answer: 1, explain: 'jsonb_set returns NULL if any argument is NULL. Use jsonb_set_lax or \'null\'::jsonb.' },
    { type: 'tf', q: 'Changing one key of a 100 KB jsonb document rewrites the whole document.', answer: true, explain: 'PostgreSQL stores jsonb values atomically; any update creates a new row version with the complete new value.' },
    { type: 'write', q: 'Write a query returning the SKUs of products whose weight_kg is between 10 and 11 using a jsonpath predicate with @@.', solution: `SELECT sku FROM products
WHERE attributes @@ '$.specs.weight_kg >= 10 && $.specs.weight_kg <= 11'
ORDER BY sku;`, explain: '@@ evaluates a boolean jsonpath predicate per row; combine conditions with &&.' }
  ]
},
{
  id: 'jsonb-indexing-design',
  module: 'jsonb',
  title: 'Indexing JSONB and Avoiding JSON Design Pitfalls',
  level: 4,
  minutes: 25,
  summary: 'Choose between GIN jsonb_ops, GIN jsonb_path_ops and expression B-tree indexes for JSONB queries, promote hot keys to generated columns, and avoid the classic pitfalls: EAV-in-JSON, huge documents, TOAST costs and missing statistics.',
  objectives: [
    'Create GIN indexes with jsonb_ops and jsonb_path_ops and know which operators each supports',
    'Index specific keys with expression B-tree indexes for equality, range and sort',
    'Promote frequently used keys to generated columns',
    'Recognise EAV-in-JSON and oversized-document anti-patterns',
    'Understand TOAST and how it affects reading and updating large JSON values'
  ],
  concept: `<p>A JSONB column without an index is a <em>library with no catalogue</em> — every question means walking every shelf. PostgreSQL offers three catalogues, each answering different questions:</p>
<table>
<tr><th>Index</th><th>Supports</th><th>Size / speed</th><th>Use when</th></tr>
<tr><td><code>GIN (doc)</code> — default <code>jsonb_ops</code></td><td><code>@&gt;</code>, <code>?</code>, <code>?|</code>, <code>?&amp;</code>, <code>@?</code>, <code>@@</code></td><td>Indexes every key and value separately; larger</td><td>Ad-hoc filters including key-existence queries</td></tr>
<tr><td><code>GIN (doc jsonb_path_ops)</code></td><td><code>@&gt;</code>, <code>@?</code>, <code>@@</code> (not <code>?</code> operators)</td><td>Indexes hashes of full paths to values; typically 2–3× smaller and faster for containment</td><td>Containment-style filters (facets, "where brand = X and colour = Y")</td></tr>
<tr><td>B-tree on an expression <code>((doc -&gt;&gt; 'k'))</code></td><td><code>=</code>, <code>&lt;</code>, <code>&gt;</code>, <code>BETWEEN</code>, <code>ORDER BY</code>, on that one key</td><td>Small, very fast</td><td>One or two hot keys, range queries, sorting</td></tr>
</table>
<p>The query must match the index: a GIN index is useless for <code>attributes -&gt;&gt; 'brand' = 'Acme'</code>, and an expression index on <code>(attributes -&gt;&gt; 'brand')</code> is useless for <code>attributes @&gt; '{"brand":"Acme"}'</code>. For ranges on numbers, index the <em>cast</em> expression and query with the same cast: <code>((attributes #&gt;&gt; '{specs,weight_kg}')::numeric)</code>.</p>
<h4>Design pitfalls</h4>
<ul>
<li><strong>EAV-in-JSON</strong>: <code>[{"name":"color","value":"black"},{"name":"size","value":"L"}]</code> instead of <code>{"color":"black","size":"L"}</code>. Every lookup becomes an array scan, containment queries get awkward, values lose types. Use keys as keys.</li>
<li><strong>Huge documents</strong>: values over ~2 KB are compressed and moved to the TOAST table in chunks. Reading any key detoasts (decompresses) the whole value; updating any key rewrites the whole value. A 1 MB document read for one field costs 1 MB of I/O and CPU.</li>
<li><strong>Unbounded arrays inside one row</strong> (events, comments, history) — they grow forever and every append rewrites everything; use a child table.</li>
<li><strong>No statistics</strong>: the planner does not know the distribution of keys inside JSON; estimates for <code>@&gt;</code> are guesses. Promote hot keys to columns or create expression statistics.</li>
</ul>`,
  why: `<p>JSONB without the right index degrades to sequential scans as data grows, and poor document design can make even indexed queries slow. Knowing which index serves which operator — and when to move data out of JSON — is what keeps "flexible schema" from turning into "slow, unmaintainable schema".</p>`,
  useCase: `<p>A SaaS CRM stored custom fields as EAV-in-JSON arrays and tenant settings in one 3 MB document per tenant. Filtering contacts by a custom field took 4 seconds (array scans), and every settings change wrote 3 MB of WAL. After migrating custom fields to a flat object with a <code>jsonb_path_ops</code> GIN index, filters ran in 15 ms; splitting settings into one row per module (5–20 KB each) cut WAL from settings updates by 99%. The two most-filtered custom fields were promoted to generated columns with B-tree indexes and extended statistics, fixing several bad join plans.</p>`,
  internals: `<p><code>jsonb_ops</code> creates separate GIN keys for every object key and every scalar value (flagged as key or value); a containment query intersects posting lists for each component and must recheck the structure on the heap. <code>jsonb_path_ops</code> creates one key per <em>leaf</em>, the hash of the path from the root to that value, so <code>@&gt; '{"specs":{"weight_kg":12.4}}'</code> is a single key lookup — more selective and smaller, but it cannot answer "does key X exist" because keys alone are not indexed. GIN maintenance is batched through a pending list (<code>fastupdate</code>, <code>gin_pending_list_limit</code>) to soften write costs. TOAST stores values above <code>TOAST_TUPLE_THRESHOLD</code> (~2 KB) compressed (pglz or lz4 via <code>default_toast_compression</code>/<code>ALTER COLUMN ... SET COMPRESSION lz4</code>) in 2 KB chunks.</p>`,
  whenNot: `<p>Do not GIN-index every JSONB column by reflex: GIN indexes are large and slow down writes. If queries always filter one or two keys, expression B-trees (or generated columns) are smaller and faster. If documents are rarely filtered (only fetched by primary key), no JSON index is needed at all.</p>`,
  syntax: `CREATE INDEX ON t USING gin (doc);                         -- jsonb_ops (default)
CREATE INDEX ON t USING gin (doc jsonb_path_ops);          -- containment / jsonpath only
CREATE INDEX ON t ((doc ->> 'brand'));                     -- expression B-tree
CREATE INDEX ON t (((doc #>> '{specs,weight_kg}')::numeric));
ALTER TABLE t ADD COLUMN brand text GENERATED ALWAYS AS (doc ->> 'brand') STORED;
CREATE STATISTICS s ON ((doc ->> 'brand')) FROM t;         -- PG14+ expression stats
ALTER TABLE t ALTER COLUMN doc SET COMPRESSION lz4;`,
  examples: [
    { label: 'Basic', title: 'GIN index for containment filters',
      sql: `CREATE INDEX products_attributes_gin ON products USING gin (attributes);

SET LOCAL enable_seqscan = off;   -- 100-row demo table: force the planner to show index use

EXPLAIN (COSTS OFF)
SELECT sku, name FROM products
WHERE attributes @> '{"brand":"Acme","color":"black"}';`,
      explain: `<p>The default <code>jsonb_ops</code> GIN index answers the containment filter with a Bitmap Index Scan; the heap recheck confirms structure. On a real table with millions of rows, the planner picks this automatically when the filter is selective. The same index would also serve <code>attributes ? 'specs'</code> and jsonpath <code>@?</code>/<code>@@</code> queries.</p>`,
      output: ` QUERY PLAN
----------------------------------------------------------------------------------
 Bitmap Heap Scan on products
   Recheck Cond: (attributes @> '{"brand": "Acme", "color": "black"}'::jsonb)
   ->  Bitmap Index Scan on products_attributes_gin
         Index Cond: (attributes @> '{"brand": "Acme", "color": "black"}'::jsonb)
(4 rows)`, run: true },
    { label: 'Intermediate', title: 'jsonb_ops vs jsonb_path_ops: size and operator support',
      sql: `-- a bigger synthetic table so index sizes are meaningful
CREATE TABLE events AS
SELECT g AS id,
       jsonb_build_object(
         'type',    (ARRAY['click','view','purchase','signup'])[1 + g % 4],
         'country', (ARRAY['India','USA','UK','Germany','Singapore','UAE'])[1 + g % 6],
         'device',  jsonb_build_object('os', (ARRAY['android','ios','web'])[1 + g % 3],
                                       'version', g % 20),
         'amount',  (g % 500) * 10) AS doc
FROM generate_series(1, 20000) g;

CREATE INDEX events_doc_ops      ON events USING gin (doc);
CREATE INDEX events_doc_path_ops ON events USING gin (doc jsonb_path_ops);

SELECT indexrelid::regclass AS index_name,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_index WHERE indrelid = 'events'::regclass
ORDER BY 1;`,
      explain: `<p>Both indexes cover the same column. <code>jsonb_path_ops</code> stores one hashed entry per leaf path/value instead of separate entries for every key and value, so it is noticeably smaller (see sizes) and usually faster for <code>@&gt;</code>. The trade-off: it cannot serve key-existence operators (<code>?</code>, <code>?|</code>, <code>?&amp;</code>). If your queries are all "document contains these values", choose <code>jsonb_path_ops</code>.</p>`,
      output: ` index_name          | size
---------------------+--------
 events_doc_ops      | 496 kB
 events_doc_path_ops | 304 kB
(2 rows)`, run: true },
    { label: 'Advanced', title: 'Expression B-tree, generated column and expression statistics',
      sql: `-- range filter + sort on a nested numeric key: B-tree on the cast expression
CREATE INDEX products_weight_idx
  ON products (((attributes #>> '{specs,weight_kg}')::numeric));

-- promote a hot key to a real, typed, indexable column
ALTER TABLE products
  ADD COLUMN brand text GENERATED ALWAYS AS (attributes ->> 'brand') STORED;
CREATE INDEX products_brand_idx ON products (brand);

-- give the planner statistics about a JSON expression (PG14+)
CREATE STATISTICS products_color_stats ON ((attributes ->> 'color')) FROM products;
ANALYZE products;

SET LOCAL enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT sku FROM products
WHERE (attributes #>> '{specs,weight_kg}')::numeric BETWEEN 10 AND 11
ORDER BY (attributes #>> '{specs,weight_kg}')::numeric;`,
      explain: `<p>The expression index matches only queries that use the <em>identical</em> expression, here a numeric cast of the nested key — the plan shows <code>Index Cond</code> on <code>products_weight_idx</code> for the <code>BETWEEN</code> range. (For a small range the planner prefers a bitmap scan plus a quick sort; with <code>ORDER BY ... LIMIT n</code> it can instead walk the B-tree in order and skip the sort.) The generated column <code>brand</code> is computed from the JSON on every write, can be indexed and constrained like any column, and gets normal planner statistics. <code>CREATE STATISTICS</code> on an expression (PG14+) gives the planner a value distribution for <code>attributes -&gt;&gt; 'color'</code> without adding a column.</p>`,
      output: ` QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Sort
   Sort Key: (((attributes #>> '{specs,weight_kg}'::text[]))::numeric)
   ->  Bitmap Heap Scan on products
         Recheck Cond: ((((attributes #>> '{specs,weight_kg}'::text[]))::numeric >= '10'::numeric) AND (((attributes #>> '{specs,weight_kg}'::text[]))::numeric <= '11'::numeric))
         ->  Bitmap Index Scan on products_weight_idx
               Index Cond: ((((attributes #>> '{specs,weight_kg}'::text[]))::numeric >= '10'::numeric) AND (((attributes #>> '{specs,weight_kg}'::text[]))::numeric <= '11'::numeric))
(6 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- EAV-in-JSON: attributes as an array of name/value pairs
CREATE TABLE products_eav AS
SELECT id, (SELECT jsonb_agg(jsonb_build_object('name', key, 'value', value))
            FROM jsonb_each(attributes)) AS attrs
FROM products;
SELECT count(*) FROM products_eav
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(attrs) a
              WHERE a ->> 'name' = 'brand' AND a ->> 'value' = 'Acme');`,
      why: 'Every lookup explodes and scans the array; values lose their JSON types; indexes are hard to apply.', run: true },
    good: { sql: `CREATE INDEX ON products USING gin (attributes jsonb_path_ops);
SELECT count(*) FROM products WHERE attributes @> '{"brand":"Acme"}';`,
      why: 'Keys as keys: one containment predicate, served directly by a compact GIN index.', run: true }
  },
  mistakes: [
    `Creating a GIN index and then querying with <code>-&gt;&gt;</code> equality — the GIN index cannot help.`,
    `Creating an expression index on <code>(doc -&gt;&gt; 'weight')</code> and querying <code>(doc -&gt;&gt; 'weight')::numeric &gt; 10</code> — the expressions differ, the index is unused.`,
    `Choosing <code>jsonb_path_ops</code> and then relying on <code>?</code> key-existence queries.`,
    `Storing ever-growing arrays (events, comments) inside one document.`,
    `Multi-megabyte documents updated frequently, causing massive WAL and TOAST churn.`,
    `Modelling attributes as EAV arrays instead of a flat object.`
  ],
  best: [
    `Pick the index by operator: containment → GIN (prefer <code>jsonb_path_ops</code>), existence → <code>jsonb_ops</code>, ranges/sorting on a key → expression B-tree.`,
    `Promote keys used in joins, constraints and frequent filters to generated or real columns.`,
    `Keep documents small and bounded; split by module or move repeating data to child tables.`,
    `Add expression statistics for JSON keys used in selective filters.`,
    `Consider <code>lz4</code> TOAST compression for large JSON columns (faster than pglz).`
  ],
  performance: `<p>GIN lookups for selective containment queries are typically sub-millisecond to a few milliseconds; index size is often 30–100% of the table's JSON data for <code>jsonb_ops</code> and noticeably less for <code>jsonb_path_ops</code>. GIN writes are deferred via the pending list, which makes inserts cheaper but can make the first query after a burst slower (it must scan the pending list) — autovacuum or <code>gin_clean_pending_list()</code> flushes it. Reading one key from a TOASTed document decompresses the whole document; if most queries read only small fields, keep them in columns so the large JSON is not touched.</p>`,
  security: `<p>Indexes on JSON keys expose nothing extra to users, but generated columns copied out of JSON become first-class columns — include them in column-level grants and masking policies. Large JSON documents from untrusted sources can be used for resource exhaustion (deep nesting, huge arrays); limit payload size at the API layer.</p>`,
  scenario: { title: 'Facet filters on 5M products are slow after launch', steps: [
    '1. EXPLAIN ANALYZE shows Seq Scan with Filter: ((attributes ->> \'brand\') = \'Acme\') AND ((attributes ->> \'color\') = \'black\').',
    '2. Rewrite filters as attributes @> \'{"brand":"Acme","color":"black"}\'.',
    '3. CREATE INDEX CONCURRENTLY ... USING gin (attributes jsonb_path_ops).',
    '4. For the price-like numeric range on specs, add an expression B-tree on the cast and match it exactly in queries.',
    '5. Add CREATE STATISTICS on hot JSON expressions; ANALYZE; recheck join plans.',
    '6. Promote brand to a generated column if it is also used for joins or sorting.'
  ] },
  interview: [
    { q: 'jsonb_ops vs jsonb_path_ops?', a: 'jsonb_ops indexes each key and value separately and supports @>, ?, ?|, ?&, @? and @@. jsonb_path_ops indexes hashes of complete paths to values, is smaller and faster for containment and jsonpath queries, but does not support the key-existence operators.' },
    { q: 'How do you index a numeric range query on a JSON key?', a: 'Create a B-tree expression index on the cast expression, e.g. ((doc #>> \'{specs,weight_kg}\')::numeric), and write queries with exactly the same expression so the planner can match it; or promote the key to a generated column and index that.' },
    { q: 'Why are huge JSON documents a problem?', a: 'Values above ~2 KB are TOASTed: compressed and chunked. Reading any key requires detoasting the whole value, and any update rewrites the full value with corresponding WAL. Large, frequently updated documents cause high I/O, WAL volume and bloat.' },
    { q: 'What is EAV-in-JSON and why avoid it?', a: 'Storing attributes as an array of {name, value} objects instead of a key/value object. It prevents direct key access and simple containment, forces array scans, loses value types and makes indexing ineffective.' }
  ],
  exercises: [
    { task: 'Create a jsonb_path_ops GIN index on documents.metadata and use EXPLAIN (with seqscan disabled) to show it serves metadata @> \'{"level":"advanced"}\'.', solution: `CREATE INDEX documents_metadata_gin ON documents USING gin (metadata jsonb_path_ops);
SET LOCAL enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT id, title FROM documents WHERE metadata @> '{"level":"advanced"}';`, run: true },
    { task: 'Add a generated column warranty_months int extracted from products.attributes, index it and count products with warranty >= 12 using the new column.', solution: `ALTER TABLE products
  ADD COLUMN warranty_months int GENERATED ALWAYS AS ((attributes ->> 'warranty_months')::int) STORED;
CREATE INDEX ON products (warranty_months);
SELECT count(*) FROM products WHERE warranty_months >= 12;`, run: true }
  ],
  challenge: { task: 'On the synthetic events table from the Intermediate example, compare EXPLAIN ANALYZE timings for doc @> \'{"type":"purchase","country":"India"}\' using (a) no index, (b) a jsonb_path_ops GIN index. Report rows found.', hint: 'Run EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) before and after CREATE INDEX; check "Rows Removed by Filter" vs "Bitmap Index Scan".', solution: `CREATE TABLE events AS
SELECT g AS id,
       jsonb_build_object('type', (ARRAY['click','view','purchase','signup'])[1 + g % 4],
                          'country', (ARRAY['India','USA','UK','Germany','Singapore','UAE'])[1 + g % 6]) AS doc
FROM generate_series(1, 20000) g;
ANALYZE events;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT count(*) FROM events WHERE doc @> '{"type":"purchase","country":"India"}';
CREATE INDEX ON events USING gin (doc jsonb_path_ops);
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT count(*) FROM events WHERE doc @> '{"type":"purchase","country":"India"}';`, run: true },
  related: ['jsonb-operators', 'jsonb-path-and-updates', 'indexes', 'advanced-indexing', 'arrays-unnest-agg'],
  quiz: [
    { type: 'index', q: 'Queries: WHERE attributes @> \'{"brand":"Acme","color":"black"}\' only. Which index is best?', options: ['B-tree on attributes', 'GIN (attributes jsonb_path_ops)', 'GIN (attributes) jsonb_ops', 'Hash on attributes'], answer: 1, explain: 'For pure containment queries jsonb_path_ops is smaller and faster.' },
    { type: 'tf', q: 'A jsonb_path_ops GIN index can answer WHERE attributes ? \'specs\'.', answer: false, explain: 'jsonb_path_ops does not support the key-existence operators ?, ?| and ?&.' },
    { type: 'bug', q: 'Why is the index not used?', code: `CREATE INDEX ON products ((attributes ->> 'warranty_months'));
SELECT * FROM products WHERE (attributes ->> 'warranty_months')::int > 12;`, options: ['B-tree cannot index JSON', 'The query expression includes ::int, so it does not match the indexed expression', 'Needs GIN', 'Needs ANALYZE'], answer: 1, explain: 'Index ((attributes ->> \'warranty_months\')::int) instead, or query the same text expression.' },
    { type: 'design', q: 'Each tenant has one 3 MB settings document updated several times per minute. Main problem?', options: ['GIN index size', 'Every update rewrites 3 MB (TOAST + WAL)', 'jsonb cannot exceed 1 MB', 'Key order lost'], answer: 1, explain: 'Any change rewrites the full TOASTed value; split the document into smaller rows.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: arrays
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'arrays-basics',
  module: 'arrays',
  title: 'Array Types, Literals, Indexing and Operators',
  level: 3,
  minutes: 20,
  summary: 'Declare and build arrays, read elements and slices (1-based!), test membership with ANY/ALL and the @> <@ && operators, and use array functions such as array_length, cardinality, array_position, array_append and array_remove.',
  objectives: [
    'Declare array columns and write array literals with ARRAY[...] and \'{...}\'',
    'Access elements and slices, remembering arrays are 1-based',
    'Use @>, <@, && and || on arrays',
    'Filter with = ANY(array) and <> ALL(array) correctly, including NULL behaviour',
    'Use array_length, cardinality, array_position, array_append, array_remove and array_to_string'
  ],
  concept: `<p>Any PostgreSQL type can be an array: <code>text[]</code>, <code>int[]</code>, <code>numeric[][]</code>. An array column stores an <em>ordered list of values of one type inside a single row</em>. Analogy: a <em>pill organiser</em> — one box (row) with numbered compartments (elements); you can ask "what is in compartment 2?", "is there an aspirin anywhere?", or "do these two organisers share any pill?".</p>
<h4>Building arrays</h4>
<ul>
<li><code>ARRAY['new', 'sale']</code> — constructor with typed elements.</li>
<li><code>'{new,sale}'::text[]</code> — literal syntax; quote elements containing commas, spaces or braces: <code>'{"a b","c,d"}'</code>.</li>
<li><code>ARRAY(SELECT ...)</code> — build from a subquery; <code>array_agg(x)</code> — aggregate (next lesson).</li>
</ul>
<h4>Accessing</h4>
<ul>
<li>Arrays are <strong>1-based</strong>: <code>tags[1]</code> is the first element. Out-of-range subscripts return NULL rather than an error.</li>
<li>Slices: <code>tags[1:2]</code>, <code>tags[2:]</code>, <code>tags[:1]</code> return arrays.</li>
<li><code>cardinality(a)</code> — total number of elements (0 for empty). <code>array_length(a, 1)</code> — length of dimension 1, but <strong>NULL for an empty array</strong>.</li>
<li><code>array_position(a, x)</code>, <code>array_positions(a, x)</code>, <code>array_to_string(a, ', ')</code>, <code>string_to_array(s, ',')</code>.</li>
</ul>
<h4>Operators</h4>
<table>
<tr><th>Operator</th><th>Meaning</th><th>Example</th></tr>
<tr><td><code>@&gt;</code></td><td>contains all elements of</td><td><code>tags @&gt; ARRAY['office']</code></td></tr>
<tr><td><code>&lt;@</code></td><td>is contained by</td><td><code>tags &lt;@ ARRAY['new','sale','office']</code></td></tr>
<tr><td><code>&amp;&amp;</code></td><td>overlaps (any element in common)</td><td><code>tags &amp;&amp; ARRAY['sale','clearance']</code></td></tr>
<tr><td><code>||</code></td><td>concatenate arrays or append/prepend an element</td><td><code>tags || 'featured'</code></td></tr>
<tr><td><code>= ANY(arr)</code></td><td>value equals at least one element</td><td><code>'sale' = ANY(tags)</code></td></tr>
<tr><td><code>op ALL(arr)</code></td><td>comparison true for every element</td><td><code>price &gt; ALL(ARRAY[100, 200])</code></td></tr>
</table>`,
  why: `<p>Some data really is a small, ordered list that belongs to its row: tags on a product, the days of week a store opens, the top-3 recommendation ids cached for a user, a vector of numeric readings. Arrays keep such lists with the row (no join), and PostgreSQL's operators let you query them expressively. <code>= ANY($1)</code> with an array parameter is also the standard way to pass a variable-length list of ids from an application in one bind parameter.</p>`,
  useCase: `<p>A content platform tags 8 million articles with up to 10 tags each. Queries such as "articles tagged both <code>postgres</code> and <code>performance</code>" (<code>tags @&gt; ARRAY['postgres','performance']</code>) and "anything tagged <code>ai</code> or <code>ml</code>" (<code>tags &amp;&amp; ARRAY['ai','ml']</code>) run in milliseconds with a GIN index on <code>tags</code>. The API fetches a page of articles by ids with <code>WHERE id = ANY($1::bigint[])</code>, a single prepared statement for any page size instead of building <code>IN (?, ?, ...)</code> lists of variable length.</p>`,
  internals: `<p>An array value is stored as a varlena with a header (number of dimensions, element type OID, flags for NULLs), the dimension sizes and lower bounds, an optional NULL bitmap, then the elements packed contiguously. Large arrays are TOASTed like any varlena, so reading one element of a huge array may decompress the whole thing, and updating one element rewrites the whole array. Arrays can have non-1 lower bounds (<code>'[0:2]={a,b,c}'</code>) — rare but possible, which is why <code>array_lower</code>/<code>array_upper</code> exist. Multi-dimensional arrays must be rectangular.</p>`,
  whenNot: `<p>If the list elements are entities with their own attributes, need foreign keys, or are queried from the other side ("which products have tag X, and what is tag X's description?"), use a junction table — the next lesson covers this trade-off. Avoid arrays that grow without bound (event histories): every append rewrites the array.</p>`,
  syntax: `col text[]                          col int[] NOT NULL DEFAULT '{}'
ARRAY['a', 'b']                     '{a,b}'::text[]          ARRAY(SELECT ...)
arr[1]   arr[1:2]   arr[2:]         cardinality(arr)   array_length(arr, 1)
a @> b   a <@ b   a && b   a || b   a || elem   elem || a
x = ANY(arr)    x <> ALL(arr)
array_position(arr, x)  array_append(arr, x)  array_remove(arr, x)  array_replace(arr, x, y)
array_to_string(arr, ',')   string_to_array('a,b', ',')`,
  examples: [
    { label: 'Basic', title: 'Literals, 1-based indexing, slices and length functions',
      sql: `SELECT sku,
       tags,
       tags[1]                 AS first_tag,
       tags[2]                 AS second_tag,      -- NULL when missing, no error
       tags[1:1]               AS first_as_array,  -- slices return arrays
       cardinality(tags)       AS n_tags,
       array_length(tags, 1)   AS len_dim1,
       array_to_string(tags, ' | ') AS joined
FROM products
WHERE id IN (1, 2, 3)
ORDER BY id;

-- empty arrays: the classic difference
SELECT cardinality('{}'::text[]) AS cardinality_empty,
       array_length('{}'::text[], 1) AS array_length_empty;`,
      explain: `<p><code>tags[1]</code> is the first element (arrays are 1-based); a missing element such as <code>tags[2]</code> on a one-element array returns NULL. Slices like <code>tags[1:1]</code> return an array. <code>cardinality</code> counts all elements; <code>array_length(tags, 1)</code> gives the size of dimension 1. The second query (shown) highlights the trap: for an empty array <code>cardinality</code> is 0 but <code>array_length</code> is NULL — so <code>WHERE array_length(tags, 1) = 0</code> never matches.</p>`,
      output: ` cardinality_empty | array_length_empty
-------------------+--------------------
 0                 |
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Containment, overlap and ANY/ALL filters',
      sql: `SELECT
  count(*) FILTER (WHERE tags @> ARRAY['office'])                   AS has_office,
  count(*) FILTER (WHERE tags @> ARRAY['office', 'sale'])           AS office_and_sale,
  count(*) FILTER (WHERE tags && ARRAY['sale', 'bestseller'])       AS sale_or_bestseller,
  count(*) FILTER (WHERE tags <@ ARRAY['new', 'sale', 'office'])    AS only_known_tags,
  count(*) FILTER (WHERE 'new' = ANY (tags))                        AS any_new,
  count(*) FILTER (WHERE price > ALL (ARRAY[50000, 60000]))         AS above_all_thresholds,
  count(*) FILTER (WHERE category = ANY (ARRAY['audio', 'video']))  AS audio_or_video
FROM products;`,
      explain: `<p><code>@&gt;</code> requires all listed tags, <code>&amp;&amp;</code> any of them, <code>&lt;@</code> that the row's tags are a subset of a whitelist. <code>'new' = ANY(tags)</code> is element membership (equivalent to <code>tags @&gt; ARRAY['new']</code> but not GIN-indexable on <code>tags</code> in that form). <code>price &gt; ALL(ARRAY[...])</code> compares against every element. <code>category = ANY(ARRAY[...])</code> is how applications pass a variable list as one parameter: <code>WHERE category = ANY($1)</code>.</p>`,
      output: ` has_office | office_and_sale | sale_or_bestseller | only_known_tags | any_new | above_all_thresholds | audio_or_video
------------+-----------------+--------------------+-----------------+---------+----------------------+----------------
 66         | 33              | 66                 | 67              | 34      | 26                   | 20
(1 row)`, run: true },
    { label: 'Advanced', title: 'Modifying arrays and NULL pitfalls with ANY/ALL',
      sql: `-- modify tags in place
UPDATE products
SET tags = array_append(array_remove(tags, 'sale'), 'clearance')
WHERE id = 2
RETURNING sku, tags;

UPDATE products
SET tags = CASE WHEN 'featured' = ANY (tags) THEN tags ELSE tags || 'featured'::text END
WHERE id IN (1, 4);

SELECT sku, tags, array_position(tags, 'featured') AS featured_pos
FROM products WHERE id IN (1, 2, 4) ORDER BY id;

-- NULL semantics: NOT IN / <> ALL with a NULL element is never true
SELECT 'x' <> ALL (ARRAY['a', 'b'])       AS no_nulls,
       'x' <> ALL (ARRAY['a', NULL])      AS with_null,     -- NULL, not true!
       'a' = ANY (ARRAY['a', NULL])       AS any_found,
       'x' = ANY (ARRAY['a', NULL])       AS any_not_found; -- NULL, not false`,
      explain: `<p><code>array_remove</code> removes all occurrences, <code>array_append</code> adds at the end, <code>|| 'featured'::text</code> also appends (the cast avoids ambiguity between element and array concatenation). The guard <code>'featured' = ANY(tags)</code> prevents duplicates. The last query shows three-valued logic: if the array contains a NULL, <code>&lt;&gt; ALL</code> can only be false or NULL and <code>= ANY</code> can only be true or NULL — exactly the same trap as <code>NOT IN</code> with NULLs. Strip NULLs (<code>array_remove(arr, NULL)</code>) before such tests.</p>`,
      output: ` no_nulls | with_null | any_found | any_not_found
----------+-----------+-----------+---------------
 t        |           | t         |
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Tags in a comma-separated string: no types, no operators, fragile LIKE matching
SELECT count(*) FROM products
WHERE array_to_string(tags, ',') LIKE '%sale%';   -- would also match "wholesale"`,
      why: 'String matching on delimited lists gives false positives (sale vs wholesale), cannot use array operators or GIN indexes, and breaks on delimiters inside values.', run: true },
    good: { sql: `SELECT count(*) FROM products WHERE tags @> ARRAY['sale'];`,
      why: 'Exact element semantics, GIN-indexable, no delimiter problems.', run: true }
  },
  mistakes: [
    `Assuming arrays are 0-based like most programming languages: <code>tags[0]</code> returns NULL.`,
    `Using <code>array_length(a, 1) = 0</code> to find empty arrays — it is NULL for empty arrays; use <code>cardinality(a) = 0</code> or <code>a = '{}'</code>.`,
    `Writing <code>WHERE tags = 'sale'</code> or <code>'sale' IN tags</code>; use <code>'sale' = ANY(tags)</code> or <code>tags @&gt; '{sale}'</code>.`,
    `Forgetting that <code>&lt;&gt; ALL</code> and <code>NOT IN</code> become NULL when the list contains NULL.`,
    `Building <code>IN (...)</code> strings in application code instead of passing one array parameter with <code>= ANY($1)</code>.`
  ],
  best: [
    `Use <code>NOT NULL DEFAULT '{}'</code> for array columns so "no tags" is an empty array, not NULL.`,
    `Prefer <code>@&gt;</code>/<code>&amp;&amp;</code> for filters you want to index with GIN.`,
    `Pass variable-length id lists as a single array parameter: <code>WHERE id = ANY($1::bigint[])</code>.`,
    `Keep arrays short and bounded; use child tables for growing lists.`,
    `Use <code>cardinality()</code> for counts.`
  ],
  performance: `<p>Array operators are evaluated per row; without an index, <code>tags @&gt; ...</code> scans the table. A GIN index on the array column makes <code>@&gt;</code>, <code>&lt;@</code>, <code>&amp;&amp;</code> and <code>=</code> fast (next lesson). <code>= ANY($1)</code> with an array parameter on an indexed column becomes an index scan with <code>Index Cond: (id = ANY (...))</code> — efficient for up to thousands of values. Large arrays (thousands of elements) are TOASTed, and every element change rewrites the whole value.</p>`,
  security: `<p>Passing lists as array parameters (<code>= ANY($1)</code>) instead of string-building <code>IN</code> lists removes a common source of SQL injection. Validate array sizes from clients — a 10-million-element array parameter is a cheap denial-of-service.</p>`,
  scenario: { title: "A filter silently returns nothing for empty tag lists", steps: [
    "1. Report 'products without tags' is always empty.",
    "2. The query uses WHERE array_length(tags, 1) = 0, which is NULL for empty arrays.",
    "3. Replace with cardinality(tags) = 0 or tags = '{}'.",
    "4. Make the column NOT NULL DEFAULT '{}' so NULL and empty are not mixed.",
    "5. Replace application-built IN lists with = ANY($1) array parameters.",
    "6. Add a GIN index if tag filters run on large tables."
  ] },
  interview: [
    { q: 'Are PostgreSQL arrays 0- or 1-based?', a: '1-based by default; arr[1] is the first element. Out-of-range subscripts return NULL. Arrays can even have custom lower bounds, so array_lower/array_upper exist for generic code.' },
    { q: 'cardinality vs array_length?', a: 'cardinality returns the total number of elements across all dimensions and 0 for an empty array; array_length(arr, dim) returns the length of one dimension and NULL for an empty array.' },
    { q: 'How do you pass a variable list of ids to a prepared statement?', a: 'Bind one array parameter and use WHERE id = ANY($1::bigint[]). It works for any list length with a single plan and avoids string-building IN lists.' },
    { q: 'Difference between @> and &&?', a: '@> (contains) is true when the left array includes all elements of the right; && (overlaps) is true when they share at least one element.' }
  ],
  exercises: [
    { task: 'List the distinct tag combinations in products with how many products use each, sorted by count.', solution: `SELECT tags, count(*) FROM products GROUP BY tags ORDER BY count(*) DESC;`, run: true },
    { task: 'Find products tagged "office" but not "sale", using array operators only.', solution: `SELECT sku, tags FROM products
WHERE tags @> ARRAY['office'] AND NOT tags @> ARRAY['sale']
ORDER BY id LIMIT 5;`, run: true }
  ],
  challenge: { task: 'Add a column opening_days smallint[] to departments, set Engineering to Monday–Friday (1..5) and Support to every day (1..7) using ARRAY(SELECT generate_series(...)), then list departments open on Saturday (6) and how many days each opens.', hint: 'ARRAY(SELECT generate_series(1,5))::smallint[]; filter with 6 = ANY(opening_days).', solution: `ALTER TABLE departments ADD COLUMN opening_days smallint[] NOT NULL DEFAULT '{}';
UPDATE departments SET opening_days = ARRAY(SELECT generate_series(1, 5))::smallint[] WHERE name = 'Engineering';
UPDATE departments SET opening_days = ARRAY(SELECT generate_series(1, 7))::smallint[] WHERE name = 'Support';
SELECT name, opening_days, cardinality(opening_days) AS days_open,
       6 = ANY (opening_days) AS open_saturday
FROM departments
WHERE cardinality(opening_days) > 0
ORDER BY name;`, run: true },
  related: ['arrays-unnest-agg', 'jsonb-operators', 'data-types', 'indexes'],
  quiz: [
    { type: 'predict', q: 'What does SELECT (ARRAY[\'a\',\'b\',\'c\'])[0]; return?', options: ['a', 'NULL', 'ERROR', 'c'], answer: 1, explain: 'Arrays are 1-based; index 0 is out of range and returns NULL.' },
    { type: 'predict', q: 'What does SELECT array_length(\'{}\'::int[], 1); return?', options: ['0', 'NULL', '1', 'ERROR'], answer: 1, explain: 'array_length returns NULL for empty arrays; cardinality returns 0.' },
    { type: 'mcq', q: 'Which operator is true when two arrays share at least one element?', options: ['@>', '<@', '&&', '||'], answer: 2, explain: '&& is overlap.' },
    { type: 'tf', q: '\'x\' <> ALL (ARRAY[\'a\', NULL]) returns true.', answer: false, explain: 'It returns NULL because the comparison with NULL is unknown.' }
  ]
},
{
  id: 'arrays-unnest-agg',
  module: 'arrays',
  title: 'UNNEST, ARRAY_AGG, GIN Indexes on Arrays — and When Arrays Are an Anti-pattern',
  level: 3,
  minutes: 22,
  summary: 'Convert arrays to rows with UNNEST (WITH ORDINALITY) and rows to arrays with ARRAY_AGG, index array columns with GIN for @>, && and <@, and decide between an array column and a junction table.',
  objectives: [
    'Expand arrays into rows with UNNEST and keep positions with WITH ORDINALITY',
    'Unnest several arrays in parallel',
    'Aggregate rows into arrays with ARRAY_AGG (ORDER BY, DISTINCT, FILTER)',
    'Create and use GIN indexes for array containment and overlap',
    'Choose between arrays and a normalised junction table'
  ],
  concept: `<p><code>UNNEST</code> and <code>ARRAY_AGG</code> are inverse operations — like <em>unpacking a suitcase onto the bed</em> (each item becomes a separate row you can sort and count) and <em>packing it again</em> (rows folded back into one list).</p>
<ul>
<li><code>unnest(arr)</code> — set-returning function: one row per element. Use it in <code>FROM</code> (implicitly LATERAL): <code>FROM products p, unnest(p.tags) AS t(tag)</code>.</li>
<li><code>WITH ORDINALITY</code> — adds the element's position (bigint, starting at 1): <code>unnest(tags) WITH ORDINALITY AS t(tag, pos)</code>.</li>
<li><code>unnest(a, b)</code> in <code>FROM</code> — zips multiple arrays in parallel, padding shorter ones with NULLs.</li>
<li><code>array_agg(expr [ORDER BY ...])</code> — aggregates values into an array; combine with <code>DISTINCT</code> and <code>FILTER (WHERE ...)</code>. <code>array_agg</code> of arrays builds a 2-D array.</li>
</ul>
<h4>GIN indexes on arrays</h4>
<p><code>CREATE INDEX ON products USING gin (tags)</code> (operator class <code>array_ops</code>) indexes every element, making <code>@&gt;</code>, <code>&lt;@</code>, <code>&amp;&amp;</code> and <code>=</code> fast. Note: <code>'x' = ANY(tags)</code> is <em>not</em> served by this index — rewrite it as <code>tags @&gt; ARRAY['x']</code>.</p>
<h4>Arrays vs junction tables</h4>
<table>
<tr><th>Need</th><th>Array column</th><th>Junction table</th></tr>
<tr><td>Foreign key integrity of elements</td><td>Not possible</td><td>Yes</td></tr>
<tr><td>Attributes per relationship (role, since, allocation)</td><td>No</td><td>Yes (like <code>employee_projects.role</code>)</td></tr>
<tr><td>Query from the element side ("all products with tag X" + tag metadata)</td><td>GIN index, but no tag table</td><td>Natural joins</td></tr>
<tr><td>Read the whole list with the row</td><td>Free, no join</td><td>Join / aggregation needed</td></tr>
<tr><td>Frequent single-element changes under concurrency</td><td>Row rewrite, lost-update risk</td><td>Insert/delete one row</td></tr>
<tr><td>Size</td><td>Small, bounded</td><td>Any</td></tr>
</table>`,
  why: `<p>Arrays are convenient but sit awkwardly between relational and document modelling. UNNEST lets you apply full SQL (joins, GROUP BY, window functions) to array contents; ARRAY_AGG builds compact results for APIs and reports. Knowing when to <em>not</em> use arrays prevents the most common modelling regret — discovering a year later that tags needed descriptions, translations and referential integrity.</p>`,
  useCase: `<p>A recruitment platform stored candidate skills as <code>text[]</code>. Search (<code>skills @&gt; ARRAY['postgresql','python']</code>) with a GIN index was fast, but problems appeared: "PostgreSQL", "postgres" and "Postgres" were all different skills; recruiters wanted skill levels and years; and renaming a skill meant rewriting 2 million rows. They migrated to <code>skills(id, name UNIQUE)</code> and <code>candidate_skills(candidate_id, skill_id, level, years)</code> with <code>INSERT ... SELECT ... FROM candidates, unnest(skills)</code>, and kept a denormalised <code>skill_ids int[]</code> with GIN for the hot search path, rebuilt with <code>array_agg</code> by a trigger.</p>`,
  internals: `<p><code>unnest</code> is a set-returning function; in <code>FROM</code> it executes as a Function Scan per outer row (via LATERAL). The planner estimates 10 rows per unnest call by default (support functions improve this for some cases). <code>array_agg</code> accumulates values in memory per group; very large groups can consume significant memory. The GIN <code>array_ops</code> class stores each distinct element as a key with a posting list of rows; an <code>@&gt;</code> query intersects posting lists of its elements, <code>&amp;&amp;</code> unions them. NULL elements are not indexed in a way that lets GIN answer queries about NULL.</p>`,
  whenNot: `<p>Do not use arrays to model many-to-many relationships between entities that need integrity or relationship attributes (like employees and projects — <code>company_db</code> correctly uses <code>employee_projects</code>). Do not use arrays as queues or growing logs. Avoid <code>array_agg</code> over millions of rows into one array for an API response — paginate instead.</p>`,
  syntax: `SELECT ... FROM t, unnest(t.arr) AS u(elem);
SELECT ... FROM t, unnest(t.arr) WITH ORDINALITY AS u(elem, pos);
SELECT * FROM unnest(ARRAY[1,2,3], ARRAY['a','b']) AS z(n, s);

array_agg(expr [ORDER BY ...]) [FILTER (WHERE ...)]
array_agg(DISTINCT expr)

CREATE INDEX ON t USING gin (arr);      -- @> <@ && =`,
  examples: [
    { label: 'Basic', title: 'UNNEST with ORDINALITY: tag statistics',
      sql: `-- each product's tags as rows, with their position in the array
SELECT p.sku, t.tag, t.pos
FROM products p,
     unnest(p.tags) WITH ORDINALITY AS t(tag, pos)
WHERE p.id IN (2, 3)
ORDER BY p.id, t.pos;

-- how popular is each tag, and how often is it listed first?
SELECT t.tag,
       count(*)                          AS products,
       count(*) FILTER (WHERE t.pos = 1) AS listed_first
FROM products p, unnest(p.tags) WITH ORDINALITY AS t(tag, pos)
GROUP BY t.tag
ORDER BY products DESC;`,
      explain: `<p><code>unnest</code> in <code>FROM</code> runs once per product (implicit LATERAL) and returns one row per tag. <code>WITH ORDINALITY</code> adds the 1-based position. Once tags are rows, ordinary <code>GROUP BY</code> and <code>FILTER</code> answer questions like "how many products carry each tag" (second query shown). Products with an empty tag array produce no rows — use <code>LEFT JOIN LATERAL unnest(...) ON true</code> to keep them.</p>`,
      output: ` tag        | products | listed_first
------------+----------+--------------
 office     | 66       | 33
 new        | 34       | 34
 bestseller | 33       | 33
 sale       | 33       | 0
(4 rows)`, run: true },
    { label: 'Intermediate', title: 'ARRAY_AGG with ORDER BY, DISTINCT and FILTER',
      sql: `SELECT d.name AS department,
       array_agg(e.first_name ORDER BY e.salary DESC)
         FILTER (WHERE e.salary > 150000)                    AS top_earners,
       array_agg(DISTINCT e.job_title ORDER BY e.job_title)  AS titles,
       (array_agg(e.email ORDER BY e.hire_date))[1:2]        AS two_longest_serving
FROM departments d
JOIN employees e ON e.department_id = d.id
WHERE d.id IN (1, 2, 3)
GROUP BY d.name
ORDER BY d.name;`,
      explain: `<p><code>array_agg(... ORDER BY ...)</code> controls element order; <code>FILTER</code> restricts which rows contribute (departments with no match yield NULL, not an empty array); <code>DISTINCT</code> removes duplicates (with DISTINCT, the ORDER BY must use the same expression). Slicing the aggregated array (<code>[1:2]</code>) is a compact "top N per group" for small groups.</p>`,
      output: ` department  | top_earners | titles                                                        | two_longest_serving
-------------+-------------+---------------------------------------------------------------+------------------------------------------------------
 Engineering | {Asha}      | {Analyst,Engineer,"Head of Department",Lead}                  | {asha.rao1@company.com,aarav.sharma120@company.com}
 Marketing   | {Meera}     | {Analyst,Engineer,"Head of Department",Lead}                  | {meera.iyer3@company.com,karan.verma178@company.com}
 Sales       | {Rohan}     | {Associate,"Head of Department","Senior Engineer",Specialist} | {rohan.mehta2@company.com,tara.verma193@company.com}
(3 rows)`, run: true },
    { label: 'Advanced', title: 'GIN index on tags, and migrating to a junction table',
      sql: `CREATE INDEX products_tags_gin ON products USING gin (tags);

SET LOCAL enable_seqscan = off;   -- 100-row demo table: make index usage visible
EXPLAIN (COSTS OFF)
SELECT sku FROM products WHERE tags && ARRAY['sale', 'bestseller'];
RESET enable_seqscan;

-- normalise: tags become entities with integrity and metadata
CREATE TABLE tags (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE NOT NULL);
CREATE TABLE product_tags (
  product_id int REFERENCES products(id) ON DELETE CASCADE,
  tag_id     int REFERENCES tags(id),
  position   int NOT NULL,
  PRIMARY KEY (product_id, tag_id)
);

INSERT INTO tags (name)
SELECT DISTINCT unnest(tags) FROM products ORDER BY 1;

INSERT INTO product_tags (product_id, tag_id, position)
SELECT p.id, t.id, u.pos
FROM products p
CROSS JOIN LATERAL unnest(p.tags) WITH ORDINALITY AS u(name, pos)
JOIN tags t ON t.name = u.name;

-- the array can always be rebuilt from the junction table
SELECT p.sku, array_agg(t.name ORDER BY pt.position) AS rebuilt_tags,
       p.tags = array_agg(t.name ORDER BY pt.position) AS identical
FROM products p
JOIN product_tags pt ON pt.product_id = p.id
JOIN tags t ON t.id = pt.tag_id
WHERE p.id <= 3
GROUP BY p.id, p.sku, p.tags
ORDER BY p.id;`,
      explain: `<p>The GIN index serves the overlap query (<code>Bitmap Index Scan on products_tags_gin</code> in the plan, not shown). The migration then creates a <code>tags</code> table from the distinct array elements and a <code>product_tags</code> junction table, preserving the original order via <code>WITH ORDINALITY</code>. The final query proves nothing was lost: <code>array_agg(... ORDER BY position)</code> rebuilds exactly the original arrays. From here tags can have descriptions, foreign-key integrity and safe renames.</p>`,
      output: ` sku      | rebuilt_tags        | identical
----------+---------------------+-----------
 SKU-0001 | {new}               | t
 SKU-0002 | {office,sale}       | t
 SKU-0003 | {bestseller,office} | t
(3 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Many-to-many with attributes squeezed into parallel arrays
CREATE TABLE emp_projects_arr AS
SELECT employee_id, array_agg(project_id ORDER BY project_id) AS project_ids,
       array_agg(role ORDER BY project_id) AS roles
FROM employee_projects GROUP BY employee_id;
SELECT count(*) FROM emp_projects_arr WHERE project_ids @> ARRAY[5];`,
      why: 'Parallel arrays drift out of sync, element ids have no foreign keys, and updating one assignment rewrites the whole row.', run: true },
    good: { sql: `-- company_db already models it correctly: one row per relationship
SELECT count(*) FROM employee_projects WHERE project_id = 5;`,
      why: 'A junction table gives integrity, per-relationship attributes and simple indexed queries from both sides.', run: true }
  },
  mistakes: [
    `Using <code>'x' = ANY(tags)</code> and expecting the GIN index to be used — write <code>tags @&gt; ARRAY['x']</code>.`,
    `Calling <code>unnest()</code> in the SELECT list alongside other set-returning functions and getting surprising row counts; use <code>FROM ... unnest(...)</code>.`,
    `Losing rows with empty arrays when unnesting with a plain comma join; use <code>LEFT JOIN LATERAL ... ON true</code>.`,
    `Relying on <code>array_agg</code> output order without <code>ORDER BY</code> inside the aggregate.`,
    `Modelling relationships that need integrity or attributes as arrays.`
  ],
  best: [
    `Use arrays for small, bounded, value-like lists read together with the row.`,
    `Index array columns with GIN and query with <code>@&gt;</code>, <code>&amp;&amp;</code>, <code>&lt;@</code>.`,
    `Always specify <code>ORDER BY</code> inside <code>array_agg</code> when order matters.`,
    `Use <code>WITH ORDINALITY</code> whenever positions matter.`,
    `Prefer junction tables for many-to-many relationships between entities; denormalise into arrays only as a cache.`
  ],
  performance: `<p>GIN on arrays makes containment/overlap queries index-driven; very common elements (a tag on 50% of rows) produce long posting lists, and the planner may rightly prefer a sequential scan. Unnesting large tables is fast (no join), but sorting/grouping the exploded rows costs memory — consider partial aggregation. Arrays avoid join cost when reading a row's list; junction tables avoid row rewrites when changing one element — choose by your read/write pattern.</p>`,
  security: `<p>Arrays bypass foreign-key checks, so a tag/id array can reference things the user should not see; validate element values in application or trigger logic if they are security-relevant (e.g. arrays of tenant or role ids — prefer proper tables for anything used in authorisation).</p>`,
  scenario: { title: "Tags need descriptions, translations and safe renames", steps: [
    "1. Product managers want tag descriptions and translated names; renaming a tag means rewriting millions of rows.",
    "2. Create tags(id, name UNIQUE, ...) from SELECT DISTINCT unnest(tags).",
    "3. Create product_tags(product_id, tag_id, position) via unnest(...) WITH ORDINALITY.",
    "4. Switch reads to joins; optionally keep tag_ids int[] with GIN as a denormalised search cache.",
    "5. Verify with array_agg(... ORDER BY position) that nothing was lost.",
    "6. Drop the old text[] column after a release cycle."
  ] },
  interview: [
    { q: 'How do you get the position of each element when unnesting an array?', a: 'Use unnest(arr) WITH ORDINALITY AS t(elem, pos) in the FROM clause; pos is the 1-based position.' },
    { q: 'Which array predicates can a GIN index on the array column serve?', a: 'The array_ops operator class supports @> (contains), <@ (is contained by), && (overlaps) and = (equality). The form x = ANY(arr) is not indexable with it — rewrite as arr @> ARRAY[x].' },
    { q: 'When would you choose a junction table over an array column?', a: 'When elements are entities needing referential integrity, when the relationship has attributes, when you query from the element side with element metadata, when lists are large or grow, or when concurrent single-element updates are common.' }
  ],
  exercises: [
    { task: 'For each department, build an array of its project names ordered by start_date and show the department with the most projects first.', solution: `SELECT d.name, array_agg(p.name ORDER BY p.start_date) AS projects, count(*) AS n
FROM departments d JOIN projects p ON p.department_id = d.id
GROUP BY d.name ORDER BY n DESC, d.name;`, run: true },
    { task: 'Zip two arrays in parallel with unnest to pair month numbers 1..3 with names Jan, Feb, Mar.', solution: `SELECT * FROM unnest(ARRAY[1, 2, 3], ARRAY['Jan', 'Feb', 'Mar']) AS z(month_no, month_name);`, run: true }
  ],
  challenge: { task: 'Find pairs of tags that appear together on the same product and count how often each pair co-occurs (each pair once, alphabetical order).', hint: 'Unnest the tags twice for the same product and keep t1.tag < t2.tag.', solution: `SELECT t1.tag AS tag_a, t2.tag AS tag_b, count(*) AS products
FROM products p
CROSS JOIN LATERAL unnest(p.tags) AS t1(tag)
CROSS JOIN LATERAL unnest(p.tags) AS t2(tag)
WHERE t1.tag < t2.tag
GROUP BY 1, 2
ORDER BY products DESC, 1, 2;`, run: true },
  related: ['arrays-basics', 'jsonb-indexing-design', 'database-design', 'aggregations'],
  quiz: [
    { type: 'index', q: 'Queries use WHERE tags && ARRAY[\'sale\',\'new\']. Which index?', options: ['B-tree on tags', 'GIN on tags', 'Hash on tags', 'B-tree on cardinality(tags)'], answer: 1, explain: 'GIN array_ops supports overlap, containment and contained-by.' },
    { type: 'tf', q: 'A GIN index on tags speeds up WHERE \'sale\' = ANY(tags).', answer: false, explain: 'The ANY form is not supported by the GIN array operator class; use tags @> ARRAY[\'sale\'].' },
    { type: 'predict', q: 'How many rows does SELECT * FROM unnest(ARRAY[1,2,3], ARRAY[\'a\']) return?', options: ['1', '3', '4', 'ERROR'], answer: 1, explain: 'Parallel unnest pads the shorter array with NULLs, returning 3 rows.' },
    { type: 'design', q: 'Employees work on many projects, each with a role and allocation %. Model?', options: ['project_ids int[] on employees', 'A junction table employee_projects(employee_id, project_id, role, allocation_pct)', 'jsonb array of projects on employees', 'Comma-separated text'], answer: 1, explain: 'Relationship attributes and integrity require a junction table.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: full-text-search
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'full-text-search-basics',
  module: 'full-text-search',
  title: 'Full-Text Search Basics: tsvector, tsquery, Parsers and Dictionaries',
  level: 3,
  minutes: 24,
  summary: 'Learn how PostgreSQL turns text into searchable lexemes (tsvector), how search queries become tsquery with to_tsquery, plainto_tsquery, phraseto_tsquery and websearch_to_tsquery, and how configurations and dictionaries (stemming, stop words) decide what matches.',
  objectives: [
    'Explain documents, lexemes, tsvector and tsquery',
    'Build vectors with to_tsvector and queries with the four query constructors',
    'Match with @@ and use &, |, !, <-> and prefix :* operators',
    'Inspect parsing and stemming with ts_debug and choose a text search configuration',
    'Understand why FTS finds "replicating" for "replica" but not "autovacuum" for "vacuum"'
  ],
  concept: `<p>Full-text search (FTS) <span class="tag core">core</span> is like a <em>book's back-of-the-book index</em>. Nobody reads the whole book to find "replication"; you look up the normalised word in the index and get the page numbers. PostgreSQL builds such an index entry list for each document:</p>
<ol>
<li><strong>Parse</strong> the text into tokens (words, numbers, emails, URLs...).</li>
<li><strong>Normalise</strong> each token through dictionaries: lower-case, drop <em>stop words</em> ("the", "are", "to"), and <em>stem</em> words to a root lexeme ("replicating" → <code>replic</code>, "servers" → <code>server</code>, "quickly" → <code>quick</code>).</li>
<li>Store the result as a <strong>tsvector</strong>: a sorted list of lexemes with positions — <code>'quick':9 'replic':4 'server':8 ...</code>.</li>
</ol>
<p>A search string goes through the same normalisation and becomes a <strong>tsquery</strong>: lexemes combined with <code>&amp;</code> (AND), <code>|</code> (OR), <code>!</code> (NOT), <code>&lt;-&gt;</code> (followed by) or <code>&lt;N&gt;</code> (N positions apart), and <code>:*</code> for prefix matching. The match operator is <code>tsvector @@ tsquery</code>.</p>
<h4>Four ways to build a query</h4>
<table>
<tr><th>Function</th><th>Input</th><th>Use for</th></tr>
<tr><td><code>to_tsquery</code></td><td>Query syntax: <code>'replica &amp; (standby | failover)'</code></td><td>Programmatic queries; errors on invalid syntax</td></tr>
<tr><td><code>plainto_tsquery</code></td><td>Plain words, ANDed</td><td>Simple search boxes</td></tr>
<tr><td><code>phraseto_tsquery</code></td><td>Plain words as a phrase (<code>&lt;-&gt;</code>)</td><td>Exact phrase search</td></tr>
<tr><td><code>websearch_to_tsquery</code> (PG11+)</td><td>Google-like: <code>"quoted phrase" or word -excluded</code></td><td>User-facing search boxes; never raises syntax errors</td></tr>
</table>
<h4>Configurations</h4>
<p>A <em>text search configuration</em> (<code>english</code>, <code>simple</code>, <code>german</code>, <code>hindi</code>...; see <code>pg_ts_config</code>) chooses the parser and the dictionary chain per token type. <code>english</code> stems with Snowball and drops English stop words; <code>simple</code> only lower-cases (good for codes, names and mixed-language data). The configuration used to build the vector and the query <strong>must match</strong>, otherwise lexemes will not line up.</p>`,
  why: `<p><code>LIKE '%replica%'</code> does not understand language: it misses "replicating", matches "replicable" and "nonreplica", cannot rank results and cannot use a B-tree. FTS understands word boundaries, morphology and stop words, supports boolean and phrase logic, ranks by relevance, and is indexable with GIN — often enough to avoid deploying a separate search engine.</p>`,
  useCase: `<p>A SaaS help-centre with 40 000 articles in English replaced <code>ILIKE</code> search with FTS: a generated <code>tsvector</code> column over title and body, a GIN index, and <code>websearch_to_tsquery</code> for the search box so users can type <code>"reset password" -sso</code>. Queries dropped from 1.2 s to 8 ms, and "How do I cancel subscriptions" now finds the article titled "Cancelling your subscription" because both stem to <code>cancel</code> and <code>subscript</code>.</p>`,
  internals: `<p>A <code>tsvector</code> stores unique lexemes sorted, each with up to 256 positions (positions above 16383 are capped) and an optional weight label A–D per position. <code>tsquery</code> is stored as a tree of operators. The default parser recognises 23 token types (<code>asciiword</code>, <code>word</code>, <code>numword</code>, <code>email</code>, <code>url</code>, <code>host</code>, <code>float</code>...); <code>ts_debug</code> shows how each token is classified and which dictionaries handled it. Matching checks lexeme membership and, for phrase operators, position distances. <code>to_tsvector(regconfig, text)</code> with an explicit configuration is IMMUTABLE, which is why it can be used in index expressions and generated columns; the one-argument form depends on <code>default_text_search_config</code> and is only STABLE.</p>`,
  whenNot: `<p>FTS is word-based: it does not handle typos ("replcia"), substrings inside words ("vacuum" inside "autovacuum") or semantic similarity ("HA" vs "failover"). Combine it with <code>pg_trgm</code> for typos and substrings, and with embeddings (pgvector) for meaning. For identifiers, SKUs and codes use B-tree or trigram indexes instead of FTS.</p>`,
  syntax: `to_tsvector([config,] text)                 -- document -> tsvector
to_tsquery([config,] 'a & (b | c) & !d & e:*')
plainto_tsquery([config,] 'plain words')
phraseto_tsquery([config,] 'exact phrase')
websearch_to_tsquery([config,] '"phrase" or word -excluded')
tsvector @@ tsquery                          -- match
ts_debug([config,] text)                     -- inspect parsing
SHOW default_text_search_config;`,
  examples: [
    { label: 'Basic', title: 'From text to lexemes, and from a search string to a query',
      sql: `SELECT to_tsvector('english', 'The replicas are replicating WAL to standby servers quickly') AS english_vector,
       to_tsvector('simple',  'The replicas are replicating WAL')                          AS simple_vector;

SELECT to_tsquery('english', 'replica & standby')                         AS to_tsq,
       plainto_tsquery('english', 'replicating standby servers')          AS plain_tsq,
       phraseto_tsquery('english', 'standby servers')                     AS phrase_tsq,
       websearch_to_tsquery('english', '"point in time" recovery -mysql or pitr') AS web_tsq;`,
      explain: `<p>The <code>english</code> configuration drops stop words ("the", "are", "to"), stems words ("replicating" → <code>replic</code>, "standby" → <code>standbi</code>) and records positions; <code>simple</code> keeps every word, only lower-cased. The second query (shown) compares query constructors: <code>plainto</code> ANDs words, <code>phraseto</code> requires adjacency (<code>&lt;-&gt;</code>), and <code>websearch</code> understands quotes, <code>or</code> and <code>-</code> — note <code>'point' &lt;2&gt; 'time'</code>: the stop word "in" still occupies a position.</p>`,
      output: ` to_tsq                | plain_tsq                       | phrase_tsq             | web_tsq
-----------------------+---------------------------------+------------------------+-----------------------------------------------------
 'replica' & 'standbi' | 'replic' & 'standbi' & 'server' | 'standbi' <-> 'server' | 'point' <2> 'time' & 'recoveri' & !'mysql' | 'pitr'
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Searching the documents table',
      sql: `-- documents.search is a generated tsvector (title weight A, body weight B) with a GIN index
SELECT id, title
FROM documents
WHERE search @@ websearch_to_tsquery('english', 'replicas standby')
ORDER BY id;

SELECT q AS query,
       (SELECT string_agg(id::text, ',' ORDER BY id)
        FROM documents WHERE search @@ to_tsquery('english', q)) AS matching_ids
FROM (VALUES ('vacuum'), ('vacuum | autovacuum'), ('index & !partial'),
             ('connect:*'), ('backup <-> point'), ('backup <2> point')) AS t(q);`,
      explain: `<p>The <code>documents</code> table already has <code>search tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')) STORED</code> and a GIN index, so queries just use <code>search @@ ...</code>. The second query (shown) explores operators: "vacuum" does <em>not</em> match "Tuning autovacuum" (different word), <code>connect:*</code> prefix-matches "connection"/"connections", and <code>backup &lt;2&gt; point</code> matches "Backup and point" (two positions apart) while <code>&lt;-&gt;</code> (adjacent) does not.</p>`,
      output: ` query               | matching_ids
---------------------+--------------
 vacuum              | 2
 vacuum | autovacuum | 2,15
 index & !partial    | 4,7,24
 connect:*           | 6,21
 backup <-> point    |
 backup <2> point    | 11
(6 rows)`, run: true },
    { label: 'Advanced', title: 'Inspecting configurations and dictionaries with ts_debug',
      sql: `SELECT cfgname FROM pg_ts_config
WHERE cfgname IN ('english', 'simple', 'german', 'hindi', 'tamil')
ORDER BY 1;

SELECT alias, token, dictionaries, lexemes
FROM ts_debug('english', 'Indexes on user@example.com running 3.5x faster in PostgreSQL-18')
WHERE alias <> 'blank';`,
      explain: `<p><code>ts_debug</code> shows each token's type (<code>asciiword</code>, <code>email</code>, <code>numword</code>, <code>asciihword</code> for hyphenated words...), which dictionaries were consulted and the resulting lexemes. "on" and "in" yield empty lexeme lists (stop words); the email address is kept as a single token handled by the <code>simple</code> dictionary; "3.5x" splits into the number <code>3.5</code> and the word <code>x</code>; and "PostgreSQL-18" becomes <code>postgresql</code> plus the integer <code>-18</code> (the hyphen is read as a minus sign) — a reminder to test the parser on product codes and versions before relying on it. Recent PostgreSQL releases ship Snowball stemmers for many languages, including Hindi and Tamil configurations (the first query, not shown, lists them). Choose the configuration per column or per row language.</p>`,
      output: ` alias     | token            | dictionaries   | lexemes
-----------+------------------+----------------+--------------------
 asciiword | Indexes          | {english_stem} | {index}
 asciiword | on               | {english_stem} | {}
 email     | user@example.com | {simple}       | {user@example.com}
 asciiword | running          | {english_stem} | {run}
 float     | 3.5              | {simple}       | {3.5}
 asciiword | x                | {english_stem} | {x}
 asciiword | faster           | {english_stem} | {faster}
 asciiword | in               | {english_stem} | {}
 asciiword | PostgreSQL       | {english_stem} | {postgresql}
 int       | -18              | {simple}       | {-18}
(10 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Substring matching: misses morphology, over-matches, cannot rank or use GIN FTS
SELECT id, title FROM documents
WHERE body ILIKE '%replica%' OR title ILIKE '%replica%'
ORDER BY id;`,
      why: 'ILIKE finds "replica" inside other words, misses "replication" vs "replicas" semantics, cannot rank, and scans every row.', run: true },
    good: { sql: `SELECT id, title FROM documents
WHERE search @@ websearch_to_tsquery('english', 'replica')
ORDER BY id;`,
      why: 'Lexeme matching via the indexed tsvector: language-aware, rankable and GIN-accelerated.', run: true }
  },
  mistakes: [
    `Using different configurations for the vector and the query (<code>to_tsvector('simple', ...)</code> vs <code>to_tsquery('english', ...)</code>) — stems do not match.`,
    `Relying on the one-argument <code>to_tsvector(text)</code>, which depends on <code>default_text_search_config</code> and cannot be used in an index expression.`,
    `Passing raw user input to <code>to_tsquery</code> — "C++ & " raises a syntax error; use <code>websearch_to_tsquery</code> or <code>plainto_tsquery</code>.`,
    `Expecting FTS to find substrings or typos ("vacuum" in "autovacuum", "replcia").`,
    `Searching identifiers, SKUs or emails with the <code>english</code> configuration and getting stemmed garbage — use <code>simple</code> or trigram/B-tree.`
  ],
  best: [
    `Always pass the configuration explicitly: <code>to_tsvector('english', ...)</code>.`,
    `Use <code>websearch_to_tsquery</code> for user input.`,
    `Store the tsvector in a generated column and index it with GIN.`,
    `Inspect surprises with <code>ts_debug</code> and <code>ts_lexize</code> before changing configurations.`,
    `Use <code>simple</code> for names, codes and multilingual content without a known language.`
  ],
  performance: `<p>Computing <code>to_tsvector</code> is CPU-intensive (parsing + stemming); computing it at query time for every row means a sequential scan with heavy CPU. Precompute it in a stored generated column and index with GIN: lookups become posting-list intersections, typically milliseconds for millions of documents. Very common lexemes (appearing in most documents) make queries less selective; stop words are removed for that reason.</p>`,
  security: `<p><code>websearch_to_tsquery</code> and <code>plainto_tsquery</code> never raise syntax errors on user input, which avoids error-based probing and broken search pages. Always bind the search string as a parameter — FTS functions do not protect against SQL injection if you concatenate input into SQL text.</p>`,
  scenario: { title: "Search finds nothing for obvious queries", steps: [
    "1. Users search 'servers' and miss documents containing 'server'.",
    "2. The query uses to_tsquery('simple', ...) against an english-config tsvector.",
    "3. Align configurations: websearch_to_tsquery('english', $1).",
    "4. Users typing quotes or minus signs get errors: replace to_tsquery with websearch_to_tsquery.",
    "5. Inspect odd tokens (product codes, versions) with ts_debug.",
    "6. Add pg_trgm for substrings like 'vacuum' inside 'autovacuum'."
  ] },
  interview: [
    { q: 'What are tsvector and tsquery?', a: 'tsvector is a normalised representation of a document: sorted unique lexemes with positions (and optional weights). tsquery is a normalised search expression: lexemes combined with &, |, !, phrase operators and prefix markers. They are matched with the @@ operator.' },
    { q: 'Which query function would you use for a user search box and why?', a: 'websearch_to_tsquery: it accepts familiar syntax (quotes for phrases, or, - for exclusion) and never raises syntax errors, unlike to_tsquery.' },
    { q: 'Why does a search for "vacuum" not find "autovacuum"?', a: 'FTS matches whole lexemes after stemming; "autovacuum" is a different word, so its lexeme is autovacuum. Substring or fuzzy matching needs pg_trgm or prefix queries.' }
  ],
  exercises: [
    { task: 'Show the tsvector of the title and body of document 9 using the english configuration, and the lexemes of the phrase "partitions pruning" via to_tsquery with &.', solution: `SELECT to_tsvector('english', title || ' ' || body) AS vec
FROM documents WHERE id = 9;
SELECT to_tsquery('english', 'partitions & pruning') AS q;`, run: true },
    { task: 'Find documents that mention "replication" or "replica" but not "pgvector", using websearch_to_tsquery.', solution: `SELECT id, title FROM documents
WHERE search @@ websearch_to_tsquery('english', 'replication or replica -pgvector')
ORDER BY id;`, run: true }
  ],
  challenge: { task: 'Compare the english and simple configurations on all document titles: for the query word "indexing", show which titles match under each configuration and explain the difference.', hint: 'Build to_tsvector(cfg, title) on the fly for both configs and match plainto_tsquery(cfg, \'indexing\').', solution: `SELECT id, title,
       to_tsvector('english', title) @@ plainto_tsquery('english', 'indexing') AS english_match,
       to_tsvector('simple',  title) @@ plainto_tsquery('simple',  'indexing') AS simple_match
FROM documents
WHERE to_tsvector('english', title) @@ plainto_tsquery('english', 'indexing')
   OR to_tsvector('simple',  title) @@ plainto_tsquery('simple',  'indexing')
ORDER BY id;`, run: true },
  related: ['full-text-search-ranking', 'full-text-search-production', 'extensions-pg-trgm', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Which function safely converts arbitrary user input (quotes, minus signs) into a tsquery without syntax errors?', options: ['to_tsquery', 'websearch_to_tsquery', 'to_tsvector', 'ts_rank'], answer: 1, explain: 'websearch_to_tsquery accepts web-search syntax and never errors.' },
    { type: 'predict', q: 'Does to_tsvector(\'english\', \'running servers\') @@ to_tsquery(\'english\', \'run & server\') return true?', options: ['true', 'false', 'NULL', 'ERROR'], answer: 0, explain: 'Both sides are stemmed: running → run, servers → server.' },
    { type: 'tf', q: 'The phrase operator <-> requires the two lexemes to be adjacent in the document.', answer: true, explain: '<-> means "followed by" at distance 1; <N> allows distance N.' },
    { type: 'bug', q: 'Why does this never match English documents indexed with the english config?', code: `SELECT * FROM documents WHERE search @@ to_tsquery('simple', 'replicas');`, options: ['simple is not a config', 'The query lexeme "replicas" is not stemmed, but the vector contains "replica"', '@@ needs ts_rank', 'Missing index'], answer: 1, explain: 'Vector and query must use the same configuration so the lexemes match.' }
  ]
},
{
  id: 'full-text-search-ranking',
  module: 'full-text-search',
  title: 'Ranking and Highlighting: ts_rank, ts_rank_cd, setweight and ts_headline',
  level: 3,
  minutes: 22,
  summary: 'Order search results by relevance with ts_rank and ts_rank_cd, make title matches count more with setweight, normalise for document length, and show highlighted snippets with ts_headline — all on the documents table and its generated search column.',
  objectives: [
    'Rank results with ts_rank and ts_rank_cd and understand the difference',
    'Weight fields with setweight (A, B, C, D) and custom weight arrays',
    'Normalise ranks for document length',
    'Generate highlighted snippets with ts_headline efficiently',
    'Build a complete, indexed, ranked search query'
  ],
  concept: `<p>Finding matching documents is half the job; users expect the <em>best</em> matches first. Analogy: a <em>librarian ranking books</em> for your question — a book with your topic in its <strong>title</strong> beats one that mentions it once in chapter nine; a book that mentions it many times, with your words close together, beats a passing mention.</p>
<h4>Weights</h4>
<p><code>setweight(vector, 'A')</code> labels every lexeme position with a weight class A, B, C or D. The <code>documents.search</code> column is built as <code>setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')</code>, so title words carry weight A. Ranking functions multiply by default weights <code>{D=0.1, C=0.2, B=0.4, A=1.0}</code>, overridable with a <code>float4[]</code>.</p>
<h4>Ranking functions</h4>
<ul>
<li><code>ts_rank([weights,] vector, query [, normalization])</code> — based on frequency of matching lexemes.</li>
<li><code>ts_rank_cd(...)</code> — "cover density": rewards query terms that appear <em>close together</em>; needs positional information.</li>
<li><code>normalization</code> bit mask: 0 (default, ignore length), 1 (divide by 1 + log(length)), 2 (divide by length), 4 (harmonic distance between extents, cd only), 8 (by unique words), 16 (1 + log(unique words)), 32 (rank / (rank + 1), maps to 0..1).</li>
</ul>
<h4>Snippets</h4>
<p><code>ts_headline([config,] text, query [, options])</code> returns the original text with matches wrapped (default <code>&lt;b&gt;…&lt;/b&gt;</code>). Options: <code>StartSel</code>, <code>StopSel</code>, <code>MaxWords</code>, <code>MinWords</code>, <code>ShortWord</code>, <code>MaxFragments</code>, <code>FragmentDelimiter</code>, <code>HighlightAll</code>. It works on the <em>original text</em> (not the tsvector) and re-parses it — expensive, so compute it only for the rows you display.</p>`,
  why: `<p>A search returning 300 matches in arbitrary order is nearly useless. Ranking puts the most relevant documents on the first page; weights encode the obvious domain knowledge that titles and tags matter more than body text; snippets show users <em>why</em> a result matched, which strongly affects click-through.</p>`,
  useCase: `<p>An internal engineering wiki (120 000 pages) ranks results with <code>ts_rank_cd('{0.1, 0.2, 0.4, 1.0}', search, query, 32)</code> where titles are weight A, headings B, body C and comments D. Only the top 20 rows get <code>ts_headline</code> snippets. Median search latency is 25 ms; before they limited headline generation to the final page it was 900 ms, because <code>ts_headline</code> was computed for all ~4 000 matches before sorting.</p>`,
  internals: `<p>Ranking functions read the positions and weights stored in the tsvector of each matching row — they cannot use the index, so they run once per matching row. That is why ranking queries are fast when the <code>@@</code> filter is selective and slow when millions of rows match (all must be ranked before the top N can be chosen). <code>ts_rank_cd</code> computes "covers" (minimal text spans containing all query terms) and scores by their density; without positions (e.g. after <code>strip()</code>) it returns 0. <code>ts_headline</code> re-parses the original document text with the configuration, finds fragments containing query terms, and selects the best ones according to its options.</p>`,
  whenNot: `<p>PostgreSQL's ranking is classic and simple: no BM25 by default, no learning-to-rank, no global term-frequency (IDF) statistics across the corpus. When relevance tuning is a product differentiator (e-commerce search with synonyms, boosting by popularity, personalisation, typo tolerance at scale), a dedicated engine (Elasticsearch/OpenSearch <span class="tag tool">third-party tool</span>) or BM25-style extensions may be justified. Do not compute <code>ts_headline</code> for every matched row.</p>`,
  syntax: `setweight(tsvector, 'A' | 'B' | 'C' | 'D')
ts_rank([ weights float4[], ] vector, query [, normalization int])
ts_rank_cd([ weights float4[], ] vector, query [, normalization int])
ts_headline([ config, ] document text, query [, 'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=5, MaxFragments=2' ])`,
  examples: [
    { label: 'Basic', title: 'Ranking matches with ts_rank and ts_rank_cd',
      sql: `SELECT id, title,
       round(ts_rank(search, q)::numeric, 4)    AS rank,
       round(ts_rank_cd(search, q)::numeric, 4) AS rank_cd
FROM documents,
     websearch_to_tsquery('english', 'replication standby wal') AS q
WHERE search @@ q
ORDER BY rank DESC;

SELECT id, title,
       round(ts_rank(search, q)::numeric, 4)    AS rank,
       round(ts_rank_cd(search, q)::numeric, 4) AS rank_cd
FROM documents,
     to_tsquery('english', 'vacuum | index | partition') AS q
WHERE search @@ q
ORDER BY rank DESC;`,
      explain: `<p>The query is computed once in <code>FROM</code> and referenced as <code>q</code>. <code>@@</code> filters (using the GIN index); <code>ts_rank</code> scores frequency and weights; <code>ts_rank_cd</code> rewards terms appearing close together. In the second query (shown), documents whose <em>title</em> contains a term ("Indexing strategies", "Partitioning large tables") rank highest because title lexemes carry weight A (1.0) while body lexemes carry B (0.4).</p>`,
      output: ` id | title                              | rank   | rank_cd
----+------------------------------------+--------+---------
 1  | Indexing strategies for PostgreSQL | 0.2370 | 2.2000
 9  | Partitioning large tables          | 0.2319 | 1.8000
 2  | Understanding MVCC                 | 0.0811 | 0.4000
 4  | Getting started with JSONB         | 0.0811 | 0.4000
 7  | Vector search with pgvector        | 0.0811 | 0.4000
 24 | Designing an e-commerce schema     | 0.0811 | 0.4000
(6 rows)`, run: true },
    { label: 'Intermediate', title: 'Custom weights and length normalisation',
      sql: `SELECT id, title,
       round(ts_rank(search, q)::numeric, 4)                               AS default_weights,
       round(ts_rank('{0.1, 0.2, 1.0, 1.0}', search, q)::numeric, 4)       AS body_as_important,
       round(ts_rank(search, q, 1)::numeric, 4)                            AS log_length_norm,
       round(ts_rank(search, q, 32)::numeric, 4)                           AS scaled_0_to_1
FROM documents,
     websearch_to_tsquery('english', 'postgresql') AS q
WHERE search @@ q
ORDER BY default_weights DESC;`,
      explain: `<p>The weights array is ordered <code>{D, C, B, A}</code>. Raising B to 1.0 makes body matches as important as title matches. Normalisation <code>1</code> divides by 1 + log(document length) so long documents do not win merely by repeating words; <code>32</code> rescales scores into 0..1, convenient for combining with other signals (recency, popularity) in an <code>ORDER BY</code> expression.</p>`,
      output: ` id | title                              | default_weights | body_as_important | log_length_norm | scaled_0_to_1
----+------------------------------------+-----------------+-------------------+-----------------+---------------
 1  | Indexing strategies for PostgreSQL | 0.6079          | 0.6079            | 0.1344          | 0.3781
 21 | Securing PostgreSQL connections    | 0.6079          | 0.6079            | 0.1487          | 0.3781
 2  | Understanding MVCC                 | 0.2432          | 0.6079            | 0.0572          | 0.1956
 6  | Connection pooling with PgBouncer  | 0.2432          | 0.6079            | 0.0608          | 0.1956
(4 rows)`, run: true },
    { label: 'Advanced', title: 'A complete search: filter, rank, page, then highlight',
      sql: `WITH q AS (
  SELECT websearch_to_tsquery('english', 'replicas or backup recovery') AS query
), top_hits AS (
  SELECT d.id, d.title, d.body,
         ts_rank_cd(d.search, q.query, 32) AS score
  FROM documents d, q
  WHERE d.search @@ q.query                 -- GIN index does the filtering
  ORDER BY score DESC, d.id
  LIMIT 3                                   -- rank, then keep only one page
)
SELECT h.id,
       h.title,
       round(h.score::numeric, 3) AS score,
       ts_headline('english', h.body, q.query,
                   'StartSel=[, StopSel=], MaxWords=15, MinWords=8') AS snippet
FROM top_hits h, q
ORDER BY h.score DESC, h.id;`,
      explain: `<p>The production pattern: compute the query once, filter with <code>@@</code> (index), rank and <code>LIMIT</code> to one page in a CTE, and only then compute <code>ts_headline</code> for the few rows displayed — headline generation re-parses text and is the most expensive step. Notice the first snippet has no highlight: the query word "replicas" stems to <code>replica</code>, while "replication" in the body stems to <code>replic</code> — document 5 matched through its <em>title</em>, and stemming is not as clever as humans expect. The <code>StartSel</code>/<code>StopSel</code> options use brackets here; web pages typically use <code>&lt;mark&gt;</code> (escape the rest of the text before inserting HTML).</p>`,
      output: ` id | title                             | score | snippet
----+-----------------------------------+-------+---------------------------------------------------------
 5  | Scaling reads with replicas       | 0.500 | Streaming replication ships WAL to standby servers that
 11 | Backup and point in time recovery | 0.255 | Combine a base [backup] with archived WAL to
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Headline for every matching row, computed before sorting/limiting
SELECT id, ts_headline('english', body, q) AS snippet, ts_rank(search, q) AS r
FROM documents, to_tsquery('english', 'postgresql | data | query') q
WHERE search @@ q
ORDER BY r DESC
LIMIT 3;`,
      why: 'ts_headline is evaluated for every matching row before the LIMIT applies; with thousands of matches this dominates query time.', run: true },
    good: { sql: `WITH top AS (
  SELECT id, body, ts_rank(search, q) AS r, q
  FROM documents, to_tsquery('english', 'postgresql | data | query') q
  WHERE search @@ q
  ORDER BY r DESC LIMIT 3)
SELECT id, ts_headline('english', body, q) AS snippet FROM top ORDER BY r DESC;`,
      why: 'Rank and limit first, then generate snippets only for the rows that will be shown.', run: true }
  },
  mistakes: [
    `Computing <code>ts_headline</code> (or <code>to_tsvector</code>) for all matches instead of only the displayed page.`,
    `Forgetting the weights array order is <code>{D, C, B, A}</code>, not A-first.`,
    `Using <code>ts_rank_cd</code> on stripped vectors (no positions) — it returns 0.`,
    `Expecting ranking to use the GIN index; only the <code>@@</code> filter does — broad queries matching millions of rows rank slowly.`,
    `Inserting <code>ts_headline</code> output into HTML without escaping the document text first (XSS).`
  ],
  best: [
    `Weight fields by importance (title A, tags/headings B, body C/D) in the stored tsvector.`,
    `Filter with <code>@@</code>, rank, <code>LIMIT</code>, then highlight.`,
    `Use normalisation 32 when combining text relevance with other signals.`,
    `Tie-break ranking with a deterministic column (<code>id</code>, recency) for stable pagination.`,
    `Require a minimum query selectivity (or add filters) so ranking never runs over most of the table.`
  ],
  performance: `<p>Cost ≈ (index lookup) + (number of matching rows × ranking cost) + (displayed rows × headline cost). For selective queries this is milliseconds. For broad queries (a common word matching 2 million rows), ranking must touch every match: hundreds of milliseconds to seconds. Mitigations: add structured filters (category, date), cap candidates with a subquery LIMIT before ranking when exact global ordering is not needed, or precompute popularity scores. Keeping body text TOASTed away from the tsvector helps: the ranking step needs only the tsvector.</p>`,
  security: `<p><code>ts_headline</code> returns raw document text plus your markers; if documents can contain user-supplied HTML, escape it before display and use markers that you then convert to tags safely. Limit result counts and query complexity in user-facing search endpoints, and set a <code>statement_timeout</code> for the search role.</p>`,
  scenario: { title: "Search results look random", steps: [
    "1. Users complain the best article is on page 3.",
    "2. Results are ordered by id, not relevance.",
    "3. Rebuild the tsvector with setweight: title A, headings B, body C.",
    "4. ORDER BY ts_rank_cd(search, q, 32) DESC, id; LIMIT 20.",
    "5. Generate ts_headline only for the 20 displayed rows.",
    "6. Track click-through on the top 3 results to validate changes."
  ] },
  interview: [
    { q: 'Difference between ts_rank and ts_rank_cd?', a: 'ts_rank scores based on how often query lexemes occur, scaled by weights; ts_rank_cd uses cover density — how close together the query terms appear — rewarding documents where terms co-occur in short spans. ts_rank_cd needs positional information.' },
    { q: 'How do you make title matches rank higher than body matches?', a: 'Build the tsvector with setweight(to_tsvector(cfg, title), \'A\') || setweight(to_tsvector(cfg, body), \'B\') and rank with default or custom weights, where A has the highest weight.' },
    { q: 'Why can ranking be slow even with a GIN index?', a: 'The index only finds matching rows; ranking is computed per matching row from its tsvector. If a query matches a large fraction of the table, all those rows must be fetched and ranked before the top N can be returned.' }
  ],
  exercises: [
    { task: 'Return the top 3 documents for "connection security" ranked by ts_rank_cd with normalisation 1, including a 10-word headline.', solution: `SELECT id, title, round(ts_rank_cd(search, q, 1)::numeric, 4) AS score,
       ts_headline('english', body, q, 'MaxWords=10, MinWords=3') AS snippet
FROM documents, websearch_to_tsquery('english', 'connection security') q
WHERE search @@ q
ORDER BY score DESC, id
LIMIT 3;`, run: true },
    { task: 'Show how the ranking for the query "vacuum" changes if body text (weight B) is given weight 1.0 instead of 0.4.', solution: `SELECT id, title,
       round(ts_rank(search, q)::numeric, 4) AS default_rank,
       round(ts_rank('{0.1, 0.2, 1.0, 1.0}', search, q)::numeric, 4) AS boosted_body
FROM documents, to_tsquery('english', 'vacuum') q
WHERE search @@ q
ORDER BY default_rank DESC;`, run: true }
  ],
  challenge: { task: 'Combine text relevance with recency: rank documents for "postgresql or database" by 0.8 × ts_rank(…, 32) + 0.2 × a recency score (1.0 for the newest created_at, linearly down to 0 for the oldest), and return the top 5.', hint: 'Recency can be computed with window functions: (extract(epoch from created_at) - min) / nullif(max - min, 0) over ().', solution: `WITH q AS (SELECT websearch_to_tsquery('english', 'postgresql or database') AS query),
hits AS (
  SELECT d.id, d.title, ts_rank(d.search, q.query, 32) AS text_score,
         extract(epoch FROM d.created_at) AS ts
  FROM documents d, q WHERE d.search @@ q.query
)
SELECT id, title,
       round((0.8 * text_score
              + 0.2 * coalesce((ts - min(ts) OVER ()) / nullif(max(ts) OVER () - min(ts) OVER (), 0), 1))::numeric, 4) AS score
FROM hits
ORDER BY score DESC, id
LIMIT 5;`, run: true },
  related: ['full-text-search-basics', 'full-text-search-production', 'window-functions', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'In ts_rank(\'{0.1, 0.2, 0.4, 1.0}\', ...), which weight label gets 1.0?', options: ['D', 'C', 'B', 'A'], answer: 3, explain: 'The weights array is ordered D, C, B, A.' },
    { type: 'tf', q: 'ts_headline uses the tsvector column, so it is cheap.', answer: false, explain: 'ts_headline re-parses the original text; it is expensive and should run only on displayed rows.' },
    { type: 'optimize', q: 'A search page is slow; EXPLAIN shows ts_headline evaluated for 5 000 matching rows. Best fix?', options: ['Add a B-tree index', 'Rank and LIMIT in a subquery/CTE, then compute ts_headline only for the page', 'Use ts_rank_cd instead', 'Increase work_mem'], answer: 1, explain: 'Generate snippets only for the rows displayed.' },
    { type: 'predict', q: 'What does normalization option 32 do in ts_rank?', options: ['Divides by document length', 'Scales rank to rank/(rank+1), range 0..1', 'Ignores weights', 'Uses cover density'], answer: 1, explain: 'Option 32 maps scores into 0..1.' }
  ]
},
{
  id: 'full-text-search-production',
  module: 'full-text-search',
  title: 'Production Search: GIN vs GiST, FTS + pg_trgm, Multilingual Text and When to Use Elasticsearch',
  level: 4,
  minutes: 26,
  summary: 'Design production-grade PostgreSQL search: choose GIN or GiST for tsvector, maintain vectors with generated columns, add typo tolerance and substring matching with pg_trgm, handle multiple languages, and recognise when a dedicated engine such as Elasticsearch/OpenSearch is the better tool.',
  objectives: [
    'Choose between GIN and GiST indexes for tsvector and tune GIN for write-heavy tables',
    'Maintain search vectors with stored generated columns (vs triggers)',
    'Combine full-text search with pg_trgm for typo tolerance and "did you mean" suggestions',
    'Handle multilingual content with per-row configurations',
    'Decide objectively between PostgreSQL search and Elasticsearch/OpenSearch'
  ],
  concept: `<p>Production search is a <em>layered sieve</em>: a coarse, fast layer narrows millions of rows to candidates (an index), finer layers fix human imperfection (typos, partial words), and a final layer orders what remains (ranking). PostgreSQL can provide all layers; the art is combining them cheaply.</p>
<h4>GIN vs GiST for tsvector</h4>
<table>
<tr><th></th><th>GIN</th><th>GiST</th></tr>
<tr><td>Structure</td><td>Inverted index: lexeme → posting list of rows</td><td>Tree of lossy signatures (bitmaps)</td></tr>
<tr><td>Lookup speed</td><td>Fast, exact candidates (recheck only with weights)</td><td>Slower; lossy → more heap rechecks</td></tr>
<tr><td>Build / update cost</td><td>Higher; mitigated by <code>fastupdate</code> pending list</td><td>Lower</td></tr>
<tr><td>Size</td><td>Larger</td><td>Smaller</td></tr>
<tr><td>Typical choice</td><td>Default for search</td><td>Very write-heavy tables with modest search needs, or combining with other GiST-indexed columns</td></tr>
</table>
<h4>Maintaining the tsvector</h4>
<p>A <strong>stored generated column</strong> (as in <code>documents.search</code>) is the simplest and safest way: always consistent, no trigger code. Triggers (the legacy <code>tsvector_update_trigger</code> or custom functions) are needed only when the vector depends on <em>other tables</em> (e.g. include tag names from a join) or on a per-row configuration column.</p>
<h4>FTS + trigram</h4>
<ul>
<li>FTS gives linguistic matching and ranking but no typo tolerance or substrings.</li>
<li><code>pg_trgm</code> gives typo tolerance and substrings but no linguistics.</li>
<li>Pattern: run FTS first; if it returns too few results, use a trigram index over a <em>vocabulary</em> of known words (from <code>ts_stat</code>) to suggest corrections ("did you mean"), or OR the two conditions and blend scores.</li>
</ul>
<h4>Multilingual</h4>
<p>Store the language per row (<code>lang regconfig</code>) and build <code>to_tsvector(lang, body)</code>; queries must use the same config (search each language separately or use <code>simple</code> for a language-agnostic fallback). Languages without good stemmers (or mixed scripts like Hinglish) often work best with <code>simple</code> plus trigram matching.</p>`,
  why: `<p>Most applications need "good enough" search: product catalogues up to tens of millions of rows, help centres, admin consoles, CRM notes. Running it inside PostgreSQL means transactional consistency (new rows are searchable at commit), no sync pipeline, one backup, one security model. Knowing the limits tells you when that stops being true.</p>`,
  useCase: `<p>An Indian e-commerce company with 6 million products uses PostgreSQL FTS (GIN on a generated tsvector of title A + brand B + description C) plus a trigram index on product titles. Searches for "samsng galxy" get zero FTS hits, so the API falls back to trigram similarity on a vocabulary table and re-runs the query with suggestions ("samsung galaxy") — 35 ms end to end. They evaluated Elasticsearch and decided to keep PostgreSQL until they need synonyms per category, learning-to-rank and 2 000+ searches per second; at that point the plan is CDC (Debezium <span class="tag tool">third-party tool</span>) into OpenSearch, keeping PostgreSQL as the source of truth.</p>`,
  internals: `<p>GIN for tsvector stores one entry per lexeme with a compressed posting list (TID list or posting tree for frequent lexemes). With weights or phrase queries, GIN returns candidates that are rechecked against the heap tsvector. <code>fastupdate</code> (default on) appends new entries to an unsorted pending list, merged into the main index by vacuum or when it exceeds <code>gin_pending_list_limit</code> (default 4 MB) — great for insert throughput, but searches must also scan the pending list, so latency can spike on busy tables. GiST tsvector indexes store fixed-size signatures (<code>siglen</code>, default 124 bytes) of hashed lexemes; false positives require heap rechecks, growing with document size. <code>ts_stat('SELECT search FROM documents')</code> scans all vectors and returns each lexeme with document and occurrence counts — useful to build a suggestion vocabulary.</p>`,
  whenNot: `<p>Choose a dedicated engine (Elasticsearch/OpenSearch, Meilisearch, Typesense, Vespa — all <span class="tag tool">third-party tool</span>s) when you need: BM25 and sophisticated relevance tuning, synonyms and language analysers per field managed by search engineers, faceted aggregations over large result sets with sub-100 ms latency, typo tolerance at scale, horizontal scaling of search independent of the OLTP database, or very high query rates that would compete with transactional load. Accept the costs: a second system, an indexing pipeline, eventual consistency and duplicated security rules.</p>`,
  syntax: `-- maintained vector + index
ALTER TABLE t ADD COLUMN search tsvector GENERATED ALWAYS AS
  (setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
   setweight(to_tsvector('english', coalesce(body,'')),  'B')) STORED;
CREATE INDEX ON t USING gin (search) [WITH (fastupdate = off)];
CREATE INDEX ON t USING gist (search);

-- typo tolerance
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ON t USING gin (title gin_trgm_ops);
SELECT word FROM ts_stat('SELECT search FROM t');   -- vocabulary`,
  examples: [
    { label: 'Basic', title: 'GIN vs GiST on a tsvector, and how the planner uses them',
      sql: `-- a larger synthetic corpus built from the 24 documents
CREATE TABLE kb_articles AS
SELECT g AS id, d.title, d.body, d.search
FROM generate_series(1, 400) g
JOIN documents d ON d.id = 1 + (g % 24);

CREATE INDEX kb_search_gin  ON kb_articles USING gin  (search);
CREATE INDEX kb_search_gist ON kb_articles USING gist (search);
ANALYZE kb_articles;

SELECT indexrelid::regclass AS index_name,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_index WHERE indrelid = 'kb_articles'::regclass ORDER BY 1;

EXPLAIN (COSTS OFF)
SELECT count(*) FROM kb_articles
WHERE search @@ websearch_to_tsquery('english', 'replication standby');`,
      explain: `<p>Both index types can serve <code>@@</code> on a tsvector. The size query (not shown) reports both index sizes; the plan (shown) reveals which one the planner chose. On this tiny 400-row table it happens to pick the GiST index — its smaller size makes it look cheaper to the cost model. On large tables with selective queries, GIN usually wins clearly, because its posting lists produce exact candidates while GiST's lossy signatures force many heap rechecks. Lesson: never assume — compare with <code>EXPLAIN (ANALYZE, BUFFERS)</code> on production-sized data, and in production create only one of them (GIN by default; GiST for write-heavy tables where search is secondary).</p>`,
      output: ` QUERY PLAN
---------------------------------------------------------------------------
 Aggregate
   ->  Bitmap Heap Scan on kb_articles
         Recheck Cond: (search @@ '''replic'' & ''standbi'''::tsquery)
         ->  Bitmap Index Scan on kb_search_gist
               Index Cond: (search @@ '''replic'' & ''standbi'''::tsquery)
(5 rows)`, run: true },
    { label: 'Intermediate', title: 'FTS with a trigram "did you mean" fallback',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- vocabulary of lexemes actually present in the corpus
CREATE TABLE search_vocab AS
SELECT word, ndoc FROM ts_stat('SELECT to_tsvector(''simple'', title || '' '' || body) FROM documents');
CREATE INDEX search_vocab_trgm ON search_vocab USING gin (word gin_trgm_ops);

-- the user typed two misspelled words
WITH input AS (SELECT 'replcation standy' AS q),
fts AS (
  SELECT count(*) AS hits FROM documents, input
  WHERE search @@ websearch_to_tsquery('english', input.q)
),
corrected AS (
  SELECT string_agg(best.word, ' ' ORDER BY w.pos) AS suggestion
  FROM input,
       unnest(string_to_array(input.q, ' ')) WITH ORDINALITY AS w(term, pos),
       LATERAL (SELECT v.word FROM search_vocab v
                WHERE v.word % w.term
                ORDER BY similarity(v.word, w.term) DESC, v.ndoc DESC
                LIMIT 1) AS best
)
SELECT fts.hits AS hits_for_typo,
       corrected.suggestion,
       (SELECT string_agg(id::text, ',' ORDER BY id) FROM documents
        WHERE search @@ websearch_to_tsquery('english', corrected.suggestion)) AS ids_for_suggestion
FROM fts, corrected;`,
      explain: `<p><code>ts_stat</code> extracts every word in the corpus (using the <code>simple</code> config so suggestions are real words, not stems) into a vocabulary table with a trigram index. For the misspelled input, FTS finds nothing; each input term is then corrected to its most similar vocabulary word (ties broken by document frequency), and the corrected query is re-run. This is the classic "did you mean" pattern, entirely inside PostgreSQL.</p>`,
      output: ` hits_for_typo | suggestion          | ids_for_suggestion
---------------+---------------------+--------------------
 0             | replication standby | 3,5
(1 row)`, run: true },
    { label: 'Advanced', title: 'Multilingual documents with a per-row configuration',
      sql: `CREATE TABLE help_articles (
  id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lang  regconfig NOT NULL,                 -- e.g. 'english', 'german', 'simple'
  title text NOT NULL,
  body  text NOT NULL,
  search tsvector GENERATED ALWAYS AS
    (setweight(to_tsvector(lang, title), 'A') || setweight(to_tsvector(lang, body), 'B')) STORED
);
CREATE INDEX help_articles_search ON help_articles USING gin (search);

INSERT INTO help_articles (lang, title, body) VALUES
 ('english', 'Returning products',       'Products can be returned within 30 days of delivery.'),
 ('german',  'Produkte zurückgeben',     'Produkte können innerhalb von 30 Tagen zurückgegeben werden.'),
 ('simple',  'Refund kaise milega',      'Refund 7 din mein original payment method par milega.');

-- search each language with its own configuration, then merge
SELECT a.id, a.lang, a.title, round(ts_rank(a.search, q.query)::numeric, 3) AS rank
FROM help_articles a
JOIN (VALUES ('english'::regconfig, 'returned products'),
             ('german'::regconfig,  'zurückgegeben Produkt'),
             ('simple'::regconfig,  'refund milega')) AS s(lang, text_query)
  ON s.lang = a.lang
CROSS JOIN LATERAL (SELECT plainto_tsquery(s.lang, s.text_query) AS query) q
WHERE a.search @@ q.query
ORDER BY rank DESC, a.id;`,
      explain: `<p>The <code>lang</code> column of type <code>regconfig</code> drives both the generated tsvector and the query configuration, so English text is stemmed with the English stemmer, German with the German one, and Hinglish (Hindi written in Latin script) uses <code>simple</code> because no stemmer fits. Each query is built with the matching configuration and joined to rows of the same language. A generated column can use the <code>lang</code> column because <code>to_tsvector(regconfig, text)</code> is immutable.</p>`,
      output: ` id | lang    | title                | rank
----+---------+----------------------+-------
 1  | english | Returning products   | 0.999
 3  | simple  | Refund kaise milega  | 0.997
 2  | german  | Produkte zurückgeben | 0.610
(3 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Computing the vector at query time: CPU-heavy and cannot use the GIN index
SELECT id, title FROM documents
WHERE to_tsvector('english', title || ' ' || body) @@ websearch_to_tsquery('english', 'backup')
ORDER BY id;`,
      why: 'Every row is parsed and stemmed on every search; no index on that expression exists, so it is a full scan.', run: true },
    good: { sql: `-- precomputed generated column + GIN index (already defined on documents)
SELECT id, title FROM documents
WHERE search @@ websearch_to_tsquery('english', 'backup')
ORDER BY id;`,
      why: 'The stored tsvector is computed once per write and the GIN index finds matches directly.', run: true }
  },
  mistakes: [
    `Computing <code>to_tsvector</code> in the WHERE clause on every query instead of storing it.`,
    `Building the tsvector with <code>coalesce</code>-less concatenation: <code>title || ' ' || body</code> is NULL if any part is NULL, so the row becomes unsearchable.`,
    `Mixing languages in one configuration (English stemming German words) and getting poor recall.`,
    `Ignoring GIN pending-list effects on write-heavy tables (latency spikes); tune <code>gin_pending_list_limit</code> or vacuum more often.`,
    `Moving to Elasticsearch prematurely and then fighting sync lag, duplicated permissions and operational overhead.`,
    `Trigram-matching entire long documents for typos instead of a word vocabulary.`
  ],
  best: [
    `Store search vectors in a generated column with explicit configuration and weights; index with GIN.`,
    `Use <code>websearch_to_tsquery</code> for input, <code>LIMIT</code> before <code>ts_headline</code>.`,
    `Add pg_trgm on titles/names and a vocabulary table for "did you mean".`,
    `Keep language per row (<code>regconfig</code>) for multilingual content; use <code>simple</code> as a fallback.`,
    `Measure: query latency percentiles, zero-result rate and click-through, before deciding to add a search engine.`,
    `If you add Elasticsearch/OpenSearch, keep PostgreSQL as the source of truth and feed the engine via CDC/outbox.`
  ],
  performance: `<p>GIN tsvector searches on tens of millions of rows return selective results in milliseconds; broad queries and ranking dominate cost. Generated columns add parse/stem CPU on every write of the source columns (typically tens to hundreds of microseconds per KB of text). For bulk loads, create the GIN index after loading (with high <code>maintenance_work_mem</code>) — building is much faster than incremental inserts. GiST indexes degrade as documents grow (more false positives). Watch index bloat on update-heavy tables; <code>REINDEX CONCURRENTLY</code> periodically if needed.</p>`,
  security: `<p>Search often crosses tenant or permission boundaries: always apply the same row-level filters (or RLS) to search queries as to normal reads. If you export data to an external search engine, you must replicate permission models there or filter results back through PostgreSQL. Protect search endpoints with rate limits and <code>statement_timeout</code>, and never build tsquery strings from raw input with <code>to_tsquery</code>.</p>`,
  scenario: { title: 'Search is slow and users complain about zero results', steps: [
    '1. Check EXPLAIN: to_tsvector computed per row → add a stored generated tsvector column + GIN index.',
    '2. Replace to_tsquery(user input) with websearch_to_tsquery to stop syntax errors.',
    '3. Rank and LIMIT before ts_headline; p95 latency drops.',
    '4. Log zero-result queries; most are typos or partial words.',
    '5. Add a vocabulary table from ts_stat with a trigram index for "did you mean", and trigram search on product titles.',
    '6. Re-evaluate: if relevance tuning, synonyms and QPS needs exceed PostgreSQL, plan CDC into OpenSearch.'
  ] },
  interview: [
    { q: 'GIN or GiST for full-text search?', a: 'GIN is the default choice: an inverted index with exact posting lists and fast lookups, at the cost of larger size and slower updates (mitigated by fastupdate). GiST is smaller and cheaper to update but lossy, causing more rechecks and slower searches; it suits write-heavy tables with light search.' },
    { q: 'How would you add typo tolerance to PostgreSQL full-text search?', a: 'Use pg_trgm: build a vocabulary of corpus words with ts_stat, index it with a trigram GIN index, correct each query term to the most similar vocabulary word with % and similarity(), and re-run the FTS query; or index titles with trigrams and blend trigram similarity with FTS rank.' },
    { q: 'When would you move search to Elasticsearch/OpenSearch?', a: 'When you need advanced relevance (BM25 tuning, synonyms, per-field analyzers, learning-to-rank), large faceted aggregations at low latency, typo tolerance at scale, or search traffic that would overload the OLTP database — accepting a second system, a sync pipeline and eventual consistency.' },
    { q: 'How do you handle multilingual content?', a: 'Store a regconfig language per row, build the tsvector with to_tsvector(lang, ...), and build queries with the same configuration (searching each language with its own config); use simple for languages without stemmers or mixed scripts, possibly combined with trigram matching.' }
  ],
  exercises: [
    { task: 'Use ts_stat to list the 10 most frequent lexemes across all documents (by number of documents containing them).', solution: `SELECT word, ndoc, nentry
FROM ts_stat('SELECT search FROM documents')
ORDER BY ndoc DESC, nentry DESC, word
LIMIT 10;`, run: true },
    { task: 'Find documents matching "replica" with FTS OR whose title is trigram-similar to "Replicaton" (typo), labelling which method matched.', solution: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT id, title,
       search @@ websearch_to_tsquery('english', 'replica') AS fts_match,
       title % 'Replicaton' OR word_similarity('Replicaton', title) > 0.5 AS trigram_match
FROM documents
WHERE search @@ websearch_to_tsquery('english', 'replica')
   OR word_similarity('Replicaton', title) > 0.5
ORDER BY id;`, run: true }
  ],
  challenge: { task: 'Build a products search: add a generated tsvector to products (name weight A, category weight B, brand from attributes weight C, english config), index it with GIN, and write a query for "keyboard acme" that blends 0.7 × ts_rank(…, 32) with 0.3 × trigram similarity of the name, returning the top 5.', hint: 'coalesce(attributes ->> \'brand\', \'\') inside the generated expression; CREATE EXTENSION pg_trgm for similarity().', solution: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE products ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', name), 'A') ||
  setweight(to_tsvector('english', category), 'B') ||
  setweight(to_tsvector('english', coalesce(attributes ->> 'brand', '')), 'C')) STORED;
CREATE INDEX products_search_gin ON products USING gin (search);

SELECT sku, name, attributes ->> 'brand' AS brand,
       round((0.7 * ts_rank(search, q, 32) + 0.3 * similarity(name, 'keyboard acme'))::numeric, 4) AS score
FROM products, websearch_to_tsquery('english', 'keyboard or acme') q
WHERE search @@ q
ORDER BY score DESC, sku
LIMIT 5;`, run: true },
  related: ['full-text-search-basics', 'full-text-search-ranking', 'extensions-pg-trgm', 'vector-search', 'production-architecture'],
  quiz: [
    { type: 'mcq', q: 'Which index type is the usual default for tsvector search?', options: ['B-tree', 'Hash', 'GIN', 'BRIN'], answer: 2, explain: 'GIN inverted indexes are the standard choice for tsvector.' },
    { type: 'tf', q: 'A stored generated tsvector column can depend on columns of another table.', answer: false, explain: 'Generated columns can only reference columns of the same row; cross-table vectors need triggers or a materialized view.' },
    { type: 'scenario', q: 'Users frequently misspell product names and get zero results. PostgreSQL-only fix?', options: ['Switch to the simple config', 'Add pg_trgm: vocabulary-based "did you mean" and trigram matching on titles', 'Use phraseto_tsquery', 'Increase work_mem'], answer: 1, explain: 'FTS has no typo tolerance; trigram similarity adds it.' },
    { type: 'design', q: 'You need BM25 relevance tuning, per-category synonyms, faceted counts over millions of hits in <50 ms, at 3 000 QPS. Best architecture?', options: ['GiST index on tsvector', 'More GIN indexes', 'PostgreSQL as source of truth + CDC into Elasticsearch/OpenSearch', 'Materialized view of all searches'], answer: 2, explain: 'Those requirements exceed what built-in FTS offers comfortably; a dedicated search engine fed by CDC fits.' },
    { type: 'bug', q: 'Why are some articles never found?', code: `ALTER TABLE articles ADD COLUMN search tsvector GENERATED ALWAYS AS
  (to_tsvector('english', title || ' ' || subtitle || ' ' || body)) STORED;`, options: ['english config is wrong', 'If subtitle is NULL the whole concatenation is NULL', 'Generated columns cannot be tsvector', 'Needs setweight'], answer: 1, explain: 'NULL || text is NULL; wrap each part in coalesce(..., \'\') or use concat_ws.' }
  ]
}
]);
