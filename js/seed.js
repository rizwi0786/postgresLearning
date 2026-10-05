/* =====================================================================
   company_db — the shared example database used throughout the course.
   This exact script runs inside the in-browser PostgreSQL engine
   (PGlite = real PostgreSQL compiled to WebAssembly) when the
   learner clicks "Create sample database", and you can also run it
   unchanged in psql against your own PostgreSQL server.
   Data is deterministic (setseed) so every learner sees the same rows.
   ===================================================================== */
window.PGM = window.PGM || {};
PGM.SEED_SQL = `
DROP TABLE IF EXISTS audit_logs, users, documents, payments, order_items, orders,
  products, customers, employee_projects, projects, employees, departments CASCADE;

SELECT setseed(0.42);

CREATE TABLE departments (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  location    TEXT NOT NULL,
  budget      NUMERIC(12,2) NOT NULL CHECK (budget >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employees (
  id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  department_id  INT REFERENCES departments(id),
  manager_id     INT REFERENCES employees(id),
  job_title      TEXT NOT NULL,
  salary         NUMERIC(10,2) NOT NULL CHECK (salary > 0),
  hire_date      DATE NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE projects (
  id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           TEXT NOT NULL,
  department_id  INT NOT NULL REFERENCES departments(id),
  start_date     DATE NOT NULL,
  end_date       DATE,
  budget         NUMERIC(12,2) NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('planned','active','completed','on_hold'))
);

CREATE TABLE employee_projects (
  employee_id     INT REFERENCES employees(id) ON DELETE CASCADE,
  project_id      INT REFERENCES projects(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  allocation_pct  INT NOT NULL CHECK (allocation_pct BETWEEN 1 AND 100),
  PRIMARY KEY (employee_id, project_id)
);

CREATE TABLE customers (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  country     TEXT NOT NULL,
  city        TEXT NOT NULL,
  segment     TEXT NOT NULL CHECK (segment IN ('consumer','smb','enterprise')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock       INT NOT NULL DEFAULT 0,
  attributes  JSONB NOT NULL DEFAULT '{}',
  tags        TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id   INT NOT NULL REFERENCES customers(id),
  status        TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','delivered','cancelled')),
  order_date    TIMESTAMPTZ NOT NULL,
  total_amount  NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE order_items (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INT NOT NULL REFERENCES products(id),
  quantity    INT NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(10,2) NOT NULL
);

CREATE TABLE payments (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id  BIGINT NOT NULL REFERENCES orders(id),
  amount    NUMERIC(12,2) NOT NULL,
  method    TEXT NOT NULL CHECK (method IN ('card','upi','netbanking','wallet','cod')),
  status    TEXT NOT NULL CHECK (status IN ('success','failed','refunded')),
  paid_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE documents (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  category    TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  search      TSVECTOR GENERATED ALWAYS AS
              (setweight(to_tsvector('english', title), 'A') ||
               setweight(to_tsvector('english', body), 'B')) STORED
);

CREATE TABLE users (
  id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','manager','analyst','viewer')),
  tenant_id      INT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  TEXT NOT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_id      BIGINT,
  old_data    JSONB,
  new_data    JSONB,
  changed_by  TEXT NOT NULL DEFAULT current_user,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- departments (8) ----------
INSERT INTO departments (name, location, budget) VALUES
 ('Engineering','Bengaluru',5200000),('Sales','Mumbai',2100000),
 ('Marketing','Delhi',1400000),('Finance','Gurugram',900000),
 ('HR','Pune',600000),('Operations','Chennai',1800000),
 ('Support','Hyderabad',750000),('Research','Bengaluru',2500000);

-- ---------- employees (200) ----------
-- first 8 employees are department heads (no manager)
INSERT INTO employees (first_name,last_name,email,department_id,manager_id,job_title,salary,hire_date)
SELECT fn, ln, lower(fn||'.'||ln||g)||'@company.com', g, NULL, 'Head of Department',
       (180000 + g*7500)::numeric(10,2), DATE '2014-01-15' + g*40
FROM generate_series(1,8) g,
LATERAL (SELECT (ARRAY['Asha','Rohan','Meera','Vikram','Priya','Arjun','Kavya','Nikhil'])[g] fn,
                (ARRAY['Rao','Mehta','Iyer','Singh','Nair','Kapoor','Reddy','Joshi'])[g] ln) n;

INSERT INTO employees (first_name,last_name,email,department_id,manager_id,job_title,salary,hire_date,is_active)
SELECT fn, ln, lower(fn||'.'||ln||g)||'@company.com', d, d,
       (ARRAY['Engineer','Senior Engineer','Analyst','Associate','Lead','Specialist'])[1 + (g % 6)],
       round((40000 + random()*110000)::numeric, -2),
       DATE '2016-01-01' + (random()*3500)::int,
       random() > 0.08
FROM generate_series(9,200) g,
LATERAL (SELECT 1 + (g % 8) d,
  (ARRAY['Aarav','Diya','Kabir','Isha','Reyansh','Ananya','Vihaan','Saanvi','Aditya','Myra',
         'Sai','Anika','Ishaan','Tara','Dev','Zara','Rahul','Neha','Karan','Pooja'])[1 + (g % 20)] fn,
  (ARRAY['Sharma','Verma','Gupta','Patel','Das','Khan','Bose','Menon','Pillai','Chopra',
         'Malhotra','Saxena','Bhat','Kulkarni','Agarwal'])[1 + ((g*7) % 15)] ln) n;

-- a second management layer: every 10th employee reports to the previous team lead
UPDATE employees e SET manager_id = e.id - 8
WHERE e.id > 16 AND e.id % 10 = 0;

-- ---------- projects (24) + assignments ----------
INSERT INTO projects (name, department_id, start_date, end_date, budget, status)
SELECT 'Project '||(ARRAY['Atlas','Borealis','Comet','Delta','Eclipse','Falcon','Galaxy','Helix',
  'Ion','Jupiter','Kestrel','Lumen','Meteor','Nova','Orion','Pulsar','Quasar','Raptor',
  'Sirius','Titan','Umbra','Vega','Willow','Zenith'])[g],
  1 + (g % 8), DATE '2024-01-01' + g*21,
  CASE WHEN g % 4 = 0 THEN DATE '2024-01-01' + g*21 + 180 END,
  (100000 + g*25000)::numeric(12,2),
  (ARRAY['planned','active','completed','on_hold'])[1 + (g % 4)]
FROM generate_series(1,24) g;

INSERT INTO employee_projects (employee_id, project_id, role, allocation_pct)
SELECT DISTINCT ON (e, p) e, p,
  (ARRAY['contributor','reviewer','lead'])[1 + (e % 3)], (ARRAY[25,50,75,100])[1 + (e % 4)]
FROM (SELECT g AS e, 1 + ((g*5) % 24) AS p FROM generate_series(9,200) g
      UNION ALL
      SELECT g, 1 + ((g*11) % 24) FROM generate_series(9,200,2) g) x;

-- ---------- customers (500) ----------
INSERT INTO customers (name, email, country, city, segment, created_at)
SELECT 'Customer '||g, 'customer'||g||'@example.com', c.country, c.city,
       (ARRAY['consumer','consumer','smb','enterprise'])[1 + (g % 4)],
       TIMESTAMPTZ '2023-01-01' + (random()*900) * INTERVAL '1 day'
FROM generate_series(1,500) g,
LATERAL (SELECT (ARRAY['India','India','India','USA','UK','Germany','Singapore','UAE'])[1 + (g % 8)] country,
                (ARRAY['Delhi','Mumbai','Bengaluru','New York','London','Berlin','Singapore','Dubai'])[1 + (g % 8)] city) c;

-- ---------- products (100) ----------
INSERT INTO products (sku, name, category, price, stock, attributes, tags)
SELECT 'SKU-'||lpad(g::text,4,'0'),
       (ARRAY['Laptop','Monitor','Keyboard','Mouse','Headset','Webcam','Desk','Chair','Router','SSD'])[1 + (g % 10)]
         ||' '||(ARRAY['Pro','Air','Max','Lite','Plus'])[1 + (g % 5)]||' '||g,
       (ARRAY['electronics','electronics','accessories','accessories','audio','video','furniture','furniture','networking','storage'])[1 + (g % 10)],
       round((199 + random()*80000)::numeric, 2),
       (random()*500)::int,
       jsonb_build_object('brand', (ARRAY['Acme','Zenit','Orbit','Nimbus'])[1 + (g % 4)],
                          'color', (ARRAY['black','silver','white'])[1 + (g % 3)],
                          'warranty_months', (ARRAY[6,12,24])[1 + (g % 3)],
                          'specs', jsonb_build_object('weight_kg', round((0.2 + random()*15)::numeric,1))),
       CASE WHEN g % 3 = 0 THEN ARRAY['bestseller','office'] WHEN g % 3 = 1 THEN ARRAY['new'] ELSE ARRAY['office','sale'] END
FROM generate_series(1,100) g;

-- ---------- orders (5000) ----------
INSERT INTO orders (customer_id, status, order_date)
SELECT 1 + (random()*499)::int,
       (ARRAY['pending','paid','shipped','delivered','delivered','delivered','cancelled'])[1 + (random()*6)::int],
       TIMESTAMPTZ '2024-01-01' + (random()*640) * INTERVAL '1 day'
FROM generate_series(1,5000);

-- ---------- order_items (1-4 per order) ----------
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT o.id, p.id, 1 + (random()*3)::int, p.price
FROM orders o
CROSS JOIN LATERAL generate_series(1, 1 + (o.id % 4)) n
JOIN products p ON p.id = 1 + ((o.id * 13 + n * 7) % 100);

UPDATE orders o SET total_amount = s.total
FROM (SELECT order_id, sum(quantity * unit_price) total FROM order_items GROUP BY order_id) s
WHERE s.order_id = o.id;

-- ---------- payments ----------
INSERT INTO payments (order_id, amount, method, status, paid_at)
SELECT id, total_amount,
       (ARRAY['card','upi','upi','netbanking','wallet','cod'])[1 + (id % 6)],
       CASE WHEN status = 'cancelled' THEN 'refunded' WHEN id % 29 = 0 THEN 'failed' ELSE 'success' END,
       order_date + INTERVAL '2 hours'
FROM orders WHERE status <> 'pending';

-- ---------- documents (24) for full-text search / RAG lessons ----------
INSERT INTO documents (title, body, category, metadata) VALUES
('Indexing strategies for PostgreSQL','B-tree indexes speed up equality and range lookups. Composite indexes follow the leftmost prefix rule. Partial indexes cover a subset of rows.','database','{"author":"Asha","level":"intermediate","tags":["index","btree"]}'),
('Understanding MVCC','PostgreSQL keeps multiple row versions so readers never block writers. Old versions become dead tuples that vacuum removes.','database','{"author":"Rohan","level":"advanced","tags":["mvcc","vacuum"]}'),
('Write-Ahead Logging explained','Every change is first written to the WAL so the database can recover after a crash and replicate to standbys.','database','{"author":"Meera","level":"advanced","tags":["wal","durability"]}'),
('Getting started with JSONB','JSONB stores JSON in a decomposed binary format that supports GIN indexing and containment queries with the @> operator.','database','{"author":"Vikram","level":"beginner","tags":["jsonb"]}'),
('Scaling reads with replicas','Streaming replication ships WAL to standby servers that can serve read-only queries and take over during failover.','architecture','{"author":"Priya","level":"advanced","tags":["replication","ha"]}'),
('Connection pooling with PgBouncer','Each PostgreSQL connection is a process. A pooler multiplexes thousands of client connections onto a small server pool.','architecture','{"author":"Arjun","level":"intermediate","tags":["pooling"]}'),
('Vector search with pgvector','pgvector adds a vector type and HNSW or IVFFlat indexes so you can run semantic similarity search next to relational data.','ai','{"author":"Kavya","level":"advanced","tags":["pgvector","ai"]}'),
('Retrieval augmented generation','RAG retrieves relevant chunks from a knowledge base and passes them to a large language model as context for the answer.','ai','{"author":"Nikhil","level":"intermediate","tags":["rag","llm"]}'),
('Partitioning large tables','Range partitioning by month lets the planner prune partitions and lets you drop old data instantly.','database','{"author":"Asha","level":"advanced","tags":["partitioning"]}'),
('Row level security for SaaS','Policies filter rows by tenant_id so every tenant sees only its own data even through shared tables.','security','{"author":"Rohan","level":"advanced","tags":["rls","multi-tenant"]}'),
('Backup and point in time recovery','Combine a base backup with archived WAL to restore a cluster to any moment before an accident.','operations','{"author":"Meera","level":"advanced","tags":["backup","pitr"]}'),
('Reading EXPLAIN ANALYZE output','Compare estimated rows with actual rows. Large differences point to stale statistics or correlated columns.','performance','{"author":"Vikram","level":"intermediate","tags":["explain"]}'),
('Window functions for reporting','ROW_NUMBER, RANK and running totals with SUM OVER let you build reports without self joins.','sql','{"author":"Priya","level":"intermediate","tags":["window"]}'),
('Recursive CTEs for hierarchies','WITH RECURSIVE walks org charts, folder trees and bill of materials structures.','sql','{"author":"Arjun","level":"intermediate","tags":["cte"]}'),
('Tuning autovacuum','Large tables need lower scale factors so autovacuum runs before bloat accumulates.','operations','{"author":"Kavya","level":"advanced","tags":["vacuum","tuning"]}'),
('Choosing a shard key','A good shard key spreads load evenly and keeps related rows together to avoid cross shard joins.','architecture','{"author":"Nikhil","level":"advanced","tags":["sharding"]}'),
('Laptop buying guide','Choose a laptop by weighing battery life, weight, display quality and processor performance.','products','{"author":"Support","level":"beginner","tags":["laptop"]}'),
('Return and refund policy','Products can be returned within 30 days. Refunds are issued to the original payment method.','policy','{"author":"Support","level":"beginner","tags":["refund"]}'),
('Shipping times','Orders ship within two business days. Delivery to metro cities takes three to five days.','policy','{"author":"Support","level":"beginner","tags":["shipping"]}'),
('Warranty claims','Hardware warranty covers manufacturing defects. Keep the invoice to file a claim.','policy','{"author":"Support","level":"beginner","tags":["warranty"]}'),
('Securing PostgreSQL connections','Use SCRAM-SHA-256 passwords, require TLS in pg_hba.conf and grant only the privileges an application needs.','security','{"author":"Asha","level":"intermediate","tags":["security","tls"]}'),
('Fuzzy matching with pg_trgm','Trigram similarity finds names and addresses even when users make typos.','database','{"author":"Rohan","level":"intermediate","tags":["pg_trgm","search"]}'),
('Monitoring with pg_stat_statements','Track total execution time per normalized query to find the statements worth optimizing first.','performance','{"author":"Meera","level":"intermediate","tags":["monitoring"]}'),
('Designing an e-commerce schema','Separate orders from order items, store the unit price at purchase time and index foreign keys.','design','{"author":"Vikram","level":"beginner","tags":["design"]}');

-- ---------- users (60, across 3 tenants) ----------
INSERT INTO users (username, email, password_hash, role, tenant_id, is_active, last_login)
SELECT 'user'||g, 'user'||g||'@tenant'||(1 + g % 3)||'.com',
       'scram-sha-256$4096:demo$hash'||g,
       (ARRAY['admin','manager','analyst','viewer','viewer'])[1 + (g % 5)],
       1 + (g % 3), g % 11 <> 0,
       TIMESTAMPTZ '2026-01-01' + (g * INTERVAL '3 days')
FROM generate_series(1,60) g;

-- ---------- audit_logs ----------
INSERT INTO audit_logs (table_name, operation, row_id, old_data, new_data, changed_by, changed_at)
SELECT 'orders', (ARRAY['INSERT','UPDATE','UPDATE','DELETE'])[1 + (g % 4)], g,
       CASE WHEN g % 4 <> 0 THEN jsonb_build_object('status','pending') END,
       CASE WHEN g % 4 <> 3 THEN jsonb_build_object('status','paid') END,
       (ARRAY['app_user','admin','batch_job'])[1 + (g % 3)],
       TIMESTAMPTZ '2026-01-01' + g * INTERVAL '1 hour'
FROM generate_series(1,300) g;

-- ---------- helpful indexes (some deliberately missing for the index lessons) ----------
CREATE INDEX idx_employees_department ON employees(department_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_documents_search ON documents USING GIN (search);

ANALYZE;
`;

