/* =====================================================================
   projects.js — Real-world database projects + system design problems
   PGM.PROJECTS       : 12 end-to-end schemas (DDL, data, indexes, queries)
   PGM.SYSTEM_DESIGN  : 10 database design interview problems
   Each project's ddl + sampleData + indexes + queries is executed by the
   validator in its own schema (named after the project id) on PostgreSQL 18.
   ===================================================================== */

PGM.PROJECTS = [];

/* ------------------------------------------------------------------ 1. BANKING */
PGM.PROJECTS.push({
  id: 'banking',
  title: 'Banking Database',
  icon: '₹',
  level: 3,
  summary: 'Core banking ledger: customers, accounts, idempotent transfers and an append-only double-entry ledger that always reconciles.',
  requirements: [
    'Customers (with KYC status) can hold multiple accounts of different types at a branch.',
    'Money moves only through transfers; every transfer produces exactly one debit and one credit ledger entry (double-entry bookkeeping).',
    'Account balance must never drop below the negative overdraft limit — enforced by the database, not just the app.',
    'Clients may retry a transfer request after a timeout: the same idempotency key must never move money twice.',
    'Customers need statements with a running balance; auditors need a reconciliation proving balance = sum(ledger).',
    'The ledger is append-only: corrections are made with reversing entries, never UPDATE/DELETE.'
  ],
  entities: [
    { name: 'customers', desc: 'Bank customers with PAN, contact details and KYC status.' },
    { name: 'branches', desc: 'Physical branches identified by IFSC code.' },
    { name: 'accounts', desc: 'Savings / current / FD accounts; holds the current (denormalised) balance and overdraft limit.' },
    { name: 'transfers', desc: 'One row per business operation (deposit, transfer) with a UNIQUE idempotency key.' },
    { name: 'ledger_entries', desc: 'Immutable debit/credit lines; the source of truth for balances and statements.' }
  ],
  relationships: [
    { from: 'accounts', to: 'customers', type: 'N:1', label: 'owned by' },
    { from: 'accounts', to: 'branches', type: 'N:1', label: 'held at' },
    { from: 'transfers', to: 'accounts', type: 'N:1', label: 'debits (from)' },
    { from: 'transfers', to: 'accounts', type: 'N:1', label: 'credits (to)' },
    { from: 'ledger_entries', to: 'transfers', type: 'N:1', label: 'posted by' },
    { from: 'ledger_entries', to: 'accounts', type: 'N:1', label: 'affects' }
  ],
  ddl: `CREATE TABLE customers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name   text NOT NULL,
  email       text NOT NULL UNIQUE,
  phone       text,
  pan         char(10) UNIQUE CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  kyc_status  text NOT NULL DEFAULT 'pending'
              CHECK (kyc_status IN ('pending','verified','rejected')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ifsc  char(11) NOT NULL UNIQUE,
  name  text NOT NULL,
  city  text NOT NULL
);

CREATE TABLE accounts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_no       text NOT NULL UNIQUE,
  customer_id      bigint NOT NULL REFERENCES customers(id),
  branch_id        int    NOT NULL REFERENCES branches(id),
  account_type     text   NOT NULL CHECK (account_type IN ('savings','current','fixed_deposit')),
  currency         char(3) NOT NULL DEFAULT 'INR',
  balance          numeric(18,2) NOT NULL DEFAULT 0,
  overdraft_limit  numeric(18,2) NOT NULL DEFAULT 0 CHECK (overdraft_limit >= 0),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  opened_at        timestamptz NOT NULL DEFAULT now(),
  -- the last line of defence: no code path can overdraw an account
  CONSTRAINT balance_within_overdraft CHECK (balance >= -overdraft_limit)
);

CREATE TABLE transfers (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key  uuid NOT NULL UNIQUE,           -- client-generated; retries reuse it
  kind             text NOT NULL CHECK (kind IN ('deposit','withdrawal','transfer','reversal')),
  from_account_id  bigint REFERENCES accounts(id), -- NULL for cash deposit
  to_account_id    bigint REFERENCES accounts(id), -- NULL for cash withdrawal
  amount           numeric(18,2) NOT NULL CHECK (amount > 0),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','completed','failed','reversed')),
  reference        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (from_account_id IS DISTINCT FROM to_account_id),
  CHECK (from_account_id IS NOT NULL OR to_account_id IS NOT NULL)
);

-- Append-only double-entry ledger
CREATE TABLE ledger_entries (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id    bigint NOT NULL REFERENCES transfers(id),
  account_id     bigint NOT NULL REFERENCES accounts(id),
  entry_type     text   NOT NULL CHECK (entry_type IN ('debit','credit')),
  amount         numeric(18,2) NOT NULL CHECK (amount > 0),
  balance_after  numeric(18,2) NOT NULL,
  narration      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, account_id, entry_type)
);`,
  sampleData: `INSERT INTO customers (full_name, email, phone, pan, kyc_status, created_at) VALUES
 ('Aarav Sharma',  'aarav@example.in',  '+91-9810000001', 'ABCPS1234K', 'verified', '2025-01-05'),
 ('Priya Nair',    'priya@example.in',  '+91-9810000002', 'BCDPN2345L', 'verified', '2025-01-09'),
 ('Rohan Gupta',   'rohan@example.in',  '+91-9810000003', 'CDEPG3456M', 'verified', '2025-02-11'),
 ('Meera Iyer',    'meera@example.in',  '+91-9810000004', 'DEFPI4567N', 'verified', '2025-02-20'),
 ('Kabir Traders', 'accounts@kabir.in', '+91-9810000005', 'EFGPK5678P', 'verified', '2025-03-01');

INSERT INTO branches (ifsc, name, city) VALUES
 ('RODB0000101', 'Cyber City',      'Gurugram'),
 ('RODB0000202', 'Andheri East',    'Mumbai'),
 ('RODB0000303', 'Koramangala',     'Bengaluru');

INSERT INTO accounts (account_no, customer_id, branch_id, account_type, balance, overdraft_limit, opened_at) VALUES
 ('50100000000001', 1, 1, 'savings',  70000.00,     0, '2025-01-05'),
 ('50100000000002', 2, 2, 'savings', 123000.00,     0, '2025-01-09'),
 ('50100000000003', 3, 3, 'savings',  80000.00,     0, '2025-02-11'),
 ('50100000000004', 4, 1, 'savings', 185000.00,     0, '2025-02-20'),
 ('50100000000005', 1, 1, 'current',  32000.00, 50000, '2025-03-01'),
 ('50100000000006', 5, 2, 'current', 485000.00, 200000, '2025-03-01');

-- 6 opening deposits + 5 transfers (balances above are the result of these)
INSERT INTO transfers (idempotency_key, kind, from_account_id, to_account_id, amount, status, reference, created_at) VALUES
 (gen_random_uuid(), 'deposit',  NULL, 1,  50000, 'completed', 'Opening deposit', '2025-03-02 10:00+05:30'),
 (gen_random_uuid(), 'deposit',  NULL, 2, 120000, 'completed', 'Opening deposit', '2025-03-02 10:05+05:30'),
 (gen_random_uuid(), 'deposit',  NULL, 3,  75000, 'completed', 'Opening deposit', '2025-03-02 10:10+05:30'),
 (gen_random_uuid(), 'deposit',  NULL, 4, 200000, 'completed', 'Opening deposit', '2025-03-02 10:15+05:30'),
 (gen_random_uuid(), 'deposit',  NULL, 5,  30000, 'completed', 'Opening deposit', '2025-03-02 10:20+05:30'),
 (gen_random_uuid(), 'deposit',  NULL, 6, 500000, 'completed', 'Opening deposit', '2025-03-02 10:25+05:30'),
 (gen_random_uuid(), 'transfer', 1, 2,   5000, 'completed', 'Dinner split',    '2025-03-05 20:15+05:30'),
 (gen_random_uuid(), 'transfer', 4, 1,  25000, 'completed', 'Loan repayment',  '2025-03-07 09:30+05:30'),
 (gen_random_uuid(), 'transfer', 6, 3,  15000, 'completed', 'Salary March',    '2025-03-31 18:00+05:30'),
 (gen_random_uuid(), 'transfer', 2, 5,   2000, 'completed', 'Invoice 1189',    '2025-04-02 11:45+05:30'),
 (gen_random_uuid(), 'transfer', 3, 4,  10000, 'completed', 'Rent April',      '2025-04-03 08:00+05:30');

INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount, balance_after, narration, created_at) VALUES
 (1, 1, 'credit',  50000,  50000, 'Cash deposit',          '2025-03-02 10:00+05:30'),
 (2, 2, 'credit', 120000, 120000, 'Cash deposit',          '2025-03-02 10:05+05:30'),
 (3, 3, 'credit',  75000,  75000, 'Cash deposit',          '2025-03-02 10:10+05:30'),
 (4, 4, 'credit', 200000, 200000, 'Cash deposit',          '2025-03-02 10:15+05:30'),
 (5, 5, 'credit',  30000,  30000, 'Cash deposit',          '2025-03-02 10:20+05:30'),
 (6, 6, 'credit', 500000, 500000, 'Cash deposit',          '2025-03-02 10:25+05:30'),
 (7, 1, 'debit',    5000,  45000, 'To Priya: Dinner split','2025-03-05 20:15+05:30'),
 (7, 2, 'credit',   5000, 125000, 'From Aarav: Dinner split','2025-03-05 20:15+05:30'),
 (8, 4, 'debit',   25000, 175000, 'To Aarav: Loan repayment','2025-03-07 09:30+05:30'),
 (8, 1, 'credit',  25000,  70000, 'From Meera: Loan repayment','2025-03-07 09:30+05:30'),
 (9, 6, 'debit',   15000, 485000, 'Salary to Rohan',       '2025-03-31 18:00+05:30'),
 (9, 3, 'credit',  15000,  90000, 'Salary from Kabir Traders','2025-03-31 18:00+05:30'),
 (10, 2, 'debit',   2000, 123000, 'To Aarav (current): Invoice 1189','2025-04-02 11:45+05:30'),
 (10, 5, 'credit',  2000,  32000, 'From Priya: Invoice 1189','2025-04-02 11:45+05:30'),
 (11, 3, 'debit',  10000,  80000, 'To Meera: Rent April',  '2025-04-03 08:00+05:30'),
 (11, 4, 'credit', 10000, 185000, 'From Rohan: Rent April','2025-04-03 08:00+05:30');`,
  indexes: `-- Statements read one account's entries in time order: (account_id, created_at, id)
-- serves WHERE account_id = ? ORDER BY created_at, id with no sort and supports keyset pagination.
CREATE INDEX idx_ledger_account_time ON ledger_entries (account_id, created_at, id);

-- FK columns are NOT indexed automatically in PostgreSQL. Without these, deleting/locking a
-- parent row must seq-scan the child, and "transfers of account X" queries scan everything.
CREATE INDEX idx_accounts_customer   ON accounts (customer_id);
CREATE INDEX idx_transfers_from      ON transfers (from_account_id, created_at);
CREATE INDEX idx_transfers_to        ON transfers (to_account_id, created_at);

-- Operations dashboards poll for stuck transfers; only a tiny fraction is pending,
-- so a partial index stays small and hot in cache.
CREATE INDEX idx_transfers_pending ON transfers (created_at) WHERE status = 'pending';`,
  queries: [
    {
      title: 'Account statement with running balance (window function)',
      sql: `SELECT le.created_at::date AS txn_date,
       le.narration,
       CASE WHEN le.entry_type = 'debit'  THEN le.amount END AS withdrawal,
       CASE WHEN le.entry_type = 'credit' THEN le.amount END AS deposit,
       SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE -le.amount END)
         OVER (ORDER BY le.created_at, le.id) AS running_balance,
       le.balance_after
FROM ledger_entries le
WHERE le.account_id = 1
ORDER BY le.created_at, le.id;`,
      explain: 'The running SUM window recomputes the balance purely from the ledger; it must equal the stored balance_after on every line. The ORDER BY (created_at, id) is deterministic (id breaks ties) and is served directly by idx_ledger_account_time, so no sort is needed even for accounts with millions of entries.'
    },
    {
      title: 'Reconciliation: stored balance vs. ledger (should return zero rows)',
      sql: `WITH ledger AS (
  SELECT account_id,
         SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) AS ledger_balance
  FROM ledger_entries
  GROUP BY account_id
)
SELECT a.account_no, a.balance AS stored_balance,
       COALESCE(l.ledger_balance, 0) AS ledger_balance,
       a.balance - COALESCE(l.ledger_balance, 0) AS drift
FROM accounts a
LEFT JOIN ledger l ON l.account_id = a.id
WHERE a.balance <> COALESCE(l.ledger_balance, 0);`,
      explain: 'accounts.balance is a denormalised cache for fast reads; the ledger is the truth. Banks run this nightly (and also verify that per transfer SUM(debits) = SUM(credits)). Any row returned is an incident. LEFT JOIN + COALESCE catches accounts that have a balance but no ledger lines at all.'
    },
    {
      title: 'Double-entry integrity: every transfer must balance',
      sql: `SELECT t.id, t.kind, t.amount,
       SUM(le.amount) FILTER (WHERE le.entry_type = 'debit')  AS debits,
       SUM(le.amount) FILTER (WHERE le.entry_type = 'credit') AS credits
FROM transfers t
JOIN ledger_entries le ON le.transfer_id = t.id
WHERE t.kind = 'transfer'
GROUP BY t.id, t.kind, t.amount
HAVING SUM(le.amount) FILTER (WHERE le.entry_type = 'debit')
       IS DISTINCT FROM SUM(le.amount) FILTER (WHERE le.entry_type = 'credit');`,
      explain: 'FILTER (WHERE ...) is the SQL-standard way to compute conditional aggregates in one pass. IS DISTINCT FROM treats NULL safely: a transfer that has a debit but no credit (NULL) is still reported. Expected result: zero rows.'
    },
    {
      title: 'Velocity check: debits per customer per day vs. their 30-day average',
      sql: `WITH daily AS (
  SELECT a.customer_id, le.created_at::date AS d, SUM(le.amount) AS debit_total, COUNT(*) AS n
  FROM ledger_entries le
  JOIN accounts a ON a.id = le.account_id
  WHERE le.entry_type = 'debit'
  GROUP BY a.customer_id, le.created_at::date
)
SELECT c.full_name, d, debit_total, n,
       ROUND(AVG(debit_total) OVER w, 2) AS avg_prev_30d,
       COALESCE(debit_total > 3 * AVG(debit_total) OVER w, false) AS suspicious
FROM daily
JOIN customers c ON c.id = daily.customer_id
WINDOW w AS (PARTITION BY customer_id ORDER BY d
             RANGE BETWEEN INTERVAL '30 days' PRECEDING AND INTERVAL '1 day' PRECEDING)
ORDER BY c.full_name, d;`,
      explain: 'A RANGE frame with interval offsets (PostgreSQL 11+) looks back 30 calendar days excluding today, regardless of how many rows exist per day. With no history the comparison is NULL, which COALESCE turns into false (no baseline, no alert). Fraud and AML rules commonly flag days whose debit total exceeds a multiple of the customer baseline. The named WINDOW clause avoids repeating the frame definition.'
    },
    {
      title: 'Month-end closing balance per account (DISTINCT ON)',
      sql: `SELECT DISTINCT ON (le.account_id, date_trunc('month', le.created_at))
       a.account_no,
       to_char(date_trunc('month', le.created_at), 'YYYY-MM') AS month,
       le.balance_after AS closing_balance
FROM ledger_entries le
JOIN accounts a ON a.id = le.account_id
ORDER BY le.account_id, date_trunc('month', le.created_at), le.created_at DESC, le.id DESC;`,
      explain: 'DISTINCT ON (PostgreSQL extension to SQL) keeps the first row of each (account, month) group according to ORDER BY — here the latest entry of the month, whose balance_after is the closing balance. This is how interest calculation and regulatory month-end reports read balances without scanning a separate snapshot table.'
    },
    {
      title: 'Top customers by total relationship value (RANK + share of book)',
      sql: `SELECT c.full_name,
       COUNT(a.id) AS accounts,
       SUM(a.balance) AS total_balance,
       RANK() OVER (ORDER BY SUM(a.balance) DESC) AS rnk,
       ROUND(100.0 * SUM(a.balance) / SUM(SUM(a.balance)) OVER (), 2) AS pct_of_deposits
FROM customers c
JOIN accounts a ON a.customer_id = c.id AND a.status = 'active'
GROUP BY c.id, c.full_name
ORDER BY rnk;`,
      explain: 'Window functions run after GROUP BY, so SUM(SUM(a.balance)) OVER () is the grand total of the grouped sums — a neat way to compute percentage of total without a second query. Relationship managers use this to prioritise high-value clients.'
    }
  ],
  transactions: `-- Money transfer as a single PL/pgSQL function (one transaction, called by the API).
-- Guarantees: idempotent, deadlock-free, never overdraws, ledger always balances.
CREATE OR REPLACE FUNCTION transfer_funds(p_key uuid, p_from bigint, p_to bigint,
                                          p_amount numeric, p_ref text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_transfer_id bigint;
  v_from_bal    numeric;
  v_to_bal      numeric;
BEGIN
  IF p_amount <= 0 OR p_from = p_to THEN
    RAISE EXCEPTION 'invalid transfer';
  END IF;

  -- 1. Idempotency: a retry with the same key returns the original transfer.
  INSERT INTO transfers (idempotency_key, kind, from_account_id, to_account_id, amount, reference)
  VALUES (p_key, 'transfer', p_from, p_to, p_amount, p_ref)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_transfer_id;
  IF v_transfer_id IS NULL THEN
    SELECT id INTO v_transfer_id FROM transfers WHERE idempotency_key = p_key;
    RETURN v_transfer_id;          -- already processed (or in flight in another txn)
  END IF;

  -- 2. Lock BOTH rows in a consistent order (lowest id first).
  --    A->B and B->A running concurrently now queue instead of deadlocking.
  PERFORM 1 FROM accounts WHERE id IN (p_from, p_to) ORDER BY id FOR UPDATE;

  -- 3. Guarded debit: zero rows updated = insufficient funds or inactive account.
  UPDATE accounts SET balance = balance - p_amount
  WHERE id = p_from AND status = 'active' AND balance - p_amount >= -overdraft_limit
  RETURNING balance INTO v_from_bal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient funds or account not active' USING ERRCODE = 'P0001';
  END IF;

  UPDATE accounts SET balance = balance + p_amount
  WHERE id = p_to AND status = 'active'
  RETURNING balance INTO v_to_bal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'destination account not active';
  END IF;

  -- 4. Double-entry ledger lines.
  INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount, balance_after, narration)
  VALUES (v_transfer_id, p_from, 'debit',  p_amount, v_from_bal, 'Transfer out: ' || coalesce(p_ref, '')),
         (v_transfer_id, p_to,   'credit', p_amount, v_to_bal,   'Transfer in: '  || coalesce(p_ref, ''));

  UPDATE transfers SET status = 'completed' WHERE id = v_transfer_id;
  RETURN v_transfer_id;
END;
$$;

-- Usage (any exception rolls back everything, including the transfers row,
-- so the client can safely retry with the same key):
BEGIN;
SELECT transfer_funds('7b0c6a52-3f0e-4a8e-9d41-2b9c1f6e8a10', 1, 2, 1500.00, 'Rent share');
COMMIT;`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Hot accounts</strong>: a merchant or payroll account receiving thousands of credits per second serialises on its row lock (<code>FOR UPDATE</code>). Fix: split it into N sub-accounts ("bucket balances") and pick one at random for credits, or post credits to the ledger only and fold them into <code>balance</code> asynchronously in batches.</li>
<li><strong>Ledger growth</strong>: <code>ledger_entries</code> grows forever (append-only). At 10M entries/day it is the biggest table by far.</li>
</ul>
<h4>Partitioning <span class="tag core">core</span></h4>
<p>Range-partition <code>ledger_entries</code> (and <code>transfers</code>) by <code>created_at</code> monthly. Statements for "last 90 days" prune to 3 partitions; old partitions can be detached and moved to cheaper storage or a tablespace on slower disks. Note: a UNIQUE constraint on a partitioned table must include the partition key, so the PK becomes <code>(id, created_at)</code>.</p>
<h4>Archiving</h4>
<ul>
<li>Regulators typically require 8-10 years of retention. Keep 13-24 months online; <code>ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY</code> older months and archive them (pg_dump of the partition, or export to Parquet in object storage).</li>
<li>Store monthly <em>balance snapshots</em> so statements never need to replay years of history.</li>
</ul>
<h4>At 100x scale</h4>
<ul>
<li>Shard by <code>account_id</code> (or customer_id) — a transfer between two shards then needs a saga or two-phase protocol with a "funds in transit" suspense account; most banks keep the core ledger on one vertically-scaled primary as long as possible precisely to avoid this.</li>
<li>Read replicas for statements and analytics; never read balance for a debit decision from a replica (replication lag).</li>
<li>Connection pooling with <span class="tag tool">third-party tool</span> PgBouncer in transaction mode; keep transactions short — no network calls inside the transfer transaction.</li>
</ul>`,
  advanced: `<h4>Why numeric, never float</h4>
<p><code>numeric(18,2)</code> stores exact decimal values. <code>double precision</code> cannot represent 0.10 exactly; summing millions of entries drifts by paise and reconciliation fails. Alternatively store integer paise in <code>bigint</code> (faster arithmetic, exact).</p>
<h4>Isolation level choice</h4>
<p>The transfer above is correct under the default READ COMMITTED because every decision is made on a <strong>locked</strong> row (<code>FOR UPDATE</code>) or inside a single guarded <code>UPDATE ... WHERE balance - x &gt;= -overdraft_limit</code>. Under SERIALIZABLE you could drop explicit locks but must retry on SQLSTATE <code>40001</code>.</p>
<h4>Immutability</h4>
<ul>
<li><code>REVOKE UPDATE, DELETE ON ledger_entries FROM app_role;</code> plus a <code>BEFORE UPDATE OR DELETE</code> trigger that raises — the app can only append.</li>
<li>Reversals are new transfers of kind <code>reversal</code> that post opposite entries and set the original to <code>reversed</code>.</li>
<li>Hash-chain entries (store <code>sha256(prev_hash || row)</code> via <span class="tag ext">extension</span> pgcrypto's <code>digest()</code>, or core <code>sha256()</code> on bytea) to make tampering detectable.</li>
</ul>
<div class="callout warn">Never compute "available balance" from a read replica or a cached value for a debit decision. Lag of even 200 ms lets two concurrent withdrawals both pass the check.</div>`
});

/* ------------------------------------------------------------------ 2. E-COMMERCE */
PGM.PROJECTS.push({
  id: 'ecommerce',
  title: 'E-commerce Database',
  icon: '🛒',
  level: 3,
  summary: 'Catalog with category tree and JSONB attributes, inventory reservations that cannot oversell, orders with price snapshots, payments and reviews.',
  requirements: [
    'Hierarchical categories (Electronics > Audio > Headphones) of arbitrary depth.',
    'Products have common columns plus category-specific attributes (colour, size, wattage) that vary per category.',
    'Inventory per warehouse; stock reserved at checkout must never go negative (no overselling under concurrency).',
    'Orders keep a snapshot of the price paid — later price changes must not alter historical orders.',
    'Multiple payment attempts per order (a failed card, then UPI success).',
    'One review per customer per product, rating 1-5, only for purchased products (enforced in app/trigger).'
  ],
  entities: [
    { name: 'customers', desc: 'Shoppers; email is unique case-insensitively.' },
    { name: 'addresses', desc: 'Shipping/billing addresses, many per customer.' },
    { name: 'categories', desc: 'Self-referencing category tree (adjacency list).' },
    { name: 'products', desc: 'Catalog item: SKU, list price, JSONB attributes, active flag.' },
    { name: 'warehouses', desc: 'Fulfilment centres.' },
    { name: 'inventory', desc: 'Stock per (product, warehouse): on_hand and reserved.' },
    { name: 'orders', desc: 'Order header: customer, address, status, money totals.' },
    { name: 'order_items', desc: 'Lines with quantity and unit_price snapshot.' },
    { name: 'payments', desc: 'Payment attempts with provider reference and status.' },
    { name: 'reviews', desc: 'Product ratings and comments.' }
  ],
  relationships: [
    { from: 'addresses', to: 'customers', type: 'N:1', label: 'belongs to' },
    { from: 'categories', to: 'categories', type: 'N:1', label: 'child of' },
    { from: 'products', to: 'categories', type: 'N:1', label: 'classified in' },
    { from: 'inventory', to: 'products', type: 'N:1', label: 'stock of' },
    { from: 'inventory', to: 'warehouses', type: 'N:1', label: 'stored at' },
    { from: 'orders', to: 'customers', type: 'N:1', label: 'placed by' },
    { from: 'orders', to: 'addresses', type: 'N:1', label: 'ships to' },
    { from: 'order_items', to: 'orders', type: 'N:1', label: 'line of' },
    { from: 'order_items', to: 'products', type: 'N:1', label: 'sells' },
    { from: 'payments', to: 'orders', type: 'N:1', label: 'pays' },
    { from: 'reviews', to: 'products', type: 'N:1', label: 'rates' },
    { from: 'reviews', to: 'customers', type: 'N:1', label: 'written by' }
  ],
  ddl: `CREATE TABLE customers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,
  full_name   text NOT NULL,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- case-insensitive uniqueness without the citext extension
CREATE UNIQUE INDEX uq_customers_email ON customers (lower(email));

CREATE TABLE addresses (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  line1        text NOT NULL,
  city         text NOT NULL,
  state        text NOT NULL,
  pincode      char(6) NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  is_default   boolean NOT NULL DEFAULT false
);

CREATE TABLE categories (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id  int REFERENCES categories(id),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  CHECK (parent_id <> id)
);

CREATE TABLE products (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku          text NOT NULL UNIQUE,
  name         text NOT NULL,
  category_id  int  NOT NULL REFERENCES categories(id),
  price        numeric(10,2) NOT NULL CHECK (price >= 0),
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
  id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code  text NOT NULL UNIQUE,
  city  text NOT NULL
);

CREATE TABLE inventory (
  product_id    bigint NOT NULL REFERENCES products(id),
  warehouse_id  int    NOT NULL REFERENCES warehouses(id),
  on_hand       int NOT NULL CHECK (on_hand >= 0),
  reserved      int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  PRIMARY KEY (product_id, warehouse_id),
  CONSTRAINT no_oversell CHECK (reserved <= on_hand)
);

CREATE TABLE orders (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id          bigint NOT NULL REFERENCES customers(id),
  shipping_address_id  bigint NOT NULL REFERENCES addresses(id),
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','paid','shipped','delivered','cancelled','returned')),
  subtotal             numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  discount             numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax                  numeric(12,2) NOT NULL DEFAULT 0,
  total                numeric(12,2) GENERATED ALWAYS AS (subtotal - discount + tax) STORED,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id      bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no       smallint NOT NULL,
  product_id    bigint NOT NULL REFERENCES products(id),
  warehouse_id  int    NOT NULL REFERENCES warehouses(id),
  quantity      int NOT NULL CHECK (quantity > 0),
  unit_price    numeric(10,2) NOT NULL CHECK (unit_price >= 0),   -- price snapshot
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE payments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      bigint NOT NULL REFERENCES orders(id),
  method        text NOT NULL CHECK (method IN ('card','upi','netbanking','wallet','cod')),
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  status        text NOT NULL CHECK (status IN ('initiated','success','failed','refunded')),
  provider_ref  text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   bigint NOT NULL REFERENCES products(id),
  customer_id  bigint NOT NULL REFERENCES customers(id),
  rating       smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, customer_id)
);`,
  sampleData: `INSERT INTO customers (email, full_name, phone, created_at) VALUES
 ('neha@example.in',   'Neha Kapoor',   '+91-9000000001', '2025-01-10'),
 ('arjun@example.in',  'Arjun Mehta',   '+91-9000000002', '2025-02-14'),
 ('sara@example.com',  'Sara Thomas',   '+91-9000000003', '2025-03-03'),
 ('vikram@example.in', 'Vikram Rao',    '+91-9000000004', '2025-04-21');

INSERT INTO addresses (customer_id, line1, city, state, pincode, is_default) VALUES
 (1, '12 MG Road',          'Gurugram',  'Haryana',     '122002', true),
 (2, '4 Linking Road',      'Mumbai',    'Maharashtra', '400050', true),
 (3, '88 Indiranagar',      'Bengaluru', 'Karnataka',   '560038', true),
 (4, '7 Banjara Hills',     'Hyderabad', 'Telangana',   '500034', true);

INSERT INTO categories (parent_id, name, slug) VALUES
 (NULL, 'Electronics', 'electronics'),
 (1,    'Audio',       'audio'),
 (2,    'Headphones',  'headphones'),
 (2,    'Speakers',    'speakers'),
 (1,    'Computers',   'computers'),
 (5,    'Laptops',     'laptops'),
 (NULL, 'Home',        'home'),
 (7,    'Kitchen',     'kitchen');

INSERT INTO products (sku, name, category_id, price, attributes) VALUES
 ('HP-ANC-100', 'Noise Cancelling Headphones', 3,  8999.00, '{"brand":"Sonix","color":"black","wireless":true,"battery_h":30}'),
 ('HP-WRD-020', 'Studio Wired Headphones',     3,  2499.00, '{"brand":"Sonix","color":"white","wireless":false}'),
 ('SP-BT-300',  'Bluetooth Speaker 20W',       4,  3499.00, '{"brand":"Boomly","color":"blue","wireless":true,"watts":20}'),
 ('LP-14-PRO',  '14" Pro Laptop 16GB',         6, 74999.00, '{"brand":"Lumen","ram_gb":16,"ssd_gb":512}'),
 ('LP-15-AIR',  '15" Air Laptop 8GB',          6, 52999.00, '{"brand":"Lumen","ram_gb":8,"ssd_gb":256}'),
 ('KT-KTL-15',  'Electric Kettle 1.5L',        8,  1299.00, '{"brand":"Hearth","color":"steel","watts":1500}');

INSERT INTO warehouses (code, city) VALUES ('DEL1', 'Delhi'), ('BOM1', 'Mumbai');

INSERT INTO inventory (product_id, warehouse_id, on_hand, reserved) VALUES
 (1, 1, 40, 2), (1, 2, 25, 0), (2, 1, 100, 0), (3, 2, 60, 1),
 (4, 1, 8, 1),  (5, 2, 12, 0), (6, 1, 200, 3), (6, 2, 150, 0);

INSERT INTO orders (customer_id, shipping_address_id, status, subtotal, discount, tax, created_at) VALUES
 (1, 1, 'delivered', 11498.00,    0, 2069.64, '2025-05-02 10:00+05:30'),
 (2, 2, 'delivered', 74999.00, 5000, 12599.82,'2025-05-09 14:30+05:30'),
 (3, 3, 'shipped',    3798.00,  200,  647.64, '2025-06-11 19:10+05:30'),
 (1, 1, 'paid',       3499.00,    0,  629.82, '2025-06-20 09:05+05:30'),
 (4, 4, 'cancelled', 52999.00,    0, 9539.82, '2025-06-22 22:40+05:30'),
 (2, 2, 'delivered',  2598.00,    0,  467.64, '2025-07-01 12:00+05:30');

INSERT INTO order_items (order_id, line_no, product_id, warehouse_id, quantity, unit_price) VALUES
 (1, 1, 1, 1, 1, 8999.00), (1, 2, 2, 1, 1, 2499.00),
 (2, 1, 4, 1, 1, 74999.00),
 (3, 1, 2, 1, 1, 2499.00), (3, 2, 6, 2, 1, 1299.00),
 (4, 1, 3, 2, 1, 3499.00),
 (5, 1, 5, 2, 1, 52999.00),
 (6, 1, 6, 1, 2, 1299.00);

INSERT INTO payments (order_id, method, amount, status, provider_ref, created_at) VALUES
 (1, 'card', 13567.64, 'success',  'pay_A1', '2025-05-02 10:01+05:30'),
 (2, 'card', 82598.82, 'failed',   'pay_B1', '2025-05-09 14:31+05:30'),
 (2, 'upi',  82598.82, 'success',  'pay_B2', '2025-05-09 14:34+05:30'),
 (3, 'upi',   4245.64, 'success',  'pay_C1', '2025-06-11 19:11+05:30'),
 (4, 'wallet',4128.82, 'success',  'pay_D1', '2025-06-20 09:06+05:30'),
 (5, 'card', 62538.82, 'refunded', 'pay_E1', '2025-06-22 22:41+05:30'),
 (6, 'cod',   3065.64, 'success',  'pay_F1', '2025-07-04 16:00+05:30');

INSERT INTO reviews (product_id, customer_id, rating, body) VALUES
 (1, 1, 5, 'Excellent ANC on flights'),
 (2, 1, 4, 'Great value'),
 (4, 2, 5, 'Fast and silent'),
 (1, 3, 3, 'Good sound, tight fit'),
 (6, 2, 4, 'Boils quickly');`,
  indexes: `-- FK lookups: "orders of customer X, newest first" (account page) — composite serves the ORDER BY too.
CREATE INDEX idx_orders_customer_created ON orders (customer_id, created_at DESC);
-- Reverse lookup from product to the orders containing it (sales per product, "frequently bought together").
CREATE INDEX idx_order_items_product ON order_items (product_id);
CREATE INDEX idx_payments_order ON payments (order_id);
CREATE INDEX idx_products_category ON products (category_id) WHERE is_active;   -- listing pages show active only
CREATE INDEX idx_categories_parent ON categories (parent_id);                    -- recursive tree walks
-- Faceted filters on attributes: attributes @> '{"brand":"Sonix"}' uses this GIN index.
-- jsonb_path_ops is smaller and faster than the default opclass but only supports @> / @? / @@.
CREATE INDEX idx_products_attrs ON products USING gin (attributes jsonb_path_ops);
-- Ops queue: find orders waiting for fulfilment; partial index excludes the 95% that are done.
CREATE INDEX idx_orders_open ON orders (created_at) WHERE status IN ('pending','paid');`,
  queries: [
    {
      title: 'Category tree with breadcrumb path and product counts (recursive CTE)',
      sql: `WITH RECURSIVE tree AS (
  SELECT id, parent_id, name, name::text AS path, 1 AS depth, ARRAY[id] AS ids
  FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, c.name, t.path || ' > ' || c.name, t.depth + 1, t.ids || c.id
  FROM categories c JOIN tree t ON c.parent_id = t.id
)
SELECT t.path, t.depth,
       (SELECT COUNT(*) FROM products p
        JOIN tree sub ON sub.id = p.category_id
        WHERE t.id = ANY (sub.ids) AND p.is_active) AS products_in_subtree
FROM tree t
ORDER BY t.ids;`,
      explain: 'The recursive CTE walks the adjacency list from roots downward, carrying the breadcrumb path and the array of ancestor ids. A category subtree count is "all products whose category has me as an ancestor" — t.id = ANY(sub.ids). Ordering by the ids array gives a natural depth-first display order.'
    },
    {
      title: 'Faceted search on JSONB attributes',
      sql: `SELECT sku, name, price, attributes->>'brand' AS brand,
       (attributes->>'battery_h')::int AS battery_hours
FROM products
WHERE is_active
  AND attributes @> '{"wireless": true}'
  AND price BETWEEN 2000 AND 10000
ORDER BY price;`,
      explain: 'The containment operator @> can use the GIN jsonb_path_ops index. ->> extracts text; cast it for numeric comparisons. Keep frequently filtered, strongly-typed fields (price, category) as real columns and only the long tail of category-specific attributes in JSONB.'
    },
    {
      title: 'Frequently bought together (self-join on order_items)',
      sql: `SELECT p1.name AS product, p2.name AS bought_with, COUNT(*) AS times
FROM order_items a
JOIN order_items b ON b.order_id = a.order_id AND b.product_id <> a.product_id
JOIN products p1 ON p1.id = a.product_id
JOIN products p2 ON p2.id = b.product_id
JOIN orders o ON o.id = a.order_id AND o.status <> 'cancelled'
GROUP BY p1.name, p2.name
ORDER BY times DESC, product;`,
      explain: 'Pairs of distinct products in the same order are counted. On a real catalog this is computed offline (nightly) into a recommendations table because the pair explosion is O(items per order squared).'
    },
    {
      title: 'Monthly revenue, month-over-month growth and running total',
      sql: `WITH monthly AS (
  SELECT date_trunc('month', created_at) AS month, SUM(total) AS revenue, COUNT(*) AS orders
  FROM orders
  WHERE status IN ('paid','shipped','delivered')
  GROUP BY 1
)
SELECT to_char(month, 'YYYY-MM') AS month, orders, revenue,
       ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month))
             / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1) AS mom_growth_pct,
       SUM(revenue) OVER (ORDER BY month) AS running_total
