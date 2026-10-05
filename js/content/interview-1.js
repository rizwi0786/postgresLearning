/* PostgreSQL Mastery — Interview bank part 1
   Sections: beginner (50), intermediate (100), advanced (100).
   Target: PostgreSQL 16–18. Extensions and third-party tools are labelled as such. */
PGM.INTERVIEW = PGM.INTERVIEW || {};

PGM.INTERVIEW.beginner = [
{ q: `What is PostgreSQL and how does it differ from MySQL at a high level?`,
  a: `<p>PostgreSQL is an open-source, object-relational database system with a strong focus on standards compliance, extensibility and correctness. Compared with MySQL it offers a richer type system (arrays, <code>jsonb</code>, ranges, custom types), more index types (GIN, GiST, BRIN, SP-GiST), transactional DDL, and a powerful extension ecosystem (PostGIS, pgvector).</p><p>Architecturally, PostgreSQL uses a process-per-connection model and keeps old row versions in the table itself (MVCC with VACUUM), whereas MySQL InnoDB uses threads and an undo log.</p>`,
  tags: ['basics'] },
{ q: `What is SQL, and what are DDL, DML, DCL and TCL?`,
  a: `<p>SQL (Structured Query Language) is the declarative language for relational databases: you describe <em>what</em> you want, and the planner decides <em>how</em>. Statements are grouped as:</p><ul><li><strong>DDL</strong> (definition): <code>CREATE</code>, <code>ALTER</code>, <code>DROP</code>, <code>TRUNCATE</code>.</li><li><strong>DML</strong> (manipulation): <code>SELECT</code>, <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>, <code>MERGE</code>.</li><li><strong>DCL</strong> (control): <code>GRANT</code>, <code>REVOKE</code>.</li><li><strong>TCL</strong> (transactions): <code>BEGIN</code>, <code>COMMIT</code>, <code>ROLLBACK</code>, <code>SAVEPOINT</code>.</li></ul><p>In PostgreSQL even most DDL is transactional and can be rolled back.</p>`,
  tags: ['sql','basics'] },
{ q: `What is a primary key?`,
  a: `<p>A primary key is the column (or set of columns) that uniquely identifies each row. It implies <code>UNIQUE</code> and <code>NOT NULL</code>, a table can have only one, and PostgreSQL automatically creates a unique B-tree index to enforce it. Example: <code>employees.id</code> in company_db. Foreign keys in other tables usually reference it.</p>`,
  tags: ['keys','constraints'] },
{ q: `What is a foreign key and what does it guarantee?`,
  a: `<p>A foreign key is a constraint that says values in a column must exist in a referenced column (a primary key or unique column) of another table — <strong>referential integrity</strong>. For example <code>employees.department_id REFERENCES departments(id)</code> prevents an employee pointing to a non-existent department, and blocks deleting a department that still has employees (unless you choose <code>ON DELETE CASCADE</code> / <code>SET NULL</code>).</p><p>Note: PostgreSQL does <strong>not</strong> automatically index the referencing column; you usually should, to speed up joins and parent deletes.</p>`,
  tags: ['keys','constraints'] },
{ q: `Primary key vs unique constraint — what is the difference?`,
  a: `<p>Both enforce uniqueness through a unique index. Differences: a table has only <strong>one</strong> primary key but can have many unique constraints; primary key columns are forced <code>NOT NULL</code>, whereas a unique column may contain NULLs — and by default multiple NULLs are allowed because NULL is not equal to NULL. Since PostgreSQL 15 you can write <code>UNIQUE NULLS NOT DISTINCT</code> to allow only one NULL.</p>`,
  tags: ['keys','constraints','nulls'] },
{ q: `What is a candidate key, a natural key and a surrogate key?`,
  a: `<p>A <strong>candidate key</strong> is any minimal set of columns that could uniquely identify a row; one is chosen as primary key, the others become unique constraints. A <strong>natural key</strong> has business meaning (email, SKU, PAN number). A <strong>surrogate key</strong> is a meaningless generated value such as an identity <code>bigint</code> or UUID.</p><p>Common practice: use a surrogate primary key for stability (natural values change) and keep the natural key as a <code>UNIQUE</code> constraint, as company_db does with <code>products.sku</code>.</p>`,
  tags: ['keys','design'] },
{ q: `What is a composite key? Give an example.`,
  a: `<p>A composite key is a key made of two or more columns whose combination is unique. In company_db, <code>employee_projects</code> has <code>PRIMARY KEY (employee_id, project_id)</code>: one employee can be on many projects and one project has many employees, but each pair appears once. Column order matters for the underlying index: it serves lookups by <code>employee_id</code> alone, but not efficiently by <code>project_id</code> alone.</p>`,
  tags: ['keys'] },
{ q: `What constraints does PostgreSQL support?`,
  a: `<p>Six kinds: <code>NOT NULL</code>, <code>UNIQUE</code>, <code>PRIMARY KEY</code>, <code>FOREIGN KEY</code>, <code>CHECK</code> and <code>EXCLUDE</code> (exclusion constraints, e.g. no overlapping time ranges for the same room). Constraints are enforced by the database for every write path, which is why they are more reliable than application-side validation.</p>`,
  tags: ['constraints'] },
{ q: `What is a CHECK constraint and what are its limits?`,
  a: `<p>A <code>CHECK</code> constraint is a boolean expression each row must satisfy, e.g. <code>CHECK (salary &gt; 0)</code> or <code>CHECK (end_date IS NULL OR end_date &gt;= start_date)</code>. A row passes if the expression is true <strong>or NULL</strong>, so add <code>NOT NULL</code> if needed. It may only reference columns of the same row — it cannot query other tables (use a foreign key or trigger for that) — and should be immutable (no <code>now()</code>).</p>`,
  tags: ['constraints','nulls'] },
{ q: `What is a DEFAULT value and when is it applied?`,
  a: `<p>A <code>DEFAULT</code> supplies a value when an <code>INSERT</code> omits the column or uses the keyword <code>DEFAULT</code>, e.g. <code>created_at timestamptz DEFAULT now()</code>. It is not applied if you explicitly insert NULL. Since PostgreSQL 11, adding a column with a constant (non-volatile) default is instant — no table rewrite.</p>`,
  tags: ['constraints','ddl'] },
{ q: `What are the common numeric data types and when do you use each?`,
  a: `<ul><li><code>smallint</code>/<code>integer</code>/<code>bigint</code>: 2/4/8-byte integers; use <code>bigint</code> for ids of large or fast-growing tables.</li><li><code>numeric(p,s)</code>: exact decimal — use for money and anything needing exact arithmetic (company_db uses <code>numeric(10,2)</code> for salary).</li><li><code>real</code>/<code>double precision</code>: binary floating point, fast but inexact (0.1 + 0.2 is not exactly 0.3) — for measurements and science.</li></ul><p>Avoid the <code>money</code> type: it depends on the <code>lc_monetary</code> locale.</p>`,
  tags: ['data-types'] },
{ q: `char(n) vs varchar(n) vs text in PostgreSQL?`,
  a: `<p>In PostgreSQL all three share the same storage engine and there is <strong>no performance advantage</strong> to <code>varchar(n)</code> over <code>text</code>. <code>char(n)</code> pads with spaces and has surprising comparison semantics, so it is rarely appropriate. <code>varchar(n)</code> only adds a length check. Idiomatic choice: <code>text</code>, plus a <code>CHECK (length(col) &lt;= n)</code> if you truly need a limit.</p>`,
  tags: ['data-types'] },
{ q: `timestamp vs timestamptz — which should you use?`,
  a: `<p><code>timestamp</code> (without time zone) stores a wall-clock value with no zone information. <code>timestamptz</code> converts input to UTC for storage and displays it in the session's <code>TimeZone</code>. Neither stores the original zone name. For real events (orders, logins) use <code>timestamptz</code> — it is unambiguous across servers and users in different zones. Both take 8 bytes.</p>`,
  tags: ['data-types','dates'] },
{ q: `What is the boolean type and what values does it accept?`,
  a: `<p><code>boolean</code> holds <code>true</code>, <code>false</code> or NULL (unknown). Input accepts <code>'t'</code>, <code>'true'</code>, <code>'yes'</code>, <code>'on'</code>, <code>'1'</code> and their false counterparts. You can filter directly: <code>WHERE is_active</code> or <code>WHERE NOT is_active</code>. Remember three-valued logic: <code>WHERE NOT is_active</code> does not return rows where it is NULL — use <code>IS NOT TRUE</code> for that.</p>`,
  tags: ['data-types','nulls'] },
{ q: `How do you auto-generate ids in modern PostgreSQL? SERIAL vs IDENTITY?`,
  a: `<p>Prefer the SQL-standard identity column: <code>id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY</code>. <code>serial</code> is an older PostgreSQL shorthand that creates a sequence and a default; it has awkward permission and ownership semantics and lets users overwrite ids silently. <code>GENERATED ALWAYS</code> rejects manual values unless you write <code>OVERRIDING SYSTEM VALUE</code>; <code>GENERATED BY DEFAULT</code> allows them. Both use a sequence internally, so ids can have gaps.</p>`,
  tags: ['data-types','ddl','keys'] },
{ q: `What is NULL in SQL?`,
  a: `<p>NULL means "unknown or missing" — it is not zero, not an empty string, and not false. Any comparison with NULL using <code>=</code>, <code>&lt;&gt;</code>, <code>&lt;</code> etc. yields NULL (unknown), and <code>WHERE</code> keeps only rows where the condition is true. Hence <code>WHERE manager_id = NULL</code> returns nothing; you must write <code>WHERE manager_id IS NULL</code>.</p>`,
  tags: ['nulls'] },
{ q: `How do NULLs behave in arithmetic, string concatenation and aggregates?`,
  a: `<p>Arithmetic with NULL gives NULL (<code>salary + NULL</code> is NULL). The <code>||</code> operator also gives NULL, while <code>concat()</code> and <code>concat_ws()</code> skip NULLs. Aggregates like <code>SUM</code>, <code>AVG</code>, <code>MIN</code>, <code>MAX</code> and <code>COUNT(col)</code> ignore NULLs; <code>COUNT(*)</code> counts rows. <code>SUM</code> over zero non-null values returns NULL, not 0 — wrap with <code>COALESCE(SUM(x), 0)</code>.</p>`,
  tags: ['nulls','aggregation'] },
{ q: `What do COALESCE and NULLIF do?`,
  a: `<p><code>COALESCE(a, b, c)</code> returns the first non-NULL argument — e.g. <code>COALESCE(end_date, CURRENT_DATE)</code>. <code>NULLIF(a, b)</code> returns NULL if <code>a = b</code>, otherwise <code>a</code> — classic use is avoiding division by zero: <code>revenue / NULLIF(orders_count, 0)</code>. Both are standard SQL.</p>`,
  tags: ['nulls','functions'] },
{ q: `What is IS DISTINCT FROM and why is it useful?`,
  a: `<p><code>a IS DISTINCT FROM b</code> is a NULL-safe inequality: it treats two NULLs as equal and NULL vs a value as different, always returning true or false, never NULL. It is ideal for change detection, e.g. in an update trigger: <code>IF NEW.salary IS DISTINCT FROM OLD.salary THEN ...</code>. <code>IS NOT DISTINCT FROM</code> is the NULL-safe equality.</p>`,
  tags: ['nulls','sql'] },
{ q: `Why can NOT IN return no rows when the subquery contains a NULL?`,
  a: `<p><code>x NOT IN (1, 2, NULL)</code> expands to <code>x &lt;&gt; 1 AND x &lt;&gt; 2 AND x &lt;&gt; NULL</code>. The last term is NULL, so the whole expression is never true and no rows come back. Example trap: <code>WHERE id NOT IN (SELECT manager_id FROM employees)</code> returns nothing because heads have NULL <code>manager_id</code>. Use <code>NOT EXISTS</code> instead — it is NULL-safe and usually planned as an efficient anti-join.</p>`,
  tags: ['nulls','subqueries'] },
{ q: `What are the basic CRUD statements? Show an example of each.`,
  a: `<pre>INSERT INTO departments (name, location, budget) VALUES ('Legal', 'Pune', 500000);
SELECT id, name FROM departments WHERE location = 'Pune';
UPDATE departments SET budget = budget * 1.10 WHERE name = 'Legal';
DELETE FROM departments WHERE name = 'Legal';</pre><p>Create = <code>INSERT</code>, Read = <code>SELECT</code>, Update = <code>UPDATE</code>, Delete = <code>DELETE</code>. Always double-check the <code>WHERE</code> clause of <code>UPDATE</code>/<code>DELETE</code> — without it every row is affected.</p>`,
  tags: ['crud','sql'] },
{ q: `What does the RETURNING clause do?`,
  a: `<p><code>RETURNING</code> (a PostgreSQL extension to SQL) makes <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code> and, since PostgreSQL 17, <code>MERGE</code> return values from the affected rows. It saves a round trip, e.g. getting the generated id: <code>INSERT INTO customers (name, email, country) VALUES (...) RETURNING id;</code>. PostgreSQL 18 adds <code>OLD</code> and <code>NEW</code> aliases in RETURNING so an UPDATE can return before and after values.</p>`,
  tags: ['crud'] },
{ q: `DELETE vs TRUNCATE vs DROP?`,
  a: `<ul><li><code>DELETE</code> removes rows matching a <code>WHERE</code>, row by row, fires row triggers, leaves dead tuples for VACUUM.</li><li><code>TRUNCATE</code> removes <strong>all</strong> rows by swapping in new empty files — very fast, reclaims space immediately, takes an <code>ACCESS EXCLUSIVE</code> lock, does not fire row-level <code>DELETE</code> triggers, and can <code>RESTART IDENTITY</code>.</li><li><code>DROP TABLE</code> removes the table definition and data entirely.</li></ul><p>In PostgreSQL all three are transactional and can be rolled back.</p>`,
  tags: ['crud','ddl'] },
{ q: `What is the logical order in which a SELECT is evaluated?`,
  a: `<p><code>FROM</code>/<code>JOIN</code> → <code>WHERE</code> → <code>GROUP BY</code> → <code>HAVING</code> → window functions → <code>SELECT</code> list → <code>DISTINCT</code> → <code>ORDER BY</code> → <code>LIMIT</code>/<code>OFFSET</code>. This explains why you cannot use a select-list alias in <code>WHERE</code> (it does not exist yet) but can in <code>ORDER BY</code>. The physical execution chosen by the planner may differ, but the results must match this logical order.</p>`,
  tags: ['sql'] },
{ q: `WHERE vs HAVING?`,
  a: `<p><code>WHERE</code> filters individual rows <em>before</em> grouping and cannot contain aggregates. <code>HAVING</code> filters groups <em>after</em> <code>GROUP BY</code> and can use aggregates:</p><pre>SELECT department_id, avg(salary)
FROM employees
WHERE is_active
GROUP BY department_id
HAVING avg(salary) &gt; 80000;</pre><p>Put non-aggregate conditions in <code>WHERE</code> so fewer rows reach the aggregation.</p>`,
  tags: ['sql','aggregation'] },
{ q: `What does GROUP BY do, and what is the rule for the select list?`,
  a: `<p><code>GROUP BY</code> collapses rows with equal grouping values into one output row per group, typically combined with aggregates (<code>count</code>, <code>sum</code>, <code>avg</code>). Every select-list column must either be in the <code>GROUP BY</code> or inside an aggregate. PostgreSQL relaxes this when you group by a table's primary key: other columns of that table are functionally dependent and may be selected directly.</p>`,
  tags: ['sql','aggregation'] },
{ q: `What is the difference between COUNT(*), COUNT(col) and COUNT(DISTINCT col)?`,
  a: `<p><code>COUNT(*)</code> counts rows, including those with NULLs. <code>COUNT(col)</code> counts rows where <code>col</code> is not NULL. <code>COUNT(DISTINCT col)</code> counts distinct non-NULL values. For example on employees, <code>COUNT(manager_id)</code> excludes the 8 department heads, so it is 192 while <code>COUNT(*)</code> is 200.</p>`,
  tags: ['aggregation','nulls'] },
{ q: `What does DISTINCT do and what is DISTINCT ON?`,
  a: `<p><code>SELECT DISTINCT</code> removes duplicate output rows (using sort or hash). <code>DISTINCT ON (expr)</code> is a PostgreSQL extension that keeps the <strong>first</strong> row of each group as defined by <code>ORDER BY</code> — a concise "top 1 per group":</p><pre>SELECT DISTINCT ON (department_id) department_id, first_name, salary
FROM employees
ORDER BY department_id, salary DESC;</pre><p>The <code>ORDER BY</code> must start with the <code>DISTINCT ON</code> expressions.</p>`,
  tags: ['sql'] },
{ q: `How does ORDER BY treat NULLs, and how do you change it?`,
  a: `<p>In PostgreSQL NULLs sort as larger than any value: they come <strong>last</strong> in <code>ASC</code> and <strong>first</strong> in <code>DESC</code>. Override with <code>NULLS FIRST</code> / <code>NULLS LAST</code>, e.g. <code>ORDER BY end_date DESC NULLS LAST</code>. If you index for such a query, define the index with the same NULLS ordering to avoid an extra sort.</p>`,
  tags: ['sql','nulls'] },
{ q: `How do LIMIT and OFFSET work, and what is their pitfall?`,
  a: `<p><code>LIMIT n</code> returns at most n rows; <code>OFFSET m</code> skips m rows first. Without <code>ORDER BY</code> the rows returned are unpredictable. The pitfall is deep pagination: <code>OFFSET 100000</code> still reads and discards 100,000 rows, so it gets slower with every page. Use keyset pagination instead: <code>WHERE id &gt; :last_seen_id ORDER BY id LIMIT 20</code>. The standard spelling is <code>FETCH FIRST n ROWS ONLY</code>.</p>`,
  tags: ['sql','pagination'] },
{ q: `What is a JOIN? Name the main join types.`,
  a: `<p>A join combines rows of two tables based on a condition. Types: <strong>INNER JOIN</strong> (only matching rows), <strong>LEFT [OUTER] JOIN</strong> (all left rows, NULLs where no match), <strong>RIGHT JOIN</strong> (mirror), <strong>FULL [OUTER] JOIN</strong> (all rows from both sides), <strong>CROSS JOIN</strong> (every combination), and a <strong>self join</strong> (table joined to itself, e.g. employees to their managers).</p>`,
  tags: ['joins'] },
{ q: `INNER JOIN vs LEFT JOIN with an example.`,
  a: `<pre>SELECT d.name, count(p.id)
FROM departments d
LEFT JOIN projects p ON p.department_id = d.id
GROUP BY d.name;</pre><p>With <code>INNER JOIN</code>, departments without projects disappear. With <code>LEFT JOIN</code>, they appear with <code>count(p.id) = 0</code> (note: <code>count(*)</code> would wrongly give 1, because the NULL-extended row still counts). Use LEFT JOIN when the left side must be fully represented.</p>`,
  tags: ['joins'] },
{ q: `Why does a WHERE condition on the right table turn a LEFT JOIN into an inner join?`,
  a: `<p>Unmatched rows have NULLs in the right table's columns. A filter like <code>WHERE p.status = 'active'</code> evaluates to NULL for them, so they are removed — the result is the same as an inner join. Put such conditions in the <code>ON</code> clause instead: <code>LEFT JOIN projects p ON p.department_id = d.id AND p.status = 'active'</code>. That keeps every department and only attaches active projects.</p>`,
  tags: ['joins','nulls'] },
{ q: `What is a self join? Give an example.`,
  a: `<p>A self join joins a table to itself with different aliases, typically for hierarchies:</p><pre>SELECT e.first_name AS employee, m.first_name AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id;</pre><p>LEFT JOIN keeps the department heads, whose <code>manager_id</code> is NULL. For multi-level hierarchies use a recursive CTE.</p>`,
  tags: ['joins'] },
{ q: `What is a CROSS JOIN and when is it useful?`,
  a: `<p>A <code>CROSS JOIN</code> returns the Cartesian product: every row of A with every row of B (8 departments × 24 projects = 192 rows). It is useful for generating combinations, such as every department × every month from <code>generate_series</code> to build a report grid with zero-filled gaps. Accidentally omitting a join condition produces the same explosion, which is a common bug.</p>`,
  tags: ['joins'] },
{ q: `UNION vs UNION ALL?`,
  a: `<p>Both stack the results of two queries with compatible columns. <code>UNION</code> removes duplicates (requiring a sort or hash step); <code>UNION ALL</code> keeps everything and is cheaper. Use <code>UNION ALL</code> unless you actually need de-duplication. Related set operators are <code>INTERSECT</code> and <code>EXCEPT</code>.</p>`,
  tags: ['sql'] },
{ q: `What is an alias and why use one?`,
  a: `<p>An alias renames a column or table within a query: <code>SELECT e.salary * 12 AS annual_salary FROM employees e</code>. Table aliases are required for self joins and make multi-table queries readable; column aliases name computed expressions. Column aliases can be used in <code>ORDER BY</code> and <code>GROUP BY</code>, but not in <code>WHERE</code> or <code>HAVING</code>.</p>`,
  tags: ['sql'] },
{ q: `What does LIKE do, and how is ILIKE different?`,
  a: `<p><code>LIKE</code> matches patterns where <code>%</code> means any sequence and <code>_</code> means one character: <code>email LIKE '%@gmail.com'</code>. <code>ILIKE</code> is the PostgreSQL case-insensitive version. A plain B-tree index helps only left-anchored patterns (<code>'abc%'</code>, and only with <code>text_pattern_ops</code> or C collation); for <code>'%abc%'</code> use a trigram GIN index from the <code>pg_trgm</code> <span class="tag ext">extension</span>.</p>`,
  tags: ['sql','strings'] },
{ q: `What do BETWEEN and IN do, and what is the pitfall with BETWEEN on timestamps?`,
  a: `<p><code>x BETWEEN a AND b</code> means <code>x &gt;= a AND x &lt;= b</code> (inclusive). <code>x IN (1, 2, 3)</code> is shorthand for multiple ORs. The timestamp pitfall: <code>order_date BETWEEN '2025-01-01' AND '2025-01-31'</code> excludes everything after midnight on the 31st. Use a half-open range: <code>order_date &gt;= '2025-01-01' AND order_date &lt; '2025-02-01'</code>.</p>`,
  tags: ['sql','dates'] },
{ q: `What is a CASE expression?`,
  a: `<p><code>CASE</code> is SQL's if/else, usable anywhere an expression is allowed:</p><pre>SELECT first_name,
  CASE WHEN salary &gt;= 150000 THEN 'senior'
       WHEN salary &gt;= 80000  THEN 'mid'
       ELSE 'junior' END AS band
FROM employees;</pre><p>Branches are evaluated in order and the first true one wins; without <code>ELSE</code> the result is NULL. Inside aggregates it enables conditional counts, though <code>count(*) FILTER (WHERE ...)</code> is cleaner in PostgreSQL.</p>`,
  tags: ['sql'] },
{ q: `What is normalization and why do we do it?`,
  a: `<p>Normalization is organizing tables so each fact is stored once, eliminating redundancy and update anomalies. If a department's location is copied into every employee row, changing it requires updating 25 rows and risks inconsistency (<strong>update anomaly</strong>); you cannot record a new department with no employees (<strong>insert anomaly</strong>); deleting the last employee loses the department info (<strong>delete anomaly</strong>). Normalizing moves the department into its own table referenced by a foreign key.</p>`,
  tags: ['normalization','design'] },
{ q: `Explain 1NF, 2NF and 3NF briefly.`,
  a: `<ul><li><strong>1NF</strong>: each column holds atomic values, no repeating groups (no <code>phone1, phone2, phone3</code> or comma-separated lists).</li><li><strong>2NF</strong>: 1NF and every non-key column depends on the <em>whole</em> composite key, not part of it (in <code>employee_projects</code>, project name depends only on <code>project_id</code>, so it belongs in <code>projects</code>).</li><li><strong>3NF</strong>: 2NF and no transitive dependencies — non-key columns depend only on the key (department location depends on department, not on the employee).</li></ul><p>Mnemonic: "the key, the whole key, and nothing but the key".</p>`,
  tags: ['normalization'] },
{ q: `What is denormalization and when is it acceptable?`,
  a: `<p>Denormalization deliberately stores redundant or pre-computed data to make reads faster, e.g. <code>orders.total_amount</code> duplicates the sum of its <code>order_items</code>. It is acceptable for read-heavy paths, reporting tables and historical snapshots (the price at time of sale), provided you have a mechanism to keep it consistent — a transaction, trigger or materialized view — and you measured that the normalized form was actually too slow.</p>`,
  tags: ['normalization','design'] },
{ q: `What is a one-to-many vs many-to-many relationship, and how is each modeled?`,
  a: `<p><strong>One-to-many</strong>: a foreign key on the "many" side — each employee has one department, so <code>employees.department_id</code> references <code>departments</code>. <strong>Many-to-many</strong>: a junction (bridge) table with two foreign keys and usually a composite primary key — <code>employee_projects(employee_id, project_id)</code>, which can also carry attributes of the relationship such as <code>role</code> and <code>allocation_pct</code>.</p>`,
  tags: ['design','keys'] },
{ q: `What is a schema in PostgreSQL?`,
  a: `<p>A schema is a namespace inside a database that contains tables, views, functions and types. Every database starts with <code>public</code>. Objects are referenced as <code>schema.table</code>, and unqualified names are resolved via <code>search_path</code>. Schemas are used to organize modules (<code>sales.orders</code>, <code>hr.employees</code>), separate extensions, and manage permissions. Since PostgreSQL 15, ordinary users can no longer create objects in <code>public</code> by default.</p>`,
  tags: ['basics','ddl'] },
{ q: `What is a database, a schema, and a cluster in PostgreSQL terminology?`,
  a: `<p>A <strong>cluster</strong> is one PostgreSQL server instance (one data directory, one port) hosting multiple <strong>databases</strong>. Each database is isolated: a normal query cannot join across databases (you would need <code>postgres_fdw</code> or <code>dblink</code>). Within a database, <strong>schemas</strong> are namespaces you can freely query across. Roles (users) are cluster-wide.</p>`,
  tags: ['basics','architecture'] },
{ q: `What is a transaction? What happens if you do not use BEGIN?`,
  a: `<p>A transaction groups statements into one all-or-nothing unit: <code>BEGIN; ... COMMIT;</code> (or <code>ROLLBACK</code> to undo). Without an explicit <code>BEGIN</code>, PostgreSQL runs each statement in its own implicit transaction (autocommit). A classic example is a money transfer: debit and credit must both happen or neither. Inside a transaction, once a statement errors, all further statements fail until you <code>ROLLBACK</code> (or roll back to a savepoint).</p>`,
  tags: ['transactions'] },
{ q: `What is an index, in one paragraph?`,
  a: `<p>An index is a separate data structure — by default a B-tree — that maps column values to row locations, like the index at the back of a book. It lets PostgreSQL find rows without scanning the whole table, speeding up <code>WHERE</code>, <code>JOIN</code> and <code>ORDER BY</code>. The trade-offs: extra disk space, slower <code>INSERT</code>/<code>UPDATE</code>/<code>DELETE</code> because every index must be maintained, and the planner will ignore it if a query touches a large fraction of the table.</p>`,
  tags: ['indexes'] },
{ q: `What is a view?`,
  a: `<p>A view is a stored, named query: <code>CREATE VIEW active_employees AS SELECT ... WHERE is_active;</code>. It stores no data — each time you query it, PostgreSQL expands the definition into your query. Views simplify complex joins, provide a stable interface and can restrict which columns users see. Simple single-table views are automatically updatable. A <strong>materialized view</strong> stores the result physically and must be refreshed.</p>`,
  tags: ['views'] },
{ q: `How do you safely add a NOT NULL column to an existing table with data?`,
  a: `<p>Add it with a default in one step: <code>ALTER TABLE customers ADD COLUMN tier text NOT NULL DEFAULT 'standard';</code>. Since PostgreSQL 11 a constant default is stored in the catalog and no rewrite is needed, so this is fast even on big tables. Without a default, <code>NOT NULL</code> fails because existing rows would be NULL. For a computed backfill: add nullable, backfill in batches, then add <code>NOT NULL</code> (PostgreSQL 18 lets you add it as <code>NOT VALID</code> and validate later to avoid a long lock).</p>`,
  tags: ['ddl','constraints','nulls'] }
];

