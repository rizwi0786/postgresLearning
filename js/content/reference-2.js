/* =====================================================================
   reference-2.js — Command cheat sheet, troubleshooting playbooks,
   schema design rules and production readiness checklist.
   Entries marked run:true execute as-is against company_db.
   ===================================================================== */

/* ------------------------------ CHEAT SHEET ------------------------------ */
PGM.CHEATSHEET = [
/* ============================== Database ============================== */
{ category: 'Database', cmd: 'CREATE DATABASE',
  syntax: `CREATE DATABASE name
  [ OWNER role ] [ TEMPLATE template ] [ ENCODING enc ]
  [ LOCALE_PROVIDER icu|libc|builtin ] [ LOCALE locale ]
  [ STRATEGY wal_log|file_copy ] [ CONNECTION LIMIT n ];`,
  example: `CREATE DATABASE company_reporting
  OWNER reporting_owner
  TEMPLATE template0
  ENCODING 'UTF8'
  LOCALE_PROVIDER icu ICU_LOCALE 'en-IN';`,
  explain: `Creates a new database by copying a template (template1 by default). Cannot run inside a transaction block; use template0 when you need a different encoding or locale than template1.`,
  run: false },
{ category: 'Database', cmd: 'ALTER DATABASE ... SET',
  syntax: `ALTER DATABASE name SET parameter { TO | = } value;
ALTER DATABASE name RESET parameter;`,
  example: `ALTER DATABASE company_db SET timezone = 'Asia/Kolkata';
ALTER DATABASE company_db SET statement_timeout = '30s';`,
  explain: `Sets a per-database default for a GUC that applies to every NEW session connecting to it. Existing sessions keep their old values until they reconnect.`,
  run: false },
{ category: 'Database', cmd: 'ALTER DATABASE RENAME / OWNER',
  syntax: `ALTER DATABASE name RENAME TO new_name;
ALTER DATABASE name OWNER TO role;`,
  example: `ALTER DATABASE company_reporting RENAME TO company_bi;
ALTER DATABASE company_bi OWNER TO bi_owner;`,
  explain: `Renames or re-owns a database. A rename fails while anyone (including you) is connected to that database, so connect to postgres first.`,
  run: false },
{ category: 'Database', cmd: 'DROP DATABASE WITH (FORCE)',
  syntax: `DROP DATABASE [ IF EXISTS ] name [ WITH ( FORCE ) ];`,
  example: `DROP DATABASE IF EXISTS company_bi WITH (FORCE);`,
  explain: `Removes a database permanently; FORCE (PG13+) terminates existing connections first. There is no undo and no recycle bin: take a backup first.`,
  run: false },
{ category: 'Database', cmd: 'CONNECTION LIMIT / ALLOW_CONNECTIONS',
  syntax: `ALTER DATABASE name WITH CONNECTION LIMIT n;
ALTER DATABASE name WITH ALLOW_CONNECTIONS false;`,
  example: `ALTER DATABASE company_db WITH CONNECTION LIMIT 200;
-- maintenance window: block new logins
ALTER DATABASE company_db WITH ALLOW_CONNECTIONS false;`,
  explain: `Caps or blocks new connections to one database. Superusers are not subject to CONNECTION LIMIT; existing sessions are not disconnected.`,
  run: false },
{ category: 'Database', cmd: 'List databases with size',
  syntax: `SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database;`,
  example: `SELECT datname,
       pg_size_pretty(pg_database_size(datname)) AS size,
       datallowconn, datconnlimit
FROM pg_database
WHERE NOT datistemplate
ORDER BY pg_database_size(datname) DESC;`,
  explain: `SQL equivalent of psql \\l+ that works from any client. pg_database_size walks the database directory, so it is cheap but not free on huge clusters.`,
  run: true },
{ category: 'Database', cmd: 'current_database() / version()',
  syntax: `SELECT current_database(), current_user, version();`,
  example: `SELECT current_database() AS db,
       current_user AS usr,
       inet_server_port() AS port,
       current_setting('server_version') AS pg_version;`,
  explain: `Quick "where am I connected" check before running anything destructive. inet_server_port() returns NULL over a Unix socket.`,
  run: true },
{ category: 'Database', cmd: 'Database age (wraparound)',
  syntax: `SELECT datname, age(datfrozenxid) FROM pg_database;`,
  example: `SELECT datname,
       age(datfrozenxid) AS xid_age,
       round(100.0 * age(datfrozenxid) / 2000000000, 1) AS pct_to_wraparound
FROM pg_database
ORDER BY 2 DESC;`,
  explain: `Shows how many transactions old the oldest unfrozen row is per database. Alert well before 200M (autovacuum_freeze_max_age); at ~2 billion PostgreSQL stops accepting writes.`,
  run: true },

/* ============================== Schema ============================== */
{ category: 'Schema', cmd: 'CREATE SCHEMA',
  syntax: `CREATE SCHEMA [ IF NOT EXISTS ] name [ AUTHORIZATION role ];`,
  example: `CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE analytics.daily_sales (
  sale_date date PRIMARY KEY,
  revenue   numeric(14,2) NOT NULL
);`,
  explain: `Schemas are namespaces inside one database, used to group objects by app module or tenant and to scope privileges. They are not separate databases: queries can join across schemas freely.`,
  run: true },
{ category: 'Schema', cmd: 'CREATE SCHEMA AUTHORIZATION',
  syntax: `CREATE SCHEMA name AUTHORIZATION role;`,
  example: `CREATE ROLE etl_owner NOLOGIN;
CREATE SCHEMA staging AUTHORIZATION etl_owner;
SELECT nspname, pg_get_userbyid(nspowner) AS owner
FROM pg_namespace WHERE nspname = 'staging';`,
  explain: `Creates a schema owned by another role, so that role can create and manage objects there. Owners can always drop objects in their schema, so choose owners deliberately.`,
  run: true },
{ category: 'Schema', cmd: 'SET search_path',
  syntax: `SET search_path TO schema1, schema2, public;
ALTER ROLE role SET search_path = ...;`,
  example: `CREATE SCHEMA IF NOT EXISTS analytics;
SET search_path TO analytics, public;
SHOW search_path;`,
  explain: `Controls which schemas unqualified names resolve against, left to right. Never leave a schema writable by untrusted users early in search_path (CVE-2018-1058 class of attacks).`,
  run: true },
{ category: 'Schema', cmd: 'ALTER SCHEMA RENAME / OWNER',
  syntax: `ALTER SCHEMA name RENAME TO new_name;
ALTER SCHEMA name OWNER TO role;`,
  example: `CREATE SCHEMA reports_old;
ALTER SCHEMA reports_old RENAME TO reports_archive;`,
  explain: `Renames a schema instantly (catalog-only change). Application code, views using qualified names in function bodies, and search_path settings referencing the old name will break.`,
  run: true },
{ category: 'Schema', cmd: 'ALTER TABLE ... SET SCHEMA',
  syntax: `ALTER TABLE name SET SCHEMA new_schema;`,
  example: `CREATE SCHEMA archive;
CREATE TABLE public.old_orders AS SELECT * FROM orders WHERE order_date < '2024-04-01';
ALTER TABLE public.old_orders SET SCHEMA archive;
SELECT count(*) FROM archive.old_orders;`,
  explain: `Moves a table (with its indexes, constraints and owned sequences) to another schema without copying data. Takes a brief ACCESS EXCLUSIVE lock.`,
  run: true },
{ category: 'Schema', cmd: 'DROP SCHEMA CASCADE',
  syntax: `DROP SCHEMA [ IF EXISTS ] name [ CASCADE | RESTRICT ];`,
  example: `CREATE SCHEMA scratch;
CREATE TABLE scratch.t (id int);
DROP SCHEMA scratch CASCADE;`,
  explain: `CASCADE drops every object in the schema and anything elsewhere that depends on them (e.g. views in other schemas). Run without CASCADE first to see the dependency list.`,
  run: true },
{ category: 'Schema', cmd: 'Lock down the public schema',
  syntax: `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`,
  example: `REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- verify: can PUBLIC still create objects here?
SELECT has_schema_privilege('public', 'public', 'CREATE') AS public_can_create;`,
  explain: `Stops every role from creating objects in public (already the default since PG15 for new databases). Upgraded clusters still carry the old permissive grant, so run it explicitly.`,
  run: true },
{ category: 'Schema', cmd: 'List schemas and object counts',
  syntax: `SELECT n.nspname, count(c.oid) FROM pg_namespace n LEFT JOIN pg_class c ...`,
  example: `SELECT n.nspname AS schema,
       pg_get_userbyid(n.nspowner) AS owner,
       count(c.oid) FILTER (WHERE c.relkind = 'r') AS tables
FROM pg_namespace n
LEFT JOIN pg_class c ON c.relnamespace = n.oid
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
GROUP BY 1, 2 ORDER BY 1;`,
  explain: `Catalog query equivalent to psql \\dn+ with a table count. Excludes system schemas.`,
  run: true },

/* ============================== Table ============================== */
{ category: 'Table', cmd: 'CREATE TABLE (identity PK)',
  syntax: `CREATE TABLE name (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  col type [ NOT NULL ] [ DEFAULT expr ] [ CHECK (...) ] [ REFERENCES t(col) ],
  ...
);`,
  example: `CREATE TABLE invoices (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id),
  amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
  issued_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO invoices (order_id, amount) VALUES (1, 499.00) RETURNING *;`,
  explain: `Identity columns are the SQL-standard replacement for serial. GENERATED ALWAYS rejects manual ids unless you use OVERRIDING SYSTEM VALUE, which prevents sequence drift.`,
  run: true },
{ category: 'Table', cmd: 'CREATE TABLE ... LIKE',
  syntax: `CREATE TABLE new (LIKE existing INCLUDING ALL);`,
  example: `CREATE TABLE customers_staging (LIKE customers INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING IDENTITY);
INSERT INTO customers_staging (name, email, country, city, segment, created_at)
SELECT name, email, country, city, segment, created_at FROM customers LIMIT 5;
SELECT count(*) FROM customers_staging;`,
  explain: `Copies column definitions (and optionally defaults, constraints, indexes, identity) but no data; without INCLUDING IDENTITY the id column becomes a plain NOT NULL column. Foreign keys are never copied by LIKE.`,
  run: true },
{ category: 'Table', cmd: 'CREATE TABLE AS',
  syntax: `CREATE TABLE name AS query [ WITH [ NO ] DATA ];`,
  example: `CREATE TABLE customer_ltv AS
SELECT c.id, c.name, sum(o.total_amount) AS lifetime_value
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE o.status <> 'cancelled'
GROUP BY c.id, c.name;
SELECT * FROM customer_ltv ORDER BY lifetime_value DESC LIMIT 5;`,
  explain: `Materialises a query result as a new table. It copies no constraints, indexes or primary key; add them afterwards if the table will be queried.`,
  run: true },
{ category: 'Table', cmd: 'ALTER TABLE ADD COLUMN',
  syntax: `ALTER TABLE name ADD COLUMN [ IF NOT EXISTS ] col type [ DEFAULT expr ] [ NOT NULL ];`,
  example: `ALTER TABLE customers ADD COLUMN loyalty_tier text NOT NULL DEFAULT 'bronze';
SELECT loyalty_tier, count(*) FROM customers GROUP BY 1;`,
  explain: `Since PG11, adding a column with a constant (non-volatile) default is instant: no table rewrite. A volatile default such as clock_timestamp() or gen_random_uuid() still rewrites the whole table.`,
  run: true },
{ category: 'Table', cmd: 'ALTER TABLE DROP COLUMN',
  syntax: `ALTER TABLE name DROP COLUMN [ IF EXISTS ] col [ CASCADE ];`,
  example: `ALTER TABLE products ADD COLUMN legacy_code text;
ALTER TABLE products DROP COLUMN IF EXISTS legacy_code;`,
  explain: `Marks the column dropped in the catalog instantly; the space is reclaimed only as rows are rewritten. Dependent views block it unless you use CASCADE.`,
  run: true },
{ category: 'Table', cmd: 'ALTER COLUMN TYPE',
  syntax: `ALTER TABLE name ALTER COLUMN col TYPE new_type [ USING expr ];`,
  example: `CREATE TABLE price_log (id int, price text);
INSERT INTO price_log VALUES (1, '199.50'), (2, '45');
ALTER TABLE price_log ALTER COLUMN price TYPE numeric(10,2) USING price::numeric;
SELECT * FROM price_log;`,
  explain: `Usually rewrites the table and all its indexes under an ACCESS EXCLUSIVE lock. Exceptions (no rewrite): varchar(n) to larger n or text, numeric precision increase.`,
  run: true },
{ category: 'Table', cmd: 'RENAME TABLE / COLUMN',
  syntax: `ALTER TABLE name RENAME TO new_name;
ALTER TABLE name RENAME COLUMN old TO new;`,
  example: `CREATE TABLE tmp_vendor (id int, nm text);
ALTER TABLE tmp_vendor RENAME COLUMN nm TO vendor_name;
ALTER TABLE tmp_vendor RENAME TO vendors;
SELECT column_name FROM information_schema.columns WHERE table_name = 'vendors';`,
  explain: `Catalog-only and instant, but every application query using the old name breaks immediately. In zero-downtime deploys, add a view or do expand/contract instead.`,
  run: true },
{ category: 'Table', cmd: 'ADD CONSTRAINT ... NOT VALID + VALIDATE',
  syntax: `ALTER TABLE t ADD CONSTRAINT name CHECK (...) NOT VALID;
ALTER TABLE t VALIDATE CONSTRAINT name;`,
  example: `ALTER TABLE products ADD CONSTRAINT products_price_positive CHECK (price > 0) NOT VALID;
ALTER TABLE products VALIDATE CONSTRAINT products_price_positive;`,
  explain: `NOT VALID enforces the rule for new writes immediately with only a brief lock; VALIDATE then scans existing rows under a weaker SHARE UPDATE EXCLUSIVE lock. The standard way to add CHECK and FOREIGN KEY constraints to big live tables.`,
  run: true },
{ category: 'Table', cmd: 'ADD FOREIGN KEY',
  syntax: `ALTER TABLE child ADD CONSTRAINT fk_name FOREIGN KEY (col)
  REFERENCES parent(col) [ ON DELETE CASCADE | RESTRICT | SET NULL ] [ NOT VALID ];`,
  example: `CREATE TABLE product_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id int NOT NULL,
  rating smallint CHECK (rating BETWEEN 1 AND 5)
);
ALTER TABLE product_reviews
  ADD CONSTRAINT product_reviews_product_fk
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
CREATE INDEX ON product_reviews (product_id);`,
  explain: `PostgreSQL does not index the referencing column automatically. Without that index every DELETE on the parent scans the child table.`,
  run: true },
{ category: 'Table', cmd: 'SET / DROP NOT NULL',
  syntax: `ALTER TABLE name ALTER COLUMN col SET NOT NULL;
ALTER TABLE name ALTER COLUMN col DROP NOT NULL;`,
  example: `ALTER TABLE departments ALTER COLUMN location SET NOT NULL;`,
  explain: `SET NOT NULL scans the whole table under ACCESS EXCLUSIVE lock unless a validated CHECK (col IS NOT NULL) already proves it (PG12+), which lets you do it without a long lock.`,
  run: true },
{ category: 'Table', cmd: 'Generated (computed) column',
  syntax: `col type GENERATED ALWAYS AS (expr) STORED | VIRTUAL`,
  example: `ALTER TABLE order_items
  ADD COLUMN line_total numeric(12,2)
  GENERATED ALWAYS AS (quantity * unit_price) STORED;
SELECT order_id, quantity, unit_price, line_total FROM order_items LIMIT 3;`,
  explain: `STORED columns are computed on write and can be indexed; adding one rewrites the table. PG18 adds VIRTUAL (computed on read, now the default). The expression must be immutable.`,
  run: true },
{ category: 'Table', cmd: 'TRUNCATE',
  syntax: `TRUNCATE [ TABLE ] name [, ...] [ RESTART IDENTITY ] [ CASCADE ];`,
  example: `CREATE TABLE import_buffer (id int GENERATED ALWAYS AS IDENTITY, payload text);
INSERT INTO import_buffer (payload) SELECT 'row ' || g FROM generate_series(1, 1000) g;
TRUNCATE import_buffer RESTART IDENTITY;
SELECT count(*) FROM import_buffer;`,
  explain: `Removes all rows instantly by swapping in new empty files, unlike DELETE which marks each row dead. Takes ACCESS EXCLUSIVE lock, fires no row triggers, and is transactional (can be rolled back).`,
  run: true },
{ category: 'Table', cmd: 'CREATE UNLOGGED / TEMP TABLE',
  syntax: `CREATE UNLOGGED TABLE name (...);
CREATE TEMP TABLE name (...) [ ON COMMIT DROP | DELETE ROWS ];`,
  example: `CREATE UNLOGGED TABLE session_cache (k text PRIMARY KEY, v jsonb);
CREATE TEMP TABLE top_customers AS
  SELECT customer_id, sum(total_amount) AS spend FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
SELECT count(*) FROM top_customers;`,
  explain: `UNLOGGED skips WAL (much faster writes) but is truncated after a crash and not replicated. TEMP tables are private to the session and never autovacuumed or analyzed automatically: run ANALYZE yourself.`,
  run: true },
{ category: 'Table', cmd: 'COMMENT ON',
  syntax: `COMMENT ON TABLE | COLUMN | INDEX ... name IS 'text';`,
  example: `COMMENT ON TABLE orders IS 'One row per customer checkout. Owner: commerce team.';
COMMENT ON COLUMN orders.total_amount IS 'Gross amount in INR incl. tax';
SELECT obj_description('orders'::regclass, 'pg_class');`,
  explain: `Stores documentation inside the catalog where psql \\d+ and most GUI tools show it. Cheap and the best place for data-dictionary notes.`,
  run: true },
{ category: 'Table', cmd: 'DROP TABLE',
  syntax: `DROP TABLE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ];`,
  example: `CREATE TABLE throwaway (id int);
DROP TABLE IF EXISTS throwaway;`,
  explain: `Permanently removes the table, its indexes, triggers and constraints. CASCADE also drops dependent views and foreign keys pointing at it, which is easy to do by accident.`,
  run: true },

/* ============================== CRUD ============================== */
{ category: 'CRUD', cmd: 'SELECT ... WHERE / ORDER BY / LIMIT',
  syntax: `SELECT cols FROM t WHERE cond ORDER BY col [ DESC ] LIMIT n [ OFFSET m ];`,
  example: `SELECT first_name, last_name, job_title, salary
FROM employees
WHERE department_id = 1 AND is_active
ORDER BY salary DESC
LIMIT 5;`,
  explain: `The core read. Without ORDER BY row order is undefined, so LIMIT without ORDER BY can return different rows each time.`,
  run: true },
{ category: 'CRUD', cmd: 'INSERT ... RETURNING',
  syntax: `INSERT INTO t (cols) VALUES (...) [, (...)] RETURNING cols;`,
  example: `INSERT INTO departments (name, location, budget)
VALUES ('Legal', 'Mumbai', 2500000), ('Procurement', 'Gurgaon', 1800000)
RETURNING id, name;`,
  explain: `Multi-row VALUES is far faster than one INSERT per row (one round trip, one parse). RETURNING hands back generated ids without a second query.`,
  run: true },
{ category: 'CRUD', cmd: 'INSERT ... SELECT',
  syntax: `INSERT INTO target (cols) SELECT ... FROM source WHERE ...;`,
  example: `CREATE TABLE inactive_employees (LIKE employees);
INSERT INTO inactive_employees
SELECT * FROM employees WHERE NOT is_active;
SELECT count(*) FROM inactive_employees;`,
  explain: `Set-based copy entirely inside the server: no data travels to the client. For very large copies, batch by key range to keep transactions and WAL bursts manageable.`,
  run: true },
{ category: 'CRUD', cmd: 'INSERT ... ON CONFLICT (upsert)',
  syntax: `INSERT INTO t (...) VALUES (...)
ON CONFLICT (unique_cols) DO UPDATE SET col = EXCLUDED.col [ WHERE ... ]
| ON CONFLICT DO NOTHING;`,
  example: `INSERT INTO departments (name, location, budget)
VALUES ('Engineering', 'Bengaluru', 9000000)
ON CONFLICT (name) DO UPDATE
  SET budget = EXCLUDED.budget
RETURNING id, name, budget;`,
  explain: `Atomic insert-or-update that is safe under concurrency. Requires a unique index or constraint matching the conflict target; EXCLUDED refers to the row you tried to insert.`,
  run: true },
{ category: 'CRUD', cmd: 'UPDATE ... FROM',
  syntax: `UPDATE t SET col = expr FROM other WHERE t.key = other.key [ RETURNING ... ];`,
  example: `UPDATE employees e
SET salary = round(e.salary * 1.05, 2)
FROM departments d
WHERE d.id = e.department_id AND d.name = 'Research'
RETURNING e.id, e.first_name, e.salary;`,
  explain: `Joins another table into an UPDATE. If the join produces several matches per target row, one arbitrary match wins, so make sure the join is one-to-one.`,
  run: true },
{ category: 'CRUD', cmd: 'DELETE ... USING / RETURNING',
  syntax: `DELETE FROM t USING other WHERE t.key = other.key RETURNING *;`,
  example: `DELETE FROM payments p
USING orders o
WHERE o.id = p.order_id AND o.status = 'cancelled' AND p.status = 'failed'
RETURNING p.id, p.order_id, p.amount;`,
  explain: `DELETE with a join. Every deleted row becomes a dead tuple that VACUUM must clean; for purging most of a table, TRUNCATE or dropping a partition is far cheaper.`,
  run: true },
{ category: 'CRUD', cmd: 'MERGE',
  syntax: `MERGE INTO target t USING source s ON t.key = s.key
WHEN MATCHED [ AND cond ] THEN UPDATE SET ... | DELETE
WHEN NOT MATCHED THEN INSERT (...) VALUES (...)
[ RETURNING merge_action(), ... ];`,
  example: `MERGE INTO products p
USING (VALUES (1, 10), (2, 5), (3, -3)) AS s(id, delta)
ON p.id = s.id
WHEN MATCHED AND p.stock + s.delta < 0 THEN DO NOTHING
WHEN MATCHED THEN UPDATE SET stock = p.stock + s.delta
RETURNING merge_action(), p.id, p.stock;`,
  explain: `SQL-standard conditional insert/update/delete in one statement (PG15+, RETURNING in PG17+). Unlike ON CONFLICT it is not race-free against concurrent inserts of the same key.`,
  run: true },
{ category: 'CRUD', cmd: 'SELECT DISTINCT ON',
  syntax: `SELECT DISTINCT ON (key) cols FROM t ORDER BY key, tiebreak;`,
  example: `SELECT DISTINCT ON (customer_id)
       customer_id, id AS last_order_id, order_date, total_amount
FROM orders
ORDER BY customer_id, order_date DESC
LIMIT 5;`,
  explain: `PostgreSQL extension returning the first row per group according to ORDER BY: the classic "latest order per customer". ORDER BY must start with the DISTINCT ON expressions.`,
  run: true },
{ category: 'CRUD', cmd: 'Keyset pagination',
  syntax: `SELECT ... WHERE (sort_col, id) < (:last_sort, :last_id) ORDER BY sort_col DESC, id DESC LIMIT n;`,
  example: `SELECT id, order_date, total_amount
FROM orders
WHERE (order_date, id) < ('2025-06-01', 999999)
ORDER BY order_date DESC, id DESC
LIMIT 20;`,
  explain: `Seeks directly to the next page using the last row seen, so page 5000 costs the same as page 1. OFFSET reads and discards every skipped row; back it with an index on (order_date, id).`,
  run: true },
{ category: 'CRUD', cmd: 'COPY (bulk load / export)',
  syntax: `COPY t [ (cols) ] FROM 'server_file' | STDIN WITH (FORMAT csv, HEADER);
COPY (query) TO 'server_file' | STDOUT WITH (FORMAT csv, HEADER);`,
  example: `COPY customers (name, email, country, city, segment)
FROM '/var/lib/postgresql/import/customers.csv'
WITH (FORMAT csv, HEADER true);

COPY (SELECT * FROM orders WHERE order_date >= '2025-01-01')
TO '/tmp/orders_2025.csv' WITH (FORMAT csv, HEADER);`,
  explain: `The fastest way to move rows in or out, often 10x faster than INSERTs. Server-side file paths need superuser or pg_read_server_files/pg_write_server_files; use psql \\copy for client-side files.`,
  run: false },
{ category: 'CRUD', cmd: 'WITH (CTE) data-modifying',
  syntax: `WITH moved AS (DELETE FROM a WHERE ... RETURNING *) INSERT INTO b SELECT * FROM moved;`,
  example: `CREATE TABLE audit_logs_archive (LIKE audit_logs);
WITH moved AS (
  DELETE FROM audit_logs
  WHERE changed_at < now() - interval '365 days'
  RETURNING *
)
INSERT INTO audit_logs_archive SELECT * FROM moved;
SELECT count(*) FROM audit_logs_archive;`,
  explain: `Moves rows atomically in one statement: archive and delete succeed or fail together. All parts see the same snapshot, so a later part cannot see rows inserted by an earlier part.`,
  run: true },
/* ============================== Users ============================== */
{ category: 'Users', cmd: 'CREATE USER ... PASSWORD',
  syntax: `CREATE USER name WITH [ LOGIN ] PASSWORD 'secret' [ VALID UNTIL 'ts' ] [ CONNECTION LIMIT n ];`,
  example: `CREATE USER report_app WITH PASSWORD 'Ch4nge-Me-Now!' CONNECTION LIMIT 20;
SELECT rolname, rolcanlogin, rolconnlimit FROM pg_roles WHERE rolname = 'report_app';`,
  explain: `CREATE USER is CREATE ROLE with LOGIN. Roles are cluster-wide, not per database. Passwords typed in SQL can land in server logs and shell history; prefer psql \\password.`,
  run: true },
{ category: 'Users', cmd: 'ALTER USER ... PASSWORD / VALID UNTIL',
  syntax: `ALTER ROLE name WITH PASSWORD 'new' [ VALID UNTIL 'timestamp' ];`,
  example: `CREATE USER contractor_amit WITH PASSWORD 'Tmp-Pass-2026';
ALTER ROLE contractor_amit VALID UNTIL '2026-12-31 23:59:59+05:30';
SELECT rolname, rolvaliduntil FROM pg_roles WHERE rolname = 'contractor_amit';`,
  explain: `VALID UNTIL expires the password, not the role: certificate, peer or trust authentication still works. Use it for contractor accounts.`,
  run: true },
{ category: 'Users', cmd: 'SCRAM password encryption',
  syntax: `SET password_encryption = 'scram-sha-256';`,
  example: `SET password_encryption = 'scram-sha-256';
CREATE USER api_service WITH PASSWORD 'S3cure-Api-Pass';
SELECT rolname, left(rolpassword, 14) AS hash_prefix
FROM pg_authid WHERE rolname = 'api_service';`,
  explain: `SCRAM-SHA-256 is the default since PG14 and the only safe choice; MD5 hashes are deprecated (PG18 warns). Pair with scram-sha-256 lines in pg_hba.conf.`,
  run: true },
{ category: 'Users', cmd: 'ALTER ROLE ... SET (per-user settings)',
  syntax: `ALTER ROLE name [ IN DATABASE db ] SET parameter = value;`,
  example: `CREATE USER bi_reader WITH PASSWORD 'Bi-Read-2026';
ALTER ROLE bi_reader SET statement_timeout = '60s';
ALTER ROLE bi_reader SET default_transaction_read_only = on;
SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'bi_reader';`,
  explain: `Gives a user safe defaults applied at login, e.g. read-only and a timeout for BI tools. The user can still override them with SET in their session, so this is a guard rail, not security.`,
  run: true },
{ category: 'Users', cmd: 'List users and attributes',
  syntax: `SELECT rolname, rolsuper, rolcanlogin FROM pg_roles;`,
  example: `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolbypassrls, rolvaliduntil
FROM pg_roles
WHERE rolname !~ '^pg_'
ORDER BY rolcanlogin DESC, rolname;`,
  explain: `SQL equivalent of psql \\du. Audit regularly: every rolsuper, rolbypassrls and rolreplication = true should be justified.`,
  run: true },
{ category: 'Users', cmd: 'current_user / session_user',
  syntax: `SELECT current_user, session_user;`,
  example: `SELECT current_user, session_user,
       pg_has_role(current_user, 'pg_monitor', 'member') AS is_monitor;`,
  explain: `session_user is who logged in; current_user is the identity used for permission checks, which changes under SET ROLE and inside SECURITY DEFINER functions.`,
  run: true },
{ category: 'Users', cmd: 'REASSIGN OWNED / DROP OWNED / DROP USER',
  syntax: `REASSIGN OWNED BY old_role TO new_role;
DROP OWNED BY old_role;
DROP ROLE old_role;`,
  example: `CREATE USER leaving_dev WITH PASSWORD 'Bye-2026';
CREATE ROLE app_owner NOLOGIN;
CREATE TABLE dev_notes (id int);
ALTER TABLE dev_notes OWNER TO leaving_dev;
REASSIGN OWNED BY leaving_dev TO app_owner;
DROP OWNED BY leaving_dev;
DROP USER leaving_dev;`,
  explain: `A role that owns objects or holds grants cannot be dropped. REASSIGN then DROP OWNED (which revokes grants) must be run in EVERY database of the cluster before DROP ROLE succeeds.`,
  run: true },
{ category: 'Users', cmd: 'Lock a login (NOLOGIN)',
  syntax: `ALTER ROLE name NOLOGIN;`,
  example: `CREATE USER suspicious_user WITH PASSWORD 'X-123-abc';
ALTER ROLE suspicious_user NOLOGIN;
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'suspicious_user';`,
  explain: `Blocks new logins immediately without dropping anything. Existing sessions continue; terminate them with pg_terminate_backend if needed.`,
  run: true },

/* ============================== Roles ============================== */
{ category: 'Roles', cmd: 'CREATE ROLE (group role)',
  syntax: `CREATE ROLE name NOLOGIN [ INHERIT ];
GRANT group_role TO user_role;`,
  example: `CREATE ROLE readonly NOLOGIN;
CREATE USER analyst_priya WITH PASSWORD 'Pr1ya-Analyst';
GRANT readonly TO analyst_priya;
SELECT r.rolname AS member, g.rolname AS group_role
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.member
JOIN pg_roles g ON g.oid = m.roleid
WHERE r.rolname = 'analyst_priya';`,
  explain: `Grant privileges to NOLOGIN group roles and grant the group to people; never grant directly to individuals. Offboarding becomes a single REVOKE.`,
  run: true },
{ category: 'Roles', cmd: 'GRANT USAGE ON SCHEMA',
  syntax: `GRANT USAGE ON SCHEMA s TO role;`,
  example: `CREATE ROLE readonly NOLOGIN;
GRANT CONNECT ON DATABASE postgres TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;`,
  explain: `Table privileges are useless without USAGE on the schema containing them. Remember CONNECT on the database too if PUBLIC lost it.`,
  run: true },
{ category: 'Roles', cmd: 'GRANT ON ALL TABLES IN SCHEMA',
  syntax: `GRANT SELECT | INSERT | UPDATE | DELETE ON ALL TABLES IN SCHEMA s TO role;`,
  example: `CREATE ROLE readonly NOLOGIN;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO readonly;`,
  explain: `Applies to tables that exist right now only. Tables created tomorrow are not covered: pair it with ALTER DEFAULT PRIVILEGES.`,
  run: true },
{ category: 'Roles', cmd: 'ALTER DEFAULT PRIVILEGES',
  syntax: `ALTER DEFAULT PRIVILEGES [ FOR ROLE creator ] IN SCHEMA s
  GRANT SELECT ON TABLES TO role;`,
  example: `CREATE ROLE readonly NOLOGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;
CREATE TABLE new_report (id int);
SELECT has_table_privilege('readonly', 'new_report', 'SELECT') AS can_read;`,
  explain: `Auto-grants privileges on objects created in the future. It only applies to objects created by the role named in FOR ROLE (default: you), a frequent source of "permission denied" surprises after migrations run as another user.`,
  run: true },
{ category: 'Roles', cmd: 'Column-level GRANT',
  syntax: `GRANT SELECT (col1, col2) ON t TO role;`,
  example: `CREATE ROLE support_agent NOLOGIN;
GRANT SELECT (id, username, email, role, is_active) ON users TO support_agent;
SELECT has_column_privilege('support_agent', 'users', 'password_hash', 'SELECT') AS can_see_hash;`,
  explain: `Hides sensitive columns such as password_hash. SELECT * then fails for that role, so give them a view or an explicit column list.`,
  run: true },
{ category: 'Roles', cmd: 'REVOKE',
  syntax: `REVOKE privilege ON object FROM role [ CASCADE ];`,
  example: `CREATE ROLE intern NOLOGIN;
GRANT SELECT, UPDATE ON employees TO intern;
REVOKE UPDATE ON employees FROM intern;
SELECT privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'intern' AND table_name = 'employees';`,
  explain: `Removes a privilege granted directly. If the role still gets it through a group role or PUBLIC, REVOKE does not remove that path; check effective rights with has_table_privilege.`,
  run: true },
{ category: 'Roles', cmd: 'Row-Level Security (RLS)',
  syntax: `ALTER TABLE t ENABLE ROW LEVEL SECURITY;
CREATE POLICY name ON t [ FOR cmd ] TO role USING (expr) [ WITH CHECK (expr) ];`,
  example: `CREATE ROLE tenant_app NOLOGIN;
GRANT SELECT ON users TO tenant_app;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users TO tenant_app
  USING (tenant_id = current_setting('app.tenant_id')::int);
SET app.tenant_id = '2';
SET ROLE tenant_app;
SELECT DISTINCT tenant_id FROM users;
RESET ROLE;`,
  explain: `Filters rows per user inside the database (multi-tenant isolation). Table owners and superusers bypass RLS unless FORCE ROW LEVEL SECURITY is set; index tenant_id because the policy becomes part of every query.`,
  run: true },
{ category: 'Roles', cmd: 'SET ROLE / RESET ROLE',
  syntax: `SET ROLE role_name;
RESET ROLE;`,
  example: `CREATE ROLE readonly NOLOGIN;
GRANT SELECT ON departments TO readonly;
SET ROLE readonly;
SELECT current_user, count(*) FROM departments;
RESET ROLE;`,
  explain: `Temporarily act as another role you are a member of, e.g. to test what a role can actually see. Not a security boundary: the session can RESET ROLE at any time.`,
  run: true },
{ category: 'Roles', cmd: 'Predefined roles',
  syntax: `GRANT pg_read_all_data | pg_write_all_data | pg_monitor | pg_signal_backend TO role;`,
  example: `CREATE USER monitoring_agent WITH PASSWORD 'Mon-Agent-2026';
GRANT pg_monitor TO monitoring_agent;
CREATE USER backup_reader WITH PASSWORD 'Bkp-Read-2026';
GRANT pg_read_all_data TO backup_reader;`,
  explain: `Built-in roles grant common capabilities without superuser: pg_monitor for metrics agents, pg_read_all_data for logical backups, pg_signal_backend to cancel queries. pg_maintain (PG17+) allows VACUUM/ANALYZE/REINDEX.`,
  run: true },
{ category: 'Roles', cmd: 'Check effective privileges',
  syntax: `SELECT has_table_privilege(role, table, priv);`,
  example: `SELECT r.rolname,
       has_table_privilege(r.rolname, 'orders', 'SELECT') AS sel,
       has_table_privilege(r.rolname, 'orders', 'UPDATE') AS upd
FROM pg_roles r
WHERE r.rolcanlogin
ORDER BY 1;`,
  explain: `Answers "can this role really do X?" including inherited membership and PUBLIC grants, which is more reliable than reading GRANT history.`,
  run: true },

/* ============================== Indexes ============================== */
{ category: 'Indexes', cmd: 'CREATE INDEX (B-tree)',
  syntax: `CREATE INDEX [ name ] ON t [ USING btree ] (col [ ASC | DESC ] [ NULLS FIRST | LAST ], ...);`,
  example: `CREATE INDEX idx_orders_customer ON orders (customer_id);
EXPLAIN SELECT * FROM orders WHERE customer_id = 42;`,
  explain: `B-tree serves =, &lt;, &gt;, BETWEEN, IN, ORDER BY and prefix LIKE. Plain CREATE INDEX blocks writes (SHARE lock) for the whole build, so use CONCURRENTLY in production.`,
  run: true },
{ category: 'Indexes', cmd: 'CREATE INDEX CONCURRENTLY',
  syntax: `CREATE INDEX CONCURRENTLY [ IF NOT EXISTS ] name ON t (cols);`,
  example: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_order ON payments (order_id);`,
  explain: `Builds without blocking INSERT/UPDATE/DELETE, at the cost of two table scans and waiting for older transactions. Cannot run in a transaction block; if it fails it leaves an INVALID index you must drop.`,
  run: true },
{ category: 'Indexes', cmd: 'Multi-column index',
  syntax: `CREATE INDEX name ON t (col_a, col_b);`,
  example: `CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date DESC);
EXPLAIN SELECT id, order_date FROM orders
WHERE customer_id = 7 ORDER BY order_date DESC LIMIT 10;`,
  explain: `Column order matters: put equality columns first, then the range or sort column. This index serves customer_id alone too, but not order_date alone efficiently.`,
  run: true },
{ category: 'Indexes', cmd: 'Partial index',
  syntax: `CREATE INDEX name ON t (cols) WHERE predicate;`,
  example: `CREATE INDEX idx_orders_pending ON orders (order_date) WHERE status = 'pending';
EXPLAIN SELECT id FROM orders WHERE status = 'pending' AND order_date > '2025-09-01';`,
  explain: `Indexes only the rows you actually query, making it smaller and cheaper to maintain. The planner uses it only when the query's WHERE clause provably implies the index predicate.`,
  run: true },
{ category: 'Indexes', cmd: 'Expression index',
  syntax: `CREATE INDEX name ON t ((expression));`,
  example: `CREATE INDEX idx_customers_email_lower ON customers (lower(email));
EXPLAIN SELECT id FROM customers WHERE lower(email) = 'someone@example.com';`,
  explain: `Indexes a computed value; the query must use exactly the same expression. Function must be IMMUTABLE, and ANALYZE gathers statistics on the expression after creation.`,
  run: true },
{ category: 'Indexes', cmd: 'Covering index (INCLUDE)',
  syntax: `CREATE INDEX name ON t (key_cols) INCLUDE (payload_cols);`,
  example: `CREATE INDEX idx_orders_cust_cover ON orders (customer_id) INCLUDE (total_amount, status);
VACUUM orders;
EXPLAIN SELECT total_amount, status FROM orders WHERE customer_id = 10;`,
  explain: `Adds non-key columns to the leaf pages so the query can be answered by an Index Only Scan. Only helps when the visibility map is mostly set, i.e. the table is well vacuumed.`,
  run: true },
{ category: 'Indexes', cmd: 'UNIQUE index',
  syntax: `CREATE UNIQUE INDEX name ON t (cols) [ NULLS NOT DISTINCT ] [ WHERE ... ];`,
  example: `CREATE UNIQUE INDEX uq_projects_dept_name ON projects (department_id, lower(name));
CREATE UNIQUE INDEX uq_users_active_email ON users (lower(email)) WHERE is_active;`,
  explain: `Enforces uniqueness on expressions or subsets of rows, which a UNIQUE constraint cannot do. NULLs are distinct by default; NULLS NOT DISTINCT (PG15+) treats them as equal.`,
  run: true },
{ category: 'Indexes', cmd: 'GIN index on JSONB',
  syntax: `CREATE INDEX name ON t USING gin (jsonb_col [ jsonb_path_ops ]);`,
  example: `CREATE INDEX idx_products_attrs ON products USING gin (attributes jsonb_path_ops);
EXPLAIN SELECT id, name FROM products WHERE attributes @> '{"brand": "Sony"}';`,
  explain: `GIN indexes every key/value inside the document for containment (@&gt;) queries. jsonb_path_ops is smaller and faster but supports only @&gt; and jsonpath operators, not key-exists (?).`,
  run: true },
{ category: 'Indexes', cmd: 'GIN index on arrays',
  syntax: `CREATE INDEX name ON t USING gin (array_col);`,
  example: `CREATE INDEX idx_products_tags ON products USING gin (tags);
EXPLAIN SELECT id, name FROM products WHERE tags @> ARRAY['wireless'];`,
  explain: `Supports @&gt;, &lt;@, &amp;&amp; (overlap) and = on arrays. Writes are slower because each element is a separate index entry; fastupdate buffers them in a pending list.`,
  run: true },
{ category: 'Indexes', cmd: 'Trigram index (pg_trgm)',
  syntax: `CREATE EXTENSION pg_trgm;
CREATE INDEX name ON t USING gin (col gin_trgm_ops);`,
  example: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
EXPLAIN SELECT id, name FROM customers WHERE name ILIKE '%shar%';`,
  explain: `pg_trgm is an extension (shipped in contrib). It makes LIKE/ILIKE with leading wildcards and similarity searches indexable; needs at least 3 characters in the pattern to be useful.`,
  run: true },
{ category: 'Indexes', cmd: 'BRIN index',
  syntax: `CREATE INDEX name ON t USING brin (col) [ WITH (pages_per_range = n) ];`,
  example: `CREATE INDEX idx_orders_date_brin ON orders USING brin (order_date);
SELECT pg_size_pretty(pg_relation_size('idx_orders_date_brin')) AS brin_size;`,
  explain: `Stores min/max per block range, so it is tiny (kilobytes for gigabytes of data). Only effective when values correlate with physical order, e.g. append-only timestamps.`,
  run: true },
{ category: 'Indexes', cmd: 'REINDEX CONCURRENTLY',
  syntax: `REINDEX [ ( VERBOSE ) ] INDEX | TABLE | SCHEMA | DATABASE CONCURRENTLY name;`,
  example: `REINDEX INDEX CONCURRENTLY idx_order_items_order;`,
  explain: `Rebuilds a bloated or corrupt index without blocking writes (PG12+). Needs disk space for a second copy; failures leave an *_ccnew index to drop.`,
  run: true },
{ category: 'Indexes', cmd: 'DROP INDEX CONCURRENTLY',
  syntax: `DROP INDEX CONCURRENTLY [ IF EXISTS ] name;`,
  example: `CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
DROP INDEX CONCURRENTLY IF EXISTS idx_products_category;`,
  explain: `Drops without taking an ACCESS EXCLUSIVE lock that would queue all reads behind it. Cannot drop indexes backing constraints; drop the constraint instead.`,
  run: true },
{ category: 'Indexes', cmd: 'Find unused indexes',
  syntax: `SELECT ... FROM pg_stat_user_indexes WHERE idx_scan = 0;`,
  example: `SELECT s.relname AS table_name, s.indexrelname AS index_name,
       s.idx_scan, pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
ORDER BY pg_relation_size(s.indexrelid) DESC;`,
  explain: `Every index slows writes and uses cache. Counters are per node: check replicas too and make sure stats were not reset recently before dropping.`,
  run: true },
{ category: 'Indexes', cmd: 'Find invalid indexes',
  syntax: `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`,
  example: `SELECT indexrelid::regclass AS index_name, indrelid::regclass AS table_name
FROM pg_index
WHERE NOT indisvalid OR NOT indisready;`,
  explain: `INVALID indexes come from failed CONCURRENTLY builds. They are not used for reads but still maintained on every write: drop and recreate them.`,
  run: true },
{ category: 'Indexes', cmd: 'Index definition and size',
  syntax: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 't';`,
  example: `SELECT indexname,
       pg_size_pretty(pg_relation_size(quote_ident(indexname)::regclass)) AS size,
       indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'orders';`,
  explain: `Lists the exact DDL of each index (handy for recreating them) plus its size. psql \\di+ shows similar information.`,
  run: true },

