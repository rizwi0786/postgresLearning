/* =====================================================================
   lessons-01-basics.js — flagship beginner lessons
   Modules: fundamentals, sql-fundamentals, database-design, data-types,
            crud, querying  (25 lessons)
   Every example marked run:true executes against company_db in the
   in-browser PostgreSQL engine and is rolled back afterwards.
   ===================================================================== */

/* ============================ MODULE: fundamentals ============================ */
PGM.addLessons([
{
  id: 'fundamentals-what-is-postgresql',
  module: 'fundamentals',
  title: 'What Is a Database, an RDBMS and PostgreSQL?',
  level: 1,
  minutes: 18,
  summary: 'From spreadsheets to relational databases: what an RDBMS guarantees, where PostgreSQL came from, and how it compares with MySQL, SQL Server and Oracle.',
  objectives: [
    'Explain what a database and a database management system (DBMS) are, and why files or spreadsheets stop working at scale',
    'Describe the relational model: tables, rows, columns, keys and relationships',
    'List the guarantees an RDBMS gives you (ACID, constraints, concurrency, a declarative query language)',
    'Summarise the history of PostgreSQL from POSTGRES at Berkeley to PostgreSQL 18',
    'Name PostgreSQL features that set it apart (MVCC, extensibility, rich types, JSONB, strict standards compliance)',
    'Compare PostgreSQL with MySQL, SQL Server and Oracle and pick sensibly between them'
  ],
  concept: `
<p>A <strong>database</strong> is an organised, persistent collection of data. A <strong>database management system</strong> (DBMS) is the software that stores that data on disk, lets many programs read and change it at the same time, and protects it from crashes and mistakes. When people say "the database" they usually mean both together.</p>
<p><strong>Analogy: a city library.</strong> The books are the data. The <em>library system</em> — catalogue, shelving rules, check-out desk, the rule that two people cannot borrow the same copy at once, the fire-proof archive — is the DBMS. You never walk into the stacks and move books yourself; you ask the librarian ("give me every book by this author published after 2010") and the librarian decides the fastest way to fetch them. That request language is <strong>SQL</strong>, and the librarian's plan is the <strong>query plan</strong>.</p>
<h4>The relational model</h4>
<p>A <strong>relational</strong> DBMS (RDBMS) stores data in <strong>tables</strong> (formally <em>relations</em>). Each table has named, typed <strong>columns</strong> and holds <strong>rows</strong> (tuples). Tables are linked by <strong>keys</strong>: a <em>primary key</em> uniquely identifies a row, and a <em>foreign key</em> in another table points at it. In <code>company_db</code>, <code>employees.department_id</code> is a foreign key pointing at <code>departments.id</code>: the department's name and location are stored once, and 200 employees simply reference it.</p>
<ul>
<li><strong>Declarative querying</strong> — you say <em>what</em> you want (<code>SELECT ... WHERE ...</code>), not <em>how</em> to loop over files. The optimizer chooses indexes, join algorithms and ordering.</li>
<li><strong>Integrity</strong> — types, <code>NOT NULL</code>, <code>UNIQUE</code>, <code>CHECK</code> and foreign keys reject bad data at the door, no matter which application wrote it.</li>
<li><strong>Transactions (ACID)</strong> — <em>Atomicity</em> (all or nothing), <em>Consistency</em> (constraints always hold), <em>Isolation</em> (concurrent users don't see each other's half-finished work), <em>Durability</em> (once committed, it survives a power cut).</li>
<li><strong>Concurrency</strong> — hundreds of sessions read and write simultaneously without corrupting each other.</li>
</ul>
<h4>PostgreSQL in one paragraph</h4>
<p>PostgreSQL is a free, open-source <strong>object-relational</strong> database. It descends from the <em>POSTGRES</em> project led by Michael Stonebraker at UC Berkeley (1986), itself the successor to <em>Ingres</em>. In 1994 Andrew Yu and Jolly Chen added a SQL interpreter (Postgres95); in 1996 it was renamed <strong>PostgreSQL</strong> and handed to a global community. There is no owning company: it is developed by the PostgreSQL Global Development Group and released under the permissive PostgreSQL Licence (BSD/MIT-like). A new major version ships every autumn (PostgreSQL 16 in 2023, 17 in 2024, 18 in 2025) and each major version is supported for five years.</p>
<h4>What makes PostgreSQL special</h4>
<ul>
<li><strong>MVCC</strong> (multi-version concurrency control) — readers never block writers and writers never block readers.</li>
<li><strong>Standards compliance</strong> — very close to the SQL standard: window functions, CTEs, <code>WITH RECURSIVE</code>, <code>MERGE</code>, <code>FILTER</code>, <code>LATERAL</code>, SQL/JSON.</li>
<li><strong>Rich types</strong> — <code>numeric</code>, <code>timestamptz</code>, <code>interval</code>, <code>uuid</code>, <code>jsonb</code>, arrays, ranges, <code>inet</code>, geometric types, full-text <code>tsvector</code>.</li>
<li><strong>Extensibility</strong> — you can add types, operators, index methods and languages. That is why <span class="tag ext">extension</span> projects such as PostGIS (geospatial), pgvector (AI embeddings) and Citus (distribution) exist.</li>
<li><strong>Transactional DDL</strong> — <code>CREATE TABLE</code>, <code>ALTER TABLE</code> and friends can be rolled back, which makes schema migrations safe.</li>
<li><strong>Many index types</strong> — B-tree, Hash, GIN, GiST, SP-GiST, BRIN (all <span class="tag core">core</span>).</li>
</ul>
<h4>PostgreSQL vs MySQL vs SQL Server vs Oracle</h4>
<table>
<tr><th>Aspect</th><th>PostgreSQL</th><th>MySQL (InnoDB)</th><th>SQL Server</th><th>Oracle Database</th></tr>
<tr><td>Licence / cost</td><td>Open source (PostgreSQL Licence), free</td><td>GPL community edition + commercial editions (Oracle Corp.)</td><td>Commercial (free Express/Developer editions)</td><td>Commercial, licensed per core; free XE edition</td></tr>
<tr><td>Governance</td><td>Community, no single vendor</td><td>Oracle Corporation (MariaDB is a community fork)</td><td>Microsoft</td><td>Oracle Corporation</td></tr>
<tr><td>Concurrency model</td><td>MVCC with old row versions kept in the table (cleaned by VACUUM)</td><td>MVCC with undo logs</td><td>Locking by default; optional row versioning in tempdb (RCSI/snapshot)</td><td>MVCC with undo segments</td></tr>
<tr><td>SQL standard conformance</td><td>Very high</td><td>Good, historically lenient (silent truncation in old modes)</td><td>High, T-SQL dialect</td><td>High, PL/SQL dialect</td></tr>
<tr><td>Transactional DDL</td><td>Yes</td><td>No (DDL causes implicit commit)</td><td>Mostly yes</td><td>No (DDL commits)</td></tr>
<tr><td>JSON</td><td><code>jsonb</code> binary type with GIN indexing, SQL/JSON path</td><td><code>JSON</code> type, functional indexes</td><td>JSON functions over <code>nvarchar</code>; native <code>json</code> type in 2025</td><td>Native JSON type (21c+)</td></tr>
<tr><td>Extensibility</td><td>Custom types, operators, index methods, extensions</td><td>Plugins, storage engines</td><td>CLR integration</td><td>Data cartridges</td></tr>
<tr><td>Typical sweet spot</td><td>General purpose OLTP, analytics-lite, geospatial, AI/vector, SaaS</td><td>Web apps, read-heavy LAMP stacks</td><td>Microsoft / .NET enterprise shops</td><td>Large legacy enterprise, RAC clusters</td></tr>
</table>
<div class="callout info"><strong>Where you are running SQL right now:</strong> the playground in this course is real PostgreSQL 18 compiled to WebAssembly (PGlite), running inside your browser tab. It behaves like a single-user server, so features needing multiple connections or a file system (replication, <code>pg_dump</code>) are explained but not executed.</div>`,
  why: `
<p>Before databases, applications kept data in their own files. Every program reinvented record layouts, locking and crash recovery — and every program got it slightly wrong. Two clerks updating the same customer file overwrote each other; a crash halfway through a transfer left money debited but never credited; a report written in one language couldn't read files written by another.</p>
<p>The relational model (E. F. Codd, 1970) separated <em>what the data means</em> from <em>how it is stored</em>. An RDBMS gives every application the same guarantees — integrity, concurrency, recoverability and a shared query language — so developers write business logic instead of storage engines. PostgreSQL exists because researchers wanted to push that model further: user-defined types, rules, and extensibility, which is exactly why it adapts so well to new workloads like JSON documents and vector embeddings.</p>`,
  useCase: `
<p><strong>A food-delivery company in India</strong> with 3 million orders a day. Orders, payments, restaurants and riders live in PostgreSQL. A single transaction inserts the order, decrements restaurant stock and records a pending payment — if the payment service times out, the whole transaction rolls back and no phantom order is ever cooked. Analysts query the same data with SQL for daily dashboards, PostGIS (an <span class="tag ext">extension</span>) finds the nearest riders, and <code>jsonb</code> stores flexible per-restaurant menu options. One engine, three workloads, zero licence fees.</p>
<p>In <code>company_db</code> you will see the same shape at small scale: <code>customers</code> place <code>orders</code>, which contain <code>order_items</code> referencing <code>products</code>, settled by <code>payments</code>.</p>`,
  internals: `
<p>Under the hood PostgreSQL stores each table as files of 8&nbsp;kB <strong>pages</strong> in its data directory. Rows (called <em>tuples</em>) carry hidden system columns such as <code>xmin</code> and <code>xmax</code>, the IDs of the transactions that created and deleted that row version. That is the heart of MVCC: an <code>UPDATE</code> writes a <em>new</em> row version and marks the old one as expired, so a concurrent reader still sees the old version until the writer commits. Every change is first written to the <strong>write-ahead log</strong> (WAL) so that after a crash the database can replay committed work. You will meet each of these pieces in the Internals, MVCC and WAL modules.</p>`,
  whenNot: `
<p>A relational database is not always the answer:</p>
<ul>
<li><strong>Tiny, single-user, embedded data</strong> (a mobile app's settings) — SQLite is simpler: a library, not a server.</li>
<li><strong>Pure key-value caching at microsecond latency</strong> — Redis or Memcached in front of PostgreSQL.</li>
<li><strong>Petabyte-scale analytical scans</strong> — a columnar warehouse (ClickHouse, BigQuery, Snowflake) or a columnar <span class="tag ext">extension</span> is a better fit than row storage.</li>
<li><strong>Large binary files</strong> (videos, drone imagery) — keep them in object storage (S3) and store only the URL and metadata in PostgreSQL.</li>
</ul>
<p>Even then, PostgreSQL usually remains the <em>system of record</em> for the business entities.</p>`,
  syntax: `-- Ask the server who and where you are
SELECT version();
SELECT current_database(), current_user;

-- The relational idea in one statement:
SELECT <columns>
FROM   <table>
JOIN   <related_table> ON <related_table>.<key> = <table>.<foreign_key>
WHERE  <condition>;`,
  examples: [
    { label: 'Basic', title: 'Ask PostgreSQL what it is',
      sql: `SELECT version();

SHOW server_version;`,
      explain: `<p><code>version()</code> returns a descriptive string: product, version, platform and compiler. <code>SHOW server_version</code> reads the same information from the configuration system as a short value. Always check this first when you connect to an unfamiliar server — features such as <code>MERGE</code> (15+) or <code>RETURNING</code> in <code>MERGE</code> (17+) depend on it.</p>
<p>In this course's browser engine the string mentions PGlite and wasm32; on a Linux server you would see something like <code>PostgreSQL 18.0 on x86_64-pc-linux-gnu, compiled by gcc ...</code>.</p>`,
      output: ` version
------------------------------------------------------------------------
 PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten, compiled by emcc ...
(1 row)

 server_version
----------------
 18.3
(1 row)`, run: true },
    { label: 'Intermediate', title: 'The relational model in action',
      sql: `-- Department facts are stored once; employees reference them by key.
SELECT d.name        AS department,
       d.location,
       count(e.id)   AS headcount
FROM   departments d
JOIN   employees  e ON e.department_id = d.id
GROUP  BY d.id, d.name, d.location
ORDER  BY headcount DESC, department;`,
      explain: `<p>Two tables are combined through the key relationship <code>employees.department_id → departments.id</code>. Nothing about the department (name, location) is copied into the 200 employee rows; the <code>JOIN</code> reconstructs the combined view on demand.</p>
<ul><li><code>count(e.id)</code> counts employees per group.</li><li><code>GROUP BY d.id, ...</code> produces one output row per department.</li><li>If HR moves from Pune to Mumbai, one row in <code>departments</code> changes and every query sees the new value instantly — no inconsistent copies.</li></ul>`,
      output: ` department  | location  | headcount
-------------+-----------+-----------
 Engineering | Bengaluru |        25
 Finance     | Gurugram  |        25
 HR          | Pune      |        25
 Marketing   | Delhi     |        25
 Operations  | Chennai   |        25
 Research    | Bengaluru |        25
 Sales       | Mumbai    |        25
 Support     | Hyderabad |        25
(8 rows)`, run: true },
    { label: 'Advanced', title: 'Object-relational features in one query',
      sql: `-- jsonb, arrays and window functions: things a "plain" RDBMS can't do as neatly.
SELECT name,
       category,
       price,
       attributes ->> 'brand'                       AS brand,      -- read a JSONB field
       tags,                                                       -- a text[] array column
       'sale' = ANY (tags)                          AS on_sale,    -- array membership test
       rank() OVER (PARTITION BY category
                    ORDER BY price DESC)            AS price_rank  -- window function
FROM   products
WHERE  category = 'audio'
ORDER  BY price_rank
LIMIT  5;`,
      explain: `<p>This query mixes features that make PostgreSQL an <em>object-relational</em> database:</p>
<ul><li><code>attributes -&gt;&gt; 'brand'</code> extracts a text value from a <code>jsonb</code> document stored in a column.</li>
<li><code>tags</code> is a <code>text[]</code> array; <code>'sale' = ANY (tags)</code> checks membership.</li>
<li><code>rank() OVER (...)</code> is a window function: it ranks rows inside each category without collapsing them.</li></ul>
<p>All of this is <span class="tag core">core</span> PostgreSQL — no extension required.</p>`,
      output: ` name            | category | price    | brand | tags          | on_sale | price_rank
-----------------+----------+----------+-------+---------------+---------+------------
 Headset Plus 44 | audio    | 72587.30 | Acme  | {office,sale} | t       |          1
 Headset Plus 64 | audio    | 68547.40 | Acme  | {new}         | f       |          2
 Headset Plus 74 | audio    | 56353.37 | Orbit | {office,sale} | t       |          3
 Headset Plus 94 | audio    | 53941.31 | Orbit | {new}         | f       |          4
 Headset Plus 34 | audio    | 37870.04 | Orbit | {new}         | f       |          5
(5 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Spreadsheet thinking: one wide table, department facts copied into every row
CREATE TEMP TABLE staff_flat (
  employee_name  text,
  department     text,
  dept_location  text
);
INSERT INTO staff_flat VALUES
  ('Asha Rao',   'Engineering', 'Bengaluru'),
  ('Ravi Kumar', 'Engineering', 'Bangalore'),   -- same department, different spelling
  ('Neha Shah',  'Enginering',  'Bengaluru');   -- typo creates a "new" department
SELECT department, dept_location, count(*)
FROM   staff_flat
GROUP  BY 1, 2;`,
      why: 'Copies of the same fact drift apart. A typo silently creates a third "department" and the report shows three groups instead of one. Nothing in the table can stop it.', run: true },
    good: { sql: `-- Relational thinking: the fact lives once, rows reference it by key
SELECT d.name AS department, d.location, count(*) AS staff
FROM   employees e
JOIN   departments d ON d.id = e.department_id
WHERE  d.name = 'Engineering'
GROUP  BY d.name, d.location;`,
      why: 'The department name and location are stored once in departments; the foreign key guarantees every employee points at a real department, so typos and drift are impossible.', run: true }
  },
  mistakes: [
    'Treating the database as a dumb file store and putting all validation in application code — the next script, BI tool or intern bypasses it. Let constraints guard the data.',
    'Calling PostgreSQL "Postgre" or "PostgresSQL". The official names are <strong>PostgreSQL</strong> and the accepted short form <strong>Postgres</strong>.',
    'Assuming SQL written for MySQL or SQL Server works unchanged. Dialects differ (<code>LIMIT</code> vs <code>TOP</code>, <code>AUTO_INCREMENT</code> vs identity, double quotes for identifiers, case-sensitive string comparison).',
    'Choosing a database because it is "web scale" or fashionable instead of matching guarantees (transactions, consistency, query flexibility) to the workload.',
    'Storing large files (PDFs, videos) directly in tables by default instead of object storage plus metadata rows.'
  ],
  best: [
    'Model the business as entities and relationships first; tables follow naturally.',
    'Push integrity rules (types, NOT NULL, UNIQUE, CHECK, FOREIGN KEY) into the database — it is the one place every application must pass through.',
    'Stay on a supported major version and plan a yearly upgrade cadence; check the <code>versioning</code> policy (five years of support per major).',
    'Learn the SQL standard first, PostgreSQL extensions second — your knowledge transfers across databases.',
    'Use <code>company_db</code> in this course as your sandbox: every runnable example is rolled back, so experiment freely.'
  ],
  performance: `
<p>An RDBMS is fast because of three things you will learn in depth later: <strong>indexes</strong> (find 1 row out of 100 million in a handful of page reads), the <strong>cost-based optimizer</strong> (chooses the cheapest plan from statistics), and the <strong>shared buffer cache</strong> (keeps hot pages in RAM). A well-indexed PostgreSQL server on modest hardware routinely handles tens of thousands of simple transactions per second. Most "the database is slow" incidents are missing indexes or poorly written queries — not the engine.</p>`,
  security: `
<p>A DBMS centralises security: authentication (<code>pg_hba.conf</code>, SCRAM passwords, TLS certificates), authorisation (roles, <code>GRANT</code>/<code>REVOKE</code>, row-level security) and auditing all live in one place. That is far safer than spreading data across files with operating-system permissions. Never connect applications as the superuser <code>postgres</code>; create dedicated least-privilege roles (covered in the Security module).</p>`,
  widgets: ['diagram:client-server'],
  interview: [
    { q: 'What is the difference between a database and a DBMS?', a: 'The database is the organised data itself; the DBMS is the software that stores it, enforces integrity, manages concurrent access, recovers from crashes and executes queries. PostgreSQL is a DBMS; company_db is a database managed by it.' },
    { q: 'What does "object-relational" mean for PostgreSQL?', a: 'Beyond the classic relational model, PostgreSQL supports user-defined types, operators, functions and index methods, plus rich built-in types such as arrays, ranges, jsonb and composite types. That extensibility is why projects like PostGIS and pgvector can add new data types and index methods as extensions without forking the database.' },
    { q: 'Why might a team choose PostgreSQL over MySQL?', a: 'Stronger standards compliance, transactional DDL for safe migrations, richer types (jsonb with GIN indexing, ranges, arrays), more index types, powerful extensions (PostGIS, pgvector, Citus) and a permissive licence with no single vendor. MySQL can still be a good fit for simple read-heavy web workloads and teams with deep MySQL operational experience.' },
    { q: 'Explain ACID briefly with an example.', a: 'A funds transfer debits one account and credits another. Atomicity: both happen or neither. Consistency: constraints such as "balance >= 0" hold after commit. Isolation: other sessions never see the money missing from both accounts mid-transfer. Durability: after COMMIT returns, the transfer survives a crash because it is in the WAL on disk.' }
  ],
  exercises: [
    { task: 'Show the current database name, the current user and the server version number (as an integer, e.g. 180003).', solution: `SELECT current_database(), current_user, current_setting('server_version_num')::int AS version_num;`, run: true },
    { task: 'List every table in the public schema of company_db together with its estimated row count (pg_class.reltuples).', solution: `SELECT c.relname AS table_name, c.reltuples::bigint AS est_rows
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND c.relkind = 'r'
ORDER  BY est_rows DESC;`, run: true },
    { task: 'Using a join, list each project name with the name of the department that owns it.', solution: `SELECT p.name AS project, d.name AS department
FROM   projects p
JOIN   departments d ON d.id = p.department_id
ORDER  BY p.id;`, run: true }
  ],
  challenge: { task: 'Prove the value of a single source of truth: in one transaction, rename the department "HR" to "People Operations", then show how many employees now belong to "People Operations" — without touching the employees table.', hint: 'UPDATE departments, then join employees to departments.', solution: `UPDATE departments SET name = 'People Operations' WHERE name = 'HR';

SELECT d.name, count(*) AS employees
FROM   employees e
JOIN   departments d ON d.id = e.department_id
WHERE  d.name = 'People Operations'
GROUP  BY d.name;`, run: true },
  related: ['fundamentals-architecture', 'database-design-keys-relationships', 'sql-fundamentals', 'mvcc'],
  quiz: [
    { type: 'mcq', q: 'Which of these is NOT a guarantee of ACID?', options: ['Atomicity', 'Consistency', 'Indexing', 'Durability'], answer: 2, explain: 'ACID = Atomicity, Consistency, Isolation, Durability. Indexing is a performance feature, not a transactional guarantee.' },
    { type: 'tf', q: 'PostgreSQL is owned and sold by a single company.', answer: false, explain: 'PostgreSQL is developed by the community-run PostgreSQL Global Development Group under a permissive open-source licence. Many companies contribute and sell services, but none owns it.' },
    { type: 'mcq', q: 'In PostgreSQL, can CREATE TABLE be rolled back inside a transaction?', options: ['No, DDL always auto-commits', 'Yes, DDL is transactional', 'Only for temporary tables', 'Only in SERIALIZABLE isolation'], answer: 1, explain: 'PostgreSQL supports transactional DDL: CREATE/ALTER/DROP inside BEGIN ... ROLLBACK are undone. MySQL and Oracle implicitly commit around most DDL.' },
    { type: 'design', q: 'A startup stores 50 TB of drone videos and needs to search them by site, date and tags. Best design?', options: ['Store the videos as bytea in PostgreSQL', 'Store videos in object storage; store metadata (site, date, tags, URL) in PostgreSQL', 'Use a spreadsheet', 'Store everything in one jsonb column'], answer: 1, explain: 'Large binaries belong in object storage. PostgreSQL holds searchable, indexed metadata and the object key/URL — the best of both.' },
    { type: 'predict', q: 'company_db stores each department once and employees reference it. What happens to queries after UPDATE departments SET location = \'Noida\' WHERE name = \'Finance\'?', code: `UPDATE departments SET location = 'Noida' WHERE name = 'Finance';
SELECT DISTINCT d.location
FROM employees e JOIN departments d ON d.id = e.department_id
WHERE d.name = 'Finance';`, options: ['Noida', 'Gurugram', 'Both Noida and Gurugram', 'An error'], answer: 0, explain: 'Because the location is stored once, a single-row update changes it for all 25 Finance employees at once.' }
  ]
},
{
  id: 'fundamentals-architecture',
  module: 'fundamentals',
  title: 'PostgreSQL Architecture and the Process Model',
  level: 1,
  minutes: 20,
  summary: 'How a PostgreSQL server is organised: the postmaster, one backend process per connection, background workers, shared memory and the data directory.',
  objectives: [
    'Describe the client/server model and the wire protocol between an application and PostgreSQL',
    'Explain what the postmaster does and why each connection gets its own backend process',
    'Name the main background processes (checkpointer, background writer, WAL writer, autovacuum launcher, WAL archiver/sender, logical replication launcher)',
    'Distinguish shared memory (shared_buffers, WAL buffers) from per-backend memory (work_mem, maintenance_work_mem)',
    'Inspect running processes with pg_stat_activity and server settings with pg_settings',
    'Explain why too many connections hurt and why connection poolers exist'
  ],
  concept: `
<p>PostgreSQL is a <strong>client/server</strong> database. Your application (the <em>client</em>) opens a network connection — usually TCP port <code>5432</code> or a Unix-domain socket — and speaks the PostgreSQL <em>frontend/backend protocol</em>. The <em>server</em> parses your SQL, plans it, executes it and streams rows back.</p>
<p><strong>Analogy: a restaurant.</strong> The <strong>postmaster</strong> is the host at the front door: it does not cook, it greets each guest, checks the reservation list (<code>pg_hba.conf</code>) and assigns a dedicated waiter. Each <strong>backend process</strong> is that waiter — it serves exactly one table (one connection) for the whole visit. The kitchen's shared pantry is <strong>shared memory</strong> (<code>shared_buffers</code>), used by all waiters. Behind the scenes, staff who never meet guests keep things running: the dishwasher (<strong>autovacuum</strong>), the person who periodically restocks the cold room (<strong>checkpointer</strong>), and the one writing every order into the ledger before it is cooked (<strong>WAL writer</strong>).</p>
<h4>The process model</h4>
<ul>
<li><strong>postmaster</strong> (shown as <code>postgres</code> in <code>ps</code>) — the first process. It allocates shared memory, starts background processes, listens for connections and <em>forks</em> a new backend for every client. If any backend crashes, the postmaster resets shared memory and restarts the others to protect data.</li>
<li><strong>Backend (client backend)</strong> — one operating-system process <em>per connection</em>. It parses, plans and executes that session's queries. Its PID is what <code>pg_backend_pid()</code> returns and what you pass to <code>pg_cancel_backend()</code>.</li>
<li><strong>Background processes</strong>: <em>checkpointer</em> (flushes dirty pages and writes checkpoint records), <em>background writer</em> (trickles dirty buffers to disk), <em>WAL writer</em> (flushes WAL buffers), <em>autovacuum launcher</em> + workers (remove dead row versions, update statistics), <em>WAL archiver</em> (copies finished WAL segments for PITR), <em>WAL sender/receiver</em> (replication), <em>logical replication launcher</em>, and in PostgreSQL 18 <em>io workers</em> for the new asynchronous I/O subsystem.</li>
<li><strong>Parallel workers</strong> — a backend can borrow extra worker processes to scan or aggregate large tables in parallel.</li>
</ul>
<h4>Memory</h4>
<ul>
<li><strong>Shared memory</strong>: <code>shared_buffers</code> (the page cache, commonly ~25% of RAM), WAL buffers, the lock table, and the commit-status cache.</li>
<li><strong>Per-backend memory</strong>: <code>work_mem</code> (per sort/hash operation, not per query!), <code>maintenance_work_mem</code> (for VACUUM, CREATE INDEX), <code>temp_buffers</code>, plus catalog caches.</li>
<li>The operating system's own page cache sits underneath; PostgreSQL deliberately relies on it ("double buffering").</li>
</ul>
<h4>On disk: the data directory</h4>
<p>Everything lives under one directory (<code>PGDATA</code>, e.g. <code>/var/lib/postgresql/18/main</code>): <code>base/</code> holds one sub-directory per database with one file per table/index, <code>pg_wal/</code> holds the write-ahead log, <code>global/</code> holds cluster-wide catalogs (roles, databases), and <code>postgresql.conf</code>/<code>pg_hba.conf</code> configure the server.</p>
<div class="callout info"><strong>In this course's browser engine</strong> there is only one process (<code>backend_type = 'standalone backend'</code>): PGlite runs PostgreSQL in single-user mode inside WebAssembly. A real server shows a postmaster plus a dozen processes; the diagrams below show that full picture.</div>`,
  why: `
<p>The process-per-connection design dates from the 1980s, and it buys <strong>isolation and robustness</strong>: a bug that crashes one backend cannot scribble over another session's private memory, and the postmaster can recover cleanly. Separating background work (checkpointing, vacuuming, WAL flushing) from query execution keeps user-facing latency predictable — your <code>INSERT</code> does not wait for a full disk flush of every modified page, only for its WAL record.</p>
<p>Understanding this model explains many production behaviours: why <code>max_connections = 5000</code> is a bad idea, why idle connections still consume memory, why a single huge sort can exhaust RAM (<code>work_mem</code> × operations × connections), and why tools like PgBouncer exist.</p>`,
  useCase: `
<p><strong>A SaaS company runs 40 application pods</strong>, each with a connection pool of 25. That is 1,000 PostgreSQL backends — 1,000 processes, each costing several MB of private memory plus snapshot-computation overhead, though only ~60 queries are ever active at once. The DBA puts <span class="tag tool">third-party tool</span> PgBouncer in transaction-pooling mode between the pods and the database: the apps still open 1,000 client connections, but PostgreSQL sees only 80 server connections. CPU drops by 30% and p99 latency stabilises. That decision is only obvious once you know each connection is a full OS process.</p>`,
  internals: `
<p>When a client connects: (1) the postmaster accepts the socket, (2) forks a child process, (3) the child performs authentication according to the first matching line of <code>pg_hba.conf</code> (e.g. SCRAM-SHA-256), (4) loads the target database's catalogs, then (5) enters a loop reading messages. For each simple query it runs <strong>parse → analyze/rewrite → plan → execute</strong> and sends <code>RowDescription</code>, <code>DataRow</code>… <code>CommandComplete</code> and <code>ReadyForQuery</code> messages back.</p>
<p>When the executor needs a page, it looks in <code>shared_buffers</code>; on a miss it reads the 8&nbsp;kB page from the OS. Modified pages become <em>dirty</em>; before any dirty page may reach disk, the WAL record describing the change must be flushed (the <em>write-ahead</em> rule). At <code>COMMIT</code> only the WAL is fsynced; the data pages are written later by the background writer and checkpointer.</p>`,
  whenNot: `
<p>You rarely change the architecture, but you should know its limits:</p>
<ul>
<li>Do <strong>not</strong> scale by raising <code>max_connections</code> into the thousands. Use a pooler (PgBouncer, pgcat, or your driver's pool) and keep active backends near a small multiple of CPU cores.</li>
<li>Do <strong>not</strong> set <code>work_mem</code> high globally "to make sorts fast" — it is per operation per backend. Raise it per session or per role for reporting jobs.</li>
<li>For an embedded, in-process database without a server, PGlite or SQLite fit better than a full PostgreSQL server.</li>
</ul>`,
  syntax: `-- Who is connected and what are they doing?
SELECT pid, backend_type, state, usename, datname, query
FROM   pg_stat_activity;

-- Your own backend process id
SELECT pg_backend_pid();

-- Read server settings
SHOW max_connections;
SELECT name, setting, unit, context FROM pg_settings WHERE name = 'shared_buffers';

-- Cancel the current query of a backend / terminate the backend
SELECT pg_cancel_backend(<pid>);
SELECT pg_terminate_backend(<pid>);`,
  examples: [
    { label: 'Basic', title: 'Find your own backend process',
      sql: `SELECT pg_backend_pid()  AS my_pid,
       current_database() AS db,
       current_user       AS role_name;`,
      explain: `<p>Every connection is served by one backend process; <code>pg_backend_pid()</code> returns its operating-system PID. On a Linux server you could run <code>ps -fp &lt;pid&gt;</code> and see a line like <code>postgres: app_user company_db 10.0.0.12(51234) idle</code> — the process title shows user, database, client address and state.</p>`,
      output: ` my_pid | db       | role_name
--------+----------+-----------
     42 | postgres | postgres
(1 row)`, run: true },
    { label: 'Intermediate', title: 'See every process with pg_stat_activity',
      sql: `SELECT pid,
       backend_type,
       state,
       usename,
       datname,
       left(query, 40) AS current_query
FROM   pg_stat_activity
ORDER  BY backend_type;`,
      explain: `<p><code>pg_stat_activity</code> has one row per server process. On a production server you will see rows such as:</p>
<table><tr><th>backend_type</th><th>meaning</th></tr>
<tr><td>client backend</td><td>a user connection (state <code>active</code>, <code>idle</code>, <code>idle in transaction</code>)</td></tr>
<tr><td>checkpointer</td><td>periodic checkpoints</td></tr>
<tr><td>background writer</td><td>writes dirty buffers ahead of need</td></tr>
<tr><td>walwriter</td><td>flushes WAL buffers</td></tr>
<tr><td>autovacuum launcher</td><td>schedules autovacuum workers</td></tr>
<tr><td>logical replication launcher</td><td>starts subscription workers</td></tr>
<tr><td>io worker</td><td>PostgreSQL 18 asynchronous I/O workers</td></tr></table>
<p>In the single-process browser engine there is just one standalone backend.</p>`,
      output: ` pid | backend_type       | state  | usename | datname  | current_query
-----+--------------------+--------+---------+----------+------------------------------------------
  42 | standalone backend | active |         | postgres | SELECT pid,
(1 row)

-- On a real server, typically:
  pid  | backend_type                 | state  | usename  | datname
-------+------------------------------+--------+----------+------------
  1021 | autovacuum launcher          |        |          |
  1023 | logical replication launcher |        | postgres |
  1018 | background writer            |        |          |
  1017 | checkpointer                 |        |          |
  2210 | client backend               | active | app_user | company_db
  1020 | walwriter                    |        |          |`, run: true },
    { label: 'Advanced', title: 'Inspect the memory and connection settings',
      sql: `SELECT name,
       setting,
       unit,
       context,
       CASE WHEN unit = '8kB' THEN pg_size_pretty(setting::bigint * 8192)
            WHEN unit = 'kB'  THEN pg_size_pretty(setting::bigint * 1024)
       END AS human_size
FROM   pg_settings
WHERE  name IN ('max_connections', 'superuser_reserved_connections',
                'shared_buffers', 'work_mem', 'maintenance_work_mem',
                'wal_buffers', 'max_worker_processes')
ORDER  BY name;`,
      explain: `<p><code>pg_settings</code> is the SQL view of the configuration. Columns to know:</p>
<ul><li><code>setting</code> + <code>unit</code> — <code>shared_buffers</code> is stored in 8&nbsp;kB pages, so 16384 × 8&nbsp;kB = 128&nbsp;MB (the default).</li>
<li><code>context</code> — <code>postmaster</code> means "requires a restart" (shared memory is sized at startup); <code>user</code> means any session may <code>SET</code> it.</li></ul>
<p>Rule of thumb for a dedicated server: <code>shared_buffers</code> ≈ 25% of RAM, <code>work_mem</code> 4–64&nbsp;MB, <code>maintenance_work_mem</code> 256&nbsp;MB–2&nbsp;GB, <code>max_connections</code> a few hundred at most with a pooler in front.</p>`,
      output: ` name                           | setting | unit | context    | human_size
--------------------------------+---------+------+------------+------------
 maintenance_work_mem           | 65536   | kB   | user       | 64 MB
 max_connections                | 100     |      | postmaster |
 max_worker_processes           | 0       |      | postmaster |
 shared_buffers                 | 16384   | 8kB  | postmaster | 128 MB
 superuser_reserved_connections | 3       |      | postmaster |
 wal_buffers                    | 512     | 8kB  | postmaster | 4096 kB
 work_mem                       | 4096    | kB   | user       | 4096 kB
(7 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- "We have 2,000 users, so set max_connections = 2000"
-- (postgresql.conf)
max_connections = 2000
work_mem        = '256MB'   -- "make every sort fast"`,
      why: '2,000 backend processes thrash CPU caches and lock tables, and work_mem is per sort/hash node per backend: a few concurrent reports could request hundreds of GB and trigger the OOM killer.', run: false },
    good: { sql: `-- Keep backends few; multiplex clients with a pooler; raise memory only where needed
-- (postgresql.conf)
max_connections = 200
work_mem        = '16MB'
-- PgBouncer (third-party tool) in transaction mode: default_pool_size = 40

-- for the nightly reporting role only:
ALTER ROLE reporting SET work_mem = '256MB';`,
      why: 'A pooler lets thousands of clients share a few dozen backends; memory-hungry settings are scoped to the role that needs them.', run: false }
  },
  mistakes: [
    'Believing PostgreSQL uses threads per connection like MySQL — it forks a full process, so each idle connection still costs memory and slows snapshot computation.',
    'Leaving sessions <code>idle in transaction</code>: they hold locks and prevent VACUUM from cleaning up rows. Set <code>idle_in_transaction_session_timeout</code>.',
    'Treating <code>work_mem</code> as a per-query or global limit. It applies per sort/hash operation, so one complex query can use several multiples of it.',
    'Killing backends with <code>kill -9</code> at the OS level. That forces the postmaster to restart all sessions; use <code>pg_cancel_backend()</code> or <code>pg_terminate_backend()</code>.',
    'Setting <code>shared_buffers</code> to 80% of RAM — PostgreSQL also relies on the OS page cache, and you starve both.'
  ],
  best: [
    'Put a connection pooler in front of PostgreSQL for any application with many app servers or short-lived connections.',
    'Monitor <code>pg_stat_activity</code> by state: many <code>idle in transaction</code> sessions are a red flag.',
    'Start with <code>shared_buffers</code> ≈ 25% of RAM and <code>effective_cache_size</code> ≈ 50–75% of RAM on a dedicated host.',
    'Use <code>application_name</code> in connection strings so every backend in <code>pg_stat_activity</code> identifies its service.',
    'Restart-only settings (<code>context = postmaster</code>) should be changed in planned maintenance windows.'
  ],
  performance: `
<p>Each backend costs roughly 2–10&nbsp;MB of private memory when idle and much more when sorting or hashing. More importantly, every snapshot a transaction takes must look at all active backends, so throughput drops when hundreds of connections are open even if idle. Benchmarks typically peak when <em>active</em> connections ≈ 2–4 × CPU cores. Background processes smooth out I/O: a well-tuned checkpointer (<code>checkpoint_timeout</code>, <code>max_wal_size</code>) avoids I/O spikes, and autovacuum prevents table bloat that would make every scan slower.</p>`,
  security: `
<p>The postmaster authenticates every connection against <code>pg_hba.conf</code> before forking work for it, and each backend runs as the unprivileged <code>postgres</code> OS user — never root. Restrict <code>listen_addresses</code> to the interfaces you need, firewall port 5432, and use <code>pg_terminate_backend()</code> (requires being the role's owner, a superuser or a member of <code>pg_signal_backend</code>) to evict misbehaving sessions.</p>`,
  scenario: { title: 'The database "freezes" every Monday at 9 a.m.', steps: [
    '1. Query pg_stat_activity grouped by state: you find 1,800 connections, 1,650 of them idle.',
    '2. Check application pools: 60 pods × 30 connections each, all opened at the Monday deploy.',
    '3. Observe that CPU is high in snapshot and lock management, not in query execution.',
    '4. Introduce PgBouncer in transaction mode with a server pool of 60, and lower max_connections to 300.',
    '5. Set idle_in_transaction_session_timeout = 60s to kill stuck transactions.',
    '6. Re-measure: active connections ~40, p99 latency down from 2.4s to 90ms.'
  ] },
  widgets: ['diagram:pg-arch', 'diagram:process-model', 'diagram:client-server'],
  interview: [
    { q: 'What is the postmaster and what does it do?', a: 'It is the supervisor process started first. It sizes and allocates shared memory, starts background processes, listens on the configured ports and forks a dedicated backend for each new connection. If a backend crashes it reinitialises shared memory and restarts other processes to guarantee consistency.' },
    { q: 'Why does PostgreSQL use a process per connection and what are the consequences?', a: 'Processes give strong isolation: one crashing backend cannot corrupt others\' private memory, and the code is simpler and portable. The cost is higher memory and context-switch overhead per connection and slower snapshot computation with many connections, which is why poolers like PgBouncer are standard in production.' },
    { q: 'Name four background processes and their roles.', a: 'Checkpointer writes all dirty buffers and a checkpoint record so recovery starts from a known point; background writer trickles dirty pages to disk; WAL writer flushes WAL buffers; autovacuum launcher starts workers that remove dead tuples and refresh statistics. Others include the WAL archiver, WAL sender, logical replication launcher and, in 18, I/O workers.' },
    { q: 'What is the difference between shared_buffers and work_mem?', a: 'shared_buffers is a single shared page cache allocated at server start and used by all backends. work_mem is private memory each backend may use for each sort or hash operation before spilling to temporary files, so its total footprint scales with concurrency and query complexity.' }
  ],
  exercises: [
    { task: 'Show your backend PID and the server port setting.', solution: `SELECT pg_backend_pid() AS pid, current_setting('port') AS port;`, run: true },
    { task: 'List the settings in pg_settings whose context is postmaster (require a restart), showing only name and setting, first 10 alphabetically.', solution: `SELECT name, setting
FROM   pg_settings
WHERE  context = 'postmaster'
ORDER  BY name
LIMIT  10;`, run: true },
    { task: 'Count the processes in pg_stat_activity grouped by backend_type.', solution: `SELECT backend_type, count(*)
FROM   pg_stat_activity
GROUP  BY backend_type
ORDER  BY 2 DESC;`, run: true }
  ],
  challenge: { task: 'Write a monitoring query that, for client backends, shows state, the number of sessions in that state, and the age of the oldest transaction in that state (now() - min(xact_start)). It must work on a busy server and in the single-process playground.', hint: 'Filter backend_type IN (\'client backend\', \'standalone backend\'); aggregate with count(*) and min(xact_start).', solution: `SELECT state,
       count(*)                         AS sessions,
       max(now() - xact_start)          AS oldest_xact_age
FROM   pg_stat_activity
WHERE  backend_type IN ('client backend', 'standalone backend')
GROUP  BY state
ORDER  BY sessions DESC;`, run: true },
  related: ['fundamentals-connecting', 'internals', 'connection-pooling', 'monitoring'],
  quiz: [
    { type: 'mcq', q: 'How many backend processes serve 50 open client connections (no pooler)?', options: ['1 shared process', '50 — one per connection', 'One per CPU core', 'One per database'], answer: 1, explain: 'PostgreSQL forks one backend process per connection.' },
    { type: 'tf', q: 'work_mem is the total memory one query may use.', answer: false, explain: 'work_mem is per sort/hash operation; a query with three sorts and two hash joins can use about 5 × work_mem (more with parallel workers).' },
    { type: 'mcq', q: 'Which process writes dirty data pages and a checkpoint record periodically?', options: ['WAL sender', 'Checkpointer', 'Autovacuum launcher', 'Postmaster'], answer: 1, explain: 'The checkpointer performs checkpoints; the background writer also writes dirty pages but does not create checkpoints.' },
    { type: 'scenario', q: 'pg_settings shows shared_buffers with context = postmaster. You change it in postgresql.conf and run SELECT pg_reload_conf(). What happens?', options: ['It takes effect immediately', 'It takes effect for new connections', 'Nothing until the server is restarted (pending_restart = true)', 'The server crashes'], answer: 2, explain: 'Settings with context postmaster need a full restart; pg_settings.pending_restart becomes true after reload.' },
    { type: 'design', q: '300 microservice pods each want 20 connections. What do you do?', options: ['Set max_connections = 6000', 'Add a pooler (e.g. PgBouncer in transaction mode) and keep backends to a few hundred', 'Use one connection per pod and serialise all queries', 'Increase shared_buffers'], answer: 1, explain: 'Thousands of backends waste memory and CPU; a pooler multiplexes many client connections onto few server connections.' }
  ]
},
{
  id: 'fundamentals-cluster-database-schema',
  module: 'fundamentals',
  title: 'Cluster, Database, Schema, Table, Row and Column',
  level: 1,
  minutes: 20,
  summary: 'The PostgreSQL object hierarchy — cluster → database → schema → table → row/column — plus CREATE/DROP DATABASE, CREATE/DROP SCHEMA and the search_path.',
  objectives: [
    'Explain the hierarchy cluster → database → schema → table → row/column and what is shared at each level',
    'Create and drop databases (CREATE DATABASE, DROP DATABASE ... WITH (FORCE)) and understand template databases',
    'Create, use and drop schemas, including DROP SCHEMA ... CASCADE',
    'Explain how search_path resolves unqualified names and why it matters for security',
    'Decide between separate databases and separate schemas for isolating applications or tenants',
    'Query pg_database, pg_namespace and information_schema to inspect the hierarchy'
  ],
  concept: `
<p>PostgreSQL organises objects in a strict hierarchy. Getting the vocabulary right avoids a whole class of confusing errors ("relation does not exist", "cannot connect to database").</p>
<p><strong>Analogy: an office building.</strong> The <strong>cluster</strong> is the building — one address (host:port), one security desk (<code>pg_hba.conf</code>), one set of staff badges (roles). Each <strong>database</strong> is a separately-locked floor: once you step out of the lift you can only move around that floor. Each <strong>schema</strong> is a department area on the floor — walls are low, you can walk to another department if you have permission. A <strong>table</strong> is a filing cabinet, every <strong>row</strong> is a folder and every <strong>column</strong> is a labelled field on the folder's cover.</p>
<table>
<tr><th>Level</th><th>What it is</th><th>Shared across children?</th><th>Catalog</th></tr>
<tr><td><strong>Cluster</strong> (instance)</td><td>One running server: one data directory, one postmaster, one port</td><td>Roles, tablespaces, configuration, WAL</td><td><code>pg_database</code>, <code>pg_roles</code></td></tr>
<tr><td><strong>Database</strong></td><td>An isolated collection of schemas. A connection is bound to exactly one database</td><td>Nothing with other databases — no cross-database joins</td><td><code>pg_database</code></td></tr>
<tr><td><strong>Schema</strong></td><td>A namespace inside a database (<code>public</code>, <code>sales</code>, <code>tenant_42</code>)</td><td>You can join tables in different schemas freely</td><td><code>pg_namespace</code></td></tr>
<tr><td><strong>Table</strong> (relation)</td><td>A set of rows with a fixed list of typed columns</td><td>—</td><td><code>pg_class</code>, <code>pg_attribute</code></td></tr>
<tr><td><strong>Row</strong> / <strong>Column</strong></td><td>One record / one named, typed attribute</td><td>—</td><td>—</td></tr>
</table>
<h4>Databases</h4>
<p>A fresh cluster contains <code>postgres</code> (a default database for connecting), <code>template1</code> (the template every <code>CREATE DATABASE</code> copies — install extensions here to get them everywhere) and <code>template0</code> (a pristine, read-only template used for restores with a different encoding or locale). Because each database has its own system catalogs, a query in <code>company_db</code> cannot reference a table in <code>analytics_db</code>; you would need the <code>postgres_fdw</code> <span class="tag ext">extension</span> or <code>dblink</code>.</p>
<h4>Schemas and the search_path</h4>
<p>Every object name is really <code>schema.object</code>. When you write an unqualified name like <code>employees</code>, PostgreSQL walks the <code>search_path</code> list (default <code>"$user", public</code>) and uses the first schema that contains it. <code>pg_catalog</code> is always searched first implicitly, which is why built-ins like <code>now()</code> work everywhere. New objects are created in the <em>first</em> existing schema of the path.</p>
<div class="callout warn"><strong>PostgreSQL 15 changed the default:</strong> ordinary users no longer have <code>CREATE</code> privilege on the <code>public</code> schema (it is owned by <code>pg_database_owner</code>). If an application suddenly gets "permission denied for schema public" after an upgrade, that is why — create a dedicated schema owned by the app role.</div>
<h4>Identifiers</h4>
<p>Unquoted identifiers are folded to lower case: <code>CREATE TABLE Orders</code> creates <code>orders</code>. Double quotes preserve case (<code>"Orders"</code>) — and then you must quote it forever. Use lower_snake_case and never quote.</p>`,
  why: `
<p>The hierarchy exists to give you the right <em>level of isolation</em> for each need. Databases offer hard isolation (separate catalogs, separate connection permissions) — good for unrelated applications sharing hardware. Schemas offer soft isolation inside one database — good for organising a large application into modules (<code>billing</code>, <code>inventory</code>, <code>audit</code>), separating extensions from app tables, or giving each tenant its own namespace while still allowing cross-schema reporting queries. The cluster level lets roles and configuration be managed once for everything on the server.</p>`,
  useCase: `
<p><strong>A B2B analytics SaaS with 300 customers.</strong> The team considers three designs: one database per tenant (300 connection pools, 300× migrations — rejected), one schema per tenant (<code>tenant_0001.events</code> … — workable to a few thousand tenants, easy per-tenant backup with <code>pg_dump -n</code>), or shared tables with a <code>tenant_id</code> column plus row-level security (scales to millions of tenants). They choose shared tables for small tenants and a dedicated schema for their five largest enterprise customers who need data-residency guarantees. Meanwhile, the <code>reporting</code> schema holds read-only views for the BI tool, and the <code>extensions</code> schema holds <code>pg_trgm</code> and <code>citext</code> so <code>public</code> stays clean.</p>`,
  internals: `
<p>On disk, <code>$PGDATA/base/&lt;database_oid&gt;/</code> is a directory per database containing files named by each table's <code>relfilenode</code>. Schemas have no directory of their own — they are just rows in <code>pg_namespace</code>, and every table row in <code>pg_class</code> carries a <code>relnamespace</code> pointing at its schema. That is why moving a table between schemas (<code>ALTER TABLE ... SET SCHEMA</code>) is instant, while "moving" a table between databases requires copying the data. <code>CREATE DATABASE</code> works by copying the template database (by default using WAL-logged block copy since PostgreSQL 15), which is why nobody may be connected to the template while it runs.</p>`,
  whenNot: `
<ul>
<li><strong>Don't create a database per tenant</strong> unless tenants are few and need hard isolation; each database needs its own connection pool and migrations.</li>
<li><strong>Don't create thousands of schemas</strong> with identical tables — catalog bloat slows planning, <code>pg_dump</code> and migrations. Beyond a few thousand tenants, use a <code>tenant_id</code> column with row-level security.</li>
<li><strong>Don't rely on <code>search_path</code> in security-sensitive code</strong> (functions with <code>SECURITY DEFINER</code>); schema-qualify names or pin <code>SET search_path</code> on the function.</li>
<li><strong>Don't use schemas as a backup/versioning tool</strong> (<code>orders_old</code>, <code>orders_v2</code> in random schemas) — use migrations and proper backups.</li>
</ul>`,
  syntax: `-- Databases (cluster level; cannot run inside a transaction block)
CREATE DATABASE name [ OWNER role ] [ TEMPLATE template ] [ ENCODING 'UTF8' ]
       [ LOCALE_PROVIDER icu ] [ ICU_LOCALE 'und' ] [ CONNECTION LIMIT n ];
ALTER  DATABASE name RENAME TO new_name;
DROP   DATABASE [ IF EXISTS ] name [ WITH (FORCE) ];

-- Schemas (database level)
CREATE SCHEMA [ IF NOT EXISTS ] name [ AUTHORIZATION role ];
ALTER  SCHEMA name RENAME TO new_name;
DROP   SCHEMA [ IF EXISTS ] name [ CASCADE | RESTRICT ];

-- Name resolution
SHOW search_path;
SET  search_path = schema1, schema2, public;
ALTER ROLE app_user SET search_path = app, public;   -- persistent default`,
  examples: [
    { label: 'Basic', title: 'Create a schema and a table inside it',
      sql: `CREATE SCHEMA sales_archive;

-- Copy 2024 orders into the new schema (schema-qualified name)
CREATE TABLE sales_archive.orders_2024 AS
SELECT id, customer_id, total_amount
FROM   orders
WHERE  order_date < '2025-01-01';

-- Two tables called "orders...", in two different schemas
SELECT table_schema, table_name
FROM   information_schema.tables
WHERE  table_name LIKE 'orders%'
ORDER  BY 1, 2;`,
      explain: `<p><code>CREATE SCHEMA</code> adds a namespace to the current database. Writing <code>sales_archive.orders_2024</code> places the table explicitly in that schema regardless of the <code>search_path</code>. <code>information_schema.tables</code> is the SQL-standard catalog view that lists every table with its schema.</p>`,
      output: `CREATE SCHEMA
SELECT 2902

 table_schema  | table_name
---------------+-------------
 public        | orders
 sales_archive | orders_2024
(2 rows)`, run: true },
    { label: 'Intermediate', title: 'How search_path picks a table',
      sql: `SHOW search_path;

CREATE SCHEMA reporting;
CREATE TABLE reporting.departments (id int, name text);
INSERT INTO reporting.departments VALUES (1, 'Reporting copy');

SELECT name FROM departments WHERE id = 1;   -- resolves to public.departments

SET search_path = reporting, public;
SELECT name FROM departments WHERE id = 1;   -- now resolves to reporting.departments
SELECT count(*) AS employees_still_visible FROM employees;  -- falls through to public

SELECT current_schema(), current_schemas(false);`,
      explain: `<p>The same unqualified name <code>departments</code> resolves to different tables depending on <code>search_path</code>:</p>
<ol><li>With the path <code>public</code>, it finds <code>public.departments</code> → <em>Engineering</em>.</li>
<li>After <code>SET search_path = reporting, public</code>, <code>reporting</code> is searched first → <em>Reporting copy</em>.</li>
<li><code>employees</code> doesn't exist in <code>reporting</code>, so lookup falls through to <code>public</code>.</li></ol>
<p><code>current_schema()</code> is where new objects go; <code>current_schemas(false)</code> lists the effective path. On a standard server <code>SHOW search_path</code> prints <code>"$user", public</code> (the playground engine uses just <code>public</code>).</p>`,
      output: ` search_path
-----------------
 "$user", public        -- playground shows: public

 name
-------------
 Engineering

 name
----------------
 Reporting copy

 employees_still_visible
-------------------------
                     200

 current_schema | current_schemas
----------------+--------------------
 reporting      | {reporting,public}`, run: true },
    { label: 'Advanced', title: 'Schema-per-tenant and DROP SCHEMA CASCADE',
      sql: `CREATE SCHEMA tenant_a;
CREATE SCHEMA tenant_b;

CREATE TABLE tenant_a.invoices (
  id     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amount numeric(10,2) NOT NULL
);
-- Clone the structure (columns, defaults, constraints, indexes) for tenant_b
CREATE TABLE tenant_b.invoices (LIKE tenant_a.invoices INCLUDING ALL);

INSERT INTO tenant_a.invoices (amount) VALUES (100), (250);
INSERT INTO tenant_b.invoices (amount) VALUES (999);

-- Cross-schema reporting is a normal query (impossible across databases)
SELECT 'tenant_a' AS tenant, count(*), sum(amount) FROM tenant_a.invoices
UNION ALL
SELECT 'tenant_b', count(*), sum(amount) FROM tenant_b.invoices;

-- Offboard tenant_b: RESTRICT (the default) would fail because the schema is not empty
DROP SCHEMA tenant_b CASCADE;`,
      explain: `<p>Each tenant gets an identical table in its own schema. <code>LIKE ... INCLUDING ALL</code> copies defaults, identity, constraints, indexes and comments. Because schemas live inside one database, a single query can aggregate across tenants.</p>
<p><code>DROP SCHEMA tenant_b</code> without <code>CASCADE</code> raises <em>cannot drop schema tenant_b because other objects depend on it</em>. <code>CASCADE</code> drops every contained object — tables, views, functions, sequences. Powerful and dangerous: always list contents first.</p>`,
      output: ` tenant   | count | sum
----------+-------+--------
 tenant_a |     2 | 350.00
 tenant_b |     1 | 999.00
(2 rows)

NOTICE:  drop cascades to table tenant_b.invoices
DROP SCHEMA`, run: true }
  ],
  compare: {
    bad: { sql: `-- Relying on whatever search_path happens to be set
CREATE SCHEMA app;
CREATE TABLE app.settings (k text PRIMARY KEY, v text);
SET search_path = public;
SELECT * FROM settings;   -- ERROR: relation "settings" does not exist`,
      why: 'Unqualified names depend on session state. The same code works in one session and fails (or worse, silently hits a different table) in another.', run: false },
    good: { sql: `CREATE SCHEMA app;
CREATE TABLE app.settings (k text PRIMARY KEY, v text);
INSERT INTO app.settings VALUES ('theme', 'dark');
SELECT k, v FROM app.settings;   -- explicit, unambiguous`,
      why: 'Schema-qualified names (or a search_path pinned per role with ALTER ROLE ... SET search_path) make resolution deterministic and protect against search_path hijacking.', run: true }
  },
  mistakes: [
    'Trying to join tables across databases (<code>SELECT ... FROM otherdb.public.t</code>) — PostgreSQL databases are isolated; use schemas, or postgres_fdw if you truly need another database.',
    'Creating mixed-case names with quotes (<code>"OrderItems"</code>) and then getting <em>relation "orderitems" does not exist</em> when forgetting the quotes.',
    'Running <code>DROP SCHEMA ... CASCADE</code> without first listing what it contains.',
    'Trying <code>CREATE DATABASE</code> inside <code>BEGIN ... COMMIT</code> (it cannot run in a transaction block) or while other sessions are connected to the template.',
    'Assuming everyone can create tables in <code>public</code> — since PostgreSQL 15 only the database owner can by default.',
    'Leaving <code>public</code> writable on old clusters, enabling search_path hijacking (a malicious <code>public.lower()</code> function shadowing objects for other users).'
  ],
  best: [
    'One application = one database; inside it, use schemas to separate modules (<code>app</code>, <code>audit</code>, <code>reporting</code>, <code>extensions</code>).',
    'Create an application schema owned by a non-superuser role, and set <code>ALTER ROLE app_user SET search_path = app, public</code>.',
    'Schema-qualify names in migrations, functions and especially <code>SECURITY DEFINER</code> functions.',
    'Use lower_snake_case identifiers without quotes.',
    'Use <code>DROP DATABASE ... WITH (FORCE)</code> (PostgreSQL 13+) only in automation for disposable test databases.'
  ],
  performance: `
<p>Schemas cost nothing at run time — name resolution happens once at parse time. What does cost is <em>catalog size</em>: 5,000 schemas × 50 tables = 250,000 relations, each with columns, indexes and statistics rows. Planning gets slower, <code>pg_dump</code> takes far longer, autovacuum must visit every table and backends cache more catalog entries (memory per connection grows). Databases have a separate cost: each needs its own connections, so 100 databases with a pool of 10 each is 1,000 backends.</p>`,
  security: `
<p>Permissions apply at each level: <code>CONNECT</code> on a database, <code>USAGE</code>/<code>CREATE</code> on a schema, <code>SELECT</code>/<code>INSERT</code>/… on tables. Lock down defaults: <code>REVOKE CREATE ON SCHEMA public FROM PUBLIC</code> (already the default since 15) and <code>REVOKE CONNECT ON DATABASE company_db FROM PUBLIC</code>, then grant explicitly. Never put an untrusted, writable schema ahead of trusted ones in <code>search_path</code>.</p>`,
  scenario: { title: 'A tenant must be deleted under a GDPR erasure request', steps: [
    '1. Confirm the tenant lives in schema tenant_0042: SELECT table_name FROM information_schema.tables WHERE table_schema = \'tenant_0042\'.',
    '2. Take a final, encrypted logical backup if legal retention requires it (pg_dump -n tenant_0042).',
    '3. Check for objects outside the schema that reference it (views in reporting, foreign keys).',
    '4. Run DROP SCHEMA tenant_0042 CASCADE inside a transaction, review the NOTICE list, then COMMIT.',
    '5. Record the erasure in the audit schema with the operator and timestamp.'
  ] },
  widgets: ['diagram:pg-arch', 'diagram:multi-tenant'],
  interview: [
    { q: 'What is the difference between a database and a schema in PostgreSQL?', a: 'A database is a fully isolated set of catalogs: a connection targets exactly one and cannot query another without FDW. A schema is a namespace inside a database; objects in different schemas can be joined freely and permissions are granted per schema. Roles and configuration are shared across the whole cluster.' },
    { q: 'How does PostgreSQL resolve an unqualified table name?', a: 'It searches pg_catalog implicitly, then each schema in search_path in order (default "$user", public) and uses the first match. New objects are created in the first existing schema of the path. Temporary schemas (pg_temp) are searched first for tables.' },
    { q: 'What are template0 and template1?', a: 'CREATE DATABASE copies a template. template1 is the default and may be customised (e.g. extensions installed there appear in new databases). template0 is a pristine, non-connectable copy used when you need a clean database, for example restoring a dump or choosing a different encoding/locale.' },
    { q: 'Would you use one schema per tenant? When not?', a: 'It is good for tens to a few thousand tenants needing logical separation, per-tenant dumps or custom extensions. Beyond that, catalog bloat hurts planning, dumps and migrations; then a shared schema with tenant_id and row-level security scales better. For strict compliance isolation, a separate database or cluster may be required.' }
  ],
  exercises: [
    { task: 'Create a schema named hr_private and inside it a table salary_bands(band text PRIMARY KEY, min_salary numeric, max_salary numeric). Insert two bands and select them back using a schema-qualified name.', solution: `CREATE SCHEMA hr_private;
CREATE TABLE hr_private.salary_bands (
  band       text PRIMARY KEY,
  min_salary numeric,
  max_salary numeric
);
INSERT INTO hr_private.salary_bands VALUES ('B1', 30000, 60000), ('B2', 60001, 120000);
SELECT * FROM hr_private.salary_bands;`, run: true },
    { task: 'List every schema in the current database with the number of ordinary tables it contains (include schemas with zero tables, exclude pg_toast).', solution: `SELECT n.nspname AS schema, count(c.oid) AS tables
FROM   pg_namespace n
LEFT   JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind = 'r'
WHERE  n.nspname NOT LIKE 'pg_toast%'
GROUP  BY n.nspname
ORDER  BY 1;`, run: true },
    { task: 'List all databases in the cluster with their size and whether connections are allowed.', solution: `SELECT datname,
       pg_size_pretty(pg_database_size(datname)) AS size,
       datallowconn
FROM   pg_database
ORDER  BY datname;`, run: true }
  ],
  challenge: { task: 'Move the employees table into a new schema called hr without breaking queries that say "SELECT ... FROM employees". Prove both the qualified and unqualified names work afterwards (inside the sandbox transaction).', hint: 'ALTER TABLE ... SET SCHEMA is a catalog-only change; then adjust search_path.', solution: `CREATE SCHEMA hr;
ALTER TABLE employees SET SCHEMA hr;

SET search_path = public, hr;

SELECT count(*) AS via_search_path FROM employees;
SELECT count(*) AS qualified       FROM hr.employees;
SELECT table_schema FROM information_schema.tables WHERE table_name = 'employees';`, run: true },
  related: ['fundamentals-architecture', 'fundamentals-connecting', 'roles-permissions', 'production-architecture'],
  quiz: [
    { type: 'mcq', q: 'Which statement is TRUE?', options: ['You can JOIN tables from two databases in one query natively', 'Roles are defined per database', 'Schemas are namespaces inside one database', 'Each schema has its own data directory'], answer: 2, explain: 'Schemas are namespaces inside a database. Roles are cluster-wide; cross-database joins need an FDW; schemas have no directory of their own.' },
    { type: 'predict', q: 'search_path is "reporting, public" and both schemas contain a table named departments. What does this read?', code: `SELECT * FROM departments;`, options: ['public.departments', 'reporting.departments', 'An ambiguity error', 'Both tables UNIONed'], answer: 1, explain: 'The first schema in the path that contains the name wins.' },
    { type: 'tf', q: 'CREATE DATABASE can be executed inside a BEGIN ... COMMIT block.', answer: false, explain: 'CREATE DATABASE and DROP DATABASE cannot run inside a transaction block.' },
    { type: 'bug', q: 'Why does the second query fail?', code: `CREATE TABLE "Customers" (id int);
SELECT * FROM Customers;`, options: ['Customers is a reserved word', 'Unquoted Customers is folded to customers, which does not exist', 'Tables need a schema prefix', 'The table has no rows'], answer: 1, explain: 'Quoted identifiers keep their case; unquoted ones are folded to lower case, so the names no longer match.' },
    { type: 'design', q: 'You run 12 unrelated internal apps on one server. Best isolation?', options: ['One schema per app in one database', 'One database per app (with its own owner role)', 'All tables in public with prefixes', 'One cluster per table'], answer: 1, explain: 'Unrelated applications deserve database-level isolation: separate catalogs, CONNECT privileges and independent dumps, while sharing one cluster.' }
  ]
},
{
  id: 'fundamentals-installation-tools',
  module: 'fundamentals',
  title: 'Installing PostgreSQL and Working with psql, pgAdmin and DBeaver',
  level: 1,
  minutes: 22,
  summary: 'Install PostgreSQL on Linux, Windows, macOS or Docker, then master psql and its meta-commands, plus the GUI tools pgAdmin and DBeaver.',
  objectives: [
    'Install PostgreSQL 18 from the official PGDG repositories on Debian/Ubuntu and RHEL-family Linux',
    'Install on Windows and macOS (EDB installer, Postgres.app, Homebrew) and run PostgreSQL in Docker with a persistent volume',
    'Connect with psql and use meta-commands: \\l \\c \\dt \\d \\dn \\du \\x \\timing \\q',
    'Explain why meta-commands are psql features, not SQL, and write the equivalent catalog queries',
    'Choose between psql, pgAdmin and DBeaver for different tasks'
  ],
  concept: `
<p>PostgreSQL is a <em>server</em>; to use it you need the server package plus a <em>client</em>. The standard client is <strong>psql</strong>, a terminal program shipped with every PostgreSQL installation. GUI clients such as <span class="tag tool">third-party tool</span> <strong>pgAdmin</strong> (the official community admin GUI, a separate project) and <strong>DBeaver</strong> (a universal database IDE) talk to the same server over the same protocol.</p>
<p><strong>Analogy: a car and its dashboard.</strong> The server is the engine — it does the work whether or not anyone watches. psql is the mechanic's diagnostic laptop: terse, scriptable, available everywhere, shows exactly what the engine says. pgAdmin and DBeaver are the touch-screen dashboard: friendlier, visual, but not always present (you won't find a GUI on a production server reached over SSH).</p>
<h4>Installation options</h4>
<table>
<tr><th>Platform</th><th>Recommended method</th><th>Notes</th></tr>
<tr><td>Debian / Ubuntu</td><td>PGDG apt repository (<code>apt.postgresql.org</code>)</td><td>Distro repos may lag one or two majors; PGDG has every supported version. Clusters are managed with <code>pg_lsclusters</code>, <code>pg_ctlcluster</code>.</td></tr>
<tr><td>RHEL / Rocky / Alma / Fedora</td><td>PGDG yum/dnf repository</td><td>Initialise with <code>postgresql-18-setup initdb</code>; service <code>postgresql-18</code>.</td></tr>
<tr><td>Windows</td><td>EDB interactive installer</td><td>Installs server, psql, pgAdmin and Stack Builder; runs as a Windows service.</td></tr>
<tr><td>macOS</td><td>Postgres.app or Homebrew (<code>brew install postgresql@18</code>)</td><td>Postgres.app is the easiest for development.</td></tr>
<tr><td>Docker / Kubernetes</td><td>Official <code>postgres:18</code> image</td><td>Always mount a volume for data. In Kubernetes use an operator (CloudNativePG, Crunchy PGO, Zalando).</td></tr>
<tr><td>Managed cloud</td><td>Amazon RDS / Aurora, Google Cloud SQL / AlloyDB, Azure Database for PostgreSQL</td><td>No OS access; backups, patching and HA managed for you.</td></tr>
</table>
<h4>psql meta-commands</h4>
<p>Anything starting with a backslash is interpreted <em>by psql itself</em>, never sent to the server. psql translates most of them into catalog queries (run <code>psql -E</code> to see the generated SQL). They don't end with a semicolon.</p>
<table>
<tr><th>Command</th><th>What it does</th></tr>
<tr><td><code>\\l</code></td><td>List databases</td></tr>
<tr><td><code>\\c dbname [user]</code></td><td>Connect to another database (opens a new connection)</td></tr>
<tr><td><code>\\dt [pattern]</code></td><td>List tables (<code>\\dt sales.*</code> for one schema, <code>\\dt+</code> adds sizes)</td></tr>
<tr><td><code>\\d name</code></td><td>Describe a table, view, index or sequence: columns, types, defaults, indexes, constraints, triggers</td></tr>
<tr><td><code>\\dn</code></td><td>List schemas</td></tr>
<tr><td><code>\\du</code></td><td>List roles and their attributes</td></tr>
<tr><td><code>\\dx</code></td><td>List installed extensions</td></tr>
<tr><td><code>\\df</code>, <code>\\dv</code>, <code>\\di</code></td><td>List functions, views, indexes</td></tr>
<tr><td><code>\\x</code></td><td>Toggle expanded display (one column per line — great for wide rows); <code>\\x auto</code> switches only when needed</td></tr>
<tr><td><code>\\timing</code></td><td>Show the round-trip time of each statement</td></tr>
<tr><td><code>\\e</code>, <code>\\i file.sql</code>, <code>\\o file</code></td><td>Edit query in $EDITOR, run a script, redirect output</td></tr>
<tr><td><code>\\copy</code></td><td>Client-side COPY: import/export CSV using files on <em>your</em> machine</td></tr>
<tr><td><code>\\?</code>, <code>\\h CREATE TABLE</code></td><td>Help on meta-commands / SQL syntax</td></tr>
<tr><td><code>\\q</code></td><td>Quit</td></tr>
</table>
<div class="callout info">Meta-commands cannot run in this course's browser playground (it executes SQL only), but every one of them is just a catalog query — the Advanced example shows the SQL behind <code>\\dt</code> and <code>\\d employees</code>, which you <em>can</em> run here.</div>
<h4>GUI tools</h4>
<ul>
<li><strong>pgAdmin 4</strong> — PostgreSQL-specific: server dashboards, visual EXPLAIN, backup/restore dialogs, role and privilege editors. Desktop or web mode.</li>
<li><strong>DBeaver</strong> (Community edition) — works with PostgreSQL, MySQL, SQL Server, Oracle...; strong ER diagrams, data editing, export/import. Ideal if you touch several database engines.</li>
<li>Others: DataGrip (JetBrains, commercial), Azure Data Studio, TablePlus, Postico (macOS).</li>
</ul>`,
  why: `
<p>Learning to install the server yourself teaches where things live (data directory, config files, service manager, logs) — knowledge you need when production misbehaves. psql matters because it is the one client guaranteed to exist on every server, it is scriptable in CI pipelines and runbooks, and its output is unambiguous. GUIs boost productivity for exploration and visual plan analysis, but every DBA must be fluent in psql for the 3 a.m. incident on a bastion host with no desktop.</p>`,
  useCase: `
<p><strong>An infrastructure consultancy</strong> standardises developer setups: every engineer runs <code>postgres:18</code> in Docker with a named volume and the company's seed script, so "works on my machine" bugs disappear. Staging and production run on Ubuntu with PGDG packages managed by Ansible, so minor-version security patches are a one-line change. Analysts use DBeaver with read-only roles to explore data and build ER diagrams; DBAs use psql inside <code>tmux</code> on the bastion host with a <code>~/.psqlrc</code> containing <code>\\timing on</code>, <code>\\x auto</code> and <code>\\set ON_ERROR_ROLLBACK interactive</code>.</p>`,
  internals: `
<p>Packages lay out files differently. On Debian/Ubuntu: binaries in <code>/usr/lib/postgresql/18/bin</code>, data in <code>/var/lib/postgresql/18/main</code>, config in <code>/etc/postgresql/18/main/</code>. On RHEL/PGDG: binaries in <code>/usr/pgsql-18/bin</code>, data and config together in <code>/var/lib/pgsql/18/data</code>. Every installation runs <code>initdb</code> once, which creates the data directory, the <code>template0</code>, <code>template1</code> and <code>postgres</code> databases and the bootstrap superuser (normally <code>postgres</code>). psql, when you type <code>\\d employees</code>, sends several queries against <code>pg_class</code>, <code>pg_attribute</code>, <code>pg_index</code>, <code>pg_constraint</code> and <code>pg_trigger</code> and formats the results.</p>`,
  whenNot: `
<ul>
<li>Do not install from your OS's default repository on servers if it is behind the version you need — use PGDG.</li>
<li>Do not run production PostgreSQL in a plain Docker container without a persistent volume, resource limits and backups; prefer a VM or a Kubernetes operator.</li>
<li>Do not use a GUI to run production schema changes by clicking — changes must be scripted migrations in version control.</li>
<li>Do not self-host at all if your team lacks DBA capacity; a managed service may be cheaper overall.</li>
</ul>`,
  syntax: `# --- Ubuntu / Debian (PGDG repository) ---
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-18

# --- RHEL / Rocky / Alma 9 ---
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
sudo dnf -qy module disable postgresql
sudo dnf install -y postgresql18-server
sudo /usr/pgsql-18/bin/postgresql-18-setup initdb
sudo systemctl enable --now postgresql-18

# --- macOS ---
brew install postgresql@18 && brew services start postgresql@18

# --- Docker ---
docker run -d --name pg18 -e POSTGRES_PASSWORD=secret -p 5432:5432 \\
  -v pgdata:/var/lib/postgresql postgres:18

# --- connect ---
psql -h localhost -p 5432 -U postgres -d postgres`,
  examples: [
    { label: 'Basic', title: 'Install and start PostgreSQL 18 (shell, not runnable here)',
      sql: `# Ubuntu 24.04 — add the official PGDG repository and install
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-18

# The package runs initdb and starts the "18/main" cluster automatically
pg_lsclusters
sudo systemctl status postgresql@18-main

# Become the postgres OS user and open psql (peer authentication over the Unix socket)
sudo -u postgres psql

# Docker alternative with persistent data
docker run -d --name pg18 \\
  -e POSTGRES_PASSWORD=change_me \\
  -p 5432:5432 \\
  -v pgdata:/var/lib/postgresql \\
  postgres:18`,
      explain: `<p>The PGDG script registers the official repository and signing key so you get current minor releases. On Debian-family systems the <code>postgresql-common</code> wrapper lets several versions/clusters coexist; <code>pg_lsclusters</code> shows version, cluster name, port, status and data directory.</p>
<p><code>sudo -u postgres psql</code> works without a password because the default <code>pg_hba.conf</code> uses <em>peer</em> authentication on the local socket: OS user <code>postgres</code> maps to database role <code>postgres</code>.</p>
<p>For Docker, the <code>-v pgdata:...</code> volume is essential — without it, removing the container deletes the database. (From the 18 image onward the volume is mounted at <code>/var/lib/postgresql</code>; older images used <code>/var/lib/postgresql/data</code>.)</p>`,
      output: `Ver Cluster Port Status Owner    Data directory              Log file
18  main    5432 online postgres /var/lib/postgresql/18/main /var/log/postgresql/postgresql-18-main.log

psql (18.0 (Ubuntu 18.0-1.pgdg24.04+1))
Type "help" for help.

postgres=#`, run: false },
    { label: 'Intermediate', title: 'A psql session with meta-commands (psql only)',
      sql: `postgres=# \\l                       -- list databases
postgres=# CREATE DATABASE company_db;
postgres=# \\c company_db              -- reconnect to it
company_db=# \\dn                      -- schemas
company_db=# \\dt                      -- tables in search_path
company_db=# \\d employees             -- describe one table
company_db=# \\du                      -- roles
company_db=# \\timing on
company_db=# SELECT count(*) FROM orders;
company_db=# \\x on                    -- expanded output for wide rows
company_db=# SELECT * FROM products WHERE id = 1;
company_db=# \\q`,
      explain: `<p>Notice the prompt changes from <code>postgres=#</code> to <code>company_db=#</code> after <code>\\c</code>: the prompt shows the current database and <code>#</code> means you are a superuser (<code>&gt;</code> for ordinary roles). Meta-commands need no semicolon; SQL statements do — if you forget it psql shows a continuation prompt <code>company_db-#</code> and waits.</p>
<p><code>\\timing</code> measures the full round trip (network + execution). <code>\\x</code> prints each column on its own line, perfect for <code>jsonb</code>-heavy rows.</p>`,
      output: `company_db=# \\d employees
                               Table "public.employees"
    Column     |     Type      | Collation | Nullable |           Default
---------------+---------------+-----------+----------+------------------------------
 id            | integer       |           | not null | generated always as identity
 first_name    | text          |           | not null |
 ...
 is_active     | boolean       |           | not null | true
Indexes:
    "employees_pkey" PRIMARY KEY, btree (id)
    "employees_email_key" UNIQUE CONSTRAINT, btree (email)
    "idx_employees_department" btree (department_id)
Check constraints:
    "employees_salary_check" CHECK (salary > 0::numeric)
Foreign-key constraints:
    "employees_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id)
    "employees_manager_id_fkey" FOREIGN KEY (manager_id) REFERENCES employees(id)

company_db=# SELECT count(*) FROM orders;
 count
-------
  5000
(1 row)

Time: 0.912 ms
company_db=# \\x on
Expanded display is on.
company_db=# SELECT id, sku, name FROM products WHERE id = 1;
-[ RECORD 1 ]---------
id   | 1
sku  | SKU-0001
name | Monitor Air 1`, run: false },
    { label: 'Advanced', title: 'The SQL behind \\dt and \\d (runnable)',
      sql: `-- Equivalent of \\dt : tables in the public schema
SELECT n.nspname                   AS schema,
       c.relname                   AS name,
       pg_get_userbyid(c.relowner) AS owner,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  c.relkind = 'r' AND n.nspname = 'public'
ORDER  BY c.relname
LIMIT  5;

-- Equivalent of the column part of \\d employees
SELECT a.attname                               AS column,
       format_type(a.atttypid, a.atttypmod)    AS type,
       CASE WHEN a.attnotnull THEN 'not null' ELSE '' END AS nullable,
       CASE a.attidentity WHEN 'a' THEN 'generated always as identity'
                          WHEN 'd' THEN 'generated by default as identity'
            ELSE pg_get_expr(d.adbin, d.adrelid) END       AS default
FROM   pg_attribute a
LEFT   JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE  a.attrelid = 'public.employees'::regclass
  AND  a.attnum > 0 AND NOT a.attisdropped
ORDER  BY a.attnum;`,
      explain: `<p>This is roughly what psql does for you. Key catalog tables:</p>
<ul><li><code>pg_class</code> — every relation (<code>relkind</code>: <code>r</code> table, <code>i</code> index, <code>v</code> view, <code>m</code> materialized view, <code>S</code> sequence, <code>p</code> partitioned table).</li>
<li><code>pg_attribute</code> — one row per column; <code>attnum &gt; 0</code> skips system columns such as <code>ctid</code> and <code>xmin</code>.</li>
<li><code>pg_attrdef</code> — column defaults; identity columns are flagged in <code>attidentity</code> instead.</li>
<li><code>'public.employees'::regclass</code> converts a name to the table's OID.</li></ul>
<p>Use these in tools and scripts where psql is not available — exactly like in this playground.</p>`,
      output: ` schema | name              | owner    | size
--------+-------------------+----------+---------
 public | audit_logs        | postgres | 88 kB
 public | customers         | postgres | 176 kB
 public | departments       | postgres | 48 kB
 public | documents         | postgres | 80 kB
 public | employee_projects | postgres | 64 kB
(5 rows)

 column        | type          | nullable | default
---------------+---------------+----------+------------------------------
 id            | integer       | not null | generated always as identity
 first_name    | text          | not null |
 last_name     | text          | not null |
 email         | text          | not null |
 department_id | integer       |          |
 manager_id    | integer       |          |
 job_title     | text          | not null |
 salary        | numeric(10,2) | not null |
 hire_date     | date          | not null |
 is_active     | boolean       | not null | true
(10 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `# Throwaway container: data lives inside the container's writable layer
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres
# ...weeks later
docker rm -f pg      # the database is gone forever`,
      why: 'No volume, an unpinned "latest" image (a surprise major upgrade on the next pull) and a default password exposed on all interfaces.', run: false },
    good: { sql: `docker volume create pgdata
docker run -d --name pg18 \\
  --restart unless-stopped \\
  -e POSTGRES_PASSWORD_FILE=/run/secrets/pg_pw \\
  -v /secure/pg_pw:/run/secrets/pg_pw:ro \\
  -v pgdata:/var/lib/postgresql \\
  -p 127.0.0.1:5432:5432 \\
  postgres:18.0`,
      why: 'Named volume survives container removal; the image tag is pinned; the password comes from a secret file; the port is bound to localhost only.', run: false }
  },
  mistakes: [
    'Typing <code>\\dt</code> into a GUI SQL editor or application driver — meta-commands only exist in psql; send catalog SQL instead.',
    'Forgetting the semicolon in psql and wondering why nothing happens (the prompt changes to <code>-#</code> while psql waits for more input).',
    'Running the Docker image without a volume, or using the floating <code>latest</code> tag in anything but a toy.',
    'Installing multiple PostgreSQL versions and connecting to the wrong one because both listen on 5432/5433 — check <code>SHOW port</code> and <code>SELECT version()</code>.',
    'Opening port 5432 to the internet with <code>listen_addresses = \'*\'</code> and <code>trust</code> rules — databases are scanned within minutes.'
  ],
  best: [
    'Install from PGDG (Linux) or official installers, and apply minor releases promptly — they contain only bug and security fixes.',
    'Create a <code>~/.psqlrc</code> with <code>\\set ON_ERROR_STOP on</code> for scripts, <code>\\timing on</code>, <code>\\x auto</code> and a prompt showing user@host/db.',
    'Use <code>psql -E</code> once to learn the catalog queries behind meta-commands.',
    'Use GUIs for exploration and visual EXPLAIN; use version-controlled SQL migrations for changes.',
    'In Docker, always pin the major version tag and mount a named volume.'
  ],
  performance: `
<p>Client choice rarely affects server performance, but a few habits do: GUIs that auto-fetch "all rows" from a 50-million-row table can pin memory on both client and server — use <code>LIMIT</code> or server-side cursors (DBeaver fetch size). In psql, <code>\\timing</code> includes network latency, so for server-side timing use <code>EXPLAIN ANALYZE</code>. For bulk loads, <code>\\copy</code> / <code>COPY</code> is 10–100× faster than row-by-row <code>INSERT</code>s from a GUI import wizard.</p>`,
  security: `
<p>Default installs are local-only (<code>listen_addresses = 'localhost'</code>) — keep it that way until you have configured <code>pg_hba.conf</code> with <code>scram-sha-256</code> and TLS. Never store passwords in shell history (<code>psql postgresql://user:pass@...</code>); use <code>~/.pgpass</code> or <code>PGPASSFILE</code>. GUI tools often save credentials in plain configuration files — use their secure-storage options and read-only roles for analysts.</p>`,
  widgets: ['diagram:client-server'],
  interview: [
    { q: 'What is the difference between a psql meta-command and an SQL statement?', a: 'Meta-commands start with a backslash and are executed by the psql client itself (often by sending catalog queries); they are not understood by the server or other clients. SQL statements are sent to the server and must be terminated with a semicolon in psql.' },
    { q: 'How would you install a specific PostgreSQL major version on Ubuntu?', a: 'Add the PGDG apt repository (via postgresql-common\'s apt.postgresql.org.sh script), then apt install postgresql-18. The package runs initdb and starts the 18/main cluster; pg_lsclusters and pg_ctlcluster manage it, and multiple majors can coexist on different ports.' },
    { q: 'Why does "sudo -u postgres psql" work without a password on a fresh install?', a: 'The default pg_hba.conf uses peer authentication for local Unix-socket connections: the server asks the kernel for the connecting OS user and allows the same-named database role. It is secure for local admin access but does not work over TCP.' }
  ],
  exercises: [
    { task: 'Write the SQL equivalent of \\dn: list schemas with their owners, excluding pg_toast and pg_temp schemas.', solution: `SELECT nspname AS schema, pg_get_userbyid(nspowner) AS owner
FROM   pg_namespace
WHERE  nspname !~ '^pg_(toast|temp)'
ORDER  BY 1;`, run: true },
    { task: 'Write the SQL equivalent of \\du: role name, superuser, create role, create db, can login.', solution: `SELECT rolname       AS role,
       rolsuper      AS superuser,
       rolcreaterole AS create_role,
       rolcreatedb   AS create_db,
       rolcanlogin   AS can_login
FROM   pg_roles
WHERE  rolname !~ '^pg_'
ORDER  BY 1;`, run: true },
    { task: 'Write the SQL equivalent of \\l: database name, owner and encoding.', solution: `SELECT datname                      AS name,
       pg_get_userbyid(datdba)      AS owner,
       pg_encoding_to_char(encoding) AS encoding
FROM   pg_database
ORDER  BY 1;`, run: true }
  ],
  challenge: { task: 'Reproduce the "Indexes" and constraint sections of \\d employees: list each index with its definition, then each constraint with its type and definition.', hint: 'pg_index + pg_get_indexdef(); pg_constraint + pg_get_constraintdef(); contype is p, u, f, c or n.', solution: `SELECT indexrelid::regclass AS index_name,
       pg_get_indexdef(indexrelid) AS definition
FROM   pg_index
WHERE  indrelid = 'employees'::regclass;

SELECT conname,
       CASE contype WHEN 'p' THEN 'primary key' WHEN 'u' THEN 'unique'
                    WHEN 'f' THEN 'foreign key' WHEN 'c' THEN 'check'
                    WHEN 'n' THEN 'not null' END AS type,
       pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'employees'::regclass
  AND  contype <> 'n'
ORDER  BY contype, conname;`, run: true },
  related: ['fundamentals-connecting', 'fundamentals-cluster-database-schema', 'system-catalogs', 'configuration'],
  quiz: [
    { type: 'mcq', q: 'Which psql command describes a table\'s columns, indexes and constraints?', options: ['\\dt employees', '\\d employees', '\\l employees', '\\du employees'], answer: 1, explain: '\\d name describes one relation; \\dt lists tables.' },
    { type: 'tf', q: 'You can run \\dt from a Python application through the psycopg driver.', answer: false, explain: 'Meta-commands are implemented by psql, not the server. Drivers only send SQL.' },
    { type: 'mcq', q: 'What does \\x do in psql?', options: ['Exits psql', 'Toggles expanded (vertical) output', 'Executes a file', 'Shows extensions'], answer: 1, explain: '\\x toggles expanded display; \\q quits, \\i runs a file, \\dx lists extensions.' },
    { type: 'bug', q: 'A developer ran these commands; after a "docker rm" the data was lost. Why?', code: `docker run -d --name pg -e POSTGRES_PASSWORD=x postgres:18
docker rm -f pg`, options: ['The password was too short', 'No volume was mounted, so data lived in the container layer', 'Port 5432 was not published', 'postgres:18 does not persist data'], answer: 1, explain: 'Without -v the data directory is inside the container filesystem and disappears with the container.' },
    { type: 'mcq', q: 'In psql the prompt shows company_db-# . What does it mean?', options: ['You are not a superuser', 'psql is waiting for the rest of an unterminated statement', 'The connection is broken', 'A transaction failed'], answer: 1, explain: 'The - continuation marker means the previous line did not end the statement (usually a missing semicolon).' }
  ]
},
{
  id: 'fundamentals-connecting',
  module: 'fundamentals',
  title: 'Connecting to PostgreSQL: Connection Strings, .pgpass, postgresql.conf and pg_hba.conf',
  level: 1,
  minutes: 20,
  summary: 'Every way to describe a connection (keyword/value strings, URIs, environment variables, .pgpass), what sslmode really does, and how postgresql.conf and pg_hba.conf decide who gets in.',
  objectives: [
    'Write connection strings in keyword/value and URI form with host, port, dbname, user, password, sslmode and application_name',
    'Use environment variables (PGHOST, PGUSER...) and ~/.pgpass to avoid passwords in code and shell history',
    'Choose the right sslmode (disable, prefer, require, verify-ca, verify-full) and explain why verify-full matters',
    'Explain the role of listen_addresses and port in postgresql.conf',
    'Read pg_hba.conf rules (type, database, user, address, method) and understand first-match evaluation',
    'Diagnose common connection errors: connection refused, no pg_hba.conf entry, password authentication failed'
  ],
  concept: `
<p>To connect, a client needs five facts: <strong>where</strong> the server is (host + port), <strong>which database</strong>, <strong>who</strong> you are (user/role), <strong>how you prove it</strong> (password, certificate, OS identity) and <strong>how the channel is protected</strong> (TLS/<code>sslmode</code>). Almost every PostgreSQL client — psql, JDBC, psycopg, node-postgres, .NET Npgsql — is built on or compatible with <strong>libpq</strong> conventions, so the same connection parameters work everywhere.</p>
<p><strong>Analogy: visiting a gated office campus.</strong> The <em>host and port</em> are the street address and gate number. <code>postgresql.conf</code>'s <code>listen_addresses</code> decides which gates are open at all. <code>pg_hba.conf</code> is the security guard's rulebook: "visitors from the 10.0.0.0/8 network going to floor <em>company_db</em> as <em>app_user</em> must show a password", read top to bottom, first matching rule wins. TLS is the armoured car that stops anyone reading your badge on the way in, and <code>sslmode=verify-full</code> means you also check the guard's own ID so you are not talking to an impostor.</p>
<h4>Two string formats</h4>
<table>
<tr><th>Format</th><th>Example</th></tr>
<tr><td>Keyword/value</td><td><code>host=db.internal port=5432 dbname=company_db user=app_user sslmode=verify-full application_name=billing-api</code></td></tr>
<tr><td>URI</td><td><code>postgresql://app_user@db.internal:5432/company_db?sslmode=verify-full&amp;application_name=billing-api</code></td></tr>
</table>
<p>Special characters in a URI password must be percent-encoded (<code>@</code> → <code>%40</code>). Multiple hosts (<code>host=pg1,pg2,pg3</code> with <code>target_session_attrs=read-write</code>) let libpq find the current primary after a failover.</p>
<h4>Key parameters</h4>
<ul>
<li><code>host</code> — DNS name or IP; a value starting with <code>/</code> is a Unix-socket directory (e.g. <code>/var/run/postgresql</code>). Default: local socket.</li>
<li><code>port</code> — default <code>5432</code>.</li>
<li><code>dbname</code> — defaults to the user name.</li>
<li><code>user</code> — defaults to your OS user name.</li>
<li><code>password</code> — better supplied by <code>~/.pgpass</code>, <code>PGPASSWORD</code> (avoid on shared hosts) or a secrets manager.</li>
<li><code>sslmode</code> — <code>disable</code>, <code>allow</code>, <code>prefer</code> (libpq default), <code>require</code>, <code>verify-ca</code>, <code>verify-full</code>.</li>
<li><code>connect_timeout</code>, <code>application_name</code>, <code>options='-c statement_timeout=5s'</code>.</li>
</ul>
<h4>sslmode explained</h4>
<table>
<tr><th>sslmode</th><th>Encrypted?</th><th>Server identity checked?</th><th>Use</th></tr>
<tr><td>disable</td><td>No</td><td>No</td><td>Local sockets only</td></tr>
<tr><td>prefer (default)</td><td>If server offers it</td><td>No</td><td>Silently falls back to plain text — avoid for remote</td></tr>
<tr><td>require</td><td>Yes</td><td>No (vulnerable to man-in-the-middle)</td><td>Minimum for remote</td></tr>
<tr><td>verify-ca</td><td>Yes</td><td>Certificate signed by trusted CA</td><td>Good</td></tr>
<tr><td>verify-full</td><td>Yes</td><td>CA + hostname matches certificate</td><td><strong>Recommended</strong> for production / cloud</td></tr>
</table>
<h4>.pgpass</h4>
<p>A file at <code>~/.pgpass</code> (Windows: <code>%APPDATA%\\postgresql\\pgpass.conf</code>) with lines <code>hostname:port:database:username:password</code>; <code>*</code> is a wildcard. It must be <code>chmod 0600</code> or libpq ignores it.</p>
<h4>Server side: postgresql.conf and pg_hba.conf</h4>
<ul>
<li><code>postgresql.conf</code>: <code>listen_addresses</code> (default <code>'localhost'</code>; set <code>'*'</code> or specific IPs to accept remote connections — restart required), <code>port</code>, <code>max_connections</code>, <code>ssl = on</code> with <code>ssl_cert_file</code>/<code>ssl_key_file</code>.</li>
<li><code>pg_hba.conf</code> (host-based authentication): one rule per line — <code>TYPE  DATABASE  USER  ADDRESS  METHOD</code>. Types: <code>local</code> (Unix socket), <code>host</code> (TCP, with or without TLS), <code>hostssl</code> (TLS only), <code>hostnossl</code>. Methods: <code>scram-sha-256</code> (use this), <code>md5</code> (legacy, deprecated in PostgreSQL 18), <code>peer</code>, <code>cert</code>, <code>ldap</code>, <code>gss</code>, <code>reject</code>, <code>trust</code> (no password — dangerous). Changes need only a reload: <code>SELECT pg_reload_conf();</code>.</li>
</ul>`,
  why: `
<p>Connection configuration is where security and availability are won or lost. Most real-world PostgreSQL breaches are not clever exploits — they are servers listening on <code>0.0.0.0</code> with <code>trust</code> or weak passwords, or credentials committed to Git. Most "the database is down" tickets turn out to be a wrong host, a firewall, an exhausted <code>max_connections</code>, or a missing <code>pg_hba.conf</code> line. Knowing exactly how a connection is resolved lets you fix these in minutes.</p>`,
  useCase: `
<p><strong>A logistics platform</strong> on a managed cloud PostgreSQL service. Each microservice reads <code>DATABASE_URL=postgresql://svc_tracking@pg-prod.internal:6432/logistics?sslmode=verify-full&amp;application_name=tracking-svc&amp;connect_timeout=5</code> from a secrets manager. Port 6432 is PgBouncer; <code>verify-full</code> with the provider's root CA prevents interception inside the VPC; <code>application_name</code> makes every session identifiable in <code>pg_stat_activity</code>, so when one service leaks connections the on-call engineer finds it in seconds. The server's <code>pg_hba.conf</code> only allows <code>hostssl</code> from the application subnets with <code>scram-sha-256</code>, and ends with an explicit <code>reject</code>.</p>`,
  internals: `
<p>Connection flow: the client resolves the host and opens TCP to the port → optionally sends an <code>SSLRequest</code>; the server answers <code>S</code> or <code>N</code> → TLS handshake → client sends a <code>StartupMessage</code> with user, database and options → the postmaster forks a backend → the backend scans <code>pg_hba.conf</code> top-down for the first line matching connection type, database, user and client address → it runs that method (for SCRAM: a challenge–response, so the password itself never crosses the wire) → <code>AuthenticationOk</code>, parameter status messages (server_version, client_encoding, TimeZone...) and <code>ReadyForQuery</code>. If no line matches, the error is <em>no pg_hba.conf entry for host ...</em>. The parsed rules can be inspected with the <code>pg_hba_file_rules</code> view, which also reports syntax errors before you reload.</p>`,
  whenNot: `
<ul>
<li>Do not use <code>trust</code> outside throw-away local development; even then prefer <code>peer</code> for local sockets.</li>
<li>Do not put passwords in URIs in shell commands or code (they leak into history, logs and process lists); use <code>.pgpass</code>, environment injection from a secrets manager, or IAM/certificate authentication.</li>
<li>Do not rely on <code>sslmode=prefer</code> or <code>require</code> across untrusted networks — use <code>verify-full</code>.</li>
<li>Do not open a new connection per HTTP request; use a pool.</li>
</ul>`,
  syntax: `# keyword/value
psql "host=db.example.com port=5432 dbname=company_db user=app_user sslmode=verify-full application_name=cli"

# URI
psql "postgresql://app_user@db.example.com:5432/company_db?sslmode=verify-full&connect_timeout=5"

# environment variables
export PGHOST=db.example.com PGPORT=5432 PGDATABASE=company_db PGUSER=app_user PGSSLMODE=verify-full

# ~/.pgpass   (chmod 600)
# hostname:port:database:username:password
db.example.com:5432:company_db:app_user:S3cr3t!

# pg_hba.conf
# TYPE     DATABASE    USER       ADDRESS        METHOD
local      all         postgres                  peer
hostssl    company_db  app_user   10.0.0.0/8     scram-sha-256
host       all         all        0.0.0.0/0      reject`,
  examples: [
    { label: 'Basic', title: 'Who and where am I connected?',
      sql: `SELECT current_user                     AS role_name,
       session_user                     AS login_role,
       current_database()               AS database,
       inet_server_addr()               AS server_ip,     -- NULL over a Unix socket
       inet_server_port()               AS server_port,
       current_setting('application_name') AS app_name;`,
      explain: `<p>Run this after every connection to an unfamiliar environment — it prevents the classic "I ran the migration on production instead of staging" incident.</p>
<ul><li><code>session_user</code> is who logged in; <code>current_user</code> can differ after <code>SET ROLE</code> or inside a <code>SECURITY DEFINER</code> function.</li>
<li><code>inet_server_addr()</code>/<code>inet_server_port()</code> return NULL when connected through a Unix-domain socket (as in this embedded playground).</li></ul>`,
      output: ` role_name | login_role | database | server_ip | server_port | app_name
-----------+------------+----------+-----------+-------------+----------
 postgres  | postgres   | postgres |           |             |
(1 row)

-- typical result over TCP on a server:
 role_name | login_role | database   | server_ip | server_port | app_name
-----------+------------+------------+-----------+-------------+-------------
 app_user  | app_user   | company_db | 10.0.3.15 |        5432 | billing-api`, run: true },
    { label: 'Intermediate', title: 'Connection-level settings: application_name and timeouts',
      sql: `-- These can also be passed in the connection string via options='-c ...'
SET application_name = 'billing-api';
SET statement_timeout = '5s';
SET idle_in_transaction_session_timeout = '60s';

SELECT name, setting, unit, source
FROM   pg_settings
WHERE  name IN ('application_name', 'statement_timeout',
                'idle_in_transaction_session_timeout', 'client_encoding')
ORDER  BY name;`,
      explain: `<p>Settings with context <code>user</code> can be set per session. Production services usually set them in the connection string, e.g. <code>postgresql://...?application_name=billing-api&amp;options=-c%20statement_timeout%3D5s</code>, or per role with <code>ALTER ROLE app_user SET statement_timeout = '5s'</code>.</p>
<p>The <code>source</code> column tells you <em>where</em> a value came from — <code>default</code>, <code>configuration file</code>, <code>session</code>, <code>user</code> (ALTER ROLE), <code>database</code> (ALTER DATABASE), <code>client</code> — invaluable when a setting is "mysteriously" different.</p>`,
      output: ` name                                | setting     | unit | source
-------------------------------------+-------------+------+----------
 application_name                    | billing-api |      | session
 client_encoding                     | UTF8        |      | client
 idle_in_transaction_session_timeout | 60000       | ms   | session
 statement_timeout                   | 5000        | ms   | session
(4 rows)`, run: true },
    { label: 'Advanced', title: 'Inspect listen_addresses, port and the pg_hba.conf rules from SQL',
      sql: `-- Server-side connection settings and where they were defined
SELECT name, setting, context
FROM   pg_settings
WHERE  name IN ('listen_addresses', 'port', 'max_connections',
                'ssl', 'password_encryption', 'hba_file')
ORDER  BY name;

-- The parsed pg_hba.conf, in evaluation order (superuser or pg_read_all_settings)
SELECT rule_number, type, database, user_name, address, auth_method, error
FROM   pg_hba_file_rules
ORDER  BY rule_number;`,
      explain: `<p><code>listen_addresses</code> and <code>port</code> have context <code>postmaster</code> — changing them needs a restart. <code>ssl</code> is <code>sighup</code> — a reload is enough.</p>
<p><code>pg_hba_file_rules</code> shows the rules exactly as the server parsed them, including an <code>error</code> column. The playground's embedded engine uses permissive <code>trust</code> rules for local development — exactly what you must <strong>never</strong> ship. A hardened production file looks like:</p>
<p><code>local all postgres peer</code><br><code>hostssl company_db app_user 10.20.0.0/16 scram-sha-256</code><br><code>hostssl replication replicator 10.20.5.0/24 scram-sha-256</code><br><code>host all all 0.0.0.0/0 reject</code></p>`,
      output: ` name                | setting                  | context
---------------------+--------------------------+------------
 hba_file            | /pglite/data/pg_hba.conf | postmaster
 listen_addresses    | localhost                | postmaster
 max_connections     | 100                      | postmaster
 password_encryption | scram-sha-256            | user
 port                | 5432                     | postmaster
 ssl                 | off                      | sighup
(6 rows)

 rule_number | type  | database      | user_name | address   | auth_method | error
-------------+-------+---------------+-----------+-----------+-------------+-------
           1 | local | {all}         | {all}     |           | trust       |
           2 | host  | {all}         | {all}     | 127.0.0.1 | trust       |
           3 | host  | {all}         | {all}     | ::1       | trust       |
           4 | local | {replication} | {all}     |           | trust       |
           5 | host  | {replication} | {all}     | 127.0.0.1 | trust       |
           6 | host  | {replication} | {all}     | ::1       | trust       |
(6 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `# Password in the command line (visible in ps, shell history, CI logs)
psql "postgresql://admin:Pa55word@203.0.113.10:5432/prod"   # default sslmode=prefer

# pg_hba.conf
host  all  all  0.0.0.0/0  trust`,
      why: 'The password leaks into process lists and history, the connection may silently be unencrypted, and the server accepts anyone from anywhere without a password.', run: false },
    good: { sql: `# ~/.pgpass  (chmod 600)
pg-prod.internal:5432:company_db:app_user:<from secrets manager>

psql "host=pg-prod.internal dbname=company_db user=app_user sslmode=verify-full sslrootcert=/etc/ssl/certs/corp-ca.pem application_name=ops-cli"

# pg_hba.conf
hostssl  company_db  app_user  10.20.0.0/16  scram-sha-256
host     all         all       0.0.0.0/0     reject`,
      why: 'Secrets stay out of commands, TLS is enforced and the server identity verified, only the app subnet may connect, only to its database, only with SCRAM — everything else is rejected explicitly.', run: false }
  },
  mistakes: [
    '<em>could not connect to server: Connection refused</em> — the server is down, listening on another port, or <code>listen_addresses</code> is still <code>localhost</code>. Check <code>ss -ltnp | grep 5432</code> on the server.',
    '<em>no pg_hba.conf entry for host "10.1.2.3", user "app", database "x", no encryption</em> — no rule matches; add one and <code>SELECT pg_reload_conf()</code>.',
    'Putting a broad rule (<code>host all all 0.0.0.0/0 scram-sha-256</code>) above a specific <code>reject</code> — first match wins, so order matters.',
    'A <code>.pgpass</code> file with permissions 0644 — libpq silently ignores it and you get prompted for a password.',
    'Using <code>sslmode=require</code> and believing you are safe from man-in-the-middle attacks — it encrypts but does not verify the server.',
    'Forgetting to percent-encode special characters in URI passwords (<code>p@ss</code> must be <code>p%40ss</code>).'
  ],
  best: [
    'Use <code>scram-sha-256</code> for passwords (<code>password_encryption = scram-sha-256</code>, default since 14) and migrate any <code>md5</code> hashes.',
    'Use <code>hostssl</code> rules plus <code>sslmode=verify-full</code> for every non-local connection.',
    'Always set <code>application_name</code>, <code>connect_timeout</code> and a sane <code>statement_timeout</code> per service.',
    'Keep <code>pg_hba.conf</code> rules narrow (specific database, role, CIDR) and end with an explicit <code>reject</code>.',
    'Store credentials in a secrets manager or <code>.pgpass</code>; rotate them; never commit them.',
    'For HA clusters list several hosts with <code>target_session_attrs=read-write</code> or connect through a virtual IP / proxy.'
  ],
  performance: `
<p>Establishing a connection is expensive: TCP + TLS handshakes, SCRAM's iterated hashing (4096 rounds by default), a <code>fork()</code> and catalog cache warm-up — typically 5–50&nbsp;ms. An API that connects per request wastes that on every call and can hit <code>max_connections</code> during traffic spikes. Use a pool (driver-level such as HikariCP, or PgBouncer) so connections are reused. Keep TLS on — modern CPUs make the encryption cost negligible compared with the handshake, and pooling amortises the handshake too.</p>`,
  security: `
<p>Defence in depth: network firewall/security group (only app subnets reach 5432) → <code>listen_addresses</code> bound to private interfaces → <code>pg_hba.conf</code> with <code>hostssl</code> + <code>scram-sha-256</code> + explicit <code>reject</code> → TLS with <code>verify-full</code> → least-privilege roles → <code>log_connections = on</code> to audit who connected. Consider certificate (<code>cert</code>) or cloud IAM authentication to eliminate static passwords. Note that <code>md5</code> password authentication is deprecated as of PostgreSQL 18 and will be removed in a future release.</p>`,
  scenario: { title: 'A new reporting server cannot connect after a deployment', steps: [
    '1. Read the exact error: "no pg_hba.conf entry for host 10.40.2.7, user reporting, database company_db, SSL encryption".',
    '2. The network path works (the server answered), so the firewall and listen_addresses are fine.',
    '3. SELECT * FROM pg_hba_file_rules shows app rules only for 10.20.0.0/16; the new subnet 10.40.0.0/16 is missing.',
    '4. Add "hostssl company_db reporting 10.40.2.0/24 scram-sha-256" above the final reject line.',
    '5. Check pg_hba_file_rules.error is empty, then SELECT pg_reload_conf().',
    '6. Retest with psql "host=... user=reporting sslmode=verify-full" and confirm in pg_stat_activity.'
  ] },
  widgets: ['diagram:client-server', 'lab:security'],
  interview: [
    { q: 'How does PostgreSQL decide whether to accept a connection?', a: 'The server must listen on the interface (listen_addresses, port). The backend then scans pg_hba.conf top to bottom and uses the first rule matching connection type (local/host/hostssl), database, user and client address; that rule\'s method (scram-sha-256, peer, cert, reject...) decides authentication. If no rule matches, the connection is refused. After that, the role needs CONNECT privilege on the database.' },
    { q: 'What is the difference between sslmode=require and verify-full?', a: 'require encrypts the channel but accepts any certificate, so an attacker in the middle can impersonate the server. verify-ca checks that the certificate is signed by a trusted CA; verify-full additionally checks that the host name matches the certificate. verify-full is the recommended production setting.' },
    { q: 'Which configuration changes need a restart and which a reload?', a: 'pg_settings.context tells you: postmaster settings such as listen_addresses, port, max_connections and shared_buffers need a restart. sighup settings like ssl and pg_hba.conf changes need only pg_reload_conf() or pg_ctl reload. user/superuser settings can be changed per session.' },
    { q: 'Why is trust authentication dangerous even on a private network?', a: 'trust accepts anyone who can reach the port as any role they claim, including the superuser — no password. Any compromised host or misrouted network segment gains full database control. Use peer for local sockets and scram-sha-256 or cert over TCP.' }
  ],
  exercises: [
    { task: 'Show the source (default, configuration file, session...) of the settings port, listen_addresses and TimeZone.', solution: `SELECT name, setting, source
FROM   pg_settings
WHERE  name IN ('port', 'listen_addresses', 'TimeZone')
ORDER  BY name;`, run: true },
    { task: 'Set the application name for your session to "lesson-runner" and verify it in pg_stat_activity for your own backend.', solution: `SET application_name = 'lesson-runner';
SELECT pid, application_name
FROM   pg_stat_activity
WHERE  pid = pg_backend_pid();`, run: true },
    { task: 'Write a URI that connects user report_ro to database company_db on host pg.example.com, port 6432, enforcing full TLS verification and a 5-second connect timeout.', solution: `postgresql://report_ro@pg.example.com:6432/company_db?sslmode=verify-full&connect_timeout=5`, run: false }
  ],
  challenge: { task: 'Audit the parsed pg_hba.conf: list any rule that uses trust or md5, or allows every address (0.0.0.0/0 or ::/0) without being a reject rule, and flag each with a reason.', hint: 'Use pg_hba_file_rules; combine conditions with CASE to produce a reason column.', solution: `SELECT rule_number, type, database, user_name, address, auth_method,
       CASE
         WHEN auth_method = 'trust' THEN 'no password required'
         WHEN auth_method = 'md5'   THEN 'legacy md5 (deprecated)'
         WHEN address IN ('0.0.0.0', '::') AND auth_method <> 'reject' THEN 'open to every address'
       END AS finding
FROM   pg_hba_file_rules
WHERE  auth_method IN ('trust', 'md5')
   OR (address IN ('0.0.0.0', '::') AND auth_method <> 'reject')
ORDER  BY rule_number;`, run: true },
  related: ['fundamentals-architecture', 'security', 'connection-pooling', 'configuration'],
  quiz: [
    { type: 'mcq', q: 'Which sslmode both encrypts and verifies the server certificate and host name?', options: ['prefer', 'require', 'verify-ca', 'verify-full'], answer: 3, explain: 'verify-full checks the CA chain and that the host name matches the certificate.' },
    { type: 'tf', q: 'pg_hba.conf rules are evaluated top to bottom and the first matching rule decides.', answer: true, explain: 'There is no fall-through: if the first match is reject or its authentication fails, later lines are not tried.' },
    { type: 'mcq', q: 'You changed listen_addresses from localhost to \'*\' and ran SELECT pg_reload_conf(). Remote clients still get "connection refused". Why?', options: ['pg_hba.conf is wrong', 'listen_addresses requires a full restart', 'max_connections is too low', 'TLS is disabled'], answer: 1, explain: 'listen_addresses has context postmaster; a reload does not rebind sockets. Restart the server.' },
    { type: 'bug', q: 'libpq keeps prompting for a password although ~/.pgpass has the right line. Most likely cause?', code: `$ ls -l ~/.pgpass
-rw-r--r-- 1 asha asha 52 Oct  1 10:00 /home/asha/.pgpass`, options: ['Wrong line format', 'File permissions are too open; libpq requires 0600', 'pgpass only works on Windows', 'PGPASSWORD overrides it'], answer: 1, explain: 'libpq ignores a .pgpass readable by group/others; chmod 600 ~/.pgpass.' },
    { type: 'write', q: 'Write a pg_hba.conf line allowing role app_user to connect only to company_db from 10.20.0.0/16 over TLS with SCRAM authentication.', solution: `hostssl  company_db  app_user  10.20.0.0/16  scram-sha-256`, explain: 'hostssl enforces TLS; database and user are restricted; CIDR limits the source network; scram-sha-256 is the modern password method.' }
  ]
}
]);

/* ============================ MODULE: sql-fundamentals ============================ */
PGM.addLessons([
{
  id: 'sql-fundamentals-categories-pipeline',
  module: 'sql-fundamentals',
  title: 'SQL Language Categories (DDL, DML, DCL, TCL) and How a Query Is Processed',
  level: 1,
  minutes: 18,
  summary: 'The four families of SQL statements and the journey of a query through PostgreSQL: parser, analyzer, rewriter, planner and executor.',
  objectives: [
    'Classify any SQL statement as DDL, DML (including DQL), DCL or TCL',
    'Explain that SQL is declarative: you describe the result, the planner chooses the method',
    'Describe the five stages of query processing: parse, analyze, rewrite, plan, execute',
    'Use EXPLAIN to see the plan the planner chose',
    'Recognise which stage produced an error (syntax vs semantic vs runtime)',
    'Know that PostgreSQL DDL is transactional and can be rolled back'
  ],
  concept: `
<p><strong>SQL</strong> (Structured Query Language, standardised as ISO/IEC 9075) is the language for talking to relational databases. Its statements fall into four families:</p>
<table>
<tr><th>Family</th><th>Purpose</th><th>Statements</th></tr>
<tr><td><strong>DDL</strong> — Data Definition Language</td><td>Define and change <em>structure</em></td><td><code>CREATE</code>, <code>ALTER</code>, <code>DROP</code>, <code>TRUNCATE</code>, <code>COMMENT</code>, <code>RENAME</code></td></tr>
<tr><td><strong>DML</strong> — Data Manipulation Language</td><td>Read and change <em>data</em></td><td><code>SELECT</code> (often singled out as <strong>DQL</strong>, Data Query Language), <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>, <code>MERGE</code>, <code>COPY</code></td></tr>
<tr><td><strong>DCL</strong> — Data Control Language</td><td>Control <em>access</em></td><td><code>GRANT</code>, <code>REVOKE</code> (plus PostgreSQL's <code>CREATE ROLE</code>, <code>ALTER DEFAULT PRIVILEGES</code>)</td></tr>
<tr><td><strong>TCL</strong> — Transaction Control Language</td><td>Group work into atomic units</td><td><code>BEGIN</code>/<code>START TRANSACTION</code>, <code>COMMIT</code>, <code>ROLLBACK</code>, <code>SAVEPOINT</code>, <code>ROLLBACK TO SAVEPOINT</code>, <code>RELEASE</code></td></tr>
</table>
<p><strong>Analogy: running a warehouse.</strong> DDL is building and rearranging the shelves. DML is putting boxes on shelves, moving them and taking them away (and SELECT is reading the inventory). DCL is issuing keycards: who may enter which aisle. TCL is the delivery checklist that is either fully signed off (COMMIT) or torn up (ROLLBACK) — never half done.</p>
<h4>SQL is declarative</h4>
<p>You state <em>what</em> you want: "names of employees in department 3 sorted by last name". You do <em>not</em> say "open the file, loop over rows, check the department, build a list, sort it". PostgreSQL's <strong>planner</strong> decides how — sequential scan or index, hash join or nested loop, sort in memory or on disk — based on statistics. The same SQL can get a different, better plan tomorrow when data grows or you add an index, without changing application code.</p>
<h4>The journey of a query</h4>
<ol>
<li><strong>Parser</strong> — checks <em>grammar</em> and builds a parse tree. Misspelled keywords or a missing parenthesis fail here: <em>syntax error at or near ...</em>.</li>
<li><strong>Analyzer</strong> (semantic analysis) — looks names up in the catalogs: do the table and columns exist, are types compatible, which function overload applies? Produces a <em>query tree</em>. Errors: <em>column "x" does not exist</em>, <em>operator does not exist: integer = text</em>.</li>
<li><strong>Rewriter</strong> — applies rules, most importantly expanding <strong>views</strong> into their underlying queries (and adding row-level security filters).</li>
<li><strong>Planner/optimizer</strong> — enumerates possible plans, estimates the cost of each using table statistics (<code>pg_statistic</code>) and picks the cheapest. Output: a <em>plan tree</em> — what <code>EXPLAIN</code> shows.</li>
<li><strong>Executor</strong> — runs the plan tree, pulling rows node by node (the "Volcano"/iterator model), reading pages through shared buffers, and streams results to the client. Runtime errors happen here: division by zero, constraint violations, lock timeouts.</li>
</ol>`,
  why: `
<p>Knowing the categories tells you what a statement can affect and how to secure it: application roles typically get DML only, migration roles get DDL, and only administrators get DCL. Knowing the pipeline tells you <em>where</em> to look when something goes wrong: a syntax error is fixed in your text, an analyzer error in your names or types, a planner problem (slow query) with indexes or statistics, and an executor error in your data or concurrency. It also explains why prepared statements save time — they skip parse and analyze on repeated execution.</p>`,
  useCase: `
<p><strong>A fintech's release process</strong> separates privileges by category. The CI pipeline runs DDL migrations as <code>migrator</code> inside a single transaction (PostgreSQL's transactional DDL means a failed migration leaves no half-built schema). The application connects as <code>app_rw</code>, which has DML rights only; a SQL-injection bug therefore cannot <code>DROP TABLE</code>. Compliance auditors review every DCL change (<code>GRANT</code>/<code>REVOKE</code>) captured by <code>log_statement = 'ddl'</code>. When a dashboard query becomes slow after a data import, the DBA reads its <code>EXPLAIN</code> output (planner stage), finds a stale row estimate, runs <code>ANALYZE</code>, and the plan flips from a nested loop to a hash join.</p>`,
  internals: `
<p>Each backend runs the pipeline for every simple query message. For the <em>extended protocol</em> (prepared statements used by most drivers), parse/analyze/rewrite happen once at <code>Parse</code>; planning happens at <code>Bind</code>/<code>Execute</code>, and after five executions PostgreSQL may switch to a cached <em>generic plan</em> if it is not more expensive than custom plans (<code>plan_cache_mode</code> controls this). The planner's search uses dynamic programming for joins of up to <code>geqo_threshold</code> (12) relations and a genetic algorithm beyond that. The executor uses a demand-pull model: the top node asks its child for the next row, which asks its child, and so on — which is why <code>LIMIT 10</code> can stop a scan early.</p>`,
  whenNot: `
<p>Categories are a classification, not a rule set — some statements straddle them (<code>TRUNCATE</code> deletes data but is classed as DDL; <code>SELECT ... INTO</code> creates a table). Do not use the "DDL auto-commits" mental model from Oracle/MySQL in PostgreSQL: here, DDL participates in transactions. And do not try to control <em>how</em> a query executes with hints — core PostgreSQL has no optimizer hints (the <code>pg_hint_plan</code> <span class="tag ext">extension</span> exists); fix statistics, indexes or the query instead.</p>`,
  syntax: `-- DDL
CREATE TABLE t (...);   ALTER TABLE t ADD COLUMN c text;   DROP TABLE t;   TRUNCATE t;
-- DML / DQL
SELECT ... FROM t;   INSERT INTO t ...;   UPDATE t SET ...;   DELETE FROM t ...;   MERGE INTO t ...;
-- DCL
GRANT SELECT, INSERT ON t TO role_name;   REVOKE INSERT ON t FROM role_name;
-- TCL
BEGIN;  SAVEPOINT s1;  ROLLBACK TO SAVEPOINT s1;  RELEASE SAVEPOINT s1;  COMMIT;  -- or ROLLBACK;
-- See the planner's decision
EXPLAIN [ ( ANALYZE, BUFFERS, COSTS OFF ) ] <statement>;`,
  examples: [
    { label: 'Basic', title: 'DDL, DML and DCL in one script',
      sql: `-- DDL: define structure
CREATE TABLE training_sessions (
  id            int  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic         text NOT NULL,
  session_date  date NOT NULL
);

-- DML: change and read data
INSERT INTO training_sessions (topic, session_date)
VALUES ('SQL basics', '2025-11-03'), ('Indexes', '2025-11-10');

UPDATE training_sessions SET topic = 'SQL fundamentals' WHERE id = 1;

SELECT id, topic, session_date FROM training_sessions ORDER BY id;

-- DCL: control access
CREATE ROLE report_reader NOLOGIN;
GRANT SELECT ON training_sessions TO report_reader;

SELECT grantee, privilege_type
FROM   information_schema.role_table_grants
WHERE  table_name = 'training_sessions' AND grantee = 'report_reader';`,
      explain: `<ul><li><code>CREATE TABLE</code> (DDL) creates catalog entries and an empty data file.</li>
<li><code>INSERT</code>/<code>UPDATE</code>/<code>SELECT</code> (DML) work on rows. Each reports a <em>command tag</em> such as <code>INSERT 0 2</code> (the 0 is a historical OID field) or <code>UPDATE 1</code>.</li>
<li><code>GRANT</code> (DCL) writes an access-control list on the table; <code>information_schema.role_table_grants</code> shows it.</li></ul>`,
      output: `CREATE TABLE
INSERT 0 2
UPDATE 1
 id | topic            | session_date
----+------------------+--------------
  1 | SQL fundamentals | 2025-11-03
  2 | Indexes          | 2025-11-10
(2 rows)

CREATE ROLE
GRANT
 grantee       | privilege_type
---------------+----------------
 report_reader | SELECT
(1 row)`, run: true },
    { label: 'Intermediate', title: 'TCL: transactions, savepoints and transactional DDL',
      sql: `BEGIN;

SAVEPOINT before_raise;
UPDATE employees SET salary = salary * 1.10 WHERE department_id = 1;
SELECT round(avg(salary), 2) AS avg_after_raise FROM employees WHERE department_id = 1;

ROLLBACK TO SAVEPOINT before_raise;          -- undo only the raise
SELECT round(avg(salary), 2) AS avg_restored FROM employees WHERE department_id = 1;

CREATE TABLE scratch_notes (note text);       -- DDL inside a transaction
INSERT INTO scratch_notes VALUES ('temporary');

ROLLBACK;                                     -- undo everything, including CREATE TABLE

SELECT to_regclass('scratch_notes') AS table_exists_after_rollback;`,
      explain: `<p><code>BEGIN</code> opens a transaction. A <code>SAVEPOINT</code> marks a point you can return to without abandoning the whole transaction. After <code>ROLLBACK TO SAVEPOINT</code> the 10% raise has vanished.</p>
<p>The final <code>ROLLBACK</code> undoes even the <code>CREATE TABLE</code>: <code>to_regclass()</code> returns NULL because the table never became visible. In MySQL or Oracle the <code>CREATE TABLE</code> would have committed implicitly.</p>`,
      output: `BEGIN
SAVEPOINT
UPDATE 25
 avg_after_raise
-----------------
       106238.00

ROLLBACK
 avg_restored
--------------
     96580.00

CREATE TABLE
INSERT 0 1
ROLLBACK
 table_exists_after_rollback
-----------------------------

(1 row)`, run: true },
    { label: 'Advanced', title: 'Watch the planner decide: EXPLAIN',
      sql: `-- The declarative request...
SELECT d.name, count(*) AS well_paid
FROM   employees e
JOIN   departments d ON d.id = e.department_id
WHERE  e.salary > 100000
GROUP  BY d.name
ORDER  BY well_paid DESC, d.name;

-- ...and the procedural plan PostgreSQL chose for it
EXPLAIN (COSTS OFF)
SELECT d.name, count(*) AS well_paid
FROM   employees e
JOIN   departments d ON d.id = e.department_id
WHERE  e.salary > 100000
GROUP  BY d.name
ORDER  BY well_paid DESC, d.name;`,
      explain: `<p>Read the plan bottom-up (innermost first):</p>
<ol><li><code>Seq Scan on departments</code> → built into an in-memory <code>Hash</code>.</li>
<li><code>Seq Scan on employees</code> with <code>Filter: salary &gt; 100000</code> — the WHERE clause is pushed down to the scan.</li>
<li><code>Hash Join</code> matches each employee to its department.</li>
<li><code>HashAggregate</code> groups by department name and counts.</li>
<li><code>Sort</code> implements ORDER BY.</li></ol>
<p>With 200 employees, sequential scans are cheapest. On 20 million rows with an index on <code>salary</code> the planner might choose an index or bitmap scan instead — same SQL, different plan.</p>`,
      output: ` name        | well_paid
-------------+-----------
 Sales       |        16
 HR          |        15
 Engineering |        13
 Support     |        13
 Finance     |        12
 Marketing   |        12
 Research    |        11
 Operations  |        10
(8 rows)

 QUERY PLAN
----------------------------------------------------------
 Sort
   Sort Key: (count(*)) DESC, d.name
   ->  HashAggregate
         Group Key: d.name
         ->  Hash Join
               Hash Cond: (e.department_id = d.id)
               ->  Seq Scan on employees e
                     Filter: (salary > '100000'::numeric)
               ->  Hash
                     ->  Seq Scan on departments d
(10 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Procedural thinking: fetch everything and filter in the application
SELECT id, first_name, last_name, department_id, salary
FROM   employees;
-- ...then in application code:
-- for row in rows: if row.department_id == 3 and row.salary > 100000: result.append(row)`,
      why: 'Ships every row over the network, ignores indexes, and duplicates logic in code. With 10 million rows this is minutes of transfer instead of milliseconds.', run: true },
    good: { sql: `-- Declarative: describe the result, let the planner do the work
SELECT id, first_name, last_name, salary
FROM   employees
WHERE  department_id = 3
  AND  salary > 100000
ORDER  BY salary DESC;`,
      why: 'Filtering happens next to the data, can use idx_employees_department, and only the 12 matching rows cross the network.', run: true }
  },
  mistakes: [
    'Assuming DDL auto-commits like in MySQL/Oracle. In PostgreSQL a <code>CREATE TABLE</code> inside an open transaction disappears if you roll back — or stays invisible to others until you commit.',
    'Forgetting to <code>COMMIT</code> in an interactive session: your changes are invisible to everyone else and you hold locks until you disconnect.',
    'Granting broad DDL rights (or superuser) to application roles; DML is all an application normally needs.',
    'Trying to force a plan by rewriting SQL in contorted ways instead of looking at <code>EXPLAIN</code> and fixing statistics or indexes.',
    'Confusing error stages: "column does not exist" is not a syntax error — the grammar was fine, the name lookup failed.'
  ],
  best: [
    'Run migrations (DDL) inside explicit transactions so they are all-or-nothing.',
    'Separate roles by statement family: migration role (DDL), application role (DML), read-only role (SELECT), admin (DCL).',
    'Use <code>EXPLAIN</code> (later <code>EXPLAIN ANALYZE</code>) whenever a query matters for performance.',
    'Keep transactions short; use savepoints for partial retries inside long batches.',
    'Write SQL keywords in upper case and identifiers in lower case for readability (PostgreSQL itself is case-insensitive for keywords).'
  ],
  performance: `
<p>Parsing and planning cost microseconds to a few milliseconds; for very frequent simple queries that overhead matters, which is why drivers use prepared statements and PostgreSQL caches plans. The planner's choice dominates performance: a wrong join order or a missed index can make a query 1,000× slower. The planner is only as good as its statistics — <code>ANALYZE</code> (run automatically by autovacuum) keeps them fresh. TCL matters too: a transaction left open for hours prevents VACUUM from removing dead rows across the whole database.</p>`,
  security: `
<p>Grant privileges per statement family and per object (<code>GRANT SELECT, INSERT, UPDATE ON orders TO app_rw</code>), never <code>ALL PRIVILEGES</code> to applications. Since DDL rights let a role create functions and tables, restrict <code>CREATE</code> on schemas. Use parameterised queries in application code so user input never reaches the parser as SQL text — this is the definitive defence against SQL injection.</p>`,
  widgets: ['diagram:query-pipeline'],
  interview: [
    { q: 'Name the four SQL statement categories with two examples each.', a: 'DDL defines structure (CREATE TABLE, ALTER TABLE, DROP, TRUNCATE). DML manipulates data (SELECT, INSERT, UPDATE, DELETE, MERGE) — SELECT is sometimes called DQL. DCL controls access (GRANT, REVOKE). TCL controls transactions (BEGIN, COMMIT, ROLLBACK, SAVEPOINT).' },
    { q: 'Walk through what happens when PostgreSQL executes a SELECT.', a: 'The parser checks syntax and builds a parse tree; the analyzer resolves tables, columns, types and functions via the catalogs; the rewriter expands views and applies rules/RLS; the planner generates candidate plans and picks the cheapest by cost estimates from statistics; the executor runs the plan tree, pulling rows through nodes and sending them to the client.' },
    { q: 'Is DDL transactional in PostgreSQL? Why does that matter?', a: 'Yes, almost all DDL (except things like CREATE DATABASE, CREATE INDEX CONCURRENTLY, VACUUM) can run inside a transaction and be rolled back. It makes migrations atomic: if step 7 of 10 fails, the schema returns to its previous state instead of being half-migrated.' },
    { q: 'What is the difference between a syntax error and a semantic error?', a: 'A syntax error is raised by the parser when the text does not follow SQL grammar (e.g. SELECT FROM WHERE). A semantic error is raised by the analyzer when the grammar is valid but names or types are wrong (unknown column, type mismatch, ambiguous reference).' }
  ],
  exercises: [
    { task: 'Classify each statement and run the runnable ones: CREATE TABLE tmp_x(id int); INSERT INTO tmp_x VALUES (1); SELECT * FROM tmp_x; TRUNCATE tmp_x;', solution: `-- DDL
CREATE TABLE tmp_x (id int);
-- DML
INSERT INTO tmp_x VALUES (1);
-- DML (DQL)
SELECT * FROM tmp_x;
-- DDL (even though it removes data)
TRUNCATE tmp_x;`, run: true },
    { task: 'Show the plan PostgreSQL uses for "SELECT first_name FROM employees WHERE id = 42". Which index does it use?', solution: `EXPLAIN SELECT first_name FROM employees WHERE id = 42;
-- Index Scan using employees_pkey on employees`, run: true },
    { task: 'Inside one transaction, delete all cancelled orders, count the remaining orders, then roll back and count again.', solution: `BEGIN;
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE status = 'cancelled');
DELETE FROM payments    WHERE order_id IN (SELECT id FROM orders WHERE status = 'cancelled');
DELETE FROM orders WHERE status = 'cancelled';
SELECT count(*) AS during_txn FROM orders;
ROLLBACK;
SELECT count(*) AS after_rollback FROM orders;`, run: true }
  ],
  challenge: { task: 'Create a view high_value_orders (orders with total_amount > 400000), then show with EXPLAIN that the rewriter merged the view into your query: the plan must show a scan on orders with both the view\'s filter and your extra filter status = \'paid\'.', hint: 'CREATE VIEW, then EXPLAIN (COSTS OFF) SELECT ... FROM high_value_orders WHERE status = \'paid\'.', solution: `CREATE VIEW high_value_orders AS
SELECT id, customer_id, status, total_amount
FROM   orders
WHERE  total_amount > 400000;

EXPLAIN (COSTS OFF)
SELECT id, total_amount
FROM   high_value_orders
WHERE  status = 'paid';`, run: true },
  related: ['sql-fundamentals-first-select', 'transactions', 'explain', 'query-optimization'],
  quiz: [
    { type: 'mcq', q: 'TRUNCATE belongs to which category?', options: ['DML', 'DDL', 'DCL', 'TCL'], answer: 1, explain: 'Although it removes data, TRUNCATE is classified as DDL: it replaces the table\'s storage rather than deleting rows one by one.' },
    { type: 'mcq', q: 'Which stage turns a view reference into the view\'s underlying query?', options: ['Parser', 'Analyzer', 'Rewriter', 'Executor'], answer: 2, explain: 'The rewriter applies the rule system, which implements views.' },
    { type: 'predict', q: 'What does the final SELECT return?', code: `BEGIN;
CREATE TABLE t_demo (id int);
ROLLBACK;
SELECT to_regclass('t_demo');`, options: ['t_demo', 'NULL', 'An error', 'true'], answer: 1, explain: 'DDL is transactional; the rolled-back table never existed, so to_regclass returns NULL.' },
    { type: 'tf', q: 'The error "column \\"first_nme\\" does not exist" is raised by the parser.', answer: false, explain: 'The grammar was valid; the analyzer failed to resolve the column name against the catalog.' },
    { type: 'scenario', q: 'An application role must read and write orders but never change table structure. Which grants fit?', options: ['GRANT ALL PRIVILEGES ON DATABASE', 'GRANT SELECT, INSERT, UPDATE, DELETE ON orders', 'ALTER ROLE app SUPERUSER', 'GRANT CREATE ON SCHEMA public'], answer: 1, explain: 'DML privileges on the specific table, nothing more: least privilege.' }
  ]
},
{
  id: 'sql-fundamentals-first-select',
  module: 'sql-fundamentals',
  title: 'Your First SELECT: Columns, Aliases, Expressions and Why to Avoid SELECT *',
  level: 1,
  minutes: 18,
  summary: 'Write clear SELECT statements: choose columns, compute expressions, name results with aliases, and understand why SELECT * hurts in production code.',
  objectives: [
    'Write SELECT ... FROM with an explicit column list',
    'Compute expressions with arithmetic, string concatenation and functions',
    'Name output columns with AS aliases (and know when double quotes are needed)',
    'Avoid integer-division and rounding surprises',
    'Explain the concrete costs of SELECT * in application code',
    'Use table aliases to qualify columns'
  ],
  concept: `
<p><code>SELECT</code> is the statement you will write more than any other. In its simplest form it says: <em>from this table, give me these columns</em>.</p>
<p><strong>Analogy: ordering at a restaurant.</strong> <code>FROM</code> picks the restaurant's menu, the select list is your order. "Bring me everything on the menu" (<code>SELECT *</code>) is technically valid, but slow, expensive, and when the chef adds a new dish your table overflows. Name exactly the dishes you want.</p>
<h4>The select list</h4>
<ul>
<li><strong>Columns</strong> — <code>first_name, last_name</code>. Output columns appear in the order you list them, not table order.</li>
<li><strong>Expressions</strong> — anything that computes a value per row: <code>salary / 12</code>, <code>first_name || ' ' || last_name</code>, <code>upper(category)</code>, <code>price * stock</code>, <code>attributes -&gt;&gt; 'brand'</code>, or constants like <code>'v1' AS api_version</code>.</li>
<li><strong>Aliases</strong> — <code>expression AS name</code> renames the output column. <code>AS</code> is optional but recommended for readability. An alias with spaces or capitals needs double quotes: <code>AS "Annual Salary"</code> — fine for a report, but avoid in application code.</li>
<li><strong>Table aliases</strong> — <code>FROM employees e</code> lets you write <code>e.salary</code>; essential once you join tables that share column names such as <code>id</code> and <code>name</code>.</li>
</ul>
<h4>Expression gotchas</h4>
<ul>
<li><strong>Integer division truncates</strong>: <code>7 / 2</code> = <code>3</code>. Make one operand numeric: <code>7 / 2.0</code> or <code>7::numeric / 2</code>.</li>
<li><code>||</code> concatenates strings; with a <code>NULL</code> operand the result is <code>NULL</code> (use <code>concat()</code> or <code>concat_ws()</code> to skip NULLs).</li>
<li><code>^</code> is exponentiation, <code>%</code> is modulo, <code>round(x, 2)</code> rounds numerics.</li>
<li>A SELECT without FROM is legal in PostgreSQL: <code>SELECT 2 + 2;</code> — handy as a calculator.</li>
</ul>
<h4>Why not SELECT *?</h4>
<p><code>SELECT *</code> is perfect for a quick look in psql. In application code, views and reports it causes real problems: it transfers columns you don't use (wide <code>text</code>/<code>jsonb</code> columns may need detoasting — extra I/O), it prevents <em>index-only scans</em>, it silently changes shape when someone adds or reorders columns (breaking positional readers, <code>INSERT ... SELECT *</code> and <code>UNION</code>s), and it hides intent from reviewers.</p>`,
  why: `
<p>A query's select list is a contract between the database and the code that reads the result. Explicit columns make that contract stable and self-documenting, and they let PostgreSQL do less work. Expressions and aliases let you shape data at the source — computing tax, formatting names, extracting JSON fields — so every consumer gets consistent results rather than re-implementing the same calculation in five services.</p>`,
  useCase: `
<p><strong>An e-commerce product listing API</strong> serves 2,000 requests per second. The original ORM query was <code>SELECT * FROM products</code>, pulling a 30&nbsp;kB <code>description</code> and a large <code>attributes</code> document for every card on the page. Switching to <code>SELECT id, sku, name, price, attributes-&gt;&gt;'brand' AS brand</code> cut network traffic by 95%, and with a covering index on <code>(category) INCLUDE (id, sku, name, price)</code> the hot path became an index-only scan. p95 latency dropped from 48&nbsp;ms to 6&nbsp;ms.</p>`,
  internals: `
<p>The analyzer expands <code>*</code> into the table's current column list at <em>parse time</em>. That is why a view defined with <code>SELECT *</code> keeps the columns that existed when the view was created — new columns added later do not appear in the view. For each output row the executor evaluates the target list expressions (compiled with JIT for very large queries). Columns that are not referenced are never extracted from the tuple; large values stored out-of-line in TOAST tables are only fetched and decompressed if the query references them — so an omitted <code>body</code> column really is cheaper.</p>`,
  whenNot: `
<ul>
<li><code>SELECT *</code> is fine for ad-hoc exploration (<code>SELECT * FROM orders LIMIT 5</code>), in <code>EXISTS (SELECT * ...)</code> subqueries where the select list is ignored, and in <code>SELECT * FROM my_function()</code> when the function defines the shape.</li>
<li>Don't compute presentation-only formatting (currency symbols, localised dates) in SQL if every client formats differently; return raw values and format at the edge.</li>
<li>Avoid quoted, mixed-case aliases in application code — they force every consumer to quote them.</li>
</ul>`,
  syntax: `SELECT column1,
       column2 AS alias,
       expression AS computed_name,
       t.column3
FROM   table_name [ AS ] t
[ WHERE condition ]
[ ORDER BY ... ]
[ LIMIT n ];

SELECT expression;          -- no FROM needed for constants`,
  examples: [
    { label: 'Basic', title: 'Choose specific columns',
      sql: `SELECT first_name, last_name, job_title
FROM   employees
WHERE  department_id = 1
ORDER  BY id
LIMIT  5;`,
      explain: `<p>Three columns, in the order listed. <code>WHERE</code> keeps Engineering only, <code>ORDER BY id</code> makes the output deterministic (without ORDER BY, row order is <em>not</em> guaranteed), and <code>LIMIT 5</code> keeps the result short.</p>`,
      output: ` first_name | last_name | job_title
------------+-----------+--------------------
 Asha       | Rao       | Head of Department
 Rahul      | Menon     | Lead
 Reyansh    | Patel     | Engineer
 Ishaan     | Agarwal   | Analyst
 Aarav      | Malhotra  | Lead
(5 rows)`, run: true },
    { label: 'Intermediate', title: 'Expressions and aliases',
      sql: `SELECT first_name || ' ' || last_name           AS full_name,
       salary                                    AS annual_salary,
       round(salary / 12, 2)                     AS monthly_salary,
       hire_date,
       (DATE '2025-12-31' - hire_date) / 365     AS years_of_service
FROM   employees
WHERE  department_id = 1
ORDER  BY salary DESC
LIMIT  5;`,
      explain: `<ul><li><code>||</code> concatenates first and last names with a space.</li>
<li><code>round(salary / 12, 2)</code> — <code>salary</code> is <code>numeric</code>, so division is exact; <code>round</code> keeps 2 decimals.</li>
<li><code>date - date</code> returns an <code>integer</code> number of days; dividing by the integer 365 truncates to whole years — exactly what we want for "completed years" here.</li>
<li>Aliases (<code>AS full_name</code>) become the column headers, and can be used in <code>ORDER BY</code>.</li></ul>
<p>A fixed reference date (<code>2025-12-31</code>) keeps the result reproducible; in real reports you would use <code>current_date</code>.</p>`,
      output: ` full_name      | annual_salary | monthly_salary | hire_date  | years_of_service
----------------+---------------+----------------+------------+------------------
 Asha Rao       |     187500.00 |       15625.00 | 2014-02-24 |               11
 Rahul Gupta    |     149800.00 |       12483.33 | 2023-09-17 |                2
 Ishaan Agarwal |     146600.00 |       12216.67 | 2016-12-28 |                9
 Aarav Sharma   |     135400.00 |       11283.33 | 2016-01-22 |                9
 Aditya Saxena  |     133100.00 |       11091.67 | 2017-12-28 |                8
(5 rows)`, run: true },
    { label: 'Advanced', title: 'Computed business columns from several data types',
      sql: `SELECT p.sku,
       p.name,
       p.price,
       p.stock,
       p.price * p.stock                 AS stock_value,
       round(p.price * 1.18, 2)          AS price_incl_gst,     -- 18% GST
       upper(p.category)                 AS category,
       p.attributes ->> 'brand'          AS brand,              -- jsonb field as text
       (p.attributes -> 'specs' ->> 'weight_kg')::numeric AS weight_kg,
       cardinality(p.tags)               AS tag_count            -- array length
FROM   products AS p
ORDER  BY stock_value DESC
LIMIT  5;`,
      explain: `<p>Every output column is an expression over the current row:</p>
<ul><li><code>price * stock</code> — inventory value per product, used again by name in ORDER BY.</li>
<li><code>-&gt;</code> returns <code>jsonb</code>, <code>-&gt;&gt;</code> returns <code>text</code>; nested access walks <code>specs → weight_kg</code>, then <code>::numeric</code> casts the text.</li>
<li><code>cardinality(tags)</code> counts array elements.</li>
<li>The table alias <code>p</code> qualifies every column — a habit that pays off as soon as you add a join.</li></ul>`,
      output: ` sku      | name           | price    | stock | stock_value | price_incl_gst | category   | brand | weight_kg | tag_count
----------+----------------+----------+-------+-------------+----------------+------------+-------+-----------+-----------
 SKU-0076 | Desk Air 76    | 77630.52 |   470 | 36486344.40 |       91604.01 | FURNITURE  | Acme  |       6.5 |         1
 SKU-0036 | Desk Air 36    | 80166.28 |   441 | 35353329.48 |       94596.21 | FURNITURE  | Acme  |       2.9 |         2
 SKU-0006 | Desk Air 6     | 79213.29 |   422 | 33428008.38 |       93471.68 | FURNITURE  | Orbit |      11.7 |         2
 SKU-0016 | Desk Air 16    | 66651.34 |   471 | 31392781.14 |       78648.58 | FURNITURE  | Acme  |       2.4 |         1
 SKU-0038 | Router Lite 38 | 58758.28 |   485 | 28497765.80 |       69334.77 | NETWORKING | Orbit |      10.3 |         2
(5 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Application query: "just give me everything"
SELECT *
FROM   documents
WHERE  category = 'database';`,
      why: 'Pulls the full body text and the generated tsvector "search" column for every row although the page only shows titles; breaks silently when columns are added; cannot use an index-only scan.', run: true },
    good: { sql: `SELECT id,
       title,
       metadata ->> 'author' AS author,
       created_at
FROM   documents
WHERE  category = 'database'
ORDER  BY id;`,
      why: 'Fetches only what the page renders, has a stable shape, documents intent, and gives the planner the option of a covering index.', run: true }
  },
  mistakes: [
    'Integer division: <code>SELECT 7 / 2</code> returns 3, and <code>count(*) / total</code> percentages come out as 0. Cast one side: <code>count(*)::numeric / total</code>.',
    'Concatenating a NULL with <code>||</code> and getting a NULL full name — use <code>concat_ws(\' \', first_name, middle_name, last_name)</code>.',
    'Using single quotes for an alias (<code>AS \'Total\'</code>) — single quotes are string literals; aliases use double quotes or none.',
    'Expecting rows in insertion order without <code>ORDER BY</code>. Order is undefined and can change after an UPDATE or VACUUM.',
    'Using <code>SELECT *</code> in views — the view freezes the column list at creation time and surprises you later.'
  ],
  best: [
    'List columns explicitly in all application code, views and ETL.',
    'Use short, meaningful table aliases (<code>e</code>, <code>d</code>, <code>o</code>) and qualify every column once a query has more than one table.',
    'Give every computed column a lower_snake_case alias.',
    'Format one clause per line with the keyword aligned — readable diffs in code review.',
    'Always add <code>ORDER BY</code> when order matters, and <code>LIMIT</code> when exploring big tables.'
  ],
  performance: `
<p>The number and width of selected columns directly affect I/O, memory for sorts and hashes, and network transfer. Large values (&gt; ~2&nbsp;kB) are stored compressed in TOAST; selecting them forces extra page reads and decompression. Narrow select lists enable <strong>index-only scans</strong>, where PostgreSQL answers from the index without visiting the table at all. Expressions are cheap per row but add up over millions of rows — compute once in a subquery or generated column if reused heavily.</p>`,
  security: `
<p>Explicit columns are also a data-minimisation control: <code>SELECT *</code> on <code>users</code> leaks <code>password_hash</code> to any code path that logs or serialises the row. Combine with column-level privileges (<code>GRANT SELECT (id, username, role) ON users TO support_role</code>) so sensitive columns cannot be read even by mistake.</p>`,
  interview: [
    { q: 'Why is SELECT * discouraged in production code?', a: 'It transfers unnecessary data (including TOASTed large columns), prevents index-only scans, couples code to the table\'s current column order so schema changes break consumers or views silently, and can leak sensitive columns. Explicit lists are faster, stable and self-documenting.' },
    { q: 'What is the result of SELECT 7/2 in PostgreSQL and how do you get 3.5?', a: 'Both operands are integers, so integer division truncates to 3. Make one operand numeric or float: 7/2.0, 7::numeric/2, or 7/2::numeric.' },
    { q: 'Can you use a column alias in WHERE? In ORDER BY?', a: 'Not in WHERE, because WHERE is evaluated before the select list produces aliases. Yes in ORDER BY (and PostgreSQL also allows output aliases in GROUP BY as an extension), because ORDER BY is evaluated after SELECT.' }
  ],
  exercises: [
    { task: 'List each customer\'s name, city and country as one column called location (format "City, Country") for the first 5 customers by id.', solution: `SELECT name,
       city || ', ' || country AS location
FROM   customers
ORDER  BY id
LIMIT  5;`, run: true },
    { task: 'For the 5 most expensive products, show sku, name, price, a 10% discounted price rounded to 2 decimals (sale_price) and the saving.', solution: `SELECT sku,
       name,
       price,
       round(price * 0.90, 2)          AS sale_price,
       price - round(price * 0.90, 2)  AS saving
FROM   products
ORDER  BY price DESC
LIMIT  5;`, run: true },
    { task: 'Use SELECT without FROM to compute: 17 divided by 5 as an integer, as an exact decimal, and the remainder.', solution: `SELECT 17 / 5            AS int_div,
       17 / 5.0          AS exact_div,
       17 % 5            AS remainder;`, run: true }
  ],
  challenge: { task: 'Produce an "order line" report for order id 1: product name, quantity, unit_price, line_total (quantity × unit_price) and the line\'s share of the order total as a percentage with 1 decimal. Use table aliases and explicit columns only.', hint: 'Join order_items to products; divide by the sum of the order using a window function sum(...) OVER () or a subquery.', solution: `SELECT p.name                                   AS product,
       oi.quantity,
       oi.unit_price,
       oi.quantity * oi.unit_price              AS line_total,
       round(100.0 * oi.quantity * oi.unit_price
             / sum(oi.quantity * oi.unit_price) OVER (), 1) AS pct_of_order
FROM   order_items oi
JOIN   products   p ON p.id = oi.product_id
WHERE  oi.order_id = 1
ORDER  BY line_total DESC;`, run: true },
  related: ['sql-fundamentals-logical-order-nulls', 'querying-where-operators', 'querying-case-coalesce-cast', 'data-types-numeric'],
  quiz: [
    { type: 'predict', q: 'What does this return?', code: `SELECT 9 / 4 AS a, 9 / 4.0 AS b;`, options: ['2 and 2.25', '2.25 and 2.25', '2 and 2', '3 and 2.25'], answer: 0, explain: 'Integer / integer truncates; numeric division keeps the fraction (displayed as 2.2500000000000000).' },
    { type: 'bug', q: 'Why does this fail?', code: `SELECT first_name, salary * 12 AS yearly
FROM employees
WHERE yearly > 1000000;`, options: ['salary is not numeric', 'Aliases from the select list are not visible in WHERE', 'AS is not allowed for expressions', 'You must use HAVING'], answer: 1, explain: 'WHERE is evaluated before SELECT; repeat the expression or wrap the query in a subquery.' },
    { type: 'mcq', q: 'Which alias syntax is correct for a header with a space?', options: ['AS \'Total Sales\'', 'AS "Total Sales"', 'AS [Total Sales]', 'AS `Total Sales`'], answer: 1, explain: 'PostgreSQL uses double quotes for identifiers. Square brackets are SQL Server; backquotes are MySQL.' },
    { type: 'tf', q: 'Without ORDER BY, PostgreSQL returns rows in insertion order.', answer: false, explain: 'Order is unspecified; it depends on the physical layout and plan, and can change at any time.' },
    { type: 'optimize', q: 'A product grid page needs id, name and price. Best query?', code: `SELECT * FROM products WHERE category = 'audio';`, options: ['Keep SELECT * and cache it', 'SELECT id, name, price FROM products WHERE category = \'audio\'', 'SELECT DISTINCT * FROM products', 'Add LIMIT 1000000'], answer: 1, explain: 'Select only the needed columns; this also allows a covering index.' }
  ]
},
{
  id: 'sql-fundamentals-logical-order-nulls',
  module: 'sql-fundamentals',
  title: 'Logical Query Order (FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT) and NULL Three-Valued Logic',
  level: 1,
  minutes: 22,
  summary: 'Why SQL is written in one order but evaluated in another, what that means for aliases and aggregates, and how NULL makes every comparison three-valued.',
  objectives: [
    'List the logical evaluation order of a SELECT statement',
    'Predict where column aliases and aggregates may and may not be used',
    'Distinguish WHERE (filters rows) from HAVING (filters groups)',
    'Explain NULL as "unknown" and evaluate AND/OR/NOT with TRUE, FALSE and UNKNOWN',
    'Use IS NULL, IS NOT NULL and IS DISTINCT FROM correctly',
    'Explain and avoid the NOT IN + NULL trap'
  ],
  concept: `
<p>You <em>write</em> a query starting with <code>SELECT</code>, but PostgreSQL <em>logically evaluates</em> it in a different order:</p>
<table>
<tr><th>Step</th><th>Clause</th><th>What it does</th></tr>
<tr><td>1</td><td><code>FROM</code> / <code>JOIN</code></td><td>Build the working set of rows from tables and joins</td></tr>
<tr><td>2</td><td><code>WHERE</code></td><td>Keep only rows whose condition is <strong>TRUE</strong> (not FALSE, not UNKNOWN)</td></tr>
<tr><td>3</td><td><code>GROUP BY</code></td><td>Collapse rows into groups</td></tr>
<tr><td>4</td><td><code>HAVING</code></td><td>Keep only groups whose condition is TRUE (aggregates allowed)</td></tr>
<tr><td>5</td><td><code>SELECT</code></td><td>Compute output expressions, window functions, assign aliases</td></tr>
<tr><td>6</td><td><code>DISTINCT</code></td><td>Remove duplicate output rows</td></tr>
<tr><td>7</td><td><code>ORDER BY</code></td><td>Sort (aliases from SELECT are visible here)</td></tr>
<tr><td>8</td><td><code>LIMIT</code> / <code>OFFSET</code></td><td>Return a slice</td></tr>
</table>
<p><strong>Analogy: making a fruit salad for a party.</strong> First you fetch fruit from the market (FROM), throw away the bruised ones (WHERE), sort them into bowls by type (GROUP BY), discard bowls with too little fruit (HAVING), slice and label each bowl (SELECT — the labels are your aliases), arrange bowls on the table (ORDER BY) and serve only the first three (LIMIT). You cannot throw away fruit by its <em>label</em> before you have written the labels — that is why <code>WHERE yearly &gt; 100</code> fails when <code>yearly</code> is a SELECT alias.</p>
<p>This is a <em>logical</em> order that defines the meaning. The planner may physically reorder work (push filters into scans, use an index to avoid sorting, stop early for LIMIT) as long as the result is identical.</p>
<h4>NULL means "unknown"</h4>
<p><code>NULL</code> is not zero, not an empty string, not false — it is the <em>absence of a value</em>. Any comparison with an unknown is itself unknown: is an unknown end date later than 1 December? Unknown. SQL therefore uses <strong>three-valued logic</strong>: TRUE, FALSE and UNKNOWN (the boolean NULL).</p>
<table>
<tr><th>a</th><th>b</th><th>a AND b</th><th>a OR b</th><th>NOT a</th></tr>
<tr><td>TRUE</td><td>UNKNOWN</td><td>UNKNOWN</td><td>TRUE</td><td>FALSE</td></tr>
<tr><td>FALSE</td><td>UNKNOWN</td><td>FALSE</td><td>UNKNOWN</td><td>TRUE</td></tr>
<tr><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td></tr>
</table>
<ul>
<li><code>x = NULL</code> is always UNKNOWN — even when x is NULL. Use <code>x IS NULL</code> / <code>x IS NOT NULL</code>.</li>
<li><code>a IS DISTINCT FROM b</code> treats NULL as a comparable value: NULL vs NULL → FALSE, 1 vs NULL → TRUE.</li>
<li>Arithmetic and <code>||</code> with NULL yield NULL: <code>1 + NULL</code> → NULL.</li>
<li>Aggregates skip NULLs (<code>sum</code>, <code>avg</code>, <code>count(column)</code>); <code>count(*)</code> counts rows.</li>
<li><code>WHERE</code>, <code>HAVING</code>, <code>JOIN ... ON</code> keep a row only when the condition is TRUE. <code>CHECK</code> constraints, by contrast, <em>pass</em> when the result is UNKNOWN.</li>
</ul>`,
  why: `
<p>Most "SQL is weird" moments come from these two topics. Knowing the evaluation order tells you instantly why an alias is not found, why aggregates are forbidden in WHERE, and why <code>DISTINCT</code> conflicts with ordering by a column not in the select list. Understanding NULL logic prevents silent data bugs — reports that drop rows with missing values, <code>NOT IN</code> subqueries that return nothing, and inequality filters that quietly exclude unknowns. These bugs don't raise errors; they return plausible but wrong numbers.</p>`,
  useCase: `
<p><strong>A retail analytics team</strong> reported that "customers who never received a refund" had dropped to zero overnight. The query was <code>WHERE customer_id NOT IN (SELECT customer_id FROM refunds)</code>; a new manual-refund feature inserted rows with <code>customer_id = NULL</code>. One NULL in the subquery turned every <code>NOT IN</code> test into UNKNOWN, so no customer qualified. Rewriting it as <code>NOT EXISTS (SELECT 1 FROM refunds r WHERE r.customer_id = c.id)</code> fixed the dashboard, and a <code>NOT NULL</code> constraint fixed the data.</p>`,
  internals: `
<p>In the plan, WHERE conditions appear as <code>Filter:</code> or <code>Index Cond:</code> on scan nodes, GROUP BY as <code>HashAggregate</code>/<code>GroupAggregate</code>, HAVING as a <code>Filter:</code> on the aggregate node, ORDER BY as <code>Sort</code> (or is satisfied by an index), and LIMIT as a <code>Limit</code> node on top that stops pulling rows once satisfied. Internally every datum carries a separate null flag (a null bitmap in the tuple header), so NULLs take no data space. Operators declared <code>STRICT</code> — almost all built-ins — return NULL immediately if any input is NULL, which is how <code>1 + NULL</code> becomes NULL. <code>IS DISTINCT FROM</code> is implemented without the strictness short-circuit.</p>`,
  whenNot: `
<ul>
<li>Don't use NULL to mean a real value ("0", "not applicable", "unlimited"). If the business meaning is known, store it explicitly (e.g. <code>end_date</code> NULL = open-ended is acceptable and documented; a <code>discount</code> NULL meaning "no discount" is not — use 0 with <code>NOT NULL DEFAULT 0</code>).</li>
<li>Don't use <code>NOT IN (subquery)</code> on a nullable column — use <code>NOT EXISTS</code>.</li>
<li>Don't sprinkle <code>COALESCE</code> everywhere to "fix" NULLs; first ask whether the column should be <code>NOT NULL</code>.</li>
</ul>`,
  syntax: `SELECT   select_list            -- 5  (aliases are created here)
FROM     table_expression       -- 1
WHERE    row_condition          -- 2  (no aggregates, no select aliases)
GROUP BY grouping_columns       -- 3
HAVING   group_condition        -- 4  (aggregates allowed)
ORDER BY sort_keys              -- 7  (aliases allowed)
LIMIT    n OFFSET m;            -- 8

expr IS [NOT] NULL
a IS [NOT] DISTINCT FROM b
boolean_expr IS [NOT] TRUE | FALSE | UNKNOWN`,
  examples: [
    { label: 'Basic', title: 'Every clause, annotated with its evaluation step',
      sql: `SELECT   department_id,                       -- 5. compute output
         count(*)              AS active_staff,
         round(avg(salary))    AS avg_salary
FROM     employees                            -- 1. source rows (200)
WHERE    is_active                            -- 2. keep active employees (185)
GROUP BY department_id                        -- 3. one group per department (8)
HAVING   avg(salary) > 100000                 -- 4. keep well-paid departments
ORDER BY avg_salary DESC                      -- 7. alias is visible here
LIMIT    3;                                   -- 8. top three`,
      explain: `<p>Follow the numbers: 200 rows → 185 active → 8 groups → only groups with average salary above 100,000 → sorted by the alias → first three. <code>HAVING</code> can use <code>avg(salary)</code> because groups exist by then; <code>ORDER BY</code> can use the alias <code>avg_salary</code> because SELECT has already run.</p>`,
      output: ` department_id | active_staff | avg_salary
---------------+--------------+------------
             2 |           25 |     112676
             7 |           23 |     105852
             5 |           22 |     104768
(3 rows)`, run: true },
    { label: 'Intermediate', title: 'Alias visibility: repeat the expression or use a subquery',
      sql: `-- WHERE runs before SELECT, so the alias "yearly" is unknown there.
-- Option 1: repeat the expression in WHERE
SELECT first_name, last_name, salary * 12 AS yearly
FROM   employees
WHERE  salary * 12 > 2600000
ORDER  BY yearly DESC;

-- Option 2: compute it in a subquery (derived table), then filter on the alias
SELECT *
FROM  (SELECT first_name, last_name, salary * 12 AS yearly
       FROM   employees) AS t
WHERE  t.yearly > 2600000
ORDER  BY t.yearly DESC;`,
      explain: `<p>Writing <code>WHERE yearly &gt; 2600000</code> raises <em>column "yearly" does not exist</em>. Both fixes are equivalent and produce the same plan — the planner flattens the subquery. For longer expressions, the subquery (or a CTE, or a <code>LATERAL</code> join) avoids duplication. Similarly, aggregates cannot appear in WHERE (<em>aggregate functions are not allowed in WHERE</em>) — use HAVING.</p>`,
      output: ` first_name | last_name | yearly
------------+-----------+------------
 Nikhil     | Joshi     | 2880000.00
 Kavya      | Reddy     | 2790000.00
 Arjun      | Kapoor    | 2700000.00
 Priya      | Nair      | 2610000.00
(4 rows)

(the second query returns the same 4 rows)`, run: true },
    { label: 'Advanced', title: 'Three-valued logic: the truth table and its effect on filters',
      sql: `-- The full truth table, generated by SQL itself
SELECT a, b,
       a AND b AS a_and_b,
       a OR  b AS a_or_b,
       NOT a   AS not_a
FROM  (VALUES (true), (false), (NULL::boolean)) AS x(a)
CROSS JOIN (VALUES (true), (false), (NULL::boolean)) AS y(b)
ORDER BY a DESC NULLS LAST, b DESC NULLS LAST;

-- How UNKNOWN silently removes rows: 24 projects, 18 have no end_date
SELECT count(*)                                                      AS all_rows,
       count(end_date)                                               AS with_end_date,
       count(*) FILTER (WHERE end_date >  DATE '2024-12-01')         AS ends_after,
       count(*) FILTER (WHERE NOT (end_date > DATE '2024-12-01'))    AS not_ends_after,
       count(*) FILTER (WHERE (end_date > DATE '2024-12-01') IS NOT TRUE) AS is_not_true
FROM   projects;`,
      explain: `<p>In the truth table, blank cells are UNKNOWN (NULL). Note <code>FALSE AND UNKNOWN = FALSE</code> and <code>TRUE OR UNKNOWN = TRUE</code> — when one side decides the result, the unknown doesn't matter.</p>
<p>In the second query, <code>ends_after</code> (5) + <code>not_ends_after</code> (1) = 6, not 24! The 18 projects with a NULL <code>end_date</code> are neither "after" nor "not after" — both conditions are UNKNOWN and filters drop them. <code>IS NOT TRUE</code> treats UNKNOWN like FALSE and gives the complement you probably expected (19 = 24 − 5).</p>`,
      output: ` a | b | a_and_b | a_or_b | not_a
---+---+---------+--------+-------
 t | t | t       | t      | f
 t | f | f       | t      | f
 t |   |         | t      | f
 f | t | f       | t      | t
 f | f | f       | f      | t
 f |   | f       |        | t
   | t |         | t      |
   | f | f       |        |
   |   |         |        |
(9 rows)

 all_rows | with_end_date | ends_after | not_ends_after | is_not_true
----------+---------------+------------+----------------+-------------
       24 |             6 |          5 |              1 |          19
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- "Employees who manage nobody" — returns ZERO rows
SELECT count(*) AS non_managers
FROM   employees
WHERE  id NOT IN (SELECT manager_id FROM employees);`,
      why: 'The subquery returns NULL for the 8 department heads. "id NOT IN (..., NULL)" means "id <> ... AND id <> NULL", and "id <> NULL" is UNKNOWN, so no row is ever TRUE. No error — just a wrong answer.', run: true },
    good: { sql: `SELECT count(*) AS non_managers
FROM   employees e
WHERE  NOT EXISTS (SELECT 1
                   FROM   employees r
                   WHERE  r.manager_id = e.id);`,
      why: 'NOT EXISTS asks "is there any matching row?" — a pure TRUE/FALSE question that NULLs cannot poison. It returns the correct 173 and is planned as an efficient anti-join.', run: true }
  },
  mistakes: [
    'Writing <code>WHERE column = NULL</code> (always UNKNOWN → no rows). Use <code>IS NULL</code>.',
    'Using a SELECT alias in WHERE or an aggregate in WHERE — move the condition to HAVING or wrap in a subquery.',
    'Using <code>NOT IN (subquery)</code> where the subquery can return NULL — use <code>NOT EXISTS</code>.',
    'Assuming <code>WHERE status &lt;&gt; \'cancelled\'</code> returns rows where status is NULL. It does not; add <code>OR status IS NULL</code>, or use <code>IS DISTINCT FROM</code>.',
    'Expecting <code>avg(column)</code> to treat NULL as 0 — NULLs are skipped, so the average is over non-NULL values only.',
    'Filtering in HAVING what could be filtered in WHERE (e.g. <code>HAVING department_id = 3</code>) — it works but aggregates rows you then throw away.'
  ],
  best: [
    'Think in the logical order when writing a query: start from FROM, then WHERE, then GROUP BY…',
    'Put row filters in WHERE and only aggregate filters in HAVING.',
    'Make columns <code>NOT NULL</code> unless "unknown" is a genuine business state.',
    'Use <code>IS DISTINCT FROM</code> for NULL-safe comparisons (change detection, upserts, triggers).',
    'Prefer <code>NOT EXISTS</code> over <code>NOT IN</code> for anti-joins.',
    'When counting, be explicit: <code>count(*)</code> for rows, <code>count(col)</code> for non-NULL values.'
  ],
  performance: `
<p>Placement matters for performance even though the result is identical: conditions in WHERE are pushed down to scans and can use indexes; the same condition in HAVING runs after aggregation over every row. <code>LIMIT</code> lets the executor stop early, especially when an index already provides the ORDER BY order (top-N via index scan instead of sorting everything). <code>NOT EXISTS</code> becomes a hash or merge <em>anti-join</em>; <code>NOT IN (subquery)</code> cannot be turned into an anti-join because of NULL semantics and often runs as a slower hashed or even per-row subplan.</p>`,
  security: `
<p>NULL logic matters for authorisation filters. A row-level rule written as <code>WHERE owner_id &lt;&gt; current_setting('app.blocked_user')::int</code> silently hides rows whose <code>owner_id</code> is NULL, and a policy written as <code>tenant_id = current_setting('app.tenant_id', true)::int</code> returns nothing (fail-closed, good) when the setting is missing. Always reason about the UNKNOWN case in security predicates.</p>`,
  interview: [
    { q: 'What is the logical order of evaluation of a SELECT?', a: 'FROM/JOIN, WHERE, GROUP BY, HAVING, SELECT (including window functions), DISTINCT, ORDER BY, then LIMIT/OFFSET. It explains why SELECT aliases are available in ORDER BY but not in WHERE, and why aggregates belong in HAVING.' },
    { q: 'Why does WHERE x NOT IN (SELECT y FROM t) sometimes return no rows?', a: 'If any y is NULL, the predicate expands to x <> y1 AND ... AND x <> NULL; the last comparison is UNKNOWN, so the whole AND can never be TRUE, and WHERE discards every row. Use NOT EXISTS, or filter NULLs out of the subquery.' },
    { q: 'What is the difference between WHERE and HAVING?', a: 'WHERE filters individual rows before grouping and cannot reference aggregates; HAVING filters groups after aggregation and can. Row-level conditions should go in WHERE for efficiency.' },
    { q: 'Explain IS DISTINCT FROM.', a: 'It is a NULL-safe inequality: it returns TRUE or FALSE, never NULL. NULL IS DISTINCT FROM NULL is FALSE; 1 IS DISTINCT FROM NULL is TRUE. Useful for detecting changes between old and new values.' }
  ],
  exercises: [
    { task: 'List projects that have no end date (open-ended), showing id, name and status, ordered by id.', solution: `SELECT id, name, status
FROM   projects
WHERE  end_date IS NULL
ORDER  BY id;`, run: true },
    { task: 'For each department with at least 23 active employees, show department_id and the number of active employees. Put each condition in the correct clause.', solution: `SELECT department_id, count(*) AS active_staff
FROM   employees
WHERE  is_active                 -- row filter
GROUP  BY department_id
HAVING count(*) >= 23            -- group filter
ORDER  BY department_id;`, run: true },
    { task: 'Show, for the values (10), (20), (NULL), the results of count(*), count(x), sum(x) and avg(x). Explain why avg is 15 and not 10.', solution: `SELECT count(*) AS rows_, count(x) AS non_null, sum(x), avg(x)
FROM  (VALUES (10), (20), (NULL::int)) AS t(x);
-- avg skips NULL: (10+20)/2 = 15`, run: true }
  ],
  challenge: { task: 'Find all projects whose end_date is NOT 2024-09-21 — including open-ended projects — in two ways: once with explicit NULL handling and once with IS DISTINCT FROM. Both must return 23 rows.', hint: 'end_date <> X alone returns only 5 rows; add OR end_date IS NULL, or use IS DISTINCT FROM.', solution: `SELECT count(*) AS explicit_null_check
FROM   projects
WHERE  end_date <> DATE '2024-09-21' OR end_date IS NULL;

SELECT count(*) AS distinct_from
FROM   projects
WHERE  end_date IS DISTINCT FROM DATE '2024-09-21';`, run: true },
  related: ['sql-fundamentals-first-select', 'querying-null-pattern-matching', 'aggregations', 'subqueries'],
  quiz: [
    { type: 'mcq', q: 'Which clause is evaluated FIRST?', options: ['SELECT', 'WHERE', 'FROM', 'ORDER BY'], answer: 2, explain: 'FROM (with joins) builds the input rows; everything else operates on them.' },
    { type: 'predict', q: 'What does this return?', code: `SELECT NULL = NULL AS a, NULL IS NULL AS b;`, options: ['true, true', 'NULL, true', 'false, true', 'NULL, NULL'], answer: 1, explain: 'Comparing unknowns gives UNKNOWN (NULL); IS NULL is a true/false test.' },
    { type: 'predict', q: 'How many rows?', code: `SELECT 1 WHERE 3 NOT IN (1, 2, NULL);`, options: ['1 row', '0 rows', 'An error', '3 rows'], answer: 1, explain: '3 <> NULL is UNKNOWN, so the whole NOT IN is UNKNOWN and the row is filtered out.' },
    { type: 'tf', q: 'ORDER BY may reference a column alias defined in the SELECT list.', answer: true, explain: 'ORDER BY is evaluated after SELECT, so aliases are visible.' },
    { type: 'bug', q: 'Find the bug.', code: `SELECT department_id, count(*)
FROM employees
WHERE count(*) > 20
GROUP BY department_id;`, options: ['GROUP BY must come before WHERE', 'Aggregates are not allowed in WHERE; use HAVING count(*) > 20', 'count(*) needs a column', 'department_id must be aliased'], answer: 1, explain: 'WHERE runs before grouping; aggregate conditions go in HAVING.' }
  ]
}
]);

/* ============================ MODULE: database-design ============================ */
PGM.addLessons([
{
  id: 'database-design-keys-relationships',
  module: 'database-design',
  title: 'Keys and Relationships: Primary Keys, Foreign Keys, 1:1, 1:N and M:N',
  level: 1,
  minutes: 22,
  summary: 'Identify rows with primary keys, connect tables with foreign keys, and model one-to-one, one-to-many, many-to-many and self-referencing relationships with ER thinking.',
  objectives: [
    'Explain candidate, primary, alternate (unique) and foreign keys',
    'Model 1:1, 1:N and M:N relationships and choose where the foreign key goes',
    'Build a junction (associative) table with a composite primary key and its own attributes',
    'Choose ON DELETE behaviour: NO ACTION/RESTRICT, CASCADE, SET NULL, SET DEFAULT',
    'Model self-referencing hierarchies (employee → manager)',
    'Read existing relationships from the catalog'
  ],
  concept: `
<p>Relational design starts with <strong>entities</strong> (things the business cares about: customer, order, product, employee) and the <strong>relationships</strong> between them. Keys are how a database makes those relationships precise and enforceable.</p>
<p><strong>Analogy: a school.</strong> Every student has a unique roll number — the <em>primary key</em>. Their email is also unique — an <em>alternate key</em>. A class register lists roll numbers, not full student details — that column is a <em>foreign key</em>: it must refer to a student who actually exists. A student can join many clubs and a club has many students, so the school keeps a separate <em>membership register</em> (club, roll number, joined date) — a <em>junction table</em>.</p>
<h4>Kinds of keys</h4>
<ul>
<li><strong>Candidate key</strong> — any minimal set of columns that uniquely identifies a row (e.g. <code>employees.id</code>, <code>employees.email</code>).</li>
<li><strong>Primary key (PK)</strong> — the chosen candidate key. Implies <code>UNIQUE</code> + <code>NOT NULL</code>, creates a unique B-tree index. One per table.</li>
<li><strong>Alternate key</strong> — other candidate keys, enforced with <code>UNIQUE</code> (<code>customers.email</code>, <code>products.sku</code>).</li>
<li><strong>Foreign key (FK)</strong> — columns whose values must match a PK/UNIQUE key in a parent table (or be NULL). Enforces <em>referential integrity</em>: no orphans.</li>
<li><strong>Composite key</strong> — a key of several columns, e.g. <code>employee_projects (employee_id, project_id)</code>.</li>
</ul>
<h4>Relationship types (cardinality)</h4>
<table>
<tr><th>Type</th><th>Example in company_db</th><th>Implementation</th></tr>
<tr><td><strong>1:N</strong> (one-to-many)</td><td>One department has many employees; one customer has many orders</td><td>FK on the <em>many</em> side: <code>employees.department_id → departments.id</code></td></tr>
<tr><td><strong>M:N</strong> (many-to-many)</td><td>Employees work on many projects; projects have many employees</td><td>Junction table <code>employee_projects(employee_id, project_id, role, allocation_pct)</code> with two FKs and a composite PK</td></tr>
<tr><td><strong>1:1</strong> (one-to-one)</td><td>An employee has at most one access badge</td><td>FK that is also UNIQUE (often the child's PK = parent's PK)</td></tr>
<tr><td><strong>Self-referencing</strong></td><td>An employee reports to a manager who is also an employee</td><td><code>employees.manager_id → employees.id</code></td></tr>
</table>
<h4>ER thinking</h4>
<p>Before writing DDL, sketch an entity-relationship (ER) diagram: boxes for entities, lines with crow's-foot notation for cardinality, and ask two questions per relationship — "Can an A have many Bs?" and "Can a B have many As?". Two "yes" answers → M:N → junction table. Also ask about <em>optionality</em>: must every employee have a department? If yes, the FK column is <code>NOT NULL</code>.</p>
<h4>Referential actions</h4>
<table>
<tr><th>ON DELETE</th><th>When the parent row is deleted…</th><th>Typical use</th></tr>
<tr><td><code>NO ACTION</code> (default) / <code>RESTRICT</code></td><td>Error if children exist (NO ACTION can be deferred to commit)</td><td>Most business data: you must not delete a customer with orders</td></tr>
<tr><td><code>CASCADE</code></td><td>Children are deleted too</td><td>Parts of a whole: <code>order_items</code> of an order</td></tr>
<tr><td><code>SET NULL</code></td><td>Children's FK set to NULL</td><td>Optional links: a ticket's assignee leaves the company</td></tr>
<tr><td><code>SET DEFAULT</code></td><td>Children's FK set to its default</td><td>Re-home to an "unassigned" bucket</td></tr>
</table>`,
  why: `
<p>Without keys, a database is a pile of spreadsheets that drift apart: duplicate customers, orders pointing to products that no longer exist, payments for deleted orders. Primary keys guarantee every row can be addressed exactly once (needed for updates, replication and joins). Foreign keys guarantee that relationships stay valid no matter which application, script or person writes to the database. Modelling cardinality correctly prevents the two classic design bugs: comma-separated lists of IDs in one column (a hidden M:N) and duplicated parent data in child rows.</p>`,
  useCase: `
<p><strong>A hospital scheduling system</strong> models doctors, patients and appointments. Appointment is the junction between doctor and patient (M:N over time) and carries its own attributes: slot, room, status. <code>appointments.patient_id</code> uses <code>ON DELETE RESTRICT</code> because medical history must never vanish; <code>appointment_notes.appointment_id</code> uses <code>ON DELETE CASCADE</code> because notes are part of the appointment; <code>appointments.room_id</code> uses <code>SET NULL</code> because a decommissioned room should not delete history. A 1:1 <code>doctor_licenses</code> table keeps sensitive licence data separate, with stricter privileges.</p>`,
  internals: `
<p>A PK or UNIQUE constraint is backed by a unique B-tree index — the uniqueness check happens during index insertion. A FK is implemented by system triggers: on child INSERT/UPDATE, PostgreSQL looks up the parent key (using the parent's unique index) with a <code>FOR KEY SHARE</code> row lock so the parent cannot be deleted concurrently; on parent DELETE/UPDATE, it searches the child table for referencing rows. <strong>PostgreSQL does not automatically index the FK column on the child side</strong> — without an index, deleting one parent row scans the whole child table. That is why <code>idx_employees_department</code> exists in company_db, and why <code>orders(customer_id)</code> deliberately lacks one (you will add it in the Indexes module).</p>`,
  whenNot: `
<ul>
<li>High-volume append-only event/log tables (clickstreams, metrics) sometimes skip FKs to avoid per-row lookups — validate in the pipeline instead, and keep FKs on business tables.</li>
<li>Across microservice boundaries (data in different databases), FKs are impossible; use IDs plus reconciliation jobs.</li>
<li>Do not use a 1:1 split by default — only to separate optional, large, rarely-read or differently-secured columns.</li>
<li>Do not model M:N as an array of IDs (<code>project_ids int[]</code>) — arrays cannot have foreign keys and are painful to query and update.</li>
</ul>`,
  syntax: `CREATE TABLE parent (
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE                          -- alternate key
);

CREATE TABLE child (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id bigint NOT NULL REFERENCES parent (id)
              ON DELETE { NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT }
              ON UPDATE { NO ACTION | RESTRICT | CASCADE | ... }
);
CREATE INDEX ON child (parent_id);                   -- not created automatically!

-- M:N junction table
CREATE TABLE a_b (
  a_id bigint REFERENCES a (id) ON DELETE CASCADE,
  b_id bigint REFERENCES b (id) ON DELETE CASCADE,
  PRIMARY KEY (a_id, b_id)
);

-- table-level FK syntax
CONSTRAINT fk_name FOREIGN KEY (col1, col2) REFERENCES other (c1, c2)`,
  examples: [
    { label: 'Basic', title: 'Map the relationships that already exist in company_db',
      sql: `SELECT c.conrelid::regclass   AS child_table,
       a.attname               AS fk_column,
       c.confrelid::regclass   AS parent_table,
       CASE c.confdeltype
         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
       END                     AS on_delete
FROM   pg_constraint c
JOIN   pg_attribute  a ON a.attrelid = c.conrelid
                      AND a.attnum   = ANY (c.conkey)
WHERE  c.contype = 'f'
ORDER  BY c.conrelid::regclass::text, a.attname;`,
      explain: `<p><code>pg_constraint</code> stores every constraint; <code>contype = 'f'</code> selects foreign keys. <code>conkey</code> is an array of child column numbers, resolved to names through <code>pg_attribute</code>. Read the result as an ER diagram in table form:</p>
<ul><li><code>employees.department_id → departments</code> — 1:N.</li>
<li><code>employees.manager_id → employees</code> — self-reference (hierarchy).</li>
<li><code>employee_projects</code> has two FKs, both <code>CASCADE</code> — the M:N junction.</li>
<li><code>order_items.order_id</code> is <code>CASCADE</code> (items are part of an order) but <code>order_items.product_id</code> is <code>NO ACTION</code> (you cannot delete a product that was sold).</li></ul>`,
      output: ` child_table       | fk_column     | parent_table | on_delete
-------------------+---------------+--------------+-----------
 employee_projects | employee_id   | employees    | CASCADE
 employee_projects | project_id    | projects     | CASCADE
 employees         | department_id | departments  | NO ACTION
 employees         | manager_id    | employees    | NO ACTION
 order_items       | order_id      | orders       | CASCADE
 order_items       | product_id    | products     | NO ACTION
 orders            | customer_id   | customers    | NO ACTION
 payments          | order_id      | orders       | NO ACTION
 projects          | department_id | departments  | NO ACTION
(9 rows)`, run: true },
    { label: 'Intermediate', title: 'Model a many-to-many relationship with a junction table',
      sql: `-- Employees can take many training courses; a course has many employees.
CREATE TABLE courses (
  id    int  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL UNIQUE                         -- alternate key
);

CREATE TABLE enrollments (
  employee_id int  NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  course_id   int  NOT NULL REFERENCES courses   (id) ON DELETE RESTRICT,
  enrolled_on date NOT NULL DEFAULT current_date,     -- attribute of the relationship
  score       int  CHECK (score BETWEEN 0 AND 100),
  PRIMARY KEY (employee_id, course_id)                -- no duplicate enrollment
);
CREATE INDEX ON enrollments (course_id);              -- for "who is in course X?"

INSERT INTO courses (title) VALUES ('PostgreSQL Basics'), ('Query Tuning'), ('Data Modelling');
INSERT INTO enrollments (employee_id, course_id, enrolled_on, score) VALUES
  (9, 1, '2025-06-01', 88), (9, 2, '2025-07-01', 74),
  (10, 1, '2025-06-01', 91), (11, 3, '2025-08-15', NULL);

SELECT e.first_name, c.title, en.score
FROM   enrollments en
JOIN   employees   e ON e.id = en.employee_id
JOIN   courses     c ON c.id = en.course_id
ORDER  BY e.first_name, c.title;`,
      explain: `<ul><li>The composite PK <code>(employee_id, course_id)</code> both identifies an enrollment and prevents duplicates. Its index also serves "courses of employee X" lookups (leftmost column).</li>
<li>A separate index on <code>course_id</code> serves the reverse direction and FK checks when a course is deleted.</li>
<li><code>enrolled_on</code> and <code>score</code> belong to the <em>relationship</em>, not to either entity — a strong hint you need a junction table.</li>
<li><code>ON DELETE CASCADE</code> from employees: leaving the company removes their enrollments; <code>RESTRICT</code> from courses: a course with history cannot be deleted.</li></ul>`,
      output: ` first_name | title             | score
------------+-------------------+-------
 Anika      | Data Modelling    |
 Myra       | PostgreSQL Basics |    88
 Myra       | Query Tuning      |    74
 Sai        | PostgreSQL Basics |    91
(4 rows)`, run: true },
    { label: 'Advanced', title: 'One-to-one and self-referencing relationships',
      sql: `-- 1:1 — the child's primary key IS the foreign key, so at most one badge per employee
CREATE TABLE badges (
  employee_id  int  PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
  badge_number text NOT NULL UNIQUE,
  issued_on    date NOT NULL
);
INSERT INTO badges VALUES (1, 'B-0001', '2014-02-24'), (2, 'B-0002', '2014-04-05');

SELECT e.id, e.first_name, b.badge_number
FROM   employees e
LEFT   JOIN badges b ON b.employee_id = e.id      -- optional side: LEFT JOIN
WHERE  e.id <= 3
ORDER  BY e.id;

-- Self-reference — employees.manager_id points back at employees.id
SELECT e.id,
       e.first_name || ' ' || e.last_name AS employee,
       m.first_name || ' ' || m.last_name AS manager
FROM   employees e
LEFT   JOIN employees m ON m.id = e.manager_id     -- same table, two roles
WHERE  e.id IN (1, 9, 20, 30)
ORDER  BY e.id;`,
      explain: `<p>Because <code>badges.employee_id</code> is the primary key <em>and</em> a foreign key, each employee can have zero or one badge — a 1:1 (optional) relationship. <code>LEFT JOIN</code> keeps employees without a badge.</p>
<p>The self-join aliases <code>employees</code> twice: <code>e</code> as the employee, <code>m</code> as the manager. Department heads (like Asha, id 1) have <code>manager_id</code> NULL — the root of the hierarchy. Walking the full tree uses <code>WITH RECURSIVE</code>, covered in the CTE module.</p>`,
      output: ` id | first_name | badge_number
----+------------+--------------
  1 | Asha       | B-0001
  2 | Rohan      | B-0002
  3 | Meera      |
(3 rows)

 id | employee   | manager
----+------------+---------------
  1 | Asha Rao   |
  9 | Myra Patel | Rohan Mehta
 20 | Aarav Khan | Ishaan Chopra
 30 | Sai Sharma | Kabir Das
(4 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- M:N hidden in a text column, no foreign keys
CREATE TABLE project_staff_bad (
  project_id   int,
  employee_ids text            -- '9,15,22'
);
INSERT INTO project_staff_bad VALUES (1, '9,15,22'), (2, '9,9999');  -- 9999 doesn't exist!

-- "Which projects is employee 9 on?" needs string hacks and is unindexable
SELECT project_id
FROM   project_staff_bad
WHERE  ',' || employee_ids || ',' LIKE '%,9,%';`,
      why: 'No integrity (employee 9999 is accepted), no per-member attributes (role, allocation), string parsing for every lookup, no indexes, and concurrent edits overwrite each other.', run: true },
    good: { sql: `-- company_db already models it properly: one row per (employee, project)
SELECT ep.project_id, p.name, ep.role, ep.allocation_pct
FROM   employee_projects ep
JOIN   projects p ON p.id = ep.project_id
WHERE  ep.employee_id = 9
ORDER  BY ep.project_id;`,
      why: 'Each membership is a row with FKs to both sides, a composite PK preventing duplicates, room for relationship attributes, and index-backed lookups in both directions.', run: true }
  },
  mistakes: [
    'Forgetting to index foreign key columns — deletes on the parent and joins from parent to child become full scans of the child table.',
    'Storing lists of IDs in a text or array column instead of a junction table.',
    'Using <code>ON DELETE CASCADE</code> everywhere "for convenience" — one accidental <code>DELETE FROM customers</code> wipes orders, invoices and payments.',
    'Making an FK column nullable when the relationship is mandatory (every order must have a customer → <code>NOT NULL</code>).',
    'Creating a table without a primary key — logical replication, many ORMs and safe updates need one.',
    'Choosing a mutable value (email, phone) as the primary key that other tables reference.'
  ],
  best: [
    'Give every table a primary key; use a surrogate identity key unless a stable natural key exists.',
    'Enforce alternate keys with UNIQUE constraints (<code>email</code>, <code>sku</code>).',
    'Index every foreign key column (or make it the leading column of a composite index).',
    'Pick ON DELETE per relationship: RESTRICT/NO ACTION for business history, CASCADE for owned parts, SET NULL for optional links.',
    'Name FK columns <code>&lt;parent&gt;_id</code> so relationships are obvious.',
    'Draw the ER diagram first — then write DDL.'
  ],
  performance: `
<p>Each FK check is an index lookup on the parent's primary key — microseconds per row, but noticeable for bulk loads of millions of rows (load first, then add constraints with <code>NOT VALID</code> + <code>VALIDATE CONSTRAINT</code>). Missing indexes on the child side are the real performance trap: deleting 1,000 customers from a 50-million-row orders table without <code>orders(customer_id)</code> indexed triggers 1,000 sequential scans. Composite PKs on junction tables double as covering indexes for the most common access path.</p>`,
  security: `
<p>Referential integrity is also a data-protection control: it prevents dangling references that could later attach to a different, newly-created entity reusing an ID. Using <code>RESTRICT</code> on audit-relevant relationships ensures history cannot be erased by deleting a parent. For 1:1 splits that hold sensitive data (salary details, government IDs), grant privileges on the child table to a narrower set of roles than the parent.</p>`,
  widgets: ['diagram:normalization', 'lab:join'],
  interview: [
    { q: 'What is the difference between a primary key and a unique constraint?', a: 'Both enforce uniqueness via a unique index. A primary key also implies NOT NULL, there can be only one per table, and it is the default target of foreign keys and the row identity used by tools and logical replication. A table can have many UNIQUE constraints, and they allow NULLs (multiple NULLs by default unless NULLS NOT DISTINCT is specified).' },
    { q: 'How do you implement a many-to-many relationship?', a: 'With a junction table holding foreign keys to both entities, a composite primary key (or unique constraint) on the pair to prevent duplicates, an index on the second column for reverse lookups, and any attributes that belong to the relationship itself, such as role or enrolment date.' },
    { q: 'Does PostgreSQL create an index for a foreign key automatically?', a: 'No. It requires a unique index on the referenced (parent) columns, but the referencing (child) columns are not indexed automatically. You should usually create one, otherwise parent deletes/updates and parent-to-child joins scan the child table.' },
    { q: 'When would you use ON DELETE CASCADE versus RESTRICT?', a: 'CASCADE when the child is part of the parent and meaningless alone (order items of an order, enrollments of a deleted test user). RESTRICT/NO ACTION when the child is independent business history that must not disappear silently (orders of a customer, payments of an order).' }
  ],
  exercises: [
    { task: 'List each employee in project 2 (Project Borealis) with their role and allocation, using the junction table.', solution: `SELECT e.id, e.first_name, e.last_name, ep.role, ep.allocation_pct
FROM   employee_projects ep
JOIN   employees e ON e.id = ep.employee_id
WHERE  ep.project_id = 2
ORDER  BY e.id;`, run: true },
    { task: 'Create a 1:N table employee_phones (id identity PK, employee_id FK NOT NULL with ON DELETE CASCADE, phone text NOT NULL, kind text) plus an index on employee_id, and insert two phones for employee 1.', solution: `CREATE TABLE employee_phones (
  id          int  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id int  NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  phone       text NOT NULL,
  kind        text CHECK (kind IN ('mobile', 'office'))
);
CREATE INDEX ON employee_phones (employee_id);
INSERT INTO employee_phones (employee_id, phone, kind)
VALUES (1, '+91-98450-00001', 'mobile'), (1, '+91-80-4000-0001', 'office');
SELECT * FROM employee_phones;`, run: true },
    { task: 'Find foreign key columns in the public schema that have no index whose first column is that FK column.', solution: `SELECT c.conrelid::regclass AS table_name, a.attname AS fk_column
FROM   pg_constraint c
JOIN   pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE  c.contype = 'f'
  AND  NOT EXISTS (SELECT 1 FROM pg_index i
                   WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
ORDER  BY c.conrelid::regclass::text, a.attname;`, run: true }
  ],
  challenge: { task: 'Design and create a mini library model: authors, books, and a many-to-many book_authors table (a book can have several authors, with an author_order column). Insert one book with two authors and list the book with its authors in order.', hint: 'Junction table PK (book_id, author_id); add UNIQUE (book_id, author_order).', solution: `CREATE TABLE authors (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL);
CREATE TABLE books   (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, title text NOT NULL, isbn text UNIQUE);
CREATE TABLE book_authors (
  book_id      int NOT NULL REFERENCES books (id)   ON DELETE CASCADE,
  author_id    int NOT NULL REFERENCES authors (id) ON DELETE RESTRICT,
  author_order int NOT NULL CHECK (author_order > 0),
  PRIMARY KEY (book_id, author_id),
  UNIQUE (book_id, author_order)
);
CREATE INDEX ON book_authors (author_id);

INSERT INTO authors (name) VALUES ('Ramez Elmasri'), ('Shamkant Navathe');
INSERT INTO books (title, isbn) VALUES ('Fundamentals of Database Systems', '978-0133970777');
INSERT INTO book_authors VALUES (1, 1, 1), (1, 2, 2);

SELECT b.title, string_agg(a.name, ', ' ORDER BY ba.author_order) AS authors
FROM   books b
JOIN   book_authors ba ON ba.book_id = b.id
JOIN   authors a       ON a.id = ba.author_id
GROUP  BY b.title;`, run: true },
  related: ['database-design-normalization', 'database-design-surrogate-natural-keys', 'constraints', 'joins'],
  quiz: [
    { type: 'mcq', q: 'Where does the foreign key go in a one-to-many relationship (department → employees)?', options: ['departments.employee_id', 'employees.department_id', 'In a junction table', 'Both tables'], answer: 1, explain: 'The FK lives on the "many" side, pointing to the "one".' },
    { type: 'design', q: 'Students take many courses; courses have many students; each enrolment has a grade. Best design?', options: ['courses.student_ids int[]', 'students.course_id', 'A junction table enrolments(student_id, course_id, grade) with PK (student_id, course_id)', 'One wide table'], answer: 2, explain: 'M:N with relationship attributes → junction table.' },
    { type: 'tf', q: 'PostgreSQL automatically creates an index on foreign key columns.', answer: false, explain: 'Only the referenced side must have a unique index; you must index the referencing columns yourself.' },
    { type: 'scenario', q: 'Deleting a product that appears in past orders should be impossible. Which ON DELETE fits order_items.product_id?', options: ['CASCADE', 'SET NULL', 'RESTRICT / NO ACTION', 'SET DEFAULT'], answer: 2, explain: 'Sales history must be preserved; the delete must fail while references exist (archive the product instead).' },
    { type: 'mcq', q: 'How do you model "an employee has at most one badge"?', options: ['badges.employee_id with a plain index', 'badges.employee_id as PRIMARY KEY (or UNIQUE) and FK', 'employees.badge_ids array', 'A junction table'], answer: 1, explain: 'A unique FK limits each employee to one badge: 1:1 (optional).' }
  ]
},
{
  id: 'database-design-normalization',
  module: 'database-design',
  title: 'Normalization (1NF, 2NF, 3NF, BCNF) and When to Denormalize',
  level: 2,
  minutes: 26,
  summary: 'Eliminate redundancy and update anomalies step by step with worked examples for 1NF, 2NF, 3NF and BCNF — then learn when controlled denormalization is the right call.',
  objectives: [
    'Explain update, insert and delete anomalies caused by redundancy',
    'Identify functional dependencies and candidate keys in a table',
    'Bring a table to 1NF (atomic values, no repeating groups)',
    'Remove partial dependencies (2NF) and transitive dependencies (3NF)',
    'Recognise and fix a BCNF violation, and its trade-off',
    'Decide when denormalization (materialized views, summary tables, copied columns) is justified'
  ],
  concept: `
<p><strong>Normalization</strong> is the process of organising columns into tables so that <em>each fact is stored exactly once</em>. It was formalised by E. F. Codd as a series of <strong>normal forms</strong>; each form removes a specific kind of redundancy.</p>
<p><strong>Analogy: a family address book.</strong> If you write your cousin's home address on every birthday card entry, every anniversary entry and every gift record, then when she moves you must find and fix all of them — miss one and your book contradicts itself. Normalization says: write the address once on her contact page, and let everything else refer to the contact.</p>
<h4>The anomalies normalization prevents</h4>
<ul>
<li><strong>Update anomaly</strong> — a fact stored in many rows gets changed in some but not all (two different cities for one customer).</li>
<li><strong>Insert anomaly</strong> — you cannot record a fact without an unrelated one (cannot add a product until someone orders it).</li>
<li><strong>Delete anomaly</strong> — deleting one fact destroys another (deleting the last order erases the customer's address).</li>
</ul>
<h4>Functional dependencies</h4>
<p><code>A → B</code> ("A determines B") means: rows with the same A always have the same B. <code>sku → product_name</code>, <code>customer_email → customer_city</code>. Normal forms are rules about which dependencies are allowed.</p>
<table>
<tr><th>Normal form</th><th>Rule</th><th>Violation example</th><th>Fix</th></tr>
<tr><td><strong>1NF</strong></td><td>Every column holds one atomic value; no repeating groups; rows identifiable by a key</td><td><code>products = 'Laptop, Mouse, USB Hub'</code></td><td>One row per value (or a child table)</td></tr>
<tr><td><strong>2NF</strong></td><td>1NF + no non-key column depends on <em>part</em> of a composite key</td><td>Key (order_no, sku), but <code>product_name</code> depends on <code>sku</code> alone</td><td>Move <code>product_name</code> to a products table keyed by sku</td></tr>
<tr><td><strong>3NF</strong></td><td>2NF + no non-key column depends on another non-key column (no transitive dependency)</td><td><code>order_no → customer_email → customer_city</code></td><td>Move city into a customers table</td></tr>
<tr><td><strong>BCNF</strong></td><td>For every dependency X → Y, X is a superkey</td><td><code>tutor → subject</code> in (student, subject, tutor) where tutor is not a key</td><td>Split into (tutor, subject) and (student, tutor)</td></tr>
</table>
<p>A popular memory aid: every non-key attribute must depend on <em>the key</em> (1NF), <em>the whole key</em> (2NF), and <em>nothing but the key</em> (3NF). In practice, designing to <strong>3NF</strong> (usually BCNF comes for free) is the default for transactional (OLTP) systems. Higher forms (4NF, 5NF) deal with multi-valued and join dependencies and are rarely needed explicitly if your M:N relationships each have their own junction table.</p>
<h4>Denormalization</h4>
<p><strong>Denormalization</strong> deliberately re-introduces redundancy for read performance or simplicity — but as a <em>controlled</em>, derived copy whose source of truth stays normalized: materialized views, summary tables refreshed by jobs, columns maintained by triggers, or JSON snapshots of an order's address <em>as it was at purchase time</em> (which is actually a different fact, not redundancy).</p>`,
  why: `
<p>Redundant data is not just wasted space — it is a promise that every writer will keep every copy in sync forever, which no team can keep. Normalized schemas make writes simple and correct: one UPDATE changes one fact. They also make the schema flexible: new questions can be answered by new joins, without restructuring. Denormalization exists because some read paths (dashboards over billions of rows, hot API endpoints) cannot afford many joins on every request — the trick is to denormalize <em>from</em> a normalized core, never <em>instead of</em> one.</p>`,
  useCase: `
<p><strong>A B2B distributor</strong> imported 10 years of orders from Excel: one sheet per order line with customer name, address, salesperson and product description repeated on every line — 40 million rows. They found 312 spellings of their top 50 customers and products with three different prices on the same day. After normalizing into customers, addresses, products, price_lists, orders and order_items (3NF), storage fell by 70% and price errors disappeared because a price lived in one row. For the sales dashboard they then built a <em>denormalized</em> materialized view <code>daily_sales_by_customer</code> refreshed every 15 minutes — the dashboard went from 9&nbsp;s to 40&nbsp;ms without compromising the normalized core.</p>`,
  internals: `
<p>Normalization interacts with PostgreSQL's storage: every row carries a 23-byte tuple header plus alignment padding, so splitting a wide table into narrower ones costs some header overhead but usually saves far more by not repeating long strings. Joins on integer keys with indexes are cheap — a hash join of 10 million order items to 10 thousand products typically costs one pass over each table. Wide denormalized rows, conversely, mean fewer rows per 8&nbsp;kB page, more I/O per scan, larger WAL volume on every update (updating one copied field rewrites the whole row version under MVCC), and more vacuum work.</p>`,
  whenNot: `
<ul>
<li><strong>Analytics/warehouse schemas</strong> are intentionally denormalized (star schemas with wide dimension tables) because they are read-mostly and loaded in batches.</li>
<li><strong>Historical snapshots are not redundancy</strong>: the shipping address <em>at the time of the order</em> must be copied into the order — normalizing it to the customer's current address would rewrite history.</li>
<li><strong>Do not over-normalize</strong> trivial attributes into lookup tables (a separate table for <code>is_active</code>), or split 1:1 tables with no reason — every join has a cost in complexity.</li>
<li>Semi-structured, rarely queried attributes (product specs that differ per category) can live in a <code>jsonb</code> column rather than an entity-attribute-value maze.</li>
</ul>`,
  syntax: `-- Decompose a flat table into normalized tables
CREATE TABLE parent AS SELECT DISTINCT key_col, dependent_col FROM flat_table;
ALTER  TABLE parent ADD PRIMARY KEY (key_col);
ALTER  TABLE child  ADD FOREIGN KEY (key_col) REFERENCES parent;

-- Controlled denormalization
CREATE MATERIALIZED VIEW summary AS SELECT ... GROUP BY ...;
REFRESH MATERIALIZED VIEW [ CONCURRENTLY ] summary;`,
  examples: [
    { label: 'Basic', title: '1NF: split a multi-valued column into atomic rows',
      sql: `-- Not in 1NF: several products packed into one text value
CREATE TABLE order_sheet (order_no int, customer text, products text);
INSERT INTO order_sheet VALUES
  (1001, 'Customer 7', 'Laptop, Mouse, USB Hub'),
  (1002, 'Customer 8', 'Monitor');

-- 1NF view of the same data: one product per row
SELECT s.order_no,
       s.customer,
       trim(p) AS product
FROM   order_sheet s,
       unnest(string_to_array(s.products, ',')) AS p
ORDER  BY s.order_no, product;`,
      explain: `<p>"Which orders contain a Mouse?" against the original table needs <code>LIKE '%Mouse%'</code> (which also matches "Mousepad") and cannot be indexed or constrained. <code>string_to_array</code> + <code>unnest</code> turns the list into rows, and <code>trim</code> removes spaces. In a real migration you would <code>INSERT</code> this result into an <code>order_items</code> table with a foreign key to <code>products</code>.</p>`,
      output: ` order_no | customer   | product
----------+------------+---------
     1001 | Customer 7 | Laptop
     1001 | Customer 7 | Mouse
     1001 | Customer 7 | USB Hub
     1002 | Customer 8 | Monitor
(4 rows)`, run: true },
    { label: 'Intermediate', title: '2NF and 3NF: decompose a flat order-lines table',
      sql: `-- Key: (order_no, product_sku). Dependencies:
--   product_sku     -> product_name, unit_price         (partial: violates 2NF)
--   order_no        -> customer_email                    (partial: violates 2NF)
--   customer_email  -> customer_city, customer_country   (transitive: violates 3NF)
CREATE TABLE order_lines_flat (
  order_no int, product_sku text, product_name text, unit_price numeric(10,2), qty int,
  customer_email text, customer_city text, customer_country text,
  PRIMARY KEY (order_no, product_sku));
INSERT INTO order_lines_flat VALUES
 (5001,'SKU-0001','Monitor Air 1', 5004.84,1,'customer7@example.com','Dubai','UAE'),
 (5001,'SKU-0003','Mouse Lite 3', 27311.98,2,'customer7@example.com','Dubai','UAE'),
 (5002,'SKU-0001','Monitor Air 1', 5004.84,3,'customer8@example.com','Delhi','India'),
 (5003,'SKU-0003','Mouse Lite 3', 27311.98,1,'customer7@example.com','Dubai','UAE');

-- Each determinant becomes the key of its own table
CREATE TABLE n_customers   AS SELECT DISTINCT customer_email AS email, customer_city AS city, customer_country AS country FROM order_lines_flat;
CREATE TABLE n_products    AS SELECT DISTINCT product_sku AS sku, product_name AS name, unit_price AS price FROM order_lines_flat;
CREATE TABLE n_orders      AS SELECT DISTINCT order_no, customer_email FROM order_lines_flat;
CREATE TABLE n_order_items AS SELECT order_no, product_sku, qty FROM order_lines_flat;

ALTER TABLE n_customers   ADD PRIMARY KEY (email);
ALTER TABLE n_products    ADD PRIMARY KEY (sku);
ALTER TABLE n_orders      ADD PRIMARY KEY (order_no),
                          ADD FOREIGN KEY (customer_email) REFERENCES n_customers;
ALTER TABLE n_order_items ADD PRIMARY KEY (order_no, product_sku),
                          ADD FOREIGN KEY (order_no)    REFERENCES n_orders,
                          ADD FOREIGN KEY (product_sku) REFERENCES n_products;

SELECT 'order_lines_flat' AS table_name, count(*) AS rows FROM order_lines_flat
UNION ALL SELECT 'n_customers',   count(*) FROM n_customers
UNION ALL SELECT 'n_products',    count(*) FROM n_products
UNION ALL SELECT 'n_orders',      count(*) FROM n_orders
UNION ALL SELECT 'n_order_items', count(*) FROM n_order_items;`,
      explain: `<p>The rule of thumb: <em>every determinant becomes a key</em>. Customer facts now exist once per customer (2 rows instead of 4 copies), product facts once per product. If customer 7 moves to Abu Dhabi, a single-row UPDATE on <code>n_customers</code> is enough, and you can add a new product before anyone orders it (no insert anomaly). A join reconstructs the original view whenever you need it — the decomposition is <em>lossless</em> because every split shares a key.</p>
<p>Notice that company_db itself is designed this way: <code>customers</code>, <code>products</code>, <code>orders</code>, <code>order_items</code>.</p>`,
      output: ` table_name       | rows
------------------+------
 order_lines_flat |    4
 n_customers      |    2
 n_products       |    2
 n_orders         |    3
 n_order_items    |    4
(5 rows)`, run: true },
    { label: 'Advanced', title: 'BCNF, then controlled denormalization with a materialized view',
      sql: `-- Rules: a tutor teaches exactly one subject; a student has one tutor per subject.
-- Candidate keys: (student, subject) and (student, tutor). Dependency tutor -> subject
-- has a determinant (tutor) that is not a superkey  =>  3NF but NOT BCNF.
CREATE TABLE tutoring (student text, subject text, tutor text, PRIMARY KEY (student, subject));
INSERT INTO tutoring VALUES ('Aarav','SQL','Meera'), ('Diya','SQL','Meera'),
                            ('Aarav','Python','Rohan'), ('Kabir','SQL','Vikram');

-- BCNF decomposition
CREATE TABLE tutor_subjects (tutor text PRIMARY KEY, subject text NOT NULL);
CREATE TABLE student_tutors (student text, tutor text REFERENCES tutor_subjects,
                             PRIMARY KEY (student, tutor));
INSERT INTO tutor_subjects SELECT DISTINCT tutor, subject FROM tutoring;
INSERT INTO student_tutors SELECT student, tutor FROM tutoring;

SELECT st.student, ts.subject, st.tutor
FROM   student_tutors st JOIN tutor_subjects ts USING (tutor)
ORDER  BY st.student, ts.subject;

-- Denormalized, derived read model on top of the normalized company_db core
CREATE MATERIALIZED VIEW customer_order_summary AS
SELECT c.id AS customer_id, c.name, c.country,
       count(o.id)                       AS orders,
       coalesce(sum(o.total_amount), 0)  AS lifetime_value,
       max(o.order_date)                 AS last_order_at
FROM   customers c
LEFT   JOIN orders o ON o.customer_id = c.id AND o.status <> 'cancelled'
GROUP  BY c.id;
CREATE UNIQUE INDEX ON customer_order_summary (customer_id);  -- enables REFRESH ... CONCURRENTLY

SELECT customer_id, name, country, orders, lifetime_value
FROM   customer_order_summary
ORDER  BY lifetime_value DESC
LIMIT  5;`,
      explain: `<p><strong>BCNF:</strong> in the original table, Meera's subject is stored once per student she tutors — change her subject and you must update several rows. After decomposition, <code>tutor → subject</code> is stored once. The trade-off: the rule "one tutor per student <em>per subject</em>" now spans two tables and can no longer be enforced by a simple key — BCNF decompositions are not always dependency-preserving, which is why many designers stop at 3NF in such cases.</p>
<p><strong>Denormalization:</strong> the materialized view stores pre-aggregated per-customer totals. It is <em>derived</em>: it can always be rebuilt from orders with <code>REFRESH MATERIALIZED VIEW CONCURRENTLY customer_order_summary</code>, so it never becomes the source of truth.</p>`,
      output: ` student | subject | tutor
---------+---------+--------
 Aarav   | Python  | Rohan
 Aarav   | SQL     | Meera
 Diya    | SQL     | Meera
 Kabir   | SQL     | Vikram
(4 rows)

 customer_id | name         | country | orders | lifetime_value
-------------+--------------+---------+--------+----------------
         220 | Customer 220 | UK      |     17 |     5940193.48
          27 | Customer 27  | USA     |     13 |     5416424.79
         469 | Customer 469 | Germany |     16 |     5071543.17
         140 | Customer 140 | UK      |     15 |     5042144.69
         235 | Customer 235 | USA     |     17 |     4874310.00
(5 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Uncontrolled denormalization: copy the customer's city into every order
CREATE TABLE orders_denorm AS
SELECT o.id, o.customer_id, c.city AS customer_city
FROM   orders o JOIN customers c ON c.id = o.customer_id;

-- The customer moves...
UPDATE customers SET city = 'Abu Dhabi' WHERE id = 7;

-- ...and the 11 copies are now wrong (update anomaly)
SELECT DISTINCT d.customer_city AS copied_city, c.city AS real_city
FROM   orders_denorm d JOIN customers c ON c.id = d.customer_id
WHERE  d.customer_id = 7;`,
      why: 'The copy silently diverges from the source. Every writer would need to remember to update all copies, forever.', run: true },
    good: { sql: `-- Normalized: city lives once in customers; orders reference the customer
UPDATE customers SET city = 'Abu Dhabi' WHERE id = 7;

SELECT DISTINCT c.city
FROM   orders o JOIN customers c ON c.id = o.customer_id
WHERE  o.customer_id = 7;`,
      why: 'One UPDATE, one fact, always consistent. (If you need the address as it was at order time, store it as a deliberate snapshot column on the order, not as a copy of the current one.)', run: true }
  },
  mistakes: [
    'Storing comma-separated lists or numbered columns (<code>phone1</code>, <code>phone2</code>, <code>phone3</code>) — a 1NF violation that makes queries and constraints painful.',
    'Copying parent attributes (customer name, product price) into child rows "for convenience" without a mechanism to keep them in sync.',
    'Confusing a historical snapshot (price paid, shipping address at order time) with redundancy — those <em>should</em> be stored on the order.',
    'Denormalizing before measuring: most join-heavy queries are fast with proper indexes.',
    'Using the entity-attribute-value pattern (<code>attribute_name</code>, <code>attribute_value</code> text columns) to avoid design work — it loses types, constraints and performance; consider <code>jsonb</code> instead.'
  ],
  best: [
    'Design OLTP schemas to 3NF/BCNF by default; document every intentional exception.',
    'For each table, write down its key and ask "does every column depend on the key, the whole key, and nothing but the key?"',
    'Denormalize only into <em>derived</em> structures (materialized views, summary tables, cached columns maintained by triggers) with a clear refresh strategy.',
    'Snapshot values that must not change retroactively (unit_price in order_items, address on invoices).',
    'Use foreign keys between the decomposed tables so the normalized design is also enforced.'
  ],
  performance: `
<p>Normalized schemas favour writes: smaller rows, fewer index updates per change, less WAL, less lock contention. They cost joins on reads — usually cheap with indexed integer keys, but expensive for wide analytical aggregations over many tables. That is where read-optimised denormalized structures shine: a materialized view of daily totals turns a 50-million-row aggregation into a 1,000-row lookup. Measure with <code>EXPLAIN ANALYZE</code> before and after, and account for refresh cost and staleness.</p>`,
  security: `
<p>Normalization helps access control: sensitive attributes (salary, national ID, health data) can live in their own table with tighter <code>GRANT</code>s or row-level security, instead of being repeated across many tables. Denormalized copies, on the other hand, multiply the places sensitive data lives — every copy must be protected, masked and erased (e.g. for GDPR "right to be forgotten").</p>`,
  scenario: { title: 'Normalizing a 40-million-row spreadsheet import', steps: [
    '1. Profile the flat table: SELECT customer_name, count(DISTINCT customer_address) ... GROUP BY 1 HAVING count(DISTINCT ...) > 1 to find conflicting copies.',
    '2. Write down functional dependencies with the business (sku → description, customer_code → address).',
    '3. Create target tables with PKs, FKs and constraints first (customers, products, orders, order_items).',
    '4. Load dimensions with INSERT ... SELECT DISTINCT ON (key) ... ORDER BY key, last_updated DESC to pick the latest version of conflicting facts.',
    '5. Load facts by joining the flat table to the new dimension tables to resolve surrogate keys.',
    '6. Verify row counts and totals match the source, then build materialized views for reporting.'
  ] },
  widgets: ['diagram:normalization'],
  interview: [
    { q: 'Explain 1NF, 2NF and 3NF in one sentence each.', a: '1NF: every column holds a single atomic value and there are no repeating groups. 2NF: in addition, no non-key column depends on only part of a composite key. 3NF: in addition, no non-key column depends on another non-key column — every non-key attribute depends on the key, the whole key and nothing but the key.' },
    { q: 'What is the difference between 3NF and BCNF?', a: '3NF allows a dependency X → Y where X is not a superkey if Y is part of a candidate key (a prime attribute). BCNF forbids it: every determinant must be a superkey. Tables with overlapping composite candidate keys can be in 3NF but not BCNF, and BCNF decomposition may lose the ability to enforce some dependencies with simple keys.' },
    { q: 'When would you denormalize?', a: 'When measured read performance requirements cannot be met with indexes and good queries — typically aggregations for dashboards or hot read paths. I would denormalize into derived structures (materialized views, summary tables, trigger-maintained columns) with a defined refresh strategy, keeping the normalized tables as the source of truth.' },
    { q: 'Is storing unit_price in order_items a normalization violation?', a: 'No, it is a different fact: the price agreed at the time of sale, which must not change when the catalogue price changes later. It depends on the order line, not on the product.' }
  ],
  exercises: [
    { task: 'The products table stores tags as a text[] array. Produce a 1NF view: one row per (sku, tag) for products with id <= 3.', solution: `SELECT p.sku, t.tag
FROM   products p,
       unnest(p.tags) AS t(tag)
WHERE  p.id <= 3
ORDER  BY p.sku, t.tag;`, run: true },
    { task: 'Check whether customers.email → customers.city holds in company_db: find any email appearing with more than one city (should return no rows).', solution: `SELECT email, count(DISTINCT city) AS cities
FROM   customers
GROUP  BY email
HAVING count(DISTINCT city) > 1;`, run: true },
    { task: 'Verify that order_items.unit_price is a snapshot, not a copy: count order items whose unit_price differs from the product\'s current price.', solution: `SELECT count(*) AS differing_prices
FROM   order_items oi
JOIN   products p ON p.id = oi.product_id
WHERE  oi.unit_price <> p.price;`, run: true }
  ],
  challenge: { task: 'A table project_assignments(employee_email, employee_name, project_name, project_department, role) has key (employee_email, project_name). Identify the 2NF/3NF violations, then create normalized tables pa_employees, pa_projects and pa_assignments from sample data and reconstruct the original rows with a join.', hint: 'employee_email → employee_name and project_name → project_department are partial dependencies.', solution: `CREATE TABLE project_assignments (
  employee_email text, employee_name text, project_name text, project_department text, role text,
  PRIMARY KEY (employee_email, project_name));
INSERT INTO project_assignments VALUES
  ('asha@co.com',  'Asha Rao',   'Atlas', 'Sales',     'lead'),
  ('asha@co.com',  'Asha Rao',   'Comet', 'Finance',   'reviewer'),
  ('rohan@co.com', 'Rohan Mehta','Atlas', 'Sales',     'contributor');

CREATE TABLE pa_employees (email text PRIMARY KEY, name text NOT NULL);
CREATE TABLE pa_projects  (name  text PRIMARY KEY, department text NOT NULL);
CREATE TABLE pa_assignments (
  employee_email text REFERENCES pa_employees,
  project_name   text REFERENCES pa_projects,
  role           text NOT NULL,
  PRIMARY KEY (employee_email, project_name));

INSERT INTO pa_employees   SELECT DISTINCT employee_email, employee_name FROM project_assignments;
INSERT INTO pa_projects    SELECT DISTINCT project_name, project_department FROM project_assignments;
INSERT INTO pa_assignments SELECT employee_email, project_name, role FROM project_assignments;

SELECT e.email, e.name, p.name AS project, p.department, a.role
FROM   pa_assignments a
JOIN   pa_employees e ON e.email = a.employee_email
JOIN   pa_projects  p ON p.name  = a.project_name
ORDER  BY e.email, p.name;`, run: true },
  related: ['database-design-keys-relationships', 'database-design-table-ddl', 'materialized-views', 'jsonb'],
  quiz: [
    { type: 'mcq', q: 'A table with key (order_id, product_id) also stores product_name. Which normal form is violated?', options: ['1NF', '2NF', '3NF only', 'None'], answer: 1, explain: 'product_name depends on product_id alone — part of the composite key — a partial dependency (2NF).' },
    { type: 'mcq', q: 'employees(id, department_id, department_location). Which normal form is violated?', options: ['1NF', '2NF', '3NF', 'BCNF only'], answer: 2, explain: 'id → department_id → department_location is a transitive dependency.' },
    { type: 'tf', q: 'Storing the unit price paid in order_items violates normalization.', answer: false, explain: 'It is a historical fact about the sale, different from the product\'s current price.' },
    { type: 'design', q: 'A dashboard aggregates 200M order rows on every page load (8 s). Best first step after checking indexes?', options: ['Copy customer and product columns into orders', 'A materialized view or summary table refreshed on a schedule', 'Drop foreign keys', 'Switch to a single wide table'], answer: 1, explain: 'Precompute the aggregate in a derived structure; keep the normalized source intact.' },
    { type: 'bug', q: 'What problem does this design have?', code: `CREATE TABLE customers (
  id int PRIMARY KEY,
  name text,
  phone1 text, phone2 text, phone3 text
);`, options: ['No problem', 'Repeating group: violates 1NF; use a customer_phones table', 'Violates BCNF only', 'Too many indexes'], answer: 1, explain: 'Numbered columns are a repeating group; a 4th phone needs a schema change and searching requires checking 3 columns.' }
  ]
},
{
  id: 'database-design-surrogate-natural-keys',
  module: 'database-design',
  title: 'Surrogate vs Natural Keys, UUID vs BIGINT, and Identity Columns vs serial',
  level: 2,
  minutes: 22,
  summary: 'Choose primary keys that never need to change: surrogate vs natural keys, bigint vs UUID (v4 and the new v7), and why GENERATED ALWAYS AS IDENTITY replaces serial.',
  objectives: [
    'Compare natural and surrogate keys and decide which to use',
    'Choose between int, bigint and uuid keys based on size, ordering and distribution',
    'Explain UUIDv4 vs UUIDv7 (uuidv7() is core in PostgreSQL 18) and their index behaviour',
    'Create identity columns with GENERATED ALWAYS / BY DEFAULT AS IDENTITY and manage their sequences',
    'Explain the pitfalls of serial and why gaps in sequences are normal',
    'Keep natural keys enforced with UNIQUE constraints alongside surrogate PKs'
  ],
  concept: `
<p>A primary key's job is to <em>identify a row forever</em>. Other tables, URLs, caches, logs and external systems will copy it. So the most important property of a key is that it <strong>never changes</strong>.</p>
<p><strong>Analogy: people and passports.</strong> A person's name (natural key) can change with marriage and is not unique. A passport number is unique but changes when the passport is renewed. A national registry instead gives each person an internal, meaningless serial number that never changes — a <em>surrogate key</em> — while still recording the name and passport number as attributes that must be unique where appropriate.</p>
<h4>Natural vs surrogate</h4>
<table>
<tr><th></th><th>Natural key</th><th>Surrogate key</th></tr>
<tr><td>Definition</td><td>A real-world attribute: email, SKU, ISO country code, PAN/GSTIN</td><td>A generated, meaningless value: 42, a UUID</td></tr>
<tr><td>Pros</td><td>Meaningful; no extra column; readable FKs (<code>country_code = 'IN'</code>)</td><td>Never changes; compact; uniform across tables; no business-rule coupling</td></tr>
<tr><td>Cons</td><td>Can change (emails!), can be reused, may be long or composite, may be sensitive (national IDs)</td><td>Needs an extra UNIQUE constraint on the natural key, otherwise duplicates slip in</td></tr>
<tr><td>Good fits</td><td>Stable, standardised codes: ISO 3166 country, ISO 4217 currency, small lookup tables</td><td>Almost every business entity: customers, orders, products, employees</td></tr>
</table>
<p>The common professional choice: <strong>surrogate primary key + UNIQUE constraint on the natural key</strong> (company_db does exactly this: <code>products.id</code> + <code>UNIQUE (sku)</code>, <code>customers.id</code> + <code>UNIQUE (email)</code>).</p>
<h4>bigint vs uuid</h4>
<table>
<tr><th></th><th><code>int</code> / <code>bigint</code> identity</th><th><code>uuid</code> v4 (random)</th><th><code>uuid</code> v7 (time-ordered)</th></tr>
<tr><td>Size</td><td>4 / 8 bytes</td><td>16 bytes</td><td>16 bytes</td></tr>
<tr><td>Generated</td><td>By the database sequence</td><td>Anywhere (<code>gen_random_uuid()</code>, app, mobile offline)</td><td>Anywhere (<code>uuidv7()</code>, core since PostgreSQL 18)</td></tr>
<tr><td>Index locality</td><td>Excellent — always appends to the right edge of the B-tree</td><td>Poor — inserts land on random pages, more page splits, WAL and cache misses</td><td>Good — roughly time-ordered like bigint</td></tr>
<tr><td>Guessable / leaks volume?</td><td>Yes (id 1,000,001 says "1M customers")</td><td>No</td><td>Leaks creation time (millisecond precision)</td></tr>
<tr><td>Merging data from several databases/shards</td><td>Collisions unless you use ranges</td><td>No collisions</td><td>No collisions</td></tr>
</table>
<p>Use <code>bigint</code> (not <code>int</code>) for anything that may exceed 2.1 billion rows over its lifetime — orders, events, logs. <code>int</code> is fine for small, bounded tables (departments, countries). Use UUIDs when IDs must be generated outside the database, must not be enumerable in public URLs, or must be globally unique across systems — and prefer <strong>UUIDv7</strong> for new designs on PostgreSQL 18.</p>
<h4>Identity columns vs serial</h4>
<p><code>serial</code>/<code>bigserial</code> is an old PostgreSQL shorthand: it creates an <code>int</code> column with <code>DEFAULT nextval('t_id_seq')</code> and a separately-owned sequence. <strong>Identity columns</strong> (<code>GENERATED ... AS IDENTITY</code>, PostgreSQL 10+) are the SQL-standard replacement:</p>
<ul>
<li><code>GENERATED ALWAYS AS IDENTITY</code> — the database always assigns the value; a manual value is rejected unless you write <code>OVERRIDING SYSTEM VALUE</code>. Prevents the classic "someone inserted id 2 by hand and now the sequence collides" bug.</li>
<li><code>GENERATED BY DEFAULT AS IDENTITY</code> — assigns a value only when none is given; useful for migrations/imports that must keep existing IDs.</li>
<li>The sequence is tied to the column: permissions, <code>CREATE TABLE ... LIKE</code>, and <code>ALTER TABLE ... ALTER COLUMN id RESTART</code> just work.</li>
</ul>`,
  why: `
<p>Changing a primary key is one of the most painful migrations there is: every foreign key, cache, URL, search index and external integration has copies of it. Choosing a stable, compact, well-generated key on day one avoids that pain. The key type also determines index size and insert performance for the lifetime of the table — on a 2-billion-row table, choosing <code>uuid</code> v4 over <code>bigint</code> costs tens of GB of extra index space across the PK and every FK index, and noticeably slower inserts.</p>`,
  useCase: `
<p><strong>A ride-hailing app</strong> creates trips on phones that may be offline. The app generates a <strong>UUIDv7</strong> for each trip so it can be referenced before sync, and the server accepts it as the primary key — no collisions, and because v7 is time-ordered the B-tree index on 3 billion trips stays append-mostly. Internally, high-volume tables that are only created server-side (GPS pings, payments) use <code>bigint GENERATED ALWAYS AS IDENTITY</code>. Public URLs use the UUID, so competitors cannot estimate daily trip volume by watching IDs increase. Natural identifiers like a driver's licence number are stored in a separate, access-restricted table with a UNIQUE constraint — never as a key.</p>`,
  internals: `
<p>An identity column is backed by a <strong>sequence</strong> — a special one-row relation. <code>nextval()</code> is non-transactional: once a value is handed out it is never given back, even if the transaction rolls back. That is why <strong>gaps are normal</strong> (rolled-back inserts, failed constraint checks, crashes, and the sequence cache of 32 values pre-logged to WAL). Never rely on IDs being consecutive — if you need gap-free invoice numbers, generate them in a separate, locked counter table at commit time.</p>
<p>B-tree inserts of increasing values go to the rightmost leaf page, which stays hot in cache, and PostgreSQL has a "fastpath" for this pattern. Random UUIDv4 values hit random leaf pages: each insert may read a cold page, split it (leaving pages ~50–70% full), and with <code>full_page_writes</code> generate a full 8&nbsp;kB page image in WAL after each checkpoint. UUIDv7 puts a 48-bit Unix millisecond timestamp in the leading bits, restoring locality. Storage: a <code>uuid</code> column is 16 bytes binary — never store UUIDs as <code>text</code> (36+ bytes, slower comparisons).</p>`,
  whenNot: `
<ul>
<li>Don't use natural keys that can change or be corrected (email, phone, names, vehicle registration) as primary keys.</li>
<li>Don't use sensitive identifiers (Aadhaar, PAN, SSN, passport) as keys — they spread to every referencing table and log.</li>
<li>Don't use <code>int</code> for high-volume tables; migrating <code>int</code> → <code>bigint</code> on a big, busy table requires a full rewrite.</li>
<li>Don't use random UUIDv4 as the clustered-style PK of huge, insert-heavy tables if you can avoid it — use bigint or UUIDv7.</li>
<li>Don't use <code>serial</code> in new code — use identity columns.</li>
<li>Small reference tables with stable international codes (currency <code>'INR'</code>, country <code>'IN'</code>) can perfectly use the natural code as PK.</li>
</ul>`,
  syntax: `-- Identity (SQL standard, preferred)
id bigint GENERATED ALWAYS     AS IDENTITY PRIMARY KEY
id bigint GENERATED BY DEFAULT AS IDENTITY [ ( START WITH 1000 INCREMENT BY 1 ) ] PRIMARY KEY

INSERT INTO t (id, ...) OVERRIDING SYSTEM VALUE VALUES (...);   -- force a value into ALWAYS
ALTER TABLE t ALTER COLUMN id RESTART WITH 5000;
SELECT setval(pg_get_serial_sequence('t', 'id'), (SELECT max(id) FROM t));

-- UUID keys
id uuid PRIMARY KEY DEFAULT gen_random_uuid()   -- v4, random (core since PG 13)
id uuid PRIMARY KEY DEFAULT uuidv7()            -- v7, time-ordered (core since PG 18)

-- Surrogate PK + natural key enforced
sku text NOT NULL UNIQUE`,
  examples: [
    { label: 'Basic', title: 'An identity primary key and its backing sequence',
      sql: `CREATE TABLE tickets (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text   NOT NULL
);

INSERT INTO tickets (title)
VALUES ('Printer jam'), ('VPN down')
RETURNING id, title;

SELECT pg_get_serial_sequence('tickets', 'id') AS backing_sequence;`,
      explain: `<p>You never mention <code>id</code> in the INSERT — PostgreSQL calls <code>nextval</code> on the hidden sequence <code>tickets_id_seq</code>. <code>RETURNING</code> hands the generated IDs back in the same round trip (no need for a follow-up SELECT, and no race conditions). <code>pg_get_serial_sequence</code> works for both identity and serial columns and is what you use with <code>setval</code> after bulk loads.</p>`,
      output: ` id | title
----+-------------
  1 | Printer jam
  2 | VPN down
(2 rows)

 backing_sequence
-----------------------
 public.tickets_id_seq
(1 row)`, run: true },
    { label: 'Intermediate', title: 'UUIDv4 vs UUIDv7 keys and their storage size',
      sql: `CREATE TABLE api_keys  (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text);
CREATE TABLE events_v7 (id uuid PRIMARY KEY DEFAULT uuidv7(),          label text);

INSERT INTO api_keys  (label) VALUES ('mobile'), ('partner');
INSERT INTO events_v7 (label) VALUES ('signup'), ('login');

SELECT 'v4 random'      AS kind, uuid_extract_version(id) AS version,
       pg_column_size(id) AS bytes, uuid_extract_timestamp(id) IS NOT NULL AS has_timestamp
FROM   api_keys  LIMIT 1;

SELECT 'v7 time-ordered' AS kind, uuid_extract_version(id) AS version,
       pg_column_size(id) AS bytes, uuid_extract_timestamp(id) IS NOT NULL AS has_timestamp
FROM   events_v7 LIMIT 1;

-- Key sizes compared
SELECT pg_column_size(42::int)                         AS int_bytes,
       pg_column_size(42::bigint)                      AS bigint_bytes,
       pg_column_size(gen_random_uuid())               AS uuid_bytes,
       pg_column_size('customer7@example.com'::text)   AS email_text_bytes;`,
      explain: `<p><code>gen_random_uuid()</code> produces version 4 (122 random bits). <code>uuidv7()</code> — new in PostgreSQL 18 — embeds a millisecond Unix timestamp in the leading 48 bits, so values generated later sort later; <code>uuid_extract_timestamp()</code> reads it back. Both are 16 bytes. An email natural key would be 25 bytes here and grows with the address — and appears in every FK column and index that references it.</p>`,
      output: ` kind      | version | bytes | has_timestamp
-----------+---------+-------+---------------
 v4 random |       4 |    16 | f
(1 row)

 kind            | version | bytes | has_timestamp
-----------------+---------+-------+---------------
 v7 time-ordered |       7 |    16 | t
(1 row)

 int_bytes | bigint_bytes | uuid_bytes | email_text_bytes
-----------+--------------+------------+------------------
         4 |            8 |         16 |               25
(1 row)`, run: true },
    { label: 'Advanced', title: 'Managing identity sequences: imports, restarts and gaps',
      sql: `BEGIN;

-- Import with existing IDs: BY DEFAULT accepts explicit values
CREATE TABLE seq_demo (id int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, v text);
INSERT INTO seq_demo (id, v) VALUES (1, 'imported'), (2, 'imported');

-- The sequence doesn't know about them: move it past max(id) before normal inserts
SELECT setval(pg_get_serial_sequence('seq_demo', 'id'), (SELECT max(id) FROM seq_demo));
INSERT INTO seq_demo (v) VALUES ('new row') RETURNING id;

-- Gaps are normal: a rolled-back insert still consumed a value
SAVEPOINT s1;
INSERT INTO seq_demo (v) VALUES ('will be rolled back') RETURNING id;
ROLLBACK TO SAVEPOINT s1;
INSERT INTO seq_demo (v) VALUES ('after rollback') RETURNING id;

SELECT id, v FROM seq_demo ORDER BY id;

-- Custom start values and restarts
CREATE TABLE invoices_demo (
  id int GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY, v text);
INSERT INTO invoices_demo (v) VALUES ('first') RETURNING id;
ALTER TABLE invoices_demo ALTER COLUMN id RESTART WITH 5000;
INSERT INTO invoices_demo (v) VALUES ('after restart') RETURNING id;

ROLLBACK;`,
      explain: `<ul><li>After importing IDs 1–2 by hand, <code>setval</code> moves the sequence so the next generated value is 3 — forget this and the next insert fails with <em>duplicate key value violates unique constraint</em>.</li>
<li>The rolled-back insert consumed id 4; the next row gets 5. Sequences are deliberately non-transactional so concurrent inserters never wait for each other.</li>
<li><code>START WITH</code> and <code>RESTART WITH</code> control numbering without touching the sequence object by name.</li></ul>`,
      output: ` setval
--------
      2

 id
----
  3

 id
----
  4        -- then rolled back

 id
----
  5

 id | v
----+----------------
  1 | imported
  2 | imported
  3 | new row
  5 | after rollback
(4 rows)

 id
------
 1000

 id
------
 5000`, run: true }
  ],
  compare: {
    bad: { sql: `-- serial + a manual insert = a time bomb
CREATE TABLE legacy_serial (id serial PRIMARY KEY, note text);
INSERT INTO legacy_serial (note)     VALUES ('auto');        -- id 1
INSERT INTO legacy_serial (id, note) VALUES (2, 'manual');   -- allowed silently
INSERT INTO legacy_serial (note)     VALUES ('auto again');  -- sequence returns 2
-- ERROR:  duplicate key value violates unique constraint "legacy_serial_pkey"
-- DETAIL: Key (id)=(2) already exists.`,
      why: 'serial is just a DEFAULT; anyone can bypass it, and the sequence will later collide. It is also int (2.1 billion limit) and its sequence ownership/permissions are managed separately.', run: false },
    good: { sql: `CREATE TABLE modern_identity (
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note text
);
INSERT INTO modern_identity (note) VALUES ('auto'), ('auto again') RETURNING id;
-- INSERT INTO modern_identity (id, note) VALUES (2, 'manual');
--   ERROR: cannot insert a non-DEFAULT value into column "id"
--   HINT:  Use OVERRIDING SYSTEM VALUE to override.`,
      why: 'GENERATED ALWAYS refuses accidental manual IDs, bigint gives 9.2 quintillion values, and the sequence is owned by and managed through the column.', run: true }
  },
  mistakes: [
    'Using <code>email</code> or <code>username</code> as the primary key — then a user changes their email and dozens of FK rows must cascade-update.',
    'Choosing <code>int</code> for an events or orders table and hitting <em>integer out of range</em> at 2,147,483,647 rows years later.',
    'Expecting gap-free IDs and building business logic ("invoice numbers must be consecutive") on a sequence.',
    'Bulk-loading explicit IDs and forgetting <code>setval</code>, so the next application insert fails with a duplicate key error.',
    'Storing UUIDs in a <code>text</code>/<code>varchar(36)</code> column — more than twice the size and slower comparisons than the native <code>uuid</code> type.',
    'Surrogate PK without a UNIQUE constraint on the natural key — the same product SKU ends up in the table three times.'
  ],
  best: [
    'Default to <code>bigint GENERATED ALWAYS AS IDENTITY</code> for server-generated keys.',
    'Use <code>uuid</code> (prefer <code>uuidv7()</code> on PostgreSQL 18) when IDs are created client-side, exposed publicly, or must be unique across systems.',
    'Always back natural identifiers with <code>UNIQUE</code> constraints, even when they are not the PK.',
    'Use natural keys as PK only for small, stable, standardised code tables (countries, currencies).',
    'After imports with explicit IDs, run <code>setval(pg_get_serial_sequence(...), max(id))</code>.',
    'If you must expose sequential IDs, don\'t rely on them for security — authorise every access.'
  ],
  performance: `
<p>Key width multiplies: the PK index, every FK column, every FK index and every join hash table carry it. Moving from <code>bigint</code> (8 bytes) to <code>uuid</code> (16 bytes) on a 1-billion-row table adds roughly 8&nbsp;GB per index containing the key (plus per-row alignment effects). Random UUIDv4 inserts also cause B-tree page splits, lower page fill and more WAL (full-page images); benchmarks commonly show 2–5× more WAL and noticeably lower insert throughput than sequential keys once the index exceeds RAM. UUIDv7 recovers most of that locality. Sequence <code>nextval</code> is extremely cheap and highly concurrent; <code>CACHE</code> can be raised for extreme insert rates at the cost of bigger gaps.</p>`,
  security: `
<p>Sequential IDs are enumerable: if <code>/invoices/1043</code> exists, an attacker will try <code>/invoices/1044</code>. That is an authorisation bug (IDOR), not a key-design bug — always check ownership on access — but non-guessable UUIDs add defence in depth for public URLs. UUIDv7 reveals creation time; if that is sensitive, use v4 for public identifiers. Never use personal identifiers (national ID, phone, email) as keys: they propagate into logs, URLs and every referencing table, multiplying the cost of a breach and of erasure requests.</p>`,
  scenario: { title: 'An int primary key is about to overflow', steps: [
    '1. Monitor: SELECT last_value FROM orders_id_seq; alert at 70% of 2,147,483,647.',
    '2. Plan the migration: add a new bigint column (ALTER TABLE ... ADD COLUMN id_new bigint) — instant, no rewrite.',
    '3. Keep it in sync for new rows with a trigger and backfill old rows in batches of 50k with short transactions.',
    '4. Build a unique index CONCURRENTLY on id_new; migrate FK columns in referencing tables the same way.',
    '5. In a short maintenance window, swap: drop old PK, promote the new unique index with ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY USING INDEX, rename columns, re-point the identity/sequence.',
    '6. Lesson learned: start with bigint.'
  ] },
  widgets: ['lab:btree'],
  interview: [
    { q: 'Surrogate or natural key — which do you choose and why?', a: 'Usually a surrogate key (bigint identity or UUID) as the primary key because it is stable, compact and free of business meaning, combined with UNIQUE constraints on natural keys such as email or SKU to prevent duplicates. Natural keys work as PKs for small, standardised, immutable code tables such as ISO country or currency codes.' },
    { q: 'What is the difference between serial and an identity column?', a: 'serial is a PostgreSQL shorthand that creates an int column with a nextval default and a separately-owned sequence; anyone can insert explicit values, which can later collide. Identity columns are SQL standard, attach the sequence to the column, and with GENERATED ALWAYS reject manual values unless OVERRIDING SYSTEM VALUE is used. They also behave better with CREATE TABLE LIKE, permissions and ALTER ... RESTART.' },
    { q: 'Why can random UUID primary keys hurt insert performance?', a: 'Random values insert into random B-tree leaf pages, causing cache misses, page splits, low fill factor and extra WAL from full-page images, while sequential keys append to the hot right-most page. UUIDv7 (uuidv7() in PostgreSQL 18) is time-ordered and largely avoids this.' },
    { q: 'Why do sequences have gaps?', a: 'nextval is non-transactional so concurrent sessions never block each other: values consumed by rolled-back transactions, failed inserts, or cached-but-unused after a crash are never reused. Gap-free numbering requires a separate, serialized counter.' }
  ],
  exercises: [
    { task: 'Create a table support_cases with a bigint identity PK that starts at 100000, a case_code text that must be unique, and a subject. Insert two rows and return their generated ids.', solution: `CREATE TABLE support_cases (
  id        bigint GENERATED ALWAYS AS IDENTITY (START WITH 100000) PRIMARY KEY,
  case_code text NOT NULL UNIQUE,
  subject   text NOT NULL
);
INSERT INTO support_cases (case_code, subject)
VALUES ('CS-A1', 'Login issue'), ('CS-A2', 'Refund request')
RETURNING id, case_code;`, run: true },
    { task: 'Find which identity columns exist in the public schema of company_db and whether each is ALWAYS (a) or BY DEFAULT (d).', solution: `SELECT c.relname AS table_name, a.attname AS column_name, a.attidentity
FROM   pg_attribute a
JOIN   pg_class c     ON c.oid = a.attrelid
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND a.attidentity <> '' AND c.relkind = 'r'
ORDER  BY 1;`, run: true },
    { task: 'Create a currencies lookup table that uses the natural ISO 4217 code as its primary key and insert INR, USD and EUR.', solution: `CREATE TABLE currencies (
  code      char(3) PRIMARY KEY CHECK (code = upper(code)),
  name      text    NOT NULL,
  minor_units smallint NOT NULL DEFAULT 2
);
INSERT INTO currencies VALUES ('INR', 'Indian Rupee', 2), ('USD', 'US Dollar', 2), ('EUR', 'Euro', 2);
SELECT * FROM currencies ORDER BY code;`, run: true }
  ],
  challenge: { task: 'You are given a legacy table with serial ids and an imported row. Convert it to a GENERATED BY DEFAULT identity column without losing data, then make sure the next generated id does not collide.', hint: 'ALTER COLUMN id DROP DEFAULT; drop the old sequence; ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY; then setval on the new sequence.', solution: `CREATE TABLE legacy_items (id serial PRIMARY KEY, name text);
INSERT INTO legacy_items (name) VALUES ('a'), ('b');
INSERT INTO legacy_items (id, name) VALUES (10, 'imported');

ALTER TABLE legacy_items ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE legacy_items_id_seq;
ALTER TABLE legacy_items ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;
SELECT setval(pg_get_serial_sequence('legacy_items', 'id'), (SELECT max(id) FROM legacy_items));

INSERT INTO legacy_items (name) VALUES ('new') RETURNING id;`, run: true },
  related: ['database-design-keys-relationships', 'database-design-table-ddl', 'data-types-special', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Which key definition rejects an explicit id in INSERT unless OVERRIDING SYSTEM VALUE is used?', options: ['serial', 'GENERATED BY DEFAULT AS IDENTITY', 'GENERATED ALWAYS AS IDENTITY', 'DEFAULT nextval(...)'], answer: 2, explain: 'ALWAYS means the system always assigns the value.' },
    { type: 'tf', q: 'If a transaction that inserted a row rolls back, the identity value it used is reused by the next insert.', answer: false, explain: 'Sequence values are never returned; gaps are normal.' },
    { type: 'mcq', q: 'Which function generates a time-ordered UUID in core PostgreSQL 18?', options: ['gen_random_uuid()', 'uuid_generate_v1() (core)', 'uuidv7()', 'now()::uuid'], answer: 2, explain: 'uuidv7() is new in PostgreSQL 18. uuid_generate_v1() comes from the uuid-ossp extension, and gen_random_uuid() produces v4.' },
    { type: 'design', q: 'A public API exposes order IDs in URLs; orders are created only on the server; volume ~50M/year. Best key?', options: ['int serial', 'email of the customer', 'bigint identity internally plus a uuid (v7 or v4) public identifier, or a uuidv7 PK', 'text order number built from date + random'], answer: 2, explain: 'Compact internal key for joins, non-enumerable public identifier; bigint avoids overflow.' },
    { type: 'bug', q: 'After bulk-loading 1M customers with their original ids, the app\'s first INSERT fails with duplicate key. Fix?', code: `INSERT INTO customers (name, email, country, city, segment)
VALUES ('New', 'new@example.com', 'India', 'Pune', 'smb');
-- ERROR: duplicate key value violates unique constraint "customers_pkey"`, options: ['Drop the primary key', 'SELECT setval(pg_get_serial_sequence(\'customers\',\'id\'), (SELECT max(id) FROM customers))', 'Use SERIAL', 'VACUUM the table'], answer: 1, explain: 'The sequence still starts at 1; move it past the highest existing id.' }
  ]
},
{
  id: 'database-design-table-ddl',
  module: 'database-design',
  title: 'Table Design DDL: CREATE, ALTER, DROP, TRUNCATE, Defaults, Generated and Audit Columns',
  level: 1,
  minutes: 24,
  summary: 'Write production-quality CREATE TABLE statements, evolve them safely with ALTER TABLE, and add defaults, generated columns, naming conventions and created_at/updated_at audit columns.',
  objectives: [
    'Write CREATE TABLE with types, NOT NULL, DEFAULT, PRIMARY KEY, UNIQUE, CHECK and REFERENCES',
    'Evolve a table with ALTER TABLE: add/drop/rename columns, change types, add constraints',
    'Use stored and virtual generated columns (virtual is the default in PostgreSQL 18)',
    'Add created_at/updated_at audit columns and maintain updated_at with a trigger',
    'Choose between DROP, TRUNCATE and DELETE',
    'Apply consistent naming conventions for tables, columns, constraints and indexes'
  ],
  concept: `
<p>A table definition is a contract: every row that will ever exist must satisfy it. Good DDL makes invalid data impossible and makes the schema readable years later.</p>
<p><strong>Analogy: designing a paper form for a government office.</strong> Each box (column) has a label (name), a format (type: "date, DD/MM/YYYY"), a rule whether it may be left blank (<code>NOT NULL</code>), a pre-printed default ("Country: India"), validation printed beside it (<code>CHECK</code>: "age must be 18–65"), and an "Office use only — computed" box (generated column). A form with vague boxes produces garbage; a well-designed form makes mistakes hard.</p>
<h4>Anatomy of CREATE TABLE</h4>
<ul>
<li><strong>Column definition</strong>: <code>name type [constraints] [DEFAULT expr]</code>.</li>
<li><strong>Column constraints</strong>: <code>NOT NULL</code>, <code>UNIQUE</code>, <code>PRIMARY KEY</code>, <code>CHECK (expr)</code>, <code>REFERENCES other(col)</code>.</li>
<li><strong>Table constraints</strong> (for multi-column rules): <code>PRIMARY KEY (a, b)</code>, <code>UNIQUE (a, b)</code>, <code>CHECK (end_date &gt;= start_date)</code>, <code>FOREIGN KEY (...) REFERENCES ...</code>. Name them with <code>CONSTRAINT name</code> for clear error messages.</li>
<li><strong>DEFAULT</strong>: a constant or expression evaluated at insert time (<code>now()</code>, <code>current_user</code>, <code>gen_random_uuid()</code>). A default applies only when the column is omitted or given as <code>DEFAULT</code> — an explicit <code>NULL</code> is still NULL.</li>
<li><strong>Generated columns</strong>: <code>GENERATED ALWAYS AS (expr) STORED | VIRTUAL</code>. Stored columns are computed on write and occupy disk; virtual columns (new in PostgreSQL 18, and the default when neither keyword is given) are computed on read. Expressions must be immutable and refer only to the same row.</li>
</ul>
<h4>Changing tables: ALTER, DROP, TRUNCATE</h4>
<table>
<tr><th>Statement</th><th>Effect</th><th>Notes</th></tr>
<tr><td><code>ALTER TABLE ... ADD COLUMN</code></td><td>Adds a column</td><td>With a constant (or non-volatile) default it is instant — no table rewrite since PostgreSQL 11</td></tr>
<tr><td><code>ALTER TABLE ... ALTER COLUMN ... TYPE</code></td><td>Changes the type</td><td>Usually rewrites the whole table under an exclusive lock (cheap exceptions: <code>varchar(n)</code> → larger or <code>text</code>)</td></tr>
<tr><td><code>ALTER TABLE ... RENAME</code></td><td>Renames table/column</td><td>Catalog-only, instant — but breaks application queries</td></tr>
<tr><td><code>ALTER TABLE ... ADD CONSTRAINT</code></td><td>Adds PK/UNIQUE/CHECK/FK</td><td>Validates existing rows; use <code>NOT VALID</code> + <code>VALIDATE CONSTRAINT</code> on big tables</td></tr>
<tr><td><code>DROP TABLE</code></td><td>Removes table, data, indexes, triggers</td><td><code>CASCADE</code> also drops dependent views and FKs</td></tr>
<tr><td><code>TRUNCATE</code></td><td>Removes all rows instantly</td><td>Replaces the data files; transactional; can <code>RESTART IDENTITY</code>; fires no row triggers</td></tr>
</table>
<h4>Naming conventions (a widely used house style)</h4>
<ul>
<li>lower_snake_case, no quotes, no reserved words (<code>user</code>, <code>order</code> are reserved — company_db uses <code>users</code>, <code>orders</code>).</li>
<li>Tables: plural nouns (<code>orders</code>, <code>order_items</code>); junction tables: both names (<code>employee_projects</code>).</li>
<li>PK column <code>id</code>; FK columns <code>&lt;singular_parent&gt;_id</code> (<code>customer_id</code>).</li>
<li>Booleans read as questions: <code>is_active</code>, <code>has_discount</code>; timestamps end in <code>_at</code> (<code>created_at</code>), dates in <code>_date</code> or <code>_on</code>.</li>
<li>Constraints/indexes: <code>&lt;table&gt;_&lt;cols&gt;_pkey|key|fkey|check</code> and <code>idx_&lt;table&gt;_&lt;cols&gt;</code> (PostgreSQL's own default names follow the first pattern).</li>
</ul>
<h4>Audit columns</h4>
<p>Almost every business table benefits from <code>created_at timestamptz NOT NULL DEFAULT now()</code> and <code>updated_at timestamptz NOT NULL DEFAULT now()</code>. <code>DEFAULT</code> handles inserts; <strong>updates need a <code>BEFORE UPDATE</code> trigger</strong> (or disciplined application code) to refresh <code>updated_at</code>. Some teams add <code>created_by</code>/<code>updated_by</code>; full change history belongs in an audit table like company_db's <code>audit_logs</code>.</p>`,
  why: `
<p>Constraints in DDL are the last line of defence for data quality — they apply to every application, script, migration and manual fix. Defaults and generated columns remove repetitive logic from application code (and the bugs that come with re-implementing it in each service). Audit columns answer the first two questions of every incident investigation: "when was this created?" and "when did it last change?". Naming conventions make a 300-table schema navigable for new team members and tools.</p>`,
  useCase: `
<p><strong>A logistics SaaS</strong> standardises its migrations: every table has <code>id bigint GENERATED ALWAYS AS IDENTITY</code>, <code>created_at</code>/<code>updated_at</code> with a shared <code>set_updated_at()</code> trigger, named CHECK constraints for status values, and FK indexes. A stored generated column <code>volume_m3 = length_cm * width_cm * height_cm / 1e6</code> on <code>parcels</code> is indexed to find large parcels quickly. When they needed a new <code>priority</code> column on a 400-million-row table, <code>ADD COLUMN priority smallint NOT NULL DEFAULT 3</code> completed in milliseconds because PostgreSQL stores the default in the catalog instead of rewriting rows.</p>`,
  internals: `
<p><code>CREATE TABLE</code> inserts rows into <code>pg_class</code> (the table), <code>pg_attribute</code> (columns), <code>pg_constraint</code>, <code>pg_attrdef</code> (defaults) and creates an empty data file. Since PostgreSQL 11, <code>ADD COLUMN ... DEFAULT &lt;non-volatile&gt;</code> records the value in <code>pg_attribute.attmissingval</code>; old rows that physically lack the column return that value on read — no rewrite. A volatile default such as <code>clock_timestamp()</code> or <code>gen_random_uuid()</code> still forces a rewrite. Most <code>ALTER TABLE</code> forms take an <code>ACCESS EXCLUSIVE</code> lock that blocks reads and writes for their duration — and while waiting for that lock, they block everyone queued behind them. Always set <code>lock_timeout</code> in migrations.</p>
<p><code>TRUNCATE</code> allocates a new empty relfilenode and drops the old files at commit — that's why it is O(1) regardless of size and leaves no dead tuples, but it also needs an <code>ACCESS EXCLUSIVE</code> lock.</p>`,
  whenNot: `
<ul>
<li>Don't use generated columns for values that depend on other rows, the current time or session state — they must be immutable functions of the row. Use views or triggers.</li>
<li>Don't use triggers for business logic that belongs in the application or in explicit SQL; keep triggers for cross-cutting concerns like <code>updated_at</code> and auditing.</li>
<li>Don't <code>ALTER COLUMN TYPE</code> on a large hot table during business hours — use add-new-column + backfill + swap.</li>
<li>Don't <code>TRUNCATE</code> a table that other tables reference unless you intend <code>CASCADE</code> to empty those too.</li>
<li>Don't use <code>CREATE TABLE IF NOT EXISTS</code> in migrations to paper over drift — it silently succeeds even if the existing table has a different structure.</li>
</ul>`,
  syntax: `CREATE TABLE [ IF NOT EXISTS ] table_name (
  column_name data_type [ NOT NULL ] [ DEFAULT expr ]
              [ GENERATED ALWAYS AS ( expr ) { STORED | VIRTUAL } ]
              [ GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY ]
              [ PRIMARY KEY | UNIQUE | CHECK ( expr ) | REFERENCES t ( col ) ],
  [ CONSTRAINT name ] { PRIMARY KEY (...) | UNIQUE (...) | CHECK (...) | FOREIGN KEY (...) REFERENCES ... }
);

ALTER TABLE t ADD COLUMN c type [ DEFAULT ... ] [ NOT NULL ];
ALTER TABLE t DROP COLUMN c [ CASCADE ];
ALTER TABLE t RENAME COLUMN a TO b;            ALTER TABLE t RENAME TO t2;
ALTER TABLE t ALTER COLUMN c TYPE new_type [ USING expr ];
ALTER TABLE t ALTER COLUMN c SET DEFAULT expr | DROP DEFAULT | SET NOT NULL | DROP NOT NULL;
ALTER TABLE t ADD CONSTRAINT name CHECK (...) [ NOT VALID ];
ALTER TABLE t VALIDATE CONSTRAINT name;

DROP TABLE [ IF EXISTS ] t [ CASCADE ];
TRUNCATE [ TABLE ] t [, ...] [ RESTART IDENTITY ] [ CASCADE ];
COMMENT ON TABLE t IS 'description';`,
  examples: [
    { label: 'Basic', title: 'A well-formed CREATE TABLE',
      sql: `CREATE TABLE suppliers (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text        NOT NULL,
  email       text        NOT NULL UNIQUE,
  country     text        NOT NULL DEFAULT 'India',
  rating      smallint    CONSTRAINT suppliers_rating_check CHECK (rating BETWEEN 1 AND 5),
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE suppliers IS 'Companies we buy products from';

INSERT INTO suppliers (name, email, rating)
VALUES ('Zenit Components', 'sales@zenit.example', 4);

SELECT id, name, country, rating, is_active,
       created_at = updated_at AS timestamps_equal
FROM   suppliers;`,
      explain: `<ul><li>Only <code>name</code>, <code>email</code> and <code>rating</code> were supplied; <code>id</code>, <code>country</code>, <code>is_active</code> and both timestamps came from identity/defaults.</li>
<li><code>rating</code> is nullable (unknown rating is a valid state) but must be 1–5 when present: a CHECK passes when its expression is NULL.</li>
<li>The named CHECK constraint produces a readable error: <em>new row for relation "suppliers" violates check constraint "suppliers_rating_check"</em>.</li>
<li><code>COMMENT ON</code> documents the table inside the database (visible with <code>\\d+</code> and in GUI tools).</li></ul>`,
      output: `CREATE TABLE
COMMENT
INSERT 0 1
 id | name             | country | rating | is_active | timestamps_equal
----+------------------+---------+--------+-----------+------------------
  1 | Zenit Components | India   |      4 | t         | t
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Generated columns: STORED vs VIRTUAL (PostgreSQL 18)',
      sql: `CREATE TABLE line_items_demo (
  id            int           GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quantity      int           NOT NULL CHECK (quantity > 0),
  unit_price    numeric(10,2) NOT NULL,
  discount_pct  numeric(5,2)  NOT NULL DEFAULT 0,
  -- computed on write, stored on disk, indexable
  line_total    numeric(12,2) GENERATED ALWAYS AS
                  (round(quantity * unit_price * (1 - discount_pct / 100), 2)) STORED,
  -- computed on read, no storage (VIRTUAL is the default in PostgreSQL 18)
  gross_total   numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price) VIRTUAL
);

INSERT INTO line_items_demo (quantity, unit_price, discount_pct)
VALUES (3, 1999.00, 10), (1, 49999.99, 0);

SELECT * FROM line_items_demo;

UPDATE line_items_demo SET quantity = 5 WHERE id = 1;     -- line_total recomputes automatically
SELECT id, quantity, line_total, gross_total FROM line_items_demo WHERE id = 1;`,
      explain: `<p>You can never write to a generated column directly — it is always derived from the row, so it can never be inconsistent. After the UPDATE, <code>line_total</code> becomes 5 × 1999 × 0.9 = 8995.50 without any application code.</p>
<p><strong>STORED</strong> costs disk space and write time but can be indexed. <strong>VIRTUAL</strong> (PostgreSQL 18+) costs nothing on write and is computed when read; in PostgreSQL 18 virtual columns cannot be indexed yet. Before 18, only STORED existed and you had to write the keyword explicitly.</p>`,
      output: ` id | quantity | unit_price | discount_pct | line_total | gross_total
----+----------+------------+--------------+------------+-------------
  1 |        3 |    1999.00 |        10.00 |    5397.30 |     5997.00
  2 |        1 |   49999.99 |         0.00 |   49999.99 |    49999.99
(2 rows)

UPDATE 1
 id | quantity | line_total | gross_total
----+----------+------------+-------------
  1 |        5 |    8995.50 |     9995.00
(1 row)`, run: true },
    { label: 'Advanced', title: 'Evolving a table with ALTER and maintaining updated_at with a trigger',
      sql: `CREATE TABLE warehouse (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, code text NOT NULL, city text);
INSERT INTO warehouse (code, city) VALUES ('BLR-1', 'Bengaluru'), ('DEL-1', 'Delhi');

-- Schema evolution, one step at a time (each would be its own migration)
SET lock_timeout = '2s';                                          -- never queue forever behind a lock
ALTER TABLE warehouse ADD COLUMN capacity_m3 int NOT NULL DEFAULT 1000;   -- instant: no rewrite
ALTER TABLE warehouse ADD CONSTRAINT warehouse_code_key UNIQUE (code);
ALTER TABLE warehouse ALTER COLUMN city SET NOT NULL;               -- scans to verify
ALTER TABLE warehouse RENAME COLUMN city TO city_name;
ALTER TABLE warehouse RENAME TO warehouses;
ALTER TABLE warehouses ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
                       ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Reusable trigger function for every table with an updated_at column
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();   -- now() would be frozen at transaction start
  RETURN NEW;
END;
$$;

CREATE TRIGGER warehouses_set_updated_at
BEFORE UPDATE ON warehouses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

UPDATE warehouses SET capacity_m3 = 2500 WHERE code = 'BLR-1';

SELECT id, code, city_name, capacity_m3,
       updated_at > created_at AS was_updated
FROM   warehouses
ORDER  BY id;`,
      explain: `<ul><li><code>ADD COLUMN ... NOT NULL DEFAULT 1000</code> is a metadata-only change (fast default), even on huge tables.</li>
<li><code>SET NOT NULL</code> must scan the table to prove there are no NULLs (in PostgreSQL 18 you can first add a <code>NOT NULL ... NOT VALID</code> constraint and validate it later without blocking writes).</li>
<li>Renames are instant but break any code still using the old name — coordinate with deployments, or use a view for compatibility.</li>
<li>The <code>BEFORE UPDATE</code> trigger overwrites <code>NEW.updated_at</code>, so callers cannot forget (or fake) it. <code>clock_timestamp()</code> is used because <code>now()</code> returns the transaction start time, which would equal <code>created_at</code> when both happen in one transaction.</li></ul>`,
      output: ` id | code  | city_name | capacity_m3 | was_updated
----+-------+-----------+-------------+-------------
  1 | BLR-1 | Bengaluru |        2500 | t
  2 | DEL-1 | Delhi     |        1000 | f
(2 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Vague, unconstrained, inconsistent names
CREATE TABLE "Supplier" (
  "ID"       serial,
  "Name"     varchar(50),
  status     varchar(255),        -- any text: 'Active', 'active', 'ACTV', NULL...
  rating     int,                  -- -7 accepted
  createdOn  varchar(20)           -- a date stored as text
);`,
      why: 'Quoted mixed-case names must be quoted forever; no PK; nothing is NOT NULL; status and rating accept garbage; a date stored as text cannot be compared or validated; serial instead of identity.', run: true },
    good: { sql: `CREATE TABLE supplier_accounts (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text        NOT NULL CHECK (length(trim(name)) > 0),
  status      text        NOT NULL DEFAULT 'active'
                          CONSTRAINT supplier_accounts_status_check
                          CHECK (status IN ('active', 'suspended', 'closed')),
  rating      smallint    CHECK (rating BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);`,
      why: 'Consistent lower_snake_case names, a real PK, NOT NULL where data is mandatory, constrained status and rating values, proper timestamp type, and audit columns.', run: true }
  },
  mistakes: [
    'Using reserved words as names (<code>user</code>, <code>order</code>, <code>group</code>) — they need quoting everywhere.',
    'Adding a column with a <em>volatile</em> default (<code>DEFAULT clock_timestamp()</code>, <code>gen_random_uuid()</code>) to a huge table and triggering a full rewrite under an exclusive lock.',
    'Running <code>ALTER TABLE</code> on a busy table without <code>lock_timeout</code>: it waits for a long-running query, and every new query queues behind it — an outage.',
    'Expecting <code>DEFAULT now()</code> to update <code>updated_at</code> on UPDATE — defaults only apply on INSERT.',
    'Storing dates, numbers or booleans as text — you lose validation, sorting and arithmetic.',
    'Using <code>TRUNCATE</code> on a table referenced by foreign keys and being surprised by <em>cannot truncate a table referenced in a foreign key constraint</em> (or, with CASCADE, by emptying the children too).'
  ],
  best: [
    'Every table: identity/uuid PK, <code>NOT NULL</code> by default, named CHECK constraints, FKs with indexes, <code>created_at</code>/<code>updated_at</code>.',
    'Keep DDL in version-controlled migration files (Flyway, Liquibase, sqitch, Alembic, EF Core migrations — all <span class="tag tool">third-party tool</span>s) and run each in a transaction.',
    'Set <code>lock_timeout</code> (and retry) for every migration on a live system.',
    'Prefer <code>text</code> with CHECK constraints over arbitrary <code>varchar(255)</code> limits.',
    'Document tables and columns with <code>COMMENT ON</code>.',
    'Use expand/contract migrations for renames and type changes: add new → dual-write/backfill → switch reads → drop old.'
  ],
  performance: `
<p>Column order affects row size through alignment padding: placing 8-byte types (<code>bigint</code>, <code>timestamptz</code>, <code>numeric</code> is variable) before 4/2/1-byte types can save a few bytes per row — meaningful only at hundreds of millions of rows. Stored generated columns add write cost but can be indexed; virtual ones cost CPU on every read. Table-rewriting ALTERs (type changes, volatile defaults, <code>SET</code> on some storage params) take time proportional to table size and need disk space for a full copy plus WAL. <code>TRUNCATE</code> is O(1) and leaves no bloat, whereas <code>DELETE FROM big_table</code> leaves millions of dead tuples for VACUUM.</p>`,
  security: `
<p>DDL rights are powerful: a role that can <code>ALTER TABLE</code> can disable triggers, drop constraints or add a column that leaks data via a view. Restrict DDL to a migration role; the application role should only have DML. Trigger functions run with the privileges of the caller by default — avoid <code>SECURITY DEFINER</code> unless necessary, and if you use it, pin <code>SET search_path</code> on the function. Audit columns support forensics but can be forged by clients unless set by triggers or defaults the client cannot override.</p>`,
  scenario: { title: 'A migration takes the site down for 4 minutes', steps: [
    '1. The migration ran ALTER TABLE orders ADD CONSTRAINT ... FOREIGN KEY at 11:00 without lock_timeout.',
    '2. It waited behind a 4-minute analytics query holding a share lock; every API query queued behind the migration\'s pending ACCESS EXCLUSIVE request.',
    '3. Fix now: cancel the migration (pg_cancel_backend), traffic recovers instantly.',
    '4. Redo it safely: SET lock_timeout = \'3s\'; ADD CONSTRAINT ... NOT VALID (brief lock, no scan); then VALIDATE CONSTRAINT (weaker lock, runs alongside traffic).',
    '5. Add a CI check that rejects migrations without lock_timeout and flags table-rewriting ALTERs.'
  ] },
  interview: [
    { q: 'What is the difference between DROP, TRUNCATE and DELETE?', a: 'DELETE removes rows matching a WHERE clause one by one, fires row triggers, and leaves dead tuples for VACUUM. TRUNCATE removes all rows by swapping in empty data files — fast, transactional, can restart identities, but takes an ACCESS EXCLUSIVE lock and fires no row triggers. DROP removes the table definition itself along with its data, indexes and triggers.' },
    { q: 'Is ALTER TABLE ADD COLUMN with a DEFAULT expensive?', a: 'Since PostgreSQL 11, not if the default is non-volatile: the value is stored in the catalog and returned for old rows, so it is instant. A volatile default (clock_timestamp(), gen_random_uuid()) forces a full table rewrite. Changing a column type usually rewrites the table too.' },
    { q: 'How do you keep updated_at accurate?', a: 'Default it to now() for inserts and add a BEFORE UPDATE FOR EACH ROW trigger that sets NEW.updated_at (often clock_timestamp()). Relying on application code alone fails as soon as someone runs a manual UPDATE or another service writes to the table.' },
    { q: 'What are generated columns and what changed in PostgreSQL 18?', a: 'Columns whose value is computed from other columns of the same row by an immutable expression; they cannot be written directly. Before 18 only STORED generated columns existed (computed on write, indexable). PostgreSQL 18 adds VIRTUAL generated columns, computed on read with no storage, and makes VIRTUAL the default.' }
  ],
  exercises: [
    { task: 'Create a table vendors_demo with: bigint identity PK, gstin text unique and exactly 15 characters, name not null, city with default \'Mumbai\', is_verified boolean default false, and audit timestamps. Insert one row supplying only gstin and name.', solution: `CREATE TABLE vendors_demo (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gstin       text        NOT NULL UNIQUE CHECK (length(gstin) = 15),
  name        text        NOT NULL,
  city        text        NOT NULL DEFAULT 'Mumbai',
  is_verified boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO vendors_demo (gstin, name) VALUES ('27AAEPM1234C1Z5', 'Mehta Traders');
SELECT id, gstin, name, city, is_verified FROM vendors_demo;`, run: true },
    { task: 'Add a stored generated column stock_value (price * stock) to products, then list the 3 products with the highest stock_value.', solution: `ALTER TABLE products
  ADD COLUMN stock_value numeric(14,2) GENERATED ALWAYS AS (price * stock) STORED;

SELECT sku, name, stock_value
FROM   products
ORDER  BY stock_value DESC
LIMIT  3;`, run: true },
    { task: 'Copy audit_logs into a new table audit_copy, empty it with TRUNCATE, confirm it is empty, then drop it.', solution: `CREATE TABLE audit_copy AS SELECT * FROM audit_logs;
TRUNCATE audit_copy;
SELECT count(*) AS rows_after_truncate FROM audit_copy;
DROP TABLE audit_copy;`, run: true }
  ],
  challenge: { task: 'Add a NOT NULL "region" column to customers derived from country (India → APAC, Singapore → APAC, UAE → MEA, UK/Germany → EMEA, USA → AMER) in a way that would be safe on a large table: add it nullable, backfill, then add a CHECK constraint NOT VALID and validate it, and finally set NOT NULL. Show the distribution.', hint: 'ADD COLUMN (nullable, no default) → UPDATE with CASE → ADD CONSTRAINT ... CHECK (region IS NOT NULL) NOT VALID → VALIDATE CONSTRAINT → ALTER COLUMN SET NOT NULL.', solution: `ALTER TABLE customers ADD COLUMN region text;

UPDATE customers
SET    region = CASE country
                  WHEN 'India'     THEN 'APAC'
                  WHEN 'Singapore' THEN 'APAC'
                  WHEN 'UAE'       THEN 'MEA'
                  WHEN 'USA'       THEN 'AMER'
                  ELSE 'EMEA'
                END;

ALTER TABLE customers ADD CONSTRAINT customers_region_not_null CHECK (region IS NOT NULL) NOT VALID;
ALTER TABLE customers VALIDATE CONSTRAINT customers_region_not_null;
ALTER TABLE customers ALTER COLUMN region SET NOT NULL;   -- uses the validated CHECK, no extra scan

SELECT region, count(*) FROM customers GROUP BY region ORDER BY region;`, run: true },
  related: ['database-design-surrogate-natural-keys', 'constraints', 'triggers', 'data-types'],
  quiz: [
    { type: 'tf', q: 'A DEFAULT now() on updated_at keeps it current when rows are updated.', answer: false, explain: 'Defaults apply on INSERT only; use a BEFORE UPDATE trigger.' },
    { type: 'mcq', q: 'In PostgreSQL 18, what kind of generated column do you get if you write neither STORED nor VIRTUAL?', options: ['STORED', 'VIRTUAL', 'An error', 'IDENTITY'], answer: 1, explain: 'PostgreSQL 18 introduced virtual generated columns and made VIRTUAL the default.' },
    { type: 'mcq', q: 'Which ALTER is instant on a 500M-row table?', options: ['ALTER COLUMN amount TYPE numeric(14,2) (from integer)', 'ADD COLUMN flag boolean NOT NULL DEFAULT false', 'ADD COLUMN token uuid DEFAULT gen_random_uuid()', 'ALTER COLUMN id TYPE bigint'], answer: 1, explain: 'A non-volatile default is stored in the catalog; the others rewrite the table.' },
    { type: 'bug', q: 'Why does this table definition cause trouble later?', code: `CREATE TABLE user (id int, name text);`, options: ['user is a reserved word and must be quoted everywhere', 'int is too small', 'text needs a length', 'Missing schema'], answer: 0, explain: 'USER is reserved (it is even a function returning the current role). Name it users.' },
    { type: 'write', q: 'Write a CHECK constraint (named) ensuring a projects-like table\'s end_date is NULL or not before start_date.', solution: `ALTER TABLE projects
  ADD CONSTRAINT projects_dates_check
  CHECK (end_date IS NULL OR end_date >= start_date);`, explain: 'Explicitly allowing NULL documents intent (open-ended projects); a CHECK also passes when the expression is NULL.' }
  ]
}
]);

/* ============================ MODULE: data-types ============================ */
PGM.addLessons([
{
  id: 'data-types-numeric',
  module: 'data-types',
  title: 'Numeric Types: smallint, integer, bigint, numeric, real, double precision and money',
  level: 1,
  minutes: 20,
  summary: 'Pick the right number type: integer sizes and ranges, exact numeric(p,s) for money, binary floating point and its rounding errors, and why the money type is a trap.',
  objectives: [
    'Choose between smallint, integer and bigint based on range and storage',
    'Use numeric(precision, scale) for exact decimal values such as money and quantities',
    'Explain why 0.1 + 0.2 <> 0.3 with real/double precision',
    'Avoid integer division, overflow and rounding surprises',
    'Explain the pitfalls of the money type',
    'Round, truncate and cast numbers deliberately'
  ],
  concept: `
<p>PostgreSQL has three families of numbers: <strong>integers</strong> (whole numbers, fast, fixed size), <strong>arbitrary-precision decimals</strong> (<code>numeric</code>, exact) and <strong>floating point</strong> (<code>real</code>, <code>double precision</code>, approximate).</p>
<p><strong>Analogy: three measuring tools.</strong> Integers are a tally counter — perfect for counting whole things, but it has a maximum before it rolls over. <code>numeric</code> is a bank teller's ledger — every paisa exact, slower to write. Floating point is a laboratory instrument with a fixed number of significant digits — it measures the distance to the moon or a sensor reading brilliantly, but it cannot represent 0.1 exactly, just as 1/3 cannot be written exactly in decimal.</p>
<table>
<tr><th>Type</th><th>Storage</th><th>Range / precision</th><th>Use for</th></tr>
<tr><td><code>smallint</code> (int2)</td><td>2 bytes</td><td>−32,768 to 32,767</td><td>Small bounded codes, ratings, percentages</td></tr>
<tr><td><code>integer</code> (int, int4)</td><td>4 bytes</td><td>±2,147,483,647 (~2.1 billion)</td><td>Counts, quantities, IDs of small tables</td></tr>
<tr><td><code>bigint</code> (int8)</td><td>8 bytes</td><td>±9.22 × 10<sup>18</sup></td><td>IDs of large tables, byte counts, money in minor units</td></tr>
<tr><td><code>numeric(p, s)</code> / <code>decimal</code></td><td>variable (≈ 2 bytes per 4 digits + 3–8 overhead)</td><td>Up to 131,072 digits before the point, 16,383 after; exact</td><td>Money, prices, tax rates, measurements needing exact decimals</td></tr>
<tr><td><code>real</code> (float4)</td><td>4 bytes</td><td>~6 significant decimal digits</td><td>Rarely — low-precision sensor data</td></tr>
<tr><td><code>double precision</code> (float8)</td><td>8 bytes</td><td>~15 significant digits</td><td>Scientific values, statistics, coordinates, ML features</td></tr>
<tr><td><code>money</code></td><td>8 bytes</td><td>Fixed 2-decimal currency, locale-formatted</td><td>Avoid (see below)</td></tr>
</table>
<h4>numeric(p, s)</h4>
<p><em>Precision</em> <code>p</code> is the total number of significant digits, <em>scale</em> <code>s</code> the digits after the decimal point. <code>numeric(10,2)</code> stores up to 99,999,999.99. Values with more decimals are <em>rounded</em> to the scale; values with too many integer digits raise <em>numeric field overflow</em>. A bare <code>numeric</code> (no p, s) stores any value exactly at its own scale. Arithmetic on <code>numeric</code> is exact for +, −, × and correctly rounded for ÷.</p>
<h4>Floating point</h4>
<p><code>real</code> and <code>double precision</code> implement IEEE 754 binary floating point — the same as Java <code>double</code> or JavaScript numbers. Most decimal fractions (0.1, 0.2, 0.3) have no exact binary representation, so tiny errors appear and accumulate: <code>0.1 + 0.2 = 0.30000000000000004</code>. Never use them for money or for equality comparisons.</p>
<h4>The money type</h4>
<p><code>money</code> stores a fixed 2-decimal amount, but its input/output format depends on the server's <code>lc_monetary</code> setting (a dump restored on a server with a different locale can misread values), it has no currency attribute, it supports only 2 decimals (no exchange rates, no 3-decimal currencies like the Kuwaiti dinar), and arithmetic with it is awkward. Use <code>numeric(12,2)</code> (plus a <code>currency char(3)</code> column if needed) — company_db does.</p>`,
  why: `
<p>Number types exist to trade off <em>range</em>, <em>exactness</em>, <em>storage</em> and <em>speed</em>. Getting this right prevents three expensive classes of bug: overflow (an <code>integer</code> counter that stops at 2.1 billion), silent precision loss (a ledger that is off by a few paise after a million float additions — auditors notice), and wasted space/CPU (using <code>numeric</code> for a row counter). Financial regulators, tax systems and payment reconciliations all assume exact decimal arithmetic.</p>`,
  useCase: `
<p><strong>A payments company processing ₹2,000 crore a month</strong> stores amounts as <code>numeric(14,2)</code> with a <code>currency char(3)</code> column, exchange rates as <code>numeric(18,8)</code>, and fee percentages as <code>numeric(6,4)</code>. Transaction counters and IDs are <code>bigint</code>. Fraud-scoring features computed by the ML team (probabilities, z-scores) are <code>double precision</code> — speed matters more than the 15th digit. An earlier prototype that used <code>float8</code> for amounts failed reconciliation: summing 30 million refunds drifted by ₹0.37 from the bank statement.</p>`,
  internals: `
<p>Integers and floats are fixed-length, passed by value, and compared with single CPU instructions. <code>numeric</code> is a variable-length (varlena) type storing base-10000 digits; arithmetic is done in software, typically 2–10× slower than integers for large aggregates — rarely the bottleneck for OLTP, noticeable for analytics over hundreds of millions of rows. Integer operations check for overflow and raise <em>integer out of range</em> rather than wrapping around silently. Since PostgreSQL 12, float output uses the shortest exact representation (<code>extra_float_digits = 1</code> default), which is why you now see <code>0.30000000000000004</code> instead of a rounded <code>0.3</code>. <code>numeric</code> also supports <code>NaN</code> and (since 14) <code>Infinity</code>.</p>`,
  whenNot: `
<ul>
<li>Don't use <code>numeric</code> for counters, IDs or quantities that are always whole — use integers.</li>
<li>Don't use <code>real</code>/<code>double precision</code> for money, invoices, tax or anything that must reconcile exactly.</li>
<li>Don't use <code>money</code> at all in new designs.</li>
<li>Don't over-specify precision "just in case" (<code>numeric(38,10)</code> for a price) — choose what the domain needs and enforce ranges with CHECK constraints.</li>
<li>For very large scientific arrays or vectors, specialised types (arrays of float8, or the pgvector <span class="tag ext">extension</span>'s <code>vector</code>) fit better.</li>
</ul>`,
  syntax: `smallint | integer | bigint
numeric [ (precision [, scale]) ]      -- alias: decimal
real | double precision                -- aliases: float4 | float8, float(p)
money                                  -- avoid

-- conversions and rounding
value::numeric(10,2)     CAST(value AS bigint)
round(x [, digits])  trunc(x [, digits])  ceil(x)  floor(x)
div(a, b)  mod(a, b)  a % b  power(a, b)  a ^ b  sqrt(x)  abs(x)`,
  examples: [
    { label: 'Basic', title: 'Integer ranges and storage sizes',
      sql: `SELECT 32767::smallint               AS smallint_max,
       2147483647::integer            AS int_max,
       9223372036854775807::bigint    AS bigint_max,
       pg_column_size(1::smallint)    AS smallint_bytes,
       pg_column_size(1::integer)     AS int_bytes,
       pg_column_size(1::bigint)      AS bigint_bytes,
       pg_column_size(1::real)        AS real_bytes,
       pg_column_size(1::double precision) AS double_bytes,
       pg_column_size(123.45::numeric)     AS numeric_bytes;`,
      explain: `<p><code>pg_column_size</code> shows how many bytes a value occupies. Integers and floats have fixed sizes; <code>numeric</code> is variable — here 10 bytes for 123.45 (a header plus base-10000 digit groups). Adding 1 to <code>2147483647::integer</code> raises <em>ERROR: integer out of range</em> instead of wrapping to a negative number like C or Java would.</p>`,
      output: ` smallint_max | int_max    | bigint_max          | smallint_bytes | int_bytes | bigint_bytes | real_bytes | double_bytes | numeric_bytes
--------------+------------+---------------------+----------------+-----------+--------------+------------+--------------+---------------
        32767 | 2147483647 | 9223372036854775807 |              2 |         4 |            8 |          4 |            8 |            10
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Floating-point error vs exact numeric',
      sql: `-- One addition
SELECT 0.1::double precision + 0.2::double precision          AS float_sum,
       0.1::double precision + 0.2::double precision = 0.3    AS float_equal,
       0.1::numeric + 0.2::numeric                            AS numeric_sum,
       0.1::numeric + 0.2::numeric = 0.3                      AS numeric_equal;

-- Errors accumulate: add 0.10 one thousand times
SELECT sum(0.1::real)             AS real_sum,
       sum(0.1::double precision) AS double_sum,
       sum(0.1::numeric)          AS numeric_sum
FROM   generate_series(1, 1000);

-- Real data: revenue of delivered orders
SELECT sum(total_amount)          AS revenue_numeric,
       sum(total_amount::float8)  AS revenue_float
FROM   orders
WHERE  status = 'delivered';`,
      explain: `<p>0.1 in binary is a repeating fraction, like 1/3 in decimal. <code>real</code> (≈6–7 digits) drifts visibly after 1,000 additions: 99.99905 instead of 100. <code>double precision</code> is much closer but still not exact. <code>numeric</code> is exact. On company_db's real revenue figure, the float version is off in the 7th decimal place — invisible on a dashboard, fatal in an accounting reconciliation that compares to the paisa.</p>`,
      output: ` float_sum           | float_equal | numeric_sum | numeric_equal
---------------------+-------------+-------------+---------------
 0.30000000000000004 | f           |         0.3 | t
(1 row)

 real_sum | double_sum       | numeric_sum
----------+------------------+-------------
 99.99905 | 99.9999999999986 |       100.0
(1 row)

 revenue_numeric | revenue_float
-----------------+-------------------
    626608982.67 | 626608982.6699998
(1 row)`, run: true },
    { label: 'Advanced', title: 'Division, rounding and scale control',
      sql: `SELECT 10 / 4               AS int_div,        -- integer division truncates
       10 / 4.0             AS numeric_div,
       10::float8 / 4       AS float_div,
       -7 / 2               AS neg_int_div,    -- truncates toward zero
       div(-7, 2)           AS div_fn,
       mod(-7, 2)           AS mod_fn,         -- sign follows the dividend
       round(2.5)           AS round_numeric,  -- numeric: half away from zero
       round(2.5::float8)   AS round_float,    -- float: half to even (banker's)
       trunc(7.89, 1)       AS trunc_1dp,
       ceil(7.1)            AS ceil_,
       floor(-7.1)          AS floor_;

-- Control the scale of a result
SELECT 12.5::numeric / 3                   AS raw_division,
       round(12.5::numeric / 3, 2)         AS rounded_2dp,
       (12.5::numeric / 3)::numeric(10,2)  AS cast_to_2dp,
       12.345::numeric(5,1)                AS input_rounded_to_scale;`,
      explain: `<ul><li>Integer ÷ integer truncates toward zero (<code>-7 / 2 = -3</code>).</li>
<li><code>round()</code> on <code>numeric</code> rounds half away from zero (2.5 → 3); on <code>double precision</code> it follows the platform's round-half-to-even (2.5 → 2). Mixing types in financial code can therefore give different cents.</li>
<li>Numeric division returns many decimals; fix the scale with <code>round()</code> or a cast to <code>numeric(p,s)</code> — both round half away from zero.</li>
<li>Assigning a value with more decimals than the column's scale rounds it (12.345 → 12.3 for scale 1). Too many integer digits — <code>123456.78::numeric(7,2)</code> — raises <em>numeric field overflow</em>.</li></ul>`,
      output: ` int_div | numeric_div        | float_div | neg_int_div | div_fn | mod_fn | round_numeric | round_float | trunc_1dp | ceil_ | floor_
---------+--------------------+-----------+-------------+--------+--------+---------------+-------------+-----------+-------+--------
       2 | 2.5000000000000000 |       2.5 |          -3 |     -3 |     -1 |             3 |           2 |       7.8 |     8 |     -8
(1 row)

 raw_division       | rounded_2dp | cast_to_2dp | input_rounded_to_scale
--------------------+-------------+-------------+------------------------
 4.1666666666666667 |        4.17 |        4.17 |                   12.3
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `CREATE TABLE wallet_bad (
  id      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  balance double precision NOT NULL          -- money as float
);
INSERT INTO wallet_bad (balance) VALUES (0);
UPDATE wallet_bad SET balance = balance + 0.1;          -- a 10-paise top-up
SELECT balance + 0.2 = 0.3 AS balance_matches FROM wallet_bad;`,
      why: 'Binary floating point cannot represent 0.1 exactly: comparisons fail and errors accumulate over thousands of transactions, breaking reconciliation.', run: true },
    good: { sql: `CREATE TABLE wallet_good (
  id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  balance  numeric(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency char(3)       NOT NULL DEFAULT 'INR'
);
INSERT INTO wallet_good DEFAULT VALUES;
UPDATE wallet_good SET balance = balance + 0.1;
SELECT balance, balance + 0.2 = 0.3 AS balance_matches, currency FROM wallet_good;`,
      why: 'numeric is exact decimal arithmetic; the scale fixes amounts to paise, a CHECK forbids negative balances, and the currency is explicit.', run: true }
  },
  mistakes: [
    'Storing money in <code>real</code>/<code>double precision</code> — rounding drift and failed equality checks.',
    'Using the <code>money</code> type — locale-dependent I/O, no currency, fixed 2 decimals.',
    'Computing percentages with integers: <code>count(*) * 100 / total</code> truncates; use <code>100.0 * count(*) / total</code>.',
    'Using <code>integer</code> for values that can exceed 2.1 billion (row counts of big tables, file sizes in bytes, cumulative totals).',
    'Comparing floats with <code>=</code>; compare with a tolerance (<code>abs(a - b) &lt; 1e-9</code>) or use numeric.',
    'Forgetting that <code>numeric(p,s)</code> silently rounds extra decimals on input — validate inputs if rounding is not acceptable.'
  ],
  best: [
    'Money and exact quantities: <code>numeric(p,s)</code> sized for the domain (e.g. <code>numeric(14,2)</code>) plus a currency code.',
    'Counts and IDs: <code>integer</code> for bounded, <code>bigint</code> for anything that grows.',
    'Scientific/statistical values: <code>double precision</code>.',
    'Enforce business ranges with CHECK constraints (<code>CHECK (price &gt;= 0)</code>, <code>CHECK (pct BETWEEN 0 AND 100)</code>).',
    'Round explicitly and once, at a defined point (e.g. per invoice line), and document the rounding rule.',
    'Alternative for high-volume ledgers: store integer minor units (<code>bigint</code> paise/cents) and convert at the edges.'
  ],
  performance: `
<p>Integer arithmetic and comparisons are the fastest; <code>bigint</code> costs 4 more bytes per value than <code>integer</code> (per row and per index entry) — negligible except in very large tables and indexes. <code>numeric</code> aggregates (<code>sum</code>, <code>avg</code>) are noticeably slower than float aggregates on hundreds of millions of rows; for analytics you may cast to <code>float8</code> inside a query when exactness is not required, but never store money that way. Smaller types also mean more rows per page and better cache efficiency, but alignment padding often erases the gain of <code>smallint</code> next to 8-byte columns.</p>`,
  security: `
<p>Overflow and precision are integrity issues with security consequences: an integer overflow in application code (not in PostgreSQL, which raises an error) or float rounding exploited in currency conversion can be abused ("salami" rounding attacks). Validate amounts server-side, use CHECK constraints for non-negative balances, and perform money arithmetic in <code>numeric</code> inside the database transaction.</p>`,
  interview: [
    { q: 'Why should money not be stored as double precision?', a: 'double precision is binary floating point; most decimal fractions like 0.1 cannot be represented exactly, so sums drift and equality comparisons fail. Financial values need exact decimal arithmetic, which numeric(p,s) provides (or integer minor units in bigint).' },
    { q: 'What are precision and scale in numeric(10,2)?', a: 'Precision is the total number of significant digits (10) and scale is the number of digits after the decimal point (2), so the maximum is 99,999,999.99. Extra decimals are rounded; too many integer digits raise numeric field overflow.' },
    { q: 'What is wrong with the money type?', a: 'Its text input/output depends on lc_monetary, so dumps can be misread on servers with different locales; it has no currency, supports only the locale\'s fraction digits, and mixes poorly with numeric arithmetic. numeric plus a currency column is the recommended alternative.' },
    { q: 'What happens when an integer column overflows in PostgreSQL?', a: 'PostgreSQL raises "integer out of range" (or "bigint out of range") and the statement fails; it never wraps around silently. For identity keys approaching the int limit you must migrate to bigint.' }
  ],
  exercises: [
    { task: 'Calculate, for each product category, the share of total stock value as a percentage with 2 decimals (avoid integer division).', solution: `SELECT category,
       sum(price * stock) AS stock_value,
       round(100.0 * sum(price * stock) / sum(sum(price * stock)) OVER (), 2) AS pct_of_total
FROM   products
GROUP  BY category
ORDER  BY stock_value DESC;`, run: true },
    { task: 'Show that real loses precision: cast 123456789 to real and back to bigint.', solution: `SELECT 123456789::real          AS as_real,
       123456789::real::bigint  AS back_to_bigint;`, run: true },
    { task: 'Create a table fx_rates with base char(3), quote char(3), rate numeric(18,8) > 0 and a composite primary key; insert USD→INR 83.12345678 and convert 250.00 USD to INR rounded to 2 decimals.', solution: `CREATE TABLE fx_rates (
  base  char(3)        NOT NULL,
  quote char(3)        NOT NULL,
  rate  numeric(18,8)  NOT NULL CHECK (rate > 0),
  PRIMARY KEY (base, quote)
);
INSERT INTO fx_rates VALUES ('USD', 'INR', 83.12345678);
SELECT round(250.00 * rate, 2) AS inr_amount
FROM   fx_rates
WHERE  base = 'USD' AND quote = 'INR';`, run: true }
  ],
  challenge: { task: 'Verify order totals: for each of the first 5 orders, compare orders.total_amount with the exact sum of quantity × unit_price from order_items, and show the difference. Use only exact numeric arithmetic.', hint: 'Join orders to an aggregated subquery of order_items grouped by order_id.', solution: `SELECT o.id,
       o.total_amount,
       li.items_total,
       o.total_amount - li.items_total AS difference
FROM   orders o
JOIN  (SELECT order_id, sum(quantity * unit_price) AS items_total
       FROM   order_items
       GROUP  BY order_id) li ON li.order_id = o.id
WHERE  o.id <= 5
ORDER  BY o.id;`, run: true },
  related: ['data-types-character-boolean', 'querying-case-coalesce-cast', 'database-design-table-ddl', 'aggregations'],
  quiz: [
    { type: 'predict', q: 'What does this return?', code: `SELECT 0.1::float8 + 0.2::float8 = 0.3::float8;`, options: ['true', 'false', 'NULL', 'An error'], answer: 1, explain: 'Binary floating point yields 0.30000000000000004, which is not equal to the float closest to 0.3.' },
    { type: 'mcq', q: 'Best type for an invoice amount in rupees and paise?', options: ['real', 'double precision', 'numeric(12,2)', 'money'], answer: 2, explain: 'Exact decimal with 2 decimal places.' },
    { type: 'predict', q: 'What is stored?', code: `SELECT 9.995::numeric(5,2);`, options: ['9.99', '10.00', '9.995', 'An error'], answer: 1, explain: 'numeric rounds half away from zero to the scale: 9.995 → 10.00 (still fits precision 5).' },
    { type: 'tf', q: 'Adding 1 to the maximum integer value wraps around to a negative number in PostgreSQL.', answer: false, explain: 'PostgreSQL checks overflow and raises "integer out of range".' },
    { type: 'bug', q: 'This conversion-rate report shows 0% for almost everything. Why?', code: `SELECT category,
       count(*) FILTER (WHERE stock > 300) / count(*) * 100 AS pct_high_stock
FROM products GROUP BY category;`, options: ['FILTER is not allowed with count', 'Integer division truncates (e.g. 7 / 20 = 0) before multiplying; use 100.0 * count(*) FILTER (...) / count(*)', 'Need GROUP BY 2', 'stock is numeric'], answer: 1, explain: 'count() returns bigint, so the division is integer division and truncates to 0 unless every row matches. Multiply by 100.0 first to switch to numeric arithmetic.' }
  ]
},
{
  id: 'data-types-character-boolean',
  module: 'data-types',
  title: 'Character and Boolean Types: char, varchar, text (and Why text Is Fine) and boolean',
  level: 1,
  minutes: 18,
  summary: 'char(n), varchar(n) and text compared — why text with CHECK constraints is the idiomatic PostgreSQL choice — plus string functions, collations, case-insensitive matching and the three-state boolean.',
  objectives: [
    'Explain the differences between char(n), varchar(n) and text, and why they perform the same in PostgreSQL',
    'Enforce length and format rules with CHECK constraints instead of arbitrary varchar limits',
    'Use common string functions: length, lower/upper, trim, substr, split_part, concat_ws, format, regexp_replace',
    'Handle case-insensitive uniqueness and lookups (lower() indexes, citext extension, ICU collations)',
    'Understand how collations affect sorting and comparison',
    'Use boolean correctly, including NULL as a third state and IS TRUE / IS NOT TRUE'
  ],
  concept: `
<h4>Character types</h4>
<table>
<tr><th>Type</th><th>Behaviour</th><th>Verdict</th></tr>
<tr><td><code>char(n)</code> / <code>character(n)</code></td><td>Fixed length: pads with spaces to n; trailing spaces are insignificant in comparisons and stripped when converted to text</td><td>Avoid, except truly fixed codes (and even then <code>text</code> + CHECK is clearer)</td></tr>
<tr><td><code>varchar(n)</code></td><td>Variable length, error if longer than n characters on insert/update</td><td>OK when a hard limit is a genuine business rule</td></tr>
<tr><td><code>varchar</code> (no n) / <code>text</code></td><td>Variable length, unlimited (up to 1&nbsp;GB)</td><td><strong>Default choice in PostgreSQL</strong></td></tr>
</table>
<p><strong>Analogy: storage boxes.</strong> <code>char(10)</code> is a box that always takes 10 slots on the shelf, stuffed with packing foam (spaces) if the item is small. <code>varchar(10)</code> is a box that shrinks to fit but refuses anything longer than 10. <code>text</code> is a box that shrinks to fit and accepts anything — and you can still put a label rule on it ("max 10, digits only") with a CHECK constraint. In PostgreSQL all three are stored the same way internally, so the flexible box costs nothing extra.</p>
<h4>Why text is fine in PostgreSQL</h4>
<p>Unlike some databases, PostgreSQL stores <code>text</code>, <code>varchar(n)</code> and <code>char(n)</code> with the <em>same</em> variable-length (varlena) format. There is no performance benefit from <code>varchar(255)</code>; the limit only adds a check — and an <code>ALTER TABLE</code> when the business changes its mind. <code>char(n)</code> is actually slower and larger because of padding. So the idiom is: use <code>text</code>, and when a real rule exists, express it explicitly: <code>CHECK (length(code) = 6)</code>, <code>CHECK (sku ~ '^SKU-[0-9]{4}$')</code>.</p>
<h4>Encoding and length</h4>
<p>Databases are almost always UTF-8. <code>length()</code> counts <em>characters</em>; <code>octet_length()</code> counts <em>bytes</em> — "नमस्ते" is 6 characters but 18 bytes. Limits in <code>varchar(n)</code> are in characters.</p>
<h4>Collation and case</h4>
<p>A <strong>collation</strong> defines how strings sort and compare. With the byte-wise <code>"C"</code> collation, all upper-case letters sort before lower-case (<code>'Banana' &lt; 'apple'</code>); with linguistic collations (ICU <code>"unicode"</code>, <code>en-IN-x-icu</code>, or OS locales like <code>en_US.UTF-8</code>) "apple" sorts before "Banana". Comparisons are <strong>case-sensitive</strong> by default: <code>'Asha' = 'asha'</code> is false. For case-insensitive matching use <code>lower(col) = lower($1)</code> with an expression index, the <span class="tag ext">extension</span> <code>citext</code>, <code>ILIKE</code> for patterns, or a nondeterministic ICU collation.</p>
<h4>boolean</h4>
<p><code>boolean</code> holds <code>true</code>, <code>false</code> or <code>NULL</code> (unknown) in 1 byte. Input accepts <code>true/false</code>, <code>'t'/'f'</code>, <code>'yes'/'no'</code>, <code>'on'/'off'</code>, <code>'1'/'0'</code>. In WHERE you can write the column alone (<code>WHERE is_active</code>). If a flag must never be unknown, declare it <code>NOT NULL DEFAULT false</code>. Use <code>IS TRUE</code>, <code>IS NOT TRUE</code>, <code>IS UNKNOWN</code> when NULLs are possible.</p>`,
  why: `
<p>Text columns are where most real-world data quality problems live: inconsistent case, trailing spaces, duplicate emails differing only by capitalisation, phone numbers in five formats. Choosing the right type and constraints up front — and knowing that PostgreSQL does not punish you for using <code>text</code> — keeps the schema flexible and the data clean. Booleans look trivial, but nullable booleans silently create a third state that filters and reports often mishandle.</p>`,
  useCase: `
<p><strong>A SaaS sign-up flow</strong> had 3% duplicate accounts: users registered as <code>Asha.Rao@Example.com</code> and later <code>asha.rao@example.com</code>. The <code>email varchar(255) UNIQUE</code> column treated them as different. The fix: a unique expression index on <code>lower(email)</code> (or switching the column to <code>citext</code>), a CHECK that rejects leading/trailing spaces, and a one-time merge of duplicates. Separately, a <code>marketing_opt_in boolean</code> column without <code>NOT NULL</code> held 40,000 NULLs; the email campaign used <code>WHERE NOT marketing_opt_in</code> to exclude opted-out users and accidentally excluded the unknowns too — the right answer was a <code>NOT NULL DEFAULT false</code> column plus an explicit consent backfill.</p>`,
  internals: `
<p>Short strings (under 127 bytes) use a 1-byte length header; longer ones a 4-byte header. Values larger than about 2&nbsp;kB are compressed (pglz, or lz4 if configured with <code>default_toast_compression</code>) and, if still large, moved out of line into the table's TOAST relation in chunks — the main row keeps an 18-byte pointer. That is why a 18,000-character repetitive string may occupy only a few hundred bytes. <code>char(n)</code> stores the padding spaces physically, which is why it is never smaller than <code>text</code>. <code>boolean</code> is 1 byte; several boolean columns are not bit-packed, but NULLs cost only a bit in the tuple's null bitmap. String comparisons under linguistic collations call the ICU or libc collation library and are slower than byte-wise <code>"C"</code> comparisons, which matters for large sorts and index builds.</p>`,
  whenNot: `
<ul>
<li>Don't use <code>char(n)</code> for variable data — trailing-space semantics surprise everyone.</li>
<li>Don't use text for data that has a proper type: dates, numbers, booleans, UUIDs, IP addresses, JSON.</li>
<li>Don't store enumerations as free text without a CHECK constraint (or a lookup table / enum).</li>
<li>Don't use a nullable boolean when the business has only two states.</li>
<li>Don't use booleans for states that will grow (<code>is_shipped</code>, <code>is_delivered</code>, <code>is_returned</code>…) — a single <code>status</code> column with a CHECK models a state machine better.</li>
</ul>`,
  syntax: `char(n) | varchar(n) | varchar | text | boolean

-- constraints instead of magic lengths
code text NOT NULL CHECK (code ~ '^[A-Z]{3}-[0-9]{4}$')
name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200)

-- common functions
length(s)  octet_length(s)  lower(s)  upper(s)  initcap(s)  trim(s)  btrim(s, chars)
left(s, n)  right(s, n)  substr(s, from, len)  position(sub IN s)  split_part(s, delim, n)
replace(s, from, to)  regexp_replace(s, pattern, repl, 'g')  lpad(s, n, fill)
concat(a, b, ...)  concat_ws(sep, a, b, ...)  format('%s ... %L', a, b)  s1 || s2

-- booleans
flag IS TRUE | IS NOT TRUE | IS FALSE | IS NOT FALSE | IS UNKNOWN
bool_and(flag)  bool_or(flag)  count(*) FILTER (WHERE flag)`,
  examples: [
    { label: 'Basic', title: 'char vs varchar vs text in practice',
      sql: `SELECT 'abc'::char(6)                       AS fixed,
       length('abc'::char(6))              AS len,              -- trailing spaces ignored
       octet_length('abc'::char(6))        AS stored_bytes,     -- but stored: 6 bytes
       'abc'::char(6) || '|'               AS concat_char,      -- padding stripped on cast to text
       'abc'::varchar(6) || '|'            AS concat_varchar,
       'abc '::char(6) = 'abc'::char(6)    AS char_eq,          -- trailing spaces insignificant
       'abc '::text = 'abc'::text          AS text_eq;          -- significant for text`,
      explain: `<p><code>char(6)</code> physically pads "abc" to 6 bytes, yet <code>length()</code> says 3 and comparisons ignore trailing spaces, while <code>text</code> treats <code>'abc '</code> and <code>'abc'</code> as different. These inconsistent semantics are the main reason to avoid <code>char(n)</code>.</p>
<p>Also note: inserting <code>'toolong'</code> into a <code>varchar(5)</code> column raises <em>value too long for type character varying(5)</em>, but an explicit cast <code>'toolong'::varchar(5)</code> silently truncates to <code>'toolo'</code> (SQL-standard behaviour).</p>`,
      output: ` fixed  | len | stored_bytes | concat_char | concat_varchar | char_eq | text_eq
--------+-----+--------------+-------------+----------------+---------+---------
 abc    |   3 |            6 | abc|        | abc|           | t       | f
(1 row)`, run: true },
    { label: 'Intermediate', title: 'String functions on real data',
      sql: `SELECT first_name,
       length(first_name)                               AS chars,
       upper(last_name)                                 AS upper_last,
       left(email, position('@' IN email) - 1)          AS mailbox,
       split_part(email, '@', 2)                        AS domain,
       initcap(job_title)                               AS title,
       format('%s %s <%s>', first_name, last_name, email) AS display_name
FROM   employees
WHERE  id IN (1, 9, 20)
ORDER  BY id;

-- NULL-safe concatenation, cleaning and Unicode lengths
SELECT concat_ws(' ', 'Asha', NULL, 'Rao')                    AS concat_ws_skips_null,
       'Asha' || NULL                                          AS pipe_returns_null,
       regexp_replace('+91 98450-00001', '[^0-9]', '', 'g')    AS digits_only,
       lpad('42', 6, '0')                                      AS zero_padded,
       length('नमस्ते')                                        AS hindi_chars,
       octet_length('नमस्ते')                                  AS hindi_bytes;`,
      explain: `<ul><li><code>position</code> + <code>left</code> and <code>split_part</code> parse the email; <code>initcap</code> capitalises each word.</li>
<li><code>format()</code> builds strings safely; use <code>%I</code> for identifiers and <code>%L</code> for literals when generating dynamic SQL.</li>
<li><code>||</code> returns NULL if any operand is NULL; <code>concat_ws</code> skips NULLs — ideal for optional middle names or address lines.</li>
<li>Devanagari "नमस्ते" is 6 characters but 18 bytes in UTF-8: <code>varchar(n)</code> and <code>length()</code> count characters.</li></ul>`,
      output: ` first_name | chars | upper_last | mailbox      | domain      | title              | display_name
------------+-------+------------+--------------+-------------+--------------------+--------------------------------------------
 Asha       |     4 | RAO        | asha.rao1    | company.com | Head Of Department | Asha Rao <asha.rao1@company.com>
 Myra       |     4 | PATEL      | myra.patel9  | company.com | Associate          | Myra Patel <myra.patel9@company.com>
 Aarav      |     5 | KHAN       | aarav.khan20 | company.com | Analyst            | Aarav Khan <aarav.khan20@company.com>
(3 rows)

 concat_ws_skips_null | pipe_returns_null | digits_only  | zero_padded | hindi_chars | hindi_bytes
----------------------+-------------------+--------------+-------------+-------------+-------------
 Asha Rao             |                   | 919845000001 | 000042      |           6 |          18
(1 row)`, run: true },
    { label: 'Advanced', title: 'Case-insensitive uniqueness, collations and three-state booleans',
      sql: `-- Option A: expression index on lower(email)
CREATE TABLE members (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text NOT NULL
                      CHECK (email = trim(email)));
CREATE UNIQUE INDEX members_email_lower_key ON members (lower(email));
INSERT INTO members (email) VALUES ('Asha.Rao@Example.com');
-- INSERT INTO members (email) VALUES ('asha.rao@example.com');  -- would fail: duplicate key
SELECT id, email FROM members WHERE lower(email) = lower('ASHA.RAO@example.com');

-- Option B: the citext extension (case-insensitive text type)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE TABLE members_ci (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email citext NOT NULL UNIQUE);
INSERT INTO members_ci (email) VALUES ('Asha.Rao@Example.com');
SELECT email, email = 'asha.rao@example.com' AS matches FROM members_ci;

-- Collations change sort order
SELECT string_agg(name, ', ' ORDER BY name COLLATE "C")       AS c_byte_order,
       string_agg(name, ', ' ORDER BY name COLLATE "unicode") AS linguistic_order
FROM  (VALUES ('banana'), ('Apple'), ('cherry'), ('apple'), ('Éclair')) AS v(name);

-- Booleans: NULL is a third state
CREATE TABLE flags (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text, is_verified boolean);
INSERT INTO flags (label, is_verified)
VALUES ('yes', 'yes'), ('true', true), ('one', '1'), ('off', 'off'), ('unknown', NULL);
SELECT count(*) FILTER (WHERE is_verified)              AS verified,
       count(*) FILTER (WHERE NOT is_verified)          AS not_verified,
       count(*) FILTER (WHERE is_verified IS NOT TRUE)  AS not_verified_or_unknown
FROM   flags;`,
      explain: `<ul><li><strong>Expression index</strong>: uniqueness is enforced on <code>lower(email)</code>, and queries must use the same expression to use the index. Core PostgreSQL, no extension.</li>
<li><strong>citext</strong> (<span class="tag ext">extension</span>, ships with PostgreSQL contrib) compares case-insensitively automatically, so plain <code>=</code> and <code>UNIQUE</code> just work.</li>
<li><strong>Collations</strong>: byte order (<code>"C"</code>) puts all capitals first and accented letters last; the ICU <code>"unicode"</code> collation sorts linguistically.</li>
<li><strong>Booleans</strong>: 'yes', true and '1' are all <code>true</code>. <code>NOT is_verified</code> counts only the explicit false (1); the unknown row is in neither bucket. <code>IS NOT TRUE</code> includes it (2).</li></ul>`,
      output: ` id | email
----+----------------------
  1 | Asha.Rao@Example.com
(1 row)

 email                | matches
----------------------+---------
 Asha.Rao@Example.com | t
(1 row)

 c_byte_order                         | linguistic_order
--------------------------------------+--------------------------------------
 Apple, apple, banana, cherry, Éclair | apple, Apple, banana, cherry, Éclair
(1 row)

 verified | not_verified | not_verified_or_unknown
----------+--------------+-------------------------
        3 |            1 |                       2
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `CREATE TABLE contacts_bad (
  code   char(10),            -- padded, odd comparison semantics
  name   varchar(255),        -- arbitrary limit, no real rule
  email  varchar(255) UNIQUE, -- case-sensitive: duplicates by capitalisation
  phone  varchar(20)          -- '+91 98450 00001', '9845000001', '098450-00001'...
);
INSERT INTO contacts_bad VALUES ('C1', 'Asha', 'Asha@X.com', '+91 98450 00001'),
                                ('C2', 'Asha', 'asha@x.com', '9845000001');
SELECT count(*) AS same_person_twice FROM contacts_bad WHERE lower(email) = 'asha@x.com';`,
      why: 'Arbitrary varchar limits add no value, char pads, case-variant emails slip past UNIQUE, and phone numbers have no canonical format.', run: true },
    good: { sql: `CREATE TABLE contacts_good (
  code   text NOT NULL UNIQUE CHECK (code ~ '^C[0-9]{1,9}$'),
  name   text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  email  text NOT NULL CHECK (email = lower(trim(email)) AND email LIKE '%_@_%'),
  phone  text CHECK (phone ~ '^\\+[1-9][0-9]{7,14}$')     -- E.164 canonical form
);
CREATE UNIQUE INDEX contacts_good_email_key ON contacts_good (email);
INSERT INTO contacts_good VALUES ('C1', 'Asha Rao', 'asha@x.com', '+919845000001');
SELECT * FROM contacts_good;`,
      why: 'text everywhere, with real rules as CHECK constraints: canonical lower-case emails (so UNIQUE works), E.164 phone numbers, and validated codes.', run: true }
  },
  mistakes: [
    'Using <code>varchar(255)</code> everywhere out of habit from other databases — no benefit in PostgreSQL, and future ALTERs when 255 is too short.',
    'Using <code>char(n)</code> for codes and then failing comparisons or joins with <code>text</code> values because of padding semantics.',
    'Creating <code>UNIQUE (email)</code> and assuming it is case-insensitive.',
    'Indexing <code>email</code> but querying <code>WHERE lower(email) = ...</code> — the plain index is not used; index the expression.',
    'Concatenating optional fields with <code>||</code> and losing the whole value when one part is NULL.',
    'Using a nullable boolean and filtering with <code>WHERE NOT flag</code>, silently excluding NULLs.'
  ],
  best: [
    'Default to <code>text</code>; add <code>CHECK</code> constraints for genuine length/format rules.',
    'Normalise on write: trim, lower-case emails, canonical phone formats (E.164).',
    'For case-insensitive uniqueness use a unique index on <code>lower(col)</code> or the <code>citext</code> extension.',
    'Choose the database collation deliberately at creation time (ICU <code>und</code> or a locale) and use <code>COLLATE "C"</code> for code-like columns that need fast byte-wise ordering.',
    'Make booleans <code>NOT NULL DEFAULT false</code> unless "unknown" is a real state; name them <code>is_</code>/<code>has_</code>.',
    'Use <code>format()</code> with <code>%I</code>/<code>%L</code> for dynamic SQL instead of string concatenation.'
  ],
  performance: `
<p>All character types share the same storage, so <code>text</code> has no penalty; <code>char(n)</code> wastes space on padding. Comparisons and sorts under linguistic collations are slower than <code>"C"</code>; B-tree indexes used for <code>LIKE 'prefix%'</code> need the <code>"C"</code> collation or the <code>text_pattern_ops</code> operator class. Function-wrapped predicates (<code>lower(email) = ...</code>) need matching expression indexes. Very long text values are TOASTed — reading them costs extra I/O, another reason to select only the columns you need.</p>`,
  security: `
<p>Validate and canonicalise text at the database boundary: CHECK constraints stop malformed values from any client. When building dynamic SQL in functions, use <code>format('%I', name)</code> and <code>format('%L', value)</code> or <code>quote_ident</code>/<code>quote_literal</code>, never raw concatenation — this prevents SQL injection inside PL/pgSQL. Be aware that Unicode look-alike characters (homoglyphs) can create visually identical but distinct usernames; normalise with <code>normalize(s, NFC)</code> and restrict allowed characters where it matters.</p>`,
  interview: [
    { q: 'What is the difference between varchar(n) and text in PostgreSQL?', a: 'Storage and performance are identical (both varlena); varchar(n) only adds a length check on assignment. text is unlimited (up to 1 GB). The PostgreSQL idiom is text plus a CHECK constraint when a real length rule exists, which is also easier to change later.' },
    { q: 'How do you enforce case-insensitive uniqueness of email addresses?', a: 'Either a unique expression index on lower(email) (queries must use lower(email) to benefit), the citext extension\'s case-insensitive type with a normal UNIQUE constraint, a nondeterministic ICU collation, or normalising emails to lower case on write with a CHECK constraint.' },
    { q: 'Why might WHERE NOT is_active return fewer rows than expected?', a: 'If is_active is nullable, NOT NULL is NULL (unknown), so rows with NULL are excluded from both WHERE is_active and WHERE NOT is_active. Use IS NOT TRUE, or better, declare the column NOT NULL DEFAULT false.' }
  ],
  exercises: [
    { task: 'List the distinct email domains of customers with the number of customers per domain.', solution: `SELECT split_part(email, '@', 2) AS domain, count(*) AS customers
FROM   customers
GROUP  BY domain
ORDER  BY customers DESC;`, run: true },
    { task: 'Show employees whose last name has more than 6 characters, with the last name upper-cased and the first initial, e.g. "A. KAPOOR".', solution: `SELECT left(first_name, 1) || '. ' || upper(last_name) AS short_name
FROM   employees
WHERE  length(last_name) > 6
ORDER  BY last_name, first_name
LIMIT  10;`, run: true },
    { task: 'Count active and inactive employees and compute the percentage that is active with one decimal, using boolean aggregates/filters.', solution: `SELECT count(*) FILTER (WHERE is_active)       AS active,
       count(*) FILTER (WHERE NOT is_active)   AS inactive,
       round(100.0 * count(*) FILTER (WHERE is_active) / count(*), 1) AS pct_active,
       bool_and(is_active)                      AS everyone_active
FROM   employees;`, run: true }
  ],
  challenge: { task: 'Product SKUs follow the pattern SKU-#### . Add a CHECK constraint enforcing it, prove all 100 existing products comply, then build a normalised "slug" for each product name: lower case, spaces replaced by hyphens, only a-z, 0-9 and hyphens. Show 5 examples.', hint: 'CHECK (sku ~ \'^SKU-[0-9]{4}$\'); for the slug use lower() and regexp_replace twice.', solution: `ALTER TABLE products
  ADD CONSTRAINT products_sku_format_check CHECK (sku ~ '^SKU-[0-9]{4}$');

SELECT count(*) AS non_compliant FROM products WHERE sku !~ '^SKU-[0-9]{4}$';

SELECT name,
       regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g') AS slug
FROM   products
ORDER  BY id
LIMIT  5;`, run: true },
  related: ['data-types-numeric', 'querying-null-pattern-matching', 'database-design-table-ddl', 'extensions'],
  quiz: [
    { type: 'tf', q: 'In PostgreSQL, varchar(255) is faster than text.', answer: false, explain: 'They use identical storage; varchar(n) only adds a length check.' },
    { type: 'predict', q: 'What does this return?', code: `SELECT length('abc'::char(10)), octet_length('abc'::char(10));`, options: ['3, 3', '10, 10', '3, 10', '10, 3'], answer: 2, explain: 'char pads physically (10 bytes) but length() ignores trailing spaces for char.' },
    { type: 'mcq', q: 'Which makes UNIQUE(email) case-insensitive?', options: ['varchar instead of text', 'A unique index on lower(email) or the citext type', 'COLLATE "C"', 'char(255)'], answer: 1, explain: 'Byte-wise collations are case-sensitive; index lower(email) or use citext.' },
    { type: 'predict', q: 'What does this return?', code: `SELECT 'Dr.' || NULL || ' Rao' AS a, concat_ws(' ', 'Dr.', NULL, 'Rao') AS b;`, options: ['"Dr. Rao", "Dr. Rao"', 'NULL, "Dr. Rao"', '"Dr.  Rao", NULL', 'An error'], answer: 1, explain: '|| propagates NULL; concat_ws skips NULL arguments.' },
    { type: 'design', q: 'A column records whether a customer accepted marketing emails; legally, no answer means no consent. Best definition?', options: ['marketing_opt_in boolean', 'marketing_opt_in boolean NOT NULL DEFAULT false', 'marketing_opt_in text', 'marketing_opt_in char(1)'], answer: 1, explain: 'Two real states; absence of consent is false. NOT NULL avoids an accidental third state.' }
  ]
},
{
  id: 'data-types-date-time',
  module: 'data-types',
  title: 'Date and Time: date, time, timestamp vs timestamptz, interval, Time Zones, date_trunc and extract',
  level: 1,
  minutes: 24,
  summary: 'Store moments correctly with timestamptz, do calendar arithmetic with intervals, convert between time zones, and group and filter by date without off-by-one bugs.',
  objectives: [
    'Choose between date, time, timestamp and timestamptz',
    'Explain what timestamptz really stores and how the TimeZone setting affects display',
    'Convert between time zones with AT TIME ZONE',
    'Do date arithmetic with integers and intervals (including month-end and DST behaviour)',
    'Group and analyse with date_trunc, extract, to_char and generate_series',
    'Filter date ranges with half-open intervals instead of BETWEEN'
  ],
  concept: `
<table>
<tr><th>Type</th><th>Stores</th><th>Size</th><th>Example</th><th>Use for</th></tr>
<tr><td><code>date</code></td><td>Calendar day, no time</td><td>4 bytes</td><td><code>2025-03-31</code></td><td>Birthdays, hire dates, due dates, project start/end</td></tr>
<tr><td><code>time</code></td><td>Time of day, no date</td><td>8 bytes</td><td><code>14:30:00</code></td><td>Opening hours, shift start</td></tr>
<tr><td><code>timestamp</code> (without time zone)</td><td>Date + wall-clock time, no zone</td><td>8 bytes</td><td><code>2025-03-31 14:30:00</code></td><td>Rare: "local" schedules like "9 a.m. wherever the store is"</td></tr>
<tr><td><code>timestamptz</code> (with time zone)</td><td>An absolute instant (stored as UTC)</td><td>8 bytes</td><td><code>2025-03-31 14:30:00+05:30</code></td><td><strong>Default for events</strong>: created_at, order_date, paid_at, logins</td></tr>
<tr><td><code>interval</code></td><td>A duration: months, days, microseconds</td><td>16 bytes</td><td><code>1 mon 2 days 03:00:00</code></td><td>Durations, offsets, SLAs, retention periods</td></tr>
</table>
<p><strong>Analogy: a flight ticket.</strong> The departure is printed as "14:30 IST" — that names one exact moment in the universe. A traveller in New York sees the same moment as "05:00 EDT" on their phone. <code>timestamptz</code> is that moment: PostgreSQL converts input to UTC, stores it, and converts back to the <em>viewer's</em> time zone (the session's <code>TimeZone</code> setting) on display. A plain <code>timestamp</code> is a wall clock with no label — "14:30" — useless for comparing events across the world.</p>
<h4>The truth about timestamptz</h4>
<p>Despite the name, <code>timestamptz</code> does <strong>not</strong> store a time zone. It stores a UTC instant. The zone in the output (<code>+05:30</code>) is just the session's display zone. If you must remember the user's original zone (for "send at 9 a.m. local time"), store it separately as a text column (<code>'Asia/Kolkata'</code>).</p>
<h4>Arithmetic</h4>
<ul>
<li><code>date + integer</code> → date (days); <code>date - date</code> → integer days.</li>
<li><code>timestamp(tz) ± interval</code> → timestamp(tz); <code>timestamp - timestamp</code> → interval.</li>
<li>Month arithmetic is calendar-aware: <code>DATE '2025-01-31' + INTERVAL '1 month'</code> = 2025-02-28.</li>
<li>Across daylight-saving changes, <code>+ INTERVAL '1 day'</code> keeps the same wall-clock time, while <code>+ INTERVAL '24 hours'</code> adds exactly 24 hours.</li>
<li><code>age(a, b)</code> returns a "years mons days" interval — ideal for human ages and tenure.</li>
</ul>
<h4>Truncating and extracting</h4>
<ul>
<li><code>date_trunc('month', ts)</code> → first instant of the month (in the session zone, or pass a zone as the 3rd argument) — the workhorse of time-series grouping.</li>
<li><code>extract(field FROM ts)</code> → number: <code>year</code>, <code>quarter</code>, <code>month</code>, <code>week</code>, <code>dow</code> (0 = Sunday), <code>isodow</code> (1 = Monday), <code>doy</code>, <code>hour</code>, <code>epoch</code>.</li>
<li><code>to_char(ts, 'DD Mon YYYY HH12:MI AM')</code> formats; <code>to_date</code>/<code>to_timestamp</code> parse.</li>
<li><code>date_bin('15 minutes', ts, origin)</code> buckets into arbitrary intervals; <code>generate_series</code> produces calendars.</li>
</ul>
<h4>now() and friends</h4>
<p><code>now()</code> = <code>current_timestamp</code> = transaction start time (constant inside a transaction). <code>clock_timestamp()</code> is the real current time. <code>current_date</code> and <code>localtimestamp</code> depend on the session time zone.</p>`,
  why: `
<p>Time bugs are among the most expensive data bugs: orders appearing on the wrong day in reports because servers and users are in different zones, SLAs computed wrongly across daylight-saving changes, month-end billing that skips February, and "last 30 days" filters that miss a day. PostgreSQL's date/time types are among the most complete of any database; using <code>timestamptz</code> consistently and doing arithmetic with intervals eliminates whole categories of these problems.</p>`,
  useCase: `
<p><strong>A food-delivery platform operating in India, UAE and Singapore</strong> stores every event (<code>ordered_at</code>, <code>picked_up_at</code>, <code>delivered_at</code>) as <code>timestamptz</code>. Each city row stores its IANA zone (<code>Asia/Dubai</code>). Daily reports group by <code>date_trunc('day', ordered_at, city.tz)</code> so a 23:50 order in Dubai counts for that Dubai day, not the next UTC day. Delivery-time SLAs are <code>delivered_at - ordered_at &lt;= INTERVAL '30 minutes'</code>. Restaurant opening hours use <code>time</code> columns, and scheduled promotions ("lunch deal 12:00–15:00 local") combine a <code>time</code> with the city's zone at query time.</p>`,
  internals: `
<p><code>timestamp</code> and <code>timestamptz</code> are both 64-bit integers counting microseconds since 2000-01-01 00:00:00 (UTC for timestamptz). On input, timestamptz literals without an explicit offset are interpreted in the session <code>TimeZone</code>; on output they are rendered in it. Time-zone rules come from the IANA tz database compiled into PostgreSQL (or the OS), so historical and future DST rules are applied correctly — update minor versions to get new rules. <code>interval</code> stores three separate fields — months, days and microseconds — because a month is not a fixed number of days and a day is not always 24 hours (DST), which is why <code>INTERVAL '1 day'</code> and <code>INTERVAL '24 hours'</code> can differ. Casting <code>timestamptz</code> to <code>date</code> depends on the session time zone and is not immutable — that's why you cannot index <code>order_date::date</code> directly.</p>`,
  whenNot: `
<ul>
<li>Don't use <code>timestamp</code> (without time zone) for events — you lose the instant. Exceptions: truly local, zone-less concepts (a recurring alarm at 07:00 local).</li>
<li>Don't store dates as text (<code>'31/03/2025'</code>) or epoch integers — you lose validation, arithmetic and readable output.</li>
<li>Don't use <code>time with time zone</code> (<code>timetz</code>) — an offset without a date is ambiguous for DST; the PostgreSQL docs discourage it.</li>
<li>Don't use <code>BETWEEN</code> for timestamp ranges — use half-open <code>&gt;= start AND &lt; next_start</code>.</li>
<li>Don't rely on the server's default time zone in reports — set it explicitly or use <code>AT TIME ZONE</code>.</li>
</ul>`,
  syntax: `date | time | timestamp | timestamptz | interval

DATE '2025-03-31'   TIMESTAMPTZ '2025-03-31 14:30:00+05:30'   INTERVAL '1 month 2 days'
now()  current_date  current_timestamp  clock_timestamp()  localtimestamp

ts AT TIME ZONE 'Asia/Kolkata'         -- timestamptz -> local wall-clock timestamp
local_ts AT TIME ZONE 'Asia/Kolkata'   -- timestamp   -> timestamptz (interpret as that zone)
SET TimeZone = 'UTC';

date_trunc('day' | 'week' | 'month' | 'quarter' | 'year', ts [, 'zone'])
extract(year | quarter | month | day | dow | isodow | doy | hour | epoch FROM ts)
age(ts1, ts2)  to_char(ts, 'YYYY-MM-DD')  to_date(text, fmt)  make_date(y, m, d)
date_bin(interval, ts, origin)  generate_series(start, stop, step)`,
  examples: [
    { label: 'Basic', title: 'The five types and how timestamptz is displayed',
      sql: `SET TimeZone = 'Asia/Kolkata';
SELECT DATE '2025-03-31'                         AS d,
       TIME '14:30:00'                           AS t,
       TIMESTAMP '2025-03-31 14:30:00'           AS ts,
       TIMESTAMPTZ '2025-03-31 14:30:00+05:30'   AS tstz,
       INTERVAL '1 day 2 hours'                  AS iv;

-- The same stored instant, viewed from three time zones
SET TimeZone = 'UTC';
SELECT TIMESTAMPTZ '2025-03-31 14:30:00+05:30' AS seen_in_utc;
SET TimeZone = 'America/New_York';
SELECT TIMESTAMPTZ '2025-03-31 14:30:00+05:30' AS seen_in_new_york,
       TIMESTAMP   '2025-03-31 14:30:00'       AS naive_never_changes;`,
      explain: `<p>The <code>timestamptz</code> value is one instant — 09:00 UTC — displayed as 14:30+05:30 in Kolkata and 05:00-04 in New York (EDT). The naive <code>timestamp</code> prints the same wall-clock digits regardless of the viewer — it has no idea which instant it means.</p>`,
      output: ` d          | t        | ts                  | tstz                      | iv
------------+----------+---------------------+---------------------------+----------------
 2025-03-31 | 14:30:00 | 2025-03-31 14:30:00 | 2025-03-31 14:30:00+05:30 | 1 day 02:00:00
(1 row)

 seen_in_utc
------------------------
 2025-03-31 09:00:00+00
(1 row)

 seen_in_new_york       | naive_never_changes
------------------------+---------------------
 2025-03-31 05:00:00-04 | 2025-03-31 14:30:00
(1 row)`, run: true },
    { label: 'Intermediate', title: 'Date arithmetic, time-zone conversion and DST',
      sql: `SELECT DATE '2025-01-31' + 1                       AS plus_one_day,
       DATE '2025-01-31' + INTERVAL '1 month'       AS plus_one_month,   -- clamps to Feb 28
       DATE '2025-12-31' - DATE '2025-01-01'        AS days_between,     -- integer
       TIMESTAMP '2025-03-31 18:00' - TIMESTAMP '2025-03-30 09:30' AS elapsed,
       age(DATE '2025-10-05', DATE '1990-04-15')    AS age_on_date;

-- Converting between zones
SET TimeZone = 'UTC';
SELECT TIMESTAMPTZ '2025-03-31 09:00:00+00' AT TIME ZONE 'Asia/Kolkata'   AS kolkata_wall_clock,
       TIMESTAMPTZ '2025-03-31 09:00:00+00' AT TIME ZONE 'Asia/Singapore' AS singapore_wall_clock,
       TIMESTAMP   '2025-03-31 14:30:00'    AT TIME ZONE 'Asia/Kolkata'   AS kolkata_local_to_instant;

-- Daylight saving: London springs forward on 2025-03-30
SET TimeZone = 'Europe/London';
SELECT TIMESTAMPTZ '2025-03-30 00:30:00+00' + INTERVAL '1 day'    AS plus_1_day,
       TIMESTAMPTZ '2025-03-30 00:30:00+00' + INTERVAL '24 hours' AS plus_24_hours;`,
      explain: `<ul><li>Month arithmetic clamps to the last valid day; <code>date - date</code> gives whole days; timestamp subtraction gives an interval.</li>
<li><code>AT TIME ZONE</code> on a <code>timestamptz</code> answers "what did the clock on the wall show there?" (returns <code>timestamp</code>). On a <code>timestamp</code> it does the reverse: "this wall-clock time in Kolkata is which instant?" (returns <code>timestamptz</code>).</li>
<li>On the DST night, the clock jumps from 01:00 to 02:00. <code>+ 1 day</code> lands on the same wall-clock time next day (00:30 BST); <code>+ 24 hours</code> is exactly 24 elapsed hours (01:30 BST).</li></ul>`,
      output: ` plus_one_day | plus_one_month      | days_between | elapsed        | age_on_date
--------------+---------------------+--------------+----------------+-------------------------
 2025-02-01   | 2025-02-28 00:00:00 |          364 | 1 day 08:30:00 | 35 years 5 mons 20 days
(1 row)

 kolkata_wall_clock  | singapore_wall_clock | kolkata_local_to_instant
---------------------+----------------------+--------------------------
 2025-03-31 14:30:00 | 2025-03-31 17:00:00  | 2025-03-31 09:00:00+00
(1 row)

 plus_1_day             | plus_24_hours
------------------------+------------------------
 2025-03-31 00:30:00+01 | 2025-03-31 01:30:00+01
(1 row)`, run: true },
    { label: 'Advanced', title: 'Time-series reporting with date_trunc, extract and generate_series',
      sql: `SET TimeZone = 'UTC';

-- Monthly revenue for H1 2025 (half-open range!)
SELECT date_trunc('month', order_date)::date AS month,
       count(*)                              AS orders,
       sum(total_amount)                     AS revenue
FROM   orders
WHERE  order_date >= '2025-01-01' AND order_date < '2025-07-01'
GROUP  BY 1
ORDER  BY 1;

-- Orders by ISO day of week
SELECT extract(isodow FROM order_date) AS isodow,
       to_char(order_date, 'Dy')       AS day,
       count(*)                        AS orders
FROM   orders
GROUP  BY 1, 2
ORDER  BY 1;

-- A calendar with zero-filled gaps: daily orders for the first week of Oct 2025
SELECT d::date                         AS day,
       count(o.id)                     AS orders
FROM   generate_series(DATE '2025-10-01', DATE '2025-10-07', INTERVAL '1 day') AS d
LEFT   JOIN orders o
       ON o.order_date >= d AND o.order_date < d + INTERVAL '1 day'
GROUP  BY d
ORDER  BY d;`,
      explain: `<ul><li><code>date_trunc('month', ...)</code> maps every timestamp to the start of its month; casting to <code>date</code> makes the label tidy.</li>
<li><code>isodow</code> numbers Monday = 1 … Sunday = 7 (ISO 8601); <code>dow</code> would give Sunday = 0.</li>
<li><code>generate_series</code> builds the calendar so days with no orders appear with 0 instead of vanishing — the classic fix for gappy charts. The data ends on 1 October 2025, so later days show 0.</li>
<li>All grouping depends on the session time zone; the first statement pins it to UTC so results are reproducible.</li></ul>`,
      output: ` month      | orders | revenue
------------+--------+-------------
 2025-01-01 |    243 | 61117111.72
 2025-02-01 |    209 | 48971239.55
 2025-03-01 |    236 | 57387507.33
 2025-04-01 |    224 | 53805172.34
 2025-05-01 |    234 | 54963572.97
 2025-06-01 |    253 | 67031829.88
(6 rows)

 isodow | day | orders
--------+-----+--------
      1 | Mon |    745
      2 | Tue |    694
      3 | Wed |    689
      4 | Thu |    714
      5 | Fri |    680
      6 | Sat |    743
      7 | Sun |    735
(7 rows)

 day        | orders
------------+--------
 2025-10-01 |      5
 2025-10-02 |      0
 ...
 2025-10-07 |      0
(7 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `SET TimeZone = 'UTC';
-- "All March orders" with BETWEEN on a timestamptz column
SELECT count(*) AS march_orders
FROM   orders
WHERE  order_date BETWEEN '2025-03-01' AND '2025-03-31';`,
      why: '\'2025-03-31\' means 2025-03-31 00:00:00, so every order placed during 31 March is excluded (232 instead of 236). Writing \'23:59:59\' still misses fractional seconds.', run: true },
    good: { sql: `SET TimeZone = 'UTC';
SELECT count(*) AS march_orders
FROM   orders
WHERE  order_date >= '2025-03-01'
  AND  order_date <  '2025-04-01';`,
      why: 'A half-open range [start, next_start) includes every instant of March exactly once, works for any precision, and can use an index on order_date.', run: true }
  },
  mistakes: [
    'Storing event times as <code>timestamp</code> without time zone — servers, apps and users in different zones then disagree about when things happened.',
    'Believing <code>timestamptz</code> stores the original zone; it stores UTC and displays in the session zone.',
    'Filtering with <code>BETWEEN \'2025-03-01\' AND \'2025-03-31\'</code> and losing the last day.',
    'Filtering with <code>WHERE order_date::date = \'2025-03-14\'</code> — correct only for the session zone and it prevents a plain index on order_date from being used.',
    'Adding <code>30 * INTERVAL \'1 day\'</code> when the business means "one calendar month" (or vice versa).',
    'Using <code>now()</code> inside a long transaction and expecting it to advance — use <code>clock_timestamp()</code>.'
  ],
  best: [
    'Use <code>timestamptz</code> for every event/moment; <code>date</code> for calendar days; <code>interval</code> for durations.',
    'Set the server/application time zone explicitly (often UTC for servers) and convert for display with <code>AT TIME ZONE</code> or in the client.',
    'Store a user\'s or location\'s IANA zone name (<code>Asia/Kolkata</code>) when local-time semantics matter.',
    'Always use half-open ranges: <code>&gt;= start AND &lt; end</code>.',
    'Group time series with <code>date_trunc</code> (pass the zone as third argument when needed) and fill gaps with <code>generate_series</code>.',
    'Keep PostgreSQL minor versions current so time-zone rule changes are applied.'
  ],
  performance: `
<p>Range predicates on a raw timestamp column (<code>order_date &gt;= X AND order_date &lt; Y</code>) can use a B-tree index (or a tiny BRIN index on append-only tables). Wrapping the column in a function (<code>date_trunc('day', order_date) = ...</code>, <code>order_date::date = ...</code>, <code>extract(year FROM order_date) = 2025</code>) prevents that unless you build a matching expression index — and expressions involving <code>timestamptz</code> → <code>date</code> are not immutable, so rewrite the predicate as a range instead. company_db deliberately lacks an index on <code>orders(order_date)</code>; you will add one in the Indexes module. All five types are fixed-size and compare as integers, so they are very cheap.</p>`,
  security: `
<p>Accurate, zone-aware timestamps are the backbone of audit trails, token expiry and incident forensics. Use <code>timestamptz</code> for <code>last_login</code>, <code>expires_at</code> and audit records; compare expiries against <code>now()</code> on the server, not against client-supplied times. Be cautious with <code>to_timestamp</code>/<code>to_date</code> on untrusted input — validate formats and ranges to avoid surprising dates (year 0002, overflow).</p>`,
  interview: [
    { q: 'What is the difference between timestamp and timestamptz?', a: 'timestamp stores a wall-clock date and time with no zone information. timestamptz represents an absolute instant: input is converted to UTC using the given offset or the session TimeZone, stored as UTC, and converted back to the session zone on output. Neither stores the original zone name. Use timestamptz for events.' },
    { q: 'Why is BETWEEN risky for timestamp ranges?', a: 'BETWEEN is inclusive at both ends and a date literal means midnight, so BETWEEN \'2025-03-01\' AND \'2025-03-31\' excludes nearly all of 31 March; using 23:59:59 still misses fractional seconds. A half-open range >= start AND < next_start is exact and index-friendly.' },
    { q: 'What is the difference between INTERVAL \'1 day\' and INTERVAL \'24 hours\'?', a: 'interval keeps months, days and microseconds separately. Adding 1 day to a timestamptz keeps the same local wall-clock time even across DST transitions (which may be 23 or 25 elapsed hours), while 24 hours adds exactly 86,400 seconds.' },
    { q: 'How would you produce a daily report that includes days with no sales?', a: 'Generate the calendar with generate_series(start_date, end_date, interval \'1 day\') and LEFT JOIN the facts on a half-open range per day (or on date_trunc), counting the fact rows so empty days return 0.' }
  ],
  exercises: [
    { task: 'For each project, show name, start_date, end_date and its duration in days; for open-ended projects compute the duration up to 2025-12-31.', solution: `SELECT name,
       start_date,
       end_date,
       coalesce(end_date, DATE '2025-12-31') - start_date AS duration_days
FROM   projects
ORDER  BY id;`, run: true },
    { task: 'Count employees hired per year (using extract), oldest year first.', solution: `SELECT extract(year FROM hire_date)::int AS hire_year, count(*) AS hires
FROM   employees
GROUP  BY 1
ORDER  BY 1;`, run: true },
    { task: 'In UTC, list the number of payments per hour of day (0–23) for successful payments, busiest hours first.', solution: `SET TimeZone = 'UTC';
SELECT extract(hour FROM paid_at)::int AS hour_of_day, count(*) AS payments
FROM   payments
WHERE  status = 'success'
GROUP  BY 1
ORDER  BY payments DESC
LIMIT  5;`, run: true }
  ],
  challenge: { task: 'Build a quarterly revenue report for 2024 per customer country, where the quarter boundary is evaluated in India time (Asia/Kolkata). Show quarter start date, country, number of non-cancelled orders and revenue.', hint: 'date_trunc(\'quarter\', order_date, \'Asia/Kolkata\'), and filter 2024 with a half-open range interpreted in Asia/Kolkata.', solution: `SELECT (date_trunc('quarter', o.order_date, 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::date AS quarter_start,
       c.country,
       count(*)              AS orders,
       sum(o.total_amount)   AS revenue
FROM   orders o
JOIN   customers c ON c.id = o.customer_id
WHERE  o.status <> 'cancelled'
  AND  o.order_date >= TIMESTAMP '2024-01-01' AT TIME ZONE 'Asia/Kolkata'
  AND  o.order_date <  TIMESTAMP '2025-01-01' AT TIME ZONE 'Asia/Kolkata'
GROUP  BY 1, 2
ORDER  BY 1, revenue DESC;`, run: true },
  related: ['data-types-numeric', 'querying-order-limit-pagination', 'aggregations', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Which type should store the moment an order was placed?', options: ['date', 'timestamp', 'timestamptz', 'text'], answer: 2, explain: 'An event is an absolute instant: timestamptz.' },
    { type: 'predict', q: 'What does this return?', code: `SELECT DATE '2025-01-31' + INTERVAL '1 month';`, options: ['2025-03-03', '2025-02-28 00:00:00', '2025-02-31', 'An error'], answer: 1, explain: 'Calendar month arithmetic clamps to the last day of February (and date + interval yields a timestamp).' },
    { type: 'tf', q: 'timestamptz stores the original time zone name supplied on input.', answer: false, explain: 'It stores a UTC instant; the displayed offset reflects the session TimeZone.' },
    { type: 'bug', q: 'This "orders on 31 March" filter misses orders. Why?', code: `WHERE order_date BETWEEN '2025-03-31' AND '2025-03-31'`, options: ['BETWEEN is exclusive', 'Both literals mean midnight; use >= \'2025-03-31\' AND < \'2025-04-01\'', 'Dates need DATE keyword', 'order_date is a date'], answer: 1, explain: 'Only orders at exactly 00:00:00 match; use a half-open range.' },
    { type: 'mcq', q: 'Which function returns the actual current time even inside a long transaction?', options: ['now()', 'current_timestamp', 'clock_timestamp()', 'transaction_timestamp()'], answer: 2, explain: 'now(), current_timestamp and transaction_timestamp() are frozen at transaction start.' }
  ]
},
{
  id: 'data-types-special',
  module: 'data-types',
  title: 'Special Types: uuid, bytea, inet/cidr/macaddr, Geometric, json/jsonb, Arrays, Ranges and enum',
  level: 2,
  minutes: 26,
  summary: 'A guided tour of PostgreSQL\'s rich built-in types — what each is for, how to query it, and a "when to use which" decision table.',
  objectives: [
    'Store identifiers with uuid and binary data with bytea',
    'Validate and query network addresses with inet, cidr and macaddr',
    'Use geometric types (point, line, lseg, box, circle, polygon) and know when PostGIS is needed',
    'Read jsonb documents and arrays with the basic operators (->, ->>, @>, ANY, [])',
    'Model periods with range types (int4range, daterange, tstzrange) and prevent overlaps with exclusion constraints',
    'Create and evolve enum types, and choose between enum, CHECK and lookup tables'
  ],
  concept: `
<p>Beyond numbers, text and time, PostgreSQL ships with types that model real-world concepts directly. Using them means the database validates the data, offers purpose-built operators and indexes, and stores it compactly.</p>
<p><strong>Analogy: a professional toolbox.</strong> You can drive a screw with a hammer (store everything as text), but a screwdriver (a dedicated type) does it faster, cleaner and without damaging the wood. An IP address as <code>inet</code> knows what a subnet is; as text it is just characters.</p>
<h4>When to use which</h4>
<table>
<tr><th>Type</th><th>Stores</th><th>Key operators / functions</th><th>Typical use</th><th>Avoid when</th></tr>
<tr><td><code>uuid</code></td><td>128-bit identifier (16 bytes)</td><td><code>gen_random_uuid()</code>, <code>uuidv7()</code> (18+)</td><td>Distributed/public IDs</td><td>Storing as text (36+ bytes)</td></tr>
<tr><td><code>bytea</code></td><td>Raw bytes</td><td><code>decode/encode</code>, <code>sha256()</code>, <code>length</code></td><td>Hashes, small files, encrypted blobs, signatures</td><td>Large files (videos, scans) — use object storage + URL</td></tr>
<tr><td><code>inet</code> / <code>cidr</code></td><td>IPv4/IPv6 host (+mask) / network</td><td><code>&lt;&lt;</code> (contained in), <code>&gt;&gt;</code>, <code>host()</code>, <code>network()</code>, <code>masklen()</code></td><td>Login audit IPs, firewall rules, geo-IP ranges</td><td>—</td></tr>
<tr><td><code>macaddr</code> / <code>macaddr8</code></td><td>Hardware addresses</td><td><code>trunc()</code> (vendor prefix)</td><td>IoT device registries</td><td>—</td></tr>
<tr><td><code>point</code>, <code>line</code>, <code>lseg</code>, <code>box</code>, <code>circle</code>, <code>polygon</code>, <code>path</code></td><td>2-D Euclidean geometry</td><td><code>&lt;-&gt;</code> distance, <code>@&gt;</code> contains, <code>&amp;&amp;</code> overlaps, <code>area()</code></td><td>Floor plans, CAD-like 2-D shapes, simple nearest-neighbour</td><td>Real maps on the Earth — use PostGIS <span class="tag ext">extension</span> (geography, SRIDs, metres)</td></tr>
<tr><td><code>jsonb</code> (and <code>json</code>)</td><td>JSON documents (binary, normalised / verbatim text)</td><td><code>-&gt;</code>, <code>-&gt;&gt;</code>, <code>@&gt;</code>, <code>?</code>, <code>jsonb_path_query</code></td><td>Flexible attributes, API payloads, per-tenant custom fields</td><td>Core relational data you filter/join on constantly</td></tr>
<tr><td>Arrays (<code>int[]</code>, <code>text[]</code>)</td><td>Ordered lists of one type</td><td><code>[i]</code>, <code>ANY</code>, <code>@&gt;</code>, <code>&amp;&amp;</code>, <code>unnest</code>, <code>array_agg</code></td><td>Tags, small fixed lists, function parameters</td><td>Lists of foreign keys (no FK support) — use a junction table</td></tr>
<tr><td>Ranges (<code>int4range</code>, <code>int8range</code>, <code>numrange</code>, <code>daterange</code>, <code>tsrange</code>, <code>tstzrange</code>) + multiranges</td><td>An interval with inclusive/exclusive bounds</td><td><code>@&gt;</code> contains, <code>&amp;&amp;</code> overlaps, <code>*</code> intersection, <code>lower/upper</code></td><td>Bookings, validity periods, price tiers, shifts</td><td>—</td></tr>
<tr><td><code>enum</code></td><td>One of a fixed, ordered list of labels (4 bytes)</td><td>Ordering by declaration, <code>enum_range()</code></td><td>Stable statuses/priorities that rarely change</td><td>Values that change often or need attributes — use a lookup table or text + CHECK</td></tr>
</table>
<h4>json vs jsonb</h4>
<p><code>json</code> stores the exact input text (whitespace, key order, duplicate keys) and re-parses on every access. <code>jsonb</code> stores a decomposed binary form: duplicate keys removed (last wins), keys sorted, faster to query, indexable with GIN. Use <code>jsonb</code> unless you must preserve the exact original text. Deep coverage is in the JSONB module.</p>
<h4>Ranges</h4>
<p>A range has a lower and upper bound, each inclusive <code>[</code> or exclusive <code>(</code>/<code>)</code>. The canonical form for discrete types is <code>[lower, upper)</code> — half-open, exactly like the date filtering advice. Combined with an <strong>exclusion constraint</strong>, ranges let the database guarantee that no two bookings for the same room overlap — something a UNIQUE constraint cannot express.</p>`,
  why: `
<p>Each of these types replaces fragile application code. Without <code>inet</code>, "is this login from our office subnet?" is string parsing; without ranges, "does this booking overlap another?" is a race-condition-prone query in application code; without <code>jsonb</code>, per-customer custom fields become an entity-attribute-value nightmare. Native types give validation on input, correct semantics, specialised operators and index support (GiST, GIN, SP-GiST) — so the database can both enforce and accelerate these rules.</p>`,
  useCase: `
<p><strong>A co-working company with 40 centres</strong> stores meeting-room bookings as <code>tstzrange</code> with an exclusion constraint <code>EXCLUDE USING gist (room_id WITH =, during WITH &amp;&amp;)</code> — double-bookings became impossible even when two members click "Book" in the same millisecond. Member badges use <code>uuid</code> (printed as QR codes), Wi-Fi logins record <code>inet</code> addresses and are matched to each centre's <code>cidr</code> range for occupancy analytics, door controllers are registered by <code>macaddr</code>, and each centre's custom amenities ("standing desks", "phone booths: 4") live in a <code>jsonb</code> column. The membership <code>tier</code> is an <code>enum</code> ('day_pass' &lt; 'flex' &lt; 'dedicated' &lt; 'private_office') so it sorts naturally.</p>`,
  internals: `
<p><code>uuid</code> is 16 raw bytes compared with memcmp. <code>bytea</code> is a varlena (TOASTed when large; values over 1&nbsp;GB are impossible). <code>inet</code> stores family, mask length and up to 16 address bytes; B-tree indexes support equality/ordering and GiST (<code>inet_ops</code>) supports subnet containment. Geometric types are stored as float8 coordinates; GiST and SP-GiST indexes accelerate containment and <code>&lt;-&gt;</code> nearest-neighbour ordering. <code>jsonb</code> stores a tree with sorted keys and offsets for binary search; GIN indexes (<code>jsonb_ops</code>, <code>jsonb_path_ops</code>) power <code>@&gt;</code>. Arrays store dimensions plus a null bitmap and elements; GIN indexes support <code>@&gt;</code>/<code>&amp;&amp;</code>. Range types store both bounds plus flags; GiST/SP-GiST index <code>&amp;&amp;</code> and <code>@&gt;</code>; exclusion constraints are enforced through a GiST index (equality on scalar columns like <code>room</code> needs the <code>btree_gist</code> <span class="tag ext">extension</span>). Enum values are 4-byte OIDs referencing <code>pg_enum</code>, sorted by a float <code>enumsortorder</code> so values can be inserted between existing ones.</p>`,
  whenNot: `
<ul>
<li><strong>jsonb</strong>: not for core relational attributes you filter, join or constrain on — those deserve real columns with types and constraints.</li>
<li><strong>Arrays</strong>: not for references to other rows; not for lists that grow without bound or are updated element-by-element under concurrency.</li>
<li><strong>Geometric types</strong>: not for geographic coordinates on the Earth (distances in degrees are meaningless); use PostGIS.</li>
<li><strong>enum</strong>: not when labels change often, need translations/metadata, or must be removed (you cannot drop a value from an enum without recreating the type).</li>
<li><strong>bytea</strong>: not for large media; use object storage and keep the key, size and checksum in PostgreSQL.</li>
</ul>`,
  syntax: `uuid      bytea      inet  cidr  macaddr  macaddr8
point  line  lseg  box  path  polygon  circle
json   jsonb
integer[]  text[]  ARRAY[1,2,3]  '{a,b}'::text[]
int4range  int8range  numrange  daterange  tsrange  tstzrange   (and *multirange)
CREATE TYPE name AS ENUM ('a', 'b', 'c');
ALTER TYPE name ADD VALUE 'd' [ BEFORE | AFTER 'c' ];

-- operators
inet_col << '10.0.0.0/8'::cidr          -- is contained in subnet
p1 <-> p2                               -- distance
doc -> 'key'   doc ->> 'key'   doc @> '{"k":"v"}'
arr[1]   'x' = ANY (arr)   arr @> ARRAY['x']
range @> value   range && other_range
EXCLUDE USING gist (room WITH =, during WITH &&)`,
  examples: [
    { label: 'Basic', title: 'Network and binary types',
      sql: `SELECT '192.168.10.25'::inet                               AS ip,
       '192.168.10.0/24'::cidr                             AS office_net,
       '192.168.10.25'::inet << '192.168.10.0/24'::cidr    AS from_office,
       host('10.1.2.3/16'::inet)                           AS host_part,
       network('10.1.2.3/16'::inet)                        AS network_part,
       family('2001:db8::1'::inet)                         AS ip_family,
       '08:00:2b:01:02:03'::macaddr                        AS mac,
       trunc('08:00:2b:01:02:03'::macaddr)                 AS vendor_prefix;

SELECT decode('48656c6c6f', 'hex')                         AS raw_bytes,
       convert_from(decode('48656c6c6f', 'hex'), 'UTF8')   AS as_text,
       encode('PostgreSQL'::bytea, 'base64')               AS base64,
       encode(sha256('PostgreSQL'::bytea), 'hex')          AS sha256_hex;`,
      explain: `<ul><li><code>inet</code> validates addresses on input (<code>'999.1.1.1'::inet</code> is rejected) and understands subnets: <code>&lt;&lt;</code> means "is contained within".</li>
<li><code>family()</code> returns 4 or 6; IPv6 works with the same operators.</li>
<li><code>trunc(macaddr)</code> keeps the OUI (manufacturer) prefix.</li>
<li><code>bytea</code> displays in hex (<code>\\x...</code>); <code>encode</code>/<code>decode</code> convert to/from hex and base64. <code>sha256()</code> is core since PostgreSQL 11 — ideal for checksums of files kept in object storage.</li></ul>`,
      output: ` ip            | office_net      | from_office | host_part | network_part | ip_family | mac               | vendor_prefix
---------------+-----------------+-------------+-----------+--------------+-----------+-------------------+-------------------
 192.168.10.25 | 192.168.10.0/24 | t           | 10.1.2.3  | 10.1.0.0/16  |         6 | 08:00:2b:01:02:03 | 08:00:2b:00:00:00
(1 row)

 raw_bytes    | as_text | base64           | sha256_hex
--------------+---------+------------------+------------------------------------------------------------------
 \\x48656c6c6f | Hello   | UG9zdGdyZVNRTA== | cc52d03280b7034c8e3653d2748ebd489a873ef4bbc89cb187fbfcabfbbf6873
(1 row)`, run: true },
    { label: 'Intermediate', title: 'jsonb, arrays and geometric types in company_db',
      sql: `-- jsonb attributes and text[] tags on products
SELECT name,
       attributes ->> 'brand'                      AS brand,
       (attributes ->> 'warranty_months')::int     AS warranty_months,
       attributes -> 'specs' ->> 'weight_kg'       AS weight_kg,
       attributes @> '{"color": "black"}'          AS is_black,
       tags,
       tags[1]                                     AS first_tag,     -- arrays are 1-based
       'office' = ANY (tags)                       AS office_item
FROM   products
WHERE  id <= 4
ORDER  BY id;

SELECT count(*) FILTER (WHERE attributes @> '{"brand": "Acme"}') AS acme_products,
       count(*) FILTER (WHERE tags @> ARRAY['sale'])              AS on_sale
FROM   products;

-- 2-D geometry (plane coordinates, not Earth distances!)
SELECT point(3, 4) <-> point(0, 0)                               AS distance,
       circle(point(0, 0), 5) @> point(3, 4)                     AS inside_circle,
       '((0,0),(4,0),(4,3),(0,3))'::polygon @> point(1, 1)       AS inside_polygon,
       area(box(point(0, 0), point(4, 3)))                       AS box_area;`,
      explain: `<ul><li><code>-&gt;</code> returns <code>jsonb</code>, <code>-&gt;&gt;</code> returns <code>text</code> (cast it for numbers). <code>@&gt;</code> tests containment — "does the document contain this sub-document?" — and is what a GIN index accelerates.</li>
<li>Arrays are 1-based; <code>= ANY(arr)</code> tests membership, <code>@&gt;</code> tests "contains all of".</li>
<li>Geometric types work on a flat plane: perfect for floor plans or game maps. For latitude/longitude on Earth, use PostGIS.</li></ul>`,
      output: ` name           | brand  | warranty_months | weight_kg | is_black | tags                | first_tag  | office_item
----------------+--------+-----------------+-----------+----------+---------------------+------------+-------------
 Monitor Air 1  | Zenit  |              12 | 12.4      | f        | {new}               | new        | f
 Keyboard Max 2 | Orbit  |              24 | 13.3      | f        | {office,sale}       | office     | t
 Mouse Lite 3   | Nimbus |               6 | 11.7      | t        | {bestseller,office} | bestseller | t
 Headset Plus 4 | Acme   |              12 | 2.5       | f        | {new}               | new        | f
(4 rows)

 acme_products | on_sale
---------------+---------
            25 |      33
(1 row)

 distance | inside_circle | inside_polygon | box_area
----------+---------------+----------------+----------
        5 | t             | t              |       12
(1 row)`, run: true },
    { label: 'Advanced', title: 'Ranges with an exclusion constraint, and enums',
      sql: `-- Range basics
SELECT int4range(10, 20)                                AS r,            -- [10,20)
       int4range(10, 20) @> 20                          AS contains_20,  -- upper bound excluded
       int4range(10, 20) && int4range(19, 30)           AS overlaps,
       int4range(10, 20) * int4range(15, 30)            AS intersection,
       int4range(1, 10, '[]')                           AS normalized,   -- becomes [1,11)
       daterange('2025-01-01', '2025-04-01') @> DATE '2025-03-31' AS in_q1;

-- No double bookings, guaranteed by the database
CREATE EXTENSION IF NOT EXISTS btree_gist;          -- lets GiST handle "room WITH ="
SET TimeZone = 'Asia/Kolkata';
CREATE TABLE room_bookings (
  id      int       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room    text      NOT NULL,
  during  tstzrange NOT NULL,
  EXCLUDE USING gist (room WITH =, during WITH &&)
);
INSERT INTO room_bookings (room, during) VALUES
  ('Board Room', '[2025-11-03 10:00+05:30, 2025-11-03 11:00+05:30)'),
  ('Board Room', '[2025-11-03 11:00+05:30, 2025-11-03 12:00+05:30)');  -- touching, not overlapping
-- ('Board Room', '[2025-11-03 10:30+05:30, 2025-11-03 11:30+05:30)') would raise:
-- ERROR: conflicting key value violates exclusion constraint "room_bookings_room_during_excl"
SELECT room, during FROM room_bookings ORDER BY lower(during);

-- Enum: a small, ordered, fixed vocabulary
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TABLE tickets_e (
  id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title    text NOT NULL,
  priority ticket_priority NOT NULL DEFAULT 'medium'
);
INSERT INTO tickets_e (title, priority)
VALUES ('Typo', 'low'), ('DB down', 'critical'), ('Slow page', 'high'), ('New field', DEFAULT);
SELECT title, priority FROM tickets_e WHERE priority >= 'high' ORDER BY priority DESC;
SELECT enum_range(NULL::ticket_priority) AS allowed_values;`,
      explain: `<ul><li>Ranges default to half-open <code>[lower, upper)</code>, so back-to-back bookings (10–11 and 11–12) don't overlap. Discrete ranges are normalised: <code>[1,10]</code> becomes <code>[1,11)</code>.</li>
<li>The <strong>exclusion constraint</strong> says: no two rows may have equal <code>room</code> AND overlapping <code>during</code>. It is enforced atomically, even under concurrent inserts — application-level "check then insert" cannot guarantee that.</li>
<li><code>btree_gist</code> (an <span class="tag ext">extension</span> shipped with PostgreSQL) supplies GiST support for the scalar equality on <code>room</code>.</li>
<li>Enums compare by declaration order, so <code>priority &gt;= 'high'</code> means high or critical. Add values with <code>ALTER TYPE ... ADD VALUE</code>; removing or renaming-by-reorder requires recreating the type.</li></ul>`,
      output: ` r       | contains_20 | overlaps | intersection | normalized | in_q1
---------+-------------+----------+--------------+------------+-------
 [10,20) | f           | t        | [15,20)      | [1,11)     | t
(1 row)

 room       | during
------------+-----------------------------------------------------------
 Board Room | ["2025-11-03 10:00:00+05:30","2025-11-03 11:00:00+05:30")
 Board Room | ["2025-11-03 11:00:00+05:30","2025-11-03 12:00:00+05:30")
(2 rows)

 title     | priority
-----------+----------
 DB down   | critical
 Slow page | high
(2 rows)

 allowed_values
----------------------------
 {low,medium,high,critical}
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Everything as text
CREATE TABLE logins_bad (user_id int, ip text, valid_from text, valid_to text);
INSERT INTO logins_bad VALUES (1, '192.168.10.25', '2025-01-01', '2025-12-31'),
                              (2, '192.168.010.025', 'tomorrow?', '31/12/2025');   -- all accepted
SELECT count(*) AS from_office
FROM   logins_bad
WHERE  ip LIKE '192.168.10.%';                 -- misses the zero-padded variant`,
      why: 'Text accepts invalid and inconsistent values, string matching is not network-aware, and the validity period cannot be compared or checked for overlaps.', run: true },
    good: { sql: `CREATE TABLE logins_good (
  user_id  int       NOT NULL,
  ip       inet      NOT NULL,
  validity daterange NOT NULL
);
INSERT INTO logins_good VALUES (1, '192.168.10.25', '[2025-01-01, 2026-01-01)');
SELECT count(*) AS from_office
FROM   logins_good
WHERE  ip << '192.168.10.0/24'
  AND  validity @> DATE '2025-06-15';`,
      why: 'inet rejects malformed addresses and understands subnets; daterange gives correct containment/overlap semantics and can be indexed with GiST.', run: true }
  },
  mistakes: [
    'Storing IPs, UUIDs, dates or JSON as plain text and losing validation and operators.',
    'Using <code>json</code> instead of <code>jsonb</code> and then wondering why queries are slow and GIN indexes are impossible.',
    'Putting foreign keys inside arrays or jsonb — no referential integrity.',
    'Computing Earth distances with <code>point &lt;-&gt; point</code> on latitude/longitude (results in degrees, distorted) instead of PostGIS.',
    'Using enums for values that the business changes monthly — you cannot easily remove or rename-by-reordering values.',
    'Checking for overlapping bookings in application code without a constraint — two concurrent requests both pass the check.'
  ],
  best: [
    'Prefer a dedicated type whenever one exists (uuid, inet, daterange, jsonb, timestamptz).',
    'Use <code>jsonb</code> for genuinely variable attributes; promote frequently filtered keys to real columns.',
    'Use ranges plus exclusion constraints for bookings, schedules and validity periods.',
    'Use arrays for small, self-contained lists (tags); use junction tables for relationships.',
    'Choose enum for small, stable, ordered vocabularies; text + CHECK or a lookup table when values evolve.',
    'Keep large binary objects outside the database; store metadata and checksums in PostgreSQL.'
  ],
  performance: `
<p>Special types often unlock special indexes: GIN for <code>jsonb @&gt;</code> and array containment, GiST/SP-GiST for ranges, geometry and <code>inet</code> containment, plus exclusion constraints. Without them, these predicates require sequential scans. <code>uuid</code> (16 bytes) is far smaller than its text form (37 bytes with header). Large <code>jsonb</code>/<code>bytea</code> values are TOASTed: reading one key from a 100&nbsp;kB document still decompresses the whole value — keep documents reasonably small and extract hot keys into columns.</p>`,
  security: `
<p><code>inet</code>/<code>cidr</code> make IP allow-lists and audit analysis reliable (<code>WHERE ip &lt;&lt; ANY (allowed_networks)</code>). Store password hashes and secrets in <code>text</code> produced by a strong algorithm (e.g. <code>crypt()</code> with bcrypt from the pgcrypto <span class="tag ext">extension</span>, or hashed in the application) — never plain text — and remember <code>md5()</code>/<code>sha256()</code> alone are not password hashes. Treat jsonb from clients as untrusted: validate structure with CHECK constraints (<code>jsonb_typeof</code>, required keys) before relying on it.</p>`,
  interview: [
    { q: 'json or jsonb — which and why?', a: 'jsonb in almost all cases: it stores a parsed binary representation, removes duplicate keys, supports containment and existence operators efficiently, and can be indexed with GIN. json preserves the exact input text (key order, whitespace, duplicates) and must be re-parsed on every access, so it is only useful when the original text must be kept verbatim.' },
    { q: 'How do you prevent overlapping bookings in PostgreSQL?', a: 'Store the booking period as a range type such as tstzrange and add an exclusion constraint EXCLUDE USING gist (room_id WITH =, during WITH &&), using the btree_gist extension for the scalar equality. The database then rejects overlapping rows atomically, even under concurrency.' },
    { q: 'What are the downsides of enum types?', a: 'Values cannot be dropped or reordered without recreating the type, adding values has restrictions inside transactions, labels cannot carry extra attributes, and changes require DDL deployments. For evolving vocabularies a lookup table with a foreign key or text with a CHECK constraint is more flexible.' },
    { q: 'When should you use PostGIS rather than the built-in geometric types?', a: 'Whenever coordinates are on the Earth (latitude/longitude) or you need projections, real distances in metres, spatial reference systems, or standard GIS functions. The built-in types are Euclidean 2-D geometry suitable for planar problems.' }
  ],
  exercises: [
    { task: 'List the distinct brands in products.attributes with the number of products per brand.', solution: `SELECT attributes ->> 'brand' AS brand, count(*) AS products
FROM   products
GROUP  BY 1
ORDER  BY products DESC, brand;`, run: true },
    { task: 'Find products that have both the "office" and "sale" tags, showing sku, name and tags.', solution: `SELECT sku, name, tags
FROM   products
WHERE  tags @> ARRAY['office', 'sale']
ORDER  BY id
LIMIT  10;`, run: true },
    { task: 'Using projects, build a daterange for each project (start_date to end_date, open-ended if end_date is NULL) and list the projects that were running on 2024-10-01.', solution: `SELECT name, daterange(start_date, end_date) AS period
FROM   projects
WHERE  daterange(start_date, end_date) @> DATE '2024-10-01'
ORDER  BY start_date;`, run: true }
  ],
  challenge: { task: 'Create a table price_tiers(product_id, qty_range int4range, unit_price numeric) where tiers for the same product may not overlap (exclusion constraint). Insert tiers [1,10), [10,50), [50,) for product 1 and query the unit price for an order of 25 units.', hint: 'EXCLUDE USING gist (product_id WITH =, qty_range WITH &&) needs btree_gist; query with qty_range @> 25.', solution: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE price_tiers (
  product_id int        NOT NULL REFERENCES products (id),
  qty_range  int4range  NOT NULL,
  unit_price numeric(10,2) NOT NULL CHECK (unit_price > 0),
  EXCLUDE USING gist (product_id WITH =, qty_range WITH &&)
);
INSERT INTO price_tiers VALUES
  (1, '[1,10)',  5004.84),
  (1, '[10,50)', 4750.00),
  (1, '[50,)',   4500.00);

SELECT unit_price, 25 * unit_price AS order_value
FROM   price_tiers
WHERE  product_id = 1 AND qty_range @> 25;`, run: true },
  related: ['data-types-date-time', 'jsonb', 'arrays', 'constraints', 'database-design-surrogate-natural-keys'],
  quiz: [
    { type: 'predict', q: 'What does this return?', code: `SELECT int4range(1, 5) @> 5;`, options: ['true', 'false', 'NULL', 'An error'], answer: 1, explain: 'The default bound form is [1,5): the upper bound is exclusive.' },
    { type: 'mcq', q: 'Which operator checks that an inet address is inside a subnet?', options: ['@>', '<<', '&&', '->'], answer: 1, explain: 'inet << cidr means "is contained within" (<<= also allows equality).' },
    { type: 'tf', q: 'jsonb keeps duplicate keys and the original key order.', answer: false, explain: 'jsonb normalises: the last duplicate wins and keys are stored sorted; json keeps the text verbatim.' },
    { type: 'design', q: 'A hotel must never double-book a room. Best design?', options: ['UNIQUE (room_id, check_in)', 'Application check before insert', 'daterange stay + EXCLUDE USING gist (room_id WITH =, stay WITH &&)', 'A trigger that sleeps'], answer: 2, explain: 'Only an exclusion constraint on ranges enforces non-overlap atomically.' },
    { type: 'bug', q: 'Why is this design problematic?', code: `CREATE TABLE teams (id int PRIMARY KEY, member_ids int[]);`, options: ['Arrays cannot hold ints', 'Arrays cannot have foreign keys, so member_ids may reference non-existent employees; use a junction table', 'int[] is too large', 'Primary key missing'], answer: 1, explain: 'Relationships belong in a junction table with FKs.' }
  ]
}
]);

/* ============================ MODULE: crud ============================ */
PGM.addLessons([
{
  id: 'crud-insert',
  module: 'crud',
  title: 'INSERT: Single Rows, Multi-Row, INSERT ... SELECT, DEFAULT and RETURNING',
  level: 1,
  minutes: 20,
  summary: 'Add data correctly and efficiently: explicit column lists, multi-row VALUES, INSERT ... SELECT, DEFAULT values, RETURNING generated keys, and inserting related rows in one statement.',
  objectives: [
    'Write INSERT statements with an explicit column list',
    'Insert many rows with one multi-row VALUES statement or INSERT ... SELECT',
    'Use DEFAULT, DEFAULT VALUES and column defaults deliberately',
    'Get generated ids and computed values back with RETURNING',
    'Insert a parent row and its children atomically with data-modifying CTEs',
    'Choose the right bulk-loading method (multi-row INSERT vs COPY)'
  ],
  concept: `
<p><code>INSERT</code> adds new rows to a table. Each row must satisfy every constraint — types, <code>NOT NULL</code>, <code>CHECK</code>, <code>UNIQUE</code>, foreign keys — or the whole statement fails and nothing is inserted.</p>
<p><strong>Analogy: filling in a registration form at a clinic.</strong> You fill in the boxes you know (the column list), leave "Registration number" and "Date" for the receptionist to stamp (identity and defaults), and the receptionist hands you a token with your new number on it (<code>RETURNING</code>). A family registering together submits one bundle of forms (multi-row insert), and a hospital transferring patients sends a batch copied from its own register (<code>INSERT ... SELECT</code>).</p>
<h4>Forms of INSERT</h4>
<ul>
<li><strong>Single row</strong>: <code>INSERT INTO t (a, b) VALUES (1, 'x');</code></li>
<li><strong>Multi-row</strong>: <code>VALUES (1,'x'), (2,'y'), (3,'z')</code> — one statement, one round trip, one transaction.</li>
<li><strong>From a query</strong>: <code>INSERT INTO t (a, b) SELECT ... FROM ...</code> — copy, transform or aggregate existing data entirely inside the server.</li>
<li><strong>Defaults</strong>: omit a column, or write <code>DEFAULT</code> in its position; <code>INSERT INTO t DEFAULT VALUES</code> inserts a row of all defaults.</li>
<li><strong>RETURNING</strong>: <code>RETURNING id, created_at</code> or <code>RETURNING *</code> returns the inserted rows, including generated values, in the same round trip.</li>
<li><strong>Upserts</strong> (<code>ON CONFLICT</code>) are covered in their own lesson.</li>
</ul>
<h4>Always list the columns</h4>
<p><code>INSERT INTO employees VALUES (DEFAULT, 'Neha', ...)</code> depends on the table's physical column order. When someone adds or reorders a column, the statement breaks or — worse — silently puts values in the wrong columns if types happen to match. An explicit column list makes inserts robust and self-documenting.</p>
<h4>Command tag</h4>
<p>psql shows <code>INSERT 0 3</code>: the <code>0</code> is a legacy OID field (always 0 nowadays), the <code>3</code> is the number of rows inserted.</p>`,
  why: `
<p>Inserting is how every fact enters the system, so correctness matters more than cleverness: explicit columns, constraint-checked values and atomic multi-row operations prevent partial or misaligned data. Efficiency matters at scale: one multi-row INSERT of 1,000 rows is typically 10–50× faster than 1,000 single-row INSERTs in autocommit mode, because it saves network round trips, per-statement parsing/planning and per-transaction WAL flushes. <code>RETURNING</code> removes the need for racy "insert then SELECT max(id)" patterns.</p>`,
  useCase: `
<p><strong>An e-commerce checkout</strong> must create an order and its line items together. Using a data-modifying CTE, the API sends one statement: insert the order (computing the total from the cart and current prices), then insert all items referencing the new order id, returning everything the confirmation page needs. If any item violates a constraint (e.g. an unknown product id), the whole statement fails and no orphan order exists. The nightly loyalty job uses <code>INSERT INTO vip_customers SELECT ... GROUP BY customer_id HAVING sum(total_amount) &gt; 4500000</code> to promote customers without moving data out of the database.</p>`,
  internals: `
<p>For each new row, PostgreSQL evaluates defaults (calling <code>nextval</code> for identity columns), runs <code>BEFORE INSERT</code> triggers, checks <code>NOT NULL</code>/<code>CHECK</code> constraints, finds space in a heap page (using the free space map), writes the tuple with <code>xmin</code> = the current transaction id, inserts an entry into <em>every</em> index of the table (unique indexes check for duplicates at this point), queues FK checks and <code>AFTER</code> triggers, and writes WAL records. Nothing is visible to other sessions until <code>COMMIT</code>. The more indexes a table has, the more expensive each insert — a reason not to over-index write-heavy tables. All CTEs in one statement see the same snapshot, which is why a sibling CTE or the main query cannot "see" rows inserted by another CTE except through <code>RETURNING</code>.</p>`,
  whenNot: `
<ul>
<li>For loading millions of rows from files, use <code>COPY</code> (server-side) or psql's <code>\\copy</code> / your driver's COPY API — it is several times faster than even multi-row INSERT.</li>
<li>Don't insert row-by-row in a loop from application code in autocommit mode; batch them.</li>
<li>Don't use <code>INSERT ... SELECT</code> to duplicate data you could reference with a join or view.</li>
<li>If a row may already exist, plain INSERT will fail with a unique violation — use <code>INSERT ... ON CONFLICT</code> (next lessons) instead of "SELECT then INSERT", which races under concurrency.</li>
</ul>`,
  syntax: `INSERT INTO table_name [ AS alias ] ( column [, ...] )
  { VALUES ( expr | DEFAULT [, ...] ) [, ( ... ) ...]
  | query
  | DEFAULT VALUES }
  [ OVERRIDING { SYSTEM | USER } VALUE ]
  [ ON CONFLICT ... ]
  [ RETURNING { * | expr [ AS name ] } [, ...] ];

COPY table_name ( column [, ...] ) FROM 'file' WITH (FORMAT csv, HEADER true);   -- server-side file
\\copy table_name FROM 'local.csv' WITH (FORMAT csv, HEADER)                       -- psql, client file`,
  examples: [
    { label: 'Basic', title: 'Single-row and multi-row INSERT with RETURNING',
      sql: `-- One row; id and created_at come from identity/default
INSERT INTO departments (name, location, budget)
VALUES ('Legal', 'Mumbai', 800000)
RETURNING id, name, created_at IS NOT NULL AS has_created_at;

-- Several rows in one statement (one round trip, all-or-nothing)
INSERT INTO customers (name, email, country, city, segment)
VALUES ('Tata Motors Procurement', 'procurement@tatamotors.example', 'India',     'Pune',      'enterprise'),
       ('Lim Electronics',         'buy@limelec.example',            'Singapore', 'Singapore', 'smb'),
       ('Ava Brown',               'ava.brown@example.com',          'UK',        'London',    'consumer')
RETURNING id, name, segment;`,
      explain: `<p>The column list names only what we supply. <code>id</code> is generated, <code>created_at</code> defaults to <code>now()</code>. <code>RETURNING</code> sends back the new ids — no second query, no race with other sessions. If any of the three customer rows violated a constraint (say a duplicate email), none of them would be inserted.</p>
<p>The exact ids depend on how many values the sequences have already handed out — sequences are not rolled back, so after running other examples you may see higher numbers.</p>`,
      output: ` id | name  | has_created_at
----+-------+----------------
  9 | Legal | t
(1 row)

INSERT 0 1

 id  | name                    | segment
-----+-------------------------+------------
 501 | Tata Motors Procurement | enterprise
 502 | Lim Electronics         | smb
 503 | Ava Brown               | consumer
(3 rows)

INSERT 0 3`, run: true },
    { label: 'Intermediate', title: 'Defaults and INSERT ... SELECT',
      sql: `-- Omitted columns get their DEFAULT (stock 0, attributes '{}', tags '{}', created_at now())
INSERT INTO products (sku, name, category, price)
VALUES ('SKU-0101', 'Desk Lamp Pro', 'furniture', 2499.00)
RETURNING id, sku, price, stock, attributes, tags;

-- Derive rows from a query: promote high-value customers
CREATE TABLE vip_customers (
  customer_id    int           PRIMARY KEY REFERENCES customers (id),
  lifetime_value numeric(14,2) NOT NULL,
  qualified_at   timestamptz   NOT NULL DEFAULT now()
);

INSERT INTO vip_customers (customer_id, lifetime_value)
SELECT customer_id, sum(total_amount)
FROM   orders
WHERE  status <> 'cancelled'
GROUP  BY customer_id
HAVING sum(total_amount) > 4500000
RETURNING customer_id, lifetime_value;`,
      explain: `<ul><li>The product row shows defaults in action. Writing <code>DEFAULT</code> explicitly in a VALUES list is equivalent to omitting the column; writing <code>NULL</code> is not — it would violate <code>NOT NULL</code> on <code>stock</code>.</li>
<li><code>INSERT ... SELECT</code> runs entirely inside the server: no data travels to the client. The SELECT can join, filter and aggregate; its output columns map positionally to the column list.</li>
<li><code>qualified_at</code> is filled by its default.</li></ul>`,
      output: ` id  | sku      | price   | stock | attributes | tags
-----+----------+---------+-------+------------+------
 101 | SKU-0101 | 2499.00 |     0 | {}         | {}
(1 row)

 customer_id | lifetime_value
-------------+----------------
         220 |     5940193.48
          27 |     5416424.79
         469 |     5071543.17
         436 |     4590261.78
         178 |     4579508.68
         348 |     4682504.90
         235 |     4874310.00
         174 |     4724205.18
         140 |     5042144.69
(9 rows)`, run: true },
    { label: 'Advanced', title: 'Insert an order and its items atomically with data-modifying CTEs',
      sql: `WITH cart (product_id, qty) AS (
       VALUES (1, 2), (3, 1)                       -- what the customer is buying
     ),
     new_order AS (
       INSERT INTO orders (customer_id, status, order_date, total_amount)
       SELECT 7, 'pending', now(), sum(p.price * c.qty)
       FROM   cart c
       JOIN   products p ON p.id = c.product_id
       RETURNING id, total_amount
     )
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT n.id, p.id, c.qty, p.price                  -- snapshot today's price
FROM   new_order n
CROSS  JOIN cart c
JOIN   products p ON p.id = c.product_id
RETURNING order_id, product_id, quantity, unit_price,
          quantity * unit_price AS line_total;`,
      explain: `<p>One statement, one transaction:</p>
<ol><li><code>cart</code> is a constant table of (product, quantity).</li>
<li><code>new_order</code> inserts the order with the total computed from current prices and <code>RETURNING id</code>.</li>
<li>The main INSERT reads <code>new_order.id</code> from that RETURNING output and inserts one item per cart line, snapshotting the unit price.</li></ol>
<p>Gotcha: all parts of the statement share one snapshot, so a sibling CTE cannot <code>SELECT</code> from <code>orders</code> and see the new row — data flows between CTEs only through <code>RETURNING</code>. That is also why we compute the total up front instead of updating the order afterwards in the same statement.</p>`,
      output: ` order_id | product_id | quantity | unit_price | line_total
----------+------------+----------+------------+------------
     5001 |          1 |        2 |    5004.84 |   10009.68
     5001 |          3 |        1 |   27311.98 |   27311.98
(2 rows)

INSERT 0 2   -- and orders row 5001 has total_amount 37321.66`, run: true }
  ],
  compare: {
    bad: { sql: `-- Positional insert without a column list
INSERT INTO employees
VALUES (DEFAULT, 'Neha', 'Verma', 'neha.verma@company.com', 1, 1,
        'Engineer', 98000, '2025-11-03', DEFAULT)
RETURNING id, first_name, job_title;`,
      why: 'Depends on the physical column order. Adding a column (e.g. middle_name after first_name) breaks it — or silently shifts values into the wrong columns when types are compatible.', run: true },
    good: { sql: `INSERT INTO employees (first_name, last_name, email, department_id, manager_id,
                       job_title, salary, hire_date)
VALUES ('Neha', 'Verma', 'neha.verma@company.com', 1, 1,
        'Engineer', 98000, DATE '2025-11-03')
RETURNING id, first_name, job_title, is_active;`,
      why: 'Explicit columns are immune to column reordering/additions, document intent, and let defaults (id, is_active) apply naturally.', run: true }
  },
  mistakes: [
    'Omitting the column list and relying on physical column order.',
    'Fetching the new id with <code>SELECT max(id)</code> after inserting — another session may have inserted in between. Use <code>RETURNING</code>.',
    'Inserting thousands of rows one statement (and one commit) at a time.',
    'Passing <code>NULL</code> expecting the default to apply — only an omitted column or the <code>DEFAULT</code> keyword triggers the default.',
    'Building INSERT statements by string concatenation with user input — SQL injection. Use parameters (<code>$1, $2</code>).',
    'Expecting a CTE in the same statement to see rows inserted by another CTE via a normal SELECT.'
  ],
  best: [
    'Always specify the column list.',
    'Use <code>RETURNING</code> to get generated keys, defaults and computed columns.',
    'Batch inserts: multi-row VALUES (hundreds to a few thousand rows per statement) or COPY for bulk loads.',
    'Wrap related inserts (parent + children) in one transaction or one statement with data-modifying CTEs.',
    'Snapshot values that must not change later (unit price, tax rate, address) at insert time.',
    'Use parameterised statements from application code.'
  ],
  performance: `
<p>Insert cost ≈ heap write + one entry per index + WAL + constraint/trigger work. Rough guidance on commodity hardware: single-row autocommit inserts run in the low thousands per second per connection (each commit waits for a WAL flush); multi-row INSERT in one transaction reaches tens to hundreds of thousands of rows per second; <code>COPY</code> is faster still. For huge one-off loads into a new table: create it without secondary indexes, <code>COPY</code> the data, then build indexes and add FKs. <code>synchronous_commit = off</code> per session can speed bulk loads at the risk of losing the last few hundred milliseconds of commits on a crash (no corruption).</p>`,
  security: `
<p>Grant <code>INSERT</code> only on tables a role must write to; column-level grants (<code>GRANT INSERT (name, email) ON customers TO signup_role</code>) prevent clients from setting sensitive columns like <code>role</code> or <code>is_admin</code>. With <code>GENERATED ALWAYS AS IDENTITY</code>, clients cannot choose their own ids. Always use bind parameters; never interpolate user input into SQL text. Row-level security <code>WITH CHECK</code> policies can restrict which rows a role may insert (e.g. only its own <code>tenant_id</code>).</p>`,
  interview: [
    { q: 'How do you get the id of a row you just inserted in PostgreSQL?', a: 'Use INSERT ... RETURNING id. It returns generated identity values, defaults and computed columns atomically in the same statement. Alternatives such as currval() work per session but are clumsier, and SELECT max(id) is wrong under concurrency.' },
    { q: 'What are the fastest ways to load a lot of data?', a: 'COPY (or the driver\'s COPY protocol / psql \\copy) is fastest, followed by multi-row INSERT in large transactions. Also: load into tables without secondary indexes and add indexes/constraints afterwards, avoid per-row commits, and consider unlogged staging tables for intermediate data.' },
    { q: 'What happens if one row of a multi-row INSERT violates a constraint?', a: 'The whole statement fails and no rows from it are inserted, because each statement is atomic. Inside an explicit transaction the transaction becomes aborted until ROLLBACK (or ROLLBACK TO SAVEPOINT).' }
  ],
  exercises: [
    { task: 'Insert two new projects for the Research department (id 8) in one statement: "Project Quasar" (planned, starting 2026-01-05, budget 450000) and "Project Rigel" (active, starting 2025-11-01, budget 300000). Return their ids and names.', solution: `INSERT INTO projects (name, department_id, start_date, budget, status)
VALUES ('Project Quasar', 8, DATE '2026-01-05', 450000, 'planned'),
       ('Project Rigel',  8, DATE '2025-11-01', 300000, 'active')
RETURNING id, name;`, run: true },
    { task: 'Create a table customer_archive with the same columns as customers (use CREATE TABLE ... (LIKE customers INCLUDING DEFAULTS)) and copy all German customers into it with INSERT ... SELECT, returning how many rows were copied via a count.', solution: `CREATE TABLE customer_archive (LIKE customers INCLUDING DEFAULTS);
INSERT INTO customer_archive
SELECT * FROM customers WHERE country = 'Germany';
SELECT count(*) AS archived FROM customer_archive;`, run: true },
    { task: 'Assign employee 9 to project 5 as a reviewer with 20% allocation and return the inserted row.', solution: `INSERT INTO employee_projects (employee_id, project_id, role, allocation_pct)
VALUES (9, 5, 'reviewer', 20)
RETURNING *;`, run: true }
  ],
  challenge: { task: 'In a single statement, create a new customer "Riya Sen" (riya.sen@example.com, India, Kolkata, consumer) and an order for her with status pending containing 3 units of product 2, with total_amount computed from the product price. Return the customer id, order id and total.', hint: 'Chain two data-modifying CTEs: insert the customer RETURNING id, then insert the order SELECTing from that CTE joined to products.', solution: `WITH new_customer AS (
       INSERT INTO customers (name, email, country, city, segment)
       VALUES ('Riya Sen', 'riya.sen@example.com', 'India', 'Kolkata', 'consumer')
       RETURNING id
     ),
     new_order AS (
       INSERT INTO orders (customer_id, status, order_date, total_amount)
       SELECT nc.id, 'pending', now(), p.price * 3
       FROM   new_customer nc, products p
       WHERE  p.id = 2
       RETURNING id, customer_id, total_amount
     )
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT no.id, p.id, 3, p.price
FROM   new_order no JOIN products p ON p.id = 2
RETURNING (SELECT customer_id FROM new_order) AS customer_id,
          order_id,
          (SELECT total_amount FROM new_order) AS total;`, run: true },
  related: ['crud-update', 'crud-upsert-merge', 'database-design-surrogate-natural-keys', 'transactions'],
  quiz: [
    { type: 'mcq', q: 'What does "INSERT 0 5" in psql mean?', options: ['0 errors, 5 warnings', 'OID 0 (legacy), 5 rows inserted', '5 rows failed', 'Transaction 0 inserted 5 rows'], answer: 1, explain: 'The first number is a legacy OID field; the second is the row count.' },
    { type: 'tf', q: 'Inserting NULL explicitly into a column with a DEFAULT stores the default value.', answer: false, explain: 'Only omitting the column or writing DEFAULT uses the default; explicit NULL stores NULL (or fails on NOT NULL).' },
    { type: 'mcq', q: 'Best way to obtain an auto-generated id after INSERT?', options: ['SELECT max(id)', 'RETURNING id', 'SELECT count(*)', 'Re-query by name'], answer: 1, explain: 'RETURNING is atomic and race-free.' },
    { type: 'optimize', q: 'An import inserts 200,000 rows with one INSERT per row in autocommit mode and takes 6 minutes. Best fix?', code: `for row in rows:
    cur.execute("INSERT INTO t (a,b) VALUES (%s,%s)", row)   # autocommit`, options: ['Add more indexes', 'Use COPY or batched multi-row INSERTs inside one transaction', 'Increase max_connections', 'Use SELECT FOR UPDATE'], answer: 1, explain: 'Batching removes per-statement round trips and per-commit WAL flushes; COPY is fastest.' },
    { type: 'bug', q: 'Why could this INSERT put data into the wrong columns after a schema change?', code: `INSERT INTO customers VALUES (DEFAULT, 'Riya', 'riya@x.com', 'India', 'Pune', 'smb', now());`, options: ['DEFAULT is invalid', 'No column list — it relies on physical column order', 'now() is not allowed', 'Strings need double quotes'], answer: 1, explain: 'Always list target columns explicitly.' }
  ]
},
{
  id: 'crud-update',
  module: 'crud',
  title: 'UPDATE: WHERE, Multi-Column SET, UPDATE ... FROM Joins, RETURNING and Safety',
  level: 1,
  minutes: 20,
  summary: 'Change existing rows precisely: always-scoped WHERE clauses, multi-column assignments, joins with UPDATE ... FROM, before/after values with RETURNING old/new (PostgreSQL 18), and safe-update habits.',
  objectives: [
    'Write UPDATE statements scoped by a precise WHERE clause',
    'Update several columns at once, including with row-constructor syntax',
    'Update rows based on other tables with UPDATE ... FROM',
    'Return changed rows, and old vs new values, with RETURNING (old/new in PostgreSQL 18)',
    'Make conditional updates safe under concurrency (compare-and-set)',
    'Apply a safe-update routine: SELECT first, transaction, row-count check'
  ],
  concept: `
<p><code>UPDATE</code> changes column values in existing rows. Its power is also its danger: <strong>an UPDATE without WHERE changes every row in the table</strong>.</p>
<p><strong>Analogy: correcting entries in a school register with a pen.</strong> First you find the exact lines (WHERE), then you write the new values (SET). If you forget to find the lines and just start writing, you overwrite the whole register. A careful clerk first reads the lines aloud (SELECT with the same WHERE), then writes in pencil (inside a transaction) and only inks it (COMMIT) once the count of corrected lines is what they expected.</p>
<h4>Building blocks</h4>
<ul>
<li><code>SET col = expression</code> — the expression can reference the row's current values: <code>salary = salary * 1.05</code>. All expressions see the <em>old</em> row values, so <code>SET a = b, b = a</code> swaps them.</li>
<li><code>SET (a, b) = (expr1, expr2)</code> or <code>SET (a, b) = (SELECT ...)</code> — multi-column assignment.</li>
<li><code>WHERE</code> — any condition, including subqueries (<code>id IN (SELECT ...)</code>, <code>EXISTS</code>).</li>
<li><code>FROM other_table</code> — PostgreSQL's join syntax for updates: rows of the target are joined to other tables and the WHERE gives the join condition.</li>
<li><code>RETURNING</code> — returns the updated rows. <strong>New in PostgreSQL 18</strong>: <code>RETURNING old.col, new.col</code> returns both the before and after values in one statement.</li>
<li>Command tag: <code>UPDATE 22</code> = rows changed. Always check it.</li>
</ul>
<h4>Concurrency in one paragraph</h4>
<p>An UPDATE locks each row it changes until the transaction ends. If two sessions update the same row, the second waits; under the default READ COMMITTED isolation it then re-evaluates its WHERE clause against the new version of the row. That makes <em>conditional</em> updates such as <code>UPDATE products SET stock = stock - 5 WHERE id = 10 AND stock &gt;= 5</code> safe: the check and the change happen atomically, so stock can never go negative even with many simultaneous buyers.</p>`,
  why: `
<p>Data changes constantly: prices, statuses, balances, addresses. UPDATE expresses those changes declaratively and atomically, close to the data, instead of read-modify-write cycles in application code that lose updates under concurrency. <code>UPDATE ... FROM</code> lets you apply changes computed from other tables (price lists, aggregates, staging imports) in one set-based statement, typically orders of magnitude faster than looping row by row.</p>`,
  useCase: `
<p><strong>A flash sale on an electronics marketplace</strong>: 20,000 buyers try to purchase 500 units within a minute. The checkout runs <code>UPDATE products SET stock = stock - $qty WHERE id = $id AND stock &gt;= $qty RETURNING stock</code>. If RETURNING yields no row, the item is sold out — no overselling, no separate SELECT, no application lock. After the sale, finance runs an <code>UPDATE ... FROM</code> that applies a new price list from a staging table, inside a transaction with a row-count check, and records <code>RETURNING old.price, new.price</code> into an audit table.</p>`,
  internals: `
<p>Because of MVCC, PostgreSQL never overwrites a row in place. An UPDATE writes a <strong>new row version</strong> (tuple) and marks the old one as expired by setting its <code>xmax</code>; readers that started earlier keep seeing the old version. The old version becomes a <em>dead tuple</em> later reclaimed by VACUUM. If no indexed column changes and the page has free space, PostgreSQL performs a <strong>HOT update</strong> (heap-only tuple): the new version lives on the same page and no index entries are added — much cheaper. Updating an indexed column, or a full page, requires new entries in every index. This is why updating a "last_seen" timestamp on a hot table that has an index on that column causes heavy index churn, and why <code>fillfactor</code> &lt; 100 can help update-heavy tables.</p>`,
  whenNot: `
<ul>
<li>Don't update huge portions of a big table in one statement on a live system (e.g. 200 million rows): it holds row locks for a long time, generates massive WAL and bloat. Batch it (e.g. 10,000 rows per transaction by id range) or rebuild into a new table.</li>
<li>Don't use UPDATE to keep denormalized copies in sync if you can avoid the copies.</li>
<li>Don't use read-modify-write in application code (<code>SELECT stock</code> … compute … <code>UPDATE SET stock = 7</code>) — it loses concurrent updates; use relative updates or <code>SELECT ... FOR UPDATE</code>.</li>
<li>For "insert or update" logic use <code>INSERT ... ON CONFLICT</code> or <code>MERGE</code>.</li>
</ul>`,
  syntax: `UPDATE table_name [ AS alias ]
SET    column = { expr | DEFAULT } [, ...]
     | ( column [, ...] ) = ( expr [, ...] )
     | ( column [, ...] ) = ( sub-SELECT )
[ FROM from_item [, ...] ]
[ WHERE condition | WHERE CURRENT OF cursor ]
[ RETURNING [ WITH ( OLD AS o, NEW AS n ) ] { * | old.col | new.col | expr } [, ...] ];   -- old/new: PG 18+`,
  examples: [
    { label: 'Basic', title: 'Scoped UPDATE with RETURNING old and new values',
      sql: `-- 5% price increase for low-stock audio products
UPDATE products
SET    price = round(price * 1.05, 2)
WHERE  category = 'audio'
  AND  stock < 300
RETURNING id, name,
          old.price AS old_price,     -- PostgreSQL 18+
          new.price AS new_price;`,
      explain: `<p>The WHERE clause limits the change to 8 rows. <code>round(price * 1.05, 2)</code> uses the row's current price. <code>RETURNING old.price, new.price</code> (PostgreSQL 18) shows exactly what changed — perfect for audit logs and API responses. On PostgreSQL 17 and earlier, <code>RETURNING price</code> gives only the new value; you would need a CTE or trigger to capture the old one.</p>`,
      output: ` id | name            | old_price | new_price
----+-----------------+-----------+-----------
  4 | Headset Plus 4  |  35504.07 |  37279.27
 14 | Headset Plus 14 |  12586.18 |  13215.49
 34 | Headset Plus 34 |  37870.04 |  39763.54
 44 | Headset Plus 44 |  72587.30 |  76216.67
 54 | Headset Plus 54 |  27583.88 |  28963.07
 64 | Headset Plus 64 |  68547.40 |  71974.77
 74 | Headset Plus 74 |  56353.37 |  59171.04
 94 | Headset Plus 94 |  53941.31 |  56638.38
(8 rows)

UPDATE 8`, run: true },
    { label: 'Intermediate', title: 'Multi-column SET and compare-and-set updates',
      sql: `-- Promote an employee: two columns at once
UPDATE employees
SET    (job_title, salary) = ('Senior Engineer', salary + 15000)
WHERE  id = 12
RETURNING id, job_title, old.salary AS old_salary, new.salary AS new_salary;

-- Reserve stock atomically: the check and the change are one statement
BEGIN;
UPDATE products SET stock = stock - 5
WHERE  id = 10 AND stock >= 5
RETURNING id, stock;                 -- 1 row: reservation succeeded

UPDATE products SET stock = stock - 50
WHERE  id = 10 AND stock >= 50
RETURNING id, stock;                 -- 0 rows: not enough stock, nothing changed
ROLLBACK;`,
      explain: `<ul><li>The row-constructor form <code>SET (a, b) = (x, y)</code> is handy when values come from a sub-SELECT: <code>SET (city, country) = (SELECT city, country FROM addresses WHERE ...)</code>.</li>
<li>The stock reservation is a <em>compare-and-set</em>: the condition <code>stock &gt;= 5</code> is evaluated against the locked, current row version, so concurrent buyers can never drive stock negative. The application checks the row count: 1 = success, 0 = sold out.</li></ul>`,
      output: ` id | job_title       | old_salary | new_salary
----+-----------------+------------+------------
 12 | Senior Engineer |  122900.00 |  137900.00
(1 row)

BEGIN
 id | stock
----+-------
 10 |     6
(1 row)

 id | stock
----+-------
(0 rows)

ROLLBACK`, run: true },
    { label: 'Advanced', title: 'UPDATE ... FROM with joins and aggregates',
      sql: `-- 8% raise for active, non-head employees of the Support department
WITH raised AS (
  UPDATE employees e
  SET    salary = round(e.salary * 1.08, 2)
  FROM   departments d
  WHERE  d.id = e.department_id          -- join condition
    AND  d.name = 'Support'
    AND  e.is_active
    AND  e.job_title <> 'Head of Department'
  RETURNING e.id, old.salary AS old_salary, new.salary AS new_salary
)
SELECT count(*)                        AS employees_raised,
       sum(new_salary - old_salary)    AS added_payroll
FROM   raised;

-- Upgrade SMB customers whose lifetime value exceeds 4,000,000 (aggregate in FROM)
UPDATE customers c
SET    segment = 'enterprise'
FROM  (SELECT customer_id, sum(total_amount) AS lifetime_value
       FROM   orders
       WHERE  status <> 'cancelled'
       GROUP  BY customer_id) lv
WHERE  lv.customer_id = c.id
  AND  c.segment = 'smb'
  AND  lv.lifetime_value > 4000000
RETURNING c.id, c.name, old.segment AS old_segment, new.segment AS new_segment, lv.lifetime_value;`,
      explain: `<p><code>UPDATE ... FROM</code> joins the target table to other tables; the WHERE clause provides the join condition plus filters. Columns of the joined tables (<code>lv.lifetime_value</code>) can be used in SET and RETURNING.</p>
<p>Wrapping the UPDATE in a CTE lets you summarise what it did — 22 employees raised, 176,168 added to payroll — in the same statement.</p>
<div class="callout warn">If the FROM side produces <em>several</em> matching rows for one target row, PostgreSQL updates the target with just one of them, unpredictably. Make sure the join is unique per target row — here by aggregating orders per customer first.</div>`,
      output: ` employees_raised | added_payroll
------------------+---------------
               22 |     176168.00
(1 row)

 id  | name         | old_segment | new_segment | lifetime_value
-----+--------------+-------------+-------------+----------------
 174 | Customer 174 | smb         | enterprise  |     4724205.18
 178 | Customer 178 | smb         | enterprise  |     4579508.68
 286 | Customer 286 | smb         | enterprise  |     4371616.18
 418 | Customer 418 | smb         | enterprise  |     4192514.55
(4 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Read-modify-write in application code (lost update under concurrency)
-- Session A: SELECT stock FROM products WHERE id = 10;   -> 11
-- Session B: SELECT stock FROM products WHERE id = 10;   -> 11
-- Session A: UPDATE products SET stock = 6 WHERE id = 10;   (11 - 5)
-- Session B: UPDATE products SET stock = 8 WHERE id = 10;   (11 - 3)  -- A's sale is lost!
UPDATE products SET stock = 8 WHERE id = 10;`,
      why: 'Both sessions computed from the same stale value; the last writer silently overwrites the first. 8 units were sold but stock dropped by only 3.', run: true },
    good: { sql: `-- Relative, conditional update: atomic per row, safe with any number of sessions
UPDATE products
SET    stock = stock - 3
WHERE  id = 10 AND stock >= 3
RETURNING id, stock;`,
      why: 'The database computes the new value from the current, locked row version; concurrent sessions queue on the row lock and each sees the other\'s result. The condition prevents negative stock.', run: true }
  },
  mistakes: [
    'Running an UPDATE without WHERE (or with a WHERE that matches more than intended) — every row changes. Always SELECT with the same WHERE first.',
    'Read-modify-write from the application, causing lost updates; use <code>SET x = x - n</code> or <code>SELECT ... FOR UPDATE</code>.',
    'An <code>UPDATE ... FROM</code> join that matches several rows per target row — the result is nondeterministic.',
    'Writing <code>UPDATE t SET a = 1 AND b = 2</code> — that sets <code>a</code> to the boolean expression <code>1 AND b = 2</code> (or errors). Separate assignments with commas.',
    'Updating millions of rows in one transaction on a busy table — long locks, huge WAL, bloat. Batch it.',
    'Forgetting that <code>WHERE col = NULL</code> matches nothing; use <code>IS NULL</code>.'
  ],
  best: [
    'Write the WHERE first, test it with <code>SELECT count(*)</code>, then turn it into an UPDATE.',
    'Run ad-hoc updates inside <code>BEGIN</code> … check the <code>UPDATE n</code> count and RETURNING output … <code>COMMIT</code> or <code>ROLLBACK</code>.',
    'Prefer relative updates (<code>stock = stock - 1</code>) and compare-and-set conditions for counters and balances.',
    'Use <code>RETURNING</code> (with <code>old</code>/<code>new</code> on PostgreSQL 18) for API responses and audit records.',
    'Avoid no-op updates: add <code>WHERE col IS DISTINCT FROM new_value</code> so unchanged rows are not rewritten.',
    'Set <code>statement_timeout</code>/<code>lock_timeout</code> for interactive sessions on production.'
  ],
  performance: `
<p>Every updated row creates a new tuple version and (unless HOT) new index entries, so UPDATE costs roughly an INSERT plus a later VACUUM. Updating unchanged values still writes new versions — filter them out with <code>IS DISTINCT FROM</code>. Set-based <code>UPDATE ... FROM</code> with a hash join beats row-by-row loops by orders of magnitude. For large backfills, batch by primary-key ranges with short transactions so autovacuum can keep up and replicas don't lag. Tables with frequent updates benefit from a lower <code>fillfactor</code> (e.g. 80–90) to keep HOT updates possible.</p>`,
  security: `
<p>Grant <code>UPDATE</code> per column where possible (<code>GRANT UPDATE (status) ON orders TO fulfilment_role</code>) so a role cannot change prices or totals. Row-level security <code>USING</code>/<code>WITH CHECK</code> policies limit which rows may be updated and what they may become (e.g. cannot move a row to another tenant). Many tools (psql's <code>\\set ON_ERROR_ROLLBACK</code>, IDE "safe update" modes) can block UPDATE without WHERE — enable them for humans working on production.</p>`,
  scenario: { title: 'Someone ran UPDATE customers SET segment = \'enterprise\' without a WHERE', steps: [
    '1. If the session is still open and not committed: ROLLBACK immediately.',
    '2. If committed: stop writes to the table if possible to limit further divergence.',
    '3. Determine the time of the mistake from logs (log_statement = \'mod\') or pg_stat_activity history.',
    '4. Restore the table\'s previous state: from an audit table (old values), from a PITR restore to a separate instance just before the mistake, or from a recent logical dump.',
    '5. Repair with UPDATE customers c SET segment = r.segment FROM restored_customers r WHERE r.id = c.id AND c.segment IS DISTINCT FROM r.segment.',
    '6. Prevent recurrence: least-privilege roles, ON_ERROR_ROLLBACK/safe-update settings, peer review for manual changes, audit triggers.'
  ] },
  widgets: ['lab:txn', 'lab:mvcc'],
  interview: [
    { q: 'How does UPDATE work internally in PostgreSQL?', a: 'MVCC never overwrites in place: UPDATE inserts a new tuple version and sets xmax on the old one, which stays visible to older snapshots and later becomes a dead tuple cleaned by VACUUM. If no indexed column changes and the page has room, a HOT update avoids new index entries; otherwise every index gets a new entry.' },
    { q: 'How do you prevent overselling stock under concurrency?', a: 'Use a single conditional relative update: UPDATE products SET stock = stock - $n WHERE id = $id AND stock >= $n RETURNING stock. Row locking plus READ COMMITTED re-evaluation make the check-and-decrement atomic; zero rows returned means insufficient stock. Alternatively lock with SELECT ... FOR UPDATE inside a transaction before computing.' },
    { q: 'What is UPDATE ... FROM and what is its pitfall?', a: 'PostgreSQL syntax to join the target table with other tables or subqueries and use their columns in SET and WHERE. The pitfall is a non-unique join: if a target row matches several source rows, only one (arbitrary) source row is used. Aggregate or deduplicate the source first.' },
    { q: 'What did PostgreSQL 18 add to RETURNING?', a: 'The ability to reference old and new row values: RETURNING old.price, new.price in UPDATE (and old/new in INSERT ... ON CONFLICT, DELETE and MERGE), optionally renamed with RETURNING WITH (OLD AS o, NEW AS n). Previously only the new values (or the deleted values for DELETE) were available.' }
  ],
  exercises: [
    { task: 'Mark project 4 (Project Delta) as completed and set its end_date to 2024-09-30. Return id, name, status and end_date.', solution: `UPDATE projects
SET    status = 'completed',
       end_date = DATE '2024-09-30'
WHERE  id = 4
RETURNING id, name, status, end_date;`, run: true },
    { task: 'Increase the budget of every department located in Bengaluru by 10% and return old and new budgets.', solution: `UPDATE departments
SET    budget = round(budget * 1.10, 2)
WHERE  location = 'Bengaluru'
RETURNING name, old.budget AS old_budget, new.budget AS new_budget;`, run: true },
    { task: 'Using UPDATE ... FROM, set the status of all pending orders of customers from the UAE to cancelled, and report how many were changed via a CTE.', solution: `WITH changed AS (
  UPDATE orders o
  SET    status = 'cancelled'
  FROM   customers c
  WHERE  c.id = o.customer_id
    AND  c.country = 'UAE'
    AND  o.status = 'pending'
  RETURNING o.id
)
SELECT count(*) AS cancelled_orders FROM changed;`, run: true }
  ],
  challenge: { task: 'Re-price products from a staging price list: create a temp table new_prices(sku, price) with three SKUs (SKU-0001 → 5199.00, SKU-0002 → 55051.52 (unchanged), SKU-0003 → 25999.00), then update products in one statement, skipping unchanged prices, and return sku, old and new price. Exactly 2 rows must change.', hint: 'UPDATE products p SET price = np.price FROM new_prices np WHERE np.sku = p.sku AND p.price IS DISTINCT FROM np.price.', solution: `CREATE TEMP TABLE new_prices (sku text PRIMARY KEY, price numeric(10,2) NOT NULL);
INSERT INTO new_prices VALUES ('SKU-0001', 5199.00), ('SKU-0002', 55051.52), ('SKU-0003', 25999.00);

UPDATE products p
SET    price = np.price
FROM   new_prices np
WHERE  np.sku = p.sku
  AND  p.price IS DISTINCT FROM np.price
RETURNING p.sku, old.price AS old_price, new.price AS new_price;`, run: true },
  related: ['crud-insert', 'crud-delete-truncate', 'transactions', 'mvcc', 'concurrency'],
  quiz: [
    { type: 'predict', q: 'What happens?', code: `UPDATE employees SET salary = salary * 1.1;`, options: ['Updates only active employees', 'Updates all 200 rows', 'Error: WHERE required', 'Updates nothing'], answer: 1, explain: 'Without WHERE, every row is updated. PostgreSQL does not require a WHERE clause.' },
    { type: 'tf', q: 'In PostgreSQL, an UPDATE overwrites the existing row version in place.', answer: false, explain: 'MVCC writes a new version and marks the old one expired; VACUUM later removes it.' },
    { type: 'bug', q: 'What is wrong?', code: `UPDATE products SET price = 100 AND stock = 5 WHERE id = 1;`, options: ['Nothing', 'Assignments must be separated by commas; this tries to set price to a boolean expression', 'WHERE must come first', 'stock is read-only'], answer: 1, explain: 'Use SET price = 100, stock = 5.' },
    { type: 'mcq', q: 'Which statement safely decrements stock without overselling under concurrency?', options: ['SELECT stock ...; then UPDATE SET stock = <computed>', 'UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock >= 1', 'UPDATE products SET stock = stock - 1', 'DELETE and re-INSERT the row'], answer: 1, explain: 'Relative, conditional update evaluated on the locked current row.' },
    { type: 'scenario', q: 'You must backfill a new column on a 300M-row table without hurting production. Best approach?', options: ['One UPDATE for all rows during peak hours', 'Batches of ~10k rows by primary-key range, each in its own short transaction, with pauses', 'TRUNCATE and reload', 'Disable WAL'], answer: 1, explain: 'Batching limits lock time, WAL bursts, replica lag and bloat, and lets autovacuum keep up.' }
  ]
},
{
  id: 'crud-delete-truncate',
  module: 'crud',
  title: 'DELETE vs TRUNCATE: DELETE ... USING, RETURNING, Cascades and Soft Deletes',
  level: 1,
  minutes: 20,
  summary: 'Remove data safely: scoped DELETE, joins with DELETE ... USING, archiving with RETURNING, foreign-key cascades, when TRUNCATE is the right tool, and how soft deletes work.',
  objectives: [
    'Delete rows with a precise WHERE clause and verify the row count',
    'Delete based on other tables with DELETE ... USING and subqueries',
    'Capture deleted rows with RETURNING (e.g. to archive them in the same statement)',
    'Handle foreign keys: RESTRICT/NO ACTION errors, ON DELETE CASCADE, deleting children first',
    'Choose between DELETE, TRUNCATE and DROP',
    'Implement soft deletes with deleted_at, views and partial indexes'
  ],
  concept: `
<p><code>DELETE</code> removes rows that match a condition; <code>TRUNCATE</code> removes <em>all</em> rows of one or more tables at once. Both are transactional in PostgreSQL — you can roll them back.</p>
<p><strong>Analogy: clearing out a warehouse.</strong> <code>DELETE</code> is a worker walking the aisles, checking each box against a list and carrying out the ones that match, writing each removal in the logbook — precise but slow for a full clear-out. <code>TRUNCATE</code> is swapping the whole warehouse for an empty one overnight — instant, but everything goes, and nobody may be inside while it happens. A <em>soft delete</em> is putting a "discontinued" sticker on a box: it stays on the shelf, but normal pickers ignore it.</p>
<table>
<tr><th></th><th><code>DELETE</code></th><th><code>TRUNCATE</code></th><th><code>DROP TABLE</code></th></tr>
<tr><td>Removes</td><td>Rows matching WHERE (or all)</td><td>All rows</td><td>The table itself</td></tr>
<tr><td>Speed on big tables</td><td>Proportional to rows deleted</td><td>Constant (swaps files)</td><td>Constant</td></tr>
<tr><td>Row triggers / RETURNING</td><td>Yes / Yes</td><td>No (only TRUNCATE triggers) / No</td><td>No</td></tr>
<tr><td>Leaves dead tuples (needs VACUUM)</td><td>Yes</td><td>No</td><td>—</td></tr>
<tr><td>Lock</td><td>Row locks (ROW EXCLUSIVE on table)</td><td>ACCESS EXCLUSIVE (blocks reads too)</td><td>ACCESS EXCLUSIVE</td></tr>
<tr><td>Identity reset</td><td>No</td><td>Optional: <code>RESTART IDENTITY</code></td><td>—</td></tr>
<tr><td>Referenced by FKs</td><td>Checked per row</td><td>Refused unless all referencing tables are truncated too (or <code>CASCADE</code>)</td><td>Needs CASCADE</td></tr>
<tr><td>Rollback-able</td><td>Yes</td><td>Yes (in PostgreSQL)</td><td>Yes (in PostgreSQL)</td></tr>
</table>
<h4>DELETE features</h4>
<ul>
<li><code>DELETE FROM t USING other WHERE t.x = other.x AND ...</code> — PostgreSQL's join syntax for delete.</li>
<li>Subqueries: <code>WHERE id IN (SELECT ...)</code> or <code>WHERE EXISTS (...)</code>.</li>
<li><code>RETURNING</code> — the deleted rows, ready to be inserted into an archive table via a CTE.</li>
<li>Foreign keys: children with <code>ON DELETE CASCADE</code> disappear automatically (<code>order_items</code> in company_db), while <code>NO ACTION</code>/<code>RESTRICT</code> children (<code>payments</code>) block the delete until you remove or re-point them.</li>
</ul>
<h4>Soft delete</h4>
<p>Instead of removing a row, set <code>deleted_at = now()</code>. Queries go through a view or include <code>WHERE deleted_at IS NULL</code>; a partial unique index (<code>... WHERE deleted_at IS NULL</code>) keeps uniqueness among live rows. Soft deletes allow undo and preserve history, but they complicate every query, keep data you may be legally required to erase, and FKs no longer protect you from referencing "deleted" rows.</p>`,
  why: `
<p>Data must leave the system for many reasons: retention policies (keep logs 90 days), GDPR/DPDP erasure requests, cleanup of failed imports, cancelling test data. The wrong tool causes outages — a <code>DELETE</code> of 500 million log rows bloats the table and floods WAL for hours, while a <code>TRUNCATE</code> on a hot table blocks every reader. Understanding foreign-key behaviour prevents both "cannot delete" surprises and accidental cascades that wipe related business history.</p>`,
  useCase: `
<p><strong>A SaaS analytics product</strong> keeps raw events for 30 days. Early on they ran <code>DELETE FROM events WHERE created_at &lt; now() - interval '30 days'</code> nightly: 40 million rows each night, 3 hours of I/O, constant bloat. They switched to daily range partitions and now drop (or detach) the oldest partition in milliseconds — see the Partitioning module. Customer accounts use soft delete (<code>deleted_at</code>) with a 14-day undo window; a weekly job then performs the hard delete with <code>DELETE ... RETURNING</code> into an <code>erasure_log</code> table to prove compliance. Staging tables for imports are emptied with <code>TRUNCATE ... RESTART IDENTITY</code> before each run.</p>`,
  internals: `
<p>DELETE does not remove data physically: it sets <code>xmax</code> on each matching tuple (MVCC), so concurrent readers still see the rows until the deleting transaction commits — and afterwards until no snapshot needs them. VACUUM later marks the space reusable (it rarely shrinks the file). Index entries are cleaned up by VACUUM too. That is why mass deletes leave the table and its indexes the same size, and why they generate WAL for every row. TRUNCATE instead creates new, empty relation files (new <code>relfilenode</code>) for the table and its indexes and unlinks the old files at commit — no per-row work, no dead tuples, minimal WAL. Its <code>ACCESS EXCLUSIVE</code> lock waits for all running queries on the table and blocks new ones meanwhile. FK checks with <code>NO ACTION</code> are performed at the end of the statement, which is why a single statement can delete children and parents together via CTEs.</p>`,
  whenNot: `
<ul>
<li>Don't DELETE most of a huge table — copy the rows you keep into a new table and swap, use TRUNCATE, or (for time-based retention) use partitioning and drop partitions.</li>
<li>Don't TRUNCATE tables under heavy concurrent read traffic without a maintenance window — the exclusive lock blocks readers.</li>
<li>Don't use <code>ON DELETE CASCADE</code> from master data (customers) to financial history (orders, payments).</li>
<li>Don't use soft delete when the law requires actual erasure; anonymise or hard-delete instead.</li>
</ul>`,
  syntax: `DELETE FROM table_name [ AS alias ]
[ USING from_item [, ...] ]
[ WHERE condition | WHERE CURRENT OF cursor ]
[ RETURNING { * | expr [ AS name ] } [, ...] ];

TRUNCATE [ TABLE ] name [, ...] [ RESTART IDENTITY | CONTINUE IDENTITY ] [ CASCADE | RESTRICT ];

-- soft delete pattern
ALTER TABLE t ADD COLUMN deleted_at timestamptz;
UPDATE t SET deleted_at = now() WHERE id = $1;
CREATE VIEW t_live AS SELECT ... FROM t WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ON t (email) WHERE deleted_at IS NULL;`,
  examples: [
    { label: 'Basic', title: 'Scoped DELETE with RETURNING',
      sql: `-- Purge old audit entries and summarise what was removed
WITH purged AS (
  DELETE FROM audit_logs
  WHERE  changed_at < TIMESTAMPTZ '2026-01-03 00:00:00+00'
  RETURNING table_name, operation
)
SELECT table_name, operation, count(*) AS rows_deleted
FROM   purged
GROUP  BY table_name, operation
ORDER  BY table_name, operation;

-- Delete failed payment attempts older than February 2024, returning them
DELETE FROM payments
WHERE  status = 'failed'
  AND  paid_at < TIMESTAMPTZ '2024-02-01 00:00:00+00'
RETURNING id, order_id, amount, method;`,
      explain: `<p>The WHERE clause is the safety boundary. An explicit offset (<code>+00</code>) makes the cut-off independent of the session time zone. <code>RETURNING</code> gives you the removed rows — here summarised through a CTE, and in the second statement listed directly for logging or archiving. psql would print <code>DELETE 7</code> for the second statement.</p>`,
      output: ` table_name | operation | rows_deleted
------------+-----------+--------------
 orders     | DELETE    |           13
 orders     | INSERT    |           13
 orders     | UPDATE    |           26
(3 rows)

  id  | order_id |  amount   | method
------+----------+-----------+--------
  110 |      116 | 133302.68 | upi
 1255 |     1363 | 324768.50 | upi
 1866 |     2030 | 237768.45 | upi
 1973 |     2146 | 589070.34 | wallet
 2453 |     2668 |  63206.20 | wallet
 2663 |     2900 | 206715.57 | upi
 4521 |     4930 | 178163.38 | wallet
(7 rows)

DELETE 7`, run: true },
    { label: 'Intermediate', title: 'DELETE ... USING and foreign-key handling',
      sql: `-- Remove all assignments to projects that are on hold (join via USING)
WITH removed AS (
  DELETE FROM employee_projects ep
  USING  projects p
  WHERE  p.id = ep.project_id
    AND  p.status = 'on_hold'
  RETURNING ep.employee_id, ep.project_id
)
SELECT count(*) AS assignments_removed,
       count(DISTINCT project_id) AS projects_affected
FROM   removed;

-- Deleting cancelled Q1-2024 orders: payments reference orders with NO ACTION,
-- order_items reference orders with ON DELETE CASCADE.
-- A plain DELETE FROM orders ... would fail:
--   ERROR: update or delete on table "orders" violates foreign key constraint
--          "payments_order_id_fkey" on table "payments"
WITH doomed AS (
       SELECT id FROM orders
       WHERE  status = 'cancelled' AND order_date < '2024-04-01'
     ),
     del_payments AS (
       DELETE FROM payments WHERE order_id IN (SELECT id FROM doomed) RETURNING id
     ),
     del_orders AS (
       DELETE FROM orders WHERE id IN (SELECT id FROM doomed) RETURNING id
     )
SELECT (SELECT count(*) FROM del_payments) AS payments_deleted,
       (SELECT count(*) FROM del_orders)   AS orders_deleted;   -- items cascade automatically`,
      explain: `<ul><li><code>USING projects p</code> joins the target to another table; only assignments whose project is on hold are removed (48 rows across 6 projects).</li>
<li>Foreign keys decide what happens to children. <code>payments</code> must be deleted first (or in the same statement), because its FK is <code>NO ACTION</code>. <code>order_items</code> uses <code>ON DELETE CASCADE</code>, so the 142 items of these orders vanish automatically.</li>
<li>Both deletes run in one statement; <code>NO ACTION</code> FK checks happen at statement end, when the payments are already gone.</li></ul>`,
      output: ` assignments_removed | projects_affected
---------------------+-------------------
                  48 |                 6
(1 row)

 payments_deleted | orders_deleted
------------------+----------------
               62 |             62
(1 row)`, run: true },
    { label: 'Advanced', title: 'Archive-and-delete, TRUNCATE, and soft delete',
      sql: `-- 1) Move rows to an archive table in ONE atomic statement
CREATE TABLE audit_logs_archive (LIKE audit_logs INCLUDING DEFAULTS);
WITH moved AS (
  DELETE FROM audit_logs
  WHERE  changed_at < TIMESTAMPTZ '2026-01-02 00:00:00+00'
  RETURNING *
)
INSERT INTO audit_logs_archive SELECT * FROM moved;
SELECT (SELECT count(*) FROM audit_logs)         AS live_rows,
       (SELECT count(*) FROM audit_logs_archive) AS archived_rows;

-- 2) TRUNCATE a staging table and reset its identity
CREATE TABLE staging_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payload jsonb);
INSERT INTO staging_events (payload) SELECT jsonb_build_object('n', g) FROM generate_series(1, 5000) g;
TRUNCATE staging_events RESTART IDENTITY;
INSERT INTO staging_events (payload) VALUES ('{"n": 1}') RETURNING id;   -- starts at 1 again

-- 3) Soft delete with a view and a partial unique index
ALTER TABLE customers ADD COLUMN deleted_at timestamptz;
CREATE UNIQUE INDEX customers_email_live_key ON customers (lower(email)) WHERE deleted_at IS NULL;
CREATE VIEW live_customers AS
  SELECT id, name, email, country FROM customers WHERE deleted_at IS NULL;

UPDATE customers SET deleted_at = now() WHERE id = 7;   -- "delete" customer 7 (has orders!)
SELECT (SELECT count(*) FROM live_customers) AS live,
       (SELECT count(*) FROM customers)      AS total_rows;`,
      explain: `<ol><li><strong>Archive-and-delete</strong>: the CTE deletes and returns full rows, the outer INSERT stores them — atomically. Either both happen or neither.</li>
<li><strong>TRUNCATE ... RESTART IDENTITY</strong> empties 5,000 rows instantly and resets the identity sequence. It would be refused on <code>orders</code> (<em>cannot truncate a table referenced in a foreign key constraint</em>) unless the referencing tables are truncated in the same command or <code>CASCADE</code> is given.</li>
<li><strong>Soft delete</strong>: customer 7 cannot be hard-deleted (orders reference it), but it can be hidden. The partial unique index enforces unique emails only among live customers, so a new sign-up may reuse the email of a deleted account.</li></ol>`,
      output: ` live_rows | archived_rows
-----------+---------------
       272 |            28
(1 row)

 id
----
  1
(1 row)

 live | total_rows
------+------------
  499 |        500
(1 row)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Emptying a large staging table row by row
CREATE TABLE import_rows AS SELECT g AS n FROM generate_series(1, 200000) g;
DELETE FROM import_rows;          -- 200k dead tuples, WAL for every row, table file stays full-size
SELECT pg_size_pretty(pg_relation_size('import_rows')) AS size_after_delete;`,
      why: 'DELETE without WHERE does per-row work, writes WAL per row, leaves dead tuples that VACUUM must clean, and does not shrink the file.', run: true },
    good: { sql: `CREATE TABLE import_rows AS SELECT g AS n FROM generate_series(1, 200000) g;
TRUNCATE import_rows;             -- new empty file, old one removed at commit
SELECT pg_size_pretty(pg_relation_size('import_rows')) AS size_after_truncate;`,
      why: 'TRUNCATE is O(1), leaves no dead tuples and returns the disk space immediately — ideal for staging tables (mind its exclusive lock on busy tables).', run: true }
  },
  mistakes: [
    'Running <code>DELETE FROM t</code> without WHERE by accident — always preview with SELECT and run inside a transaction.',
    'Expecting DELETE to shrink the table on disk; space is reused, not returned (use TRUNCATE, or <code>VACUUM FULL</code>/<code>pg_repack</code> with care).',
    'Adding <code>ON DELETE CASCADE</code> everywhere and wiping financial history with one delete of a parent.',
    'Not indexing FK columns of child tables: every parent delete then scans the child table.',
    'Using TRUNCATE on a busy table during business hours and blocking all readers behind its ACCESS EXCLUSIVE lock.',
    'Soft-deleting rows but keeping a plain UNIQUE constraint, so deleted users block re-registration with the same email.'
  ],
  best: [
    'Preview: <code>SELECT count(*) ... WHERE &lt;same condition&gt;</code>, then <code>BEGIN; DELETE ...; -- check count; COMMIT;</code>.',
    'Archive with <code>WITH moved AS (DELETE ... RETURNING *) INSERT INTO archive SELECT * FROM moved</code>.',
    'Delete large volumes in batches (e.g. <code>WHERE id IN (SELECT id FROM t WHERE ... LIMIT 10000)</code>) or use partition drops for time-based retention.',
    'Use TRUNCATE (with <code>RESTART IDENTITY</code>) for staging/scratch tables.',
    'For soft deletes: <code>deleted_at timestamptz</code>, a view for live rows, partial unique indexes, and a scheduled hard-delete for compliance.',
    'Prefer RESTRICT/NO ACTION for business history; CASCADE only for owned children.'
  ],
  performance: `
<p>DELETE cost scales with rows: each one is located (use indexes in the WHERE), marked with <code>xmax</code>, logged in WAL, and later cleaned by VACUUM; FK checks on children add lookups (index the child FK columns!). Deleting 10% of a table is fine; deleting 90% is better done by copying the 10% you keep. TRUNCATE and partition <code>DROP</code>/<code>DETACH</code> are constant-time. After large deletes, run <code>VACUUM (ANALYZE)</code> so the planner's statistics and the visibility map catch up.</p>`,
  security: `
<p>Grant <code>DELETE</code> sparingly — many applications should never hard-delete (use soft delete or status changes) and only a privileged job should purge. <code>TRUNCATE</code> is a separate privilege; don't grant it to application roles. Row-level security policies apply to DELETE (<code>USING</code>), but <em>not</em> to TRUNCATE. For privacy-law erasure, remember backups, replicas, logs, search indexes and analytics copies — deleting the primary row is only the first step; keep an erasure log as evidence.</p>`,
  interview: [
    { q: 'DELETE vs TRUNCATE: what are the differences?', a: 'DELETE removes rows matching a WHERE clause one by one, fires row triggers, supports RETURNING, takes row locks and leaves dead tuples for VACUUM. TRUNCATE removes all rows by replacing the table\'s files: constant time, no dead tuples, can restart identities, but needs an ACCESS EXCLUSIVE lock, fires no row triggers, ignores RLS and is refused on FK-referenced tables unless they are truncated together or CASCADE is used. Both are transactional in PostgreSQL.' },
    { q: 'How do you delete rows based on another table?', a: 'Either DELETE FROM t USING other WHERE t.fk = other.id AND <conditions>, or with a subquery: WHERE EXISTS (SELECT 1 FROM other WHERE ...) / WHERE id IN (SELECT ...). USING is PostgreSQL syntax; EXISTS is portable.' },
    { q: 'What are the trade-offs of soft deletes?', a: 'Pros: undo, history, referential integrity stays intact for historical rows. Cons: every query must filter deleted rows (use views), unique constraints need partial indexes, tables keep growing, FKs cannot stop references to "deleted" rows, and legal erasure obligations still require eventually removing or anonymising data.' },
    { q: 'Why does a table not shrink after a big DELETE?', a: 'MVCC only marks tuples dead; VACUUM makes the space reusable inside the file but normally does not return it to the OS (except trailing empty pages). To reclaim space you need TRUNCATE, VACUUM FULL / CLUSTER (exclusive lock, rewrites the table) or an online tool like pg_repack.' }
  ],
  exercises: [
    { task: 'Delete all employee_projects assignments with allocation_pct below 30 and return how many rows were removed per role.', solution: `WITH removed AS (
  DELETE FROM employee_projects
  WHERE  allocation_pct < 30
  RETURNING role
)
SELECT role, count(*) AS removed
FROM   removed
GROUP  BY role
ORDER  BY role;`, run: true },
    { task: 'Using EXISTS, delete products that have never been ordered and have zero stock (it may delete nothing — return the deleted SKUs).', solution: `DELETE FROM products p
WHERE  p.stock = 0
  AND  NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id)
RETURNING p.sku;`, run: true },
    { task: 'Create a scratch table with 1,000 generated rows, TRUNCATE it, and show the row count afterwards.', solution: `CREATE TABLE scratch AS SELECT g AS n FROM generate_series(1, 1000) g;
TRUNCATE scratch;
SELECT count(*) AS rows_left FROM scratch;`, run: true }
  ],
  challenge: { task: 'Implement a GDPR-style erasure for customer 42: anonymise the customer row (name → \'Erased customer\', email → \'erased+42@invalid\', city → \'-\'), delete their failed payment attempts, and record what happened in a new erasure_log table (customer_id, erased_at, failed_payments_deleted) — all in one transaction.', hint: 'Orders must be kept for accounting, so anonymise rather than delete the customer. Use a data-modifying CTE to count deleted payments.', solution: `BEGIN;

CREATE TABLE erasure_log (
  customer_id             int         NOT NULL,
  erased_at               timestamptz NOT NULL DEFAULT now(),
  failed_payments_deleted int         NOT NULL
);

WITH anonymised AS (
       UPDATE customers
       SET    name = 'Erased customer',
              email = 'erased+42@invalid',
              city = '-'
       WHERE  id = 42
       RETURNING id
     ),
     deleted_payments AS (
       DELETE FROM payments p
       USING  orders o
       WHERE  o.id = p.order_id
         AND  o.customer_id = 42
         AND  p.status = 'failed'
       RETURNING p.id
     )
INSERT INTO erasure_log (customer_id, failed_payments_deleted)
SELECT a.id, (SELECT count(*) FROM deleted_payments)
FROM   anonymised a
RETURNING *;

COMMIT;`, run: true },
  related: ['crud-update', 'crud-upsert-merge', 'database-design-keys-relationships', 'vacuum', 'partitioning'],
  quiz: [
    { type: 'mcq', q: 'Which command resets an identity column\'s sequence while emptying the table?', options: ['DELETE FROM t RESET IDENTITY', 'TRUNCATE t RESTART IDENTITY', 'DROP TABLE t', 'VACUUM t'], answer: 1, explain: 'TRUNCATE ... RESTART IDENTITY resets sequences owned by the table\'s columns.' },
    { type: 'tf', q: 'TRUNCATE cannot be rolled back in PostgreSQL.', answer: false, explain: 'TRUNCATE is transactional in PostgreSQL; the old files are only removed at commit.' },
    { type: 'predict', q: 'payments.order_id references orders with NO ACTION. What happens?', code: `DELETE FROM orders WHERE id = 1;   -- order 1 has a payment`, options: ['The order and payment are deleted', 'Error: violates foreign key constraint on payments', 'The payment\'s order_id becomes NULL', 'Only the order is deleted'], answer: 1, explain: 'NO ACTION/RESTRICT blocks deleting a referenced parent.' },
    { type: 'design', q: 'You must keep events for 90 days on a table receiving 50M rows/day. Best retention strategy?', options: ['Nightly DELETE ... WHERE created_at < now() - 90 days', 'Daily range partitions; drop the oldest partition each day', 'TRUNCATE weekly', 'Soft delete'], answer: 1, explain: 'Dropping a partition is instant and avoids bloat and WAL storms.' },
    { type: 'bug', q: 'After soft-deleting a user, the same email cannot register again. Why?', code: `CREATE UNIQUE INDEX ON users (email);
UPDATE users SET deleted_at = now() WHERE id = 10;`, options: ['deleted_at must be a boolean', 'The unique index covers deleted rows too; use a partial index WHERE deleted_at IS NULL', 'Emails cannot be unique', 'UPDATE does not commit'], answer: 1, explain: 'Make uniqueness apply only to live rows.' }
  ]
},
{
  id: 'crud-upsert-merge',
  module: 'crud',
  title: 'UPSERT with INSERT ... ON CONFLICT (DO NOTHING / DO UPDATE) and MERGE',
  level: 2,
  minutes: 24,
  summary: 'Insert-or-update atomically: ON CONFLICT targets, EXCLUDED, conditional updates, partial unique indexes, and the SQL-standard MERGE statement (PostgreSQL 15+, with RETURNING and NOT MATCHED BY SOURCE in 17+).',
  objectives: [
    'Explain why "SELECT then INSERT or UPDATE" is unsafe under concurrency',
    'Use INSERT ... ON CONFLICT DO NOTHING for idempotent inserts',
    'Use ON CONFLICT DO UPDATE with EXCLUDED, table aliases and a WHERE guard',
    'Specify conflict targets: column lists, expression and partial unique indexes, ON CONSTRAINT',
    'Synchronise a table from a source with MERGE (MATCHED / NOT MATCHED / NOT MATCHED BY SOURCE)',
    'Choose between ON CONFLICT and MERGE'
  ],
  concept: `
<p>An <strong>upsert</strong> means "insert this row, or if it already exists, update it (or do nothing)". It is needed whenever data arrives that may or may not be new: product feeds, counters, sync jobs, idempotent API retries.</p>
<p><strong>Analogy: a hotel check-in desk.</strong> A guest arrives with a booking reference. If the reference is new, create a booking (INSERT). If it already exists, update the stay dates (DO UPDATE) — or, if it is just a duplicate confirmation email, ignore it (DO NOTHING). The desk must do the lookup and the action as one step: if two receptionists both look, see nothing, and both create a booking, the guest gets two rooms. <code>ON CONFLICT</code> is that single, atomic step.</p>
<h4>INSERT ... ON CONFLICT (PostgreSQL 9.5+)</h4>
<ul>
<li><strong>Conflict target</strong>: <code>ON CONFLICT (sku)</code> — the column(s) of a unique index or constraint. For expression or partial unique indexes, repeat the expression and predicate: <code>ON CONFLICT (lower(email)) WHERE deleted_at IS NULL</code>. Or name it: <code>ON CONFLICT ON CONSTRAINT products_sku_key</code>.</li>
<li><code>DO NOTHING</code> — skip conflicting rows silently (the target may be omitted to ignore any unique violation).</li>
<li><code>DO UPDATE SET ...</code> — update the existing row. <code>EXCLUDED</code> is the row you tried to insert; the table name (or alias) refers to the existing row: <code>stock = products.stock + EXCLUDED.stock</code>.</li>
<li><code>DO UPDATE ... WHERE</code> — only update when a condition holds (e.g. the incoming data is newer).</li>
<li><code>RETURNING</code> — returns inserted and updated rows (not rows skipped by DO NOTHING). In PostgreSQL 18, <code>old</code>/<code>new</code> tell you which happened: <code>old</code> is NULL for inserts.</li>
</ul>
<h4>MERGE (SQL standard; PostgreSQL 15+)</h4>
<p><code>MERGE INTO target USING source ON condition</code> followed by <code>WHEN MATCHED [AND ...] THEN UPDATE | DELETE | DO NOTHING</code> and <code>WHEN NOT MATCHED [AND ...] THEN INSERT</code>. PostgreSQL 17 added <code>WHEN NOT MATCHED BY SOURCE</code> (target rows missing from the source — e.g. discontinued products), <code>RETURNING</code> with <code>merge_action()</code>, and MERGE on updatable views.</p>
<table>
<tr><th></th><th>INSERT ... ON CONFLICT</th><th>MERGE</th></tr>
<tr><td>Needs a unique index on the key</td><td>Yes</td><td>No (any join condition)</td></tr>
<tr><td>Concurrency</td><td>Guaranteed insert-or-update even under concurrent inserts (no unique violation)</td><td>Concurrent inserts of the same key can still raise a unique violation; retry needed</td></tr>
<tr><td>Actions</td><td>Insert, update or nothing</td><td>Insert, update, delete or nothing, with multiple conditional branches</td></tr>
<tr><td>Best for</td><td>High-concurrency OLTP upserts, idempotent writes, counters</td><td>Batch synchronisation from a staging table/feed</td></tr>
</table>`,
  why: `
<p>Without an atomic upsert, applications do "SELECT; if not found INSERT else UPDATE". Under concurrency two requests both see "not found", both INSERT, and one fails with a unique violation (or, without a unique constraint, you get duplicates). Retrying in application code is complex and slow. <code>ON CONFLICT</code> moves the decision into the database where it can be made atomically using the unique index. <code>MERGE</code> expresses whole-table synchronisation (insert new, update changed, retire missing) in one set-based statement instead of three.</p>`,
  useCase: `
<p><strong>A retail chain ingests supplier product feeds</strong> every 15 minutes: 200,000 SKUs, 2% changed. The loader <code>COPY</code>s the feed into a staging table, then one <code>MERGE</code> updates changed prices, inserts new SKUs and, via <code>WHEN NOT MATCHED BY SOURCE</code>, zeroes stock for SKUs the supplier dropped — returning <code>merge_action()</code> counts for the job log. Meanwhile, the web shop's "add to wishlist" endpoint uses <code>INSERT ... ON CONFLICT (user_id, product_id) DO NOTHING</code>, so double-clicks and network retries are harmless, and the page-view counter uses <code>ON CONFLICT (product_id, day) DO UPDATE SET views = page_views.views + 1</code>.</p>`,
  internals: `
<p>ON CONFLICT uses <em>speculative insertion</em>: PostgreSQL first checks the arbiter unique index for a conflicting row; if none, it inserts the heap tuple "speculatively" and inserts into the unique index; if another session inserted the same key concurrently, the speculative tuple is killed and the operation retries as an update (or nothing). So the statement never raises a unique violation on the arbiter index. DO UPDATE locks the existing row (like <code>SELECT ... FOR UPDATE</code>) before updating; a row cannot be updated twice by the same command — if your VALUES list contains the same key twice you get <em>ON CONFLICT DO UPDATE command cannot affect row a second time</em>. Note that the identity/sequence value is consumed even when the row ends up not inserted, creating gaps. MERGE performs a join between source and target and applies actions per joined row; under READ COMMITTED, if a concurrent transaction inserts a matching row after MERGE's snapshot, MERGE's INSERT branch can hit a unique violation.</p>`,
  whenNot: `
<ul>
<li>Don't use DO UPDATE when you only need idempotency — DO NOTHING avoids pointless row versions and bloat.</li>
<li>Don't use MERGE for high-concurrency single-row upserts — ON CONFLICT is safer and faster.</li>
<li>Don't upsert without a real unique constraint on the business key; ON CONFLICT requires one, and MERGE without one can create duplicates under concurrency.</li>
<li>Don't use upsert to hide data-quality problems (e.g. silently overwriting newer data with older feed rows) — add a <code>WHERE</code> guard on timestamps or versions.</li>
</ul>`,
  syntax: `INSERT INTO table_name [ AS alias ] ( columns ) VALUES ( ... ) | query
ON CONFLICT [ ( column | ( expression ) [, ...] ) [ WHERE index_predicate ]
            | ON CONSTRAINT constraint_name ]
  { DO NOTHING
  | DO UPDATE SET column = { expr | EXCLUDED.column } [, ...]
              [ WHERE condition ] }
[ RETURNING ... ];

MERGE INTO target [ AS t ]
USING source [ AS s ] ON join_condition
WHEN MATCHED [ AND condition ] THEN { UPDATE SET ... | DELETE | DO NOTHING }
WHEN NOT MATCHED [ BY TARGET ] [ AND condition ] THEN { INSERT ( cols ) VALUES ( ... ) | DO NOTHING }
WHEN NOT MATCHED BY SOURCE [ AND condition ] THEN { UPDATE SET ... | DELETE | DO NOTHING }   -- PG 17+
[ RETURNING merge_action(), ... ];                                                            -- PG 17+`,
  examples: [
    { label: 'Basic', title: 'Idempotent insert with ON CONFLICT DO NOTHING',
      sql: `-- SKU-0001 already exists, SKU-0201 is new
INSERT INTO products (sku, name, category, price, stock)
VALUES ('SKU-0001', 'Monitor Air 1', 'electronics', 4899.00, 25),
       ('SKU-0201', 'USB-C Dock',    'accessories', 7499.00, 40)
ON CONFLICT (sku) DO NOTHING
RETURNING id, sku, price, stock;`,
      explain: `<p>The conflicting row (SKU-0001) is skipped silently; only the new SKU is inserted and returned. Running the same statement again inserts nothing — the operation is <em>idempotent</em>, ideal for retries of API calls or message processing. psql reports <code>INSERT 0 1</code>. The id shown depends on the sequence state; a skipped row still consumes a sequence value.</p>`,
      output: ` id  | sku      | price   | stock
-----+----------+---------+-------
 101 | SKU-0201 | 7499.00 |    40
(1 row)

INSERT 0 1`, run: true },
    { label: 'Intermediate', title: 'ON CONFLICT DO UPDATE with EXCLUDED, counters and a WHERE guard',
      sql: `-- Insert new SKUs; for existing ones take the new price and ADD the delivered stock
INSERT INTO products AS p (sku, name, category, price, stock)
VALUES ('SKU-0001', 'Monitor Air 1', 'electronics', 4899.00, 25),
       ('SKU-0201', 'USB-C Dock',    'accessories', 7499.00, 40)
ON CONFLICT (sku) DO UPDATE
SET    price = EXCLUDED.price,
       stock = p.stock + EXCLUDED.stock
RETURNING p.id, p.sku,
          old.price AS old_price, new.price AS new_price,
          old.stock AS old_stock, new.stock AS new_stock,
          old IS NULL AS inserted;                     -- PostgreSQL 18

-- Daily aggregate counter keyed by (product, day)
CREATE TABLE daily_product_sales (
  product_id int  NOT NULL REFERENCES products (id),
  sales_date date NOT NULL,
  units      int  NOT NULL DEFAULT 0,
  revenue    numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, sales_date)
);
INSERT INTO daily_product_sales AS d VALUES (1, '2025-10-01', 2, 10009.68)
ON CONFLICT (product_id, sales_date) DO UPDATE
SET units = d.units + EXCLUDED.units, revenue = d.revenue + EXCLUDED.revenue;
INSERT INTO daily_product_sales AS d VALUES (1, '2025-10-01', 1, 5004.84)
ON CONFLICT (product_id, sales_date) DO UPDATE
SET units = d.units + EXCLUDED.units, revenue = d.revenue + EXCLUDED.revenue;
SELECT * FROM daily_product_sales;

-- Never let an older feed row overwrite newer data
CREATE TABLE price_feed (sku text PRIMARY KEY, price numeric(10,2), updated_at timestamptz);
INSERT INTO price_feed VALUES ('A', 10, '2025-10-01 10:00+00');
INSERT INTO price_feed AS pf VALUES ('A', 12, '2025-10-01 09:00+00')     -- stale!
ON CONFLICT (sku) DO UPDATE
SET    price = EXCLUDED.price, updated_at = EXCLUDED.updated_at
WHERE  pf.updated_at < EXCLUDED.updated_at
RETURNING *;                                                            -- 0 rows: guarded
SELECT sku, price FROM price_feed;`,
      explain: `<ul><li><code>EXCLUDED.col</code> is the proposed (rejected) row; <code>p.col</code> (alias of the target) is the existing row. So <code>p.stock + EXCLUDED.stock</code> adds the delivery to current stock: 129 + 25 = 154.</li>
<li>PostgreSQL 18's <code>old</code>/<code>new</code> in RETURNING reveal which rows were inserted (<code>old IS NULL</code>) and what changed. On older versions, a common trick is <code>RETURNING (xmax = 0) AS inserted</code>.</li>
<li>The counter pattern is the canonical upsert: two inserts for the same key produce one row with 3 units.</li>
<li>The <code>WHERE</code> on DO UPDATE turns the upsert into "update only if newer"; the stale row is ignored and nothing is returned.</li></ul>`,
      output: ` id  | sku      | old_price | new_price | old_stock | new_stock | inserted
-----+----------+-----------+-----------+-----------+-----------+----------
   1 | SKU-0001 |   5004.84 |   4899.00 |       129 |       154 | f
 101 | SKU-0201 |           |   7499.00 |           |        40 | t
(2 rows)

 product_id | sales_date | units | revenue
------------+------------+-------+----------
          1 | 2025-10-01 |     3 | 15014.52
(1 row)

 sku | price | updated_at
-----+-------+------------
(0 rows)

 sku | price
-----+-------
 A   | 10.00
(1 row)`, run: true },
    { label: 'Advanced', title: 'Partial unique index targets and MERGE synchronisation',
      sql: `-- Conflict target = expression + predicate of a partial unique index
CREATE TABLE subscribers (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX subscribers_email_live_key ON subscribers (lower(email)) WHERE deleted_at IS NULL;
INSERT INTO subscribers (email) VALUES ('asha@example.com');
INSERT INTO subscribers (email) VALUES ('ASHA@example.com')
ON CONFLICT (lower(email)) WHERE deleted_at IS NULL DO NOTHING;
SELECT count(*) AS subscribers FROM subscribers;            -- still 1

-- MERGE: synchronise products from a supplier feed
CREATE TEMP TABLE stock_feed (sku text PRIMARY KEY, name text, category text,
                              price numeric(10,2), stock int, discontinued boolean);
INSERT INTO stock_feed VALUES
  ('SKU-0001', 'Monitor Air 1',  'electronics',  4999.00, 140, false),
  ('SKU-0002', 'Keyboard Max 2', 'accessories', 55051.52,   0, true),
  ('SKU-0301', 'Webcam 4K',      'video',        8999.00,  60, false);

MERGE INTO products AS p
USING stock_feed AS f
   ON p.sku = f.sku
WHEN MATCHED AND f.discontinued THEN
     UPDATE SET stock = 0, tags = array_append(p.tags, 'discontinued')
WHEN MATCHED THEN
     UPDATE SET price = f.price, stock = f.stock
WHEN NOT MATCHED THEN
     INSERT (sku, name, category, price, stock)
     VALUES (f.sku, f.name, f.category, f.price, f.stock)
RETURNING merge_action() AS action, p.sku, p.price, p.stock, p.tags;     -- PG 17+`,
      explain: `<ul><li>For an expression/partial unique index, the conflict target must repeat the indexed expression <em>and</em> the index predicate so PostgreSQL can infer which index arbitrates. "ASHA@" conflicts with "asha@" among live rows, so nothing is inserted.</li>
<li>MERGE evaluates <code>WHEN</code> clauses in order for each source row: the first matching clause wins, so the discontinued branch must come before the generic MATCHED branch.</li>
<li><code>merge_action()</code> (PostgreSQL 17+) reports INSERT/UPDATE/DELETE per row — perfect for job logs. Add <code>WHEN NOT MATCHED BY SOURCE THEN UPDATE SET stock = 0</code> to also retire products missing from a <em>complete</em> feed.</li></ul>`,
      output: ` subscribers
-------------
           1
(1 row)

 action | sku      | price    | stock | tags
--------+----------+----------+-------+----------------------------
 UPDATE | SKU-0001 |  4999.00 |   140 | {new}
 UPDATE | SKU-0002 | 55051.52 |     0 | {office,sale,discontinued}
 INSERT | SKU-0301 |  8999.00 |    60 | {}
(3 rows)

MERGE 3`, run: true }
  ],
  compare: {
    bad: { sql: `-- Check-then-act in two statements (race condition)
-- Session A: SELECT 1 FROM daily_page_views WHERE product_id = 1 AND day = '2025-10-01';  -- none
-- Session B: SELECT 1 FROM daily_page_views WHERE product_id = 1 AND day = '2025-10-01';  -- none
-- Session A: INSERT INTO daily_page_views VALUES (1, '2025-10-01', 1);
-- Session B: INSERT INTO daily_page_views VALUES (1, '2025-10-01', 1);
--   ERROR: duplicate key value violates unique constraint "daily_page_views_pkey"
CREATE TABLE daily_page_views (product_id int, day date, views int, PRIMARY KEY (product_id, day));
INSERT INTO daily_page_views
SELECT 1, DATE '2025-10-01', 1
WHERE NOT EXISTS (SELECT 1 FROM daily_page_views WHERE product_id = 1 AND day = DATE '2025-10-01');`,
      why: 'The existence check and the insert are separate; concurrent sessions both pass the check, so one fails with a unique violation (or, without a unique key, duplicates appear). The application must catch and retry.', run: true },
    good: { sql: `CREATE TABLE daily_page_views (product_id int, day date, views int, PRIMARY KEY (product_id, day));
INSERT INTO daily_page_views AS v (product_id, day, views)
VALUES (1, DATE '2025-10-01', 1)
ON CONFLICT (product_id, day) DO UPDATE SET views = v.views + 1
RETURNING product_id, day, views;`,
      why: 'One atomic statement arbitrated by the unique index: concurrent calls never fail and never lose increments.', run: true }
  },
  mistakes: [
    'Implementing upsert as SELECT + INSERT/UPDATE in application code — race conditions and unique violations.',
    'Omitting the conflict target with DO UPDATE (not allowed) or targeting columns that have no unique index (<em>there is no unique or exclusion constraint matching the ON CONFLICT specification</em>).',
    'Confusing <code>EXCLUDED.col</code> (incoming) with <code>table.col</code> (existing), e.g. writing <code>stock = EXCLUDED.stock + EXCLUDED.stock</code>.',
    'Sending the same key twice in one multi-row upsert — <em>ON CONFLICT DO UPDATE command cannot affect row a second time</em>; deduplicate the input first (e.g. <code>SELECT DISTINCT ON (key)</code>).',
    'Using DO UPDATE that rewrites rows even when nothing changed — add <code>WHERE (t.a, t.b) IS DISTINCT FROM (EXCLUDED.a, EXCLUDED.b)</code>.',
    'Assuming MERGE is race-free like ON CONFLICT; under concurrent inserts it can still raise unique violations.'
  ],
  best: [
    'Back every upsert key with a UNIQUE constraint/index on the business key.',
    'Use DO NOTHING for idempotency, DO UPDATE for "latest wins" or counters.',
    'Guard DO UPDATE with a WHERE on version/timestamp to avoid stale overwrites and no-op updates.',
    'Use MERGE for batch synchronisation from staging tables; keep WHEN clauses ordered from most to least specific.',
    'Deduplicate input batches before upserting.',
    'Use RETURNING (old/new on PostgreSQL 18, merge_action() on 17+) to report inserts vs updates.'
  ],
  performance: `
<p>ON CONFLICT costs one unique-index probe per row plus the insert or update; DO UPDATE writes a new row version (and possibly index entries), so it generates bloat on hot rows like counters — consider batching increments or using HOT-friendly designs (no index on the counter column, fillfactor &lt; 100). Batch upserts (multi-row VALUES or <code>INSERT ... SELECT</code> from a staging table) are far faster than row-by-row calls. For very large syncs, MERGE from a COPY-loaded, indexed staging table is efficient because it runs as a single join; ensure the join key is indexed on the target.</p>`,
  security: `
<p>Upserts need both INSERT and UPDATE privileges on the target (DO UPDATE) — grant them per column where possible. Row-level security applies: policies for INSERT (<code>WITH CHECK</code>) and UPDATE (<code>USING</code> and <code>WITH CHECK</code>) are all enforced, so an upsert cannot overwrite another tenant\'s row. MERGE requires privileges for each action it may perform (INSERT, UPDATE, DELETE) plus SELECT on the source. Never build the conflict target or column lists from user input.</p>`,
  scenario: { title: 'Nightly product sync creates duplicates and overwrites fresh prices', steps: [
    '1. Find duplicates: SELECT sku, count(*) FROM products GROUP BY sku HAVING count(*) > 1 — the SKU column had no unique constraint.',
    '2. Clean up duplicates keeping the newest row, then ADD CONSTRAINT products_sku_key UNIQUE (sku).',
    '3. Replace the sync\'s "UPDATE then INSERT WHERE NOT EXISTS" with a MERGE from a staging table.',
    '4. Prices updated by merchandisers during the day were overwritten by the older feed: add a guard (WHEN MATCHED AND f.updated_at > p.updated_at).',
    '5. Log merge_action() counts per run and alert on unusual spikes.'
  ] },
  widgets: ['lab:txn'],
  interview: [
    { q: 'How do you implement an upsert in PostgreSQL?', a: 'INSERT ... ON CONFLICT (key_columns) DO UPDATE SET col = EXCLUDED.col (or DO NOTHING). It requires a unique index or constraint on the key; EXCLUDED refers to the proposed row and the table name/alias to the existing row. An optional WHERE on DO UPDATE makes the update conditional. It is atomic and concurrency-safe.' },
    { q: 'What is the difference between ON CONFLICT and MERGE?', a: 'ON CONFLICT is PostgreSQL-specific, needs a unique index as arbiter and guarantees insert-or-update even with concurrent inserts. MERGE (SQL standard, PG 15+) joins any source to the target and supports multiple conditional actions including DELETE and, since 17, NOT MATCHED BY SOURCE and RETURNING — but concurrent inserts of the same key can still cause unique violations. Use ON CONFLICT for OLTP upserts, MERGE for batch synchronisation.' },
    { q: 'Why does "cannot affect row a second time" occur?', a: 'A single INSERT ... ON CONFLICT DO UPDATE tried to update the same target row twice because the input contained duplicate keys. PostgreSQL forbids it since the result would depend on processing order. Deduplicate the input first.' },
    { q: 'How do you tell whether an upsert inserted or updated?', a: 'On PostgreSQL 18, RETURNING old IS NULL AS inserted (old/new row references). On older versions the common trick is RETURNING (xmax = 0) AS inserted, which relies on internals. MERGE offers merge_action() in RETURNING since 17.' }
  ],
  exercises: [
    { task: 'Make assigning employee 9 to project 4 idempotent: insert (9, 4, \'contributor\', 50) and ignore it if the assignment already exists. Return the inserted row (if any).', solution: `INSERT INTO employee_projects (employee_id, project_id, role, allocation_pct)
VALUES (9, 4, 'contributor', 50)
ON CONFLICT (employee_id, project_id) DO NOTHING
RETURNING *;`, run: true },
    { task: 'Upsert employee 9\'s assignment to project 4: if it exists, set role to \'lead\' and allocation to 60, returning old and new role.', solution: `INSERT INTO employee_projects AS ep (employee_id, project_id, role, allocation_pct)
VALUES (9, 4, 'lead', 60)
ON CONFLICT (employee_id, project_id) DO UPDATE
SET    role = EXCLUDED.role,
       allocation_pct = EXCLUDED.allocation_pct
RETURNING ep.employee_id, ep.project_id, old.role AS old_role, new.role AS new_role;`, run: true },
    { task: 'Upsert department budgets from a VALUES list (Engineering → 5500000, Legal → 700000 located in Mumbai), updating only when the budget actually changes.', solution: `INSERT INTO departments AS d (name, location, budget)
VALUES ('Engineering', 'Bengaluru', 5500000),
       ('Legal',       'Mumbai',     700000)
ON CONFLICT (name) DO UPDATE
SET    budget = EXCLUDED.budget
WHERE  d.budget IS DISTINCT FROM EXCLUDED.budget
RETURNING d.name, d.budget, old.budget AS previous_budget;`, run: true }
  ],
  challenge: { task: 'Use MERGE to synchronise the "Research" department\'s project list from a source table: update budget/status of matching projects by name, insert new projects, and mark projects of that department missing from the source as on_hold using WHEN NOT MATCHED BY SOURCE (restricted to department 8). Return merge_action() and project names.', hint: 'The NOT MATCHED BY SOURCE branch needs AND t.department_id = 8 so other departments\' projects are untouched.', solution: `CREATE TEMP TABLE research_projects (name text PRIMARY KEY, budget numeric(12,2), status text);
INSERT INTO research_projects VALUES
  ('Project Galaxy', 300000, 'active'),
  ('Project Quasar', 450000, 'planned');

MERGE INTO projects AS t
USING research_projects AS s
   ON t.name = s.name AND t.department_id = 8
WHEN MATCHED THEN
     UPDATE SET budget = s.budget, status = s.status
WHEN NOT MATCHED THEN
     INSERT (name, department_id, start_date, budget, status)
     VALUES (s.name, 8, DATE '2026-01-05', s.budget, s.status)
WHEN NOT MATCHED BY SOURCE AND t.department_id = 8 THEN
     UPDATE SET status = 'on_hold'
RETURNING merge_action() AS action, t.name, t.status, t.budget;`, run: true },
  related: ['crud-insert', 'crud-update', 'constraints', 'concurrency', 'transactions'],
  quiz: [
    { type: 'mcq', q: 'In ON CONFLICT DO UPDATE, what does EXCLUDED refer to?', options: ['The existing row', 'The row proposed for insertion', 'Rows deleted by the statement', 'A system table'], answer: 1, explain: 'EXCLUDED is the would-be-inserted row; the table name/alias refers to the existing row.' },
    { type: 'tf', q: 'INSERT ... ON CONFLICT requires a unique index or constraint matching the conflict target.', answer: true, explain: 'The arbiter must be a unique (or exclusion) index; otherwise PostgreSQL raises an error.' },
    { type: 'predict', q: 'Table counters(k PRIMARY KEY, n). Row (\'a\', 5) exists. Result?', code: `INSERT INTO counters AS c VALUES ('a', 1)
ON CONFLICT (k) DO UPDATE SET n = c.n + EXCLUDED.n
RETURNING n;`, options: ['1', '5', '6', 'Error'], answer: 2, explain: 'Existing 5 plus incoming 1.' },
    { type: 'mcq', q: 'Which MERGE clause handles target rows that have no matching source row?', options: ['WHEN MATCHED', 'WHEN NOT MATCHED', 'WHEN NOT MATCHED BY SOURCE (PG 17+)', 'ON CONFLICT'], answer: 2, explain: 'NOT MATCHED BY SOURCE was added in PostgreSQL 17.' },
    { type: 'bug', q: 'Why does this fail?', code: `INSERT INTO products (sku, name, category, price)
VALUES ('SKU-0500','A','audio',10), ('SKU-0500','B','audio',12)
ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name;`, options: ['sku is not unique', 'The same key appears twice in one command: "cannot affect row a second time"', 'EXCLUDED is read-only', 'price is missing'], answer: 1, explain: 'Deduplicate the input before upserting.' }
  ]
}
]);

/* ============================ MODULE: querying ============================ */
PGM.addLessons([
{
  id: 'querying-where-operators',
  module: 'querying',
  title: 'Filtering with WHERE: Comparison, AND/OR/NOT, IN, BETWEEN and Operator Precedence',
  level: 1,
  minutes: 18,
  summary: 'Write precise filters with comparison operators, AND/OR/NOT, IN, BETWEEN and ANY — and avoid the classic AND/OR precedence bug that silently returns the wrong rows.',
  objectives: [
    'Use comparison operators (=, <>, <, <=, >, >=) on numbers, text and dates',
    'Combine conditions with AND, OR and NOT and predict the result using operator precedence',
    'Use IN / NOT IN lists and = ANY(array) for membership tests',
    'Use BETWEEN (inclusive) correctly and know when to prefer half-open ranges',
    'Filter with subqueries in WHERE',
    'Write filters that can use indexes (sargable predicates)'
  ],
  concept: `
<p>The <code>WHERE</code> clause keeps only the rows for which a boolean condition is <strong>TRUE</strong> (rows where it is FALSE or UNKNOWN/NULL are dropped). It is evaluated per row, before grouping and before the select list.</p>
<p><strong>Analogy: a bouncer with a guest list.</strong> Every row walks up to the door. The bouncer checks the rules: "on the list AND over 18", "VIP OR has a ticket", "NOT banned". If the rules are written ambiguously ("VIP or has a ticket and is over 18" — does the age rule apply to VIPs?), the bouncer follows the official grammar, not your intention. That grammar is <strong>operator precedence</strong>.</p>
<h4>Operators</h4>
<table>
<tr><th>Operator</th><th>Meaning</th><th>Example</th></tr>
<tr><td><code>=</code>, <code>&lt;&gt;</code> (or <code>!=</code>)</td><td>equal / not equal</td><td><code>status = 'paid'</code></td></tr>
<tr><td><code>&lt;</code>, <code>&lt;=</code>, <code>&gt;</code>, <code>&gt;=</code></td><td>ordering (numbers, text by collation, dates)</td><td><code>order_date &gt;= '2025-01-01'</code></td></tr>
<tr><td><code>AND</code>, <code>OR</code>, <code>NOT</code></td><td>logical combination</td><td><code>is_active AND NOT (salary &lt; 50000)</code></td></tr>
<tr><td><code>IN (list)</code>, <code>NOT IN (list)</code></td><td>membership</td><td><code>country IN ('India', 'UAE')</code></td></tr>
<tr><td><code>= ANY (array)</code></td><td>membership against an array (great for parameters)</td><td><code>id = ANY ($1::int[])</code></td></tr>
<tr><td><code>BETWEEN a AND b</code></td><td><code>&gt;= a AND &lt;= b</code> (inclusive both ends)</td><td><code>price BETWEEN 10000 AND 30000</code></td></tr>
<tr><td><code>IS [NOT] NULL</code>, <code>IS [NOT] DISTINCT FROM</code></td><td>NULL-aware tests</td><td>next lesson</td></tr>
</table>
<h4>Precedence: NOT binds tighter than AND, AND binds tighter than OR</h4>
<p><code>a OR b AND c</code> means <code>a OR (b AND c)</code>, exactly like <code>1 + 2 × 3</code> means <code>1 + (2 × 3)</code>. Comparison operators (<code>=</code>, <code>&lt;</code>, <code>IN</code>, <code>BETWEEN</code>, <code>LIKE</code>) bind tighter than <code>NOT</code>. Rule for humans: <strong>whenever you mix AND and OR, add parentheses</strong>.</p>
<h4>Sargable predicates</h4>
<p>A predicate is <em>sargable</em> ("Search ARGument-able") when the planner can use an index for it: the indexed column stands alone on one side of the operator — <code>salary &gt; 100000</code>, <code>order_date &gt;= '2025-01-01'</code>. Wrapping the column in a function or arithmetic (<code>salary * 12 &gt; 1200000</code>, <code>date_trunc('day', order_date) = ...</code>) usually prevents a plain index from being used.</p>`,
  why: `
<p>Filtering is where most query bugs and most performance problems start. A misplaced OR returns thousands of extra rows that look plausible; a non-sargable filter turns a 2&nbsp;ms index lookup into a 20-second scan; a <code>NOT IN</code> against a list containing NULL returns nothing. Precise, index-friendly WHERE clauses are the foundation of every correct report and fast API.</p>`,
  useCase: `
<p><strong>A B2B marketplace's "risky orders" queue</strong> shows orders that are pending, above ₹5.5 lakh, and from new customers or high-risk payment methods. The first version, <code>WHERE status = 'pending' AND total_amount &gt; 550000 AND created_recently OR method = 'cod'</code>, flooded the queue with every COD order of the last two years, because the OR escaped the other conditions. Adding parentheses fixed the logic; rewriting <code>WHERE extract(year FROM order_date) = 2025</code> as a half-open date range let the new <code>(status, order_date)</code> index serve the query in milliseconds.</p>`,
  internals: `
<p>The planner splits the WHERE clause into AND-ed conditions ("quals"). Each qual that matches an index (column on one side, a constant or parameter on the other, compatible operator) can become an <code>Index Cond</code>; the rest become a <code>Filter</code> applied to each fetched row. OR conditions on different columns can use a <code>BitmapOr</code> of several indexes. <code>IN (list)</code> is converted to <code>= ANY('{...}')</code>, which a B-tree handles as a set of equality probes. The planner estimates <em>selectivity</em> for each qual from column statistics (most common values, histograms) and multiplies them for ANDs (assuming independence unless you create extended statistics) — misestimates there are a common cause of bad plans.</p>`,
  whenNot: `
<ul>
<li>Don't use <code>BETWEEN</code> for timestamps or other continuous ranges — use <code>&gt;= start AND &lt; end</code>.</li>
<li>Don't use <code>NOT IN (subquery)</code> when the subquery can return NULLs — use <code>NOT EXISTS</code>.</li>
<li>Don't build very long <code>IN</code> lists in SQL text (thousands of literals) — pass an array parameter (<code>= ANY($1)</code>) or join to a VALUES list/temp table.</li>
<li>Don't filter in application code what WHERE can filter in the database.</li>
</ul>`,
  syntax: `SELECT ... FROM ...
WHERE  column  =  | <> | < | <= | > | >=  value
  AND  ( cond_a OR cond_b )                  -- parenthesise mixed AND/OR
  AND  NOT condition
  AND  column [ NOT ] IN ( v1, v2, ... )
  AND  column = ANY ( array_expression )
  AND  column [ NOT ] BETWEEN [ SYMMETRIC ] low AND high
  AND  column IN ( SELECT ... );

-- precedence (high -> low): comparison/IN/BETWEEN/LIKE  >  NOT  >  AND  >  OR`,
  examples: [
    { label: 'Basic', title: 'Combining conditions with AND',
      sql: `SELECT id, first_name, last_name, job_title, salary
FROM   employees
WHERE  department_id = 1          -- Engineering
  AND  salary >= 120000
  AND  is_active                  -- boolean column used directly
ORDER  BY salary DESC;`,
      explain: `<p>All three conditions must be TRUE. <code>is_active</code> is already boolean, so <code>AND is_active</code> is enough (no <code>= true</code> needed). Each condition narrows the result: 200 employees → 25 in Engineering → 6 well-paid active ones.</p>`,
      output: ` id  | first_name | last_name | job_title          | salary
-----+------------+-----------+--------------------+-----------
   1 | Asha       | Rao       | Head of Department | 187500.00
  56 | Rahul      | Gupta     | Analyst            | 149800.00
 152 | Ishaan     | Agarwal   | Analyst            | 146600.00
 120 | Aarav      | Sharma    | Engineer           | 135400.00
 128 | Aditya     | Saxena    | Analyst            | 133100.00
 160 | Aarav      | Malhotra  | Lead               | 120500.00
(6 rows)`, run: true },
    { label: 'Intermediate', title: 'IN, BETWEEN, NOT and = ANY',
      sql: `-- Audio or video products in a mid price band (BETWEEN is inclusive)
SELECT id, name, category, price
FROM   products
WHERE  category IN ('audio', 'video')
  AND  price BETWEEN 10000 AND 30000
ORDER  BY price;

-- Projects that are neither completed nor on hold, with budget of at least 200,000
SELECT id, name, status, budget
FROM   projects
WHERE  status NOT IN ('completed', 'on_hold')
  AND  NOT (budget < 200000)
ORDER  BY budget
LIMIT  5;

-- Membership against an array (how applications pass a list as ONE parameter)
SELECT customer_id, count(*) AS orders
FROM   orders
WHERE  customer_id = ANY (ARRAY[7, 42, 220])
GROUP  BY customer_id
ORDER  BY customer_id;`,
      explain: `<ul><li><code>IN ('audio','video')</code> is shorthand for <code>category = 'audio' OR category = 'video'</code> — and it carries its own implicit parentheses, which avoids precedence mistakes.</li>
<li><code>BETWEEN 10000 AND 30000</code> includes both ends. Bounds must be low-to-high; <code>BETWEEN 30000 AND 10000</code> matches nothing (use <code>BETWEEN SYMMETRIC</code> if order is unknown).</li>
<li><code>NOT (budget &lt; 200000)</code> is the same as <code>budget &gt;= 200000</code> — prefer the positive form for readability.</li>
<li><code>= ANY (ARRAY[...])</code> lets a driver send one array parameter (<code>WHERE customer_id = ANY($1)</code>) instead of building a variable-length IN list — fewer distinct statements, better plan caching, no injection risk.</li></ul>`,
      output: ` id | name            | category | price
----+-----------------+----------+----------
 14 | Headset Plus 14 | audio    | 12586.18
 65 | Webcam Pro 65   | video    | 12940.90
 45 | Webcam Pro 45   | video    | 15514.77
 95 | Webcam Pro 95   | video    | 19738.06
 15 | Webcam Pro 15   | video    | 20869.62
 54 | Headset Plus 54 | audio    | 27583.88
 24 | Headset Plus 24 | audio    | 28178.91
(7 rows)

 id | name            | status  | budget
----+-----------------+---------+-----------
  4 | Project Delta   | planned | 200000.00
  5 | Project Eclipse | active  | 225000.00
  8 | Project Helix   | planned | 300000.00
  9 | Project Ion     | active  | 325000.00
 12 | Project Lumen   | planned | 400000.00
(5 rows)

 customer_id | orders
-------------+--------
           7 |     11
          42 |     10
         220 |     17
(3 rows)`, run: true },
    { label: 'Advanced', title: 'Subqueries in WHERE and how the planner uses your filters',
      sql: `-- Well-paid employees in departments located in Bengaluru
SELECT e.first_name, e.last_name, e.salary
FROM   employees e
WHERE  e.department_id IN (SELECT d.id FROM departments d WHERE d.location = 'Bengaluru')
  AND  e.salary > 140000
ORDER  BY e.salary DESC
LIMIT  5;

-- AND-ed conditions: one can become an index condition, the rest a filter
EXPLAIN (COSTS OFF)
SELECT id, first_name FROM employees
WHERE  department_id = 3 AND salary > 100000;

-- OR across different columns: needs a BitmapOr of indexes (or a seq scan)
EXPLAIN (COSTS OFF)
SELECT id, first_name FROM employees
WHERE  department_id = 3 OR salary > 200000;`,
      explain: `<p>The <code>IN (SELECT ...)</code> subquery is executed as a <em>semi-join</em>: each employee is kept if its department appears in the Bengaluru set (Engineering and Research).</p>
<p>The plans (on this tiny table the planner may prefer sequential scans; on large tables you would see index usage) show how WHERE conditions are applied: with AND, the indexed column <code>department_id</code> can drive an index or bitmap scan and <code>salary &gt; 100000</code> is checked as a <code>Filter</code>. With OR across two different columns, a single index on one column cannot answer the query alone.</p>`,
      output: ` first_name | last_name | salary
------------+-----------+-----------
 Nikhil     | Joshi     | 240000.00
 Asha       | Rao       | 187500.00
 Rahul      | Gupta     | 149800.00
 Pooja      | Patel     | 148800.00
 Ishaan     | Agarwal   | 146600.00
(5 rows)

 QUERY PLAN
------------------------------------------------------------------
 Seq Scan on employees
   Filter: ((salary > '100000'::numeric) AND (department_id = 3))
(2 rows)

 QUERY PLAN
-----------------------------------------------------------------
 Seq Scan on employees
   Filter: ((department_id = 3) OR (salary > '200000'::numeric))
(2 rows)

-- On a large table the first query would typically show:
--   Bitmap Heap Scan on employees
--     Recheck Cond: (department_id = 3)
--     Filter: (salary > '100000'::numeric)
--     ->  Bitmap Index Scan on idx_employees_department`, run: true }
  ],
  compare: {
    bad: { sql: `-- Intention: Indian or Emirati customers who are enterprise accounts
SELECT count(*) AS matched
FROM   customers
WHERE  country = 'India' OR country = 'UAE' AND segment = 'enterprise';`,
      why: 'AND binds tighter than OR, so this means India OR (UAE AND enterprise): all 188 Indian customers of any segment slip in — 250 rows instead of 62. No error, just wrong numbers.', run: true },
    good: { sql: `SELECT count(*) AS matched
FROM   customers
WHERE  country IN ('India', 'UAE')        -- or: (country = 'India' OR country = 'UAE')
  AND  segment = 'enterprise';`,
      why: 'IN (or explicit parentheses) groups the alternatives, so the segment filter applies to both countries: 62 rows.', run: true }
  },
  mistakes: [
    'Mixing AND and OR without parentheses.',
    'Writing <code>WHERE status = \'paid\' OR \'shipped\'</code> — the second operand is not a comparison; write <code>status IN (\'paid\', \'shipped\')</code>.',
    'Using <code>BETWEEN</code> with reversed bounds, or with timestamps (inclusive upper bound problems).',
    'Using <code>NOT IN</code> with a list or subquery that contains NULL.',
    'Writing non-sargable filters (<code>WHERE salary * 12 &gt; 1200000</code>) instead of <code>WHERE salary &gt; 100000</code>.',
    'Comparing values of different types and forcing implicit casts on the column side (e.g. comparing a text column to a number).'
  ],
  best: [
    'Parenthesise every mix of AND and OR, even when precedence would give the right answer.',
    'Prefer <code>IN</code> for lists of alternatives on one column, <code>= ANY($1)</code> for parameterised lists.',
    'Keep indexed columns "naked" on one side of comparisons.',
    'Use half-open ranges for dates/timestamps; BETWEEN for integers and inclusive business ranges.',
    'Put each condition on its own line starting with AND/OR for readable diffs.',
    'Always use bind parameters for values coming from users.'
  ],
  performance: `
<p>Selective, sargable predicates on indexed columns turn full scans into index lookups — the single biggest performance lever in SQL. Combine equality columns first and range columns last in composite indexes (e.g. <code>(status, order_date)</code> for <code>status = 'pending' AND order_date &gt;= ...</code>). OR across different columns can often be rewritten as <code>UNION ALL</code> of two index-friendly queries when the planner does not choose a BitmapOr. Large IN lists are fine up to thousands of values but each value is an index probe.</p>`,
  security: `
<p>WHERE clauses built by concatenating user input are the classic SQL-injection vector: <code>"... WHERE email = '" + input + "'"</code> with input <code>' OR '1'='1</code> returns every row. Always use parameters (<code>WHERE email = $1</code>). For multi-tenant applications, a forgotten <code>AND tenant_id = $tenant</code> leaks data across customers — row-level security makes that filter mandatory at the database level.</p>`,
  interview: [
    { q: 'What is the precedence of AND, OR and NOT in SQL?', a: 'NOT binds tightest, then AND, then OR (all lower than comparison operators). So a OR b AND c means a OR (b AND c). Use parentheses whenever AND and OR are mixed to make intent explicit.' },
    { q: 'Is BETWEEN inclusive?', a: 'Yes: x BETWEEN a AND b is x >= a AND x <= b. Bounds must be in ascending order unless BETWEEN SYMMETRIC is used. For timestamps prefer half-open ranges (>= start AND < end) to avoid missing or double-counting boundary values.' },
    { q: 'What does sargable mean and why does it matter?', a: 'A predicate is sargable when it can be satisfied by an index search: the column appears unmodified on one side of a supported operator. Wrapping the column in functions or arithmetic usually forces a scan of every row unless a matching expression index exists.' },
    { q: 'How would you pass a variable list of ids to a query from an application?', a: 'Use a single array parameter: WHERE id = ANY($1::bigint[]). It avoids dynamic SQL, keeps the statement text stable for plan caching, and is injection-safe. For very large lists, load them into a temporary table or use unnest($1) in a join.' }
  ],
  exercises: [
    { task: 'List successful card or UPI payments above 500,000, showing id, order_id, method and amount, largest first.', solution: `SELECT id, order_id, method, amount
FROM   payments
WHERE  status = 'success'
  AND  method IN ('card', 'upi')
  AND  amount > 500000
ORDER  BY amount DESC
LIMIT  10;`, run: true },
    { task: 'Count orders whose total_amount is between 100,000 and 200,000 (inclusive), and verify the same count with explicit >= and <= operators.', solution: `SELECT count(*) FILTER (WHERE total_amount BETWEEN 100000 AND 200000)            AS with_between,
       count(*) FILTER (WHERE total_amount >= 100000 AND total_amount <= 200000) AS with_operators
FROM   orders;`, run: true },
    { task: 'Find customers from the UK or Germany who are in the consumer or smb segment. Use parentheses or IN so the logic is unambiguous; return the count per country and segment.', solution: `SELECT country, segment, count(*)
FROM   customers
WHERE  country IN ('UK', 'Germany')
  AND  segment IN ('consumer', 'smb')
GROUP  BY country, segment
ORDER  BY country, segment;`, run: true }
  ],
  challenge: { task: 'Build a "risky orders" list: orders that are pending AND (total above 600,000 OR the customer is from the UAE or Singapore AND the order was placed in 2025). Show id, customer country, status, total and order date, newest first, max 10 rows. Be careful with precedence.', hint: 'Join orders to customers; group the OR alternatives with parentheses; use a half-open range for 2025.', solution: `SELECT o.id, c.country, o.status, o.total_amount, o.order_date
FROM   orders o
JOIN   customers c ON c.id = o.customer_id
WHERE  o.status = 'pending'
  AND  (   o.total_amount > 600000
        OR (    c.country IN ('UAE', 'Singapore')
            AND o.order_date >= '2025-01-01'
            AND o.order_date <  '2026-01-01'))
ORDER  BY o.order_date DESC
LIMIT  10;`, run: true },
  related: ['querying-null-pattern-matching', 'sql-fundamentals-logical-order-nulls', 'indexes', 'subqueries'],
  quiz: [
    { type: 'predict', q: 'Which rows match?', code: `WHERE country = 'India' OR country = 'UAE' AND segment = 'enterprise'`, options: ['Enterprise customers from India or UAE', 'All Indian customers plus enterprise customers from UAE', 'Only UAE enterprise customers', 'No rows'], answer: 1, explain: 'AND binds tighter: India OR (UAE AND enterprise).' },
    { type: 'tf', q: 'price BETWEEN 100 AND 200 includes rows where price is exactly 200.', answer: true, explain: 'BETWEEN is inclusive at both ends.' },
    { type: 'bug', q: 'What is wrong with this filter?', code: `SELECT * FROM orders WHERE status = 'paid' OR 'shipped';`, options: ['OR is not allowed in WHERE', 'The right side of OR is a bare string, not a comparison; PostgreSQL tries to read \'shipped\' as a boolean and fails. Write status IN (\'paid\', \'shipped\')', 'status must be indexed', 'Missing ORDER BY'], answer: 1, explain: 'Each side of OR must be a boolean expression. PostgreSQL raises: invalid input syntax for type boolean: "shipped".' },
    { type: 'optimize', q: 'orders has an index on order_date. Which filter can use it?', code: `-- find orders from March 2025`, options: ['WHERE extract(month FROM order_date) = 3 AND extract(year FROM order_date) = 2025', 'WHERE to_char(order_date, \'YYYY-MM\') = \'2025-03\'', 'WHERE order_date >= \'2025-03-01\' AND order_date < \'2025-04-01\'', 'WHERE order_date::text LIKE \'2025-03%\''], answer: 2, explain: 'Only the plain range keeps the column unmodified (sargable).' },
    { type: 'mcq', q: 'Best way to pass 500 product ids from an application into a WHERE clause?', options: ['Concatenate them into an IN (...) string', 'WHERE id = ANY($1::int[]) with one array parameter', '500 separate queries', 'A LIKE pattern'], answer: 1, explain: 'One parameter, stable SQL text, injection-safe.' }
  ]
},
{
  id: 'querying-null-pattern-matching',
  module: 'querying',
  title: 'Pattern Matching (LIKE, ILIKE, SIMILAR TO, Regex ~) and NULL Handling (IS NULL, IS DISTINCT FROM)',
  level: 1,
  minutes: 20,
  summary: 'Search text with LIKE/ILIKE wildcards, SIMILAR TO and POSIX regular expressions, extract parts with regex functions, and filter NULLs correctly with IS NULL and IS DISTINCT FROM.',
  objectives: [
    'Use LIKE and ILIKE with % and _ wildcards, and escape them when needed',
    'Know what SIMILAR TO is and why POSIX regular expressions (~, ~*, !~) are usually preferred',
    'Extract and transform text with substring(... from pattern), regexp_match, regexp_replace',
    'Understand which patterns can use an index (prefix LIKE, pg_trgm for contains)',
    'Filter NULLs with IS NULL / IS NOT NULL and compare NULL-safely with IS [NOT] DISTINCT FROM',
    'Avoid the "<> silently drops NULL rows" trap'
  ],
  concept: `
<h4>Pattern matching operators</h4>
<table>
<tr><th>Operator</th><th>Pattern language</th><th>Case</th><th>Example</th></tr>
<tr><td><code>LIKE</code> / <code>NOT LIKE</code></td><td><code>%</code> = any sequence, <code>_</code> = exactly one character</td><td>sensitive</td><td><code>name LIKE 'Desk%'</code></td></tr>
<tr><td><code>ILIKE</code> / <code>NOT ILIKE</code></td><td>same as LIKE</td><td>insensitive (PostgreSQL extension)</td><td><code>title ILIKE '%postgres%'</code></td></tr>
<tr><td><code>SIMILAR TO</code></td><td>SQL-standard hybrid: LIKE wildcards + <code>|</code>, <code>()</code>, <code>*</code>, <code>+</code>, <code>[...]</code></td><td>sensitive</td><td><code>name SIMILAR TO '(Desk|Chair) %'</code></td></tr>
<tr><td><code>~</code>, <code>~*</code>, <code>!~</code>, <code>!~*</code></td><td>POSIX regular expressions (unanchored)</td><td><code>~*</code> insensitive</td><td><code>sku ~ '^SKU-[0-9]{4}$'</code></td></tr>
</table>
<p><strong>Analogy: searching a phone book.</strong> <code>LIKE 'Sha%'</code> is flipping to the "Sha" page — fast, because the book is sorted (an index helps). <code>LIKE '%sha%'</code> is reading every name looking for "sha" anywhere — slow, unless you have a special index of all three-letter fragments (the <code>pg_trgm</code> <span class="tag ext">extension</span>). Regular expressions are a detective's description: "starts with Desk or Chair, then a word, then a two-digit number".</p>
<p>LIKE must match the <em>entire</em> string (<code>'Desk Air 6' LIKE 'Desk'</code> is false); regex matches anywhere unless anchored with <code>^</code> and <code>$</code>. To match a literal <code>%</code> or <code>_</code> in LIKE, escape it: <code>LIKE '100\\%'</code> (backslash is the default escape character) or choose your own with <code>ESCAPE '!'</code>.</p>
<h4>Regex functions</h4>
<ul>
<li><code>substring(s from 'pattern')</code> — first match (or first capture group).</li>
<li><code>regexp_match(s, pattern)</code> → text[] of capture groups; <code>regexp_matches(..., 'g')</code> returns all matches as rows.</li>
<li><code>regexp_replace(s, pattern, replacement, 'g')</code> — replace all matches.</li>
<li><code>regexp_like</code>, <code>regexp_count</code>, <code>regexp_instr</code>, <code>regexp_substr</code> (PostgreSQL 15+).</li>
</ul>
<h4>NULL handling in filters</h4>
<ul>
<li><code>col IS NULL</code> / <code>col IS NOT NULL</code> — the only correct way to test for NULL (<code>col = NULL</code> is never true).</li>
<li><code>a IS DISTINCT FROM b</code> — NULL-safe <code>&lt;&gt;</code>: treats two NULLs as equal and NULL vs value as different.</li>
<li><code>a IS NOT DISTINCT FROM b</code> — NULL-safe <code>=</code>.</li>
<li>Pattern operators follow the same rule: <code>NULL LIKE '%x%'</code> is NULL, and <code>NOT LIKE</code> does not return NULL rows either.</li>
</ul>`,
  why: `
<p>Users search: by partial names, email domains, codes and messy free text. Pattern matching makes those searches possible inside the database, and regex functions clean and parse imported data (phone numbers, SKUs, log lines). NULL-aware comparison matters wherever data is optional: "all orders not marked as paid", "rows whose value changed" — naive <code>&lt;&gt;</code> comparisons silently drop NULLs and produce plausible but wrong results.</p>`,
  useCase: `
<p><strong>A customer-support console</strong> lets agents search customers by any fragment of name or email. <code>ILIKE '%' || $1 || '%'</code> worked on 5,000 customers but took 4 seconds at 8 million. The team installed <code>pg_trgm</code> and created <code>CREATE INDEX ... USING gin (email gin_trgm_ops)</code>; the same ILIKE query now uses the trigram index and returns in 15&nbsp;ms. A data-quality job uses <code>regexp_replace(phone, '[^0-9+]', '', 'g')</code> to normalise phone numbers and <code>WHERE email !~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'</code> to flag malformed emails. A change-tracking query uses <code>WHERE old.manager_id IS DISTINCT FROM new.manager_id</code> so moving an employee from "no manager" to a manager is detected.</p>`,
  internals: `
<p>A B-tree index can serve <code>LIKE 'prefix%'</code> (and regex anchored with <code>^prefix</code>) only if comparisons follow byte order: with the <code>"C"</code> collation, or with an index built using the <code>text_pattern_ops</code> operator class under other collations. Patterns starting with a wildcard cannot use a B-tree at all; the <code>pg_trgm</code> extension splits strings into 3-character "trigrams" and a GIN or GiST trigram index can then serve <code>LIKE/ILIKE '%x%'</code> and regex searches. Regular expressions are compiled per query and matched with PostgreSQL's Spencer-derived regex engine (ARE flavour: supports <code>\\d</code>, <code>\\w</code>, <code>\\s</code>, lookahead, non-greedy quantifiers). <code>IS DISTINCT FROM</code> is not indexable as an inequality, but <code>IS NULL</code> can use a B-tree index (NULLs are stored in indexes).</p>`,
  whenNot: `
<ul>
<li>Don't use <code>LIKE '%word%'</code> for real full-text search over documents (stemming, ranking, phrases) — use full-text search (<code>tsvector</code>/<code>tsquery</code>), which company_db's <code>documents.search</code> column is built for.</li>
<li>Don't use <code>SIMILAR TO</code> in new code — it is rarely the clearest choice; use LIKE for simple wildcards and <code>~</code> for real patterns.</li>
<li>Don't validate complex formats (emails, URLs) only with regex in queries — enforce them once with CHECK constraints or domains.</li>
<li>Don't run unanchored regexes over millions of rows on a hot path without a trigram index.</li>
</ul>`,
  syntax: `string [NOT] LIKE  pattern [ESCAPE 'c']       -- % any sequence, _ one char
string [NOT] ILIKE pattern                      -- case-insensitive
string [NOT] SIMILAR TO pattern
string ~ regex   string ~* regex   string !~ regex   string !~* regex

substring(string FROM regex)  regexp_match(string, regex [, flags])
regexp_matches(string, regex, 'g')  regexp_replace(string, regex, replacement [, flags])
regexp_like(string, regex)  regexp_count(string, regex)          -- PG 15+

expr IS [NOT] NULL
a IS [NOT] DISTINCT FROM b

CREATE EXTENSION pg_trgm;  CREATE INDEX ON t USING gin (col gin_trgm_ops);`,
  examples: [
    { label: 'Basic', title: 'LIKE and ILIKE wildcards',
      sql: `-- _ matches exactly one character: Customer 10 .. Customer 19
SELECT id, name
FROM   customers
WHERE  name LIKE 'Customer 1_'
ORDER  BY id
LIMIT  5;

-- Case sensitivity and "contains"
SELECT count(*) FILTER (WHERE name LIKE  'Desk%')   AS like_desk,
       count(*) FILTER (WHERE name LIKE  'desk%')   AS like_lowercase,
       count(*) FILTER (WHERE name ILIKE 'desk%')   AS ilike_desk,
       count(*) FILTER (WHERE name LIKE  '%Pro%')   AS contains_pro,
       count(*) FILTER (WHERE name NOT LIKE '%Pro%') AS not_pro
FROM   products;

SELECT title FROM documents WHERE title ILIKE '%postgres%' ORDER BY id;`,
      explain: `<ul><li><code>'Customer 1_'</code> matches "Customer 1" followed by exactly one character — not "Customer 1" or "Customer 100".</li>
<li>LIKE is case-sensitive: <code>'desk%'</code> finds nothing. ILIKE ignores case.</li>
<li><code>'%Pro%'</code> means "contains Pro anywhere" — note it also matches "Professional", "Product"…</li>
<li><code>ILIKE '%postgres%'</code> finds "PostgreSQL" in titles regardless of case.</li></ul>`,
      output: ` id | name
----+-------------
 10 | Customer 10
 11 | Customer 11
 12 | Customer 12
 13 | Customer 13
 14 | Customer 14
(5 rows)

 like_desk | like_lowercase | ilike_desk | contains_pro | not_pro
-----------+----------------+------------+--------------+---------
        10 |              0 |         10 |           20 |      80
(1 row)

 title
------------------------------------
 Indexing strategies for PostgreSQL
 Securing PostgreSQL connections
(2 rows)`, run: true },
    { label: 'Intermediate', title: 'SIMILAR TO vs regular expressions, and regex functions',
      sql: `-- Desks or chairs whose model number is a two-digit number starting with 1 or 2
SELECT sku, name FROM products
WHERE  name SIMILAR TO '(Desk|Chair) % (1|2)_'
ORDER  BY id;

-- The same with a POSIX regex (anchored explicitly)
SELECT sku, name FROM products
WHERE  name ~ '^(Desk|Chair) \\w+ [12][0-9]$'
ORDER  BY id;

-- Parse product names: model number, family, tier
SELECT name,
       substring(name FROM '[0-9]+$')            AS model_no,
       regexp_replace(name, '\\s+\\d+$', '')        AS family,
       (regexp_match(name, '^(\\w+) (\\w+)'))[2]    AS tier
FROM   products
WHERE  id <= 5
ORDER  BY id;`,
      explain: `<ul><li><code>SIMILAR TO</code> uses <code>%</code>/<code>_</code> like LIKE plus regex alternation <code>|</code> and grouping, and must match the whole string.</li>
<li>The regex uses <code>^</code>/<code>$</code> anchors, <code>\\w+</code> (a word) and character classes <code>[12][0-9]</code>. Without anchors a regex matches anywhere in the string.</li>
<li><code>substring(... FROM '[0-9]+$')</code> extracts the trailing number; <code>regexp_replace</code> strips it; <code>regexp_match</code> returns capture groups as an array — <code>[2]</code> picks the second word.</li></ul>`,
      output: ` sku      | name
----------+--------------
 SKU-0016 | Desk Air 16
 SKU-0017 | Chair Max 17
 SKU-0026 | Desk Air 26
 SKU-0027 | Chair Max 27
(4 rows)

(the regex query returns the same 4 rows)

 name           | model_no | family       | tier
----------------+----------+--------------+------
 Monitor Air 1  | 1        | Monitor Air  | Air
 Keyboard Max 2 | 2        | Keyboard Max | Max
 Mouse Lite 3   | 3        | Mouse Lite   | Lite
 Headset Plus 4 | 4        | Headset Plus | Plus
 Webcam Pro 5   | 5        | Webcam Pro   | Pro
(5 rows)`, run: true },
    { label: 'Advanced', title: 'NULL-aware filtering and a trigram index for contains-search',
      sql: `-- 18 of 24 projects have no end_date
SELECT count(*) FILTER (WHERE end_date IS NULL)                        AS open_ended,
       count(*) FILTER (WHERE end_date IS NOT NULL)                    AS has_end_date,
       count(*) FILTER (WHERE end_date <> DATE '2024-09-21')           AS not_equal_naive,
       count(*) FILTER (WHERE end_date IS DISTINCT FROM DATE '2024-09-21') AS not_equal_null_safe
FROM   projects;

-- NULL-safe equality truth table
SELECT a, b,
       a = b                      AS equals,
       a IS NOT DISTINCT FROM b   AS null_safe_equals
FROM  (VALUES (1, 1), (1, 2), (1, NULL), (NULL::int, NULL::int)) AS v(a, b);

-- Make "contains" searches indexable with pg_trgm (an extension shipped with PostgreSQL)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_customers_email_trgm ON customers USING gin (email gin_trgm_ops);
SELECT id, name, email
FROM   customers
WHERE  email ILIKE '%customer42%'
ORDER  BY id;`,
      explain: `<ul><li><code>end_date &lt;&gt; '2024-09-21'</code> finds only 5 rows: the 18 NULL end dates are neither equal nor unequal, so they disappear. <code>IS DISTINCT FROM</code> counts them as different (23).</li>
<li>The truth table shows <code>=</code> returning NULL whenever either side is NULL, while <code>IS NOT DISTINCT FROM</code> always returns true/false.</li>
<li>With a GIN trigram index, <code>ILIKE '%customer42%'</code> can use a <em>Bitmap Index Scan</em> instead of reading every row — the standard fix for "search box" queries. Note it matches customer42, customer420 … customer429.</li></ul>`,
      output: ` open_ended | has_end_date | not_equal_naive | not_equal_null_safe
------------+--------------+-----------------+---------------------
         18 |            6 |               5 |                  23
(1 row)

 a | b | equals | null_safe_equals
---+---+--------+------------------
 1 | 1 | t      | t
 1 | 2 | f      | f
 1 |   |        | f
   |   |        | t
(4 rows)

 id  | name         | email
-----+--------------+-------------------------
  42 | Customer 42  | customer42@example.com
 420 | Customer 420 | customer420@example.com
 421 | Customer 421 | customer421@example.com
 ...
(11 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- "Employees whose manager is not Rohan (id 2)" in the Sales department
SELECT count(*) AS result
FROM   employees
WHERE  department_id = 2
  AND  manager_id <> 2;`,
      why: 'Rohan himself (the department head) has manager_id NULL; NULL <> 2 is UNKNOWN, so he is silently excluded — the answer is 0 although one employee qualifies.', run: true },
    good: { sql: `SELECT count(*) AS result
FROM   employees
WHERE  department_id = 2
  AND  manager_id IS DISTINCT FROM 2;`,
      why: 'IS DISTINCT FROM treats NULL as a comparable value, so the department head (no manager) is correctly counted: 1.', run: true }
  },
  mistakes: [
    'Writing <code>WHERE col = NULL</code> or <code>col != NULL</code> — always UNKNOWN; use <code>IS [NOT] NULL</code>.',
    'Using <code>&lt;&gt;</code>/<code>NOT LIKE</code>/<code>NOT IN</code> on nullable columns and losing NULL rows.',
    'Expecting <code>LIKE \'abc\'</code> to mean "contains abc" — without <code>%</code> it is an exact match.',
    'Forgetting to anchor regexes (<code>~ \'[0-9]{4}\'</code> matches any string containing 4 digits).',
    'Searching with <code>LIKE \'%term%\'</code> on large tables without a trigram index — full scans.',
    'Not escaping <code>%</code> and <code>_</code> from user input in LIKE patterns, so "50%" matches "500" or "5000".'
  ],
  best: [
    'Use LIKE/ILIKE for simple prefix/contains, <code>~</code> for real patterns; skip SIMILAR TO.',
    'Anchor regex patterns with <code>^...$</code> when validating whole values.',
    'Index prefix searches with B-tree (<code>text_pattern_ops</code> or "C" collation) and contains/regex searches with <code>pg_trgm</code> GIN indexes.',
    'Escape user-supplied LIKE metacharacters, or use <code>position(term IN col) &gt; 0</code> / <code>strpos</code> for literal contains (not indexable, but safe).',
    'Use <code>IS DISTINCT FROM</code> for change detection and comparisons on nullable columns.',
    'Prefer NOT NULL columns so NULL logic is needed only where "unknown" is meaningful.'
  ],
  performance: `
<p><code>LIKE 'abc%'</code> is a range scan on a suitable B-tree index; <code>LIKE '%abc'</code> and <code>'%abc%'</code> need <code>pg_trgm</code> (GIN for fastest lookups, GiST also supports similarity ordering). Trigram indexes work best with search terms of at least 3 characters. Case-insensitive search: ILIKE with a trigram index, or <code>lower(col) LIKE 'abc%'</code> with an expression index. Regex evaluation is CPU-heavy per row — filter with indexable predicates first. <code>IS NULL</code> conditions can use B-tree indexes, and partial indexes (<code>WHERE end_date IS NULL</code>) are ideal for "open items" queries.</p>`,
  security: `
<p>Pattern strings built from user input need two layers of protection: bind parameters against SQL injection, and escaping of <code>%</code>, <code>_</code> and backslash so users cannot craft expensive or overly broad patterns. User-supplied regular expressions can be catastrophically slow (ReDoS) — avoid accepting raw regex from users, or enforce <code>statement_timeout</code>.</p>`,
  interview: [
    { q: 'What is the difference between LIKE, ILIKE and ~?', a: 'LIKE uses % and _ wildcards and must match the whole string, case-sensitively. ILIKE is the case-insensitive PostgreSQL variant. ~ applies a POSIX regular expression that matches anywhere unless anchored, with ~* for case-insensitive and !~ for negation.' },
    { q: 'How do you make LIKE \'%term%\' fast on a large table?', a: 'Install the pg_trgm extension and create a GIN (or GiST) index with gin_trgm_ops on the column. The planner can then use the trigram index for LIKE, ILIKE and regex predicates, including leading wildcards. For prefix-only searches a B-tree with text_pattern_ops suffices.' },
    { q: 'What is IS DISTINCT FROM used for?', a: 'NULL-safe comparison: it never returns NULL. Two NULLs are not distinct; NULL and a value are distinct. It is used for change detection (old vs new values), filters on nullable columns and upsert guards, where <> would silently ignore NULLs.' }
  ],
  exercises: [
    { task: 'Find customers whose email does NOT end with @example.com (should be none in company_db) using NOT LIKE, and also count them with a regex.', solution: `SELECT count(*) FILTER (WHERE email NOT LIKE '%@example.com')  AS not_like,
       count(*) FILTER (WHERE email !~ '@example\\.com$')        AS regex_count
FROM   customers;`, run: true },
    { task: 'List document titles containing the word "index" or "indexing" in any case, using a case-insensitive regex.', solution: `SELECT id, title
FROM   documents
WHERE  title ~* '\\mindex(ing|es)?\\M'
ORDER  BY id;`, run: true },
    { task: 'Count audit_logs rows by operation showing how many have NULL old_data and how many have NULL new_data.', solution: `SELECT operation,
       count(*) FILTER (WHERE old_data IS NULL) AS no_old_data,
       count(*) FILTER (WHERE new_data IS NULL) AS no_new_data,
       count(*)                                 AS total
FROM   audit_logs
GROUP  BY operation
ORDER  BY operation;`, run: true }
  ],
  challenge: { task: 'Data-quality report for employees: (1) emails that do not match the pattern firstname.lastname<digits>@company.com (lower case), (2) names containing anything other than letters, and (3) employees whose manager_id differs from their department head\'s id in a NULL-safe way (heads excluded). Return a count for each check.', hint: 'Build the expected email with lower(first_name || \'.\' || last_name) and a regex; join employees to the head (id = department_id) and use IS DISTINCT FROM.', solution: `SELECT
  count(*) FILTER (WHERE e.email !~ ('^' || lower(e.first_name) || '\\.' || lower(e.last_name) || '[0-9]+@company\\.com$'))
                                                         AS bad_email_format,
  count(*) FILTER (WHERE e.first_name !~ '^[A-Za-z]+$' OR e.last_name !~ '^[A-Za-z]+$')
                                                         AS non_letter_names,
  count(*) FILTER (WHERE e.manager_id IS DISTINCT FROM h.id AND e.id <> h.id)
                                                         AS not_reporting_to_head
FROM   employees e
JOIN   employees h ON h.id = e.department_id;`, run: true },
  related: ['querying-where-operators', 'sql-fundamentals-logical-order-nulls', 'full-text-search', 'extensions'],
  quiz: [
    { type: 'predict', q: 'What does this return?', code: `SELECT 'Desk Air 6' LIKE 'Desk', 'Desk Air 6' ~ 'Desk';`, options: ['true, true', 'false, true', 'false, false', 'true, false'], answer: 1, explain: 'LIKE must match the whole string; an unanchored regex matches anywhere.' },
    { type: 'mcq', q: 'Which index lets WHERE name ILIKE \'%air%\' avoid a full scan?', options: ['B-tree on name', 'Hash index on name', 'GIN index with gin_trgm_ops (pg_trgm)', 'BRIN on name'], answer: 2, explain: 'Leading wildcards need a trigram index.' },
    { type: 'predict', q: 'Table t has values 1, 2 and NULL in column x. How many rows?', code: `SELECT count(*) FROM t WHERE x <> 1;`, options: ['1', '2', '3', '0'], answer: 0, explain: 'Only x = 2; NULL <> 1 is UNKNOWN and filtered out.' },
    { type: 'tf', q: 'NULL IS NOT DISTINCT FROM NULL returns true.', answer: true, explain: 'IS NOT DISTINCT FROM treats NULLs as equal.' },
    { type: 'bug', q: 'A search for "50%" returns products named "500 GB" and "5000 mAh". Why?', code: `WHERE name LIKE '%' || $1 || '%'   -- $1 = '50%'`, options: ['LIKE is case-insensitive', 'The user\'s % is treated as a wildcard; escape %, _ and \\ in user input', 'Missing ORDER BY', 'The column is not indexed'], answer: 1, explain: 'Escape LIKE metacharacters from user input (or use strpos for literal search).' }
  ]
},
{
  id: 'querying-order-limit-pagination',
  module: 'querying',
  title: 'ORDER BY (NULLS FIRST/LAST), LIMIT/OFFSET, FETCH FIRST and Keyset Pagination',
  level: 2,
  minutes: 22,
  summary: 'Sort deterministically, control where NULLs go, take top-N rows with LIMIT or FETCH FIRST ... WITH TIES, and paginate large result sets with keyset (seek) pagination instead of slow OFFSET.',
  objectives: [
    'Sort by multiple keys, expressions and aliases, ascending or descending',
    'Control NULL placement with NULLS FIRST / NULLS LAST',
    'Make ordering deterministic with a unique tie-breaker',
    'Use LIMIT/OFFSET and the SQL-standard FETCH FIRST ... ROWS ONLY / WITH TIES',
    'Explain why large OFFSETs are slow and inconsistent',
    'Implement keyset pagination with row-value comparisons and a matching index'
  ],
  concept: `
<p>Without <code>ORDER BY</code>, SQL returns rows in <strong>no guaranteed order</strong>. Whenever order matters — "latest orders", "top 10 products", page 3 of a list — you must ask for it explicitly.</p>
<p><strong>Analogy: a library's returned-books trolley.</strong> Books arrive in random order. To shelve them you sort by author, then title (multiple keys). Books with no author label (NULL) go either first or last on the trolley — you decide (<code>NULLS FIRST/LAST</code>). "Give me the first 20 books" is <code>LIMIT 20</code>. For "the next 20", OFFSET is counting from the start every time — 20, 40, 60… you recount the whole trolley for every page. Keyset pagination is putting a bookmark in after the last book you took and continuing from there.</p>
<h4>ORDER BY</h4>
<ul>
<li>Keys: columns, expressions (<code>price * stock</code>), output aliases or positions (<code>ORDER BY 2</code> — avoid in production code).</li>
<li>Direction per key: <code>ASC</code> (default) or <code>DESC</code>.</li>
<li>NULLs: by default PostgreSQL treats NULL as <em>larger</em> than any value — so they come <strong>last in ASC</strong> and <strong>first in DESC</strong>. Override with <code>NULLS FIRST</code> / <code>NULLS LAST</code>.</li>
<li>Text sorts by the column's collation (linguistic or byte order).</li>
<li>Custom orders: <code>ORDER BY CASE status WHEN 'pending' THEN 1 ... END</code> or <code>array_position(ARRAY[...], status)</code>.</li>
<li><strong>Determinism</strong>: if the keys are not unique (e.g. two orders at the same timestamp), equal rows may come back in any order and may jump between pages. Always end with a unique tie-breaker such as <code>id</code>.</li>
</ul>
<h4>Limiting rows</h4>
<table>
<tr><th>Syntax</th><th>Meaning</th></tr>
<tr><td><code>LIMIT n OFFSET m</code></td><td>Skip m rows, return the next n (PostgreSQL/MySQL style)</td></tr>
<tr><td><code>OFFSET m ROWS FETCH FIRST n ROWS ONLY</code></td><td>SQL standard equivalent</td></tr>
<tr><td><code>FETCH FIRST n ROWS WITH TIES</code></td><td>Also return rows tied with the last one on the ORDER BY keys (PostgreSQL 13+)</td></tr>
</table>
<h4>OFFSET vs keyset pagination</h4>
<p><code>OFFSET 100000</code> forces PostgreSQL to produce and throw away 100,000 rows before returning the page — page 5,000 is 5,000× more work than page 1. Results also shift when rows are inserted or deleted between page loads (duplicates or missed rows). <strong>Keyset pagination</strong> remembers the sort key of the last row shown and asks for rows "after" it: <code>WHERE (order_date, id) &lt; ($last_date, $last_id) ORDER BY order_date DESC, id DESC LIMIT 20</code>. With an index on <code>(order_date, id)</code>, every page costs the same few page reads.</p>`,
  why: `
<p>Sorting and pagination are part of nearly every user-facing list and API. Non-deterministic ordering causes flaky tests and pagination glitches ("I saw this order twice"); NULL placement causes confusing reports ("why are undated projects at the top?"); deep OFFSET pagination is a classic production performance killer, especially when bots crawl page 10,000 of a listing. Knowing these tools lets you build lists that are correct, stable and fast at any scale.</p>`,
  useCase: `
<p><strong>An order-history API for a marketplace</strong> with 300 million orders. Version 1 used <code>ORDER BY order_date DESC LIMIT 50 OFFSET $page*50</code>. Customers with thousands of orders and a scraping bot that walked to page 20,000 caused 8-second queries and CPU saturation. Version 2 returns an opaque cursor containing <code>(order_date, id)</code> of the last row; the next request runs <code>WHERE customer_id = $1 AND (order_date, id) &lt; ($2, $3) ORDER BY order_date DESC, id DESC LIMIT 50</code> served by the index <code>(customer_id, order_date DESC, id DESC)</code>. Every page now takes ~1&nbsp;ms regardless of depth, and new orders arriving during browsing no longer shift pages.</p>`,
  internals: `
<p>PostgreSQL satisfies ORDER BY either by reading an index in order (no sort at all — an <code>Index Scan</code> or <code>Index Scan Backward</code>) or by a <code>Sort</code> node. With LIMIT, the sort becomes a <strong>top-N heapsort</strong> that only keeps N rows in memory. Sorts larger than <code>work_mem</code> spill to temporary files (<code>Sort Method: external merge</code>). A B-tree index stores NULLs at the end by default; an index created with <code>DESC NULLS LAST</code> (or matching the query's direction and NULL placement, including the reverse scan) lets the planner avoid sorting. The <code>Limit</code> node stops pulling rows as soon as it has enough, but OFFSET rows must still be produced: in <code>EXPLAIN ANALYZE</code> you can see the index scan returning 4,920 rows for <code>OFFSET 4900 LIMIT 20</code>. Row-value comparisons like <code>(a, b) &lt; (x, y)</code> are understood by B-tree indexes on <code>(a, b)</code> as a single range condition.</p>`,
  whenNot: `
<ul>
<li>OFFSET is fine for small, bounded result sets (admin screens with a few pages) and when users truly need "jump to page 37".</li>
<li>Keyset pagination cannot jump to an arbitrary page number and needs a stable, unique sort key; for "page N of M" UIs over small data, OFFSET is simpler.</li>
<li>Don't sort in SQL what you are going to re-sort in the client anyway, and don't ORDER BY inside subqueries/views unless combined with LIMIT — the outer query may reorder.</li>
<li>Don't use <code>ORDER BY random()</code> on large tables to pick samples — use <code>TABLESAMPLE</code>.</li>
</ul>`,
  syntax: `SELECT ...
ORDER BY expr [ ASC | DESC ] [ NULLS { FIRST | LAST } ] [, ...]
[ LIMIT { n | ALL } ] [ OFFSET m ]
-- or (SQL standard)
[ OFFSET m { ROW | ROWS } ]
[ FETCH { FIRST | NEXT } [ n ] { ROW | ROWS } { ONLY | WITH TIES } ]

-- keyset ("seek") pagination
WHERE (sort_col, id) < (:last_sort_value, :last_id)      -- for DESC order
ORDER BY sort_col DESC, id DESC
LIMIT :page_size;
CREATE INDEX ON t (sort_col DESC, id DESC);`,
  examples: [
    { label: 'Basic', title: 'Multi-key sorting and NULL placement',
      sql: `-- Highest salaries first within each department, id as tie-breaker
SELECT department_id, first_name, last_name, salary
FROM   employees
WHERE  department_id IN (1, 2)
ORDER  BY department_id ASC, salary DESC, id
LIMIT  6;

-- Projects by end date: open-ended (NULL) first...
SELECT id, name, end_date FROM projects
ORDER  BY end_date NULLS FIRST, id
LIMIT  4;

-- ...or latest end date first with NULLs pushed to the end
SELECT id, name, end_date FROM projects
ORDER  BY end_date DESC NULLS LAST, id
LIMIT  4;`,
      explain: `<ul><li>Each key has its own direction: department ascending, salary descending.</li>
<li>In PostgreSQL NULLs sort as if larger than every value: last in ASC, <em>first</em> in DESC. Without <code>NULLS LAST</code> the second projects query would show 18 open-ended projects before any dated one — rarely what a "latest end date" report wants.</li>
<li><code>id</code> as the final key guarantees a stable order among ties.</li></ul>`,
      output: ` department_id | first_name | last_name | salary
---------------+------------+-----------+-----------
             1 | Asha       | Rao       | 187500.00
             1 | Rahul      | Gupta     | 149800.00
             1 | Ishaan     | Agarwal   | 146600.00
             1 | Aarav      | Sharma    | 135400.00
             1 | Aditya     | Saxena    | 133100.00
             1 | Aarav      | Malhotra  | 120500.00
(6 rows)

 id | name             | end_date
----+------------------+----------
  1 | Project Atlas    |
  2 | Project Borealis |
  3 | Project Comet    |
  5 | Project Eclipse  |
(4 rows)

 id | name           | end_date
----+----------------+------------
 24 | Project Zenith | 2025-11-15
 20 | Project Titan  | 2025-08-23
 16 | Project Pulsar | 2025-05-31
 12 | Project Lumen  | 2025-03-08
(4 rows)`, run: true },
    { label: 'Intermediate', title: 'FETCH FIRST, OFFSET, WITH TIES and custom sort orders',
      sql: `SET TimeZone = 'UTC';   -- makes order_date::date below reproducible

-- Top 3 most expensive products (standard syntax for LIMIT 3)
SELECT name, price FROM products
ORDER  BY price DESC
FETCH  FIRST 3 ROWS ONLY;

-- "Page 2" of the same list
SELECT name, price FROM products
ORDER  BY price DESC
OFFSET 3 ROWS FETCH NEXT 3 ROWS ONLY;

-- WITH TIES: everything in the top price band, even beyond 3 rows
SELECT name, price_band, price
FROM  (SELECT name, round(price, -4) AS price_band, price
       FROM   products
       ORDER  BY price_band DESC
       FETCH  FIRST 3 ROWS WITH TIES) AS t
ORDER  BY price DESC;

-- Business order instead of alphabetical: lifecycle stage of customer 7's orders
SELECT id, status, order_date::date AS order_day
FROM   orders
WHERE  customer_id = 7
ORDER  BY array_position(ARRAY['pending','paid','shipped','delivered','cancelled'], status),
          order_date DESC
LIMIT  6;`,
      explain: `<ul><li><code>FETCH FIRST n ROWS ONLY</code> is the SQL-standard spelling of <code>LIMIT n</code>; <code>OFFSET ... FETCH NEXT</code> gives page 2.</li>
<li><code>WITH TIES</code> returns 6 rows instead of 3 because six products round to the same 80,000 band — useful for fair "top N" lists (e.g. medal tables). It requires ORDER BY.</li>
<li><code>array_position</code> maps each status to its position in a custom list, giving a workflow order rather than alphabetical.</li></ul>`,
      output: ` name           | price
----------------+----------
 Desk Air 36    | 80166.28
 Monitor Air 71 | 79718.61
 Desk Air 6     | 79213.29
(3 rows)

 name           | price
----------------+----------
 Mouse Lite 53  | 77815.41
 Desk Air 76    | 77630.52
 Monitor Air 31 | 75502.78
(3 rows)

 name           | price_band | price
----------------+------------+----------
 Desk Air 36    |      80000 | 80166.28
 Monitor Air 71 |      80000 | 79718.61
 Desk Air 6     |      80000 | 79213.29
 Mouse Lite 53  |      80000 | 77815.41
 Desk Air 76    |      80000 | 77630.52
 Monitor Air 31 |      80000 | 75502.78
(6 rows)

  id  | status    | order_day
------+-----------+------------
 2536 | pending   | 2024-06-21
 2924 | paid      | 2024-07-23
 3858 | shipped   | 2024-04-20
 1240 | delivered | 2025-02-13
 1359 | delivered | 2025-01-04
  166 | delivered | 2024-12-31
(6 rows)`, run: true },
    { label: 'Advanced', title: 'Keyset pagination vs OFFSET, measured',
      sql: `SET TimeZone = 'UTC';
CREATE INDEX idx_orders_date_id ON orders (order_date DESC, id DESC);

-- Page 1
SELECT id, order_date, total_amount
FROM   orders
ORDER  BY order_date DESC, id DESC
LIMIT  5;

-- Page 2 via keyset: continue after the last row of page 1 (order_date, id)
SELECT id, order_date, total_amount
FROM   orders
WHERE  (order_date, id) < (TIMESTAMPTZ '2025-10-01 01:01:46.843553+00', 2031)
ORDER  BY order_date DESC, id DESC
LIMIT  5;

-- Cost of a deep OFFSET page vs the equivalent keyset page
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, total_amount FROM orders ORDER BY id LIMIT 20 OFFSET 4900;

EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, total_amount FROM orders WHERE id > 4900 ORDER BY id LIMIT 20;`,
      explain: `<ul><li>The client stores the last row's <code>(order_date, id)</code> — often base64-encoded as an opaque "cursor" — and sends it back for the next page.</li>
<li>The row comparison <code>(order_date, id) &lt; (x, y)</code> means "earlier date, or same date and smaller id" — exactly the next rows in <code>DESC, DESC</code> order, and the composite index serves it as one range scan.</li>
<li>The plans show the difference: the OFFSET query walks 4,920 index entries (and thousands of buffer hits) to return 20 rows; the keyset query reads exactly 20 rows via <code>Index Cond: (id &gt; 4900)</code>. On 300 million rows that is the difference between seconds and a millisecond.</li></ul>`,
      output: ` id   | order_date                    | total_amount
------+-------------------------------+--------------
 1231 | 2025-10-01 18:34:41.419776+00 |    622009.62
  881 | 2025-10-01 16:51:52.664566+00 |    296891.43
 4898 | 2025-10-01 13:12:45.179209+00 |    133083.52
 2718 | 2025-10-01 11:07:39.058814+00 |    167206.48
 2031 | 2025-10-01 01:01:46.843553+00 |    695543.42
(5 rows)

 id   | order_date                    | total_amount
------+-------------------------------+--------------
 3227 | 2025-09-30 21:40:18.941982+00 |    215758.06
 2769 | 2025-09-30 18:56:23.509627+00 |    221687.43
 3612 | 2025-09-30 18:21:23.345948+00 |    137094.80
 2173 | 2025-09-30 17:41:36.276856+00 |    120143.92
  447 | 2025-09-30 13:29:59.914878+00 |    437850.87
(5 rows)

 QUERY PLAN
----------------------------------------------------------------------------
 Limit (actual rows=20.00 loops=1)
   ->  Index Scan using orders_pkey on orders (actual rows=4920.00 loops=1)

 QUERY PLAN
--------------------------------------------------------------------------
 Limit (actual rows=20.00 loops=1)
   ->  Index Scan using orders_pkey on orders (actual rows=20.00 loops=1)
         Index Cond: (id > 4900)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Deep page with OFFSET: produces and discards 4,980 rows first
SELECT id, customer_id, total_amount
FROM   orders
ORDER  BY id
LIMIT  20 OFFSET 4980;`,
      why: 'Cost grows linearly with page depth, and concurrent inserts/deletes shift rows between pages (duplicates or gaps while a user is paging).', run: true },
    good: { sql: `-- Keyset: start right after the last id the client saw
SELECT id, customer_id, total_amount
FROM   orders
WHERE  id > 4980
ORDER  BY id
LIMIT  20;`,
      why: 'Constant cost per page using the primary-key index, and stable results even when rows are added elsewhere.', run: true }
  },
  mistakes: [
    'Relying on "natural" row order without ORDER BY — it changes after updates, VACUUM or plan changes.',
    'Paginating on a non-unique sort key (<code>ORDER BY created_at</code>) so rows with equal timestamps repeat or disappear between pages — add <code>id</code>.',
    'Forgetting that NULLs come first in DESC order.',
    'Using deep OFFSET pagination on large tables or public endpoints that bots can crawl.',
    'Implementing keyset with <code>WHERE order_date &lt; $d OR (order_date = $d AND id &lt; $id)</code> but mixing directions inconsistently with ORDER BY.',
    'Using <code>ORDER BY 1, 2</code> positions in application code — breaks silently when the select list changes.'
  ],
  best: [
    'Always end ORDER BY with a unique column for deterministic results.',
    'State NULL placement explicitly (<code>NULLS LAST</code>) in reports.',
    'Use keyset pagination for feeds, infinite scroll and APIs; OFFSET only for small, bounded lists.',
    'Create an index that matches the ORDER BY (columns, direction, NULLS) and the equality filters in front of it (<code>(customer_id, order_date DESC, id DESC)</code>).',
    'Return an opaque cursor from APIs instead of page numbers.',
    'Use <code>FETCH FIRST ... WITH TIES</code> for fair top-N lists.'
  ],
  performance: `
<p>With a matching index, <code>ORDER BY ... LIMIT n</code> reads only n index entries — a top-N query on a billion rows can take microseconds. Without one, PostgreSQL must read all qualifying rows and run a top-N heapsort (cheap in memory, but still a full scan). Deep OFFSETs scale linearly; keyset pages are constant-time. Watch for <code>Sort Method: external merge</code> in <code>EXPLAIN ANALYZE</code> — the sort spilled to disk; raise <code>work_mem</code> for that query or add an index. company_db lacks an index on <code>orders(order_date)</code> on purpose; the Advanced example creates one inside the sandbox.</p>`,
  security: `
<p>Never interpolate user-supplied sort columns or directions into SQL. Map allowed values to a whitelist in application code (<code>{"price_asc": "price ASC, id ASC"}</code>) or use <code>format('%I', col)</code> after validating against a list. Cap <code>LIMIT</code> values server-side (e.g. max 100) so a client cannot request a million rows. Keyset cursors returned to clients should be opaque and validated (or signed) to avoid tampering.</p>`,
  scenario: { title: 'The product listing API melts down when a crawler hits page 40,000', steps: [
    '1. pg_stat_statements shows the listing query with OFFSET dominating total time; EXPLAIN ANALYZE shows rows=800,020 read for 20 returned.',
    '2. Short-term: cap the maximum page number (e.g. 500) and rate-limit anonymous clients.',
    '3. Long-term: switch to keyset pagination on (category, price, id) with a cursor parameter.',
    '4. Create a matching index CONCURRENTLY: (category, price, id).',
    '5. Verify with EXPLAIN (ANALYZE, BUFFERS) that each page reads ~20 index entries, and monitor p99 latency.'
  ] },
  widgets: ['lab:plan', 'lab:index'],
  interview: [
    { q: 'Why is OFFSET pagination slow for deep pages?', a: 'The executor must produce every skipped row (reading index entries or heap tuples, possibly sorting) and then throw them away, so cost grows linearly with the offset. It also yields inconsistent pages when data changes between requests. Keyset pagination seeks directly past the last seen key using an index, so every page costs the same.' },
    { q: 'Where do NULLs go in ORDER BY in PostgreSQL?', a: 'They are treated as larger than any non-NULL value: last for ASC, first for DESC. NULLS FIRST / NULLS LAST overrides this, and an index can be created with matching NULL ordering so the sort can be served by the index.' },
    { q: 'How do you implement keyset pagination on a non-unique column like created_at?', a: 'Add a unique tie-breaker: ORDER BY created_at DESC, id DESC, and filter with a row-value comparison WHERE (created_at, id) < ($last_created_at, $last_id), backed by an index on (created_at DESC, id DESC) — plus any equality filter columns in front.' },
    { q: 'What does FETCH FIRST ... WITH TIES do?', a: 'It returns the first n rows plus any further rows that tie with the n-th row on the ORDER BY keys. It requires an ORDER BY and is useful for fair top-N results.' }
  ],
  exercises: [
    { task: 'Show the 5 most recently hired active employees (hire_date newest first, then id), with first name, last name and hire date.', solution: `SELECT first_name, last_name, hire_date
FROM   employees
WHERE  is_active
ORDER  BY hire_date DESC, id DESC
LIMIT  5;`, run: true },
    { task: 'List customers ordered by country, then name, returning page 3 with 10 rows per page using the SQL-standard OFFSET/FETCH syntax.', solution: `SELECT id, name, country
FROM   customers
ORDER  BY country, name, id
OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY;`, run: true },
    { task: 'Keyset pagination over payments ordered by amount DESC, id DESC: fetch the first page of 5, then the next page after (amount = 900000, id = 1) — write the second query.', solution: `SELECT id, order_id, amount
FROM   payments
WHERE  (amount, id) < (900000, 1)
ORDER  BY amount DESC, id DESC
LIMIT  5;`, run: true }
  ],
  challenge: { task: 'Build a per-customer order history page with keyset pagination: for customer 220, show 5 orders newest first; then write the "next page" query using the last row\'s (order_date, id). Create the supporting index and confirm with EXPLAIN that it is used.', hint: 'Index (customer_id, order_date DESC, id DESC); filter customer_id = 220 AND (order_date, id) < (...).', solution: `CREATE INDEX idx_orders_customer_date_id ON orders (customer_id, order_date DESC, id DESC);

SELECT id, order_date, status, total_amount
FROM   orders
WHERE  customer_id = 220
ORDER  BY order_date DESC, id DESC
LIMIT  5;

EXPLAIN (COSTS OFF)
SELECT id, order_date, status, total_amount
FROM   orders
WHERE  customer_id = 220
  AND  (order_date, id) < (now(), 2147483647)
ORDER  BY order_date DESC, id DESC
LIMIT  5;`, run: true },
  related: ['querying-distinct', 'querying-where-operators', 'indexes', 'explain'],
  quiz: [
    { type: 'mcq', q: 'In PostgreSQL, ORDER BY end_date DESC puts NULL end dates…', options: ['last', 'first', 'randomly', 'it raises an error'], answer: 1, explain: 'NULLs are treated as largest: first in DESC, last in ASC (unless NULLS LAST/FIRST is specified).' },
    { type: 'tf', q: 'Without ORDER BY, rows are returned in primary-key order.', answer: false, explain: 'There is no guaranteed order without ORDER BY.' },
    { type: 'optimize', q: 'A feed endpoint is slow on deep pages. Best fix?', code: `SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET $1;`, options: ['Increase work_mem', 'Keyset pagination: WHERE (created_at, id) < ($last_ts, $last_id) ORDER BY created_at DESC, id DESC LIMIT 20 with index (created_at DESC, id DESC)', 'Add DISTINCT', 'Use ORDER BY random()'], answer: 1, explain: 'Keyset pagination makes each page constant-cost and stable.' },
    { type: 'predict', q: 'How many rows can this return?', code: `SELECT name FROM products ORDER BY category FETCH FIRST 1 ROW WITH TIES;`, options: ['Exactly 1', 'All products of the first category alphabetically (20 accessories)', '0', '100'], answer: 1, explain: 'WITH TIES adds every row tied on the ORDER BY key with the first row: all 20 accessories.' },
    { type: 'index', q: 'Which index best supports WHERE customer_id = $1 ORDER BY order_date DESC, id DESC LIMIT 20?', options: ['(order_date)', '(id)', '(customer_id, order_date DESC, id DESC)', '(order_date, customer_id)'], answer: 2, explain: 'Equality column first, then the sort columns in matching order — the scan returns rows already sorted and stops after 20.' }
  ]
},
{
  id: 'querying-distinct',
  module: 'querying',
  title: 'DISTINCT, count(DISTINCT) and PostgreSQL\'s DISTINCT ON',
  level: 2,
  minutes: 18,
  summary: 'Remove duplicate rows with DISTINCT, count unique values, and solve "latest row per group" problems elegantly with PostgreSQL\'s DISTINCT ON — plus when DISTINCT is hiding a join bug.',
  objectives: [
    'Remove duplicate result rows with DISTINCT on one or several columns',
    'Count unique values with count(DISTINCT ...)',
    'Use DISTINCT ON (...) with ORDER BY to pick one row per group (latest, cheapest, first)',
    'Explain how DISTINCT treats NULLs',
    'Recognise when DISTINCT masks a join that multiplies rows, and use EXISTS instead',
    'Compare DISTINCT ON with window-function alternatives'
  ],
  concept: `
<p><code>SELECT DISTINCT</code> removes duplicate rows from the <em>result</em>: two rows are duplicates when all selected columns are equal. NULLs are treated as equal to each other for this purpose (unlike <code>=</code>), so several NULLs collapse into one.</p>
<p><strong>Analogy: a wedding guest list compiled from several family members' lists.</strong> <code>DISTINCT</code> crosses out exact duplicates so each guest appears once. <code>count(DISTINCT city)</code> answers "how many different cities are guests coming from?". <code>DISTINCT ON (family)</code> says "keep exactly one person per family — the eldest" (your ORDER BY decides who comes first in each family).</p>
<h4>Forms</h4>
<ul>
<li><code>SELECT DISTINCT a, b</code> — unique combinations of <code>a, b</code>.</li>
<li><code>count(DISTINCT a)</code> — number of unique non-NULL values of <code>a</code>. Also <code>sum(DISTINCT ...)</code>, <code>array_agg(DISTINCT ...)</code>, <code>string_agg(DISTINCT ...)</code>.</li>
<li><code>SELECT DISTINCT ON (key) ... ORDER BY key, tie_breakers</code> — <span class="tag core">core</span> PostgreSQL extension to the standard: keeps the <em>first</em> row of each group of equal <code>key</code> values, where "first" is defined by the ORDER BY. The <code>DISTINCT ON</code> expressions must match the leftmost ORDER BY expressions.</li>
</ul>
<h4>The DISTINCT smell</h4>
<p>If you join tables and suddenly see duplicate rows, adding DISTINCT "fixes" the output but hides the cause: the join multiplied rows (one customer × many orders). It also makes the database produce all the duplicates and then sort/hash them away. Usually the right answer is <code>EXISTS</code> (for "has at least one…"), an aggregate, or a corrected join condition.</p>`,
  why: `
<p>Real data contains repetition: many orders per customer, many employees per department, many events per device. Questions like "which countries do we sell to?", "how many distinct buyers last month?" and "what is each customer's latest order?" are everyday reporting needs. DISTINCT and count(DISTINCT) answer the first two directly; DISTINCT ON answers the "top-1 per group" family concisely — a pattern that otherwise needs window functions or correlated subqueries.</p>`,
  useCase: `
<p><strong>An IoT fleet dashboard</strong> stores 2 billion sensor readings for 80,000 devices and shows each device's latest reading. <code>SELECT DISTINCT ON (device_id) device_id, reading, recorded_at FROM readings ORDER BY device_id, recorded_at DESC</code> expresses it in one line. On the full table it must still examine many rows, so for the hot dashboard path the team keeps an index on <code>(device_id, recorded_at DESC)</code> and uses a <code>LATERAL ... LIMIT 1</code> lookup per device (covered in the Joins module), while analysts use DISTINCT ON freely on filtered time ranges. Marketing's "unique buyers per month" metric is <code>count(DISTINCT customer_id)</code> grouped by <code>date_trunc('month', order_date)</code>.</p>`,
  internals: `
<p>PostgreSQL implements DISTINCT either by <strong>sorting</strong> and dropping adjacent duplicates (<code>Unique</code> over <code>Sort</code>, or over an index scan that already delivers sorted rows) or by <strong>hashing</strong> (<code>HashAggregate</code>), choosing by cost; hashing needs the distinct set to fit in <code>hash_mem_multiplier × work_mem</code> or it spills. DISTINCT ON always uses the sort-based approach: rows are sorted by the ORDER BY and a <code>Unique</code> node keeps the first row of each key group — an index matching <code>(key, sort_col DESC)</code> can avoid the sort entirely. <code>count(DISTINCT x)</code> sorts the values within each group (it cannot use parallel aggregation), so on very large inputs <code>SELECT count(*) FROM (SELECT DISTINCT x ...)</code> can be faster because it can use a HashAggregate.</p>`,
  whenNot: `
<ul>
<li>Don't add DISTINCT to silence duplicates from a join — fix the join or use EXISTS.</li>
<li>Don't use DISTINCT ON when you need the top-N (N &gt; 1) per group or ties — use <code>row_number()</code>/<code>rank()</code> window functions.</li>
<li>DISTINCT ON is PostgreSQL-specific; for portable SQL use window functions.</li>
<li>Avoid DISTINCT on wide rows (jsonb, long text) when only a key is needed — deduplicate the key, then join.</li>
</ul>`,
  syntax: `SELECT DISTINCT col1 [, col2 ...] FROM ...;

SELECT DISTINCT ON (key_expr [, ...]) col1, col2, ...
FROM   ...
ORDER  BY key_expr [, ...], tie_breaker [ASC | DESC], ...;

count(DISTINCT expr)   array_agg(DISTINCT expr)   string_agg(DISTINCT expr, ', ')`,
  examples: [
    { label: 'Basic', title: 'Unique values and unique combinations',
      sql: `-- Which product categories exist?
SELECT DISTINCT category
FROM   products
ORDER  BY category;

-- Which (country, segment) combinations exist among customers?
SELECT DISTINCT country, segment
FROM   customers
ORDER  BY country, segment;

-- Counting rows vs unique values
SELECT count(*)                     AS orders,
       count(DISTINCT customer_id)  AS distinct_customers,
       count(DISTINCT status)       AS distinct_statuses
FROM   orders;`,
      explain: `<ul><li>DISTINCT applies to the whole select list: <code>DISTINCT country, segment</code> returns unique <em>pairs</em>, so India appears twice (consumer and smb).</li>
<li><code>count(DISTINCT customer_id)</code> shows that the 5,000 orders were placed by all 500 customers.</li></ul>`,
      output: ` category
-------------
 accessories
 audio
 electronics
 furniture
 networking
 storage
 video
(7 rows)

 country   | segment
-----------+------------
 Germany   | consumer
 India     | consumer
 India     | smb
 Singapore | smb
 UAE       | enterprise
 UK        | consumer
 USA       | enterprise
(7 rows)

 orders | distinct_customers | distinct_statuses
--------+--------------------+-------------------
   5000 |                500 |                 5
(1 row)`, run: true },
    { label: 'Intermediate', title: 'DISTINCT ON: one row per group',
      sql: `SET TimeZone = 'UTC';

-- Latest order of each of three customers
SELECT DISTINCT ON (customer_id)
       customer_id, id AS order_id, order_date::date AS order_day, total_amount
FROM   orders
WHERE  customer_id IN (7, 42, 220)
ORDER  BY customer_id, order_date DESC, id DESC;

-- Most expensive product in each category
SELECT DISTINCT ON (category)
       category, name, price
FROM   products
ORDER  BY category, price DESC, id;

-- Longest-serving non-head employee in each department
SELECT DISTINCT ON (department_id)
       department_id, first_name, last_name, hire_date
FROM   employees
WHERE  job_title <> 'Head of Department'
ORDER  BY department_id, hire_date, id;`,
      explain: `<p>For each distinct value of the <code>DISTINCT ON</code> expression, PostgreSQL keeps the <em>first</em> row in ORDER BY order. So the ORDER BY must start with the same expression(s), followed by what defines "first": <code>order_date DESC</code> for latest, <code>price DESC</code> for most expensive, <code>hire_date</code> for earliest. The final <code>id</code> makes the choice deterministic when there are ties.</p>`,
      output: ` customer_id | order_id | order_day  | total_amount
-------------+----------+------------+--------------
           7 |     1240 | 2025-02-13 |    140391.60
          42 |     3422 | 2025-08-18 |    294680.11
         220 |     1846 | 2025-08-08 |    467664.86
(3 rows)

 category    | name            | price
-------------+-----------------+----------
 accessories | Mouse Lite 53   | 77815.41
 audio       | Headset Plus 44 | 72587.30
 electronics | Monitor Air 71  | 79718.61
 furniture   | Desk Air 36     | 80166.28
 networking  | Router Lite 8   | 68905.19
 storage     | SSD Plus 19     | 72866.34
 video       | Webcam Pro 35   | 67331.72
(7 rows)

 department_id | first_name | last_name | hire_date
---------------+------------+-----------+------------
             1 | Aarav      | Sharma    | 2016-01-22
             2 | Tara       | Verma     | 2016-05-28
             3 | Karan      | Verma     | 2016-06-11
             4 | Pooja      | Patel     | 2016-03-07
             5 | Aarav      | Khan      | 2016-01-22
             6 | Neha       | Agarwal   | 2016-10-02
             7 | Sai        | Sharma    | 2016-03-21
             8 | Zara       | Malhotra  | 2016-06-16
(8 rows)`, run: true },
    { label: 'Advanced', title: 'DISTINCT ON vs window functions, NULLs, and the plan',
      sql: `-- The same "latest order per customer" with a window function (portable SQL)
SELECT customer_id, order_id, total_amount
FROM  (SELECT customer_id, id AS order_id, total_amount,
              row_number() OVER (PARTITION BY customer_id
                                 ORDER BY order_date DESC, id DESC) AS rn
       FROM   orders
       WHERE  customer_id IN (7, 42, 220)) t
WHERE  rn = 1
ORDER  BY customer_id;

-- DISTINCT treats NULLs as equal: 18 NULL end dates collapse into one row
SELECT count(*)                  AS projects,
       count(DISTINCT end_date)  AS distinct_end_dates_non_null,
       (SELECT count(*) FROM (SELECT DISTINCT end_date FROM projects) d) AS distinct_rows_incl_null
FROM   projects;

-- How DISTINCT ON executes: Sort + Unique (an index on (customer_id, order_date DESC) avoids the sort)
EXPLAIN (COSTS OFF)
SELECT DISTINCT ON (customer_id) customer_id, id, order_date
FROM   orders
ORDER  BY customer_id, order_date DESC;`,
      explain: `<ul><li>The <code>row_number()</code> version is standard SQL and extends to top-N per group (<code>rn &lt;= 3</code>); DISTINCT ON is shorter for top-1.</li>
<li><code>count(DISTINCT end_date)</code> ignores NULLs (6), while <code>SELECT DISTINCT end_date</code> keeps one NULL row (7).</li>
<li>The plan shows a <code>Unique</code> node on top of a <code>Sort</code> by <code>customer_id, order_date DESC</code> — the cost of DISTINCT ON is essentially the cost of that sort.</li></ul>`,
      output: ` customer_id | order_id | total_amount
-------------+----------+--------------
           7 |     1240 |    140391.60
          42 |     3422 |    294680.11
         220 |     1846 |    467664.86
(3 rows)

 projects | distinct_end_dates_non_null | distinct_rows_incl_null
----------+-----------------------------+-------------------------
       24 |                           6 |                       7
(1 row)

 QUERY PLAN
------------------------------------------------------
 Unique
   ->  Sort
         Sort Key: customer_id, order_date DESC
         ->  Seq Scan on orders
(4 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- "Customers who have at least one cancelled order": join multiplies rows, DISTINCT hides it
SELECT DISTINCT c.id, c.name
FROM   customers c
JOIN   orders o ON o.customer_id = c.id
WHERE  o.status = 'cancelled'
ORDER  BY c.id
LIMIT  5;`,
      why: 'The join first produces 428 rows (one per cancelled order), then DISTINCT sorts/hashes them down to 305 customers. Correct here, but wasteful, and on wider queries DISTINCT often masks a genuinely wrong join.', run: true },
    good: { sql: `SELECT c.id, c.name
FROM   customers c
WHERE  EXISTS (SELECT 1
               FROM   orders o
               WHERE  o.customer_id = c.id
                 AND  o.status = 'cancelled')
ORDER  BY c.id
LIMIT  5;`,
      why: 'EXISTS states the intent ("has at least one") and runs as a semi-join that stops at the first matching order per customer — no duplicates to remove.', run: true }
  },
  mistakes: [
    'Using DISTINCT to "fix" duplicate rows caused by a join instead of fixing the join or using EXISTS.',
    'Thinking <code>SELECT DISTINCT a, b</code> means "distinct a" — it means distinct pairs.',
    'Writing DISTINCT ON without a matching leading ORDER BY (error: <em>SELECT DISTINCT ON expressions must match initial ORDER BY expressions</em>) or without a tie-breaker (nondeterministic choice).',
    'Ordering by a column that is not in the select list with plain DISTINCT (<em>for SELECT DISTINCT, ORDER BY expressions must appear in select list</em>).',
    'Expecting <code>count(DISTINCT col)</code> to count NULL as a value — it does not.',
    'Using DISTINCT ON for top-N per group — it only gives one row.'
  ],
  best: [
    'Prefer EXISTS for "has at least one related row" questions.',
    'Use DISTINCT ON for concise top-1-per-group queries, always with a full ORDER BY and tie-breaker.',
    'Use <code>row_number()</code> for portable code or top-N per group.',
    'Support DISTINCT ON / top-1 lookups with an index on <code>(group_key, sort_key DESC)</code>.',
    'Deduplicate narrow keys rather than wide rows; join back for details.',
    'Ask why duplicates exist before removing them — they often reveal a data or modelling problem.'
  ],
  performance: `
<p>DISTINCT costs a sort (O(n log n), may spill to disk) or a hash aggregate over all input rows — it never makes a query cheaper. For large inputs, check <code>EXPLAIN ANALYZE</code> for <code>external merge</code> sorts or HashAggregate <code>Batches</code> &gt; 1 (spilled). DISTINCT ON benefits greatly from an index delivering rows in <code>(key, order)</code> order: the planner can then use <code>Unique</code> over an index scan without sorting. When there are few groups and many rows per group, a <code>LATERAL (... ORDER BY ... LIMIT 1)</code> per group (or a recursive "skip scan" CTE) can be orders of magnitude faster than DISTINCT ON over the whole table.</p>`,
  security: `
<p>Unique-value queries can leak information in aggregate: <code>count(DISTINCT customer_id)</code> over a tiny filter may identify individuals. For analytics shared outside the company, apply minimum group sizes (e.g. suppress counts below 10). DISTINCT does not bypass row-level security — the policies filter rows before deduplication.</p>`,
  interview: [
    { q: 'What does DISTINCT ON do and how does it differ from DISTINCT?', a: 'DISTINCT removes rows identical across all selected columns. DISTINCT ON (expr) keeps only the first row for each distinct value of expr, where "first" is determined by the ORDER BY, which must begin with the same expressions. It is a PostgreSQL extension ideal for top-1-per-group queries like latest order per customer.' },
    { q: 'Why is adding DISTINCT to a join query often a code smell?', a: 'Duplicates usually mean the join is one-to-many and multiplies rows; DISTINCT hides that symptom while making the database produce and then eliminate extra rows. If the question is existence, use EXISTS; if it needs aggregation, aggregate before joining; if the join is wrong, fix the condition.' },
    { q: 'How do NULLs behave with DISTINCT and count(DISTINCT)?', a: 'SELECT DISTINCT treats NULLs as equal, so all NULLs collapse into one row. count(DISTINCT col) ignores NULLs entirely, like other aggregates. GROUP BY also groups NULLs together.' }
  ],
  exercises: [
    { task: 'List the distinct job titles in the Sales department (department_id 2), alphabetically.', solution: `SELECT DISTINCT job_title
FROM   employees
WHERE  department_id = 2
ORDER  BY job_title;`, run: true },
    { task: 'For each payment method, count the distinct orders that were successfully paid with it.', solution: `SELECT method, count(DISTINCT order_id) AS orders_paid
FROM   payments
WHERE  status = 'success'
GROUP  BY method
ORDER  BY orders_paid DESC, method;`, run: true },
    { task: 'Using DISTINCT ON, show each customer\'s most recent successful payment method for customers 1–3.', solution: `SELECT DISTINCT ON (o.customer_id)
       o.customer_id, p.method, p.paid_at
FROM   orders o
JOIN   payments p ON p.order_id = o.id
WHERE  p.status = 'success'
  AND  o.customer_id <= 3
ORDER  BY o.customer_id, p.paid_at DESC, p.id DESC;`, run: true }
  ],
  challenge: { task: 'For each product category, show the single best-selling product by total units sold (from order_items), with its units and revenue. Break ties by product id. Use DISTINCT ON over an aggregated subquery.', hint: 'Aggregate order_items per product first (join products for category), then DISTINCT ON (category) ORDER BY category, units DESC, product_id.', solution: `SELECT DISTINCT ON (category)
       category, product_id, name, units, revenue
FROM  (SELECT p.category, p.id AS product_id, p.name,
              sum(oi.quantity)                 AS units,
              sum(oi.quantity * oi.unit_price) AS revenue
       FROM   order_items oi
       JOIN   products p ON p.id = oi.product_id
       GROUP  BY p.category, p.id, p.name) s
ORDER  BY category, units DESC, product_id;`, run: true },
  related: ['querying-order-limit-pagination', 'aggregations', 'window-functions', 'subqueries'],
  quiz: [
    { type: 'predict', q: 'How many rows?', code: `SELECT DISTINCT x FROM (VALUES (1), (1), (NULL), (NULL), (2)) t(x);`, options: ['2', '3', '4', '5'], answer: 1, explain: '1, 2 and one NULL: DISTINCT treats NULLs as equal.' },
    { type: 'mcq', q: 'What must the ORDER BY of a DISTINCT ON (customer_id) query start with?', options: ['id', 'customer_id', 'Any column', 'Nothing — ORDER BY is optional and ignored'], answer: 1, explain: 'The DISTINCT ON expressions must match the leftmost ORDER BY expressions.' },
    { type: 'tf', q: 'count(DISTINCT col) counts NULL as one distinct value.', answer: false, explain: 'Aggregates ignore NULLs.' },
    { type: 'optimize', q: 'Best rewrite?', code: `SELECT DISTINCT c.* FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.total_amount > 500000;`, options: ['Add GROUP BY c.*', 'SELECT c.* FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.total_amount > 500000)', 'Use DISTINCT ON (c.*)', 'Add LIMIT'], answer: 1, explain: 'EXISTS expresses the semi-join without producing and removing duplicates.' },
    { type: 'write', q: 'Write a query returning the cheapest product in each category (category, name, price), deterministic on ties.', solution: `SELECT DISTINCT ON (category) category, name, price
FROM   products
ORDER  BY category, price, id;`, explain: 'DISTINCT ON keeps the first row per category in price order; id breaks ties.' }
  ]
},
{
  id: 'querying-case-coalesce-cast',
  module: 'querying',
  title: 'CASE, COALESCE, NULLIF and Type Conversion (CAST and ::)',
  level: 1,
  minutes: 20,
  summary: 'Add conditional logic inside queries with CASE, replace NULLs with COALESCE, prevent division by zero with NULLIF, and convert between types safely with CAST, :: and pg_input_is_valid.',
  objectives: [
    'Write searched CASE (WHEN condition) and simple CASE (CASE expr WHEN value) expressions',
    'Use CASE for bucketing, custom labels, conditional aggregation and custom sorting',
    'Replace NULLs with COALESCE and turn sentinel values into NULL with NULLIF',
    'Prevent division-by-zero errors with NULLIF',
    'Convert types with CAST(x AS type) and x::type, and understand implicit vs explicit casts',
    'Validate untrusted text before casting with pg_input_is_valid (PostgreSQL 16+)'
  ],
  concept: `
<p>These are SQL's "if/else" and "fix-up" tools. They are <em>expressions</em>, so they can appear anywhere a value can: the select list, WHERE, ORDER BY, GROUP BY, inside aggregates, in UPDATE SET clauses.</p>
<p><strong>Analogy: a teacher grading exam papers.</strong> CASE is the grading rubric: "90 or above → A, 75 or above → B, otherwise C" — checked top to bottom, first match wins. COALESCE is "if the student left their name blank, write 'Unknown'". NULLIF is "if the answer is the placeholder 'N/A', treat it as blank". CAST is converting a mark written as text ("87") into a number you can add up.</p>
<h4>CASE</h4>
<ul>
<li><strong>Searched CASE</strong>: <code>CASE WHEN cond1 THEN r1 WHEN cond2 THEN r2 ELSE r3 END</code> — conditions evaluated in order, the first TRUE wins.</li>
<li><strong>Simple CASE</strong>: <code>CASE status WHEN 'paid' THEN ... WHEN 'shipped' THEN ... END</code> — compares one expression for equality (cannot match NULL; use searched CASE with <code>IS NULL</code>).</li>
<li>Without <code>ELSE</code>, unmatched rows get NULL.</li>
<li>All branches must have compatible types (<code>THEN 1 ... ELSE 'n/a'</code> fails — cast one side).</li>
</ul>
<h4>COALESCE, NULLIF, GREATEST, LEAST</h4>
<ul>
<li><code>COALESCE(a, b, c)</code> → the first non-NULL argument (stops evaluating once found).</li>
<li><code>NULLIF(a, b)</code> → NULL if <code>a = b</code>, otherwise <code>a</code>. Classic uses: <code>x / NULLIF(y, 0)</code> (no division-by-zero error), <code>NULLIF(trim(input), '')</code> (blank → NULL).</li>
<li><code>GREATEST(...)</code> / <code>LEAST(...)</code> — largest/smallest argument, ignoring NULLs in PostgreSQL.</li>
</ul>
<h4>Type conversion</h4>
<ul>
<li><code>CAST(expr AS type)</code> is SQL standard; <code>expr::type</code> is the PostgreSQL shorthand — identical behaviour.</li>
<li>Some conversions happen <em>implicitly</em> (integer → numeric in arithmetic, unknown-typed literals to the column's type), but PostgreSQL is strict: no implicit text ↔ number conversion in comparisons with typed columns.</li>
<li>Casts can round (<code>3.99::int</code> → 4), truncate (<code>'hello'::varchar(3)</code> → 'hel'), or fail (<code>'abc'::int</code> → <em>invalid input syntax</em>).</li>
<li><code>pg_input_is_valid(text, type)</code> and <code>pg_input_error_info(text, type)</code> (PostgreSQL 16+) test input <em>without</em> raising an error — ideal for cleaning imported data.</li>
<li>Formatting: <code>to_char(number|date, format)</code>, parsing: <code>to_number</code>, <code>to_date</code>, <code>to_timestamp</code>.</li>
</ul>`,
  why: `
<p>Reports and APIs constantly need derived labels (size bands, SLA status), NULL-safe display values, safe ratios and type conversions of imported data. Doing this in SQL keeps logic in one place, lets the database aggregate over the derived values (count per band), and avoids shipping raw rows to the application just to compute a label. Correct casting is also a correctness issue: integer division, silent rounding and failing casts on dirty data are frequent sources of wrong numbers and broken batch jobs.</p>`,
  useCase: `
<p><strong>A logistics company's SLA dashboard</strong> classifies each shipment with <code>CASE WHEN delivered_at IS NULL AND now() &gt; promised_at THEN 'late, open' WHEN delivered_at &gt; promised_at THEN 'late' ELSE 'on time' END</code>, counts them per hub with conditional aggregation, and computes the late percentage as <code>100.0 * late / NULLIF(total, 0)</code> so a new hub with no shipments shows a blank instead of crashing the dashboard. Carrier CSV files arrive with amounts like "1,200.50", "N/A" and empty strings; the loader stages them as text and converts with <code>CASE WHEN pg_input_is_valid(...) THEN ...::numeric END</code>, routing invalid rows to a rejects table instead of failing the whole import.</p>`,
  internals: `
<p>CASE is evaluated lazily: once a WHEN is TRUE, later branches are not evaluated — so <code>CASE WHEN y = 0 THEN NULL ELSE x / y END</code> is safe at run time. One caveat: the planner may pre-compute (constant-fold) branches that consist only of constants, so <code>CASE WHEN col = 0 THEN 1/0 END</code>-style tricks can still raise errors at plan time; NULLIF is the cleaner tool. COALESCE is internally a special expression (not a function) that also short-circuits. Casts are implemented by functions registered in <code>pg_cast</code>, marked as implicit, assignment or explicit; the parser uses them to resolve operator and function overloads — which is why <code>WHERE id::text = '5'</code> works but cannot use the integer index on <code>id</code>. Simple CASE <code>CASE x WHEN v ...</code> is rewritten to <code>CASE WHEN x = v ...</code>, evaluating <code>x</code> once.</p>`,
  whenNot: `
<ul>
<li>Don't encode large mapping tables in giant CASE expressions repeated across queries — put the mapping in a lookup table and join.</li>
<li>Don't COALESCE NULLs away when NULL carries meaning (unknown vs zero) — especially before averaging: <code>avg(coalesce(rating, 0))</code> changes the answer.</li>
<li>Don't cast the <em>column</em> to match a parameter (<code>WHERE id::text = $1</code>); cast the parameter (<code>WHERE id = $1::int</code>) so indexes work.</li>
<li>Don't use <code>CASE</code> for data validation that should be a CHECK constraint.</li>
</ul>`,
  syntax: `CASE WHEN condition THEN result [WHEN ...] [ELSE result] END          -- searched
CASE expression WHEN value THEN result [WHEN ...] [ELSE result] END   -- simple

COALESCE(value [, ...])     NULLIF(value1, value2)
GREATEST(value [, ...])     LEAST(value [, ...])

CAST(expression AS type)    expression::type
pg_input_is_valid(text, 'type')          pg_input_error_info(text, 'type')   -- PG 16+
to_char(value, 'format')  to_number(text, 'format')  to_date(text, 'format')`,
  examples: [
    { label: 'Basic', title: 'Searched and simple CASE',
      sql: `SELECT id,
       total_amount,
       CASE                                   -- searched CASE: first TRUE wins
         WHEN total_amount >= 500000 THEN 'large'
         WHEN total_amount >= 100000 THEN 'medium'
         ELSE 'small'
       END AS size_band,
       CASE status                            -- simple CASE: equality on one expression
         WHEN 'delivered' THEN 'done'
         WHEN 'cancelled' THEN 'closed'
         ELSE 'in progress'
       END AS stage
FROM   orders
WHERE  id <= 6
ORDER  BY id;`,
      explain: `<p>Order matters in a searched CASE: a 600,000 order matches the first WHEN and stops, so it is "large", not "medium". The simple CASE maps status codes to friendlier labels; any status not listed falls into ELSE.</p>`,
      output: ` id | total_amount | size_band | stage
----+--------------+-----------+-------------
  1 |    305730.09 | medium    | in progress
  2 |    230018.23 | medium    | in progress
  3 |    406916.91 | medium    | closed
  4 |     25977.75 | small     | in progress
  5 |    260739.15 | medium    | closed
  6 |    430970.30 | medium    | closed
(6 rows)`, run: true },
    { label: 'Intermediate', title: 'CASE in GROUP BY and aggregates; COALESCE and NULLIF',
      sql: `-- Bucket and aggregate in one pass
SELECT CASE WHEN total_amount >= 500000 THEN 'large'
            WHEN total_amount >= 100000 THEN 'medium'
            ELSE 'small' END            AS size_band,
       count(*)                         AS orders,
       round(avg(total_amount))         AS avg_amount
FROM   orders
GROUP  BY 1
ORDER  BY min(total_amount);

-- Conditional aggregation: FILTER (PostgreSQL) and the portable CASE form
SELECT count(*) FILTER (WHERE status = 'delivered')            AS delivered,
       sum(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END)    AS delivered_case,
       round(100.0 * count(*) FILTER (WHERE status = 'cancelled') / count(*), 1) AS cancel_rate_pct
FROM   orders;

-- COALESCE for display/defaults, NULLIF to avoid division by zero
SELECT d.name,
       count(p.id) FILTER (WHERE p.status = 'active')                AS active_projects,
       round(d.budget / NULLIF(count(p.id) FILTER (WHERE p.status = 'active'), 0), 2)
                                                                      AS budget_per_active_project,
       COALESCE(round(d.budget / NULLIF(count(p.id) FILTER (WHERE p.status = 'active'), 0), 2)::text,
                'no active projects')                                 AS display_value
FROM   departments d
LEFT   JOIN projects p ON p.department_id = d.id
GROUP  BY d.id
ORDER  BY d.id
LIMIT  4;`,
      explain: `<ul><li>A CASE expression can be grouped by (here via position <code>1</code>) and sorted by an aggregate of the bucket.</li>
<li><code>FILTER (WHERE ...)</code> is PostgreSQL's (and the SQL standard's) clean form of conditional aggregation; <code>sum(CASE ... THEN 1 ELSE 0 END)</code> is the portable equivalent.</li>
<li><code>NULLIF(count, 0)</code> turns a zero divisor into NULL, so the division yields NULL instead of <em>ERROR: division by zero</em>; <code>COALESCE</code> then substitutes a display label (after casting the number to text so both arguments have the same type).</li></ul>`,
      output: ` size_band | orders | avg_amount
-----------+--------+------------
 small     |   1047 |      51514
 medium    |   3585 |     269383
 large     |    368 |     587633
(3 rows)

 delivered | delivered_case | cancel_rate_pct
-----------+----------------+-----------------
      2527 |           2527 |             8.6
(1 row)

 name        | active_projects | budget_per_active_project | display_value
-------------+-----------------+---------------------------+--------------------
 Engineering |               0 |                           | no active projects
 Sales       |               3 |                 700000.00 | 700000.00
 Marketing   |               0 |                           | no active projects
 Finance     |               0 |                           | no active projects
(4 rows)`, run: true },
    { label: 'Advanced', title: 'Casting, formatting and safe conversion of dirty input',
      sql: `-- Explicit casts and their effects
SELECT '42'::int + 1                        AS text_to_int,
       CAST('2025-03-31' AS date) + 1       AS text_to_date,
       3.99::int                            AS numeric_to_int_rounds,
       10::numeric / 3                      AS numeric_division,
       (10 / 3)::numeric                    AS cast_too_late,
       '{1,2,3}'::int[]                     AS text_to_array,
       to_char(1234567.891, 'FM99,99,99,999.00') AS indian_grouping,
       to_number('1,234.50', '9G999D99')    AS parsed_number;

-- Validate before casting (PostgreSQL 16+): no exception, no aborted batch
SELECT pg_input_is_valid('abc', 'integer')                    AS abc_is_int,
       pg_input_is_valid('42',  'integer')                    AS n42_is_int,
       (pg_input_error_info('2025-02-30', 'date')).message    AS why_invalid;

SELECT raw,
       CASE WHEN pg_input_is_valid(NULLIF(trim(raw), ''), 'numeric')
            THEN NULLIF(trim(raw), '')::numeric END           AS amount,
       CASE WHEN NULLIF(trim(raw), '') IS NULL THEN 'missing'
            WHEN NOT pg_input_is_valid(trim(raw), 'numeric') THEN 'invalid'
            ELSE 'ok' END                                     AS status
FROM  (VALUES ('1200.50'), ('N/A'), (''), ('3,400'), ('  99 ')) AS t(raw);`,
      explain: `<ul><li><code>3.99::int</code> rounds to 4 (it does not truncate); <code>(10 / 3)::numeric</code> is 3 because the integer division happened before the cast — cast an operand, not the result.</li>
<li><code>to_char</code> with an explicit pattern formats numbers (here Indian lakh/crore grouping); <code>to_number</code> parses formatted text.</li>
<li><code>pg_input_is_valid</code> and <code>pg_input_error_info</code> check a value against a type's input rules without throwing — one bad row no longer aborts the whole <code>INSERT ... SELECT</code>.</li>
<li><code>NULLIF(trim(raw), '')</code> treats blank strings as missing; "3,400" is invalid for <code>numeric</code> (thousands separator) and would need <code>to_number</code> or <code>replace</code>.</li></ul>`,
      output: ` text_to_int | text_to_date | numeric_to_int_rounds | numeric_division   | cast_too_late | text_to_array | indian_grouping | parsed_number
-------------+--------------+-----------------------+--------------------+---------------+---------------+-----------------+---------------
          43 | 2025-04-01   |                     4 | 3.3333333333333333 |             3 | {1,2,3}       | 12,34,567.89    |       1234.50
(1 row)

 abc_is_int | n42_is_int | why_invalid
------------+------------+--------------------------------------------------
 f          | t          | date/time field value out of range: "2025-02-30"
(1 row)

 raw     | amount  | status
---------+---------+---------
 1200.50 | 1200.50 | ok
 N/A     |         | invalid
         |         | missing
 3,400   |         | invalid
   99    |      99 | ok
(5 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Ratio that crashes as soon as one group has zero rows of the divisor
SELECT d.name,
       round(d.budget / count(p.id) FILTER (WHERE p.status = 'active'), 2) AS per_active_project
FROM   departments d
LEFT   JOIN projects p ON p.department_id = d.id
GROUP  BY d.id;
-- ERROR:  division by zero`,
      why: 'Departments without active projects make the divisor 0, and one bad group aborts the entire report.', run: false },
    good: { sql: `SELECT d.name,
       round(d.budget / NULLIF(count(p.id) FILTER (WHERE p.status = 'active'), 0), 2) AS per_active_project
FROM   departments d
LEFT   JOIN projects p ON p.department_id = d.id
GROUP  BY d.id
ORDER  BY d.id;`,
      why: 'NULLIF turns a zero divisor into NULL, so the ratio is NULL (unknown) for those departments and the report still runs.', run: true }
  },
  mistakes: [
    'Forgetting ELSE in CASE and getting unexpected NULLs.',
    'Ordering CASE branches wrongly (<code>WHEN amount &gt;= 100000</code> before <code>WHEN amount &gt;= 500000</code> makes the second unreachable).',
    'Using simple CASE to test for NULL (<code>CASE x WHEN NULL THEN ...</code>) — never matches; use <code>CASE WHEN x IS NULL</code>.',
    'Mixing types across CASE/COALESCE branches (<code>COALESCE(end_date, \'open\')</code> fails: \'open\' is not a date) — cast to a common type.',
    'Casting the indexed column instead of the parameter (<code>WHERE id::text = $1</code>), disabling index use.',
    'Casting after integer division (<code>(a / b)::numeric</code>) instead of before (<code>a::numeric / b</code>).'
  ],
  best: [
    'Always write an explicit ELSE (even <code>ELSE NULL</code>) to show intent.',
    'Use FILTER for conditional aggregates; CASE inside aggregates when portability matters.',
    'Guard every division in reports with <code>NULLIF(divisor, 0)</code>.',
    'Use COALESCE for presentation and defaults, not to erase meaningful unknowns before aggregation.',
    'Validate untrusted text with <code>pg_input_is_valid</code> before casting in ETL; stage raw data as text.',
    'Prefer <code>::</code> in PostgreSQL-only code for brevity, <code>CAST</code> in portable code — be consistent.'
  ],
  performance: `
<p>CASE, COALESCE and NULLIF are cheap per-row expressions; conditional aggregation with FILTER computes many metrics in a single pass over the data instead of several queries. The main performance risk is in WHERE clauses: wrapping indexed columns in CASE, COALESCE or casts (<code>WHERE COALESCE(end_date, '9999-12-31') &gt; now()</code>) makes predicates non-sargable — rewrite as <code>end_date &gt; now() OR end_date IS NULL</code>, or create an expression index matching the exact expression.</p>`,
  security: `
<p>Casting user input inside SQL (<code>$1::int</code>) is safe with bind parameters — the value never becomes SQL text. Error messages from failed casts can echo the input back; in APIs, catch database errors and return generic messages to avoid leaking internals. When CASE implements business rules with security impact (discounts, access levels), keep it in one reviewed place (a view or function) rather than copied across services.</p>`,
  interview: [
    { q: 'What is the difference between COALESCE and NULLIF?', a: 'COALESCE(a, b, ...) returns the first non-NULL argument — used for defaults. NULLIF(a, b) returns NULL when a equals b, otherwise a — used to turn sentinel values into NULL, most famously x / NULLIF(y, 0) to avoid division by zero.' },
    { q: 'How do you avoid a division-by-zero error in a report?', a: 'Wrap the divisor: numerator / NULLIF(denominator, 0). The result becomes NULL when the denominator is zero, and COALESCE can turn that into 0 or a label if the business wants one. Also make the numerator numeric (100.0 * ...) to avoid integer division.' },
    { q: 'What is the difference between CAST(x AS int) and x::int?', a: 'None in behaviour; CAST is SQL-standard syntax and :: is PostgreSQL shorthand. Both invoke the same cast function. Casting numeric to integer rounds, and invalid input raises an error unless you check it first with pg_input_is_valid (PostgreSQL 16+).' },
    { q: 'Why might WHERE id::text = $1 be slow?', a: 'Casting the column prevents the planner from using the B-tree index on id (the index is on integer values, not their text representation), forcing a sequential scan. Cast the parameter instead: WHERE id = $1::int.' }
  ],
  exercises: [
    { task: 'Classify employees into salary bands (A ≥ 150000, B ≥ 100000, C ≥ 60000, else D) and count employees per band, ordered by band.', solution: `SELECT CASE WHEN salary >= 150000 THEN 'A'
            WHEN salary >= 100000 THEN 'B'
            WHEN salary >= 60000  THEN 'C'
            ELSE 'D' END AS band,
       count(*) AS employees
FROM   employees
GROUP  BY band
ORDER  BY band;`, run: true },
    { task: 'For each customer country, show delivered and cancelled order counts and the cancellation percentage (1 decimal), guarding against division by zero.', solution: `SELECT c.country,
       count(*) FILTER (WHERE o.status = 'delivered') AS delivered,
       count(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
       round(100.0 * count(*) FILTER (WHERE o.status = 'cancelled') / NULLIF(count(*), 0), 1) AS cancel_pct
FROM   orders o
JOIN   customers c ON c.id = o.customer_id
GROUP  BY c.country
ORDER  BY cancel_pct DESC;`, run: true },
    { task: 'Show projects with an end label: the end date formatted as "DD Mon YYYY" or "open-ended" when NULL.', solution: `SELECT name,
       COALESCE(to_char(end_date, 'DD Mon YYYY'), 'open-ended') AS end_label
FROM   projects
ORDER  BY id
LIMIT  6;`, run: true }
  ],
  challenge: { task: 'Build a payment health report per method: total attempts, success count, failure count, refund count, success rate % (1 decimal, NULL-safe), and a health label: "healthy" if success rate ≥ 95, "watch" if ≥ 90, otherwise "investigate". Sort worst first.', hint: 'Compute counts with FILTER in a subquery or CTE, then derive the rate with NULLIF and the label with CASE.', solution: `WITH s AS (
  SELECT method,
         count(*)                                   AS attempts,
         count(*) FILTER (WHERE status = 'success')  AS successes,
         count(*) FILTER (WHERE status = 'failed')   AS failures,
         count(*) FILTER (WHERE status = 'refunded') AS refunds
  FROM   payments
  GROUP  BY method
)
SELECT method, attempts, successes, failures, refunds,
       round(100.0 * successes / NULLIF(attempts, 0), 1) AS success_pct,
       CASE WHEN 100.0 * successes / NULLIF(attempts, 0) >= 95 THEN 'healthy'
            WHEN 100.0 * successes / NULLIF(attempts, 0) >= 90 THEN 'watch'
            ELSE 'investigate' END                       AS health
FROM   s
ORDER  BY success_pct NULLS FIRST, method;`, run: true },
  related: ['querying-where-operators', 'sql-fundamentals-logical-order-nulls', 'data-types-numeric', 'aggregations'],
  quiz: [
    { type: 'predict', q: 'What does this return?', code: `SELECT COALESCE(NULL, NULL, 'x', 'y');`, options: ['NULL', 'x', 'y', 'An error'], answer: 1, explain: 'COALESCE returns the first non-NULL argument.' },
    { type: 'predict', q: 'What does this return?', code: `SELECT 10 / NULLIF(0, 0);`, options: ['0', 'NULL', 'ERROR: division by zero', 'Infinity'], answer: 1, explain: 'NULLIF(0, 0) is NULL, and 10 / NULL is NULL.' },
    { type: 'mcq', q: 'A CASE has no ELSE and no WHEN matches. Result?', options: ['Empty string', '0', 'NULL', 'An error'], answer: 2, explain: 'A missing ELSE behaves like ELSE NULL.' },
    { type: 'bug', q: 'Why does this fail?', code: `SELECT name, COALESCE(end_date, 'open-ended') FROM projects;`, options: ['COALESCE takes only one argument', '\'open-ended\' cannot be converted to date; cast end_date to text first', 'end_date is not nullable', 'Need GROUP BY'], answer: 1, explain: 'All COALESCE arguments must share a type: COALESCE(end_date::text, \'open-ended\').' },
    { type: 'predict', q: 'What does this return?', code: `SELECT 3.99::int, (7 / 2)::numeric;`, options: ['3, 3.5', '4, 3', '3, 3', '4, 3.5'], answer: 1, explain: 'numeric → int rounds (4); the integer division 7/2 = 3 happens before the cast.' }
  ]
}
]);