PGM.INTERVIEW.intermediate = [
{ q: `Explain the difference between a correlated and a non-correlated subquery.`,
  a: `<p>A <strong>non-correlated</strong> subquery is independent of the outer query and can be evaluated once: <code>WHERE salary &gt; (SELECT avg(salary) FROM employees)</code>. A <strong>correlated</strong> subquery references columns of the outer row, so logically it runs once per outer row:</p><pre>SELECT e.first_name, e.salary
FROM employees e
WHERE e.salary &gt; (SELECT avg(salary) FROM employees x
                  WHERE x.department_id = e.department_id);</pre><p>The planner converts many correlated <code>EXISTS</code>/<code>IN</code> subqueries into semi/anti joins; scalar correlated subqueries usually stay as SubPlans, which can be slow on large inputs — rewriting as a join to a grouped CTE or a window function often helps.</p>`,
  tags: ['subqueries'] },
{ q: `EXISTS vs IN — which is faster in PostgreSQL?`,
  a: `<p>For <code>IN (subquery)</code> and <code>EXISTS</code> the planner usually produces the same <strong>semi-join</strong>, so performance is typically identical. The real difference is with the negations: <code>NOT IN</code> has NULL-related semantics that block anti-join planning and can return no rows if the subquery yields a NULL, while <code>NOT EXISTS</code> becomes an efficient <strong>anti-join</strong> and is NULL-safe. Rule: prefer <code>NOT EXISTS</code> over <code>NOT IN</code> with subqueries.</p>`,
  tags: ['subqueries','performance'] },
{ q: `Write a query to find customers who have never placed an order.`,
  a: `<pre>SELECT c.id, c.name
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);</pre><p>This is planned as a Hash Anti Join. The equivalent <code>LEFT JOIN orders o ON ... WHERE o.id IS NULL</code> also works. Avoid <code>NOT IN (SELECT customer_id FROM orders)</code> — if <code>customer_id</code> were ever NULL it returns nothing.</p>`,
  tags: ['subqueries','joins','query-writing'] },
{ q: `What is a CTE (WITH clause) and why use it?`,
  a: `<p>A Common Table Expression names a sub-result for use in the main query, making complex logic readable step by step:</p><pre>WITH dept_avg AS (
  SELECT department_id, avg(salary) AS avg_sal
  FROM employees GROUP BY department_id)
SELECT e.first_name, e.salary, d.avg_sal
FROM employees e JOIN dept_avg d USING (department_id)
WHERE e.salary &gt; d.avg_sal;</pre><p>CTEs can also be recursive, and can contain data-modifying statements (<code>WITH moved AS (DELETE ... RETURNING *) INSERT ...</code>).</p>`,
  tags: ['cte'] },
{ q: `Are CTEs an optimization fence in PostgreSQL?`,
  a: `<p>Not by default since PostgreSQL 12. A non-recursive, side-effect-free CTE referenced <strong>once</strong> is inlined into the outer query so filters can be pushed down. A CTE referenced more than once is materialized (computed once). You can force behavior with <code>WITH x AS MATERIALIZED (...)</code> — useful to prevent repeated expensive evaluation or to fence off a bad plan — or <code>AS NOT MATERIALIZED</code> to force inlining. Before v12, every CTE was a fence, which is why older advice warns against them.</p>`,
  tags: ['cte','performance'] },
{ q: `What is a recursive CTE? Write one for an employee hierarchy.`,
  a: `<pre>WITH RECURSIVE chain AS (
  SELECT id, first_name, manager_id, 1 AS depth
  FROM employees WHERE id = 1
  UNION ALL
  SELECT e.id, e.first_name, e.manager_id, c.depth + 1
  FROM employees e JOIN chain c ON e.manager_id = c.id)
SELECT * FROM chain ORDER BY depth;</pre><p>The anchor member seeds the result; the recursive member repeatedly joins to the rows produced in the previous iteration until no new rows appear. Guard against cycles with a depth limit or the <code>CYCLE</code> clause (PostgreSQL 14+), and use <code>UNION</code> instead of <code>UNION ALL</code> if duplicates could loop.</p>`,
  tags: ['cte','recursion','query-writing'] },
{ q: `What is a window function and how does it differ from GROUP BY?`,
  a: `<p>A window function computes a value across a set of rows related to the current row <strong>without collapsing them</strong>. <code>GROUP BY</code> returns one row per group; a window function returns every row plus the computed value:</p><pre>SELECT first_name, department_id, salary,
       avg(salary) OVER (PARTITION BY department_id) AS dept_avg
FROM employees;</pre><p>Windows are evaluated after <code>WHERE</code>/<code>GROUP BY</code>/<code>HAVING</code>, so you cannot filter on them directly — wrap in a subquery or CTE.</p>`,
  tags: ['window-functions'] },
{ q: `ROW_NUMBER vs RANK vs DENSE_RANK?`,
  a: `<p>For salaries 100, 90, 90, 80: <code>ROW_NUMBER()</code> gives 1, 2, 3, 4 (ties broken arbitrarily unless ORDER BY is unique); <code>RANK()</code> gives 1, 2, 2, 4 (gaps after ties); <code>DENSE_RANK()</code> gives 1, 2, 2, 3 (no gaps). Use ROW_NUMBER for de-duplication and "exactly one per group", DENSE_RANK for "the Nth highest distinct value", and RANK for competition-style ranking.</p>`,
  tags: ['window-functions'] },
{ q: `Write a query for the top 3 highest-paid employees in each department.`,
  a: `<pre>SELECT department_id, first_name, salary
FROM (
  SELECT department_id, first_name, salary,
         dense_rank() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rnk
  FROM employees) t
WHERE rnk &lt;= 3
ORDER BY department_id, rnk;</pre><p>Use <code>row_number()</code> if you need exactly three rows even with ties. An alternative for large tables with an index on <code>(department_id, salary DESC)</code> is a <code>LATERAL</code> join with <code>LIMIT 3</code> per department.</p>`,
  tags: ['window-functions','query-writing'] },
{ q: `Write a query to find the second highest salary.`,
  a: `<pre>SELECT DISTINCT salary
FROM employees
ORDER BY salary DESC
OFFSET 1 LIMIT 1;</pre><p>Alternatives: <code>SELECT max(salary) FROM employees WHERE salary &lt; (SELECT max(salary) FROM employees)</code>, or <code>dense_rank() OVER (ORDER BY salary DESC) = 2</code> in a subquery, which generalizes to the Nth highest. Clarify with the interviewer whether ties count as the same value — DISTINCT/DENSE_RANK assume they do.</p>`,
  tags: ['query-writing','window-functions'] },
{ q: `What do LAG and LEAD do? Give a practical example.`,
  a: `<p><code>LAG(expr, n, default)</code> reads a value from a previous row in the window order; <code>LEAD</code> reads from a following row. Month-over-month revenue change:</p><pre>WITH m AS (
  SELECT date_trunc('month', order_date) AS month, sum(total_amount) AS revenue
  FROM orders WHERE status &lt;&gt; 'cancelled' GROUP BY 1)
SELECT month, revenue,
       revenue - lag(revenue) OVER (ORDER BY month) AS change
FROM m ORDER BY month;</pre>`,
  tags: ['window-functions','query-writing'] },
{ q: `Write a running total of revenue by day.`,
  a: `<pre>SELECT order_date::date AS day,
       sum(total_amount) AS daily,
       sum(sum(total_amount)) OVER (ORDER BY order_date::date) AS running_total
FROM orders
WHERE status &lt;&gt; 'cancelled'
GROUP BY 1
ORDER BY 1;</pre><p>Note the nested aggregate: the inner <code>sum</code> is the GROUP BY aggregate, the outer is the window sum over the grouped rows. With <code>ORDER BY</code> in the window, the default frame is <code>RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW</code>, which yields a running total.</p>`,
  tags: ['window-functions','query-writing'] },
{ q: `What is a window frame, and ROWS vs RANGE vs GROUPS?`,
  a: `<p>The frame is the subset of the partition that aggregate window functions see for the current row. <code>ROWS</code> counts physical rows (<code>ROWS BETWEEN 6 PRECEDING AND CURRENT ROW</code> = 7-row moving window). <code>RANGE</code> works on values of the ORDER BY key, so peers (ties) are included together and you can say <code>RANGE BETWEEN INTERVAL '7 days' PRECEDING AND CURRENT ROW</code>. <code>GROUPS</code> counts peer groups. Pitfall: with ORDER BY and no frame, the default is RANGE ... CURRENT ROW, so ties get the same running total and <code>last_value()</code> returns the current row, not the partition's last.</p>`,
  tags: ['window-functions'] },
{ q: `What is the FILTER clause on aggregates?`,
  a: `<p><code>FILTER (WHERE ...)</code> restricts which rows feed a particular aggregate, allowing several conditional aggregates in one pass:</p><pre>SELECT customer_id,
       count(*) AS orders,
       count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
       sum(total_amount) FILTER (WHERE status = 'delivered') AS delivered_value
FROM orders GROUP BY customer_id;</pre><p>It is SQL standard and clearer than <code>sum(CASE WHEN ... THEN 1 ELSE 0 END)</code>.</p>`,
  tags: ['aggregation'] },
{ q: `What are GROUPING SETS, ROLLUP and CUBE?`,
  a: `<p>They compute several groupings in one query. <code>ROLLUP (country, segment)</code> produces (country, segment), (country), and the grand total — hierarchical subtotals. <code>CUBE (a, b)</code> produces all combinations: (a,b), (a), (b), (). <code>GROUPING SETS ((a), (b))</code> lists exactly the groupings you want. The <code>GROUPING(col)</code> function tells you whether a NULL in the output is a real NULL or a subtotal placeholder.</p>`,
  tags: ['aggregation'] },
{ q: `What does string_agg / array_agg do? Show an example.`,
  a: `<pre>SELECT d.name,
       string_agg(e.first_name, ', ' ORDER BY e.first_name) AS team
FROM departments d JOIN employees e ON e.department_id = d.id
GROUP BY d.name;</pre><p><code>string_agg</code> concatenates values with a separator; <code>array_agg</code> builds an array; <code>jsonb_agg</code> builds a JSON array. All accept an <code>ORDER BY</code> inside the call to make the output deterministic.</p>`,
  tags: ['aggregation'] },
{ q: `Explain ACID.`,
  a: `<ul><li><strong>Atomicity</strong>: a transaction is all-or-nothing; in PostgreSQL an aborted transaction's row versions are simply never visible (its status in <code>pg_xact</code> is aborted).</li><li><strong>Consistency</strong>: constraints, foreign keys and triggers keep data valid at commit.</li><li><strong>Isolation</strong>: concurrent transactions do not see each other's uncommitted work; strength depends on isolation level (MVCC snapshots).</li><li><strong>Durability</strong>: once COMMIT returns, the change survives a crash because the WAL record was flushed to disk (with <code>synchronous_commit = on</code>).</li></ul>`,
  tags: ['acid','transactions'] },
{ q: `What isolation levels does PostgreSQL provide, and which is the default?`,
  a: `<p>Default is <strong>Read Committed</strong>: each statement sees a fresh snapshot of committed data. <strong>Repeatable Read</strong>: one snapshot for the whole transaction (taken at its first statement); concurrent updates to the same row cause a serialization error. <strong>Serializable</strong>: Repeatable Read plus Serializable Snapshot Isolation (SSI), which detects dangerous read/write dependency patterns and aborts one transaction. <code>READ UNCOMMITTED</code> is accepted but behaves as Read Committed — PostgreSQL never shows dirty reads.</p>`,
  tags: ['isolation','transactions'] },
{ q: `What are dirty reads, non-repeatable reads and phantom reads?`,
  a: `<p><strong>Dirty read</strong>: seeing another transaction's uncommitted changes — impossible in PostgreSQL. <strong>Non-repeatable read</strong>: re-reading a row and getting a different value because another transaction committed an update — possible in Read Committed. <strong>Phantom read</strong>: re-running a range query and getting new rows — possible in Read Committed; PostgreSQL's Repeatable Read prevents it (stricter than the SQL standard requires). A fourth anomaly, <strong>serialization anomaly</strong> (e.g. write skew), is only prevented by Serializable.</p>`,
  tags: ['isolation','transactions'] },
{ q: `What is a savepoint?`,
  a: `<p>A savepoint marks a point inside a transaction you can roll back to without aborting everything:</p><pre>BEGIN;
INSERT INTO departments (name) VALUES ('Legal');
SAVEPOINT s1;
INSERT INTO departments (name) VALUES ('Legal');  -- unique violation
ROLLBACK TO SAVEPOINT s1;
COMMIT;  -- first insert is kept</pre><p>Drivers use them to recover from expected errors. Each savepoint creates a subtransaction; using thousands per transaction can cause subtransaction-cache overflow and performance problems.</p>`,
  tags: ['transactions'] },
{ q: `What is a lost update and how do you prevent it?`,
  a: `<p>Two sessions read the same balance (100), each computes a new value in the application and writes it back — one update overwrites the other. Fixes:</p><ul><li>Do the arithmetic atomically in SQL: <code>UPDATE accounts SET balance = balance - 30 WHERE id = 1</code>.</li><li>Pessimistic lock: <code>SELECT ... FOR UPDATE</code> before computing.</li><li>Optimistic locking: a <code>version</code> column checked in <code>WHERE version = :v</code>, retry if 0 rows updated.</li><li>Repeatable Read/Serializable, which raise a serialization error for the second writer, and retry.</li></ul>`,
  tags: ['transactions','concurrency'] },
{ q: `What does SELECT ... FOR UPDATE do? What about SKIP LOCKED and NOWAIT?`,
  a: `<p><code>FOR UPDATE</code> locks the selected rows so other transactions cannot update, delete or lock them until you commit; readers without locks are not blocked (MVCC). <code>NOWAIT</code> errors immediately if a row is already locked. <code>SKIP LOCKED</code> silently skips locked rows — ideal for job queues where many workers claim tasks:</p><pre>SELECT id FROM jobs WHERE status = 'pending'
ORDER BY id LIMIT 10
FOR UPDATE SKIP LOCKED;</pre><p>Weaker modes exist: <code>FOR NO KEY UPDATE</code>, <code>FOR SHARE</code>, <code>FOR KEY SHARE</code>.</p>`,
  tags: ['locking','transactions'] },
{ q: `What happens to a transaction after an error in PostgreSQL?`,
  a: `<p>The transaction enters an <strong>aborted</strong> state: every subsequent statement fails with "current transaction is aborted, commands ignored until end of transaction block" until you issue <code>ROLLBACK</code> (or <code>ROLLBACK TO SAVEPOINT</code>). Even <code>COMMIT</code> at that point actually performs a rollback. This differs from some databases that only fail the single statement; tools like psql's <code>ON_ERROR_ROLLBACK</code> emulate that using implicit savepoints.</p>`,
  tags: ['transactions'] },
{ q: `When does PostgreSQL use an index and when does it prefer a sequential scan?`,
  a: `<p>The planner compares estimated costs. An index scan wins when the predicate is <strong>selective</strong> (few rows) because random page reads are expensive. When a query touches a large fraction of the table (often more than roughly 5–20%, depending on correlation and <code>random_page_cost</code>), a sequential scan reading pages in order is cheaper. In between, a <strong>bitmap heap scan</strong> collects matching TIDs and reads pages in physical order. Small tables are almost always seq-scanned.</p>`,
  tags: ['indexes','planner'] },
{ q: `What is a composite (multi-column) index and why does column order matter?`,
  a: `<p>A B-tree on <code>(customer_id, order_date)</code> is sorted by customer, then by date within each customer. It efficiently serves <code>WHERE customer_id = 5</code>, <code>WHERE customer_id = 5 AND order_date &gt;= '2025-01-01'</code> and <code>ORDER BY order_date</code> for one customer. It is much less useful for <code>WHERE order_date &gt;= ...</code> alone (the leading column is unconstrained; PostgreSQL 18's skip scan can help only when the leading column has few distinct values). Put equality columns first, range/sort columns last.</p>`,
  tags: ['indexes'] },
{ q: `Why might a query not use an index on a column it filters by?`,
  a: `<ul><li>Low selectivity — the planner correctly prefers a seq scan.</li><li>The column is wrapped in a function or cast: <code>WHERE lower(email) = ...</code> or <code>WHERE order_date::date = ...</code> needs an expression index or a rewritten predicate.</li><li>Leading wildcard <code>LIKE '%x'</code>.</li><li>Type mismatch between column and parameter.</li><li>Outdated statistics — run <code>ANALYZE</code>.</li><li>The index's leading column is not in the predicate.</li><li>An <code>OR</code> across different columns (may become BitmapOr, or not).</li></ul><p>Diagnose with <code>EXPLAIN (ANALYZE, BUFFERS)</code>.</p>`,
  tags: ['indexes','performance'] },
{ q: `What is the cost of having too many indexes?`,
  a: `<p>Every <code>INSERT</code>, and every <code>UPDATE</code> that cannot be HOT, must write an entry into each index, multiplying write I/O and WAL volume. Indexes consume disk and shared buffer space, extend VACUUM time, and — importantly — any index on an updated column disables HOT updates for that row. Find unused ones with <code>pg_stat_user_indexes</code> where <code>idx_scan = 0</code> (check replicas too, since stats are per-node) and drop duplicates.</p>`,
  tags: ['indexes','performance'] },
{ q: `How do you read a basic EXPLAIN output?`,
  a: `<p>EXPLAIN shows a tree of plan nodes; read it inside-out, the most indented nodes run first. Each node shows <code>cost=startup..total</code> (in arbitrary planner units), estimated <code>rows</code> and <code>width</code>. <code>EXPLAIN ANALYZE</code> actually executes the query and adds <code>actual time</code>, <code>rows</code> and <code>loops</code> — multiply per-loop numbers by loops. The first thing to check is estimated vs actual rows: a big mismatch is the root cause of most bad plans. Add <code>BUFFERS</code> to see I/O (enabled by default with ANALYZE in PostgreSQL 18).</p>`,
  tags: ['explain','performance'] },
{ q: `What is a view vs a materialized view?`,
  a: `<p>A <strong>view</strong> stores only the query; it is always current and costs whatever the underlying query costs. A <strong>materialized view</strong> stores the result set as a physical table: very fast to read and indexable, but stale until <code>REFRESH MATERIALIZED VIEW</code>. Use <code>REFRESH MATERIALIZED VIEW CONCURRENTLY</code> (requires a unique index on the MV) to refresh without blocking readers. PostgreSQL has no built-in incremental refresh.</p>`,
  tags: ['views'] },
{ q: `When is a view updatable? What is WITH CHECK OPTION?`,
  a: `<p>A view is automatically updatable if it selects from exactly one table or updatable view, without <code>DISTINCT</code>, <code>GROUP BY</code>, aggregates, window functions, set operations or <code>LIMIT</code>. Inserts/updates through it go to the base table. <code>WITH CHECK OPTION</code> rejects writes that would produce rows not visible through the view — e.g. inserting an inactive employee via an <code>active_employees</code> view. For complex views use <code>INSTEAD OF</code> triggers.</p>`,
  tags: ['views'] },
{ q: `What is security_barrier / security_invoker on views?`,
  a: `<p>By default a view runs with its <strong>owner's</strong> privileges on the underlying tables. <code>security_invoker = true</code> (PostgreSQL 15+) makes it check the caller's privileges and row-level security policies instead. <code>security_barrier</code> prevents user-supplied functions in the outer query from being pushed below the view's filter, where a leaky function (one that raises errors showing values) could expose rows the view is meant to hide.</p>`,
  tags: ['views','security'] },
{ q: `What is BCNF and how does it differ from 3NF?`,
  a: `<p>Boyce-Codd Normal Form requires that for every non-trivial functional dependency X → Y, X is a superkey. 3NF allows an exception when Y is part of a candidate key. The difference appears with overlapping candidate keys, e.g. (student, course) → instructor and instructor → course: it is 3NF but not BCNF because instructor is not a superkey. Decomposing to BCNF may lose the ability to enforce some dependencies with simple constraints, which is why many designs stop at 3NF.</p>`,
  tags: ['normalization'] },
{ q: `What is a functional dependency?`,
  a: `<p>A functional dependency X → Y means that for any two rows with the same X, Y must also be the same. In <code>employees</code>, <code>id → email</code> and <code>email → id</code> hold. Normal forms are defined in terms of them. In practice you discover them from business rules ("a SKU always has one name") and then make the determinant a key of its own table so the rule is enforced by a constraint.</p>`,
  tags: ['normalization'] },
{ q: `Write a query that finds duplicate customer emails case-insensitively.`,
  a: `<pre>SELECT lower(email) AS email_norm, count(*), array_agg(id ORDER BY id) AS ids
FROM customers
GROUP BY lower(email)
HAVING count(*) &gt; 1;</pre><p>To prevent them going forward, add a unique expression index: <code>CREATE UNIQUE INDEX ON customers (lower(email));</code> or use the <code>citext</code> <span class="tag ext">extension</span> type. Queries must then use <code>lower(email)</code> to hit the index.</p>`,
  tags: ['query-writing','indexes'] },
{ q: `How do you delete duplicate rows while keeping one?`,
  a: `<pre>DELETE FROM customers c
USING (
  SELECT id, row_number() OVER (PARTITION BY lower(email) ORDER BY id) AS rn
  FROM customers) d
WHERE c.id = d.id AND d.rn &gt; 1;</pre><p>The window numbers each duplicate group; everything after the first is deleted. If the table has no key, use <code>ctid</code> as a temporary identity. Then add a unique constraint so duplicates cannot reappear.</p>`,
  tags: ['query-writing','window-functions'] },
{ q: `What is UPSERT in PostgreSQL? Show INSERT ... ON CONFLICT.`,
  a: `<pre>INSERT INTO products (sku, name, category, price, stock)
VALUES ('SKU-1001', 'USB-C Hub', 'accessories', 2499, 10)
ON CONFLICT (sku) DO UPDATE
SET stock = products.stock + EXCLUDED.stock,
    price = EXCLUDED.price;</pre><p><code>ON CONFLICT</code> needs a unique index or constraint as the arbiter. <code>EXCLUDED</code> refers to the row you tried to insert. <code>DO NOTHING</code> skips conflicts. It is atomic and race-free, unlike "SELECT then INSERT" in application code.</p>`,
  tags: ['crud','upsert'] },
{ q: `What is MERGE and how does it compare with ON CONFLICT?`,
  a: `<p><code>MERGE</code> (SQL standard, PostgreSQL 15+) applies <code>WHEN MATCHED THEN UPDATE/DELETE</code> and <code>WHEN NOT MATCHED THEN INSERT</code> actions from a source to a target; PostgreSQL 17 added <code>WHEN NOT MATCHED BY SOURCE</code> and <code>RETURNING</code>. Unlike <code>ON CONFLICT</code>, it does not require a unique index and can delete — but it is <strong>not</strong> concurrency-safe in the same way: two sessions inserting the same key can still get a unique violation. Use ON CONFLICT for high-concurrency upserts and MERGE for batch synchronization.</p>`,
  tags: ['crud','upsert'] },
{ q: `What is a LATERAL join?`,
  a: `<p><code>LATERAL</code> lets a subquery in <code>FROM</code> reference columns of preceding tables — like a for-each loop. Classic use: latest 3 orders per customer:</p><pre>SELECT c.name, o.id, o.order_date
FROM customers c
CROSS JOIN LATERAL (
  SELECT id, order_date FROM orders
  WHERE customer_id = c.id
  ORDER BY order_date DESC LIMIT 3) o;</pre><p>With an index on <code>(customer_id, order_date DESC)</code> each inner probe is cheap. Use <code>LEFT JOIN LATERAL ... ON true</code> to keep customers with no orders.</p>`,
  tags: ['joins'] },
{ q: `What are the three physical join algorithms PostgreSQL uses?`,
  a: `<ul><li><strong>Nested Loop</strong>: for each outer row, probe the inner side (ideally via an index). Best when the outer side is small.</li><li><strong>Hash Join</strong>: build a hash table on the smaller input, then stream the larger one. Best for large unsorted equality joins; needs <code>work_mem</code> (spills to disk in batches otherwise).</li><li><strong>Merge Join</strong>: both inputs sorted on the join key, walked in step. Good when inputs are already sorted (index order) or very large.</li></ul><p>Only nested loop supports non-equality join conditions.</p>`,
  tags: ['joins','planner'] },
{ q: `What is a semi-join and an anti-join?`,
  a: `<p>A <strong>semi-join</strong> returns each left row at most once if <em>any</em> match exists on the right — what <code>EXISTS</code>/<code>IN</code> produce; it avoids the row multiplication a normal join would cause. An <strong>anti-join</strong> returns left rows with <em>no</em> match — what <code>NOT EXISTS</code> or <code>LEFT JOIN ... WHERE right.key IS NULL</code> produce. In EXPLAIN you see <code>Hash Semi Join</code> or <code>Hash Anti Join</code>.</p>`,
  tags: ['joins','subqueries'] },
{ q: `Why does joining one-to-many and then summing give inflated totals (fan-out)?`,
  a: `<p>If you join <code>orders</code> to both <code>order_items</code> and <code>payments</code>, each item row is repeated for every payment row, so <code>sum(total_amount)</code> or <code>sum(quantity)</code> is multiplied. Fix by aggregating each child table separately before joining:</p><pre>SELECT o.id, i.items, p.paid
FROM orders o
LEFT JOIN (SELECT order_id, sum(quantity) AS items FROM order_items GROUP BY 1) i ON i.order_id = o.id
LEFT JOIN (SELECT order_id, sum(amount) AS paid FROM payments WHERE status = 'success' GROUP BY 1) p ON p.order_id = o.id;</pre>`,
  tags: ['joins','aggregation'] },
{ q: `Write a query for monthly revenue per country for 2025.`,
  a: `<pre>SELECT c.country,
       date_trunc('month', o.order_date) AS month,
       sum(o.total_amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status IN ('paid','shipped','delivered')
  AND o.order_date &gt;= '2025-01-01' AND o.order_date &lt; '2026-01-01'
GROUP BY c.country, month
ORDER BY c.country, month;</pre><p>The half-open date range keeps the predicate sargable (index-friendly), unlike <code>extract(year FROM order_date) = 2025</code>.</p>`,
  tags: ['query-writing','aggregation'] },
{ q: `What does "sargable" mean? Give examples.`,
  a: `<p>A predicate is sargable (Search ARGument-able) if an index can be used to evaluate it — the indexed column appears bare on one side of a supported operator. <code>WHERE order_date &gt;= '2025-01-01'</code> is sargable; <code>WHERE date_trunc('year', order_date) = '2025-01-01'</code> is not (unless you build an expression index on exactly that expression); <code>WHERE salary * 12 &gt; 1000000</code> is not, but <code>WHERE salary &gt; 1000000 / 12.0</code> is. Rewrite predicates to move computation to the constant side.</p>`,
  tags: ['indexes','performance'] },
{ q: `What is a partial index? Give a use case.`,
  a: `<p>A partial index covers only rows matching a <code>WHERE</code> clause: <code>CREATE INDEX ON orders (order_date) WHERE status = 'pending';</code>. It is much smaller and cheaper to maintain when queries target a small subset (e.g. pending orders out of millions delivered). The planner uses it only when the query's WHERE implies the index predicate. Also handy for "unique among active rows": <code>CREATE UNIQUE INDEX ON users (email) WHERE is_active;</code>.</p>`,
  tags: ['indexes'] },
{ q: `What is an expression (functional) index?`,
  a: `<p>An index on the result of an expression rather than a raw column, e.g. <code>CREATE INDEX ON customers (lower(email));</code>. The query must use the same expression (<code>WHERE lower(email) = 'a@b.com'</code>) to benefit. Functions used must be <code>IMMUTABLE</code>; that is why <code>date_trunc</code> on <code>timestamptz</code> cannot be indexed directly (it depends on the TimeZone setting). PostgreSQL also collects statistics on indexed expressions during ANALYZE.</p>`,
  tags: ['indexes'] },
{ q: `What is a covering index / INCLUDE clause and an index-only scan?`,
  a: `<p>An index-only scan answers a query entirely from the index without visiting the heap — possible when all referenced columns are in the index and the pages are marked all-visible in the visibility map. <code>INCLUDE</code> adds non-key payload columns: <code>CREATE INDEX ON orders (customer_id) INCLUDE (total_amount);</code> lets <code>SELECT sum(total_amount) FROM orders WHERE customer_id = 7</code> skip the heap. Watch "Heap Fetches" in EXPLAIN ANALYZE; frequent vacuuming keeps it low.</p>`,
  tags: ['indexes'] },
{ q: `How would you paginate efficiently through a large result set?`,
  a: `<p>Use keyset (seek) pagination instead of OFFSET:</p><pre>SELECT id, order_date, total_amount
FROM orders
WHERE (order_date, id) &lt; (:last_date, :last_id)
ORDER BY order_date DESC, id DESC
LIMIT 50;</pre><p>With an index on <code>(order_date DESC, id DESC)</code> each page costs the same regardless of depth, and results do not shift when rows are inserted. The row-value comparison handles ties on <code>order_date</code>. Trade-off: no random "jump to page 500".</p>`,
  tags: ['pagination','query-writing','performance'] },
{ q: `What are the main categories of SQL functions in PostgreSQL: scalar, aggregate, window, set-returning?`,
  a: `<p><strong>Scalar</strong> functions return one value per row (<code>upper</code>, <code>round</code>, <code>age</code>). <strong>Aggregate</strong> functions combine many rows into one (<code>sum</code>, <code>array_agg</code>). <strong>Window</strong> functions compute over a window without collapsing rows (<code>rank</code>, or any aggregate with <code>OVER</code>). <strong>Set-returning</strong> functions return multiple rows and are used in <code>FROM</code> (<code>generate_series</code>, <code>unnest</code>, <code>jsonb_array_elements</code>). Add <code>WITH ORDINALITY</code> to number the output of a set-returning function.</p>`,
  tags: ['functions'] },
{ q: `How do you fill gaps in a time series (show days with zero orders)?`,
  a: `<pre>SELECT d::date AS day, count(o.id) AS orders
FROM generate_series('2025-09-01'::date, '2025-09-30'::date, interval '1 day') AS d
LEFT JOIN orders o
  ON o.order_date &gt;= d AND o.order_date &lt; d + interval '1 day'
GROUP BY d
ORDER BY d;</pre><p><code>generate_series</code> produces the complete calendar; the LEFT JOIN keeps days without orders, and <code>count(o.id)</code> (not <code>count(*)</code>) returns 0 for them.</p>`,
  tags: ['query-writing','dates'] },
{ q: `How do you calculate a median or percentile per group?`,
  a: `<pre>SELECT department_id,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY salary) AS median_salary,
       percentile_disc(0.9) WITHIN GROUP (ORDER BY salary) AS p90_salary
FROM employees
GROUP BY department_id;</pre><p>These are ordered-set aggregates. <code>percentile_cont</code> interpolates between values (median of 10 and 20 is 15); <code>percentile_disc</code> returns an actual value from the set. Pass an array (<code>percentile_cont(ARRAY[0.25,0.5,0.75])</code>) to get several percentiles in one pass. They are not usable as window functions.</p>`,
  tags: ['aggregation','query-writing'] },
{ q: `Why does last_value() in a window often return the current row's value?`,
  a: `<p>When the window has <code>ORDER BY</code> and no explicit frame, the frame ends at the current row (and its peers), so the "last" row of the frame is the current row. Fix it by widening the frame:</p><pre>last_value(salary) OVER (PARTITION BY department_id ORDER BY hire_date
  ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)</pre><p>Or simply use <code>first_value</code> with the opposite sort order. <code>nth_value</code> has the same frame dependency.</p>`,
  tags: ['window-functions'] },
{ q: `Write a 7-day moving average of daily order revenue.`,
  a: `<pre>WITH daily AS (
  SELECT order_date::date AS day, sum(total_amount) AS revenue
  FROM orders WHERE status &lt;&gt; 'cancelled'
  GROUP BY 1)
SELECT day, revenue,
       round(avg(revenue) OVER (ORDER BY day
             ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS ma7
FROM daily ORDER BY day;</pre><p><code>ROWS</code> counts rows, so a missing day silently stretches the window; if days can be missing, either fill gaps with <code>generate_series</code> or use <code>RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW</code>.</p>`,
  tags: ['window-functions','query-writing'] },
{ q: `How do you pivot rows into columns in PostgreSQL?`,
  a: `<p>The portable way is conditional aggregation:</p><pre>SELECT c.country,
  count(*) FILTER (WHERE o.status = 'paid')      AS paid,
  count(*) FILTER (WHERE o.status = 'shipped')   AS shipped,
  count(*) FILTER (WHERE o.status = 'delivered') AS delivered
FROM orders o JOIN customers c ON c.id = o.customer_id
GROUP BY c.country;</pre><p>The <code>tablefunc</code> <span class="tag ext">extension</span> provides <code>crosstab()</code>, but output columns must still be declared up front. SQL cannot produce a dynamic number of columns without dynamic SQL; often it is better to pivot in the application or BI tool.</p>`,
  tags: ['aggregation','query-writing'] },
{ q: `Explain the "gaps and islands" problem and how to solve it.`,
  a: `<p>Goal: group consecutive values (e.g. consecutive order days per customer) into ranges. Trick: subtract a <code>row_number()</code> from the value — consecutive values share the same difference:</p><pre>WITH d AS (
  SELECT DISTINCT customer_id, order_date::date AS day FROM orders),
g AS (
  SELECT customer_id, day,
         day - (row_number() OVER (PARTITION BY customer_id ORDER BY day))::int AS grp
  FROM d)
SELECT customer_id, min(day) AS streak_start, max(day) AS streak_end, count(*) AS days
FROM g GROUP BY customer_id, grp
HAVING count(*) &gt; 1;</pre>`,
  tags: ['window-functions','query-writing'] },
{ q: `Write a query to find employees who earn more than their manager.`,
  a: `<pre>SELECT e.first_name, e.salary, m.first_name AS manager, m.salary AS manager_salary
FROM employees e
JOIN employees m ON m.id = e.manager_id
WHERE e.salary &gt; m.salary;</pre><p>A self join on <code>manager_id</code>. INNER JOIN is correct here because heads (no manager) cannot satisfy the condition anyway.</p>`,
  tags: ['joins','query-writing'] },
{ q: `What is relational division? Find customers who bought from every product category.`,
  a: `<p>Relational division answers "X related to <em>all</em> of Y". The counting approach:</p><pre>SELECT o.customer_id
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
GROUP BY o.customer_id
HAVING count(DISTINCT p.category) = (SELECT count(DISTINCT category) FROM products);</pre><p>The alternative is a double <code>NOT EXISTS</code> ("there is no category for which the customer has no purchase"), which is more general but harder to read.</p>`,
  tags: ['query-writing','aggregation'] },
{ q: `Write a query showing each row's percentage of its group total.`,
  a: `<pre>SELECT department_id, first_name, salary,
       round(100.0 * salary / sum(salary) OVER (PARTITION BY department_id), 2) AS pct_of_dept,
       round(100.0 * salary / sum(salary) OVER (), 2) AS pct_of_company
FROM employees;</pre><p><code>OVER ()</code> is a window over the whole result. Multiply by <code>100.0</code> (numeric) rather than <code>100</code> to avoid integer division when the columns are integers.</p>`,
  tags: ['window-functions','query-writing'] },
{ q: `Build a monthly customer cohort: count customers by the month of their first order.`,
  a: `<pre>WITH first_order AS (
  SELECT customer_id, date_trunc('month', min(order_date)) AS cohort
  FROM orders GROUP BY customer_id)
SELECT cohort, count(*) AS new_customers
FROM first_order
GROUP BY cohort ORDER BY cohort;</pre><p>Extend it to retention by joining back to <code>orders</code> and computing the month offset between each order and the cohort month, then counting distinct customers per (cohort, offset).</p>`,
  tags: ['query-writing','aggregation'] },
{ q: `What do ANY and ALL do?`,
  a: `<p><code>x op ANY (subquery|array)</code> is true if the comparison holds for at least one element; <code>x op ALL (...)</code> requires it for every element. <code>WHERE id = ANY(ARRAY[1,2,3])</code> is equivalent to <code>IN</code> and is the idiomatic way to pass a list as a single bind parameter (<code>= ANY($1)</code>). <code>salary &gt; ALL (SELECT salary FROM employees WHERE department_id = 2)</code> means higher than everyone in department 2. Beware: <code>ALL</code> over an empty set is true, and NULLs make the result NULL.</p>`,
  tags: ['subqueries','sql'] },
{ q: `What error do you get when a scalar subquery returns more than one row, and how do you fix it?`,
  a: `<p>"more than one row returned by a subquery used as an expression". A scalar subquery in the select list or in <code>WHERE x = (...)</code> must return at most one row (zero rows gives NULL). Fixes depend on intent: aggregate it (<code>max</code>), add a correlating condition that makes it unique, use <code>LIMIT 1</code> with a deterministic <code>ORDER BY</code>, or switch to <code>IN</code>/<code>EXISTS</code> if you meant set membership.</p>`,
  tags: ['subqueries'] },
{ q: `Derived table vs CTE vs temporary table — when to use each?`,
  a: `<p>A <strong>derived table</strong> (subquery in FROM) and a <strong>CTE</strong> are scoped to one statement; CTEs read better and can be referenced more than once or be recursive. A <strong>temporary table</strong> persists for the session (or transaction with <code>ON COMMIT DROP</code>), can be indexed and <code>ANALYZE</code>d, and is useful when an intermediate result is reused across several statements or needs good statistics. Note that autovacuum does not process temp tables, so run <code>ANALYZE</code> on them manually after loading.</p>`,
  tags: ['cte','subqueries'] },
{ q: `Show a data-modifying CTE that archives and deletes rows atomically.`,
  a: `<pre>WITH moved AS (
  DELETE FROM audit_logs
  WHERE changed_at &lt; now() - interval '1 year'
  RETURNING *)
INSERT INTO audit_logs_archive
SELECT * FROM moved;</pre><p>Both operations happen in one statement and one snapshot, so no row can be lost or duplicated between them. All sub-statements see the same snapshot and cannot see each other's changes except through <code>RETURNING</code>.</p>`,
  tags: ['cte','crud'] },
{ q: `How do you UPDATE a table using values from another table?`,
  a: `<pre>UPDATE orders o
SET total_amount = s.items_total
FROM (SELECT order_id, sum(quantity * unit_price) AS items_total
      FROM order_items GROUP BY order_id) s
WHERE s.order_id = o.id
  AND o.total_amount IS DISTINCT FROM s.items_total;</pre><p><code>UPDATE ... FROM</code> is a PostgreSQL extension. Ensure the join produces at most one source row per target row — otherwise which value wins is unpredictable. The <code>IS DISTINCT FROM</code> filter skips no-op updates that would only create dead tuples.</p>`,
  tags: ['crud','joins','query-writing'] },
{ q: `Why are long-running or "idle in transaction" sessions harmful?`,
  a: `<p>An open transaction holds a snapshot, so VACUUM cannot remove row versions that became dead after it started — tables and indexes bloat across the whole database. It may also hold locks that block DDL, and a queued <code>ACCESS EXCLUSIVE</code> lock then blocks everyone behind it. Detect them in <code>pg_stat_activity</code> (<code>state = 'idle in transaction'</code>, old <code>xact_start</code>) and protect yourself with <code>idle_in_transaction_session_timeout</code> and short transactions in application code.</p>`,
  tags: ['transactions','operations'] },
{ q: `What does synchronous_commit = off do? Is it safe?`,
  a: `<p>COMMIT returns before the WAL is flushed to disk; the WAL writer flushes shortly after (within about 3 × <code>wal_writer_delay</code>). A crash can lose the last few hundred milliseconds of committed transactions, but it <strong>cannot corrupt</strong> the database — the data stays consistent. It can be set per session or per transaction (<code>SET LOCAL synchronous_commit = off</code>), making it a good trade-off for low-value high-volume writes such as click logs, while keeping it on for payments.</p>`,
  tags: ['transactions','durability'] },
{ q: `How should an application handle serialization failures?`,
  a: `<p>Under Repeatable Read or Serializable, PostgreSQL may abort a transaction with SQLSTATE <code>40001</code> (serialization_failure); deadlocks raise <code>40P01</code>. These are expected, not bugs: the application must <strong>retry the whole transaction</strong> from the beginning, including its reads, usually with a small backoff and a retry cap. Keep such transactions short and side-effect free outside the database (do not send an email before COMMIT succeeds).</p>`,
  tags: ['transactions','isolation'] },
{ q: `What is transactional DDL and why is it valuable?`,
  a: `<p>In PostgreSQL most DDL (<code>CREATE TABLE</code>, <code>ALTER TABLE</code>, <code>CREATE INDEX</code>) participates in transactions, so a migration can be wrapped in <code>BEGIN ... COMMIT</code> and either applies completely or not at all — no half-migrated schema after a failure. Exceptions include <code>CREATE INDEX CONCURRENTLY</code>, <code>CREATE DATABASE</code>, <code>VACUUM</code> and <code>ALTER TYPE ... ADD VALUE</code> in some contexts, which cannot run inside a transaction block (or have restrictions).</p>`,
  tags: ['transactions','ddl'] },
{ q: `What index types does PostgreSQL offer and what is each for?`,
  a: `<ul><li><strong>B-tree</strong> (default): equality, ranges, sorting, uniqueness.</li><li><strong>Hash</strong>: equality only; WAL-logged since v10 but rarely better than B-tree.</li><li><strong>GIN</strong>: "contains" queries on composite values — <code>jsonb</code>, arrays, full-text <code>tsvector</code>, trigrams.</li><li><strong>GiST</strong>: geometric data, ranges, nearest-neighbour, exclusion constraints.</li><li><strong>SP-GiST</strong>: space-partitioned structures (quad-trees, radix trees), e.g. IP ranges, points.</li><li><strong>BRIN</strong>: tiny block-range summaries for huge, naturally ordered tables (time-series).</li></ul>`,
  tags: ['indexes'] },
{ q: `What is CREATE INDEX CONCURRENTLY and what are its caveats?`,
  a: `<p>It builds an index without blocking inserts, updates and deletes (plain <code>CREATE INDEX</code> takes a <code>SHARE</code> lock that blocks writes). Caveats: it does two table scans and waits for existing transactions, so it is slower; it cannot run inside a transaction block; and if it fails it leaves an <strong>INVALID</strong> index that still adds write overhead — find it with <code>pg_index.indisvalid = false</code>, drop it and retry. Use <code>REINDEX CONCURRENTLY</code> to rebuild similarly.</p>`,
  tags: ['indexes','operations'] },
{ q: `Why should foreign key columns usually be indexed?`,
  a: `<p>PostgreSQL indexes the referenced (parent) key automatically but not the referencing (child) column. Without an index on, say, <code>orders.customer_id</code>: joins and lookups by customer need full scans, and every <code>DELETE</code> or key <code>UPDATE</code> on <code>customers</code> must scan <code>orders</code> to check for children — on big tables this turns a 1 ms delete into seconds and holds locks longer. Exception: tiny child tables or parents that are never deleted and never joined from that side.</p>`,
  tags: ['indexes','keys'] },
{ q: `What does ANALYZE do and why does it matter?`,
  a: `<p><code>ANALYZE</code> samples the table (300 × <code>default_statistics_target</code> rows, 30,000 by default) and stores per-column statistics in <code>pg_statistic</code> (readable via <code>pg_stats</code>): null fraction, distinct count, most common values and histogram. The planner uses these to estimate row counts, which drive join order and scan choice. Stale statistics after bulk loads are a top cause of bad plans; autovacuum runs ANALYZE automatically, but run it manually right after large loads.</p>`,
  tags: ['planner','statistics'] },
{ q: `Why is EXPLAIN ANALYZE on an UPDATE or DELETE dangerous, and how do you do it safely?`,
  a: `<p><code>EXPLAIN ANALYZE</code> actually <strong>executes</strong> the statement, so it really modifies data. Wrap it in a transaction and roll back:</p><pre>BEGIN;
EXPLAIN (ANALYZE, BUFFERS)
UPDATE products SET price = price * 1.05 WHERE category = 'audio';
ROLLBACK;</pre><p>Plain <code>EXPLAIN</code> (without ANALYZE) only shows the estimated plan and changes nothing.</p>`,
  tags: ['explain'] },
{ q: `Name the common scan node types in EXPLAIN and what each means.`,
  a: `<ul><li><strong>Seq Scan</strong>: reads every page of the table.</li><li><strong>Index Scan</strong>: walks the index, fetches each matching heap tuple (random I/O), returns rows in index order.</li><li><strong>Index Only Scan</strong>: answers from the index alone, visiting the heap only for pages not all-visible.</li><li><strong>Bitmap Index Scan + Bitmap Heap Scan</strong>: builds a bitmap of matching pages, then reads them in physical order; can combine indexes with BitmapAnd/BitmapOr.</li></ul><p>Each is optimal in a different selectivity range.</p>`,
  tags: ['explain','indexes'] },
{ q: `Can you drop or alter a column that a view depends on? How does CREATE OR REPLACE VIEW behave?`,
  a: `<p>No — PostgreSQL tracks dependencies, so <code>ALTER TABLE ... DROP COLUMN</code> fails if a view uses the column (unless you add <code>CASCADE</code>, which drops the view too), and changing a used column's type is also blocked. <code>CREATE OR REPLACE VIEW</code> may only <strong>add</strong> columns at the end; it cannot rename, reorder, remove or retype existing ones — for that you drop and recreate the view (and its dependents) inside one transaction.</p>`,
  tags: ['views','ddl'] },
{ q: `Is storing arrays or jsonb a violation of 1NF? When is it acceptable?`,
  a: `<p>Strictly, a multi-valued column breaks 1NF. In PostgreSQL it is a pragmatic choice when the values are read and written as a unit, have no independent identity, and do not need foreign keys — e.g. <code>products.tags text[]</code> or flexible <code>attributes jsonb</code>, indexed with GIN. Normalize instead when you need to reference elements from other tables, enforce per-element constraints, aggregate across elements often, or update individual elements concurrently.</p>`,
  tags: ['normalization','design'] },
{ q: `What is the EAV (entity-attribute-value) pattern and why is it usually discouraged?`,
  a: `<p>EAV stores attributes as rows: <code>(entity_id, attribute_name, value text)</code>. It is flexible, but you lose data types, constraints and foreign keys, every attribute read becomes a self-join or pivot, and statistics are useless. In PostgreSQL, a <code>jsonb</code> column for the variable attributes (plus real columns for core ones and CHECK constraints or JSON validation where needed) usually gives the flexibility with far less pain.</p>`,
  tags: ['design','normalization'] },
{ q: `Lookup table vs ENUM type vs CHECK constraint for a status column?`,
  a: `<p>A <strong>CHECK</strong> (<code>status IN ('pending','paid',...)</code>) is simple and easy to change. An <strong>ENUM</strong> type is compact (4 bytes) and sorts in declaration order; values can be added (<code>ALTER TYPE ... ADD VALUE</code>) but not easily removed or renamed. A <strong>lookup table</strong> with a foreign key is most flexible: values can carry metadata (labels, sort order, active flag) and be managed as data. Choose lookup tables for business-managed lists, CHECK or ENUM for small fixed sets.</p>`,
  tags: ['design','constraints'] },
{ q: `What are the pitfalls of soft deletes (an is_deleted flag)?`,
  a: `<p>Every query must remember <code>WHERE NOT is_deleted</code>; unique constraints must become partial (<code>CREATE UNIQUE INDEX ... WHERE NOT is_deleted</code>) or a deleted email blocks re-registration; foreign keys still point at "deleted" rows; tables keep growing. Mitigations: a view exposing only live rows, partial indexes, or moving deleted rows to an archive table via a trigger. Use soft delete only when you really need undo or audit.</p>`,
  tags: ['design'] },
{ q: `Show common date/time operations: truncating, extracting, intervals, age.`,
  a: `<pre>SELECT date_trunc('month', order_date)           AS month_start,
       extract(dow FROM order_date)              AS weekday,
       order_date + interval '30 days'           AS due,
       age(now(), order_date)                    AS age,
       now()::date - order_date::date            AS days_ago
FROM orders LIMIT 5;</pre><p><code>date - date</code> returns an integer number of days; <code>timestamp - timestamp</code> returns an interval. <code>now()</code> is fixed for the whole transaction; use <code>clock_timestamp()</code> for the actual current time.</p>`,
  tags: ['dates','functions'] },
{ q: `What is the difference between ::type and CAST(), and what happens on invalid casts?`,
  a: `<p><code>value::integer</code> is PostgreSQL shorthand for the standard <code>CAST(value AS integer)</code>; they are equivalent. An invalid conversion (<code>'abc'::int</code>) raises an error and aborts the transaction. PostgreSQL 16 added <code>pg_input_is_valid('abc', 'integer')</code> to test first. PostgreSQL is strict about implicit casts — comparing text to integer fails rather than silently converting, which avoids a class of bugs.</p>`,
  tags: ['data-types'] },
{ q: `Name some useful string functions in PostgreSQL.`,
  a: `<ul><li><code>split_part(email, '@', 2)</code> — the domain.</li><li><code>concat_ws(' ', first_name, last_name)</code> — NULL-skipping join.</li><li><code>left</code>, <code>right</code>, <code>substring</code>, <code>position</code>, <code>replace</code>, <code>trim</code>.</li><li><code>regexp_replace</code>, <code>regexp_matches</code>, and <code>regexp_count</code>/<code>regexp_substr</code> (v15+).</li><li><code>format('%s earns %s', name, salary)</code> — and <code>%I</code>/<code>%L</code> for safe dynamic SQL identifiers and literals.</li><li><code>string_to_array</code>, <code>initcap</code>, <code>lpad</code>.</li></ul>`,
  tags: ['functions','strings'] },
{ q: `Is the order of rows from a subquery's ORDER BY preserved in the outer query?`,
  a: `<p>No. SQL sets are unordered; only the <strong>outermost</strong> <code>ORDER BY</code> guarantees output order. An ORDER BY inside a subquery or view is meaningful only when combined with <code>LIMIT</code> (which rows are picked) or for aggregates that consume order — and even then, use the aggregate's own <code>ORDER BY</code> (<code>array_agg(x ORDER BY y)</code>). Never rely on insertion order or "it has always come back sorted".</p>`,
  tags: ['sql'] },
{ q: `What are generated columns? STORED vs VIRTUAL?`,
  a: `<p>A generated column is computed from other columns of the same row: <code>total numeric GENERATED ALWAYS AS (quantity * unit_price) STORED</code>. <strong>STORED</strong> computes on write and occupies disk (can be indexed). PostgreSQL 18 adds <strong>VIRTUAL</strong> generated columns, computed on read, and makes VIRTUAL the default when neither keyword is given. The expression must be immutable and cannot reference other tables. company_db's <code>documents.search</code> tsvector is a stored generated column.</p>`,
  tags: ['ddl','data-types'] },
{ q: `Why do sequences produce gaps, and can you make them gapless?`,
  a: `<p><code>nextval()</code> is non-transactional: a value handed out is never returned, even if the transaction rolls back, and sessions may cache values (<code>CACHE</code>). Crashes can also skip values. This is by design so that concurrent inserts never wait on each other. If a business truly needs gapless numbers (invoice numbers), use a counter row updated inside the same transaction (<code>UPDATE counters SET n = n + 1 ... RETURNING n</code>), accepting that it serializes inserts.</p>`,
  tags: ['data-types','concurrency'] },
{ q: `How do you query array columns? Show common operators.`,
  a: `<pre>SELECT name FROM products WHERE 'wireless' = ANY(tags);
SELECT name FROM products WHERE tags @&gt; ARRAY['wireless','bluetooth'];
SELECT name FROM products WHERE tags &amp;&amp; ARRAY['sale','new'];
SELECT tag, count(*) FROM products, unnest(tags) AS tag GROUP BY tag;</pre><p><code>@&gt;</code> contains, <code>&lt;@</code> is contained by, <code>&amp;&amp;</code> overlaps; these can use a GIN index on the array. <code>= ANY</code> cannot use a GIN index — prefer <code>@&gt;</code> for indexed lookups. Arrays are 1-based.</p>`,
  tags: ['data-types','arrays'] },
{ q: `json vs jsonb — what is the difference?`,
  a: `<p><code>json</code> stores the raw text: it preserves whitespace, key order and duplicate keys, and is reparsed on every access. <code>jsonb</code> stores a decomposed binary form: slightly slower to write, much faster to query, removes duplicate keys (last wins), does not preserve key order, and supports GIN indexing and containment operators (<code>@&gt;</code>, <code>?</code>). Use <code>jsonb</code> in almost all cases; <code>json</code> only when you must preserve the exact input text.</p>`,
  tags: ['jsonb','data-types'] },
{ q: `Write a query listing products that have never been sold.`,
  a: `<pre>SELECT p.id, p.sku, p.name
FROM products p
WHERE NOT EXISTS (
  SELECT 1 FROM order_items oi WHERE oi.product_id = p.id);</pre><p>An anti-join. Without an index on <code>order_items(product_id)</code>, PostgreSQL will hash the whole <code>order_items</code> table once — still efficient for a single report, but add the index if this runs often.</p>`,
  tags: ['query-writing','subqueries'] },
{ q: `Write a query for the best-selling product (by revenue) in each category.`,
  a: `<pre>WITH rev AS (
  SELECT p.category, p.name, sum(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi JOIN products p ON p.id = oi.product_id
  GROUP BY p.category, p.name)
SELECT DISTINCT ON (category) category, name, revenue
FROM rev
ORDER BY category, revenue DESC;</pre><p><code>DISTINCT ON</code> keeps the first row per category in the given order. Use <code>rank()</code> instead if ties should all be shown.</p>`,
  tags: ['query-writing','aggregation'] },
{ q: `Write a year-over-year revenue growth query by month.`,
  a: `<pre>WITH m AS (
  SELECT date_trunc('month', order_date) AS month, sum(total_amount) AS revenue
  FROM orders WHERE status &lt;&gt; 'cancelled' GROUP BY 1)
SELECT cur.month, cur.revenue, prev.revenue AS last_year,
       round(100.0 * (cur.revenue - prev.revenue) / NULLIF(prev.revenue, 0), 1) AS yoy_pct
FROM m cur
LEFT JOIN m prev ON prev.month = cur.month - interval '1 year'
ORDER BY cur.month;</pre><p>A self join on month offset is robust to missing months, unlike <code>lag(revenue, 12)</code>, which assumes every month exists. <code>NULLIF</code> avoids division by zero.</p>`,
  tags: ['query-writing','dates'] },
{ q: `Why is SELECT count(*) on a big table slow in PostgreSQL, and what are the alternatives?`,
  a: `<p>Because of MVCC, row visibility depends on the snapshot, so PostgreSQL cannot keep a single stored row count; it must scan the table (or an index, with an index-only scan if the visibility map is current). Alternatives: use the estimate <code>SELECT reltuples FROM pg_class WHERE relname = 'orders'</code> (maintained by VACUUM/ANALYZE), parse the row estimate from <code>EXPLAIN</code> for filtered counts, or maintain a counter table via triggers if exact counts are required frequently.</p>`,
  tags: ['performance','mvcc'] },
{ q: `What are deferrable constraints?`,
  a: `<p>Normally constraints are checked at the end of each statement. A constraint declared <code>DEFERRABLE INITIALLY DEFERRED</code> (or set with <code>SET CONSTRAINTS ... DEFERRED</code>) is checked at <code>COMMIT</code>. This allows temporarily inconsistent states inside a transaction — inserting two rows that reference each other, or swapping unique values between two rows. Only <code>UNIQUE</code>, <code>PRIMARY KEY</code>, <code>FOREIGN KEY</code> and <code>EXCLUDE</code> can be deferrable; <code>NOT NULL</code> and <code>CHECK</code> cannot.</p>`,
  tags: ['constraints','transactions'] },
{ q: `Explain the ON DELETE options for a foreign key.`,
  a: `<ul><li><code>NO ACTION</code> (default): error if children exist; checked at end of statement (can be deferred).</li><li><code>RESTRICT</code>: same, but checked immediately and not deferrable.</li><li><code>CASCADE</code>: delete the children too — convenient for owned data like <code>order_items</code>, dangerous for shared data.</li><li><code>SET NULL</code> / <code>SET DEFAULT</code>: detach children (since PostgreSQL 15 you can list specific columns).</li></ul><p>Cascades run as internal triggers; a cascade across millions of rows is a single huge transaction.</p>`,
  tags: ['constraints','keys'] },
{ q: `How do you add a constraint to a large table without a long blocking scan?`,
  a: `<p>Add it as <code>NOT VALID</code>, then validate separately:</p><pre>ALTER TABLE orders ADD CONSTRAINT orders_amount_pos
  CHECK (total_amount &gt;= 0) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_amount_pos;</pre><p>The first step is instant and enforces the rule for new writes. <code>VALIDATE</code> scans existing rows but only takes a <code>SHARE UPDATE EXCLUSIVE</code> lock, so normal reads and writes continue. Works for CHECK and FOREIGN KEY constraints, and for NOT NULL since PostgreSQL 18.</p>`,
  tags: ['constraints','operations'] },
{ q: `How do roles and GRANT work in PostgreSQL?`,
  a: `<p>PostgreSQL has a single concept, the <strong>role</strong>: a role with <code>LOGIN</code> is a user, one without is a group. Privileges are granted on objects (<code>GRANT SELECT ON orders TO analyst;</code>) and on schemas (<code>USAGE</code>, <code>CREATE</code>). Membership (<code>GRANT analyst TO alice;</code>) passes privileges. Use <code>ALTER DEFAULT PRIVILEGES</code> so future tables get grants automatically, and predefined roles like <code>pg_read_all_data</code> for broad access. Follow least privilege: applications should not connect as the table owner or a superuser.</p>`,
  tags: ['security','roles'] },
{ q: `How do you prevent SQL injection when querying PostgreSQL?`,
  a: `<p>Use parameterized queries (bind parameters, <code>$1</code> placeholders) so values are sent separately from the SQL text and are never parsed as code. Never concatenate user input into SQL. For dynamic identifiers (table or column names) inside PL/pgSQL, use <code>format('%I', name)</code> and <code>format('%L', value)</code> or <code>quote_ident</code>/<code>quote_literal</code>, and whitelist allowed names. Also limit the damage with least-privilege roles.</p>`,
  tags: ['security'] },
{ q: `Why do PostgreSQL deployments typically use a connection pooler?`,
  a: `<p>Each connection is a separate OS backend process with its own memory (several MB plus <code>work_mem</code> per sort/hash), and opening one costs a fork plus authentication. Thousands of mostly idle connections waste memory and increase contention. A pooler such as PgBouncer <span class="tag tool">third-party tool</span> multiplexes many client connections onto a small number of server connections (often around 2–4 × CPU cores). In transaction pooling mode, session state (SET, advisory locks, temp tables) does not persist between transactions.</p>`,
  tags: ['architecture','operations'] },
{ q: `What is the difference between a temporary table and an UNLOGGED table?`,
  a: `<p>A <strong>temporary table</strong> is visible only to the session that created it and disappears at session (or transaction) end; it lives in local buffers. An <strong>UNLOGGED table</strong> is a normal shared table whose changes skip WAL, making writes much faster, but it is truncated after a crash and is not replicated to standbys. Use unlogged tables for staging/ETL or caches that can be rebuilt; never for data you cannot lose.</p>`,
  tags: ['ddl','performance'] },
{ q: `Write a query to find customers whose total spending is above the average customer spending.`,
  a: `<pre>WITH spend AS (
  SELECT customer_id, sum(total_amount) AS total
  FROM orders WHERE status IN ('paid','shipped','delivered')
  GROUP BY customer_id)
SELECT c.name, s.total
FROM spend s JOIN customers c ON c.id = s.customer_id
WHERE s.total &gt; (SELECT avg(total) FROM spend)
ORDER BY s.total DESC;</pre><p>The CTE is referenced twice, so PostgreSQL materializes it once. Clarify whether customers with zero orders should count in the average — if yes, LEFT JOIN customers and COALESCE to 0.</p>`,
  tags: ['query-writing','cte'] },
{ q: `What does a HAVING clause without GROUP BY do?`,
  a: `<p>The whole input becomes a single group, so the query returns one row if the HAVING condition is true and zero rows otherwise: <code>SELECT count(*) FROM orders HAVING count(*) &gt; 1000;</code>. It is occasionally used for assertions in scripts. Similarly, an aggregate without GROUP BY over zero rows still returns one row (count 0, sum NULL).</p>`,
  tags: ['aggregation','sql'] },
{ q: `What is the difference between JOIN ... USING and JOIN ... ON, and what is NATURAL JOIN?`,
  a: `<p><code>ON</code> takes any boolean condition. <code>USING (department_id)</code> is shorthand for equality on same-named columns and outputs that column once (so <code>SELECT *</code> has no duplicate). <code>NATURAL JOIN</code> implicitly joins on <strong>all</strong> same-named columns — fragile, because adding a column like <code>created_at</code> or <code>name</code> to both tables silently changes the join. Avoid NATURAL JOIN in production code.</p>`,
  tags: ['joins'] }
];

