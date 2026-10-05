/* PostgreSQL Mastery — Database Engineer track (level 4)
   Modules: partitioning, concurrency, mvcc, locks, isolation-levels,
            transaction-internals, vacuum, wal, backup-restore */

PGM.addLessons([
/* ===================================================================
   MODULE: partitioning
   =================================================================== */
{
  id: 'partitioning-declarative-basics',
  module: 'partitioning',
  title: 'Declarative Partitioning: Range, List, Hash and Monthly Partitions',
  level: 4,
  minutes: 25,
  summary: 'Split one logical table into many physical child tables by RANGE, LIST or HASH, and build a monthly-partitioned orders table with PARTITION BY RANGE.',
  objectives: [
    'Explain what a partitioned table is physically (a parent with no storage plus leaf tables that hold rows)',
    'Choose between RANGE, LIST and HASH partitioning based on the access pattern and data distribution',
    'Create a monthly RANGE-partitioned orders table and generate its partitions with a DO block',
    'Use tableoid, pg_partition_tree() and pg_inherits to see where every row physically lives',
    'Understand tuple routing, row movement on UPDATE, and the "no partition found for row" error',
    'Know why the partition key must be part of every PRIMARY KEY / UNIQUE constraint'
  ],
  concept: `<p><strong>Declarative partitioning</strong> <span class="tag core">core</span> (PostgreSQL 10+) lets you define one <em>logical</em> table, the <strong>partitioned table</strong> (parent), whose rows are physically stored in several ordinary tables called <strong>partitions</strong> (children / leaf tables). Applications keep querying <code>orders</code>; PostgreSQL decides which partition each row goes to (<em>tuple routing</em>) and which partitions a query must read (<em>partition pruning</em>).</p>
<p>Analogy: a company archive room. Instead of one gigantic cabinet holding every invoice ever written, there is one drawer per month, labelled "2025-03", "2025-04"... A clerk asked for "March 2025 invoices" walks straight to one drawer (pruning). When the 7-year retention period expires, the clerk throws away a whole drawer in seconds instead of pulling out millions of individual sheets (DROP / DETACH PARTITION instead of DELETE).</p>
<p>There are three partitioning methods:</p>
<ul>
<li><strong>RANGE</strong> — each partition owns a contiguous, non-overlapping interval <code>FROM (lower) TO (upper)</code>; lower bound inclusive, upper bound exclusive. Ideal for time series: orders by <code>order_date</code>, events by <code>created_at</code>, logs by day.</li>
<li><strong>LIST</strong> — each partition owns an explicit set of values: <code>FOR VALUES IN ('India','Singapore')</code>. Ideal for a low-cardinality, stable key: region, tenant tier, country.</li>
<li><strong>HASH</strong> — rows are spread by <code>hash(key) % MODULUS = REMAINDER</code>. No natural ranges, just even distribution: useful to split a very hot table into N smaller physical tables (smaller indexes, parallel vacuum) when you always query by the key.</li>
</ul>
<p>A <strong>DEFAULT partition</strong> catches rows that match no other partition (RANGE and LIST only). Partitions can themselves be partitioned (<strong>sub-partitioning</strong>), e.g. RANGE by month, then LIST by region.</p>
<div class="callout info">The parent table has <strong>no storage of its own</strong> (<code>relkind = 'p'</code>). <code>SELECT pg_relation_size('orders_part')</code> returns 0 — all bytes live in the leaves.</div>`,
  why: `<p>Large tables hurt in ways that indexes alone do not fix:</p>
<ul>
<li><strong>Retention</strong>: deleting 50M old rows with <code>DELETE</code> generates huge WAL, creates 50M dead tuples, bloats indexes and triggers a long VACUUM. Dropping a partition is a metadata operation that frees the files instantly.</li>
<li><strong>Maintenance scale</strong>: VACUUM, ANALYZE and REINDEX work per partition. A 2 TB table becomes 36 tables of ~55 GB; autovacuum can process old, frozen partitions rarely and the hot current month often.</li>
<li><strong>Locality</strong>: recent data (the current month) stays small and hot in shared_buffers, with small, shallow B-tree indexes.</li>
<li><strong>Pruning</strong>: queries with a predicate on the partition key read only the relevant partitions.</li>
</ul>
<p>Before PostgreSQL 10, people built this by hand with table inheritance, CHECK constraints and INSERT triggers — slow and error-prone. Declarative partitioning made routing, pruning and partitioned indexes native.</p>`,
  useCase: `<p>An Indian e-commerce marketplace stores <strong>1.8 billion order rows</strong> (about 70M per month) in <code>orders</code>. The finance team queries the last 3 months daily; regulators require 8 years of retention. Before partitioning, a nightly <code>DELETE ... WHERE order_date &lt; now() - interval '8 years'</code> ran for 4 hours, produced 120 GB of WAL and made replicas lag.</p>
<p>After moving to <code>PARTITION BY RANGE (order_date)</code> with monthly partitions: the purge became <code>ALTER TABLE orders DETACH PARTITION orders_2017_09; DROP TABLE orders_2017_09;</code> — under a second. The current-month partition (~70M rows) has a 1.5 GB primary-key index instead of 40 GB, so it stays in memory. Dashboard queries on "last 30 days" scan 1–2 partitions instead of the whole table.</p>`,
  internals: `<ul>
<li><strong>Catalog</strong>: the parent is a <code>pg_class</code> row with <code>relkind = 'p'</code>; <code>pg_partitioned_table</code> stores the strategy (<code>partstrat</code> r/l/h) and key columns. Each leaf is a normal table (<code>relkind = 'r'</code>) with <code>relispartition = true</code> and its bound in <code>relpartbound</code> (readable with <code>pg_get_expr(relpartbound, oid)</code>). Parent/child links live in <code>pg_inherits</code>.</li>
<li><strong>Tuple routing</strong>: on INSERT/COPY into the parent the executor builds a <em>partition dispatch</em> structure from the bounds and binary-searches the sorted RANGE bounds (or looks up LIST values / computes the hash) to find the leaf. Inserting directly into a leaf is allowed and skips routing, but the leaf's implicit partition constraint is still enforced.</li>
<li><strong>Row movement</strong>: since PG 11, an UPDATE that changes the partition key so the row no longer fits is executed as DELETE from the old partition + INSERT into the new one.</li>
<li><strong>Unique constraints</strong>: each partition has its own B-tree; there is no global index. Uniqueness can therefore only be guaranteed if the partition key columns are part of the constraint (then two equal keys must land in the same partition and its local index catches the duplicate).</li>
<li><strong>Hash partitioning</strong> uses the type's extended hash function with a fixed seed, so the same key always maps to the same remainder; <code>satisfies_hash_partition()</code> is the internal check function.</li>
</ul>`,
  whenNot: `<p>Do not partition a table just because it "feels big". Under roughly 50–100 GB, or when most queries do <em>not</em> filter by the partition key, partitioning usually makes things slower (more planning work, N index probes instead of 1). Alternatives: a good composite index, a BRIN index on an append-only timestamp column, a partial index on "hot" rows, or archiving to a separate table. Partitioning is also not sharding: all partitions still live on one server (see the strategy lesson for Citus).</p>`,
  syntax: `CREATE TABLE parent ( ... ) PARTITION BY { RANGE | LIST | HASH } ( column | (expression) [, ...] );

CREATE TABLE child PARTITION OF parent
  FOR VALUES FROM (lower) TO (upper)              -- RANGE: lower inclusive, upper exclusive
| FOR VALUES IN (value [, ...])                   -- LIST
| FOR VALUES WITH (MODULUS n, REMAINDER r)        -- HASH
| DEFAULT;                                         -- catch-all (RANGE / LIST)

-- sub-partitioning
CREATE TABLE child PARTITION OF parent FOR VALUES ... PARTITION BY LIST (region);

-- inspection
SELECT * FROM pg_partition_tree('parent');
SELECT tableoid::regclass, * FROM parent;`,
  examples: [
    {
      label: 'Basic',
      title: 'LIST partitioning customers by region',
      sql: `-- Logical table: one parent, no storage of its own
CREATE TABLE customers_by_country (
  id       int  NOT NULL,
  name     text NOT NULL,
  country  text NOT NULL,
  segment  text NOT NULL
) PARTITION BY LIST (country);

CREATE TABLE customers_apac PARTITION OF customers_by_country FOR VALUES IN ('India', 'Singapore');
CREATE TABLE customers_emea PARTITION OF customers_by_country FOR VALUES IN ('UK', 'Germany', 'UAE');
CREATE TABLE customers_amer PARTITION OF customers_by_country FOR VALUES IN ('USA');

-- Tuple routing: insert into the PARENT, PostgreSQL picks the partition
INSERT INTO customers_by_country
SELECT id, name, country, segment FROM customers;

-- tableoid reveals which physical table each row lives in
SELECT tableoid::regclass AS partition,
       count(*)           AS rows,
       string_agg(DISTINCT country, ', ') AS countries
FROM customers_by_country
GROUP BY 1
ORDER BY 1;`,
      explain: `<p><code>PARTITION BY LIST (country)</code> declares the strategy and key. Each <code>PARTITION OF ... FOR VALUES IN (...)</code> creates a real heap table that owns a set of values. The <code>INSERT ... SELECT</code> targets the parent; the executor routes each of the 500 customers to the right leaf. The hidden system column <code>tableoid</code> holds the OID of the physical table a row came from — casting it to <code>regclass</code> prints the partition name. Rows with a country not listed (e.g. 'France') would raise <em>no partition of relation found for row</em> because no DEFAULT partition exists.</p>`,
      output: ` partition      | rows | countries
----------------+------+------------------
 customers_apac |  250 | India, Singapore
 customers_emea |  187 | Germany, UAE, UK
 customers_amer |   63 | USA
(3 rows)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'HASH partitioning audit_logs into 4 buckets',
      sql: `CREATE TABLE audit_hashed (LIKE audit_logs INCLUDING DEFAULTS)
  PARTITION BY HASH (row_id);

CREATE TABLE audit_hashed_p0 PARTITION OF audit_hashed FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE audit_hashed_p1 PARTITION OF audit_hashed FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE audit_hashed_p2 PARTITION OF audit_hashed FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE audit_hashed_p3 PARTITION OF audit_hashed FOR VALUES WITH (MODULUS 4, REMAINDER 3);

INSERT INTO audit_hashed SELECT * FROM audit_logs;

SELECT tableoid::regclass AS partition, count(*)
FROM audit_hashed GROUP BY 1 ORDER BY 1;

-- equality on the hash key prunes to exactly one bucket
EXPLAIN (COSTS OFF) SELECT * FROM audit_hashed WHERE row_id = 42;`,
      explain: `<p><code>LIKE audit_logs INCLUDING DEFAULTS</code> copies the column list (not the identity property, which is fine because we copy existing ids). Four partitions each take one remainder of <code>hash(row_id) % 4</code>; together they must cover all remainders or inserts can fail. The distribution is roughly even (87/71/78/64 for 300 rows). EXPLAIN shows that <code>row_id = 42</code> is pruned to a single partition: the planner computes the hash of the constant at plan time. A range predicate like <code>row_id &gt; 100</code> could <em>not</em> be pruned, because hashing destroys ordering.</p>`,
      output: ` partition       | count
-----------------+-------
 audit_hashed_p0 |    87
 audit_hashed_p1 |    71
 audit_hashed_p2 |    78
 audit_hashed_p3 |    64
(4 rows)

QUERY PLAN
------------------------------------------
 Seq Scan on audit_hashed_p2 audit_hashed
   Filter: (row_id = 42)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Monthly RANGE partitions for orders, generated automatically',
      sql: `SET timezone = 'UTC';   -- partition bounds on timestamptz depend on the session time zone

CREATE TABLE orders_part (
  id           bigint      NOT NULL,
  customer_id  int         NOT NULL,
  status       text        NOT NULL,
  order_date   timestamptz NOT NULL,
  total_amount numeric(12,2),
  PRIMARY KEY (id, order_date)          -- must include the partition key
) PARTITION BY RANGE (order_date);

-- One partition per month, Jan 2024 .. Dec 2025
DO $$
DECLARE m date;
BEGIN
  FOR m IN SELECT generate_series(date '2024-01-01', date '2025-12-01', interval '1 month')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF orders_part FOR VALUES FROM (%L) TO (%L)',
                   'orders_part_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
  END LOOP;
END $$;

CREATE TABLE orders_part_default PARTITION OF orders_part DEFAULT;

INSERT INTO orders_part
SELECT id, customer_id, status, order_date, total_amount FROM orders;

SELECT relid, parentrelid, isleaf, level
FROM pg_partition_tree('orders_part') LIMIT 4;

SELECT tableoid::regclass AS partition, count(*) AS rows
FROM orders_part GROUP BY 1 ORDER BY 1 DESC LIMIT 4;`,
      explain: `<p>The DO block loops over 24 month starts and builds DDL with <code>format()</code>: <code>%I</code> quotes an identifier, <code>%L</code> a literal — never concatenate raw strings into DDL. Each partition covers <code>[month start, next month start)</code>, so boundaries never overlap and no instant is lost (a classic bug is <code>TO ('2025-01-31')</code>, which drops the whole last day). The DEFAULT partition catches the one order timestamped 2023-12-31 23:45 UTC that falls outside the range — a perfect example of why monitoring the default partition matters. <code>pg_partition_tree()</code> lists the hierarchy with depth; the last query shows the newest partitions (October 2025 has only 5 rows because the data ends on 2025-10-01).</p>`,
      output: ` relid               | parentrelid | isleaf | level
---------------------+-------------+--------+-------
 orders_part         |             | f      |     0
 orders_part_2024_01 | orders_part | t      |     1
 orders_part_2024_02 | orders_part | t      |     1
 orders_part_2024_03 | orders_part | t      |     1
(4 rows)

 partition           | rows
---------------------+------
 orders_part_default |    1
 orders_part_2025_10 |    5
 orders_part_2025_09 |  236
 orders_part_2025_08 |  235
(4 rows)`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Boundaries that leave gaps: 2025-01-31 10:00 belongs to no partition
CREATE TABLE ev (id int, at timestamptz NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ev_2025_01 PARTITION OF ev FOR VALUES FROM ('2025-01-01') TO ('2025-01-31');
CREATE TABLE ev_2025_02 PARTITION OF ev FOR VALUES FROM ('2025-02-01') TO ('2025-02-28');
SELECT 'inserting 2025-01-31 would fail: no partition of relation "ev" found for row' AS note;`,
      why: 'The upper bound is EXCLUSIVE, so "TO (2025-01-31)" excludes the entire last day of January and leaves a gap; February also loses its last day. Inserts in the gaps fail at runtime.',
      run: true
    },
    good: {
      sql: `-- Half-open intervals that chain: upper bound of one = lower bound of the next
CREATE TABLE ev (id int, at timestamptz NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ev_2025_01 PARTITION OF ev FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE ev_2025_02 PARTITION OF ev FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
INSERT INTO ev VALUES (1, '2025-01-31 23:59:59');
SELECT tableoid::regclass, * FROM ev;`,
      why: 'Half-open [start, next_start) intervals cover every instant exactly once, regardless of month length or leap years.',
      run: true
    }
  },
  mistakes: [
    'Writing <code>TO (\'2025-01-31\')</code> for January: RANGE upper bounds are <strong>exclusive</strong>, so the whole last day falls into a gap (or into the default partition).',
    'Declaring <code>PRIMARY KEY (id)</code> on a table partitioned by <code>order_date</code>: it fails with <em>unique constraint on partitioned table must include all partitioning columns</em>. Use <code>PRIMARY KEY (id, order_date)</code>.',
    'Partitioning a <code>timestamptz</code> column while different sessions use different <code>timezone</code> settings when creating partitions — bounds like <code>\'2025-03-01\'</code> are interpreted in the session time zone at CREATE time. Create partitions from one job with a fixed time zone (usually UTC).',
    'Creating hash partitions that do not cover all remainders (e.g. MODULUS 4 with only remainders 0–2): every row hashing to 3 fails to insert.',
    'Letting the DEFAULT partition silently fill up because nobody created next month\'s partition — later, creating that partition requires scanning the default and fails if conflicting rows are there.'
  ],
  best: [
    'Use half-open bounds <code>[first day of month, first day of next month)</code> and generate them with code, not by hand.',
    'Pick a partition key that appears in the WHERE clause of the hot queries and in the retention rule (usually the creation timestamp).',
    'Keep partitions in the "tens of GB" range and the count in the hundreds at most; monthly or daily are typical for time series.',
    'Pre-create future partitions (at least 2–3 periods ahead) with a scheduled job or pg_partman, and alert if the DEFAULT partition contains rows.',
    'Name partitions predictably (<code>orders_2025_03</code>) so automation and humans can reason about them.'
  ],
  performance: `<p>INSERT routing costs a binary search over bounds — negligible. The real costs are in planning: with many partitions and no pruning, the planner must build paths for every partition. Keep <code>enable_partition_pruning = on</code>, filter by the key, and avoid thousands of partitions. Each partition has its own indexes, so per-partition B-trees are shallower and the current one stays cached. Since PG 12, COPY into a partitioned table uses multi-insert buffering, so bulk loading is close to loading a plain table.</p>`,
  security: `<p>Privileges are checked on the table named in the query. Granting <code>SELECT</code> on the parent lets users read all partitions through it; partitions can also be granted/revoked individually for direct access. Row-level security policies defined on the parent apply to queries through the parent but <strong>not</strong> to direct queries on a partition — revoke direct access to leaves if you rely on RLS.</p>`,
  scenario: {
    title: 'The 1.8-billion-row orders table whose nightly purge breaks replication',
    steps: [
      '1. Measure: pg_total_relation_size(\'orders\') = 2.1 TB; the nightly DELETE of rows older than 8 years writes ~120 GB WAL and replica lag peaks at 40 minutes.',
      '2. Confirm the access pattern: pg_stat_statements shows 93% of query time is on statements filtering by order_date (last 90 days).',
      '3. Design: PARTITION BY RANGE (order_date), monthly; PRIMARY KEY (id, order_date); a DEFAULT partition with an alert if count(*) &gt; 0.',
      '4. Build the new partitioned table orders_new, create partitions for 8 years + 3 future months, and backfill month by month with INSERT ... SELECT in batches (or logical replication into it).',
      '5. Cut over in a short maintenance window: lock old table, copy the delta, rename orders -&gt; orders_old and orders_new -&gt; orders.',
      '6. Replace the DELETE job with DETACH PARTITION + DROP TABLE (or archive to cold storage first).',
      '7. Verify with EXPLAIN that dashboards prune to 3–4 partitions; monitor autovacuum on the current partition only.'
    ]
  },
  widgets: ['diagram:partitioning', 'lab:partition'],
  interview: [
    { q: 'What physically happens when you INSERT a row into a partitioned table?', a: 'The parent has no storage. The executor uses the partition bounds (binary search for RANGE, value lookup for LIST, hash modulo for HASH) to route the tuple to a leaf partition, then performs a normal heap insert and index inserts on that leaf. If no partition matches and there is no DEFAULT partition, the statement fails with "no partition of relation found for row".' },
    { q: 'Why must a primary key on a partitioned table include the partition key?', a: 'PostgreSQL has no global indexes: each partition has its own B-tree. Uniqueness can only be enforced locally, which is sufficient only if equal key values are guaranteed to land in the same partition — true exactly when the partition key columns are part of the unique key.' },
    { q: 'When would you use HASH partitioning instead of RANGE?', a: 'When there is no natural range dimension and no retention-by-range requirement, but you want to split a very large, hot table into N smaller physical tables to reduce index size, vacuum time and contention, and queries always use equality on the key (e.g. tenant_id or account_id). Hash cannot prune range predicates and cannot be dropped "by age".' },
    { q: 'What happens when an UPDATE changes the partition key value?', a: 'Since PostgreSQL 11 the row is moved: it is deleted from the source partition and inserted into the destination partition within the same statement. This is more expensive than a normal update and concurrent sessions targeting the moved row can get a serialization-style error, so frequently changing the partition key is a design smell.' }
  ],
  exercises: [
    {
      task: 'Create a LIST-partitioned copy of users partitioned by role with one partition for admin+manager, one for analyst, and a DEFAULT partition. Load the users and count rows per partition.',
      solution: `CREATE TABLE users_by_role (id int, username text, role text NOT NULL, tenant_id int)
  PARTITION BY LIST (role);
CREATE TABLE users_staff   PARTITION OF users_by_role FOR VALUES IN ('admin', 'manager');
CREATE TABLE users_analyst PARTITION OF users_by_role FOR VALUES IN ('analyst');
CREATE TABLE users_other   PARTITION OF users_by_role DEFAULT;
INSERT INTO users_by_role SELECT id, username, role, tenant_id FROM users;
SELECT tableoid::regclass AS partition, count(*) FROM users_by_role GROUP BY 1 ORDER BY 1;`,
      run: true
    },
    {
      task: 'Show that an UPDATE moving a row across a RANGE boundary relocates it to the other partition (use tableoid in RETURNING).',
      solution: `CREATE TABLE t_r (id int, d date) PARTITION BY RANGE (d);
CREATE TABLE t_r_jan PARTITION OF t_r FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE t_r_feb PARTITION OF t_r FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
INSERT INTO t_r VALUES (1, '2025-01-15');
UPDATE t_r SET d = '2025-02-10' WHERE id = 1 RETURNING tableoid::regclass, *;`,
      run: true
    }
  ],
  challenge: {
    task: 'Build a two-level partitioned table: payments partitioned by RANGE on paid_at (yearly: 2024, 2025) and each year sub-partitioned by LIST on method (card+upi, everything else as DEFAULT). Load payments with a non-null paid_at and report the row count per leaf partition with its parent.',
    hint: 'Create the year partitions with "PARTITION OF payments_p FOR VALUES FROM ... TO ... PARTITION BY LIST (method)", then create leaves under each year. pg_partition_tree() gives parentrelid and isleaf.',
    solution: `SET timezone = 'UTC';
CREATE TABLE payments_p (id bigint, order_id bigint, amount numeric, method text NOT NULL, status text, paid_at timestamptz NOT NULL)
  PARTITION BY RANGE (paid_at);
CREATE TABLE payments_2024 PARTITION OF payments_p FOR VALUES FROM ('2024-01-01') TO ('2025-01-01') PARTITION BY LIST (method);
CREATE TABLE payments_2025 PARTITION OF payments_p FOR VALUES FROM ('2025-01-01') TO ('2026-01-01') PARTITION BY LIST (method);
CREATE TABLE payments_2024_digital PARTITION OF payments_2024 FOR VALUES IN ('card', 'upi');
CREATE TABLE payments_2024_other   PARTITION OF payments_2024 DEFAULT;
CREATE TABLE payments_2025_digital PARTITION OF payments_2025 FOR VALUES IN ('card', 'upi');
CREATE TABLE payments_2025_other   PARTITION OF payments_2025 DEFAULT;
CREATE TABLE payments_p_default    PARTITION OF payments_p DEFAULT;
INSERT INTO payments_p SELECT id, order_id, amount, method, status, paid_at FROM payments WHERE paid_at IS NOT NULL;
SELECT t.relid, t.parentrelid, count(p.*) AS rows
FROM pg_partition_tree('payments_p') t
LEFT JOIN payments_p p ON p.tableoid = t.relid
WHERE t.isleaf
GROUP BY t.relid, t.parentrelid
ORDER BY 1::text;`,
    run: true
  },
  related: ['partitioning-pruning-indexes', 'partitioning-maintenance', 'partitioning-strategy', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'A RANGE partition is defined FOR VALUES FROM (\'2025-03-01\') TO (\'2025-04-01\'). Which value does it accept?', options: ['2025-04-01 00:00:00', '2025-03-01 00:00:00', 'Both', 'Neither, bounds are exclusive on both ends'], answer: 1, explain: 'The lower bound is inclusive and the upper bound exclusive, so 2025-03-01 00:00 belongs here and 2025-04-01 00:00 belongs to the April partition.' },
    { type: 'tf', q: 'The parent of a declaratively partitioned table stores the rows that do not fit any partition.', answer: false, explain: 'The parent has no storage at all. Unmatched rows go to a DEFAULT partition if one exists; otherwise the INSERT fails.' },
    { type: 'bug', q: 'Why does this fail?', code: `CREATE TABLE orders_p (id bigint PRIMARY KEY, order_date timestamptz NOT NULL)
  PARTITION BY RANGE (order_date);`, options: ['timestamptz cannot be a partition key', 'The primary key does not include the partition key column order_date', 'RANGE needs at least two columns', 'bigint cannot be a primary key on partitioned tables'], answer: 1, explain: 'Unique constraints (including PKs) on partitioned tables must include all partition key columns because only per-partition indexes exist. Use PRIMARY KEY (id, order_date).' },
    { type: 'design', q: 'A SaaS product has 40 tenants of very different sizes, queries always filter tenant_id = ?, and the largest 3 tenants hold 70% of data. Which partitioning method fits best?', options: ['HASH on tenant_id with MODULUS 40', 'LIST on tenant_id: one partition per big tenant plus a DEFAULT for the long tail', 'RANGE on created_at', 'No partitioning possible'], answer: 1, explain: 'LIST lets you isolate the three heavy tenants in their own partitions (independent vacuum, easy move/export) and group small tenants together. HASH would mix big and small tenants unpredictably.' },
    { type: 'predict', q: 'With partitions for Jan and Feb 2025 only (no DEFAULT), what does INSERT INTO ev VALUES (\'2025-03-02\') do?', code: `INSERT INTO ev(at) VALUES ('2025-03-02');`, options: ['Inserts into the parent', 'Inserts into the February partition', 'ERROR: no partition of relation "ev" found for row', 'Silently discards the row'], answer: 2, explain: 'Without a matching partition or DEFAULT partition, tuple routing fails with an error.' }
  ]
},
{
  id: 'partitioning-pruning-indexes',
  module: 'partitioning',
  title: 'Partition Pruning, Partitioned Indexes and Unique Constraints',
  level: 4,
  minutes: 22,
  summary: 'How the planner and executor skip partitions (plan-time and run-time pruning), how to read pruning in EXPLAIN, and how partitioned indexes and unique constraints really work.',
  objectives: [
    'Distinguish plan-time pruning from run-time (executor) pruning and recognise both in EXPLAIN output',
    'Write predicates that are prunable and spot ones that are not (functions/casts on the key)',
    'Use enable_partition_pruning and plan_cache_mode to observe pruning behaviour',
    'Create partitioned indexes and understand that they cascade to every partition',
    'Explain why unique constraints must include the partition key and how to work around it'
  ],
  concept: `<p><strong>Partition pruning</strong> is the optimisation that makes partitioning pay off: partitions whose bounds cannot possibly contain matching rows are removed from the plan. It works in two phases:</p>
<ul>
<li><strong>Plan-time pruning</strong>: when the WHERE clause compares the partition key with <em>constants</em> (or immutable expressions), the planner compares them with the partition bounds and never even builds scan nodes for excluded partitions. In EXPLAIN they simply do not appear.</li>
<li><strong>Run-time (executor) pruning</strong> (PG 11+): when the value is known only at execution — a prepared-statement parameter with a generic plan, a value from a subquery (InitPlan), or a stable function like <code>now()</code> — the executor prunes during startup (shown as <code>Subplans Removed: N</code>) or per rescan (partitions marked <code>(never executed)</code> in EXPLAIN ANALYZE).</li>
</ul>
<p>Analogy: a library with one shelf per year. If you ask the librarian for "books from 2019", she walks to one shelf before starting (plan-time). If you say "books from the year my grandmother was born — I'll text you the year", she plans to visit all shelves but, once the text arrives, only walks to one (run-time).</p>
<p>A <strong>partitioned index</strong> created on the parent (<code>CREATE INDEX ON orders_part (customer_id)</code>) is a catalog-only "template" index (<code>relkind = 'I'</code>) that automatically creates a matching index on every existing and future partition, and attaches existing compatible ones. <strong>Unique constraints</strong> and primary keys are allowed only if they include all partition key columns, because each partition enforces uniqueness only within itself.</p>`,
  why: `<p>Without pruning, partitioning would make queries <em>slower</em>: a query on one month would open 36 partitions, probe 36 indexes and merge the results. Pruning turns "one huge table" into "one small table" for queries that use the key. Partitioned indexes exist so you do not have to create and keep identical indexes on hundreds of partitions by hand.</p>`,
  useCase: `<p>A logistics company keeps 3 years of GPS pings (12 billion rows) in daily partitions. The tracking API runs a prepared statement <code>WHERE vehicle_id = $1 AND recorded_at &gt;= $2</code>. With the driver using server-side prepared statements, after 5 executions PostgreSQL may switch to a <em>generic plan</em> — plan-time pruning becomes impossible because <code>$2</code> is unknown — but run-time pruning still removes ~1,090 of 1,095 partitions at executor start, keeping p99 latency at 4 ms. When an engineer once wrote <code>WHERE recorded_at::date = $2</code>, pruning stopped completely and p99 jumped to 2.3 s — the cast hid the partition key.</p>`,
  internals: `<ul>
<li>The planner converts the WHERE clauses on the key into <em>pruning steps</em> (<code>PartitionPruneStep</code>) evaluated by <code>get_matching_partitions()</code> against the sorted bound array (binary search for RANGE).</li>
<li>Steps containing only constants run at plan time. Steps with <code>Param</code>s or stable functions are stored in the plan (<code>PartitionPruneInfo</code>) and run when the Append/MergeAppend node initialises (initial pruning — "Subplans Removed") or every time a parameter changes (exec pruning — "never executed").</li>
<li>Pruning only understands expressions of the form <code>partkey op value</code> where <code>op</code> belongs to the partition key's operator class. <code>order_date::date = ...</code> or <code>date_trunc('month', order_date) = ...</code> is an expression over the key, so it cannot be matched to bounds.</li>
<li>Partitioned indexes: the parent index is <code>relkind 'I'</code> with no storage; each child index is linked through <code>pg_inherits</code>. <code>CREATE INDEX ON ONLY parent</code> creates an invalid parent index; you then build child indexes with <code>CREATE INDEX CONCURRENTLY</code> and <code>ALTER INDEX parent_idx ATTACH PARTITION child_idx</code> — the parent becomes valid when every partition has an attached index.</li>
<li><code>enable_partition_pruning</code> (default on) controls both phases. The older <code>constraint_exclusion</code> setting applies only to inheritance-based partitioning and UNION ALL views.</li>
</ul>`,
  whenNot: `<p>If the majority of queries cannot filter on the partition key (e.g. lookups by <code>customer_id</code> on a table partitioned by date), pruning will not help: every partition's index is probed and planning cost grows with the partition count. Consider a different key, a covering index on an unpartitioned table, or a separate lookup table that maps <code>customer_id</code> to dates.</p>`,
  syntax: `-- prunable predicates: compare the bare partition key with values
WHERE order_date >= '2025-03-01' AND order_date < '2025-04-01'
WHERE order_date >= $1                      -- run-time pruning (generic plans)
WHERE order_date >= (SELECT ...)            -- run-time pruning (InitPlan)

SET enable_partition_pruning = on | off;
SET plan_cache_mode = auto | force_generic_plan | force_custom_plan;

CREATE INDEX name ON parent (cols);                 -- cascades to all partitions
CREATE INDEX name ON ONLY parent (cols);            -- parent only (invalid until attached)
ALTER INDEX parent_idx ATTACH PARTITION child_idx;`,
  examples: [
    {
      label: 'Basic',
      title: 'Plan-time pruning on a monthly-partitioned orders table',
      sql: `SET timezone = 'UTC';
CREATE TABLE orders_part (id bigint NOT NULL, customer_id int NOT NULL, status text NOT NULL,
  order_date timestamptz NOT NULL, total_amount numeric(12,2), PRIMARY KEY (id, order_date))
  PARTITION BY RANGE (order_date);
DO $$
DECLARE m date;
BEGIN
  FOR m IN SELECT generate_series(date '2024-01-01', date '2025-12-01', interval '1 month')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF orders_part FOR VALUES FROM (%L) TO (%L)',
                   'orders_part_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
  END LOOP;
END $$;
CREATE TABLE orders_part_default PARTITION OF orders_part DEFAULT;
INSERT INTO orders_part SELECT id, customer_id, status, order_date, total_amount FROM orders;
ANALYZE orders_part;

-- Only March 2025 is planned: the other 24 partitions were pruned at plan time
EXPLAIN (COSTS OFF)
SELECT count(*) FROM orders_part
WHERE order_date >= '2025-03-01' AND order_date < '2025-04-01';`,
      explain: `<p>The first part rebuilds the 25-partition table from the previous lesson. The query compares the bare key <code>order_date</code> with two constants, so the planner binary-searches the bounds and keeps only <code>orders_part_2025_03</code>. Notice there is not even an <code>Append</code> node: with one surviving partition the planner scans it directly. Partitions removed at plan time never show in EXPLAIN.</p>`,
      output: `QUERY PLAN
------------------------------------------------------------------------
 Aggregate
   ->  Seq Scan on orders_part_2025_03 orders_part
         Filter: ((order_date >= '2025-03-01 00:00:00+00'::timestamp with time zone)
              AND (order_date < '2025-04-01 00:00:00+00'::timestamp with time zone))`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Run-time pruning: generic plans and subqueries',
      sql: `SET timezone = 'UTC';
CREATE TABLE orders_part (id bigint NOT NULL, customer_id int NOT NULL, status text NOT NULL,
  order_date timestamptz NOT NULL, total_amount numeric(12,2), PRIMARY KEY (id, order_date))
  PARTITION BY RANGE (order_date);
DO $$
DECLARE m date;
BEGIN
  FOR m IN SELECT generate_series(date '2024-01-01', date '2025-12-01', interval '1 month')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF orders_part FOR VALUES FROM (%L) TO (%L)',
                   'orders_part_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
  END LOOP;
END $$;
INSERT INTO orders_part SELECT id, customer_id, status, order_date, total_amount FROM orders
WHERE order_date >= '2024-01-01';

-- 1) prepared statement + generic plan: parameters unknown at plan time
PREPARE recent(timestamptz, timestamptz) AS
  SELECT count(*) FROM orders_part WHERE order_date >= $1 AND order_date < $2;
SET plan_cache_mode = force_generic_plan;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
EXECUTE recent('2025-09-01', '2025-10-01');

-- 2) value produced by a subquery (InitPlan)
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
SELECT count(*) FROM orders_part
WHERE order_date >= (SELECT max(order_date) - interval '20 days' FROM orders);
DEALLOCATE recent;`,
      explain: `<p>With <code>force_generic_plan</code>, <code>$1</code>/<code>$2</code> are unknown when planning, so all 24 partitions are in the plan; at executor start the parameters are known and initial pruning removes 23 of them — EXPLAIN ANALYZE prints <code>Subplans Removed: 23</code>. In the second query the bound comes from an InitPlan evaluated during execution: partitions that cannot match are kept in the plan but shown as <code>(never executed)</code>. Both are <em>run-time pruning</em>. Output is abbreviated.</p>`,
      output: `-- generic plan
 Aggregate (actual rows=1.00 loops=1)
   ->  Append (actual rows=236.00 loops=1)
         Subplans Removed: 23
         ->  Seq Scan on orders_part_2025_09 orders_part_1 (actual rows=236.00 loops=1)
               Filter: ((order_date >= $1) AND (order_date < $2))

-- InitPlan (abbreviated)
 Aggregate (actual rows=1.00 loops=1)
   InitPlan 1
     ->  Aggregate (actual rows=1.00 loops=1)
           ->  Seq Scan on orders (actual rows=5000.00 loops=1)
   ->  Append (actual rows=165.00 loops=1)
         ->  Seq Scan on orders_part_2024_01 orders_part_1 (never executed)
         ...  (2024_02 .. 2025_08 also never executed)
         ->  Seq Scan on orders_part_2025_09 orders_part_21 (actual rows=160.00 loops=1)
         ->  Seq Scan on orders_part_2025_10 orders_part_22 (actual rows=5.00 loops=1)
         ->  Seq Scan on orders_part_2025_11 orders_part_23 (actual rows=0.00 loops=1)
         ->  Seq Scan on orders_part_2025_12 orders_part_24 (actual rows=0.00 loops=1)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Partitioned indexes and the unique-constraint rule',
      sql: `SET timezone = 'UTC';
CREATE TABLE orders_part (id bigint NOT NULL, customer_id int NOT NULL, status text NOT NULL,
  order_date timestamptz NOT NULL, total_amount numeric(12,2), PRIMARY KEY (id, order_date))
  PARTITION BY RANGE (order_date);
CREATE TABLE orders_part_2025_08 PARTITION OF orders_part FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE orders_part_2025_09 PARTITION OF orders_part FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
INSERT INTO orders_part SELECT id, customer_id, status, order_date, total_amount FROM orders
WHERE order_date >= '2025-08-01' AND order_date < '2025-10-01';

-- One statement on the parent creates an index on every partition
CREATE INDEX orders_part_customer_idx ON orders_part (customer_id);

-- A partition created later gets the index automatically
CREATE TABLE orders_part_2025_10 PARTITION OF orders_part FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

SELECT i.inhrelid::regclass AS child_index, c.relkind
FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
WHERE i.inhparent = 'orders_part_customer_idx'::regclass
ORDER BY 1;

-- Uniqueness on id alone is impossible (no global index) -> include the key
ALTER TABLE orders_part ADD CONSTRAINT orders_part_id_date_uq UNIQUE (id, order_date);
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'orders_part'::regclass AND contype IN ('p', 'u') ORDER BY 1;`,
      explain: `<p><code>CREATE INDEX</code> on the parent creates a partitioned index (<code>relkind 'I'</code>) and one real B-tree (<code>relkind 'i'</code>) per partition, linked in <code>pg_inherits</code>. The October partition, created afterwards, inherited the index automatically. Trying <code>UNIQUE (id)</code> would fail with <em>unique constraint on partitioned table must include all partitioning columns</em>; <code>UNIQUE (id, order_date)</code> works because duplicates of that pair must land in the same partition. If the application truly needs global uniqueness of <code>id</code>, rely on a sequence/identity (unique by construction) or a separate unpartitioned lookup table.</p>`,
      output: ` child_index                         | relkind
-------------------------------------+---------
 orders_part_2025_08_customer_id_idx | i
 orders_part_2025_09_customer_id_idx | i
 orders_part_2025_10_customer_id_idx | i
(3 rows)

 conname                | pg_get_constraintdef
------------------------+------------------------------
 orders_part_id_date_uq | UNIQUE (id, order_date)
 orders_part_pkey       | PRIMARY KEY (id, order_date)
(2 rows)`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `SET timezone = 'UTC';
CREATE TABLE ev (id int, at timestamptz NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ev_2025_02 PARTITION OF ev FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE ev_2025_03 PARTITION OF ev FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
-- cast on the key: NO pruning, both partitions scanned
EXPLAIN (COSTS OFF) SELECT * FROM ev WHERE at::date = '2025-03-15';`,
      why: 'A cast or function applied to the partition key (at::date, date_trunc(...)) produces an expression the pruning logic cannot compare with the bounds, so every partition is scanned.',
      run: true
    },
    good: {
      sql: `SET timezone = 'UTC';
CREATE TABLE ev (id int, at timestamptz NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ev_2025_02 PARTITION OF ev FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE ev_2025_03 PARTITION OF ev FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
-- same meaning, written as a range on the bare key: pruned to one partition
EXPLAIN (COSTS OFF) SELECT * FROM ev WHERE at >= '2025-03-15' AND at < '2025-03-16';`,
      why: 'Rewriting the filter as a half-open range on the raw key column lets the planner prune at plan time.',
      run: true
    }
  },
  mistakes: [
    'Filtering with <code>WHERE order_date::date = ...</code> or <code>date_trunc(...) = ...</code> — functions on the key disable pruning. Rewrite as a range on the bare column.',
    'Comparing the key with a value of a different type that needs a cast on the column side (e.g. a <code>timestamp</code> key compared with a <code>text</code> expression) — check EXPLAIN that pruning really happened.',
    'Assuming <code>CREATE INDEX CONCURRENTLY</code> works on the parent: it does not for partitioned tables. Use <code>CREATE INDEX ON ONLY parent</code>, then <code>CREATE INDEX CONCURRENTLY</code> on each partition and <code>ALTER INDEX ... ATTACH PARTITION</code>.',
    'Expecting a global unique index on a non-key column (e.g. <code>email</code>) across partitions — PostgreSQL does not support global indexes.',
    'Disabling <code>enable_partition_pruning</code> while debugging and forgetting to reset it.'
  ],
  best: [
    'Always verify pruning with EXPLAIN (plan-time) and EXPLAIN ANALYZE (look for "Subplans Removed" or "never executed").',
    'Write time filters as half-open ranges: <code>key &gt;= start AND key &lt; end</code>.',
    'Create indexes on the parent so new partitions inherit them; build large ones partition by partition with CONCURRENTLY + ATTACH.',
    'Put the partition key first in the WHERE clause logic of hot queries and make sure ORMs do not wrap it in functions.',
    'Use <code>pg_partition_tree()</code> and <code>pg_partition_ancestors()</code> in monitoring queries instead of hard-coding partition names.'
  ],
  performance: `<p>Plan-time pruning also reduces <em>planning</em> time and lock acquisition: pruned partitions are not opened or locked during planning in recent versions (PG 12+ defers opening). With generic plans, all partitions must be locked at executor start before run-time pruning — with thousands of partitions this becomes measurable (lock manager contention, <code>max_locks_per_transaction</code>). Keep partition counts modest and prefer custom plans for very selective time-range queries if planning stays cheap.</p>`,
  security: `<p>No special security implications: privileges on the parent govern access through it. Be aware that EXPLAIN output reveals partition names, which can leak tenant names if you use LIST partitions named after customers.</p>`,
  scenario: {
    title: 'A dashboard query got 500x slower after an ORM upgrade',
    steps: [
      '1. Capture the slow statement from pg_stat_statements: it now reads WHERE CAST(created_at AS date) BETWEEN $1 AND $2.',
      '2. Run EXPLAIN on the table partitioned daily by created_at: 1,095 partitions appear — no pruning.',
      '3. Run EXPLAIN ANALYZE on the old form (created_at &gt;= $1 AND created_at &lt; $2 + 1): Subplans Removed: 1,088.',
      '4. Fix the ORM mapping (or the query builder) to emit a half-open range on the raw column.',
      '5. Add a CI check that runs EXPLAIN (FORMAT JSON) for critical queries and fails when more than N partitions are scanned.',
      '6. Re-measure: p99 back from 2.3 s to 12 ms.'
    ]
  },
  widgets: ['diagram:partitioning', 'lab:partition'],
  interview: [
    { q: 'Explain the difference between plan-time and run-time partition pruning.', a: 'Plan-time pruning happens in the planner when the partition key is compared with constants or immutable expressions; excluded partitions never appear in the plan. Run-time pruning happens in the executor when values become known only at execution — generic-plan parameters, InitPlan results, stable functions like now(), or parameters of a nested-loop inner side. EXPLAIN ANALYZE shows it as "Subplans Removed: N" (initial pruning) or "(never executed)" (exec-time pruning).' },
    { q: 'Why does WHERE created_at::date = $1 prevent pruning on a table partitioned by created_at?', a: 'Pruning matches clauses of the form key operator value against bounds using the key\'s operator class. created_at::date is a different expression of a different type, so the planner cannot map it to bounds. Rewriting as created_at >= $1 AND created_at < $1 + 1 restores pruning.' },
    { q: 'How do you add an index to a 2 TB partitioned table without blocking writes?', a: 'CREATE INDEX ... ON ONLY parent creates an invalid parent index without touching partitions. Then for each partition run CREATE INDEX CONCURRENTLY and ALTER INDEX parent_idx ATTACH PARTITION child_idx. Once all partitions have an attached index the parent index becomes valid automatically.' },
    { q: 'Can you enforce a unique email across all partitions of a users table partitioned by tenant_id?', a: 'Not with a single constraint: PostgreSQL lacks global indexes, and a unique constraint must include the partition key, so UNIQUE (tenant_id, email) is possible but not UNIQUE (email). Options are a separate unpartitioned table of emails with a unique index, partitioning by a key that includes email, or enforcing it in application logic with locking.' }
  ],
  exercises: [
    {
      task: 'Build a 3-partition LIST table on customers.country and show with EXPLAIN that WHERE country IN (\'UK\', \'UAE\') scans only one partition while WHERE lower(country) = \'uk\' scans all.',
      solution: `CREATE TABLE cust_l (id int, country text NOT NULL) PARTITION BY LIST (country);
CREATE TABLE cust_l_apac PARTITION OF cust_l FOR VALUES IN ('India', 'Singapore');
CREATE TABLE cust_l_emea PARTITION OF cust_l FOR VALUES IN ('UK', 'Germany', 'UAE');
CREATE TABLE cust_l_amer PARTITION OF cust_l FOR VALUES IN ('USA');
INSERT INTO cust_l SELECT id, country FROM customers;
EXPLAIN (COSTS OFF) SELECT * FROM cust_l WHERE country IN ('UK', 'UAE');
EXPLAIN (COSTS OFF) SELECT * FROM cust_l WHERE lower(country) = 'uk';`,
      run: true
    },
    {
      task: 'Show that SET enable_partition_pruning = off makes a single-month query scan every partition.',
      solution: `SET timezone = 'UTC';
CREATE TABLE ev (id int, at timestamptz NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ev_2025_02 PARTITION OF ev FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE ev_2025_03 PARTITION OF ev FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
SET enable_partition_pruning = off;
EXPLAIN (COSTS OFF) SELECT * FROM ev WHERE at >= '2025-03-01' AND at < '2025-04-01';
RESET enable_partition_pruning;
EXPLAIN (COSTS OFF) SELECT * FROM ev WHERE at >= '2025-03-01' AND at < '2025-04-01';`,
      run: true
    }
  ],
  challenge: {
    task: 'Add an index on (status) to a partitioned orders table the "zero-downtime" way: create an invalid parent index with ON ONLY, build each partition index separately, attach them, and prove the parent index became valid (pg_index.indisvalid).',
    hint: 'In real life the per-partition CREATE INDEX would use CONCURRENTLY (outside a transaction). Here plain CREATE INDEX shows the same catalog mechanics.',
    solution: `CREATE TABLE op (id bigint, status text, d date NOT NULL) PARTITION BY RANGE (d);
CREATE TABLE op_2025_01 PARTITION OF op FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE op_2025_02 PARTITION OF op FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE INDEX op_status_idx ON ONLY op (status);
SELECT indisvalid FROM pg_index WHERE indexrelid = 'op_status_idx'::regclass;
CREATE INDEX op_2025_01_status_idx ON op_2025_01 (status);
CREATE INDEX op_2025_02_status_idx ON op_2025_02 (status);
ALTER INDEX op_status_idx ATTACH PARTITION op_2025_01_status_idx;
ALTER INDEX op_status_idx ATTACH PARTITION op_2025_02_status_idx;
SELECT indisvalid FROM pg_index WHERE indexrelid = 'op_status_idx'::regclass;`,
    run: true
  },
  related: ['partitioning-declarative-basics', 'partitioning-maintenance', 'query-optimization', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'In EXPLAIN ANALYZE, what does "Subplans Removed: 23" under an Append node indicate?', options: ['23 partitions were pruned at plan time', '23 partitions were pruned at executor startup (run-time pruning)', '23 partitions were empty', '23 parallel workers were not launched'], answer: 1, explain: 'Initial run-time pruning happens when the executor initialises the Append node with now-known parameter values; the removed subplans are counted in this line. Plan-time pruned partitions are not mentioned at all.' },
    { type: 'optimize', q: 'The table is partitioned by RANGE (created_at). How should this filter be rewritten?', code: `SELECT * FROM events WHERE date_trunc('day', created_at) = '2025-06-10';`, options: ['Add an index on date_trunc(\'day\', created_at)', 'WHERE created_at >= \'2025-06-10\' AND created_at < \'2025-06-11\'', 'SET enable_partition_pruning = on', 'Use LIST partitioning instead'], answer: 1, explain: 'A half-open range on the bare key is prunable; the date_trunc expression is not, and an expression index does not restore pruning.' },
    { type: 'tf', q: 'CREATE INDEX on a partitioned parent also creates indexes on partitions that are added later.', answer: true, explain: 'A partitioned index acts as a template: new partitions get a matching index at CREATE/ATTACH time (or an existing matching index is attached).' },
    { type: 'bug', q: 'Why does this fail on a table partitioned by order_date?', code: `ALTER TABLE orders_part ADD CONSTRAINT uq_id UNIQUE (id);`, options: ['UNIQUE is not allowed on partitioned tables', 'The constraint must include the partition key column order_date', 'id must be NOT NULL first', 'You must use CREATE UNIQUE INDEX CONCURRENTLY'], answer: 1, explain: 'Without global indexes, uniqueness can only be enforced per partition, which is correct only if the partition key is part of the unique key.' }
  ]
},
{
  id: 'partitioning-maintenance',
  module: 'partitioning',
  title: 'Partition Maintenance: ATTACH, DETACH, Default Partitions and Retention',
  level: 4,
  minutes: 24,
  summary: 'Operate partitioned tables in production: pre-create partitions, attach pre-loaded tables without long locks, detach (CONCURRENTLY) and drop old data instantly, and handle the DEFAULT partition safely.',
  objectives: [
    'Create future partitions ahead of time and automate it with a function or pg_partman',
    'Attach a bulk-loaded table cheaply by adding a matching CHECK constraint first',
    'Implement retention with DETACH PARTITION + DROP TABLE instead of DELETE',
    'Know the lock levels of ATTACH, DETACH and DETACH CONCURRENTLY and their restrictions',
    'Fix the "default partition would be violated" error when creating a new partition'
  ],
  concept: `<p>A partitioned table is only as healthy as its partition lifecycle. Three operations make up almost all day-to-day work:</p>
<ul>
<li><strong>Create ahead</strong>: <code>CREATE TABLE orders_2025_11 PARTITION OF orders FOR VALUES FROM ... TO ...</code> before data for that period arrives. If you forget, inserts either fail or land in the DEFAULT partition.</li>
<li><strong>ATTACH PARTITION</strong>: turn an existing, independently loaded table into a partition. PostgreSQL must prove every row fits the bound, so it scans the table — unless a <code>CHECK</code> constraint already implies the bound, in which case the scan is skipped.</li>
<li><strong>DETACH PARTITION</strong>: turn a partition back into a standalone table. Combined with <code>DROP TABLE</code> this is the fastest possible way to delete a month of data: the files are unlinked, no dead tuples, no VACUUM, almost no WAL.</li>
</ul>
<p>Analogy: a train. Partitions are carriages. You can couple a new carriage that was loaded in the yard (ATTACH) or uncouple the last carriage and send it to the scrapyard (DETACH + DROP) without unloading passengers seat by seat (DELETE).</p>
<p><strong>pg_partman</strong> <span class="tag ext">extension</span> is a widely used extension (not core) that automates creating future partitions and dropping/detaching old ones based on a retention policy, typically run through its background worker or a cron job (<code>pg_cron</code> <span class="tag ext">extension</span>). Plain SQL functions scheduled by any job runner work too.</p>`,
  why: `<p>DELETE-based retention on big tables is one of the most common causes of bloat, replication lag and autovacuum storms. Partition maintenance converts "delete 70M rows" into "drop one file set", and "bulk load 70M rows into a live table" into "load an offline table, then attach it in milliseconds".</p>`,
  useCase: `<p>A telecom stores call-detail records (CDRs): 400M rows/day, kept 90 days, partitioned daily. A nightly job (1) creates partitions for the next 7 days, (2) detaches the partition that turned 91 days old, (3) copies it to Parquet in object storage, (4) drops it. The whole job takes 40 seconds; before partitioning, the DELETE took 6 hours and the table was 3x larger than its live data because of bloat.</p>`,
  internals: `<ul>
<li><strong>CREATE TABLE ... PARTITION OF</strong> takes an <code>ACCESS EXCLUSIVE</code> lock on the parent. It is held only briefly, but it must wait for every running query on the table and blocks all new ones while waiting — run it off-peak with <code>lock_timeout</code>, or use CREATE TABLE + ATTACH PARTITION, which needs a weaker lock on the parent.</li>
<li><strong>ATTACH PARTITION</strong> takes <code>SHARE UPDATE EXCLUSIVE</code> on the parent (PG 12+), so concurrent reads and writes on other partitions continue, plus <code>ACCESS EXCLUSIVE</code> on the table being attached. It validates the bound by scanning the table unless an existing valid CHECK constraint proves it. If a DEFAULT partition exists, the default is also scanned to make sure none of its rows belong to the new range (a CHECK constraint on the default excluding that range avoids this scan).</li>
<li><strong>DETACH PARTITION</strong> (plain) takes <code>ACCESS EXCLUSIVE</code> on the parent — it waits for and blocks all queries on the table.</li>
<li><strong>DETACH PARTITION ... CONCURRENTLY</strong> (PG 14+) takes only <code>SHARE UPDATE EXCLUSIVE</code> and runs in two transactions: it marks the partition <code>inhdetachpending</code>, waits for all transactions that might see it to finish, then completes. It cannot run inside a transaction block and is <strong>not allowed when a DEFAULT partition exists</strong>. If interrupted, finish it with <code>ALTER TABLE ... DETACH PARTITION ... FINALIZE</code>.</li>
<li><strong>DROP TABLE</strong> of a partition unlinks its files at commit; WAL contains only the drop record.</li>
</ul>`,
  whenNot: `<p>Do not rely on a DEFAULT partition as a permanent dumping ground: it makes every new partition creation scan it and prevents DETACH CONCURRENTLY. Do not attach huge tables without a pre-validated CHECK constraint during peak hours. If the data has no natural "age" or tenant dimension to drop, partition maintenance brings little benefit.</p>`,
  syntax: `CREATE TABLE p_2025_11 PARTITION OF parent FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

-- attach a pre-loaded table (CHECK constraint lets PostgreSQL skip the validation scan)
CREATE TABLE p_2026_01 (LIKE parent INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE p_2026_01 ADD CONSTRAINT chk CHECK (k >= '2026-01-01' AND k < '2026-02-01');
ALTER TABLE parent ATTACH PARTITION p_2026_01 FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

ALTER TABLE parent DETACH PARTITION p_2024_01;                 -- ACCESS EXCLUSIVE on parent
ALTER TABLE parent DETACH PARTITION p_2024_01 CONCURRENTLY;    -- PG14+, no default partition, not in a txn block
ALTER TABLE parent DETACH PARTITION p_2024_01 FINALIZE;        -- complete an interrupted concurrent detach
DROP TABLE p_2024_01;`,
  examples: [
    {
      label: 'Basic',
      title: 'Retention: detach and drop the oldest month',
      sql: `SET timezone = 'UTC';
CREATE TABLE orders_part (id bigint NOT NULL, customer_id int NOT NULL, status text NOT NULL,
  order_date timestamptz NOT NULL, total_amount numeric(12,2), PRIMARY KEY (id, order_date))
  PARTITION BY RANGE (order_date);
DO $$
DECLARE m date;
BEGIN
  FOR m IN SELECT generate_series(date '2024-01-01', date '2025-12-01', interval '1 month')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF orders_part FOR VALUES FROM (%L) TO (%L)',
                   'orders_part_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
  END LOOP;
END $$;
INSERT INTO orders_part SELECT id, customer_id, status, order_date, total_amount FROM orders
WHERE order_date >= '2024-01-01';

SELECT count(*) AS before_rows FROM orders_part;

-- 1) detach: the partition becomes an ordinary table (archive it here if needed)
ALTER TABLE orders_part DETACH PARTITION orders_part_2024_01;
SELECT count(*) AS detached_rows FROM orders_part_2024_01;

-- 2) drop it: files are unlinked, no dead tuples, no VACUUM needed
DROP TABLE orders_part_2024_01;

SELECT count(*) AS after_rows FROM orders_part;`,
      explain: `<p>After detaching, <code>orders_part_2024_01</code> is a normal standalone table: you can <code>COPY</code> it to an archive, move it to another tablespace, or dump it with <code>pg_dump -t</code>. Dropping it removes 240 rows in one metadata operation. Compare this with <code>DELETE FROM orders WHERE order_date &lt; '2024-02-01'</code>, which would write a WAL record per row, leave 240 dead tuples plus dead index entries, and need VACUUM to reclaim them.</p>`,
      output: ` before_rows
-------------
        4999
 detached_rows
---------------
           240
 after_rows
------------
       4759`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Attach a pre-loaded table without a validation scan',
      sql: `SET timezone = 'UTC';
CREATE TABLE orders_part (id bigint NOT NULL, customer_id int NOT NULL, status text NOT NULL,
  order_date timestamptz NOT NULL, total_amount numeric(12,2), PRIMARY KEY (id, order_date))
  PARTITION BY RANGE (order_date);
CREATE TABLE orders_part_2025_09 PARTITION OF orders_part FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

-- 1) build the next partition OFFLINE as an ordinary table and bulk-load it
CREATE TABLE orders_part_2025_10 (LIKE orders_part INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
INSERT INTO orders_part_2025_10
SELECT id, customer_id, status, order_date, total_amount FROM orders
WHERE order_date >= '2025-10-01' AND order_date < '2025-11-01';

-- 2) a CHECK constraint matching the future bound (could be added NOT VALID + VALIDATE)
ALTER TABLE orders_part_2025_10 ADD CONSTRAINT orders_part_2025_10_bound
  CHECK (order_date >= '2025-10-01' AND order_date < '2025-11-01');

-- 3) attach: the CHECK proves the bound, so no full-table scan under lock
ALTER TABLE orders_part ATTACH PARTITION orders_part_2025_10
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

-- 4) the CHECK is now redundant with the partition constraint
ALTER TABLE orders_part_2025_10 DROP CONSTRAINT orders_part_2025_10_bound;

SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound
FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
WHERE i.inhparent = 'orders_part'::regclass ORDER BY 1;`,
      explain: `<p>This is the standard bulk-load pattern: load data into a table nobody else touches (no index maintenance overhead if you create indexes after loading, no locks on the live table), then attach. ATTACH takes only <code>SHARE UPDATE EXCLUSIVE</code> on the parent. Because the CHECK constraint already guarantees every row fits, PostgreSQL skips the validation scan; on a 100 GB partition this is the difference between milliseconds and many minutes holding an ACCESS EXCLUSIVE lock on the attached table. Indexes on the parent are automatically matched or built on the attached table.</p>`,
      output: ` relname             | bound
---------------------+--------------------------------------------------------------------------
 orders_part_2025_09 | FOR VALUES FROM ('2025-09-01 00:00:00+00') TO ('2025-10-01 00:00:00+00')
 orders_part_2025_10 | FOR VALUES FROM ('2025-10-01 00:00:00+00') TO ('2025-11-01 00:00:00+00')
(2 rows)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'The DEFAULT partition trap and how to get out of it',
      sql: `SET timezone = 'UTC';
CREATE TABLE ev (id bigint, at timestamptz NOT NULL, payload text) PARTITION BY RANGE (at);
CREATE TABLE ev_2026_02 PARTITION OF ev FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE ev_default PARTITION OF ev DEFAULT;

-- nobody created March: rows silently land in the default partition
INSERT INTO ev VALUES (1, '2026-03-05 10:00', 'early march order');
SELECT tableoid::regclass AS partition, id FROM ev;

-- CREATE TABLE ev_2026_03 PARTITION OF ev FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- would fail: updated partition constraint for default partition "ev_default"
--             would be violated by some row

-- Fix inside ONE transaction: move the rows out, create the partition, put them back
BEGIN;
CREATE TEMP TABLE ev_stray ON COMMIT DROP AS
  SELECT * FROM ev_default WHERE at >= '2026-03-01' AND at < '2026-04-01';
DELETE FROM ev_default WHERE at >= '2026-03-01' AND at < '2026-04-01';
CREATE TABLE ev_2026_03 PARTITION OF ev FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
INSERT INTO ev SELECT * FROM ev_stray;
COMMIT;

SELECT tableoid::regclass AS partition, id FROM ev;
DROP TABLE ev;`,
      explain: `<p>Creating a partition while a DEFAULT partition exists makes PostgreSQL scan the default for rows that would belong to the new range, under lock. If it finds any, the CREATE fails. The repair moves the conflicting rows out inside one transaction so readers never see them missing. On a large default partition this scan is expensive — the real fix is prevention: create partitions ahead and alert on <code>SELECT count(*) FROM ev_default</code> &gt; 0. Note also that <code>DETACH ... CONCURRENTLY</code> refuses to run while a DEFAULT partition exists (<em>cannot detach partitions concurrently when a default partition exists</em>).</p>`,
      output: ` partition  | id
------------+----
 ev_default |  1
(1 row)

BEGIN ... COMMIT

 partition  | id
------------+----
 ev_2026_03 |  1
(1 row)`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Retention by DELETE on a big table: row-by-row WAL, dead tuples, index bloat
CREATE TABLE orders_flat AS SELECT * FROM orders;
DELETE FROM orders_flat WHERE order_date < '2024-07-01';
-- this transaction's counters: every deleted row is now a dead tuple waiting for VACUUM
SELECT n_tup_del, pg_size_pretty(pg_relation_size('orders_flat')) AS size_unchanged
FROM pg_stat_xact_user_tables WHERE relname = 'orders_flat';`,
      why: 'DELETE writes a WAL record for every row, leaves every deleted row as a dead tuple plus dead index entries, and needs VACUUM to reclaim space (which still does not shrink the file).',
      run: true
    },
    good: {
      sql: `-- Retention by dropping a whole partition: metadata only
CREATE TABLE ev (id int, at date NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ev_2024_h1 PARTITION OF ev FOR VALUES FROM ('2024-01-01') TO ('2024-07-01');
CREATE TABLE ev_2024_h2 PARTITION OF ev FOR VALUES FROM ('2024-07-01') TO ('2025-01-01');
INSERT INTO ev SELECT id, order_date::date FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01';
ALTER TABLE ev DETACH PARTITION ev_2024_h1;
DROP TABLE ev_2024_h1;
SELECT count(*) FROM ev;`,
      why: 'DETACH + DROP removes the files in one step: constant time regardless of row count, no dead tuples, negligible WAL.',
      run: true
    }
  },
  mistakes: [
    'Forgetting to pre-create partitions: on the 1st of the month inserts fail (no DEFAULT) or pile up in the DEFAULT partition, which later blocks creating the proper partition.',
    'Running <code>DETACH PARTITION</code> (non-concurrent) during peak traffic: it needs ACCESS EXCLUSIVE on the parent and queues behind long queries, blocking everyone behind it. Use <code>lock_timeout</code> and retry, or <code>CONCURRENTLY</code>.',
    'Trying <code>DETACH ... CONCURRENTLY</code> inside a transaction block or on a table with a DEFAULT partition — both are rejected.',
    'Attaching a large table without a CHECK constraint that proves the bound, causing a long validation scan under lock.',
    'Dropping a partition while a long-running report still needs its data — archive first (COPY / pg_dump -t) if the data must remain queryable somewhere.'
  ],
  best: [
    'Automate: a scheduled job (pg_cron, Kubernetes CronJob, or pg_partman\'s background worker) creates N future partitions and enforces retention.',
    'Always set <code>SET lock_timeout = \'3s\'</code> in maintenance scripts and retry on failure instead of waiting indefinitely.',
    'Bulk-load into a standalone table, build indexes, add a matching CHECK constraint, then ATTACH.',
    'Monitor the DEFAULT partition row count and alert on anything &gt; 0; or avoid a DEFAULT partition entirely if you pre-create reliably.',
    'Archive before drop when regulations require it: <code>COPY (SELECT * FROM p_2024_01) TO ...</code> or <code>pg_dump -t p_2024_01</code>.'
  ],
  performance: `<p>DROP of a detached partition is O(1) regardless of size. ATTACH with a proving CHECK constraint is O(1); without it O(rows). Creating many partitions at once inflates catalog size and relcache memory per backend — creating 3–7 periods ahead is usually enough. After attaching a bulk-loaded table, run <code>ANALYZE</code> on it (and on the parent, because parent-level statistics are not maintained by autovacuum).</p>`,
  security: `<p>Detached partitions keep their own privileges; a detached table can be accidentally readable by roles that had direct grants on it. Drop or revoke promptly. Maintenance jobs need ownership of the parent table — run them as the table owner role, not as a superuser.</p>`,
  scenario: {
    title: 'Monthly partition job missed: orders pile up in the default partition',
    steps: [
      '1. Alert fires: count(*) in orders_default = 1.2M rows on the 3rd of the month; the cron host was decommissioned.',
      '2. Assess: CREATE TABLE orders_2025_11 PARTITION OF ... fails because the default holds November rows.',
      '3. Plan a short window. SET lock_timeout = \'5s\'.',
      '4. In one transaction: create orders_2025_11_new as a standalone table, INSERT the November rows from the default into it, DELETE them from the default.',
      '5. Still in the transaction: ADD a CHECK constraint on orders_2025_11_new matching the bound, ATTACH it (the default is scanned once more, now with no conflicting rows).',
      '6. COMMIT, VACUUM orders_default to clean up the 1.2M dead tuples, ANALYZE orders.',
      '7. Move partition creation into the database (pg_cron or pg_partman) and keep 3 months pre-created.'
    ]
  },
  widgets: ['diagram:partitioning', 'lab:partition'],
  interview: [
    { q: 'How do you remove a month of data from a 5 TB partitioned table with minimal impact?', a: 'DETACH PARTITION (CONCURRENTLY on PG 14+ if there is no default partition, otherwise with lock_timeout and retries), optionally archive the detached table, then DROP TABLE. It is constant time, writes almost no WAL, creates no dead tuples and needs no VACUUM — unlike DELETE.' },
    { q: 'Why add a CHECK constraint before ATTACH PARTITION?', a: 'ATTACH must prove every row satisfies the new partition bound. If a valid CHECK constraint already implies the bound, PostgreSQL skips the full scan, making ATTACH nearly instant and reducing the time locks are held.' },
    { q: 'What are the restrictions of DETACH PARTITION CONCURRENTLY?', a: 'It requires PG 14+, cannot run inside a transaction block, is not allowed if the table has a DEFAULT partition, and runs as two transactions; if the session is cancelled midway the partition stays in a "detach pending" state and must be completed with ALTER TABLE ... DETACH PARTITION ... FINALIZE.' },
    { q: 'Is pg_partman part of PostgreSQL?', a: 'No. pg_partman is a third-party extension that automates creating future partitions and enforcing retention for native declarative partitioning. Core PostgreSQL provides the DDL; scheduling must come from pg_partman\'s background worker, pg_cron, or an external scheduler.' }
  ],
  exercises: [
    {
      task: 'Write a PL/pgSQL function create_month_partitions(parent regclass, start_month date, n int) that creates n monthly partitions named parent_YYYY_MM if they do not exist, and use it on a new RANGE-partitioned table.',
      solution: `CREATE TABLE ev (id int, at timestamptz NOT NULL) PARTITION BY RANGE (at);

CREATE FUNCTION create_month_partitions(parent regclass, start_month date, n int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE m date; created int := 0; part text;
BEGIN
  FOR i IN 0 .. n - 1 LOOP
    m := (date_trunc('month', start_month) + make_interval(months => i))::date;
    part := parent::text || '_' || to_char(m, 'YYYY_MM');
    IF to_regclass(part) IS NULL THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                     part, parent, m, (m + interval '1 month')::date);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

SELECT create_month_partitions('ev', '2026-01-01', 3) AS first_run,
       create_month_partitions('ev', '2026-01-01', 4) AS second_run;`,
      run: true
    },
    {
      task: 'Detach the oldest partition of a two-partition table, prove it still holds its rows as a standalone table, then drop it.',
      solution: `CREATE TABLE ev (id int, at date NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ev_2025_01 PARTITION OF ev FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE ev_2025_02 PARTITION OF ev FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
INSERT INTO ev SELECT id, order_date::date FROM orders WHERE order_date >= '2025-01-02' AND order_date < '2025-02-28';
ALTER TABLE ev DETACH PARTITION ev_2025_01;
SELECT (SELECT count(*) FROM ev) AS still_attached, (SELECT count(*) FROM ev_2025_01) AS detached;
DROP TABLE ev_2025_01;`,
      run: true
    }
  ],
  challenge: {
    task: 'Write a retention function drop_partitions_older_than(parent regclass, keep_before date) that finds leaf partitions whose upper bound is &lt;= keep_before (read the bound from pg_class.relpartbound), detaches and drops them, and returns the names dropped. Test it on monthly partitions for 2024.',
    hint: 'pg_get_expr(relpartbound, oid) returns text like FOR VALUES FROM (\'2024-01-01\') TO (\'2024-02-01\'); substring(... from \'TO \\(\'\'([^\'\']+)\') extracts the upper bound. Skip the DEFAULT partition (its bound text is DEFAULT).',
    solution: `CREATE TABLE ev (id int, at date NOT NULL) PARTITION BY RANGE (at);
DO $$
DECLARE m date;
BEGIN
  FOR m IN SELECT generate_series(date '2024-01-01', date '2024-12-01', interval '1 month')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF ev FOR VALUES FROM (%L) TO (%L)',
                   'ev_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
  END LOOP;
END $$;

CREATE FUNCTION drop_partitions_older_than(parent regclass, keep_before date)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE r record; part_name text;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS part,
           substring(pg_get_expr(c.relpartbound, c.oid) FROM 'TO \\(''([^'']+)''\\)')::date AS upper_bound
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = parent
      AND pg_get_expr(c.relpartbound, c.oid) <> 'DEFAULT'
  LOOP
    IF r.upper_bound <= keep_before THEN
      part_name := r.part::text;            -- capture the name before the table disappears
      EXECUTE format('ALTER TABLE %s DETACH PARTITION %s', parent, r.part);
      EXECUTE format('DROP TABLE %s', r.part);
      RETURN NEXT part_name;
    END IF;
  END LOOP;
END $$;

SELECT * FROM drop_partitions_older_than('ev', '2024-04-01');
SELECT count(*) AS remaining_partitions FROM pg_inherits WHERE inhparent = 'ev'::regclass;`,
    run: true
  },
  related: ['partitioning-declarative-basics', 'partitioning-pruning-indexes', 'partitioning-strategy', 'vacuum', 'locks'],
  quiz: [
    { type: 'mcq', q: 'Which statement removes a month of data with the least WAL and no dead tuples?', options: ['DELETE FROM orders WHERE ...', 'TRUNCATE orders', 'ALTER TABLE orders DETACH PARTITION orders_2024_01; DROP TABLE orders_2024_01;', 'VACUUM FULL orders'], answer: 2, explain: 'Detaching and dropping a partition is a metadata operation that unlinks the files. DELETE is row-by-row, TRUNCATE would empty the whole table, VACUUM FULL deletes nothing.' },
    { type: 'tf', q: 'ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY can be used even if the table has a DEFAULT partition.', answer: false, explain: 'PostgreSQL rejects it: "cannot detach partitions concurrently when a default partition exists".' },
    { type: 'scenario', q: 'CREATE TABLE orders_2025_11 PARTITION OF orders ... fails with "updated partition constraint for default partition would be violated by some row". What is the correct fix?', options: ['Drop the default partition with its rows', 'In one transaction move November rows out of the default, create the partition, re-insert them', 'Use DETACH CONCURRENTLY on the default', 'Increase max_locks_per_transaction'], answer: 1, explain: 'The default holds rows that belong to the new range. Move them out, create the partition, and route them back, all in one transaction.' },
    { type: 'optimize', q: 'You must attach a 200 GB pre-loaded table as a partition during business hours. What avoids a long validation scan?', options: ['Run ANALYZE first', 'Add a CHECK constraint matching the partition bound before ATTACH', 'Use CREATE INDEX CONCURRENTLY first', 'Set enable_partition_pruning = off'], answer: 1, explain: 'A valid CHECK constraint that implies the bound lets ATTACH skip scanning the table.' }
  ]
},
{
  id: 'partitioning-strategy',
  module: 'partitioning',
  title: 'Partitioning Strategy: When to Partition, When Not To, and Partitioning vs Sharding',
  level: 4,
  minutes: 20,
  summary: 'Decide whether partitioning helps, choose key and granularity, avoid the "too many partitions" trap, and understand how partitioning differs from sharding and Citus.',
  objectives: [
    'Evaluate a table against concrete criteria (size, retention, key in queries) before partitioning',
    'Choose a partition key and granularity (daily, monthly, hash N) with numbers',
    'Measure the planning and execution overhead of too many partitions and of queries without the key',
    'Explain the difference between partitioning (one node), sharding (many nodes) and Citus (an extension)',
    'Write monitoring queries for partition sizes and counts'
  ],
  concept: `<p>Partitioning is a <strong>data-lifecycle and maintenance tool first</strong>, and a query-performance tool second. It shines when there is a clear dimension along which data is added, queried and removed — almost always time, sometimes tenant or region.</p>
<h4>A practical checklist</h4>
<ul>
<li><strong>Size</strong>: the table is (or will soon be) larger than RAM, typically &gt; 100 GB, or has &gt; ~100M rows.</li>
<li><strong>Retention</strong>: you delete old data regularly — partitioning turns that into DROP.</li>
<li><strong>Key in queries</strong>: the large majority of hot queries filter on the candidate key.</li>
<li><strong>Maintenance pain</strong>: VACUUM of the whole table takes hours, or index rebuilds are impossible.</li>
</ul>
<p>If fewer than two of these are true, an index, a BRIN index, a partial index or archiving is usually the better answer.</p>
<h4>Granularity</h4>
<p>Aim for partitions of a few GB to a few tens of GB and a total count in the tens to low hundreds. Example: 2M rows/day × 200 bytes ≈ 400 MB/day → monthly partitions of ~12 GB are ideal; daily partitions would give 365 small tables per year with no real benefit and much more planning overhead.</p>
<h4>Partitioning vs sharding vs Citus</h4>
<ul>
<li><strong>Partitioning</strong> <span class="tag core">core</span>: splits a table into pieces <em>on one server</em>. CPU, RAM, disk and WAL are still one machine's.</li>
<li><strong>Sharding</strong>: splits data across <em>multiple servers</em>, each holding a subset; requires routing (application, proxy or extension) and handling cross-shard queries and transactions.</li>
<li><strong>Citus</strong> <span class="tag ext">extension</span>: an open-source extension that turns PostgreSQL into a distributed database: a coordinator distributes tables by a distribution column into shards (which are regular tables) on worker nodes and parallelises queries. It is not native partitioning, although you can combine both (a distributed table whose shards are time-partitioned).</li>
</ul>
<p>Analogy: partitioning is organising one warehouse into aisles; sharding is building more warehouses in different cities and routing each order to the right one.</p>`,
  why: `<p>Partitioning has real costs: more objects to manage, more planning work, no global unique indexes, foreign keys and uniqueness tied to the partition key, and row movement on key updates. Choosing it for the wrong table makes everything slower; choosing it too late makes migration painful. This lesson gives you the decision framework.</p>`,
  useCase: `<p>A fintech had three candidate tables: <code>transactions</code> (3 TB, append-only, 7-year retention, always queried by date range) → partitioned monthly, huge win. <code>accounts</code> (40 GB, 20M rows, queried by <code>account_id</code>, never deleted) → <em>not</em> partitioned; a B-tree on the PK is optimal. <code>events</code> (900 GB/month, 14-day retention, write-heavy) → daily partitions (14–20 live), dropping one per day. Later, when write volume exceeded one server's WAL throughput, they moved <code>transactions</code> to Citus, distributing by <code>account_id</code> while keeping monthly time partitions inside each shard.</p>`,
  internals: `<ul>
<li><strong>Planning cost</strong> grows with the number of partitions that survive pruning — and with all of them when the query has no key predicate. Each partition adds a scan path, index paths, and relcache entries.</li>
<li><strong>Locking</strong>: a query touching N partitions takes N+ relation locks (plus their indexes). The fast-path lock slots per backend are limited, so queries spanning hundreds of partitions spill into the shared lock table and can contend on the lock manager (PG 18 increased fast-path capacity, which helps).</li>
<li><strong>Partitionwise join/aggregate</strong> (<code>enable_partitionwise_join</code>, <code>enable_partitionwise_aggregate</code>, both off by default) let the planner join or aggregate partition by partition when two tables share identical partition bounds — useful for very large aligned tables but increases planning time.</li>
<li><strong>Foreign keys</strong>: partitioned tables can reference and be referenced (PG 12+), but referencing a partitioned table requires a unique key on it, which must include its partition key.</li>
</ul>`,
  whenNot: `<ul>
<li>Small or medium tables (&lt; ~50 GB) that fit in memory — indexes already do the job.</li>
<li>Tables whose queries mostly do <em>not</em> filter by the candidate key: each query fans out to every partition.</li>
<li>To "speed up" point lookups by primary key — a B-tree lookup on 1 billion rows is ~4 page reads; partitioning cannot beat that.</li>
<li>Thousands of tiny partitions (e.g. hourly for years, or one per small tenant).</li>
<li>When the actual bottleneck is a single server's CPU, write throughput or storage — that needs read replicas, sharding or Citus, not partitioning.</li>
</ul>`,
  syntax: `-- decision helpers
SELECT pg_size_pretty(pg_total_relation_size('orders'));
SELECT relid, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_partition_tree('orders_part') WHERE isleaf;

SET enable_partitionwise_join = on;        -- default off
SET enable_partitionwise_aggregate = on;   -- default off

-- Citus (extension, distributed): not runnable here
-- CREATE EXTENSION citus;
-- SELECT create_distributed_table('orders', 'customer_id');`,
  examples: [
    {
      label: 'Basic',
      title: 'Partition inventory: sizes, rows and share of total',
      sql: `SET timezone = 'UTC';
CREATE TABLE orders_part (id bigint NOT NULL, customer_id int NOT NULL, status text NOT NULL,
  order_date timestamptz NOT NULL, total_amount numeric(12,2), PRIMARY KEY (id, order_date))
  PARTITION BY RANGE (order_date);
CREATE TABLE orders_part_2024 PARTITION OF orders_part FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE orders_part_2025 PARTITION OF orders_part FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE orders_part_default PARTITION OF orders_part DEFAULT;
INSERT INTO orders_part SELECT id, customer_id, status, order_date, total_amount FROM orders;

SELECT t.relid                                       AS partition,
       pg_get_expr(c.relpartbound, c.oid)            AS bound,
       (SELECT count(*) FROM orders_part o WHERE o.tableoid = t.relid) AS rows,
       pg_size_pretty(pg_total_relation_size(t.relid)) AS total_size
FROM pg_partition_tree('orders_part') t
JOIN pg_class c ON c.oid = t.relid
WHERE t.isleaf
ORDER BY 1::text;`,
      explain: `<p>This is the kind of inventory query you run before and after a partitioning change and in monitoring: it lists each leaf, its bound, row count and on-disk size (heap + indexes + TOAST). In production replace the exact <code>count(*)</code> with <code>pg_class.reltuples</code> or <code>pg_stat_user_tables.n_live_tup</code> to avoid scanning terabytes. A non-empty DEFAULT partition is an immediate red flag.</p>`,
      output: ` partition           | bound                                                         | rows | total_size
---------------------+---------------------------------------------------------------+------+------------
 orders_part_2024    | FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2025-01-01 ...') | 2903 | 368 kB
 orders_part_2025    | FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 ...') | 2096 | 272 kB
 orders_part_default | DEFAULT                                                       |    1 | 32 kB
(3 rows)   -- sizes are approximate`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'The cost of too many partitions (365 daily partitions for 2,096 rows)',
      sql: `SET timezone = 'UTC';
CREATE TABLE ev_daily (id bigint, customer_id int, at timestamptz NOT NULL) PARTITION BY RANGE (at);
DO $$
DECLARE d date;
BEGIN
  FOR d IN SELECT generate_series(date '2025-01-01', date '2025-12-31', interval '1 day')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF ev_daily FOR VALUES FROM (%L) TO (%L)',
                   'ev_daily_' || to_char(d, 'YYYYMMDD'), d, d + 1);
  END LOOP;
END $$;
CREATE INDEX ON ev_daily (customer_id);
INSERT INTO ev_daily SELECT id, customer_id, order_date FROM orders WHERE order_date >= '2025-01-01';
ANALYZE ev_daily;

-- WITH the key: pruned to one partition
EXPLAIN (SUMMARY ON, COSTS OFF)
SELECT * FROM ev_daily WHERE at >= '2025-06-10' AND at < '2025-06-11';

-- WITHOUT the key: all 365 partitions planned and executed
EXPLAIN (ANALYZE, SUMMARY ON, COSTS OFF, TIMING OFF, BUFFERS OFF)
SELECT * FROM ev_daily WHERE customer_id = 42;

SELECT pg_size_pretty(sum(pg_total_relation_size(relid))) AS footprint
FROM pg_partition_tree('ev_daily');`,
      explain: `<p>365 partitions holding only 2,096 rows. A query on the key prunes nicely, but a lookup by <code>customer_id</code> must plan and execute 365 scans: planning took ~50–100 ms and execution ~30–50 ms in this environment, versus ~0.6 ms / ~1 ms for the same query on an unpartitioned table with one index (see the comparison below). The footprint is ~7 MB for data that would fit in 3 pages, because every partition has at least one heap page plus index metapages. Timings vary by machine; the ratio is the lesson.</p>`,
      output: `-- with the key
 Seq Scan on ev_daily_20250610 ev_daily
   Filter: ((at >= '2025-06-10 00:00:00+00'::timestamp with time zone) AND ...)
 Planning Time: ~6 ms

-- without the key (abbreviated)
 Append (actual rows=4.00 loops=1)
   ->  Seq Scan on ev_daily_20250101 ev_daily_1 (actual rows=0.00 loops=1)
   ... 364 more partition scans ...
 Planning Time: ~50-100 ms
 Execution Time: ~30-50 ms

 footprint
-----------
 7304 kB`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Same lookup on an unpartitioned table with a proper index',
      sql: `CREATE TABLE orders_flat AS
SELECT id, customer_id, order_date FROM orders;
CREATE INDEX ON orders_flat (customer_id);
ANALYZE orders_flat;

EXPLAIN (ANALYZE, SUMMARY ON, COSTS OFF, TIMING OFF, BUFFERS OFF)
SELECT * FROM orders_flat WHERE customer_id = 42;`,
      explain: `<p>One B-tree probe, 8 heap pages, sub-millisecond planning and execution, on <em>more</em> data (5,000 rows, all years) than the partitioned version. This is why "partition to make lookups faster" is usually wrong: B-trees already give logarithmic access. Partitioning helps lookups only when it lets you skip most data <em>and</em> the per-partition structures become meaningfully smaller and hotter — typically at hundreds of GB.</p>`,
      output: ` Bitmap Heap Scan on orders_flat (actual rows=10.00 loops=1)
   Recheck Cond: (customer_id = 42)
   Heap Blocks: exact=8
   ->  Bitmap Index Scan on orders_flat_customer_id_idx (actual rows=10.00 loops=1)
         Index Cond: (customer_id = 42)
         Index Searches: 1
 Planning Time: ~0.6 ms
 Execution Time: ~1.0 ms`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Partitioning a tiny lookup table: 8 rows split into 4 hash partitions
CREATE TABLE dept_hashed (id int, name text) PARTITION BY HASH (id);
CREATE TABLE dept_hashed_0 PARTITION OF dept_hashed FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE dept_hashed_1 PARTITION OF dept_hashed FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE dept_hashed_2 PARTITION OF dept_hashed FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE dept_hashed_3 PARTITION OF dept_hashed FOR VALUES WITH (MODULUS 4, REMAINDER 3);
INSERT INTO dept_hashed SELECT id, name FROM departments;
EXPLAIN (COSTS OFF) SELECT * FROM dept_hashed WHERE name = 'Sales';`,
      why: 'Four tables, four scans and extra planning for 8 rows that fit in one page. Partitioning adds overhead and removes nothing.',
      run: true
    },
    good: {
      sql: `-- Plain table: 8 rows in one page, one scan, no extra planning
EXPLAIN (COSTS OFF) SELECT * FROM departments WHERE name = 'Sales';`,
      why: 'One table, one page: for 8 rows the planner rightly reads the single heap page (a sequential scan); for larger tables the UNIQUE index on name gives a direct lookup. Small tables never need partitioning.',
      run: true
    }
  },
  mistakes: [
    'Partitioning by a column that most queries do not filter on (e.g. partitioning by date while the API looks up by customer_id) — every query fans out to all partitions.',
    'Choosing too fine a granularity (hourly/daily for years) and ending up with thousands of partitions, slow planning and lock-manager contention.',
    'Expecting partitioning to scale writes beyond one server — all partitions share the same WAL, CPU and disk. That is a sharding/Citus problem.',
    'Calling Citus "PostgreSQL native sharding" — it is an extension (open source, also offered as a managed service), not part of core.',
    'Forgetting that parent-level statistics are not collected by autovacuum: run ANALYZE on the partitioned parent periodically for queries that span partitions.'
  ],
  best: [
    'Write down the decision: table size and growth, retention rule, % of query time filtering by the key, target partition size and count.',
    'Prefer time-based RANGE for event/transaction data; LIST for a few big tenants/regions; HASH only for even spreading with equality lookups.',
    'Target partitions of a few GB to tens of GB and keep the count in the low hundreds.',
    'Prototype with production-like data and verify with EXPLAIN (ANALYZE, SUMMARY) that planning time stays small.',
    'Consider BRIN indexes on append-only timestamp columns before partitioning purely for query speed.'
  ],
  performance: `<p>Gains: pruning, smaller and hotter indexes, cheap retention, per-partition VACUUM. Costs: planning time proportional to surviving partitions, more relation locks per query, more relcache memory per backend, no global indexes, row movement on key updates. Measure both sides; the break-even point is typically reached only for tables of tens to hundreds of GB.</p>`,
  security: `<p>LIST partitioning by tenant can support data isolation strategies (dumping or dropping one tenant\'s data is easy), but it is not an access-control mechanism: use roles, grants and RLS on the parent. Partition names visible in EXPLAIN can disclose tenant identifiers.</p>`,
  scenario: {
    title: 'Should we partition? A design review for three tables',
    steps: [
      '1. Gather facts per table: pg_total_relation_size, rows/day, retention requirement, top queries by total time (pg_stat_statements) and their WHERE clauses.',
      '2. transactions: 3 TB, 7-year retention, 95% of query time filters by created_at -&gt; RANGE monthly (84 partitions, ~35 GB each).',
      '3. accounts: 40 GB, no deletes, lookups by id -&gt; do not partition; ensure PK/indexes and enough RAM.',
      '4. events: 30 GB/day, 14-day retention -&gt; RANGE daily, 14–21 partitions, drop one per day.',
      '5. Validate with a staging copy: EXPLAIN shows pruning for top queries, planning time &lt; 5 ms.',
      '6. Revisit when write volume approaches one server\'s limits: evaluate Citus (distribute by account_id) or application-level sharding.'
    ]
  },
  widgets: ['diagram:partitioning', 'diagram:sharding', 'diagram:citus'],
  interview: [
    { q: 'Give three situations where you would NOT partition a table.', a: 'A table under ~50 GB that fits in memory; a table whose main queries do not filter on any candidate key (they would scan all partitions); and when the bottleneck is server capacity (CPU/WAL/disk), which partitioning does not change because all partitions share one server. Also avoid thousands of tiny partitions.' },
    { q: 'What is the difference between partitioning and sharding?', a: 'Partitioning splits a table into multiple tables within a single PostgreSQL instance, mainly for maintenance and pruning. Sharding distributes data across multiple servers so that storage, CPU and write throughput scale out; it requires routing and has to deal with cross-shard queries and distributed transactions.' },
    { q: 'How does Citus relate to native partitioning?', a: 'Citus is an extension, not core PostgreSQL. It distributes a table by a distribution column into shards placed on worker nodes and routes/parallelises queries via a coordinator. It is orthogonal to declarative partitioning: a distributed table can also be time-partitioned so each shard has its own time partitions.' },
    { q: 'How do you choose partition granularity?', a: 'From data volume and retention: aim for partitions of a few GB to tens of GB and keep the total count in the tens to low hundreds. E.g. 400 MB/day suggests monthly partitions (~12 GB); a 14-day retention with 30 GB/day suggests daily partitions so one can be dropped per day.' }
  ],
  exercises: [
    {
      task: 'Write a query that, for a partitioned table, returns each leaf partition with its bound and its estimated row count from pg_class.reltuples (cheap, no scan). Run ANALYZE first so the estimates exist.',
      solution: `CREATE TABLE ev (id int, at date NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ev_2024 PARTITION OF ev FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE ev_2025 PARTITION OF ev FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
INSERT INTO ev SELECT id, order_date::date FROM orders WHERE order_date >= '2024-01-02';
ANALYZE ev;
SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound, c.reltuples::bigint AS est_rows
FROM pg_partition_tree('ev') t JOIN pg_class c ON c.oid = t.relid
WHERE t.isleaf ORDER BY 1;`,
      run: true
    },
    {
      task: 'Compare the plan of an aggregate over two identically partitioned tables with enable_partitionwise_aggregate off and on.',
      solution: `CREATE TABLE ev (id int, at date NOT NULL, amount numeric) PARTITION BY RANGE (at);
CREATE TABLE ev_2024 PARTITION OF ev FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE ev_2025 PARTITION OF ev FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
INSERT INTO ev SELECT id, order_date::date, total_amount FROM orders WHERE order_date >= '2024-01-02';
ANALYZE ev;
EXPLAIN (COSTS OFF) SELECT at, sum(amount) FROM ev GROUP BY at;
SET enable_partitionwise_aggregate = on;
EXPLAIN (COSTS OFF) SELECT at, sum(amount) FROM ev GROUP BY at;`,
      run: true
    }
  ],
  challenge: {
    task: 'Write a "partition health" query for a monthly-partitioned table that flags: (a) rows in the DEFAULT partition, (b) whether a partition exists for next month, and (c) the number of partitions. Use the orders_part monthly design with partitions only up to 2025-10.',
    hint: 'Use pg_partition_tree() for counts, tableoid for the default row count, and a check like EXISTS (... bound covering date_trunc(\'month\', DATE \'2025-10-15\') + interval \'1 month\').',
    solution: `SET timezone = 'UTC';
CREATE TABLE orders_part (id bigint NOT NULL, order_date timestamptz NOT NULL, PRIMARY KEY (id, order_date))
  PARTITION BY RANGE (order_date);
DO $$
DECLARE m date;
BEGIN
  FOR m IN SELECT generate_series(date '2025-07-01', date '2025-10-01', interval '1 month')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF orders_part FOR VALUES FROM (%L) TO (%L)',
                   'orders_part_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
  END LOOP;
END $$;
CREATE TABLE orders_part_default PARTITION OF orders_part DEFAULT;
INSERT INTO orders_part SELECT id, order_date FROM orders WHERE order_date >= '2025-07-01';
INSERT INTO orders_part VALUES (999999, '2025-11-03');   -- a row that arrived "too early"

SELECT
  (SELECT count(*) FROM pg_partition_tree('orders_part') WHERE isleaf)                   AS partitions,
  (SELECT count(*) FROM orders_part WHERE tableoid = 'orders_part_default'::regclass)    AS rows_in_default,
  to_regclass('orders_part_' || to_char(date '2025-10-15' + interval '1 month', 'YYYY_MM')) IS NOT NULL
                                                                                          AS next_month_exists;`,
    run: true
  },
  related: ['partitioning-declarative-basics', 'partitioning-pruning-indexes', 'partitioning-maintenance', 'sharding', 'scaling'],
  quiz: [
    { type: 'design', q: 'A 30 GB customers table is queried by customer_id and email; rows are never deleted. Best approach?', options: ['HASH partition by customer_id into 64 partitions', 'RANGE partition by created_at', 'Keep it unpartitioned with proper B-tree indexes', 'Shard it with Citus immediately'], answer: 2, explain: 'Small, lookup-heavy, no retention: indexes are optimal; partitioning adds overhead and complicates the unique constraint on email.' },
    { type: 'tf', q: 'Partitioning a table across 12 partitions lets PostgreSQL use 12 servers.', answer: false, explain: 'All partitions live in the same instance. Spreading data across servers is sharding (application-level, or an extension such as Citus).' },
    { type: 'mcq', q: 'Which is the main symptom of having far too many partitions?', options: ['Inserts fail', 'High planning time and lock overhead, especially for queries without the partition key', 'VACUUM stops working', 'Indexes become invalid'], answer: 1, explain: 'Planning and locking scale with the number of partitions considered; queries without the key consider all of them.' },
    { type: 'mcq', q: 'Citus is best described as:', options: ['A core PostgreSQL partitioning method', 'A PostgreSQL extension that distributes tables across nodes', 'A connection pooler', 'A backup tool'], answer: 1, explain: 'Citus is an extension that turns PostgreSQL into a distributed database with a coordinator and worker nodes.' },
    { type: 'scenario', q: 'Events: 30 GB/day, kept 14 days, always queried for "last 24 hours". Which design?', options: ['Monthly RANGE partitions', 'Daily RANGE partitions, drop the oldest daily', 'HASH by event_id', 'No partitioning, nightly DELETE'], answer: 1, explain: 'Daily partitions give ~15 live partitions of ~30 GB, prune "last 24h" to 1–2 partitions, and make retention a daily DROP.' }
  ]
}
]);

PGM.addLessons([
/* ===================================================================
   MODULE: concurrency
   =================================================================== */
{
  id: 'concurrency-problems-locking-strategies',
  module: 'concurrency',
  title: 'Concurrency Problems: Lost Updates, Races, Optimistic vs Pessimistic Locking',
  level: 4,
  minutes: 22,
  summary: 'Why read-modify-write code loses updates under concurrency, and the three correct fixes: atomic UPDATE, pessimistic row locks, and optimistic version columns.',
  objectives: [
    'Reproduce on a timeline how a lost update happens under READ COMMITTED',
    'Fix inventory decrements with a single atomic conditional UPDATE',
    'Implement pessimistic locking with SELECT ... FOR UPDATE',
    'Implement optimistic locking with a version column and detect conflicts via the affected row count',
    'Choose between the strategies based on contention, latency and user-think time'
  ],
  concept: `<p>A <strong>race condition</strong> happens when the result depends on the timing of concurrent transactions. The classic database race is the <strong>lost update</strong>: two transactions read the same value, both compute a new value in the application, and both write — the second write silently overwrites the first.</p>
<table>
<tr><th>Time</th><th>Session A (order #1)</th><th>Session B (order #2)</th></tr>
<tr><td>t1</td><td><code>SELECT stock FROM products WHERE id=5</code> → 10</td><td></td></tr>
<tr><td>t2</td><td></td><td><code>SELECT stock FROM products WHERE id=5</code> → 10</td></tr>
<tr><td>t3</td><td>app computes 10 − 3 = 7; <code>UPDATE ... SET stock = 7</code></td><td></td></tr>
<tr><td>t4</td><td>COMMIT</td><td>app computes 10 − 4 = 6; <code>UPDATE ... SET stock = 6</code></td></tr>
<tr><td>t5</td><td></td><td>COMMIT → stock = 6, but 7 units were sold: <strong>3 units vanished</strong></td></tr>
</table>
<p>Analogy: two cashiers share one notebook with the cash total. Both read "₹10,000", both add their own sale on scratch paper, and both write their result in the notebook. One sale disappears. The fixes are: (1) do the arithmetic <em>in the notebook</em> in one step (atomic UPDATE); (2) grab the notebook and keep it until done (<strong>pessimistic</strong> locking, <code>SELECT ... FOR UPDATE</code>); or (3) write a page number next to the total and refuse to write if the page number changed since you read it (<strong>optimistic</strong> locking, version column).</p>
<ul>
<li><strong>Atomic update</strong>: <code>UPDATE products SET stock = stock - 3 WHERE id = 5 AND stock &gt;= 3</code>. The row is locked during the update and the expression is evaluated on the latest committed version — no lost update, no oversell.</li>
<li><strong>Pessimistic</strong>: lock first (<code>FOR UPDATE</code>), then read, decide, write. Others wait. Best when conflicts are likely and the transaction is short.</li>
<li><strong>Optimistic</strong>: read without locks along with a <code>version</code>; write with <code>WHERE id = $1 AND version = $2</code>, incrementing the version. 0 rows updated = someone else changed it; retry or report a conflict. Best when conflicts are rare or when a human "think time" sits between read and write (edit forms).</li>
</ul>`,
  why: `<p>PostgreSQL's default isolation level, READ COMMITTED, does not prevent lost updates for read-modify-write done in application code: each statement sees the latest committed data, but nothing ties the earlier SELECT to the later UPDATE. Under load this produces overselling, wrong balances and double-booked seats — bugs that never show up in single-user tests.</p>`,
  useCase: `<p>A flash sale sells 5,000 phones in 90 seconds with ~1,200 checkout requests per second. The original code did <code>SELECT stock</code> → check in Java → <code>UPDATE SET stock = :newValue</code>; the shop sold 5,312 phones. The fix was a single statement: <code>UPDATE products SET stock = stock - :qty WHERE id = :id AND stock &gt;= :qty RETURNING stock</code>; if it returns no row, the item is sold out. Oversell dropped to zero and throughput increased because there was one round trip instead of two. The admin "edit product" form, where an editor may keep a page open for 10 minutes, uses optimistic locking with a <code>version</code> column instead of holding row locks.</p>`,
  internals: `<ul>
<li>Under READ COMMITTED, when an UPDATE finds that its target row was updated by a concurrent transaction that has since committed, PostgreSQL waits for that transaction, then re-reads the <em>newest</em> version of the row and re-checks the WHERE clause (the "EvalPlanQual" recheck). That is why <code>SET stock = stock - 3 WHERE stock &gt;= 3</code> is safe: the arithmetic and the condition are evaluated on the latest version.</li>
<li>A row being updated is locked via its tuple header (<code>xmax</code> = updater's XID); waiters block on the updater's transaction ID lock, not on a per-row entry in shared memory.</li>
<li>The application-side read-modify-write is unsafe because <code>SET stock = 7</code> contains a constant computed from a stale read — the recheck finds the row still matches <code>WHERE id = 5</code> and overwrites.</li>
<li>Under REPEATABLE READ or SERIALIZABLE, the second writer would instead get <em>could not serialize access due to concurrent update</em> and must retry.</li>
</ul>`,
  whenNot: `<p>Do not hold pessimistic locks across user think time, network calls to payment providers, or long computations — you turn a race into a queue and can exhaust connections. Do not use optimistic locking on extremely hot rows (a global counter): almost every attempt conflicts and retries waste work — use an atomic UPDATE, or shard the counter. Do not use SERIALIZABLE just to fix one counter; an atomic UPDATE is simpler and cheaper.</p>`,
  syntax: `-- atomic, conditional
UPDATE t SET qty = qty - $1 WHERE id = $2 AND qty >= $1 RETURNING qty;

-- pessimistic
BEGIN;
SELECT ... FROM t WHERE id = $1 FOR UPDATE;
UPDATE t SET ... WHERE id = $1;
COMMIT;

-- optimistic
UPDATE t SET col = $new, version = version + 1
WHERE id = $id AND version = $version_read;    -- 0 rows => conflict`,
  examples: [
    {
      label: 'Basic',
      title: 'Atomic, oversell-proof stock decrement',
      sql: `-- current stock of product 5
SELECT id, name, stock FROM products WHERE id = 5;

-- decrement only if enough stock remains; RETURNING tells us if it worked
UPDATE products
SET    stock = stock - 2
WHERE  id = 5 AND stock >= 2
RETURNING id, stock AS remaining;

-- asking for more than available updates 0 rows: treat as "sold out"
UPDATE products
SET    stock = stock - 100000
WHERE  id = 5 AND stock >= 100000
RETURNING id, stock AS remaining;`,
      explain: `<p>The check (<code>stock &gt;= 2</code>) and the change (<code>stock - 2</code>) happen in one statement on the row version the UPDATE has locked. If another session decremented concurrently, this UPDATE waits, then re-evaluates both expressions on the new version (EvalPlanQual). An empty RETURNING result means the condition failed — the application reports "insufficient stock" instead of overselling. One round trip, no explicit locking code.</p>`,
      output: ` id | name         | stock
----+--------------+-------
  5 | Webcam Pro 5 |   159

 id | remaining
----+-----------
  5 |       157

 id | remaining
----+-----------
(0 rows)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Pessimistic locking: transfer between two accounts',
      sql: `CREATE TABLE accounts_demo (id int PRIMARY KEY, owner text, balance numeric(12,2) CHECK (balance >= 0));
INSERT INTO accounts_demo VALUES (1, 'Asha', 500.00), (2, 'Bilal', 120.00);

BEGIN;
-- lock BOTH rows up front, in a deterministic order (by id) to avoid deadlocks
SELECT id, owner, balance FROM accounts_demo
WHERE id IN (1, 2) ORDER BY id
FOR UPDATE;

-- business logic in between is safe: nobody else can change these rows now
UPDATE accounts_demo SET balance = balance - 200 WHERE id = 1;
UPDATE accounts_demo SET balance = balance + 200 WHERE id = 2;
COMMIT;

SELECT id, owner, balance FROM accounts_demo ORDER BY id;`,
      explain: `<p><code>FOR UPDATE</code> locks the selected rows until COMMIT/ROLLBACK. A concurrent transfer touching either account blocks at its own <code>FOR UPDATE</code> until this one finishes, then reads the committed new balances. Locking with <code>ORDER BY id</code> means every transaction acquires locks in the same order, which prevents the A-waits-for-B, B-waits-for-A deadlock. The CHECK constraint is a final safety net against negative balances.</p>`,
      output: ` id | owner | balance
----+-------+---------
  1 | Asha  |  500.00
  2 | Bilal |  120.00

 id | owner | balance
----+-------+---------
  1 | Asha  |  300.00
  2 | Bilal |  320.00
(2 rows)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Optimistic locking with a version column',
      sql: `CREATE TABLE product_edit (
  id      int PRIMARY KEY,
  name    text NOT NULL,
  price   numeric(10,2) NOT NULL,
  version int NOT NULL DEFAULT 1
);
INSERT INTO product_edit (id, name, price)
SELECT id, name, price FROM products WHERE id = 7;

-- Editor A and Editor B both open the edit form and read version 1
SELECT id, name, price, version FROM product_edit WHERE id = 7;

-- Editor A saves first: matches version 1, bumps it to 2
UPDATE product_edit
SET price = price * 0.90, version = version + 1
WHERE id = 7 AND version = 1
RETURNING id, price, version;

-- Editor B saves with the stale version 1: 0 rows -> conflict detected
UPDATE product_edit
SET name = name || ' (renamed)', version = version + 1
WHERE id = 7 AND version = 1
RETURNING id, name, version;`,
      explain: `<p>No locks are held while editors think. Each save includes the version it read; only the first save matches. The second UPDATE affects 0 rows — the application must reload the row, show the editor what changed, and let them retry. ORMs implement exactly this (JPA/Hibernate <code>@Version</code>, Rails <code>lock_version</code>, Entity Framework concurrency tokens). Using <code>xmin</code> as an implicit version is possible but fragile (it changes on any update and on VACUUM FULL / dump-restore), so an explicit column is preferred.</p>`,
      output: ` id | name        | price    | version
----+-------------+----------+---------
  7 | Chair Max 7 | 60912.97 |       1

 id | price    | version
----+----------+---------
  7 | 54821.67 |       2

 id | name | version
----+------+---------
(0 rows)          -- conflict: someone else saved first`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Read-modify-write in the application: vulnerable to lost updates
SELECT stock FROM products WHERE id = 5;          -- app reads 159
-- ... app computes 159 - 2 = 157 ...
UPDATE products SET stock = 157 WHERE id = 5;     -- writes a constant computed from a stale read`,
      why: 'Between the SELECT and the UPDATE another transaction can change stock; the UPDATE then overwrites that change with a value computed from old data (lost update, overselling).',
      run: true
    },
    good: {
      sql: `-- Let the database do the arithmetic on the locked, latest row version
UPDATE products SET stock = stock - 2
WHERE id = 5 AND stock >= 2
RETURNING stock;`,
      why: 'The decrement and the availability check happen atomically on the newest row version; concurrent decrements serialize on the row lock and none is lost.',
      run: true
    }
  },
  mistakes: [
    'Reading a value, computing in application code, and writing back a constant (<code>SET stock = 157</code>) under READ COMMITTED — the textbook lost update.',
    'Using <code>SELECT ... FOR UPDATE</code> outside an explicit transaction: in autocommit mode the lock is released as soon as the SELECT finishes, protecting nothing.',
    'Holding <code>FOR UPDATE</code> locks while calling an external payment API, turning a 5 ms transaction into a 3 s one and building lock queues.',
    'Implementing optimistic locking but ignoring the affected-row count, so conflicts are silently dropped.',
    'Locking rows in different orders in different code paths, creating deadlocks.'
  ],
  best: [
    'Prefer a single atomic conditional UPDATE ... RETURNING whenever the business rule fits in a WHERE clause.',
    'Use pessimistic locks for short, high-contention critical sections; always lock in a consistent order (e.g. ORDER BY id).',
    'Use optimistic locking (explicit version column) for user-facing edit flows and low-contention data.',
    'Wrap retries in the application for serialization failures and optimistic conflicts, with a small bounded backoff.',
    'Add CHECK constraints (e.g. <code>stock &gt;= 0</code>) as a last line of defence.'
  ],
  performance: `<p>Atomic UPDATEs are the cheapest: one round trip and the row lock is held only for the remainder of the transaction. Pessimistic locks serialize work on hot rows — throughput on one row is bounded by 1 / (transaction duration), e.g. 200 tx/s if each holds the lock for 5 ms. Optimistic locking costs nothing when conflicts are rare but wastes whole transactions on retries when they are common. Every UPDATE creates a new row version (MVCC), so very hot single rows also generate dead tuples quickly; keep such tables small with aggressive autovacuum or HOT-friendly design.</p>`,
  security: `<p>Race conditions are a security issue: double-spending gift cards, redeeming a coupon twice, or bypassing a withdrawal limit with parallel requests are real attacks. Enforce invariants in the database (atomic conditional updates, unique constraints, CHECK constraints) rather than in application code that attackers can race.</p>`,
  scenario: {
    title: 'Flash sale oversold by 312 units',
    steps: [
      '1. Reproduce: two psql sessions doing SELECT stock then UPDATE SET stock = constant show the lost update on a timeline.',
      '2. Find all read-modify-write code paths on stock, balances and coupon usage (grep for SET stock = :).',
      '3. Replace them with UPDATE ... SET stock = stock - :qty WHERE id = :id AND stock &gt;= :qty RETURNING stock.',
      '4. Add CHECK (stock &gt;= 0) using NOT VALID + VALIDATE CONSTRAINT to avoid a long lock.',
      '5. Load-test with 500 concurrent checkouts on one SKU; verify sold units equal the initial stock exactly.',
      '6. Monitor lock waits (pg_stat_activity wait_event_type = \'Lock\') on hot SKUs during the next sale.'
    ]
  },
  widgets: ['lab:txn', 'diagram:mvcc'],
  interview: [
    { q: 'What is a lost update and does READ COMMITTED prevent it?', a: 'Two transactions read the same row, compute new values independently and write; the later write overwrites the earlier one. READ COMMITTED does not prevent it when the computation happens in application code between a SELECT and an UPDATE. It is prevented by atomic updates (SET x = x - 1), SELECT FOR UPDATE, optimistic version checks, or REPEATABLE READ/SERIALIZABLE (which raise a serialization error).' },
    { q: 'Why is UPDATE products SET stock = stock - 1 WHERE id = 5 AND stock > 0 safe under READ COMMITTED?', a: 'The UPDATE locks the row; if a concurrent transaction modified it, PostgreSQL waits for it to finish and then re-evaluates the WHERE clause and the SET expression against the newest committed version (EvalPlanQual). So the decrement is applied to the latest value and the stock check cannot be bypassed.' },
    { q: 'When would you choose optimistic over pessimistic locking?', a: 'When conflicts are rare and/or there is long think time between read and write (edit forms, mobile sync), because optimistic locking holds no locks and simply detects conflicts with a version check. Pessimistic locking fits short, high-contention critical sections where retries would waste a lot of work.' },
    { q: 'Why not use xmin as an optimistic-lock version?', a: 'It works in simple cases but is an internal system column: it changes on every update including no-op updates, its value is not preserved by dump/restore or VACUUM FULL-style rewrites in a stable way for applications, and it is 32-bit and wraps. An explicit version or updated_at column is clearer and portable.' }
  ],
  exercises: [
    {
      task: 'Write a single statement that redeems coupon code usage: increment users_count only if it is below max_uses, returning the new count. Create a small coupons table first.',
      solution: `CREATE TABLE coupons (code text PRIMARY KEY, max_uses int NOT NULL, used int NOT NULL DEFAULT 0);
INSERT INTO coupons VALUES ('DIWALI25', 2, 0);
UPDATE coupons SET used = used + 1 WHERE code = 'DIWALI25' AND used < max_uses RETURNING used;
UPDATE coupons SET used = used + 1 WHERE code = 'DIWALI25' AND used < max_uses RETURNING used;
UPDATE coupons SET used = used + 1 WHERE code = 'DIWALI25' AND used < max_uses RETURNING used;  -- 0 rows`,
      run: true
    },
    {
      task: 'Add a version column to a copy of departments and perform an optimistic update of the budget of department 2 that succeeds, followed by a stale one that fails.',
      solution: `CREATE TABLE dept_v AS SELECT id, name, budget FROM departments;
ALTER TABLE dept_v ADD COLUMN version int NOT NULL DEFAULT 1;
UPDATE dept_v SET budget = budget + 10000, version = version + 1 WHERE id = 2 AND version = 1 RETURNING id, budget, version;
UPDATE dept_v SET budget = budget - 5000,  version = version + 1 WHERE id = 2 AND version = 1 RETURNING id, budget, version;`,
      run: true
    }
  ],
  challenge: {
    task: 'Place an order for 3 different products atomically: decrement each product\'s stock only if ALL three have enough stock, otherwise change nothing. Use one UPDATE driven by a VALUES list and verify the number of updated rows equals 3 (raise an exception otherwise so the whole statement rolls back).',
    hint: 'UPDATE products p SET stock = p.stock - v.qty FROM (VALUES (...)) v(id, qty) WHERE p.id = v.id AND p.stock >= v.qty; wrap it in a DO block and use GET DIAGNOSTICS row_count.',
    solution: `DO $$
DECLARE n int;
BEGIN
  UPDATE products p
  SET    stock = p.stock - v.qty
  FROM   (VALUES (5, 2), (10, 1), (57, 3)) AS v(id, qty)
  WHERE  p.id = v.id AND p.stock >= v.qty;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 3 THEN
    RAISE EXCEPTION 'insufficient stock: only % of 3 lines reserved', n;
  END IF;
END $$;
SELECT id, stock FROM products WHERE id IN (5, 10, 57) ORDER BY id;`,
    run: true
  },
  related: ['concurrency-row-locking-clauses', 'concurrency-skip-locked-queues', 'isolation-levels', 'locks'],
  quiz: [
    { type: 'predict', q: 'Two sessions run this concurrently under READ COMMITTED with stock = 10. Final stock?', code: `UPDATE products SET stock = stock - 3 WHERE id = 5;  -- session A
UPDATE products SET stock = stock - 4 WHERE id = 5;  -- session B`, options: ['3', '6', '7', '6 or 7 depending on timing'], answer: 0, explain: 'The second UPDATE waits for the first to commit, then re-evaluates stock - 4 on the new value 7, giving 3. Atomic updates do not lose updates.' },
    { type: 'bug', q: 'What is wrong with this code (autocommit mode)?', code: `SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
-- app checks balance ...
UPDATE accounts SET balance = 400 WHERE id = 1;`, options: ['FOR UPDATE is invalid syntax', 'Without BEGIN, the lock ends when the SELECT finishes, so the read-modify-write is unprotected', 'UPDATE needs FOR UPDATE too', 'Nothing'], answer: 1, explain: 'Each statement is its own transaction in autocommit mode; the row lock is released immediately.' },
    { type: 'mcq', q: 'An optimistic UPDATE ... WHERE id = 7 AND version = 3 affects 0 rows. What does it mean?', options: ['The row was deleted or another transaction changed it (version is no longer 3)', 'A deadlock occurred', 'The table is locked', 'The update succeeded'], answer: 0, explain: 'The version check failed: reload, merge or report the conflict.' },
    { type: 'tf', q: 'Pessimistic locking is a good fit for an edit form that users keep open for several minutes.', answer: false, explain: 'Holding row locks during user think time blocks others and ties up connections; use optimistic locking.' }
  ]
},
{
  id: 'concurrency-row-locking-clauses',
  module: 'concurrency',
  title: 'Row Locking Clauses: FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE, FOR KEY SHARE, NOWAIT, lock_timeout',
  level: 4,
  minutes: 22,
  summary: 'The four row-lock strengths, how they conflict, why foreign keys use FOR KEY SHARE, and how to avoid waiting forever with NOWAIT and lock_timeout.',
  objectives: [
    'List the four row-level lock modes and their conflict matrix',
    'Explain why UPDATEs that do not touch key columns take FOR NO KEY UPDATE',
    'Show where row locks are stored (tuple xmax and infomask bits, not pg_locks)',
    'Use NOWAIT and lock_timeout to fail fast instead of blocking',
    'Lock rows in joins selectively with FOR UPDATE OF'
  ],
  concept: `<p>PostgreSQL has four row-level lock strengths, from strongest to weakest:</p>
<table>
<tr><th>Mode</th><th>Taken by</th><th>Blocks</th></tr>
<tr><td><code>FOR UPDATE</code></td><td>SELECT FOR UPDATE, DELETE, UPDATE of a unique-key column</td><td>all other row locks</td></tr>
<tr><td><code>FOR NO KEY UPDATE</code></td><td>SELECT FOR NO KEY UPDATE, ordinary UPDATE not changing key columns</td><td>FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE (not FOR KEY SHARE)</td></tr>
<tr><td><code>FOR SHARE</code></td><td>SELECT FOR SHARE</td><td>FOR UPDATE, FOR NO KEY UPDATE</td></tr>
<tr><td><code>FOR KEY SHARE</code></td><td>SELECT FOR KEY SHARE, foreign-key checks</td><td>only FOR UPDATE</td></tr>
</table>
<p>Conflict matrix (X = conflict):</p>
<table>
<tr><th>requested \\ held</th><th>KEY SHARE</th><th>SHARE</th><th>NO KEY UPDATE</th><th>UPDATE</th></tr>
<tr><td>FOR KEY SHARE</td><td></td><td></td><td></td><td>X</td></tr>
<tr><td>FOR SHARE</td><td></td><td></td><td>X</td><td>X</td></tr>
<tr><td>FOR NO KEY UPDATE</td><td></td><td>X</td><td>X</td><td>X</td></tr>
<tr><td>FOR UPDATE</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
</table>
<p>Analogy: a library book. <em>KEY SHARE</em> = "I am citing this book's ISBN, don't destroy or re-number it." <em>SHARE</em> = "I'm reading it, nobody write in it." <em>NO KEY UPDATE</em> = "I'm writing notes in the margins, but the ISBN stays." <em>UPDATE</em> = "I may tear it up or change its ISBN; everyone wait."</p>
<p>The split between NO KEY UPDATE and KEY SHARE exists so that inserting an order that references customer 42 (an FK check taking FOR KEY SHARE on the customer row) does not block, and is not blocked by, an UPDATE of that customer's email.</p>
<p>Waiting behaviour: by default a conflicting lock request waits indefinitely. <code>NOWAIT</code> raises an error immediately (<em>could not obtain lock on row</em>); <code>SKIP LOCKED</code> silently skips locked rows (next lesson); <code>SET lock_timeout = '2s'</code> bounds the wait for any lock in the session or transaction.</p>`,
  why: `<p>Choosing the weakest lock that guarantees correctness maximizes concurrency. Using <code>FOR UPDATE</code> everywhere "to be safe" blocks FK inserts on parent rows and causes needless waits; choosing <code>FOR SHARE</code> when you will later update can cause deadlocks when two sessions both upgrade. Fail-fast options protect latency budgets and connection pools.</p>`,
  useCase: `<p>A ticketing system shows a seat map; when a user clicks a seat, the backend runs <code>SELECT ... FROM seats WHERE id = $1 FOR UPDATE NOWAIT</code>. If another user is mid-checkout on that seat, the query fails immediately and the UI says "seat being booked by someone else" instead of spinning for seconds. Meanwhile the <code>bookings</code> table's FK to <code>seats</code> takes only FOR KEY SHARE, so creating bookings for other seats in the same section never blocks on seat price updates.</p>`,
  internals: `<ul>
<li>Row locks are <strong>not</strong> kept in the shared lock table (that would not scale to millions of rows). They are written into the tuple header: <code>xmax</code> is set to the locker's XID and infomask bits mark it as lock-only (<code>HEAP_XMAX_LOCK_ONLY</code>) with a strength (<code>HEAP_XMAX_EXCL_LOCK</code>, <code>HEAP_XMAX_KEYSHR_LOCK</code>, both = SHARE; <code>HEAP_KEYS_UPDATED</code> in infomask2 distinguishes FOR UPDATE).</li>
<li>Locking a row therefore <em>dirties the page</em> and generates WAL — SELECT FOR UPDATE is a write.</li>
<li>When several transactions hold share-type locks on one row, <code>xmax</code> points to a <strong>MultiXact</strong> ID that lists members (stored in <code>pg_multixact</code>). Heavy FK traffic on a few parent rows can create many MultiXacts, which need their own freezing (<code>autovacuum_multixact_freeze_max_age</code>).</li>
<li>A waiter first takes a heavyweight <em>tuple</em> lock (visible in pg_locks with <code>locktype = 'tuple'</code>), then waits on the holder's <code>transactionid</code> lock — that is what you see in <code>pg_locks</code> and in <code>pg_stat_activity.wait_event = 'transactionid'</code>.</li>
<li>All row-locking SELECTs also take <code>ROW SHARE</code> on the table.</li>
</ul>`,
  whenNot: `<p>Do not lock rows you only read for display. Do not use FOR SHARE as a stepping stone to a later UPDATE of the same row (two holders upgrading deadlock) — take FOR NO KEY UPDATE / FOR UPDATE from the start. Avoid row locks in long reporting queries; use REPEATABLE READ for a consistent snapshot instead.</p>`,
  syntax: `SELECT ... FROM t WHERE ...
  FOR { UPDATE | NO KEY UPDATE | SHARE | KEY SHARE }
      [ OF table_name [, ...] ]
      [ NOWAIT | SKIP LOCKED ];

SET lock_timeout = '2s';          -- session
SET LOCAL lock_timeout = '2s';    -- current transaction only`,
  examples: [
    {
      label: 'Basic',
      title: 'Lock a row with NOWAIT and a bounded lock_timeout',
      sql: `BEGIN;
SET LOCAL lock_timeout = '2s';          -- never wait more than 2 s for any lock in this txn

SELECT id, name, stock
FROM products
WHERE id = 5
FOR UPDATE NOWAIT;                      -- error immediately if someone else holds a conflicting lock

UPDATE products SET stock = stock - 1 WHERE id = 5;
SHOW lock_timeout;
ROLLBACK;`,
      explain: `<p><code>SET LOCAL</code> scopes the timeout to this transaction only, which is the safe pattern behind connection poolers. <code>NOWAIT</code> applies to the row locks of this statement; if a concurrent session held the row you would get <em>ERROR: could not obtain lock on row in relation "products"</em> (SQLSTATE 55P03) at once. Here, in a single session, the lock is granted immediately. <code>lock_timeout</code> covers every other lock acquisition in the transaction, including table locks.</p>`,
      output: ` id | name         | stock
----+--------------+-------
  5 | Webcam Pro 5 |   159
(1 row)

UPDATE 1
 lock_timeout
--------------
 2s`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'See row-lock strengths in the tuple header with pageinspect',
      sql: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE acct (id int PRIMARY KEY, owner text, balance numeric);
INSERT INTO acct VALUES (1,'a',100), (2,'b',100), (3,'c',100), (4,'d',100);

BEGIN;
SELECT pg_current_xact_id() AS my_xid;
SELECT id FROM acct WHERE id = 1 FOR UPDATE;
SELECT id FROM acct WHERE id = 2 FOR NO KEY UPDATE;
SELECT id FROM acct WHERE id = 3 FOR SHARE;
SELECT id FROM acct WHERE id = 4 FOR KEY SHARE;

-- row locks live in xmax + infomask bits, not in pg_locks
SELECT lp, t_xmax,
       CASE WHEN t_infomask & 128 = 0                              THEN 'not lock-only'
            WHEN t_infomask & 80 = 80                              THEN 'FOR SHARE'
            WHEN t_infomask & 64 = 64 AND t_infomask2 & 8192 = 8192 THEN 'FOR UPDATE'
            WHEN t_infomask & 64 = 64                              THEN 'FOR NO KEY UPDATE'
            WHEN t_infomask & 16 = 16                              THEN 'FOR KEY SHARE'
       END AS lock_mode
FROM heap_page_items(get_raw_page('acct', 0))
ORDER BY lp;

SELECT locktype, relation::regclass, mode
FROM pg_locks
WHERE pid = pg_backend_pid() AND relation = 'acct'::regclass;
COMMIT;
DROP TABLE acct;`,
      explain: `<p>Each locked tuple has <code>t_xmax</code> = our XID and the <code>HEAP_XMAX_LOCK_ONLY</code> bit (128) set, meaning "locked, not deleted". The strength is encoded by <code>HEAP_XMAX_EXCL_LOCK</code> (64), <code>HEAP_XMAX_KEYSHR_LOCK</code> (16), both together for SHARE (80), and <code>HEAP_KEYS_UPDATED</code> (8192 in infomask2) for FOR UPDATE. <code>pg_locks</code> shows only one table-level <code>RowShareLock</code> on <code>acct</code> (taken by every row-locking SELECT) — there is no per-row entry unless someone is <em>waiting</em>. XID values differ on your machine.</p>`,
      output: ` my_xid
--------
    755

 lp | t_xmax | lock_mode
----+--------+-------------------
  1 |    755 | FOR UPDATE
  2 |    755 | FOR NO KEY UPDATE
  3 |    755 | FOR SHARE
  4 |    755 | FOR KEY SHARE
(4 rows)

 locktype | relation | mode
----------+----------+--------------
 relation | acct     | RowShareLock
(1 row)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'FOR UPDATE OF: lock only the rows you will change in a join',
      sql: `BEGIN;
-- lock the order rows, but NOT the customers we join to for the email address
SELECT o.id, o.status, c.email
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'paid' AND o.order_date >= '2025-09-25'
ORDER BY o.id
LIMIT 5
FOR NO KEY UPDATE OF o;

UPDATE orders SET status = 'shipped'
WHERE id IN (SELECT id FROM orders WHERE status = 'paid' AND order_date >= '2025-09-25'
             ORDER BY id LIMIT 5);

SELECT relation::regclass, mode FROM pg_locks
WHERE pid = pg_backend_pid() AND relation IN ('orders'::regclass, 'customers'::regclass)
ORDER BY 1::text, 2;
ROLLBACK;`,
      explain: `<p>Without <code>OF o</code>, FOR UPDATE would lock the matching rows of <em>both</em> joined tables, needlessly blocking concurrent updates to customer rows. <code>FOR NO KEY UPDATE</code> is enough because we will not change the primary key — so FK checks from <code>order_items</code> and <code>payments</code> referencing these orders (FOR KEY SHARE) are not blocked. In pg_locks, <code>customers</code> only has <code>AccessShareLock</code> (read), while <code>orders</code> has <code>RowShareLock</code> (from FOR ... OF o) and <code>RowExclusiveLock</code> (from the UPDATE).</p>`,
      output: ` id   | status | email
------+--------+-------------------------
  191 | paid   | customer56@example.com
  451 | paid   | customer21@example.com
  532 | paid   | customer439@example.com
  881 | paid   | customer197@example.com
 1046 | paid   | customer364@example.com
(5 rows)

 relation  | mode
-----------+------------------
 customers | AccessShareLock
 orders    | AccessShareLock
 orders    | RowExclusiveLock
 orders    | RowShareLock`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `BEGIN;
-- FOR SHARE now, update later: two sessions doing this on the same row deadlock
SELECT stock FROM products WHERE id = 5 FOR SHARE;
UPDATE products SET stock = stock - 1 WHERE id = 5;
ROLLBACK;`,
      why: 'Two transactions can both hold FOR SHARE; when each then tries to UPDATE, each waits for the other\'s share lock: deadlock (one is aborted after deadlock_timeout).',
      run: true
    },
    good: {
      sql: `BEGIN;
-- take the lock you will eventually need, up front
SELECT stock FROM products WHERE id = 5 FOR NO KEY UPDATE;
UPDATE products SET stock = stock - 1 WHERE id = 5;
ROLLBACK;`,
      why: 'FOR NO KEY UPDATE is self-conflicting, so the second session waits at the SELECT instead of deadlocking at the UPDATE; FK checks (FOR KEY SHARE) remain unblocked.',
      run: true
    }
  },
  mistakes: [
    'Using <code>FOR UPDATE</code> when the key is not changing — it needlessly blocks FK inserts in child tables. Prefer <code>FOR NO KEY UPDATE</code>.',
    'Lock upgrade patterns (FOR SHARE then UPDATE) that deadlock under concurrency.',
    'Forgetting <code>OF table</code> in joins and locking rows of lookup tables.',
    'Setting <code>lock_timeout</code> globally to a tiny value, causing random failures in background jobs; scope it with <code>SET LOCAL</code> where needed.',
    'Thinking pg_locks lists every locked row — it lists only heavyweight locks; locked rows are found via waiting sessions or the pgrowlocks extension.'
  ],
  best: [
    'Choose the weakest sufficient lock: KEY SHARE for "must still exist", NO KEY UPDATE for "I will update non-key columns".',
    'Use <code>NOWAIT</code> in interactive paths where waiting is worse than an immediate, user-visible "busy" message.',
    'Set <code>lock_timeout</code> (and <code>statement_timeout</code>) per transaction for user-facing requests and for migrations.',
    'Lock rows in a deterministic order (ORDER BY primary key) when locking several rows.',
    'Keep the locking transaction short: lock, change, commit.'
  ],
  performance: `<p>Row locks are cheap to hold (no shared memory per row) but writing them dirties pages and generates WAL, and multiple share-lockers create MultiXacts. Lock waits show up as <code>wait_event_type = 'Lock'</code> with <code>wait_event = 'transactionid'</code> or <code>'tuple'</code> in <code>pg_stat_activity</code>; watch them on hot rows. <code>log_lock_waits = on</code> logs any wait longer than <code>deadlock_timeout</code>.</p>`,
  security: `<p>Every row-locking clause (FOR UPDATE, NO KEY UPDATE, SHARE, KEY SHARE) requires the <code>UPDATE</code> privilege on at least one column of the table in addition to <code>SELECT</code> — so a read-only reporting role cannot lock rows and block writers. Row-level security <code>UPDATE</code> policies are also applied to rows locked with FOR UPDATE / FOR NO KEY UPDATE / FOR SHARE.</p>`,
  scenario: {
    title: 'Checkout latency spikes when the catalog team edits prices',
    steps: [
      '1. pg_stat_activity during spikes: checkout INSERTs into order_items wait on transactionid locks held by the catalog job.',
      '2. The catalog job runs SELECT ... FROM products ... FOR UPDATE on 5,000 products, then updates prices for 40 seconds.',
      '3. FK checks from order_items take FOR KEY SHARE on products, which conflicts with FOR UPDATE.',
      '4. Change the job to FOR NO KEY UPDATE (it never changes product ids), which does not conflict with FOR KEY SHARE.',
      '5. Also batch it: 200 products per transaction with SET LOCAL lock_timeout = \'3s\'.',
      '6. Verify: checkout p99 back to baseline during catalog edits; log_lock_waits shows no more long waits.'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'Why does PostgreSQL have both FOR UPDATE and FOR NO KEY UPDATE?', a: 'So that ordinary updates that do not modify key columns (FOR NO KEY UPDATE) do not conflict with foreign-key checks, which take FOR KEY SHARE on the referenced row. Only operations that may delete the row or change its key (DELETE, key-changing UPDATE, explicit FOR UPDATE) conflict with KEY SHARE. This removed a major source of FK-related blocking (PG 9.3).' },
    { q: 'Where are row locks stored?', a: 'In the tuple header: xmax holds the locking transaction ID (or a MultiXact ID if several transactions share the lock) and infomask bits mark the lock as lock-only and encode its strength. The shared lock table only contains entries for sessions waiting on a row (tuple locks) and transaction ID locks.' },
    { q: 'What is the difference between NOWAIT and lock_timeout?', a: 'NOWAIT applies to the row locks of a single SELECT ... FOR ... statement and errors immediately if any is unavailable. lock_timeout is a setting that aborts any statement that waits longer than the configured duration for any lock (table, row, etc.).' },
    { q: 'What is a MultiXact?', a: 'When more than one transaction holds a lock on the same row (e.g. multiple FOR KEY SHARE from FK checks, or a lock plus an update), xmax stores a MultiXact ID that refers to a list of member XIDs and lock modes in pg_multixact. MultiXact IDs are also 32-bit and must be frozen by vacuum before wraparound.' }
  ],
  exercises: [
    {
      task: 'In one transaction lock the 3 cheapest products with FOR UPDATE NOWAIT and decrement their stock by 1; return the new stock.',
      solution: `BEGIN;
SELECT id, price, stock FROM products ORDER BY price LIMIT 3 FOR UPDATE NOWAIT;
UPDATE products SET stock = stock - 1
WHERE id IN (SELECT id FROM products ORDER BY price LIMIT 3)
RETURNING id, stock;
ROLLBACK;`,
      run: true
    },
    {
      task: 'Show that SET LOCAL lock_timeout is reverted after the transaction ends.',
      solution: `BEGIN;
SET LOCAL lock_timeout = '1500ms';
SELECT current_setting('lock_timeout') AS inside_txn;
COMMIT;
SELECT current_setting('lock_timeout') AS after_txn;`,
      run: true
    }
  ],
  challenge: {
    task: 'Demonstrate a MultiXact: in one transaction lock a row FOR KEY SHARE, then create a SAVEPOINT and update a non-key column of the same row. Inspect the tuple with pageinspect and show that the old version\'s xmax is a MultiXact (infomask bit HEAP_XMAX_IS_MULTI = 4096).',
    hint: 'A lock plus an update by a subtransaction requires a MultiXact to record both members. Check t_infomask & 4096.',
    solution: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE mx (id int PRIMARY KEY, v int);
INSERT INTO mx VALUES (1, 0);
BEGIN;
SELECT * FROM mx WHERE id = 1 FOR KEY SHARE;
SAVEPOINT s1;
UPDATE mx SET v = v + 1 WHERE id = 1;
RELEASE SAVEPOINT s1;
SELECT lp, t_xmax, (t_infomask & 4096) <> 0 AS xmax_is_multixact
FROM heap_page_items(get_raw_page('mx', 0)) ORDER BY lp;
COMMIT;
DROP TABLE mx;`,
    run: true
  },
  related: ['concurrency-problems-locking-strategies', 'concurrency-skip-locked-queues', 'locks-row-level-pg-locks', 'locks'],
  quiz: [
    { type: 'mcq', q: 'Which row lock does a foreign-key check take on the referenced (parent) row?', options: ['FOR UPDATE', 'FOR NO KEY UPDATE', 'FOR SHARE', 'FOR KEY SHARE'], answer: 3, explain: 'FK checks take FOR KEY SHARE, which conflicts only with FOR UPDATE (deletes and key changes).' },
    { type: 'tf', q: 'An UPDATE that changes only the price column of a product blocks a concurrent INSERT into order_items referencing that product.', answer: false, explain: 'The UPDATE takes FOR NO KEY UPDATE, which does not conflict with the FK check\'s FOR KEY SHARE.' },
    { type: 'mcq', q: 'SELECT ... FOR UPDATE NOWAIT finds a row locked by another transaction. What happens?', options: ['It waits until lock_timeout', 'It skips the row', 'It raises an error immediately (SQLSTATE 55P03)', 'It returns the row without locking'], answer: 2, explain: 'NOWAIT raises "could not obtain lock on row" immediately; SKIP LOCKED would skip it.' },
    { type: 'bug', q: 'Why can two instances of this transaction deadlock?', code: `BEGIN;
SELECT * FROM seats WHERE id = 9 FOR SHARE;
UPDATE seats SET held_by = 'me' WHERE id = 9;
COMMIT;`, options: ['FOR SHARE is not allowed on tables with PKs', 'Both can hold FOR SHARE at once, then each UPDATE waits for the other\'s share lock', 'UPDATE takes no locks', 'COMMIT is missing'], answer: 1, explain: 'Shared locks are compatible with each other, so both acquire them; the subsequent exclusive requests wait on each other.' }
  ]
},
{
  id: 'concurrency-skip-locked-queues',
  module: 'concurrency',
  title: 'SKIP LOCKED: Building a Reliable Job Queue in PostgreSQL',
  level: 4,
  minutes: 22,
  summary: 'Use FOR UPDATE SKIP LOCKED to let many workers pull jobs from one table without blocking each other, with retries, visibility timeouts and cleanup.',
  objectives: [
    'Design a job-queue table with status, run_at, attempts and a partial index',
    'Dequeue a batch atomically with UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)',
    'Handle completion, failure with exponential backoff, and stuck-job recovery',
    'Understand why SKIP LOCKED gives an inconsistent view on purpose and where that is acceptable',
    'Keep a queue table healthy: bloat, autovacuum and index design'
  ],
  concept: `<p><code>SKIP LOCKED</code> (PG 9.5+) changes what a row-locking SELECT does when it meets a row already locked by someone else: instead of waiting or failing, it <strong>skips that row</strong> and continues to the next one. That is exactly what a work queue needs: N workers each grab "the next available job" and never wait on each other.</p>
<p>Analogy: a deli counter with numbered tickets on a board. Each clerk takes the first ticket that nobody is holding, rather than standing behind a colleague who is reading ticket #1.</p>
<p>The canonical dequeue statement:</p>
<ul>
<li>Find candidate jobs (<code>status = 'queued' AND run_at &lt;= now()</code>) in priority order.</li>
<li>Lock up to N of them with <code>FOR UPDATE SKIP LOCKED</code> — jobs locked by other workers are skipped.</li>
<li>Mark them <code>running</code> (with <code>locked_by</code>, <code>locked_at</code>, <code>attempts + 1</code>) in the same statement, and <code>RETURNING</code> their payload.</li>
</ul>
<p>Two common designs: (1) <strong>Short transaction + status column</strong>: dequeue-and-mark in one statement, commit, process outside the transaction, then mark <code>done</code>/<code>failed</code>; stuck jobs are recovered with a visibility timeout. (2) <strong>Long transaction</strong>: lock the job, process it inside the transaction, delete it and commit — simpler, crash-safe automatically (the lock disappears if the worker dies), but holds a transaction open for the whole job duration, which hurts VACUUM if jobs are long.</p>`,
  why: `<p>Many systems need a durable background-job queue (emails, invoices, webhooks, thumbnails). Running one in PostgreSQL gives transactional enqueueing — the job is created in the same transaction as the business change, so you never send an email for an order that rolled back — and no extra infrastructure. Before SKIP LOCKED, workers either serialized on the same first row or used fragile advisory-lock tricks.</p>`,
  useCase: `<p>A B2B invoicing SaaS enqueues ~2M jobs/day (PDF generation, e-mail, GST e-invoice submission) into a <code>job_queue</code> table and runs 40 worker processes. Using <code>FOR UPDATE SKIP LOCKED LIMIT 10</code>, dequeue latency stays under 2 ms at 400 jobs/s. Enqueue happens inside the same transaction that creates the invoice. Completed jobs are deleted (or moved to a daily-partitioned history table) so the hot table stays at a few thousand rows; autovacuum is tuned aggressively on it. Tools such as Graphile Worker, River, Oban, Que, GoodJob and Solid Queue <span class="tag tool">third-party tool</span> implement this same pattern.</p>`,
  internals: `<ul>
<li>When the executor tries to lock a tuple and finds it locked (xmax is a running transaction holding a conflicting lock), SKIP LOCKED returns "skip" from the row-lock attempt instead of sleeping on the holder's transaction ID lock.</li>
<li>With <code>LIMIT</code>, the scan continues until it has locked N rows, so each worker effectively gets a disjoint batch.</li>
<li>The result is deliberately not a consistent snapshot: rows are skipped based on lock state at that moment. That is fine for queues, wrong for reports.</li>
<li>Every status change is an UPDATE = a new tuple version, so a busy queue produces dead tuples at the rate of jobs × state transitions. A <em>partial index</em> <code>WHERE status = 'queued'</code> keeps the dequeue index tiny, but dead index entries still need vacuuming — tune <code>autovacuum_vacuum_scale_factor</code> low (e.g. 0.01) or use a threshold on this table.</li>
<li>HOT updates are possible when the updated columns are not indexed and the page has room — <code>fillfactor = 70–80</code> helps; but changing <code>status</code> (an indexed column in the partial index predicate) prevents HOT for that transition.</li>
</ul>`,
  whenNot: `<p>For very high throughput (tens of thousands of messages/s), fan-out pub/sub, or strict ordering per key with replay, a dedicated broker (Kafka, RabbitMQ, SQS) is a better fit. Do not use SKIP LOCKED for reports or anything needing a consistent view. Avoid the long-transaction design when jobs take minutes: the open transaction holds back the xmin horizon and prevents VACUUM from removing dead tuples everywhere in the database.</p>`,
  syntax: `WITH next AS (
  SELECT id FROM job_queue
  WHERE status = 'queued' AND run_at <= now()
  ORDER BY priority DESC, run_at, id
  LIMIT $batch
  FOR UPDATE SKIP LOCKED
)
UPDATE job_queue j
SET status = 'running', locked_by = $worker, locked_at = now(), attempts = attempts + 1
FROM next
WHERE j.id = next.id
RETURNING j.id, j.kind, j.payload;`,
  examples: [
    {
      label: 'Basic',
      title: 'Create the queue and enqueue jobs transactionally',
      sql: `CREATE TABLE job_queue (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text        NOT NULL,
  payload     jsonb       NOT NULL,
  priority    int         NOT NULL DEFAULT 0,
  status      text        NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'running', 'done', 'failed')),
  run_at      timestamptz NOT NULL DEFAULT now(),
  attempts    int         NOT NULL DEFAULT 0,
  max_attempts int        NOT NULL DEFAULT 5,
  locked_by   text,
  locked_at   timestamptz,
  last_error  text
) WITH (fillfactor = 80);

-- tiny index covering only what workers look for
CREATE INDEX job_queue_ready_idx ON job_queue (priority DESC, run_at, id)
  WHERE status = 'queued';

-- enqueue "send invoice" jobs for the 6 most recent paid orders
INSERT INTO job_queue (kind, payload, priority)
SELECT 'send_invoice', jsonb_build_object('order_id', id, 'amount', total_amount),
       CASE WHEN total_amount > 100000 THEN 10 ELSE 0 END
FROM orders WHERE status = 'paid'
ORDER BY order_date DESC LIMIT 6;

SELECT id, kind, payload->>'order_id' AS order_id, priority, status
FROM job_queue ORDER BY id;`,
      explain: `<p>The table carries everything a worker needs: <code>run_at</code> for delayed jobs and backoff, <code>attempts</code>/<code>max_attempts</code> for retries, <code>locked_by</code>/<code>locked_at</code> for observability and stuck-job recovery. The partial index only contains queued rows, so it stays small even if millions of done rows accumulate. <code>fillfactor = 80</code> leaves room on each page for HOT updates of non-indexed columns. In a real app the INSERT runs in the same transaction as the order update, so the job exists if and only if the order change committed.</p>`,
      output: ` id | kind         | order_id | priority | status
----+--------------+----------+----------+--------
  1 | send_invoice | 881      |       10 | queued
  2 | send_invoice | 451      |       10 | queued
  3 | send_invoice | 1185     |       10 | queued
  4 | send_invoice | 4494     |       10 | queued
  5 | send_invoice | 532      |        0 | queued
  6 | send_invoice | 1553     |       10 | queued
(6 rows)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Dequeue a batch with FOR UPDATE SKIP LOCKED',
      sql: `CREATE TABLE job_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL,
  priority int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'queued',
  run_at timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0,
  locked_by text, locked_at timestamptz, last_error text);
CREATE INDEX job_queue_ready_idx ON job_queue (priority DESC, run_at, id) WHERE status = 'queued';
INSERT INTO job_queue (kind, payload)
SELECT 'send_invoice', jsonb_build_object('order_id', id) FROM orders ORDER BY id LIMIT 8;

-- Worker "w1" takes up to 3 ready jobs; rows locked by other workers are skipped
WITH next AS (
  SELECT id
  FROM job_queue
  WHERE status = 'queued' AND run_at <= now()
  ORDER BY priority DESC, run_at, id
  LIMIT 3
  FOR UPDATE SKIP LOCKED
)
UPDATE job_queue j
SET status = 'running', locked_by = 'w1', locked_at = now(), attempts = attempts + 1
FROM next
WHERE j.id = next.id
RETURNING j.id, j.kind, j.payload, j.attempts;

-- Worker "w2" runs the same statement and gets the NEXT 3 jobs
WITH next AS (
  SELECT id FROM job_queue
  WHERE status = 'queued' AND run_at <= now()
  ORDER BY priority DESC, run_at, id
  LIMIT 3
  FOR UPDATE SKIP LOCKED
)
UPDATE job_queue j
SET status = 'running', locked_by = 'w2', locked_at = now(), attempts = attempts + 1
FROM next WHERE j.id = next.id
RETURNING j.id, j.locked_by;

SELECT status, locked_by, count(*) FROM job_queue GROUP BY 1, 2 ORDER BY 1, 2;`,
      explain: `<p>The CTE selects and locks candidate ids; the UPDATE marks them running in the same statement, and RETURNING hands the payload to the worker. In a real system w1 and w2 are separate connections running simultaneously: w2's SELECT would skip w1's three locked rows rather than wait. In this single-session demo, w2 gets jobs 4–6 because jobs 1–3 are no longer <code>queued</code>. After this statement commits, the worker processes the jobs outside any transaction, then marks them done or failed.</p>`,
      output: ` id | kind         | payload          | attempts
----+--------------+------------------+----------
  1 | send_invoice | {"order_id": 1}  |        1
  2 | send_invoice | {"order_id": 2}  |        1
  3 | send_invoice | {"order_id": 3}  |        1

 id | locked_by
----+-----------
  4 | w2
  5 | w2
  6 | w2

 status  | locked_by | count
---------+-----------+-------
 queued  |           |     2
 running | w1        |     3
 running | w2        |     3`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Complete, fail with exponential backoff, and recover stuck jobs',
      sql: `CREATE TABLE job_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL,
  priority int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'queued',
  run_at timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 5,
  locked_by text, locked_at timestamptz, last_error text);
INSERT INTO job_queue (kind, payload, status, attempts, locked_by, locked_at) VALUES
  ('send_invoice', '{"order_id": 101}', 'running', 1, 'w1', now() - interval '30 seconds'),
  ('send_invoice', '{"order_id": 102}', 'running', 3, 'w1', now() - interval '20 seconds'),
  ('webhook',      '{"order_id": 103}', 'running', 1, 'w9', now() - interval '45 minutes');  -- worker w9 died

-- 1) success: mark done (or DELETE / move to a history partition)
UPDATE job_queue SET status = 'done', locked_by = NULL, locked_at = NULL
WHERE id = 1 RETURNING id, status;

-- 2) failure: retry later with exponential backoff (2^attempts minutes), or give up
UPDATE job_queue
SET status     = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    run_at     = now() + make_interval(mins => power(2, attempts)::int),
    last_error = 'SMTP 451 temporary failure',
    locked_by  = NULL, locked_at = NULL
WHERE id = 2
RETURNING id, status, attempts, run_at - now() AS retry_in;

-- 3) reaper: jobs "running" for longer than the visibility timeout go back to the queue
UPDATE job_queue
SET status = 'queued', locked_by = NULL, locked_at = NULL, last_error = 'visibility timeout'
WHERE status = 'running' AND locked_at < now() - interval '15 minutes'
RETURNING id, kind, attempts;`,
      explain: `<p>Job 1 completes. Job 2 failed on its 3rd attempt, so it is re-queued 2³ = 8 minutes in the future; after <code>max_attempts</code> it would become <code>failed</code> (a dead-letter state you alert on). Job 3's worker crashed 45 minutes ago without updating the row; the reaper (run every minute by a scheduler) returns it to the queue. Because the job may then run twice, job handlers must be <strong>idempotent</strong> (e.g. keyed by order_id with a unique constraint on "invoice sent" records).</p>`,
      output: ` id | status
----+--------
  1 | done

 id | status | attempts | retry_in
----+--------+----------+----------
  2 | queued |        3 | 00:08:00

 id | kind    | attempts
----+---------+----------
  3 | webhook |        1`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `CREATE TABLE job_queue_demo (id int PRIMARY KEY, kind text, status text DEFAULT 'queued');
INSERT INTO job_queue_demo SELECT g, 'email', 'queued' FROM generate_series(1, 5) g;
-- Every worker fights over the same first row: they queue up behind each other
BEGIN;
SELECT id, kind FROM job_queue_demo
WHERE status = 'queued'
ORDER BY id
LIMIT 1
FOR UPDATE;           -- worker 2..N block here until worker 1 commits
ROLLBACK;`,
      why: 'Without SKIP LOCKED, all workers try to lock the same oldest row and block on it; throughput collapses to one job at a time.',
      run: true
    },
    good: {
      sql: `CREATE TABLE job_queue_demo (id int PRIMARY KEY, kind text, status text DEFAULT 'queued');
INSERT INTO job_queue_demo SELECT g, 'email', 'queued' FROM generate_series(1, 5) g;
-- Each worker gets a different row immediately
BEGIN;
SELECT id, kind FROM job_queue_demo
WHERE status = 'queued'
ORDER BY id
LIMIT 1
FOR UPDATE SKIP LOCKED;
ROLLBACK;`,
      why: 'SKIP LOCKED skips rows locked by other workers, so N workers dequeue N different jobs in parallel without waiting.',
      run: true
    }
  },
  mistakes: [
    'Using SKIP LOCKED without LIMIT or ORDER BY, locking far more rows than one worker can process.',
    'Keeping a transaction open while processing a 10-minute job: it pins the xmin horizon and blocks VACUUM cluster-wide.',
    'Never deleting or archiving completed jobs: the table and its indexes bloat and dequeue gets slower every day.',
    'Non-idempotent job handlers combined with visibility-timeout recovery: crashed-then-recovered jobs run twice and, e.g., charge a customer twice.',
    'Using SKIP LOCKED in reporting queries, producing silently incomplete results.'
  ],
  best: [
    'Dequeue and mark in one statement (CTE + UPDATE ... RETURNING), commit, then process.',
    'Index only ready jobs with a partial index; order by (priority, run_at, id).',
    'Use exponential backoff via run_at, a max_attempts limit, and a dead-letter status with alerting.',
    'Make handlers idempotent and record side effects with unique keys.',
    'Delete or partition-out done jobs and tune autovacuum aggressively on the queue table; LISTEN/NOTIFY can wake idle workers instead of tight polling.'
  ],
  performance: `<p>With a partial index on ready jobs, each dequeue touches a handful of index and heap pages, so thousands of dequeues per second are achievable. The limiting factor is usually dead tuples: each job causes 2–3 updates. Keep the table small, set per-table autovacuum thresholds (e.g. <code>autovacuum_vacuum_scale_factor = 0</code>, <code>autovacuum_vacuum_threshold = 1000</code>), and avoid long-running transactions anywhere in the database, because they stop VACUUM from cleaning the queue.</p>`,
  security: `<p>Job payloads often contain personal data or tokens; restrict access to the queue table to the application role, avoid putting secrets in payloads (store references), and purge completed jobs according to data-retention policies.</p>`,
  scenario: {
    title: 'The job queue that got slower every week',
    steps: [
      '1. Symptom: dequeue latency grew from 2 ms to 400 ms over a month; the table has 30M rows, 99.9% of them done.',
      '2. EXPLAIN shows the dequeue scanning a full (status, run_at) index with millions of dead/done entries.',
      '3. Create a partial index WHERE status = \'queued\' CONCURRENTLY; drop the old full index.',
      '4. Add a nightly job that deletes done jobs older than 7 days in batches of 10,000 (or move the history to a daily-partitioned table and drop partitions).',
      '5. ALTER TABLE job_queue SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 5000).',
      '6. Find and fix a worker that kept a transaction open for the whole job (idle in transaction for minutes).',
      '7. Result: table back to ~20k rows, dequeue p99 at 3 ms.'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'How does SKIP LOCKED enable a job queue?', a: 'A SELECT ... FOR UPDATE SKIP LOCKED LIMIT n skips rows already locked by other transactions instead of waiting, so concurrent workers each lock and claim different rows. Combined with an UPDATE that marks the claimed rows running and returns them, every worker gets a disjoint batch without blocking.' },
    { q: 'What are the trade-offs between processing a job inside the locking transaction and marking it "running" and committing?', a: 'Processing inside the transaction is simple and crash-safe (the lock and claim vanish if the worker dies) but holds a transaction open for the job duration, which blocks VACUUM and ties up a connection. Mark-and-commit keeps transactions short but requires a visibility timeout/reaper to recover jobs from crashed workers, and therefore idempotent handlers.' },
    { q: 'Why is a partial index important for a queue table?', a: 'Most rows are completed jobs; workers only query queued ones. A partial index WHERE status = \'queued\' stays tiny, so each dequeue reads a few pages, regardless of how much history is in the table.' },
    { q: 'Why should SKIP LOCKED not be used for reporting?', a: 'It intentionally returns an inconsistent view: rows locked at that instant are left out. Totals and reports would be silently wrong. Reports should use plain MVCC snapshots, which never block on row locks anyway.' }
  ],
  exercises: [
    {
      task: 'Create a minimal queue, enqueue 5 jobs, and write the dequeue statement that claims at most 2 jobs ordered by id for worker \'w7\' using SKIP LOCKED.',
      solution: `CREATE TABLE q (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payload text,
                status text NOT NULL DEFAULT 'queued', locked_by text);
INSERT INTO q (payload) SELECT 'job ' || g FROM generate_series(1, 5) g;
WITH next AS (
  SELECT id FROM q WHERE status = 'queued' ORDER BY id LIMIT 2 FOR UPDATE SKIP LOCKED
)
UPDATE q SET status = 'running', locked_by = 'w7'
FROM next WHERE q.id = next.id
RETURNING q.id, q.payload;`,
      run: true
    },
    {
      task: 'Implement the "delete on completion" variant: dequeue one job with DELETE ... RETURNING using SKIP LOCKED.',
      solution: `CREATE TABLE q (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payload text);
INSERT INTO q (payload) SELECT 'job ' || g FROM generate_series(1, 3) g;
DELETE FROM q
WHERE id = (SELECT id FROM q ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id, payload;
SELECT count(*) AS remaining FROM q;`,
      run: true
    }
  ],
  challenge: {
    task: 'Add per-tenant fairness: dequeue at most 1 job per tenant per call, up to 3 jobs total, skipping locked rows. Jobs have a tenant_id.',
    hint: 'Pick candidates with DISTINCT ON (tenant_id) in a subquery, then lock them with FOR UPDATE SKIP LOCKED in the outer query (FOR UPDATE cannot be used directly with DISTINCT).',
    solution: `CREATE TABLE tq (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id int NOT NULL,
                 payload text, status text NOT NULL DEFAULT 'queued');
INSERT INTO tq (tenant_id, payload)
SELECT tenant_id, 'job for ' || username FROM users ORDER BY id LIMIT 12;

WITH candidates AS (
  SELECT DISTINCT ON (tenant_id) id
  FROM tq WHERE status = 'queued'
  ORDER BY tenant_id, id
), locked AS (
  SELECT tq.id FROM tq JOIN candidates c ON c.id = tq.id
  ORDER BY tq.id LIMIT 3
  FOR UPDATE OF tq SKIP LOCKED
)
UPDATE tq SET status = 'running'
FROM locked WHERE tq.id = locked.id
RETURNING tq.id, tq.tenant_id, tq.payload;`,
    run: true
  },
  related: ['concurrency-row-locking-clauses', 'concurrency-problems-locking-strategies', 'vacuum', 'mvcc'],
  quiz: [
    { type: 'mcq', q: 'What does SKIP LOCKED do when it encounters a row locked by another transaction?', options: ['Waits for the lock', 'Raises an error', 'Skips the row and continues scanning', 'Reads the old version without locking'], answer: 2, explain: 'Locked rows are excluded from the result; the statement continues to the next candidate.' },
    { type: 'tf', q: 'SKIP LOCKED is a good way to make monthly revenue reports faster under write load.', answer: false, explain: 'It would silently omit locked rows. Plain SELECTs already never block on row locks under MVCC.' },
    { type: 'design', q: 'Jobs take up to 20 minutes. Which design keeps VACUUM healthy?', options: ['Lock the job and process it inside one long transaction', 'Claim the job (status=running, locked_at) and commit, process outside a transaction, then mark done; recover stale jobs with a reaper', 'Use SERIALIZABLE', 'Use LOCK TABLE job_queue'], answer: 1, explain: 'Long open transactions hold back the xmin horizon; short claim transactions plus a visibility timeout avoid that.' },
    { type: 'index', q: 'Which index best supports: WHERE status = \'queued\' AND run_at <= now() ORDER BY priority DESC, run_at, id LIMIT 10?', options: ['CREATE INDEX ON job_queue (status)', 'CREATE INDEX ON job_queue (priority DESC, run_at, id) WHERE status = \'queued\'', 'CREATE INDEX ON job_queue USING hash (status)', 'CREATE INDEX ON job_queue (payload)'], answer: 1, explain: 'A partial index on ready jobs, sorted like the ORDER BY, lets the planner read the first rows directly and stays small.' }
  ]
}
]);

PGM.addLessons([
/* ===================================================================
   MODULE: mvcc
   =================================================================== */
{
  id: 'mvcc-tuple-versions',
  module: 'mvcc',
  title: 'MVCC Fundamentals: Tuple Versions, xmin, xmax and ctid',
  level: 4,
  minutes: 24,
  summary: 'How PostgreSQL keeps multiple versions of each row so that readers never block writers, and how to see those versions through xmin, xmax and ctid.',
  objectives: [
    'Explain multi-version concurrency control and why "readers don\'t block writers"',
    'Read the system columns xmin, xmax and ctid and interpret their values',
    'Show that an UPDATE writes a new tuple version and a DELETE only marks the old one',
    'Follow the t_ctid chain from an old version to its successor with pageinspect',
    'Relate MVCC to the need for VACUUM'
  ],
  concept: `<p><strong>MVCC (Multi-Version Concurrency Control)</strong> means PostgreSQL never overwrites a row in place. Every INSERT creates a <em>tuple</em> (a physical row version); every UPDATE creates a <em>new</em> tuple and marks the old one as superseded; every DELETE marks the existing tuple as deleted. Each transaction sees the version that was current according to its <strong>snapshot</strong>.</p>
<p>Each heap tuple carries hidden system columns:</p>
<ul>
<li><code>xmin</code> — the transaction ID (XID) that <em>created</em> this version.</li>
<li><code>xmax</code> — the XID that <em>deleted or superseded</em> it (0 if none), or that locked it (row locks reuse this field).</li>
<li><code>ctid</code> — the physical location <code>(page, line pointer)</code> of this version in the table file. After an UPDATE, the old version's header points (<code>t_ctid</code>) to the new version, forming an update chain.</li>
</ul>
<p>Analogy: a shared Google Doc with full version history instead of a whiteboard. A writer never erases what readers are looking at; they add a new revision. Each reader keeps looking at the revision that was current when they started reading. Old revisions are garbage-collected later when nobody can still be looking at them — that janitor is <strong>VACUUM</strong>.</p>
<p>Result: a SELECT never waits for an UPDATE on the same rows, and an UPDATE never waits for a SELECT. Only writers that touch the <em>same row</em> wait for each other.</p>
<div class="callout info">Timeline: Session A runs a 30-second report with <code>SELECT sum(total_amount) FROM orders</code>. At second 10, Session B updates order 42 and commits. Session A's sum still uses the old version of order 42 (its snapshot predates B's commit) and never waits; B never waits for A either.</div>`,
  why: `<p>Lock-based concurrency (readers take shared locks, writers take exclusive locks) makes long reports block writes and vice versa. MVCC trades disk space and background cleanup for concurrency: storing extra row versions lets every transaction read a consistent snapshot without locks. It is also the foundation of PostgreSQL's isolation levels.</p>`,
  useCase: `<p>A payments company runs an end-of-day settlement report that scans 300M payment rows for 25 minutes while 3,000 payments per second continue to be inserted and updated. Thanks to MVCC the report sees a consistent snapshot as of its start and neither blocks nor is blocked by OLTP traffic. The cost: rows updated during those 25 minutes cannot be vacuumed until the report finishes, so the team keeps such reports on a replica or caps their duration.</p>`,
  internals: `<ul>
<li>A heap page (8 kB) has a header, an array of <strong>line pointers</strong> (item ids) growing forward, and tuples growing backward from the end. <code>ctid = (block, offset)</code> addresses a line pointer, so tuples can be moved within a page (during pruning) without changing their ctid.</li>
<li>Each tuple header (23 bytes + alignment) stores <code>t_xmin</code>, <code>t_xmax</code>, <code>t_cid</code> (command id inside the transaction), <code>t_ctid</code>, <code>t_infomask</code>/<code>t_infomask2</code> (status flags, hint bits, number of attributes) and the null bitmap.</li>
<li>INSERT: new tuple with xmin = current XID, xmax = 0. DELETE: sets xmax on the existing tuple. UPDATE: sets xmax on the old tuple, writes a new tuple (xmin = current XID) and points the old <code>t_ctid</code> to it.</li>
<li>Indexes point to ctids. A non-HOT update must insert a new entry in <em>every</em> index of the table, even for unchanged columns (see the HOT lesson).</li>
<li>ctid is <strong>not</strong> a stable row identifier: it changes on UPDATE, VACUUM FULL, CLUSTER and dump/restore. Never store it.</li>
</ul>`,
  whenNot: `<p>MVCC is not optional, but you should avoid workloads that fight it: updating the same row thousands of times per second (counters), keeping transactions open for hours, and "update every row" batch jobs without considering bloat. For a hot counter, aggregate in memory or use multiple counter rows; for mass changes, consider creating a new table and swapping.</p>`,
  syntax: `SELECT xmin, xmax, ctid, * FROM table_name;          -- hidden system columns
SELECT pg_current_xact_id();                          -- XID of the current transaction (xid8)

-- pageinspect extension (superuser by default)
CREATE EXTENSION pageinspect;
SELECT lp, t_xmin, t_xmax, t_ctid FROM heap_page_items(get_raw_page('t', 0));`,
  examples: [
    {
      label: 'Basic',
      title: 'Watch xmin, xmax and ctid change across INSERT, UPDATE and DELETE',
      sql: `CREATE TABLE ver_demo (id int PRIMARY KEY, status text);

BEGIN;
INSERT INTO ver_demo VALUES (1, 'pending'), (2, 'pending');
COMMIT;
SELECT ctid, xmin, xmax, * FROM ver_demo ORDER BY id;

BEGIN;
UPDATE ver_demo SET status = 'paid' WHERE id = 1;     -- new version of row 1
COMMIT;

BEGIN;
DELETE FROM ver_demo WHERE id = 2;                    -- row 2 only gets an xmax
COMMIT;

SELECT ctid, xmin, xmax, * FROM ver_demo ORDER BY id;
DROP TABLE ver_demo;`,
      explain: `<p>After the insert both rows have the same <code>xmin</code> (created by one transaction) and <code>xmax = 0</code> (alive). The UPDATE produced a <em>new</em> tuple for id 1 at <code>(0,3)</code> with a new <code>xmin</code>. The deleted row 2 is no longer visible to us — but it is still physically on the page, as the next example proves. Exact XID numbers differ on your machine; what matters is that they increase and change exactly as described.</p>`,
      output: ` ctid  | xmin | xmax | id | status
-------+------+------+----+---------
 (0,1) |  754 |    0 |  1 | pending
 (0,2) |  754 |    0 |  2 | pending

 ctid  | xmin | xmax | id | status
-------+------+------+----+--------
 (0,3) |  755 |    0 |  1 | paid
(1 row)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'See the dead versions on the page with pageinspect',
      sql: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE ver_demo (id int PRIMARY KEY, status text);
BEGIN; INSERT INTO ver_demo VALUES (1, 'pending'), (2, 'pending'); COMMIT;
BEGIN; UPDATE ver_demo SET status = 'paid' WHERE id = 1; COMMIT;
BEGIN; DELETE FROM ver_demo WHERE id = 2; COMMIT;

-- every tuple physically present in block 0, visible or not
SELECT lp, t_ctid, t_xmin, t_xmax,
       CASE WHEN t_xmax = 0 THEN 'live'
            ELSE 'dead once xmax committed' END AS state
FROM heap_page_items(get_raw_page('ver_demo', 0))
ORDER BY lp;
DROP TABLE ver_demo;`,
      explain: `<p><code>get_raw_page</code> reads block 0 of the table; <code>heap_page_items</code> decodes each line pointer. Line pointer 1 is the original version of row 1: <code>t_xmax</code> = the updating XID and <code>t_ctid = (0,3)</code> points to its successor. Line pointer 2 is the deleted row 2: still there, with <code>t_xmax</code> = the deleting XID and <code>t_ctid</code> pointing to itself. Line pointer 3 is the live version. Three tuples occupy space for only one visible row — this is what VACUUM cleans up.</p>`,
      output: ` lp | t_ctid | t_xmin | t_xmax | state
----+--------+--------+--------+--------------------------
  1 | (0,3)  |    755 |    756 | dead once xmax committed
  2 | (0,2)  |    755 |    757 | dead once xmax committed
  3 | (0,3)  |    756 |      0 | live
(3 rows)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Readers see their snapshot while a writer changes the row',
      sql: `CREATE TABLE price_demo (id int PRIMARY KEY, price numeric);
INSERT INTO price_demo VALUES (1, 100);

-- One session can only simulate this: a REPEATABLE READ snapshot is taken at the
-- first query; later changes by OTHER transactions stay invisible to it.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT xmin, ctid, price FROM price_demo WHERE id = 1;     -- snapshot taken here

-- our own changes ARE visible to us (own XID is always visible)
UPDATE price_demo SET price = 120 WHERE id = 1;
SELECT xmin, ctid, price FROM price_demo WHERE id = 1;
COMMIT;

SELECT xmin, ctid, price FROM price_demo WHERE id = 1;
DROP TABLE price_demo;`,
      explain: `<p>Within one session you see your own update immediately (new ctid <code>(0,2)</code>, new xmin = your XID). In a real two-session timeline, a second session that had started a REPEATABLE READ transaction before this UPDATE committed would keep reading <code>price = 100</code> from tuple <code>(0,1)</code> — without waiting — until it ends; a READ COMMITTED session would see 120 in its <em>next</em> statement after the commit. The writer never waited for the reader either. See the lab widget for the two-session version.</p>`,
      output: ` xmin | ctid  | price
------+-------+-------
  754 | (0,1) |   100

 xmin | ctid  | price
------+-------+-------
  755 | (0,2) |   120

 xmin | ctid  | price
------+-------+-------
  755 | (0,2) |   120`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Using ctid as a row identifier in application code
CREATE TABLE t (id int, v text);
INSERT INTO t VALUES (1, 'a');
SELECT ctid FROM t WHERE id = 1;          -- app stores '(0,1)'
UPDATE t SET v = 'b' WHERE id = 1;
SELECT * FROM t WHERE ctid = '(0,1)';     -- 0 rows: the row moved`,
      why: 'ctid is a physical address of one version. Any UPDATE (or VACUUM FULL, CLUSTER, restore) gives the row a new ctid, so stored ctids silently point to nothing or to a different row.',
      run: true
    },
    good: {
      sql: `-- Use a real key: stable across updates and rewrites
CREATE TABLE t (id int PRIMARY KEY, v text);
INSERT INTO t VALUES (1, 'a');
UPDATE t SET v = 'b' WHERE id = 1;
SELECT * FROM t WHERE id = 1;`,
      why: 'Primary keys identify the logical row; MVCC versions come and go underneath without affecting it.',
      run: true
    }
  },
  mistakes: [
    'Believing UPDATE modifies the row in place — it writes a whole new version (all columns), which is why "UPDATE every row" doubles a table\'s size.',
    'Storing or comparing <code>ctid</code> values across transactions as identifiers.',
    'Assuming a deleted row frees space immediately; it stays until VACUUM removes it and the space can be reused (the file usually does not shrink).',
    'Leaving transactions open (e.g. "idle in transaction" sessions): old versions cannot be removed while any snapshot might need them.',
    'Reading <code>xmax &lt;&gt; 0</code> as "deleted": xmax is also set by row locks and by aborted updates.'
  ],
  best: [
    'Keep transactions short so old versions become removable quickly.',
    'Use system columns and pageinspect for learning and diagnostics only, not in application logic.',
    'Batch large updates and let autovacuum keep up, or rebuild into a new table for one-off mass changes.',
    'Run long analytical reads on replicas when they would otherwise delay cleanup on the primary.',
    'Monitor <code>n_dead_tup</code> and the oldest transaction age (<code>pg_stat_activity.backend_xmin</code>).'
  ],
  performance: `<p>MVCC makes reads lock-free but adds per-row overhead (23-byte header), write amplification (every UPDATE writes a full new tuple and usually new index entries), and background work (VACUUM). Workloads with many updates benefit from HOT updates (keep indexed columns unchanged, leave free space with fillfactor) and from aggressive autovacuum on hot tables.</p>`,
  security: `<p>Old row versions are physically present in data files until vacuumed and the space overwritten. Deleting personal data with DELETE does not immediately erase it from disk (or from WAL, backups and replicas). For "right to erasure" requirements, combine deletion with VACUUM, backup retention policies, and possibly encryption-at-rest with key rotation.</p>`,
  scenario: {
    title: 'A table doubled in size after a "harmless" backfill',
    steps: [
      '1. A migration ran UPDATE customers SET segment = lower(segment) on 80M rows in one transaction.',
      '2. pg_relation_size jumped from 40 GB to 81 GB; n_dead_tup = 80M; all indexes grew too.',
      '3. Explain the cause: each UPDATE wrote a new tuple version and new index entries for every index.',
      '4. Let autovacuum (or a manual VACUUM) mark the old versions reusable — size on disk stays ~81 GB but future inserts reuse the space.',
      '5. If disk must be returned, schedule pg_repack (third-party) or VACUUM FULL in a maintenance window.',
      '6. Next time: backfill in batches of 10k rows by primary key with pauses, so VACUUM recycles space between batches.'
    ]
  },
  widgets: ['diagram:mvcc', 'lab:mvcc'],
  interview: [
    { q: 'What do xmin and xmax mean?', a: 'xmin is the ID of the transaction that created the tuple version; xmax is the ID of the transaction that deleted or superseded it (or locked it), 0 if none. Visibility is decided by comparing these XIDs with the reader\'s snapshot and the commit status of those transactions.' },
    { q: 'Why does MVCC mean readers do not block writers?', a: 'Writers create new versions instead of modifying existing ones in place, so readers can keep reading the version that matches their snapshot without taking locks that conflict with writers. Writers only wait for other writers touching the same rows.' },
    { q: 'What happens physically during an UPDATE in PostgreSQL?', a: 'The old tuple gets xmax set to the updating XID and its t_ctid pointed at the new tuple; a complete new tuple is written with xmin = updating XID, either on the same page (possibly HOT) or another page; unless the update is HOT, a new entry is inserted into every index. The old version becomes dead after commit and is reclaimed by VACUUM once no snapshot needs it.' },
    { q: 'Why is ctid not a good row identifier?', a: 'It is the physical location of a specific tuple version. UPDATE creates a new version at a different ctid, and VACUUM FULL, CLUSTER or a dump/restore relocate all rows. Use a primary key.' }
  ],
  exercises: [
    {
      task: 'Create a table, insert a row, update it three times in separate transactions, and use pageinspect to show the 4 versions and their t_ctid chain.',
      solution: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE chain (id int, v int);
BEGIN; INSERT INTO chain VALUES (1, 0); COMMIT;
BEGIN; UPDATE chain SET v = 1; COMMIT;
BEGIN; UPDATE chain SET v = 2; COMMIT;
BEGIN; UPDATE chain SET v = 3; COMMIT;
SELECT lp, t_xmin, t_xmax, t_ctid FROM heap_page_items(get_raw_page('chain', 0)) ORDER BY lp;
DROP TABLE chain;`,
      run: true
    },
    {
      task: 'Show that a DELETE that is rolled back leaves xmax set on the row while the row remains visible.',
      solution: `CREATE TABLE rb (id int);
INSERT INTO rb VALUES (1);
BEGIN; DELETE FROM rb WHERE id = 1; ROLLBACK;
SELECT xmin, xmax, * FROM rb;
DROP TABLE rb;`,
      run: true
    }
  ],
  challenge: {
    task: 'Measure MVCC write amplification: copy orders into a new table, record its size, run an UPDATE that "changes" every row to the same value, and show size before/after plus the number of dead tuples reported for this transaction.',
    hint: 'pg_relation_size before and after; pg_stat_xact_user_tables.n_tup_upd shows this transaction\'s updates.',
    solution: `BEGIN;
CREATE TABLE o_copy AS SELECT * FROM orders;
SELECT pg_size_pretty(pg_relation_size('o_copy')) AS before;
UPDATE o_copy SET total_amount = total_amount;
SELECT pg_size_pretty(pg_relation_size('o_copy')) AS after_update,
       (SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relname = 'o_copy') AS versions_written;
ROLLBACK;`,
    run: true
  },
  related: ['mvcc-snapshots-visibility', 'mvcc-consequences-hot', 'vacuum', 'isolation-levels'],
  quiz: [
    { type: 'mcq', q: 'After UPDATE t SET v = 2 WHERE id = 1 commits, what is physically in the table?', options: ['One tuple with v = 2', 'Two tuples: the old one with xmax set, and a new one with v = 2', 'One tuple with v = 2 and an undo record elsewhere', 'Only an index change'], answer: 1, explain: 'PostgreSQL stores old versions in the table itself (no undo log); the old tuple remains until VACUUM removes it.' },
    { type: 'tf', q: 'A long-running SELECT blocks UPDATEs on the rows it reads.', answer: false, explain: 'Under MVCC, plain SELECTs take no row locks; writers create new versions and do not wait for readers.' },
    { type: 'predict', q: 'What does the last query return?', code: `INSERT INTO t VALUES (1);       -- ctid (0,1)
UPDATE t SET id = 1;
SELECT ctid FROM t;`, options: ['(0,1)', '(0,2)', '(1,1)', 'NULL'], answer: 1, explain: 'The update wrote a new version, normally right after the old one on the same page: (0,2).' },
    { type: 'mcq', q: 'Which process eventually removes dead tuple versions?', options: ['The checkpointer', 'VACUUM (manual or autovacuum)', 'The WAL writer', 'ANALYZE'], answer: 1, explain: 'VACUUM (and opportunistic page pruning) reclaims space used by versions no snapshot can see.' }
  ]
},
{
  id: 'mvcc-snapshots-visibility',
  module: 'mvcc',
  title: 'Snapshots and Visibility Rules: XIDs, pg_current_snapshot, Hint Bits and the Commit Log',
  level: 4,
  minutes: 24,
  summary: 'Exactly how PostgreSQL decides whether a tuple version is visible: snapshots (xmin:xmax:xip), the commit log (pg_xact), and hint bits cached in tuple headers.',
  objectives: [
    'Read a snapshot (xmin:xmax:xip_list) from pg_current_snapshot() and explain each part',
    'Apply the visibility rules for a tuple given its xmin, xmax and a snapshot',
    'Use pg_current_xact_id(), pg_current_xact_id_if_assigned() and pg_xact_status()',
    'Explain hint bits, why the first read after a bulk load writes to disk, and the role of pg_xact',
    'Contrast snapshot timing in READ COMMITTED and REPEATABLE READ'
  ],
  concept: `<p>A <strong>snapshot</strong> is the answer to "which transactions' effects may I see?". PostgreSQL represents it as <code>xmin:xmax:xip_list</code>:</p>
<ul>
<li><code>xmin</code> — the oldest transaction still running when the snapshot was taken. Every XID &lt; xmin is finished (committed or aborted).</li>
<li><code>xmax</code> — one past the highest completed XID. Every XID ≥ xmax had not started (or not finished) and is <em>invisible</em>.</li>
<li><code>xip_list</code> — XIDs in [xmin, xmax) that were still in progress; they are invisible too.</li>
</ul>
<p>A tuple version is visible to a snapshot when (simplified): its <strong>creator</strong> <code>xmin</code> is committed and "before" the snapshot (not in progress, &lt; snapshot xmax) — or it is the current transaction; <strong>and</strong> its <code>xmax</code> is 0, aborted, a lock-only marker, or a transaction that is not yet visible to the snapshot.</p>
<p>To know whether an XID committed or aborted, PostgreSQL consults the <strong>commit log</strong> (<code>pg_xact</code>, formerly <code>pg_clog</code>): 2 bits per transaction (in progress / committed / aborted / sub-committed). Because looking that up for every tuple would be expensive, the first reader that learns the outcome sets <strong>hint bits</strong> in the tuple header (<code>HEAP_XMIN_COMMITTED</code>, <code>HEAP_XMIN_INVALID</code>, <code>HEAP_XMAX_COMMITTED</code>, <code>HEAP_XMAX_INVALID</code>), so later readers skip the lookup.</p>
<p>Analogy: a newspaper archive with a guest list. Your snapshot is the guest list printed when you walked in: anyone who arrived later (≥ xmax) or was still in the cloakroom (xip) does not count. The commit log is the official register; hint bits are pencil notes on each page saying "already checked: confirmed".</p>`,
  why: `<p>Understanding visibility explains many "mysteries": why a REPEATABLE READ transaction does not see new rows, why <code>SELECT count(*)</code> after a big load is slow and generates writes, why rolled-back inserts take space, why one idle-in-transaction session stops VACUUM, and why XIDs must eventually be frozen.</p>`,
  useCase: `<p>A data team loaded 200M rows with COPY at night. The first morning dashboard query took 9 minutes instead of 2 and the disk showed heavy <em>writes</em>. Cause: every tuple's hint bits had to be set on first read (each page dirtied and written back, and with checksums or <code>wal_log_hints</code> also WAL-logged as full-page images). Fix: run <code>VACUUM (ANALYZE)</code> right after the load (it sets hint bits, the visibility map, and statistics), or <code>COPY ... FREEZE</code> into a table created or truncated in the same transaction.</p>`,
  internals: `<ul>
<li><strong>XID assignment is lazy</strong>: a transaction gets a real XID only when it first writes. Read-only transactions use only a <em>virtual</em> XID (<code>backendID/localXID</code>). That is why <code>pg_current_xact_id_if_assigned()</code> returns NULL until the first write, while <code>pg_current_xact_id()</code> forces assignment.</li>
<li><strong>Snapshot timing</strong>: READ COMMITTED takes a new snapshot at the start of <em>each statement</em>; REPEATABLE READ and SERIALIZABLE take one at the first statement of the transaction and keep it.</li>
<li><strong>Own changes</strong> are visible via the command id (<code>cmin/cmax</code>): a statement sees rows inserted by earlier statements of the same transaction, but not rows inserted by itself (prevents Halloween problems).</li>
<li><strong>Visibility check order</strong> (<code>HeapTupleSatisfiesMVCC</code>): check hint bits → if absent, is xmin my own? in progress (via the ProcArray)? committed in pg_xact? → set hint bits when the outcome is final → evaluate xmax similarly.</li>
<li><strong>pg_xact</strong> is stored in 8 kB SLRU pages (32,768 transactions per page) cached in shared memory; old segments are truncated once all databases have frozen past them.</li>
<li><strong>Hint bits are not WAL-logged</strong> by themselves; if data checksums or <code>wal_log_hints</code> are enabled, the first hint-bit change on a page after a checkpoint emits a full-page image.</li>
</ul>`,
  whenNot: `<p>Do not build application logic on XIDs or snapshots (e.g. "rows changed since xid N") — XIDs wrap around and are per-cluster. For change tracking use <code>updated_at</code> columns, logical decoding/replication, or <code>track_commit_timestamp</code> with care.</p>`,
  syntax: `SELECT pg_current_xact_id();                    -- xid8, assigns an XID if needed
SELECT pg_current_xact_id_if_assigned();        -- NULL for read-only so far
SELECT pg_current_snapshot();                   -- e.g. 757:760:757,759
SELECT pg_snapshot_xmin(s), pg_snapshot_xmax(s), pg_snapshot_xip(s);
SELECT pg_visible_in_snapshot(xid8, snapshot);
SELECT pg_xact_status(xid8);                    -- 'committed' | 'aborted' | 'in progress' | NULL
-- legacy (32-bit with epoch) equivalents: txid_current(), txid_current_snapshot(), txid_status()`,
  examples: [
    {
      label: 'Basic',
      title: 'Lazy XID assignment and reading a snapshot',
      sql: `BEGIN ISOLATION LEVEL REPEATABLE READ;
-- read-only so far: no XID assigned yet, only a virtual transaction id
SELECT pg_current_xact_id_if_assigned() AS my_xid,
       pg_current_snapshot()             AS snapshot,
       (SELECT virtualtransaction FROM pg_locks
        WHERE pid = pg_backend_pid() AND locktype = 'virtualxid') AS vxid;

CREATE TEMP TABLE snap_t (id int);
INSERT INTO snap_t VALUES (1);        -- first write: an XID is assigned now

SELECT pg_current_xact_id_if_assigned()  AS my_xid,
       pg_current_snapshot()             AS snapshot_unchanged,
       pg_visible_in_snapshot(pg_current_xact_id(), pg_current_snapshot()) AS own_xid_in_snapshot,
       pg_xact_status(pg_current_xact_id()) AS status;
COMMIT;`,
      explain: `<p>The first SELECT shows <code>my_xid</code> NULL: reading never consumes XIDs (important for wraparound — only writes do). The snapshot <code>753:753:</code> means "everything below 757 is finished, nothing is in progress". After the INSERT, the transaction got XID 753. Its REPEATABLE READ snapshot did not change — and <code>pg_visible_in_snapshot</code> says our own XID is <em>not</em> in the snapshot; we still see our own rows because "own XID" is checked separately. <code>pg_xact_status</code> reports <em>in progress</em> until COMMIT. Numbers will differ for you.</p>`,
      output: ` my_xid | snapshot | vxid
--------+----------+------
        | 753:753: | 0/3

 my_xid | snapshot_unchanged | own_xid_in_snapshot | status
--------+--------------------+---------------------+-------------
    753 | 753:753:           | f                   | in progress`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Hint bits: the first read writes to the page',
      sql: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE hb (id int, v text);
BEGIN; INSERT INTO hb VALUES (1, 'committed');   COMMIT;
BEGIN; INSERT INTO hb VALUES (2, 'rolled back'); ROLLBACK;

-- before anyone reads: no commit/abort hints on xmin yet
SELECT lp, t_xmin,
       (t_infomask & 256)  > 0 AS xmin_committed,   -- HEAP_XMIN_COMMITTED  0x0100
       (t_infomask & 512)  > 0 AS xmin_invalid,     -- HEAP_XMIN_INVALID    0x0200
       (t_infomask & 2048) > 0 AS xmax_invalid      -- HEAP_XMAX_INVALID    0x0800
FROM heap_page_items(get_raw_page('hb', 0));

SELECT * FROM hb;                                   -- visibility check consults pg_xact, sets hints

SELECT lp, t_xmin,
       (t_infomask & 256)  > 0 AS xmin_committed,
       (t_infomask & 512)  > 0 AS xmin_invalid,
       pg_xact_status(t_xmin::text::xid8) AS clog_status
FROM heap_page_items(get_raw_page('hb', 0));
DROP TABLE hb;`,
      explain: `<p>The rolled-back insert still occupies line pointer 2 — aborted rows take space until VACUUM. Initially neither tuple has an xmin hint, so the first <code>SELECT * FROM hb</code> must look up both XIDs in the commit log; it then sets <code>HEAP_XMIN_COMMITTED</code> on tuple 1 and <code>HEAP_XMIN_INVALID</code> on tuple 2, dirtying the page. Subsequent readers decide visibility from the header alone. <code>pg_xact_status</code> reads the same commit log the executor used.</p>`,
      output: ` lp | t_xmin | xmin_committed | xmin_invalid | xmax_invalid
----+--------+----------------+--------------+--------------
  1 |    755 | f              | f            | t
  2 |    756 | f              | f            | t

 id | v
----+-----------
  1 | committed

 lp | t_xmin | xmin_committed | xmin_invalid | clog_status
----+--------+----------------+--------------+-------------
  1 |    755 | t              | f            | committed
  2 |    756 | f              | t            | aborted`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Command IDs: what a statement sees of its own transaction',
      sql: `BEGIN;
CREATE TEMP TABLE cmd_demo (id int);
INSERT INTO cmd_demo VALUES (1);                    -- command n
INSERT INTO cmd_demo VALUES (2);                    -- command n+1
INSERT INTO cmd_demo SELECT id + 10 FROM cmd_demo;  -- reads only rows from EARLIER commands
SELECT xmin, cmin, id FROM cmd_demo ORDER BY id;

UPDATE cmd_demo SET id = id + 100 WHERE id = 1;     -- new version gets the next command id
SELECT xmin, cmin, xmax, id FROM cmd_demo ORDER BY id;
COMMIT;`,
      explain: `<p>All rows share one <code>xmin</code> (same transaction); visibility <em>inside</em> a transaction is decided by the command id (<code>cmin</code> for the creating command, <code>cmax</code> for the deleting one). The <code>INSERT ... SELECT</code> sees rows 1 and 2 but not the rows it is inserting itself (they carry its own command id), so it adds exactly two rows instead of looping forever — the protection against the "Halloween problem". The UPDATE's new version gets the next command id. In READ COMMITTED a new snapshot is also taken per statement (so committed work of <em>other</em> sessions appears between statements), while REPEATABLE READ keeps the first snapshot; command ids work the same in both. Starting cmin values depend on earlier commands (the CREATE also consumed some).</p>`,
      output: ` xmin | cmin | id
------+------+----
  753 |    3 |  1
  753 |    4 |  2
  753 |    5 | 11
  753 |    5 | 12

 xmin | cmin | xmax | id
------+------+------+-----
  753 |    4 |    0 |   2
  753 |    5 |    0 |  11
  753 |    5 |    0 |  12
  753 |    6 |    0 | 101`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- "Has this change been committed?" by guessing from ordering of ids
SELECT max(id) FROM orders;   -- assumes ids appear in commit order`,
      why: 'Identity/sequence values are assigned at INSERT time, not commit time. A transaction holding id 5001 may commit after one holding 5002, so "rows with id > last_seen" pollers miss rows.',
      run: true
    },
    good: {
      sql: `-- Use the commit-status function for a specific transaction id (xid8)
BEGIN;
CREATE TEMP TABLE probe (id int);
INSERT INTO probe VALUES (1);
SELECT pg_current_xact_id() AS xid, pg_xact_status(pg_current_xact_id()) AS status;
COMMIT;`,
      why: 'pg_xact_status answers the real question (committed/aborted/in progress) for an XID, e.g. to resolve the outcome of a transaction whose COMMIT reply was lost by the network.',
      run: true
    }
  },
  mistakes: [
    'Expecting a REPEATABLE READ transaction to see rows committed by others after its first query.',
    'Polling for new rows with <code>id &gt; last_max_id</code>: ids are assigned before commit, so late committers are skipped.',
    'Being surprised that the first SELECT after a bulk load is slow and causes writes (hint bits) — run VACUUM after big loads.',
    'Calling <code>txid_current()</code> / <code>pg_current_xact_id()</code> in read-only monitoring code, which needlessly consumes an XID per call.',
    'Thinking a rolled-back transaction leaves no trace: its tuples stay on disk until vacuumed.'
  ],
  best: [
    'Use <code>pg_current_xact_id_if_assigned()</code> in diagnostics so you do not burn XIDs.',
    'After large loads run <code>VACUUM (ANALYZE)</code>, or use <code>COPY ... WITH (FREEZE)</code> for tables created/truncated in the same transaction.',
    'Store the XID returned by <code>pg_current_xact_id()</code> before COMMIT if the client must resolve an ambiguous commit later with <code>pg_xact_status()</code>.',
    'Prefer xid8-based functions (<code>pg_current_xact_id</code>, <code>pg_current_snapshot</code>) over legacy <code>txid_*</code> ones in new code.'
  ],
  performance: `<p>Visibility checks are cheap when hint bits are set; without them each tuple may require a commit-log lookup (fast when cached, but SLRU contention appears at very high rates). Setting hint bits dirties pages: after bulk loads this causes a one-time write storm, and with checksums enabled it also generates full-page WAL. Snapshot acquisition scales well since PG 14's snapshot scalability work, but thousands of connections still make <code>GetSnapshotData</code> measurable — use a pooler.</p>`,
  security: `<p>XIDs and snapshots reveal activity levels of a cluster (how many write transactions occur). They are not sensitive in most systems, but monitoring functions over <code>pg_stat_activity</code> expose other users' queries only to roles with <code>pg_read_all_stats</code> or the same role.</p>`,
  scenario: {
    title: 'Morning dashboards slow after a nightly bulk load',
    steps: [
      '1. Observe: first dashboard queries read 200 GB and also write ~200 GB; pg_stat_bgwriter / pg_stat_io show many backend writes.',
      '2. Explain: newly loaded tuples have no hint bits; the first reader sets them on every page, dirtying everything.',
      '3. Confirm with pageinspect on a sample page: t_infomask lacks HEAP_XMIN_COMMITTED.',
      '4. Fix: append VACUUM (ANALYZE) of the loaded tables to the ETL job, so hints, the visibility map and statistics are ready before users arrive.',
      '5. Better for new tables: CREATE/TRUNCATE + COPY ... WITH (FREEZE) in one transaction writes tuples already frozen.',
      '6. Verify: next morning the dashboards are fast and index-only scans work (visibility map set).'
    ]
  },
  widgets: ['diagram:mvcc', 'lab:mvcc'],
  interview: [
    { q: 'What do the three parts of a snapshot like 100:105:101,103 mean?', a: 'xmin = 100: all XIDs below 100 are finished. xmax = 105: XIDs 105 and above are not visible (not yet started or finished when the snapshot was taken). xip = 101,103: those transactions were in progress, so their changes are invisible. XIDs 100, 102 and 104 are finished and visible if they committed.' },
    { q: 'What are hint bits and why do they exist?', a: 'Bits in the tuple header (xmin committed/invalid, xmax committed/invalid) that cache the final outcome of the creating/deleting transactions. They avoid repeated commit-log (pg_xact) lookups. They are set lazily by the first reader that learns the outcome, which dirties the page.' },
    { q: 'Why does a read-only transaction not consume a transaction ID?', a: 'XIDs are assigned lazily at the first data modification. Read-only transactions only get a virtual transaction ID, which is not persisted, does not advance the XID counter and therefore does not contribute to wraparound pressure.' },
    { q: 'How can a client find out whether a transaction committed if the connection dropped during COMMIT?', a: 'Fetch pg_current_xact_id() before issuing COMMIT and store it. After reconnecting, call pg_xact_status(xid): committed, aborted, or in progress (NULL if too old and truncated from the commit log).' }
  ],
  exercises: [
    {
      task: 'In one transaction show that pg_current_xact_id_if_assigned() is NULL before the first write and non-NULL after it.',
      solution: `BEGIN;
SELECT pg_current_xact_id_if_assigned() AS before_write;
CREATE TEMP TABLE w (id int);
INSERT INTO w VALUES (1);
SELECT pg_current_xact_id_if_assigned() AS after_write;
ROLLBACK;`,
      run: true
    },
    {
      task: 'Decompose the current snapshot into xmin, xmax and the in-progress list.',
      solution: `SELECT pg_snapshot_xmin(s) AS xmin, pg_snapshot_xmax(s) AS xmax,
       ARRAY(SELECT pg_snapshot_xip(s)) AS in_progress
FROM (SELECT pg_current_snapshot() AS s) x;`,
      run: true
    }
  ],
  challenge: {
    task: 'Write a query that, for every tuple on page 0 of a table, reports its xmin, the commit status of xmin, and whether its xmin is visible in the current snapshot. Create rows from one committed and one aborted transaction first.',
    hint: 'Convert xid to xid8 with t_xmin::text::xid8 (fine for a young cluster); use pg_xact_status() and pg_visible_in_snapshot().',
    solution: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE vis (id int);
BEGIN; INSERT INTO vis VALUES (1); COMMIT;
BEGIN; INSERT INTO vis VALUES (2); ROLLBACK;
SELECT lp, t_xmin,
       pg_xact_status(t_xmin::text::xid8) AS status,
       pg_visible_in_snapshot(t_xmin::text::xid8, pg_current_snapshot()) AS in_snapshot
FROM heap_page_items(get_raw_page('vis', 0))
ORDER BY lp;
DROP TABLE vis;`,
    run: true
  },
  related: ['mvcc-tuple-versions', 'mvcc-consequences-hot', 'transaction-internals', 'isolation-levels'],
  quiz: [
    { type: 'mcq', q: 'Snapshot 200:210:203. Which XID\'s committed changes are visible?', options: ['203', '210', '205', '215'], answer: 2, explain: '205 is ≥ xmin, < xmax and not in the in-progress list, so if it committed it is visible. 203 was in progress; 210 and 215 are ≥ xmax.' },
    { type: 'tf', q: 'Under READ COMMITTED, a transaction uses the same snapshot for all its statements.', answer: false, explain: 'READ COMMITTED takes a new snapshot per statement; REPEATABLE READ and SERIALIZABLE keep one per transaction.' },
    { type: 'mcq', q: 'Why might the first SELECT after a large COPY generate heavy disk writes?', options: ['Autovacuum starts', 'It sets hint bits on every page, dirtying them', 'It rebuilds indexes', 'It writes WAL for the SELECT itself'], answer: 1, explain: 'The first reader records commit status in tuple headers (hint bits), making each page dirty.' },
    { type: 'predict', q: 'What does this return in a fresh transaction that has not written anything?', code: `BEGIN;
SELECT pg_current_xact_id_if_assigned();`, options: ['A new XID', 'NULL', '0', 'An error'], answer: 1, explain: 'No XID is assigned until the first write.' }
  ]
},
{
  id: 'mvcc-consequences-hot',
  module: 'mvcc',
  title: 'MVCC Consequences: Dead Tuples, HOT Updates, fillfactor and pageinspect',
  level: 4,
  minutes: 25,
  summary: 'Why UPDATE = INSERT + DELETE, how dead tuples accumulate, how Heap-Only Tuple (HOT) updates avoid index writes, and how to tune fillfactor and inspect pages.',
  objectives: [
    'Explain why an UPDATE costs roughly an INSERT plus a DELETE, including index maintenance',
    'Describe the conditions for a HOT update and how page pruning reclaims space without VACUUM',
    'Measure HOT ratio with pg_stat_user_tables.n_tup_hot_upd and improve it with fillfactor',
    'Inspect redirect, dead and unused line pointers with pageinspect after VACUUM',
    'Recognise designs that defeat HOT (indexing frequently-updated columns)'
  ],
  concept: `<p>Because of MVCC, an UPDATE writes a complete new tuple and leaves the old one behind: logically it is <strong>INSERT new version + DELETE old version</strong>. Without further optimisation, every index of the table also gets a new entry pointing at the new ctid, even if no indexed column changed. A table with 8 indexes thus performs 9 writes per updated row.</p>
<p><strong>HOT (Heap-Only Tuple)</strong> updates avoid that index work. An update is HOT when:</p>
<ol>
<li>no column used by any index (including partial-index predicates and expression indexes) changes value, and</li>
<li>the new version fits on the <em>same page</em> as the old one.</li>
</ol>
<p>Then the new tuple is marked <code>HEAP_ONLY_TUPLE</code>, the old one <code>HEAP_HOT_UPDATED</code>, and indexes keep pointing at the old line pointer; readers follow the chain within the page. Later, <strong>page pruning</strong> (done opportunistically by any query that reads a page that is getting full) removes dead HOT-chain members and turns the root line pointer into a <em>redirect</em> — reclaiming space <em>without</em> VACUUM.</p>
<p><strong>fillfactor</strong> (table storage parameter, default 100 for tables) reserves free space on each page during inserts, e.g. <code>fillfactor = 80</code> leaves 20% so future updates can stay on the same page and be HOT.</p>
<p>Analogy: a filing cabinet with an index card catalogue. Normally, revising a document means filing the new copy wherever there is space and writing new catalogue cards in every catalogue. A HOT update is slipping the revised copy into the same folder and leaving a sticky note "see next page" — no catalogue cards change.</p>`,
  why: `<p>Update-heavy tables (sessions, counters, order status, inventory) suffer most from MVCC overhead: index bloat, WAL volume and vacuum work. Knowing how HOT works lets you design schemas (do not index volatile columns needlessly) and set fillfactor to cut write amplification dramatically.</p>`,
  useCase: `<p>A ride-hailing platform updates <code>drivers.last_seen_at</code> and <code>lat/lng</code> every 4 seconds for 300k drivers (75k updates/s). Initially <code>last_seen_at</code> was indexed for an admin page: HOT ratio 0%, 6 index writes per update, 40 MB/s WAL, indexes bloated 5x weekly. They dropped that index (the admin page used a nightly snapshot instead), set <code>fillfactor = 70</code>: HOT ratio rose to 97%, WAL fell to 9 MB/s and the table size stabilized.</p>`,
  internals: `<ul>
<li>Line pointer states (<code>lp_flags</code>): 0 = UNUSED, 1 = NORMAL, 2 = REDIRECT (points to another line pointer in the same page; used as HOT chain root), 3 = DEAD (tuple storage freed, pointer kept because indexes still reference it).</li>
<li><code>t_infomask2</code> bits: <code>HEAP_HOT_UPDATED</code> (0x4000 = 16384) on the old version, <code>HEAP_ONLY_TUPLE</code> (0x8000 = 32768) on the new version.</li>
<li><strong>Pruning</strong> runs during normal reads when page free space is below max(fillfactor target, 10%) and the page has prunable tuples (<code>pd_prune_xid</code> in the page header). It can remove dead heap-only tuples entirely and set root pointers to REDIRECT or DEAD; only VACUUM can remove index entries and turn DEAD pointers into UNUSED.</li>
<li>HOT is evaluated per update. Bulk UPDATEs touching every row on a full page cannot all be HOT; once a page is full, new versions go to another page (non-HOT).</li>
<li>PG 16+ also counts <code>n_tup_newpage_upd</code> (updates whose new version went to a different page) in <code>pg_stat_user_tables</code>, which helps tune fillfactor.</li>
<li>Indexes with <code>deduplication</code> and <strong>bottom-up index deletion</strong> (PG 14+) mitigate, but do not eliminate, index growth from non-HOT updates.</li>
</ul>`,
  whenNot: `<p>Do not lower fillfactor on append-only or rarely updated tables — it wastes space and cache (a table with fillfactor 70 is ~43% larger). Do not drop an index purely for HOT if queries really need it; measure trade-offs. For extremely hot single-row counters, consider batching in the application instead.</p>`,
  syntax: `CREATE TABLE t (...) WITH (fillfactor = 80);
ALTER TABLE t SET (fillfactor = 80);       -- affects future inserts; rewrite (VACUUM FULL/pg_repack) to apply to existing pages

SELECT n_tup_upd, n_tup_hot_upd, n_tup_newpage_upd, n_dead_tup
FROM pg_stat_user_tables WHERE relname = 't';

SELECT lp, lp_flags, t_ctid, t_infomask2 FROM heap_page_items(get_raw_page('t', 0));`,
  examples: [
    {
      label: 'Basic',
      title: 'A HOT update and its page layout before and after VACUUM',
      sql: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE mv_demo (id int PRIMARY KEY, val text) WITH (fillfactor = 90);
BEGIN; INSERT INTO mv_demo VALUES (1, 'a'), (2, 'b'), (3, 'c'); COMMIT;
BEGIN; UPDATE mv_demo SET val = 'b2' WHERE id = 2; COMMIT;   -- val is not indexed -> HOT
BEGIN; DELETE FROM mv_demo WHERE id = 3; COMMIT;

SELECT lp, lp_flags, t_xmin, t_xmax, t_ctid,
       (t_infomask2 & 16384) > 0 AS hot_updated,     -- old version
       (t_infomask2 & 32768) > 0 AS heap_only        -- new version, no index entry
FROM heap_page_items(get_raw_page('mv_demo', 0)) ORDER BY lp;

VACUUM mv_demo;

SELECT lp, lp_flags, t_xmin, t_xmax, t_ctid
FROM heap_page_items(get_raw_page('mv_demo', 0)) ORDER BY lp;
DROP TABLE mv_demo;`,
      explain: `<p>Before VACUUM: lp 2 is the old version of id 2, flagged <code>hot_updated</code>, with <code>t_ctid = (0,4)</code>; lp 4 is the new version, flagged <code>heap_only</code> — the primary-key index still points to lp 2 and readers hop to lp 4. lp 3 is the deleted row. After VACUUM: lp 2 became a REDIRECT (<code>lp_flags = 2</code>) to lp 4 so the index entry keeps working; lp 3 became UNUSED (0) because its index entry was removed; all tuple storage of dead versions was freed. XIDs differ on your machine.</p>`,
      output: ` lp | lp_flags | t_xmin | t_xmax | t_ctid | hot_updated | heap_only
----+----------+--------+--------+--------+-------------+-----------
  1 |        1 |    755 |      0 | (0,1)  | f           | f
  2 |        1 |    755 |    756 | (0,4)  | t           | f
  3 |        1 |    755 |    757 | (0,3)  | f           | f
  4 |        1 |    756 |      0 | (0,4)  | f           | t

-- after VACUUM
 lp | lp_flags | t_xmin | t_xmax | t_ctid
----+----------+--------+--------+--------
  1 |        1 |    755 |      0 | (0,1)
  2 |        2 |        |        |            <- REDIRECT to lp 4
  3 |        0 |        |        |            <- UNUSED
  4 |        1 |    756 |      0 | (0,4)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'fillfactor vs HOT ratio, and how one index kills HOT',
      sql: `CREATE TABLE hot_ff  (id int PRIMARY KEY, counter int, note text) WITH (fillfactor = 70);
CREATE TABLE hot_100 (id int PRIMARY KEY, counter int, note text);           -- default 100
INSERT INTO hot_ff  SELECT g, 0, repeat('x', 50) FROM generate_series(1, 1000) g;
INSERT INTO hot_100 SELECT g, 0, repeat('x', 50) FROM generate_series(1, 1000) g;

BEGIN;
UPDATE hot_ff  SET counter = counter + 1;
UPDATE hot_100 SET counter = counter + 1;
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_xact_user_tables
WHERE relname IN ('hot_ff', 'hot_100') ORDER BY 1;
COMMIT;

-- same fillfactor 70, but the updated column is now indexed
CREATE TABLE hot_idx (id int PRIMARY KEY, counter int, note text) WITH (fillfactor = 70);
CREATE INDEX hot_idx_counter_idx ON hot_idx (counter);
INSERT INTO hot_idx SELECT g, 0, repeat('x', 50) FROM generate_series(1, 1000) g;
BEGIN;
UPDATE hot_idx SET counter = counter + 1;
SELECT relname, n_tup_upd, n_tup_hot_upd
FROM pg_stat_xact_user_tables WHERE relname = 'hot_idx';
COMMIT;
DROP TABLE hot_ff, hot_100, hot_idx;`,
      explain: `<p>With default fillfactor 100, pages were packed full by the INSERT, so no updated version fit on its page: 0% HOT. With fillfactor 70 the 30% headroom let ~42% of rows be updated in place (a single full-table UPDATE consumes the free space page by page; with spread-out OLTP updates and pruning in between, the ratio is typically much higher). On <code>hot_idx</code>, where <code>counter</code> is indexed, the same update is never HOT despite the free space because an indexed column changes. <code>pg_stat_xact_user_tables</code> shows counts for the current transaction only.</p>`,
      output: ` relname | n_tup_upd | n_tup_hot_upd | hot_pct
---------+-----------+---------------+---------
 hot_100 |      1000 |             0 |     0.0
 hot_ff  |      1000 |           424 |    42.4

 relname | n_tup_upd | n_tup_hot_upd
---------+-----------+---------------
 hot_idx |      1000 |             0`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Write amplification: table and index growth from a full-table UPDATE',
      sql: `CREATE TABLE o_copy AS SELECT * FROM orders;
ALTER TABLE o_copy ADD PRIMARY KEY (id);
CREATE INDEX o_copy_customer_idx ON o_copy (customer_id);
CREATE INDEX o_copy_status_idx   ON o_copy (status);

SELECT pg_size_pretty(pg_relation_size('o_copy'))       AS heap_before,
       pg_size_pretty(pg_indexes_size('o_copy'))        AS indexes_before;

BEGIN;
UPDATE o_copy SET total_amount = total_amount + 0;      -- "no-op" business change, 5000 new versions
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_xact_user_tables WHERE relname = 'o_copy';
COMMIT;

SELECT pg_size_pretty(pg_relation_size('o_copy'))       AS heap_after,
       pg_size_pretty(pg_indexes_size('o_copy'))        AS indexes_after;
DROP TABLE o_copy;`,
      explain: `<p>Even though <code>total_amount</code> is not indexed and values do not change, PostgreSQL writes 5,000 new tuples (it does not compare old and new values to skip the write). Pages created by CREATE TABLE AS are full, so almost none of the updates are HOT and every index receives 5,000 new entries: the heap grows ~70% and the indexes roughly double. A <code>WHERE total_amount IS DISTINCT FROM new_value</code> filter or a trigger like <code>suppress_redundant_updates_trigger()</code> avoids no-op updates entirely.</p>`,
      output: ` heap_before | indexes_before
-------------+----------------
 512 kB      | 248 kB

 n_tup_upd | n_tup_hot_upd
-----------+---------------
      5000 |            36

 heap_after | indexes_after
------------+---------------
 880 kB     | 448 kB`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- No-op updates still create new versions (and WAL, and dead tuples)
CREATE TABLE p AS SELECT id, price FROM products;
BEGIN;
UPDATE p SET price = price;            -- 100 new tuple versions for nothing
SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relname = 'p';
COMMIT;`,
      why: 'PostgreSQL does not skip updates whose values are unchanged; each one writes a new version, WAL and later a dead tuple.',
      run: true
    },
    good: {
      sql: `-- Only touch rows whose value really changes (here 5 of 100 prices changed)
CREATE TABLE p AS SELECT id, price FROM products;
CREATE TABLE new_prices AS
  SELECT id, CASE WHEN id <= 5 THEN round(price * 1.10, 2) ELSE price END AS price FROM products;
BEGIN;
UPDATE p SET price = n.price
FROM new_prices n
WHERE p.id = n.id AND p.price IS DISTINCT FROM n.price;
SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relname = 'p';
COMMIT;`,
      why: 'Filtering with IS DISTINCT FROM writes versions only for rows that actually change, cutting WAL and vacuum work.',
      run: true
    }
  },
  mistakes: [
    'Indexing frequently updated columns (last_seen_at, counters, status) "just in case" — every update then becomes non-HOT.',
    'Running no-op updates (SET x = x) in sync jobs, creating dead tuples and WAL for nothing.',
    'Setting <code>fillfactor</code> on an existing table and expecting immediate effect; existing pages are only affected after a rewrite.',
    'Lowering fillfactor on append-only tables, wasting space and cache.',
    'Assuming page pruning removes index entries — only VACUUM cleans indexes.'
  ],
  best: [
    'Track HOT ratio (<code>n_tup_hot_upd / n_tup_upd</code>) and <code>n_tup_newpage_upd</code> for update-heavy tables.',
    'Use fillfactor 70–90 on tables with frequent updates of non-indexed columns.',
    'Keep volatile columns out of indexes where possible; consider splitting very hot columns into a separate narrow table.',
    'Skip unchanged rows with <code>IS DISTINCT FROM</code> or <code>suppress_redundant_updates_trigger()</code>.',
    'Use pageinspect on a copy or replica when investigating; it requires superuser by default and reads raw pages.'
  ],
  performance: `<p>HOT updates save index writes, WAL volume, index bloat and vacuum time; they are often the single most effective optimisation for OLTP update workloads. Costs: a lower fillfactor increases table size and reduces cache efficiency for scans. The sweet spot is found by measuring HOT ratio and <code>n_tup_newpage_upd</code> after changes.</p>`,
  security: `<p>The <code>pageinspect</code> extension can read raw page contents including deleted data that is still physically present; its functions are restricted to superusers by default. Do not grant access to it casually.</p>`,
  scenario: {
    title: 'Index bloat and WAL explosion on a sessions table',
    steps: [
      '1. Observe: sessions table 2 GB, its 4 indexes 18 GB; WAL 60 MB/s; HOT ratio 2% (n_tup_hot_upd / n_tup_upd).',
      '2. Identify the update: UPDATE sessions SET last_seen = now(), hits = hits + 1 WHERE id = $1, on every request.',
      '3. Find the culprit: an index on last_seen used only by a nightly cleanup job.',
      '4. Replace it: cleanup uses a BRIN or no index (a nightly seq scan of a 2 GB table is fine); drop the btree on last_seen.',
      '5. ALTER TABLE sessions SET (fillfactor = 70) and rewrite once with pg_repack (third-party) to apply it.',
      '6. Result: HOT ratio 96%, WAL 11 MB/s, index sizes stable; REINDEX CONCURRENTLY once to shed old bloat.'
    ]
  },
  widgets: ['diagram:mvcc', 'diagram:storage-page', 'lab:mvcc'],
  interview: [
    { q: 'What is a HOT update and when does it happen?', a: 'A Heap-Only Tuple update stores the new version on the same page and does not insert new index entries; indexes keep pointing to the chain root. It happens when no indexed column (including expression and partial-index predicate columns) changes and there is enough free space on the page.' },
    { q: 'Why does lowering fillfactor help update-heavy tables?', a: 'It leaves free space on each page at insert time so updated versions fit on the same page, enabling HOT updates and page pruning. This reduces index writes, WAL and bloat, at the cost of a larger table.' },
    { q: 'What is the difference between page pruning and VACUUM?', a: 'Pruning is opportunistic, per page, done by any backend reading a page: it removes dead HOT-chain tuples and sets redirect/dead line pointers. VACUUM processes the whole table and its indexes: it removes dead index entries, marks dead line pointers unused, updates the visibility and free space maps and freezes old tuples.' },
    { q: 'Does UPDATE t SET x = x create a new row version?', a: 'Yes. PostgreSQL does not compare old and new values; every updated row gets a new version, WAL and a dead tuple. Avoid no-op updates with WHERE x IS DISTINCT FROM newval or suppress_redundant_updates_trigger().' }
  ],
  exercises: [
    {
      task: 'Create a table with fillfactor 80, update one non-indexed column of a single row, and show with pageinspect that the new version has the HEAP_ONLY_TUPLE flag.',
      solution: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE h (id int PRIMARY KEY, note text) WITH (fillfactor = 80);
INSERT INTO h VALUES (1, 'a'), (2, 'b');
UPDATE h SET note = 'a2' WHERE id = 1;
SELECT lp, t_ctid, (t_infomask2 & 32768) > 0 AS heap_only, (t_infomask2 & 16384) > 0 AS hot_updated
FROM heap_page_items(get_raw_page('h', 0)) ORDER BY lp;
DROP TABLE h;`,
      run: true
    },
    {
      task: 'Install the suppress_redundant_updates_trigger on a copy of departments and show that an UPDATE setting the same value reports UPDATE 0 rows changed.',
      solution: `CREATE TABLE d AS SELECT * FROM departments;
CREATE TRIGGER d_skip_noop BEFORE UPDATE ON d
  FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger();
WITH u AS (UPDATE d SET location = location RETURNING 1)
SELECT count(*) AS rows_really_updated FROM u;`,
      run: true
    }
  ],
  challenge: {
    task: 'Find the free space per page of a table with pg_freespacemap after a VACUUM that follows deleting half of the rows, and show how much space is reusable.',
    hint: 'CREATE EXTENSION pg_freespacemap; SELECT * FROM pg_freespace(\'t\') returns (blkno, avail). VACUUM updates the free space map.',
    solution: `CREATE EXTENSION IF NOT EXISTS pg_freespacemap;
CREATE TABLE fsm_demo AS SELECT g AS id, repeat('x', 100) AS pad FROM generate_series(1, 2000) g;
DELETE FROM fsm_demo WHERE id % 2 = 0;
VACUUM fsm_demo;
SELECT count(*) AS pages, sum(avail) AS reusable_bytes, pg_size_pretty(sum(avail)) AS reusable
FROM pg_freespace('fsm_demo');
DROP TABLE fsm_demo;`,
    run: true
  },
  related: ['mvcc-tuple-versions', 'mvcc-snapshots-visibility', 'vacuum', 'vacuum-bloat'],
  quiz: [
    { type: 'mcq', q: 'Which change prevents an UPDATE of column last_login from being HOT?', options: ['Setting fillfactor to 80', 'Creating an index on last_login', 'Adding a CHECK constraint on last_login', 'Running ANALYZE'], answer: 1, explain: 'HOT requires that no indexed column changes. Indexing last_login makes every update of it non-HOT.' },
    { type: 'tf', q: 'ALTER TABLE t SET (fillfactor = 70) immediately frees 30% of every existing page.', answer: false, explain: 'It only affects how full future inserts fill pages; existing pages change only after a rewrite (VACUUM FULL, CLUSTER, pg_repack).' },
    { type: 'predict', q: 'What is lp_flags of a HOT chain root after VACUUM when the chain\'s live tuple is elsewhere on the page?', code: `SELECT lp, lp_flags FROM heap_page_items(get_raw_page('t',0)) WHERE lp = 2;`, options: ['0 (unused)', '1 (normal)', '2 (redirect)', '3 (dead)'], answer: 2, explain: 'The root line pointer becomes a redirect so existing index entries still find the live tuple.' },
    { type: 'optimize', q: 'A sync job runs UPDATE products SET price = $1 for all products every 5 minutes; 98% of prices do not change. Best fix?', options: ['Add an index on price', 'Add WHERE price IS DISTINCT FROM $1 (or compare in a join to new values)', 'Run VACUUM FULL after each sync', 'Increase fillfactor to 100'], answer: 1, explain: 'Skipping unchanged rows avoids 98% of the new versions, WAL and dead tuples.' }
  ]
}
]);

PGM.addLessons([
/* ===================================================================
   MODULE: locks
   =================================================================== */
{
  id: 'locks-table-level-modes',
  module: 'locks',
  title: 'Table-Level Lock Modes, the Conflict Matrix and the DDL Lock Queue',
  level: 4,
  minutes: 25,
  summary: 'The eight table lock modes from ACCESS SHARE to ACCESS EXCLUSIVE, which commands take which, and why a waiting ALTER TABLE can take down your application unless you use lock_timeout.',
  objectives: [
    'Name the eight table-level lock modes and read their conflict matrix',
    'Predict the lock taken by common commands (SELECT, UPDATE, CREATE INDEX, ALTER TABLE variants, VACUUM, TRUNCATE)',
    'Explain the lock queue: why a waiting ACCESS EXCLUSIVE request blocks new readers',
    'Write safe migrations with lock_timeout, retries and lock-light alternatives (NOT VALID, CONCURRENTLY)',
    'Inspect your own locks in pg_locks'
  ],
  concept: `<p>Besides row locks, every statement takes a <strong>table-level (relation) lock</strong> that lives in the shared lock table and is held until the transaction ends. There are eight modes; the names are historical, what matters is the conflict matrix:</p>
<table>
<tr><th>Mode</th><th>Typical commands</th></tr>
<tr><td>ACCESS SHARE</td><td>SELECT</td></tr>
<tr><td>ROW SHARE</td><td>SELECT ... FOR UPDATE / FOR SHARE (all row-locking clauses)</td></tr>
<tr><td>ROW EXCLUSIVE</td><td>INSERT, UPDATE, DELETE, MERGE</td></tr>
<tr><td>SHARE UPDATE EXCLUSIVE</td><td>VACUUM (non-FULL), ANALYZE, CREATE INDEX CONCURRENTLY, REINDEX CONCURRENTLY, ALTER TABLE VALIDATE CONSTRAINT, SET STATISTICS, SET (reloptions), ATTACH PARTITION (parent), DETACH ... CONCURRENTLY</td></tr>
<tr><td>SHARE</td><td>CREATE INDEX (non-concurrent)</td></tr>
<tr><td>SHARE ROW EXCLUSIVE</td><td>CREATE TRIGGER, ADD FOREIGN KEY (on both tables)</td></tr>
<tr><td>EXCLUSIVE</td><td>REFRESH MATERIALIZED VIEW CONCURRENTLY</td></tr>
<tr><td>ACCESS EXCLUSIVE</td><td>DROP TABLE, TRUNCATE, most ALTER TABLE forms (ADD COLUMN, ALTER TYPE, ADD CONSTRAINT, SET NOT NULL), VACUUM FULL, CLUSTER, REFRESH MATERIALIZED VIEW, LOCK TABLE (default)</td></tr>
</table>
<p>Conflict matrix (X = the requested mode must wait for the held mode):</p>
<table>
<tr><th>requested \\ held</th><th>AS</th><th>RS</th><th>RE</th><th>SUE</th><th>S</th><th>SRE</th><th>E</th><th>AE</th></tr>
<tr><td>ACCESS SHARE</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>X</td></tr>
<tr><td>ROW SHARE</td><td></td><td></td><td></td><td></td><td></td><td></td><td>X</td><td>X</td></tr>
<tr><td>ROW EXCLUSIVE</td><td></td><td></td><td></td><td></td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
<tr><td>SHARE UPDATE EXCL.</td><td></td><td></td><td></td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
<tr><td>SHARE</td><td></td><td></td><td>X</td><td>X</td><td></td><td>X</td><td>X</td><td>X</td></tr>
<tr><td>SHARE ROW EXCL.</td><td></td><td></td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
<tr><td>EXCLUSIVE</td><td></td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
<tr><td>ACCESS EXCLUSIVE</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
</table>
<p>Key takeaways: plain reads (ACCESS SHARE) conflict only with ACCESS EXCLUSIVE; normal writes (ROW EXCLUSIVE) do not conflict with each other; CREATE INDEX (SHARE) blocks writes but not reads; ACCESS EXCLUSIVE blocks everything, including SELECT.</p>
<h4>The lock queue danger</h4>
<p>Lock requests are granted in FIFO order. If a migration's <code>ALTER TABLE</code> (ACCESS EXCLUSIVE) waits behind a 2-minute analytics query, <em>every new query on that table</em> — even simple SELECTs — queues behind the ALTER, because granting them would starve it. A one-millisecond DDL turns into a 2-minute outage. Analogy: a single-lane bridge where a wide truck (the ALTER) is waiting for one slow car to clear; all cars arriving behind the truck wait too, even though they would fit next to the slow car.</p>
<p>Fix: run DDL with <code>SET lock_timeout = '2s'</code> (fail fast instead of blocking the queue) and retry with backoff.</p>`,
  why: `<p>Most "the database went down during deploy" incidents are lock-queue incidents: a cheap DDL waiting for an ACCESS EXCLUSIVE lock behind a long transaction. Knowing which commands take which lock lets you choose lock-light alternatives (CONCURRENTLY, NOT VALID + VALIDATE) and write migrations that never block production.</p>`,
  useCase: `<p>A food-delivery company deploys 30 times per day with automatic migrations. After an outage where <code>ALTER TABLE orders ADD COLUMN eta_seconds int</code> waited 90 s behind a BI query and stalled 4,000 order requests, they changed the migration runner to always execute <code>SET lock_timeout = '3s'; SET statement_timeout = '15s';</code> and retry up to 10 times with jitter. Index creation uses <code>CREATE INDEX CONCURRENTLY</code>; foreign keys and checks are added <code>NOT VALID</code> and validated separately (SHARE UPDATE EXCLUSIVE). No deploy-related lock outage since.</p>`,
  internals: `<ul>
<li>Heavyweight locks are stored in a shared hash table sized by <code>max_locks_per_transaction × (max_connections + max_prepared_transactions)</code>. Each backend also has a small number of <strong>fast-path</strong> slots for weak locks (AS, RS, RE) on relations, avoiding the shared table entirely when no strong lock exists on that relation (PG 18 increased the number of fast-path slots).</li>
<li>Indexes are locked along with their table; a SELECT using an index takes ACCESS SHARE on it too.</li>
<li>Locks are held until transaction end (no lock release on statement completion), so a transaction that did a SELECT an hour ago still holds ACCESS SHARE and blocks any ACCESS EXCLUSIVE request.</li>
<li>The deadlock detector runs after a backend has waited <code>deadlock_timeout</code> (default 1 s); <code>log_lock_waits = on</code> logs waits longer than that.</li>
<li>Some ALTER TABLE forms take weaker locks: SET STATISTICS, SET (reloptions), VALIDATE CONSTRAINT, ATTACH PARTITION (parent) take SHARE UPDATE EXCLUSIVE. <code>ADD COLUMN</code> with a constant or volatile-free default is metadata-only since PG 11 but still needs ACCESS EXCLUSIVE briefly.</li>
</ul>`,
  whenNot: `<p>Do not use explicit <code>LOCK TABLE ... IN ACCESS EXCLUSIVE MODE</code> in application code to "serialize" business logic — use row locks or advisory locks scoped to the entity. Avoid long-running transactions on tables that receive DDL. Never run plain <code>CREATE INDEX</code> on a busy large table in production when <code>CONCURRENTLY</code> is possible.</p>`,
  syntax: `LOCK [ TABLE ] name IN { ACCESS SHARE | ROW SHARE | ROW EXCLUSIVE | SHARE UPDATE EXCLUSIVE
                       | SHARE | SHARE ROW EXCLUSIVE | EXCLUSIVE | ACCESS EXCLUSIVE } MODE [ NOWAIT ];

SET lock_timeout = '3s';            -- max wait for any lock
SET statement_timeout = '30s';      -- max statement runtime

SELECT relation::regclass, mode, granted FROM pg_locks WHERE pid = pg_backend_pid();`,
  examples: [
    {
      label: 'Basic',
      title: 'Observe the table lock each command takes',
      sql: `CREATE TABLE lk AS SELECT * FROM departments;
CREATE VIEW my_locks AS
  SELECT mode FROM pg_locks
  WHERE pid = pg_backend_pid() AND locktype = 'relation' AND relation = 'lk'::regclass;

BEGIN; SELECT count(*) FROM lk;                SELECT 'SELECT' AS cmd, * FROM my_locks; ROLLBACK;
BEGIN; UPDATE lk SET budget = budget;          SELECT 'UPDATE' AS cmd, * FROM my_locks; ROLLBACK;
BEGIN; SELECT id FROM lk FOR UPDATE;           SELECT 'SELECT FOR UPDATE' AS cmd, * FROM my_locks; ROLLBACK;
BEGIN; CREATE INDEX ON lk (name);              SELECT 'CREATE INDEX' AS cmd, * FROM my_locks; ROLLBACK;
BEGIN; ANALYZE lk;                             SELECT 'ANALYZE' AS cmd, * FROM my_locks; ROLLBACK;
BEGIN; ALTER TABLE lk ADD COLUMN note text;    SELECT 'ALTER ADD COLUMN' AS cmd, * FROM my_locks; ROLLBACK;
BEGIN; TRUNCATE lk;                            SELECT 'TRUNCATE' AS cmd, * FROM my_locks; ROLLBACK;

DROP VIEW my_locks;
DROP TABLE lk;`,
      explain: `<p>Each mini-transaction runs one command and then lists the relation locks it holds on <code>lk</code> (locks are kept until the ROLLBACK). Reads take ACCESS SHARE, DML ROW EXCLUSIVE, row-locking SELECTs ROW SHARE, CREATE INDEX SHARE (blocks writes!), ANALYZE SHARE UPDATE EXCLUSIVE, and ADD COLUMN / TRUNCATE ACCESS EXCLUSIVE (TRUNCATE also shows a SHARE lock it took on the way). Use this technique in a staging database to check any migration statement before running it in production.</p>`,
      output: ` cmd               | mode
-------------------+--------------------------
 SELECT            | AccessShareLock
 UPDATE            | RowExclusiveLock
 SELECT FOR UPDATE | RowShareLock
 CREATE INDEX      | ShareLock
 ANALYZE           | ShareUpdateExclusiveLock
 ALTER ADD COLUMN  | AccessExclusiveLock
 TRUNCATE          | ShareLock
 TRUNCATE          | AccessExclusiveLock`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'A migration that cannot stall the lock queue',
      sql: `CREATE TABLE orders_mig AS SELECT * FROM orders;

BEGIN;
SET LOCAL lock_timeout = '3s';        -- give up instead of blocking everyone behind us
SET LOCAL statement_timeout = '30s';

ALTER TABLE orders_mig ADD COLUMN eta_seconds int;        -- metadata-only, needs AE briefly

-- constraint without a full-table scan under ACCESS EXCLUSIVE ...
ALTER TABLE orders_mig ADD CONSTRAINT orders_mig_eta_chk
  CHECK (eta_seconds IS NULL OR eta_seconds >= 0) NOT VALID;
COMMIT;

-- ... validated later under the much weaker SHARE UPDATE EXCLUSIVE lock
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE orders_mig VALIDATE CONSTRAINT orders_mig_eta_chk;
SELECT mode FROM pg_locks
WHERE pid = pg_backend_pid() AND relation = 'orders_mig'::regclass;
COMMIT;

SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'orders_mig'::regclass;
DROP TABLE orders_mig;`,
      explain: `<p>If a long transaction holds any lock on the table, the ALTER waits at most 3 s and fails with <em>canceling statement due to lock timeout</em>; the migration tool retries later instead of freezing traffic for minutes. The <code>NOT VALID</code> constraint is enforced for new rows immediately but skips checking existing rows, so the ACCESS EXCLUSIVE lock lasts milliseconds. <code>VALIDATE CONSTRAINT</code> then scans the table holding only SHARE UPDATE EXCLUSIVE, which allows concurrent reads and writes.</p>`,
      output: ` mode
--------------------------
 ShareUpdateExclusiveLock

 conname            | convalidated
--------------------+--------------
 orders_mig_eta_chk | t`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Lock-light alternatives cheat sheet, verified',
      sql: `CREATE TABLE lk AS SELECT * FROM departments;
CREATE VIEW my_locks AS
  SELECT string_agg(mode, ', ' ORDER BY mode) AS modes FROM pg_locks
  WHERE pid = pg_backend_pid() AND locktype = 'relation' AND relation = 'lk'::regclass;

-- heavy: changes column type -> table rewrite under ACCESS EXCLUSIVE
BEGIN; ALTER TABLE lk ALTER COLUMN name TYPE varchar(200);
SELECT 'ALTER COLUMN TYPE (rewrite)' AS op, modes FROM my_locks; ROLLBACK;

-- light: statistics target / storage parameters
BEGIN; ALTER TABLE lk ALTER COLUMN budget SET STATISTICS 500;
SELECT 'SET STATISTICS' AS op, modes FROM my_locks; ROLLBACK;
BEGIN; ALTER TABLE lk SET (autovacuum_vacuum_scale_factor = 0.01);
SELECT 'SET (reloption)' AS op, modes FROM my_locks; ROLLBACK;

-- explicit lock with NOWAIT (fails immediately if anyone holds a conflicting lock)
BEGIN; LOCK TABLE lk IN SHARE ROW EXCLUSIVE MODE NOWAIT;
SELECT 'LOCK ... SHARE ROW EXCLUSIVE' AS op, modes FROM my_locks; ROLLBACK;

DROP VIEW my_locks;
DROP TABLE lk;`,
      explain: `<p>Changing a column's type to a non-binary-compatible type rewrites the table under ACCESS EXCLUSIVE (it also took SHARE while rebuilding). Changing statistics targets or reloptions only needs SHARE UPDATE EXCLUSIVE, which does not block DML. Safer patterns for type changes on huge tables: add a new column, backfill in batches, swap in a short transaction (or use a view), then drop the old column.</p>`,
      output: ` op                          | modes
-----------------------------+----------------------------------
 ALTER COLUMN TYPE (rewrite) | AccessExclusiveLock, ShareLock
 SET STATISTICS              | ShareUpdateExclusiveLock
 SET (reloption)             | ShareUpdateExclusiveLock
 LOCK ... SHARE ROW EXCLUSIVE| ShareRowExclusiveLock`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `CREATE TABLE t_mig AS SELECT * FROM orders;
-- Plain CREATE INDEX: SHARE lock blocks every INSERT/UPDATE/DELETE for the whole build
CREATE INDEX t_mig_customer_idx ON t_mig (customer_id);`,
      why: 'SHARE conflicts with ROW EXCLUSIVE: on a 500 GB table, writes are blocked for the entire (possibly hour-long) index build.',
      run: true
    },
    good: {
      sql: `CREATE TABLE t_mig AS SELECT * FROM orders;
-- CONCURRENTLY: SHARE UPDATE EXCLUSIVE, writes continue (must run outside a transaction block)
CREATE INDEX CONCURRENTLY t_mig_customer_idx ON t_mig (customer_id);`,
      why: 'CREATE INDEX CONCURRENTLY takes only SHARE UPDATE EXCLUSIVE, so DML continues; it is slower and can leave an INVALID index on failure (drop and retry).',
      run: true
    }
  },
  mistakes: [
    'Running DDL without <code>lock_timeout</code>: a waiting ACCESS EXCLUSIVE request blocks all new queries on the table (lock queue).',
    'Believing a SELECT cannot block anything — an open transaction that once SELECTed from a table still holds ACCESS SHARE and blocks any ALTER TABLE.',
    'Using plain <code>CREATE INDEX</code> on busy tables (blocks writes) instead of <code>CONCURRENTLY</code>.',
    'Adding constraints or foreign keys validated in one step on huge tables instead of <code>NOT VALID</code> + <code>VALIDATE CONSTRAINT</code>.',
    'Assuming <code>ALTER TABLE ... SET NOT NULL</code> is cheap: it scans the table under ACCESS EXCLUSIVE unless a validated <code>CHECK (col IS NOT NULL)</code> constraint already proves it.'
  ],
  best: [
    'Every migration session: <code>SET lock_timeout = \'2s\'</code> (or 3–5 s) and retry with backoff.',
    'Kill or wait out long transactions before DDL; check <code>pg_stat_activity</code> for <code>xact_start</code> older than a few minutes.',
    'Prefer CONCURRENTLY variants (CREATE/REINDEX/DETACH) and NOT VALID + VALIDATE for constraints.',
    'Split big changes: add nullable column → backfill in batches → add constraint NOT VALID → validate → switch reads.',
    'Turn on <code>log_lock_waits</code> in production to see lock waits longer than <code>deadlock_timeout</code>.'
  ],
  performance: `<p>Lock acquisition itself is cheap (fast-path for weak locks). The cost of locks is waiting: ACCESS EXCLUSIVE requests in the queue create convoys. Queries touching many partitions or many indexes take many locks; if they exceed the fast-path slots they use the shared lock table, which adds contention. Size <code>max_locks_per_transaction</code> up for heavily partitioned schemas (it is a server restart parameter).</p>`,
  security: `<p>Any role that can SELECT a table can take ACCESS SHARE and, by holding a transaction open, block DDL by the owner — a mild denial-of-service vector. Use <code>idle_in_transaction_session_timeout</code> and <code>statement_timeout</code> for application and BI roles. <code>LOCK TABLE</code> requires appropriate privileges (e.g. UPDATE/DELETE/TRUNCATE for stronger modes).</p>`,
  scenario: {
    title: 'A 5 ms ALTER TABLE caused a 3-minute outage',
    steps: [
      '1. Timeline from logs: 14:02:10 deploy runs ALTER TABLE orders ADD COLUMN; 14:02:10–14:05:12 all order queries time out at the load balancer.',
      '2. pg_stat_activity snapshot from monitoring: the ALTER was waiting (wait_event_type Lock, relation) behind a BI session in state "idle in transaction" since 13:40.',
      '3. Every other query on orders was waiting behind the ALTER in the lock queue (pg_blocking_pids showed the ALTER\'s pid).',
      '4. Immediate fix: pg_terminate_backend() on the idle BI session; the ALTER completed in milliseconds and traffic resumed.',
      '5. Prevention: migrations run with SET lock_timeout = \'3s\' and retries; BI role gets idle_in_transaction_session_timeout = \'5min\'.',
      '6. Add a pre-deploy check: abort if any transaction older than 60 s touches the target tables.'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'Which lock does CREATE INDEX take, and why does it matter?', a: 'SHARE, which conflicts with ROW EXCLUSIVE, so all INSERT/UPDATE/DELETE on the table block for the duration of the build; reads continue. CREATE INDEX CONCURRENTLY takes SHARE UPDATE EXCLUSIVE instead, allowing writes, at the cost of two table scans and waiting for existing transactions.' },
    { q: 'Explain the lock queue problem with ALTER TABLE.', a: 'Lock requests are queued in order. An ALTER TABLE needing ACCESS EXCLUSIVE that waits behind a long-running query also blocks every later request, even plain SELECTs, because they conflict with the queued ACCESS EXCLUSIVE. A cheap DDL thereby causes a full outage on that table. lock_timeout with retries prevents it.' },
    { q: 'How do you add a CHECK or FOREIGN KEY constraint to a huge table without long blocking?', a: 'ADD CONSTRAINT ... NOT VALID (brief ACCESS EXCLUSIVE for CHECK, SHARE ROW EXCLUSIVE for FK, no scan), then ALTER TABLE ... VALIDATE CONSTRAINT, which scans the table holding only SHARE UPDATE EXCLUSIVE (and ROW SHARE on the referenced table for FKs), so reads and writes continue.' },
    { q: 'Which lock modes do not conflict with ROW EXCLUSIVE?', a: 'ACCESS SHARE, ROW SHARE, ROW EXCLUSIVE and SHARE UPDATE EXCLUSIVE. That is why concurrent DML, VACUUM, ANALYZE and CREATE INDEX CONCURRENTLY can run together.' }
  ],
  exercises: [
    {
      task: 'Find which lock ALTER TABLE ... VALIDATE CONSTRAINT takes on a copy of products after adding a NOT VALID check (price > 0).',
      solution: `CREATE TABLE p AS SELECT * FROM products;
ALTER TABLE p ADD CONSTRAINT p_price_pos CHECK (price > 0) NOT VALID;
BEGIN;
ALTER TABLE p VALIDATE CONSTRAINT p_price_pos;
SELECT mode FROM pg_locks WHERE pid = pg_backend_pid() AND relation = 'p'::regclass;
COMMIT;
DROP TABLE p;`,
      run: true
    },
    {
      task: 'Using LOCK TABLE ... NOWAIT inside a transaction, take an EXCLUSIVE lock on a copy of customers and show it in pg_locks.',
      solution: `CREATE TABLE c AS SELECT * FROM customers;
BEGIN;
LOCK TABLE c IN EXCLUSIVE MODE NOWAIT;
SELECT locktype, mode, granted FROM pg_locks WHERE pid = pg_backend_pid() AND relation = 'c'::regclass;
ROLLBACK;
DROP TABLE c;`,
      run: true
    }
  ],
  challenge: {
    task: 'Write a function lock_conflicts(requested text, held text) RETURNS boolean that encodes the PostgreSQL table-lock conflict matrix, then produce the full 8x8 matrix with it as a result set (rows = requested, columns as an aggregated string).',
    hint: 'Give each mode an index 1..8 in order (ACCESS SHARE .. ACCESS EXCLUSIVE) and store each mode\'s conflict set as an int array.',
    solution: `CREATE FUNCTION lock_conflicts(requested text, held text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  WITH m(name, pos, conflicts) AS (VALUES
    ('ACCESS SHARE',           1, ARRAY[8]),
    ('ROW SHARE',              2, ARRAY[7,8]),
    ('ROW EXCLUSIVE',          3, ARRAY[5,6,7,8]),
    ('SHARE UPDATE EXCLUSIVE', 4, ARRAY[4,5,6,7,8]),
    ('SHARE',                  5, ARRAY[3,4,6,7,8]),
    ('SHARE ROW EXCLUSIVE',    6, ARRAY[3,4,5,6,7,8]),
    ('EXCLUSIVE',              7, ARRAY[2,3,4,5,6,7,8]),
    ('ACCESS EXCLUSIVE',       8, ARRAY[1,2,3,4,5,6,7,8]))
  SELECT (SELECT pos FROM m WHERE name = held) = ANY (conflicts) FROM m WHERE name = requested
$$;

WITH modes(name, pos) AS (VALUES ('ACCESS SHARE',1),('ROW SHARE',2),('ROW EXCLUSIVE',3),
  ('SHARE UPDATE EXCLUSIVE',4),('SHARE',5),('SHARE ROW EXCLUSIVE',6),('EXCLUSIVE',7),('ACCESS EXCLUSIVE',8))
SELECT r.name AS requested,
       string_agg(CASE WHEN lock_conflicts(r.name, h.name) THEN 'X' ELSE '.' END, ' ' ORDER BY h.pos) AS "AS RS RE SUE S SRE E AE"
FROM modes r CROSS JOIN modes h
GROUP BY r.name, r.pos ORDER BY r.pos;`,
    run: true
  },
  related: ['locks-row-level-pg-locks', 'locks-deadlocks-advisory', 'concurrency', 'partitioning-maintenance'],
  quiz: [
    { type: 'mcq', q: 'Which command blocks plain SELECT queries on the table?', options: ['CREATE INDEX', 'VACUUM', 'ALTER TABLE ... ADD COLUMN', 'UPDATE'], answer: 2, explain: 'ADD COLUMN takes ACCESS EXCLUSIVE, the only mode that conflicts with ACCESS SHARE.' },
    { type: 'tf', q: 'Two sessions running UPDATE on different rows of the same table block each other at the table level.', answer: false, explain: 'Both take ROW EXCLUSIVE, which does not conflict with itself; they only wait if they touch the same row.' },
    { type: 'scenario', q: 'An ALTER TABLE has been waiting 40 s and now all API queries on that table hang. Most likely cause?', options: ['Deadlock', 'The ALTER is queued behind a long transaction, and new queries are queued behind the ALTER', 'Autovacuum is running', 'The table is too large'], answer: 1, explain: 'This is the lock-queue effect; cancel the ALTER (or the blocker) and use lock_timeout.' },
    { type: 'mcq', q: 'Which lock does VACUUM (not FULL) take?', options: ['ACCESS EXCLUSIVE', 'SHARE', 'SHARE UPDATE EXCLUSIVE', 'ROW EXCLUSIVE'], answer: 2, explain: 'SHARE UPDATE EXCLUSIVE: it allows reads and writes but prevents concurrent VACUUM/ANALYZE/DDL that would conflict.' },
    { type: 'optimize', q: 'You must add a FOREIGN KEY from order_items(order_id) to orders on 2 billion rows with minimal blocking. Best approach?', options: ['ALTER TABLE ... ADD FOREIGN KEY in one step', 'ADD CONSTRAINT ... NOT VALID, then VALIDATE CONSTRAINT later', 'LOCK TABLE order_items IN ACCESS EXCLUSIVE MODE first', 'Drop all indexes first'], answer: 1, explain: 'NOT VALID skips the scan; VALIDATE runs under a weak lock that allows concurrent DML.' }
  ]
},
{
  id: 'locks-row-level-pg-locks',
  module: 'locks',
  title: 'Row Locks, pg_locks and Finding Blockers with pg_blocking_pids()',
  level: 4,
  minutes: 22,
  summary: 'Read pg_locks correctly, understand transactionid and tuple locks, and build the blocking-tree query that every on-call DBA needs.',
  objectives: [
    'Interpret the columns of pg_locks (locktype, relation, transactionid, virtualxid, mode, granted, fastpath)',
    'Explain why waiting on a row lock shows up as waiting on a transactionid',
    'Find blocked and blocking sessions with pg_blocking_pids() and pg_stat_activity',
    'Decide between pg_cancel_backend() and pg_terminate_backend()',
    'Prevent lock pile-ups with timeouts'
  ],
  concept: `<p><code>pg_locks</code> is a view over the shared lock table: one row per lock held <em>or awaited</em> by a backend. Important columns:</p>
<ul>
<li><code>locktype</code>: <code>relation</code> (tables/indexes), <code>transactionid</code> (every transaction with an XID holds an exclusive lock on its own XID), <code>virtualxid</code> (every transaction holds one on its virtual XID), <code>tuple</code> (a waiter queued for a specific row), <code>advisory</code>, <code>object</code>, <code>page</code>, <code>extend</code>...</li>
<li><code>mode</code> and <code>granted</code>: what is held (<code>true</code>) or awaited (<code>false</code>).</li>
<li><code>pid</code>, <code>virtualtransaction</code>, <code>fastpath</code>, <code>waitstart</code> (PG 14+).</li>
</ul>
<p>Row locks are not listed individually (they live in tuple headers). When session B wants a row that session A has updated or locked, B: (1) briefly takes a <code>tuple</code> lock to queue fairly, then (2) waits for a <strong>ShareLock on A's transactionid</strong>, which is granted only when A commits or aborts. So in pg_locks you see B with <code>locktype = 'transactionid', mode = 'ShareLock', granted = false</code> and A holding <code>ExclusiveLock</code> on the same transactionid.</p>
<p><code>pg_blocking_pids(pid)</code> (PG 9.6+) does the matching for you: it returns the array of PIDs that block the given PID — across relation, transaction, tuple and advisory locks, including "soft" blocking by earlier queued waiters.</p>
<p>Analogy: a deli where you do not see who reserved which sandwich (row), but you see that customer B is standing in line waiting for customer A to pay (transactionid). pg_blocking_pids is the staff member who tells you "B is waiting for A".</p>`,
  why: `<p>When an application hangs, the first question is "who is blocking whom?". Without a ready blocking-tree query, on-call engineers guess and kill the wrong sessions. With it, you find the root blocker (often an idle-in-transaction session) in seconds.</p>`,
  useCase: `<p>A SaaS CRM saw intermittent 30-second request timeouts. The on-call runbook's blocking query showed a tree: 214 sessions waiting → root pid 48211, state <code>idle in transaction</code> for 11 minutes, last query <code>UPDATE accounts SET ... WHERE id = 9001</code>. A worker had crashed mid-request without rolling back, and the connection pool kept the connection. They terminated the pid, set <code>idle_in_transaction_session_timeout = '60s'</code> for the app role, and fixed the worker's error handling.</p>`,
  internals: `<ul>
<li>Every transaction holds <code>ExclusiveLock</code> on its own <code>virtualxid</code>; if it gets a real XID, also on its <code>transactionid</code>. Waiting "for a transaction" is implemented as requesting ShareLock on that XID.</li>
<li>Locks taken via the per-backend fast path show <code>fastpath = true</code>; they are moved to the main table if a conflicting strong lock is requested.</li>
<li><code>pg_locks</code> reads the lock manager partitions; querying it very frequently on a busy server has some overhead — sample, do not poll at high frequency.</li>
<li><code>pg_stat_activity.wait_event_type = 'Lock'</code> with <code>wait_event</code> = <code>relation</code>, <code>transactionid</code>, <code>tuple</code>, <code>advisory</code>... identifies lock waits without touching pg_locks.</li>
<li><code>pg_cancel_backend(pid)</code> sends SIGINT (cancels the current query; the transaction is aborted but the session stays). <code>pg_terminate_backend(pid)</code> sends SIGTERM (ends the session, rolling back its transaction). An idle-in-transaction blocker has no running query, so only terminate releases its locks.</li>
</ul>`,
  whenNot: `<p>Do not use pg_locks to find "which rows are locked" — use the <code>pgrowlocks</code> <span class="tag ext">extension</span> for that (it scans the table, so it is expensive). Do not kill blockers blindly: check what they are (a migration in its last second, a replication worker, a backup) and prefer cancel over terminate when a running query is the problem.</p>`,
  syntax: `SELECT * FROM pg_locks WHERE NOT granted;
SELECT pg_blocking_pids(pid);                 -- int[] of blockers
SELECT pg_cancel_backend(pid);                -- cancel current query
SELECT pg_terminate_backend(pid);             -- end the session

SET idle_in_transaction_session_timeout = '60s';
SET transaction_timeout = '5min';             -- PG 17+`,
  examples: [
    {
      label: 'Basic',
      title: 'Your own transaction in pg_locks',
      sql: `BEGIN;
UPDATE departments SET budget = budget WHERE id = 1;

SELECT locktype,
       relation::regclass AS rel,
       transactionid,
       virtualtransaction,
       mode, granted, fastpath
FROM pg_locks
WHERE pid = pg_backend_pid()
ORDER BY locktype, relation::regclass::text;
ROLLBACK;`,
      explain: `<p>The UPDATE took <code>RowExclusiveLock</code> on <code>departments</code> and on each of its indexes (all via fast path), the session holds <code>ExclusiveLock</code> on its <code>virtualxid</code> and — because it wrote — on its real <code>transactionid</code>. The row lock on department 1 is <em>not</em> listed: it lives in the tuple's xmax. Our own query of <code>pg_locks</code> also shows an <code>AccessShareLock</code> on the view. If another session tried to update department 1 it would appear with <code>transactionid = our XID, mode = ShareLock, granted = false</code>.</p>`,
      output: ` locktype      | rel                  | transactionid | virtualtransaction | mode             | granted | fastpath
---------------+----------------------+---------------+--------------------+------------------+---------+----------
 relation      | departments          |               | 0/3                | RowExclusiveLock | t       | t
 relation      | departments_name_key |               | 0/3                | RowExclusiveLock | t       | t
 relation      | departments_pkey     |               | 0/3                | RowExclusiveLock | t       | t
 relation      | pg_locks             |               | 0/3                | AccessShareLock  | t       | t
 transactionid |                      |           753 | 0/3                | ExclusiveLock    | t       | f
 virtualxid    |                      |               | 0/3                | ExclusiveLock    | t       | t`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'The blocking-tree query (works on any server)',
      sql: `-- Every session that is waiting, who blocks it, and what both are doing.
SELECT w.pid                         AS waiting_pid,
       w.usename                     AS waiting_user,
       now() - w.query_start         AS waiting_for,
       w.wait_event_type || ':' || w.wait_event AS wait,
       left(w.query, 60)             AS waiting_query,
       b.pid                         AS blocking_pid,
       b.state                       AS blocking_state,
       now() - b.xact_start          AS blocker_xact_age,
       left(b.query, 60)             AS blocking_query
FROM pg_stat_activity w
CROSS JOIN LATERAL unnest(pg_blocking_pids(w.pid)) AS bp(pid)
JOIN pg_stat_activity b ON b.pid = bp.pid
ORDER BY waiting_for DESC;`,
      explain: `<p>For each backend, <code>pg_blocking_pids()</code> returns its blockers; joining back to <code>pg_stat_activity</code> shows what both sides are doing. A blocker with <code>state = 'idle in transaction'</code> and an old <code>xact_start</code> is the classic culprit: it finished its last statement but never committed. In this single-session playground there are no waiters, so the result is empty — run it on a real server during an incident (needs <code>pg_read_all_stats</code> to see other users' queries).</p>`,
      output: ` waiting_pid | waiting_user | waiting_for | wait | waiting_query | blocking_pid | blocking_state | blocker_xact_age | blocking_query
-------------+--------------+-------------+------+---------------+--------------+----------------+------------------+----------------
(0 rows)     -- on a busy server, e.g.:
-- 48302 | app | 00:00:27 | Lock:transactionid | UPDATE accounts SET ... | 48211 | idle in transaction | 00:11:04 | UPDATE accounts ...`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Root blockers only, plus waiting lock details',
      sql: `-- Root blockers: sessions that block others but are not blocked themselves
WITH blocked AS (
  SELECT pid, pg_blocking_pids(pid) AS blockers
  FROM pg_stat_activity
  WHERE cardinality(pg_blocking_pids(pid)) > 0
)
SELECT a.pid, a.usename, a.state, now() - a.xact_start AS xact_age,
       (SELECT count(*) FROM blocked b WHERE a.pid = ANY (b.blockers)) AS sessions_blocked,
       left(a.query, 80) AS last_query
FROM pg_stat_activity a
WHERE a.pid IN (SELECT unnest(blockers) FROM blocked)
  AND a.pid NOT IN (SELECT pid FROM blocked)
ORDER BY sessions_blocked DESC;

-- Ungranted lock requests with what they wait for
SELECT l.pid, l.locktype, l.relation::regclass, l.transactionid, l.mode,
       now() - l.waitstart AS waiting_for
FROM pg_locks l
WHERE NOT l.granted
ORDER BY l.waitstart;

-- my own blockers (empty array in a single session)
SELECT pg_blocking_pids(pg_backend_pid()) AS my_blockers;`,
      explain: `<p>The first query isolates the <em>root</em> of each blocking tree — the session to investigate (or terminate) first; killing a middle node only moves the queue. The second lists ungranted lock requests with <code>waitstart</code> (PG 14+) to see how long each has waited. In an incident, capture these outputs before killing anything (for the post-mortem), then act: <code>pg_cancel_backend()</code> for a long running query, <code>pg_terminate_backend()</code> for an idle-in-transaction session.</p>`,
      output: ` pid | usename | state | xact_age | sessions_blocked | last_query
-----+---------+-------+----------+------------------+------------
(0 rows)

 pid | locktype | relation | transactionid | mode | waiting_for
-----+----------+----------+---------------+------+-------------
(0 rows)

 my_blockers
-------------
 {}`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Guessing: kill the oldest query on the server
SELECT pid, now() - query_start AS runtime, left(query, 50)
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY query_start
LIMIT 1;`,
      why: 'The oldest active query is often a harmless report or even a victim waiting on a lock. The real blocker is frequently idle in transaction and does not appear among active queries at all.',
      run: true
    },
    good: {
      sql: `-- Evidence: who blocks whom, then act on the root blocker
SELECT pid, state, pg_blocking_pids(pid) AS blocked_by, now() - xact_start AS xact_age, left(query, 50)
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0
   OR pid IN (SELECT unnest(pg_blocking_pids(pid)) FROM pg_stat_activity);`,
      why: 'pg_blocking_pids identifies exactly which sessions block others, including idle-in-transaction blockers.',
      run: true
    }
  },
  mistakes: [
    'Looking for locked rows in pg_locks — row locks appear only indirectly (transactionid / tuple waits).',
    'Using <code>pg_cancel_backend()</code> on an idle-in-transaction blocker: there is no query to cancel; use <code>pg_terminate_backend()</code>.',
    'Killing a waiting session instead of the root blocker.',
    'Not setting <code>idle_in_transaction_session_timeout</code> for application roles, so crashed request handlers keep locks forever.',
    'Polling pg_locks every second from many monitoring agents on a very busy server.'
  ],
  best: [
    'Keep the blocking-tree query in your runbook and dashboards; alert on lock waits longer than N seconds.',
    'Set <code>idle_in_transaction_session_timeout</code>, <code>statement_timeout</code> and (PG 17+) <code>transaction_timeout</code> per role.',
    'Enable <code>log_lock_waits = on</code> so waits &gt; <code>deadlock_timeout</code> are logged with the blocking pids.',
    'Grant <code>pg_signal_backend</code> to on-call roles instead of giving them superuser.',
    'Capture pg_stat_activity and pg_locks snapshots before terminating sessions.'
  ],
  performance: `<p>Lock waits are the most common cause of sudden latency spikes with low CPU. Measure them with <code>pg_stat_activity</code> sampling (wait events) or extensions like <code>pg_wait_sampling</code> <span class="tag ext">extension</span>. Long-held locks usually come from long transactions — fix the application pattern rather than the database settings.</p>`,
  security: `<p>Without <code>pg_read_all_stats</code>, users see other sessions' rows in pg_stat_activity but not their query text. Terminating other users' sessions requires superuser or <code>pg_signal_backend</code> (which cannot signal superuser backends). Restrict these roles to operators.</p>`,
  scenario: {
    title: 'Intermittent 30-second timeouts in a CRM',
    steps: [
      '1. During an incident, run the blocking-tree query: 214 waiting sessions, all with wait Lock:transactionid.',
      '2. Root blocker query: pid 48211, state idle in transaction, xact_age 11 min, last query UPDATE accounts ... WHERE id = 9001.',
      '3. Capture evidence (copy outputs), then SELECT pg_terminate_backend(48211); waits clear within a second.',
      '4. Root cause in code: an exception path returned the connection to the pool without ROLLBACK.',
      '5. Fix code and set ALTER ROLE app SET idle_in_transaction_session_timeout = \'60s\'.',
      '6. Add an alert: any session idle in transaction for &gt; 30 s, and any lock wait &gt; 5 s (log_lock_waits).'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'Why do sessions waiting for a row lock appear to wait on a transactionid in pg_locks?', a: 'Row locks are stored in tuple headers, not the lock table. A waiter determines which transaction holds the row (xmax) and requests a ShareLock on that transaction\'s XID, which the holder keeps exclusively until it ends. So the wait shows as locktype transactionid (often preceded by a tuple lock to preserve queue order).' },
    { q: 'How do you find the root blocker in a lock pile-up?', a: 'Use pg_blocking_pids() on all sessions from pg_stat_activity, then select blockers that are not themselves blocked. Those are root blockers; inspect their state (often idle in transaction), age and query, capture evidence, and cancel or terminate as appropriate.' },
    { q: 'Difference between pg_cancel_backend and pg_terminate_backend?', a: 'Cancel interrupts the currently running query (the transaction is aborted, the connection remains). Terminate ends the whole backend process, rolling back any open transaction and closing the connection. For an idle-in-transaction blocker only terminate releases locks.' },
    { q: 'What does idle_in_transaction_session_timeout protect against?', a: 'Sessions that opened a transaction and stopped sending commands (application bugs, crashed workers, interactive users) while holding locks and an old snapshot. After the timeout the session is terminated, releasing locks and allowing VACUUM to clean up.' }
  ],
  exercises: [
    {
      task: 'Inside a transaction, lock two different tables with different statements and list your relation locks with their mode, granted and fastpath flags.',
      solution: `BEGIN;
SELECT count(*) FROM customers;
UPDATE products SET stock = stock WHERE id = 1;
SELECT relation::regclass, mode, granted, fastpath
FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'relation'
  AND relation IN ('customers'::regclass, 'products'::regclass)
ORDER BY 1::text, 2;
ROLLBACK;`,
      run: true
    },
    {
      task: 'Write a query that lists sessions in state idle in transaction for more than 30 seconds with their transaction age (returns nothing in the playground).',
      solution: `SELECT pid, usename, application_name, now() - xact_start AS xact_age,
       now() - state_change AS idle_for, left(query, 60) AS last_query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '30 seconds'
ORDER BY xact_age DESC;`,
      run: true
    }
  ],
  challenge: {
    task: 'Produce a recursive blocking tree: for each root blocker, list all sessions waiting on it directly or indirectly with their depth.',
    hint: 'Build edges (blocker, waiter) from pg_blocking_pids, then a recursive CTE starting from roots (blockers that are not waiters).',
    solution: `WITH RECURSIVE edges AS (
  SELECT unnest(pg_blocking_pids(pid)) AS blocker, pid AS waiter FROM pg_stat_activity
), roots AS (
  SELECT DISTINCT blocker AS pid FROM edges WHERE blocker NOT IN (SELECT waiter FROM edges)
), tree AS (
  SELECT r.pid AS root, r.pid, 0 AS depth FROM roots r
  UNION ALL
  SELECT t.root, e.waiter, t.depth + 1 FROM tree t JOIN edges e ON e.blocker = t.pid
)
SELECT t.root, t.pid, t.depth, a.state, left(a.query, 60) AS query
FROM tree t LEFT JOIN pg_stat_activity a ON a.pid = t.pid
ORDER BY t.root, t.depth, t.pid;`,
    run: true
  },
  related: ['locks-table-level-modes', 'locks-deadlocks-advisory', 'concurrency-row-locking-clauses', 'monitoring'],
  quiz: [
    { type: 'mcq', q: 'Session B waits to UPDATE a row that session A updated (uncommitted). What does B wait for in pg_locks?', options: ['A RowExclusiveLock on the table', 'A ShareLock on A\'s transactionid', 'An ExclusiveLock on the row\'s ctid', 'An advisory lock'], answer: 1, explain: 'Waiting for the row means waiting for A\'s transaction to end, implemented as a ShareLock request on A\'s XID.' },
    { type: 'tf', q: 'pg_cancel_backend() releases the locks of a session that is idle in transaction.', answer: false, explain: 'There is no running query to cancel; use pg_terminate_backend() or let idle_in_transaction_session_timeout end it.' },
    { type: 'predict', q: 'What does this return in a session that is not waiting?', code: `SELECT pg_blocking_pids(pg_backend_pid());`, options: ['NULL', '{}', 'Its own pid', 'An error'], answer: 1, explain: 'An empty integer array.' },
    { type: 'scenario', q: 'The blocking tree shows root pid 777 "active" running a 20-minute report holding ACCESS SHARE, with an ALTER TABLE queued behind it and 300 queries behind the ALTER. Best immediate action?', options: ['Terminate all 300 waiting sessions', 'Cancel the ALTER TABLE (and re-run it later with lock_timeout)', 'Restart PostgreSQL', 'Run VACUUM'], answer: 1, explain: 'Cancelling the queued ALTER immediately lets the 300 queries proceed (they do not conflict with the report). Then reschedule the DDL with lock_timeout.' }
  ]
},
{
  id: 'locks-deadlocks-advisory',
  module: 'locks',
  title: 'Deadlocks and Advisory Locks',
  level: 4,
  minutes: 22,
  summary: 'How deadlocks form, how PostgreSQL detects and breaks them, how to prevent them with consistent lock ordering, and how to use advisory locks for application-level mutual exclusion.',
  objectives: [
    'Draw the wait-for cycle of a deadlock on a two-session timeline',
    'Explain deadlock_timeout, detection, the victim choice and SQLSTATE 40P01',
    'Prevent deadlocks with consistent ordering and by taking the strongest lock first',
    'Use session-level and transaction-level advisory locks (pg_advisory_lock, pg_try_advisory_xact_lock)',
    'Avoid advisory-lock pitfalls with poolers and key collisions'
  ],
  concept: `<p>A <strong>deadlock</strong> is a cycle of waits: A waits for a lock held by B while B waits for a lock held by A. Neither can proceed, ever.</p>
<table>
<tr><th>Time</th><th>Session A (transfer 1→2)</th><th>Session B (transfer 2→1)</th></tr>
<tr><td>t1</td><td><code>UPDATE accounts SET balance = balance - 100 WHERE id = 1;</code> ✔ locks row 1</td><td></td></tr>
<tr><td>t2</td><td></td><td><code>UPDATE accounts SET balance = balance - 50 WHERE id = 2;</code> ✔ locks row 2</td></tr>
<tr><td>t3</td><td><code>UPDATE ... WHERE id = 2;</code> ⏳ waits for B</td><td></td></tr>
<tr><td>t4</td><td></td><td><code>UPDATE ... WHERE id = 1;</code> ⏳ waits for A → cycle</td></tr>
<tr><td>t4 + 1 s</td><td></td><td>ERROR: deadlock detected (40P01) — B is rolled back; A continues</td></tr>
</table>
<p>PostgreSQL does not check for deadlocks on every wait (too expensive). A backend that has waited <code>deadlock_timeout</code> (default 1 s) runs the detector, which searches the wait-for graph; if it finds a cycle, the backend that ran the check aborts its own transaction with <code>ERROR: deadlock detected</code>. The application must retry.</p>
<p><strong>Prevention</strong>: acquire locks in a consistent global order (e.g. always lower account id first, <code>ORDER BY id FOR UPDATE</code>), take the strongest needed lock up front (no lock upgrades), keep transactions short, and use batch updates ordered by key.</p>
<p><strong>Advisory locks</strong> are locks on application-defined integers (one bigint or two ints). PostgreSQL attaches no meaning to them; they are perfect for "only one instance of this cron job at a time" or "only one worker processes tenant 42". Two scopes: <em>session-level</em> (<code>pg_advisory_lock</code>, held until explicitly unlocked or the session ends — survives COMMIT and even ROLLBACK) and <em>transaction-level</em> (<code>pg_advisory_xact_lock</code>, released automatically at transaction end). <code>pg_try_*</code> variants return false immediately instead of waiting.</p>
<p>Analogy: two people in a narrow corridor each waiting for the other to step back — someone must be told to back off (the deadlock victim). Advisory locks are a "room occupied" sign the team agreed to respect: the building does not enforce it, but everyone checks it.</p>`,
  why: `<p>Deadlocks waste work (a transaction is aborted after waiting a second) and surface as errors to users; at scale they indicate inconsistent access ordering that also causes lock contention. Advisory locks solve coordination problems (singletons, leader election, per-entity serialization) without extra infrastructure like Redis or ZooKeeper.</p>`,
  useCase: `<p>A payments platform saw ~300 deadlocks/day on its <code>wallets</code> table: transfers updated payer then payee. Changing the code to lock both wallets with <code>SELECT ... WHERE id IN ($1,$2) ORDER BY id FOR NO KEY UPDATE</code> dropped deadlocks to zero. Separately, its nightly settlement job runs on 6 Kubernetes pods; each tries <code>pg_try_advisory_lock(hashtextextended('settlement', 0))</code> and only the winner runs — no external lock service needed.</p>`,
  internals: `<ul>
<li>The detector (<code>DeadLockCheck</code>) builds the wait-for graph from the lock table, including <em>soft</em> edges (waiting behind an earlier queued request). It can sometimes resolve soft deadlocks by rearranging the wait queue instead of aborting.</li>
<li>The victim is the backend whose <code>deadlock_timeout</code> expired and found the cycle — not necessarily the "youngest" transaction.</li>
<li>Row-lock deadlocks appear in the log as waits on <code>transactionid</code> and include both queries when <code>log_lock_waits</code>/<code>deadlock</code> logging is on; <code>pg_stat_database.deadlocks</code> counts them.</li>
<li>Advisory locks live in the same shared lock table (<code>locktype = 'advisory'</code>; <code>classid/objid/objsubid</code> encode the key: objsubid = 1 for the bigint form, 2 for the two-int form). They count against <code>max_locks_per_transaction</code>.</li>
<li>Session-level advisory locks are re-entrant: locking the same key twice requires two unlocks.</li>
<li>Advisory locks are local to one server: they are not replicated to standbys and do not work across shards.</li>
</ul>`,
  whenNot: `<p>Do not "fix" deadlocks by raising <code>deadlock_timeout</code> — it only delays detection. Do not use session-level advisory locks through a transaction-pooling proxy (PgBouncer in transaction mode): the next transaction on that server connection may belong to another client, so locks leak or are released by the wrong client — use <code>pg_advisory_xact_lock</code> instead. Do not use advisory locks as a substitute for constraints that protect data integrity.</p>`,
  syntax: `SET deadlock_timeout = '1s';                    -- superuser/ALTER SYSTEM
SELECT deadlocks FROM pg_stat_database WHERE datname = current_database();

-- advisory locks (bigint key, or two int4 keys)
SELECT pg_advisory_lock(key);            SELECT pg_advisory_unlock(key);
SELECT pg_try_advisory_lock(key);        -- true/false, no wait
SELECT pg_advisory_xact_lock(key);       -- released at COMMIT/ROLLBACK
SELECT pg_try_advisory_xact_lock(key);
SELECT pg_advisory_lock_shared(key);     -- shared variant
SELECT pg_advisory_unlock_all();`,
  examples: [
    {
      label: 'Basic',
      title: 'Deadlock-free transfer: lock rows in a consistent order',
      sql: `CREATE TABLE wallets (id int PRIMARY KEY, owner text, balance numeric(12,2) NOT NULL CHECK (balance >= 0));
INSERT INTO wallets VALUES (1, 'Asha', 1000), (2, 'Bilal', 1000);

-- transfer(from := 2, to := 1, amount := 250)
BEGIN;
SELECT id, balance FROM wallets
WHERE id IN (2, 1)
ORDER BY id                  -- ALWAYS lower id first, whatever the transfer direction
FOR NO KEY UPDATE;

UPDATE wallets SET balance = balance - 250 WHERE id = 2;
UPDATE wallets SET balance = balance + 250 WHERE id = 1;
COMMIT;

SELECT * FROM wallets ORDER BY id;
SELECT deadlocks FROM pg_stat_database WHERE datname = current_database();
DROP TABLE wallets;`,
      explain: `<p>A transfer 1→2 and a transfer 2→1 running concurrently both lock wallet 1 first. The second one simply waits at the SELECT until the first commits — a queue, not a cycle. Without the ORDER BY, each transaction would lock "its" payer first and they could deadlock exactly as in the timeline. <code>pg_stat_database.deadlocks</code> is the cluster-level counter you should graph.</p>`,
      output: ` id | balance
----+---------
  1 |    1000.00
  2 |    1000.00

 id | owner | balance
----+-------+---------
  1 | Asha  | 1250.00
  2 | Bilal |  750.00

 deadlocks
-----------
         0`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Singleton job with a transaction-level advisory lock',
      sql: `-- Any number of app instances may start the nightly job; only one may run it.
BEGIN;
SELECT pg_try_advisory_xact_lock(hashtextextended('job:nightly-invoices', 0)) AS i_am_the_runner;

-- the lock is visible as an 'advisory' entry
SELECT locktype, classid, objid, objsubid, mode, granted
FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();

-- ... run the job's statements here (only if i_am_the_runner) ...
COMMIT;      -- lock released automatically

SELECT count(*) AS advisory_locks_after_commit
FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();`,
      explain: `<p><code>hashtextextended(text, seed)</code> turns a readable job name into a 64-bit key (collisions are astronomically unlikely, but keep a registry of names). <code>pg_try_advisory_xact_lock</code> returns <code>true</code> for exactly one instance; others get <code>false</code> and exit. Because it is transaction-scoped, the lock disappears at COMMIT/ROLLBACK or if the process crashes — no stale locks, and it is safe behind transaction-pooling proxies. The bigint key is split into <code>classid</code> (high 32 bits) and <code>objid</code> (low 32 bits) in pg_locks.</p>`,
      output: ` i_am_the_runner
-----------------
 t

 locktype | classid    | objid      | objsubid | mode          | granted
----------+------------+------------+----------+---------------+---------
 advisory | 2325812546 | 2254589482 |        1 | ExclusiveLock | t

 advisory_locks_after_commit
-----------------------------
                           0`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Session-level advisory locks: re-entrancy, two-key form and cleanup',
      sql: `-- session-level lock survives COMMIT/ROLLBACK and is re-entrant
SELECT pg_advisory_lock(42);
SELECT pg_advisory_lock(42);                        -- same session: granted again (count = 2)
SELECT pg_advisory_unlock(42) AS first_unlock,
       pg_advisory_unlock(42) AS second_unlock,
       pg_advisory_unlock(42) AS third_unlock;      -- nothing left: false (+ WARNING)

-- two-int form: (namespace, id), e.g. tenant-level serialization
SELECT pg_try_advisory_lock(3, 1001) AS tenant_lock,   -- namespace 3 = "tenant", id 1001
       pg_advisory_lock_shared(7)    AS shared_lock;

SELECT classid, objid, objsubid, mode
FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
ORDER BY objsubid, objid;

SELECT pg_advisory_unlock_all();                    -- always clean up session locks
SELECT count(*) AS remaining FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();`,
      explain: `<p>Session-level locks stack: two <code>pg_advisory_lock(42)</code> calls need two unlocks; the third unlock returns false and emits a WARNING. The two-int form shows <code>objsubid = 2</code>; the bigint form <code>objsubid = 1</code> — keys in the two forms never collide with each other. Shared advisory locks allow many holders but exclude exclusive ones (reader/writer pattern). Always unlock in a <code>finally</code> block — or prefer xact-level locks — because a forgotten session lock lives as long as the pooled connection.</p>`,
      output: ` first_unlock | second_unlock | third_unlock
--------------+---------------+--------------
 t            | t             | f

 tenant_lock | shared_lock
-------------+-------------
 t           |

 classid | objid | objsubid | mode
---------+-------+----------+---------------
       0 |     7 |        1 | ShareLock
       3 |  1001 |        2 | ExclusiveLock

 remaining
-----------
         0`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `CREATE TABLE wallets (id int PRIMARY KEY, balance numeric);
INSERT INTO wallets VALUES (1, 1000), (2, 1000);
-- transfer(from, to): locks payer first, payee second.
-- Concurrent transfer(1,2) and transfer(2,1) lock in opposite orders -> deadlock risk
BEGIN;
UPDATE wallets SET balance = balance - 100 WHERE id = 2;   -- payer first
UPDATE wallets SET balance = balance + 100 WHERE id = 1;   -- payee second
COMMIT;`,
      why: 'Lock order depends on transfer direction, so two opposite transfers can each hold one row and wait for the other.',
      run: true
    },
    good: {
      sql: `CREATE TABLE wallets (id int PRIMARY KEY, balance numeric);
INSERT INTO wallets VALUES (1, 1000), (2, 1000);
-- Same transfer(2 -> 1), but both rows are locked first in key order
BEGIN;
SELECT id FROM wallets WHERE id IN (2, 1) ORDER BY id FOR NO KEY UPDATE;
UPDATE wallets SET balance = balance - 100 WHERE id = 2;
UPDATE wallets SET balance = balance + 100 WHERE id = 1;
COMMIT;
SELECT * FROM wallets ORDER BY id;`,
      why: 'Every transfer, whatever its direction, locks wallet 1 before wallet 2, so opposite transfers queue behind each other instead of forming a cycle.',
      run: true
    }
  },
  mistakes: [
    'Locking rows in an order that depends on input (payer/payee, the order items arrive in a request) — sort keys before locking.',
    'Lock upgrades: SELECT ... FOR SHARE followed by UPDATE in the same transaction.',
    'Raising <code>deadlock_timeout</code> to "reduce deadlocks" — it only delays the error and increases lock wait times.',
    'Not retrying on SQLSTATE 40P01; deadlocks are expected occasionally and the transaction is safe to retry.',
    'Using session-level advisory locks through PgBouncer transaction pooling, or forgetting to unlock them.'
  ],
  best: [
    'Establish a global lock order (by table, then by primary key) and document it.',
    'Lock all needed rows up front with <code>ORDER BY pk FOR UPDATE / FOR NO KEY UPDATE</code>.',
    'Retry deadlock (40P01) and serialization (40001) failures automatically with a bounded number of attempts.',
    'Prefer transaction-level advisory locks (<code>pg_advisory_xact_lock</code>, <code>pg_try_advisory_xact_lock</code>).',
    'Graph <code>pg_stat_database.deadlocks</code> and keep <code>log_lock_waits = on</code> to get both queries of each deadlock in the log.'
  ],
  performance: `<p>Each deadlock costs at least <code>deadlock_timeout</code> of waiting plus the rolled-back work. Lowering <code>deadlock_timeout</code> detects faster but runs the (somewhat expensive) detector more often on normal waits; 1 s is a sensible default. Advisory locks are cheap (same lock manager), but thousands of held keys per session consume lock-table slots.</p>`,
  security: `<p>Advisory locks are not permission-checked: any role can lock any key and block cooperating processes. In multi-tenant databases shared with untrusted roles, a malicious user could hold keys used by your jobs. Namespace keys and restrict who can connect.</p>`,
  scenario: {
    title: 'Hundreds of deadlocks per day after launching bulk order updates',
    steps: [
      '1. pg_stat_database.deadlocks jumped from ~0 to 400/day; the log shows "deadlock detected" between two UPDATE order_items statements.',
      '2. Log details: process A waits for ShareLock on transaction X held by B and vice versa; both are batch status updates from two services.',
      '3. Root cause: service 1 updates items ordered by created_at, service 2 by product_id — different lock orders over overlapping rows.',
      '4. Fix: both services lock with SELECT id FROM order_items WHERE ... ORDER BY id FOR NO KEY UPDATE, then update.',
      '5. Add automatic retry on SQLSTATE 40P01 (max 3 attempts, jittered backoff).',
      '6. Verify: deadlocks back to near zero; enable log_lock_waits to catch new ordering problems early.'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'How does PostgreSQL detect deadlocks?', a: 'Lazily: a backend that has waited for a lock longer than deadlock_timeout runs the deadlock detector, which examines the wait-for graph (hard and soft edges) in the lock table. If it finds a cycle involving itself, that backend aborts its transaction with SQLSTATE 40P01; the others proceed. Sometimes soft deadlocks are resolved by reordering wait queues instead.' },
    { q: 'What are the main ways to prevent deadlocks?', a: 'Acquire locks in a consistent global order (sort keys, ORDER BY pk FOR UPDATE), take the strongest needed lock first instead of upgrading, keep transactions short and touch fewer rows per transaction, and retry when one happens anyway.' },
    { q: 'What is the difference between pg_advisory_lock and pg_advisory_xact_lock?', a: 'pg_advisory_lock is session-scoped: it persists across transactions (even after ROLLBACK) until pg_advisory_unlock or session end, and is re-entrant. pg_advisory_xact_lock is released automatically at transaction end and cannot be unlocked manually; it is safer with transaction-pooling proxies.' },
    { q: 'Give two good use cases for advisory locks.', a: 'Ensuring only one instance of a scheduled job runs across many app servers (pg_try_advisory_lock on a job key), and serializing work per entity (e.g. per tenant or per account) where the entity is not a single row, such as rebuilding a tenant\'s aggregates.' }
  ],
  exercises: [
    {
      task: 'Write the lock-ordering step of a transfer between accounts 7 and 3 (any direction) using a copy of departments as "accounts", locking both rows in id order.',
      solution: `CREATE TABLE acc AS SELECT id, budget AS balance FROM departments;
ALTER TABLE acc ADD PRIMARY KEY (id);
BEGIN;
SELECT id, balance FROM acc WHERE id IN (7, 3) ORDER BY id FOR NO KEY UPDATE;
UPDATE acc SET balance = balance - 1000 WHERE id = 7;
UPDATE acc SET balance = balance + 1000 WHERE id = 3;
COMMIT;
SELECT * FROM acc WHERE id IN (3, 7) ORDER BY id;`,
      run: true
    },
    {
      task: 'Take a transaction-level advisory lock for tenant 2 using the two-key form (namespace 10) and prove it is gone after ROLLBACK.',
      solution: `BEGIN;
SELECT pg_try_advisory_xact_lock(10, 2) AS got_it;
SELECT classid, objid, objsubid FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();
ROLLBACK;
SELECT count(*) AS still_held FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();`,
      run: true
    }
  ],
  challenge: {
    task: 'Implement a PL/pgSQL function run_exclusively(job text) RETURNS text that tries a transaction-level advisory lock on hashtextextended(job, 0), returns \'skipped\' if not acquired, otherwise performs a dummy unit of work (insert into a job_runs table) and returns \'ran\'. Call it twice in the same transaction and explain the result.',
    hint: 'In the same transaction the lock is re-entrant, so the second call also succeeds. Concurrency protection applies across sessions.',
    solution: `CREATE TABLE job_runs (job text, ran_at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION run_exclusively(job text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(job, 0)) THEN
    RETURN 'skipped';
  END IF;
  INSERT INTO job_runs (job) VALUES (job);
  RETURN 'ran';
END $$;
BEGIN;
SELECT run_exclusively('nightly-invoices') AS first_call,
       run_exclusively('nightly-invoices') AS second_call_same_txn;
SELECT count(*) AS runs FROM job_runs;
COMMIT;`,
    run: true
  },
  related: ['locks-table-level-modes', 'locks-row-level-pg-locks', 'concurrency-problems-locking-strategies', 'isolation-levels'],
  quiz: [
    { type: 'mcq', q: 'What happens when PostgreSQL detects a deadlock?', options: ['Both transactions are rolled back', 'One transaction (the one that ran the check) is aborted with SQLSTATE 40P01', 'The server restarts', 'Both wait until lock_timeout'], answer: 1, explain: 'One participant is aborted so the others can continue; the client should retry.' },
    { type: 'tf', q: 'Increasing deadlock_timeout reduces the number of deadlocks.', answer: false, explain: 'It only delays detection; the cycle exists regardless.' },
    { type: 'bug', q: 'Behind PgBouncer in transaction-pooling mode, what is wrong?', code: `SELECT pg_advisory_lock(99);
-- next request, possibly another server connection
SELECT pg_advisory_unlock(99);`, options: ['Nothing', 'The unlock may run on a different server connection, so the original lock leaks while another client\'s connection may hold it', 'Advisory locks need superuser', 'Key 99 is reserved'], answer: 1, explain: 'Session-level locks are tied to the server connection; with transaction pooling use pg_advisory_xact_lock.' },
    { type: 'design', q: 'Five app pods run the same cron schedule; the job must run once. Simplest robust approach in PostgreSQL?', options: ['SELECT ... FOR UPDATE on a random table', 'pg_try_advisory_xact_lock(hashtextextended(\'job-name\', 0)) at job start; exit if false', 'LOCK TABLE ... IN ACCESS EXCLUSIVE MODE', 'SERIALIZABLE isolation'], answer: 1, explain: 'A try-lock on a job key elects one runner; the xact variant cleans itself up on commit or crash.' },
    { type: 'predict', q: 'Result of the third call?', code: `SELECT pg_advisory_lock(5);
SELECT pg_advisory_lock(5);
SELECT pg_advisory_unlock(5), pg_advisory_unlock(5), pg_advisory_unlock(5);`, options: ['t, f, f', 't, t, f', 't, t, t', 'error'], answer: 1, explain: 'Session advisory locks are re-entrant: two locks need two unlocks; the third returns false.' }
  ]
}
]);

PGM.addLessons([
/* ===================================================================
   MODULE: isolation-levels
   =================================================================== */
{
  id: 'isolation-levels-read-phenomena',
  module: 'isolation-levels',
  title: 'Read Phenomena: Dirty Reads, Non-Repeatable Reads, Phantoms and Write Skew',
  level: 4,
  minutes: 24,
  summary: 'The anomalies that isolation levels exist to prevent, each shown as a two-session timeline, and which of them PostgreSQL allows at each level.',
  objectives: [
    'Define dirty read, non-repeatable read, phantom read, lost update and serialization anomaly (write skew)',
    'Recognise each anomaly on a two-session timeline',
    'Map the SQL standard isolation levels to the anomalies they allow',
    'State how PostgreSQL\'s implementation is stricter than the standard minimum',
    'Set and inspect the isolation level of a transaction'
  ],
  concept: `<p>The SQL standard defines isolation by which <strong>phenomena</strong> (anomalies caused by concurrent transactions) a level must prevent:</p>
<ul>
<li><strong>Dirty read</strong>: T1 reads data written by T2 that has not committed (and may roll back).</li>
<li><strong>Non-repeatable read</strong>: T1 reads a row twice and gets different values because T2 updated it and committed in between.</li>
<li><strong>Phantom read</strong>: T1 re-runs a query with a WHERE condition and gets a different <em>set</em> of rows because T2 inserted/deleted matching rows and committed.</li>
<li><strong>Serialization anomaly</strong>: the result of concurrently committed transactions differs from <em>every</em> possible serial (one-at-a-time) order. The classic case is <strong>write skew</strong>: two transactions read overlapping data, make disjoint writes based on what they read, and together violate an invariant neither violated alone.</li>
</ul>
<p>Analogy: reading a shared spreadsheet while others type in it. Dirty read = seeing a number someone is still typing and then deletes. Non-repeatable read = refreshing and seeing a cell changed. Phantom = refreshing and seeing a new row appear in your filtered view. Write skew = two managers each check "at least one other person is on call" and both go home.</p>
<h4>Non-repeatable read timeline (READ COMMITTED)</h4>
<table>
<tr><th>t</th><th>Session A</th><th>Session B</th></tr>
<tr><td>1</td><td><code>BEGIN;</code><br><code>SELECT price FROM products WHERE id = 7;</code> → 60912.97</td><td></td></tr>
<tr><td>2</td><td></td><td><code>UPDATE products SET price = 54821.67 WHERE id = 7; COMMIT;</code></td></tr>
<tr><td>3</td><td><code>SELECT price FROM products WHERE id = 7;</code> → 54821.67 (changed!)</td><td></td></tr>
</table>
<h4>Phantom timeline (READ COMMITTED)</h4>
<table>
<tr><th>t</th><th>Session A</th><th>Session B</th></tr>
<tr><td>1</td><td><code>SELECT count(*) FROM orders WHERE status = 'pending';</code> → 412</td><td></td></tr>
<tr><td>2</td><td></td><td><code>INSERT INTO orders (... status ...) VALUES (... 'pending' ...); COMMIT;</code></td></tr>
<tr><td>3</td><td><code>SELECT count(*) ... 'pending';</code> → 413 (phantom row)</td><td></td></tr>
</table>
<h4>Standard vs PostgreSQL</h4>
<table>
<tr><th>Level</th><th>Dirty read</th><th>Non-repeatable</th><th>Phantom</th><th>Serialization anomaly</th></tr>
<tr><td>READ UNCOMMITTED</td><td>allowed by std, <strong>not possible in PG</strong></td><td>possible</td><td>possible</td><td>possible</td></tr>
<tr><td>READ COMMITTED (PG default)</td><td>no</td><td>possible</td><td>possible</td><td>possible</td></tr>
<tr><td>REPEATABLE READ</td><td>no</td><td>no</td><td>allowed by std, <strong>not possible in PG</strong></td><td>possible</td></tr>
<tr><td>SERIALIZABLE</td><td>no</td><td>no</td><td>no</td><td>no</td></tr>
</table>
<p>PostgreSQL implements only three distinct levels: READ UNCOMMITTED behaves exactly like READ COMMITTED (MVCC never exposes uncommitted data), and REPEATABLE READ is snapshot isolation, which also prevents phantoms.</p>`,
  why: `<p>Picking an isolation level is picking which anomalies your code must handle itself. Most bugs blamed on "the database" are anomalies the chosen level allows: totals that do not add up within one report, double-booked resources from write skew, or overwritten updates. You can only reason about correctness if you can name the anomaly.</p>`,
  useCase: `<p>A hospital scheduling app requires at least one doctor on call per shift. Two doctors, each in their own session, check "how many others are on call?" (both see 2), and both mark themselves off. Under READ COMMITTED and REPEATABLE READ both commit and the shift has zero doctors — write skew. The fix was to run that transaction at SERIALIZABLE (one of the two gets a serialization failure and retries, then sees only one doctor left) — or to lock the shift row explicitly.</p>`,
  internals: `<ul>
<li>PostgreSQL never shows uncommitted data of other transactions because visibility is computed from snapshots and commit status (MVCC); there is no "read uncommitted" code path.</li>
<li>READ COMMITTED: new snapshot per statement → non-repeatable reads and phantoms between statements are possible; within a single statement the view is consistent.</li>
<li>REPEATABLE READ: one snapshot per transaction → stable reads and no phantoms for reads; but writes to rows changed concurrently fail with a serialization error, and write skew remains possible.</li>
<li>SERIALIZABLE: snapshot isolation plus Serializable Snapshot Isolation (SSI) conflict tracking; dangerous read/write dependency patterns cause one transaction to abort with SQLSTATE 40001.</li>
<li>The level must be set before the first query of the transaction: <code>BEGIN ISOLATION LEVEL ...</code> or <code>SET TRANSACTION ISOLATION LEVEL ...</code>; defaults come from <code>default_transaction_isolation</code>.</li>
</ul>`,
  whenNot: `<p>Do not raise the isolation level globally "to be safe": REPEATABLE READ and SERIALIZABLE require application retry logic for serialization failures, and SERIALIZABLE adds tracking overhead. Use the default READ COMMITTED with atomic statements and explicit locks where they suffice, and stronger levels for specific transactions that need them.</p>`,
  syntax: `BEGIN ISOLATION LEVEL { SERIALIZABLE | REPEATABLE READ | READ COMMITTED | READ UNCOMMITTED }
      [ READ WRITE | READ ONLY ] [ [ NOT ] DEFERRABLE ];
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;    -- first statement after BEGIN
SET default_transaction_isolation = 'repeatable read';
SHOW transaction_isolation;`,
  examples: [
    {
      label: 'Basic',
      title: 'Setting and checking the isolation level',
      sql: `SHOW default_transaction_isolation;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT current_setting('transaction_isolation') AS level;
COMMIT;

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SELECT current_setting('transaction_isolation') AS level,
       current_setting('transaction_read_only') AS read_only;
COMMIT;

-- READ UNCOMMITTED is accepted, but behaves as READ COMMITTED in PostgreSQL
BEGIN ISOLATION LEVEL READ UNCOMMITTED;
SELECT current_setting('transaction_isolation') AS level;
COMMIT;`,
      explain: `<p>The default is <code>read committed</code>. The level can be given in BEGIN or with SET TRANSACTION as the first statement; once a query has run, changing it raises <em>SET TRANSACTION ISOLATION LEVEL must be called before any query</em>. PostgreSQL reports <code>read uncommitted</code> when you ask for it, but the behaviour is identical to READ COMMITTED: dirty reads are impossible.</p>`,
      output: ` default_transaction_isolation
-------------------------------
 read committed

 level
-----------------
 repeatable read

 level        | read_only
--------------+-----------
 serializable | on

 level
------------------
 read uncommitted`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Write skew setup: the doctors-on-call invariant',
      sql: `CREATE TABLE on_call (
  shift_date date,
  doctor     text,
  on_call    boolean NOT NULL,
  PRIMARY KEY (shift_date, doctor)
);
INSERT INTO on_call VALUES ('2025-10-10', 'Dr. Rao', true), ('2025-10-10', 'Dr. Mehta', true);

-- Each doctor runs this logic in their own transaction:
--   1) check that at least one OTHER doctor stays on call
SELECT count(*) AS others_on_call
FROM on_call
WHERE shift_date = '2025-10-10' AND on_call AND doctor <> 'Dr. Rao';
--   2) if others_on_call >= 1 then go off call
UPDATE on_call SET on_call = false
WHERE shift_date = '2025-10-10' AND doctor = 'Dr. Rao';

SELECT * FROM on_call ORDER BY doctor;`,
      explain: `<p>Run sequentially (as here) the logic is correct: Dr. Rao sees 1 other doctor and goes off call; if Dr. Mehta then ran it, she would see 0 others and stay. Run <em>concurrently</em> under READ COMMITTED or REPEATABLE READ, both read the initial state (each sees 1 other), both update a <em>different</em> row (no row-lock conflict), both commit: zero doctors on call. That is write skew, a serialization anomaly — see the timeline in the next lesson and the SERIALIZABLE fix.</p>`,
      output: ` others_on_call
----------------
              1

 shift_date | doctor    | on_call
------------+-----------+---------
 2025-10-10 | Dr. Mehta | t
 2025-10-10 | Dr. Rao   | f`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'A consistent multi-statement report needs one snapshot',
      sql: `-- Under READ COMMITTED each statement sees a different snapshot; concurrent
-- payments could make these two numbers disagree. REPEATABLE READ (read-only)
-- gives every statement the same snapshot, without blocking writers.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT count(*) AS paid_orders, sum(total_amount) AS paid_total
FROM orders WHERE status IN ('paid', 'shipped', 'delivered');

SELECT count(DISTINCT order_id) AS orders_with_success_payment, sum(amount) AS collected
FROM payments WHERE status = 'success';

COMMIT;`,
      explain: `<p>A month-end report runs several queries that must agree with each other. At READ COMMITTED, a payment committed between query 1 and query 2 would appear in one but not the other (non-repeatable read / phantom between statements). Wrapping the report in a REPEATABLE READ READ ONLY transaction freezes one snapshot for all statements. It takes no locks that block writers; the only cost is that it holds back VACUUM for its duration.</p>`,
      output: ` paid_orders | paid_total
-------------+---------------
        4157 | 1027401277.33

 orders_with_success_payment | collected
-----------------------------+--------------
                        4019 | 994586431.92`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Two separate autocommit statements: each sees a different snapshot
SELECT sum(total_amount) AS order_total FROM orders WHERE status = 'delivered';
SELECT sum(p.amount) AS payments_total
FROM payments p JOIN orders o ON o.id = p.order_id
WHERE o.status = 'delivered' AND p.status = 'success';`,
      why: 'Under READ COMMITTED (and autocommit) concurrent commits between the statements can make the two totals inconsistent with each other.',
      run: true
    },
    good: {
      sql: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT sum(total_amount) AS order_total FROM orders WHERE status = 'delivered';
SELECT sum(p.amount) AS payments_total
FROM payments p JOIN orders o ON o.id = p.order_id
WHERE o.status = 'delivered' AND p.status = 'success';
COMMIT;`,
      why: 'Both statements read the same snapshot, so they are mutually consistent; read-only REPEATABLE READ never fails with serialization errors.',
      run: true
    }
  },
  mistakes: [
    'Assuming READ COMMITTED gives a consistent view across statements of one transaction.',
    'Expecting READ UNCOMMITTED to be faster or to show uncommitted data in PostgreSQL — it is the same as READ COMMITTED.',
    'Believing REPEATABLE READ prevents all anomalies: write skew is still possible.',
    'Trying to change the isolation level after the first query of the transaction.',
    'Ignoring write skew because "there is no lost update": the rows written are different, so no row lock catches it.'
  ],
  best: [
    'Keep READ COMMITTED as default; choose higher levels per transaction where invariants span multiple rows.',
    'Use <code>REPEATABLE READ READ ONLY</code> for multi-statement reports and exports (pg_dump uses this internally).',
    'Use SERIALIZABLE (with retries) or explicit locking for invariants like "at least one", "no overlap", "sum ≤ limit".',
    'Document the anomaly each critical transaction is protected against and how.'
  ],
  performance: `<p>READ COMMITTED is cheapest. REPEATABLE READ costs almost nothing extra for reads but long transactions hold back VACUUM. SERIALIZABLE adds predicate-lock tracking (memory and CPU) and causes aborts that must be retried; under high contention retries can dominate. Measure retry rates.</p>`,
  security: `<p>Many authorization and limit checks ("balance ≥ amount", "user has quota left", "coupon not used") are multi-row invariants vulnerable to write skew under concurrency, which attackers can exploit with parallel requests. Protect them with constraints, SERIALIZABLE transactions, or explicit row locks on a guarding row.</p>`,
  scenario: {
    title: 'Two on-call doctors both went off shift',
    steps: [
      '1. Incident: the 10 Oct night shift had no doctor on call; both doctors used the app within 2 seconds.',
      '2. Reproduce with two sessions at READ COMMITTED following the timeline: both see 1 other doctor, both update their own row, both commit.',
      '3. Classify: write skew (serialization anomaly); no lost update because different rows were written.',
      '4. Option A: run the transaction at SERIALIZABLE and retry on SQLSTATE 40001.',
      '5. Option B: lock a guarding row (SELECT ... FROM shifts WHERE shift_date = $1 FOR UPDATE) before checking.',
      '6. Add a test that runs the two transactions concurrently and asserts at least one doctor remains.'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'Which isolation levels does PostgreSQL really implement?', a: 'Three: READ COMMITTED (default; READ UNCOMMITTED maps to it), REPEATABLE READ (snapshot isolation, which also prevents phantoms), and SERIALIZABLE (snapshot isolation plus SSI conflict detection). Dirty reads are impossible at every level.' },
    { q: 'What is write skew? Give an example.', a: 'Two transactions read an overlapping set of rows, each makes a decision based on that read, and they write different rows so no write-write conflict occurs; together they violate an invariant. Example: two doctors each see another doctor on call and both go off call, leaving none.' },
    { q: 'What is the difference between a non-repeatable read and a phantom?', a: 'A non-repeatable read is a change in the values of a row you already read (update/delete by another committed transaction). A phantom is a change in the set of rows matching a condition (new rows inserted or rows no longer matching).' },
    { q: 'Why might a report at READ COMMITTED show inconsistent totals?', a: 'Each statement takes a fresh snapshot, so commits that happen between statements are visible to later statements but not earlier ones. Running the report in a single REPEATABLE READ (read-only) transaction gives all statements one snapshot.' }
  ],
  exercises: [
    {
      task: 'Show that SET TRANSACTION ISOLATION LEVEL fails after a query has run in the transaction (wrap it so the error is caught).',
      solution: `DO $$
BEGIN
  PERFORM 1;
  BEGIN
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    RAISE NOTICE 'no error';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'error: %', SQLERRM;
  END;
END $$;`,
      run: true
    },
    {
      task: 'Run a REPEATABLE READ READ ONLY transaction that returns the number of customers and the number of orders in the same snapshot.',
      solution: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (SELECT count(*) FROM customers) AS customers, (SELECT count(*) FROM orders) AS orders;
COMMIT;`,
      run: true
    }
  ],
  challenge: {
    task: 'Design a schema-level guard that makes the doctors-on-call write skew impossible even at READ COMMITTED: introduce a shifts table with one row per shift and lock it before checking. Write the full transaction for Dr. Rao.',
    hint: 'Concurrent transactions for the same shift will serialize on the shift row lock (FOR UPDATE / FOR NO KEY UPDATE), so the second sees the first one\'s committed update.',
    solution: `CREATE TABLE shifts (shift_date date PRIMARY KEY);
CREATE TABLE on_call (shift_date date REFERENCES shifts, doctor text, on_call boolean NOT NULL,
                      PRIMARY KEY (shift_date, doctor));
INSERT INTO shifts VALUES ('2025-10-10');
INSERT INTO on_call VALUES ('2025-10-10', 'Dr. Rao', true), ('2025-10-10', 'Dr. Mehta', true);

BEGIN;
SELECT * FROM shifts WHERE shift_date = '2025-10-10' FOR NO KEY UPDATE;   -- guard row
UPDATE on_call SET on_call = false
WHERE shift_date = '2025-10-10' AND doctor = 'Dr. Rao'
  AND (SELECT count(*) FROM on_call
       WHERE shift_date = '2025-10-10' AND on_call AND doctor <> 'Dr. Rao') >= 1;
COMMIT;
SELECT * FROM on_call ORDER BY doctor;`,
    run: true
  },
  related: ['isolation-levels-rc-rr', 'isolation-levels-serializable', 'mvcc-snapshots-visibility', 'concurrency'],
  quiz: [
    { type: 'tf', q: 'In PostgreSQL, READ UNCOMMITTED allows dirty reads.', answer: false, explain: 'PostgreSQL treats READ UNCOMMITTED as READ COMMITTED; uncommitted data is never visible to other transactions.' },
    { type: 'mcq', q: 'T1 counts pending orders twice; between the counts T2 inserts a pending order and commits; the counts differ. Which phenomenon?', options: ['Dirty read', 'Non-repeatable read', 'Phantom read', 'Lost update'], answer: 2, explain: 'The set of rows matching the predicate changed: a phantom.' },
    { type: 'mcq', q: 'Which anomaly can still occur at REPEATABLE READ in PostgreSQL?', options: ['Dirty read', 'Non-repeatable read', 'Phantom read', 'Write skew'], answer: 3, explain: 'Snapshot isolation prevents the first three but not serialization anomalies like write skew.' },
    { type: 'scenario', q: 'A nightly export runs 12 queries that must be mutually consistent while OLTP continues. Best choice?', options: ['READ COMMITTED with LOCK TABLE', 'REPEATABLE READ READ ONLY transaction', 'SERIALIZABLE with retries', 'READ UNCOMMITTED'], answer: 1, explain: 'One snapshot for all queries, no locks blocking writers, no serialization failures for read-only RR.' }
  ]
},
{
  id: 'isolation-levels-rc-rr',
  module: 'isolation-levels',
  title: 'READ COMMITTED and REPEATABLE READ in PostgreSQL',
  level: 4,
  minutes: 24,
  summary: 'Exactly how PostgreSQL\'s two most-used levels behave for reads and writes: per-statement snapshots and EvalPlanQual rechecks vs snapshot isolation and "could not serialize access due to concurrent update".',
  objectives: [
    'Explain per-statement snapshots in READ COMMITTED and the UPDATE re-check behaviour',
    'Explain snapshot isolation in REPEATABLE READ and why phantoms do not occur',
    'Predict when REPEATABLE READ raises "could not serialize access due to concurrent update"',
    'Implement retry logic for SQLSTATE 40001',
    'Choose between the two for OLTP writes, reports and batch jobs'
  ],
  concept: `<h4>READ COMMITTED (default)</h4>
<p>Each <em>statement</em> sees a snapshot taken when it starts: everything committed before that moment. For UPDATE/DELETE/SELECT FOR UPDATE, if a target row was changed by a concurrent transaction, the statement <strong>waits</strong> for it; if that transaction commits, PostgreSQL re-reads the <em>newest</em> version of the row and re-evaluates the WHERE clause on it (EvalPlanQual). If the row still matches, it is updated; otherwise skipped. This makes atomic statements like <code>SET stock = stock - 1</code> safe, but can produce surprising results for statements whose WHERE involves other rows (they are not re-evaluated).</p>
<table>
<tr><th>t</th><th>A (READ COMMITTED)</th><th>B</th></tr>
<tr><td>1</td><td></td><td><code>BEGIN; UPDATE accounts SET balance = balance + 100 WHERE id = 1;</code></td></tr>
<tr><td>2</td><td><code>UPDATE accounts SET balance = balance * 2 WHERE id = 1;</code> ⏳ waits</td><td></td></tr>
<tr><td>3</td><td></td><td><code>COMMIT;</code></td></tr>
<tr><td>4</td><td>re-reads the new version (balance + 100) and doubles <em>that</em> → no lost update</td><td></td></tr>
</table>
<h4>REPEATABLE READ (snapshot isolation)</h4>
<p>One snapshot for the whole transaction, taken at its first statement. Reads are perfectly stable — no non-repeatable reads, and (unlike the SQL standard minimum) no phantoms. Writes: if the transaction tries to update/delete/lock a row that was modified by a transaction that committed <em>after</em> its snapshot, it cannot use the newer version (that would break the snapshot), so it fails:</p>
<table>
<tr><th>t</th><th>A (REPEATABLE READ)</th><th>B</th></tr>
<tr><td>1</td><td><code>BEGIN ISOLATION LEVEL REPEATABLE READ;</code><br><code>SELECT balance FROM accounts WHERE id = 1;</code> → 500</td><td></td></tr>
<tr><td>2</td><td></td><td><code>UPDATE accounts SET balance = 600 WHERE id = 1; COMMIT;</code></td></tr>
<tr><td>3</td><td><code>SELECT balance ... id = 1;</code> → still 500 (snapshot)</td><td></td></tr>
<tr><td>4</td><td><code>UPDATE accounts SET balance = balance - 50 WHERE id = 1;</code><br>ERROR: could not serialize access due to concurrent update (40001)</td><td></td></tr>
</table>
<p>The application must ROLLBACK and retry the whole transaction. Analogy: READ COMMITTED is a cashier who, when the customer's account changed while she was waiting, looks at the new balance and proceeds; REPEATABLE READ is an auditor working from a printed statement who refuses to sign anything that differs from her printout and asks you to start again.</p>`,
  why: `<p>These two levels cover 99% of PostgreSQL workloads. Knowing their precise write semantics avoids two opposite bugs: assuming READ COMMITTED protects multi-statement logic (it does not), and using REPEATABLE READ without retry handling (production errors under contention).</p>`,
  useCase: `<p>A stock brokerage computes margin requirements in a 40-statement transaction that reads positions, prices and limits. Under READ COMMITTED, price ticks committed mid-transaction produced internally inconsistent margin calls. Switching that transaction to REPEATABLE READ gave a consistent snapshot; the final <code>UPDATE accounts SET margin_status = ...</code> occasionally hit 40001 when the account changed concurrently (0.3% of runs), handled by an automatic retry. High-frequency order inserts stayed at READ COMMITTED with atomic statements.</p>`,
  internals: `<ul>
<li>READ COMMITTED snapshot: taken by each statement (and, within PL/pgSQL, by each SQL statement executed); stable/volatile functions see per-query snapshots accordingly.</li>
<li>EvalPlanQual: when a row-locking operation finds the target row updated by a committed concurrent transaction, the executor fetches the latest version (following the ctid chain), re-checks quals for that row only, and continues. Joins/subqueries referencing <em>other</em> tables are re-evaluated using the original snapshot for those rows, which can yield results inconsistent with any single point in time.</li>
<li>REPEATABLE READ: on an update conflict, if the concurrent updater committed, raise 40001; if it aborted, proceed normally. Inserts that hit a unique-key conflict with a row invisible to the snapshot also raise a serialization error in recent versions for <code>ON CONFLICT</code> cases.</li>
<li>Read-only REPEATABLE READ transactions can never fail with serialization errors.</li>
<li><code>pg_dump</code> uses REPEATABLE READ (SERIALIZABLE READ ONLY DEFERRABLE with <code>--serializable-deferrable</code>) to get a consistent dump without blocking writers.</li>
</ul>`,
  whenNot: `<p>Do not use REPEATABLE READ for high-contention write transactions on hot rows without retries — failure rates can be high; READ COMMITTED with atomic updates or row locks is better there. Do not use READ COMMITTED for multi-statement read logic that must be consistent (reports, exports, complex validations).</p>`,
  syntax: `BEGIN;                                       -- READ COMMITTED by default
BEGIN ISOLATION LEVEL REPEATABLE READ;
-- on error SQLSTATE 40001 (serialization_failure) or 40P01 (deadlock_detected):
ROLLBACK;  -- then retry the whole transaction from the start`,
  examples: [
    {
      label: 'Basic',
      title: 'REPEATABLE READ: one snapshot for the whole transaction',
      sql: `BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT pg_current_snapshot() AS snap_at_first_query;
SELECT count(*) AS orders_now FROM orders;

-- (in production, other sessions commit new orders here)

SELECT pg_current_snapshot() AS snap_later;   -- identical: same snapshot
SELECT count(*) AS orders_still FROM orders;  -- identical count, no phantoms
COMMIT;`,
      explain: `<p>Both snapshot readings are identical because REPEATABLE READ fixes the snapshot at the first statement. Any orders committed by other sessions after that point stay invisible until COMMIT, so the two counts are always equal. Under READ COMMITTED the second <code>pg_current_snapshot()</code> would advance whenever other transactions had committed meanwhile.</p>`,
      output: ` snap_at_first_query
---------------------
 753:753:

 orders_now
------------
       5000

 snap_later
------------
 753:753:

 orders_still
--------------
         5000`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'What REPEATABLE READ cannot do: write skew still commits',
      sql: `CREATE TABLE on_call (shift_date date, doctor text, on_call boolean NOT NULL, PRIMARY KEY (shift_date, doctor));
INSERT INTO on_call VALUES ('2025-10-10', 'Dr. Rao', true), ('2025-10-10', 'Dr. Mehta', true);

-- Session A (Dr. Rao) - REPEATABLE READ
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) AS others FROM on_call
WHERE shift_date = '2025-10-10' AND on_call AND doctor <> 'Dr. Rao';      -- 1
UPDATE on_call SET on_call = false WHERE shift_date = '2025-10-10' AND doctor = 'Dr. Rao';
COMMIT;

-- Timeline if Session B (Dr. Mehta) had started its RR snapshot BEFORE A committed:
--   B: SELECT count(*) ... doctor <> 'Dr. Mehta'   -> 1   (sees Dr. Rao still on call)
--   B: UPDATE ... doctor = 'Dr. Mehta'             -> no conflict: different row!
--   B: COMMIT                                       -> succeeds -> nobody on call
SELECT doctor, on_call FROM on_call ORDER BY doctor;`,
      explain: `<p>REPEATABLE READ only detects conflicts on <em>the same row</em> (write-write). A and B write different rows, so both commit and the invariant breaks. The commented timeline shows the B half that cannot be executed in a single-session playground (use the transaction lab to step through it). SERIALIZABLE detects this read-write dependency cycle; see the next lesson.</p>`,
      output: ` others
--------
      1

 doctor    | on_call
-----------+---------
 Dr. Mehta | t
 Dr. Rao   | f`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'A retry wrapper for serialization failures (server-side pattern)',
      sql: `CREATE TABLE acct_rr (id int PRIMARY KEY, balance numeric NOT NULL);
INSERT INTO acct_rr VALUES (1, 500);

-- A procedure can't retry its own failed transaction from inside an exception block,
-- so retries belong in the CLIENT. This function shows the shape of the unit of work
-- and returns which SQLSTATEs a client should retry on.
CREATE FUNCTION withdraw(p_id int, p_amount numeric) RETURNS numeric
LANGUAGE plpgsql AS $$
DECLARE new_balance numeric;
BEGIN
  UPDATE acct_rr SET balance = balance - p_amount
  WHERE id = p_id AND balance >= p_amount
  RETURNING balance INTO new_balance;
  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'insufficient funds' USING ERRCODE = 'P0001';
  END IF;
  RETURN new_balance;
END $$;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT withdraw(1, 120) AS balance_after;
COMMIT;

SELECT 'retry on' AS action, unnest(ARRAY['40001 serialization_failure', '40P01 deadlock_detected']) AS sqlstate;`,
      explain: `<p>The unit of work is wrapped in a function so the client can call it inside <code>BEGIN ISOLATION LEVEL REPEATABLE READ ... COMMIT</code> and simply re-run the whole transaction when it gets SQLSTATE 40001 or 40P01 (typical client loop: up to 3–5 attempts with jittered backoff). Never retry only the failed statement: the snapshot is stale, the whole transaction must restart. Business errors (P0001 here) must not be retried.</p>`,
      output: ` balance_after
---------------
           380

 action   | sqlstate
----------+-----------------------------
 retry on | 40001 serialization_failure
 retry on | 40P01 deadlock_detected`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- READ COMMITTED: read in one statement, decide in the app, write in another
BEGIN;
SELECT stock FROM products WHERE id = 10;          -- app sees 11
UPDATE products SET stock = 10 WHERE id = 10;      -- writes a value computed from a stale read
COMMIT;`,
      why: 'A concurrent decrement committed between the SELECT and UPDATE is silently overwritten (lost update). READ COMMITTED does not detect it.',
      run: true
    },
    good: {
      sql: `-- REPEATABLE READ: the same pattern now fails loudly (40001) on a concurrent change,
-- so the client retries with fresh data instead of losing an update
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT stock FROM products WHERE id = 10;
UPDATE products SET stock = 10 WHERE id = 10;
COMMIT;`,
      why: 'Under REPEATABLE READ a concurrent committed change to the row makes the UPDATE fail with "could not serialize access due to concurrent update"; with a retry loop no update is lost. (An atomic UPDATE ... SET stock = stock - 1 is simpler still.)',
      run: true
    }
  },
  mistakes: [
    'Retrying only the failing statement after 40001 instead of the entire transaction.',
    'Using REPEATABLE READ without any retry logic and surfacing serialization errors to users.',
    'Thinking READ COMMITTED UPDATEs re-run subqueries against fresh data: only the target row is re-checked.',
    'Expecting REPEATABLE READ to prevent write skew.',
    'Keeping REPEATABLE READ report transactions open for hours, blocking VACUUM cluster-wide.'
  ],
  best: [
    'OLTP writes: READ COMMITTED with atomic UPDATEs, constraints and row locks.',
    'Consistent multi-statement reads: REPEATABLE READ READ ONLY (never fails).',
    'Read-modify-write transactions that must detect concurrent changes: REPEATABLE READ or SERIALIZABLE with client retries.',
    'Implement one generic retry helper for 40001/40P01 in the data-access layer.',
    'Bound transaction duration with statement_timeout/transaction_timeout.'
  ],
  performance: `<p>Neither level adds locking overhead for reads. Costs come from retries (wasted work) and from long-lived snapshots holding back cleanup. Measure <code>pg_stat_database.xact_rollback</code> and application retry counters; if retries exceed a few percent, reduce contention or switch hot paths to atomic statements.</p>`,
  security: `<p>Check-then-act authorization logic at READ COMMITTED is vulnerable to races. Either enforce rules in single statements/constraints or use REPEATABLE READ/SERIALIZABLE with retries for the sensitive paths.</p>`,
  scenario: {
    title: 'Inconsistent margin calls during market open',
    steps: [
      '1. Symptom: margin reports show positions valued at prices from two different ticks.',
      '2. Cause: a 40-statement calculation at READ COMMITTED sees new price commits between statements.',
      '3. Fix: run the calculation in BEGIN ISOLATION LEVEL REPEATABLE READ.',
      '4. New errors appear: 40001 on the final UPDATE accounts when the account changed concurrently.',
      '5. Add a client retry loop (max 5 attempts, jittered backoff) around the whole transaction.',
      '6. Monitor: retry rate 0.3%, results now consistent per snapshot.'
    ]
  },
  widgets: ['lab:txn', 'diagram:mvcc'],
  interview: [
    { q: 'What does READ COMMITTED do when an UPDATE finds its target row modified by a concurrent committed transaction?', a: 'It waits for the other transaction to finish; if it committed, PostgreSQL fetches the newest version of the row, re-evaluates the WHERE clause on that version (EvalPlanQual), and applies the update to it if it still matches. This prevents lost updates for atomic statements but other parts of the query are not re-evaluated.' },
    { q: 'When does REPEATABLE READ raise "could not serialize access due to concurrent update"?', a: 'When the transaction tries to update, delete or lock a row that another transaction modified and committed after this transaction\'s snapshot was taken. Since it cannot see the new version without breaking its snapshot, it aborts with SQLSTATE 40001; the client must retry the whole transaction.' },
    { q: 'Does PostgreSQL REPEATABLE READ allow phantoms?', a: 'No. It uses a single snapshot for the transaction, so re-running a query returns the same rows. The SQL standard allows phantoms at this level, but PostgreSQL\'s snapshot isolation is stronger. Write skew, however, is still possible.' },
    { q: 'Why is a read-only REPEATABLE READ transaction ideal for reports?', a: 'It gives all statements one consistent snapshot, takes no locks that block writers, and cannot fail with serialization errors because it performs no writes.' }
  ],
  exercises: [
    {
      task: 'In a REPEATABLE READ transaction, insert a row into a temp table and show it is visible to your own later SELECT even though the snapshot did not change.',
      solution: `BEGIN ISOLATION LEVEL REPEATABLE READ;
CREATE TEMP TABLE rr_own (id int);
SELECT pg_current_snapshot() AS s1;
INSERT INTO rr_own VALUES (1);
SELECT pg_current_snapshot() AS s2, (SELECT count(*) FROM rr_own) AS visible_rows;
COMMIT;`,
      run: true
    },
    {
      task: 'Write a READ COMMITTED atomic UPDATE that cannot lose concurrent decrements of products.stock for product 10 and returns the new stock.',
      solution: `UPDATE products SET stock = stock - 1 WHERE id = 10 AND stock > 0 RETURNING id, stock;`,
      run: true
    }
  ],
  challenge: {
    task: 'A single session cannot commit "in between" its own statements, but you can still observe the per-statement nature of READ COMMITTED: show that transaction_timestamp() stays fixed across a transaction while statement_timestamp() (taken, like the READ COMMITTED snapshot, at each statement start) advances.',
    hint: 'transaction_timestamp() is fixed for the transaction; statement_timestamp() changes per statement, mirroring per-statement snapshots in READ COMMITTED.',
    solution: `BEGIN;
SELECT transaction_timestamp() AS txn_start, statement_timestamp() AS stmt1;
SELECT pg_sleep(0.05);
SELECT transaction_timestamp() AS txn_start, statement_timestamp() AS stmt3,
       statement_timestamp() > transaction_timestamp() AS new_statement_time;
COMMIT;`,
    run: true
  },
  related: ['isolation-levels-read-phenomena', 'isolation-levels-serializable', 'concurrency-problems-locking-strategies', 'mvcc'],
  quiz: [
    { type: 'predict', q: 'A (REPEATABLE READ) read balance = 500; B then sets it to 600 and commits; A runs UPDATE accounts SET balance = balance - 50 WHERE id = 1. Result?', code: `-- A, REPEATABLE READ
UPDATE accounts SET balance = balance - 50 WHERE id = 1;`, options: ['balance = 450', 'balance = 550', 'ERROR: could not serialize access due to concurrent update', 'A waits forever'], answer: 2, explain: 'The row was modified after A\'s snapshot by a committed transaction, so REPEATABLE READ aborts A with 40001.' },
    { type: 'predict', q: 'Same scenario but A is READ COMMITTED. Result?', code: `-- A, READ COMMITTED
UPDATE accounts SET balance = balance - 50 WHERE id = 1;`, options: ['450', '550', 'ERROR 40001', '600'], answer: 1, explain: 'READ COMMITTED re-reads the newest committed version (600) and applies the decrement: 550.' },
    { type: 'tf', q: 'After a 40001 error you can retry just the failed UPDATE and then COMMIT.', answer: false, explain: 'The transaction is aborted and its snapshot is stale; ROLLBACK and retry the entire transaction.' },
    { type: 'mcq', q: 'Which statement about REPEATABLE READ READ ONLY transactions is true?', options: ['They block writers', 'They can fail with 40001', 'They never fail with serialization errors and see one consistent snapshot', 'They see uncommitted data'], answer: 2, explain: 'Read-only RR transactions only read from their snapshot and cannot conflict.' }
  ]
},
{
  id: 'isolation-levels-serializable',
  module: 'isolation-levels',
  title: 'SERIALIZABLE: Serializable Snapshot Isolation, Predicate Locks and Retry Loops',
  level: 4,
  minutes: 25,
  summary: 'How PostgreSQL guarantees true serializability with SSI (SIRead predicate locks and rw-conflict detection), how it fixes write skew, and how to run it in production with retries.',
  objectives: [
    'Explain SSI: snapshot isolation plus detection of dangerous rw-antidependency structures',
    'Interpret SIReadLock entries in pg_locks and their granularity (tuple, page, relation)',
    'Walk through the doctors-on-call write skew and see where SERIALIZABLE aborts',
    'Design client retry loops and keep false positives low (indexes, short transactions, READ ONLY DEFERRABLE)',
    'Know the tuning knobs: max_pred_locks_per_transaction and friends'
  ],
  concept: `<p><strong>SERIALIZABLE</strong> guarantees that the outcome of any set of concurrently committed serializable transactions equals the outcome of running them in <em>some</em> serial order. PostgreSQL implements it with <strong>Serializable Snapshot Isolation (SSI)</strong> (since 9.1): every transaction runs on a snapshot exactly like REPEATABLE READ, but additionally PostgreSQL tracks what each transaction <em>read</em> with <strong>SIRead (predicate) locks</strong>. These locks never block anyone; they only record "T read this tuple / page / relation".</p>
<p>When T2 writes something T1 read (and T1 could not see the write), PostgreSQL records an <strong>rw-conflict</strong> T1 → T2. A non-serializable outcome always requires a "dangerous structure": two consecutive rw-conflicts T1 → T2 → T3 (T1 may equal T3) where T3 commits first. When it sees one, it aborts one transaction with SQLSTATE <code>40001</code> (<em>could not serialize access due to read/write dependencies among transactions</em>).</p>
<h4>Doctors on call under SERIALIZABLE</h4>
<table>
<tr><th>t</th><th>A (Dr. Rao)</th><th>B (Dr. Mehta)</th></tr>
<tr><td>1</td><td><code>BEGIN ISOLATION LEVEL SERIALIZABLE;</code><br><code>SELECT count(*) ... doctor &lt;&gt; 'Dr. Rao'</code> → 1 (SIRead on rows read)</td><td></td></tr>
<tr><td>2</td><td></td><td><code>BEGIN ISOLATION LEVEL SERIALIZABLE;</code><br><code>SELECT count(*) ... doctor &lt;&gt; 'Dr. Mehta'</code> → 1</td></tr>
<tr><td>3</td><td><code>UPDATE ... doctor = 'Dr. Rao'</code> (B read this row → rw-conflict B → A)</td><td></td></tr>
<tr><td>4</td><td></td><td><code>UPDATE ... doctor = 'Dr. Mehta'</code> (A read this row → rw-conflict A → B)</td></tr>
<tr><td>5</td><td><code>COMMIT;</code> ✔</td><td></td></tr>
<tr><td>6</td><td></td><td><code>COMMIT;</code> ✖ ERROR 40001 — retry: B now sees 0 others and stays on call</td></tr>
</table>
<p>Analogy: a referee who lets everyone play freely but keeps notes of who looked at what. If the notes show a pattern that could only happen if two players saw each other's "past", the referee cancels one play and asks for a redo — rather than stopping play every time two players get close (locking).</p>`,
  why: `<p>Many business rules span multiple rows ("no overlapping bookings", "total exposure ≤ limit", "at least one admin per tenant"). Enforcing them with explicit locks requires careful analysis of every code path. SERIALIZABLE lets you write straightforward transactional code and have the database guarantee correctness, at the cost of occasional retries.</p>`,
  useCase: `<p>A treasury system enforces counterparty exposure limits: a new trade may only commit if the sum of open trades with that counterparty stays ≤ ₹50 crore. Hundreds of traders book concurrently. With SERIALIZABLE, the booking transaction is simply "SELECT sum(...) ... ; if ok INSERT trade". Under contention ~1% of transactions get 40001 and are retried by the client library; no limit breach has occurred since, and no hand-written locking protocol is needed.</p>`,
  internals: `<ul>
<li><strong>SIRead locks</strong> are taken on tuples read by heap scans/index lookups, on index pages for index range scans (so inserts into scanned ranges are detected — that is how predicate/phantom conflicts are caught), and on whole relations for sequential scans. They appear in <code>pg_locks</code> with <code>mode = 'SIReadLock'</code>.</li>
<li><strong>Promotion</strong>: when a transaction holds too many tuple locks on a page (<code>max_pred_locks_per_page</code>, default 2) or pages in a relation (<code>max_pred_locks_per_relation</code>, default -2 → max_pred_locks_per_transaction / 2), they are promoted to coarser locks. Coarser locks cause more false-positive aborts. A sequential scan takes a relation-level SIRead lock immediately.</li>
<li>SIRead locks must outlive the transaction until all overlapping transactions finish, so long transactions increase memory use (<code>max_pred_locks_per_transaction</code> sizes the shared table).</li>
<li><strong>READ ONLY DEFERRABLE</strong>: a serializable read-only transaction can wait for a "safe snapshot" at start, after which it runs with no SSI tracking and can never be aborted — ideal for long reports and <code>pg_dump --serializable-deferrable</code>.</li>
<li>Serializable guarantees only cover transactions running at SERIALIZABLE; mixing levels on the same data weakens them. Standbys (hot standby) do not support SERIALIZABLE.</li>
</ul>`,
  whenNot: `<p>Avoid SERIALIZABLE for very high-contention hot spots where most transactions conflict (a single counter row) — retries will dominate; use atomic updates. Avoid it if you cannot add retry logic to the client. Do not use it on read replicas (not supported) and do not rely on it if some writers run at lower isolation levels.</p>`,
  syntax: `BEGIN ISOLATION LEVEL SERIALIZABLE;
BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;   -- safe snapshot, never aborts
SET default_transaction_isolation = 'serializable';

-- server settings (postgresql.conf)
-- max_pred_locks_per_transaction = 64
-- max_pred_locks_per_relation    = -2
-- max_pred_locks_per_page        = 2`,
  examples: [
    {
      label: 'Basic',
      title: 'SIRead predicate locks appear in pg_locks',
      sql: `BEGIN ISOLATION LEVEL SERIALIZABLE;

-- index lookup: tuple/page-level SIRead locks
SELECT id, status, total_amount FROM orders WHERE id = 42;

-- sequential scan: relation-level SIRead lock
SELECT count(*) FROM departments;

SELECT locktype, relation::regclass AS rel, page, tuple, mode
FROM pg_locks
WHERE pid = pg_backend_pid() AND mode = 'SIReadLock'
ORDER BY relation::regclass::text, locktype;
COMMIT;`,
      explain: `<p>The point lookup by primary key produced fine-grained SIRead locks (on the heap tuple at page 42, item 7, and on the index page of <code>orders_pkey</code> that was searched), while the sequential scan of <code>departments</code> produced a relation-level SIRead lock — any write to that table by a concurrent serializable transaction now creates an rw-conflict. SIRead locks never block; they only feed conflict detection. Lock granularity determines false positives: good indexes keep locks fine-grained. (Lock granularity depends on the plan the optimizer chose.)</p>`,
      output: ` locktype | rel         | page | tuple | mode
----------+-------------+------+-------+------------
 relation | departments |      |       | SIReadLock
 tuple    | orders      |   42 |     7 | SIReadLock
 page     | orders_pkey |    1 |       | SIReadLock
(3 rows)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Doctors on call: the serializable transaction (one side)',
      sql: `CREATE TABLE on_call (shift_date date, doctor text, on_call boolean NOT NULL, PRIMARY KEY (shift_date, doctor));
INSERT INTO on_call VALUES ('2025-10-10', 'Dr. Rao', true), ('2025-10-10', 'Dr. Mehta', true);

BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT count(*) AS others_on_call
FROM on_call
WHERE shift_date = '2025-10-10' AND on_call AND doctor <> 'Dr. Rao';

UPDATE on_call SET on_call = false
WHERE shift_date = '2025-10-10' AND doctor = 'Dr. Rao';

SELECT locktype, relation::regclass, mode FROM pg_locks
WHERE pid = pg_backend_pid() AND mode = 'SIReadLock';
COMMIT;

SELECT doctor, on_call FROM on_call ORDER BY doctor;`,
      explain: `<p>This is exactly what each doctor's session runs. Alone it commits. When Dr. Mehta's identical transaction runs concurrently (see the timeline in the concept section), each transaction reads the row the other one updates, forming the rw-conflict cycle A → B → A; PostgreSQL aborts one of them at UPDATE or COMMIT time with SQLSTATE 40001. On retry, the aborted doctor sees <code>others_on_call = 0</code> and the application refuses to take them off call. Here the planner read through the primary-key index, so the SIRead locks are fine-grained: an index page of <code>on_call_pkey</code> (this is what detects a concurrent INSERT of a new on-call row — a phantom) and the tuple that was read.</p>`,
      output: ` others_on_call
----------------
              1

 locktype | relation     | mode
----------+--------------+------------
 page     | on_call_pkey | SIReadLock
 tuple    | on_call      | SIReadLock

 doctor    | on_call
-----------+---------
 Dr. Mehta | t
 Dr. Rao   | f`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Long reports: SERIALIZABLE READ ONLY DEFERRABLE',
      sql: `BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;
-- waits (if needed) for a safe snapshot, then runs without SSI tracking:
-- it can never be aborted with 40001 and never causes others to abort.
SELECT o.status, count(*) AS orders, round(sum(o.total_amount), 2) AS revenue
FROM orders o
GROUP BY o.status
ORDER BY revenue DESC;

SELECT count(*) AS siread_locks_held
FROM pg_locks WHERE pid = pg_backend_pid() AND mode = 'SIReadLock';
COMMIT;`,
      explain: `<p>A deferrable read-only serializable transaction may pause briefly at its first query until no concurrent read-write serializable transaction could make its snapshot unsafe. From then on it behaves like a plain snapshot read: zero SIRead locks, no abort risk, and it does not penalize concurrent writers. This is the right way to run long serializable reports (and what <code>pg_dump --serializable-deferrable</code> uses).</p>`,
      output: ` status    | orders | revenue
-----------+--------+--------------
 delivered |   2527 | 626608982.67
 shipped   |    822 | 203314510.68
 paid      |    808 | 197477783.98
 pending   |    415 | 106366215.41
 cancelled |    428 | 102155945.74

 siread_locks_held
-------------------
                 0`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Serializable transaction that seq-scans a big table: relation-level SIRead lock,
-- so ANY concurrent serializable write to orders creates a conflict (false positives)
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT sum(total_amount) FROM orders WHERE customer_id = 42;   -- no index on customer_id
SELECT locktype, relation::regclass FROM pg_locks WHERE pid = pg_backend_pid() AND mode = 'SIReadLock';
COMMIT;`,
      why: 'Without an index the read is a sequential scan, which predicate-locks the whole table and greatly increases serialization failures.',
      run: true
    },
    good: {
      sql: `CREATE INDEX orders_customer_id_idx ON orders (customer_id);
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL enable_seqscan = off;   -- demo only: force the index path on this tiny table
SELECT sum(total_amount) FROM orders WHERE customer_id = 42;
SELECT locktype, count(*) FROM pg_locks
WHERE pid = pg_backend_pid() AND mode = 'SIReadLock' GROUP BY 1 ORDER BY 1;
COMMIT;`,
      why: 'An index scan takes fine-grained page/tuple SIRead locks, so only writes touching customer 42\'s rows or index range conflict.',
      run: true
    }
  },
  mistakes: [
    'Using SERIALIZABLE without a client retry loop for SQLSTATE 40001.',
    'Mixing isolation levels: transactions at READ COMMITTED writing the same data are not covered by SSI guarantees.',
    'Long serializable transactions: SIRead locks accumulate, promote to coarse locks, and false-positive aborts rise.',
    'Missing indexes, forcing sequential scans that take relation-level predicate locks.',
    'Trying SERIALIZABLE on a hot standby (not supported) or expecting it to make PL/pgSQL retries possible inside the same transaction.'
  ],
  best: [
    'Write a single retry helper: on 40001/40P01 roll back and re-run the whole transaction, with a cap and jittered backoff.',
    'Keep serializable transactions short and touch only what you need; declare READ ONLY when possible.',
    'Use <code>SERIALIZABLE READ ONLY DEFERRABLE</code> for long reports.',
    'Index the predicates used in serializable transactions to keep SIRead locks fine-grained.',
    'If you choose SERIALIZABLE, consider setting it as <code>default_transaction_isolation</code> for the app role so every writer participates.'
  ],
  performance: `<p>SSI adds CPU and shared memory for predicate lock tracking and causes aborts proportional to contention. Typical OLTP workloads see small overhead (a few percent) and low retry rates when transactions are short and well-indexed. Increase <code>max_pred_locks_per_transaction</code> if you see "out of shared memory" related to predicate locks or excessive promotion; monitor rollback rates.</p>`,
  security: `<p>SERIALIZABLE is an effective defence against race-condition exploits on multi-row invariants (limits, quotas, double booking) because the database rejects interleavings that could not happen serially — provided all writers use it.</p>`,
  scenario: {
    title: 'Exposure limits breached during peak trading',
    steps: [
      '1. Audit finds 3 counterparties above limit after a busy day; each booking checked the sum before inserting.',
      '2. Diagnosis: write skew — concurrent bookings each saw the old sum and inserted different rows.',
      '3. Move the booking transaction to SERIALIZABLE (ALTER ROLE trading SET default_transaction_isolation = \'serializable\').',
      '4. Add the client retry helper for 40001/40P01 (max 5 attempts).',
      '5. Ensure the sum query uses an index on (counterparty_id, status) so predicate locks stay fine-grained.',
      '6. Load-test with 200 concurrent bookers on one counterparty: no breach; retry rate 1.2%.'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'How does PostgreSQL implement SERIALIZABLE?', a: 'Serializable Snapshot Isolation: transactions use snapshots like REPEATABLE READ, plus non-blocking SIRead predicate locks that record what was read. Writes that touch what another concurrent transaction read create rw-antidependencies; when two consecutive rw-conflicts form a dangerous structure, one transaction is aborted with 40001 so the committed result is always equivalent to some serial order.' },
    { q: 'Do SIRead locks block other transactions?', a: 'No. They are only bookkeeping for conflict detection. They show up in pg_locks with mode SIReadLock and can persist briefly after commit until overlapping transactions finish.' },
    { q: 'What is READ ONLY DEFERRABLE for?', a: 'For serializable read-only transactions that should never be aborted: the transaction waits for a safe snapshot at its start and then runs without SSI tracking. Ideal for long reports and pg_dump --serializable-deferrable.' },
    { q: 'Why can missing indexes increase serialization failures?', a: 'Sequential scans take relation-level SIRead locks, so any concurrent write to that table registers a conflict. Index scans lock only the relevant tuples/pages, reducing false positives.' }
  ],
  exercises: [
    {
      task: 'Start a SERIALIZABLE READ ONLY transaction, read the count of employees in department 1, and list the SIRead locks it took.',
      solution: `BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY;
SELECT count(*) FROM employees WHERE department_id = 1;
SELECT locktype, relation::regclass, mode FROM pg_locks
WHERE pid = pg_backend_pid() AND mode = 'SIReadLock';
COMMIT;`,
      run: true
    },
    {
      task: 'Show the current values of the predicate-lock settings.',
      solution: `SELECT name, setting FROM pg_settings
WHERE name IN ('max_pred_locks_per_transaction', 'max_pred_locks_per_relation', 'max_pred_locks_per_page')
ORDER BY name;`,
      run: true
    }
  ],
  challenge: {
    task: 'Write the exposure-limit booking as a single serializable unit: a function book_trade(counterparty int, amount numeric, lim numeric) that sums open trades for the counterparty and inserts only if the new total stays within the limit; call it inside a SERIALIZABLE transaction twice so the second call is rejected.',
    hint: 'Raise an exception (not retried) when the limit would be exceeded. In production, concurrent calls are protected by SSI and retried on 40001.',
    solution: `CREATE TABLE trades (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, counterparty int NOT NULL,
                     amount numeric NOT NULL, status text NOT NULL DEFAULT 'open');
CREATE INDEX trades_cp_status_idx ON trades (counterparty, status);
CREATE FUNCTION book_trade(p_cp int, p_amount numeric, p_limit numeric) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE exposure numeric;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO exposure FROM trades WHERE counterparty = p_cp AND status = 'open';
  IF exposure + p_amount > p_limit THEN
    RETURN 'rejected: exposure would be ' || (exposure + p_amount);
  END IF;
  INSERT INTO trades (counterparty, amount) VALUES (p_cp, p_amount);
  RETURN 'booked: exposure now ' || (exposure + p_amount);
END $$;
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT book_trade(7, 30, 50) AS first, book_trade(7, 30, 50) AS second;
COMMIT;`,
    run: true
  },
  related: ['isolation-levels-read-phenomena', 'isolation-levels-rc-rr', 'locks-deadlocks-advisory', 'concurrency'],
  quiz: [
    { type: 'mcq', q: 'Which SQLSTATE indicates a serialization failure that should be retried?', options: ['23505', '40001', '42P01', '55P03'], answer: 1, explain: '40001 serialization_failure (40P01 deadlock_detected is also retryable).' },
    { type: 'tf', q: 'SIRead locks block concurrent writers until the reading transaction commits.', answer: false, explain: 'They never block; they only record reads for conflict detection.' },
    { type: 'scenario', q: 'A serializable workload has a 15% retry rate. pg_locks shows many relation-level SIReadLocks. Most effective fix?', options: ['Lower deadlock_timeout', 'Add indexes for the predicates so reads lock pages/tuples instead of whole relations; keep transactions short', 'Switch to READ UNCOMMITTED', 'Increase work_mem'], answer: 1, explain: 'Coarse predicate locks from seq scans cause false-positive conflicts.' },
    { type: 'mcq', q: 'Which transaction type can never fail with a serialization error?', options: ['SERIALIZABLE READ WRITE', 'SERIALIZABLE READ ONLY DEFERRABLE', 'REPEATABLE READ READ WRITE', 'Any transaction using SELECT FOR UPDATE'], answer: 1, explain: 'It starts from a safe snapshot and needs no SSI tracking.' }
  ]
}
]);

PGM.addLessons([
/* ===================================================================
   MODULE: transaction-internals
   =================================================================== */
{
  id: 'transaction-internals-xids-subtransactions',
  module: 'transaction-internals',
  title: 'Transaction IDs, the Commit Log and Subtransactions',
  level: 4,
  minutes: 26,
  summary: 'How PostgreSQL numbers transactions (32-bit XIDs, epochs, xid8, virtual XIDs), records their outcome in pg_xact, and why savepoints and PL/pgSQL exception blocks create costly subtransactions.',
  objectives: [
    'Explain 32-bit XIDs, modulo-2^32 comparison, epochs and the 64-bit xid8 type',
    'Distinguish virtual transaction IDs from real XIDs and know when each is assigned',
    'Describe the commit log (pg_xact) and pg_subtrans and what they store',
    'Show that SAVEPOINTs and EXCEPTION blocks allocate subtransaction XIDs',
    'Diagnose the 64-subtransaction overflow and SubtransSLRU contention'
  ],
  concept: `<p>Every transaction that modifies data gets a <strong>transaction ID (XID)</strong>, a 32-bit unsigned counter stored in each tuple's <code>xmin</code>/<code>xmax</code>. 32 bits allow ~4.2 billion values, so XIDs <strong>wrap around</strong>. PostgreSQL compares XIDs with modulo-2^32 arithmetic: for any XID, about 2.1 billion XIDs are "in the past" and 2.1 billion "in the future". That works only if no live tuple is more than ~2 billion transactions old — which is why VACUUM must <em>freeze</em> old tuples (see the vacuum module).</p>
<ul>
<li><strong>Epoch + xid8</strong>: the server also keeps an epoch counter (how many times the 32-bit XID has wrapped). <code>xid8</code> = epoch × 2^32 + xid is a 64-bit, never-wrapping ID used by functions like <code>pg_current_xact_id()</code>, <code>pg_xact_status()</code> and <code>pg_current_snapshot()</code>. Tuples still store 32-bit XIDs.</li>
<li><strong>Virtual XIDs</strong> (<code>backendID/localXID</code>): every transaction gets one at start; it costs nothing and is not persisted. A real XID is assigned lazily at the first write. Read-only transactions never consume XIDs.</li>
<li><strong>Commit log (pg_xact)</strong>: 2 bits per XID — in progress, committed, aborted, sub-committed. Visibility checks consult it (and cache the result in hint bits).</li>
<li><strong>Subtransactions</strong>: <code>SAVEPOINT</code>, each PL/pgSQL <code>BEGIN ... EXCEPTION</code> block entry, and drivers' "automatic savepoints" create subtransactions. A subtransaction that writes gets its <em>own XID</em>; <code>pg_subtrans</code> maps each subxid to its parent so others can resolve visibility.</li>
</ul>
<p>Analogy: XIDs are ticket numbers on a 4-billion-position circular dial. As long as everyone currently holding a ticket is within half a turn of the current number, "earlier" and "later" are unambiguous. Subtransactions are sub-tickets stapled to a main ticket; the clerk must look up the staple (pg_subtrans) whenever he cannot remember it.</p>
<h4>Why subtransactions get expensive</h4>
<p>Each backend caches up to <strong>64</strong> subtransaction XIDs in shared memory (<code>PGPROC_MAX_CACHED_SUBXIDS</code>). Beyond 64 active subxids, the transaction is marked <strong>overflowed</strong>; then <em>every other session</em> taking a snapshot can no longer rely on the in-memory list and must look up <code>pg_subtrans</code> for in-progress XIDs, causing heavy <code>SubtransSLRU</code> / <code>SubtransBuffer</code> waits. A single long transaction with thousands of savepoints can slow down an entire busy primary (and especially hot-standby replicas).</p>`,
  why: `<p>XID consumption drives wraparound maintenance; subtransactions are invisible in application code (ORMs, PL/pgSQL exception handlers, JDBC <code>autosave</code>) yet have caused major outages at scale. Understanding both lets you design write patterns that are cheap for the whole cluster.</p>`,
  useCase: `<p>A large SaaS platform's primary suddenly showed 30% of sessions waiting on <code>SubtransSLRU</code> and replicas lagging. The culprit: a nightly import loop in PL/pgSQL that wrapped each of 200,000 inserts in a <code>BEGIN ... EXCEPTION WHEN unique_violation</code> block inside one transaction — 200,000 subtransactions, overflowed after the first 64. Rewriting it as <code>INSERT ... ON CONFLICT DO NOTHING</code> (no subtransactions) removed the waits and made the import 12× faster.</p>`,
  internals: `<ul>
<li>XID comparison: <code>TransactionIdPrecedes(a, b)</code> computes <code>(int32)(a - b) &lt; 0</code>. Special XIDs: 0 invalid, 1 bootstrap, 2 frozen (historically; modern freezing sets an infomask bit instead of rewriting xmin).</li>
<li>XID assignment: <code>GetNewTransactionId()</code> under <code>XidGenLock</code>; also extends pg_xact and pg_subtrans pages as needed.</li>
<li><strong>pg_xact</strong>: SLRU files in <code>$PGDATA/pg_xact</code>, 8 kB pages × 4 XIDs per byte = 32,768 XIDs per page; truncated after <code>datfrozenxid</code> advances.</li>
<li><strong>pg_subtrans</strong>: SLRU mapping subxid → parent xid; not persisted across restarts (rebuilt as needed). The <code>subtransaction</code> row in <code>pg_stat_slru</code> shows its cache activity.</li>
<li>A subtransaction that does not write gets no XID, but still costs CPU (resource owner, memory context). Releasing a savepoint (<code>RELEASE</code>) merges it into the parent; its subxid still counts until top-level commit.</li>
<li>PG 16+ exposes <code>pg_stat_get_backend_subxact()</code> returning <code>subxact_count</code> and <code>subxact_overflowed</code> per backend. PG 17 made SLRU cache sizes configurable (<code>subtransaction_buffers</code>, <code>transaction_buffers</code>).</li>
</ul>`,
  whenNot: `<p>Do not use per-row exception blocks or per-row savepoints for "try insert, ignore duplicates" — use <code>ON CONFLICT</code>, <code>MERGE</code> or pre-filtering. Avoid driver features that issue a savepoint before every statement (e.g. JDBC <code>autosave=always</code>) on busy systems. Never reason about wall-clock time from XIDs.</p>`,
  syntax: `SELECT pg_current_xact_id();                       -- xid8 (assigns if needed)
SELECT pg_current_xact_id_if_assigned();           -- NULL if read-only so far
SELECT pg_xact_status('12345'::xid8);
SELECT (x::text::bigint >> 32) AS epoch, (x::text::bigint & 4294967295) AS xid32
FROM (SELECT pg_current_xact_id() AS x) s;

SAVEPOINT name;  RELEASE SAVEPOINT name;  ROLLBACK TO SAVEPOINT name;
SELECT * FROM pg_stat_get_backend_subxact(backend_id);   -- PG 16+
SELECT * FROM pg_stat_slru WHERE name IN ('transaction', 'subtransaction');`,
  examples: [
    {
      label: 'Basic',
      title: 'xid8 = epoch and 32-bit XID',
      sql: `BEGIN;
CREATE TEMP TABLE x (id int);
INSERT INTO x VALUES (1);                              -- forces XID assignment
SELECT pg_current_xact_id()                            AS xid8,
       pg_current_xact_id()::text::bigint >> 32        AS epoch,
       pg_current_xact_id()::text::bigint & 4294967295 AS xid32,
       (SELECT xmin FROM x)                            AS tuple_xmin;   -- 32-bit on disk
COMMIT;

-- what a cluster that wrapped twice would look like
SELECT '8589934594'::xid8                      AS xid8_example,
       '8589934594'::bigint >> 32              AS epoch,
       '8589934594'::bigint & 4294967295       AS xid32_stored_in_tuples;`,
      explain: `<p>In a young cluster the epoch is 0 and xid8 equals the 32-bit XID stored in <code>xmin</code>. After the 32-bit counter wraps, the epoch increments: xid8 8589934594 is epoch 2, XID 2. Tuples store only the 32-bit part, which is why old tuples must be frozen before the counter comes around again. Use xid8 functions in tooling to avoid ambiguity across wraparounds.</p>`,
      output: ` xid8 | epoch | xid32 | tuple_xmin
------+-------+-------+------------
  753 |     0 |   753 |        753

 xid8_example | epoch | xid32_stored_in_tuples
--------------+-------+------------------------
   8589934594 |     2 |                      2`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Savepoints create subtransactions with their own XIDs',
      sql: `BEGIN;
CREATE TEMP TABLE sx (id int, note text);
INSERT INTO sx VALUES (1, 'top level');
SAVEPOINT a;
INSERT INTO sx VALUES (2, 'in savepoint a');
SAVEPOINT b;
INSERT INTO sx VALUES (3, 'in savepoint b');
ROLLBACK TO SAVEPOINT b;          -- undo row 3 only
INSERT INTO sx VALUES (4, 'after rollback to b');
RELEASE SAVEPOINT a;

SELECT xmin, id, note FROM sx ORDER BY id;
SELECT pg_current_xact_id() AS top_level_xid;
SELECT virtualtransaction, transactionid, mode
FROM pg_locks WHERE pid = pg_backend_pid() AND locktype IN ('virtualxid', 'transactionid')
ORDER BY transactionid::text::bigint NULLS FIRST;
COMMIT;`,
      explain: `<p>Row 1 has the top-level XID; rows 2 and 4 were written inside subtransactions and carry <em>different</em> XIDs (subxids). Row 3 disappeared with <code>ROLLBACK TO SAVEPOINT b</code>: its subxid is marked aborted in pg_xact while the top-level transaction continues. While a savepoint is open, its subxid also holds an ExclusiveLock in pg_locks; after <code>RELEASE SAVEPOINT a</code> (which also ended the nested b-level work) only the top-level XID lock remains — sessions that wait on a row written by a released subtransaction look up its parent in pg_subtrans and wait on the top-level XID instead. Exact numbers vary.</p>`,
      output: ` xmin | id | note
------+----+---------------------
  753 |  1 | top level
  754 |  2 | in savepoint a
  756 |  4 | after rollback to b

 top_level_xid
---------------
           753

 virtualtransaction | transactionid | mode
--------------------+---------------+---------------
 0/3                |               | ExclusiveLock
 0/3                |           753 | ExclusiveLock`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Exception blocks in a loop: 100 subtransactions and the 64-subxid overflow',
      sql: `BEGIN;
CREATE TEMP TABLE sub_demo (id int, note text);

-- anti-pattern: one EXCEPTION block per row = one subtransaction per row
DO $$
BEGIN
  FOR i IN 1..100 LOOP
    BEGIN
      INSERT INTO sub_demo VALUES (i, 'row ' || i);
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;
END $$;

SELECT count(DISTINCT xmin::text)  AS distinct_xids,
       pg_current_xact_id()        AS top_level_xid
FROM sub_demo;

-- PG 16+: per-backend subtransaction cache status
SELECT subxact_count, subxact_overflowed
FROM pg_stat_get_backend_subxact(
       (SELECT b FROM pg_stat_get_backend_idset() AS b
        WHERE pg_stat_get_backend_pid(b) = pg_backend_pid()));
COMMIT;`,
      explain: `<p>Each loop iteration entered an exception block, started a subtransaction and, by inserting, assigned it a new XID: 100 distinct xmins under one top-level transaction. The backend's shared cache holds only 64 subxids, so <code>subxact_overflowed = true</code>. While this transaction remains open on a busy server, every snapshot taken by any session must consult pg_subtrans for in-progress XIDs — the root of SubtransSLRU contention. A plain <code>INSERT ... SELECT</code> or <code>INSERT ... ON CONFLICT DO NOTHING</code> writes all 100 rows with a single XID and no subtransactions.</p>`,
      output: ` distinct_xids | top_level_xid
---------------+---------------
           100 |           753

 subxact_count | subxact_overflowed
---------------+--------------------
            64 | t`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `CREATE TABLE emails (email text PRIMARY KEY);
-- "insert, ignore duplicates" with an exception block per row
DO $$
DECLARE e text;
BEGIN
  FOR e IN SELECT email FROM customers LOOP
    BEGIN
      INSERT INTO emails VALUES (e);
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;
END $$;
SELECT count(*) FROM emails;`,
      why: '500 subtransactions (overflowing the 64-entry cache), 500 subxids consumed, slow and harmful to every other session\'s snapshots.',
      run: true
    },
    good: {
      sql: `CREATE TABLE emails (email text PRIMARY KEY);
INSERT INTO emails SELECT email FROM customers
ON CONFLICT (email) DO NOTHING;
SELECT count(*) FROM emails;`,
      why: 'One statement, one XID, no subtransactions; ON CONFLICT handles duplicates using the unique index.',
      run: true
    }
  },
  mistakes: [
    'Wrapping each row of a loop in <code>BEGIN ... EXCEPTION ... END</code> in PL/pgSQL — every entry starts a subtransaction.',
    'Enabling driver-level automatic savepoints before every statement (e.g. JDBC <code>autosave=always</code>) on high-throughput systems.',
    'Keeping a transaction with hundreds of subtransactions open for minutes on a primary with hot standbys.',
    'Calling <code>txid_current()</code> / <code>pg_current_xact_id()</code> in read-only paths, needlessly consuming XIDs.',
    'Comparing XIDs as plain integers in tooling — use xid8 or age()/mxid_age().'
  ],
  best: [
    'Prefer set-based statements, <code>ON CONFLICT</code> and <code>MERGE</code> over per-row exception handling.',
    'If you need error isolation per batch, use one savepoint per batch (e.g. 1,000 rows), not per row.',
    'Monitor <code>wait_event</code> = <code>SubtransSLRU</code> / <code>SubtransBuffer</code> and <code>pg_stat_slru</code> for the subtransaction cache.',
    'Use xid8-based functions (<code>pg_current_xact_id</code>, <code>pg_xact_status</code>) in new code; <code>txid_*</code> functions are legacy aliases.',
    'Watch XID consumption rate (XIDs/hour) — it determines how often anti-wraparound vacuums are needed.'
  ],
  performance: `<p>Real XID assignment costs a lock acquisition and occasional SLRU page extension; at tens of thousands of write transactions per second it is measurable but fine. Subtransactions cost far more: CPU per entry/exit, a subxid per writing subtransaction, and, once overflowed, cluster-wide snapshot slowdowns. On standbys, overflowed transactions force snapshot lookups in pg_subtrans for all read queries.</p>`,
  security: `<p>XID exhaustion is an availability risk: a workload that burns XIDs quickly (e.g. millions of tiny write transactions or subtransactions) combined with blocked vacuuming can force the cluster into wraparound protection mode, refusing new writes. Treat XID consumption as a capacity metric.</p>`,
  scenario: {
    title: 'Primary and replicas slow down every night at 02:00',
    steps: [
      '1. Wait-event sampling shows 30% of active sessions in LWLock:SubtransSLRU between 02:00 and 02:40; replicas lag.',
      '2. pg_stat_activity during the window: one import session in a single transaction running a PL/pgSQL loop for 40 minutes.',
      '3. Confirm with pg_stat_get_backend_subxact(): subxact_overflowed = true for that backend.',
      '4. Code review: BEGIN ... EXCEPTION WHEN unique_violation around each INSERT (200k iterations).',
      '5. Rewrite as INSERT ... SELECT ... ON CONFLICT DO NOTHING in batches of 10k rows per transaction.',
      '6. Result: no SubtransSLRU waits, import time 40 min → 3 min, replica lag gone.'
    ]
  },
  widgets: ['diagram:mvcc'],
  interview: [
    { q: 'Why does PostgreSQL need to freeze tuples?', a: 'XIDs are 32-bit and compared modulo 2^32, so only ~2 billion XIDs can be "in the past" relative to the current one. A tuple whose xmin is older than that would suddenly appear to be in the future and become invisible. Freezing marks old tuples as visible to everyone regardless of XID comparison before that happens.' },
    { q: 'What is the difference between a virtual XID and a real XID?', a: 'Every transaction gets a virtual XID (backendID/localXID) at start; it is not stored on disk and consumes nothing. A real 32-bit XID is assigned only when the transaction first writes; it is stored in tuple headers, recorded in pg_xact and advances the global counter.' },
    { q: 'What problem occurs after 64 subtransactions?', a: 'Each backend caches up to 64 subtransaction XIDs in shared memory. Beyond that the cache overflows, so snapshots taken by any session must look up pg_subtrans to determine the parent of in-progress XIDs, causing SubtransSLRU contention that can slow down the whole primary and its standbys.' },
    { q: 'What creates subtransactions without an explicit SAVEPOINT?', a: 'Entering a PL/pgSQL block with an EXCEPTION clause, client drivers that set automatic savepoints (e.g. JDBC autosave, some ORMs for nested transactions), and procedural language error handling (e.g. plpy.subtransaction in PL/Python).' }
  ],
  exercises: [
    {
      task: 'Inside one transaction, insert one row at the top level and one inside a SAVEPOINT, then show that the two rows have different xmin values.',
      solution: `BEGIN;
CREATE TEMP TABLE t (id int);
INSERT INTO t VALUES (1);
SAVEPOINT s;
INSERT INTO t VALUES (2);
RELEASE SAVEPOINT s;
SELECT id, xmin FROM t ORDER BY id;
COMMIT;`,
      run: true
    },
    {
      task: 'Show the activity of the transaction and subtransaction SLRU caches.',
      solution: `SELECT name, blks_zeroed, blks_hit, blks_read, blks_written
FROM pg_stat_slru
WHERE name IN ('transaction', 'subtransaction');`,
      run: true
    }
  ],
  challenge: {
    task: 'Rewrite the per-row exception loop as a batch approach that still reports how many rows were skipped as duplicates, without subtransactions. Use customers.country values inserted into a table with a UNIQUE country column.',
    hint: 'INSERT ... ON CONFLICT DO NOTHING RETURNING inside a CTE gives the inserted rows; compare with the source count.',
    solution: `CREATE TABLE countries (country text PRIMARY KEY);
WITH src AS (SELECT country FROM customers),
ins AS (
  INSERT INTO countries SELECT country FROM src
  ON CONFLICT (country) DO NOTHING
  RETURNING 1
)
SELECT (SELECT count(*) FROM src) AS source_rows,
       (SELECT count(*) FROM ins) AS inserted,
       (SELECT count(*) FROM src) - (SELECT count(*) FROM ins) AS skipped_duplicates;`,
    run: true
  },
  related: ['transaction-internals-2pc-sync-commit', 'mvcc-snapshots-visibility', 'vacuum-wraparound', 'mvcc'],
  quiz: [
    { type: 'mcq', q: 'How many subtransaction XIDs can a backend cache in shared memory before its transaction is marked overflowed?', options: ['8', '64', '1024', 'Unlimited'], answer: 1, explain: 'PGPROC_MAX_CACHED_SUBXIDS is 64.' },
    { type: 'tf', q: 'A read-only transaction consumes a transaction ID.', answer: false, explain: 'Only a virtual XID is used; real XIDs are assigned at the first write.' },
    { type: 'predict', q: 'How many distinct xmin values do the rows have?', code: `BEGIN;
INSERT INTO t VALUES (1);
SAVEPOINT a; INSERT INTO t VALUES (2);
SAVEPOINT b; INSERT INTO t VALUES (3);
COMMIT;
SELECT count(DISTINCT xmin::text) FROM t;`, options: ['1', '2', '3', '0'], answer: 2, explain: 'Top level and each writing subtransaction get their own XIDs.' },
    { type: 'optimize', q: 'A PL/pgSQL import loops over 1M rows with BEGIN INSERT ... EXCEPTION WHEN unique_violation THEN NULL; END. Best fix?', options: ['Increase max_connections', 'INSERT ... SELECT ... ON CONFLICT DO NOTHING', 'Add more savepoints', 'Use SERIALIZABLE'], answer: 1, explain: 'Set-based ON CONFLICT avoids a subtransaction per row.' }
  ]
},
{
  id: 'transaction-internals-2pc-sync-commit',
  module: 'transaction-internals',
  title: 'Two-Phase Commit and Per-Transaction Durability (synchronous_commit)',
  level: 4,
  minutes: 22,
  summary: 'PREPARE TRANSACTION / COMMIT PREPARED for distributed transactions, why orphaned prepared transactions are dangerous, and how to trade durability for latency per transaction with synchronous_commit.',
  objectives: [
    'Explain the two-phase commit protocol and PostgreSQL\'s PREPARE TRANSACTION / COMMIT PREPARED',
    'Know the prerequisites (max_prepared_transactions) and monitor pg_prepared_xacts',
    'Describe the operational dangers of orphaned prepared transactions (locks, vacuum, wraparound)',
    'Choose synchronous_commit levels per transaction (off, local, remote_write, on, remote_apply)',
    'Quantify what can be lost with synchronous_commit = off'
  ],
  concept: `<h4>Two-phase commit (2PC)</h4>
<p>When one logical operation spans several independent databases (or a database and a message broker), each must commit or none. 2PC uses a <strong>coordinator</strong> (transaction manager — e.g. a Java XA manager, or your service) and two phases:</p>
<ol>
<li><strong>Prepare</strong>: the coordinator asks each participant to <code>PREPARE TRANSACTION 'gid'</code>. PostgreSQL writes the transaction's state durably to disk; the transaction is detached from the session but keeps all its locks. After a successful prepare, the participant promises it <em>can</em> commit even after a crash.</li>
<li><strong>Commit</strong>: if all participants prepared, the coordinator issues <code>COMMIT PREPARED 'gid'</code> everywhere (otherwise <code>ROLLBACK PREPARED</code>).</li>
</ol>
<p>Analogy: a wedding. "Do you take...?" — both must say "I do" (prepare) before the officiant declares them married (commit). If the officiant faints after both said "I do", they remain in limbo until someone declares the result.</p>
<p>That limbo is the danger: a prepared transaction that the coordinator never resolves stays forever, across restarts, holding its locks and its XID — blocking DDL, preventing VACUUM from cleaning anything newer than it, and eventually threatening wraparound. That is why <code>max_prepared_transactions</code> is <strong>0 by default</strong> (feature disabled); enable it only if you run a real transaction manager.</p>
<h4>synchronous_commit per transaction</h4>
<p>By default (<code>on</code>), COMMIT returns only after the commit WAL record is flushed to disk (and, with synchronous replication, confirmed by standbys). You can relax this per transaction:</p>
<table>
<tr><th>Value</th><th>COMMIT waits for</th><th>On crash</th></tr>
<tr><td><code>off</code></td><td>nothing (WAL writer flushes within ~3 × <code>wal_writer_delay</code>)</td><td>last ~600 ms of commits may be lost, but never corruption</td></tr>
<tr><td><code>local</code></td><td>local WAL flush</td><td>no loss locally; standby may lag</td></tr>
<tr><td><code>remote_write</code></td><td>local flush + standby received and wrote to OS</td><td>loss only if standby OS also crashes</td></tr>
<tr><td><code>on</code> (default)</td><td>local flush + standby flushed (if synchronous standbys configured)</td><td>no loss</td></tr>
<tr><td><code>remote_apply</code></td><td>standby applied it (visible to reads there)</td><td>no loss; read-your-writes on standby</td></tr>
</table>`,
  why: `<p>2PC is the standard way to get atomicity across heterogeneous resources when you cannot redesign around it (sagas/outbox are often better). <code>synchronous_commit</code> lets you pay for durability only where it matters: payments need it; click-tracking, session touches or cache tables often do not, and turning it off for them can multiply write throughput on slow disks.</p>`,
  useCase: `<p>A ticketing company writes page-view analytics events (8k/s) to PostgreSQL alongside bookings. Bookings use the default <code>synchronous_commit = on</code>. The analytics insert path runs <code>SET LOCAL synchronous_commit = off</code>: commits return without waiting for fsync, cutting p99 insert latency from 4 ms to 0.3 ms on network storage; a crash could lose under a second of analytics events, which is acceptable. A legacy integration with an IBM MQ queue uses XA/2PC; a monitoring job alerts when any row in <code>pg_prepared_xacts</code> is older than 5 minutes.</p>`,
  internals: `<ul>
<li><code>PREPARE TRANSACTION</code> writes a state file (contents in WAL; in <code>pg_twophase</code> if it survives a checkpoint) containing the XID, locks, subxids and pending actions. The session is then free; the transaction is owned by a "dummy" PGPROC slot (hence <code>max_prepared_transactions</code> sizes shared memory and lock tables, and requires a restart to change).</li>
<li>Prepared transactions keep their XID in every snapshot's in-progress list and hold back <code>xmin</code> horizons — exactly like a long-running open transaction, but surviving restarts.</li>
<li>A prepared transaction cannot be prepared if it used temporary tables, <code>LISTEN/NOTIFY</code>, or session-level advisory locks in ways that cannot be detached.</li>
<li><code>synchronous_commit = off</code> is <strong>safe for consistency</strong>: the database will recover to a consistent state, just missing the last transactions; unlike <code>fsync = off</code>, it cannot corrupt data. It is settable per session or transaction (<code>SET LOCAL</code>).</li>
<li>Commit timing: with <code>off</code>, the WAL writer flushes asynchronously; the maximum window is about 3 × <code>wal_writer_delay</code> (default 200 ms).</li>
</ul>`,
  whenNot: `<p>Avoid 2PC when an <strong>outbox pattern</strong> (write the event in the same local transaction, publish asynchronously) or a <strong>saga</strong> with compensations would do — they avoid in-doubt transactions holding locks. Do not set <code>synchronous_commit = off</code> globally for financial or user-visible confirmations ("your order is placed") — set it only for explicitly loss-tolerant writes.</p>`,
  syntax: `-- 2PC (requires max_prepared_transactions > 0, server restart to change)
BEGIN;
  ... changes ...
PREPARE TRANSACTION 'order-42-db1';
COMMIT PREPARED 'order-42-db1';      -- or ROLLBACK PREPARED 'order-42-db1'
SELECT * FROM pg_prepared_xacts;

-- durability per transaction
BEGIN;
SET LOCAL synchronous_commit = off;   -- off | local | remote_write | on | remote_apply
  ...
COMMIT;`,
  examples: [
    {
      label: 'Basic',
      title: 'Is 2PC enabled? Monitoring prepared transactions',
      sql: `SHOW max_prepared_transactions;    -- 0 = PREPARE TRANSACTION is disabled

-- the monitoring query every cluster using 2PC needs (alert on age > a few minutes)
SELECT gid, prepared, now() - prepared AS age, owner, database,
       age(transaction) AS xid_age
FROM pg_prepared_xacts
ORDER BY prepared;`,
      explain: `<p>This playground (like a default PostgreSQL install) has <code>max_prepared_transactions = 0</code>, so <code>PREPARE TRANSACTION</code> would fail with <em>prepared transactions are disabled</em>. The second query is what you schedule in production: any prepared transaction older than a few minutes means a coordinator failed to resolve it. <code>age(transaction)</code> shows how many XIDs have passed since it started — it holds back freezing.</p>`,
      output: ` max_prepared_transactions
---------------------------
 0

 gid | prepared | age | owner | database | xid_age
-----+----------+-----+-------+----------+---------
(0 rows)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'The full 2PC flow (requires max_prepared_transactions > 0)',
      sql: `-- On participant database A (e.g. orders DB)
BEGIN;
UPDATE products SET stock = stock - 1 WHERE id = 5;
INSERT INTO orders (customer_id, status, order_date, total_amount)
VALUES (42, 'paid', now(), 54244.73);
PREPARE TRANSACTION 'checkout-7f3a-db-orders';
-- session is now free; the transaction survives crashes and restarts, locks held

-- On participant B (e.g. a billing database) the coordinator does the same:
-- PREPARE TRANSACTION 'checkout-7f3a-db-billing';

-- Phase 2: every participant prepared OK -> commit everywhere
COMMIT PREPARED 'checkout-7f3a-db-orders';
-- If any participant failed to prepare -> ROLLBACK PREPARED on those that did.

-- Recovery after a coordinator crash: list in-doubt transactions and resolve them
SELECT gid, prepared FROM pg_prepared_xacts WHERE gid LIKE 'checkout-%';
-- COMMIT PREPARED '...'  or  ROLLBACK PREPARED '...'  per the coordinator's log`,
      explain: `<p>After <code>PREPARE TRANSACTION</code>, the work is durable but invisible to others, and the row lock on product 5 plus the table locks remain. The GID must be unique and should encode the global transaction (coordinator logs map GIDs to decisions). <code>COMMIT PREPARED</code> can be run from any session by the same user or a superuser. Not runnable here because prepared transactions are disabled in this environment.</p>`,
      output: `BEGIN
UPDATE 1
INSERT 0 1
PREPARE TRANSACTION
COMMIT PREPARED

 gid | prepared
-----+----------
(0 rows)`,
      run: false
    },
    {
      label: 'Advanced',
      title: 'Choosing durability per transaction with SET LOCAL synchronous_commit',
      sql: `CREATE TABLE page_views (id bigint GENERATED ALWAYS AS IDENTITY, url text, viewed_at timestamptz DEFAULT now());

-- loss-tolerant analytics write: do not wait for WAL flush
BEGIN;
SET LOCAL synchronous_commit = off;
INSERT INTO page_views (url) SELECT '/product/' || id FROM products LIMIT 50;
SELECT current_setting('synchronous_commit') AS inside_txn;
COMMIT;

-- business-critical write in the same session: default durability again
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 10;
SELECT current_setting('synchronous_commit') AS critical_txn;
COMMIT;

SELECT name, setting, unit FROM pg_settings
WHERE name IN ('synchronous_commit', 'wal_writer_delay', 'fsync');
DROP TABLE page_views;`,
      explain: `<p><code>SET LOCAL</code> confines <code>off</code> to one transaction, so the next transaction in the same pooled connection is back to the default. With <code>off</code>, COMMIT returns as soon as the commit record is in WAL buffers; the WAL writer flushes it within ~3 × <code>wal_writer_delay</code> (600 ms by default). A crash in that window loses those commits cleanly — no corruption. Note: this browser environment runs with <code>fsync = off</code> because it is an in-memory sandbox; never do that in production.</p>`,
      output: ` inside_txn
------------
 off

 critical_txn
--------------
 on

 name               | setting | unit
--------------------+---------+------
 fsync              | off     |          (sandbox only!)
 synchronous_commit | on      |
 wal_writer_delay   | 200     | ms`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Turning durability off for EVERYTHING in the session (or ALTER SYSTEM) to "speed up"
SET synchronous_commit = off;
UPDATE orders SET status = 'paid' WHERE id = 11;     -- a payment confirmation that could vanish on crash
RESET synchronous_commit;`,
      why: 'Session- or server-wide synchronous_commit = off also applies to payments and confirmations shown to users; a crash can lose transactions the user was told succeeded.',
      run: true
    },
    good: {
      sql: `-- Scope relaxed durability to explicitly loss-tolerant transactions
BEGIN;
SET LOCAL synchronous_commit = off;
INSERT INTO audit_logs (table_name, operation, row_id, changed_by)
VALUES ('products', 'UPDATE', 5, 'metrics-collector');
COMMIT;`,
      why: 'SET LOCAL limits the trade-off to one transaction whose loss is acceptable; everything else keeps full durability.',
      run: true
    }
  },
  mistakes: [
    'Enabling <code>max_prepared_transactions</code> "just in case" without a transaction manager — stray PREPAREs then hold locks and block vacuum indefinitely.',
    'Not monitoring <code>pg_prepared_xacts</code>; orphaned prepared transactions survive restarts and can lead to wraparound shutdown.',
    'Reusing or not persisting GIDs in the coordinator, making recovery decisions impossible.',
    'Confusing <code>synchronous_commit = off</code> (safe, may lose recent commits) with <code>fsync = off</code> (can corrupt the cluster).',
    'Setting <code>synchronous_commit = off</code> with <code>SET</code> instead of <code>SET LOCAL</code> behind a connection pooler, leaking it to other requests.'
  ],
  best: [
    'Prefer outbox/saga patterns over 2PC; if 2PC is needed, use a proper XA transaction manager with durable logs.',
    'Set <code>max_prepared_transactions</code> to at least <code>max_connections</code> only when 2PC is used; otherwise keep 0.',
    'Alert on prepared transactions older than a few minutes and document how to resolve them.',
    'Use <code>SET LOCAL synchronous_commit = off</code> for high-volume, loss-tolerant writes (metrics, events, caches).',
    'Use <code>remote_apply</code> only for transactions that need read-your-writes on synchronous standbys.'
  ],
  performance: `<p>2PC adds an extra durable write (the prepare) and an extra round trip per participant, and holds locks across the coordinator's decision latency. <code>synchronous_commit = off</code> removes the commit fsync wait from the transaction's latency — on disks with 2–10 ms fsync latency, single-row insert throughput per connection can rise 5–20×. <code>commit_delay</code>/<code>commit_siblings</code> offer group commit tuning for workloads that must stay durable.</p>`,
  security: `<p>Only the role that prepared a transaction (or a superuser) can commit or roll it back. Prepared transactions survive restarts and may contain sensitive pending changes; restrict who can create them by keeping the feature disabled unless needed.</p>`,
  scenario: {
    title: 'VACUUM stopped cleaning anything and disk filled up',
    steps: [
      '1. Alerts: n_dead_tup growing on all busy tables; autovacuum runs but removes nothing; age(datfrozenxid) climbing.',
      '2. Check the xmin horizon sources: pg_stat_activity (no old transactions), replication slots (fine), pg_prepared_xacts: one entry prepared 9 days ago.',
      '3. Coordinator logs: an XA transaction for a payment refund crashed after PREPARE; the decision was never sent.',
      '4. Decide per the coordinator\'s log (here: the refund was never confirmed) and run ROLLBACK PREPARED \'<gid>\'.',
      '5. Autovacuum immediately starts removing dead tuples; age(datfrozenxid) falls after the next freeze passes.',
      '6. Add monitoring for pg_prepared_xacts age &gt; 5 min and a runbook for in-doubt transactions.'
    ]
  },
  widgets: ['diagram:wal'],
  interview: [
    { q: 'What does PREPARE TRANSACTION do in PostgreSQL?', a: 'It ends the first phase of 2PC: the transaction\'s state is made durable and detached from the session, keeping its locks and XID. It is guaranteed to be committable later even after a crash. COMMIT PREPARED or ROLLBACK PREPARED with the same GID finishes it.' },
    { q: 'Why is max_prepared_transactions 0 by default?', a: 'Prepared transactions that are never resolved hold locks, hold back the xmin horizon (blocking vacuum) and can lead to wraparound protection. Without an external transaction manager there is no one to resolve them, so the feature is disabled unless explicitly needed.' },
    { q: 'Is synchronous_commit = off dangerous?', a: 'It can lose the most recently committed transactions (up to roughly 3 × wal_writer_delay) on an OS or server crash, but it cannot corrupt the database: recovery produces a consistent state. fsync = off, by contrast, can corrupt data. synchronous_commit can be set per transaction, so use it only for loss-tolerant writes.' },
    { q: 'What is the difference between remote_write, on and remote_apply?', a: 'With synchronous standbys configured: remote_write waits until the standby has written the WAL to its OS (not flushed); on waits until the standby flushed it to disk; remote_apply waits until the standby replayed it, making the change visible to queries on the standby.' }
  ],
  exercises: [
    {
      task: 'Write a query listing prepared transactions older than 5 minutes with their XID age (empty in the playground).',
      solution: `SELECT gid, prepared, now() - prepared AS age, owner, database, age(transaction) AS xid_age
FROM pg_prepared_xacts
WHERE prepared < now() - interval '5 minutes'
ORDER BY prepared;`,
      run: true
    },
    {
      task: 'Show that SET LOCAL synchronous_commit = local only applies inside the transaction.',
      solution: `BEGIN;
SET LOCAL synchronous_commit = local;
SELECT current_setting('synchronous_commit') AS inside;
COMMIT;
SELECT current_setting('synchronous_commit') AS outside;`,
      run: true
    }
  ],
  challenge: {
    task: 'Model the coordinator\'s side of 2PC in SQL: create a table global_txn(gid, participant, state) and write the statements a coordinator would record before PREPARE, after all PREPAREs succeed (decision = commit), and after COMMIT PREPARED completes, then query the in-doubt list (decided but not completed).',
    hint: 'The decision must be durably logged BEFORE sending COMMIT PREPARED to any participant; recovery replays decisions for rows not yet completed.',
    solution: `CREATE TABLE global_txn (gid text, participant text, state text NOT NULL
  CHECK (state IN ('preparing', 'prepared', 'commit_decided', 'committed', 'rolled_back')),
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (gid, participant));
INSERT INTO global_txn (gid, participant, state) VALUES
  ('checkout-7f3a', 'orders-db', 'preparing'), ('checkout-7f3a', 'billing-db', 'preparing');
UPDATE global_txn SET state = 'prepared' WHERE gid = 'checkout-7f3a';
UPDATE global_txn SET state = 'commit_decided' WHERE gid = 'checkout-7f3a';   -- durable decision
UPDATE global_txn SET state = 'committed' WHERE gid = 'checkout-7f3a' AND participant = 'orders-db';
-- coordinator crashes here; on restart:
SELECT gid, participant, state FROM global_txn WHERE state = 'commit_decided' ORDER BY participant;`,
    run: true
  },
  related: ['transaction-internals-xids-subtransactions', 'wal-durability-archiving', 'vacuum-wraparound', 'replication'],
  quiz: [
    { type: 'mcq', q: 'An orphaned prepared transaction has existed for 10 days. Which is NOT a consequence?', options: ['Its locks are still held', 'VACUUM cannot remove tuples newer than its XID horizon', 'It disappears after a server restart', 'It contributes to XID wraparound risk'], answer: 2, explain: 'Prepared transactions survive restarts; that is their purpose.' },
    { type: 'tf', q: 'synchronous_commit = off can leave the database in a corrupted state after a crash.', answer: false, explain: 'It may lose the latest commits but recovery is always consistent. fsync = off is the setting that risks corruption.' },
    { type: 'mcq', q: 'Which setting must be > 0 to use PREPARE TRANSACTION?', options: ['max_connections', 'max_prepared_transactions', 'max_wal_senders', 'max_locks_per_transaction'], answer: 1, explain: 'max_prepared_transactions (default 0, restart required).' },
    { type: 'design', q: 'A service must update its DB and publish a Kafka event atomically. Best default design?', options: ['XA two-phase commit between PostgreSQL and Kafka', 'Transactional outbox: insert the event into an outbox table in the same transaction, relay it asynchronously', 'synchronous_commit = remote_apply', 'Advisory locks'], answer: 1, explain: 'The outbox pattern gives atomicity with one local transaction and no in-doubt prepared transactions.' }
  ]
}
]);

PGM.addLessons([
/* ===================================================================
   MODULE: vacuum
   =================================================================== */
{
  id: 'vacuum-basics',
  module: 'vacuum',
  title: 'VACUUM, VACUUM ANALYZE and VACUUM FULL: What They Really Do',
  level: 4,
  minutes: 25,
  summary: 'What plain VACUUM, VACUUM ANALYZE and VACUUM FULL do to dead tuples, the visibility map and the free space map, how to read VACUUM VERBOSE, and where pg_repack fits.',
  objectives: [
    'Explain why MVCC needs VACUUM and what "removable" dead tuples are',
    'Describe the phases of plain VACUUM (heap scan, index cleanup, heap vacuum, truncation)',
    'Use the visibility map and free space map (pg_visibility, pg_freespacemap) to see VACUUM\'s effects',
    'Read VACUUM (VERBOSE) output line by line',
    'Choose between plain VACUUM, VACUUM FULL and pg_repack (third-party) for reclaiming space'
  ],
  concept: `<p>MVCC leaves dead tuple versions behind after UPDATE and DELETE. <strong>VACUUM</strong> is the garbage collector: it finds tuples that are dead to <em>every</em> possible snapshot ("removable"), removes them and their index entries, and makes the space reusable for future inserts and updates <em>in the same table</em>. It also maintains two per-table maps and freezes old tuples.</p>
<ul>
<li><strong>Plain <code>VACUUM</code></strong>: runs concurrently with reads and writes (SHARE UPDATE EXCLUSIVE lock). Does not normally shrink the file — except it truncates empty pages at the <em>end</em> of the table.</li>
<li><strong><code>VACUUM ANALYZE</code></strong>: VACUUM plus refreshing planner statistics (<code>pg_statistic</code>).</li>
<li><strong><code>VACUUM FULL</code></strong>: rewrites the entire table and its indexes into new files, compacting them and returning space to the OS. Requires an <strong>ACCESS EXCLUSIVE</strong> lock for the whole duration and temporary disk space for the copy.</li>
<li><strong>pg_repack</strong> <span class="tag tool">third-party tool</span> (an extension plus a client program): rebuilds a table online using a trigger-captured change log, holding an exclusive lock only briefly at the start and end. The usual production alternative to VACUUM FULL.</li>
</ul>
<p>Two maps make VACUUM and queries efficient:</p>
<ul>
<li><strong>Visibility map (VM)</strong>: 2 bits per heap page — <em>all-visible</em> (every tuple visible to all transactions) and <em>all-frozen</em>. VACUUM skips all-visible pages; index-only scans skip heap fetches for all-visible pages.</li>
<li><strong>Free space map (FSM)</strong>: approximate free bytes per page, used by INSERT/UPDATE to find a page with room.</li>
</ul>
<p>Analogy: a restaurant. Plain VACUUM is busing tables during service — dishes cleared, tables reusable, the dining room stays the same size. VACUUM FULL closes the restaurant to rebuild it smaller. pg_repack builds the smaller dining room next door while guests keep eating, then moves everyone in one quick step.</p>`,
  why: `<p>Without VACUUM, tables and indexes grow forever, queries scan ever more dead data, index-only scans stop working (VM not set), statistics go stale, and eventually transaction ID wraparound forces a shutdown. VACUUM is not optional maintenance; autovacuum runs it automatically, but engineers must understand it to tune it and to fix bloat.</p>`,
  useCase: `<p>A marketplace purged 70% of its 600 GB <code>listing_events</code> table with a DELETE. Disk usage did not drop at all — plain VACUUM made the space reusable but the file stayed 600 GB. Because the table kept growing at 5 GB/day, the reusable space was consumed within weeks, so no rewrite was needed. A different table, <code>search_cache</code>, shrank permanently from 80 GB to 9 GB of live data; there the team ran <code>pg_repack</code> during the day without downtime to return 70 GB to the OS.</p>`,
  internals: `<ol>
<li><strong>Heap scan</strong>: reads pages not marked all-visible in the VM; prunes HOT chains; collects TIDs of dead tuples into memory (<code>maintenance_work_mem</code> / <code>autovacuum_work_mem</code>; PG 17+ uses a compact TID store, removing the old 1 GB limit).</li>
<li><strong>Index vacuum</strong>: scans <em>every</em> index of the table once per batch of collected TIDs and deletes matching entries (the expensive part on wide-indexed tables; can be skipped with <code>INDEX_CLEANUP off</code> or when very few pages have dead items).</li>
<li><strong>Heap vacuum</strong>: marks the dead line pointers unused, updates the FSM, sets VM bits.</li>
<li><strong>Truncation</strong>: if trailing pages are empty, takes a brief ACCESS EXCLUSIVE lock to cut them off (disable with <code>TRUNCATE false</code> or the <code>vacuum_truncate</code> reloption if this lock is a problem on replicas).</li>
<li><strong>Freezing</strong>: tuples older than <code>vacuum_freeze_min_age</code> get frozen; relfrozenxid advances when the whole table has been checked.</li>
</ol>
<p>"Removable" depends on the <strong>xmin horizon</strong>: the oldest snapshot still in use anywhere (open transactions, replication slots, prepared transactions, standby feedback). Dead tuples newer than the horizon show up as "dead but not yet removable" in VERBOSE output.</p>`,
  whenNot: `<p>Do not run <code>VACUUM FULL</code> on production tables during business hours — it blocks all access. Do not schedule VACUUM FULL routinely; normal reuse of freed space is the healthy steady state. Do not disable autovacuum on a table to "save I/O" — tune it instead. Running plain VACUUM in a tight loop does not fix bloat caused by a long-running transaction holding the horizon.</p>`,
  syntax: `VACUUM [ ( option [, ...] ) ] [ table [ (column [, ...]) ] [, ...] ];
-- options: FULL, FREEZE, VERBOSE, ANALYZE, DISABLE_PAGE_SKIPPING, SKIP_LOCKED,
--          INDEX_CLEANUP {AUTO|ON|OFF}, PROCESS_MAIN, PROCESS_TOAST, TRUNCATE,
--          PARALLEL n, SKIP_DATABASE_STATS, ONLY_DATABASE_STATS, BUFFER_USAGE_LIMIT size
VACUUM (VERBOSE, ANALYZE) orders;
VACUUM FULL orders;                      -- ACCESS EXCLUSIVE, rewrites table

CREATE EXTENSION pg_visibility;   SELECT * FROM pg_visibility_map_summary('orders');
CREATE EXTENSION pg_freespacemap; SELECT * FROM pg_freespace('orders');`,
  examples: [
    {
      label: 'Basic',
      title: 'Read VACUUM (VERBOSE) after deleting 90% of a table',
      sql: `CREATE TABLE vac_demo AS SELECT * FROM orders;
CREATE INDEX ON vac_demo (customer_id);
DELETE FROM vac_demo WHERE id % 10 <> 0;      -- 4,500 dead tuples, 500 live
VACUUM (VERBOSE) vac_demo;`,
      explain: `<p>Line by line: <em>truncated 64 to 47 pages</em> — empty pages at the end were returned to the OS (only trailing pages can be). <em>tuples: 4500 removed, 500 remain, 0 are dead but not yet removable</em> — nothing held the xmin horizon back. <em>removable cutoff</em> — the horizon XID used. <em>visibility map: 47 pages set all-visible</em> — future VACUUMs skip them and index-only scans avoid heap fetches. <em>index scan needed ... 4500 dead item identifiers removed</em> — one pass over the index removed their entries. WAL and buffer usage tell you the I/O cost. Numbers will be similar but not identical.</p>`,
      output: `INFO:  vacuuming "postgres.public.vac_demo"
INFO:  table "vac_demo": truncated 64 to 47 pages
INFO:  finished vacuuming "postgres.public.vac_demo": index scans: 1
pages: 17 removed, 47 remain, 64 scanned (100.00% of total), 0 eagerly scanned
tuples: 4500 removed, 500 remain, 0 are dead but not yet removable
removable cutoff: 756, which was 1 XIDs old when operation ended
frozen: 0 pages from table (0.00% of total) had 0 tuples frozen
visibility map: 47 pages set all-visible, 0 pages set all-frozen (0 were all-visible)
index scan needed: 47 pages from table (73.44% of total) had 4500 dead item identifiers removed
index "vac_demo_customer_id_idx": pages: 8 in total, 0 newly deleted, 0 currently deleted, 0 reusable
avg read rate: 0.511 MB/s, avg write rate: 0.730 MB/s
buffer usage: 234 hits, 7 reads, 10 dirtied
WAL usage: 156 records, 6 full page images, 83073 bytes, 0 buffers full`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Visibility map, free space map and VACUUM FULL',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_visibility;
CREATE EXTENSION IF NOT EXISTS pg_freespacemap;
CREATE TABLE vac_demo AS SELECT * FROM orders;

SELECT 'after load' AS step, pg_size_pretty(pg_relation_size('vac_demo')) AS size,
       (SELECT relfilenode FROM pg_class WHERE relname = 'vac_demo') AS file, v.*
FROM pg_visibility_map_summary('vac_demo') v;

DELETE FROM vac_demo WHERE id % 10 <> 0;
VACUUM vac_demo;

SELECT 'after VACUUM' AS step, pg_size_pretty(pg_relation_size('vac_demo')) AS size,
       (SELECT relfilenode FROM pg_class WHERE relname = 'vac_demo') AS file, v.*
FROM pg_visibility_map_summary('vac_demo') v;
SELECT count(*) AS pages, pg_size_pretty(sum(avail)) AS reusable_free_space FROM pg_freespace('vac_demo');

VACUUM FULL vac_demo;
SELECT 'after VACUUM FULL' AS step, pg_size_pretty(pg_relation_size('vac_demo')) AS size,
       (SELECT relfilenode FROM pg_class WHERE relname = 'vac_demo') AS file;`,
      explain: `<p>After the load, no page is all-visible yet (nobody vacuumed). After DELETE + VACUUM: 47 pages remain (trailing empties truncated), all of them marked all-visible, and ~320 kB of free space recorded in the FSM for reuse — but the file is still 376 kB for 500 rows. VACUUM FULL wrote a brand-new file (new <code>relfilenode</code>) of 40 kB: compacted, but at the price of an ACCESS EXCLUSIVE lock for the whole rewrite.</p>`,
      output: ` step       | size   | file  | all_visible | all_frozen
------------+--------+-------+-------------+------------
 after load | 512 kB | 24588 |           0 |          0

 step         | size   | file  | all_visible | all_frozen
--------------+--------+-------+-------------+------------
 after VACUUM | 376 kB | 24588 |          47 |          0

 pages | reusable_free_space
-------+---------------------
    47 | 320 kB

 step              | size  | file
-------------------+-------+-------
 after VACUUM FULL | 40 kB | 24593`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Index-only scans depend on VACUUM setting the visibility map',
      sql: `CREATE TABLE ios AS SELECT * FROM orders;
CREATE INDEX ios_id_idx ON ios (id);
ANALYZE ios;
SET enable_seqscan = off;
SET enable_bitmapscan = off;

-- before VACUUM: index-only scan must still visit the heap for every row
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
SELECT id FROM ios WHERE id < 2000;

VACUUM ios;

-- after VACUUM: all pages all-visible, zero heap fetches
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
SELECT id FROM ios WHERE id < 2000;
RESET enable_seqscan;
RESET enable_bitmapscan;`,
      explain: `<p>An index-only scan can skip the heap only for pages whose all-visible bit is set; otherwise it must fetch the tuple to check visibility. Freshly loaded (or recently modified) tables have no VM bits, so the first plan shows <code>Heap Fetches: 1999</code>. After VACUUM sets the bits, the same query performs <code>Heap Fetches: 0</code>. This is why insert-only tables need vacuuming too (PG 13 added insert-triggered autovacuum).</p>`,
      output: ` Index Only Scan using ios_id_idx on ios (actual rows=1999.00 loops=1)
   Index Cond: (id < 2000)
   Heap Fetches: 1999
   Index Searches: 1

 Index Only Scan using ios_id_idx on ios (actual rows=1999.00 loops=1)
   Index Cond: (id < 2000)
   Heap Fetches: 0
   Index Searches: 1`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Reclaiming space with VACUUM FULL on a live table: blocks ALL reads and writes until done
CREATE TABLE big_live AS SELECT * FROM orders;
DELETE FROM big_live WHERE id % 2 = 0;
VACUUM FULL big_live;`,
      why: 'VACUUM FULL holds ACCESS EXCLUSIVE for the entire rewrite (minutes to hours on large tables) and needs free disk space equal to the new table plus indexes.',
      run: true
    },
    good: {
      sql: `-- Normal path: plain VACUUM makes space reusable without blocking.
-- If space must go back to the OS on a large live table, use pg_repack (third-party) instead.
CREATE TABLE big_live AS SELECT * FROM orders;
DELETE FROM big_live WHERE id % 2 = 0;
VACUUM (ANALYZE) big_live;
SELECT pg_size_pretty(pg_relation_size('big_live')) AS size_kept_for_reuse;`,
      why: 'Plain VACUUM runs alongside traffic; freed space is reused by future writes. pg_repack rebuilds online with only brief locks when shrinking is really required.',
      run: true
    }
  },
  mistakes: [
    'Expecting plain VACUUM (or autovacuum) to shrink the table file — it only truncates empty pages at the end.',
    'Running VACUUM FULL in production hours, causing an outage due to ACCESS EXCLUSIVE.',
    'Running out of disk during VACUUM FULL or pg_repack because a full copy of the table and indexes is needed.',
    'Vacuuming repeatedly while a long-running transaction or replication slot pins the xmin horizon ("dead but not yet removable" stays high).',
    'Forgetting that insert-only tables also need vacuum (visibility map for index-only scans, freezing).'
  ],
  best: [
    'Let autovacuum handle routine work; run manual <code>VACUUM (ANALYZE)</code> after bulk loads and big deletes.',
    'Use <code>VACUUM (VERBOSE)</code> to diagnose: check removed vs not-yet-removable tuples and index scan counts.',
    'Use pg_repack (third-party) or partition DETACH+DROP instead of VACUUM FULL for big live tables.',
    'Raise <code>maintenance_work_mem</code> (or <code>autovacuum_work_mem</code>) so large vacuums need fewer index passes.',
    'Use <code>VACUUM (PARALLEL n)</code> for manual vacuums of tables with many large indexes.'
  ],
  performance: `<p>VACUUM costs I/O (reading non-all-visible pages and every index) and WAL. It is throttled by cost-based delay (<code>vacuum_cost_delay</code>, <code>vacuum_cost_limit</code>) — manual VACUUM is unthrottled by default, autovacuum is throttled. Index vacuuming dominates on tables with many indexes. Benefits: smaller scans, working index-only scans, fresh statistics, no wraparound risk.</p>`,
  security: `<p>VACUUM requires table ownership or the <code>MAINTAIN</code> privilege (PG 17+, also via the predefined role <code>pg_maintain</code>). Grant <code>pg_maintain</code> to maintenance automation instead of superuser. VACUUM FULL rewrites files, which helps physically remove deleted data (relevant for data-erasure requirements) though old copies may persist in backups and WAL archives.</p>`,
  scenario: {
    title: 'We deleted 400 GB but the disk is still full',
    steps: [
      '1. Check: pg_relation_size(\'events\') unchanged after DELETE; n_dead_tup huge until autovacuum ran; afterwards still the same size.',
      '2. Explain: VACUUM made space reusable inside the file; only trailing empty pages are returned.',
      '3. Decide: will the table grow back into the space within weeks? If yes, do nothing.',
      '4. If not (table permanently smaller) and disk is tight: run pg_repack (third-party) online, verifying free disk ≥ live data + indexes.',
      '5. For future purges: partition by time and DETACH + DROP partitions instead of DELETE.',
      '6. Verify after: pg_total_relation_size dropped; VM fully set (pg_visibility_map_summary).'
    ]
  },
  widgets: ['diagram:mvcc', 'diagram:storage-page', 'lab:mvcc'],
  interview: [
    { q: 'What is the difference between VACUUM and VACUUM FULL?', a: 'Plain VACUUM removes dead tuples and index entries, marks space reusable, updates the visibility and free space maps and freezes tuples, all while the table stays available (SHARE UPDATE EXCLUSIVE). VACUUM FULL rewrites the whole table and indexes into new compact files, returning space to the OS, but holds ACCESS EXCLUSIVE for the duration and needs extra disk.' },
    { q: 'What is the visibility map used for?', a: 'It stores two bits per heap page: all-visible and all-frozen. VACUUM skips all-visible pages (and all-frozen pages during aggressive vacuums), and index-only scans skip heap fetches for all-visible pages.' },
    { q: 'Why can VACUUM report "dead but not yet removable" tuples?', a: 'Those dead versions are newer than the xmin horizon: some snapshot (a long transaction, a replication slot, a prepared transaction, hot standby feedback) might still need them. VACUUM cannot remove them until that horizon advances.' },
    { q: 'How do you shrink a large table without downtime?', a: 'Use pg_repack (third-party), which copies the table online while capturing changes with triggers and swaps the files under a brief exclusive lock. Alternatively rebuild into a new partition/table and swap, or for time-based data, use partitioning and drop old partitions.' }
  ],
  exercises: [
    {
      task: 'Create a copy of customers, delete all customers from the USA, run VACUUM (VERBOSE, ANALYZE) and look at the removed tuple count in the output.',
      solution: `CREATE TABLE cust_copy AS SELECT * FROM customers;
DELETE FROM cust_copy WHERE country = 'USA';
VACUUM (VERBOSE, ANALYZE) cust_copy;`,
      run: true
    },
    {
      task: 'Show the free space recorded per page for the first 5 pages of a vacuumed table with deletions.',
      solution: `CREATE EXTENSION IF NOT EXISTS pg_freespacemap;
CREATE TABLE fs AS SELECT * FROM order_items;
DELETE FROM fs WHERE id % 3 = 0;
VACUUM fs;
SELECT * FROM pg_freespace('fs') ORDER BY blkno LIMIT 5;`,
      run: true
    }
  ],
  challenge: {
    task: 'Compare three ways of removing half the rows from a copy of order_items and their effect on size: (a) DELETE + VACUUM, (b) DELETE + VACUUM FULL, (c) CREATE TABLE AS SELECT of the kept rows. Report size for each.',
    hint: 'Use three separate copies and pg_relation_size; (c) is what pg_repack and partition-swap approaches effectively do.',
    solution: `CREATE TABLE a AS SELECT * FROM order_items;
CREATE TABLE b AS SELECT * FROM order_items;
DELETE FROM a WHERE id % 2 = 0;  VACUUM a;
DELETE FROM b WHERE id % 2 = 0;  VACUUM FULL b;
CREATE TABLE c AS SELECT * FROM order_items WHERE id % 2 <> 0;
SELECT 'a: DELETE + VACUUM' AS method, pg_size_pretty(pg_relation_size('a')) AS size
UNION ALL SELECT 'b: DELETE + VACUUM FULL', pg_size_pretty(pg_relation_size('b'))
UNION ALL SELECT 'c: CTAS of kept rows', pg_size_pretty(pg_relation_size('c'));`,
    run: true
  },
  related: ['vacuum-autovacuum', 'vacuum-bloat', 'vacuum-wraparound', 'mvcc-consequences-hot'],
  quiz: [
    { type: 'tf', q: 'Plain VACUUM returns the space of deleted rows to the operating system.', answer: false, explain: 'It makes the space reusable within the table; only empty pages at the end of the file are truncated.' },
    { type: 'mcq', q: 'Which lock does VACUUM FULL take?', options: ['SHARE UPDATE EXCLUSIVE', 'ROW EXCLUSIVE', 'ACCESS EXCLUSIVE', 'No lock'], answer: 2, explain: 'It rewrites the table and blocks all access including SELECT.' },
    { type: 'predict', q: 'An index-only scan on a freshly loaded, never-vacuumed table returns 2,000 rows. What will "Heap Fetches" show?', code: `EXPLAIN ANALYZE SELECT id FROM t WHERE id < 2001;  -- index-only scan`, options: ['0', 'About 2000', 'NULL', 'An error'], answer: 1, explain: 'Without visibility-map bits every row needs a heap visit to check visibility.' },
    { type: 'scenario', q: 'VACUUM VERBOSE reports "0 removed, 2,000,000 are dead but not yet removable". What should you check first?', options: ['maintenance_work_mem', 'Long-running/idle-in-transaction sessions, replication slots and prepared transactions holding the xmin horizon', 'Index bloat', 'checkpoint_timeout'], answer: 1, explain: 'Something still needs those versions; find what holds the horizon.' }
  ]
},
{
  id: 'vacuum-autovacuum',
  module: 'vacuum',
  title: 'Autovacuum: Thresholds, Per-Table Tuning, Workers, Cost Limits and Monitoring',
  level: 4,
  minutes: 26,
  summary: 'When autovacuum triggers (dead-tuple, insert and analyze thresholds), how to tune it per table, how workers and cost-based throttling work, and how to monitor it with pg_stat_user_tables.',
  objectives: [
    'Compute the vacuum, insert-vacuum and analyze trigger points for a table',
    'Override autovacuum settings per table with storage parameters',
    'Explain autovacuum_max_workers, naptime and cost-based delay (cost limit shared across workers)',
    'Monitor n_dead_tup, last_autovacuum, n_ins_since_vacuum and pg_stat_progress_vacuum',
    'Recognise when autovacuum is falling behind and fix it'
  ],
  concept: `<p>The <strong>autovacuum launcher</strong> wakes every <code>autovacuum_naptime</code> (default 1 min) per database and starts <strong>worker</strong> processes (up to <code>autovacuum_max_workers</code>, default 3) for tables that cross a threshold:</p>
<ul>
<li><strong>Vacuum (dead tuples)</strong>: <code>n_dead_tup &gt; autovacuum_vacuum_threshold (50) + autovacuum_vacuum_scale_factor (0.2) × reltuples</code>. PG 18 adds <code>autovacuum_vacuum_max_threshold</code> (default 100,000,000) as a cap so huge tables are not left for billions of dead rows.</li>
<li><strong>Vacuum (inserts)</strong> (PG 13+): <code>n_ins_since_vacuum &gt; autovacuum_vacuum_insert_threshold (1000) + autovacuum_vacuum_insert_scale_factor (0.2) × reltuples</code> — keeps the visibility map current and freezes insert-only tables.</li>
<li><strong>Analyze</strong>: <code>n_mod_since_analyze &gt; autovacuum_analyze_threshold (50) + autovacuum_analyze_scale_factor (0.1) × reltuples</code>.</li>
<li><strong>Anti-wraparound</strong>: forced when <code>age(relfrozenxid) &gt; autovacuum_freeze_max_age</code> — even if autovacuum is disabled.</li>
</ul>
<p>With the default 20% scale factor, a 1-billion-row table is vacuumed only after 200 million dead tuples — far too late. That is why large, busy tables need <strong>per-table settings</strong> (<code>ALTER TABLE ... SET (autovacuum_vacuum_scale_factor = 0.01)</code> or a fixed threshold).</p>
<p><strong>Cost-based throttling</strong>: each page hit/miss/dirty costs points (<code>vacuum_cost_page_hit</code> 1, <code>_miss</code> 2, <code>_dirty</code> 20); after accumulating <code>autovacuum_vacuum_cost_limit</code> (-1 → <code>vacuum_cost_limit</code> = 200) points, a worker sleeps <code>autovacuum_vacuum_cost_delay</code> (2 ms). The limit is <em>shared</em> among all running workers, so adding workers does not add throughput unless you raise the limit too.</p>
<p>Analogy: city garbage trucks. The threshold decides when a street gets a pickup (20% full bins is too late for a busy market street); the number of trucks is max_workers; cost limit and delay are the speed limit — and all trucks share one fuel budget.</p>`,
  why: `<p>Default autovacuum settings are conservative, designed for small databases on weak hardware. On modern servers with large tables, untuned autovacuum falls behind: bloat grows, index-only scans degrade, statistics go stale, and anti-wraparound vacuums arrive as emergencies. Tuning it is one of the highest-leverage tasks of a database engineer.</p>`,
  useCase: `<p>A 900M-row <code>payments</code> table (reltuples 9e8) received 3M updates/day. Default threshold: 50 + 0.2 × 9e8 = 180M dead tuples → autovacuum every ~60 days, each run taking 14 hours with the default cost limit, and the table bloated 35%. Changes: <code>ALTER TABLE payments SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 2000000, autovacuum_vacuum_cost_limit = 2000)</code> and globally <code>autovacuum_vacuum_cost_delay = 2ms</code>, <code>autovacuum_max_workers = 6</code>, <code>maintenance_work_mem = 1GB</code>. Autovacuum now runs daily in ~40 minutes; bloat stays under 10%.</p>`,
  internals: `<ul>
<li>The launcher spreads work across databases; a worker processes one table at a time, picking tables needing anti-wraparound vacuum first. PG 18 decoupled worker slots (<code>autovacuum_worker_slots</code>, restart) from <code>autovacuum_max_workers</code>, which can now be changed with a reload.</li>
<li>Autovacuum takes SHARE UPDATE EXCLUSIVE and <strong>yields</strong>: a normal autovacuum cancels itself if another session requests a conflicting lock (e.g. ALTER TABLE). An anti-wraparound autovacuum does not yield.</li>
<li>Statistics driving the thresholds come from the cumulative statistics system (<code>pg_stat_user_tables</code>), held in shared memory since PG 15 and written to disk at shutdown; after a crash they are reset, which can delay autovacuum.</li>
<li>Per-table settings are stored in <code>pg_class.reloptions</code> (and <code>toast.*</code> variants for the TOAST table).</li>
<li><code>vacuum_failsafe_age</code> (default 1.6 billion): when a table's XID age exceeds it, VACUUM stops throttling and skips index cleanup to finish freezing as fast as possible.</li>
</ul>`,
  whenNot: `<p>Never disable autovacuum globally. Disabling it per table (<code>autovacuum_enabled = false</code>) is acceptable only for tables you vacuum explicitly on a schedule, such as staging tables that are truncated after each load. Do not "fix" slow autovacuum by running manual VACUUM FULL.</p>`,
  syntax: `-- global (postgresql.conf / ALTER SYSTEM)
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 1min
autovacuum_vacuum_threshold = 50
autovacuum_vacuum_scale_factor = 0.2
autovacuum_vacuum_insert_threshold = 1000
autovacuum_vacuum_insert_scale_factor = 0.2
autovacuum_analyze_scale_factor = 0.1
autovacuum_vacuum_cost_limit = -1      -- uses vacuum_cost_limit (200)
autovacuum_vacuum_cost_delay = 2ms

-- per table
ALTER TABLE t SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_threshold = 10000);
ALTER TABLE t RESET (autovacuum_vacuum_scale_factor);`,
  examples: [
    {
      label: 'Basic',
      title: 'Monitor dead tuples and compute when autovacuum will trigger',
      sql: `SELECT s.relname,
       c.reltuples::bigint                                   AS est_rows,
       s.n_live_tup, s.n_dead_tup, s.n_ins_since_vacuum, s.n_mod_since_analyze,
       current_setting('autovacuum_vacuum_threshold')::int
         + current_setting('autovacuum_vacuum_scale_factor')::float8 * c.reltuples  AS vacuum_trigger_at,
       current_setting('autovacuum_vacuum_insert_threshold')::int
         + current_setting('autovacuum_vacuum_insert_scale_factor')::float8 * c.reltuples AS insert_trigger_at,
       s.last_autovacuum, s.last_vacuum, s.autovacuum_count
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
WHERE s.relname IN ('orders', 'order_items', 'payments', 'customers')
ORDER BY c.reltuples DESC;`,
      explain: `<p>This is the core autovacuum dashboard query (simplified: it ignores per-table reloptions, the PG 18 max-threshold cap, and -1 reltuples for never-analyzed tables). Compare <code>n_dead_tup</code> with <code>vacuum_trigger_at</code> and <code>n_ins_since_vacuum</code> with <code>insert_trigger_at</code>. With defaults, <code>order_items</code> (12,500 rows) needs 2,550 dead tuples to be vacuumed. In this playground the cumulative statistics start empty, so counters are zero; on a real server, sort by <code>n_dead_tup</code> descending to find tables autovacuum is not keeping up with.</p>`,
      output: ` relname     | est_rows | n_live_tup | n_dead_tup | ... | vacuum_trigger_at | insert_trigger_at | last_autovacuum
-------------+----------+------------+------------+-----+-------------------+-------------------+-----------------
 order_items |    12500 |          0 |          0 |     |              2550 |              3500 |
 orders      |     5000 |            |            |     |              1050 |              2000 |
 payments    |     4585 |            |            |     |               967 |              1917 |
 customers   |      500 |            |            |     |               150 |              1100 |`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Per-table autovacuum settings for a hot table',
      sql: `CREATE TABLE hot_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payload jsonb, status text)
WITH (
  autovacuum_vacuum_scale_factor        = 0,       -- ignore table size ...
  autovacuum_vacuum_threshold           = 10000,   -- ... vacuum every 10k dead tuples
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold    = 50000,
  autovacuum_analyze_scale_factor       = 0.02,
  autovacuum_vacuum_cost_limit          = 2000,    -- let workers on this table go faster
  fillfactor                            = 85
);

SELECT relname, unnest(reloptions) AS option
FROM pg_class WHERE relname = 'hot_events';

ALTER TABLE hot_events RESET (autovacuum_vacuum_insert_threshold);   -- back to the global default
ALTER TABLE hot_events SET (toast.autovacuum_vacuum_scale_factor = 0.05);  -- TOAST table too

SELECT c.relname, c.reloptions
FROM pg_class c
WHERE c.oid IN ('hot_events'::regclass, (SELECT reltoastrelid FROM pg_class WHERE relname = 'hot_events'));`,
      explain: `<p>Storage parameters override the global GUCs for one table. A scale factor of 0 plus a fixed threshold makes autovacuum frequency independent of table size — the usual recipe for large, steadily updated tables. The per-table cost limit lets this table's vacuum run faster than the shared default. TOAST tables have their own counters and settings (<code>toast.</code> prefix). <code>RESET</code> removes an override.</p>`,
      output: ` relname    | option
------------+-----------------------------------------
 hot_events | autovacuum_vacuum_scale_factor=0
 hot_events | autovacuum_vacuum_threshold=10000
 hot_events | autovacuum_vacuum_insert_scale_factor=0
 hot_events | autovacuum_vacuum_insert_threshold=50000
 hot_events | autovacuum_analyze_scale_factor=0.02
 hot_events | autovacuum_vacuum_cost_limit=2000
 hot_events | fillfactor=85

 relname              | reloptions
----------------------+------------------------------------------------------
 hot_events           | {autovacuum_vacuum_scale_factor=0,...,fillfactor=85}
 pg_toast_NNNNN       | {autovacuum_vacuum_scale_factor=0.05}`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Global settings, running vacuums and worker capacity',
      sql: `-- global autovacuum configuration
SELECT name, setting, unit, context
FROM pg_settings
WHERE name IN ('autovacuum', 'autovacuum_max_workers', 'autovacuum_naptime',
               'autovacuum_vacuum_cost_limit', 'autovacuum_vacuum_cost_delay', 'vacuum_cost_limit',
               'autovacuum_vacuum_max_threshold', 'autovacuum_work_mem', 'maintenance_work_mem',
               'vacuum_failsafe_age')
ORDER BY name;

-- vacuums in progress right now (manual and auto)
SELECT p.pid, p.relid::regclass AS table_name, p.phase,
       p.heap_blks_scanned, p.heap_blks_total,
       round(100.0 * p.heap_blks_scanned / nullif(p.heap_blks_total, 0), 1) AS pct_scanned,
       p.index_vacuum_count, a.query
FROM pg_stat_progress_vacuum p
JOIN pg_stat_activity a USING (pid);`,
      explain: `<p><code>context</code> tells you how to change each setting: <code>sighup</code> = reload (e.g. cost limits, naptime, and in PG 18 max_workers), <code>postmaster</code> = restart. With <code>autovacuum_vacuum_cost_limit = -1</code>, workers share <code>vacuum_cost_limit = 200</code> — very low for SSDs; production systems commonly use 1000–4000. <code>pg_stat_progress_vacuum</code> shows each running vacuum's phase (scanning heap, vacuuming indexes, vacuuming heap, truncating) and progress; <code>index_vacuum_count &gt; 1</code> means memory was too small to hold all dead TIDs in one pass. Empty in the playground because no vacuum is running.</p>`,
      output: ` name                            | setting    | unit | context
---------------------------------+------------+------+------------
 autovacuum                      | on         |      | sighup
 autovacuum_max_workers          | 3          |      | sighup
 autovacuum_naptime              | 60         | s    | sighup
 autovacuum_vacuum_cost_delay    | 2          | ms   | sighup
 autovacuum_vacuum_cost_limit    | -1         |      | sighup
 autovacuum_vacuum_max_threshold | 100000000  |      | sighup
 autovacuum_work_mem             | -1         | kB   | sighup
 maintenance_work_mem            | 65536      | kB   | user
 vacuum_cost_limit               | 200        |      | user
 vacuum_failsafe_age             | 1600000000 |      | user

 pid | table_name | phase | heap_blks_scanned | heap_blks_total | pct_scanned | index_vacuum_count | query
-----+------------+-------+-------------------+-----------------+-------------+--------------------+-------
(0 rows)`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- "Autovacuum is slow, let's turn it off for the big table and run VACUUM at night"
CREATE TABLE big_t (id int, v int) WITH (autovacuum_enabled = false);
SELECT reloptions FROM pg_class WHERE relname = 'big_t';`,
      why: 'Without autovacuum, dead tuples accumulate all day, statistics go stale, and if the nightly job fails nothing protects the table except the forced anti-wraparound vacuum, which arrives as an emergency.',
      run: true
    },
    good: {
      sql: `-- Make autovacuum run more often and faster on that table instead
CREATE TABLE big_t (id int, v int) WITH (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit   = 2000,
  autovacuum_analyze_scale_factor = 0.02);
SELECT reloptions FROM pg_class WHERE relname = 'big_t';`,
      why: 'Smaller, more frequent vacuums are cheaper per run, keep bloat low and statistics fresh; a higher cost limit lets each run finish quickly.',
      run: true
    }
  },
  mistakes: [
    'Keeping the default 20% scale factor on tables with hundreds of millions of rows.',
    'Increasing <code>autovacuum_max_workers</code> without raising the cost limit — the shared cost budget is just split among more workers, each running slower.',
    'Disabling autovacuum globally or on busy tables.',
    'Ignoring TOAST tables, which have separate thresholds and can bloat independently.',
    'Running DDL loops that keep cancelling autovacuum (it yields to conflicting lock requests) so it never finishes.'
  ],
  best: [
    'For big tables: <code>autovacuum_vacuum_scale_factor</code> 0.01–0.05 or 0 with a fixed threshold.',
    'Raise <code>autovacuum_vacuum_cost_limit</code> (e.g. 1000–4000 on SSD) and keep <code>cost_delay</code> at 2 ms.',
    'Give autovacuum memory: <code>autovacuum_work_mem</code> of 256 MB–1 GB on large systems.',
    'Alert on high <code>n_dead_tup</code>, old <code>last_autovacuum</code>, and <code>index_vacuum_count &gt; 1</code> in progress views; log slow autovacuums with <code>log_autovacuum_min_duration = 10s</code>.',
    'Eliminate long transactions — no amount of tuning helps if the xmin horizon is pinned.'
  ],
  performance: `<p>Autovacuum I/O competes with the workload; throttling keeps it gentle but too much throttling lets bloat win. Modern SSD-backed systems usually benefit from higher cost limits and more frequent, smaller runs. Watch I/O utilisation and vacuum durations together. Freezing and index cleanup are the biggest costs on very large tables; partitioning lets autovacuum work per partition, skipping cold, frozen partitions almost entirely.</p>`,
  security: `<p>Autovacuum runs as the bootstrap superuser internally; per-table settings require table ownership (or MAINTAIN in PG 17+ for VACUUM/ANALYZE themselves). Misconfigured autovacuum is an availability risk (wraparound shutdown), so include its health in production readiness reviews.</p>`,
  scenario: {
    title: 'Autovacuum never catches up on the payments table',
    steps: [
      '1. Symptoms: payments 35% bloated; last_autovacuum 9 days ago; log_autovacuum_min_duration shows runs taking 14 h.',
      '2. Compute the trigger: 50 + 0.2 × 900M = 180M dead tuples — vacuums are rare and enormous.',
      '3. Per-table: autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 2,000,000, autovacuum_vacuum_cost_limit = 2000.',
      '4. Global: autovacuum_work_mem = 1GB (fewer index passes), autovacuum_max_workers = 6 with a higher overall cost limit.',
      '5. Check for horizon blockers (long transactions, slots) so the vacuums can actually remove tuples.',
      '6. Result: daily 40-minute vacuums; bloat stabilises under 10%; schedule pg_repack once to remove existing bloat.'
    ]
  },
  widgets: ['diagram:mvcc', 'diagram:process-model'],
  interview: [
    { q: 'When does autovacuum vacuum a table?', a: 'When n_dead_tup exceeds autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor × reltuples (capped by autovacuum_vacuum_max_threshold in PG 18), when inserts since last vacuum exceed the insert threshold formula (PG 13+), or when the table\'s relfrozenxid age exceeds autovacuum_freeze_max_age (anti-wraparound, even if autovacuum is off). Analyze has its own threshold on n_mod_since_analyze.' },
    { q: 'Why might more autovacuum workers not make vacuuming faster?', a: 'The cost limit (autovacuum_vacuum_cost_limit, or vacuum_cost_limit if -1) is shared among all active workers; each worker gets a fraction. More workers then just each sleep more. You must raise the cost limit (or lower the delay) to increase total throughput.' },
    { q: 'How do you tune autovacuum for a 1-billion-row table?', a: 'Set a low or zero scale factor with a fixed threshold per table (e.g. vacuum every few million dead tuples), increase the per-table or global cost limit, give autovacuum enough work_mem, consider partitioning, and make sure no long-running transactions or stale replication slots block cleanup.' },
    { q: 'What is the insert threshold for?', a: 'Insert-only tables never accumulate dead tuples, so before PG 13 they were vacuumed only for wraparound, leaving the visibility map unset (no efficient index-only scans) and causing huge freeze vacuums later. The insert threshold triggers regular vacuums based on inserted rows.' }
  ],
  exercises: [
    {
      task: 'Write a query that lists user tables with more than 1,000 dead tuples or a dead/live ratio above 10%, ordered by dead tuples.',
      solution: `SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_autovacuum, last_vacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000 OR n_dead_tup > 0.1 * nullif(n_live_tup, 0)
ORDER BY n_dead_tup DESC;`,
      run: true
    },
    {
      task: 'Set autovacuum to trigger after 500 dead tuples (regardless of size) for a copy of order_items, then show its reloptions.',
      solution: `CREATE TABLE oi AS SELECT * FROM order_items;
ALTER TABLE oi SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 500);
SELECT relname, reloptions FROM pg_class WHERE relname = 'oi';`,
      run: true
    }
  ],
  challenge: {
    task: 'Write a precise "next autovacuum" query that honours per-table reloptions: for each user table compute the effective vacuum threshold using the table\'s autovacuum_vacuum_threshold / scale_factor reloptions when present, otherwise the global settings. Test it with one table that has overrides.',
    hint: 'Parse reloptions with a lateral unnest and split_part(opt, \'=\', 1/2), then coalesce(per_table, global).',
    solution: `CREATE TABLE tuned (id int) WITH (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 500);
INSERT INTO tuned SELECT generate_series(1, 10000);
ANALYZE tuned;
SELECT c.relname,
       c.reltuples::bigint AS est_rows,
       coalesce(o.thr, current_setting('autovacuum_vacuum_threshold')::float8)
       + coalesce(o.sf, current_setting('autovacuum_vacuum_scale_factor')::float8) * greatest(c.reltuples, 0)
         AS effective_vacuum_threshold,
       s.n_dead_tup
FROM pg_class c
JOIN pg_stat_user_tables s ON s.relid = c.oid
LEFT JOIN LATERAL (
  SELECT max(CASE WHEN split_part(opt, '=', 1) = 'autovacuum_vacuum_threshold'    THEN split_part(opt, '=', 2)::float8 END) AS thr,
         max(CASE WHEN split_part(opt, '=', 1) = 'autovacuum_vacuum_scale_factor' THEN split_part(opt, '=', 2)::float8 END) AS sf
  FROM unnest(c.reloptions) AS opt
) o ON true
WHERE c.relname IN ('tuned', 'orders', 'order_items')
ORDER BY 1;`,
    run: true
  },
  related: ['vacuum-basics', 'vacuum-bloat', 'vacuum-wraparound', 'monitoring'],
  quiz: [
    { type: 'mcq', q: 'With defaults (threshold 50, scale factor 0.2), how many dead tuples trigger autovacuum on a 10,000,000-row table?', options: ['50', '1,000,050', '2,000,050', '10,000,050'], answer: 2, explain: '50 + 0.2 × 10,000,000 = 2,000,050.' },
    { type: 'tf', q: 'Raising autovacuum_max_workers from 3 to 10 triples vacuum throughput even if cost limits stay unchanged.', answer: false, explain: 'The cost limit is shared among active workers; without raising it each worker simply gets a smaller share.' },
    { type: 'mcq', q: 'Which statistic tells you inserts since the last vacuum (used by the insert threshold)?', options: ['n_tup_ins', 'n_ins_since_vacuum', 'n_live_tup', 'n_mod_since_analyze'], answer: 1, explain: 'n_ins_since_vacuum in pg_stat_user_tables (PG 13+).' },
    { type: 'design', q: 'A 2-billion-row append-mostly table with occasional updates. Best per-table setting?', options: ['autovacuum_enabled = false', 'autovacuum_vacuum_scale_factor = 0 with a fixed threshold, and an insert threshold so the VM stays current', 'scale factor 0.5', 'Only VACUUM FULL monthly'], answer: 1, explain: 'Fixed thresholds keep vacuums frequent and small; insert-triggered vacuums keep the visibility map and freezing current.' }
  ]
},
{
  id: 'vacuum-bloat',
  module: 'vacuum',
  title: 'Table and Index Bloat: Causes, Estimation and Fixes',
  level: 4,
  minutes: 24,
  summary: 'What bloat is, the usual culprits (long transactions, abandoned replication slots, prepared transactions, untuned autovacuum), how to estimate it, and how to fix it (REINDEX CONCURRENTLY, pg_repack, VACUUM FULL).',
  objectives: [
    'Define table and index bloat and how it differs from "dead tuples"',
    'Identify xmin horizon blockers: long transactions, idle in transaction, replication slots, prepared transactions, hot_standby_feedback',
    'Estimate table bloat from catalog statistics and measure index bloat by rebuilding',
    'Fix bloat with REINDEX CONCURRENTLY, pg_repack (third-party) or VACUUM FULL, choosing by lock impact',
    'Prevent bloat recurrence'
  ],
  concept: `<p><strong>Bloat</strong> is space inside table or index files that holds no live data: dead tuples not yet vacuumed plus free space left after vacuuming that is not being reused. A table with 10 GB of live rows in a 40 GB file is 75% bloated. Bloat hurts because sequential scans, backups, replication catch-up and cache usage all scale with the <em>file</em> size, not the live data size.</p>
<p>Main causes:</p>
<ul>
<li><strong>Autovacuum too slow / too infrequent</strong> for the update rate (default 20% scale factor on large tables).</li>
<li><strong>Something holding back the xmin horizon</strong>, so VACUUM cannot remove dead tuples anywhere: long-running transactions, sessions <em>idle in transaction</em>, <strong>abandoned replication slots</strong> (their <code>xmin</code>/<code>catalog_xmin</code>), forgotten prepared transactions, and standbys with <code>hot_standby_feedback = on</code> running long queries.</li>
<li><strong>Mass UPDATE/DELETE</strong> in one go (space freed but never reused if the table does not grow back).</li>
<li><strong>Index bloat</strong>: B-tree pages split and rarely merge; random-key updates/deletes leave half-empty pages. VACUUM removes dead entries but cannot compact pages (it can only recycle totally empty ones).</li>
</ul>
<p>Analogy: a parking garage where cars (rows) leave but spots stay "reserved" because a security guard (old snapshot) insists someone might still come back for them. Until the guard leaves, new cars must park on new floors you keep building.</p>`,
  why: `<p>Bloat silently multiplies I/O, memory pressure and backup sizes. In incidents, a single forgotten replication slot or idle-in-transaction session has bloated entire clusters by terabytes. Engineers must be able to detect it early, find the root cause and fix it without downtime.</p>`,
  useCase: `<p>An analytics team created a logical replication slot for a CDC proof of concept, then shut down the consumer. Three weeks later the primary\'s disk alarmed: <code>pg_wal</code> had grown to 800 GB (retained WAL) and every busy table was bloated because the slot\'s <code>catalog_xmin</code> also held back catalog cleanup and its retained WAL kept growing. Dropping the slot (<code>pg_drop_replication_slot</code>) released WAL immediately; vacuum then recovered dead space; heavily bloated tables were rebuilt online with pg_repack. Preventive fix: <code>max_slot_wal_keep_size = 200GB</code> and an alert on inactive slots.</p>`,
  internals: `<ul>
<li>The xmin horizon is computed from all backends' <code>backend_xmin</code>/<code>backend_xid</code> (pg_stat_activity), replication slots' <code>xmin</code> and <code>catalog_xmin</code> (pg_replication_slots), prepared transactions, and standby feedback. VACUUM uses the oldest.</li>
<li>Table bloat estimation without extensions compares <code>relpages</code> with an expected page count derived from <code>reltuples</code> and average row width (<code>pg_stats.avg_width</code>) plus per-tuple overhead (23-byte header aligned to 24, 4-byte line pointer) and page header — always an approximation (alignment, fillfactor, TOAST). The <code>pgstattuple</code> <span class="tag ext">extension</span> gives exact numbers by scanning the table (<code>pgstattuple()</code>, <code>pgstatindex()</code>, cheaper <code>pgstattuple_approx()</code>).</li>
<li><code>REINDEX CONCURRENTLY</code> (PG 12+) builds a new index alongside the old one and swaps, holding only SHARE UPDATE EXCLUSIVE for most of the time.</li>
<li>B-tree deduplication (PG 13+) and bottom-up deletion (PG 14+) significantly reduce index bloat from non-HOT updates of duplicates.</li>
</ul>`,
  whenNot: `<p>Do not chase small bloat (10–20% is normal steady state; rows need room for updates). Do not rebuild tables that will grow back into their free space within weeks. Do not run VACUUM FULL on large hot tables in production when pg_repack or partition swaps are available.</p>`,
  syntax: `-- horizon blockers
SELECT pid, state, backend_xmin, age(backend_xmin), xact_start FROM pg_stat_activity WHERE backend_xmin IS NOT NULL;
SELECT slot_name, active, xmin, catalog_xmin, restart_lsn FROM pg_replication_slots;
SELECT gid, prepared FROM pg_prepared_xacts;

-- fixes
REINDEX INDEX CONCURRENTLY idx_name;
REINDEX TABLE CONCURRENTLY t;
VACUUM FULL t;                    -- blocking
-- pg_repack (third-party CLI): pg_repack --table=public.t dbname
SELECT pg_drop_replication_slot('slot_name');`,
  examples: [
    {
      label: 'Basic',
      title: 'Create bloat with repeated updates and estimate it from the catalog',
      sql: `CREATE TABLE bloat_demo AS SELECT * FROM orders;
UPDATE bloat_demo SET total_amount = total_amount + 1;    -- 3 full-table updates:
UPDATE bloat_demo SET total_amount = total_amount + 1;    -- 3 dead versions per row
UPDATE bloat_demo SET total_amount = total_amount + 1;
VACUUM bloat_demo;                                       -- dead space now reusable, file not shrunk
ANALYZE bloat_demo;

WITH t AS (
  SELECT c.oid, c.relname, c.relpages, c.reltuples,
         (SELECT sum(s.avg_width) FROM pg_stats s
          WHERE s.schemaname = 'public' AND s.tablename = c.relname) AS data_width
  FROM pg_class c WHERE c.relname = 'bloat_demo'
)
SELECT relname,
       relpages                                                         AS actual_pages,
       ceil(reltuples * (ceil((data_width + 24) / 8.0) * 8 + 4) / (8192 - 24))::int AS expected_pages,
       round(100 * (1 - ceil(reltuples * (ceil((data_width + 24) / 8.0) * 8 + 4) / (8192 - 24))
                        / nullif(relpages, 0))::numeric, 1)           AS est_bloat_pct,
       pg_size_pretty(pg_relation_size(oid))                            AS size
FROM t;`,
      explain: `<p>Three full-table updates left the heap ~4× larger than its live data. The estimate computes how many pages the live rows would need: per-row data width from <code>pg_stats</code>, plus a 24-byte (aligned) tuple header rounded up to 8-byte alignment, plus a 4-byte line pointer, divided by usable page space. It still slightly underestimates real needs (per-column alignment), so treat the percentage as a ballpark: after a full rewrite this table needs 47 pages. Estimation queries like this (or the community "bloat estimation" queries) are cheap enough to run across all tables; confirm big offenders with <code>pgstattuple</code> where available.</p>`,
      output: ` relname    | actual_pages | expected_pages | est_bloat_pct | size
------------+--------------+----------------+---------------+---------
 bloat_demo |          202 |             42 |          79.2 | 1616 kB`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Index bloat: measure by rebuilding with REINDEX CONCURRENTLY',
      sql: `CREATE TABLE ib AS SELECT * FROM orders;
CREATE INDEX ib_customer_idx ON ib (customer_id);
UPDATE ib SET total_amount = total_amount + 1;   -- non-HOT updates (pages full) -> new index entries
UPDATE ib SET total_amount = total_amount + 1;
UPDATE ib SET total_amount = total_amount + 1;
VACUUM ib;

SELECT pg_size_pretty(pg_relation_size('ib_customer_idx')) AS index_before;
REINDEX INDEX CONCURRENTLY ib_customer_idx;
SELECT pg_size_pretty(pg_relation_size('ib_customer_idx')) AS index_after;`,
      explain: `<p>Each non-HOT update inserted a new entry into <code>ib_customer_idx</code>; VACUUM removed the dead entries but left half-empty pages behind, so the index stayed 3× its compact size. <code>REINDEX CONCURRENTLY</code> builds a fresh, densely packed index next to the old one and swaps them while allowing reads and writes; it must run outside a transaction block and needs disk for both copies during the build. If it fails, it can leave an <code>_ccnew</code> INVALID index that you must drop.</p>`,
      output: ` index_before
--------------
 192 kB

 index_after
-------------
 64 kB`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Find what is holding back the xmin horizon',
      sql: `-- 1) sessions with old snapshots / transactions
SELECT pid, usename, state, backend_xmin, age(backend_xmin) AS xmin_age,
       now() - xact_start AS xact_age, left(query, 50) AS query
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL
ORDER BY age(backend_xmin) DESC NULLS LAST;

-- 2) replication slots (physical and logical)
SELECT slot_name, slot_type, active, xmin, catalog_xmin,
       age(xmin) AS xmin_age, age(catalog_xmin) AS catalog_xmin_age,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS wal_retained
FROM pg_replication_slots;

-- 3) prepared transactions
SELECT gid, prepared, age(transaction) AS xid_age FROM pg_prepared_xacts;

-- 4) the resulting oldest horizon vs. current XID
SELECT pg_snapshot_xmin(pg_current_snapshot()) AS oldest_running_xid,
       pg_current_xact_id()                    AS current_xid;`,
      explain: `<p>These four queries cover every source of a pinned horizon on a primary (standby feedback appears as the walsender\'s <code>backend_xmin</code> in query 1). In the playground only our own session appears, with <code>xmin_age</code> 0. In production, look for: <code>idle in transaction</code> sessions with large <code>xact_age</code>; inactive slots with growing <code>wal_retained</code>; any row in <code>pg_prepared_xacts</code>. Fix the blocker first — vacuuming before that removes nothing.</p>`,
      output: ` pid | usename | state  | backend_xmin | xmin_age | xact_age | query
-----+---------+--------+--------------+----------+----------+-------------------------------
  42 |         | active |          753 |        0 | 00:00:00 | -- 1) sessions with old snaps...

 slot_name | slot_type | active | xmin | catalog_xmin | xmin_age | catalog_xmin_age | wal_retained
-----------+-----------+--------+------+--------------+----------+------------------+--------------
(0 rows)

 gid | prepared | xid_age
-----+----------+---------
(0 rows)

 oldest_running_xid | current_xid
--------------------+-------------
                753 |         753`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Rebuilding a bloated index the blocking way
CREATE TABLE ib AS SELECT * FROM orders;
CREATE INDEX ib_customer_idx ON ib (customer_id);
REINDEX INDEX ib_customer_idx;      -- blocks writes (and reads that would use this index) for the whole rebuild`,
      why: 'Plain REINDEX takes a SHARE lock on the table (blocking writes) and ACCESS EXCLUSIVE on the index, so queries needing the index also block.',
      run: true
    },
    good: {
      sql: `CREATE TABLE ib AS SELECT * FROM orders;
CREATE INDEX ib_customer_idx ON ib (customer_id);
REINDEX INDEX CONCURRENTLY ib_customer_idx;   -- online rebuild (PG 12+)`,
      why: 'REINDEX CONCURRENTLY keeps the table readable and writable; it takes longer and needs extra space, and must run outside a transaction block.',
      run: true
    }
  },
  mistakes: [
    'Running VACUUM repeatedly while an inactive replication slot or idle-in-transaction session pins the horizon.',
    'Leaving test logical replication slots behind (they also retain WAL until the disk fills).',
    'Using plain REINDEX or VACUUM FULL on hot production tables instead of REINDEX CONCURRENTLY / pg_repack.',
    'Treating estimated bloat percentages as exact; confirm before expensive rebuilds.',
    'Fixing bloat without fixing its cause (autovacuum settings, application transaction handling) — it comes back.'
  ],
  best: [
    'Set <code>idle_in_transaction_session_timeout</code> and alert on transactions older than a few minutes.',
    'Set <code>max_slot_wal_keep_size</code> and alert on inactive replication slots.',
    'Track table/index sizes over time and compare with row counts; investigate unexpected growth.',
    'Use REINDEX CONCURRENTLY for indexes and pg_repack (third-party) for tables; schedule during lower load.',
    'Prefer partitioning for data with retention so deletes never create bloat.'
  ],
  performance: `<p>Bloat increases I/O for scans, reduces cache hit ratios, slows backups/replica builds and wastes disk. Index bloat raises tree depth and the number of pages per lookup. Rebuild operations themselves cost I/O and WAL (a full rewrite writes the whole table/index to WAL with <code>wal_level = replica</code>), which can make replicas lag — throttle and schedule them.</p>`,
  security: `<p>Terminating sessions and dropping replication slots requires appropriate privileges (<code>pg_signal_backend</code>, replication privileges or superuser). Dropping a slot used by a real consumer (CDC, a standby) breaks that consumer — verify ownership before dropping.</p>`,
  scenario: {
    title: 'Disk filling up: 800 GB of WAL and growing bloat',
    steps: [
      '1. Alert: disk 92% on the primary; du shows pg_wal at 800 GB; several tables doubled in size in 3 weeks.',
      '2. Query pg_replication_slots: logical slot cdc_poc, active = false, wal_retained 790 GB, catalog_xmin age 180M.',
      '3. Confirm with the owning team that the consumer is gone; SELECT pg_drop_replication_slot(\'cdc_poc\').',
      '4. WAL is recycled at the next checkpoints; autovacuum now removes dead tuples (check VERBOSE: removable counts high).',
      '5. Rebuild the worst tables with pg_repack and indexes with REINDEX CONCURRENTLY during off-peak hours.',
      '6. Prevent: max_slot_wal_keep_size = 200GB, alert on inactive slots and on pg_wal size, slot creation reserved to DBAs.'
    ]
  },
  widgets: ['diagram:mvcc', 'diagram:logical-replication'],
  interview: [
    { q: 'What can prevent VACUUM from removing dead tuples?', a: 'Anything holding back the xmin horizon: long-running or idle-in-transaction sessions, replication slots (xmin or catalog_xmin), orphaned prepared transactions, and standbys with hot_standby_feedback running long queries. Also, autovacuum being cancelled repeatedly by conflicting locks.' },
    { q: 'How do you fix index bloat without downtime?', a: 'REINDEX INDEX CONCURRENTLY (PG 12+), or create a new index CONCURRENTLY and drop the old one CONCURRENTLY. Both keep the table available; they need extra disk temporarily and must run outside a transaction block.' },
    { q: 'How would you estimate table bloat without extensions?', a: 'Compare pg_class.relpages with an expected page count computed from reltuples and average row width from pg_stats plus tuple header, alignment and line pointer overhead, divided by usable page space (and fillfactor). It is an approximation; pgstattuple gives exact figures at the cost of a full scan.' },
    { q: 'Why can an abandoned logical replication slot fill the disk?', a: 'A slot guarantees its consumer can resume from restart_lsn, so the server retains all WAL after it; logical slots also hold catalog_xmin, blocking catalog cleanup. With no consumer, retained WAL grows until the disk fills. max_slot_wal_keep_size limits WAL retention by invalidating the slot.' }
  ],
  exercises: [
    {
      task: 'List tables and their total size, table size and index size, ordered by total size.',
      solution: `SELECT relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total,
       pg_size_pretty(pg_relation_size(relid))       AS table_only,
       pg_size_pretty(pg_indexes_size(relid))        AS indexes
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;`,
      run: true
    },
    {
      task: 'Show any replication slots and how much WAL each one retains (empty here).',
      solution: `SELECT slot_name, slot_type, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS wal_retained
FROM pg_replication_slots;`,
      run: true
    }
  ],
  challenge: {
    task: 'Run the bloat estimate for every user table in the database (not just one) and rank them by estimated wasted bytes. Run ANALYZE first.',
    hint: 'Aggregate pg_stats.avg_width per table, join to pg_class, compute expected pages, then wasted = (relpages - expected) * 8192.',
    solution: `ANALYZE;
WITH w AS (
  SELECT s.tablename, sum(s.avg_width) AS data_width
  FROM pg_stats s WHERE s.schemaname = 'public' GROUP BY s.tablename
), est AS (
  SELECT c.relname, c.relpages, c.reltuples,
         ceil(c.reltuples * (ceil((w.data_width + 24) / 8.0) * 8 + 4) / (8192 - 24)) AS expected_pages
  FROM pg_class c JOIN w ON w.tablename = c.relname
  WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND c.reltuples > 0
)
SELECT relname, relpages, expected_pages::int,
       greatest(relpages - expected_pages, 0)::int * 8192 AS est_wasted_bytes,
       pg_size_pretty((greatest(relpages - expected_pages, 0) * 8192)::bigint) AS est_wasted
FROM est
ORDER BY est_wasted_bytes DESC
LIMIT 10;`,
    run: true
  },
  related: ['vacuum-basics', 'vacuum-autovacuum', 'vacuum-wraparound', 'mvcc-consequences-hot', 'replication'],
  quiz: [
    { type: 'mcq', q: 'Which is NOT a common cause of a pinned xmin horizon?', options: ['A session idle in transaction for hours', 'An inactive logical replication slot', 'A high shared_buffers setting', 'An orphaned prepared transaction'], answer: 2, explain: 'shared_buffers has nothing to do with the xmin horizon.' },
    { type: 'tf', q: 'VACUUM compacts half-empty B-tree index pages back into fewer pages.', answer: false, explain: 'VACUUM removes dead entries and can recycle completely empty pages, but it does not merge partially filled pages; REINDEX rebuilds compactly.' },
    { type: 'optimize', q: 'A 300 GB hot table is 60% bloated and must stay online. Best fix?', options: ['VACUUM FULL during business hours', 'pg_repack (third-party) during off-peak, after fixing the cause', 'DROP and recreate', 'Increase shared_buffers'], answer: 1, explain: 'pg_repack rebuilds online with brief locks; VACUUM FULL blocks all access.' },
    { type: 'scenario', q: 'pg_wal is 500 GB and growing on a primary with no archive problems. First check?', options: ['checkpoint_timeout', 'pg_replication_slots for inactive slots retaining WAL', 'work_mem', 'autovacuum_naptime'], answer: 1, explain: 'Slots retain WAL until consumed; an abandoned slot is the classic cause.' }
  ]
},
{
  id: 'vacuum-wraparound',
  module: 'vacuum',
  title: 'Transaction ID Wraparound: Freezing, autovacuum_freeze_max_age and Emergencies',
  level: 4,
  minutes: 25,
  summary: 'Why 32-bit XIDs force PostgreSQL to freeze old tuples, how freeze ages and anti-wraparound autovacuum work, how to monitor age(datfrozenxid), and what to do when the cluster refuses writes.',
  objectives: [
    'Explain XID wraparound and how freezing prevents data from "disappearing"',
    'Know vacuum_freeze_min_age, vacuum_freeze_table_age, autovacuum_freeze_max_age, vacuum_failsafe_age and their MultiXact counterparts',
    'Monitor age(datfrozenxid) and age(relfrozenxid) and set alert thresholds',
    'Run targeted VACUUM (FREEZE) and read relfrozenxid advancing',
    'Follow an emergency procedure when PostgreSQL stops assigning XIDs'
  ],
  concept: `<p>Because tuple headers store 32-bit XIDs compared modulo 2^32, a tuple created more than ~2.1 billion transactions ago would suddenly look like it was created "in the future" — and become invisible. To prevent this, VACUUM <strong>freezes</strong> old tuples: it sets a flag (<code>HEAP_XMIN_FROZEN</code>) meaning "committed and visible to everyone, ignore the XID". Every table records <code>relfrozenxid</code>: all XIDs older than it are guaranteed frozen. The database's <code>datfrozenxid</code> is the minimum over its tables.</p>
<ul>
<li><code>vacuum_freeze_min_age</code> (50M): tuples older than this get frozen when VACUUM visits their page.</li>
<li><code>vacuum_freeze_table_age</code> (150M): when a table's <code>age(relfrozenxid)</code> exceeds this, VACUUM becomes <em>aggressive</em> — it scans all pages not already all-frozen (not just non-all-visible ones), so relfrozenxid can advance.</li>
<li><code>autovacuum_freeze_max_age</code> (200M): when exceeded, autovacuum forces an <strong>anti-wraparound vacuum</strong> on the table, even if autovacuum is disabled; it does not yield to lock requests.</li>
<li><code>vacuum_failsafe_age</code> (1.6B): VACUUM drops throttling and skips index cleanup to finish freezing ASAP.</li>
<li>At ~40 million XIDs before wraparound (2^31 − 40M; PG 14+ messages), the server <strong>refuses to assign new XIDs</strong>: <em>database is not accepting commands that assign new transaction IDs to avoid wraparound data loss</em>. Reads still work; writes fail.</li>
</ul>
<p>MultiXact IDs (row locks shared by several transactions) have the same problem and parallel settings (<code>vacuum_multixact_freeze_min_age</code>, <code>autovacuum_multixact_freeze_max_age</code> 400M; monitor with <code>mxid_age(datminmxid)</code>).</p>
<p>Analogy: a 12-hour clock without AM/PM. "3 o'clock" is unambiguous only for events less than 6 hours away. Freezing is writing "long ago" on old events so nobody tries to compare them on the clock face anymore.</p>`,
  why: `<p>Wraparound protection is the one PostgreSQL failure mode that can take a healthy-looking database offline for writes for hours (emergency vacuums of multi-terabyte tables). It is entirely preventable with monitoring and healthy autovacuum. Every engineer operating PostgreSQL at scale must understand it.</p>`,
  useCase: `<p>A high-volume ad-tech platform consumed ~1.5 billion XIDs per week. An abandoned replication slot held back the horizon for 11 days; autovacuum ran anti-wraparound vacuums but could not advance <code>relfrozenxid</code> past the slot's xmin. When <code>age(datfrozenxid)</code> passed 2.1 billion minus 40 million, the primary started rejecting writes. Recovery: drop the slot, run <code>VACUUM (FREEZE, VERBOSE)</code> on the oldest tables first (ordered by <code>age(relfrozenxid)</code>) with cost limits disabled; writes resumed after 3 hours. Afterwards: alert at age 500M (warning) and 1B (critical), and on inactive slots.</p>`,
  internals: `<ul>
<li>Modern freezing does not overwrite <code>xmin</code> with FrozenTransactionId (2); it sets both <code>HEAP_XMIN_COMMITTED</code> and <code>HEAP_XMIN_INVALID</code> bits (= frozen), preserving the original xmin for forensics.</li>
<li>The visibility map's <em>all-frozen</em> bit lets aggressive vacuums skip pages that are already completely frozen — crucial for large static tables. PG 16+ freezes pages opportunistically when it would otherwise write a full-page image anyway; PG 18 adds eager freezing of all-visible pages during normal vacuums (<code>vacuum_max_eager_freeze_failure_rate</code>), spreading freeze work.</li>
<li><code>relfrozenxid</code> can advance only up to the oldest XID still possibly running (the xmin horizon). That is why horizon blockers turn into wraparound emergencies.</li>
<li><code>pg_xact</code> and <code>pg_multixact</code> segments older than the cluster-wide frozen XIDs are truncated after freezing, reclaiming disk.</li>
<li>In single-user mode (<code>postgres --single</code>) the XID limit can still be bypassed for emergencies, but since PG 14 the recommended procedure is plain <code>VACUUM</code> in normal multi-user mode (as superuser), since VACUUM itself does not need a new XID.</li>
</ul>`,
  whenNot: `<p>Do not run <code>VACUUM FULL</code> to fix wraparound — it is slower and needs an XID itself; use <code>VACUUM (FREEZE)</code> or plain VACUUM. Do not lower <code>autovacuum_freeze_max_age</code> drastically on huge tables without capacity: it causes frequent full-table freeze scans. Do not raise it near 2 billion "to avoid vacuums" — that removes your safety margin.</p>`,
  syntax: `SELECT datname, age(datfrozenxid), mxid_age(datminmxid) FROM pg_database;
SELECT relname, age(relfrozenxid) FROM pg_class WHERE relkind IN ('r','m','t') ORDER BY 2 DESC;
VACUUM (FREEZE, VERBOSE) table_name;
-- settings: vacuum_freeze_min_age, vacuum_freeze_table_age, autovacuum_freeze_max_age,
--           vacuum_failsafe_age, vacuum_multixact_freeze_min_age, autovacuum_multixact_freeze_max_age`,
  examples: [
    {
      label: 'Basic',
      title: 'Monitor database and table XID age',
      sql: `-- per database: how far from the 2^31 cliff?
SELECT datname,
       age(datfrozenxid)                                  AS xid_age,
       mxid_age(datminmxid)                               AS multixact_age,
       round(100.0 * age(datfrozenxid) / 2147483647, 4)   AS pct_toward_wraparound,
       current_setting('autovacuum_freeze_max_age')::int  AS forced_autovacuum_at
FROM pg_database
ORDER BY age(datfrozenxid) DESC;

-- per table: the oldest tables drive datfrozenxid
SELECT c.oid::regclass AS table_name,
       age(c.relfrozenxid) AS xid_age,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
WHERE c.relkind IN ('r', 'm', 't') AND c.relnamespace = 'public'::regnamespace
ORDER BY age(c.relfrozenxid) DESC
LIMIT 5;`,
      explain: `<p>In this fresh database ages are tiny. In production, alert when <code>age(datfrozenxid)</code> exceeds ~500M (warning) and ~1B (critical) — the default anti-wraparound trigger is 200M, so ages far above that mean autovacuum cannot keep up or is blocked. The per-table query tells you which tables to freeze first (oldest and largest). Include TOAST tables (<code>relkind 't'</code>), which have their own relfrozenxid.</p>`,
      output: ` datname   | xid_age | multixact_age | pct_toward_wraparound | forced_autovacuum_at
-----------+---------+---------------+-----------------------+----------------------
 postgres  |       9 |             0 |                0.0000 |            200000000
 template1 |       9 |             0 |                0.0000 |            200000000
 template0 |       9 |             0 |                0.0000 |            200000000

 table_name        | xid_age | size
-------------------+---------+--------
 employees         |       1 | 120 kB
 projects          |       1 | 32 kB
 employee_projects |       1 | 64 kB
 customers         |       1 | 176 kB
 departments       |       1 | 48 kB`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'VACUUM (FREEZE) advances relfrozenxid and sets all-frozen bits',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_visibility;
CREATE TABLE frz AS SELECT * FROM customers;

SELECT 'before' AS step, relfrozenxid, age(relfrozenxid) AS xid_age, v.*
FROM pg_class, pg_visibility_map_summary('frz') v WHERE relname = 'frz';

VACUUM (FREEZE, VERBOSE) frz;

SELECT 'after' AS step, relfrozenxid, age(relfrozenxid) AS xid_age, v.*
FROM pg_class, pg_visibility_map_summary('frz') v WHERE relname = 'frz';`,
      explain: `<p>Before: no page is marked all-frozen, relfrozenxid is the XID at creation. <code>VACUUM (FREEZE)</code> behaves as if <code>vacuum_freeze_min_age = 0</code> and <code>vacuum_freeze_table_age = 0</code>: it aggressively scans and freezes every tuple. VERBOSE reports "aggressively vacuuming", "new relfrozenxid: N" and how many pages/tuples were frozen. After: every page is all-visible and all-frozen, and <code>age(relfrozenxid)</code> is ~1: the new relfrozenxid is the removable cutoff (the oldest XID that could still be running), and <code>age()</code> counts from the next XID to be assigned. Future aggressive vacuums will skip these pages entirely as long as they are not modified.</p>`,
      output: ` step   | relfrozenxid | xid_age | all_visible | all_frozen
--------+--------------+---------+-------------+------------
 before |          754 |       1 |           0 |          0

INFO:  aggressively vacuuming "postgres.public.frz"
INFO:  table "frz": truncated 8 to 7 pages
pages: 1 removed, 7 remain, 8 scanned (100.00% of total), 0 eagerly scanned
tuples: 0 removed, 500 remain, 0 are dead but not yet removable
new relfrozenxid: 755, which is 1 XIDs ahead of previous value
frozen: 7 pages from table (87.50% of total) had 500 tuples frozen
visibility map: 7 pages set all-visible, 7 pages set all-frozen (0 were all-visible)

 step  | relfrozenxid | xid_age | all_visible | all_frozen
-------+--------------+---------+-------------+------------
 after |          755 |       1 |           7 |          7`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Wraparound risk dashboard with all freeze settings',
      sql: `WITH s AS (
  SELECT current_setting('autovacuum_freeze_max_age')::bigint  AS freeze_max_age,
         current_setting('vacuum_freeze_table_age')::bigint    AS freeze_table_age,
         current_setting('vacuum_failsafe_age')::bigint        AS failsafe_age,
         current_setting('autovacuum_multixact_freeze_max_age')::bigint AS mxid_freeze_max_age
)
SELECT d.datname,
       age(d.datfrozenxid)                        AS xid_age,
       s.freeze_max_age,
       s.failsafe_age,
       2147483647 - 40000000 - age(d.datfrozenxid) AS xids_left_before_write_stop,
       CASE WHEN age(d.datfrozenxid) > s.failsafe_age   THEN 'CRITICAL: failsafe zone'
            WHEN age(d.datfrozenxid) > 1000000000        THEN 'CRITICAL'
            WHEN age(d.datfrozenxid) > 500000000         THEN 'WARNING'
            WHEN age(d.datfrozenxid) > s.freeze_max_age  THEN 'anti-wraparound vacuums due'
            ELSE 'OK' END                          AS status,
       mxid_age(d.datminmxid)                      AS mxid_age,
       s.mxid_freeze_max_age
FROM pg_database d CROSS JOIN s
ORDER BY xid_age DESC;`,
      explain: `<p>One query for the monitoring system: current XID age per database, remaining headroom before PostgreSQL stops assigning XIDs (2^31 − ~40M safety margin in PG 14+), and a status column with typical alert levels. MultiXact age is included because MultiXact wraparound causes the same outage. Pair it with XID consumption rate (difference of <code>txid_current()</code> samples, taken by a monitoring role) to estimate time-to-danger.</p>`,
      output: ` datname   | xid_age | freeze_max_age | failsafe_age | xids_left_before_write_stop | status | mxid_age | mxid_freeze_max_age
-----------+---------+----------------+--------------+-----------------------------+--------+----------+---------------------
 postgres  |       9 |      200000000 |   1600000000 |                  2107483638 | OK     |        0 |           400000000
 template1 |       9 |      200000000 |   1600000000 |                  2107483638 | OK     |        0 |           400000000
 template0 |       9 |      200000000 |   1600000000 |                  2107483638 | OK     |        0 |           400000000`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Emergency reflex: VACUUM FULL the biggest table
CREATE TABLE frz_big AS SELECT * FROM order_items;
VACUUM FULL frz_big;
SELECT age(relfrozenxid) FROM pg_class WHERE relname = 'frz_big';`,
      why: 'VACUUM FULL rewrites the whole table under ACCESS EXCLUSIVE and needs a transaction ID itself; in a real wraparound emergency it is slower and may not even be allowed. It is the wrong tool.',
      run: true
    },
    good: {
      sql: `-- Emergency procedure: freeze the oldest tables first with plain VACUUM (FREEZE), unthrottled
CREATE TABLE frz_big AS SELECT * FROM order_items;
SET vacuum_cost_delay = 0;            -- manual vacuum: no throttling (default for manual anyway)
VACUUM (FREEZE, INDEX_CLEANUP OFF, VERBOSE) frz_big;
SELECT age(relfrozenxid) FROM pg_class WHERE relname = 'frz_big';`,
      why: 'Plain VACUUM (FREEZE) advances relfrozenxid without rewriting; INDEX_CLEANUP OFF skips index passes to finish faster (indexes are cleaned by a later normal vacuum).',
      run: true
    }
  },
  mistakes: [
    'Not monitoring <code>age(datfrozenxid)</code> and <code>mxid_age(datminmxid)</code> at all.',
    'Ignoring horizon blockers (slots, idle transactions, prepared transactions): anti-wraparound vacuums run but cannot advance relfrozenxid.',
    'Cancelling anti-wraparound autovacuums repeatedly ("autovacuum: VACUUM ... (to prevent wraparound)") because they look like they block DDL.',
    'Raising <code>autovacuum_freeze_max_age</code> close to 2 billion to "reduce vacuums".',
    'Restarting the server in a wraparound emergency hoping it helps — it does not; only freezing does.'
  ],
  best: [
    'Alert on age(datfrozenxid) &gt; 500M (warning) and &gt; 1B (critical), and on MultiXact age similarly.',
    'Track XID consumption rate; high-rate systems need faster autovacuum (higher cost limits, more workers).',
    'Run <code>VACUUM (FREEZE)</code> proactively on large, static tables (e.g. after loading historical partitions) during quiet periods.',
    'Partition large append-only tables so old partitions get frozen once and then skipped forever.',
    'Keep an emergency runbook: find blockers → remove them → <code>VACUUM (FREEZE, INDEX_CLEANUP OFF)</code> oldest tables first, unthrottled → monitor ages fall.'
  ],
  performance: `<p>Freezing writes every page it freezes (and WAL, often full-page images), so the first aggressive vacuum of a large table is I/O heavy. Spreading it out — insert-triggered vacuums (PG 13+), opportunistic freezing (PG 16+) and eager freezing (PG 18) — avoids sudden "freeze storms". Pages marked all-frozen are skipped forever after, so steady-state cost is low for static data.</p>`,
  security: `<p>Wraparound protection is an availability concern. Anyone able to hold transactions open (or create replication slots) can indirectly push a cluster towards it; restrict replication privileges and enforce session timeouts for interactive and BI roles.</p>`,
  scenario: {
    title: 'ERROR: database is not accepting commands that assign new transaction IDs',
    steps: [
      '1. Stay calm: reads still work; writes fail. Do NOT restart repeatedly or run VACUUM FULL.',
      '2. Find blockers: pg_replication_slots (drop abandoned slots), pg_prepared_xacts (resolve), pg_stat_activity (terminate old transactions).',
      '3. List tables by age(relfrozenxid) DESC in the affected database (including TOAST tables).',
      '4. As superuser in normal mode, run VACUUM (FREEZE, INDEX_CLEANUP OFF, VERBOSE) on the oldest tables first; set vacuum_cost_delay = 0; run several tables in parallel sessions if I/O allows.',
      '5. Watch age(datfrozenxid) drop below the stop limit; writes resume automatically.',
      '6. Afterwards: run normal VACUUM to clean indexes, fix autovacuum tuning, add age and slot alerts, write a post-mortem.'
    ]
  },
  widgets: ['diagram:mvcc'],
  interview: [
    { q: 'What is transaction ID wraparound and how does PostgreSQL prevent it?', a: 'XIDs are 32-bit and compared modulo 2^32, so tuples older than ~2.1 billion transactions would appear to be in the future and vanish. VACUUM freezes old tuples (marks them visible to all regardless of XID) and advances relfrozenxid/datfrozenxid. Autovacuum forces anti-wraparound vacuums when a table\'s age exceeds autovacuum_freeze_max_age; as a last resort the server stops assigning new XIDs ~40M before wraparound.' },
    { q: 'What is the difference between vacuum_freeze_min_age, vacuum_freeze_table_age and autovacuum_freeze_max_age?', a: 'freeze_min_age: minimum tuple age to freeze when a page is visited. freeze_table_age: table age at which VACUUM becomes aggressive and scans all non-all-frozen pages to advance relfrozenxid. autovacuum_freeze_max_age: table age at which autovacuum forcibly starts an anti-wraparound vacuum, even if disabled.' },
    { q: 'Why can anti-wraparound vacuums run but fail to reduce age(datfrozenxid)?', a: 'relfrozenxid can only advance to the oldest XID that might still be running. A long transaction, an abandoned replication slot (xmin/catalog_xmin), an orphaned prepared transaction, or standby feedback holds the horizon back, so freezing cannot pass it. Remove the blocker first.' },
    { q: 'How do you handle a cluster that has stopped accepting writes due to wraparound?', a: 'Remove horizon blockers, then as superuser run VACUUM (FREEZE) — optionally with INDEX_CLEANUP OFF and no cost delay — on the tables with the highest age(relfrozenxid), including TOAST tables, until the database age falls below the limit. Since PG 14 this works in normal multi-user mode; single-user mode is rarely needed. Then fix monitoring and autovacuum.' }
  ],
  exercises: [
    {
      task: 'List the 5 oldest tables (including TOAST tables) in the database by age(relfrozenxid) with their size.',
      solution: `SELECT c.oid::regclass AS rel, c.relkind, age(c.relfrozenxid) AS xid_age,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
WHERE c.relkind IN ('r', 'm', 't')
ORDER BY age(c.relfrozenxid) DESC
LIMIT 5;`,
      run: true
    },
    {
      task: 'Show all freeze-related settings with their current values.',
      solution: `SELECT name, setting FROM pg_settings
WHERE name LIKE '%freeze%' OR name = 'vacuum_failsafe_age' OR name = 'vacuum_multixact_failsafe_age'
ORDER BY name;`,
      run: true
    }
  ],
  challenge: {
    task: 'Using pageinspect, prove that VACUUM (FREEZE) marks tuples frozen without changing t_xmin: insert rows, show t_infomask frozen bits (HEAP_XMIN_COMMITTED 256 + HEAP_XMIN_INVALID 512 = 768) before and after the freeze.',
    hint: '(t_infomask & 768) = 768 means frozen. Commit the insert first so VACUUM can freeze it.',
    solution: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE fz (id int);
BEGIN; INSERT INTO fz SELECT generate_series(1, 3); COMMIT;
SELECT lp, t_xmin, (t_infomask & 768) = 768 AS frozen FROM heap_page_items(get_raw_page('fz', 0));
VACUUM (FREEZE) fz;
SELECT lp, t_xmin, (t_infomask & 768) = 768 AS frozen FROM heap_page_items(get_raw_page('fz', 0));
DROP TABLE fz;`,
    run: true
  },
  related: ['vacuum-basics', 'vacuum-autovacuum', 'vacuum-bloat', 'transaction-internals-xids-subtransactions'],
  quiz: [
    { type: 'mcq', q: 'What happens when a table\'s age(relfrozenxid) exceeds autovacuum_freeze_max_age?', options: ['The server shuts down', 'Autovacuum forces an anti-wraparound vacuum on it, even if autovacuum is disabled', 'The table becomes read-only', 'Nothing until 2 billion'], answer: 1, explain: 'Anti-wraparound autovacuum is forced and does not yield to lock requests.' },
    { type: 'tf', q: 'Freezing a tuple overwrites its xmin with the value 2 in modern PostgreSQL versions.', answer: false, explain: 'Since 9.4 freezing sets infomask bits (XMIN_COMMITTED | XMIN_INVALID) and keeps the original xmin for forensics.' },
    { type: 'scenario', q: 'age(datfrozenxid) keeps rising although anti-wraparound vacuums run constantly. Most likely cause?', options: ['Too little shared_buffers', 'A horizon blocker such as an inactive replication slot or old transaction', 'Too many indexes', 'Disabled JIT'], answer: 1, explain: 'relfrozenxid cannot advance past the oldest possibly-running XID.' },
    { type: 'mcq', q: 'Which function shows MultiXact age for a database?', options: ['age(datminmxid)', 'mxid_age(datminmxid)', 'txid_age()', 'pg_multixact_age()'], answer: 1, explain: 'mxid_age() is the MultiXact counterpart of age().' }
  ]
}
]);

PGM.addLessons([
/* ===================================================================
   MODULE: wal
   =================================================================== */
{
  id: 'wal-fundamentals',
  module: 'wal',
  title: 'Write-Ahead Logging: WAL Records, LSNs, Segments and Crash Recovery',
  level: 4,
  minutes: 25,
  summary: 'Why PostgreSQL writes every change to the WAL before the data files, what WAL records, LSNs and 16 MB segments are, and how crash recovery replays WAL from the last checkpoint.',
  objectives: [
    'State the write-ahead rule and why it makes durability cheap',
    'Explain WAL records, LSNs (log sequence numbers) and how an LSN maps to a segment file name',
    'Use pg_current_wal_lsn(), pg_current_wal_insert_lsn(), pg_walfile_name() and pg_wal_lsn_diff()',
    'Measure how much WAL a statement generates',
    'Describe crash recovery: redo from the checkpoint\'s REDO point to the end of WAL'
  ],
  concept: `<p><strong>Write-Ahead Logging (WAL)</strong> is the rule that every change to a data page must first be described in a sequential log, and that log must reach durable storage <em>before</em> the transaction is reported as committed and before the changed data page itself may be written to disk. Data files can then be written lazily, in any order, whenever convenient.</p>
<p>Analogy: a bank teller's journal. Instead of immediately updating dozens of ledgers in different filing cabinets (random I/O), the teller writes one line per operation in a bound journal (sequential I/O) and updates the ledgers later. If the building loses power, the ledgers may be half-updated, but replaying the journal from the last time everything was reconciled (the checkpoint) restores the exact state.</p>
<ul>
<li><strong>WAL record</strong>: a description of one low-level change ("insert tuple X into page 42 of relation R", "commit XID 9001"), with a header, the resource manager (heap, btree, transaction...), and data. The first change to a page after a checkpoint also includes a <strong>full-page image</strong> (FPI) to protect against torn pages.</li>
<li><strong>LSN (Log Sequence Number)</strong>: a 64-bit byte position in the WAL stream, written as two hex numbers <code>16/B374D848</code>. Every data page stores the LSN of the last WAL record that modified it (<code>pd_lsn</code>), which enforces the write-ahead rule: a page cannot be flushed until WAL up to its LSN is flushed.</li>
<li><strong>Segments</strong>: the WAL stream is cut into files of <code>wal_segment_size</code> (16 MB by default, set at initdb) in <code>$PGDATA/pg_wal</code>, named <code>TTTTTTTTXXXXXXXXYYYYYYYY</code> = timeline + LSN high part + segment number.</li>
<li><strong>Crash recovery</strong>: on startup after a crash, PostgreSQL reads the last checkpoint record from <code>pg_control</code>, starts at its REDO LSN, and replays every WAL record up to the end of valid WAL. Then it is consistent and opens for connections.</li>
</ul>
<p>The same WAL stream powers streaming replication, point-in-time recovery and logical decoding.</p>`,
  why: `<p>Without WAL, guaranteeing durability would require flushing every modified data page at commit — random writes of 8 kB pages scattered over many files. With WAL, a commit costs one sequential append and one flush of the WAL (often batched for many transactions: group commit). WAL also makes crash recovery deterministic and enables replication and backups.</p>`,
  useCase: `<p>A payments API on cloud block storage (fsync ≈ 1.5 ms) commits 4,000 transactions per second. Because commits only flush WAL sequentially — and concurrent commits share one flush (group commit) — the database sustains this with fewer than 1,000 fsyncs per second, while the 300 GB of data files are written in the background by the checkpointer and background writer. After an unplanned host reboot, recovery replayed 2.1 GB of WAL from the last checkpoint in 38 seconds and lost no committed payment.</p>`,
  internals: `<ul>
<li>Backends insert WAL records into shared <strong>WAL buffers</strong> (<code>wal_buffers</code>, default 1/32 of shared_buffers, up to one segment) under an insertion lock; <code>pg_current_wal_insert_lsn()</code> shows the insert position.</li>
<li>At commit the backend (or the <strong>WAL writer</strong> process for asynchronous commits) writes and fsyncs WAL up to the commit record's LSN; <code>pg_current_wal_lsn()</code> shows the write position, <code>pg_current_wal_flush_lsn()</code> the flushed position.</li>
<li>Before the buffer manager writes a dirty data page, it calls <code>XLogFlush(page LSN)</code>, ensuring WAL is durable first.</li>
<li>LSN → file: segment number = LSN / segment size; the file name encodes timeline (8 hex), then (LSN &gt;&gt; 32) (8 hex), then the segment within that 4 GB range (8 hex).</li>
<li>Old segments are recycled (renamed for reuse) or removed after a checkpoint, unless needed by <code>wal_keep_size</code>, replication slots, or archiving that has not yet succeeded.</li>
<li>Unlogged tables and temporary tables skip WAL (fast, but not crash-safe or replicated).</li>
</ul>`,
  whenNot: `<p>You do not turn WAL off. For bulk loads where durability does not matter (staging data you can reload), use <code>UNLOGGED</code> tables, or <code>wal_level = minimal</code> on a server with no replicas/archiving so that COPY into a table created in the same transaction skips WAL. Never use <code>fsync = off</code> on data you care about.</p>`,
  syntax: `SELECT pg_current_wal_lsn();            -- write position
SELECT pg_current_wal_insert_lsn();     -- insert position (buffers)
SELECT pg_current_wal_flush_lsn();      -- flushed position
SELECT pg_walfile_name(lsn), pg_walfile_name_offset(lsn);
SELECT pg_wal_lsn_diff(lsn1, lsn2);     -- bytes between two LSNs (also: lsn1 - lsn2)
SELECT * FROM pg_stat_wal;              -- records, full-page images, bytes
SELECT * FROM pg_ls_waldir();           -- files in pg_wal (privileged)`,
  examples: [
    {
      label: 'Basic',
      title: 'Where is the WAL right now?',
      sql: `SELECT pg_current_wal_lsn()                              AS write_lsn,
       pg_current_wal_insert_lsn()                       AS insert_lsn,
       pg_walfile_name(pg_current_wal_lsn())             AS current_segment_file,
       pg_walfile_name_offset(pg_current_wal_lsn())      AS file_and_offset,
       current_setting('wal_segment_size')               AS segment_size;

-- the files in pg_wal (requires superuser or pg_monitor)
SELECT name, pg_size_pretty(size) AS size FROM pg_ls_waldir() ORDER BY name;`,
      explain: `<p>The write LSN <code>0/1DC73B8</code> means byte 0x1DC73B8 (about 31 MB) into the WAL stream of this young cluster, which lies in segment file <code>000000010000000000000001</code> (timeline 1, high part 0, segment 1) at offset ~14 MB. The insert LSN is slightly ahead: records already in WAL buffers but not yet written out. Every segment is exactly 16 MB; PostgreSQL pre-allocates and recycles them. Your exact LSN will differ.</p>`,
      output: ` write_lsn | insert_lsn | current_segment_file     | file_and_offset                    | segment_size
-----------+------------+--------------------------+------------------------------------+--------------
 0/1DC73B8 | 0/1DE11E0  | 000000010000000000000001 | (000000010000000000000001,14447544) | 16MB

 name                     | size
--------------------------+-------
 000000010000000000000001 | 16 MB
 000000010000000000000002 | 16 MB`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Measure the WAL volume of a statement',
      sql: `BEGIN;
CREATE TEMP TABLE wal_mark AS SELECT pg_current_wal_insert_lsn() AS lsn;

INSERT INTO audit_logs (table_name, operation, row_id, changed_by)
SELECT 'orders', 'UPDATE', g, 'wal-demo' FROM generate_series(1, 1000) AS g;

SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), lsn)                 AS wal_bytes,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_insert_lsn(), lsn)) AS wal_pretty,
       round(pg_wal_lsn_diff(pg_current_wal_insert_lsn(), lsn) / 1000.0)  AS bytes_per_row
FROM wal_mark;
ROLLBACK;`,
      explain: `<p>Recording the insert LSN before and after a statement and subtracting (<code>pg_wal_lsn_diff</code>, or simply <code>lsn2 - lsn1</code>) gives the exact WAL bytes generated — including heap inserts, primary-key index inserts and full-page images for pages touched for the first time since the last checkpoint. Roughly 220 bytes per row here. Note that WAL is written even though we roll back: WAL describes physical changes; the abort is just another record. Use this technique to compare designs (e.g. fewer indexes, HOT-friendly updates, batching).</p>`,
      output: ` wal_bytes | wal_pretty | bytes_per_row
-----------+------------+---------------
    217872 | 213 kB     |           218`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'LSN arithmetic, segment math and pg_stat_wal',
      sql: `-- LSN text is two hex numbers: high 32 bits / low 32 bits
SELECT '16/B374D848'::pg_lsn                                   AS lsn,
       ('16/B374D848'::pg_lsn - '0/0'::pg_lsn)                 AS absolute_bytes,
       pg_walfile_name_offset('16/B374D848')                   AS file_and_offset,
       '0/3000060'::pg_lsn - '0/3000000'::pg_lsn               AS diff_bytes;

-- cumulative WAL statistics since the last reset
SELECT wal_records, wal_fpi, pg_size_pretty(wal_bytes) AS wal_bytes,
       round(100.0 * wal_fpi / nullif(wal_records, 0), 1) AS fpi_pct,
       wal_buffers_full
FROM pg_stat_wal;`,
      explain: `<p>LSN 16/B374D848 = 0x16 × 2³² + 0xB374D848 ≈ 97.5 billion bytes of WAL since initdb. With 16 MB segments that is file <code>0000000100000016000000B3</code> (segment 0xB3 within the 0x16 range) at offset 7,657,544. <code>pg_stat_wal</code> counts records, full-page images (FPI) and bytes; a high FPI share means many first-touch-after-checkpoint pages — longer checkpoint intervals or <code>wal_compression</code> reduce it. <code>wal_buffers_full</code> &gt; 0 suggests wal_buffers is too small. (PG 18 moved WAL write/sync timing counters to <code>pg_stat_io</code>.)</p>`,
      output: ` lsn         | absolute_bytes | file_and_offset                    | diff_bytes
-------------+----------------+------------------------------------+------------
 16/B374D848 |    97500059720 | (0000000100000016000000B3,7657544) |         96

 wal_records | wal_fpi | wal_bytes | fpi_pct | wal_buffers_full
-------------+---------+-----------+---------+------------------
          19 |      13 | 103 kB    |    68.4 |                0     (sandbox counters; tiny)`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Staging data that is reloaded every night, written to a normal (WAL-logged) table
CREATE TABLE staging_import (id int, payload text);
INSERT INTO staging_import SELECT g, repeat('x', 100) FROM generate_series(1, 5000) g;`,
      why: 'Every row is WAL-logged, replicated and archived although the data is disposable — wasted I/O, replica lag and archive storage.',
      run: true
    },
    good: {
      sql: `-- Disposable data: UNLOGGED skips WAL (truncated after a crash, not replicated)
CREATE UNLOGGED TABLE staging_import (id int, payload text);
INSERT INTO staging_import SELECT g, repeat('x', 100) FROM generate_series(1, 5000) g;
SELECT relpersistence FROM pg_class WHERE relname = 'staging_import';`,
      why: 'Unlogged tables generate no WAL for their data, making loads several times faster; acceptable only because the data can be reloaded after a crash.',
      run: true
    }
  },
  mistakes: [
    'Using <code>fsync = off</code> for speed: a crash can corrupt the whole cluster, not just lose recent transactions.',
    'Deleting files from <code>pg_wal</code> manually to free space — this destroys recoverability; find out why WAL is retained (slots, archiving failures, wal_keep_size) instead.',
    'Assuming ROLLBACK means "no WAL was written" — the changes and the abort are both logged.',
    'Forgetting that unlogged tables are emptied after a crash and are not replicated to standbys.',
    'Comparing LSNs as strings; use the <code>pg_lsn</code> type and its operators.'
  ],
  best: [
    'Put <code>pg_wal</code> on fast, low-latency storage; WAL fsync latency directly bounds commit latency.',
    'Measure WAL per operation with LSN differences when designing write-heavy features.',
    'Monitor WAL generation rate (bytes/s from <code>pg_stat_wal</code> or LSN deltas) — it drives replica bandwidth, archive storage and backup times.',
    'Use UNLOGGED tables for truly disposable data only.',
    'Keep <code>full_page_writes = on</code> unless the storage guarantees atomic 8 kB writes (rare).'
  ],
  performance: `<p>Commit latency ≈ WAL flush latency (unless <code>synchronous_commit = off</code>). Throughput benefits from group commit (many commits per flush) and from reducing WAL volume: fewer indexes, HOT updates, avoiding no-op updates, longer checkpoint intervals (fewer FPIs), and <code>wal_compression</code> for FPIs. WAL volume also determines replication bandwidth and how long recovery takes after a crash.</p>`,
  security: `<p>WAL contains every changed row in raw form, including data that was later deleted. Protect <code>pg_wal</code>, archived WAL and backups with the same controls as the database (encryption at rest, restricted access). Functions like <code>pg_ls_waldir()</code> are restricted to privileged roles.</p>`,
  scenario: {
    title: 'Primary crashed during peak — what happens on restart?',
    steps: [
      '1. The postmaster starts and reads pg_control: last checkpoint REDO LSN 4A/1C000028, state "in production" (not cleanly shut down).',
      '2. It starts redo at the REDO LSN and replays every WAL record (heap, btree, commit...) up to the end of valid WAL.',
      '3. Full-page images restore any torn pages; pages whose pd_lsn is already newer than a record skip it.',
      '4. Transactions with commit records are durable; those without are treated as aborted (their tuples are invisible).',
      '5. An end-of-recovery checkpoint is written and the server accepts connections.',
      '6. Recovery time ≈ WAL volume since the last checkpoint / replay speed — tune checkpoint_timeout / max_wal_size to bound it (next lesson).'
    ]
  },
  widgets: ['diagram:wal', 'diagram:memory', 'diagram:process-model'],
  interview: [
    { q: 'What is the write-ahead logging rule?', a: 'A change to a data page may not reach disk before the WAL record describing it has been flushed, and a transaction is not acknowledged as committed until its commit record is flushed. Data pages can then be written lazily, because WAL replay can always reconstruct them after a crash.' },
    { q: 'What is an LSN and how does it relate to WAL file names?', a: 'An LSN is a 64-bit byte position in the WAL stream, printed as high/low hex (e.g. 16/B374D848). Dividing by the segment size gives the segment; the file name is timeline (8 hex) + high 32 bits (8 hex) + segment number within that 4 GB range (8 hex), e.g. 0000000100000016000000B3. pg_walfile_name() computes it.' },
    { q: 'How does crash recovery work?', a: 'PostgreSQL reads the last checkpoint location from pg_control, starts replaying WAL at the checkpoint\'s REDO point, applies each record to the affected pages (using full-page images where present and skipping records already reflected via page LSNs), until the end of valid WAL. Committed transactions are then present; uncommitted ones are treated as aborted.' },
    { q: 'Why does PostgreSQL write full-page images?', a: 'An 8 kB page write may be torn by a crash (only part written). The first modification of a page after each checkpoint logs the whole page, so recovery can restore a consistent page image before applying later records. full_page_writes controls this; wal_compression reduces its cost.' }
  ],
  exercises: [
    {
      task: 'Measure the WAL generated by updating the stock of all products (wrap it in a transaction and roll back).',
      solution: `BEGIN;
CREATE TEMP TABLE m AS SELECT pg_current_wal_insert_lsn() AS lsn;
UPDATE products SET stock = stock + 1;
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_insert_lsn(), lsn)) AS wal_generated FROM m;
ROLLBACK;`,
      run: true
    },
    {
      task: 'Compute the WAL file name and offset for LSN 2/0000F0A8 and the number of bytes between 2/0000F0A8 and 1/FFFFFF00.',
      solution: `SELECT pg_walfile_name('2/0000F0A8') AS file,
       pg_walfile_name_offset('2/0000F0A8') AS file_offset,
       pg_wal_lsn_diff('2/0000F0A8', '1/FFFFFF00') AS bytes_between;`,
      run: true
    }
  ],
  challenge: {
    task: 'Compare WAL volume for inserting the same 2,000 rows into (a) a logged table with two indexes, (b) a logged table with no indexes, (c) an unlogged table. Report bytes per row for each.',
    hint: 'Record pg_current_wal_insert_lsn() in a temp table before each insert and diff after.',
    solution: `BEGIN;
CREATE TABLE w_idx (id int PRIMARY KEY, email text, note text);
CREATE INDEX ON w_idx (email);
CREATE TABLE w_plain (id int, email text, note text);
CREATE UNLOGGED TABLE w_unlogged (id int, email text, note text);
CREATE TEMP TABLE marks (label text, lsn pg_lsn);

INSERT INTO marks VALUES ('a0', pg_current_wal_insert_lsn());
INSERT INTO w_idx SELECT g, 'user' || g || '@example.com', repeat('n', 50) FROM generate_series(1, 2000) g;
INSERT INTO marks VALUES ('a1', pg_current_wal_insert_lsn());
INSERT INTO w_plain SELECT g, 'user' || g || '@example.com', repeat('n', 50) FROM generate_series(1, 2000) g;
INSERT INTO marks VALUES ('b1', pg_current_wal_insert_lsn());
INSERT INTO w_unlogged SELECT g, 'user' || g || '@example.com', repeat('n', 50) FROM generate_series(1, 2000) g;
INSERT INTO marks VALUES ('c1', pg_current_wal_insert_lsn());

SELECT 'logged + 2 indexes' AS variant,
       round(((SELECT lsn FROM marks WHERE label = 'a1') - (SELECT lsn FROM marks WHERE label = 'a0')) / 2000) AS bytes_per_row
UNION ALL
SELECT 'logged, no index',
       round(((SELECT lsn FROM marks WHERE label = 'b1') - (SELECT lsn FROM marks WHERE label = 'a1')) / 2000)
UNION ALL
SELECT 'unlogged',
       round(((SELECT lsn FROM marks WHERE label = 'c1') - (SELECT lsn FROM marks WHERE label = 'b1')) / 2000);
ROLLBACK;`,
    run: true
  },
  related: ['wal-checkpoints', 'wal-durability-archiving', 'backup-restore', 'replication'],
  quiz: [
    { type: 'mcq', q: 'What is the default WAL segment size?', options: ['8 kB', '1 MB', '16 MB', '1 GB'], answer: 2, explain: '16 MB, configurable only at initdb (--wal-segsize).' },
    { type: 'tf', q: 'A transaction that is rolled back generates no WAL.', answer: false, explain: 'Its physical changes were already logged; the abort record is logged too.' },
    { type: 'predict', q: 'What does this return?', code: `SELECT '0/3000060'::pg_lsn - '0/3000000'::pg_lsn;`, options: ['60', '96', '0x60', 'error'], answer: 1, explain: 'LSNs are hex byte positions; 0x60 = 96 bytes.' },
    { type: 'mcq', q: 'Where does crash recovery start replaying WAL?', options: ['At the beginning of pg_wal', 'At the REDO point of the last checkpoint recorded in pg_control', 'At the last commit record', 'At the oldest replication slot'], answer: 1, explain: 'All changes before the checkpoint\'s REDO point are guaranteed to be on disk already.' }
  ]
},
{
  id: 'wal-checkpoints',
  module: 'wal',
  title: 'Checkpoints: checkpoint_timeout, max_wal_size, full_page_writes and I/O Spikes',
  level: 4,
  minutes: 22,
  summary: 'What a checkpoint does, what triggers it (time or WAL volume), how it trades recovery time against write amplification, and how to tune it to avoid I/O spikes.',
  objectives: [
    'Explain what the checkpointer does and why checkpoints are needed',
    'Describe the triggers: checkpoint_timeout, max_wal_size, manual CHECKPOINT, shutdown',
    'Explain the interaction between checkpoint frequency and full-page images',
    'Tune checkpoint_completion_target and read pg_stat_checkpointer / log_checkpoints',
    'Diagnose checkpoint-induced latency spikes'
  ],
  concept: `<p>A <strong>checkpoint</strong> is a point in the WAL stream at which all data pages modified before it are guaranteed to be on disk. The <strong>checkpointer</strong> process creates checkpoints by writing all dirty buffers in shared_buffers to the data files, fsyncing them, and then writing a checkpoint record and updating <code>pg_control</code>. WAL before the checkpoint's REDO point is no longer needed for crash recovery and can be recycled.</p>
<p>Triggers:</p>
<ul>
<li><strong>Time</strong>: <code>checkpoint_timeout</code> (default 5 min) since the last checkpoint.</li>
<li><strong>WAL volume</strong>: WAL since the last checkpoint approaches <code>max_wal_size</code> (default 1 GB). These are "requested" checkpoints; frequent ones log a warning (<code>checkpoint_warning</code>).</li>
<li><strong>Manual</strong>: the <code>CHECKPOINT</code> command; also at shutdown, after recovery, at the start of a base backup, CREATE DATABASE, etc.</li>
</ul>
<p>To avoid a burst of writes, the checkpointer spreads them over <code>checkpoint_completion_target</code> (default 0.9) × the interval.</p>
<p>Trade-off: <strong>frequent checkpoints</strong> → short crash recovery but more total writes (dirty pages written repeatedly) and many more <strong>full-page images</strong> (the first change of each page after every checkpoint logs the whole 8 kB page). <strong>Infrequent checkpoints</strong> → less I/O and WAL, but longer recovery and more <code>pg_wal</code> disk usage.</p>
<p>Analogy: saving a long document. Saving every 10 seconds costs constant disk activity; saving every hour risks redoing an hour of edits after a crash. WAL is the undo/redo history between saves.</p>`,
  why: `<p>Default checkpoint settings target small systems. On busy servers they cause checkpoints every minute or two (triggered by max_wal_size), producing write storms, latency spikes and WAL bloated with full-page images. Correct tuning is one of the cheapest large wins for write-heavy PostgreSQL.</p>`,
  useCase: `<p>An IoT ingestion service writing 60 MB/s of WAL hit <code>max_wal_size = 1GB</code> every ~17 seconds: logs were full of "checkpoints are occurring too frequently", 45% of WAL bytes were full-page images, and p99 insert latency jumped every checkpoint. Setting <code>max_wal_size = 64GB</code>, <code>checkpoint_timeout = 15min</code>, <code>checkpoint_completion_target = 0.9</code> and <code>wal_compression = lz4</code> made checkpoints time-triggered, cut WAL volume by 40% and smoothed latency. Worst-case crash recovery grew to ~3 minutes, accepted in their SLO.</p>`,
  internals: `<ul>
<li>At checkpoint start the checkpointer records the current insert LSN as the <strong>REDO point</strong>, then writes all buffers dirty at that moment (sorted by file and block to make I/O more sequential), throttled to finish by the completion target, then fsyncs the files and writes the checkpoint record.</li>
<li>Full-page writes: a backend modifying a page whose LSN is older than the last checkpoint's REDO point includes a full-page image in the WAL record (when <code>full_page_writes = on</code>). After each checkpoint, FPIs spike and then decay.</li>
<li><code>max_wal_size</code> is a soft limit for WAL between checkpoints (it may be exceeded under load, by archiving failures, slots or <code>wal_keep_size</code>); <code>min_wal_size</code> keeps that much recycled WAL ready.</li>
<li>Statistics: PG 17+ <code>pg_stat_checkpointer</code> (<code>num_timed</code>, <code>num_requested</code>, <code>write_time</code>, <code>sync_time</code>, <code>buffers_written</code>); older versions used <code>pg_stat_bgwriter</code>. <code>log_checkpoints = on</code> (default since PG 15) logs each checkpoint's duration and buffers.</li>
<li>On standbys, the equivalent is a <strong>restartpoint</strong>.</li>
</ul>`,
  whenNot: `<p>Do not issue manual <code>CHECKPOINT</code> commands routinely from applications (they force a full flush and FPI storm). Do not set <code>checkpoint_timeout</code> to hours on systems with strict recovery-time objectives. Do not disable <code>full_page_writes</code> unless your storage/filesystem guarantees atomic page writes (e.g. some ZFS setups) — otherwise torn pages can corrupt data after a crash.</p>`,
  syntax: `checkpoint_timeout = 15min          -- 30s .. 1d
max_wal_size = 16GB
min_wal_size = 2GB
checkpoint_completion_target = 0.9
full_page_writes = on
wal_compression = lz4               -- or pglz / zstd / on / off (depending on build)
log_checkpoints = on

CHECKPOINT;                          -- manual (superuser or pg_checkpoint role)
SELECT * FROM pg_stat_checkpointer;  -- PG 17+
SELECT * FROM pg_control_checkpoint();`,
  examples: [
    {
      label: 'Basic',
      title: 'Checkpoint settings and the last checkpoint',
      sql: `SELECT name, setting, unit, context
FROM pg_settings
WHERE name IN ('checkpoint_timeout', 'max_wal_size', 'min_wal_size',
               'checkpoint_completion_target', 'checkpoint_warning',
               'full_page_writes', 'wal_compression', 'log_checkpoints')
ORDER BY name;

SELECT checkpoint_lsn, redo_lsn, redo_wal_file, timeline_id,
       full_page_writes, checkpoint_time
FROM pg_control_checkpoint();`,
      explain: `<p>Defaults: a time-based checkpoint every 300 s, or earlier when ~1 GB of WAL accumulated; writes spread over 90% of the interval. All of these are <code>sighup</code> (reload, no restart). <code>pg_control_checkpoint()</code> shows the last checkpoint: crash recovery would start replaying at <code>redo_lsn</code> in <code>redo_wal_file</code>.</p>`,
      output: ` name                         | setting | unit | context
------------------------------+---------+------+---------
 checkpoint_completion_target | 0.9     |      | sighup
 checkpoint_timeout           | 300     | s    | sighup
 checkpoint_warning           | 30      | s    | sighup
 full_page_writes             | on      |      | sighup
 log_checkpoints              | off     |      | sighup      (on by default in a normal server)
 max_wal_size                 | 1024    | MB   | sighup
 min_wal_size                 | 80      | MB   | sighup
 wal_compression              | off     |      | superuser

 checkpoint_lsn | redo_lsn  | redo_wal_file            | timeline_id | full_page_writes | checkpoint_time
----------------+-----------+--------------------------+-------------+------------------+-----------------
 0/1ED5198      | 0/1ED5140 | 000000010000000000000001 |           1 | t                | ...`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Full-page images after a checkpoint, measured',
      sql: `CREATE TABLE fpi_demo AS SELECT * FROM orders;
CHECKPOINT;                                   -- every page now "clean since checkpoint"

CREATE TEMP TABLE mark AS SELECT pg_current_wal_insert_lsn() AS lsn;
UPDATE fpi_demo SET status = status WHERE id % 50 = 0;     -- 100 rows on many pages: first touch -> FPIs
SELECT 'first touch after checkpoint' AS phase,
       pg_size_pretty(pg_current_wal_insert_lsn() - lsn) AS wal FROM mark;

UPDATE mark SET lsn = pg_current_wal_insert_lsn();
UPDATE fpi_demo SET status = status WHERE id % 50 = 1;     -- same pages again: no FPIs needed
SELECT 'second touch, same pages' AS phase,
       pg_size_pretty(pg_current_wal_insert_lsn() - lsn) AS wal FROM mark;
DROP TABLE fpi_demo;`,
      explain: `<p>Both updates modify 100 rows spread over the same pages. The first one after the CHECKPOINT must log a full 8 kB image for every page it touches; the second touches the same, already-logged pages, so it only writes small row-level records — about 40× less WAL here. That is the mechanism behind "longer checkpoint intervals reduce WAL volume". (CHECKPOINT forces a fresh REDO point; it requires superuser or <code>pg_checkpoint</code>.)</p>`,
      output: ` phase                        | wal
------------------------------+--------
 first touch after checkpoint | 400 kB

 phase                    | wal
--------------------------+-------
 second touch, same pages | 10 kB`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Are checkpoints time-triggered or WAL-triggered?',
      sql: `SELECT num_timed, num_requested, num_done,
       round(100.0 * num_requested / nullif(num_timed + num_requested, 0), 1) AS pct_requested,
       write_time, sync_time, buffers_written, stats_reset
FROM pg_stat_checkpointer;

-- WAL generation rate estimate for sizing max_wal_size
SELECT pg_size_pretty(wal_bytes) AS wal_since_reset,
       now() - stats_reset        AS over,
       pg_size_pretty((wal_bytes / greatest(extract(epoch FROM now() - stats_reset), 1))::bigint) || '/s' AS avg_rate
FROM pg_stat_wal;`,
      explain: `<p>Healthy systems have mostly <code>num_timed</code> checkpoints. A high <code>pct_requested</code> means <code>max_wal_size</code> is too small for the write rate — raise it so that roughly <code>checkpoint_timeout × WAL rate</code> fits (e.g. 20 MB/s × 900 s ≈ 18 GB → max_wal_size ≈ 24–32 GB with headroom). <code>write_time</code>/<code>sync_time</code> (ms) show how long checkpoints spend in I/O; large sync times point to storage pressure. In the playground counters are near zero.</p>`,
      output: ` num_timed | num_requested | num_done | pct_requested | write_time | sync_time | buffers_written | stats_reset
-----------+---------------+----------+---------------+------------+-----------+-----------------+-------------
         0 |             0 |        0 |               |          0 |         0 |               0 | (now)

 wal_since_reset | over         | avg_rate
-----------------+--------------+----------
 103 kB          | 00:00:00.259 | 103 kB/s     (sandbox; on a real server stats_reset is days ago)`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Application code that forces a checkpoint after every batch "to be safe"
CREATE TABLE batch_t (id int);
INSERT INTO batch_t SELECT generate_series(1, 1000);
CHECKPOINT;`,
      why: 'Commit already makes data durable via WAL. Forced checkpoints flush all dirty buffers and reset the FPI cycle, multiplying I/O and WAL volume.',
      run: true
    },
    good: {
      sql: `-- Trust WAL durability; let time-based checkpoints do their job
CREATE TABLE batch_t (id int);
INSERT INTO batch_t SELECT generate_series(1, 1000);
SELECT current_setting('checkpoint_timeout') AS checkpoint_timeout,
       current_setting('max_wal_size')       AS max_wal_size;`,
      why: 'Committed data is safe once its WAL is flushed; checkpoints should be infrequent, time-driven and spread out.',
      run: true
    }
  },
  mistakes: [
    'Leaving <code>max_wal_size = 1GB</code> on write-heavy servers, causing WAL-triggered checkpoints every few seconds.',
    'Calling <code>CHECKPOINT</code> from application code or cron jobs.',
    'Disabling <code>full_page_writes</code> to save WAL on ordinary storage — risks corruption after power loss.',
    'Setting <code>checkpoint_completion_target</code> very low, which concentrates writes into bursts.',
    'Forgetting that a very large max_wal_size needs that much free disk in pg_wal (plus headroom).'
  ],
  best: [
    'Size <code>max_wal_size</code> so that most checkpoints are triggered by <code>checkpoint_timeout</code> (check <code>pg_stat_checkpointer</code>).',
    'Typical production: <code>checkpoint_timeout</code> 10–30 min, completion target 0.9, <code>log_checkpoints = on</code>.',
    'Enable <code>wal_compression</code> (lz4 or zstd if built in) to shrink FPIs, especially on IO-bound systems.',
    'Balance against RTO: recovery replays WAL since the last REDO point.',
    'Watch <code>sync_time</code> spikes — they reveal storage that cannot absorb checkpoint writes.'
  ],
  performance: `<p>Checkpoints convert random dirty-page writes into periodic flushes; spreading them out keeps I/O smooth. Longer intervals reduce total page writes (a hot page is written once per checkpoint, no matter how often it changes) and FPIs, often cutting WAL by 30–60% on update-heavy workloads. The background writer (<code>bgwriter_*</code>) cleans buffers ahead of backends to keep checkpoint and eviction writes off the query path.</p>`,
  security: `<p>The <code>CHECKPOINT</code> command is restricted to superusers and members of <code>pg_checkpoint</code> (PG 15+), preventing ordinary users from causing I/O storms.</p>`,
  scenario: {
    title: 'Latency spikes every 30 seconds on an ingestion database',
    steps: [
      '1. Logs show "checkpoints are occurring too frequently (18 seconds apart)" and "checkpoint starting: wal".',
      '2. pg_stat_checkpointer: num_requested 98% of checkpoints; pg_stat_wal shows 45% of WAL records are FPIs.',
      '3. Measure WAL rate: ~60 MB/s → 15 min interval needs ~54 GB; set max_wal_size = 64GB, checkpoint_timeout = 15min.',
      '4. Enable wal_compression = lz4; keep checkpoint_completion_target = 0.9.',
      '5. Ensure pg_wal has ≥ 100 GB free; reload configuration (no restart needed).',
      '6. Verify: checkpoints now timed, WAL volume down ~40%, p99 latency flat; recovery time estimate ~3 min accepted.'
    ]
  },
  widgets: ['diagram:wal', 'diagram:memory'],
  interview: [
    { q: 'What does a checkpoint do?', a: 'It marks a REDO point, writes all buffers that were dirty at that point to the data files, fsyncs them, and records a checkpoint in WAL and pg_control. Crash recovery then only needs WAL from that REDO point, and older WAL segments can be recycled.' },
    { q: 'How do checkpoint frequency and WAL volume relate?', a: 'After every checkpoint, the first modification of each page writes a full-page image to WAL. Frequent checkpoints therefore produce many more FPIs and more data-file writes; less frequent checkpoints reduce WAL and I/O but lengthen crash recovery and need more pg_wal space.' },
    { q: 'What do max_wal_size and checkpoint_timeout control?', a: 'checkpoint_timeout is the maximum time between automatic checkpoints; max_wal_size is the WAL volume that triggers a checkpoint earlier. Ideally checkpoints are time-triggered; frequent WAL-triggered checkpoints mean max_wal_size is too small.' },
    { q: 'What is checkpoint_completion_target?', a: 'The fraction of the checkpoint interval over which the checkpointer spreads its writes (default 0.9). Higher values smooth I/O; the checkpoint still completes before the next is due.' }
  ],
  exercises: [
    {
      task: 'Show the last checkpoint\'s REDO LSN and how many bytes of WAL have been written since then (what crash recovery would have to replay now).',
      solution: `SELECT redo_lsn, pg_current_wal_lsn() AS now_lsn,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), redo_lsn)) AS wal_to_replay
FROM pg_control_checkpoint();`,
      run: true
    },
    {
      task: 'Calculate a max_wal_size recommendation for a WAL rate of 25 MB/s and checkpoint_timeout of 15 minutes, with 50% headroom.',
      solution: `SELECT pg_size_pretty((25::bigint * 1024 * 1024 * 15 * 60 * 1.5)::bigint) AS recommended_max_wal_size;`,
      run: true
    }
  ],
  challenge: {
    task: 'Show that a CHECKPOINT moves the REDO point: record pg_control_checkpoint().redo_lsn, generate some WAL, run CHECKPOINT, and compare the old and new REDO LSNs and their WAL file names.',
    hint: 'Store the first REDO LSN in a temp table, generate WAL (e.g. CREATE TABLE AS), run CHECKPOINT, then join the stored value with pg_control_checkpoint().',
    solution: `CREATE TEMP TABLE before_cp AS SELECT redo_lsn FROM pg_control_checkpoint();
CREATE TABLE cp_load AS SELECT * FROM order_items;
CHECKPOINT;
SELECT b.redo_lsn AS old_redo, c.redo_lsn AS new_redo,
       pg_walfile_name(b.redo_lsn) AS old_file, c.redo_wal_file AS new_file,
       pg_size_pretty(pg_wal_lsn_diff(c.redo_lsn, b.redo_lsn)) AS advanced_by
FROM before_cp b, pg_control_checkpoint() c;`,
    run: true
  },
  related: ['wal-fundamentals', 'wal-durability-archiving', 'backup-restore', 'production-optimization'],
  quiz: [
    { type: 'mcq', q: 'pg_stat_checkpointer shows 95% requested checkpoints. What should you change first?', options: ['Lower checkpoint_timeout', 'Increase max_wal_size', 'Disable full_page_writes', 'Increase work_mem'], answer: 1, explain: 'Requested checkpoints are triggered by WAL volume reaching max_wal_size.' },
    { type: 'tf', q: 'More frequent checkpoints reduce total WAL volume.', answer: false, explain: 'They increase it, because every checkpoint restarts the full-page-image cycle.' },
    { type: 'mcq', q: 'Which is a downside of very infrequent checkpoints?', options: ['More full-page images', 'Longer crash recovery and more pg_wal disk usage', 'Lost commits', 'Index corruption'], answer: 1, explain: 'Recovery must replay all WAL since the last REDO point.' },
    { type: 'optimize', q: 'An app runs CHECKPOINT after every import batch. Best advice?', options: ['Keep it; it improves durability', 'Remove it; commits are already durable via WAL and checkpoints should be time-driven', 'Run it twice', 'Replace with VACUUM FULL'], answer: 1, explain: 'Forced checkpoints only add I/O and FPIs.' }
  ]
},
{
  id: 'wal-durability-archiving',
  module: 'wal',
  title: 'Durability Settings, wal_level and WAL Archiving (the Foundation of PITR)',
  level: 4,
  minutes: 24,
  summary: 'fsync, synchronous_commit levels, wal_level (minimal / replica / logical), wal_compression, and continuous archiving with archive_mode, archive_command or archive_library — the building blocks of point-in-time recovery.',
  objectives: [
    'Distinguish fsync (corruption risk) from synchronous_commit (bounded loss)',
    'Choose wal_level for standalone, replicated and logically replicated systems',
    'Configure continuous WAL archiving with archive_mode and archive_command/archive_library',
    'Monitor archiving with pg_stat_archiver and understand what happens when it fails',
    'Use pg_current_wal_lsn(), pg_walfile_name() and pg_wal_lsn_diff() in archiving and replication checks'
  ],
  concept: `<h4>Durability knobs</h4>
<ul>
<li><code>fsync</code> (on): whether PostgreSQL forces writes to durable storage. <strong>off</strong> = a crash or power loss can leave the cluster corrupted — only for disposable test databases (this browser sandbox runs with it off).</li>
<li><code>synchronous_commit</code> (on): whether COMMIT waits for its WAL to be flushed (and, with synchronous replication, for standbys). <strong>off</strong> = may lose the last ~600 ms of commits on crash, never corrupts. Settable per transaction.</li>
<li><code>full_page_writes</code> (on): torn-page protection (previous lesson).</li>
<li><code>wal_compression</code> (off): compress full-page images (<code>pglz</code>, <code>lz4</code>, <code>zstd</code> when compiled in; <code>on</code> = pglz).</li>
</ul>
<h4>wal_level</h4>
<table>
<tr><th>Level</th><th>Logs enough for</th><th>Notes</th></tr>
<tr><td><code>minimal</code></td><td>crash recovery only</td><td>Some bulk operations skip WAL (e.g. COPY into a table created/truncated in the same transaction). No replicas, no archiving, no PITR.</td></tr>
<tr><td><code>replica</code> (default)</td><td>+ physical replication, WAL archiving, PITR, read-only standbys</td><td>The right choice for almost all production systems.</td></tr>
<tr><td><code>logical</code></td><td>+ logical decoding / logical replication / CDC</td><td>Slightly more WAL (extra info for row identification, e.g. REPLICA IDENTITY).</td></tr>
</table>
<p>Changing <code>wal_level</code> requires a restart.</p>
<h4>Continuous archiving</h4>
<p>With <code>archive_mode = on</code>, every completed 16 MB WAL segment is handed to <code>archive_command</code> (a shell command, <code>%p</code> = path, <code>%f</code> = file name) or, since PG 15, to an <code>archive_library</code> module. A segment is removed or recycled only after archiving <em>succeeds</em>. A base backup plus all archived WAL since it lets you restore the cluster to <strong>any point in time</strong> (PITR, see backup-restore). <code>archive_timeout</code> forces a segment switch after N seconds so low-traffic systems still archive regularly (bounding data loss).</p>
<p>Analogy: a ship's logbook. Each full page of the logbook (segment) is photocopied and sent ashore (archived) before the page may be reused. Together with a photo of the ship at a given moment (base backup), the shore office can reconstruct the ship's exact state at any later minute.</p>
<p>In practice, archiving is handled by dedicated tools such as <strong>pgBackRest</strong> or <strong>Barman</strong> <span class="tag tool">third-party tool</span>, or WAL-G, which compress, encrypt, parallelise and verify archives.</p>`,
  why: `<p>Backups without WAL archiving can only restore to the moment of the backup (losing up to a day of data). Archiving reduces the recovery point objective (RPO) to the last archived segment (seconds to minutes) and allows recovering to just before a human error ("DROP TABLE at 14:03"). Getting fsync/synchronous_commit/wal_level right decides whether data survives crashes and whether replication and CDC are even possible.</p>`,
  useCase: `<p>An insurance company must recover any point within the last 30 days (regulatory requirement) with RPO ≤ 5 minutes. Configuration: <code>wal_level = replica</code>, <code>archive_mode = on</code>, pgBackRest as <code>archive_command</code> (<code>pgbackrest --stanza=main archive-push %p</code>) pushing compressed, encrypted WAL to object storage asynchronously, <code>archive_timeout = 60s</code>, weekly full + daily incremental backups. Monitoring alerts when <code>pg_stat_archiver.failed_count</code> increases or when the last archived segment is more than 5 minutes old.</p>`,
  internals: `<ul>
<li>The <strong>archiver</strong> process watches <code>pg_wal/archive_status/</code>: a <code>.ready</code> file marks a completed segment waiting to be archived; after success it becomes <code>.done</code>. Failures are retried indefinitely; meanwhile segments accumulate in pg_wal (disk-full risk).</li>
<li><code>archive_command</code> must return 0 only when the file is durably stored, must refuse to overwrite an existing different file, and must be idempotent; <code>cp</code> alone does not fsync — a classic hazard. <code>archive_library</code> modules (e.g. <code>basic_archive</code> contrib) avoid per-file process spawning.</li>
<li><code>pg_switch_wal()</code> forces the current segment to close (so it can be archived), e.g. at the end of a backup.</li>
<li>Durability settings are layered: fsync ensures OS caches are flushed; <code>wal_sync_method</code> selects the flush primitive (fdatasync, open_datasync...); storage must honour flushes (disable volatile write caches without battery/capacitor protection).</li>
<li>Data checksums (initdb <code>--data-checksums</code>, default since PG 18) detect storage corruption on read; with checksums, hint-bit changes are WAL-logged like <code>wal_log_hints = on</code>.</li>
</ul>`,
  whenNot: `<p><code>wal_level = minimal</code> only suits standalone servers whose backups are logical dumps and which never need replicas or PITR. Do not set <code>archive_mode = on</code> with a failing or slow archive command and no monitoring — pg_wal will fill the disk. Do not use <code>wal_level = logical</code> unless you need logical decoding (small WAL overhead, plus slot management responsibilities).</p>`,
  syntax: `# postgresql.conf
wal_level = replica                 # minimal | replica | logical   (restart)
fsync = on
synchronous_commit = on             # off | local | remote_write | on | remote_apply
full_page_writes = on
wal_compression = lz4               # off | on(pglz) | pglz | lz4 | zstd
archive_mode = on                   # restart
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'   # demo only; prefer a real tool
# archive_library = 'basic_archive' # PG 15+, alternative to archive_command
archive_timeout = 60s

SELECT * FROM pg_stat_archiver;
SELECT pg_switch_wal();`,
  examples: [
    {
      label: 'Basic',
      title: 'Audit the durability-related settings',
      sql: `SELECT name, setting, unit, context,
       CASE name
         WHEN 'fsync'              THEN 'off = corruption risk; must be on in production'
         WHEN 'synchronous_commit' THEN 'off = may lose last commits, no corruption'
         WHEN 'full_page_writes'   THEN 'torn-page protection'
         WHEN 'wal_level'          THEN 'replica needed for replicas/PITR; logical for CDC'
         WHEN 'archive_mode'       THEN 'on = continuous archiving (restart to change)'
         WHEN 'data_checksums'     THEN 'detects storage corruption'
       END AS note
FROM pg_settings
WHERE name IN ('fsync', 'synchronous_commit', 'full_page_writes', 'wal_level',
               'wal_compression', 'archive_mode', 'archive_command', 'archive_library',
               'archive_timeout', 'data_checksums', 'wal_sync_method')
ORDER BY name;`,
      explain: `<p>Run this on every server you inherit. In this playground <code>fsync = off</code> (an in-memory browser sandbox) and archiving is off; on a production server you want fsync on, full_page_writes on, wal_level replica (or logical), archive_mode on with a robust tool, and data checksums enabled. <code>context</code> = <code>postmaster</code> means a restart is required to change it.</p>`,
      output: ` name               | setting    | unit | context    | note
--------------------+------------+------+------------+---------------------------------------------------
 archive_command    | (disabled) |      | sighup     |
 archive_library    |            |      | sighup     |
 archive_mode       | off        |      | postmaster | on = continuous archiving (restart to change)
 archive_timeout    | 0          | s    | sighup     |
 data_checksums     | on         |      | internal   | detects storage corruption
 fsync              | off        |      | sighup     | off = corruption risk; must be on in production
 full_page_writes   | on         |      | sighup     | torn-page protection
 synchronous_commit | on         |      | user       | off = may lose last commits, no corruption
 wal_compression    | off        |      | superuser  |
 wal_level          | replica    |      | postmaster | replica needed for replicas/PITR; logical for CDC
 wal_sync_method    | fdatasync  |      | sighup     |`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Archiver status and segment switching',
      sql: `-- archiving health (on a real server: alert on failed_count growth and stale last_archived_time)
SELECT archived_count, last_archived_wal, last_archived_time,
       failed_count, last_failed_wal, last_failed_time
FROM pg_stat_archiver;

-- which segment is being written now, and how far into it are we?
SELECT pg_current_wal_lsn() AS lsn,
       (pg_walfile_name_offset(pg_current_wal_lsn())).file_name   AS segment,
       pg_size_pretty(((pg_walfile_name_offset(pg_current_wal_lsn())).file_offset)::bigint) AS filled;

-- force a switch: the current segment becomes complete (archivable); requires superuser
SELECT pg_switch_wal() AS switched_at;
SELECT pg_walfile_name(pg_current_wal_lsn()) AS now_writing;`,
      explain: `<p><code>pg_stat_archiver</code> is the first place to look when pg_wal grows: rising <code>failed_count</code> with a recent <code>last_failed_time</code> means the archive command is failing and segments are piling up. <code>pg_switch_wal()</code> closes the current segment early — used by backup tools at backup end and by <code>archive_timeout</code> internally — after which WAL continues in the next file. In this sandbox archive_mode is off, so nothing is archived.</p>`,
      output: ` archived_count | last_archived_wal | last_archived_time | failed_count | last_failed_wal | last_failed_time
----------------+-------------------+--------------------+--------------+-----------------+------------------
              0 |                   |                    |            0 |                 |

 lsn       | segment                  | filled
-----------+--------------------------+--------
 0/1DE11F8 | 000000010000000000000001 | 14 MB

 switched_at
-------------
 0/1DE1210

 now_writing
--------------------------
 000000010000000000000002`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Per-session wal_compression and replication-lag math with LSNs',
      sql: `-- wal_compression is superuser-settable per session (useful for a big maintenance job)
SET wal_compression = pglz;
SHOW wal_compression;
RESET wal_compression;

-- LSN math used by replication and archiving monitors:
-- how far behind is a standby that has replayed up to 0/1D00000?
SELECT pg_current_wal_lsn()                                         AS primary_lsn,
       '0/1D00000'::pg_lsn                                          AS standby_replay_lsn,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/1D00000')) AS replay_lag_bytes,
       pg_walfile_name('0/1D00000')                                 AS standby_needs_from_segment;

-- on a real primary the same comes from pg_stat_replication:
SELECT application_name, state, sent_lsn, replay_lsn,
       pg_size_pretty(pg_wal_lsn_diff(sent_lsn, replay_lsn)) AS lag
FROM pg_stat_replication;`,
      explain: `<p>Compression of full-page images can be enabled per session by a superuser, e.g. for a maintenance window that rewrites many pages (<code>lz4</code>/<code>zstd</code> are available only if PostgreSQL was built with them; this build supports <code>pglz</code>). The LSN arithmetic pattern — <code>pg_wal_lsn_diff(primary_lsn, standby_lsn)</code> — is exactly how replication lag in bytes is measured; <code>pg_walfile_name</code> tells you which archived segment a lagging standby or restore would need next. <code>pg_stat_replication</code> is empty here (no standbys).</p>`,
      output: ` wal_compression
-----------------
 pglz

 primary_lsn | standby_replay_lsn | replay_lag_bytes | standby_needs_from_segment
-------------+--------------------+------------------+----------------------------
 0/1DC73B8   | 0/1D00000          | 797 kB           | 000000010000000000000001

 application_name | state | sent_lsn | replay_lsn | lag
------------------+-------+----------+------------+-----
(0 rows)`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- archive_command that "works" but is unsafe (shown as text; not runnable here)
SELECT 'archive_command = ''cp %p /mnt/archive/%f''' AS unsafe_config,
       'cp does not fsync, silently overwrites existing files and an NFS hiccup may leave a partial file reported as success' AS why;`,
      why: 'A plain cp may report success before data is durable and overwrites files, so a later PITR can fail with missing or corrupt segments.',
      run: true
    },
    good: {
      sql: `SELECT 'archive_command = ''pgbackrest --stanza=main archive-push %p''' AS robust_config,
       'checksums, compression, encryption, async parallel push, verifies and never overwrites differing files' AS why;`,
      why: 'Use a purpose-built tool (pgBackRest, Barman, WAL-G) or a carefully written archive_library module that fsyncs and refuses overwrites.',
      run: true
    }
  },
  mistakes: [
    'Setting <code>fsync = off</code> in production "for performance" — use <code>synchronous_commit = off</code> where loss is tolerable instead.',
    'Enabling archive_mode without monitoring; a broken archive command silently fills pg_wal until the server stops.',
    'Using <code>cp</code> or <code>rsync</code> without fsync and overwrite checks as archive_command.',
    'Running with <code>wal_level = minimal</code> and then discovering you cannot add a replica or do PITR without a restart.',
    'Never testing restores from the archive (see the PITR lesson).'
  ],
  best: [
    'Production baseline: fsync on, full_page_writes on, data checksums on, wal_level replica (logical if CDC), archive via pgBackRest/Barman/WAL-G.',
    'Set <code>archive_timeout</code> (e.g. 60 s) on low-traffic systems to bound RPO.',
    'Alert on <code>pg_stat_archiver.failed_count</code> increases and on <code>now() - last_archived_time</code>.',
    'Keep archived WAL for at least as long as your oldest backup you intend to restore from.',
    'Use <code>synchronous_commit</code> per transaction rather than globally.'
  ],
  performance: `<p>Archiving adds read I/O of each completed segment and network transfer; asynchronous, parallel tools keep up with hundreds of MB/s. <code>wal_compression</code> trades CPU for fewer WAL bytes (often 30–50% less with lz4/zstd on FPI-heavy workloads). <code>wal_level = logical</code> adds a few percent WAL. fsync cost is dominated by storage latency — use enterprise SSDs with power-loss protection.</p>`,
  security: `<p>Archived WAL contains all data changes: encrypt it in transit and at rest, restrict access to the archive repository, and apply retention policies. <code>archive_command</code> runs as the OS user owning PostgreSQL — keep it simple and controlled. Changing these settings requires superuser.</p>`,
  scenario: {
    title: 'pg_wal grew to 400 GB overnight',
    steps: [
      '1. du shows pg_wal huge; pg_replication_slots is clean.',
      '2. pg_stat_archiver: failed_count increasing every minute, last_failed_wal 00000001000003A2000000F1.',
      '3. Server log: archive command failed with exit code 1 — "permission denied" on the object-storage credentials (rotated yesterday).',
      '4. Fix credentials; the archiver retries and catches up automatically (watch archived_count rise and .ready files disappear).',
      '5. Do NOT delete WAL files manually — that would break the archive chain and future PITR.',
      '6. Add alerts: failed_count delta &gt; 0 for 5 min, and pg_wal size &gt; 30% of disk; take a fresh base backup if any segment was lost.'
    ]
  },
  widgets: ['diagram:wal', 'diagram:backup-pitr', 'diagram:streaming-replication'],
  interview: [
    { q: 'What is the difference between fsync = off and synchronous_commit = off?', a: 'fsync = off stops PostgreSQL from forcing data and WAL to stable storage at all; after an OS crash or power loss the cluster can be corrupted. synchronous_commit = off only lets COMMIT return before its WAL is flushed; a crash may lose the most recent commits, but the database stays consistent. The latter can be set per transaction.' },
    { q: 'What does each wal_level allow?', a: 'minimal: crash recovery only, with WAL skipping for some bulk operations. replica (default): adds information for WAL archiving, physical streaming replication, hot standby and PITR. logical: additionally supports logical decoding (logical replication, CDC).' },
    { q: 'How does continuous archiving work?', a: 'With archive_mode = on, the archiver process passes each completed WAL segment to archive_command or archive_library and marks it done on success. Segments are not recycled until archived. Combined with a base backup, the archived WAL allows restoring to any point after the backup.' },
    { q: 'What happens if archive_command keeps failing?', a: 'The archiver retries forever, WAL segments are retained in pg_wal, and disk usage grows until the disk fills and the server stops. Monitor pg_stat_archiver.failed_count and last_archived_time and fix the cause promptly.' }
  ],
  exercises: [
    {
      task: 'Write a monitoring query that returns how long ago the last WAL segment was archived and how many failures occurred (NULL when nothing archived yet).',
      solution: `SELECT now() - last_archived_time AS since_last_archive,
       failed_count,
       last_failed_wal
FROM pg_stat_archiver;`,
      run: true
    },
    {
      task: 'Show the current WAL segment name, then force a segment switch and show the new segment name.',
      solution: `SELECT pg_walfile_name(pg_current_wal_lsn()) AS before_switch;
SELECT pg_switch_wal();
SELECT pg_walfile_name(pg_current_wal_lsn()) AS after_switch;`,
      run: true
    }
  ],
  challenge: {
    task: 'Given an RPO requirement, compute the maximum WAL that could be lost: if archive_timeout = 60s and the system writes 2 MB/s of WAL, how many segments are produced per minute and what is the worst-case data loss window? Express it as a query.',
    hint: 'A segment is archived when it is full (16 MB) or when archive_timeout forces a switch, whichever comes first.',
    solution: `WITH p AS (SELECT 2.0 AS mb_per_s, 60 AS archive_timeout_s, 16 AS seg_mb)
SELECT round(seg_mb / mb_per_s, 1)                         AS seconds_to_fill_segment,
       round(least(seg_mb / mb_per_s, archive_timeout_s), 1) AS worst_case_seconds_not_archived,
       round(60 * mb_per_s / seg_mb, 1)                    AS segments_per_minute,
       pg_size_pretty((least(seg_mb / mb_per_s, archive_timeout_s) * mb_per_s * 1024 * 1024)::bigint) AS max_unarchived_wal
FROM p;`,
    run: true
  },
  related: ['wal-fundamentals', 'wal-checkpoints', 'backup-restore-pitr', 'transaction-internals-2pc-sync-commit', 'replication'],
  quiz: [
    { type: 'mcq', q: 'Which wal_level is required for logical replication?', options: ['minimal', 'replica', 'logical', 'archive'], answer: 2, explain: 'Logical decoding needs wal_level = logical.' },
    { type: 'tf', q: 'If archive_command fails, PostgreSQL deletes the unarchived WAL segment to avoid filling the disk.', answer: false, explain: 'It retains the segment and retries indefinitely; pg_wal grows.' },
    { type: 'mcq', q: 'Which setting can corrupt your database after a power failure if turned off?', options: ['synchronous_commit', 'fsync', 'archive_mode', 'wal_compression'], answer: 1, explain: 'fsync = off risks corruption; synchronous_commit = off only risks losing recent commits.' },
    { type: 'scenario', q: 'A low-traffic system writes 16 MB of WAL per 3 hours. Business requires RPO ≤ 5 minutes. What setting is key?', options: ['max_wal_size = 64MB', 'archive_timeout = 5min (or less), or streaming WAL with pg_receivewal', 'checkpoint_timeout = 5min', 'wal_level = logical'], answer: 1, explain: 'Without a forced switch, a segment could take 3 hours to fill and be archived.' }
  ]
}
]);

PGM.addLessons([
/* ===================================================================
   MODULE: backup-restore
   =================================================================== */
{
  id: 'backup-restore-logical-pg-dump',
  module: 'backup-restore',
  title: 'Logical Backups: pg_dump Formats, pg_dumpall and pg_restore',
  level: 4,
  minutes: 25,
  summary: 'Take consistent logical backups with pg_dump (plain, custom, directory with parallel jobs, tar), capture roles and tablespaces with pg_dumpall --globals-only, and restore selectively and in parallel with pg_restore.',
  objectives: [
    'Explain how pg_dump obtains a consistent snapshot without blocking writers',
    'Choose between plain, custom (-Fc), directory (-Fd, with -j) and tar formats',
    'Back up globals (roles, tablespaces) with pg_dumpall --globals-only',
    'Restore selectively (-t, -n, -L lists) and in parallel with pg_restore -j, using --clean/--if-exists safely',
    'Know the limits of logical backups (RPO, size, restore time) versus physical backups'
  ],
  concept: `<p>A <strong>logical backup</strong> exports the database as SQL definitions plus data (COPY blocks), independent of the on-disk format. <code>pg_dump</code> <span class="tag core">core client tool</span> dumps <em>one database</em>; <code>pg_dumpall</code> dumps the whole cluster, including <strong>globals</strong> — roles, role memberships, tablespaces — which pg_dump never includes.</p>
<p>pg_dump opens a transaction at <code>REPEATABLE READ</code> (or <code>SERIALIZABLE READ ONLY DEFERRABLE</code> with <code>--serializable-deferrable</code>) so the whole dump reflects one snapshot, while normal reads and writes continue. It takes <code>ACCESS SHARE</code> locks on dumped tables, which only conflict with DDL such as ALTER/DROP TABLE.</p>
<table>
<tr><th>Format</th><th>Flag</th><th>Restore with</th><th>Parallel dump</th><th>Parallel / selective restore</th></tr>
<tr><td>Plain SQL</td><td><code>-Fp</code> (default)</td><td>psql</td><td>no</td><td>no (edit the file)</td></tr>
<tr><td>Custom</td><td><code>-Fc</code></td><td>pg_restore</td><td>no</td><td>yes (<code>-j</code>, <code>-t</code>, <code>-L</code>)</td></tr>
<tr><td>Directory</td><td><code>-Fd</code></td><td>pg_restore</td><td><strong>yes</strong> (<code>-j N</code>)</td><td>yes</td></tr>
<tr><td>Tar</td><td><code>-Ft</code></td><td>pg_restore</td><td>no</td><td>selective, not parallel</td></tr>
</table>
<p>Custom and directory formats are compressed by default and let <code>pg_restore</code> pick objects, reorder them and run in parallel. Analogy: plain format is a printed book — you can only re-type it from the start; custom/directory formats are a box of labelled index cards — you can pull out just the cards you need and have several people re-type them simultaneously.</p>`,
  why: `<p>Logical backups are portable across major versions and architectures, can restore a single table or schema, and are the basis of many upgrades and migrations. They are, however, slow to restore for large databases (indexes must be rebuilt), and they only capture the moment of the dump (no point-in-time recovery). Every DBA needs them alongside physical backups.</p>`,
  useCase: `<p>A SaaS company with a 220 GB database takes nightly <code>pg_dump -Fd -j 8 -Z zstd:3</code> from a replica (40 minutes) in addition to pgBackRest physical backups. When a customer asked to restore one accidentally truncated tenant table from 3 days ago, the DBA ran <code>pg_restore -l</code>, filtered the TOC to the single table, and restored it into a scratch schema in 4 minutes — no full-cluster restore needed. During a PostgreSQL 14 → 17 migration of a small reporting database, <code>pg_dump | pg_restore -j</code> was simpler than <code>pg_upgrade</code>.</p>`,
  internals: `<ul>
<li>pg_dump reads the catalogs to build a table of contents (TOC) of objects with dependencies, then dumps schema (pre-data: types, tables), data (one <code>COPY ... TO STDOUT</code> per table) and post-data (indexes, constraints, triggers) in dependency order.</li>
<li>With <code>-j N</code> (directory format), the leader exports its snapshot (<code>pg_export_snapshot()</code>) and N worker connections import it with <code>SET TRANSACTION SNAPSHOT</code>, so all workers see identical data.</li>
<li>pg_restore runs pre-data, then data (parallel per table), then post-data (index builds and constraints in parallel) — index builds dominate restore time on big databases.</li>
<li>Large objects, sequences' current values, comments, privileges and ownership are included; roles and tablespaces are not (use <code>pg_dumpall --globals-only</code>).</li>
<li>Use the pg_dump version matching the <em>newest</em> server involved (newer pg_dump can dump older servers).</li>
</ul>`,
  whenNot: `<p>Logical dumps alone are insufficient for large or critical systems: restore time grows with data and index volume (hours to days for TBs), and RPO equals the time since the last dump. Use physical backups + WAL archiving (pgBackRest, Barman, pg_basebackup) for disaster recovery and PITR; keep logical dumps for portability, selective restores and upgrades.</p>`,
  syntax: `# shell (not SQL)
pg_dump -h db1 -U backup -d company_db -Fc -f company_db.dump
pg_dump -d company_db -Fd -j 8 -f /backups/company_db.dir        # parallel, directory format
pg_dump -d company_db -t 'public.orders*' -Fc -f orders.dump      # selected tables
pg_dump -d company_db --schema-only -f schema.sql
pg_dumpall --globals-only -f globals.sql                           # roles + tablespaces

pg_restore -d company_db_restore -j 8 /backups/company_db.dir
pg_restore -l company_db.dump > toc.list      # edit list, then:
pg_restore -L toc.list -d target company_db.dump
pg_restore --clean --if-exists -d target -t orders company_db.dump`,
  examples: [
    {
      label: 'Basic',
      title: 'Nightly dump and globals (shell)',
      sql: `# 1) cluster-wide objects that pg_dump never includes
pg_dumpall -h db-replica -U backup --globals-only -f /backups/2025-10-10/globals.sql

# 2) the database, custom format (compressed, selective restore possible)
pg_dump -h db-replica -U backup -d company_db \\
        -Fc -Z 6 \\
        --no-owner --no-privileges \\
        -f /backups/2025-10-10/company_db.dump

# 3) verify the archive is readable and see what is inside
pg_restore -l /backups/2025-10-10/company_db.dump | head`,
      explain: `<p><code>--globals-only</code> captures roles, memberships and tablespaces (without them, restored GRANTs would fail on a fresh cluster). <code>-Fc</code> produces a compressed archive for <code>pg_restore</code>. <code>--no-owner --no-privileges</code> is useful when restoring into a different environment where roles differ; omit them for faithful restores. Listing the TOC with <code>pg_restore -l</code> is a cheap sanity check that the file is complete. These are shell commands, not SQL — they cannot run in the browser playground.</p>`,
      output: `;
; Archive created at 2025-10-10 01:00:04 IST
;     dbname: company_db
;     TOC Entries: 162
;     Compression: gzip
;     Dump Version: 1.16-0
;     Format: CUSTOM
...
215; 1259 16385 TABLE public departments postgres
218; 1259 16402 TABLE public employees postgres`,
      run: false
    },
    {
      label: 'Intermediate',
      title: 'How pg_dump stays consistent: exported snapshots',
      sql: `-- This is what pg_dump's leader connection does at start:
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snapshot_id;      -- workers run SET TRANSACTION SNAPSHOT '<id>'
SELECT count(*) AS orders_in_snapshot FROM orders;
-- ... COPY orders TO STDOUT; COPY customers TO STDOUT; ... all from the same snapshot
COMMIT;

-- the lock a dump holds on each table: ACCESS SHARE (blocks only DDL)
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
LOCK TABLE orders IN ACCESS SHARE MODE;
SELECT relation::regclass, mode FROM pg_locks
WHERE pid = pg_backend_pid() AND relation = 'orders'::regclass;
COMMIT;`,
      explain: `<p>The leader takes a REPEATABLE READ snapshot and exports it; with <code>-j</code>, every worker imports the same snapshot ID, so a parallel dump is as consistent as a serial one. Each table is locked in ACCESS SHARE mode for the dump's duration: concurrent INSERT/UPDATE/DELETE proceed, but an <code>ALTER TABLE</code> would wait — and, through the lock queue, block others. Schedule DDL deployments away from dump windows (or dump from a replica). The snapshot ID format varies.</p>`,
      output: ` snapshot_id
---------------------
 00000003-00000010-1

 orders_in_snapshot
--------------------
               5000

 relation | mode
----------+-----------------
 orders   | AccessShareLock`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Parallel dump and a selective, parallel restore (shell)',
      sql: `# Parallel dump (directory format is required for -j); zstd compression (PG 16+ client)
pg_dump -d company_db -Fd -j 8 -Z zstd:3 -f /backups/company_db.dir

# Restore ONE table from last night into a scratch database, in parallel
createdb restore_scratch
pg_restore -d restore_scratch -j 4 --no-owner \\
           -t orders -t order_items \\
           /backups/company_db.dir

# Or: edit the table of contents for full control
pg_restore -l /backups/company_db.dir > toc.list
#   (comment out unwanted lines with ';' in toc.list)
pg_restore -d restore_scratch -L toc.list -j 4 /backups/company_db.dir

# Replace objects in an existing database (drops before create)
pg_restore -d company_db --clean --if-exists -t products /backups/company_db.dir`,
      explain: `<p><code>-Fd -j 8</code> dumps 8 tables at a time (one file per table in the directory). <code>-t</code> in pg_restore selects tables (data and definition, but not their indexes/constraints unless you include them via a TOC list). <code>-L</code> with an edited TOC gives exact control, e.g. restore table data and its indexes but skip triggers. <code>--clean --if-exists</code> drops objects before recreating them — dangerous on production targets; prefer restoring into a scratch database and copying rows back with INSERT ... SELECT.</p>`,
      output: `$ ls /backups/company_db.dir
3341.dat.zst  3342.dat.zst  3343.dat.zst ...  toc.dat
$ pg_restore ... -t orders -t order_items
(no output on success; check with: psql -d restore_scratch -c "SELECT count(*) FROM orders")`,
      run: false
    }
  ],
  compare: {
    bad: {
      sql: `# Plain-format dump of a 500 GB database, single-threaded, restored with psql
pg_dump -d bigdb -f bigdb.sql
psql -d newdb -f bigdb.sql`,
      why: 'Plain SQL cannot be restored in parallel or selectively; on large databases restore takes many hours, and one error mid-file is hard to resume from.',
      run: false
    },
    good: {
      sql: `pg_dumpall --globals-only -f globals.sql
pg_dump -d bigdb -Fd -j 8 -f bigdb.dir
psql -d postgres -f globals.sql
pg_restore -d newdb -j 8 --exit-on-error bigdb.dir`,
      why: 'Directory format dumps and restores in parallel (including index builds), supports selective restore, and globals are captured separately.',
      run: false
    }
  },
  mistakes: [
    'Forgetting <code>pg_dumpall --globals-only</code>: roles and grants are missing on restore.',
    'Using plain format for large databases, making parallel and selective restore impossible.',
    'Treating nightly dumps as the only backup — no PITR, RPO of up to 24 h, very long restore times.',
    'Running pg_dump during DDL-heavy deploys: ACCESS SHARE locks plus queued ALTERs can stall the application.',
    'Never test-restoring the dumps; corrupted or incomplete archives are discovered during the incident.'
  ],
  best: [
    'Use <code>-Fd -j N</code> (or <code>-Fc</code>) and restore with <code>pg_restore -j N</code>.',
    'Dump from a replica to keep load off the primary (beware of long-query conflicts on hot standbys).',
    'Always back up globals alongside database dumps.',
    'Automate weekly test restores into a scratch instance and run sanity queries.',
    'Combine logical dumps (portability, selective restore) with physical backups + WAL archiving (PITR).'
  ],
  performance: `<p>pg_dump speed is limited by reading tables and compressing (use <code>-j</code> and fast compression like zstd/lz4). Restore time is dominated by data loading and especially index and constraint builds; increase <code>maintenance_work_mem</code> on the target, use <code>-j</code>, and consider temporarily relaxed durability (e.g. <code>synchronous_commit = off</code>) on a dedicated restore server. A long-running dump holds a snapshot that delays VACUUM on the source.</p>`,
  security: `<p>Dumps contain all data in readable form: encrypt them at rest, restrict access, and avoid putting passwords on command lines (use <code>.pgpass</code> or environment-based auth). Use a dedicated backup role with the predefined role <code>pg_read_all_data</code> (PG 14+) rather than a superuser. <code>pg_dumpall --globals-only</code> includes password hashes — protect it accordingly (or use <code>--no-role-passwords</code>).</p>`,
  scenario: {
    title: 'Restore one tenant\'s table from 3 days ago without touching production',
    steps: [
      '1. Identify the right dump (nightly -Fd from 3 days ago) and confirm it with pg_restore -l.',
      '2. Create a scratch database on a non-production server; restore globals if needed.',
      '3. pg_restore -d scratch -j 4 -t customer_notes --no-owner /backups/2025-10-07/company_db.dir.',
      '4. Extract the tenant\'s rows: SELECT ... WHERE tenant_id = 42 into a CSV with COPY (see next lesson).',
      '5. Load them into production inside a transaction, using INSERT ... ON CONFLICT DO NOTHING; verify counts.',
      '6. Record the incident and add a test-restore step for single-table restores to the runbook.'
    ]
  },
  widgets: ['diagram:backup-pitr'],
  interview: [
    { q: 'How does pg_dump produce a consistent backup while the database is being modified?', a: 'It runs inside a single REPEATABLE READ (or SERIALIZABLE READ ONLY DEFERRABLE) transaction, so every table is read from one MVCC snapshot. Parallel dumps export that snapshot and the workers import it with SET TRANSACTION SNAPSHOT. It holds ACCESS SHARE locks, which block only conflicting DDL.' },
    { q: 'Which pg_dump formats support parallelism?', a: 'Only the directory format (-Fd) supports parallel dumping with -j. pg_restore can restore custom (-Fc) and directory archives in parallel with -j. Plain format is restored with psql serially.' },
    { q: 'What does pg_dumpall --globals-only capture and why is it needed?', a: 'Cluster-wide objects that pg_dump does not include: roles (with password hashes and attributes), role memberships and tablespaces. Without them, restoring ownership and GRANTs on a new cluster fails.' },
    { q: 'What are the limitations of logical backups for disaster recovery?', a: 'They capture a single point in time (RPO = time since the dump), restoring large databases is slow because all data must be reloaded and all indexes rebuilt, and they cannot replay changes made after the dump. Physical backups plus WAL archiving provide point-in-time recovery and faster restores.' }
  ],
  exercises: [
    {
      task: 'Estimate how big a dump will be: list the 5 largest tables with total size, and the database size.',
      solution: `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 5;
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;`,
      run: true
    },
    {
      task: 'Write the shell commands to dump only the schema of company_db and, separately, only the data of the orders table in custom format.',
      solution: `pg_dump -d company_db --schema-only -f company_db_schema.sql
pg_dump -d company_db --data-only -t public.orders -Fc -f orders_data.dump`,
      run: false
    }
  ],
  challenge: {
    task: 'pg_dump does not dump roles. Write a SQL query that lists every non-system role with its key attributes and the roles it is a member of — the information pg_dumpall --globals-only would preserve.',
    hint: 'pg_roles for attributes; pg_auth_members joined twice to pg_roles for memberships; exclude names starting with pg_.',
    solution: `SELECT r.rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication,
       coalesce(string_agg(g.rolname, ', ' ORDER BY g.rolname), '') AS member_of
FROM pg_roles r
LEFT JOIN pg_auth_members m ON m.member = r.oid
LEFT JOIN pg_roles g ON g.oid = m.roleid
WHERE r.rolname NOT LIKE 'pg\\_%'
GROUP BY r.rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication
ORDER BY r.rolname;`,
    run: true
  },
  related: ['backup-restore-copy', 'backup-restore-physical', 'backup-restore-pitr', 'isolation-levels-rc-rr'],
  quiz: [
    { type: 'mcq', q: 'Which format must you use for a parallel pg_dump (-j)?', options: ['Plain', 'Custom', 'Directory', 'Tar'], answer: 2, explain: 'Only the directory format supports parallel dumps.' },
    { type: 'tf', q: 'pg_dump includes role definitions and passwords.', answer: false, explain: 'Roles are cluster-wide globals; use pg_dumpall --globals-only.' },
    { type: 'mcq', q: 'Which lock does pg_dump hold on each dumped table?', options: ['ACCESS EXCLUSIVE', 'SHARE', 'ACCESS SHARE', 'None'], answer: 2, explain: 'ACCESS SHARE: blocks only DDL like ALTER/DROP TABLE.' },
    { type: 'scenario', q: 'You need yesterday\'s version of one table from a nightly -Fc dump. Best approach?', options: ['Restore the whole dump over production', 'pg_restore -t that_table into a scratch database, then copy the needed rows', 'PITR the production cluster to yesterday', 'Re-run pg_dump'], answer: 1, explain: 'Selective restore into a scratch DB is safe and fast.' }
  ]
},
{
  id: 'backup-restore-copy',
  module: 'backup-restore',
  title: 'COPY and \\copy: Fast CSV Export and Import',
  level: 4,
  minutes: 22,
  summary: 'Move data in and out of PostgreSQL at full speed with COPY (server side) and psql\'s \\copy (client side): CSV options, COPY (query) TO, COPY FROM STDIN, error handling with ON_ERROR, FREEZE, and bulk-load tuning.',
  objectives: [
    'Distinguish server-side COPY (files on the DB server, privileges) from client-side \\copy and COPY ... STDIN/STDOUT',
    'Export query results as CSV with headers using COPY (SELECT ...) TO',
    'Import CSV with column lists, WHERE filters and ON_ERROR ignore (PG 17+)',
    'Apply bulk-load performance techniques (drop/recreate indexes, FREEZE, UNLOGGED staging, batching)',
    'Avoid common CSV pitfalls (NULL vs empty, encodings, delimiters, headers)'
  ],
  concept: `<p><code>COPY</code> <span class="tag core">core</span> streams rows between a table (or query) and a file or the client connection in bulk, bypassing per-statement overhead. It is typically 5–20× faster than equivalent INSERT statements.</p>
<ul>
<li><strong>Server-side</strong>: <code>COPY t TO '/path/file.csv'</code> / <code>COPY t FROM '/path/file.csv'</code> reads/writes files <em>on the database server</em> as the PostgreSQL OS user. Requires superuser or the roles <code>pg_read_server_files</code> / <code>pg_write_server_files</code> (or <code>pg_execute_server_program</code> for <code>PROGRAM</code>).</li>
<li><strong>Client-side</strong>: <code>COPY ... TO STDOUT</code> / <code>FROM STDIN</code> streams through the connection; drivers expose it (psycopg <code>copy()</code>, JDBC <code>CopyManager</code>, Node pg-copy-streams). psql's <code>\\copy</code> meta-command wraps this so files on <em>your</em> machine are read/written with normal privileges.</li>
</ul>
<p>Options: <code>FORMAT csv | text | binary</code>, <code>HEADER</code> (PG 15+: <code>HEADER MATCH</code> to validate column names on import), <code>DELIMITER</code>, <code>NULL</code>, <code>QUOTE</code>, <code>ESCAPE</code>, <code>FORCE_QUOTE</code>, <code>FORCE_NOT_NULL</code>, <code>FORCE_NULL</code>, <code>ENCODING</code>, <code>FREEZE</code>, and in PG 17+ <code>ON_ERROR ignore</code> with <code>LOG_VERBOSITY</code>; PG 18 adds <code>REJECT_LIMIT</code>. <code>COPY FROM</code> also accepts a <code>WHERE</code> clause (PG 12+).</p>
<p>Analogy: INSERT is carrying groceries in one bag per trip; COPY is backing a truck up to the door.</p>`,
  why: `<p>Data exchange with other systems (data warehouses, spreadsheets, ETL), table-level backups, migrations and seeding test environments all need fast bulk movement. COPY is the standard, most efficient path in and out of PostgreSQL, used internally by pg_dump/pg_restore and logical replication's initial sync.</p>`,
  useCase: `<p>A logistics firm loads 40M GPS rows (6 GB CSV) every night. The original loader issued batched INSERTs (2 h). Switching to <code>COPY gps_staging FROM STDIN (FORMAT csv)</code> via the driver into an UNLOGGED staging table, then <code>INSERT INTO gps SELECT ... ON CONFLICT DO NOTHING</code> into the partitioned target, took 11 minutes. A malformed-row problem from one vendor is handled with <code>ON_ERROR ignore, LOG_VERBOSITY verbose</code> (PG 17), and skipped rows are reported to the vendor.</p>`,
  internals: `<ul>
<li>COPY FROM uses multi-insert batching (heap_multi_insert): tuples are buffered and written page by page, with one WAL record per batch where possible, and index entries inserted per row.</li>
<li>Triggers, constraints and defaults still apply (per row). Foreign keys are checked by triggers — dropping/re-adding FKs during huge loads speeds them up.</li>
<li><code>FREEZE</code>: if the table was created or truncated in the same transaction, rows are written already frozen and all-visible (no later hint-bit and freeze writes). Not allowed otherwise.</li>
<li>With <code>wal_level = minimal</code>, COPY into a table created/truncated in the same transaction skips WAL for the data entirely (the table is fsynced at commit instead).</li>
<li>COPY TO from a query (<code>COPY (SELECT ...) TO</code>) runs the query with a normal snapshot; <code>COPY t TO</code> on a partitioned table is not allowed — use <code>COPY (SELECT * FROM t) TO</code>.</li>
</ul>`,
  whenNot: `<p>Do not use COPY for small, transactional, row-by-row application writes — normal INSERTs (or multi-row INSERTs) are simpler and integrate with ORMs. Do not give application roles <code>pg_read_server_files</code>/<code>pg_write_server_files</code>: server-side file access is a privilege escalation vector — stream through STDIN/STDOUT instead.</p>`,
  syntax: `COPY table [ ( column [, ...] ) ] FROM { 'file' | PROGRAM 'cmd' | STDIN }
     [ [ WITH ] ( option [, ...] ) ] [ WHERE condition ];
COPY { table [ ( column [, ...] ) ] | ( query ) } TO { 'file' | PROGRAM 'cmd' | STDOUT }
     [ [ WITH ] ( option [, ...] ) ];
-- options: FORMAT csv|text|binary, HEADER [MATCH], DELIMITER ',', NULL '', QUOTE '"',
--          FORCE_QUOTE (cols) | *, FORCE_NOT_NULL (cols), FORCE_NULL (cols), ENCODING 'UTF8',
--          FREEZE, ON_ERROR stop|ignore (PG17), LOG_VERBOSITY default|verbose|silent, REJECT_LIMIT n (PG18)

-- psql client-side
\\copy orders TO 'orders.csv' WITH (FORMAT csv, HEADER)
\\copy staging FROM 'data.csv' WITH (FORMAT csv, HEADER)`,
  examples: [
    {
      label: 'Basic',
      title: 'Export a query as CSV with COPY ... TO STDOUT',
      sql: `COPY (
  SELECT o.id, c.name AS customer, o.status, o.order_date::date AS order_day, o.total_amount
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.order_date >= '2025-09-25'
  ORDER BY o.id
  LIMIT 5
) TO STDOUT WITH (FORMAT csv, HEADER, FORCE_QUOTE (customer));`,
      explain: `<p><code>COPY (query) TO STDOUT</code> streams CSV over the connection — this is what <code>\\copy ... TO 'file'</code> in psql and drivers' copy APIs use, and it needs no file privileges on the server. <code>HEADER</code> writes column names; <code>FORCE_QUOTE (customer)</code> quotes that column even when not necessary (useful for spreadsheet tools). In the playground the command succeeds; the CSV text is streamed to the client rather than shown as a result table, so your runner may display only "COPY 5".</p>`,
      output: `id,customer,status,order_day,total_amount
...,"Customer ...",paid,2025-09-25,...
(5 data rows)
COPY 5`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Round trip through a server-side file, with a WHERE filter on import',
      sql: `-- export (server-side file: needs superuser or pg_write_server_files)
COPY departments (id, name, location) TO '/tmp/departments.csv' WITH (FORMAT csv, HEADER);

-- import into a staging table, only rows matching a condition (PG 12+)
CREATE TEMP TABLE dept_staging (id int, name text, location text);
COPY dept_staging FROM '/tmp/departments.csv' WITH (FORMAT csv, HEADER)
WHERE location IN ('Bengaluru', 'Mumbai', 'Pune');

SELECT * FROM dept_staging ORDER BY id;`,
      explain: `<p>The export writes a CSV file on the <em>database server's</em> filesystem (here the in-browser virtual filesystem). The import reads it back, applying <code>WHERE</code> to each parsed row before insertion — handy for loading a subset without a staging step. In production you would rarely have access to server files; use <code>\\copy</code> or a driver with <code>FROM STDIN</code> instead.</p>`,
      output: ` id | name        | location
----+-------------+-----------
  1 | Engineering | Bengaluru
  2 | Sales       | Mumbai
  5 | HR          | Pune
  8 | Research    | Bengaluru
(4 rows)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Tolerating bad rows with ON_ERROR ignore (PG 17+) and fast loads with FREEZE',
      sql: `-- a CSV with one malformed row ("abc" is not an integer)
COPY (SELECT 'id,qty' UNION ALL SELECT '1,5' UNION ALL SELECT '2,abc' UNION ALL SELECT '3,7')
  TO '/tmp/stock_update.csv';

CREATE TEMP TABLE stock_update (id int, qty int);
COPY stock_update FROM '/tmp/stock_update.csv'
  WITH (FORMAT csv, HEADER, ON_ERROR ignore, LOG_VERBOSITY verbose);
SELECT * FROM stock_update ORDER BY id;

-- FREEZE: table created in the same transaction -> rows written frozen + all-visible
BEGIN;
CREATE TABLE stock_snapshot (id int, qty int);
COPY stock_snapshot FROM '/tmp/stock_update.csv' WITH (FORMAT csv, HEADER, ON_ERROR ignore, FREEZE);
COMMIT;
SELECT count(*) AS loaded FROM stock_snapshot;
DROP TABLE stock_snapshot;`,
      explain: `<p>Without <code>ON_ERROR ignore</code> the whole COPY would fail on line 3 and load nothing. With it, rows that fail data-type conversion are skipped; <code>LOG_VERBOSITY verbose</code> emits a NOTICE per skipped row (line number and column), and a summary NOTICE reports how many were skipped. PG 18's <code>REJECT_LIMIT n</code> aborts if more than n rows are bad. (Constraint violations are still errors — ON_ERROR covers input conversion only.) <code>FREEZE</code> works only because the table was created in the same transaction; it saves the later hint-bit and freezing writes for big one-off loads.</p>`,
      output: `NOTICE:  skipping row due to data type incompatibility at line 3 for column "qty": "abc"
NOTICE:  1 row was skipped due to data type incompatibility

 id | qty
----+-----
  1 |   5
  3 |   7

 loaded
--------
      2`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `-- Row-by-row inserts for a bulk load (one statement, one round trip, one WAL record per row)
CREATE TABLE load_t (id int, payload text);
INSERT INTO load_t VALUES (1, 'row 1');
INSERT INTO load_t VALUES (2, 'row 2');
INSERT INTO load_t VALUES (3, 'row 3');
-- ... imagine 10 million more`,
      why: 'Each INSERT has parse/plan/execute and network overhead and, in autocommit, its own commit fsync. Bulk loads this way are 10–50× slower than COPY.',
      run: true
    },
    good: {
      sql: `-- Bulk path: COPY into the table (here from a generated file standing in for the source)
COPY (SELECT g, 'row ' || g FROM generate_series(1, 10000) g) TO '/tmp/load.csv' WITH (FORMAT csv);
CREATE TABLE load_t (id int, payload text);
COPY load_t FROM '/tmp/load.csv' WITH (FORMAT csv);
SELECT count(*) FROM load_t;`,
      why: 'COPY batches rows into pages with minimal per-row overhead and a single statement; it is the fastest way to load data.',
      run: true
    }
  },
  mistakes: [
    'Using server-side <code>COPY ... FROM \'/home/me/file.csv\'</code> expecting it to read the client machine\'s file — use <code>\\copy</code> or STDIN.',
    'Confusing empty strings and NULLs in CSV: by default an unquoted empty field is NULL, a quoted empty string <code>""</code> is an empty string.',
    'Loading into a table with many indexes and foreign keys row by row instead of dropping/recreating secondary indexes for huge initial loads.',
    'Granting <code>pg_write_server_files</code> to application roles.',
    'Trying <code>COPY partitioned_table TO</code> — use <code>COPY (SELECT * FROM partitioned_table) TO</code>.'
  ],
  best: [
    'For large loads: COPY into an UNLOGGED (or temp) staging table, validate/transform with SQL, then INSERT ... SELECT into the target.',
    'Create secondary indexes after the initial bulk load; raise <code>maintenance_work_mem</code> for the index builds.',
    'Use <code>FREEZE</code> for tables created/truncated in the loading transaction, then ANALYZE.',
    'Use <code>HEADER MATCH</code> (PG 15+) to catch column-order mismatches early.',
    'Use <code>ON_ERROR ignore</code> + <code>LOG_VERBOSITY verbose</code> (PG 17+) when partial loads are acceptable, and report rejects.'
  ],
  performance: `<p>COPY throughput is usually limited by index maintenance, triggers/FK checks, WAL volume and CPU for parsing (binary format parses faster but is less portable). Run several COPY streams in parallel into different partitions/tables for more throughput. Consider <code>synchronous_commit = off</code> for the loading session, and checkpoint/<code>max_wal_size</code> settings that avoid checkpoint storms during loads.</p>`,
  security: `<p>Server-side COPY can read and write any file the PostgreSQL OS user can access and <code>COPY ... PROGRAM</code> executes shell commands — both are effectively superuser powers. Restrict <code>pg_read_server_files</code>, <code>pg_write_server_files</code> and <code>pg_execute_server_program</code>. Exported CSVs often contain personal data: protect and expire them.</p>`,
  scenario: {
    title: 'Nightly import takes 2 hours and occasionally fails on bad vendor rows',
    steps: [
      '1. Profile: 40M rows via batched INSERTs (1,000 per statement) into a table with 6 indexes and 2 FKs.',
      '2. Switch the loader to COPY ... FROM STDIN (FORMAT csv) into an UNLOGGED staging table with no indexes.',
      '3. Add ON_ERROR ignore, LOG_VERBOSITY verbose (PG 17) and collect skipped-row notices for the vendor report.',
      '4. Validate in SQL (types, ranges, FK existence via joins), then INSERT INTO target SELECT ... ON CONFLICT DO NOTHING in 1M-row batches.',
      '5. TRUNCATE the staging table after each run; ANALYZE the target.',
      '6. Result: 11 minutes end to end; bad rows no longer abort the whole job.'
    ]
  },
  widgets: ['diagram:backup-pitr'],
  interview: [
    { q: 'What is the difference between COPY and \\copy?', a: 'COPY is an SQL command executed by the server; with a file name it reads/writes files on the database server and needs file-access privileges. \\copy is a psql meta-command that runs COPY ... FROM STDIN / TO STDOUT and reads/writes files on the client machine with the user\'s own permissions.' },
    { q: 'Why is COPY faster than INSERT?', a: 'It is a single statement streaming many rows: no per-row parse/plan, minimal network round trips, multi-insert batching into heap pages with fewer WAL records, and a single commit. Index maintenance and triggers still happen per row.' },
    { q: 'What does COPY ... FREEZE do and when is it allowed?', a: 'It writes rows already frozen and marked all-visible, avoiding later hint-bit setting and freezing vacuum work. It is only allowed when the table was created or truncated in the current transaction, so no other transaction could see the rows earlier.' },
    { q: 'How can you load a CSV with a few malformed rows without failing the whole load?', a: 'In PG 17+, COPY ... WITH (ON_ERROR ignore) skips rows with data-type conversion errors (optionally LOG_VERBOSITY verbose to report them; PG 18 REJECT_LIMIT to cap them). In older versions, load into a staging table with text columns and validate/cast in SQL.' }
  ],
  exercises: [
    {
      task: 'Export the 3 most expensive products (sku, name, price) as CSV with a header to STDOUT, using a semicolon as delimiter.',
      solution: `COPY (SELECT sku, name, price FROM products ORDER BY price DESC LIMIT 3)
TO STDOUT WITH (FORMAT csv, HEADER, DELIMITER ';');`,
      run: true
    },
    {
      task: 'Write the psql commands to export the users table to users.csv on your laptop and import it into a table users_copy with the same structure.',
      solution: `CREATE TABLE users_copy (LIKE users INCLUDING ALL);
\\copy (SELECT * FROM users) TO 'users.csv' WITH (FORMAT csv, HEADER)
\\copy users_copy FROM 'users.csv' WITH (FORMAT csv, HEADER)`,
      run: false
    }
  ],
  challenge: {
    task: 'Implement a validated load: export payments for October 2025 to a server file, load it into a text-typed staging table, then insert into a typed table only rows whose amount parses as numeric and whose method is in the allowed list; report loaded vs rejected counts.',
    hint: 'Use pg_input_is_valid(text, type) (PG 16+) to test conversions without exceptions.',
    solution: `COPY (SELECT id, order_id, amount, method, status FROM payments
      WHERE paid_at >= '2025-10-01')
TO '/tmp/payments_oct.csv' WITH (FORMAT csv, HEADER);

CREATE TEMP TABLE pay_raw (id text, order_id text, amount text, method text, status text);
COPY pay_raw FROM '/tmp/payments_oct.csv' WITH (FORMAT csv, HEADER);
INSERT INTO pay_raw VALUES ('999999', '1', 'N/A', 'cheque', 'success');   -- a bad row

CREATE TEMP TABLE pay_clean (id bigint, order_id bigint, amount numeric(12,2), method text, status text);
WITH ok AS (
  INSERT INTO pay_clean
  SELECT id::bigint, order_id::bigint, amount::numeric, method, status
  FROM pay_raw
  WHERE pg_input_is_valid(amount, 'numeric')
    AND method IN ('card', 'upi', 'netbanking', 'wallet', 'cod')
  RETURNING 1
)
SELECT (SELECT count(*) FROM pay_raw) AS raw_rows,
       (SELECT count(*) FROM ok)      AS loaded,
       (SELECT count(*) FROM pay_raw) - (SELECT count(*) FROM ok) AS rejected;`,
    run: true
  },
  related: ['backup-restore-logical-pg-dump', 'backup-restore-physical', 'wal-fundamentals', 'partitioning'],
  quiz: [
    { type: 'mcq', q: 'You are connected from a laptop with psql and want to import ~/data.csv. Which works without server file privileges?', options: ['COPY t FROM \'~/data.csv\'', '\\copy t FROM \'data.csv\' WITH (FORMAT csv)', 'COPY t FROM PROGRAM \'cat data.csv\'', 'pg_restore'], answer: 1, explain: '\\copy reads the client-side file and streams it via COPY FROM STDIN.' },
    { type: 'tf', q: 'COPY FROM skips triggers and CHECK constraints for speed.', answer: false, explain: 'Triggers, constraints and defaults still apply to every row.' },
    { type: 'mcq', q: 'COPY ... WITH (FREEZE) fails with an error. Most likely reason?', options: ['The file is CSV', 'The table was not created or truncated in the current transaction', 'HEADER was specified', 'The table has an index'], answer: 1, explain: 'FREEZE requires the table to be new or truncated in the same transaction.' },
    { type: 'predict', q: 'CSV line: 7,,"" into (id int, note text, tag text) with FORMAT csv defaults. Values?', code: `7,,""`, options: ['note NULL, tag NULL', 'note \'\', tag \'\'', 'note NULL, tag \'\' (empty string)', 'error'], answer: 2, explain: 'Unquoted empty = NULL; quoted empty = empty string.' }
  ]
},
{
  id: 'backup-restore-physical',
  module: 'backup-restore',
  title: 'Physical Backups: pg_basebackup, pgBackRest/Barman and Incremental Backups (PG 17)',
  level: 4,
  minutes: 24,
  summary: 'File-level backups of the whole cluster: pg_basebackup, the low-level backup API, third-party tools pgBackRest and Barman, and PostgreSQL 17\'s native incremental backups with WAL summarization and pg_combinebackup.',
  objectives: [
    'Explain what a physical (base) backup contains and why it needs WAL to be consistent',
    'Take a base backup with pg_basebackup and understand its key options (-X stream, -c fast, -Ft, --checkpoint)',
    'Describe the low-level backup API (pg_backup_start / pg_backup_stop) used by backup tools',
    'Use PG 17 incremental backups: summarize_wal, pg_basebackup --incremental, pg_combinebackup',
    'Compare pg_basebackup with pgBackRest and Barman (third-party tools)'
  ],
  concept: `<p>A <strong>physical backup</strong> copies the cluster's data directory files (all databases, all objects, exactly as stored on disk) while the server is running. Because files are copied over minutes or hours while being modified, the copy is <em>inconsistent</em> on its own; it becomes consistent by replaying the WAL generated from the backup's start checkpoint to its end. That is why a base backup always comes with WAL (streamed alongside with <code>-X stream</code>, or available from the archive).</p>
<ul>
<li><strong>pg_basebackup</strong> <span class="tag core">core client tool</span>: connects via the replication protocol, triggers a checkpoint, streams all files (plain directory or tar), and optionally the WAL needed. Also used to create streaming-replication standbys (<code>-R</code> writes the standby config).</li>
<li><strong>Low-level API</strong>: <code>pg_backup_start(label, fast)</code> → copy files with any tool (filesystem snapshots, rsync) → <code>pg_backup_stop()</code>, which returns the <code>backup_label</code> contents that must be stored with the backup. Both calls must happen in the same session.</li>
<li><strong>Incremental backups (PG 17+)</strong>: with <code>summarize_wal = on</code>, the WAL summarizer process records which blocks changed. <code>pg_basebackup --incremental=previous/backup_manifest</code> copies only changed blocks. <code>pg_combinebackup</code> merges a full backup and a chain of incrementals into a restorable full data directory.</li>
<li><strong>pgBackRest</strong> and <strong>Barman</strong> <span class="tag tool">third-party tool</span>: full backup management — full/differential/incremental backups, parallel compression, encryption, retention policies, WAL archiving, verification, restore automation and PITR. Most production deployments use one of them (or WAL-G).</li>
</ul>
<p>Analogy: photographing a busy warehouse room by room takes an hour, during which goods move. The photos alone do not show any single moment — but with the warehouse's movement log (WAL) from start to finish of the photo session, you can reconstruct the exact state at the end.</p>`,
  why: `<p>Physical backups restore much faster than logical dumps (copy files back + replay WAL, no index rebuilds), scale to multi-terabyte clusters, and together with WAL archiving enable point-in-time recovery. They are the foundation of disaster recovery for any serious PostgreSQL deployment.</p>`,
  useCase: `<p>A fintech runs a 6 TB cluster. pgBackRest takes a full backup on Sunday (2 h 40 min with 16 parallel processes and zstd compression to S3), differential backups daily (~25 min), and archives WAL continuously. Restoring the full cluster to a new host takes ~1 h 10 min plus WAL replay. A smaller 400 GB service on PG 17 uses native tooling instead: <code>summarize_wal = on</code>, weekly full <code>pg_basebackup</code> and daily <code>pg_basebackup --incremental</code>, combined with <code>pg_combinebackup</code> during restore drills.</p>`,
  internals: `<ul>
<li>Backup start forces a checkpoint (immediately with <code>-c fast</code>, otherwise spread), writes a backup-start WAL record, and enables full-page writes for the duration so torn pages in copied files can be repaired by replay.</li>
<li>The <code>backup_label</code> file (returned by <code>pg_backup_stop</code>) tells recovery where to begin (START WAL LOCATION, CHECKPOINT LOCATION); without it, a restored copy would start from the wrong checkpoint and be silently corrupt.</li>
<li><code>backup_manifest</code> (PG 13+) lists every file with size and checksum; <code>pg_verifybackup</code> checks a backup against it.</li>
<li>WAL summaries live in <code>pg_wal/summaries</code>; <code>wal_summary_keep_time</code> controls retention; functions <code>pg_available_wal_summaries()</code>, <code>pg_get_wal_summarizer_state()</code> inspect them.</li>
<li>A physical backup is tied to the same major version and platform; you cannot restore a PG 16 base backup into PG 17 binaries.</li>
</ul>`,
  whenNot: `<p>Physical backups cannot restore a single table or database by themselves (you restore the whole cluster elsewhere and extract), and they cannot cross major versions or architectures — use pg_dump for those needs. A backup without the WAL needed to make it consistent is useless.</p>`,
  syntax: `# pg_basebackup (shell)
pg_basebackup -h primary -U replicator -D /backups/base_2025-10-10 \\
              -Ft -z -X stream -c fast -P --manifest-checksums=SHA256
pg_verifybackup /backups/base_2025-10-10        # plain-format backups

# PG 17 incremental
#   postgresql.conf: summarize_wal = on
pg_basebackup -D /backups/full_sun -c fast
pg_basebackup -D /backups/incr_mon --incremental=/backups/full_sun/backup_manifest
pg_combinebackup -o /restore/pgdata /backups/full_sun /backups/incr_mon

-- low-level API (SQL, same session)
SELECT pg_backup_start('label', fast => true);
SELECT * FROM pg_backup_stop(wait_for_archive => true);`,
  examples: [
    {
      label: 'Basic',
      title: 'Take and verify a base backup with pg_basebackup (shell)',
      sql: `# role with REPLICATION privilege + pg_hba.conf entry for the replication protocol
pg_basebackup -h db-primary -p 5432 -U replicator \\
  -D /backups/base_2025-10-10 \\
  -Fp -X stream -c fast -P \\
  --manifest-checksums=SHA256

pg_verifybackup /backups/base_2025-10-10
ls /backups/base_2025-10-10`,
      explain: `<p><code>-Fp</code> writes a plain data directory (easy to verify and start); <code>-Ft -z</code> would write compressed tar files. <code>-X stream</code> opens a second connection that streams the WAL generated during the backup into the backup itself, so it is self-contained (restorable without the archive). <code>-c fast</code> requests an immediate checkpoint instead of waiting for a spread one. <code>pg_verifybackup</code> checks every file against <code>backup_manifest</code> and that the required WAL is present and parseable.</p>`,
      output: `waiting for checkpoint
   1/1 tablespace
11284/11284 kB (100%), 1/1 tablespace
backup successfully verified
$ ls /backups/base_2025-10-10
PG_VERSION  backup_label  backup_manifest  base  global  pg_wal  pg_xact  postgresql.auto.conf  ...`,
      run: false
    },
    {
      label: 'Intermediate',
      title: 'The low-level backup API that tools use',
      sql: `-- 1) start: forces a checkpoint (fast => true) and returns the start LSN
SELECT pg_backup_start(label => 'nightly-2025-10-10', fast => true) AS start_lsn;

-- 2) ... here a tool copies the data directory (filesystem snapshot, rsync, cloud disk snapshot) ...

-- 3) stop: returns the end LSN and the backup_label contents to store WITH the backup
SELECT lsn AS stop_lsn, labelfile
FROM pg_backup_stop(wait_for_archive => false);`,
      explain: `<p>Since PG 15 only the non-exclusive API exists (<code>pg_start_backup</code>/<code>pg_stop_backup</code> were removed). Both calls must run in the same session, which must stay connected during the copy. The returned <code>labelfile</code> must be written as <code>backup_label</code> into the restored data directory — it tells recovery which checkpoint to start from. <code>wait_for_archive =&gt; true</code> (the usual choice) waits until all WAL needed by the backup has been archived, so the backup is complete. Labels and LSNs differ in your session.</p>`,
      output: ` start_lsn
-----------
 0/2000028

 stop_lsn  | labelfile
-----------+---------------------------------------------------------------
 0/2000120 | START WAL LOCATION: 0/2000028 (file 000000010000000000000002)
           | CHECKPOINT LOCATION: 0/2000080
           | BACKUP METHOD: streamed
           | BACKUP FROM: primary
           | START TIME: 2025-10-10 01:00:00 IST
           | LABEL: nightly-2025-10-10
           | START TIMELINE: 1`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'PG 17 incremental backups: WAL summarization status',
      sql: `-- prerequisite for pg_basebackup --incremental
SELECT name, setting, context FROM pg_settings
WHERE name IN ('summarize_wal', 'wal_summary_keep_time', 'wal_level')
ORDER BY name;

-- summarizer progress and available summaries (empty while summarize_wal = off)
SELECT * FROM pg_get_wal_summarizer_state();
SELECT tli, start_lsn, end_lsn FROM pg_available_wal_summaries() ORDER BY start_lsn LIMIT 5;

-- running base backups (pg_basebackup in progress)
SELECT pid, phase, pg_size_pretty(backup_total) AS total, pg_size_pretty(backup_streamed) AS streamed
FROM pg_stat_progress_basebackup;`,
      explain: `<p>Incremental backups need <code>summarize_wal = on</code> (reload, no restart) and <code>wal_level</code> of at least replica. The summarizer then writes block-change summaries to <code>pg_wal/summaries</code>, kept for <code>wal_summary_keep_time</code> (default 10 days) — so incrementals must be taken within that window of their parent. <code>pg_get_wal_summarizer_state()</code> shows how far summarization has progressed; it must have reached the parent backup's start LSN. <code>pg_stat_progress_basebackup</code> shows running base backups (phase: waiting for checkpoint, streaming database files, waiting for WAL archiving...). In this sandbox summarization is off and no backup is running.</p>`,
      output: ` name                  | setting | context
-----------------------+---------+---------
 summarize_wal         | off     | sighup
 wal_level             | replica | postmaster
 wal_summary_keep_time | 14400   | sighup        (minutes = 10 days)

 summarized_tli | summarized_lsn | pending_lsn | summarizer_pid
----------------+----------------+-------------+----------------
              0 | 0/0            | 0/0         |

 tli | start_lsn | end_lsn
-----+-----------+---------
(0 rows)

 pid | phase | total | streamed
-----+-------+-------+----------
(0 rows)`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `# Copying the data directory of a running server with cp/rsync and nothing else
rsync -a /var/lib/postgresql/17/main/ /backups/copy/`,
      why: 'Files change during the copy; without backup_label and the WAL from start to end of the copy, the result is an inconsistent, likely corrupt cluster that may even start up and silently return wrong data.',
      run: false
    },
    good: {
      sql: `# Self-contained, verified base backup
pg_basebackup -D /backups/base -Fp -X stream -c fast --manifest-checksums=SHA256
pg_verifybackup /backups/base
# or a managed tool: pgbackrest --stanza=main --type=full backup`,
      why: 'pg_basebackup (or pgBackRest/Barman) coordinates the checkpoint, backup_label and required WAL, and the manifest lets you verify integrity.',
      run: false
    }
  },
  mistakes: [
    'Backing up a running data directory with plain file copies, without the backup API and WAL.',
    'Losing the <code>backup_label</code> from a low-level backup — the restore starts from the wrong checkpoint.',
    'Taking base backups without WAL (<code>-X none</code>) and without a working archive: the backup cannot be made consistent.',
    'Never running <code>pg_verifybackup</code> or test restores.',
    'Expecting to restore a physical backup into a different major version.'
  ],
  best: [
    'Use pgBackRest, Barman or WAL-G for production: retention, parallelism, compression, encryption, verification and PITR in one tool.',
    'With native tools: <code>pg_basebackup -X stream</code>, manifests with checksums, <code>pg_verifybackup</code>, and WAL archiving for PITR.',
    'On PG 17+, consider <code>summarize_wal = on</code> with incremental backups to cut backup time and storage.',
    'Store backups off-host and ideally off-region; keep at least two full backup generations.',
    'Schedule automated restore tests and measure the actual restore time (RTO).'
  ],
  performance: `<p>A base backup reads the whole cluster (I/O on the source) and transfers it (network); throttle with <code>--max-rate</code> or take backups from a standby (<code>pg_basebackup</code> works against standbys). Parallel tools (pgBackRest <code>process-max</code>) and incremental/differential backups reduce the window dramatically. Fast checkpoints at backup start cause a brief I/O burst.</p>`,
  security: `<p>Base backups contain everything, including password hashes in <code>pg_authid</code>: encrypt backups at rest and in transit. The replication role used for backups should have only <code>REPLICATION</code> (and appropriate pg_hba entries), not superuser. Protect backup repositories against deletion (immutability / object lock) to survive ransomware.</p>`,
  scenario: {
    title: 'Designing the backup strategy for a 2 TB primary',
    steps: [
      '1. Requirements: RPO ≤ 5 min, RTO ≤ 2 h, 30-day point-in-time window, off-region copy.',
      '2. Choose pgBackRest: continuous async WAL archiving to object storage (archive_timeout 60 s).',
      '3. Weekly full + daily differential backups taken from a standby with 8 parallel processes and zstd.',
      '4. Retention: 5 full backups; WAL kept as long as needed by the oldest retained backup; repository replicated to a second region.',
      '5. Monitoring: backup age, archive lag (pg_stat_archiver), repository size; pgbackrest check daily.',
      '6. Monthly restore drill to a fresh host, timing restore + WAL replay to validate the 2 h RTO.'
    ]
  },
  widgets: ['diagram:backup-pitr', 'diagram:wal'],
  interview: [
    { q: 'Why does a base backup need WAL?', a: 'Files are copied while the database is running and changing, so the copy is not consistent at any single moment. Replaying the WAL generated from the backup\'s start checkpoint to its end point makes it consistent; the backup_label tells recovery where to start.' },
    { q: 'What does pg_basebackup -X stream do?', a: 'It opens an additional replication connection that streams WAL generated during the backup and includes it in the backup, making the backup self-contained and restorable without relying on the WAL archive.' },
    { q: 'How do incremental backups work in PostgreSQL 17?', a: 'With summarize_wal enabled, the WAL summarizer records which blocks changed per WAL range. pg_basebackup --incremental=<previous manifest> then copies only modified blocks (and full copies of new files). pg_combinebackup reconstructs a full data directory from the full backup plus the chain of incrementals before restore.' },
    { q: 'Why use pgBackRest or Barman instead of pg_basebackup alone?', a: 'They manage the whole lifecycle: full/differential/incremental backups, parallel compressed and encrypted transfer, WAL archiving with async push, retention policies, backup verification, restore automation and PITR targets, plus multi-repository support. pg_basebackup is a single-backup building block.' }
  ],
  exercises: [
    {
      task: 'Write the pg_basebackup command that creates a compressed tar-format backup with streamed WAL, a fast checkpoint and progress output, rate-limited to 100 MB/s.',
      solution: `pg_basebackup -h db-primary -U replicator -D /backups/base_tar \\
  -Ft -z -X stream -c fast -P --max-rate=100M`,
      run: false
    },
    {
      task: 'Check whether this server is ready for PG 17 incremental backups (summarize_wal) and which wal_level it uses.',
      solution: `SELECT name, setting FROM pg_settings
WHERE name IN ('summarize_wal', 'wal_level', 'wal_summary_keep_time')
ORDER BY name;`,
      run: true
    }
  ],
  challenge: {
    task: 'Run a complete low-level backup cycle in SQL and extract the START WAL LOCATION and the WAL file name from the label returned by pg_backup_stop, then show which segment file the stop LSN is in.',
    hint: 'Use substring(labelfile FROM \'START WAL LOCATION: ([0-9A-F/]+)\') and pg_walfile_name(lsn).',
    solution: `SELECT pg_backup_start('drill', true);
WITH s AS (SELECT lsn, labelfile FROM pg_backup_stop(false))
SELECT substring(labelfile FROM 'START WAL LOCATION: ([0-9A-F/]+)')                   AS start_wal_location,
       substring(labelfile FROM '\\(file ([0-9A-F]+)\\)')                              AS start_wal_file,
       lsn                                                                            AS stop_lsn,
       pg_walfile_name(lsn)                                                           AS stop_wal_file
FROM s;`,
    run: true
  },
  related: ['backup-restore-pitr', 'backup-restore-logical-pg-dump', 'wal-durability-archiving', 'replication'],
  quiz: [
    { type: 'mcq', q: 'Which file, returned by pg_backup_stop(), must be stored with a low-level backup?', options: ['postgresql.conf', 'backup_label', 'pg_hba.conf', 'recovery.signal'], answer: 1, explain: 'backup_label tells recovery where WAL replay must start.' },
    { type: 'tf', q: 'A PG 16 physical backup can be restored directly with PG 17 binaries.', answer: false, explain: 'Physical backups are tied to the major version; use pg_upgrade or a logical dump for upgrades.' },
    { type: 'mcq', q: 'What must be enabled before taking PG 17 incremental backups?', options: ['wal_level = logical', 'summarize_wal = on', 'archive_mode = always', 'full_page_writes = off'], answer: 1, explain: 'The WAL summarizer records changed blocks used by --incremental.' },
    { type: 'mcq', q: 'pgBackRest is:', options: ['A core PostgreSQL utility', 'A third-party backup and restore tool', 'A PostgreSQL extension for partitioning', 'A connection pooler'], answer: 1, explain: 'pgBackRest is an open-source third-party tool.' }
  ]
},
{
  id: 'backup-restore-pitr',
  module: 'backup-restore',
  title: 'Point-in-Time Recovery and Disaster Recovery: restore_command, Recovery Targets, RPO/RTO',
  level: 4,
  minutes: 26,
  summary: 'Restore a base backup and replay archived WAL to an exact moment (time, LSN, XID or named restore point), understand recovery.signal, timelines and recovery_target_action, and design DR around RPO and RTO with regular restore tests.',
  objectives: [
    'Explain how PITR combines a base backup with archived WAL replay',
    'Configure restore_command, recovery_target_time / _lsn / _xid / _name, recovery_target_inclusive and recovery_target_action',
    'Use recovery.signal vs standby.signal and understand timelines after promotion',
    'Create named restore points before risky operations with pg_create_restore_point()',
    'Define RPO/RTO and build a restore-testing routine'
  ],
  concept: `<p><strong>Point-in-time recovery (PITR)</strong> = restore the most recent base backup taken <em>before</em> the target time, then replay archived WAL up to exactly the moment you want — for example, one second before someone ran <code>DROP TABLE orders</code> at 14:03:27.</p>
<p>Steps on the recovery host:</p>
<ol>
<li>Restore the base backup files into an empty data directory (with its <code>backup_label</code>).</li>
<li>Set <code>restore_command</code> (how to fetch archived WAL, e.g. <code>pgbackrest --stanza=main archive-get %f "%p"</code>) and a <strong>recovery target</strong> in <code>postgresql.conf</code>.</li>
<li>Create an empty <code>recovery.signal</code> file (targeted recovery) — or <code>standby.signal</code> to run as a standby.</li>
<li>Start PostgreSQL: it replays WAL from the backup's start checkpoint until the target, then performs <code>recovery_target_action</code> (<code>pause</code> by default — inspect, then <code>SELECT pg_wal_replay_resume()</code> to promote; or <code>promote</code> / <code>shutdown</code>).</li>
</ol>
<p>Targets: <code>recovery_target_time</code>, <code>recovery_target_lsn</code>, <code>recovery_target_xid</code>, <code>recovery_target_name</code> (a restore point created with <code>pg_create_restore_point()</code>), or <code>recovery_target = 'immediate'</code> (stop as soon as consistent). <code>recovery_target_inclusive</code> (default on) decides whether the target transaction itself is included.</p>
<p>After promotion the server starts a new <strong>timeline</strong> (TLI 2, 3...), so WAL from the "alternate history" never collides with the original. A <code>.history</code> file records where timelines branched.</p>
<p>Analogy: a video editor's undo history. The base backup is a saved project file from last night; the WAL archive is every edit since. PITR opens the saved file and replays edits up to (but not including) the one that deleted the scene — and from there you start a new branch of history (timeline).</p>
<h4>RPO and RTO</h4>
<ul>
<li><strong>RPO (Recovery Point Objective)</strong>: how much data you may lose — bounded by how quickly WAL leaves the server (archive_timeout, streaming to a standby or <code>pg_receivewal</code>).</li>
<li><strong>RTO (Recovery Time Objective)</strong>: how long recovery may take — restore copy time + WAL replay time (+ DNS/app failover). Measured only by <em>testing restores</em>.</li>
</ul>`,
  why: `<p>Replicas protect against hardware failure but faithfully replicate human errors (a DROP TABLE reaches the standby in milliseconds). PITR is the only way back from logical disasters: bad migrations, accidental deletes, application bugs corrupting data, ransomware. Backups that have never been restored are hypotheses, not backups.</p>`,
  useCase: `<p>At 14:03:27 IST a migration script ran <code>DELETE FROM payments</code> without a WHERE clause on a 900 GB production database. The team restored last night's pgBackRest backup to a separate host with <code>--type=time --target="2025-10-10 14:03:00+05:30" --target-action=pause</code>, verified the payments row count, then exported the affected rows with COPY and re-inserted them into production (rather than failing over the whole cluster, which would have lost 40 minutes of other valid transactions). Total time: 1 h 35 min, inside the 2 h RTO. A named restore point is now created automatically before every migration.</p>`,
  internals: `<ul>
<li>Recovery starts at the REDO point from <code>backup_label</code>, calls <code>restore_command</code> for each needed segment (<code>%f</code> file name, <code>%p</code> destination path), and also uses files present in <code>pg_wal</code>.</li>
<li>The cluster is consistent only after replaying past the backup's end point (<code>min_recovery_end_lsn</code>); recovery targets earlier than that are invalid.</li>
<li>Time targets compare with commit/abort record timestamps, so recovery stops at the first transaction commit after (or at) the target time; non-transactional activity has no timestamps.</li>
<li>With <code>recovery_target_action = pause</code> and <code>hot_standby = on</code>, you can connect read-only and inspect data before deciding; <code>pg_wal_replay_resume()</code> ends recovery and promotes.</li>
<li>Since PG 12, recovery settings live in <code>postgresql.conf</code>; <code>recovery.conf</code> no longer exists (its presence prevents startup).</li>
<li>Timelines: after promotion, new WAL segment names start with the new timeline ID; <code>recovery_target_timeline = 'latest'</code> (default) follows the newest timeline found in the archive.</li>
</ul>`,
  whenNot: `<p>PITR of the entire cluster rewinds <em>all</em> databases and all tables — if only one table was damaged, restore to a separate host and copy the needed rows back instead of rolling back production. For hardware/site failure with minimal data loss, promote a streaming replica (seconds) rather than doing PITR (hours); PITR is for logical errors and as the last line of defence.</p>`,
  syntax: `# postgresql.conf on the RESTORE host (PG 12+)
restore_command = 'pgbackrest --stanza=main archive-get %f "%p"'
recovery_target_time = '2025-10-10 14:03:00+05:30'     # or _lsn / _xid / _name / recovery_target = 'immediate'
recovery_target_inclusive = off
recovery_target_action = 'pause'                       # pause | promote | shutdown
recovery_target_timeline = 'latest'
# then:  touch $PGDATA/recovery.signal   and start PostgreSQL

-- SQL helpers
SELECT pg_create_restore_point('before_release_2025_10_10');
SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp();
SELECT pg_wal_replay_resume();      -- end a paused recovery and promote`,
  examples: [
    {
      label: 'Basic',
      title: 'Create a named restore point before a risky change',
      sql: `-- requires wal_level replica or logical, and superuser or explicit GRANT EXECUTE
SELECT pg_create_restore_point('before_migration_2025_10_10') AS restore_point_lsn,
       now()                                                   AS created_at,
       pg_walfile_name(pg_current_wal_lsn())                   AS in_wal_file;

-- ... run the migration ...
-- If it goes wrong:  recovery_target_name = 'before_migration_2025_10_10'`,
      explain: `<p><code>pg_create_restore_point()</code> writes a named marker record into WAL and returns its LSN. During PITR, <code>recovery_target_name</code> stops replay exactly there — more precise and less error-prone than guessing a timestamp. Record the name, LSN and WAL file in the change ticket. It only helps if WAL archiving is running and a base backup older than the restore point exists.</p>`,
      output: ` restore_point_lsn | created_at                    | in_wal_file
-------------------+-------------------------------+--------------------------
 0/1DE1248         | 2025-10-10 13:58:02.114+05:30 | 000000010000000000000001`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'A complete PITR restore with pgBackRest or by hand (shell + config)',
      sql: `# --- Option A: pgBackRest (third-party) does restore + recovery config in one step
pgbackrest --stanza=main --delta \\
  --type=time --target="2025-10-10 14:03:00+05:30" \\
  --target-action=pause restore
pg_ctl -D /var/lib/postgresql/17/main start

# --- Option B: native tools
# 1. restore base backup into an empty data directory
tar -xzf /backups/base_2025-10-09/base.tar.gz -C /pgdata_restore
# 2. recovery configuration
cat >> /pgdata_restore/postgresql.auto.conf <<'EOF'
restore_command = 'cp /wal_archive/%f "%p"'
recovery_target_time = '2025-10-10 14:03:00+05:30'
recovery_target_inclusive = off
recovery_target_action = 'pause'
EOF
touch /pgdata_restore/recovery.signal
pg_ctl -D /pgdata_restore -o "-p 5433" start

# 3. inspect while paused (read-only), then finish
psql -p 5433 -c "SELECT pg_is_in_recovery(), pg_last_xact_replay_timestamp();"
psql -p 5433 -c "SELECT count(*) FROM payments;"
psql -p 5433 -c "SELECT pg_wal_replay_resume();"     # promote: new timeline begins`,
      explain: `<p>Restore on a <em>separate</em> host or port, never over the damaged production directory. The server replays WAL via <code>restore_command</code> until the first commit at or after 14:03:00, then pauses. While paused you can query (read-only) and verify that the data looks right; if the target was too early, restart with a later target (you cannot move recovery backwards). <code>pg_wal_replay_resume()</code> ends recovery, removes <code>recovery.signal</code>, and starts timeline 2. Not runnable in the browser.</p>`,
      output: `LOG:  starting point-in-time recovery to 2025-10-10 14:03:00+05:30
LOG:  restored log file "000000010000003A000000F0" from archive
LOG:  consistent recovery state reached at 3A/F0A1B2C8
LOG:  recovery stopping before commit of transaction 99812345, time 2025-10-10 14:03:27.511+05:30
LOG:  pausing at the end of recovery
HINT:  Execute pg_wal_replay_resume() to promote.

 pg_is_in_recovery | pg_last_xact_replay_timestamp
-------------------+--------------------------------
 t                 | 2025-10-10 14:02:59.870+05:30`,
      run: false
    },
    {
      label: 'Advanced',
      title: 'Recovery settings, recovery state and timeline on the current server',
      sql: `-- all recovery-related settings (postmaster = needs restart; set before starting recovery)
SELECT name, setting, context
FROM pg_settings
WHERE name LIKE 'recovery_target%'
   OR name IN ('restore_command', 'archive_cleanup_command', 'recovery_end_command',
               'recovery_min_apply_delay', 'primary_conninfo')
ORDER BY name;

-- am I a primary or in recovery? which timeline am I on?
SELECT pg_is_in_recovery()                        AS in_recovery,
       timeline_id,
       pg_walfile_name(pg_current_wal_lsn())       AS current_wal_file
FROM pg_control_checkpoint();

SELECT min_recovery_end_lsn, backup_start_lsn, backup_end_lsn, end_of_backup_record_required
FROM pg_control_recovery();`,
      explain: `<p>Recovery targets are <code>postmaster</code>-context settings: they are read at server start. <code>recovery_target_action</code> defaults to <code>pause</code>, <code>recovery_target_timeline</code> to <code>latest</code>. This server is a primary on timeline 1 (the first two hex groups of WAL file names); after a PITR + promotion you would see timeline 2 and file names starting with <code>00000002</code>. <code>pg_control_recovery()</code> shows the minimum LSN a recovery must reach to be consistent — relevant when you pick an LSN target.</p>`,
      output: ` name                      | setting | context
---------------------------+---------+------------
 archive_cleanup_command   |         | sighup
 primary_conninfo          |         | sighup
 recovery_end_command      |         | sighup
 recovery_min_apply_delay  | 0       | sighup
 recovery_target           |         | postmaster
 recovery_target_action    | pause   | postmaster
 recovery_target_inclusive | on      | postmaster
 recovery_target_lsn       |         | postmaster
 recovery_target_name      |         | postmaster
 recovery_target_time      |         | postmaster
 recovery_target_timeline  | latest  | postmaster
 recovery_target_xid       |         | postmaster
 restore_command           |         | sighup

 in_recovery | timeline_id | current_wal_file
-------------+-------------+--------------------------
 f           |           1 | 000000010000000000000001

 min_recovery_end_lsn | backup_start_lsn | backup_end_lsn | end_of_backup_record_required
----------------------+------------------+----------------+-------------------------------
 0/0                  | 0/0              | 0/0            | f`,
      run: true
    }
  ],
  compare: {
    bad: {
      sql: `# "Undo" a bad DELETE by PITR-ing the whole production cluster in place
pg_ctl -D /var/lib/postgresql/17/main stop
rm -rf /var/lib/postgresql/17/main/*
# restore + recovery_target_time = '14:03' + promote on the production host`,
      why: 'Rewinding production loses every valid transaction after the target time across all databases, destroys the evidence, and has no fallback if the target is wrong.',
      run: false
    },
    good: {
      sql: `# Restore to a separate host, extract the damaged data, repair production surgically
pgbackrest --stanza=main --type=time --target="2025-10-10 14:03:00+05:30" \\
           --target-action=pause --pg1-path=/restore/pgdata restore
pg_ctl -D /restore/pgdata -o "-p 5433" start
psql -p 5433 -c "\\copy (SELECT * FROM payments WHERE paid_at < '2025-10-10 14:03') TO 'payments_rescue.csv' CSV HEADER"
# load into production staging table, then INSERT ... ON CONFLICT DO NOTHING`,
      why: 'Production keeps all later valid work; only the damaged rows are restored, and the procedure can be repeated with a different target if needed.',
      run: false
    }
  },
  mistakes: [
    'Having base backups but no continuous WAL archive — only restores to the backup moment are possible.',
    'Restoring over the production data directory instead of a separate location.',
    'Choosing a target time in the wrong time zone (always include the offset, e.g. <code>+05:30</code>).',
    'Using <code>recovery_target_action = promote</code> by default and overshooting; <code>pause</code> lets you verify first.',
    'Never testing restores, so RTO is unknown and broken archives are discovered during the disaster.'
  ],
  best: [
    'Define RPO/RTO with the business; derive archive_timeout/streaming, backup frequency and retention from them.',
    'Create named restore points before migrations and bulk changes.',
    'Automate monthly (or weekly) restore drills to an isolated host, including PITR to a random timestamp, and record the duration.',
    'Keep backups and WAL archives in a separate account/region with immutability against accidental or malicious deletion.',
    'Document the runbook: which backup, which target type, verification queries, data extraction, and communication steps.'
  ],
  performance: `<p>RTO = time to copy the backup back (size / restore throughput, parallelised by tools) + WAL replay time (WAL volume since backup / replay speed, typically hundreds of MB/s on fast storage, slower with many random reads). More frequent full/differential/incremental backups shorten the replay portion. <code>recovery_prefetch</code> (PG 15+) speeds up replay on I/O-bound systems.</p>`,
  security: `<p>Restore hosts receive full copies of production data: apply the same access controls, encryption and network isolation as production, and destroy restored copies after use. Backup credentials (restore_command access to the repository) should be read-only where possible.</p>`,
  scenario: {
    title: 'DELETE without WHERE at 14:03:27 on payments',
    steps: [
      '1. Freeze the blast radius: stop the job, note the exact time from logs (14:03:27.511 IST), keep production running.',
      '2. Optionally create a restore point now for later analysis: SELECT pg_create_restore_point(\'incident_payments\').',
      '3. On a separate host: restore last night\'s backup with target time 14:03:00+05:30, target-action pause.',
      '4. While paused, verify: SELECT count(*) FROM payments matches the expected pre-incident count.',
      '5. Export the payments rows with \\copy and load them into a production staging table; INSERT ... ON CONFLICT DO NOTHING into payments; reconcile counts and sums.',
      '6. Post-mortem: require WHERE clauses in migrations (safe-update tooling), restore points before migrations, and keep the restore drill schedule.'
    ]
  },
  widgets: ['diagram:backup-pitr', 'diagram:wal', 'diagram:ha'],
  interview: [
    { q: 'What do you need for point-in-time recovery?', a: 'A base (physical) backup taken before the target time and an unbroken sequence of archived WAL from that backup\'s start up to the target. On restore you set restore_command and a recovery target, create recovery.signal, and start the server; it replays WAL to the target and then pauses, promotes or shuts down.' },
    { q: 'What is a timeline in PostgreSQL?', a: 'An ID that increments whenever a server finishes archive recovery or a standby is promoted, starting a new branch of WAL history. WAL file names include the timeline so the new branch never overwrites the old one; .history files record branch points, and recovery_target_timeline selects which branch to follow.' },
    { q: 'Explain RPO and RTO and what drives them in PostgreSQL.', a: 'RPO is acceptable data loss: driven by how fast WAL leaves the primary (synchronous/asynchronous replication, archive_timeout, pg_receivewal). RTO is acceptable downtime: driven by restore copy speed, WAL replay volume (backup frequency), and failover automation. Only restore drills give real numbers.' },
    { q: 'Why is recovery_target_action = pause a good default?', a: 'It stops recovery at the target with the server readable (hot_standby), so you can verify the data is what you need before promoting. If the target was too early, you can restart recovery with a later target; once promoted, you cannot go forward on that timeline from the original WAL without starting over.' }
  ],
  exercises: [
    {
      task: 'Create a restore point named before_price_update, then show its LSN and the WAL file it is in.',
      solution: `SELECT lsn, pg_walfile_name(lsn) AS wal_file
FROM (SELECT pg_create_restore_point('before_price_update') AS lsn) r;`,
      run: true
    },
    {
      task: 'Write the postgresql.conf lines and the signal file needed to recover to the restore point before_price_update and then promote automatically.',
      solution: `restore_command = 'cp /wal_archive/%f "%p"'
recovery_target_name = 'before_price_update'
recovery_target_action = 'promote'
# and:  touch $PGDATA/recovery.signal`,
      run: false
    }
  ],
  challenge: {
    task: 'Build a "DR readiness" query for this server that reports: wal_level, archive_mode, archive_command/library configured, last archived WAL age, current timeline, and a verdict whether PITR is possible.',
    hint: 'Combine current_setting(), pg_stat_archiver and pg_control_checkpoint(); PITR needs wal_level >= replica, archive_mode on, a configured command/library, and recent successful archiving.',
    solution: `SELECT current_setting('wal_level')                         AS wal_level,
       current_setting('archive_mode')                      AS archive_mode,
       nullif(current_setting('archive_command'), '(disabled)') IS NOT NULL
         OR current_setting('archive_library') <> ''        AS archiver_configured,
       now() - a.last_archived_time                         AS last_archive_age,
       a.failed_count,
       c.timeline_id,
       CASE WHEN current_setting('wal_level') IN ('replica', 'logical')
             AND current_setting('archive_mode') IN ('on', 'always')
             AND (nullif(current_setting('archive_command'), '(disabled)') IS NOT NULL
                  OR current_setting('archive_library') <> '')
             AND a.last_archived_time > now() - interval '15 minutes'
            THEN 'PITR possible'
            ELSE 'PITR NOT possible: fix archiving' END       AS verdict
FROM pg_stat_archiver a, pg_control_checkpoint() c;`,
    run: true
  },
  related: ['backup-restore-physical', 'wal-durability-archiving', 'backup-restore-logical-pg-dump', 'high-availability'],
  quiz: [
    { type: 'mcq', q: 'Which file tells PostgreSQL (PG 12+) to perform targeted archive recovery at startup?', options: ['recovery.conf', 'recovery.signal', 'backup_manifest', 'pg_control'], answer: 1, explain: 'recovery.signal (or standby.signal for standby mode); recovery.conf was removed in PG 12.' },
    { type: 'tf', q: 'A streaming replica protects you from an accidental DROP TABLE.', answer: false, explain: 'The DROP replicates within milliseconds; only PITR (or a delayed replica) helps.' },
    { type: 'mcq', q: 'What happens by default when recovery reaches recovery_target_time?', options: ['It promotes immediately', 'It pauses (recovery_target_action = pause)', 'It shuts down', 'It continues to the end of WAL'], answer: 1, explain: 'The default action is pause, allowing inspection before pg_wal_replay_resume().' },
    { type: 'scenario', q: 'A bad UPDATE corrupted one table at 10:15; thousands of valid orders were written since. Best approach?', options: ['PITR production to 10:14', 'Restore a copy to 10:14 on another host and repair the one table from it', 'Promote the replica', 'Run VACUUM FULL'], answer: 1, explain: 'Surgical repair keeps all later valid transactions.' },
    { type: 'mcq', q: 'Which mainly determines RPO for an archive-based setup without streaming replication?', options: ['shared_buffers', 'How often WAL segments are archived (segment fill rate and archive_timeout)', 'checkpoint_completion_target', 'work_mem'], answer: 1, explain: 'Unarchived WAL is lost if the primary is destroyed.' }
  ]
}
]);