FROM monthly
ORDER BY month;`,
      explain: 'LAG reads the previous month; NULLIF prevents division by zero. The running total uses the default frame (RANGE UNBOUNDED PRECEDING to CURRENT ROW). Cancelled and pending orders are excluded because they are not recognised revenue.'
    },
    {
      title: 'Top 2 products per root category by units sold (ROW_NUMBER per partition)',
      sql: `WITH RECURSIVE roots AS (
  SELECT id, id AS root_id FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, r.root_id FROM categories c JOIN roots r ON c.parent_id = r.id
), sales AS (
  SELECT r.root_id, p.name, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN orders o   ON o.id = oi.order_id AND o.status <> 'cancelled'
  JOIN products p ON p.id = oi.product_id
  JOIN roots r    ON r.id = p.category_id
  GROUP BY r.root_id, p.name
)
SELECT c.name AS root_category, s.name, s.units, s.revenue
FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY root_id ORDER BY units DESC, revenue DESC) AS rn
      FROM sales s) s
JOIN categories c ON c.id = s.root_id
WHERE s.rn <= 2
ORDER BY c.name, s.rn;`,
      explain: 'Classic top-N-per-group: rank inside each partition, then filter in an outer query (window functions cannot appear in WHERE). The recursive CTE maps every leaf category to its root so sales roll up the hierarchy.'
    },
    {
      title: 'Available-to-promise stock and products below reorder point',
      sql: `SELECT p.sku, p.name,
       SUM(i.on_hand) AS on_hand,
       SUM(i.reserved) AS reserved,
       SUM(i.on_hand - i.reserved) AS available,
       SUM(i.on_hand - i.reserved) < 20 AS reorder