/* ============================== Functions ============================== */
{ category: 'Functions', cmd: 'CREATE FUNCTION (SQL)',
  syntax: `CREATE [ OR REPLACE ] FUNCTION name(arg type, ...) RETURNS type
LANGUAGE sql [ IMMUTABLE | STABLE | VOLATILE ]
[ RETURN expr | AS 'body' | BEGIN ATOMIC ... END ];`,
  example: `CREATE FUNCTION gst_amount(net numeric, rate numeric DEFAULT 18)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN round(net * rate / 100, 2);
SELECT gst_amount(1000), gst_amount(1000, 5);`,
  explain: `Simple SQL functions can be inlined by the planner. Mark volatility honestly: IMMUTABLE allows use in indexes and constant folding; lying causes wrong results.`,
  run: true },
{ category: 'Functions', cmd: 'CREATE FUNCTION (PL/pgSQL)',
  syntax: `CREATE FUNCTION name(args) RETURNS type LANGUAGE plpgsql AS $$
DECLARE ... BEGIN ... RETURN ...; END $$;`,
  example: `CREATE FUNCTION dept_headcount(p_dept int)
RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM employees WHERE department_id = p_dept AND is_active;
  RETURN n;
END $$;
SELECT name, dept_headcount(id) FROM departments ORDER BY 2 DESC;`,
  explain: `Procedural logic with variables, IF, loops and exception handling. Calling it per row (as here) runs one query per department; a set-based JOIN is usually faster for large sets.`,
  run: true },
{ category: 'Functions', cmd: 'RETURNS TABLE (set-returning)',
  syntax: `CREATE FUNCTION name(args) RETURNS TABLE (col type, ...) LANGUAGE sql AS $$ SELECT ... $$;`,
  example: `CREATE FUNCTION top_customers(p_country text, p_limit int DEFAULT 5)
RETURNS TABLE (customer_id int, name text, spend numeric)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.name, sum(o.total_amount)
  FROM customers c JOIN orders o ON o.customer_id = c.id
  WHERE c.country = p_country AND o.status <> 'cancelled'
  GROUP BY c.id, c.name
  ORDER BY 3 DESC
  LIMIT p_limit
$$;
SELECT * FROM top_customers('India', 3);`,
  explain: `Used in FROM like a parameterised view. Output column names act as variables inside PL/pgSQL bodies, so qualify table columns to avoid ambiguity errors.`,
  run: true },
{ category: 'Functions', cmd: 'CREATE PROCEDURE / CALL',
  syntax: `CREATE PROCEDURE name(args) LANGUAGE plpgsql AS $$ BEGIN ... [ COMMIT; ] END $$;
CALL name(args);`,
  example: `CREATE PROCEDURE give_raise(p_dept int, p_pct numeric)
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE employees SET salary = round(salary * (1 + p_pct / 100), 2)
  WHERE department_id = p_dept;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Updated % rows', n;
END $$;
CALL give_raise(2, 3);`,
  explain: `Procedures (PG11+) can COMMIT/ROLLBACK inside their body, which makes batched maintenance jobs possible. They return no value, only INOUT/OUT parameters, and transaction control only works when CALL is not inside an outer transaction.`,
  run: true },
{ category: 'Functions', cmd: 'DO (anonymous block)',
  syntax: `DO $$ DECLARE ... BEGIN ... END $$ [ LANGUAGE plpgsql ];`,
  example: `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'order%' LOOP
    RAISE NOTICE 'table: %', r.tablename;
  END LOOP;
END $$;`,
  explain: `Runs one-off procedural code without creating a function: handy for migrations and scripted maintenance. It cannot take parameters or return rows.`,
  run: true },
{ category: 'Functions', cmd: 'SECURITY DEFINER (safely)',
  syntax: `CREATE FUNCTION ... SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS ...;
REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;`,
  example: `CREATE FUNCTION deactivate_user(p_id int) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ UPDATE public.users SET is_active = false WHERE id = p_id $$;
REVOKE EXECUTE ON FUNCTION deactivate_user(int) FROM PUBLIC;
SELECT deactivate_user(60);`,
  explain: `Runs with the owner's privileges (like setuid). Always pin search_path and revoke EXECUTE from PUBLIC, otherwise a caller can hijack it with their own objects.`,
  run: true },
{ category: 'Functions', cmd: 'RAISE / exception handling',
  syntax: `RAISE [ NOTICE | WARNING | EXCEPTION ] 'fmt %', arg [ USING ERRCODE = '...' ];
BEGIN ... EXCEPTION WHEN condition THEN ... END;`,
  example: `CREATE FUNCTION safe_div(a numeric, b numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN a / b;
EXCEPTION WHEN division_by_zero THEN
  RAISE NOTICE 'division by zero, returning NULL';
  RETURN NULL;
END $$;
SELECT safe_div(10, 4), safe_div(1, 0);`,
  explain: `An EXCEPTION clause creates a subtransaction on every entry to the block, which is costly in hot loops and burns subtransaction IDs. Catch only what you can actually handle.`,
  run: true },
{ category: 'Functions', cmd: 'List / drop functions',
  syntax: `DROP FUNCTION [ IF EXISTS ] name(arg_types) [ CASCADE ];`,
  example: `CREATE FUNCTION tmp_fn(int) RETURNS int LANGUAGE sql RETURN $1 * 2;
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.provolatile
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';
DROP FUNCTION tmp_fn(int);`,
  explain: `Functions are identified by name plus argument types (overloading), so DROP needs the signature when overloads exist. psql \\df lists them.`,
  run: true },

