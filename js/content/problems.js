/* =====================================================================
   PostgreSQL Mastery — SQL practice problems + pattern library
   PGM.PROBLEMS : 36 LeetCode-style problems (12 Easy / 12 Medium / 12 Hard)
   PGM.PATTERNS : ready-to-use SQL recipes on company_db
   All solutions run against company_db (PostgreSQL 18 / PGlite).
   ===================================================================== */
window.PGM = window.PGM || {};

PGM.PROBLEMS = [

/* ============================== EASY ============================== */
{
  id: 'p01-active-high-earners',
  title: 'Active High Earners (excluding Heads)',
  difficulty: 'Easy',
  topic: 'SELECT',
  statement: `<p>HR wants a list of <strong>active</strong> individual contributors and team members (i.e. everyone who is <em>not</em> a department head) earning <strong>more than 130,000</strong>.</p>
<p>Return <code>id</code>, <code>employee</code> (first + last name), <code>department</code> name, <code>job_title</code> and <code>salary</code>. Order by salary descending, then by id.</p>`,
  schema: `employees(id, first_name, last_name, department_id, manager_id, job_title, salary, is_active)
departments(id, name)
-- department heads are the rows with manager_id IS NULL`,
  sampleData: `employees
 id | first_name | last_name | department_id | manager_id | job_title          | salary    | is_active
----+------------+-----------+---------------+------------+--------------------+-----------+----------
  1 | Asha       | Rao       | 1             |            | Head of Department | 187500.00 | t
  9 | Myra       | Patel     | 2             | 2          | Associate          | 121700.00 | t
 12 | Ishaan     | Chopra    | 5             | 5          | Engineer           | 122900.00 | t`,
  expected: `@@OUT p01`,
  hint: 'Filter on three conditions in WHERE: is_active, manager_id IS NOT NULL, salary &gt; 130000. Join departments for the name.',
  solution: `SELECT e.id,
       e.first_name || ' ' || e.last_name AS employee,
       d.name                             AS department,
       e.job_title,
       e.salary
FROM employees e
JOIN departments d ON d.id = e.department_id
WHERE e.is_active
  AND e.manager_id IS NOT NULL
  AND e.salary > 130000
ORDER BY e.salary DESC, e.id;`,
  optimized: `-- A partial index matching the exact predicate the report always uses.
-- It stays tiny (only active, well-paid rows) and returns rows pre-sorted.
CREATE INDEX idx_emp_active_salary ON employees (salary DESC, id)
  WHERE is_active AND manager_id IS NOT NULL;

SELECT e.id,
       e.first_name || ' ' || e.last_name AS employee,
       d.name                             AS department,
       e.job_title,
       e.salary
FROM employees e
JOIN departments d ON d.id = e.department_id
WHERE e.is_active
  AND e.manager_id IS NOT NULL
  AND e.salary > 130000
ORDER BY e.salary DESC, e.id;`,
  explanation: `<p><strong>Approach.</strong> This is a straight filter + join. Every condition is <em>sargable</em> (it compares a bare column to a constant), so the planner can use an index if one exists.</p>
<ul>
<li><code>e.is_active</code> is a boolean, so <code>WHERE e.is_active</code> is the same as <code>= true</code>.</li>
<li><code>manager_id IS NOT NULL</code> removes the 8 department heads. Never write <code>manager_id &lt;&gt; NULL</code> — that is always NULL (unknown) and returns zero rows.</li>
<li>The tie-breaker <code>e.id</code> in ORDER BY makes the output deterministic when two salaries are equal.</li>
</ul>
<p><strong>Complexity.</strong> On 200 rows a sequential scan is optimal (O(n)). On a 5M-row HR table the <strong>partial index</strong> in the optimized version holds only the qualifying rows, already sorted by <code>salary DESC</code>, so PostgreSQL does an Index Scan + early stop with no Sort node.</p>
<div class="callout tip">Partial indexes are only used when the query's WHERE clause <em>implies</em> the index predicate. Keep the predicate literally identical in the app's query.</div>`
},

{
  id: 'p02-department-headcount',
  title: 'Headcount per Department (including empty ones)',
  difficulty: 'Easy',
  topic: 'GROUP BY',
  statement: `<p>For <strong>every</strong> department — even one with no active staff — return the department <code>name</code>, the number of <strong>active</strong> employees (<code>headcount</code>) and their average salary rounded to 2 decimals (<code>avg_salary</code>).</p>
<p>Order by headcount descending, then department name.</p>`,
  schema: `departments(id, name)
employees(id, department_id, salary, is_active)`,
  sampleData: `departments: (1,'Engineering'), (2,'Sales'), ...
employees:   (1, department_id 1, 187500.00, t), (9, department_id 2, 121700.00, t), ...`,
  expected: `@@OUT p02`,
  hint: 'Start FROM departments and LEFT JOIN employees. Put the is_active filter in the ON clause, not in WHERE, and count a column from the right-hand table.',
  solution: `SELECT d.name                    AS department,
       count(e.id)               AS headcount,
       round(avg(e.salary), 2)   AS avg_salary
FROM departments d
LEFT JOIN employees e
       ON e.department_id = d.id
      AND e.is_active
GROUP BY d.id, d.name
ORDER BY headcount DESC, d.name;`,
  explanation: `<p><strong>Two classic traps</strong> are avoided here:</p>
<ol>
<li><strong>count(*) vs count(e.id)</strong> — with a LEFT JOIN, an empty department still produces one row whose <code>e.*</code> columns are NULL. <code>count(*)</code> would report 1; <code>count(e.id)</code> ignores NULLs and correctly reports 0.</li>
<li><strong>Filter placement</strong> — writing <code>WHERE e.is_active</code> would discard the NULL-extended row and silently turn the LEFT JOIN into an INNER JOIN. Putting the condition in <code>ON</code> filters the right side <em>before</em> the outer join pads it.</li>
</ol>
<p>Grouping by <code>d.id, d.name</code> is safe; since <code>d.id</code> is the primary key, PostgreSQL would even let you write <code>GROUP BY d.id</code> alone (functional dependency).</p>
<p><strong>Complexity.</strong> One hash join + one hash aggregate: O(departments + employees). The existing <code>idx_employees_department</code> index helps only when you filter a single department.</p>`
},

{
  id: 'p03-inactive-customers',
  title: 'Customers with No Orders in Q3 2025',
  difficulty: 'Easy',
  topic: 'Subqueries',
  statement: `<p>Marketing wants to win back customers who placed <strong>no order at all</strong> between <strong>1 July 2025</strong> (inclusive) and <strong>1 October 2025</strong> (exclusive).</p>
<p>Return <code>id</code>, <code>name</code>, <code>country</code>, <code>segment</code>, ordered by id.</p>`,
  schema: `customers(id, name, country, segment)
orders(id, customer_id, order_date timestamptz)`,
  sampleData: `customers: (1,'Customer 1','India','consumer'), (2,'Customer 2','India','smb'), ...
orders:    (1, customer_id 417, '2024-03-03 ...'), ...`,
  expected: `@@OUT p03`,
  hint: 'Use NOT EXISTS with a correlated subquery that also carries the date range. Avoid NOT IN on a nullable column.',
  solution: `SELECT c.id, c.name, c.country, c.segment
FROM customers c
WHERE NOT EXISTS (
  SELECT 1
  FROM orders o
  WHERE o.customer_id = c.id
    AND o.order_date >= DATE '2025-07-01'
    AND o.order_date <  DATE '2025-10-01'
)
ORDER BY c.id;`,
  optimized: `-- orders(customer_id) is deliberately NOT indexed in company_db.
-- A composite index turns every probe into a tiny index range scan.
CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date);

SELECT c.id, c.name, c.country, c.segment
FROM customers c
WHERE NOT EXISTS (
  SELECT 1
  FROM orders o
  WHERE o.customer_id = c.id
    AND o.order_date >= DATE '2025-07-01'
    AND o.order_date <  DATE '2025-10-01'
)
ORDER BY c.id;`,
  explanation: `<p><strong>Approach: anti-join.</strong> PostgreSQL plans <code>NOT EXISTS</code> as a <em>Hash Anti Join</em> (or Nested Loop Anti Join with an index): for each customer it only needs to know whether <em>one</em> matching order exists, then stops.</p>
<ul>
<li><strong>Why not NOT IN?</strong> <code>WHERE c.id NOT IN (SELECT customer_id ...)</code> returns <em>no rows at all</em> if the subquery yields a single NULL, and it cannot always be converted to an anti-join, so it can degrade to O(n·m).</li>
<li><strong>Half-open date range</strong> <code>&gt;= start AND &lt; next_start</code> is correct for timestamps; <code>BETWEEN '2025-07-01' AND '2025-09-30'</code> would miss everything after midnight on 30 September.</li>
</ul>
<p><strong>Optimized.</strong> With <code>(customer_id, order_date)</code> the inner probe becomes an index-only range scan: equality on the leading column, range on the second — exactly the order a B-tree wants. On 500 customers the hash anti join is already fine; on 50M orders the index is the difference between seconds and milliseconds.</p>`
},

{
  id: 'p04-second-highest-salary',
  title: 'Second Highest Salary',
  difficulty: 'Easy',
  topic: 'Subqueries',
  statement: `<p>Return the <strong>second highest distinct salary</strong> in the company as a single column <code>second_highest_salary</code>. If there is no second distinct salary the query must return <strong>one row containing NULL</strong> (not zero rows).</p>`,
  schema: `employees(id, salary)`,
  sampleData: `salary: 240000.00, 232500.00, 225000.00, 225000.00, ...`,
  expected: `@@OUT p04`,
  hint: 'The highest salary that is strictly lower than max(salary). An aggregate over zero rows returns one NULL row.',
  solution: `SELECT max(salary) AS second_highest_salary
FROM employees
WHERE salary < (SELECT max(salary) FROM employees);`,
  optimized: `-- With a B-tree on salary both max() lookups become one-page index probes
-- (PostgreSQL rewrites max(col) into ORDER BY col DESC LIMIT 1).
CREATE INDEX idx_employees_salary ON employees (salary);

SELECT (SELECT DISTINCT salary
        FROM employees
        ORDER BY salary DESC
        OFFSET 1 LIMIT 1) AS second_highest_salary;`,
  explanation: `<p><strong>Why the NULL requirement matters.</strong> An aggregate without GROUP BY always returns exactly one row, so <code>max()</code> over an empty set yields <code>NULL</code>. A plain <code>ORDER BY ... OFFSET 1 LIMIT 1</code> would return <em>zero rows</em>, which breaks callers expecting a scalar; wrapping it in a scalar subquery (<code>SELECT (subquery)</code>) restores the single NULL row.</p>
<ul>
<li><strong>DISTINCT is essential</strong>: if two people share the top salary, the "second row" is still the top salary.</li>
<li>Alternative: <code>dense_rank() OVER (ORDER BY salary DESC) = 2</code> — generalises to the Nth salary but scans and sorts all rows.</li>
</ul>
<p><strong>Complexity.</strong> Without an index: two sequential scans, O(n). With <code>idx_employees_salary</code>, PostgreSQL answers <code>max(salary)</code> with an <em>Index Only Scan Backward ... LIMIT 1</em> — O(log n).</p>`
},

{
  id: 'p05-employee-manager',
  title: 'Employees and Their Managers',
  difficulty: 'Easy',
  topic: 'JOIN',
  statement: `<p>For the <strong>Support</strong> department (<code>department_id = 7</code>), list every employee with the full name of their direct manager. The department head has no manager — show <code>(no manager)</code> for them.</p>
<p>Return <code>id</code>, <code>employee</code>, <code>job_title</code>, <code>manager</code>. Head first, then by manager id, then employee id.</p>`,
  schema: `employees(id, first_name, last_name, department_id, manager_id → employees.id, job_title)`,
  sampleData: `  7 | Kavya  | Reddy | 7 | NULL | Head of Department
 22 | ...    | ...   | 7 | 7    | ...`,
  expected: `@@OUT p05`,
  hint: 'Self-join employees to itself with two aliases. Use LEFT JOIN so the head (manager_id NULL) is kept, and COALESCE for the label.',
  solution: `SELECT e.id,
       e.first_name || ' ' || e.last_name                         AS employee,
       e.job_title,
       COALESCE(m.first_name || ' ' || m.last_name, '(no manager)') AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id
WHERE e.department_id = 7
ORDER BY e.manager_id NULLS FIRST, e.id;`,
  explanation: `<p><strong>Self-join.</strong> The same table plays two roles: <code>e</code> (the employee) and <code>m</code> (the manager). The join key is the foreign key <code>e.manager_id → m.id</code>.</p>
<ul>
<li>An <strong>INNER JOIN</strong> would drop the head, because there is no row with <code>id = NULL</code>.</li>
<li><code>first_name || ' ' || last_name</code> yields NULL when <code>m</code> is NULL-extended, so <code>COALESCE</code> supplies the label.</li>
<li><code>NULLS FIRST</code> puts the head at the top (ascending order defaults to NULLS LAST in PostgreSQL).</li>
</ul>
<p><strong>Complexity.</strong> The <code>department_id = 7</code> filter uses <code>idx_employees_department</code>; the manager lookup is a primary-key probe per row — O(k log n) for k Support employees.</p>`
},

{
  id: 'p06-order-status-share',
  title: 'Order Status Distribution with Percentages',
  difficulty: 'Easy',
  topic: 'GROUP BY',
  statement: `<p>Return each order <code>status</code>, the number of <code>orders</code> in it and its percentage of all orders (<code>pct</code>, 2 decimals). Order by orders descending.</p>`,
  schema: `orders(id, status)   -- pending | paid | shipped | delivered | cancelled`,
  sampleData: `(1,'shipped'), (2,'shipped'), (3,'cancelled'), (4,'paid'), ...`,
  expected: `@@OUT p06`,
  hint: 'GROUP BY status, then divide count(*) by a window sum over the grouped rows: sum(count(*)) OVER ().',
  solution: `SELECT status,
       count(*) AS orders,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct
FROM orders
GROUP BY status
ORDER BY orders DESC;`,
  explanation: `<p><strong>Window over an aggregate.</strong> Window functions run <em>after</em> GROUP BY, so <code>sum(count(*)) OVER ()</code> adds up the per-status counts across all groups — the grand total — without a second scan or a subquery.</p>
<ul>
<li><code>100.0</code> (numeric) avoids integer division: <code>100 * 3 / 7</code> on integers is 42, not 42.86.</li>
<li>Equivalent but slower to read: <code>count(*) * 100.0 / (SELECT count(*) FROM orders)</code> — that scans the table twice.</li>
</ul>
<p><strong>Complexity.</strong> One sequential scan + HashAggregate on 5 groups; the window step is trivial (5 rows).</p>`
},

{
  id: 'p07-top-products-revenue',
  title: 'Top 5 Products by Revenue',
  difficulty: 'Easy',
  topic: 'JOIN',
  statement: `<p>Find the 5 products with the highest revenue (<code>quantity * unit_price</code>) from orders that were <strong>not cancelled</strong>.</p>
<p>Return <code>sku</code>, <code>name</code>, <code>category</code>, <code>revenue</code>.</p>`,
  schema: `products(id, sku, name, category)
orders(id, status)
order_items(order_id, product_id, quantity, unit_price)`,
  sampleData: `order_items: (order 1, product 21, qty 3, 55112.83), (order 1, product 28, qty 3, 46797.20), ...`,
  expected: `@@OUT p07`,
  hint: 'Join three tables, filter status, GROUP BY the product, ORDER BY revenue DESC LIMIT 5.',
  solution: `SELECT p.sku, p.name, p.category,
       sum(oi.quantity * oi.unit_price) AS revenue
FROM order_items oi
JOIN orders   o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE o.status <> 'cancelled'
GROUP BY p.id, p.sku, p.name, p.category
ORDER BY revenue DESC, p.id
LIMIT 5;`,
  optimized: `-- Aggregate the big fact table first (12.5k rows -> 100 rows),
-- then join the small dimension. Same result, less data flowing through joins.
WITH rev AS (
  SELECT oi.product_id, sum(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY oi.product_id
  ORDER BY revenue DESC, oi.product_id
  LIMIT 5
)
SELECT p.sku, p.name, p.category, r.revenue
FROM rev r
JOIN products p ON p.id = r.product_id
ORDER BY r.revenue DESC, p.id;`,
  explanation: `<p><strong>Approach.</strong> Revenue lives in <code>order_items</code>; the status lives in <code>orders</code>; the label lives in <code>products</code>. Join, filter, aggregate, sort, limit.</p>
<p><strong>Why the optimized version is better.</strong> It applies <em>aggregate-then-join</em>: grouping 12.5k line items down to 100 product totals and keeping only 5 before touching <code>products</code>. The planner sometimes does this automatically, but writing it explicitly guarantees the wide product columns (name, category) are carried for 5 rows instead of thousands. The <code>LIMIT</code> inside the CTE lets PostgreSQL use a <em>top-N heapsort</em> (memory O(5)).</p>
<div class="callout warn">Always add a unique tie-breaker (<code>p.id</code>) before LIMIT; otherwise two products with identical revenue can swap places between runs.</div>`
},

{
  id: 'p08-duplicate-names',
  title: 'Employees Sharing the Same Name',
  difficulty: 'Easy',
  topic: 'Deduplication',
  statement: `<p>Find every (<code>first_name</code>, <code>last_name</code>) combination used by more than one employee. Return the names, the count <code>cnt</code>, and the sorted list of employee <code>ids</code>.</p>
<p>Order by count descending, then first and last name.</p>`,
  schema: `employees(id, first_name, last_name)`,
  sampleData: `(9,'Myra','Patel'), (..,'Myra','Patel'), (10,'Sai','Malhotra'), ...`,
  expected: `@@OUT p08`,
  hint: 'GROUP BY both name columns and filter groups with HAVING count(*) &gt; 1. array_agg(id ORDER BY id) collects the ids.',
  solution: `SELECT first_name, last_name,
       count(*)                  AS cnt,
       array_agg(id ORDER BY id) AS ids
FROM employees
GROUP BY first_name, last_name
HAVING count(*) > 1
ORDER BY cnt DESC, first_name, last_name;`,
  explanation: `<p><strong>WHERE vs HAVING.</strong> <code>WHERE</code> filters rows <em>before</em> grouping, <code>HAVING</code> filters groups <em>after</em> aggregation — so a condition on <code>count(*)</code> must go in HAVING.</p>
<ul>
<li><code>array_agg(id ORDER BY id)</code> gives a stable, readable list of the duplicates — handy as input to a merge/cleanup script.</li>
<li>For case-/space-insensitive matching group by <code>lower(trim(first_name))</code> instead.</li>
</ul>
<p><strong>Complexity.</strong> One scan + HashAggregate, O(n). A composite index on <code>(first_name, last_name)</code> would allow a GroupAggregate without sorting, which matters only at millions of rows.</p>`
},

{
  id: 'p09-segment-mix-by-country',
  title: 'Customer Segment Mix by Country',
  difficulty: 'Easy',
  topic: 'Complex reporting',
  statement: `<p>Build a one-row-per-country report: total <code>customers</code> and how many are <code>consumer</code>, <code>smb</code> and <code>enterprise</code> (one column each), plus <code>enterprise_pct</code> (1 decimal).</p>
<p>Order by customers descending, then country.</p>`,
  schema: `customers(id, country, segment)   -- segment: consumer | smb | enterprise`,
  sampleData: `(1,'India','consumer'), (2,'India','smb'), (3,'USA','enterprise'), ...`,
  expected: `@@OUT p09`,
  hint: 'Conditional aggregation: count(*) FILTER (WHERE segment = ...) produces one column per segment in a single pass.',
  solution: `SELECT country,
       count(*)                                            AS customers,
       count(*) FILTER (WHERE segment = 'consumer')        AS consumer,
       count(*) FILTER (WHERE segment = 'smb')             AS smb,
       count(*) FILTER (WHERE segment = 'enterprise')      AS enterprise,
       round(100.0 * count(*) FILTER (WHERE segment = 'enterprise')
             / count(*), 1)                                AS enterprise_pct
FROM customers
GROUP BY country
ORDER BY customers DESC, country;`,
  explanation: `<p><strong>Pivot with FILTER.</strong> The SQL-standard <code>FILTER (WHERE ...)</code> clause restricts which rows feed one particular aggregate. The table is scanned once and every segment column is filled in the same pass.</p>
<ul>
<li>Portable equivalent: <code>sum(CASE WHEN segment = 'smb' THEN 1 ELSE 0 END)</code> — works everywhere but is noisier.</li>
<li>Do <strong>not</strong> write three separate queries and join them; that triples the scans.</li>
</ul>
<p><strong>Complexity.</strong> O(n) single scan, 6 groups. An index on <code>customers(country)</code> would not help — every row is read anyway.</p>`
},

{
  id: 'p10-monthly-orders-2025',
  title: 'Monthly Orders and Revenue in 2025',
  difficulty: 'Easy',
  topic: 'GROUP BY',
  statement: `<p>For each month of 2025 return <code>month</code> (formatted <code>YYYY-MM</code>), number of <code>orders</code> (all statuses) and <code>revenue</code> = sum of <code>total_amount</code> for orders that are not cancelled.</p>`,
  schema: `orders(id, status, order_date timestamptz, total_amount)`,
  sampleData: `(1,'shipped','2024-03-03 ...',305730.09), (3,'cancelled','2025-03-14 ...',406916.91), ...`,
  expected: `@@OUT p10`,
  hint: 'Bucket with date_trunc(\'month\', order_date). Use a sargable half-open range on order_date for the year filter, and FILTER for the revenue condition.',
  solution: `SELECT to_char(date_trunc('month', order_date), 'YYYY-MM')        AS month,
       count(*)                                                     AS orders,
       sum(total_amount) FILTER (WHERE status <> 'cancelled')       AS revenue
FROM orders
WHERE order_date >= DATE '2025-01-01'
  AND order_date <  DATE '2026-01-01'
GROUP BY 1
ORDER BY 1;`,
  optimized: `-- orders(order_date) is deliberately missing in company_db.
-- With it, the year filter becomes an index range scan instead of a full scan.
CREATE INDEX idx_orders_order_date ON orders (order_date);

SELECT to_char(date_trunc('month', order_date), 'YYYY-MM')        AS month,
       count(*)                                                     AS orders,
       sum(total_amount) FILTER (WHERE status <> 'cancelled')       AS revenue
FROM orders
WHERE order_date >= DATE '2025-01-01'
  AND order_date <  DATE '2026-01-01'
GROUP BY 1
ORDER BY 1;`,
  explanation: `<p><strong>Sargable filter.</strong> The year filter compares the <em>bare column</em> to constants. Writing <code>WHERE extract(year FROM order_date) = 2025</code> gives the same rows but wraps the column in a function, so a plain index on <code>order_date</code> can never be used.</p>
<ul>
<li><code>GROUP BY 1</code> / <code>ORDER BY 1</code> refer to the first select-list expression. Because the label is <code>YYYY-MM</code>, text order equals chronological order.</li>
<li><code>date_trunc</code> on a <code>timestamptz</code> truncates in the session <code>TimeZone</code>; reports for a fixed business zone should use <code>date_trunc('month', order_date, 'Asia/Kolkata')</code> (PostgreSQL 12+).</li>
</ul>
<p><strong>Complexity.</strong> Full scan O(n) without the index; with it an index range scan reads only the ~40% of rows in 2025. On a multi-year table that ratio is what makes the index worthwhile.</p>`
},

{
  id: 'p11-sale-tagged-products',
  title: 'Affordable Products Tagged "sale"',
  difficulty: 'Easy',
  topic: 'SELECT',
  statement: `<p>List products whose <code>tags</code> array contains <code>'sale'</code> and whose <code>price</code> is below 20,000. Return <code>sku</code>, <code>name</code>, <code>category</code>, <code>price</code>, <code>tags</code>, cheapest first.</p>`,
  schema: `products(id, sku, name, category, price, tags text[])`,
  sampleData: `(2,'SKU-0002','Keyboard Max 2','accessories',55051.52,{office,sale})
(3,'SKU-0003','Mouse Lite 3','accessories',27311.98,{bestseller,office})`,
  expected: `@@OUT p11`,
  hint: '\'sale\' = ANY(tags) tests membership. The containment operator tags @&gt; ARRAY[\'sale\'] does the same and can use a GIN index.',
  solution: `SELECT sku, name, category, price, tags
FROM products
WHERE 'sale' = ANY (tags)
  AND price < 20000
ORDER BY price, sku;`,
  optimized: `-- = ANY() cannot use a GIN index; the containment operator @> can.
CREATE INDEX idx_products_tags ON products USING gin (tags);

SELECT sku, name, category, price, tags
FROM products
WHERE tags @> ARRAY['sale']
  AND price < 20000
ORDER BY price, sku;`,
  explanation: `<p><strong>Array membership.</strong> <code>'x' = ANY(arr)</code> is evaluated row by row — simple and correct, but no index can serve it. The containment operator <code>@&gt;</code> ("left array contains right array") is supported by the default GIN operator class <code>array_ops</code>.</p>
<ul>
<li>GIN stores one entry per distinct tag pointing at all rows that have it — perfect for "find rows having tag X".</li>
<li>Use <code>&amp;&amp;</code> (overlap) for "any of these tags", <code>@&gt;</code> for "all of these tags".</li>
</ul>
<p><strong>Complexity.</strong> 100 products: seq scan wins. 10M products: GIN Bitmap Index Scan + recheck on <code>price</code>. If tags are queried far more than updated, GIN is ideal; for write-heavy tables consider <code>fastupdate</code> tuning.</p>`
},

{
  id: 'p12-veteran-tenure',
  title: 'Tenure of Veteran Employees',
  difficulty: 'Easy',
  topic: 'Date calculations',
  statement: `<p>For non-head employees hired <strong>before 2018</strong>, compute their tenure as of <strong>2026-01-01</strong> as whole <code>years</code> and remaining <code>months</code>, plus total <code>days</code> employed.</p>
<p>Return <code>id</code>, <code>employee</code>, <code>hire_date</code>, <code>years</code>, <code>months</code>, <code>days</code>, longest-serving first (then id).</p>`,
  schema: `employees(id, first_name, last_name, manager_id, hire_date date)`,
  sampleData: `(10,'Sai','Malhotra', manager 3, '2016-11-26')`,
  expected: `@@OUT p12`,
  hint: 'age(later, earlier) returns an interval like "9 years 1 mon 6 days"; extract(year ...) / extract(month ...) read its fields. date - date returns an integer number of days.',
  solution: `SELECT id,
       first_name || ' ' || last_name                          AS employee,
       hire_date,
       extract(year  FROM age(DATE '2026-01-01', hire_date))::int AS years,
       extract(month FROM age(DATE '2026-01-01', hire_date))::int AS months,
       DATE '2026-01-01' - hire_date                            AS days
FROM employees
WHERE manager_id IS NOT NULL
  AND hire_date < DATE '2018-01-01'
ORDER BY hire_date, id;`,
  explanation: `<p><strong>Date arithmetic in PostgreSQL.</strong></p>
<ul>
<li><code>date - date</code> → <code>integer</code> days. Exact and cheap.</li>
<li><code>age(a, b)</code> → a "symbolic" <code>interval</code> in years/months/days, calendar-aware (it knows February is short). That is what humans mean by "9 years and 1 month".</li>
<li><code>extract(field FROM interval)</code> reads one field; it does <em>not</em> convert the whole interval (months of an interval of 14 months is 2, years is 1).</li>
</ul>
<p>Using a fixed reference date instead of <code>current_date</code> keeps the report reproducible; in production you would pass the report date as a parameter.</p>
<div class="callout warn">Do not compute years as <code>(date2 - date1) / 365</code>: leap years make it drift by a day every four years, which breaks anniversary/benefit eligibility logic.</div>`
},

/* ============================== MEDIUM ============================== */
{
  id: 'p13-top-earner-per-department',
  title: 'Top Earner per Department (with Ties)',
  difficulty: 'Medium',
  topic: 'Window functions',
  statement: `<p>Excluding department heads, find the highest-paid employee(s) in every department. If two people tie for the top salary, return <strong>both</strong>.</p>
<p>Return <code>department</code>, <code>employee</code>, <code>salary</code>, ordered by department then employee.</p>`,
  schema: `employees(id, first_name, last_name, department_id, manager_id, salary)
departments(id, name)`,
  sampleData: `(9,'Myra','Patel', dept 2, 121700.00), (10,'Sai','Malhotra', dept 3, 47100.00), ...`,
  expected: `@@OUT p13`,
  hint: 'rank() OVER (PARTITION BY department_id ORDER BY salary DESC) gives every tied top earner rank 1. Filter rank = 1 in an outer query.',
  solution: `SELECT department, employee, salary
FROM (
  SELECT d.name                             AS department,
         e.first_name || ' ' || e.last_name AS employee,
         e.salary,
         rank() OVER (PARTITION BY e.department_id
                      ORDER BY e.salary DESC) AS rnk
  FROM employees e
  JOIN departments d ON d.id = e.department_id
  WHERE e.manager_id IS NOT NULL
) ranked
WHERE rnk = 1
ORDER BY department, employee;`,
  optimized: `-- Index lets each department's max(salary) be read from the top of
-- one index range instead of sorting the whole partition.
CREATE INDEX idx_emp_dept_salary ON employees (department_id, salary DESC)
  WHERE manager_id IS NOT NULL;

SELECT d.name                             AS department,
       e.first_name || ' ' || e.last_name AS employee,
       e.salary
FROM departments d
JOIN employees e ON e.department_id = d.id
WHERE e.manager_id IS NOT NULL
  AND e.salary = (SELECT max(x.salary)
                  FROM employees x
                  WHERE x.department_id = d.id
                    AND x.manager_id IS NOT NULL)
ORDER BY department, employee;`,
  explanation: `<p><strong>rank vs row_number vs dense_rank.</strong></p>
<table><tr><th>Function</th><th>Ties at top</th><th>Use when</th></tr>
<tr><td><code>row_number()</code></td><td>arbitrary single winner</td><td>exactly one row per group</td></tr>
<tr><td><code>rank()</code></td><td>all tied rows get 1, next is 3</td><td>"top earner(s)" — this problem</td></tr>
<tr><td><code>dense_rank()</code></td><td>all tied get 1, next is 2</td><td>"top 3 distinct salaries"</td></tr></table>
<p>Window functions cannot appear in WHERE (they are computed after WHERE), hence the derived table.</p>
<p><strong>Optimized.</strong> The window version sorts every partition: O(n log n). With the partial composite index, each correlated <code>max()</code> is a single index descent (O(log n) per department), and the outer equality probe reuses the same index. With 8 departments × millions of employees that is dramatically cheaper. <code>DISTINCT ON (department_id)</code> is even shorter but returns only <em>one</em> row per group — wrong here because ties must be kept.</p>`
},

{
  id: 'p14-running-total-september',
  title: 'Daily Revenue Running Total (Sept 2025)',
  difficulty: 'Medium',
  topic: 'Running totals',
  statement: `<p>For each day of <strong>September 2025</strong> that has orders, return the <code>day</code>, that day's non-cancelled <code>revenue</code>, and the cumulative <code>running_total</code> since 1 September.</p>`,
  schema: `orders(id, status, order_date timestamptz, total_amount)`,
  sampleData: `('2025-09-01 ...', 'delivered', 120000.00), ('2025-09-01 ...', 'paid', 54000.00), ...`,
  expected: `@@OUT p14`,
  hint: 'First aggregate per day in a CTE, then apply sum(revenue) OVER (ORDER BY day).',
  solution: `WITH daily AS (
  SELECT order_date::date   AS day,
         sum(total_amount)  AS revenue
  FROM orders
  WHERE status <> 'cancelled'
    AND order_date >= DATE '2025-09-01'
    AND order_date <  DATE '2025-10-01'
  GROUP BY 1
)
SELECT day,
       revenue,
       sum(revenue) OVER (ORDER BY day) AS running_total
FROM daily
ORDER BY day;`,
  optimized: `CREATE INDEX idx_orders_order_date ON orders (order_date);

-- Aggregate and window in ONE query level; explicit ROWS frame avoids the
-- peer-group logic of the default RANGE frame.
SELECT order_date::date                                   AS day,
       sum(total_amount)                                  AS revenue,
       sum(sum(total_amount)) OVER (ORDER BY order_date::date
                                    ROWS UNBOUNDED PRECEDING) AS running_total
FROM orders
WHERE status <> 'cancelled'
  AND order_date >= DATE '2025-09-01'
  AND order_date <  DATE '2025-10-01'
GROUP BY 1
ORDER BY 1;`,
  explanation: `<p><strong>Running total = windowed SUM with an ORDER BY.</strong> When a window has <code>ORDER BY</code> but no explicit frame, the default frame is <code>RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW</code> — "everything up to and including my peers".</p>
<ul>
<li>Here every day is unique so RANGE and ROWS agree. If the ORDER BY key had duplicates, RANGE would give all peers the <em>same</em> total (often surprising); <code>ROWS UNBOUNDED PRECEDING</code> gives a strict row-by-row total and is slightly cheaper.</li>
<li>Aggregate first, then window: windowing 5,000 raw orders and then de-duplicating would be both slower and wrong.</li>
</ul>
<p><strong>Optimized.</strong> <code>sum(sum(total_amount)) OVER (...)</code> nests the window over the aggregate in one query level, and the <code>order_date</code> index restricts the scan to one month. Complexity: O(k log k) for k orders in the month.</p>`
},

{
  id: 'p15-month-over-month-growth',
  title: 'Month-over-Month Revenue Growth',
  difficulty: 'Medium',
  topic: 'Window functions',
  statement: `<p>For each full month from <strong>Jan 2024 to Sep 2025</strong>, return <code>month</code>, non-cancelled <code>revenue</code>, previous month's revenue (<code>prev_revenue</code>) and <code>growth_pct</code> (1 decimal). The first month has NULL for the last two columns.</p>`,
  schema: `orders(id, status, order_date timestamptz, total_amount)`,
  sampleData: `2024-01 → 2,350,000.00 ; 2024-02 → 2,610,000.00 ...`,
  expected: `@@OUT p15`,
  hint: 'Aggregate per month in a CTE, then lag(revenue) OVER (ORDER BY month). Use NULLIF to avoid division by zero.',
  solution: `WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS month,
         sum(total_amount)                     AS revenue
  FROM orders
  WHERE status <> 'cancelled'
    AND order_date >= DATE '2024-01-01'
    AND order_date <  DATE '2025-10-01'
  GROUP BY 1
)
SELECT month,
       revenue,
       lag(revenue) OVER w                                   AS prev_revenue,
       round(100 * (revenue - lag(revenue) OVER w)
             / NULLIF(lag(revenue) OVER w, 0), 1)            AS growth_pct
FROM monthly
WINDOW w AS (ORDER BY month)
ORDER BY month;`,
  optimized: `CREATE INDEX idx_orders_order_date ON orders (order_date);

-- One window evaluation reused via a subquery instead of three lag() calls,
-- and the month bucket computed once.
SELECT month, revenue, prev_revenue,
       round(100 * (revenue - prev_revenue) / NULLIF(prev_revenue, 0), 1) AS growth_pct
FROM (
  SELECT month, revenue, lag(revenue) OVER (ORDER BY month) AS prev_revenue
  FROM (
    SELECT date_trunc('month', order_date)::date AS month,
           sum(total_amount)                     AS revenue
    FROM orders
    WHERE status <> 'cancelled'
      AND order_date >= DATE '2024-01-01'
      AND order_date <  DATE '2025-10-01'
    GROUP BY 1
  ) m
) x
ORDER BY month;`,
  explanation: `<p><strong>LAG reads the previous row of the window</strong> without a self-join. <code>lag(revenue)</code> = revenue one row earlier in <code>ORDER BY month</code>; <code>lag(revenue, 12)</code> would give the same month last year.</p>
<ul>
<li>The <code>WINDOW w AS (...)</code> clause names a window once and reuses it, keeping the query DRY; PostgreSQL evaluates all functions sharing the same window in a single WindowAgg pass.</li>
<li><code>NULLIF(x, 0)</code> turns a zero denominator into NULL so the division yields NULL instead of an error.</li>
<li><strong>Missing months</strong>: LAG uses the previous <em>row</em>, not the previous <em>calendar month</em>. If a month could have zero orders, generate a calendar with <code>generate_series</code> and LEFT JOIN first.</li>
</ul>
<p><strong>Complexity.</strong> One scan + aggregate to 21 rows; the window step is negligible. The index matters only when the history table spans many years.</p>`
},

{
  id: 'p16-top-customers-per-country',
  title: 'Top 3 Customers per Country',
  difficulty: 'Medium',
  topic: 'Ranking',
  statement: `<p>For each country find the customers with the 3 highest lifetime spends (non-cancelled orders). Ties share a rank and may produce more than 3 rows.</p>
<p>Return <code>country</code>, <code>rnk</code>, <code>name</code>, <code>total</code>, ordered by country, rank, name.</p>`,
  schema: `customers(id, name, country)
orders(id, customer_id, status, total_amount)`,
  sampleData: `customers: (1,'Customer 1','India'), (3,'Customer 3','USA'), ...`,
  expected: `@@OUT p16`,
  hint: 'Aggregate spend per customer in one CTE, rank with dense_rank() OVER (PARTITION BY country ORDER BY total DESC) in a second, filter rnk &lt;= 3.',
  solution: `WITH spend AS (
  SELECT c.country, c.id, c.name, sum(o.total_amount) AS total
  FROM customers c
  JOIN orders o ON o.customer_id = c.id
  WHERE o.status <> 'cancelled'
  GROUP BY c.country, c.id, c.name
),
ranked AS (
  SELECT *, dense_rank() OVER (PARTITION BY country ORDER BY total DESC) AS rnk
  FROM spend
)
SELECT country, rnk, name, total
FROM ranked
WHERE rnk <= 3
ORDER BY country, rnk, name;`,
  optimized: `-- Pre-aggregate orders by customer_id only (no join yet), with a covering index.
CREATE INDEX idx_orders_customer_inc ON orders (customer_id) INCLUDE (status, total_amount);

WITH spend AS (
  SELECT customer_id, sum(total_amount) AS total
  FROM orders
  WHERE status <> 'cancelled'
  GROUP BY customer_id
),
ranked AS (
  SELECT c.country, c.name, s.total,
         dense_rank() OVER (PARTITION BY c.country ORDER BY s.total DESC) AS rnk
  FROM spend s
  JOIN customers c ON c.id = s.customer_id
)
SELECT country, rnk, name, total
FROM ranked
WHERE rnk <= 3
ORDER BY country, rnk, name;`,
  explanation: `<p><strong>Top-N per group</strong> = rank inside a partition, then filter. Window functions are evaluated after WHERE/GROUP BY, so the filter on <code>rnk</code> must live in an outer query (or CTE).</p>
<ul>
<li><code>dense_rank</code> keeps ties and leaves no gaps (1,1,2,3). Use <code>row_number</code> if the business wants <em>exactly</em> 3 rows per country.</li>
<li>A <code>LATERAL (... ORDER BY total DESC LIMIT 3)</code> join is the alternative when a per-group index exists — it reads only N rows per group instead of ranking everything.</li>
</ul>
<p><strong>Optimized.</strong> Aggregating <code>orders</code> by <code>customer_id</code> before joining shrinks 5,000 rows to ≤500 before the join, and the <code>INCLUDE</code> covering index allows an index-only scan of exactly the three columns needed. Complexity: O(n) aggregation + O(c log c) ranking over c customers.</p>`
},

{
  id: 'p17-departments-above-average',
  title: 'Departments Paying Above Company Average',
  difficulty: 'Medium',
  topic: 'Subqueries',
  statement: `<p>Return departments whose average salary is higher than the average salary of the whole company. Show <code>department</code>, <code>avg_salary</code>, <code>company_avg</code> (both 2 decimals) and <code>diff</code> = avg_salary − company_avg. Highest average first.</p>`,
  schema: `employees(id, department_id, salary)
departments(id, name)`,
  sampleData: `dept 1 avg ≈ 9x,xxx ; company avg ≈ 9x,xxx`,
  expected: `@@OUT p17`,
  hint: 'Compare avg(e.salary) in HAVING against a scalar subquery (SELECT avg(salary) FROM employees).',
  solution: `SELECT d.name                     AS department,
       round(avg(e.salary), 2)    AS avg_salary,
       (SELECT round(avg(salary), 2) FROM employees) AS company_avg,
       round(avg(e.salary) - (SELECT avg(salary) FROM employees), 2) AS diff
FROM employees e
JOIN departments d ON d.id = e.department_id
GROUP BY d.id, d.name
HAVING avg(e.salary) > (SELECT avg(salary) FROM employees)
ORDER BY avg_salary DESC;`,
  optimized: `-- Compute the company average ONCE with a window over the grouped rows:
-- weighted by headcount so it equals avg over all employees.
SELECT department, avg_salary, company_avg, round(avg_salary - company_avg, 2) AS diff
FROM (
  SELECT d.name AS department,
         round(avg(e.salary), 2) AS avg_salary,
         round(sum(sum(e.salary)) OVER () / sum(count(*)) OVER (), 2) AS company_avg,
         avg(e.salary) AS raw_avg,
         sum(sum(e.salary)) OVER () / sum(count(*)) OVER () AS raw_company
  FROM employees e
  JOIN departments d ON d.id = e.department_id
  GROUP BY d.id, d.name
) t
WHERE raw_avg > raw_company
ORDER BY avg_salary DESC;`,
  explanation: `<p><strong>Uncorrelated scalar subquery.</strong> <code>(SELECT avg(salary) FROM employees)</code> does not reference the outer query, so PostgreSQL computes it once as an <em>InitPlan</em> and reuses the value — it is not re-run per group.</p>
<ul>
<li>HAVING compares unrounded values; rounding is only for display, otherwise a 0.004 difference could flip the result.</li>
<li><strong>Average of averages is wrong</strong>: <code>avg(dept_avg)</code> weights a 3-person department the same as a 300-person one. The optimized version computes the true company average as <code>Σsalary / Σheadcount</code> from the grouped rows.</li>
</ul>
<p><strong>Why the optimized version is better.</strong> The original reads <code>employees</code> up to three times (main scan + InitPlans). The window-over-aggregate version reads it once. On 200 rows it doesn't matter; on a 50M-row fact table one scan instead of three is a 3× win.</p>`
},

{
  id: 'p18-days-to-repeat-purchase',
  title: 'Fastest Repeat Customers',
  difficulty: 'Medium',
  topic: 'Date calculations',
  statement: `<p>For customers with at least two orders, compute the number of days between their <strong>first</strong> and <strong>second</strong> order. Return the 10 customers who came back fastest: <code>customer_id</code>, <code>first_order</code>, <code>second_order</code> (dates) and <code>days_to_repeat</code>. Tie-break by customer_id.</p>`,
  schema: `orders(id, customer_id, order_date timestamptz)`,
  sampleData: `customer 58: orders on 2024-03-18, 2024-04-02, ...`,
  expected: `@@OUT p18`,
  hint: 'row_number() OVER (PARTITION BY customer_id ORDER BY order_date, id) numbers each customer\'s orders; or use lead() to fetch the next order date on the first row.',
  solution: `WITH numbered AS (
  SELECT customer_id, order_date::date AS d,
         row_number() OVER (PARTITION BY customer_id ORDER BY order_date, id) AS rn
  FROM orders
)
SELECT customer_id,
       min(d) FILTER (WHERE rn = 1) AS first_order,
       min(d) FILTER (WHERE rn = 2) AS second_order,
       min(d) FILTER (WHERE rn = 2) - min(d) FILTER (WHERE rn = 1) AS days_to_repeat
FROM numbered
WHERE rn <= 2
GROUP BY customer_id
HAVING count(*) = 2
ORDER BY days_to_repeat, customer_id
LIMIT 10;`,
  optimized: `-- Index supplies rows already sorted per customer -> no Sort node for the window.
CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date, id);

SELECT customer_id, first_order, second_order, second_order - first_order AS days_to_repeat
FROM (
  SELECT customer_id,
         order_date::date                                                   AS first_order,
         lead(order_date::date) OVER (PARTITION BY customer_id ORDER BY order_date, id) AS second_order,
         row_number()           OVER (PARTITION BY customer_id ORDER BY order_date, id) AS rn
  FROM orders
) t
WHERE rn = 1 AND second_order IS NOT NULL
ORDER BY days_to_repeat, customer_id
LIMIT 10;`,
  explanation: `<p><strong>Approach.</strong> Number each customer's orders chronologically, keep the first two, then pivot them into columns with <code>min(...) FILTER</code>. <code>HAVING count(*) = 2</code> discards one-time buyers. <code>date - date</code> yields integer days.</p>
<p><strong>Optimized.</strong> <code>lead()</code> puts the second order date on the first row directly, removing the GROUP BY. Both window functions share the same window definition, so PostgreSQL computes them in a single WindowAgg. The index <code>(customer_id, order_date, id)</code> matches the <code>PARTITION BY ... ORDER BY</code> exactly, letting the planner feed the window from an index scan instead of sorting 5,000 rows.</p>
<div class="callout info">Casting <code>timestamptz</code> to <code>date</code> depends on the session <code>TimeZone</code>. For cross-region reports convert explicitly: <code>(order_date AT TIME ZONE 'Asia/Kolkata')::date</code>.</div>`
},

{
  id: 'p19-declining-products',
  title: 'Products with Falling Sales (Q2 → Q3 2025)',
  difficulty: 'Medium',
  topic: 'CTE',
  statement: `<p>Compare units sold per product in <strong>Q2 2025</strong> (Apr–Jun) and <strong>Q3 2025</strong> (Jul–Sep), non-cancelled orders only. Return the 10 products with the biggest unit drop: <code>sku</code>, <code>name</code>, <code>q2_units</code>, <code>q3_units</code>, <code>change</code> (q3 − q2). Products with no Q3 sales count as 0.</p>`,
  schema: `products(id, sku, name)
orders(id, status, order_date)
order_items(order_id, product_id, quantity)`,
  sampleData: `SKU-0021: Q2 = 41 units, Q3 = 18 units → change −23`,
  expected: `@@OUT p19`,
  hint: 'One CTE with conditional sums: sum(quantity) FILTER (WHERE order_date in Q2) and FILTER (Q3). COALESCE NULLs to 0.',
  solution: `WITH quarterly AS (
  SELECT oi.product_id,
         COALESCE(sum(oi.quantity) FILTER (WHERE o.order_date <  DATE '2025-07-01'), 0) AS q2_units,
         COALESCE(sum(oi.quantity) FILTER (WHERE o.order_date >= DATE '2025-07-01'), 0) AS q3_units
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.status <> 'cancelled'
    AND o.order_date >= DATE '2025-04-01'
    AND o.order_date <  DATE '2025-10-01'
  GROUP BY oi.product_id
)
SELECT p.sku, p.name, q.q2_units, q.q3_units, q.q3_units - q.q2_units AS change
FROM quarterly q
JOIN products p ON p.id = q.product_id
ORDER BY change, p.sku
LIMIT 10;`,
  optimized: `CREATE INDEX idx_orders_date_status ON orders (order_date) INCLUDE (status);

WITH q_orders AS (          -- narrow the big join to just 6 months of orders first
  SELECT id, order_date
  FROM orders
  WHERE status <> 'cancelled'
    AND order_date >= DATE '2025-04-01'
    AND order_date <  DATE '2025-10-01'
),
quarterly AS (
  SELECT oi.product_id,
         COALESCE(sum(oi.quantity) FILTER (WHERE qo.order_date <  DATE '2025-07-01'), 0) AS q2_units,
         COALESCE(sum(oi.quantity) FILTER (WHERE qo.order_date >= DATE '2025-07-01'), 0) AS q3_units
  FROM q_orders qo
  JOIN order_items oi ON oi.order_id = qo.id      -- uses idx_order_items_order
  GROUP BY oi.product_id
)
SELECT p.sku, p.name, q.q2_units, q.q3_units, q.q3_units - q.q2_units AS change
FROM quarterly q
JOIN products p ON p.id = q.product_id
ORDER BY change, p.sku
LIMIT 10;`,
  explanation: `<p><strong>CTE as a named building block.</strong> The <code>quarterly</code> CTE computes both quarters in one pass using conditional aggregation; the outer query only labels and sorts. Since PostgreSQL 12, non-recursive CTEs referenced once are <em>inlined</em> (not materialized) unless you write <code>AS MATERIALIZED</code>, so CTEs cost nothing for readability.</p>
<ul>
<li>The outer date range (Apr–Sep) limits rows scanned; the FILTER clauses split them into quarters.</li>
<li>A product sold in Q2 but not Q3 still appears because both sums come from the same group; only products with zero sales in <em>both</em> quarters are absent (their change is 0 anyway).</li>
</ul>
<p><strong>Optimized.</strong> Filtering <code>orders</code> by date through the new index first means the join to <code>order_items</code> uses the existing <code>idx_order_items_order</code> for only ~30% of orders. Complexity drops from O(all items) to O(items in the 6-month window).</p>`
},

{
  id: 'p20-payment-reconciliation',
  title: 'Shipped Orders Not Fully Paid',
  difficulty: 'Medium',
  topic: 'JOIN',
  statement: `<p>Finance needs every <strong>shipped</strong> or <strong>delivered</strong> order whose successful payments are less than its <code>total_amount</code> (including orders with no payment row at all).</p>
<p>Return <code>order_id</code>, <code>status</code>, <code>total_amount</code>, <code>collected</code>, <code>outstanding</code>, largest outstanding first (then order_id).</p>`,
  schema: `orders(id, status, total_amount)
payments(id, order_id, amount, status)   -- status: success | failed | refunded`,
  sampleData: `payments: (order 58, 25977.75, 'failed') → collected 0`,
  expected: `@@OUT p20`,
  hint: 'LEFT JOIN payments and sum only successful amounts with FILTER; COALESCE the result to 0; compare in HAVING.',
  solution: `SELECT o.id AS order_id, o.status, o.total_amount,
       COALESCE(sum(p.amount) FILTER (WHERE p.status = 'success'), 0) AS collected,
       o.total_amount
         - COALESCE(sum(p.amount) FILTER (WHERE p.status = 'success'), 0) AS outstanding
FROM orders o
LEFT JOIN payments p ON p.order_id = o.id
WHERE o.status IN ('shipped', 'delivered')
GROUP BY o.id
HAVING o.total_amount > COALESCE(sum(p.amount) FILTER (WHERE p.status = 'success'), 0)
ORDER BY outstanding DESC, o.id;`,
  optimized: `-- payments(order_id) is deliberately missing in company_db.
CREATE INDEX idx_payments_order ON payments (order_id) WHERE status = 'success';

SELECT o.id AS order_id, o.status, o.total_amount,
       COALESCE(pay.collected, 0)                  AS collected,
       o.total_amount - COALESCE(pay.collected, 0) AS outstanding
FROM orders o
LEFT JOIN LATERAL (
  SELECT sum(p.amount) AS collected
  FROM payments p
  WHERE p.order_id = o.id AND p.status = 'success'
) pay ON true
WHERE o.status IN ('shipped', 'delivered')
  AND o.total_amount > COALESCE(pay.collected, 0)
ORDER BY outstanding DESC, o.id;`,
  explanation: `<p><strong>Reconciliation = outer join + conditional aggregate.</strong></p>
<ul>
<li><strong>LEFT JOIN</strong> keeps orders with no payment row; an INNER JOIN would hide exactly the worst cases.</li>
<li><strong>FILTER on the aggregate, not WHERE</strong>: putting <code>p.status = 'success'</code> in WHERE would drop orders whose only payment failed (their NULL-extended row disappears).</li>
<li><code>GROUP BY o.id</code> is enough to select <code>o.status</code> and <code>o.total_amount</code>: they are functionally dependent on the primary key.</li>
</ul>
<p><strong>Optimized.</strong> The LATERAL subquery aggregates per order through a <em>partial</em> index containing only successful payments, so each probe touches 0–1 index entries. Whether it beats the hash join depends on selectivity: the LATERAL form wins when the outer set is small (e.g. one customer's orders); the hash-join form wins for full-table reports. Always confirm with <code>EXPLAIN ANALYZE</code>.</p>
<div class="callout warn">Money: never compare with floating point. <code>numeric</code> is exact, which is why the equality-sensitive comparison here is safe.</div>`
},

{
  id: 'p21-dedupe-contacts',
  title: 'Delete Duplicate Contacts, Keep the Oldest',
  difficulty: 'Medium',
  topic: 'Deduplication',
  setup: `DROP TABLE IF EXISTS crm_contacts;
CREATE TEMP TABLE crm_contacts (
  id        int PRIMARY KEY,
  email     text NOT NULL,
  full_name text,
  source    text
);
INSERT INTO crm_contacts VALUES
 (1, 'asha@acme.in',    'Asha Rao',    'web'),
 (2, 'ASHA@acme.in ',   'Asha R',      'import'),
 (3, 'ravi@zen.io',     'Ravi K',      'web'),
 (4, 'neha@orbit.com',  'Neha S',      'event'),
 (5, 'ravi@zen.io',     'Ravi Kumar',  'import'),
 (6, 'Neha@Orbit.com',  'Neha Sharma', 'web'),
 (7, 'li@nimbus.sg',    'Li Wei',      'web'),
 (8, ' asha@acme.in',   'Asha',        'event');`,
  statement: `<p>A CRM import created duplicate contacts. Two rows are duplicates when their e-mails match <strong>case-insensitively and ignoring surrounding spaces</strong>. Delete every duplicate, keeping the row with the <strong>lowest id</strong>, then return the surviving rows ordered by id.</p>`,
  schema: `crm_contacts(id int PK, email text, full_name text, source text)   -- created by the setup script`,
  sampleData: ` id | email           | full_name | source
----+-----------------+-----------+-------
  1 | asha@acme.in    | Asha Rao  | web
  2 | ASHA@acme.in␠   | Asha R    | import
  8 | ␠asha@acme.in   | Asha      | event`,
  expected: `@@OUT p21`,
  hint: 'DELETE ... USING the same table: delete row a if another row b has the same normalized e-mail and a smaller id.',
  solution: `DELETE FROM crm_contacts a
USING crm_contacts b
WHERE lower(trim(a.email)) = lower(trim(b.email))
  AND a.id > b.id;

SELECT id, email, full_name, source
FROM crm_contacts
ORDER BY id;`,
  optimized: `-- Window version: each duplicate is identified exactly once (no N^2 pair
-- explosion when a value has many copies), then deleted by primary key.
DELETE FROM crm_contacts
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           row_number() OVER (PARTITION BY lower(trim(email)) ORDER BY id) AS rn
    FROM crm_contacts
  ) d
  WHERE rn > 1
);

-- Prevent it from happening again:
CREATE UNIQUE INDEX uq_crm_contacts_email ON crm_contacts (lower(trim(email)));

SELECT id, email, full_name, source
FROM crm_contacts
ORDER BY id;`,
  explanation: `<p><strong>Self-join delete.</strong> <code>DELETE ... USING</code> is PostgreSQL's join syntax for DELETE. Row <code>a</code> is removed when some row <code>b</code> with the same normalized key has a smaller id — so the minimum id in each group always survives.</p>
<ul>
<li>If a value appears k times, the self-join produces k(k−1)/2 matching pairs. Deleting the same row several times is harmless but wasteful; with 10,000 copies of one bad value that is 50M pairs.</li>
<li>The <strong>row_number</strong> version numbers each group once (one sort: O(n log n)) and deletes by primary key.</li>
<li>The final <strong>unique expression index</strong> is the real fix: the database now rejects <code>'ASHA@acme.in '</code> when <code>'asha@acme.in'</code> exists. (The <span class="tag ext">extension</span> <code>citext</code> is an alternative for case-insensitivity.)</li>
</ul>
<div class="callout danger">On production tables run the SELECT form first, inside a transaction, and check the row count before committing. Duplicates with child rows (foreign keys) must be re-pointed to the survivor before deletion.</div>`
},

{
  id: 'p22-org-chart',
  title: 'Org Chart under a Department Head',
  difficulty: 'Medium',
  topic: 'Recursive queries',
  statement: `<p>Starting from the Engineering head (<code>employee id = 1</code>), walk the <code>manager_id</code> hierarchy downward and return every person in the tree with their <code>lvl</code> (head = 1), an indented <code>org_chart</code> label, <code>id</code> and <code>manager_id</code>. Order the rows so each manager is immediately followed by their reports (depth-first).</p>`,
  schema: `employees(id, first_name, last_name, manager_id → employees.id)`,
  sampleData: `(1,'Asha','Rao', NULL) → (32, ..., 1) → (x, ..., 32)`,
  expected: `@@OUT p22`,
  hint: 'WITH RECURSIVE: anchor = the head; recursive term joins employees whose manager_id is in the previous level. Carry an ARRAY path and ORDER BY it for depth-first order.',
  solution: `WITH RECURSIVE org AS (
  SELECT id, first_name || ' ' || last_name AS name, manager_id,
         1 AS lvl, ARRAY[id] AS path
  FROM employees
  WHERE id = 1
  UNION ALL
  SELECT e.id, e.first_name || ' ' || e.last_name, e.manager_id,
         o.lvl + 1, o.path || e.id
  FROM employees e
  JOIN org o ON e.manager_id = o.id
)
SELECT lvl,
       repeat('  ', lvl - 1) || name AS org_chart,
       id, manager_id
FROM org
ORDER BY path;`,
  optimized: `-- Index on the FK used by every recursive step + PG14 SEARCH/CYCLE clauses
-- (built-in depth-first ordering and protection against bad data loops).
CREATE INDEX idx_employees_manager ON employees (manager_id);

WITH RECURSIVE org AS (
  SELECT id, first_name || ' ' || last_name AS name, manager_id, 1 AS lvl
  FROM employees
  WHERE id = 1
  UNION ALL
  SELECT e.id, e.first_name || ' ' || e.last_name, e.manager_id, o.lvl + 1
  FROM employees e
  JOIN org o ON e.manager_id = o.id
) SEARCH DEPTH FIRST BY id SET ord
  CYCLE id SET is_cycle USING cycle_path
SELECT lvl,
       repeat('  ', lvl - 1) || name AS org_chart,
       id, manager_id
FROM org
WHERE NOT is_cycle
ORDER BY ord;`,
  explanation: `<p><strong>How WITH RECURSIVE executes.</strong> PostgreSQL runs the anchor once into a <em>working table</em>, then repeatedly runs the recursive term against only the rows produced in the previous iteration, appending results, until an iteration produces nothing. It is iteration, not true recursion — each level is one join.</p>
<ul>
<li><strong>Depth-first ordering</strong>: sorting by the <code>path</code> array (<code>{1}</code>, <code>{1,32}</code>, <code>{1,32,x}</code>, <code>{1,41}</code>...) places each subtree right after its root.</li>
<li><strong>UNION ALL</strong> vs UNION: UNION de-duplicates each iteration (slower) but can stop some cycles; for trees, UNION ALL plus a cycle guard is standard.</li>
</ul>
<p><strong>Optimized.</strong> Every iteration probes <code>employees.manager_id</code>; without an index each level is a full scan (O(levels × n)). With the index it is O(subtree size × log n). The <code>SEARCH DEPTH FIRST</code> and <code>CYCLE</code> clauses (SQL standard, PostgreSQL 14+) generate the ordering column and stop infinite loops if someone accidentally makes A manage B and B manage A.</p>`
},

{
  id: 'p23-order-value-percentiles',
  title: 'Median and P90 Order Value by Segment',
  difficulty: 'Medium',
  topic: 'Complex reporting',
  statement: `<p>For each customer <code>segment</code> return the number of non-cancelled <code>orders</code>, the <code>avg_value</code>, the <code>median_value</code> and the 90th percentile <code>p90_value</code> of <code>total_amount</code> (all rounded to 2 decimals).</p>`,
  schema: `customers(id, segment)
orders(id, customer_id, status, total_amount)`,
  sampleData: `consumer: 25977.75, 230018.23, 305730.09, ...`,
  expected: `@@OUT p23`,
  hint: 'percentile_cont(0.5) WITHIN GROUP (ORDER BY total_amount) is an ordered-set aggregate; it returns double precision, so cast to numeric before round().',
  solution: `SELECT c.segment,
       count(*)                                   AS orders,
       round(avg(o.total_amount), 2)              AS avg_value,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY o.total_amount))::numeric, 2) AS median_value,
       round((percentile_cont(0.9) WITHIN GROUP (ORDER BY o.total_amount))::numeric, 2) AS p90_value
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled'
GROUP BY c.segment
ORDER BY c.segment;`,
  optimized: `-- Compute both percentiles with ONE sort per group using the array form.
SELECT segment, orders, avg_value,
       round(pct[1]::numeric, 2) AS median_value,
       round(pct[2]::numeric, 2) AS p90_value
FROM (
  SELECT c.segment,
         count(*)                      AS orders,
         round(avg(o.total_amount), 2) AS avg_value,
         percentile_cont(ARRAY[0.5, 0.9]) WITHIN GROUP (ORDER BY o.total_amount) AS pct
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.status <> 'cancelled'
  GROUP BY c.segment
) s
ORDER BY segment;`,
  explanation: `<p><strong>Mean vs median.</strong> Order values are skewed: a few huge orders pull the average up. The median (50th percentile) shows the "typical" order and P90 shows the high end — together they describe the distribution far better than avg alone.</p>
<ul>
<li><code>percentile_cont</code> interpolates between the two middle values (continuous); <code>percentile_disc</code> returns an actual value from the set.</li>
<li>Ordered-set aggregates must sort each group: O(n log n) and memory proportional to the group (spills to disk past <code>work_mem</code>).</li>
</ul>
<p><strong>Optimized.</strong> Passing an <code>ARRAY[0.5, 0.9]</code> computes several percentiles from a <em>single</em> sort of each group instead of one sort per aggregate call. For approximate percentiles on billions of rows, consider pre-aggregated histograms or the <span class="tag ext">extension</span> world (e.g. t-digest style extensions) — not core PostgreSQL.</p>`
},

{
  id: 'p24-customer-spend-quartiles',
  title: 'Customer Spend Quartiles',
  difficulty: 'Medium',
  topic: 'Ranking',
  statement: `<p>Split customers who have at least one non-cancelled order into 4 equal-sized quartiles by lifetime spend (quartile 1 = biggest spenders). For each <code>quartile</code> return number of <code>customers</code>, <code>min_spend</code>, <code>max_spend</code> and <code>revenue_pct</code> — that quartile's share of total revenue (1 decimal).</p>`,
  schema: `orders(id, customer_id, status, total_amount)`,
  sampleData: `customer 417 → 3,105,000.00 ; customer 58 → 1,250,000.00 ...`,
  expected: `@@OUT p24`,
  hint: 'ntile(4) OVER (ORDER BY total DESC, customer_id) assigns buckets. Then GROUP BY quartile and use sum(sum(total)) OVER () for the grand total.',
  solution: `WITH spend AS (
  SELECT customer_id, sum(total_amount) AS total
  FROM orders
  WHERE status <> 'cancelled'
  GROUP BY customer_id
),
q AS (
  SELECT customer_id, total,
         ntile(4) OVER (ORDER BY total DESC, customer_id) AS quartile
  FROM spend
)
SELECT quartile,
       count(*)   AS customers,
       min(total) AS min_spend,
       max(total) AS max_spend,
       round(100 * sum(total) / sum(sum(total)) OVER (), 1) AS revenue_pct
FROM q
GROUP BY quartile
ORDER BY quartile;`,
  explanation: `<p><strong>ntile(n)</strong> deals rows into n buckets as evenly as possible (sizes differ by at most one; earlier buckets get the extra row). It is a <em>rank-based</em> split, not a value-based one: two customers with identical spend can land in different quartiles, so a deterministic tie-breaker (<code>customer_id</code>) is required for stable output.</p>
<ul>
<li>For <em>value</em> thresholds (e.g. "spend above the 75th percentile") use <code>percentile_cont</code> instead.</li>
<li><code>sum(sum(total)) OVER ()</code>: the inner sum is the group aggregate, the outer is a window over the 4 grouped rows = grand total.</li>
</ul>
<p>This is the core of <strong>RFM / Pareto analysis</strong>: typically the top quartile brings a disproportionate share of revenue, which drives loyalty-programme targeting.</p>
<p><strong>Complexity.</strong> One aggregation O(n), one sort of c customers O(c log c).</p>`
},

/* ============================== HARD ============================== */
{
  id: 'p25-longest-login-streak',
  title: 'Longest Consecutive Login Streak',
  difficulty: 'Hard',
  topic: 'Gaps and islands',
  setup: `DROP TABLE IF EXISTS user_logins;
CREATE TEMP TABLE user_logins (
  user_id  int       NOT NULL,
  login_at timestamp NOT NULL
);
INSERT INTO user_logins VALUES
 (1,'2025-03-01 09:00'),(1,'2025-03-01 18:30'),(1,'2025-03-02 08:10'),(1,'2025-03-03 22:45'),
 (1,'2025-03-05 07:00'),(1,'2025-03-06 07:05'),
 (2,'2025-03-01 10:00'),(2,'2025-03-03 10:00'),(2,'2025-03-04 11:00'),(2,'2025-03-05 09:30'),
 (2,'2025-03-06 12:00'),(2,'2025-03-08 12:00'),
 (3,'2025-03-10 09:00'),(3,'2025-03-10 09:05'),
 (4,'2025-02-27 23:30'),(4,'2025-02-28 08:00'),(4,'2025-03-01 08:00'),(4,'2025-03-02 08:00');`,
  statement: `<p>Each row in <code>user_logins</code> is one login (users can log in several times per day). A <strong>streak</strong> is a run of consecutive calendar days with at least one login.</p>
<p>For every user return their <strong>longest</strong> streak: <code>user_id</code>, <code>streak_start</code>, <code>streak_end</code>, <code>streak_days</code>. If a user has two equally long streaks, report the earliest. Order by user_id.</p>`,
  schema: `user_logins(user_id int, login_at timestamp)   -- created by the setup script`,
  sampleData: ` user_id | login_at
---------+------------------
       1 | 2025-03-01 09:00
       1 | 2025-03-01 18:30
       1 | 2025-03-02 08:10
       1 | 2025-03-03 22:45
       1 | 2025-03-05 07:00`,
  expected: `@@OUT p25`,
  hint: 'Reduce to DISTINCT (user, day). Within a user, day − row_number() days is constant across a consecutive run — that constant is the island id. Group by it, then pick the longest with DISTINCT ON.',
  solution: `WITH days AS (
  SELECT DISTINCT user_id, login_at::date AS d
  FROM user_logins
),
islands AS (
  SELECT user_id, d,
         d - (row_number() OVER (PARTITION BY user_id ORDER BY d))::int AS grp
  FROM days
),
streaks AS (
  SELECT user_id, min(d) AS streak_start, max(d) AS streak_end, count(*) AS streak_days
  FROM islands
  GROUP BY user_id, grp
)
SELECT DISTINCT ON (user_id) user_id, streak_start, streak_end, streak_days
FROM streaks
ORDER BY user_id, streak_days DESC, streak_start;`,
  optimized: `-- LAG-based variant: flags the start of each island, then a running
-- count of flags numbers them. Works for any step (e.g. "within 36 hours"),
-- not only exact +1 day, and an expression index feeds it pre-sorted.
CREATE INDEX idx_logins_user_day ON user_logins (user_id, (login_at::date));

WITH days AS (
  SELECT DISTINCT user_id, login_at::date AS d
  FROM user_logins
),
flagged AS (
  SELECT user_id, d,
         CASE WHEN d - lag(d) OVER (PARTITION BY user_id ORDER BY d) = 1
              THEN 0 ELSE 1 END AS is_start
  FROM days
),
numbered AS (
  SELECT user_id, d,
         sum(is_start) OVER (PARTITION BY user_id ORDER BY d) AS island
  FROM flagged
),
streaks AS (
  SELECT user_id, min(d) AS streak_start, max(d) AS streak_end, count(*) AS streak_days
  FROM numbered
  GROUP BY user_id, island
)
SELECT DISTINCT ON (user_id) user_id, streak_start, streak_end, streak_days
FROM streaks
ORDER BY user_id, streak_days DESC, streak_start;`,
  explanation: `<p><strong>The gaps-and-islands trick.</strong> For consecutive days, both the date and its row number increase by exactly 1, so <code>date − row_number</code> stays constant inside an island and jumps when there is a gap:</p>
<table><tr><th>d</th><th>row_number</th><th>d − rn</th></tr>
<tr><td>03-01</td><td>1</td><td>02-28</td></tr><tr><td>03-02</td><td>2</td><td>02-28</td></tr>
<tr><td>03-03</td><td>3</td><td>02-28</td></tr><tr><td>03-05</td><td>4</td><td>03-01 ← new island</td></tr></table>
<ul>
<li><strong>DISTINCT days first</strong> — two logins on one day would otherwise consume two row numbers and break the arithmetic.</li>
<li><code>date - integer</code> returns a date, so <code>grp</code> is a date that serves as the island label. Note user 4's streak crosses a month boundary correctly because date arithmetic is calendar-aware.</li>
<li><code>DISTINCT ON (user_id) ... ORDER BY user_id, streak_days DESC, streak_start</code> keeps exactly one row per user — the longest, earliest on ties. It is PostgreSQL-specific; the portable alternative is <code>row_number() = 1</code>.</li>
</ul>
<p><strong>Optimized/alternative.</strong> The LAG + running-sum pattern generalises to fuzzy gaps (e.g. "session continues if next event is within 30 minutes"), where the row-number trick cannot work. The expression index on <code>(user_id, login_at::date)</code> delivers rows already grouped and ordered. Complexity for both: O(n log n) sort + O(n) windows.</p>`
},

{
  id: 'p26-missing-invoice-numbers',
  title: 'Find Gaps in an Invoice Sequence',
  difficulty: 'Hard',
  topic: 'Gaps and islands',
  setup: `DROP TABLE IF EXISTS invoices;
CREATE TEMP TABLE invoices (
  invoice_no int PRIMARY KEY,
  issued_on  date NOT NULL,
  amount     numeric(10,2) NOT NULL
);
INSERT INTO invoices (invoice_no, issued_on, amount)
SELECT n, DATE '2025-04-01' + (n - 1001) / 3, 1000 + (n % 7) * 250
FROM generate_series(1001, 1060) AS n
WHERE n NOT IN (1004, 1005, 1006, 1013, 1027, 1028, 1041, 1050, 1051, 1052, 1053);`,
  statement: `<p>Auditors require invoice numbers to be continuous. Between the smallest and largest existing <code>invoice_no</code>, report every <strong>gap</strong> as a range: <code>gap_start</code>, <code>gap_end</code>, <code>missing_count</code>. Order by gap_start.</p>`,
  schema: `invoices(invoice_no int PK, issued_on date, amount numeric)   -- created by the setup script`,
  sampleData: ` invoice_no | issued_on  | amount
------------+------------+--------
       1001 | 2025-04-01 | 1250.00
       1002 | 2025-04-01 | 1500.00
       1003 | 2025-04-01 | 1750.00
       1007 | 2025-04-03 | 1000.00`,
  expected: `@@OUT p26`,
  hint: 'Brute force: generate_series(min, max), anti-join to find missing numbers, then group consecutive missing numbers into islands. Smarter: compare each invoice_no with lead(invoice_no).',
  solution: `WITH bounds AS (
  SELECT min(invoice_no) AS lo, max(invoice_no) AS hi FROM invoices
),
missing AS (
  SELECT n
  FROM bounds, generate_series(lo, hi) AS n
  WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.invoice_no = n)
),
grouped AS (
  SELECT n, n - row_number() OVER (ORDER BY n) AS grp
  FROM missing
)
SELECT min(n) AS gap_start, max(n) AS gap_end, count(*) AS missing_count
FROM grouped
GROUP BY grp
ORDER BY gap_start;`,
  optimized: `-- Single ordered pass over the primary key; no number series is materialized,
-- so cost depends on existing rows, not on the numeric range size.
SELECT invoice_no + 1          AS gap_start,
       next_no - 1             AS gap_end,
       next_no - invoice_no - 1 AS missing_count
FROM (
  SELECT invoice_no,
         lead(invoice_no) OVER (ORDER BY invoice_no) AS next_no
  FROM invoices
) t
WHERE next_no - invoice_no > 1
ORDER BY gap_start;`,
  explanation: `<p><strong>Two strategies.</strong></p>
<ol>
<li><strong>Generate-and-subtract</strong> (solution): build every number in [min, max] with <code>generate_series</code>, anti-join to keep the missing ones, then apply the <em>n − row_number</em> islands trick to merge consecutive missing numbers into ranges. Easy to reason about, but cost is O(range): an invoice range of 1 → 50,000,000 with three gaps still generates 50M numbers.</li>
<li><strong>LEAD comparison</strong> (optimized): each existing row looks at the next existing number. If the difference is &gt; 1 there is a gap of exactly <code>next − current − 1</code> numbers starting at <code>current + 1</code>. Cost is O(rows) and it reads the primary-key index in order, so there is no Sort node.</li>
</ol>
<div class="callout info">PostgreSQL sequences/identity columns are <strong>not gap-free</strong>: rolled-back transactions and cached values consume numbers. If regulation demands gapless invoice numbers, allocate them from a counter row updated inside the same transaction (serializing invoice creation) — and use this query to prove continuity.</div>`
},

{
  id: 'p27-sessionize-clickstream',
  title: 'Sessionize a Clickstream (30-minute Timeout)',
  difficulty: 'Hard',
  topic: 'Window functions',
  setup: `DROP TABLE IF EXISTS web_events;
CREATE TEMP TABLE web_events (
  user_id int       NOT NULL,
  ts      timestamp NOT NULL,
  page    text      NOT NULL
);
INSERT INTO web_events VALUES
 (101,'2025-09-01 09:00','/home'),     (101,'2025-09-01 09:05','/products'),
 (101,'2025-09-01 09:20','/cart'),     (101,'2025-09-01 10:10','/home'),
 (101,'2025-09-01 10:15','/checkout'), (101,'2025-09-01 10:44','/thanks'),
 (102,'2025-09-01 11:00','/home'),     (102,'2025-09-01 11:31','/products'),
 (102,'2025-09-01 11:45','/products'), (102,'2025-09-01 12:14','/cart'),
 (103,'2025-09-01 23:50','/home'),     (103,'2025-09-02 00:10','/products'),
 (103,'2025-09-02 00:35','/cart');`,
  statement: `<p>Split each user's events into <strong>sessions</strong>: a new session starts on a user's first event or whenever more than <strong>30 minutes</strong> passed since that user's previous event.</p>
<p>Return <code>user_id</code>, <code>session_no</code> (1, 2, ... per user), <code>session_start</code>, <code>session_end</code>, <code>events</code>, <code>duration_min</code>. Order by user, session_no.</p>`,
  schema: `web_events(user_id int, ts timestamp, page text)   -- created by the setup script`,
  sampleData: ` user_id | ts               | page
---------+------------------+----------
     101 | 2025-09-01 09:00 | /home
     101 | 2025-09-01 09:20 | /cart
     101 | 2025-09-01 10:10 | /home      ← 50 min gap: new session`,
  expected: `@@OUT p27`,
  hint: 'lag(ts) gives the previous event time. Flag 1 when the gap &gt; 30 minutes (or lag is NULL), then a running sum of flags per user is the session number.',
  solution: `WITH flagged AS (
  SELECT user_id, ts,
         CASE WHEN lag(ts) OVER (PARTITION BY user_id ORDER BY ts) IS NULL
                OR ts - lag(ts) OVER (PARTITION BY user_id ORDER BY ts) > INTERVAL '30 minutes'
              THEN 1 ELSE 0 END AS new_session
  FROM web_events
),
sessions AS (
  SELECT user_id, ts,
         sum(new_session) OVER (PARTITION BY user_id ORDER BY ts
                                ROWS UNBOUNDED PRECEDING) AS session_no
  FROM flagged
)
SELECT user_id, session_no,
       min(ts)  AS session_start,
       max(ts)  AS session_end,
       count(*) AS events,
       extract(epoch FROM max(ts) - min(ts))::int / 60 AS duration_min
FROM sessions
GROUP BY user_id, session_no
ORDER BY user_id, session_no;`,
  optimized: `-- Index matching PARTITION BY user_id ORDER BY ts removes the sort;
-- COALESCE folds the NULL check into one comparison and one lag() call.
CREATE INDEX idx_web_events_user_ts ON web_events (user_id, ts);

SELECT user_id, session_no,
       min(ts) AS session_start, max(ts) AS session_end, count(*) AS events,
       extract(epoch FROM max(ts) - min(ts))::int / 60 AS duration_min
FROM (
  SELECT user_id, ts,
         count(*) FILTER (WHERE gap > INTERVAL '30 minutes')
           OVER (PARTITION BY user_id ORDER BY ts ROWS UNBOUNDED PRECEDING) AS session_no
  FROM (
    SELECT user_id, ts,
           ts - COALESCE(lag(ts) OVER (PARTITION BY user_id ORDER BY ts),
                         '-infinity'::timestamp) AS gap
    FROM web_events
  ) g
) s
GROUP BY user_id, session_no
ORDER BY user_id, session_no;`,
  explanation: `<p><strong>Sessionization = gaps and islands with a fuzzy gap.</strong> The row-number subtraction trick only works for fixed steps; here the rule is "gap &gt; 30 min", so we use the general <em>flag + running sum</em> pattern:</p>
<ol>
<li><code>lag(ts)</code> fetches the previous event of the same user.</li>
<li>A boolean-ish flag marks session starts (first event, or gap &gt; 30 min). Note user 102's 11:00 → 11:31 gap is 31 minutes, so it starts a new session; user 103's session spans midnight because we compare timestamps, not dates.</li>
<li>A running <code>sum</code> of flags turns starts into session numbers 1, 2, 3...</li>
<li>Aggregate per (user, session).</li>
</ol>
<p><strong>Optimized.</strong> <code>ts − '-infinity'</code> is not representable, so we compare via <code>COALESCE(lag(ts), '-infinity')</code>: the difference becomes <em>infinity</em>-like, which PostgreSQL handles for intervals as of PG 17+; the FILTERed running <code>count</code> counts session starts directly. The index <code>(user_id, ts)</code> lets both window passes consume pre-sorted rows — on billions of events, the sort is the dominant cost, so removing it matters most.</p>
<div class="callout tip">For streaming analytics, materialize sessions incrementally (e.g. per day partition) rather than re-sessionizing all history on every run.</div>`
},

{
  id: 'p28-cohort-retention',
  title: 'Monthly Cohort Retention',
  difficulty: 'Hard',
  topic: 'Complex reporting',
  statement: `<p>Assign each customer to the <strong>cohort</strong> = month of their first order (any status). For cohorts from <strong>2024-01 to 2024-06</strong>, report <code>cohort</code>, <code>cohort_size</code>, and the percentage of the cohort that ordered again in month +1, +2 and +3 after the cohort month (<code>m1_pct</code>, <code>m2_pct</code>, <code>m3_pct</code>, 1 decimal).</p>`,
  schema: `orders(id, customer_id, order_date timestamptz)`,
  sampleData: `customer 58: first order 2024-03-18 → cohort 2024-03; ordered in 2024-04 → counts for m1`,
  expected: `@@OUT p28`,
  hint: 'CTE 1: first order month per customer. CTE 2: distinct (customer, activity month). Join them, compute month offset with (year*12+month) arithmetic, then pivot offsets 1/2/3 with count(DISTINCT ...) FILTER.',
  solution: `WITH first_month AS (
  SELECT customer_id, date_trunc('month', min(order_date))::date AS cohort
  FROM orders
  GROUP BY customer_id
),
activity AS (
  SELECT DISTINCT customer_id, date_trunc('month', order_date)::date AS month
  FROM orders
),
offsets AS (
  SELECT f.cohort, a.customer_id,
         (extract(year FROM a.month) * 12 + extract(month FROM a.month))
       - (extract(year FROM f.cohort) * 12 + extract(month FROM f.cohort)) AS month_offset
  FROM first_month f
  JOIN activity a USING (customer_id)
)
SELECT to_char(cohort, 'YYYY-MM') AS cohort,
       count(DISTINCT customer_id) FILTER (WHERE month_offset = 0) AS cohort_size,
       round(100.0 * count(DISTINCT customer_id) FILTER (WHERE month_offset = 1)
             / count(DISTINCT customer_id) FILTER (WHERE month_offset = 0), 1) AS m1_pct,
       round(100.0 * count(DISTINCT customer_id) FILTER (WHERE month_offset = 2)
             / count(DISTINCT customer_id) FILTER (WHERE month_offset = 0), 1) AS m2_pct,
       round(100.0 * count(DISTINCT customer_id) FILTER (WHERE month_offset = 3)
             / count(DISTINCT customer_id) FILTER (WHERE month_offset = 0), 1) AS m3_pct
FROM offsets
WHERE cohort < DATE '2024-07-01'
GROUP BY cohort
ORDER BY cohort;`,
  optimized: `CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date);

-- Compute the cohort with a window (one pass, no self-join), restrict to the
-- months we need, and because (customer, month) is already DISTINCT,
-- plain count(*) FILTER replaces the costlier count(DISTINCT ...).
WITH activity AS (
  SELECT DISTINCT customer_id, date_trunc('month', order_date)::date AS month
  FROM orders
),
tagged AS (
  SELECT customer_id, month,
         min(month) OVER (PARTITION BY customer_id) AS cohort
  FROM activity
),
offsets AS (
  SELECT cohort,
         ((extract(year FROM month) - extract(year FROM cohort)) * 12
          + extract(month FROM month) - extract(month FROM cohort))::int AS month_offset
  FROM tagged
)
SELECT to_char(cohort, 'YYYY-MM') AS cohort,
       count(*) FILTER (WHERE month_offset = 0) AS cohort_size,
       round(100.0 * count(*) FILTER (WHERE month_offset = 1) / count(*) FILTER (WHERE month_offset = 0), 1) AS m1_pct,
       round(100.0 * count(*) FILTER (WHERE month_offset = 2) / count(*) FILTER (WHERE month_offset = 0), 1) AS m2_pct,
       round(100.0 * count(*) FILTER (WHERE month_offset = 3) / count(*) FILTER (WHERE month_offset = 0), 1) AS m3_pct
FROM offsets
WHERE cohort < DATE '2024-07-01'
  AND month_offset BETWEEN 0 AND 3
GROUP BY cohort
ORDER BY cohort;`,
  explanation: `<p><strong>Cohort analysis</strong> answers "of the customers acquired in month X, what fraction came back N months later?" — the standard retention chart for subscription and e-commerce businesses.</p>
<ol>
<li><strong>Cohort</strong>: month of the first order.</li>
<li><strong>Activity</strong>: distinct (customer, month) pairs — de-duplicating here means a customer ordering 5 times in a month counts once.</li>
<li><strong>Offset</strong>: months between activity and cohort. <code>year*12 + month</code> converts a month to an absolute index, making December→January arithmetic correct (<code>age()</code> also works but returns an interval).</li>
<li><strong>Pivot</strong> offsets into columns with <code>FILTER</code>.</li>
</ol>
<p>Note that early cohorts are large because the dataset begins in January 2024 — every existing customer "appears" then. Real analyses exclude this <em>left-censoring</em> effect or start cohorts later.</p>
<p><strong>Optimized.</strong> <code>min(month) OVER (PARTITION BY customer_id)</code> tags every activity row with its cohort in the same pass, eliminating the join between two aggregates. Because activity rows are already unique per (customer, month), <code>count(DISTINCT)</code> — which forces a sort per aggregate — can become a plain <code>count(*)</code>. Pre-filtering offsets to 0..3 shrinks the final aggregation.</p>`
},

{
  id: 'p29-overlapping-bookings',
  title: 'Detect Overlapping Room Bookings',
  difficulty: 'Hard',
  topic: 'JOIN',
  setup: `DROP TABLE IF EXISTS room_bookings;
CREATE TEMP TABLE room_bookings (
  id        int PRIMARY KEY,
  room      text NOT NULL,
  guest     text NOT NULL,
  check_in  date NOT NULL,
  check_out date NOT NULL,
  CHECK (check_out > check_in)
);
INSERT INTO room_bookings VALUES
 (1,'101','Asha',  '2025-10-01','2025-10-04'),
 (2,'101','Ravi',  '2025-10-04','2025-10-06'),
 (3,'101','Neha',  '2025-10-05','2025-10-08'),
 (4,'102','Li',    '2025-10-01','2025-10-10'),
 (5,'102','Omar',  '2025-10-03','2025-10-05'),
 (6,'102','Sara',  '2025-10-09','2025-10-12'),
 (7,'103','Tom',   '2025-10-01','2025-10-02'),
 (8,'101','Kiran', '2025-10-07','2025-10-09');`,
  statement: `<p>A hotel stores bookings with <code>check_in</code> (inclusive) and <code>check_out</code> (exclusive — the guest leaves that morning, so a new guest may check in the same day).</p>
<p>Find every pair of bookings for the <strong>same room</strong> whose stays overlap. Return <code>room</code>, <code>booking_a</code>, <code>booking_b</code> (a &lt; b), <code>guests</code>, <code>overlap_from</code>, <code>overlap_to</code>. Order by room, booking_a, booking_b.</p>`,
  schema: `room_bookings(id int PK, room text, guest text, check_in date, check_out date)   -- created by the setup script`,
  sampleData: ` id | room | guest | check_in   | check_out
----+------+-------+------------+-----------
  1 | 101  | Asha  | 2025-10-01 | 2025-10-04
  2 | 101  | Ravi  | 2025-10-04 | 2025-10-06   ← touches #1, no overlap
  3 | 101  | Neha  | 2025-10-05 | 2025-10-08   ← overlaps #2`,
  expected: `@@OUT p29`,
  hint: 'Two half-open intervals [s1,e1) and [s2,e2) overlap iff s1 &lt; e2 AND s2 &lt; e1. Self-join on room with a.id &lt; b.id. The overlap is [greatest(starts), least(ends)).',
  solution: `SELECT a.room,
       a.id AS booking_a,
       b.id AS booking_b,
       a.guest || ' / ' || b.guest   AS guests,
       greatest(a.check_in, b.check_in)   AS overlap_from,
       least(a.check_out, b.check_out)    AS overlap_to
FROM room_bookings a
JOIN room_bookings b
  ON b.room = a.room
 AND a.id < b.id
 AND a.check_in < b.check_out
 AND b.check_in < a.check_out
ORDER BY a.room, a.id, b.id;`,
  optimized: `-- Range types + GiST: the && (overlaps) operator is index-assisted.
-- btree_gist (an extension) lets one GiST index cover "room =" and "range &&".
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE INDEX idx_bookings_room_stay ON room_bookings
  USING gist (room, daterange(check_in, check_out, '[)'));

SELECT a.room,
       a.id AS booking_a,
       b.id AS booking_b,
       a.guest || ' / ' || b.guest AS guests,
       lower(daterange(a.check_in, a.check_out) * daterange(b.check_in, b.check_out)) AS overlap_from,
       upper(daterange(a.check_in, a.check_out) * daterange(b.check_in, b.check_out)) AS overlap_to
FROM room_bookings a
JOIN room_bookings b
  ON b.room = a.room
 AND a.id < b.id
 AND daterange(a.check_in, a.check_out, '[)') && daterange(b.check_in, b.check_out, '[)')
ORDER BY a.room, a.id, b.id;`,
  explanation: `<p><strong>Interval overlap test.</strong> Two half-open intervals overlap exactly when each starts before the other ends: <code>a.start &lt; b.end AND b.start &lt; a.end</code>. Using <code>&lt;</code> (not <code>&lt;=</code>) is what allows back-to-back bookings (#1 ends 10-04, #2 starts 10-04) to be legal.</p>
<ul>
<li><code>a.id &lt; b.id</code> reports each pair once and excludes self-matches.</li>
<li>The overlap window is <code>[greatest(starts), least(ends))</code>; with range types it is simply the intersection operator <code>*</code>.</li>
</ul>
<p><strong>Optimized.</strong> A B-tree cannot index "overlaps" (two-dimensional condition), so the plain self-join is O(n²) per room. PostgreSQL's <code>daterange</code> type and the <code>&amp;&amp;</code> operator are indexable with <strong>GiST</strong>; the <span class="tag ext">extension</span> <code>btree_gist</code> adds GiST support for the scalar <code>room</code> column so one index serves both predicates — each booking probes only nearby ranges: O(n log n).</p>
<div class="callout tip">Prevent overlaps instead of detecting them: <code>ALTER TABLE room_bookings ADD CONSTRAINT no_double_booking EXCLUDE USING gist (room WITH =, daterange(check_in, check_out) WITH &amp;&amp;);</code> — the database then rejects conflicting inserts atomically, even under concurrency.</div>`
},

{
  id: 'p30-payroll-rollup',
  title: 'Payroll Roll-up for Every Manager',
  difficulty: 'Hard',
  topic: 'Recursive queries',
  statement: `<p>For every employee who manages at least one person, compute the size and cost of their <strong>entire</strong> reporting tree (direct and indirect reports, excluding themselves): <code>manager_id</code>, <code>manager</code>, <code>direct_reports</code>, <code>total_reports</code>, <code>team_payroll</code>.</p>
<p>Order by team_payroll descending, then manager_id.</p>`,
  schema: `employees(id, first_name, last_name, manager_id → employees.id, salary)`,
  sampleData: `1 Asha (head) → 32 (team lead) → x ; 1 → 41 ; ...`,
  expected: `@@OUT p30`,
  hint: 'Build a transitive closure (ancestor, descendant) with WITH RECURSIVE: anchor = every direct (manager_id, id) edge, recursive step extends descendants downward. Then aggregate per ancestor.',
  solution: `WITH RECURSIVE closure AS (
  SELECT manager_id AS ancestor, id AS descendant, 1 AS depth
  FROM employees
  WHERE manager_id IS NOT NULL
  UNION ALL
  SELECT c.ancestor, e.id, c.depth + 1
  FROM closure c
  JOIN employees e ON e.manager_id = c.descendant
)
SELECT c.ancestor                         AS manager_id,
       m.first_name || ' ' || m.last_name AS manager,
       count(*) FILTER (WHERE c.depth = 1) AS direct_reports,
       count(*)                            AS total_reports,
       sum(d.salary)                       AS team_payroll
FROM closure c
JOIN employees m ON m.id = c.ancestor
JOIN employees d ON d.id = c.descendant
GROUP BY c.ancestor, m.first_name, m.last_name
ORDER BY team_payroll DESC, manager_id;`,
  optimized: `-- Bottom-up alternative: walk UP from each employee once (path length = depth),
-- carrying the employee's salary; avoids re-joining employees for salaries.
CREATE INDEX idx_employees_manager ON employees (manager_id);

WITH RECURSIVE up AS (
  SELECT id AS emp, manager_id AS ancestor, salary, 1 AS depth
  FROM employees
  WHERE manager_id IS NOT NULL
  UNION ALL
  SELECT u.emp, e.manager_id, u.salary, u.depth + 1
  FROM up u
  JOIN employees e ON e.id = u.ancestor          -- primary-key lookup
  WHERE e.manager_id IS NOT NULL
),
agg AS (
  SELECT ancestor,
         count(*) FILTER (WHERE depth = 1) AS direct_reports,
         count(*)                          AS total_reports,
         sum(salary)                       AS team_payroll
  FROM up
  GROUP BY ancestor
)
SELECT a.ancestor AS manager_id,
       m.first_name || ' ' || m.last_name AS manager,
       a.direct_reports, a.total_reports, a.team_payroll
FROM agg a
JOIN employees m ON m.id = a.ancestor
ORDER BY a.team_payroll DESC, manager_id;`,
  explanation: `<p><strong>Transitive closure.</strong> Hierarchy roll-ups need every (ancestor, descendant) pair, not just direct edges. The recursive CTE starts with direct edges (depth 1) and extends each pair one level down per iteration until no new pairs appear. Row count of the closure = Σ(depth of each employee) — for shallow org charts that is ~2–3× the employee count.</p>
<ul>
<li><code>count(*) FILTER (WHERE depth = 1)</code> separates direct from total reports in one aggregate.</li>
<li>Team leads (e.g. id 32) appear both as managers of their reports <em>and</em> as descendants of their head — so the head's payroll correctly includes the lead's team.</li>
</ul>
<p><strong>Optimized.</strong> Walking <em>upward</em> follows the primary key (<code>e.id = u.ancestor</code>), always an index lookup, and carries each employee's salary along so no extra join is needed at the end. Downward walking needs an index on <code>manager_id</code> (missing by default). For very large or frequently queried trees, store the hierarchy as an <span class="tag ext">extension</span> <code>ltree</code> path or a maintained closure table.</p>`
},

{
  id: 'p31-pareto-products',
  title: 'Pareto: Products Making 80% of Revenue',
  difficulty: 'Hard',
  topic: 'Running totals',
  statement: `<p>Rank products by non-cancelled revenue (highest first) and return the <strong>smallest set</strong> of top products whose combined revenue reaches at least <strong>80%</strong> of total revenue.</p>
<p>Return <code>rank</code>, <code>sku</code>, <code>name</code>, <code>revenue</code>, <code>cum_pct</code> (cumulative %, 2 decimals).</p>`,
  schema: `products(id, sku, name)
orders(id, status)
order_items(order_id, product_id, quantity, unit_price)`,
  sampleData: `SKU-0081 → 9,800,000 (4.1%), SKU-0074 → 9,500,000 (cum 8.1%) ...`,
  expected: `@@OUT p31`,
  hint: 'Running sum ordered by revenue DESC. Keep a row while the running total BEFORE it (cum − revenue) is still below 80% — that includes the row that crosses the threshold.',
  solution: `WITH rev AS (
  SELECT oi.product_id, sum(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY oi.product_id
),
cum AS (
  SELECT product_id, revenue,
         row_number() OVER (ORDER BY revenue DESC, product_id)      AS rank,
         sum(revenue) OVER (ORDER BY revenue DESC, product_id)      AS running,
         sum(revenue) OVER ()                                        AS total
  FROM rev
)
SELECT c.rank, p.sku, p.name, c.revenue,
       round(100 * c.running / c.total, 2) AS cum_pct
FROM cum c
JOIN products p ON p.id = c.product_id
WHERE c.running - c.revenue < 0.8 * c.total
ORDER BY c.rank;`,
  explanation: `<p><strong>Running total with a stopping rule.</strong> "Smallest set reaching 80%" means: include products until the cumulative share first meets 80%, <em>including</em> the product that crosses it. The test <code>running − revenue &lt; 0.8 × total</code> asks "before adding this product were we still short?" — exactly right, and it avoids an off-by-one that <code>running &lt;= 0.8 × total</code> would cause.</p>
<ul>
<li>The window <code>ORDER BY revenue DESC, product_id</code> has a unique key, so the default RANGE frame behaves like ROWS (no peer groups).</li>
<li><code>sum(revenue) OVER ()</code> (empty window) attaches the grand total to every row in the same pass.</li>
<li>Three window functions with two distinct window specs → two WindowAgg nodes over a 100-row input; negligible.</li>
</ul>
<p><strong>Why it matters.</strong> Pareto (ABC) analysis drives inventory policy: "A" items get tighter stock control and better shelf space. With uniformly random demo data the curve is flatter than in real retail, where ~20% of SKUs usually deliver ~80% of revenue.</p>
<p><strong>Complexity.</strong> Dominated by the join + aggregation of order_items: O(n). Index on <code>orders(status)</code> would not help (status is low-selectivity).</p>`
},

{
  id: 'p32-yoy-monthly-pivot',
  title: 'Year-over-Year Revenue by Month',
  difficulty: 'Hard',
  topic: 'Complex reporting',
  statement: `<p>Produce a pivot of non-cancelled revenue for months <strong>January–September</strong>: one row per month with columns <code>rev_2024</code>, <code>rev_2025</code>, <code>yoy_pct</code> (1 decimal), plus a final <strong>TOTAL</strong> row. Month labels are <code>Jan</code>, <code>Feb</code>, ...</p>`,
  schema: `orders(id, status, order_date timestamptz, total_amount)`,
  sampleData: `2024-01 → 2.3M, 2025-01 → 2.6M → +13.0%`,
  expected: `@@OUT p32`,
  hint: 'Group by month number with sum(...) FILTER (WHERE year = 2024 / 2025). Use GROUPING SETS ((m), ()) or ROLLUP to add the total row; grouping() tells you which row is the total.',
  solution: `WITH base AS (
  SELECT extract(month FROM order_date)::int AS m,
         extract(year  FROM order_date)::int AS y,
         total_amount
  FROM orders
  WHERE status <> 'cancelled'
    AND order_date >= DATE '2024-01-01'
    AND order_date <  DATE '2025-10-01'
    AND extract(month FROM order_date) <= 9
)
SELECT CASE WHEN grouping(m) = 1 THEN 'TOTAL'
            ELSE to_char(make_date(2000, m, 1), 'Mon') END       AS month,
       sum(total_amount) FILTER (WHERE y = 2024)                  AS rev_2024,
       sum(total_amount) FILTER (WHERE y = 2025)                  AS rev_2025,
       round(100 * (sum(total_amount) FILTER (WHERE y = 2025)
                  - sum(total_amount) FILTER (WHERE y = 2024))
             / sum(total_amount) FILTER (WHERE y = 2024), 1)      AS yoy_pct
FROM base
GROUP BY ROLLUP (m)
ORDER BY grouping(m), m;`,
  optimized: `CREATE INDEX idx_orders_order_date ON orders (order_date);

-- Aggregate to 18 (year, month) rows FIRST, then pivot + rollup the tiny set.
-- The two sargable date ranges use the index; no per-row extract() filter.
WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS mon, sum(total_amount) AS rev
  FROM orders
  WHERE status <> 'cancelled'
    AND (   (order_date >= DATE '2024-01-01' AND order_date < DATE '2024-10-01')
         OR (order_date >= DATE '2025-01-01' AND order_date < DATE '2025-10-01'))
  GROUP BY 1
),
p AS (
  SELECT extract(month FROM mon)::int AS m,
         sum(rev) FILTER (WHERE extract(year FROM mon) = 2024) AS rev_2024,
         sum(rev) FILTER (WHERE extract(year FROM mon) = 2025) AS rev_2025
  FROM monthly
  GROUP BY ROLLUP (1)
)
SELECT COALESCE(to_char(make_date(2000, m, 1), 'Mon'), 'TOTAL') AS month,
       rev_2024, rev_2025,
       round(100 * (rev_2025 - rev_2024) / rev_2024, 1) AS yoy_pct
FROM p
ORDER BY m IS NULL, m;`,
  explanation: `<p><strong>Three techniques combined.</strong></p>
<ul>
<li><strong>Pivot with FILTER</strong>: one column per year from a single scan.</li>
<li><strong>ROLLUP (m)</strong> = <code>GROUPING SETS ((m), ())</code>: the extra empty grouping set produces the grand-total row in the same query. <code>grouping(m)</code> returns 1 on that row, which is more reliable than testing <code>m IS NULL</code> (a real group could be NULL).</li>
<li><strong>Month label</strong>: <code>make_date(2000, m, 1)</code> builds any date in that month so <code>to_char(..., 'Mon')</code> prints the name while we still sort numerically.</li>
</ul>
<p>Year-over-year compares the <em>same</em> calendar month across years, removing seasonality that month-over-month growth would include.</p>
<p><strong>Optimized.</strong> The first version applies <code>extract(month ...) &lt;= 9</code> to every row, which is not index-friendly. The optimized version expresses the two periods as sargable ranges (index range scans), collapses to at most 18 monthly rows, and only then pivots and rolls up — the expensive part touches each order once with no function on the indexed column.</p>`
},

{
  id: 'p33-status-durations',
  title: 'Time Spent in Each Order Status',
  difficulty: 'Hard',
  topic: 'Date calculations',
  setup: `DROP TABLE IF EXISTS order_status_history;
CREATE TEMP TABLE order_status_history (
  order_id   int       NOT NULL,
  status     text      NOT NULL,
  changed_at timestamp NOT NULL,
  PRIMARY KEY (order_id, changed_at)
);
INSERT INTO order_status_history VALUES
 (1,'pending','2025-09-01 10:00'),(1,'paid','2025-09-01 10:20'),(1,'shipped','2025-09-02 15:20'),(1,'delivered','2025-09-04 09:00'),
 (2,'pending','2025-09-01 11:00'),(2,'paid','2025-09-01 13:00'),(2,'shipped','2025-09-05 13:00'),(2,'delivered','2025-09-08 13:00'),
 (3,'pending','2025-09-02 08:00'),(3,'cancelled','2025-09-02 20:00'),
 (4,'pending','2025-09-03 09:00'),(4,'paid','2025-09-03 09:05'),(4,'shipped','2025-09-03 21:05'),(4,'delivered','2025-09-05 09:05'),
 (5,'pending','2025-09-04 12:00'),(5,'paid','2025-09-04 12:30'),(5,'shipped','2025-09-07 12:30');`,
  statement: `<p>An order's status history is a list of transitions. The time an order spends in a status is from that row's <code>changed_at</code> until the <strong>next</strong> transition of the same order. Terminal/current statuses (no next row) are excluded.</p>
<p>For each status return <code>status</code>, <code>transitions</code> (completed stays measured), <code>avg_hours</code>, <code>max_hours</code> (1 decimal) and <code>slowest_order</code> (order with the longest stay; lowest id on ties). Order by avg_hours descending.</p>`,
  schema: `order_status_history(order_id int, status text, changed_at timestamp)   -- created by the setup script`,
  sampleData: ` order_id | status  | changed_at
----------+---------+------------------
        1 | pending | 2025-09-01 10:00
        1 | paid    | 2025-09-01 10:20
        1 | shipped | 2025-09-02 15:20`,
  expected: `@@OUT p33`,
  hint: 'lead(changed_at) OVER (PARTITION BY order_id ORDER BY changed_at) is when the status ended. Convert the interval to hours with extract(epoch FROM ...) / 3600. For the slowest order use (array_agg(order_id ORDER BY hours DESC, order_id))[1].',
  solution: `WITH stays AS (
  SELECT order_id, status, changed_at,
         lead(changed_at) OVER (PARTITION BY order_id ORDER BY changed_at) AS ended_at
  FROM order_status_history
),
measured AS (
  SELECT order_id, status,
         extract(epoch FROM ended_at - changed_at) / 3600.0 AS hours
  FROM stays
  WHERE ended_at IS NOT NULL
)
SELECT status,
       count(*)                                         AS transitions,
       round(avg(hours), 1)                             AS avg_hours,
       round(max(hours), 1)                             AS max_hours,
       (array_agg(order_id ORDER BY hours DESC, order_id))[1] AS slowest_order
FROM measured
GROUP BY status
ORDER BY avg_hours DESC;`,
  explanation: `<p><strong>From events to durations.</strong> Event tables store <em>points</em> in time; durations live <em>between</em> consecutive points. <code>lead()</code> pairs each event with the next one of the same order, turning point events into intervals <code>[changed_at, ended_at)</code>.</p>
<ul>
<li>Rows where <code>lead()</code> is NULL are the current/terminal status — their duration is unknown (still running) and must be excluded, or reported separately against <code>now()</code> as "aging".</li>
<li><code>extract(epoch FROM interval)</code> returns seconds as numeric; dividing by 3600 gives fractional hours. Do <em>not</em> use <code>extract(hour FROM interval)</code> — that returns only the hours <em>field</em> (0–23), ignoring days.</li>
<li><code>(array_agg(x ORDER BY ...))[1]</code> is the "arg-max" idiom: the order id belonging to the maximum duration, in one pass.</li>
</ul>
<p><strong>Performance.</strong> The primary key <code>(order_id, changed_at)</code> exactly matches <code>PARTITION BY order_id ORDER BY changed_at</code>, so the window can read the index in order without sorting. This is why event tables should be keyed by (entity, time).</p>
<div class="callout tip">Use this to set SLAs: if "paid → shipped" averages 50 hours but the promise is 24, the fulfilment step is the bottleneck.</div>`
},

{
  id: 'p34-top3-plus-other',
  title: 'Top 3 Products per Category + "Other" Bucket',
  difficulty: 'Hard',
  topic: 'Ranking',
  statement: `<p>For a category dashboard, show the 3 highest-revenue products in each category (non-cancelled orders) and collapse <strong>all remaining products</strong> of that category into one row labelled <code>Other (N products)</code>.</p>
<p>Return <code>category</code>, <code>position</code> (1–3, or 4 for Other), <code>product</code>, <code>revenue</code>, <code>share_pct</code> (share of the category, 1 decimal). Order by category, position.</p>`,
  schema: `products(id, name, category)
orders(id, status)
order_items(order_id, product_id, quantity, unit_price)`,
  sampleData: `audio: Speaker X 31 → 6.1M, Headphones 41 → 5.2M, ... remaining 7 → Other`,
  expected: `@@OUT p34`,
  hint: 'row_number() per category, then GROUP BY category and least(rn, 4): ranks 1–3 stay single rows, everything ranked 4+ merges. Label with CASE on min(rn).',
  solution: `WITH rev AS (
  SELECT p.id, p.name, p.category, sum(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN orders   o ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id
  WHERE o.status <> 'cancelled'
  GROUP BY p.id, p.name, p.category
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY category ORDER BY revenue DESC, id) AS rn
  FROM rev
)
SELECT category,
       least(rn, 4) AS position,
       CASE WHEN min(rn) <= 3 THEN min(name)
            ELSE 'Other (' || count(*) || ' products)' END AS product,
       sum(revenue) AS revenue,
       round(100 * sum(revenue) / sum(sum(revenue)) OVER (PARTITION BY category), 1) AS share_pct
FROM ranked
GROUP BY category, least(rn, 4)
ORDER BY category, position;`,
  explanation: `<p><strong>Grouping by a computed bucket.</strong> <code>least(rn, 4)</code> maps ranks 1, 2, 3 to themselves and every rank ≥ 4 to 4. Grouping by it keeps the top 3 as individual rows and merges the long tail — the classic "top N + others" shape used in pie charts and executive dashboards.</p>
<ul>
<li>For buckets 1–3 the group has one row, so <code>min(name)</code> is just that product's name.</li>
<li><code>sum(sum(revenue)) OVER (PARTITION BY category)</code>: window over grouped rows gives the category total for the share column without another join.</li>
<li><code>row_number()</code> (not rank) guarantees exactly three named rows even with ties; the <code>id</code> tie-breaker makes it deterministic.</li>
</ul>
<p><strong>Complexity.</strong> One join+aggregate over order_items (O(n)), one sort of 100 product rows for ranking, one tiny aggregation. A UNION ALL version (top-3 query + "rest" query) would scan and aggregate the facts twice.</p>`
},

{
  id: 'p35-bom-explosion',
  title: 'Bill of Materials Explosion',
  difficulty: 'Hard',
  topic: 'Recursive queries',
  setup: `DROP TABLE IF EXISTS bom;
CREATE TEMP TABLE bom (
  parent text NOT NULL,
  child  text NOT NULL,
  qty    int  NOT NULL CHECK (qty > 0),
  PRIMARY KEY (parent, child)
);
INSERT INTO bom VALUES
 ('bicycle','frame',1), ('bicycle','wheel',2), ('bicycle','drivetrain',1), ('bicycle','bolt_m6',4),
 ('wheel','rim',1), ('wheel','spoke',32), ('wheel','tyre',1), ('wheel','hub',1),
 ('hub','bearing',2), ('hub','bolt_m6',1),
 ('drivetrain','chain',1), ('drivetrain','crank',2), ('drivetrain','gear',3),
 ('crank','bolt_m6',2), ('frame','bolt_m6',6);`,
  statement: `<p>A bill of materials lists which components (and how many) make up each assembly; components can themselves be assemblies, and the same part (<code>bolt_m6</code>) can appear at several levels.</p>
<p>To build <strong>10 bicycles</strong>, how many of each <strong>leaf part</strong> (a part that is not itself an assembly) are needed? Return <code>part</code>, <code>total_qty</code>, ordered by total_qty descending, then part.</p>`,
  schema: `bom(parent text, child text, qty int)   -- created by the setup script`,
  sampleData: ` parent  | child | qty
---------+-------+----
 bicycle | wheel |   2
 wheel   | spoke |  32
 wheel   | hub   |   1
 hub     | bearing | 2`,
  expected: `@@OUT p35`,
  hint: 'Recursive CTE carrying a multiplied quantity: anchor = children of bicycle with qty*10; recursive step multiplies by the next level\'s qty. Keep only leaves (NOT EXISTS as parent) and SUM per part.',
  solution: `WITH RECURSIVE explode AS (
  SELECT child AS part, qty * 10 AS qty
  FROM bom
  WHERE parent = 'bicycle'
  UNION ALL
  SELECT b.child, e.qty * b.qty
  FROM explode e
  JOIN bom b ON b.parent = e.part
)
SELECT part, sum(qty) AS total_qty
FROM explode e
WHERE NOT EXISTS (SELECT 1 FROM bom b WHERE b.parent = e.part)
GROUP BY part
ORDER BY total_qty DESC, part;`,
  optimized: `-- Same traversal with the SQL-standard CYCLE clause (PG14+) so a data error
-- such as 'hub contains wheel' cannot loop forever, plus the depth and path
-- for auditing. bom's PK (parent, child) already indexes the join key.
WITH RECURSIVE explode AS (
  SELECT child AS part, qty * 10 AS qty, 1 AS depth
  FROM bom
  WHERE parent = 'bicycle'
  UNION ALL
  SELECT b.child, e.qty * b.qty, e.depth + 1
  FROM explode e
  JOIN bom b ON b.parent = e.part
) CYCLE part SET is_cycle USING path
SELECT part, sum(qty) AS total_qty
FROM explode e
WHERE NOT is_cycle
  AND NOT EXISTS (SELECT 1 FROM bom b WHERE b.parent = e.part)
GROUP BY part
ORDER BY total_qty DESC, part;`,
  explanation: `<p><strong>Multiplicative recursion.</strong> Each recursive step carries the quantity needed so far and multiplies by the next level's quantity: 10 bicycles × 2 wheels × 1 hub × 2 bearings = 40 bearings.</p>
<ul>
<li><strong>Shared parts</strong>: <code>bolt_m6</code> is reached through 4 different paths (bicycle, hub, crank, frame). Each path produces its own row; <code>sum()</code> adds them: 10×4 + 10×2×1×1 + 10×1×2×2 + 10×1×6 = 160.</li>
<li><strong>Leaves</strong> are parts that never appear as a parent — tested with <code>NOT EXISTS</code>. Intermediate assemblies (wheel, hub...) are excluded because we buy parts, not assemblies.</li>
<li><strong>UNION ALL</strong> is mandatory: UNION would wrongly merge two identical (part, qty) rows coming from different paths.</li>
</ul>
<p><strong>Optimized.</strong> The <code>CYCLE</code> clause tracks visited parts per path and stops if a part reappears in its own ancestry — real BOM data does get corrupted. The <code>(parent, child)</code> primary key serves the recursive join's <code>b.parent = e.part</code> lookup, so each step is an index probe.</p>
<div class="callout info">This is the core of MRP (material requirements planning). Production versions also subtract on-hand stock at each level and account for lead times.</div>`
},

{
  id: 'p36-moving-average-calendar',
  title: '7-Day Moving Average with Zero-Filled Days',
  difficulty: 'Hard',
  topic: 'Date calculations',
  statement: `<p>For the <strong>furniture</strong> category, compute daily revenue (non-cancelled orders) for every day of <strong>September 2025</strong> — days with no furniture sales must appear with revenue 0 — and a trailing <strong>7-day moving average</strong> (<code>ma7</code>, 2 decimals) that also counts zero days. The first days of September must use late-August data for their window.</p>
<p>Return <code>day</code>, <code>revenue</code>, <code>ma7</code>.</p>`,
  schema: `products(id, category)
orders(id, status, order_date timestamptz)
order_items(order_id, product_id, quantity, unit_price)`,
  sampleData: `2025-09-01 → 0.00 (no furniture sold) ; 2025-09-02 → 160,500.00 ...`,
  expected: `@@OUT p36`,
  hint: 'generate_series(\'2025-08-26\', \'2025-09-30\', interval \'1 day\') builds a calendar; LEFT JOIN daily sales and COALESCE to 0; avg(...) OVER (ORDER BY day ROWS 6 PRECEDING); filter September in an OUTER query.',
  solution: `WITH calendar AS (
  SELECT d::date AS day
  FROM generate_series(DATE '2025-08-26', DATE '2025-09-30', INTERVAL '1 day') AS d
),
daily AS (
  SELECT o.order_date::date AS day, sum(oi.quantity * oi.unit_price) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN products p    ON p.id = oi.product_id
  WHERE p.category = 'furniture'
    AND o.status <> 'cancelled'
    AND o.order_date >= DATE '2025-08-26'
    AND o.order_date <  DATE '2025-10-01'
  GROUP BY 1
),
filled AS (
  SELECT c.day, COALESCE(d.revenue, 0) AS revenue
  FROM calendar c
  LEFT JOIN daily d USING (day)
),
smoothed AS (
  SELECT day, revenue,
         round(avg(revenue) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS ma7
  FROM filled
)
SELECT day, revenue, ma7
FROM smoothed
WHERE day >= DATE '2025-09-01'
ORDER BY day;`,
  optimized: `CREATE INDEX idx_orders_order_date ON orders (order_date);
CREATE INDEX idx_products_category ON products (category);

-- Dense calendar is required for a correct ROWS frame; sum()/7 instead of avg()
-- makes the "zero days count" rule explicit, and furniture product ids are
-- resolved first so order_items is filtered by a small id list.
WITH furniture AS (
  SELECT id FROM products WHERE category = 'furniture'
),
daily AS (
  SELECT o.order_date::date AS day, sum(oi.quantity * oi.unit_price) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE oi.product_id IN (SELECT id FROM furniture)
    AND o.status <> 'cancelled'
    AND o.order_date >= DATE '2025-08-26'
    AND o.order_date <  DATE '2025-10-01'
  GROUP BY 1
),
filled AS (
  SELECT c.day::date AS day, COALESCE(d.revenue, 0) AS revenue
  FROM generate_series(DATE '2025-08-26', DATE '2025-09-30', INTERVAL '1 day') AS c(day)
  LEFT JOIN daily d ON d.day = c.day::date
)
SELECT day, revenue, ma7
FROM (
  SELECT day, revenue,
         round(sum(revenue) OVER (ORDER BY day ROWS 6 PRECEDING) / 7, 2) AS ma7
  FROM filled
) s
WHERE day >= DATE '2025-09-01'
ORDER BY day;`,
  explanation: `<p><strong>Why the calendar is essential.</strong> A <code>ROWS 6 PRECEDING</code> frame counts <em>rows</em>, not days. If zero-sale days are simply missing, "the previous 6 rows" may span 10 calendar days and the average divides by the wrong count. <code>generate_series</code> creates one row per day; LEFT JOIN + COALESCE fills gaps with 0.</p>
<ul>
<li><strong>Warm-up</strong>: the calendar starts on 26 August so that 1 September already has six preceding days. The September filter must be applied in an <em>outer</em> query: filtering in the same SELECT as the window would remove August rows <em>before</em> the window sees them.</li>
<li>Alternative without a calendar: <code>RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW</code> works on sparse dates (PostgreSQL 11+), but you would still need the calendar to <em>display</em> zero days and to divide by 7.</li>
</ul>
<p><strong>Optimized.</strong> Indexes on <code>orders(order_date)</code> and <code>products(category)</code> (both deliberately missing) let the planner touch only five weeks of orders. <code>sum()/7</code> states the business rule — every window is 7 calendar days — explicitly; in September both formulas agree because the calendar is dense.</p>`
}
];