FROM products p
JOIN inventory i ON i.product_id = p.id
GROUP BY p.id, p.sku, p.name
ORDER BY available;`,
      explain: 'Available = on_hand - reserved. Stock is reserved at checkout and only decremented from on_hand when the warehouse ships, so cancellations simply release the reservation.'
    }
  ],
  transactions: `-- Checkout: reserve stock for every line atomically, never oversell.
-- Locks inventory rows in a deterministic order (product_id, warehouse_id) to avoid deadlocks
-- when two carts contain the same products in different order.
BEGIN;

-- 1. Lock the rows we need (ORDER BY gives a consistent lock order).
SELECT product_id, warehouse_id, on_hand, reserved
FROM inventory
WHERE (product_id, warehouse_id) IN ((1, 1), (2, 1))
ORDER BY product_id, warehouse_id
FOR UPDATE;

-- 2. Guarded reservation per line. If a line updates 0 rows => out of stock => ROLLBACK.
--    The CHECK (reserved <= on_hand) is a second safety net.
UPDATE inventory SET reserved = reserved + 1
WHERE product_id = 1 AND warehouse_id = 1 AND on_hand - reserved >= 1;
UPDATE inventory SET reserved = reserved + 1
WHERE product_id = 2 AND warehouse_id = 1 AND on_hand - reserved >= 1;

-- 3. Create the order with price snapshots taken from products *now*.
WITH o AS (
  INSERT INTO orders (customer_id, shipping_address_id, subtotal, tax)
  SELECT 3, 3, SUM(price), ROUND(SUM(price) * 0.18, 2)
  FROM products WHERE id IN (1, 2)
  RETURNING id
)
INSERT INTO order_items (order_id, line_no, product_id, warehouse_id, quantity, unit_price)
SELECT o.id, ROW_NUMBER() OVER (ORDER BY p.id), p.id, 1, 1, p.price
FROM o CROSS JOIN products p
WHERE p.id IN (1, 2);

COMMIT;
-- Payment happens AFTER commit (never hold row locks while calling a payment gateway).
-- On payment failure/timeout a job releases the reservation:
--   UPDATE inventory SET reserved = reserved - 1 WHERE product_id = 1 AND warehouse_id = 1;`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Flash sales</strong>: thousands of buyers reserving the same SKU contend on one inventory row. Options: split stock into N bucket rows per SKU and reserve from a random bucket; or pre-allocate tokens in a queue table and claim them with <code>FOR UPDATE SKIP LOCKED</code>; or front it with an in-memory counter (Redis) and reconcile.</li>
<li><strong>Product listing pages</strong> are read-heavy: serve from read replicas and a cache; keep <code>products</code> narrow and move large descriptions/images to separate tables or object storage.</li>
</ul>
<h4>Partitioning</h4>
<p>Range-partition <code>orders</code>, <code>order_items</code> and <code>payments</code> by month of <code>created_at</code> (order_items needs the date column copied in to be partitioned the same way). Old partitions are read-only — VACUUM FREEZE once and they cost nothing.</p>
<h4>Search</h4>
<p>Core full-text search (<code>tsvector</code> + GIN) or <span class="tag ext">extension</span> pg_trgm for typo-tolerant name search is enough for catalogs up to a few million SKUs; beyond that, product search is usually moved to a dedicated search engine fed by logical decoding / CDC.</p>
<h4>At 100x scale</h4>
<ul>
<li>Split into services: catalog (read-mostly, heavily cached), cart (ephemeral, often key-value), orders/payments (strong consistency, PostgreSQL), inventory.</li>
<li>Shard orders by <code>customer_id</code> so "my orders" is single-shard; analytics goes to a warehouse via CDC.</li>
<li>Use the transactional outbox pattern: write an <code>outbox</code> row in the same transaction as the order, and a relay publishes events — avoids dual-write inconsistency between DB and message broker.</li>
</ul>`,
  advanced: `<h4>Price snapshots and immutability</h4>
<p>Order lines copy <code>unit_price</code>; never join to <code>products.price</code> for historical totals. Same for addresses: production systems snapshot the shipping address JSON into the order, because the customer may edit or delete it later.</p>
<h4>Generated columns</h4>
<p><code>total</code> is <code>GENERATED ALWAYS AS (...) STORED</code> — it can never disagree with its inputs. PostgreSQL 18 also supports VIRTUAL generated columns (computed on read, now the default kind).</p>
<h4>EAV vs JSONB</h4>
<p>Entity-attribute-value tables make every filter a self-join and lose typing. JSONB keeps attributes with the row, supports GIN indexes and <code>jsonb_path_query</code>; add CHECK constraints such as <code>CHECK (jsonb_typeof(attributes-&gt;'ram_gb') IN ('number') OR NOT attributes ? 'ram_gb')</code> for critical keys.</p>
<h4>Idempotent payments</h4>
<p><code>provider_ref</code> is UNIQUE so a webhook delivered twice cannot record two payments; use <code>INSERT ... ON CONFLICT (provider_ref) DO NOTHING</code>.</p>
<div class="callout tip">Keep the checkout transaction short: reserve stock and create the order, commit, then call the payment gateway. A gateway timeout inside an open transaction holds row locks and blocks every other buyer of that SKU.</div>`
});