/* ============================== Triggers ============================== */
{ category: 'Triggers', cmd: 'updated_at trigger',
  syntax: `CREATE TRIGGER name BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION fn();`,
  example: `ALTER TABLE products ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
UPDATE products SET price = price WHERE id = 1 RETURNING id, updated_at;`,
  explain: `The canonical BEFORE ROW trigger: it modifies NEW before it is written. now() is the transaction start time; use clock_timestamp() if you need wall-clock time.`,
  run: true },
{ category: 'Triggers', cmd: 'Audit trigger (AFTER)',
  syntax: `CREATE TRIGGER name AFTER INSERT OR UPDATE OR DELETE ON t FOR EACH ROW EXECUTE FUNCTION fn();`,
  example: `CREATE FUNCTION audit_departments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by, changed_at)
  VALUES (TG_TABLE_NAME, TG_OP,
          COALESCE(NEW.id, OLD.id),
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
          current_user, now());
  RETURN NULL;
END $$;
CREATE TRIGGER trg_departments_audit
  AFTER INSERT OR UPDATE OR DELETE ON departments
  FOR EACH ROW EXECUTE FUNCTION audit_departments();
UPDATE departments SET budget = budget + 1000 WHERE name = 'HR';
SELECT operation, old_data->>'budget' AS old_b, new_data->>'budget' AS new_b
FROM audit_logs ORDER BY id DESC LIMIT 1;`,
  explain: `Records every change inside the same transaction, so the audit row commits or rolls back with the data. Doubles write volume for the audited table; keep the trigger body lean.`,
  run: true },
{ category: 'Triggers', cmd: 'BEFORE trigger validation',
  syntax: `IF condition THEN RAISE EXCEPTION '...'; END IF; RETURN NEW;`,
  example: `CREATE FUNCTION check_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(sum(allocation_pct), 0) FROM employee_projects
      WHERE employee_id = NEW.employee_id AND project_id <> NEW.project_id)
     + NEW.allocation_pct > 100 THEN
    RAISE EXCEPTION 'Employee % would exceed 100%% allocation', NEW.employee_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ep_allocation BEFORE INSERT OR UPDATE ON employee_projects
  FOR EACH ROW EXECUTE FUNCTION check_allocation();`,
  explain: `Enforces cross-row rules that CHECK constraints cannot express. Not concurrency-safe by itself: two parallel inserts can both pass, so add locking (SELECT ... FOR UPDATE on the employee) for strict guarantees.`,
  run: true },
{ category: 'Triggers', cmd: 'Statement trigger with transition tables',
  syntax: `CREATE TRIGGER name AFTER UPDATE ON t REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION fn();`,
  example: `CREATE TABLE stock_changes (changed_at timestamptz DEFAULT now(), rows_changed int);
CREATE FUNCTION log_stock_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO stock_changes (rows_changed) SELECT count(*) FROM new_rows;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_products_stock_batch AFTER UPDATE ON products
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION log_stock_batch();
UPDATE products SET stock = stock + 1 WHERE category = 'audio';
SELECT * FROM stock_changes;`,
  explain: `Fires once per statement and sees all affected rows as a table: much cheaper than a row trigger for bulk updates.`,
  run: true },
{ category: 'Triggers', cmd: 'Conditional trigger (WHEN)',
  syntax: `CREATE TRIGGER name AFTER UPDATE OF col ON t FOR EACH ROW WHEN (OLD.col IS DISTINCT FROM NEW.col) EXECUTE FUNCTION fn();`,
  example: `CREATE TABLE salary_history (employee_id int, old_salary numeric, new_salary numeric, changed_at timestamptz DEFAULT now());
CREATE FUNCTION log_salary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO salary_history (employee_id, old_salary, new_salary) VALUES (NEW.id, OLD.salary, NEW.salary);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_salary_change AFTER UPDATE OF salary ON employees
  FOR EACH ROW WHEN (OLD.salary IS DISTINCT FROM NEW.salary)
  EXECUTE FUNCTION log_salary();
UPDATE employees SET salary = salary + 1000 WHERE id = 12;
SELECT * FROM salary_history;`,
  explain: `The WHEN clause is evaluated before calling the function, so unchanged rows cost almost nothing. UPDATE OF col fires only when that column is in the SET list.`,
  run: true },
{ category: 'Triggers', cmd: 'DISABLE / ENABLE TRIGGER',
  syntax: `ALTER TABLE t DISABLE TRIGGER name | USER | ALL;
ALTER TABLE t ENABLE TRIGGER name | USER | ALL;`,
  example: `CREATE FUNCTION noop_trg() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_noop BEFORE INSERT ON customers FOR EACH ROW EXECUTE FUNCTION noop_trg();
ALTER TABLE customers DISABLE TRIGGER trg_noop;
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_noop';
ALTER TABLE customers ENABLE TRIGGER trg_noop;`,
  explain: `Useful for bulk loads but takes a SHARE ROW EXCLUSIVE lock and affects all sessions. DISABLE TRIGGER ALL also disables FK enforcement triggers (superuser only), which can leave orphan rows.`,
  run: true },
{ category: 'Triggers', cmd: 'List / drop triggers',
  syntax: `DROP TRIGGER [ IF EXISTS ] name ON t;`,
  example: `SELECT tgrelid::regclass AS table_name, tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE NOT tgisinternal;`,
  explain: `Lists user-defined triggers (internal ones implement foreign keys). Triggers are invisible in queries, so document them: they are a common cause of "mystery" slowness.`,
  run: true },
{ category: 'Triggers', cmd: 'Event trigger (DDL)',
  syntax: `CREATE EVENT TRIGGER name ON ddl_command_end | sql_drop | table_rewrite | login
  [ WHEN TAG IN (...) ] EXECUTE FUNCTION fn();`,
  example: `CREATE FUNCTION block_drop_table() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DROP TABLE is blocked in production (%).', tg_tag;
END $$;
CREATE EVENT TRIGGER no_drop_table ON ddl_command_start
  WHEN TAG IN ('DROP TABLE')
  EXECUTE FUNCTION block_drop_table();`,
  explain: `Fires on DDL instead of DML: for guarding against accidental drops or logging schema changes. Superuser only; a buggy login event trigger (PG17+) can lock everyone out.`,
  run: false },

/* ============================== Views ============================== */
{ category: 'Views', cmd: 'CREATE VIEW',
  syntax: `CREATE [ OR REPLACE ] VIEW name [ WITH (security_invoker = true) ] AS query;`,
  example: `CREATE VIEW v_department_summary AS
SELECT d.name, count(e.id) AS headcount, round(avg(e.salary), 2) AS avg_salary
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id AND e.is_active
GROUP BY d.name;
SELECT * FROM v_department_summary ORDER BY headcount DESC;`,
  explain: `A stored query, expanded into the caller's query at plan time: no data is stored and there is no performance gain by itself. Great for hiding complexity and columns.`,
  run: true },
{ category: 'Views', cmd: 'CREATE OR REPLACE VIEW',
  syntax: `CREATE OR REPLACE VIEW name AS query;`,
  example: `CREATE VIEW v_active_staff AS SELECT id, first_name, last_name FROM employees WHERE is_active;
CREATE OR REPLACE VIEW v_active_staff AS
SELECT id, first_name, last_name, job_title FROM employees WHERE is_active;`,
  explain: `Can only append new columns at the end; renaming, removing or changing column types requires DROP VIEW and recreate (and dependent views must be dropped too).`,
  run: true },
{ category: 'Views', cmd: 'Updatable view WITH CHECK OPTION',
  syntax: `CREATE VIEW name AS SELECT ... WHERE cond WITH [ LOCAL | CASCADED ] CHECK OPTION;`,
  example: `CREATE VIEW v_india_customers AS
SELECT id, name, email, country, city, segment FROM customers WHERE country = 'India'
WITH CHECK OPTION;
UPDATE v_india_customers SET city = 'Pune' WHERE id = (SELECT min(id) FROM v_india_customers)
RETURNING id, city;`,
  explain: `Simple single-table views are automatically updatable. CHECK OPTION rejects writes that would make the row vanish from the view (e.g. setting country = 'UK').`,
  run: true },
{ category: 'Views', cmd: 'security_invoker / security_barrier',
  syntax: `CREATE VIEW name WITH (security_invoker = true, security_barrier = true) AS ...;`,
  example: `CREATE VIEW v_users_public WITH (security_invoker = true, security_barrier = true) AS
SELECT id, username, role, tenant_id FROM users WHERE is_active;
SELECT count(*) FROM v_users_public;`,
  explain: `By default views run with the owner's privileges and bypass the caller's RLS. security_invoker (PG15+) checks the caller's rights; security_barrier stops leaky functions seeing filtered rows.`,
  run: true },
{ category: 'Views', cmd: 'CREATE MATERIALIZED VIEW',
  syntax: `CREATE MATERIALIZED VIEW name AS query [ WITH [ NO ] DATA ];`,
  example: `CREATE MATERIALIZED VIEW mv_monthly_revenue AS
SELECT date_trunc('month', order_date) AS month, sum(total_amount) AS revenue, count(*) AS orders
FROM orders WHERE status <> 'cancelled'
GROUP BY 1;
CREATE UNIQUE INDEX ON mv_monthly_revenue (month);
SELECT * FROM mv_monthly_revenue ORDER BY month DESC LIMIT 3;`,
  explain: `Stores the result physically and can be indexed, so dashboards read precomputed data. It is stale until refreshed; there is no automatic incremental refresh in core.`,
  run: true },
{ category: 'Views', cmd: 'REFRESH MATERIALIZED VIEW CONCURRENTLY',
  syntax: `REFRESH MATERIALIZED VIEW [ CONCURRENTLY ] name;`,
  example: `CREATE MATERIALIZED VIEW mv_category_stock AS
SELECT category, sum(stock) AS units FROM products GROUP BY category;
CREATE UNIQUE INDEX ON mv_category_stock (category);
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_category_stock;`,
  explain: `CONCURRENTLY lets readers keep querying during refresh but needs a UNIQUE index and does a diff, so it is slower. Plain REFRESH blocks reads with an ACCESS EXCLUSIVE lock.`,
  run: true },
{ category: 'Views', cmd: 'View dependencies',
  syntax: `SELECT ... FROM pg_depend / information_schema.view_table_usage`,
  example: `CREATE VIEW v_dep_demo AS SELECT id, name FROM departments;
SELECT view_name, table_name
FROM information_schema.view_table_usage
WHERE table_schema = 'public'
ORDER BY 1;`,
  explain: `Shows which views depend on which tables before you ALTER or DROP. Column type changes on a table fail while any view references that column.`,
  run: true },
{ category: 'Views', cmd: 'DROP VIEW / MATERIALIZED VIEW',
  syntax: `DROP [ MATERIALIZED ] VIEW [ IF EXISTS ] name [ CASCADE ];`,
  example: `CREATE VIEW v_tmp AS SELECT 1 AS x;
DROP VIEW IF EXISTS v_tmp;`,
  explain: `Drops only the definition (or the stored data for a materialized view); base tables are untouched. CASCADE also drops views built on top.`,
  run: true },

/* ============================== Transactions ============================== */
{ category: 'Transactions', cmd: 'BEGIN / COMMIT',
  syntax: `BEGIN [ ISOLATION LEVEL ... ] [ READ ONLY ];
...;
COMMIT;`,
  example: `BEGIN;
UPDATE products SET stock = stock - 2 WHERE id = 5;
INSERT INTO orders (customer_id, status, order_date, total_amount)
VALUES (10, 'pending', now(), 0);
COMMIT;`,
  explain: `Groups statements so they all succeed or none do. Keep transactions short: an open transaction holds locks and prevents VACUUM from cleaning any row newer than its snapshot.`,
  run: true },
{ category: 'Transactions', cmd: 'ROLLBACK',
  syntax: `ROLLBACK;`,
  example: `BEGIN;
DELETE FROM order_items WHERE order_id = 1;
SELECT count(*) FROM order_items WHERE order_id = 1;
ROLLBACK;
SELECT count(*) FROM order_items WHERE order_id = 1;`,
  explain: `Undoes everything since BEGIN. After any error inside a transaction, PostgreSQL rejects further commands until you ROLLBACK (or roll back to a savepoint).`,
  run: true },
{ category: 'Transactions', cmd: 'SAVEPOINT / ROLLBACK TO',
  syntax: `SAVEPOINT name;
ROLLBACK TO SAVEPOINT name;
RELEASE SAVEPOINT name;`,
  example: `BEGIN;
UPDATE departments SET budget = budget * 1.10 WHERE name = 'Sales';
SAVEPOINT before_marketing;
UPDATE departments SET budget = 0 WHERE name = 'Marketing';
ROLLBACK TO SAVEPOINT before_marketing;
SELECT name, budget FROM departments WHERE name IN ('Sales', 'Marketing');
COMMIT;`,
  explain: `Partial rollback inside a transaction. Each savepoint is a subtransaction; more than 64 active in one backend overflows the subxid cache and can hurt performance on replicas.`,
  run: true },
{ category: 'Transactions', cmd: 'Isolation levels',
  syntax: `BEGIN ISOLATION LEVEL { READ COMMITTED | REPEATABLE READ | SERIALIZABLE };`,
  example: `BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM orders WHERE status = 'pending';
SELECT current_setting('transaction_isolation');
COMMIT;`,
  explain: `READ COMMITTED (default) takes a new snapshot per statement. REPEATABLE READ and SERIALIZABLE use one snapshot for the whole transaction and can fail with serialization errors that the application must retry.`,
  run: true },
{ category: 'Transactions', cmd: 'SELECT ... FOR UPDATE',
  syntax: `SELECT ... FROM t WHERE ... FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE [ OF t ] [ NOWAIT | SKIP LOCKED ];`,
  example: `SELECT id, stock FROM products WHERE id = 3 FOR UPDATE;
UPDATE products SET stock = stock - 1 WHERE id = 3 RETURNING stock;`,
  explain: `Locks the selected rows until the transaction ends, preventing lost updates in read-modify-write logic. FOR NO KEY UPDATE is lighter and does not block foreign-key checks from child inserts.`,
  run: true },
{ category: 'Transactions', cmd: 'FOR UPDATE SKIP LOCKED (job queue)',
  syntax: `SELECT ... FOR UPDATE SKIP LOCKED LIMIT n;`,
  example: `WITH next_job AS (
  SELECT id FROM orders
  WHERE status = 'pending'
  ORDER BY order_date
  LIMIT 5
  FOR UPDATE SKIP LOCKED
)
UPDATE orders o SET status = 'paid'
FROM next_job WHERE o.id = next_job.id
RETURNING o.id;`,
  explain: `Each worker grabs rows nobody else has locked, so many workers can drain a queue table without blocking each other. Results are intentionally inconsistent; do not use it for reports.`,
  run: true },
{ category: 'Transactions', cmd: 'NOWAIT / lock_timeout',
  syntax: `SET lock_timeout = '2s';
SELECT ... FOR UPDATE NOWAIT;`,
  example: `SET lock_timeout = '3s';
ALTER TABLE customers ADD COLUMN referral_code text;`,
  explain: `Makes a statement give up instead of waiting forever for a lock. Essential for DDL in production: a waiting ALTER TABLE blocks every query queued behind it.`,
  run: true },
{ category: 'Transactions', cmd: 'statement_timeout / idle_in_transaction_session_timeout',
  syntax: `SET statement_timeout = '30s';
SET idle_in_transaction_session_timeout = '60s';`,
  example: `SET statement_timeout = '5s';
SET idle_in_transaction_session_timeout = '2min';
SHOW statement_timeout;`,
  explain: `statement_timeout cancels runaway queries; idle_in_transaction_session_timeout kills sessions that opened a transaction and went quiet (a classic cause of bloat). Set them per role, not globally to aggressive values.`,
  run: true },
{ category: 'Transactions', cmd: 'Advisory locks',
  syntax: `SELECT pg_advisory_xact_lock(key);
SELECT pg_try_advisory_lock(key);  SELECT pg_advisory_unlock(key);`,
  example: `SELECT pg_try_advisory_xact_lock(hashtext('nightly-invoice-job')) AS got_lock;`,
  explain: `Application-defined locks on arbitrary numbers, e.g. "only one instance of this cron job". The xact variant releases at transaction end; session-level ones survive COMMIT and leak if you forget to unlock (watch out with PgBouncer transaction pooling).`,
  run: true },
{ category: 'Transactions', cmd: 'LOCK TABLE',
  syntax: `LOCK TABLE t IN { ACCESS SHARE | ROW EXCLUSIVE | SHARE | EXCLUSIVE | ACCESS EXCLUSIVE } MODE [ NOWAIT ];`,
  example: `LOCK TABLE departments IN SHARE ROW EXCLUSIVE MODE;
UPDATE departments SET budget = budget WHERE id = 1;`,
  explain: `Explicit table lock held until transaction end; only valid inside a transaction. Rarely needed: prefer row locks, and never take ACCESS EXCLUSIVE on a hot table without lock_timeout.`,
  run: true },
{ category: 'Transactions', cmd: 'Read-only transaction',
  syntax: `BEGIN READ ONLY;  |  SET TRANSACTION READ ONLY;`,
  example: `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT status, count(*) FROM orders GROUP BY status;
SELECT sum(amount) FROM payments WHERE status = 'success';
COMMIT;`,
  explain: `Guarantees a report cannot modify data and gives all its queries one consistent snapshot. SERIALIZABLE READ ONLY DEFERRABLE waits for a safe snapshot and then can never fail.`,
  run: true },