/* Short human-readable schema used by the playground sidebar and lessons. */
PGM.SCHEMA = [
  { table: 'departments', rows: 8, cols: ['id int PK', 'name text UQ', 'location text', 'budget numeric', 'created_at timestamptz'] },
  { table: 'employees', rows: 200, cols: ['id int PK', 'first_name text', 'last_name text', 'email text UQ', 'department_id → departments', 'manager_id → employees', 'job_title text', 'salary numeric', 'hire_date date', 'is_active boolean'] },
  { table: 'projects', rows: 24, cols: ['id int PK', 'name text', 'department_id → departments', 'start_date date', 'end_date date', 'budget numeric', 'status text'] },
  { table: 'employee_projects', rows: '~288', cols: ['employee_id → employees', 'project_id → projects', 'role text', 'allocation_pct int'] },
  { table: 'customers', rows: 500, cols: ['id int PK', 'name text', 'email text UQ', 'country text', 'city text', 'segment text', 'created_at timestamptz'] },
  { table: 'products', rows: 100, cols: ['id int PK', 'sku text UQ', 'name text', 'category text', 'price numeric', 'stock int', 'attributes jsonb', 'tags text[]', 'created_at timestamptz'] },
  { table: 'orders', rows: 5000, cols: ['id bigint PK', 'customer_id → customers', 'status text', 'order_date timestamptz', 'total_amount numeric'] },
  { table: 'order_items', rows: '~12500', cols: ['id bigint PK', 'order_id → orders', 'product_id → products', 'quantity int', 'unit_price numeric'] },
  { table: 'payments', rows: '~4300', cols: ['id bigint PK', 'order_id → orders', 'amount numeric', 'method text', 'status text', 'paid_at timestamptz'] },
  { table: 'documents', rows: 24, cols: ['id int PK', 'title text', 'body text', 'category text', 'metadata jsonb', 'created_at timestamptz', 'search tsvector (generated)'] },
  { table: 'users', rows: 60, cols: ['id int PK', 'username text UQ', 'email text UQ', 'password_hash text', 'role text', 'tenant_id int', 'is_active boolean', 'last_login timestamptz', 'created_at timestamptz'] },
  { table: 'audit_logs', rows: 300, cols: ['id bigint PK', 'table_name text', 'operation text', 'row_id bigint', 'old_data jsonb', 'new_data jsonb', 'changed_by text', 'changed_at timestamptz'] }
];