/* ------------------------------------------------------------------ 3. HR MANAGEMENT */
PGM.PROJECTS.push({
  id: 'hr-management',
  title: 'HR Management System',
  icon: '👥',
  level: 3,
  summary: 'Org hierarchy, temporal salary history that cannot overlap (exclusion constraints), leave management and attendance.',
  requirements: [
    'Employees belong to a department and report to a manager (arbitrarily deep hierarchy).',
    'Full salary history: exactly one salary is valid on any given day — overlapping periods must be impossible.',
    'Leave requests go through an approval workflow; approved leave must not overlap for the same employee.',
    'Leave balances per employee per leave type per year.',
    'Daily attendance with check-in/check-out; one record per employee per day.',
    'Headcount, attrition and payroll cost reports for HR leadership.'
  ],
  entities: [
    { name: 'departments', desc: 'Organisational units with a cost centre code.' },
    { name: 'employees', desc: 'Workers with manager_id self-reference, join/exit dates.' },
    { name: 'salaries', desc: 'Temporal table: amount valid over a daterange; overlaps blocked by EXCLUDE.' },
    { name: 'leave_types', desc: 'Casual, sick, earned... with annual quota.' },
    { name: 'leave_requests', desc: 'Requested period (daterange) with status workflow.' },
    { name: 'attendance', desc: 'One row per employee per working day.' }
  ],
  relationships: [
    { from: 'employees', to: 'departments', type: 'N:1', label: 'works in' },
    { from: 'employees', to: 'employees', type: 'N:1', label: 'reports to' },
    { from: 'salaries', to: 'employees', type: 'N:1', label: 'paid to' },
    { from: 'leave_requests', to: 'employees', type: 'N:1', label: 'requested by' },
    { from: 'leave_requests', to: 'leave_types', type: 'N:1', label: 'of type' },
    { from: 'leave_requests', to: 'employees', type: 'N:1', label: 'approved by' },
    { from: 'attendance', to: 'employees', type: 'N:1', label: 'recorded for' }
  ],
  ddl: `-- btree_gist (extension) lets an EXCLUDE constraint combine "=" on a scalar with "&&" on a range.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE departments (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  cost_center  text NOT NULL UNIQUE
);

CREATE TABLE employees (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  emp_code       text NOT NULL UNIQUE,
  full_name      text NOT NULL,
  email          text NOT NULL UNIQUE,
  department_id  int  NOT NULL REFERENCES departments(id),
  manager_id     int  REFERENCES employees(id),
  job_title      text NOT NULL,
  hired_on       date NOT NULL,
  exited_on      date,
  CHECK (manager_id <> id),
  CHECK (exited_on IS NULL OR exited_on >= hired_on)
);

CREATE TABLE salaries (
  employee_id  int NOT NULL REFERENCES employees(id),
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),   -- annual CTC in INR
  valid        daterange NOT NULL CHECK (NOT isempty(valid)),
  reason       text NOT NULL DEFAULT 'appraisal',
  -- one salary per employee per day: no two ranges of the same employee may overlap
  EXCLUDE USING gist (employee_id WITH =, valid WITH &&)
);

CREATE TABLE leave_types (
  id           smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  annual_days  smallint NOT NULL CHECK (annual_days >= 0)
);

CREATE TABLE leave_requests (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id    int NOT NULL REFERENCES employees(id),
  leave_type_id  smallint NOT NULL REFERENCES leave_types(id),
  period         daterange NOT NULL CHECK (NOT isempty(period)),
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','cancelled')),
  approver_id    int REFERENCES employees(id),
  reason         text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  -- approved leave cannot overlap (pending/rejected rows are ignored by the WHERE clause)
  EXCLUDE USING gist (employee_id WITH =, period WITH &&) WHERE (status = 'approved')
);

CREATE TABLE attendance (
  employee_id  int  NOT NULL REFERENCES employees(id),
  work_date    date NOT NULL,
  check_in     time,
  check_out    time,
  status       text NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','wfh','half_day')),
  PRIMARY KEY (employee_id, work_date),
  CHECK (check_out IS NULL OR check_out > check_in)
);`,
  sampleData: `INSERT INTO departments (name, cost_center) VALUES
 ('Engineering', 'CC-100'), ('Sales', 'CC-200'), ('People Ops', 'CC-300');

INSERT INTO employees (emp_code, full_name, email, department_id, manager_id, job_title, hired_on, exited_on) VALUES
 ('E001', 'Anita Desai',    'anita@corp.in',  1, NULL, 'CTO',                 '2019-04-01', NULL),
 ('E002', 'Ravi Kumar',     'ravi@corp.in',   1, 1,    'Engineering Manager', '2020-06-15', NULL),
 ('E003', 'Sneha Patil',    'sneha@corp.in',  1, 2,    'Senior Engineer',     '2021-01-11', NULL),
 ('E004', 'Imran Khan',     'imran@corp.in',  1, 2,    'Engineer',            '2023-07-03', NULL),
 ('E005', 'Divya Menon',    'divya@corp.in',  2, 1,    'Sales Head',          '2020-02-01', NULL),
 ('E006', 'Karan Singh',    'karan@corp.in',  2, 5,    'Account Executive',   '2022-09-19', '2025-03-31'),
 ('E007', 'Pooja Reddy',    'pooja@corp.in',  3, 1,    'HR Business Partner', '2021-08-23', NULL),
 ('E008', 'Aditya Joshi',   'aditya@corp.in', 1, 3,    'Engineer',            '2024-02-05', NULL);

-- '[start,end)' half-open ranges: an open upper bound means "current"
INSERT INTO salaries (employee_id, amount, valid, reason) VALUES
 (1, 6000000, '[2019-04-01,2023-04-01)', 'joining'), (1, 7200000, '[2023-04-01,)', 'appraisal'),
 (2, 3000000, '[2020-06-15,2024-04-01)', 'joining'), (2, 3600000, '[2024-04-01,)', 'promotion'),
 (3, 1800000, '[2021-01-11,2023-04-01)', 'joining'), (3, 2400000, '[2023-04-01,2025-04-01)', 'appraisal'),
 (3, 2900000, '[2025-04-01,)', 'promotion'),
 (4, 1400000, '[2023-07-03,)', 'joining'),
 (5, 3200000, '[2020-02-01,)', 'joining'),
 (6, 1200000, '[2022-09-19,2025-04-01)', 'joining'),
 (7, 1600000, '[2021-08-23,)', 'joining'),
 (8, 1300000, '[2024-02-05,)', 'joining');

INSERT INTO leave_types (code, annual_days) VALUES ('CASUAL', 12), ('SICK', 10), ('EARNED', 18);

INSERT INTO leave_requests (employee_id, leave_type_id, period, status, approver_id, reason) VALUES
 (3, 3, '[2025-05-12,2025-05-17)', 'approved', 2, 'Family trip'),
 (3, 1, '[2025-08-14,2025-08-15)', 'approved', 2, 'Personal'),
 (4, 2, '[2025-06-02,2025-06-04)', 'approved', 2, 'Unwell'),
 (8, 3, '[2025-10-20,2025-10-25)', 'pending',  NULL, 'Diwali'),
 (5, 1, '[2025-07-07,2025-07-08)', 'rejected', 1, 'Quarter close'),
 (7, 3, '[2025-12-22,2026-01-02)', 'approved', 1, 'Year-end break');

INSERT INTO attendance (employee_id, work_date, check_in, check_out, status) VALUES
 (3, '2025-09-01', '09:12', '18:40', 'present'), (3, '2025-09-02', '09:05', '18:10', 'present'),
 (4, '2025-09-01', '10:20', '19:30', 'present'), (4, '2025-09-02', NULL, NULL, 'absent'),
 (8, '2025-09-01', '09:00', '13:00', 'half_day'),(8, '2025-09-02', '09:30', '18:30', 'wfh'),
 (2, '2025-09-01', '08:55', '19:05', 'present'), (2, '2025-09-02', '09:01', '18:45', 'present');`,
  indexes: `-- Hierarchy walks (WITH RECURSIVE ... JOIN ON e.manager_id = parent.id) need this FK index.
CREATE INDEX idx_employees_manager ON employees (manager_id);
CREATE INDEX idx_employees_department ON employees (department_id) WHERE exited_on IS NULL;  -- active headcount
-- The EXCLUDE constraints already created GiST indexes on (employee_id, valid) and
-- (employee_id, period) — they also serve "salary on date X" (valid @> date) lookups.
-- Approval inbox: pending requests by approver chain; partial = tiny.
CREATE INDEX idx_leave_pending ON leave_requests (employee_id) WHERE status = 'pending';
-- Daily attendance dashboard scans one date across all employees.
CREATE INDEX idx_attendance_date ON attendance (work_date);`,
  queries: [
    {
      title: 'Org chart under the CTO with level and reporting path (recursive CTE)',
      sql: `WITH RECURSIVE org AS (
  SELECT id, full_name, job_title, manager_id, 0 AS lvl, full_name::text AS chain
  FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.full_name, e.job_title, e.manager_id, o.lvl + 1, o.chain || ' > ' || e.full_name
  FROM employees e JOIN org o ON e.manager_id = o.id
  WHERE e.exited_on IS NULL
)
SELECT repeat('    ', lvl) || full_name AS employee, job_title, lvl, chain
FROM org
ORDER BY chain;`,
      explain: 'The anchor selects the root (no manager); the recursive part joins the employees of each level to the previous level. Ordering by the textual chain renders an indented tree. For deep or cyclic data, add CYCLE id SET is_cycle USING path (PostgreSQL 14+) to stop infinite recursion.'
    },
    {
      title: 'Salary on a given date and current salary (range containment)',
      sql: `SELECT e.full_name,
       (SELECT amount FROM salaries s WHERE s.employee_id = e.id AND s.valid @> DATE '2024-01-01') AS ctc_jan_2024,
       (SELECT amount FROM salaries s WHERE s.employee_id = e.id AND s.valid @> CURRENT_DATE)       AS ctc_today
FROM employees e
WHERE e.exited_on IS NULL
ORDER BY e.id;`,
      explain: 'valid @> date asks "does this range contain this day?". Because the EXCLUDE constraint guarantees no overlaps, at most one row can match, so the scalar subquery is safe. Half-open [start,end) ranges make consecutive periods meet without gaps or double counting.'
    },
    {
      title: 'Salary vs. department average and percentile (window functions)',
      sql: `WITH current_pay AS (
  SELECT e.id, e.full_name, d.name AS department, s.amount
  FROM employees e
  JOIN departments d ON d.id = e.department_id
  JOIN salaries s ON s.employee_id = e.id AND s.valid @> CURRENT_DATE
  WHERE e.exited_on IS NULL
)
SELECT full_name, department, amount,
       ROUND(AVG(amount) OVER (PARTITION BY department)) AS dept_avg,
       amount - ROUND(AVG(amount) OVER (PARTITION BY department)) AS diff_from_avg,
       ROUND(PERCENT_RANK() OVER (ORDER BY amount)::numeric, 2) AS company_percentile
FROM current_pay
ORDER BY department, amount DESC;`,
      explain: 'Partitioned AVG gives each row its department average without collapsing rows (unlike GROUP BY). PERCENT_RANK returns 0..1 relative standing across the company — a typical compensation-equity report.'
    },
    {
      title: 'Leave balance per employee for 2025 (days taken via range arithmetic)',
      sql: `SELECT e.full_name, lt.code, lt.annual_days,
       COALESCE(SUM(upper(lr.period * daterange('2025-01-01','2026-01-01'))
                  - lower(lr.period * daterange('2025-01-01','2026-01-01'))), 0) AS days_taken,
       lt.annual_days - COALESCE(SUM(upper(lr.period * daterange('2025-01-01','2026-01-01'))
                  - lower(lr.period * daterange('2025-01-01','2026-01-01'))), 0) AS balance
FROM employees e
CROSS JOIN leave_types lt
LEFT JOIN leave_requests lr
       ON lr.employee_id = e.id AND lr.leave_type_id = lt.id AND lr.status = 'approved'
      AND lr.period && daterange('2025-01-01','2026-01-01')
WHERE e.exited_on IS NULL
GROUP BY e.id, e.full_name, lt.id, lt.code, lt.annual_days
HAVING COUNT(lr.id) > 0
ORDER BY e.full_name, lt.code;`,
      explain: 'range * range is intersection: leave spanning New Year (22 Dec - 1 Jan) only counts the 2025 part. upper - lower on a daterange gives a day count (integer) because date subtraction returns integer days. Real systems also exclude weekends and holidays using a calendar table.'
    },
    {
      title: 'Monthly headcount and attrition (generate_series + range overlap)',
      sql: `SELECT to_char(m, 'YYYY-MM') AS month,
       COUNT(*) FILTER (WHERE e.hired_on < m + INTERVAL '1 month'
                          AND (e.exited_on IS NULL OR e.exited_on >= m)) AS headcount,
       COUNT(*) FILTER (WHERE e.hired_on >= m AND e.hired_on < m + INTERVAL '1 month') AS joiners,
       COUNT(*) FILTER (WHERE e.exited_on >= m AND e.exited_on < m + INTERVAL '1 month') AS leavers
FROM generate_series(DATE '2025-01-01', DATE '2025-06-01', INTERVAL '1 month') AS m
CROSS JOIN employees e
GROUP BY m
ORDER BY m;`,
      explain: 'generate_series produces one row per month, guaranteeing months with zero activity still appear. FILTER clauses compute three metrics in one pass. Attrition rate = leavers / average headcount.'
    }
  ],
  transactions: `-- Appraisal: close the current salary period and open a new one atomically.
-- The EXCLUDE constraint guarantees that a concurrent, conflicting appraisal fails
-- instead of silently creating overlapping salaries.
BEGIN;

UPDATE salaries
SET valid = daterange(lower(valid), DATE '2026-04-01')
WHERE employee_id = 4 AND valid @> DATE '2026-04-01';

INSERT INTO salaries (employee_id, amount, valid, reason)
VALUES (4, 1650000, daterange(DATE '2026-04-01', NULL), 'appraisal');

COMMIT;

-- Approving leave: lock the request, re-check balance, approve.
-- If another approved leave overlaps, the EXCLUDE constraint raises
-- SQLSTATE 23P01 (exclusion_violation) and the transaction rolls back.
BEGIN;
SELECT id, employee_id, period, status
FROM leave_requests WHERE id = 4 FOR UPDATE;

UPDATE leave_requests
SET status = 'approved', approver_id = 3
WHERE id = 4 AND status = 'pending';
COMMIT;`,
  optimization: `<h4>Scale profile</h4>
<p>HR data is small (even a 300,000-employee company has a few million salary/leave rows), so the real concerns are correctness, privacy and audit, not throughput. The heaviest tables are <code>attendance</code> (employees x working days ≈ 75M rows/year at 300k staff) and punch logs from biometric devices.</p>
<h4>Partitioning</h4>
<ul>
<li>Range-partition <code>attendance</code> by <code>work_date</code> (monthly or yearly). Payroll runs read one month = one partition.</li>
<li>Detach and archive partitions older than the statutory retention period.</li>
</ul>
<h4>Hotspots</h4>
<ul>
<li>09:00 check-in burst: tens of thousands of inserts in minutes. Batch inserts from devices (multi-row INSERT or COPY), keep attendance indexes minimal.</li>
<li>Payroll run: compute in set-based SQL (one INSERT ... SELECT for all employees) rather than a loop per employee.</li>
</ul>
<h4>At 100x scale (multi-company HR SaaS)</h4>
<p>Add <code>tenant_id</code> to every table and use Row-Level Security; shard by tenant when one cluster is not enough (see the Multi-tenant SaaS project).</p>`,
  advanced: `<h4>Temporal data with ranges + EXCLUDE <span class="tag core">core</span> + <span class="tag ext">extension</span></h4>
<p>Range types and exclusion constraints are core PostgreSQL; mixing a scalar equality (<code>employee_id WITH =</code>) into a GiST exclusion constraint requires the <code>btree_gist</code> extension. PostgreSQL 18 adds SQL-standard temporal keys: <code>PRIMARY KEY (employee_id, valid WITHOUT OVERLAPS)</code> and <code>FOREIGN KEY (..., PERIOD valid)</code>, which express the same rule declaratively.</p>
<h4>Privacy</h4>
<ul>
<li>Salary is the most sensitive column. Put it in its own table (done here) with tighter GRANTs; managers see their reports only through a view or RLS policy based on the recursive reporting chain.</li>
<li>Audit every read of salary data via the application, and every change via triggers into an audit table.</li>
</ul>
<h4>Hierarchy alternatives</h4>
<p>Adjacency list + recursive CTE (used here) is simplest and handles moves in O(1). For read-heavy "all descendants" queries, the <span class="tag ext">extension</span> <code>ltree</code> stores the path (<code>1.2.3</code>) with GiST indexing; a closure table stores every ancestor/descendant pair. Both make moves more expensive.</p>
<div class="callout warn">Never DELETE an exiting employee — set <code>exited_on</code>. Payroll, tax and audit history reference them for years.</div>`
});