/* ============================== Backup ============================== */
{ category: 'Backup', cmd: 'pg_dump (custom format)',
  syntax: `pg_dump -h host -U user -d db -Fc -f file.dump [ -Z level ]`,
  example: `pg_dump -h db1.internal -U backup_reader -d company_db \\
  -Fc -Z 6 -f /backups/company_db_2026-10-05.dump`,
  explain: `Logical, consistent snapshot of one database; custom format (-Fc) is compressed and allows selective, parallel restore. Does not include roles or tablespaces: add pg_dumpall --globals-only.`,
  run: false },
{ category: 'Backup', cmd: 'pg_dump parallel (directory format)',
  syntax: `pg_dump -Fd -j N -f dir db`,
  example: `pg_dump -d company_db -Fd -j 8 -f /backups/company_db_dir`,
  explain: `Directory format is the only one that supports parallel dump (-j). Each worker holds a connection and a long transaction, so watch bloat on busy primaries; dump from a replica if possible.`,
  run: false },
{ category: 'Backup', cmd: 'pg_dump schema-only / data-only / one table',
  syntax: `pg_dump --schema-only | --data-only | -t table | -n schema | -T exclude ...`,
  example: `pg_dump -d company_db --schema-only -f schema.sql
pg_dump -d company_db -t public.orders -t public.order_items -Fc -f orders.dump
pg_dump -d company_db -T 'public.audit_logs' -Fc -f no_audit.dump`,
  explain: `Selective dumps for migrations, code review of DDL, or copying a few tables. A table dump does not pull in the tables it references; restoring it alone can fail on foreign keys.`,
  run: false },
{ category: 'Backup', cmd: 'pg_dumpall --globals-only',
  syntax: `pg_dumpall --globals-only -f globals.sql`,
  example: `pg_dumpall -h db1.internal -U postgres --globals-only -f /backups/globals.sql`,
  explain: `Exports roles, password hashes and tablespaces, which pg_dump never includes. Without it, restoring to a new server fails with "role does not exist" on every GRANT.`,
  run: false },
{ category: 'Backup', cmd: 'pg_basebackup (physical)',
  syntax: `pg_basebackup -h host -U repl_user -D dir -Ft -z -X stream -P [ -c fast ]`,
  example: `pg_basebackup -h db1.internal -U replicator \\
  -D /backups/base_2026-10-05 -Ft -z -X stream -P -c fast --checkpoint=fast`,
  explain: `Binary copy of the whole cluster (all databases), the base for PITR and new replicas. Restores only to the same major version and platform; PG17+ supports incremental backups with --incremental.`,
  run: false },
{ category: 'Backup', cmd: 'WAL archiving',
  syntax: `wal_level = replica
archive_mode = on
archive_command = '...'  |  archive_library = '...'`,
  example: `# postgresql.conf
wal_level = replica
archive_mode = on
archive_timeout = 60
archive_command = 'pgbackrest --stanza=main archive-push %p'`,
  explain: `Ships every completed WAL segment to safe storage, which together with a base backup enables point-in-time recovery. A failing archive_command makes pg_wal grow until the disk fills.`,
  run: false },
{ category: 'Backup', cmd: 'pgBackRest backup',
  syntax: `pgbackrest --stanza=name --type=full|diff|incr backup`,
  example: `pgbackrest --stanza=main stanza-create
pgbackrest --stanza=main --type=full backup
pgbackrest --stanza=main --type=incr backup
pgbackrest --stanza=main info`,
  explain: `pgBackRest is a third-party tool: parallel, compressed, encrypted physical backups with retention and S3/Azure/GCS repositories. The usual production choice alongside Barman.`,
  run: false },
{ category: 'Backup', cmd: 'Check archiver health',
  syntax: `SELECT * FROM pg_stat_archiver;`,
  example: `SELECT archived_count, last_archived_wal, last_archived_time,
       failed_count, last_failed_wal, last_failed_time
FROM pg_stat_archiver;`,
  explain: `If last_failed_time is newer than last_archived_time, archiving is broken right now and your PITR window has stopped growing. Alert on it.`,
  run: true },
{ category: 'Backup', cmd: 'psql \\copy export',
  syntax: `\\copy (query) TO 'file.csv' WITH (FORMAT csv, HEADER)`,
  example: `\\copy (SELECT * FROM customers WHERE country = 'India') TO 'india_customers.csv' WITH (FORMAT csv, HEADER)`,
  explain: `Client-side COPY: the file is written on the machine running psql, no superuser needed. Fine for extracts, but it is not a backup (no schema, no consistency across tables).`,
  run: false },

/* ============================== Restore ============================== */
{ category: 'Restore', cmd: 'pg_restore (parallel)',
  syntax: `pg_restore -d db -j N [ --no-owner ] [ --clean --if-exists ] file.dump`,
  example: `createdb -T template0 company_db_restored
pg_restore -d company_db_restored -j 8 --no-owner --role=app_owner /backups/company_db.dump`,
  explain: `Restores custom or directory format dumps, building indexes in parallel with -j. Restore into an empty database created from template0 to avoid conflicts with objects in template1.`,
  run: false },
{ category: 'Restore', cmd: 'pg_restore --list / -L (selective)',
  syntax: `pg_restore -l file.dump > toc.txt
pg_restore -L toc.txt -d db file.dump`,
  example: `pg_restore -l company_db.dump > toc.txt
# edit toc.txt: comment out lines with ';'
pg_restore -L toc.txt -d company_db_restored company_db.dump`,
  explain: `Lets you restore only chosen objects (or skip some, such as a huge audit table) in dependency order. Only works with custom or directory format, not plain SQL.`,
  run: false },
{ category: 'Restore', cmd: 'Restore one table',
  syntax: `pg_restore -d db -t table [ -n schema ] file.dump`,
  example: `pg_restore -d company_db_restored -n public -t orders --data-only company_db.dump`,
  explain: `Pulls a single table out of a full dump, e.g. after an accidental DELETE. Restore into a scratch database, then copy the needed rows back, instead of overwriting production.`,
  run: false },
{ category: 'Restore', cmd: 'psql -f (plain SQL dump)',
  syntax: `psql -d db -v ON_ERROR_STOP=1 -1 -f dump.sql`,
  example: `psql -d company_db_restored -v ON_ERROR_STOP=1 --single-transaction -f schema.sql`,
  explain: `Plain-format dumps are replayed by psql. ON_ERROR_STOP plus --single-transaction makes the restore all-or-nothing instead of silently continuing past errors.`,
  run: false },
{ category: 'Restore', cmd: 'Point-in-time recovery (PITR)',
  syntax: `restore_command = '...'
recovery_target_time = 'timestamp'
recovery_target_action = 'pause' | 'promote'
touch recovery.signal`,
  example: `# 1. restore base backup into an empty data directory
# 2. postgresql.conf
restore_command = 'pgbackrest --stanza=main archive-get %f "%p"'
recovery_target_time = '2026-10-05 10:41:00+05:30'
recovery_target_action = 'pause'
# 3. create the signal file and start
touch /var/lib/postgresql/18/main/recovery.signal`,
  explain: `Replays WAL on top of a base backup up to just before the incident. Use pause to inspect data before promoting; a wrong target time can be retried only if you have not promoted yet.`,
  run: false },
{ category: 'Restore', cmd: 'pgBackRest restore',
  syntax: `pgbackrest --stanza=name [ --delta ] [ --type=time --target='ts' ] restore`,
  example: `pgbackrest --stanza=main --delta \\
  --type=time --target='2026-10-05 10:41:00+05:30' \\
  --target-action=promote restore`,
  explain: `Third-party tool that writes the recovery configuration for you; --delta only replaces changed files, making large restores much faster.`,
  run: false },
{ category: 'Restore', cmd: 'pg_restore --clean --if-exists',
  syntax: `pg_restore -d db --clean --if-exists file.dump`,
  example: `pg_restore -d company_staging --clean --if-exists --no-owner -j 4 company_db.dump`,
  explain: `Drops each object before recreating it, for refreshing staging from production. Objects that exist only in the target are left behind; recreate the database for a truly clean copy.`,
  run: false },
{ category: 'Restore', cmd: 'Post-restore ANALYZE',
  syntax: `ANALYZE;  |  vacuumdb --analyze-in-stages`,
  example: `ANALYZE orders;
ANALYZE order_items;
SELECT relname, last_analyze FROM pg_stat_user_tables WHERE relname IN ('orders', 'order_items');`,
  explain: `Restores and pg_upgrade do not carry planner statistics (pg_upgrade keeps them from PG18), so plans are terrible until ANALYZE runs. vacuumdb --analyze-in-stages gets usable stats fastest.`,
  run: true },

/* ============================== Replication ============================== */
{ category: 'Replication', cmd: 'Primary settings',
  syntax: `wal_level = replica | logical
max_wal_senders = n
max_replication_slots = n
wal_keep_size = size`,
  example: `# postgresql.conf on the primary
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
wal_keep_size = '2GB'
hot_standby = on`,
  explain: `Minimum configuration for streaming replication; wal_level and max_wal_senders need a restart. Use logical if you will also run logical replication or CDC.`,
  run: false },
{ category: 'Replication', cmd: 'Replication user + pg_hba.conf',
  syntax: `CREATE ROLE name WITH REPLICATION LOGIN PASSWORD '...';
host replication name cidr scram-sha-256`,
  example: `CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'Repl-Strong-Pass';
# pg_hba.conf
host  replication  replicator  10.0.2.0/24  scram-sha-256`,
  explain: `Replication connections match the special database name "replication" in pg_hba.conf. Use a dedicated role; REPLICATION can read every byte of the cluster.`,
  run: false },
{ category: 'Replication', cmd: 'Create a standby (pg_basebackup -R)',
  syntax: `pg_basebackup -h primary -U replicator -D datadir -X stream -R -S slot -C`,
  example: `pg_basebackup -h db1.internal -U replicator \\
  -D /var/lib/postgresql/18/main -X stream -R -C -S standby1 -P`,
  explain: `Clones the primary and with -R writes primary_conninfo plus standby.signal, so the server starts as a streaming replica. -C -S creates and uses a replication slot.`,
  run: false },
{ category: 'Replication', cmd: 'Replication slots',
  syntax: `SELECT pg_create_physical_replication_slot('name');
SELECT pg_drop_replication_slot('name');`,
  example: `SELECT slot_name, slot_type, active, wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;`,
  explain: `Slots guarantee WAL is kept until the consumer has it, and an abandoned slot retains WAL forever and fills the disk. Cap it with max_slot_wal_keep_size and alert on inactive slots.`,
  run: false },
{ category: 'Replication', cmd: 'pg_stat_replication (lag)',
  syntax: `SELECT * FROM pg_stat_replication;`,
  example: `SELECT application_name, client_addr, state, sync_state,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS replay_lag_bytes,
       write_lag, flush_lag, replay_lag
FROM pg_stat_replication;`,
  explain: `Run on the primary: one row per connected standby. Byte lag shows how far behind; replay_lag shows time. Empty result means no standby is connected.`,
  run: true },
{ category: 'Replication', cmd: 'pg_is_in_recovery() / replica lag',
  syntax: `SELECT pg_is_in_recovery();
SELECT now() - pg_last_xact_replay_timestamp();`,
  example: `SELECT pg_is_in_recovery() AS is_standby,
       CASE WHEN pg_is_in_recovery()
            THEN now() - pg_last_xact_replay_timestamp() END AS replay_delay;`,
  explain: `Tells you whether this node is a replica. Replay delay looks large on an idle primary even when the replica is fully caught up, because no new transactions arrive.`,
  run: true },
{ category: 'Replication', cmd: 'Promote a standby',
  syntax: `SELECT pg_promote(wait => true, wait_seconds => 60);  |  pg_ctl promote`,
  example: `SELECT pg_promote(true, 60);`,
  explain: `Ends recovery and makes the standby a writable primary on a new timeline. Fence the old primary first to avoid split brain; in clusters let Patroni do it.`,
  run: false },
{ category: 'Replication', cmd: 'Synchronous replication',
  syntax: `synchronous_standby_names = 'FIRST n (s1, s2)' | 'ANY n (s1, s2)'
synchronous_commit = on | remote_apply | remote_write | local | off`,
  example: `# postgresql.conf on the primary
synchronous_standby_names = 'ANY 1 (standby_a, standby_b)'
synchronous_commit = on`,
  explain: `COMMIT waits until at least one named standby has flushed the WAL: zero data loss on failover, at the cost of a network round-trip per commit. If no sync standby is up, writes hang.`,
  run: false },
{ category: 'Replication', cmd: 'Logical replication: PUBLICATION',
  syntax: `CREATE PUBLICATION name FOR TABLE t1, t2 | FOR TABLES IN SCHEMA s | FOR ALL TABLES;`,
  example: `CREATE PUBLICATION pub_commerce FOR TABLE orders, order_items, payments;`,
  explain: `Defines which tables a publisher streams row changes for (needs wal_level = logical). Tables need a primary key or REPLICA IDENTITY for UPDATE/DELETE to replicate. DDL is not replicated.`,
  run: false },
{ category: 'Replication', cmd: 'Logical replication: SUBSCRIPTION',
  syntax: `CREATE SUBSCRIPTION name CONNECTION 'conninfo' PUBLICATION pub [ WITH (copy_data = true) ];`,
  example: `CREATE SUBSCRIPTION sub_commerce
  CONNECTION 'host=db1.internal dbname=company_db user=replicator password=...'
  PUBLICATION pub_commerce
  WITH (copy_data = true);`,
  explain: `Creates the tables' initial copy and then applies changes continuously. Target tables must already exist; ideal for major-version upgrades and zero-downtime migrations. Sequences are not replicated.`,
  run: false },

/* ============================== Monitoring ============================== */
{ category: 'Monitoring', cmd: 'Active queries (pg_stat_activity)',
  syntax: `SELECT pid, state, query FROM pg_stat_activity WHERE state <> 'idle';`,
  example: `SELECT pid, usename, application_name, state, wait_event_type, wait_event,
       now() - query_start AS running_for, left(query, 80) AS query
FROM pg_stat_activity
WHERE state <> 'idle' AND pid <> pg_backend_pid()
ORDER BY running_for DESC NULLS LAST;`,
  explain: `The first thing to look at in any incident. wait_event tells you whether a query is blocked on a lock, IO or the client.`,
  run: true },
{ category: 'Monitoring', cmd: 'Long-running / idle-in-transaction',
  syntax: `SELECT ... FROM pg_stat_activity WHERE xact_start < now() - interval '...';`,
  example: `SELECT pid, usename, state, now() - xact_start AS xact_age, left(query, 60) AS last_query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start
LIMIT 10;`,
  explain: `Old transactions hold back VACUUM (bloat) and keep locks. "idle in transaction" sessions are usually application bugs: a missing COMMIT or a slow external call inside a transaction.`,
  run: true },
{ category: 'Monitoring', cmd: 'Who is blocking whom',
  syntax: `SELECT pid, pg_blocking_pids(pid) FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;`,
  example: `SELECT blocked.pid AS blocked_pid, left(blocked.query, 50) AS blocked_query,
       blocking.pid AS blocking_pid, left(blocking.query, 50) AS blocking_query,
       blocking.state AS blocking_state
FROM pg_stat_activity blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
JOIN pg_stat_activity blocking ON blocking.pid = b.pid;`,
  explain: `Builds the lock wait chain. The root blocker is often an idle-in-transaction session or an ALTER TABLE waiting in the queue.`,
  run: true },
{ category: 'Monitoring', cmd: 'pg_locks',
  syntax: `SELECT locktype, relation::regclass, mode, granted, pid FROM pg_locks;`,
  example: `SELECT l.pid, l.locktype, l.relation::regclass AS relation, l.mode, l.granted
FROM pg_locks l
WHERE l.relation IS NOT NULL
ORDER BY l.granted, l.pid;`,
  explain: `Lists every lock held or awaited. granted = false rows are waiting; join with pg_stat_activity to see the queries.`,
  run: true },
{ category: 'Monitoring', cmd: 'pg_cancel_backend / pg_terminate_backend',
  syntax: `SELECT pg_cancel_backend(pid);
SELECT pg_terminate_backend(pid [, timeout_ms ]);`,
  example: `SELECT pid, pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '30 minutes';`,
  explain: `Cancel stops the current query; terminate closes the whole connection and rolls back its transaction. Needs superuser, same role, or pg_signal_backend.`,
  run: false },
{ category: 'Monitoring', cmd: 'Table and index sizes',
  syntax: `SELECT pg_size_pretty(pg_total_relation_size('t'));`,
  example: `SELECT relname AS table_name,
       pg_size_pretty(pg_total_relation_size(relid)) AS total,
       pg_size_pretty(pg_relation_size(relid)) AS heap,
       pg_size_pretty(pg_indexes_size(relid)) AS indexes
FROM pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;`,
  explain: `pg_total_relation_size includes indexes and TOAST. Tracking these daily gives you growth rates for capacity planning.`,
  run: true },
{ category: 'Monitoring', cmd: 'Cache hit ratio',
  syntax: `SELECT blks_hit::float / nullif(blks_hit + blks_read, 0) FROM pg_stat_database;`,
  example: `SELECT datname,
       round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
       xact_commit, xact_rollback, deadlocks, temp_files
FROM pg_stat_database
WHERE datname = current_database();`,
  explain: `Below ~99% on an OLTP system suggests the working set does not fit in shared_buffers. "Read" may still come from the OS page cache, so it overstates real disk IO.`,
  run: true },
{ category: 'Monitoring', cmd: 'Dead tuples & last vacuum',
  syntax: `SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables;`,
  example: `SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;`,
  explain: `High dead_pct with an old last_autovacuum means autovacuum is falling behind or blocked by a long transaction.`,
  run: true },
{ category: 'Monitoring', cmd: 'Seq scans vs index scans',
  syntax: `SELECT relname, seq_scan, idx_scan FROM pg_stat_user_tables;`,
  example: `SELECT relname, seq_scan, seq_tup_read, idx_scan,
       seq_tup_read / nullif(seq_scan, 0) AS avg_rows_per_seq_scan
FROM pg_stat_user_tables
ORDER BY seq_tup_read DESC
LIMIT 10;`,
  explain: `Large tables with many sequential scans reading many rows each are missing an index. Small tables are scanned sequentially by design.`,
  run: true },
{ category: 'Monitoring', cmd: 'pg_stat_statements (top queries)',
  syntax: `shared_preload_libraries = 'pg_stat_statements'
CREATE EXTENSION pg_stat_statements;`,
  example: `SELECT queryid, calls,
       round(total_exec_time::numeric, 0) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       rows, left(query, 80) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;`,
  explain: `Extension (contrib) that aggregates statistics per normalized query. Sort by total_exec_time to find what costs the server most, not just the slowest single query. Requires a restart to load.`,
  run: false },
{ category: 'Monitoring', cmd: 'VACUUM progress',
  syntax: `SELECT * FROM pg_stat_progress_vacuum;`,
  example: `SELECT p.pid, p.relid::regclass AS table_name, p.phase,
       p.heap_blks_scanned, p.heap_blks_total,
       round(100.0 * p.heap_blks_scanned / nullif(p.heap_blks_total, 0), 1) AS pct
FROM pg_stat_progress_vacuum p;`,
  explain: `Shows running VACUUMs and their phase. Sibling views exist for CREATE INDEX, CLUSTER, ANALYZE, COPY and pg_basebackup.`,
  run: true },
{ category: 'Monitoring', cmd: 'pg_stat_io',
  syntax: `SELECT * FROM pg_stat_io;`,
  example: `SELECT backend_type, object, context, reads, writes, extends, hits, evictions
FROM pg_stat_io
WHERE reads > 0 OR writes > 0
ORDER BY reads + writes DESC
LIMIT 10;`,
  explain: `PG16+ breakdown of IO by process type and context. High writes from client backends means bgwriter/checkpointer are not keeping up and queries are doing their own evictions.`,
  run: true },
{ category: 'Monitoring', cmd: 'Checkpoint statistics',
  syntax: `SELECT * FROM pg_stat_checkpointer;`,
  example: `SELECT num_timed, num_requested, write_time, sync_time, buffers_written
FROM pg_stat_checkpointer;`,
  explain: `PG17+ (older versions: pg_stat_bgwriter). Many requested versus timed checkpoints means max_wal_size is too small, causing write spikes and extra full-page writes.`,
  run: true },
{ category: 'Monitoring', cmd: 'Table XID age (freeze)',
  syntax: `SELECT relname, age(relfrozenxid) FROM pg_class WHERE relkind = 'r';`,
  example: `SELECT c.oid::regclass AS table_name, age(c.relfrozenxid) AS xid_age,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
WHERE c.relkind IN ('r', 'm', 't')
ORDER BY age(c.relfrozenxid) DESC
LIMIT 10;`,
  explain: `Finds the tables driving wraparound risk. Big, old tables need a manual VACUUM (FREEZE) in quiet hours before an emergency anti-wraparound vacuum starts on its own.`,
  run: true },

