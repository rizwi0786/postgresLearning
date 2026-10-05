/* =====================================================================
   lessons-02-sql.js — Intermediate SQL modules:
   joins, aggregations, subqueries, ctes, window-functions,
   transactions, constraints  (25 lessons)
   All runnable examples target the shared company_db.
   ===================================================================== */

/* ---------------------------------------------------------------------
   MODULE: joins (5 lessons)
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'joins-inner-join',
  module: 'joins',
  title: 'INNER JOIN: Combining Related Rows',
  level: 2,
  minutes: 18,
  summary: 'Match rows from two or more tables on a join condition and keep only the pairs that match on both sides.',
  objectives: [
    'Explain what an INNER JOIN produces in terms of matching row pairs',
    'Write joins with ON, USING and multi-table chains across company_db',
    'Predict row counts for one-to-many and many-to-many joins (fan-out)',
    'Use table aliases and qualified column names to avoid ambiguity',
    'Recognise when a join silently drops rows because of NULL keys',
    'Read the join part of an EXPLAIN plan'
  ],
  concept: `<p>A relational database stores each fact once, in the table where it belongs: an employee row stores a <code>department_id</code>, not the department name, budget and location. A <strong>join</strong> puts the facts back together at query time. An <strong>INNER JOIN</strong> takes every row from the left table, looks for rows in the right table where the <em>join condition</em> is true, and emits one combined row per matching pair. Rows that find no partner on the other side simply disappear from the result.</p>
<p><strong>Analogy:</strong> think of a wedding seating plan. One list has guests with a table number, another list has table numbers with a table name ("Family", "College friends"). An inner join is a clerk who walks down the guest list and, for each guest, finds the table card with the same number and staples the two cards together. A guest with no table number, or a table nobody was assigned to, produces no stapled pair — they are not in the output.</p>
<p>Key properties you must internalise:</p>
<ul>
<li><strong>It is a filtered Cartesian product.</strong> Logically, <code>A JOIN B ON cond</code> is "every combination of A and B where <code>cond</code> is true". The planner never actually builds the full product; it uses Nested Loop, Hash or Merge joins (see the join-algorithms lesson).</li>
<li><strong>Cardinality follows the keys.</strong> Joining <code>employees</code> (200 rows) to <code>departments</code> (8 rows) on the FK returns 200 rows: each employee matches exactly one department. Joining <code>departments</code> to <code>employees</code> also returns 200 — each department is <em>repeated</em> once per employee. This repetition is called <em>fan-out</em> and is the root of most "my SUM is too big" bugs.</li>
<li><strong>NULL never matches.</strong> <code>NULL = NULL</code> is not true (it is NULL), so a row whose join key is NULL is dropped by an inner join. Our 8 department heads have <code>manager_id IS NULL</code>, so joining employees to their manager returns 192 rows, not 200.</li>
<li><strong>JOIN and INNER JOIN are identical.</strong> The keyword INNER is optional. The old comma syntax <code>FROM a, b WHERE a.x = b.x</code> is also an inner join, but it mixes join conditions with filters and makes forgotten conditions (accidental cross joins) easy.</li>
<li><strong>USING and NATURAL.</strong> <code>JOIN t USING (col)</code> joins on equally named columns and outputs that column once. <code>NATURAL JOIN</code> joins on <em>all</em> same-named columns — dangerous, because adding a column such as <code>created_at</code> to both tables silently changes the join condition. Avoid NATURAL in production code.</li>
</ul>`,
  why: `<p>Normalisation splits data into many tables so that each fact is stored once and updates cannot create contradictions. The price is that almost every useful question — "revenue by customer country", "which engineers work on Project Helix" — needs data from several tables. INNER JOIN is the workhorse that answers those questions declaratively: you state the relationship, PostgreSQL chooses how to execute it.</p>`,
  useCase: `<p>An Indian e-commerce company with 5 million orders a month builds its daily sales dashboard from <code>orders</code> &rarr; <code>order_items</code> &rarr; <code>products</code> and <code>orders</code> &rarr; <code>customers</code>. A four-table inner join, filtered to yesterday's paid orders, produces revenue per category per country. With an index on <code>order_items(order_id)</code> and a date filter on <code>orders</code>, the query touches about 170k orders and 420k items and runs in under a second; without the date filter it would hash-join the full history.</p>`,
  internals: `<p>The parser turns the join into a join tree; the planner then treats a chain of inner joins as freely reorderable (inner joins are associative and commutative), and searches join orders using dynamic programming up to <code>join_collapse_limit</code> (default 8) relations, and the genetic optimiser (GEQO) beyond <code>geqo_threshold</code> (default 12). For each pair it estimates the output row count from column statistics in <code>pg_statistic</code> (n_distinct, most-common values, histograms) and picks Nested Loop, Hash Join or Merge Join by cost. Conditions in ON for an inner join are semantically the same as conditions in WHERE — the planner pushes them to wherever they are cheapest.</p>`,
  whenNot: `<p>Do not use an inner join when you need to keep rows that have no match (use LEFT JOIN), or when you only want to <em>test</em> existence and not return columns from the other table (use <code>EXISTS</code> — it never duplicates the outer row). Avoid joining a one-to-many relationship before aggregating the "one" side's numbers: aggregate first in a subquery or CTE, then join.</p>`,
  syntax: `SELECT select_list
FROM table_a [AS] a
[INNER] JOIN table_b [AS] b ON a.col = b.col [AND ...]
[INNER] JOIN table_c c USING (shared_col)
WHERE ...;`,
  examples: [
    { label: 'Basic', title: 'Employees with their department name',
      sql: `SELECT e.id, e.first_name, e.last_name, d.name AS department, d.location
FROM employees e
JOIN departments d ON d.id = e.department_id
ORDER BY e.id
LIMIT 6;`,
      explain: `<p><code>FROM employees e</code> gives the table a short alias. <code>JOIN departments d ON d.id = e.department_id</code> pairs each employee with the department whose primary key equals the employee's foreign key. Each employee has exactly one department, so the join neither loses nor duplicates employees (200 in, 200 out). We qualify every column (<code>e.</code>, <code>d.</code>) — both tables have an <code>id</code> column, and an unqualified <code>id</code> would raise "column reference is ambiguous".</p>`,
      output: ` id | first_name | last_name | department  | location
----+------------+-----------+-------------+-----------
  1 | Asha       | Rao       | Engineering | Bengaluru
  2 | Rohan      | Mehta     | Sales       | Mumbai
  3 | Meera      | Iyer      | Marketing   | Delhi
  4 | Vikram     | Singh     | Finance     | Gurugram
  5 | Priya      | Nair      | HR          | Pune
  6 | Arjun      | Kapoor    | Operations  | Chennai
(6 rows)`, run: true },
    { label: 'Intermediate', title: 'Three-table chain: who works on which project',
      sql: `SELECT p.name AS project, e.id AS emp_id,
       e.first_name || ' ' || e.last_name AS employee,
       ep.role, ep.allocation_pct
FROM projects p
JOIN employee_projects ep ON ep.project_id = p.id
JOIN employees e          ON e.id = ep.employee_id
WHERE p.name = 'Project Helix'
ORDER BY ep.role, employee, e.id;`,
      explain: `<p><code>employee_projects</code> is a junction table that resolves the many-to-many relationship between employees and projects. We walk project &rarr; junction &rarr; employee. The <code>WHERE</code> filter on the project name is applied first by the planner (predicate pushdown), so only that project's junction rows are joined to employees. <code>ORDER BY employee</code> refers to the output alias, which is allowed in ORDER BY.</p>`,
      output: ` project       | emp_id | employee       | role | allocation_pct
---------------+--------+----------------+------+----------------
 Project Helix |    125 | Ananya Khan    | lead |             50
 Project Helix |     11 | Anika Gupta    | lead |            100
 Project Helix |    131 | Anika Gupta    | lead |            100
 Project Helix |    101 | Diya Gupta     | lead |             50
 Project Helix |     83 | Isha Saxena    | lead |            100
 Project Helix |     29 | Myra Pillai    | lead |             50
 Project Helix |    149 | Myra Pillai    | lead |             50
 Project Helix |     77 | Neha Agarwal   | lead |             50
 Project Helix |    197 | Neha Agarwal   | lead |             50
 Project Helix |     59 | Pooja Pillai   | lead |            100
 Project Helix |    179 | Pooja Pillai   | lead |            100
 Project Helix |    107 | Saanvi Agarwal | lead |            100
 ... (4 more rows)
(16 rows)`, run: true },
    { label: 'Advanced', title: 'Revenue per product category and customer country (four tables)',
      sql: `SELECT p.category, c.country,
       count(DISTINCT o.id)                    AS orders,
       sum(oi.quantity * oi.unit_price)::numeric(14,2) AS revenue
FROM orders o
JOIN customers   c  ON c.id = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
JOIN products    p  ON p.id = oi.product_id
WHERE o.status IN ('paid','shipped','delivered')
  AND o.order_date >= '2025-01-01' AND o.order_date < '2025-04-01'
GROUP BY p.category, c.country
ORDER BY revenue DESC
LIMIT 8;`,
      explain: `<p>This is the classic star-shaped reporting join. <code>orders</code> is joined to its customer (many-to-one, no fan-out) and to its items (one-to-many, fan-out!). Because each order now appears once per item, we use <code>count(DISTINCT o.id)</code> to count orders, and compute revenue at item level (<code>quantity * unit_price</code>) instead of summing <code>o.total_amount</code>, which would be multiplied by the number of items. The half-open date range <code>&gt;= start AND &lt; end</code> is index-friendly and has no end-of-day bugs.</p>`,
      output: ` category    | country   | orders | revenue
-------------+-----------+--------+-------------
 furniture   | India     |    108 | 12502545.14
 accessories | India     |    108 | 10407659.02
 electronics | India     |    103 |  8541083.83
 audio       | India     |     68 |  7194181.19
 accessories | USA       |     51 |  5240985.99
 furniture   | Singapore |     42 |  5061915.57
 furniture   | USA       |     41 |  4702060.45
 video       | India     |     42 |  4327342.35
(8 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Fan-out bug: order totals are repeated once per order item
SELECT c.country, sum(o.total_amount) AS revenue
FROM orders o
JOIN customers c    ON c.id = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
GROUP BY c.country
ORDER BY revenue DESC;`, why: 'Each order has about 2.5 items, so every total_amount is added 2-3 times. The report silently overstates revenue by ~150% and nobody notices because the numbers look plausible.', run: true },
    good: { sql: `-- Aggregate at the correct grain: one row per order
SELECT c.country, sum(o.total_amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
GROUP BY c.country
ORDER BY revenue DESC;`, why: 'Only join tables you need. The customer join is many-to-one, so each order is counted once. If you need item data too, aggregate items per order in a subquery first and join the result.', run: true }
  },
  mistakes: [
    `Summing a "parent" column (like <code>orders.total_amount</code>) after joining a child table (<code>order_items</code>) — the fan-out multiplies the parent value.`,
    `Forgetting a join condition in comma syntax (<code>FROM a, b, c WHERE a.id = b.a_id</code>) — table <code>c</code> becomes a Cartesian product.`,
    `Expecting rows with a NULL foreign key to appear — inner joins drop them. Department heads disappear when joining employees to managers.`,
    `Using <code>NATURAL JOIN</code>: a later <code>ALTER TABLE ... ADD COLUMN created_at</code> on both tables silently changes the join and returns zero rows.`,
    `Unqualified column names in multi-table queries — works today, breaks with "ambiguous column" when someone adds a same-named column tomorrow.`
  ],
  best: [
    `Always alias tables and qualify every column (<code>e.salary</code>, not <code>salary</code>) in joins.`,
    `Prefer explicit <code>JOIN ... ON</code> over comma joins; it separates relationships (ON) from filters (WHERE).`,
    `Index foreign key columns on the "many" side (e.g. <code>order_items(order_id)</code>) — PostgreSQL does not create them automatically.`,
    `Before aggregating, ask "what is the grain of one row after the joins?" and use <code>count(DISTINCT ...)</code> or pre-aggregation when it changed.`,
    `Filter as early as possible (date ranges, status) so the planner joins fewer rows.`
  ],
  performance: `<p>Join cost is dominated by the number of rows each side contributes after filtering and by whether the inner side can be reached by an index. A selective filter on <code>orders.order_date</code> plus an index on <code>order_items(order_id)</code> lets the planner use a nested loop with index scans; reporting over all history usually becomes a hash join with sequential scans, which is fine and often fastest for large fractions of a table. Bad row estimates (e.g. correlated columns) are the most common cause of slow joins — check <code>EXPLAIN ANALYZE</code> for estimated vs actual rows. Keep <code>work_mem</code> large enough that hash joins do not spill into batches.</p>`,
  security: `<p>Joins can leak data across tenants: joining <code>users</code> to another table without also matching <code>tenant_id</code> can return other tenants' rows. In multi-tenant schemas enforce isolation with Row-Level Security policies rather than trusting every query author to add the tenant predicate to every join.</p>`,
  scenario: { title: 'The finance dashboard shows 2.5x the real revenue', steps: [
    '1. Compare the dashboard total with SELECT sum(total_amount) FROM orders for the same period — they differ.',
    '2. Inspect the query: it joins orders to order_items and sums orders.total_amount.',
    '3. Check the grain: SELECT count(*) FROM orders vs the joined row count — the join multiplies rows.',
    '4. Fix: compute revenue from sum(quantity * unit_price) at item grain, or pre-aggregate items per order and join that.',
    '5. Add a regression test that compares the report total to a single-table control total.'
  ] },
  widgets: ['diagram:joins', 'lab:join'],
  interview: [
    { q: 'What is the difference between JOIN ... ON and a WHERE condition for an inner join?', a: 'For INNER JOIN they are semantically equivalent; the planner treats ON and WHERE predicates the same and pushes them down freely. The difference matters for outer joins, where ON decides which rows match and WHERE filters the result after NULL-extension. Style-wise, ON should hold relationships and WHERE should hold filters.' },
    { q: 'Why can a join return more rows than either input table?', a: 'Because the result has one row per matching pair. In a one-to-many or many-to-many relationship each row on one side can match many rows on the other, so the output grows (fan-out). An inner join of 5,000 orders to 12,500 items yields 12,500 rows.' },
    { q: 'Why does an inner join drop rows with NULL keys?', a: 'Comparison with NULL yields NULL, not true, and join conditions keep only pairs where the condition is true. So a NULL foreign key can never match anything; use a LEFT JOIN if those rows must be kept.' },
    { q: 'How does PostgreSQL decide the order in which to join five tables?', a: 'Inner joins are reorderable, so the planner enumerates join orders with dynamic programming (up to join_collapse_limit relations, default 8) and estimates the cost of each using table statistics, choosing the cheapest. Beyond geqo_threshold relations it uses the genetic query optimiser.' }
  ],
  exercises: [
    { task: 'List every project with its owning department name and location, ordered by project name.', solution: `SELECT p.name AS project, d.name AS department, d.location
FROM projects p
JOIN departments d ON d.id = p.department_id
ORDER BY p.name;`, run: true },
    { task: 'Show each payment with the order status and the customer name for payments made by UPI that failed. Limit to 10.', solution: `SELECT pay.id, pay.amount, o.status AS order_status, c.name AS customer
FROM payments pay
JOIN orders o    ON o.id = pay.order_id
JOIN customers c ON c.id = o.customer_id
WHERE pay.method = 'upi' AND pay.status = 'failed'
ORDER BY pay.id
LIMIT 10;`, run: true },
    { task: 'Count how many employees from each department are assigned as project "lead". Show department name and count.', solution: `SELECT d.name, count(*) AS leads
FROM employee_projects ep
JOIN employees e   ON e.id = ep.employee_id
JOIN departments d ON d.id = e.department_id
WHERE ep.role = 'lead'
GROUP BY d.name
ORDER BY leads DESC;`, run: true }
  ],
  challenge: { task: 'For each product category, return total units sold and revenue for delivered orders only, but compute revenue without fan-out bugs and verify that the grand total equals sum(quantity*unit_price) for delivered orders.', hint: 'Join order_items to products and orders; aggregate at item grain. Use GROUPING SETS or a separate control query for the total.', solution: `SELECT coalesce(p.category, 'ALL') AS category,
       sum(oi.quantity) AS units,
       sum(oi.quantity * oi.unit_price)::numeric(14,2) AS revenue
FROM order_items oi
JOIN orders o   ON o.id = oi.order_id AND o.status = 'delivered'
JOIN products p ON p.id = oi.product_id
GROUP BY ROLLUP (p.category)
ORDER BY revenue DESC;`, run: true },
  related: ['joins-outer-joins', 'joins-algorithms', 'aggregations', 'subqueries'],
  quiz: [
    { type: 'mcq', q: 'employees has 200 rows, 8 of which have manager_id NULL. How many rows does employees e JOIN employees m ON m.id = e.manager_id return?', options: ['200', '192', '8', '40000'], answer: 1, explain: 'Each employee has at most one manager; the 8 heads with NULL manager_id find no match and are removed by the inner join.' },
    { type: 'tf', q: 'For an INNER JOIN, moving a filter from WHERE into the ON clause can change the result.', answer: false, explain: 'For inner joins ON and WHERE predicates are equivalent. It only changes results for outer joins.' },
    { type: 'bug', q: 'Why is this revenue too high?', code: `SELECT sum(o.total_amount)
FROM orders o JOIN order_items oi ON oi.order_id = o.id;`, options: ['total_amount is numeric', 'Each order is repeated once per item, so its total is summed multiple times', 'Missing GROUP BY', 'JOIN should be LEFT JOIN'], answer: 1, explain: 'Classic fan-out: the join changes the grain from order to item.' },
    { type: 'predict', q: 'What happens with this query?', code: `SELECT id, name FROM departments d JOIN projects p ON p.department_id = d.id;`, options: ['Returns department ids and names', 'ERROR: column reference "id" is ambiguous', 'Returns project ids', 'Returns 8 rows'], answer: 1, explain: 'Both tables have id and name columns; unqualified references are ambiguous.' },
    { type: 'write', q: 'Write a query returning customer name and order id for the 5 most recent cancelled orders.', solution: `SELECT c.name, o.id, o.order_date
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'cancelled'
ORDER BY o.order_date DESC
LIMIT 5;`, explain: 'Join on the FK, filter status, order by date descending.' }
  ]
},
{
  id: 'joins-outer-joins',
  module: 'joins',
  title: 'LEFT, RIGHT and FULL OUTER JOIN',
  level: 2,
  minutes: 20,
  summary: 'Keep unmatched rows from one or both sides, find missing data with the anti-join pattern, and avoid the ON vs WHERE trap.',
  objectives: [
    'Explain how outer joins NULL-extend unmatched rows',
    'Choose between LEFT, RIGHT and FULL OUTER JOIN',
    'Write the LEFT JOIN ... IS NULL anti-join to find missing relationships',
    'Explain why a WHERE filter on the right table turns a LEFT JOIN into an inner join',
    'Place filters correctly in ON vs WHERE',
    'Count correctly with COUNT(right.col) after a LEFT JOIN'
  ],
  concept: `<p>An <strong>outer join</strong> is an inner join plus the rows that did not find a partner. For those unmatched rows, every column of the other table is filled with NULL — this is called <em>NULL-extension</em>.</p>
<ul>
<li><strong>LEFT [OUTER] JOIN</strong> keeps every row of the left table. If a left row matches 3 right rows you get 3 rows; if it matches none you get 1 row with NULLs on the right.</li>
<li><strong>RIGHT [OUTER] JOIN</strong> is the mirror image. <code>A RIGHT JOIN B</code> is exactly <code>B LEFT JOIN A</code>; most teams standardise on LEFT for readability.</li>
<li><strong>FULL [OUTER] JOIN</strong> keeps unmatched rows from both sides — ideal for reconciliation ("what is in system A but not B, and vice versa").</li>
</ul>
<p><strong>Analogy:</strong> a teacher's register (left table) and today's homework submissions (right table). A LEFT JOIN prints every student; students who did not submit still appear, with an empty "submission" column. That empty column is exactly how you find who is missing — the <em>anti-join</em> pattern: <code>LEFT JOIN ... WHERE right.key IS NULL</code>.</p>
<h4>The ON vs WHERE trap</h4>
<p>For outer joins, ON and WHERE mean different things:</p>
<ul>
<li><strong>ON</strong> decides <em>which right rows count as a match</em>. A left row with no qualifying match is still kept (NULL-extended).</li>
<li><strong>WHERE</strong> runs <em>after</em> the join and filters the final rows. A condition like <code>WHERE o.status = 'paid'</code> is false (NULL) for NULL-extended rows, so it deletes them — your LEFT JOIN silently became an INNER JOIN. PostgreSQL's planner even detects this ("outer join reduction") and plans it as an inner join.</li>
</ul>
<p>Rule of thumb: conditions on the <em>optional</em> (right) side of a LEFT JOIN go in ON; conditions on the <em>preserved</em> (left) side go in WHERE. The only right-side condition that belongs in WHERE is the anti-join test <code>IS NULL</code> on a NOT NULL column (typically the right table's primary key or join key).</p>`,
  why: `<p>Business questions are often about absence: customers who never ordered, products never sold, orders without a payment, employees without a project. Inner joins cannot express absence because they drop exactly those rows. Outer joins also let reports show "zero" rows (a department with 0 projects this quarter) instead of omitting them, which matters for dashboards and charts.</p>`,
  useCase: `<p>A payments team reconciles 4,585 gateway payments against 5,000 orders every night. A <code>LEFT JOIN payments</code> from <code>orders</code> with <code>WHERE p.order_id IS NULL</code> lists the 415 orders still waiting for payment (all of them <code>pending</code>); a FULL JOIN between the gateway settlement file (loaded into a staging table) and <code>payments</code> finds both "money received but no payment row" and "payment row but no settlement" in one pass.</p>`,
  internals: `<p>The executor implements outer joins with the same three algorithms as inner joins (Nested Loop Left Join, Hash Left/Right/Full Join, Merge Left/Full Join). When the inner side finds no match for an outer tuple, the node emits the outer tuple with a NULL tuple for the inner side. The planner can reorder outer joins only under specific identities, so they constrain join order more than inner joins. The anti-join pattern <code>LEFT JOIN ... WHERE inner.notnull_col IS NULL</code> is recognised and planned as a <strong>Hash Anti Join</strong> / <strong>Nested Loop Anti Join</strong> — the same plan node used for <code>NOT EXISTS</code>.</p>`,
  whenNot: `<p>If you only need "rows of A that have (or lack) a match in B" and no columns from B, prefer <code>EXISTS</code> / <code>NOT EXISTS</code>: they state intent, never duplicate A rows and are planned as semi/anti joins. Avoid <code>RIGHT JOIN</code> in mixed chains — rewrite as LEFT JOIN with tables reordered. Avoid FULL JOIN on large tables without a selective filter: it cannot use a nested loop and must process both sides completely.</p>`,
  syntax: `SELECT ...
FROM a
LEFT  [OUTER] JOIN b ON a.id = b.a_id [AND b.extra_condition]
RIGHT [OUTER] JOIN c ON ...
FULL  [OUTER] JOIN d ON ...
WHERE ...;            -- runs after NULL-extension

-- anti-join (rows of a with no b):
SELECT a.* FROM a LEFT JOIN b ON b.a_id = a.id WHERE b.a_id IS NULL;`,
  examples: [
    { label: 'Basic', title: 'Employees with their projects, keeping people with none',
      sql: `SELECT e.id, e.first_name, e.job_title,
       count(ep.project_id) AS project_count
FROM employees e
LEFT JOIN employee_projects ep ON ep.employee_id = e.id
GROUP BY e.id, e.first_name, e.job_title
ORDER BY project_count, e.id
LIMIT 10;`,
      explain: `<p>Every employee appears, including the 8 department heads who have no rows in <code>employee_projects</code>. For them the right side is NULL. <code>count(ep.project_id)</code> counts only non-NULL values, giving 0; <code>count(*)</code> would wrongly report 1 because the NULL-extended row still exists. Grouping by <code>e.id</code> (the primary key) lets PostgreSQL accept the other <code>e.</code> columns too, but listing them is clearer.</p>`,
      output: ` id | first_name | job_title          | project_count
----+------------+--------------------+---------------
  1 | Asha       | Head of Department |             0
  2 | Rohan      | Head of Department |             0
  3 | Meera      | Head of Department |             0
  4 | Vikram     | Head of Department |             0
  5 | Priya      | Head of Department |             0
  6 | Arjun      | Head of Department |             0
  7 | Kavya      | Head of Department |             0
  8 | Nikhil     | Head of Department |             0
 10 | Sai        | Lead               |             1
 12 | Ishaan     | Engineer           |             1
(10 rows)`, run: true },
    { label: 'Intermediate', title: 'Anti-join: orders that have no payment',
      sql: `SELECT o.status, count(*) AS orders_without_payment
FROM orders o
LEFT JOIN payments p ON p.order_id = o.id
WHERE p.id IS NULL
GROUP BY o.status;`,
      explain: `<p>The LEFT JOIN keeps every order; orders with no payment get <code>p.id = NULL</code>. <code>WHERE p.id IS NULL</code> keeps only those. We test <code>p.id</code> (the primary key, never NULL in a real row), so a NULL can only mean "no match". The result shows that exactly the 415 pending orders lack a payment — a data-quality check you can schedule.</p>`,
      output: ` status  | orders_without_payment
---------+------------------------
 pending |                    415
(1 row)`, run: true },
    { label: 'Advanced', title: 'ON vs WHERE: counting paid orders per customer, keeping zero rows',
      sql: `-- Wrong: the WHERE removes customers without paid orders
SELECT count(*) AS customers_in_result
FROM (SELECT c.id
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id
      WHERE o.status = 'paid'
      GROUP BY c.id) t;

-- Right: the status condition belongs to the join
SELECT count(*) AS customers_in_result,
       count(*) FILTER (WHERE paid_orders = 0) AS customers_with_zero_paid
FROM (SELECT c.id, count(o.id) AS paid_orders
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
      GROUP BY c.id) t;`,
      explain: `<p>In the first query, customers whose orders are all non-paid get NULL-extended or non-matching rows, and <code>WHERE o.status = 'paid'</code> discards them: fewer than 500 customers survive and the zero counts are lost. In the second, <code>o.status = 'paid'</code> is part of the match condition: customers without paid orders still appear once with NULLs and <code>count(o.id) = 0</code>. All 500 customers are reported.</p>`,
      output: ` customers_in_result
---------------------
                 397
(1 row)

 customers_in_result | customers_with_zero_paid
---------------------+--------------------------
                 500 |                      103
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Looks like a LEFT JOIN, behaves like an INNER JOIN
SELECT d.name, count(p.id) AS active_projects
FROM departments d
LEFT JOIN projects p ON p.department_id = d.id
WHERE p.status = 'active'
GROUP BY d.name
ORDER BY d.name;`, why: 'The WHERE on the right table discards departments with no active project; they vanish from the report instead of showing 0.', run: true },
    good: { sql: `SELECT d.name, count(p.id) AS active_projects
FROM departments d
LEFT JOIN projects p ON p.department_id = d.id AND p.status = 'active'
GROUP BY d.name
ORDER BY d.name;`, why: 'Filtering the optional side in ON keeps every department and correctly reports 0 for those without active projects.', run: true }
  },
  mistakes: [
    `Putting a filter on the right table of a LEFT JOIN into WHERE, turning it into an inner join.`,
    `Using <code>count(*)</code> after a LEFT JOIN — it counts the NULL-extended row as 1. Use <code>count(right.pk)</code>.`,
    `Anti-join testing a nullable column (<code>WHERE b.comment IS NULL</code>) — real matches with NULL comments are also returned.`,
    `Chaining <code>LEFT JOIN b ... JOIN c ON c.b_id = b.id</code> — the inner join to c removes the NULL-extended rows from b. Make the second one LEFT too, or join c inside a parenthesised group.`,
    `Mixing RIGHT and LEFT joins in one query, which makes the preserved side hard to reason about.`
  ],
  best: [
    `Standardise on LEFT JOIN; rewrite RIGHT JOINs by swapping table order.`,
    `Put optional-side conditions in ON, preserved-side conditions in WHERE.`,
    `For anti-joins, test the right side's primary key or join column <code>IS NULL</code>, or use <code>NOT EXISTS</code>.`,
    `Use <code>coalesce(sum(x), 0)</code> to show zero instead of NULL for unmatched groups.`,
    `Use FULL JOIN with <code>coalesce(a.key, b.key)</code> for reconciliation reports.`
  ],
  performance: `<p>A LEFT JOIN restricts join order: the preserved side must be produced in full, so the planner has fewer alternatives than for inner joins. When a LEFT JOIN is followed by a strict WHERE on the nullable side, the planner reduces it to an inner join (which can be faster — but means you asked a different question). Anti-joins via LEFT JOIN/IS NULL and NOT EXISTS produce the same Anti Join plan in modern PostgreSQL. PostgreSQL can also <em>remove</em> an unnecessary LEFT JOIN entirely (join removal) when the right side is joined on a unique key and none of its columns are used.</p>`,
  security: `<p>NULL-extended rows can expose the existence of records in reports (e.g. a LEFT JOIN from all users to a privileged table shows who has no entry). With Row-Level Security, rows hidden by a policy behave like non-matching rows in an outer join — the left row remains with NULLs, so design reports so that NULL does not leak "this exists but you cannot see it".</p>`,
  scenario: { title: 'Monthly report is missing departments', steps: [
    '1. The CFO notices Finance is missing from "projects started per department this year".',
    '2. The query uses LEFT JOIN projects ... WHERE p.start_date >= date_trunc(\'year\', now()).',
    '3. Recognise outer-join reduction: the WHERE on p.start_date eliminates departments without matching projects.',
    '4. Move the date predicate into the ON clause and use count(p.id) instead of count(*).',
    '5. Re-run: all 8 departments appear, Finance with 0.'
  ] },
  widgets: ['diagram:joins', 'lab:join'],
  interview: [
    { q: 'What is the difference between putting a condition in ON vs WHERE in a LEFT JOIN?', a: 'ON is evaluated while matching: right rows failing it are treated as non-matching and the left row is still kept with NULLs. WHERE is evaluated after the join and removes any row where it is not true, including NULL-extended rows, so a WHERE on the right table effectively turns the LEFT JOIN into an INNER JOIN.' },
    { q: 'How do you find customers who have never placed an order?', a: 'Use an anti-join: SELECT c.* FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id), or LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL. Both are planned as an Anti Join. Avoid NOT IN because of NULL semantics.' },
    { q: 'When is a FULL OUTER JOIN the right tool?', a: 'When you need unmatched rows from both sides, typically reconciliation between two sources (ledger vs bank file, old vs new system). You coalesce the keys and classify rows as only-in-A, only-in-B or in-both. It is expensive on large inputs because both sides are read fully.' },
    { q: 'Why might count(*) be wrong after a LEFT JOIN?', a: 'A left row with no match still produces one NULL-extended output row, so count(*) returns 1 instead of 0. count(right.pk) ignores NULLs and returns the true number of matches.' }
  ],
  exercises: [
    { task: 'List every department with the number of projects it has with status = \'completed\' (show 0 when none).', solution: `SELECT d.name, count(p.id) AS completed_projects
FROM departments d
LEFT JOIN projects p ON p.department_id = d.id AND p.status = 'completed'
GROUP BY d.name
ORDER BY d.name;`, run: true },
    { task: 'Find employees who are not assigned to any project, using a LEFT JOIN anti-join.', solution: `SELECT e.id, e.first_name, e.last_name, e.job_title
FROM employees e
LEFT JOIN employee_projects ep ON ep.employee_id = e.id
WHERE ep.employee_id IS NULL
ORDER BY e.id;`, run: true }
  ],
  challenge: { task: 'Reconcile orders and payments with a FULL JOIN: classify each order/payment pair as "unpaid order", "paid", or "orphan payment" and count each class.', hint: 'FULL JOIN payments p ON p.order_id = o.id, then CASE on which side is NULL.', solution: `SELECT CASE
         WHEN p.id IS NULL THEN 'unpaid order'
         WHEN o.id IS NULL THEN 'orphan payment'
         ELSE 'paid'
       END AS class,
       count(*)
FROM orders o
FULL JOIN payments p ON p.order_id = o.id
GROUP BY 1
ORDER BY 1;`, run: true },
  related: ['joins-inner-join', 'subqueries-correlated-exists', 'subqueries-in-any-all', 'aggregations'],
  quiz: [
    { type: 'mcq', q: 'A LEFT JOIN B WHERE B.x = 5 is equivalent to:', options: ['A LEFT JOIN B ON ... AND B.x = 5', 'A INNER JOIN B ... WHERE B.x = 5', 'A FULL JOIN B', 'A CROSS JOIN B'], answer: 1, explain: 'NULL-extended rows fail B.x = 5, so only matched rows survive: an inner join.' },
    { type: 'tf', q: 'A RIGHT JOIN B returns the same rows as B LEFT JOIN A.', answer: true, explain: 'They are mirror images; only the column order of SELECT * differs.' },
    { type: 'bug', q: 'This should show every department with its project count, but departments with no projects show 1. Why?', code: `SELECT d.name, count(*)
FROM departments d LEFT JOIN projects p ON p.department_id = d.id
GROUP BY d.name;`, options: ['LEFT JOIN should be RIGHT JOIN', 'count(*) counts the NULL-extended row; use count(p.id)', 'GROUP BY must include p.id', 'Missing WHERE p.id IS NOT NULL'], answer: 1, explain: 'count(column) skips NULLs; count(*) counts rows.' },
    { type: 'predict', q: 'How many rows?', code: `SELECT e.id FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id;`, options: ['192', '200', '208', '8'], answer: 1, explain: 'Every employee has at most one manager; heads are kept with NULLs: 200 rows.' }
  ]
},
{
  id: 'joins-cross-self',
  module: 'joins',
  title: 'CROSS JOIN and SELF JOIN',
  level: 2,
  minutes: 16,
  summary: 'Generate every combination with CROSS JOIN and relate rows of the same table to each other with SELF JOIN (employee to manager).',
  objectives: [
    'Explain what a Cartesian product is and when it is useful',
    'Generate calendars and scaffolds with CROSS JOIN and generate_series',
    'Join a table to itself using two aliases (employee to manager)',
    'Compare rows within the same table (salary vs manager salary, pairs)',
    'Avoid accidental Cartesian products'
  ],
  concept: `<p><strong>CROSS JOIN</strong> returns every combination of rows: <code>|A| x |B|</code> rows, no condition. <code>departments CROSS JOIN generate_series(1,12)</code> gives 8 x 12 = 96 rows — one per department per month. It is the right tool to build a <em>scaffold</em> (all department/month pairs) that you then LEFT JOIN real data onto, so missing combinations show as zero instead of disappearing.</p>
<p><strong>Analogy for CROSS JOIN:</strong> a restaurant menu builder that lists every pairing of 4 starters with 5 mains — 20 combos — before the chef crosses out the ones that do not go together.</p>
<p>A <strong>SELF JOIN</strong> is not a special keyword; it is any join where the same table appears twice with different aliases. Hierarchies stored as an adjacency list — <code>employees.manager_id</code> references <code>employees.id</code> — need it: alias <code>e</code> is "the employee" and alias <code>m</code> is "the employee's manager". PostgreSQL treats them as two independent scans of the same table.</p>
<p><strong>Analogy for SELF JOIN:</strong> photocopy the staff list, put the copies side by side, and for every person on copy 1 draw a line to their boss on copy 2.</p>
<ul>
<li>Use <code>LEFT JOIN</code> for the manager side if top-level employees (manager_id NULL) must be kept.</li>
<li>To compare pairs inside one table (e.g. two employees in the same department), join with <code>a.id &lt; b.id</code> to avoid self-pairs and mirror duplicates (A,B)/(B,A).</li>
<li>A single self join walks <em>one</em> level. For arbitrary depth use <code>WITH RECURSIVE</code> (CTE module).</li>
</ul>`,
  why: `<p>CROSS JOIN exists because many analytical questions need the full grid of possibilities (dates x stores, sizes x colours) including empty cells. SELF JOIN exists because real data is self-referential: org charts, category trees, "replaced-by" product links, referral programmes, and comparisons between rows of the same entity (this month vs last month before window functions existed).</p>`,
  useCase: `<p>An HR analytics team flags pay inversions — employees earning more than their direct manager — across 40,000 staff. A self join <code>employees e JOIN employees m ON m.id = e.manager_id WHERE e.salary &gt; m.salary</code> runs in milliseconds with an index on <code>manager_id</code> and feeds a quarterly compensation review. A retail planner uses <code>stores CROSS JOIN generate_series(date, date, '1 day')</code> to produce a store-day scaffold so the sales heatmap shows closed days as 0, not as gaps.</p>`,
  internals: `<p>A CROSS JOIN is planned as a Nested Loop without a join qual; usually the smaller side is materialised (Materialize node) and rescanned for every outer row. A self join is planned exactly like a join of two different tables: each alias gets its own range-table entry and scan node, and the planner may use different access paths for each (seq scan for <code>e</code>, primary-key index scan for <code>m</code>).</p>`,
  whenNot: `<p>Never CROSS JOIN two large tables — 1 million x 1 million is 10<sup>12</sup> rows. If you see an unexpected Nested Loop with no join filter in EXPLAIN, you probably forgot a join condition. For multi-level hierarchies do not chain 5 self joins; use <code>WITH RECURSIVE</code>. For "previous row" comparisons use <code>LAG()</code> instead of a self join on <code>id - 1</code>.</p>`,
  syntax: `-- Cartesian product
SELECT ... FROM a CROSS JOIN b;          -- same as FROM a, b  or  a JOIN b ON true

-- Self join (adjacency list)
SELECT e.*, m.first_name AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id;`,
  examples: [
    { label: 'Basic', title: 'Employee to manager (one level)',
      sql: `SELECT e.id, e.first_name || ' ' || e.last_name AS employee,
       e.job_title,
       m.first_name || ' ' || m.last_name AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id
WHERE e.id IN (1, 9, 12, 20, 40)
ORDER BY e.id;`,
      explain: `<p>The table appears twice: <code>e</code> for the employee, <code>m</code> for the manager. The join condition <code>m.id = e.manager_id</code> follows the self-referencing foreign key. LEFT JOIN keeps Asha (id 1), a department head with no manager. Employee 20 reports to 12, a team lead who in turn reports to head 5 — that second hop needs another join or a recursive CTE.</p>`,
      output: ` id | employee       | job_title          | manager
----+----------------+--------------------+----------------
  1 | Asha Rao       | Head of Department |
  9 | Myra Patel     | Associate          | Rohan Mehta
 12 | Ishaan Chopra  | Engineer           | Priya Nair
 20 | Aarav Khan     | Analyst            | Ishaan Chopra
 40 | Aarav Malhotra | Lead               | Ishaan Agarwal
(5 rows)`, run: true },
    { label: 'Intermediate', title: 'Pay inversions: employees earning more than their manager',
      sql: `SELECT e.first_name || ' ' || e.last_name AS employee, e.salary,
       m.first_name || ' ' || m.last_name AS manager, m.salary AS manager_salary,
       e.salary - m.salary AS difference
FROM employees e
JOIN employees m ON m.id = e.manager_id
WHERE e.salary > m.salary
ORDER BY difference DESC
LIMIT 8;`,
      explain: `<p>Here an inner self join is correct: employees without a manager cannot have an inversion. The comparison <code>e.salary &gt; m.salary</code> compares two rows of the same table — impossible without the self join. Team leads (non-heads) can earn less than their reports in this data set, which is exactly what this audit surfaces.</p>`,
      output: ` employee       | salary    | manager        | manager_salary | difference
----------------+-----------+----------------+----------------+------------
 Sai Sharma     | 138500.00 | Kabir Das      |       59900.00 |   78600.00
 Aarav Khan     | 126600.00 | Ishaan Chopra  |       52100.00 |   74500.00
 Aarav Malhotra | 112800.00 | Ishaan Agarwal |       51900.00 |   60900.00
 Aarav Sharma   | 135400.00 | Ishaan Das     |       83400.00 |   52000.00
 Sai Khan       |  91800.00 | Kabir Chopra   |       56300.00 |   35500.00
 Sai Malhotra   |  70600.00 | Kabir Agarwal  |       41000.00 |   29600.00
 Aarav Khan     |  79200.00 | Ishaan Chopra  |       60800.00 |   18400.00
 Sai Malhotra   | 126700.00 | Kabir Agarwal  |      109600.00 |   17100.00
(8 rows)`, run: true },
    { label: 'Advanced', title: 'CROSS JOIN scaffold: projects started per department per quarter, zeros included',
      sql: `WITH quarters AS (
  SELECT generate_series('2024-01-01'::date, '2025-04-01'::date, interval '3 months')::date AS q
)
SELECT d.name, q.q AS quarter_start, count(p.id) AS projects_started
FROM departments d
CROSS JOIN quarters q
LEFT JOIN projects p
       ON p.department_id = d.id
      AND p.start_date >= q.q
      AND p.start_date <  q.q + interval '3 months'
WHERE d.name IN ('Engineering', 'Finance')
GROUP BY d.name, q.q
ORDER BY d.name, q.q;`,
      explain: `<p><code>generate_series</code> produces 6 quarter start dates. <code>CROSS JOIN</code> builds every department x quarter cell. The LEFT JOIN then attaches projects that started in that cell's range — the range condition lives in ON so empty cells survive. <code>count(p.id)</code> yields 0 for quarters with no starts, so a chart has a continuous x-axis.</p>`,
      output: ` name        | quarter_start | projects_started
-------------+---------------+------------------
 Engineering | 2024-01-01    |                0
 Engineering | 2024-04-01    |                1
 Engineering | 2024-07-01    |                0
 Engineering | 2024-10-01    |                1
 Engineering | 2025-01-01    |                0
 Engineering | 2025-04-01    |                1
 Finance     | 2024-01-01    |                1
 Finance     | 2024-04-01    |                0
 Finance     | 2024-07-01    |                1
 Finance     | 2024-10-01    |                0
 Finance     | 2025-01-01    |                1
 Finance     | 2025-04-01    |                0
(12 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Forgotten join condition: 8 x 24 = 192 meaningless rows
SELECT d.name, p.name
FROM departments d, projects p
WHERE p.status = 'active';`, why: 'The comma join without a relationship condition is a Cartesian product; every department is paired with every active project.', run: true },
    good: { sql: `SELECT d.name, p.name
FROM departments d
JOIN projects p ON p.department_id = d.id
WHERE p.status = 'active';`, why: 'Explicit JOIN ... ON makes the relationship mandatory and visible; a missing ON is a syntax error instead of a silent explosion.', run: true }
  },
  mistakes: [
    `Accidental Cartesian product from comma joins with a missing condition — row counts explode and queries run for hours.`,
    `Using an inner self join for employee/manager and losing the top-level employees.`,
    `Pair queries with <code>a.id &lt;&gt; b.id</code> instead of <code>a.id &lt; b.id</code>, producing each pair twice.`,
    `Chaining many self joins for deep hierarchies instead of using <code>WITH RECURSIVE</code>.`,
    `Self joining on <code>id = id - 1</code> to get the "previous row" — ids have gaps; use <code>LAG()</code>.`
  ],
  best: [
    `Write <code>CROSS JOIN</code> explicitly when you mean it, so reviewers know the product is intentional.`,
    `Give self-join aliases meaningful names (<code>e</code>/<code>mgr</code>, <code>child</code>/<code>parent</code>).`,
    `Index the self-referencing FK column (<code>employees(manager_id)</code>) for "find direct reports" queries.`,
    `Use a CROSS JOIN scaffold + LEFT JOIN for reports that must show zero-valued cells.`
  ],
  performance: `<p>CROSS JOIN cost is O(|A| x |B|); keep one side tiny (a calendar, a list of statuses). For self joins, the direction matters: looking up a manager by <code>m.id = e.manager_id</code> uses the primary key index; finding all reports of a manager needs an index on <code>manager_id</code>. With a 200-row table both are trivial; with millions of rows the missing FK index turns "show my team" into a sequential scan.</p>`,
  security: `<p>Self joins on user tables (e.g. "users in the same tenant") must include the tenant predicate on both aliases; otherwise a pair query can match users across tenants.</p>`,
  scenario: { title: 'A report query suddenly runs for 40 minutes', steps: [
    '1. EXPLAIN shows a Nested Loop with no Join Filter and a huge row estimate.',
    '2. Inspect the SQL: a refactor removed one line of a comma-style WHERE join condition.',
    '3. Rewrite with explicit JOIN ... ON so a missing condition is a syntax error.',
    '4. Add a statement_timeout for reporting roles to cap runaway queries.'
  ] },
  widgets: ['diagram:joins', 'lab:join'],
  interview: [
    { q: 'Give a legitimate production use of CROSS JOIN.', a: 'Building a scaffold of all combinations — e.g. stores x days or departments x months — then LEFT JOINing actual facts so missing combinations appear as zero. Also applying a small parameter set to every row, such as currency rates x products for a price matrix.' },
    { q: 'How do you list each employee with their manager when managers are in the same table?', a: 'Self join with two aliases: FROM employees e LEFT JOIN employees m ON m.id = e.manager_id. LEFT keeps top-level employees with NULL manager. For the full chain to the CEO use WITH RECURSIVE.' },
    { q: 'How do you produce unique pairs of employees in the same department?', a: 'Self join on department_id with a.id < b.id; the inequality removes self-pairs and mirrored duplicates.' }
  ],
  exercises: [
    { task: 'List every pair of employees in the Finance department who share the same job_title (each pair once).', solution: `SELECT a.first_name || ' ' || a.last_name AS emp_a,
       b.first_name || ' ' || b.last_name AS emp_b, a.job_title
FROM employees a
JOIN employees b ON b.department_id = a.department_id
                AND b.job_title = a.job_title
                AND a.id < b.id
JOIN departments d ON d.id = a.department_id
WHERE d.name = 'Finance'
ORDER BY a.job_title, emp_a;`, run: true },
    { task: 'Show each manager (by name) with the number of direct reports, highest first.', solution: `SELECT m.id, m.first_name || ' ' || m.last_name AS manager, count(*) AS direct_reports
FROM employees e
JOIN employees m ON m.id = e.manager_id
GROUP BY m.id, manager
ORDER BY direct_reports DESC, m.id
LIMIT 10;`, run: true }
  ],
  challenge: { task: 'Show each employee with their manager AND their manager\'s manager (two levels) using self joins only, for employees 20, 30 and 40.', hint: 'Join employees three times: e, m (e.manager_id) and gm (m.manager_id), all LEFT JOINs.', solution: `SELECT e.id, e.first_name AS employee, m.first_name AS manager, gm.first_name AS grand_manager
FROM employees e
LEFT JOIN employees m  ON m.id = e.manager_id
LEFT JOIN employees gm ON gm.id = m.manager_id
WHERE e.id IN (20, 30, 40)
ORDER BY e.id;`, run: true },
  related: ['joins-inner-join', 'ctes-recursive-hierarchy', 'window-functions', 'joins-lateral'],
  quiz: [
    { type: 'mcq', q: 'departments (8 rows) CROSS JOIN generate_series(1,12) returns how many rows?', options: ['8', '12', '20', '96'], answer: 3, explain: 'A Cartesian product multiplies the row counts.' },
    { type: 'tf', q: 'SELF JOIN is a special keyword in PostgreSQL.', answer: false, explain: 'It is just a regular join where one table is referenced twice under different aliases.' },
    { type: 'bug', q: 'Pairs of colleagues appear twice. Fix?', code: `SELECT a.id, b.id FROM employees a
JOIN employees b ON b.department_id = a.department_id AND a.id <> b.id;`, options: ['Use LEFT JOIN', 'Use a.id < b.id', 'Add DISTINCT a.id', 'Use CROSS JOIN'], answer: 1, explain: '<> yields both (A,B) and (B,A); < keeps one ordering.' },
    { type: 'design', q: 'You need the complete reporting chain (any depth) from an employee to the CEO. Best tool?', options: ['5 self joins', 'CROSS JOIN', 'WITH RECURSIVE CTE', 'FULL OUTER JOIN'], answer: 2, explain: 'Recursive CTEs walk hierarchies of arbitrary depth.' }
  ]
},
{
  id: 'joins-lateral',
  module: 'joins',
  title: 'LATERAL Joins: Top-N per Group and Set-Returning Functions',
  level: 3,
  minutes: 20,
  summary: 'Let a subquery in FROM reference columns of earlier tables — the cleanest way to get top-N per group and to expand arrays/JSON per row.',
  objectives: [
    'Explain what LATERAL allows that a normal derived table does not',
    'Write top-N-per-group queries with JOIN LATERAL ... ORDER BY ... LIMIT',
    'Use LEFT JOIN LATERAL ... ON true to keep rows with no results',
    'Call set-returning functions (unnest, jsonb_each, generate_series) per row',
    'Choose between LATERAL and window functions for top-N problems',
    'Support LATERAL top-N with the right composite index'
  ],
  concept: `<p>Normally every item in a FROM clause is independent: a subquery in FROM cannot see columns of the tables listed before it. <code>LATERAL</code> removes that restriction. A <code>LATERAL</code> subquery is evaluated <em>for each row</em> of the preceding FROM items and can reference their columns — like a correlated subquery that is allowed to return <em>many rows and many columns</em>.</p>
<p><strong>Analogy:</strong> a librarian who, for each member walking in (outer row), fetches "your 3 most recent loans" from the back room (lateral subquery). A normal derived table would be the librarian bringing the entire loan history to the front desk first and then matching it up.</p>
<ul>
<li><code>FROM a CROSS JOIN LATERAL (subquery using a.x) s</code> — rows of <code>a</code> with no subquery rows are dropped.</li>
<li><code>FROM a LEFT JOIN LATERAL (subquery) s ON true</code> — rows of <code>a</code> are kept with NULLs when the subquery returns nothing.</li>
<li>Set-returning functions in FROM are implicitly lateral: <code>FROM products p, unnest(p.tags) AS t(tag)</code> works without the keyword.</li>
</ul>
<p>The killer use case is <strong>top-N per group</strong>: "the 3 largest orders per customer", "latest payment per order", "2 newest products per category". With an index matching the inner <code>WHERE</code> + <code>ORDER BY</code>, each lateral probe reads just N index entries, so the cost is (number of groups) x N instead of sorting the whole table.</p>`,
  why: `<p>Before LATERAL (added in PostgreSQL 9.3), top-N per group required window functions over the entire table, or awkward correlated subqueries that could return only one value. LATERAL gives a declarative "for each" construct in SQL, and is also how you apply table functions such as <code>jsonb_to_recordset</code> or <code>unnest</code> row by row.</p>`,
  useCase: `<p>A customer-support dashboard shows, for each of 50 enterprise customers, their 3 most recent orders. With 40 million orders, a window function would rank every order of every customer. <code>customers c CROSS JOIN LATERAL (SELECT ... FROM orders WHERE customer_id = c.id ORDER BY order_date DESC LIMIT 3)</code> with an index on <code>orders(customer_id, order_date DESC)</code> reads 150 index entries in total and returns in about 1 ms.</p>`,
  internals: `<p>A lateral reference makes the subquery <em>parameterised</em>: the planner produces a Nested Loop whose inner side is re-executed for each outer row, with the outer column passed as a parameter (shown as <code>$0</code> or a column reference in EXPLAIN). If the inner side is an Index Scan with a Limit, each iteration stops after N rows — this is what makes LATERAL top-N so fast. The planner cannot turn a LATERAL subquery with LIMIT into a hash join, so without a suitable index each iteration is a full scan + sort (N groups x full scan = disaster). PostgreSQL may "pull up" simple lateral subqueries without LIMIT/aggregates into ordinary joins.</p>`,
  whenNot: `<p>When there are many groups and you need top-N for all of them, a single pass with <code>row_number() OVER (PARTITION BY ...)</code> can beat millions of index probes. If you need only the single latest row per group, <code>SELECT DISTINCT ON (group) ... ORDER BY group, ts DESC</code> is concise. Without an index supporting the inner ORDER BY, prefer the window-function approach.</p>`,
  syntax: `SELECT ...
FROM outer_table o
[CROSS] JOIN LATERAL (
    SELECT ... FROM inner_table i
    WHERE i.fk = o.id          -- reference to the outer row
    ORDER BY i.ts DESC
    LIMIT n
) AS sub
-- or keep outer rows without matches:
LEFT JOIN LATERAL (...) AS sub ON true;

-- set-returning functions are implicitly lateral
SELECT p.id, t.tag FROM products p, unnest(p.tags) AS t(tag);`,
  examples: [
    { label: 'Basic', title: 'Expand arrays and JSON per row',
      sql: `SELECT p.sku, p.name, t.tag, kv.key, kv.value
FROM products p
CROSS JOIN LATERAL unnest(p.tags) AS t(tag)
CROSS JOIN LATERAL jsonb_each_text(p.attributes - 'specs') AS kv(key, value)
WHERE p.id = 3
ORDER BY t.tag, kv.key;`,
      explain: `<p><code>unnest(p.tags)</code> turns the <code>text[]</code> of the current product into rows; <code>jsonb_each_text</code> turns the JSON object into key/value rows. Both reference <code>p</code>, which is only legal laterally. The two expansions are independent, so you get tags x keys combinations — in real code you would expand only one at a time or aggregate.</p>`,
      output: ` sku      | name         | tag        | key             | value
----------+--------------+------------+-----------------+--------
 SKU-0003 | Mouse Lite 3 | bestseller | brand           | Nimbus
 SKU-0003 | Mouse Lite 3 | bestseller | color           | black
 SKU-0003 | Mouse Lite 3 | bestseller | warranty_months | 6
 SKU-0003 | Mouse Lite 3 | office     | brand           | Nimbus
 SKU-0003 | Mouse Lite 3 | office     | color           | black
 SKU-0003 | Mouse Lite 3 | office     | warranty_months | 6
(6 rows)`, run: true },
    { label: 'Intermediate', title: 'Top 3 largest orders per enterprise customer from the UAE',
      sql: `SELECT c.id, c.name, o.id AS order_id, o.order_date::date, o.total_amount
FROM customers c
CROSS JOIN LATERAL (
    SELECT id, order_date, total_amount
    FROM orders
    WHERE customer_id = c.id
    ORDER BY total_amount DESC
    LIMIT 3
) o
WHERE c.country = 'UAE'
ORDER BY c.id, o.total_amount DESC
LIMIT 9;`,
      explain: `<p>For each UAE customer, the lateral subquery picks that customer's 3 most valuable orders. <code>WHERE customer_id = c.id</code> is the lateral reference. <code>CROSS JOIN LATERAL</code> drops customers without orders. The outer <code>LIMIT 9</code> just keeps the output short.</p>`,
      output: ` id | name        | order_id | order_date | total_amount
----+-------------+----------+------------+--------------
  7 | Customer 7  |     4179 | 2024-11-01 |    552425.18
  7 | Customer 7  |     2931 | 2024-08-17 |    548798.14
  7 | Customer 7  |     1157 | 2024-07-04 |    353840.76
 15 | Customer 15 |       41 | 2024-12-20 |    275230.32
 15 | Customer 15 |     4601 | 2024-11-14 |    250617.26
 15 | Customer 15 |     4627 | 2025-06-29 |    209755.36
 23 | Customer 23 |     3483 | 2025-02-20 |    523394.94
 23 | Customer 23 |     3509 | 2024-07-18 |    424085.98
 23 | Customer 23 |     4503 | 2025-05-10 |    380510.71
(9 rows)`, run: true },
    { label: 'Advanced', title: 'Latest payment per order with LEFT JOIN LATERAL and a supporting index',
      sql: `CREATE INDEX payments_order_paid_idx ON payments (order_id, paid_at DESC);
ANALYZE payments;

EXPLAIN (COSTS OFF)
SELECT o.id, o.status, lp.method, lp.status AS payment_status, lp.paid_at
FROM orders o
LEFT JOIN LATERAL (
    SELECT method, status, paid_at
    FROM payments p
    WHERE p.order_id = o.id
    ORDER BY paid_at DESC
    LIMIT 1
) lp ON true
WHERE o.customer_id = 42;`,
      explain: `<p>We create the composite index that matches the lateral subquery exactly: equality on <code>order_id</code>, then <code>paid_at DESC</code> for the ORDER BY. The plan is a Nested Loop Left Join: for each of customer 42's orders the inner side is a Limit over an Index Scan that stops after one row. <code>LEFT JOIN LATERAL ... ON true</code> keeps pending orders that have no payment. (<code>orders(customer_id)</code> is deliberately unindexed in company_db, hence the Seq Scan on orders.)</p>`,
      output: `CREATE INDEX
ANALYZE

Nested Loop Left Join
  ->  Seq Scan on orders o
        Filter: (customer_id = 42)
  ->  Limit
        ->  Index Scan using payments_order_paid_idx on payments p
              Index Cond: (order_id = o.id)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Ranks EVERY order of EVERY customer, then throws most away
SELECT customer_id, id, total_amount
FROM (SELECT o.*, row_number() OVER (PARTITION BY customer_id ORDER BY total_amount DESC) AS rn
      FROM orders o) x
WHERE rn <= 3 AND customer_id IN (SELECT id FROM customers WHERE segment = 'enterprise' AND country = 'UAE');`, why: 'Fine for small data, but with tens of millions of orders it sorts and ranks the whole table to keep a few hundred rows.', run: true },
    good: { sql: `SELECT c.id AS customer_id, o.id, o.total_amount
FROM customers c
CROSS JOIN LATERAL (SELECT id, total_amount FROM orders
                    WHERE customer_id = c.id
                    ORDER BY total_amount DESC LIMIT 3) o
WHERE c.segment = 'enterprise' AND c.country = 'UAE';`, why: 'Only probes orders of the selected customers; with an index on (customer_id, total_amount DESC) each probe reads 3 index entries.', run: true }
  },
  mistakes: [
    `Using <code>CROSS JOIN LATERAL</code> when outer rows without results must be kept — use <code>LEFT JOIN LATERAL ... ON true</code>.`,
    `Writing LATERAL top-N without an index matching <code>(fk, sort_column)</code>: each probe becomes a full scan plus sort.`,
    `Forgetting <code>ON true</code> after <code>LEFT JOIN LATERAL</code> — a LEFT JOIN always needs a join condition.`,
    `Applying LATERAL to millions of outer rows when a single window-function pass would be cheaper.`,
    `Returning multiple set-returning functions in the SELECT list instead of FROM, which produces confusing zip semantics.`
  ],
  best: [
    `Create a composite index <code>(group_key, order_key DESC)</code> for every LATERAL top-N pattern.`,
    `Prefer set-returning functions in FROM (laterally) rather than in the SELECT list.`,
    `Use <code>WITH ORDINALITY</code> (<code>unnest(arr) WITH ORDINALITY AS t(val, pos)</code>) to keep array positions.`,
    `Benchmark LATERAL vs <code>row_number()</code> vs <code>DISTINCT ON</code> with EXPLAIN ANALYZE on realistic data.`
  ],
  performance: `<p>LATERAL top-N cost is roughly (outer rows) x (index descent + N tuples). With 50 outer rows that is microseconds; with 5 million outer rows it is 5 million index descents — then a hash-based or window-function approach that reads the table once wins. Watch for <code>loops=</code> in EXPLAIN ANALYZE: the inner node's time is per loop, so multiply by loops for the real total.</p>`,
  security: `<p>Lateral subqueries run with the same privileges and RLS policies as the outer query; a SECURITY DEFINER set-returning function used laterally runs with its owner's rights, so validate its parameters.</p>`,
  scenario: { title: '"Latest status per device" API takes 4 seconds', steps: [
    '1. The query uses DISTINCT ON over a 200M-row events table for 30 devices.',
    '2. EXPLAIN shows a full sort of the events table.',
    '3. Rewrite as devices d CROSS JOIN LATERAL (SELECT ... WHERE device_id = d.id ORDER BY ts DESC LIMIT 1).',
    '4. Add index on events(device_id, ts DESC).',
    '5. Re-measure: 30 index probes, latency drops to ~2 ms.'
  ] },
  widgets: ['lab:plan', 'diagram:joins'],
  interview: [
    { q: 'What does LATERAL do?', a: 'It lets a subquery or function in FROM reference columns of FROM items listed before it, so it is evaluated once per outer row. It is like a correlated subquery that may return multiple rows and columns.' },
    { q: 'How would you get the 3 latest orders per customer efficiently?', a: 'customers CROSS JOIN LATERAL (SELECT ... FROM orders WHERE customer_id = c.id ORDER BY order_date DESC LIMIT 3) with an index on orders(customer_id, order_date DESC). For very many customers, compare with row_number() OVER (PARTITION BY customer_id ORDER BY order_date DESC) filtered to rn <= 3.' },
    { q: 'Why LEFT JOIN LATERAL ... ON true?', a: 'LEFT JOIN keeps outer rows for which the lateral subquery returns nothing, and every LEFT JOIN needs a join condition; the real correlation is inside the subquery, so the condition is just true.' }
  ],
  exercises: [
    { task: 'For each department, show its 2 highest-paid active employees using LATERAL.', solution: `SELECT d.name, e.first_name, e.last_name, e.salary
FROM departments d
CROSS JOIN LATERAL (
  SELECT first_name, last_name, salary
  FROM employees
  WHERE department_id = d.id AND is_active
  ORDER BY salary DESC
  LIMIT 2
) e
ORDER BY d.name, e.salary DESC;`, run: true },
    { task: 'List each product sku with each of its tags and the tag position (1-based) using unnest WITH ORDINALITY, for products 1-4.', solution: `SELECT p.sku, t.tag, t.pos
FROM products p
CROSS JOIN LATERAL unnest(p.tags) WITH ORDINALITY AS t(tag, pos)
WHERE p.id <= 4
ORDER BY p.sku, t.pos;`, run: true }
  ],
  challenge: { task: 'For every product category, return the 2 best-selling products (by units sold in delivered orders) with their units, using LATERAL.', hint: 'Outer: SELECT DISTINCT category FROM products. Lateral: aggregate order_items joined to products and orders filtered by that category, ORDER BY sum DESC LIMIT 2.', solution: `SELECT cat.category, best.name, best.units
FROM (SELECT DISTINCT category FROM products) cat
CROSS JOIN LATERAL (
  SELECT p.name, sum(oi.quantity) AS units
  FROM products p
  JOIN order_items oi ON oi.product_id = p.id
  JOIN orders o ON o.id = oi.order_id AND o.status = 'delivered'
  WHERE p.category = cat.category
  GROUP BY p.id, p.name
  ORDER BY units DESC
  LIMIT 2
) best
ORDER BY cat.category, best.units DESC;`, run: true },
  related: ['joins-inner-join', 'window-functions-ranking', 'subqueries-correlated-exists', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Which index best supports: LATERAL (SELECT ... FROM orders WHERE customer_id = c.id ORDER BY order_date DESC LIMIT 3)?', options: ['orders(order_date)', 'orders(customer_id)', 'orders(customer_id, order_date DESC)', 'orders(order_date, customer_id)'], answer: 2, explain: 'Equality column first, then the sort column — the scan reads exactly 3 entries per customer.' },
    { type: 'tf', q: 'Set-returning functions in FROM can reference earlier FROM items even without the LATERAL keyword.', answer: true, explain: 'Functions in FROM are implicitly lateral.' },
    { type: 'bug', q: 'Why does this raise a syntax error?', code: `SELECT * FROM orders o
LEFT JOIN LATERAL (SELECT * FROM payments p WHERE p.order_id = o.id LIMIT 1) lp;`, options: ['LATERAL cannot be used with LEFT JOIN', 'LEFT JOIN requires an ON clause, e.g. ON true', 'LIMIT is not allowed in LATERAL', 'Missing GROUP BY'], answer: 1, explain: 'Add ON true.' },
    { type: 'scenario', q: 'You need top-3 orders for each of 2 million customers in a nightly batch. Best first attempt?', options: ['LATERAL with index, 2M probes', 'row_number() OVER (PARTITION BY customer_id ...) in a single pass', 'Correlated scalar subquery', 'CROSS JOIN'], answer: 1, explain: 'When you need almost all groups, one sequential pass with a window function is usually cheaper than millions of index probes. Measure both.' }
  ]
},
{
  id: 'joins-algorithms',
  module: 'joins',
  title: 'Join Algorithms: Nested Loop, Hash Join and Merge Join',
  level: 3,
  minutes: 25,
  summary: 'How PostgreSQL physically executes joins, when the planner picks each algorithm, and how to read and influence join plans.',
  objectives: [
    'Describe how Nested Loop, Hash Join and Merge Join work step by step',
    'Predict which algorithm the planner will pick from row counts and indexes',
    'Read join nodes in EXPLAIN / EXPLAIN ANALYZE output',
    'Recognise hash batches spilling to disk and fix them with work_mem',
    'Use enable_* settings for experiments only, never as a production fix',
    'Diagnose bad join choices caused by misestimated row counts'
  ],
  concept: `<p>SQL says <em>what</em> to join; the planner chooses <em>how</em>. PostgreSQL has exactly three join algorithms:</p>
<h4>1. Nested Loop</h4>
<p>For each row of the outer input, scan the inner input for matches. If the inner side is an index scan, each probe is a cheap B-tree descent ("index nested loop"). <strong>Best when</strong> the outer side is small (a few to a few thousand rows) and the inner side has an index on the join key. It is the only algorithm that works for any join condition (<code>&lt;</code>, <code>BETWEEN</code>, function calls) and the only one that can start returning rows immediately — great with LIMIT.</p>
<p><em>Analogy:</em> for each guest at the door, look up their name in the alphabetical guest book (index).</p>
<h4>2. Hash Join</h4>
<p>Read the smaller input completely and build an in-memory hash table on the join key (the "Hash" node), then stream the larger input and probe the hash table for each row. <strong>Best when</strong> both inputs are large or unindexed and the condition is an equality. Cost is roughly linear: read both sides once. Needs memory: if the hash table exceeds <code>work_mem x hash_mem_multiplier</code> (default 2.0), it is split into <em>batches</em> written to temp files.</p>
<p><em>Analogy:</em> sort guest name cards into 26 labelled boxes A-Z once, then each arriving guest only checks one small box.</p>
<h4>3. Merge Join</h4>
<p>Both inputs sorted on the join key are walked in parallel like a zipper. <strong>Best when</strong> both inputs are already sorted (e.g. come from indexes on the join key) or a sort is needed anyway for ORDER BY, and for very large equi-joins that would not fit a hash table in memory. Requires a mergeable (equality) operator.</p>
<p><em>Analogy:</em> two alphabetised lists placed side by side, a finger on each, moving down together.</p>
<table><tr><th>Algorithm</th><th>Join condition</th><th>Startup</th><th>Sweet spot</th><th>Weakness</th></tr>
<tr><td>Nested Loop</td><td>any</td><td>instant</td><td>small outer + indexed inner, LIMIT</td><td>catastrophic if outer is huge or inner unindexed</td></tr>
<tr><td>Hash Join</td><td>equality only</td><td>must build hash first</td><td>large unsorted inputs</td><td>memory; spills to disk in batches</td></tr>
<tr><td>Merge Join</td><td>equality (mergejoinable)</td><td>needs sorted inputs</td><td>pre-sorted inputs, huge joins</td><td>sorting cost if inputs not ordered</td></tr></table>`,
  why: `<p>No single algorithm is best for every shape of data. A query joining 3 orders to their items wants a nested loop over an index; a nightly report joining 12,500 items to 5,000 orders wants a hash join; joining two 500 GB tables both clustered on the key wants a merge join. Knowing the trade-offs lets you read a plan and see immediately whether the planner's choice is sensible — and when it is not, the usual culprit is a wrong row estimate rather than the algorithm itself.</p>`,
  useCase: `<p>A logistics company's "shipments for this driver today" endpoint used a nested loop that was fast for months. After a data migration, statistics were stale; the planner estimated 1 row for the driver's shipments but there were 80,000, and the nested loop with a seq-scanned inner table ran for 30 s. Running <code>ANALYZE</code> fixed the estimate; the planner switched to a hash join and the endpoint returned in 120 ms. The lesson: algorithm choice is only as good as the statistics feeding the cost model.</p>`,
  internals: `<p>The planner generates a path for each algorithm (and each input ordering / parameterisation) and costs them with GUCs like <code>seq_page_cost</code>, <code>random_page_cost</code>, <code>cpu_tuple_cost</code> and <code>cpu_operator_cost</code>. Hash join cost includes building the hash table on the inner (smaller) side and an estimate of batches from <code>work_mem</code>; PostgreSQL 13+ uses <code>hash_mem_multiplier</code> to give hash nodes more memory than sorts. Merge join may add Sort nodes or use Index Scans that already deliver sorted output, and may add a <code>Materialize</code> node so the inner side can be "rewound" for duplicate keys. Parallel query can run hash joins with a shared hash table built cooperatively by workers (Parallel Hash). <code>EXPLAIN ANALYZE</code> on a Hash node shows <code>Buckets</code>, <code>Batches</code> and <code>Memory Usage</code>; <code>Batches &gt; 1</code> means the join spilled to disk.</p>`,
  whenNot: `<p>Do not "fix" a plan by setting <code>enable_nestloop = off</code> or <code>enable_hashjoin = off</code> globally — those GUCs only add a huge cost penalty and are for experiments. Fix the root cause: missing index, stale statistics (<code>ANALYZE</code>), correlated columns (<code>CREATE STATISTICS</code>), too-small <code>work_mem</code>, or a query that hides the join key in an expression. PostgreSQL has no join hints in core (the <code>pg_hint_plan</code> extension adds them <span class="tag ext">extension</span>, but treat it as a last resort).</p>`,
  syntax: `EXPLAIN [ ( ANALYZE, BUFFERS, COSTS OFF ) ] <query with joins>;

-- experiment only (session level):
SET enable_nestloop  = off;   -- also enable_hashjoin, enable_mergejoin
SET work_mem = '64MB';        -- memory per sort/hash node
RESET ALL;`,
  examples: [
    { label: 'Basic', title: 'Nested Loop: a few orders joined to their items via an index',
      sql: `EXPLAIN (COSTS OFF)
SELECT o.id, oi.product_id, oi.quantity
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.id BETWEEN 100 AND 105;`,
      explain: `<p>The filter on <code>o.id</code> makes the outer side tiny (6 orders, found via the primary-key index). For each of those rows the planner probes <code>idx_order_items_order</code> on <code>order_items(order_id)</code>. A handful of index descents is far cheaper than hashing 12,500 items, so the planner picks <strong>Nested Loop</strong>.</p>`,
      output: `Nested Loop
  ->  Index Only Scan using orders_pkey on orders o
        Index Cond: ((id >= 100) AND (id <= 105))
  ->  Index Scan using idx_order_items_order on order_items oi
        Index Cond: (order_id = o.id)`, run: true },
    { label: 'Intermediate', title: 'Hash Join: aggregate over all orders and customers',
      sql: `EXPLAIN (COSTS OFF)
SELECT c.country, count(*) AS orders, sum(o.total_amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
GROUP BY c.country;`,
      explain: `<p>All 5,000 orders must be joined to customers. The planner builds a hash table on the smaller input (<code>customers</code>, 500 rows — the <code>Hash</code> node) and streams <code>orders</code> through it (Seq Scan, probe). One pass over each table, no index needed. This is the textbook <strong>Hash Join</strong> shape: big probe side on top, small build side under <code>Hash</code>.</p>`,
      output: `HashAggregate
  Group Key: c.country
  ->  Hash Join
        Hash Cond: (o.customer_id = c.id)
        ->  Seq Scan on orders o
        ->  Hash
              ->  Seq Scan on customers c`, run: true },
    { label: 'Advanced', title: 'Forcing alternatives to compare costs (experiment only)',
      sql: `SET enable_hashjoin = off;
SET enable_nestloop  = off;
EXPLAIN
SELECT o.id, oi.quantity
FROM orders o
JOIN order_items oi ON oi.order_id = o.id;
RESET enable_hashjoin;
RESET enable_nestloop;
EXPLAIN
SELECT o.id, oi.quantity
FROM orders o
JOIN order_items oi ON oi.order_id = o.id;`,
      explain: `<p>With hash and nested loop disabled the planner must use <strong>Merge Join</strong>: both inputs are delivered in join-key order — <code>orders</code> via its primary-key index and <code>order_items</code> via <code>idx_order_items_order</code> (or a Sort). After resetting, the default plan (with costs shown) is the planner's real choice for a full join of both tables. Compare the top-line total costs: about 859 for the forced Merge Join vs about 463 for the Hash Join — reading both tables sequentially once and hashing 5,000 small rows is cheaper than walking two indexes with random I/O. In a real investigation use <code>EXPLAIN (ANALYZE, BUFFERS)</code> to compare actual times; never leave <code>enable_*</code> off in production.</p>`,
      output: `SET
SET

Merge Join  (cost=0.57..859.43 rows=12500 width=12)
  Merge Cond: (o.id = oi.order_id)
  ->  Index Only Scan using orders_pkey on orders o  (cost=0.28..287.89 rows=5000 width=8)
  ->  Index Scan using idx_order_items_order on order_items oi  (cost=0.29..402.79 rows=12500 width=12)

RESET
RESET

Hash Join  (cost=201.50..463.33 rows=12500 width=12)
  Hash Cond: (oi.order_id = o.id)
  ->  Seq Scan on order_items oi  (cost=0.00..229.00 rows=12500 width=12)
  ->  Hash  (cost=139.00..139.00 rows=5000 width=8)
        ->  Seq Scan on orders o  (cost=0.00..139.00 rows=5000 width=8)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Join key hidden inside an expression: no index, no hash on the raw key
EXPLAIN (COSTS OFF)
SELECT o.id, p.amount
FROM orders o
JOIN payments p ON p.order_id::text = o.id::text
WHERE o.id < 50;`, why: 'Casting both sides to text means indexes on the integer columns cannot be used and estimates degrade; the planner has to hash or loop over every payment.', run: true },
    good: { sql: `CREATE INDEX payments_order_id_idx ON payments(order_id);
EXPLAIN (COSTS OFF)
SELECT o.id, p.amount
FROM orders o
JOIN payments p ON p.order_id = o.id
WHERE o.id < 50;`, why: 'Join on the raw, same-typed columns and index the FK. The planner can now choose an index nested loop for the 49 selected orders.', run: true }
  },
  mistakes: [
    `Disabling join methods with <code>enable_*</code> in postgresql.conf to work around one bad plan — every other query loses that algorithm.`,
    `Ignoring <code>Batches: N</code> in Hash nodes: multi-batch hash joins spill to temp files and can be 10x slower.`,
    `Judging a nested loop by the inner node time without multiplying by <code>loops</code>.`,
    `Joining columns of different types (<code>bigint</code> vs <code>text</code>, <code>int</code> vs <code>numeric</code>) so indexes and hash/merge operators cannot be used.`,
    `Leaving statistics stale after bulk loads, causing 1-row estimates and catastrophic nested loops.`
  ],
  best: [
    `Read join plans bottom-up: check estimated vs actual rows on each input first; bad estimates explain most bad joins.`,
    `Index foreign keys used in selective joins so nested loops have a cheap inner side.`,
    `Size <code>work_mem</code> per role/session for reporting workloads (<code>SET work_mem = '256MB'</code>) instead of globally.`,
    `Run <code>ANALYZE</code> after bulk loads; use <code>CREATE STATISTICS</code> for correlated columns.`,
    `Use <code>EXPLAIN (ANALYZE, BUFFERS)</code> on a copy of production data — plan choice depends on data size.`
  ],
  performance: `<p>Rules of thumb: Nested Loop cost ~ outer_rows x inner_probe_cost; Hash Join ~ build_rows + probe_rows (+ disk I/O if batched); Merge Join ~ sort costs + both sides once. A plan switching from Hash to Nested Loop because an estimate dropped from 50,000 to 1 is the most common production regression. <code>work_mem</code> is allocated per node per backend (and per parallel worker), so a query with 5 hash joins at 64 MB with 4 workers can use well over 1 GB — raise it selectively.</p>`,
  security: `<p>EXPLAIN output reveals table names, index names and filter constants; do not expose raw plans to end users. <code>EXPLAIN ANALYZE</code> actually executes the statement — on an INSERT/UPDATE/DELETE wrap it in <code>BEGIN ... ROLLBACK</code>.</p>`,
  scenario: { title: 'A dashboard query flips from 200 ms to 45 s after a data load', steps: [
    '1. Capture EXPLAIN (ANALYZE, BUFFERS) of the slow run; note a Nested Loop with rows=1 estimated vs 80,000 actual on the outer side.',
    '2. Check pg_stat_user_tables.last_analyze / last_autoanalyze for the loaded table — stale.',
    '3. Run ANALYZE on the table; re-run EXPLAIN — the planner now chooses a Hash Join.',
    '4. If estimates are still wrong because of correlated filters, add CREATE STATISTICS (dependencies) on those columns.',
    '5. Make the ETL job run ANALYZE after every bulk load.'
  ] },
  widgets: ['lab:plan', 'lab:join', 'diagram:query-pipeline'],
  interview: [
    { q: 'Explain the three join algorithms in PostgreSQL and when each is chosen.', a: 'Nested Loop scans the inner side once per outer row — chosen for small outer inputs with an indexed inner side, non-equality conditions, or LIMIT. Hash Join builds a hash table on the smaller input and probes it with the larger — chosen for large equi-joins without useful ordering. Merge Join walks two inputs sorted on the key — chosen when inputs are already sorted (indexes) or the output must be sorted anyway, and for very large joins.' },
    { q: 'What does "Batches: 4" on a Hash node mean?', a: 'The hash table did not fit in work_mem x hash_mem_multiplier, so both inputs were partitioned into 4 batches and spilled to temporary files, processing one batch at a time. Raising work_mem for that session or reducing the build side removes the spill.' },
    { q: 'A nested loop is slow; what do you check first?', a: 'Estimated vs actual rows on the outer side — a big underestimate makes the planner think few probes are needed. Then whether the inner side uses an index (look for Seq Scan with loops=N). Fix statistics or add the missing index rather than disabling nested loops.' },
    { q: 'Why can a hash join not be used for a.x < b.y?', a: 'Hashing only groups equal keys; it cannot find ranges. Only nested loop can evaluate arbitrary join conditions.' }
  ],
  exercises: [
    { task: 'Show the plan for joining employees to departments for a single employee id = 50. Which algorithm and why?', solution: `EXPLAIN (COSTS OFF)
SELECT e.first_name, d.name
FROM employees e JOIN departments d ON d.id = e.department_id
WHERE e.id = 50;`, run: true },
    { task: 'Show the plan for joining all order_items to products and grouping by category. Identify the build side of the hash join.', solution: `EXPLAIN (COSTS OFF)
SELECT p.category, sum(oi.quantity)
FROM order_items oi JOIN products p ON p.id = oi.product_id
GROUP BY p.category;`, run: true }
  ],
  challenge: { task: 'Use EXPLAIN ANALYZE to observe hash batches: set work_mem to the minimum (64kB) and join order_items to orders selecting many columns; then raise work_mem to 16MB and compare the Batches value.', hint: 'Look at the Hash node line "Buckets: ... Batches: ... Memory Usage: ...".', solution: `SET work_mem = '64kB';
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT o.*, oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id;
SET work_mem = '16MB';
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT o.*, oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id;
RESET work_mem;`, run: true },
  related: ['joins-inner-join', 'joins-lateral', 'query-optimization', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Which join algorithm can evaluate a condition like a.ts BETWEEN b.start AND b.end?', options: ['Hash Join', 'Merge Join', 'Nested Loop', 'All three'], answer: 2, explain: 'Hash and merge joins need equality (mergeable/hashable) operators.' },
    { type: 'tf', q: 'Setting enable_nestloop = off makes nested loops impossible.', answer: false, explain: 'It only adds a large cost penalty; if no alternative exists the planner still uses a nested loop.' },
    { type: 'predict', q: 'Outer side: 3 rows after a filter; inner side: 10M-row table with an index on the join key. Likely plan?', options: ['Hash Join building on the 10M table', 'Nested Loop with Index Scan on inner', 'Merge Join with Sort of 10M rows', 'Cross Join'], answer: 1, explain: 'Three index probes beat reading 10M rows.' },
    { type: 'optimize', q: 'A hash join shows Batches: 16 and runs slowly. Best first fix?', options: ['SET enable_hashjoin = off globally', 'Raise work_mem for that session/role', 'Add an index on the probe side', 'VACUUM FULL'], answer: 1, explain: 'Batches > 1 means the hash table spilled; more memory for that workload removes the spill.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: aggregations (4 lessons)
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'aggregations-basics',
  module: 'aggregations',
  title: 'COUNT, SUM, AVG, MIN, MAX and NULL Handling',
  level: 2,
  minutes: 16,
  summary: 'Collapse many rows into one value with the core aggregate functions, and understand exactly how each treats NULLs and empty sets.',
  objectives: [
    'Use COUNT, SUM, AVG, MIN and MAX on company_db tables',
    'Explain COUNT(*) vs COUNT(col) vs COUNT(DISTINCT col)',
    'Predict aggregate results when inputs contain NULLs or no rows at all',
    'Avoid integer-division and rounding surprises with AVG and numeric types',
    'Use COALESCE to turn "no rows" NULLs into zeros',
    'Know which aggregates can use an index (MIN/MAX)'
  ],
  concept: `<p>An <strong>aggregate function</strong> reads a set of rows and returns a single value. Without GROUP BY, the whole (filtered) table is one group and you get exactly one output row — even if zero rows matched.</p>
<p><strong>Analogy:</strong> a cashier closing the till. COUNT is "how many receipts", SUM is "total money", AVG "average basket", MIN/MAX "smallest and largest receipt". A receipt with the amount smudged (NULL) is still a receipt (counted by <code>COUNT(*)</code>), but it cannot be added to the total, so SUM, AVG, MIN, MAX and <code>COUNT(amount)</code> all skip it.</p>
<table><tr><th>Function</th><th>NULL inputs</th><th>No rows at all</th><th>Result type</th></tr>
<tr><td><code>count(*)</code></td><td>counts the row</td><td>0</td><td>bigint</td></tr>
<tr><td><code>count(col)</code></td><td>skipped</td><td>0</td><td>bigint</td></tr>
<tr><td><code>count(DISTINCT col)</code></td><td>skipped</td><td>0</td><td>bigint</td></tr>
<tr><td><code>sum(col)</code></td><td>skipped</td><td><strong>NULL</strong></td><td>bigint for int, numeric for bigint/numeric</td></tr>
<tr><td><code>avg(col)</code></td><td>skipped (not counted as 0!)</td><td>NULL</td><td>numeric for integer inputs, double for float</td></tr>
<tr><td><code>min/max(col)</code></td><td>skipped</td><td>NULL</td><td>same as input; works on text, dates, etc.</td></tr></table>
<p>Two consequences people get wrong: <code>avg(x)</code> is <code>sum(x)/count(x)</code>, not <code>sum(x)/count(*)</code> — NULLs shrink the denominator; and <code>sum()</code> over zero rows is NULL, not 0, so dashboards should use <code>coalesce(sum(x), 0)</code>. Also note <code>count(*)</code> is not slower than <code>count(1)</code> — PostgreSQL treats <code>count(*)</code> as a special zero-argument aggregate; it is actually marginally faster.</p>`,
  why: `<p>Every report, KPI and dashboard is built on aggregates: revenue, order count, average order value, latest login. Getting NULL and empty-set semantics right is the difference between a correct KPI and a quietly wrong one that drives business decisions.</p>`,
  useCase: `<p>A payments team tracks "average successful payment" per method. 4,585 payment rows, some refunded or failed. They compute <code>avg(amount) FILTER (WHERE status = 'success')</code> per method plus <code>count(*)</code> to show sample size — an average over 12 payments is not as trustworthy as one over 1,200, and showing both prevents bad conclusions.</p>`,
  internals: `<p>Each aggregate is defined in <code>pg_aggregate</code> by a <em>state transition function</em> (<code>sfunc</code>), an initial state and an optional <em>final function</em>. <code>avg(numeric)</code> keeps a (count, sum) state and divides in the final function. Aggregates marked STRICT ignore NULL inputs automatically — that is why SUM skips NULLs. For parallel query, aggregates have <em>combine functions</em> so each worker computes a partial state (Partial Aggregate) and the leader merges them (Finalize Aggregate). <code>min()</code>/<code>max()</code> on an indexed column are rewritten by the planner into <code>ORDER BY col LIMIT 1</code> index scans.</p>`,
  whenNot: `<p>Do not use <code>count(*)</code> on a huge table just to show "about 1.2 billion rows" in a UI — it must scan the table (or an index) because MVCC visibility differs per transaction. Use the estimate in <code>pg_class.reltuples</code> or keep a counter table. Do not use <code>avg()</code> when outliers dominate (salaries, response times); use <code>percentile_cont(0.5) WITHIN GROUP (ORDER BY x)</code> for the median.</p>`,
  syntax: `SELECT count(*), count(col), count(DISTINCT col),
       sum(col), avg(col), min(col), max(col)
FROM table
[WHERE ...];

-- ordered-set aggregates
percentile_cont(0.5) WITHIN GROUP (ORDER BY col)`,
  examples: [
    { label: 'Basic', title: 'Company-wide salary statistics',
      sql: `SELECT count(*)                     AS employees,
       count(*) FILTER (WHERE is_active) AS active,
       sum(salary)                  AS payroll,
       round(avg(salary), 2)        AS avg_salary,
       min(salary)                  AS lowest,
       max(salary)                  AS highest,
       min(hire_date)               AS first_hire
FROM employees;`,
      explain: `<p>No GROUP BY, so all 200 employees form one group and one row is returned. <code>avg</code> on <code>numeric</code> returns many decimals; <code>round(x, 2)</code> formats it. <code>min(hire_date)</code> shows that MIN/MAX work on any ordered type, not only numbers. The <code>FILTER</code> clause (covered later) counts a subset in the same pass.</p>`,
      output: ` employees | active | payroll     | avg_salary | lowest   | highest   | first_hire
-----------+--------+-------------+------------+----------+-----------+------------
       200 |    185 | 20476000.00 |  102380.00 | 40500.00 | 240000.00 | 2014-02-24
(1 row)`, run: true },
    { label: 'Intermediate', title: 'COUNT(*) vs COUNT(col) vs COUNT(DISTINCT col)',
      sql: `SELECT count(*)                    AS all_projects,
       count(end_date)             AS with_end_date,
       count(*) - count(end_date)  AS open_ended,
       count(DISTINCT status)      AS distinct_statuses,
       count(DISTINCT department_id) AS departments_with_projects
FROM projects;`,
      explain: `<p><code>count(*)</code> counts rows (24). <code>count(end_date)</code> counts non-NULL end dates (only the 6 "planned" projects have one). The difference gives rows with NULL. <code>count(DISTINCT ...)</code> removes duplicates and NULLs before counting.</p>`,
      output: ` all_projects | with_end_date | open_ended | distinct_statuses | departments_with_projects
--------------+---------------+------------+-------------------+---------------------------
           24 |             6 |         18 |                 4 |                         8
(1 row)`, run: true },
    { label: 'Advanced', title: 'Empty sets, NULL averages and the median',
      sql: `SELECT sum(total_amount)               AS sum_no_rows,
       coalesce(sum(total_amount), 0)  AS sum_coalesced,
       count(*)                        AS count_no_rows
FROM orders
WHERE order_date >= '2030-01-01';

SELECT round(avg(v), 2)          AS avg_ignoring_null,
       round(sum(v) / count(*), 2) AS avg_treating_null_as_0
FROM (VALUES (100), (200), (NULL)) AS t(v);

SELECT department_id,
       round(avg(salary))  AS mean_salary,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY salary) AS median_salary
FROM employees
WHERE department_id IN (1, 2)
GROUP BY department_id;`,
      explain: `<p>Query 1: no order exists in 2030, yet one row is returned — <code>sum</code> is NULL, <code>count</code> is 0, and <code>coalesce</code> turns NULL into 0. Query 2: <code>avg</code> divides 300 by 2 (NULL skipped) = 150, while <code>sum/count(*)</code> divides by 3 = 100. Decide consciously which one your KPI means. Query 3: mean and median differ by several thousand in both departments. For skewed data such as salaries the median is the more robust "typical" value, because a few extreme salaries (in either direction) move the mean but barely move the median.</p>`,
      output: ` sum_no_rows | sum_coalesced | count_no_rows
-------------+---------------+---------------
             |             0 |             0
(1 row)

 avg_ignoring_null | avg_treating_null_as_0
-------------------+------------------------
            150.00 |                 100.00
(1 row)

 department_id | mean_salary | median_salary
---------------+-------------+---------------
             1 |       96580 |        101700
             2 |      112676 |        107900
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Average discount per order where missing discount should mean 0
SELECT avg(d) AS avg_discount
FROM (VALUES (10), (NULL), (NULL), (20)) AS t(d);`, why: 'avg skips NULLs, so the result is 15 although half the orders had no discount. The KPI is inflated by 2x.', run: true },
    good: { sql: `SELECT avg(coalesce(d, 0)) AS avg_discount
FROM (VALUES (10), (NULL), (NULL), (20)) AS t(d);`, why: 'If NULL semantically means zero, convert it before aggregating: the correct average is 7.5.', run: true }
  },
  mistakes: [
    `Assuming <code>sum()</code> of no rows is 0 — it is NULL. Wrap with <code>coalesce(..., 0)</code>.`,
    `Using <code>avg(col)</code> when NULL should count as zero (or vice versa).`,
    `Writing <code>count(col)</code> when you meant to count rows; NULL values make it smaller.`,
    `Integer division in hand-rolled averages: <code>sum(int_col) / count(*)</code> gives an integer when both are integers (<code>7/2 = 3</code>). Cast: <code>sum(x)::numeric / count(*)</code>.`,
    `Mixing aggregates and plain columns without GROUP BY: "column must appear in the GROUP BY clause or be used in an aggregate function".`
  ],
  best: [
    `Use <code>count(*)</code> to count rows; it is the fastest form.`,
    `Always show sample size (<code>count(*)</code>) next to averages in reports.`,
    `Prefer <code>numeric</code> for money; <code>avg(numeric)</code> is exact, <code>avg(float8)</code> is not.`,
    `Use the median or percentiles for skewed distributions such as salaries and latencies.`,
    `For approximate total counts of huge tables use <code>pg_class.reltuples</code> instead of <code>count(*)</code>.`
  ],
  performance: `<p>Aggregates over a whole table require reading every visible row: <code>count(*)</code> on 100M rows takes seconds even with parallel workers. An Index Only Scan on a narrow index can speed it up when the visibility map is mostly all-visible (after VACUUM). <code>min</code>/<code>max</code> on an indexed column are O(log n) thanks to the planner's MinMax optimisation. <code>count(DISTINCT x)</code> needs a sort or hash of all values and does not parallelise as well — consider pre-aggregation or approximate techniques (HyperLogLog via the <code>postgresql-hll</code> <span class="tag ext">extension</span>) for very large cardinalities.</p>`,
  security: `<p>Aggregates can leak individual values ("average salary of a department with one employee" is that person's salary). For HR/medical reporting enforce minimum group sizes (e.g. <code>HAVING count(*) &gt;= 5</code>) and restrict raw-table access via views.</p>`,
  scenario: { title: 'The "average order value" KPI disagrees with finance', steps: [
    '1. Dashboard: avg(total_amount) over all orders; finance: total revenue / paid orders.',
    '2. Identify the definitional difference: cancelled and pending orders are included in the dashboard.',
    '3. Agree on a definition and encode it: avg(total_amount) FILTER (WHERE status IN (\'paid\',\'shipped\',\'delivered\')).',
    '4. Publish both the numerator, the denominator and the sample size in the report.'
  ] },
  widgets: [],
  interview: [
    { q: 'What is the difference between count(*), count(col) and count(DISTINCT col)?', a: 'count(*) counts rows regardless of content; count(col) counts rows where col is not NULL; count(DISTINCT col) counts unique non-NULL values. On a column with NULLs, count(col) < count(*).' },
    { q: 'What does SELECT sum(x) FROM t WHERE false return?', a: 'One row with NULL. Aggregates without GROUP BY always return one row; sum, avg, min and max of an empty set are NULL, while count is 0.' },
    { q: 'Why is SELECT count(*) on a large PostgreSQL table slow?', a: 'Because of MVCC, row visibility depends on the snapshot, so PostgreSQL cannot keep a single row counter; it must scan the table or an index and check visibility. Index-only scans help when the visibility map is up to date. For estimates use pg_class.reltuples.' },
    { q: 'How does avg treat NULL values?', a: 'It ignores them entirely — both from the sum and from the count. If NULL should mean zero, use avg(coalesce(x,0)).' }
  ],
  exercises: [
    { task: 'Return the number of products, the number of distinct categories, the cheapest and most expensive price and the total stock.', solution: `SELECT count(*) AS products, count(DISTINCT category) AS categories,
       min(price) AS cheapest, max(price) AS priciest, sum(stock) AS total_stock
FROM products;`, run: true },
    { task: 'For payments, show the total amount and average amount of successful payments, and the share (%) of payments that failed.', solution: `SELECT sum(amount) FILTER (WHERE status = 'success') AS success_total,
       round(avg(amount) FILTER (WHERE status = 'success'), 2) AS success_avg,
       round(100.0 * count(*) FILTER (WHERE status = 'failed') / count(*), 2) AS failed_pct
FROM payments;`, run: true }
  ],
  challenge: { task: 'Compute the mean, median and 90th percentile of order total_amount for delivered orders, and the ratio mean/median rounded to 2 decimals.', hint: 'percentile_cont(array[0.5, 0.9]) returns an array of percentiles.', solution: `SELECT round(avg(total_amount), 2) AS mean,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY total_amount) AS median,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY total_amount) AS p90,
       round(avg(total_amount) / percentile_cont(0.5) WITHIN GROUP (ORDER BY total_amount)::numeric, 2) AS mean_to_median
FROM orders
WHERE status = 'delivered';`, run: true },
  related: ['aggregations-group-by-having', 'aggregations-filter', 'window-functions', 'joins-inner-join'],
  quiz: [
    { type: 'predict', q: 'Result of SELECT count(v), avg(v) FROM (VALUES (2),(NULL),(4)) t(v)?', code: `SELECT count(v), avg(v) FROM (VALUES (2),(NULL),(4)) t(v);`, options: ['3, 2', '2, 3', '3, 3', '2, 2'], answer: 1, explain: 'NULL is skipped by both: count = 2, avg = 6/2 = 3.' },
    { type: 'tf', q: 'count(1) is faster than count(*) in PostgreSQL.', answer: false, explain: 'count(*) is a dedicated zero-argument aggregate and is at least as fast as count(1).' },
    { type: 'mcq', q: 'SELECT sum(salary) FROM employees WHERE department_id = 999 returns:', options: ['0', 'No rows', 'One row with NULL', 'An error'], answer: 2, explain: 'Aggregates without GROUP BY always produce one row; sum of nothing is NULL.' },
    { type: 'bug', q: 'Why does this average show 3 instead of 3.5?', code: `SELECT sum(qty) / count(*) FROM (VALUES (3),(4)) t(qty);`, options: ['count(*) counts NULLs', 'Integer division: sum(int) is bigint and count is bigint', 'sum ignores the last row', 'Needs GROUP BY'], answer: 1, explain: 'bigint / bigint truncates. Use avg(qty) or cast to numeric.' }
  ]
},
{
  id: 'aggregations-group-by-having',
  module: 'aggregations',
  title: 'GROUP BY, HAVING, GROUPING SETS, ROLLUP and CUBE',
  level: 2,
  minutes: 22,
  summary: 'Aggregate per group, filter groups with HAVING, and produce subtotals and grand totals in one pass with GROUPING SETS, ROLLUP and CUBE.',
  objectives: [
    'Group rows by one or more columns or expressions',
    'Explain the logical order WHERE -> GROUP BY -> HAVING -> SELECT -> ORDER BY',
    'Filter aggregated groups with HAVING and individual rows with WHERE',
    'Produce subtotals with ROLLUP, all combinations with CUBE, custom combos with GROUPING SETS',
    'Distinguish real NULLs from subtotal NULLs using GROUPING()',
    'Know the functional-dependency rule for primary keys in GROUP BY'
  ],
  concept: `<p><code>GROUP BY</code> splits the filtered rows into buckets that share the same values of the grouping expressions, then evaluates aggregates once per bucket. Each bucket becomes one output row.</p>
<p><strong>Analogy:</strong> sorting a pile of receipts into trays by store and then totalling each tray. <code>WHERE</code> decides which receipts go into the pile at all; <code>HAVING</code> throws away whole trays whose total is too small.</p>
<p><strong>Logical evaluation order</strong> (not physical): <code>FROM/JOIN</code> &rarr; <code>WHERE</code> &rarr; <code>GROUP BY</code> &rarr; aggregates &rarr; <code>HAVING</code> &rarr; window functions &rarr; <code>SELECT</code> list &rarr; <code>DISTINCT</code> &rarr; <code>ORDER BY</code> &rarr; <code>LIMIT</code>. Therefore WHERE cannot reference aggregates, and HAVING cannot reference SELECT aliases (PostgreSQL lets GROUP BY and ORDER BY reference output aliases/positions as an extension).</p>
<p>Every column in the SELECT list must either be in GROUP BY, be inside an aggregate, or be functionally dependent on a grouped primary key (group by <code>e.id</code> and you may select <code>e.first_name</code>).</p>
<h4>Multiple grouping levels in one query</h4>
<ul>
<li><code>GROUP BY GROUPING SETS ((a, b), (a), ())</code> — union of three groupings: per (a,b), per a, and grand total.</li>
<li><code>GROUP BY ROLLUP (a, b)</code> — shorthand for the hierarchy <code>(a,b), (a), ()</code>: subtotals and a grand total, ideal for year &gt; month or country &gt; city.</li>
<li><code>GROUP BY CUBE (a, b)</code> — all 2<sup>n</sup> combinations: <code>(a,b), (a), (b), ()</code> — a pivot-table cross-tab.</li>
<li>In the subtotal rows, the rolled-up columns are NULL. <code>GROUPING(a)</code> returns 1 when <code>a</code> is rolled up in that row, so you can label it 'TOTAL' and distinguish it from a genuine NULL value.</li>
</ul>`,
  why: `<p>Business questions are rarely about single rows: "revenue per country", "departments with more than 20 people", "monthly orders with yearly subtotal". GROUP BY/HAVING express this declaratively. GROUPING SETS/ROLLUP/CUBE replace several UNION ALL queries (each scanning the table again) with a single scan that computes all levels, which is faster and keeps totals consistent.</p>`,
  useCase: `<p>A multinational retailer's finance pack needs revenue per country and segment, with subtotals per country and a grand total, refreshed hourly from 30M orders. One <code>GROUP BY ROLLUP (country, segment)</code> query feeds the spreadsheet export, replacing three UNION ALL queries and cutting runtime from 3 scans (~36 s) to 1 scan (~13 s).</p>`,
  internals: `<p>PostgreSQL implements grouping with either <strong>HashAggregate</strong> (build a hash table keyed by group values; no ordering required; since PG13 it can spill to disk when exceeding <code>work_mem x hash_mem_multiplier</code>) or <strong>GroupAggregate</strong> (consume input sorted on the keys, emit a group when the key changes; needs a Sort or an index). GROUPING SETS are executed by a <strong>MixedAggregate</strong> or by multiple sort/hash phases in one node; the planner chooses which sets to hash and which to sort. HAVING becomes a filter applied to the aggregate node's output. Since PG16, the planner can also use presorted input for <code>ORDER BY</code>/<code>DISTINCT</code> inside aggregates.</p>`,
  whenNot: `<p>Do not use HAVING for conditions on non-aggregated columns (<code>HAVING country = 'India'</code>) — put them in WHERE so rows are removed before grouping (PostgreSQL can often push them down, but WHERE is clearer and guaranteed). Do not GROUP BY many columns just to "make the error go away" — that silently changes the grain. For distinct values only, <code>SELECT DISTINCT</code> is clearer than GROUP BY without aggregates.</p>`,
  syntax: `SELECT group_cols, agg(...)
FROM ...
WHERE row_filter
GROUP BY group_cols
       | GROUPING SETS ((a, b), (a), ())
       | ROLLUP (a, b)
       | CUBE (a, b)
HAVING group_filter
ORDER BY ...;

GROUPING(col)   -- 1 if col is aggregated away in this output row`,
  examples: [
    { label: 'Basic', title: 'Headcount and payroll per department, only large payrolls',
      sql: `SELECT d.name AS department,
       count(*)              AS headcount,
       sum(e.salary)         AS payroll,
       round(avg(e.salary))  AS avg_salary
FROM employees e
JOIN departments d ON d.id = e.department_id
WHERE e.is_active
GROUP BY d.name
HAVING sum(e.salary) > 2400000
ORDER BY payroll DESC;`,
      explain: `<p><code>WHERE e.is_active</code> removes inactive employees <em>before</em> grouping. <code>GROUP BY d.name</code> creates one bucket per department. <code>HAVING sum(e.salary) &gt; 2400000</code> removes whole buckets after aggregation — it must repeat the aggregate expression; the alias <code>payroll</code> is not visible in HAVING.</p>`,
      output: ` department | headcount | payroll    | avg_salary
------------+-----------+------------+------------
 Sales      |        25 | 2816900.00 |     112676
 Support    |        23 | 2434600.00 |     105852
 Marketing  |        24 | 2408900.00 |     100371
(3 rows)`, run: true },
    { label: 'Intermediate', title: 'ROLLUP: revenue by country and segment with subtotals',
      sql: `SELECT CASE WHEN grouping(c.country) = 1 THEN 'ALL COUNTRIES' ELSE c.country END AS country,
       CASE WHEN grouping(c.segment) = 1 THEN 'subtotal' ELSE c.segment END AS segment,
       count(*) AS orders,
       sum(o.total_amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'delivered'
  AND c.country IN ('India', 'UK', 'USA')
GROUP BY ROLLUP (c.country, c.segment)
ORDER BY grouping(c.country), c.country, grouping(c.segment), c.segment;`,
      explain: `<p><code>ROLLUP (country, segment)</code> produces three grouping levels in one pass: per country+segment, per country (segment rolled up), and the grand total. <code>grouping(col)</code> is 1 on rows where that column was aggregated away, so we replace the NULL with a label. Ordering by <code>grouping()</code> puts subtotals after their detail rows and the grand total last.</p>`,
      output: ` country       | segment    | orders | revenue
---------------+------------+--------+--------------
 India         | consumer   |    612 | 147082016.82
 India         | smb        |    333 |  83961120.55
 India         | subtotal   |    945 | 231043137.37
 UK            | consumer   |    342 |  81668796.00
 UK            | subtotal   |    342 |  81668796.00
 USA           | enterprise |    335 |  83049380.70
 USA           | subtotal   |    335 |  83049380.70
 ALL COUNTRIES | subtotal   |   1622 | 395761314.07
(8 rows)`, run: true },
    { label: 'Advanced', title: 'GROUPING SETS: three independent breakdowns in one scan',
      sql: `SELECT p.method, p.status,
       date_trunc('year', p.paid_at)::date AS year,
       count(*) AS payments,
       sum(p.amount) AS amount
FROM payments p
GROUP BY GROUPING SETS ((p.method), (p.status), (date_trunc('year', p.paid_at)), ())
ORDER BY p.method NULLS LAST, p.status NULLS LAST, year NULLS LAST;`,
      explain: `<p>Each grouping set is independent: totals per method, per status, per year, and the grand total <code>()</code>. Columns not in a row's set are NULL. Compared with four <code>UNION ALL</code> queries, the table is read once. CUBE would instead produce all 2<sup>3</sup> combinations — usually more than you want.</p>`,
      output: ` method     | status   | year       | payments | amount
------------+----------+------------+----------+---------------
 card       |          |            |      769 |  147311247.21
 cod        |          |            |      772 |  230743973.96
 netbanking |          |            |      761 |  231937210.57
 upi        |          |            |     1516 |  370149969.39
 wallet     |          |            |      767 |  149414821.94
            | failed   |            |      138 |   32814845.41
            | refunded |            |      428 |  102155945.74
            | success  |            |     4019 |  994586431.92
            |          | 2024-01-01 |     2668 |  656141332.07
            |          | 2025-01-01 |     1917 |  473415891.00
            |          |            |     4585 | 1129557223.07
(11 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Three scans of orders, totals can drift if data changes between them
SELECT status, count(*) FROM orders GROUP BY status
UNION ALL
SELECT 'TOTAL', count(*) FROM orders;`, why: 'Two separate scans; under READ COMMITTED each part can see a different snapshot of a busy table, so the "TOTAL" may not equal the sum of the parts.', run: true },
    good: { sql: `SELECT coalesce(status, 'TOTAL') AS status, count(*)
FROM orders
GROUP BY ROLLUP (status)
ORDER BY grouping(status), status;`, why: 'One scan, one snapshot: totals are guaranteed consistent with the detail rows. (status is NOT NULL so coalesce is safe here; otherwise use grouping().)', run: true }
  },
  mistakes: [
    `Filtering rows in HAVING instead of WHERE (<code>HAVING status = 'paid'</code>) — slower to read and only legal if the column is grouped.`,
    `Referencing a SELECT alias in HAVING (<code>HAVING payroll &gt; 1000</code>) — error: column does not exist. Repeat the expression.`,
    `Adding columns to GROUP BY to silence the "must appear in GROUP BY" error, which changes the result grain.`,
    `Using <code>coalesce(col, 'TOTAL')</code> on ROLLUP output when the column can be genuinely NULL — use <code>grouping(col)</code>.`,
    `Relying on GROUP BY output order — without ORDER BY the order is undefined (HashAggregate returns rows in hash order).`
  ],
  best: [
    `Put row filters in WHERE, group filters (on aggregates) in HAVING.`,
    `Group by the primary key when you need several columns of an entity; PostgreSQL infers functional dependency.`,
    `Use ROLLUP for hierarchical totals, CUBE for cross-tabs, GROUPING SETS for arbitrary combinations.`,
    `Always add ORDER BY to grouped reports; use <code>grouping()</code> in it to position subtotal rows.`,
    `Group by <code>date_trunc('month', ts)</code> for time buckets; use <code>generate_series</code> + LEFT JOIN to fill empty buckets.`
  ],
  performance: `<p>HashAggregate is usually fastest for few groups; GroupAggregate wins when the input is already sorted (index on the grouping key) or there are huge numbers of groups. Since PG13 HashAggregate spills to disk instead of exceeding memory — watch for <code>Disk Usage</code> in EXPLAIN ANALYZE and raise <code>work_mem</code> for reporting sessions. Partial aggregation with parallel workers dramatically speeds up big GROUP BYs; check for <code>Partial HashAggregate</code> + <code>Gather</code> + <code>Finalize</code> in the plan. Pre-aggregate hot reports in materialized views or summary tables.</p>`,
  security: `<p>Small groups reveal individuals: "average salary by department and job title" might expose one person's pay. Add <code>HAVING count(*) &gt;= k</code> (k-anonymity threshold) for sensitive reports.</p>`,
  scenario: { title: 'Monthly finance export needs subtotals and runs 4 queries', steps: [
    '1. Inventory the four UNION ALL branches: per month+region, per month, per region, grand total.',
    '2. Replace with GROUP BY GROUPING SETS ((month, region), (month), (region), ()).',
    '3. Label subtotal rows with grouping() instead of coalesce.',
    '4. Verify totals equal the previous output, then compare EXPLAIN ANALYZE: one scan instead of four.'
  ] },
  widgets: [],
  interview: [
    { q: 'What is the difference between WHERE and HAVING?', a: 'WHERE filters individual rows before grouping and cannot use aggregates; HAVING filters groups after aggregation and typically references aggregates. Conditions on plain columns belong in WHERE because they reduce the rows to aggregate.' },
    { q: 'Explain ROLLUP vs CUBE vs GROUPING SETS.', a: 'GROUPING SETS lists exactly the groupings you want. ROLLUP(a,b,c) is the hierarchical prefix list (a,b,c),(a,b),(a),(). CUBE(a,b,c) is every subset, 2^n groupings. All execute in one pass over the data.' },
    { q: 'How do you tell a subtotal row from a row where the grouped column is genuinely NULL?', a: 'Use GROUPING(col), which returns 1 when the column is aggregated away (rolled up) in that row and 0 otherwise, regardless of the column value.' },
    { q: 'Why can you SELECT e.first_name when grouping only by e.id?', a: 'Because e.id is the primary key, every other column of e is functionally dependent on it; PostgreSQL (SQL:1999 feature) allows those columns without listing them in GROUP BY.' }
  ],
  exercises: [
    { task: 'Find customers with more than 15 orders: show customer id, name, order count and total spend.', solution: `SELECT c.id, c.name, count(*) AS orders, sum(o.total_amount) AS spend
FROM customers c
JOIN orders o ON o.customer_id = c.id
GROUP BY c.id
HAVING count(*) > 15
ORDER BY orders DESC, c.id;`, run: true },
    { task: 'Using CUBE, count projects by department_id and status including all subtotals; label subtotals with grouping().', solution: `SELECT CASE WHEN grouping(department_id) = 1 THEN 'ALL' ELSE department_id::text END AS dept,
       CASE WHEN grouping(status) = 1 THEN 'ALL' ELSE status END AS status,
       count(*)
FROM projects
GROUP BY CUBE (department_id, status)
ORDER BY grouping(department_id), department_id, grouping(status), status;`, run: true }
  ],
  challenge: { task: 'Produce monthly delivered revenue for 2025 with a quarterly subtotal and a yearly grand total using ROLLUP over (quarter, month).', hint: 'GROUP BY ROLLUP (extract(quarter FROM order_date), date_trunc(\'month\', order_date)).', solution: `SELECT CASE WHEN grouping(q) = 1 THEN 'YEAR' ELSE 'Q' || q END AS quarter,
       CASE WHEN grouping(m) = 1 THEN 'subtotal' ELSE to_char(m, 'YYYY-MM') END AS month,
       sum(total_amount) AS revenue
FROM (SELECT extract(quarter FROM order_date)::int AS q,
             date_trunc('month', order_date) AS m,
             total_amount
      FROM orders
      WHERE status = 'delivered'
        AND order_date >= '2025-01-01' AND order_date < '2026-01-01') x
GROUP BY ROLLUP (q, m)
ORDER BY grouping(q), q, grouping(m), m;`, run: true },
  related: ['aggregations-basics', 'aggregations-filter', 'window-functions-reporting', 'ctes'],
  quiz: [
    { type: 'mcq', q: 'How many grouping levels does ROLLUP (a, b, c) produce?', options: ['3', '4', '7', '8'], answer: 1, explain: '(a,b,c), (a,b), (a), () — four levels. CUBE would produce 8.' },
    { type: 'bug', q: 'Why does this fail?', code: `SELECT department_id, count(*) AS n
FROM employees
GROUP BY department_id
HAVING n > 20;`, options: ['count needs a column', 'HAVING cannot reference the SELECT alias n; use HAVING count(*) > 20', 'GROUP BY needs count(*)', 'Needs ORDER BY'], answer: 1, explain: 'HAVING is evaluated before the SELECT list, so aliases are not visible there.' },
    { type: 'tf', q: 'Without ORDER BY, GROUP BY results come back sorted by the grouping columns.', answer: false, explain: 'HashAggregate returns groups in arbitrary order. Always ORDER BY.' },
    { type: 'write', q: 'Write a query listing product categories whose average price exceeds 30000.', solution: `SELECT category, round(avg(price), 2) AS avg_price
FROM products
GROUP BY category
HAVING avg(price) > 30000
ORDER BY avg_price DESC;`, explain: 'Group per category, filter the groups by aggregated value in HAVING.' }
  ]
},
{
  id: 'aggregations-filter',
  module: 'aggregations',
  title: 'FILTER Clause and Conditional Aggregation',
  level: 2,
  minutes: 15,
  summary: 'Compute many differently-filtered aggregates in a single pass with FILTER (WHERE ...) and CASE, and build pivot-style reports.',
  objectives: [
    'Use aggregate FILTER (WHERE ...) to aggregate subsets',
    'Rewrite CASE-based conditional aggregation with FILTER',
    'Build a pivot (rows to columns) report in one table scan',
    'Compute ratios and percentages correctly from filtered counts',
    'Combine FILTER with GROUP BY and window functions'
  ],
  concept: `<p>Often you need several numbers that differ only by a condition: paid vs cancelled orders, card vs UPI payments, active vs inactive employees. Running one query per condition scans the table repeatedly. <strong>Conditional aggregation</strong> computes them all in one pass.</p>
<p>The SQL-standard way, supported by PostgreSQL since 9.4, is the <code>FILTER</code> clause: <code>count(*) FILTER (WHERE status = 'paid')</code>. Only rows satisfying the filter are fed to that particular aggregate; other aggregates in the same SELECT see all rows of the group.</p>
<p><strong>Analogy:</strong> a single cashier tally sheet with several columns — "card", "cash", "refunds". The cashier reads each receipt once and adds it to whichever columns apply, instead of re-reading the whole stack once per column.</p>
<p>The older portable form uses CASE: <code>sum(CASE WHEN status = 'paid' THEN 1 ELSE 0 END)</code> or <code>count(CASE WHEN ... THEN 1 END)</code> (no ELSE, so non-matching rows yield NULL, which count skips). FILTER is clearer, works with every aggregate (including <code>array_agg</code>, <code>avg</code>, <code>percentile_cont</code>) and avoids subtle ELSE 0 vs ELSE NULL bugs: <code>avg(CASE WHEN x THEN amount ELSE 0 END)</code> is wrong because zeros are averaged in.</p>`,
  why: `<p>Dashboards and pivot tables need many metrics side by side. Single-pass conditional aggregation is far cheaper than N separate queries or N self joins, and all metrics come from the same snapshot so they are mutually consistent (e.g. paid + cancelled + pending = total).</p>`,
  useCase: `<p>A fintech operations dashboard shows, per payment method, today's success count, failure count, refund amount and success rate. With 2 million payments per day, one <code>GROUP BY method</code> query with five <code>FILTER</code> aggregates replaced five queries and halved load on the reporting replica.</p>`,
  internals: `<p>FILTER is implemented inside the Agg node: for each input row, the filter expression is evaluated per aggregate, and the transition function is called only when it is true. There is no extra scan and no extra node in EXPLAIN — you will see <code>count(*) FILTER (WHERE ...)</code> in the Output list. CASE-based forms call the transition function for every row (with a NULL or 0 argument), which is marginally slower and semantically riskier.</p>`,
  whenNot: `<p>If you need only one subset, a plain <code>WHERE</code> is better: it can use an index and reduce rows before aggregation. FILTER cannot reduce the number of rows read. For a truly dynamic number of pivot columns (unknown categories), SQL needs a fixed column list — use <code>jsonb_object_agg</code> or the <code>crosstab()</code> function from the <code>tablefunc</code> <span class="tag ext">extension</span>, or pivot in the application.</p>`,
  syntax: `aggregate_function(args) FILTER (WHERE condition)

-- legacy equivalent
count(CASE WHEN condition THEN 1 END)
sum(CASE WHEN condition THEN amount END)`,
  examples: [
    { label: 'Basic', title: 'Order status breakdown in one row',
      sql: `SELECT count(*)                                   AS total,
       count(*) FILTER (WHERE status = 'pending')   AS pending,
       count(*) FILTER (WHERE status = 'paid')      AS paid,
       count(*) FILTER (WHERE status = 'shipped')   AS shipped,
       count(*) FILTER (WHERE status = 'delivered') AS delivered,
       count(*) FILTER (WHERE status = 'cancelled') AS cancelled
FROM orders;`,
      explain: `<p>The orders table is scanned once; every row increments <code>total</code> and exactly one of the status counters. Because all counts come from one snapshot, the five status columns sum to the total.</p>`,
      output: ` total | pending | paid | shipped | delivered | cancelled
-------+---------+------+---------+-----------+-----------
  5000 |     415 |  808 |     822 |      2527 |       428
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Payment method KPIs with success rate',
      sql: `SELECT method,
       count(*) AS attempts,
       count(*) FILTER (WHERE status = 'success')  AS success,
       count(*) FILTER (WHERE status = 'failed')   AS failed,
       sum(amount) FILTER (WHERE status = 'refunded') AS refunded_amount,
       round(100.0 * count(*) FILTER (WHERE status = 'success') / count(*), 1) AS success_pct
FROM payments
GROUP BY method
ORDER BY attempts DESC;`,
      explain: `<p>Combined with GROUP BY, each FILTER applies within each method group. <code>100.0 *</code> forces numeric arithmetic so the percentage is not truncated by integer division. <code>sum(...) FILTER</code> returns NULL (not 0) for a group with no refunded rows — wrap with coalesce if the UI needs 0.</p>`,
      output: ` method     | attempts | success | failed | refunded_amount | success_pct
------------+----------+---------+--------+-----------------+-------------
 upi        |     1516 |    1342 |     45 |     30309648.98 |        88.5
 cod        |      772 |     673 |     24 |     22303239.34 |        87.2
 card       |      769 |     672 |     22 |     14844730.38 |        87.4
 wallet     |      767 |     660 |     23 |     16617610.53 |        86.0
 netbanking |      761 |     672 |     24 |     18080716.51 |        88.3
(5 rows)`, run: true },
    { label: 'Advanced', title: 'Pivot: monthly revenue per country as columns, plus share of India',
      sql: `SELECT to_char(date_trunc('month', o.order_date), 'YYYY-MM') AS month,
       sum(o.total_amount) FILTER (WHERE c.country = 'India')     AS india,
       sum(o.total_amount) FILTER (WHERE c.country = 'USA')       AS usa,
       sum(o.total_amount) FILTER (WHERE c.country = 'UK')        AS uk,
       sum(o.total_amount) FILTER (WHERE c.country NOT IN ('India','USA','UK')) AS other,
       round(100 * sum(o.total_amount) FILTER (WHERE c.country = 'India')
                 / sum(o.total_amount), 1) AS india_pct
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled'
  AND o.order_date >= '2025-04-01' AND o.order_date < '2025-10-01'
GROUP BY 1
ORDER BY 1;`,
      explain: `<p>Rows are months, columns are countries: a classic pivot in a single pass. <code>GROUP BY 1</code> groups by the first output column. The percentage divides one filtered sum by the unfiltered sum of the same group. Adding a country means adding a column — pivots in SQL always have a fixed column list.</p>`,
      output: ` month   | india       | usa        | uk         | other       | india_pct
---------+-------------+------------+------------+-------------+-----------
 2025-04 | 19945126.35 | 7437932.67 | 5372492.50 | 17327796.25 |      39.8
 2025-05 | 16760946.76 | 6927803.45 | 5824140.47 | 20744429.08 |      33.4
 2025-06 | 25177239.46 | 7516616.64 | 4290756.62 | 26554904.16 |      39.6
 2025-07 | 16671415.09 | 6218071.87 | 7674545.91 | 16147136.27 |      35.7
 2025-08 | 22383421.84 | 7563582.12 | 6822550.15 | 17457255.06 |      41.3
 2025-09 | 17875585.94 | 8116345.42 | 6498828.78 | 22639910.17 |      32.4
(6 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Average refund amount, but ELSE 0 pollutes the average
SELECT method,
       round(avg(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 2) AS avg_refund
FROM payments GROUP BY method ORDER BY method;`, why: 'Every non-refunded payment contributes a 0, so the "average refund" is really refund total divided by all payments — a meaningless number.', run: true },
    good: { sql: `SELECT method,
       round(avg(amount) FILTER (WHERE status = 'refunded'), 2) AS avg_refund
FROM payments GROUP BY method ORDER BY method;`, why: 'FILTER feeds only refunded rows to avg, giving the true average refund amount.', run: true }
  },
  mistakes: [
    `<code>avg(CASE WHEN cond THEN x ELSE 0 END)</code> — zeros are averaged in. Use FILTER or omit ELSE.`,
    `<code>count(CASE WHEN cond THEN 1 ELSE 0 END)</code> — count skips only NULLs, and 0 is not NULL, so every row is counted. Drop the ELSE or use FILTER.`,
    `Integer division in percentages: <code>100 * count(*) FILTER (...) / count(*)</code> truncates; use <code>100.0</code>.`,
    `Using FILTER for a single condition where WHERE would let an index skip most rows.`,
    `Forgetting that a filtered sum over an empty subset is NULL, which breaks arithmetic (<code>NULL - 5</code> is NULL).`
  ],
  best: [
    `Prefer FILTER over CASE inside aggregates — clearer and standard SQL.`,
    `Compute numerator and denominator in the same query for consistent ratios.`,
    `Use <code>coalesce(sum(x) FILTER (...), 0)</code> where a zero is expected.`,
    `Keep a "total" column next to filtered columns as a built-in sanity check.`
  ],
  performance: `<p>N filtered aggregates cost one scan plus N cheap predicate evaluations per row — vastly cheaper than N queries. The filter expressions cannot use indexes, so if you only need rows matching a common condition, also add that condition to WHERE to shrink the input (e.g. a date range).</p>`,
  security: `<p>Pivot reports with small cells (e.g. per-country per-day) may reveal individual customers; enforce minimum cell sizes for externally shared reports.</p>`,
  scenario: { title: 'Operations dashboard fires 12 queries per refresh', steps: [
    '1. List the metrics: they all read payments for today with different status/method conditions.',
    '2. Merge into one SELECT with count(*) FILTER / sum(amount) FILTER per metric, WHERE paid_at >= current_date.',
    '3. Verify each metric matches the old query output.',
    '4. Result: one index range scan on paid_at instead of 12 scans; dashboard load time drops from 2.4 s to 0.2 s.'
  ] },
  widgets: [],
  interview: [
    { q: 'What does the FILTER clause do?', a: 'It restricts which rows of the group are passed to one specific aggregate, e.g. count(*) FILTER (WHERE status = \'paid\'), letting several differently-filtered aggregates be computed in a single scan. It is SQL standard and works with any aggregate.' },
    { q: 'Why is avg(CASE WHEN x THEN amount ELSE 0 END) usually wrong?', a: 'Rows not matching x contribute 0 to both the sum and the count, so it averages over all rows instead of only matching ones. Use avg(amount) FILTER (WHERE x) or CASE without ELSE (NULLs are skipped).' },
    { q: 'How do you pivot rows into columns in PostgreSQL?', a: 'For a known set of columns use conditional aggregation: sum(v) FILTER (WHERE key = \'A\') AS a, ... grouped by the row key. For dynamic columns use jsonb_object_agg, the tablefunc crosstab() extension function, or pivot in the client.' }
  ],
  exercises: [
    { task: 'Per department, count active and inactive employees and the average salary of active ones.', solution: `SELECT d.name,
       count(*) FILTER (WHERE e.is_active)     AS active,
       count(*) FILTER (WHERE NOT e.is_active) AS inactive,
       round(avg(e.salary) FILTER (WHERE e.is_active)) AS avg_active_salary
FROM employees e JOIN departments d ON d.id = e.department_id
GROUP BY d.name
ORDER BY d.name;`, run: true },
    { task: 'For each customer segment, compute the number of orders in 2024 and in 2025 as two columns.', solution: `SELECT c.segment,
       count(*) FILTER (WHERE o.order_date >= '2024-01-01' AND o.order_date < '2025-01-01') AS orders_2024,
       count(*) FILTER (WHERE o.order_date >= '2025-01-01' AND o.order_date < '2026-01-01') AS orders_2025
FROM orders o JOIN customers c ON c.id = o.customer_id
GROUP BY c.segment
ORDER BY c.segment;`, run: true }
  ],
  challenge: { task: 'Build a product-category scorecard: units sold in delivered orders, units in cancelled orders, cancellation rate (%) and the list of distinct payment methods used (array_agg with FILTER on success).', hint: 'Join order_items, orders, products and LEFT JOIN payments; use array_agg(DISTINCT method) FILTER (WHERE ...).', solution: `SELECT p.category,
       sum(oi.quantity) FILTER (WHERE o.status = 'delivered') AS delivered_units,
       sum(oi.quantity) FILTER (WHERE o.status = 'cancelled') AS cancelled_units,
       round(100.0 * sum(oi.quantity) FILTER (WHERE o.status = 'cancelled') / sum(oi.quantity), 1) AS cancel_pct,
       array_agg(DISTINCT pay.method) FILTER (WHERE pay.status = 'success') AS methods
FROM order_items oi
JOIN orders o   ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
LEFT JOIN payments pay ON pay.order_id = o.id
GROUP BY p.category
ORDER BY p.category;`, run: true },
  related: ['aggregations-basics', 'aggregations-group-by-having', 'aggregations-array-json', 'window-functions'],
  quiz: [
    { type: 'predict', q: 'Result?', code: `SELECT count(*) FILTER (WHERE v > 1), count(*)
FROM (VALUES (1),(2),(3)) t(v);`, options: ['2, 3', '3, 3', '2, 2', '1, 3'], answer: 0, explain: 'Only 2 and 3 pass the filter; the unfiltered count sees all 3 rows.' },
    { type: 'bug', q: 'This should count paid orders but returns the total number of orders. Why?', code: `SELECT count(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) FROM orders;`, options: ['CASE is not allowed in count', 'ELSE 0 makes every row non-NULL, so count counts all rows', 'Needs GROUP BY status', 'Use sum instead of count is not possible'], answer: 1, explain: 'count counts non-NULL values; drop the ELSE or use FILTER.' },
    { type: 'tf', q: 'FILTER can be used with any aggregate, including array_agg and percentile_cont.', answer: true, explain: 'FILTER applies to all aggregate functions (ordered-set ones too).' },
    { type: 'optimize', q: 'You need only the count of failed payments in the last day. Best?', code: `SELECT count(*) FILTER (WHERE status='failed' AND paid_at > now() - interval '1 day') FROM payments;`, options: ['Keep as is', 'Move conditions into WHERE so an index on paid_at can restrict rows', 'Use CASE instead', 'Add GROUP BY status'], answer: 1, explain: 'FILTER cannot reduce rows read; WHERE can use an index.' }
  ]
},
{
  id: 'aggregations-array-json',
  module: 'aggregations',
  title: 'STRING_AGG, ARRAY_AGG, JSON_AGG, JSONB_AGG and jsonb_object_agg',
  level: 2,
  minutes: 18,
  summary: 'Aggregate rows into strings, arrays and JSON documents — with ordering and DISTINCT inside the aggregate — to build API payloads in one query.',
  objectives: [
    'Concatenate values with string_agg and a separator',
    'Collect values into arrays with array_agg (with ORDER BY and DISTINCT)',
    'Build JSON arrays of objects with json_agg / jsonb_agg and jsonb_build_object',
    'Build JSON key/value maps with jsonb_object_agg',
    'Explain json vs jsonb aggregate differences (order, duplicates)',
    'Avoid N+1 queries by nesting aggregated JSON per parent row'
  ],
  concept: `<p>Some aggregates do not reduce rows to a number — they <em>collect</em> them:</p>
<ul>
<li><code>string_agg(expr, ', ')</code> &rarr; one text value: <code>'Asha, Rohan, Meera'</code>.</li>
<li><code>array_agg(expr)</code> &rarr; a PostgreSQL array: <code>{12,15,18}</code>.</li>
<li><code>json_agg(expr)</code> / <code>jsonb_agg(expr)</code> &rarr; a JSON array; pass a row or <code>jsonb_build_object(...)</code> to get an array of objects.</li>
<li><code>jsonb_object_agg(key, value)</code> &rarr; a JSON object <code>{"card": 1200, "upi": 900}</code>.</li>
<li>PostgreSQL 16 added the SQL-standard <code>JSON_ARRAYAGG()</code> and <code>JSON_OBJECTAGG()</code> <span class="tag std">SQL standard</span> with the same purpose.</li>
</ul>
<p><strong>Ordering inside the aggregate.</strong> Rows arrive at an aggregate in no guaranteed order. To control the order of elements write <code>ORDER BY</code> <em>inside</em> the call: <code>string_agg(name, ', ' ORDER BY name)</code>, <code>jsonb_agg(x ORDER BY ts DESC)</code>. An outer ORDER BY sorts the result rows, not the elements inside them. <code>DISTINCT</code> also goes inside: <code>array_agg(DISTINCT category ORDER BY category)</code> (with DISTINCT, ORDER BY expressions must appear in the argument list).</p>
<p><strong>Analogy:</strong> a teacher collecting homework. <code>count</code> says "I got 30 sheets"; <code>array_agg</code> keeps the stack of sheets; <code>ORDER BY</code> inside the aggregate is sorting the stack alphabetically before stapling it.</p>
<p><strong>json vs jsonb:</strong> <code>json_agg</code> preserves elements exactly as text (duplicate keys and key order inside objects kept); <code>jsonb_agg</code> produces binary JSONB (keys deduplicated, keys sorted by length then bytes). For <code>jsonb_object_agg</code> with duplicate keys, the last value wins. Element order of the <em>array</em> is preserved in both.</p>`,
  why: `<p>APIs and UIs want nested documents: an order with its items, a department with its employees. Without collecting aggregates the application runs 1 query for the parents plus N queries for the children (the N+1 problem) or post-processes flat join rows. Building the JSON in PostgreSQL returns the finished payload in a single round trip.</p>`,
  useCase: `<p>An order-detail API serving 3,000 requests/s fetched an order and then its items and payments in two extra queries. Replacing them with one query that returns <code>jsonb_build_object('order', ..., 'items', (SELECT jsonb_agg(...)), 'payments', (...))</code> cut p99 latency from 38 ms to 9 ms by removing two network round trips per request.</p>`,
  internals: `<p><code>array_agg</code> and <code>string_agg</code> accumulate state in memory per group (an expanding array / StringInfo buffer), so a single huge group can consume lots of memory. With <code>ORDER BY</code> inside the aggregate, PostgreSQL sorts each group's input before feeding it — since PG16 the planner can supply presorted input for this, avoiding a per-group sort. <code>json_agg</code> builds text; <code>jsonb_agg</code> builds a JSONB value incrementally. These aggregates support parallel combine functions only partially (e.g. array_agg and string_agg do since PG16), so large ones may run single-threaded.</p>`,
  whenNot: `<p>Do not aggregate millions of rows into one JSON document — memory per group is unbounded and the client still has to parse it. Paginate instead. Do not store aggregated arrays/JSON as the system of record when you need to query individual elements relationally (normalise into a child table). Avoid <code>string_agg</code> to build CSV for export; use <code>COPY ... TO</code> which handles quoting.</p>`,
  syntax: `string_agg(expr, delimiter [ORDER BY ...])
array_agg([DISTINCT] expr [ORDER BY ...])
json_agg(expr [ORDER BY ...])      jsonb_agg(expr [ORDER BY ...])
json_object_agg(key, value)        jsonb_object_agg(key, value)
JSON_ARRAYAGG(expr [ORDER BY ...]) JSON_OBJECTAGG(key VALUE value)   -- PG16+`,
  examples: [
    { label: 'Basic', title: 'Team lists per department with string_agg and array_agg',
      sql: `SELECT d.name,
       count(*) AS high_earners,
       string_agg(e.first_name, ', ' ORDER BY e.salary DESC) AS by_salary,
       array_agg(DISTINCT e.job_title ORDER BY e.job_title)  AS titles
FROM departments d
JOIN employees e ON e.department_id = d.id
WHERE e.salary > 145000
GROUP BY d.name
ORDER BY d.name;`,
      explain: `<p><code>string_agg(..., ', ' ORDER BY e.salary DESC)</code> concatenates first names with the highest earner first; without the inner ORDER BY the order would be arbitrary. <code>array_agg(DISTINCT ... ORDER BY ...)</code> returns a deduplicated, sorted <code>text[]</code>. The WHERE keeps only high earners to keep the output readable.</p>`,
      output: ` name        | high_earners | by_salary               | titles
-------------+--------------+-------------------------+---------------------------------------------
 Engineering |            3 | Asha, Rahul, Ishaan     | {Analyst,"Head of Department"}
 Finance     |            3 | Vikram, Pooja, Zara     | {Associate,"Head of Department",Specialist}
 HR          |            3 | Priya, Ishaan, Aarav    | {"Head of Department",Lead}
 Marketing   |            2 | Meera, Kabir            | {"Head of Department",Lead}
 Operations  |            1 | Arjun                   | {"Head of Department"}
 Research    |            2 | Nikhil, Pooja           | {Associate,"Head of Department"}
 Sales       |            4 | Rohan, Tara, Neha, Tara | {Associate,"Head of Department",Specialist}
 Support     |            1 | Kavya                   | {"Head of Department"}
(8 rows)`, run: true },
    { label: 'Intermediate', title: 'Payment amounts per method as a JSON object',
      sql: `SELECT status,
       jsonb_object_agg(method, total ORDER BY method) AS amount_by_method
FROM (SELECT status, method, sum(amount) AS total
      FROM payments
      GROUP BY status, method) s
GROUP BY status
ORDER BY status;`,
      explain: `<p>The inner query aggregates numbers per (status, method); the outer query folds the methods of each status into a single JSONB object keyed by method — a compact, dynamic pivot. The key set adapts automatically if a new payment method appears, unlike a FILTER pivot with a fixed column list. Notice the key order in the output: <strong>jsonb normalises object keys</strong> (shorter keys first, then bytewise), so the inner <code>ORDER BY method</code> does not survive. Use <code>json_object_agg</code> if key order matters to a consumer.</p>`,
      output: ` status   | amount_by_method
----------+----------------------------------------------------------------------------------------------------------------------
 failed   | {"cod": 6687223.36, "upi": 10442556.47, "card": 4622899.17, "wallet": 4660418.04, "netbanking": 6401748.37}
 refunded | {"cod": 22303239.34, "upi": 30309648.98, "card": 14844730.38, "wallet": 16617610.53, "netbanking": 18080716.51}
 success  | {"cod": 201753511.26, "upi": 329397763.94, "card": 127843617.66, "wallet": 128136793.37, "netbanking": 207454745.69}
(3 rows)`, run: true },
    { label: 'Advanced', title: 'Nested API payload: an order with its items as a JSON array',
      sql: `SELECT jsonb_build_object(
         'order_id', o.id,
         'status',   o.status,
         'customer', c.name,
         'items', (SELECT jsonb_agg(jsonb_build_object(
                             'sku', p.sku,
                             'name', p.name,
                             'qty', oi.quantity,
                             'line_total', oi.quantity * oi.unit_price)
                           ORDER BY oi.id)
                   FROM order_items oi
                   JOIN products p ON p.id = oi.product_id
                   WHERE oi.order_id = o.id)
       ) AS payload
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.id = 10;`,
      explain: `<p>The correlated subquery aggregates the order's items into a JSONB array of objects, ordered by item id; <code>jsonb_build_object</code> wraps everything into one document. The application receives ready-to-serve JSON in one round trip. Using a subquery per parent (instead of joining items and grouping) avoids fan-out when you later add a second child collection such as payments.</p>`,
      output: ` payload
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 {"items": [{"qty": 3, "sku": "SKU-0038", "name": "Router Lite 38", "line_total": 176274.84}, {"qty": 3, "sku": "SKU-0045", "name": "Webcam Pro 45", "line_total": 46544.31}, {"qty": 1, "sku": "SKU-0052", "name": "Keyboard Max 52", "line_total": 9529.04}], "status": "cancelled", "customer": "Customer 103", "order_id": 10}
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Two child collections joined together: items x payments fan-out duplicates elements
SELECT o.id,
       jsonb_agg(oi.product_id) AS items,
       jsonb_agg(p.method)      AS payment_methods
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN payments p ON p.order_id = o.id
WHERE o.id IN (10, 11)
GROUP BY o.id;`, why: 'Joining two independent one-to-many children multiplies them: each payment is repeated per item, so payment_methods contains duplicates.', run: true },
    good: { sql: `SELECT o.id,
       (SELECT jsonb_agg(oi.product_id ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = o.id) AS items,
       (SELECT jsonb_agg(p.method ORDER BY p.id) FROM payments p WHERE p.order_id = o.id) AS payment_methods
FROM orders o
WHERE o.id IN (10, 11);`, why: 'Aggregate each child collection independently in its own correlated subquery (or LATERAL); no cross-multiplication.', run: true }
  },
  mistakes: [
    `Expecting element order without <code>ORDER BY</code> inside the aggregate — an outer ORDER BY does not sort array elements.`,
    `Aggregating two child tables through joins in the same GROUP BY (fan-out duplicates elements).`,
    `Using <code>array_agg(DISTINCT x ORDER BY y)</code> — error: with DISTINCT, ORDER BY expressions must appear in the argument list.`,
    `Forgetting that <code>array_agg</code> / <code>jsonb_agg</code> of zero rows is NULL, not an empty array — use <code>coalesce(jsonb_agg(...), '[]'::jsonb)</code>.`,
    `Building giant per-group arrays in memory (millions of elements) and running out of memory.`
  ],
  best: [
    `Always specify ORDER BY inside collecting aggregates when order matters to consumers.`,
    `Use <code>coalesce(jsonb_agg(...), '[]')</code> so APIs get <code>[]</code> instead of <code>null</code>.`,
    `Aggregate each child collection in its own subquery or LATERAL to avoid fan-out.`,
    `Prefer <code>jsonb_build_object</code> with explicit keys over <code>to_jsonb(row)</code> for stable API contracts.`,
    `Use <code>jsonb_agg</code> when the result is stored or queried further; <code>json_agg</code> when exact text output is wanted and slightly faster.`
  ],
  performance: `<p>Collecting aggregates are memory-bound per group. A per-parent correlated subquery is executed once per parent row — with an index on the child FK (<code>order_items(order_id)</code>) each execution is a cheap index scan, but for 100k parents consider a single join + GROUP BY or a LATERAL. JSON construction is CPU work in the database; for very high throughput APIs measure whether building JSON in the app tier is cheaper overall.</p>`,
  security: `<p>Never build SQL by concatenating results of <code>string_agg</code> into dynamic statements without <code>quote_ident</code>/<code>format('%I')</code>. When returning <code>to_jsonb(row)</code> you may leak columns added later (e.g. <code>password_hash</code> from <code>users</code>); whitelist keys with <code>jsonb_build_object</code>.</p>`,
  scenario: { title: 'Order-detail API suffers from N+1 queries', steps: [
    '1. APM shows 1 query for the order + 1 per item for product details + 1 for payments.',
    '2. Replace with one query: jsonb_build_object for the order, jsonb_agg subqueries for items (joined to products) and payments.',
    '3. Ensure indexes exist on order_items(order_id) and payments(order_id).',
    '4. Wrap child aggregates in coalesce(..., \'[]\') so the API contract never sees null arrays.',
    '5. Load-test: one round trip per request, p99 drops substantially.'
  ] },
  widgets: [],
  interview: [
    { q: 'How do you control the order of elements produced by string_agg or array_agg?', a: 'Put ORDER BY inside the aggregate call: string_agg(name, \', \' ORDER BY name). The outer query ORDER BY only orders result rows, not the elements inside an aggregate.' },
    { q: 'Difference between json_agg and jsonb_agg?', a: 'json_agg produces a json (text) array preserving element text exactly, including duplicate object keys and key order; jsonb_agg produces binary jsonb, which normalises objects (deduplicates keys, reorders them) and is better for further querying or indexing.' },
    { q: 'What does array_agg return when there are no input rows?', a: 'NULL, not an empty array. Use coalesce(array_agg(x), \'{}\') or coalesce(jsonb_agg(x), \'[]\'::jsonb).' },
    { q: 'How can aggregating JSON in SQL solve the N+1 problem?', a: 'Instead of one query per parent for its children, a single query builds each parent document with nested jsonb_agg subqueries, returning the complete object graph in one round trip.' }
  ],
  exercises: [
    { task: 'For each product category, return a comma-separated list of brand names (distinct, alphabetical).', solution: `SELECT category,
       string_agg(DISTINCT attributes->>'brand', ', ' ORDER BY attributes->>'brand') AS brands
FROM products
GROUP BY category
ORDER BY category;`, run: true },
    { task: 'Return one JSON array of objects {id, name, budget} for all departments located in Bengaluru, ordered by budget descending.', solution: `SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'budget', budget) ORDER BY budget DESC) AS depts
FROM departments
WHERE location = 'Bengaluru';`, run: true }
  ],
  challenge: { task: 'Build one JSON document per department: {"department": name, "headcount": n, "titles": {title: count, ...}, "top_earners": [3 highest-paid names]}.', hint: 'Aggregate title counts in a subquery with jsonb_object_agg; top earners with a LATERAL/subquery using ORDER BY salary DESC LIMIT 3 and jsonb_agg.', solution: `SELECT jsonb_build_object(
  'department', d.name,
  'headcount', (SELECT count(*) FROM employees e WHERE e.department_id = d.id),
  'titles', (SELECT jsonb_object_agg(job_title, n)
             FROM (SELECT job_title, count(*) AS n FROM employees e
                   WHERE e.department_id = d.id GROUP BY job_title) t),
  'top_earners', (SELECT jsonb_agg(full_name ORDER BY salary DESC)
                  FROM (SELECT first_name || ' ' || last_name AS full_name, salary
                        FROM employees e WHERE e.department_id = d.id
                        ORDER BY salary DESC LIMIT 3) x)
) AS doc
FROM departments d
ORDER BY d.id
LIMIT 2;`, run: true },
  related: ['aggregations-group-by-having', 'joins-lateral', 'jsonb', 'subqueries-scalar-derived'],
  quiz: [
    { type: 'predict', q: 'What is returned?', code: `SELECT string_agg(v, '-' ORDER BY v DESC)
FROM (VALUES ('a'),('c'),('b')) t(v);`, options: ['a-b-c', 'c-b-a', 'a-c-b', 'Error'], answer: 1, explain: 'The ORDER BY inside the aggregate sorts elements descending.' },
    { type: 'tf', q: 'jsonb_agg over zero rows returns an empty array [].', answer: false, explain: 'It returns NULL; coalesce with \'[]\'::jsonb.' },
    { type: 'mcq', q: 'Which function builds {"card": 10, "upi": 5} from rows (method, n)?', options: ['jsonb_agg(method, n)', 'jsonb_object_agg(method, n)', 'jsonb_build_array(method, n)', 'string_agg(method, n)'], answer: 1, explain: 'jsonb_object_agg(key, value) aggregates key/value pairs into one object.' },
    { type: 'bug', q: 'Why are payment methods duplicated?', code: `SELECT o.id, array_agg(oi.id), array_agg(p.method)
FROM orders o JOIN order_items oi ON oi.order_id=o.id
JOIN payments p ON p.order_id=o.id GROUP BY o.id;`, options: ['array_agg always duplicates', 'Items x payments fan-out: each payment repeats per item', 'Missing DISTINCT ON', 'GROUP BY o.id is wrong'], answer: 1, explain: 'Aggregate independent children separately.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: subqueries (3 lessons)
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'subqueries-scalar-derived',
  module: 'subqueries',
  title: 'Scalar Subqueries and Derived Tables',
  level: 2,
  minutes: 17,
  summary: 'Nest queries as single values (scalar subqueries) and as temporary tables in FROM (derived tables) to compute in stages.',
  objectives: [
    'Write scalar subqueries in SELECT, WHERE and HAVING',
    'Explain the "more than one row returned" error and how to avoid it',
    'Use derived tables (subqueries in FROM) to aggregate before joining',
    'Compare each row to a group-level value (salary vs department average)',
    'Know how the planner flattens (pulls up) subqueries'
  ],
  concept: `<p>A <strong>subquery</strong> is a SELECT inside another statement. Its shape decides where it may appear:</p>
<ul>
<li><strong>Scalar subquery</strong> — returns exactly one column and at most one row. It can be used anywhere a single value can: in the SELECT list, WHERE, HAVING, even inside expressions. If it returns zero rows the value is NULL; if it returns more than one row PostgreSQL raises <code>ERROR: more than one row returned by a subquery used as an expression</code>.</li>
<li><strong>Derived table</strong> (subquery in FROM) — returns any number of rows and columns and must have an alias. It behaves like a temporary, unnamed view for the duration of the query.</li>
<li><strong>Row / table subqueries</strong> used with IN, EXISTS, ANY/ALL — covered in the next two lessons.</li>
</ul>
<p><strong>Analogy:</strong> a scalar subquery is asking a colleague a quick question mid-sentence ("what is the company average salary?") and using the single answer. A derived table is asking them to prepare a whole worksheet ("totals per customer") that you then use as an input to your own analysis.</p>
<p>A subquery is <em>uncorrelated</em> if it does not reference the outer query — it is evaluated once (an <code>InitPlan</code> in EXPLAIN). It is <em>correlated</em> if it references outer columns — conceptually evaluated per outer row (a <code>SubPlan</code>), which the next lesson covers in depth.</p>
<p>Derived tables are the cleanest fix for the fan-out problem: aggregate a child table to the parent's grain inside the subquery, then join one row per parent.</p>`,
  why: `<p>Many questions are naturally two-step: "employees paid above the average", "customers whose spend is above the average customer spend", "top categories by revenue, then join product details". Subqueries let you express the steps without temporary tables, and the planner can often merge them into one efficient plan.</p>`,
  useCase: `<p>A marketing team wants customers whose lifetime spend exceeds 3x the average customer's spend, to invite to a VIP programme. A derived table computes spend per customer (500 rows from 5,000 orders), a scalar subquery over that computes the average, and the outer query filters — all in one statement that runs in a few milliseconds and needs no staging table.</p>`,
  internals: `<p>The planner tries to <strong>pull up</strong> simple derived tables (no aggregates, LIMIT, DISTINCT, window functions or volatile functions) into the parent query, so <code>SELECT * FROM (SELECT * FROM orders WHERE status='paid') x WHERE x.customer_id = 5</code> is planned exactly like a single query with both conditions. Derived tables with aggregates stay as separate subquery scans, but outer WHERE conditions on grouping columns can still be <em>pushed down</em> into them. An uncorrelated scalar subquery becomes an <strong>InitPlan</strong> executed once, its result referenced as <code>$0</code>; a correlated one becomes a <strong>SubPlan</strong> executed per outer row (with result caching via <code>Memoize</code> possible only for joins, not subplans).</p>`,
  whenNot: `<p>Do not use several correlated scalar subqueries in the SELECT list that each hit the same child table (<code>(SELECT count(*) ...)</code>, <code>(SELECT sum(...) ...)</code>) — compute them once with a derived table or LATERAL. Do not use a scalar subquery that might return multiple rows "because it works in test"; add the uniqueness guarantee (PK filter) or an aggregate/LIMIT 1 with an explicit ORDER BY. When the same derived table is needed twice, a CTE reads better.</p>`,
  syntax: `-- scalar subquery
SELECT col, (SELECT max(x) FROM t2) AS overall_max FROM t1;
SELECT * FROM t1 WHERE col > (SELECT avg(col) FROM t1);

-- derived table (alias required)
SELECT ... FROM (SELECT key, sum(v) AS total FROM t GROUP BY key) AS s
JOIN other o ON o.key = s.key;`,
  examples: [
    { label: 'Basic', title: 'Employees earning above the company average',
      sql: `SELECT id, first_name, last_name, salary,
       (SELECT round(avg(salary)) FROM employees) AS company_avg
FROM employees
WHERE salary > (SELECT avg(salary) FROM employees) * 1.3
  AND manager_id IS NOT NULL          -- exclude department heads
ORDER BY salary DESC
LIMIT 8;`,
      explain: `<p>Both subqueries are uncorrelated scalar subqueries: they run once (InitPlans) and their single value is reused for every row. The WHERE keeps non-head employees earning more than 1.3x the company average. Without the subquery you would have to run two statements and paste the average in by hand.</p>`,
      output: ` id  | first_name | last_name | salary    | company_avg
-----+------------+-----------+-----------+-------------
  56 | Rahul      | Gupta     | 149800.00 |      102380
  82 | Kabir      | Das       | 149700.00 |      102380
  52 | Ishaan     | Das       | 149700.00 |      102380
  59 | Pooja      | Pillai    | 149600.00 |      102380
 195 | Zara       | Sharma    | 149300.00 |      102380
 153 | Tara       | Bose      | 149300.00 |      102380
  39 | Pooja      | Patel     | 148800.00 |      102380
  17 | Neha       | Agarwal   | 147500.00 |      102380
(8 rows)`, run: true },
    { label: 'Intermediate', title: 'Derived table: aggregate first, then join (no fan-out)',
      sql: `SELECT c.name, c.country, s.orders, s.spend
FROM (
    SELECT customer_id, count(*) AS orders, sum(total_amount) AS spend
    FROM orders
    WHERE status IN ('paid', 'shipped', 'delivered')
    GROUP BY customer_id
) AS s
JOIN customers c ON c.id = s.customer_id
ORDER BY s.spend DESC
LIMIT 5;`,
      explain: `<p>The derived table <code>s</code> reduces orders to one row per customer; joining it to customers is then strictly one-to-one. The alias <code>AS s</code> is mandatory for subqueries in FROM. This pattern scales: you can join several pre-aggregated derived tables (orders per customer, payments per customer) without them multiplying each other.</p>`,
      output: ` name         | country | orders | spend
--------------+---------+--------+------------
 Customer 220 | UK      |     17 | 5940193.48
 Customer 27  | USA     |     12 | 5166925.30
 Customer 140 | UK      |     15 | 5042144.69
 Customer 178 | India   |     15 | 4579508.68
 Customer 436 | UK      |     19 | 4411794.10
(5 rows)`, run: true },
    { label: 'Advanced', title: 'VIP customers: spend above 1.5x the average customer spend',
      sql: `SELECT c.id, c.name, c.segment, s.spend,
       round(s.spend / (SELECT avg(spend) FROM (
                          SELECT sum(total_amount) AS spend
                          FROM orders WHERE status <> 'cancelled'
                          GROUP BY customer_id) a), 2) AS x_avg
FROM customers c
JOIN (SELECT customer_id, sum(total_amount) AS spend
      FROM orders WHERE status <> 'cancelled'
      GROUP BY customer_id) s ON s.customer_id = c.id
WHERE s.spend > 1.5 * (SELECT avg(spend) FROM (
                         SELECT sum(total_amount) AS spend
                         FROM orders WHERE status <> 'cancelled'
                         GROUP BY customer_id) a)
ORDER BY s.spend DESC
LIMIT 6;`,
      explain: `<p>Note the "average of per-customer sums" — a two-level aggregate that needs a nested derived table (you cannot write <code>avg(sum(x))</code> directly). The repeated per-customer aggregation makes this query long and computes the same thing three times — the CTE lesson shows how <code>WITH</code> removes the repetition. <code>x_avg</code> shows how many times the average each VIP spends.</p>`,
      output: ` id  | name         | segment    | spend      | x_avg
-----+--------------+------------+------------+-------
 220 | Customer 220 | consumer   | 5940193.48 |  2.62
  27 | Customer 27  | enterprise | 5416424.79 |  2.39
 469 | Customer 469 | consumer   | 5071543.17 |  2.24
 140 | Customer 140 | consumer   | 5042144.69 |  2.22
 235 | Customer 235 | enterprise | 4874310.00 |  2.15
 174 | Customer 174 | smb        | 4724205.18 |  2.08
(6 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Three correlated subqueries hitting orders per customer
SELECT c.id, c.name,
  (SELECT count(*)          FROM orders o WHERE o.customer_id = c.id) AS orders,
  (SELECT sum(total_amount) FROM orders o WHERE o.customer_id = c.id) AS spend,
  (SELECT max(order_date)   FROM orders o WHERE o.customer_id = c.id) AS last_order
FROM customers c
ORDER BY c.id LIMIT 5;`, why: 'Each subquery is a SubPlan run once per customer: 3 x 500 executions, each scanning orders (customer_id is not indexed). Cost grows with customers x orders.', run: true },
    good: { sql: `SELECT c.id, c.name, s.orders, s.spend, s.last_order
FROM customers c
LEFT JOIN (SELECT customer_id, count(*) AS orders, sum(total_amount) AS spend,
                  max(order_date) AS last_order
           FROM orders GROUP BY customer_id) s ON s.customer_id = c.id
ORDER BY c.id LIMIT 5;`, why: 'One pass over orders computes all three metrics per customer; a single hash join attaches them. LEFT JOIN keeps customers with no orders.', run: true }
  },
  mistakes: [
    `Scalar subquery that can return several rows — works until the data changes, then fails with "more than one row returned by a subquery used as an expression".`,
    `Forgetting the alias on a derived table (<code>FROM (SELECT ...)</code>) — PostgreSQL 16+ accepts it, but older versions error and it hurts readability.`,
    `Multiple correlated scalar subqueries against the same child table instead of one derived table.`,
    `Using <code>LIMIT 1</code> without <code>ORDER BY</code> to "fix" a multi-row scalar subquery — returns an arbitrary row.`,
    `Trying <code>avg(sum(x))</code> — nested aggregates are not allowed; use a derived table.`
  ],
  best: [
    `Aggregate child tables in a derived table to the parent's grain before joining.`,
    `Guarantee scalar subqueries return one row via a PK filter or an aggregate.`,
    `Give derived tables meaningful aliases (<code>per_customer</code>, not <code>x</code>).`,
    `Check EXPLAIN: InitPlan (once) is cheap, SubPlan (per row) needs an index or a rewrite.`
  ],
  performance: `<p>Uncorrelated scalar subqueries are essentially free (evaluated once). Derived tables without aggregates are flattened, so they cost nothing extra. Aggregated derived tables are computed in full before the join unless the outer filter can be pushed into them — a filter like <code>WHERE s.customer_id = 42</code> is pushed down into the GROUP BY subquery, so only that customer's orders are aggregated. Correlated SubPlans in SELECT run once per output row; with LIMIT they run only for the returned rows, which can make them acceptable in paginated UIs.</p>`,
  security: `<p>Subqueries inherit the caller's privileges and RLS policies; a scalar subquery on a table the user cannot read raises a permission error for the whole statement. When exposing reports through views, use <code>security_barrier</code> views so user-supplied predicates cannot be pushed into subqueries to probe hidden rows.</p>`,
  scenario: { title: 'Customer list page takes 3 s to render 50 rows', steps: [
    '1. The query has five correlated scalar subqueries per customer row (counts, sums, last dates).',
    '2. EXPLAIN shows five SubPlans each doing a Seq Scan on orders.',
    '3. Replace them with one LEFT JOIN to a derived table aggregating orders by customer_id, or LATERAL limited to the page.',
    '4. Add an index on orders(customer_id) for the LATERAL variant.',
    '5. Page renders in ~40 ms.'
  ] },
  widgets: ['lab:plan'],
  interview: [
    { q: 'What is a scalar subquery and what happens if it returns two rows?', a: 'A subquery returning one column and at most one row, used as a value. Zero rows yield NULL; more than one row raises "more than one row returned by a subquery used as an expression" at runtime.' },
    { q: 'What is the difference between an InitPlan and a SubPlan?', a: 'An InitPlan is an uncorrelated subquery evaluated once before (or at first use in) the main plan; its result is a parameter. A SubPlan is correlated and re-evaluated for each outer row, so its cost multiplies by the number of rows.' },
    { q: 'Why aggregate in a derived table before joining?', a: 'To keep each side at the same grain. Joining raw child rows causes fan-out that inflates parent-level sums and multiplies when several child tables are joined; pre-aggregating returns one row per parent.' }
  ],
  exercises: [
    { task: 'List products priced above the average price of their own category? (Use a derived table of category averages.)', solution: `SELECT p.name, p.category, p.price, ca.avg_price
FROM products p
JOIN (SELECT category, round(avg(price), 2) AS avg_price
      FROM products GROUP BY category) ca ON ca.category = p.category
WHERE p.price > ca.avg_price
ORDER BY p.category, p.price DESC
LIMIT 10;`, run: true },
    { task: 'Show each department with its headcount and the share of company headcount (%), using a scalar subquery for the total.', solution: `SELECT d.name, count(*) AS headcount,
       round(100.0 * count(*) / (SELECT count(*) FROM employees), 1) AS pct
FROM employees e JOIN departments d ON d.id = e.department_id
GROUP BY d.name
ORDER BY d.name;`, run: true }
  ],
  challenge: { task: 'For each department show payroll, project budget total and the ratio payroll/project budget, using two derived tables so that neither sum is inflated.', hint: 'One derived table aggregates employees by department_id, another aggregates projects by department_id; join both to departments.', solution: `SELECT d.name, e.payroll, p.project_budget,
       round(e.payroll / p.project_budget, 2) AS ratio
FROM departments d
JOIN (SELECT department_id, sum(salary) AS payroll FROM employees GROUP BY department_id) e
  ON e.department_id = d.id
JOIN (SELECT department_id, sum(budget) AS project_budget FROM projects GROUP BY department_id) p
  ON p.department_id = d.id
ORDER BY ratio DESC;`, run: true },
  related: ['subqueries-correlated-exists', 'ctes-with-basics', 'joins-lateral', 'aggregations'],
  quiz: [
    { type: 'predict', q: 'What happens?', code: `SELECT (SELECT id FROM departments WHERE location = 'Bengaluru');`, options: ['Returns 1', 'Returns NULL', 'ERROR: more than one row returned by a subquery used as an expression', 'Returns {1,8}'], answer: 2, explain: 'Two departments are in Bengaluru (Engineering and Research).' },
    { type: 'tf', q: 'A scalar subquery that finds no row returns NULL.', answer: true, explain: 'Empty scalar subqueries evaluate to NULL.' },
    { type: 'mcq', q: 'Which EXPLAIN node indicates a subquery evaluated once per outer row?', options: ['InitPlan', 'SubPlan', 'Hash', 'Materialize'], answer: 1, explain: 'SubPlan = correlated, per-row; InitPlan = once.' },
    { type: 'write', q: 'Return the order(s) with the maximum total_amount using a scalar subquery.', solution: `SELECT id, customer_id, total_amount
FROM orders
WHERE total_amount = (SELECT max(total_amount) FROM orders);`, explain: 'The scalar subquery computes the max once; the outer query returns all orders equal to it (ties included).' }
  ]
},
{
  id: 'subqueries-correlated-exists',
  module: 'subqueries',
  title: 'Correlated Subqueries, EXISTS and NOT EXISTS (Semi and Anti Joins)',
  level: 2,
  minutes: 18,
  summary: 'Test for the existence or absence of related rows with EXISTS / NOT EXISTS, and understand how PostgreSQL turns them into semi and anti joins.',
  objectives: [
    'Explain what a correlated subquery is and how it is evaluated',
    'Use EXISTS to test for related rows without duplicating outer rows',
    'Use NOT EXISTS to find missing relationships (anti-join)',
    'Recognise Semi Join and Anti Join nodes in EXPLAIN',
    'Choose between EXISTS, IN, JOIN + DISTINCT and LEFT JOIN / IS NULL'
  ],
  concept: `<p>A <strong>correlated subquery</strong> references a column of the outer query, e.g. <code>WHERE o.customer_id = c.id</code> inside a subquery over orders while the outer query reads customers. Conceptually it is re-evaluated for each outer row.</p>
<p><code>EXISTS (subquery)</code> is true if the subquery returns <em>at least one row</em> — it does not care about the values, so <code>SELECT 1</code>, <code>SELECT *</code> or <code>SELECT NULL</code> inside are all equivalent. Evaluation can stop at the first match. <code>NOT EXISTS</code> is true if the subquery returns no rows.</p>
<p><strong>Analogy:</strong> a bouncer with a guest list. For each person at the door (outer row) the bouncer checks "is there <em>any</em> entry with this name?" — one hit is enough; they do not need to count all entries or bring the list along into the club. That is a <strong>semi join</strong>. Checking "is this person on the <em>banned</em> list? If not, let them in" is an <strong>anti join</strong>.</p>
<ul>
<li><strong>EXISTS never duplicates</strong> the outer row, unlike an inner join to a one-to-many table, so it needs no DISTINCT.</li>
<li><strong>NOT EXISTS is NULL-safe</strong>: a NULL in the subquery's column cannot make the whole predicate unknown (the NOT IN trap in the next lesson).</li>
<li>The planner rewrites <code>EXISTS</code> into a <strong>Semi Join</strong> and <code>NOT EXISTS</code> into an <strong>Anti Join</strong>, then picks Hash, Merge or Nested Loop for them like any other join — so "correlated" does not mean "slow".</li>
</ul>`,
  why: `<p>"Customers who ordered at least once", "products never sold", "employees with no project", "orders without a payment" — existence questions are everywhere in data quality checks, segmentation and cleanup jobs. EXISTS expresses them directly and safely, with no duplicate rows and no NULL surprises.</p>`,
  useCase: `<p>An e-commerce CRM sends a "we miss you" email to customers who have not ordered in the last 180 days. <code>SELECT ... FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.order_date &gt; now() - interval '180 days')</code> runs as a Hash Anti Join over 2M customers and 60M orders in a few seconds, with an index on <code>orders(customer_id, order_date)</code> making the nested-loop variant viable for small segments.</p>`,
  internals: `<p>During planning, <code>EXISTS</code>/<code>NOT EXISTS</code> sublinks in WHERE are "pulled up" into the join tree as JOIN_SEMI / JOIN_ANTI. A semi join emits each outer row at most once (stops scanning the inner side after the first match for that row in nested loop; in hash join it probes and emits on first hit). An anti join emits the outer row only if no match is found. If the subquery cannot be pulled up (e.g. it is under an OR, or contains LIMIT/aggregates referencing the outer query), it stays a correlated SubPlan; PostgreSQL may then use a <em>hashed SubPlan</em> for uncorrelated IN lists.</p>`,
  whenNot: `<p>If you also need columns from the related table, you need a join (or LATERAL), not EXISTS. For simple uncorrelated membership in a small fixed list, <code>IN (1,2,3)</code> or <code>= ANY(array)</code> is clearer. Avoid EXISTS inside OR conditions in hot queries — they cannot become semi joins and fall back to SubPlans; split into UNION or restructure.</p>`,
  syntax: `SELECT ... FROM outer_t o
WHERE [NOT] EXISTS (
    SELECT 1 FROM inner_t i
    WHERE i.fk = o.id          -- correlation
      AND <extra conditions>
);`,
  examples: [
    { label: 'Basic', title: 'Departments that have at least one active project (semi join)',
      sql: `SELECT d.id, d.name
FROM departments d
WHERE EXISTS (
    SELECT 1 FROM projects p
    WHERE p.department_id = d.id
      AND p.status = 'active'
)
ORDER BY d.id;`,
      explain: `<p>For each department the subquery checks whether any active project references it. Departments with three active projects are still returned once — no DISTINCT needed. <code>SELECT 1</code> is a convention; the select list of an EXISTS subquery is ignored.</p>`,
      output: ` id | name
----+------------
  2 | Sales
  6 | Operations
(2 rows)`, run: true },
    { label: 'Intermediate', title: 'Employees with no project assignment (anti join) and the plan',
      sql: `SELECT e.id, e.first_name, e.last_name, e.job_title
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM employee_projects ep WHERE ep.employee_id = e.id)
ORDER BY e.id;

EXPLAIN (COSTS OFF)
SELECT e.id
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM employee_projects ep WHERE ep.employee_id = e.id);`,
      explain: `<p>The 8 department heads have no project rows. The plan shows the correlated NOT EXISTS was turned into an <strong>Anti Join</strong> — the subquery is not executed 200 times; instead employee_projects is read once (here it can use the primary key index whose leading column is <code>employee_id</code>, or a hash).</p>`,
      output: ` id | first_name | last_name | job_title
----+------------+-----------+--------------------
  1 | Asha       | Rao       | Head of Department
  2 | Rohan      | Mehta     | Head of Department
  3 | Meera      | Iyer      | Head of Department
  4 | Vikram     | Singh     | Head of Department
  5 | Priya      | Nair      | Head of Department
  6 | Arjun      | Kapoor    | Head of Department
  7 | Kavya      | Reddy     | Head of Department
  8 | Nikhil     | Joshi     | Head of Department
(8 rows)

Hash Anti Join
  Hash Cond: (e.id = ep.employee_id)
  ->  Seq Scan on employees e
  ->  Hash
        ->  Seq Scan on employee_projects ep`, run: true },
    { label: 'Advanced', title: 'Correlated conditions: customers who paid by UPI but never by card in 2025',
      sql: `SELECT c.id, c.name, c.country
FROM customers c
WHERE EXISTS (
        SELECT 1 FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE o.customer_id = c.id AND p.method = 'upi'
          AND p.status = 'success' AND p.paid_at >= '2025-01-01')
  AND NOT EXISTS (
        SELECT 1 FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE o.customer_id = c.id AND p.method = 'card'
          AND p.paid_at >= '2025-01-01')
ORDER BY c.id
LIMIT 8;`,
      explain: `<p>Two independent existence tests combine with AND: one semi join and one anti join. Each subquery can contain joins and arbitrary filters. This is a typical marketing-segmentation query ("UPI-only payers") and is far clearer than an equivalent LEFT JOIN / GROUP BY / HAVING construction.</p>`,
      output: ` id | name        | country
----+-------------+-----------
  2 | Customer 2  | India
  4 | Customer 4  | UK
  6 | Customer 6  | Singapore
 11 | Customer 11 | USA
 14 | Customer 14 | Singapore
 15 | Customer 15 | UAE
 16 | Customer 16 | India
 20 | Customer 20 | UK
(8 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- JOIN duplicates customers, DISTINCT hides it at extra cost
SELECT DISTINCT c.id, c.name
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'cancelled'
ORDER BY c.id
LIMIT 5;`, why: 'The join produces one row per cancelled order per customer; DISTINCT then sorts/hashes all of them to remove duplicates. It also obscures intent.', run: true },
    good: { sql: `SELECT c.id, c.name
FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o
              WHERE o.customer_id = c.id AND o.status = 'cancelled')
ORDER BY c.id
LIMIT 5;`, why: 'A semi join returns each customer at most once and can stop at the first matching order; no de-duplication step.', run: true }
  },
  mistakes: [
    `Forgetting the correlation (<code>WHERE o.customer_id = c.id</code>) — the subquery becomes uncorrelated and EXISTS is true for every row if any order exists at all.`,
    `Using JOIN + DISTINCT for existence checks, paying for duplicates you then remove.`,
    `Writing <code>NOT IN (SELECT nullable_col ...)</code> instead of NOT EXISTS (see next lesson).`,
    `Putting EXISTS under OR in a hot path, preventing semi-join planning.`,
    `Thinking <code>SELECT *</code> inside EXISTS reads all columns — it does not, but <code>SELECT 1</code> states intent better.`
  ],
  best: [
    `Use EXISTS / NOT EXISTS for "has any" / "has none" questions.`,
    `Index the correlated column on the inner side (e.g. <code>orders(customer_id)</code>) so nested-loop semi joins are cheap.`,
    `Prefer NOT EXISTS over NOT IN and over LEFT JOIN/IS NULL for clarity and NULL safety.`,
    `Check EXPLAIN for Semi Join / Anti Join — a SubPlan means the rewrite did not happen.`
  ],
  performance: `<p>Because EXISTS/NOT EXISTS become joins, the planner can choose Hash Semi/Anti Join (read inner side once), Merge, or Nested Loop with index probes (great when the outer side is small). A Semi Join's nested loop stops at the first match, which makes EXISTS faster than <code>count(*) &gt; 0</code> subqueries that must count all matches. When the plan shows a non-hashed SubPlan over a large table, rewrite the query so the subquery can be pulled up.</p>`,
  security: `<p>EXISTS subqueries can be used as an oracle to probe for hidden data (e.g. "does a user with this email exist?") via timing or result differences. RLS applies inside subqueries too, so rows hidden by policy do not satisfy EXISTS.</p>`,
  scenario: { title: 'Nightly cleanup must delete products never ordered and not in any cart', steps: [
    '1. Express with two anti joins: DELETE FROM products p WHERE NOT EXISTS (order_items ...) AND NOT EXISTS (cart_items ...).',
    '2. Run as SELECT first and check the count is plausible.',
    '3. Ensure order_items(product_id) is indexed, otherwise each check scans order_items.',
    '4. Run the DELETE in batches inside short transactions, keeping an audit copy via a data-modifying CTE.'
  ] },
  widgets: ['lab:plan', 'diagram:joins'],
  interview: [
    { q: 'What is a semi join and how does EXISTS relate to it?', a: 'A semi join returns each row of the left input at most once if at least one matching row exists on the right. PostgreSQL plans WHERE EXISTS (correlated subquery) as a Semi Join, so it never duplicates outer rows and can stop at the first match.' },
    { q: 'Is a correlated subquery always executed once per row?', a: 'Logically yes, physically not necessarily. EXISTS/NOT EXISTS and IN subqueries in WHERE are usually pulled up into semi/anti joins and executed with hash or merge joins. Correlated scalar subqueries in the SELECT list remain SubPlans executed per row.' },
    { q: 'Why prefer NOT EXISTS over NOT IN?', a: 'NOT IN returns no rows (UNKNOWN) if the subquery produces any NULL, a common silent bug; NOT EXISTS is unaffected by NULLs. NOT EXISTS is also reliably planned as an anti join, while NOT IN with a subquery is often a hashed SubPlan that cannot be reordered.' }
  ],
  exercises: [
    { task: 'Find products that appear in at least one cancelled order (each product once).', solution: `SELECT p.id, p.name
FROM products p
WHERE EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE oi.product_id = p.id AND o.status = 'cancelled')
ORDER BY p.id
LIMIT 10;`, run: true },
    { task: 'Find orders that have items but no payment at all (use NOT EXISTS) and count them per status.', solution: `SELECT o.status, count(*)
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
GROUP BY o.status;`, run: true }
  ],
  challenge: { task: 'Find employees who work on EVERY project of their own department (relational division) using double NOT EXISTS.', hint: 'There must not exist a project of the department for which there does not exist an assignment of this employee.', solution: `SELECT e.id, e.first_name, e.last_name, e.department_id
FROM employees e
WHERE NOT EXISTS (
  SELECT 1 FROM projects p
  WHERE p.department_id = e.department_id
    AND NOT EXISTS (SELECT 1 FROM employee_projects ep
                    WHERE ep.employee_id = e.id AND ep.project_id = p.id)
)
ORDER BY e.id;`, run: true },
  related: ['subqueries-in-any-all', 'joins-outer-joins', 'subqueries-scalar-derived', 'query-optimization'],
  quiz: [
    { type: 'tf', q: 'EXISTS (SELECT NULL FROM t WHERE ...) is false when the matching row has NULL values.', answer: false, explain: 'EXISTS only checks whether a row is returned; the select list is ignored.' },
    { type: 'mcq', q: 'Which plan node implements WHERE NOT EXISTS (correlated subquery) after pull-up?', options: ['SubPlan', 'Anti Join', 'Semi Join', 'Append'], answer: 1, explain: 'NOT EXISTS becomes an anti join (Hash Anti Join, Nested Loop Anti Join, Merge Anti Join).' },
    { type: 'bug', q: 'This returns all 8 departments even though only some have on_hold projects. Why?', code: `SELECT name FROM departments d
WHERE EXISTS (SELECT 1 FROM projects p WHERE p.status = 'on_hold');`, options: ['EXISTS ignores WHERE', 'Missing correlation p.department_id = d.id', 'Should use IN', 'status needs quotes'], answer: 1, explain: 'Without correlation the subquery is the same for every row and true for all.' },
    { type: 'optimize', q: 'Best rewrite?', code: `SELECT DISTINCT c.* FROM customers c JOIN orders o ON o.customer_id = c.id;`, options: ['Add an index on customers(id)', 'SELECT c.* FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)', 'Use GROUP BY c.*', 'Use a FULL JOIN'], answer: 1, explain: 'EXISTS avoids generating and removing duplicates.' }
  ]
},
{
  id: 'subqueries-in-any-all',
  module: 'subqueries',
  title: 'IN, NOT IN (the NULL Trap), ANY and ALL',
  level: 2,
  minutes: 17,
  summary: 'Test membership with IN and = ANY, compare against every value with ALL, and never get bitten by NOT IN with NULLs again.',
  objectives: [
    'Use IN with lists and subqueries',
    'Explain three-valued logic and why NOT IN returns nothing when a NULL is present',
    'Rewrite NOT IN safely with NOT EXISTS',
    'Use = ANY(array) for parameterised lists from applications',
    'Use > ALL / < ANY comparisons and know their empty-set behaviour'
  ],
  concept: `<p><code>x IN (a, b, c)</code> is shorthand for <code>x = a OR x = b OR x = c</code>, and <code>x IN (subquery)</code> compares against each value the subquery returns. <code>x = ANY (array_or_subquery)</code> is the same test written generically: <em>true if the comparison is true for at least one element</em>. <code>x &gt; ALL (...)</code> is <em>true if the comparison is true for every element</em>.</p>
<h4>The NOT IN NULL trap</h4>
<p>SQL uses three-valued logic: TRUE, FALSE and UNKNOWN (NULL). <code>x NOT IN (1, 2, NULL)</code> expands to <code>x &lt;&gt; 1 AND x &lt;&gt; 2 AND x &lt;&gt; NULL</code>. The last comparison is UNKNOWN for every x, so the whole AND can never be TRUE — it is FALSE or UNKNOWN. A WHERE clause keeps only TRUE rows, so <strong>NOT IN returns zero rows as soon as the list contains a single NULL</strong>.</p>
<p><strong>Analogy:</strong> a guard checks "is this visitor different from every name on the banned list?". One entry on the list is smudged and unreadable. The honest guard cannot certify that the visitor differs from the smudged name, so — following the rules strictly — lets nobody in.</p>
<p>In company_db, <code>employees.manager_id</code> is NULL for the 8 heads. "Employees who are not anyone's manager" written as <code>WHERE id NOT IN (SELECT manager_id FROM employees)</code> returns <strong>0 rows</strong>. With <code>NOT EXISTS</code> (or by filtering <code>WHERE manager_id IS NOT NULL</code> in the subquery) it correctly returns 173 (the 200 employees minus the 27 distinct managers).</p>
<p>IN (positive form) is not affected the same way: <code>5 IN (5, NULL)</code> is TRUE; <code>6 IN (5, NULL)</code> is UNKNOWN, which WHERE treats like FALSE — the result is what you expect.</p>
<h4>ANY / ALL edge cases</h4>
<ul>
<li><code>x &gt; ALL (empty set)</code> is TRUE (vacuous truth); <code>x &gt; ANY (empty set)</code> is FALSE.</li>
<li><code>x &gt; ALL (subquery)</code> equals <code>x &gt; (SELECT max(...))</code> only when there are no NULLs and the set is non-empty.</li>
<li><code>SOME</code> is a synonym for <code>ANY</code>.</li>
</ul>`,
  why: `<p>Membership tests are among the most common predicates: filter by a list of IDs from the UI, by a set of statuses, or by the result of another query. Understanding three-valued logic here prevents one of the most famous silent bugs in SQL — a NOT IN that quietly returns nothing in production because one NULL slipped into the data.</p>`,
  useCase: `<p>A back-office tool lets agents select up to 500 orders and bulk-cancel them. The application sends the IDs as a single array parameter: <code>UPDATE orders SET status = 'cancelled' WHERE id = ANY($1::bigint[])</code>. One prepared statement serves any list length (no SQL string building, no plan-cache explosion from IN lists of different lengths) and uses the primary key index.</p>`,
  internals: `<p><code>x IN (const, const, ...)</code> is transformed into <code>x = ANY('{...}'::type[])</code> — you will see <code>= ANY</code> in EXPLAIN — and B-tree indexes support it natively (since PG17, multiple array elements are handled in a single index scan more efficiently). <code>x IN (subquery)</code> in WHERE is pulled up into a <strong>Semi Join</strong>, like EXISTS. <code>NOT IN (subquery)</code> cannot be converted to an anti join because of its NULL semantics; it becomes a <em>hashed SubPlan</em> (if the subquery result fits in <code>work_mem</code>) or, worse, a plain SubPlan re-scanning the subquery result per row — another reason to prefer NOT EXISTS.</p>`,
  whenNot: `<p>Never use <code>NOT IN (subquery)</code> on a nullable column — use NOT EXISTS. Avoid building huge literal IN lists (tens of thousands of values) in SQL text; pass an array parameter, or load the IDs into a temporary table and join. For range-like checks (<code>&gt; ALL</code>) a plain comparison with <code>max()</code> is usually clearer if you have handled NULLs.</p>`,
  syntax: `expr [NOT] IN (value [, ...])
expr [NOT] IN (subquery)
expr operator ANY | SOME (array_expression | subquery)
expr operator ALL (array_expression | subquery)

-- application parameter: WHERE id = ANY($1::int[])`,
  examples: [
    { label: 'Basic', title: 'IN with a list and with a subquery',
      sql: `SELECT id, name, status
FROM projects
WHERE status IN ('active', 'on_hold')
  AND department_id IN (SELECT id FROM departments WHERE location = 'Bengaluru')
ORDER BY id;`,
      explain: `<p>The first IN is a literal list (planned as <code>status = ANY('{active,on_hold}')</code>). The second compares against the IDs returned by a subquery — Engineering (1) and Research (8) — and is planned as a semi join.</p>`,
      output: ` id | name           | status
----+----------------+---------
  7 | Project Galaxy | on_hold
 15 | Project Orion  | on_hold
 23 | Project Willow | on_hold
(3 rows)`, run: true },
    { label: 'Intermediate', title: 'The NOT IN trap on employees.manager_id',
      sql: `-- Who manages nobody? NOT IN version
SELECT count(*) AS not_in_result
FROM employees
WHERE id NOT IN (SELECT manager_id FROM employees);

-- NOT EXISTS version (correct)
SELECT count(*) AS not_exists_result
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM employees r WHERE r.manager_id = e.id);

-- NOT IN with the NULLs filtered out (also correct)
SELECT count(*) AS not_in_filtered
FROM employees
WHERE id NOT IN (SELECT manager_id FROM employees WHERE manager_id IS NOT NULL);`,
      explain: `<p>The subquery returns 192 manager IDs <em>and 8 NULLs</em>. For every employee, <code>id NOT IN (..., NULL)</code> evaluates to UNKNOWN or FALSE, so the first query returns 0. NOT EXISTS asks a different, NULL-safe question ("is there a report row pointing at me?") and returns 173. Filtering NULLs also works but is fragile — the next developer may remove the filter.</p>`,
      output: ` not_in_result
---------------
             0
(1 row)

 not_exists_result
-------------------
               173
(1 row)

 not_in_filtered
-----------------
             173
(1 row)`, run: true },
    { label: 'Advanced', title: 'ANY with arrays, ALL comparisons and empty sets',
      sql: `-- Array parameter style (what an application would bind as $1)
SELECT id, status, total_amount
FROM orders
WHERE id = ANY ('{11, 42, 4999}'::bigint[])
ORDER BY id;

-- Orders larger than EVERY order of customer 15
SELECT count(*) AS bigger_than_all_of_c15
FROM orders
WHERE total_amount > ALL (SELECT total_amount FROM orders WHERE customer_id = 15);

-- Vacuous truth: ALL over an empty set is TRUE, ANY over an empty set is FALSE
SELECT 1 > ALL (SELECT 1 WHERE false) AS all_empty,
       1 > ANY (SELECT 1 WHERE false) AS any_empty;`,
      explain: `<p><code>= ANY(array)</code> is how drivers pass variable-length ID lists with a single bind parameter. <code>&gt; ALL (subquery)</code> requires the comparison to hold for every value returned. The last query shows the edge case: comparing against an empty set with ALL yields TRUE — if a customer had no orders, <em>every</em> order would be "bigger than all of them". Guard with an EXISTS check when that is not what you mean.</p>`,
      output: ` id   | status    | total_amount
------+-----------+--------------
   11 | delivered |    157850.83
   42 | shipped   |    204832.01
 4999 | paid      |    370442.33
(3 rows)

 bigger_than_all_of_c15
------------------------
                   1994
(1 row)

 all_empty | any_empty
-----------+-----------
 t         | f
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Returns 0 rows because the subquery contains NULLs
SELECT id, first_name, job_title
FROM employees
WHERE id NOT IN (SELECT manager_id FROM employees)
LIMIT 5;`, why: 'manager_id is NULL for department heads; NOT IN with any NULL in the list can never be TRUE.', run: true },
    good: { sql: `SELECT e.id, e.first_name, e.job_title
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM employees r WHERE r.manager_id = e.id)
ORDER BY e.id
LIMIT 5;`, why: 'NOT EXISTS is NULL-safe and is planned as an anti join.', run: true }
  },
  mistakes: [
    `<code>NOT IN (SELECT nullable_col ...)</code> — returns nothing once a single NULL appears; the bug often appears months after release.`,
    `<code>WHERE x NOT IN (1, 2, NULL)</code> built from an application list that accidentally contains a null.`,
    `Generating SQL text with thousands of literal IN values — slow parsing, plan-cache bloat, and injection risk if not parameterised.`,
    `Assuming <code>&gt; ALL (subquery)</code> is false when the subquery is empty — it is true.`,
    `Using <code>= ANY</code> with a subquery that returns an array column (compares to the array, not its elements) — use <code>= ANY (SELECT unnest(...))</code> or an array expression.`
  ],
  best: [
    `Use NOT EXISTS for all "not in another table" checks.`,
    `Pass variable lists from applications as one array parameter: <code>WHERE id = ANY($1)</code>.`,
    `For very large ID sets, COPY them into a temp table and join (with ANALYZE).`,
    `When using IN with a subquery on a nullable column, document or enforce NOT NULL on that column.`
  ],
  performance: `<p><code>IN (subquery)</code> and EXISTS produce identical semi-join plans. <code>NOT IN (subquery)</code> produces a hashed SubPlan — fine if the subquery result is small enough to hash in <code>work_mem</code>, terrible if it is not (falls back to a linear rescan per row: O(n x m)). <code>= ANY(array)</code> with an index performs one index search per element (B-tree "ScalarArrayOp" scan; PG17 made multi-element scans significantly cheaper).</p>`,
  security: `<p>Never interpolate user-provided ID lists into SQL text (<code>"IN (" + ids.join(",") + ")"</code>): that is SQL injection. Bind an array parameter instead: <code>WHERE id = ANY($1::bigint[])</code>.</p>`,
  scenario: { title: 'A nightly "orphaned records" report suddenly shows zero orphans', steps: [
    '1. The report uses WHERE id NOT IN (SELECT parent_id FROM child_table).',
    '2. A recent feature allowed child rows without a parent (parent_id NULL).',
    '3. Confirm: SELECT count(*) FROM child_table WHERE parent_id IS NULL > 0.',
    '4. Rewrite with NOT EXISTS; the report shows the real orphans again.',
    '5. Add a lint rule in code review: no NOT IN with subqueries.'
  ] },
  widgets: [],
  interview: [
    { q: 'Explain why NOT IN can return zero rows.', a: 'x NOT IN (list) is x <> each element combined with AND. If any element is NULL, that comparison is UNKNOWN, so the conjunction is never TRUE, and WHERE discards the row. One NULL in the subquery result therefore empties the result set.' },
    { q: 'How do applications pass a variable-length list of IDs safely?', a: 'Bind a single array parameter and use WHERE id = ANY($1::bigint[]). This keeps one prepared statement for any list length, avoids SQL injection and still uses the index.' },
    { q: 'What does x > ALL (empty set) return?', a: 'TRUE — a universally quantified condition over an empty set is vacuously true. x > ANY (empty set) is FALSE.' },
    { q: 'Are IN (subquery) and EXISTS equivalent?', a: 'For the positive form, yes semantically (for non-NULL comparisons) and PostgreSQL plans both as semi joins. The negative forms differ: NOT IN has NULL semantics that NOT EXISTS does not, and they produce different plans.' }
  ],
  exercises: [
    { task: 'Find customers from India or UAE who placed at least one order with status IN (\'cancelled\', \'pending\'), using IN twice.', solution: `SELECT id, name, country
FROM customers
WHERE country IN ('India', 'UAE')
  AND id IN (SELECT customer_id FROM orders WHERE status IN ('cancelled', 'pending'))
ORDER BY id
LIMIT 10;`, run: true },
    { task: 'Find products whose price is greater than ALL prices in the accessories category.', solution: `SELECT id, name, category, price
FROM products
WHERE price > ALL (SELECT price FROM products WHERE category = 'accessories')
ORDER BY price DESC;`, run: true }
  ],
  challenge: { task: 'Demonstrate the NOT IN trap with a self-contained VALUES list, then write the NULL-safe version using NOT EXISTS against the same VALUES list.', hint: 'Use a CTE banned(v) AS (VALUES (1), (NULL::int)).', solution: `WITH banned(v) AS (VALUES (1), (NULL::int)),
     candidates(id) AS (VALUES (1), (2), (3))
SELECT 'NOT IN' AS method, count(*) AS allowed
FROM candidates WHERE id NOT IN (SELECT v FROM banned)
UNION ALL
SELECT 'NOT EXISTS', count(*)
FROM candidates c WHERE NOT EXISTS (SELECT 1 FROM banned b WHERE b.v = c.id);`, run: true },
  related: ['subqueries-correlated-exists', 'joins-outer-joins', 'aggregations-basics', 'constraints-basic'],
  quiz: [
    { type: 'predict', q: 'How many rows?', code: `SELECT * FROM (VALUES (1),(2),(3)) t(x)
WHERE x NOT IN (1, NULL);`, options: ['2', '3', '0', '1'], answer: 2, explain: 'x <> NULL is UNKNOWN for every row, so nothing is TRUE.' },
    { type: 'predict', q: 'How many rows?', code: `SELECT * FROM (VALUES (1),(2),(3)) t(x)
WHERE x IN (1, NULL);`, options: ['1', '0', '3', 'Error'], answer: 0, explain: 'x = 1 is TRUE for the first row; others are UNKNOWN and filtered out.' },
    { type: 'tf', q: '5 > ALL (SELECT 1 WHERE false) evaluates to TRUE.', answer: true, explain: 'ALL over an empty set is vacuously true.' },
    { type: 'mcq', q: 'Safest way for an app to filter by a user-selected list of IDs?', options: ['String-concatenate IN (...)', 'WHERE id = ANY($1::bigint[])', 'One query per id', 'WHERE id::text LIKE ...'], answer: 1, explain: 'One bind parameter, no injection, index-friendly.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: ctes (3 lessons)
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'ctes-with-basics',
  module: 'ctes',
  title: 'WITH Queries: Multiple CTEs, MATERIALIZED and Data-Modifying CTEs',
  level: 2,
  minutes: 22,
  summary: 'Structure complex queries as named steps with WITH, control inlining with MATERIALIZED / NOT MATERIALIZED, and move data atomically with data-modifying CTEs.',
  objectives: [
    'Write queries with one or more CTEs that reference each other',
    'Explain PostgreSQL 12+ CTE inlining and when a CTE is materialised',
    'Force or prevent materialisation with MATERIALIZED / NOT MATERIALIZED',
    'Use INSERT/UPDATE/DELETE ... RETURNING inside WITH to move data in one statement',
    'Know the snapshot rules of data-modifying CTEs (they do not see each other\'s changes)'
  ],
  concept: `<p>A <strong>Common Table Expression</strong> (CTE) is a named subquery defined at the top of a statement with <code>WITH name AS (...)</code>. Later CTEs and the main query can refer to it by name, as if it were a table that exists only for this statement.</p>
<p><strong>Analogy:</strong> a recipe written as numbered steps — "1. make the dough, 2. make the sauce, 3. assemble using the dough and sauce" — instead of one enormous sentence. Each step has a name you can refer to later.</p>
<ul>
<li><strong>Readability:</strong> multi-step logic (filter &rarr; aggregate &rarr; rank &rarr; compare) reads top-down.</li>
<li><strong>Reuse:</strong> a CTE referenced twice is written once — the derived-table example in the previous module that repeated "spend per customer" three times becomes trivial.</li>
<li><strong>Recursion:</strong> <code>WITH RECURSIVE</code> (next lessons) is impossible with plain subqueries.</li>
<li><strong>Data-modifying CTEs:</strong> a CTE may be an <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code> or <code>MERGE</code> (PG17+ for MERGE with RETURNING) with <code>RETURNING</code>; the returned rows feed later steps — e.g. delete old rows and insert them into an archive in one atomic statement.</li>
</ul>
<h4>Optimisation fence: before and after PostgreSQL 12</h4>
<p>Until PostgreSQL 11, every CTE was <em>materialised</em>: computed once in full and stored, and the outer query's filters could not be pushed into it (an "optimisation fence"). Since <strong>PostgreSQL 12</strong>, a non-recursive, side-effect-free CTE that is referenced <strong>exactly once</strong> is <em>inlined</em> like a subquery, so filters are pushed down and indexes can be used. A CTE referenced two or more times is still materialised by default. You can override both: <code>WITH x AS MATERIALIZED (...)</code> forces a fence (useful to stop the planner from re-evaluating an expensive function or to fix a bad plan), and <code>AS NOT MATERIALIZED</code> forces inlining even for multi-referenced CTEs.</p>
<p><strong>Data-modifying CTE rules:</strong> all sub-statements run with the <em>same snapshot</em>, so they cannot see each other's effects on the target tables — the only way to pass data between them is through <code>RETURNING</code>. Data-modifying CTEs are always executed exactly once, to completion, even if the main query does not read their output.</p>`,
  why: `<p>Real analytical SQL is long. Without CTEs it becomes nested derived tables five levels deep that nobody can review. CTEs give names to intermediate results, which makes queries testable step by step (run each CTE alone) and lets the same intermediate result be reused. Data-modifying CTEs let you implement "move", "upsert and log" or "delete and audit" patterns atomically in a single round trip.</p>`,
  useCase: `<p>A retailer archives orders older than 18 months every night: <code>WITH moved AS (DELETE FROM orders WHERE order_date &lt; now() - interval '18 months' RETURNING *) INSERT INTO orders_archive SELECT * FROM moved</code>. The delete and insert are one statement, so a crash can never leave rows deleted-but-not-archived, and no rows are transferred through the application.</p>`,
  internals: `<p>In the plan, a materialised CTE appears as a <code>CTE Scan</code> node reading from a <code>CTE name</code> subplan whose results are stored in a tuplestore (in memory up to <code>work_mem</code>, then spilling to a temp file). Each reference reads from the tuplestore; outer predicates are applied after the CTE is computed. An inlined CTE leaves no trace: the plan looks exactly as if you had written a subquery. A CTE is never inlined when it is recursive, has side effects (data-modifying or volatile functions), or is explicitly <code>MATERIALIZED</code>. Data-modifying CTEs are run to completion before the main query finishes, and their RETURNING rows are buffered.</p>`,
  whenNot: `<p>Do not wrap everything in MATERIALIZED CTEs out of pre-12 habit — you block predicate pushdown and index usage. Do not use a CTE to "cache" a large intermediate result that is referenced once; it will be inlined anyway. For results reused across several statements, use a temporary table (which can also be indexed and ANALYZEd). Avoid two data-modifying CTEs that update the same row: the outcome is unpredictable.</p>`,
  syntax: `WITH [RECURSIVE]
  name1 [(col, ...)] AS [ [NOT] MATERIALIZED ] (SELECT ...),
  name2 AS (SELECT ... FROM name1 ...),
  moved AS (DELETE FROM t WHERE ... RETURNING *)
SELECT ... FROM name2 ...;
-- or: INSERT / UPDATE / DELETE / MERGE as the main statement`,
  examples: [
    { label: 'Basic', title: 'Step-by-step report with two CTEs',
      sql: `WITH dept_pay AS (
    SELECT department_id, count(*) AS headcount, round(avg(salary)) AS avg_salary
    FROM employees
    WHERE is_active
    GROUP BY department_id
),
company AS (
    SELECT round(avg(salary)) AS company_avg FROM employees WHERE is_active
)
SELECT d.name, dp.headcount, dp.avg_salary, c.company_avg,
       dp.avg_salary - c.company_avg AS vs_company
FROM dept_pay dp
JOIN departments d ON d.id = dp.department_id
CROSS JOIN company c
ORDER BY vs_company DESC;`,
      explain: `<p><code>dept_pay</code> computes per-department metrics, <code>company</code> a single company-wide value. The main query joins both. Each CTE is referenced once, so PostgreSQL 12+ inlines them — the plan is the same as with derived tables, but the query reads like a specification.</p>`,
      output: ` name        | headcount | avg_salary | company_avg | vs_company
-------------+-----------+------------+-------------+------------
 Sales       |        25 |     112676 |      102736 |       9940
 Support     |        23 |     105852 |      102736 |       3116
 HR          |        22 |     104768 |      102736 |       2032
 Operations  |        22 |     102323 |      102736 |       -413
 Finance     |        23 |     101504 |      102736 |      -1232
 Marketing   |        24 |     100371 |      102736 |      -2365
 Engineering |        24 |      97304 |      102736 |      -5432
 Research    |        22 |      96359 |      102736 |      -6377
(8 rows)`, run: true },
    { label: 'Intermediate', title: 'MATERIALIZED vs NOT MATERIALIZED in the plan',
      sql: `-- Referenced once: inlined, the filter on id is pushed down into an index scan
EXPLAIN (COSTS OFF)
WITH o AS (SELECT * FROM orders)
SELECT * FROM o WHERE id = 42;

-- Forced fence: the CTE is computed in full, then filtered
EXPLAIN (COSTS OFF)
WITH o AS MATERIALIZED (SELECT * FROM orders)
SELECT * FROM o WHERE id = 42;`,
      explain: `<p>In the first plan there is no CTE at all — just an Index Scan on <code>orders_pkey</code>. In the second, <code>MATERIALIZED</code> creates a fence: a <code>CTE Scan</code> applies <code>id = 42</code> only after all 5,000 orders have been read into the CTE's tuplestore. On a 100M-row table that difference is milliseconds vs minutes. Use MATERIALIZED deliberately, e.g. to evaluate an expensive function once or to stop a bad plan from re-running a subquery.</p>`,
      output: `Index Scan using orders_pkey on orders
  Index Cond: (id = 42)

CTE Scan on o
  Filter: (id = 42)
  CTE o
    ->  Seq Scan on orders`, run: true },
    { label: 'Advanced', title: 'Data-modifying CTE: move old DELETE audit entries to an archive atomically',
      sql: `CREATE TEMP TABLE audit_logs_archive (LIKE audit_logs);

WITH moved AS (
    DELETE FROM audit_logs
    WHERE operation = 'DELETE'
      AND changed_at < now() - interval '30 days'
    RETURNING *
),
archived AS (
    INSERT INTO audit_logs_archive
    SELECT * FROM moved
    RETURNING operation
)
SELECT operation, count(*) AS archived_rows
FROM archived
GROUP BY operation
ORDER BY operation;

SELECT (SELECT count(*) FROM audit_logs)         AS remaining,
       (SELECT count(*) FROM audit_logs_archive) AS in_archive;`,
      explain: `<p><code>moved</code> deletes rows and returns them; <code>archived</code> inserts exactly those rows into the archive and returns their operation; the main query summarises what was moved. It is one statement, so it is atomic: either all rows are moved or none. The final query shows the totals are preserved. (In this sandbox everything is rolled back afterwards.)</p>`,
      output: `CREATE TABLE

 operation | archived_rows
-----------+---------------
 DELETE    |            75
(1 row)

 remaining | in_archive
-----------+------------
       225 |         75
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Same aggregate written three times as nested derived tables
SELECT s.customer_id, s.spend
FROM (SELECT customer_id, sum(total_amount) AS spend FROM orders GROUP BY customer_id) s
WHERE s.spend > 2 * (SELECT avg(spend) FROM
        (SELECT customer_id, sum(total_amount) AS spend FROM orders GROUP BY customer_id) a)
ORDER BY s.spend DESC LIMIT 5;`, why: 'Duplicated logic: two copies of the per-customer aggregate must be kept in sync, and orders is aggregated twice.', run: true },
    good: { sql: `WITH spend AS (
    SELECT customer_id, sum(total_amount) AS spend FROM orders GROUP BY customer_id
)
SELECT customer_id, spend
FROM spend
WHERE spend > 2 * (SELECT avg(spend) FROM spend)
ORDER BY spend DESC LIMIT 5;`, why: 'Written once, referenced twice: PostgreSQL materialises the CTE and aggregates orders only once.', run: true }
  },
  mistakes: [
    `Expecting a data-modifying CTE's changes to be visible to another CTE or the main query reading the same table — they share one snapshot; use RETURNING.`,
    `Adding MATERIALIZED everywhere (pre-PG12 habit), blocking index use for filters applied outside the CTE.`,
    `Assuming a CTE referenced twice is computed twice — it is materialised once by default (good), but the outer filters are then not pushed down (sometimes bad).`,
    `Updating the same row in two data-modifying CTEs — only one change wins, unpredictably.`,
    `Using CTEs for intermediate results needed by several separate statements — use a temp table.`
  ],
  best: [
    `Name CTEs after what they contain (<code>active_customers</code>, <code>monthly_revenue</code>).`,
    `Develop complex queries CTE by CTE, running <code>SELECT * FROM cte_n</code> as you go.`,
    `Use data-modifying CTEs with RETURNING for atomic move/archive/audit operations.`,
    `Use <code>MATERIALIZED</code> only with a measured reason, and comment why.`,
    `Check EXPLAIN for unexpected <code>CTE Scan</code> nodes in performance-critical queries.`
  ],
  performance: `<p>Inlined CTEs cost nothing. Materialised CTEs cost the full computation plus tuplestore writes, and every reference is a sequential read of that store with no indexes. They help when the CTE is expensive and referenced several times, and hurt when a selective outer filter could have used an index. Very large materialised CTEs spill to temp files — check <code>temp_blks_written</code> in <code>EXPLAIN (ANALYZE, BUFFERS)</code>.</p>`,
  security: `<p>Data-modifying CTEs need the corresponding privileges (DELETE on the source, INSERT on the archive). Triggers and RLS policies on the target tables fire normally. When building archive jobs, make sure the archive table has equally strict privileges — audit data is often sensitive.</p>`,
  scenario: { title: 'After upgrading from PG11 to PG16 a report got 100x faster, another got slower', steps: [
    '1. The faster report: a CTE referenced once is now inlined and its filter uses an index.',
    '2. The slower report: a CTE calling an expensive function is now inlined and the function is evaluated more often.',
    '3. EXPLAIN ANALYZE both versions; confirm the function is executed per outer row.',
    '4. Add AS MATERIALIZED to that one CTE (with a comment explaining why).',
    '5. Both reports are now at least as fast as before the upgrade.'
  ] },
  widgets: ['lab:plan', 'diagram:query-pipeline'],
  interview: [
    { q: 'Are CTEs an optimisation fence in PostgreSQL?', a: 'Until PostgreSQL 11, always. Since 12, a non-recursive, side-effect-free CTE referenced once is inlined, so predicates are pushed into it. CTEs referenced more than once are materialised by default. MATERIALIZED and NOT MATERIALIZED override the default.' },
    { q: 'How do you move rows from one table to another in a single atomic statement?', a: 'WITH moved AS (DELETE FROM src WHERE ... RETURNING *) INSERT INTO dst SELECT * FROM moved. The delete and insert are one statement, hence one atomic unit.' },
    { q: 'Can a data-modifying CTE see the changes made by another CTE in the same statement?', a: 'No. All sub-statements use the same snapshot, so they see the table as it was at statement start. Pass data via RETURNING instead.' },
    { q: 'When would you prefer a temp table over a CTE?', a: 'When the intermediate result is reused across multiple statements, is large and needs indexes or statistics (ANALYZE), or when you want to inspect it during debugging.' }
  ],
  exercises: [
    { task: 'Using two CTEs, compute monthly delivered revenue for 2025 and then show only months above the 2025 monthly average.', solution: `WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS month, sum(total_amount) AS revenue
  FROM orders
  WHERE status = 'delivered' AND order_date >= '2025-01-01' AND order_date < '2026-01-01'
  GROUP BY 1
),
avg_month AS (SELECT avg(revenue) AS avg_rev FROM monthly)
SELECT m.month, m.revenue
FROM monthly m, avg_month a
WHERE m.revenue > a.avg_rev
ORDER BY m.month;`, run: true },
    { task: 'With a data-modifying CTE, give a 10% raise to active Support employees and return how many were raised and the new payroll.', solution: `WITH raised AS (
  UPDATE employees e SET salary = round(salary * 1.10, 2)
  FROM departments d
  WHERE d.id = e.department_id AND d.name = 'Support' AND e.is_active
  RETURNING e.salary
)
SELECT count(*) AS raised, sum(salary) AS new_payroll FROM raised;`, run: true }
  ],
  challenge: { task: 'In one statement: cancel all pending orders older than 2025-06-01, write an audit_logs row for each (operation UPDATE, old/new status as jsonb), and return the number of cancelled orders and audit rows written.', hint: 'CTE 1: UPDATE orders ... RETURNING id. CTE 2: INSERT INTO audit_logs (...) SELECT ... FROM cte1 RETURNING id. Main query counts both.', solution: `WITH cancelled AS (
  UPDATE orders SET status = 'cancelled'
  WHERE status = 'pending' AND order_date < '2025-06-01'
  RETURNING id
),
logged AS (
  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by, changed_at)
  SELECT 'orders', 'UPDATE', id, '{"status":"pending"}'::jsonb, '{"status":"cancelled"}'::jsonb, 'cleanup_job', now()
  FROM cancelled
  RETURNING id
)
SELECT (SELECT count(*) FROM cancelled) AS cancelled_orders,
       (SELECT count(*) FROM logged)    AS audit_rows;`, run: true },
  related: ['ctes-recursive-hierarchy', 'subqueries-scalar-derived', 'transactions-acid', 'query-optimization'],
  quiz: [
    { type: 'tf', q: 'In PostgreSQL 16, a non-recursive CTE referenced exactly once is inlined by default.', answer: true, explain: 'Since PostgreSQL 12, unless it is MATERIALIZED, recursive or has side effects.' },
    { type: 'mcq', q: 'Which keyword forces a CTE to be computed once and stored?', options: ['STABLE', 'MATERIALIZED', 'TEMPORARY', 'LATERAL'], answer: 1, explain: 'WITH x AS MATERIALIZED (...).' },
    { type: 'predict', q: 'What does the final SELECT see?', code: `WITH u AS (UPDATE departments SET budget = 0 WHERE id = 1 RETURNING id)
SELECT budget FROM departments WHERE id = 1;`, options: ['0', 'The old budget (5200000.00)', 'NULL', 'Error'], answer: 1, explain: 'The main query uses the same snapshot as the CTE and does not see its changes.' },
    { type: 'scenario', q: 'You need to delete expired sessions and log how many were removed per user, atomically. Best approach?', options: ['Two separate statements without a transaction', 'WITH d AS (DELETE ... RETURNING user_id) INSERT INTO log SELECT user_id, count(*) FROM d GROUP BY user_id', 'A trigger on SELECT', 'A materialized view'], answer: 1, explain: 'A data-modifying CTE does it in one atomic statement.' }
  ]
},
{
  id: 'ctes-recursive-hierarchy',
  module: 'ctes',
  title: 'WITH RECURSIVE: Employee-Manager Hierarchies, Depth, Paths and Cycles',
  level: 3,
  minutes: 24,
  summary: 'Walk the company_db org chart to any depth with WITH RECURSIVE, track level and path, and detect cycles with the PG14+ CYCLE and SEARCH clauses.',
  objectives: [
    'Explain the anchor member, recursive member and termination of a recursive CTE',
    'Traverse top-down (all reports of a manager) and bottom-up (chain to the top)',
    'Track depth and the full path as an array or string',
    'Detect and stop cycles with arrays or the PG14+ CYCLE clause',
    'Order hierarchical output depth-first or breadth-first with SEARCH',
    'Know how to keep recursive queries fast with indexes and depth limits'
  ],
  concept: `<p><code>WITH RECURSIVE</code> lets a CTE reference itself. It has two parts joined by <code>UNION ALL</code> (or <code>UNION</code>):</p>
<ol>
<li><strong>Anchor (non-recursive) member</strong> — the starting rows, e.g. the department heads (<code>manager_id IS NULL</code>).</li>
<li><strong>Recursive member</strong> — a query that joins the CTE's <em>previous iteration</em> to the base table to find the next level, e.g. employees whose <code>manager_id</code> is in the previous level.</li>
</ol>
<p>Execution is iterative, not truly recursive: PostgreSQL evaluates the anchor into a <em>working table</em>, runs the recursive member against the working table to produce the next level, appends those rows to the result, makes them the new working table, and repeats until an iteration produces no rows.</p>
<p><strong>Analogy:</strong> a phone tree. The CEO calls the heads (level 1). Each head calls their direct reports (level 2). Each of those calls theirs... The tree ends when nobody has anyone left to call. Write down each call as "who called whom, at which level, via which chain" and you have depth and path.</p>
<ul>
<li><strong>Depth:</strong> carry a counter: anchor <code>1 AS depth</code>, recursive <code>depth + 1</code>.</li>
<li><strong>Path:</strong> carry an array: anchor <code>ARRAY[id]</code>, recursive <code>path || e.id</code>. Sorting by the path gives a depth-first (indented org chart) order.</li>
<li><strong>Cycles:</strong> bad data (A manages B, B manages A) makes the recursion infinite. Stop it by checking <code>e.id &lt;&gt; ALL(path)</code>, or with the SQL-standard <strong>CYCLE clause</strong> (PostgreSQL 14+): <code>CYCLE id SET is_cycle USING path</code>, which adds a boolean marker and stops following a row once it repeats.</li>
<li><strong>SEARCH clause</strong> (PG14+): <code>SEARCH DEPTH FIRST BY id SET ord</code> or <code>SEARCH BREADTH FIRST BY id SET ord</code> computes an ordering column for you.</li>
</ul>
<p>In company_db, heads 1-8 have no manager; most employees report directly to their head, and some report to a team lead (e.g. employee 20 &rarr; 12 &rarr; 5), giving a maximum depth of 3.</p>`,
  why: `<p>Hierarchies stored as adjacency lists (<code>parent_id</code> columns) are everywhere: org charts, category trees, threaded comments, file systems, bills of materials, network topologies. Self joins only walk a fixed number of levels; WITH RECURSIVE walks any depth in a single declarative query, inside the database, without N round trips from the application.</p>`,
  useCase: `<p>An enterprise with 120,000 employees implements "managers can see their whole organisation's leave requests". Authorisation calls a recursive CTE starting at the logged-in manager and walking down via <code>employees(manager_id)</code> (indexed). The typical org has 6 levels and 300 people; the query reads ~300 index entries and returns in 2 ms. A depth guard (<code>WHERE depth &lt; 20</code>) and the CYCLE clause protect against bad data from HR imports.</p>`,
  internals: `<p>The executor node is <code>Recursive Union</code> with a <code>WorkTable Scan</code> inside the recursive branch. Each iteration's output is stored in a tuplestore; with <code>UNION</code> (not ALL) PostgreSQL also keeps a hash table of all rows seen so far to discard duplicates, which can stop simple cycles but costs memory. The planner cannot know how many iterations will happen, so it uses fixed estimates (it assumes 10x growth), which can mislead downstream join choices. The CYCLE clause is rewritten into an array path column and a boolean computed with <code>= ANY(path)</code>, so it is syntax sugar for the manual array technique.</p>`,
  whenNot: `<p>For very deep or very frequently queried trees with rare changes, consider materialised representations: the <code>ltree</code> <span class="tag ext">extension</span> (materialised paths with GiST indexes), nested sets, or a closure table maintained by triggers — these make "all descendants" a single index scan. For graph problems with many-to-many edges and shortest paths, a recursive CTE works but dedicated graph tooling (e.g. the Apache AGE <span class="tag ext">extension</span> or pgRouting for road networks) may fit better.</p>`,
  syntax: `WITH RECURSIVE cte (cols...) AS (
    SELECT ...                     -- anchor member
  UNION ALL
    SELECT ... FROM base b
    JOIN cte c ON b.parent_id = c.id   -- recursive member
    [WHERE c.depth < max_depth]
)
[ SEARCH { DEPTH | BREADTH } FIRST BY col SET ordercol ]   -- PG14+
[ CYCLE col SET is_cycle USING path ]                       -- PG14+
SELECT ... FROM cte;`,
  examples: [
    { label: 'Basic', title: 'Whole reporting tree under department head 5 (HR) with depth',
      sql: `WITH RECURSIVE org AS (
    SELECT id, first_name, last_name, manager_id, job_title, 1 AS depth
    FROM employees
    WHERE id = 5                               -- anchor: the head of HR
  UNION ALL
    SELECT e.id, e.first_name, e.last_name, e.manager_id, e.job_title, o.depth + 1
    FROM employees e
    JOIN org o ON e.manager_id = o.id          -- recursive: direct reports of the previous level
)
SELECT depth, count(*) AS people
FROM org
GROUP BY depth
ORDER BY depth;`,
      explain: `<p>The anchor returns Priya Nair (id 5). Iteration 1 finds everyone whose <code>manager_id = 5</code> (depth 2). Iteration 2 finds everyone managed by any depth-2 person (depth 3, e.g. employee 20 under team lead 12). Iteration 3 finds nobody, so the recursion stops. Grouping by depth summarises the shape of the organisation.</p>`,
      output: ` depth | people
-------+--------
     1 |      1
     2 |     19
     3 |      5
(3 rows)`, run: true },
    { label: 'Intermediate', title: 'Indented org chart with path ordering, and a bottom-up chain',
      sql: `WITH RECURSIVE org AS (
    SELECT id, first_name, job_title, 1 AS depth, ARRAY[id] AS path
    FROM employees WHERE id = 5
  UNION ALL
    SELECT e.id, e.first_name, e.job_title, o.depth + 1, o.path || e.id
    FROM employees e JOIN org o ON e.manager_id = o.id
)
SELECT repeat('    ', depth - 1) || first_name AS org_chart, job_title, path
FROM org
WHERE id IN (5, 12, 20, 40, 60, 140) OR depth = 1
ORDER BY path;

-- Bottom-up: management chain from employee 180 to the top
WITH RECURSIVE chain AS (
    SELECT id, first_name, manager_id, 0 AS hops FROM employees WHERE id = 180
  UNION ALL
    SELECT m.id, m.first_name, m.manager_id, c.hops + 1
    FROM employees m JOIN chain c ON m.id = c.manager_id
)
SELECT hops, id, first_name FROM chain ORDER BY hops;`,
      explain: `<p>The <code>path</code> array accumulates IDs from the root; ordering by it lists each manager directly followed by their subtree — depth-first order, perfect for an indented tree. <code>repeat()</code> indents by depth. The second query walks <em>upwards</em>: the recursive join is reversed (<code>m.id = c.manager_id</code>), so each iteration moves one level closer to the head.</p>`,
      output: ` org_chart     | job_title          | path
---------------+--------------------+-------------
 Priya         | Head of Department | {5}
     Ishaan    | Engineer           | {5,12}
         Aarav | Analyst            | {5,12,20}
         Aarav | Engineer           | {5,52,60}
         Aarav | Analyst            | {5,132,140}
(5 rows)

 hops | id  | first_name
------+-----+------------
    0 | 180 | Aarav
    1 | 172 | Ishaan
    2 |   5 | Priya
(3 rows)`, run: true },
    { label: 'Advanced', title: 'Cycle detection with the CYCLE clause and SEARCH ordering (PG14+)',
      sql: `-- Simulate bad data: make head 5 report to employee 20, who is in 5's own subtree
UPDATE employees SET manager_id = 20 WHERE id = 5;

WITH RECURSIVE org AS (
    SELECT id, first_name, manager_id FROM employees WHERE id = 12
  UNION ALL
    SELECT e.id, e.first_name, e.manager_id
    FROM employees e JOIN org o ON e.manager_id = o.id
) SEARCH DEPTH FIRST BY id SET ord
  CYCLE id SET is_cycle USING visited
SELECT id, first_name, manager_id, is_cycle, visited
FROM org
WHERE id IN (12, 20, 5, 9) OR is_cycle
ORDER BY ord
LIMIT 8;`,
      explain: `<p>The UPDATE creates a loop 5 &rarr; 12 &rarr; 20 &rarr; 5. Without protection the recursion would never end. <code>CYCLE id SET is_cycle USING visited</code> maintains the array <code>visited</code> of IDs on the current path and marks a row <code>is_cycle = true</code> when its id is already in it — that row is emitted once and not expanded further. <code>SEARCH DEPTH FIRST BY id SET ord</code> adds an ordering column for depth-first output. The <code>visited</code> column is an array of row values — that is why its elements print as <code>(12)</code>. (The sandbox rolls the UPDATE back.)</p>`,
      output: `UPDATE 1

 id | first_name | manager_id | is_cycle | visited
----+------------+------------+----------+----------------------
 12 | Ishaan     |          5 | f        | {(12)}
 20 | Aarav      |         12 | f        | {(12),(20)}
  5 | Priya      |         20 | f        | {(12),(20),(5)}
 12 | Ishaan     |          5 | t        | {(12),(20),(5),(12)}
(4 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- No cycle or depth guard: an accidental cycle would run until memory/disk is exhausted
WITH RECURSIVE org AS (
    SELECT id, manager_id FROM employees WHERE id = 1
  UNION ALL
    SELECT e.id, e.manager_id FROM employees e JOIN org o ON e.manager_id = o.id
)
SELECT count(*) FROM org;`, why: 'Works on clean data, but a single bad manager_id assignment turns it into an infinite loop that fills temp space.', run: true },
    good: { sql: `WITH RECURSIVE org AS (
    SELECT id, manager_id, 1 AS depth FROM employees WHERE id = 1
  UNION ALL
    SELECT e.id, e.manager_id, o.depth + 1
    FROM employees e JOIN org o ON e.manager_id = o.id
    WHERE o.depth < 20                          -- hard safety limit
) CYCLE id SET is_cycle USING path
SELECT count(*) FROM org WHERE NOT is_cycle;`, why: 'Defence in depth: CYCLE stops loops, the depth limit bounds runaway trees, and the result is identical on clean data.', run: true }
  },
  mistakes: [
    `No termination guard — one bad row creates an infinite loop.`,
    `Putting the recursion's filter in the outer query instead of the recursive member: the tree is still fully expanded before filtering.`,
    `Using <code>UNION</code> believing it prevents all cycles — it only removes exact duplicate rows; once you carry depth or path, rows are never duplicates.`,
    `Joining in the wrong direction (<code>e.id = o.manager_id</code> vs <code>e.manager_id = o.id</code>) and walking up when you meant down.`,
    `No index on the parent column (<code>manager_id</code>): every iteration scans the whole table.`
  ],
  best: [
    `Index the parent column used in the recursive join (<code>CREATE INDEX ON employees(manager_id)</code>).`,
    `Always add a depth limit and, on PG14+, the CYCLE clause for data you do not fully control.`,
    `Carry a path array for ordering, breadcrumbs and cycle checks.`,
    `Filter inside the recursive member (prune branches) rather than after the CTE.`,
    `Prevent cycles at write time too: a trigger or check that a new parent is not a descendant.`
  ],
  performance: `<p>Cost ~ (number of nodes visited) x (cost of one recursive-join probe). With an index on the parent column, each level is an index lookup per node; without it, each iteration is a full scan (iterations x table size). Path arrays grow with depth and are copied each iteration — fine for depth &lt; 100. For millions of nodes, a closure table or <code>ltree</code> path with a GiST index turns subtree queries into a single index range scan.</p>`,
  security: `<p>Recursive org-chart queries are often used for authorisation ("may this manager see this employee?"). Put that logic in a <code>SECURITY DEFINER</code> function or an RLS policy with a fixed <code>search_path</code>, and protect it with depth/cycle guards so malicious or bad data cannot cause denial of service.</p>`,
  scenario: { title: 'HR import created a reporting loop and the "my team" page hangs', steps: [
    '1. pg_stat_activity shows the recursive CTE running for minutes and temp files growing.',
    '2. Cancel it with pg_cancel_backend(pid).',
    '3. Find cycles with a recursive query using CYCLE id SET is_cycle USING path and WHERE is_cycle.',
    '4. Fix the bad manager_id rows; add CYCLE + depth limit to the application query.',
    '5. Add a BEFORE UPDATE trigger that rejects a manager_id that is a descendant of the employee.'
  ] },
  widgets: ['diagram:query-pipeline'],
  interview: [
    { q: 'How does PostgreSQL execute WITH RECURSIVE?', a: 'Iteratively: the anchor fills a working table; the recursive member is evaluated against the working table to produce new rows, which are appended to the result and become the next working table. It repeats until an iteration returns no rows. In EXPLAIN this is a Recursive Union with a WorkTable Scan.' },
    { q: 'How do you prevent infinite recursion?', a: 'Track the visited path (array) and stop when the next id is already in it — or on PG14+ use CYCLE id SET is_cycle USING path. Add a depth limit as a second guard. UNION instead of UNION ALL only helps when rows are exact duplicates.' },
    { q: 'How do you produce an indented org chart in the right order?', a: 'Carry an array path of ids (or names) from the root and ORDER BY path, which yields depth-first order; indent with repeat(\' \', depth). PG14+ can compute an ordering column with SEARCH DEPTH FIRST BY id SET ord.' },
    { q: 'What alternatives exist to recursive CTEs for hierarchies?', a: 'Materialised paths (ltree extension with GiST index), nested sets, and closure tables. They make subtree reads fast at the cost of more complex writes.' }
  ],
  exercises: [
    { task: 'Count all people (direct and indirect) under each department head, using a recursive CTE that carries the head id.', solution: `WITH RECURSIVE org AS (
  SELECT id, id AS head_id FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, o.head_id FROM employees e JOIN org o ON e.manager_id = o.id
)
SELECT h.first_name || ' ' || h.last_name AS head, count(*) - 1 AS org_size
FROM org JOIN employees h ON h.id = org.head_id
GROUP BY h.id, head
ORDER BY org_size DESC, h.id;`, run: true },
    { task: 'Show the breadcrumb "Head > Lead > Employee" (first names joined by " > ") for employees 20, 100 and 200.', solution: `WITH RECURSIVE chain AS (
  SELECT id AS start_id, id, manager_id, first_name::text AS crumbs FROM employees WHERE id IN (20, 100, 200)
  UNION ALL
  SELECT c.start_id, m.id, m.manager_id, m.first_name || ' > ' || c.crumbs
  FROM employees m JOIN chain c ON m.id = c.manager_id
)
SELECT start_id, crumbs FROM chain WHERE manager_id IS NULL ORDER BY start_id;`, run: true }
  ],
  challenge: { task: 'Compute for every manager the total salary cost of their entire organisation (including indirect reports, excluding themselves), and list the top 5.', hint: 'Start the anchor with every employee as a potential root (root_id = id), recurse down, then group by root_id excluding the root row itself.', solution: `WITH RECURSIVE sub AS (
  SELECT id AS root_id, id, salary FROM employees
  UNION ALL
  SELECT s.root_id, e.id, e.salary
  FROM employees e JOIN sub s ON e.manager_id = s.id
)
SELECT r.id, r.first_name || ' ' || r.last_name AS manager,
       count(*) AS org_size, sum(sub.salary) AS org_salary_cost
FROM sub JOIN employees r ON r.id = sub.root_id
WHERE sub.id <> sub.root_id
GROUP BY r.id, manager
ORDER BY org_salary_cost DESC
LIMIT 5;`, run: true },
  related: ['ctes-recursive-real-world', 'joins-cross-self', 'ctes-with-basics', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'In a recursive CTE, what does the recursive member read from in each iteration?', options: ['The whole result so far', 'Only the rows produced by the previous iteration (working table)', 'The base table only', 'The anchor only'], answer: 1, explain: 'Each iteration sees only the previous iteration\'s rows.' },
    { type: 'tf', q: 'Using UNION instead of UNION ALL always prevents infinite loops.', answer: false, explain: 'It only discards exact duplicate rows; rows carrying depth or path are never duplicates.' },
    { type: 'bug', q: 'This should list all reports of employee 1 but returns only employee 1. Why?', code: `WITH RECURSIVE org AS (
  SELECT id, manager_id FROM employees WHERE id = 1
  UNION ALL
  SELECT e.id, e.manager_id FROM employees e JOIN org o ON e.id = o.manager_id
) SELECT * FROM org;`, options: ['Needs UNION', 'The join walks upwards (e.id = o.manager_id); for downwards use e.manager_id = o.id', 'Anchor must use manager_id IS NULL', 'RECURSIVE keyword misplaced'], answer: 1, explain: 'Employee 1 has no manager, so walking up stops immediately.' },
    { type: 'mcq', q: 'Which PG14+ clause marks repeated nodes and stops recursion on them?', options: ['SEARCH', 'CYCLE', 'LOOP', 'STOP'], answer: 1, explain: 'CYCLE col SET is_cycle USING path.' }
  ]
},
{
  id: 'ctes-recursive-real-world',
  module: 'ctes',
  title: 'Recursive CTEs in the Real World: Folders, Org Trees, Bills of Materials and Date Gaps',
  level: 3,
  minutes: 22,
  summary: 'Apply WITH RECURSIVE to folder sizes, organisation rollups, multi-level bills of materials with quantity multiplication, and generating series to find gaps.',
  objectives: [
    'Compute folder paths and cumulative sizes in a file tree',
    'Explode a multi-level bill of materials multiplying quantities through levels',
    'Generate number and date series recursively (and know generate_series)',
    'Find gaps in time series by left-joining data onto a generated calendar',
    'Roll metrics up a hierarchy (subtree totals)'
  ],
  concept: `<p>The org-chart lesson taught the mechanics. This lesson applies the same pattern to four problems you will meet in production:</p>
<ul>
<li><strong>Folder hierarchy</strong> (adjacency list <code>parent_id</code>): build full paths like <code>/projects/2025/reports</code> by string concatenation down the tree, and compute total size per folder by rolling file sizes up to every ancestor.</li>
<li><strong>Organisation tree rollups:</strong> attach a metric at the leaves (salary, sales) and aggregate it per subtree — "cost of everyone under this manager".</li>
<li><strong>Bill of materials (BOM):</strong> a bicycle needs 2 wheels; a wheel needs 36 spokes; so a bicycle needs 72 spokes. The recursive member multiplies the parent's required quantity by the child's per-unit quantity at each level. This is the classic MRP (material requirements planning) query.</li>
<li><strong>Series and gaps:</strong> a recursive CTE can count from a start to an end (<code>n + 1</code> until a limit) or step through dates. PostgreSQL also offers the built-in <code>generate_series()</code>, which is faster and clearer for plain sequences — but the recursive form is portable to databases without it and handles irregular steps (e.g. "next business day").</li>
</ul>
<p><strong>Analogy for BOM:</strong> a Russian doll factory order. To ship 10 big dolls you need 10 medium dolls, each of those needs one small doll... and if each medium doll needs 2 small dolls you need 20. The recursion walks down the doll levels, multiplying as it goes.</p>`,
  why: `<p>Tree-shaped and sequence-shaped problems are where plain SQL is weakest and recursive CTEs shine. Doing them in the application means loading the whole tree or making one query per level; doing them in SQL keeps the computation next to the data, in one round trip, with consistent snapshot semantics.</p>`,
  useCase: `<p>A bicycle manufacturer's ERP plans production for 500 bikes next week. A recursive BOM explosion over 12,000 BOM rows (up to 7 levels deep) produces the total quantity of each of 3,400 raw parts in 40 ms; the result is joined to inventory to generate purchase orders for shortfalls. A SaaS file-storage product uses a recursive CTE to compute folder sizes for the "storage usage" page per tenant.</p>`,
  internals: `<p>The executor is the same <code>Recursive Union</code> as before. For rollups (sizes per folder), a common trick is to recurse from every node <em>downwards</em> carrying the starting node as <code>root_id</code>, then <code>GROUP BY root_id</code> — this costs O(sum of subtree sizes) rows, which is fine for thousands of nodes but quadratic-ish for deep trees with millions of nodes (use a closure table there). <code>generate_series</code> is a set-returning C function that produces rows lazily with no working table, so it is much cheaper than a recursive counter.</p>`,
  whenNot: `<p>Do not use a recursive CTE just to produce a sequence of numbers or dates — <code>generate_series(start, stop, step)</code> is simpler and faster. For trees read millions of times per day and changed rarely, precompute (closure table, <code>ltree</code> materialised path, or a materialised view refreshed on change). For general graphs with weighted shortest paths, recursive CTEs explode combinatorially; use a dedicated algorithm (pgRouting <span class="tag ext">extension</span>, application code).</p>`,
  syntax: `-- recursive BOM explosion
WITH RECURSIVE need AS (
    SELECT part_id, qty::numeric AS qty FROM bom WHERE parent_id = :top
  UNION ALL
    SELECT b.part_id, n.qty * b.qty FROM bom b JOIN need n ON b.parent_id = n.part_id
)
SELECT part_id, sum(qty) FROM need GROUP BY part_id;

-- series
SELECT generate_series(date '2025-01-01', date '2025-01-31', interval '1 day');`,
  examples: [
    { label: 'Basic', title: 'Folder paths and cumulative folder sizes',
      sql: `CREATE TEMP TABLE folders (id int PRIMARY KEY, parent_id int REFERENCES folders, name text NOT NULL);
CREATE TEMP TABLE files (id int PRIMARY KEY, folder_id int REFERENCES folders, name text, size_kb int);
INSERT INTO folders VALUES
 (1, NULL, 'root'), (2, 1, 'projects'), (3, 2, '2025'), (4, 3, 'reports'),
 (5, 1, 'hr'), (6, 5, 'policies');
INSERT INTO files VALUES
 (1, 4, 'q1.pdf', 1200), (2, 4, 'q2.pdf', 1500), (3, 3, 'plan.xlsx', 300),
 (4, 2, 'readme.md', 4), (5, 6, 'leave.pdf', 220), (6, 5, 'org.png', 800);

WITH RECURSIVE tree AS (
    SELECT id, id AS root_id, '/' || name AS path
    FROM folders
  UNION ALL
    SELECT f.id, t.root_id, t.path
    FROM folders f JOIN tree t ON f.parent_id = t.id
),
paths AS (
    SELECT id, '/' || name AS path, 1 AS lvl FROM folders WHERE parent_id IS NULL
  UNION ALL
    SELECT f.id, p.path || '/' || f.name, p.lvl + 1
    FROM folders f JOIN paths p ON f.parent_id = p.id
)
SELECT p.path,
       coalesce(sum(fi.size_kb), 0) AS total_kb
FROM paths p
JOIN tree t ON t.root_id = p.id
LEFT JOIN files fi ON fi.folder_id = t.id
GROUP BY p.path
ORDER BY p.path;`,
      explain: `<p><code>paths</code> builds the full path top-down (<code>/root/projects/2025</code>). <code>tree</code> pairs every folder (<code>root_id</code>) with itself and all its descendants. Joining files onto the descendants and grouping by the root folder gives the cumulative size: <code>/root/projects</code> includes the 2025 and reports subfolders. Ordering by path renders a natural tree listing.</p>`,
      output: `CREATE TABLE
CREATE TABLE
INSERT 0 6
INSERT 0 6

 path                        | total_kb
-----------------------------+----------
 /root                       |     4024
 /root/hr                    |     1020
 /root/hr/policies           |      220
 /root/projects              |     3004
 /root/projects/2025         |     3000
 /root/projects/2025/reports |     2700
(6 rows)`, run: true },
    { label: 'Intermediate', title: 'Bill of materials explosion with quantity multiplication',
      sql: `CREATE TEMP TABLE parts (id int PRIMARY KEY, name text NOT NULL, unit_cost numeric(10,2));
CREATE TEMP TABLE bom (parent_id int REFERENCES parts, child_id int REFERENCES parts,
                       qty numeric NOT NULL CHECK (qty > 0), PRIMARY KEY (parent_id, child_id));
INSERT INTO parts VALUES (1,'Bicycle',NULL),(2,'Wheel',NULL),(3,'Frame',4200),(4,'Spoke',12),
                         (5,'Rim',650),(6,'Tyre',900),(7,'Bolt',3),(8,'Hub',NULL);
INSERT INTO bom VALUES (1,2,2),(1,3,1),(1,7,8),(2,4,36),(2,5,1),(2,6,1),(2,8,1),(8,7,4);

WITH RECURSIVE need AS (
    SELECT child_id AS part_id, qty AS qty, 1 AS lvl
    FROM bom WHERE parent_id = 1
  UNION ALL
    SELECT b.child_id, n.qty * b.qty, n.lvl + 1
    FROM bom b JOIN need n ON b.parent_id = n.part_id
)
SELECT p.name, sum(n.qty) AS qty_per_bicycle,
       sum(n.qty) * 500 AS qty_for_500,
       p.unit_cost, sum(n.qty) * p.unit_cost AS cost_per_bicycle
FROM need n JOIN parts p ON p.id = n.part_id
WHERE NOT EXISTS (SELECT 1 FROM bom b WHERE b.parent_id = n.part_id)   -- leaf parts only
GROUP BY p.name, p.unit_cost
ORDER BY cost_per_bicycle DESC;`,
      explain: `<p>Level 1: a bicycle needs 2 wheels, 1 frame, 8 bolts. Level 2: each wheel needs 36 spokes, so <code>2 * 36 = 72</code> spokes; each wheel has a hub. Level 3: each hub needs 4 bolts, so <code>2 * 1 * 4 = 8</code> more bolts. The same part (Bolt) appears at several levels, so we <code>sum</code> per part. Filtering to leaf parts (no children) gives the raw materials to purchase, and multiplying by unit cost gives the material cost of one bicycle.</p>`,
      output: `CREATE TABLE
CREATE TABLE
INSERT 0 8
INSERT 0 8

 name  | qty_per_bicycle | qty_for_500 | unit_cost | cost_per_bicycle
-------+-----------------+-------------+-----------+------------------
 Frame |               1 |         500 |   4200.00 |          4200.00
 Tyre  |               2 |        1000 |    900.00 |          1800.00
 Rim   |               2 |        1000 |    650.00 |          1300.00
 Spoke |              72 |       36000 |     12.00 |           864.00
 Bolt  |              16 |        8000 |      3.00 |            48.00
(5 rows)`, run: true },
    { label: 'Advanced', title: 'Finding gaps: days in 2025-09 with no UAE orders',
      sql: `WITH RECURSIVE days AS (
    SELECT date '2025-09-01' AS d
  UNION ALL
    SELECT d + 1 FROM days WHERE d < date '2025-09-30'
),
uae_orders AS (
    SELECT o.order_date::date AS d, count(*) AS n
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE c.country = 'UAE'
      AND o.order_date >= '2025-09-01' AND o.order_date < '2025-10-01'
    GROUP BY 1
)
SELECT count(*) FILTER (WHERE u.n IS NULL)  AS days_without_orders,
       count(*) FILTER (WHERE u.n IS NOT NULL) AS days_with_orders,
       string_agg(to_char(days.d, 'DD'), ',' ORDER BY days.d) FILTER (WHERE u.n IS NULL) AS gap_days
FROM days
LEFT JOIN uae_orders u ON u.d = days.d;`,
      explain: `<p>The recursive CTE generates the 30 days of September (the same as <code>generate_series('2025-09-01'::date, '2025-09-30', '1 day')</code>). LEFT JOINing the actual per-day order counts onto the calendar exposes days with no orders as NULLs — they cannot be found by querying orders alone, because missing days have no rows. The FILTER clauses summarise gaps and list the gap days.</p>`,
      output: ` days_without_orders | days_with_orders | gap_days
---------------------+------------------+-------------------------------
                  10 |               20 | 01,02,04,05,14,15,16,20,24,25
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Recursive counter just to produce numbers: verbose and slower
WITH RECURSIVE n AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
SELECT count(*), sum(i) FROM n;`, why: 'Works, but builds a working table iteration by iteration for a plain sequence.', run: true },
    good: { sql: `SELECT count(*), sum(i) FROM generate_series(1, 1000) AS g(i);`, why: 'generate_series is a built-in set-returning function: shorter, clearer and much faster. Keep recursion for real trees and irregular steps.', run: true }
  },
  mistakes: [
    `Forgetting to sum quantities for parts that appear at several BOM levels.`,
    `Adding (instead of multiplying) quantities down the BOM levels.`,
    `Looking for gaps by querying the fact table alone — missing days have no rows; you need a calendar to compare against.`,
    `Recursing with dates without a stop condition (<code>WHERE d &lt; end</code>), creating an infinite series.`,
    `Using a recursive CTE where <code>generate_series</code> would do.`
  ],
  best: [
    `Model BOM as (parent, child, qty) with a composite PK and CHECK (qty &gt; 0).`,
    `Use <code>numeric</code> for BOM quantities to avoid floating-point drift across levels.`,
    `Prefer <code>generate_series</code> for regular sequences; recursive CTEs for irregular stepping.`,
    `For time-series gaps, generate the calendar in the query's time zone and use half-open ranges.`,
    `Add cycle protection to BOM and folder recursions — bad data can create loops.`
  ],
  performance: `<p>BOM explosions are linear in the number of (path, part) combinations; shared sub-assemblies used in many places are expanded once per use — memoise by pre-aggregating per sub-assembly for very large BOMs. Rolling sizes up "every node to all descendants" is O(n x depth); for very large trees compute the rollup once and store it, or use a closure table. Calendars from <code>generate_series</code> are cheap; ensure the fact-table side of the gap query uses an index on the time column.</p>`,
  security: `<p>File-tree and org-tree recursions are often used to compute access rights (inherited folder permissions). Make sure the recursion respects tenant boundaries (carry and check <code>tenant_id</code>) so a malformed parent pointer cannot pull another tenant's folders into the result.</p>`,
  scenario: { title: 'Production planning needs raw-material requirements for next week', steps: [
    '1. Load the production plan (product, quantity) into a temp table.',
    '2. Anchor the recursive CTE on the plan rows (qty = planned quantity), recurse through bom multiplying quantities.',
    '3. Keep only leaf parts and sum per part.',
    '4. LEFT JOIN inventory and compute shortfall = required - on_hand.',
    '5. Insert shortfalls into purchase_requests in the same statement via a data-modifying CTE.'
  ] },
  widgets: [],
  interview: [
    { q: 'How do you explode a multi-level bill of materials in SQL?', a: 'With WITH RECURSIVE: the anchor selects the direct children of the top product with their quantity; the recursive member joins bom on parent_id = current part and multiplies the accumulated quantity by the child quantity. Finally group by part and sum, usually keeping only leaf parts.' },
    { q: 'How do you find missing days in a time series?', a: 'Generate a calendar of all expected days (generate_series or a recursive CTE), LEFT JOIN the aggregated facts onto it and select rows where the fact side is NULL.' },
    { q: 'generate_series vs recursive CTE for sequences?', a: 'generate_series is a built-in set-returning function: faster, clearer, supports numbers and timestamps with a step. A recursive CTE is portable and handles irregular steps (e.g. skip weekends/holidays based on a table).' }
  ],
  exercises: [
    { task: 'Using generate_series, list every month from 2024-01 to 2025-09 with the number of orders, showing 0 for months without orders.', solution: `SELECT to_char(m, 'YYYY-MM') AS month, count(o.id) AS orders
FROM generate_series('2024-01-01'::timestamptz, '2025-09-01', interval '1 month') AS m
LEFT JOIN orders o ON o.order_date >= m AND o.order_date < m + interval '1 month'
GROUP BY m
ORDER BY m;`, run: true },
    { task: 'Write a recursive CTE that produces the next 10 business days (Mon-Fri) after 2025-10-01.', solution: `WITH RECURSIVE bd AS (
  SELECT date '2025-10-01' AS d, 0 AS n
  UNION ALL
  SELECT (d + CASE extract(isodow FROM d) WHEN 5 THEN 3 WHEN 6 THEN 2 ELSE 1 END)::date, n + 1
  FROM bd WHERE n < 10
)
SELECT d, to_char(d, 'Dy') AS dow FROM bd WHERE n > 0 ORDER BY d;`, run: true }
  ],
  challenge: { task: 'For each department head, compute the total payroll of their full organisation (head included) and the share of company payroll, via a recursive rollup from every head.', hint: 'Anchor: heads (manager_id IS NULL) with root_id = id. Recurse down. Group by root_id; divide by the scalar total.', solution: `WITH RECURSIVE org AS (
  SELECT id, id AS root_id, salary FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, o.root_id, e.salary FROM employees e JOIN org o ON e.manager_id = o.id
)
SELECT h.first_name || ' ' || h.last_name AS head, d.name AS department,
       sum(org.salary) AS org_payroll,
       round(100 * sum(org.salary) / (SELECT sum(salary) FROM employees), 1) AS pct
FROM org
JOIN employees h ON h.id = org.root_id
JOIN departments d ON d.id = h.department_id
GROUP BY h.id, head, d.name
ORDER BY org_payroll DESC;`, run: true },
  related: ['ctes-recursive-hierarchy', 'ctes-with-basics', 'window-functions-reporting', 'joins-cross-self'],
  quiz: [
    { type: 'predict', q: 'A bike needs 2 wheels; a wheel needs 36 spokes; a hub (1 per wheel) needs 4 bolts; the bike itself needs 8 bolts. Total bolts per bike?', options: ['12', '16', '8', '44'], answer: 1, explain: '8 directly + 2 wheels x 1 hub x 4 bolts = 16.' },
    { type: 'tf', q: 'Querying only the orders table can list the days on which no orders were placed.', answer: false, explain: 'Missing days have no rows; you need a generated calendar to LEFT JOIN against.' },
    { type: 'mcq', q: 'Best way to produce the integers 1..1,000,000?', options: ['Recursive CTE', 'generate_series(1, 1000000)', 'CROSS JOIN of 1000 VALUES', 'A loop in PL/pgSQL'], answer: 1, explain: 'generate_series is purpose-built and fastest.' },
    { type: 'bug', q: 'The BOM explosion gives 38 spokes instead of 72. Why?', code: `SELECT b.child_id, n.qty + b.qty ...  -- in the recursive member`, options: ['Should use UNION', 'Quantities must be multiplied (n.qty * b.qty), not added', 'Missing ORDER BY', 'Anchor wrong'], answer: 1, explain: '2 wheels x 36 spokes = 72; adding gives 38.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: window-functions (4 lessons)
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'window-functions-ranking',
  module: 'window-functions',
  title: 'OVER, PARTITION BY, ORDER BY: ROW_NUMBER, RANK, DENSE_RANK and NTILE',
  level: 2,
  minutes: 22,
  summary: 'Compute values across related rows without collapsing them, and rank rows per group — top employees per department, deduplication, percentiles.',
  objectives: [
    'Explain how a window function differs from GROUP BY aggregation',
    'Use OVER (PARTITION BY ... ORDER BY ...) to define windows',
    'Choose between ROW_NUMBER, RANK, DENSE_RANK and NTILE for ties and buckets',
    'Write top-N-per-group queries (top 3 earners per department)',
    'Deduplicate rows keeping the latest per key with ROW_NUMBER',
    'Know where window functions are evaluated in the query pipeline'
  ],
  concept: `<p>An aggregate with GROUP BY <em>collapses</em> each group into one row. A <strong>window function</strong> computes a value <em>over a set of rows related to the current row</em> — its "window" — but keeps every row. You get detail and context side by side: each employee's salary <em>and</em> their department's average, their rank in the department, their share of the payroll.</p>
<p><strong>Analogy:</strong> a race results board. GROUP BY would tell you "Team A's average time". A window function writes next to each runner's own time their position within their team (rank), the team's best time, and the gap to the runner ahead — without removing any runner from the board.</p>
<p>The <code>OVER</code> clause defines the window:</p>
<ul>
<li><code>PARTITION BY dept</code> — split rows into independent groups (like GROUP BY, but without collapsing). Omit it and the whole result is one partition.</li>
<li><code>ORDER BY salary DESC</code> — order rows inside each partition; required for ranking and LAG/LEAD, and it changes the default frame for aggregates (next lessons).</li>
<li><code>WINDOW w AS (...)</code> — name a window once and reuse it: <code>rank() OVER w</code>.</li>
</ul>
<h4>Ranking functions and ties</h4>
<table><tr><th>Salaries</th><th>row_number()</th><th>rank()</th><th>dense_rank()</th></tr>
<tr><td>900</td><td>1</td><td>1</td><td>1</td></tr>
<tr><td>800</td><td>2</td><td>2</td><td>2</td></tr>
<tr><td>800</td><td>3</td><td>2</td><td>2</td></tr>
<tr><td>700</td><td>4</td><td>4</td><td>3</td></tr></table>
<ul>
<li><code>row_number()</code> — unique sequential number; ties broken arbitrarily unless ORDER BY is unique (add a tiebreaker like <code>id</code>).</li>
<li><code>rank()</code> — ties share a rank, then gaps ("Olympic" ranking).</li>
<li><code>dense_rank()</code> — ties share a rank, no gaps.</li>
<li><code>ntile(n)</code> — splits the ordered partition into n buckets of (almost) equal size: quartiles, deciles.</li>
<li><code>percent_rank()</code> and <code>cume_dist()</code> — relative position in 0..1.</li>
</ul>
<p>Window functions run <strong>after</strong> WHERE, GROUP BY and HAVING, and before the final ORDER BY/LIMIT. Hence you cannot filter on them in WHERE (<code>WHERE rank() ... </code> is an error); wrap the query in a subquery or CTE and filter outside.</p>`,
  why: `<p>Before window functions, "top 3 per department", "running totals" or "difference from previous row" needed self joins or correlated subqueries that were slow and hard to read. Window functions (SQL:2003, PostgreSQL 8.4+) solve these in one pass over sorted data and are the backbone of modern analytical SQL.</p>`,
  useCase: `<p>A marketplace deduplicates a 40M-row product-feed staging table where suppliers resend the same SKU many times a day: <code>row_number() OVER (PARTITION BY supplier_id, sku ORDER BY received_at DESC)</code> and keep <code>rn = 1</code>. The same job ranks sellers per category with <code>dense_rank()</code> to award "Top 10 seller" badges, and uses <code>ntile(10)</code> on revenue to assign sellers to commission tiers.</p>`,
  internals: `<p>The executor's <code>WindowAgg</code> node consumes input sorted by <code>PARTITION BY</code> + <code>ORDER BY</code> keys (a Sort node or an index providing that order). It buffers the current partition (or frame) in a tuplestore and computes each function as rows stream through. Several window functions with the same window share one WindowAgg; different windows need additional sorts — reuse the same <code>OVER</code> definition where possible. PostgreSQL 15+ can stop early for <code>row_number()/rank()/dense_rank()</code> filters like <code>WHERE rn &lt;= 3</code> applied in an outer query ("run condition"), avoiding computing ranks for the rest of each partition. PG16 added further optimisations for frames and DISTINCT.</p>`,
  whenNot: `<p>For a single top-1 per group, <code>DISTINCT ON (group) ... ORDER BY group, value DESC</code> is shorter. For top-N per group over very many groups where only a few groups are needed, LATERAL + index is faster than ranking the whole table. If you need only the group-level number (not the detail rows), plain GROUP BY is cheaper.</p>`,
  syntax: `function_name(args) OVER (
    [PARTITION BY expr [, ...]]
    [ORDER BY expr [ASC|DESC] [NULLS FIRST|LAST] [, ...]]
    [frame_clause]
)
-- named windows
SELECT rank() OVER w, avg(x) OVER w FROM t WINDOW w AS (PARTITION BY a ORDER BY b);`,
  examples: [
    { label: 'Basic', title: 'Each employee next to department statistics',
      sql: `SELECT e.first_name, d.name AS department, e.salary,
       round(avg(e.salary) OVER (PARTITION BY e.department_id)) AS dept_avg,
       e.salary - round(avg(e.salary) OVER (PARTITION BY e.department_id)) AS vs_avg,
       round(100 * e.salary / sum(e.salary) OVER (PARTITION BY e.department_id), 1) AS pct_of_dept
FROM employees e
JOIN departments d ON d.id = e.department_id
WHERE d.name = 'Finance'
ORDER BY e.salary DESC
LIMIT 6;`,
      explain: `<p><code>avg(...) OVER (PARTITION BY department_id)</code> is an ordinary aggregate used as a window function: it computes the department average but attaches it to every row instead of collapsing them. No ORDER BY in the window means the frame is the whole partition. Each row keeps its own salary, so we can compute the difference and share.</p>`,
      output: ` first_name | department | salary    | dept_avg | vs_avg    | pct_of_dept
------------+------------+-----------+----------+-----------+-------------
 Vikram     | Finance    | 210000.00 |   101284 | 108716.00 |         8.3
 Pooja      | Finance    | 149600.00 |   101284 |  48316.00 |         5.9
 Zara       | Finance    | 149300.00 |   101284 |  48016.00 |         5.9
 Anika      | Finance    | 144600.00 |   101284 |  43316.00 |         5.7
 Pooja      | Finance    | 138300.00 |   101284 |  37016.00 |         5.5
 Saanvi     | Finance    | 137800.00 |   101284 |  36516.00 |         5.4
(6 rows)`, run: true },
    { label: 'Intermediate', title: 'Top 3 earners per department (with ties visible)',
      sql: `SELECT department, first_name, last_name, salary, rn, rnk, drnk
FROM (
    SELECT d.name AS department, e.first_name, e.last_name, e.salary,
           row_number() OVER w AS rn,
           rank()       OVER w AS rnk,
           dense_rank() OVER w AS drnk
    FROM employees e
    JOIN departments d ON d.id = e.department_id
    WHERE e.manager_id IS NOT NULL            -- exclude heads
    WINDOW w AS (PARTITION BY d.name ORDER BY e.salary DESC)
) ranked
WHERE rn <= 3 AND department IN ('Sales', 'Research', 'HR')
ORDER BY department, rn;`,
      explain: `<p>The named window <code>w</code> is defined once and used by three ranking functions. Window functions cannot appear in WHERE, so the ranking happens in a subquery and the outer query filters <code>rn &lt;= 3</code>. If two people tie, <code>row_number</code> still gives 1,2,3 (arbitrary order among ties), <code>rank</code> repeats and skips, <code>dense_rank</code> repeats without skipping. Choose the function that matches the business rule: "exactly 3 people" (row_number) vs "everyone with a top-3 salary" (dense_rank &lt;= 3).</p>`,
      output: ` department | first_name | last_name | salary    | rn | rnk | drnk
------------+------------+-----------+-----------+----+-----+------
 HR         | Ishaan     | Das       | 149700.00 |  1 |   1 |    1
 HR         | Aarav      | Malhotra  | 145200.00 |  2 |   2 |    2
 HR         | Aditya     | Saxena    | 141700.00 |  3 |   3 |    3
 Research   | Pooja      | Patel     | 148800.00 |  1 |   1 |    1
 Research   | Zara       | Malhotra  | 136100.00 |  2 |   2 |    2
 Research   | Isha       | Saxena    | 135200.00 |  3 |   3 |    3
 Sales      | Tara       | Bose      | 149300.00 |  1 |   1 |    1
 Sales      | Neha       | Agarwal   | 147500.00 |  2 |   2 |    2
 Sales      | Tara       | Bose      | 146900.00 |  3 |   3 |    3
(9 rows)`, run: true },
    { label: 'Advanced', title: 'Customer value quartiles with NTILE and deduplication with ROW_NUMBER',
      sql: `WITH spend AS (
    SELECT customer_id, sum(total_amount) AS spend
    FROM orders WHERE status <> 'cancelled'
    GROUP BY customer_id
),
tiers AS (
    SELECT customer_id, spend, ntile(4) OVER (ORDER BY spend DESC) AS quartile
    FROM spend
)
SELECT quartile, count(*) AS customers,
       min(spend) AS min_spend, max(spend) AS max_spend,
       round(100 * sum(spend) / sum(sum(spend)) OVER (), 1) AS pct_of_revenue
FROM tiers
GROUP BY quartile
ORDER BY quartile;

-- Keep only the latest order per customer (dedup pattern)
SELECT count(*) AS latest_orders
FROM (SELECT o.*, row_number() OVER (PARTITION BY customer_id ORDER BY order_date DESC, id DESC) AS rn
      FROM orders o) x
WHERE rn = 1;`,
      explain: `<p><code>ntile(4)</code> splits customers ordered by spend into four equal buckets. Grouping by quartile summarises each tier, and <code>sum(sum(spend)) OVER ()</code> — a window over an aggregate — computes the grand total so each quartile's share of revenue can be shown (the classic Pareto view). The second query is the standard dedup pattern: number rows per key newest-first and keep <code>rn = 1</code>; the <code>id DESC</code> tiebreaker makes the choice deterministic.</p>`,
      output: ` quartile | customers | min_spend  | max_spend  | pct_of_revenue
----------+-----------+------------+------------+----------------
        1 |       125 | 2797905.98 | 5940193.48 |           37.6
        2 |       125 | 2211170.68 | 2780952.00 |           27.6
        3 |       125 | 1644676.67 | 2206393.68 |           21.3
        4 |       125 |   42823.65 | 1644051.90 |           13.4
(4 rows)

 latest_orders
---------------
           500
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Correlated subquery recomputes the department ranking for every row
SELECT e.first_name, e.department_id, e.salary
FROM employees e
WHERE (SELECT count(*) FROM employees x
       WHERE x.department_id = e.department_id AND x.salary > e.salary) < 3
ORDER BY e.department_id, e.salary DESC;`, why: 'For each of the n employees it counts higher earners in the department: O(n^2) work, and the tie semantics are implicit and easy to get wrong.', run: true },
    good: { sql: `SELECT first_name, department_id, salary
FROM (SELECT e.*, rank() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rnk
      FROM employees e) r
WHERE rnk <= 3
ORDER BY department_id, salary DESC;`, why: 'One sort and one pass compute all ranks; the tie behaviour (rank) is explicit. PG15+ can stop ranking each partition after rank 3.', run: true }
  },
  mistakes: [
    `Filtering on a window function in WHERE — not allowed; wrap in a subquery/CTE.`,
    `Using <code>row_number()</code> with a non-unique ORDER BY and expecting a stable result — add a unique tiebreaker.`,
    `Using row_number when the business rule says ties should share a place (use rank/dense_rank).`,
    `Confusing <code>PARTITION BY</code> with GROUP BY and expecting fewer rows.`,
    `Defining many slightly different windows, forcing multiple sorts — reuse a named WINDOW.`
  ],
  best: [
    `Always include a deterministic tiebreaker (<code>, id</code>) in ranking ORDER BY clauses.`,
    `Use the WINDOW clause to name and share window definitions.`,
    `Use <code>row_number() ... = 1</code> for deduplication, <code>dense_rank()</code> for "top N distinct values".`,
    `Index <code>(partition_col, order_col)</code> when the query is selective, so the sort can be avoided.`,
    `For a single best row per group, consider <code>DISTINCT ON</code>.`
  ],
  performance: `<p>The main cost is sorting by partition and order keys: O(n log n) and memory-bound by <code>work_mem</code> (spills to disk beyond it). An index providing the same order lets PostgreSQL skip the Sort. Each distinct window specification may require another sort. With PG15+, outer filters like <code>rn &lt;= 3</code> become a "Run Condition" on the WindowAgg, so it stops emitting ranks early within each partition.</p>`,
  security: `<p>Ranking and percentile output can reveal sensitive information (e.g. "rank 1 salary in a 2-person team"). Apply the same small-group suppression rules as for aggregates in HR reports.</p>`,
  scenario: { title: 'Staging table has duplicates; the upsert into products fails', steps: [
    '1. INSERT ... ON CONFLICT fails with "command cannot affect row a second time" because the batch contains the same SKU twice.',
    '2. Deduplicate the batch: SELECT DISTINCT ON or row_number() OVER (PARTITION BY sku ORDER BY received_at DESC) = 1.',
    '3. Feed only rn = 1 rows into the upsert.',
    '4. Add a unique tiebreaker (received_at, id) so reruns choose the same row.'
  ] },
  widgets: [],
  interview: [
    { q: 'Difference between ROW_NUMBER, RANK and DENSE_RANK?', a: 'All number rows within a partition by the ORDER BY. row_number gives unique numbers even for ties; rank gives ties the same number and then skips (1,2,2,4); dense_rank gives ties the same number without gaps (1,2,2,3).' },
    { q: 'Why can\'t you use a window function in WHERE?', a: 'Window functions are evaluated after WHERE, GROUP BY and HAVING. To filter by them, compute them in a subquery or CTE and filter in the outer query (or use QUALIFY in databases that support it — PostgreSQL does not).' },
    { q: 'How do you deduplicate a table keeping the latest row per key?', a: 'row_number() OVER (PARTITION BY key ORDER BY updated_at DESC, id DESC) and keep rn = 1 (or delete rn > 1 via ctid/id). DISTINCT ON (key) ORDER BY key, updated_at DESC is a PostgreSQL shortcut.' },
    { q: 'What is the difference between PARTITION BY and GROUP BY?', a: 'GROUP BY collapses each group into one output row; PARTITION BY defines groups for a window function while keeping every input row.' }
  ],
  exercises: [
    { task: 'Rank products within each category by price (highest first) using dense_rank and show the top 2 price levels per category.', solution: `SELECT category, name, price, price_rank
FROM (SELECT category, name, price,
             dense_rank() OVER (PARTITION BY category ORDER BY price DESC) AS price_rank
      FROM products) p
WHERE price_rank <= 2
ORDER BY category, price_rank;`, run: true },
    { task: 'Split all active employees into salary quartiles with ntile(4) and show the salary range of each quartile.', solution: `SELECT quartile, count(*), min(salary), max(salary)
FROM (SELECT salary, ntile(4) OVER (ORDER BY salary) AS quartile
      FROM employees WHERE is_active) q
GROUP BY quartile
ORDER BY quartile;`, run: true }
  ],
  challenge: { task: 'For each country, find the top 2 customers by delivered-order spend, and show their share of that country\'s delivered revenue.', hint: 'Aggregate spend per customer, then row_number() OVER (PARTITION BY country ORDER BY spend DESC) and sum(spend) OVER (PARTITION BY country).', solution: `WITH s AS (
  SELECT c.country, c.id, c.name, sum(o.total_amount) AS spend
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.status = 'delivered'
  GROUP BY c.country, c.id, c.name
), r AS (
  SELECT s.*, row_number() OVER (PARTITION BY country ORDER BY spend DESC, id) AS rn,
         sum(spend) OVER (PARTITION BY country) AS country_total
  FROM s
)
SELECT country, rn, name, spend, round(100 * spend / country_total, 2) AS pct_of_country
FROM r WHERE rn <= 2
ORDER BY country, rn;`, run: true },
  related: ['window-functions-lag-lead', 'window-functions-frames', 'joins-lateral', 'aggregations-group-by-having'],
  quiz: [
    { type: 'predict', q: 'Values 10, 20, 20, 30 ordered DESC. dense_rank() for 10?', code: `SELECT v, dense_rank() OVER (ORDER BY v DESC) FROM (VALUES (10),(20),(20),(30)) t(v);`, options: ['4', '3', '2', '1'], answer: 1, explain: '30 -> 1, 20 -> 2, 20 -> 2, 10 -> 3.' },
    { type: 'bug', q: 'Why does this fail?', code: `SELECT *, row_number() OVER (ORDER BY salary DESC) AS rn
FROM employees WHERE rn <= 5;`, options: ['row_number needs PARTITION BY', 'Window results are not visible in WHERE; filter in an outer query', 'rn must be quoted', 'ORDER BY must be ASC'], answer: 1, explain: 'WHERE is evaluated before window functions.' },
    { type: 'tf', q: 'A window function with PARTITION BY returns one row per partition.', answer: false, explain: 'It returns every input row; only GROUP BY collapses rows.' },
    { type: 'mcq', q: 'You must pick exactly one "latest" row per customer even when two orders share a timestamp. Use:', options: ['rank()', 'dense_rank()', 'row_number() with a unique tiebreaker', 'ntile(1)'], answer: 2, explain: 'row_number guarantees one row per number; the tiebreaker makes it deterministic.' }
  ]
},
{
  id: 'window-functions-lag-lead',
  module: 'window-functions',
  title: 'LAG, LEAD, FIRST_VALUE, LAST_VALUE and NTH_VALUE',
  level: 2,
  minutes: 20,
  summary: 'Look at neighbouring rows — previous transaction, next event, first and last in a group — to compute deltas, gaps and month-over-month growth.',
  objectives: [
    'Use LAG and LEAD with offsets and default values',
    'Compute differences between consecutive rows (time between orders)',
    'Compute month-over-month growth on aggregated data',
    'Use FIRST_VALUE / LAST_VALUE / NTH_VALUE correctly with frames',
    'Avoid self joins on id - 1 for previous-row logic'
  ],
  concept: `<p><strong>Offset functions</strong> read a value from another row of the same partition, relative to the current row, according to the window's ORDER BY:</p>
<ul>
<li><code>lag(expr [, offset [, default]])</code> — value from <em>offset</em> rows before (default 1). Returns <em>default</em> (or NULL) when there is no such row.</li>
<li><code>lead(expr [, offset [, default]])</code> — value from rows after.</li>
<li><code>first_value(expr)</code>, <code>last_value(expr)</code>, <code>nth_value(expr, n)</code> — value from the first / last / n-th row <strong>of the window frame</strong>.</li>
</ul>
<p><strong>Analogy:</strong> reading a bank statement. For each transaction you glance up one line (LAG) to see the previous balance, or down one line (LEAD) to see what happened next. FIRST_VALUE is the opening balance at the top of the page.</p>
<p>LAG/LEAD ignore the frame — they always look at the partition. <code>first_value</code>/<code>last_value</code>/<code>nth_value</code> use the <strong>frame</strong>, and the default frame when ORDER BY is present is <code>RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW</code>. So <code>last_value()</code> with a plain ORDER BY returns the <em>current row's</em> value (the frame ends at the current row, and its peers) — the infamous LAST_VALUE trap. Fix it with an explicit frame: <code>ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING</code> (details in the next lesson).</p>
<p>A typical pattern for period-over-period comparison: aggregate first (one row per month), then apply <code>lag()</code> over the aggregated rows. Window functions may wrap aggregates directly: <code>lag(sum(total_amount)) OVER (ORDER BY month)</code>.</p>`,
  why: `<p>Questions like "how long since the customer's previous order?", "did revenue grow vs last month?", "what was the first product a customer bought?", "time between login and first purchase" are about relationships between rows in sequence. LAG/LEAD answer them in one ordered pass; the alternative self join on "the max date less than this date" is slow and error-prone.</p>`,
  useCase: `<p>A subscription business computes churn signals: for each customer the gap in days between consecutive orders (<code>order_date - lag(order_date)</code>). Customers whose latest gap is &gt; 2x their median gap get a retention offer. On 30M orders the query is a single sort by (customer_id, order_date) — about 20 s nightly — versus hours for the previous self-join implementation.</p>`,
  internals: `<p>LAG/LEAD are computed by the WindowAgg node from the buffered partition: it keeps rows of the current partition in a tuplestore and fetches the row at position current &plusmn; offset. <code>first_value</code>/<code>last_value</code>/<code>nth_value</code> fetch positions relative to the frame boundaries, which the node tracks as it advances. PostgreSQL does not support <code>IGNORE NULLS</code> for these functions (a frequently requested SQL-standard feature) — emulate it with a running count of non-NULL values used as a group key, then <code>first_value</code> over that group.</p>`,
  whenNot: `<p>If you need the previous row from a <em>different</em> table or a non-ordinal relationship ("the last price change before this order"), use LATERAL with ORDER BY ... LIMIT 1. Do not use LAG to fill gaps in time series where whole periods are missing — the previous <em>row</em> is not necessarily the previous <em>period</em>; generate a calendar first.</p>`,
  syntax: `lag(expr [, offset [, default]])  OVER (PARTITION BY ... ORDER BY ...)
lead(expr [, offset [, default]]) OVER (...)
first_value(expr) OVER (... ORDER BY ...)
last_value(expr)  OVER (... ORDER BY ... ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
nth_value(expr, n) OVER (...)`,
  examples: [
    { label: 'Basic', title: 'Previous and next order of a customer, and days between orders',
      sql: `SELECT id, order_date::date AS order_day, total_amount,
       lag(order_date::date)  OVER w AS prev_order_day,
       order_date::date - lag(order_date::date) OVER w AS days_since_prev,
       lead(total_amount) OVER w AS next_amount
FROM orders
WHERE customer_id = 42
WINDOW w AS (ORDER BY order_date)
ORDER BY order_date;`,
      explain: `<p>Within customer 42's orders sorted by date, <code>lag</code> fetches the previous row's date (NULL for the first order) and <code>lead</code> the next row's amount (NULL for the last). Subtracting two <code>date</code> values gives an integer number of days.</p>`,
      output: ` id   | order_day  | total_amount | prev_order_day | days_since_prev | next_amount
------+------------+--------------+----------------+-----------------+-------------
 3525 | 2024-03-31 |     77958.71 |                |                 |   226734.93
 3961 | 2024-07-04 |    226734.93 | 2024-03-31     |              95 |   471259.80
  487 | 2024-07-13 |    471259.80 | 2024-07-04     |               9 |   344575.50
 2306 | 2024-08-19 |    344575.50 | 2024-07-13     |              37 |   426381.77
 3685 | 2024-10-25 |    426381.77 | 2024-08-19     |              67 |    94809.30
 1768 | 2024-10-28 |     94809.30 | 2024-10-25     |               3 |   206422.74
 2341 | 2025-04-16 |    206422.74 | 2024-10-28     |             170 |    58953.24
 1808 | 2025-07-11 |     58953.24 | 2025-04-16     |              86 |   186939.79
 1135 | 2025-08-01 |    186939.79 | 2025-07-11     |              21 |   294680.11
 3422 | 2025-08-18 |    294680.11 | 2025-08-01     |              17 |
(10 rows)`, run: true },
    { label: 'Intermediate', title: 'Month-over-month revenue growth',
      sql: `SELECT to_char(month, 'YYYY-MM') AS month,
       revenue,
       lag(revenue) OVER (ORDER BY month) AS prev_month,
       round(100 * (revenue - lag(revenue) OVER (ORDER BY month))
                 / lag(revenue) OVER (ORDER BY month), 1) AS mom_pct,
       lag(revenue, 12) OVER (ORDER BY month) AS same_month_last_year
FROM (SELECT date_trunc('month', order_date) AS month, sum(total_amount) AS revenue
      FROM orders
      WHERE status <> 'cancelled' AND order_date >= '2024-01-01' AND order_date < '2025-10-01'
      GROUP BY 1) m
ORDER BY month DESC
LIMIT 6;`,
      explain: `<p>The subquery aggregates to one row per month; the window functions then compare each month with the previous one (<code>lag(revenue)</code>) and with the same month a year earlier (<code>lag(revenue, 12)</code> — 12 rows back, valid because every month has data; otherwise generate a calendar first). Notice the final <code>ORDER BY month DESC</code> is independent from the window's ORDER BY.</p>`,
      output: ` month   | revenue     | prev_month  | mom_pct | same_month_last_year
---------+-------------+-------------+---------+----------------------
 2025-09 | 55130670.31 | 54226809.17 |     1.7 |          52651162.69
 2025-08 | 54226809.17 | 46711169.14 |    16.1 |          59194417.69
 2025-07 | 46711169.14 | 63539516.88 |   -26.5 |          57299313.01
 2025-06 | 63539516.88 | 50257319.76 |    26.4 |          55551447.07
 2025-05 | 50257319.76 | 50083347.77 |     0.3 |          65183031.59
 2025-04 | 50083347.77 | 51230446.09 |    -2.2 |          53332708.95
(6 rows)`, run: true },
    { label: 'Advanced', title: 'First and last purchase per customer, and the LAST_VALUE trap',
      sql: `SELECT DISTINCT customer_id,
       first_value(id) OVER w_all  AS first_order_id,
       last_value(id)  OVER w_all  AS last_order_id,
       nth_value(id, 2) OVER w_all AS second_order_id,
       count(*)        OVER w_all  AS orders
FROM orders
WHERE customer_id IN (7, 15, 23)
WINDOW w_all AS (PARTITION BY customer_id ORDER BY order_date
                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
ORDER BY customer_id;

-- The trap: default frame ends at the current row
SELECT id, order_date::date,
       last_value(id) OVER (ORDER BY order_date) AS last_value_default_frame
FROM orders WHERE customer_id = 7
ORDER BY order_date
LIMIT 4;`,
      explain: `<p>With the explicit full frame, every row of a customer sees the same first, second and last order, so <code>DISTINCT</code> collapses them into one row per customer. In the second query, the default frame (<code>RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW</code>) makes <code>last_value</code> return the current row's id — it looks like a bug but is the standard-defined behaviour.</p>`,
      output: ` customer_id | first_order_id | last_order_id | second_order_id | orders
-------------+----------------+---------------+-----------------+--------
           7 |           3858 |          1240 |            2536 |     11
          15 |           2912 |          4627 |            4601 |      4
          23 |            688 |           477 |            2737 |     12
(3 rows)

 id   | order_date | last_value_default_frame
------+------------+--------------------------
 3858 | 2024-04-20 |                     3858
 2536 | 2024-06-21 |                     2536
 1157 | 2024-07-04 |                     1157
 2924 | 2024-07-23 |                     2924
(4 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Previous order via correlated subquery: one extra search per row
SELECT o.id, o.order_date::date,
       (SELECT max(p.order_date) FROM orders p
        WHERE p.customer_id = o.customer_id AND p.order_date < o.order_date)::date AS prev_order
FROM orders o
WHERE o.customer_id = 42
ORDER BY o.order_date;`, why: 'A SubPlan runs for every row and scans orders each time (customer_id is not indexed); ties on order_date are silently skipped.', run: true },
    good: { sql: `SELECT id, order_date::date,
       lag(order_date) OVER (ORDER BY order_date, id)::date AS prev_order
FROM orders
WHERE customer_id = 42
ORDER BY order_date;`, why: 'One sort, one pass; the previous row is exactly defined by the window ORDER BY including a tiebreaker.', run: true }
  },
  mistakes: [
    `Using <code>last_value()</code> with the default frame and getting the current row back.`,
    `Self joining on <code>id = id - 1</code> for "previous row" — IDs have gaps and are not chronological.`,
    `Using <code>lag(x, 12)</code> for "same month last year" when some months are missing.`,
    `Forgetting PARTITION BY, so the "previous order" crosses from one customer to another.`,
    `Dividing by <code>lag()</code> without handling NULL/zero (first row, zero revenue months) — use <code>NULLIF(lag(x) OVER w, 0)</code>.`
  ],
  best: [
    `Always PARTITION BY the entity (customer, device) when comparing consecutive events.`,
    `Use the third argument of lag/lead for a sensible default (<code>lag(x, 1, 0)</code>).`,
    `Specify an explicit frame for first_value/last_value/nth_value.`,
    `Aggregate to the reporting grain first, then apply lag/lead.`,
    `Include a unique tiebreaker in the window ORDER BY.`
  ],
  performance: `<p>All offset functions share the cost of sorting by the window keys. Multiple functions over the same named window add negligible cost. An index on <code>(customer_id, order_date)</code> lets a per-customer query avoid sorting entirely. For full-table runs, ensure <code>work_mem</code> is large enough to sort in memory, or accept an external merge sort.</p>`,
  security: ``,
  scenario: { title: 'Fraud team needs "rapid repeat payments" alerts', steps: [
    '1. For each customer, compute paid_at - lag(paid_at) OVER (PARTITION BY customer ORDER BY paid_at).',
    '2. Flag rows where the gap is under 60 seconds and the amount equals the previous amount (lag(amount)).',
    '3. Restrict to the last hour with a WHERE on paid_at and index (customer_id, paid_at).',
    '4. Schedule every minute; push flagged rows into an alerts table via INSERT ... SELECT.'
  ] },
  widgets: [],
  interview: [
    { q: 'How do you compute month-over-month growth in SQL?', a: 'Aggregate revenue per month in a subquery/CTE, then use lag(revenue) OVER (ORDER BY month) to get the previous month and compute (revenue - prev) / prev. Generate a calendar first if months can be missing, and guard division by zero with NULLIF.' },
    { q: 'Why does last_value often return the current row?', a: 'With ORDER BY in the window, the default frame is RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW, so the last row of the frame is the current row (or its last peer). Use ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING.' },
    { q: 'Do LAG and LEAD respect the window frame?', a: 'No. They are defined relative to the partition and its ordering, independent of the frame clause. first_value, last_value and nth_value do use the frame.' }
  ],
  exercises: [
    { task: 'For employees in department 3 ordered by hire_date, show each hire with the previous hire\'s name and the number of days between the two hires.', solution: `SELECT first_name, hire_date,
       lag(first_name) OVER w AS prev_hire,
       hire_date - lag(hire_date) OVER w AS days_after_prev
FROM employees
WHERE department_id = 3
WINDOW w AS (ORDER BY hire_date, id)
ORDER BY hire_date
LIMIT 10;`, run: true },
    { task: 'For each payment method, compute 2025 monthly successful amount and the difference to the previous month.', solution: `SELECT method, to_char(m, 'YYYY-MM') AS month, amount,
       amount - lag(amount) OVER (PARTITION BY method ORDER BY m) AS diff_prev
FROM (SELECT method, date_trunc('month', paid_at) AS m, sum(amount) AS amount
      FROM payments
      WHERE status = 'success' AND paid_at >= '2025-01-01'
      GROUP BY 1, 2) x
ORDER BY method, m
LIMIT 12;`, run: true }
  ],
  challenge: { task: 'For every customer with at least 5 orders, compute the average gap in days between consecutive orders and the gap of their most recent order; list the 5 customers whose latest gap is largest relative to their average.', hint: 'lag() per customer, then aggregate per customer: avg(gap) and the gap of the row with rn = 1 by order_date DESC.', solution: `WITH g AS (
  SELECT customer_id, order_date,
         order_date::date - lag(order_date::date) OVER (PARTITION BY customer_id ORDER BY order_date, id) AS gap,
         row_number() OVER (PARTITION BY customer_id ORDER BY order_date DESC, id DESC) AS rn,
         count(*) OVER (PARTITION BY customer_id) AS n
  FROM orders
)
SELECT customer_id, round(avg(gap), 1) AS avg_gap,
       max(gap) FILTER (WHERE rn = 1) AS latest_gap,
       round(max(gap) FILTER (WHERE rn = 1) / nullif(avg(gap), 0), 2) AS ratio
FROM g
WHERE n >= 5
GROUP BY customer_id
ORDER BY ratio DESC NULLS LAST
LIMIT 5;`, run: true },
  related: ['window-functions-ranking', 'window-functions-frames', 'window-functions-reporting', 'joins-lateral'],
  quiz: [
    { type: 'predict', q: 'Result of lag(v, 1, 0) for the first row?', code: `SELECT v, lag(v, 1, 0) OVER (ORDER BY v) FROM (VALUES (5),(7)) t(v);`, options: ['NULL', '0', '5', '7'], answer: 1, explain: 'The third argument is the default when no previous row exists.' },
    { type: 'tf', q: 'lag() and lead() are affected by the ROWS/RANGE frame clause.', answer: false, explain: 'They work relative to the partition, ignoring the frame.' },
    { type: 'bug', q: 'This should show each customer\'s most recent order on every row but shows the current order. Fix?', code: `SELECT id, last_value(id) OVER (PARTITION BY customer_id ORDER BY order_date) FROM orders;`, options: ['Use lead()', 'Add ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING', 'Remove PARTITION BY', 'Use DESC'], answer: 1, explain: 'The default frame ends at the current row. (Alternatively first_value with ORDER BY order_date DESC.)' },
    { type: 'mcq', q: 'Previous order of the same customer requires:', options: ['lag(order_date) OVER (ORDER BY order_date)', 'lag(order_date) OVER (PARTITION BY customer_id ORDER BY order_date)', 'lead(order_date) OVER (PARTITION BY id)', 'first_value(order_date) OVER ()'], answer: 1, explain: 'Partition by customer so comparisons do not cross customers.' }
  ]
},
{
  id: 'window-functions-frames',
  module: 'window-functions',
  title: 'Running Totals, Moving Averages and Window Frames (ROWS vs RANGE vs GROUPS)',
  level: 3,
  minutes: 24,
  summary: 'Control exactly which rows an aggregate window sees with frame clauses — cumulative sums, 7-day moving averages, peer handling and EXCLUDE.',
  objectives: [
    'Explain the default frame with and without ORDER BY',
    'Write running totals with SUM() OVER (ORDER BY ...)',
    'Write moving averages with ROWS BETWEEN n PRECEDING AND CURRENT ROW',
    'Distinguish ROWS, RANGE (including RANGE with interval offsets) and GROUPS',
    'Explain how ties (peers) change RANGE results',
    'Use EXCLUDE CURRENT ROW / TIES and avoid the LAST_VALUE trap'
  ],
  concept: `<p>For aggregate functions used as window functions (<code>sum</code>, <code>avg</code>, <code>count</code>, <code>min</code>, <code>max</code> ...) and for <code>first_value</code>/<code>last_value</code>/<code>nth_value</code>, the <strong>frame</strong> decides which rows of the partition are included for the current row.</p>
<p><strong>Analogy:</strong> a sliding magnifying glass over a list. The partition is the whole list; the frame is the part currently under the glass. A running total uses a glass that starts at the top and stretches down to the current line; a 7-day moving average uses a glass exactly 7 lines tall that slides down.</p>
<h4>Default frames</h4>
<ul>
<li>No ORDER BY in OVER: frame = whole partition (<code>sum(x) OVER (PARTITION BY d)</code> = group total).</li>
<li>With ORDER BY: <code>RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW</code> — from the start up to the current row <strong>and all its peers</strong> (rows with equal ORDER BY values). This is why <code>sum(x) OVER (ORDER BY day)</code> is a running total, and why rows sharing the same day all show the same running total.</li>
</ul>
<h4>Frame modes</h4>
<table><tr><th>Mode</th><th>Offsets count</th><th>Example</th><th>Use</th></tr>
<tr><td><code>ROWS</code></td><td>physical rows</td><td><code>ROWS BETWEEN 6 PRECEDING AND CURRENT ROW</code></td><td>last 7 rows (moving average over rows)</td></tr>
<tr><td><code>RANGE</code></td><td>value distance on the single ORDER BY column</td><td><code>RANGE BETWEEN interval '6 days' PRECEDING AND CURRENT ROW</code></td><td>last 7 <em>calendar days</em>, even with missing days or many rows per day</td></tr>
<tr><td><code>GROUPS</code></td><td>peer groups (distinct ORDER BY values)</td><td><code>GROUPS BETWEEN 2 PRECEDING AND CURRENT ROW</code></td><td>current and two previous distinct dates</td></tr></table>
<p><code>EXCLUDE CURRENT ROW | GROUP | TIES | NO OTHERS</code> removes rows from the frame — e.g. "average of the other employees in my department" with <code>EXCLUDE CURRENT ROW</code>.</p>
<p><strong>The LAST_VALUE trap</strong> revisited: with ORDER BY and the default frame, the frame ends at the current row's peers, so <code>last_value()</code> is "the current row". Always write <code>ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING</code> when you mean "last of the partition".</p>`,
  why: `<p>Running balances, cumulative revenue, year-to-date totals, 7-day/30-day moving averages, Bollinger bands, "rolling 24h sum per card" fraud rules — all are frame computations. Doing them with self joins (sum of all rows with date &lt;= this date) is O(n<sup>2</sup>); with frames it is a single ordered pass.</p>`,
  useCase: `<p>A payments risk engine flags cards whose spend in any rolling 24 hours exceeds a limit: <code>sum(amount) OVER (PARTITION BY card_id ORDER BY paid_at RANGE BETWEEN interval '24 hours' PRECEDING AND CURRENT ROW)</code>. RANGE with an interval counts time, not rows, so bursts of 50 transactions in an hour are handled correctly. A BI dashboard shows daily revenue with a 7-day moving average to smooth weekday seasonality.</p>`,
  internals: `<p>WindowAgg maintains frame start/end pointers as it moves through the sorted partition. For aggregates with an <em>inverse transition function</em> (sum, count, avg on most types), PostgreSQL implements a moving frame incrementally: add the row entering the frame, "subtract" the row leaving — O(n) overall. For aggregates without one (e.g. <code>max</code>, <code>min</code>, <code>string_agg</code>) the frame aggregate is recomputed from scratch whenever the frame start moves, which is O(n x frame size). RANGE with an offset requires exactly one ORDER BY column of a type with suitable in_range support (numeric, date, timestamp + interval). PG16 optimised the default RANGE frame to ROWS automatically when the ORDER BY is unique, avoiding peer-group checks.</p>`,
  whenNot: `<p>Do not use <code>ROWS BETWEEN 6 PRECEDING</code> for "last 7 days" when days can be missing or have multiple rows — use RANGE with an interval or aggregate per day over a generated calendar first. For huge frames with non-invertible aggregates (rolling max over 10,000 rows) consider pre-aggregation. Running totals that must be stored and updated incrementally (account balances) belong in the write path (ledger with balance column), not recomputed on every read.</p>`,
  syntax: `agg(expr) OVER (
  [PARTITION BY ...] ORDER BY ...
  { ROWS | RANGE | GROUPS } BETWEEN frame_start AND frame_end
  [ EXCLUDE { CURRENT ROW | GROUP | TIES | NO OTHERS } ]
)
frame_start / frame_end:
  UNBOUNDED PRECEDING | n PRECEDING | CURRENT ROW | n FOLLOWING | UNBOUNDED FOLLOWING
  (RANGE offsets may be intervals: interval '7 days' PRECEDING)`,
  examples: [
    { label: 'Basic', title: 'Running total of daily revenue in September 2025',
      sql: `SELECT day, revenue,
       sum(revenue) OVER (ORDER BY day) AS running_total,
       round(100 * sum(revenue) OVER (ORDER BY day) / sum(revenue) OVER (), 1) AS pct_of_month
FROM (SELECT order_date::date AS day, sum(total_amount) AS revenue
      FROM orders
      WHERE status <> 'cancelled'
        AND order_date >= '2025-09-01' AND order_date < '2025-10-01'
      GROUP BY 1) d
ORDER BY day
LIMIT 7;`,
      explain: `<p><code>sum(revenue) OVER (ORDER BY day)</code> uses the default frame (start of partition up to the current row), i.e. a running total. <code>sum(revenue) OVER ()</code> has no ORDER BY, so its frame is everything: the month total. Their ratio is the cumulative share of the month — a burn-up chart in one query.</p>`,
      output: ` day        | revenue    | running_total | pct_of_month
------------+------------+---------------+--------------
 2025-09-01 |  839841.28 |     839841.28 |          1.5
 2025-09-02 | 1276829.85 |    2116671.13 |          3.8
 2025-09-03 |  698300.74 |    2814971.87 |          5.1
 2025-09-04 | 1772243.24 |    4587215.11 |          8.3
 2025-09-05 | 1416211.63 |    6003426.74 |         10.9
 2025-09-06 | 1457301.72 |    7460728.46 |         13.5
 2025-09-07 |  887351.99 |    8348080.45 |         15.1
(7 rows)`, run: true },
    { label: 'Intermediate', title: '7-row vs 7-day moving average (ROWS vs RANGE)',
      sql: `WITH daily AS (
    SELECT o.order_date::date AS day, sum(o.total_amount) AS revenue
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE c.country = 'UAE' AND o.status <> 'cancelled'
      AND o.order_date >= '2025-09-01' AND o.order_date < '2025-10-01'
    GROUP BY 1
)
SELECT day, revenue,
       round(avg(revenue) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)) AS ma_7_rows,
       count(*) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rows_in_frame,
       round(avg(revenue) OVER (ORDER BY day RANGE BETWEEN interval '6 days' PRECEDING AND CURRENT ROW)) AS ma_7_days,
       count(*) OVER (ORDER BY day RANGE BETWEEN interval '6 days' PRECEDING AND CURRENT ROW) AS days_in_frame
FROM daily
ORDER BY day
LIMIT 10;`,
      explain: `<p>UAE customers did not order every day (the gaps lesson found 10 empty days in September). <code>ROWS 6 PRECEDING</code> always takes the last 7 <em>rows</em>, which can span 10+ calendar days. <code>RANGE interval '6 days' PRECEDING</code> takes rows whose day is within the last 7 calendar days, so the frame shrinks over gaps. Compare <code>rows_in_frame</code> and <code>days_in_frame</code>: they diverge exactly where days are missing. For a "7-day average" in business terms, RANGE is correct (or fill the calendar with zeros first if empty days should count as 0).</p>`,
      output: ` day        | revenue    | ma_7_rows | rows_in_frame | ma_7_days | days_in_frame
------------+------------+-----------+---------------+-----------+---------------
 2025-09-03 |  328132.61 |    328133 |             1 |    328133 |             1
 2025-09-06 |  298505.87 |    313319 |             2 |    313319 |             2
 2025-09-07 |  220676.79 |    282438 |             3 |    282438 |             3
 2025-09-08 | 1149563.31 |    499220 |             4 |    499220 |             4
 2025-09-09 |  492029.46 |    497782 |             5 |    497782 |             5
 2025-09-10 |  374991.19 |    477317 |             6 |    507153 |             5
 2025-09-11 |  869211.39 |    533302 |             7 |    567496 |             6
 2025-09-12 |  447454.37 |    550347 |             7 |    550347 |             7
 2025-09-13 |  383425.93 |    562479 |             7 |    562479 |             7
 2025-09-17 |  767227.88 |    640558 |             7 |    616830 |             4
(10 rows)`, run: true },
    { label: 'Advanced', title: 'Peers: ROWS vs RANGE vs GROUPS with ties, and EXCLUDE',
      sql: `SELECT v,
       sum(v) OVER (ORDER BY v ROWS   BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rows_sum,
       sum(v) OVER (ORDER BY v RANGE  BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS range_sum,
       sum(v) OVER (ORDER BY v GROUPS BETWEEN 1 PRECEDING AND CURRENT ROW)         AS groups_1_prev,
       sum(v) OVER (ORDER BY v ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                    EXCLUDE CURRENT ROW) AS others_sum
FROM (VALUES (10), (20), (20), (30)) AS t(v)
ORDER BY v;

-- Each employee vs the average of their colleagues (excluding themselves)
SELECT first_name, salary,
       round(avg(salary) OVER (PARTITION BY department_id ORDER BY salary
             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING EXCLUDE CURRENT ROW)) AS colleagues_avg
FROM employees
WHERE department_id = 4
ORDER BY salary DESC
LIMIT 4;`,
      explain: `<p>With ties (two 20s): ROWS adds one physical row at a time (10, 30, 50, 80). RANGE treats peers as a unit: both 20 rows see 10+20+20 = 50. GROUPS 1 PRECEDING takes the current peer group and the previous one: for the 20s that is {10, 20, 20} = 50; for 30 it is {20, 20, 30} = 70. <code>EXCLUDE CURRENT ROW</code> removes only the current physical row from the full frame. The second query uses EXCLUDE to compare each person with the average of everyone else in the department.</p>`,
      output: ` v  | rows_sum | range_sum | groups_1_prev | others_sum
----+----------+-----------+---------------+------------
 10 |       10 |        10 |            10 |         70
 20 |       30 |        50 |            50 |         60
 20 |       50 |        50 |            50 |         60
 30 |       80 |        80 |            70 |         50
(4 rows)

 first_name | salary    | colleagues_avg
------------+-----------+----------------
 Vikram     | 210000.00 |          96754
 Pooja      | 149600.00 |          99271
 Zara       | 149300.00 |          99283
 Anika      | 144600.00 |          99479
(4 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Running total via correlated subquery: O(n^2)
SELECT d.day, d.revenue,
       (SELECT sum(d2.revenue) FROM (SELECT order_date::date AS day, sum(total_amount) AS revenue
                                     FROM orders GROUP BY 1) d2
        WHERE d2.day <= d.day) AS running_total
FROM (SELECT order_date::date AS day, sum(total_amount) AS revenue FROM orders GROUP BY 1) d
ORDER BY d.day DESC
LIMIT 3;`, why: 'Re-aggregates the whole orders table for each of the ~640 days: hundreds of full scans for something a single ordered pass can do.', run: true },
    good: { sql: `SELECT day, revenue, sum(revenue) OVER (ORDER BY day) AS running_total
FROM (SELECT order_date::date AS day, sum(total_amount) AS revenue FROM orders GROUP BY 1) d
ORDER BY day DESC
LIMIT 3;`, why: 'One aggregation, one sort, one incremental pass with the inverse-transition optimisation.', run: true }
  },
  mistakes: [
    `Using ROWS n PRECEDING for "last n days" when days are missing or duplicated.`,
    `Running total over a non-unique ORDER BY with the default RANGE frame — tied rows all show the same total and the total "jumps".`,
    `<code>last_value()</code> with the default frame (returns the current row).`,
    `Using RANGE with an interval offset and two ORDER BY columns — RANGE offsets require exactly one ordering column.`,
    `Rolling <code>max()</code> over big frames — no inverse transition, so it is recomputed for every row.`
  ],
  best: [
    `Write frames explicitly in production queries; do not rely on defaults readers may not know.`,
    `Use <code>ROWS</code> with a unique ORDER BY (add <code>id</code>) for deterministic running totals.`,
    `Use RANGE with interval offsets for time-based windows.`,
    `Fill calendars with generate_series when empty periods should count as zero.`,
    `Reuse one named WINDOW for several aggregates to share the sort.`
  ],
  performance: `<p>Sliding frames with invertible aggregates (sum, count, avg) cost O(n) after sorting; non-invertible ones (min, max) cost O(n x frame). Sorting dominates for large inputs: give reporting sessions enough <code>work_mem</code> and pre-aggregate to the reporting grain (daily) before windowing — windowing 640 daily rows is trivial, windowing 12,500 item rows is 20x more work.</p>`,
  security: ``,
  scenario: { title: 'Card fraud rule: more than 100,000 spent in any rolling 24 hours', steps: [
    '1. Compute sum(amount) OVER (PARTITION BY card_id ORDER BY paid_at RANGE BETWEEN interval \'24 hours\' PRECEDING AND CURRENT ROW).',
    '2. Filter rows where the rolling sum exceeds 100,000 (in an outer query).',
    '3. Restrict input to the last 48 hours (WHERE paid_at > now() - interval \'48 hours\') with an index on (card_id, paid_at) or (paid_at).',
    '4. Run every few minutes and insert new alerts with ON CONFLICT DO NOTHING to avoid duplicates.'
  ] },
  widgets: [],
  interview: [
    { q: 'What is the default window frame?', a: 'Without ORDER BY: the whole partition. With ORDER BY: RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW, which includes all peers of the current row — so sum() becomes a running total that treats ties as one step.' },
    { q: 'Difference between ROWS, RANGE and GROUPS?', a: 'ROWS counts physical rows; RANGE uses value distance on the ORDER BY column (and includes all peers), supporting offsets like interval \'7 days\'; GROUPS counts peer groups of equal ORDER BY values.' },
    { q: 'How do you compute a 7-day moving average when some days have no data?', a: 'Either use RANGE BETWEEN interval \'6 days\' PRECEDING AND CURRENT ROW over daily rows, or generate a full calendar with generate_series, LEFT JOIN data (coalesce to 0 if missing days mean zero) and then use ROWS BETWEEN 6 PRECEDING AND CURRENT ROW.' },
    { q: 'Why can a rolling max be slower than a rolling sum?', a: 'sum has an inverse transition function, so PostgreSQL can remove the row leaving the frame incrementally. max cannot be "un-added", so the aggregate is recomputed over the frame for every row.' }
  ],
  exercises: [
    { task: 'Compute cumulative 2025 revenue per payment method (successful payments, by month) with a running total per method.', solution: `SELECT method, to_char(m, 'YYYY-MM') AS month, amount,
       sum(amount) OVER (PARTITION BY method ORDER BY m ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ytd
FROM (SELECT method, date_trunc('month', paid_at) AS m, sum(amount) AS amount
      FROM payments WHERE status = 'success' AND paid_at >= '2025-01-01'
      GROUP BY 1, 2) x
ORDER BY method, m
LIMIT 12;`, run: true },
    { task: 'For each order of customer 42, show the sum of the current and the two previous order amounts (3-order rolling sum).', solution: `SELECT id, order_date::date, total_amount,
       sum(total_amount) OVER (ORDER BY order_date, id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS rolling_3
FROM orders
WHERE customer_id = 42
ORDER BY order_date;`, run: true }
  ],
  challenge: { task: 'Produce a complete daily series for 2025-09 (all 30 days, zero-filled) of delivered revenue with a 7-day moving average and a month-to-date running total.', hint: 'generate_series calendar LEFT JOIN daily aggregates; coalesce to 0; then ROWS 6 PRECEDING and UNBOUNDED PRECEDING frames.', solution: `WITH cal AS (
  SELECT d::date AS day FROM generate_series('2025-09-01'::date, '2025-09-30'::date, interval '1 day') d
), daily AS (
  SELECT order_date::date AS day, sum(total_amount) AS revenue
  FROM orders WHERE status = 'delivered' AND order_date >= '2025-09-01' AND order_date < '2025-10-01'
  GROUP BY 1
)
SELECT cal.day, coalesce(daily.revenue, 0) AS revenue,
       round(avg(coalesce(daily.revenue, 0)) OVER (ORDER BY cal.day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS ma7,
       sum(coalesce(daily.revenue, 0)) OVER (ORDER BY cal.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS mtd
FROM cal LEFT JOIN daily ON daily.day = cal.day
ORDER BY cal.day;`, run: true },
  related: ['window-functions-lag-lead', 'window-functions-reporting', 'aggregations-basics', 'ctes-recursive-real-world'],
  quiz: [
    { type: 'predict', q: 'Values 10, 20, 20, 30. sum(v) OVER (ORDER BY v) for the first 20 row?', code: `SELECT v, sum(v) OVER (ORDER BY v) FROM (VALUES (10),(20),(20),(30)) t(v);`, options: ['30', '50', '80', '20'], answer: 1, explain: 'Default RANGE frame includes both peers: 10 + 20 + 20 = 50.' },
    { type: 'mcq', q: 'Which frame gives "the last 7 calendar days" correctly when some days have no rows?', options: ['ROWS BETWEEN 6 PRECEDING AND CURRENT ROW', 'RANGE BETWEEN interval \'6 days\' PRECEDING AND CURRENT ROW', 'GROUPS BETWEEN 6 PRECEDING AND CURRENT ROW', 'No frame'], answer: 1, explain: 'RANGE with an interval measures value distance (time), not rows.' },
    { type: 'tf', q: 'sum(x) OVER (PARTITION BY d) without ORDER BY returns a running total.', answer: false, explain: 'Without ORDER BY the frame is the whole partition: every row gets the partition total.' },
    { type: 'write', q: 'Write the window expression for "average salary of the department excluding the current employee".', solution: `avg(salary) OVER (PARTITION BY department_id ORDER BY id
  ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING EXCLUDE CURRENT ROW)`, explain: 'Full-partition frame minus the current row via EXCLUDE CURRENT ROW (EXCLUDE requires an explicit frame).' }
  ]
},
{
  id: 'window-functions-reporting',
  module: 'window-functions',
  title: 'Monthly Revenue Reporting and Gaps-and-Islands with Window Functions',
  level: 3,
  minutes: 24,
  summary: 'Combine aggregation and window functions into production reports — monthly revenue with growth, share, YTD and rank — and solve gaps-and-islands (streaks, sessions) problems.',
  objectives: [
    'Build a monthly revenue report with MoM growth, YTD totals, share of year and rank',
    'Nest aggregates inside window functions correctly',
    'Explain and apply the gaps-and-islands technique (value minus row_number)',
    'Sessionise events with LAG + running sum of "new session" flags',
    'Fill missing periods with a calendar before windowing'
  ],
  concept: `<p>Real reports chain several steps: filter &rarr; aggregate to the reporting grain &rarr; add window metrics (growth, cumulative, share, rank). Because window functions run <em>after</em> GROUP BY, you can wrap aggregates directly: <code>sum(sum(total_amount)) OVER (PARTITION BY year ORDER BY month)</code> is "year-to-date of the monthly sums". Read it inside-out: the inner <code>sum</code> is the GROUP BY aggregate per month; the outer <code>sum ... OVER</code> is a window over those monthly rows.</p>
<h4>Gaps and islands</h4>
<p>An <em>island</em> is a maximal run of consecutive values (consecutive days with sales, consecutive months a customer was active); a <em>gap</em> is the hole between islands. The classic trick: within an ordered sequence, <strong>value &minus; row_number()</strong> is constant across an island, because both increase by 1 per step. When a gap occurs the value jumps but row_number does not, so the difference changes and a new island begins.</p>
<table><tr><th>day</th><th>row_number</th><th>day &minus; rn (group key)</th></tr>
<tr><td>Sep 3</td><td>1</td><td>Sep 2</td></tr>
<tr><td>Sep 4</td><td>2</td><td>Sep 2</td></tr>
<tr><td>Sep 6</td><td>3</td><td>Sep 3</td></tr>
<tr><td>Sep 7</td><td>4</td><td>Sep 3</td></tr>
<tr><td>Sep 8</td><td>5</td><td>Sep 3</td></tr></table>
<p>Grouping by the key gives two islands: Sep 3-4 and Sep 6-8.</p>
<p><strong>Analogy:</strong> people standing in a queue numbered by their ticket number, also counted 1, 2, 3... by an usher. While nobody is missing, "ticket minus usher count" stays the same. Where someone left the queue, the difference jumps — a new island.</p>
<p><strong>Sessionisation</strong> is the flag-and-sum variant: mark a row as a new session start when the gap to the previous event (via <code>lag</code>) exceeds a threshold, then a running <code>sum(flag)</code> numbers the sessions.</p>`,
  why: `<p>Management reporting (monthly revenue packs), product analytics (sessions, streaks, retention), operations (outage periods, consecutive failed health checks) all reduce to these patterns. Mastering them replaces pages of procedural code with a few dozen lines of SQL that run in the database where the data lives.</p>`,
  useCase: `<p>A SaaS company's board pack shows monthly revenue, MoM growth, YTD and the month's rank within the year; product analytics computes "longest daily-active streak" per user from 2 billion events using the gaps-and-islands trick on distinct active days, and a SRE team derives outage windows from health checks by grouping consecutive failures into islands with start, end and duration.</p>`,
  internals: `<p>A query can have several WindowAgg nodes stacked when different windows are used; each requires its input sorted by its own keys, so the planner orders them to minimise re-sorting. Aggregates nested inside window functions are computed by the Agg node first; the window node then sees one row per group. Gaps-and-islands queries usually need two passes: one window pass to compute the group key, then a GROUP BY on that key — expressed as a CTE or subquery.</p>`,
  whenNot: `<p>For dashboards hit thousands of times a day, precompute monthly aggregates in a summary table or materialised view and apply window functions on the small result. For streak calculations on event streams at very large scale, incremental computation (store current streak per user, update on new activity) avoids re-scanning history.</p>`,
  syntax: `-- window over aggregates
SELECT month, sum(x) AS m_total,
       sum(sum(x)) OVER (PARTITION BY year ORDER BY month) AS ytd,
       rank() OVER (PARTITION BY year ORDER BY sum(x) DESC) AS rank_in_year
FROM ... GROUP BY year, month;

-- gaps and islands
SELECT min(d), max(d) FROM (
  SELECT d, d - row_number() OVER (ORDER BY d)::int AS grp FROM days) s
GROUP BY grp;`,
  examples: [
    { label: 'Basic', title: 'Monthly revenue pack: MoM %, YTD, share of year, rank in year',
      sql: `SELECT extract(year FROM month)::int AS yr,
       to_char(month, 'Mon') AS mon,
       revenue,
       round(100 * (revenue / lag(revenue) OVER (ORDER BY month) - 1), 1) AS mom_pct,
       sum(revenue) OVER (PARTITION BY date_trunc('year', month) ORDER BY month) AS ytd,
       round(100 * revenue / sum(revenue) OVER (PARTITION BY date_trunc('year', month)), 1) AS pct_of_year,
       rank() OVER (PARTITION BY date_trunc('year', month) ORDER BY revenue DESC) AS rank_in_year
FROM (SELECT date_trunc('month', order_date) AS month, sum(total_amount) AS revenue
      FROM orders
      WHERE status IN ('paid', 'shipped', 'delivered')
        AND order_date < '2025-10-01'          -- exclude the incomplete current month
      GROUP BY 1) m
WHERE month >= '2025-01-01'
ORDER BY month;`,
      explain: `<p>The subquery builds the monthly grain. Window functions then add: MoM growth via <code>lag</code>, year-to-date via a running sum partitioned by year, share of the year via an unordered sum over the year partition, and the month's rank within its year. Note the outer <code>WHERE month &gt;= '2025-01-01'</code> runs <em>before</em> the window functions, so January's <code>mom_pct</code> is NULL (December 2024 was filtered out) — if you need it, filter in an outer query after windowing. The data feed contains only one day of October 2025, so the incomplete month is excluded; a partial month would show a fake -97% "drop" — a classic dashboard bug.</p>`,
      output: ` yr   | mon | revenue     | mom_pct | ytd          | pct_of_year | rank_in_year
------+-----+-------------+---------+--------------+-------------+--------------
 2025 | Jan | 48107031.35 |         |  48107031.35 |        11.3 |            4
 2025 | Feb | 40007119.24 |   -16.8 |  88114150.59 |         9.4 |            9
 2025 | Mar | 45506196.07 |    13.7 | 133620346.66 |        10.7 |            7
 2025 | Apr | 45862341.98 |     0.8 | 179482688.64 |        10.8 |            6
 2025 | May | 46025741.31 |     0.4 | 225508429.95 |        10.8 |            5
 2025 | Jun | 56228324.21 |    22.2 | 281736754.16 |        13.2 |            1
 2025 | Jul | 43824172.10 |   -22.1 | 325560926.26 |        10.3 |            8
 2025 | Aug | 49650517.58 |    13.3 | 375211443.84 |        11.6 |            3
 2025 | Sep | 51196343.96 |     3.1 | 426407787.80 |        12.0 |            2
(9 rows)`, run: true },
    { label: 'Intermediate', title: 'Islands: streaks of consecutive days with UAE orders',
      sql: `WITH active_days AS (
    SELECT DISTINCT o.order_date::date AS d
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE c.country = 'UAE'
      AND o.order_date >= '2025-09-01' AND o.order_date < '2025-10-01'
),
grouped AS (
    SELECT d, d - (row_number() OVER (ORDER BY d))::int AS grp
    FROM active_days
)
SELECT min(d) AS streak_start, max(d) AS streak_end, count(*) AS days
FROM grouped
GROUP BY grp
ORDER BY days DESC, streak_start
LIMIT 5;`,
      explain: `<p><code>d - row_number()</code> is constant inside a run of consecutive dates (date minus integer is a date). Grouping by that key turns each run into one row with its start, end and length. This answers "longest streak of daily activity" for a market, a user or a device in one query.</p>`,
      output: ` streak_start | streak_end | days
--------------+------------+------
 2025-09-06   | 2025-09-13 |    8
 2025-09-26   | 2025-09-30 |    5
 2025-09-17   | 2025-09-19 |    3
 2025-09-21   | 2025-09-23 |    3
 2025-09-03   | 2025-09-03 |    1
(5 rows)`, run: true },
    { label: 'Advanced', title: 'Sessionisation: group a customer\'s orders into "buying sessions" (gap > 30 days = new session)',
      sql: `WITH flagged AS (
    SELECT customer_id, id, order_date,
           CASE WHEN order_date - lag(order_date) OVER w > interval '30 days'
                  OR lag(order_date) OVER w IS NULL
                THEN 1 ELSE 0 END AS new_session
    FROM orders
    WHERE customer_id IN (7, 42)
    WINDOW w AS (PARTITION BY customer_id ORDER BY order_date, id)
),
sessions AS (
    SELECT *, sum(new_session) OVER (PARTITION BY customer_id ORDER BY order_date, id) AS session_no
    FROM flagged
)
SELECT customer_id, session_no,
       min(order_date)::date AS first_order, max(order_date)::date AS last_order,
       count(*) AS orders
FROM sessions
GROUP BY customer_id, session_no
ORDER BY customer_id, session_no
LIMIT 10;`,
      explain: `<p>Step 1 flags an order as a session start when it is the customer's first order or more than 30 days after the previous one (<code>lag</code>). Step 2's running <code>sum(new_session)</code> turns flags into session numbers 1, 2, 3... Step 3 aggregates each session. The same pattern sessionises web clickstreams (gap &gt; 30 minutes) and groups log lines into incidents.</p>`,
      output: ` customer_id | session_no | first_order | last_order | orders
-------------+------------+-------------+------------+--------
           7 |          1 | 2024-04-20  | 2024-04-20 |      1
           7 |          2 | 2024-06-21  | 2024-08-24 |      5
           7 |          3 | 2024-11-01  | 2024-11-10 |      2
           7 |          4 | 2024-12-31  | 2025-01-04 |      2
           7 |          5 | 2025-02-13  | 2025-02-13 |      1
          42 |          1 | 2024-03-31  | 2024-03-31 |      1
          42 |          2 | 2024-07-04  | 2024-07-13 |      2
          42 |          3 | 2024-08-19  | 2024-08-19 |      1
          42 |          4 | 2024-10-25  | 2024-10-28 |      2
          42 |          5 | 2025-04-16  | 2025-04-16 |      1
(10 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Filtering before windowing loses context: January's MoM is NULL
SELECT month, revenue,
       revenue - lag(revenue) OVER (ORDER BY month) AS diff
FROM (SELECT date_trunc('month', order_date)::date AS month, sum(total_amount) AS revenue
      FROM orders GROUP BY 1) m
WHERE month >= '2025-01-01'
ORDER BY month LIMIT 3;`, why: 'WHERE runs before window functions, so December 2024 is gone when lag() looks for the previous month.', run: true },
    good: { sql: `SELECT * FROM (
  SELECT month, revenue,
         revenue - lag(revenue) OVER (ORDER BY month) AS diff
  FROM (SELECT date_trunc('month', order_date)::date AS month, sum(total_amount) AS revenue
        FROM orders GROUP BY 1) m
) w
WHERE month >= '2025-01-01'
ORDER BY month LIMIT 3;`, why: 'Compute windows over the full history, then filter the displayed range in an outer query.', run: true }
  },
  mistakes: [
    `Filtering the display range in the same query level as the window function, losing the previous period.`,
    `Running gaps-and-islands on non-distinct values (two rows on the same day) — deduplicate first or use dense_rank.`,
    `Using <code>lag()</code> to compare periods when periods can be missing — fill a calendar first.`,
    `Nesting aggregates incorrectly: <code>sum(revenue) OVER ...</code> on a column that is not in GROUP BY — use <code>sum(sum(x)) OVER</code>.`,
    `Sessionising without a deterministic tiebreaker, so events with the same timestamp land in different sessions on reruns.`
  ],
  best: [
    `Build reports in layers (CTEs): grain &rarr; window metrics &rarr; presentation filter.`,
    `Document metric definitions (which statuses count as revenue) in the SQL or a view.`,
    `For streaks use DISTINCT dates and <code>d - row_number()</code>; for numeric sequences use <code>n - row_number()</code>.`,
    `Precompute monthly aggregates for dashboards; window over the small result.`
  ],
  performance: `<p>Aggregating first is the biggest win — windowing 21 monthly rows is free, windowing 5,000 orders costs a sort. Gaps-and-islands needs one sort for row_number plus a GROUP BY; with an index on the date column and a selective filter it is fast even on large tables. Sessionisation over billions of events should be partitioned by user and processed incrementally.</p>`,
  security: `<p>Reporting queries often run under broad read roles; expose them through views or functions that pre-filter by tenant and grant only those to BI users.</p>`,
  scenario: { title: 'SRE wants outage windows from a health_checks table', steps: [
    '1. Select failed checks per service ordered by checked_at.',
    '2. Flag a new incident when the previous failed check is more than 2 minutes earlier (lag).',
    '3. Running sum of flags = incident number; group by service and incident for start, end, duration and count.',
    '4. Join to the SLA table to compute monthly availability; store results in a summary table nightly.'
  ] },
  widgets: [],
  interview: [
    { q: 'Explain the gaps-and-islands technique.', a: 'Order rows and compute value minus row_number(). Within a run of consecutive values the difference is constant; it changes at every gap. Grouping by that difference yields one row per island with min/max/count.' },
    { q: 'What does sum(sum(amount)) OVER (ORDER BY month) mean?', a: 'The inner sum is the GROUP BY aggregate per month; the outer sum is a window function over the grouped rows, ordered by month, i.e. a running total of monthly sums.' },
    { q: 'How do you sessionise click events?', a: 'Use lag(ts) per user to detect gaps larger than the session timeout, set a 1/0 new-session flag, then a running sum of the flag per user gives a session number to group by.' }
  ],
  exercises: [
    { task: 'Show 2025 monthly order counts with the month\'s rank by count (1 = busiest) and the running count.', solution: `SELECT to_char(m, 'YYYY-MM') AS month, n,
       rank() OVER (ORDER BY n DESC) AS busiest_rank,
       sum(n) OVER (ORDER BY m) AS running_orders
FROM (SELECT date_trunc('month', order_date) AS m, count(*) AS n
      FROM orders WHERE order_date >= '2025-01-01' GROUP BY 1) x
ORDER BY m;`, run: true },
    { task: 'Find the islands of consecutive employee ids that are inactive (is_active = false) — show start id, end id and length.', solution: `SELECT min(id) AS start_id, max(id) AS end_id, count(*) AS len
FROM (SELECT id, id - row_number() OVER (ORDER BY id) AS grp
      FROM employees WHERE NOT is_active) s
GROUP BY grp
ORDER BY start_id;`, run: true }
  ],
  challenge: { task: 'For each customer segment, build a 2025 monthly report with revenue, MoM %, YTD, and the month where YTD first exceeded 50% of the segment\'s 2025 total (flag it).', hint: 'Aggregate per segment and month; window sums partitioned by segment; flag with ytd >= half AND (ytd - revenue) < half.', solution: `WITH m AS (
  SELECT c.segment, date_trunc('month', o.order_date) AS month, sum(o.total_amount) AS revenue
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.status <> 'cancelled' AND o.order_date >= '2025-01-01' AND o.order_date < '2026-01-01'
  GROUP BY 1, 2
), w AS (
  SELECT segment, month, revenue,
         round(100 * (revenue / lag(revenue) OVER (PARTITION BY segment ORDER BY month) - 1), 1) AS mom_pct,
         sum(revenue) OVER (PARTITION BY segment ORDER BY month) AS ytd,
         sum(revenue) OVER (PARTITION BY segment) AS year_total
  FROM m
)
SELECT segment, to_char(month, 'YYYY-MM') AS month, revenue, mom_pct, ytd,
       (ytd >= year_total / 2 AND ytd - revenue < year_total / 2) AS crossed_half
FROM w
ORDER BY segment, month;`, run: true },
  related: ['window-functions-frames', 'window-functions-lag-lead', 'aggregations-group-by-having', 'ctes-recursive-real-world'],
  quiz: [
    { type: 'predict', q: 'For consecutive days 1,2,3 then 7,8 (as integers), how many islands does n - row_number() produce?', options: ['1', '2', '3', '5'], answer: 1, explain: 'Keys: 0,0,0 then 3,3 — two islands.' },
    { type: 'tf', q: 'A WHERE clause in the same query level is applied before window functions are computed.', answer: true, explain: 'WHERE -> GROUP BY -> HAVING -> window functions -> SELECT -> ORDER BY.' },
    { type: 'mcq', q: 'Which expression computes YTD of monthly sums in a GROUP BY month query?', options: ['sum(x) OVER (ORDER BY month)', 'sum(sum(x)) OVER (PARTITION BY year ORDER BY month)', 'cumsum(x)', 'sum(x) FILTER (WHERE month <= current)'], answer: 1, explain: 'Window over the per-month aggregate, partitioned by year.' },
    { type: 'scenario', q: 'Sessions must break when the gap between events exceeds 30 minutes. First step?', options: ['GROUP BY date_trunc(\'hour\', ts)', 'lag(ts) per user to compute gaps and flag new sessions', 'ntile(30)', 'DISTINCT ON user'], answer: 1, explain: 'Flag gaps with lag, then a running sum numbers the sessions.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: transactions (3 lessons)
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'transactions-acid',
  module: 'transactions',
  title: 'BEGIN, COMMIT, ROLLBACK and ACID Explained with a Bank Transfer',
  level: 2,
  minutes: 25,
  summary: 'Group statements into all-or-nothing units of work and understand exactly how PostgreSQL delivers Atomicity, Consistency, Isolation and Durability.',
  objectives: [
    'Start, commit and roll back transactions explicitly',
    'Explain each ACID property and the PostgreSQL mechanism behind it (MVCC, WAL, constraints, snapshots)',
    'Implement a safe bank transfer that can never lose or create money',
    'Describe the isolation levels PostgreSQL offers and what each prevents',
    'Know that every statement runs in a transaction even without BEGIN (autocommit)'
  ],
  concept: `<p>A <strong>transaction</strong> is a group of statements that the database treats as one indivisible unit: either all of their effects become permanent (<code>COMMIT</code>) or none of them do (<code>ROLLBACK</code>). Without an explicit <code>BEGIN</code>, PostgreSQL wraps each statement in its own transaction (autocommit).</p>
<p><strong>Analogy:</strong> a bank transfer of 5,000 from Asha to Rohan has two steps — debit Asha, credit Rohan. If the power fails between them, money must not vanish (debited but not credited) or be created (credited but not debited). A transaction is the envelope that guarantees the two steps travel together.</p>
<h4>ACID — what each letter means in PostgreSQL</h4>
<ul>
<li><strong>Atomicity</strong> — all or nothing. PostgreSQL writes new row versions immediately but marks them with the transaction ID (xmin). The transaction's fate is recorded in the commit log (<code>pg_xact</code>). On ROLLBACK (or crash) the status becomes "aborted" and those row versions are simply invisible forever — no undo is needed; VACUUM later removes them.</li>
<li><strong>Consistency</strong> — every committed state satisfies all declared rules: NOT NULL, CHECK, UNIQUE, FOREIGN KEY, EXCLUDE constraints and triggers. A transfer that would make a balance negative violates <code>CHECK (balance &gt;= 0)</code>; the statement fails and the transaction can only roll back. Note: the database enforces the rules you <em>declare</em>; business invariants not expressed as constraints are your application's job.</li>
<li><strong>Isolation</strong> — concurrent transactions do not see each other's uncommitted work. PostgreSQL uses <strong>MVCC</strong>: each statement (READ COMMITTED) or transaction (REPEATABLE READ, SERIALIZABLE) reads a <em>snapshot</em>; readers never block writers and writers never block readers. Writers of the same row do block each other (row locks).</li>
<li><strong>Durability</strong> — once COMMIT returns, the change survives crashes. Before acknowledging the commit, PostgreSQL flushes the transaction's <strong>WAL</strong> (write-ahead log) records to disk (<code>fsync</code>). Data pages can be written later; after a crash, WAL replay reconstructs them.</li>
</ul>
<h4>Isolation levels in PostgreSQL</h4>
<table><tr><th>Level</th><th>Snapshot</th><th>Prevents</th><th>Can still happen</th></tr>
<tr><td>READ COMMITTED (default)</td><td>new snapshot per statement</td><td>dirty reads</td><td>non-repeatable reads, phantoms, lost-update patterns in read-modify-write code</td></tr>
<tr><td>REPEATABLE READ</td><td>one snapshot per transaction</td><td>dirty, non-repeatable, phantom reads</td><td>write skew; concurrent update of the same row raises a serialization error (retry)</td></tr>
<tr><td>SERIALIZABLE</td><td>snapshot + SSI conflict tracking</td><td>all anomalies, incl. write skew</td><td>serialization failures (SQLSTATE 40001) that the app must retry</td></tr></table>
<p>READ UNCOMMITTED is accepted syntactically but behaves as READ COMMITTED — PostgreSQL never shows dirty data.</p>`,
  why: `<p>Any business operation that touches more than one row — transfers, placing an order (order + items + stock + payment), moving inventory — must not be half-applied. Transactions give you that guarantee declaratively, so application code does not have to implement compensation logic for every possible failure point. They also define what concurrent users can see, which is essential for correct reads under load.</p>`,
  useCase: `<p>A digital wallet processes 2,000 transfers per second. Each transfer is one short transaction: <code>UPDATE accounts ... WHERE id = :from AND balance &gt;= :amt</code>, <code>UPDATE accounts ... WHERE id = :to</code>, <code>INSERT INTO ledger ...</code>, <code>COMMIT</code>. A <code>CHECK (balance &gt;= 0)</code> constraint is the last line of defence; locking both accounts in a consistent order (lower id first) prevents deadlocks. After a datacenter power failure, WAL replay restored every acknowledged transfer — no reconciliation needed.</p>`,
  internals: `<p>Each transaction gets a virtual transaction ID, and a real 32-bit XID (shown by <code>pg_current_xact_id()</code>) only when it first writes. Every row version stores <code>xmin</code> (creating XID) and <code>xmax</code> (deleting/locking XID). Visibility = "xmin committed and visible to my snapshot, xmax not". COMMIT writes a commit record to WAL, flushes WAL up to that LSN (if <code>synchronous_commit = on</code>), then sets the XID's status in <code>pg_xact</code>. ROLLBACK just marks the XID aborted. This is why PostgreSQL rollbacks are instantaneous regardless of size, but aborted transactions leave dead tuples for VACUUM. See the MVCC and WAL diagrams.</p>`,
  whenNot: `<p>Do not wrap long-running batch jobs (millions of rows, minutes to hours) in a single transaction: it holds locks, bloats tables (VACUUM cannot clean rows the transaction might still need) and a failure at 99% rolls back everything. Process in batches of a few thousand rows with a commit each. Do not keep a transaction open while waiting for user input or external HTTP calls.</p>`,
  syntax: `BEGIN [ ISOLATION LEVEL { READ COMMITTED | REPEATABLE READ | SERIALIZABLE } ] [ READ ONLY ];
  -- statements
COMMIT;      -- or END
ROLLBACK;    -- or ABORT

START TRANSACTION ISOLATION LEVEL SERIALIZABLE;   -- SQL-standard spelling
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;  -- first statement inside the block`,
  examples: [
    { label: 'Basic', title: 'A committed and a rolled-back change',
      sql: `BEGIN;
UPDATE departments SET budget = budget + 100000 WHERE name = 'Research';
COMMIT;

BEGIN;
UPDATE departments SET budget = 0 WHERE name = 'Research';
SELECT name, budget FROM departments WHERE name = 'Research';   -- inside: sees 0
ROLLBACK;

SELECT name, budget FROM departments WHERE name = 'Research';   -- after: 2600000`,
      explain: `<p>The first block commits: Research's budget becomes 2,600,000 permanently. The second block sets it to 0 and the transaction can see its own change, but ROLLBACK discards it: the row version created by the UPDATE belongs to an aborted transaction and is never visible to anyone again. The final SELECT shows the committed value.</p>`,
      output: `BEGIN
UPDATE 1
COMMIT
BEGIN
UPDATE 1

 name     | budget
----------+--------
 Research |   0.00
(1 row)

ROLLBACK

 name     | budget
----------+------------
 Research | 2600000.00
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Atomic bank transfer with a consistency guard',
      sql: `CREATE TABLE accounts (
  id      int PRIMARY KEY,
  owner   text NOT NULL,
  balance numeric(12,2) NOT NULL CHECK (balance >= 0)
);
INSERT INTO accounts VALUES (1, 'Asha', 10000), (2, 'Rohan', 2000);

-- Transfer 5000 from Asha to Rohan
BEGIN;
UPDATE accounts SET balance = balance - 5000 WHERE id = 1;
UPDATE accounts SET balance = balance + 5000 WHERE id = 2;
COMMIT;

SELECT id, owner, balance, sum(balance) OVER () AS total_money FROM accounts ORDER BY id;`,
      explain: `<p>Both updates commit together. The total amount of money in the system (12,000) is invariant — a quick sanity query any ledger system should have. If the server crashed after the first UPDATE but before COMMIT, recovery would treat the transaction as aborted, and Asha would still have 10,000. The <code>CHECK (balance &gt;= 0)</code> constraint is the Consistency guard: a transfer of 50,000 would fail on the first UPDATE.</p>`,
      output: `CREATE TABLE
INSERT 0 2
BEGIN
UPDATE 1
UPDATE 1
COMMIT

 id | owner | balance | total_money
----+-------+---------+-------------
  1 | Asha  | 5000.00 |    12000.00
  2 | Rohan | 7000.00 |    12000.00
(2 rows)`, run: true },
    { label: 'Advanced', title: 'All-or-nothing: a failing transfer leaves no trace (atomicity + consistency)',
      sql: `CREATE TABLE accounts (id int PRIMARY KEY, owner text, balance numeric(12,2) NOT NULL CHECK (balance >= 0));
CREATE TABLE transfer_log (id serial PRIMARY KEY, src int, dst int, amount numeric, outcome text);
INSERT INTO accounts VALUES (1, 'Asha', 10000), (2, 'Rohan', 2000);

CREATE FUNCTION transfer(p_src int, p_dst int, p_amt numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts SET balance = balance + p_amt WHERE id = p_dst;   -- credit first (deliberately)
  UPDATE accounts SET balance = balance - p_amt WHERE id = p_src;   -- may violate CHECK
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM transfer(1, 2, 50000);          -- Asha does not have 50000
    INSERT INTO transfer_log (src, dst, amount, outcome) VALUES (1, 2, 50000, 'ok');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO transfer_log (src, dst, amount, outcome) VALUES (1, 2, 50000, 'rejected: ' || SQLERRM);
  END;
  BEGIN
    PERFORM transfer(1, 2, 3000);
    INSERT INTO transfer_log (src, dst, amount, outcome) VALUES (1, 2, 3000, 'ok');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO transfer_log (src, dst, amount, outcome) VALUES (1, 2, 3000, 'rejected: ' || SQLERRM);
  END;
END $$;

SELECT * FROM accounts ORDER BY id;
SELECT amount, outcome FROM transfer_log ORDER BY id;`,
      explain: `<p>The function credits Rohan <em>before</em> debiting Asha — the worst possible order. For the 50,000 transfer the debit violates the CHECK constraint, the error propagates, and the inner <code>BEGIN ... EXCEPTION</code> block (an implicit savepoint) rolls back <strong>both</strong> updates, including the already-applied credit. The 3,000 transfer succeeds. Balances show Rohan received only the 3,000 — atomicity at the level of the failed unit, consistency enforced by the constraint.</p>`,
      output: `CREATE TABLE
CREATE TABLE
INSERT 0 2
CREATE FUNCTION
DO

 id | owner | balance
----+-------+---------
  1 | Asha  | 7000.00
  2 | Rohan | 5000.00
(2 rows)

 amount | outcome
--------+----------------------------------------------------------------------------------------------
  50000 | rejected: new row for relation "accounts" violates check constraint "accounts_balance_check"
   3000 | ok
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Autocommit: each UPDATE commits on its own
CREATE TEMP TABLE acct (id int PRIMARY KEY, balance numeric NOT NULL);
INSERT INTO acct VALUES (1, 10000), (2, 2000);
UPDATE acct SET balance = balance - 5000 WHERE id = 1;
-- (application crashes here: 5000 has vanished)
SELECT sum(balance) AS total_money FROM acct;`, why: 'Without BEGIN, the debit is committed immediately. A crash or error before the credit leaves the system short of money, with no automatic recovery.', run: true },
    good: { sql: `CREATE TEMP TABLE acct (id int PRIMARY KEY, balance numeric NOT NULL CHECK (balance >= 0));
INSERT INTO acct VALUES (1, 10000), (2, 2000);
BEGIN;
UPDATE acct SET balance = balance - 5000 WHERE id = 1;
UPDATE acct SET balance = balance + 5000 WHERE id = 2;
COMMIT;
SELECT sum(balance) AS total_money FROM acct;`, why: 'Both steps commit together or not at all; the total is preserved even if the client dies between statements (the open transaction is rolled back when the connection drops).', run: true }
  },
  mistakes: [
    `Relying on autocommit for multi-statement business operations.`,
    `Read-modify-write in application code under READ COMMITTED (<code>SELECT balance</code>, compute, <code>UPDATE SET balance = :new</code>) — two concurrent sessions lose an update. Use <code>UPDATE ... SET balance = balance - :amt</code>, <code>SELECT ... FOR UPDATE</code>, or a stricter isolation level.`,
    `Assuming SERIALIZABLE "just works" — the application must catch SQLSTATE 40001 and retry the whole transaction.`,
    `Believing READ UNCOMMITTED shows dirty data in PostgreSQL — it does not.`,
    `Turning off <code>fsync</code> for speed — risks unrecoverable corruption. <code>synchronous_commit = off</code> is the safe way to trade a small window of durability for latency.`
  ],
  best: [
    `Wrap every multi-statement business operation in an explicit transaction.`,
    `Express invariants as constraints (CHECK, FK, UNIQUE, EXCLUDE) so Consistency is enforced by the database.`,
    `Use relative updates (<code>balance = balance - x</code>) and conditional updates (<code>WHERE balance &gt;= x</code>) to avoid lost updates.`,
    `Lock rows in a consistent order (e.g. by id) when a transaction updates several of them, to avoid deadlocks.`,
    `Implement retry loops for serialization failures (40001) and deadlocks (40P01).`
  ],
  performance: `<p>COMMIT costs one WAL flush (fsync) when <code>synchronous_commit = on</code>; batching many small writes into one transaction amortises it (1,000 inserts in one transaction can be 100x faster than 1,000 autocommitted inserts). ROLLBACK is O(1). Long transactions hold back the "xmin horizon" so VACUUM cannot remove dead tuples anywhere in the database, causing bloat. SERIALIZABLE adds predicate-lock tracking overhead and retries; REPEATABLE READ is cheap.</p>`,
  security: `<p>Transactions are also a security boundary for multi-step checks: verify permission and perform the action in the same transaction (with appropriate locking) to avoid time-of-check/time-of-use races. <code>SET LOCAL role/search_path</code> inside a transaction scopes privilege changes to it.</p>`,
  scenario: { title: 'Customers report money "disappearing" during peak hours', steps: [
    '1. Ledger totals do not match: sum(balance) dropped while no withdrawals happened.',
    '2. Code review finds SELECT balance ... compute in app ... UPDATE SET balance = :value without a transaction lock (lost update).',
    '3. Fix: single statement UPDATE accounts SET balance = balance - :amt WHERE id = :id AND balance >= :amt, check affected rows.',
    '4. Wrap debit + credit + ledger insert in one transaction; lock accounts in id order.',
    '5. Add a nightly invariant check: sum of ledger entries per account = balance.'
  ] },
  widgets: ['lab:txn', 'diagram:mvcc', 'diagram:wal'],
  interview: [
    { q: 'How does PostgreSQL implement atomicity without an undo log?', a: 'Every row version is stamped with the creating transaction\'s XID. Commit status lives in pg_xact. On rollback the XID is simply marked aborted, so all its row versions become permanently invisible; VACUUM later reclaims them. That makes rollback instant.' },
    { q: 'What guarantees durability?', a: 'Write-ahead logging: before COMMIT returns, the WAL records for the transaction are flushed to durable storage (with synchronous_commit = on). After a crash, PostgreSQL replays WAL from the last checkpoint to restore committed changes.' },
    { q: 'What isolation level does PostgreSQL use by default and what anomalies can occur?', a: 'READ COMMITTED: each statement sees a fresh snapshot of committed data. Non-repeatable reads, phantoms and lost updates in read-modify-write application logic are possible. REPEATABLE READ uses one snapshot per transaction; SERIALIZABLE adds SSI to prevent write skew.' },
    { q: 'What must an application do when using SERIALIZABLE?', a: 'Be prepared for serialization failures (SQLSTATE 40001) at any statement or at COMMIT and retry the entire transaction from the beginning, re-reading data.' }
  ],
  exercises: [
    { task: 'In one transaction, move project "Project Lumen" to department Research and increase Research\'s budget by the project budget; then show both rows.', solution: `BEGIN;
UPDATE projects SET department_id = (SELECT id FROM departments WHERE name = 'Research')
WHERE name = 'Project Lumen';
UPDATE departments SET budget = budget + (SELECT budget FROM projects WHERE name = 'Project Lumen')
WHERE name = 'Research';
COMMIT;
SELECT p.name, d.name AS department, d.budget
FROM projects p JOIN departments d ON d.id = p.department_id
WHERE p.name = 'Project Lumen';`, run: true },
    { task: 'Start a REPEATABLE READ, READ ONLY transaction, read the order count twice and commit.', solution: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT count(*) FROM orders;
SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro;
COMMIT;`, run: true }
  ],
  challenge: { task: 'Write a transfer that can never overdraw even under concurrency without CHECK constraints: use a conditional UPDATE and verify the affected row count, raising an exception if zero.', hint: 'In PL/pgSQL use GET DIAGNOSTICS n = ROW_COUNT or IF NOT FOUND THEN RAISE.', solution: `CREATE TEMP TABLE acct (id int PRIMARY KEY, balance numeric NOT NULL);
INSERT INTO acct VALUES (1, 1000), (2, 0);
CREATE FUNCTION safe_transfer(src int, dst int, amt numeric) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  UPDATE acct SET balance = balance - amt WHERE id = src AND balance >= amt;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient funds in account %', src;
  END IF;
  UPDATE acct SET balance = balance + amt WHERE id = dst;
  RETURN 'ok';
END $$;
SELECT safe_transfer(1, 2, 400);
SELECT * FROM acct ORDER BY id;`, run: true },
  related: ['transactions-savepoints', 'transactions-best-practices', 'constraints', 'mvcc'],
  quiz: [
    { type: 'mcq', q: 'Which mechanism guarantees Durability in PostgreSQL?', options: ['MVCC', 'Write-ahead log flushed at commit', 'CHECK constraints', 'Autovacuum'], answer: 1, explain: 'WAL is flushed before COMMIT is acknowledged.' },
    { type: 'tf', q: 'In PostgreSQL, READ UNCOMMITTED allows dirty reads.', answer: false, explain: 'It is treated as READ COMMITTED.' },
    { type: 'predict', q: 'What does the final SELECT return?', code: `BEGIN;
UPDATE departments SET budget = 0 WHERE id = 1;
ROLLBACK;
SELECT budget FROM departments WHERE id = 1;`, options: ['0', '5200000.00', 'NULL', 'Error'], answer: 1, explain: 'The rolled-back change is invisible.' },
    { type: 'scenario', q: 'Two sessions run SELECT balance; then UPDATE SET balance = selected - 100 concurrently under READ COMMITTED. Result?', options: ['Both debits apply', 'One debit is lost (lost update)', 'Deadlock always', 'Serialization error'], answer: 1, explain: 'Both read the same old balance; the second write overwrites the first. Use balance = balance - 100 or SELECT FOR UPDATE.' },
    { type: 'mcq', q: 'Why is ROLLBACK instantaneous even after updating 10 million rows?', options: ['It runs in parallel', 'PostgreSQL only marks the XID aborted in pg_xact; row versions become invisible', 'It truncates the table', 'It replays WAL backwards'], answer: 1, explain: 'No undo is applied; VACUUM cleans up later.' }
  ]
},
{
  id: 'transactions-savepoints',
  module: 'transactions',
  title: 'SAVEPOINT, ROLLBACK TO SAVEPOINT, RELEASE and Error Handling',
  level: 2,
  minutes: 18,
  summary: 'Partially undo work inside a transaction with savepoints, understand the "current transaction is aborted" state, and handle errors without losing the whole unit of work.',
  objectives: [
    'Create, roll back to and release savepoints',
    'Explain the aborted-transaction state and why every later statement fails',
    'Recover from an error inside a transaction using ROLLBACK TO SAVEPOINT',
    'Relate PL/pgSQL EXCEPTION blocks to subtransactions',
    'Know the performance cost of many subtransactions (subxact overflow)'
  ],
  concept: `<p>A <strong>savepoint</strong> is a named bookmark inside a transaction. <code>ROLLBACK TO SAVEPOINT name</code> undoes everything done after the bookmark while keeping the work before it and keeping the transaction open. <code>RELEASE SAVEPOINT name</code> forgets the bookmark (keeping the changes). Savepoints nest.</p>
<p><strong>Analogy:</strong> a video game with checkpoints. Dying (an error) sends you back to the last checkpoint, not the beginning of the game — but only if you saved one. Finishing the level (COMMIT) makes everything permanent.</p>
<h4>The aborted transaction state</h4>
<p>In PostgreSQL, when any statement inside a transaction block fails, the whole transaction enters the <strong>aborted</strong> state. Every following statement is rejected with:</p>
<p><code>ERROR: current transaction is aborted, commands ignored until end of transaction block</code></p>
<p>until you issue <code>ROLLBACK</code> (everything is lost) or <code>ROLLBACK TO SAVEPOINT</code> (only the part after the savepoint is lost). Even <code>COMMIT</code> on an aborted transaction performs a rollback (it reports <code>ROLLBACK</code>). This differs from some other databases that roll back just the failing statement. Client tools emulate statement-level rollback with automatic savepoints: psql's <code>\set ON_ERROR_ROLLBACK on</code>, JDBC's <code>autosave=always</code>.</p>
<p>Internally, each savepoint starts a <strong>subtransaction</strong> with its own subtransaction ID. PL/pgSQL <code>BEGIN ... EXCEPTION ... END</code> blocks also create a subtransaction on entry, which is how they can roll back just the block's work when an error is caught.</p>`,
  why: `<p>Long units of work often contain optional or retryable steps: importing 500 rows where a few may violate a constraint, attempting an insert and falling back to an update, calling a function that might fail. Savepoints let you isolate those risky steps so one failure does not throw away the entire transaction.</p>`,
  useCase: `<p>A nightly import loads supplier price files into <code>products</code> in a single transaction so the catalogue switches atomically. Each row is applied under a savepoint; rows that violate a CHECK constraint (negative price) are rolled back to their savepoint and written to an error table instead, and the import commits the 99.8% valid rows. (At large scale, prefer validating in a staging table with set-based SQL — see performance notes.)</p>`,
  internals: `<p>Savepoints are subtransactions with their own XIDs (assigned when they first write). Rows they create carry the subtransaction's XID; <code>pg_subtrans</code> maps each subtransaction to its parent so visibility checks can resolve the top-level status. Each backend caches up to 64 subtransaction XIDs in shared memory (<code>PGPROC</code>); beyond that the cache "overflows" and other sessions must consult <code>pg_subtrans</code> on disk-backed SLRU pages for visibility checks — a well-known cause of severe slowdowns on busy replicas and primaries when applications create thousands of savepoints per transaction. PG16+ exposes SLRU statistics in <code>pg_stat_slru</code>, and PG17 made the SLRU cache sizes configurable.</p>`,
  whenNot: `<p>Do not wrap every statement in a savepoint "just in case" (ORM autosave modes do this): it costs a subtransaction per statement and can trigger subxact overflow. Do not use savepoints for control flow that a single statement can express: <code>INSERT ... ON CONFLICT DO UPDATE</code> instead of try-insert/rollback/update; set-based validation in a staging table instead of per-row exception handling.</p>`,
  syntax: `SAVEPOINT name;
ROLLBACK TO [ SAVEPOINT ] name;   -- undo work after the savepoint, keep it defined
RELEASE [ SAVEPOINT ] name;       -- forget the savepoint, keep the work

-- PL/pgSQL equivalent (implicit savepoint)
BEGIN
  ...;
EXCEPTION WHEN unique_violation THEN
  ...;
END;`,
  examples: [
    { label: 'Basic', title: 'Undo part of a transaction with ROLLBACK TO SAVEPOINT',
      sql: `BEGIN;
UPDATE departments SET budget = budget + 50000 WHERE name = 'HR';
SAVEPOINT before_marketing;
UPDATE departments SET budget = budget - 999999 WHERE name = 'Marketing';
ROLLBACK TO SAVEPOINT before_marketing;    -- the Marketing change is undone
UPDATE departments SET budget = budget - 50000 WHERE name = 'Marketing';
RELEASE SAVEPOINT before_marketing;
COMMIT;

SELECT name, budget FROM departments WHERE name IN ('HR', 'Marketing') ORDER BY name;`,
      explain: `<p>The HR update before the savepoint survives. The large Marketing cut after the savepoint is undone by <code>ROLLBACK TO SAVEPOINT</code>; the transaction stays open and continues with a smaller cut. <code>RELEASE</code> drops the bookmark. After COMMIT, HR is +50,000 and Marketing -50,000.</p>`,
      output: `BEGIN
UPDATE 1
SAVEPOINT
UPDATE 1
ROLLBACK
UPDATE 1
RELEASE
COMMIT

 name      | budget
-----------+------------
 HR        |  650000.00
 Marketing | 1350000.00
(2 rows)`, run: true },
    { label: 'Intermediate', title: 'The aborted transaction state (psql session transcript)',
      sql: `BEGIN;
INSERT INTO departments (name, location, budget) VALUES ('Legal', 'Delhi', 800000);
INSERT INTO departments (name, location, budget) VALUES ('Sales', 'Pune', 100);   -- duplicate name!
SELECT count(*) FROM departments;          -- rejected
COMMIT;                                     -- actually rolls back

SELECT count(*) FROM departments WHERE name = 'Legal';   -- 0: Legal was lost too`,
      explain: `<p>The second INSERT violates <code>UNIQUE (name)</code>. From that moment the transaction is aborted: the SELECT is rejected, and COMMIT replies <code>ROLLBACK</code>. The valid 'Legal' insert is lost as well. This example is shown as a transcript (not runnable in the sandbox, which stops at the first error).</p>`,
      output: `BEGIN
INSERT 0 1
ERROR:  duplicate key value violates unique constraint "departments_name_key"
DETAIL:  Key (name)=(Sales) already exists.
ERROR:  current transaction is aborted, commands ignored until end of transaction block
ROLLBACK

 count
-------
     0
(1 row)`, run: false },
    { label: 'Advanced', title: 'Per-row error isolation: import good rows, log bad ones',
      sql: `CREATE TEMP TABLE price_feed (sku text, new_price numeric);
INSERT INTO price_feed VALUES ('SKU-0001', 5500), ('SKU-0002', -10), ('SKU-0003', 26999), ('SKU-9999', 100);
CREATE TEMP TABLE import_errors (sku text, error text);
ALTER TABLE products ADD CONSTRAINT price_positive CHECK (price > 0);

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM price_feed LOOP
    BEGIN                                     -- implicit SAVEPOINT
      UPDATE products SET price = r.new_price WHERE sku = r.sku;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown sku %', r.sku;
      END IF;
    EXCEPTION WHEN OTHERS THEN                -- implicit ROLLBACK TO SAVEPOINT
      INSERT INTO import_errors VALUES (r.sku, SQLERRM);
    END;
  END LOOP;
END $$;

SELECT sku, price FROM products WHERE sku IN ('SKU-0001', 'SKU-0002', 'SKU-0003') ORDER BY sku;
SELECT * FROM import_errors ORDER BY sku;`,
      explain: `<p>Each loop iteration's <code>BEGIN ... EXCEPTION</code> block is a subtransaction. The negative price violates the new CHECK constraint and the unknown SKU raises a custom exception; in both cases only that iteration is rolled back and the error is logged, while the valid updates (SKU-0001, SKU-0003) persist. This is the PL/pgSQL equivalent of SAVEPOINT / ROLLBACK TO SAVEPOINT per row — fine for hundreds of rows, too expensive for millions.</p>`,
      output: `CREATE TABLE
INSERT 0 4
CREATE TABLE
ALTER TABLE
DO

 sku      | price
----------+----------
 SKU-0001 |  5500.00
 SKU-0002 | 55051.52
 SKU-0003 | 26999.00
(3 rows)

 sku      | error
----------+----------------------------------------------------------------------------
 SKU-0002 | new row for relation "products" violates check constraint "price_positive"
 SKU-9999 | unknown sku SKU-9999
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- One subtransaction per row: 5000 savepoints in one transaction
CREATE TEMP TABLE t (id int PRIMARY KEY);
DO $$
BEGIN
  FOR i IN 1..5000 LOOP
    BEGIN
      INSERT INTO t VALUES (i % 4000);   -- duplicates fail
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;
END $$;
SELECT count(*) FROM t;`, why: 'Thousands of subtransactions overflow the per-backend subxact cache; on a busy server every concurrent visibility check slows down. It is also far slower than one set-based statement.', run: true },
    good: { sql: `CREATE TEMP TABLE t (id int PRIMARY KEY);
INSERT INTO t
SELECT i % 4000 FROM generate_series(1, 5000) AS i
ON CONFLICT (id) DO NOTHING;
SELECT count(*) FROM t;`, why: 'A single statement handles duplicates declaratively with ON CONFLICT: no subtransactions, one pass, same result.', run: true }
  },
  mistakes: [
    `Continuing to send statements after an error inside a transaction — everything fails with "current transaction is aborted".`,
    `Assuming COMMIT after an error saves the successful statements — it rolls back.`,
    `ORM/driver "autosave" or per-statement savepoints on high-throughput paths, causing subtransaction overflow.`,
    `Catching all exceptions (<code>WHEN OTHERS</code>) and silently ignoring them, hiding real bugs.`,
    `Using try-insert/catch/update loops instead of <code>INSERT ... ON CONFLICT</code>.`
  ],
  best: [
    `Use savepoints for genuinely optional or retryable sub-steps, not for every statement.`,
    `Log the error (SQLSTATE, message) when rolling back to a savepoint.`,
    `Prefer set-based validation (staging table + constraints/queries) for bulk imports.`,
    `Keep the number of subtransactions per transaction well below 64 on busy systems.`,
    `In application code, on any error inside a transaction, either ROLLBACK TO a savepoint or ROLLBACK — never ignore it.`
  ],
  performance: `<p>A savepoint costs little by itself, but each one that writes consumes a subtransaction XID; more than 64 in one transaction overflow the PGPROC subxid cache, forcing other backends into <code>pg_subtrans</code> lookups (visible as <code>SubtransSLRU</code> / <code>SubtransBuffer</code> wait events) — a notorious production bottleneck. PL/pgSQL EXCEPTION blocks inside loops create one subtransaction per iteration. Rolling back to a savepoint is cheap (status marking, like a full rollback).</p>`,
  security: `<p>Exception handlers that swallow errors can mask permission failures or constraint violations that should stop a process. Re-raise unexpected errors (<code>RAISE;</code>) and only handle the specific SQLSTATEs you expect.</p>`,
  scenario: { title: 'Replica lag and CPU spike traced to an ORM setting', steps: [
    '1. Wait events show SubtransSLRU on many backends; pg_stat_slru shows high Subtrans reads.',
    '2. Find long transactions issuing a SAVEPOINT before every statement (JDBC autosave=always).',
    '3. Change to autosave=conservative or never, and handle errors explicitly where needed.',
    '4. Replace per-row exception loops in batch jobs with INSERT ... ON CONFLICT.',
    '5. Monitor: SLRU waits disappear and replica lag returns to normal.'
  ] },
  widgets: ['lab:txn'],
  interview: [
    { q: 'What happens in PostgreSQL after a statement fails inside a transaction block?', a: 'The transaction enters the aborted state; all further commands fail with "current transaction is aborted" until ROLLBACK or ROLLBACK TO SAVEPOINT. COMMIT on an aborted transaction performs a rollback.' },
    { q: 'How do PL/pgSQL EXCEPTION blocks relate to savepoints?', a: 'Entering a BEGIN block with an EXCEPTION clause starts a subtransaction (an implicit savepoint). If an error is caught, the block\'s changes are rolled back to that savepoint and the handler runs; otherwise the subtransaction is released when the block ends.' },
    { q: 'What is subtransaction overflow and why does it matter?', a: 'Each backend caches up to 64 subtransaction XIDs in shared memory. Beyond that, visibility checks by all sessions must consult pg_subtrans via SLRU buffers, which can cause severe contention and slowdowns. It is caused by many savepoints or exception blocks within one transaction.' }
  ],
  exercises: [
    { task: 'In one transaction: insert a new department "Legal", set a savepoint, insert a project for it with an invalid status (simulate by instead inserting a valid one), roll back to the savepoint, then commit. Verify Legal exists with 0 projects.', solution: `BEGIN;
INSERT INTO departments (name, location, budget) VALUES ('Legal', 'Delhi', 800000);
SAVEPOINT sp_project;
INSERT INTO projects (name, department_id, start_date, budget, status)
SELECT 'Project Lex', id, current_date, 50000, 'planned' FROM departments WHERE name = 'Legal';
ROLLBACK TO SAVEPOINT sp_project;
COMMIT;
SELECT d.name, count(p.id) AS projects
FROM departments d LEFT JOIN projects p ON p.department_id = d.id
WHERE d.name = 'Legal' GROUP BY d.name;`, run: true },
    { task: 'Write a DO block that tries to insert a department with a duplicate name, catches unique_violation, and records the SQLSTATE into a temp table.', solution: `CREATE TEMP TABLE errs (state text, msg text);
DO $$
BEGIN
  INSERT INTO departments (name, location, budget) VALUES ('Sales', 'Pune', 1);
EXCEPTION WHEN unique_violation THEN
  INSERT INTO errs VALUES (SQLSTATE, SQLERRM);
END $$;
SELECT * FROM errs;`, run: true }
  ],
  challenge: { task: 'Implement "insert or bump": for a list of (sku, qty) restocks, add qty to products.stock; unknown SKUs must be collected in an error table — without per-row exception handling.', hint: 'Use an UPDATE ... FROM a VALUES list, and an INSERT ... SELECT with NOT EXISTS for the unknown SKUs, in one transaction.', solution: `CREATE TEMP TABLE restock_errors (sku text, reason text);
BEGIN;
WITH feed(sku, qty) AS (VALUES ('SKU-0001', 10), ('SKU-0002', 5), ('SKU-9999', 3))
UPDATE products p SET stock = p.stock + f.qty FROM feed f WHERE p.sku = f.sku;
WITH feed(sku, qty) AS (VALUES ('SKU-0001', 10), ('SKU-0002', 5), ('SKU-9999', 3))
INSERT INTO restock_errors
SELECT f.sku, 'unknown sku' FROM feed f WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = f.sku);
COMMIT;
SELECT sku, stock FROM products WHERE sku IN ('SKU-0001', 'SKU-0002') ORDER BY sku;
SELECT * FROM restock_errors;`, run: true },
  related: ['transactions-acid', 'transactions-best-practices', 'constraints-basic', 'functions'],
  quiz: [
    { type: 'predict', q: 'Result of the final SELECT?', code: `BEGIN;
INSERT INTO t VALUES (1);
SAVEPOINT a;
INSERT INTO t VALUES (2);
ROLLBACK TO SAVEPOINT a;
INSERT INTO t VALUES (3);
COMMIT;
SELECT array_agg(x ORDER BY x) FROM t;   -- t(x int), initially empty`, options: ['{1,2,3}', '{1,3}', '{3}', '{}'], answer: 1, explain: 'Only the insert of 2 is undone.' },
    { type: 'tf', q: 'After an error inside a transaction block, COMMIT will commit the statements that succeeded.', answer: false, explain: 'COMMIT of an aborted transaction performs ROLLBACK.' },
    { type: 'mcq', q: 'What does RELEASE SAVEPOINT do?', options: ['Undoes changes after the savepoint', 'Commits the transaction', 'Destroys the savepoint but keeps its changes', 'Releases all row locks'], answer: 2, explain: 'Changes remain part of the outer transaction.' },
    { type: 'optimize', q: 'A batch inserts 1M rows with a PL/pgSQL EXCEPTION block per row to skip duplicates. Better?', options: ['Increase work_mem', 'INSERT ... SELECT ... ON CONFLICT DO NOTHING', 'Use SERIALIZABLE', 'Add more savepoints'], answer: 1, explain: 'Set-based, no subtransactions.' }
  ]
},
{
  id: 'transactions-best-practices',
  module: 'transactions',
  title: 'Transaction Best Practices: Short Transactions, Idle in Transaction, Autocommit and App Patterns',
  level: 3,
  minutes: 22,
  summary: 'Keep transactions short, detect and kill idle-in-transaction sessions, use timeouts, handle retries, and apply proven application patterns.',
  objectives: [
    'Explain why long and idle transactions hurt the whole database (locks, bloat, xmin horizon)',
    'Find idle-in-transaction and long-running transactions with pg_stat_activity',
    'Configure statement_timeout, lock_timeout and idle_in_transaction_session_timeout',
    'Use autocommit consciously in drivers and ORMs',
    'Apply application patterns: unit of work, retry on 40001/40P01, SELECT FOR UPDATE SKIP LOCKED queues, batching'
  ],
  concept: `<p>A transaction holds resources from <code>BEGIN</code> until <code>COMMIT</code>/<code>ROLLBACK</code>: row locks on everything it modified, table locks (even plain SELECT takes an <code>ACCESS SHARE</code> lock that blocks <code>ALTER TABLE</code>), and a snapshot that pins the database-wide <strong>xmin horizon</strong> — VACUUM cannot remove any dead row version that this transaction might still need to see.</p>
<p><strong>Analogy:</strong> a shopper who picks up items, then leaves the cart in the aisle and goes for lunch. The items cannot be sold to anyone else (locks), the store cannot restock shelves behind the cart (vacuum blocked), and the aisle is blocked for maintenance (DDL waits). "Idle in transaction" is that abandoned cart.</p>
<h4>Rules of thumb</h4>
<ul>
<li><strong>Short:</strong> milliseconds to a few seconds. Do all slow work (HTTP calls, file I/O, user think-time, heavy computation) <em>before</em> BEGIN or <em>after</em> COMMIT.</li>
<li><strong>Never idle:</strong> the state <code>idle in transaction</code> in <code>pg_stat_activity</code> means the client opened a transaction and is not sending anything. Protect with <code>idle_in_transaction_session_timeout</code> (terminates such sessions) and <code>transaction_timeout</code> (PG17+, caps total transaction time).</li>
<li><strong>Bounded waits:</strong> <code>lock_timeout</code> (e.g. 5s for app, 2s for migrations) prevents queues of blocked sessions behind one lock; <code>statement_timeout</code> caps runaway queries.</li>
<li><strong>Autocommit awareness:</strong> drivers differ — psql and JDBC default to autocommit on; Python's psycopg (DB-API) opens a transaction implicitly on the first statement and waits for <code>commit()</code>. Forgetting to commit in psycopg is the classic source of idle-in-transaction sessions.</li>
<li><strong>Retries:</strong> under REPEATABLE READ/SERIALIZABLE, and for deadlocks, the app must retry the whole transaction on SQLSTATE <code>40001</code> (serialization_failure) and <code>40P01</code> (deadlock_detected).</li>
<li><strong>Batching:</strong> for bulk changes, process 1,000-10,000 rows per transaction — large enough to amortise commits, small enough to keep locks and WAL bursts bounded.</li>
</ul>`,
  why: `<p>Most PostgreSQL production incidents involving "the database is slow" or "migrations hang" trace back to transaction hygiene: a forgotten open transaction blocking DDL and causing a lock queue, an analytics session holding a snapshot for 6 hours while tables bloat, or an app retrying nothing and surfacing serialization errors to users. These practices prevent whole classes of outages.</p>`,
  useCase: `<p>A food-delivery platform's order service occasionally froze for minutes. Investigation: a code path opened a transaction, locked the restaurant row, then called a payment provider over HTTP (up to 30 s). Other orders for that restaurant queued behind the lock, and a deploy's <code>ALTER TABLE</code> queued behind them, blocking every query on the table. Fix: call the provider outside the transaction, set <code>lock_timeout = '3s'</code> and <code>idle_in_transaction_session_timeout = '30s'</code> for the app role, and run migrations with <code>lock_timeout = '2s'</code> plus retries.</p>`,
  internals: `<p><code>pg_stat_activity</code> shows per backend <code>state</code> (active, idle, idle in transaction, idle in transaction (aborted)), <code>xact_start</code>, <code>query_start</code>, <code>backend_xid</code> and <code>backend_xmin</code>. The oldest <code>backend_xmin</code> (together with replication slots and prepared transactions) defines the horizon VACUUM respects. Lock waits are visible in <code>pg_locks</code> and via <code>pg_blocking_pids(pid)</code>. Lock requests queue FIFO: an <code>ACCESS EXCLUSIVE</code> request (ALTER TABLE) waiting behind a long transaction also blocks every later request, even plain SELECTs — the "lock queue" pile-up.</p>`,
  whenNot: `<p>Some workloads legitimately need longer transactions: a consistent <code>pg_dump</code> uses one REPEATABLE READ snapshot for the whole dump, and reporting queries may run for minutes. Run them on a replica (with awareness of <code>hot_standby_feedback</code> trade-offs) or schedule them, rather than raising global timeouts. Do not set aggressive <code>statement_timeout</code> globally in postgresql.conf — set it per role or per application.</p>`,
  syntax: `-- per session / role / database
SET statement_timeout = '30s';
SET lock_timeout = '5s';
SET idle_in_transaction_session_timeout = '60s';
SET transaction_timeout = '2min';                      -- PG17+
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '30s';

-- inside a transaction only
SET LOCAL statement_timeout = '5s';

-- find problems
SELECT pid, state, now() - xact_start AS xact_age, query
FROM pg_stat_activity WHERE state LIKE 'idle in transaction%';`,
  examples: [
    { label: 'Basic', title: 'Inspect your own transaction and session state',
      sql: `BEGIN;
SELECT pg_current_xact_id_if_assigned() AS xid_before_write;
UPDATE departments SET budget = budget WHERE id = 1;
SELECT pg_current_xact_id_if_assigned() IS NOT NULL AS has_xid_after_write,
       now() = statement_timestamp() AS same_timestamp,
       current_setting('transaction_isolation') AS isolation;
SELECT state, backend_type, xact_start IS NOT NULL AS in_transaction
FROM pg_stat_activity WHERE pid = pg_backend_pid();
COMMIT;`,
      explain: `<p>A transaction gets a real XID only when it first writes (read-only transactions never consume XIDs — important for XID wraparound). <code>now()</code> is frozen at transaction start, while <code>statement_timestamp()</code> advances per statement, so from the second statement of a transaction on they differ — the output shows <code>f</code>. Use <code>clock_timestamp()</code> when you need the real wall-clock time inside long transactions. <code>pg_stat_activity</code> shows our own backend as active with an open transaction. In a server with many sessions you would look for <code>idle in transaction</code> rows with old <code>xact_start</code>.</p>`,
      output: `BEGIN

 xid_before_write
------------------

(1 row)

UPDATE 1

 has_xid_after_write | same_timestamp | isolation
---------------------+----------------+----------------
 t                   | f              | read committed
(1 row)

 state  | backend_type       | in_transaction
--------+--------------------+----------------
 active | standalone backend | t
(1 row)

COMMIT`, run: true },
    { label: 'Intermediate', title: 'Monitoring query: long and idle transactions (DBA toolkit)',
      sql: `SELECT pid,
       usename,
       application_name,
       state,
       now() - xact_start  AS xact_age,
       now() - state_change AS in_state_for,
       backend_xmin,
       pg_blocking_pids(pid) AS blocked_by,
       left(query, 60) AS last_query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND pid <> pg_backend_pid()
ORDER BY xact_start
LIMIT 20;

-- To end an offender:
-- SELECT pg_cancel_backend(pid);     -- cancel current query
-- SELECT pg_terminate_backend(pid);  -- close the session (rolls back its transaction)`,
      explain: `<p>On a real server this lists the oldest open transactions first, with how long they have been idle, which snapshot horizon (<code>backend_xmin</code>) they pin, and which sessions block them. In the single-user sandbox it returns no rows (only our own backend exists). <code>pg_cancel_backend</code> stops the running statement; <code>pg_terminate_backend</code> kills the session, rolling back its transaction and releasing its locks.</p>`,
      output: ` pid | usename | application_name | state | xact_age | in_state_for | backend_xmin | blocked_by | last_query
-----+---------+------------------+-------+----------+--------------+--------------+------------+------------
(0 rows)`, run: true },
    { label: 'Advanced', title: 'Safe settings and a job-queue pattern with SKIP LOCKED',
      sql: `-- Guard rails for this session (normally ALTER ROLE app_user SET ...)
SET idle_in_transaction_session_timeout = '30s';
SET lock_timeout = '3s';
SET statement_timeout = '15s';

CREATE TABLE jobs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                   payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued',
                   locked_at timestamptz);
INSERT INTO jobs (payload)
SELECT jsonb_build_object('order_id', id) FROM orders WHERE status = 'paid' LIMIT 5;

-- Worker: claim up to 2 jobs in a short transaction; concurrent workers skip locked rows
BEGIN;
UPDATE jobs SET status = 'running', locked_at = now()
WHERE id IN (SELECT id FROM jobs WHERE status = 'queued'
             ORDER BY id LIMIT 2
             FOR UPDATE SKIP LOCKED)
RETURNING id, payload;
COMMIT;

SELECT status, count(*) FROM jobs GROUP BY status ORDER BY status;`,
      explain: `<p>The <code>SET</code> commands install guard rails: a client that forgets to commit is disconnected after 30 s; lock waits fail after 3 s instead of queueing forever. The worker pattern claims jobs in a very short transaction: <code>FOR UPDATE SKIP LOCKED</code> lets many workers run the same query concurrently, each taking different rows without blocking each other. The actual (slow) job processing happens <em>after</em> COMMIT, and a second short transaction marks the job done.</p>`,
      output: `SET
SET
SET
CREATE TABLE
INSERT 0 5
BEGIN

 id | payload
----+------------------
  1 | {"order_id": 4}
  2 | {"order_id": 13}
(2 rows)

COMMIT

 status  | count
---------+-------
 queued  |     3
 running |     2
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Pseudo-code of a request handler (do not do this)
BEGIN;
SELECT * FROM orders WHERE id = 42 FOR UPDATE;      -- row lock taken
-- app calls payment gateway over HTTP: 2-30 seconds while holding the lock
-- app renders an email template, uploads a PDF ...
UPDATE orders SET status = 'paid' WHERE id = 42;
COMMIT;`, why: 'The lock (and snapshot) is held across slow external calls; concurrent requests for the order queue up, and a DDL statement queued behind them blocks the entire table.', run: false },
    good: { sql: `-- 1. call payment gateway first (no transaction open)
-- 2. then one short transaction with a guarded, idempotent update:
BEGIN;
SET LOCAL lock_timeout = '3s';
UPDATE orders SET status = 'paid'
WHERE id = 42 AND status = 'pending'          -- idempotent: only first call wins
RETURNING id, status;
INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by, changed_at)
VALUES ('orders', 'UPDATE', 42, '{"status":"pending"}', '{"status":"paid"}', 'payment_service', now());
COMMIT;`, why: 'Slow work happens outside; the transaction lasts milliseconds, has a bounded lock wait and is safe to retry (the WHERE status = pending condition makes it idempotent).', run: true }
  },
  mistakes: [
    `Calling external services (HTTP, email, S3) inside an open transaction.`,
    `Forgetting <code>commit()</code> in drivers that open transactions implicitly (psycopg), leaving sessions idle in transaction for hours.`,
    `Running migrations without <code>lock_timeout</code>: an <code>ALTER TABLE</code> waiting behind a long query blocks every new query on that table.`,
    `Not retrying on 40001 / 40P01, surfacing transient errors to users.`,
    `One giant transaction for a 50M-row backfill — locks, bloat and an all-or-nothing failure at the end.`
  ],
  best: [
    `Keep transactions short; do slow work before BEGIN or after COMMIT.`,
    `Set <code>idle_in_transaction_session_timeout</code>, <code>lock_timeout</code> and <code>statement_timeout</code> per application role.`,
    `Monitor <code>pg_stat_activity</code> for old <code>xact_start</code> and idle-in-transaction sessions; alert on them.`,
    `Make writes idempotent (conditional updates, ON CONFLICT) so retries are safe.`,
    `Batch backfills (e.g. 5,000 rows per transaction) and use <code>FOR UPDATE SKIP LOCKED</code> for job queues.`
  ],
  performance: `<p>Long transactions do not just block their own rows: by holding back the xmin horizon they prevent VACUUM from cleaning dead tuples in <em>every</em> table, which inflates tables and indexes and slows all queries; on replicas with <code>hot_standby_feedback</code> the same happens via the replica's queries. Many tiny autocommit transactions are expensive in a different way (one WAL flush each) — group bulk writes into moderate batches, or use <code>synchronous_commit = off</code> for non-critical data. Connection poolers in transaction mode (PgBouncer <span class="tag tool">third-party tool</span>) require short transactions to be effective.</p>`,
  security: `<p><code>pg_terminate_backend</code> and viewing other users' queries in <code>pg_stat_activity</code> require superuser or membership in <code>pg_signal_backend</code> / <code>pg_read_all_stats</code>. Grant monitoring roles these predefined roles instead of superuser. Timeouts also mitigate denial-of-service from runaway or malicious queries.</p>`,
  scenario: { title: 'Table bloat keeps growing although autovacuum runs constantly', steps: [
    '1. pg_stat_user_tables shows n_dead_tup rising; VACUUM VERBOSE reports "dead row versions cannot be removed yet".',
    '2. Find the horizon holder: SELECT pid, xact_start, state, backend_xmin FROM pg_stat_activity ORDER BY age(backend_xmin) DESC.',
    '3. A BI tool session has been idle in transaction for 9 hours.',
    '4. Terminate it with pg_terminate_backend(pid); vacuum can now clean up.',
    '5. Prevent recurrence: ALTER ROLE bi_user SET idle_in_transaction_session_timeout = \'5min\'; also check replication slots and prepared transactions.'
  ] },
  widgets: ['lab:txn', 'diagram:mvcc'],
  interview: [
    { q: 'Why is "idle in transaction" dangerous?', a: 'The session holds its locks and its snapshot while doing nothing. Locks block other writers and DDL (causing lock queues), and the snapshot holds back the xmin horizon so VACUUM cannot remove dead tuples anywhere, causing bloat. Use idle_in_transaction_session_timeout and fix the application.' },
    { q: 'How do you safely run ALTER TABLE on a busy production table?', a: 'SET lock_timeout to a few seconds so the ALTER gives up instead of blocking the lock queue, retry in a loop, avoid long-running transactions during the window, and prefer operations that need only brief locks (e.g. ADD COLUMN without default rewrite, NOT VALID constraints, CREATE INDEX CONCURRENTLY).' },
    { q: 'Which errors should an application retry automatically?', a: 'serialization_failure (40001) and deadlock_detected (40P01) — retry the whole transaction with backoff. Lock timeouts (55P03) can be retried for idempotent operations. Constraint violations should not be blindly retried.' },
    { q: 'How do you build a reliable job queue in PostgreSQL?', a: 'A jobs table plus workers that claim rows with SELECT ... FOR UPDATE SKIP LOCKED LIMIT n inside a short transaction, mark them running, commit, process outside the transaction, then mark done/failed. SKIP LOCKED avoids workers blocking each other.' }
  ],
  exercises: [
    { task: 'Set a lock_timeout of 2 seconds only for the current transaction, update one order, and show the effective setting inside the transaction.', solution: `BEGIN;
SET LOCAL lock_timeout = '2s';
UPDATE orders SET status = 'shipped' WHERE id = 1 AND status = 'shipped';
SELECT current_setting('lock_timeout') AS lock_timeout_in_txn;
COMMIT;
SELECT current_setting('lock_timeout') AS lock_timeout_after;`, run: true },
    { task: 'Write a batched backfill: set is_active = true for inactive employees in batches of 5 using a CTE with LIMIT and FOR UPDATE SKIP LOCKED, run one batch and report how many rows were updated.', solution: `WITH batch AS (
  SELECT id FROM employees
  WHERE NOT is_active
  ORDER BY id
  LIMIT 5
  FOR UPDATE SKIP LOCKED
)
UPDATE employees e SET is_active = true
FROM batch WHERE e.id = batch.id
RETURNING e.id;`, run: true }
  ],
  challenge: { task: 'Build a minimal outbox pattern: in one short transaction mark order 7 as paid and insert an outbox event; then, as a worker, claim unsent outbox events with SKIP LOCKED and mark them sent.', hint: 'Create an outbox table (id, event_type, payload jsonb, sent_at). Two transactions: business write + outbox insert; then UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING.', solution: `CREATE TABLE outbox (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                     event_type text NOT NULL, payload jsonb NOT NULL, sent_at timestamptz);
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 7;
INSERT INTO outbox (event_type, payload) VALUES ('order_paid', jsonb_build_object('order_id', 7));
COMMIT;
BEGIN;
UPDATE outbox SET sent_at = now()
WHERE id IN (SELECT id FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED)
RETURNING id, event_type, payload;
COMMIT;`, run: true },
  related: ['transactions-acid', 'transactions-savepoints', 'locks', 'vacuum', 'connection-pooling'],
  quiz: [
    { type: 'mcq', q: 'Which setting automatically terminates sessions that sit idle inside an open transaction?', options: ['statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout', 'tcp_keepalives_idle'], answer: 2, explain: 'It terminates the session after the given idle time inside a transaction.' },
    { type: 'tf', q: 'A plain SELECT inside a long open transaction can block ALTER TABLE on that table.', answer: true, explain: 'SELECT holds ACCESS SHARE until the transaction ends; ALTER TABLE needs ACCESS EXCLUSIVE.' },
    { type: 'scenario', q: 'VACUUM reports dead rows cannot be removed. Most likely cause?', options: ['work_mem too low', 'A long-running or idle-in-transaction session (or stale replication slot) holding back xmin', 'Too many indexes', 'fsync off'], answer: 1, explain: 'The xmin horizon is pinned by the oldest snapshot.' },
    { type: 'bug', q: 'Python psycopg code: cur.execute("UPDATE ...") then the function returns. Sessions pile up "idle in transaction". Why?', options: ['psycopg uses autocommit by default', 'psycopg opens a transaction implicitly and nobody called conn.commit()', 'UPDATE needs RETURNING', 'Pool size too small'], answer: 1, explain: 'DB-API drivers begin a transaction on the first statement; commit or use autocommit/context managers.' }
  ]
}
]);

/* ---------------------------------------------------------------------
   MODULE: constraints (3 lessons)
   --------------------------------------------------------------------- */
PGM.addLessons([
{
  id: 'constraints-basic',
  module: 'constraints',
  title: 'NOT NULL, DEFAULT, CHECK and UNIQUE (incl. NULLS NOT DISTINCT)',
  level: 2,
  minutes: 20,
  summary: 'Let the database reject bad data: mandatory columns, sensible defaults, row-level rules and uniqueness — including PostgreSQL 15+ NULLS NOT DISTINCT.',
  objectives: [
    'Declare NOT NULL, DEFAULT, CHECK and UNIQUE constraints at column and table level',
    'Name constraints so error messages and migrations are readable',
    'Explain how CHECK treats NULL (passes) and why',
    'Use multi-column and partial unique indexes for conditional uniqueness',
    'Use UNIQUE NULLS NOT DISTINCT (PG15+) to treat NULLs as equal',
    'Add constraints to existing tables and inspect them in pg_constraint'
  ],
  concept: `<p><strong>Constraints</strong> are rules the database enforces on every INSERT and UPDATE, no matter which application, script or person writes the data. They are the "C" in ACID.</p>
<p><strong>Analogy:</strong> the form validation at a passport office counter. However the form arrived (online, by post, in person), the clerk refuses it if the name is missing (NOT NULL), the birth date is in the future (CHECK) or the passport number is already issued (UNIQUE). If the "nationality" box is left empty, the clerk fills in the default (DEFAULT).</p>
<ul>
<li><strong>NOT NULL</strong> — the column must have a value. Since PostgreSQL 18, NOT NULL constraints are recorded in <code>pg_constraint</code> with names and can be added <code>NOT VALID</code>.</li>
<li><strong>DEFAULT</strong> — value used when the INSERT omits the column (or writes <code>DEFAULT</code>). Not a constraint strictly — an explicit NULL still overrides it unless the column is NOT NULL. Defaults can be expressions: <code>now()</code>, <code>gen_random_uuid()</code>, <code>'pending'</code>.</li>
<li><strong>CHECK (expr)</strong> — a boolean expression over the row's columns that must not be FALSE. Note: <em>NULL passes</em> a CHECK (UNKNOWN is not FALSE), so <code>CHECK (price &gt; 0)</code> allows a NULL price unless the column is also NOT NULL. CHECK cannot reference other rows or tables.</li>
<li><strong>UNIQUE</strong> — no two rows may have equal values in the column(s); implemented by a unique B-tree index. By default NULLs are <em>distinct</em> from each other, so many rows may have NULL in a UNIQUE column. PostgreSQL 15 added <code>UNIQUE NULLS NOT DISTINCT</code>, which treats NULLs as equal (at most one NULL).</li>
</ul>
<p>Conditional uniqueness ("one active subscription per user", "email unique among non-deleted users") is done with a <strong>partial unique index</strong>: <code>CREATE UNIQUE INDEX ... ON users (email) WHERE deleted_at IS NULL</code>. Case-insensitive uniqueness uses an expression index on <code>lower(email)</code> (or the <code>citext</code> <span class="tag ext">extension</span> type).</p>`,
  why: `<p>Applications have bugs, migrations have bugs, and people run ad-hoc UPDATEs. Constraints are the only validation that cannot be bypassed. They also document the data model, enable optimisations (the planner uses NOT NULL and UNIQUE facts, e.g. for join removal) and stop bad data at the point of entry, where it is cheap to fix, instead of in a report six months later.</p>`,
  useCase: `<p>A fintech stores KYC documents: <code>document_number</code> must be unique per <code>(country, document_type)</code>, a pending record may not have a number yet (NULL), but there may be only one "draft" record per customer. Implementation: <code>UNIQUE (country, document_type, document_number)</code> (NULL numbers allowed many times), plus <code>CREATE UNIQUE INDEX ON kyc (customer_id) WHERE status = 'draft'</code>, plus <code>CHECK (status &lt;&gt; 'verified' OR document_number IS NOT NULL)</code> to require a number once verified.</p>`,
  internals: `<p>NOT NULL is checked directly by the executor when forming the tuple. CHECK constraints are evaluated per row after BEFORE triggers; they must be immutable expressions in spirit (PostgreSQL does not re-check existing rows if a function they call changes behaviour). UNIQUE and PRIMARY KEY are enforced by the unique B-tree index: on insert, the index AM searches for a conflicting live tuple; if it finds one in an in-progress transaction it waits for that transaction to finish. Adding a CHECK or UNIQUE to an existing table scans (and for UNIQUE, builds an index on) the whole table — use <code>NOT VALID</code> for CHECK or <code>CREATE UNIQUE INDEX CONCURRENTLY</code> + <code>ADD CONSTRAINT ... UNIQUE USING INDEX</code> on large tables.</p>`,
  whenNot: `<p>Do not encode rules that change often or depend on other tables in CHECK constraints (e.g. "price below the category maximum" stored in another table) — use triggers or application validation. Do not use CHECK with volatile functions such as <code>now()</code> (<code>CHECK (created_at &lt;= now())</code> is evaluated only at write time and misleads readers). For enumerations that change frequently, prefer a lookup table with a foreign key over a CHECK list or an ENUM type.</p>`,
  syntax: `CREATE TABLE t (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email  text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
         CONSTRAINT t_status_chk CHECK (status IN ('pending','active','closed')),
  qty    int CHECK (qty > 0),
  CONSTRAINT t_email_uq UNIQUE (email),
  UNIQUE NULLS NOT DISTINCT (a, b)                      -- PG15+
);
ALTER TABLE t ADD CONSTRAINT name CHECK (...) [NOT VALID];
ALTER TABLE t ALTER COLUMN c SET NOT NULL;
ALTER TABLE t ALTER COLUMN c SET DEFAULT expr;`,
  examples: [
    { label: 'Basic', title: 'A table with NOT NULL, DEFAULT, CHECK and UNIQUE — and what they reject',
      sql: `CREATE TABLE coupons (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL CONSTRAINT coupons_code_uq UNIQUE,
  discount_pct int NOT NULL CONSTRAINT coupons_pct_chk CHECK (discount_pct BETWEEN 1 AND 90),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  valid_from  date NOT NULL DEFAULT current_date,
  valid_to    date,
  CONSTRAINT coupons_dates_chk CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE TEMP TABLE outcome (test text, result text);

INSERT INTO coupons (code, discount_pct) VALUES ('DIWALI10', 10);

DO $$
BEGIN
  BEGIN INSERT INTO coupons (code, discount_pct) VALUES ('DIWALI10', 15);
        INSERT INTO outcome VALUES ('duplicate code', 'accepted');
  EXCEPTION WHEN others THEN INSERT INTO outcome VALUES ('duplicate code', SQLERRM); END;
  BEGIN INSERT INTO coupons (code, discount_pct) VALUES ('HUGE', 95);
        INSERT INTO outcome VALUES ('95 percent', 'accepted');
  EXCEPTION WHEN others THEN INSERT INTO outcome VALUES ('95 percent', SQLERRM); END;
  BEGIN INSERT INTO coupons (code, discount_pct, valid_from, valid_to) VALUES ('BACK', 5, '2025-05-01', '2025-04-01');
        INSERT INTO outcome VALUES ('end before start', 'accepted');
  EXCEPTION WHEN others THEN INSERT INTO outcome VALUES ('end before start', SQLERRM); END;
  BEGIN INSERT INTO coupons (code) VALUES ('NOPCT');
        INSERT INTO outcome VALUES ('missing pct', 'accepted');
  EXCEPTION WHEN others THEN INSERT INTO outcome VALUES ('missing pct', SQLERRM); END;
END $$;

SELECT code, discount_pct, status, valid_from = current_date AS default_date FROM coupons;
SELECT * FROM outcome;`,
      explain: `<p>The valid insert omits <code>status</code> and <code>valid_from</code>, so their DEFAULTs fill them. The DO block tries four bad rows, catching each error (each inner BEGIN/EXCEPTION is a savepoint) so we can display the messages: the UNIQUE index rejects the duplicate code, the named CHECK rejects 95%, the table-level CHECK rejects an end date before the start, and NOT NULL rejects the missing percentage. Naming constraints (<code>coupons_pct_chk</code>) makes these messages self-explanatory for developers and support staff.</p>`,
      output: `CREATE TABLE
CREATE TABLE
INSERT 0 1
DO

 code     | discount_pct | status | default_date
----------+--------------+--------+--------------
 DIWALI10 |           10 | active | t
(1 row)

 test             | result
------------------+----------------------------------------------------------------------------------------
 duplicate code   | duplicate key value violates unique constraint "coupons_code_uq"
 95 percent       | new row for relation "coupons" violates check constraint "coupons_pct_chk"
 end before start | new row for relation "coupons" violates check constraint "coupons_dates_chk"
 missing pct      | null value in column "discount_pct" of relation "coupons" violates not-null constraint
(4 rows)`, run: true },
    { label: 'Intermediate', title: 'NULL semantics: CHECK passes NULL; UNIQUE allows many NULLs unless NULLS NOT DISTINCT',
      sql: `CREATE TABLE t_default (phone text UNIQUE, qty int CHECK (qty > 0));
INSERT INTO t_default VALUES (NULL, NULL), (NULL, NULL);      -- both accepted!
SELECT count(*) AS rows_with_null_phone FROM t_default WHERE phone IS NULL;

CREATE TABLE t_nnd (phone text UNIQUE NULLS NOT DISTINCT);
INSERT INTO t_nnd VALUES (NULL);
CREATE TEMP TABLE outcome (result text);
DO $$
BEGIN
  INSERT INTO t_nnd VALUES (NULL);
  INSERT INTO outcome VALUES ('second NULL accepted');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO outcome VALUES ('second NULL rejected: ' || SQLERRM);
END $$;
SELECT * FROM outcome;`,
      explain: `<p><code>CHECK (qty &gt; 0)</code> evaluates to NULL (unknown) for a NULL qty, which is not FALSE, so the row passes — add NOT NULL if a value is required. A plain UNIQUE column accepts any number of NULLs because NULL is never equal to NULL. With <code>UNIQUE NULLS NOT DISTINCT</code> (PostgreSQL 15+), NULLs compare as equal for uniqueness purposes, so the second NULL is rejected.</p>`,
      output: `CREATE TABLE
INSERT 0 2

 rows_with_null_phone
----------------------
                    2
(1 row)

CREATE TABLE
INSERT 0 1
CREATE TABLE
DO

 result
----------------------------------------------------------------------------------------
 second NULL rejected: duplicate key value violates unique constraint "t_nnd_phone_key"
(1 row)`, run: true },
    { label: 'Advanced', title: 'Conditional and case-insensitive uniqueness on company_db users',
      sql: `-- Current state: several active admins per tenant
SELECT tenant_id, count(*) FILTER (WHERE role = 'admin' AND is_active) AS active_admins
FROM users GROUP BY tenant_id ORDER BY tenant_id;

-- New rule: only one active admin per tenant. Fix the data first (keep the lowest id) ...
UPDATE users u SET role = 'manager'
WHERE u.role = 'admin' AND u.is_active
  AND u.id <> (SELECT min(id) FROM users x
               WHERE x.tenant_id = u.tenant_id AND x.role = 'admin' AND x.is_active);

-- ... then enforce it with a partial unique index
CREATE UNIQUE INDEX users_one_active_admin_per_tenant
  ON users (tenant_id) WHERE role = 'admin' AND is_active;

-- Emails unique regardless of case
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TEMP TABLE outcome (test text, result text);
DO $$
BEGIN
  BEGIN
    INSERT INTO users (username, email, password_hash, role, tenant_id, is_active)
    VALUES ('newadmin', 'newadmin@tenant1.com', 'x', 'admin', 1, true);
    INSERT INTO outcome VALUES ('second active admin, tenant 1', 'accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO outcome VALUES ('second active admin, tenant 1', SQLERRM);
  END;
  BEGIN
    INSERT INTO users (username, email, password_hash, role, tenant_id, is_active)
    VALUES ('shouty', 'USER1@TENANT2.COM', 'x', 'viewer', 2, true);
    INSERT INTO outcome VALUES ('upper-case duplicate email', 'accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO outcome VALUES ('upper-case duplicate email', SQLERRM);
  END;
END $$;
SELECT * FROM outcome;`,
      explain: `<p>The first query shows the data already violates the new rule, so creating the index directly would fail with "could not create unique index". As in any real migration, we clean up first (demote all but one admin per tenant), then add the rule. A <strong>partial unique index</strong> enforces uniqueness only for rows matching its WHERE clause: inactive admins or other roles are unconstrained. An <strong>expression unique index</strong> on <code>lower(email)</code> makes 'USER1@TENANT2.COM' collide with the existing 'user1@tenant2.com', which a plain UNIQUE (email) would accept. Neither can be declared with the <code>UNIQUE</code> table-constraint syntax — they are indexes, which still enforce uniqueness exactly like constraints (and can be targeted by <code>ON CONFLICT</code> with a matching predicate/expression).</p>`,
      output: ` tenant_id | active_admins
-----------+---------------
         1 |             4
         2 |             3
         3 |             4
(3 rows)

UPDATE 8
CREATE INDEX
CREATE INDEX
CREATE TABLE
DO

 test                          | result
-------------------------------+------------------------------------------------------------------------------------
 second active admin, tenant 1 | duplicate key value violates unique constraint "users_one_active_admin_per_tenant"
 upper-case duplicate email    | duplicate key value violates unique constraint "users_email_lower_uq"
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Validation only in the app: the database happily stores garbage
CREATE TEMP TABLE promo (code text, pct int, status text);
INSERT INTO promo VALUES (NULL, -20, 'actvie'), ('X', 500, NULL), ('X', 10, 'active');
SELECT * FROM promo;`, why: 'No NOT NULL, CHECK or UNIQUE: a typo in status, a negative discount and a duplicate code are all stored. Every consumer must now defend against them.', run: true },
    good: { sql: `CREATE TEMP TABLE promo (
  code   text NOT NULL UNIQUE,
  pct    int  NOT NULL CHECK (pct BETWEEN 1 AND 90),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired'))
);
INSERT INTO promo (code, pct) VALUES ('X', 10);
SELECT * FROM promo;`, why: 'The rules live with the data. Bad rows are rejected at write time with a clear error, whatever client sends them.', run: true }
  },
  mistakes: [
    `Assuming <code>CHECK (x &gt; 0)</code> forbids NULL — it does not; add NOT NULL.`,
    `Expecting UNIQUE to allow only one NULL — by default it allows many; use NULLS NOT DISTINCT (PG15+) or a partial index.`,
    `Unnamed constraints producing messages like <code>t_check1</code> — name them.`,
    `Case-sensitive uniqueness on emails/usernames — use a unique index on <code>lower(col)</code> or citext.`,
    `Using <code>now()</code> or other volatile functions inside CHECK constraints.`,
    `Adding <code>SET NOT NULL</code> to a huge table in one step — it scans the table under an ACCESS EXCLUSIVE lock (add a validated CHECK (col IS NOT NULL) first, or on PG18 a NOT VALID NOT NULL constraint, then validate).`
  ],
  best: [
    `Default to NOT NULL; allow NULL only when "unknown/not applicable" is a real state.`,
    `Name every constraint with a convention like <code>table_column_chk</code>, <code>table_column_uq</code>.`,
    `Use partial unique indexes for "unique among active/non-deleted rows".`,
    `Keep CHECK expressions simple, immutable and row-local.`,
    `Translate constraint names to user-friendly messages in the application (e.g. map <code>coupons_code_uq</code> to "This code already exists").`
  ],
  performance: `<p>NOT NULL and CHECK cost a few CPU cycles per written row — negligible. UNIQUE costs an index (storage + index maintenance on every write) and gives fast lookups in return. Adding constraints to large existing tables is the expensive part: CHECK scans the table (avoid with NOT VALID + VALIDATE), UNIQUE builds an index (use CONCURRENTLY). The planner benefits from constraints: UNIQUE enables join removal and better estimates; CHECK constraints enable partition pruning and <code>constraint_exclusion</code>.</p>`,
  security: `<p>Constraints are a defence-in-depth control against tampered or buggy clients: an attacker who bypasses API validation still cannot insert a negative quantity. Be aware that constraint error messages include the offending key values (<code>DETAIL: Key (email)=(...) already exists</code>) — do not pass raw database errors to end users, as they can leak data or enable enumeration.</p>`,
  scenario: { title: 'Duplicate customer accounts with the same email in different case', steps: [
    '1. Find duplicates: SELECT lower(email), count(*) FROM customers GROUP BY 1 HAVING count(*) > 1.',
    '2. Merge or deactivate duplicates (update FKs to the surviving id).',
    '3. CREATE UNIQUE INDEX CONCURRENTLY customers_email_lower_uq ON customers (lower(email)).',
    '4. Change application lookups to WHERE lower(email) = lower($1) so they use the index.',
    '5. Handle unique_violation (23505) in the signup flow with a friendly message.'
  ] },
  widgets: [],
  interview: [
    { q: 'Does a CHECK constraint reject NULL?', a: 'No. A CHECK fails only when the expression is FALSE; NULL (unknown) passes. Combine with NOT NULL to require a value.' },
    { q: 'How many NULLs can a UNIQUE column hold?', a: 'Any number by default, because NULLs are not equal to each other. Since PostgreSQL 15, UNIQUE NULLS NOT DISTINCT treats NULLs as equal so only one is allowed.' },
    { q: 'How do you enforce "email unique among non-deleted users"?', a: 'A partial unique index: CREATE UNIQUE INDEX ON users (lower(email)) WHERE deleted_at IS NULL. It enforces uniqueness only for rows matching the predicate.' },
    { q: 'How do you add NOT NULL to a large table with minimal locking?', a: 'Add CHECK (col IS NOT NULL) NOT VALID (instant), VALIDATE CONSTRAINT (scans with a weaker lock), then ALTER COLUMN SET NOT NULL, which can use the validated check to skip the scan (PG12+). On PG18, a NOT NULL constraint itself can be added NOT VALID and validated later.' }
  ],
  exercises: [
    { task: 'Add a named CHECK constraint to products ensuring stock is never negative, then show it in pg_constraint.', solution: `ALTER TABLE products ADD CONSTRAINT products_stock_nonneg_chk CHECK (stock >= 0);
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'products'::regclass AND contype = 'c';`, run: true },
    { task: 'List all constraints of the employees table with their type and definition.', solution: `SELECT conname,
       CASE contype WHEN 'p' THEN 'primary key' WHEN 'f' THEN 'foreign key' WHEN 'u' THEN 'unique'
                    WHEN 'c' THEN 'check' WHEN 'n' THEN 'not null' WHEN 'x' THEN 'exclusion' END AS type,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'employees'::regclass
ORDER BY contype, conname;`, run: true }
  ],
  challenge: { task: 'Create a table of employee_certifications(employee_id, cert_code, expires_on, revoked bool) where an employee can hold each cert_code only once among non-revoked rows, expires_on must be after 2000-01-01 when present, and cert_code must be upper case. Prove each rule with a rejected insert captured in a DO block.', hint: 'Partial unique index WHERE NOT revoked; CHECK (cert_code = upper(cert_code)); CHECK (expires_on > date \'2000-01-01\').', solution: `CREATE TABLE employee_certifications (
  employee_id int NOT NULL REFERENCES employees,
  cert_code   text NOT NULL CONSTRAINT cert_upper_chk CHECK (cert_code = upper(cert_code)),
  expires_on  date CONSTRAINT cert_expiry_chk CHECK (expires_on > date '2000-01-01'),
  revoked     boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX cert_one_active ON employee_certifications (employee_id, cert_code) WHERE NOT revoked;
INSERT INTO employee_certifications VALUES (10, 'AWS-SA', '2027-01-01', false);
INSERT INTO employee_certifications VALUES (10, 'AWS-SA', '2024-01-01', true);   -- revoked duplicate is fine
CREATE TEMP TABLE outcome (test text, result text);
DO $$
BEGIN
  BEGIN INSERT INTO employee_certifications VALUES (10, 'AWS-SA', '2028-01-01', false);
  EXCEPTION WHEN others THEN INSERT INTO outcome VALUES ('active duplicate', SQLERRM); END;
  BEGIN INSERT INTO employee_certifications VALUES (11, 'aws-sa', NULL, false);
  EXCEPTION WHEN others THEN INSERT INTO outcome VALUES ('lower case', SQLERRM); END;
  BEGIN INSERT INTO employee_certifications VALUES (12, 'PMP', '1999-12-31', false);
  EXCEPTION WHEN others THEN INSERT INTO outcome VALUES ('old expiry', SQLERRM); END;
END $$;
SELECT * FROM outcome;`, run: true },
  related: ['constraints-keys', 'constraints-advanced', 'indexes', 'transactions-acid'],
  quiz: [
    { type: 'tf', q: 'CHECK (price > 0) prevents NULL prices.', answer: false, explain: 'NULL makes the check UNKNOWN, which passes. Add NOT NULL.' },
    { type: 'predict', q: 'How many rows are inserted?', code: `CREATE TABLE x (v int UNIQUE);
INSERT INTO x VALUES (NULL);
INSERT INTO x VALUES (NULL);
INSERT INTO x VALUES (1);`, options: ['1', '2', '3', 'Error on the second insert'], answer: 2, explain: 'NULLs are distinct by default; all three succeed.' },
    { type: 'mcq', q: 'Which PG15+ syntax allows at most one NULL in a unique column?', options: ['UNIQUE NULLS FIRST', 'UNIQUE NULLS NOT DISTINCT', 'UNIQUE NOT NULL', 'DISTINCT UNIQUE'], answer: 1, explain: 'NULLS NOT DISTINCT treats NULLs as equal.' },
    { type: 'design', q: 'Usernames must be unique ignoring case, but only for active accounts. Best?', options: ['UNIQUE (username)', 'CHECK (username = lower(username))', 'CREATE UNIQUE INDEX ON users (lower(username)) WHERE is_active', 'A trigger counting rows'], answer: 2, explain: 'Expression + partial unique index enforces exactly that rule.' }
  ]
},
{
  id: 'constraints-keys',
  module: 'constraints',
  title: 'PRIMARY KEY and FOREIGN KEY: ON DELETE / ON UPDATE Actions and Indexing FKs',
  level: 2,
  minutes: 22,
  summary: 'Identify rows with primary keys, enforce relationships with foreign keys, choose the right referential actions, and always index the referencing columns.',
  objectives: [
    'Define primary keys (identity, composite) and explain their guarantees',
    'Define foreign keys and choose ON DELETE / ON UPDATE actions (NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT)',
    'Use PG15+ ON DELETE SET NULL (column_list) for composite keys',
    'Explain why FK columns need indexes and find unindexed FKs',
    'Understand the locks and checks FKs perform'
  ],
  concept: `<p>A <strong>PRIMARY KEY</strong> uniquely identifies each row: it is <code>UNIQUE</code> + <code>NOT NULL</code>, one per table, backed by a unique B-tree index. Every company_db table uses <code>id ... GENERATED ALWAYS AS IDENTITY PRIMARY KEY</code> (a surrogate key); <code>employee_projects</code> uses a <em>composite</em> natural key <code>(employee_id, project_id)</code>, which also prevents assigning the same person twice to a project.</p>
<p>A <strong>FOREIGN KEY</strong> says "the value in this column must exist as a key in that table" — <code>employees.department_id REFERENCES departments(id)</code>. The referenced columns must have a PRIMARY KEY or UNIQUE constraint. A NULL foreign key is allowed (no relationship) unless the column is NOT NULL.</p>
<p><strong>Analogy:</strong> a library. Each book has a unique barcode (primary key). Each loan slip records a barcode (foreign key) — you cannot write a slip for a barcode that does not exist, and the library must decide what happens to slips when a book is withdrawn: forbid it while loans exist (RESTRICT / NO ACTION), shred the slips too (CASCADE), or keep the slips with the barcode blanked out (SET NULL).</p>
<h4>Referential actions (what happens to children when the parent is deleted/updated)</h4>
<table><tr><th>Action</th><th>Effect</th><th>Typical use</th></tr>
<tr><td><code>NO ACTION</code> (default)</td><td>error if children exist; checked at end of statement (deferrable)</td><td>most relationships</td></tr>
<tr><td><code>RESTRICT</code></td><td>error immediately; never deferrable</td><td>strict protection</td></tr>
<tr><td><code>CASCADE</code></td><td>delete/update children too</td><td>composition: order &rarr; order_items</td></tr>
<tr><td><code>SET NULL</code> [ (cols) ]</td><td>set the FK column(s) to NULL</td><td>optional links: employee.manager_id</td></tr>
<tr><td><code>SET DEFAULT</code> [ (cols) ]</td><td>set FK to its default (must exist in parent)</td><td>"unassigned" bucket</td></tr></table>
<p>PostgreSQL 15 added column lists for <code>SET NULL</code>/<code>SET DEFAULT</code> on delete, useful for composite FKs that include a tenant id you must not null out: <code>ON DELETE SET NULL (manager_id)</code>.</p>
<p><strong>Index your FKs.</strong> PostgreSQL automatically indexes primary keys and unique constraints (the referenced side) but <em>not</em> the referencing columns. Without an index on <code>order_items(order_id)</code>, deleting one order makes PostgreSQL sequentially scan all of <code>order_items</code> to check for children — per deleted row. Joins on the FK also suffer.</p>`,
  why: `<p>Without foreign keys, orphaned rows accumulate (items whose order was deleted, payments for non-existent orders), joins silently drop data and reports disagree. FKs make relationships a guaranteed fact. Primary keys make every row addressable — required for updates by key, replication (logical replication needs a replica identity), ORMs and deduplication.</p>`,
  useCase: `<p>An order-management system deletes test orders nightly. <code>order_items.order_id</code> is <code>ON DELETE CASCADE</code> (items have no life without their order), while <code>payments.order_id</code> uses the default NO ACTION — an order that has payments must not disappear silently; finance must refund and archive first. After adding the missing index on <code>payments(order_id)</code>, the nightly delete of 20,000 orders went from 40 minutes (one sequential scan of payments per order) to 3 seconds.</p>`,
  internals: `<p>FKs are implemented with internal system triggers (<code>RI_ConstraintTrigger</code>). On INSERT/UPDATE of a child, a trigger runs <code>SELECT 1 FROM parent WHERE id = $1 FOR KEY SHARE</code>, which locks the parent row in KEY SHARE mode — preventing concurrent deletion or key change of the parent, while still allowing non-key updates. On DELETE/UPDATE of a parent key, a trigger looks for children (<code>SELECT ... FROM child WHERE fk = $1 FOR KEY SHARE</code>) and applies the action. These lookups are why the child FK column needs an index. Since PG12, FKs can reference partitioned tables. Adding an FK to an existing table validates all rows (use <code>NOT VALID</code> + <code>VALIDATE CONSTRAINT</code> on big tables).</p>`,
  whenNot: `<p>Avoid CASCADE on relationships where deletion is a business event that needs review (customers &rarr; orders &rarr; payments): a single accidental DELETE can wipe years of data. Prefer soft deletes (<code>deleted_at</code>) for entities referenced by financial records. In very high-volume append-only event tables, some teams drop FKs for ingest speed and validate asynchronously — a conscious trade-off, not a default. Distributed setups (e.g. Citus <span class="tag ext">extension</span>) restrict which FKs are possible across shards.</p>`,
  syntax: `CREATE TABLE child (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id bigint NOT NULL REFERENCES parent (id)
              ON DELETE { NO ACTION | RESTRICT | CASCADE | SET NULL [(col)] | SET DEFAULT [(col)] }
              ON UPDATE { ... },
  PRIMARY KEY (a, b)                                       -- composite alternative
);
ALTER TABLE child ADD CONSTRAINT child_parent_fk
  FOREIGN KEY (parent_id) REFERENCES parent (id) [NOT VALID];
CREATE INDEX ON child (parent_id);                         -- always index FKs`,
  examples: [
    { label: 'Basic', title: 'Inspect the keys of company_db and test an FK violation',
      sql: `SELECT conrelid::regclass AS table_name, conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype IN ('p', 'f')
  AND conrelid IN ('orders'::regclass, 'order_items'::regclass, 'employee_projects'::regclass)
ORDER BY conrelid::regclass::text, contype DESC, conname;

CREATE TEMP TABLE outcome (result text);
DO $$
BEGIN
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (999999, 1, 1, 10);
EXCEPTION WHEN foreign_key_violation THEN
  INSERT INTO outcome VALUES (SQLERRM);
END $$;
SELECT * FROM outcome;`,
      explain: `<p><code>pg_get_constraintdef</code> shows each key's definition: identity primary keys, the composite primary key of <code>employee_projects</code>, and FKs from <code>orders</code> to <code>customers</code> and from <code>order_items</code> to <code>orders</code>/<code>products</code>. Inserting an item for a non-existent order 999999 raises <code>foreign_key_violation</code> (SQLSTATE 23503) — orphans are impossible.</p>`,
      output: ` table_name        | conname                            | definition
-------------------+------------------------------------+----------------------------------------------------------------------
 employee_projects | employee_projects_pkey             | PRIMARY KEY (employee_id, project_id)
 employee_projects | employee_projects_employee_id_fkey | FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
 employee_projects | employee_projects_project_id_fkey  | FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
 order_items       | order_items_pkey                   | PRIMARY KEY (id)
 order_items       | order_items_order_id_fkey          | FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
 order_items       | order_items_product_id_fkey        | FOREIGN KEY (product_id) REFERENCES products(id)
 orders            | orders_pkey                        | PRIMARY KEY (id)
 orders            | orders_customer_id_fkey            | FOREIGN KEY (customer_id) REFERENCES customers(id)
(8 rows)

CREATE TABLE
DO

 result
-----------------------------------------------------------------------------------------------------
 insert or update on table "order_items" violates foreign key constraint "order_items_order_id_fkey"
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Referential actions: CASCADE, SET NULL and NO ACTION side by side',
      sql: `CREATE TABLE teams   (id int PRIMARY KEY, name text NOT NULL);
CREATE TABLE members (id int PRIMARY KEY, team_id int REFERENCES teams ON DELETE CASCADE, name text);
CREATE TABLE tickets (id int PRIMARY KEY, team_id int REFERENCES teams ON DELETE SET NULL, title text);
CREATE TABLE budgets (id int PRIMARY KEY, team_id int REFERENCES teams, amount numeric);  -- NO ACTION

INSERT INTO teams   VALUES (1, 'Platform'), (2, 'Mobile');
INSERT INTO members VALUES (1, 1, 'Asha'), (2, 1, 'Rohan'), (3, 2, 'Meera');
INSERT INTO tickets VALUES (1, 1, 'Upgrade PG'), (2, 2, 'Fix login');
INSERT INTO budgets VALUES (1, 2, 50000);

DELETE FROM teams WHERE id = 1;      -- no budget references team 1: allowed

SELECT 'members' AS tbl, count(*) FILTER (WHERE team_id IS NULL) AS null_fk, count(*) AS rows FROM members
UNION ALL
SELECT 'tickets', count(*) FILTER (WHERE team_id IS NULL), count(*) FROM tickets;

CREATE TEMP TABLE outcome (result text);
DO $$
BEGIN
  DELETE FROM teams WHERE id = 2;    -- budget 1 still references team 2
EXCEPTION WHEN foreign_key_violation THEN
  INSERT INTO outcome VALUES (SQLERRM);
END $$;
SELECT * FROM outcome;`,
      explain: `<p>Deleting team 1 cascades to its two members (they are deleted), sets <code>team_id</code> to NULL on its ticket (the ticket survives, unassigned) and is allowed because no budget references team 1. Deleting team 2 fails: <code>budgets.team_id</code> uses the default NO ACTION, so a referenced parent cannot be removed. Choose the action per relationship based on business meaning, not convenience.</p>`,
      output: `CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
INSERT 0 2
INSERT 0 3
INSERT 0 2
INSERT 0 1
DELETE 1

 tbl     | null_fk | rows
---------+---------+------
 members |       0 |    1
 tickets |       1 |    2
(2 rows)

CREATE TABLE
DO

 result
-------------------------------------------------------------------------------------------------------------
 update or delete on table "teams" violates foreign key constraint "budgets_team_id_fkey" on table "budgets"
(1 row)`, run: true },
    { label: 'Advanced', title: 'Find unindexed foreign keys and see the cost of deleting a parent',
      sql: `-- Foreign keys whose leading columns are not covered by any index
SELECT c.conrelid::regclass AS table_name,
       c.conname,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.contype = 'f'
  AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
      )
ORDER BY c.conrelid::regclass::text, c.conname;

EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
DELETE FROM payments WHERE order_id = 3;`,
      explain: `<p>The catalog query compares each FK's columns (<code>conkey</code>) with the leading columns of every index on the referencing table. It flags, among others, <code>orders.customer_id</code> and <code>payments.order_id</code> — deliberately missing in company_db. The EXPLAIN shows the consequence: finding payments for one order needs a Seq Scan over all ~4,585 payments. Because <code>payments.order_id</code> references <code>orders</code>, the same scan also runs inside the FK trigger for every order you delete or whose id you change. Fix: <code>CREATE INDEX CONCURRENTLY ON payments (order_id)</code>.</p>`,
      output: ` table_name        | conname                           | definition
-------------------+-----------------------------------+--------------------------------------------------------------------
 employee_projects | employee_projects_project_id_fkey | FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
 employees         | employees_manager_id_fkey         | FOREIGN KEY (manager_id) REFERENCES employees(id)
 order_items       | order_items_product_id_fkey       | FOREIGN KEY (product_id) REFERENCES products(id)
 orders            | orders_customer_id_fkey           | FOREIGN KEY (customer_id) REFERENCES customers(id)
 payments          | payments_order_id_fkey            | FOREIGN KEY (order_id) REFERENCES orders(id)
 projects          | projects_department_id_fkey       | FOREIGN KEY (department_id) REFERENCES departments(id)
(6 rows)

Delete on payments (actual rows=0.00 loops=1)
  Buffers: shared hit=45 dirtied=44
  ->  Seq Scan on payments (actual rows=1.00 loops=1)
        Filter: (order_id = 3)
        Rows Removed by Filter: 4584
        Buffers: shared hit=44 dirtied=44
Planning:
  Buffers: shared hit=24 dirtied=1`, run: true }
  ],
  compare: {
    bad: { sql: `-- Delete 200 orders' payments without an FK index: one seq scan of payments per order
EXPLAIN (COSTS OFF)
DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id = 7);`, why: 'payments.order_id is unindexed, so locating children (here and inside FK triggers) requires scanning the whole payments table; at production scale this turns deletes into multi-minute operations holding locks.', run: true },
    good: { sql: `CREATE INDEX payments_order_id_idx ON payments (order_id);
ANALYZE payments;
EXPLAIN (COSTS OFF)
DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id = 7);`, why: 'With an index on the FK column, children are found by index lookups; FK checks on parent delete/update become cheap too.', run: true }
  },
  mistakes: [
    `Not indexing FK columns — slow parent deletes/updates, slow joins, and long lock times.`,
    `Using ON DELETE CASCADE on business-critical history (customers &rarr; orders &rarr; payments).`,
    `Using natural keys that change (email, phone) as primary keys referenced by many tables — every change cascades.`,
    `Tables without a primary key — breaks logical replication updates/deletes, ORMs and dedup.`,
    `Disabling FK checks (<code>session_replication_role = replica</code>) for "speed" during loads and ending up with orphans.`
  ],
  best: [
    `Give every table a primary key; prefer <code>bigint GENERATED ALWAYS AS IDENTITY</code> (or UUIDv7) surrogate keys.`,
    `Index every foreign key column (or make it the leading column of a composite index).`,
    `Choose referential actions deliberately: CASCADE for composition, SET NULL for optional links, NO ACTION for history.`,
    `Make FK columns NOT NULL when the relationship is mandatory.`,
    `Add FKs on large existing tables with <code>NOT VALID</code>, then <code>VALIDATE CONSTRAINT</code> (see Advanced constraints).`
  ],
  performance: `<p>Each child INSERT/UPDATE performs an index lookup on the parent's key (cheap, PK index) plus a <code>FOR KEY SHARE</code> row lock. Each parent DELETE or key UPDATE performs a lookup on the child — cheap with an index, a full scan without. CASCADE deletes can touch millions of rows in one statement; batch large deletions. Heavy concurrent child inserts referencing the same parent create MultiXact KEY SHARE locks on that parent row, which can become a hotspot (e.g. millions of events referencing one tenant row).</p>`,
  security: `<p>Creating a foreign key requires the REFERENCES privilege on the parent table; users who merely insert child rows need only INSERT on the child, because the internal FK checks run with the table owner's rights. Beware that FK errors reveal whether a parent key exists — in multi-tenant APIs validate ownership before inserting to avoid cross-tenant existence probing, and include tenant_id in composite FKs so a child can only reference a parent of the same tenant.</p>`,
  scenario: { title: 'Deleting a customer takes minutes and blocks checkouts', steps: [
    '1. pg_stat_activity shows the DELETE running; pg_locks shows other sessions waiting on rows of orders.',
    '2. Run the unindexed-FK catalog query: orders.customer_id and payments.order_id lack indexes.',
    '3. CREATE INDEX CONCURRENTLY on both columns (no write blocking).',
    '4. Reconsider the action: customers should be soft-deleted, not cascaded into financial history.',
    '5. The delete (now an UPDATE ... SET deleted_at) completes in milliseconds.'
  ] },
  widgets: ['diagram:normalization'],
  interview: [
    { q: 'Does PostgreSQL automatically index foreign key columns?', a: 'No. It indexes the referenced side (it must have a PK/UNIQUE index) but not the referencing columns. You should create an index on FK columns to make joins, parent deletes/updates and FK checks efficient.' },
    { q: 'Difference between NO ACTION and RESTRICT?', a: 'Both prevent deleting/updating a referenced parent. RESTRICT checks immediately and can never be deferred; NO ACTION checks at the end of the statement (or at commit if the constraint is DEFERRABLE INITIALLY DEFERRED), allowing the child to be fixed later in the same statement/transaction.' },
    { q: 'What locks does a foreign key take when inserting a child row?', a: 'A FOR KEY SHARE row lock on the referenced parent row, so the parent cannot be deleted or have its key changed until the inserting transaction ends; non-key updates of the parent are still allowed.' },
    { q: 'When is ON DELETE CASCADE appropriate?', a: 'For composition relationships where children have no meaning without the parent, like order_items of an order or line items of an invoice draft. Avoid it for independent or financially relevant entities.' }
  ],
  exercises: [
    { task: 'Create an index for the unindexed FK orders.customer_id and verify that looking up orders of customer 42 uses it.', solution: `CREATE INDEX orders_customer_id_idx ON orders (customer_id);
ANALYZE orders;
EXPLAIN (COSTS OFF) SELECT * FROM orders WHERE customer_id = 42;`, run: true },
    { task: 'Create a table project_notes referencing projects with ON DELETE CASCADE and referencing employees (author) with ON DELETE SET NULL; insert a note and delete the project to show the cascade.', solution: `CREATE TABLE project_notes (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id int NOT NULL REFERENCES projects ON DELETE CASCADE,
  author_id  int REFERENCES employees ON DELETE SET NULL,
  note       text NOT NULL
);
CREATE INDEX ON project_notes (project_id);
CREATE INDEX ON project_notes (author_id);
INSERT INTO project_notes (project_id, author_id, note) VALUES (24, 10, 'kick-off done');
DELETE FROM employee_projects WHERE project_id = 24;
DELETE FROM projects WHERE id = 24;
SELECT count(*) AS notes_left FROM project_notes;`, run: true }
  ],
  challenge: { task: 'Model tenant-safe references: create tenant_projects(tenant_id, id) and tenant_tasks(tenant_id, id, project_id) so a task can only reference a project of the same tenant, and deleting a project nulls only project_id (not tenant_id) using PG15+ SET NULL (column).', hint: 'PRIMARY KEY (tenant_id, id) on projects; FOREIGN KEY (tenant_id, project_id) REFERENCES tenant_projects ON DELETE SET NULL (project_id).', solution: `CREATE TABLE tenant_projects (tenant_id int NOT NULL, id int NOT NULL, name text, PRIMARY KEY (tenant_id, id));
CREATE TABLE tenant_tasks (
  tenant_id  int NOT NULL,
  id         int NOT NULL,
  project_id int,
  title      text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES tenant_projects (tenant_id, id)
    ON DELETE SET NULL (project_id)
);
CREATE INDEX ON tenant_tasks (tenant_id, project_id);
INSERT INTO tenant_projects VALUES (1, 10, 'Alpha'), (2, 10, 'Beta');
INSERT INTO tenant_tasks VALUES (1, 1, 10, 'design'), (2, 1, 10, 'build');
DELETE FROM tenant_projects WHERE tenant_id = 1 AND id = 10;
SELECT * FROM tenant_tasks ORDER BY tenant_id;`, run: true },
  related: ['constraints-basic', 'constraints-advanced', 'joins-inner-join', 'indexes'],
  quiz: [
    { type: 'tf', q: 'Creating a FOREIGN KEY automatically creates an index on the referencing column.', answer: false, explain: 'Only the referenced side must be indexed (PK/UNIQUE); index the FK column yourself.' },
    { type: 'mcq', q: 'Order items should disappear when their order is deleted. Which action?', options: ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET DEFAULT'], answer: 2, explain: 'Composition relationship: CASCADE.' },
    { type: 'index', q: 'DELETE FROM orders WHERE id = $1 is slow. order_items(order_id) references orders. Which index helps most?', options: ['orders(id)', 'order_items(order_id)', 'order_items(product_id)', 'orders(customer_id)'], answer: 1, explain: 'The FK trigger must find children by order_id.' },
    { type: 'predict', q: 'manager_id REFERENCES employees ON DELETE SET NULL. You delete a team lead with 1 report. What happens to the report?', options: ['Deleted', 'manager_id set to NULL', 'Error', 'manager_id set to the lead\'s manager'], answer: 1, explain: 'SET NULL clears the reference; re-assigning to the grand-manager would need a trigger or application logic.' }
  ]
},
{
  id: 'constraints-advanced',
  module: 'constraints',
  title: 'Advanced Constraints: EXCLUDE, DEFERRABLE and NOT VALID + VALIDATE',
  level: 3,
  minutes: 24,
  summary: 'Prevent overlapping bookings with exclusion constraints, defer checks to commit time for circular updates, and add constraints to huge tables without downtime.',
  objectives: [
    'Build an EXCLUDE constraint with btree_gist to prevent overlapping room bookings',
    'Use PG18 PRIMARY KEY / UNIQUE ... WITHOUT OVERLAPS for temporal keys',
    'Declare DEFERRABLE INITIALLY DEFERRED constraints and use SET CONSTRAINTS',
    'Swap unique values and insert circular references inside one transaction',
    'Add CHECK and FOREIGN KEY constraints to large tables with NOT VALID and VALIDATE CONSTRAINT',
    'Understand the locks each step takes'
  ],
  concept: `<h4>1. EXCLUDE constraints</h4>
<p>UNIQUE says "no two rows are <em>equal</em> on these columns". An <strong>exclusion constraint</strong> generalises this: "no two rows satisfy <em>all</em> of these operator comparisons". <code>EXCLUDE USING gist (room_id WITH =, during WITH &amp;&amp;)</code> means: no two rows may have the same room <em>and</em> overlapping time ranges (<code>&amp;&amp;</code> = overlaps). It is enforced by a GiST (or SP-GiST) index. Because plain scalar types like <code>int</code> have no GiST operator class in core, you need the <code>btree_gist</code> <span class="tag ext">extension</span> (ships with PostgreSQL contrib) to combine <code>=</code> on integers with <code>&amp;&amp;</code> on ranges.</p>
<p><strong>Analogy:</strong> a meeting-room booking sheet where the receptionist refuses any new booking whose time slot overlaps an existing booking <em>for the same room</em>. Different rooms may overlap freely; the same room may be booked back-to-back (half-open ranges <code>[start, end)</code> touch but do not overlap).</p>
<p>PostgreSQL 18 adds temporal keys: <code>PRIMARY KEY (room_id, during WITHOUT OVERLAPS)</code> / <code>UNIQUE (... WITHOUT OVERLAPS)</code>, which are implemented as exclusion constraints, plus <code>FOREIGN KEY (..., PERIOD col) REFERENCES ...</code> for temporal referential integrity.</p>
<h4>2. DEFERRABLE constraints</h4>
<p>Normally constraints are checked immediately (per row or at statement end). A constraint declared <code>DEFERRABLE INITIALLY DEFERRED</code> is checked at <strong>COMMIT</strong>; <code>DEFERRABLE INITIALLY IMMEDIATE</code> is checked immediately unless a transaction runs <code>SET CONSTRAINTS name DEFERRED</code>. This allows temporarily inconsistent intermediate states: swapping two unique positions, inserting two rows that reference each other, reordering a linked list. Only UNIQUE, PRIMARY KEY, EXCLUDE and FOREIGN KEY constraints can be deferrable — CHECK and NOT NULL cannot.</p>
<h4>3. NOT VALID + VALIDATE CONSTRAINT</h4>
<p>Adding a CHECK or FOREIGN KEY to a big table normally scans every row while holding a lock that blocks writes. Splitting it into two steps avoids the outage:</p>
<ol>
<li><code>ALTER TABLE ... ADD CONSTRAINT ... NOT VALID</code> — instant; enforced for all <em>new and updated</em> rows from now on, existing rows are not checked.</li>
<li><code>ALTER TABLE ... VALIDATE CONSTRAINT ...</code> — scans existing rows, but only takes a <code>SHARE UPDATE EXCLUSIVE</code> lock (CHECK) / <code>SHARE ROW EXCLUSIVE</code> on the referenced table (FK), so normal reads and writes continue.</li>
</ol>`,
  why: `<p>Overlap rules (bookings, price validity periods, employee assignments, IP ranges) cannot be expressed with UNIQUE and are notoriously race-prone in application code: two concurrent requests both check "no overlap" and both insert. An exclusion constraint makes the database the referee, correctly under concurrency. Deferrable constraints make legitimate multi-step changes possible without dropping constraints. NOT VALID/VALIDATE is the standard zero-downtime migration technique for constraints on large production tables.</p>`,
  useCase: `<p>A hotel chain with 400 properties stores 30M reservations. <code>EXCLUDE USING gist (room_id WITH =, stay WITH &amp;&amp;) WHERE (status &lt;&gt; 'cancelled')</code> guarantees no double booking even when two booking channels race for the last room — the second insert waits for the first transaction and then fails with an exclusion violation, which the API turns into "room no longer available". When the team later added <code>CHECK (amount &gt;= 0)</code> to the 900M-row payments table, they used NOT VALID + VALIDATE during business hours with no blocking.</p>`,
  internals: `<p>An exclusion constraint creates a GiST index; on insert, PostgreSQL searches the index for any existing row for which all operators return true; if one is found in a committed transaction the insert fails, if in an in-progress transaction it waits (like UNIQUE). Exclusion constraints cannot be targeted by <code>ON CONFLICT DO UPDATE</code> (only DO NOTHING). Deferred UNIQUE/PK checks record potentially conflicting rows and re-check them at commit; deferred FKs queue their trigger events until commit (memory grows with the number of pending events). <code>VALIDATE CONSTRAINT</code> sets <code>pg_constraint.convalidated = true</code> after a full scan; until then the planner cannot rely on the constraint (e.g. for partition pruning or join removal).</p>`,
  whenNot: `<p>Do not use deferrable UNIQUE constraints unless you need them: a deferrable unique index cannot be used as an <code>ON CONFLICT</code> arbiter and FKs cannot reference columns whose only uniqueness is deferrable. Exclusion constraints cost more per insert than B-tree uniqueness; for simple equality uniqueness use UNIQUE. NOT VALID constraints that you never validate leave a false sense of safety — old bad rows remain.</p>`,
  syntax: `CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (room_id WITH =, during WITH &&) [WHERE (status <> 'cancelled')];

PRIMARY KEY (room_id, during WITHOUT OVERLAPS)                       -- PG18+

CONSTRAINT c UNIQUE (pos) DEFERRABLE INITIALLY DEFERRED
SET CONSTRAINTS { ALL | name [, ...] } { DEFERRED | IMMEDIATE };

ALTER TABLE t ADD CONSTRAINT c CHECK (...) NOT VALID;
ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (x) REFERENCES p NOT VALID;
ALTER TABLE t VALIDATE CONSTRAINT c;`,
  examples: [
    { label: 'Basic', title: 'No overlapping meeting-room bookings with EXCLUDE + btree_gist',
      sql: `CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE room_bookings (
  id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id  int NOT NULL,
  booked_by int NOT NULL REFERENCES employees,
  during   tstzrange NOT NULL,
  CONSTRAINT room_bookings_no_overlap EXCLUDE USING gist (room_id WITH =, during WITH &&)
);

INSERT INTO room_bookings (room_id, booked_by, during) VALUES
  (1, 10, '[2025-10-06 10:00+05:30, 2025-10-06 11:00+05:30)'),
  (1, 11, '[2025-10-06 11:00+05:30, 2025-10-06 12:00+05:30)'),   -- back-to-back: OK
  (2, 12, '[2025-10-06 10:30+05:30, 2025-10-06 11:30+05:30)');   -- other room: OK

CREATE TEMP TABLE outcome (result text);
DO $$
BEGIN
  INSERT INTO room_bookings (room_id, booked_by, during)
  VALUES (1, 13, '[2025-10-06 10:30+05:30, 2025-10-06 11:15+05:30)');
EXCEPTION WHEN exclusion_violation THEN
  INSERT INTO outcome VALUES (SQLERRM);
END $$;

SELECT count(*) AS bookings FROM room_bookings;
SELECT * FROM outcome;`,
      explain: `<p><code>btree_gist</code> provides GiST support for <code>int =</code>, so it can be combined with the range overlap operator <code>&amp;&amp;</code> in one index. Half-open ranges <code>[start, end)</code> make 10:00-11:00 and 11:00-12:00 adjacent, not overlapping. Room 2's booking overlaps in time but not in room, so it is fine. The fourth booking overlaps 10:00-11:00 in room 1 and is rejected with an <code>exclusion_violation</code> (SQLSTATE 23P01) — even if two clients insert concurrently.</p>`,
      output: `CREATE EXTENSION
CREATE TABLE
INSERT 0 3
CREATE TABLE
DO

 bookings
----------
        3
(1 row)

 result
--------------------------------------------------------------------------------
 conflicting key value violates exclusion constraint "room_bookings_no_overlap"
(1 row)`, run: true },
    { label: 'Intermediate', title: 'DEFERRABLE: swap positions and insert circular references',
      sql: `CREATE TABLE playlist (
  song     text PRIMARY KEY,
  position int NOT NULL,
  CONSTRAINT playlist_position_uq UNIQUE (position) DEFERRABLE INITIALLY IMMEDIATE
);
INSERT INTO playlist VALUES ('Intro', 1), ('Theme', 2), ('Outro', 3);

-- Swap 1 and 2: impossible with an immediate check (the first UPDATE collides)
BEGIN;
SET CONSTRAINTS playlist_position_uq DEFERRED;
UPDATE playlist SET position = 2 WHERE song = 'Intro';
UPDATE playlist SET position = 1 WHERE song = 'Theme';
COMMIT;                                 -- checked here: all positions unique again
SELECT * FROM playlist ORDER BY position;

-- Circular FKs: two rows that reference each other
CREATE TABLE persons (id int PRIMARY KEY, partner_id int NOT NULL);
ALTER TABLE persons ADD CONSTRAINT persons_partner_fk FOREIGN KEY (partner_id)
  REFERENCES persons DEFERRABLE INITIALLY DEFERRED;
BEGIN;
INSERT INTO persons VALUES (1, 2);      -- 2 does not exist yet: allowed until COMMIT
INSERT INTO persons VALUES (2, 1);
COMMIT;
SELECT * FROM persons ORDER BY id;`,
      explain: `<p>With an immediate unique check, setting Intro to position 2 would collide with Theme. <code>SET CONSTRAINTS ... DEFERRED</code> postpones the check to COMMIT, by which time the swap is complete. (A single <code>UPDATE ... SET position = CASE ...</code> would also work for UNIQUE since the check happens at statement end for deferrable constraints, but multi-statement changes need deferral.) The second part inserts two rows that reference each other — impossible with an immediate FK, fine with <code>INITIALLY DEFERRED</code>.</p>`,
      output: `CREATE TABLE
INSERT 0 3
BEGIN
SET CONSTRAINTS
UPDATE 1
UPDATE 1
COMMIT

 song  | position
-------+----------
 Theme |        1
 Intro |        2
 Outro |        3
(3 rows)

CREATE TABLE
ALTER TABLE
BEGIN
INSERT 0 1
INSERT 0 1
COMMIT

 id | partner_id
----+------------
  1 |          2
  2 |          1
(2 rows)`, run: true },
    { label: 'Advanced', title: 'Zero-downtime constraint migration: NOT VALID then VALIDATE',
      sql: `-- Existing bad data that the new rule would reject
UPDATE orders SET total_amount = -1 WHERE id = 5;

-- Step 1: instant, enforced for new/updated rows only
ALTER TABLE orders ADD CONSTRAINT orders_total_nonneg_chk CHECK (total_amount >= 0) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payments_order_fk2 FOREIGN KEY (order_id) REFERENCES orders NOT VALID;

SELECT conname, convalidated FROM pg_constraint
WHERE conname IN ('orders_total_nonneg_chk', 'payments_order_fk2') ORDER BY conname;

-- Step 2: find and fix violations, then validate (scans without blocking writes)
SELECT id, total_amount FROM orders WHERE NOT (total_amount >= 0);
UPDATE orders SET total_amount = 0 WHERE total_amount < 0;
ALTER TABLE orders   VALIDATE CONSTRAINT orders_total_nonneg_chk;
ALTER TABLE payments VALIDATE CONSTRAINT payments_order_fk2;

SELECT conname, convalidated FROM pg_constraint
WHERE conname IN ('orders_total_nonneg_chk', 'payments_order_fk2') ORDER BY conname;`,
      explain: `<p>Adding the CHECK with <code>NOT VALID</code> succeeds although order 5 violates it — existing rows are not scanned, so it is instant and takes only a brief lock. From now on, every new or updated row is checked. We then locate and repair violators and run <code>VALIDATE CONSTRAINT</code>, which scans the table holding only a <code>SHARE UPDATE EXCLUSIVE</code> lock (reads and writes continue). <code>convalidated</code> flips to true. The same two-step pattern works for foreign keys.</p>`,
      output: `UPDATE 1
ALTER TABLE
ALTER TABLE

 conname                 | convalidated
-------------------------+--------------
 orders_total_nonneg_chk | f
 payments_order_fk2      | f
(2 rows)

 id | total_amount
----+--------------
  5 |        -1.00
(1 row)

UPDATE 1
ALTER TABLE
ALTER TABLE

 conname                 | convalidated
-------------------------+--------------
 orders_total_nonneg_chk | t
 payments_order_fk2      | t
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Application-side overlap check: racy under concurrency
CREATE TEMP TABLE bookings (room_id int, during tstzrange);
-- Session A and B both run this check at the same time and both see "no overlap"...
SELECT count(*) AS overlapping FROM bookings
WHERE room_id = 1 AND during && tstzrange('2025-10-06 10:00+00', '2025-10-06 11:00+00');
-- ...and both insert: a double booking
INSERT INTO bookings VALUES (1, tstzrange('2025-10-06 10:00+00', '2025-10-06 11:00+00'));
INSERT INTO bookings VALUES (1, tstzrange('2025-10-06 10:30+00', '2025-10-06 11:30+00'));
SELECT count(*) AS double_bookings FROM bookings;`, why: 'Check-then-insert is a race: without locking the whole table, two transactions can both pass the check. The table ends up with overlapping bookings.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TEMP TABLE bookings (
  room_id int, during tstzrange,
  EXCLUDE USING gist (room_id WITH =, during WITH &&)
);
INSERT INTO bookings VALUES (1, tstzrange('2025-10-06 10:00+00', '2025-10-06 11:00+00'));
-- a second overlapping insert now fails with exclusion_violation (23P01), even concurrently
SELECT count(*) AS bookings FROM bookings;`, why: 'The exclusion constraint makes the database arbitrate concurrent inserts: the loser waits for the winner and then gets a clean error to retry or report.', run: true }
  },
  mistakes: [
    `Forgetting <code>CREATE EXTENSION btree_gist</code> and getting "data type integer has no default operator class for access method gist".`,
    `Using closed ranges <code>[start, end]</code> so back-to-back bookings are considered overlapping.`,
    `Making a UNIQUE constraint deferrable without need — it can no longer serve as an ON CONFLICT arbiter.`,
    `Adding NOT VALID constraints and never running VALIDATE CONSTRAINT.`,
    `Running a plain <code>ADD CONSTRAINT ... FOREIGN KEY</code> on a 500M-row table at peak time, blocking writes for the whole validation.`,
    `Expecting CHECK or NOT NULL to be deferrable — only UNIQUE, PK, EXCLUDE and FK can be.`
  ],
  best: [
    `Use <code>tstzrange</code> with half-open bounds <code>[)</code> for bookings and validity periods.`,
    `Add a WHERE clause to exclusion constraints to ignore cancelled rows: <code>EXCLUDE ... WHERE (status &lt;&gt; 'cancelled')</code>.`,
    `On PG18, consider <code>PRIMARY KEY (id, valid_period WITHOUT OVERLAPS)</code> for temporal tables.`,
    `Prefer <code>DEFERRABLE INITIALLY IMMEDIATE</code> + explicit <code>SET CONSTRAINTS ... DEFERRED</code> in the few transactions that need it.`,
    `Always add constraints to large tables with NOT VALID, fix data, then VALIDATE; set a short <code>lock_timeout</code> for the ALTER.`
  ],
  performance: `<p>Exclusion checks cost a GiST index search per insert/update — more than a B-tree unique check, still milliseconds. GiST indexes are larger and slower to build than B-trees. Deferred constraints accumulate pending checks/trigger events in memory until commit; deferring FKs for a million-row transaction can use a lot of memory. <code>VALIDATE CONSTRAINT</code> does a full table scan (for FKs effectively an anti join between child and parent) — schedule it at low traffic, but it does not block normal DML.</p>`,
  security: `<p>Exclusion and unique errors confirm the existence of conflicting rows (e.g. someone else's booking). In public APIs map them to generic "not available" responses. <code>CREATE EXTENSION btree_gist</code> requires appropriate privileges (it is a trusted extension since PG13, so database owners with CREATE privilege can install it).</p>`,
  scenario: { title: 'Adding a foreign key to a 600M-row events table without an outage', steps: [
    '1. SET lock_timeout = \'2s\'; ALTER TABLE events ADD CONSTRAINT events_device_fk FOREIGN KEY (device_id) REFERENCES devices NOT VALID; (retry on timeout).',
    '2. Find orphans in batches: SELECT ... FROM events e WHERE NOT EXISTS (SELECT 1 FROM devices d WHERE d.id = e.device_id); fix or delete them.',
    '3. Ensure events(device_id) is indexed (CREATE INDEX CONCURRENTLY) for future parent deletes.',
    '4. ALTER TABLE events VALIDATE CONSTRAINT events_device_fk; at low traffic — writes continue meanwhile.',
    '5. Confirm pg_constraint.convalidated = true and document the migration.'
  ] },
  widgets: ['diagram:btree'],
  interview: [
    { q: 'How do you prevent overlapping bookings in PostgreSQL?', a: 'Use an exclusion constraint: EXCLUDE USING gist (room_id WITH =, during WITH &&), with the btree_gist extension for the scalar equality. It is enforced by a GiST index and is safe under concurrency. On PG18, PRIMARY KEY (room_id, during WITHOUT OVERLAPS) expresses the same.' },
    { q: 'What does DEFERRABLE INITIALLY DEFERRED do?', a: 'The constraint is checked at COMMIT instead of after each statement, allowing intermediate violations within the transaction, such as swapping unique values or inserting mutually referencing rows. Only UNIQUE, PRIMARY KEY, EXCLUDE and FOREIGN KEY constraints can be deferrable.' },
    { q: 'How do you add a CHECK or FK constraint to a huge table without blocking writes?', a: 'ADD CONSTRAINT ... NOT VALID (fast, enforces new rows), clean up existing violations, then ALTER TABLE ... VALIDATE CONSTRAINT, which scans the table under a lock that allows concurrent reads and writes.' },
    { q: 'Why might you avoid making a UNIQUE constraint deferrable?', a: 'Deferrable unique indexes cannot be used as ON CONFLICT arbiters and cannot be referenced by foreign keys, and deferred checks add commit-time work. Use it only when you need temporary duplicates inside a transaction.' }
  ],
  exercises: [
    { task: 'Create a product_prices table where each product can have only one price per non-overlapping validity period (daterange), using EXCLUDE; insert two adjacent periods and verify the count.', solution: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE product_prices (
  product_id int NOT NULL REFERENCES products,
  valid      daterange NOT NULL,
  price      numeric(10,2) NOT NULL CHECK (price > 0),
  EXCLUDE USING gist (product_id WITH =, valid WITH &&)
);
INSERT INTO product_prices VALUES
  (1, '[2025-01-01, 2025-07-01)', 5000),
  (1, '[2025-07-01, 2026-01-01)', 5200);
SELECT product_id, valid, price FROM product_prices ORDER BY valid;`, run: true },
    { task: 'Add CHECK (stock >= 0) to products as NOT VALID, show convalidated, validate it, and show it again.', solution: `ALTER TABLE products ADD CONSTRAINT products_stock_chk CHECK (stock >= 0) NOT VALID;
SELECT conname, convalidated FROM pg_constraint WHERE conname = 'products_stock_chk';
ALTER TABLE products VALIDATE CONSTRAINT products_stock_chk;
SELECT conname, convalidated FROM pg_constraint WHERE conname = 'products_stock_chk';`, run: true }
  ],
  challenge: { task: 'Prevent an employee from being allocated to overlapping project assignments: create assignments(employee_id, project_id, period daterange) with an EXCLUDE constraint that only applies to rows with status \'active\', and show that a cancelled overlapping row is accepted while an active one is rejected.', hint: 'EXCLUDE USING gist (employee_id WITH =, period WITH &&) WHERE (status = \'active\'). Capture the rejection in a DO block.', solution: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE assignments (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id int NOT NULL REFERENCES employees,
  project_id  int NOT NULL REFERENCES projects,
  period      daterange NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT assignments_no_overlap EXCLUDE USING gist (employee_id WITH =, period WITH &&)
    WHERE (status = 'active')
);
INSERT INTO assignments (employee_id, project_id, period) VALUES (20, 1, '[2025-01-01, 2025-06-30)');
INSERT INTO assignments (employee_id, project_id, period, status) VALUES (20, 2, '[2025-03-01, 2025-04-01)', 'cancelled');
CREATE TEMP TABLE outcome (result text);
DO $$
BEGIN
  INSERT INTO assignments (employee_id, project_id, period) VALUES (20, 3, '[2025-05-01, 2025-08-01)');
EXCEPTION WHEN exclusion_violation THEN
  INSERT INTO outcome VALUES (SQLERRM);
END $$;
SELECT (SELECT count(*) FROM assignments) AS rows_stored, (SELECT result FROM outcome) AS rejected;`, run: true },
  related: ['constraints-basic', 'constraints-keys', 'transactions-acid', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Why is btree_gist needed for EXCLUDE USING gist (room_id WITH =, during WITH &&)?', options: ['To support the && operator', 'Core GiST has no operator class for = on plain scalar types like int', 'To make it deferrable', 'It is not needed'], answer: 1, explain: 'Range types have GiST support in core; int equality needs btree_gist.' },
    { type: 'tf', q: 'A CHECK constraint can be declared DEFERRABLE.', answer: false, explain: 'Only UNIQUE, PRIMARY KEY, EXCLUDE and FOREIGN KEY constraints are deferrable.' },
    { type: 'predict', q: 'After ADD CONSTRAINT c CHECK (x > 0) NOT VALID on a table containing x = -5, what happens?', options: ['ALTER fails', 'ALTER succeeds; the -5 row stays; new rows must satisfy x > 0', 'The -5 row is deleted', 'The constraint is ignored entirely'], answer: 1, explain: 'NOT VALID skips existing rows but enforces the rule for new/updated rows.' },
    { type: 'scenario', q: 'Two booking requests for the same room and time arrive simultaneously. With an exclusion constraint, what happens?', options: ['Both succeed', 'The second waits for the first transaction, then fails with exclusion_violation if the first commits', 'Deadlock', 'Both fail'], answer: 1, explain: 'Exclusion constraints wait on in-progress conflicting rows, like unique constraints.' }
  ]
}
]);