/* ------------------------------------------------------------------ 4. PROJECT MANAGEMENT */
PGM.PROJECTS.push({
  id: 'project-management',
  title: 'Project Management (Jira-style)',
  icon: '📋',
  level: 3,
  summary: 'Workspaces, projects, sprints, tasks with sub-tasks and dependencies, comments, labels and time tracking — with optimistic locking for concurrent edits.',
  requirements: [
    'Workspaces contain projects; members have roles per workspace.',
    'Tasks have a human key (PROJ-42) unique per project, a status workflow, priority, assignee, story points and optional parent task (sub-tasks).',
    'Tasks can block other tasks (dependency graph, no self-dependency).',
    'Sprints are time-boxed; a task belongs to at most one sprint.',
    'Threaded comments, many-to-many labels, and time logs per task.',
    'Two users editing the same task must not silently overwrite each other (optimistic concurrency).',
    'Reports: burndown, velocity, overdue work per assignee, blocked chains.'
  ],
  entities: [
    { name: 'workspaces', desc: 'Top-level tenant/organisation.' },
    { name: 'members', desc: 'Users of a workspace with role.' },
    { name: 'projects', desc: 'Project with a short key (e.g. PAY) and a per-project task counter.' },
    { name: 'sprints', desc: 'Time-boxed iterations per project.' },
    { name: 'tasks', desc: 'Work items: key number, status, priority, points, assignee, parent, version.' },
    { name: 'task_dependencies', desc: 'Edge table: blocker_id blocks blocked_id.' },
    { name: 'labels', desc: 'Workspace-wide labels.' },
    { name: 'task_labels', desc: 'Many-to-many tasks <-> labels.' },
    { name: 'comments', desc: 'Comments on tasks.' },
    { name: 'time_logs', desc: 'Minutes worked per member per task per day.' }
  ],
  relationships: [
    { from: 'members', to: 'workspaces', type: 'N:1', label: 'member of' },
    { from: 'projects', to: 'workspaces', type: 'N:1', label: 'in' },
    { from: 'sprints', to: 'projects', type: 'N:1', label: 'iteration of' },
    { from: 'tasks', to: 'projects', type: 'N:1', label: 'belongs to' },
    { from: 'tasks', to: 'sprints', type: 'N:1', label: 'planned in' },
    { from: 'tasks', to: 'members', type: 'N:1', label: 'assigned to' },
    { from: 'tasks', to: 'tasks', type: 'N:1', label: 'sub-task of' },
    { from: 'task_dependencies', to: 'tasks', type: 'N:1', label: 'blocker / blocked' },
    { from: 'task_labels', to: 'tasks', type: 'N:1', label: 'tags' },
    { from: 'task_labels', to: 'labels', type: 'N:1', label: 'uses' },
    { from: 'comments', to: 'tasks', type: 'N:1', label: 'on' },
    { from: 'time_logs', to: 'tasks', type: 'N:1', label: 'logged on' }
  ],
  ddl: `CREATE TABLE workspaces (
  id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL,
  slug  text NOT NULL UNIQUE
);

CREATE TABLE members (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  int NOT NULL REFERENCES workspaces(id),
  name          text NOT NULL,
  email         text NOT NULL,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','guest')),
  UNIQUE (workspace_id, email)
);

CREATE TABLE projects (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  int NOT NULL REFERENCES workspaces(id),
  key           text NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name          text NOT NULL,
  next_task_no  int  NOT NULL DEFAULT 1,       -- per-project counter for PAY-1, PAY-2...
  archived      boolean NOT NULL DEFAULT false,
  UNIQUE (workspace_id, key)
);

CREATE TABLE sprints (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  int NOT NULL REFERENCES projects(id),
  name        text NOT NULL,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  state       text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','active','closed')),
  CHECK (ends_on > starts_on)
);
-- at most one active sprint per project
CREATE UNIQUE INDEX uq_one_active_sprint ON sprints (project_id) WHERE state = 'active';

CREATE TABLE tasks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    int NOT NULL REFERENCES projects(id),
  task_no       int NOT NULL,
  parent_id     bigint REFERENCES tasks(id) ON DELETE CASCADE,
  sprint_id     int REFERENCES sprints(id) ON DELETE SET NULL,
  title         text NOT NULL,
  description   text,
  type          text NOT NULL DEFAULT 'task' CHECK (type IN ('epic','story','task','bug','subtask')),
  status        text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','in_review','done')),
  priority      smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),   -- 1 = highest
  story_points  smallint CHECK (story_points >= 0),
  assignee_id   int REFERENCES members(id),
  reporter_id   int NOT NULL REFERENCES members(id),
  due_on        date,
  version       int NOT NULL DEFAULT 1,      -- optimistic locking
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz,
  UNIQUE (project_id, task_no),
  CHECK ((status = 'done') = (done_at IS NOT NULL))
);

CREATE TABLE task_dependencies (
  blocker_id  bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_id  bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE labels (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  int NOT NULL REFERENCES workspaces(id),
  name          text NOT NULL,
  color         char(7) NOT NULL DEFAULT '#888888',
  UNIQUE (workspace_id, name)
);

CREATE TABLE task_labels (
  task_id   bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id  int    NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE comments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id    bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  int NOT NULL REFERENCES members(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE time_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id    bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id  int NOT NULL REFERENCES members(id),
  log_date   date NOT NULL,
  minutes    int NOT NULL CHECK (minutes BETWEEN 1 AND 1440)
);`,
  sampleData: `INSERT INTO workspaces (name, slug) VALUES ('Rodic Digital', 'rodic-digital');

INSERT INTO members (workspace_id, name, email, role) VALUES
 (1, 'Ajay',   'ajay@rd.in',   'owner'),
 (1, 'Bhavna', 'bhavna@rd.in', 'admin'),
 (1, 'Chetan', 'chetan@rd.in', 'member'),
 (1, 'Deepa',  'deepa@rd.in',  'member');

INSERT INTO projects (workspace_id, key, name, next_task_no) VALUES
 (1, 'PAY', 'Payments Revamp', 9),
 (1, 'MOB', 'Mobile App',      3);

INSERT INTO sprints (project_id, name, starts_on, ends_on, state) VALUES
 (1, 'PAY Sprint 1', '2025-09-01', '2025-09-15', 'closed'),
 (1, 'PAY Sprint 2', '2025-09-15', '2025-09-29', 'active');

INSERT INTO tasks (project_id, task_no, parent_id, sprint_id, title, type, status, priority, story_points,
                   assignee_id, reporter_id, due_on, created_at, done_at) VALUES
 (1, 1, NULL, 1, 'UPI autopay epic',              'epic',  'in_progress', 1, NULL, 2, 1, '2025-10-31', '2025-08-25', NULL),
 (1, 2, 1,    1, 'Design mandate schema',         'story', 'done',        2, 3,    3, 2, '2025-09-05', '2025-08-26', '2025-09-04 17:00+05:30'),
 (1, 3, 1,    1, 'Mandate registration API',      'story', 'done',        2, 5,    3, 2, '2025-09-12', '2025-08-26', '2025-09-12 19:30+05:30'),
 (1, 4, 1,    2, 'Debit execution scheduler',     'story', 'in_progress', 1, 8,    4, 2, '2025-09-26', '2025-09-10', NULL),
 (1, 5, 1,    2, 'Retry & failure notifications', 'story', 'todo',        2, 5,    3, 2, '2025-09-28', '2025-09-10', NULL),
 (1, 6, 4,    2, 'Write cron job',                'subtask','done',       3, 2,    4, 4, '2025-09-20', '2025-09-15', '2025-09-19 12:00+05:30'),
 (1, 7, NULL, 2, 'Fix rounding in refunds',       'bug',   'in_review',   1, 2,    4, 3, '2025-09-18', '2025-09-16', NULL),
 (1, 8, NULL, NULL,'Reconciliation report',       'story', 'todo',        3, 8,    NULL, 1, NULL,       '2025-09-17', NULL),
 (2, 1, NULL, NULL,'Login with OTP',              'story', 'done',        2, 5,    3, 1, '2025-09-10', '2025-09-01', '2025-09-09 15:00+05:30'),
 (2, 2, NULL, NULL,'Offline mode',                'story', 'todo',        4, 13,   NULL, 1, NULL,       '2025-09-02', NULL);

-- PAY-3 (API) blocks PAY-4 (scheduler) which blocks PAY-5 (retries) which blocks PAY-8 (report)
INSERT INTO task_dependencies (blocker_id, blocked_id) VALUES (3, 4), (4, 5), (5, 8), (2, 3);

INSERT INTO labels (workspace_id, name, color) VALUES
 (1, 'backend', '#1f77b4'), (1, 'urgent', '#d62728'), (1, 'compliance', '#2ca02c');
INSERT INTO task_labels VALUES (2, 1), (3, 1), (4, 1), (7, 2), (7, 1), (8, 3), (5, 1);

INSERT INTO comments (task_id, author_id, body, created_at) VALUES
 (4, 2, 'Use NPCI cut-off windows for scheduling', '2025-09-16 10:00+05:30'),
 (4, 4, 'Draft PR is up', '2025-09-19 12:05+05:30'),
 (7, 3, 'Repro: refund of 33.335 rounds wrong', '2025-09-16 11:00+05:30');

INSERT INTO time_logs (task_id, member_id, log_date, minutes) VALUES
 (2, 3, '2025-09-02', 240), (2, 3, '2025-09-03', 300), (3, 3, '2025-09-08', 420),
 (3, 3, '2025-09-11', 360), (4, 4, '2025-09-16', 480), (6, 4, '2025-09-18', 180),
 (7, 4, '2025-09-17', 120), (9, 3, '2025-09-05', 300);`,
  indexes: `-- Board view: all tasks of a sprint grouped by status.
CREATE INDEX idx_tasks_sprint_status ON tasks (sprint_id, status);
-- "My open work" view — partial index keeps only unfinished tasks (done tasks pile up forever).
CREATE INDEX idx_tasks_assignee_open ON tasks (assignee_id, due_on) WHERE status <> 'done';
-- Sub-task expansion and recursive epic roll-ups.
CREATE INDEX idx_tasks_parent ON tasks (parent_id);
-- Reverse edge lookup: "what blocks task X?" (PK covers blocker -> blocked direction).
CREATE INDEX idx_deps_blocked ON task_dependencies (blocked_id);
CREATE INDEX idx_task_labels_label ON task_labels (label_id);
CREATE INDEX idx_comments_task ON comments (task_id, created_at);
CREATE INDEX idx_time_logs_task ON time_logs (task_id);`,
  queries: [
    {
      title: 'Sprint board: tasks per status with points (FILTER)',
      sql: `SELECT p.key || '-' || t.task_no AS task_key, t.title, t.status, t.story_points,
       m.name AS assignee,
       string_agg(l.name, ', ' ORDER BY l.name) AS labels
FROM tasks t
JOIN projects p ON p.id = t.project_id
LEFT JOIN members m ON m.id = t.assignee_id
LEFT JOIN task_labels tl ON tl.task_id = t.id
LEFT JOIN labels l ON l.id = tl.label_id
WHERE t.sprint_id = (SELECT id FROM sprints WHERE project_id = 1 AND state = 'active')
GROUP BY p.key, t.task_no, t.title, t.status, t.story_points, m.name, t.priority
ORDER BY array_position(ARRAY['todo','in_progress','in_review','done'], t.status), t.priority;`,
      explain: 'string_agg with ORDER BY collapses labels into one column. array_position orders statuses by workflow order rather than alphabetically. The subquery finds the active sprint through the partial unique index.'
    },
    {
      title: 'Dependency chain: everything transitively blocked by PAY-2 (recursive CTE with cycle protection)',
      sql: `WITH RECURSIVE chain AS (
  SELECT d.blocked_id AS task_id, 1 AS depth
  FROM task_dependencies d WHERE d.blocker_id = 2
  UNION ALL
  SELECT d.blocked_id, c.depth + 1
  FROM task_dependencies d JOIN chain c ON d.blocker_id = c.task_id
) CYCLE task_id SET is_cycle USING path
SELECT 'PAY-' || t.task_no AS task, t.title, t.status, c.depth
FROM chain c JOIN tasks t ON t.id = c.task_id
WHERE NOT c.is_cycle
ORDER BY c.depth;`,
      explain: 'The CYCLE clause (SQL standard, PostgreSQL 14+) tracks visited ids in path and marks rows that revisit a node, so an accidental cycle (A blocks B blocks A) cannot loop forever. Depth tells you how far down the critical path each task sits.'
    },
    {
      title: 'Epic roll-up: total and completed points of all descendants',
      sql: `WITH RECURSIVE tree AS (
  SELECT id, id AS epic_id FROM tasks WHERE type = 'epic'
  UNION ALL
  SELECT t.id, tree.epic_id FROM tasks t JOIN tree ON t.parent_id = tree.id
)
SELECT e.title AS epic,
       COUNT(*) - 1 AS descendants,
       SUM(t.story_points) AS total_points,
       SUM(t.story_points) FILTER (WHERE t.status = 'done') AS done_points,
       ROUND(100.0 * SUM(t.story_points) FILTER (WHERE t.status = 'done')
             / NULLIF(SUM(t.story_points), 0)) AS pct_complete
FROM tree
JOIN tasks t ON t.id = tree.id
JOIN tasks e ON e.id = tree.epic_id
GROUP BY e.id, e.title;`,
      explain: 'Each descendant row carries its epic_id down the recursion, so a single GROUP BY rolls up any depth of stories and sub-tasks.'
    },
    {
      title: 'Sprint burndown: remaining points per day (generate_series + correlated aggregation)',
      sql: `WITH s AS (SELECT * FROM sprints WHERE id = 2),
days AS (
  SELECT d::date AS day FROM s, generate_series(s.starts_on, s.ends_on, INTERVAL '1 day') d
)
SELECT day,
       (SELECT COALESCE(SUM(t.story_points), 0) FROM tasks t
        WHERE t.sprint_id = 2
          AND (t.done_at IS NULL OR t.done_at::date > day)) AS remaining_points,
       ROUND((SELECT SUM(story_points) FROM tasks WHERE sprint_id = 2)
             * (1 - (day - (SELECT starts_on FROM s))::numeric
                    / ((SELECT ends_on FROM s) - (SELECT starts_on FROM s))), 1) AS ideal_line
FROM days
ORDER BY day;`,
      explain: 'For each calendar day, remaining points = points of tasks not done by end of that day. The ideal line decreases linearly from total to zero. (A production version would read scope changes from an audit/history table, because tasks added mid-sprint change the baseline.)'
    },
    {
      title: 'Overdue and at-risk work per assignee with logged hours',
      sql: `SELECT m.name,
       COUNT(*) FILTER (WHERE t.due_on < DATE '2025-09-22') AS overdue,
       COUNT(*) FILTER (WHERE t.due_on BETWEEN DATE '2025-09-22' AND DATE '2025-09-29') AS due_this_week,
       SUM(t.story_points) AS open_points,
       ROUND(COALESCE(SUM(tl.mins), 0) / 60.0, 1) AS hours_logged
FROM tasks t
JOIN members m ON m.id = t.assignee_id
LEFT JOIN LATERAL (SELECT SUM(minutes) AS mins FROM time_logs WHERE task_id = t.id) tl ON true
WHERE t.status <> 'done'
GROUP BY m.name
ORDER BY overdue DESC, open_points DESC;`,
      explain: 'A LATERAL subquery pre-aggregates time logs per task before the outer GROUP BY; joining time_logs directly would multiply story_points by the number of log rows (the classic fan-out bug). A fixed "today" (2025-09-22) keeps the example deterministic; production code uses CURRENT_DATE.'
    }
  ],
  transactions: `-- 1. Create a task with a gap-free per-project number (PAY-9, PAY-10...).
--    UPDATE ... RETURNING locks the project row, so concurrent creators queue
--    for a few microseconds instead of both getting the same number.
BEGIN;
WITH n AS (
  UPDATE projects SET next_task_no = next_task_no + 1
  WHERE id = 1
  RETURNING id, next_task_no - 1 AS task_no
)
INSERT INTO tasks (project_id, task_no, title, type, reporter_id, sprint_id)
SELECT n.id, n.task_no, 'Add audit trail to mandates', 'story', 2, 2
FROM n
RETURNING id, task_no;
COMMIT;

-- 2. Optimistic locking: the client sends back the version it loaded.
--    0 rows updated => someone else changed the task; show "reload and retry".
BEGIN;
UPDATE tasks
SET status = 'done', done_at = now(), version = version + 1, updated_at = now()
WHERE id = 7 AND version = 1          -- version the user saw
RETURNING id, version;
COMMIT;`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Per-project counter row</strong>: <code>projects.next_task_no</code> is updated on every task creation. Fine at human speed (a few per second per project); for automated ingest (e.g. bug reports from monitoring) use a sequence per project or allocate numbers in batches.</li>
<li><strong>Board queries</strong> run on every page load: keep them index-only friendly and paginate columns (keyset on priority, id).</li>
<li><strong>Activity feed / history</strong>: every field change produces an event; this table (not tasks) becomes the largest.</li>
</ul>
<h4>Partitioning & archiving</h4>
<ul>
<li>Partition <code>task_events</code>/history and <code>comments</code> by month.</li>
<li>Archived projects can be moved to a separate tablespace or exported; a partial index <code>WHERE NOT archived</code> keeps hot indexes small.</li>
</ul>
<h4>At 100x scale (SaaS with 100k workspaces)</h4>
<ul>
<li>Every table gets <code>workspace_id</code>; it leads every index and becomes the shard key (Citus <span class="tag ext">extension</span> distributed tables, or app-level sharding). All queries in this project are workspace-scoped, so they stay single-shard.</li>
<li>Search across tasks: core FTS with a generated <code>tsvector</code> column + GIN, or pg_trgm for fuzzy title search.</li>
</ul>`,
  advanced: `<h4>Ordering within a column (drag &amp; drop)</h4>
<p>Store a <code>rank</code> as a sortable string or numeric between neighbours ("fractional indexing"): moving a card updates one row instead of renumbering the whole column. Periodically rebalance when gaps get too small.</p>
<h4>Preventing dependency cycles</h4>
<p>A CHECK constraint cannot see other rows. Use a trigger that, before inserting edge (a, b), runs a recursive CTE to see whether b already reaches a, under a lock on the involved tasks (or SERIALIZABLE isolation) so two concurrent inserts cannot each create half of a cycle.</p>
<h4>Audit and history</h4>
<p>An <code>AFTER UPDATE</code> trigger writing <code>to_jsonb(OLD)</code>/<code>to_jsonb(NEW)</code> diffs into <code>task_events</code> powers the activity stream, "who changed status" questions, and accurate burndown with scope changes.</p>
<h4>Custom fields</h4>
<p>Jira-style custom fields per project fit a <code>custom jsonb</code> column validated against a per-project JSON schema in the app, with GIN indexing for filters.</p>`
});

/* ------------------------------------------------------------------ 5. HOSPITAL */
PGM.PROJECTS.push({
  id: 'hospital',
  title: 'Hospital Management System',
  icon: '🏥',
  level: 4,
  summary: 'Patients, doctors, appointment scheduling with database-enforced no-double-booking, admissions and bed allocation, prescriptions and lab results.',
  requirements: [
    'Patients are registered once (unique MRN) and visit many times.',
    'Doctors belong to departments and have consultation slots; a doctor can never have two overlapping appointments.',
    'In-patient admissions occupy a bed; a bed can hold only one patient at a time.',
    'Prescriptions list medicines with dosage; lab orders produce results with reference ranges.',
    'Strict access control and audit: clinical data is sensitive.',
    'Operational reports: bed occupancy, doctor utilisation, average length of stay.'
  ],
  entities: [
    { name: 'patients', desc: 'Demographics with Medical Record Number (MRN).' },
    { name: 'departments', desc: 'Clinical departments (Cardiology, Orthopaedics...).' },
    { name: 'doctors', desc: 'Clinicians with registration number and department.' },
    { name: 'appointments', desc: 'Doctor-patient slot as tstzrange; overlaps blocked by EXCLUDE.' },
    { name: 'wards', desc: 'Wards (General, ICU) with daily rate.' },
    { name: 'beds', desc: 'Beds within wards.' },
    { name: 'admissions', desc: 'In-patient stay over a tstzrange on a bed.' },
    { name: 'prescriptions', desc: 'Medicines prescribed during an appointment.' },
    { name: 'lab_results', desc: 'Test results with units and reference ranges.' }
  ],
  relationships: [
    { from: 'doctors', to: 'departments', type: 'N:1', label: 'works in' },
    { from: 'appointments', to: 'doctors', type: 'N:1', label: 'with' },
    { from: 'appointments', to: 'patients', type: 'N:1', label: 'for' },
    { from: 'beds', to: 'wards', type: 'N:1', label: 'in' },
    { from: 'admissions', to: 'patients', type: 'N:1', label: 'admits' },
    { from: 'admissions', to: 'beds', type: 'N:1', label: 'occupies' },
    { from: 'admissions', to: 'doctors', type: 'N:1', label: 'attending' },
    { from: 'prescriptions', to: 'appointments', type: 'N:1', label: 'issued at' },
    { from: 'lab_results', to: 'patients', type: 'N:1', label: 'of' }
  ],
  ddl: `CREATE EXTENSION IF NOT EXISTS btree_gist;   -- for EXCLUDE (doctor_id WITH =, slot WITH &&)

CREATE TABLE patients (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mrn         text NOT NULL UNIQUE,
  full_name   text NOT NULL,
  birth_date  date NOT NULL,
  sex         char(1) NOT NULL CHECK (sex IN ('M','F','O')),
  phone       text,
  blood_group text CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

CREATE TABLE doctors (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reg_no         text NOT NULL UNIQUE,         -- medical council registration
  full_name      text NOT NULL,
  department_id  int NOT NULL REFERENCES departments(id),
  fee            numeric(8,2) NOT NULL CHECK (fee >= 0)
);

CREATE TABLE appointments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id   int    NOT NULL REFERENCES doctors(id),
  patient_id  bigint NOT NULL REFERENCES patients(id),
  slot        tstzrange NOT NULL CHECK (lower(slot) < upper(slot)),
  status      text NOT NULL DEFAULT 'booked'
              CHECK (status IN ('booked','checked_in','completed','cancelled','no_show')),
  notes       text,
  -- a doctor cannot be in two places at once; cancelled rows free the slot
  CONSTRAINT no_double_booking
    EXCLUDE USING gist (doctor_id WITH =, slot WITH &&) WHERE (status <> 'cancelled'),
  -- a patient cannot book two overlapping appointments either
  CONSTRAINT no_patient_overlap
    EXCLUDE USING gist (patient_id WITH =, slot WITH &&) WHERE (status <> 'cancelled')
);

CREATE TABLE wards (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  daily_rate  numeric(10,2) NOT NULL CHECK (daily_rate >= 0)
);

CREATE TABLE beds (
  id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ward_id  int NOT NULL REFERENCES wards(id),
  label    text NOT NULL,
  UNIQUE (ward_id, label)
);

CREATE TABLE admissions (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id           bigint NOT NULL REFERENCES patients(id),
  bed_id               int    NOT NULL REFERENCES beds(id),
  attending_doctor_id  int    NOT NULL REFERENCES doctors(id),
  stay                 tstzrange NOT NULL,          -- upper bound NULL = still admitted
  diagnosis_code       text,                        -- e.g. ICD-10 code
  CONSTRAINT one_patient_per_bed EXCLUDE USING gist (bed_id WITH =, stay WITH &&),
  CONSTRAINT one_bed_per_patient EXCLUDE USING gist (patient_id WITH =, stay WITH &&)
);

CREATE TABLE prescriptions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id  bigint NOT NULL REFERENCES appointments(id),
  medicine        text NOT NULL,
  dose            text NOT NULL,           -- '500 mg'
  frequency       text NOT NULL,           -- '1-0-1'
  days            smallint NOT NULL CHECK (days > 0)
);

CREATE TABLE lab_results (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id   bigint NOT NULL REFERENCES patients(id),
  test_code    text NOT NULL,
  value        numeric NOT NULL,
  unit         text NOT NULL,
  ref_low      numeric,
  ref_high     numeric,
  resulted_at  timestamptz NOT NULL
);`,
  sampleData: `INSERT INTO patients (mrn, full_name, birth_date, sex, phone, blood_group) VALUES
 ('MRN-0001', 'Suresh Verma',  '1958-03-14', 'M', '+91-9811111111', 'B+'),
 ('MRN-0002', 'Lakshmi Iyer',  '1984-11-02', 'F', '+91-9811111112', 'O+'),
 ('MRN-0003', 'Farhan Ali',    '1992-07-21', 'M', '+91-9811111113', 'A-'),
 ('MRN-0004', 'Gurpreet Kaur', '1975-01-30', 'F', '+91-9811111114', 'AB+'),
 ('MRN-0005', 'Tenzin Norbu',  '2001-05-09', 'M', '+91-9811111115', 'O-');

INSERT INTO departments (name) VALUES ('Cardiology'), ('Orthopaedics'), ('General Medicine');

INSERT INTO doctors (reg_no, full_name, department_id, fee) VALUES
 ('DMC-11223', 'Dr. Nandini Rao',   1, 1200),
 ('DMC-22334', 'Dr. Vivek Malhotra',2, 1000),
 ('DMC-33445', 'Dr. Sana Qureshi',  3,  600);

INSERT INTO appointments (doctor_id, patient_id, slot, status) VALUES
 (1, 1, '[2025-09-22 10:00+05:30, 2025-09-22 10:20+05:30)', 'completed'),
 (1, 4, '[2025-09-22 10:20+05:30, 2025-09-22 10:40+05:30)', 'completed'),
 (1, 2, '[2025-09-22 10:40+05:30, 2025-09-22 11:00+05:30)', 'no_show'),
 (2, 3, '[2025-09-22 11:00+05:30, 2025-09-22 11:15+05:30)', 'completed'),
 (3, 5, '[2025-09-22 09:00+05:30, 2025-09-22 09:15+05:30)', 'completed'),
 (3, 2, '[2025-09-22 09:15+05:30, 2025-09-22 09:30+05:30)', 'completed'),
 (1, 3, '[2025-09-23 10:00+05:30, 2025-09-23 10:20+05:30)', 'cancelled'),
 (1, 5, '[2025-09-23 10:00+05:30, 2025-09-23 10:20+05:30)', 'booked');   -- reused cancelled slot

INSERT INTO wards (name, daily_rate) VALUES ('General', 2500), ('ICU', 18000);
INSERT INTO beds (ward_id, label) VALUES (1, 'G-01'), (1, 'G-02'), (1, 'G-03'), (2, 'ICU-1'), (2, 'ICU-2');

INSERT INTO admissions (patient_id, bed_id, attending_doctor_id, stay, diagnosis_code) VALUES
 (1, 4, 1, '[2025-09-10 14:00+05:30, 2025-09-14 11:00+05:30)', 'I21.9'),
 (1, 1, 1, '[2025-09-14 11:00+05:30, 2025-09-18 10:00+05:30)', 'I21.9'),
 (3, 2, 2, '[2025-09-15 09:00+05:30, 2025-09-17 12:00+05:30)', 'S82.2'),
 (4, 5, 1, '[2025-09-21 20:00+05:30,)', 'I50.9');

INSERT INTO prescriptions (appointment_id, medicine, dose, frequency, days) VALUES
 (1, 'Atorvastatin', '40 mg',  '0-0-1', 90),
 (1, 'Aspirin',      '75 mg',  '1-0-0', 90),
 (4, 'Paracetamol',  '650 mg', '1-1-1', 5),
 (5, 'Cetirizine',   '10 mg',  '0-0-1', 7);

INSERT INTO lab_results (patient_id, test_code, value, unit, ref_low, ref_high, resulted_at) VALUES
 (1, 'LDL',   162, 'mg/dL', 0,   100, '2025-09-11 08:00+05:30'),
 (1, 'LDL',   131, 'mg/dL', 0,   100, '2025-09-17 08:00+05:30'),
 (1, 'TROPI', 2.4, 'ng/mL', 0,  0.04, '2025-09-10 15:00+05:30'),
 (1, 'TROPI', 0.6, 'ng/mL', 0,  0.04, '2025-09-12 08:00+05:30'),
 (2, 'HB',   11.2, 'g/dL',  12,  15.5, '2025-09-22 09:40+05:30'),
 (4, 'BNP',   890, 'pg/mL', 0,   100, '2025-09-21 21:00+05:30');`,
  indexes: `-- The EXCLUDE constraints already built GiST indexes on (doctor_id, slot), (patient_id, slot),
-- (bed_id, stay), (patient_id, stay). They also answer "free beds now" and "doctor's day" queries.
-- Patient timeline (labs ordered by time, per test) — most common clinical lookup.
CREATE INDEX idx_lab_patient_test_time ON lab_results (patient_id, test_code, resulted_at DESC);
CREATE INDEX idx_prescriptions_appt ON prescriptions (appointment_id);
-- Current in-patients: open-ended stays. upper_inf() is immutable so it can be indexed.
CREATE INDEX idx_admissions_current ON admissions (bed_id) WHERE upper_inf(stay);
-- Front-desk search by name prefix (text_pattern_ops supports LIKE 'abc%' in non-C collations).
CREATE INDEX idx_patients_name ON patients (lower(full_name) text_pattern_ops);`,
  queries: [
    {
      title: 'Free 20-minute slots for a doctor on a day (generate_series + NOT EXISTS overlap)',
      sql: `SELECT s AS slot_start, s + INTERVAL '20 minutes' AS slot_end
FROM generate_series(TIMESTAMPTZ '2025-09-22 10:00+05:30',
                     TIMESTAMPTZ '2025-09-22 12:40+05:30',
                     INTERVAL '20 minutes') AS s
WHERE NOT EXISTS (
  SELECT 1 FROM appointments a
  WHERE a.doctor_id = 1
    AND a.status <> 'cancelled'
    AND a.slot && tstzrange(s, s + INTERVAL '20 minutes')
)
ORDER BY s;`,
      explain: 'Candidate slots come from generate_series; && (overlaps) against booked ranges filters taken ones and uses the GiST index created by the exclusion constraint. This is only a display: the EXCLUDE constraint is what actually prevents two receptionists booking the same slot.'
    },
    {
      title: 'Live bed occupancy by ward',
      sql: `SELECT w.name AS ward,
       COUNT(b.id) AS beds,
       COUNT(a.id) AS occupied,
       ROUND(100.0 * COUNT(a.id) / COUNT(b.id), 1) AS occupancy_pct,
       string_agg(b.label, ', ' ORDER BY b.label) FILTER (WHERE a.id IS NULL) AS free_beds
FROM wards w
JOIN beds b ON b.ward_id = w.id
LEFT JOIN admissions a ON a.bed_id = b.id AND a.stay @> TIMESTAMPTZ '2025-09-22 12:00+05:30'
GROUP BY w.name
ORDER BY w.name;`,
      explain: 'stay @> timestamp means "admitted at that instant"; the open-ended range [start,) counts as still admitted. Putting the time predicate in the LEFT JOIN condition (not WHERE) keeps empty beds in the result.'
    },
    {
      title: 'Length of stay and bill estimate per admission (range functions)',
      sql: `SELECT p.full_name, w.name AS ward, b.label,
       lower(a.stay) AS admitted,
       upper(a.stay) AS discharged,
       ROUND(EXTRACT(EPOCH FROM (COALESCE(upper(a.stay), TIMESTAMPTZ '2025-09-22 12:00+05:30') - lower(a.stay))) / 86400, 1) AS los_days,
       CEIL(EXTRACT(EPOCH FROM (COALESCE(upper(a.stay), TIMESTAMPTZ '2025-09-22 12:00+05:30') - lower(a.stay))) / 86400) * w.daily_rate AS bed_charges
FROM admissions a
JOIN patients p ON p.id = a.patient_id
JOIN beds b ON b.id = a.bed_id
JOIN wards w ON w.id = b.ward_id
ORDER BY p.full_name, lower(a.stay);`,
      explain: 'lower()/upper() extract range bounds; an unbounded upper means still admitted, so it is replaced with "now". Hospitals bill by started day, hence CEIL. Patient 1 moved from ICU to General — two rows, each priced at its own ward rate.'
    },
    {
      title: 'Lab trend: latest value, previous value and abnormal flag (LAG + DISTINCT ON)',
      sql: `SELECT DISTINCT ON (patient_id, test_code)
       p.full_name, test_code, value, unit, resulted_at,
       LAG(value) OVER (PARTITION BY patient_id, test_code ORDER BY resulted_at) AS previous_value,
       CASE WHEN value < ref_low THEN 'LOW' WHEN value > ref_high THEN 'HIGH' ELSE 'normal' END AS flag
FROM lab_results lr
JOIN patients p ON p.id = lr.patient_id
ORDER BY patient_id, test_code, resulted_at DESC;`,
      explain: 'Window functions are evaluated before DISTINCT ON, so LAG sees all results; DISTINCT ON then keeps only the newest row per (patient, test) thanks to ORDER BY resulted_at DESC. Clinicians read this as "Troponin 0.6, down from 2.4 — still HIGH".'
    },
    {
      title: 'Doctor utilisation and no-show rate per day',
      sql: `SELECT d.full_name, lower(a.slot)::date AS day,
       COUNT(*) FILTER (WHERE a.status <> 'cancelled') AS booked,
       COUNT(*) FILTER (WHERE a.status = 'completed') AS seen,
       ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'no_show')
             / NULLIF(COUNT(*) FILTER (WHERE a.status <> 'cancelled'), 0), 1) AS no_show_pct,
       SUM(d.fee) FILTER (WHERE a.status = 'completed') AS consult_revenue