/* ============================== Extensions ============================== */
{ category: 'Extensions', cmd: 'CREATE EXTENSION',
  syntax: `CREATE EXTENSION [ IF NOT EXISTS ] name [ SCHEMA s ] [ VERSION v ] [ CASCADE ];`,
  example: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT similarity('PostgreSQL', 'Postgres') AS sim;`,
  explain: `Installs packaged SQL objects into the current database only. The extension files must exist on the server; most need superuser or a "trusted" flag.`,
  run: true },
{ category: 'Extensions', cmd: 'List installed / available',
  syntax: `SELECT * FROM pg_extension;
SELECT * FROM pg_available_extensions;`,
  example: `SELECT name, default_version, installed_version
FROM pg_available_extensions
ORDER BY installed_version IS NULL, name
LIMIT 20;`,
  explain: `installed_version NULL means available on disk but not created in this database. psql \\dx lists installed ones.`,
  run: true },
{ category: 'Extensions', cmd: 'ALTER EXTENSION UPDATE',
  syntax: `ALTER EXTENSION name UPDATE [ TO version ];`,
  example: `ALTER EXTENSION vector UPDATE;
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';`,
  explain: `After upgrading extension packages on the server, the SQL objects stay on the old version until you run this in every database. Read the extension's release notes first.`,
  run: false },
{ category: 'Extensions', cmd: 'DROP EXTENSION',
  syntax: `DROP EXTENSION [ IF EXISTS ] name [ CASCADE ];`,
  example: `CREATE EXTENSION IF NOT EXISTS hstore;
DROP EXTENSION hstore;`,
  explain: `CASCADE also drops columns, indexes and functions using the extension's types. Check pg_depend before running it in production.`,
  run: true },
{ category: 'Extensions', cmd: 'pgcrypto',
  syntax: `CREATE EXTENSION pgcrypto;
crypt(pw, gen_salt('bf'))  |  digest(data, 'sha256')`,
  example: `CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT crypt('s3cret', gen_salt('bf', 10)) AS bcrypt_hash,
       encode(digest('hello', 'sha256'), 'hex') AS sha256;`,
  explain: `Extension (contrib) for hashing and encryption inside SQL. gen_random_uuid() is core since PG13, so pgcrypto is no longer needed for UUIDs; hashing passwords in the app is usually preferable.`,
  run: true },
{ category: 'Extensions', cmd: 'citext',
  syntax: `CREATE EXTENSION citext;
col citext UNIQUE`,
  example: `CREATE EXTENSION IF NOT EXISTS citext;
CREATE TABLE newsletter (email citext PRIMARY KEY);
INSERT INTO newsletter VALUES ('Asha@Example.com');
SELECT * FROM newsletter WHERE email = 'asha@example.COM';`,
  explain: `Extension providing case-insensitive text. A unique index on lower(email) or a nondeterministic ICU collation are core alternatives.`,
  run: true },
{ category: 'Extensions', cmd: 'pgvector',
  syntax: `CREATE EXTENSION vector;
col vector(dims);  ORDER BY col <=> query_vec LIMIT k`,
  example: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE doc_embeddings (doc_id int PRIMARY KEY, embedding vector(3));
INSERT INTO doc_embeddings VALUES (1, '[1,0,0]'), (2, '[0.9,0.1,0]'), (3, '[0,1,0]');
CREATE INDEX ON doc_embeddings USING hnsw (embedding vector_cosine_ops);
SELECT doc_id, embedding <=> '[1,0,0]' AS cosine_distance
FROM doc_embeddings ORDER BY embedding <=> '[1,0,0]' LIMIT 2;`,
  explain: `pgvector is an extension, not core: vector type, distance operators and HNSW/IVFFlat approximate indexes for semantic search. Approximate indexes trade recall for speed.`,
  run: true },
{ category: 'Extensions', cmd: 'uuid-ossp / gen_random_uuid',
  syntax: `gen_random_uuid()  (core)  |  uuidv7()  (core, PG18)  |  uuid_generate_v4()  (uuid-ossp)`,
  example: `SELECT gen_random_uuid() AS v4, uuidv7() AS v7;`,
  explain: `Core has gen_random_uuid() (PG13+) and time-ordered uuidv7() (PG18), so uuid-ossp is rarely needed now. v7 inserts are B-tree friendly because they arrive in order.`,
  run: true },

/* ============================== Partitioning ============================== */
{ category: 'Partitioning', cmd: 'PARTITION BY RANGE',
  syntax: `CREATE TABLE t (...) PARTITION BY RANGE (col);
CREATE TABLE t_p PARTITION OF t FOR VALUES FROM (a) TO (b);`,
  example: `CREATE TABLE orders_p (
  id bigint, customer_id int, status text,
  order_date timestamptz NOT NULL, total_amount numeric,
  PRIMARY KEY (id, order_date)
) PARTITION BY RANGE (order_date);
CREATE TABLE orders_p_2024 PARTITION OF orders_p FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE orders_p_2025 PARTITION OF orders_p FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
INSERT INTO orders_p SELECT id, customer_id, status, order_date, total_amount FROM orders;
SELECT tableoid::regclass AS partition, count(*) FROM orders_p GROUP BY 1;`,
  explain: `Native declarative partitioning (core). Upper bound is exclusive. Primary keys and unique indexes must include the partition key.`,
  run: true },
{ category: 'Partitioning', cmd: 'DEFAULT partition',
  syntax: `CREATE TABLE t_default PARTITION OF t DEFAULT;`,
  example: `CREATE TABLE events_p (id bigint, created_at date NOT NULL) PARTITION BY RANGE (created_at);
CREATE TABLE events_p_2025 PARTITION OF events_p FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE events_p_default PARTITION OF events_p DEFAULT;
INSERT INTO events_p VALUES (1, '2030-05-01');
SELECT tableoid::regclass, * FROM events_p;`,
  explain: `Catches rows matching no partition instead of raising an error. Adding a new partition later must scan the default for conflicting rows, so keep it empty and alert if it is not.`,
  run: true },
{ category: 'Partitioning', cmd: 'PARTITION BY LIST',
  syntax: `CREATE TABLE t (...) PARTITION BY LIST (col);
CREATE TABLE t_x PARTITION OF t FOR VALUES IN ('a', 'b');`,
  example: `CREATE TABLE customers_p (id int, name text, country text NOT NULL) PARTITION BY LIST (country);
CREATE TABLE customers_p_in PARTITION OF customers_p FOR VALUES IN ('India');
CREATE TABLE customers_p_west PARTITION OF customers_p FOR VALUES IN ('USA', 'UK', 'Germany');
CREATE TABLE customers_p_other PARTITION OF customers_p DEFAULT;
INSERT INTO customers_p SELECT id, name, country FROM customers;
SELECT tableoid::regclass, count(*) FROM customers_p GROUP BY 1;`,
  explain: `Splits by discrete values: region, tenant tier. Useful for data residency or moving one region to separate storage.`,
  run: true },
{ category: 'Partitioning', cmd: 'PARTITION BY HASH',
  syntax: `CREATE TABLE t_pN PARTITION OF t FOR VALUES WITH (MODULUS m, REMAINDER r);`,
  example: `CREATE TABLE sessions_p (id bigint, user_id int NOT NULL) PARTITION BY HASH (user_id);
CREATE TABLE sessions_p0 PARTITION OF sessions_p FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE sessions_p1 PARTITION OF sessions_p FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE sessions_p2 PARTITION OF sessions_p FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE sessions_p3 PARTITION OF sessions_p FOR VALUES WITH (MODULUS 4, REMAINDER 3);
INSERT INTO sessions_p SELECT g, g % 60 FROM generate_series(1, 1000) g;
SELECT tableoid::regclass, count(*) FROM sessions_p GROUP BY 1 ORDER BY 1;`,
  explain: `Spreads rows evenly when there is no natural range, to keep each partition's indexes and vacuum small. Gives no pruning for range queries and cannot drop old data cheaply.`,
  run: true },
{ category: 'Partitioning', cmd: 'ATTACH PARTITION',
  syntax: `ALTER TABLE parent ATTACH PARTITION child FOR VALUES ...;`,
  example: `CREATE TABLE logs_p (id int, logged_on date NOT NULL) PARTITION BY RANGE (logged_on);
CREATE TABLE logs_2026_10 (id int, logged_on date NOT NULL);
INSERT INTO logs_2026_10 VALUES (1, '2026-10-05');
ALTER TABLE logs_2026_10 ADD CONSTRAINT logs_2026_10_chk
  CHECK (logged_on >= '2026-10-01' AND logged_on < '2026-11-01');
ALTER TABLE logs_p ATTACH PARTITION logs_2026_10 FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');`,
  explain: `Loads data into a standalone table first, then attaches it in moments. A matching CHECK constraint lets PostgreSQL skip the validation scan; ATTACH takes only SHARE UPDATE EXCLUSIVE on the parent.`,
  run: true },
{ category: 'Partitioning', cmd: 'DETACH PARTITION (CONCURRENTLY)',
  syntax: `ALTER TABLE parent DETACH PARTITION child [ CONCURRENTLY | FINALIZE ];`,
  example: `ALTER TABLE orders_p DETACH PARTITION orders_p_2024 CONCURRENTLY;
DROP TABLE orders_p_2024;  -- or archive it first`,
  explain: `Removes a partition from the parent so old data can be dropped instantly with no VACUUM. CONCURRENTLY (PG14+) avoids blocking queries but cannot run in a transaction block or with a default partition.`,
  run: false },
{ category: 'Partitioning', cmd: 'Index on partitioned table',
  syntax: `CREATE INDEX name ON parent (cols);`,
  example: `CREATE TABLE metrics_p (ts timestamptz NOT NULL, device_id int, val numeric) PARTITION BY RANGE (ts);
CREATE TABLE metrics_p_2025 PARTITION OF metrics_p FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE INDEX idx_metrics_device ON metrics_p (device_id, ts);
SELECT indexrelid::regclass FROM pg_index WHERE indrelid = 'metrics_p_2025'::regclass;`,
  explain: `Creating an index on the parent cascades to every existing and future partition. CONCURRENTLY is not allowed on the parent: build on each partition concurrently, then create the parent index ON ONLY and ATTACH.`,
  run: true },
{ category: 'Partitioning', cmd: 'Partition pruning',
  syntax: `EXPLAIN SELECT ... WHERE partition_key ...;`,
  example: `CREATE TABLE sales_p (id int, sold_on date NOT NULL) PARTITION BY RANGE (sold_on);
CREATE TABLE sales_p_h1 PARTITION OF sales_p FOR VALUES FROM ('2025-01-01') TO ('2025-07-01');
CREATE TABLE sales_p_h2 PARTITION OF sales_p FOR VALUES FROM ('2025-07-01') TO ('2026-01-01');
EXPLAIN SELECT * FROM sales_p WHERE sold_on >= '2025-08-01';`,
  explain: `The plan should mention only matching partitions. Pruning fails when the key is wrapped in a function or cast (e.g. date_trunc(sold_on) = ...), so filter on the raw column.`,
  run: true },
{ category: 'Partitioning', cmd: 'List partitions',
  syntax: `SELECT * FROM pg_partition_tree('parent');`,
  example: `CREATE TABLE audit_p (id bigint, at date NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE audit_p_2025 PARTITION OF audit_p FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
SELECT relid, parentrelid, isleaf, level,
       pg_get_expr(c.relpartbound, c.oid) AS bounds
FROM pg_partition_tree('audit_p') t
JOIN pg_class c ON c.oid = t.relid;`,
  explain: `Shows the hierarchy with bounds. psql \\d+ parent lists partitions too. Automate creating future partitions (pg_partman extension or a scheduled job) so inserts never fail.`,
  run: true },

/* ============================== Performance ============================== */
{ category: 'Performance', cmd: 'EXPLAIN',
  syntax: `EXPLAIN [ (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT json) ] query;`,
  example: `EXPLAIN SELECT c.name, count(*)
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'India'
GROUP BY c.name;`,
  explain: `Shows the plan the optimizer chose with estimated costs and rows, without executing the query. Read the tree from the innermost node outward.`,
  run: true },
{ category: 'Performance', cmd: 'EXPLAIN (ANALYZE, BUFFERS)',
  syntax: `EXPLAIN (ANALYZE, BUFFERS) query;`,
  example: `EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders WHERE customer_id = 42 ORDER BY order_date DESC LIMIT 10;`,
  explain: `Actually runs the query and shows real timings, row counts and buffer hits/reads (BUFFERS is on by default in PG18). Wrap DML in BEGIN ... ROLLBACK because it really executes.`,
  run: true },
{ category: 'Performance', cmd: 'ANALYZE',
  syntax: `ANALYZE [ VERBOSE ] [ table [ (cols) ] ];`,
  example: `ANALYZE orders;
SELECT attname, n_distinct, most_common_vals
FROM pg_stats WHERE tablename = 'orders' AND attname = 'status';`,
  explain: `Refreshes planner statistics by sampling rows. Run it after bulk loads; stale statistics are the most common cause of sudden bad plans.`,
  run: true },
{ category: 'Performance', cmd: 'VACUUM (ANALYZE)',
  syntax: `VACUUM [ (VERBOSE, ANALYZE, FREEZE, PARALLEL n, INDEX_CLEANUP auto) ] [ table ];`,
  example: `VACUUM (VERBOSE, ANALYZE) order_items;`,
  explain: `Marks dead tuple space reusable, updates the visibility map (enabling index-only scans) and freezes old XIDs. Does not shrink the file or block reads/writes; cannot run inside a transaction.`,
  run: true },
{ category: 'Performance', cmd: 'VACUUM FULL',
  syntax: `VACUUM FULL [ table ];`,
  example: `VACUUM FULL audit_logs;`,
  explain: `Rewrites the table compactly and returns space to the OS, but holds an ACCESS EXCLUSIVE lock for the whole run and needs room for a full copy. Use pg_repack (extension/tool) for online compaction.`,
  run: true },
{ category: 'Performance', cmd: 'SET work_mem (per session)',
  syntax: `SET work_mem = '64MB';  |  SET LOCAL work_mem = '...';`,
  example: `SET LOCAL work_mem = '128MB';
EXPLAIN (ANALYZE)
SELECT customer_id, sum(total_amount) FROM orders GROUP BY customer_id ORDER BY 2 DESC;`,
  explain: `Memory per sort/hash operation, not per query: one query can use many multiples of it, times parallel workers. Raise it for specific heavy reports, not globally.`,
  run: true },
{ category: 'Performance', cmd: 'CREATE STATISTICS (extended)',
  syntax: `CREATE STATISTICS name (dependencies, ndistinct, mcv) ON col1, col2 FROM t;`,
  example: `CREATE STATISTICS st_customers_country_city (dependencies, mcv) ON country, city FROM customers;
ANALYZE customers;
EXPLAIN SELECT * FROM customers WHERE country = 'India' AND city = 'Mumbai';`,
  explain: `Teaches the planner that columns are correlated (city implies country), fixing badly underestimated row counts for multi-column filters.`,
  run: true },
{ category: 'Performance', cmd: 'ALTER COLUMN SET STATISTICS',
  syntax: `ALTER TABLE t ALTER COLUMN col SET STATISTICS n;  -- 1..10000, default 100`,
  example: `ALTER TABLE orders ALTER COLUMN customer_id SET STATISTICS 1000;
ANALYZE orders;`,
  explain: `Larger sample and more most-common-values for skewed columns. Makes ANALYZE slower and planning slightly costlier; raise only where estimates are wrong.`,
  run: true },
{ category: 'Performance', cmd: 'Per-table autovacuum settings',
  syntax: `ALTER TABLE t SET (autovacuum_vacuum_scale_factor = x, autovacuum_vacuum_threshold = n, ...);`,
  example: `ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 2000
);
SELECT reloptions FROM pg_class WHERE relname = 'orders';`,
  explain: `The default 20% scale factor means a 500M-row table waits for 100M dead rows. Lower it for large, hot tables.`,
  run: true },
{ category: 'Performance', cmd: 'CLUSTER',
  syntax: `CLUSTER table USING index;`,
  example: `CREATE INDEX idx_orders_date ON orders (order_date);
CLUSTER orders USING idx_orders_date;`,
  explain: `Physically reorders the table by an index once, improving range scans and BRIN effectiveness. ACCESS EXCLUSIVE lock for the whole rewrite, and the order is not maintained for new rows.`,
  run: true },
{ category: 'Performance', cmd: 'Planner cost settings',
  syntax: `SET random_page_cost = 1.1;  SET effective_cache_size = '24GB';`,
  example: `SET random_page_cost = 1.1;
SET effective_cache_size = '8GB';
EXPLAIN SELECT * FROM orders WHERE customer_id BETWEEN 1 AND 20;`,
  explain: `The default random_page_cost = 4 assumes spinning disks; on SSD/NVMe use about 1.1 so index scans are costed realistically. effective_cache_size is only a planner hint, it allocates nothing.`,
  run: true },
{ category: 'Performance', cmd: 'ALTER SYSTEM / pg_reload_conf',
  syntax: `ALTER SYSTEM SET param = value;
SELECT pg_reload_conf();`,
  example: `ALTER SYSTEM SET shared_buffers = '8GB';          -- needs restart
ALTER SYSTEM SET log_min_duration_statement = '500ms';  -- reload is enough
SELECT pg_reload_conf();
SELECT name, setting, pending_restart FROM pg_settings WHERE pending_restart;`,
  explain: `Writes postgresql.auto.conf, which overrides postgresql.conf. Check the context column in pg_settings: postmaster parameters need a restart, sighup ones a reload.`,
  run: false },
{ category: 'Performance', cmd: 'Inspect a setting',
  syntax: `SELECT name, setting, unit, context, source FROM pg_settings WHERE name = '...';`,
  example: `SELECT name, setting, unit, context, source
FROM pg_settings
WHERE name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem',
               'effective_cache_size', 'random_page_cost', 'max_connections');`,
  explain: `Shows each value, its unit (shared_buffers is in 8kB pages) and where it came from, which explains "why didn't my change apply?".`,
  run: true },

/* ============================== psql ============================== */
{ category: 'psql', cmd: 'Connect',
  syntax: `psql "postgresql://user@host:5432/db?sslmode=require"
psql -h host -p 5432 -U user -d db`,
  example: `psql "postgresql://app_user@db1.internal:5432/company_db?sslmode=verify-full"`,
  explain: `Use URIs or ~/.pg_service.conf, and keep passwords in ~/.pgpass (chmod 600), never on the command line where ps can see them.`,
  run: false },
{ category: 'psql', cmd: '\\l / \\c',
  syntax: `\\l[+]
\\c[onnect] dbname [ user ] [ host ] [ port ]`,
  example: `\\l+
\\c company_db app_user`,
  explain: `List databases with sizes; switch connection without leaving psql. \\conninfo shows where you are connected.`,
  run: false },
{ category: 'psql', cmd: '\\dt / \\d+ table',
  syntax: `\\dt [ pattern ]
\\d[+] name`,
  example: `\\dt public.*
\\d+ orders`,
  explain: `\\d+ shows columns, defaults, indexes, constraints, triggers, referencing FKs, storage and comments in one place: the fastest way to understand a table.`,
  run: false },
{ category: 'psql', cmd: '\\di / \\df / \\dv / \\dn / \\du / \\dx',
  syntax: `\\di[+]  \\df[+]  \\dv  \\dm  \\dn[+]  \\du  \\dx  \\dp`,
  example: `\\di+ idx_*
\\df public.*
\\dp orders`,
  explain: `Indexes, functions, views, materialized views, schemas, roles, extensions, and privileges (\\dp). Add + for sizes and details; S includes system objects.`,
  run: false },
{ category: 'psql', cmd: '\\x auto',
  syntax: `\\x [ on | off | auto ]`,
  example: `\\x auto
SELECT * FROM pg_stat_activity WHERE pid = pg_backend_pid();`,
  explain: `Expanded display prints one column per line, making wide rows readable. auto switches only when the output would not fit the terminal.`,
  run: false },
{ category: 'psql', cmd: '\\timing',
  syntax: `\\timing [ on | off ]`,
  example: `\\timing on
SELECT count(*) FROM order_items;`,
  explain: `Prints client-side elapsed time, including network round trip, for each statement. Use EXPLAIN ANALYZE for server-side timing.`,
  run: false },
{ category: 'psql', cmd: '\\set ON_ERROR_STOP / variables',
  syntax: `\\set ON_ERROR_STOP on
\\set name value   ...  :name  :'name'`,
  example: `\\set ON_ERROR_STOP on
\\set cust_id 42
SELECT * FROM orders WHERE customer_id = :cust_id;`,
  explain: `ON_ERROR_STOP makes scripts abort on the first error (always set it for migrations). :'var' interpolates as a properly quoted literal.`,
  run: false },
{ category: 'psql', cmd: '\\i / \\ir (run a file)',
  syntax: `\\i file.sql
\\ir relative/file.sql`,
  example: `\\set ON_ERROR_STOP on
\\i migrations/2026_10_05_add_invoices.sql`,
  explain: `Executes a script from inside psql. \\ir resolves paths relative to the current script, which is useful for scripts that include other scripts.`,
  run: false },
{ category: 'psql', cmd: '\\copy',
  syntax: `\\copy table [ (cols) ] FROM | TO 'file' WITH (FORMAT csv, HEADER)`,
  example: `\\copy customers (name, email, country, city, segment) FROM 'new_customers.csv' WITH (FORMAT csv, HEADER)`,
  explain: `Runs COPY ... FROM STDIN and streams a client-side file: no server filesystem access or superuser needed. Must be written on one line.`,
  run: false },
{ category: 'psql', cmd: '\\watch',
  syntax: `query \\watch [ interval ]`,
  example: `SELECT count(*) FILTER (WHERE state = 'active') AS active,
       count(*) FILTER (WHERE state = 'idle in transaction') AS idle_tx
FROM pg_stat_activity \\watch 5`,
  explain: `Re-runs the query every N seconds: a live mini-dashboard during incidents or long migrations.`,
  run: false },
{ category: 'psql', cmd: '\\gexec',
  syntax: `SELECT format('...') FROM ... \\gexec`,
  example: `SELECT format('ANALYZE %I.%I', schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' \\gexec`,
  explain: `Executes each result cell as a statement: generate DDL with SQL and run it immediately. Use format() with %I so identifiers are quoted safely.`,
  run: false },
{ category: 'psql', cmd: '\\e / \\ef / \\sf / \\sv',
  syntax: `\\e  \\ef function  \\sf[+] function  \\sv[+] view`,
  example: `\\sf+ dept_headcount
\\sv v_department_summary`,
  explain: `Show the source of a function or view (+ adds line numbers), or open it in $EDITOR. Handy for reading trigger functions during debugging.`,
  run: false },
{ category: 'psql', cmd: '\\conninfo / \\password',
  syntax: `\\conninfo
\\password [ role ]`,
  example: `\\conninfo
\\password report_app`,
  explain: `\\password prompts twice and sends only the SCRAM hash to the server, so the clear-text password never appears in logs or history.`,
  run: false },
];