PGM.INTERVIEW.advanced = [
{ q: `How do you design an indexing strategy for a new high-traffic table?`,
  a: `<p>Start from the <strong>workload</strong>, not the columns: list the top queries by frequency × latency (from <code>pg_stat_statements</code> <span class="tag ext">extension</span>). For each, design one index whose leading columns are the equality predicates, then range/sort columns, optionally <code>INCLUDE</code> columns for index-only scans. Merge overlapping candidates (an index on <code>(a, b)</code> also serves <code>a</code>). Weigh write amplification and HOT-update loss on frequently updated columns. Then verify with <code>EXPLAIN (ANALYZE, BUFFERS)</code> on production-like data, and review <code>pg_stat_user_indexes</code> periodically to drop unused indexes.</p>`,
  tags: ['indexing-strategy'] },
{ q: `What is a HOT update and how does indexing affect it?`,
  a: `<p>A Heap-Only Tuple update happens when the new row version fits on the <strong>same page</strong> and <strong>no indexed column changed</strong>. Then no index entries are written: the old tuple's line pointer is chained to the new one, and pruning can later reclaim the old version without VACUUM. Indexing a frequently updated column (e.g. <code>last_login</code>) disables HOT for those updates, multiplying write I/O and index bloat. Lowering <code>fillfactor</code> (e.g. 80–90) leaves room on pages to make HOT more likely. Monitor <code>n_tup_hot_upd</code> vs <code>n_tup_upd</code> in <code>pg_stat_user_tables</code>. (Since PostgreSQL 16, changes to columns used only by BRIN indexes no longer prevent HOT.)</p>`,
  tags: ['indexing-strategy','mvcc'] },
{ q: `How does B-tree deduplication and bottom-up deletion help (PostgreSQL 13+/14+)?`,
  a: `<p><strong>Deduplication</strong> (v13) stores a key once with a posting list of TIDs when many rows share the same value, shrinking indexes on low-cardinality columns several-fold. <strong>Bottom-up index deletion</strong> (v14) removes obsolete duplicate entries created by non-HOT updates when a leaf page is about to split, preventing "version churn" bloat on indexes whose columns did not change. Both are automatic for B-trees (deduplication is disabled for some types, such as <code>numeric</code> and nondeterministic collations).</p>`,
  tags: ['indexes','internals'] },
{ q: `When would you choose BRIN over B-tree?`,
  a: `<p>BRIN stores min/max summaries per block range (128 pages by default) and is tiny — kilobytes for a table where a B-tree would be gigabytes. It works only when the column's values are <strong>correlated with physical order</strong>, e.g. append-only <code>created_at</code> on an event table. A query on a time window then skips all non-matching ranges. If rows are updated or inserted out of order, ranges overlap and BRIN degenerates into a near full scan. Check correlation in <code>pg_stats.correlation</code> (close to ±1 is good). The <code>minmax_multi</code> opclass (v14) tolerates some outliers.</p>`,
  tags: ['indexes','indexing-strategy'] },
{ q: `What is the difference between GIN jsonb_ops and jsonb_path_ops?`,
  a: `<p><code>jsonb_ops</code> (default) indexes every key and value separately and supports <code>@&gt;</code>, <code>?</code>, <code>?|</code>, <code>?&amp;</code> and jsonpath operators. <code>jsonb_path_ops</code> hashes each full path-to-value, producing a smaller and faster index for containment (<code>@&gt;</code>) and jsonpath match queries, but it cannot answer key-existence operators (<code>?</code>). If the workload is mostly <code>attributes @&gt; '{"brand":"Sony"}'</code>, prefer <code>jsonb_path_ops</code>; if you only query one key, a B-tree expression index on <code>(attributes-&gt;&gt;'brand')</code> is smaller still.</p>`,
  tags: ['jsonb','indexes'] },
{ q: `What is GIN fastupdate / the pending list, and why can it cause latency spikes?`,
  a: `<p>GIN inserts are expensive because one row can produce many index entries. With <code>fastupdate</code> (on by default), new entries go into an unsorted <strong>pending list</strong> and are merged into the main index in bulk by VACUUM, or when the list exceeds <code>gin_pending_list_limit</code> (4MB default). The unlucky insert that triggers the merge pays the whole cost, causing latency spikes, and searches must also scan the pending list. For latency-sensitive writes, disable <code>fastupdate</code> or lower the limit, and ensure autovacuum keeps up.</p>`,
  tags: ['indexes','performance'] },
{ q: `How does the planner estimate selectivity, and what are extended statistics?`,
  a: `<p>For each column the planner uses <code>pg_statistic</code> (MCV list, histogram, n_distinct, null fraction) and assumes predicates on different columns are <strong>independent</strong>, multiplying selectivities. For correlated columns (<code>city = 'Pune' AND country = 'India'</code>) that badly underestimates rows, leading to nested loops over huge inputs. <code>CREATE STATISTICS s (dependencies, ndistinct, mcv) ON city, country FROM customers;</code> then <code>ANALYZE</code> teaches the planner the correlation. Extended statistics on expressions are also supported (v14+).</p>`,
  tags: ['planner','statistics'] },
{ q: `You see "rows=1" estimated but "rows=500000" actual in a plan. What do you do?`,
  a: `<p>A misestimate this large usually explains a bad plan (nested loop chosen where a hash join was needed). Steps: run <code>ANALYZE</code> on the tables; check whether the predicate uses functions, casts or expressions without statistics (add an expression index or extended statistics on the expression); look for correlated columns (create multivariate statistics); raise the column's statistics target (<code>ALTER TABLE ... ALTER COLUMN ... SET STATISTICS 1000</code>) for skewed data; and check for opaque function calls or parameters in generic plans. Fix estimates first, before reaching for planner hacks.</p>`,
  tags: ['planner','explain','statistics'] },
{ q: `What are generic vs custom plans for prepared statements?`,
  a: `<p>For a prepared statement, PostgreSQL builds <strong>custom plans</strong> using the actual parameter values for the first five executions, then compares their average cost with a <strong>generic plan</strong> (parameter-independent). If the generic plan is not much worse, it switches to it to save planning time. With skewed data this can be disastrous: the generic plan may suit common values but be terrible for rare ones (or vice versa). Control it with <code>plan_cache_mode = force_custom_plan</code> or <code>force_generic_plan</code>, per session or per role.</p>`,
  tags: ['planner','performance'] },
{ q: `Explain the key fields of EXPLAIN (ANALYZE, BUFFERS) output you look at first.`,
  a: `<ul><li><strong>Estimated vs actual rows</strong> per node (times <code>loops</code>) — the root of most problems.</li><li><strong>Where the time goes</strong> — actual total time of a node minus its children.</li><li><strong>Buffers</strong>: <code>shared hit</code> (cache) vs <code>read</code> (from OS/disk) vs <code>dirtied/written</code>; temp read/written means spills.</li><li><strong>Rows Removed by Filter</strong> — an index that is not selective or not used.</li><li><strong>Sort Method: external merge</strong> or <strong>Hash Batches &gt; 1</strong> — insufficient <code>work_mem</code>.</li><li><strong>Heap Fetches</strong> on index-only scans — visibility map not current.</li></ul>`,
  tags: ['explain','performance'] },
{ q: `What is work_mem and why is setting it high globally dangerous?`,
  a: `<p><code>work_mem</code> is the memory a single sort or hash operation may use before spilling to temp files. It is per <strong>operation</strong>, not per query or connection: a complex query can use several multiples, parallel workers each get their own, and hash nodes may use <code>work_mem × hash_mem_multiplier</code> (2.0 default). With 500 connections, a global 256MB could exhaust RAM and invoke the OOM killer. Keep the global value modest (e.g. 16–64MB) and raise it per session or role for reporting: <code>SET LOCAL work_mem = '512MB'</code>.</p>`,
  tags: ['performance','configuration'] },
{ q: `How does parallel query work and when does it not kick in?`,
  a: `<p>A Gather (or Gather Merge) node launches background workers that run a portion of the plan (parallel seq scan, parallel index scan, parallel hash join, partial aggregates) and combines their results. It is limited by <code>max_parallel_workers_per_gather</code>, <code>max_parallel_workers</code> and <code>max_worker_processes</code>, and only considered for tables above <code>min_parallel_table_scan_size</code> (8MB). It is not used for queries that write data (except some CREATE TABLE AS / CREATE INDEX cases), inside cursors, with functions marked <code>PARALLEL UNSAFE</code>, or when the plan is cheap enough that worker startup is not worth it.</p>`,
  tags: ['performance','planner'] },
{ q: `What do random_page_cost and effective_cache_size influence?`,
  a: `<p><code>random_page_cost</code> (default 4.0, relative to <code>seq_page_cost</code> 1.0) tells the planner how expensive random I/O is; on SSD/NVMe it should be around 1.1–1.5, which makes index scans more attractive. <code>effective_cache_size</code> allocates no memory — it is a hint of how much data is likely cached (shared buffers + OS cache), typically 50–75% of RAM; higher values make index scans look cheaper for repeated access. Wrong values on SSDs are a classic cause of avoidable sequential scans.</p>`,
  tags: ['planner','configuration'] },
{ q: `Explain MVCC visibility: how does PostgreSQL decide whether a tuple is visible to a snapshot?`,
  a: `<p>A snapshot records <code>xmin</code> (oldest still-running XID), <code>xmax</code> (first not-yet-assigned XID) and the list of in-progress XIDs. A tuple is visible if its inserting transaction (<code>t_xmin</code>) committed and is "before" the snapshot (not in progress, less than snapshot xmax), and its deleting transaction (<code>t_xmax</code>) is either absent, aborted, or not yet visible to the snapshot. Commit status comes from <code>pg_xact</code>; to avoid repeated lookups PostgreSQL sets <strong>hint bits</strong> on the tuple the first time status is known — which is why a plain SELECT can dirty pages.</p>`,
  tags: ['mvcc','internals'] },
{ q: `What is transaction ID wraparound and how is it prevented?`,
  a: `<p>XIDs are 32-bit and compared modulo 2^32, so each transaction sees about 2 billion XIDs as past and 2 billion as future. Without intervention, old rows would suddenly appear to be "in the future" and vanish. <strong>Freezing</strong> (by VACUUM) marks old tuples as visible to everyone, regardless of XID. Autovacuum forces an anti-wraparound vacuum when a table's <code>relfrozenxid</code> age exceeds <code>autovacuum_freeze_max_age</code> (200M). If age approaches the limit, PostgreSQL stops assigning new XIDs to protect data. Monitor <code>age(datfrozenxid)</code> in <code>pg_database</code>, and watch for long transactions or stale replication slots that hold back freezing.</p>`,
  tags: ['mvcc','vacuum','operations'] },
{ q: `What is the visibility map and what uses it?`,
  a: `<p>The visibility map (the <code>_vm</code> fork) keeps two bits per heap page: <strong>all-visible</strong> (every tuple is visible to all transactions) and <strong>all-frozen</strong>. Index-only scans skip heap fetches on all-visible pages; VACUUM skips all-visible pages during normal runs and all-frozen pages during aggressive (anti-wraparound) runs. Any modification to a page clears its bits. Write-heavy tables therefore get fewer index-only scan benefits unless vacuumed frequently.</p>`,
  tags: ['mvcc','vacuum','internals'] },
{ q: `What causes table and index bloat, and how do you fix it?`,
  a: `<p>Bloat is space occupied by dead tuples or free space that is not reused efficiently. Causes: autovacuum not keeping up (thresholds too high for large tables, cost limits too low), long-running transactions or abandoned replication slots holding back the xmin horizon, mass updates/deletes, and non-HOT updates bloating indexes. Fixes: tune per-table autovacuum (<code>autovacuum_vacuum_scale_factor</code> low for big tables), remove horizon holders, <code>REINDEX CONCURRENTLY</code> for indexes, and for heaps <code>VACUUM FULL</code> (blocking) or <code>pg_repack</code> <span class="tag ext">extension</span> (online). Measure first with <code>pgstattuple</code> <span class="tag ext">extension</span>.</p>`,
  tags: ['mvcc','vacuum','operations'] },
{ q: `In Read Committed, what happens when an UPDATE finds a row that was concurrently updated?`,
  a: `<p>The UPDATE waits for the other transaction to finish. If it rolls back, the original row is used. If it commits, PostgreSQL follows the update chain to the newest version and <strong>re-evaluates the WHERE clause</strong> against it (the EvalPlanQual recheck); if it still matches, the update is applied to the new version, otherwise the row is skipped. This prevents lost updates for <code>SET x = x + 1</code>, but can give surprising results for complex statements, since the rest of the query still uses the old snapshot. In Repeatable Read the same situation raises a serialization error instead.</p>`,
  tags: ['isolation','concurrency'] },
{ q: `What is write skew, and which isolation level prevents it?`,
  a: `<p>Write skew: two transactions read overlapping data, make decisions based on it, and write <em>different</em> rows, together violating an invariant. Classic example: a rule "at least one doctor on call"; two doctors simultaneously check that the other is on call and both go off call. Neither touched the same row, so Repeatable Read (snapshot isolation) allows it. <strong>Serializable</strong> (SSI) detects the read/write dependency cycle and aborts one with a serialization failure. Alternatives: explicit <code>SELECT ... FOR UPDATE</code> on the rows the decision is based on, or a constraint that encodes the invariant.</p>`,
  tags: ['isolation','concurrency'] },
{ q: `How does Serializable Snapshot Isolation (SSI) work in PostgreSQL?`,
  a: `<p>SSI runs transactions on snapshots like Repeatable Read but additionally tracks reads with <strong>SIRead (predicate) locks</strong> — on tuples, pages or whole relations — which never block anyone. When a write conflicts with another transaction's SIRead lock, a read-write dependency (rw-antidependency) is recorded. If a transaction becomes the pivot of two consecutive rw-dependencies forming a dangerous structure, one transaction is aborted with SQLSTATE 40001. Costs: some false positives, memory for predicate locks (<code>max_pred_locks_per_transaction</code>), and the need for retry logic. Declaring read-only transactions as <code>READ ONLY DEFERRABLE</code> avoids aborts for long reports.</p>`,
  tags: ['isolation','internals'] },
{ q: `Explain table-level lock modes and which common commands take which.`,
  a: `<p>There are eight modes from weakest to strongest. Key ones:</p><ul><li><code>ACCESS SHARE</code>: SELECT.</li><li><code>ROW SHARE</code>: SELECT FOR UPDATE/SHARE.</li><li><code>ROW EXCLUSIVE</code>: INSERT, UPDATE, DELETE, MERGE.</li><li><code>SHARE UPDATE EXCLUSIVE</code>: VACUUM, ANALYZE, CREATE INDEX CONCURRENTLY, VALIDATE CONSTRAINT.</li><li><code>SHARE</code>: CREATE INDEX (blocks writes).</li><li><code>ACCESS EXCLUSIVE</code>: most ALTER TABLE, DROP, TRUNCATE, VACUUM FULL, REFRESH MATERIALIZED VIEW (non-concurrent) — conflicts with everything, even SELECT.</li></ul>`,
  tags: ['locking'] },
{ q: `Why can a quick ALTER TABLE take down production, and how do you prevent it?`,
  a: `<p>The ALTER needs an <code>ACCESS EXCLUSIVE</code> lock. If a long-running query holds even an <code>ACCESS SHARE</code> lock, the ALTER waits — and every new query on that table queues <strong>behind</strong> the waiting ALTER, because lock requests are granted in order. Within seconds the connection pool is exhausted. Prevention: set <code>lock_timeout</code> (e.g. 2–5s) before DDL and retry in a loop; check <code>pg_stat_activity</code> for long transactions first; and prefer online variants (<code>CONCURRENTLY</code>, <code>NOT VALID</code>, constant defaults).</p>`,
  tags: ['locking','operations'] },
{ q: `What row-level lock modes exist and why does FOR NO KEY UPDATE matter?`,
  a: `<p>Four modes: <code>FOR UPDATE</code> (strongest), <code>FOR NO KEY UPDATE</code>, <code>FOR SHARE</code>, <code>FOR KEY SHARE</code>. A normal UPDATE that does not change key columns takes <code>FOR NO KEY UPDATE</code>, and foreign key checks on child inserts take <code>FOR KEY SHARE</code> on the parent row — these two do <strong>not</strong> conflict, so updating a customer's name does not block inserting orders for that customer. Explicitly using <code>FOR UPDATE</code> where <code>FOR NO KEY UPDATE</code> suffices needlessly blocks those FK checks. Row locks are stored in the tuple's <code>xmax</code> (and MultiXacts when shared by several transactions), not in shared memory.</p>`,
  tags: ['locking','concurrency'] },
{ q: `What is a MultiXact and why should you monitor it?`,
  a: `<p>When several transactions hold row locks on the same tuple (e.g. many concurrent FK checks taking <code>FOR KEY SHARE</code> on one parent row), PostgreSQL stores a <strong>MultiXact ID</strong> in <code>xmax</code> that points to a list of member XIDs in <code>pg_multixact</code>. MultiXact IDs are also 32-bit and must be frozen by VACUUM to prevent wraparound (<code>autovacuum_multixact_freeze_max_age</code>). Heavy FK-check concurrency can churn through them, causing SLRU contention and aggressive vacuums. Monitor <code>mxid_age(datminmxid)</code> in <code>pg_database</code>.</p>`,
  tags: ['locking','mvcc','internals'] },
{ q: `What are advisory locks and when are they useful?`,
  a: `<p>Advisory locks are application-defined locks on a 64-bit key (or two 32-bit keys) that PostgreSQL tracks but never takes automatically. <code>pg_advisory_lock(k)</code> is session-level (held until released or disconnect); <code>pg_advisory_xact_lock(k)</code> is released at transaction end; <code>pg_try_advisory_lock</code> returns immediately. Uses: ensuring only one instance of a cron job runs, serializing work per tenant (<code>hashtext('tenant-42')</code>), migration locks. Caveat: session-level locks do not mix well with transaction-mode connection poolers.</p>`,
  tags: ['locking'] },
{ q: `How do you find which session is blocking another?`,
  a: `<pre>SELECT a.pid, a.usename, a.state, a.wait_event_type, a.query,
       pg_blocking_pids(a.pid) AS blocked_by,
       now() - a.xact_start AS xact_age
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) &gt; 0;</pre><p><code>pg_blocking_pids()</code> handles the lock-queue logic for you. Then inspect the blocker (often "idle in transaction"), and if needed end it with <code>pg_cancel_backend(pid)</code> (cancels the query) or <code>pg_terminate_backend(pid)</code> (kills the session). <code>pg_locks</code> gives the raw lock details.</p>`,
  tags: ['locking','operations'] },
{ q: `What is a deadlock and how does PostgreSQL detect and resolve it?`,
  a: `<p>A deadlock is a cycle of waits: T1 holds lock A and wants B, T2 holds B and wants A. When a backend has waited <code>deadlock_timeout</code> (1s default), it runs the deadlock detector over the wait-for graph; if it finds a cycle it aborts one transaction with SQLSTATE <code>40P01</code> "deadlock detected", and the log shows both statements. The surviving transaction proceeds. The application should retry the aborted transaction. <code>deadlock_timeout</code> is not a lock timeout — it is just when the (expensive) check runs.</p>`,
  tags: ['deadlocks','locking'] },
{ q: `How do you prevent deadlocks in application design?`,
  a: `<ul><li>Acquire locks in a <strong>consistent order</strong> — e.g. always update accounts in ascending id order: <code>SELECT ... WHERE id IN (a, b) ORDER BY id FOR UPDATE</code>.</li><li>Keep transactions short and avoid user interaction inside them.</li><li>Lock everything you need up front rather than escalating midway.</li><li>Batch bulk updates in a deterministic order (<code>ORDER BY</code> primary key).</li><li>Index foreign keys so cascades and checks touch fewer rows.</li><li>Use <code>SKIP LOCKED</code> for queue-like workloads.</li></ul><p>And always implement retry for <code>40P01</code>, because deadlocks can never be eliminated completely.</p>`,
  tags: ['deadlocks','concurrency'] },
{ q: `Two sessions run "UPDATE accounts ... WHERE id IN (1,2)" and deadlock. Why, and how do you fix it?`,
  a: `<p>An UPDATE locks rows in the order it encounters them, which depends on the plan and physical order — not on the <code>IN</code> list. If session A locks row 1 then waits on 2, while B locked 2 first, they deadlock. Fix by locking in a deterministic order before updating:</p><pre>BEGIN;
SELECT id FROM accounts WHERE id IN (1, 2) ORDER BY id FOR UPDATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;</pre><p>Note <code>FOR UPDATE</code> with <code>ORDER BY</code> locks rows as they are returned in that order.</p>`,
  tags: ['deadlocks','query-writing'] },
{ q: `What are lock_timeout, statement_timeout and idle_in_transaction_session_timeout?`,
  a: `<p><code>statement_timeout</code> cancels any statement running longer than the limit. <code>lock_timeout</code> cancels a statement that waits longer than the limit to acquire a lock — essential for DDL in production. <code>idle_in_transaction_session_timeout</code> terminates sessions that sit idle inside an open transaction. PostgreSQL 17 added <code>transaction_timeout</code> to cap whole transactions. Set conservative defaults per role (<code>ALTER ROLE app SET statement_timeout = '30s'</code>) rather than globally, so maintenance roles can run longer.</p>`,
  tags: ['locking','configuration'] },
{ q: `How do SKIP LOCKED-based job queues work, and what are their limits?`,
  a: `<p>Workers claim jobs with:</p><pre>UPDATE jobs SET status = 'running', started_at = now()
WHERE id IN (
  SELECT id FROM jobs WHERE status = 'pending'
  ORDER BY priority, id LIMIT 10
  FOR UPDATE SKIP LOCKED)
RETURNING *;</pre><p>Each worker skips rows locked by others, so there is no contention or double processing. Limits: every state change creates a dead tuple, so the table needs aggressive autovacuum and a partial index <code>WHERE status = 'pending'</code>; ordering is only approximate; and at very high throughput a dedicated broker may be better. Long-running jobs should commit the claim first and track a heartbeat rather than holding the lock.</p>`,
  tags: ['locking','concurrency'] },
{ q: `Does PostgreSQL have Oracle's "snapshot too old" error? What is the xmin horizon?`,
  a: `<p>PostgreSQL never errors like Oracle's "snapshot too old" (the <code>old_snapshot_threshold</code> feature was removed in v17). Instead, the oldest snapshot anywhere — a long transaction, a replication slot, or a standby with <code>hot_standby_feedback = on</code> — sets the <strong>xmin horizon</strong>, and VACUUM cannot remove any tuple deleted after it. The symptom is silent bloat and growing query times. Find the culprit by comparing <code>backend_xmin</code> in <code>pg_stat_activity</code>, <code>xmin</code>/<code>catalog_xmin</code> in <code>pg_replication_slots</code>, and prepared transactions in <code>pg_prepared_xacts</code>.</p>`,
  tags: ['mvcc','vacuum'] },
{ q: `How does autovacuum decide when to vacuum a table, and how do you tune it for a 500M-row table?`,
  a: `<p>A table is vacuumed when dead tuples exceed <code>autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor × reltuples</code> (50 + 20%). For 500M rows that is 100M dead tuples — far too late. Inserts also trigger vacuum (v13+, <code>autovacuum_vacuum_insert_*</code>) for visibility-map and freezing purposes. For big tables set per-table parameters: <code>ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_cost_limit = 2000);</code>. Globally, raise <code>autovacuum_vacuum_cost_limit</code> on fast storage and ensure enough <code>autovacuum_max_workers</code>. PostgreSQL 18 adds <code>autovacuum_vacuum_max_threshold</code> to cap the threshold for huge tables.</p>`,
  tags: ['vacuum','operations'] },
{ q: `What is index-only scan "Heap Fetches" and how do you reduce it?`,
  a: `<p>For each index entry, an index-only scan checks the visibility map; if the page is not all-visible, it must fetch the heap tuple to check visibility — counted as Heap Fetches. A high number means the index-only scan behaves like a regular index scan. Reduce it by vacuuming more often (lower the vacuum scale factors, or rely on insert-triggered vacuum for append-only tables), and by avoiding constant updates to recent rows that keep clearing visibility bits.</p>`,
  tags: ['indexes','vacuum'] },
{ q: `How do you safely create a unique constraint on a big live table?`,
  a: `<pre>CREATE UNIQUE INDEX CONCURRENTLY customers_email_uq ON customers (email);
ALTER TABLE customers ADD CONSTRAINT customers_email_key
  UNIQUE USING INDEX customers_email_uq;</pre><p>The index builds without blocking writes; attaching it as a constraint only needs a brief lock. If duplicates exist, the build fails and leaves an INVALID index, which you must drop, clean the data, and retry. The same <code>USING INDEX</code> trick works for adding a primary key (columns must already be NOT NULL).</p>`,
  tags: ['indexes','operations','constraints'] },
{ q: `Why can an index on (a, b) be useless for ORDER BY b, a, and what about mixed sort directions?`,
  a: `<p>A B-tree returns entries in key order (a, then b), and can be scanned backwards for the exact reverse. <code>ORDER BY b, a</code> is a different order, so a sort is needed. Mixed directions like <code>ORDER BY a ASC, b DESC</code> cannot be served by an <code>(a, b)</code> index either way — create <code>(a ASC, b DESC)</code>. NULLS FIRST/LAST must also match (or exactly reverse). PostgreSQL 13+ can do an <strong>Incremental Sort</strong> when the input is already sorted by a prefix of the keys, which reduces the cost.</p>`,
  tags: ['indexes','planner'] },
{ q: `What is an exclusion constraint? Give a real example.`,
  a: `<p>An exclusion constraint generalizes UNIQUE: no two rows may satisfy the given operators simultaneously. Preventing overlapping room bookings:</p><pre>CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE bookings (
  room_id int,
  during tstzrange,
  EXCLUDE USING gist (room_id WITH =, during WITH &amp;&amp;));</pre><p><code>btree_gist</code> (<span class="tag ext">extension</span>) lets the scalar <code>room_id</code> participate in a GiST index. It is enforced atomically, unlike application-side overlap checks, which race. PostgreSQL 18 adds <code>WITHOUT OVERLAPS</code> for temporal primary/unique keys built on the same mechanism.</p>`,
  tags: ['constraints','indexes'] },
{ q: `How does the planner choose join order, and what is the GEQO?`,
  a: `<p>For queries joining up to <code>join_collapse_limit</code>/<code>from_collapse_limit</code> (8) relations, the planner uses dynamic programming to evaluate join orders and methods exhaustively. Beyond <code>geqo_threshold</code> (12) relations it switches to the Genetic Query Optimizer, a heuristic search that may produce different (sometimes worse) plans between runs. For very large join queries, you can raise the limits (more planning time), or set <code>join_collapse_limit = 1</code> to force the explicit JOIN order you wrote.</p>`,
  tags: ['planner'] },
{ q: `What is partition pruning and when does it happen?`,
  a: `<p>Pruning removes partitions that cannot contain matching rows. <strong>Plan-time pruning</strong> uses constants in the WHERE clause. <strong>Execution-time pruning</strong> (v11+) uses values known only at run time — bind parameters in generic plans, subquery results, or the outer side of a nested loop — shown in EXPLAIN as "Subplans Removed". It requires the predicate to be on the partition key in a comparable form: <code>WHERE order_date &gt;= '2025-01-01'</code> prunes; <code>WHERE date_trunc('month', order_date) = ...</code> does not. <code>enable_partition_pruning</code> must be on (default).</p>`,
  tags: ['partitioning','planner'] },
{ q: `What are the partitioning methods in PostgreSQL and how do you pick one?`,
  a: `<p>Declarative partitioning supports <strong>RANGE</strong> (time-series: monthly partitions on <code>order_date</code>), <strong>LIST</strong> (discrete values: country, tenant groups) and <strong>HASH</strong> (spreading load evenly when there is no natural range, e.g. by <code>customer_id</code> modulus 16). Partitions can be sub-partitioned. Pick the method that matches the dominant query filter <em>and</em> the data lifecycle: range on time is by far the most common because it enables both pruning and cheap retention via <code>DETACH</code>/<code>DROP</code> of old partitions.</p>`,
  tags: ['partitioning'] },
{ q: `What are the limitations of declarative partitioning?`,
  a: `<ul><li>Primary keys and unique constraints must include all partition key columns (uniqueness is enforced per partition).</li><li>Foreign keys referencing a partitioned table are supported (v12+), but global indexes do not exist — each index is per partition.</li><li>Queries that do not filter on the partition key scan every partition; many partitions increase planning time and lock overhead.</li><li>Updating the partition key moves the row (delete + insert) between partitions.</li><li>Some features differ: e.g. BEFORE ROW triggers cannot change which partition a row goes to.</li></ul>`,
  tags: ['partitioning'] },
{ q: `How do you partition an existing large table with minimal downtime?`,
  a: `<p>Common approach: create a new partitioned table with the same columns; attach the existing table as one partition covering historical data (add a matching <code>CHECK</code> constraint first, validated with <code>NOT VALID</code> + <code>VALIDATE</code>, so <code>ATTACH PARTITION</code> skips its scan); create new partitions for future ranges; then swap names in a short transaction (rename old to <code>orders_legacy</code>, new to <code>orders</code>). Over time, migrate old data out of the legacy partition into proper partitions in batches. Tools like <code>pg_partman</code> <span class="tag ext">extension</span> automate creating future partitions.</p>`,
  tags: ['partitioning','operations'] },
{ q: `What does ATTACH PARTITION / DETACH PARTITION CONCURRENTLY do?`,
  a: `<p><code>ATTACH PARTITION</code> adds an existing table as a partition; it takes only a <code>SHARE UPDATE EXCLUSIVE</code> lock on the parent (v12+), but scans the table to validate the bounds unless an equivalent CHECK constraint exists. <code>DETACH PARTITION ... CONCURRENTLY</code> (v14+) removes a partition in two transactions without blocking queries on the parent, and cannot run inside a transaction block. This is the standard way to archive old months: detach, then dump or drop the standalone table.</p>`,
  tags: ['partitioning','operations'] },
{ q: `What is partition-wise join and partition-wise aggregate?`,
  a: `<p>If two tables are partitioned identically (same key, same bounds) and joined on the partition key, <code>enable_partitionwise_join</code> lets the planner join matching partitions pairwise — smaller hash tables and better parallelism. <code>enable_partitionwise_aggregate</code> pushes GROUP BY down to each partition when grouping includes the partition key (or does partial aggregation otherwise). Both are <strong>off</strong> by default because they increase planning time and memory; enable them for analytical workloads on co-partitioned tables.</p>`,
  tags: ['partitioning','planner'] },
{ q: `How many partitions is too many?`,
  a: `<p>There is no hard limit, but costs grow with partition count: planning time (when pruning cannot happen early), locks taken on each partition at execution, relcache memory per backend, and file handles. Modern versions handle thousands of partitions acceptably when queries prune to a few, but hundreds of thousands cause trouble. Rule of thumb: size partitions so each holds a meaningful amount of data (gigabytes, not kilobytes), keep the count in the hundreds to low thousands, and make sure your hot queries prune.</p>`,
  tags: ['partitioning','performance'] },
{ q: `Explain function volatility: IMMUTABLE, STABLE, VOLATILE. Why does it matter?`,
  a: `<p><strong>VOLATILE</strong> (default) may return different results on every call or have side effects (<code>random()</code>, <code>clock_timestamp()</code>, anything that writes); it is re-evaluated for every row and blocks many optimizations. <strong>STABLE</strong> returns the same result for the same arguments within one statement and does not modify the database (<code>now()</code>, lookups in tables) — usable in index scan conditions. <strong>IMMUTABLE</strong> always returns the same result for the same arguments forever (<code>lower()</code>, arithmetic) — required for expression indexes and can be constant-folded at plan time. Mislabeling a function as IMMUTABLE when it is not (e.g. it depends on a table or the time zone) leads to wrong results and corrupted expression indexes.</p>`,
  tags: ['functions'] },
{ q: `SQL-language functions vs PL/pgSQL functions — what are the performance differences?`,
  a: `<p>A simple <code>LANGUAGE sql</code> function (single SELECT, not SECURITY DEFINER, appropriate volatility) can be <strong>inlined</strong> into the calling query, so the planner sees through it, pushes predicates and uses indexes as if you wrote the expression yourself. Set-returning SQL functions marked STABLE/IMMUTABLE can be inlined into FROM as well. PL/pgSQL functions are opaque black boxes to the planner (estimated at a fixed cost and, if set-returning, 1000 rows by default — adjust with <code>COST</code>/<code>ROWS</code>), but offer variables, loops, branches and exception handling. Use SQL functions for thin reusable expressions; PL/pgSQL for procedural logic.</p>`,
  tags: ['functions','performance'] },
{ q: `What is the difference between a function and a procedure in PostgreSQL?`,
  a: `<p>Procedures (v11+) are invoked with <code>CALL</code> and, when not called inside an outer transaction block, can execute <code>COMMIT</code> and <code>ROLLBACK</code> internally — ideal for batch jobs that process millions of rows in committed chunks. Functions are called inside queries, always run within the caller's transaction and cannot control it, and return a value (or a set). Procedures can return values only through <code>OUT</code>/<code>INOUT</code> parameters.</p>`,
  tags: ['functions','procedures'] },
{ q: `What are the risks of SECURITY DEFINER functions and how do you write them safely?`,
  a: `<p>A <code>SECURITY DEFINER</code> function runs with the privileges of its <strong>owner</strong>, like setuid. If it resolves names through the caller-controlled <code>search_path</code>, an attacker can create a malicious function or operator in a schema earlier in the path and hijack it. Safe pattern:</p><pre>CREATE FUNCTION app.reset_login(p_user int) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS 'UPDATE public.users SET last_login = NULL WHERE id = p_user';
REVOKE EXECUTE ON FUNCTION app.reset_login(int) FROM PUBLIC;</pre><p>Schema-qualify every object, pin <code>search_path</code> (with <code>pg_temp</code> last), revoke the default PUBLIC execute privilege, grant only to the intended roles, and keep the function's logic minimal.</p>`,
  tags: ['functions','security'] },
{ q: `BEFORE vs AFTER triggers, and ROW vs STATEMENT triggers — when do you use each?`,
  a: `<p><strong>BEFORE ROW</strong> triggers run before the row is written and can modify <code>NEW</code> or skip the row by returning NULL — use them for normalization and derived values (e.g. setting <code>updated_at</code>). <strong>AFTER ROW</strong> triggers run after the change and see the final row — use them for audit logging, maintaining other tables, or notifications; their return value is ignored. <strong>STATEMENT</strong> triggers fire once per statement regardless of row count — combined with transition tables they are much cheaper for bulk operations. <strong>INSTEAD OF</strong> triggers apply to views.</p>`,
  tags: ['triggers'] },
{ q: `Write an audit trigger that records changes into audit_logs.`,
  a: `<pre>CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by, changed_at)
  VALUES (TG_TABLE_NAME, TG_OP,
          COALESCE(NEW.id, OLD.id),
          CASE WHEN TG_OP &lt;&gt; 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP &lt;&gt; 'DELETE' THEN to_jsonb(NEW) END,
          current_user, now());
  RETURN NULL;  -- ignored for AFTER triggers
END $$;

CREATE TRIGGER employees_audit
AFTER INSERT OR UPDATE OR DELETE ON employees
FOR EACH ROW EXECUTE FUNCTION audit_row();</pre><p>For updates, add <code>WHEN (OLD.* IS DISTINCT FROM NEW.*)</code> to skip no-op updates. For high-volume tables, a statement-level trigger with transition tables writes the audit rows in one INSERT.</p>`,
  tags: ['triggers','query-writing'] },
{ q: `What are transition tables in triggers?`,
  a: `<p>AFTER statement-level (and row-level) triggers can declare <code>REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows</code>. Inside the trigger function these act as read-only relations containing all rows affected by the statement. That lets you process a 100,000-row UPDATE with one set-based query (e.g. one <code>INSERT INTO audit_logs SELECT ... FROM new_rows</code>) instead of 100,000 trigger invocations — typically an order of magnitude faster.</p>`,
  tags: ['triggers','performance'] },
{ q: `How do you avoid infinite trigger recursion and unnecessary trigger firing?`,
  a: `<p>Use a <code>WHEN</code> condition on the trigger (<code>WHEN (OLD.status IS DISTINCT FROM NEW.status)</code>) so the function is not even called when irrelevant — it is evaluated cheaply before the call. Use <code>UPDATE OF column</code> to fire only when specific columns are targeted. For triggers that update their own table, guard with <code>pg_trigger_depth() &lt; 2</code> or design so the trigger's own update does not satisfy the WHEN clause. Prefer modifying <code>NEW</code> in a BEFORE trigger over issuing a second UPDATE on the same row.</p>`,
  tags: ['triggers'] },
{ q: `What are the downsides of heavy trigger use?`,
  a: `<p>Triggers add hidden per-row work to every write, which makes bulk loads and migrations slow and performance hard to reason about. Logic is invisible to developers reading application code, ordering among multiple triggers is alphabetical by name, and cascaded triggers can create surprising lock patterns and deadlocks. <code>TRUNCATE</code> bypasses row-level DELETE triggers. Use triggers for invariants that must hold regardless of client (audit, derived columns, denormalized counters), and keep business workflows in the application or explicit procedures.</p>`,
  tags: ['triggers','design'] },
{ q: `What is the cost of an EXCEPTION block in PL/pgSQL?`,
  a: `<p>Entering a <code>BEGIN ... EXCEPTION ... END</code> block starts a <strong>subtransaction</strong> (an internal savepoint) so it can roll back on error. This consumes a subtransaction XID if the block writes, adds overhead on every iteration, and with more than 64 subtransactions active in one top-level transaction the per-backend cache overflows, forcing other sessions to consult <code>pg_subtrans</code> for visibility checks — a known cause of cluster-wide slowdowns on busy systems. Avoid exception blocks inside tight loops; check conditions explicitly or use <code>INSERT ... ON CONFLICT</code> instead of catching unique violations.</p>`,
  tags: ['functions','performance','transactions'] },
{ q: `How do you write a set-returning function, and how does RETURNS TABLE differ from RETURNS SETOF?`,
  a: `<pre>CREATE FUNCTION top_customers(p_country text, p_limit int)
RETURNS TABLE (customer_id int, name text, total numeric)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.name, sum(o.total_amount)
  FROM customers c JOIN orders o ON o.customer_id = c.id
  WHERE c.country = p_country
  GROUP BY c.id, c.name
  ORDER BY 3 DESC LIMIT p_limit
$$;
SELECT * FROM top_customers('India', 5);</pre><p><code>RETURNS TABLE (...)</code> declares the output columns inline; <code>RETURNS SETOF some_type</code> returns rows of an existing table or composite type. In PL/pgSQL, emit rows with <code>RETURN QUERY</code> or <code>RETURN NEXT</code>. Beware: in PL/pgSQL, RETURNS TABLE column names become variables that can clash with column names in queries.</p>`,
  tags: ['functions','query-writing'] },
{ q: `How do you run dynamic SQL safely in PL/pgSQL?`,
  a: `<p>Use <code>EXECUTE</code> with <code>format()</code> for identifiers and <code>USING</code> for values:</p><pre>EXECUTE format('SELECT count(*) FROM %I.%I WHERE created_at &gt;= $1', p_schema, p_table)
INTO v_count
USING p_since;</pre><p><code>%I</code> quotes identifiers, <code>%L</code> quotes literals, and <code>USING</code> passes values as real parameters with no injection risk and correct typing. Never concatenate untrusted input. Dynamic statements are planned on every execution, which is sometimes desirable (custom plans for skewed data).</p>`,
  tags: ['functions','security'] },
{ q: `What are event triggers?`,
  a: `<p>Event triggers fire on database-level events rather than table DML: <code>ddl_command_start</code>, <code>ddl_command_end</code>, <code>sql_drop</code>, <code>table_rewrite</code>, and (PostgreSQL 17+) <code>login</code>. Uses: auditing schema changes (with <code>pg_event_trigger_ddl_commands()</code>), blocking dangerous DDL (e.g. table rewrites during business hours), or enforcing naming conventions. They require superuser to create, and a buggy login event trigger can lock everyone out (recover by starting with <code>event_triggers = off</code>).</p>`,
  tags: ['triggers','operations'] },
{ q: `What are constraint triggers?`,
  a: `<p><code>CREATE CONSTRAINT TRIGGER</code> creates an AFTER ROW trigger that can be <code>DEFERRABLE INITIALLY DEFERRED</code>, so it runs at commit time instead of after each statement. This lets you enforce cross-row or cross-table rules (e.g. "an order must have at least one item") that are only true once the whole transaction finished. Like other trigger-based checks, they are subject to race conditions between concurrent transactions unless combined with appropriate locking or Serializable isolation.</p>`,
  tags: ['triggers','constraints'] },
{ q: `What do PARALLEL SAFE and LEAKPROOF mean on a function?`,
  a: `<p><code>PARALLEL SAFE</code> declares the function can run in parallel workers; <code>PARALLEL RESTRICTED</code> means only in the leader; <code>PARALLEL UNSAFE</code> (the default for user functions) disables parallel query for the whole statement. Forgetting to mark a function used in big reports as SAFE silently kills parallelism. <code>LEAKPROOF</code> (superuser only) asserts the function reveals nothing about its arguments except via its return value, allowing the planner to push it below security barrier views and RLS policies.</p>`,
  tags: ['functions','performance','security'] },
{ q: `Explain the main jsonb operators.`,
  a: `<ul><li><code>-&gt;</code> returns jsonb by key or index; <code>-&gt;&gt;</code> returns text: <code>attributes-&gt;&gt;'brand'</code>.</li><li><code>#&gt;</code> / <code>#&gt;&gt;</code> extract by path: <code>attributes #&gt;&gt; '{specs,weight_kg}'</code>.</li><li><code>@&gt;</code> containment: <code>attributes @&gt; '{"color":"black"}'</code> (GIN-indexable).</li><li><code>?</code>, <code>?|</code>, <code>?&amp;</code> key existence.</li><li><code>||</code> concatenate/merge, <code>-</code> delete key, <code>#-</code> delete path.</li><li><code>@?</code> and <code>@@</code> jsonpath existence/predicate.</li></ul><p>Subscripting (<code>attributes['brand']</code>, v14+) works for reads and updates.</p>`,
  tags: ['jsonb'] },
{ q: `How do you update a value inside a jsonb document, and what does it cost?`,
  a: `<pre>UPDATE products
SET attributes = jsonb_set(attributes, '{specs,weight_kg}', '1.2'::jsonb)
WHERE sku = 'SKU-1001';
UPDATE products SET attributes = attributes || '{"color":"red"}' WHERE id = 1;</pre><p>Whatever the syntax, PostgreSQL writes a <strong>complete new row version</strong> containing the whole new document — there is no in-place partial update. For large documents stored in TOAST, each small change rewrites all toasted chunks and generates a lot of WAL. If one field changes frequently (counters, status), move it to a regular column.</p>`,
  tags: ['jsonb','mvcc','performance'] },
{ q: `What is SQL/JSON path (jsonpath) and how is it used?`,
  a: `<p>jsonpath is a query language for JSON (SQL:2016), e.g. <code>'$.specs.weight_kg ? (@ &gt; 5)'</code>. Functions <code>jsonb_path_query</code>, <code>jsonb_path_exists</code>, <code>jsonb_path_match</code> evaluate it, and operators <code>@?</code> (exists) and <code>@@</code> (predicate) can use a GIN index:</p><pre>SELECT name FROM products
WHERE attributes @? '$.specs.weight_kg ? (@ &gt; 5)';</pre><p>It supports filters, arithmetic, <code>like_regex</code>, and lax/strict modes for handling missing keys or arrays.</p>`,
  tags: ['jsonb'] },
{ q: `What SQL/JSON standard features arrived in PostgreSQL 16 and 17?`,
  a: `<p>PostgreSQL 16 added the <code>IS JSON</code> predicate and constructors <code>JSON_OBJECT</code>, <code>JSON_ARRAY</code>, <code>JSON_OBJECTAGG</code>, <code>JSON_ARRAYAGG</code>. PostgreSQL 17 added the query functions <code>JSON_EXISTS</code>, <code>JSON_QUERY</code>, <code>JSON_VALUE</code> (with <code>RETURNING</code> types and <code>ON ERROR</code>/<code>ON EMPTY</code> handling) and <code>JSON_TABLE</code>, which turns JSON into a relational row set:</p><pre>SELECT jt.* FROM products p,
  JSON_TABLE(p.attributes, '$' COLUMNS (
    brand text PATH '$.brand',
    weight numeric PATH '$.specs.weight_kg')) AS jt;</pre>`,
  tags: ['jsonb','sql'] },
{ q: `When should data go into jsonb vs proper columns?`,
  a: `<p>Use real columns for attributes that every row has, that you filter, join, aggregate or constrain on, or that change frequently — you get types, constraints, foreign keys, accurate statistics and compact storage. Use <code>jsonb</code> for sparse or variable attributes (product specs differing by category), payloads stored as received (webhooks, API responses), and rarely queried metadata. Common hybrid: core columns + one <code>jsonb</code> column for the long tail, promoting a key to a column once it becomes hot. The planner has no per-key statistics for jsonb, so filters on keys are often misestimated.</p>`,
  tags: ['jsonb','design'] },
{ q: `How do you index a single frequently queried jsonb key?`,
  a: `<pre>CREATE INDEX idx_products_brand ON products ((attributes-&gt;&gt;'brand'));
SELECT * FROM products WHERE attributes-&gt;&gt;'brand' = 'Sony';</pre><p>A B-tree expression index is far smaller than a GIN index on the whole document, supports ranges and sorting, and ANALYZE collects statistics on the expression, fixing row estimates. Cast for numeric comparisons: <code>((attributes #&gt;&gt; '{specs,weight_kg}')::numeric)</code>. The query must use exactly the same expression.</p>`,
  tags: ['jsonb','indexes'] },
{ q: `What is TOAST and how does it affect large jsonb or text values?`,
  a: `<p>TOAST (The Oversized-Attribute Storage Technique) handles values that would make a row exceed roughly 2KB: they are compressed (pglz, or lz4 via <code>default_toast_compression</code>/column setting) and, if still large, split into chunks stored in a separate TOAST table. Rows that do not reference the column never touch it, but reading a toasted value means extra lookups and decompression, and updating any part of it writes the whole value again. Selecting <code>*</code> on wide tables pulls large toasted values unnecessarily — select only needed columns.</p>`,
  tags: ['jsonb','storage','internals'] },
{ q: `How do you build a nested JSON API response directly in SQL?`,
  a: `<pre>SELECT jsonb_build_object(
  'id', c.id, 'name', c.name,
  'orders', COALESCE((
     SELECT jsonb_agg(jsonb_build_object('id', o.id, 'total', o.total_amount)
                      ORDER BY o.order_date DESC)
     FROM orders o WHERE o.customer_id = c.id), '[]'::jsonb))
FROM customers c WHERE c.id = 42;</pre><p><code>jsonb_build_object</code> and <code>jsonb_agg</code> assemble the document server-side in one round trip, avoiding N+1 queries. <code>COALESCE</code> turns "no orders" into an empty array instead of NULL. Use <code>jsonb_to_recordset</code>/<code>jsonb_populate_recordset</code> for the reverse direction.</p>`,
  tags: ['jsonb','query-writing'] },
{ q: `How can you enforce structure on a jsonb column?`,
  a: `<p>Core PostgreSQL has no JSON Schema validator, but CHECK constraints go a long way:</p><pre>ALTER TABLE products ADD CONSTRAINT attrs_shape CHECK (
  jsonb_typeof(attributes) = 'object'
  AND attributes ? 'brand'
  AND jsonb_typeof(attributes-&gt;'warranty_months') IN ('number','null'));</pre><p>For complex rules, use jsonpath predicates in the CHECK (<code>attributes @@ '$.warranty_months &gt;= 0'</code>) or a third-party extension such as <code>pg_jsonschema</code> <span class="tag ext">extension</span>. Validate at the edge too, but the database constraint is the last line of defense.</p>`,
  tags: ['jsonb','constraints'] },
{ q: `Explain tsvector and tsquery.`,
  a: `<p>A <code>tsvector</code> is a sorted list of normalized lexemes with positions (and optional weights): <code>to_tsvector('english', 'The indexes are running')</code> gives <code>'index':2 'run':4</code> — stop words removed, words stemmed. A <code>tsquery</code> is a boolean search expression of lexemes with <code>&amp;</code>, <code>|</code>, <code>!</code>, and <code>&lt;-&gt;</code> (followed-by). Matching uses <code>@@</code>: <code>search @@ to_tsquery('english', 'index &amp; vacuum')</code>. Both sides must use the same text search configuration or stemming will not match.</p>`,
  tags: ['fts'] },
{ q: `to_tsquery vs plainto_tsquery vs phraseto_tsquery vs websearch_to_tsquery?`,
  a: `<p><code>to_tsquery</code> requires valid tsquery syntax and errors on raw user input like <code>"foo bar"</code>. <code>plainto_tsquery</code> ANDs all words. <code>phraseto_tsquery</code> joins words with <code>&lt;-&gt;</code> for phrase matching. <code>websearch_to_tsquery</code> (v11+) understands search-engine syntax — quoted phrases, <code>or</code>, and <code>-exclude</code> — and never raises syntax errors, making it the right choice for search boxes.</p>`,
  tags: ['fts'] },
{ q: `How does ranking work in PostgreSQL full-text search?`,
  a: `<p><code>ts_rank(vector, query)</code> scores by lexeme frequency; <code>ts_rank_cd</code> uses cover density (how close matching terms are), requiring positional information. Weights A–D, assigned with <code>setweight</code>, let a title match outrank a body match — company_db's <code>documents.search</code> uses weight A for title and B for body. Normalization flags adjust for document length. Ranking must compute a score for every matching row, so it is the expensive part; filter with the GIN-indexed <code>@@</code> first and limit the candidate set before ranking.</p>`,
  tags: ['fts'] },
{ q: `How should you index full-text search, and GIN vs GiST for tsvector?`,
  a: `<p>Best practice is a stored <code>tsvector</code> generated column with a GIN index — the vector is computed once on write, and queries simply use <code>search @@ query</code>. An expression index on <code>to_tsvector('english', body)</code> also works, but the query must repeat the identical expression and ranking recomputes the vector. GIN is the standard choice: fast, exact lookups but slower updates. GiST is lossy (rows must be rechecked), smaller and faster to update, occasionally used for very write-heavy data.</p>`,
  tags: ['fts','indexes'] },
{ q: `What are text search configurations and dictionaries?`,
  a: `<p>A configuration (<code>english</code>, <code>simple</code>, <code>german</code>...) maps token types from the parser to a chain of dictionaries: stop-word lists, Snowball stemmers, synonym and thesaurus dictionaries, Ispell. <code>simple</code> only lowercases — useful for codes, names or languages without a stemmer. Accent-insensitive search needs the <code>unaccent</code> <span class="tag ext">extension</span> added to a custom configuration. Set the default with <code>default_text_search_config</code>, but always pass the configuration explicitly in indexed expressions so the expression is immutable.</p>`,
  tags: ['fts'] },
{ q: `Why is ts_headline slow, and how do you use it efficiently?`,
  a: `<p><code>ts_headline</code> re-parses the original document text (not the tsvector) to produce highlighted snippets, which is CPU-heavy for long documents. Never apply it to all matches: find and rank the top N in a subquery first, then compute headlines only for those rows:</p><pre>SELECT id, title, ts_headline('english', body, q) AS snippet
FROM (SELECT id, title, body, q, ts_rank(search, q) AS r
      FROM documents, websearch_to_tsquery('english', 'index vacuum') q
      WHERE search @@ q ORDER BY r DESC LIMIT 10) t
ORDER BY r DESC;</pre>`,
  tags: ['fts','performance'] },
{ q: `Full-text search vs pg_trgm vs an external search engine — how do you choose?`,
  a: `<p><strong>FTS</strong> (core) is linguistic: stemming, stop words, ranking — best for documents and natural-language queries. <strong>pg_trgm</strong> <span class="tag ext">extension</span> matches character trigrams — ideal for fuzzy name/SKU lookup, typos, and <code>ILIKE '%x%'</code> with a GIN index, but has no linguistics. An <strong>external engine</strong> such as Elasticsearch/OpenSearch <span class="tag tool">third-party tool</span> adds relevance tuning, facets, multi-language analyzers and horizontal scale, at the cost of a second system to sync. Many products get far with FTS + pg_trgm inside PostgreSQL, keeping data transactional and consistent.</p>`,
  tags: ['fts','design'] },
{ q: `How does phrase and proximity search work in PostgreSQL FTS?`,
  a: `<p>The <code>&lt;-&gt;</code> operator means "immediately followed by", and <code>&lt;N&gt;</code> means "followed at distance N": <code>to_tsquery('english', 'connection &lt;-&gt; pool')</code> matches "connection pooling" but not "pool of connections". It relies on positions stored in the tsvector, so it cannot work on vectors stripped with <code>strip()</code>. The GIN index finds candidates containing all lexemes; positions are then rechecked on the heap row, so very common lexemes make phrase queries slower.</p>`,
  tags: ['fts'] },
{ q: `How do you handle multilingual content in full-text search?`,
  a: `<p>Store the language per row as a <code>regconfig</code> column and use it when building the vector: <code>to_tsvector(lang, title || ' ' || body)</code>. Because the two-argument form with a column is immutable, it can be used in a stored generated column or expression index. At query time, build the tsquery with the user's language (or search several configurations with OR). For languages without stemmers (e.g. many Indic languages in core) fall back to <code>simple</code> plus pg_trgm.</p>`,
  tags: ['fts'] },
{ q: `What is the WAL, and what happens at a checkpoint?`,
  a: `<p>The Write-Ahead Log records every change before the data pages are written. COMMIT only needs the WAL flushed, so random writes to table files can be delayed and batched — the key to both durability and performance. A <strong>checkpoint</strong> flushes all dirty pages to the data files and records a redo point; crash recovery replays WAL from the last checkpoint. After each checkpoint the first change to a page writes a <strong>full page image</strong> (<code>full_page_writes</code>) to protect against torn pages, so very frequent checkpoints inflate WAL. Tune <code>max_wal_size</code> and <code>checkpoint_timeout</code> so checkpoints are driven by time, and spread I/O with <code>checkpoint_completion_target</code> (0.9).</p>`,
  tags: ['wal','internals'] },
{ q: `What is fillfactor and when would you change it?`,
  a: `<p><code>fillfactor</code> is the percentage of each page filled on insert (heap default 100, B-tree 90). Leaving free space on heap pages (e.g. <code>ALTER TABLE orders SET (fillfactor = 85)</code>) lets updates place the new version on the same page, enabling HOT updates and reducing index writes and bloat. Use it for frequently updated tables; leave it at 100 for append-only or read-mostly tables, where it would only waste space. It applies to newly written pages; rewrite the table to apply it to existing data.</p>`,
  tags: ['storage','performance'] },
{ q: `How do you find the queries that are worth optimizing?`,
  a: `<p>Enable <code>pg_stat_statements</code> <span class="tag ext">extension</span> (via <code>shared_preload_libraries</code>) and sort normalized statements by total time, not mean:</p><pre>SELECT queryid, calls, round(total_exec_time) AS total_ms,
       round(mean_exec_time, 2) AS mean_ms, rows,
       shared_blks_hit, shared_blks_read, left(query, 80)
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;</pre><p>A 2 ms query run 5 million times a day usually matters more than a 10 s monthly report. Then capture real plans with <code>auto_explain</code> or EXPLAIN on representative parameters, and reset stats (<code>pg_stat_statements_reset()</code>) after deploying fixes to measure the effect.</p>`,
  tags: ['performance','monitoring'] },
{ q: `What is auto_explain and how do you use it safely in production?`,
  a: `<p><code>auto_explain</code> is a contrib module shipped with PostgreSQL that logs the execution plan of statements slower than <code>auto_explain.log_min_duration</code>. It captures the plan that actually ran with real parameters — invaluable for intermittent slowness. Set <code>log_analyze = on</code> for actual row counts, but beware it adds timing overhead to every statement (mitigate with <code>log_timing = off</code> and <code>auto_explain.sample_rate</code>). Load it via <code>session_preload_libraries</code> or <code>shared_preload_libraries</code>.</p>`,
  tags: ['explain','monitoring'] },
{ q: `What is the Memoize node in a query plan?`,
  a: `<p>Memoize (v14+) sits between a Nested Loop and its inner side and caches inner results keyed by the outer parameter values. When the outer side has many repeated join keys (e.g. 12,500 order items referencing only 100 products), repeated lookups are served from the cache instead of re-scanning the index. Its effectiveness depends on the planner's estimate of distinct keys; if the estimate is badly wrong it can evict constantly. It is controlled by <code>enable_memoize</code> and memory bounded by <code>work_mem × hash_mem_multiplier</code>.</p>`,
  tags: ['explain','planner'] },
{ q: `What does CLUSTER do, and why is its benefit temporary?`,
  a: `<p><code>CLUSTER orders USING idx_orders_date</code> rewrites the table in index order, so range scans on that index read consecutive pages and BRIN indexes become effective. It takes an <code>ACCESS EXCLUSIVE</code> lock for the whole rewrite and the order is <strong>not maintained</strong> — new rows and updates go wherever there is space, so correlation decays over time. For online reorganization, use <code>pg_repack</code> <span class="tag ext">extension</span>; for naturally ordered data, simply append in order and use partitioning.</p>`,
  tags: ['storage','indexes'] },
{ q: `Two single-column indexes vs one composite index — what does the planner do with each?`,
  a: `<p>With separate indexes on <code>customer_id</code> and <code>status</code>, the planner can combine them with <strong>BitmapAnd</strong>: build two bitmaps and intersect them before visiting the heap. It is flexible (serves either column alone) but each bitmap scan has overhead and cannot provide ordering. A composite <code>(customer_id, status)</code> index locates the exact rows in one descent, supports ORDER BY on trailing columns and index-only scans. For a hot, specific query pattern, the composite index wins; for ad-hoc filtering on many columns, single-column indexes combined via bitmaps are a reasonable compromise.</p>`,
  tags: ['indexes','planner'] },
{ q: `Should you index a low-cardinality column like a boolean or status?`,
  a: `<p>A plain index on a column with a few evenly distributed values is rarely used — each value matches a large fraction of the table, so a seq scan is cheaper. The exception is <strong>skew</strong>: if 0.1% of orders are <code>pending</code> and that is what queries look for, a <strong>partial index</strong> <code>CREATE INDEX ON orders (order_date) WHERE status = 'pending';</code> is tiny and very effective. Include the low-cardinality column as a later column of a composite index if it refines a selective leading column.</p>`,
  tags: ['indexes','indexing-strategy'] },
{ q: `What is Row-Level Security (RLS) and what are its pitfalls?`,
  a: `<p>RLS adds per-row filters to a table through policies:</p><pre>ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id')::int);</pre><p><code>USING</code> filters reads/updates/deletes, <code>WITH CHECK</code> validates new rows. Pitfalls: the table owner and superusers bypass RLS unless you <code>FORCE ROW LEVEL SECURITY</code> (superusers and <code>BYPASSRLS</code> roles always bypass); policies that call non-leakproof functions or lack an index on <code>tenant_id</code> can hurt performance; with connection poolers, the tenant setting must be set per transaction (<code>SET LOCAL</code>) to avoid leaking across clients.</p>`,
  tags: ['security','rls'] },
{ q: `What are prepared transactions (two-phase commit) and why are they dangerous?`,
  a: `<p><code>PREPARE TRANSACTION 'id'</code> persists a transaction's state so that a later <code>COMMIT PREPARED</code> or <code>ROLLBACK PREPARED</code> — even from another session or after a restart — finishes it; transaction managers use this for distributed atomic commits. The danger: an orphaned prepared transaction keeps its locks and holds back the xmin horizon indefinitely, causing bloat and eventually wraparound risk. They are disabled by default (<code>max_prepared_transactions = 0</code>); if enabled, monitor <code>pg_prepared_xacts</code> and alert on old entries.</p>`,
  tags: ['transactions','operations'] },
{ q: `Does PostgreSQL escalate row locks to table locks? What is max_locks_per_transaction?`,
  a: `<p>No. Row locks are stored in the tuple header (<code>xmax</code>/MultiXact), so locking millions of rows needs no shared memory and never escalates. Heavyweight locks on <strong>relations</strong> (tables, indexes, partitions) live in a shared lock table sized by <code>max_locks_per_transaction × (max_connections + max_prepared_transactions)</code>. Queries touching thousands of partitions, or pg_dump of many tables, can exhaust it with "out of shared memory — you might need to increase max_locks_per_transaction". The first few relation locks per backend use a faster path; PostgreSQL 18 scales the number of fast-path slots with <code>max_locks_per_transaction</code>.</p>`,
  tags: ['locking','internals'] },
{ q: `What does SELECT ... FOR UPDATE lock in a multi-table join, and how do you restrict it?`,
  a: `<p>Without qualification, <code>FOR UPDATE</code> locks the matching rows of <strong>every</strong> table in the FROM clause, which can block unrelated writers on lookup tables and cause deadlocks. Restrict it with <code>OF</code>:</p><pre>SELECT o.id, c.name
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'pending'
FOR UPDATE OF o SKIP LOCKED;</pre><p>Locking clauses are not allowed with aggregates, <code>DISTINCT</code>, <code>GROUP BY</code> or set operations, and on the nullable side of an outer join.</p>`,
  tags: ['locking'] },
{ q: `How do you run a consistent multi-query report, or share a snapshot between sessions?`,
  a: `<p>Run the report in one transaction at <code>REPEATABLE READ</code> (ideally <code>READ ONLY</code>): every query sees the same snapshot, so totals across queries reconcile. To parallelize across connections, one session calls <code>pg_export_snapshot()</code> and others run <code>SET TRANSACTION SNAPSHOT 'id'</code> at the start of their Repeatable Read transactions — exactly how parallel <code>pg_dump</code> obtains a consistent dump. Remember that a long report transaction holds back VACUUM; run heavy reports on a replica where possible.</p>`,
  tags: ['isolation','transactions'] },
{ q: `UUIDv4 vs UUIDv7 as primary keys — what is the index impact?`,
  a: `<p>Random UUIDv4 values land on random B-tree leaf pages, so at scale every insert touches a different page: poor cache locality, many page splits, more WAL (full-page images) and bigger indexes. UUIDv7 is time-ordered (a millisecond timestamp prefix), so inserts append to the right edge of the index like a bigint sequence while remaining globally unique. PostgreSQL 18 provides <code>uuidv7()</code> natively (and <code>uuidv4()</code> as an alias of <code>gen_random_uuid()</code>). Note UUIDv7 leaks creation time; use <code>bigint</code> identity if global uniqueness is not required — it is half the size.</p>`,
  tags: ['indexes','design'] },
{ q: `When might you use a hash index instead of a B-tree?`,
  a: `<p>Hash indexes (crash-safe and WAL-logged since v10) support only equality. They store a 4-byte hash per entry, so for long keys (URLs, long tokens) they can be considerably smaller than a B-tree that stores the full key, and lookups can be slightly faster. Limitations: no range queries, no sorting, no uniqueness enforcement, no multi-column indexes, no index-only scans. In practice B-tree remains the default; consider hash only for equality lookups on wide values after measuring.</p>`,
  tags: ['indexes'] },
{ q: `Why can an OR across different columns be slow, and how do you rewrite it?`,
  a: `<p><code>WHERE customer_id = 42 OR email = 'a@b.com'</code> cannot be satisfied by a single B-tree descent. The planner may combine two indexes via BitmapOr, but if one side lacks an index it falls back to a sequential scan. Rewriting as a <code>UNION</code> of two indexable queries guarantees index use on each branch:</p><pre>SELECT * FROM orders WHERE customer_id = 42
UNION
SELECT o.* FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE c.email = 'a@b.com';</pre><p><code>UNION</code> (not ALL) removes rows matched by both branches. Also note that an <code>OR</code> in a JOIN condition often prevents hash and merge joins entirely.</p>`,
  tags: ['performance','query-writing'] },
{ q: `What is JIT compilation in PostgreSQL and when can it hurt?`,
  a: `<p>When built with LLVM, PostgreSQL can JIT-compile expressions and tuple deforming for queries whose estimated cost exceeds <code>jit_above_cost</code> (100,000), with further optimization and inlining at higher thresholds. It helps long-running analytical queries that evaluate expressions over millions of rows. It hurts short OLTP queries whose cost is <em>overestimated</em>: compilation can add tens or hundreds of milliseconds — visible as a "JIT" section with large Generation/Optimization times in EXPLAIN ANALYZE. Many OLTP systems raise the thresholds or set <code>jit = off</code>.</p>`,
  tags: ['performance','planner'] },
{ q: `What is the fastest way to bulk-load data, and why?`,
  a: `<p><code>COPY ... FROM</code> streams rows in one command, avoiding per-statement parsing, planning and round trips — typically an order of magnitude faster than individual INSERTs (multi-row INSERTs in batches are a decent middle ground). For very large loads: load into a new or truncated table in the same transaction (with <code>wal_level = minimal</code> the WAL can be skipped), create indexes and foreign keys <em>after</em> loading, raise <code>maintenance_work_mem</code> for index builds, and run <code>ANALYZE</code> (and VACUUM to set visibility bits) at the end. PostgreSQL 17 added <code>ON_ERROR ignore</code> for COPY to skip malformed rows.</p>`,
  tags: ['performance','operations'] },
{ q: `How do you create an index on a large partitioned table without blocking writes?`,
  a: `<p><code>CREATE INDEX</code> on a partitioned parent cannot use <code>CONCURRENTLY</code>. The workaround:</p><pre>CREATE INDEX orders_cust_idx ON ONLY orders_p (customer_id);  -- invalid, parent only
CREATE INDEX CONCURRENTLY orders_2025_01_cust_idx ON orders_2025_01 (customer_id);
ALTER INDEX orders_cust_idx ATTACH PARTITION orders_2025_01_cust_idx;
-- repeat for each partition; the parent index becomes valid once all are attached</pre><p>Future partitions created afterwards get the index automatically.</p>`,
  tags: ['partitioning','indexes','operations'] },
{ q: `What is a DEFAULT partition and what is its hidden cost?`,
  a: `<p>A <code>DEFAULT</code> partition catches rows that do not fit any other partition, preventing insert errors when, say, next month's partition was not created in time. The hidden cost: when you later create or attach a partition, PostgreSQL must scan the default partition to verify it contains no rows belonging to the new range, holding locks during the scan — and fails if such rows exist, forcing you to move them first. Keep the default partition empty (alert if not) and pre-create future partitions, e.g. with <code>pg_partman</code> <span class="tag ext">extension</span> or a scheduled job.</p>`,
  tags: ['partitioning','operations'] },
{ q: `A query is fast in psql but slow when run from the application. What could explain it?`,
  a: `<p>Common causes:</p><ul><li><strong>Prepared statements / generic plans</strong>: the driver prepares the query, and after five executions PostgreSQL may switch to a generic plan that is bad for skewed values. Test with <code>PREPARE</code>/<code>EXECUTE</code> in psql or set <code>plan_cache_mode = force_custom_plan</code>.</li><li><strong>Different parameter values or types</strong>: the ORM binds a <code>varchar</code> or <code>numeric</code> where the column is <code>bigint</code>/<code>text</code>, causing casts that prevent index use.</li><li><strong>Different session settings</strong>: <code>work_mem</code>, <code>search_path</code>, <code>statement_timeout</code> per role.</li><li><strong>Locks or contention</strong> under real concurrency, or a long transaction held open by the app.</li><li><strong>Network and fetch size</strong>: fetching huge result sets or N+1 query patterns.</li></ul><p>Use <code>auto_explain</code> and <code>pg_stat_statements</code> to see what the application actually executed.</p>`,
  tags: ['performance','planner'] },
{ q: `How do LISTEN/NOTIFY work, and what are their limits?`,
  a: `<p>A session runs <code>LISTEN order_events</code>; any session can then <code>NOTIFY order_events, 'payload'</code> or call <code>pg_notify('order_events', payload)</code>, typically from an AFTER trigger. Notifications are <strong>transactional</strong>: they are delivered only when the sending transaction commits, and duplicates within one transaction are folded. Limits: payloads are capped at about 8000 bytes, delivery is not durable (listeners that are disconnected miss messages), the queue is shared and can fill if a listener stops consuming, NOTIFY takes a global lock at commit that can bottleneck very high write rates, and it does not work through transaction-mode poolers. Use it for cache invalidation and wake-up signals, with a table as the durable source of truth.</p>`,
  tags: ['triggers','architecture'] }
];