FROM appointments a JOIN doctors d ON d.id = a.doctor_id
GROUP BY d.full_name, lower(a.slot)::date
ORDER BY day, d.full_name;`,
      explain: 'Conditional aggregates with FILTER build an operations dashboard in one scan. High no-show rates drive overbooking policies and SMS reminders.'
    }
  ],
  transactions: `-- 1. Book an appointment. No SELECT-then-INSERT race is possible: the EXCLUDE
--    constraint makes the INSERT itself fail with SQLSTATE 23P01 (exclusion_violation)
--    if another transaction booked an overlapping slot first. The app catches 23P01
--    and shows "slot just taken".
BEGIN;
INSERT INTO appointments (doctor_id, patient_id, slot)
VALUES (3, 1, '[2025-09-22 09:30+05:30, 2025-09-22 09:45+05:30)')
RETURNING id;
COMMIT;

-- 2. Transfer a patient from ICU to a General bed atomically:
--    close the current stay and open a new one at the same instant.
BEGIN;
SELECT id, bed_id, stay FROM admissions
WHERE patient_id = 4 AND upper_inf(stay)
FOR UPDATE;

UPDATE admissions
SET stay = tstzrange(lower(stay), TIMESTAMPTZ '2025-09-24 10:00+05:30')
WHERE patient_id = 4 AND upper_inf(stay);

-- picks a free General bed; the EXCLUDE on bed_id guarantees nobody else took it
INSERT INTO admissions (patient_id, bed_id, attending_doctor_id, stay, diagnosis_code)
SELECT 4, b.id, 1, tstzrange(TIMESTAMPTZ '2025-09-24 10:00+05:30', NULL), 'I50.9'
FROM beds b
WHERE b.ward_id = 1
  AND NOT EXISTS (SELECT 1 FROM admissions a
                  WHERE a.bed_id = b.id AND a.stay && tstzrange(TIMESTAMPTZ '2025-09-24 10:00+05:30', NULL))
ORDER BY b.label
LIMIT 1;
COMMIT;`,
  optimization: `<h4>Workload</h4>
<p>A 1,000-bed hospital generates ~5,000 appointments, ~50,000 lab results and hundreds of thousands of vitals readings (from monitors) per day. Vitals/telemetry is time-series and dwarfs everything else.</p>
<h4>Partitioning</h4>
<ul>
<li>Partition <code>lab_results</code>, vitals and audit logs by month on the timestamp. Clinical queries are almost always "this patient, recent", so also keep the (patient_id, test_code, time) index per partition.</li>
<li>Appointments rarely need partitioning; archive completed years instead.</li>
</ul>
<h4>Hotspots</h4>
<ul>
<li>8-10 AM booking storms on popular doctors: the exclusion constraint serialises only overlapping slots, not the whole doctor, so contention stays low.</li>
<li>Reporting queries (occupancy, revenue) belong on a streaming replica so they never compete with bedside workflows.</li>
</ul>
<h4>At 100x scale (hospital chain)</h4>
<p>Shard by hospital/facility id (patients registered at multiple facilities get a master patient index). Keep each facility's operational DB available even if the central link is down — clinical systems must work offline locally and sync later.</p>`,
  advanced: `<h4>Exclusion constraints vs. application checks</h4>
<p>"SELECT to check availability, then INSERT" has a race window under READ COMMITTED: two transactions both see the slot free and both insert. A unique index cannot express "ranges must not overlap"; <code>EXCLUDE USING gist (doctor_id WITH =, slot WITH &amp;&amp;)</code> can, and it is enforced atomically by the index. <span class="tag core">core</span> feature; the <code>=</code> on an integer inside GiST needs <span class="tag ext">extension</span> btree_gist.</p>
<h4>Security and compliance</h4>
<ul>
<li>Row-Level Security so a doctor sees only patients under their care; break-glass access logged.</li>
<li>Column-level GRANTs: billing staff cannot read <code>lab_results</code>.</li>
<li>Encrypt backups and use TLS; log every access to clinical tables (pgAudit <span class="tag ext">extension</span>).</li>
<li>Never hard-delete clinical records; use status columns and retention policies defined by law.</li>
</ul>
<h4>Interoperability</h4>
<p>Exchange with other systems in HL7 FHIR JSON; storing raw FHIR resources in <code>jsonb</code> next to normalised columns is a common hybrid.</p>`
});

