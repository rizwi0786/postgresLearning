/* PostgreSQL Mastery - Section 03: Indexing & Query Performance
   Modules: indexes, advanced-indexing, query-optimization, explain, query-analysis
   All plan outputs below were captured from real PostgreSQL 18 (PGlite) running company_db.
   Timings (actual time=...) will differ on every run; costs, row counts and plan shapes are stable. */

PGM.addLessons([
/* =====================================================================
   MODULE: indexes
   ===================================================================== */
{
  id: 'indexes-what-is-an-index',
  module: 'indexes',
  title: 'What Is an Index? Seq Scan vs Index Scan',
  level: 2,
  minutes: 22,
  summary: 'Understand what an index physically is, why it turns a full-table read into a handful of page reads, and prove it with EXPLAIN on company_db.orders(customer_id).',
  objectives: [
    'Explain an index using the book-index analogy and map it to real PostgreSQL structures (heap, index, ctid)',
    'Read a Seq Scan and an Index/Bitmap Scan in EXPLAIN output and say why each was chosen',
    'Create an index on orders(customer_id) and measure the before/after difference in buffers and time',
    'Explain why PostgreSQL sometimes ignores an index even when one exists',
    'Weigh the cost of an index: disk space, write amplification and maintenance',
    'Detect foreign-key columns that have no supporting index'
  ],
  concept: `
<p><strong>The book analogy.</strong> Imagine a 900-page book on PostgreSQL and someone asks you to find every page that mentions <em>"VACUUM"</em>. Without an index you start at page 1 and read every page &mdash; that is a <strong>sequential scan</strong>. With the alphabetical index at the back, you jump to "V", read "VACUUM: 112, 340, 577", and open exactly three pages &mdash; that is an <strong>index scan</strong>. The index is a <em>separate, smaller, sorted structure</em> whose entries point back to locations in the main text.</p>
<p>PostgreSQL works the same way. A table is stored as a <strong>heap</strong>: an unordered pile of 8&nbsp;kB pages, rows placed wherever there is free space. Every row version has a physical address called a <code>ctid</code> = <code>(page number, slot on page)</code>, e.g. <code>(41,81)</code>. A <strong>B-tree index</strong> on <code>orders(customer_id)</code> is a separate file holding <em>sorted</em> pairs <code>(customer_id, ctid)</code>. To find <code>customer_id = 42</code> PostgreSQL descends the tree (2&ndash;4 page reads even for billions of rows), collects the ctids, and fetches only those heap pages.</p>
<p>In <code>company_db</code>, <code>orders</code> has 5,000 rows in 89 heap pages, and <code>orders.customer_id</code> is <strong>deliberately not indexed</strong>. A query for one customer's orders therefore reads all 89 pages and throws away 4,990 rows. After <code>CREATE INDEX</code> the same query touches about 10 pages. On 50 million rows the gap becomes "8 seconds vs 2 milliseconds".</p>
<ul>
  <li><strong>Seq Scan</strong> &ndash; read every heap page in physical order, test the WHERE clause on every row. Cheap per page (sequential I/O), but the cost grows linearly with table size.</li>
  <li><strong>Index Scan</strong> &ndash; walk the index, then jump to each heap page it points to (random I/O). Great when few rows match.</li>
  <li><strong>Bitmap Index Scan + Bitmap Heap Scan</strong> &ndash; collect all matching ctids from the index into an in-memory bitmap, sort them by page, then visit each heap page once. The planner's middle ground for "some dozens to thousands" of rows.</li>
  <li><strong>Index Only Scan</strong> &ndash; answer the query from the index alone, without visiting the heap (covered later in this module).</li>
</ul>
<p>An index is never "free": every <code>INSERT</code>, every non-HOT <code>UPDATE</code> and every <code>DELETE</code>-cleanup must also maintain each index, and each index takes disk and cache space. The skill you are learning is choosing the <em>few</em> indexes that serve the most important queries.</p>
<div class="callout info"><strong>Core feature.</strong> <span class="tag core">core</span> <code>CREATE INDEX</code> is core PostgreSQL. Index syntax is <em>not</em> part of the SQL standard at all &mdash; every database has its own.</div>`,
  why: `
<p>Without indexes, the cost of finding rows is proportional to the <em>table size</em>, not to the <em>result size</em>. That is fine for a 100-row lookup table and catastrophic for an orders table that grows by a million rows a month: the same "show my orders" page gets slower every day, burns CPU on every core, evicts useful pages from <code>shared_buffers</code> and eventually times out.</p>
<p>Indexes change the complexity from O(N) to roughly O(log N + matches). They also enforce uniqueness (primary keys, unique constraints), support fast <code>ORDER BY ... LIMIT</code>, speed up joins on foreign keys, and make <code>DELETE</code> on parent tables fast (the FK check on the child needs an index on the child's FK column).</p>`,
  useCase: `
<p><strong>E-commerce "My Orders" page.</strong> A marketplace with 40 million orders serves 1,200 requests/second for <code>SELECT ... FROM orders WHERE customer_id = $1 ORDER BY order_date DESC LIMIT 20</code>. Without an index every request scans ~5 GB of heap: impossible. With a B-tree on <code>(customer_id, order_date)</code> each request reads 3&ndash;5 index pages + up to 20 heap pages (~0.2 ms when cached). The index costs ~1.2 GB of disk and slows inserts by a few percent &mdash; an obvious win.</p>
<p><strong>The FK trap.</strong> The same company runs a nightly job deleting test customers. <code>orders.customer_id REFERENCES customers</code> means each deleted customer triggers a lookup in <code>orders</code>; with no index that is a full scan of 40M rows <em>per deleted customer</em>. Adding the index turned a 6-hour job into 40 seconds.</p>`,
  internals: `
<p><strong>Heap and index are separate files.</strong> <code>SELECT pg_relation_filepath('orders')</code> and <code>pg_relation_filepath('orders_pkey')</code> return different files. Index entries hold the key value(s) plus a 6-byte <code>ctid</code>. They do <em>not</em> store visibility information (xmin/xmax), so for an ordinary Index Scan PostgreSQL must still visit the heap to check MVCC visibility &mdash; unless the visibility map says the page is all-visible (Index Only Scan).</p>
<p><strong>How the planner decides.</strong> It estimates how many rows match (from <code>pg_stats</code>), converts that into page fetches and CPU work using cost constants (<code>seq_page_cost=1</code>, <code>random_page_cost=4</code>, <code>cpu_tuple_cost=0.01</code>, &hellip;) and picks the cheapest plan. Our seq scan cost of <code>151.50</code> is literally <code>89 pages &times; 1.0 + 5000 rows &times; 0.01 + 5000 &times; 0.0025</code> (the last term is evaluating the filter). If a predicate matches a large fraction of the table (e.g. <code>customer_id &gt; 10</code> matches 98%), random heap access via the index would be more expensive than reading everything sequentially, so the planner correctly ignores the index.</p>
<p><strong>Building an index</strong> sorts all keys (using <code>maintenance_work_mem</code>) and writes the tree bottom-up. A plain <code>CREATE INDEX</code> takes a <code>SHARE</code> lock that blocks writes (not reads) for the duration; <code>CREATE INDEX CONCURRENTLY</code> avoids blocking writes at the cost of two table scans.</p>`,
  whenNot: `
<ul>
  <li><strong>Tiny tables</strong> (a few pages, e.g. <code>departments</code> with 8 rows in 1 page): a seq scan reads one page; an index can't beat that.</li>
  <li><strong>Low-selectivity predicates</strong> that match a large share of rows (<code>status = 'delivered'</code> is 50% of orders): the planner will seq scan anyway, so the index is pure write overhead &mdash; unless it is a <em>partial</em> index on the rare values.</li>
  <li><strong>Write-heavy, rarely-read tables</strong> (raw event ingestion, logging): each extra index multiplies write I/O and WAL; consider BRIN or no index.</li>
  <li><strong>Columns only used inside functions</strong> (<code>WHERE lower(email) = ...</code>): a plain index on <code>email</code> won't help; you need an expression index.</li>
  <li><strong>Analytics over whole tables</strong>: <code>SUM</code> over all rows needs every row; consider partitioning, BRIN, materialized views or a columnar store instead.</li>
</ul>`,
  syntax: `CREATE [ UNIQUE ] INDEX [ CONCURRENTLY ] [ IF NOT EXISTS ] index_name
    ON table_name [ USING method ]          -- btree (default), hash, gist, spgist, gin, brin
    ( column_or_expression [ opclass ] [ ASC | DESC ] [ NULLS { FIRST | LAST } ] [, ...] )
    [ INCLUDE ( column [, ...] ) ]
    [ NULLS [ NOT ] DISTINCT ]
    [ WITH ( storage_parameter = value [, ...] ) ]
    [ TABLESPACE tablespace_name ]
    [ WHERE predicate ];

DROP INDEX [ CONCURRENTLY ] [ IF EXISTS ] index_name;
EXPLAIN [ ( ANALYZE, BUFFERS ) ] query;`,
  examples: [
    { label: 'Basic', title: 'The deliberately unindexed lookup',
      sql: `-- orders.customer_id has NO index in company_db.
-- EXPLAIN shows the plan the planner chose, without running the query.
EXPLAIN
SELECT id, order_date, total_amount
FROM orders
WHERE customer_id = 42;`,
      explain: `<p><code>Seq Scan on orders</code> means PostgreSQL will read <strong>every</strong> page of the table. <code>Filter: (customer_id = 42)</code> is applied row by row after reading.</p>
<p><code>cost=0.00..151.50</code>: startup cost 0 (first row can come immediately), total cost 151.50 arbitrary units = 89 pages &times; <code>seq_page_cost</code> 1.0 + 5000 rows &times; <code>cpu_tuple_cost</code> 0.01 + 5000 &times; <code>cpu_operator_cost</code> 0.0025. <code>rows=9</code> is the estimate (5000 rows / ~500 distinct customers). <code>width=24</code> is the average output row size in bytes.</p>`,
      output: `                         QUERY PLAN
------------------------------------------------------------
 Seq Scan on orders  (cost=0.00..151.50 rows=9 width=24)
   Filter: (customer_id = 42)`,
      run: true },
    { label: 'Intermediate', title: 'Measure, add the index, measure again',
      sql: `-- 1) Before: actually run it and measure
EXPLAIN (ANALYZE)
SELECT id, order_date, total_amount FROM orders WHERE customer_id = 42;

-- 2) Add the missing index
CREATE INDEX idx_orders_customer_id ON orders (customer_id);

-- 3) After: same query
EXPLAIN (ANALYZE)
SELECT id, order_date, total_amount FROM orders WHERE customer_id = 42;`,
      explain: `<p><strong>Before:</strong> <code>Rows Removed by Filter: 4990</code> &ndash; we read 5,000 rows to keep 10. <code>Buffers: shared hit=89</code> &ndash; all 89 table pages were touched. (In PostgreSQL 18, <code>EXPLAIN ANALYZE</code> shows buffers by default and prints row counts as decimals, e.g. <code>rows=10.00</code>, because they are averages per loop.)</p>
<p><strong>After:</strong> a <code>Bitmap Index Scan</code> reads 2 index pages and produces a bitmap of 10 row locations; the <code>Bitmap Heap Scan</code> visits only the 8 heap pages that contain them (<code>Heap Blocks: exact=8</code>). Total 10 buffers instead of 89; execution time drops roughly 10x even on this tiny table. <code>Index Searches: 1</code> (new in PG18) counts how many times the index was descended.</p>
<p>Why bitmap and not a plain Index Scan? The 10 matching rows are scattered over 8 different pages; sorting the ctids by page first guarantees each page is read once, in physical order.</p>`,
      output: `-- BEFORE
 Seq Scan on orders  (cost=0.00..151.50 rows=9 width=24) (actual time=5.394..10.974 rows=10.00 loops=1)
   Filter: (customer_id = 42)
   Rows Removed by Filter: 4990
   Buffers: shared hit=89
 Planning Time: 0.668 ms
 Execution Time: 11.290 ms

CREATE INDEX

-- AFTER
 Bitmap Heap Scan on orders  (cost=4.35..31.88 rows=9 width=24) (actual time=0.674..0.699 rows=10.00 loops=1)
   Recheck Cond: (customer_id = 42)
   Heap Blocks: exact=8
   Buffers: shared hit=8 read=2
   ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..4.35 rows=9 width=0) (actual time=0.278..0.279 rows=10.00 loops=1)
         Index Cond: (customer_id = 42)
         Index Searches: 1
         Buffers: shared read=2
 Planning Time: 0.657 ms
 Execution Time: 0.950 ms`,
      run: true },
    { label: 'Advanced', title: 'Index size, IN-lists and when the index is ignored',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);

-- How big are the heap and its indexes?
SELECT c.relname AS object, c.relkind, c.relpages,
       pg_size_pretty(pg_relation_size(c.oid)) AS size
FROM pg_class c
WHERE c.relname IN ('orders', 'orders_pkey', 'idx_orders_customer_id')
ORDER BY c.relpages DESC;

-- An IN-list becomes "= ANY(array)" and uses the index
EXPLAIN SELECT * FROM orders WHERE customer_id IN (42, 43, 44);

-- 98% of rows match: the index exists but is (correctly) ignored
EXPLAIN SELECT * FROM orders WHERE customer_id > 10;`,
      explain: `<p>The heap is 712 kB (89 pages); the new index is only 64 kB (8 pages) because each entry is just a 4-byte integer + ctid + tuple header. <code>relkind</code> <code>r</code> = table, <code>i</code> = index.</p>
<p><code>IN (42,43,44)</code> is rewritten to <code>customer_id = ANY('{42,43,44}')</code>, which a B-tree can satisfy with one scan per element. Estimated 32 rows &rarr; bitmap scan.</p>
<p><code>customer_id &gt; 10</code> is estimated at 4,909 of 5,000 rows. Fetching 98% of rows through an index means random access to nearly every page plus reading the index itself &mdash; more expensive than one sequential pass, so the planner picks a <code>Seq Scan</code>. <strong>An unused index is not a bug; it is the cost model working.</strong></p>`,
      output: ` object                 | relkind | relpages | size
------------------------+---------+----------+--------
 orders                 | r       |       89 | 712 kB
 orders_pkey            | i       |       30 | 240 kB
 idx_orders_customer_id | i       |        8 | 64 kB

 Bitmap Heap Scan on orders  (cost=13.10..78.43 rows=32 width=36)
   Recheck Cond: (customer_id = ANY ('{42,43,44}'::integer[]))
   ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..13.10 rows=32 width=0)
         Index Cond: (customer_id = ANY ('{42,43,44}'::integer[]))

 Seq Scan on orders  (cost=0.00..151.50 rows=4909 width=36)
   Filter: (customer_id > 10)`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Join on an unindexed foreign key: the whole orders table is hashed/scanned
EXPLAIN ANALYZE
SELECT count(*)
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.email = 'customer42@example.com';
-- Hash Join -> Seq Scan on orders o (rows=5000), Buffers: shared hit=92, ~20 ms`,
      why: 'customers is found instantly via its unique email index, but orders.customer_id has no index, so PostgreSQL must read all 5,000 orders (89 pages) and hash-join them to find the 10 that belong to one customer. Cost grows linearly with the orders table.', run: true },
    good: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;

EXPLAIN ANALYZE
SELECT count(*)
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.email = 'customer42@example.com';
-- Nested Loop -> Bitmap Index Scan on idx_orders_customer_id, Buffers: shared hit=13, ~0.6 ms`,
      why: 'With the FK column indexed the planner switches to a Nested Loop: find 1 customer, then probe the orders index once. 13 buffers instead of 92 and the work no longer depends on how many orders exist in total. Always index foreign-key columns that are used in joins or that sit on the child side of ON DELETE.', run: true }
  },
  mistakes: [
    `Assuming PostgreSQL indexes foreign keys automatically. It indexes <strong>primary keys and unique constraints</strong> only; FK columns such as <code>orders.customer_id</code> need an explicit <code>CREATE INDEX</code>.`,
    `Adding an index "on every column just in case". Each index slows every write, bloats WAL and backups, competes for cache, and the planner can usually combine only a few.`,
    `Concluding "the index is broken" because <code>EXPLAIN</code> shows a Seq Scan. Check selectivity first: if the predicate matches a big fraction of rows, a seq scan is genuinely cheaper.`,
    `Testing on a 50-row dev table and declaring "indexes make no difference". Plans depend on table size and statistics; test with production-like volume.`,
    `Running plain <code>CREATE INDEX</code> on a busy production table. It blocks INSERT/UPDATE/DELETE for the whole build; use <code>CREATE INDEX CONCURRENTLY</code>.`,
    `Forgetting to <code>ANALYZE</code> after bulk-loading data, so the planner works with stale or missing statistics and picks bad plans.`
  ],
  best: [
    `Index for <strong>queries</strong>, not for columns: start from the slow or frequent query and design the index that serves its WHERE, JOIN and ORDER BY.`,
    `Index every foreign-key column that is used in joins or whose parent rows get deleted/updated.`,
    `Always verify with <code>EXPLAIN (ANALYZE, BUFFERS)</code> before and after; buffers are a more stable signal than milliseconds.`,
    `Name indexes predictably (<code>idx_&lt;table&gt;_&lt;columns&gt;</code>) so audits and migrations are readable.`,
    `Use <code>CREATE INDEX CONCURRENTLY</code> in production migrations and check for <code>INVALID</code> leftovers if it fails.`,
    `Review <code>pg_stat_user_indexes.idx_scan</code> periodically and drop indexes that are never used.`
  ],
  performance: `
<p><strong>Read side:</strong> a B-tree lookup costs about <em>tree height</em> page reads (2&ndash;4 even for 100M+ rows) plus one heap page per matching row (fewer with bitmap scans or index-only scans). On cached data that is microseconds; on cold disk each random page read can cost 0.1 ms (NVMe) to 5&ndash;10 ms (spinning disk).</p>
<p><strong>Write side:</strong> every index adds work to every INSERT (one more tree insertion + WAL), and to every UPDATE that can't be HOT. In our benchmark lesson, inserting 100k rows took ~180 ms with no indexes and ~1,250 ms with three &mdash; about 7x. <strong>Memory:</strong> hot index pages compete with table pages in <code>shared_buffers</code>; a bloated, unused index steals cache from useful data.</p>`,
  security: `
<p>Indexes are not a security boundary, but they influence it: (1) <code>CREATE INDEX</code> requires ownership of the table; (2) expression indexes execute functions as the table owner during maintenance &mdash; avoid indexing on user-defined functions you do not control; (3) an index on a sensitive column (e.g. national ID) is another copy of that data on disk and in backups, so it must be covered by the same encryption-at-rest and retention policies; (4) timing differences between indexed and unindexed lookups can leak existence of values in multi-tenant systems if an attacker can measure them &mdash; rarely practical, but relevant for login endpoints.</p>`,
  scenario: {
    title: 'Customer service screen became slow after one year',
    steps: [
      '1. Symptom: "Customer orders" page in the support tool takes 4 s; it took 50 ms at launch.',
      '2. Capture the query from the application log: SELECT ... FROM orders WHERE customer_id = $1 ORDER BY order_date DESC.',
      '3. Run EXPLAIN (ANALYZE, BUFFERS) with a real customer id: Seq Scan on orders, Rows Removed by Filter: 18,000,000, shared read=210,000.',
      '4. Confirm no index exists: SELECT indexdef FROM pg_indexes WHERE tablename = \'orders\'.',
      '5. Design the index for the full query: (customer_id, order_date DESC) serves both the filter and the ORDER BY.',
      '6. Build it online: CREATE INDEX CONCURRENTLY idx_orders_customer_date ON orders (customer_id, order_date DESC).',
      '7. Verify indisvalid = true in pg_index, then re-run EXPLAIN ANALYZE: Index Scan, 6 buffers, 0.3 ms.',
      '8. Watch pg_stat_user_indexes.idx_scan increase and the p95 latency graph drop; document the change in the migration repository.'
    ]
  },
  widgets: ['lab:btree', 'diagram:btree'],
  interview: [
    { q: 'What exactly does a B-tree index entry contain in PostgreSQL, and why does an Index Scan still visit the table?',
      a: 'Each leaf entry stores the indexed key value(s) and the ctid (block number + line pointer) of a heap tuple. It does not store transaction visibility information (xmin/xmax), so after finding a candidate the executor must fetch the heap tuple to check whether it is visible to the current snapshot. Only when the visibility map marks the page all-visible can an Index Only Scan skip the heap.' },
    { q: 'Why might PostgreSQL choose a sequential scan even though a matching index exists?',
      a: 'Because the cost model estimates it is cheaper: the predicate matches a large fraction of rows, the table is tiny, the statistics are stale, the predicate is not sargable (function or cast on the column), or the data type/operator does not match the index operator class. Sequential I/O on many rows beats random I/O through an index beyond a selectivity threshold that depends on random_page_cost and correlation.' },
    { q: 'Does PostgreSQL automatically index foreign keys? What problems does a missing FK index cause?',
      a: 'No. Only PRIMARY KEY and UNIQUE constraints create indexes. A missing index on the referencing column makes joins from parent to child slow, and makes DELETE/UPDATE of the parent row require a full scan of the child table to check the constraint, which can also hold locks for a long time.' },
    { q: 'What is the difference between an Index Scan and a Bitmap Heap Scan?',
      a: 'An Index Scan fetches heap tuples in index order, one at a time, possibly revisiting the same heap page many times. A Bitmap Index Scan first collects all matching TIDs into a bitmap, then the Bitmap Heap Scan reads the heap pages in physical order, each once. Bitmaps are better for medium result sets and can combine several indexes with BitmapAnd/BitmapOr, but lose index ordering.' }
  ],
  exercises: [
    { task: 'payments.order_id is not indexed. Show the plan for payments of order 100, add an index, then show the plan again.',
      solution: `EXPLAIN SELECT * FROM payments WHERE order_id = 100;
CREATE INDEX idx_payments_order_id ON payments (order_id);
EXPLAIN SELECT * FROM payments WHERE order_id = 100;`, run: true },
    { task: 'Report the size of every index on the orders table (name and pretty size), largest first.',
      solution: `SELECT indexrelname AS index_name,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE relname = 'orders'
ORDER BY pg_relation_size(indexrelid) DESC;`, run: true },
    { task: 'products.category is not indexed. Create an index and check whether the planner uses it for category = \'audio\' (10 of 100 rows). Explain the result.',
      solution: `CREATE INDEX idx_products_category ON products (category);
ANALYZE products;
EXPLAIN SELECT * FROM products WHERE category = 'audio';
-- products is only 4 pages: a Seq Scan is still the cheapest plan.
-- The index will matter when the catalogue grows to 100k+ products.`, run: true }
  ],
  challenge: {
    task: 'Write a catalog query that lists every foreign-key constraint in the public schema whose first column is NOT the leading column of any index on the child table (i.e. unindexed FKs). Show table, column and referenced table.',
    hint: 'pg_constraint (contype = \'f\', conrelid, confrelid, conkey) joined to pg_attribute; use NOT EXISTS against pg_index where indkey[0] = conkey[1].',
    solution: `SELECT c.conrelid::regclass  AS child_table,
       a.attname               AS fk_column,
       c.confrelid::regclass   AS parent_table,
       c.conname               AS constraint_name
FROM pg_constraint c
JOIN pg_attribute a
  ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
  AND c.connamespace = 'public'::regnamespace
  AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indkey[0] = c.conkey[1])
ORDER BY 1, 2;`,
    run: true
  },
  related: ['indexes-btree-internals', 'indexes-composite', 'explain-basics', 'query-optimization', 'advanced-indexing'],
  quiz: [
    { type: 'mcq', q: 'In PostgreSQL, what does a B-tree index leaf entry point to?',
      options: ['The primary key value of the row', 'The ctid (page, offset) of a heap tuple', 'A copy of the whole row', 'The WAL position of the row'],
      answer: 1, explain: 'Index entries store key + ctid, the physical address of a heap tuple version. They do not store the full row (unless INCLUDE columns are added) nor visibility info.' },
    { type: 'tf', q: 'Declaring orders.customer_id REFERENCES customers(id) automatically creates an index on orders.customer_id.',
      answer: false, explain: 'Only PRIMARY KEY and UNIQUE create indexes. FK columns must be indexed manually.' },
    { type: 'predict', q: 'orders has 5,000 rows and an index on customer_id. What plan do you expect?',
      code: `EXPLAIN SELECT * FROM orders WHERE customer_id > 10;`,
      options: ['Index Scan using idx_orders_customer_id', 'Seq Scan on orders', 'Index Only Scan', 'Bitmap Heap Scan with BitmapAnd'],
      answer: 1, explain: 'About 98% of rows match. Reading nearly all rows through the index is costlier than one sequential pass, so the planner chooses Seq Scan.' },
    { type: 'scenario', q: 'Deleting one customer takes 3 seconds on a 20M-row orders table. EXPLAIN of the DELETE shows nothing slow. What is the most likely cause?',
      options: ['customers table needs VACUUM FULL', 'The FK check scans orders because orders.customer_id has no index', 'The DELETE needs a higher work_mem', 'Autovacuum is disabled'],
      answer: 1, explain: 'The referential-integrity trigger must check orders for referencing rows. Without an index on orders.customer_id that is a full scan per deleted customer. EXPLAIN ANALYZE shows it as trigger time.' },
    { type: 'index', q: 'Which index best serves: SELECT * FROM orders WHERE customer_id = $1 ORDER BY order_date DESC LIMIT 20?',
      options: ['(order_date)', '(customer_id)', '(customer_id, order_date)', '(order_date, customer_id)'],
      answer: 2, explain: 'Equality column first, then the sort column: the index returns that customer\'s rows already ordered by date, so LIMIT 20 stops after 20 index entries with no Sort node. A backward scan handles DESC.' }
  ]
},

{
  id: 'indexes-btree-internals',
  module: 'indexes',
  title: 'B-tree Internals: Pages, Levels, ctids and Sort Avoidance',
  level: 3,
  minutes: 25,
  summary: 'Open up a real B-tree with pageinspect: metapage, root, leaf pages, sorted keys and ctid pointers; learn which operators a B-tree supports and how it eliminates sorts.',
  objectives: [
    'Describe the structure of a PostgreSQL B-tree: metapage, root, internal (branch) and leaf pages',
    'Use pageinspect (bt_metap, bt_page_stats, bt_page_items) to inspect a live index',
    'Explain high keys, right-links, deduplication and why the tree stays shallow',
    'List the operators a B-tree supports and why LIKE prefix / casts behave as they do',
    'Use a B-tree to avoid a Sort node for ORDER BY ... LIMIT, including backward scans',
    'Explain how fillfactor and page splits affect index size'
  ],
  concept: `
<p><strong>Analogy: a library's card catalogue.</strong> The front desk has one drawer labelled "A&ndash;F / G&ndash;M / N&ndash;S / T&ndash;Z" (the <em>root</em>). Each of those leads to a cabinet with finer labels (<em>internal/branch pages</em>), which finally lead to drawers of individual cards sorted alphabetically (<em>leaf pages</em>). Each card says which shelf and position the book is on (the <code>ctid</code>). Drawers are chained left-to-right so you can keep reading the next drawer without going back to the desk (<em>right-links</em> for range scans).</p>
<p>A PostgreSQL B-tree (strictly a <strong>Lehman&ndash;Yao B+tree</strong> variant) is made of 8&nbsp;kB pages:</p>
<ul>
  <li><strong>Page 0 &ndash; metapage</strong>: points to the current root page and records the tree level.</li>
  <li><strong>Root page</strong>: the single top page. For small indexes the root is itself a leaf (level 0).</li>
  <li><strong>Internal pages</strong> (level &ge; 1): hold <em>separator keys</em> ("downlinks") pointing to child pages. Their first item on each page is a "minus infinity" downlink.</li>
  <li><strong>Leaf pages</strong> (level 0): hold every indexed key in sorted order with the heap <code>ctid</code>. Leaves are doubly linked (left/right siblings), which makes range scans and backward scans cheap.</li>
  <li><strong>High key</strong>: every non-rightmost page stores an upper bound for its keys as item 1. If a concurrent split moved your key to the right, a reader notices "my key &gt; high key" and follows the right-link &mdash; no lock on the whole tree is needed.</li>
</ul>
<p>Because each internal page holds hundreds of downlinks (fan-out ~ 200&ndash;500 for integer keys), the height grows logarithmically: ~ 3 levels for 10M rows, ~ 4 for a few billion. That is why a primary-key lookup costs about the same on 1,000 rows and on 1 billion.</p>
<p><strong>Ordered data enables sort avoidance.</strong> Leaves are sorted, so <code>ORDER BY indexed_col LIMIT n</code> can read the first <em>n</em> entries and stop &mdash; no Sort node, and the startup cost collapses. Walking the leaf chain right-to-left gives <code>DESC</code> order for free (<code>Index Scan Backward</code>).</p>
<p><strong>Supported operators.</strong> A B-tree operator class defines exactly five strategies: <code>&lt;</code>, <code>&lt;=</code>, <code>=</code>, <code>&gt;=</code>, <code>&gt;</code>. Everything else is derived: <code>BETWEEN</code> becomes <code>&gt;= AND &lt;=</code>, <code>IN</code> becomes <code>= ANY(array)</code>, <code>IS NULL</code> is supported specially, and <code>LIKE 'abc%'</code> becomes a range <code>&gt;= 'abc' AND &lt; 'abd'</code> <em>only</em> when the collation sorts byte-wise (C collation) or you use the <code>text_pattern_ops</code> operator class. <code>LIKE '%abc'</code>, <code>&lt;&gt;</code>, and functions on the column cannot use the tree.</p>`,
  why: `
<p>B-tree is PostgreSQL's default index type because it serves the overwhelming majority of OLTP access patterns: equality, ranges, sorting, uniqueness, min/max, and merge joins. Understanding its internals explains real-world behaviour you will otherwise find mysterious: why random UUID keys bloat indexes, why <code>LIKE</code> works on one server and not on another (collation), why <code>ORDER BY ... LIMIT</code> is instant with the right index, and why an index can be 3x bigger than expected after heavy updates.</p>`,
  useCase: `
<p><strong>Activity feed at a SaaS company:</strong> <code>SELECT * FROM events WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50</code> over 2 billion rows. A B-tree on <code>(account_id, created_at)</code> has height 4: the query reads 4 index pages to find the start position, then walks one or two leaf pages backward and fetches 50 heap tuples. p99 is 3 ms. Without sort avoidance the database would have to fetch all of an account's events (up to 5M for big tenants) and sort them on every page load.</p>
<p><strong>Random vs sequential keys:</strong> the same company switched primary keys from random UUIDv4 to time-ordered keys (bigint identity / UUIDv7). With random keys every insert landed on a random leaf, causing constant page splits, ~ 30% larger indexes and poor cache locality; time-ordered keys always append to the rightmost leaf.</p>`,
  internals: `
<p><strong>Searching:</strong> start at the root from the metapage, binary-search the separator keys on each page, follow the downlink, repeat until a leaf; then binary-search the leaf. Each step is one page access (usually cached).</p>
<p><strong>Inserting and page splits:</strong> the new entry goes to the correct leaf. If it doesn't fit, the leaf is split: about half the items move to a new right sibling (for the rightmost page PostgreSQL leaves the left page ~ full &mdash; "fastpath" for ascending keys), and a new downlink is inserted into the parent, which may split recursively. A root split adds a level. Index <code>fillfactor</code> (default 90 for B-tree leaves) reserves free space for future inserts.</p>
<p><strong>Deduplication (PG13+):</strong> repeated keys are stored once with a <em>posting list</em> of ctids, dramatically shrinking indexes on low-cardinality columns. In <code>bt_page_items</code> a posting-list tuple shows a ctid with a large offset and a <code>tids</code> array. <strong>Bottom-up deletion (PG14+)</strong> removes old versions created by non-HOT updates before splitting a page.</p>
<p><strong>Deletion:</strong> index entries are never removed by <code>DELETE</code> itself; VACUUM removes entries whose heap tuples are dead, and fully empty pages are recycled later. Readers may also mark entries as "known dead" (<code>LP_DEAD</code>) during scans to skip them next time.</p>
<p><strong>Skip scan (PG18):</strong> a multi-column B-tree can now be used even when the query does not constrain the leading column, by internally iterating over the distinct values of that column (see the composite-index lesson; it shows up as <code>Index Searches: N</code>).</p>`,
  whenNot: `
<ul>
  <li><strong>Containment and membership</strong> (<code>jsonb @&gt;</code>, array <code>&amp;&amp;</code>, full-text <code>@@</code>): use GIN.</li>
  <li><strong>Geometric, range overlap, nearest-neighbour</strong>: use GiST/SP-GiST.</li>
  <li><strong>Infix / suffix text search</strong> (<code>LIKE '%foo%'</code>): use pg_trgm with GIN/GiST.</li>
  <li><strong>Huge append-only tables</strong> queried by time range where a 4 GB B-tree is too expensive: BRIN (kilobytes) can be enough.</li>
  <li>Keys larger than ~ 2.7 kB (one third of a page) cannot be indexed by a B-tree at all; index a hash/md5 of the value or use a hash index.</li>
</ul>`,
  syntax: `-- B-tree is the default access method
CREATE INDEX name ON table (col [ASC|DESC] [NULLS FIRST|LAST] [, ...]) [WITH (fillfactor = 90, deduplicate_items = on)];

-- Operator class for LIKE 'prefix%' under non-C collations
CREATE INDEX name ON table (text_col text_pattern_ops);

-- Inspect internals (extension, ships with PostgreSQL contrib)
CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT * FROM bt_metap('index_name');
SELECT * FROM bt_page_stats('index_name', block_no);
SELECT * FROM bt_page_items('index_name', block_no);`,
  examples: [
    { label: 'Basic', title: 'Look inside a real B-tree with pageinspect',
      sql: `-- A clean table with 20,000 sequential ids
CREATE TABLE bt_demo AS
SELECT g AS id, md5(g::text) AS payload
FROM generate_series(1, 20000) AS g;
CREATE UNIQUE INDEX bt_demo_id_idx ON bt_demo (id);

-- pageinspect is an extension (contrib), not core SQL
CREATE EXTENSION IF NOT EXISTS pageinspect;

-- Metapage: where is the root, how tall is the tree?
SELECT root, level, fastroot, fastlevel FROM bt_metap('bt_demo_id_idx');

SELECT pg_relation_size('bt_demo_id_idx') / 8192 AS index_pages,
       pg_relation_size('bt_demo') / 8192         AS table_pages;

-- The root page (block 3): an internal page at level 1
SELECT blkno, type, live_items, free_size, btpo_level
FROM bt_page_stats('bt_demo_id_idx', 3);

-- Its downlinks: child block + separator key (hex, little-endian int)
SELECT itemoffset, ctid, data FROM bt_page_items('bt_demo_id_idx', 3) LIMIT 6;

-- First leaf page: item 1 is the HIGH KEY, then real entries -> heap ctids
SELECT itemoffset, ctid, data FROM bt_page_items('bt_demo_id_idx', 1) LIMIT 4;

SELECT ctid, id FROM bt_demo WHERE id IN (1, 2, 3, 120);`,
      explain: `<p><code>root=3, level=1</code>: the tree has two levels &mdash; one root page (block 3) and 55 leaf pages beneath it. 20,000 keys fit in 57 index pages vs 192 table pages.</p>
<p>In the <strong>root</strong>, each item's <code>ctid</code> is <code>(child_block, ...)</code>: item 2 says "keys from <code>6f 01</code> = 0x016f = 367 upward live in block 2". Item 1 with empty data is the "minus infinity" downlink to block 1.</p>
<p>In <strong>leaf block 1</strong>, item 1 is the <em>high key</em> (367, the first key of the next leaf) and items 2..n are real entries pointing to heap tuples: key 1 &rarr; <code>(0,1)</code>, key 2 &rarr; <code>(0,2)</code>... The last query confirms those are exactly the heap ctids of rows 1, 2, 3. Each leaf holds ~366 four-byte keys.</p>`,
      output: ` root | level | fastroot | fastlevel
------+-------+----------+-----------
    3 |     1 |        3 |         1

 index_pages | table_pages
-------------+-------------
          57 |         192

 blkno | type | live_items | free_size | btpo_level
-------+------+------------+-----------+------------
     3 | r    |         55 |      7056 |          1

 itemoffset | ctid  | data
------------+-------+-------------------------
          1 | (1,0) |
          2 | (2,1) | 6f 01 00 00 00 00 00 00
          3 | (4,1) | dd 02 00 00 00 00 00 00
          4 | (5,1) | 4b 04 00 00 00 00 00 00
          5 | (6,1) | b9 05 00 00 00 00 00 00
          6 | (7,1) | 27 07 00 00 00 00 00 00

 itemoffset | ctid  | data
------------+-------+-------------------------
          1 | (3,1) | 6f 01 00 00 00 00 00 00   <- high key (367)
          2 | (0,1) | 01 00 00 00 00 00 00 00   <- id 1 lives at heap (0,1)
          3 | (0,2) | 02 00 00 00 00 00 00 00
          4 | (0,3) | 03 00 00 00 00 00 00 00

 ctid    | id
---------+-----
 (0,1)   |   1
 (0,2)   |   2
 (0,3)   |   3
 (0,120) | 120`,
      run: true },
    { label: 'Intermediate', title: 'Sort avoidance: ORDER BY ... LIMIT with and without an index',
      sql: `-- Latest 10 orders: no index on order_date yet
EXPLAIN SELECT id, order_date FROM orders ORDER BY order_date DESC LIMIT 10;

CREATE INDEX idx_orders_order_date ON orders (order_date);

-- Same query: the B-tree is already sorted, read it backwards
EXPLAIN SELECT id, order_date FROM orders ORDER BY order_date DESC LIMIT 10;`,
      explain: `<p><strong>Before:</strong> <code>Seq Scan</code> of all 5,000 rows feeding a <code>Sort</code> (top-N heapsort). Note the <strong>startup cost 247.05</strong>: nothing can be returned until every row has been read and sorted.</p>
<p><strong>After:</strong> <code>Index Scan Backward</code> walks the leaf chain from the right end. Startup cost <code>0.28</code>, and the <code>Limit</code> total cost is just <code>1.27</code> because it stops after 10 entries &mdash; even though the full index scan would cost 495.28 (higher than a seq scan, since order_date is uncorrelated with physical row order). A single-column index serves both ASC and DESC; you only need <code>DESC</code> in the definition for mixed orders such as <code>ORDER BY a ASC, b DESC</code>.</p>`,
      output: `-- BEFORE
 Limit  (cost=247.05..247.07 rows=10 width=16)
   ->  Sort  (cost=247.05..259.55 rows=5000 width=16)
         Sort Key: order_date DESC
         ->  Seq Scan on orders  (cost=0.00..139.00 rows=5000 width=16)

CREATE INDEX

-- AFTER
 Limit  (cost=0.28..1.27 rows=10 width=16)
   ->  Index Scan Backward using idx_orders_order_date on orders  (cost=0.28..495.28 rows=5000 width=16)`,
      run: true },
    { label: 'Advanced', title: 'Which operators can a B-tree serve? (pg_amop and LIKE)',
      sql: `-- The five strategies of the btree integer operator family
SELECT o.amopstrategy AS strategy, o.amopopr::regoperator AS operator
FROM pg_amop o
JOIN pg_opfamily f ON f.oid = o.amopfamily
JOIN pg_am a      ON a.oid = f.opfmethod
WHERE a.amname = 'btree' AND f.opfname = 'integer_ops'
  AND o.amoplefttype = 'int4'::regtype AND o.amoprighttype = 'int4'::regtype
ORDER BY 1;

-- LIKE 'prefix%': usable here because company_db uses the C collation
SELECT datcollate FROM pg_database WHERE datname = current_database();
CREATE INDEX idx_customers_name ON customers (name);
EXPLAIN SELECT * FROM customers WHERE name LIKE 'Customer 42%';`,
      explain: `<p>The catalog shows exactly five B-tree strategies: 1 <code>&lt;</code>, 2 <code>&lt;=</code>, 3 <code>=</code>, 4 <code>&gt;=</code>, 5 <code>&gt;</code>. Any predicate the planner can reduce to these (BETWEEN, IN, prefix LIKE) is indexable; anything else (<code>&lt;&gt;</code>, <code>LIKE '%x'</code>, <code>col + 1 = 5</code>) is not.</p>
<p>The <code>LIKE</code> plan shows the rewrite: <code>Index Cond: name &gt;= 'Customer 42' AND name &lt; 'Customer 43'</code>, then the exact <code>LIKE</code> is rechecked as a Filter. This works because the database collation is <code>C</code> (byte order). Under a linguistic collation like <code>en_US.UTF-8</code> the plain index would <em>not</em> be used for LIKE; you would create it with <code>text_pattern_ops</code> (or <code>COLLATE "C"</code>).</p>`,
      output: ` strategy | operator
----------+---------------------
        1 | <(integer,integer)
        2 | <=(integer,integer)
        3 | =(integer,integer)
        4 | >=(integer,integer)
        5 | >(integer,integer)

 datcollate
------------
 C

 Bitmap Heap Scan on customers  (cost=4.38..11.84 rows=10 width=67)
   Filter: (name ~~ 'Customer 42%'::text)
   ->  Bitmap Index Scan on idx_customers_name  (cost=0.00..4.37 rows=10 width=0)
         Index Cond: ((name >= 'Customer 42'::text) AND (name < 'Customer 43'::text))`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
-- Casting the COLUMN changes the operator to text = text,
-- which the integer B-tree cannot answer
EXPLAIN SELECT * FROM orders WHERE customer_id::text = '42';
-- Seq Scan on orders  Filter: ((customer_id)::text = '42'::text)`,
      why: 'The index stores integers ordered by the integer < operator. Once the column is wrapped in a cast (or any function), the expression no longer matches the index key, so every row must be cast and compared: full scan. This often happens silently with ORMs binding parameters as text, or comparing int to numeric.', run: true },
    good: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
-- Cast the CONSTANT, never the column
EXPLAIN SELECT * FROM orders WHERE customer_id = '42'::int;
-- Bitmap Index Scan on idx_orders_customer_id  Index Cond: (customer_id = 42)`,
      why: 'Comparing the column with a value of the same type keeps the predicate sargable: the planner uses the integer operator class and descends the tree. Fix type mismatches in the application (bind parameters with the right type) rather than in the column expression.', run: true }
  },
  mistakes: [
    `Using random UUIDv4 primary keys on very high-insert tables without understanding the cost: inserts hit random leaf pages, causing page splits, larger indexes and poor cache hit rates. Prefer bigint identity or time-ordered UUIDs (UUIDv7; PostgreSQL 18 adds a core <code>uuidv7()</code> function).`,
    `Expecting <code>LIKE 'abc%'</code> to use a plain B-tree under a non-C collation. Use <code>text_pattern_ops</code> or a <code>COLLATE "C"</code> index.`,
    `Wrapping indexed columns in casts or functions (<code>col::text</code>, <code>date(col)</code>, <code>col + 0</code>), which disables the index.`,
    `Creating separate <code>ASC</code> and <code>DESC</code> indexes on the same single column &mdash; one index serves both directions via backward scans.`,
    `Trying to index very long text values: B-tree entries are limited to about 1/3 of a page (~2,700 bytes) and the insert fails with "index row size exceeds maximum".`
  ],
  best: [
    `Prefer monotonically increasing keys (identity, sequence, UUIDv7) for heavily inserted tables.`,
    `Use B-tree for equality, ranges, sorting, min/max and uniqueness; reach for other index types only when the operator demands it.`,
    `Design indexes so that <code>ORDER BY ... LIMIT</code> queries read the index in order and stop early.`,
    `Lower index <code>fillfactor</code> (e.g. 70&ndash;80) only for indexes with many random inserts into the middle of the key space; keep the default for append-only keys.`,
    `Use <code>pageinspect</code> and <code>pg_relation_size</code> on a staging copy to understand index size and bloat; never experiment on production pages.`
  ],
  performance: `
<p>Lookup cost &asymp; height &times; (cached page access) + heap fetches. Height for an integer key: ~ 367 keys per leaf and ~ 300 downlinks per internal page, so 1 level holds ~ 300 leaves (~ 110k rows), 2 levels ~ 33M rows, 3 levels ~ 10 billion. Root and upper levels are almost always in <code>shared_buffers</code>, so a cold lookup typically costs only 1 leaf read + 1 heap read.</p>
<p>Wider keys (long text, multi-column) reduce fan-out and increase height and size. Deduplication makes low-cardinality indexes 2&ndash;5x smaller. Range scans are sequential over the leaf chain, but heap access order depends on <em>correlation</em> between index order and physical order (see <code>pg_stats.correlation</code>): <code>orders.id</code> has correlation ~ 1.0, <code>order_date</code> ~ 0.0, which is why the full backward scan above was costed at 495 vs 139 for a seq scan.</p>`,
  security: `
<p><code>pageinspect</code> exposes raw page contents, including values of rows the current user may not be allowed to see via row-level security or column privileges. Its functions are restricted to superusers by default &mdash; keep it that way and never grant it to application roles. Use it on development or restored copies.</p>`,
  scenario: {
    title: 'Index on a UUID primary key is 3x bigger than expected',
    steps: [
      '1. Observation: events_pkey (UUIDv4) is 38 GB while the similar bigint index on a sister table is 12 GB.',
      '2. Inspect leaf density on a staging restore: SELECT avg(free_size) FROM bt_page_stats per sampled block (or pgstattuple\'s pgstatindex where available) shows leaves ~ 55% full.',
      '3. Cause: random inserts split leaves in the middle; each split leaves two half-empty pages.',
      '4. Short-term fix: REINDEX INDEX CONCURRENTLY events_pkey to rebuild densely packed leaves.',
      '5. Long-term fix: generate time-ordered keys (UUIDv7) so new entries append to the right edge.',
      '6. Verify: index growth per million inserts drops ~ 40%, buffer cache hit ratio for the index rises.'
    ]
  },
  widgets: ['diagram:btree', 'lab:btree'],
  interview: [
    { q: 'Why is a PostgreSQL B-tree lookup on 1 billion rows only slightly slower than on 1 million rows?',
      a: 'Because the tree height grows logarithmically with a very high fan-out: each internal page holds hundreds of downlinks, so 1M integer keys need 2-3 levels and 1B need about 4. The upper levels are almost always cached, so the difference is roughly one extra cached page access.' },
    { q: 'What is a high key and why does PostgreSQL need it?',
      a: 'Every non-rightmost B-tree page stores an upper bound on its keys (the high key). PostgreSQL implements the Lehman-Yao algorithm: when a reader descends to a page that has been split concurrently, it compares its search key to the high key and, if larger, follows the right-link to the sibling. This allows searches to proceed without holding locks on parent pages during splits.' },
    { q: 'Why might LIKE \'abc%\' use an index on one server but not another?',
      a: 'The prefix rewrite to a >= / < range is only valid when the index ordering is byte-wise. With the C collation (or text_pattern_ops / varchar_pattern_ops operator classes, or a COLLATE "C" index) it works; with linguistic collations like en_US.UTF-8 the default operator class cannot be used for LIKE and the planner falls back to a scan.' },
    { q: 'How does a B-tree help ORDER BY ... LIMIT and what does Index Scan Backward mean?',
      a: 'Leaf pages are kept in key order and linked in both directions. If an index matches the ORDER BY, the executor can return rows in order directly, so a Limit node stops after n rows with no Sort. Index Scan Backward walks the leaves from right to left to produce descending order from an ascending index.' }
  ],
  exercises: [
    { task: 'Show that a single ascending index on customers(created_at) can serve both ORDER BY created_at LIMIT 5 and ORDER BY created_at DESC LIMIT 5.',
      solution: `CREATE INDEX idx_customers_created_at ON customers (created_at);
EXPLAIN SELECT id, created_at FROM customers ORDER BY created_at LIMIT 5;
EXPLAIN SELECT id, created_at FROM customers ORDER BY created_at DESC LIMIT 5;`, run: true },
    { task: 'Using pageinspect on bt_demo (recreate it), show the type and number of live items for blocks 1, 2 and 3 of the index.',
      solution: `CREATE TABLE bt_demo AS SELECT g AS id FROM generate_series(1, 20000) g;
CREATE UNIQUE INDEX bt_demo_id_idx ON bt_demo (id);
CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT s.blkno, s.type, s.live_items, s.btpo_level
FROM generate_series(1, 3) AS b(n),
     LATERAL bt_page_stats('bt_demo_id_idx', b.n) AS s;`, run: true }
  ],
  challenge: {
    task: 'Demonstrate deduplication: build a 50,000-row table with a status column holding only 5 distinct values, create two B-tree indexes on it, one with deduplicate_items = off, and compare their sizes.',
    hint: 'CREATE INDEX ... WITH (deduplicate_items = off). Compare pg_relation_size of both.',
    solution: `CREATE TABLE dedup_demo AS
SELECT g AS id, (ARRAY['new','paid','shipped','delivered','cancelled'])[1 + g % 5] AS status
FROM generate_series(1, 50000) g;
CREATE INDEX dedup_on  ON dedup_demo (status);
CREATE INDEX dedup_off ON dedup_demo (status) WITH (deduplicate_items = off);
SELECT 'dedup on' AS variant, pg_size_pretty(pg_relation_size('dedup_on')) AS size
UNION ALL
SELECT 'dedup off', pg_size_pretty(pg_relation_size('dedup_off'));`,
    run: true
  },
  related: ['indexes-what-is-an-index', 'indexes-composite', 'advanced-indexing-maintenance', 'internals'],
  quiz: [
    { type: 'mcq', q: 'Which set lists exactly the B-tree operator strategies?',
      options: ['=, <>', '<, <=, =, >=, >', '@>, <@, &&', '=, LIKE, ILIKE'],
      answer: 1, explain: 'B-tree operator classes define five strategies. Other predicates are indexable only if rewritten into these (BETWEEN, IN, prefix LIKE under C/pattern_ops).' },
    { type: 'tf', q: 'You need a separate DESC index to make ORDER BY created_at DESC LIMIT 10 fast when an ASC index on created_at exists.',
      answer: false, explain: 'Leaf pages are doubly linked; Index Scan Backward reads the existing index in reverse. DESC in the definition matters only for mixed-direction multi-column orders.' },
    { type: 'predict', q: 'There is an index on orders(customer_id). Which plan appears?',
      code: `EXPLAIN SELECT * FROM orders WHERE customer_id + 0 = 42;`,
      options: ['Index Scan using the index', 'Bitmap Index Scan', 'Seq Scan with Filter ((customer_id + 0) = 42)', 'Index Only Scan'],
      answer: 2, explain: 'An expression on the column is not the indexed key, so the predicate is not sargable and the planner scans the table.' },
    { type: 'bug', q: 'This index was created on a database with en_US.UTF-8 collation, yet the query does a Seq Scan on 10M rows. Why?',
      code: `CREATE INDEX idx_users_email ON users (email);
SELECT * FROM users WHERE email LIKE 'ajit%';`,
      options: ['LIKE never uses indexes', 'Linguistic collation: the default opclass cannot serve LIKE prefix; use text_pattern_ops', 'The index needs INCLUDE (email)', 'email must be citext'],
      answer: 1, explain: 'Under non-C collations the planner cannot turn LIKE \'ajit%\' into a range on that index. CREATE INDEX ... (email text_pattern_ops) fixes it.' },
    { type: 'mcq', q: 'What is stored in item 1 of a non-rightmost B-tree leaf page?',
      options: ['The smallest key of the page', 'The high key: upper bound of keys on that page', 'A pointer to the metapage', 'The page checksum'],
      answer: 1, explain: 'Item 1 is the high key used by the Lehman-Yao right-link protocol; real entries start at item 2.' }
  ]
},

{
  id: 'indexes-composite',
  module: 'indexes',
  title: 'Composite Indexes and Column Order',
  level: 3,
  minutes: 24,
  summary: 'Design multi-column indexes correctly: the leftmost-prefix rule, equality-before-range, sort support, and the new PostgreSQL 18 skip scan.',
  objectives: [
    'Explain how a multi-column B-tree is sorted (like a phone book: last name, then first name)',
    'Apply the leftmost-prefix rule and the equality-then-range rule to choose column order',
    'Measure the buffer difference between (customer_id, order_date) and (order_date, customer_id)',
    'Use a composite index to satisfy WHERE + ORDER BY + LIMIT without a Sort',
    'Recognise PostgreSQL 18 B-tree skip scan in EXPLAIN (Index Searches: N)',
    'Decide between one composite index and several single-column indexes combined with BitmapAnd'
  ],
  concept: `
<p><strong>Analogy: the phone book.</strong> A phone book is sorted by <em>last name</em>, then by <em>first name</em>. Finding "Kumar, Ajit" is instant. Finding every "Kumar" is instant too (a contiguous block). But finding everyone whose <em>first</em> name is "Ajit" means reading the whole book, because Ajits are scattered across every last name. That is the <strong>leftmost-prefix rule</strong>.</p>
<p>A composite index <code>ON customers (name, email)</code> stores entries sorted by <code>name</code>, and within equal names by <code>email</code>. It can efficiently serve:</p>
<ul>
  <li><code>WHERE name = ? AND email = ?</code> (both columns)</li>
  <li><code>WHERE name = ?</code> (leftmost prefix)</li>
  <li><code>WHERE name = ? ORDER BY email</code> (filter on first, sort by second &mdash; no Sort node)</li>
  <li><code>WHERE name BETWEEN ? AND ?</code> (range on the first column)</li>
</ul>
<p>It serves <code>WHERE email = ?</code> alone poorly: historically not at all; since <strong>PostgreSQL 18</strong> via <em>skip scan</em>, which jumps through each distinct leading value &mdash; only efficient when the leading column has <em>few</em> distinct values.</p>
<p><strong>The equality-then-range rule.</strong> For <code>WHERE customer_id = 42 AND order_date &gt;= '2025-01-01'</code>, put the equality column first: <code>(customer_id, order_date)</code>. All rows of customer 42 are contiguous and already date-sorted, so the scan starts at <code>(42, 2025-01-01)</code> and reads only matching entries. In the reverse order <code>(order_date, customer_id)</code> the scan must read <em>every</em> entry from 2025-01-01 onward (thousands, for all customers) and filter <code>customer_id</code> inside the index. Both "work" &mdash; but one reads 2 index pages and the other 13 on our tiny table, and the gap grows with data volume.</p>
<p><strong>Rules of thumb for column order</strong> (in priority order):</p>
<ol>
  <li>Columns compared with <code>=</code> (or <code>IN</code>) first.</li>
  <li>Then the <em>one</em> column used for a range (<code>&lt;, &gt;, BETWEEN</code>) or for <code>ORDER BY</code>.</li>
  <li>Columns after a range column can still be checked inside the index but don't narrow the scan.</li>
  <li>Among equality columns, order by which <em>other queries</em> need as a leftmost prefix, not by "most selective first" (that folk rule matters much less than people think).</li>
</ol>`,
  why: `
<p>Real queries filter on several columns at once: tenant + status + date, customer + date, user + created_at. Single-column indexes can be combined with a <code>BitmapAnd</code>, but that reads both indexes fully for their predicates, loses ordering (so ORDER BY needs a Sort), and can't stop early for <code>LIMIT</code>. A well-ordered composite index answers the whole predicate with one narrow range scan, returns rows already in the requested order, and often replaces two or three single-column indexes.</p>`,
  useCase: `
<p><strong>Multi-tenant SaaS ticketing (Zendesk-like).</strong> 300M tickets, the hottest query is "open tickets of my tenant, newest first": <code>WHERE tenant_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 50</code>. The index <code>(tenant_id, status, created_at)</code> turns it into: seek to <code>(tenant, 'open', +&infin;)</code>, read 50 entries backward, done &mdash; ~ 1 ms regardless of tenant size. An earlier design with separate indexes on <code>tenant_id</code>, <code>status</code> and <code>created_at</code> needed a BitmapAnd over hundreds of thousands of entries for big tenants plus a Sort, ~ 900 ms.</p>`,
  internals: `
<p>A composite B-tree key is the tuple <code>(c1, c2, ...)</code> compared lexicographically. When the planner matches predicates to an index it builds <em>index quals</em> in column order: it can use equality quals on a prefix of columns, followed by at most one column with an inequality as the scan boundary. Quals on later columns become "non-boundary" conditions evaluated inside the index (still saving heap visits, but not reducing the number of index entries read). EXPLAIN shows all of them under <code>Index Cond</code>, so look at <strong>Buffers</strong> to see the difference.</p>
<p><strong>Skip scan (PG18):</strong> for an index <code>(status, order_date)</code> and <code>WHERE order_date &gt;= X</code>, the executor now treats the missing leading column as "every distinct value of status" and performs one descent per value &mdash; shown as <code>Index Searches: 6</code> (5 statuses + 1 final probe). The planner costs this based on <code>n_distinct</code> of the leading column, so it is chosen only when that is small.</p>
<p><strong>Sort support:</strong> an index on <code>(a, b)</code> provides order <code>a, b</code> and its exact reverse <code>a DESC, b DESC</code>. For <code>ORDER BY a ASC, b DESC</code> you need an index declared <code>(a, b DESC)</code>. If only a prefix of the sort is provided, PG13+ can use <code>Incremental Sort</code> to sort within each group of the prefix.</p>
<p>Up to 32 key columns are allowed (<code>INDEX_MAX_KEYS</code>), but more than 3&ndash;4 is almost always a design smell.</p>`,
  whenNot: `
<ul>
  <li>When the columns are queried <strong>independently</strong> in different queries (sometimes <code>a</code>, sometimes <code>b</code>), two single-column indexes (combined via BitmapAnd when needed) may serve the mix better than one composite.</li>
  <li>When you need "any combination of 5 attributes" (faceted search), no single column order works &mdash; consider a Bloom index, GIN on an array/jsonb, or several targeted indexes.</li>
  <li>Don't append columns "to cover the query" as key columns; use <code>INCLUDE</code> for payload columns (next lessons) so they don't bloat upper tree levels or change uniqueness semantics.</li>
  <li>Don't create both <code>(a)</code> and <code>(a, b)</code>: the composite already serves queries on <code>a</code> alone (slightly larger, but one fewer index to maintain).</li>
</ul>`,
  syntax: `CREATE INDEX name ON table (equality_col1, equality_col2, range_or_sort_col [DESC]);

-- Mixed sort directions need the index to match
CREATE INDEX name ON orders (customer_id, order_date DESC);

-- Usable prefixes of (a, b, c):  (a)  (a, b)  (a, b, c)
-- Not a prefix: (b), (c), (b, c)  -> full index or (PG18) skip scan`,
  examples: [
    { label: 'Basic', title: 'Equality first, then range: (customer_id, order_date)',
      sql: `CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date);
ANALYZE orders;

-- Customer 42's orders since 2025
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, order_date, total_amount
FROM orders
WHERE customer_id = 42 AND order_date >= '2025-01-01';

-- Same index gives "latest 3 orders of customer 42" with no Sort
EXPLAIN (ANALYZE)
SELECT id, order_date FROM orders
WHERE customer_id = 42
ORDER BY order_date DESC LIMIT 3;`,
      explain: `<p>Both predicates appear as <code>Index Cond</code> and the scan reads exactly 2 index pages (<code>Buffers: shared read=2</code> on the index node) &mdash; the entries for customer 42 from 2025-01-01 onward are contiguous.</p>
<p>The second query uses <code>Index Scan Backward</code> with only <code>customer_id = 42</code> as the condition: within that customer, entries are already sorted by date, so reading 3 entries backward from the end of the customer's block is enough. No Sort node; the Limit stops the scan.</p>
<p>(Timestamps print with <code>+05</code> because the sandbox session time zone is UTC+5; your session may differ.)</p>`,
      output: ` Bitmap Heap Scan on orders  (cost=4.32..17.84 rows=4 width=24) (actual time=0.661..0.718 rows=4.00 loops=1)
   Recheck Cond: ((customer_id = 42) AND (order_date >= '2025-01-01 00:00:00+05'::timestamp with time zone))
   Heap Blocks: exact=4
   Buffers: shared hit=4 read=2
   ->  Bitmap Index Scan on idx_orders_cust_date  (cost=0.00..4.32 rows=4 width=0) (actual time=0.321..0.322 rows=4.00 loops=1)
         Index Cond: ((customer_id = 42) AND (order_date >= '2025-01-01 00:00:00+05'::timestamp with time zone))
         Index Searches: 1
         Buffers: shared read=2
 Execution Time: 1.234 ms

 Limit  (cost=0.28..13.67 rows=3 width=16) (actual time=0.270..0.315 rows=3.00 loops=1)
   Buffers: shared hit=5
   ->  Index Scan Backward using idx_orders_cust_date on orders  (cost=0.28..40.44 rows=9 width=16) (actual time=0.114..0.152 rows=3.00 loops=1)
         Index Cond: (customer_id = 42)
         Index Searches: 1
         Buffers: shared hit=5
 Execution Time: 0.367 ms`,
      run: true },
    { label: 'Intermediate', title: 'The wrong order: (order_date, customer_id)',
      sql: `CREATE INDEX idx_orders_date_cust ON orders (order_date, customer_id);
ANALYZE orders;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, order_date, total_amount
FROM orders
WHERE customer_id = 42 AND order_date >= '2025-01-01';`,
      explain: `<p>The plan <em>looks</em> similar &mdash; both columns are listed in <code>Index Cond</code> &mdash; but the numbers tell the truth:</p>
<ul>
<li>Estimated index cost <strong>61.25</strong> vs 4.32.</li>
<li>Index buffers <strong>13</strong> (3 hit + 10 read) vs 2.</li>
<li>Time ~ 5.2 ms vs ~ 0.3 ms for the index part.</li>
</ul>
<p>With the range column first, the scan must walk <em>every</em> entry with <code>order_date &gt;= 2025-01-01</code> (about 2,100 entries for all customers) and check <code>customer_id = 42</code> on each. The customer filter is evaluated in the index but does not narrow the range. On a 100M-row table that is the difference between reading 3 pages and reading 40,000.</p>`,
      output: ` Bitmap Heap Scan on orders  (cost=61.25..74.77 rows=4 width=24) (actual time=5.252..5.265 rows=4.00 loops=1)
   Recheck Cond: ((order_date >= '2025-01-01 00:00:00+05'::timestamp with time zone) AND (customer_id = 42))
   Heap Blocks: exact=4
   Buffers: shared hit=7 read=10
   ->  Bitmap Index Scan on idx_orders_date_cust  (cost=0.00..61.25 rows=4 width=0) (actual time=5.194..5.195 rows=4.00 loops=1)
         Index Cond: ((order_date >= '2025-01-01 00:00:00+05'::timestamp with time zone) AND (customer_id = 42))
         Index Searches: 1
         Buffers: shared hit=3 read=10
 Execution Time: 5.399 ms`,
      run: true },
    { label: 'Advanced', title: 'PostgreSQL 18 skip scan on a low-cardinality leading column',
      sql: `-- Leading column has only 5 distinct values
CREATE INDEX idx_orders_status_date ON orders (status, order_date);
ANALYZE orders;

-- No condition on status at all!
EXPLAIN (ANALYZE)
SELECT id FROM orders WHERE order_date >= '2025-09-25';

EXPLAIN (ANALYZE)
SELECT id, status FROM orders
WHERE order_date BETWEEN '2025-09-01' AND '2025-09-02';`,
      explain: `<p>Before PG18 this index could only be used for <code>order_date</code> by reading the <em>entire</em> index (so the planner would normally choose a seq scan). PostgreSQL 18 introduced <strong>B-tree skip scan</strong>: the executor internally iterates over each distinct <code>status</code> value and seeks to <code>(status, '2025-09-25')</code> for each.</p>
<p><code>Index Searches: 6</code> reveals it: 5 status values plus a final probe to discover there are no more. The second query needs 8 searches (extra probes for the upper bound). Skip scan is chosen only when the skipped column has few distinct values; with 500 distinct <code>customer_id</code> values leading, the planner would not use it.</p>
<div class="callout warn">Skip scan is a safety net, not a design strategy. If <code>order_date</code>-only queries are important, give them their own index (or put the column first).</div>`,
      output: ` Bitmap Heap Scan on orders  (cost=26.16..110.92 rows=60 width=8) (actual time=0.344..0.441 rows=57.00 loops=1)
   Recheck Cond: (order_date >= '2025-09-25 00:00:00+05'::timestamp with time zone)
   Heap Blocks: exact=30
   ->  Bitmap Index Scan on idx_orders_status_date  (cost=0.00..26.14 rows=60 width=0) (actual time=0.208..0.209 rows=57.00 loops=1)
         Index Cond: (order_date >= '2025-09-25 00:00:00+05'::timestamp with time zone)
         Index Searches: 6

 Bitmap Heap Scan on orders  (cost=25.76..47.97 rows=7 width=16) (actual time=0.115..0.125 rows=4.00 loops=1)
   Recheck Cond: ((order_date >= '2025-09-01 00:00:00+05'::timestamp with time zone) AND (order_date <= '2025-09-02 00:00:00+05'::timestamp with time zone))
   Heap Blocks: exact=4
   ->  Bitmap Index Scan on idx_orders_status_date  (cost=0.00..25.75 rows=7 width=0) (actual time=0.086..0.087 rows=4.00 loops=1)
         Index Cond: ((order_date >= '2025-09-01 00:00:00+05'::timestamp with time zone) AND (order_date <= '2025-09-02 00:00:00+05'::timestamp with time zone))
         Index Searches: 8`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Range column first: scans every 2025 entry for every customer
CREATE INDEX idx_orders_date_cust ON orders (order_date, customer_id);
ANALYZE orders;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, total_amount FROM orders
WHERE customer_id = 42 AND order_date >= '2025-01-01';
-- index node: cost 61.25, Buffers: shared hit=3 read=10`,
      why: 'The range predicate on the leading column defines a huge contiguous slice (all customers since January); customer_id is only a filter inside it. Work grows with total order volume, not with the customer\'s orders.', run: true },
    good: { sql: `-- Equality column first, range second
CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date);
ANALYZE orders;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, total_amount FROM orders
WHERE customer_id = 42 AND order_date >= '2025-01-01';
-- index node: cost 4.32, Buffers: shared read=2`,
      why: 'Equality on the leading column makes the matching entries contiguous and the range on the second column trims them precisely. Work is proportional to the result (4 rows), and the same index also serves ORDER BY order_date for that customer.', run: true }
  },
  mistakes: [
    `Ordering columns by "most selective first" regardless of operators. A highly selective range column placed first still prevents the next column from narrowing the scan; equality columns go first.`,
    `Creating <code>(a)</code>, <code>(a, b)</code> and <code>(a, b, c)</code> as three indexes. The longest one serves all three prefixes.`,
    `Expecting <code>(a, b)</code> to help <code>WHERE b = ?</code> on a high-cardinality <code>a</code>. Even with PG18 skip scan, that needs its own index on <code>(b)</code>.`,
    `Putting payload columns into the key (<code>(customer_id, order_date, total_amount, status)</code>) just to get index-only scans; use <code>INCLUDE</code> instead.`,
    `Mismatching sort directions: an index on <code>(a, b)</code> can't produce <code>ORDER BY a, b DESC</code> without a sort; declare <code>(a, b DESC)</code>.`
  ],
  best: [
    `Write down the top queries first; derive column order from them: <strong>equality &rarr; range/sort &rarr; (INCLUDE payload)</strong>.`,
    `Prefer one well-designed composite index over several single-column ones for a hot, multi-predicate query.`,
    `Validate with <code>EXPLAIN (ANALYZE, BUFFERS)</code>; compare index-node buffers, not just whether the index was "used".`,
    `In multi-tenant schemas, lead almost every index with <code>tenant_id</code> so each tenant's data is a contiguous slice.`,
    `Keep composite indexes to 2&ndash;4 columns; each extra column widens every entry and slows writes.`
  ],
  performance: `
<p>The cost of an index range scan is proportional to the number of index entries between the start and stop boundary. Equality on leading columns shrinks that range multiplicatively; a range on a leading column fixes it at "all entries in that range". On the 5,000-row orders table the right order reads 2 index pages vs 13; on 50M rows the same query reads ~ 3 pages vs ~ 120,000.</p>
<p>Composite indexes are wider than single-column ones (176 kB vs 64 kB here), so they cost more to maintain and cache. Skip scan adds one tree descent per distinct leading value: cheap for 5 values, terrible for 50,000.</p>`,
  security: `
<p>In multi-tenant designs, indexes leading with <code>tenant_id</code> also make row-level-security policies such as <code>USING (tenant_id = current_setting('app.tenant_id')::int)</code> efficient: the RLS predicate becomes an index condition rather than a filter applied after a full scan, which prevents "noisy neighbour" denial-of-service between tenants.</p>`,
  scenario: {
    title: 'Ticket list slow only for the biggest tenants',
    steps: [
      '1. Symptom: p50 is 5 ms but tenants with > 1M tickets see 2-3 s on the "open tickets" view.',
      '2. EXPLAIN (ANALYZE, BUFFERS) for a big tenant: BitmapAnd of idx_tickets_tenant and idx_tickets_status, then Sort of 400k rows, Limit 50.',
      '3. The plan is proportional to the tenant\'s total open tickets, not to the 50 rows returned.',
      '4. Design: CREATE INDEX CONCURRENTLY idx_tickets_tenant_status_created ON tickets (tenant_id, status, created_at DESC).',
      '5. Re-run: Index Scan using the new index, Limit 50, 8 buffers, 0.9 ms for every tenant size.',
      '6. Check whether idx_tickets_status is still needed (pg_stat_user_indexes.idx_scan) and drop it if unused, recovering write throughput.'
    ]
  },
  widgets: ['lab:btree', 'lab:index'],
  interview: [
    { q: 'Explain the leftmost-prefix rule for composite B-tree indexes. Did PostgreSQL 18 change it?',
      a: 'A B-tree on (a, b, c) is sorted by a, then b, then c, so it can narrow a scan only by conditions on a prefix: a; a and b; a, b and c. A condition on b alone historically required a full index scan. PostgreSQL 18 added skip scan, which can use the index for b alone by doing one descent per distinct value of a; it is efficient only when a has low cardinality, so the rule remains the right default design principle.' },
    { q: 'Why should equality columns come before range columns in a composite index?',
      a: 'With equality on the leading columns, matching entries form one contiguous run, and a range on the next column trims that run precisely. If the range column is first, the scan covers every entry in the range for all values of the other column, and the equality becomes a filter inside the index, so the work scales with the whole range rather than the result.' },
    { q: 'When would you prefer two single-column indexes over one composite index?',
      a: 'When the columns are queried independently by different important queries and the combined query is rare or not latency critical. PostgreSQL can combine two indexes with BitmapAnd. It loses ordering and early termination with LIMIT, so for a hot query with ORDER BY ... LIMIT a composite index is better.' },
    { q: 'How do you support ORDER BY a ASC, b DESC with an index?',
      a: 'Declare the index with matching directions: CREATE INDEX ON t (a, b DESC). An index can be scanned forward or backward, so it supports its declared order and the exact reverse (a DESC, b ASC), but not other combinations without a Sort or Incremental Sort.' }
  ],
  exercises: [
    { task: 'Create the composite index on customers(name, email) and show EXPLAIN for (a) both columns, (b) name only.',
      solution: `CREATE INDEX idx_customers_name_email ON customers (name, email);
EXPLAIN SELECT id FROM customers WHERE name = 'Customer 42' AND email = 'customer42@example.com';
EXPLAIN SELECT id FROM customers WHERE name = 'Customer 42';`, run: true },
    { task: 'Design an index for: payments of a given status and method, newest first (status = ?, method = ?, ORDER BY paid_at DESC LIMIT 20). Create it and show the plan for refunded UPI payments.',
      solution: `CREATE INDEX idx_payments_status_method_paid ON payments (status, method, paid_at DESC);
ANALYZE payments;
EXPLAIN SELECT id, order_id, amount, paid_at
FROM payments
WHERE status = 'refunded' AND method = 'upi'
ORDER BY paid_at DESC
LIMIT 20;`, run: true }
  ],
  challenge: {
    task: 'Prove with numbers that column order matters: create both (customer_id, order_date) and (order_date, customer_id) on orders, then list each index\'s size, and show which one the planner picks for customer_id = 7 AND order_date >= \'2024-06-01\'.',
    hint: 'pg_stat_user_indexes + pg_relation_size for sizes; EXPLAIN shows which index wins on estimated cost.',
    solution: `CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date);
CREATE INDEX idx_orders_date_cust ON orders (order_date, customer_id);
ANALYZE orders;
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes WHERE relname = 'orders' ORDER BY 1;
EXPLAIN SELECT id FROM orders
WHERE customer_id = 7 AND order_date >= '2024-06-01';
-- Same size, but the planner picks idx_orders_cust_date: its estimated cost is far lower.`,
    run: true
  },
  related: ['indexes-btree-internals', 'indexes-unique-covering', 'explain-buffers-options', 'query-optimization'],
  quiz: [
    { type: 'index', q: 'Query: WHERE tenant_id = $1 AND created_at >= $2 ORDER BY created_at. Best index?',
      options: ['(created_at, tenant_id)', '(tenant_id, created_at)', '(tenant_id) and (created_at) separately', '(created_at) only'],
      answer: 1, explain: 'Equality first (tenant_id), then the range/sort column (created_at). Rows come out contiguous and sorted.' },
    { type: 'tf', q: 'An index on (a, b) can serve WHERE a = 5 efficiently.',
      answer: true, explain: 'a is the leftmost prefix; all entries with a = 5 are contiguous.' },
    { type: 'predict', q: 'PG18, index on orders(status, order_date), status has 5 distinct values. What does EXPLAIN ANALYZE show for WHERE order_date >= \'2025-09-25\'?',
      code: `EXPLAIN ANALYZE SELECT id FROM orders WHERE order_date >= '2025-09-25';`,
      options: ['Seq Scan only, the index cannot be used', 'Bitmap Index Scan with Index Searches: 6 (skip scan)', 'Index Only Scan with Heap Fetches: 0', 'An error: leading column missing'],
      answer: 1, explain: 'PG18 skip scan descends once per distinct status value (+1 final probe).' },
    { type: 'optimize', q: 'You have indexes (user_id), (user_id, created_at) and (created_at). Which is redundant?',
      code: `CREATE INDEX a ON events (user_id);
CREATE INDEX b ON events (user_id, created_at);
CREATE INDEX c ON events (created_at);`,
      options: ['a', 'b', 'c', 'None'],
      answer: 0, explain: '(user_id) is a prefix of (user_id, created_at), which can serve the same queries. (created_at) is needed for queries without user_id.' },
    { type: 'mcq', q: 'What is the main advantage of a composite index over BitmapAnd of two single-column indexes for WHERE a = ? AND b > ? ORDER BY b LIMIT 10?',
      options: ['Smaller on disk', 'Rows come out ordered so LIMIT can stop early, and only matching entries are read', 'It avoids MVCC visibility checks', 'It is maintained without WAL'],
      answer: 1, explain: 'Bitmaps lose ordering and must read all matching entries of both indexes; the composite scan reads just the needed range in order.' }
  ]
},

{
  id: 'indexes-partial-expression',
  module: 'indexes',
  title: 'Partial and Expression Indexes',
  level: 3,
  minutes: 22,
  summary: 'Index only the rows that matter (WHERE status = \'pending\', WHERE is_active) and index computed values (LOWER(email)) so function-based predicates become fast.',
  objectives: [
    'Create partial indexes and explain when the planner can use them (predicate implication)',
    'Measure the size and write savings of a partial index vs a full index',
    'Create expression indexes such as LOWER(email) and explain the exact-match requirement',
    'Explain the IMMUTABLE requirement and fix "functions in index expression must be marked IMMUTABLE"',
    'Use a unique partial / unique expression index to enforce business rules (case-insensitive emails)',
    'Know that expression indexes get their own statistics after ANALYZE'
  ],
  concept: `
<p><strong>Partial index analogy:</strong> a hospital keeps a whiteboard listing only the <em>patients currently in the ICU</em>, not every patient ever admitted. It's tiny, always up to date, and exactly what the night nurse needs. A <strong>partial index</strong> is an index with a <code>WHERE</code> clause: it only contains entries for rows that satisfy the predicate.</p>
<p><code>CREATE INDEX idx_orders_pending ON orders (order_date) WHERE status = 'pending';</code></p>
<p>Only 415 of 5,000 orders are pending, so this index is 4 pages (32 kB) instead of 25 pages for a full <code>(status, order_date)</code> index. Rows that are not pending never touch it on INSERT/UPDATE. A query can use it only if its WHERE clause <strong>implies</strong> the index predicate &mdash; <code>WHERE status = 'pending' AND order_date &lt; ...</code> does; <code>WHERE status = 'paid'</code> does not. Classic uses: "unprocessed" queue rows, <code>WHERE is_active</code>, <code>WHERE deleted_at IS NULL</code> (soft deletes), rare error states.</p>
<p><strong>Expression index analogy:</strong> a phone book that lists everyone by their name <em>in uppercase without accents</em>, so "Müller", "MULLER" and "muller" are found in the same place. An <strong>expression index</strong> stores the result of an expression instead of the raw column:</p>
<p><code>CREATE INDEX idx_customers_lower_email ON customers (LOWER(email));</code></p>
<p>Now <code>WHERE LOWER(email) = 'customer42@example.com'</code> is an index lookup. The query must use the <em>same expression</em> (<code>lower(email)</code>); <code>email ILIKE '...'</code> or <code>upper(email) = ...</code> won't match it.</p>
<p>Both features combine: <code>CREATE UNIQUE INDEX ON users (LOWER(email)) WHERE is_active</code> enforces "one active account per case-insensitive email" &mdash; a rule a plain UNIQUE constraint cannot express.</p>`,
  why: `
<p>Most tables have a <strong>skewed access pattern</strong>: queries hit a small "hot" subset (open tickets, active users, unpaid invoices) while 95% of rows are historical. Indexing all rows wastes space, cache and write I/O on entries no query will ever read. Partial indexes target exactly the hot subset.</p>
<p>Applications constantly query <strong>derived values</strong>: case-insensitive email/username, the date part of a timestamp, a JSON field, a concatenation. Without an expression index, every such predicate is non-sargable and forces a full scan.</p>`,
  useCase: `
<p><strong>Job queue in PostgreSQL</strong> (payments processor, 200M historical jobs, ~2,000 pending at any time). Workers poll <code>SELECT ... WHERE status = 'pending' ORDER BY run_at LIMIT 10 FOR UPDATE SKIP LOCKED</code>. A full index on <code>(status, run_at)</code> was 6 GB and churned on every status change. The partial index <code>ON jobs (run_at) WHERE status = 'pending'</code> is ~ 100 kB, permanently in cache, and finished jobs leave it automatically.</p>
<p><strong>Login by email</strong> at a consumer app: users type emails in any case. <code>CREATE UNIQUE INDEX ON users (lower(email))</code> both enforces uniqueness ignoring case and makes <code>WHERE lower(email) = lower($1)</code> a 0.05 ms lookup.</p>`,
  internals: `
<p><strong>Predicate implication.</strong> At plan time, the planner proves that the query's WHERE clause logically implies the index predicate using simple rules (identical clauses, <code>x = const</code> implies <code>x IS NOT NULL</code>, range containment like <code>a &gt; 10</code> implies <code>a &gt; 5</code> for btree operators). It does <em>not</em> evaluate parameters: with a prepared statement <code>WHERE status = $1</code>, a generic plan cannot use a <code>WHERE status = 'pending'</code> partial index (custom plans for the first 5 executions can). Write the constant literally in the query when you rely on a partial index.</p>
<p><strong>Expression indexes</strong> store the computed value; the expression is evaluated on every INSERT/UPDATE that touches the referenced columns. Functions must be <code>IMMUTABLE</code> (same input &rarr; same output forever). <code>timestamptz::date</code> is only <code>STABLE</code> because it depends on the session <code>TimeZone</code>, hence the error; <code>(ts AT TIME ZONE 'UTC')::date</code> is immutable.</p>
<p><strong>Statistics:</strong> <code>ANALYZE</code> collects statistics for each index expression (visible in <code>pg_stats</code> under the index name). Before the first ANALYZE, the planner guesses selectivity for function predicates (0.5% for equality), which is why the estimate in our example changes from <code>rows=2</code> to <code>rows=1</code> after ANALYZE.</p>`,
  whenNot: `
<ul>
  <li><strong>Partial</strong>: don't use when the predicate covers most rows (<code>WHERE status &lt;&gt; 'cancelled'</code> = 91% of orders) &mdash; savings are negligible and the restriction only limits reuse. Don't build many partial indexes with parameter-dependent predicates; generic plans can't use them.</li>
  <li><strong>Expression</strong>: if you can normalise the data at write time (store <code>email</code> already lowercased, or use the <code>citext</code> extension type), a plain index is simpler. Avoid expensive expressions (regex, JSON parsing) on write-heavy tables.</li>
  <li>For case-insensitive search across many columns or fuzzy matching, consider <code>citext</code> <span class="tag ext">extension</span>, nondeterministic ICU collations, or pg_trgm.</li>
</ul>`,
  syntax: `-- Partial index
CREATE INDEX name ON table (columns) WHERE predicate;

-- Expression index (note double parentheses for non-function expressions)
CREATE INDEX name ON table (LOWER(email));
CREATE INDEX name ON table ((attributes ->> 'brand'));
CREATE INDEX name ON table (((ts AT TIME ZONE 'UTC')::date));

-- Unique partial expression index
CREATE UNIQUE INDEX name ON users (LOWER(email)) WHERE is_active;`,
  examples: [
    { label: 'Basic', title: 'A partial index for pending orders',
      sql: `CREATE INDEX idx_orders_pending     ON orders (order_date) WHERE status = 'pending';
CREATE INDEX idx_orders_status_full ON orders (status, order_date);

SELECT indexrelname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size,
       pg_relation_size(indexrelid) / 8192          AS pages
FROM pg_stat_user_indexes WHERE relname = 'orders';

-- Query implies the predicate: partial index used
EXPLAIN SELECT id, order_date FROM orders
WHERE status = 'pending' AND order_date < '2024-03-01';

-- Different status: partial index is NOT applicable
EXPLAIN SELECT id FROM orders
WHERE status = 'paid' AND order_date < '2024-03-01';`,
      explain: `<p>The partial index is <strong>8x smaller</strong> (4 pages vs 25) because only 415 pending rows are indexed. For the pending query the planner proves <code>status = 'pending'</code> matches the index predicate and uses it; note the Index Cond contains only <code>order_date</code> &mdash; the status test is implied by the index itself.</p>
<p>For <code>status = 'paid'</code> the partial index cannot be used (it doesn't contain paid rows), so the planner falls back to the full composite index.</p>`,
      output: ` indexrelname           | size   | pages
------------------------+--------+-------
 orders_pkey            | 240 kB |    30
 idx_orders_pending     | 32 kB  |     4
 idx_orders_status_full | 200 kB |    25

 Bitmap Heap Scan on orders  (cost=4.57..75.57 rows=38 width=16)
   Recheck Cond: ((order_date < '2024-03-01 00:00:00+05'::timestamp with time zone) AND (status = 'pending'::text))
   ->  Bitmap Index Scan on idx_orders_pending  (cost=0.00..4.56 rows=38 width=0)
         Index Cond: (order_date < '2024-03-01 00:00:00+05'::timestamp with time zone)

 Bitmap Heap Scan on orders  (cost=5.05..95.48 rows=75 width=8)
   Recheck Cond: ((status = 'paid'::text) AND (order_date < '2024-03-01 00:00:00+05'::timestamp with time zone))
   ->  Bitmap Index Scan on idx_orders_status_full  (cost=0.00..5.03 rows=75 width=0)
         Index Cond: ((status = 'paid'::text) AND (order_date < '2024-03-01 00:00:00+05'::timestamp with time zone))`,
      run: true },
    { label: 'Intermediate', title: 'LOWER(email): expression index before and after',
      sql: `-- Before: the unique index on email cannot serve lower(email)
EXPLAIN ANALYZE
SELECT id, name FROM customers WHERE LOWER(email) = 'customer42@example.com';

CREATE INDEX idx_customers_lower_email ON customers (LOWER(email));
ANALYZE customers;   -- collects statistics for the expression

EXPLAIN ANALYZE
SELECT id, name FROM customers WHERE LOWER(email) = 'customer42@example.com';`,
      explain: `<p><strong>Before:</strong> Seq Scan, 499 rows removed by filter. The existing <code>customers_email_key</code> indexes raw <code>email</code>, not <code>lower(email)</code>, so it's useless here. The estimate <code>rows=2</code> is a blind guess (0.5% of 500) because no statistics exist for the expression.</p>
<p><strong>After:</strong> <code>Index Scan using idx_customers_lower_email</code> with <code>Index Cond: (lower(email) = ...)</code>; 3 buffers, ~ 0.1 ms. After <code>ANALYZE</code> the planner knows the expression is unique (<code>rows=1</code>).</p>`,
      output: `-- BEFORE
 Seq Scan on customers  (cost=0.00..14.50 rows=2 width=16) (actual time=0.508..1.236 rows=1.00 loops=1)
   Filter: (lower(email) = 'customer42@example.com'::text)
   Rows Removed by Filter: 499
   Buffers: shared hit=7
 Execution Time: 1.356 ms

-- AFTER
 Index Scan using idx_customers_lower_email on customers  (cost=0.27..8.29 rows=1 width=16) (actual time=0.048..0.052 rows=1.00 loops=1)
   Index Cond: (lower(email) = 'customer42@example.com'::text)
   Index Searches: 1
   Buffers: shared hit=1 read=2
 Execution Time: 0.096 ms`,
      run: true },
    { label: 'Advanced', title: 'IMMUTABLE expressions and a case-insensitive unique rule',
      sql: `-- (1) order_date::date depends on the session TimeZone -> not IMMUTABLE:
--     CREATE INDEX ON orders ((order_date::date));
--     ERROR: functions in index expression must be marked IMMUTABLE
-- Fix: pin the time zone so the expression is deterministic
CREATE INDEX idx_orders_day_utc ON orders (((order_date AT TIME ZONE 'UTC')::date));
ANALYZE orders;
EXPLAIN SELECT id FROM orders
WHERE (order_date AT TIME ZONE 'UTC')::date = '2025-03-15';

-- (2) One account per email, ignoring case
CREATE UNIQUE INDEX uq_users_email_ci ON users (LOWER(email));
DO $$
BEGIN
  INSERT INTO users (username, email, password_hash, role, tenant_id)
  VALUES ('dup', 'USER1@tenant2.com', 'x', 'viewer', 2);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'blocked: %', SQLERRM;
END $$;`,
      explain: `<p><strong>(1)</strong> <code>timestamptz::date</code> means "the date in the <em>current session's</em> time zone", so the same row could produce different keys for different sessions &mdash; PostgreSQL refuses to index it. <code>AT TIME ZONE 'UTC'</code> with a constant zone is immutable. The query must repeat <em>exactly</em> the same expression to match the index.</p>
<p><strong>(2)</strong> <code>user1@tenant2.com</code> already exists; inserting <code>USER1@tenant2.com</code> would pass a plain <code>UNIQUE(email)</code> but violates the unique expression index. The DO block catches the error so you can see the message without aborting.</p>`,
      output: ` Bitmap Heap Scan on orders  (cost=4.34..26.57 rows=7 width=8)
   Recheck Cond: (((order_date AT TIME ZONE 'UTC'::text))::date = '2025-03-15'::date)
   ->  Bitmap Index Scan on idx_orders_day_utc  (cost=0.00..4.33 rows=7 width=0)
         Index Cond: (((order_date AT TIME ZONE 'UTC'::text))::date = '2025-03-15'::date)

CREATE INDEX
NOTICE:  blocked: duplicate key value violates unique constraint "uq_users_email_ci"
DO`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Function on the column, no matching index: full scan every login
EXPLAIN ANALYZE
SELECT id, name FROM customers
WHERE LOWER(email) = 'customer42@example.com';
-- Seq Scan, Rows Removed by Filter: 499`,
      why: 'The only index is on raw email. lower(email) must be computed for every row and compared. On 20M users this is a multi-second login query that also burns CPU on every core under load.', run: true },
    good: { sql: `CREATE INDEX idx_customers_lower_email ON customers (LOWER(email));
ANALYZE customers;
EXPLAIN ANALYZE
SELECT id, name FROM customers
WHERE LOWER(email) = 'customer42@example.com';
-- Index Scan using idx_customers_lower_email, ~0.1 ms`,
      why: 'The index stores lower(email) values in sorted order, so the identical expression in the WHERE clause becomes an index condition. Make it UNIQUE to also enforce case-insensitive uniqueness.', run: true }
  },
  mistakes: [
    `Writing a query that does not <em>literally</em> imply the partial predicate (e.g. index <code>WHERE is_active</code> but query <code>WHERE is_active IS NOT FALSE</code>), so the index is silently unused.`,
    `Relying on partial indexes from prepared statements with a parameter in the predicate column (<code>status = $1</code>): generic plans cannot use them.`,
    `Indexing <code>LOWER(email)</code> but querying <code>email ILIKE ...</code> or <code>UPPER(email) = ...</code>. The expression must match exactly.`,
    `Trying to index <code>created_at::date</code> on a <code>timestamptz</code> column, hitting the IMMUTABLE error, then "fixing" it by wrapping in a user function falsely marked IMMUTABLE &mdash; this produces wrong results when the time zone changes.`,
    `Forgetting to <code>ANALYZE</code> after creating an expression index, leaving the planner with default selectivity guesses for the expression.`,
    `Creating a UNIQUE partial index on data that already violates it (e.g. "one pending order per customer" when customers already have 5 pending orders): the build fails with "could not create unique index".`
  ],
  best: [
    `Use partial indexes for hot subsets: queues (<code>WHERE processed = false</code>), soft deletes (<code>WHERE deleted_at IS NULL</code>), active rows.`,
    `Copy the partial predicate verbatim into application queries; add a comment linking query and index.`,
    `For case-insensitive identifiers choose one strategy: <code>LOWER()</code> expression index, the <code>citext</code> extension type, or a nondeterministic ICU collation &mdash; and use it consistently.`,
    `Keep index expressions cheap and genuinely immutable; never mark a function IMMUTABLE unless it truly is.`,
    `Combine both: <code>UNIQUE ... (LOWER(email)) WHERE deleted_at IS NULL</code> allows re-registration after soft delete while preventing duplicates among live accounts.`
  ],
  performance: `
<p>Partial indexes reduce size roughly in proportion to the fraction of rows indexed (8% of orders &rarr; 8x smaller here) and remove index maintenance for rows outside the predicate &mdash; but an UPDATE that moves a row <em>into or out of</em> the predicate still touches the index and prevents HOT. Expression indexes cost one expression evaluation per write; <code>lower()</code> is negligible, a regex or <code>jsonb</code> path on a large document is not. Both kinds are fully usable for Index Only Scans only if every column the query needs is available from the index (expression-only indexes often still need heap access).</p>`,
  security: `
<p>Functions used in expression indexes are executed during INSERT/UPDATE, VACUUM, ANALYZE and REINDEX, which may run as a different user (e.g. a maintenance role, or the table owner during autovacuum). Since PG15/16, maintenance operations run expression functions with a safe <code>search_path</code>; schema-qualify any user-defined functions in index expressions and keep them <code>IMMUTABLE</code> and side-effect free. Case-insensitive unique indexes on emails also prevent account-takeover tricks that rely on registering <code>Admin@x.com</code> next to <code>admin@x.com</code>.</p>`,
  scenario: {
    title: 'Background job table grows to 300M rows and workers slow down',
    steps: [
      '1. Workers poll WHERE status = \'pending\' ORDER BY run_at LIMIT 100; latency rose from 2 ms to 400 ms over months.',
      '2. EXPLAIN (ANALYZE, BUFFERS): Index Scan on (status, run_at) but thousands of dead index entries for recently completed jobs are visited.',
      '3. The full index is 9 GB; 99.99% of entries are for completed jobs that are never queried.',
      '4. CREATE INDEX CONCURRENTLY idx_jobs_pending ON jobs (run_at) WHERE status = \'pending\';',
      '5. Verify the worker query (status literal, not a parameter) uses it: 4 buffers, 0.2 ms.',
      '6. DROP INDEX CONCURRENTLY the old (status, run_at) index after confirming idx_scan stays at 0 for a week.',
      '7. Tune autovacuum on jobs (lower autovacuum_vacuum_scale_factor) so dead pending entries are cleaned quickly.'
    ]
  },
  widgets: ['lab:index'],
  interview: [
    { q: 'When can the planner use a partial index?',
      a: 'Only when it can prove at plan time that the query\'s WHERE clause implies the index predicate, using simple logical rules on the expressions and operators. A literal status = \'pending\' implies an index predicate status = \'pending\'; a parameter $1 in a generic plan does not, and neither does a semantically equivalent but differently written condition the prover doesn\'t understand.' },
    { q: 'Why does CREATE INDEX ON orders ((order_date::date)) fail when order_date is timestamptz?',
      a: 'Casting timestamptz to date depends on the session TimeZone setting, so the function is STABLE, not IMMUTABLE. Index entries must be deterministic, so PostgreSQL rejects it. Use (order_date AT TIME ZONE \'UTC\')::date, which is immutable, or store a separate date column.' },
    { q: 'How would you enforce case-insensitive unique usernames?',
      a: 'CREATE UNIQUE INDEX ON users (lower(username)); optionally WHERE deleted_at IS NULL to allow reuse after soft delete. Alternatives are the citext extension type with a normal UNIQUE constraint, or a nondeterministic ICU collation. Queries must then use lower(username) = lower($1) to benefit from the index.' },
    { q: 'What are the trade-offs of expression indexes?',
      a: 'They make predicates on computed values sargable and get their own statistics, but the expression is evaluated on every write that touches the source columns, the query must repeat the expression exactly, functions must be immutable, and updates to the source columns cannot be HOT.' }
  ],
  exercises: [
    { task: 'Create a partial index on employees(salary) for active employees only, and use EXPLAIN with enable_seqscan off to prove a query on active high earners can use it (the table is tiny, so the planner prefers a seq scan otherwise).',
      solution: `CREATE INDEX idx_employees_active_salary ON employees (salary) WHERE is_active;
SET enable_seqscan = off;
EXPLAIN SELECT first_name, salary FROM employees
WHERE is_active AND salary > 150000;
RESET enable_seqscan;`, run: true },
    { task: 'Create an expression index for case-insensitive product name search on products, and show EXPLAIN for lower(name) = \'...\' using one real product name.',
      solution: `CREATE INDEX idx_products_lower_name ON products (LOWER(name));
ANALYZE products;
SET enable_seqscan = off;
EXPLAIN SELECT id, name FROM products
WHERE LOWER(name) = (SELECT LOWER(name) FROM products WHERE id = 1);
RESET enable_seqscan;`, run: true }
  ],
  challenge: {
    task: 'Business rule: a customer may have at most ONE order in status \'pending\'. Show why a unique partial index cannot be created on current data, list the offending customers, and then create the index on a cleaned copy of the data (a new table) to prove it enforces the rule.',
    hint: 'GROUP BY customer_id HAVING count(*) > 1 among pending orders. For the copy, keep one pending order per customer using DISTINCT ON.',
    solution: `-- Offenders (current data violates the rule)
SELECT customer_id, count(*) AS pending_orders
FROM orders WHERE status = 'pending'
GROUP BY customer_id HAVING count(*) > 1
ORDER BY pending_orders DESC, customer_id
LIMIT 5;

-- Clean copy: keep only the newest pending order per customer
CREATE TABLE orders_clean AS
SELECT * FROM orders WHERE status <> 'pending'
UNION ALL
SELECT DISTINCT ON (customer_id) * FROM orders
WHERE status = 'pending' ORDER BY customer_id, order_date DESC;

CREATE UNIQUE INDEX uq_one_pending_per_customer
  ON orders_clean (customer_id) WHERE status = 'pending';

-- Now a second pending order for the same customer is rejected
DO $$
DECLARE c int;
BEGIN
  SELECT customer_id INTO c FROM orders_clean WHERE status = 'pending' LIMIT 1;
  INSERT INTO orders_clean (id, customer_id, status, order_date, total_amount)
  VALUES (999999, c, 'pending', now(), 10);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'rule enforced: %', SQLERRM;
END $$;`,
    run: true
  },
  related: ['indexes-composite', 'indexes-unique-covering', 'query-optimization-rewriting', 'full-text-search', 'jsonb'],
  quiz: [
    { type: 'predict', q: 'Index: CREATE INDEX i ON orders (order_date) WHERE status = \'pending\'. Can this query use it?',
      code: `SELECT * FROM orders WHERE status IN ('pending','paid') AND order_date > now() - interval '1 day';`,
      options: ['Yes, pending is in the IN list', 'No, the query does not imply status = \'pending\'', 'Yes, but only as an Index Only Scan', 'Only after ANALYZE'],
      answer: 1, explain: 'The query also wants paid rows, which are not in the index. The WHERE clause must imply the index predicate.' },
    { type: 'bug', q: 'Why is the expression index never used?',
      code: `CREATE INDEX idx_u ON users (lower(email));
SELECT * FROM users WHERE email ILIKE 'Ajit@Rodic.com';`,
      options: ['ILIKE is not the same expression as lower(email) = ...', 'Expression indexes need INCLUDE', 'lower() is not immutable', 'Need ANALYZE first'],
      answer: 0, explain: 'The planner matches index expressions syntactically. Rewrite as lower(email) = lower($1).' },
    { type: 'tf', q: 'CREATE INDEX ON orders ((order_date::date)) works when order_date is timestamptz.',
      answer: false, explain: 'The cast depends on TimeZone (STABLE), so it fails with "functions in index expression must be marked IMMUTABLE".' },
    { type: 'design', q: 'Soft-delete table: users(deleted_at timestamptz NULL). You need unique emails among live users only. Best option?',
      options: ['UNIQUE (email)', 'CREATE UNIQUE INDEX ON users (lower(email)) WHERE deleted_at IS NULL', 'CHECK (deleted_at IS NULL)', 'A trigger that searches for duplicates'],
      answer: 1, explain: 'Unique partial expression index: case-insensitive uniqueness among live rows, deleted rows ignored, race-free.' },
    { type: 'mcq', q: 'Main benefit of a partial index on a queue table WHERE status = \'pending\'?',
      options: ['It speeds up all queries on the table', 'It stays tiny and cached because only pending rows are indexed', 'It avoids MVCC', 'It replaces VACUUM'],
      answer: 1, explain: 'Only the small hot subset is indexed, so it is small, cheap to maintain and stays in memory.' }
  ]
},

{
  id: 'indexes-unique-covering',
  module: 'indexes',
  title: 'Unique and Covering Indexes (INCLUDE) and Index-Only Scans',
  level: 3,
  minutes: 24,
  summary: 'Enforce uniqueness correctly (including NULL semantics), build covering indexes with INCLUDE, and understand why Index Only Scans depend on VACUUM and the visibility map.',
  objectives: [
    'Explain the relationship between UNIQUE constraints, primary keys and unique indexes',
    'Handle NULLs in unique indexes with NULLS NOT DISTINCT (PG15+)',
    'Create covering indexes with INCLUDE and know how INCLUDE columns differ from key columns',
    'Produce an Index Only Scan and read Heap Fetches in EXPLAIN ANALYZE',
    'Explain the visibility map and why VACUUM is required for Index Only Scans',
    'Decide when a covering index is worth its extra size'
  ],
  concept: `
<p><strong>Unique index analogy:</strong> a hotel's key-card system refuses to issue a second card for a room that is already occupied. A <strong>unique index</strong> is a B-tree that, during insertion, checks whether an equal live key already exists and raises <code>unique_violation</code> if so. <code>PRIMARY KEY</code> and <code>UNIQUE</code> constraints are implemented by a unique index (you'll see <code>customers_email_key</code> in <code>pg_indexes</code>). Prefer declaring a <em>constraint</em> when the rule is a plain column uniqueness (it can be referenced by foreign keys and shows in information_schema); use <code>CREATE UNIQUE INDEX</code> when you need expressions or a <code>WHERE</code> clause.</p>
<p><strong>NULLs:</strong> by SQL standard default, NULLs are <em>distinct</em> from each other, so a unique column can hold many NULLs. PostgreSQL 15 added <code>NULLS NOT DISTINCT</code> to treat NULLs as equal (only one allowed).</p>
<p><strong>Covering index analogy:</strong> a library catalogue card that shows not only the shelf location but also the book's publication year and page count. If those are all you need, you never walk to the shelf. A <strong>covering index</strong> contains every column a query needs, so PostgreSQL can answer from the index alone: an <strong>Index Only Scan</strong>.</p>
<p><code>CREATE INDEX idx_orders_cust_cover ON orders (customer_id) INCLUDE (order_date, total_amount);</code></p>
<p><code>INCLUDE</code> columns (PG11+) are stored only in leaf entries as payload: they are not part of the search key, not used for ordering, don't count for uniqueness, and don't bloat the upper levels of the tree. That makes <code>UNIQUE (sku) INCLUDE (name, price)</code> possible: uniqueness on <code>sku</code> only, with <code>name</code> and <code>price</code> available for index-only lookups.</p>
<p><strong>The catch &mdash; visibility.</strong> Index entries carry no MVCC visibility information. An Index Only Scan can skip the heap only for pages marked <em>all-visible</em> in the <strong>visibility map</strong> (2 bits per heap page, maintained by VACUUM). For any page not all-visible, PostgreSQL must still fetch the heap tuple &mdash; counted as <code>Heap Fetches</code> in EXPLAIN ANALYZE. Freshly loaded or heavily updated tables therefore get little benefit until VACUUM (or autovacuum) has run.</p>`,
  why: `
<p>Uniqueness is a data-integrity rule; enforcing it in application code is racy (two requests check "not exists" simultaneously and both insert). Only a unique index makes it atomic.</p>
<p>Covering indexes exist because heap access is often the expensive part of an index scan: for each matching entry, a random read of a heap page. For hot, narrow queries (lookups returning a few columns, counts, existence checks, list pages) an Index Only Scan reads a few contiguous index pages and nothing else, which can be 5&ndash;50x faster on cold data and dramatically reduces buffer cache pressure.</p>`,
  useCase: `
<p><strong>Product price lookups at checkout:</strong> a retailer's cart service calls <code>SELECT sku, name, price FROM products WHERE sku = ANY($1)</code> 20,000 times per second. <code>CREATE UNIQUE INDEX ON products (sku) INCLUDE (name, price)</code> serves it entirely from a ~ 300 MB index that lives in RAM, while the 40 GB products heap (with large descriptions and JSON attributes) stays mostly on disk.</p>
<p><strong>Dashboard counters:</strong> <code>SELECT count(*) FROM orders WHERE customer_id = $1</code> becomes an Index Only Scan on <code>(customer_id)</code> after VACUUM, never touching the wide orders rows.</p>`,
  internals: `
<p><strong>Uniqueness check:</strong> on insert, the B-tree finds where the key belongs and checks neighbouring entries with the same key. For each, it checks the heap tuple's visibility: a dead version doesn't conflict; a version being inserted/deleted by an in-progress transaction makes the inserter <em>wait</em> for that transaction to finish. That's why concurrent inserts of the same key block rather than both succeeding.</p>
<p><strong>Visibility map (VM):</strong> a separate fork (<code>_vm</code>) with bits <em>all-visible</em> and <em>all-frozen</em> per heap page. VACUUM sets all-visible when every tuple on the page is visible to all transactions. Any INSERT/UPDATE/DELETE on the page clears the bit. <code>pg_class.relallvisible</code> records how many pages were all-visible at the last VACUUM/ANALYZE, and the planner uses <code>relallvisible / relpages</code> to cost Index Only Scans &mdash; with 0 all-visible pages it usually won't even choose one.</p>
<p><strong>INCLUDE storage:</strong> INCLUDE columns are stored in leaf tuples only; internal pages hold truncated "pivot" tuples with key columns only (suffix truncation). Supported by B-tree, GiST and SP-GiST (PG14+ for SP-GiST); not by GIN, BRIN or hash.</p>`,
  whenNot: `
<ul>
  <li>Don't build covering indexes for queries that select many or wide columns; you are duplicating the table. Use them for narrow, hot queries.</li>
  <li>Tables with constant updates on most pages (hot counters, queues) rarely have all-visible pages, so Index Only Scans degrade to Index Scans with heap fetches &mdash; the extra INCLUDE width is wasted.</li>
  <li>Don't INCLUDE columns that are updated frequently: every update to an INCLUDE column must update the index and blocks HOT.</li>
  <li>Don't use a unique index where a constraint is needed for a foreign key target or <code>ON CONFLICT ON CONSTRAINT</code>; declare the constraint (it creates the index for you). <code>ON CONFLICT (cols)</code> works with either.</li>
</ul>`,
  syntax: `-- Constraint form (creates a unique B-tree index)
ALTER TABLE t ADD CONSTRAINT t_code_key UNIQUE (code);
ALTER TABLE t ADD CONSTRAINT t_code_key UNIQUE NULLS NOT DISTINCT (code);   -- PG15+

-- Index form: expressions, partial, INCLUDE
CREATE UNIQUE INDEX name ON t (code) [ NULLS [NOT] DISTINCT ] [ INCLUDE (c1, c2) ] [ WHERE ... ];

-- Covering (non-unique)
CREATE INDEX name ON t (key_col [, ...]) INCLUDE (payload_col [, ...]);

-- Turn an existing unique index into a constraint (no rebuild)
ALTER TABLE t ADD CONSTRAINT t_code_key UNIQUE USING INDEX name;`,
  examples: [
    { label: 'Basic', title: 'Unique index and NULL semantics',
      sql: `CREATE TABLE coupons (id int GENERATED ALWAYS AS IDENTITY, code text, customer_id int);
CREATE UNIQUE INDEX uq_coupons_code ON coupons (code);
-- Default: NULLs are distinct -> two NULL codes are allowed
INSERT INTO coupons (code, customer_id) VALUES (NULL, 1), (NULL, 2);
SELECT count(*) AS rows_with_null_code FROM coupons;

CREATE TABLE coupons2 (id int GENERATED ALWAYS AS IDENTITY, code text, customer_id int);
CREATE UNIQUE INDEX uq_coupons2_code ON coupons2 (code) NULLS NOT DISTINCT;
DO $$
BEGIN
  INSERT INTO coupons2 (code, customer_id) VALUES (NULL, 1), (NULL, 2);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'second NULL rejected: %', SQLERRM;
END $$;`,
      explain: `<p>With the default <code>NULLS DISTINCT</code>, each NULL is "unknown" and therefore not equal to another NULL, so both rows are accepted &mdash; often surprising for "optional but unique" columns. With <code>NULLS NOT DISTINCT</code> (PG15+), NULLs compare equal and the second one violates the index.</p>`,
      output: ` rows_with_null_code
---------------------
                   2

NOTICE:  second NULL rejected: duplicate key value violates unique constraint "uq_coupons2_code"
DO`,
      run: true },
    { label: 'Intermediate', title: 'Covering index: Index Only Scan needs VACUUM',
      sql: `CREATE INDEX idx_orders_cust_cover ON orders (customer_id)
  INCLUDE (order_date, total_amount);
ANALYZE orders;

-- Visibility map is empty (table never vacuumed): heap is still visited
EXPLAIN (ANALYZE)
SELECT customer_id, order_date, total_amount FROM orders WHERE customer_id = 42;

VACUUM orders;   -- sets all-visible bits in the visibility map

EXPLAIN (ANALYZE)
SELECT customer_id, order_date, total_amount FROM orders WHERE customer_id = 42;`,
      explain: `<p>Before VACUUM, <code>relallvisible = 0</code>, so the planner doesn't even consider an Index Only Scan and uses a bitmap scan touching 8 heap pages.</p>
<p>After VACUUM all 89 pages are all-visible: <strong>Index Only Scan</strong>, <code>Heap Fetches: 0</code>, 3 buffers in total, and the cost drops from 31.88 to 4.44. Every column the query needs (<code>customer_id</code> as key, <code>order_date</code> and <code>total_amount</code> as INCLUDE payload) is in the index.</p>`,
      output: `-- BEFORE VACUUM
 Bitmap Heap Scan on orders  (cost=4.35..31.88 rows=9 width=20) (actual time=0.788..0.862 rows=10.00 loops=1)
   Recheck Cond: (customer_id = 42)
   Heap Blocks: exact=8
   Buffers: shared hit=8 read=2
   ->  Bitmap Index Scan on idx_orders_cust_cover  (cost=0.00..4.35 rows=9 width=0) (actual time=0.415..0.416 rows=10.00 loops=1)
         Index Cond: (customer_id = 42)
 Execution Time: 1.416 ms

VACUUM

-- AFTER VACUUM
 Index Only Scan using idx_orders_cust_cover on orders  (cost=0.28..4.44 rows=9 width=20) (actual time=0.195..0.205 rows=10.00 loops=1)
   Index Cond: (customer_id = 42)
   Heap Fetches: 0
   Index Searches: 1
   Buffers: shared hit=3
 Execution Time: 0.336 ms`,
      run: true },
    { label: 'Advanced', title: 'Watch the visibility map change with pg_visibility',
      sql: `-- pg_visibility is an extension shipped with PostgreSQL contrib
CREATE EXTENSION IF NOT EXISTS pg_visibility;

SELECT all_visible, count(*) AS pages FROM pg_visibility_map('orders') GROUP BY 1;
VACUUM orders;
SELECT all_visible, count(*) AS pages FROM pg_visibility_map('orders') GROUP BY 1;
SELECT relpages, relallvisible FROM pg_class WHERE relname = 'orders';

-- Any write clears the bit for the touched pages
UPDATE orders SET status = 'shipped' WHERE id BETWEEN 1 AND 50 AND status = 'paid';
SELECT all_visible, count(*) AS pages FROM pg_visibility_map('orders') GROUP BY 1;`,
      explain: `<p>Initially no page is all-visible. After VACUUM all 89 are, and <code>pg_class.relallvisible</code> records it for the planner. Updating 10 rows touches 3 heap pages (the old versions' pages and the page receiving new versions); their bits are cleared, so Index Only Scans touching those pages will need heap fetches until the next VACUUM.</p>
<p>On a busy OLTP table the fraction of all-visible pages depends on how aggressively autovacuum runs relative to the write rate &mdash; monitor <code>Heap Fetches</code> on your critical index-only queries.</p>`,
      output: ` all_visible | pages
-------------+-------
 f           |    89

VACUUM

 all_visible | pages
-------------+-------
 t           |    89

 relpages | relallvisible
----------+---------------
       89 |            89

UPDATE 10

 all_visible | pages
-------------+-------
 f           |     3
 t           |    86`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Index on the key only: every match needs a heap visit
CREATE INDEX idx_orders_customer_id ON orders (customer_id);
VACUUM orders;
EXPLAIN (ANALYZE)
SELECT customer_id, order_date, total_amount FROM orders WHERE customer_id = 42;
-- Bitmap Heap Scan: Heap Blocks: exact=8`,
      why: 'order_date and total_amount are not in the index, so PostgreSQL must read the heap page of each of the 10 rows (8 different pages). On cold storage that is up to 8 random reads per call.', run: true },
    good: { sql: `CREATE INDEX idx_orders_cust_cover ON orders (customer_id)
  INCLUDE (order_date, total_amount);
VACUUM orders;
EXPLAIN (ANALYZE)
SELECT customer_id, order_date, total_amount FROM orders WHERE customer_id = 42;
-- Index Only Scan, Heap Fetches: 0, Buffers: shared hit=3`,
      why: 'All needed columns live in the index leaf entries, and VACUUM has marked pages all-visible, so the heap is skipped entirely. INCLUDE keeps the payload out of the search key, so uniqueness and tree upper levels are unaffected.', run: true }
  },
  mistakes: [
    `Expecting Index Only Scans on a table that is never vacuumed (bulk-loaded data, autovacuum disabled, or constantly updated pages): <code>Heap Fetches</code> stays high.`,
    `Making a column "optional but unique" without realising multiple NULLs are allowed; use <code>NULLS NOT DISTINCT</code> if only one NULL may exist.`,
    `Adding payload columns as key columns (<code>UNIQUE (sku, name, price)</code>), which silently changes the uniqueness rule to the combination of all three.`,
    `Enforcing uniqueness with "SELECT then INSERT" in application code; under concurrency both transactions insert. Only a unique index is race-free.`,
    `Covering wide or frequently updated columns, doubling write amplification for a small read gain.`
  ],
  best: [
    `Declare business uniqueness as constraints (<code>UNIQUE</code>, <code>PRIMARY KEY</code>); use unique <em>indexes</em> for expression/partial rules.`,
    `Use <code>INCLUDE</code> for a few small, rarely-updated columns needed by a hot query; keep the key minimal.`,
    `Check <code>Heap Fetches</code> in EXPLAIN ANALYZE and tune autovacuum for tables relying on index-only scans.`,
    `Build unique indexes with <code>CREATE UNIQUE INDEX CONCURRENTLY</code>, then attach with <code>ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX</code> for zero-downtime constraint creation.`,
    `Use <code>INSERT ... ON CONFLICT (col) DO NOTHING/UPDATE</code> on top of unique indexes for idempotent writes.`
  ],
  performance: `
<p>Index Only Scan cost &asymp; index pages read + heap pages for the not-all-visible fraction. On our table it dropped from 10 buffers to 3. On a 500 GB table where the queried rows are scattered, it can turn thousands of random heap reads into a handful of sequential index-page reads. The price: wider leaf entries (more index pages, more cache), more WAL, and no HOT updates when INCLUDE columns change. Unique checks add a tiny cost to inserts (one extra neighbour comparison) and can make concurrent inserts of the same key wait for each other.</p>`,
  security: `
<p>Unique indexes are a security control: they prevent duplicate accounts, duplicate payment idempotency keys and replayed tokens. Covering indexes duplicate data: if you INCLUDE sensitive columns (emails, phone numbers), they also live in the index files, WAL and backups &mdash; apply the same encryption and retention as for the table.</p>`,
  scenario: {
    title: 'Count queries on a dashboard regress after a bulk import',
    steps: [
      '1. After importing 30M historical orders, the dashboard\'s count(*) WHERE customer_id = $1 went from 1 ms to 120 ms.',
      '2. EXPLAIN (ANALYZE, BUFFERS): Index Only Scan ... Heap Fetches: 18,450, shared read=9,800.',
      '3. Check the visibility map: SELECT relallvisible, relpages FROM pg_class WHERE relname = \'orders\' shows 5% all-visible.',
      '4. The imported pages were never vacuumed (insert-only workloads only trigger autovacuum via autovacuum_vacuum_insert_threshold, PG13+).',
      '5. Run VACUUM (ANALYZE) orders; heap fetches drop to 0, latency back to 1 ms.',
      '6. Prevent recurrence: run VACUUM ANALYZE as the last step of every bulk import job and lower autovacuum_vacuum_insert_scale_factor for the table.'
    ]
  },
  widgets: ['lab:index', 'diagram:btree'],
  interview: [
    { q: 'Why does an Index Only Scan sometimes still read the heap?',
      a: 'Index entries contain no MVCC visibility info. For each entry, PostgreSQL checks the visibility map; if the heap page is not marked all-visible it must fetch the heap tuple to check visibility. These are reported as Heap Fetches. VACUUM sets the all-visible bits; any modification of the page clears them.' },
    { q: 'What is the difference between key columns and INCLUDE columns?',
      a: 'Key columns define the sort order, are searchable, participate in uniqueness and are stored in all tree levels. INCLUDE columns are non-key payload stored only in leaf tuples: not searchable as index conditions, no effect on uniqueness or order, but available to satisfy an Index Only Scan.' },
    { q: 'How are NULLs handled in unique indexes?',
      a: 'By default NULLs are distinct, so any number of rows can have NULL in a unique column. Since PostgreSQL 15 you can specify NULLS NOT DISTINCT on the constraint or index so that NULLs are considered equal and only one is allowed.' },
    { q: 'How do you add a unique constraint to a large production table without blocking writes?',
      a: 'CREATE UNIQUE INDEX CONCURRENTLY idx ON t (col); verify it is valid in pg_index; then ALTER TABLE t ADD CONSTRAINT t_col_key UNIQUE USING INDEX idx, which only takes a brief lock because the index already exists.' }
  ],
  exercises: [
    { task: 'Create a unique covering index on products(sku) including name and price, VACUUM the table, and show that a lookup by SKU is an Index Only Scan.',
      solution: `CREATE UNIQUE INDEX uq_products_sku_cover ON products (sku) INCLUDE (name, price);
VACUUM products;
EXPLAIN SELECT sku, name, price FROM products WHERE sku = 'SKU-0042';`, run: true },
    { task: 'Show that INCLUDE columns do not participate in uniqueness: with UNIQUE (code) INCLUDE (note), inserting the same code with a different note must fail.',
      solution: `CREATE TABLE inc_demo (code text, note text);
CREATE UNIQUE INDEX uq_inc_demo ON inc_demo (code) INCLUDE (note);
INSERT INTO inc_demo VALUES ('A1', 'first');
DO $$
BEGIN
  INSERT INTO inc_demo VALUES ('A1', 'different note');
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'still a duplicate: %', SQLERRM;
END $$;`, run: true }
  ],
  challenge: {
    task: 'Make "count orders per customer for customers 1-50" an Index Only Scan. Show the plan before VACUUM, then after VACUUM, and report relallvisible for orders after each step.',
    hint: 'Index on orders(customer_id). count(*) needs no other column. Query pg_class.relallvisible.',
    solution: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
SELECT relallvisible FROM pg_class WHERE relname = 'orders';
EXPLAIN SELECT customer_id, count(*) FROM orders WHERE customer_id <= 50 GROUP BY customer_id;
VACUUM orders;
SELECT relallvisible FROM pg_class WHERE relname = 'orders';
EXPLAIN SELECT customer_id, count(*) FROM orders WHERE customer_id <= 50 GROUP BY customer_id;`,
    run: true
  },
  related: ['indexes-partial-expression', 'query-optimization-scan-types', 'vacuum', 'mvcc', 'constraints'],
  quiz: [
    { type: 'mcq', q: 'What does Heap Fetches: 120 in an Index Only Scan mean?',
      options: ['120 index pages were read', '120 tuples had to be checked in the heap because their pages were not all-visible', '120 rows were returned', 'The index is corrupt'],
      answer: 1, explain: 'Heap fetches happen for entries on pages not marked all-visible in the visibility map.' },
    { type: 'tf', q: 'A UNIQUE column in PostgreSQL allows multiple NULLs by default.',
      answer: true, explain: 'NULLS DISTINCT is the default. Use NULLS NOT DISTINCT (PG15+) to allow only one.' },
    { type: 'predict', q: 'UNIQUE INDEX ON t (code) INCLUDE (note). Rows: (\'X\', \'a\'). What happens?',
      code: `INSERT INTO t (code, note) VALUES ('X', 'b');`,
      options: ['Succeeds: (X,b) differs from (X,a)', 'Fails with unique_violation: only code is the key', 'Succeeds but replaces the old row', 'Error: INCLUDE not allowed on unique indexes'],
      answer: 1, explain: 'INCLUDE columns are not part of the uniqueness check.' },
    { type: 'scenario', q: 'An Index Only Scan shows huge Heap Fetches right after a nightly bulk load. Best fix?',
      options: ['REINDEX the index', 'Run VACUUM (ANALYZE) after the load', 'Increase work_mem', 'Add more INCLUDE columns'],
      answer: 1, explain: 'New pages are not all-visible until VACUUM sets visibility-map bits.' },
    { type: 'index', q: 'Hot query: SELECT price FROM products WHERE sku = $1 (sku unique). Best index?',
      options: ['UNIQUE (sku, price)', 'UNIQUE (sku) INCLUDE (price)', '(price) INCLUDE (sku)', 'Hash index on price'],
      answer: 1, explain: 'Key = sku (uniqueness preserved), price as payload for index-only scans.' }
  ]
},

/* =====================================================================
   MODULE: advanced-indexing
   ===================================================================== */
{
  id: 'advanced-indexing-gin',
  module: 'advanced-indexing',
  title: 'GIN Indexes: JSONB, Arrays, Full-Text Search and pg_trgm',
  level: 3,
  minutes: 28,
  summary: 'Use Generalized Inverted Indexes for "contains" queries on jsonb, arrays, tsvector and trigram text search; understand posting lists, fastupdate and the pending list.',
  objectives: [
    'Explain an inverted index with the "index at the back of a cookbook" analogy',
    'Index jsonb with jsonb_ops vs jsonb_path_ops and write queries that can use them (@>, ?, ?|, ?&)',
    'Index arrays (@>, &&, <@) and know why = ANY(array_col) is not indexable',
    'Use GIN for full-text search (@@) and pg_trgm for ILIKE \'%...%\' and similarity',
    'Explain fastupdate, the pending list, gin_pending_list_limit and gin_clean_pending_list()',
    'Weigh GIN\'s read speed against its write cost'
  ],
  concept: `
<p><strong>Analogy: the ingredient index of a cookbook.</strong> A cookbook has an index that lists each <em>ingredient</em> and every recipe that uses it: "garlic: 12, 45, 88, 102". To find recipes with garlic AND ginger, you intersect two short lists. You never read the recipes themselves. That's an <strong>inverted index</strong>: instead of "row &rarr; values" it stores "value (key) &rarr; list of rows".</p>
<p>GIN (<strong>Generalized Inverted iNdex</strong>, <span class="tag core">core</span>) applies this to <em>composite</em> values that contain many elements:</p>
<ul>
  <li><strong>Arrays</strong> &ndash; each element is a key. <code>products.tags = {office, sale}</code> creates entries <code>office &rarr; row</code>, <code>sale &rarr; row</code>. Operators: <code>@&gt;</code> (contains), <code>&lt;@</code> (is contained by), <code>&amp;&amp;</code> (overlaps), <code>=</code>.</li>
  <li><strong>jsonb</strong> &ndash; with the default <code>jsonb_ops</code>, every key and every value is a GIN key; supports <code>@&gt;</code>, <code>?</code> (key exists), <code>?|</code>, <code>?&amp;</code>, and jsonpath <code>@?</code>/<code>@@</code>. With <code>jsonb_path_ops</code>, each key is a hash of a full <em>path + value</em>; supports only <code>@&gt;</code> and jsonpath, but is smaller and faster for containment.</li>
  <li><strong>Full-text search</strong> &ndash; each lexeme in a <code>tsvector</code> is a key; <code>search @@ to_tsquery(...)</code>. company_db already has <code>idx_documents_search</code>.</li>
  <li><strong>Trigrams</strong> (<code>pg_trgm</code> <span class="tag ext">extension</span>) &ndash; each 3-character chunk of a string is a key ("Mumbai" &rarr; <code>"  m"," mu","mum","umb","mba","bai","ai "</code>). That makes <code>ILIKE '%mer 42%'</code>, regex and similarity (<code>%</code>) indexable.</li>
</ul>
<p>GIN answers "which rows contain X?" brilliantly. It cannot answer ordering questions (no <code>ORDER BY</code> support), it is not unique-capable, and it is <strong>expensive to update</strong>: inserting one product with 10 tags means 10 index insertions. GIN mitigates that with <em>fastupdate</em>: new entries go into an unsorted <strong>pending list</strong> first and are merged into the main tree in bulk later.</p>`,
  why: `
<p>Modern schemas store multi-valued data: tags, permissions, JSON attributes from different product types, documents. Queries ask "contains": products with tag <em>sale</em>, events whose payload has <code>{"type":"buy"}</code>, articles matching "index performance", customers whose name contains "kum". A B-tree indexes a <em>whole value</em> and cannot answer these. Without GIN, each such query is a sequential scan that de-toasts and parses every document.</p>`,
  useCase: `
<p><strong>Marketplace catalogue (8M products from thousands of sellers).</strong> Attributes differ per category (laptops have RAM, shoes have size), so they live in <code>attributes jsonb</code>. Filters like "brand = Acme AND color = black" are written as <code>attributes @&gt; '{"brand":"Acme","color":"black"}'</code> and served by a <code>jsonb_path_ops</code> GIN index (~ 1.1 GB) in 5&ndash;20 ms. A <code>tags text[]</code> GIN handles "sale" and "bestseller" badges, and a pg_trgm GIN on <code>name</code> powers the search box's "contains" matching with typo tolerance.</p>`,
  internals: `
<p><strong>Structure:</strong> a B-tree over the <em>keys</em> (elements). Each key points to either a short <em>posting list</em> (TIDs stored inline) or, for frequent keys, a separate <em>posting tree</em> of TIDs. Posting lists are compressed (varbyte delta encoding), which is why GIN on low-cardinality elements stays compact.</p>
<p><strong>Searching:</strong> the operator class's <code>extractQuery</code> turns the query into keys (e.g. <code>{"brand":"Acme"}</code> &rarr; key "brand", key "Acme" for jsonb_ops; one hash for jsonb_path_ops), GIN fetches each key's TIDs and combines them with the <code>consistent</code> function. Results are always a <em>bitmap</em> (GIN supports only Bitmap Index Scans) and often <em>lossy</em> &mdash; that's why plans show <code>Recheck Cond</code>: the heap tuple is re-checked with the real operator.</p>
<p><strong>fastupdate &amp; pending list:</strong> with <code>fastupdate = on</code> (default) inserts append to an unsorted pending list; searches must scan the entire pending list in addition to the tree. The list is merged when it exceeds <code>gin_pending_list_limit</code> (default 4 MB), by VACUUM/autovacuum, or by <code>gin_clean_pending_list()</code>. Trade-off: faster bursts of inserts, but occasional slow inserts (the one that triggers the merge) and slower searches while the list is long. For latency-sensitive read paths, set <code>fastupdate = off</code> on that index.</p>`,
  whenNot: `
<ul>
  <li><strong>Equality/range on a scalar extracted from JSON</strong> (<code>attributes-&gt;&gt;'brand' = 'Acme'</code>, <code>(attributes-&gt;&gt;'warranty_months')::int &gt; 12</code>): use a B-tree <em>expression</em> index on that expression, or rewrite as <code>@&gt;</code>.</li>
  <li><strong>Sorting / top-N</strong>: GIN can't provide order; combine with a B-tree or accept a sort.</li>
  <li><strong>Very write-heavy tables</strong> with large documents: each update re-indexes all keys; consider indexing only the needed keys via expression indexes.</li>
  <li><strong>Short exact lookups</strong> on a text column: a B-tree is smaller and faster than trigram GIN.</li>
  <li><strong>Fuzzy nearest-neighbour ordering</strong> (<code>ORDER BY name &lt;-&gt; 'x'</code>): pg_trgm with <strong>GiST</strong> supports distance ordering; GIN does not.</li>
</ul>`,
  syntax: `CREATE INDEX name ON t USING gin (jsonb_col);                    -- jsonb_ops: @> ? ?| ?& @? @@
CREATE INDEX name ON t USING gin (jsonb_col jsonb_path_ops);     -- @> @? @@ only, smaller
CREATE INDEX name ON t USING gin (array_col);                    -- @> <@ && =
CREATE INDEX name ON t USING gin (tsvector_col);                 -- @@
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX name ON t USING gin (text_col gin_trgm_ops);        -- LIKE/ILIKE '%x%', ~, ~*, %
CREATE INDEX name ON t USING gin (col) WITH (fastupdate = off, gin_pending_list_limit = 1024);  -- limit in kB
SELECT gin_clean_pending_list('index_name');`,
  examples: [
    { label: 'Basic', title: 'jsonb containment on products.attributes',
      sql: `CREATE INDEX idx_products_attrs ON products USING gin (attributes);

-- products has only 4 pages, so we disable seq scans to SEE the index plan
SET enable_seqscan = off;

-- Containment: indexable
EXPLAIN SELECT id, name FROM products WHERE attributes @> '{"brand":"Acme"}';

-- Extracting a scalar with ->> : NOT indexable by GIN
EXPLAIN SELECT id, name FROM products WHERE attributes ->> 'brand' = 'Acme';

-- Key existence (jsonb_ops only)
EXPLAIN SELECT id, name FROM products WHERE attributes ? 'warranty_months';

RESET enable_seqscan;`,
      explain: `<p><code>@&gt;</code> becomes a <code>Bitmap Index Scan</code> on the GIN index, followed by a <code>Recheck Cond</code> on the heap (GIN results are candidates). The <code>-&gt;&gt;</code> form produces a text value; there is no GIN operator for "extracted text equals", so even with seq scans disabled the planner must use one (note <code>Disabled: true</code> &mdash; PG18 marks plan nodes chosen despite being disabled). <code>?</code> (key exists) is supported by the default <code>jsonb_ops</code> but would not be by <code>jsonb_path_ops</code>.</p>
<p><code>SET enable_seqscan = off</code> is a <em>learning tool</em> only: on a 100-row table the seq scan really is cheaper, and normally the planner would choose it.</p>`,
      output: ` Bitmap Heap Scan on products  (cost=13.07..17.34 rows=22 width=18)
   Recheck Cond: (attributes @> '{"brand": "Acme"}'::jsonb)
   ->  Bitmap Index Scan on idx_products_attrs  (cost=0.00..13.06 rows=22 width=0)
         Index Cond: (attributes @> '{"brand": "Acme"}'::jsonb)

 Seq Scan on products  (cost=0.00..5.50 rows=1 width=18)
   Disabled: true
   Filter: ((attributes ->> 'brand'::text) = 'Acme'::text)

 Bitmap Heap Scan on products  (cost=9.02..14.15 rows=91 width=18)
   Recheck Cond: (attributes ? 'warranty_months'::text)
   ->  Bitmap Index Scan on idx_products_attrs  (cost=0.00..8.99 rows=91 width=0)
         Index Cond: (attributes ? 'warranty_months'::text)`,
      run: true },
    { label: 'Intermediate', title: 'Arrays and trigram "contains" search',
      sql: `CREATE INDEX idx_products_tags ON products USING gin (tags);
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- extension, not core
CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);

SET enable_seqscan = off;
EXPLAIN SELECT id FROM products WHERE tags @> ARRAY['sale'];              -- contains
EXPLAIN SELECT id FROM products WHERE tags && ARRAY['new','bestseller'];  -- overlaps
EXPLAIN SELECT id FROM products WHERE 'sale' = ANY(tags);                 -- not indexable!

EXPLAIN ANALYZE SELECT id, name FROM customers WHERE name ILIKE '%mer 42%';
RESET enable_seqscan;

SELECT show_trgm('Mumbai') AS trigrams;
SELECT name, round(similarity(name, 'Custmer 42')::numeric, 3) AS sim
FROM customers WHERE name % 'Custmer 42'
ORDER BY sim DESC, name LIMIT 3;`,
      explain: `<p>Array operators <code>@&gt;</code> and <code>&amp;&amp;</code> use the GIN index. <code>'sale' = ANY(tags)</code> means the same thing as <code>tags @&gt; ARRAY['sale']</code> but is a scalar comparison repeated per element, and no GIN operator class supports it: <strong>rewrite ANY to @&gt;</strong>.</p>
<p>The trigram index turns <code>ILIKE '%mer 42%'</code> (leading wildcard &mdash; impossible for a B-tree) into a lookup of trigrams like <code>"mer"</code>, <code>"er "</code>, <code>" 42"</code>; candidates are rechecked. The <code>%</code> operator returns rows whose trigram similarity exceeds <code>pg_trgm.similarity_threshold</code> (0.3): a typo-tolerant search for "Custmer 42".</p>`,
      output: ` Bitmap Heap Scan on products  (cost=8.69..13.10 rows=33 width=4)
   Recheck Cond: (tags @> '{sale}'::text[])
   ->  Bitmap Index Scan on idx_products_tags  (cost=0.00..8.68 rows=33 width=0)
         Index Cond: (tags @> '{sale}'::text[])

 Bitmap Heap Scan on products  (cost=13.19..17.89 rows=56 width=4)
   Recheck Cond: (tags && '{new,bestseller}'::text[])
   ->  Bitmap Index Scan on idx_products_tags  (cost=0.00..13.18 rows=56 width=0)
         Index Cond: (tags && '{new,bestseller}'::text[])

 Seq Scan on products  (cost=0.00..5.25 rows=33 width=4)
   Disabled: true
   Filter: ('sale'::text = ANY (tags))

 Bitmap Heap Scan on customers  (cost=21.89..29.35 rows=10 width=16) (actual time=1.764..2.014 rows=11.00 loops=1)
   Recheck Cond: (name ~~* '%mer 42%'::text)
   Heap Blocks: exact=2
   ->  Bitmap Index Scan on idx_customers_name_trgm  (cost=0.00..21.89 rows=10 width=0) (actual time=1.112..1.114 rows=11.00 loops=1)
         Index Cond: (name ~~* '%mer 42%'::text)

 trigrams
---------------------------------------------
 {"  m"," mu","ai ",bai,mba,mum,umb}

 name         | sim
--------------+-------
 Customer 42  | 0.643
 Customer 420 | 0.500
 Customer 421 | 0.500`,
      run: true },
    { label: 'Advanced', title: 'fastupdate and the pending list, observed with pageinspect',
      sql: `CREATE INDEX idx_audit_new ON audit_logs USING gin (new_data)
  WITH (fastupdate = on, gin_pending_list_limit = 512);   -- 512 kB
CREATE INDEX idx_products_tags_nofu ON products USING gin (tags)
  WITH (fastupdate = off);

SELECT relname, reloptions FROM pg_class
WHERE relname IN ('idx_audit_new', 'idx_products_tags_nofu');

-- 200 new audit rows: their keys go to the pending list, not the tree
INSERT INTO audit_logs (table_name, operation, row_id, new_data, changed_by)
SELECT 'orders', 'INSERT', g, jsonb_build_object('status', 'pending', 'n', g), 'app'
FROM generate_series(1, 200) g;

CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT n_pending_pages, n_pending_tuples
FROM gin_metapage_info(get_raw_page('idx_audit_new', 0));

-- Merge the pending list into the main GIN tree now
SELECT gin_clean_pending_list('idx_audit_new') AS pages_merged;
SELECT n_pending_pages, n_pending_tuples
FROM gin_metapage_info(get_raw_page('idx_audit_new', 0));`,
      explain: `<p>Storage parameters are visible in <code>pg_class.reloptions</code>. After the inserts, the metapage shows <strong>200 pending tuples in 3 pending pages</strong>: these entries are not yet in the GIN tree, and every search must scan them linearly. <code>gin_clean_pending_list()</code> (or VACUUM / autovacuum, or exceeding the limit during an insert) merges them and returns the number of pending pages processed.</p>
<p>Production guidance: keep <code>fastupdate = on</code> for bulk-ingest tables where insert throughput matters; switch it off (or lower <code>gin_pending_list_limit</code>) where read latency must be predictable, so no single insert pays for a 4 MB merge and no search scans a long pending list.</p>`,
      output: ` relname                | reloptions
------------------------+-----------------------------------------------
 idx_audit_new          | {fastupdate=on,gin_pending_list_limit=512}
 idx_products_tags_nofu | {fastupdate=off}

INSERT 0 200

 n_pending_pages | n_pending_tuples
-----------------+------------------
               3 |              200

 pages_merged
--------------
            3

 n_pending_pages | n_pending_tuples
-----------------+------------------
               0 |                0`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE TABLE events_json AS
SELECT g AS id,
       jsonb_build_object('type', (ARRAY['click','view','buy'])[1 + g % 3],
                          'user_id', g % 5000,
                          'device', (ARRAY['ios','android','web','tv'])[1 + g % 4]) AS doc
FROM generate_series(1, 50000) AS g;
CREATE INDEX idx_events_doc ON events_json USING gin (doc jsonb_path_ops);
ANALYZE events_json;

-- Extract-and-compare: GIN cannot help
EXPLAIN ANALYZE SELECT id FROM events_json WHERE doc ->> 'user_id' = '42';
-- Seq Scan, Rows Removed by Filter: 49990, Buffers: shared hit=640, ~36 ms`,
      why: 'The ->> operator extracts text from every document and compares it. The GIN index indexes containment, not extracted scalars, so all 50,000 documents are read and parsed.', run: true },
    good: { sql: `CREATE TABLE events_json AS
SELECT g AS id,
       jsonb_build_object('type', (ARRAY['click','view','buy'])[1 + g % 3],
                          'user_id', g % 5000,
                          'device', (ARRAY['ios','android','web','tv'])[1 + g % 4]) AS doc
FROM generate_series(1, 50000) AS g;
CREATE INDEX idx_events_doc ON events_json USING gin (doc jsonb_path_ops);
ANALYZE events_json;

-- Containment: served by the GIN index
EXPLAIN ANALYZE SELECT id FROM events_json WHERE doc @> '{"user_id": 42}';
-- Bitmap Index Scan on idx_events_doc, Buffers: shared hit=13, ~2 ms`,
      why: 'Written as containment, the predicate maps to one jsonb_path_ops hash key; GIN returns the 10 matching TIDs directly. Note the JSON number 42 (not the string "42"): containment is type-sensitive.', run: true }
  },
  mistakes: [
    `Querying <code>col-&gt;&gt;'key' = 'value'</code> and expecting a GIN index on <code>col</code> to help. Use <code>col @&gt; '{"key":"value"}'</code> or a B-tree expression index on <code>(col-&gt;&gt;'key')</code>.`,
    `Using <code>'x' = ANY(array_col)</code> instead of <code>array_col @&gt; ARRAY['x']</code>; only the latter is GIN-indexable.`,
    `Choosing <code>jsonb_path_ops</code> and then querying with <code>?</code> (key exists) &mdash; that operator is only supported by the default <code>jsonb_ops</code>.`,
    `Forgetting that pg_trgm is an extension: <code>CREATE EXTENSION pg_trgm</code> is required, and trigram search needs at least 3 characters to be selective.`,
    `Comparing JSON types loosely: <code>@&gt; '{"user_id":"42"}'</code> (string) won't match a numeric 42.`,
    `Leaving the default 4 MB pending list on a latency-critical search index, causing periodic slow inserts and slow searches.`
  ],
  best: [
    `Default to <code>jsonb_path_ops</code> when queries are containment (<code>@&gt;</code>) only; it is smaller and faster.`,
    `If only one or two JSON keys are ever filtered, prefer B-tree expression indexes on those keys over a GIN on the whole document.`,
    `For full-text search, store a generated <code>tsvector</code> column (as <code>documents.search</code> does) and index it, instead of indexing <code>to_tsvector(body)</code> at query time.`,
    `Tune <code>fastupdate</code>/<code>gin_pending_list_limit</code> per index according to whether writes or read latency matter more.`,
    `Watch GIN index size and autovacuum on write-heavy tables; GIN updates are the most expensive of all index types.`
  ],
  performance: `
<p>Reads: GIN lookups are fast and nearly independent of document size; multi-key queries intersect posting lists. Results are bitmaps, so very common keys (in 50% of rows) produce large bitmaps and the planner may prefer a seq scan. Writes: one row with N distinct keys means N index insertions (mitigated by the pending list); building a GIN index is much faster than inserting rows one by one, so for big loads <em>drop &rarr; load &rarr; create index</em> with a high <code>maintenance_work_mem</code>. Size here: <code>jsonb_ops</code> 1,392 kB vs <code>jsonb_path_ops</code> 1,080 kB on 50k small documents; the gap widens for nested documents.</p>`,
  security: `
<p>GIN indexes on jsonb documents index <em>every</em> key and value, including any sensitive fields that applications stuffed into JSON (tokens, emails). They persist in index files, WAL and backups. Strip secrets before storing, or index only the needed paths with expression indexes. Trigram search endpoints with user-controlled patterns should enforce a minimum length to avoid very unselective, expensive queries (a cheap DoS vector).</p>`,
  scenario: {
    title: 'Product filter page slows down after adding JSON attributes',
    steps: [
      '1. Filter queries like attributes->>\'color\' = $1 AND attributes->>\'brand\' = $2 take 900 ms on 8M products.',
      '2. EXPLAIN shows Seq Scan with Filter on ->>, despite a GIN index on attributes.',
      '3. Rewrite the query builder to emit attributes @> jsonb_build_object(\'color\', $1, \'brand\', $2).',
      '4. Rebuild the index as jsonb_path_ops CONCURRENTLY (smaller, @> only) since no query uses ? operators.',
      '5. EXPLAIN ANALYZE: Bitmap Index Scan, 14 ms; bitmap rechecks low.',
      '6. Monitor insert latency of the catalogue import job; set gin_pending_list_limit = 1MB on the index to cap merge pauses.'
    ]
  },
  widgets: ['lab:index'],
  interview: [
    { q: 'What is the difference between jsonb_ops and jsonb_path_ops?',
      a: 'jsonb_ops (default) creates separate index keys for every key and every value, supporting @>, ?, ?|, ?& and jsonpath operators. jsonb_path_ops creates one hashed key per path-to-value, supporting only @> and jsonpath matches, but produces a smaller index and more precise containment lookups because the key encodes the whole path.' },
    { q: 'Why do GIN scans always show Bitmap Heap Scan with Recheck Cond?',
      a: 'GIN only supports bitmap scans: it returns sets of TIDs per key that are combined, not ordered tuples. Results can be lossy (e.g. hashed path keys, trigram matches, or bitmaps exceeding work_mem), so the heap tuple is rechecked with the actual operator.' },
    { q: 'Explain GIN fastupdate and its trade-offs.',
      a: 'With fastupdate on, new entries go into an unsorted pending list instead of the main tree, making individual inserts cheap. The list is merged when it exceeds gin_pending_list_limit, during VACUUM, or via gin_clean_pending_list(). Searches must scan the whole pending list, and the insert that triggers a merge is slow, so latency becomes less predictable. Turn it off for latency-sensitive read workloads.' },
    { q: 'How do you make LIKE \'%term%\' fast in PostgreSQL?',
      a: 'Install the pg_trgm extension and create a GIN (or GiST) index with gin_trgm_ops on the column. The search pattern is decomposed into trigrams that are looked up in the index, then candidates are rechecked. Patterns need at least about three characters to be selective.' }
  ],
  exercises: [
    { task: 'Find all products whose attributes contain brand Zenit AND color black using containment, and create the most compact GIN index for it.',
      solution: `CREATE INDEX idx_products_attrs_path ON products USING gin (attributes jsonb_path_ops);
SELECT id, name, attributes ->> 'color' AS color
FROM products
WHERE attributes @> '{"brand":"Zenit","color":"black"}'
ORDER BY id;`, run: true },
    { task: 'Rewrite this non-indexable query into an indexable one and create the index: SELECT name FROM products WHERE \'bestseller\' = ANY(tags);',
      solution: `CREATE INDEX idx_products_tags ON products USING gin (tags);
SELECT name FROM products WHERE tags @> ARRAY['bestseller'] ORDER BY name;`, run: true },
    { task: 'Search documents for "replication" using the existing full-text GIN index and rank the results.',
      solution: `SELECT title, round(ts_rank(search, q)::numeric, 4) AS rank
FROM documents, websearch_to_tsquery('english', 'replication') AS q
WHERE search @@ q
ORDER BY rank DESC;`, run: true }
  ],
  challenge: {
    task: 'Build a typo-tolerant customer search: create a trigram index, then return the 5 customers most similar to the misspelled input \'Cstomer 7\', showing similarity, using the % operator for filtering.',
    hint: 'CREATE EXTENSION pg_trgm; GIN with gin_trgm_ops; WHERE name % \'...\' ORDER BY similarity(...) DESC.',
    solution: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
SELECT id, name, round(similarity(name, 'Cstomer 7')::numeric, 3) AS sim
FROM customers
WHERE name % 'Cstomer 7'
ORDER BY sim DESC, name
LIMIT 5;`,
    run: true
  },
  related: ['jsonb', 'arrays', 'full-text-search', 'advanced-indexing-gist-spgist', 'indexes-partial-expression'],
  quiz: [
    { type: 'index', q: 'Query: WHERE attributes @> \'{"color":"black"}\' on a large table. Best index?',
      options: ['B-tree on attributes', 'GIN (attributes jsonb_path_ops)', 'Hash on attributes', 'BRIN on attributes'],
      answer: 1, explain: 'Containment on jsonb is GIN territory; jsonb_path_ops is the compact choice for @>.' },
    { type: 'predict', q: 'GIN index on products(tags). Which query can use it?',
      code: `-- A: SELECT * FROM products WHERE 'sale' = ANY(tags);
-- B: SELECT * FROM products WHERE tags @> ARRAY['sale'];`,
      options: ['A only', 'B only', 'Both', 'Neither'],
      answer: 1, explain: 'Only array operators (@>, <@, &&, =) are in the GIN array opclass. = ANY is a scalar comparison.' },
    { type: 'tf', q: 'GIN indexes can return rows in sorted order to avoid a Sort node.',
      answer: false, explain: 'GIN only supports bitmap scans; it has no ordering capability.' },
    { type: 'mcq', q: 'What does gin_clean_pending_list() do?',
      options: ['Drops dead index entries', 'Moves entries from the fastupdate pending list into the main GIN structure', 'Rebuilds the index', 'Resets index statistics'],
      answer: 1, explain: 'It merges the pending list, the same work VACUUM or an overflowing insert would do.' },
    { type: 'bug', q: 'The index exists but the query is slow. Why?',
      code: `CREATE INDEX i ON t USING gin (doc jsonb_path_ops);
SELECT * FROM t WHERE doc ? 'discount';`,
      options: ['jsonb_path_ops does not support the ? operator', 'Need ANALYZE', 'GIN requires fastupdate=off', 'doc must be json, not jsonb'],
      answer: 0, explain: 'Key-existence operators need the default jsonb_ops opclass.' }
  ]
},

{
  id: 'advanced-indexing-gist-spgist',
  module: 'advanced-indexing',
  title: 'GiST and SP-GiST: Ranges, Geometry, Exclusion Constraints and Nearest Neighbour',
  level: 4,
  minutes: 26,
  summary: 'Use GiST for overlapping data (ranges, geometry, KNN, exclusion constraints) and SP-GiST for space-partitioned data (quad-trees for points, radix tries for text and IP prefixes).',
  objectives: [
    'Explain GiST as a balanced tree of bounding predicates (e.g. bounding boxes) and SP-GiST as non-overlapping space partitioning',
    'Index range types and query overlaps (&&), containment (@>) and adjacency',
    'Build an EXCLUDE constraint that prevents double-booking (btree_gist extension)',
    'Run K-nearest-neighbour queries with ORDER BY col <-> point LIMIT k',
    'Use SP-GiST for points (quad-tree), text prefix (^@) and inet containment (<<)',
    'Know which operators each opclass supports and when to prefer GIN or B-tree instead'
  ],
  concept: `
<p><strong>GiST analogy: nested delivery zones.</strong> A courier company divides a city into zones drawn as rectangles; each zone contains smaller rectangles; the smallest rectangles contain individual addresses. Zones <em>may overlap</em>. To find "all addresses within 2 km of here", you skip every zone whose rectangle doesn't intersect your circle. That's <strong>GiST</strong> (Generalized Search Tree, <span class="tag core">core</span>): a balanced tree where each internal entry holds a <em>predicate that covers all its children</em> &mdash; a bounding box for geometry, a covering range for ranges.</p>
<p><strong>SP-GiST analogy: dividing a map into quadrants.</strong> Draw a cross through the map's centre: NE, NW, SE, SW. Split each quadrant again where it's crowded. Regions <em>never overlap</em>, and the tree can be unbalanced (dense areas are deeper). That's <strong>SP-GiST</strong> (Space-Partitioned GiST): quad-trees and k-d trees for points, <em>radix tries</em> for text (split by prefix characters) and IP networks.</p>
<p><strong>What GiST enables:</strong></p>
<ul>
  <li><strong>Range types</strong> (<code>daterange</code>, <code>tstzrange</code>, <code>int4range</code>, multiranges): <code>&amp;&amp;</code> overlap, <code>@&gt;</code> contains, <code>&lt;@</code>, <code>-|-</code> adjacent, <code>&lt;&lt;</code>/<code>&gt;&gt;</code> strictly left/right.</li>
  <li><strong>Geometry</strong> (core <code>point</code>, <code>box</code>, <code>polygon</code>, <code>circle</code>; and PostGIS <span class="tag ext">extension</span> <code>geometry</code>/<code>geography</code>): <code>&lt;@</code>, <code>&amp;&amp;</code>, <code>~=</code>.</li>
  <li><strong>Nearest neighbour (KNN)</strong>: <code>ORDER BY location &lt;-&gt; point(...) LIMIT 5</code> walks the tree in distance order and stops after 5 &mdash; no full sort.</li>
  <li><strong>Exclusion constraints</strong>: <code>EXCLUDE USING gist (room WITH =, during WITH &amp;&amp;)</code> = "no two rows with the same room and overlapping time". A generalisation of UNIQUE.</li>
  <li><strong>Full-text</strong> (<code>tsvector</code>, lossy, smaller/faster to update than GIN but slower to search) and <strong>pg_trgm</strong> similarity with distance ordering.</li>
</ul>
<p><strong>btree_gist</strong> <span class="tag ext">extension</span> adds GiST operator classes for scalar types (int, text, timestamptz&hellip;), needed to combine <code>room WITH =</code> and a range in one exclusion constraint.</p>`,
  why: `
<p>B-trees require a total order: a single line from smallest to largest. Ranges, rectangles and locations don't have one &mdash; two rectangles can overlap, contain each other, or be far apart in different directions. Questions like "overlaps", "within", "closest to" need a structure based on <em>regions</em>. GiST and SP-GiST provide that framework, and exclusion constraints turn it into data integrity: race-free prevention of double bookings, overlapping price periods or conflicting leases.</p>`,
  useCase: `
<p><strong>Meeting-room and vehicle booking</strong> at an infrastructure consultancy: 600 rooms and site vehicles across 40 offices. <code>EXCLUDE USING gist (resource_id WITH =, during WITH &amp;&amp;)</code> guarantees no double booking even when two engineers click "book" at the same millisecond &mdash; the second insert fails with <code>exclusion_violation</code>, which the API maps to HTTP 409.</p>
<p><strong>"Nearest site office / store" search:</strong> a GiST (or SP-GiST) index on a <code>point</code> column answers "5 nearest of 200,000 locations" in under 1 ms by walking the tree in distance order. With PostGIS, the same pattern on <code>geography</code> gives real-earth distances.</p>`,
  internals: `
<p><strong>GiST</strong> is a framework: an operator class implements <code>consistent</code> (can this subtree contain matches?), <code>union</code> (bounding predicate of children), <code>penalty</code> (cost of inserting here &mdash; choose the subtree whose box grows least), <code>picksplit</code> (how to divide an overflowing page), and optionally <code>distance</code> (for KNN). Because sibling predicates may overlap, a search might descend several branches. Quality depends on how well picksplit keeps boxes tight. GiST indexes are <em>lossy</em> for some types (they store bounding boxes), so heap rechecks occur.</p>
<p><strong>KNN</strong> uses a priority queue ordered by the distance from the query point to each subtree's bounding predicate &mdash; exploring the closest region first. That's why <code>Order By: (location &lt;-&gt; ...)</code> appears inside the Index Scan node.</p>
<p><strong>SP-GiST</strong> implements partitioned trees whose inner nodes split space into disjoint parts (quadrants for <code>quad_point_ops</code>, k-d splits for <code>kd_point_ops</code>, character-by-character for <code>text_ops</code> radix tries, network bits for <code>inet_ops</code>). Inner nodes can have many children and pages hold multiple nodes, keeping I/O reasonable despite unbalanced depth. Good for data with natural clustering and non-overlapping keys.</p>
<p><strong>Exclusion constraints</strong> are enforced like unique indexes: on insert, the index is searched for conflicting entries using the given operators; concurrent conflicting inserts wait for each other.</p>`,
  whenNot: `
<ul>
  <li><strong>Plain equality / ordering</strong> on scalars: B-tree is smaller and faster. Use btree_gist only when you must combine scalars with ranges in one GiST index or constraint.</li>
  <li><strong>Containment on arrays/jsonb, full-text with heavy reads</strong>: GIN is faster to search (GiST full-text is lossy and needs heap rechecks).</li>
  <li><strong>Real geographic distance on Earth</strong>: core <code>point</code> uses flat Euclidean distance in whatever units you store; use PostGIS <code>geography</code> for metres on a sphere.</li>
  <li><strong>Append-only time ranges</strong> on huge tables where you only filter by time: BRIN is far smaller.</li>
</ul>`,
  syntax: `CREATE INDEX name ON t USING gist (range_or_geometry_col);
CREATE INDEX name ON t USING gist (daterange(start_date, end_date, '[]'));       -- expression
CREATE INDEX name ON t USING spgist (point_col);                                 -- quad-tree
CREATE INDEX name ON t USING spgist (text_col);                                  -- radix trie: =, <, ^@
CREATE INDEX name ON t USING spgist (inet_col);                                  -- <<, <<=, >>, &&

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE t ADD CONSTRAINT no_overlap EXCLUDE USING gist (resource_id WITH =, during WITH &&);

SELECT ... FROM t ORDER BY point_col <-> point(x, y) LIMIT k;                     -- KNN`,
  examples: [
    { label: 'Basic', title: 'Which projects were running in March 2025? (range overlap)',
      sql: `-- end_date NULL = still running -> daterange(start, NULL) is unbounded above
CREATE INDEX idx_projects_period ON projects
  USING gist (daterange(start_date, end_date, '[]'));

SET enable_seqscan = off;   -- 24 rows: force the index to see the plan
EXPLAIN SELECT name FROM projects
WHERE daterange(start_date, end_date, '[]') && daterange('2025-03-01', '2025-04-01');
RESET enable_seqscan;

SELECT name, start_date, end_date
FROM projects
WHERE daterange(start_date, end_date, '[]') && daterange('2025-03-01', '2025-04-01')
ORDER BY start_date
LIMIT 5;`,
      explain: `<p>An expression GiST index on the constructed range answers <code>&amp;&amp;</code> (overlaps) as an <code>Index Cond</code>. The <code>'[]'</code> bounds make both start and end dates inclusive. A NULL <code>end_date</code> produces an unbounded upper bound, so ongoing projects naturally overlap any future period &mdash; no special <code>OR end_date IS NULL</code> logic needed.</p>
<p>Doing this with two B-tree columns requires <code>start_date &lt;= '2025-03-31' AND (end_date &gt;= '2025-03-01' OR end_date IS NULL)</code>, which a B-tree can serve only partially.</p>`,
      output: ` Index Scan using idx_projects_period on projects  (cost=0.14..8.15 rows=1 width=14)
   Index Cond: (daterange(start_date, end_date, '[]'::text) && '[2025-03-01,2025-04-01)'::daterange)

 name             | start_date | end_date
------------------+------------+----------
 Project Atlas    | 2024-01-22 |
 Project Borealis | 2024-02-12 |
 Project Comet    | 2024-03-04 |
 Project Eclipse  | 2024-04-15 |
 Project Falcon   | 2024-05-06 |`,
      run: true },
    { label: 'Intermediate', title: 'No double booking: EXCLUDE constraint with btree_gist',
      sql: `-- btree_gist is an extension: GiST support for "=" on scalar types
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE room_bookings (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room      text NOT NULL,
  booked_by int REFERENCES employees(id),
  during    tstzrange NOT NULL,
  EXCLUDE USING gist (room WITH =, during WITH &&)
);

INSERT INTO room_bookings (room, booked_by, during) VALUES
  ('Everest', 1, '[2025-06-02 10:00+05, 2025-06-02 11:00+05)'),
  ('Everest', 2, '[2025-06-02 11:00+05, 2025-06-02 12:00+05)'),  -- touches, does not overlap
  ('K2',      3, '[2025-06-02 10:30+05, 2025-06-02 11:30+05)');  -- other room

DO $$
BEGIN
  INSERT INTO room_bookings (room, booked_by, during)
  VALUES ('Everest', 4, '[2025-06-02 10:30+05, 2025-06-02 11:15+05)');
EXCEPTION WHEN exclusion_violation THEN
  RAISE NOTICE 'rejected: %', SQLERRM;
END $$;

SELECT room, booked_by, during FROM room_bookings ORDER BY room, during;`,
      explain: `<p>The constraint reads: "reject a new row if any existing row has room <strong>=</strong> and during <strong>&amp;&amp;</strong> (overlaps)". Half-open ranges <code>[start, end)</code> make 10:00&ndash;11:00 and 11:00&ndash;12:00 adjacent but not overlapping, so back-to-back meetings are allowed. The 10:30&ndash;11:15 booking for Everest conflicts and is rejected atomically &mdash; even if two sessions insert simultaneously, one waits for the other and then fails.</p>`,
      output: `NOTICE:  rejected: conflicting key value violates exclusion constraint "room_bookings_room_during_excl"

 room    | booked_by | during
---------+-----------+-----------------------------------------------------
 Everest |         1 | ["2025-06-02 10:00:00+05","2025-06-02 11:00:00+05")
 Everest |         2 | ["2025-06-02 11:00:00+05","2025-06-02 12:00:00+05")
 K2      |         3 | ["2025-06-02 10:30:00+05","2025-06-02 11:30:00+05")`,
      run: true },
    { label: 'Advanced', title: 'KNN with GiST, and SP-GiST quad-tree / trie / inet',
      sql: `CREATE TABLE stores (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text, location point);
INSERT INTO stores (name, location)
SELECT 'Store ' || g, point(68 + random() * 29, 8 + random() * 27)   -- lon/lat box around India
FROM generate_series(1, 20000) g;
CREATE INDEX idx_stores_location ON stores USING gist (location);
ANALYZE stores;

-- 5 nearest stores to Gurgaon (77.03, 28.46): walks the tree by distance
EXPLAIN ANALYZE
SELECT name, location <-> point(77.03, 28.46) AS dist
FROM stores ORDER BY location <-> point(77.03, 28.46) LIMIT 5;

-- SP-GiST: radix trie on text supports the "starts with" operator ^@
CREATE INDEX idx_customers_email_spg ON customers USING spgist (email);
SET enable_seqscan = off;
EXPLAIN SELECT id FROM customers WHERE email ^@ 'customer42';
RESET enable_seqscan;

-- SP-GiST on inet: "which clients are inside 10.42.0.0/16?"
CREATE TABLE access_log (id bigint GENERATED ALWAYS AS IDENTITY, client_ip inet);
INSERT INTO access_log (client_ip)
SELECT ('10.' || (g % 256) || '.' || (g / 256 % 256) || '.' || (g % 7))::inet
FROM generate_series(1, 30000) g;
CREATE INDEX idx_access_ip ON access_log USING spgist (client_ip);
ANALYZE access_log;
EXPLAIN SELECT count(*) FROM access_log WHERE client_ip << '10.42.0.0/16';`,
      explain: `<p><strong>KNN:</strong> <code>Order By: (location &lt;-&gt; ...)</code> inside the Index Scan means the index itself produces rows in increasing distance; the Limit stops after 5. Total cost 0.69 instead of sorting 20,000 distances. (Distances are Euclidean in degrees here &mdash; fine for a demo, use PostGIS <code>geography</code> for metres.)</p>
<p><strong>SP-GiST text:</strong> <code>^@</code> ("starts with") is supported by the SP-GiST radix trie and works regardless of collation. <strong>inet:</strong> <code>&lt;&lt;</code> ("is contained within network") on an SP-GiST index finds the subnet's addresses directly.</p>
<p>In our tests, for 20,000 points the SP-GiST quad-tree was 912 kB vs 1,312 kB for GiST; both support KNN.</p>`,
      output: ` Limit  (cost=0.28..0.69 rows=5 width=19) (actual time=0.432..0.494 rows=5.00 loops=1)
   Buffers: shared hit=5 read=3
   ->  Index Scan using idx_stores_location on stores  (cost=0.28..1660.28 rows=20000 width=19) (actual time=0.420..0.440 rows=5.00 loops=1)
         Order By: (location <-> '(77.03,28.46)'::point)
         Index Searches: 1
 Execution Time: 0.913 ms

 Bitmap Heap Scan on customers  (cost=4.22..11.68 rows=10 width=4)
   Recheck Cond: (email ^@ 'customer42'::text)
   ->  Bitmap Index Scan on idx_customers_email_spg  (cost=0.00..4.22 rows=10 width=0)
         Index Cond: (email ^@ 'customer42'::text)

 Aggregate  (cost=138.03..138.04 rows=1 width=8)
   ->  Bitmap Heap Scan on access_log  (cost=4.86..137.85 rows=75 width=0)
         Recheck Cond: (client_ip << '10.42.0.0/16'::inet)
         ->  Bitmap Index Scan on idx_access_ip  (cost=0.00..4.84 rows=75 width=0)
               Index Cond: (client_ip << '10.42.0.0/16'::inet)`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Application-level overlap check: racy and slow
CREATE TABLE bookings_bad (room text, starts_at timestamptz, ends_at timestamptz);
INSERT INTO bookings_bad VALUES ('Everest', '2025-06-02 10:00+05', '2025-06-02 11:00+05');
-- App runs this check, then inserts if count = 0 ...
SELECT count(*) FROM bookings_bad
WHERE room = 'Everest'
  AND starts_at < '2025-06-02 11:15+05' AND ends_at > '2025-06-02 10:30+05';
-- ...two concurrent requests both see 0 and both insert: double booking`,
      why: 'Check-then-insert is a race condition under READ COMMITTED: two transactions run the SELECT before either commits, both see no conflict, both insert. The interval predicate also cannot be served efficiently by B-trees on large tables.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE bookings_good (
  room   text NOT NULL,
  during tstzrange NOT NULL,
  EXCLUDE USING gist (room WITH =, during WITH &&)
);
INSERT INTO bookings_good VALUES ('Everest', '[2025-06-02 10:00+05, 2025-06-02 11:00+05)');
DO $$ BEGIN
  INSERT INTO bookings_good VALUES ('Everest', '[2025-06-02 10:30+05, 2025-06-02 11:15+05)');
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'double booking prevented';
END $$;`,
      why: 'The exclusion constraint is checked inside the index with proper locking, so concurrent conflicting inserts serialize and one fails. The GiST index also makes "what is booked now?" range queries fast.', run: true }
  },
  mistakes: [
    `Using closed ranges <code>[start, end]</code> for time slots, making back-to-back bookings (10&ndash;11 and 11&ndash;12) "overlap". Use half-open <code>[start, end)</code>, the default for range constructors.`,
    `Forgetting <code>CREATE EXTENSION btree_gist</code> and getting "data type text has no default operator class for access method gist" when mixing scalar = with ranges.`,
    `Treating core <code>point</code> distances as kilometres. They are plain Euclidean units; use PostGIS geography for real distances.`,
    `Writing KNN as <code>WHERE dist &lt; x ORDER BY dist</code> with a computed column &mdash; the <code>&lt;-&gt;</code> expression must appear directly in <code>ORDER BY</code> with a <code>LIMIT</code> to use the index ordering.`,
    `Choosing GiST for full-text search on a read-heavy workload where GIN would be several times faster.`
  ],
  best: [
    `Model periods as range types (<code>tstzrange</code>, <code>daterange</code>) and enforce non-overlap with EXCLUDE constraints.`,
    `Use GiST for geometry, ranges, KNN and exclusion; SP-GiST for point clouds, IP prefixes and prefix text search where partitions don't overlap.`,
    `For geographic data, use PostGIS (extension) with GiST on geometry/geography.`,
    `Benchmark GiST vs SP-GiST on your data distribution; size and speed depend heavily on clustering.`,
    `Map <code>exclusion_violation</code> (SQLSTATE 23P01) to a user-friendly "slot already taken" error in the API.`
  ],
  performance: `
<p>GiST search cost depends on overlap between sibling bounding predicates: tight, well-clustered data gives near-B-tree performance; heavily overlapping long ranges force visits to many branches. Inserts compute penalties and occasionally split pages, making GiST builds slower than B-tree (PG15+ has a faster sorted build for point data). KNN with LIMIT is extremely efficient because the priority queue stops after k results. SP-GiST indexes are often smaller and faster for skewed point data and prefixes, but they are single-column only and support fewer operator classes than GiST &mdash; check the operator list of the opclass before choosing.</p>`,
  security: `
<p>Exclusion constraints are an integrity and abuse-prevention tool: they make overlapping reservations impossible even if application checks are bypassed or raced. Location data (points) is personal data in many jurisdictions; GiST indexes duplicate it into index files and backups, so apply the same protection as for the base table.</p>`,
  scenario: {
    title: 'Double-booked site vehicles despite application checks',
    steps: [
      '1. Incident: two engineers were assigned the same survey vehicle for overlapping times.',
      '2. Root cause analysis: the booking service does SELECT overlap check, then INSERT; under concurrency both passed.',
      '3. Find existing conflicts first: self-join bookings b1, b2 ON same vehicle AND tstzrange(b1...) && tstzrange(b2...) AND b1.id < b2.id; resolve them with the operations team.',
      '4. Add a tstzrange column (generated or backfilled) and CREATE EXTENSION btree_gist.',
      '5. ALTER TABLE bookings ADD CONSTRAINT no_vehicle_overlap EXCLUDE USING gist (vehicle_id WITH =, during WITH &&).',
      '6. Map SQLSTATE 23P01 to HTTP 409 in the API; remove the racy pre-check or keep it only for UX.',
      '7. Monitor: the GiST index also accelerates the "availability calendar" queries.'
    ]
  },
  widgets: ['lab:index'],
  interview: [
    { q: 'How does GiST differ from B-tree conceptually?',
      a: 'B-tree requires a linear total order and stores sorted keys with non-overlapping ranges per page. GiST is a balanced tree framework where each internal entry stores a predicate (such as a bounding box or covering range) that is true for everything below it; sibling predicates may overlap, so a search may follow several paths. That supports operators like overlap, containment and distance.' },
    { q: 'What is an exclusion constraint? Give an example.',
      a: 'A generalisation of UNIQUE: it guarantees that for any two rows, at least one of the specified operator comparisons returns false. EXCLUDE USING gist (room WITH =, during WITH &&) means no two rows can have the same room and overlapping time ranges. It is enforced through a GiST index, race-free, with SQLSTATE 23P01 on violation.' },
    { q: 'How does a KNN query use a GiST index?',
      a: 'The query is written as ORDER BY col <-> target LIMIT k. The operator class supplies a distance function; the index scan uses a priority queue keyed by the minimum distance from the target to each subtree\'s bounding predicate and emits tuples in increasing distance, so the scan stops after k rows without sorting the whole table.' },
    { q: 'When is SP-GiST a better choice than GiST?',
      a: 'When the data can be partitioned into non-overlapping regions with a natural decomposition: points (quad-trees, k-d trees), IP networks, and text prefixes (radix tries). It is often smaller and faster for such data, especially when the distribution is skewed, but it supports fewer operator classes and features.' }
  ],
  exercises: [
    { task: 'Using projects, list all pairs of projects of the same department whose periods overlap (treat NULL end_date as ongoing). Show each pair once.',
      solution: `SELECT p1.name AS project_a, p2.name AS project_b, p1.department_id
FROM projects p1
JOIN projects p2
  ON p1.department_id = p2.department_id
 AND p1.id < p2.id
 AND daterange(p1.start_date, p1.end_date, '[]') && daterange(p2.start_date, p2.end_date, '[]')
ORDER BY p1.department_id, p1.name, p2.name;`, run: true },
    { task: 'Create a price_periods table where a product may not have two overlapping price validity periods; prove that an overlapping insert fails.',
      solution: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE price_periods (
  product_id int REFERENCES products(id),
  price      numeric(10,2) NOT NULL,
  valid      daterange NOT NULL,
  EXCLUDE USING gist (product_id WITH =, valid WITH &&)
);
INSERT INTO price_periods VALUES (1, 999.00, '[2025-01-01,2025-07-01)');
INSERT INTO price_periods VALUES (1, 899.00, '[2025-07-01,2026-01-01)');
DO $$ BEGIN
  INSERT INTO price_periods VALUES (1, 950.00, '[2025-06-15,2025-08-01)');
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'overlap rejected';
END $$;
SELECT * FROM price_periods ORDER BY valid;`, run: true }
  ],
  challenge: {
    task: 'Create a table of 10,000 random warehouse points and a GiST index. For each of the 3 Indian cities Mumbai (72.88, 19.08), Delhi (77.21, 28.61), Bengaluru (77.59, 12.97), return the 2 nearest warehouses using a LATERAL KNN query.',
    hint: 'CROSS JOIN LATERAL (SELECT ... ORDER BY location <-> city.pt LIMIT 2).',
    solution: `CREATE TABLE warehouses (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, location point);
INSERT INTO warehouses (location)
SELECT point(68 + random() * 29, 8 + random() * 27) FROM generate_series(1, 10000);
CREATE INDEX idx_warehouses_loc ON warehouses USING gist (location);
ANALYZE warehouses;
SELECT c.city, w.id AS warehouse_id, round((w.location <-> c.pt)::numeric, 3) AS distance
FROM (VALUES ('Mumbai', point(72.88, 19.08)),
             ('Delhi', point(77.21, 28.61)),
             ('Bengaluru', point(77.59, 12.97))) AS c(city, pt)
CROSS JOIN LATERAL (
  SELECT id, location FROM warehouses
  ORDER BY location <-> c.pt
  LIMIT 2
) AS w
ORDER BY c.city, distance;`,
    run: true
  },
  related: ['advanced-indexing-gin', 'advanced-indexing-brin', 'constraints', 'data-types', 'extensions'],
  quiz: [
    { type: 'mcq', q: 'Which index type supports EXCLUDE constraints with the && operator on ranges?',
      options: ['B-tree', 'Hash', 'GiST', 'BRIN'],
      answer: 2, explain: 'Exclusion constraints need an index AM that supports the operators; GiST (and SP-GiST for some) supports range overlap.' },
    { type: 'bug', q: 'Why does this fail?',
      code: `CREATE TABLE b (room text, during tstzrange,
  EXCLUDE USING gist (room WITH =, during WITH &&));`,
      options: ['tstzrange cannot be indexed', 'text has no GiST operator class until btree_gist is installed', '&& is not a range operator', 'EXCLUDE requires UNIQUE'],
      answer: 1, explain: 'CREATE EXTENSION btree_gist provides GiST opclasses for scalar types like text and int.' },
    { type: 'tf', q: 'In a GiST index, sibling entries may cover overlapping regions, so a search can descend into several subtrees.',
      answer: true, explain: 'That is the key difference from B-tree and SP-GiST, whose partitions do not overlap.' },
    { type: 'predict', q: 'GiST index on stores(location). What appears in the plan?',
      code: `EXPLAIN SELECT name FROM stores ORDER BY location <-> point(77, 28) LIMIT 5;`,
      options: ['Sort + Seq Scan', 'Limit -> Index Scan ... Order By: (location <-> ...)', 'Bitmap Heap Scan', 'Hash Join'],
      answer: 1, explain: 'KNN-GiST produces rows in distance order inside the index scan.' },
    { type: 'index', q: 'Find which /24 subnet an IP belongs to among 1M stored inet addresses (WHERE ip << \'10.1.2.0/24\'). Index?',
      options: ['B-tree (ip)', 'SP-GiST (ip) or GiST (ip inet_ops)', 'GIN (ip)', 'Hash (ip)'],
      answer: 1, explain: 'inet containment operators are supported by SP-GiST inet_ops and GiST inet_ops.' }
  ]
},

{
  id: 'advanced-indexing-brin',
  module: 'advanced-indexing',
  title: 'BRIN Indexes for Huge Append-Only Tables',
  level: 4,
  minutes: 22,
  summary: 'Index billions of time-series rows with a few kilobytes: block-range summaries, pages_per_range, correlation, lossy bitmaps and when BRIN fails.',
  objectives: [
    'Explain BRIN as a per-block-range min/max summary (a "table of contents" for physical chunks)',
    'Compare BRIN vs B-tree size and query cost on a 200k-row time-series table',
    'Explain why physical correlation is essential and check it in pg_stats',
    'Tune pages_per_range and choose minmax vs minmax_multi opclasses',
    'Keep BRIN summaries current (autosummarize, brin_summarize_new_values)',
    'Recognise lossy Bitmap Heap Scans and Rows Removed by Index Recheck'
  ],
  concept: `
<p><strong>Analogy: labelled archive boxes.</strong> A company stores invoices in archive boxes, filled in date order. Each box has a sticker: "1 Jan &ndash; 17 Jan". To find invoices from 3 February, you read the stickers (tiny effort), open only the boxes whose range includes 3 Feb, and flip through them. You don't index every invoice &mdash; just each <em>box</em>. That's <strong>BRIN</strong> (Block Range INdex, <span class="tag core">core</span>).</p>
<p>BRIN divides the table into ranges of <code>pages_per_range</code> consecutive heap pages (default 128 pages = 1 MB) and stores one summary per range: for the default <code>minmax</code> opclass, the minimum and maximum value of the column in that range. A query for a time window returns <em>all pages of all ranges whose [min, max] overlaps the window</em>; the executor then reads those pages and rechecks every row.</p>
<p>The magic: a B-tree on 200,000 timestamps is 4.4 MB; the BRIN is <strong>24 kB</strong> (its minimum size: metapage + revmap + one data page). On a 2 TB time-series table, a B-tree might be 60 GB and BRIN a few MB.</p>
<p>The catch: BRIN only works if the column's values are <strong>physically correlated with row position</strong> &mdash; e.g. append-only logs where <code>created_at</code> increases as rows are inserted. If values are randomly scattered, every range has min&asymp;global min and max&asymp;global max, every range matches, and BRIN degrades to "scan everything plus overhead". <code>pg_stats.correlation</code> tells you: near &plusmn;1 is good, near 0 is useless.</p>`,
  why: `
<p>Time-series, IoT, logs, audit trails and financial ticks are append-only and enormous, and almost every query restricts a time window. B-trees on such tables are huge, slow to build, expensive to maintain on every insert, and mostly cold. BRIN gives most of the pruning benefit for a microscopic fraction of the size and almost zero insert overhead.</p>`,
  useCase: `
<p><strong>Smart-meter platform for a power utility:</strong> 12 million meters, one reading every 15 minutes &rarr; ~ 1.15 billion rows/day, stored in daily partitions. Queries: "readings of region X between 10:00 and 11:00". A BRIN on <code>reading_at</code> per partition costs ~ 100 kB instead of ~ 30 GB for a B-tree, inserts stay at full speed, and hour-window queries read ~ 4% of a partition. For "one specific meter's history" they keep a separate B-tree on <code>(meter_id, reading_at)</code> on recent partitions only.</p>`,
  internals: `
<p><strong>Structure:</strong> page 0 is the metapage; then a <em>range map</em> (revmap) with one pointer per block range; then regular pages holding summary tuples. For <code>minmax</code> the summary is <code>{min .. max}</code> plus flags (has NULLs, all NULLs).</p>
<p><strong>Scan:</strong> a Bitmap Index Scan reads all summaries (tiny), and for each matching range adds <em>all its pages</em> to a lossy bitmap. The Bitmap Heap Scan then reads those pages and rechecks every tuple: plans show <code>Heap Blocks: lossy=N</code> and <code>Rows Removed by Index Recheck</code>. The row count shown for the BRIN node is not a real row count (it reflects pages, not tuples).</p>
<p><strong>Maintenance:</strong> new pages at the end of the table form a range that is <em>not yet summarised</em>; unsummarised ranges are always included in scans (correct but less selective). Summarisation happens during VACUUM, when <code>autosummarize = on</code> is set on the index (a summarisation request is queued when a range fills), or manually with <code>brin_summarize_new_values()</code> / <code>brin_summarize_range()</code>. UPDATEs/DELETEs can widen summaries (min/max only grow) until <code>brin_desummarize_range</code> + re-summarise.</p>
<p><strong>Opclasses:</strong> <code>minmax</code> (default), <code>minmax_multi</code> (PG14+, stores several min/max intervals per range &mdash; tolerates some out-of-order data), <code>bloom</code> (PG14+, BRIN bloom for equality on non-correlated values), and <code>inclusion</code> for geometry/inet.</p>`,
  whenNot: `
<ul>
  <li><strong>Low correlation</strong> (random UUIDs, updated rows, data loaded out of order): BRIN returns nearly all ranges. Our shuffled demo read 1,280 of 1,285 pages.</li>
  <li><strong>Point lookups</strong> (one specific id or user): BRIN must read a full block range (1 MB) per match; a B-tree reads 2&ndash;4 pages.</li>
  <li><strong>Small tables</strong> (&lt; a few hundred MB): a B-tree is cheap enough and more precise.</li>
  <li><strong>Heavily updated tables</strong>: updates move tuples, destroy correlation and widen summaries.</li>
  <li>Queries needing sort order or index-only scans: BRIN supports neither.</li>
</ul>`,
  syntax: `CREATE INDEX name ON t USING brin (ts_col)
  [ WITH (pages_per_range = 32, autosummarize = on) ];

CREATE INDEX name ON t USING brin (ts_col timestamptz_minmax_multi_ops);   -- PG14+

SELECT brin_summarize_new_values('index_name');       -- summarise new ranges now
SELECT brin_summarize_range('index_name', block_no);
SELECT brin_desummarize_range('index_name', block_no);
SELECT correlation FROM pg_stats WHERE tablename = 't' AND attname = 'ts_col';`,
  examples: [
    { label: 'Basic', title: 'BRIN vs B-tree on 200,000 time-ordered readings',
      sql: `CREATE TABLE sensor_readings (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  sensor_id  int NOT NULL,
  reading_at timestamptz NOT NULL,
  value      numeric(6,2)
);
-- Append-only: one reading per minute, inserted in time order
INSERT INTO sensor_readings (sensor_id, reading_at, value)
SELECT (g % 50) + 1,
       timestamptz '2025-01-01 00:00+00' + g * interval '1 minute',
       round((random() * 100)::numeric, 2)
FROM generate_series(1, 200000) g;

CREATE INDEX idx_readings_brin  ON sensor_readings USING brin (reading_at);
CREATE INDEX idx_readings_btree ON sensor_readings (reading_at);
ANALYZE sensor_readings;

SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes WHERE relname = 'sensor_readings';

SELECT pg_size_pretty(pg_relation_size('sensor_readings')) AS table_size,
       (SELECT correlation FROM pg_stats
        WHERE tablename = 'sensor_readings' AND attname = 'reading_at') AS correlation;`,
      explain: `<p>The B-tree is <strong>4,408 kB</strong>; the BRIN is <strong>24 kB</strong> &mdash; 180x smaller &mdash; for an 11 MB table. <code>correlation = 1</code> means the physical row order exactly follows <code>reading_at</code>: the perfect BRIN case. On a 1 TB table the ratio is similar: tens of GB for a B-tree vs a few MB for BRIN.</p>`,
      output: ` indexrelname       | size
--------------------+---------
 idx_readings_brin  | 24 kB
 idx_readings_btree | 4408 kB

 table_size | correlation
------------+-------------
 11 MB      |           1`,
      run: true },
    { label: 'Intermediate', title: 'A one-day window: lossy bitmap scan reads 133 of 1,471 pages',
      sql: `CREATE TABLE sensor_readings (
  id bigint GENERATED ALWAYS AS IDENTITY, sensor_id int NOT NULL,
  reading_at timestamptz NOT NULL, value numeric(6,2));
INSERT INTO sensor_readings (sensor_id, reading_at, value)
SELECT (g % 50) + 1, timestamptz '2025-01-01 00:00+00' + g * interval '1 minute',
       round((random() * 100)::numeric, 2)
FROM generate_series(1, 200000) g;
CREATE INDEX idx_readings_brin ON sensor_readings USING brin (reading_at);
ANALYZE sensor_readings;

EXPLAIN ANALYZE
SELECT count(*), avg(value)
FROM sensor_readings
WHERE reading_at >= '2025-03-01 00:00+00' AND reading_at < '2025-03-02 00:00+00';`,
      explain: `<p>The BRIN node read 5 index pages and flagged one 128-page range (plus overlap); <code>Heap Blocks: lossy=128</code> confirms the bitmap contains whole pages, not individual rows. The heap scan rechecked ~ 17,400 rows and kept the 1,440 in the window (<code>Rows Removed by Index Recheck: 15968</code>). Total 133 buffers instead of 1,471 for a seq scan &mdash; 91% of the table skipped, with a 24 kB index.</p>
<p>Smaller <code>pages_per_range</code> would reduce the recheck overhead at the cost of a bigger (still tiny) index.</p>`,
      output: ` Aggregate  (cost=1740.48..1740.49 rows=1 width=40) (actual time=28.806..28.815 rows=1.00 loops=1)
   Buffers: shared hit=133
   ->  Bitmap Heap Scan on sensor_readings  (cost=12.39..1733.39 rows=1418 width=6) (actual time=9.492..12.442 rows=1440.00 loops=1)
         Recheck Cond: ((reading_at >= '2025-03-01 05:00:00+05'::timestamp with time zone) AND (reading_at < '2025-03-02 05:00:00+05'::timestamp with time zone))
         Rows Removed by Index Recheck: 15968
         Heap Blocks: lossy=128
         Buffers: shared hit=133
         ->  Bitmap Index Scan on idx_readings_brin  (cost=0.00..12.03 rows=16667 width=0) (actual time=1.016..1.018 rows=1280.00 loops=1)
               Index Cond: ((reading_at >= '2025-03-01 05:00:00+05'::timestamp with time zone) AND (reading_at < '2025-03-02 05:00:00+05'::timestamp with time zone))
               Index Searches: 1
               Buffers: shared hit=5
 Execution Time: 36.569 ms`,
      run: true },
    { label: 'Advanced', title: 'Look at the summaries; tune pages_per_range and opclass',
      sql: `CREATE TABLE sr AS
SELECT g AS id, timestamptz '2025-01-01 00:00+00' + g * interval '1 minute' AS reading_at
FROM generate_series(1, 200000) g;

CREATE INDEX sr_brin_128 ON sr USING brin (reading_at);                              -- default 128 pages
CREATE INDEX sr_brin_16  ON sr USING brin (reading_at) WITH (pages_per_range = 16);
CREATE INDEX sr_brin_mm  ON sr USING brin (reading_at timestamptz_minmax_multi_ops); -- PG14+

CREATE EXTENSION IF NOT EXISTS pageinspect;
-- Each item = one block range and its {min .. max}
SELECT itemoffset, blknum, value
FROM brin_page_items(get_raw_page('sr_brin_128', 2), 'sr_brin_128')
LIMIT 3;

-- New rows appended later are unsummarised until VACUUM / autosummarize / manual call
INSERT INTO sr SELECT g, timestamptz '2025-06-01 00:00+00' + g * interval '1 minute'
FROM generate_series(200001, 230000) g;
SELECT brin_summarize_new_values('sr_brin_128') AS ranges_summarised;`,
      explain: `<p><code>brin_page_items</code> shows the summary for each 128-page range starting at block 0, 128, 256&hellip;: about 16.4 days of readings each. A query for 3 February only touches the range starting at block 256.</p>
<p><code>pages_per_range = 16</code> gives 8x more (narrower) summaries &mdash; fewer pages rechecked per hit; all three variants still fit in the minimum 24 kB here. <code>minmax_multi</code> keeps several intervals per range, so a few out-of-order rows don't blow up the whole range's min/max.</p>
<p>After appending 30,000 rows, <code>brin_summarize_new_values</code> reports how many new ranges it summarised; until then those ranges match every query. Create the index <code>WITH (autosummarize = on)</code> to have autovacuum do it automatically.</p>`,
      output: ` itemoffset | blknum | value
------------+--------+----------------------------------------------------
          1 |      0 | {2025-01-01 05:01:00+05 .. 2025-01-17 15:40:00+05}
          2 |    128 | {2025-01-17 15:41:00+05 .. 2025-02-03 02:20:00+05}
          3 |    256 | {2025-02-03 02:21:00+05 .. 2025-02-19 13:00:00+05}

 ranges_summarised
-------------------
                 1`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Same data, but loaded in RANDOM order: correlation ~ 0
CREATE TABLE readings_shuffled AS
SELECT * FROM (
  SELECT (g % 50) + 1 AS sensor_id,
         timestamptz '2025-01-01 00:00+00' + g * interval '1 minute' AS reading_at,
         round((random() * 100)::numeric, 2) AS value
  FROM generate_series(1, 200000) g) s
ORDER BY random();
CREATE INDEX idx_shuffled_brin ON readings_shuffled USING brin (reading_at);
ANALYZE readings_shuffled;
SET enable_seqscan = off;
EXPLAIN ANALYZE SELECT count(*) FROM readings_shuffled
WHERE reading_at >= '2025-03-01 00:00+00' AND reading_at < '2025-03-02 00:00+00';
RESET enable_seqscan;
-- Heap Blocks: lossy=1280, Rows Removed by Index Recheck: 198560`,
      why: 'With no physical correlation every block range contains timestamps from the whole year, so every range matches: BRIN marks 1,280 of the table\'s pages and the executor rechecks 200,000 rows to find 1,440. BRIN is worse than a plain seq scan here.', run: true },
    good: { sql: `-- Time-ordered append-only data: correlation = 1
CREATE TABLE readings_ordered AS
SELECT (g % 50) + 1 AS sensor_id,
       timestamptz '2025-01-01 00:00+00' + g * interval '1 minute' AS reading_at,
       round((random() * 100)::numeric, 2) AS value
FROM generate_series(1, 200000) g;
CREATE INDEX idx_ordered_brin ON readings_ordered USING brin (reading_at);
ANALYZE readings_ordered;
EXPLAIN ANALYZE SELECT count(*) FROM readings_ordered
WHERE reading_at >= '2025-03-01 00:00+00' AND reading_at < '2025-03-02 00:00+00';
-- Heap Blocks: lossy=128 (one range), ~130 buffers`,
      why: 'Each block range covers a narrow, non-overlapping time slice, so only the range(s) containing 1 March are read. Check pg_stats.correlation before choosing BRIN; for random-order data use a B-tree (or CLUSTER the table once if it is static).', run: true }
  },
  mistakes: [
    `Creating BRIN on a column with low physical correlation (random keys, frequently updated rows) and wondering why nothing got faster.`,
    `Using BRIN for single-row lookups by id or user; it always reads entire block ranges.`,
    `Forgetting that newly appended ranges are unsummarised until VACUUM/autosummarize, making recent-data queries scan more than expected.`,
    `Bulk-loading historical backfill data <em>after</em> recent data (out of order), destroying correlation; load in time order or use <code>minmax_multi</code>.`,
    `Comparing BRIN and B-tree only by size: BRIN queries always pay a recheck cost proportional to the range size.`
  ],
  best: [
    `Use BRIN on append-only time columns of very large tables (and per-partition on time-partitioned tables).`,
    `Verify <code>pg_stats.correlation</code> &ge; ~ 0.9 (or &le; -0.9) before relying on BRIN.`,
    `Set <code>autosummarize = on</code> and tune <code>pages_per_range</code> (16&ndash;64 for narrower windows, default 128 for wide scans).`,
    `Combine: BRIN on the time column for range analytics + a B-tree on <code>(entity_id, ts)</code> for per-entity lookups, possibly only on recent partitions.`,
    `Consider <code>minmax_multi</code> when data is mostly but not perfectly ordered (late-arriving events).`
  ],
  performance: `
<p>BRIN index scan cost is negligible (a few pages); the heap part costs <code>matching ranges &times; pages_per_range</code> page reads plus a recheck of every row in them. Expected pages read &asymp; (window / total span) &times; table pages + up to 2 boundary ranges. Insert overhead is close to zero (only when a new range is summarised). Because heap reads are sequential within each range, BRIN scans also benefit from OS read-ahead, unlike scattered B-tree heap fetches.</p>`,
  security: `
<p>No special security considerations beyond normal table privileges. Note that BRIN summaries reveal min/max values per block range to anyone who can read raw index pages (superuser-only pageinspect), which is the same exposure level as the table itself.</p>`,
  scenario: {
    title: 'A 4 TB audit-log table whose B-tree indexes no longer fit anywhere',
    steps: [
      '1. audit_events (append-only, 9B rows) has a 310 GB B-tree on created_at; inserts slow down, and the index is mostly cold.',
      '2. Check correlation: SELECT correlation FROM pg_stats WHERE attname = \'created_at\' -> 0.999.',
      '3. Create a BRIN alternative: CREATE INDEX CONCURRENTLY audit_created_brin ON audit_events USING brin (created_at) WITH (pages_per_range = 64, autosummarize = on).',
      '4. Compare EXPLAIN (ANALYZE, BUFFERS) for typical "last 24 hours" and "one day last March" queries with both indexes; BRIN reads ~ 2% more pages but avoids 310 GB of index.',
      '5. Drop the B-tree concurrently; insert throughput improves ~ 25%, backup size shrinks by 310 GB.',
      '6. Long-term: partition by month so old partitions can be detached/archived and each partition has its own small BRIN.'
    ]
  },
  widgets: ['lab:index', 'diagram:storage-page'],
  interview: [
    { q: 'How does a BRIN index work and why is it so small?',
      a: 'It stores one summary tuple per block range (default 128 heap pages), e.g. the min and max of the column in those pages. Queries read all summaries, mark matching ranges in a lossy bitmap and recheck rows in those pages. Its size depends on the number of ranges, not rows, so it is kilobytes to megabytes even for terabyte tables.' },
    { q: 'What property of the data is required for BRIN to be effective, and how do you check it?',
      a: 'Strong correlation between the column values and the physical location of rows, typical of append-only data ordered by time. Check pg_stats.correlation for the column: values close to 1 or -1 are good; values near 0 mean every range overlaps every query and BRIN is useless.' },
    { q: 'What does Heap Blocks: lossy=128 mean in a plan?',
      a: 'The bitmap stored whole pages rather than individual tuple ids, so the Bitmap Heap Scan read 128 pages and had to recheck every tuple on them against the condition. BRIN bitmaps are always lossy; for other index types lossiness happens when the bitmap exceeds work_mem.' },
    { q: 'How do newly inserted rows interact with a BRIN index?',
      a: 'Ranges at the end of the table that have not been summarised are always treated as matching. They are summarised by VACUUM, by autovacuum when autosummarize = on, or manually with brin_summarize_new_values. Updates can widen an existing summary; it does not shrink until desummarized and resummarized.' }
  ],
  exercises: [
    { task: 'audit_logs.changed_at is filled in insertion order. Check its correlation and create a BRIN index on it with pages_per_range = 8.',
      solution: `SELECT attname, correlation FROM pg_stats
WHERE tablename = 'audit_logs' AND attname IN ('changed_at', 'id');
CREATE INDEX idx_audit_changed_brin ON audit_logs USING brin (changed_at)
  WITH (pages_per_range = 8, autosummarize = on);
SELECT pg_size_pretty(pg_relation_size('idx_audit_changed_brin')) AS brin_size;`, run: true },
    { task: 'Check whether orders.order_date is a good BRIN candidate using pg_stats, and explain your conclusion in a comment.',
      solution: `SELECT attname, correlation FROM pg_stats
WHERE tablename = 'orders' AND attname IN ('id', 'order_date');
-- id correlation ~ 1.0: physically ordered. order_date ~ 0.0: orders were
-- generated with random dates, so a BRIN on order_date would match every range.
-- Use a B-tree for order_date on this table.`, run: true }
  ],
  challenge: {
    task: 'Build a 100,000-row append-only log, create BRIN indexes with pages_per_range 128 and 8, and compare how many heap blocks each reads (EXPLAIN ANALYZE) for a one-hour window.',
    hint: 'Create both indexes, then drop one before each EXPLAIN so the planner must use the other. Compare Heap Blocks: lossy=N.',
    solution: `CREATE TABLE app_log AS
SELECT g AS id, timestamptz '2025-01-01 00:00+00' + g * interval '10 seconds' AS logged_at,
       md5(g::text) AS message
FROM generate_series(1, 100000) g;
CREATE INDEX app_log_brin_128 ON app_log USING brin (logged_at);
CREATE INDEX app_log_brin_8   ON app_log USING brin (logged_at) WITH (pages_per_range = 8);
ANALYZE app_log;
DROP INDEX app_log_brin_8;
EXPLAIN ANALYZE SELECT count(*) FROM app_log
WHERE logged_at >= '2025-01-03 10:00+00' AND logged_at < '2025-01-03 11:00+00';
CREATE INDEX app_log_brin_8 ON app_log USING brin (logged_at) WITH (pages_per_range = 8);
DROP INDEX app_log_brin_128;
EXPLAIN ANALYZE SELECT count(*) FROM app_log
WHERE logged_at >= '2025-01-03 10:00+00' AND logged_at < '2025-01-03 11:00+00';`,
    run: true
  },
  related: ['advanced-indexing-gin', 'advanced-indexing-hash-bloom', 'partitioning', 'indexes-btree-internals'],
  quiz: [
    { type: 'mcq', q: 'What does a default (minmax) BRIN index store?',
      options: ['Every value with its ctid', 'The min and max value for each range of heap pages', 'A hash of each row', 'A bloom filter per row'],
      answer: 1, explain: 'One summary per block range (pages_per_range pages).' },
    { type: 'scenario', q: 'pg_stats.correlation for created_at is 0.02. Should you use BRIN on it?',
      options: ['Yes, BRIN is always smaller', 'No: rows are not physically ordered by created_at, so most ranges will match', 'Yes, with pages_per_range = 1', 'Only with fastupdate'],
      answer: 1, explain: 'BRIN relies on physical correlation; near 0 means summaries are uselessly wide.' },
    { type: 'tf', q: 'BRIN indexes can support Index Only Scans.',
      answer: false, explain: 'BRIN only supports lossy bitmap scans; it stores no individual values.' },
    { type: 'predict', q: 'What appears in the Bitmap Heap Scan node of a BRIN plan?',
      code: `EXPLAIN ANALYZE SELECT count(*) FROM sensor_readings
WHERE reading_at >= '2025-03-01' AND reading_at < '2025-03-02';`,
      options: ['Heap Blocks: exact=1440', 'Heap Blocks: lossy=128 and Rows Removed by Index Recheck', 'Heap Fetches: 0', 'Index Cond on the heap'],
      answer: 1, explain: 'BRIN bitmaps are page-level (lossy), so all rows in those pages are rechecked.' },
    { type: 'index', q: '50 TB append-only clickstream, queries always by a time window of hours to days. Primary index choice for the time column?',
      options: ['B-tree', 'BRIN (per partition)', 'GIN', 'Hash'],
      answer: 1, explain: 'Correlated append-only time data is BRIN\'s ideal workload; size stays tiny.' }
  ]
},

{
  id: 'advanced-indexing-hash-bloom',
  module: 'advanced-indexing',
  title: 'Hash and Bloom Indexes, and Choosing the Right Index Type',
  level: 4,
  minutes: 22,
  summary: 'When a hash index beats a B-tree (long keys, equality only), how the bloom extension indexes any combination of many columns, and a complete index-type chooser.',
  objectives: [
    'Explain how a hash index works and its limits (equality only, no uniqueness, no multi-column, no ordering)',
    'Show when a hash index is smaller than a B-tree (long random keys)',
    'Install the bloom extension and build a bloom index over many columns with length/colN tuning',
    'Explain false positives and why bloom results are always rechecked',
    'Pick the right index type for a given operator and workload using the chooser table'
  ],
  concept: `
<p><strong>Hash index analogy: a cloakroom.</strong> You hand over your coat and get ticket #417. To get it back, the attendant goes straight to hook 417 &mdash; no alphabetical search. But you can't ask "give me all coats between #400 and #450 in order". A <strong>hash index</strong> (<span class="tag core">core</span>) stores a 32-bit hash of the key in buckets; lookup = hash the search value, go to its bucket, compare. It supports <strong>only <code>=</code></strong>.</p>
<p>Since PostgreSQL 10, hash indexes are WAL-logged and crash-safe (earlier versions warned against them). Their niche: <em>equality on long values</em> such as URLs, API tokens, SHA-256 digests. A hash entry is always 4 bytes of hash + ctid, regardless of key length, so the index can be several times smaller than a B-tree that must store the whole 64-character key. Limits: no unique indexes, single column only, no ordering, no index-only scans, no <code>LIKE</code>/ranges.</p>
<p><strong>Bloom index analogy: a quick "might contain" stamp.</strong> Imagine each catalogue card has a strip of 80 tiny boxes; for each attribute (brand=3, color=5, size=7&hellip;) you tick a few boxes chosen by hashing that value. To search "size 7 AND material 42", you check whether the boxes for size 7 and material 42 are all ticked on each card. If not, the item <em>definitely</em> doesn't match; if yes, it <em>probably</em> does (false positives possible). That's the <strong>bloom</strong> index &mdash; an <span class="tag ext">extension</span> shipped in contrib, not core: <code>CREATE EXTENSION bloom</code>.</p>
<p>A bloom index stores one small signature per row covering <em>all</em> indexed columns, so it serves <strong>any combination</strong> of equality conditions on those columns with one index &mdash; where B-trees would need a different column order for each combination. It is always scanned completely (it's a compact sequential filter, not a tree), supports only <code>=</code> on int4 and text out of the box, and its results are always rechecked against the heap.</p>`,
  why: `
<p>Not every access pattern fits a B-tree well. Hash indexes exist for compact, fast equality on wide keys. Bloom indexes exist for "ad-hoc filter on any subset of many attributes" (faceted search, data-exploration tools, wide lookup tables) where creating every useful composite B-tree would multiply storage and write cost. Knowing all index types &mdash; and being able to justify picking one &mdash; is what separates a DBA from someone who only ever types <code>CREATE INDEX</code>.</p>`,
  useCase: `
<p><strong>Hash:</strong> a URL-shortener stores 900M long URLs and looks them up by exact URL for de-duplication. A B-tree on <code>long_url</code> was 140 GB; a hash index is 38 GB and lookups are equally fast. Short codes (the primary key) keep their B-tree.</p>
<p><strong>Bloom:</strong> a telecom analytics tool lets engineers filter 200M call records by any combination of 8 attributes (circle, tower, technology, handset brand, plan, roaming flag, result code, hour). One bloom index of ~ 3 GB answers any 2&ndash;4 attribute filter with a single sequential read of the bloom file plus a few thousand heap pages, replacing a dozen composite B-trees totalling 40 GB.</p>`,
  internals: `
<p><strong>Hash:</strong> the index has a metapage, bucket pages, overflow pages and bitmap pages. Each entry stores the 32-bit hash code (not the key), sorted by hash within a page, plus the ctid. Lookup computes the hash, maps it to a bucket via the metapage's masks, reads that bucket's pages and rechecks the real key on the heap (hash collisions). Buckets split incrementally as the table grows (linear hashing), which avoids a full rehash.</p>
<p><strong>Bloom:</strong> each index tuple = ctid + a signature of <code>length</code> bits (default 80, rounded to multiples of 16). For each column <em>i</em>, <code>col<em>i</em></code> bits (default 2) are set, derived from hashes of the value. A query computes the signature of its conditions and scans <em>every</em> index tuple, keeping those whose signature contains all query bits. False-positive rate depends on length and bits per column: more bits = fewer false positives but a bigger index.</p>
<p><strong>BRIN bloom (PG14+)</strong> is different: a BRIN opclass (<code>int4_bloom_ops</code> etc.) storing a bloom filter per block range, for equality searches on uncorrelated columns of huge tables.</p>`,
  whenNot: `
<ul>
  <li><strong>Hash</strong>: never for ranges, sorting, uniqueness, multi-column, or short keys (an int B-tree is just as compact and more capable). Before PG10, never at all.</li>
  <li><strong>Bloom</strong>: not for highly selective single-column lookups (a B-tree is much faster), not for ranges, not for types other than int4/text without writing an opclass, and not for tables where the bloom index itself would be scanned thousands of times per second (it's always a full index scan).</li>
  <li>In PostgreSQL 18, B-tree <strong>skip scan</strong> narrows the bloom niche: a composite B-tree with low-cardinality leading columns can now serve many non-prefix combinations too. Measure both.</li>
</ul>`,
  syntax: `-- Hash (core)
CREATE INDEX name ON t USING hash (col);

-- Bloom (extension shipped with PostgreSQL contrib)
CREATE EXTENSION IF NOT EXISTS bloom;
CREATE INDEX name ON t USING bloom (c1, c2, c3, ...)
  WITH (length = 80, col1 = 2, col2 = 2, col3 = 4, ...);   -- bits per signature / per column

-- Which capabilities does each access method have?
SELECT amname, pg_indexam_has_property(oid, 'can_order') FROM pg_am WHERE amtype = 'i';`,
  examples: [
    { label: 'Basic', title: 'Hash vs B-tree on 64-character session tokens',
      sql: `CREATE TABLE api_sessions (
  token      text PRIMARY KEY,                 -- B-tree (created by PRIMARY KEY)
  user_id    int NOT NULL,
  created_at timestamptz DEFAULT now()
);
INSERT INTO api_sessions (token, user_id)
SELECT md5(g::text) || md5((g * 7)::text), (g % 60) + 1
FROM generate_series(1, 50000) g;

CREATE INDEX idx_sessions_token_hash ON api_sessions USING hash (token);
ANALYZE api_sessions;

SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes WHERE relname = 'api_sessions';

-- Equality: the planner picks the hash index
EXPLAIN SELECT user_id FROM api_sessions WHERE token = md5('42') || md5('294');

-- Range: hash is useless, the B-tree is used
EXPLAIN SELECT user_id FROM api_sessions WHERE token > 'ff';`,
      explain: `<p>The hash index is <strong>~3x smaller</strong> (2,064 kB vs 6,064 kB) because it stores a 4-byte hash code instead of the 64-character token. For the equality lookup its cost (8.02) beats the B-tree, so it is chosen. For <code>&gt;</code> only the B-tree can help: hash order has nothing to do with key order.</p>
<p>Note we still need the PRIMARY KEY B-tree for uniqueness &mdash; hash indexes cannot be UNIQUE. In a real design you might keep only the hash index plus an application-generated random token whose collisions are astronomically unlikely, or keep both if uniqueness must be enforced.</p>`,
      output: ` indexrelname            | size
-------------------------+---------
 api_sessions_pkey       | 6064 kB
 idx_sessions_token_hash | 2064 kB

 Index Scan using idx_sessions_token_hash on api_sessions  (cost=0.00..8.02 rows=1 width=4)
   Index Cond: (token = 'a1d0c6e83f027327d8461063f4ac58a66883966fd8f918a4aa29be29d2c386fb'::text)

 Bitmap Heap Scan on api_sessions  (cost=13.49..354.94 rows=139 width=4)
   Recheck Cond: (token > 'ff'::text)
   ->  Bitmap Index Scan on api_sessions_pkey  (cost=0.00..13.46 rows=139 width=0)
         Index Cond: (token > 'ff'::text)`,
      run: true },
    { label: 'Intermediate', title: 'Bloom: one index for any combination of 5 attributes',
      sql: `CREATE EXTENSION IF NOT EXISTS bloom;   -- extension, not core

CREATE TABLE product_filters AS
SELECT g AS id,
       (random() * 10)::int  AS brand_id,
       (random() * 20)::int  AS color_id,
       (random() * 50)::int  AS size_id,
       (random() * 100)::int AS material_id,
       (random() * 5)::int   AS region_id
FROM generate_series(1, 100000) g;

-- More bits for high-cardinality columns (size, material)
CREATE INDEX idx_pf_bloom ON product_filters
  USING bloom (brand_id, color_id, size_id, material_id, region_id)
  WITH (length = 80, col1 = 2, col2 = 2, col3 = 4, col4 = 4, col5 = 2);
ANALYZE product_filters;

-- Filter on the 3rd and 4th columns only: no B-tree prefix would fit
EXPLAIN ANALYZE
SELECT count(*) FROM product_filters WHERE size_id = 7 AND material_id = 42;`,
      explain: `<p>The bloom index is read in full (197 buffers &mdash; the whole 1.5 MB index) and yields 19 candidate rows, all on distinct pages (<code>Heap Blocks: exact=19</code>). Every candidate is rechecked (<code>Recheck Cond</code>) to discard false positives. Any other combination (<code>color_id AND region_id</code>, <code>brand_id AND size_id AND material_id</code>&hellip;) uses the same index.</p>
<p>Data is random, so your exact counts will differ slightly from run to run.</p>`,
      output: ` Aggregate  (cost=1864.96..1864.97 rows=1 width=8) (actual time=1.852..1.903 rows=1.00 loops=1)
   Buffers: shared hit=216
   ->  Bitmap Heap Scan on product_filters  (cost=1792.01..1864.91 rows=21 width=0) (actual time=1.783..1.878 rows=19.00 loops=1)
         Recheck Cond: ((size_id = 7) AND (material_id = 42))
         Heap Blocks: exact=19
         Buffers: shared hit=216
         ->  Bitmap Index Scan on idx_pf_bloom  (cost=0.00..1792.00 rows=21 width=0) (actual time=1.642..1.645 rows=19.00 loops=1)
               Index Cond: ((size_id = 7) AND (material_id = 42))
               Index Searches: 1
               Buffers: shared hit=197
 Execution Time: 2.036 ms`,
      run: true },
    { label: 'Advanced', title: 'Index access-method capabilities straight from the catalog',
      sql: `SELECT a.amname,
       pg_indexam_has_property(a.oid, 'can_order')     AS can_order,
       pg_indexam_has_property(a.oid, 'can_unique')    AS can_unique,
       pg_indexam_has_property(a.oid, 'can_multi_col') AS multi_col,
       pg_indexam_has_property(a.oid, 'can_include')   AS can_include
FROM pg_am a
WHERE a.amtype = 'i'
ORDER BY a.amname;

-- Hash cannot enforce uniqueness
DO $$
BEGIN
  CREATE UNIQUE INDEX uq_users_username_hash ON users USING hash (username);
EXCEPTION WHEN feature_not_supported THEN
  RAISE NOTICE '%', SQLERRM;
END $$;`,
      explain: `<p><code>pg_indexam_has_property()</code> reads the capabilities each access method advertises. Only <strong>B-tree</strong> can order and enforce uniqueness; hash cannot even do multi-column. GiST and SP-GiST support INCLUDE columns; GIN and BRIN do not. (Bloom appears here too once the extension is installed in the database.)</p>`,
      output: ` amname | can_order | can_unique | multi_col | can_include
--------+-----------+------------+-----------+-------------
 brin   | f         | f          | t         | f
 btree  | t         | t          | t         | t
 gin    | f         | f          | t         | f
 gist   | f         | f          | t         | t
 hash   | f         | f          | f         | f
 spgist | f         | f          | f         | t

NOTICE:  access method "hash" does not support unique indexes
DO`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE TABLE product_filters AS
SELECT g AS id, (random()*10)::int AS brand_id, (random()*20)::int AS color_id,
       (random()*50)::int AS size_id, (random()*100)::int AS material_id,
       (random()*5)::int AS region_id
FROM generate_series(1, 100000) g;
-- One wide B-tree, queried on non-leading columns
CREATE INDEX idx_pf_btree ON product_filters (brand_id, color_id, size_id, material_id, region_id);
ANALYZE product_filters;
EXPLAIN ANALYZE SELECT count(*) FROM product_filters WHERE size_id = 7 AND material_id = 42;
-- PG18 skip scan: Index Searches: 231, ~700 buffers, 4 MB index`,
      why: 'size_id and material_id are the 3rd and 4th key columns. PG18 rescues the B-tree with skip scan, but it must probe all 11 x 21 = 231 brand/color combinations (about 700 buffers). Before PG18 this was a full index scan. Supporting every combination well would need several differently ordered B-trees.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS bloom;
CREATE TABLE product_filters AS
SELECT g AS id, (random()*10)::int AS brand_id, (random()*20)::int AS color_id,
       (random()*50)::int AS size_id, (random()*100)::int AS material_id,
       (random()*5)::int AS region_id
FROM generate_series(1, 100000) g;
CREATE INDEX idx_pf_bloom ON product_filters
  USING bloom (brand_id, color_id, size_id, material_id, region_id)
  WITH (length = 80, col1 = 2, col2 = 2, col3 = 4, col4 = 4, col5 = 2);
ANALYZE product_filters;
EXPLAIN ANALYZE SELECT count(*) FROM product_filters WHERE size_id = 7 AND material_id = 42;
-- one bloom scan: ~200 buffers, 1.5 MB index serving every combination`,
      why: 'A bloom signature covers all five columns, so any equality combination costs one sequential pass over a small index (about 2.5x smaller than the B-tree) plus rechecks. Ideal for ad-hoc multi-attribute filters; still benchmark against PG18 skip scan for your data.', run: true }
  },
  mistakes: [
    `Avoiding hash indexes because of pre-PG10 advice ("not crash-safe"). Since PostgreSQL 10 they are WAL-logged and replicated.`,
    `Using a hash index on small integer keys, where a B-tree is equally compact and supports far more operations.`,
    `Expecting a hash index to enforce uniqueness or serve <code>ORDER BY</code>, <code>LIKE</code> or ranges.`,
    `Forgetting that bloom is an extension (<code>CREATE EXTENSION bloom</code>) and only supports equality on int4 and text by default.`,
    `Using bloom for a selective single-column lookup that is executed thousands of times per second: every query scans the entire bloom index.`
  ],
  best: [
    `Default to B-tree; choose another type only when the operator or data shape requires it, and justify it with EXPLAIN (ANALYZE, BUFFERS).`,
    `Use hash for equality-only lookups on long keys (URLs, tokens, digests) where size matters.`,
    `Use bloom for ad-hoc equality filters across many low/medium-cardinality columns in analytical tools; tune <code>length</code> and <code>colN</code> for the false-positive rate you can accept.`,
    `Document index-type decisions in migrations ("hash: equality only on 200-char URL; uniqueness via app-level random token").`,
    `Re-evaluate bloom and multi-index strategies after upgrading to PG18 (skip scan).`
  ],
  performance: `
<p><strong>Index type chooser</strong> (operators and workloads &rarr; access method):</p>
<table>
<tr><th>Need</th><th>Typical operators</th><th>Best index</th><th>Notes</th></tr>
<tr><td>Equality, ranges, sorting, uniqueness</td><td><code>= &lt; &lt;= &gt; &gt;= BETWEEN IN</code>, <code>ORDER BY</code>, prefix <code>LIKE</code></td><td>B-tree</td><td>Default; multi-column, INCLUDE, index-only scans, PG18 skip scan</td></tr>
<tr><td>Equality only on long keys</td><td><code>=</code></td><td>Hash</td><td>Smaller for wide keys; no unique/order/multi-column</td></tr>
<tr><td>Contains / element membership</td><td>jsonb <code>@&gt; ? ?| ?&amp;</code>, array <code>@&gt; &amp;&amp; &lt;@</code>, tsvector <code>@@</code></td><td>GIN</td><td>Fast reads, expensive writes, fastupdate pending list</td></tr>
<tr><td>Substring / fuzzy text</td><td><code>LIKE/ILIKE '%x%'</code>, <code>~</code>, <code>%</code> similarity</td><td>GIN or GiST + <code>pg_trgm</code> <span class="tag ext">extension</span></td><td>GiST also gives distance ordering <code>&lt;-&gt;</code></td></tr>
<tr><td>Ranges, geometry, overlap, exclusion</td><td><code>&amp;&amp; @&gt; &lt;@ -|-</code>, <code>EXCLUDE</code></td><td>GiST</td><td>btree_gist for mixing scalars; PostGIS for real geography</td></tr>
<tr><td>Nearest neighbour</td><td><code>ORDER BY col &lt;-&gt; x LIMIT k</code></td><td>GiST / SP-GiST</td><td>Vectors: pgvector HNSW/IVFFlat (extension)</td></tr>
<tr><td>Space-partitioned data</td><td>points, <code>inet &lt;&lt;</code>, text <code>^@</code></td><td>SP-GiST</td><td>Quad-trees, k-d trees, radix tries</td></tr>
<tr><td>Huge append-only, correlated column</td><td>ranges on time/id</td><td>BRIN</td><td>KB-sized; needs physical correlation</td></tr>
<tr><td>Any combination of many equality filters</td><td><code>=</code> on N columns</td><td>Bloom <span class="tag ext">extension</span></td><td>Lossy, full index scan, always rechecked</td></tr>
</table>
<p>Hash lookups are O(1) bucket reads, similar to a 2&ndash;3 level B-tree in practice; their real advantage is size (better caching). Bloom cost is proportional to index size (full scan) plus false-positive heap visits.</p>`,
  security: `
<p>Hash indexes on secrets (API tokens) still let the database find rows by the secret; the bigger risk is storing raw tokens at all. Store a SHA-256 digest of the token (and index that, hash or B-tree), so a database leak doesn't expose usable credentials. Extensions such as bloom must be installed by a privileged role; review which extensions are allowed in your environment (managed clouds often have an allow-list).</p>`,
  scenario: {
    title: 'Choosing indexes for a new "shipment search" screen',
    steps: [
      '1. Requirements: exact lookup by 40-char tracking number; filter by any combination of origin hub, destination hub, carrier, service level, status; date range on shipped_at; free-text search on recipient name.',
      '2. Tracking number (equality only, long, unique required): B-tree UNIQUE (needs uniqueness) - hash would be smaller but cannot enforce it.',
      '3. Attribute combinations: start with composite B-trees for the 2-3 most frequent combinations (from product analytics); evaluate a bloom index for the long tail.',
      '4. shipped_at on 3B append-only rows: BRIN per monthly partition plus B-tree (status, shipped_at) on the current partition only.',
      '5. Recipient name contains/typo search: pg_trgm GIN.',
      '6. Load-test with realistic data, read EXPLAIN (ANALYZE, BUFFERS) for each filter combination, drop indexes that are never chosen.'
    ]
  },
  widgets: ['lab:index'],
  interview: [
    { q: 'When would you use a hash index in modern PostgreSQL?',
      a: 'For equality-only lookups on long values such as URLs, digests or tokens, where uniqueness enforcement and ordering are not needed. The index stores 4-byte hash codes instead of whole keys, so it can be several times smaller than a B-tree and stays in cache better. Since PostgreSQL 10 hash indexes are WAL-logged and crash-safe.' },
    { q: 'What is a bloom index and what are its trade-offs?',
      a: 'An extension index type that stores, per row, a fixed-size bit signature built from hashes of all indexed columns. It supports equality conditions on any subset of those columns with one index. The whole index is scanned for every query, matches are probabilistic (false positives are rechecked against the heap), and only equality on supported types works.' },
    { q: 'Which index types support uniqueness, ordering and INCLUDE columns?',
      a: 'Only B-tree supports UNIQUE and ordered scans. INCLUDE is supported by B-tree, GiST and SP-GiST. GIN, BRIN and hash support none of these. You can check with pg_indexam_has_property on pg_am.' },
    { q: 'A table has a GIN, a GiST, a BRIN and four B-trees. How do you decide which are worth keeping?',
      a: 'Check pg_stat_user_indexes.idx_scan over a representative period, map each index to the queries that use it (pg_stat_statements plus EXPLAIN), look for prefixes and duplicates, and weigh their size and write cost (n_tup_upd vs n_tup_hot_upd, WAL volume) against the query benefit. Drop unused or redundant ones concurrently.' }
  ],
  exercises: [
    { task: 'Create a hash index on customers.email and show that an equality lookup can use it while ORDER BY email cannot.',
      solution: `CREATE INDEX idx_customers_email_hash ON customers USING hash (email);
SET enable_seqscan = off;
EXPLAIN SELECT id FROM customers WHERE email = 'customer7@example.com';
EXPLAIN SELECT id, email FROM customers ORDER BY email LIMIT 5;  -- uses the B-tree, not hash
RESET enable_seqscan;`, run: true },
    { task: 'Build a bloom index on employees(department_id, manager_id) (cast to int4 is already the type) and query employees by manager 3 with enable_seqscan off to see it used.',
      solution: `CREATE EXTENSION IF NOT EXISTS bloom;
CREATE INDEX idx_employees_bloom ON employees USING bloom (department_id, manager_id);
SET enable_seqscan = off;
EXPLAIN SELECT first_name, last_name FROM employees WHERE manager_id = 3;
RESET enable_seqscan;`, run: true }
  ],
  challenge: {
    task: 'Compare three ways to support WHERE color_id = ? AND region_id = ? on product_filters (100k random rows): (1) composite B-tree (color_id, region_id), (2) bloom over 5 columns, (3) two single-column B-trees with BitmapAnd. Report each index size and the chosen plan when only that strategy exists.',
    hint: 'Create the table once; create/drop indexes between EXPLAINs; use pg_relation_size.',
    solution: `CREATE EXTENSION IF NOT EXISTS bloom;
CREATE TABLE pf AS
SELECT g AS id, (random()*10)::int AS brand_id, (random()*20)::int AS color_id,
       (random()*50)::int AS size_id, (random()*100)::int AS material_id, (random()*5)::int AS region_id
FROM generate_series(1, 100000) g;
ANALYZE pf;
-- (1) composite B-tree
CREATE INDEX pf_cr ON pf (color_id, region_id);
SELECT pg_size_pretty(pg_relation_size('pf_cr')) AS composite_size;
EXPLAIN SELECT count(*) FROM pf WHERE color_id = 5 AND region_id = 2;
DROP INDEX pf_cr;
-- (2) bloom
CREATE INDEX pf_bloom ON pf USING bloom (brand_id, color_id, size_id, material_id, region_id);
SELECT pg_size_pretty(pg_relation_size('pf_bloom')) AS bloom_size;
EXPLAIN SELECT count(*) FROM pf WHERE color_id = 5 AND region_id = 2;
DROP INDEX pf_bloom;
-- (3) two single-column indexes
CREATE INDEX pf_c ON pf (color_id);
CREATE INDEX pf_r ON pf (region_id);
EXPLAIN SELECT count(*) FROM pf WHERE color_id = 5 AND region_id = 2;`,
    run: true
  },
  related: ['advanced-indexing-gin', 'advanced-indexing-brin', 'advanced-indexing-gist-spgist', 'indexes-composite', 'extensions'],
  quiz: [
    { type: 'tf', q: 'Since PostgreSQL 10, hash indexes are WAL-logged and safe to use after a crash and on replicas.',
      answer: true, explain: 'PG10 made hash indexes crash-safe and replicated, and improved their performance.' },
    { type: 'mcq', q: 'Which statement about bloom indexes is correct?',
      options: ['They are core PostgreSQL and support ranges', 'They are an extension; one index serves equality on any subset of its columns, with rechecks for false positives', 'They are exact and never need rechecks', 'They replace GIN for jsonb'],
      answer: 1, explain: 'bloom is a contrib extension with probabilistic signatures.' },
    { type: 'index', q: '1 billion rows, lookups by exact 150-character URL, no uniqueness required, no ranges. Smallest suitable index?',
      options: ['B-tree on url', 'Hash on url', 'GIN on url', 'BRIN on url'],
      answer: 1, explain: 'Hash stores a 4-byte code per entry instead of the 150-char key.' },
    { type: 'design', q: 'Analysts filter a wide fact table by any 2-3 of 8 low-cardinality attributes. Which strategy minimizes the number of indexes?',
      options: ['8 single-column B-trees', 'All 8! column orderings as composite B-trees', 'One bloom index over the 8 columns (benchmark vs PG18 skip scan)', 'A hash index per column'],
      answer: 2, explain: 'A single bloom index serves arbitrary equality combinations.' },
    { type: 'mcq', q: 'Which index types can enforce UNIQUE?',
      options: ['B-tree only', 'B-tree and hash', 'B-tree, GiST and GIN', 'All of them'],
      answer: 0, explain: 'Only B-tree has can_unique. (Exclusion constraints use GiST for more general rules.)' }
  ]
},

{
  id: 'advanced-indexing-statistics',
  module: 'advanced-indexing',
  title: 'Index Selectivity, Cardinality and Planner Statistics',
  level: 4,
  minutes: 28,
  summary: 'Learn how the planner estimates rows from pg_stats (null_frac, n_distinct, most_common_vals, histograms, correlation), why it ignores indexes, and how CREATE STATISTICS fixes correlated-column misestimates.',
  objectives: [
    'Define selectivity and cardinality and compute an estimate by hand from pg_stats',
    'Read pg_stats: null_frac, n_distinct, most_common_vals/freqs, histogram_bounds, correlation',
    'Explain the planner\'s independence assumption and the misestimates it causes',
    'Fix correlated-column estimates with CREATE STATISTICS (dependencies, ndistinct, mcv)',
    'Raise per-column statistics targets and know when ANALYZE must run',
    'List the main reasons the planner ignores an index'
  ],
  concept: `
<p><strong>Analogy: a census bureau.</strong> A city planner doesn't count every resident before deciding where to build a school; they consult census summaries: "12% of households have children under 10, the top 5 neighbourhoods are&hellip;". PostgreSQL's planner does the same: <code>ANALYZE</code> samples the table (300 &times; <code>default_statistics_target</code> = 30,000 rows by default) and stores summaries per column in <code>pg_statistic</code>, readable via the <code>pg_stats</code> view.</p>
<ul>
  <li><strong>Selectivity</strong> = fraction of rows a predicate keeps (0..1). <strong>Cardinality</strong> = estimated row count = selectivity &times; <code>reltuples</code>.</li>
  <li><code>null_frac</code> &ndash; fraction of NULLs.</li>
  <li><code>n_distinct</code> &ndash; number of distinct values (positive), or a negative fraction of rows when it scales with table size (-1 = unique).</li>
  <li><code>most_common_vals</code> / <code>most_common_freqs</code> (MCV) &ndash; the most frequent values and their frequencies: exact estimates for skewed data.</li>
  <li><code>histogram_bounds</code> &ndash; equal-population buckets for the remaining values: used for ranges.</li>
  <li><code>correlation</code> &ndash; how well physical row order follows the column's sort order (+1/-1 ideal for index range scans and BRIN).</li>
</ul>
<p><strong>Example from company_db:</strong> <code>orders.status</code> has MCVs <code>{delivered, shipped, paid, cancelled, pending}</code> with freqs <code>{0.5054, 0.1644, 0.1616, 0.0856, 0.083}</code>. So <code>status = 'pending'</code> &rarr; 0.083 &times; 5000 = 415 rows (bitmap scan), <code>status = 'delivered'</code> &rarr; 2,527 rows (seq scan &mdash; reading half the table via an index is pointless), and <code>status = 'refunded'</code> (not in the list, no other values) &rarr; 1 row (index scan). Same index, three different plans: <strong>selectivity drives plan choice</strong>.</p>
<p><strong>The independence assumption:</strong> for <code>WHERE a = 1 AND b = 2</code> the planner multiplies selectivities as if columns were independent. In real data they often aren't: city determines country. <code>country = 'India' AND city = 'Mumbai'</code> is estimated as 0.376 &times; 0.126 &times; 500 = 24 rows, actual 63. Multiply that error through a few joins and the planner picks a nested loop that runs a million times. <strong>Extended statistics</strong> (<code>CREATE STATISTICS</code>) teach the planner about such correlations.</p>`,
  why: `
<p>Every plan decision &mdash; index or seq scan, nested loop or hash join, hash aggregate or sort &mdash; is driven by row estimates. Indexes don't help if the planner thinks a predicate returns 50% of rows; a great plan for 10 rows is a disaster for 10 million. Most "PostgreSQL chose a terrible plan" incidents trace back to bad estimates: stale statistics, correlated columns, functions on columns, or skewed data beyond the MCV list. Fixing statistics is often cheaper and more robust than adding indexes or hints.</p>`,
  useCase: `
<p><strong>Logistics company, "shipments by origin city and state"</strong>: the planner estimated 30 rows for <code>state = 'MH' AND city = 'Pune'</code> (actual 410,000) and chose a nested loop into a 2-billion-row tracking-events table: 40 minutes. <code>CREATE STATISTICS st_geo (dependencies, mcv) ON state, city FROM shipments; ANALYZE shipments;</code> fixed the estimate; the planner switched to a hash join: 9 seconds. No index or query change was needed.</p>`,
  internals: `
<p><strong>Equality estimate:</strong> if the value is in the MCV list, use its frequency. Otherwise selectivity = (1 &minus; sum(MCV freqs) &minus; null_frac) / (n_distinct &minus; number of MCVs). <strong>Range estimate:</strong> fraction of histogram buckets covered (with linear interpolation inside the boundary bucket) plus matching MCVs. <strong>Functions/expressions</strong> without statistics get hard-coded defaults: 0.5% for equality (<code>DEFAULT_EQ_SEL</code>), 33% for inequality (<code>DEFAULT_INEQ_SEL</code>) &mdash; that's why <code>date_part('year', order_date) = 2025</code> is estimated at 25 rows (5000 &times; 0.005) when the actual is 2,098. An expression index gives the expression its own statistics.</p>
<p><strong>Extended statistics</strong> kinds: <code>dependencies</code> (functional dependency degree: "city &rArr; country" = 1.0), <code>ndistinct</code> (distinct count of column combinations &mdash; fixes GROUP BY estimates), <code>mcv</code> (most common <em>combinations</em> &mdash; best for equality on several columns). Since PG14 extended statistics can also be built on expressions. They are computed by ANALYZE and visible in <code>pg_stats_ext</code>.</p>
<p><strong>Freshness:</strong> autovacuum runs ANALYZE when changed rows exceed <code>autovacuum_analyze_threshold + autovacuum_analyze_scale_factor &times; reltuples</code> (50 + 10%). For a 1-billion-row table that's 100M changes &mdash; stats can be weeks old, so new date ranges look "empty" to the planner. Tune the scale factor per table or run ANALYZE after big loads. <code>pg_stat_user_tables.n_mod_since_analyze</code> shows the backlog.</p>`,
  whenNot: `
<ul>
  <li>Don't blindly raise <code>default_statistics_target</code> globally to 10,000: ANALYZE becomes slower and planning of every query reading those stats gets more expensive. Raise it per column where skew matters.</li>
  <li>Don't create extended statistics on every column pair "just in case"; each adds ANALYZE time and planner overhead. Create them for columns that appear together in WHERE/GROUP BY and show proven misestimates.</li>
  <li>Statistics can't fix non-sargable predicates or parameter-sensitive generic plans; those need query or design changes.</li>
</ul>`,
  syntax: `ANALYZE [ VERBOSE ] [ table [ (column, ...) ] ];
ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000;        -- per-column sample target (-1 = default)
ALTER TABLE t ALTER COLUMN c SET (n_distinct = -0.05);   -- override distinct estimate

CREATE STATISTICS [ IF NOT EXISTS ] name [ ( dependencies | ndistinct | mcv [, ...] ) ]
  ON col1, col2 [, ...]  -- or expressions (PG14+)
  FROM table;
ALTER STATISTICS name SET STATISTICS 500;

SELECT * FROM pg_stats     WHERE tablename = 't';
SELECT * FROM pg_stats_ext WHERE statistics_name = 'name';`,
  examples: [
    { label: 'Basic', title: 'Same index, three plans: selectivity decides',
      sql: `CREATE INDEX idx_orders_status ON orders (status);
ANALYZE orders;

SELECT attname, null_frac, n_distinct, most_common_vals, most_common_freqs, correlation
FROM pg_stats WHERE tablename = 'orders' AND attname = 'status';

EXPLAIN SELECT * FROM orders WHERE status = 'delivered';  -- 50.5% of rows
EXPLAIN SELECT * FROM orders WHERE status = 'pending';    -- 8.3%
EXPLAIN SELECT * FROM orders WHERE status = 'refunded';   -- not present at all`,
      explain: `<p>The MCV list contains every status with its exact frequency. 0.5054 &times; 5000 = 2,527 rows for delivered: the planner ignores the index (Seq Scan). 0.083 &times; 5000 = 415 for pending: Bitmap scan. <code>refunded</code> is not an order status, so the estimate bottoms out at 1 row: plain Index Scan.</p>
<p>The <code>correlation</code> of 0.33 says rows are only loosely ordered by status on disk, which makes index range scans on status more expensive (more random heap access).</p>`,
      output: ` attname | null_frac | n_distinct | most_common_vals                           | most_common_freqs                     | correlation
---------+-----------+------------+--------------------------------------------+---------------------------------------+-------------
 status  |         0 |          5 | {delivered,shipped,paid,cancelled,pending} | {0.5054,0.1644,0.1616,0.0856,0.083}   |  0.33279178

 Seq Scan on orders  (cost=0.00..151.50 rows=2527 width=36)
   Filter: (status = 'delivered'::text)

 Bitmap Heap Scan on orders  (cost=7.50..101.69 rows=415 width=36)
   Recheck Cond: (status = 'pending'::text)
   ->  Bitmap Index Scan on idx_orders_status  (cost=0.00..7.39 rows=415 width=0)
         Index Cond: (status = 'pending'::text)

 Index Scan using idx_orders_status on orders  (cost=0.28..8.30 rows=1 width=36)
   Index Cond: (status = 'refunded'::text)`,
      run: true },
    { label: 'Intermediate', title: 'Correlated columns: fix the estimate with CREATE STATISTICS',
      sql: `-- city determines country, but the planner assumes independence
EXPLAIN ANALYZE SELECT id FROM customers WHERE country = 'India' AND city = 'Mumbai';
EXPLAIN SELECT country, city, count(*) FROM customers GROUP BY country, city;

CREATE STATISTICS st_customers_geo (dependencies, ndistinct, mcv)
  ON country, city FROM customers;
ANALYZE customers;

EXPLAIN ANALYZE SELECT id FROM customers WHERE country = 'India' AND city = 'Mumbai';
EXPLAIN SELECT country, city, count(*) FROM customers GROUP BY country, city;

SELECT statistics_name, dependencies FROM pg_stats_ext
WHERE statistics_name = 'st_customers_geo';`,
      explain: `<p><strong>Before:</strong> estimate 24 rows (0.376 &times; 0.126 &times; 500), actual 63 &mdash; a 2.6x underestimate. GROUP BY country, city is estimated at <strong>48</strong> groups (6 countries &times; 8 cities) but only 8 combinations exist.</p>
<p><strong>After CREATE STATISTICS + ANALYZE:</strong> 63 estimated = 63 actual, and 8 groups. The <code>dependencies</code> output shows attribute 5 (city) &rArr; attribute 4 (country) with degree 1.0 (city fully determines country) and country &rArr; city 0.624. On this tiny table the plan shape doesn't change, but in a join pipeline a 2.6x error per predicate compounds into 100x errors.</p>`,
      output: `-- BEFORE
 Seq Scan on customers  (cost=0.00..14.50 rows=24 width=4) (actual time=0.294..5.009 rows=63.00 loops=1)
   Filter: ((country = 'India'::text) AND (city = 'Mumbai'::text))
   Rows Removed by Filter: 437

 HashAggregate  (cost=15.75..16.23 rows=48 width=20)
   Group Key: country, city
   ->  Seq Scan on customers  (cost=0.00..12.00 rows=500 width=12)

CREATE STATISTICS
ANALYZE

-- AFTER
 Seq Scan on customers  (cost=0.00..14.50 rows=63 width=4) (actual time=0.047..0.443 rows=63.00 loops=1)
   Filter: ((country = 'India'::text) AND (city = 'Mumbai'::text))
   Rows Removed by Filter: 437

 HashAggregate  (cost=15.75..15.83 rows=8 width=20)
   Group Key: country, city
   ->  Seq Scan on customers  (cost=0.00..12.00 rows=500 width=12)

 statistics_name  | dependencies
------------------+------------------------------------------
 st_customers_geo | {"4 => 5": 0.624000, "5 => 4": 1.000000}`,
      run: true },
    { label: 'Advanced', title: 'Functions destroy estimates; statistics targets',
      sql: `-- Function on the column: default 0.5% selectivity guess
EXPLAIN ANALYZE SELECT id FROM orders WHERE date_part('year', order_date) = 2025;
-- Sargable range: estimated from the histogram
EXPLAIN ANALYZE SELECT id FROM orders
WHERE order_date >= '2025-01-01' AND order_date < '2026-01-01';

-- More detailed statistics for a skewed column
SHOW default_statistics_target;
ALTER TABLE orders ALTER COLUMN customer_id SET STATISTICS 1000;
ANALYZE orders;
SELECT attname, array_length(most_common_vals::text::text[], 1) AS mcv_entries
FROM pg_stats WHERE tablename = 'orders' AND attname = 'customer_id';`,
      explain: `<p><code>date_part('year', ...) = 2025</code> has no statistics, so the planner uses the default equality selectivity 0.005 &times; 5000 = <strong>25 rows; actual 2,098</strong> (84x off). The equivalent range predicate is estimated at 2,097 from the histogram &mdash; near perfect &mdash; and could also use an index on <code>order_date</code>.</p>
<p>With the default target (100) the MCV list holds at most 100 values; raising the column's target to 1000 lets ANALYZE sample more rows and keep up to 1000 MCVs (499 here &mdash; almost every customer), giving precise estimates for skewed per-customer counts.</p>`,
      output: ` Seq Scan on orders  (cost=0.00..164.00 rows=25 width=8) (actual time=1.260..6.653 rows=2098.00 loops=1)
   Filter: (date_part('year'::text, order_date) = '2025'::double precision)
   Rows Removed by Filter: 2902

 Seq Scan on orders  (cost=0.00..164.00 rows=2097 width=8) (actual time=0.070..1.847 rows=2098.00 loops=1)
   Filter: ((order_date >= '2025-01-01 00:00:00+05'::timestamp with time zone) AND (order_date < '2026-01-01 00:00:00+05'::timestamp with time zone))
   Rows Removed by Filter: 2902

 default_statistics_target
---------------------------
 100

 attname     | mcv_entries
-------------+-------------
 customer_id |         499`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Planner multiplies independent selectivities: 24 estimated vs 63 actual
EXPLAIN ANALYZE
SELECT c.id, count(o.id)
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'India' AND c.city = 'Mumbai'
GROUP BY c.id;`,
      why: 'Without extended statistics the customer estimate is 2.6x too low, and the error propagates into the join and aggregate estimates. On large tables such errors flip join strategies (nested loop vs hash) and memory decisions.', run: true },
    good: { sql: `CREATE STATISTICS st_customers_geo (dependencies, mcv) ON country, city FROM customers;
ANALYZE customers;
EXPLAIN ANALYZE
SELECT c.id, count(o.id)
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'India' AND c.city = 'Mumbai'
GROUP BY c.id;`,
      why: 'The mcv/dependencies statistics let the planner estimate the combined predicate correctly (63 rows), so downstream join and aggregation estimates are right too. A one-line, zero-risk fix that needs no query rewrite.', run: true }
  },
  mistakes: [
    `Never running <code>ANALYZE</code> after bulk loads, migrations or <code>CREATE INDEX</code> on expressions, leaving the planner with stale or default estimates.`,
    `Assuming autovacuum keeps statistics fresh on huge tables: with the default 10% scale factor, a 1B-row table is re-analyzed only after 100M changes.`,
    `Blaming the index ("PostgreSQL ignores my index") when the real issue is a misestimate; always compare <code>rows=</code> estimated vs actual first.`,
    `Wrapping columns in functions (<code>date_part</code>, <code>lower</code>, casts) and then wondering why estimates are wildly off.`,
    `Setting <code>default_statistics_target</code> very high globally instead of per column, slowing ANALYZE and planning everywhere.`
  ],
  best: [
    `Diagnose with <code>EXPLAIN ANALYZE</code>: find the lowest plan node where estimated and actual rows diverge by &gt;10x; fix the cause there.`,
    `Use <code>CREATE STATISTICS</code> for columns that are correlated and filtered/grouped together (country/city, make/model, tenant/plan).`,
    `Raise statistics targets per column for skewed distributions (customer_id, tenant_id) used in critical queries.`,
    `Set per-table autovacuum analyze thresholds for large or fast-changing tables (<code>ALTER TABLE ... SET (autovacuum_analyze_scale_factor = 0.01)</code>).`,
    `Run <code>VACUUM (ANALYZE)</code> as the last step of ETL jobs and after <code>pg_upgrade</code> (statistics are not migrated before PG18; PG18 can preserve them).`
  ],
  performance: `
<p>ANALYZE samples 300 &times; target rows per table regardless of table size, so it's fast even on huge tables (seconds), but a higher target means a bigger sample and more planning work. Extended statistics add a little ANALYZE time and planning time per relevant query. The payoff can be enormous: correct estimates prevent the classic catastrophes &mdash; nested loops over millions of rows, hash tables spilling to disk, sorts instead of index scans.</p>
<p><strong>Why the planner ignores an index</strong> (checklist): (1) predicate matches too many rows; (2) table is tiny; (3) stale/missing stats; (4) non-sargable predicate (function, cast, type mismatch); (5) leading column of composite index not constrained; (6) operator not supported by the index type / opclass / collation; (7) partial index predicate not implied; (8) <code>random_page_cost</code> too high for SSD storage; (9) the estimated cost really is higher (low correlation).</p>`,
  security: `
<p><code>pg_stats</code> exposes sample values (most_common_vals, histogram bounds) &mdash; potentially sensitive data. PostgreSQL only shows rows for columns the current user has SELECT privilege on, and the underlying <code>pg_statistic</code> is superuser-only. With row-level security, statistics still summarise all rows; leakproof function rules prevent most leaks via planner estimates, but treat statistics as sensitive in highly regulated systems.</p>`,
  scenario: {
    title: 'Monthly report suddenly takes 40 minutes on the 1st of the month',
    steps: [
      '1. The report filters WHERE created_at >= date_trunc(\'month\', now()) on a 900M-row table.',
      '2. EXPLAIN ANALYZE: Index Scan estimated rows=1, actual 2,400,000; nested loop into line_items executes 2.4M times.',
      '3. Cause: statistics are from 9 days ago; the histogram\'s upper bound is before this month, so the planner believes no rows exist.',
      '4. Immediate fix: ANALYZE the table (a few seconds); the plan flips to a hash join, 50 s.',
      '5. Permanent fix: ALTER TABLE ... SET (autovacuum_analyze_scale_factor = 0.005) and schedule an ANALYZE right after the nightly load.',
      '6. Bonus: CREATE STATISTICS on (region, product_line) which the report groups by, fixing an additional 30x group-count misestimate.'
    ]
  },
  widgets: ['lab:plan', 'diagram:query-pipeline'],
  interview: [
    { q: 'How does the planner estimate the number of rows for WHERE status = \'pending\'?',
      a: 'It looks up the column in pg_statistic. If the value is in most_common_vals it uses the matching frequency times reltuples. Otherwise it spreads the remaining non-null, non-MCV fraction evenly across the remaining distinct values (n_distinct minus the number of MCVs). For ranges it uses histogram_bounds plus MCVs.' },
    { q: 'What problem do extended statistics solve? Give an example.',
      a: 'The planner assumes columns are independent and multiplies selectivities. For correlated columns like city and country this underestimates combined predicates and overestimates group counts. CREATE STATISTICS (dependencies, ndistinct, mcv) ON country, city lets ANALYZE capture the dependency and frequent combinations, fixing those estimates.' },
    { q: 'Give five reasons the planner might not use an existing index.',
      a: 'Low selectivity (too many matching rows), tiny table, stale or missing statistics, a non-sargable predicate (function or cast on the column, or type mismatch), the leading column of a composite index is not constrained, the operator or collation is not supported by the index opclass, a partial index predicate that the query does not imply, or cost settings like random_page_cost making index access look expensive.' },
    { q: 'What does a negative n_distinct mean?',
      a: 'It means the number of distinct values is expressed as a fraction of the row count, because ANALYZE believes it grows with the table. -1 means every value is distinct (unique); -0.47 means roughly 47% of rows have distinct values.' }
  ],
  exercises: [
    { task: 'Compute by hand (in SQL) the estimated row count for payments.method = \'upi\' from pg_stats and compare it with EXPLAIN.',
      solution: `SELECT round(f.freq * c.reltuples) AS my_estimate
FROM (SELECT (most_common_freqs[array_position(most_common_vals::text::text[], 'upi')]) AS freq
      FROM pg_stats WHERE tablename = 'payments' AND attname = 'method') AS f,
     pg_class c
WHERE c.relname = 'payments';
EXPLAIN SELECT * FROM payments WHERE method = 'upi';`, run: true },
    { task: 'Create extended statistics on users(role, tenant_id), run ANALYZE and list them from pg_stats_ext.',
      solution: `CREATE STATISTICS st_users_role_tenant (ndistinct, mcv) ON role, tenant_id FROM users;
ANALYZE users;
SELECT statistics_name, attnames, n_distinct
FROM pg_stats_ext WHERE statistics_name = 'st_users_role_tenant';`, run: true }
  ],
  challenge: {
    task: 'Show an estimation error caused by an expression and fix it WITHOUT changing the query: estimate for WHERE lower(email) LIKE \'customer4%\' on customers, then create expression statistics with CREATE STATISTICS (PG14+), ANALYZE, and compare. (An expression index would also collect statistics for the expression.)',
    hint: 'Expression indexes collect statistics for their expression; you can also use CREATE STATISTICS ON (lower(email)) FROM customers in PG14+.',
    solution: `EXPLAIN ANALYZE SELECT id FROM customers WHERE lower(email) LIKE 'customer4%';
CREATE STATISTICS st_customers_lower_email ON (lower(email)) FROM customers;
ANALYZE customers;
EXPLAIN ANALYZE SELECT id FROM customers WHERE lower(email) LIKE 'customer4%';`,
    run: true
  },
  related: ['advanced-indexing-maintenance', 'query-optimization-planner', 'explain-analyze', 'query-analysis-diagnosis-checklist'],
  quiz: [
    { type: 'mcq', q: 'orders.status MCV freq for \'pending\' is 0.083 and reltuples = 5000. Estimated rows?',
      options: ['83', '415', '5000', '1'],
      answer: 1, explain: '0.083 x 5000 = 415.' },
    { type: 'predict', q: 'No statistics exist for the expression. What row estimate do you expect on 5,000 rows?',
      code: `EXPLAIN SELECT * FROM orders WHERE date_part('year', order_date) = 2025;`,
      options: ['2098 (exact)', '25 (default 0.5% equality selectivity)', '5000', '1667 (one third)'],
      answer: 1, explain: 'Equality on an expression without stats uses DEFAULT_EQ_SEL = 0.005.' },
    { type: 'tf', q: 'CREATE STATISTICS (ndistinct) ON country, city improves GROUP BY country, city row estimates.',
      answer: true, explain: 'ndistinct statistics give the number of distinct combinations directly (8 instead of 6 x 8 = 48).' },
    { type: 'scenario', q: 'A query is fast all month but slow on the 1st; EXPLAIN ANALYZE shows rows=1 estimated vs 2M actual for a created_at >= start-of-month filter. Fix?',
      options: ['Add more indexes', 'ANALYZE the table and lower its autovacuum_analyze_scale_factor', 'Increase shared_buffers', 'VACUUM FULL'],
      answer: 1, explain: 'Stale histogram: new date range is beyond the recorded upper bound.' },
    { type: 'mcq', q: 'Which pg_stats column tells you whether a BRIN index or an index range scan will have good locality?',
      options: ['null_frac', 'n_distinct', 'correlation', 'avg_width'],
      answer: 2, explain: 'correlation measures physical order vs logical order.' }
  ]
},

{
  id: 'advanced-indexing-maintenance',
  module: 'advanced-indexing',
  title: 'Index Maintenance: Bloat, REINDEX, CONCURRENTLY, Unused Indexes and HOT Updates',
  level: 4,
  minutes: 28,
  summary: 'Keep indexes healthy in production: measure bloat, rebuild with REINDEX CONCURRENTLY, create/drop online, find unused and duplicate indexes, and reduce write amplification with HOT updates.',
  objectives: [
    'Explain how UPDATEs and DELETEs create index bloat and why VACUUM does not shrink indexes',
    'Rebuild indexes online with REINDEX ... CONCURRENTLY and know its failure modes',
    'Create and drop indexes without blocking writes (CONCURRENTLY) and clean up INVALID indexes',
    'Find unused and duplicate indexes with pg_stat_user_indexes and pg_index',
    'Explain write amplification and HOT (heap-only tuple) updates, and tune fillfactor for them',
    'Build a repeatable index-maintenance routine'
  ],
  concept: `
<p><strong>Analogy: a library's card catalogue after years of use.</strong> Every time a book is moved or replaced, a new card is added and the old one is stamped "withdrawn" but stays in the drawer until someone cleans up. The drawers become fat with withdrawn cards (bloat). A cleaner (VACUUM) removes withdrawn cards, leaving gaps that new cards can fill, but the drawers don't shrink. To get compact drawers you must re-write the whole catalogue (REINDEX).</p>
<p><strong>Why bloat happens:</strong> PostgreSQL's MVCC never updates a row in place. An <code>UPDATE</code> writes a new row version (new ctid) and, unless it's a HOT update, inserts a new entry into <em>every</em> index of the table &mdash; even indexes on columns that didn't change. The old entries remain until VACUUM removes them. VACUUM makes the space reusable but rarely returns index pages to the OS; after mass updates/deletes an index can stay 2&ndash;5x larger than necessary. In our demo, two full-table updates grew a 336 kB index to 976 kB; VACUUM left it at 976 kB; <code>REINDEX</code> brought it back to 360 kB.</p>
<p><strong>HOT (Heap-Only Tuple) updates</strong> avoid most of this: if no <em>indexed</em> column changes <strong>and</strong> the new version fits on the <strong>same heap page</strong>, PostgreSQL links the new version from the old one inside the page and touches no index at all. Leaving free space in pages (<code>fillfactor</code> &lt; 100) makes HOT much more likely.</p>
<p><strong>Online operations:</strong> plain <code>CREATE INDEX</code>/<code>REINDEX</code> block writes (and REINDEX also blocks reads that use that index). The <code>CONCURRENTLY</code> variants build a new index while allowing writes, then swap it in &mdash; slower, cannot run inside a transaction block, and can leave an <code>INVALID</code> index behind if they fail.</p>
<p><strong>Unused indexes</strong> are pure cost: they slow every write, bloat WAL and backups, and occupy cache. <code>pg_stat_user_indexes.idx_scan = 0</code> over a representative period (including month-end jobs!) identifies candidates.</p>`,
  why: `
<p>Index count and health directly drive write throughput, WAL volume, replication lag, backup size and cache efficiency. Teams commonly accumulate 15&ndash;25 indexes on hot tables over years; half are unused or redundant. Meanwhile bloated indexes make every lookup touch more pages. A disciplined maintenance routine &mdash; measure, drop unused, rebuild bloated, tune HOT &mdash; often buys more performance than any new index.</p>`,
  useCase: `
<p><strong>Payments platform:</strong> the <code>transactions</code> table (1.2B rows) had 19 indexes and suffered 40 GB/hour of WAL. Audit: 7 indexes with <code>idx_scan = 0</code> over 45 days, 2 duplicates, 3 that were prefixes of others. Dropping 9 indexes (<code>DROP INDEX CONCURRENTLY</code>) cut WAL by 35% and replication lag from minutes to seconds. Setting <code>fillfactor = 85</code> on the table and removing an index on the frequently-updated <code>last_status_at</code> column raised the HOT ratio from 4% to 71%. Monthly <code>REINDEX CONCURRENTLY</code> of the two most-bloated indexes keeps them 40% smaller.</p>`,
  internals: `
<p><strong>CREATE INDEX CONCURRENTLY (CIC):</strong> (1) adds the index to the catalog as not-ready/invalid; (2) waits for all transactions that could have the old catalog snapshot; (3) first table scan builds the index; (4) waits again, then a second pass ("validate") adds entries for rows inserted/updated during the build; (5) waits for older snapshots and marks the index valid. Long-running transactions anywhere in the database delay the waits. If it fails (deadlock, unique violation, cancel), the index remains <code>indisvalid = false</code>: it is still maintained on writes but never used for reads &mdash; you must <code>DROP INDEX CONCURRENTLY</code> it and retry.</p>
<p><strong>REINDEX CONCURRENTLY</strong> (PG12+) builds a new index alongside the old one (named <code>..._ccnew</code>), swaps them, and drops the old one (temporarily <code>..._ccold</code>). Leftover <code>_ccnew</code>/<code>_ccold</code> indexes after a failure must be dropped manually.</p>
<p><strong>HOT details:</strong> the new tuple version is stored on the same page and marked heap-only; the old version's line pointer redirects to it after pruning. Index entries keep pointing to the root of the HOT chain. Counters: <code>pg_stat_user_tables.n_tup_upd</code> vs <code>n_tup_hot_upd</code> (and PG16+ <code>n_tup_newpage_upd</code> for updates that had to move to another page). <strong>Bottom-up index deletion</strong> (PG14+) and <strong>deduplication</strong> (PG13+) reduce B-tree bloat from non-HOT updates.</p>
<p><strong>Write amplification:</strong> one logical UPDATE of one column = 1 new heap tuple + N index insertions (non-HOT) + WAL for each (+ full-page images after checkpoints). With 10 indexes, one update can produce 11 page modifications.</p>`,
  whenNot: `
<ul>
  <li>Don't schedule blind nightly <code>REINDEX</code> of everything; rebuild only indexes with measured bloat. Rebuilding is I/O-heavy and generates lots of WAL.</li>
  <li>Don't drop an index just because <code>idx_scan = 0</code> since yesterday's stats reset, or because it's unused on the primary while replica queries depend on it (statistics are per-server!). Unique/PK indexes enforce constraints even with zero scans.</li>
  <li>Don't use <code>VACUUM FULL</code> to fix index bloat on a live system: it takes an <code>ACCESS EXCLUSIVE</code> lock on the whole table. Use <code>REINDEX CONCURRENTLY</code> (or pg_repack, a third-party tool, for table bloat).</li>
  <li>Don't lower fillfactor on insert-only tables; it just wastes space.</li>
</ul>`,
  syntax: `CREATE INDEX CONCURRENTLY [IF NOT EXISTS] name ON t (cols);
DROP INDEX CONCURRENTLY [IF EXISTS] name;              -- one index, no CASCADE
REINDEX INDEX CONCURRENTLY name;                       -- PG12+
REINDEX TABLE CONCURRENTLY t;
REINDEX (VERBOSE) INDEX name;                          -- blocking variant
ALTER TABLE t SET (fillfactor = 85);                   -- leave room for HOT updates
ALTER INDEX name SET (fillfactor = 80);

SELECT * FROM pg_stat_user_indexes;                    -- idx_scan, idx_tup_read, last_idx_scan (PG16+)
SELECT * FROM pg_stat_user_tables;                     -- n_tup_upd, n_tup_hot_upd, n_dead_tup
SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;`,
  examples: [
    { label: 'Basic', title: 'Create bloat, see VACUUM not shrink it, fix with REINDEX CONCURRENTLY',
      sql: `CREATE TABLE bloat_demo (id int PRIMARY KEY, status text, amount numeric);
CREATE INDEX idx_bloat_status ON bloat_demo (status);
INSERT INTO bloat_demo SELECT g, 'new', g FROM generate_series(1, 50000) g;

SELECT pg_size_pretty(pg_relation_size('bloat_demo'))       AS heap,
       pg_size_pretty(pg_relation_size('idx_bloat_status')) AS idx_status,
       pg_size_pretty(pg_relation_size('bloat_demo_pkey'))  AS pkey;

-- Two full-table updates of an INDEXED column: no HOT possible
UPDATE bloat_demo SET status = 'processed';
UPDATE bloat_demo SET status = 'archived';
SELECT pg_stat_force_next_flush();     -- make counters visible immediately
SELECT n_live_tup, n_dead_tup, n_tup_upd, n_tup_hot_upd
FROM pg_stat_user_tables WHERE relname = 'bloat_demo';

VACUUM bloat_demo;                       -- removes dead entries, keeps the pages
SELECT pg_size_pretty(pg_relation_size('idx_bloat_status')) AS idx_status_after_vacuum,
       pg_size_pretty(pg_relation_size('bloat_demo_pkey'))  AS pkey_after_vacuum;

REINDEX TABLE CONCURRENTLY bloat_demo;   -- rebuilds every index online
SELECT pg_size_pretty(pg_relation_size('idx_bloat_status')) AS idx_status_after_reindex,
       pg_size_pretty(pg_relation_size('bloat_demo_pkey'))  AS pkey_after_reindex;`,
      explain: `<p>Each UPDATE created 50,000 new heap versions <em>and</em> 50,000 new entries in <strong>both</strong> indexes (even the primary key, whose value didn't change), because the indexed <code>status</code> column changed &mdash; <code>n_tup_hot_upd = 0</code>. The status index nearly tripled (336 kB &rarr; 976 kB), the PK doubled.</p>
<p><code>VACUUM</code> removes dead index entries but does not give pages back: sizes are unchanged. <code>REINDEX TABLE CONCURRENTLY</code> rebuilds compact indexes without blocking writes: 360 kB and 1,112 kB. (The heap itself stays 7 MB until rows are rewritten; heap bloat needs <code>VACUUM FULL</code> or pg_repack.)</p>`,
      output: ` heap    | idx_status | pkey
---------+------------+---------
 2168 kB | 336 kB     | 1112 kB

UPDATE 50000
UPDATE 50000

 n_live_tup | n_dead_tup | n_tup_upd | n_tup_hot_upd
------------+------------+-----------+---------------
      50000 |     100000 |    100000 |             0

VACUUM
 idx_status_after_vacuum | pkey_after_vacuum
-------------------------+-------------------
 976 kB                  | 2440 kB

REINDEX
 idx_status_after_reindex | pkey_after_reindex
--------------------------+--------------------
 360 kB                   | 1112 kB`,
      run: true },
    { label: 'Intermediate', title: 'HOT updates: fillfactor and non-indexed columns',
      sql: `-- Leave 20% free space in each heap page for HOT updates
CREATE TABLE hot_demo (id int PRIMARY KEY, status text, amount numeric)
  WITH (fillfactor = 80);
CREATE INDEX idx_hot_status ON hot_demo (status);
INSERT INTO hot_demo SELECT g, 'new', g FROM generate_series(1, 10000) g;

-- (1) update a NON-indexed column
UPDATE hot_demo SET amount = amount + 1;
SELECT pg_stat_force_next_flush();
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relname = 'hot_demo';

-- (2) update an INDEXED column: HOT is impossible
UPDATE hot_demo SET status = 'done';
SELECT pg_stat_force_next_flush();
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relname = 'hot_demo';`,
      explain: `<p><strong>(1)</strong> <code>amount</code> is not indexed, so updates are HOT-eligible; 2,516 of 10,000 were HOT &mdash; exactly the rows whose new version fit into the 20% free space of their page. Once a page's free space is used up, the remaining updates must go to another page and become non-HOT. Updating the whole table at once is the worst case; typical OLTP touches a few rows per page between VACUUMs, so HOT ratios of 80&ndash;95% are achievable.</p>
<p><strong>(2)</strong> <code>status</code> is indexed: 0 additional HOT updates. Each of the 10,000 updates inserted into both indexes. <strong>Every index on a frequently updated column disables HOT for those updates</strong> &mdash; a hidden cost of "harmless" indexes.</p>`,
      output: ` n_tup_upd | n_tup_hot_upd
-----------+---------------
     10000 |          2516

 n_tup_upd | n_tup_hot_upd
-----------+---------------
     20000 |          2516`,
      run: true },
    { label: 'Advanced', title: 'Find unused and duplicate indexes; online create/drop',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
CREATE INDEX idx_orders_total      ON orders (total_amount);
CREATE INDEX idx_orders_cust_dup   ON orders (customer_id);   -- accidental duplicate
SELECT count(*) FROM orders WHERE customer_id = 7;            -- uses an index
SELECT pg_stat_force_next_flush();

-- Unused, non-constraint indexes (largest first)
SELECT s.relname AS table_name, s.indexrelname AS index_name, s.idx_scan,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
ORDER BY pg_relation_size(s.indexrelid) DESC;

-- Exact duplicates: same table, columns, opclasses, expressions and predicate
SELECT indrelid::regclass AS table_name, array_agg(indexrelid::regclass) AS duplicates
FROM pg_index
GROUP BY indrelid, indkey::text, indclass::text,
         coalesce(indexprs::text, ''), coalesce(indpred::text, '')
HAVING count(*) > 1;`,
      explain: `<p>The planner happened to pick <code>idx_orders_cust_dup</code> for the lookup, so its twin shows zero scans &mdash; with exact duplicates, one of them is always dead weight. The first query lists indexes never scanned since statistics were last reset (here: since the sandbox started, so the pre-existing <code>idx_order_items_order</code> etc. show too). In production, check <code>pg_stat_database.stats_reset</code> and make sure the window covers all workloads (month-end, replicas). Unique and primary-key indexes are excluded because they enforce constraints.</p>
<p>The duplicate finder groups indexes by everything that defines their behaviour. One of the pair can be dropped with <code>DROP INDEX CONCURRENTLY</code>. Also look for <em>prefix</em> redundancy: <code>(a)</code> is usually redundant next to <code>(a, b)</code>.</p>`,
      output: ` table_name  | index_name               | idx_scan | index_size
-------------+--------------------------+----------+------------
 order_items | idx_order_items_order    |        0 | 216 kB
 orders      | idx_orders_total         |        0 | 176 kB
 orders      | idx_orders_customer_id   |        0 | 64 kB
 employees   | idx_employees_department |        0 | 16 kB
 documents   | idx_documents_search     |        0 | 16 kB

 table_name | duplicates
------------+------------------------------------------------
 orders     | {idx_orders_customer_id,idx_orders_cust_dup}`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Plain CREATE INDEX takes a SHARE lock: INSERT/UPDATE/DELETE on payments
-- wait until the build finishes (minutes to hours on a big table)
CREATE INDEX idx_payments_order_id ON payments (order_id);
SELECT indexrelid::regclass, indisvalid FROM pg_index
WHERE indrelid = 'payments'::regclass;`,
      why: 'Fine in development, but on a production table being written to it stalls every writer for the entire build. Connection pools fill up with waiting sessions and the application times out.', run: true },
    good: { sql: `-- Online build: writers keep working; must run outside a transaction block
CREATE INDEX CONCURRENTLY idx_payments_order_id ON payments (order_id);
-- Always verify the result: a failed CIC leaves an INVALID index behind
SELECT indexrelid::regclass, indisvalid, indisready FROM pg_index
WHERE indrelid = 'payments'::regclass;`,
      why: 'CONCURRENTLY takes only a SHARE UPDATE EXCLUSIVE lock, so normal reads and writes continue. It is slower (two table scans and waits for old transactions) and must be checked: if indisvalid = false, DROP INDEX CONCURRENTLY and retry.', run: true }
  },
  mistakes: [
    `Running <code>CREATE INDEX</code> (without CONCURRENTLY) or <code>VACUUM FULL</code> on a busy production table and blocking all writes.`,
    `Ignoring INVALID indexes left by a failed <code>CREATE INDEX CONCURRENTLY</code>: they are still maintained on every write but never used.`,
    `Running <code>CREATE INDEX CONCURRENTLY</code> inside a migration framework's transaction (error: "cannot run inside a transaction block"); disable the per-migration transaction for that step.`,
    `Dropping an index with <code>idx_scan = 0</code> on the primary that a read replica's reporting queries depend on (statistics are per server).`,
    `Indexing frequently updated columns (<code>last_seen_at</code>, <code>updated_at</code>, counters) "just in case", killing HOT updates for the whole table.`,
    `Expecting <code>VACUUM</code> to shrink bloated indexes; it only makes space reusable.`
  ],
  best: [
    `Always use <code>CREATE/DROP INDEX CONCURRENTLY</code> and <code>REINDEX ... CONCURRENTLY</code> in production, with <code>lock_timeout</code> set and a post-check for <code>indisvalid</code>.`,
    `Review unused/duplicate/prefix-redundant indexes quarterly, across primary and replicas, with a long enough stats window.`,
    `Monitor the HOT ratio (<code>n_tup_hot_upd / n_tup_upd</code>) on update-heavy tables; use <code>fillfactor</code> 80&ndash;90 and avoid indexing hot-updated columns.`,
    `Estimate bloat (pgstattuple's <code>pgstatindex</code> where available, or catalog-based estimation queries) and rebuild only indexes above a threshold, e.g. 30% bloat and &gt; 1 GB.`,
    `Rely on autovacuum, tuned per table, to keep dead entries from accumulating; bloat grows fastest when VACUUM is starved by long-running transactions.`
  ],
  performance: `
<p>Write cost scales with the number of indexes: in the benchmarking lesson, inserting 100k rows took ~ 180 ms with no indexes and ~ 1,250 ms with three. Non-HOT updates pay one insertion per index; HOT updates pay none. Bloated indexes make scans read more pages and reduce cache efficiency. <code>REINDEX CONCURRENTLY</code> needs roughly the index size in extra disk space, generates WAL proportional to the index size, and takes longer than plain REINDEX (it waits for concurrent transactions). Throttle large rebuilds outside peak hours and watch replication lag.</p>`,
  security: `
<p>CREATE/REINDEX/DROP INDEX require table ownership (or, since PG17, the MAINTAIN privilege for REINDEX). Grant maintenance rights to a dedicated DBA/maintenance role rather than to the application role. Set <code>lock_timeout</code> in migration sessions so a blocked DDL statement fails fast instead of queueing behind long transactions and blocking everyone behind it (a classic self-inflicted outage).</p>`,
  scenario: {
    title: 'Write-heavy table: WAL volume and replication lag keep growing',
    steps: [
      '1. Measure: pg_stat_user_tables for transactions shows n_tup_hot_upd / n_tup_upd = 3%; 19 indexes; WAL 40 GB/h.',
      '2. List index usage over 45 days on primary AND replicas; 7 indexes have idx_scan = 0 everywhere.',
      '3. Run the duplicate/prefix query: 2 exact duplicates, 3 prefixes of composite indexes.',
      '4. DROP INDEX CONCURRENTLY the 12 candidates one by one (with lock_timeout = \'5s\'), monitoring query latency after each.',
      '5. One remaining index is on last_status_at, updated on every status change; replace it with a partial index used by the only query needing it.',
      '6. ALTER TABLE transactions SET (fillfactor = 85); new pages leave room for HOT; HOT ratio climbs to ~70% over weeks.',
      '7. REINDEX INDEX CONCURRENTLY the two most bloated indexes found with pgstatindex.',
      '8. Result: WAL -35%, replication lag from minutes to seconds, p99 update latency -40%.'
    ]
  },
  widgets: ['lab:index', 'diagram:mvcc'],
  interview: [
    { q: 'What is a HOT update and what prevents it?',
      a: 'A heap-only tuple update stores the new row version on the same heap page and links it from the old version, without inserting any new index entries. It requires that no indexed column (including columns in expression and partial index predicates) changes and that there is enough free space on the page. Indexing frequently updated columns or full pages (fillfactor 100) prevent HOT.' },
    { q: 'How does CREATE INDEX CONCURRENTLY work, and what can go wrong?',
      a: 'It registers the index as invalid, waits for transactions that might not see it, scans the table to build it, waits again and does a second validation pass for rows changed during the build, then marks it valid. It cannot run in a transaction block, takes longer, waits for long-running transactions, and if it fails (e.g. unique violation, deadlock, cancellation) leaves an INVALID index that must be dropped and recreated.' },
    { q: 'Why doesn\'t VACUUM shrink a bloated index, and how do you fix it?',
      a: 'VACUUM removes dead index entries and marks empty pages reusable, but it doesn\'t compact or truncate the index file in general. To return space you rebuild the index: REINDEX INDEX CONCURRENTLY (PG12+) online, or REINDEX / VACUUM FULL with heavier locks.' },
    { q: 'How do you safely identify indexes to drop?',
      a: 'Use pg_stat_user_indexes.idx_scan over a long, representative window on every server that runs queries (primary and replicas), exclude unique/primary-key/exclusion-constraint indexes, check for duplicates and prefix-redundant indexes in pg_index, confirm with query logs or pg_stat_statements, then drop concurrently one at a time and monitor.' }
  ],
  exercises: [
    { task: 'Show the HOT ratio for every user table that has had updates, as a percentage.',
      solution: `SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_user_tables
WHERE n_tup_upd > 0
ORDER BY n_tup_upd DESC;`, run: true },
    { task: 'List all INVALID indexes in the database (left behind by failed concurrent builds) with their table.',
      solution: `SELECT i.indexrelid::regclass AS index_name, i.indrelid::regclass AS table_name,
       pg_size_pretty(pg_relation_size(i.indexrelid)) AS size
FROM pg_index i
WHERE NOT i.indisvalid;`, run: true },
    { task: 'Rebuild idx_order_items_order online and compare its size before and after.',
      solution: `SELECT pg_size_pretty(pg_relation_size('idx_order_items_order')) AS before;
REINDEX INDEX CONCURRENTLY idx_order_items_order;
SELECT pg_size_pretty(pg_relation_size('idx_order_items_order')) AS after;`, run: true }
  ],
  challenge: {
    task: 'Write one report query listing, for every non-unique index in the public schema: table, index, scans, size, and a flag "PREFIX_REDUNDANT" when another index on the same table has this index\'s column list as a strict leading prefix.',
    hint: 'Compare indkey::text of two indexes on the same indrelid: the longer one\'s text starts with the shorter one\'s text followed by a space.',
    solution: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date);
SELECT t.relname AS table_name,
       ic.relname AS index_name,
       coalesce(s.idx_scan, 0) AS scans,
       pg_size_pretty(pg_relation_size(i.indexrelid)) AS size,
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_index j
              WHERE j.indrelid = i.indrelid
                AND j.indexrelid <> i.indexrelid
                AND j.indpred IS NULL AND i.indpred IS NULL
                AND j.indexprs IS NULL AND i.indexprs IS NULL
                AND j.indkey::text LIKE i.indkey::text || ' %')
            THEN 'PREFIX_REDUNDANT' ELSE '' END AS flag
FROM pg_index i
JOIN pg_class ic ON ic.oid = i.indexrelid
JOIN pg_class t  ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
WHERE n.nspname = 'public' AND NOT i.indisunique
ORDER BY t.relname, ic.relname;`,
    run: true
  },
  related: ['vacuum', 'mvcc', 'advanced-indexing-statistics', 'indexes-btree-internals', 'monitoring'],
  quiz: [
    { type: 'mcq', q: 'Which change makes an UPDATE of users.last_login non-HOT?',
      options: ['Setting fillfactor to 90', 'Creating an index on last_login', 'Adding a CHECK constraint', 'Running ANALYZE'],
      answer: 1, explain: 'If any indexed column changes, the update cannot be HOT.' },
    { type: 'tf', q: 'VACUUM returns bloated index space to the operating system.',
      answer: false, explain: 'VACUUM makes space reusable; REINDEX (CONCURRENTLY) rebuilds a compact index.' },
    { type: 'bug', q: 'A migration fails with "cannot run inside a transaction block". Why?',
      code: `BEGIN;
CREATE INDEX CONCURRENTLY idx_x ON big_table (col);
COMMIT;`,
      options: ['CONCURRENTLY is not allowed inside an explicit transaction', 'The table needs a primary key', 'Missing IF NOT EXISTS', 'Need LOCK TABLE first'],
      answer: 0, explain: 'CIC, DROP INDEX CONCURRENTLY and REINDEX CONCURRENTLY must run outside transaction blocks.' },
    { type: 'scenario', q: 'CREATE INDEX CONCURRENTLY was cancelled halfway. What state is the database in?',
      options: ['Nothing happened', 'An INVALID index exists that is maintained on writes but unused for reads; drop it and retry', 'The table is locked until restart', 'The index is valid but incomplete'],
      answer: 1, explain: 'Check pg_index.indisvalid and DROP INDEX CONCURRENTLY the leftover.' },
    { type: 'optimize', q: 'A 600M-row table has 14 indexes; inserts are slow. First step?',
      options: ['Add more RAM', 'Find unused/duplicate/prefix-redundant indexes via pg_stat_user_indexes and pg_index, then drop them concurrently', 'VACUUM FULL nightly', 'Disable WAL'],
      answer: 1, explain: 'Each index multiplies write cost; removing dead weight is the cheapest win.' }
  ]
},

/* =====================================================================
   MODULE: query-optimization
   ===================================================================== */
{
  id: 'query-optimization-planner',
  module: 'query-optimization',
  title: 'How the Planner Works: Parse, Rewrite, Plan, Execute and the Cost Model',
  level: 3,
  minutes: 26,
  summary: 'Follow a query through parser, rewriter, planner/optimizer and executor; compute a seq scan cost by hand; see how seq_page_cost, random_page_cost and prepared-statement plan caching change plans.',
  objectives: [
    'Describe the four stages of query processing and what each produces',
    'Explain cost-based optimisation and the main cost constants',
    'Compute a Seq Scan cost from relpages and reltuples by hand',
    'Show how random_page_cost changes the seq-scan vs index-scan decision',
    'Explain view expansion in the rewriter and custom vs generic plans for prepared statements',
    'Know which settings influence planning and which only matter at execution'
  ],
  concept: `
<p><strong>Analogy: a GPS navigation app.</strong> You type a destination (the SQL). The app first checks that the address exists and understands it (<em>parser/analyzer</em>), expands shortcuts like "Home" into real addresses (<em>rewriter</em>: views and rules), computes many possible routes and estimates each one's travel time using a model of road speeds and traffic statistics (<em>planner/optimizer</em>), and finally drives the chosen route (<em>executor</em>). The model's estimates can be wrong (traffic data out of date = stale statistics), and then the "fastest" route isn't.</p>
<ol>
  <li><strong>Parse &amp; analyze</strong>: SQL text &rarr; parse tree &rarr; <em>query tree</em> with resolved tables, columns, types, functions and operators. Syntax and "column does not exist" errors happen here.</li>
  <li><strong>Rewrite</strong>: applies rules &mdash; most importantly, replaces each view reference with its defining query (and applies row-level-security policies). After rewriting, a view is just a subquery the planner can optimise like any other.</li>
  <li><strong>Plan / optimize</strong>: generates alternative <em>paths</em> for each table (seq scan, each usable index, bitmap combinations), each join order and join method, and aggregation/sorting strategies; estimates the cost of each from statistics and cost constants; keeps the cheapest. Output: a <em>plan tree</em> of nodes &mdash; what EXPLAIN shows.</li>
  <li><strong>Execute</strong>: the executor runs the plan tree in a demand-pull ("Volcano") model: the top node asks its child for a row, which asks its child, and so on.</li>
</ol>
<p><strong>The cost model.</strong> Costs are in arbitrary units anchored to "reading one page sequentially = 1.0":</p>
<table>
<tr><th>Constant</th><th>Default</th><th>Meaning</th></tr>
<tr><td><code>seq_page_cost</code></td><td>1.0</td><td>read a page as part of a sequential scan</td></tr>
<tr><td><code>random_page_cost</code></td><td>4.0</td><td>read a page non-sequentially (index &rarr; heap). 1.1&ndash;1.5 is typical for SSD/NVMe</td></tr>
<tr><td><code>cpu_tuple_cost</code></td><td>0.01</td><td>process one row</td></tr>
<tr><td><code>cpu_index_tuple_cost</code></td><td>0.005</td><td>process one index entry</td></tr>
<tr><td><code>cpu_operator_cost</code></td><td>0.0025</td><td>evaluate one operator/function</td></tr>
<tr><td><code>effective_cache_size</code></td><td>4GB</td><td>planner's assumption of OS + PG cache (no memory is allocated)</td></tr>
</table>
<p>For <code>orders</code> (89 pages, 5,000 rows): <code>SELECT * FROM orders</code> costs 89 &times; 1.0 + 5000 &times; 0.01 = <strong>139.00</strong>; adding <code>WHERE customer_id = 42</code> adds 5000 &times; 0.0025 = 12.5 &rarr; <strong>151.50</strong>. Exactly what EXPLAIN prints.</p>`,
  why: `
<p>SQL is declarative: you say <em>what</em> you want, and the database decides <em>how</em>. For a 6-table join there are thousands of possible join orders &times; join methods &times; access paths; the difference between the best and worst can be 6 orders of magnitude. Understanding how the planner thinks lets you (1) predict plans, (2) recognise when its inputs (statistics, cost settings) are wrong, and (3) fix root causes instead of guessing with hints &mdash; which core PostgreSQL deliberately does not provide (the <code>pg_hint_plan</code> extension exists for emergencies).</p>`,
  useCase: `
<p><strong>Cloud migration surprise:</strong> a company moved from spinning disks to NVMe-backed cloud volumes but kept <code>random_page_cost = 4</code>. The planner still believed random reads were 4x more expensive than sequential and chose seq scans for queries returning 3&ndash;8% of large tables. Setting <code>random_page_cost = 1.1</code> (matching the hardware) switched dozens of reports to bitmap/index scans and cut average report time by 60%. No query was modified.</p>`,
  internals: `
<p><strong>Path generation:</strong> for each base relation the planner builds paths (SeqScan, IndexScan per usable index and per useful sort order, BitmapHeapScan with BitmapAnd/Or combinations, IndexOnlyScan). It keeps only paths that are cheapest in total cost, cheapest in startup cost, or provide a useful sort order ("pathkeys"). Joins are built bottom-up with dynamic programming over relation subsets up to <code>join_collapse_limit</code>/<code>from_collapse_limit</code> (8); above <code>geqo_threshold</code> (12 relations) the genetic optimizer (GEQO) is used.</p>
<p><strong>Estimates</strong> combine selectivity (from <code>pg_stats</code>) with <code>reltuples</code>/<code>relpages</code> (scaled to the current physical size). Index scan cost models the correlation between index order and heap order: high correlation &rarr; heap reads are nearly sequential; low correlation &rarr; each row may be a random page read (bounded by <code>effective_cache_size</code> via the Mackert&ndash;Lohman formula).</p>
<p><strong>Prepared statements:</strong> the first 5 executions get <em>custom plans</em> built with the actual parameter values; then PostgreSQL compares the average custom-plan cost to a <em>generic plan</em> (built without knowing values) and switches to the generic plan if it isn't more expensive. <code>plan_cache_mode</code> (<code>auto</code> | <code>force_custom_plan</code> | <code>force_generic_plan</code>) overrides this. Skewed data + generic plans = a classic source of "fast in psql, slow in the application".</p>
<p><strong>Execution model:</strong> each plan node implements init/next/end; most nodes stream (pipeline) rows, while Sort, Hash (build side), HashAggregate and Materialize must consume their input first &mdash; which is exactly what the <em>startup cost</em> represents.</p>`,
  whenNot: `
<ul>
  <li>Don't change global cost constants to fix one query; you'll change thousands of plans. Fix statistics, indexes or the query first; if needed, use <code>SET LOCAL</code> in that transaction or <code>ALTER ROLE/DATABASE ... SET</code> for a workload.</li>
  <li>Don't use <code>enable_seqscan = off</code> (or other <code>enable_*</code>) in production as a "hint"; they are diagnostic tools that make a strategy look extremely expensive, not forbidden.</li>
  <li>Don't trust the planner when estimates are clearly wrong &mdash; fix the inputs (ANALYZE, extended statistics) rather than fighting the output.</li>
</ul>`,
  syntax: `EXPLAIN [ ( option [, ...] ) ] statement;
SHOW random_page_cost;
SET random_page_cost = 1.1;                 -- session
SET LOCAL random_page_cost = 1.1;           -- current transaction only
ALTER DATABASE company_db SET random_page_cost = 1.1;
ALTER TABLESPACE fast_ssd SET (random_page_cost = 1.1);

PREPARE name (types) AS statement;   EXECUTE name (values);
SET plan_cache_mode = auto | force_custom_plan | force_generic_plan;`,
  examples: [
    { label: 'Basic', title: 'Compute a seq scan cost by hand',
      sql: `SELECT relpages, reltuples FROM pg_class WHERE relname = 'orders';

SELECT name, setting FROM pg_settings
WHERE name IN ('seq_page_cost','random_page_cost','cpu_tuple_cost',
               'cpu_index_tuple_cost','cpu_operator_cost','effective_cache_size','work_mem')
ORDER BY name;

SELECT 89 * 1.0 + 5000 * 0.01               AS seq_scan_cost,
       89 * 1.0 + 5000 * 0.01 + 5000 * 0.0025 AS with_one_filter;

EXPLAIN SELECT * FROM orders;
EXPLAIN SELECT * FROM orders WHERE customer_id = 42;`,
      explain: `<p>The planner's seq scan formula is <code>relpages &times; seq_page_cost + reltuples &times; cpu_tuple_cost</code>, plus <code>cpu_operator_cost</code> per row per operator in the filter. Our hand calculation (139.00 and 151.50) matches EXPLAIN exactly. <code>effective_cache_size</code> is shown in 8 kB pages (524288 = 4 GB) and <code>work_mem</code> in kB (4096 = 4 MB).</p>`,
      output: ` relpages | reltuples
----------+-----------
       89 |      5000

 name                 | setting
----------------------+---------
 cpu_index_tuple_cost | 0.005
 cpu_operator_cost    | 0.0025
 cpu_tuple_cost       | 0.01
 effective_cache_size | 524288
 random_page_cost     | 4
 seq_page_cost        | 1
 work_mem             | 4096

 seq_scan_cost | with_one_filter
---------------+-----------------
        139.00 |        151.5000

 Seq Scan on orders  (cost=0.00..139.00 rows=5000 width=36)

 Seq Scan on orders  (cost=0.00..151.50 rows=9 width=36)
   Filter: (customer_id = 42)`,
      run: true },
    { label: 'Intermediate', title: 'random_page_cost flips the plan',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;

-- Half of the customers: ~2,500 of 5,000 rows
SET random_page_cost = 4;      -- default, models spinning disks
EXPLAIN SELECT * FROM orders WHERE customer_id < 250;

SET random_page_cost = 1.1;    -- typical for SSD / NVMe
EXPLAIN SELECT * FROM orders WHERE customer_id < 250;

RESET random_page_cost;`,
      explain: `<p>With <code>random_page_cost = 4</code>, fetching ~2,500 rows scattered over the heap via the index looks more expensive than reading all 89 pages, so the planner picks a <strong>Seq Scan</strong> (151.50). With 1.1, random page reads are almost as cheap as sequential ones; the <strong>bitmap scan</strong> now costs 144.31 &lt; 151.50 and wins. Same data, same query, different hardware assumption. Set it to match your storage once, globally or per tablespace.</p>`,
      output: ` Seq Scan on orders  (cost=0.00..151.50 rows=2500 width=36)
   Filter: (customer_id < 250)

 Bitmap Heap Scan on orders  (cost=24.06..144.31 rows=2500 width=36)
   Recheck Cond: (customer_id < 250)
   ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..23.43 rows=2500 width=0)
         Index Cond: (customer_id < 250)`,
      run: true },
    { label: 'Advanced', title: 'Rewriter (views) and prepared-statement plan caching',
      sql: `-- The rewriter replaces the view with its definition; quals are merged
CREATE VIEW v_big_orders AS SELECT * FROM orders WHERE total_amount > 200000;
EXPLAIN SELECT id FROM v_big_orders WHERE customer_id = 42;

-- Custom vs generic plans
CREATE INDEX idx_orders_status ON orders (status);
ANALYZE orders;
PREPARE orders_by_status(text) AS SELECT count(*) FROM orders WHERE status = $1;

EXPLAIN EXECUTE orders_by_status('pending');     -- custom plan: knows 'pending' is 8%
EXPLAIN EXECUTE orders_by_status('delivered');   -- custom plan: knows it is 50%

SET plan_cache_mode = force_generic_plan;
EXPLAIN EXECUTE orders_by_status('pending');     -- generic: $1 unknown, assumes 1/5 of rows
RESET plan_cache_mode;
DEALLOCATE orders_by_status;`,
      explain: `<p><strong>Views:</strong> there is no "view scan" node &mdash; the plan scans <code>orders</code> directly with both the view's filter and the outer filter combined. Views cost nothing at run time; their performance is the performance of the expanded query.</p>
<p><strong>Prepared statements:</strong> custom plans use the real value: bitmap scan for <em>pending</em> (415 rows), seq scan for <em>delivered</em> (2,527). The <strong>generic plan</strong> can't see the value; it estimates 5000 / n_distinct(5) = 1,000 rows for <code>status = $1</code> and uses one plan for every value. After 5 executions with <code>plan_cache_mode = auto</code>, PostgreSQL may switch to the generic plan &mdash; great for uniform data, risky for skewed data (the generic plan would use the index even for 'delivered').</p>`,
      output: ` Seq Scan on orders  (cost=0.00..164.00 rows=5 width=8)
   Filter: ((total_amount > '200000'::numeric) AND (customer_id = 42))

 Aggregate  (cost=102.72..102.73 rows=1 width=8)
   ->  Bitmap Heap Scan on orders  (cost=7.50..101.69 rows=415 width=0)
         Recheck Cond: (status = 'pending'::text)
         ->  Bitmap Index Scan on idx_orders_status  (cost=0.00..7.39 rows=415 width=0)
               Index Cond: (status = 'pending'::text)

 Aggregate  (cost=157.82..157.83 rows=1 width=8)
   ->  Seq Scan on orders  (cost=0.00..151.50 rows=2527 width=0)
         Filter: (status = 'delivered'::text)

 Aggregate  (cost=120.03..120.04 rows=1 width=8)
   ->  Bitmap Heap Scan on orders  (cost=16.03..117.53 rows=1000 width=0)
         Recheck Cond: (status = $1)
         ->  Bitmap Index Scan on idx_orders_status  (cost=0.00..15.78 rows=1000 width=0)
               Index Cond: (status = $1)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
-- "Fixing" a plan by disabling a strategy for the whole session
SET enable_seqscan = off;
EXPLAIN SELECT * FROM orders WHERE customer_id > 10;
RESET enable_seqscan;`,
      why: 'enable_seqscan = off does not forbid seq scans, it adds a huge penalty, so every other query in the session is also forced away from seq scans even when they are the best choice (here a 98% predicate goes through the index). It hides the real problem instead of fixing it.', run: true },
    good: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;                       -- fix inputs: fresh statistics
SET LOCAL random_page_cost = 1.1;     -- scoped, hardware-accurate cost (inside a transaction)
EXPLAIN SELECT * FROM orders WHERE customer_id < 250;
EXPLAIN SELECT * FROM orders WHERE customer_id > 10;   -- still a seq scan: correct`,
      why: 'Correct statistics and cost constants that match the hardware let the planner choose per query: the index for a medium-selectivity range, a seq scan for a 98% range. Scope experiments with SET LOCAL; persist validated settings with ALTER DATABASE/ROLE/TABLESPACE.', run: true }
  },
  mistakes: [
    `Leaving <code>random_page_cost = 4</code> on SSD/NVMe storage, biasing the planner toward sequential scans.`,
    `Setting <code>effective_cache_size</code> far too low (it allocates nothing; it only tells the planner how much caching to expect).`,
    `Using <code>enable_*</code> parameters as permanent hints in application sessions.`,
    `Assuming a view is "materialized" or "cached"; plain views are expanded at rewrite time every execution.`,
    `Debugging a slow application query with literal values in psql when the app uses prepared statements with a generic plan; reproduce with <code>PREPARE</code>/<code>EXECUTE</code> and <code>plan_cache_mode</code>.`
  ],
  best: [
    `Tune cost constants once to match hardware (<code>random_page_cost</code> 1.1&ndash;1.5 on SSD, <code>effective_cache_size</code> &asymp; 50&ndash;75% of RAM), then leave them alone.`,
    `When a plan is bad, compare estimated vs actual rows first; most bad plans come from bad estimates.`,
    `Use <code>EXPLAIN (SETTINGS)</code> to see which non-default planner settings influenced a plan.`,
    `For skewed data accessed through prepared statements, consider <code>plan_cache_mode = force_custom_plan</code> for that role/function.`,
    `Prefer fixing root causes (stats, indexes, query shape) over the <code>pg_hint_plan</code> extension; keep hints as a last resort.`
  ],
  performance: `
<p>Planning itself costs time: simple queries plan in 0.1&ndash;1 ms, but queries joining many tables or many partitions can take tens of milliseconds (see <code>Planning Time</code> in EXPLAIN ANALYZE). Prepared statements and generic plans amortise planning for very frequent short queries. Too many partitions or joins push planning time up; <code>join_collapse_limit</code>, partition pruning and simpler queries help. The cost model is approximate &mdash; it ignores caching at execution time beyond <code>effective_cache_size</code>, so cost numbers should be compared only between plans for the same query.</p>`,
  security: `
<p>The rewriter applies row-level-security policies and security-barrier views before planning, which can prevent some optimisations (leaky functions are not pushed below security barriers). This is intentional: correctness of access control wins over speed. Mark only truly safe functions <code>LEAKPROOF</code> (superuser only).</p>`,
  scenario: {
    title: 'Queries got slower after moving to new SSD servers',
    steps: [
      '1. Same data, same PostgreSQL version, faster hardware, but several reports are slower.',
      '2. Compare EXPLAIN (SETTINGS) on old and new: new servers have default random_page_cost = 4 and effective_cache_size = 4GB, old ones had tuned values.',
      '3. Plans show Seq Scans where the old servers used Bitmap Index Scans.',
      '4. Test in a session: SET random_page_cost = 1.1; SET effective_cache_size = \'48GB\'; re-run EXPLAIN ANALYZE of the top 10 queries from pg_stat_statements.',
      '5. Confirm improvements and no regressions; persist with ALTER SYSTEM (or the managed-service parameter group) and reload.',
      '6. Add the settings to configuration management so the next server build does not repeat the mistake.'
    ]
  },
  widgets: ['diagram:query-pipeline', 'lab:plan'],
  interview: [
    { q: 'Describe the stages a query goes through in PostgreSQL.',
      a: 'Parsing and analysis turn SQL into a query tree with resolved objects and types; the rewriter expands views and applies rules and row-level security; the planner/optimizer enumerates possible access paths, join orders and methods, estimates their costs from statistics and cost constants and picks the cheapest plan; the executor runs the plan tree, pulling rows from child nodes up to the root.' },
    { q: 'What do seq_page_cost and random_page_cost represent, and how should they be set on SSDs?',
      a: 'They are the planner\'s relative costs of reading a page sequentially versus randomly. The defaults 1.0 and 4.0 model spinning disks. On SSD/NVMe random reads are almost as fast as sequential, so random_page_cost is usually set to 1.1-1.5, which makes index and bitmap scans more attractive for medium-selectivity predicates.' },
    { q: 'What is the difference between a custom and a generic plan?',
      a: 'For prepared statements, a custom plan is built using the actual parameter values each execution, so it can exploit statistics for that value. A generic plan is built once without parameter values and reused. After five executions PostgreSQL may switch to the generic plan if its estimated cost is not higher; plan_cache_mode can force either behaviour. Generic plans can be bad for skewed data.' },
    { q: 'How do you compute the cost of a sequential scan?',
      a: 'relpages * seq_page_cost + reltuples * cpu_tuple_cost, plus reltuples * cpu_operator_cost for each operator evaluated in the filter. For 89 pages and 5000 rows with one filter: 89 + 50 + 12.5 = 151.5.' }
  ],
  exercises: [
    { task: 'Predict the cost of EXPLAIN SELECT * FROM order_items by hand from pg_class, then verify with EXPLAIN.',
      solution: `SELECT relpages, reltuples, relpages * 1.0 + reltuples * 0.01 AS predicted_cost
FROM pg_class WHERE relname = 'order_items';
EXPLAIN SELECT * FROM order_items;`, run: true },
    { task: 'Show which non-default settings affect planning in your session using EXPLAIN (SETTINGS) after setting work_mem and random_page_cost.',
      solution: `SET work_mem = '16MB';
SET random_page_cost = 1.1;
EXPLAIN (SETTINGS) SELECT * FROM orders WHERE customer_id = 42;
RESET work_mem;
RESET random_page_cost;`, run: true }
  ],
  challenge: {
    task: 'Find the approximate selectivity threshold at which the planner switches from Bitmap Heap Scan to Seq Scan for orders.customer_id < N (with an index), for random_page_cost = 4 and = 1.1. Use a DO block or a series of EXPLAINs.',
    hint: 'Loop N from 50 to 500 step 25, run EXPLAIN into a variable (EXECUTE ... INTO with FOR rec IN EXECUTE) and record the first line.',
    solution: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
CREATE TEMP TABLE switch_points (rpc numeric, n int, top_node text);
DO $$
DECLARE r numeric; n int; line text;
BEGIN
  FOREACH r IN ARRAY ARRAY[4, 1.1] LOOP
    EXECUTE format('SET random_page_cost = %s', r);
    FOR n IN SELECT generate_series(50, 500, 25) LOOP
      EXECUTE format('EXPLAIN SELECT * FROM orders WHERE customer_id < %s', n) INTO line;
      INSERT INTO switch_points VALUES (r, n, split_part(line, '  (', 1));
    END LOOP;
  END LOOP;
  RESET random_page_cost;
END $$;
SELECT rpc, min(n) FILTER (WHERE top_node LIKE 'Seq Scan%') AS first_seqscan_at
FROM switch_points GROUP BY rpc ORDER BY rpc DESC;`,
    run: true
  },
  related: ['query-optimization-scan-types', 'advanced-indexing-statistics', 'explain-basics', 'configuration', 'views'],
  quiz: [
    { type: 'mcq', q: 'Which stage replaces a view reference with the view\'s defining query?',
      options: ['Parser', 'Rewriter', 'Planner', 'Executor'],
      answer: 1, explain: 'The rewrite system expands views (and applies RLS) before planning.' },
    { type: 'predict', q: 'A table has 100 pages and 10,000 rows. Default costs. What is the total cost of EXPLAIN SELECT * FROM t?',
      code: `EXPLAIN SELECT * FROM t;`,
      options: ['100.00', '200.00', '110.00', '400.00'],
      answer: 1, explain: '100 x 1.0 + 10000 x 0.01 = 200.' },
    { type: 'tf', q: 'effective_cache_size allocates shared memory for caching.',
      answer: false, explain: 'It is only a planner hint about available cache.' },
    { type: 'scenario', q: 'A query is fast in psql with literal values but slow from the app using prepared statements after a few calls. Likely cause?',
      options: ['Network latency', 'The app switched to a generic plan that is bad for skewed values', 'psql uses a different PostgreSQL version', 'Autovacuum'],
      answer: 1, explain: 'After 5 executions a generic plan may be used; test with PREPARE/EXECUTE and plan_cache_mode.' },
    { type: 'optimize', q: 'All servers use NVMe and the planner keeps choosing seq scans for 3% predicates. Best global fix?',
      options: ['enable_seqscan = off', 'random_page_cost around 1.1', 'Increase cpu_tuple_cost', 'Disable autovacuum'],
      answer: 1, explain: 'Match random_page_cost to the hardware.' }
  ]
},

{
  id: 'query-optimization-scan-types',
  module: 'query-optimization',
  title: 'Scan Types: Seq Scan, Index Scan, Index Only Scan, Bitmap Scans',
  level: 3,
  minutes: 22,
  summary: 'Know exactly when PostgreSQL uses each scan type, what each costs, and how to provoke and read them in EXPLAIN on company_db.',
  objectives: [
    'Describe Seq Scan, Index Scan, Index Only Scan, Bitmap Index Scan and Bitmap Heap Scan',
    'Predict which scan the planner chooses from selectivity, correlation and visibility',
    'Read BitmapAnd / BitmapOr combinations of several indexes',
    'Understand lossy bitmaps (exact vs lossy heap blocks) and work_mem',
    'Use enable_* settings only as a diagnostic tool to compare alternatives'
  ],
  concept: `
<p><strong>Analogy: finding books for a reading list.</strong></p>
<ul>
  <li><strong>Seq Scan</strong> &ndash; walk every shelf from start to end and pick what matches. Efficient when you need a large share of the library.</li>
  <li><strong>Index Scan</strong> &ndash; look up each title in the catalogue and walk to its shelf, in catalogue order. Perfect for a handful of books, or when you need them <em>in catalogue order</em>.</li>
  <li><strong>Index Only Scan</strong> &ndash; the catalogue card already has the answer (e.g. publication year); you never walk to a shelf &mdash; provided the card is guaranteed current (visibility map).</li>
  <li><strong>Bitmap scan</strong> &ndash; first write down the shelf numbers of every matching book (Bitmap Index Scan), sort the list by shelf, then walk the library once visiting each shelf a single time (Bitmap Heap Scan). Best for "a few hundred books scattered around". You can also combine two catalogue lookups by intersecting/uniting the lists (BitmapAnd / BitmapOr).</li>
</ul>
<p>From our company_db runs:</p>
<table>
<tr><th>Query</th><th>Scan chosen</th><th>Why</th></tr>
<tr><td><code>WHERE id = 42</code></td><td>Index Scan (orders_pkey)</td><td>1 row</td></tr>
<tr><td><code>WHERE id BETWEEN 100 AND 120</code></td><td>Index Scan</td><td>21 rows, id highly correlated with heap order</td></tr>
<tr><td><code>WHERE customer_id = 42</code></td><td>Bitmap Heap Scan</td><td>~10 rows on ~8 different pages</td></tr>
<tr><td><code>WHERE customer_id &lt; 50</code></td><td>Bitmap Heap Scan</td><td>458 rows (9%)</td></tr>
<tr><td><code>WHERE customer_id &lt; 400</code></td><td>Seq Scan</td><td>3,961 rows (79%)</td></tr>
<tr><td><code>count(*) WHERE customer_id &lt; 50</code> after VACUUM</td><td>Index Only Scan</td><td>needs only the indexed column; pages all-visible</td></tr>
<tr><td><code>WHERE customer_id = 42 OR id = 7</code></td><td>BitmapOr of two indexes</td><td>each branch indexable</td></tr>
</table>`,
  why: `
<p>Choosing the scan is the most basic and most frequent planner decision. Knowing the trade-offs lets you design indexes that enable the right scan (e.g. covering index for Index Only Scan), interpret plans quickly ("Bitmap Heap Scan with lossy blocks &rarr; work_mem too small"), and recognise when the planner's choice is correct even though it "didn't use my index".</p>`,
  useCase: `
<p><strong>Fraud review dashboard:</strong> analysts filter transactions by <code>merchant_id</code> AND <code>amount &gt; X</code> OR by <code>card_id</code>. Separate B-trees on <code>merchant_id</code>, <code>amount</code> and <code>card_id</code> let the planner build BitmapAnd/BitmapOr combinations for whatever filters the UI sends, without needing a composite index for every combination. For the single hottest query (merchant + date range sorted by date) a dedicated composite index gives an ordered Index Scan with LIMIT.</p>`,
  internals: `
<p><strong>Seq Scan</strong> reads pages in physical order using a ring buffer for large tables (to avoid flushing shared_buffers) and benefits from OS read-ahead; PG supports synchronized scans so concurrent seq scans share I/O.</p>
<p><strong>Index Scan</strong> returns tuples in index order; for each index entry it fetches the heap tuple (maybe the same page many times if correlation is low). It can satisfy ORDER BY and stop early with LIMIT; it is the only option (besides Index Only) for KNN ordering.</p>
<p><strong>Index Only Scan</strong> checks the visibility map per heap page; heap fetches happen for not-all-visible pages. Planner cost uses <code>relallvisible/relpages</code>.</p>
<p><strong>Bitmap Index Scan</strong> builds an in-memory TID bitmap (one bit per tuple, organised per page). If the bitmap exceeds <code>work_mem</code>, it degrades to page-level ("lossy") entries, which forces rechecks of every tuple on those pages (<code>Heap Blocks: exact=N lossy=M</code>). <strong>Bitmap Heap Scan</strong> visits pages in physical order and can prefetch (<code>effective_io_concurrency</code>; PG18 also uses asynchronous I/O for seq and bitmap heap scans). Bitmaps lose ordering, so ORDER BY needs a Sort above.</p>
<p><strong>Disabling for diagnosis:</strong> since PG18, disabled nodes are marked <code>Disabled: true</code> in EXPLAIN when the planner has no alternative.</p>`,
  whenNot: `
<ul>
  <li>Don't force index scans for large result sets; when a predicate keeps more than roughly 5&ndash;20% of a table (depending on correlation and storage), a Seq Scan is usually best.</li>
  <li>Don't expect Index Only Scans on tables whose pages are constantly modified; plan for heap fetches or use a different design (e.g. summary tables).</li>
  <li>Don't rely on BitmapAnd for hot queries that also need ordering and LIMIT; a composite index serves them better.</li>
</ul>`,
  syntax: `-- Diagnostic switches (session level; never as permanent hints)
SET enable_seqscan = on|off;
SET enable_indexscan = on|off;
SET enable_indexonlyscan = on|off;
SET enable_bitmapscan = on|off;
SET work_mem = '64MB';            -- affects bitmap lossiness, sorts, hashes
SET effective_io_concurrency = 200;   -- bitmap heap prefetch on SSDs`,
  examples: [
    { label: 'Basic', title: 'One index, four different plans by selectivity',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;

EXPLAIN SELECT * FROM orders WHERE id = 42;               -- PK, 1 row
EXPLAIN SELECT * FROM orders WHERE customer_id = 42;      -- ~10 rows
EXPLAIN SELECT * FROM orders WHERE customer_id < 50;      -- ~9%
EXPLAIN SELECT * FROM orders WHERE customer_id < 400;     -- ~79%`,
      explain: `<p>As the estimated row count grows, the plan moves from <strong>Index Scan</strong> (1 row) to <strong>Bitmap Heap Scan</strong> (10 and 458 rows) to <strong>Seq Scan</strong> (3,961 rows). The bitmap scan's startup cost (e.g. 7.83) is the time to build the bitmap before the first row can be returned.</p>`,
      output: ` Index Scan using orders_pkey on orders  (cost=0.28..8.30 rows=1 width=36)
   Index Cond: (id = 42)

 Bitmap Heap Scan on orders  (cost=4.35..31.88 rows=9 width=36)
   Recheck Cond: (customer_id = 42)
   ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..4.35 rows=9 width=0)
         Index Cond: (customer_id = 42)

 Bitmap Heap Scan on orders  (cost=7.83..102.56 rows=458 width=36)
   Recheck Cond: (customer_id < 50)
   ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..7.72 rows=458 width=0)
         Index Cond: (customer_id < 50)

 Seq Scan on orders  (cost=0.00..151.50 rows=3961 width=36)
   Filter: (customer_id < 400)`,
      run: true },
    { label: 'Intermediate', title: 'Index Only Scan appears after VACUUM',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
EXPLAIN SELECT count(*) FROM orders WHERE customer_id < 50;

VACUUM orders;   -- marks pages all-visible
EXPLAIN SELECT count(*) FROM orders WHERE customer_id < 50;`,
      explain: `<p><code>count(*)</code> needs no column values, only the existence of visible matching rows. Before VACUUM, the visibility map is empty, so the planner uses a bitmap scan (cost 103.70). After VACUUM, every page is all-visible and an <strong>Index Only Scan</strong> costs just 13.44 &mdash; it reads only the 8-page index.</p>`,
      output: `-- BEFORE VACUUM
 Aggregate  (cost=103.70..103.71 rows=1 width=8)
   ->  Bitmap Heap Scan on orders  (cost=7.83..102.56 rows=458 width=0)
         Recheck Cond: (customer_id < 50)
         ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..7.72 rows=458 width=0)
               Index Cond: (customer_id < 50)

-- AFTER VACUUM
 Aggregate  (cost=13.44..13.45 rows=1 width=8)
   ->  Index Only Scan using idx_orders_customer_id on orders  (cost=0.28..12.30 rows=458 width=0)
         Index Cond: (customer_id < 50)`,
      run: true },
    { label: 'Advanced', title: 'BitmapAnd and BitmapOr: combining two indexes',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
CREATE INDEX idx_orders_order_date  ON orders (order_date);
ANALYZE orders;

-- AND of two indexed predicates
EXPLAIN ANALYZE SELECT * FROM orders
WHERE customer_id BETWEEN 1 AND 60 AND order_date >= '2025-09-01';

-- OR of two indexed predicates
EXPLAIN ANALYZE SELECT * FROM orders
WHERE customer_id = 42 OR order_date >= '2025-09-28';`,
      explain: `<p><strong>BitmapAnd:</strong> the date index yields 242 TIDs, the customer index 576; the AND of the two bitmaps leaves 30 rows on 24 pages. Neither index alone is selective enough, together they are. (BitmapAnd/BitmapOr nodes report <code>rows=0.00</code> because bitmaps don't count rows.)</p>
<p><strong>BitmapOr:</strong> the union of 10 + 33 TIDs; without it an OR across two different columns would force a Seq Scan. Note there's no ordering: a following <code>ORDER BY</code> would add a Sort node.</p>`,
      output: ` Bitmap Heap Scan on orders  (cost=16.39..77.13 rows=28 width=36) (actual time=0.786..0.844 rows=30.00 loops=1)
   Recheck Cond: ((order_date >= '2025-09-01 00:00:00+05'::timestamp with time zone) AND (customer_id >= 1) AND (customer_id <= 60))
   Heap Blocks: exact=24
   Buffers: shared hit=26 read=3
   ->  BitmapAnd  (cost=16.39..16.39 rows=28 width=0) (actual time=0.410..0.413 rows=0.00 loops=1)
         ->  Bitmap Index Scan on idx_orders_order_date  (cost=0.00..6.12 rows=245 width=0) (actual time=0.272..0.273 rows=242.00 loops=1)
               Index Cond: (order_date >= '2025-09-01 00:00:00+05'::timestamp with time zone)
         ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..10.00 rows=572 width=0) (actual time=0.052..0.053 rows=576.00 loops=1)
               Index Cond: ((customer_id >= 1) AND (customer_id <= 60))
 Execution Time: 1.104 ms

 Bitmap Heap Scan on orders  (cost=8.92..84.89 rows=44 width=36) (actual time=0.042..0.116 rows=43.00 loops=1)
   Recheck Cond: ((customer_id = 42) OR (order_date >= '2025-09-28 00:00:00+05'::timestamp with time zone))
   Heap Blocks: exact=28
   ->  BitmapOr  (cost=8.92..8.92 rows=44 width=0) (actual time=0.021..0.024 rows=0.00 loops=1)
         ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..4.35 rows=9 width=0) (actual time=0.010..0.010 rows=10.00 loops=1)
               Index Cond: (customer_id = 42)
         ->  Bitmap Index Scan on idx_orders_order_date  (cost=0.00..4.54 rows=35 width=0) (actual time=0.009..0.010 rows=33.00 loops=1)
               Index Cond: (order_date >= '2025-09-28 00:00:00+05'::timestamp with time zone)
 Execution Time: 0.197 ms`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
-- Forcing the index for a 79% predicate
SET enable_seqscan = off;
SET enable_bitmapscan = off;
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id < 400;
RESET enable_seqscan;
RESET enable_bitmapscan;`,
      why: 'An Index Scan over ~4,000 rows visits heap pages in index order, re-reading the same pages many times (thousands of buffer accesses instead of 89). Forcing indexes for unselective predicates is slower, not faster.', run: true },
    good: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
-- Let the planner choose: one sequential pass over 89 pages
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id < 400;`,
      why: 'For a predicate keeping most rows, a Seq Scan reads each page exactly once in physical order and benefits from read-ahead. Trust the cost model when estimates are accurate.', run: true }
  },
  mistakes: [
    `Believing "Seq Scan = bad". For large result fractions and small tables it is the best plan.`,
    `Seeing <code>Heap Blocks: lossy=...</code> on a non-BRIN bitmap scan and not raising <code>work_mem</code> for that query.`,
    `Expecting a bitmap scan to return rows in index order; an ORDER BY on top needs a Sort.`,
    `Leaving <code>enable_*</code> switches off after a debugging session (or in a connection pool's session state).`,
    `Assuming Index Only Scan means zero heap access; always check <code>Heap Fetches</code>.`
  ],
  best: [
    `Read scan choice together with estimated vs actual rows; if the estimate is right, the scan choice is usually right.`,
    `Use covering indexes + healthy VACUUM for hot narrow queries to get Index Only Scans.`,
    `Rely on BitmapAnd/BitmapOr for ad-hoc filter combinations and composite indexes for the top queries.`,
    `Set <code>effective_io_concurrency</code> (e.g. 200 on SSD) so bitmap heap scans prefetch.`,
    `Use <code>enable_*</code> only inside a transaction (<code>SET LOCAL</code>) while comparing alternatives with EXPLAIN ANALYZE.`
  ],
  performance: `
<p>Rough costs: Seq Scan &asymp; all pages sequentially; Index Scan &asymp; tree height + one (often random) heap page per row, lower with high correlation; Bitmap &asymp; index pages + each matching heap page once, in order; Index Only &asymp; index pages + heap pages for not-all-visible entries. The crossover between bitmap and seq scan on SSDs is typically 5&ndash;25% of rows; between index and bitmap scan, a few dozen to a few hundred rows depending on correlation.</p>`,
  security: `
<p>Scan choice doesn't change what data a user may see, but row-level-security predicates participate in scan selection: a policy like <code>tenant_id = current_setting(...)</code> can use an index on <code>tenant_id</code>, while policies using non-leakproof functions may force filters to run after the scan. Index your RLS columns.</p>`,
  scenario: {
    title: 'Bitmap heap scan suddenly slow after data growth',
    steps: [
      '1. A reporting query that took 200 ms now takes 6 s; plan shape unchanged (Bitmap Heap Scan).',
      '2. EXPLAIN (ANALYZE, BUFFERS) shows Heap Blocks: exact=1200 lossy=48000 and Rows Removed by Index Recheck: 9,500,000.',
      '3. The bitmap no longer fits in work_mem (4 MB) and degraded to page-level entries; every row on 48k pages is rechecked.',
      '4. Test SET LOCAL work_mem = \'64MB\' in a transaction: lossy=0, 350 ms.',
      '5. Apply it narrowly: ALTER ROLE reporting SET work_mem = \'64MB\' (not globally, since work_mem is per node per query).',
      '6. Consider a more selective composite index so the bitmap is smaller in the first place.'
    ]
  },
  widgets: ['lab:plan', 'diagram:btree'],
  interview: [
    { q: 'Why does PostgreSQL use a Bitmap Heap Scan instead of an Index Scan?',
      a: 'When a moderate number of rows match and they are spread over many pages, a plain index scan would visit heap pages in index order, potentially repeatedly and randomly. A bitmap scan collects all TIDs first, then reads each heap page once in physical order, reducing random I/O. It also allows combining multiple indexes with BitmapAnd/BitmapOr, at the cost of losing index ordering.' },
    { q: 'What makes a bitmap lossy and what is the consequence?',
      a: 'If the TID bitmap exceeds work_mem, PostgreSQL switches some pages to page-level bits, remembering only that the page may contain matches. The heap scan then has to recheck every tuple on those pages, visible as lossy heap blocks and Rows Removed by Index Recheck. BRIN bitmaps are always lossy.' },
    { q: 'When can PostgreSQL use an Index Only Scan?',
      a: 'When all columns the query needs (in SELECT, WHERE, ORDER BY, etc.) are available from the index (key or INCLUDE columns), the index type supports returning values (B-tree, GiST/SP-GiST for some opclasses), and ideally most heap pages are all-visible in the visibility map so heap fetches are avoided.' },
    { q: 'How would you check whether the planner\'s choice of seq scan is correct?',
      a: 'Compare estimated and actual rows with EXPLAIN ANALYZE; if accurate, temporarily SET LOCAL enable_seqscan = off and compare actual time and buffers of the alternative plan. If the alternative is truly faster, look at cost constants (random_page_cost, effective_cache_size) or correlation rather than leaving the switch off.' }
  ],
  exercises: [
    { task: 'Produce a BitmapOr plan on orders for: customer_id = 7 OR order_date >= \'2025-09-30\' (create the two indexes you need).',
      solution: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
CREATE INDEX idx_orders_order_date ON orders (order_date);
ANALYZE orders;
EXPLAIN SELECT id FROM orders
WHERE customer_id = 7 OR order_date >= '2025-09-30';`, run: true },
    { task: 'Make SELECT count(*) FROM order_items WHERE order_id < 100 an Index Only Scan and show Heap Fetches with EXPLAIN ANALYZE.',
      solution: `VACUUM order_items;
EXPLAIN ANALYZE SELECT count(*) FROM order_items WHERE order_id < 100;`, run: true }
  ],
  challenge: {
    task: 'Demonstrate a lossy bitmap on a non-BRIN index: build a 200k-row table with an index, set work_mem to the minimum (64kB), run a query matching ~30% of rows with seq scans disabled, and show exact vs lossy heap blocks; then raise work_mem and compare.',
    hint: 'SET work_mem = \'64kB\'; SET enable_seqscan = off; EXPLAIN ANALYZE ...; RESET.',
    solution: `CREATE TABLE lossy_demo AS SELECT g AS id, g % 10 AS bucket, md5(g::text) AS pad FROM generate_series(1, 200000) g;
CREATE INDEX lossy_demo_bucket ON lossy_demo (bucket);
ANALYZE lossy_demo;
SET enable_seqscan = off;
SET work_mem = '64kB';
EXPLAIN ANALYZE SELECT count(*) FROM lossy_demo WHERE bucket IN (1, 2, 3);
SET work_mem = '32MB';
EXPLAIN ANALYZE SELECT count(*) FROM lossy_demo WHERE bucket IN (1, 2, 3);
RESET work_mem;
RESET enable_seqscan;`,
    run: true
  },
  related: ['query-optimization-planner', 'indexes-unique-covering', 'explain-analyze', 'query-optimization-joins'],
  quiz: [
    { type: 'predict', q: 'Index on orders(customer_id); 98% of rows have customer_id > 10. Plan?',
      code: `EXPLAIN SELECT * FROM orders WHERE customer_id > 10;`,
      options: ['Index Scan', 'Bitmap Heap Scan', 'Seq Scan', 'Index Only Scan'],
      answer: 2, explain: 'Nearly all rows match; sequential reading is cheapest.' },
    { type: 'mcq', q: 'Which scan type can combine two different indexes for an OR condition?',
      options: ['Index Scan', 'Bitmap scan with BitmapOr', 'Index Only Scan', 'Seq Scan'],
      answer: 1, explain: 'BitmapOr unions TID bitmaps from several index scans.' },
    { type: 'tf', q: 'A Bitmap Heap Scan returns rows in index order.',
      answer: false, explain: 'It returns rows in physical page order.' },
    { type: 'bug', q: 'Plan shows Heap Blocks: exact=900 lossy=35000 for a B-tree bitmap scan. Most likely fix?',
      code: `Bitmap Heap Scan on events
  Rows Removed by Index Recheck: 4100000
  Heap Blocks: exact=900 lossy=35000`,
      options: ['VACUUM FULL', 'Increase work_mem for this query', 'Drop the index', 'Lower random_page_cost'],
      answer: 1, explain: 'The bitmap overflowed work_mem and became lossy.' },
    { type: 'mcq', q: 'What does Disabled: true on a Seq Scan node in PG18 EXPLAIN mean?',
      options: ['The table is locked', 'enable_seqscan is off but no other path was possible', 'The scan was skipped', 'Parallelism is disabled'],
      answer: 1, explain: 'PG18 marks nodes that were used despite being disabled.' }
  ]
},

{
  id: 'query-optimization-joins',
  module: 'query-optimization',
  title: 'Join Strategies, Join Order, Sort/Aggregate, Parallel Query and JIT',
  level: 4,
  minutes: 30,
  summary: 'Nested Loop vs Hash Join vs Merge Join (and Memoize), how join order is chosen (join_collapse_limit, GEQO), Sort vs HashAggregate vs GroupAggregate and work_mem spills, plus parallel query and JIT.',
  objectives: [
    'Explain how Nested Loop, Hash Join and Merge Join work and when each wins',
    'Recognise Memoize nodes and read their hit/miss counters',
    'Explain join order search, join_collapse_limit, from_collapse_limit and GEQO',
    'Distinguish HashAggregate, GroupAggregate, Sort methods (quicksort, top-N heapsort, external merge) and work_mem spills',
    'Read Gather / Gather Merge / Partial Aggregate parallel plans and know when parallelism helps',
    'Know what JIT compiles, when it triggers, and when to turn it off'
  ],
  concept: `
<p><strong>Analogy: matching guests to a seating list at a wedding.</strong></p>
<ul>
  <li><strong>Nested Loop</strong> &ndash; for each guest at the door, look them up in the seating list. If the list has an alphabetical index, each lookup is quick. Great when few guests arrive (small outer side) and the inner lookup is indexed.</li>
  <li><strong>Hash Join</strong> &ndash; first copy the (smaller) seating list into a hash table keyed by name (<em>build</em>), then stream all guests past it and look each up in O(1) (<em>probe</em>). Great for large, unsorted inputs with equality conditions.</li>
  <li><strong>Merge Join</strong> &ndash; sort both the guest queue and the seating list alphabetically, then walk both lists side by side. Great when both inputs are already sorted (indexes) or needed sorted anyway.</li>
</ul>
<table>
<tr><th>Method</th><th>Join conditions</th><th>Best when</th><th>Memory</th></tr>
<tr><td>Nested Loop</td><td>any (incl. &lt;, LIKE, &amp;&amp;)</td><td>small outer side, indexed inner side; LIMIT queries</td><td>none (Memoize optional)</td></tr>
<tr><td>Hash Join</td><td>equality only</td><td>large unsorted inputs; inner (hashed) side fits in <code>work_mem &times; hash_mem_multiplier</code></td><td>hash table of inner side; batches to disk if too big</td></tr>
<tr><td>Merge Join</td><td>equality (sortable)</td><td>both inputs presorted (indexes), very large inputs, FULL JOINs</td><td>sorts if inputs unsorted</td></tr>
</table>
<p><strong>Memoize</strong> (PG14+) caches inner-side results of a nested loop by key: if 5,000 orders reference only 500 distinct customers, the customer index is probed 500 times and the cache answers the other 4,500.</p>
<p><strong>Join order</strong> matters as much as join method: joining a selective filter early keeps intermediate results small. The planner searches orders exhaustively (dynamic programming) for up to <code>join_collapse_limit</code> (8) relations in explicit JOIN syntax, and switches to the genetic optimizer (GEQO) at <code>geqo_threshold</code> (12) FROM items.</p>
<p><strong>Aggregation and sorting:</strong> <code>HashAggregate</code> builds a hash table of groups (no input order needed); <code>GroupAggregate</code> needs input sorted by the group key (from a Sort or an index) and streams. Sorts use quicksort in memory, <em>top-N heapsort</em> for ORDER BY + LIMIT, or <em>external merge</em> on disk when exceeding <code>work_mem</code>; HashAggregate spills into partitions on disk (PG13+).</p>
<p><strong>Parallel query</strong> splits a scan among worker processes (<code>Gather</code> / <code>Gather Merge</code> collect their results; aggregates run as <code>Partial</code> + <code>Finalize</code>). <strong>JIT</strong> compiles expressions and tuple deforming to machine code via LLVM for long-running analytical queries.</p>`,
  why: `
<p>Most real queries join several tables and aggregate. A wrong join method (nested loop over 2 million outer rows without an index) or wrong order (joining two huge tables before applying a 0.1% filter) can make a query thousands of times slower. Recognising join nodes, their memory use and their spills is the core skill of EXPLAIN reading for analytical and reporting workloads.</p>`,
  useCase: `
<p><strong>Daily revenue report</strong> at an e-commerce company: <code>orders</code> (300M) &#8904; <code>order_items</code> (900M) &#8904; <code>products</code> (2M) for yesterday. A good plan: index range scan of yesterday's orders (~ 400k), nested loop or hash join into order_items via <code>order_items(order_id)</code>, hash join to products (hashed once), HashAggregate by category &mdash; 4 s. A bad plan (after statistics went stale, the planner thought yesterday had 1 order) used nested loops everywhere and ran for 45 minutes. Correct statistics, not hints, fixed it.</p>`,
  internals: `
<p><strong>Nested Loop</strong> cost &asymp; outer rows &times; cost of one inner scan; inner side is usually an Index Scan parameterised by the outer value (shown as <code>Index Cond: (id = o.customer_id)</code>) and has <code>loops=N</code> in EXPLAIN ANALYZE.</p>
<p><strong>Hash Join</strong> builds a hash table on the inner (smaller estimated) side; memory limit is <code>work_mem &times; hash_mem_multiplier</code> (default 2.0). If exceeded, it splits into batches written to temp files (<code>Batches: 4</code> in EXPLAIN ANALYZE). Hash Right/Left/Full/Semi/Anti variants implement outer joins, EXISTS and NOT EXISTS. PG supports parallel hash joins with a shared hash table.</p>
<p><strong>Merge Join</strong> requires both inputs sorted on the join key; with indexes on both sides (e.g. <code>orders_pkey</code> and <code>order_items(order_id)</code>) it streams with no sort and can feed an ORDER BY + LIMIT.</p>
<p><strong>Join search:</strong> explicit <code>JOIN</code> syntax is "collapsed" into a flat list if it has at most <code>join_collapse_limit</code> items; with <code>join_collapse_limit = 1</code> the planner joins in the written order (a way to force an order). Outer joins restrict reordering.</p>
<p><strong>Parallelism:</strong> controlled by <code>max_parallel_workers_per_gather</code> (default 2), <code>max_parallel_workers</code>, <code>max_worker_processes</code>, <code>parallel_setup_cost</code>, <code>parallel_tuple_cost</code>, <code>min_parallel_table_scan_size</code> (8 MB). Not used for: queries that write data (except CREATE TABLE AS / some), cursors, functions marked PARALLEL UNSAFE, and small tables. <code>Workers Launched</code> can be lower than <code>Workers Planned</code> if the pool is exhausted &mdash; in this single-process browser sandbox it is always 0.</p>
<p><strong>JIT</strong> (<code>jit = on</code> by default since PG12, requires a server built with LLVM) triggers when total cost exceeds <code>jit_above_cost</code> (100,000); optimisation and inlining at higher thresholds. EXPLAIN ANALYZE shows a <code>JIT:</code> section with compile times. For OLTP-ish queries with high estimated cost but short runtime, JIT compilation can cost more than it saves.</p>`,
  whenNot: `
<ul>
  <li>Don't force join methods with <code>enable_hashjoin/enable_nestloop/enable_mergejoin</code> in production; fix estimates instead.</li>
  <li>Don't raise <code>work_mem</code> globally to avoid spills: it is per sort/hash node per query per worker; 200 connections &times; 4 nodes &times; 256 MB can exhaust RAM. Raise it per role or with <code>SET LOCAL</code>.</li>
  <li>Parallel query doesn't help short OLTP queries and consumes extra CPU/connections; keep <code>max_parallel_workers_per_gather</code> modest on busy OLTP servers.</li>
  <li>Turn JIT off (<code>jit = off</code> per database/role) for OLTP workloads where it adds latency without benefit.</li>
</ul>`,
  syntax: `SET enable_nestloop | enable_hashjoin | enable_mergejoin | enable_memoize = on|off;   -- diagnostics only
SET join_collapse_limit = 8;        -- 1 = join in written order
SET from_collapse_limit = 8;
SET geqo_threshold = 12;
SET work_mem = '64MB';  SET hash_mem_multiplier = 2.0;
SET max_parallel_workers_per_gather = 4;
SET jit = on|off;  SET jit_above_cost = 100000;
SELECT pg_jit_available();`,
  examples: [
    { label: 'Basic', title: 'The three join methods on company_db',
      sql: `-- (1) Nested Loop: one order, look up its customer by PK
EXPLAIN ANALYZE
SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = 42;

-- (2) Hash Join: all orders x all customers, aggregated
EXPLAIN ANALYZE
SELECT c.country, sum(o.total_amount)
FROM orders o JOIN customers c ON c.id = o.customer_id
GROUP BY c.country;

-- (3) Merge Join: both sides already sorted by indexes, ORDER BY + LIMIT
EXPLAIN ANALYZE
SELECT o.id, oi.product_id
FROM orders o JOIN order_items oi ON oi.order_id = o.id
ORDER BY o.id LIMIT 5;`,
      explain: `<p><strong>(1)</strong> Outer: 1 order via <code>orders_pkey</code>; inner: <code>customers_pkey</code> probed with the outer row's value (<code>Index Cond: (id = o.customer_id)</code>). Ideal: tiny outer side, indexed inner.</p>
<p><strong>(2)</strong> The 500 customers are hashed (<code>Buckets: 1024 Batches: 1 Memory Usage: 22kB</code>), then 5,000 orders stream through the probe. One batch = fits in memory.</p>
<p><strong>(3)</strong> <code>orders_pkey</code> and <code>idx_order_items_order</code> both deliver rows sorted by order id, so a Merge Join streams and the Limit stops after 5 rows: only 9 buffers.</p>`,
      output: ` Nested Loop  (cost=0.55..16.62 rows=1 width=20) (actual time=1.251..1.267 rows=1.00 loops=1)
   ->  Index Scan using orders_pkey on orders o  (cost=0.28..8.30 rows=1 width=12) (actual time=0.305..0.316 rows=1.00 loops=1)
         Index Cond: (id = 42)
   ->  Index Scan using customers_pkey on customers c  (cost=0.27..8.29 rows=1 width=16) (actual time=0.041..0.042 rows=1.00 loops=1)
         Index Cond: (id = o.customer_id)
 Execution Time: 2.316 ms

 HashAggregate  (cost=195.49..195.56 rows=6 width=37) (actual time=29.479..29.493 rows=6.00 loops=1)
   Group Key: c.country
   Batches: 1  Memory Usage: 32kB
   ->  Hash Join  (cost=18.25..170.49 rows=5000 width=13) (actual time=4.469..20.319 rows=5000.00 loops=1)
         Hash Cond: (o.customer_id = c.id)
         ->  Seq Scan on orders o  (cost=0.00..139.00 rows=5000 width=12) (actual time=1.464..5.376 rows=5000.00 loops=1)
         ->  Hash  (cost=12.00..12.00 rows=500 width=9) (actual time=2.891..2.894 rows=500.00 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 22kB
               ->  Seq Scan on customers c  (cost=0.00..12.00 rows=500 width=9) (actual time=0.037..2.456 rows=500.00 loops=1)
 Execution Time: 30.235 ms

 Limit  (cost=0.57..0.91 rows=5 width=12) (actual time=5.973..6.017 rows=5.00 loops=1)
   Buffers: shared hit=9
   ->  Merge Join  (cost=0.57..859.43 rows=12500 width=12) (actual time=5.787..5.819 rows=5.00 loops=1)
         Merge Cond: (o.id = oi.order_id)
         ->  Index Only Scan using orders_pkey on orders o  (cost=0.28..287.89 rows=5000 width=8) (actual time=0.428..0.435 rows=2.00 loops=1)
         ->  Index Scan using idx_order_items_order on order_items oi  (cost=0.29..402.79 rows=12500 width=12) (actual time=0.082..0.092 rows=5.00 loops=1)
 Execution Time: 6.518 ms`,
      run: true },
    { label: 'Intermediate', title: 'Memoize, forced alternatives and join order',
      sql: `-- Diagnostics only: take hash join away and see the next-best plan
SET enable_hashjoin = off;
EXPLAIN ANALYZE
SELECT c.country, sum(o.total_amount)
FROM orders o JOIN customers c ON c.id = o.customer_id
GROUP BY c.country;
RESET enable_hashjoin;

-- Join order: the planner reorders freely (limit 8)...
SHOW join_collapse_limit;
EXPLAIN SELECT p.name, sum(oi.quantity)
FROM products p
JOIN order_items oi ON oi.product_id = p.id
JOIN orders o      ON o.id = oi.order_id
JOIN customers c   ON c.id = o.customer_id
WHERE c.country = 'UAE' AND p.category = 'audio'
GROUP BY p.name;

-- ...unless told to follow the written order
SET join_collapse_limit = 1;
EXPLAIN SELECT p.name, sum(oi.quantity)
FROM products p
JOIN order_items oi ON oi.product_id = p.id
JOIN orders o      ON o.id = oi.order_id
JOIN customers c   ON c.id = o.customer_id
WHERE c.country = 'UAE' AND p.category = 'audio'
GROUP BY p.name;
RESET join_collapse_limit;`,
      explain: `<p><strong>Memoize:</strong> without hash join the planner picks a Nested Loop whose inner side is cached by <code>o.customer_id</code>: <code>Hits: 4500 Misses: 500</code> &mdash; the customer index was probed only 500 times for 5,000 orders. Still slower (and 1,589 buffers) than the hash join's 96.</p>
<p><strong>Join order:</strong> with the default limit the planner starts from the most selective pieces (UAE customers, audio products) &mdash; total cost 452.43 (shown in the first plan's top line). With <code>join_collapse_limit = 1</code> it must join products &rarr; order_items &rarr; orders &rarr; customers as written: estimated 472.56. On real data volumes this difference can be orders of magnitude.</p>`,
      output: ` HashAggregate  (cost=438.49..438.56 rows=6 width=37) (actual time=355.988..356.003 rows=6.00 loops=1)
   Group Key: c.country
   Buffers: shared hit=1589
   ->  Nested Loop  (cost=0.28..413.49 rows=5000 width=13) (actual time=2.859..137.212 rows=5000.00 loops=1)
         ->  Seq Scan on orders o  (cost=0.00..139.00 rows=5000 width=12) (actual time=1.747..22.265 rows=5000.00 loops=1)
         ->  Memoize  (cost=0.28..0.31 rows=1 width=9) (actual time=0.013..0.013 rows=1.00 loops=5000)
               Cache Key: o.customer_id
               Cache Mode: logical
               Hits: 4500  Misses: 500  Evictions: 0  Overflows: 0  Memory Usage: 41kB
               ->  Index Scan using customers_pkey on customers c  (cost=0.27..0.30 rows=1 width=9) (actual time=0.072..0.072 rows=1.00 loops=500)
                     Index Cond: (id = o.customer_id)

 join_collapse_limit
---------------------
 8

 HashAggregate  (cost=452.43..452.53 rows=10 width=22)
   Group Key: p.name
   ->  Hash Join  (cost=19.69..451.66 rows=155 width=18)
         Hash Cond: (oi.product_id = p.id)
         ->  Nested Loop  (cost=14.31..442.04 rows=1550 width=8)
               ->  Hash Join  (cost=14.03..166.26 rows=620 width=8)
                     Hash Cond: (o.customer_id = c.id)
                     ->  Seq Scan on orders o  (cost=0.00..139.00 rows=5000 width=12)
                     ->  Hash  (cost=13.25..13.25 rows=62 width=4)
                           ->  Seq Scan on customers c  (cost=0.00..13.25 rows=62 width=4)
                                 Filter: (country = 'UAE'::text)
               ->  Index Scan using idx_order_items_order on order_items oi  (cost=0.29..0.42 rows=2 width=16)
                     Index Cond: (order_id = o.id)
         ->  Hash  (cost=5.25..5.25 rows=10 width=18)
               ->  Seq Scan on products p  (cost=0.00..5.25 rows=10 width=18)
                     Filter: (category = 'audio'::text)

 HashAggregate  (cost=472.56..472.66 rows=10 width=22)
   Group Key: p.name
   ->  Hash Join  (cost=298.23..471.78 rows=155 width=18)
         Hash Cond: (o.customer_id = c.id)
         ->  Hash Join  (cost=284.20..454.45 rows=1250 width=22)
               Hash Cond: (o.id = oi.order_id)
               ->  Seq Scan on orders o  (cost=0.00..139.00 rows=5000 width=12)
               ->  Hash  (cost=268.58..268.58 rows=1250 width=26)
                     ->  Hash Join  (cost=5.38..268.58 rows=1250 width=26)
                           Hash Cond: (oi.product_id = p.id)
                           ->  Seq Scan on order_items oi  (cost=0.00..229.00 rows=12500 width=16)
                           ->  Hash  (cost=5.25..5.25 rows=10 width=18)
                                 ->  Seq Scan on products p  (cost=0.00..5.25 rows=10 width=18)
                                       Filter: (category = 'audio'::text)
         ->  Hash  (cost=13.25..13.25 rows=62 width=4)
               ->  Seq Scan on customers c  (cost=0.00..13.25 rows=62 width=4)
                     Filter: (country = 'UAE'::text)`,
      run: true },
    { label: 'Advanced', title: 'Spills to disk, top-N sort, parallel plan shape and JIT',
      sql: `-- (1) Tiny work_mem: HashAggregate and Sort spill to temp files
SET work_mem = '64kB';
EXPLAIN ANALYZE SELECT customer_id, count(*), sum(total_amount) FROM orders GROUP BY customer_id;
EXPLAIN ANALYZE SELECT * FROM order_items ORDER BY unit_price DESC;
RESET work_mem;
EXPLAIN ANALYZE SELECT * FROM order_items ORDER BY unit_price DESC;
EXPLAIN ANALYZE SELECT * FROM order_items ORDER BY unit_price DESC LIMIT 10;

-- (2) Parallel plan (the browser sandbox is single-process: workers can't launch)
SET max_parallel_workers_per_gather = 2;
SET parallel_setup_cost = 0;
SET parallel_tuple_cost = 0;
SET min_parallel_table_scan_size = 0;
EXPLAIN ANALYZE SELECT status, count(*) FROM orders GROUP BY status;

-- (3) Is JIT available in this build?
SELECT pg_jit_available() AS jit_available, current_setting('jit') AS jit_setting;`,
      explain: `<p><strong>(1)</strong> With 64 kB, the HashAggregate reports <code>Planned Partitions: 4 Batches: 5 Disk Usage: 216kB</code> and <code>temp read/written</code> buffers; the full sort uses <code>external merge Disk: 560kB</code> (54 ms). With the default 4 MB it's an in-memory quicksort (928 kB). With <code>LIMIT 10</code>, <strong>top-N heapsort</strong> keeps only 10 rows in an 18 kB heap &mdash; far cheaper than sorting everything.</p>
<p><strong>(2)</strong> A parallel aggregate plan: <code>Parallel Seq Scan</code> &rarr; <code>Partial HashAggregate</code> per worker &rarr; <code>Gather Merge</code> &rarr; <code>Finalize GroupAggregate</code>. <code>Workers Planned: 2, Workers Launched: 0</code>: the leader did all the work because no background workers are available here. On a real server you'd see 2 launched workers and <code>loops=3</code> on the parallel nodes.</p>
<p><strong>(3)</strong> This PGlite build has no LLVM, so JIT is unavailable even though <code>jit = on</code>. On a normal server, queries costing &gt; 100,000 show a <code>JIT:</code> block with functions compiled and timing.</p>`,
      output: ` HashAggregate  (cost=471.81..526.89 rows=500 width=44) (actual time=15.047..17.081 rows=500.00 loops=1)
   Group Key: customer_id
   Planned Partitions: 4  Batches: 5  Memory Usage: 136kB  Disk Usage: 216kB
   Buffers: shared hit=89, temp read=11 written=33
   ->  Seq Scan on orders  (cost=0.00..139.00 rows=5000 width=12) (actual time=1.054..5.243 rows=5000.00 loops=1)

 Sort  (cost=1681.60..1712.85 rows=12500 width=32) (actual time=30.755..44.236 rows=12500.00 loops=1)
   Sort Key: unit_price DESC
   Sort Method: external merge  Disk: 560kB
   Buffers: shared hit=107, temp read=137 written=150
 Execution Time: 54.497 ms

 Sort  (cost=1079.60..1110.85 rows=12500 width=32) (actual time=21.072..31.677 rows=12500.00 loops=1)
   Sort Key: unit_price DESC
   Sort Method: quicksort  Memory: 928kB
 Execution Time: 38.502 ms

 Limit  (cost=499.12..499.15 rows=10 width=32) (actual time=15.022..15.032 rows=10.00 loops=1)
   ->  Sort  (cost=499.12..530.37 rows=12500 width=32) (actual time=14.714..14.718 rows=10.00 loops=1)
         Sort Key: unit_price DESC
         Sort Method: top-N heapsort  Memory: 18kB
 Execution Time: 15.076 ms

 Finalize GroupAggregate  (cost=120.38..120.63 rows=5 width=16) (actual time=36.390..37.007 rows=5.00 loops=1)
   Group Key: status
   ->  Gather Merge  (cost=120.38..120.52 rows=12 width=16) (actual time=36.133..36.739 rows=5.00 loops=1)
         Workers Planned: 2
         Workers Launched: 0
         ->  Sort  (cost=120.36..120.37 rows=5 width=16) (actual time=21.618..21.629 rows=5.00 loops=1)
               Sort Key: status
               Sort Method: quicksort  Memory: 17kB
               ->  Partial HashAggregate  (cost=120.25..120.30 rows=5 width=16) (actual time=21.051..21.066 rows=5.00 loops=1)
                     Group Key: status
                     ->  Parallel Seq Scan on orders  (cost=0.00..109.83 rows=2083 width=8) (actual time=2.773..10.193 rows=5000.00 loops=1)

 jit_available | jit_setting
---------------+-------------
 f             | on`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Forcing a nested loop: probes repeated once per outer row
SET enable_hashjoin = off;
SET enable_mergejoin = off;
SET enable_memoize = off;
EXPLAIN ANALYZE
SELECT c.name, count(*)
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'UAE'
GROUP BY c.name;
RESET enable_hashjoin; RESET enable_mergejoin; RESET enable_memoize;`,
      why: 'orders.customer_id has no index, so the best nested loop the planner can build drives from all 5,000 orders and probes customers_pkey 5,000 times (loops=5000, ~15,000 buffers), throwing away 88% of the probes because the customer is not in the UAE. Nested loops are only good when the outer side is small and each inner probe is cheap.', run: true },
    good: { sql: `-- Let the planner hash the small filtered side and scan orders once
EXPLAIN ANALYZE
SELECT c.name, count(*)
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'UAE'
GROUP BY c.name;`,
      why: 'A Hash Join builds a 62-row hash table of UAE customers and probes it with one pass over orders: ~96 buffers. Alternatively, CREATE INDEX ON orders(customer_id) would make an indexed nested loop competitive for very selective filters.', run: true }
  },
  mistakes: [
    `Raising <code>work_mem</code> globally to 1 GB to fix one spill and running the server out of memory under concurrency.`,
    `Forgetting that <code>Hash Join</code> requires an equality condition; joins on ranges or <code>LIKE</code> can only use nested loops (ideally with a GiST/GIN/B-tree index on the inner side).`,
    `Using huge IN-lists or many-table joins and wondering why planning takes 50 ms; check <code>Planning Time</code>.`,
    `Assuming parallel query is always on: small tables, write queries, PARALLEL UNSAFE functions and busy worker pools all prevent it.`,
    `Leaving JIT on for OLTP workloads whose estimated cost exceeds <code>jit_above_cost</code> but run in milliseconds, adding compile overhead to every execution.`
  ],
  best: [
    `Index foreign keys used in joins so nested loops (and Memoize) have cheap inner probes.`,
    `Check <code>Batches</code>, <code>Disk Usage</code> and <code>Sort Method: external merge</code> in EXPLAIN ANALYZE; raise <code>work_mem</code> for that role/query only.`,
    `Filter early and let the planner reorder; use <code>join_collapse_limit = 1</code> only as a deliberate, documented last resort.`,
    `Size parallelism to the workload: more workers for analytics, few or none for high-concurrency OLTP.`,
    `Set <code>jit = off</code> for OLTP databases/roles; keep it for analytical workloads and verify the JIT timing block.`
  ],
  performance: `
<p>Rules of thumb: Nested Loop cost grows with outer rows &times; inner probe cost &mdash; deadly if the outer estimate is too low. Hash Join is linear in both inputs but needs memory for the inner side; batching to disk roughly doubles I/O. Merge Join is linear when inputs are presorted, otherwise O(n log n) sorting dominates. HashAggregate memory is proportional to the number of groups; GroupAggregate streams but needs sorted input. Parallelism speeds up scan-heavy queries roughly linearly with workers up to I/O or memory-bandwidth limits, at the price of more total CPU.</p>`,
  security: `
<p><code>work_mem</code>, parallel settings and <code>jit</code> can be set by any user per session. In multi-tenant or shared environments, an untrusted user can request large work_mem and parallel workers to consume resources; set sensible per-role limits (<code>ALTER ROLE ... SET</code>), use <code>statement_timeout</code>, and limit <code>max_parallel_workers</code>. <code>temp_file_limit</code> caps disk spill per session.</p>`,
  scenario: {
    title: 'Nightly report flips to a nested loop and runs for hours',
    steps: [
      '1. The report usually finishes in 4 minutes; tonight it is still running after 3 hours.',
      '2. EXPLAIN (no ANALYZE, it would run for hours) shows Nested Loop with outer estimate rows=1 over a 40M-row join.',
      '3. EXPLAIN ANALYZE on a one-day sample reveals estimated 1 vs actual 380,000 rows on the date filter: stale statistics after a bulk load.',
      '4. ANALYZE the loaded tables; the plan switches to Hash Joins; the report completes in 5 minutes.',
      '5. Add ANALYZE to the end of the load job; set autovacuum_analyze_scale_factor = 0.01 on the big tables.',
      '6. Also check Hash Batches in the new plan: 8 batches -> SET work_mem = \'256MB\' for the reporting role only; batches drop to 1.'
    ]
  },
  widgets: ['diagram:joins', 'lab:join', 'lab:plan'],
  interview: [
    { q: 'Compare nested loop, hash join and merge join.',
      a: 'Nested loop iterates the outer input and probes the inner for each row; it supports any join condition and is best for small outer inputs with an indexed inner side. Hash join builds a hash table of the inner input and probes it with the outer; it needs equality conditions and memory but is linear for large unsorted inputs. Merge join walks two inputs sorted on the join key; it is best when both are already sorted (indexes) or very large, and supports full outer joins.' },
    { q: 'What is Memoize and when does it help?',
      a: 'A PG14+ plan node placed above the inner side of a parameterised nested loop that caches results per parameter value. When many outer rows share the same join key (e.g. 5,000 orders for 500 customers) it serves repeated lookups from the cache instead of re-probing the index. EXPLAIN ANALYZE shows hits, misses and evictions.' },
    { q: 'How does work_mem affect query execution and why is it risky to set it high?',
      a: 'work_mem limits memory per sort or hash operation (hash tables can use work_mem times hash_mem_multiplier). If exceeded, sorts use external merge and hashes spill into batches on disk. It is allocated per node, per query, per parallel worker, so a high global value multiplied by many concurrent complex queries can exhaust RAM; raise it selectively.' },
    { q: 'Why might Workers Launched be lower than Workers Planned?',
      a: 'Parallel workers come from a limited pool (max_parallel_workers and max_worker_processes shared with other background workers). If the pool is busy at execution time, fewer or zero workers start and the leader does the remaining work, so performance drops unexpectedly under concurrency.' }
  ],
  exercises: [
    { task: 'Show a Merge Join by joining employees to departments ordered by department id, then compare with the default plan for the same query without ORDER BY.',
      solution: `SET enable_hashjoin = off;
SET enable_nestloop = off;
EXPLAIN SELECT d.name, e.first_name
FROM departments d JOIN employees e ON e.department_id = d.id
ORDER BY d.id;
RESET enable_hashjoin;
RESET enable_nestloop;
EXPLAIN SELECT d.name, e.first_name
FROM departments d JOIN employees e ON e.department_id = d.id;`, run: true },
    { task: 'Find the smallest work_mem among 64kB, 256kB and 1MB at which SELECT * FROM order_items ORDER BY unit_price DESC sorts in memory.',
      solution: `SET work_mem = '64kB';
EXPLAIN ANALYZE SELECT * FROM order_items ORDER BY unit_price DESC;
SET work_mem = '256kB';
EXPLAIN ANALYZE SELECT * FROM order_items ORDER BY unit_price DESC;
SET work_mem = '1MB';
EXPLAIN ANALYZE SELECT * FROM order_items ORDER BY unit_price DESC;
RESET work_mem;
-- quicksort appears only once work_mem exceeds ~928kB, i.e. at 1MB`, run: true }
  ],
  challenge: {
    task: 'Write the revenue-by-category report for UAE customers (customers -> orders -> order_items -> products) and make sure the plan uses an index for order_items lookups; then explain (in comments) the join order the planner chose and why.',
    hint: 'idx_order_items_order exists. Look at which tables are filtered (country, category) and where the nested loop appears.',
    solution: `EXPLAIN ANALYZE
SELECT p.category, round(sum(oi.quantity * oi.unit_price), 2) AS revenue
FROM customers c
JOIN orders o       ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
WHERE c.country = 'UAE' AND o.status <> 'cancelled'
GROUP BY p.category
ORDER BY revenue DESC;
-- Typical plan: hash UAE customers (62 rows) and join to orders first (most selective),
-- then a Nested Loop probing idx_order_items_order for each surviving order,
-- then a Hash Join to the 100 products, and a HashAggregate by category.`,
    run: true
  },
  related: ['query-optimization-scan-types', 'explain-complex-plans', 'joins', 'configuration', 'query-optimization-rewriting'],
  quiz: [
    { type: 'mcq', q: 'Which join method can handle a non-equality join condition like o.order_date BETWEEN p.valid_from AND p.valid_to?',
      options: ['Hash Join', 'Merge Join', 'Nested Loop', 'None'],
      answer: 2, explain: 'Hash and merge joins require equality (mergejoinable/hashable) conditions.' },
    { type: 'predict', q: 'What does this line in EXPLAIN ANALYZE tell you?',
      code: `Hits: 4500  Misses: 500  Evictions: 0  Overflows: 0  Memory Usage: 41kB`,
      options: ['A hash join spilled to disk', 'A Memoize cache served 90% of inner lookups', 'Shared buffer hit ratio', 'Parallel workers stats'],
      answer: 1, explain: 'Memoize statistics: 500 distinct keys probed, 4,500 served from cache.' },
    { type: 'tf', q: 'work_mem is a per-session limit shared by all operations of a query.',
      answer: false, explain: 'It applies per sort/hash node (and per parallel worker), so one query can use several multiples of it.' },
    { type: 'scenario', q: 'EXPLAIN ANALYZE shows Hash Join with Batches: 16. What does it mean and what helps?',
      options: ['16 parallel workers; reduce workers', 'The hash table did not fit in memory and was split into 16 disk batches; raise work_mem for this query', 'Index corruption', '16 loops of a nested loop'],
      answer: 1, explain: 'Multiple batches = spilled hash join.' },
    { type: 'mcq', q: 'What does join_collapse_limit = 1 do?',
      options: ['Limits queries to one join', 'Forces joins to be executed in the order written in the query', 'Disables hash joins', 'Enables GEQO'],
      answer: 1, explain: 'The planner stops reordering explicit JOINs.' }
  ]
},

{
  id: 'query-optimization-rewriting',
  module: 'query-optimization',
  title: 'Query Rewriting Patterns: Sargable Predicates, OR, EXISTS vs IN vs JOIN, Pagination, N+1',
  level: 4,
  minutes: 30,
  summary: 'Rewrite slow SQL into index-friendly SQL: avoid functions on columns, turn ORs into IN/UNION, choose EXISTS/IN/JOIN correctly (and avoid the NOT IN NULL trap), use keyset pagination and kill N+1 query patterns.',
  objectives: [
    'Define sargable predicates and rewrite non-sargable ones (casts, functions, arithmetic on columns)',
    'Rewrite OR across columns into IN or UNION when appropriate',
    'Choose between EXISTS, IN, JOIN and DISTINCT, and avoid NOT IN with NULLs',
    'Replace OFFSET pagination with keyset (seek) pagination',
    'Detect and eliminate N+1 query patterns and correlated subqueries'
  ],
  concept: `
<p><strong>Sargable</strong> ("Search ARGument ABLE") means a predicate can be answered by an index seek: <code>indexed_column OPERATOR constant_expression</code>. The moment you wrap the column in something &mdash; <code>order_date::date = ...</code>, <code>date_part('year', order_date) = 2025</code>, <code>id + 0 = 42</code>, <code>lower(email) = ...</code> without an expression index &mdash; the index on the raw column can't be used and statistics are lost.</p>
<p><strong>Analogy: a dictionary.</strong> Finding words <em>starting with</em> "pre" is easy; finding words whose <em>third letter is "e"</em> means reading the whole dictionary. Move the computation to the constant side: instead of "year(date) = 2025" ask "date between 1 Jan 2025 and 1 Jan 2026".</p>
<p><strong>Key patterns:</strong></p>
<ul>
  <li><strong>Ranges instead of functions</strong>: <code>order_date &gt;= '2025-03-15' AND order_date &lt; '2025-03-16'</code> instead of <code>order_date::date = '2025-03-15'</code>.</li>
  <li><strong>OR on the same column &rarr; IN</strong> (PostgreSQL does it automatically: <code>= ANY('{1,2,3}')</code>). <strong>OR across different columns or with subqueries</strong> may block index use; rewrite as <code>UNION</code> (or rely on BitmapOr when both sides are indexable).</li>
  <li><strong>EXISTS / IN / JOIN</strong>: semi-joins (EXISTS, IN) return each outer row once; a JOIN multiplies rows and then needs DISTINCT. PostgreSQL plans <code>IN (subquery)</code> and <code>EXISTS</code> identically as semi-joins. <strong>NOT IN</strong> is dangerous: if the subquery returns a single NULL, the result is empty; use <code>NOT EXISTS</code> (an anti-join).</li>
  <li><strong>Keyset pagination</strong>: <code>WHERE id &gt; :last_seen ORDER BY id LIMIT 20</code> instead of <code>OFFSET 4900</code>, which must produce and throw away 4,900 rows.</li>
  <li><strong>N+1</strong>: an ORM loads 50 customers, then runs one query per customer for their orders (51 round trips). Fetch in one set-based query (JOIN + GROUP BY, <code>= ANY($1::int[])</code>, or LATERAL).</li>
</ul>`,
  why: `
<p>The planner is powerful but cannot rewrite every semantically-equivalent form: it won't turn <code>date_part('year', d) = 2025</code> into a range, won't remove NULL semantics from <code>NOT IN</code>, and can't optimise away work that application code performs in a loop. A large share of production slowness comes from a few recurring query shapes that are easy to fix once recognised.</p>`,
  useCase: `
<p><strong>Admin panel of a B2B SaaS:</strong> the "Orders" page used <code>OFFSET</code> pagination and an ORM that loaded each row's customer separately. Page 1 took 30 ms; page 2,000 took 4 s (OFFSET 40,000) and issued 21 queries. Switching to keyset pagination on <code>(created_at, id)</code> and eager-loading customers with a single <code>WHERE id = ANY(...)</code> made every page ~ 15 ms with 2 queries.</p>`,
  internals: `
<p><strong>Semi/anti-joins:</strong> <code>EXISTS</code> and <code>IN (subquery)</code> are "pulled up" into semi-joins, so the planner can choose Hash Semi Join, Nested Loop Semi Join or Merge Semi Join, and even reverse the sides (<code>Hash Right Semi Join</code>). <code>NOT EXISTS</code> becomes an anti-join. <code>NOT IN (subquery)</code> cannot become an anti-join because of NULL semantics (unless the planner can prove no NULLs &mdash; PG18 improves this for NOT NULL columns in some cases), so it is executed as a hashed SubPlan, or worse, a per-row SubPlan when the subquery result is too large to hash.</p>
<p><strong>OR across columns</strong> can use BitmapOr if each arm is indexable; if one arm is a subquery (<code>OR id IN (SELECT ...)</code>), the subquery becomes a SubPlan filter and the whole table is scanned. UNION lets each arm use its best plan (UNION ALL when duplicates are impossible or acceptable avoids the de-duplication step).</p>
<p><strong>OFFSET</strong> is implemented by the Limit node discarding rows: all skipped rows are still fetched, joined and sorted. <strong>Keyset</strong> pagination turns paging into an index range seek whose cost is independent of page number.</p>
<p><strong>Correlated subqueries</strong> in the SELECT list run once per outer row (<code>SubPlan</code> with <code>loops=N</code>). With a supporting index they can be fast (an InitPlan/Limit per row); without, they're N full scans.</p>`,
  whenNot: `
<ul>
  <li>Don't rewrite for its own sake: PostgreSQL already converts <code>OR</code> on one column into <code>= ANY</code>, inlines simple CTEs (PG12+) and plans IN/EXISTS the same. Measure first.</li>
  <li>Keyset pagination cannot jump to "page 37" directly; for admin UIs needing random access, combine keyset with approximate counts or limit max offset.</li>
  <li>UNION adds a de-duplication step; if the OR arms are both indexable, BitmapOr is usually simpler and as fast.</li>
</ul>`,
  syntax: `-- Sargable range instead of function on column
WHERE ts >= DATE '2025-03-15' AND ts < DATE '2025-03-16'

-- Semi-join / anti-join
WHERE EXISTS (SELECT 1 FROM child c WHERE c.parent_id = p.id)
WHERE NOT EXISTS (SELECT 1 FROM child c WHERE c.parent_id = p.id)

-- Keyset pagination (stable unique ordering)
WHERE (created_at, id) < (:last_created_at, :last_id)
ORDER BY created_at DESC, id DESC
LIMIT 20

-- Batch loading instead of N+1
SELECT * FROM orders WHERE customer_id = ANY($1::int[]);`,
  examples: [
    { label: 'Basic', title: 'Sargable vs non-sargable date filters',
      sql: `CREATE INDEX idx_orders_order_date ON orders (order_date);
ANALYZE orders;

-- Non-sargable: cast applied to every row
EXPLAIN ANALYZE SELECT id, total_amount FROM orders WHERE order_date::date = '2025-03-15';

-- Sargable: half-open range on the raw column
EXPLAIN ANALYZE SELECT id, total_amount FROM orders
WHERE order_date >= '2025-03-15' AND order_date < '2025-03-16';

-- Arithmetic on the column vs on the constant
EXPLAIN SELECT id FROM orders WHERE id + 0 = 42;
EXPLAIN SELECT id FROM orders WHERE id = 42 + 0;`,
      explain: `<p><code>order_date::date</code> forces a Seq Scan over 5,000 rows and the estimate is a guess (25 vs 7 actual). The range version uses the index (2 index pages + 7 heap pages) and is estimated accurately (6 vs 7). <code>42 + 0</code> is folded to a constant at plan time, so it stays sargable; <code>id + 0</code> is not.</p>
<p>The half-open interval <code>[start, next day)</code> is also correct for timestamps with fractional seconds, unlike <code>BETWEEN '...00:00' AND '...23:59:59'</code>.</p>`,
      output: ` Seq Scan on orders  (cost=0.00..164.00 rows=25 width=16) (actual time=0.638..7.108 rows=7.00 loops=1)
   Filter: ((order_date)::date = '2025-03-15'::date)
   Rows Removed by Filter: 4993
   Buffers: shared hit=89
 Execution Time: 7.408 ms

 Bitmap Heap Scan on orders  (cost=4.34..23.76 rows=6 width=16) (actual time=0.756..0.777 rows=7.00 loops=1)
   Recheck Cond: ((order_date >= '2025-03-15 00:00:00+05'::timestamp with time zone) AND (order_date < '2025-03-16 00:00:00+05'::timestamp with time zone))
   Heap Blocks: exact=7
   ->  Bitmap Index Scan on idx_orders_order_date  (cost=0.00..4.34 rows=6 width=0) (actual time=0.293..0.294 rows=7.00 loops=1)
         Index Cond: ((order_date >= '2025-03-15 00:00:00+05'::timestamp with time zone) AND (order_date < '2025-03-16 00:00:00+05'::timestamp with time zone))
 Execution Time: 1.499 ms

 Seq Scan on orders  (cost=0.00..164.00 rows=25 width=8)
   Filter: ((id + 0) = 42)

 Index Only Scan using orders_pkey on orders  (cost=0.28..8.30 rows=1 width=8)
   Index Cond: (id = 42)`,
      run: true },
    { label: 'Intermediate', title: 'IN vs EXISTS vs JOIN, and the NOT IN NULL trap',
      sql: `-- Customers with at least one cancelled order: three formulations
EXPLAIN ANALYZE SELECT c.id, c.name FROM customers c
WHERE c.id IN (SELECT customer_id FROM orders WHERE status = 'cancelled');

EXPLAIN ANALYZE SELECT c.id, c.name FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'cancelled');

EXPLAIN ANALYZE SELECT DISTINCT c.id, c.name FROM customers c
JOIN orders o ON o.customer_id = c.id WHERE o.status = 'cancelled';

-- Anti-join: customers WITHOUT pending orders
SELECT count(*) AS not_exists_count FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'pending');

-- NOT IN with a single NULL in the subquery returns NOTHING
SELECT count(*) AS not_in_with_null FROM customers c
WHERE c.id NOT IN (SELECT customer_id FROM orders WHERE status = 'pending'
                   UNION ALL SELECT NULL);`,
      explain: `<p><code>IN</code> and <code>EXISTS</code> produce the <strong>identical</strong> plan: <code>Hash Right Semi Join</code> returning 305 customers. The JOIN version first produces 428 joined rows (one per cancelled order) and then needs a <code>HashAggregate</code> to de-duplicate &mdash; extra work and a classic source of wrong results if DISTINCT is forgotten.</p>
<p><code>NOT EXISTS</code> is an anti-join: 213 customers have no pending order. With <code>NOT IN</code>, one NULL makes every comparison <code>id &lt;&gt; NULL</code> unknown, so the result is <strong>0</strong>. Always use <code>NOT EXISTS</code> for "has no related rows".</p>`,
      output: ` Hash Right Semi Join  (cost=18.25..174.95 rows=428 width=16) (actual time=3.034..12.843 rows=305.00 loops=1)
   Hash Cond: (orders.customer_id = c.id)
   ->  Seq Scan on orders  (cost=0.00..151.50 rows=428 width=4) (actual time=1.565..10.705 rows=428.00 loops=1)
         Filter: (status = 'cancelled'::text)
   ->  Hash  (cost=12.00..12.00 rows=500 width=16) (actual time=1.406..1.410 rows=500.00 loops=1)
         ->  Seq Scan on customers c  (cost=0.00..12.00 rows=500 width=16)

 Hash Right Semi Join  (cost=18.25..174.95 rows=428 width=16) (actual time=1.025..2.776 rows=305.00 loops=1)
   Hash Cond: (o.customer_id = c.id)
   ...same shape...

 HashAggregate  (cost=173.02..177.30 rows=428 width=16) (actual time=4.525..4.670 rows=305.00 loops=1)
   Group Key: c.id, c.name
   ->  Hash Join  (cost=18.25..170.88 rows=428 width=16) (actual time=0.752..3.418 rows=428.00 loops=1)
   ...

 not_exists_count
------------------
              213

 not_in_with_null
------------------
                0`,
      run: true },
    { label: 'Advanced', title: 'OFFSET vs keyset pagination, and N+1 vs set-based',
      sql: `-- Page 246 of 20 rows with OFFSET: reads and discards 4,900 rows
EXPLAIN ANALYZE SELECT id, order_date, total_amount FROM orders
ORDER BY id LIMIT 20 OFFSET 4900;

-- Keyset: remember the last id of the previous page
EXPLAIN ANALYZE SELECT id, order_date, total_amount FROM orders
WHERE id > 4900 ORDER BY id LIMIT 20;

-- N+1 shape: a correlated subquery per customer (what ORMs often generate)
EXPLAIN ANALYZE
SELECT c.id, c.name,
       (SELECT count(*) FROM orders o WHERE o.customer_id = c.id) AS order_count
FROM customers c WHERE c.country = 'UAE';

-- Set-based: one join + group by
EXPLAIN ANALYZE
SELECT c.id, c.name, count(o.id) AS order_count
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'UAE'
GROUP BY c.id, c.name;`,
      explain: `<p><strong>OFFSET:</strong> the index scan produced 4,920 rows (<code>rows=4920.00</code>) to return 20, touching 9,894 buffers. <strong>Keyset:</strong> it seeks directly to <code>id &gt; 4900</code>: 45 buffers, 0.13 ms, and the cost is the same for page 1 and page 10,000.</p>
<p><strong>N+1 / correlated subquery:</strong> <code>SubPlan 1</code> runs <code>loops=62</code>, each a full seq scan of orders (5,518 buffers, 53 ms). The set-based join scans orders once (96 buffers, 4.5 ms). Note <code>rows=9.68</code> on the inner node: per-loop averages are decimals in PG18 &mdash; multiply by loops for the total. In application code, the same anti-pattern is 62 separate round trips.</p>`,
      output: ` Limit  (cost=282.14..283.29 rows=20 width=24) (actual time=14.525..14.556 rows=20.00 loops=1)
   Buffers: shared hit=9894
   ->  Index Scan using orders_pkey on orders  (cost=0.28..287.89 rows=5000 width=24) (actual time=0.143..12.399 rows=4920.00 loops=1)
 Execution Time: 14.787 ms

 Limit  (cost=0.28..2.55 rows=20 width=24) (actual time=0.060..0.091 rows=20.00 loops=1)
   Buffers: shared hit=45
   ->  Index Scan using orders_pkey on orders  (cost=0.28..11.62 rows=100 width=24) (actual time=0.057..0.078 rows=20.00 loops=1)
         Index Cond: (id > 4900)
 Execution Time: 0.130 ms

 Seq Scan on customers c  (cost=0.00..9408.42 rows=62 width=24) (actual time=5.591..53.074 rows=62.00 loops=1)
   Filter: (country = 'UAE'::text)
   Buffers: shared hit=5525
   SubPlan 1
     ->  Aggregate  (cost=151.53..151.53 rows=1 width=8) (actual time=0.790..0.791 rows=1.00 loops=62)
           ->  Seq Scan on orders o  (cost=0.00..151.50 rows=10 width=0) (actual time=0.118..0.732 rows=9.68 loops=62)
                 Filter: (customer_id = c.id)
                 Rows Removed by Filter: 4990
 Execution Time: 53.197 ms

 HashAggregate  (cost=169.36..169.98 rows=62 width=24) (actual time=4.300..4.330 rows=62.00 loops=1)
   Group Key: c.id
   Buffers: shared hit=96
   ->  Hash Right Join  (cost=14.03..166.26 rows=620 width=24) (actual time=0.351..3.888 rows=600.00 loops=1)
         Hash Cond: (o.customer_id = c.id)
 Execution Time: 4.527 ms`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
-- OR with a subquery arm: forces a full scan with a SubPlan filter
EXPLAIN SELECT * FROM orders o
WHERE o.customer_id = 42
   OR o.id IN (SELECT order_id FROM payments WHERE method = 'wallet' AND amount > 290000);`,
      why: 'Because one arm of the OR is a subquery, the planner cannot use the customer_id index for the first arm; it scans all orders and evaluates a hashed SubPlan for every row.', run: true },
    good: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
-- UNION: each arm gets its own best plan
EXPLAIN SELECT * FROM orders o WHERE o.customer_id = 42
UNION
SELECT o.* FROM orders o
JOIN payments p ON p.order_id = o.id
WHERE p.method = 'wallet' AND p.amount > 290000;`,
      why: 'The first arm becomes a Bitmap Index Scan on idx_orders_customer_id; the second becomes a hash join driven by the filtered payments. UNION removes duplicates (an order matching both arms). Use UNION ALL plus a NOT condition on the second arm when you can guarantee disjointness.', run: true }
  },
  mistakes: [
    `Filtering timestamps with <code>col::date = ...</code>, <code>date_trunc('day', col) = ...</code> or <code>extract(...)</code> on the column instead of a half-open range.`,
    `Using <code>NOT IN (subquery)</code> where the subquery column is nullable; one NULL silently empties the result.`,
    `Joining to a child table to "check existence" and then adding <code>DISTINCT</code> to undo the row multiplication; use <code>EXISTS</code>.`,
    `Deep <code>OFFSET</code> pagination on large tables (and computing <code>count(*)</code> of the full result for every page).`,
    `ORM lazy loading in loops (N+1). Turn on query logging in development and count queries per request.`,
    `Comparing columns with parameters of a different type (bigint column vs numeric parameter, varchar vs text with collation), which can make predicates non-sargable.`
  ],
  best: [
    `Keep indexed columns "naked" in WHERE clauses; move computation to the constant side or create an expression index deliberately.`,
    `Use <code>EXISTS</code>/<code>NOT EXISTS</code> for existence checks; IN is fine for positive checks with non-null keys.`,
    `Use keyset pagination with a unique, indexed sort key (e.g. <code>(created_at, id)</code>).`,
    `Fetch related data in sets: JOIN + GROUP BY, <code>= ANY($1)</code> batches, or <code>LATERAL</code> for top-N per group.`,
    `Validate each rewrite with <code>EXPLAIN (ANALYZE, BUFFERS)</code> and identical result sets (EXCEPT both ways).`
  ],
  performance: `
<p>Typical gains on large tables: sargable rewrite 10&ndash;1000x (seq scan &rarr; index range); NOT IN &rarr; NOT EXISTS from per-row SubPlan to hash anti-join (minutes &rarr; seconds) plus correctness; keyset pagination makes deep pages O(page size) instead of O(offset); eliminating N+1 removes N network round trips (often 0.2&ndash;1 ms each even on a LAN) and N parse/plan cycles.</p>`,
  security: `
<p>Rewrites that move from string-built SQL to parameterised set queries (<code>= ANY($1::int[])</code>) also eliminate SQL-injection risk from concatenating ID lists. Keyset tokens returned to clients should be opaque (signed/encoded) so users can't craft cursors to skip authorization filters &mdash; always re-apply tenant/RLS filters on every page.</p>`,
  scenario: {
    title: 'Customer export endpoint times out at page 500',
    steps: [
      '1. API GET /customers?page=N uses ORDER BY created_at OFFSET (N-1)*100 LIMIT 100 plus a per-row query for last order.',
      '2. pg_stat_statements: the per-row "last order" query is called 100x per request; the page query mean time grows with N.',
      '3. EXPLAIN ANALYZE page 500: Index Scan returns 50,000 rows to keep 100.',
      '4. Rewrite pagination as keyset: WHERE (created_at, id) > ($1, $2) ORDER BY created_at, id LIMIT 100; create index (created_at, id).',
      '5. Replace the per-row query with LEFT JOIN LATERAL (SELECT max(order_date) ... WHERE customer_id = c.id) backed by an index on orders(customer_id, order_date).',
      '6. Result: constant ~ 8 ms per page, 1 query per request; export of 2M customers finishes in 3 minutes instead of timing out.'
    ]
  },
  widgets: ['lab:plan', 'diagram:query-pipeline'],
  interview: [
    { q: 'What is a sargable predicate? Give examples of non-sargable ones and their rewrites.',
      a: 'A predicate of the form column operator constant that an index can use as a search boundary. Non-sargable examples: date(created_at) = \'2025-03-15\' (rewrite as created_at >= \'2025-03-15\' AND created_at < \'2025-03-16\'), amount * 1.18 > 1000 (rewrite as amount > 1000 / 1.18), lower(email) = $1 (create an expression index on lower(email) or store normalised values).' },
    { q: 'Why is NOT IN dangerous, and what should you use instead?',
      a: 'Under SQL three-valued logic, x NOT IN (list) is NULL if the list contains a NULL and x matches nothing, so the WHERE clause filters out every row and the query returns nothing. PostgreSQL also cannot turn it into an efficient anti-join in general. NOT EXISTS has the intended semantics and is planned as an anti-join.' },
    { q: 'Explain keyset pagination and its trade-offs.',
      a: 'Instead of OFFSET, the client sends the sort key of the last row seen, and the query seeks past it: WHERE (created_at, id) > ($1, $2) ORDER BY created_at, id LIMIT n. With a matching index the cost is constant per page. Trade-offs: no random page access, the sort key must be unique and stable, and the client must carry the cursor.' },
    { q: 'How would you detect and fix an N+1 problem?',
      a: 'Look for many identical cheap queries per request in application logs, ORM debug output or pg_stat_statements (very high calls with low mean time). Fix by eager loading: a JOIN, a single WHERE id = ANY($1) batch query, or a LATERAL subquery so related data is fetched in one or two round trips.' }
  ],
  exercises: [
    { task: 'Rewrite this non-sargable query so it can use an index on orders(order_date): SELECT count(*) FROM orders WHERE extract(year FROM order_date) = 2024 AND extract(month FROM order_date) = 12;',
      solution: `CREATE INDEX idx_orders_order_date ON orders (order_date);
ANALYZE orders;
EXPLAIN SELECT count(*) FROM orders
WHERE order_date >= '2024-12-01' AND order_date < '2025-01-01';`, run: true },
    { task: 'List products that have never been ordered, using an anti-join.',
      solution: `SELECT p.id, p.name
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id)
ORDER BY p.id;`, run: true },
    { task: 'Write the keyset query for page 2 of orders sorted by (order_date DESC, id DESC), given the last row of page 1 had order_date = \'2025-09-30 12:00+00\' and id = 4000.',
      solution: `CREATE INDEX idx_orders_date_id ON orders (order_date DESC, id DESC);
SELECT id, order_date, total_amount
FROM orders
WHERE (order_date, id) < ('2025-09-30 12:00+00'::timestamptz, 4000)
ORDER BY order_date DESC, id DESC
LIMIT 20;`, run: true }
  ],
  challenge: {
    task: 'For each customer in India, return their 2 most recent orders (top-N per group) efficiently. Create the supporting index and use LATERAL.',
    hint: 'CROSS JOIN LATERAL (SELECT ... WHERE o.customer_id = c.id ORDER BY order_date DESC LIMIT 2) with an index on (customer_id, order_date DESC).',
    solution: `CREATE INDEX idx_orders_cust_date_desc ON orders (customer_id, order_date DESC);
ANALYZE orders;
SELECT c.id AS customer_id, c.name, o.id AS order_id, o.order_date, o.total_amount
FROM customers c
CROSS JOIN LATERAL (
  SELECT id, order_date, total_amount
  FROM orders o
  WHERE o.customer_id = c.id
  ORDER BY o.order_date DESC
  LIMIT 2
) AS o
WHERE c.country = 'India'
ORDER BY c.id, o.order_date DESC
LIMIT 10;`,
    run: true
  },
  related: ['subqueries', 'query-optimization-joins', 'indexes-partial-expression', 'query-optimization-tuning-walkthrough'],
  quiz: [
    { type: 'optimize', q: 'Best rewrite for index use?',
      code: `SELECT * FROM orders WHERE date_trunc('month', order_date) = '2025-03-01';`,
      options: ['WHERE order_date::text LIKE \'2025-03%\'', 'WHERE order_date >= \'2025-03-01\' AND order_date < \'2025-04-01\'', 'WHERE extract(month FROM order_date) = 3', 'Add DISTINCT'],
      answer: 1, explain: 'A half-open range on the raw column is sargable and well estimated.' },
    { type: 'predict', q: 'The subquery returns {1, 2, NULL}. What does this return?',
      code: `SELECT count(*) FROM customers WHERE id NOT IN (SELECT x FROM (VALUES (1),(2),(NULL)) t(x));`,
      options: ['498', '500', '0', 'Error'],
      answer: 2, explain: 'Any NULL in a NOT IN list makes the predicate NULL (not true) for every non-matching row.' },
    { type: 'tf', q: 'PostgreSQL usually produces the same semi-join plan for IN (subquery) and EXISTS.',
      answer: true, explain: 'Both are pulled up into semi-joins.' },
    { type: 'mcq', q: 'Why does OFFSET 100000 LIMIT 20 get slower as OFFSET grows?',
      options: ['OFFSET disables indexes', 'All skipped rows must still be produced and discarded', 'It triggers VACUUM', 'It uses a different isolation level'],
      answer: 1, explain: 'The Limit node throws away rows after fetching them.' },
    { type: 'write', q: 'Write a query returning departments that have NO active employees.',
      solution: `SELECT d.id, d.name
FROM departments d
WHERE NOT EXISTS (
  SELECT 1 FROM employees e
  WHERE e.department_id = d.id AND e.is_active
);`,
      explain: 'NOT EXISTS expresses "no matching rows" correctly (anti-join), regardless of NULLs.' }
  ]
},

{
  id: 'query-optimization-tuning-walkthrough',
  module: 'query-optimization',
  title: 'Real-World Tuning Walk-through: "Your 500M-Row Table Became Slow"',
  level: 5,
  minutes: 35,
  summary: 'A senior DBA\'s 10-step playbook for a large table that got slow: measure, EXPLAIN ANALYZE, indexes, statistics, bloat, locks, I/O, partitioning, read replicas and sharding, practised on company_db.',
  objectives: [
    'Apply a structured, evidence-driven 10-step tuning process instead of guessing',
    'Find the queries and tables that matter using statistics views before touching anything',
    'Distinguish plan problems (indexes, statistics) from system problems (bloat, locks, I/O)',
    'Know when to escalate to architecture: partitioning, read replicas, sharding',
    'Practise each step on company_db with runnable diagnostics'
  ],
  concept: `
<p><strong>Analogy: a doctor in the emergency room.</strong> A good doctor doesn't prescribe surgery because the patient "feels slow". They measure vital signs, run targeted tests, rule out common causes first, treat, then re-measure. Database tuning works the same: <em>measure &rarr; hypothesise &rarr; change one thing &rarr; measure again</em>. Escalation goes from cheap and reversible (an index, ANALYZE) to expensive and structural (partitioning, sharding).</p>
<p><strong>The 10-step playbook</strong> for "the 500M-row <code>orders</code> table became slow":</p>
<ol>
  <li><strong>Measure and scope</strong>: which queries, since when, how slow (p50/p95/p99), what changed (deploy, data growth, config, plan flip)? Use <code>pg_stat_statements</code> (extension) for top queries by total time, plus app metrics.</li>
  <li><strong>EXPLAIN (ANALYZE, BUFFERS)</strong> the worst queries with real parameters; find the node where time and buffers explode and where estimates diverge from actuals.</li>
  <li><strong>Indexes</strong>: missing (seq scan on a selective predicate), wrong column order, non-sargable predicates, missing FK indexes, unused indexes slowing writes.</li>
  <li><strong>Statistics</strong>: <code>last_analyze</code>, <code>n_mod_since_analyze</code>, misestimates on correlated columns, default stats target on skewed columns.</li>
  <li><strong>Bloat and vacuum health</strong>: <code>n_dead_tup</code>, autovacuum lag, long-running transactions holding back cleanup, index bloat, Heap Fetches in index-only scans.</li>
  <li><strong>Locks and contention</strong>: <code>pg_stat_activity.wait_event_type = 'Lock'</code>, <code>pg_blocking_pids()</code>, long transactions, DDL waiting in the lock queue.</li>
  <li><strong>I/O and memory</strong>: cache hit ratio, <code>shared read</code> vs <code>hit</code> buffers, <code>track_io_timing</code>, temp-file spills (<code>work_mem</code>), checkpoints, storage latency.</li>
  <li><strong>Partitioning</strong>: when queries filter by time/tenant and maintenance (VACUUM, index rebuilds, deletes of old data) is painful on one huge table.</li>
  <li><strong>Read replicas</strong>: offload reporting and read traffic once the primary is CPU/IO-bound on reads (accept replication lag).</li>
  <li><strong>Sharding</strong> (e.g. Citus <span class="tag ext">extension</span>, or application-level): only when a single node can't hold the write volume or data size even after all of the above.</li>
</ol>
<div class="callout tip">Most incidents are solved at steps 2&ndash;5. Steps 8&ndash;10 are architecture projects measured in weeks, not hot-fixes.</div>`,
  why: `
<p>Under pressure, teams jump to big solutions ("we need sharding!", "add more RAM!") or random config changes, often making things worse and losing the evidence. A repeatable process finds the actual bottleneck quickly, fixes it with the smallest change, and produces a clear record of cause and effect &mdash; essential for post-mortems and for avoiding regressions.</p>`,
  useCase: `
<p><strong>Case: logistics platform, <code>shipments</code> = 520M rows, 1.4 TB.</strong> Symptom: tracking API p95 rose from 40 ms to 2.8 s over two weeks. Walk-through: (1) pg_stat_statements: one query = 61% of total time; (2) EXPLAIN: <code>Index Scan</code> on <code>(status)</code> then filter on <code>customer_id</code>, 180k buffers; (3) new composite index <code>(customer_id, created_at DESC)</code> built concurrently; (4) also stale stats on <code>status</code> after a backfill &mdash; ANALYZE; (5) autovacuum was blocked by a 9-day-old idle-in-transaction session from a BI tool &rarr; terminated, <code>idle_in_transaction_session_timeout</code> set; (7) cache hit ratio back to 99.6%; (8) monthly partitioning planned to make purging old shipments a <code>DETACH</code> instead of a 6-hour DELETE. Result: p95 35 ms in two days, no hardware change.</p>`,
  internals: `
<p><strong>Where time goes in a slow query:</strong> CPU in plan nodes (filters, joins, sorts), buffer accesses (shared hits are cheap, reads go to the OS/disk), waits (locks, I/O, LWLocks on hot pages, client network), and planning. EXPLAIN ANALYZE shows per-node time and buffers; <code>pg_stat_activity.wait_event</code> shows what a running backend is waiting on <em>right now</em>; <code>pg_stat_statements</code> aggregates per query shape (calls, total/mean time, rows, shared_blks_hit/read, temp blocks, WAL).</p>
<p><strong>Why big tables degrade:</strong> B-tree height grows slowly but working sets outgrow RAM; autovacuum's default thresholds (20% dead rows for vacuum, 10% changes for analyze) mean huge tables are processed rarely and for a long time; statistics samples stay at 30k rows; deleting old data generates bloat; and any seq scan becomes catastrophic. Partitioning restores "small table" behaviour: per-partition vacuum/analyze, partition pruning, cheap data retirement.</p>
<p><strong>Read replicas</strong> (streaming replication) scale reads but not writes; queries on replicas may be cancelled by recovery conflicts (<code>hot_standby_feedback</code>, <code>max_standby_streaming_delay</code>). <strong>Sharding</strong> distributes rows across nodes by a shard key; cross-shard joins and transactions become expensive, so it's a last resort.</p>`,
  whenNot: `
<ul>
  <li>Don't partition to "make queries faster" when queries don't filter on the partition key &mdash; they'll scan all partitions and planning gets slower.</li>
  <li>Don't add replicas to fix a slow query; a bad plan is equally bad on a replica.</li>
  <li>Don't change several things at once (index + config + query); you won't know what helped or what hurt.</li>
  <li>Don't run <code>EXPLAIN ANALYZE</code> on a 40-minute production DML query without a transaction you roll back, or on a primary at peak.</li>
</ul>`,
  syntax: `-- Top queries (extension, needs shared_preload_libraries = 'pg_stat_statements')
SELECT queryid, calls, round(total_exec_time) AS total_ms, round(mean_exec_time, 2) AS mean_ms, rows, query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;

EXPLAIN (ANALYZE, BUFFERS, SETTINGS) <query>;
SELECT * FROM pg_stat_user_tables WHERE relname = 'orders';
SELECT pid, pg_blocking_pids(pid), wait_event_type, wait_event, state, query FROM pg_stat_activity;
SELECT * FROM pg_statio_user_tables;   -- heap/index blocks hit vs read`,
  examples: [
    { label: 'Basic', title: 'Steps 1-2: find the tables doing sequential work',
      sql: `-- Simulate some application traffic
SELECT count(*) FROM orders   WHERE customer_id = 5;
SELECT count(*) FROM orders   WHERE customer_id = 6;
SELECT count(*) FROM payments WHERE order_id = 6;
SELECT pg_stat_force_next_flush();   -- flush this session's counters now

-- Which tables are being read sequentially, and how much?
SELECT relname, seq_scan, seq_tup_read, idx_scan,
       CASE WHEN seq_scan > 0 THEN seq_tup_read / seq_scan END AS avg_rows_per_seq_scan
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 5;`,
      explain: `<p>A table with many seq scans that each read the whole table (<code>avg_rows_per_seq_scan</code> &asymp; table size) while queries return few rows is a prime "missing index" suspect. Here <code>orders</code> was fully scanned twice (5,000 rows each) to answer per-customer lookups, and <code>payments</code> once &mdash; matching the two deliberately missing indexes (<code>orders.customer_id</code>, <code>payments.order_id</code>).</p>
<p>In production, sort by <code>seq_tup_read</code> over a known time window (take snapshots and diff), then use <code>pg_stat_statements</code> to find which queries cause it.</p>`,
      output: ` relname  | seq_scan | seq_tup_read | idx_scan | avg_rows_per_seq_scan
----------+----------+--------------+----------+-----------------------
 orders   |        2 |        10000 |        0 |                  5000
 payments |        1 |         4585 |        0 |                  4585`,
      run: true },
    { label: 'Intermediate', title: 'Steps 2-3: EXPLAIN, design the index, re-measure',
      sql: `-- "Last order date per customer" written as a correlated subquery
EXPLAIN ANALYZE
SELECT c.id, (SELECT max(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order
FROM customers c;

-- The fix: an index that matches the subquery's filter AND its max()
CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date DESC);
VACUUM ANALYZE orders;   -- statistics + visibility map for index-only scans

EXPLAIN ANALYZE
SELECT c.id, (SELECT max(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order
FROM customers c;`,
      explain: `<p><strong>Before:</strong> the SubPlan runs 500 times (<code>loops=500</code>), each a full scan of orders: <code>Rows Removed by Filter: 4990</code> per loop, <strong>44,507 buffers, ~1.2 s</strong>. That's the signature of "work proportional to outer rows &times; inner table size".</p>
<p><strong>After:</strong> PostgreSQL rewrites <code>max()</code> into an <code>InitPlan</code> with <code>Limit 1</code> over an <strong>Index Only Scan</strong> (<code>Heap Fetches: 0</code>): each probe reads ~2 index pages. <strong>1,008 buffers, ~31 ms</strong> &mdash; 40x faster with one index and no query change. Re-measuring after each change is step 3's whole point.</p>`,
      output: `-- BEFORE
 Seq Scan on customers c  (cost=0.00..75779.50 rows=500 width=12) (actual time=40.897..1246.532 rows=500.00 loops=1)
   Buffers: shared hit=44507
   SubPlan 1
     ->  Aggregate  (cost=151.53..151.53 rows=1 width=8) (actual time=2.343..2.344 rows=1.00 loops=500)
           ->  Seq Scan on orders o  (cost=0.00..151.50 rows=10 width=8) (actual time=0.257..2.240 rows=10.00 loops=500)
                 Filter: (customer_id = c.id)
                 Rows Removed by Filter: 4990
 Execution Time: 1248.217 ms

-- AFTER
 Seq Scan on customers c  (cost=0.00..367.00 rows=500 width=12) (actual time=0.829..30.212 rows=500.00 loops=1)
   Buffers: shared hit=1008
   SubPlan 2
     ->  Result  (cost=0.70..0.71 rows=1 width=8) (actual time=0.055..0.056 rows=1.00 loops=500)
           InitPlan 1
             ->  Limit  (cost=0.28..0.70 rows=1 width=8) (actual time=0.019..0.020 rows=1.00 loops=500)
                   ->  Index Only Scan using idx_orders_cust_date on orders o  (cost=0.28..4.46 rows=10 width=8) (actual time=0.014..0.014 rows=1.00 loops=500)
                         Index Cond: (customer_id = c.id)
                         Heap Fetches: 0
                         Index Searches: 500
 Execution Time: 31.149 ms`,
      run: true },
    { label: 'Advanced', title: 'Steps 6 and 8: lock check and partition pruning',
      sql: `-- Step 6: who is blocked by whom? (empty in this single-session sandbox)
SELECT a.pid, pg_blocking_pids(a.pid) AS blocked_by, a.state,
       a.wait_event_type, a.wait_event,
       now() - a.xact_start AS xact_age, left(a.query, 60) AS query
FROM pg_stat_activity a
WHERE a.pid <> pg_backend_pid()
ORDER BY xact_age DESC NULLS LAST;

-- Step 8: a range-partitioned copy of orders
CREATE TABLE orders_part (
  id bigint, customer_id int, status text,
  order_date timestamptz NOT NULL, total_amount numeric
) PARTITION BY RANGE (order_date);
CREATE TABLE orders_2024 PARTITION OF orders_part
  FOR VALUES FROM ('2024-01-01 00:00+00') TO ('2025-01-01 00:00+00');
CREATE TABLE orders_2025 PARTITION OF orders_part
  FOR VALUES FROM ('2025-01-01 00:00+00') TO ('2026-01-01 00:00+00');
CREATE TABLE orders_old PARTITION OF orders_part DEFAULT;
INSERT INTO orders_part SELECT id, customer_id, status, order_date, total_amount FROM orders;
CREATE INDEX ON orders_part (customer_id, order_date);   -- cascades to every partition
ANALYZE orders_part;

-- June 2025 only: the planner prunes 2024 and DEFAULT partitions
EXPLAIN SELECT count(*), sum(total_amount) FROM orders_part
WHERE order_date >= '2025-06-01 00:00+00' AND order_date < '2025-07-01 00:00+00';`,
      explain: `<p><strong>Locks:</strong> in production this query lists sessions, who blocks them and how old their transactions are. A blocked chain usually starts with a long transaction or an idle-in-transaction session; the fix is to end it and prevent recurrence with <code>idle_in_transaction_session_timeout</code> and <code>lock_timeout</code>.</p>
<p><strong>Partitioning:</strong> the plan touches only <code>orders_2025</code>: <em>partition pruning</em> removed the other partitions at plan time. On a 500M-row table, a one-month query reads one month's partition, VACUUM/ANALYZE work per partition, and retiring 2023 data is <code>DETACH PARTITION</code> + <code>DROP TABLE</code> instead of a massive DELETE.</p>`,
      output: ` pid | blocked_by | state | wait_event_type | wait_event | xact_age | query
-----+------------+-------+-----------------+------------+----------+-------
(0 rows)

 Aggregate  (cost=52.73..52.74 rows=1 width=40)
   ->  Seq Scan on orders_2025 orders_part  (cost=0.00..51.44 rows=257 width=8)
         Filter: ((order_date >= '2025-06-01 05:00:00+05'::timestamp with time zone) AND (order_date < '2025-07-01 05:00:00+05'::timestamp with time zone))`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Guess-driven tuning: change global settings and hope
SET work_mem = '512MB';
SET random_page_cost = 1;
SET enable_seqscan = off;
SELECT c.id, (SELECT max(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order
FROM customers c
LIMIT 5;
RESET work_mem; RESET random_page_cost; RESET enable_seqscan;`,
      why: 'Three random knobs changed at once, none addressing the real cause (a correlated subquery scanning orders 500 times with no supporting index). Even if something improves, you cannot tell what, and global changes affect every other query.', run: true },
    good: { sql: `-- Evidence-driven: measure, find the hot node, fix it, re-measure
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id, (SELECT max(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order
FROM customers c;
CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date DESC);
VACUUM ANALYZE orders;
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id, (SELECT max(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order
FROM customers c;`,
      why: 'One targeted change justified by the plan (SubPlan loops=500 doing seq scans), verified by a before/after comparison of buffers and time: 44,507 -> 1,008 buffers.', run: true }
  },
  mistakes: [
    `Starting with hardware or configuration changes before looking at the top queries and their plans.`,
    `Changing multiple variables at once and losing the ability to attribute improvement or regression.`,
    `Testing on a small staging database whose statistics and plans differ completely from production.`,
    `Ignoring long-running or idle-in-transaction sessions that block VACUUM and cause bloat that slowly degrades everything.`,
    `Partitioning by a key that queries don't filter on, or creating thousands of tiny partitions that explode planning time.`,
    `Reaching for sharding before exhausting indexes, statistics, vacuum tuning, partitioning and read replicas.`
  ],
  best: [
    `Keep <code>pg_stat_statements</code> (extension) enabled everywhere, plus <code>log_min_duration_statement</code> and <code>auto_explain</code> for slow queries.`,
    `Keep a runbook: the 10 steps, the diagnostic queries and the escalation thresholds, and record every change with before/after metrics.`,
    `Snapshot statistics views periodically (or use a monitoring tool) so you can compare "before it got slow" with "now".`,
    `Set guard rails: <code>statement_timeout</code>, <code>idle_in_transaction_session_timeout</code>, <code>lock_timeout</code> for migrations.`,
    `Plan architecture changes (partitioning, replicas, sharding) before you need them; they take weeks to execute safely.`
  ],
  performance: `
<p>Expected impact by step (typical, order of magnitude): missing/wrong index 10&ndash;10,000x for the affected query; statistics fix 2&ndash;1000x when it flips a bad join strategy; bloat/vacuum fixes 1.2&ndash;5x across the board; lock fixes eliminate stalls entirely; I/O/memory tuning 1.2&ndash;3x; partitioning makes time-bounded queries and maintenance proportional to partition size; replicas multiply read capacity roughly per replica; sharding multiplies write capacity but adds latency and complexity to cross-shard work.</p>`,
  security: `
<p>Diagnostic access needs care: <code>pg_stat_activity.query</code> and <code>pg_stat_statements</code> can reveal other users' query texts (possibly with literals containing personal data). Grant <code>pg_read_all_stats</code> / <code>pg_monitor</code> to monitoring roles rather than superuser. Terminating sessions (<code>pg_terminate_backend</code>) requires appropriate privileges (<code>pg_signal_backend</code>); document who may do it during incidents.</p>`,
  scenario: {
    title: 'Your 500M-row orders table became slow: the 10-step playbook',
    steps: [
      '1. Measure: from pg_stat_statements, the top 5 queries by total_exec_time; note calls, mean, p95 from app metrics; ask what changed (deploys, data growth, bulk loads, config).',
      '2. EXPLAIN (ANALYZE, BUFFERS) each with real parameters (wrap DML in BEGIN ... ROLLBACK); locate the node with most time/buffers and the first big estimate-vs-actual gap.',
      '3. Indexes: add the missing composite/covering index (CONCURRENTLY), fix non-sargable predicates, index FK columns; drop unused indexes that slow writes.',
      '4. Statistics: check last_analyze and n_mod_since_analyze; ANALYZE; add CREATE STATISTICS for correlated columns; raise stats target for skewed columns; tune autovacuum_analyze_scale_factor for the table.',
      '5. Bloat/vacuum: check n_dead_tup, last_autovacuum, Heap Fetches, oldest xmin (pg_stat_activity.backend_xmin); kill long transactions; tune autovacuum cost limits; REINDEX CONCURRENTLY bloated indexes.',
      '6. Locks: pg_stat_activity wait_event_type = Lock, pg_blocking_pids(); find the root blocker; set lock_timeout and idle_in_transaction_session_timeout.',
      '7. I/O and memory: shared hit vs read, cache hit ratio from pg_statio_user_tables, temp files (work_mem), checkpoint frequency, storage latency (track_io_timing).',
      '8. Partitioning: if queries filter by time/tenant and maintenance hurts, migrate to range/list partitions with pruning; retire old data via DETACH PARTITION.',
      '9. Read replicas: route reporting and read-only API traffic to streaming replicas (handle lag and recovery conflicts).',
      '10. Sharding: only if a single primary cannot sustain the write rate or data size after steps 1-9; evaluate Citus (extension) or application-level sharding with a tenant/customer shard key.'
    ]
  },
  widgets: ['diagram:query-pipeline', 'diagram:partitioning', 'diagram:read-replica', 'diagram:sharding'],
  interview: [
    { q: 'A large table has become slow. Walk me through your approach.',
      a: 'Scope the problem with pg_stat_statements and application metrics (which queries, how slow, since when, what changed). EXPLAIN (ANALYZE, BUFFERS) the top offenders to find the expensive node and estimate errors. Then check indexes, statistics, vacuum/bloat, locks and I/O in that order, changing one thing at a time and re-measuring. Only when those are healthy consider partitioning, read replicas and finally sharding.' },
    { q: 'How do you tell a plan problem from a system problem?',
      a: 'If EXPLAIN ANALYZE of the query in isolation is slow and shows huge buffer counts or row misestimates, it is a plan or design problem. If the plan is fine in isolation but slow under load, look at waits in pg_stat_activity (locks, I/O, LWLocks), CPU saturation, cache hit ratio, checkpoints and connection counts: that is a system or contention problem.' },
    { q: 'When does partitioning help performance, and when does it hurt?',
      a: 'It helps when most queries filter on the partition key so pruning skips most data, and when maintenance (vacuum, index rebuilds, purging old data) benefits from smaller units. It hurts when queries don\'t include the key (all partitions scanned), when there are too many partitions (planning overhead, more open files), or when global uniqueness across partitions is required on columns not in the key.' },
    { q: 'What is the role of read replicas versus sharding?',
      a: 'Read replicas copy the whole database via streaming replication and scale read throughput, but every write still goes to one primary, and replicas lag. Sharding splits data across nodes by a shard key so writes and storage scale horizontally, at the cost of cross-shard queries, distributed transactions and operational complexity.' }
  ],
  exercises: [
    { task: 'Write a health query for a table: size, live/dead tuples, last (auto)vacuum and (auto)analyze, and modifications since the last analyze, for orders.',
      solution: `SELECT relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       n_live_tup, n_dead_tup,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
       n_mod_since_analyze
FROM pg_stat_user_tables
WHERE relname = 'orders';`, run: true },
    { task: 'Compute the buffer cache hit percentage per table from pg_statio_user_tables (after running a couple of queries).',
      solution: `SELECT count(*) FROM orders;
SELECT count(*) FROM order_items;
SELECT pg_stat_force_next_flush();
SELECT relname, heap_blks_read, heap_blks_hit,
       round(100.0 * heap_blks_hit / nullif(heap_blks_hit + heap_blks_read, 0), 2) AS hit_pct
FROM pg_statio_user_tables
WHERE heap_blks_hit + heap_blks_read > 0
ORDER BY heap_blks_hit + heap_blks_read DESC;`, run: true }
  ],
  challenge: {
    task: 'Fix the "orders of a customer, newest first, page 1" API query end-to-end: measure with EXPLAIN (ANALYZE, BUFFERS), add the right index, VACUUM ANALYZE, re-measure, and finally prove the old plan is gone by showing the index name in the new plan.',
    hint: 'Query: SELECT id, order_date, total_amount FROM orders WHERE customer_id = 123 ORDER BY order_date DESC LIMIT 10. Index: (customer_id, order_date DESC) INCLUDE (total_amount).',
    solution: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, order_date, total_amount FROM orders
WHERE customer_id = 123 ORDER BY order_date DESC LIMIT 10;

CREATE INDEX idx_orders_cust_date_cover ON orders (customer_id, order_date DESC) INCLUDE (total_amount, id);
VACUUM ANALYZE orders;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, order_date, total_amount FROM orders
WHERE customer_id = 123 ORDER BY order_date DESC LIMIT 10;`,
    run: true
  },
  related: ['query-analysis-diagnosis-checklist', 'partitioning', 'replication', 'sharding', 'explain-analyze'],
  quiz: [
    { type: 'scenario', q: 'p95 latency doubled overnight after a bulk import; plans show rows=1 estimates for new date ranges. First action?',
      options: ['Add a read replica', 'ANALYZE the affected tables', 'Partition the table', 'Increase shared_buffers'],
      answer: 1, explain: 'Stale statistics after bulk loads: cheapest, fastest fix.' },
    { type: 'mcq', q: 'Which view shows what a running backend is waiting on right now?',
      options: ['pg_stat_user_tables', 'pg_stat_activity (wait_event_type, wait_event)', 'pg_stats', 'pg_class'],
      answer: 1, explain: 'pg_stat_activity exposes current waits per backend.' },
    { type: 'tf', q: 'Adding read replicas fixes a query whose plan scans 200M rows on every call.',
      answer: false, explain: 'A bad plan is equally bad on a replica; replicas add capacity, they don\'t fix plans.' },
    { type: 'design', q: 'orders (500M rows) is queried mostly by month, and data older than 3 years must be purged monthly. Best structural change?',
      options: ['Sharding by customer', 'Range partitioning by order_date (monthly)', 'Hash index on order_date', 'VACUUM FULL monthly'],
      answer: 1, explain: 'Pruning for monthly queries, and purging becomes DETACH/DROP PARTITION.' },
    { type: 'mcq', q: 'In the 10-step playbook, which comes FIRST?',
      options: ['Partitioning', 'Measuring and scoping with pg_stat_statements and app metrics', 'Sharding', 'Tuning shared_buffers'],
      answer: 1, explain: 'Always measure before changing anything.' }
  ]
},

/* =====================================================================
   MODULE: explain
   ===================================================================== */
{
  id: 'explain-basics',
  module: 'explain',
  title: 'EXPLAIN Basics: Reading cost, rows and width',
  level: 3,
  minutes: 20,
  summary: 'Read an EXPLAIN plan tree confidently: node types, indentation, startup vs total cost, estimated rows and width, and how costs roll up from children to parents.',
  objectives: [
    'Read a plan tree bottom-up and inside-out',
    'Explain startup cost vs total cost and why Sort/Hash nodes have high startup cost',
    'Interpret rows (estimated output rows per execution) and width (average row bytes)',
    'Understand how LIMIT uses startup/total cost to pick plans',
    'Use EXPLAIN variants (COSTS OFF, VERBOSE) to simplify or enrich output'
  ],
  concept: `
<p><strong>Analogy: a factory assembly line drawing.</strong> EXPLAIN shows the planned assembly line: raw materials enter at the bottom (scans), intermediate stations transform them (joins, sorts, aggregates), and the finished product leaves at the top. Each station has an estimated <em>setup time</em> before its first output (startup cost), a <em>total time</em> to produce everything (total cost), an expected number of items (<code>rows</code>) and item size (<code>width</code>).</p>
<p>Anatomy of a line:</p>
<p><code>Seq Scan on orders  (cost=0.00..151.50 rows=9 width=24)<br>  Filter: (customer_id = 42)</code></p>
<ul>
  <li><strong>Node type and target</strong>: <code>Seq Scan on orders</code>.</li>
  <li><strong>cost=startup..total</strong>: estimated cost to return the first row (0.00) and all rows (151.50), in planner units (1.0 &asymp; one sequential page read). Each node's cost <em>includes</em> its children's costs.</li>
  <li><strong>rows</strong>: estimated rows this node outputs <em>per execution</em> (after its filters).</li>
  <li><strong>width</strong>: estimated average output row width in bytes &mdash; drives memory estimates for sorts and hashes.</li>
  <li><strong>Detail lines</strong>: <code>Filter</code>, <code>Index Cond</code>, <code>Hash Cond</code>, <code>Sort Key</code>, <code>Group Key</code>&hellip;</li>
</ul>
<p><strong>Reading order:</strong> the most indented nodes run first (leaves = data sources). Each <code>-&gt;</code> introduces a child. Read <em>inside-out, bottom-up</em>: scans &rarr; joins &rarr; aggregation &rarr; sort &rarr; limit. The top line's total cost is the cost of the whole query.</p>
<p><strong>Startup cost matters for LIMIT:</strong> <code>Sort</code> must read all input before emitting anything, so its startup &asymp; total. An index scan providing the order has startup &asymp; 0, so <code>LIMIT 10</code> can stop early &mdash; the planner prorates the child's cost by the fraction of rows needed.</p>
<p>EXPLAIN without ANALYZE <strong>does not run the query</strong>: it's safe on any statement (even DELETE) and instant. Its numbers are <em>estimates</em>; to see reality, use <code>EXPLAIN ANALYZE</code> (next lesson).</p>`,
  why: `
<p>EXPLAIN is the single most important performance tool in PostgreSQL. Every index decision, query rewrite and statistics fix in this course is verified by reading a plan. Being able to read a plan in seconds &mdash; spotting the seq scan on the big table, the sort that could be avoided, the nested loop with a huge outer estimate &mdash; is a core skill in interviews and incidents alike.</p>`,
  useCase: `
<p><strong>Code review gate:</strong> a fintech team requires an <code>EXPLAIN</code> (and for hot paths <code>EXPLAIN ANALYZE</code> on a production-sized staging DB) attached to every PR that adds or changes a query on tables over 10M rows. Reviewers check the top-level cost, the access path on big tables, and whether a Sort or Hash appears where an index could provide order. This catches most performance regressions before deploy.</p>`,
  internals: `
<p>EXPLAIN runs parse, rewrite and plan, then prints the chosen plan tree instead of executing it. Costs are computed by each path's cost function: for example a Sort's cost includes an <code>n log n</code> comparison term based on input rows and width, and its startup cost equals almost its total because all input must be consumed first. A <code>Limit</code> node's cost is computed as <code>child.startup + (child.total - child.startup) &times; (limit / child.rows)</code> &mdash; that's why <code>Limit (cost=0.28..1.27)</code> sits above <code>Index Scan Backward (cost=0.28..495.28 rows=5000)</code> for LIMIT 10.</p>
<p><code>width</code> comes from column statistics (<code>avg_width</code> in pg_stats) or type lengths. Nodes that output nothing to their parent besides TIDs (Bitmap Index Scan) show <code>width=0</code>.</p>`,
  whenNot: `
<ul>
  <li>Don't treat cost units as milliseconds; they only compare alternative plans for the same query on the same server.</li>
  <li>Don't conclude anything about actual performance from estimates alone when statistics may be stale &mdash; use EXPLAIN ANALYZE.</li>
  <li>For queries using prepared statement parameters, plain EXPLAIN with literals may show a different plan than the application gets (generic plans).</li>
</ul>`,
  syntax: `EXPLAIN statement;
EXPLAIN ( [ ANALYZE ] [ VERBOSE ] [ COSTS { on|off } ] [ SETTINGS ] [ GENERIC_PLAN ]
          [ BUFFERS ] [ SERIALIZE ] [ WAL ] [ TIMING ] [ SUMMARY ] [ MEMORY ]
          [ FORMAT { TEXT | XML | JSON | YAML } ] ) statement;`,
  examples: [
    { label: 'Basic', title: 'Your first plans',
      sql: `EXPLAIN SELECT * FROM customers;

EXPLAIN SELECT * FROM orders ORDER BY total_amount DESC LIMIT 5;`,
      explain: `<p><code>customers</code>: 7 pages &times; 1.0 + 500 rows &times; 0.01 = 12.00. <code>width=67</code> bytes per row on average.</p>
<p>The top-5 query: the <code>Sort</code> has startup 222.05 (it must read all 5,000 rows first) and the <code>Limit</code> inherits that startup; its total 222.06 is barely higher because returning 5 rows from a finished sort is cheap. The planner will use a top-N heapsort at execution time.</p>`,
      output: ` Seq Scan on customers  (cost=0.00..12.00 rows=500 width=67)

 Limit  (cost=222.05..222.06 rows=5 width=36)
   ->  Sort  (cost=222.05..234.55 rows=5000 width=36)
         Sort Key: total_amount DESC
         ->  Seq Scan on orders  (cost=0.00..139.00 rows=5000 width=36)`,
      run: true },
    { label: 'Intermediate', title: 'A join plan, read bottom-up',
      sql: `EXPLAIN
SELECT c.name, o.total_amount
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'Singapore'
ORDER BY o.total_amount DESC
LIMIT 5;

-- Same plan without the numbers: good for comparing shapes
EXPLAIN (COSTS OFF)
SELECT c.name, o.total_amount
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'Singapore';`,
      explain: `<p>Bottom-up: (1) <code>Seq Scan on customers</code> with filter country = Singapore, est. 62 rows; (2) <code>Hash</code> builds a hash table from them; (3) <code>Seq Scan on orders</code> (5,000 rows) probes it in the <code>Hash Join</code>, est. 620 output rows (62 customers &times; ~10 orders); (4) <code>Sort</code> by total_amount; (5) <code>Limit</code> 5.</p>
<p>Note the cost roll-up: Hash Join total 166.26 includes both scans; Sort startup 176.56 includes the whole join. <code>COSTS OFF</code> strips numbers, useful in documentation and tests.</p>`,
      output: ` Limit  (cost=176.56..176.57 rows=5 width=20)
   ->  Sort  (cost=176.56..178.11 rows=620 width=20)
         Sort Key: o.total_amount DESC
         ->  Hash Join  (cost=14.03..166.26 rows=620 width=20)
               Hash Cond: (o.customer_id = c.id)
               ->  Seq Scan on orders o  (cost=0.00..139.00 rows=5000 width=12)
               ->  Hash  (cost=13.25..13.25 rows=62 width=16)
                     ->  Seq Scan on customers c  (cost=0.00..13.25 rows=62 width=16)
                           Filter: (country = 'Singapore'::text)

 Hash Join
   Hash Cond: (o.customer_id = c.id)
   ->  Seq Scan on orders o
   ->  Hash
         ->  Seq Scan on customers c
               Filter: (country = 'Singapore'::text)`,
      run: true },
    { label: 'Advanced', title: 'How LIMIT prorates cost; VERBOSE output columns',
      sql: `CREATE INDEX idx_orders_order_date ON orders (order_date);

-- Index Scan total 495.28 for all 5000 rows, but LIMIT 10 needs only 10/5000 of it
EXPLAIN SELECT id, order_date FROM orders ORDER BY order_date DESC LIMIT 10;

-- VERBOSE: schema-qualified names and the exact output columns per node
EXPLAIN (VERBOSE, COSTS OFF)
SELECT d.name, count(*)
FROM employees e JOIN departments d ON d.id = e.department_id
WHERE e.is_active
GROUP BY d.name;`,
      explain: `<p>Limit cost = 0.28 + (495.28 &minus; 0.28) &times; 10/5000 = <strong>1.27</strong>. That's why an index scan with an expensive total can still win for top-N queries: the planner compares 1.27 to the 247-cost sort plan.</p>
<p><code>VERBOSE</code> shows <code>Output:</code> per node &mdash; here the seq scan on employees outputs all 10 columns although only <code>department_id</code> is needed upstream (scans emit whole tuples cheaply). It also reveals <code>Inner Unique: true</code>: the planner knows each employee matches at most one department (PK), allowing a faster join.</p>`,
      output: ` Limit  (cost=0.28..1.27 rows=10 width=16)
   ->  Index Scan Backward using idx_orders_order_date on orders  (cost=0.28..495.28 rows=5000 width=16)

 HashAggregate
   Output: d.name, count(*)
   Group Key: d.name
   ->  Hash Join
         Output: d.name
         Inner Unique: true
         Hash Cond: (e.department_id = d.id)
         ->  Seq Scan on public.employees e
               Output: e.id, e.first_name, e.last_name, e.email, e.department_id, e.manager_id, e.job_title, e.salary, e.hire_date, e.is_active
               Filter: e.is_active
         ->  Hash
               Output: d.name, d.id
               ->  Seq Scan on public.departments d
                     Output: d.name, d.id`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Reading only the top line and guessing
EXPLAIN SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'paid' AND c.segment = 'enterprise';
-- "cost=170 - looks fine"`,
      why: 'The top-line cost alone says nothing about which table is scanned how, which predicates are filters vs index conditions, or where the estimate might be wrong. You can\'t find the problem node without reading the tree.', run: true },
    good: { sql: `-- Read the tree bottom-up and note each node's rows and filters
EXPLAIN (VERBOSE)
SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'paid' AND c.segment = 'enterprise';
-- leaves: Seq Scan orders (Filter status), Seq Scan customers (Filter segment)
-- join: Hash Join on customer_id; estimated rows per node; output columns per node`,
      why: 'Walking the tree shows both tables are seq scanned with filters, the hash side is customers (smaller), and the per-node row estimates you can later verify with ANALYZE. That is the information you act on.', run: true }
  },
  mistakes: [
    `Reading plans top-down as if the top node runs first; execution starts at the leaves.`,
    `Interpreting cost as milliseconds or comparing costs across different queries or servers.`,
    `Ignoring <code>rows</code> estimates: a nested loop with an outer estimate of 1 is a red flag if the real number could be large.`,
    `Forgetting that <code>rows</code> is per execution (per loop) for inner nodes of nested loops.`,
    `Running <code>EXPLAIN ANALYZE</code> when plain EXPLAIN would do, on statements that modify data or take hours.`
  ],
  best: [
    `Start with plain <code>EXPLAIN</code> to see the shape; add <code>ANALYZE, BUFFERS</code> to see reality.`,
    `Read bottom-up: data sources, filters vs index conditions, join methods, sorts/aggregates, limits.`,
    `Look first at the largest tables' access paths and at nodes with high startup cost under a LIMIT.`,
    `Use <code>COSTS OFF</code> for stable plan-shape comparisons in docs and regression tests.`,
    `Use visualisers (e.g. explain.dalibo.com, explain.depesz.com &mdash; third-party tools) for big plans; paste FORMAT JSON or text.`
  ],
  performance: `
<p>EXPLAIN without ANALYZE costs only planning time (usually sub-millisecond, up to tens of ms for big joins or many partitions). Plan size grows with query complexity; for queries with hundreds of nodes, FORMAT JSON plus a visualiser saves time. Cost estimates are only as good as statistics; treat EXPLAIN as the planner's <em>belief</em>.</p>`,
  security: `
<p>EXPLAIN requires the same privileges as running the query (SELECT on the tables, etc.). Plans reveal table and index names, filter constants and estimated row counts &mdash; minor information disclosure; don't expose raw EXPLAIN output to end users of an application.</p>`,
  scenario: {
    title: 'A PR adds a "top spenders this month" widget',
    steps: [
      '1. Reviewer runs EXPLAIN on the new query against a production-sized staging database.',
      '2. Bottom-up reading: Seq Scan on orders (300M rows, Filter on order_date), HashAggregate by customer, Sort, Limit 10.',
      '3. The Seq Scan with a date filter returning ~3% of rows signals a missing index on order_date.',
      '4. The author adds CREATE INDEX CONCURRENTLY on orders(order_date) INCLUDE (customer_id, total_amount) in the migration.',
      '5. New EXPLAIN: Index Only Scan on the date range feeding the HashAggregate; total cost drops 40x.',
      '6. EXPLAIN ANALYZE on staging confirms 120 ms vs 9 s; PR approved.'
    ]
  },
  widgets: ['lab:plan', 'diagram:query-pipeline'],
  interview: [
    { q: 'What do the two numbers in cost=0.28..8.30 mean?',
      a: 'The first is the estimated startup cost: the work before the node can return its first row. The second is the estimated total cost to return all rows. Both are in planner cost units relative to one sequential page read, and both include the costs of child nodes.' },
    { q: 'Why does a Sort node have a startup cost almost equal to its total cost?',
      a: 'A sort cannot output its first row until it has consumed and sorted all of its input, so nearly all work happens before the first row. That is why plans with an index that already provides the order (startup near zero) win for ORDER BY ... LIMIT queries.' },
    { q: 'In which order do plan nodes execute?',
      a: 'Execution is demand-driven from the top, but data originates at the leaves: the most indented nodes (scans) produce rows first, which flow up through joins, aggregates, sorts and limits. You read a plan bottom-up and inside-out to follow the data.' },
    { q: 'What does the width field represent?',
      a: 'The estimated average size in bytes of the rows output by that node. The planner uses it to estimate memory for sorts and hash tables and the cost of passing tuples between nodes.' }
  ],
  exercises: [
    { task: 'Run EXPLAIN for the total revenue per product category and identify (as a comment) the leaf nodes and the join method.',
      solution: `EXPLAIN
SELECT p.category, sum(oi.quantity * oi.unit_price) AS revenue
FROM order_items oi JOIN products p ON p.id = oi.product_id
GROUP BY p.category;
-- Leaves: Seq Scan on order_items, Seq Scan on products (hashed)
-- Join: Hash Join on product_id, then HashAggregate by category`, run: true },
    { task: 'Compare EXPLAIN of SELECT * FROM orders ORDER BY id LIMIT 5 and ORDER BY total_amount LIMIT 5 and explain the startup cost difference.',
      solution: `EXPLAIN SELECT * FROM orders ORDER BY id LIMIT 5;
EXPLAIN SELECT * FROM orders ORDER BY total_amount LIMIT 5;
-- id: Index Scan on orders_pkey, startup ~0.28 (order provided by the index)
-- total_amount: Sort over a Seq Scan, startup ~222 (must read and sort everything first)`, run: true }
  ],
  challenge: {
    task: 'Verify the Limit cost formula: for EXPLAIN SELECT id FROM orders ORDER BY id LIMIT 50, read the child Index Scan\'s startup/total/rows and compute the Limit\'s total cost yourself in SQL. Then check it against the plan.',
    hint: 'limit_total = startup + (total - startup) * 50 / rows.',
    solution: `EXPLAIN SELECT id FROM orders ORDER BY id LIMIT 50;
-- Plan: Limit (cost=0.28..3.16 rows=50) -> Index Only Scan using orders_pkey (cost=0.28..287.89 rows=5000)
SELECT round(0.28 + (287.89 - 0.28) * 50 / 5000.0, 2) AS predicted_limit_total;`,
    run: true
  },
  related: ['explain-analyze', 'explain-buffers-options', 'query-optimization-planner', 'explain-complex-plans'],
  quiz: [
    { type: 'mcq', q: 'In "Seq Scan on orders (cost=0.00..151.50 rows=9 width=24)", what is rows=9?',
      options: ['Rows scanned', 'Estimated rows output by this node', 'Actual rows returned', 'Pages read'],
      answer: 1, explain: 'Plain EXPLAIN shows estimates of rows emitted after filtering.' },
    { type: 'tf', q: 'EXPLAIN without ANALYZE executes the query to get accurate numbers.',
      answer: false, explain: 'Only EXPLAIN ANALYZE executes the statement.' },
    { type: 'predict', q: 'Child: Index Scan (cost=0.28..495.28 rows=5000). What is the Limit total cost for LIMIT 10?',
      code: `Limit  (cost=0.28..?? rows=10)
  ->  Index Scan Backward using idx_orders_order_date on orders  (cost=0.28..495.28 rows=5000)`,
      options: ['495.28', '1.27', '0.28', '49.53'],
      answer: 1, explain: '0.28 + (495.28 - 0.28) x 10/5000 = 1.27.' },
    { type: 'mcq', q: 'Which node usually has startup cost close to its total cost?',
      options: ['Seq Scan', 'Index Scan', 'Sort', 'Limit over an Index Scan'],
      answer: 2, explain: 'Sort must consume all input before producing output.' },
    { type: 'bug', q: 'A developer claims this plan means the query takes 151 ms. What is wrong?',
      code: `Seq Scan on orders  (cost=0.00..151.50 rows=9 width=24)`,
      options: ['Nothing, cost is in ms', 'Cost is in arbitrary planner units, not time; use EXPLAIN ANALYZE for time', 'It means 151 pages', 'It means 151 rows'],
      answer: 1, explain: 'Costs are relative units; only ANALYZE measures time.' }
  ]
},

{
  id: 'explain-analyze',
  module: 'explain',
  title: 'EXPLAIN ANALYZE: Actual Time, Rows, Loops and Misestimates',
  level: 3,
  minutes: 26,
  summary: 'Run the query and compare reality to the plan: actual time (startup..total, per loop), actual rows (decimals in PG18), loops (multiply!), planning vs execution time, and how to spot and fix misestimates.',
  objectives: [
    'Read actual time=startup..total, rows and loops for every node',
    'Multiply per-loop values by loops to get real totals (and know PG18 shows decimal rows)',
    'Distinguish Planning Time from Execution Time and know what each includes',
    'Find the lowest node where estimated and actual rows diverge and trace the cause',
    'Use TIMING OFF and SUMMARY options to reduce overhead and noise',
    'Know that EXPLAIN ANALYZE executes the statement (side effects!)'
  ],
  concept: `
<p><strong>Analogy: a journey plan vs the GPS trip log.</strong> EXPLAIN is the route planned before leaving ("about 40 minutes, 12 traffic lights"). EXPLAIN ANALYZE is the trip log after arriving: actual minutes per segment, how many times you went round the same roundabout, and where the plan was wrong. Performance work lives in the gap between the two.</p>
<p><code>Seq Scan on orders  (cost=0.00..151.50 rows=9 width=24) (actual time=5.394..10.974 rows=10.00 loops=1)</code></p>
<ul>
  <li><strong>actual time=5.394..10.974</strong> &ndash; milliseconds until this node produced its first row, and until it produced its last row, <em>averaged per loop</em>, including children.</li>
  <li><strong>rows=10.00</strong> &ndash; actual rows output <em>per loop</em> (average). PG18 prints two decimals because averages over loops are often fractional (e.g. <code>rows=2.40 loops=10</code> means 24 rows in total).</li>
  <li><strong>loops=1</strong> &ndash; how many times the node was executed. Inner sides of nested loops, SubPlans and Memoize children often have <code>loops</code> in the hundreds or millions.</li>
  <li><strong>Rows Removed by Filter</strong> &ndash; rows read but discarded (per loop): a big number next to a small output is a classic "needs an index" signal.</li>
  <li><strong>Planning Time</strong> &ndash; parse/rewrite/plan; <strong>Execution Time</strong> &ndash; executor start to finish, including triggers, but <em>not</em> network transfer of results to the client (unless <code>SERIALIZE</code> is used).</li>
</ul>
<div class="callout warn"><strong>Multiply by loops!</strong> A node showing <code>actual time=0.051..0.053 rows=2.40 loops=10</code> cost about 0.053 &times; 10 = 0.53 ms in total and produced 24 rows. A node showing <code>0.790 ms &times; loops=62</code> is 49 ms. Forgetting this is the #1 EXPLAIN ANALYZE reading mistake.</div>
<div class="callout danger"><strong>EXPLAIN ANALYZE executes the statement.</strong> <code>EXPLAIN ANALYZE DELETE ...</code> really deletes. Wrap data-modifying statements in <code>BEGIN; ... ROLLBACK;</code> (next lesson).</div>`,
  why: `
<p>Estimates can be wrong; only actual numbers tell you where time is spent and why the planner chose badly. The most valuable single diagnostic in PostgreSQL is the <strong>estimate-vs-actual row comparison</strong>: when the planner thinks a node produces 24 rows and it produces 63, or 25 vs 2,098, everything above that node is planned on false assumptions (join method, join order, memory). Fixing that one estimate frequently fixes the whole query.</p>`,
  useCase: `
<p><strong>Insurance claims portal:</strong> a dashboard query ran 12 s. EXPLAIN ANALYZE showed a Nested Loop whose outer side was estimated at 3 rows but returned 41,000 (<code>loops=41000</code> on an inner index scan costing 0.25 ms each &rarr; 10.3 s). The outer filter was <code>WHERE extract(year FROM claim_date) = 2025 AND region = 'North'</code>: an expression with no statistics and two correlated predicates. Rewriting to a date range plus <code>CREATE STATISTICS</code> on (region, branch) gave accurate estimates; the planner switched to a hash join: 380 ms.</p>`,
  internals: `
<p>With ANALYZE, the executor wraps each node with instrumentation: it counts rows and loops and reads the clock at node start/stop (via <code>clock_gettime</code>). On systems with slow clock sources this adds overhead proportional to the number of rows passing through nodes, so EXPLAIN ANALYZE can be noticeably slower than the plain query. <code>TIMING OFF</code> keeps row counts and loops but skips per-node timing; <code>pg_test_timing</code> (a server utility) measures clock overhead.</p>
<p>For parallel queries, per-node numbers are averages across workers and the leader (<code>loops</code> = number of processes); <code>VERBOSE</code> shows per-worker detail. Actual rows for nodes that stopped early (under a Limit) are lower than estimates by design &mdash; that's not a misestimate.</p>
<p>Execution Time includes AFTER trigger execution (listed as <code>Trigger ...: time=... calls=...</code>), e.g. foreign-key checks &mdash; a common hidden cost of DELETEs on parent tables.</p>`,
  whenNot: `
<ul>
  <li>Never on a long-running production query you can't afford to run (EXPLAIN ANALYZE takes at least as long as the query). Use plain EXPLAIN, a smaller parameter range, or <code>auto_explain</code> logs from the real run.</li>
  <li>Never on data-modifying statements outside a transaction you roll back &mdash; and remember side effects that rollback can't undo (sequences advance, external calls from functions, notifications).</li>
  <li>Don't benchmark with a single EXPLAIN ANALYZE run: the first run often includes cold-cache I/O and hint-bit writes (<code>dirtied</code>). Repeat and compare.</li>
</ul>`,
  syntax: `EXPLAIN ANALYZE statement;
EXPLAIN (ANALYZE, BUFFERS) statement;                 -- BUFFERS is on by default with ANALYZE in PG18
EXPLAIN (ANALYZE, TIMING OFF) statement;              -- rows/loops only, less overhead
EXPLAIN (ANALYZE, SUMMARY OFF) statement;             -- omit planning/execution time lines

BEGIN;
EXPLAIN (ANALYZE) UPDATE ... ;                         -- really executes!
ROLLBACK;`,
  examples: [
    { label: 'Basic', title: 'Reading actual time, rows and Rows Removed by Filter',
      sql: `EXPLAIN ANALYZE
SELECT id, order_date, total_amount FROM orders WHERE customer_id = 42;`,
      explain: `<p><strong>Estimate vs actual:</strong> 9 rows estimated, 10.00 actual &mdash; excellent. <strong>Rows Removed by Filter: 4990</strong> &mdash; 99.8% of rows read were thrown away: the clearest possible hint that an index on <code>customer_id</code> would help. <code>Buffers: shared hit=89</code>: all pages came from shared buffers (no disk read).</p>
<p>The startup time (5.394 ms) here is time to find the first matching row (it was ~ 1/2 way through the table); total 10.974 ms to finish scanning. Execution Time adds executor startup/shutdown.</p>`,
      output: ` Seq Scan on orders  (cost=0.00..151.50 rows=9 width=24) (actual time=5.394..10.974 rows=10.00 loops=1)
   Filter: (customer_id = 42)
   Rows Removed by Filter: 4990
   Buffers: shared hit=89
 Planning:
   Buffers: shared hit=38
 Planning Time: 0.668 ms
 Execution Time: 11.290 ms`,
      run: true },
    { label: 'Intermediate', title: 'Loops: multiply per-loop numbers',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;

EXPLAIN ANALYZE
SELECT c.name, o.id, o.total_amount
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE c.id BETWEEN 1 AND 5;`,
      explain: `<p>The outer Index Scan runs once and returns 5 customers. The inner Bitmap Heap Scan runs <strong>loops=5</strong> (once per customer) and shows <code>rows=10.00</code> <em>per loop</em> &rarr; 50 rows in total, matching the Nested Loop's 50. Its <code>actual time=0.103..0.123</code> is per loop &rarr; ~0.6 ms total. Buffers are already totals across loops (53 shared hits, 43 heap blocks).</p>
<p>Rule: <strong>time and rows are per loop; buffers and Heap Blocks are totals.</strong></p>`,
      output: ` Nested Loop  (cost=3.83..151.32 rows=50 width=28) (actual time=1.000..1.363 rows=50.00 loops=1)
   Buffers: shared hit=56
   ->  Index Scan using customers_pkey on customers c  (cost=0.27..8.37 rows=5 width=16) (actual time=0.110..0.119 rows=5.00 loops=1)
         Index Cond: ((id >= 1) AND (id <= 5))
         Index Searches: 1
         Buffers: shared hit=3
   ->  Bitmap Heap Scan on orders o  (cost=3.56..28.49 rows=10 width=20) (actual time=0.103..0.123 rows=10.00 loops=5)
         Recheck Cond: (c.id = customer_id)
         Heap Blocks: exact=43
         Buffers: shared hit=53
         ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..3.56 rows=10 width=0) (actual time=0.038..0.038 rows=10.00 loops=5)
               Index Cond: (customer_id = c.id)
               Index Searches: 5
               Buffers: shared hit=10
 Planning Time: 2.089 ms
 Execution Time: 1.633 ms`,
      run: true },
    { label: 'Advanced', title: 'Spotting misestimates: function predicates and correlated columns',
      sql: `-- (1) Expression without statistics: estimate is a fixed guess
EXPLAIN ANALYZE SELECT id FROM orders WHERE date_part('year', order_date) = 2025;

-- (2) Correlated columns multiplied as if independent
EXPLAIN ANALYZE SELECT id FROM customers WHERE country = 'India' AND city = 'Mumbai';

-- (3) The N+1-style SubPlan: 62 loops of a full scan
EXPLAIN ANALYZE
SELECT c.id, (SELECT count(*) FROM orders o WHERE o.customer_id = c.id) AS n
FROM customers c WHERE c.country = 'UAE';`,
      explain: `<p><strong>(1)</strong> estimated 25, actual 2,098 (84x). Fix: sargable range, or statistics on the expression.</p>
<p><strong>(2)</strong> estimated 24, actual 63 (2.6x). Fix: <code>CREATE STATISTICS ... ON country, city</code>.</p>
<p><strong>(3)</strong> the SubPlan's inner Seq Scan shows <code>actual time=0.118..0.732 rows=9.68 loops=62</code>: 62 &times; 0.73 &asymp; 45 ms of the 53 ms total, and 62 &times; 9.68 &asymp; 600 rows counted. This is where to act (index on orders.customer_id or a set-based rewrite).</p>
<p>How to hunt: scan the plan for the <em>deepest</em> node where estimate and actual differ by more than ~10x; errors there propagate upward.</p>`,
      output: ` Seq Scan on orders  (cost=0.00..164.00 rows=25 width=8) (actual time=1.260..6.653 rows=2098.00 loops=1)
   Filter: (date_part('year'::text, order_date) = '2025'::double precision)
   Rows Removed by Filter: 2902
 Execution Time: 8.178 ms

 Seq Scan on customers  (cost=0.00..14.50 rows=24 width=4) (actual time=0.294..5.009 rows=63.00 loops=1)
   Filter: ((country = 'India'::text) AND (city = 'Mumbai'::text))
   Rows Removed by Filter: 437
 Execution Time: 5.477 ms

 Seq Scan on customers c  (cost=0.00..9408.42 rows=62 width=12) (actual time=5.591..53.074 rows=62.00 loops=1)
   Filter: (country = 'UAE'::text)
   Rows Removed by Filter: 438
   SubPlan 1
     ->  Aggregate  (cost=151.53..151.53 rows=1 width=8) (actual time=0.790..0.791 rows=1.00 loops=62)
           ->  Seq Scan on orders o  (cost=0.00..151.50 rows=10 width=0) (actual time=0.118..0.732 rows=9.68 loops=62)
                 Filter: (customer_id = c.id)
                 Rows Removed by Filter: 4990
 Execution Time: 53.197 ms`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Running EXPLAIN ANALYZE on a DELETE "just to see the plan"
-- (this really deletes 75 audit rows - in the sandbox the item is rolled back for you)
EXPLAIN ANALYZE DELETE FROM audit_logs WHERE operation = 'DELETE';
SELECT count(*) AS remaining_delete_rows FROM audit_logs WHERE operation = 'DELETE';`,
      why: 'EXPLAIN ANALYZE executes the statement. On a real server without a surrounding transaction those rows are gone, triggers fired and WAL was written. The follow-up count returns 0.', run: true },
    good: { sql: `BEGIN;
EXPLAIN ANALYZE DELETE FROM audit_logs WHERE operation = 'DELETE';
ROLLBACK;
SELECT count(*) AS remaining_delete_rows FROM audit_logs WHERE operation = 'DELETE';`,
      why: 'Wrapping the statement in a transaction and rolling back gives you real execution numbers while leaving the data untouched (75 rows remain). Beware non-transactional side effects (sequences, external calls).', run: true }
  },
  mistakes: [
    `Reading per-loop times and rows as totals: a 0.5 ms node with <code>loops=200000</code> costs 100 seconds.`,
    `Running <code>EXPLAIN ANALYZE</code> on INSERT/UPDATE/DELETE without <code>BEGIN ... ROLLBACK</code>.`,
    `Treating a lower actual row count under a <code>Limit</code> as a misestimate; the node simply stopped early.`,
    `Judging from a single cold run; caches, hint-bit writes and JIT compilation skew the first execution.`,
    `Ignoring <code>Planning Time</code>; for queries over many partitions or joins it can exceed execution time.`,
    `Forgetting that Execution Time excludes sending rows to the client: a fast plan returning 2 million rows can still be a slow API call (use <code>SERIALIZE</code> to measure output cost).`
  ],
  best: [
    `Always compare estimated vs actual rows node by node; fix the deepest large misestimate first.`,
    `Multiply per-loop time by loops to find the true hot spot; use buffers (totals) as a stable cost signal.`,
    `Run it two or three times and use the warm result unless you are specifically studying cold-cache behaviour.`,
    `Use <code>TIMING OFF</code> on very large row counts to reduce instrumentation overhead when you mainly need row counts.`,
    `For production-only problems, capture plans with the <code>auto_explain</code> module instead of re-running heavy queries manually.`
  ],
  performance: `
<p>Instrumentation overhead depends on rows flowing through nodes and the clock source: small for typical OLTP queries, but EXPLAIN ANALYZE of a query processing 100M rows can be 20&ndash;60% slower than the query itself. <code>TIMING OFF</code> removes most overhead while keeping counts. The plan you get is the plan for <em>this</em> execution; with prepared statements the application may run a generic plan instead.</p>`,
  security: `
<p>EXPLAIN ANALYZE needs the privileges required to run the statement and actually performs it, including firing triggers and writing audit rows. Never allow user-controlled SQL to be wrapped in EXPLAIN ANALYZE by tools without the same access checks. Output can include constant values from the query (personal data) &mdash; take care when pasting plans into public plan visualisers; anonymise first.</p>`,
  scenario: {
    title: 'A 40-second report: finding the real hot node',
    steps: [
      '1. Run EXPLAIN (ANALYZE, BUFFERS) on a staging copy (or with a narrower date range in production).',
      '2. The top node says 40,012 ms. Walk down: Hash Join 1,200 ms, but a Nested Loop below shows inner Index Scan actual time 0.37 ms loops=105,000.',
      '3. Multiply: 0.37 x 105,000 = 38.9 s. That is the hot spot.',
      '4. Compare estimates: the outer side was estimated at 120 rows, actual 105,000 - an 875x misestimate on a filter with two correlated columns.',
      '5. CREATE STATISTICS (dependencies, mcv) on those columns; ANALYZE.',
      '6. Re-run: planner now chooses a Hash Join; total 1.9 s. Record before/after plans in the ticket.'
    ]
  },
  widgets: ['lab:plan'],
  interview: [
    { q: 'What do actual time, rows and loops mean in EXPLAIN ANALYZE output?',
      a: 'actual time is the time in milliseconds to return the first row and all rows of the node, averaged per execution (loop) and including children. rows is the average number of rows output per loop (shown with decimals in PG18). loops is how many times the node was executed. Multiply time and rows by loops for totals; buffer counts are already totals.' },
    { q: 'How do you use EXPLAIN ANALYZE to find the cause of a bad plan?',
      a: 'Find the deepest node where estimated rows differ greatly from actual rows, because every decision above it (join type, order, memory) is based on that wrong number. Then determine why: stale stats, correlated columns, expressions without statistics, skewed data, or parameter values, and fix the estimate with ANALYZE, extended statistics, query rewrites or expression indexes.' },
    { q: 'Is it safe to run EXPLAIN ANALYZE on an UPDATE?',
      a: 'Only inside a transaction that you roll back, because EXPLAIN ANALYZE actually executes the statement, firing triggers and modifying rows. Even then, non-transactional side effects (sequence increments, external effects of functions) are not undone, and the statement takes the same locks as normal.' },
    { q: 'What is the difference between Planning Time and Execution Time?',
      a: 'Planning Time covers parsing, rewriting and planning the statement. Execution Time covers running the plan, including trigger execution, but excludes the time to send results to the client unless SERIALIZE is requested. Large planning times point to many joins or partitions; large execution times to the plan itself.' }
  ],
  exercises: [
    { task: 'Run EXPLAIN ANALYZE for orders of customers in Germany joined to customers, and write as a comment the estimated vs actual rows of the customers scan.',
      solution: `EXPLAIN ANALYZE
SELECT o.id, o.total_amount
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE c.country = 'Germany';
-- customers scan: estimated 62 rows, actual 62 rows (country stats are accurate)`, run: true },
    { task: 'Safely measure an UPDATE that raises all audio product prices by 5%, leaving data unchanged.',
      solution: `BEGIN;
EXPLAIN (ANALYZE, BUFFERS)
UPDATE products SET price = price * 1.05 WHERE category = 'audio';
ROLLBACK;
SELECT count(*) FROM products WHERE category = 'audio';`, run: true },
    { task: 'Compare EXPLAIN ANALYZE with and without TIMING OFF for a join of order_items and orders.',
      solution: `EXPLAIN (ANALYZE, TIMING OFF)
SELECT count(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id;
EXPLAIN (ANALYZE)
SELECT count(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id;`, run: true }
  ],
  challenge: {
    task: 'Create a misestimate on purpose and fix it: query employees WHERE salary * 12 > 1500000 (an expression), compare estimated and actual rows, then rewrite the predicate to be sargable and compare again.',
    hint: 'Move the arithmetic to the constant side: salary > 1500000 / 12.',
    solution: `EXPLAIN ANALYZE SELECT id FROM employees WHERE salary * 12 > 1500000;
EXPLAIN ANALYZE SELECT id FROM employees WHERE salary > 1500000 / 12.0;
-- The expression gets a default 33% inequality guess; the rewrite uses the salary histogram.`,
    run: true
  },
  related: ['explain-basics', 'explain-buffers-options', 'advanced-indexing-statistics', 'query-analysis-diagnosis-checklist'],
  quiz: [
    { type: 'predict', q: 'Total time spent in this node?',
      code: `->  Index Scan using idx_x on t (actual time=0.020..0.050 rows=3.00 loops=40000)`,
      options: ['0.05 ms', '2 ms', '2000 ms (0.05 x 40000)', '120000 ms'],
      answer: 2, explain: 'Per-loop time x loops = 0.05 ms x 40,000 = 2,000 ms.' },
    { type: 'mcq', q: 'In PG18, why does EXPLAIN ANALYZE show rows=2.40?',
      options: ['It is an estimate', 'Rows are averaged per loop and shown with decimals', 'Rows are sampled', 'It is a percentage'],
      answer: 1, explain: 'PG18 prints actual rows as per-loop averages with two decimals.' },
    { type: 'tf', q: 'EXPLAIN ANALYZE DELETE ... deletes the rows.',
      answer: true, explain: 'It executes the statement; wrap it in BEGIN/ROLLBACK.' },
    { type: 'scenario', q: 'A node shows rows=1 estimated and rows=48000.00 actual, feeding a Nested Loop. What is the most likely consequence?',
      options: ['Nothing; estimates do not matter', 'The planner chose a nested loop expecting 1 outer row; it ran the inner side 48,000 times', 'The query returns wrong results', 'Parallelism is disabled'],
      answer: 1, explain: 'Underestimated outer sides make nested loops catastrophically slow.' },
    { type: 'mcq', q: 'Which value in EXPLAIN ANALYZE is already a total across loops?',
      options: ['actual time', 'rows', 'Buffers', 'Rows Removed by Filter'],
      answer: 2, explain: 'Buffer counts (and Heap Blocks) are totals; times and rows are per loop.' }
  ]
},

{
  id: 'explain-buffers-options',
  module: 'explain',
  title: 'EXPLAIN Options: BUFFERS, VERBOSE, SETTINGS, WAL, SERIALIZE and FORMAT JSON',
  level: 4,
  minutes: 24,
  summary: 'Go beyond time: shared hit/read/dirtied/written buffers, temp and WAL usage, settings that influenced the plan, output columns, serialization cost and machine-readable JSON plans, plus safe EXPLAIN ANALYZE of DML.',
  objectives: [
    'Interpret Buffers: shared hit, read, dirtied, written and temp read/written',
    'Explain why buffers are a more stable metric than timing',
    'Use WAL to measure write amplification of DML (records, fpi, bytes)',
    'Use SETTINGS and VERBOSE to make plans reproducible and explicit',
    'Use FORMAT JSON for tooling and SERIALIZE / MEMORY for output and planner memory',
    'Run EXPLAIN ANALYZE on DML safely inside BEGIN/ROLLBACK'
  ],
  concept: `
<p><strong>Analogy: a delivery driver's log.</strong> Time alone ("the route took 40 minutes") depends on traffic. A better log records <em>what was done</em>: parcels picked from the local depot (<strong>shared hit</strong> &ndash; page found in shared_buffers), parcels fetched from the central warehouse (<strong>shared read</strong> &ndash; page read from the OS cache or disk), parcels that were repacked (<strong>dirtied</strong> &ndash; page modified in memory), and parcels the driver had to ship back himself because the depot was full (<strong>written</strong> &ndash; a backend had to write a dirty page out). Buffers measure <em>work</em>, which is far more stable across runs than milliseconds.</p>
<table>
<tr><th>Counter</th><th>Meaning</th><th>Look out for</th></tr>
<tr><td><code>shared hit</code></td><td>8 kB pages found in shared_buffers</td><td>large numbers = lots of work even if fast</td></tr>
<tr><td><code>shared read</code></td><td>pages read from OS/disk into shared_buffers</td><td>cold cache, working set &gt; RAM</td></tr>
<tr><td><code>shared dirtied</code></td><td>pages this query modified (incl. hint bits on first read after writes)</td><td>reads that dirty pages: first scan after bulk load</td></tr>
<tr><td><code>shared written</code></td><td>dirty pages the backend itself had to evict/write</td><td>shared_buffers too small or bgwriter lagging</td></tr>
<tr><td><code>temp read/written</code></td><td>temp file blocks for sorts/hashes beyond work_mem</td><td>spills: raise work_mem for that query</td></tr>
<tr><td><code>local</code></td><td>temporary tables' buffers</td><td>large temp table usage</td></tr>
</table>
<p>In <strong>PostgreSQL 18</strong>, <code>BUFFERS</code> is included automatically with <code>ANALYZE</code>; before PG18 you had to write <code>EXPLAIN (ANALYZE, BUFFERS)</code>. Other options:</p>
<ul>
  <li><code>VERBOSE</code> &ndash; output column lists, schema-qualified names, per-worker stats, query identifier when computed.</li>
  <li><code>SETTINGS</code> &ndash; lists non-default planner-relevant settings (work_mem, random_page_cost, enable_*...).</li>
  <li><code>WAL</code> &ndash; WAL records, full-page images (<code>fpi</code>) and bytes generated (with ANALYZE).</li>
  <li><code>SERIALIZE</code> (PG17+) &ndash; also converts output rows to wire format and reports time/size: reveals the cost of large or de-TOASTed results.</li>
  <li><code>MEMORY</code> (PG17+) &ndash; planner memory usage.</li>
  <li><code>GENERIC_PLAN</code> (PG16+) &ndash; plan a query containing <code>$1</code> placeholders without values.</li>
  <li><code>FORMAT JSON|YAML|XML</code> &ndash; machine-readable plans for visualisers and automated regression checks.</li>
</ul>`,
  why: `
<p>Timing varies with cache state, concurrent load and hardware; buffer counts tell you how much work the plan inherently does. A query that "takes 2 ms" but touches 50,000 buffers will collapse under concurrency or a cold cache; a query touching 8 buffers won't. WAL numbers expose the true cost of writes (indexes, full-page images), and SETTINGS/VERBOSE make plans reproducible when you share them with colleagues or attach them to tickets.</p>`,
  useCase: `
<p><strong>Capacity planning at a ticketing company:</strong> before a big concert sale, the team ranked the 20 hottest queries by <code>shared hit + read</code> buffers per call (from EXPLAIN and pg_stat_statements). One "seat availability" query touched 4,800 buffers per call &mdash; fine at 50 calls/s, fatal at the expected 3,000 calls/s (14M buffer accesses/s, CPU-bound on buffer locking). A covering index cut it to 9 buffers per call; the sale ran without incident. Timing on an idle staging DB had looked "fine" (3 ms) all along.</p>`,
  internals: `
<p>Buffer counters come from the same instrumentation as <code>pg_stat_statements</code>' <code>shared_blks_hit/read/dirtied/written</code>. A "read" means PostgreSQL asked the kernel for the page &mdash; it may still come from the OS page cache, so reads are not necessarily physical disk I/O; enable <code>track_io_timing</code> to see <code>I/O Timings: shared read=...</code> per node. <strong>Hint bits:</strong> the first read of rows after they were written (and committed) sets visibility hint bits on the tuples, marking pages dirty &mdash; that's why our first scans of company_db tables show <code>dirtied=89</code> and later scans don't.</p>
<p><strong>WAL:</strong> <code>records</code> = WAL records, <code>fpi</code> = full-page images (the first modification of a page after each checkpoint writes the whole 8 kB page when <code>full_page_writes = on</code>), <code>bytes</code> = total WAL volume. Many FPIs relative to records means frequent checkpoints or writes scattered over many pages.</p>
<p><strong>EXPLAIN ANALYZE on DML</strong> executes the statement, including index updates and triggers, and the plan's top node shows <code>rows=0</code> (DML returns no rows to EXPLAIN) unless RETURNING is used.</p>`,
  whenNot: `
<ul>
  <li>Don't compare buffer counts between servers with different <code>shared_buffers</code> sizes for "hit vs read" &mdash; compare totals (hit + read).</li>
  <li><code>WAL</code> requires ANALYZE; without it the option has nothing to measure.</li>
  <li><code>SERIALIZE</code> adds the cost of output conversion; don't use it when you only care about the server-side plan.</li>
</ul>`,
  syntax: `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, WAL, SERIALIZE, MEMORY, FORMAT JSON) statement;
EXPLAIN (ANALYZE, BUFFERS OFF) statement;         -- PG18: opt out of default buffers
EXPLAIN (GENERIC_PLAN) SELECT ... WHERE id = $1;  -- PG16+, no ANALYZE
SET track_io_timing = on;                          -- adds "I/O Timings" lines (superuser)

BEGIN;
EXPLAIN (ANALYZE, WAL) DELETE FROM t WHERE ...;
ROLLBACK;`,
  examples: [
    { label: 'Basic', title: 'Buffers: first run dirties pages (hint bits), second run does not',
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM orders WHERE status = 'paid';
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM orders WHERE status = 'paid';`,
      explain: `<p>Both runs touch all 89 pages (<code>shared hit=89</code>) &mdash; the work is identical. The first run also shows <code>dirtied=89</code>: the rows were written by the seed script and this is the first scan to check their commit status, so PostgreSQL set hint bits and marked the pages dirty (they'll be written back later). The first run is also slower (30 ms vs 4.5 ms) partly because of this and cold planning (<code>Planning: Buffers: shared hit=33 read=2</code>, catalog lookups).</p>
<p>Lesson: compare <em>warm</em> runs, and use buffer counts to judge plan efficiency independent of timing noise.</p>`,
      output: `-- first run
 Aggregate  (cost=153.52..153.53 rows=1 width=8) (actual time=29.691..29.694 rows=1.00 loops=1)
   Buffers: shared hit=89 dirtied=89
   ->  Seq Scan on orders  (cost=0.00..151.50 rows=808 width=0) (actual time=1.519..28.475 rows=808.00 loops=1)
         Filter: (status = 'paid'::text)
         Rows Removed by Filter: 4192
         Buffers: shared hit=89 dirtied=89
 Planning:
   Buffers: shared hit=33 read=2 dirtied=2
 Planning Time: 25.334 ms
 Execution Time: 30.236 ms

-- second run
 Aggregate  (cost=153.52..153.53 rows=1 width=8) (actual time=4.445..4.448 rows=1.00 loops=1)
   Buffers: shared hit=89
   ->  Seq Scan on orders  (cost=0.00..151.50 rows=808 width=0) (actual time=2.203..3.873 rows=808.00 loops=1)
         Filter: (status = 'paid'::text)
         Rows Removed by Filter: 4192
         Buffers: shared hit=89
 Planning Time: 0.165 ms
 Execution Time: 4.488 ms`,
      run: true },
    { label: 'Intermediate', title: 'Safe EXPLAIN ANALYZE of a DELETE with WAL statistics',
      sql: `BEGIN;
EXPLAIN (ANALYZE, BUFFERS, WAL)
DELETE FROM audit_logs WHERE operation = 'DELETE';
ROLLBACK;

-- Data is intact
SELECT count(*) AS delete_rows_still_there FROM audit_logs WHERE operation = 'DELETE';`,
      explain: `<p>The DELETE really ran: 75 rows were found by the Seq Scan and deleted, producing <code>WAL: records=80 fpi=5 bytes=39415</code> &mdash; one record per deleted tuple plus a few more, and 5 full-page images (the first change to each of the 5 pages after the last checkpoint costs a full 8 kB page in WAL). That's why FPIs dominate the bytes: 35 kB of 39 kB.</p>
<p><code>ROLLBACK</code> undid the deletion; the count is still 75. The <code>Delete</code> node reports <code>rows=0</code> because DML without RETURNING outputs no rows.</p>`,
      output: `BEGIN
 Delete on audit_logs  (cost=0.00..8.75 rows=0 width=0) (actual time=15.946..15.949 rows=0.00 loops=1)
   Buffers: shared hit=80 dirtied=5
   WAL: records=80 fpi=5 bytes=39415
   ->  Seq Scan on audit_logs  (cost=0.00..8.75 rows=75 width=6) (actual time=0.226..0.452 rows=75.00 loops=1)
         Filter: (operation = 'DELETE'::text)
         Rows Removed by Filter: 225
         Buffers: shared hit=5 dirtied=5
         WAL: records=5 fpi=5 bytes=35365
 Planning Time: 0.804 ms
 Execution Time: 16.723 ms
ROLLBACK

 delete_rows_still_there
-------------------------
                      75`,
      run: true },
    { label: 'Advanced', title: 'SETTINGS, VERBOSE, SERIALIZE and FORMAT JSON',
      sql: `SET work_mem = '16MB';
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, SUMMARY OFF)
SELECT count(*) FROM orders WHERE customer_id = 42;
RESET work_mem;

-- How expensive is producing and serialising the output itself? (PG17+)
EXPLAIN (ANALYZE, SERIALIZE) SELECT * FROM documents;

-- Machine-readable plan for tools and automated checks
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT count(*) FROM customers WHERE country = 'UK';`,
      explain: `<p><code>SETTINGS</code> lists every non-default planner-relevant setting: our <code>work_mem = '16MB'</code> plus sandbox defaults (no parallel workers). Paste this with a plan and others can reproduce it. <code>SUMMARY OFF</code> drops timing lines.</p>
<p><code>SERIALIZE</code> adds a line with time and bytes needed to convert result rows to the text wire format &mdash; 10 kB for 24 documents with long bodies. For APIs returning big JSON/text columns this can dominate.</p>
<p>JSON output exposes every metric as a key (<code>"Actual Rows"</code>, <code>"Shared Hit Blocks"</code>, <code>"Plan Rows"</code>...), which plan visualisers and CI regression checks consume. (Abbreviated below.)</p>`,
      output: ` Aggregate  (cost=151.52..151.53 rows=1 width=8) (actual time=28.013..28.015 rows=1.00 loops=1)
   Buffers: shared hit=89
   ->  Seq Scan on orders  (cost=0.00..151.50 rows=9 width=0) (actual time=0.182..27.992 rows=10.00 loops=1)
         Filter: (customer_id = 42)
         Rows Removed by Filter: 4990
         Buffers: shared hit=89
 Settings: search_path = 'public', max_parallel_workers = '0', max_parallel_workers_per_gather = '0', work_mem = '16MB'

 Seq Scan on documents  (cost=0.00..2.24 rows=24 width=426) (actual time=0.030..0.064 rows=24.00 loops=1)
 Planning Time: 1.132 ms
 Serialization: time=0.707 ms  output=10kB  format=text
 Execution Time: 0.949 ms

[
  {
    "Plan": {
      "Node Type": "Aggregate",
      "Strategy": "Plain",
      "Startup Cost": 13.41,
      "Total Cost": 13.42,
      "Plan Rows": 1,
      "Actual Rows": 1,
      "Actual Loops": 1,
      "Shared Hit Blocks": 7,
      "Plans": [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "customers",
          "Plan Rows": 63,
          "Actual Rows": 63,
          "Filter": "(country = 'UK'::text)",
          "Rows Removed by Filter": 437,
          "Shared Hit Blocks": 7
        }
      ]
    },
    "Planning Time": 0.361,
    "Triggers": [],
    "Execution Time": 0.37
  }
]`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Judging a query only by its execution time on a warm, idle system
EXPLAIN (ANALYZE, BUFFERS OFF, SUMMARY ON)
SELECT id, order_date FROM orders ORDER BY id LIMIT 20 OFFSET 4900;
-- "14 ms, fine!"`,
      why: 'Without buffers you miss that this plan touches ~9,900 buffer pages to return 20 rows. It looks fast on an idle machine, but under 500 concurrent users that is 5 million page accesses per second of pure overhead.', run: true },
    good: { sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, order_date FROM orders ORDER BY id LIMIT 20 OFFSET 4900;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, order_date FROM orders WHERE id > 4900 ORDER BY id LIMIT 20;`,
      why: 'Buffers reveal the real work: OFFSET reads ~9,900 pages, keyset pagination 45. Optimise the buffer count and the timing follows, regardless of cache state or load.', run: true }
  },
  mistakes: [
    `Ignoring buffers and optimising only for milliseconds measured on an idle, warm staging server.`,
    `Reading <code>shared read</code> as "disk reads": they may be OS page-cache hits; enable <code>track_io_timing</code> for real I/O time.`,
    `Running <code>EXPLAIN (ANALYZE, WAL)</code> on DML without <code>BEGIN ... ROLLBACK</code>.`,
    `Sharing plans without <code>SETTINGS</code> and then being unable to reproduce them on another machine.`,
    `Forgetting that before PG18 <code>BUFFERS</code> must be requested explicitly; old blog posts omit it.`
  ],
  best: [
    `Default to <code>EXPLAIN (ANALYZE, BUFFERS, SETTINGS)</code> (plus <code>VERBOSE</code> for column-level detail).`,
    `Use <code>WAL</code> when tuning write paths (index count, fillfactor, batch sizes, checkpoints).`,
    `Turn on <code>track_io_timing</code> (low overhead on modern systems) to see I/O time per node.`,
    `Store <code>FORMAT JSON</code> plans for critical queries in CI and alert when the plan shape or buffer count regresses.`,
    `Use <code>SERIALIZE</code> when an endpoint is slow but the plan is fast &mdash; the cost may be in output (large text/JSON, TOAST).`
  ],
  performance: `
<p>Rough conversion for intuition: a shared hit costs well under a microsecond of CPU; a read served from the OS page cache a few microseconds; a read from NVMe 50&ndash;150 &micro;s; from network storage 0.5&ndash;2 ms. So 10,000 buffers can be 5 ms when cached and 2+ seconds when cold on network storage &mdash; the buffer count tells you which risk you carry. WAL bytes translate into replication bandwidth and archive storage: a DML that writes 1 MB of WAL per row-batch on a 2,000-batch/s workload means 2 GB/s of WAL.</p>`,
  security: `
<p><code>VERBOSE</code> and <code>FORMAT JSON</code> output contain schema names, column lists and literal values used in the query. Treat saved plans like logs: they can contain personal data and should follow the same retention and access rules. <code>track_io_timing</code> and <code>SET</code> of some parameters require superuser or specific privileges.</p>`,
  scenario: {
    title: 'An API endpoint is slow only during peak hours',
    steps: [
      '1. In isolation, EXPLAIN ANALYZE shows 3 ms, so the team suspects the network.',
      '2. EXPLAIN (ANALYZE, BUFFERS) shows shared hit=18,400 for 25 rows returned: the plan does lots of work that is hidden by a warm cache.',
      '3. At peak, pg_stat_activity shows many backends waiting on LWLock:BufferMapping / buffer content locks: buffer contention from this query.',
      '4. A covering index (customer_id, created_at DESC) INCLUDE (status, total) reduces it to 7 buffers per call.',
      '5. Peak p95 drops from 900 ms to 12 ms; CPU usage on the primary falls 35%.',
      '6. Add the query\'s FORMAT JSON plan to the CI plan-regression suite with a threshold on Shared Hit Blocks.'
    ]
  },
  widgets: ['lab:plan', 'diagram:memory'],
  interview: [
    { q: 'What is the difference between shared hit, read, dirtied and written in EXPLAIN BUFFERS?',
      a: 'hit: the page was found in shared_buffers. read: it had to be requested from the operating system (page cache or disk). dirtied: the query modified the page in memory (including setting hint bits). written: the backend itself had to write a dirty page out to make room, which indicates pressure on shared_buffers or a lagging background writer.' },
    { q: 'Why can a plain SELECT show dirtied buffers?',
      a: 'The first time committed rows are read, PostgreSQL sets hint bits on the tuples (caching the commit status from pg_xact) and marks the page dirty so the bits are eventually written. That is typical right after bulk loads and explains why a first scan can generate writes and be slower.' },
    { q: 'How do you safely use EXPLAIN ANALYZE on an UPDATE or DELETE?',
      a: 'Wrap it in BEGIN; EXPLAIN (ANALYZE, BUFFERS, WAL) ...; ROLLBACK;. The statement executes fully (including triggers and index maintenance) so the numbers are real, and the rollback undoes the data changes. Be aware it still takes locks for the duration and cannot undo non-transactional side effects.' },
    { q: 'What does the WAL option show and why is fpi important?',
      a: 'With ANALYZE, it reports the number of WAL records, full-page images and bytes generated by each node. Full-page images are written on the first modification of each page after a checkpoint and are often most of the WAL volume; many FPIs point to frequent checkpoints or writes spread over many pages.' }
  ],
  exercises: [
    { task: 'Measure WAL generated by inserting 1,000 audit log rows, without keeping them.',
      solution: `BEGIN;
EXPLAIN (ANALYZE, WAL)
INSERT INTO audit_logs (table_name, operation, row_id, new_data, changed_by)
SELECT 'orders', 'UPDATE', g, jsonb_build_object('n', g), 'bench'
FROM generate_series(1, 1000) g;
ROLLBACK;`, run: true },
    { task: 'Show which non-default settings affect a plan after setting random_page_cost = 1.1 and enable_nestloop = off.',
      solution: `SET random_page_cost = 1.1;
SET enable_nestloop = off;
EXPLAIN (SETTINGS)
SELECT c.name, count(*) FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name;
RESET random_page_cost;
RESET enable_nestloop;`, run: true }
  ],
  challenge: {
    task: 'Quantify index write amplification with WAL: in one transaction (rolled back), measure WAL for updating total_amount of 500 orders with only the PK index, then create three extra indexes on orders (including one on total_amount) and measure the same update again.',
    hint: 'BEGIN; EXPLAIN (ANALYZE, WAL) UPDATE ...; CREATE INDEX ...; EXPLAIN (ANALYZE, WAL) UPDATE ...; ROLLBACK;',
    solution: `BEGIN;
EXPLAIN (ANALYZE, WAL)
UPDATE orders SET total_amount = total_amount + 1 WHERE id <= 500;
CREATE INDEX tmp_orders_total ON orders (total_amount);
CREATE INDEX tmp_orders_cust ON orders (customer_id);
CREATE INDEX tmp_orders_date ON orders (order_date);
EXPLAIN (ANALYZE, WAL)
UPDATE orders SET total_amount = total_amount + 1 WHERE id <= 500;
ROLLBACK;`,
    run: true
  },
  related: ['explain-analyze', 'explain-complex-plans', 'advanced-indexing-maintenance', 'wal', 'query-analysis-benchmarking'],
  quiz: [
    { type: 'mcq', q: 'In PG18, which option is enabled automatically with EXPLAIN ANALYZE?',
      options: ['VERBOSE', 'BUFFERS', 'WAL', 'SETTINGS'],
      answer: 1, explain: 'PG18 includes buffer usage by default with ANALYZE.' },
    { type: 'predict', q: 'What does this line indicate?',
      code: `Buffers: shared hit=120, temp read=2048 written=2048`,
      options: ['A cold cache', 'A sort or hash spilled to temporary files', 'WAL generation', 'Index bloat'],
      answer: 1, explain: 'temp read/written blocks come from work_mem spills.' },
    { type: 'tf', q: 'shared read always means a physical disk read.',
      answer: false, explain: 'It means the page was requested from the OS; it may be in the OS page cache.' },
    { type: 'bug', q: 'What is wrong with this "harmless" check?',
      code: `EXPLAIN (ANALYZE, WAL) DELETE FROM payments WHERE status = 'failed';`,
      options: ['WAL requires VERBOSE', 'It deletes the rows; it must be wrapped in BEGIN ... ROLLBACK', 'DELETE cannot be explained', 'BUFFERS is missing'],
      answer: 1, explain: 'EXPLAIN ANALYZE executes the DELETE.' },
    { type: 'mcq', q: 'Which option reveals the cost of converting large result rows to the client format?',
      options: ['MEMORY', 'SERIALIZE', 'SUMMARY', 'COSTS'],
      answer: 1, explain: 'SERIALIZE (PG17+) reports serialization time and output size.' }
  ]
},

{
  id: 'explain-complex-plans',
  module: 'explain',
  title: 'Reading Complex Plans: CTEs, SubPlans, InitPlans, Memoize, Incremental Sort',
  level: 4,
  minutes: 30,
  summary: 'Dissect a full multi-level plan: CTE Scan vs inlined CTEs, correlated SubPlans vs once-only InitPlans, Memoize caches, Incremental Sort and Result nodes, with a fully annotated real example.',
  objectives: [
    'Read nested plan trees with several branches and attach each node to a part of the SQL',
    'Distinguish CTE Scan (MATERIALIZED) from inlined CTEs (PG12+ default)',
    'Distinguish SubPlan (per outer row) from InitPlan (once per query) and compute their real cost',
    'Read Memoize and Incremental Sort nodes and their statistics',
    'Walk through a full annotated plan and identify the hot spot'
  ],
  concept: `
<p><strong>Analogy: a company org chart for a project.</strong> The top node is the project lead who delivers the final result; under them are teams (child nodes); some specialists are consulted once at the start (<strong>InitPlan</strong>), others are called for every single item (<strong>SubPlan</strong>); some teams prepare a shared resource used by others (<strong>CTE</strong>); some keep a notebook of answers already looked up (<strong>Memoize</strong>).</p>
<ul>
  <li><strong>CTE Scan</strong> &ndash; a <code>WITH</code> query that was <em>materialized</em>: computed once into a tuplestore, then scanned. Since PG12, a non-recursive CTE referenced once and without side effects is <em>inlined</em> into the main query (no CTE Scan node, predicates can be pushed down). Force the old behaviour with <code>AS MATERIALIZED</code>, or force inlining with <code>NOT MATERIALIZED</code>.</li>
  <li><strong>SubPlan</strong> &ndash; a subquery that depends on the outer row (correlated), executed per outer row (<code>loops=N</code>), or a "hashed SubPlan" for <code>IN</code>/<code>NOT IN</code> lists built once.</li>
  <li><strong>InitPlan</strong> &ndash; an uncorrelated scalar subquery (e.g. <code>(SELECT avg(total_amount) FROM orders)</code>) executed once before it's needed, result reused. Also used for <code>max()/min()</code> optimisations (Limit 1 over an index).</li>
  <li><strong>Memoize</strong> &ndash; cache in front of a parameterised inner side of a nested loop.</li>
  <li><strong>Incremental Sort</strong> (PG13+) &ndash; input is already sorted by a prefix of the required keys (<code>Presorted Key</code>), so only groups with equal prefix values are sorted &mdash; can start emitting rows immediately.</li>
  <li><strong>Result</strong> &ndash; computes expressions (e.g. calling a SubPlan for a SELECT-list column) or a constant; <strong>Append</strong> &ndash; UNION ALL / partitions.</li>
</ul>
<p><strong>How to read big plans:</strong> (1) identify the top-level shape (Limit &rarr; Sort &rarr; Join...); (2) locate side branches labelled <code>CTE name</code>, <code>InitPlan n</code>, <code>SubPlan n</code>; (3) for each node compute total time = per-loop time &times; loops; (4) find where time and buffers concentrate; (5) check estimate vs actual there.</p>`,
  why: `
<p>Real application queries are rarely one join: reports use CTEs, scalar subqueries in SELECT lists, LATERAL joins, window functions and partitions. Their plans run to 30&ndash;100 lines. Without a method for reading branches and loops you'll stare at the top-line time and guess. With it, you can point at the one line that costs 90% of the time within a minute.</p>`,
  useCase: `
<p><strong>BI dashboard at a retail chain:</strong> a "top customers" CTE query took 25 s. The plan showed a <code>CTE Scan</code> on a materialized CTE that aggregated all orders (40M rows) before a filter on <code>region</code> was applied outside it &mdash; written in PG11 days when CTEs were always materialized "optimisation fences". After upgrading to PG16 the CTE was inlined automatically (single reference), the region filter was pushed into the scan, and the query ran in 1.4 s without code changes. A second query intentionally kept <code>AS MATERIALIZED</code> because its CTE was referenced three times.</p>`,
  internals: `
<p><strong>CTE materialization rules (PG12+):</strong> inlined when the CTE is non-recursive, side-effect free (no data-modifying statements, no volatile functions) and referenced exactly once &mdash; unless <code>MATERIALIZED</code> is specified. Materialized CTEs show <code>Storage: Memory Maximum Storage: 24kB</code> in PG18 (spilling to disk if large).</p>
<p><strong>SubPlan vs InitPlan:</strong> the planner turns uncorrelated scalar subqueries into InitPlans (run once; referenced as <code>$n</code> or <code>(InitPlan n).col1</code>). Correlated subqueries become SubPlans re-executed per outer row &mdash; unless the planner can "pull up" them into joins (EXISTS/IN can; scalar subqueries in the SELECT list generally can't). <code>max(col)</code> on an indexed column is rewritten as <code>(SELECT col FROM t WHERE col IS NOT NULL ORDER BY col DESC LIMIT 1)</code>, shown as an InitPlan with a Limit over an Index (Only) Scan.</p>
<p><strong>Memoize</strong> has <code>Cache Key</code>, <code>Cache Mode</code> (logical or binary), and Hits/Misses/Evictions/Overflows; it's sized by <code>work_mem &times; hash_mem_multiplier</code>. The planner uses <code>n_distinct</code> of the key to predict the hit ratio.</p>
<p><strong>Incremental Sort</strong> reports <code>Full-sort Groups</code> and <code>Pre-sorted Groups</code> with memory usage; it's chosen when an index provides a prefix of the ORDER BY, especially with LIMIT.</p>`,
  whenNot: `
<ul>
  <li>Don't add <code>MATERIALIZED</code> by habit; it blocks predicate push-down. Use it deliberately when a CTE is expensive and referenced multiple times, or to prevent a volatile function from being evaluated repeatedly.</li>
  <li>Don't rely on correlated scalar subqueries over large outer sets without an index for the inner lookup; rewrite as JOIN/LATERAL/GROUP BY.</li>
  <li>Disabling <code>enable_memoize</code> or <code>enable_incremental_sort</code> is only for diagnosis.</li>
</ul>`,
  syntax: `WITH name AS [ [ NOT ] MATERIALIZED ] ( query ) SELECT ...;
SELECT ..., (SELECT ... WHERE inner.col = outer.col) AS correlated_value FROM outer_table;   -- SubPlan
SELECT ..., (SELECT avg(x) FROM t) AS constant_value FROM ...;                                 -- InitPlan
SET enable_memoize = on|off;  SET enable_incremental_sort = on|off;                            -- diagnostics`,
  examples: [
    { label: 'Basic', title: 'Inlined CTE vs MATERIALIZED CTE',
      sql: `-- PG12+: single-reference CTE is inlined; the customer filter reaches the scan
EXPLAIN
WITH x AS (SELECT * FROM orders WHERE status = 'paid')
SELECT * FROM x WHERE customer_id = 42;

-- Forced materialization: whole CTE computed first, then filtered
EXPLAIN
WITH x AS MATERIALIZED (SELECT * FROM orders WHERE status = 'paid')
SELECT * FROM x WHERE customer_id = 42;`,
      explain: `<p><strong>Inlined:</strong> one Seq Scan with both predicates combined, estimated 1 row, cost 164.</p>
<p><strong>Materialized:</strong> a <code>CTE x</code> branch computes all 808 paid orders into a tuplestore; then <code>CTE Scan on x</code> filters customer 42. The filter can't be pushed into the CTE. On a large table with an index on customer_id, the inlined version could use the index; the materialized one must aggregate everything first.</p>`,
      output: ` Seq Scan on orders  (cost=0.00..164.00 rows=1 width=36)
   Filter: ((status = 'paid'::text) AND (customer_id = 42))

 CTE Scan on x  (cost=151.50..169.68 rows=1 width=68)
   Filter: (customer_id = 42)
   CTE x
     ->  Seq Scan on orders  (cost=0.00..151.50 rows=808 width=36)
           Filter: (status = 'paid'::text)`,
      run: true },
    { label: 'Intermediate', title: 'Incremental Sort and Memoize',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;

-- Index provides customer_id order; only order_date within each customer needs sorting
EXPLAIN ANALYZE
SELECT id, customer_id, order_date FROM orders
ORDER BY customer_id, order_date DESC
LIMIT 20;

-- Memoize appears when a nested loop probes repeated keys (forced here for the demo)
SET enable_hashjoin = off;
SET enable_mergejoin = off;
EXPLAIN ANALYZE
SELECT c.country, sum(o.total_amount)
FROM orders o JOIN customers c ON c.id = o.customer_id
GROUP BY c.country;
RESET enable_hashjoin;
RESET enable_mergejoin;`,
      explain: `<p><strong>Incremental Sort:</strong> <code>Presorted Key: customer_id</code> &mdash; the index scan delivers rows in customer order; only rows with the same customer are sorted by date. Because of LIMIT 20 it stops after reading 26 index entries: 25 buffers, 0.4 ms, instead of sorting 5,000 rows.</p>
<p><strong>Memoize:</strong> 5,000 probes with 500 distinct keys: <code>Hits: 4500 Misses: 500</code>. The inner Index Scan shows <code>loops=500</code>, not 5,000 &mdash; the cache absorbed 90% of the lookups.</p>`,
      output: ` Limit  (cost=1.37..3.84 rows=20 width=20) (actual time=0.374..0.404 rows=20.00 loops=1)
   Buffers: shared hit=23 read=2
   ->  Incremental Sort  (cost=1.37..618.82 rows=5000 width=20) (actual time=0.334..0.345 rows=20.00 loops=1)
         Sort Key: customer_id, order_date DESC
         Presorted Key: customer_id
         Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 18kB  Peak Memory: 18kB
         ->  Index Scan using idx_orders_customer_id on orders  (cost=0.28..463.28 rows=5000 width=20) (actual time=0.039..0.087 rows=26.00 loops=1)
               Index Searches: 1
 Execution Time: 0.443 ms

 HashAggregate  (cost=438.49..438.56 rows=6 width=37) (actual time=355.988..356.003 rows=6.00 loops=1)
   Group Key: c.country
   ->  Nested Loop  (cost=0.28..413.49 rows=5000 width=13) (actual time=2.859..137.212 rows=5000.00 loops=1)
         ->  Seq Scan on orders o  (cost=0.00..139.00 rows=5000 width=12) (actual time=1.747..22.265 rows=5000.00 loops=1)
         ->  Memoize  (cost=0.28..0.31 rows=1 width=9) (actual time=0.013..0.013 rows=1.00 loops=5000)
               Cache Key: o.customer_id
               Cache Mode: logical
               Hits: 4500  Misses: 500  Evictions: 0  Overflows: 0  Memory Usage: 41kB
               ->  Index Scan using customers_pkey on customers c  (cost=0.27..0.30 rows=1 width=9) (actual time=0.072..0.072 rows=1.00 loops=500)
                     Index Cond: (id = o.customer_id)`,
      run: true },
    { label: 'Advanced', title: 'Full annotated plan: CTE + InitPlan + SubPlan + Sort + Limit',
      sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;

EXPLAIN ANALYZE
WITH big_spenders AS MATERIALIZED (
  SELECT customer_id, sum(total_amount) AS spent
  FROM orders
  WHERE status <> 'cancelled'
  GROUP BY customer_id
  HAVING sum(total_amount) > 2500000
)
SELECT c.name, c.country, b.spent,
       (SELECT max(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order,  -- correlated
       (SELECT avg(total_amount) FROM orders)                              AS global_avg   -- uncorrelated
FROM big_spenders b
JOIN customers c ON c.id = b.customer_id
ORDER BY b.spent DESC
LIMIT 5;`,
      explain: `<p>Annotated walk-through (numbers from the output):</p>
<ol>
<li><strong>CTE big_spenders</strong> (runs once): Seq Scan on orders (4,572 non-cancelled rows) &rarr; HashAggregate by customer with <code>Filter: sum(...) &gt; 2500000</code>, keeping 187 of 500 customers (<code>Rows Removed by Filter: 313</code>). ~64 ms, 89 buffers.</li>
<li><strong>InitPlan 3</strong> = <code>global_avg</code>: uncorrelated, executed <em>once</em> (<code>loops=1</code>), 17 ms.</li>
<li><strong>Main branch</strong>: <code>CTE Scan on big_spenders</code> (187 rows, materialized in 24 kB of memory) is hashed and joined to customers (Hash Join, 187 rows), then <code>Sort</code> with <code>top-N heapsort</code> keeps the top 5.</li>
<li><strong>Result + SubPlan 2</strong> = <code>last_order</code>: correlated, executed once per <em>output</em> row: <code>loops=5</code> (not 187!) because the Result node sits above Sort/Limit-input &mdash; the planner evaluates the SELECT-list subquery only for the 5 surviving rows. Each loop: a Bitmap Index Scan on idx_orders_customer_id (~0.57 ms) &rarr; ~2.9 ms total.</li>
<li><strong>Limit</strong> returns 5 rows; total 95.6 ms. Hot spots: the CTE aggregation (64 ms) and the InitPlan (17 ms) &mdash; both full scans of orders. An index-only path or a pre-aggregated table would be the next optimisation.</li>
</ol>`,
      output: ` Limit  (cost=357.12..529.50 rows=5 width=89) (actual time=93.835..94.198 rows=5.00 loops=1)
   Buffers: shared hit=257 read=5
   CTE big_spenders
     ->  HashAggregate  (cost=174.36..181.86 rows=167 width=36) (actual time=63.641..64.021 rows=187.00 loops=1)
           Group Key: orders.customer_id
           Filter: (sum(orders.total_amount) > '2500000'::numeric)
           Batches: 1  Memory Usage: 173kB
           Rows Removed by Filter: 313
           Buffers: shared hit=89
           ->  Seq Scan on orders  (cost=0.00..151.50 rows=4572 width=12) (actual time=1.888..36.938 rows=4572.00 loops=1)
                 Filter: (status <> 'cancelled'::text)
                 Rows Removed by Filter: 428
   InitPlan 3
     ->  Aggregate  (cost=151.50..151.51 rows=1 width=32) (actual time=17.040..17.044 rows=1.00 loops=1)
           ->  Seq Scan on orders orders_1  (cost=0.00..139.00 rows=5000 width=8) (actual time=0.135..1.949 rows=5000.00 loops=1)
   ->  Result  (cost=23.75..5781.32 rows=167 width=89) (actual time=93.634..93.988 rows=5.00 loops=1)
         ->  Sort  (cost=23.75..24.16 rows=167 width=85) (actual time=90.418..90.428 rows=5.00 loops=1)
               Sort Key: b.spent DESC
               Sort Method: top-N heapsort  Memory: 17kB
               ->  Hash Join  (cost=5.43..20.97 rows=167 width=85) (actual time=82.480..90.180 rows=187.00 loops=1)
                     Hash Cond: (c.id = b.customer_id)
                     ->  Seq Scan on customers c  (cost=0.00..12.00 rows=500 width=21) (actual time=0.335..7.628 rows=500.00 loops=1)
                     ->  Hash  (cost=3.34..3.34 rows=167 width=36) (actual time=64.895..64.897 rows=187.00 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 12kB
                           ->  CTE Scan on big_spenders b  (cost=0.00..3.34 rows=167 width=36) (actual time=64.164..64.761 rows=187.00 loops=1)
                                 Storage: Memory  Maximum Storage: 24kB
         SubPlan 2
           ->  Aggregate  (cost=34.45..34.46 rows=1 width=8) (actual time=0.570..0.571 rows=1.00 loops=5)
                 ->  Bitmap Heap Scan on orders o  (cost=4.36..34.43 rows=10 width=8) (actual time=0.496..0.528 rows=15.80 loops=5)
                       Recheck Cond: (customer_id = c.id)
                       Heap Blocks: exact=67
                       ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..4.36 rows=10 width=0) (actual time=0.418..0.418 rows=15.80 loops=5)
                             Index Cond: (customer_id = c.id)
                             Index Searches: 5
 Planning Time: 16.604 ms
 Execution Time: 95.606 ms`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Old habit from PG11: MATERIALIZED CTE as an "optimization fence"
EXPLAIN ANALYZE
WITH recent AS MATERIALIZED (
  SELECT * FROM orders WHERE order_date >= '2024-01-01'
)
SELECT count(*) FROM recent WHERE customer_id = 42;`,
      why: 'The CTE materializes every order since 2024 (all 5,000 rows here) before the customer filter is applied; no index on customer_id could ever be used through the fence. Cost grows with table size.', run: true },
    good: { sql: `CREATE INDEX idx_orders_customer_id ON orders (customer_id);
ANALYZE orders;
EXPLAIN ANALYZE
WITH recent AS (
  SELECT * FROM orders WHERE order_date >= '2024-01-01'
)
SELECT count(*) FROM recent WHERE customer_id = 42;`,
      why: 'Without MATERIALIZED, the single-reference CTE is inlined, both predicates reach the scan, and the customer_id index is used: a handful of buffers instead of the whole table.', run: true }
  },
  mistakes: [
    `Reading <code>SubPlan</code> time without multiplying by <code>loops</code>, or confusing it with <code>InitPlan</code> (runs once).`,
    `Keeping <code>AS MATERIALIZED</code> on CTEs written for PG11 and earlier, blocking predicate push-down after upgrades &mdash; or removing it where the CTE is referenced several times and recomputation is costly.`,
    `Writing correlated scalar subqueries in the SELECT list of large result sets without an index for the inner lookup.`,
    `Assuming a SubPlan runs once per input row of the join; it runs once per row reaching its Result/projection node (often after LIMIT).`,
    `Overlooking <code>Storage: Disk</code> on CTE scans or <code>Overflows/Evictions</code> on Memoize, both signs of insufficient work_mem.`
  ],
  best: [
    `Label each plan branch with the SQL fragment it implements before analysing numbers.`,
    `Use <code>MATERIALIZED</code> only for multi-reference expensive CTEs or to isolate volatile functions; otherwise let PostgreSQL inline.`,
    `Convert per-row SubPlans into joins, LATERAL or window functions when the outer set is large.`,
    `Use indexes that supply a prefix of ORDER BY to enable Incremental Sort for top-N queries.`,
    `For plans over ~50 lines, use FORMAT JSON with a visualiser (third-party tools such as explain.dalibo.com) to collapse branches and rank nodes by exclusive time.`
  ],
  performance: `
<p>Cost of special nodes: InitPlan = once; SubPlan = per-loop cost &times; loops (hashed SubPlans build a hash once); CTE Scan = cost of the CTE once + cheap scans of the tuplestore (with memory or disk); Memoize = probe cost &times; misses + tiny cost &times; hits; Incremental Sort = sorting only small groups, ideal under LIMIT. The <em>exclusive</em> time of a node = its total &minus; children's totals (adjusted for loops); visualisers compute this for you.</p>`,
  security: `
<p>Materialized CTEs and SubPlans execute with the privileges of the calling user and are subject to row-level security like any query. Data-modifying CTEs (<code>WITH d AS (DELETE ... RETURNING ...)</code>) always execute fully, even if the outer query doesn't read their result &mdash; and EXPLAIN ANALYZE of such a statement modifies data; use BEGIN/ROLLBACK.</p>`,
  scenario: {
    title: 'A 70-line plan for a slow dashboard query',
    steps: [
      '1. Save the plan as FORMAT JSON with ANALYZE, BUFFERS and load it into a visualiser; also keep the text version.',
      '2. Map branches to SQL: CTE monthly_totals, InitPlan for the company-wide average, SubPlan for last_login per user, main Hash Join pipeline.',
      '3. Rank nodes by exclusive time: SubPlan 4 has 0.9 ms x loops=12,000 = 10.8 s of the 11.5 s total.',
      '4. Rewrite the scalar subquery as LEFT JOIN LATERAL (SELECT ... ORDER BY login_at DESC LIMIT 1) with an index on (user_id, login_at DESC).',
      '5. New plan: Nested Loop Left Join with an Index Only Scan inner side, 0.02 ms x 12,000 = 240 ms; total 0.9 s.',
      '6. Remove an obsolete AS MATERIALIZED on monthly_totals (referenced once) so the date filter is pushed down; total 0.4 s.'
    ]
  },
  widgets: ['lab:plan', 'diagram:query-pipeline'],
  interview: [
    { q: 'What is the difference between an InitPlan and a SubPlan?',
      a: 'An InitPlan is an uncorrelated subquery executed once per query execution (or once per parameter change) whose result is reused, such as SELECT avg(x) FROM t. A SubPlan is a correlated subquery re-executed for each row that needs it, so its total cost is its per-loop cost times loops. Hashed SubPlans build a hash table once for IN/NOT IN lists.' },
    { q: 'When are CTEs materialized in PostgreSQL 12 and later?',
      a: 'A non-recursive, side-effect-free CTE referenced exactly once is inlined into the outer query by default, allowing predicate push-down. It is materialized if it is referenced more than once, is recursive, contains data-modifying statements or volatile functions, or is declared AS MATERIALIZED. NOT MATERIALIZED forces inlining when possible.' },
    { q: 'What does Incremental Sort do and when is it chosen?',
      a: 'When the input is already sorted by a prefix of the requested sort keys, Incremental Sort sorts only within groups of equal prefix values. It can start returning rows before reading all input, so it shines with LIMIT and indexes that provide the leading ORDER BY columns.' },
    { q: 'How do you find the hot spot in a large EXPLAIN ANALYZE plan?',
      a: 'Compute each node\'s total contribution as per-loop time multiplied by loops, subtract children to get exclusive time (or use a visualiser), and check buffers. Then look at estimate-vs-actual rows at and below the hot node to understand why the planner chose that strategy.' }
  ],
  exercises: [
    { task: 'Write a query that shows each department\'s name and the company-wide average salary (uncorrelated scalar subquery) and check that it appears as an InitPlan executed once.',
      solution: `EXPLAIN ANALYZE
SELECT d.name,
       (SELECT round(avg(salary), 2) FROM employees) AS company_avg_salary
FROM departments d;`, run: true },
    { task: 'Rewrite a correlated "employee count per department" SubPlan as a join with GROUP BY, and compare both plans.',
      solution: `EXPLAIN ANALYZE
SELECT d.name, (SELECT count(*) FROM employees e WHERE e.department_id = d.id) AS headcount
FROM departments d;
EXPLAIN ANALYZE
SELECT d.name, count(e.id) AS headcount
FROM departments d LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.id, d.name;`, run: true }
  ],
  challenge: {
    task: 'Build a query that produces a Memoize node WITHOUT disabling any planner setting: join order_items to products for orders 1-2000 using a nested loop over many repeated product ids, then check Hits/Misses. If the planner prefers a hash join, explain in a comment why.',
    hint: 'Many order_items rows share few product ids (100 products). The planner decides based on estimated distinct keys and costs; on tiny tables a Hash Join is often cheaper.',
    solution: `EXPLAIN ANALYZE
SELECT oi.order_id, p.name
FROM order_items oi
JOIN products p ON p.id = oi.product_id
WHERE oi.order_id BETWEEN 1 AND 2000;
-- With only 100 products (4 pages), hashing products once is cheaper than 5,000 memoized
-- index probes, so the planner usually picks a Hash Join here. On a large products table
-- that does not fit in a hash table cheaply, the same query shape shows Memoize.`,
    run: true
  },
  related: ['explain-analyze', 'ctes', 'subqueries', 'query-optimization-rewriting', 'query-optimization-joins'],
  quiz: [
    { type: 'predict', q: 'How many times does the subquery for global_avg run?',
      code: `SELECT c.name, (SELECT avg(total_amount) FROM orders) AS global_avg FROM customers c;`,
      options: ['500 times (once per customer)', 'Once (InitPlan)', 'Zero (constant folded)', 'Twice'],
      answer: 1, explain: 'Uncorrelated scalar subqueries become InitPlans executed once.' },
    { type: 'mcq', q: 'A CTE is referenced once, has no side effects, and is not marked MATERIALIZED. In PG12+ it is...',
      options: ['Always materialized', 'Inlined into the main query', 'Executed twice', 'Converted into a temp table'],
      answer: 1, explain: 'Single-reference side-effect-free CTEs are inlined.' },
    { type: 'tf', q: 'A SubPlan line showing actual time=0.5 ms and loops=1000 contributed about 500 ms.',
      answer: true, explain: 'Per-loop time x loops.' },
    { type: 'mcq', q: 'What does "Presorted Key: customer_id" in an Incremental Sort node tell you?',
      options: ['customer_id has a unique index', 'The input already arrives ordered by customer_id; only the remaining keys are sorted per group', 'The sort spilled to disk', 'customer_id is the partition key'],
      answer: 1, explain: 'The prefix ordering comes from the child (often an index).' },
    { type: 'optimize', q: 'A dashboard query uses WITH t AS MATERIALIZED (SELECT * FROM events) SELECT ... FROM t WHERE tenant_id = 7. Best change?',
      code: `WITH t AS MATERIALIZED (SELECT * FROM events)
SELECT count(*) FROM t WHERE tenant_id = 7;`,
      options: ['Increase work_mem', 'Remove MATERIALIZED (or move the filter inside the CTE) so tenant_id can be pushed down to an index', 'Add DISTINCT', 'Use a recursive CTE'],
      answer: 1, explain: 'The fence prevents push-down; inlining enables index use.' }
  ]
},

/* =====================================================================
   MODULE: query-analysis
   ===================================================================== */
{
  id: 'query-analysis-finding-slow-queries',
  module: 'query-analysis',
  title: 'Finding Slow Queries: pg_stat_statements, Slow-Query Logging and auto_explain',
  level: 4,
  minutes: 26,
  summary: 'Find the queries that actually matter in production: aggregate statistics with the pg_stat_statements extension, threshold and sampled logging with log_min_duration_statement, automatic plans with auto_explain, and live inspection with pg_stat_activity.',
  objectives: [
    'Install and query pg_stat_statements (extension; needs shared_preload_libraries)',
    'Rank queries by total time, mean time, calls, I/O and temp usage, and explain why total time matters most',
    'Configure log_min_duration_statement and sampled logging without flooding logs',
    'Configure auto_explain to log plans of slow queries automatically',
    'Spot currently long-running queries and idle-in-transaction sessions in pg_stat_activity'
  ],
  concept: `
<p><strong>Analogy: a hospital's triage system.</strong> You don't examine every patient in the city; you look at who is in the emergency room (<em>pg_stat_activity</em>: what's running now), at the admission statistics (<em>pg_stat_statements</em>: which conditions consume the most bed-days overall), and at detailed case notes for the serious cases (<em>slow-query log + auto_explain</em>: full text and plan of each slow execution).</p>
<p><strong>pg_stat_statements</strong> <span class="tag ext">extension</span> (shipped in contrib) normalises queries (constants replaced by <code>$1, $2</code>) and accumulates per query shape: <code>calls</code>, <code>total_exec_time</code>, <code>mean_exec_time</code>, <code>min/max/stddev</code>, <code>rows</code>, <code>shared_blks_hit/read/dirtied/written</code>, <code>temp_blks_*</code>, <code>wal_bytes</code>, planning times (if <code>pg_stat_statements.track_planning</code>), and more. It requires <code>shared_preload_libraries = 'pg_stat_statements'</code> and a server restart, then <code>CREATE EXTENSION pg_stat_statements</code> in the database. <em>It is not available in this browser sandbox, so its examples are shown but not runnable.</em></p>
<p><strong>Total time beats mean time.</strong> A 2-second report run 5 times a day (10 s/day) matters far less than a 4 ms lookup run 3 million times a day (3.3 hours/day of database time). Sort by <code>total_exec_time</code> first, then look at mean/max for user-facing latency.</p>
<p><strong>Logging</strong> (<span class="tag core">core</span>): <code>log_min_duration_statement = '250ms'</code> logs every statement slower than the threshold with its duration and text. PG13+ adds sampling: <code>log_min_duration_sample</code> + <code>log_statement_sample_rate</code> log a fraction of moderately slow statements. <code>log_lock_waits = on</code> logs waits longer than <code>deadlock_timeout</code>; <code>log_temp_files = 0</code> logs every temp file (spills).</p>
<p><strong>auto_explain</strong> (contrib module, loaded via <code>shared_preload_libraries</code>, <code>session_preload_libraries</code> or <code>LOAD 'auto_explain'</code>) logs the execution plan of statements exceeding <code>auto_explain.log_min_duration</code>, optionally with ANALYZE/BUFFERS &mdash; the only way to see the plan a production query <em>actually</em> used with its real parameters.</p>`,
  why: `
<p>Optimising the wrong query is the most common waste of tuning effort. Production workloads have thousands of query shapes; usually 5&ndash;10 of them account for 80% of database time. Without aggregate statistics you optimise what someone complained about last; with them you optimise what costs the most. Plans captured at the moment of slowness (auto_explain) remove the "it's fast when I run it" problem caused by different parameters, caches or generic plans.</p>`,
  useCase: `
<p><strong>SaaS platform weekly performance review:</strong> every Monday the team runs a saved query on pg_stat_statements (top 15 by total time, top 15 by mean time with calls &gt; 100, top 10 by temp blocks), compares with last week's snapshot, and opens tickets for regressions. auto_explain with <code>log_min_duration = 2s</code> and <code>log_analyze = on, log_timing = off, log_buffers = on</code> attaches real plans to the slow-query tickets. After six months, total database CPU dropped 45% while traffic grew 30%.</p>`,
  internals: `
<p>pg_stat_statements hooks into the executor; it identifies statements by <code>queryid</code>, a hash of the post-parse-analysis tree computed when <code>compute_query_id</code> is <code>auto</code>/<code>on</code> (PG14+), so <code>WHERE id = 1</code> and <code>WHERE id = 2</code> share an entry. Entries live in shared memory (<code>pg_stat_statements.max</code>, default 5,000; least-used entries are evicted) and query texts in a file. Reset with <code>pg_stat_statements_reset()</code>. Since PG17, <code>stats_since</code> and <code>minmax_stats_since</code> show when counters started.</p>
<p><strong>Overheads:</strong> pg_stat_statements is cheap (a few percent at most) and should be on everywhere. <code>log_min_duration_statement</code> costs only for logged statements. auto_explain with <code>log_analyze = on</code> instruments <em>every</em> statement (to have numbers ready if it turns out slow), which adds overhead &mdash; use <code>auto_explain.log_timing = off</code> and/or <code>auto_explain.sample_rate</code> on busy systems.</p>
<p><strong>pg_stat_activity</strong> shows one row per backend: <code>state</code> (active, idle, idle in transaction&hellip;), <code>query_start</code>, <code>xact_start</code>, <code>wait_event_type/wait_event</code>, <code>backend_xmin</code>, and the current/last query text (truncated at <code>track_activity_query_size</code>).</p>`,
  whenNot: `
<ul>
  <li>Don't set <code>log_statement = 'all'</code> in production to "find slow queries": it logs every statement regardless of duration, floods disks and hurts performance. Use duration thresholds and sampling.</li>
  <li>Don't set <code>log_min_duration_statement = 0</code> permanently on busy systems; use it briefly for workload capture (e.g. for pgBadger, a third-party log analyser) with enough disk and log rotation.</li>
  <li>Don't enable <code>auto_explain.log_analyze</code> with timing on a high-throughput OLTP primary without sampling.</li>
</ul>`,
  syntax: `-- postgresql.conf (restart required for shared_preload_libraries)
shared_preload_libraries = 'pg_stat_statements,auto_explain'
pg_stat_statements.track = top            -- or all (nested statements in functions)
log_min_duration_statement = '250ms'
log_min_duration_sample = '50ms'          -- PG13+
log_statement_sample_rate = 0.1
log_lock_waits = on
log_temp_files = 0
auto_explain.log_min_duration = '2s'
auto_explain.log_analyze = on
auto_explain.log_buffers = on
auto_explain.log_timing = off

-- per database
CREATE EXTENSION pg_stat_statements;`,
  examples: [
    { label: 'Basic', title: 'Inspect and set slow-query logging parameters',
      sql: `-- What is configured right now?
SELECT name, setting, unit, context
FROM pg_settings
WHERE name IN ('log_min_duration_statement', 'log_min_duration_sample',
               'log_statement_sample_rate', 'log_statement', 'log_lock_waits',
               'track_io_timing', 'compute_query_id', 'shared_preload_libraries',
               'deadlock_timeout')
ORDER BY name;

-- Session-level for a debugging session (superuser or granted role)
SET log_min_duration_statement = '250ms';
SHOW log_min_duration_statement;`,
      explain: `<p><code>context</code> tells you how a parameter can be changed: <code>superuser</code> = per session by a superuser (or via <code>ALTER ROLE/DATABASE ... SET</code>), <code>postmaster</code> = only at server start (that's why <code>shared_preload_libraries</code> needs a restart), <code>sighup</code> = config file + reload. In the sandbox, <code>shared_preload_libraries</code> is empty: pg_stat_statements and auto_explain can't be loaded here.</p>
<p>Setting <code>log_min_duration_statement</code> for one session is a safe way to capture slow statements from a specific job; for the whole server use <code>ALTER SYSTEM</code> or the config file and <code>SELECT pg_reload_conf()</code>.</p>`,
      output: ` name                       | setting | unit | context
----------------------------+---------+------+------------
 compute_query_id           | auto    |      | superuser
 deadlock_timeout           | 1000    | ms   | superuser
 log_lock_waits             | off     |      | superuser
 log_min_duration_sample    | -1      | ms   | superuser
 log_min_duration_statement | -1      | ms   | superuser
 log_statement              | none    |      | superuser
 log_statement_sample_rate  | 1       |      | superuser
 shared_preload_libraries   |         |      | postmaster
 track_io_timing            | off     |      | superuser

SET
 log_min_duration_statement
----------------------------
 250ms`,
      run: true },
    { label: 'Intermediate', title: 'Top queries with pg_stat_statements (not runnable in the sandbox)',
      sql: `-- Requires shared_preload_libraries = 'pg_stat_statements' + restart, then:
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 10 by total execution time
SELECT queryid,
       calls,
       round(total_exec_time::numeric, 0)                    AS total_ms,
       round(mean_exec_time::numeric, 2)                     AS mean_ms,
       round(100 * total_exec_time / sum(total_exec_time) OVER (), 1) AS pct_of_total,
       rows,
       shared_blks_hit + shared_blks_read                     AS buffers,
       temp_blks_written,
       left(query, 70)                                        AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT 10;

-- Start a fresh measurement window after a deploy
SELECT pg_stat_statements_reset();`,
      explain: `<p>Illustrative output from a production-like system using company_db's schema. The first row (a per-customer order lookup) is fast on average (3.1 ms) but called 2.4 million times: <strong>41% of all database time</strong>. The 2.7-second report matters less in total. <code>pct_of_total</code> with a window function makes the ranking obvious; <code>buffers</code> per call (~ 90 for row 1) suggests a seq scan or poor index &mdash; precisely the missing <code>orders(customer_id)</code> index.</p>`,
      output: `   queryid          |  calls  | total_ms | mean_ms | pct_of_total |  rows   | buffers  | temp_blks_written | query
--------------------+---------+----------+---------+--------------+---------+----------+-------------------+------------------------------------------------
 -51837162903317410 | 2401733 |  7445372 |    3.10 |         41.2 | 24103110| 213754236|                 0 | SELECT id, order_date, total_amount FROM orders WHERE customer_id = $1
 812734921733102117 |   92311 |  2953952 |   32.00 |         16.3 |   92311 |  8217655 |                 0 | SELECT c.id, (SELECT max(o.order_date) FROM orders o WHERE o.customer_id
 -2349817734512090 |     120 |   329040 | 2742.00 |          1.8 |     720 |  4417100 |            188200 | SELECT p.category, sum(oi.quantity * oi.unit_price) ...
 ...
(illustrative values - pg_stat_statements is not available in the browser sandbox)`,
      run: false },
    { label: 'Advanced', title: 'auto_explain setup and live long-running query detection',
      sql: `-- (A) auto_explain (contrib module) - not runnable in the sandbox
-- LOAD 'auto_explain';                         -- per session (superuser), or preload in config
-- SET auto_explain.log_min_duration = '500ms';
-- SET auto_explain.log_analyze = on;
-- SET auto_explain.log_buffers = on;
-- SET auto_explain.log_timing = off;           -- keep overhead low
-- SET auto_explain.sample_rate = 0.1;          -- explain 10% of statements

-- (B) What is running RIGHT NOW for more than 5 seconds? (runnable)
SELECT pid,
       now() - query_start AS running_for,
       state,
       wait_event_type,
       wait_event,
       left(query, 50)     AS query
FROM pg_stat_activity
WHERE state <> 'idle'
  AND pid <> pg_backend_pid()
  AND now() - query_start > interval '5 seconds'
ORDER BY running_for DESC;

-- (C) Sessions holding a transaction open while idle (block VACUUM, hold locks)
SELECT pid, now() - xact_start AS xact_age, state, left(query, 50) AS last_query
FROM pg_stat_activity
WHERE state LIKE 'idle in transaction%'
ORDER BY xact_age DESC;`,
      explain: `<p><strong>(A)</strong> With auto_explain loaded, any statement slower than 500 ms writes its plan (with actual rows and buffers) into the server log, using the real parameters and plan the application got &mdash; including generic plans of prepared statements.</p>
<p><strong>(B)</strong> Live view of long-running statements with their wait events: <code>Lock</code> means blocked by another session, <code>IO</code> means waiting on disk, NULL means running on CPU. <strong>(C)</strong> "idle in transaction" sessions are a top cause of bloat and lock pile-ups; protect with <code>idle_in_transaction_session_timeout</code>. In this single-session sandbox both lists are empty.</p>`,
      output: ` pid | running_for | state | wait_event_type | wait_event | query
-----+-------------+-------+-----------------+------------+-------
(0 rows)

 pid | xact_age | state | last_query
-----+----------+-------+------------
(0 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Log EVERYTHING to find slow queries
SET log_statement = 'all';
SHOW log_statement;`,
      why: 'log_statement = all logs every statement at parse time without duration, producing gigabytes of logs per hour on a busy server, costing I/O and CPU, and still not telling you which statements were slow.', run: true },
    good: { sql: `-- Log only slow statements, plus a sample of moderately slow ones (PG13+)
SET log_min_duration_statement = '500ms';
SET log_min_duration_sample = '50ms';
SET log_statement_sample_rate = 0.05;
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('log_min_duration_statement', 'log_min_duration_sample', 'log_statement_sample_rate');`,
      why: 'Threshold logging captures every statement slower than 500 ms with its duration, and 5% of those between 50 and 500 ms, keeping log volume manageable. Combine with pg_stat_statements for aggregate ranking and auto_explain for plans.', run: true }
  },
  mistakes: [
    `Ranking queries by mean time only and ignoring cheap queries executed millions of times.`,
    `Forgetting that pg_stat_statements needs <code>shared_preload_libraries</code> and a restart; <code>CREATE EXTENSION</code> alone gives "must be loaded via shared_preload_libraries".`,
    `Never resetting or snapshotting statistics, so last month's incident dominates the numbers forever.`,
    `Enabling <code>log_statement = 'all'</code> or <code>log_min_duration_statement = 0</code> permanently on a busy production server.`,
    `Running auto_explain with <code>log_analyze</code> and timing on every statement in high-throughput OLTP, adding significant overhead.`
  ],
  best: [
    `Enable pg_stat_statements on every server (including replicas) and snapshot it regularly into a history table or monitoring system.`,
    `Rank by total time, then by mean/p99 for latency-critical endpoints, then by buffers and temp blocks for efficiency.`,
    `Set <code>log_min_duration_statement</code> to a value that produces a manageable number of lines (e.g. 250&ndash;1000 ms) and add sampling for finer detail.`,
    `Use auto_explain with <code>log_timing = off</code> and sampling to collect real plans continuously at low cost.`,
    `Set <code>idle_in_transaction_session_timeout</code> and <code>statement_timeout</code> per role to contain runaway sessions.`
  ],
  performance: `
<p>pg_stat_statements overhead is usually 1&ndash;3% and worth it. Logging cost scales with the number of logged statements; a log line per slow query is negligible, a log line per statement at 20k TPS is not. auto_explain without ANALYZE costs only for slow statements; with ANALYZE every statement is instrumented. Monitoring queries on <code>pg_stat_activity</code> are cheap but should not run every second from many dashboards at once.</p>`,
  security: `
<p>Query texts in pg_stat_statements, pg_stat_activity and logs may contain sensitive literals (emails, tokens) &mdash; especially for statements not using bind parameters. Only superusers and members of <code>pg_read_all_stats</code> see other users' query texts. Protect log files (permissions, retention), consider <code>log_parameter_max_length</code> / <code>log_parameter_max_length_on_error</code> to limit logged bind values, and never ship raw logs to third-party services without scrubbing.</p>`,
  scenario: {
    title: 'Database CPU at 85% with no obvious culprit',
    steps: [
      '1. pg_stat_activity shows hundreds of short active queries, none slow: nothing stands out live.',
      '2. pg_stat_statements top by total_exec_time: one 3 ms query called 900/s accounts for 38% of time.',
      '3. Its buffers per call (~90) reveal a seq scan on a 90-page table per call; EXPLAIN confirms a missing index.',
      '4. CREATE INDEX CONCURRENTLY; mean time drops to 0.08 ms, buffers per call to 4.',
      '5. Reset pg_stat_statements after the deploy to measure the new baseline; CPU falls to 50%.',
      '6. Enable auto_explain (log_min_duration = 1s, sample_rate = 0.2) to catch the next class of problems with plans attached.'
    ]
  },
  widgets: ['diagram:query-pipeline', 'diagram:process-model'],
  interview: [
    { q: 'How do you find the most expensive queries on a PostgreSQL server?',
      a: 'Use the pg_stat_statements extension (preloaded via shared_preload_libraries) and sort by total_exec_time to find where the server spends its time, then by mean/max time for latency and by shared/temp blocks for efficiency. Complement it with log_min_duration_statement for individual slow executions and auto_explain to capture their actual plans.' },
    { q: 'Why is total_exec_time usually more important than mean_exec_time?',
      a: 'Total time reflects the real load on the server: a cheap query executed millions of times can consume far more CPU and I/O than a slow report executed a few times. Optimising the top total-time queries reduces overall resource usage the most; mean and percentiles matter for specific user-facing latency targets.' },
    { q: 'What does auto_explain do and what are its overhead considerations?',
      a: 'It is a contrib module that logs execution plans of statements exceeding auto_explain.log_min_duration, optionally with ANALYZE, BUFFERS and other EXPLAIN options. With log_analyze on, every statement is instrumented, so on busy systems you turn off per-node timing (log_timing = off) and use sample_rate to limit overhead.' },
    { q: 'How do you find sessions blocking VACUUM or holding locks for a long time?',
      a: 'Query pg_stat_activity for state = \'idle in transaction\' and old xact_start, and for old backend_xmin values; use pg_blocking_pids() to find blockers of waiting sessions. Terminate offenders if appropriate and set idle_in_transaction_session_timeout to prevent recurrence.' }
  ],
  exercises: [
    { task: 'List all logging-related settings (names starting with log_) that are not at their default value in your session, after setting log_min_duration_statement to 1s.',
      solution: `SET log_min_duration_statement = '1s';
SELECT name, setting, unit, source
FROM pg_settings
WHERE name LIKE 'log%' AND source <> 'default'
ORDER BY name;`, run: true },
    { task: 'Write the pg_stat_statements query you would use to find queries that spill to disk most (temp blocks), with average temp blocks per call. (Not runnable in the sandbox.)',
      solution: `SELECT queryid, calls,
       temp_blks_written,
       round(temp_blks_written::numeric / nullif(calls, 0), 1) AS temp_blks_per_call,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       left(query, 80) AS query
FROM pg_stat_statements
WHERE temp_blks_written > 0
ORDER BY temp_blks_written DESC
LIMIT 10;`, run: false }
  ],
  challenge: {
    task: 'Without pg_stat_statements, build a tiny "poor man\'s statement statistics" for this session: run three different queries several times each inside a DO block, record the elapsed time per call into a temp table, and report total, mean and calls per query label, ordered by total time.',
    hint: 'clock_timestamp() before/after each EXECUTE; store (label, ms). Aggregate with sum/avg/count.',
    solution: `CREATE TEMP TABLE stmt_log (label text, ms numeric);
DO $$
DECLARE t0 timestamptz; i int; n bigint;
BEGIN
  FOR i IN 1..30 LOOP
    t0 := clock_timestamp();
    SELECT count(*) INTO n FROM orders WHERE customer_id = i;
    INSERT INTO stmt_log VALUES ('orders by customer', extract(epoch FROM clock_timestamp() - t0) * 1000);
  END LOOP;
  FOR i IN 1..5 LOOP
    t0 := clock_timestamp();
    SELECT count(*) INTO n FROM order_items oi JOIN products p ON p.id = oi.product_id;
    INSERT INTO stmt_log VALUES ('items x products', extract(epoch FROM clock_timestamp() - t0) * 1000);
  END LOOP;
  FOR i IN 1..100 LOOP
    t0 := clock_timestamp();
    SELECT count(*) INTO n FROM customers WHERE id = i;
    INSERT INTO stmt_log VALUES ('customer by pk', extract(epoch FROM clock_timestamp() - t0) * 1000);
  END LOOP;
END $$;
SELECT label, count(*) AS calls, round(sum(ms), 2) AS total_ms, round(avg(ms), 3) AS mean_ms
FROM stmt_log GROUP BY label ORDER BY total_ms DESC;`,
    run: true
  },
  related: ['query-analysis-diagnosis-checklist', 'monitoring', 'explain-analyze', 'extensions', 'query-optimization-tuning-walkthrough'],
  quiz: [
    { type: 'mcq', q: 'What is required before CREATE EXTENSION pg_stat_statements is useful?',
      options: ['Nothing', 'shared_preload_libraries must include pg_stat_statements and the server restarted', 'track_io_timing = on', 'A superuser session per query'],
      answer: 1, explain: 'It needs shared memory allocated at server start.' },
    { type: 'scenario', q: 'Query A: mean 2,000 ms, 10 calls/day. Query B: mean 5 ms, 2M calls/day. Which consumes more DB time?',
      options: ['A (20 s/day)', 'B (10,000 s/day)', 'Equal', 'Cannot tell'],
      answer: 1, explain: '5 ms x 2,000,000 = 10,000 s per day.' },
    { type: 'tf', q: 'log_statement = \'all\' is the recommended way to find slow queries in production.',
      answer: false, explain: 'Use log_min_duration_statement (+ sampling) and pg_stat_statements.' },
    { type: 'mcq', q: 'Which tool logs the actual execution plan of slow statements as they happen in production?',
      options: ['pg_stat_statements', 'auto_explain', 'pg_stat_activity', 'pgbench'],
      answer: 1, explain: 'auto_explain logs plans of statements above a duration threshold.' },
    { type: 'write', q: 'Write a query listing sessions that have been "idle in transaction" for more than 1 minute.',
      solution: `SELECT pid, usename, now() - xact_start AS xact_age, left(query, 60) AS last_query
FROM pg_stat_activity
WHERE state LIKE 'idle in transaction%'
  AND now() - xact_start > interval '1 minute'
ORDER BY xact_age DESC;`,
      explain: 'pg_stat_activity.state and xact_start identify long open transactions that block VACUUM and may hold locks.' }
  ]
},

{
  id: 'query-analysis-diagnosis-checklist',
  module: 'query-analysis',
  title: 'Systematic Diagnosis Checklist: Statistics, Scans, Locks and I/O',
  level: 4,
  minutes: 26,
  summary: 'A repeatable checklist with ready-to-run catalog queries: statistics freshness, sequential-scan hot spots, index usage, dead tuples, lock waits and blockers, cache hit ratios, temp files and I/O.',
  objectives: [
    'Check statistics freshness (last_analyze, n_mod_since_analyze) and act on stale tables',
    'Find tables with heavy sequential scans and unused/rarely used indexes',
    'Detect dead-tuple build-up and vacuum lag',
    'Diagnose lock waits and find root blockers with pg_blocking_pids()',
    'Measure cache hit ratio, temp-file usage and I/O with pg_statio_*, pg_stat_database and pg_stat_io',
    'Turn the checklist into a repeatable runbook'
  ],
  concept: `
<p><strong>Analogy: an aircraft pre-flight checklist.</strong> Pilots don't rely on memory or intuition before take-off; they run the same checklist every time, because the one item they skip is the one that fails. A database diagnosis checklist does the same: when "the database is slow", you run through fixed checks in a fixed order, each answered by a catalog query, and you stop guessing.</p>
<ol>
  <li><strong>Is it one query or everything?</strong> pg_stat_statements / application metrics.</li>
  <li><strong>Statistics freshness</strong>: <code>pg_stat_user_tables.last_analyze/last_autoanalyze</code>, <code>n_mod_since_analyze</code>. Stale stats &rarr; misestimates &rarr; bad plans.</li>
  <li><strong>Scan profile</strong>: <code>seq_scan</code>, <code>seq_tup_read</code> vs <code>idx_scan</code> per table; big tables with many seq scans are index candidates.</li>
  <li><strong>Index usage</strong>: <code>pg_stat_user_indexes.idx_scan</code> (unused indexes cost writes), invalid indexes.</li>
  <li><strong>Vacuum health</strong>: <code>n_dead_tup</code>, <code>last_autovacuum</code>, oldest transaction (<code>backend_xmin</code>) holding back cleanup.</li>
  <li><strong>Locks</strong>: <code>wait_event_type = 'Lock'</code>, <code>pg_blocking_pids()</code>, <code>pg_locks</code> not granted.</li>
  <li><strong>Memory and I/O</strong>: <code>pg_statio_user_tables</code> hit ratio, <code>pg_stat_database</code> temp files and deadlocks, <code>pg_stat_io</code> (PG16+) reads/writes by backend type, <code>track_io_timing</code>.</li>
  <li><strong>Configuration sanity</strong>: <code>shared_buffers</code>, <code>work_mem</code>, <code>random_page_cost</code>, <code>effective_cache_size</code>, autovacuum settings, <code>max_connections</code> vs pooling.</li>
</ol>
<p>Every check here is a <span class="tag core">core</span> statistics view &mdash; no extension needed (except pg_stat_statements in step 1).</p>`,
  why: `
<p>Incidents are stressful and noisy: dashboards are red, people propose fixes in chat, and someone wants to restart the server. A checklist turns panic into procedure, makes junior engineers effective, surfaces the root cause (often a long transaction or stale statistics, not "the database needs more RAM"), and produces evidence for the post-mortem.</p>`,
  useCase: `
<p><strong>On-call runbook at a fintech:</strong> the "DB slow" alert links to a saved notebook of the queries in this lesson. In one incident, check 6 found 340 sessions waiting on a lock held by a migration's <code>ALTER TABLE</code>, which itself waited behind an analytics session idle in transaction for 3 hours. Terminating the idle session resolved the outage in 4 minutes; the post-mortem added <code>lock_timeout</code> to migrations and <code>idle_in_transaction_session_timeout = '5min'</code> for the analytics role.</p>`,
  internals: `
<p>The cumulative statistics system (PG15+ stores stats in shared memory, flushed by backends at transaction end and periodically; <code>pg_stat_force_next_flush()</code> forces it) feeds <code>pg_stat_*</code> views. Counters are cumulative since the last reset (<code>pg_stat_database.stats_reset</code>), so always compare two snapshots over an interval for rates. <code>stats_fetch_consistency</code> controls whether repeated reads within a transaction see a consistent snapshot.</p>
<p><strong>Lock waits:</strong> heavyweight locks appear in <code>pg_locks</code> (<code>granted = false</code> for waiters). <code>pg_blocking_pids(pid)</code> returns the PIDs blocking a backend, including those ahead in the lock queue. A classic chain: long transaction &rarr; DDL waiting for ACCESS EXCLUSIVE &rarr; every new query on the table queued behind the DDL.</p>
<p><strong>Cache hit ratio</strong> = hits / (hits + reads) on <code>pg_statio_*</code>; reads may still be served by the OS page cache, so a lower ratio isn't always disk I/O. <code>pg_stat_io</code> breaks I/O down by backend type, object and context (normal, vacuum, bulkread, bulkwrite).</p>`,
  whenNot: `
<ul>
  <li>Don't draw conclusions from cumulative counters without knowing the reset time and the time window; diff snapshots.</li>
  <li>Don't chase a 98% vs 99% cache hit ratio when the problem is a lock pile-up; follow the checklist order.</li>
  <li>Statistics views are per server: on replicas, scans and index usage are counted separately from the primary.</li>
</ul>`,
  syntax: `SELECT * FROM pg_stat_user_tables;        -- seq/idx scans, tuples, dead tuples, vacuum/analyze times
SELECT * FROM pg_stat_user_indexes;       -- idx_scan, idx_tup_read, last_idx_scan (PG16+)
SELECT * FROM pg_statio_user_tables;      -- heap/index/toast blocks hit vs read
SELECT * FROM pg_stat_database;           -- per-DB commits, rollbacks, temp files, deadlocks
SELECT * FROM pg_stat_io;                 -- PG16+: I/O by backend type and context
SELECT * FROM pg_stat_activity;           -- sessions, states, waits
SELECT pg_blocking_pids(pid);             -- who blocks whom
SELECT pg_stat_force_next_flush();        -- flush this backend's pending counters (PG15+)`,
  examples: [
    { label: 'Basic', title: 'Checks 2-3: statistics freshness and scan profile',
      sql: `-- Generate a little activity, then flush counters for this session
SELECT count(*) FROM orders WHERE customer_id = 3;
SELECT count(*) FROM orders WHERE status = 'paid';
SELECT * FROM orders WHERE id = 10;
SELECT pg_stat_force_next_flush();

-- Scan profile: sequential vs index access per table
SELECT relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch
FROM pg_stat_user_tables
WHERE relname IN ('orders', 'customers')
ORDER BY relname;

-- Statistics freshness: tables with the most changes since the last ANALYZE
SELECT relname, n_mod_since_analyze, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_mod_since_analyze DESC
LIMIT 5;`,
      explain: `<p><code>orders</code>: 2 sequential scans read 10,000 tuples (two full passes for queries returning 10 and 808 rows) and 1 index scan fetched 1 row (the PK lookup). In production, sort by <code>seq_tup_read</code> to find big tables being scanned repeatedly.</p>
<p>The freshness query ranks tables by modifications since the last analyze. In the sandbox the counters start at zero when the database loads (statistics themselves exist from the seed's ANALYZE). In production, a large <code>n_mod_since_analyze</code> relative to <code>n_live_tup</code> or an old <code>last_autoanalyze</code> on a big table is a red flag.</p>`,
      output: ` relname   | seq_scan | seq_tup_read | idx_scan | idx_tup_fetch
-----------+----------+--------------+----------+---------------
 customers |        0 |            0 |        0 |             0
 orders    |        2 |        10000 |        1 |             1

 relname    | n_mod_since_analyze | last_analyze | last_autoanalyze
------------+---------------------+--------------+------------------
 audit_logs |                   0 |              |
 orders     |                   0 |              |
 users      |                   0 |              |
 ...`,
      run: true },
    { label: 'Intermediate', title: 'Checks 5-6: dead tuples, long transactions and blockers',
      sql: `-- Dead tuples and vacuum recency (create some churn first)
UPDATE products SET stock = stock + 1;
SELECT pg_stat_force_next_flush();
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC;

-- Oldest transactions / snapshots that hold back VACUUM
SELECT pid, state, now() - xact_start AS xact_age, backend_xmin
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL
ORDER BY age(backend_xmin) DESC
LIMIT 5;

-- Lock waiters and their blockers
SELECT a.pid, pg_blocking_pids(a.pid) AS blocked_by,
       a.wait_event_type, a.wait_event, left(a.query, 50) AS query
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0;`,
      explain: `<p>The UPDATE created 100 dead tuples in <code>products</code> (MVCC keeps old versions until VACUUM). In the sandbox <code>n_live_tup</code> shows 0 because activity counters start empty when the database is loaded (an UPDATE does not change the live count), so dead_pct reads 100%; on a real server it would show 100 live / 100 dead = 50%. Autovacuum would normally clean them; if <code>last_autovacuum</code> is old and dead_pct keeps rising, look for blockers of VACUUM.</p>
<p>The second query lists sessions by the age of their snapshot (<code>backend_xmin</code>); here only your own session. In production, a session with an xact_age of hours is the usual reason VACUUM can't remove dead rows anywhere in the database.</p>
<p>The third query returns waiting sessions with the PIDs blocking them (empty here: one session cannot block itself). Follow <code>blocked_by</code> recursively to the root blocker.</p>`,
      output: ` relname  | n_live_tup | n_dead_tup | dead_pct | last_vacuum | last_autovacuum
----------+------------+------------+----------+-------------+-----------------
 products |          0 |        100 |    100.0 |             |

 pid | state  | xact_age        | backend_xmin
-----+--------+-----------------+--------------
  42 | active | 00:00:00 |          754

 pid | blocked_by | wait_event_type | wait_event | query
-----+------------+-----------------+------------+-------
(0 rows)`,
      run: true },
    { label: 'Advanced', title: 'Check 7: cache hit ratio, temp files and pg_stat_io',
      sql: `SELECT count(*) FROM orders;
SELECT count(*) FROM order_items;
SELECT pg_stat_force_next_flush();

-- Heap and index cache hit ratios per table
SELECT relname,
       heap_blks_read, heap_blks_hit,
       round(100.0 * heap_blks_hit / nullif(heap_blks_hit + heap_blks_read, 0), 2) AS heap_hit_pct,
       idx_blks_read, idx_blks_hit
FROM pg_statio_user_tables
WHERE heap_blks_hit + heap_blks_read > 0
ORDER BY heap_blks_hit + heap_blks_read DESC;

-- Database-wide: temp files (spills), deadlocks, rollbacks
SELECT datname, xact_commit, xact_rollback, blks_read, blks_hit,
       temp_files, pg_size_pretty(temp_bytes) AS temp_size, deadlocks
FROM pg_stat_database
WHERE datname = current_database();

-- PG16+: who does I/O, in which context
SELECT backend_type, object, context, reads, hits, writes
FROM pg_stat_io
WHERE coalesce(reads, 0) + coalesce(hits, 0) + coalesce(writes, 0) > 0
ORDER BY hits DESC NULLS LAST
LIMIT 5;`,
      explain: `<p>Per-table hit ratios show which tables are served from shared_buffers. In production, an OLTP database typically sits above 99%; a large table with a much lower ratio and high read counts is either scanned too much (missing index) or larger than memory.</p>
<p><code>temp_files</code>/<code>temp_bytes</code> rising quickly means sorts/hashes spill to disk (work_mem too small for some queries &mdash; find them via pg_stat_statements temp_blks_written). <code>deadlocks</code> &gt; 0 means application lock-ordering issues. <code>pg_stat_io</code> splits I/O into normal, vacuum and bulkread contexts so you can tell whether reads come from queries or maintenance. Exact numbers depend on what ran before in your session.</p>`,
      output: ` relname     | heap_blks_read | heap_blks_hit | heap_hit_pct | idx_blks_read | idx_blks_hit
-------------+----------------+---------------+--------------+---------------+--------------
 order_items |              0 |           104 |       100.00 |             0 |            2
 orders      |              0 |            89 |       100.00 |             0 |            1

 datname  | xact_commit | xact_rollback | blks_read | blks_hit | temp_files | temp_size | deadlocks
----------+-------------+---------------+-----------+----------+------------+-----------+-----------
 postgres |           5 |             0 |       140 |     1829 |          0 | 0 bytes   |         0

 backend_type   | object   | context | reads | hits  | writes
----------------+----------+---------+-------+-------+--------
 client backend | relation | normal  |   191 | 86306 |    611
 client backend | relation | vacuum  |     0 |    89 |      0
 ...`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Ad-hoc guessing: restart-and-hope style diagnostics
SELECT now() AS when_we_panicked;
SHOW shared_buffers;
SHOW max_connections;
-- "Let's double shared_buffers and restart"`,
      why: 'Looking at a couple of settings and restarting destroys the evidence (statistics counters, pg_stat_activity state, the blocking session) and rarely addresses the cause. Most slowdowns are caused by a query, a lock chain, stale statistics or vacuum lag.', run: true },
    good: { sql: `-- Checklist order: waits/blockers first, then scans, stats, vacuum, I/O
SELECT count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waiters,
       count(*) FILTER (WHERE state LIKE 'idle in transaction%') AS idle_in_xact,
       count(*) FILTER (WHERE state = 'active') AS active
FROM pg_stat_activity;
SELECT relname, seq_scan, seq_tup_read, idx_scan, n_dead_tup, n_mod_since_analyze
FROM pg_stat_user_tables
ORDER BY seq_tup_read DESC
LIMIT 5;`,
      why: 'Starting from current waits and session states quickly reveals lock pile-ups and long transactions; the table summary then points to scan-heavy, stale or bloated tables. Each answer narrows the search before anything is changed.', run: true }
  },
  mistakes: [
    `Restarting the server during an incident before capturing <code>pg_stat_activity</code>, locks and statistics, losing the evidence.`,
    `Interpreting cumulative counters as rates; always diff two snapshots over a known interval.`,
    `Killing the waiting session instead of the root blocker (follow <code>pg_blocking_pids</code> to the head of the chain).`,
    `Ignoring idle-in-transaction sessions because "they are idle"; they hold snapshots and locks.`,
    `Assuming a low cache hit ratio means disk I/O; reads may hit the OS cache &mdash; check <code>track_io_timing</code> / <code>pg_stat_io</code> times.`
  ],
  best: [
    `Keep the checklist and its queries in a runbook; practise it in game days.`,
    `Snapshot <code>pg_stat_user_tables</code>, <code>pg_stat_user_indexes</code>, <code>pg_stat_database</code> and pg_stat_statements periodically (or use a monitoring tool) for before/after comparisons.`,
    `Set guard rails: <code>statement_timeout</code>, <code>lock_timeout</code>, <code>idle_in_transaction_session_timeout</code>, <code>log_lock_waits = on</code>.`,
    `Tune autovacuum per large table (scale factors, cost limits) based on <code>n_dead_tup</code> trends.`,
    `Enable <code>track_io_timing</code> to turn "reads" into measured I/O time.`
  ],
  performance: `
<p>All checklist queries read in-memory statistics and are cheap (milliseconds), safe to run during incidents. <code>pg_stat_activity</code> joins with <code>pg_locks</code> on servers with thousands of locks can be heavier; limit columns and rows. The fixes the checklist points to have very different costs: ANALYZE (seconds), terminating a blocker (instant), creating an index concurrently (minutes to hours), configuration changes (reload or restart).</p>`,
  security: `
<p>Grant the predefined role <code>pg_monitor</code> (or <code>pg_read_all_stats</code>) to on-call/monitoring users instead of superuser; it allows reading all statistics and query texts. Terminating other sessions requires <code>pg_signal_backend</code> membership or superuser; restrict it to the on-call DBA role and log its use.</p>`,
  scenario: {
    title: 'Monday 9:05, "everything is slow"',
    steps: [
      '1. pg_stat_activity summary: 410 active, 380 with wait_event_type = Lock on table orders.',
      '2. pg_blocking_pids() chain: all wait on pid 9311 (ALTER TABLE orders ADD COLUMN ... from a deploy), which waits on pid 4022.',
      '3. pid 4022: state = idle in transaction, xact_age = 2 h 47 min, application_name = bi_tool.',
      '4. Terminate 4022 (pg_terminate_backend); the ALTER completes in 30 ms; the queue drains in seconds.',
      '5. Remaining checks: statistics fresh, no seq-scan anomalies, dead tuples normal, cache hit 99.7%: no secondary issue.',
      '6. Post-mortem actions: lock_timeout = \'3s\' for migrations (retry loop), idle_in_transaction_session_timeout = \'10min\' for bi_tool, alert on idle-in-transaction older than 5 minutes.'
    ]
  },
  widgets: ['diagram:process-model', 'diagram:memory', 'lab:txn'],
  interview: [
    { q: 'What would you check first when "the database is slow"?',
      a: 'Whether it is one query or everything, and current waits: pg_stat_activity grouped by state and wait_event_type, looking for lock waits, idle-in-transaction sessions and long-running queries, and pg_stat_statements for top consumers. Then statistics freshness, sequential-scan hot spots, vacuum health and I/O metrics, changing one thing at a time.' },
    { q: 'How do you find the root of a lock chain?',
      a: 'For each waiting session, call pg_blocking_pids(pid) to get its blockers and follow them until reaching a session that is not itself waiting. That root is often a long or idle-in-transaction session or a DDL statement. Decide whether to wait, cancel (pg_cancel_backend) or terminate (pg_terminate_backend) it.' },
    { q: 'What does n_mod_since_analyze tell you?',
      a: 'The approximate number of rows inserted, updated or deleted since the table was last analyzed. A high value relative to the table size means statistics may be stale and the planner may misestimate; autovacuum analyzes when it exceeds autovacuum_analyze_threshold + scale_factor x reltuples.' },
    { q: 'How do you detect work_mem spills across the system?',
      a: 'pg_stat_database.temp_files and temp_bytes show spill volume over time; log_temp_files logs individual temp files with their queries; pg_stat_statements temp_blks_written identifies the queries responsible; EXPLAIN ANALYZE shows external merge sorts or multi-batch hashes for a specific query.' }
  ],
  exercises: [
    { task: 'Write a query showing, for each user table, total size, seq_scan, idx_scan and the percentage of scans that used an index.',
      solution: `SELECT relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       seq_scan, coalesce(idx_scan, 0) AS idx_scan,
       round(100.0 * coalesce(idx_scan, 0) / nullif(seq_scan + coalesce(idx_scan, 0), 0), 1) AS idx_scan_pct
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;`, run: true },
    { task: 'List all non-granted locks with the waiting session\'s query (empty in the sandbox, but write it correctly).',
      solution: `SELECT l.pid, l.locktype, l.mode, l.relation::regclass AS relation,
       a.wait_event_type, a.wait_event, left(a.query, 60) AS query
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE NOT l.granted;`, run: true }
  ],
  challenge: {
    task: 'Build a one-query "health summary" returning a single row with: number of active sessions, lock waiters, idle-in-transaction sessions, the largest table by size, the table with most dead tuples, and the database-wide cache hit percentage.',
    hint: 'Use scalar subqueries over pg_stat_activity, pg_stat_user_tables and pg_stat_database.',
    solution: `SELECT
  (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active_sessions,
  (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock') AS lock_waiters,
  (SELECT count(*) FROM pg_stat_activity WHERE state LIKE 'idle in transaction%') AS idle_in_xact,
  (SELECT relname FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 1) AS largest_table,
  (SELECT relname FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 1) AS most_dead_tuples,
  (SELECT round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2)
     FROM pg_stat_database WHERE datname = current_database()) AS cache_hit_pct;`,
    run: true
  },
  related: ['query-analysis-finding-slow-queries', 'monitoring', 'locks', 'vacuum', 'advanced-indexing-statistics'],
  quiz: [
    { type: 'mcq', q: 'Which function returns the PIDs blocking a given backend?',
      options: ['pg_locks()', 'pg_blocking_pids(pid)', 'pg_terminate_backend(pid)', 'pg_stat_get_backend_pid()'],
      answer: 1, explain: 'pg_blocking_pids returns an array of blocking PIDs.' },
    { type: 'scenario', q: 'n_dead_tup keeps growing on a busy table and last_autovacuum is recent. Likely cause?',
      options: ['Missing index', 'A long-running or idle-in-transaction session holds an old snapshot so VACUUM cannot remove dead rows', 'work_mem too small', 'random_page_cost too high'],
      answer: 1, explain: 'VACUUM can only remove tuples dead to all snapshots; check backend_xmin ages.' },
    { type: 'tf', q: 'Statistics counters in pg_stat_user_tables are rates per second.',
      answer: false, explain: 'They are cumulative since the last reset; diff snapshots for rates.' },
    { type: 'mcq', q: 'temp_bytes in pg_stat_database is rising fast. What does it indicate?',
      options: ['WAL growth', 'Sorts/hashes spilling to disk (work_mem)', 'Table bloat', 'Replication lag'],
      answer: 1, explain: 'Temporary files come from operations exceeding work_mem (and temp tables).' },
    { type: 'write', q: 'Write a query listing the 5 tables with the highest seq_tup_read and their average rows read per sequential scan.',
      solution: `SELECT relname, seq_scan, seq_tup_read,
       seq_tup_read / nullif(seq_scan, 0) AS avg_rows_per_seq_scan
FROM pg_stat_user_tables
ORDER BY seq_tup_read DESC
LIMIT 5;`,
      explain: 'High seq_tup_read with avg near table size means repeated full scans: index candidates.' }
  ]
},

{
  id: 'query-analysis-benchmarking',
  module: 'query-analysis',
  title: 'Benchmarking: Million-Row Test Data, Index Before/After and pgbench',
  level: 4,
  minutes: 28,
  summary: 'Generate realistic test data with generate_series, measure queries with and without indexes using EXPLAIN ANALYZE and a timing harness, quantify index write cost, and load-test with pgbench.',
  objectives: [
    'Generate large, realistic test tables with generate_series (200k runnable, 1M+ for real servers)',
    'Measure a lookup before and after indexing with EXPLAIN (ANALYZE, BUFFERS)',
    'Build a repeatable in-database timing harness with clock_timestamp()',
    'Quantify the write cost of indexes (insert time and size)',
    'Use pgbench (third-party-style client tool shipped with PostgreSQL) for concurrency benchmarks, and know benchmarking pitfalls'
  ],
  concept: `
<p><strong>Analogy: testing a bridge.</strong> Engineers don't certify a bridge by driving one car across it. They model realistic loads (data volume and distribution), run controlled tests (one variable at a time), repeat measurements, and finally simulate rush hour (concurrency). Database benchmarking follows the same discipline.</p>
<ul>
  <li><strong>Realistic data</strong>: <code>generate_series()</code> creates millions of rows in seconds. Shape matters as much as size: distributions (skew), correlation with physical order, NULLs, text lengths. A 1M-row table with uniformly random values behaves differently from production data with hot customers.</li>
  <li><strong>Single-query measurement</strong>: <code>EXPLAIN (ANALYZE, BUFFERS)</code>, repeated, warm cache. Compare buffers first, time second.</li>
  <li><strong>Repeated-execution harness</strong>: a PL/pgSQL loop with <code>clock_timestamp()</code> (which advances during a transaction, unlike <code>now()</code>) measures N executions with varying parameters.</li>
  <li><strong>Concurrency</strong>: <strong>pgbench</strong> is a benchmarking client shipped with PostgreSQL (a command-line tool, not SQL): built-in TPC-B-like workload or custom scripts with random parameters, multiple clients and threads, reporting TPS and latency.</li>
</ul>
<p>In this lesson the runnable version uses 200,000 rows so it finishes quickly in your browser; the same scripts with 1,000,000 (or 100M) rows are what you run on a real server.</p>`,
  why: `
<p>Decisions such as "add this index", "change this query", "increase work_mem" or "upgrade the instance" should be backed by numbers measured on representative data. Benchmarks also expose costs that single-query tests hide: write amplification of extra indexes, lock contention under concurrency, and cache effects when the working set exceeds RAM.</p>`,
  useCase: `
<p><strong>Pre-launch capacity test at a government services portal:</strong> the team generated 50M citizens, 400M applications and 1.2B status events with <code>generate_series</code> and skewed distributions (10% of districts produce 60% of applications). pgbench custom scripts replayed the 6 hottest queries at the expected peak (1,800 TPS) with 200 clients. The test revealed a missing composite index (p99 2.3 s) and a hot-row update contention issue in a counters table &mdash; both fixed months before launch.</p>`,
  internals: `
<p><code>generate_series(start, stop[, step])</code> is a set-returning function producing integers, numerics or timestamps; combined with arithmetic, modulo, <code>random()</code>, arrays and <code>md5()</code> it fabricates any column. Insert speed is dominated by WAL and index maintenance: load first, then create indexes (a bulk index build sorts once instead of inserting row by row), then <code>VACUUM ANALYZE</code> (statistics + visibility map). Use <code>setseed()</code> for repeatable random data.</p>
<p>Timing inside PL/pgSQL: <code>clock_timestamp()</code> returns the actual current time; <code>now()</code>/<code>transaction_timestamp()</code> are frozen for the transaction. Results reflect server-side execution only (no network/client parsing).</p>
<p><strong>pgbench</strong> initialises its own tables (<code>pgbench -i -s 50</code> = 5M rows in pgbench_accounts), runs transactions with <code>-c</code> clients, <code>-j</code> threads, for <code>-T</code> seconds, using <code>-M prepared</code> to mimic applications with prepared statements; custom scripts use <code>\\set</code> with <code>random()</code>, <code>random_zipfian()</code> or <code>random_exponential()</code> for skew. Report: TPS, average latency, and with <code>-r</code> per-statement latencies; <code>--progress</code> shows stability over time.</p>`,
  whenNot: `
<ul>
  <li>Don't benchmark on a laptop and extrapolate to production hardware; and don't benchmark a 1 GB dataset when production is 2 TB &mdash; cache behaviour is completely different.</li>
  <li>Don't trust single runs, cold-vs-warm mixes, or runs shorter than a few minutes for pgbench (checkpoints and autovacuum need to appear).</li>
  <li>Don't benchmark against production during business hours.</li>
  <li>Synthetic uniform data hides skew problems; use realistic distributions or anonymised production samples.</li>
</ul>`,
  syntax: `-- Test data (scale the upper bound to taste)
INSERT INTO t (...) SELECT ... FROM generate_series(1, 1000000) AS g;
SELECT setseed(0.42);                       -- repeatable random()

-- Timing harness
DO $$ DECLARE t0 timestamptz; BEGIN t0 := clock_timestamp(); /* work */
  RAISE NOTICE '% ms', extract(epoch FROM clock_timestamp() - t0) * 1000; END $$;

-- pgbench (shell commands, not SQL)
pgbench -i -s 50 benchdb
pgbench -c 32 -j 8 -T 300 -M prepared -P 10 benchdb
pgbench -c 32 -j 8 -T 300 -f lookup.sql -r benchdb`,
  examples: [
    { label: 'Basic', title: '200k-row users table: lookup before and after an index',
      sql: `CREATE TABLE bench_users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL,
  country    text NOT NULL,
  signup_at  timestamptz NOT NULL,
  score      int NOT NULL
);

-- 200,000 rows in about a second (use 1000000 on a real server)
INSERT INTO bench_users (email, country, signup_at, score)
SELECT 'user' || g || '@example.com',
       (ARRAY['India','USA','UK','Germany','Singapore','UAE'])[1 + (g % 6)],
       timestamptz '2020-01-01 00:00+00' + (g * interval '15 minutes'),
       (g * 7919) % 1000
FROM generate_series(1, 200000) AS g;
ANALYZE bench_users;

SELECT pg_size_pretty(pg_total_relation_size('bench_users')) AS total_size, count(*) FROM bench_users;

-- Without an index on email
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, country FROM bench_users WHERE email = 'user123456@example.com';

CREATE INDEX idx_bench_users_email ON bench_users (email);

-- With the index
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, country FROM bench_users WHERE email = 'user123456@example.com';`,
      explain: `<p><strong>Without index:</strong> Seq Scan reading 2,083 pages and discarding 199,999 rows, ~37 ms. <strong>With index:</strong> Index Scan reading 4 pages, ~0.3 ms &mdash; about <strong>125x faster and 500x fewer buffers</strong>. At 1M rows the seq scan is ~5x worse again while the indexed lookup stays at 4 pages (one more tree level at most).</p>`,
      output: ` total_size | count
------------+--------
 21 MB      | 200000

-- BEFORE
 Seq Scan on bench_users  (cost=0.00..4583.00 rows=1 width=13) (actual time=23.212..37.173 rows=1.00 loops=1)
   Filter: (email = 'user123456@example.com'::text)
   Rows Removed by Filter: 199999
   Buffers: shared hit=2083
 Execution Time: 37.534 ms

CREATE INDEX

-- AFTER
 Index Scan using idx_bench_users_email on bench_users  (cost=0.42..8.44 rows=1 width=13) (actual time=0.110..0.113 rows=1.00 loops=1)
   Index Cond: (email = 'user123456@example.com'::text)
   Index Searches: 1
   Buffers: shared hit=1 read=3
 Execution Time: 0.295 ms`,
      run: true },
    { label: 'Intermediate', title: 'A repeatable timing harness: 20 lookups, with and without index',
      sql: `CREATE TABLE bench_users AS
SELECT g AS id, 'user' || g || '@example.com' AS email, (g * 7919) % 1000 AS score
FROM generate_series(1, 200000) g;

CREATE TEMP TABLE bench_results (label text, runs int, total_ms numeric);

DO $$
DECLARE t0 timestamptz; i int; dummy bigint;
BEGIN
  -- 20 lookups with different emails, no index
  t0 := clock_timestamp();
  FOR i IN 1..20 LOOP
    SELECT id INTO dummy FROM bench_users WHERE email = 'user' || (i * 9973) || '@example.com';
  END LOOP;
  INSERT INTO bench_results VALUES ('no index', 20,
    round(extract(epoch FROM clock_timestamp() - t0)::numeric * 1000, 2));

  CREATE INDEX idx_bench_email ON bench_users (email);
  ANALYZE bench_users;

  -- Same 20 lookups with the index
  t0 := clock_timestamp();
  FOR i IN 1..20 LOOP
    SELECT id INTO dummy FROM bench_users WHERE email = 'user' || (i * 9973) || '@example.com';
  END LOOP;
  INSERT INTO bench_results VALUES ('btree on email', 20,
    round(extract(epoch FROM clock_timestamp() - t0)::numeric * 1000, 2));
END $$;

SELECT label, runs, total_ms, round(total_ms / runs, 3) AS ms_per_query
FROM bench_results;`,
      explain: `<p><code>clock_timestamp()</code> advances inside the transaction, so it can time sections of a DO block (<code>now()</code> would return the same value every time). Varying the parameter (<code>i * 9973</code>) avoids measuring one lucky cached row. Result: ~24 ms per query without an index vs ~0.45 ms with it (your timings will differ; the ratio is what matters). Keep harness results in a table so you can compare runs and variants.</p>`,
      output: ` label          | runs | total_ms | ms_per_query
----------------+------+----------+--------------
 no index       |   20 |   489.00 |       24.450
 btree on email |   20 |     9.00 |        0.450`,
      run: true },
    { label: 'Advanced', title: 'The other side of the coin: index write cost',
      sql: `CREATE TABLE w0 (id int, email text, score int);                 -- no indexes
CREATE TABLE w3 (id int, email text, score int);                 -- three indexes
CREATE INDEX ON w3 (id);
CREATE INDEX ON w3 (email);
CREATE INDEX ON w3 (score);

CREATE TEMP TABLE r (label text, ms numeric);
DO $$
DECLARE t0 timestamptz;
BEGIN
  t0 := clock_timestamp();
  INSERT INTO w0 SELECT g, 'u' || g, g % 1000 FROM generate_series(1, 100000) g;
  INSERT INTO r VALUES ('0 indexes', round(extract(epoch FROM clock_timestamp() - t0)::numeric * 1000));

  t0 := clock_timestamp();
  INSERT INTO w3 SELECT g, 'u' || g, g % 1000 FROM generate_series(1, 100000) g;
  INSERT INTO r VALUES ('3 indexes', round(extract(epoch FROM clock_timestamp() - t0)::numeric * 1000));
END $$;

SELECT label, ms AS insert_100k_ms FROM r;
SELECT pg_size_pretty(pg_total_relation_size('w0')) AS w0_total,
       pg_size_pretty(pg_total_relation_size('w3')) AS w3_total;`,
      explain: `<p>Inserting the same 100,000 rows took ~180 ms into the unindexed table and ~1,250 ms into the table with three indexes &mdash; about <strong>7x slower</strong> &mdash; and the indexed table is 2.5x larger on disk (4.3 MB vs 11 MB). Every index you add for reads is paid for on every write. This is why bulk loads drop or delay indexes and why unused indexes should be removed.</p>`,
      output: ` label     | insert_100k_ms
-----------+----------------
 0 indexes |            179
 3 indexes |           1250

 w0_total | w3_total
----------+----------
 4360 kB  | 11 MB`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- "Benchmark" on a tiny table with a single run
CREATE TABLE tiny_users AS SELECT g AS id, 'user' || g || '@x.com' AS email FROM generate_series(1, 50) g;
EXPLAIN ANALYZE SELECT id FROM tiny_users WHERE email = 'user7@x.com';
CREATE INDEX ON tiny_users (email);
ANALYZE tiny_users;
EXPLAIN ANALYZE SELECT id FROM tiny_users WHERE email = 'user7@x.com';
-- "Indexes make no difference" (the planner even keeps the seq scan)`,
      why: 'With 50 rows in a single page, a seq scan is optimal and timings are pure noise. Conclusions drawn from toy data are wrong for production volumes, and a single run mixes cold-cache and planning effects.', run: true },
    good: { sql: `-- Production-like volume, warm repeated measurements, buffers compared
CREATE TABLE users_bench AS
SELECT g AS id, 'user' || g || '@x.com' AS email FROM generate_series(1, 200000) g;
ANALYZE users_bench;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM users_bench WHERE email = 'user77777@x.com';
CREATE INDEX ON users_bench (email);
ANALYZE users_bench;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM users_bench WHERE email = 'user77777@x.com';
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM users_bench WHERE email = 'user12345@x.com';`,
      why: 'Realistic volume shows the true scaling behaviour (thousands of buffers vs 4), repeated runs with different parameters avoid single-row cache luck, and buffers give a stable comparison across machines.', run: true }
  },
  mistakes: [
    `Benchmarking on toy datasets or uniformly random data and expecting production behaviour.`,
    `Using <code>now()</code> to time code inside a transaction; it doesn't advance. Use <code>clock_timestamp()</code>.`,
    `Creating indexes before bulk-loading test data, making the load several times slower than necessary.`,
    `Forgetting <code>VACUUM ANALYZE</code> after loading, so plans use missing statistics and index-only scans hit the heap.`,
    `Running pgbench for 10 seconds with 1 client and reporting the result as "TPS"; use realistic clients/threads, several minutes, <code>-M prepared</code>, and repeat.`,
    `Changing several variables between runs (data size, settings, query), making results incomparable.`
  ],
  best: [
    `Script the whole benchmark (data generation, indexes, VACUUM ANALYZE, measurements) so it's repeatable; use <code>setseed()</code> for deterministic data.`,
    `Load data first, build indexes after, then <code>VACUUM ANALYZE</code>.`,
    `Measure both read benefit and write cost of every proposed index.`,
    `Compare buffers and plans first, timings second; repeat runs and report median and p95/p99.`,
    `For concurrency, use pgbench custom scripts with realistic parameter distributions (<code>random_zipfian</code> for hot keys) and the production connection pooling setup.`
  ],
  performance: `
<p>generate_series inserts roughly 0.5&ndash;3 million narrow rows per second on a server (much less in a browser sandbox). Index builds after loading are typically 3&ndash;10x faster than maintaining indexes during the load and produce denser indexes. pgbench itself consumes CPU: run it on a separate machine for high-TPS tests, or with enough <code>-j</code> threads, so the client isn't the bottleneck.</p>`,
  security: `
<p>Never benchmark with copies of production personal data unless anonymised; generate synthetic data or mask sensitive columns. Benchmark databases should use separate credentials and never point at production by accident (use explicit host/database names in scripts). pgbench <code>-i</code> drops and recreates its tables in the target database.</p>`,
  scenario: {
    title: 'Proving an index proposal before a release',
    steps: [
      '1. Generate a staging table with production-like volume (e.g. 50M rows via generate_series) and realistic skew (10% of customers own 60% of orders).',
      '2. Load data, then create existing production indexes, then VACUUM ANALYZE.',
      '3. Baseline: EXPLAIN (ANALYZE, BUFFERS) of the target query for 20 different parameters (hot and cold customers); record median/p95 buffers and time.',
      '4. Add the proposed index; repeat the same measurements.',
      '5. Measure write cost: time a 100k-row insert batch and an update batch before and after the index; compare WAL with EXPLAIN (ANALYZE, WAL) inside BEGIN/ROLLBACK.',
      '6. Concurrency: pgbench -c 64 -j 8 -T 600 -M prepared with a custom script mixing reads and writes; compare TPS and latency percentiles.',
      '7. Decide with data: read p95 improved 40x, writes 6% slower: ship it.'
    ]
  },
  widgets: ['lab:index', 'lab:plan'],
  interview: [
    { q: 'How would you generate a large realistic test dataset in PostgreSQL?',
      a: 'Use INSERT ... SELECT with generate_series for the row count and derive columns with arithmetic, modulo, arrays, random() or md5(), adding skew with functions like power(random(), 3) or weighted choices, and setseed() for repeatability. Load without indexes, create indexes afterwards, then VACUUM ANALYZE so statistics and the visibility map are ready.' },
    { q: 'What is pgbench and how do you use it properly?',
      a: 'pgbench is a benchmarking client shipped with PostgreSQL. You initialise its schema with -i -s scale or provide custom scripts with -f, then run with several clients (-c) and threads (-j) for a meaningful duration (-T), usually with -M prepared and progress reporting. You repeat runs, change one variable at a time and report TPS with latency percentiles.' },
    { q: 'Why use clock_timestamp() instead of now() when timing inside PL/pgSQL?',
      a: 'now() returns the transaction start time and doesn\'t change during the transaction, so differences would be zero. clock_timestamp() returns the actual current time at each call, so the difference measures elapsed time of the code in between.' },
    { q: 'How do you evaluate whether a new index is worth it?',
      a: 'Measure the read improvement on representative queries (plans, buffers, latency percentiles) and the write cost (insert/update time, WAL volume, HOT update loss, index size and cache impact) on production-like data, ideally under concurrent load. Keep it if the read benefit outweighs the write and storage cost for your workload.' }
  ],
  exercises: [
    { task: 'Generate a 100,000-row orders_bench table with skewed customer ids (most orders belong to few customers) using power(random(), 3), with setseed for repeatability, and show the 5 busiest customers.',
      solution: `SELECT setseed(0.42);
CREATE TABLE orders_bench AS
SELECT g AS id,
       1 + floor(power(random(), 3) * 10000)::int AS customer_id,
       timestamptz '2025-01-01 00:00+00' + g * interval '5 minutes' AS created_at,
       round((random() * 500)::numeric, 2) AS amount
FROM generate_series(1, 100000) g;
SELECT customer_id, count(*) AS orders
FROM orders_bench GROUP BY customer_id ORDER BY orders DESC LIMIT 5;`, run: true },
    { task: 'Write the full 1,000,000-row version of the bench_users load for a real server (not for the browser sandbox), including index creation after the load and VACUUM ANALYZE.',
      solution: `CREATE TABLE bench_users_1m (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL, country text NOT NULL,
  signup_at timestamptz NOT NULL, score int NOT NULL
);
INSERT INTO bench_users_1m (email, country, signup_at, score)
SELECT 'user' || g || '@example.com',
       (ARRAY['India','USA','UK','Germany','Singapore','UAE'])[1 + (g % 6)],
       timestamptz '2020-01-01 00:00+00' + (g * interval '3 minutes'),
       (g * 7919) % 1000
FROM generate_series(1, 1000000) AS g;
CREATE INDEX idx_bench_users_1m_email ON bench_users_1m (email);
VACUUM ANALYZE bench_users_1m;`, run: false },
    { task: 'Write a pgbench custom script that looks up a random user by id in bench_users_1m, and the command to run it with 16 clients for 2 minutes (shell, not runnable here).',
      solution: `-- file: lookup.sql
\\set uid random(1, 1000000)
SELECT id, email, country FROM bench_users_1m WHERE id = :uid;

-- shell:
-- pgbench -n -c 16 -j 4 -T 120 -M prepared -P 10 -r -f lookup.sql benchdb`, run: false }
  ],
  challenge: {
    task: 'Benchmark three access paths for "users of country X with score > 990" on a 200k-row table: (1) no index, (2) index on (country), (3) composite index on (country, score). For each, record buffers via EXPLAIN (ANALYZE, BUFFERS) and keep the results in a summary table with ms from a timing loop of 10 executions.',
    hint: 'Create the table once; loop in a DO block; create indexes between phases; read buffers from the EXPLAIN output manually or record only timings.',
    solution: `CREATE TABLE bu AS
SELECT g AS id,
       (ARRAY['India','USA','UK','Germany','Singapore','UAE'])[1 + (g % 6)] AS country,
       (g * 7919) % 1000 AS score
FROM generate_series(1, 200000) g;
ANALYZE bu;
CREATE TEMP TABLE res (variant text, ms_per_query numeric);
DO $$
DECLARE t0 timestamptz; i int; n bigint;
BEGIN
  t0 := clock_timestamp();
  FOR i IN 1..10 LOOP SELECT count(*) INTO n FROM bu WHERE country = 'UAE' AND score > 990; END LOOP;
  INSERT INTO res VALUES ('no index', round(extract(epoch FROM clock_timestamp() - t0)::numeric * 100, 3));

  CREATE INDEX bu_country ON bu (country); ANALYZE bu;
  t0 := clock_timestamp();
  FOR i IN 1..10 LOOP SELECT count(*) INTO n FROM bu WHERE country = 'UAE' AND score > 990; END LOOP;
  INSERT INTO res VALUES ('(country)', round(extract(epoch FROM clock_timestamp() - t0)::numeric * 100, 3));

  CREATE INDEX bu_country_score ON bu (country, score); ANALYZE bu;
  t0 := clock_timestamp();
  FOR i IN 1..10 LOOP SELECT count(*) INTO n FROM bu WHERE country = 'UAE' AND score > 990; END LOOP;
  INSERT INTO res VALUES ('(country, score)', round(extract(epoch FROM clock_timestamp() - t0)::numeric * 100, 3));
END $$;
SELECT * FROM res;
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM bu WHERE country = 'UAE' AND score > 990;`,
    run: true
  },
  related: ['query-analysis-diagnosis-checklist', 'indexes-what-is-an-index', 'advanced-indexing-maintenance', 'explain-buffers-options'],
  quiz: [
    { type: 'mcq', q: 'Which function should you use to time code inside a PL/pgSQL block?',
      options: ['now()', 'transaction_timestamp()', 'clock_timestamp()', 'current_date'],
      answer: 2, explain: 'clock_timestamp() advances; now() is fixed for the transaction.' },
    { type: 'tf', q: 'For bulk loads it is usually faster to create indexes after loading the data.',
      answer: true, explain: 'A bulk build sorts once; maintaining indexes per row is much slower.' },
    { type: 'predict', q: 'Inserting 100k rows takes 180 ms with no indexes. Roughly what happens with three B-tree indexes?',
      code: `INSERT INTO w3 SELECT g, 'u' || g, g % 1000 FROM generate_series(1, 100000) g;`,
      options: ['About the same', 'Several times slower (about 7x in our test)', 'Faster', 'It fails'],
      answer: 1, explain: 'Each row requires three extra index insertions plus WAL.' },
    { type: 'mcq', q: 'What is pgbench?',
      options: ['A PostgreSQL extension', 'A benchmarking client program shipped with PostgreSQL', 'A system view', 'A cloud service'],
      answer: 1, explain: 'It is a command-line tool, not SQL; run it from a shell.' },
    { type: 'scenario', q: 'A benchmark shows "indexes don\'t help" on a 50-row table. What is wrong?',
      options: ['Nothing', 'The dataset is far too small; seq scans of one page are optimal and timings are noise', 'Indexes need REINDEX', 'pgbench was not used'],
      answer: 1, explain: 'Benchmark with realistic volumes and distributions.' }
  ]
}
]);