/* --------------------------- TROUBLESHOOTING --------------------------- */
PGM.TROUBLESHOOTING = [
{ id: 'connection-refused', title: 'Database connection refused', severity: 'critical',
  symptoms: [
    'Clients fail with <code>could not connect to server: Connection refused</code> or <code>Is the server running on host ... and accepting TCP/IP connections on port 5432?</code>',
    'psql works locally over the Unix socket but remote apps cannot connect',
    'Errors like <code>no pg_hba.conf entry for host</code> or <code>password authentication failed</code> (server reachable but rejecting)'
  ],
  causes: [
    'PostgreSQL is not running (crashed, failed to start after a config change, disk full on startup)',
    '<code>listen_addresses</code> is <code>localhost</code> (the default), so the server ignores remote interfaces',
    'Wrong port, or a firewall / security group / Kubernetes NetworkPolicy blocks 5432',
    'No matching <code>pg_hba.conf</code> line for the client address, database, user or SSL mode',
    'Server is in recovery or shutting down (<code>the database system is starting up / shutting down</code>)'
  ],
  diagnose: `# Is the server up and listening?
systemctl status postgresql
pg_isready -h db1.internal -p 5432
ss -ltnp | grep 5432
tail -n 50 /var/log/postgresql/postgresql-18-main.log

-- From a local session:
SHOW listen_addresses;
SHOW port;
SELECT line_number, type, database, user_name, address, auth_method, error
FROM pg_hba_file_rules;`,
  fix: [
    'Read the server log first: it states exactly why startup failed or why a login was rejected.',
    'If the server is down, fix the reported cause (bad parameter, full disk, permissions on the data directory) and start it.',
    'Set <code>listen_addresses = \'*\'</code> (or specific IPs) in postgresql.conf and <strong>restart</strong>.',
    'Add a precise <code>hostssl db user 10.0.0.0/24 scram-sha-256</code> line to pg_hba.conf, check <code>pg_hba_file_rules.error</code> is NULL, then <code>SELECT pg_reload_conf();</code>.',
    'Open the port in the OS firewall and cloud security group, then retest with <code>pg_isready</code> from the client host.'
  ],
  prevent: [
    'Validate config changes with <code>pg_hba_file_rules</code> / <code>pg_file_settings</code> before reloading.',
    'Monitor with an external <code>pg_isready</code> probe and alert on failures.',
    'Manage pg_hba.conf and firewall rules as code (Ansible, Terraform) with review.'
  ] },

{ id: 'too-many-connections', title: 'Too many connections', severity: 'critical',
  symptoms: [
    '<code>FATAL: sorry, too many clients already</code> or <code>remaining connection slots are reserved for roles with the SUPERUSER attribute</code>',
    'Application errors spike during traffic peaks or after a deploy',
    'Hundreds of sessions in <code>idle</code> state in pg_stat_activity'
  ],
  causes: [
    'Each app instance has its own pool; pods x pool size exceeds <code>max_connections</code>',
    'Connection leaks: code that opens connections and never returns them',
    'Sessions stuck <code>idle in transaction</code>, holding slots',
    'Autoscaling added app instances without a central pooler'
  ],
  diagnose: `SELECT count(*) AS total, current_setting('max_connections') AS max_conn
FROM pg_stat_activity;

SELECT usename, application_name, client_addr, state, count(*)
FROM pg_stat_activity
GROUP BY 1, 2, 3, 4
ORDER BY count(*) DESC
LIMIT 20;`,
  fix: [
    'Free slots immediately by terminating idle sessions from the leaking app: <code>SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = \'idle\' AND application_name = \'...\' AND now() - state_change &gt; interval \'10 min\';</code>',
    'Put <strong>PgBouncer</strong> (third-party tool) in transaction pooling mode between apps and the database.',
    'Reduce per-instance pool sizes so the total fits; a few dozen active connections per CPU core set is usually optimal.',
    'Set <code>idle_in_transaction_session_timeout</code> and per-role <code>CONNECTION LIMIT</code> to contain bad actors.',
    'Only raise <code>max_connections</code> as a last resort: each backend costs memory and slows snapshot-taking.'
  ],
  prevent: [
    'Always use a central pooler for fleets of stateless app instances.',
    'Alert at 80% of max_connections and on idle-in-transaction counts.',
    'Keep <code>superuser_reserved_connections</code> / <code>reserved_connections</code> (PG16+) so admins can always log in.'
  ] },

{ id: 'slow-query', title: 'Slow query', severity: 'high',
  symptoms: [
    'An endpoint that took 20 ms now takes seconds',
    'Query appears at the top of pg_stat_statements by total time',
    'High CPU or IO while the query runs; logs show it via <code>log_min_duration_statement</code>'
  ],
  causes: [
    'Missing index (e.g. <code>orders(customer_id)</code>), causing a sequential scan',
    'Stale or insufficient statistics leading to a bad row estimate and wrong join strategy',
    'Function or cast on an indexed column (<code>WHERE date(order_date) = ...</code>) preventing index use',
    'OFFSET pagination deep into results, or a sort spilling to disk because work_mem is small',
    'Lock waits rather than CPU work (check wait_event)'
  ],
  diagnose: `EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders WHERE customer_id = 42 ORDER BY order_date DESC LIMIT 10;

-- top queries by total time (needs pg_stat_statements)
SELECT calls, round(mean_exec_time::numeric, 1) AS mean_ms, left(query, 80)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;`,
  fix: [
    'Run <code>EXPLAIN (ANALYZE, BUFFERS)</code> and find the node where estimated rows and actual rows diverge most, or where most time is spent.',
    'If it is a Seq Scan with a selective filter, add a matching index with <code>CREATE INDEX CONCURRENTLY</code>.',
    'If estimates are wrong, run <code>ANALYZE</code>, raise per-column statistics or add <code>CREATE STATISTICS</code> for correlated columns.',
    'Rewrite non-sargable predicates (<code>order_date &gt;= \'2025-01-01\' AND order_date &lt; \'2025-01-02\'</code>) and replace OFFSET with keyset pagination.',
    'Re-run EXPLAIN ANALYZE to confirm the improvement, then watch pg_stat_statements over the next day.'
  ],
  prevent: [
    'Enable pg_stat_statements and auto_explain with a sensible threshold.',
    'Review EXPLAIN plans for new queries in code review against production-sized data.',
    'Keep autovacuum/autoanalyze tuned for large tables.'
  ] },

{ id: 'deadlock-detected', title: 'Deadlock detected', severity: 'high',
  symptoms: [
    '<code>ERROR: deadlock detected</code> with <code>Process A waits for ShareLock on transaction X; blocked by process B</code>',
    'Intermittent failures under concurrency, never in single-user tests',
    '<code>deadlocks</code> counter growing in pg_stat_database'
  ],
  causes: [
    'Two transactions update the same rows in different orders (e.g. transfer A to B and B to A)',
    'Batch jobs updating rows in arbitrary order while the app updates the same rows',
    'Foreign key checks taking share locks on parent rows combined with parent updates',
    'Explicit LOCK TABLE in inconsistent orders across code paths'
  ],
  diagnose: `SELECT datname, deadlocks FROM pg_stat_database WHERE datname = current_database();

-- server log shows both statements; make sure this is on:
SHOW log_lock_waits;
SHOW deadlock_timeout;`,
  fix: [
    'Read the server log entry: it contains both queries and the locked tuples.',
    'Make every code path lock rows in the same deterministic order, e.g. <code>SELECT ... WHERE id IN (...) ORDER BY id FOR UPDATE</code> before updating.',
    'Use <code>FOR NO KEY UPDATE</code> when you do not change key columns, so FK checks are not blocked.',
    'Keep transactions short and add application-level retry for SQLSTATE <code>40P01</code>.'
  ],
  prevent: [
    'Code-review rule: multi-row updates sort by primary key.',
    'Enable <code>log_lock_waits = on</code> to spot contention before it becomes deadlocks.',
    'Alert when the deadlocks counter increases.'
  ] },

{ id: 'lock-timeout', title: 'Lock timeout / queries piling up behind a lock', severity: 'high',
  symptoms: [
    '<code>ERROR: canceling statement due to lock timeout</code>',
    'Suddenly every query on one table hangs after a deploy started a migration',
    'pg_stat_activity shows many sessions with <code>wait_event_type = Lock</code>'
  ],
  causes: [
    'An <code>ALTER TABLE</code> waiting for ACCESS EXCLUSIVE lock queues all later readers behind it',
    'A long-running transaction or idle-in-transaction session holds a conflicting lock',
    'Long batch UPDATE holding row locks the app needs',
    'CREATE INDEX without CONCURRENTLY blocking writes'
  ],
  diagnose: `SELECT pid, pg_blocking_pids(pid) AS blocked_by, wait_event_type,
       now() - query_start AS waiting, left(query, 70) AS query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;

SELECT relation::regclass, mode, granted, pid FROM pg_locks WHERE NOT granted;`,
  fix: [
    'Find the root blocker (a pid that blocks others but is not itself blocked).',
    'If it is an idle-in-transaction session or a runaway migration, <code>pg_cancel_backend(pid)</code>, then <code>pg_terminate_backend(pid)</code> if needed.',
    'Retry DDL with <code>SET lock_timeout = \'3s\'</code> in a retry loop so it never blocks traffic for long.',
    'Use online variants: <code>CREATE INDEX CONCURRENTLY</code>, <code>ADD CONSTRAINT ... NOT VALID</code> then <code>VALIDATE</code>.'
  ],
  prevent: [
    'All migrations set <code>lock_timeout</code> and <code>statement_timeout</code>.',
    'Set <code>idle_in_transaction_session_timeout</code> for application roles.',
    'Run risky DDL in low-traffic windows and batch large updates.'
  ] },

{ id: 'disk-full', title: 'Disk full', severity: 'critical',
  symptoms: [
    '<code>PANIC: could not write to file "pg_wal/...": No space left on device</code> and the server stops',
    '<code>ERROR: could not extend file ...: No space left on device</code> on inserts',
    'Server will not restart because it cannot write WAL or temp files'
  ],
  causes: [
    'pg_wal growth from a failing <code>archive_command</code> or an inactive replication slot',
    'Table/index bloat or unexpected data growth',
    'Huge temp files from sorts and hashes (bad query, large work_mem spills)',
    'Server logs or old base backups on the same volume'
  ],
  diagnose: `df -h /var/lib/postgresql
du -sh /var/lib/postgresql/18/main/{base,pg_wal,pg_log} 2>/dev/null

SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;
SELECT last_failed_wal, last_failed_time FROM pg_stat_archiver;
SELECT datname, temp_files, pg_size_pretty(temp_bytes) FROM pg_stat_database;`,
  fix: [
    '<strong>Never delete files from pg_wal by hand</strong>: that corrupts the cluster.',
    'Free space safely: remove old logs and backups on the volume, or grow the volume (cloud disks can usually be extended online).',
    'If WAL is retained by a dead slot, <code>SELECT pg_drop_replication_slot(\'name\');</code>; if archiving fails, fix archive_command so WAL can recycle.',
    'Start the server, let it checkpoint, then find and fix the root cause (bloat, runaway temp files, data growth).',
    'Reclaim bloated tables with pg_repack or VACUUM FULL in a window, and drop unused indexes.'
  ],
  prevent: [
    'Alert at 70% and 85% disk usage and on growth rate.',
    'Set <code>max_slot_wal_keep_size</code> and <code>temp_file_limit</code>.',
    'Keep pg_wal, logs and backups on separate volumes from data where possible.'
  ] },

{ id: 'db-growing-fast', title: 'Database growing too fast', severity: 'medium',
  symptoms: [
    'Database size doubles in weeks without matching business growth',
    'Table size much larger than <code>rows x average row width</code>',
    'Backups and restores take longer every week'
  ],
  causes: [
    'Bloat from updates/deletes that VACUUM cannot clean (long transactions, autovacuum too slow)',
    'Append-only log/audit tables with no retention policy',
    'Unused or duplicate indexes growing alongside data',
    'Large JSONB or text values duplicated per row'
  ],
  diagnose: `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total,
       n_live_tup, n_dead_tup
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;

SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10;`,
  fix: [
    'Record daily sizes per table to find which objects grow and how fast.',
    'For log-style tables, partition by time and drop old partitions instead of DELETE.',
    'Drop unused indexes (idx_scan = 0 over weeks, checked on all replicas).',
    'Remove bloat with pg_repack and fix the vacuum problem that caused it.',
    'Move cold data to an archive table/schema or cheaper storage.'
  ],
  prevent: [
    'Define retention policies per table at design time.',
    'Trend sizes in monitoring and alert on unusual growth rates.',
    'Review new indexes and large columns in schema review.'
  ] },

{ id: 'autovacuum-behind', title: 'Autovacuum not keeping up', severity: 'high',
  symptoms: [
    'n_dead_tup keeps rising and last_autovacuum is days old on hot tables',
    'Index-only scans turn into heap fetches; queries slow down over time',
    'All autovacuum workers busy all the time on large tables'
  ],
  causes: [
    'Default <code>autovacuum_vacuum_scale_factor = 0.2</code> waits for 20% dead rows on huge tables',
    'Cost limit throttling vacuum too much for modern disks',
    'Too few <code>autovacuum_max_workers</code> for the number of busy tables',
    'Long-running transactions or abandoned replication slots holding back the xmin horizon, so vacuum runs but cannot remove rows'
  ],
  diagnose: `SELECT relname, n_dead_tup, n_live_tup, last_autovacuum, autovacuum_count
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;

SELECT pid, relid::regclass, phase, heap_blks_scanned, heap_blks_total
FROM pg_stat_progress_vacuum;

SELECT pid, backend_xmin, now() - xact_start AS age, state
FROM pg_stat_activity WHERE backend_xmin IS NOT NULL ORDER BY age(backend_xmin) DESC LIMIT 5;`,
  fix: [
    'Remove whatever holds back the xmin horizon: old transactions, stale slots, prepared transactions (<code>pg_prepared_xacts</code>).',
    'Lower scale factors on big tables: <code>ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02);</code>',
    'Raise <code>autovacuum_vacuum_cost_limit</code> (e.g. 2000+) and reduce <code>autovacuum_vacuum_cost_delay</code> for SSDs.',
    'Increase <code>autovacuum_max_workers</code> if many tables need work at once.',
    'Run a manual <code>VACUUM (VERBOSE)</code> on the worst tables to catch up.'
  ],
  prevent: [
    'Per-table autovacuum settings for the top 10 largest/hottest tables.',
    'Alert on dead tuple ratio and on oldest xmin age.',
    'Enable <code>log_autovacuum_min_duration</code> to see what vacuum is doing.'
  ] },

{ id: 'high-cpu', title: 'High CPU', severity: 'high',
  symptoms: [
    'CPU pinned near 100% on the database host',
    'Latency rises across all queries, not just one',
    'Many active sessions with no wait_event (on CPU)'
  ],
  causes: [
    'Sequential scans or nested-loop joins over large tables due to missing indexes',
    'A frequently called query that is individually fast but runs thousands of times per second',
    'Too many active connections causing context switching and lock contention',
    'Expensive functions, regex or JSON processing per row'
  ],
  diagnose: `SELECT count(*) FILTER (WHERE state = 'active') AS active,
       count(*) FILTER (WHERE state = 'active' AND wait_event IS NULL) AS on_cpu
FROM pg_stat_activity;

SELECT calls, round(total_exec_time::numeric) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms,
       left(query, 80)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;`,
  fix: [
    'Identify the top queries by total_exec_time in pg_stat_statements (not by mean time).',
    'EXPLAIN them and add missing indexes or rewrite them.',
    'Cache or batch chatty queries in the application (N+1 patterns).',
    'Limit concurrent active connections with a pooler.',
    'Move reporting queries to a read replica.'
  ],
  prevent: [
    'Baseline CPU and top queries; alert on sustained usage above 80%.',
    'Load-test new features with production-like data volumes.',
    'Review pg_stat_statements weekly.'
  ] },

{ id: 'high-memory', title: 'High memory / OOM killer', severity: 'high',
  symptoms: [
    'Linux OOM killer terminates a backend and the whole cluster restarts (<code>server process was terminated by signal 9</code>)',
    'Swap usage grows and latency spikes',
    'Memory usage scales with connection count'
  ],
  causes: [
    '<code>work_mem</code> set too high globally: multiplied per sort/hash node, per connection, per parallel worker',
    'Too many connections each holding catalog caches and prepared statements',
    'shared_buffers too large for the host, leaving no room for OS and backends',
    'Huge result sets or hash aggregates on mis-estimated row counts'
  ],
  diagnose: `SELECT name, setting, unit FROM pg_settings
WHERE name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem', 'max_connections',
               'max_parallel_workers_per_gather', 'hash_mem_multiplier');

-- PG14+: memory contexts of the current session
SELECT name, pg_size_pretty(total_bytes) FROM pg_backend_memory_contexts
ORDER BY total_bytes DESC LIMIT 10;`,
  fix: [
    'Lower the global <code>work_mem</code>; raise it per session only for known heavy reports.',
    'Reduce connections with a pooler; memory per idle backend adds up.',
    'Size shared_buffers around 25% of RAM; leave the rest for OS cache and backends.',
    'Set <code>vm.overcommit_memory = 2</code> on dedicated DB hosts so allocations fail gracefully instead of triggering the OOM killer.',
    'Fix the mis-estimated queries (ANALYZE, extended statistics) that build huge hash tables.'
  ],
  prevent: [
    'Capacity formula: shared_buffers + connections x (work_mem x few nodes) must fit with headroom.',
    'Alert on swap usage and OOM events.',
    'Disable transparent huge pages and configure huge_pages for large shared_buffers.'
  ] },

{ id: 'high-io', title: 'High IO', severity: 'high',
  symptoms: [
    'Disk utilisation near 100% and high IO wait in OS metrics',
    'Many sessions waiting on <code>IO / DataFileRead</code>',
    'Periodic write spikes every few minutes'
  ],
  causes: [
    'Working set larger than memory: low cache hit ratio and constant reads',
    'Frequent checkpoints because <code>max_wal_size</code> is too small',
    'Sequential scans of large tables by reports',
    'Temp files from sorts and hashes spilling to disk',
    'Vacuum on huge tables or index builds competing with traffic'
  ],
  diagnose: `SELECT round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) AS hit_pct,
       temp_files, pg_size_pretty(temp_bytes) AS temp
FROM pg_stat_database WHERE datname = current_database();

SELECT num_timed, num_requested FROM pg_stat_checkpointer;

SELECT backend_type, context, reads, writes FROM pg_stat_io
ORDER BY reads + writes DESC NULLS LAST LIMIT 10;`,
  fix: [
    'If num_requested checkpoints dominate, raise <code>max_wal_size</code> and set <code>checkpoint_completion_target = 0.9</code>.',
    'Add indexes for the queries doing big sequential scans, or route them to a replica.',
    'Increase work_mem for the queries creating temp files (log them with <code>log_temp_files = 0</code>).',
    'Add RAM or faster storage if the working set genuinely outgrew the host.'
  ],
  prevent: [
    'Track cache hit ratio, IO latency and checkpoint frequency.',
    'Enable <code>track_io_timing</code> to see IO time in EXPLAIN and pg_stat_statements.',
    'Schedule maintenance jobs outside peak hours.'
  ] },

{ id: 'replication-lag', title: 'Replication lag', severity: 'high',
  symptoms: [
    'Users read stale data from replicas ("my order disappeared")',
    'replay_lag in pg_stat_replication grows to minutes',
    'Replica logs <code>canceling statement due to conflict with recovery</code>'
  ],
  causes: [
    'Bulk writes on the primary (big UPDATE, index build, VACUUM FULL) producing WAL faster than the replica can apply',
    'Long queries on the replica blocking replay (<code>max_standby_streaming_delay</code>)',
    'Network bandwidth or replica disk slower than primary',
    'Single-threaded replay of WAL on the standby'
  ],
  diagnose: `-- on the primary
SELECT application_name, state, sent_lsn, replay_lsn,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS lag_bytes,
       replay_lag
FROM pg_stat_replication;

-- on the replica
SELECT now() - pg_last_xact_replay_timestamp() AS replay_delay;
SELECT * FROM pg_stat_database_conflicts WHERE datname = current_database();`,
  fix: [
    'Identify whether the bottleneck is send (network), flush (replica disk) or replay (apply) by comparing sent/write/flush/replay LSNs.',
    'Throttle or batch large write jobs on the primary.',
    'Move long analytics queries off latency-sensitive replicas, or use a dedicated reporting replica with a large standby delay.',
    'Upgrade replica disk/network to match the primary.',
    'Route read-your-writes traffic to the primary.'
  ],
  prevent: [
    'Alert on replay lag in both bytes and seconds.',
    'Replicas should have hardware equal to the primary.',
    'Split large migrations into batches.'
  ] },

{ id: 'wal-growing', title: 'WAL growing (pg_wal filling up)', severity: 'critical',
  symptoms: [
    'pg_wal directory grows far beyond max_wal_size',
    'Disk alerts on the WAL volume',
    'Log lines like <code>archive command failed with exit code 1</code>'
  ],
  causes: [
    'archive_command failing, so segments cannot be recycled',
    'Inactive or lagging replication slot retaining WAL',
    'Very high write volume (bulk loads, full_page_writes after frequent checkpoints)',
    'Large <code>wal_keep_size</code>'
  ],
  diagnose: `SELECT slot_name, slot_type, active, wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;

SELECT failed_count, last_failed_wal, last_failed_time, last_archived_time
FROM pg_stat_archiver;

SELECT count(*), pg_size_pretty(sum(size)) FROM pg_ls_waldir();`,
  fix: [
    'Fix archive_command (credentials, bucket permissions, full archive disk) and confirm last_archived_time advances.',
    'Drop slots for consumers that no longer exist: <code>SELECT pg_drop_replication_slot(\'old_slot\');</code>',
    'Restart lagging consumers so they catch up and release WAL.',
    'Never remove pg_wal files manually.'
  ],
  prevent: [
    'Set <code>max_slot_wal_keep_size</code> so a stuck slot is invalidated before the disk fills.',
    'Alert on inactive slots and failed archiving.',
    'Size the WAL volume for peak write bursts plus several hours of archive outage.'
  ] },

{ id: 'index-bloat', title: 'Index bloat', severity: 'medium',
  symptoms: [
    'Index much larger than expected relative to table size',
    'Index scans touching more pages than before (more buffers in EXPLAIN)',
    'Index size keeps growing although the row count is stable'
  ],
  causes: [
    'Heavy UPDATE/DELETE churn leaving sparse pages (B-tree pages are reused but not merged)',
    'Indexes on monotonically updated columns such as updated_at, defeating HOT updates',
    'Vacuum falling behind'
  ],
  diagnose: `CREATE EXTENSION IF NOT EXISTS pgstattuple;  -- contrib extension
SELECT avg_leaf_density, leaf_fragmentation FROM pgstatindex('idx_order_items_order');

SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size, idx_scan
FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10;`,
  fix: [
    'Confirm with pgstatindex: leaf density well below ~70% means significant bloat.',
    'Rebuild online: <code>REINDEX INDEX CONCURRENTLY idx_name;</code>',
    'Drop indexes that are not used rather than rebuilding them.',
    'Avoid indexing frequently updated columns so updates can be HOT.'
  ],
  prevent: [
    'Keep autovacuum aggressive on churn-heavy tables.',
    'Use <code>fillfactor</code> on hot tables to encourage HOT updates.',
    'Schedule periodic bloat checks.'
  ] },

{ id: 'table-bloat', title: 'Table bloat', severity: 'medium',
  symptoms: [
    'Table size on disk far exceeds live data',
    'Sequential scans slow down although row count is stable',
    'High n_dead_tup in pg_stat_user_tables'
  ],
  causes: [
    'Dead tuples not removed because of long transactions or stale slots',
    'Autovacuum thresholds too high for large tables',
    'Massive one-off DELETE or UPDATE; VACUUM makes space reusable but does not shrink the file'
  ],
  diagnose: `SELECT relname, n_live_tup, n_dead_tup, last_autovacuum,
       pg_size_pretty(pg_relation_size(relid)) AS heap_size
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;

CREATE EXTENSION IF NOT EXISTS pgstattuple;
SELECT table_len, tuple_percent, dead_tuple_percent, free_percent
FROM pgstattuple('orders');`,
  fix: [
    'Fix what blocks vacuum first (old transactions, slots), then run <code>VACUUM (VERBOSE) table</code>.',
    'If the free space must go back to the OS, use <strong>pg_repack</strong> (extension + tool) online, or VACUUM FULL during a maintenance window.',
    'For purge workloads, switch to partitioning and drop partitions.'
  ],
  prevent: [
    'Tune per-table autovacuum for hot tables.',
    'Delete in batches and let vacuum keep up between them.',
    'Monitor dead tuple percentage.'
  ] },

{ id: 'xid-wraparound', title: 'Transaction ID wraparound', severity: 'critical',
  symptoms: [
    'Warnings: <code>database "x" must be vacuumed within N transactions</code>',
    'Worst case: <code>database is not accepting commands that assign new XIDs to avoid wraparound data loss</code>',
    'Aggressive "to prevent wraparound" autovacuums running on big tables'
  ],
  causes: [
    'Very high write rate consuming 32-bit transaction IDs',
    'Vacuum unable to freeze because of long-running transactions, orphaned prepared transactions or stale slots',
    'Autovacuum disabled or throttled on large tables'
  ],
  diagnose: `SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY 2 DESC;

SELECT c.oid::regclass, age(c.relfrozenxid) AS xid_age
FROM pg_class c WHERE c.relkind IN ('r', 'm', 't')
ORDER BY 2 DESC LIMIT 10;

SELECT gid, prepared, owner FROM pg_prepared_xacts;
SELECT pid, age(backend_xmin), state FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL ORDER BY 2 DESC LIMIT 5;`,
  fix: [
    'Remove blockers: commit/rollback prepared transactions, terminate ancient sessions, drop stale slots.',
    'Run <code>VACUUM (FREEZE, VERBOSE)</code> on the oldest tables first, with high <code>maintenance_work_mem</code> and no cost delay.',
    'If writes are already refused, connect as superuser and run plain <code>VACUUM</code> on the oldest tables of the affected database; current docs no longer recommend single-user mode, and never use VACUUM FULL here.',
    'Watch age(datfrozenxid) fall before resuming normal operations.'
  ],
  prevent: [
    'Alert when age exceeds ~500M, long before the 2-billion limit.',
    'Never disable autovacuum; tune it for large tables.',
    'Schedule manual freeze vacuums of large append-only tables in quiet hours.'
  ] },

{ id: 'failed-backup', title: 'Failed backup', severity: 'high',
  symptoms: [
    'Backup job exits non-zero or produces a tiny file',
    '<code>pg_dump: error: query failed: ERROR: permission denied</code>',
    'Archive gaps reported by pgBackRest/Barman check'
  ],
  causes: [
    'Backup role lacks privileges on new schemas or tables',
    'Disk full on the backup target, or expired cloud credentials',
    'Statement or idle timeouts killing the long pg_dump transaction',
    'Version mismatch: pg_dump older than the server',
    'Replication conflicts cancelling pg_dump on a replica'
  ],
  diagnose: `# exit status and log of the job
echo $?
pgbackrest --stanza=main check
pgbackrest --stanza=main info

-- server side
SELECT failed_count, last_failed_wal, last_failed_time FROM pg_stat_archiver;`,
  fix: [
    'Read the job log for the first error, not the last.',
    'Grant the backup role <code>pg_read_all_data</code> (PG14+) so new tables are always covered.',
    'Use a pg_dump of the same or newer major version than the server.',
    'Exempt the backup role from statement_timeout: <code>ALTER ROLE backup_reader SET statement_timeout = 0;</code>',
    'Re-run the backup immediately and verify it with a test restore.'
  ],
  prevent: [
    'Alert on backup job failure and on backup age (no successful backup in 26 h).',
    'Automated weekly restore tests.',
    'Monitor backup repository free space.'
  ] },

{ id: 'failed-restore', title: 'Failed restore', severity: 'high',
  symptoms: [
    '<code>ERROR: role "app_owner" does not exist</code> during pg_restore',
    '<code>could not execute query: ERROR: extension "vector" is not available</code>',
    'Restore finishes but the application sees missing data or errors'
  ],
  causes: [
    'Globals (roles) not restored before the database dump',
    'Extension binaries missing on the target server',
    'Restoring into a non-empty database causing duplicate-object errors',
    'Plain-format dump replayed without ON_ERROR_STOP, silently skipping failures',
    'Target server older than the source'
  ],
  diagnose: `pg_restore -l company_db.dump | head -50
pg_restore -d company_db_restored -j 4 company_db.dump 2>&1 | tee restore.log
grep -c ERROR restore.log

-- on target
SELECT name FROM pg_available_extensions WHERE name IN ('vector', 'pg_trgm', 'pgcrypto');`,
  fix: [
    'Restore globals first: <code>psql -f globals.sql</code>, or use <code>--no-owner --no-privileges</code> and re-grant.',
    'Install required extension packages on the target before restoring.',
    'Restore into a fresh database created from template0.',
    'Use <code>--exit-on-error</code> or <code>ON_ERROR_STOP=1</code> to stop at the first real error.',
    'Run ANALYZE and compare row counts against the source.'
  ],
  prevent: [
    'Document and automate the full restore runbook including globals and extensions.',
    'Test restores regularly to a server matching production.',
    'Keep the restore target on the same or newer major version.'
  ] },

{ id: 'corrupt-index', title: 'Corrupt index', severity: 'critical',
  symptoms: [
    'Queries return different results with and without an index (<code>SET enable_indexscan = off</code>)',
    'Errors like <code>index "x" contains unexpected zero page</code> or duplicate key values in a unique index',
    'Problems appear after an OS/glibc upgrade (collation changes) or storage incident'
  ],
  causes: [
    'Collation library changes (glibc 2.28+) altering text sort order under existing B-tree indexes',
    'Hardware or storage faults, fsync misconfiguration',
    'Bugs in old minor versions'
  ],
  diagnose: `CREATE EXTENSION IF NOT EXISTS amcheck;  -- contrib extension
SELECT bt_index_check('idx_order_items_order'::regclass, true);

-- collation version drift (PG15+)
SELECT datname, datcollversion, pg_database_collation_actual_version(oid)
FROM pg_database;`,
  fix: [
    'Confirm with <code>amcheck</code> (or pg_amcheck) which indexes are affected.',
    'Rebuild them: <code>REINDEX INDEX CONCURRENTLY idx_name;</code>',
    'After a collation change, reindex all text indexes and run <code>ALTER DATABASE db REFRESH COLLATION VERSION;</code>',
    'If storage is suspect, check data checksums and the hardware; restore from backup if table data is damaged.'
  ],
  prevent: [
    'Enable data checksums (default for new clusters since PG18).',
    'Plan OS upgrades that change glibc as reindex events, or use ICU / builtin collation providers.',
    'Run amcheck periodically and stay on current minor releases.'
  ] },

{ id: 'long-running-transaction', title: 'Long-running transaction', severity: 'high',
  symptoms: [
    'One session has been in a transaction for hours',
    'Dead tuples accumulate on all tables; vacuum reports "dead but not yet removable"',
    'DDL hangs waiting for locks'
  ],
  causes: [
    'Application opens a transaction and waits on a user or external API',
    'Forgotten interactive psql session with BEGIN',
    'Analytics query or pg_dump running for hours on the primary',
    'Orphaned prepared transactions (two-phase commit)'
  ],
  diagnose: `SELECT pid, usename, application_name, client_addr, state,
       now() - xact_start AS xact_age, now() - state_change AS in_state_for,
       left(query, 60) AS last_query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start
LIMIT 10;

SELECT gid, prepared FROM pg_prepared_xacts;`,
  fix: [
    'Identify the owner from application_name/client_addr and ask before killing if it is a legitimate job.',
    'Cancel the query (<code>pg_cancel_backend</code>) or end the session (<code>pg_terminate_backend</code>); its work is rolled back.',
    'Resolve orphaned prepared transactions with <code>ROLLBACK PREPARED \'gid\'</code>.',
    'Fix the application so external calls happen outside transactions.'
  ],
  prevent: [
    'Set <code>idle_in_transaction_session_timeout</code> and per-role <code>statement_timeout</code>; PG17+ also has <code>transaction_timeout</code>.',
    'Run long analytics on replicas.',
    'Alert on transactions older than a few minutes.'
  ] },
];