/* ------------------------------------------------------------------ 6. LOGISTICS */
PGM.PROJECTS.push({
  id: 'logistics',
  title: 'Logistics & Shipment Tracking',
  icon: '🚚',
  level: 4,
  summary: 'Hubs, vehicles, shipments with an append-only tracking event stream, SLA analytics and a SKIP LOCKED dispatch queue.',
  requirements: [
    'Shipments move between hubs; each scan (picked up, in transit, out for delivery, delivered, failed) is an immutable tracking event.',
    'Customers query "where is my parcel" by AWB number at very high read volume.',
    'Dispatch assigns pending shipments to vehicles concurrently from many dispatcher workers without double assignment.',
    'Vehicles have weight capacity; a manifest cannot exceed it.',
    'SLA: promised delivery date per shipment; report on-time %, transit time percentiles per lane.',
    'Cash-on-delivery amounts must be tracked until remitted.'
  ],
  entities: [
    { name: 'hubs', desc: 'Warehouses / sort centres with city and pincode.' },
    { name: 'vehicles', desc: 'Trucks / vans with capacity in kg.' },
    { name: 'shipments', desc: 'One parcel/consignment: AWB, origin/destination hubs, weight, SLA date, current status.' },
    { name: 'tracking_events', desc: 'Append-only scan history (status, hub, timestamp).' },
    { name: 'manifests', desc: 'A vehicle trip between hubs on a date.' },
    { name: 'manifest_items', desc: 'Shipments loaded on a manifest.' }
  ],
  relationships: [
    { from: 'shipments', to: 'hubs', type: 'N:1', label: 'origin' },
    { from: 'shipments', to: 'hubs', type: 'N:1', label: 'destination' },
    { from: 'tracking_events', to: 'shipments', type: 'N:1', label: 'tracks' },
    { from: 'tracking_events', to: 'hubs', type: 'N:1', label: 'scanned at' },
    { from: 'manifests', to: 'vehicles', type: 'N:1', label: 'uses' },
    { from: 'manifest_items', to: 'manifests', type: 'N:1', label: 'loaded on' },
    { from: 'manifest_items', to: 'shipments', type: '1:1', label: 'carries' }
  ],
  ddl: `CREATE TABLE hubs (
  id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code     text NOT NULL UNIQUE,
  city     text NOT NULL,
  pincode  char(6) NOT NULL
);

CREATE TABLE vehicles (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reg_no       text NOT NULL UNIQUE,
  capacity_kg  numeric(8,1) NOT NULL CHECK (capacity_kg > 0),
  home_hub_id  int NOT NULL REFERENCES hubs(id),
  active       boolean NOT NULL DEFAULT true
);

CREATE TABLE shipments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  awb             text NOT NULL UNIQUE,                  -- air waybill / tracking number
  origin_hub_id   int NOT NULL REFERENCES hubs(id),
  dest_hub_id     int NOT NULL REFERENCES hubs(id),
  weight_kg       numeric(7,2) NOT NULL CHECK (weight_kg > 0),
  cod_amount      numeric(10,2) NOT NULL DEFAULT 0 CHECK (cod_amount >= 0),
  status          text NOT NULL DEFAULT 'created'
                  CHECK (status IN ('created','picked_up','in_transit','out_for_delivery','delivered','failed','rto')),
  promised_by     date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  CHECK (origin_hub_id <> dest_hub_id)
);

-- Append-only event log: never updated, only inserted
CREATE TABLE tracking_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id  bigint NOT NULL REFERENCES shipments(id),
  status       text NOT NULL,
  hub_id       int REFERENCES hubs(id),
  remarks      text,
  event_at     timestamptz NOT NULL
);

CREATE TABLE manifests (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id   int NOT NULL REFERENCES vehicles(id),
  from_hub_id  int NOT NULL REFERENCES hubs(id),
  to_hub_id    int NOT NULL REFERENCES hubs(id),
  trip_date    date NOT NULL,
  loaded_kg    numeric(8,1) NOT NULL DEFAULT 0 CHECK (loaded_kg >= 0),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','departed','arrived')),
  UNIQUE (vehicle_id, trip_date)
);

CREATE TABLE manifest_items (
  manifest_id  bigint NOT NULL REFERENCES manifests(id),
  shipment_id  bigint NOT NULL REFERENCES shipments(id),
  PRIMARY KEY (manifest_id, shipment_id)
);`,
  sampleData: `INSERT INTO hubs (code, city, pincode) VALUES
 ('DEL-GGN', 'Gurugram', '122015'), ('BOM-BHW', 'Bhiwandi', '421302'),
 ('BLR-HSK', 'Hoskote',  '562114'), ('MAA-PNM', 'Chennai',  '600099');

INSERT INTO vehicles (reg_no, capacity_kg, home_hub_id) VALUES
 ('HR55AB1234', 9000, 1), ('MH04CD5678', 12000, 2), ('KA01EF9012', 7500, 3);

INSERT INTO shipments (awb, origin_hub_id, dest_hub_id, weight_kg, cod_amount, status, promised_by, created_at, delivered_at) VALUES
 ('AWB1000001', 1, 2,   2.50,    0, 'delivered',  '2025-09-04', '2025-09-01 10:00+05:30', '2025-09-03 15:20+05:30'),
 ('AWB1000002', 1, 3,  12.00, 1499, 'delivered',  '2025-09-05', '2025-09-01 11:30+05:30', '2025-09-06 12:10+05:30'),
 ('AWB1000003', 2, 1,   0.80,    0, 'delivered',  '2025-09-04', '2025-09-02 09:00+05:30', '2025-09-04 18:45+05:30'),
 ('AWB1000004', 3, 4,   5.00,  899, 'out_for_delivery', '2025-09-05', '2025-09-03 14:00+05:30', NULL),
 ('AWB1000005', 1, 2,  30.00,    0, 'in_transit', '2025-09-08', '2025-09-05 08:00+05:30', NULL),
 ('AWB1000006', 1, 2,   7.50,  350, 'created',    '2025-09-09', '2025-09-06 10:00+05:30', NULL),
 ('AWB1000007', 1, 3,   1.20,    0, 'created',    '2025-09-09', '2025-09-06 10:05+05:30', NULL),
 ('AWB1000008', 4, 3,   3.30, 1200, 'failed',     '2025-09-06', '2025-09-03 16:00+05:30', NULL);

INSERT INTO tracking_events (shipment_id, status, hub_id, remarks, event_at) VALUES
 (1, 'picked_up',        1, NULL,                 '2025-09-01 13:00+05:30'),
 (1, 'in_transit',       1, 'Departed',           '2025-09-01 22:00+05:30'),
 (1, 'in_transit',       2, 'Arrived',            '2025-09-03 06:30+05:30'),
 (1, 'out_for_delivery', 2, NULL,                 '2025-09-03 09:00+05:30'),
 (1, 'delivered',        2, 'Received by self',   '2025-09-03 15:20+05:30'),
 (2, 'picked_up',        1, NULL,                 '2025-09-01 15:00+05:30'),
 (2, 'in_transit',       3, 'Arrived',            '2025-09-04 07:00+05:30'),
 (2, 'out_for_delivery', 3, NULL,                 '2025-09-05 09:30+05:30'),
 (2, 'failed',           3, 'Customer not available', '2025-09-05 17:00+05:30'),
 (2, 'out_for_delivery', 3, 'Reattempt',          '2025-09-06 09:15+05:30'),
 (2, 'delivered',        3, 'COD collected',      '2025-09-06 12:10+05:30'),
 (3, 'picked_up',        2, NULL,                 '2025-09-02 12:00+05:30'),
 (3, 'delivered',        1, NULL,                 '2025-09-04 18:45+05:30'),
 (4, 'picked_up',        3, NULL,                 '2025-09-03 17:00+05:30'),
 (4, 'in_transit',       4, 'Arrived',            '2025-09-04 23:00+05:30'),
 (4, 'out_for_delivery', 4, NULL,                 '2025-09-05 08:40+05:30'),
 (5, 'picked_up',        1, NULL,                 '2025-09-05 11:00+05:30'),
 (5, 'in_transit',       1, 'Departed',           '2025-09-05 21:00+05:30'),
 (8, 'picked_up',        4, NULL,                 '2025-09-03 18:00+05:30'),
 (8, 'failed',           3, 'Address not found',  '2025-09-06 13:00+05:30');

INSERT INTO manifests (vehicle_id, from_hub_id, to_hub_id, trip_date, loaded_kg, status) VALUES
 (1, 1, 2, '2025-09-01', 2.5, 'arrived'),
 (1, 1, 2, '2025-09-05', 30.0, 'departed');
INSERT INTO manifest_items VALUES (1, 1), (2, 5);`,
  indexes: `-- "Where is my parcel": the latest events of one shipment. (shipment_id, event_at DESC)
-- returns them pre-sorted; LIMIT 1 reads a single index entry.
CREATE INDEX idx_events_shipment_time ON tracking_events (shipment_id, event_at DESC);
-- Dispatch queue: only 'created' shipments are candidates; partial index stays tiny even
-- with hundreds of millions of delivered shipments in the table.
CREATE INDEX idx_shipments_dispatch ON shipments (origin_hub_id, created_at) WHERE status = 'created';
-- Lane analytics and SLA reports filter by creation date.
CREATE INDEX idx_shipments_created ON shipments (created_at);
-- Reverse lookup: which manifest is a shipment on?
CREATE INDEX idx_manifest_items_shipment ON manifest_items (shipment_id);
-- Event tables are append-only and time-ordered: BRIN is ~1000x smaller than B-tree for time ranges.
CREATE INDEX idx_events_time_brin ON tracking_events USING brin (event_at);`,
  queries: [
    {
      title: 'Track a parcel: full timeline with time spent between scans (LAG)',
      sql: `SELECT te.event_at, te.status, h.city AS location, te.remarks,
       te.event_at - LAG(te.event_at) OVER (ORDER BY te.event_at) AS since_previous
FROM tracking_events te
JOIN shipments s ON s.id = te.shipment_id
LEFT JOIN hubs h ON h.id = te.hub_id
WHERE s.awb = 'AWB1000002'
ORDER BY te.event_at;`,
      explain: 'The UNIQUE index on awb finds the shipment; idx_events_shipment_time returns its events in order. LAG shows dwell time between scans — long gaps reveal stuck parcels.'
    },
    {
      title: 'Latest status of every open shipment (DISTINCT ON vs. LATERAL)',
      sql: `SELECT s.awb, s.status AS header_status, last.status AS last_scan, last.event_at, h.city
FROM shipments s
LEFT JOIN LATERAL (
  SELECT te.status, te.event_at, te.hub_id
  FROM tracking_events te
  WHERE te.shipment_id = s.id
  ORDER BY te.event_at DESC
  LIMIT 1
) last ON true
LEFT JOIN hubs h ON h.id = last.hub_id
WHERE s.status NOT IN ('delivered', 'rto')
ORDER BY s.awb;`,
      explain: 'LATERAL + ORDER BY ... LIMIT 1 performs one tiny index probe per shipment — ideal when you need the latest event for a small, filtered set of shipments. DISTINCT ON over the whole events table is better when you need it for most shipments.'
    },
    {
      title: 'SLA report per lane: on-time %, median and p90 transit hours (percentile_cont)',
      sql: `SELECT o.code || ' -> ' || d.code AS lane,
       COUNT(*) AS delivered,
       ROUND(100.0 * COUNT(*) FILTER (WHERE s.delivered_at::date <= s.promised_by) / COUNT(*), 1) AS on_time_pct,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM s.delivered_at - s.created_at) / 3600))::numeric, 1) AS median_hours,
       ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM s.delivered_at - s.created_at) / 3600))::numeric, 1) AS p90_hours
FROM shipments s
JOIN hubs o ON o.id = s.origin_hub_id
JOIN hubs d ON d.id = s.dest_hub_id
WHERE s.status = 'delivered'
GROUP BY lane
ORDER BY lane;`,
      explain: 'percentile_cont is an ordered-set aggregate: WITHIN GROUP (ORDER BY ...) defines the distribution. p90 matters more than the average for customer promises — averages hide the long tail of late parcels.'
    },
    {
      title: 'Delivery attempts and first-attempt success rate',
      sql: `WITH attempts AS (
  SELECT shipment_id,
         COUNT(*) FILTER (WHERE status = 'out_for_delivery') AS attempts,
         bool_or(status = 'delivered') AS delivered
  FROM tracking_events
  GROUP BY shipment_id
)
SELECT COUNT(*) FILTER (WHERE attempts > 0) AS shipments_attempted,
       COUNT(*) FILTER (WHERE delivered AND attempts = 1) AS first_attempt_success,
       ROUND(100.0 * COUNT(*) FILTER (WHERE delivered AND attempts = 1)
             / NULLIF(COUNT(*) FILTER (WHERE attempts > 0), 0), 1) AS fasr_pct,
       MAX(attempts) AS max_attempts
FROM attempts;`,
      explain: 'bool_or aggregates booleans. First-attempt delivery success rate is a key last-mile KPI: every reattempt costs fuel and a rider slot.'
    },
    {
      title: 'Undelivered COD exposure per destination hub',
      sql: `SELECT h.city, COUNT(*) AS cod_parcels, SUM(s.cod_amount) AS cod_value,
       SUM(s.cod_amount) FILTER (WHERE s.status = 'failed') AS at_risk_value
FROM shipments s
JOIN hubs h ON h.id = s.dest_hub_id
WHERE s.cod_amount > 0 AND s.status <> 'delivered'
GROUP BY h.city
ORDER BY cod_value DESC;`,
      explain: 'Finance tracks cash still in the network. Failed COD parcels usually turn into RTO (return to origin) — revenue at risk.'
    }
  ],
  transactions: `-- Dispatch worker: claim up to 50 'created' shipments at hub 1 and load them on a manifest.
-- FOR UPDATE SKIP LOCKED lets 20 workers run this concurrently: each grabs a disjoint
-- batch instead of blocking on (or double-assigning) rows another worker holds.
BEGIN;

WITH m AS (
  INSERT INTO manifests (vehicle_id, from_hub_id, to_hub_id, trip_date)
  VALUES (1, 1, 2, DATE '2025-09-06')
  ON CONFLICT (vehicle_id, trip_date) DO UPDATE SET status = manifests.status
  RETURNING id
), picked AS (
  SELECT s.id, s.weight_kg
  FROM shipments s
  WHERE s.status = 'created' AND s.origin_hub_id = 1 AND s.dest_hub_id = 2
  ORDER BY s.created_at
  LIMIT 50
  FOR UPDATE SKIP LOCKED
), loaded AS (
  INSERT INTO manifest_items (manifest_id, shipment_id)
  SELECT m.id, picked.id FROM m, picked
  RETURNING shipment_id
), upd AS (
  UPDATE shipments s SET status = 'picked_up'
  FROM loaded WHERE s.id = loaded.shipment_id
  RETURNING s.id
)
INSERT INTO tracking_events (shipment_id, status, hub_id, remarks, event_at)
SELECT id, 'picked_up', 1, 'Loaded on manifest', now() FROM upd;

-- Capacity check: lock the vehicle's manifest and recompute load; abort if over capacity.
UPDATE manifests mf
SET loaded_kg = sub.total
FROM (SELECT mi.manifest_id, SUM(s.weight_kg) AS total
      FROM manifest_items mi JOIN shipments s ON s.id = mi.shipment_id
      GROUP BY mi.manifest_id) sub
WHERE mf.id = sub.manifest_id AND mf.vehicle_id = 1 AND mf.trip_date = DATE '2025-09-06';
-- If loaded_kg > capacity the app issues ROLLBACK (or enforce with a constraint trigger).

COMMIT;`,
  optimization: `<h4>Scale profile</h4>
<p>A national courier handles 5-10 million shipments/day with ~8 scans each: 50-80 million tracking events/day (~1,000 inserts/s average, 5x at evening sort peaks). Tracking reads are even higher (customers refresh, e-commerce sites poll).</p>
<h4>Partitioning <span class="tag core">core</span></h4>
<ul>
<li><code>tracking_events</code>: range-partition by <code>event_at</code> (daily or weekly). Dropping a partition after the retention period (e.g. 180 days) is instant, unlike DELETE which bloats.</li>
<li><code>shipments</code>: monthly partitions on <code>created_at</code>. The AWB lookup then needs the date — encode it in the AWB (e.g. prefix with yymm) so the app can route to one partition.</li>
</ul>
<h4>Hotspots</h4>
<ul>
<li>"Where is my parcel" traffic: cache the latest status per AWB (denormalised <code>shipments.status</code> plus an in-memory cache); serve history from read replicas.</li>
<li>Sort-centre bursts: batch scanner events (COPY or multi-row INSERT every second) instead of single-row commits; consider <code>synchronous_commit = off</code> for scan events only (session/transaction level), accepting a tiny loss window.</li>
</ul>
<h4>At 100x scale</h4>
<p>Shard by AWB hash (tracking is always per AWB), keep hub-level operational tables per region, and stream events via CDC to an analytics warehouse for lane/SLA analytics.</p>`,
  advanced: `<h4>Event sourcing light</h4>
<p><code>tracking_events</code> is the truth; <code>shipments.status</code> is a projection updated in the same transaction. If they ever disagree, the projection can be rebuilt from events with a DISTINCT ON query.</p>
<h4>Geospatial</h4>
<p>Rider GPS, geofenced delivery confirmation and nearest-hub lookups use the <span class="tag ext">extension</span> PostGIS (<code>geography(Point)</code>, <code>ST_DWithin</code>, GiST indexes). Core PostgreSQL has only basic geometric types without geodesic distance.</p>
<h4>Queue tables done right</h4>
<ul>
<li><code>FOR UPDATE SKIP LOCKED</code> + a partial index on the queue state is the canonical PostgreSQL job-queue pattern.</li>
<li>Rows leaving the queue should change state (not stay "created" forever) so the partial index shrinks; tune autovacuum aggressively on hot queue tables because of churn.</li>
</ul>
<div class="callout tip">BRIN indexes shine on append-only, time-correlated tables like tracking_events: a few hundred kilobytes can index billions of rows for time-range scans. Verify correlation stays high (no backfills out of order).</div>`
});