/* =====================================================================
   PATTERN LIBRARY
   ===================================================================== */
PGM.PATTERNS = [
{
  id: 'find-duplicates',
  title: 'Find duplicates',
  category: 'Data quality',
  sql: `-- Rows sharing the same (first_name, last_name), with their ids
SELECT first_name, last_name,
       count(*)                  AS copies,
       array_agg(id ORDER BY id) AS ids
FROM employees
GROUP BY first_name, last_name
HAVING count(*) > 1
ORDER BY copies DESC, first_name, last_name
LIMIT 10;`,
  explain: `<p><strong>How it works.</strong> GROUP BY the columns that define "the same entity", keep groups with more than one row via <code>HAVING</code>, and collect ids with <code>array_agg</code> so you can inspect or merge them.</p>
<p><strong>When to use.</strong> Before adding a UNIQUE constraint, after bulk imports, or when auditing data quality.</p>
<div class="callout warn"><strong>Gotchas:</strong> NULLs are grouped together by GROUP BY but are <em>not</em> equal for UNIQUE constraints (unless <code>UNIQUE NULLS NOT DISTINCT</code>, PG15+). Normalize before grouping (<code>lower(trim(email))</code>) or "Asha@x.com" and "asha@x.com " look distinct.</div>`,
  run: true
},
{
  id: 'delete-duplicates',
  title: 'Delete duplicates (keep lowest id)',
  category: 'Data quality',
  sql: `-- Work on a copy so the demo does not touch the real table
DROP TABLE IF EXISTS emp_names;
CREATE TEMP TABLE emp_names AS
SELECT id, first_name, last_name FROM employees;

-- Delete every row that has a twin with a smaller id
DELETE FROM emp_names a
USING emp_names b
WHERE a.first_name = b.first_name
  AND a.last_name  = b.last_name
  AND a.id > b.id;

-- Alternative (better for many copies per key):
-- DELETE FROM t WHERE id IN (
--   SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY key ORDER BY id) rn FROM t) x
--   WHERE rn > 1);

SELECT count(*) AS remaining, count(DISTINCT (first_name, last_name)) AS distinct_names
FROM emp_names;`,
  explain: `<p><strong>How it works.</strong> <code>DELETE ... USING</code> joins the table to itself; a row is deleted when another row with the same key has a smaller id, so the lowest id per key survives.</p>
<p><strong>When to use.</strong> One-off cleanups before adding a UNIQUE constraint. For keys with many copies, prefer the <code>row_number()</code> variant (one sort instead of k² pairs).</p>
<div class="callout danger"><strong>Gotchas:</strong> run it in a transaction and check the count first; re-point foreign keys from duplicates to the survivor before deleting; then add a unique index so duplicates cannot return. On huge tables delete in batches to limit lock time and WAL bursts.</div>`,
  run: true
},
{
  id: 'second-highest-salary',
  title: 'Second highest salary',
  category: 'Ranking',
  sql: `-- Returns one row; NULL if there is no second distinct salary
SELECT max(salary) AS second_highest
FROM employees
WHERE salary < (SELECT max(salary) FROM employees);`,
  explain: `<p><strong>How it works.</strong> The highest salary strictly below the maximum. Because it is an aggregate, it always returns exactly one row (NULL when nothing qualifies) — which is what most callers expect from a scalar question.</p>
<p><strong>Gotchas:</strong> <code>ORDER BY salary DESC LIMIT 1 OFFSET 1</code> without <code>DISTINCT</code> returns the top salary again when two people share it, and returns <em>zero rows</em> when there is no second value. With an index on <code>salary</code> each <code>max()</code> is an O(log n) index probe.</p>`,
  run: true
},
{
  id: 'nth-highest-salary',
  title: 'Nth highest salary',
  category: 'Ranking',
  sql: `-- N = 3 : third highest DISTINCT salary, with everyone who earns it
SELECT id, first_name, last_name, salary
FROM (
  SELECT id, first_name, last_name, salary,
         dense_rank() OVER (ORDER BY salary DESC) AS rnk
  FROM employees
) r
WHERE rnk = 3
ORDER BY id;

-- Scalar alternative:
-- SELECT (SELECT DISTINCT salary FROM employees ORDER BY salary DESC OFFSET 3 - 1 LIMIT 1);`,
  explain: `<p><strong>How it works.</strong> <code>dense_rank()</code> numbers distinct salaries 1, 2, 3 without gaps, so <code>rnk = N</code> is exactly the Nth distinct value — and returns all employees who earn it.</p>
<p><strong>When to use.</strong> Interview classic; in practice for "Nth best" leaderboards. Use <code>rank()</code> if ties should consume positions (1,1,3), <code>row_number()</code> for exactly one row.</p>
<p><strong>Gotchas:</strong> the window version sorts the whole table (O(n log n)); for a single scalar on an indexed column the <code>DISTINCT ... OFFSET N-1 LIMIT 1</code> form can stop early.</p>`,
  run: true
},
{
  id: 'top-n-per-group',
  title: 'Top N per group',
  category: 'Ranking',
  sql: `-- Top 3 earners in every department (window version)
SELECT department_id, id, first_name, last_name, salary
FROM (
  SELECT e.*, row_number() OVER (PARTITION BY department_id
                                 ORDER BY salary DESC, id) AS rn
  FROM employees e
) t
WHERE rn <= 3
ORDER BY department_id, rn;

-- LATERAL version: best with an index on (department_id, salary DESC)
SELECT d.name, top.first_name, top.last_name, top.salary
FROM departments d
CROSS JOIN LATERAL (
  SELECT first_name, last_name, salary
  FROM employees e
  WHERE e.department_id = d.id
  ORDER BY salary DESC, id
  LIMIT 3
) top
ORDER BY d.name, top.salary DESC;`,
  explain: `<p><strong>How it works.</strong> The window version ranks every row inside its partition and filters <code>rn &lt;= N</code> in an outer query. The <code>LATERAL</code> version runs a small "ORDER BY ... LIMIT N" subquery per group.</p>
<p><strong>When to use which.</strong> Window: few rows per group or no suitable index. LATERAL: many rows per group and an index on <code>(group_col, sort_col)</code> — each group then reads only N index entries instead of sorting the whole partition.</p>
<p><strong>Gotchas:</strong> pick <code>row_number</code> / <code>rank</code> / <code>dense_rank</code> deliberately for ties; always add a unique tie-breaker for deterministic output.</p>`,
  run: true
},
{
  id: 'running-total',
  title: 'Running total',
  category: 'Window functions',
  sql: `-- Daily revenue and a running total that resets each month
WITH daily AS (
  SELECT order_date::date AS day, sum(total_amount) AS revenue
  FROM orders
  WHERE status <> 'cancelled'
    AND order_date >= DATE '2025-08-01' AND order_date < DATE '2025-10-01'
  GROUP BY 1
)
SELECT day, revenue,
       sum(revenue) OVER (PARTITION BY date_trunc('month', day)
                          ORDER BY day
                          ROWS UNBOUNDED PRECEDING) AS month_to_date
FROM daily
ORDER BY day;`,
  explain: `<p><strong>How it works.</strong> <code>sum() OVER (ORDER BY ...)</code> accumulates row by row; <code>PARTITION BY</code> restarts the total per month (month-to-date).</p>
<p><strong>Gotchas:</strong> without an explicit frame the default is <code>RANGE UNBOUNDED PRECEDING</code>, which gives all rows with the same ORDER BY value the <em>same</em> total. Use <code>ROWS UNBOUNDED PRECEDING</code> for strict row-by-row totals (also slightly faster). Aggregate to the reporting grain first, then window.</p>`,
  run: true
},
{
  id: 'previous-row-lag',
  title: 'Previous row (LAG)',
  category: 'Window functions',
  sql: `-- Days since the customer's previous order
SELECT customer_id, id AS order_id, order_date::date AS order_day,
       lag(order_date::date) OVER w                     AS prev_order_day,
       order_date::date - lag(order_date::date) OVER w  AS days_since_prev
FROM orders
WHERE customer_id IN (58, 417)
WINDOW w AS (PARTITION BY customer_id ORDER BY order_date, id)
ORDER BY customer_id, order_date, id;`,
  explain: `<p><strong>How it works.</strong> <code>lag(expr, offset := 1, default := NULL)</code> returns the value from an earlier row in the window order — no self-join needed. <code>lag(x, 12)</code> on monthly data gives "same month last year".</p>
<p><strong>When to use.</strong> Deltas, churn gaps, time between events, change detection (<code>WHERE value IS DISTINCT FROM lag(value)</code>).</p>
<p><strong>Gotchas:</strong> the first row per partition gets NULL (or the default). LAG moves by <em>rows</em>, not time — missing days/months are skipped silently; join to a calendar if that matters.</p>`,
  run: true
},
{
  id: 'next-row-lead',
  title: 'Next row (LEAD)',
  category: 'Window functions',
  sql: `-- Each employee's next hire in the same department, and the wait in days
SELECT department_id, id, first_name, hire_date,
       lead(first_name) OVER w                AS next_hire,
       lead(hire_date)  OVER w - hire_date    AS days_until_next_hire
FROM employees
WHERE department_id = 4
WINDOW w AS (PARTITION BY department_id ORDER BY hire_date, id)
ORDER BY hire_date, id
LIMIT 10;`,
  explain: `<p><strong>How it works.</strong> <code>lead()</code> looks forward in the window order. It is the natural tool to convert point events into intervals: each row's "end" is the next row's "start" (status durations, price validity periods, sessions).</p>
<p><strong>Gotchas:</strong> the last row per partition has no next row (NULL) — treat it as "still open" rather than dropping it blindly. Name the window once with <code>WINDOW w AS (...)</code> so all functions share one sort.</p>`,
  run: true
},
{
  id: 'gaps-and-islands',
  title: 'Gaps and islands',
  category: 'Time series',
  sql: `-- Islands: runs of consecutive days in 2025 with at least 10 orders
WITH busy AS (
  SELECT order_date::date AS d
  FROM orders
  WHERE order_date >= DATE '2025-01-01' AND order_date < DATE '2026-01-01'
  GROUP BY 1
  HAVING count(*) >= 10
),
grp AS (
  SELECT d, d - (row_number() OVER (ORDER BY d))::int AS island
  FROM busy
)
SELECT min(d) AS streak_start, max(d) AS streak_end, count(*) AS days
FROM grp
GROUP BY island
HAVING count(*) >= 2
ORDER BY days DESC, streak_start
LIMIT 10;`,
  explain: `<p><strong>How it works.</strong> For consecutive values, value − row_number is constant; it changes at every gap. Grouping by that difference collapses each consecutive run ("island") into one row.</p>
<p><strong>When to use.</strong> Login/activity streaks, uptime/outage windows, consecutive sold-out days, missing id ranges.</p>
<p><strong>Gotchas:</strong> de-duplicate first (two rows for the same day would break the arithmetic). For fuzzy gaps ("within 30 minutes") use the LAG-flag + running-sum variant instead.</p>`,
  run: true
},
{
  id: 'calendar-generate-series',
  title: 'Date ranges / generate_series calendar',
  category: 'Time series',
  sql: `-- Every day of September 2025, including days with zero cancelled orders
SELECT c.day::date                        AS day,
       to_char(c.day, 'Dy')               AS weekday,
       count(o.id)                        AS cancelled_orders
FROM generate_series(DATE '2025-09-01', DATE '2025-09-30', INTERVAL '1 day') AS c(day)
LEFT JOIN orders o
       ON o.status = 'cancelled'
      AND o.order_date >= c.day
      AND o.order_date <  c.day + INTERVAL '1 day'
GROUP BY c.day
ORDER BY c.day;`,
  explain: `<p><strong>How it works.</strong> <code>generate_series(start, stop, step)</code> is a set-returning function that produces a dense calendar. LEFT JOIN facts onto it and <code>count(o.id)</code> (not <code>count(*)</code>) so empty days show 0.</p>
<p><strong>When to use.</strong> Charts that must not skip dates, moving averages with a ROWS frame, SLA/coverage reports, booking availability.</p>
<p><strong>Gotchas:</strong> join with a half-open timestamp range rather than <code>o.order_date::date = c.day</code> so an index on <code>order_date</code> remains usable. <code>generate_series</code> over <code>timestamptz</code> steps in the session time zone (DST days are 23/25 hours).</p>`,
  run: true
},
{
  id: 'monthly-report',
  title: 'Monthly reports',
  category: 'Reporting',
  sql: `SELECT to_char(date_trunc('month', order_date), 'YYYY-MM')            AS month,
       count(*)                                                         AS orders,
       count(DISTINCT customer_id)                                      AS customers,
       sum(total_amount) FILTER (WHERE status <> 'cancelled')           AS revenue,
       round(avg(total_amount) FILTER (WHERE status <> 'cancelled'), 2) AS avg_order_value,
       round(100.0 * count(*) FILTER (WHERE status = 'cancelled') / count(*), 1) AS cancel_rate_pct
FROM orders
WHERE order_date >= DATE '2025-01-01' AND order_date < DATE '2025-10-01'
GROUP BY 1
ORDER BY 1;`,
  explain: `<p><strong>How it works.</strong> <code>date_trunc('month', ts)</code> buckets timestamps; FILTER computes several KPIs (revenue, AOV, cancellation rate) in a single scan.</p>
<p><strong>When to use.</strong> Any management dashboard. For heavy dashboards pre-aggregate into a summary table or materialized view refreshed nightly.</p>
<p><strong>Gotchas:</strong> filter with a sargable range on the raw column; <code>WHERE date_trunc(...) = ...</code> defeats indexes. <code>date_trunc</code> on <code>timestamptz</code> uses the session time zone — pass the zone explicitly (3-arg form) for business reports.</p>`,
  run: true
},
{
  id: 'year-over-year-growth',
  title: 'Year-over-year growth',
  category: 'Reporting',
  sql: `WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS month,
         sum(total_amount) AS revenue
  FROM orders
  WHERE status <> 'cancelled'
    AND order_date >= DATE '2024-01-01' AND order_date < DATE '2025-10-01'
  GROUP BY 1
)
SELECT cur.month,
       cur.revenue,
       prev.revenue AS revenue_last_year,
       round(100 * (cur.revenue - prev.revenue) / NULLIF(prev.revenue, 0), 1) AS yoy_pct
FROM monthly cur
LEFT JOIN monthly prev ON prev.month = cur.month - INTERVAL '1 year'
WHERE cur.month >= DATE '2025-01-01'
ORDER BY cur.month;`,
  explain: `<p><strong>How it works.</strong> Join each month to the same month one year earlier by <em>date arithmetic</em> (<code>month - INTERVAL '1 year'</code>). This is safer than <code>lag(revenue, 12)</code>, which silently compares the wrong months if any month is missing.</p>
<p><strong>When to use.</strong> Seasonal businesses (retail, travel) where month-over-month growth is dominated by seasonality.</p>
<p><strong>Gotchas:</strong> <code>NULLIF(prev, 0)</code> prevents division-by-zero; LEFT JOIN keeps months that have no prior-year data (yoy_pct NULL).</p>`,
  run: true
},
{
  id: 'recursive-hierarchy',
  title: 'Recursive hierarchy',
  category: 'Hierarchies',
  sql: `-- Whole reporting tree of department head #3 with depth and readable path
WITH RECURSIVE tree AS (
  SELECT id, manager_id, first_name, 0 AS depth, first_name::text AS path
  FROM employees
  WHERE id = 3
  UNION ALL
  SELECT e.id, e.manager_id, e.first_name, t.depth + 1, t.path || ' > ' || e.first_name
  FROM employees e
  JOIN tree t ON e.manager_id = t.id
) CYCLE id SET is_cycle USING visited
SELECT depth, id, path
FROM tree
WHERE NOT is_cycle
ORDER BY depth, id
LIMIT 12;`,
  explain: `<p><strong>How it works.</strong> The anchor selects the root; the recursive term repeatedly joins children of the rows found in the previous iteration until none are left. <code>CYCLE ... SET ... USING</code> (PostgreSQL 14+, SQL standard) marks and stops loops caused by bad data.</p>
<p><strong>When to use.</strong> Org charts, category trees, threaded comments, bill of materials, graph reachability.</p>
<p><strong>Gotchas:</strong> index the parent column (<code>manager_id</code>) — every iteration probes it. Use UNION ALL plus a cycle guard rather than UNION. For read-heavy deep trees consider the <span class="tag ext">extension</span> <code>ltree</code> or a closure table.</p>`,
  run: true
},
{
  id: 'offset-pagination',
  title: 'OFFSET pagination',
  category: 'Pagination',
  sql: `-- Page 3, 20 rows per page  (OFFSET = (page - 1) * page_size)
SELECT id, customer_id, order_date, total_amount
FROM orders
ORDER BY order_date DESC, id DESC
LIMIT 20 OFFSET 40;`,
  explain: `<p><strong>How it works.</strong> PostgreSQL produces the first <code>OFFSET + LIMIT</code> rows in order and discards the first <code>OFFSET</code>.</p>
<p><strong>When to use.</strong> Admin screens with "jump to page N", small tables, shallow pages.</p>
<div class="callout warn"><strong>Gotchas:</strong> cost grows with the offset — page 10,000 reads 200,000 rows to return 20. Rows inserted/deleted between requests shift pages (duplicates or skipped rows). Always ORDER BY a unique key combination. For infinite scroll and APIs use keyset pagination.</div>`,
  run: true
},
{
  id: 'keyset-pagination',
  title: 'Keyset pagination',
  category: 'Pagination',
  sql: `-- Index matching the sort order makes every page an index range scan
CREATE INDEX IF NOT EXISTS idx_orders_date_id ON orders (order_date DESC, id DESC);

-- First page
SELECT id, order_date, total_amount
FROM orders
ORDER BY order_date DESC, id DESC
LIMIT 20;

-- Next page: pass the LAST row's (order_date, id) from the previous page
SELECT id, order_date, total_amount
FROM orders
WHERE (order_date, id) < (SELECT order_date, id FROM orders WHERE id = 1234)
ORDER BY order_date DESC, id DESC
LIMIT 20;`,
  explain: `<p><strong>How it works.</strong> Instead of skipping N rows, the next page starts <em>after</em> the last key the client saw. The row-value comparison <code>(order_date, id) &lt; (x, y)</code> compares lexicographically and matches a composite index, so each page costs O(log n + page size) regardless of depth.</p>
<p><strong>When to use.</strong> Infinite scroll, public APIs (cursor tokens), batch exports over big tables.</p>
<p><strong>Gotchas:</strong> the sort key must be unique (add <code>id</code> as tie-breaker); index direction must match the ORDER BY; you cannot jump to an arbitrary page number. In a real API the client sends the last values (often base64-encoded as a cursor) — the subquery here just simulates that.</p>`,
  run: true
},
{
  id: 'upsert',
  title: 'UPSERT (INSERT ... ON CONFLICT)',
  category: 'Writes',
  sql: `-- Insert a new SKU, or update price and add stock if the SKU exists
INSERT INTO products (sku, name, category, price, stock)
VALUES ('SKU-0001', 'Monitor Air 1', 'electronics', 4899.00, 25),
       ('SKU-9001', 'USB-C Dock Pro', 'accessories', 7499.00, 40)
ON CONFLICT (sku) DO UPDATE
   SET price = EXCLUDED.price,
       stock = products.stock + EXCLUDED.stock
   WHERE products.price IS DISTINCT FROM EXCLUDED.price
      OR EXCLUDED.stock > 0
RETURNING id, sku, price, stock, (xmax = 0) AS inserted;`,
  explain: `<p><strong>How it works.</strong> <code>ON CONFLICT (sku)</code> needs a unique index/constraint on the target. If the row exists, the DO UPDATE branch runs with <code>EXCLUDED</code> holding the proposed row; otherwise the row is inserted. It is atomic and concurrency-safe — no race between "check" and "insert".</p>
<p><strong>When to use.</strong> Syncing from external systems, counters, idempotent API writes. <code>DO NOTHING</code> for "insert if absent".</p>
<p><strong>Gotchas:</strong> the same key twice in one statement raises "ON CONFLICT DO UPDATE command cannot affect row a second time" — de-duplicate input first. A conflict still consumes an identity/sequence value. <code>(xmax = 0)</code> as "was inserted" is a widely used heuristic relying on internals, not a documented API. PostgreSQL 15+ also offers <code>MERGE</code> (and <code>MERGE ... RETURNING</code> in 17+).</p>`,
  run: true
},
{
  id: 'bulk-insert',
  title: 'Bulk insert (VALUES / INSERT...SELECT / unnest)',
  category: 'Writes',
  sql: `DROP TABLE IF EXISTS price_watch;
CREATE TEMP TABLE price_watch (sku text, target_price numeric(10,2), note text);

-- 1) Multi-row VALUES: one statement, one round trip
INSERT INTO price_watch VALUES
  ('SKU-0001', 4500, 'monitor'),
  ('SKU-0002', 50000, 'keyboard');

-- 2) INSERT ... SELECT: set-based copy from another table
INSERT INTO price_watch (sku, target_price, note)
SELECT sku, round(price * 0.9, 2), 'auto 10% off'
FROM products
WHERE category = 'audio';

-- 3) unnest parallel arrays: ideal for drivers sending arrays as 2-3 parameters
INSERT INTO price_watch (sku, target_price, note)
SELECT * FROM unnest(ARRAY['SKU-0010','SKU-0011'],
                     ARRAY[1000.00, 2000.00]::numeric[],
                     ARRAY['bulk a','bulk b']);

SELECT note, count(*) FROM price_watch GROUP BY note ORDER BY note;`,
  explain: `<p><strong>How it works.</strong> All three forms insert many rows in a single statement: one parse/plan, one transaction, far fewer round trips than row-by-row inserts.</p>
<ul><li><strong>VALUES</strong>: simplest; keep batches to a few thousand rows (65,535 bind-parameter limit per statement).</li>
<li><strong>INSERT ... SELECT</strong>: data already in the database — nothing leaves the server.</li>
<li><strong>unnest(arrays)</strong>: a fixed 2–3 parameters regardless of row count; great from application code.</li></ul>
<p><strong>Gotchas:</strong> for millions of rows <code>COPY</code> is fastest (client-side <code>\\copy</code> in psql). Drop/disable non-essential indexes for huge one-off loads and rebuild afterwards; run <code>ANALYZE</code> after loading.</p>`,
  run: true
},
{
  id: 'bulk-update',
  title: 'Bulk update (UPDATE ... FROM VALUES)',
  category: 'Writes',
  sql: `-- Apply a price list in ONE statement
UPDATE products p
SET price = v.new_price,
    stock = p.stock + v.restock
FROM (VALUES
        ('SKU-0001', 4999.00, 10),
        ('SKU-0002', 52999.00, 0),
        ('SKU-0003', 25999.00, 5)
     ) AS v(sku, new_price, restock)
WHERE p.sku = v.sku
RETURNING p.sku, p.price, p.stock;`,
  explain: `<p><strong>How it works.</strong> <code>UPDATE ... FROM</code> joins the target to another relation — here an inline <code>VALUES</code> list — and updates each matching row once. One statement, one plan, one round trip.</p>
<p><strong>When to use.</strong> Price lists, status sync, applying results computed elsewhere. Also works with a temp/staging table loaded via COPY.</p>
<p><strong>Gotchas:</strong> if the source has duplicate keys a target row is updated with an arbitrary match — de-duplicate first. VALUES column types are inferred from the first row; cast explicitly when ambiguous. Large updates create a new row version for every row (MVCC): batch them and let autovacuum keep up.</p>`,
  run: true
},
{
  id: 'json-querying',
  title: 'JSON querying (jsonb)',
  category: 'Semi-structured',
  sql: `-- GIN index makes @> containment searches fast
CREATE INDEX IF NOT EXISTS idx_products_attrs ON products USING gin (attributes jsonb_path_ops);

SELECT sku, name,
       attributes ->> 'brand'                          AS brand,
       (attributes ->> 'warranty_months')::int         AS warranty_months,
       (attributes #>> '{specs,weight_kg}')::numeric   AS weight_kg
FROM products
WHERE attributes @> '{"brand": "Acme", "color": "black"}'
  AND jsonb_path_exists(attributes, '$.specs.weight_kg ? (@ < 5)')
ORDER BY sku;`,
  explain: `<p><strong>How it works.</strong> <code>-&gt;</code> returns jsonb, <code>-&gt;&gt;</code> returns text, <code>#&gt;&gt;</code> follows a path. <code>@&gt;</code> ("contains") is indexable with GIN; <code>jsonb_path_ops</code> is a smaller, faster GIN opclass that supports only containment/path operators. SQL/JSON path (<code>jsonb_path_exists</code>, <code>@?</code>, <code>@@</code>) expresses filters inside the document.</p>
<p><strong>When to use.</strong> Sparse, variable attributes (product specs, event payloads, settings).</p>
<p><strong>Gotchas:</strong> <code>-&gt;&gt;</code> returns text — cast before numeric comparison, or "10" &lt; "9". Columns you filter/join on constantly belong in real columns (better statistics, constraints, smaller rows).</p>`,
  run: true
},
{
  id: 'array-querying',
  title: 'Array querying',
  category: 'Semi-structured',
  sql: `CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING gin (tags);

-- Products tagged BOTH office and sale (@>), or ANY of new/bestseller (&&)
SELECT sku, tags,
       tags @> ARRAY['office','sale']        AS office_and_sale,
       tags && ARRAY['new','bestseller']     AS new_or_best,
       cardinality(tags)                     AS n_tags
FROM products
WHERE tags && ARRAY['sale','new']
ORDER BY sku
LIMIT 8;

-- Tag frequency: unnest turns array elements into rows
SELECT tag, count(*) AS products
FROM products, unnest(tags) AS tag
GROUP BY tag
ORDER BY products DESC, tag;`,
  explain: `<p><strong>How it works.</strong> <code>@&gt;</code> contains-all, <code>&lt;@</code> is-contained-by, <code>&amp;&amp;</code> overlaps (any in common) — all GIN-indexable. <code>unnest()</code> expands elements to rows for counting/joining; <code>array_agg()</code> goes the other way.</p>
<p><strong>When to use.</strong> Small, bounded lists owned by the row (tags, roles, feature flags).</p>
<p><strong>Gotchas:</strong> <code>'x' = ANY(tags)</code> is not GIN-indexable — use <code>tags @&gt; ARRAY['x']</code>. Arrays are not foreign keys: if elements reference other rows or grow unbounded, use a junction table.</p>`,
  run: true
},
{
  id: 'full-text-search',
  title: 'Full text search',
  category: 'Search',
  sql: `-- documents.search is a generated tsvector column (title weight A, body weight B)
-- already indexed with GIN (idx_documents_search)
SELECT id, title,
       round(ts_rank(search, q)::numeric, 4) AS rank,
       ts_headline('english', body, q, 'MaxWords=12, MinWords=5') AS snippet
FROM documents,
     websearch_to_tsquery('english', 'index performance -vector') AS q
WHERE search @@ q
ORDER BY rank DESC, id
LIMIT 5;`,
  explain: `<p><strong>How it works.</strong> Text is normalized into a <code>tsvector</code> (stemmed lexemes with positions/weights); the query becomes a <code>tsquery</code>. <code>@@</code> matches and is served by the GIN index; <code>ts_rank</code> scores (weight A title hits &gt; B body hits); <code>ts_headline</code> builds highlighted snippets. <code>websearch_to_tsquery</code> accepts Google-style input (quotes, OR, <code>-</code> exclusion) without syntax errors.</p>
<p><strong>When to use.</strong> Built-in keyword search for docs, products, tickets — no separate search engine needed up to millions of documents.</p>
<p><strong>Gotchas:</strong> use the same text-search configuration for indexing and querying; <code>ts_headline</code> is expensive, so apply it only to the final top rows (as here, after LIMIT logic). FTS matches words, not typos — combine with pg_trgm for fuzziness.</p>`,
  run: true
},
{
  id: 'fuzzy-search-trgm',
  title: 'Fuzzy search (pg_trgm)',
  category: 'Search',
  sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);

-- Typo-tolerant search: 'keybord mx' still finds Keyboard Max products
SELECT name,
       round(similarity(name, 'keybord mx')::numeric, 3) AS sim
FROM products
WHERE name % 'keybord mx'                -- similarity above pg_trgm.similarity_threshold (0.3)
ORDER BY sim DESC, name
LIMIT 5;

-- The same index also accelerates ILIKE '%...%'
SELECT count(*) FROM products WHERE name ILIKE '%max%';`,
  explain: `<p><span class="tag ext">extension</span> <strong>pg_trgm</strong> (contrib, not core) splits strings into 3-character grams; similarity = shared grams / total grams. <code>%</code> filters by <code>pg_trgm.similarity_threshold</code>; <code>&lt;-&gt;</code> is the distance (1 − similarity) and supports KNN ordering with a GiST index.</p>
<p><strong>When to use.</strong> Typo-tolerant name/product/customer search, de-duplication of near-identical strings, accelerating <code>LIKE '%x%'</code>/<code>ILIKE</code> which B-trees cannot.</p>
<p><strong>Gotchas:</strong> very short search strings have few trigrams and match poorly; GIN trigram indexes are large (several × the column size) and slow down writes. Tune the threshold per use case with <code>SET pg_trgm.similarity_threshold = 0.4</code>.</p>`,
  run: true
},
{
  id: 'vector-search',
  title: 'Vector search (pgvector)',
  category: 'Search',
  sql: `CREATE EXTENSION IF NOT EXISTS vector;

DROP TABLE IF EXISTS doc_embeddings;
CREATE TEMP TABLE doc_embeddings (
  id        int PRIMARY KEY,
  title     text,
  embedding vector(3)          -- toy 3-dim vectors; real models use 384-3072 dims
);
INSERT INTO doc_embeddings VALUES
  (1, 'Indexing strategies',   '[0.9, 0.1, 0.0]'),
  (2, 'B-tree internals',      '[0.8, 0.2, 0.1]'),
  (3, 'Vector search basics',  '[0.1, 0.9, 0.2]'),
  (4, 'RAG with PostgreSQL',   '[0.2, 0.8, 0.3]'),
  (5, 'Refund policy',         '[0.0, 0.1, 0.9]');

-- Approximate-nearest-neighbour index (HNSW) for cosine distance
CREATE INDEX ON doc_embeddings USING hnsw (embedding vector_cosine_ops);

-- 3 nearest documents to a query embedding
SELECT id, title,
       round((embedding <=> '[0.85, 0.15, 0.05]')::numeric, 4) AS cosine_distance,
       round((embedding <-> '[0.85, 0.15, 0.05]')::numeric, 4) AS l2_distance
FROM doc_embeddings
ORDER BY embedding <=> '[0.85, 0.15, 0.05]'
LIMIT 3;`,
  explain: `<p><span class="tag ext">extension</span> <strong>pgvector</strong> is an extension, not core PostgreSQL. It adds the <code>vector(n)</code> type and distance operators: <code>&lt;-&gt;</code> L2/Euclidean, <code>&lt;=&gt;</code> cosine distance, <code>&lt;#&gt;</code> negative inner product.</p>
<p><strong>How it works.</strong> <code>ORDER BY embedding &lt;=&gt; :query LIMIT k</code> is a k-nearest-neighbour search. Without an index it is an exact scan; with <strong>HNSW</strong> or <strong>IVFFlat</strong> it is approximate but sub-linear. The index opclass must match the operator (<code>vector_cosine_ops</code> ↔ <code>&lt;=&gt;</code>).</p>
<p><strong>When to use.</strong> Semantic search, RAG retrieval, recommendations, de-duplication of similar content.</p>
<p><strong>Gotchas:</strong> embeddings must come from the same model as the query; normalize vectors if you use inner product. Combining a WHERE filter with ANN can return fewer than k rows (tune <code>hnsw.ef_search</code>, or use iterative scans in pgvector 0.8+).</p>`,
  run: true
},
{
  id: 'pivot-filter',
  title: 'Pivot with FILTER (and crosstab)',
  category: 'Reporting',
  sql: `-- Payment methods as columns, one row per quarter of 2025
SELECT to_char(date_trunc('quarter', paid_at), 'YYYY-"Q"Q') AS quarter,
       sum(amount) FILTER (WHERE method = 'card')       AS card,
       sum(amount) FILTER (WHERE method = 'upi')        AS upi,
       sum(amount) FILTER (WHERE method = 'netbanking') AS netbanking,
       sum(amount) FILTER (WHERE method = 'wallet')     AS wallet,
       sum(amount) FILTER (WHERE method = 'cod')        AS cod,
       sum(amount)                                      AS total
FROM payments
WHERE status = 'success'
  AND paid_at >= DATE '2025-01-01' AND paid_at < DATE '2026-01-01'
GROUP BY 1
ORDER BY 1;`,
  explain: `<p><strong>How it works.</strong> Each output column is an aggregate restricted by <code>FILTER (WHERE ...)</code> (SQL standard, PostgreSQL 9.4+). One scan fills every column.</p>
<p><strong>When to use.</strong> Whenever the set of pivot columns is known in advance — which is nearly always for reports.</p>
<p><strong>crosstab.</strong> The <code>crosstab()</code> function comes from the <span class="tag ext">extension</span> <code>tablefunc</code> (not core, and not available in this browser playground). It needs a fixed output column list anyway, so FILTER is usually simpler. Truly dynamic columns require building SQL dynamically (e.g. in PL/pgSQL with <code>format()</code>) or pivoting in the application/BI tool.</p>`,
  run: true
},
{
  id: 'median-percentiles',
  title: 'Median & percentiles',
  category: 'Statistics',
  sql: `SELECT category,
       count(*) AS products,
       round(avg(price), 2) AS mean_price,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::numeric, 2) AS median_price,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY price)                      AS median_actual_row,
       round((percentile_cont(0.9) WITHIN GROUP (ORDER BY price))::numeric, 2) AS p90_price,
       mode() WITHIN GROUP (ORDER BY attributes ->> 'brand')                   AS most_common_brand