/* ----------------------------- DESIGN RULES ----------------------------- */
PGM.DESIGN_RULES = [
{ title: 'Primary key rules', rules: [
  { rule: 'Every table has a primary key',
    why: 'Without a PK you cannot reliably update or delete one row, logical replication cannot replicate UPDATE/DELETE, and ORMs and tools misbehave. Duplicates creep in silently.',
    good: `CREATE TABLE invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  amount numeric(12,2) NOT NULL
);`,
    bad: `CREATE TABLE invoices (
  order_id bigint,
  amount numeric(12,2)
);  -- no way to address a single row` },
  { rule: 'Use surrogate keys; enforce natural keys with UNIQUE',
    why: 'Natural values (email, SKU, PAN) change and are often long. A small immutable surrogate keeps FKs cheap, while a UNIQUE constraint still protects the business rule.',
    good: `CREATE TABLE suppliers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gstin text NOT NULL UNIQUE,
  name text NOT NULL
);`,
    bad: `CREATE TABLE suppliers (
  gstin text PRIMARY KEY,  -- every FK copies the text; re-registration breaks references
  name text
);` },
  { rule: 'Prefer identity columns over serial',
    why: 'GENERATED ALWAYS AS IDENTITY is SQL standard, ties the sequence to the column cleanly, and rejects accidental manual ids that later cause duplicate-key errors.',
    good: `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`,
    bad: `id serial PRIMARY KEY  -- legacy, int4, sequence ownership/permissions are separate objects` },
  { rule: 'Use bigint, not int, for high-volume tables',
    why: 'int4 tops out at about 2.1 billion. Running out in production forces a full-table rewrite of the PK and every FK under pressure. The extra 4 bytes are cheap insurance.',
    good: `CREATE TABLE events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payload jsonb);`,
    bad: `CREATE TABLE events (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payload jsonb);` },
  { rule: 'Composite PKs for pure junction tables',
    why: 'A link table such as employee_projects is identified by the pair; a composite PK prevents duplicate assignments and doubles as the index for lookups by the first column.',
    good: `CREATE TABLE employee_skills (
  employee_id int REFERENCES employees(id),
  skill_id int REFERENCES skills(id),
  level smallint,
  PRIMARY KEY (employee_id, skill_id)
);`,
    bad: `CREATE TABLE employee_skills (
  id serial PRIMARY KEY,
  employee_id int, skill_id int  -- same pair can be inserted twice
);` },
  { rule: 'Never reuse or update primary key values',
    why: 'PK values leak into URLs, caches, logs and other systems. Changing them cascades through every FK and breaks external references.',
    good: `-- keep the id, change the attribute
UPDATE customers SET email = 'new@example.com' WHERE id = 42;`,
    bad: `UPDATE customers SET id = 9001 WHERE id = 42;` }
]},

{ title: 'Foreign key rules', rules: [
  { rule: 'Declare foreign keys for every relationship',
    why: 'The database is the last line of defence: application bugs, scripts and manual fixes all bypass app-level checks. FKs also document the model and help the planner (join removal).',
    good: `ALTER TABLE order_items
  ADD CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders(id);`,
    bad: `-- "the app makes sure order_id exists"
CREATE TABLE order_items (id bigint, order_id bigint, product_id int);` },
  { rule: 'Index every foreign key column',
    why: 'PostgreSQL indexes the referenced PK but not the referencing column. Without it, deleting a parent row or joining parent to child scans the whole child table and takes long locks.',
    good: `CREATE INDEX CONCURRENTLY idx_orders_customer ON orders (customer_id);`,
    bad: `` },
  { rule: 'Choose ON DELETE behaviour deliberately',
    why: 'CASCADE on business data can wipe thousands of rows from one mistaken DELETE. Use CASCADE for owned children (order lines), RESTRICT for independent entities, SET NULL for optional links.',
    good: `order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,      -- lines belong to order
customer_id int NOT NULL REFERENCES customers(id) ON DELETE RESTRICT  -- never lose orders`,
    bad: `customer_id int REFERENCES customers(id) ON DELETE CASCADE  -- deleting a customer deletes their order history` },
  { rule: 'Add FKs to big tables with NOT VALID, then VALIDATE',
    why: 'A plain ADD FOREIGN KEY scans the child table while blocking writes. NOT VALID adds it instantly for new rows; VALIDATE checks old rows under a weaker lock.',
    good: `ALTER TABLE payments ADD CONSTRAINT payments_order_fk
  FOREIGN KEY (order_id) REFERENCES orders(id) NOT VALID;
ALTER TABLE payments VALIDATE CONSTRAINT payments_order_fk;`,
    bad: `ALTER TABLE payments ADD CONSTRAINT payments_order_fk
  FOREIGN KEY (order_id) REFERENCES orders(id);  -- long blocking scan on 500M rows` },
  { rule: 'FK column type must match the referenced column exactly',
    why: 'Mismatched types (int vs bigint) force casts in joins, can prevent index use, and break when the parent grows past the smaller type range.',
    good: `order_id bigint NOT NULL REFERENCES orders(id)  -- orders.id is bigint`,
    bad: `order_id int REFERENCES orders(id)  -- overflows after 2.1B orders` }
]},

{ title: 'Index rules', rules: [
  { rule: 'Index for actual query patterns, not for every column',
    why: 'Each index slows every INSERT/UPDATE/DELETE, consumes memory and adds WAL. Derive indexes from pg_stat_statements and EXPLAIN, not guesswork.',
    good: `-- query: WHERE customer_id = $1 ORDER BY order_date DESC LIMIT 20
CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date DESC);`,
    bad: `CREATE INDEX ON orders (status);
CREATE INDEX ON orders (total_amount);
CREATE INDEX ON orders (order_date);
CREATE INDEX ON orders (customer_id);  -- shotgun indexing` },
  { rule: 'Equality columns first, range/sort column last',
    why: 'A B-tree can only use leading columns efficiently. Putting the range column first means the equality filter cannot narrow the scan.',
    good: `CREATE INDEX ON orders (status, order_date);  -- WHERE status = 'paid' AND order_date > ...`,
    bad: `CREATE INDEX ON orders (order_date, status);` },
  { rule: 'Use partial indexes for skewed predicates',
    why: 'If 2% of rows are pending and you only ever query pending, index only those: a fraction of the size and maintenance cost.',
    good: `CREATE INDEX idx_orders_pending ON orders (order_date) WHERE status = 'pending';`,
    bad: `CREATE INDEX ON orders (status, order_date);  -- indexes 98% of rows you never query this way` },
  { rule: 'Always build and drop indexes CONCURRENTLY in production',
    why: 'Plain CREATE INDEX blocks writes for the whole build; DROP INDEX takes ACCESS EXCLUSIVE and queues every reader.',
    good: `CREATE INDEX CONCURRENTLY idx_payments_order ON payments (order_id);`,
    bad: `CREATE INDEX idx_payments_order ON payments (order_id);  -- blocks checkout for minutes` },
  { rule: 'Remove unused and duplicate indexes',
    why: 'An index whose leading columns are a prefix of another index is usually redundant. Unused indexes cost writes and cache for nothing.',
    good: `-- keep only (customer_id, order_date); it also serves WHERE customer_id = ?
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_customer;`,
    bad: `` },
  { rule: 'Match the index type to the operator',
    why: 'B-tree cannot serve jsonb @>, array overlap, full-text or trigram LIKE searches. Use GIN, GiST, BRIN or HNSW as appropriate.',
    good: `CREATE INDEX ON products USING gin (attributes jsonb_path_ops);
CREATE INDEX ON documents USING gin (search);`,
    bad: `CREATE INDEX ON products (attributes);  -- B-tree on jsonb: useless for @> queries` }
]},

{ title: 'Naming conventions', rules: [
  { rule: 'Lowercase snake_case, never quoted identifiers',
    why: 'PostgreSQL folds unquoted names to lowercase. "OrderItems" must then be quoted forever, in every query and tool.',
    good: `CREATE TABLE order_items (unit_price numeric(10,2));`,
    bad: `CREATE TABLE "OrderItems" ("UnitPrice" numeric);  -- SELECT * FROM orderitems fails` },
  { rule: 'Plural table names, singular column names, consistent everywhere',
    why: 'Pick one convention and enforce it. Consistency matters more than the choice itself; company_db uses plural tables (orders, customers).',
    good: `orders(id, customer_id, order_date)`,
    bad: `Order(OrderID, cust, date_of_order)` },
  { rule: 'Name foreign keys after the referenced table (customer_id)',
    why: 'customer_id instantly tells the reader which table it points to and makes joins self-documenting.',
    good: `orders.customer_id -> customers.id`,
    bad: `orders.cust -> customers.id
orders.c_ref -> customers.id` },
  { rule: 'Name constraints and indexes explicitly',
    why: 'Error messages show the constraint name; a clear name tells support exactly what failed. Auto-generated names differ between environments and break migrations.',
    good: `ALTER TABLE products ADD CONSTRAINT products_price_positive_chk CHECK (price > 0);
CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date);`,
    bad: `ALTER TABLE products ADD CHECK (price > 0);  -- products_price_check, products_price_check1 ...` },
  { rule: 'Avoid reserved words and type names as identifiers',
    why: 'Columns named user, order, desc or date need quoting or produce confusing errors.',
    good: `created_on date, sort_order int, description text`,
    bad: `"date" date, "order" int, "desc" text` }
]},

{ title: 'Normalization', rules: [
  { rule: 'Store each fact once (3NF by default)',
    why: 'Duplicated facts drift apart: change a department name in one place and reports disagree. Normalize first; denormalize only with evidence.',
    good: `employees(id, department_id REFERENCES departments(id), ...)
departments(id, name, location)`,
    bad: `employees(id, department_name, department_location, ...)  -- rename = update 200 rows` },
  { rule: 'No repeating groups or comma-separated lists',
    why: 'Columns like phone1, phone2, phone3 or "1,4,7" strings cannot be indexed, constrained or joined properly.',
    good: `CREATE TABLE customer_phones (
  customer_id int REFERENCES customers(id),
  phone text NOT NULL,
  kind text CHECK (kind IN ('mobile', 'office')),
  PRIMARY KEY (customer_id, phone)
);`,
    bad: `ALTER TABLE customers ADD COLUMN phones text;  -- '98100..., 98200...'` },
  { rule: 'Model many-to-many with a junction table',
    why: 'employee_projects lets each assignment carry its own attributes (role, allocation_pct) and keeps both sides normalized.',
    good: `employee_projects(employee_id, project_id, role, allocation_pct, PRIMARY KEY (employee_id, project_id))`,
    bad: `projects(id, name, member_ids int[])  -- no FK enforcement on array elements` },
  { rule: 'Capture point-in-time values where the business needs them',
    why: 'Normalization does not mean always joining to the current value. Order lines must keep the price paid, not the current product price.',
    good: `order_items(order_id, product_id, quantity, unit_price)  -- price at time of sale`,
    bad: `order_items(order_id, product_id, quantity)  -- invoice changes when product price changes` },
  { rule: 'Use JSONB for genuinely variable attributes, columns for core ones',
    why: 'JSONB is ideal for sparse, product-specific attributes, but fields you filter, join or constrain on belong in typed columns with constraints.',
    good: `products(id, sku, name, category, price numeric NOT NULL, attributes jsonb)`,
    bad: `products(id, data jsonb)  -- price, sku and category hidden in JSON without constraints` }
]},

{ title: 'Denormalization', rules: [
  { rule: 'Denormalize only for a measured read bottleneck',
    why: 'Every copy of data needs code to keep it in sync. Measure with EXPLAIN and pg_stat_statements first; an index often fixes the problem.',
    good: `-- dashboard query took 4 s with 5 joins; precompute it
CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT order_date::date AS day, sum(total_amount) AS revenue FROM orders GROUP BY 1;`,
    bad: `-- "joins are slow" so copy customer name, city, segment into every order row` },
  { rule: 'Prefer materialized views or summary tables over duplicated columns',
    why: 'They keep the source of truth normalized and make the refresh point explicit and auditable.',
    good: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales;  -- scheduled every 15 min`,
    bad: `` },
  { rule: 'Maintain derived columns in the database, not scattered app code',
    why: 'Generated columns and triggers update copies atomically with the source row, so they cannot drift when another service writes.',
    good: `ALTER TABLE order_items ADD COLUMN line_total numeric
  GENERATED ALWAYS AS (quantity * unit_price) STORED;`,
    bad: `-- each microservice computes line_total on its own and writes it` },
  { rule: 'Document the source of truth for every denormalized value',
    why: 'Future engineers need to know which value wins and how to rebuild the copy after an incident.',
    good: `COMMENT ON COLUMN orders.total_amount IS 'Derived: sum(order_items.quantity * unit_price); maintained by trg_order_total';`,
    bad: `` }
]},

{ title: 'NULL usage', rules: [
  { rule: 'Default to NOT NULL; allow NULL only when "unknown/not applicable" is meaningful',
    why: 'NULL brings three-valued logic, surprising aggregates and NOT IN traps. Mandatory business data must be NOT NULL.',
    good: `email text NOT NULL,
end_date date  -- NULL = project still running`,
    bad: `email text,  -- nullable "just in case"
name text` },
  { rule: 'Never use magic values instead of NULL',
    why: 'Sentinels like 1900-01-01, -1 or the string N/A pollute averages, ranges and indexes and must be remembered by every query.',
    good: `end_date date NULL`,
    bad: `end_date date NOT NULL DEFAULT '9999-12-31'` },
  { rule: 'Compare with IS NULL / IS DISTINCT FROM',
    why: 'col = NULL is never true. IS DISTINCT FROM treats NULLs as comparable values, which is what change detection needs.',
    good: `SELECT * FROM projects WHERE end_date IS NULL;
... WHEN (OLD.salary IS DISTINCT FROM NEW.salary)`,
    bad: `SELECT * FROM projects WHERE end_date = NULL;  -- always empty` },
  { rule: 'Avoid NOT IN with subqueries that can return NULL',
    why: 'If the subquery returns a single NULL, NOT IN returns no rows at all. NOT EXISTS behaves correctly and plans better.',
    good: `SELECT e.* FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM employees r WHERE r.manager_id = e.id);`,
    bad: `SELECT * FROM employees WHERE id NOT IN (SELECT manager_id FROM employees);  -- manager_id has NULLs: returns nothing` },
  { rule: 'Decide NULL semantics for unique columns',
    why: 'By default UNIQUE allows many NULLs. Use NULLS NOT DISTINCT (PG15+) when at most one NULL should exist.',
    good: `CREATE UNIQUE INDEX ON users (tenant_id, username) NULLS NOT DISTINCT;`,
    bad: `` }
]},

{ title: 'Timestamp handling', rules: [
  { rule: 'Use timestamptz for points in time',
    why: 'timestamptz stores an absolute instant (UTC internally) and converts on display. timestamp without time zone loses the offset and breaks across regions and DST.',
    good: `created_at timestamptz NOT NULL DEFAULT now()`,
    bad: `created_at timestamp DEFAULT now()  -- which zone? IST? UTC? the server's?` },
  { rule: 'Use date for calendar dates, and keep "local wall time" with its zone',
    why: 'A birth date or hire_date has no time zone. A future appointment in local time should store local time plus the IANA zone name, because offsets change.',
    good: `hire_date date NOT NULL,
meeting_local timestamp, meeting_tz text  -- 'Asia/Kolkata'`,
    bad: `hire_date timestamptz  -- shifts a day when viewed from another zone` },
  { rule: 'Query ranges with half-open intervals',
    why: 'BETWEEN with timestamps either misses the last day or double-counts midnight. >= start AND < next_start is exact and index friendly.',
    good: `WHERE order_date >= '2025-01-01' AND order_date < '2025-02-01'`,
    bad: `WHERE order_date BETWEEN '2025-01-01' AND '2025-01-31'  -- misses Jan 31 after 00:00` },
  { rule: 'Do not wrap indexed timestamp columns in functions',
    why: 'WHERE date(order_date) = ... or date_trunc(...) = ... cannot use a plain index on order_date and disables partition pruning.',
    good: `WHERE order_date >= '2025-03-15' AND order_date < '2025-03-16'`,
    bad: `WHERE order_date::date = '2025-03-15'` },
  { rule: 'Know now() vs clock_timestamp()',
    why: 'now() is frozen at transaction start, so every row in a batch gets the same value. clock_timestamp() changes during the transaction; use it for durations.',
    good: `-- same audit time for a whole batch
UPDATE orders SET status = 'shipped', shipped_at = now() WHERE ...;`,
    bad: `` }
]},

{ title: 'UUID vs BIGINT', rules: [
  { rule: 'Default to bigint identity for internal keys',
    why: '8 bytes, sequential (B-tree friendly), human-readable, cheap joins. Good for almost all single-database OLTP systems.',
    good: `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`,
    bad: `` },
  { rule: 'Use UUIDs when ids are generated outside the database or exposed publicly',
    why: 'Offline clients, multiple writers, merging databases and non-guessable public ids benefit from globally unique keys.',
    good: `CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id int NOT NULL REFERENCES users(id)
);`,
    bad: `` },
  { rule: 'Prefer time-ordered UUIDv7 over random UUIDv4 for keys',
    why: 'v4 inserts land on random index pages, causing page splits, cache misses and WAL amplification on big tables. v7 (core function uuidv7() in PG18) is ordered by time.',
    good: `id uuid PRIMARY KEY DEFAULT uuidv7()`,
    bad: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()  -- fine for small tables, painful at 1B rows` },
  { rule: 'Store UUIDs as uuid, never text',
    why: 'uuid is 16 bytes with fast comparison; text is 36+ bytes, slower to compare and accepts invalid values.',
    good: `external_ref uuid NOT NULL`,
    bad: `external_ref varchar(36)` },
  { rule: 'Do not expose sequential ids where enumeration is a risk',
    why: 'Sequential ids in URLs reveal volumes and invite enumeration (IDOR). Keep bigint internally and add a public uuid column if needed.',
    good: `ALTER TABLE orders ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;`,
    bad: `-- GET /api/orders/1001, /1002, /1003 ...` }
]},

{ title: 'Soft delete', rules: [
  { rule: 'Use deleted_at timestamptz, not a boolean',
    why: 'A timestamp tells you when it happened (useful for purge jobs and audits) and NULL cleanly means active.',
    good: `ALTER TABLE customers ADD COLUMN deleted_at timestamptz;`,
    bad: `ALTER TABLE customers ADD COLUMN is_deleted boolean DEFAULT false;` },
  { rule: 'Make uniqueness apply only to live rows',
    why: 'Otherwise a soft-deleted customer blocks re-registration with the same email.',
    good: `CREATE UNIQUE INDEX uq_customers_email_live ON customers (lower(email)) WHERE deleted_at IS NULL;`,
    bad: `email text UNIQUE  -- deleted rows still hold the email` },
  { rule: 'Hide deleted rows behind a view or RLS policy',
    why: 'Every query that forgets WHERE deleted_at IS NULL leaks deleted data. Centralize the filter.',
    good: `CREATE VIEW active_customers AS SELECT * FROM customers WHERE deleted_at IS NULL;`,
    bad: `-- 140 queries each remembering the filter (or not)` },
  { rule: 'Index for live-row queries with partial indexes',
    why: 'If most queries read live rows, partial indexes stay small and fast as deleted rows accumulate.',
    good: `CREATE INDEX idx_customers_country_live ON customers (country) WHERE deleted_at IS NULL;`,
    bad: `` },
  { rule: 'Have a purge/archival policy; soft delete is not GDPR erasure',
    why: 'Legal erasure requests require real deletion or anonymization; soft-deleted tables also grow forever.',
    good: `DELETE FROM customers WHERE deleted_at < now() - interval '90 days';`,
    bad: `` }
]},

{ title: 'Audit columns', rules: [
  { rule: 'Add created_at and updated_at to every business table',
    why: 'They answer "when did this change?" during incidents, support incremental ETL and cost very little.',
    good: `created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()`,
    bad: `` },
  { rule: 'Maintain updated_at with a trigger, not app code',
    why: 'Scripts, admin fixes and other services forget to set it. A BEFORE UPDATE trigger is always right.',
    good: `CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();`,
    bad: `UPDATE customers SET city = 'Pune' WHERE id = 7;  -- updated_at silently stale` },
  { rule: 'Record who changed it (created_by / updated_by)',
    why: 'With connection pooling the DB user is the app user, so pass the real actor via a setting and capture it.',
    good: `SET LOCAL app.user_id = '123';
-- trigger: NEW.updated_by := current_setting('app.user_id', true)::int;`,
    bad: `updated_by text DEFAULT current_user  -- always "app_user"` },
  { rule: 'Use an audit log table for full history',
    why: 'Columns only show the latest change. A trigger writing old/new jsonb to audit_logs gives full history for compliance.',
    good: `audit_logs(id, table_name, operation, row_id, old_data jsonb, new_data jsonb, changed_by, changed_at)`,
    bad: `` }
]},

{ title: 'Version columns & optimistic locking', rules: [
  { rule: 'Add an integer version column for records edited by humans or concurrent services',
    why: 'Prevents lost updates when two users load the same record and both save, without holding database locks during user think-time.',
    good: `ALTER TABLE projects ADD COLUMN version int NOT NULL DEFAULT 1;`,
    bad: `` },
  { rule: 'Check and bump the version in the same UPDATE',
    why: 'The WHERE version = :seen makes the update a compare-and-swap. Zero rows updated means someone else changed it first.',
    good: `UPDATE projects
SET budget = 750000, version = version + 1
WHERE id = 3 AND version = 7
RETURNING version;  -- 0 rows -> conflict, reload and retry`,
    bad: `UPDATE projects SET budget = 750000 WHERE id = 3;  -- overwrites the other user's change` },
  { rule: 'Use pessimistic locks for short, hot critical sections',
    why: 'For inventory decrements or balances updated many times per second, SELECT ... FOR UPDATE in a short transaction beats retry storms.',
    good: `BEGIN;
SELECT stock FROM products WHERE id = 5 FOR UPDATE;
UPDATE products SET stock = stock - 1 WHERE id = 5;
COMMIT;`,
    bad: `` },
  { rule: 'Do not use updated_at as the version',
    why: 'Timestamps can collide within the same transaction (now() is fixed) and clocks can move. An integer counter is exact.',
    good: `WHERE id = 3 AND version = 7`,
    bad: `WHERE id = 3 AND updated_at = '2026-10-05 10:41:00+05:30'` },
  { rule: 'Surface conflicts to the user or retry idempotently',
    why: 'Optimistic locking only helps if the application handles the 0-rows case: show "record changed, reload" or merge and retry.',
    good: `-- app: if rowCount == 0 -> HTTP 409 Conflict`,
    bad: `-- app ignores rowCount; user thinks the save succeeded` }
]}
];

/* ------------------------- PRODUCTION CHECKLIST ------------------------- */
PGM.CHECKLIST = [
{ section: 'Security', items: [
  { text: 'scram-sha-256 everywhere; no trust or md5 in pg_hba.conf', detail: 'Audit with SELECT * FROM pg_hba_file_rules. Re-set passwords after switching password_encryption so hashes are upgraded.' },
  { text: 'TLS required for all remote connections', detail: 'Use hostssl lines in pg_hba.conf, ssl = on, and sslmode=verify-full in clients to prevent man-in-the-middle attacks.' },
  { text: 'No application connects as a superuser', detail: 'Apps use least-privilege roles; migrations use a separate owner role. Superuser bypasses RLS and can run shell commands via COPY PROGRAM.' },
  { text: 'Privileges granted to group roles, not individuals', detail: 'readonly / readwrite / app_owner roles plus ALTER DEFAULT PRIVILEGES make onboarding and offboarding one GRANT or REVOKE.' },
  { text: 'PUBLIC CREATE revoked on schema public', detail: 'REVOKE CREATE ON SCHEMA public FROM PUBLIC (default since PG15, but upgraded clusters still have the old grant).' },
  { text: 'Database port not exposed to the internet', detail: 'Private subnets, security groups and a bastion or VPN. Scanners find open 5432 ports within minutes.' },
  { text: 'Secrets stored in a vault, rotated regularly', detail: 'No passwords in code or config repos; rotate application passwords with overlapping dual credentials.' },
  { text: 'Row-level security or schema isolation for multi-tenant data', detail: 'Enforce tenant isolation in the database and test it with SET ROLE as the application role.' }
]},
{ section: 'Backup', items: [
  { text: 'Automated physical backups plus continuous WAL archiving', detail: 'pgBackRest or Barman (third-party tools) with PITR give recovery to any second, not just to last night.' },
  { text: 'Backups stored off-host and in another region/account', detail: 'A backup on the same server or cloud account dies with it (ransomware, account compromise, region outage).' },
  { text: 'Retention policy defined and enforced', detail: 'e.g. 7 daily, 4 weekly, 12 monthly full backups plus WAL for the PITR window; matches business and legal requirements.' },
  { text: 'Backups encrypted at rest', detail: 'Repository encryption (pgBackRest repo-cipher-type) or encrypted buckets with restricted keys.' },
  { text: 'Globals (roles) backed up alongside data', detail: 'pg_dumpall --globals-only for logical backups; physical backups already include them.' },
  { text: 'Backup success and age monitored', detail: 'Alert if no successful backup in 26 hours or if WAL archiving has failed (pg_stat_archiver.last_failed_time).' }
]},
{ section: 'Restore', items: [
  { text: 'Restores tested on a schedule, not just backups', detail: 'An untested backup is a hope. Automate a weekly restore to a scratch server and run sanity queries.' },
  { text: 'RTO and RPO measured from real restore drills', detail: 'Time the full restore including WAL replay; if it exceeds the agreed RTO, change the strategy (delta restores, standby).' },
  { text: 'PITR runbook written and rehearsed', detail: 'Who decides the target time, where recovery_target_time is set, how to verify data before promoting.' },
  { text: 'Single-table recovery procedure documented', detail: 'Restore to a side server, extract rows, copy back; never overwrite production blindly.' },
  { text: 'Post-restore steps listed', detail: 'ANALYZE, check sequences, re-enable jobs, update connection strings and DNS, verify extensions.' }
]},
{ section: 'Monitoring', items: [
  { text: 'pg_stat_statements enabled', detail: 'shared_preload_libraries = pg_stat_statements; it is the single most useful performance data source.' },
  { text: 'Metrics exported to a time-series system', detail: 'postgres_exporter + Prometheus/Grafana, or a managed equivalent, with history for capacity trends.' },
  { text: 'Connections, active sessions and idle-in-transaction tracked', detail: 'From pg_stat_activity; sudden changes are early warning signs of leaks and lock pile-ups.' },
  { text: 'Replication lag, WAL rate and slot retention tracked', detail: 'Bytes and seconds behind for every replica, plus retained WAL per slot.' },
  { text: 'Dead tuples, autovacuum activity and XID age tracked', detail: 'pg_stat_user_tables and age(datfrozenxid); wraparound is a slow-motion outage you can see coming.' },
  { text: 'Disk usage and IO latency tracked per volume', detail: 'Data, WAL and backup volumes separately, with growth projections.' },
  { text: 'track_io_timing enabled', detail: 'Low overhead on modern systems; shows IO time in EXPLAIN and pg_stat_statements.' }
]},
{ section: 'Indexes', items: [
  { text: 'All foreign key columns indexed', detail: 'Prevents full scans of child tables on parent deletes and speeds joins.' },
  { text: 'Unused indexes reviewed quarterly', detail: 'idx_scan = 0 in pg_stat_user_indexes on all nodes; drop with DROP INDEX CONCURRENTLY.' },
  { text: 'No INVALID indexes left behind', detail: 'SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid after any failed CONCURRENTLY build.' },
  { text: 'Duplicate and overlapping indexes removed', detail: 'An index on (a) is redundant if (a, b) exists, unless it is a unique constraint.' },
  { text: 'Index bloat checked on high-churn tables', detail: 'pgstatindex or bloat queries; REINDEX CONCURRENTLY when leaf density is low.' },
  { text: 'All production index changes use CONCURRENTLY', detail: 'Enforced in migration review or by a linter such as squawk (third-party tool).' }
]},
{ section: 'Vacuum', items: [
  { text: 'No manual VACUUM FULL in business hours', detail: 'It takes ACCESS EXCLUSIVE; use pg_repack for online compaction.' },
  { text: 'Large append-only tables frozen proactively', detail: 'Scheduled VACUUM (FREEZE) in quiet hours avoids emergency anti-wraparound vacuums during peak.' },
  { text: 'xmin horizon blockers monitored', detail: 'Long transactions, stale replication slots, prepared transactions and hot_standby_feedback replicas all stop vacuum removing rows.' },
  { text: 'maintenance_work_mem sized for vacuum', detail: 'e.g. 1-2GB on large servers so vacuum processes dead tuples in fewer index passes (PG17+ uses memory far more efficiently).' },
  { text: 'ANALYZE after bulk loads and restores', detail: 'Do not wait for autoanalyze; stale stats cause bad plans immediately after big loads.' }
]},
{ section: 'Autovacuum', items: [
  { text: 'Autovacuum enabled globally and never disabled per table', detail: 'Disabling it leads to bloat and eventually wraparound shutdown.' },
  { text: 'Scale factors lowered for large tables', detail: 'autovacuum_vacuum_scale_factor 0.01-0.05 on tables with tens of millions of rows.' },
  { text: 'Cost limits raised for SSD storage', detail: 'autovacuum_vacuum_cost_limit around 1000-2000 and cost_delay 2ms; defaults are tuned for old spinning disks.' },
  { text: 'Enough workers for the number of hot tables', detail: 'autovacuum_max_workers 5-10 on big systems; workers share the cost limit, so raise both together.' },
  { text: 'Autovacuum runs logged', detail: 'log_autovacuum_min_duration = 10s (or lower) shows which tables take long and why.' },
  { text: 'Insert-only tables covered', detail: 'autovacuum_vacuum_insert_threshold/scale_factor (PG13+) keep the visibility map fresh for index-only scans.' }
]},
{ section: 'Replication', items: [
  { text: 'At least one streaming replica in a different availability zone', detail: 'Protects against host and zone failure; also serves read traffic.' },
  { text: 'Replication slots with max_slot_wal_keep_size', detail: 'Slots prevent replicas falling behind WAL retention; the cap prevents a dead replica filling the primary disk.' },
  { text: 'Replica hardware equal to the primary', detail: 'A failover target that cannot handle production load is not a real failover target.' },
  { text: 'Synchronous replication where zero data loss is required', detail: 'synchronous_standby_names = ANY 1 (...) with at least two candidates so one failure does not stall writes.' },
  { text: 'Lag alerts in bytes and seconds', detail: 'Alert when replay lag exceeds what the application tolerates for read-after-write.' },
  { text: 'Logical replication tables have primary keys', detail: 'Otherwise UPDATE/DELETE cannot be replicated (or require REPLICA IDENTITY FULL, which is slow).' }
]},
{ section: 'HA', items: [
  { text: 'Automated failover with a consensus-based manager', detail: 'Patroni (third-party tool) with etcd/Consul, or a managed service. Avoid hand-rolled scripts that can cause split brain.' },
  { text: 'Fencing of the old primary', detail: 'The old primary must be stopped or isolated before a replica is promoted; Patroni uses leader locks and watchdog.' },
  { text: 'Clients reconnect to the new primary automatically', detail: 'HAProxy/PgBouncer routing, DNS with low TTL, or libpq multi-host with target_session_attrs=read-write.' },
  { text: 'Failover tested regularly', detail: 'Planned switchovers quarterly prove the tooling and measure real downtime.' },
  { text: 'Old primary rejoins with pg_rewind', detail: 'Requires wal_log_hints = on or data checksums; avoids a full re-clone.' }
]},
{ section: 'Connection pooling', items: [
  { text: 'Central pooler in front of the database', detail: 'PgBouncer (third-party tool) in transaction mode lets thousands of client connections share a few dozen server connections.' },
  { text: 'App compatible with transaction pooling', detail: 'Avoid session state: session-level SET, advisory locks, LISTEN, WITH HOLD cursors. PgBouncer 1.21+ supports protocol-level prepared statements.' },
  { text: 'Pool size based on cores, not users', detail: 'Start around 2-4 x CPU cores of active server connections and tune by measuring throughput and latency.' },
  { text: 'Pooler itself is highly available', detail: 'Run multiple PgBouncer instances behind a load balancer or as sidecars.' },
  { text: 'Pool saturation monitored', detail: 'SHOW POOLS in PgBouncer: cl_waiting and maxwait show clients queuing for a server connection.' }
]},
{ section: 'Performance', items: [
  { text: 'Memory settings sized for the host', detail: 'shared_buffers ~25% RAM, effective_cache_size ~50-75% RAM, modest work_mem, maintenance_work_mem 1-2GB.' },
  { text: 'random_page_cost lowered on SSD', detail: 'About 1.1 so the planner does not avoid useful index scans.' },
  { text: 'Checkpoints tuned', detail: 'max_wal_size large enough that checkpoints are mostly timed (pg_stat_checkpointer.num_timed), checkpoint_completion_target = 0.9.' },
  { text: 'Top queries reviewed weekly', detail: 'pg_stat_statements ordered by total_exec_time; fix the top 5.' },
  { text: 'statement_timeout set per role', detail: 'Short for OLTP app roles, longer for reporting; prevents runaway queries from consuming the server.' },
  { text: 'Large tables partitioned where retention or pruning helps', detail: 'Time-partitioned logs and events make deletes instant and keep indexes small.' }
]},
{ section: 'Logging', items: [
  { text: 'Slow queries logged', detail: 'log_min_duration_statement = 500ms (adjust to workload) or auto_explain for plans of slow queries.' },
  { text: 'log_line_prefix includes time, pid, user, db, app, client', detail: "e.g. '%m [%p] %q%u@%d app=%a client=%h ' so log lines can be traced to a source." },
  { text: 'Lock waits, temp files and checkpoints logged', detail: 'log_lock_waits = on, log_temp_files = 0, log_checkpoints = on (default since PG15).' },
  { text: 'DDL changes logged or audited', detail: "log_statement = 'ddl', or pgAudit (extension) for compliance requirements." },
  { text: 'Logs shipped centrally and rotated', detail: 'Ship to ELK/Loki/CloudWatch; never let logs fill the data volume.' },
  { text: 'Connection logging enabled', detail: 'log_connections / log_disconnections help trace pooler issues and unauthorized access attempts.' }
]},
{ section: 'Alerts', items: [
  { text: 'Database down / not accepting connections', detail: 'External pg_isready or a simple query from outside the host, paging immediately.' },
  { text: 'Disk usage above 80% on any volume', detail: 'With rate-of-growth alerts so you get days of warning, not minutes.' },
  { text: 'Replication lag and inactive slots', detail: 'Page when lag exceeds the tolerance or a slot is inactive and retaining WAL.' },
  { text: 'WAL archiving failures', detail: 'Any failure newer than the last success means your PITR window has stopped.' },
  { text: 'Transaction ID age above 500M', detail: 'Gives weeks of warning before wraparound protection kicks in.' },
  { text: 'Connections above 80% of max', detail: 'Plus idle-in-transaction sessions older than a few minutes.' },
  { text: 'Backup job failed or backup too old', detail: 'Treat as high priority: you are running without a safety net.' },
  { text: 'Alerts are actionable and linked to runbooks', detail: 'Each alert says what to check first; noisy alerts get fixed or removed.' }
]},
{ section: 'Disaster recovery', items: [
  { text: 'RPO and RTO agreed with the business', detail: 'e.g. RPO 5 minutes, RTO 1 hour. Architecture (sync replica, PITR, cross-region standby) follows from these numbers.' },
  { text: 'Cross-region copy of backups and WAL', detail: 'Survives a full region or account loss.' },
  { text: 'Cross-region standby for low RTO', detail: 'A warm standby in another region turns a multi-hour restore into a promotion.' },
  { text: 'DR drill performed at least twice a year', detail: 'Full failover to the DR site including application cutover, timed and documented.' },
  { text: 'Protection against human error', detail: 'PITR and delayed replicas (recovery_min_apply_delay) recover from DROP TABLE, which replication instantly copies.' },
  { text: 'Runbooks stored outside the primary infrastructure', detail: 'You cannot read a wiki hosted on the system that is down.' }
]},
{ section: 'Capacity planning', items: [
  { text: 'Growth trends recorded for size, connections, QPS and WAL', detail: 'Keep at least a year of history to forecast when limits are hit.' },
  { text: 'Disk sized for 6-12 months of growth plus headroom', detail: 'Include WAL bursts, temp files, and the space needed for REINDEX or pg_repack copies.' },
  { text: 'Working set fits in memory', detail: 'Watch cache hit ratio and IO; plan RAM upgrades before the hit ratio drops.' },
  { text: 'Integer key exhaustion checked', detail: 'Compare sequence last_value to the column type limit; int4 keys near 2.1B need a migration plan.' },
  { text: 'Read scaling plan', detail: 'Replicas, caching, or sharding (e.g. Citus extension) decided before the primary saturates.' }
]},
{ section: 'Migration', items: [
  { text: 'Schema migrations versioned and reviewed', detail: 'Flyway, Liquibase, Sqitch or framework migrations (third-party tools); no manual DDL in production.' },
  { text: 'Every migration sets lock_timeout', detail: "SET lock_timeout = '3s' with retries, so DDL never blocks traffic for long." },
  { text: 'Expand/contract for breaking changes', detail: 'Add new column, backfill in batches, deploy code using both, switch, then drop old column in a later release.' },
  { text: 'Large backfills batched', detail: 'Update 5-50k rows per transaction with pauses to limit lock time, WAL bursts and replication lag.' },
  { text: 'Major-version upgrades rehearsed', detail: 'pg_upgrade --link or logical replication, tested on a copy with extension versions checked and ANALYZE afterwards.' },
  { text: 'Rollback plan for every migration', detail: 'Know whether a migration is reversible; take a backup or snapshot before irreversible ones.' }
]},
{ section: 'Deployment', items: [
  { text: 'Infrastructure and config as code', detail: 'postgresql.conf, pg_hba.conf, roles and extensions managed by Ansible/Terraform/Kubernetes operators.' },
  { text: 'Minor releases applied promptly', detail: 'Minor versions are bug and security fixes only; apply them quarterly at least, via replica-first rolling restarts.' },
  { text: 'Data checksums enabled', detail: 'Default for new clusters in PG18; detects storage corruption early.' },
  { text: 'Separate volumes for data, WAL and logs', detail: 'Isolates IO patterns and prevents logs filling the data disk.' },
  { text: 'OS tuned for PostgreSQL', detail: 'Transparent huge pages off, huge_pages configured, vm.swappiness low, vm.overcommit_memory = 2, XFS or ext4 with noatime.' },
  { text: 'Staging mirrors production', detail: 'Same major version, extensions, settings and representative data volume so plans and migration timings match.' },
  { text: 'Change windows and approvals for risky operations', detail: 'Restarts, major upgrades and large migrations scheduled with rollback steps and an owner on call.' }
]}
];