/* ------------------------------------------------------------------ 7. SOCIAL MEDIA */
PGM.PROJECTS.push({
  id: 'social-media',
  title: 'Social Media Platform',
  icon: '📸',
  level: 4,
  summary: 'Users, follow graph, posts, likes with denormalised counters, threaded comments, hashtags, home feed and friend suggestions.',
  requirements: [
    'Users follow other users (directed graph, no self-follow, no duplicates).',
    'Posts with text/media, hashtags extracted into a lookup table.',
    'Likes: one per user per post; like counts displayed on every post view must be cheap.',
    'Comments can reply to comments (threads).',
    'Home feed = recent posts from accounts you follow, newest first, with infinite scroll.',
    'Discovery: trending hashtags and "people you may know" (friends of friends).'
  ],
  entities: [
    { name: 'users', desc: 'Accounts with handle and counters.' },
    { name: 'follows', desc: 'Edge table follower_id -> followee_id.' },
    { name: 'posts', desc: 'Content with denormalised like_count and comment_count.' },
    { name: 'likes', desc: 'User-post likes (composite PK).' },
    { name: 'comments', desc: 'Comments with optional parent_id for replies.' },
    { name: 'hashtags', desc: 'Unique tag names.' },
    { name: 'post_hashtags', desc: 'Many-to-many posts <-> hashtags.' }
  ],
  relationships: [
    { from: 'follows', to: 'users', type: 'N:1', label: 'follower' },
    { from: 'follows', to: 'users', type: 'N:1', label: 'followee' },
    { from: 'posts', to: 'users', type: 'N:1', label: 'authored by' },
    { from: 'likes', to: 'posts', type: 'N:1', label: 'on' },
    { from: 'likes', to: 'users', type: 'N:1', label: 'by' },
    { from: 'comments', to: 'posts', type: 'N:1', label: 'on' },
    { from: 'comments', to: 'comments', type: 'N:1', label: 'reply to' },
    { from: 'post_hashtags', to: 'posts', type: 'N:1', label: 'tags' },
    { from: 'post_hashtags', to: 'hashtags', type: 'N:1', label: 'uses' }
  ],
  ddl: `CREATE TABLE users (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handle           text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_.]{3,30}$'),
  display_name     text NOT NULL,
  bio              text,
  follower_count   int NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  following_count  int NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE follows (
  follower_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE TABLE posts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           text NOT NULL CHECK (length(body) <= 2200),
  media_urls     text[] NOT NULL DEFAULT '{}',
  like_count     int NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count  int NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE likes (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   bigint REFERENCES comments(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hashtags (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tag   text NOT NULL UNIQUE CHECK (tag = lower(tag))
);

CREATE TABLE post_hashtags (
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  hashtag_id  bigint NOT NULL REFERENCES hashtags(id),
  PRIMARY KEY (hashtag_id, post_id)
);`,
  sampleData: `INSERT INTO users (handle, display_name, follower_count, following_count) VALUES
 ('ananya.codes', 'Ananya',  3, 2),
 ('bharat_eats',  'Bharat',  2, 2),
 ('chai.diaries', 'Charu',   2, 3),
 ('dev.travels',  'Dev',     1, 2),
 ('esha.fit',     'Esha',    1, 0);

INSERT INTO follows (follower_id, followee_id) VALUES
 (1, 2), (1, 3),
 (2, 1), (2, 3),
 (3, 1), (3, 2), (3, 4),
 (4, 1), (4, 5);

-- relative timestamps keep feed/trending examples meaningful whenever you run them
INSERT INTO posts (author_id, body, like_count, comment_count, created_at) VALUES
 (2, 'Best chole bhature in Delhi? #food #delhi',          3, 2, now() - INTERVAL '2 hours'),
 (3, 'Masala chai at sunrise #chai #morning',              2, 1, now() - INTERVAL '5 hours'),
 (1, 'Postgres window functions are magic #postgres',      3, 1, now() - INTERVAL '1 hour'),
 (4, 'Spiti valley road trip #travel #mountains',          1, 0, now() - INTERVAL '26 hours'),
 (5, 'Morning run 10k #fitness #morning',                  1, 0, now() - INTERVAL '3 hours'),
 (3, 'Cutting chai > everything #chai',                    0, 0, now() - INTERVAL '30 minutes'),
 (2, 'Street food tour, Chandni Chowk #food',              2, 0, now() - INTERVAL '3 days');

INSERT INTO likes (user_id, post_id) VALUES
 (1, 1), (3, 1), (4, 1),
 (1, 2), (2, 2),
 (2, 3), (3, 3), (4, 3),
 (1, 4),
 (4, 5),
 (1, 7), (3, 7);

INSERT INTO comments (post_id, author_id, parent_id, body) VALUES
 (1, 1, NULL, 'Try Sita Ram Diwan Chand!'),
 (1, 2, 1,    'Going there this weekend'),
 (2, 4, NULL, 'Looks amazing'),
 (3, 3, NULL, 'Teach me LAG() please');

INSERT INTO hashtags (tag) VALUES ('food'), ('delhi'), ('chai'), ('morning'), ('postgres'), ('travel'), ('mountains'), ('fitness');
INSERT INTO post_hashtags (post_id, hashtag_id) VALUES
 (1, 1), (1, 2), (2, 3), (2, 4), (3, 5), (4, 6), (4, 7), (5, 8), (5, 4), (6, 3), (7, 1);`,
  indexes: `-- Feed: "recent posts by author X" — composite matches WHERE author_id = ANY(...) ORDER BY created_at DESC.
CREATE INDEX idx_posts_author_time ON posts (author_id, created_at DESC) WHERE deleted_at IS NULL;
-- Reverse edge: "who follows X" (the PK serves "whom does X follow").
CREATE INDEX idx_follows_followee ON follows (followee_id);
-- "Posts liked by user X" (PK (post_id, user_id) serves "who liked post Y").
CREATE INDEX idx_likes_user ON likes (user_id, created_at DESC);
CREATE INDEX idx_comments_post ON comments (post_id, created_at);
CREATE INDEX idx_comments_parent ON comments (parent_id);
-- Hashtag page: posts by tag; PK (hashtag_id, post_id) already leads with hashtag_id.
CREATE INDEX idx_post_hashtags_post ON post_hashtags (post_id);`,
  queries: [
    {
      title: 'Home feed for user 1 with keyset pagination (fan-out on read)',
      sql: `SELECT p.id, u.handle, p.body, p.like_count, p.comment_count, p.created_at,
       EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = 1) AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.author_id
WHERE p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = 1)
  AND p.deleted_at IS NULL
  AND (p.created_at, p.id) < (now(), 9223372036854775807)   -- cursor: last (created_at, id) seen
ORDER BY p.created_at DESC, p.id DESC
LIMIT 20;`,
      explain: 'Keyset (cursor) pagination with a row-value comparison is O(page size) at any depth, unlike OFFSET which reads and discards every skipped row. The next page passes the last row’s (created_at, id) as the cursor. EXISTS computes the viewer’s like state per post via the likes PK.'
    },
    {
      title: 'Trending hashtags in the last 24 hours with velocity ranking',
      sql: `SELECT h.tag,
       COUNT(*) AS posts_24h,
       SUM(p.like_count + 2 * p.comment_count) AS engagement,
       RANK() OVER (ORDER BY COUNT(*) DESC, SUM(p.like_count + 2 * p.comment_count) DESC) AS rnk
FROM post_hashtags ph
JOIN posts p ON p.id = ph.post_id
JOIN hashtags h ON h.id = ph.hashtag_id
WHERE p.created_at > now() - INTERVAL '24 hours' AND p.deleted_at IS NULL
GROUP BY h.tag
ORDER BY rnk
LIMIT 10;`,
      explain: 'Posts are filtered to a time window first, then grouped by tag. Real platforms compute this every minute into a small table (or materialized view) rather than per request, and compare against the tag’s historical baseline to find what is unusually popular.'
    },
    {
      title: 'People you may know: friends of friends ranked by mutual connections',
      sql: `SELECT u.handle,
       COUNT(*) AS mutual_connections,
       string_agg(DISTINCT via.handle, ', ') AS via
FROM follows f1                                   -- people I follow
JOIN follows f2 ON f2.follower_id = f1.followee_id -- people they follow
JOIN users u    ON u.id = f2.followee_id
JOIN users via  ON via.id = f1.followee_id
WHERE f1.follower_id = 1
  AND f2.followee_id <> 1
  AND NOT EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = 1 AND x.followee_id = f2.followee_id)
GROUP BY u.handle
ORDER BY mutual_connections DESC, u.handle
LIMIT 10;`,
      explain: 'Two hops over the follow graph, excluding yourself and people you already follow (anti-join with NOT EXISTS). On large graphs, celebrity accounts make two-hop expansion explode; production systems cap the fan-out or precompute suggestions offline.'
    },
    {
      title: 'Threaded comments for a post in display order (recursive CTE)',
      sql: `WITH RECURSIVE thread AS (
  SELECT c.id, c.parent_id, c.author_id, c.body, c.created_at, 0 AS depth,
         ARRAY[c.id] AS id_path
  FROM comments c WHERE c.post_id = 1 AND c.parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, c.author_id, c.body, c.created_at, t.depth + 1,
         t.id_path || c.id
  FROM comments c JOIN thread t ON c.parent_id = t.id
)
SELECT repeat('  ', depth) || u.handle || ': ' || t.body AS comment_line, depth
FROM thread t JOIN users u ON u.id = t.author_id
ORDER BY t.id_path;`,
      explain: 'Ordering by the accumulated id path renders each reply directly under its parent (depth-first). Instagram/Reddit-style UIs cap depth and paginate replies separately.'
    },
    {
      title: 'Counter drift check: denormalised like_count vs. real likes',
      sql: `SELECT p.id, p.like_count AS cached, COUNT(l.user_id) AS actual
FROM posts p
LEFT JOIN likes l ON l.post_id = p.id
GROUP BY p.id, p.like_count
HAVING p.like_count <> COUNT(l.user_id)
ORDER BY p.id;`,
      explain: 'Denormalised counters are fast to read but can drift (bugs, partial failures, async updates). A periodic repair job runs this and resets counters. Expected: zero rows for consistent data.'
    }
  ],
  transactions: `-- Like a post: idempotent and counter-safe.
-- The counter is only incremented if the INSERT actually created a row,
-- so double-taps and client retries never inflate like_count.
BEGIN;
WITH ins AS (
  INSERT INTO likes (user_id, post_id) VALUES (5, 3)
  ON CONFLICT (post_id, user_id) DO NOTHING
  RETURNING post_id
)
UPDATE posts SET like_count = like_count + 1
WHERE id IN (SELECT post_id FROM ins);
COMMIT;

-- Unlike: decrement only if a row was really deleted.
BEGIN;
WITH del AS (
  DELETE FROM likes WHERE user_id = 5 AND post_id = 3
  RETURNING post_id
)
UPDATE posts SET like_count = like_count - 1
WHERE id IN (SELECT post_id FROM del);
COMMIT;

-- Follow: edge + both counters in one transaction (lock users in id order to avoid deadlocks).
BEGIN;
SELECT id FROM users WHERE id IN (5, 2) ORDER BY id FOR UPDATE;
WITH f AS (
  INSERT INTO follows (follower_id, followee_id) VALUES (5, 2)
  ON CONFLICT DO NOTHING
  RETURNING follower_id, followee_id
)
UPDATE users u
SET follower_count  = follower_count  + (u.id = f.followee_id)::int,
    following_count = following_count + (u.id = f.follower_id)::int
FROM f
WHERE u.id IN (f.follower_id, f.followee_id);
COMMIT;`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Celebrity posts</strong>: millions of likes in minutes all UPDATE the same <code>posts</code> row — each update creates a new row version and serialises on the row lock. Fix: write likes to the <code>likes</code> table only and aggregate counts asynchronously (every few seconds) or use sharded counters (<code>post_like_counters(post_id, shard smallint, n)</code> summed on read).</li>
<li><strong>Feed fan-out</strong>: "fan-out on read" (query above) is simple but expensive for users following thousands of accounts. "Fan-out on write" pushes post ids into per-user timeline tables (or Redis lists) at write time; hybrid: fan-out on write for normal users, on read for celebrities.</li>
</ul>
<h4>Partitioning</h4>
<ul>
<li><code>likes</code> is the largest table (billions of rows). Hash-partition by <code>post_id</code> so a post's likes live together, or range by time if old likes are rarely read.</li>
<li><code>posts</code> by month; old partitions on cheaper storage.</li>
</ul>
<h4>At 100x scale</h4>
<ul>
<li>Shard by <code>user_id</code> (posts and follows of a user co-located). Cross-shard feed assembly happens in a feed service, not SQL.</li>
<li>Use 64-bit time-sortable ids (Snowflake-style, or UUIDv7 via core <code>uuidv7()</code> in PostgreSQL 18) so ids are globally unique across shards and sort by time.</li>
<li>Counters, feeds and trending live in caches; PostgreSQL remains the system of record.</li>
</ul>`,
  advanced: `<h4>Graph queries</h4>
<p>Recursive CTEs handle shallow traversals (2-3 hops). For deep graph analytics (influence scores, communities) export to a graph engine; the <span class="tag ext">extension</span> Apache AGE adds openCypher to PostgreSQL.</p>
<h4>Soft deletes and moderation</h4>
<p><code>deleted_at</code> hides posts instantly; partial indexes <code>WHERE deleted_at IS NULL</code> keep feed indexes clean. Hard deletion of user data (GDPR / DPDP right to erasure) runs asynchronously in batches.</p>
<h4>Full-text and hashtag search</h4>
<p>Core <code>to_tsvector</code> + GIN for post search; hashtags as a normalised table make "posts with #tag" a simple index range scan; <span class="tag ext">extension</span> pg_trgm for fuzzy handle search ("ananya" finds "ananya.codes").</p>
<div class="callout warn">Avoid <code>SELECT COUNT(*) FROM likes WHERE post_id = ?</code> on every render: on a viral post it scans millions of index entries. Read the cached counter; repair it periodically.</div>`
});