FROM products
GROUP BY category
ORDER BY category;`,
  explain: `<p><strong>How it works.</strong> Ordered-set aggregates take their input order from <code>WITHIN GROUP (ORDER BY ...)</code>. <code>percentile_cont</code> interpolates (may return a value not in the data); <code>percentile_disc</code> returns an actual value; <code>mode()</code> returns the most frequent value. Pass an array (<code>percentile_cont(ARRAY[0.5,0.9,0.99])</code>) to get several percentiles from one sort.</p>
<p><strong>When to use.</strong> Latency (p95/p99), order values, salaries — any skewed distribution where the mean misleads.</p>
<p><strong>Gotchas:</strong> they are not window functions (no <code>OVER</code>); every group is sorted, so memory/CPU scale with group size. <code>percentile_cont</code> returns <code>double precision</code> — cast to numeric before <code>round(x, 2)</code>.</p>`,
  run: true
},
{
  id: 'conditional-aggregation',
  title: 'Conditional aggregation',
  category: 'Reporting',
  sql: `-- Per customer segment: order counts by status + rates, in one pass
SELECT c.segment,
       count(*)                                              AS orders,
       count(*) FILTER (WHERE o.status = 'delivered')        AS delivered,
       count(*) FILTER (WHERE o.status = 'cancelled')        AS cancelled,
       sum(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending_case_style,
       round(100.0 * avg((o.status = 'cancelled')::int), 2)  AS cancel_rate_pct,
       bool_or(o.total_amount > 500000)                      AS has_big_order
FROM orders o
JOIN customers c ON c.id = o.customer_id
GROUP BY c.segment
ORDER BY c.segment;`,
  explain: `<p><strong>How it works.</strong> Aggregates fed only by matching rows: <code>FILTER (WHERE ...)</code> (standard, clearest), <code>sum(CASE ...)</code> (portable everywhere), or <code>avg(boolean::int)</code> for a rate. <code>bool_or</code>/<code>bool_and</code> answer "any/all".</p>
<p><strong>When to use.</strong> KPI rows, funnels, pivots, cohort tables — anything that would otherwise be several queries over the same table.</p>
<p><strong>Gotchas:</strong> <code>count(CASE WHEN x THEN 1 END)</code> works because count ignores NULL, but <code>count(CASE WHEN x THEN 1 ELSE 0 END)</code> counts <em>everything</em> — a classic bug. Use <code>100.0</code> to avoid integer division.</p>`,
  run: true
},
{
  id: 'latest-row-per-group',
  title: 'Latest row per group (DISTINCT ON)',
  category: 'Ranking',
  sql: `-- Most recent order of every customer (PostgreSQL DISTINCT ON)
CREATE INDEX IF NOT EXISTS idx_orders_cust_date_desc ON orders (customer_id, order_date DESC, id DESC);

SELECT DISTINCT ON (customer_id)
       customer_id, id AS last_order_id, order_date, status, total_amount
FROM orders
ORDER BY customer_id, order_date DESC, id DESC
LIMIT 10;`,
  explain: `<p><strong>How it works.</strong> <code>DISTINCT ON (key)</code> keeps the <em>first</em> row of each key according to ORDER BY. The ORDER BY must start with the DISTINCT ON expressions; the rest decides which row wins. A matching index lets PostgreSQL read rows in order with no sort.</p>
<p><strong>When to use.</strong> Latest status per entity, current price per product, last login per user. <span class="tag core">core</span> PostgreSQL extension to the standard — the portable equivalent is <code>row_number() ... = 1</code>.</p>
<p><strong>Gotchas:</strong> returns exactly one row per key (ties broken by ORDER BY — add a unique tie-breaker). With very many rows per group and few groups, a <code>LATERAL ... LIMIT 1</code> per group (or a recursive "skip scan") can be faster.</p>`,
  run: true
}
];
