/* =====================================================================
   lessons-08-operations.js — Monitoring, Production Optimization,
   Internals, System Catalogs, Configuration, Production Architecture,
   Interview Prep and Real-World Projects.
   ===================================================================== */

/* ---------------------------- MONITORING ---------------------------- */
PGM.addLessons([
{
  id: 'monitoring-pg-stat-activity',
  module: 'monitoring',
  title: 'pg_stat_activity: Seeing What Every Session Is Doing Right Now',
  level: 4,
  minutes: 22,
  summary: 'Read pg_stat_activity like a DBA: session states, wait events, long-running and idle-in-transaction sessions, and how to cancel or terminate them safely.',
  objectives: [
    'Explain every column of pg_stat_activity that matters in an incident (state, xact_start, query_start, wait_event_type, wait_event, backend_type)',
    'Distinguish active, idle, idle in transaction and idle in transaction (aborted) sessions and why each matters',
    'Write queries that find long-running statements and long-open transactions',
    'Use wait_event_type / wait_event to tell CPU-bound work from lock, IO and client waits',
    'Choose correctly between pg_cancel_backend and pg_terminate_backend',
    'Prevent runaway sessions with statement_timeout and idle_in_transaction_session_timeout'
  ],
  concept: `<p><code>pg_stat_activity</code> <span class="tag core">core</span> is a system view with <strong>one row per server process</strong>: every client connection (backend) plus background processes such as the checkpointer, autovacuum workers and WAL sender. It is the first thing a DBA queries when someone says "the database is slow".</p>
<p><strong>Analogy:</strong> think of an airport control tower screen. Every aircraft (session) has a row: where it is (<code>state</code>), how long it has been in the air (<code>now() - xact_start</code>), what it is doing right now (<code>query</code>) and, crucially, what it is <em>waiting for</em> (<code>wait_event</code>) — a runway (a lock), fuel (disk IO) or the pilot (the client application that has not sent the next command).</p>
<h4>The columns you will use every day</h4>
<table>
<tr><th>Column</th><th>Meaning</th></tr>
<tr><td><code>pid</code></td><td>OS process id of the backend — the handle you pass to cancel/terminate functions</td></tr>
<tr><td><code>datname</code>, <code>usename</code>, <code>application_name</code>, <code>client_addr</code></td><td>Who and where: database, role, app label (set it in your connection string!), client IP</td></tr>
<tr><td><code>backend_type</code></td><td><code>client backend</code>, <code>autovacuum worker</code>, <code>checkpointer</code>, <code>walsender</code>, <code>parallel worker</code> …</td></tr>
<tr><td><code>state</code></td><td><code>active</code>, <code>idle</code>, <code>idle in transaction</code>, <code>idle in transaction (aborted)</code>, <code>fastpath function call</code>, <code>disabled</code></td></tr>
<tr><td><code>backend_start</code> / <code>xact_start</code> / <code>query_start</code> / <code>state_change</code></td><td>When the connection, current transaction, current (or last) statement, and current state began</td></tr>
<tr><td><code>wait_event_type</code> / <code>wait_event</code></td><td>What the process is blocked on, if anything (NULL means running on CPU)</td></tr>
<tr><td><code>backend_xid</code> / <code>backend_xmin</code></td><td>Transaction id it holds and the oldest snapshot it needs — the xmin horizon that blocks VACUUM</td></tr>
<tr><td><code>query</code> / <code>query_id</code></td><td>Current statement if active, otherwise the <em>last</em> statement it ran (truncated to <code>track_activity_query_size</code>, 1kB by default)</td></tr>
</table>
<h4>The four states that matter</h4>
<ul>
<li><strong>active</strong> — executing a statement right now. Many active sessions with NULL wait_event = CPU saturation.</li>
<li><strong>idle</strong> — connected, no open transaction. Harmless except that each costs memory and a slot in <code>max_connections</code>.</li>
<li><strong>idle in transaction</strong> — ran <code>BEGIN</code> (or a statement in a transaction), then the application stopped talking. This is the dangerous one: it <em>still holds every lock it took</em> and its snapshot pins the xmin horizon so VACUUM cannot remove dead tuples anywhere in the database.</li>
<li><strong>idle in transaction (aborted)</strong> — an error happened inside the transaction and the client has not issued <code>ROLLBACK</code>. Every further statement fails with "current transaction is aborted".</li>
</ul>
<h4>Wait events in one table</h4>
<table>
<tr><th>wait_event_type</th><th>Typical wait_event</th><th>Means</th></tr>
<tr><td><code>Lock</code></td><td><code>relation</code>, <code>transactionid</code>, <code>tuple</code></td><td>Heavyweight lock — blocked by another session (see the next lesson)</td></tr>
<tr><td><code>LWLock</code></td><td><code>WALWrite</code>, <code>BufferContent</code>, <code>LockManager</code></td><td>Internal short-term lock contention (hot pages, too many partitions/locks per query)</td></tr>
<tr><td><code>IO</code></td><td><code>DataFileRead</code>, <code>WALSync</code>, <code>DataFileWrite</code></td><td>Waiting for the disk</td></tr>
<tr><td><code>Client</code></td><td><code>ClientRead</code>, <code>ClientWrite</code></td><td>Waiting for the application (idle sessions sit in ClientRead)</td></tr>
<tr><td><code>IPC</code></td><td><code>SyncRep</code>, <code>BgWorkerShutdown</code></td><td>Waiting for another process, e.g. a synchronous standby to confirm a commit</td></tr>
<tr><td><code>Timeout</code></td><td><code>PgSleep</code>, <code>VacuumDelay</code></td><td>Deliberate sleep — e.g. autovacuum cost-based throttling</td></tr>
<tr><td><code>Activity</code></td><td><code>CheckpointerMain</code>, <code>WalWriterMain</code></td><td>Background process idle in its main loop</td></tr>
</table>
<div class="callout info">In this browser playground PostgreSQL runs as a single embedded process, so <code>pg_stat_activity</code> shows exactly one row (yours, with <code>backend_type = 'standalone backend'</code>). The queries are identical to what you run on a real server with hundreds of sessions.</div>`,
  why: `<p>Most production incidents are not "the database is broken", they are "one session is doing something bad and everyone else queues behind it": a migration holding an ACCESS EXCLUSIVE lock, a reporting query reading 400 GB, or an application thread that opened a transaction, called a slow external API and never committed. Without <code>pg_stat_activity</code> you are guessing. With it you can name the exact pid, user, application and statement in under a minute — and decide whether to wait, cancel or terminate.</p>`,
  useCase: `<p>An Indian e-commerce company runs a 2 TB PostgreSQL primary behind PgBouncer. During a festival sale, p99 checkout latency jumps from 40 ms to 6 s. The on-call DBA runs the "who is waiting on what" query and sees 180 sessions in <code>Lock / transactionid</code> and one session from <code>application_name = 'inventory-sync'</code> that has been <code>idle in transaction</code> for 14 minutes after updating 9,000 product stock rows. <code>pg_terminate_backend()</code> on that pid releases the row locks; checkout recovers in seconds. The permanent fix: <code>idle_in_transaction_session_timeout = '60s'</code> for that role and a code fix to commit before calling the warehouse API.</p>`,
  internals: `<p>Each backend has a slot in a shared-memory array (<code>PgBackendStatus</code>). The backend updates its own slot — state, query text, timestamps — using a lock-free change-counter protocol, so reading the view is cheap and never blocks the sessions you are observing. Wait events are a single 32-bit value the backend writes just before it sleeps and clears when it wakes, which is why you see them "live". Because the view is a <em>snapshot</em> of many independently-updated slots, a single <code>SELECT</code> is internally consistent per row but the data is gathered once per transaction (call <code>pg_stat_clear_snapshot()</code> to refresh inside a long transaction). Query text is copied into a fixed-size buffer of <code>track_activity_query_size</code> bytes (default 1024) — raise it (restart required) if your ORM generates long statements and you keep seeing truncated SQL.</p>
<p><code>pg_cancel_backend(pid)</code> sends SIGINT: the backend aborts the current statement at its next interrupt check and the session survives (its transaction becomes aborted). <code>pg_terminate_backend(pid, timeout)</code> sends SIGTERM: the backend rolls back and exits, closing the client connection. Neither ever corrupts data — it is a normal rollback. Only <code>kill -9</code> on a backend is dangerous: the postmaster then treats shared memory as possibly corrupt and restarts <em>every</em> session with crash recovery.</p>`,
  whenNot: `<p><code>pg_stat_activity</code> shows the <em>present</em>. It is the wrong tool for "which query used the most total time this week" — use <code>pg_stat_statements</code> <span class="tag ext">extension</span> for cumulative per-query statistics, and logs (<code>log_min_duration_statement</code>) or auto_explain for historical slow statements. Do not poll it every 100 ms from dozens of monitoring agents either; once every 10–30 s from one collector is plenty. And do not "fix" problems by terminating sessions in a loop — find and fix the application behaviour that creates them.</p>`,
  syntax: `SELECT pid, usename, application_name, client_addr, backend_type,
       state, wait_event_type, wait_event,
       backend_start, xact_start, query_start, state_change,
       backend_xid, backend_xmin, query_id, query
FROM   pg_stat_activity;

SELECT pg_cancel_backend(pid);                 -- cancel current statement only
SELECT pg_terminate_backend(pid [, timeout_ms]); -- end the whole session

SET statement_timeout = '30s';
SET idle_in_transaction_session_timeout = '60s';
SET transaction_timeout = '5min';              -- PostgreSQL 17+`,
  examples: [
    {
      label: 'Basic',
      title: 'Who is connected and what are they doing?',
      sql: `SELECT pid,
       usename,
       application_name,
       backend_type,
       state,
       wait_event_type,
       wait_event,
       left(query, 60) AS query
FROM   pg_stat_activity
ORDER  BY backend_type, state;`,
      explain: `<p>The everyday "top" for PostgreSQL. <code>left(query, 60)</code> keeps the output readable. On a real server you will see client backends plus background processes (autovacuum launcher, checkpointer, background writer, walwriter, logical replication launcher…). In the playground you see only your own standalone backend, in state <code>active</code> because it is running this very query.</p>`,
      output: ` pid | usename  | application_name | backend_type       | state  | wait_event_type | wait_event | query
-----+----------+------------------+--------------------+--------+-----------------+------------+------------------------------
  42 | postgres |                  | standalone backend | active |                 |            | SELECT pid,                 +
     |          |                  |                    |        |                 |            |        usename, ...
(1 row)   -- a real server shows one row per process`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Long-running statements and long-open transactions',
      sql: `SELECT pid,
       usename,
       state,
       now() - xact_start  AS xact_age,
       now() - query_start AS query_age,
       wait_event_type || ':' || wait_event AS waiting_on,
       left(query, 80) AS query
FROM   pg_stat_activity
WHERE  backend_type IN ('client backend', 'standalone backend')
  AND  (   (state = 'active' AND now() - query_start > interval '0 seconds')
        OR  state LIKE 'idle in transaction%')
ORDER  BY xact_start NULLS LAST;`,
      explain: `<p>Two different problems, one query:</p><ul><li><strong>query_age</strong> on an <code>active</code> session = a slow statement.</li><li><strong>xact_age</strong> on an <code>idle in transaction</code> session = an abandoned transaction holding locks and blocking vacuum.</li></ul><p>In production change <code>'0 seconds'</code> to something like <code>'5 minutes'</code>. Ordering by <code>xact_start</code> puts the oldest transaction — the one most likely to be the root cause — on top. The <code>backend_type</code> filter excludes background processes, which have no meaningful query.</p>`,
      output: ` pid | usename  | state  | xact_age | query_age | waiting_on | query
-----+----------+--------+----------+-----------+------------+-----------------------
  42 | postgres | active | 00:00:00 | 00:00:00  |            | SELECT pid, usename, ...
(1 row)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Cancel or terminate offenders safely (dry-run first)',
      sql: `-- 1) DRY RUN: list what WOULD be terminated
SELECT pid, usename, application_name, state,
       now() - state_change AS in_state_for,
       left(query, 60) AS last_query
FROM   pg_stat_activity
WHERE  state = 'idle in transaction'
  AND  now() - state_change > interval '10 minutes'
  AND  pid <> pg_backend_pid();          -- never kill yourself

-- 2) Act: terminate them and report what happened
SELECT pid, pg_terminate_backend(pid) AS terminated
FROM   pg_stat_activity
WHERE  state = 'idle in transaction'
  AND  now() - state_change > interval '10 minutes'
  AND  pid <> pg_backend_pid();

-- 3) Cancelling/terminating a pid that does not exist is harmless
SELECT pg_cancel_backend(99999)    AS cancelled,
       pg_terminate_backend(99999) AS terminated;`,
      explain: `<p>Always <strong>look before you shoot</strong>: run the SELECT, read the users and queries, then run the same predicate with the function. <code>state_change</code> tells you how long it has been idle (better than <code>xact_start</code> for this purpose). <code>pid &lt;&gt; pg_backend_pid()</code> prevents terminating your own session. Statement 3 shows that a non-existent pid returns <code>false</code> with a WARNING — no error, nothing harmed.</p><p>Use <code>pg_cancel_backend</code> for a runaway <em>query</em> (session survives); use <code>pg_terminate_backend</code> for an idle-in-transaction session — cancel does nothing there because there is no statement running.</p>`,
      output: `-- 1) and 2) return 0 rows in the playground (no idle sessions)
WARNING:  PID 99999 is not a PostgreSQL backend process
 cancelled | terminated
-----------+------------
 f         | f`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Finding "slow queries" by query_start alone
SELECT pid, query
FROM   pg_stat_activity
WHERE  now() - query_start > interval '5 minutes';`, why: 'query_start is also set for idle sessions (it is when their LAST query started), so this lists hundreds of healthy idle pooled connections and hides the real problem: it never looks at transaction age or state.', run: true },
    good: { sql: `SELECT pid, state, now() - xact_start AS xact_age,
       now() - query_start AS query_age, left(query, 60) AS query
FROM   pg_stat_activity
WHERE  backend_type IN ('client backend', 'standalone backend')
  AND  (   (state = 'active' AND now() - query_start > interval '5 minutes')
        OR (state LIKE 'idle in transaction%' AND now() - xact_start > interval '5 minutes'))
ORDER  BY xact_start;`, why: 'Filters by state: active sessions are judged by statement age, idle-in-transaction sessions by transaction age. Only genuinely problematic sessions are returned, oldest transaction first.', run: true }
  },
  mistakes: [
    `Reading <code>query</code> for an <code>idle</code> session as "currently running" — it is the <em>last</em> statement that session executed.`,
    `Using <code>pg_cancel_backend</code> on an <code>idle in transaction</code> session and wondering why locks are still held — there is nothing to cancel; you need <code>pg_terminate_backend</code> (or fix the app).`,
    `Running <code>kill -9</code> on a backend from the shell: the postmaster restarts all sessions and performs crash recovery. Use the SQL functions or plain SIGTERM.`,
    `Leaving <code>application_name</code> empty in connection strings, so every row looks identical and you cannot tell the checkout service from the nightly report.`,
    `Ignoring <code>backend_xmin</code>: one forgotten REPEATABLE READ transaction or replication slot can stop vacuum cluster-wide and cause massive bloat.`
  ],
  best: [
    `Set <code>application_name</code> per service (e.g. <code>?application_name=checkout-api</code>) so incidents are attributable in seconds.`,
    `Configure <code>idle_in_transaction_session_timeout</code> (e.g. 60s–5min) for application roles, and <code>statement_timeout</code> per role or per workload rather than globally.`,
    `Alert on: oldest transaction age &gt; 15 min, count of <code>idle in transaction</code> &gt; N, active sessions &gt; 2× CPU cores, and sessions waiting on <code>Lock</code> for &gt; 30 s.`,
    `Keep a saved "triage" query in your runbook that groups by <code>state, wait_event_type, wait_event</code> — the shape of the counts tells you the class of problem instantly.`,
    `Grant monitoring users the <code>pg_monitor</code> role instead of superuser; it lets them see other users' query text.`
  ],
  performance: `<p>Querying <code>pg_stat_activity</code> is cheap (a scan of a shared-memory array), but its <em>content</em> is a performance dashboard: the count of <code>active</code> sessions with NULL <code>wait_event</code> approximates CPU demand; compare it to core count. Large numbers of <code>LWLock:LockManager</code> waits mean queries touch too many relations (often over-partitioned tables without pruning); <code>IO:DataFileRead</code> dominance means the working set no longer fits in RAM; <code>IPC:SyncRep</code> means commits wait for a synchronous standby. <code>track_activity_query_size</code> larger values cost a little shared memory per connection (max_connections × size).</p>`,
  security: `<p>Ordinary roles see only their own sessions' <code>query</code> text; for other sessions the column shows <code>&lt;insufficient privilege&gt;</code>. Grant <code>pg_read_all_stats</code> or <code>pg_monitor</code> to monitoring accounts rather than superuser. Note that query text can contain sensitive literals (emails, tokens) — use bind parameters so they are not visible. Only superusers, members of <code>pg_signal_backend</code>, or the same role can cancel/terminate a session, and nobody but a superuser can signal a superuser's backend.</p>`,
  scenario: {
    title: 'Checkout is timing out and connections are piling up',
    steps: [
      '1. Snapshot the shape: SELECT state, wait_event_type, wait_event, count(*) FROM pg_stat_activity GROUP BY 1,2,3 ORDER BY 4 DESC.',
      '2. Many rows in Lock:transactionid or Lock:relation → find blockers with pg_blocking_pids() (next lesson).',
      '3. Look for the oldest xact_start; if it is idle in transaction for minutes, note pid, usename, application_name and last query.',
      '4. Confirm with the owning team if possible, then SELECT pg_terminate_backend(pid).',
      '5. Watch the Lock waiters drain; verify latency recovers on the dashboard.',
      '6. Prevent recurrence: ALTER ROLE app SET idle_in_transaction_session_timeout = \'60s\'; fix the code path that held a transaction across a network call.'
    ]
  },
  widgets: ['diagram:process-model'],
  interview: [
    { q: 'What is the difference between pg_cancel_backend and pg_terminate_backend?', a: 'pg_cancel_backend sends SIGINT and cancels only the currently running statement; the connection survives and its transaction is marked aborted. pg_terminate_backend sends SIGTERM: the backend rolls back its transaction and exits, closing the client connection. For an idle-in-transaction session only terminate helps because no statement is running.' },
    { q: 'Why is "idle in transaction" worse than "idle"?', a: 'An idle-in-transaction session keeps all locks it acquired and holds a snapshot (backend_xmin) that prevents VACUUM from removing any tuple that became dead after it started — across the whole database. Idle sessions hold neither. A single forgotten transaction can block DDL, stall writers and cause table bloat.' },
    { q: 'A session is active but wait_event is NULL. What is it doing?', a: 'It is running on CPU — executing the plan, sorting, hashing or computing expressions. NULL wait_event means "not waiting". If many sessions look like this and the CPU is at 100%, the fix is query optimisation or more cores, not lock analysis.' },
    { q: 'How would you prevent abandoned transactions in the first place?', a: 'Set idle_in_transaction_session_timeout (per role or database), keep transactions short in code (never call external services inside one), use transaction_timeout in PG17+ as a hard cap, and alert on the oldest xact_start in pg_stat_activity.' }
  ],
  exercises: [
    { task: 'Count sessions grouped by backend_type and state.', solution: `SELECT backend_type, state, count(*)
FROM   pg_stat_activity
GROUP  BY backend_type, state
ORDER  BY count(*) DESC;`, run: true },
    { task: 'Show your own backend pid, the time your session started and how long ago that was.', solution: `SELECT pid, backend_start, now() - backend_start AS connected_for
FROM   pg_stat_activity
WHERE  pid = pg_backend_pid();`, run: true },
    { task: 'Set a 2-second statement timeout for the current transaction only, then show it.', solution: `BEGIN;
SET LOCAL statement_timeout = '2s';
SHOW statement_timeout;
ROLLBACK;`, run: true }
  ],
  challenge: {
    task: 'Write a single triage query that returns, per wait_event_type/wait_event combination, the number of sessions, the oldest transaction age and one sample pid — ordered so the biggest group appears first. Label NULL waits as "CPU".',
    hint: 'COALESCE the wait columns, use count(*), max(now() - xact_start), and min(pid) as the sample.',
    solution: `SELECT COALESCE(wait_event_type, 'CPU')          AS wait_type,
       COALESCE(wait_event, 'running')           AS wait_event,
       state,
       count(*)                                  AS sessions,
       max(now() - xact_start)                   AS oldest_xact,
       min(pid)                                  AS sample_pid
FROM   pg_stat_activity
WHERE  backend_type IN ('client backend', 'standalone backend')
GROUP  BY 1, 2, 3
ORDER  BY sessions DESC, oldest_xact DESC NULLS LAST;`,
    run: true
  },
  related: ['monitoring-locks-connections', 'monitoring-health-metrics', 'locks', 'vacuum', 'configuration'],
  quiz: [
    { type: 'mcq', q: 'Which state means a session has an open transaction but is not running a statement?', options: ['active', 'idle', 'idle in transaction', 'fastpath function call'], answer: 2, explain: 'idle in transaction = BEGIN was issued (or a statement ran inside a transaction) and the client has not sent COMMIT/ROLLBACK or the next statement.' },
    { type: 'tf', q: 'pg_terminate_backend can corrupt data if the backend was in the middle of an UPDATE.', answer: false, explain: 'Termination performs a normal transaction rollback. Only SIGKILL (kill -9) forces a cluster-wide restart and crash recovery — and even that does not corrupt data thanks to WAL.' },
    { type: 'predict', q: 'A session shows state = idle, query = "UPDATE orders SET status = \'paid\' WHERE id = 7". What is true?', code: `SELECT state, query FROM pg_stat_activity WHERE pid = 1234;`, options: ['The UPDATE is running now', 'The UPDATE was the last statement; nothing is running and no transaction is open', 'The UPDATE is waiting for a lock', 'The transaction is aborted'], answer: 1, explain: 'For non-active sessions, query holds the last statement executed. idle means no open transaction.' },
    { type: 'scenario', q: 'Many sessions show wait_event_type = Lock, wait_event = transactionid. What is the next step?', options: ['Increase shared_buffers', 'Find the blocking pids with pg_blocking_pids() and inspect the oldest blocker', 'Restart PostgreSQL', 'Run VACUUM FULL'], answer: 1, explain: 'transactionid waits mean row-level lock conflicts: someone holds rows the others want. Identify the blocker chain before acting.' },
    { type: 'write', q: 'Write a query listing pids that have been idle in transaction for more than 5 minutes.', solution: `SELECT pid, usename, now() - state_change AS idle_for
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '5 minutes';`, explain: 'state_change records when the session entered its current state, so now() - state_change is how long it has been idle in the transaction.' }
  ]
},
{
  id: 'monitoring-locks-connections',
  module: 'monitoring',
  title: 'Monitoring Locks, Blocked Queries, Deadlocks and Connections',
  level: 4,
  minutes: 22,
  summary: 'Find who blocks whom with pg_locks and pg_blocking_pids(), track deadlocks and rollbacks in pg_stat_database, and monitor connection usage against max_connections.',
  objectives: [
    'Read pg_locks: locktype, mode, granted, relation, transactionid',
    'Build a blocker → waiter tree with pg_blocking_pids()',
    'Use pg_stat_database counters: deadlocks, xact_rollback, conflicts, temp_files, sessions_killed',
    'Monitor connection saturation against max_connections and reserved slots',
    'Configure log_lock_waits, deadlock_timeout and lock_timeout for visibility and safety'
  ],
  concept: `<p>PostgreSQL uses <strong>heavyweight locks</strong> on tables, rows (via transaction ids), and other objects to keep concurrent sessions consistent. Every held or awaited lock appears as a row in <code>pg_locks</code> <span class="tag core">core</span>. When session A waits for a lock held by B, A shows <code>granted = false</code> and in <code>pg_stat_activity</code> its <code>wait_event_type = 'Lock'</code>.</p>
<p><strong>Analogy:</strong> a single-lane bridge. Cars queue behind the one on the bridge; if that car stops in the middle (an idle-in-transaction session), the queue grows forever. And the queue is <em>FIFO-ish</em>: a lorry (an <code>ALTER TABLE</code> needing ACCESS EXCLUSIVE) that joins the queue blocks even the small cars (plain <code>SELECT</code>s) arriving after it, because lock requests conflict with <em>waiting</em> requests too.</p>
<h4>Key tools</h4>
<ul>
<li><code>pg_locks</code> — raw lock table: <code>locktype</code> (relation, tuple, transactionid, virtualxid, advisory…), <code>mode</code> (AccessShareLock … AccessExclusiveLock), <code>granted</code>, <code>pid</code>, <code>relation</code>, <code>transactionid</code>, <code>waitstart</code> (PG14+).</li>
<li><code>pg_blocking_pids(pid)</code> — returns the array of pids blocking <code>pid</code>, handling the tricky cases (row locks via transaction ids, lock queue ordering, parallel query groups) correctly. Always prefer it to hand-written self-joins on pg_locks.</li>
<li><code>pg_stat_database</code> — cumulative counters per database: <code>deadlocks</code>, <code>xact_commit</code>, <code>xact_rollback</code>, <code>conflicts</code> (standby query cancellations), <code>temp_files</code>/<code>temp_bytes</code>, and since PG14 session counters: <code>sessions</code>, <code>sessions_abandoned</code>, <code>sessions_fatal</code>, <code>sessions_killed</code>, <code>idle_in_transaction_time</code>.</li>
<li><code>numbackends</code> + <code>max_connections</code> — connection headroom.</li>
</ul>
<h4>Deadlocks</h4>
<p>A deadlock is a <em>cycle</em>: A waits for B while B waits for A. PostgreSQL does not check for cycles on every wait (that would be expensive); after a session has waited <code>deadlock_timeout</code> (default 1 s) it runs the deadlock detector, and if a cycle exists, one transaction is aborted with <code>ERROR: deadlock detected</code> (SQLSTATE 40P01) and <code>pg_stat_database.deadlocks</code> is incremented. A rising deadlock counter is a <em>code bug</em> signal — two code paths lock the same rows in different orders.</p>`,
  why: `<p>Lock problems look like performance problems: the CPU is idle, disks are idle, yet requests time out. Without lock monitoring, teams add hardware that does nothing. Connection exhaustion looks like an outage: <code>FATAL: sorry, too many clients already</code>. Both are cheap to detect early with a handful of catalog queries and a few alerts.</p>`,
  useCase: `<p>A SaaS billing platform deploys a migration <code>ALTER TABLE invoices ADD CONSTRAINT … FOREIGN KEY</code> at 11:00. The ALTER waits behind a 20-minute analytics query holding AccessShareLock. While it waits, it blocks <em>every</em> new read and write on <code>invoices</code>. Within 30 s, 400 API workers pile up, the pool hits <code>max_connections = 500</code>, and logins fail. The blocking-tree query shows the root (analytics pid), the migration (waiting for AccessExclusiveLock) and 400 victims. The fix: cancel the migration immediately, then re-run it with <code>SET lock_timeout = '3s'</code> and retries. Their dashboard now alerts when any session waits on a Lock for &gt; 10 s.</p>`,
  internals: `<p>The lock manager stores locks in a shared hash table partitioned into 16 partitions (hence <code>LWLock:LockManager</code> contention on queries touching hundreds of relations). Weak locks taken by ordinary DML (AccessShare, RowShare, RowExclusive) on a relation use a per-backend <em>fast-path</em> array (<code>fastpath = true</code> in pg_locks) to avoid the shared table; PG18 made the number of fast-path slots scale with <code>max_locks_per_transaction</code>, helping partition-heavy workloads.</p>
<p>Row locks are not stored in pg_locks per row (that would explode memory): they are written into the tuple header (<code>xmax</code> + infomask bits). A waiter therefore waits on the holder's <strong>transactionid</strong> lock, which is why row conflicts show up as <code>Lock:transactionid</code>, briefly with a <code>tuple</code> lock to keep queue order. When <code>log_lock_waits = on</code>, any wait longer than <code>deadlock_timeout</code> is logged with the holder and waiter pids — invaluable after the fact.</p>`,
  whenNot: `<p>Do not try to "solve" lock waits by lowering isolation or by adding <code>NOWAIT</code> everywhere — lock waits are often correct behaviour. Do not build blocking trees with hand-written pg_locks self-joins (they miss queue-order and parallel-query cases); use <code>pg_blocking_pids()</code>. Do not raise <code>max_connections</code> to thousands to fix connection exhaustion: every backend costs memory and CPU scheduling — use a pooler such as PgBouncer <span class="tag tool">third-party tool</span>.</p>`,
  syntax: `SELECT pid, locktype, relation::regclass, mode, granted, waitstart
FROM   pg_locks;

SELECT pg_blocking_pids(pid);         -- int[] of blockers

SELECT datname, deadlocks, xact_rollback, conflicts, temp_files,
       sessions, sessions_killed, sessions_abandoned
FROM   pg_stat_database;

SET lock_timeout = '3s';              -- give up instead of queueing forever
-- postgresql.conf: log_lock_waits = on, deadlock_timeout = 1s`,
  examples: [
    {
      label: 'Basic',
      title: 'See the locks your own transaction holds',
      sql: `BEGIN;
-- Take a few locks on purpose
SELECT count(*) FROM orders;                       -- AccessShareLock
UPDATE departments SET budget = budget WHERE id = 1; -- RowExclusiveLock + row lock

SELECT locktype,
       relation::regclass AS relation,
       mode,
       granted,
       fastpath
FROM   pg_locks
WHERE  pid = pg_backend_pid()
ORDER  BY locktype, relation::text;
ROLLBACK;`,
      explain: `<p>Inside one transaction we read <code>orders</code> and update a <code>departments</code> row. pg_locks shows AccessShareLock on <code>orders</code>, RowExclusiveLock on <code>departments</code> and its indexes, AccessShareLock on <code>orders_pkey</code> (the planner locks indexes it considers), plus our own <code>virtualxid</code> and <code>transactionid</code> (assigned because we wrote). Notice the row lock itself is <em>not</em> listed — it lives in the tuple header. Most of these are <code>fastpath = true</code>.</p>`,
      output: ` locktype      | relation             | mode             | granted | fastpath
---------------+----------------------+------------------+---------+----------
 relation      | pg_locks             | AccessShareLock  | t       | t
 relation      | departments          | RowExclusiveLock | t       | t
 relation      | departments_pkey     | RowExclusiveLock | t       | t
 relation      | departments_name_key | RowExclusiveLock | t       | t
 relation      | orders               | AccessShareLock  | t       | t
 relation      | orders_pkey          | AccessShareLock  | t       | t
 transactionid |                      | ExclusiveLock    | t       | f
 virtualxid    |                      | ExclusiveLock    | t       | t
(8 rows)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Blocking tree: who blocks whom (production query)',
      sql: `SELECT w.pid                         AS waiting_pid,
       w.usename                     AS waiting_user,
       now() - w.query_start         AS waiting_for,
       left(w.query, 50)             AS waiting_query,
       b.pid                         AS blocking_pid,
       b.usename                     AS blocking_user,
       b.state                       AS blocking_state,
       now() - b.xact_start          AS blocker_xact_age,
       left(b.query, 50)             AS blocking_query
FROM   pg_stat_activity w
JOIN   LATERAL unnest(pg_blocking_pids(w.pid)) AS bp(pid) ON true
JOIN   pg_stat_activity b ON b.pid = bp.pid
ORDER  BY waiting_for DESC;`,
      explain: `<p>For every session, <code>pg_blocking_pids()</code> returns its blockers; <code>unnest</code> + LATERAL turns the array into rows, then we join back to <code>pg_stat_activity</code> for blocker details. The blocker whose own <code>pg_blocking_pids</code> is empty is the <strong>root</strong> — usually the one to act on. In the single-session playground this returns 0 rows; on a real server during an incident it is the most valuable query you own.</p>`,
      output: ` waiting_pid | waiting_user | waiting_for | waiting_query | blocking_pid | ...
-------------+--------------+-------------+---------------+--------------+----
(0 rows)   -- on a busy server: one row per waiter/blocker pair`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Database-level health: deadlocks, rollbacks and connection headroom',
      sql: `SELECT d.datname,
       d.numbackends                                        AS connections,
       current_setting('max_connections')::int              AS max_connections,
       round(100.0 * d.numbackends
             / current_setting('max_connections')::int, 1)  AS pct_used,
       d.xact_commit,
       d.xact_rollback,
       round(100.0 * d.xact_rollback
             / nullif(d.xact_commit + d.xact_rollback, 0), 2) AS rollback_pct,
       d.deadlocks,
       d.conflicts,
       d.temp_files,
       pg_size_pretty(d.temp_bytes)                        AS temp_written,
       d.sessions_killed,
       d.sessions_abandoned
FROM   pg_stat_database d
WHERE  d.datname = current_database();`,
      explain: `<p>All counters are <strong>cumulative since the last stats reset</strong> — monitoring systems store samples and graph the <em>rate</em> (deadlocks per minute, rollbacks per second). What to watch:</p><ul><li><code>pct_used</code> &gt; 80% → you are close to "too many clients".</li><li>Rising <code>rollback_pct</code> → application errors or serialization retries.</li><li><code>deadlocks</code> increasing → lock-ordering bug in code.</li><li><code>temp_files</code> growing fast → sorts/hashes spilling to disk; review <code>work_mem</code> and queries.</li><li><code>sessions_abandoned</code> → clients disappearing without closing connections (network or app crashes).</li></ul>`,
      output: ` datname  | connections | max_connections | pct_used | xact_commit | xact_rollback | rollback_pct | deadlocks | conflicts | temp_files | temp_written | sessions_killed | sessions_abandoned
----------+-------------+-----------------+----------+-------------+---------------+--------------+-----------+-----------+------------+--------------+-----------------+--------------------
 postgres |           1 |             100 |      1.0 |           2 |             0 |         0.00 |         0 |         0 |          0 | 0 bytes      |               0 |                  0`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Hand-rolled blocker detection: misses queue order,
-- row locks waiting via tuple locks, parallel workers
SELECT bl.pid AS blocked, kl.pid AS blocking
FROM   pg_locks bl
JOIN   pg_locks kl ON kl.relation = bl.relation AND kl.pid <> bl.pid
WHERE  NOT bl.granted AND kl.granted;`, why: 'Only matches relation-level locks on the same table, ignores transactionid waits (the most common row-lock case), ignores conflicting-mode logic and the wait queue, so it both misses blockers and reports false ones.', run: true },
    good: { sql: `SELECT pid, pg_blocking_pids(pid) AS blocked_by,
       wait_event_type, wait_event, left(query, 60) AS query
FROM   pg_stat_activity
WHERE  cardinality(pg_blocking_pids(pid)) > 0;`, why: 'pg_blocking_pids() uses the lock manager\'s own conflict rules, including waits on transaction ids, queue position and parallel groups. It is the supported, correct way.', run: true }
  },
  mistakes: [
    `Running DDL (<code>ALTER TABLE</code>, <code>CREATE INDEX</code> without CONCURRENTLY) on a busy table without <code>lock_timeout</code> — while waiting it blocks every new query on that table.`,
    `Treating deadlocks as a database problem and "retrying forever"; the root cause is inconsistent lock ordering in application code.`,
    `Reading pg_stat_database counters as current values instead of rates — 3,000 deadlocks may be over two years.`,
    `Raising <code>max_connections</code> into the thousands instead of pooling; memory and context-switch overhead rise and throughput usually falls.`,
    `Forgetting that <code>superuser_reserved_connections</code> (default 3) and <code>reserved_connections</code> (PG16+, for <code>pg_use_reserved_connections</code> members) reduce slots available to applications.`
  ],
  best: [
    `Turn on <code>log_lock_waits = on</code>; it logs any lock wait longer than <code>deadlock_timeout</code> with both pids — near-zero cost, huge forensic value.`,
    `Always run migrations with <code>SET lock_timeout = '2s'</code>–<code>'5s'</code> and a retry loop.`,
    `Acquire row locks in a deterministic order (e.g. <code>ORDER BY id FOR UPDATE</code>) to make deadlocks impossible by construction.`,
    `Alert on: any Lock wait &gt; 30 s, deadlocks rate &gt; 0 for 10 min, connections &gt; 80% of max_connections.`,
    `Put PgBouncer in transaction mode in front of applications with many short requests; keep server-side connections near 2–4× core count.`
  ],
  performance: `<p>Lock waits waste wall-clock time, not CPU: a box at 5% CPU can be "down" because of one blocker. Lock-manager contention (<code>LWLock:LockManager</code>) appears when each query locks many relations — queries on tables with hundreds of partitions without pruning, or ORMs that touch dozens of tables per request. Very high connection counts degrade throughput even when idle: each backend has its own catalog caches and the snapshot computation cost grows with the number of connections (much improved in PG14, but not free).</p>`,
  security: `<p>Advisory locks and long transactions can be abused for denial-of-service by any role able to connect; limit with per-role <code>CONNECTION LIMIT</code>, <code>statement_timeout</code> and <code>idle_in_transaction_session_timeout</code>. Visibility of other sessions' queries in pg_stat_activity requires <code>pg_read_all_stats</code>; signalling them requires <code>pg_signal_backend</code> — grant these narrowly to on-call roles.</p>`,
  scenario: {
    title: 'FATAL: sorry, too many clients already',
    steps: [
      '1. Connect using a reserved superuser slot and run SELECT usename, application_name, state, count(*) FROM pg_stat_activity GROUP BY 1,2,3 ORDER BY 4 DESC.',
      '2. If most are idle → the app pools are oversized or leaking; if most are active/Lock → an upstream blocker is causing pile-up.',
      '3. For pile-up, run the blocking-tree query, terminate the root blocker.',
      '4. For leaked idle connections, set idle_session_timeout for that role and fix pool settings (max pool size × app instances must be < max_connections).',
      '5. Long term: introduce PgBouncer in transaction mode and alert at 80% of max_connections.'
    ]
  },
  widgets: ['lab:txn', 'diagram:pgbouncer'],
  interview: [
    { q: 'How do you find the root blocker in a lock pile-up?', a: 'Use pg_blocking_pids(pid) for every waiting session and join back to pg_stat_activity. The root is a blocker that itself has an empty pg_blocking_pids array — often an idle-in-transaction session or long-running DDL/report. Act on the root, not on the victims.' },
    { q: 'How does PostgreSQL detect deadlocks?', a: 'Lazily: a waiting backend sleeps for deadlock_timeout (1 s default) and only then runs the deadlock detector, which searches the wait-for graph for cycles. If found, one transaction is aborted with SQLSTATE 40P01 and pg_stat_database.deadlocks increments. Fix by acquiring locks in a consistent order.' },
    { q: 'Why can a plain SELECT be blocked by ALTER TABLE that has not even started?', a: 'The ALTER is queued waiting for AccessExclusiveLock. New lock requests that conflict with a queued request wait behind it to avoid starving it, and AccessShareLock conflicts with AccessExclusiveLock. So the waiting ALTER blocks all new readers. Use lock_timeout so the ALTER gives up quickly.' },
    { q: 'Why are row locks not visible as individual rows in pg_locks?', a: 'Row locks are recorded in the tuple header (xmax plus infomask flags), not in shared memory, so PostgreSQL can lock millions of rows without exhausting the lock table. Waiters wait on the holder\'s transaction id lock, which is what pg_locks shows.' }
  ],
  exercises: [
    { task: 'Show all locks currently held or awaited, with relation names and mode, excluding your own pg_locks lock.', solution: `SELECT pid, locktype, relation::regclass, mode, granted
FROM   pg_locks
WHERE  relation IS DISTINCT FROM 'pg_locks'::regclass
ORDER  BY pid, locktype;`, run: true },
    { task: 'Report deadlocks and the rollback ratio for every database.', solution: `SELECT datname, deadlocks, xact_commit, xact_rollback,
       round(100.0 * xact_rollback / nullif(xact_commit + xact_rollback, 0), 2) AS rollback_pct
FROM   pg_stat_database
WHERE  datname IS NOT NULL
ORDER  BY deadlocks DESC;`, run: true },
    { task: 'Inside a transaction, set lock_timeout to 2 seconds and take an explicit SHARE lock on orders; then list the lock.', solution: `BEGIN;
SET LOCAL lock_timeout = '2s';
LOCK TABLE orders IN SHARE MODE;
SELECT relation::regclass, mode, granted
FROM   pg_locks
WHERE  pid = pg_backend_pid() AND relation = 'orders'::regclass;
ROLLBACK;`, run: true }
  ],
  challenge: {
    task: 'Build a connection-usage report: per usename and application_name, count connections by state, and compare the total with max_connections minus superuser_reserved_connections (the effective limit for ordinary roles).',
    hint: 'Use count(*) FILTER (WHERE state = ...) and current_setting() cast to int.',
    solution: `SELECT COALESCE(usename::text, '(background)')      AS usename,
       COALESCE(nullif(application_name, ''), '-') AS app,
       count(*)                                     AS total,
       count(*) FILTER (WHERE state = 'active')     AS active,
       count(*) FILTER (WHERE state = 'idle')       AS idle,
       count(*) FILTER (WHERE state LIKE 'idle in transaction%') AS idle_in_tx,
       current_setting('max_connections')::int
         - current_setting('superuser_reserved_connections')::int AS effective_limit
FROM   pg_stat_activity
GROUP  BY 1, 2
ORDER  BY total DESC;`,
    run: true
  },
  related: ['monitoring-pg-stat-activity', 'locks', 'concurrency', 'connection-pooling', 'monitoring-health-metrics'],
  quiz: [
    { type: 'mcq', q: 'Which function returns the pids blocking a given session?', options: ['pg_locks_for(pid)', 'pg_blocking_pids(pid)', 'pg_lock_status(pid)', 'pg_safe_snapshot_blocking_pids(pid)'], answer: 1, explain: 'pg_blocking_pids(pid) returns an integer array of blocking pids. pg_safe_snapshot_blocking_pids is only for SERIALIZABLE READ ONLY DEFERRABLE waits.' },
    { type: 'tf', q: 'PostgreSQL checks for deadlocks every time a session starts waiting for a lock.', answer: false, explain: 'It waits deadlock_timeout (default 1s) first; the detector only runs if the wait lasts that long, because most waits resolve quickly.' },
    { type: 'scenario', q: 'pg_stat_database.deadlocks increases by ~20 per hour after a release. Best response?', options: ['Raise deadlock_timeout to 10s', 'Find the deadlock log entries and make the code lock rows in a consistent order', 'Switch to SERIALIZABLE', 'Increase max_locks_per_transaction'], answer: 1, explain: 'The server log prints the involved queries for each deadlock. Deadlocks are cycles in lock acquisition order — a code issue.' },
    { type: 'bug', q: 'This migration took down production. Why?', code: `ALTER TABLE orders ADD COLUMN note text;  -- run at peak, no settings`, options: ['ADD COLUMN rewrites the table', 'It waited for AccessExclusiveLock behind a long query and blocked every new query meanwhile; lock_timeout was not set', 'text columns need a default', 'It needs CONCURRENTLY'], answer: 1, explain: 'ADD COLUMN without default is metadata-only, but still needs AccessExclusiveLock. Queued behind a long reader, it blocks everyone. SET lock_timeout and retry.' }
  ]
},
{
  id: 'monitoring-health-metrics',
  module: 'monitoring',
  title: 'Health Metrics: Cache Hit Ratio, Sizes, Bloat Signals, OS Metrics and Alerting',
  level: 4,
  minutes: 25,
  summary: 'Measure what matters: cache hit ratio, database/table/index sizes, bloat and vacuum signals, OS-level CPU/memory/IO, the Prometheus + Grafana stack, and sensible alert thresholds.',
  objectives: [
    'Compute database- and table-level cache hit ratios and interpret them correctly',
    'Measure sizes with pg_database_size, pg_relation_size, pg_indexes_size, pg_total_relation_size and pg_size_pretty',
    'Spot bloat and vacuum trouble from n_dead_tup, last_autovacuum and xid age',
    'Know which OS metrics matter (CPU, iowait, memory, disk latency, disk space)',
    'Describe a postgres_exporter → Prometheus → Grafana monitoring pipeline',
    'Define alert thresholds that page humans only when action is needed'
  ],
  concept: `<p>Health monitoring answers three questions continuously: <strong>Is it up? Is it fast? Will it still be fine next month?</strong> PostgreSQL exposes most raw numbers through cumulative statistics views; your job is to turn them into a few ratios and trends.</p>
<p><strong>Analogy:</strong> a car dashboard. Speed (throughput: commits/s), engine temperature (CPU, IO latency), fuel gauge (disk space, xid age), and the oil warning light (replication lag, dead tuples). You do not stare at the engine; you watch the gauges and react when one crosses a line.</p>
<h4>1. Cache hit ratio</h4>
<p><code>blks_hit / (blks_hit + blks_read)</code> from <code>pg_stat_database</code> (or <code>heap_blks_*</code>/<code>idx_blks_*</code> from <code>pg_statio_user_tables</code>). A "read" here means "not found in shared_buffers" — it may still come from the OS page cache, so this ratio is about PostgreSQL's own buffer cache. For OLTP, &gt; 99% is typical; a sustained drop means the working set outgrew memory or a new query is scanning big tables.</p>
<h4>2. Sizes</h4>
<table>
<tr><th>Function</th><th>Measures</th></tr>
<tr><td><code>pg_database_size(name)</code></td><td>Whole database on disk</td></tr>
<tr><td><code>pg_relation_size(rel [, fork])</code></td><td>One fork (default <code>main</code>) of a table or index</td></tr>
<tr><td><code>pg_table_size(rel)</code></td><td>Heap + TOAST + FSM + VM (no indexes)</td></tr>
<tr><td><code>pg_indexes_size(rel)</code></td><td>All indexes of the table</td></tr>
<tr><td><code>pg_total_relation_size(rel)</code></td><td>Everything: table + TOAST + indexes</td></tr>
<tr><td><code>pg_size_pretty(bigint)</code></td><td>Human-readable formatting (kB, MB, GB…)</td></tr>
</table>
<h4>3. Bloat & vacuum signals</h4>
<ul>
<li><code>pg_stat_user_tables.n_dead_tup</code> vs <code>n_live_tup</code> — dead-tuple ratio.</li>
<li><code>last_autovacuum</code>, <code>last_autoanalyze</code>, <code>autovacuum_count</code> — is autovacuum keeping up?</li>
<li><code>age(datfrozenxid)</code> per database — distance towards transaction-id wraparound (autovacuum forces anti-wraparound vacuum at 200 M by default; hard stop near 2 billion).</li>
<li>Exact bloat needs <code>pgstattuple</code> <span class="tag ext">extension</span>; estimates compare actual pages with expected pages from row width.</li>
</ul>
<h4>4. OS level</h4>
<p>CPU (user vs system vs iowait), load average vs cores, memory (page cache size, swap usage — any swapping is bad), disk latency (<code>await</code> in <code>iostat -x</code>), IOPS and throughput vs the volume's provisioned limits, disk <em>free space</em> on data and WAL volumes, network throughput for replication.</p>
<h4>5. The standard stack</h4>
<p><strong>postgres_exporter</strong> <span class="tag tool">third-party tool</span> (Prometheus community project) connects to PostgreSQL, runs catalog queries and exposes metrics at <code>/metrics</code>; <strong>node_exporter</strong> exposes OS metrics; <strong>Prometheus</strong> <span class="tag tool">third-party tool</span> scrapes and stores time series and evaluates alert rules; <strong>Alertmanager</strong> routes alerts to Slack/PagerDuty; <strong>Grafana</strong> <span class="tag tool">third-party tool</span> draws dashboards. Managed clouds offer equivalents (CloudWatch/Performance Insights, Azure Monitor, Cloud SQL Insights).</p>`,
  why: `<p>Databases rarely fail suddenly; they degrade along predictable curves — disk fills at 2% a day, dead tuples accumulate because a long transaction pins the horizon, the working set grows past RAM after a marketing campaign. Monitoring these curves turns 3 a.m. outages into Tuesday-afternoon tickets.</p>`,
  useCase: `<p>A logistics company stores GPS pings: 400 M rows/month. Their Grafana board shows <code>pg_database_size</code> growing 38 GB/day against a 2 TB volume (alert fires at 80% with a 7-day forecast), cache hit ratio for the hot <code>shipments</code> table at 99.7%, and a panel of the top-10 tables by <code>n_dead_tup</code>. One Monday the dead-tuple panel for <code>shipments</code> climbs from 2 M to 60 M; the "oldest transaction" panel shows a 3-day-old replication slot. Dropping the abandoned slot lets autovacuum catch up before bloat hurts.</p>`,
  internals: `<p>Since PostgreSQL 15 the cumulative statistics system lives in <strong>shared memory</strong>: backends accumulate counters locally and flush them periodically (at most every second, and at transaction end when idle); there is no longer a separate statistics collector process or UDP socket. Stats are written to disk at clean shutdown and <em>discarded after a crash</em> (and on failover the new primary starts with empty counters) — another reason to store metrics externally. <code>stats_fetch_consistency</code> controls whether repeated reads in one transaction see a cached snapshot. <code>pg_stat_reset()</code> zeroes the counters for the current database.</p>
<p>Size functions call <code>stat()</code> on the relation's segment files (1 GB each) — cheap, but summing over tens of thousands of partitions takes time. <code>pg_database_size</code> walks the whole database directory.</p>`,
  whenNot: `<p>Do not chase a single "golden" ratio: a 95% cache hit ratio on a data warehouse doing large scans can be perfectly healthy, while 99.5% on OLTP may hide one terrible query. Do not alert on raw cumulative counters; alert on rates and durations. And do not run heavy bloat-estimation or <code>pgstattuple</code> scans every minute on large tables — they read the whole table; schedule them daily or weekly.</p>`,
  syntax: `SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT pg_size_pretty(pg_total_relation_size('orders'));
SELECT pg_relation_size('orders', 'main' | 'fsm' | 'vm' | 'init');

SELECT blks_hit, blks_read FROM pg_stat_database;
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum FROM pg_stat_user_tables;
SELECT datname, age(datfrozenxid) FROM pg_database;`,
  examples: [
    {
      label: 'Basic',
      title: 'Database size and cache hit ratio',
      sql: `SELECT current_database()                                     AS db,
       pg_size_pretty(pg_database_size(current_database()))   AS size,
       blks_hit,
       blks_read,
       round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) AS cache_hit_pct
FROM   pg_stat_database
WHERE  datname = current_database();`,
      explain: `<p><code>pg_database_size</code> returns bytes; <code>pg_size_pretty</code> formats them. The cache-hit expression uses <code>nullif(…, 0)</code> to avoid division by zero on a freshly reset database. In the playground the ratio is lower than production because the database has just been loaded from disk — the cache is cold. A real OLTP primary typically shows 99%+ after warm-up.</p>`,
      output: ` db       | size  | blks_hit | blks_read | cache_hit_pct
----------+-------+----------+-----------+---------------
 postgres | 11 MB |     1829 |       140 |         92.89
-- counters grow as you run queries; exact numbers differ`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Table sizes: heap vs indexes vs TOAST',
      sql: `SELECT c.relname                                                   AS table_name,
       pg_size_pretty(pg_total_relation_size(c.oid))               AS total,
       pg_size_pretty(pg_relation_size(c.oid))                     AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))                      AS indexes,
       pg_size_pretty(pg_table_size(c.oid) - pg_relation_size(c.oid)) AS toast_fsm_vm,
       round(100.0 * pg_indexes_size(c.oid)
             / nullif(pg_total_relation_size(c.oid), 0), 1)        AS index_pct
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relkind = 'r'
ORDER  BY pg_total_relation_size(c.oid) DESC;`,
      explain: `<p>We ask <code>pg_class</code> for ordinary tables (<code>relkind = 'r'</code>) in <code>public</code> and break down their footprint. <code>pg_table_size − pg_relation_size</code> isolates TOAST + free space map + visibility map. A high <code>index_pct</code> (indexes larger than the data) is a hint to look for unused or duplicate indexes. Always <code>ORDER BY</code> the raw byte value, not the pretty text (text ordering would put "984 kB" above "1368 kB").</p>`,
      output: ` table_name        | total   | heap       | indexes | toast_fsm_vm | index_pct
-------------------+---------+------------+---------+--------------+-----------
 order_items       | 1368 kB | 832 kB     | 512 kB  | 24 kB        |      37.4
 orders            | 984 kB  | 712 kB     | 240 kB  | 32 kB        |      24.4
 payments          | 504 kB  | 352 kB     | 120 kB  | 32 kB        |      23.8
 customers         | 176 kB  | 56 kB      | 88 kB   | 32 kB        |      50.0
 employees         | 120 kB  | 24 kB      | 64 kB   | 32 kB        |      53.3
 ... (12 rows)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Vacuum and wraparound health in one report',
      sql: `-- Per-table dead tuples and vacuum recency
SELECT relname,
       n_live_tup,
       n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_autovacuum,
       last_autoanalyze,
       autovacuum_count
FROM   pg_stat_user_tables
ORDER  BY n_dead_tup DESC
LIMIT  10;

-- Transaction-ID age per database (wraparound distance)
SELECT datname,
       age(datfrozenxid)                                   AS xid_age,
       round(100.0 * age(datfrozenxid) / 2000000000, 2)    AS pct_to_wraparound,
       current_setting('autovacuum_freeze_max_age')::bigint AS forced_vacuum_at
FROM   pg_database
ORDER  BY age(datfrozenxid) DESC;`,
      explain: `<p>The first query ranks tables by dead tuples — the raw material of bloat. A dead_pct persistently above ~20% on a large table, or a <code>last_autovacuum</code> that is days old on a busy table, means autovacuum is throttled, blocked by a long transaction, or needs per-table tuning. The second query shows how far each database is on the ~2 billion XID ring: autovacuum starts aggressive anti-wraparound vacuums at <code>autovacuum_freeze_max_age</code> (200 M default); alert well before 1 billion. (In the playground the stats counters start at zero because the database was restored from a snapshot.)</p>`,
      output: ` relname     | n_live_tup | n_dead_tup | dead_pct | last_autovacuum | last_autoanalyze | autovacuum_count
-------------+------------+------------+----------+-----------------+------------------+------------------
 audit_logs  |          0 |          0 |          |                 |                  |                0
 ...
 datname   | xid_age | pct_to_wraparound | forced_vacuum_at
-----------+---------+-------------------+------------------
 postgres  |      10 |              0.00 |        200000000
 template1 |      10 |              0.00 |        200000000
 template0 |      10 |              0.00 |        200000000`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Sorting by the formatted string
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM   pg_stat_user_tables
ORDER  BY size DESC;`, why: 'pg_size_pretty returns text, so ORDER BY sorts alphabetically: "984 kB" sorts above "1368 kB" and "9 GB" above "10 TB". The biggest tables are not on top.', run: true },
    good: { sql: `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM   pg_stat_user_tables
ORDER  BY pg_total_relation_size(relid) DESC;`, why: 'Sort by the numeric byte count, display the pretty text. Correct order every time.', run: true }
  },
  mistakes: [
    `Treating the cache hit ratio as the main health metric; it averages away the one query that reads 50 GB from disk. Use <code>pg_stat_statements</code> <span class="tag ext">extension</span> to find heavy readers.`,
    `Monitoring only the data volume and forgetting the <strong>WAL volume</strong> — an inactive replication slot or failing archive_command fills <code>pg_wal</code> and stops the server.`,
    `Alerting on instantaneous spikes (one sample of 100% CPU) and training on-call to ignore pages. Use durations: "&gt; 90% for 10 minutes".`,
    `Resetting statistics (<code>pg_stat_reset()</code>) casually and losing the "unused index" evidence collected over months.`,
    `Not monitoring XID age; anti-wraparound emergencies are rare but catastrophic (the cluster refuses new XIDs).`
  ],
  best: [
    `Export metrics continuously (postgres_exporter, a managed agent, or pgwatch <span class="tag tool">third-party tool</span>) — statistics reset on crash and failover.`,
    `Dashboard the "golden signals" per database: TPS (commits+rollbacks/s), latency (from pg_stat_statements or app), connections by state, errors (rollbacks, deadlocks), saturation (CPU, IO await, disk free).`,
    `Enable <code>track_io_timing = on</code> (check overhead with <code>pg_test_timing</code>) so pg_stat_statements and EXPLAIN show real IO time.`,
    `Forecast disk usage (linear regression in Prometheus: <code>predict_linear</code>) and alert days before it fills, not at 95%.`,
    `Keep a runbook link inside every alert annotation.`
  ],
  performance: `<p>Monitoring queries themselves must be light. Catalog-only queries (pg_stat_*, pg_class sizes) are cheap; per-table size functions over tens of thousands of partitions, <code>pgstattuple</code>, and bloat estimators over every table are not — run them less often or on a replica. The exporter should connect through a dedicated role with <code>pg_monitor</code>, with a short <code>statement_timeout</code> so a stuck metric query never piles up.</p>
<h4>Alert threshold reference</h4>
<table>
<tr><th>Signal</th><th>Warning</th><th>Critical</th></tr>
<tr><td>Instance down / exporter scrape failing</td><td>—</td><td>1 min</td></tr>
<tr><td>Connections used vs max_connections</td><td>&gt; 75%</td><td>&gt; 90%</td></tr>
<tr><td>Oldest transaction age (xact_start)</td><td>&gt; 15 min</td><td>&gt; 1 h</td></tr>
<tr><td>Idle in transaction sessions longer than 5 min</td><td>≥ 1</td><td>≥ 5</td></tr>
<tr><td>Lock wait duration</td><td>&gt; 30 s</td><td>&gt; 5 min</td></tr>
<tr><td>Replication lag (replay)</td><td>&gt; 30 s or 1 GB</td><td>&gt; 5 min or 10 GB</td></tr>
<tr><td>Disk free (data or WAL volume)</td><td>&lt; 25%</td><td>&lt; 10% / full in &lt; 24 h</td></tr>
<tr><td>XID age (age(datfrozenxid))</td><td>&gt; 500 M</td><td>&gt; 1 B</td></tr>
<tr><td>Cache hit ratio (OLTP)</td><td>&lt; 98% for 30 min</td><td>&lt; 95% for 30 min</td></tr>
<tr><td>Deadlocks rate</td><td>&gt; 0 sustained 10 min</td><td>&gt; 5/min</td></tr>
<tr><td>CPU utilisation</td><td>&gt; 80% for 15 min</td><td>&gt; 95% for 10 min</td></tr>
<tr><td>Disk await latency</td><td>&gt; 10 ms</td><td>&gt; 50 ms</td></tr>
<tr><td>WAL archiving failures (pg_stat_archiver.failed_count rising)</td><td>any</td><td>&gt; 15 min of failures</td></tr>
</table>`,
  security: `<p>Monitoring roles should be <code>LOGIN</code> roles with <code>pg_monitor</code> only — never superuser — and connect over TLS. The <code>/metrics</code> endpoint of postgres_exporter can leak database names, table names and query statistics; bind it to a private network or protect it with authentication. Avoid exporting full query text to third-party SaaS when it may contain PII literals.</p>`,
  scenario: {
    title: 'Disk usage alert: 85% and climbing 3% per day',
    steps: [
      '1. Check which volume: data directory or pg_wal. SELECT pg_size_pretty(sum(size)) FROM pg_ls_waldir(); for WAL.',
      '2. If WAL: check pg_replication_slots for inactive slots with large restart_lsn lag, and pg_stat_archiver for failures.',
      '3. If data: rank tables by pg_total_relation_size and compare with last week (from your metrics store).',
      '4. For the growing table, check n_dead_tup and last_autovacuum — bloat or genuine growth?',
      '5. Bloat → fix the long transaction / tune autovacuum, then reclaim with pg_repack (third-party) if needed; growth → add partition retention or capacity.',
      '6. Expand the volume before 90% as a stopgap and record the forecast in the capacity plan.'
    ]
  },
  widgets: ['diagram:prod-cluster'],
  interview: [
    { q: 'What does the cache hit ratio in pg_stat_database actually measure?', a: 'The fraction of block requests satisfied from PostgreSQL shared_buffers. A "read" may still be served from the OS page cache, so a lower ratio does not necessarily mean physical disk reads. It is a useful trend signal but must be combined with IO latency and per-query statistics.' },
    { q: 'Difference between pg_relation_size, pg_table_size and pg_total_relation_size?', a: 'pg_relation_size measures a single fork (main by default) of one relation. pg_table_size adds TOAST, free space map and visibility map but excludes indexes. pg_total_relation_size includes everything: heap, TOAST and all indexes.' },
    { q: 'Which metrics would you alert on for a PostgreSQL primary?', a: 'Availability, connection saturation, oldest transaction age, lock waits, replication lag, disk free and growth forecast for data and WAL, XID age, WAL archiving failures, sustained CPU and IO latency, and error rates (rollbacks, deadlocks). Each with durations so they only fire when action is needed.' },
    { q: 'Why store metrics outside PostgreSQL?', a: 'Cumulative stats are cleared on crash and do not carry over to a promoted replica; they are counters, not history. An external time-series store (Prometheus etc.) keeps rates and trends across restarts and failovers and enables forecasting.' }
  ],
  exercises: [
    { task: 'List the 5 largest indexes in the public schema with their table names and sizes.', solution: `SELECT indexrelname AS index_name, relname AS table_name,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM   pg_stat_user_indexes
ORDER  BY pg_relation_size(indexrelid) DESC
LIMIT  5;`, run: true },
    { task: 'Compute the index cache hit ratio per table from pg_statio_user_tables (show NULL where there were no index block requests).', solution: `SELECT relname,
       idx_blks_hit, idx_blks_read,
       round(100.0 * idx_blks_hit / nullif(idx_blks_hit + idx_blks_read, 0), 2) AS idx_hit_pct
FROM   pg_statio_user_tables
ORDER  BY relname;`, run: true },
    { task: 'Show the size of each fork (main, fsm, vm) of the orders table.', solution: `SELECT pg_size_pretty(pg_relation_size('orders', 'main')) AS main,
       pg_size_pretty(pg_relation_size('orders', 'fsm'))  AS fsm,
       pg_size_pretty(pg_relation_size('orders', 'vm'))   AS vm;`, run: true }
  ],
  challenge: {
    task: 'Produce one "capacity summary" row: database size, total size of user tables, total size of their indexes, the share of indexes in percent, and the name of the largest table.',
    hint: 'Aggregate over pg_class filtered to relkind = r in public; use a subquery or ORDER BY ... LIMIT 1 for the largest table.',
    solution: `WITH t AS (
  SELECT c.oid, c.relname,
         pg_table_size(c.oid)   AS table_bytes,
         pg_indexes_size(c.oid) AS index_bytes
  FROM   pg_class c
  JOIN   pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public' AND c.relkind = 'r'
)
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size,
       pg_size_pretty(sum(table_bytes))                      AS tables,
       pg_size_pretty(sum(index_bytes))                      AS indexes,
       round(100.0 * sum(index_bytes) / sum(table_bytes + index_bytes), 1) AS index_pct,
       (SELECT relname FROM t ORDER BY table_bytes + index_bytes DESC LIMIT 1) AS largest_table
FROM   t;`,
    run: true
  },
  related: ['monitoring-pg-stat-activity', 'monitoring-locks-connections', 'system-catalogs-statistics-views', 'vacuum', 'production-optimization'],
  quiz: [
    { type: 'mcq', q: 'Which function includes indexes and TOAST in its result?', options: ['pg_relation_size', 'pg_table_size', 'pg_total_relation_size', 'pg_column_size'], answer: 2, explain: 'pg_total_relation_size = table + TOAST + FSM/VM + all indexes.' },
    { type: 'tf', q: 'Since PostgreSQL 15, cumulative statistics are kept in shared memory and there is no separate stats collector process.', answer: true, explain: 'PG15 replaced the UDP-based stats collector with shared-memory statistics, flushed to disk at clean shutdown.' },
    { type: 'bug', q: 'Why does this alert page every night at 02:00 for 30 seconds?', code: `alert: cpu > 90%   # evaluated on every 15s sample, no duration`, options: ['CPU metrics are wrong', 'No "for:" duration — a brief nightly batch spike pages on-call', 'Prometheus cannot read CPU', 'The threshold is too low for PostgreSQL'], answer: 1, explain: 'Add a duration (e.g. for: 10m) so only sustained saturation alerts.' },
    { type: 'scenario', q: 'n_dead_tup on orders keeps growing although autovacuum runs every few minutes. Most likely cause?', options: ['work_mem is too low', 'A long-running transaction or stale replication slot holds back the xmin horizon', 'The table has too many indexes', 'shared_buffers is too small'], answer: 1, explain: 'Vacuum cannot remove tuples still visible to the oldest snapshot. Check pg_stat_activity.backend_xmin and pg_replication_slots.' }
  ]
}
]);

/* ---------------------- PRODUCTION OPTIMIZATION ---------------------- */
PGM.addLessons([
{
  id: 'production-optimization-memory',
  module: 'production-optimization',
  title: 'Memory Configuration: shared_buffers, effective_cache_size, work_mem and Friends',
  level: 5,
  minutes: 25,
  summary: 'Size shared_buffers, effective_cache_size, work_mem, maintenance_work_mem and huge pages correctly — and understand why work_mem is per operation, not per connection.',
  objectives: [
    'Explain the double-buffering model: shared_buffers plus the OS page cache',
    'Size shared_buffers and effective_cache_size for a given RAM size and workload',
    'Calculate worst-case work_mem consumption (nodes × parallel workers × connections × hash_mem_multiplier)',
    'Tune maintenance_work_mem and autovacuum_work_mem for index builds and vacuum',
    'Decide when to enable huge_pages and how to size them',
    'Detect memory-related problems: temp-file spills, OOM kills, swapping'
  ],
  concept: `<p>PostgreSQL uses two layers of cache: its own <strong>shared buffer pool</strong> (<code>shared_buffers</code>) shared by all processes, and the operating system's <strong>page cache</strong>, which caches the same data files from the kernel side. On top of that, each backend allocates <strong>private memory</strong> for sorts, hashes and maintenance operations.</p>
<p><strong>Analogy:</strong> a restaurant kitchen. <code>shared_buffers</code> is the shared prep counter right next to the cooks; the OS page cache is the walk-in fridge down the corridor; disk is the supplier's warehouse across town. <code>work_mem</code> is the size of the chopping board <em>each</em> cook gets for <em>each</em> dish they are working on at the same time — give every cook a huge board and the kitchen runs out of floor space.</p>
<h4>The main memory parameters</h4>
<table>
<tr><th>Parameter</th><th>Default</th><th>Scope</th><th>Typical production value</th></tr>
<tr><td><code>shared_buffers</code></td><td>128MB</td><td>Shared, allocated at start (restart to change)</td><td>~25% of RAM (start), rarely above 40%</td></tr>
<tr><td><code>effective_cache_size</code></td><td>4GB</td><td>Planner hint only — allocates nothing</td><td>50–75% of RAM</td></tr>
<tr><td><code>work_mem</code></td><td>4MB</td><td>Per sort/hash <em>node</em>, per process</td><td>16–64MB for OLTP; more per-session for reports</td></tr>
<tr><td><code>hash_mem_multiplier</code></td><td>2.0</td><td>Hash nodes may use work_mem × this</td><td>2.0 (default is fine)</td></tr>
<tr><td><code>maintenance_work_mem</code></td><td>64MB</td><td>Per VACUUM, CREATE INDEX, ALTER TABLE ADD FOREIGN KEY</td><td>1–2GB</td></tr>
<tr><td><code>autovacuum_work_mem</code></td><td>-1 (use maintenance_work_mem)</td><td>Per autovacuum worker</td><td>256MB–1GB</td></tr>
<tr><td><code>temp_buffers</code></td><td>8MB</td><td>Per session, for temporary tables</td><td>Default unless heavy temp-table use</td></tr>
<tr><td><code>huge_pages</code></td><td>try</td><td>Use 2MB OS pages for shared memory</td><td><code>on</code> for &gt; 16GB shared_buffers on Linux</td></tr>
</table>
<h4>The work_mem trap</h4>
<p><code>work_mem</code> is <strong>not</strong> a per-connection limit. Every Sort, Hash, Hash Aggregate, Materialize, Memoize or bitmap node in a plan can use up to <code>work_mem</code> (hash nodes up to <code>work_mem × hash_mem_multiplier</code>), and each parallel worker gets its own allowance. Worst case:</p>
<p><code>connections × nodes_per_query × (1 + parallel_workers) × work_mem × hash_mem_multiplier</code></p>
<p>Example: 300 connections × 4 nodes × 3 processes × 64MB × 2 ≈ <strong>460GB</strong> on a 64GB server. That never happens all at once in reality — but bursts of reporting queries can push the box into the Linux OOM killer, which kills a backend and forces the whole cluster through crash recovery. Hence: keep the global value moderate, raise it per role or per transaction for the queries that need it.</p>`,
  why: `<p>Memory is the cheapest performance you can buy: an OLTP workload whose working set fits in RAM avoids almost all read IO. But PostgreSQL's defaults are deliberately tiny (128MB shared_buffers, 4MB work_mem) so that it starts on a Raspberry Pi. Untuned production servers leave 90% of their RAM idle for the database's purposes, while queries spill sorts to disk.</p>`,
  useCase: `<p>A fintech runs a 64GB / 16 vCPU primary handling 8,000 TPS of OLTP plus a nightly reconciliation report. Settings: <code>shared_buffers = 16GB</code>, <code>effective_cache_size = 48GB</code>, <code>work_mem = 32MB</code> globally, and <code>ALTER ROLE reporting SET work_mem = '512MB'</code> for the report user only. The report's 40GB sort previously spilled 38GB of temp files and took 47 minutes; with 512MB per sort and an index on the sort key it finishes in 6 minutes, while 400 OLTP connections can never collectively blow past RAM.</p>`,
  internals: `<p><code>shared_buffers</code> is an array of 8KB buffers plus a hash table mapping (relation, fork, block) → buffer id. Each buffer has a header with a usage count (0–5) and pin count; when a backend needs a free buffer and none is on the free list, the <strong>clock-sweep</strong> algorithm walks the array decrementing usage counts until it finds an unpinned buffer with count 0 to evict (writing it first if dirty). Large sequential scans and VACUUM use a small <em>ring buffer</em> (256KB for scans; vacuum's ring is governed by <code>vacuum_buffer_usage_limit</code>, PG16+) so they do not flush the whole cache.</p>
<p>Because every block read from disk also lands in the OS page cache, data can be cached twice. That is why shared_buffers above ~40% of RAM usually stops helping: you steal memory from the page cache that would have held the same blocks anyway, and you increase checkpoint work. <code>effective_cache_size</code> tells the planner roughly how much of both caches is available, which affects how cheap it believes repeated index lookups are.</p>
<p>Private memory lives in per-backend <em>memory contexts</em>: when a sort exceeds work_mem it switches to an external merge sort using temp files under <code>base/pgsql_tmp</code>; a hash join increases its number of batches and writes batches to temp files; hash aggregation spills partitions (since PG13). <code>log_temp_files = 0</code> logs every spill with its size.</p>`,
  whenNot: `<p>Do not copy "25% of RAM" blindly: on a 512GB analytics box or a container with a hard memory limit, measure. Do not set huge work_mem globally to fix one slow report. Do not increase shared_buffers to fix a query that reads too much — fix the query or add an index. On managed services (RDS, Cloud SQL, Azure) many of these are set by formula already; change them through parameter groups, and check the provider's guidance first.</p>`,
  syntax: `-- postgresql.conf (restart needed for shared_buffers, huge_pages)
shared_buffers        = 16GB
effective_cache_size  = 48GB
work_mem              = 32MB
maintenance_work_mem  = 2GB
autovacuum_work_mem   = 1GB
huge_pages            = on        # try | on | off

-- targeted overrides
ALTER ROLE reporting SET work_mem = '512MB';
SET LOCAL work_mem = '256MB';     -- inside one transaction`,
  examples: [
    {
      label: 'Basic',
      title: 'Read the current memory settings with units',
      sql: `SELECT name,
       setting,
       unit,
       current_setting(name) AS human_value,
       context,
       source
FROM   pg_settings
WHERE  name IN ('shared_buffers', 'effective_cache_size', 'work_mem',
                'hash_mem_multiplier', 'maintenance_work_mem',
                'autovacuum_work_mem', 'temp_buffers', 'huge_pages')
ORDER  BY name;`,
      explain: `<p><code>setting</code> is stored in the parameter's base unit (8kB blocks for shared_buffers, kB for work_mem), which is why 16384 means 128MB. <code>current_setting(name)</code> returns the human-friendly form. <code>context</code> tells you how it can be changed: <code>postmaster</code> = restart, <code>sighup</code> = reload, <code>user</code> = per session.</p>`,
      output: ` name                 | setting | unit | human_value | context    | source
----------------------+---------+------+-------------+------------+--------------------
 autovacuum_work_mem  | -1      | kB   | -1          | sighup     | default
 effective_cache_size | 524288  | 8kB  | 4GB         | user       | default
 hash_mem_multiplier  | 2       |      | 2           | user       | default
 huge_pages           | try     |      | try         | postmaster | default
 maintenance_work_mem | 65536   | kB   | 64MB        | user       | default
 shared_buffers       | 16384   | 8kB  | 128MB       | postmaster | configuration file
 temp_buffers         | 1024    | 8kB  | 8MB         | user       | default
 work_mem             | 4096    | kB   | 4MB         | user       | default`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Watch a sort spill to disk, then fit in memory',
      sql: `BEGIN;
SET LOCAL work_mem = '64kB';
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT * FROM order_items ORDER BY unit_price DESC;

SET LOCAL work_mem = '4MB';
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT * FROM order_items ORDER BY unit_price DESC;
ROLLBACK;`,
      explain: `<p>Sorting 12,500 rows needs about 928kB. With <code>work_mem = 64kB</code> the executor switches to <strong>external merge</strong> and writes 560kB of temp files; with 4MB it uses an in-memory <strong>quicksort</strong>. On a real server the spill is far more expensive than here (disk writes + reads, often 5–50× slower). <code>SET LOCAL</code> scopes the change to this transaction only — the safe way to give one query more memory.</p>`,
      output: ` Sort (actual rows=12500.00 loops=1)
   Sort Key: unit_price DESC
   Sort Method: external merge  Disk: 560kB
   ->  Seq Scan on order_items (actual rows=12500.00 loops=1)

 Sort (actual rows=12500.00 loops=1)
   Sort Key: unit_price DESC
   Sort Method: quicksort  Memory: 928kB
   ->  Seq Scan on order_items (actual rows=12500.00 loops=1)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Worst-case work_mem budget and huge-pages sizing',
      sql: `-- What could private sort/hash memory reach in the worst case?
WITH s AS (
  SELECT current_setting('max_connections')::int            AS conns,
         pg_size_bytes(current_setting('work_mem'))           AS work_mem,
         current_setting('hash_mem_multiplier')::numeric      AS hash_mult,
         current_setting('max_parallel_workers_per_gather')::int AS workers
)
SELECT conns,
       pg_size_pretty(work_mem)                              AS work_mem,
       pg_size_pretty((conns * 3 * (1 + workers) * work_mem * hash_mult)::bigint)
                                                              AS worst_case_3_nodes,
       current_setting('shared_memory_size')                  AS shared_memory,
       current_setting('shared_memory_size_in_huge_pages')    AS huge_pages_needed
FROM   s;`,
      explain: `<p><code>pg_size_bytes()</code> converts "4MB" to bytes so we can do arithmetic. The worst-case figure assumes every connection runs a query with 3 memory-hungry nodes at once — pessimistic, but this is the number that matters when the OOM killer visits. <code>shared_memory_size</code> and <code>shared_memory_size_in_huge_pages</code> (PG15+, runtime-computed, read-only) tell you exactly how much shared memory the server allocated and how many 2MB huge pages to reserve in <code>vm.nr_hugepages</code> before setting <code>huge_pages = on</code>. On a server you can also get it before startup with <code>postgres -D $PGDATA -C shared_memory_size_in_huge_pages</code>.</p>`,
      output: ` conns | work_mem | worst_case_3_nodes | shared_memory | huge_pages_needed
-------+----------+--------------------+---------------+-------------------
   100 | 4096 kB  | 2400 MB            | 145MB         | 73
-- (playground: parallel workers = 0; a 64GB server with 300 conns, 32MB, 2 workers → ~169 GB)`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- "Fix" a slow report for everyone
-- ALTER SYSTEM SET work_mem = '1GB';  -- every sort/hash node of every session
SET work_mem = '1GB';
SHOW work_mem;`, why: 'A global 1GB work_mem lets every node of every connection use 1GB (2GB for hashes). One burst of concurrent reports and the OOM killer terminates a backend, which forces the whole cluster through crash recovery.', run: true },
    good: { sql: `BEGIN;
SET LOCAL work_mem = '256MB';     -- only this transaction
SELECT p.category, sum(oi.quantity * oi.unit_price) AS revenue
FROM   order_items oi JOIN products p ON p.id = oi.product_id
GROUP  BY p.category
ORDER  BY revenue DESC;
ROLLBACK;`, why: 'Raise memory only where it is needed: SET LOCAL per transaction or ALTER ROLE reporting SET work_mem for a reporting role. OLTP sessions keep a safe default.', run: true }
  },
  mistakes: [
    `Believing <code>work_mem</code> caps a connection's memory — it caps each sort/hash node, and each parallel worker has its own.`,
    `Setting <code>shared_buffers</code> to 75% of RAM "because databases like memory", starving the OS page cache and the per-backend memory, and lengthening checkpoints.`,
    `Thinking <code>effective_cache_size</code> allocates memory. It is only a planner estimate; setting it wrong changes plans, not memory usage.`,
    `Ignoring temp files: <code>pg_stat_database.temp_bytes</code> growing by tens of GB per hour is a clear work_mem or query problem.`,
    `Enabling <code>huge_pages = on</code> without reserving <code>vm.nr_hugepages</code> — the server then refuses to start. Use <code>try</code> or reserve the pages first.`,
    `Running PostgreSQL in a container with a memory limit but tuning for the host's RAM.`
  ],
  best: [
    `Start with shared_buffers = 25% RAM, effective_cache_size = 75% RAM, then validate with cache-hit ratio and <code>pg_buffercache</code> <span class="tag ext">extension</span>.`,
    `Keep global work_mem modest (16–64MB for OLTP) and override per role, per database or with <code>SET LOCAL</code>.`,
    `Set <code>log_temp_files = 0</code> (or a threshold like 10MB) to find spilling queries in the logs.`,
    `Disable memory overcommit heuristics on dedicated Linux DB hosts (<code>vm.overcommit_memory = 2</code>) and set <code>vm.swappiness</code> low so the OOM killer is a last resort.`,
    `Use huge pages for shared_buffers ≥ 8–16GB: fewer TLB misses and much smaller page tables per backend.`
  ],
  performance: `<p>Bigger shared_buffers reduces reads but increases the amount of dirty data each checkpoint must flush and the cost of dropping/truncating relations (buffer mapping scans). Bigger work_mem turns disk spills into in-memory operations — often a 5–20× speed-up for that node — but multiplies memory risk. Huge pages typically give a few percent to 10%+ CPU reduction on large shared_buffers with many connections, because each backend otherwise maps the shared memory with millions of 4KB page table entries.</p>`,
  security: `<p>Allowing any role to <code>SET work_mem</code> lets a user consume large amounts of RAM (a resource-exhaustion vector). For untrusted or multi-tenant roles, consider lower per-role defaults and <code>temp_file_limit</code> to cap temp-file usage per process.</p>`,
  scenario: {
    title: 'The OOM killer terminated a backend and the whole cluster restarted',
    steps: [
      '1. Confirm in the kernel log (dmesg) that the OOM killer killed a postgres process; the PostgreSQL log will show "terminated by signal 9" and crash recovery.',
      '2. Find what ran at the time: logs with log_min_duration_statement, or pg_stat_statements top queries by temp_blks_written and mean time.',
      '3. Compute the work_mem worst case for current max_connections and parallel workers.',
      '4. Lower global work_mem, raise it only for the reporting role; cap concurrency with a pooler.',
      '5. Set vm.overcommit_memory = 2 with an appropriate overcommit_ratio so allocations fail gracefully (query error) instead of OOM kills.',
      '6. Add alerts on temp_bytes rate and host memory usage.'
    ]
  },
  widgets: ['diagram:memory'],
  interview: [
    { q: 'How would you size shared_buffers on a 64GB dedicated server?', a: 'Start at ~25% (16GB), set effective_cache_size around 48GB, enable huge pages, then validate with cache hit ratio, checkpoint statistics and pg_buffercache. Going far above 40% rarely helps because data is double-cached in the OS page cache and checkpoints get heavier.' },
    { q: 'Why is work_mem dangerous to raise globally?', a: 'It applies per sort/hash node per process, hash nodes may use work_mem × hash_mem_multiplier, and parallel workers each get their own. Many concurrent complex queries can therefore use many multiples of RAM, leading to OOM kills and cluster-wide crash recovery.' },
    { q: 'What does effective_cache_size do?', a: 'Nothing is allocated. It informs the planner how much data is likely cached across shared_buffers and the OS cache, which lowers the estimated cost of repeated index access. Too low a value makes the planner avoid index scans on large tables.' },
    { q: 'How do you detect that work_mem is too small?', a: 'EXPLAIN ANALYZE shows "Sort Method: external merge Disk: …" or hash "Batches: > 1"; pg_stat_database.temp_files/temp_bytes grow; log_temp_files logs each spill; pg_stat_statements temp_blks_written identifies the queries.' }
  ],
  exercises: [
    { task: 'Convert the current work_mem and maintenance_work_mem settings to bytes with pg_size_bytes().', solution: `SELECT pg_size_bytes(current_setting('work_mem'))             AS work_mem_bytes,
       pg_size_bytes(current_setting('maintenance_work_mem')) AS maint_bytes;`, run: true },
    { task: 'Show how many temp files and bytes the current database has written since the last stats reset.', solution: `SELECT datname, temp_files, pg_size_pretty(temp_bytes) AS temp_written
FROM   pg_stat_database
WHERE  datname = current_database();`, run: true },
    { task: 'Find the smallest work_mem (try 256kB, 512kB, 1MB) at which the hash join between orders and order_items uses a single batch.', solution: `BEGIN;
SET LOCAL work_mem = '256kB';
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT o.customer_id, sum(oi.quantity)
FROM orders o JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.customer_id;
ROLLBACK;
-- Look at the "Hash ... Batches:" line; repeat with 512kB and 1MB`, run: true }
  ],
  challenge: {
    task: 'Write a query that recommends starting values for a server, given RAM in GB as a literal (e.g. 64) and the expected max_connections (e.g. 300): shared_buffers 25%, effective_cache_size 75%, maintenance_work_mem min(2GB, 5% RAM), and work_mem = (RAM − shared_buffers) × 0.25 / (max_connections × 3), floored at 4MB.',
    hint: 'Use a VALUES CTE for the inputs and pg_size_pretty on byte arithmetic (1GB = 1024^3 bytes).',
    solution: `WITH input(ram_gb, max_conn) AS (VALUES (64, 300)),
b AS (SELECT ram_gb::bigint * 1024 * 1024 * 1024 AS ram, max_conn FROM input)
SELECT pg_size_pretty(ram / 4)                                   AS shared_buffers,
       pg_size_pretty(ram * 3 / 4)                               AS effective_cache_size,
       pg_size_pretty(least(2::bigint * 1024 * 1024 * 1024, ram / 20)) AS maintenance_work_mem,
       pg_size_pretty(greatest(4 * 1024 * 1024,
                      ((ram - ram / 4) * 0.25 / (max_conn * 3))::bigint)) AS work_mem
FROM b;`,
    run: true
  },
  related: ['production-optimization-io-planner', 'internals-memory', 'configuration', 'explain', 'monitoring-health-metrics'],
  quiz: [
    { type: 'mcq', q: 'Which setting allocates no memory at all?', options: ['shared_buffers', 'work_mem', 'effective_cache_size', 'wal_buffers'], answer: 2, explain: 'effective_cache_size is purely a planner hint about available caching.' },
    { type: 'tf', q: 'A query with two sort nodes and one hash join, run with 2 parallel workers, can use more than work_mem × 3.', answer: true, explain: 'Each process (leader + 2 workers) can use work_mem per node, and the hash node may use work_mem × hash_mem_multiplier.' },
    { type: 'predict', q: 'What does EXPLAIN ANALYZE most likely show?', code: `SET work_mem = '64kB';
EXPLAIN ANALYZE SELECT * FROM order_items ORDER BY unit_price;`, options: ['Sort Method: quicksort Memory: 928kB', 'Sort Method: external merge Disk: ~560kB', 'Index Scan using order_items_pkey', 'Sort Method: top-N heapsort'], answer: 1, explain: 'The sort needs ~928kB; with 64kB it spills to disk with an external merge.' },
    { type: 'scenario', q: 'A nightly report spills 40GB of temp files. The server has 64GB RAM and 400 connections. Best fix?', options: ['ALTER SYSTEM SET work_mem = \'2GB\'', 'ALTER ROLE reporting SET work_mem = \'512MB\' and review the query/indexes', 'Increase shared_buffers to 48GB', 'Increase effective_cache_size'], answer: 1, explain: 'Target the role that needs memory; also check whether an index can avoid the sort. Global changes risk OOM.' }
  ]
},
{
  id: 'production-optimization-io-planner',
  module: 'production-optimization',
  title: 'IO and Planner Cost Settings: random_page_cost, effective_io_concurrency and PG18 Async IO',
  level: 5,
  minutes: 20,
  summary: 'Tell the planner the truth about your storage: random_page_cost and seq_page_cost on SSDs, effective_io_concurrency prefetching, and PostgreSQL 18\'s io_method asynchronous IO.',
  objectives: [
    'Explain how seq_page_cost and random_page_cost drive the choice between sequential and index scans',
    'Choose values for SSD/NVMe and network block storage',
    'Configure effective_io_concurrency and maintenance_io_concurrency',
    'Describe PostgreSQL 18 asynchronous IO: io_method = sync | worker | io_uring, io_workers',
    'Verify the effect of cost settings with EXPLAIN before changing them globally'
  ],
  concept: `<p>The PostgreSQL planner is <strong>cost-based</strong>: it estimates each plan's cost in abstract units and picks the cheapest. Two of the most influential constants describe storage:</p>
<ul>
<li><code>seq_page_cost</code> (default 1.0) — cost of reading one 8KB page as part of a sequential scan.</li>
<li><code>random_page_cost</code> (default 4.0) — cost of reading one page non-sequentially (index → heap lookups).</li>
</ul>
<p>The default 4.0 dates from spinning disks, where a random read cost a head seek (~10 ms) — actually ~40× a sequential read, discounted because many random reads hit cache. On SSD/NVMe random reads are almost as cheap as sequential ones, so the defaults make the planner <em>underuse indexes</em>. Common production values: <strong>1.1–1.5</strong> on local SSD/NVMe, 1.5–2.0 on cloud network volumes (EBS gp3, Azure Premium SSD), and 1.0 when the whole database fits in RAM.</p>
<p><strong>Analogy:</strong> choosing between reading a book cover to cover (sequential) or jumping around via the index at the back (random). If every jump requires walking to another building (HDD seek), you read the book cover to cover more often. If jumping is instant (SSD), you use the index far more. <code>random_page_cost</code> tells the planner how far the other building is.</p>
<h4>Prefetching and asynchronous IO</h4>
<ul>
<li><code>effective_io_concurrency</code> — how many concurrent read requests PostgreSQL may issue ahead for bitmap heap scans (and, in PG18, other read-stream users). Default <strong>16 in PG18</strong> (1 in earlier versions). SSD/NVMe: 64–256; network volumes: 32–128.</li>
<li><code>maintenance_io_concurrency</code> — same for maintenance work (VACUUM, ANALYZE prefetch, recovery prefetch). Default 16 in PG18.</li>
<li><code>io_method</code> <span class="tag core">PostgreSQL 18</span> — the new asynchronous IO subsystem: <code>sync</code> (classic synchronous reads, with posix_fadvise hints), <code>worker</code> (default; dedicated IO worker processes, count set by <code>io_workers</code>, default 3) or <code>io_uring</code> (Linux only, PostgreSQL built with liburing). Restart required. In PG18 AIO is used for reads — sequential scans, bitmap heap scans, VACUUM — and can significantly speed up scans on high-latency cloud storage.</li>
<li><code>io_combine_limit</code> — maximum size of a combined read (default 128kB), letting adjacent blocks be read in one IO.</li>
</ul>`,
  why: `<p>Wrong cost settings produce systematically wrong plans: sequential scans of a 50GB table where an index lookup would read 30 pages, or (rarely, with too-low values) index scans of most of a table. Changing two numbers often fixes dozens of queries at once — far cheaper than rewriting each. And on cloud volumes with 1–2 ms latency per IO, prefetching/AIO is the difference between a scan taking 20 minutes and 4.</p>`,
  useCase: `<p>A ride-hailing company migrates from on-prem HDD RAID to AWS with gp3 volumes, keeping the old <code>postgresql.conf</code>. Several "find trips for driver in date range" queries switch from Bitmap Heap Scans to Seq Scans as tables grow, and p95 rises from 30 ms to 900 ms. Testing with <code>SET random_page_cost = 1.1</code> in a session restores the index plans; the team rolls it out via <code>ALTER SYSTEM</code> + reload, raises <code>effective_io_concurrency</code> to 128, and after upgrading to PG18 measures 2.5× faster analytical scans with <code>io_method = worker</code> versus <code>sync</code>.</p>`,
  internals: `<p>For an index scan, the planner estimates the number of heap pages fetched using the index correlation (from <code>pg_stats.correlation</code>) and the Mackert-Lohman formula, which also accounts for <code>effective_cache_size</code>: pages expected to be cached are charged less. A perfectly correlated index (rows stored in index order) costs mostly <code>seq_page_cost</code>; an uncorrelated one costs mostly <code>random_page_cost</code>. Lowering <code>random_page_cost</code> therefore makes uncorrelated index and bitmap scans cheaper relative to seq scans and moves the tipping point to larger result fractions.</p>
<p>The PG18 AIO subsystem is built on <em>read streams</em> (introduced in PG17): a consumer (seq scan, bitmap heap scan, vacuum, ANALYZE) describes the blocks it will need; the stream issues combined, asynchronous reads up to the configured concurrency and hands back buffers as they complete. With <code>io_method = worker</code>, backends enqueue requests that IO worker processes execute; with <code>io_uring</code>, the backend submits directly to the kernel ring with no extra process hops. Per-tablespace overrides exist: <code>ALTER TABLESPACE … SET (random_page_cost = …, effective_io_concurrency = …)</code>.</p>`,
  whenNot: `<p>Do not lower <code>random_page_cost</code> below <code>seq_page_cost</code> — it makes no physical sense and produces bizarre plans. Do not tune costs to fix one query whose real problem is a bad row estimate (stale statistics, correlated columns) — fix the estimate with ANALYZE, a higher statistics target or extended statistics. Do not set <code>io_method = io_uring</code> on kernels or container runtimes that block io_uring (some seccomp profiles do); <code>worker</code> is the safe default.</p>`,
  syntax: `seq_page_cost            = 1.0
random_page_cost         = 1.1      # SSD / NVMe
effective_io_concurrency = 200      # per-session settable
maintenance_io_concurrency = 100
io_method                = worker   # PG18: sync | worker | io_uring (restart)
io_workers               = 8        # PG18, with io_method = worker

ALTER TABLESPACE fast_nvme SET (random_page_cost = 1.0, effective_io_concurrency = 256);`,
  examples: [
    {
      label: 'Basic',
      title: 'Inspect the IO and cost settings',
      sql: `SELECT name, setting, unit, context
FROM   pg_settings
WHERE  name IN ('seq_page_cost', 'random_page_cost', 'cpu_tuple_cost',
                'cpu_index_tuple_cost', 'cpu_operator_cost',
                'effective_io_concurrency', 'maintenance_io_concurrency',
                'io_method', 'io_workers', 'io_combine_limit')
ORDER  BY name;`,
      explain: `<p>The <code>cpu_*</code> costs describe processing a row/index entry/operator relative to one sequential page (0.01 / 0.005 / 0.0025) — rarely changed. Note <code>io_method</code> has context <code>postmaster</code> (restart) while <code>effective_io_concurrency</code> is <code>user</code> — you can test values per session. The playground runs with <code>io_method = sync</code> because it is a single WebAssembly process; a standard PG18 server defaults to <code>worker</code>.</p>`,
      output: ` name                       | setting | unit | context
----------------------------+---------+------+------------
 cpu_index_tuple_cost       | 0.005   |      | user
 cpu_operator_cost          | 0.0025  |      | user
 cpu_tuple_cost             | 0.01    |      | user
 effective_io_concurrency   | 16      |      | user
 io_combine_limit           | 16      | 8kB  | user
 io_method                  | sync    |      | postmaster
 io_workers                 | 3       |      | sighup
 maintenance_io_concurrency | 16      |      | user
 random_page_cost           | 4       |      | user
 seq_page_cost              | 1       |      | user`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'random_page_cost flips the plan',
      sql: `CREATE INDEX idx_tmp_orders_customer ON orders (customer_id);
ANALYZE orders;

SET random_page_cost = 4;      -- HDD-era default
EXPLAIN SELECT * FROM orders WHERE customer_id <= 250;

SET random_page_cost = 1.1;    -- SSD / NVMe
EXPLAIN SELECT * FROM orders WHERE customer_id <= 250;`,
      explain: `<p>The query matches ~50% of orders (2,522 rows). With <code>random_page_cost = 4</code> the planner judges index-driven heap access too expensive and seq-scans. With 1.1, the Bitmap Heap Scan (which reads heap pages in physical order but still counts as partly random) becomes cheaper (145.85 &lt; 151.50). On a real SSD the bitmap plan is indeed faster for selective predicates; for 50% of a tiny table the difference is negligible — the point is to see the tipping point move. The index is created inside the example and rolled back.</p>`,
      output: `-- random_page_cost = 4
 Seq Scan on orders  (cost=0.00..151.50 rows=2522 width=36)
   Filter: (customer_id <= 250)

-- random_page_cost = 1.1
 Bitmap Heap Scan on orders  (cost=25.33..145.85 rows=2522 width=36)
   Recheck Cond: (customer_id <= 250)
   ->  Bitmap Index Scan on idx_tmp_orders_customer  (cost=0.00..24.70 rows=2522 width=0)
         Index Cond: (customer_id <= 250)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Production rollout: test per session, then persist safely',
      sql: `-- 1) Test in one session against real queries (EXPLAIN ANALYZE them)
SET random_page_cost = 1.1;
SET effective_io_concurrency = 200;

-- 2) Persist cluster-wide (run as superuser; NOT runnable in the playground)
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
SELECT pg_reload_conf();             -- both are reloadable

-- 3) io_method needs a restart: set it, then check pending_restart
ALTER SYSTEM SET io_method = 'io_uring';
SELECT name, setting, pending_restart FROM pg_settings WHERE name = 'io_method';

-- 4) Different storage classes? Override per tablespace
ALTER TABLESPACE archive_hdd SET (random_page_cost = 4, effective_io_concurrency = 2);`,
      explain: `<p>The safe rollout pattern: (1) prove the benefit in a session with <code>EXPLAIN (ANALYZE, BUFFERS)</code> on your top queries from <code>pg_stat_statements</code>; (2) persist with <code>ALTER SYSTEM</code> (writes <code>postgresql.auto.conf</code>) and <code>pg_reload_conf()</code>; (3) restart-only parameters show <code>pending_restart = true</code> until you restart; (4) tablespaces on slower media keep their own costs. Watch the plan-change rate and p95 latency for a day after the change.</p>`,
      output: `SET
SET
ALTER SYSTEM
ALTER SYSTEM
 pg_reload_conf
----------------
 t
ALTER SYSTEM
 name      | setting | pending_restart
-----------+---------+-----------------
 io_method | worker  | t
ALTER TABLESPACE`,
      run: false
    }
  ],
  compare: {
    bad: { sql: `-- Forcing plans with enable_* switches in production code
SET enable_seqscan = off;
SELECT * FROM orders WHERE customer_id <= 250;`, why: 'enable_seqscan = off adds a huge penalty to every seq scan in the session, including those that are genuinely best. It is a diagnostic tool, not a fix; plans become fragile as data changes.', run: true },
    good: { sql: `-- Tell the planner the truth about storage; let it choose
SET random_page_cost = 1.1;
EXPLAIN SELECT * FROM orders WHERE customer_id <= 250;`, why: 'Correct cost constants make the planner choose index plans when they are actually cheaper on your hardware, and still choose seq scans when most rows are needed.', run: true }
  },
  mistakes: [
    `Keeping <code>random_page_cost = 4</code> on SSD/NVMe and compensating with <code>enable_seqscan = off</code> hacks.`,
    `Setting <code>random_page_cost</code> lower than <code>seq_page_cost</code>.`,
    `Tuning cost constants to fix a plan whose real issue is a row-count misestimate (check estimated vs actual rows in EXPLAIN ANALYZE first).`,
    `Expecting <code>effective_io_concurrency</code> to speed up plain index scans on PG16 and earlier — it affected bitmap heap scans only; PG17/18 read streams widened its reach.`,
    `Changing <code>io_method</code> with a reload and wondering why nothing happened — it requires a restart (<code>pending_restart</code>).`
  ],
  best: [
    `SSD/NVMe: <code>random_page_cost = 1.1</code>, <code>effective_io_concurrency = 200</code>; cloud network volumes: 1.1–2.0 and 64–128, then measure.`,
    `Test cost changes per session against your top 20 queries before persisting them.`,
    `On PostgreSQL 18, keep <code>io_method = worker</code> (default) and raise <code>io_workers</code> on large IO-bound servers; evaluate <code>io_uring</code> on modern Linux kernels.`,
    `Enable <code>track_io_timing</code> so EXPLAIN (ANALYZE, BUFFERS) and pg_stat_io show real read latency.`,
    `Use per-tablespace overrides when mixing storage classes.`
  ],
  performance: `<p>Cost settings change plans, not IO speed; their benefit is choosing the right plan. Prefetching (effective_io_concurrency) and AIO improve the <em>throughput of the chosen plan</em> when storage has latency but plenty of parallelism (NVMe, cloud block storage). Combined reads (<code>io_combine_limit</code>) reduce system calls during sequential scans. Measure with <code>pg_stat_io</code> (PG16+, with <code>read_bytes</code>/<code>read_time</code> in PG18) and OS tools (<code>iostat -x</code>: r/s, rareq-sz, r_await).</p>`,
  security: `<p>Cost parameters are user-settable; a role can only affect its own plans. <code>io_method</code>, <code>io_workers</code> and tablespace options require superuser (or appropriate ownership) — keep them out of application roles' reach. Some hardened container runtimes disable io_uring via seccomp for security reasons; respect that and use <code>worker</code>.</p>`,
  scenario: {
    title: 'After moving to the cloud, index plans turned into seq scans',
    steps: [
      '1. Compare SHOW random_page_cost / effective_io_concurrency with the old servers.',
      '2. Take the top queries by total time from pg_stat_statements; EXPLAIN (ANALYZE, BUFFERS) them.',
      '3. In a session: SET random_page_cost = 1.1; re-run EXPLAIN ANALYZE; compare timings, not just costs.',
      '4. If better for most queries, ALTER SYSTEM SET random_page_cost = 1.1; SELECT pg_reload_conf();',
      '5. Raise effective_io_concurrency for bitmap scans; on PG18 check io_method/io_workers.',
      '6. Monitor plan regressions (auto_explain with log_min_duration) for 24-48 h.'
    ]
  },
  widgets: ['lab:plan', 'diagram:query-pipeline'],
  interview: [
    { q: 'Why lower random_page_cost on SSDs?', a: 'The default 4.0 models spinning disks where random reads were far more expensive than sequential ones. On SSD/NVMe the difference is small, so the default overestimates index-scan cost and the planner picks sequential scans too often. Values around 1.1–1.5 reflect SSD reality.' },
    { q: 'What is io_method in PostgreSQL 18?', a: 'It selects the asynchronous IO implementation: sync (old behaviour), worker (default; IO worker processes perform reads on behalf of backends, count from io_workers) or io_uring (Linux kernel interface, requires liburing support). It speeds up sequential scans, bitmap heap scans and vacuum, especially on high-latency storage. Changing it requires a restart.' },
    { q: 'What does effective_io_concurrency control?', a: 'How many read requests PostgreSQL issues ahead of time (prefetch distance) for operations that know future block numbers — bitmap heap scans historically, and read-stream consumers in PG17/18. Higher values help storage that can serve many concurrent IOs.' },
    { q: 'A plan is wrong. Should you change random_page_cost?', a: 'Only if the cost model is the problem. First compare estimated vs actual rows in EXPLAIN ANALYZE; if estimates are off, fix statistics (ANALYZE, statistics target, CREATE STATISTICS). If estimates are right but the plan is still slow, then cost constants may be misrepresenting your hardware.' }
  ],
  exercises: [
    { task: 'Show the planner cost constants and whether each one has been changed from its default (compare setting with boot_val).', solution: `SELECT name, setting, boot_val, setting <> boot_val AS changed
FROM   pg_settings
WHERE  category LIKE 'Query Tuning / Planner Cost Constants%'
ORDER  BY name;`, run: true },
    { task: 'Set effective_io_concurrency to 200 for this transaction only and confirm with SHOW.', solution: `BEGIN;
SET LOCAL effective_io_concurrency = 200;
SHOW effective_io_concurrency;
ROLLBACK;`, run: true },
    { task: 'Show pg_stat_io rows for client backends with reads or hits, including read_bytes (PG18).', solution: `SELECT backend_type, object, context, reads, read_bytes, hits
FROM   pg_stat_io
WHERE  backend_type = 'client backend' AND (reads > 0 OR hits > 0);`, run: true }
  ],
  challenge: {
    task: 'With a temporary index on payments(order_id), find the largest order_id upper bound at which the planner still chooses a seq scan with random_page_cost = 4 but an index/bitmap plan with 1.1. Test 1000, 1500, 2000 and 2500 by EXPLAINing each case.',
    hint: 'Create the index, ANALYZE payments, then alternate SET random_page_cost and EXPLAIN for each bound.',
    solution: `CREATE INDEX idx_tmp_payments_order ON payments (order_id);
ANALYZE payments;
SET random_page_cost = 4;   EXPLAIN SELECT * FROM payments WHERE order_id <= 1500;
SET random_page_cost = 1.1; EXPLAIN SELECT * FROM payments WHERE order_id <= 1500;
SET random_page_cost = 4;   EXPLAIN SELECT * FROM payments WHERE order_id <= 2500;
SET random_page_cost = 1.1; EXPLAIN SELECT * FROM payments WHERE order_id <= 2500;`,
    run: true
  },
  related: ['production-optimization-memory', 'query-optimization', 'explain', 'production-optimization-wal-checkpoint'],
  quiz: [
    { type: 'mcq', q: 'Typical random_page_cost for local NVMe storage?', options: ['0.5', '1.1', '4.0', '10'], answer: 1, explain: 'Close to seq_page_cost (1.0) because random reads on NVMe are cheap. Never below seq_page_cost.' },
    { type: 'tf', q: 'Changing io_method takes effect after SELECT pg_reload_conf().', answer: false, explain: 'io_method has postmaster context: a restart is required.' },
    { type: 'mcq', q: 'What is the default io_method in PostgreSQL 18?', options: ['sync', 'worker', 'io_uring', 'posix_aio'], answer: 1, explain: 'worker is the portable default; io_uring is Linux-only and needs build support.' },
    { type: 'scenario', q: 'Estimated rows = 50, actual rows = 480,000 and the plan uses a nested loop. Best first step?', options: ['Lower random_page_cost', 'Fix statistics: ANALYZE, raise statistics target or add extended statistics', 'Raise effective_io_concurrency', 'Set enable_nestloop = off globally'], answer: 1, explain: 'A massive misestimate is a statistics problem; cost constants will not fix it.' }
  ]
},
{
  id: 'production-optimization-wal-checkpoint',
  module: 'production-optimization',
  title: 'WAL and Checkpoint Tuning: max_wal_size, checkpoint_completion_target, wal_compression, synchronous_commit',
  level: 5,
  minutes: 22,
  summary: 'Smooth out IO spikes and WAL volume: size max_wal_size and checkpoint_timeout, spread checkpoints, compress full-page images, and trade durability for latency with synchronous_commit only where acceptable.',
  objectives: [
    'Explain what a checkpoint does and why frequent checkpoints inflate WAL (full-page writes)',
    'Size max_wal_size, min_wal_size and checkpoint_timeout from observed WAL rate',
    'Read pg_stat_checkpointer (PG17+) to detect requested (forced) checkpoints',
    'Use wal_compression and wal_buffers appropriately',
    'Decide when synchronous_commit = off (per transaction) is acceptable'
  ],
  concept: `<p>Every change is first written to the <strong>write-ahead log</strong> (WAL) and only later to the data files. A <strong>checkpoint</strong> flushes all dirty buffers to the data files and records a point from which crash recovery can start; WAL older than the last checkpoint (and not needed by replicas/archiving) can then be recycled.</p>
<p><strong>Analogy:</strong> a shop's receipt roll (WAL) and the accounting ledger (data files). Writing a receipt is fast and sequential. Periodically the accountant copies everything into the ledger (checkpoint). If the accountant does it every 5 minutes in a frantic burst, the shop stalls; if they do it calmly over 15 minutes, nobody notices. But the longer the gap, the more receipts you must re-read after a power cut (recovery time).</p>
<h4>The levers</h4>
<table>
<tr><th>Parameter</th><th>Default</th><th>What it controls</th><th>Typical OLTP production</th></tr>
<tr><td><code>checkpoint_timeout</code></td><td>5min</td><td>Max time between checkpoints</td><td>15–30min</td></tr>
<tr><td><code>max_wal_size</code></td><td>1GB</td><td>Soft WAL volume that triggers a checkpoint</td><td>16–64GB (enough for timeout-driven checkpoints)</td></tr>
<tr><td><code>min_wal_size</code></td><td>80MB</td><td>WAL kept for recycling instead of deleting</td><td>2–4GB</td></tr>
<tr><td><code>checkpoint_completion_target</code></td><td>0.9</td><td>Spread writes over this fraction of the interval</td><td>0.9 (default since PG14)</td></tr>
<tr><td><code>wal_buffers</code></td><td>-1 (1/32 of shared_buffers, max 16MB)</td><td>Shared memory for not-yet-written WAL</td><td>auto (16MB) or 64MB for very write-heavy</td></tr>
<tr><td><code>wal_compression</code></td><td>off</td><td>Compress full-page images: pglz, lz4, zstd</td><td><code>lz4</code> or <code>zstd</code></td></tr>
<tr><td><code>synchronous_commit</code></td><td>on</td><td>Wait for WAL flush (and standbys) at commit</td><td>on; off per transaction for low-value writes</td></tr>
</table>
<h4>Full-page writes: why checkpoint frequency matters</h4>
<p>With <code>full_page_writes = on</code> (required for safety), the <em>first</em> modification of a page after each checkpoint writes the <strong>entire 8KB page</strong> into WAL, protecting against torn pages. More frequent checkpoints → more first-touches → far more WAL. Going from 5-minute to 30-minute checkpoints commonly cuts WAL volume by 30–70% on update-heavy workloads, which also reduces replication bandwidth and archive storage.</p>
<h4>synchronous_commit</h4>
<ul>
<li><code>on</code> — commit returns after WAL is flushed locally (and, with synchronous standbys configured, after they flush).</li>
<li><code>remote_apply</code> / <code>remote_write</code> / <code>local</code> — variations for synchronous replication.</li>
<li><code>off</code> — commit returns before the flush. A crash can lose the last ~3 × <code>wal_writer_delay</code> (≈600 ms) of committed transactions, but <strong>never corrupts</strong> the database. Can be set per transaction: <code>SET LOCAL synchronous_commit = off</code>.</li>
</ul>`,
  why: `<p>Untuned WAL settings cause the classic "sawtooth": every few minutes a checkpoint floods the disks with writes, latency spikes, replicas lag, and WAL volume is double what it needs to be. Proper sizing makes IO smooth, shrinks WAL, and keeps recovery time predictable.</p>`,
  useCase: `<p>An IoT platform ingests 30,000 sensor readings per second. Logs show <code>checkpoints are occurring too frequently (24 seconds apart)</code> and pg_stat_checkpointer has <code>num_requested</code> ≫ <code>num_timed</code>. WAL rate is ~400MB/min. They set <code>checkpoint_timeout = 15min</code>, <code>max_wal_size = 48GB</code> (≈ 2 × 15 × 400MB plus headroom), <code>wal_compression = lz4</code>, and use <code>synchronous_commit = off</code> only for the raw telemetry insert path (losing &lt; 1 s of readings on a crash is acceptable; billing events stay synchronous). WAL volume drops 55% and p99 insert latency falls from 120 ms to 9 ms.</p>`,
  internals: `<p>The <strong>checkpointer</strong> process starts a checkpoint when <code>checkpoint_timeout</code> elapses (a "timed" checkpoint) or when WAL since the last checkpoint approaches <code>max_wal_size</code> (a "requested" checkpoint; also from <code>CHECKPOINT</code>, shutdown, base backups). It writes dirty buffers in sorted order, pacing itself to finish at <code>checkpoint_completion_target</code> of the interval, then fsyncs the files and writes a checkpoint record; the redo pointer in <code>pg_control</code> marks where recovery starts. The <strong>WAL writer</strong> flushes WAL buffers in the background every <code>wal_writer_delay</code> (200ms) — this is what makes asynchronous commits durable shortly after. The <strong>background writer</strong> trickles out dirty buffers ahead of the clock-sweep so backends rarely have to write themselves.</p>
<p>Group commit happens naturally: one backend's fsync of WAL also makes all earlier WAL records durable, so concurrent committers share flushes. <code>commit_delay</code>/<code>commit_siblings</code> can increase batching on very high-commit-rate systems with slow fsync, but are rarely needed with modern storage.</p>`,
  whenNot: `<p>Do not set <code>fsync = off</code> or <code>full_page_writes = off</code> in production to gain speed — both risk unrecoverable corruption after a crash (unless the filesystem guarantees atomic 8KB writes, e.g. ZFS, for full_page_writes). Do not use <code>synchronous_commit = off</code> for money, orders, or anything a user was told is saved. Do not raise <code>checkpoint_timeout</code> to hours if your recovery-time objective is minutes: crash recovery must replay all WAL since the last checkpoint.</p>`,
  syntax: `checkpoint_timeout            = 15min
max_wal_size                  = 32GB
min_wal_size                  = 4GB
checkpoint_completion_target  = 0.9
wal_buffers                   = 64MB
wal_compression               = lz4        # off | pglz | lz4 | zstd
synchronous_commit            = on         # per transaction: SET LOCAL synchronous_commit = off
log_checkpoints               = on         # default on since PG15`,
  examples: [
    {
      label: 'Basic',
      title: 'Inspect WAL and checkpoint configuration',
      sql: `SELECT name, current_setting(name) AS value, context
FROM   pg_settings
WHERE  name IN ('wal_level', 'checkpoint_timeout', 'max_wal_size', 'min_wal_size',
                'checkpoint_completion_target', 'wal_buffers', 'wal_compression',
                'full_page_writes', 'synchronous_commit', 'wal_writer_delay')
ORDER  BY name;`,
      explain: `<p>Shows the effective values with units. Note <code>wal_buffers</code> displays the auto-computed value (here 4MB = 1/32 of 128MB shared_buffers). <code>max_wal_size</code>, <code>checkpoint_timeout</code> and the completion target are <code>sighup</code> — changeable with a reload. <code>wal_level</code> and <code>wal_buffers</code> need a restart.</p>`,
      output: ` name                         | value   | context
------------------------------+---------+------------
 checkpoint_completion_target | 0.9     | sighup
 checkpoint_timeout           | 5min    | sighup
 full_page_writes             | on      | sighup
 max_wal_size                 | 1GB     | sighup
 min_wal_size                 | 80MB    | sighup
 synchronous_commit           | on      | user
 wal_buffers                  | 4MB     | postmaster
 wal_compression              | off     | superuser
 wal_level                    | replica | postmaster
 wal_writer_delay             | 200ms   | sighup`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Measure WAL generated by a statement — with and without compression',
      sql: `CREATE TEMP TABLE wal_mark AS SELECT pg_current_wal_insert_lsn() AS lsn;

CHECKPOINT;                                    -- next writes need full-page images
UPDATE wal_mark SET lsn = pg_current_wal_insert_lsn();
SET wal_compression = off;
UPDATE orders SET total_amount = total_amount WHERE id <= 2000;
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_insert_lsn(), lsn)) AS wal_uncompressed
FROM   wal_mark;

CHECKPOINT;
UPDATE wal_mark SET lsn = pg_current_wal_insert_lsn();
SET wal_compression = pglz;                    -- lz4/zstd on builds that support them
UPDATE orders SET total_amount = total_amount WHERE id > 3000;
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_insert_lsn(), lsn)) AS wal_compressed
FROM   wal_mark;`,
      explain: `<p>An LSN (log sequence number) is a byte position in the WAL stream; <code>pg_wal_lsn_diff</code> of two LSNs = bytes of WAL written in between. After a <code>CHECKPOINT</code>, the first change to every page writes a full-page image, so updating 2,000 rows (spread over ~36 pages) generates ~925kB. With <code>wal_compression = pglz</code> the same work produces ~591kB — about 36% less. With <code>lz4</code> or <code>zstd</code> (PG15+, if compiled in; the playground build supports only pglz) compression is faster and usually better.</p>`,
      output: ` wal_uncompressed
------------------
 925 kB

 wal_compressed
----------------
 591 kB`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Are checkpoints timed or forced? Plus per-transaction async commit',
      sql: `-- PG17+: checkpointer statistics (moved out of pg_stat_bgwriter)
SELECT num_timed,
       num_requested,
       round(100.0 * num_requested / nullif(num_timed + num_requested, 0), 1) AS pct_forced,
       write_time  AS write_ms,
       sync_time   AS sync_ms,
       buffers_written
FROM   pg_stat_checkpointer;

-- Low-value write path: don't wait for the WAL flush
BEGIN;
SET LOCAL synchronous_commit = off;
INSERT INTO audit_logs (table_name, operation, row_id, new_data, changed_by)
VALUES ('orders', 'UPDATE', 1, '{"note":"telemetry-style write"}', 'demo');
SHOW synchronous_commit;
ROLLBACK;`,
      explain: `<p>If <code>pct_forced</code> is high, checkpoints are being triggered by WAL volume (<code>max_wal_size</code> too small) rather than by time — raise max_wal_size until most are timed. <code>write_time</code> vs <code>sync_time</code> show whether the IO spike is in writing or fsyncing. The second part shows the per-transaction durability trade-off: only this transaction skips waiting for the flush; everything else stays fully durable. (Playground counters are zero because nothing has checkpointed in this session.)</p>`,
      output: ` num_timed | num_requested | pct_forced | write_ms | sync_ms | buffers_written
-----------+---------------+------------+----------+---------+-----------------
         0 |             0 |            |        0 |       0 |               0

 synchronous_commit
--------------------
 off`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Turning off durability globally for speed
-- postgresql.conf
-- fsync = off
-- full_page_writes = off
SHOW fsync;`, why: 'fsync = off means a power loss or OS crash can leave the database permanently corrupt; full_page_writes = off risks torn pages. The speed gain is real but the data is no longer safe.', run: true },
    good: { sql: `-- Keep durability, smooth the IO, and relax only where acceptable
-- postgresql.conf: checkpoint_timeout = 15min, max_wal_size = 32GB, wal_compression = lz4
BEGIN;
SET LOCAL synchronous_commit = off;   -- only for this low-value write
UPDATE products SET stock = stock WHERE id = 1;
ROLLBACK;`, why: 'Bigger, spread-out checkpoints and compressed full-page images remove most WAL overhead safely. synchronous_commit = off per transaction risks only the last fraction of a second of those writes, never corruption.', run: true }
  },
  mistakes: [
    `Leaving <code>max_wal_size = 1GB</code> on a busy server, causing checkpoints every few seconds and huge WAL volumes from full-page images.`,
    `Confusing <code>synchronous_commit = off</code> (bounded loss, no corruption) with <code>fsync = off</code> (corruption risk).`,
    `Ignoring "checkpoints are occurring too frequently" warnings in the log (<code>checkpoint_warning</code>).`,
    `Setting <code>checkpoint_timeout</code> to an hour without considering crash-recovery time.`,
    `Assuming WAL disk usage is bounded by <code>max_wal_size</code> — replication slots, <code>wal_keep_size</code> and a failing <code>archive_command</code> can retain unlimited WAL.`
  ],
  best: [
    `Size <code>max_wal_size</code> so ≥ 90% of checkpoints are timed: roughly 2–3 × (WAL per checkpoint_timeout interval).`,
    `Use <code>wal_compression = lz4</code> (cheap CPU) or <code>zstd</code> (better ratio) on PG15+.`,
    `Put WAL on fast, low-latency storage; commit latency is bounded by WAL fsync time.`,
    `Use <code>synchronous_commit = off</code> only per transaction/role for data you can afford to lose.`,
    `Set <code>max_slot_wal_keep_size</code> to cap WAL retained by a lagging replication slot.`
  ],
  performance: `<p>Longer checkpoint intervals reduce total writes (a hot page dirtied 100 times is written once per checkpoint) and WAL volume (fewer full-page images). Spreading (<code>checkpoint_completion_target = 0.9</code>) converts IO bursts into a steady stream. <code>synchronous_commit = off</code> can raise single-session commit throughput 10× on slow-fsync storage. Measure WAL generation via <code>pg_stat_wal.wal_bytes</code> and LSN deltas over time; measure checkpoint impact via pg_stat_checkpointer and IO latency during checkpoints.</p>`,
  security: `<p><code>wal_compression</code> is superuser-settable. Compression of full-page images can theoretically leak information through WAL size side channels in multi-tenant setups where an attacker controls part of a page and can observe WAL volume — a niche concern, but it is why changing it is restricted. WAL contains every changed row in clear text: protect <code>pg_wal</code>, archives and replication connections (TLS, encrypted object storage).</p>`,
  scenario: {
    title: 'Latency spikes every 2-3 minutes on a write-heavy primary',
    steps: [
      '1. Check logs for "checkpoints are occurring too frequently" and log_checkpoints lines (duration, buffers written).',
      '2. SELECT num_timed, num_requested FROM pg_stat_checkpointer; mostly requested → max_wal_size too small.',
      '3. Measure WAL rate: sample pg_current_wal_lsn() twice 60 s apart, pg_wal_lsn_diff.',
      '4. Set checkpoint_timeout = 15min, max_wal_size ≈ 3 × WAL per 15 min, wal_compression = lz4; reload.',
      '5. Verify: spikes flatten, WAL volume and replica lag drop; confirm crash-recovery time is still within RTO by testing on a staging copy.'
    ]
  },
  widgets: ['diagram:wal'],
  interview: [
    { q: 'Why does increasing checkpoint_timeout reduce WAL volume?', a: 'With full_page_writes on, the first change to each page after a checkpoint logs the whole 8KB page. Fewer checkpoints mean fewer first-touches, so fewer full-page images. Hot pages modified repeatedly are also written to data files less often.' },
    { q: 'What is the risk of synchronous_commit = off?', a: 'A crash can lose transactions that were reported committed in roughly the last 3 × wal_writer_delay (≈600 ms). The database stays consistent — those transactions simply never happened. It can be enabled per transaction for low-value writes.' },
    { q: 'How do you know max_wal_size is too small?', a: 'Most checkpoints are requested rather than timed (pg_stat_checkpointer.num_requested vs num_timed, or pg_stat_bgwriter before PG17), and the log shows "checkpoints are occurring too frequently".' },
    { q: 'What is checkpoint_completion_target?', a: 'The fraction of the checkpoint interval over which the checkpointer spreads its writes. 0.9 (default since PG14) means writes are paced to finish at 90% of the interval, minimising IO spikes.' }
  ],
  exercises: [
    { task: 'Show the current WAL insert LSN and the WAL file name it belongs to.', solution: `SELECT pg_current_wal_insert_lsn()                    AS lsn,
       pg_walfile_name(pg_current_wal_insert_lsn())   AS wal_file;`, run: true },
    { task: 'Measure the WAL bytes produced by inserting 1,000 rows into a temporary copy of departments-like data (use a temp table and an LSN marker).', solution: `CREATE TEMP TABLE mark AS SELECT pg_current_wal_insert_lsn() AS lsn;
CREATE TABLE wal_demo (id int, payload text);
INSERT INTO wal_demo SELECT g, repeat('x', 100) FROM generate_series(1, 1000) g;
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_insert_lsn(), lsn)) AS wal_written
FROM mark;`, run: true },
    { task: 'Set synchronous_commit to off only for the current transaction and prove it reverts after the transaction.', solution: `BEGIN;
SET LOCAL synchronous_commit = off;
SHOW synchronous_commit;
COMMIT;
SHOW synchronous_commit;`, run: true }
  ],
  challenge: {
    task: 'Estimate a starting max_wal_size: given an observed WAL rate of 350 MB per minute (literal) and a target checkpoint_timeout of 15 minutes, compute WAL per interval and recommend max_wal_size = 3 × that, rounded up to whole GB, and print both as pretty sizes.',
    hint: 'Multiply MB/min by minutes, convert to bytes, use ceil() on GB.',
    solution: `WITH p(wal_mb_per_min, timeout_min) AS (VALUES (350, 15))
SELECT pg_size_pretty((wal_mb_per_min * timeout_min)::bigint * 1024 * 1024) AS wal_per_checkpoint,
       ceil(3.0 * wal_mb_per_min * timeout_min / 1024)::int || 'GB'         AS recommended_max_wal_size
FROM p;`,
    run: true
  },
  related: ['wal', 'internals-life-of-query', 'production-optimization-memory', 'replication', 'backup-restore'],
  quiz: [
    { type: 'mcq', q: 'Which view shows timed vs requested checkpoints in PostgreSQL 17+?', options: ['pg_stat_bgwriter', 'pg_stat_checkpointer', 'pg_stat_wal', 'pg_control_checkpoint'], answer: 1, explain: 'PG17 moved checkpoint counters from pg_stat_bgwriter to pg_stat_checkpointer (num_timed, num_requested, ...).' },
    { type: 'tf', q: 'synchronous_commit = off can cause data corruption after a crash.', answer: false, explain: 'It can lose the most recent commits but the database remains consistent. fsync = off is the setting that risks corruption.' },
    { type: 'mcq', q: 'Why does WAL volume spike right after each checkpoint?', options: ['The WAL writer restarts', 'Full-page images are written for the first change to each page', 'Autovacuum runs after checkpoints', 'wal_buffers are cleared'], answer: 1, explain: 'full_page_writes logs the whole page on first modification after a checkpoint, to protect against torn pages.' },
    { type: 'scenario', q: 'pg_wal grows without bound although max_wal_size = 8GB. Most likely cause?', options: ['checkpoint_completion_target too high', 'An inactive replication slot or failing archive_command retains WAL', 'wal_compression is off', 'shared_buffers too small'], answer: 1, explain: 'max_wal_size is a soft target for checkpoints; slots and archiving can hold WAL indefinitely. Check pg_replication_slots and pg_stat_archiver.' }
  ]
},
{
  id: 'production-optimization-autovacuum-parallel-jit',
  module: 'production-optimization',
  title: 'Autovacuum, Parallelism and JIT Tuning — plus a Tuned postgresql.conf for 64GB / 16 Cores',
  level: 5,
  minutes: 30,
  summary: 'Make autovacuum keep up (workers, cost limits, per-table thresholds), size parallel query workers, decide on JIT for OLTP, and walk through a fully justified postgresql.conf for a 64GB/16-core OLTP server.',
  objectives: [
    'Tune autovacuum_max_workers, cost_limit/cost_delay and scale factors (global and per table)',
    'Understand that the autovacuum cost limit is shared across workers',
    'Size max_worker_processes, max_parallel_workers and max_parallel_workers_per_gather',
    'Decide when JIT helps and why many OLTP systems set jit = off',
    'Produce and justify a complete tuned postgresql.conf for a 64GB / 16-core OLTP server'
  ],
  concept: `<p>Three subsystems compete for the same CPU and IO: <strong>autovacuum</strong> (background cleanup and freezing), <strong>parallel query</strong> (several processes executing one query) and <strong>JIT compilation</strong> (compiling expressions to machine code with LLVM). Defaults are conservative for autovacuum and optimistic for JIT — usually the opposite of what an OLTP system needs.</p>
<p><strong>Analogy:</strong> a hotel. Autovacuum is housekeeping: too few cleaners, or cleaners told to rest after every room (cost delay), and dirty rooms (dead tuples) pile up until guests complain (bloat). Parallel query is assigning several porters to one big delivery — great for a truckload, wasteful for one suitcase. JIT is training a specialist for a task: worth it for a 3-hour job, absurd for a 3-second one.</p>
<h4>Autovacuum knobs</h4>
<table>
<tr><th>Parameter</th><th>Default</th><th>Guidance</th></tr>
<tr><td><code>autovacuum_max_workers</code></td><td>3</td><td>5–8 on many-table/busy servers. PG18: changeable with reload up to <code>autovacuum_worker_slots</code> (default 16, restart)</td></tr>
<tr><td><code>autovacuum_vacuum_cost_limit</code></td><td>-1 → vacuum_cost_limit 200</td><td>1000–4000 on SSD. <strong>Shared</strong> (balanced) across all running workers</td></tr>
<tr><td><code>autovacuum_vacuum_cost_delay</code></td><td>2ms</td><td>2ms is fine on SSD; 0 = unthrottled</td></tr>
<tr><td><code>autovacuum_vacuum_scale_factor</code> / <code>_threshold</code></td><td>0.2 / 50</td><td>Vacuum when dead &gt; threshold + 20% of rows — far too late for a 1-billion-row table; lower per table (0.01–0.05)</td></tr>
<tr><td><code>autovacuum_vacuum_max_threshold</code></td><td>100,000,000 (PG18)</td><td>New cap so huge tables are vacuumed after at most 100M dead tuples</td></tr>
<tr><td><code>autovacuum_vacuum_insert_scale_factor</code></td><td>0.2</td><td>Insert-only tables get vacuumed (visibility map, freezing) — PG13+</td></tr>
<tr><td><code>autovacuum_naptime</code></td><td>1min</td><td>How often each database is checked</td></tr>
</table>
<h4>Parallel query knobs</h4>
<ul>
<li><code>max_worker_processes</code> (8, restart) — total background worker slots (parallel workers, logical replication, extensions).</li>
<li><code>max_parallel_workers</code> (8) — of those, how many may be parallel query workers at once.</li>
<li><code>max_parallel_workers_per_gather</code> (2) — workers per Gather node (per query, roughly).</li>
<li><code>max_parallel_maintenance_workers</code> (2) — for CREATE INDEX and VACUUM index processing.</li>
<li><code>parallel_setup_cost</code>, <code>parallel_tuple_cost</code>, <code>min_parallel_table_scan_size</code> (8MB) — planner thresholds.</li>
</ul>
<h4>JIT</h4>
<p>With LLVM support compiled in, <code>jit = on</code> (default since PG12) compiles expressions and tuple deforming when the plan cost exceeds <code>jit_above_cost</code> (100,000); more expensive inlining/optimisation passes above 500,000. Compilation takes tens to hundreds of milliseconds. For analytics over millions of rows it can save seconds; for OLTP, a misestimated "expensive" plan for a query that actually takes 5 ms suddenly takes 150 ms. Many OLTP shops set <code>jit = off</code> globally and enable it for the analytics role.</p>`,
  why: `<p>Autovacuum falling behind is the root of most chronic PostgreSQL pain: bloat, slow index scans, wraparound emergencies. Parallelism and JIT, meanwhile, can quietly steal CPU from hundreds of short transactions. Tuning these three together, with the memory/IO/WAL settings from previous lessons, is what turns a default install into a production server.</p>`,
  useCase: `<p>A marketplace's 900M-row <code>order_events</code> table only got vacuumed when 180M rows were dead (20%), each run taking 9 hours throttled at cost_limit 200; meanwhile index scans degraded. Fix: per-table <code>autovacuum_vacuum_scale_factor = 0.01</code>, global <code>autovacuum_vacuum_cost_limit = 2000</code>, <code>autovacuum_max_workers = 6</code>. Vacuums now run every ~40 minutes and finish in 6. In the same change they set <code>jit = off</code> after finding 3% of checkout queries paying 80–200 ms of JIT compile time due to inflated estimates on a join.</p>`,
  internals: `<p>The autovacuum launcher wakes every <code>autovacuum_naptime / number_of_databases</code> and starts workers for tables whose dead tuples exceed <code>min(threshold + scale_factor × reltuples, autovacuum_vacuum_max_threshold)</code>, or inserts exceed the insert threshold, or whose XID age passes <code>autovacuum_freeze_max_age</code>. Cost-based throttling assigns costs to page hits (<code>vacuum_cost_page_hit</code> 1), misses (2) and dirtied pages (20); when a worker accumulates <code>cost_limit</code>, it sleeps <code>cost_delay</code>. Because the limit is <em>balanced across active workers</em>, adding workers without raising the limit makes each worker slower — total throughput stays the same.</p>
<p>Parallel query: the leader launches workers via dynamic background workers, shares the plan through dynamic shared memory, and each worker scans a portion of the table (block-range chunks) feeding partial results into a Gather/Gather Merge node. Workers are only launched if slots are available at execution time — under load, a query planned for 4 workers may get 0 ("Workers Launched: 0").</p>`,
  whenNot: `<p>Do not disable autovacuum (globally or per table) to "save IO" — you will pay later with bloat and forced anti-wraparound vacuums that cannot be skipped. Do not give OLTP queries many parallel workers: a 16-core box with 200 active sessions has no spare cores to parallelise into. Do not enable JIT for latency-sensitive workloads without measuring; check <code>EXPLAIN (ANALYZE)</code> "JIT:" timing sections.</p>`,
  syntax: `-- Global (postgresql.conf / ALTER SYSTEM)
autovacuum_max_workers          = 6
autovacuum_vacuum_cost_limit    = 2000
max_worker_processes            = 16
max_parallel_workers            = 8
max_parallel_workers_per_gather = 2
jit                             = off

-- Per table
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02,
                        autovacuum_vacuum_cost_limit = 2000,
                        parallel_workers = 4);
-- Per role
ALTER ROLE analytics SET jit = on;`,
  examples: [
    {
      label: 'Basic',
      title: 'Per-table autovacuum and parallel settings',
      sql: `ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor  = 0.02,   -- vacuum at 2% dead instead of 20%
  autovacuum_analyze_scale_factor = 0.01,   -- keep stats fresh for the planner
  autovacuum_vacuum_cost_limit    = 1000,   -- this table's vacuums may work harder
  parallel_workers                = 4       -- planner hint for parallel scans
);

SELECT relname, reloptions
FROM   pg_class
WHERE  relname = 'orders';`,
      explain: `<p>Storage parameters (<code>reloptions</code>) override global settings for one table — the right tool for the handful of large, hot tables that dominate your workload. They are stored in <code>pg_class.reloptions</code>. To remove one: <code>ALTER TABLE orders RESET (autovacuum_vacuum_scale_factor)</code>.</p>`,
      output: ` relname | reloptions
---------+------------------------------------------------------------------------------------------------------------------------------------------------
 orders  | {autovacuum_vacuum_scale_factor=0.02,autovacuum_analyze_scale_factor=0.01,autovacuum_vacuum_cost_limit=1000,parallel_workers=4}`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'When will autovacuum fire for each table?',
      sql: `SELECT s.relname,
       c.reltuples::bigint                                      AS est_rows,
       s.n_dead_tup,
       (current_setting('autovacuum_vacuum_threshold')::int
        + current_setting('autovacuum_vacuum_scale_factor')::numeric * c.reltuples)::bigint
                                                                AS vacuum_trigger_at,
       least(
         (current_setting('autovacuum_vacuum_threshold')::int
          + current_setting('autovacuum_vacuum_scale_factor')::numeric * c.reltuples)::bigint,
         current_setting('autovacuum_vacuum_max_threshold')::bigint)
                                                                AS pg18_effective_trigger,
       s.last_autovacuum
FROM   pg_stat_user_tables s
JOIN   pg_class c ON c.oid = s.relid
ORDER  BY c.reltuples DESC
LIMIT  6;`,
      explain: `<p>The vacuum trigger is <code>threshold + scale_factor × reltuples</code> dead tuples; PostgreSQL 18 also caps it at <code>autovacuum_vacuum_max_threshold</code> (100M). For our 12,500-row order_items that is 2,550 dead tuples — fine. For a 1-billion-row table it would be 200M dead tuples without the PG18 cap (or a per-table override) — far too late. This query ignores per-table reloptions; a full version would read them from <code>pg_class.reloptions</code>.</p>`,
      output: ` relname     | est_rows | n_dead_tup | vacuum_trigger_at | pg18_effective_trigger | last_autovacuum
-------------+----------+------------+-------------------+------------------------+-----------------
 order_items |    12500 |          0 |              2550 |                   2550 |
 orders      |     5000 |          0 |              1050 |                   1050 |
 payments    |     4585 |          0 |               967 |                    967 |
 customers   |      500 |          0 |               150 |                    150 |
 audit_logs  |      300 |          0 |               110 |                    110 |
 employee_projects | 288 |        0 |               108 |                    108 |`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'A tuned postgresql.conf for a 64GB RAM / 16-core OLTP server (PG18, NVMe)',
      sql: `# ---------- Connections ----------
listen_addresses = '10.0.1.15'           # private interface only, never '*' on a public NIC
max_connections = 300                    # app reaches PG via PgBouncer; ~4x cores of real concurrency + admin/replication headroom
superuser_reserved_connections = 5       # always room for the DBA during an incident

# ---------- Memory ----------
shared_buffers = 16GB                    # 25% of RAM: hot OLTP working set; OS page cache keeps the rest
huge_pages = on                          # 16GB shared memory: fewer TLB misses, smaller page tables; reserve vm.nr_hugepages first
effective_cache_size = 48GB              # planner hint: shared_buffers + expected OS cache (~75% RAM)
work_mem = 32MB                          # per sort/hash node; 300 conns x few nodes stays far below RAM; raise per role for reports
hash_mem_multiplier = 2.0                # default: hash nodes may use 64MB
maintenance_work_mem = 2GB               # faster CREATE INDEX / VACUUM index passes; few run at once
autovacuum_work_mem = 1GB                # per autovacuum worker (6 x 1GB worst case) - bounded separately from manual maintenance

# ---------- IO / planner ----------
random_page_cost = 1.1                   # NVMe: random reads nearly as cheap as sequential
effective_io_concurrency = 200           # NVMe handles deep queues; drives bitmap-heap/read-stream prefetch
maintenance_io_concurrency = 100         # same for vacuum/analyze/recovery
io_method = worker                       # PG18 async IO (default); try io_uring after testing on this kernel
io_workers = 8                           # more IO workers for 16 cores on fast storage

# ---------- WAL & checkpoints ----------
wal_level = replica                      # needed for streaming replicas and PITR (logical if CDC is required)
wal_buffers = 64MB                       # write-heavy OLTP: fewer WAL-buffer-full stalls than the 16MB auto value
wal_compression = lz4                    # smaller full-page images, cheap CPU
checkpoint_timeout = 15min               # fewer full-page images, smoother IO; recovery still a few minutes
max_wal_size = 32GB                      # ~3x WAL per 15 min at peak, so checkpoints are timed, not forced
min_wal_size = 4GB                       # recycle segments instead of creating new ones
checkpoint_completion_target = 0.9       # spread checkpoint writes (default)
max_slot_wal_keep_size = 100GB           # a dead replica cannot fill the WAL disk
synchronous_commit = on                  # durable by default; relax per transaction where acceptable

# ---------- Autovacuum ----------
autovacuum_max_workers = 6               # many busy tables; 16 cores can afford it
autovacuum_vacuum_cost_limit = 2000      # shared by all workers: ~10x default throughput on NVMe
autovacuum_vacuum_cost_delay = 2ms       # default; throttling via the limit above
autovacuum_vacuum_scale_factor = 0.05    # vacuum sooner (5%) - big tables get per-table overrides
autovacuum_analyze_scale_factor = 0.02   # fresher statistics -> better plans
autovacuum_naptime = 30s                 # check more often on a busy cluster
log_autovacuum_min_duration = 10s        # log slow autovacuum runs for diagnosis

# ---------- Parallelism & JIT ----------
max_worker_processes = 24                # parallel workers + logical replication + extensions (restart)
max_parallel_workers = 8                 # at most half the cores for parallel query
max_parallel_workers_per_gather = 2      # OLTP: small; analytics role can raise per session
max_parallel_maintenance_workers = 4     # faster CREATE INDEX during maintenance windows
jit = off                                # OLTP: avoid 50-200ms compile spikes; enable per analytics role

# ---------- Safety timeouts & logging ----------
idle_in_transaction_session_timeout = 60s    # kill abandoned transactions (locks + vacuum horizon)
lock_timeout = 0                             # set per migration/session rather than globally
statement_timeout = 0                        # set per role (e.g. 30s for app role) rather than globally
log_min_duration_statement = 500ms           # log slow statements
log_lock_waits = on                          # log waits longer than deadlock_timeout
log_temp_files = 10MB                        # find work_mem spills
log_checkpoints = on                         # default since PG15
log_line_prefix = '%m [%p] %q%u@%d app=%a '  # time, pid, user, db, application
track_io_timing = on                         # IO timing in EXPLAIN / pg_stat_*
shared_preload_libraries = 'pg_stat_statements'  # query statistics extension (restart)`,
      explain: `<p>Every line carries its justification. Key principles: (1) memory is split ~25% shared buffers / ~75% OS cache and per-process memory, with work_mem small globally; (2) storage is NVMe, so planner costs and prefetch reflect cheap random IO; (3) checkpoints are time-driven and spread, WAL compressed, and slot retention capped; (4) autovacuum is made aggressive enough to keep up on large hot tables; (5) parallelism and JIT are restrained for OLTP latency and enabled per role for analytics; (6) timeouts and logging make problems visible and bounded. This is a configuration file, not SQL — it is not runnable in the playground; apply via postgresql.conf or ALTER SYSTEM, then reload/restart as each parameter's context requires.</p>`,
      output: `-- After restart (shared_buffers, huge_pages, io_method, wal_buffers, max_worker_processes,
-- shared_preload_libraries are postmaster-context):
SELECT name, setting, pending_restart FROM pg_settings WHERE pending_restart;
(0 rows)`,
      run: false
    }
  ],
  compare: {
    bad: { sql: `-- "Autovacuum slows us down" - disable it on the busiest table
ALTER TABLE orders SET (autovacuum_enabled = false);
SELECT reloptions FROM pg_class WHERE relname = 'orders';`, why: 'Dead tuples accumulate without limit, indexes and heap bloat, the visibility map goes stale (index-only scans degrade), and eventually a forced anti-wraparound vacuum runs anyway — at the worst time and unthrottled by your choice.', run: true },
    good: { sql: `-- Make autovacuum run earlier and faster on the busy table
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.01,
                        autovacuum_vacuum_cost_limit   = 2000);
SELECT reloptions FROM pg_class WHERE relname = 'orders';`, why: 'Small, frequent vacuums are cheap and keep bloat near zero. Raising the cost limit lets each run finish quickly instead of crawling for hours.', run: true }
  },
  mistakes: [
    `Adding autovacuum workers without raising <code>autovacuum_vacuum_cost_limit</code> — the limit is shared, so each worker just goes slower.`,
    `Relying on the 20% default scale factor for tables with hundreds of millions of rows.`,
    `Setting <code>max_parallel_workers_per_gather</code> high on an OLTP server; CPU is consumed by a few queries while hundreds of short transactions queue.`,
    `Forgetting <code>max_worker_processes</code> also feeds logical replication workers and extensions — raising <code>max_parallel_workers</code> above it has no effect.`,
    `Leaving JIT on for OLTP and never noticing the "JIT: … Timing: Total 180 ms" lines in EXPLAIN ANALYZE of short queries.`
  ],
  best: [
    `Global autovacuum: 5–8 workers, cost_limit 1000–4000 on SSD, scale factors 0.02–0.05; per-table overrides for the largest hot tables.`,
    `Monitor <code>n_dead_tup</code>, <code>last_autovacuum</code>, and <code>pg_stat_progress_vacuum</code> to see whether autovacuum keeps up.`,
    `Parallelism: <code>max_parallel_workers</code> ≤ ~50% of cores for OLTP; raise per session for reporting/ETL.`,
    `<code>jit = off</code> globally on OLTP; <code>ALTER ROLE analytics SET jit = on</code> if analytics benefits (measure).`,
    `Version-control postgresql.conf with a justification comment on every non-default line, as in the example.`
  ],
  performance: `<p>Faster autovacuum costs IO and CPU during the run but saves far more by preventing bloat (bigger tables = more pages per scan, worse cache hit ratio). Parallel query gives near-linear speed-ups for large scans and aggregations when cores are idle, and negative returns when they are not. JIT benefits CPU-heavy expression evaluation over many rows (typically &gt; 1M rows, complex expressions); its compile overhead is fixed per query and can dwarf runtime for small queries.</p>`,
  security: `<p>Per-table storage parameters require table ownership; global autovacuum and worker settings require superuser. Disabling autovacuum on a table is a reliability risk (wraparound) — restrict table ownership so application roles cannot do it. JIT has had occasional security fixes in LLVM-related code paths; keep PostgreSQL patched, and disabling JIT also reduces attack surface on servers that do not need it.</p>`,
  scenario: {
    title: 'Autovacuum never catches up on a 900M-row table',
    steps: [
      '1. Check pg_stat_user_tables: n_dead_tup, last_autovacuum, autovacuum_count; pg_stat_progress_vacuum for a running worker and its phase.',
      '2. Look for blockers: long transactions/slots holding back xmin (vacuum runs but cannot remove tuples).',
      '3. If it is just slow: raise autovacuum_vacuum_cost_limit (global or per table) and maintenance/autovacuum_work_mem.',
      '4. Lower the table\'s autovacuum_vacuum_scale_factor to 0.01 (or set a threshold) so runs are smaller and more frequent.',
      '5. Consider partitioning so each partition vacuums independently and old partitions become frozen and untouched.',
      '6. Verify over a week: dead tuples stay below a few percent, run duration shrinks.'
    ]
  },
  widgets: ['diagram:process-model'],
  interview: [
    { q: 'Why might adding autovacuum workers not speed up vacuuming?', a: 'The cost limit (autovacuum_vacuum_cost_limit, or vacuum_cost_limit 200 by default) is balanced across all running workers. More workers share the same budget, so each runs slower. Raise the cost limit together with the worker count.' },
    { q: 'When should you disable JIT?', a: 'On latency-sensitive OLTP where compile time (tens to hundreds of ms) can exceed query runtime, especially when row estimates inflate costs above jit_above_cost. Keep it for analytics roles where queries process millions of rows and the compile cost amortises.' },
    { q: 'Explain max_worker_processes vs max_parallel_workers vs max_parallel_workers_per_gather.', a: 'max_worker_processes is the total pool of background worker slots (restart). max_parallel_workers caps how many of those can be parallel query workers at any time. max_parallel_workers_per_gather caps workers for a single Gather node, i.e. roughly per query.' },
    { q: 'What changed for autovacuum in PostgreSQL 18?', a: 'autovacuum_max_workers can be changed with a reload up to autovacuum_worker_slots (restart-time), and autovacuum_vacuum_max_threshold (default 100M) caps the dead-tuple trigger so huge tables are vacuumed sooner. PG18 also adds eager freezing of all-visible pages during normal vacuums to spread out freezing work.' }
  ],
  exercises: [
    { task: 'List every table with custom storage parameters (reloptions) in the public schema.', solution: `SELECT c.relname, c.reloptions
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND c.reloptions IS NOT NULL;`, run: true },
    { task: 'Show the parallel-query related settings and their contexts.', solution: `SELECT name, setting, context
FROM   pg_settings
WHERE  name LIKE '%parallel%' OR name = 'max_worker_processes'
ORDER  BY name;`, run: true },
    { task: 'Show the plan for a GROUP BY on orders when parallel query is made attractive (per session).', solution: `SET max_parallel_workers_per_gather = 2;
SET parallel_setup_cost = 0;
SET parallel_tuple_cost = 0;
SET min_parallel_table_scan_size = 0;
EXPLAIN (COSTS OFF) SELECT status, count(*) FROM orders GROUP BY status;`, run: true }
  ],
  challenge: {
    task: 'Write a query that lists, for every user table, the effective autovacuum_vacuum_scale_factor: the per-table reloption if set, otherwise the global value. Set a per-table value on orders first to prove it works.',
    hint: 'Unnest pg_class.reloptions with pg_options_to_table(), LEFT JOIN, COALESCE with current_setting().',
    solution: `ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02);
SELECT c.relname,
       COALESCE(o.option_value,
                current_setting('autovacuum_vacuum_scale_factor')) AS effective_scale_factor,
       o.option_value IS NOT NULL                                  AS per_table_override
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
LEFT   JOIN LATERAL pg_options_to_table(c.reloptions) o
       ON o.option_name = 'autovacuum_vacuum_scale_factor'
WHERE  n.nspname = 'public' AND c.relkind = 'r'
ORDER  BY per_table_override DESC, c.relname;`,
    run: true
  },
  related: ['vacuum', 'production-optimization-memory', 'production-optimization-wal-checkpoint', 'configuration', 'query-optimization'],
  quiz: [
    { type: 'tf', q: 'autovacuum_vacuum_cost_limit applies separately to each autovacuum worker, so 6 workers get 6× the budget.', answer: false, explain: 'The limit is balanced across active workers; total throughput stays the same unless you raise it.' },
    { type: 'mcq', q: 'Default autovacuum vacuum trigger for a 10M-row table (PG18 defaults)?', options: ['50 dead tuples', '1,000,050 dead tuples', '2,000,050 dead tuples', '100,000,000 dead tuples'], answer: 2, explain: '50 + 0.2 × 10,000,000 = 2,000,050; below the 100M max threshold.' },
    { type: 'scenario', q: 'OLTP p99 has random 150 ms spikes; EXPLAIN ANALYZE of the slow cases shows "JIT: Functions: 24, Timing: Total 140 ms". Fix?', options: ['Increase work_mem', 'Set jit = off (or raise jit_above_cost) for the OLTP role', 'Add parallel workers', 'Lower random_page_cost'], answer: 1, explain: 'JIT compile time dominates. Disable it for OLTP or raise the thresholds.' },
    { type: 'mcq', q: 'Which setting must be raised (with restart) before more parallel workers can run?', options: ['max_parallel_workers_per_gather', 'max_worker_processes', 'parallel_setup_cost', 'min_parallel_table_scan_size'], answer: 1, explain: 'max_worker_processes is the overall pool of background worker slots and needs a restart.' }
  ]
}
]);

/* ----------------------------- INTERNALS ----------------------------- */
PGM.addLessons([
{
  id: 'internals-process-architecture',
  module: 'internals',
  title: 'Process Architecture: Postmaster, Backends and Background Processes',
  level: 5,
  minutes: 22,
  summary: 'How PostgreSQL is organised as a family of OS processes — the postmaster, one backend per connection, and the background writer, checkpointer, WAL writer, autovacuum, archiver, IO workers and more.',
  objectives: [
    'Describe the process-per-connection model and what the postmaster does',
    'Name each background process and its responsibility',
    'Explain why the statistics collector no longer exists (PG15+ shared-memory statistics)',
    'Relate processes to observable rows in pg_stat_activity and pg_stat_io',
    'Explain the consequences of the model: connection cost, pooling, crash behaviour'
  ],
  concept: `<p>PostgreSQL is <strong>multi-process, not multi-threaded</strong>. When the server starts, a single parent process — the <strong>postmaster</strong> — allocates shared memory, starts background processes, and listens on the port. For every client connection it <code>fork()</code>s a new <strong>backend</strong> process that serves that connection for its whole life.</p>
<p><strong>Analogy:</strong> a hospital. The postmaster is the reception desk: it never treats patients, it assigns each new patient a dedicated doctor (backend). Behind the scenes, specialised staff keep the place running: cleaners (autovacuum), the records clerk who writes the official log (WAL writer), the night shift that files all paperwork into the archive cabinets (checkpointer), a porter who moves paperwork ahead of time so doctors are not interrupted (background writer), and the courier who ships copies offsite (archiver, WAL sender).</p>
<h4>The process family</h4>
<table>
<tr><th>Process</th><th>Role</th></tr>
<tr><td><strong>postmaster</strong></td><td>Parent of everything; accepts connections, forks backends, restarts children after a crash</td></tr>
<tr><td><strong>backend</strong> (client backend)</td><td>One per connection: parses, plans and executes that client's queries</td></tr>
<tr><td><strong>checkpointer</strong></td><td>Performs checkpoints: flushes dirty buffers, fsyncs, writes the checkpoint record</td></tr>
<tr><td><strong>background writer</strong></td><td>Writes some dirty buffers ahead of need so backends find clean buffers to evict</td></tr>
<tr><td><strong>walwriter</strong></td><td>Flushes WAL buffers to disk periodically (makes async commits durable)</td></tr>
<tr><td><strong>autovacuum launcher</strong> + <strong>workers</strong></td><td>Launcher schedules; workers VACUUM/ANALYZE tables and prevent XID wraparound</td></tr>
<tr><td><strong>archiver</strong></td><td>Copies completed WAL segments via <code>archive_command</code>/<code>archive_library</code> (when <code>archive_mode = on</code>)</td></tr>
<tr><td><strong>logical replication launcher</strong></td><td>Starts apply workers for subscriptions</td></tr>
<tr><td><strong>walsender</strong> / <strong>walreceiver</strong></td><td>Stream WAL to replicas / receive it on a standby</td></tr>
<tr><td><strong>startup</strong></td><td>Replays WAL during crash recovery and continuously on standbys</td></tr>
<tr><td><strong>io worker</strong> (PG18)</td><td>Perform asynchronous reads when <code>io_method = worker</code></td></tr>
<tr><td><strong>walsummarizer</strong> (PG17)</td><td>Builds WAL summaries for incremental backups when <code>summarize_wal = on</code></td></tr>
<tr><td><strong>parallel worker</strong> / <strong>background worker</strong></td><td>Dynamic workers for parallel query and extensions</td></tr>
</table>
<div class="callout info"><strong>No stats collector since PG15.</strong> Older versions had a "stats collector" process that received statistics over a UDP socket. PostgreSQL 15 replaced it with <em>cumulative statistics in shared memory</em>: each backend accumulates counters locally and flushes them into shared memory. Old diagrams that show a stats collector are outdated.</div>`,
  why: `<p>The process model explains many operational facts: why each connection costs several MB and a fork, why you need a connection pooler at scale, why one crashing backend forces <em>all</em> backends to restart (they share memory that might be corrupt), why <code>kill -9</code> is dangerous, and why <code>pg_stat_activity</code> shows background processes. Knowing which process does what tells you where to look when checkpoints spike, WAL is not archived or vacuum lags.</p>`,
  useCase: `<p>An HR SaaS sees "connection storms" every morning at 09:00 when 4,000 browser sessions log in: backends are forked faster than they can authenticate, CPU is eaten by fork/exec and catalog cache warm-up, and the server stalls. Understanding the process-per-connection model, they deploy PgBouncer <span class="tag tool">third-party tool</span> in transaction mode: 4,000 client connections map to 80 server backends that stay warm all day. Login latency falls from 9 s to 40 ms.</p>`,
  internals: `<p>At startup the postmaster creates one big shared memory segment (shared buffers, WAL buffers, lock table, proc array, CLOG buffers, stats). Forked children inherit it at the same address. Each backend has a <code>PGPROC</code> entry in the proc array, used for snapshots (which transactions are running) and lock waits. Communication uses shared memory plus <em>latches</em> (wake-up signals) and signals (SIGINT to cancel, SIGTERM to terminate, SIGHUP to reload config).</p>
<p>If any child dies abnormally (segfault, SIGKILL from the OOM killer), the postmaster cannot trust shared memory: it sends SIGQUIT to all children, waits for them to exit, re-initialises shared memory and runs crash recovery from the last checkpoint. A normal backend exit (client disconnect, <code>pg_terminate_backend</code>) does not trigger this. On Linux you can see the processes with <code>ps</code>: their titles are set to e.g. <code>postgres: checkpointer</code> or <code>postgres: app_user shop 10.0.0.5(51544) idle</code> (controlled by <code>update_process_title</code>).</p>`,
  whenNot: `<p>The process model is not configurable — but you can avoid its downsides: do not open thousands of direct connections (use a pooler); do not run many short-lived connections per request (reuse them); do not use <code>kill -9</code> on backends. If you need thousands of concurrent long-lived sessions doing little work, PostgreSQL's model is costly — pool, or reconsider the architecture (queues, fewer sessions).</p>`,
  syntax: `-- Processes visible from SQL
SELECT pid, backend_type, backend_start FROM pg_stat_activity;
SELECT pg_backend_pid();               -- your backend's OS pid
SELECT pg_postmaster_start_time();     -- when the postmaster started

-- On the server (shell, not SQL)
-- ps -ef --forest | grep postgres`,
  examples: [
    {
      label: 'Basic',
      title: 'Your backend and the postmaster',
      sql: `SELECT pg_backend_pid()                       AS my_backend_pid,
       pg_postmaster_start_time()              AS postmaster_started,
       now() - pg_postmaster_start_time()      AS uptime,
       current_setting('max_connections')      AS max_connections;`,
      explain: `<p><code>pg_backend_pid()</code> is the OS process id of the backend serving you — the same value <code>pg_stat_activity.pid</code> shows and that <code>pg_cancel_backend</code> takes. <code>pg_postmaster_start_time()</code> tells you when the server (re)started — useful after an incident to check whether a crash-restart happened.</p>`,
      output: ` my_backend_pid | postmaster_started            | uptime          | max_connections
----------------+-------------------------------+-----------------+-----------------
             42 | 2026-10-05 09:12:03.51+00     | 00:03:27.118    | 100`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Which process types exist? (pg_stat_io knows them all)',
      sql: `SELECT DISTINCT backend_type
FROM   pg_stat_io
ORDER  BY backend_type;`,
      explain: `<p><code>pg_stat_io</code> (PG16+) keeps IO statistics per backend type, so it lists every kind of process the server can run — even ones not currently alive. On a running server, <code>SELECT backend_type, count(*) FROM pg_stat_activity GROUP BY 1</code> shows which are alive right now (the playground only has its single standalone backend).</p>`,
      output: ` backend_type
---------------------
 autovacuum launcher
 autovacuum worker
 background worker
 background writer
 checkpointer
 client backend
 io worker
 slotsync worker
 standalone backend
 startup
 walreceiver
 walsender
 walsummarizer
 walwriter`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'What the background processes have done: checkpointer, bgwriter, WAL, archiver',
      sql: `SELECT 'checkpointer' AS process,
       format('timed=%s requested=%s buffers_written=%s',
              num_timed, num_requested, buffers_written) AS activity
FROM   pg_stat_checkpointer
UNION ALL
SELECT 'background writer',
       format('buffers_clean=%s maxwritten_clean=%s buffers_alloc=%s',
              buffers_clean, maxwritten_clean, buffers_alloc)
FROM   pg_stat_bgwriter
UNION ALL
SELECT 'wal',
       format('records=%s fpi=%s bytes=%s buffers_full=%s',
              wal_records, wal_fpi, wal_bytes, wal_buffers_full)
FROM   pg_stat_wal
UNION ALL
SELECT 'archiver',
       format('archived=%s failed=%s last=%s',
              archived_count, failed_count, coalesce(last_archived_wal, '-'))
FROM   pg_stat_archiver;`,
      explain: `<p>Each background process reports into its own statistics view. <code>maxwritten_clean</code> &gt; 0 means the background writer hit <code>bgwriter_lru_maxpages</code> and stopped early; <code>wal_buffers_full</code> &gt; 0 means backends had to write WAL themselves because <code>wal_buffers</code> was full; a non-zero <code>failed_count</code> on the archiver means PITR is broken — page someone. On a production server these numbers are large and you graph their rates.</p>`,
      output: ` process           | activity
-------------------+------------------------------------------------
 checkpointer      | timed=0 requested=0 buffers_written=0
 background writer | buffers_clean=0 maxwritten_clean=0 buffers_alloc=0
 wal               | records=19 fpi=13 bytes=105743 buffers_full=0
 archiver          | archived=0 failed=0 last=-`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- App opens a new connection for every HTTP request:
-- fork() + authentication + catalog cache warm-up each time.
SELECT pg_backend_pid() AS new_pid_every_request;`, why: 'Each new connection forks a process, authenticates (SCRAM hashing is deliberately expensive), and starts with cold catalog caches. At hundreds of requests per second this burns CPU and adds tens of milliseconds per request.', run: true },
    good: { sql: `-- App uses a pool (driver pool or PgBouncer): the same warm backend
-- serves many requests; you see a stable pid across requests.
SELECT pg_backend_pid() AS long_lived_pid, now() - backend_start AS backend_age
FROM   pg_stat_activity
WHERE  pid = pg_backend_pid();`, why: 'Pooled connections amortise fork/authentication cost and keep caches warm. A pooler also caps the number of backends, protecting memory and CPU.', run: true }
  },
  mistakes: [
    `Believing PostgreSQL is multi-threaded and that thousands of connections are cheap.`,
    `Killing a backend with <code>kill -9</code>: the postmaster restarts every session and runs crash recovery.`,
    `Looking for the "stats collector" process on PG15+ — it no longer exists.`,
    `Ignoring <code>pg_stat_archiver.failed_count</code>: WAL then accumulates in <code>pg_wal</code> and PITR is silently broken.`,
    `Running heavy cron jobs that open and close hundreds of connections per minute.`
  ],
  best: [
    `Pool connections (driver-level pools plus PgBouncer for many app instances).`,
    `Use <code>pg_terminate_backend()</code> or plain SIGTERM, never SIGKILL, for individual sessions.`,
    `Monitor each background process through its stats view: checkpointer, bgwriter, WAL, archiver, replication.`,
    `Protect the postmaster from the Linux OOM killer (<code>oom_score_adj</code> for the postmaster, via the service unit) so only backends are candidates.`,
    `Set <code>application_name</code> so <code>ps</code> output and pg_stat_activity identify services.`
  ],
  performance: `<p>Each backend uses a few MB of private memory baseline (catalog caches, plan caches) plus work_mem when executing. Fork cost is small but authentication (SCRAM) and cache warm-up are not. Many idle backends still cost: snapshots must scan the proc array (optimised in PG14), and lock-manager structures scale with max_connections. Background processes trade off: a more aggressive bgwriter means fewer backend writes but more total writes.</p>`,
  security: `<p>Each backend runs as the <code>postgres</code> OS user — never run PostgreSQL as root (it refuses to start). Process titles may show client IPs and database names to other OS users on the host via <code>ps</code>; set <code>update_process_title = off</code> if this matters. Signalling backends from SQL is restricted to superusers, <code>pg_signal_backend</code> members and the session's own role.</p>`,
  scenario: {
    title: 'The log shows "server process was terminated by signal 9: Killed"',
    steps: [
      '1. Read the following log lines: "terminating any other active server processes", then "database system was not properly shut down; automatic recovery in progress".',
      '2. Check the kernel log (dmesg / journalctl -k) for the OOM killer entry and the victim pid.',
      '3. Identify the query of that pid (log_min_duration_statement, pg_stat_statements) and its memory profile (work_mem, hash nodes, parallel workers).',
      '4. Reduce worst-case memory (work_mem, connection count via pooling) and set vm.overcommit_memory = 2.',
      '5. Protect the postmaster with a negative oom_score_adj in the systemd unit.',
      '6. Confirm pg_postmaster_start_time() did not change since (no further restarts).'
    ]
  },
  widgets: ['diagram:process-model', 'diagram:pg-arch'],
  interview: [
    { q: 'Describe PostgreSQL\'s process model.', a: 'A postmaster process owns shared memory and forks one backend process per client connection, plus background processes: checkpointer, background writer, WAL writer, autovacuum launcher and workers, archiver, logical replication launcher, WAL senders/receivers, startup (recovery), and in PG18 IO workers. They communicate via shared memory, latches and signals.' },
    { q: 'Why does a single backend crash restart the whole server?', a: 'All backends share memory. If a backend dies abnormally it might have corrupted shared structures, so the postmaster terminates all children, reinitialises shared memory and performs crash recovery from WAL. A clean exit (disconnect, SIGTERM) does not trigger this.' },
    { q: 'What happened to the statistics collector?', a: 'PostgreSQL 15 removed it. Cumulative statistics now live in shared memory; backends accumulate stats locally and flush them periodically. Stats are persisted at clean shutdown and discarded after a crash.' },
    { q: 'What is the difference between the background writer and the checkpointer?', a: 'The checkpointer writes all dirty buffers at checkpoint time to bound recovery. The background writer continuously writes some dirty buffers that are likely to be evicted soon, so backends rarely have to write a dirty page themselves before reusing a buffer.' }
  ],
  exercises: [
    { task: 'Show your backend pid and how long your session has been connected.', solution: `SELECT pid, backend_type, now() - backend_start AS connected_for
FROM   pg_stat_activity
WHERE  pid = pg_backend_pid();`, run: true },
    { task: 'From pg_stat_io, sum reads, writes and hits per backend_type and show only types with any activity.', solution: `SELECT backend_type,
       sum(reads)  AS reads,
       sum(writes) AS writes,
       sum(hits)   AS hits
FROM   pg_stat_io
GROUP  BY backend_type
HAVING sum(coalesce(reads,0) + coalesce(writes,0) + coalesce(hits,0)) > 0
ORDER  BY backend_type;`, run: true },
    { task: 'Check the archiver: is archive_mode on, and has any archiving failed?', solution: `SELECT current_setting('archive_mode') AS archive_mode,
       archived_count, failed_count, last_failed_wal, last_failed_time
FROM   pg_stat_archiver;`, run: true }
  ],
  challenge: {
    task: 'Write a "process health" query returning one row per background subsystem with a status column: checkpointer is WARN if requested checkpoints exceed timed ones, archiver is CRIT if failed_count > 0, WAL is WARN if wal_buffers_full > 0, otherwise OK.',
    hint: 'Use CASE expressions inside a UNION ALL of the stats views.',
    solution: `SELECT 'checkpointer' AS subsystem,
       CASE WHEN num_requested > num_timed THEN 'WARN' ELSE 'OK' END AS status,
       format('timed=%s requested=%s', num_timed, num_requested) AS detail
FROM   pg_stat_checkpointer
UNION ALL
SELECT 'archiver',
       CASE WHEN failed_count > 0 THEN 'CRIT' ELSE 'OK' END,
       format('archived=%s failed=%s', archived_count, failed_count)
FROM   pg_stat_archiver
UNION ALL
SELECT 'wal',
       CASE WHEN wal_buffers_full > 0 THEN 'WARN' ELSE 'OK' END,
       format('wal_buffers_full=%s', wal_buffers_full)
FROM   pg_stat_wal;`,
    run: true
  },
  related: ['internals-memory', 'internals-life-of-query', 'connection-pooling', 'monitoring-pg-stat-activity', 'fundamentals'],
  quiz: [
    { type: 'mcq', q: 'Which process forks a new backend for each connection?', options: ['checkpointer', 'postmaster', 'walwriter', 'autovacuum launcher'], answer: 1, explain: 'The postmaster listens for connections and forks backends.' },
    { type: 'tf', q: 'PostgreSQL 16 still has a separate statistics collector process.', answer: false, explain: 'It was removed in PG15; stats are in shared memory.' },
    { type: 'mcq', q: 'Which process replays WAL on a standby?', options: ['walsender', 'startup', 'archiver', 'background writer'], answer: 1, explain: 'The startup process performs recovery/replay; the walreceiver receives WAL from the primary.' },
    { type: 'scenario', q: 'Logs show all sessions disconnected and "automatic recovery in progress". Most likely trigger?', options: ['A client disconnected', 'A backend was killed with SIGKILL (e.g. by the OOM killer) or crashed', 'pg_terminate_backend was called', 'A checkpoint ran'], answer: 1, explain: 'Only abnormal child termination causes the postmaster to reset all sessions and run crash recovery.' }
  ]
},
{
  id: 'internals-memory',
  module: 'internals',
  title: 'Memory Architecture: Shared Buffers, WAL Buffers, Local Memory and Clock-Sweep',
  level: 5,
  minutes: 22,
  summary: 'Look inside PostgreSQL memory: the shared buffer pool and its buffer manager (clock-sweep, usage counts, pins, ring buffers), WAL buffers, and per-backend memory contexts (work_mem, maintenance_work_mem, temp_buffers).',
  objectives: [
    'Distinguish shared memory from per-backend local memory',
    'Explain buffer descriptors, pins, dirty flags and usage counts',
    'Walk through clock-sweep eviction and ring-buffer strategies',
    'Inspect the buffer cache with pg_buffercache and memory contexts with pg_backend_memory_contexts',
    'Map each memory parameter to the region it controls'
  ],
  concept: `<p>PostgreSQL memory is split into two worlds:</p>
<ul>
<li><strong>Shared memory</strong> (allocated once by the postmaster, visible to all processes): the <strong>shared buffer pool</strong> (<code>shared_buffers</code>), <strong>WAL buffers</strong> (<code>wal_buffers</code>), the lock table, the proc array, SLRU caches for commit status (CLOG), subtransactions and multixacts, and cumulative statistics.</li>
<li><strong>Local (backend) memory</strong>: per-process <em>memory contexts</em> for parsing, planning, catalog caches, and executor work areas — <code>work_mem</code> for sorts/hashes, <code>maintenance_work_mem</code> for maintenance, <code>temp_buffers</code> for temporary tables.</li>
</ul>
<p><strong>Analogy:</strong> a shared library reading room. The bookshelves near the tables (shared buffers) hold pages anyone can read; each book has a card showing how many readers are holding it (pin count) and how popular it has been lately (usage count). When a new book must be shelved and there is no empty slot, the librarian walks round the shelves like a clock hand, lowering each book's popularity by one, and removes the first book nobody is holding whose popularity has dropped to zero. Each reader also has their own small desk (local memory) for scratch work.</p>
<h4>Buffer manager essentials</h4>
<ul>
<li>Each 8KB buffer has a <strong>descriptor</strong>: the buffer tag (tablespace, database, relfilenode, fork, block number), state bits (valid, dirty, IO in progress), <strong>usage count</strong> (0–5) and <strong>pin count</strong>.</li>
<li>A <strong>buffer mapping hash table</strong> (partitioned, 128 partitions) maps tags to buffer ids.</li>
<li>Reading a page: look up the tag; on a hit, pin it and bump the usage count; on a miss, find a victim buffer (clock-sweep), write it out if dirty (WAL first!), read the page from the OS, insert into the mapping.</li>
<li><strong>Ring buffers</strong>: large sequential scans (when the table is bigger than 1/4 of shared_buffers), VACUUM and bulk writes (COPY, CREATE TABLE AS) use a small private ring of buffers, so a one-off scan does not evict the entire hot working set.</li>
</ul>`,
  why: `<p>Understanding the buffer manager explains cache hit ratios, why the first run of a query is slower ("cold cache"), why a full-table report does not destroy the OLTP cache, why <code>shared_buffers</code> has diminishing returns, and what "dirty buffers" the checkpointer is flushing. Understanding local memory explains OOM risks and work_mem behaviour.</p>`,
  useCase: `<p>An analytics team complains that every Monday the first dashboard load takes 40 s and later ones 2 s. Using <code>pg_buffercache</code> <span class="tag ext">extension</span> they see the dashboard's fact table occupies 0 buffers on Monday morning because a weekend batch job (a big <code>CREATE TABLE AS</code> plus index rebuilds) displaced it. They add a scheduled warm-up using <code>pg_prewarm</code> <span class="tag ext">extension</span> after the batch and separate the batch onto a replica. Monday's first load drops to 3 s.</p>`,
  internals: `<p><strong>Clock-sweep in detail:</strong> a shared "next victim" pointer cycles over all buffers. For each candidate: if pinned, skip; if usage_count &gt; 0, decrement and move on; if usage_count = 0 and unpinned, it is the victim. Frequently used pages keep getting their count bumped back towards 5, so they survive several sweeps; one-hit pages decay quickly. It approximates LRU with almost no locking. A free list exists but is only populated at startup and when relations are dropped.</p>
<p><strong>Write path:</strong> modifying a page requires an exclusive content lock on the buffer, writing the WAL record into WAL buffers, stamping the page with the record's LSN and marking it dirty. Before a dirty page can be written to disk, the WAL up to its LSN must be flushed — the core WAL rule. <strong>WAL buffers</strong> are a circular buffer in shared memory; backends insert records concurrently (using WAL insertion locks), and the WAL writer or committing backends flush them.</p>
<p><strong>Local memory contexts</strong> form a tree (TopMemoryContext → CacheMemoryContext, MessageContext, PortalContext → ExecutorState …). Freeing a context frees all its children at once, which is why PostgreSQL rarely leaks memory per query. <code>pg_backend_memory_contexts</code> (PG14+) shows your own tree; <code>pg_log_backend_memory_contexts(pid)</code> dumps another backend's to the log.</p>`,
  whenNot: `<p>Do not try to "pin" tables in memory permanently — PostgreSQL has no such feature; size memory for the working set and let the clock-sweep work. <code>pg_prewarm</code> is for warming after restart, not for forcing residency. Do not use <code>pg_buffercache</code> queries every few seconds on huge shared_buffers: scanning all descriptors (e.g. 2 million buffers for 16GB) has a cost; <code>pg_buffercache_summary()</code> is much cheaper.</p>`,
  syntax: `CREATE EXTENSION pg_buffercache;
SELECT * FROM pg_buffercache_summary();        -- PG16+
SELECT * FROM pg_buffercache_usage_counts();   -- PG16+
SELECT * FROM pg_buffercache;                  -- one row per buffer

SELECT * FROM pg_backend_memory_contexts;      -- your backend (PG14+)
SELECT pg_log_backend_memory_contexts(pid);    -- dump another backend to the log
SELECT * FROM pg_shmem_allocations;            -- named shared memory areas`,
  examples: [
    {
      label: 'Basic',
      title: 'Buffer pool summary and usage-count distribution',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_buffercache;

SELECT * FROM pg_buffercache_summary();

SELECT usage_count, buffers, dirty, pinned
FROM   pg_buffercache_usage_counts()
ORDER  BY usage_count;`,
      explain: `<p><code>pg_buffercache_summary()</code> shows used vs unused buffers (the playground's 128MB = 16,384 buffers is mostly empty because the database is only ~11MB), dirty and pinned buffers, and the average usage count. The usage-count histogram is the clock-sweep's view of popularity: hot pages sit at 5; pages read once sit at 1 and are the first eviction candidates. A cache where almost everything is at 5 and no buffers are unused is under pressure.</p>`,
      output: ` buffers_used | buffers_unused | buffers_dirty | buffers_pinned | usagecount_avg
--------------+----------------+---------------+----------------+----------------
          842 |          15542 |            63 |              0 |           3.88

 usage_count | buffers | dirty | pinned
-------------+---------+-------+--------
           0 |   15542 |     0 |      0
           1 |     175 |     5 |      0
           2 |      56 |     2 |      0
           3 |      31 |     3 |      0
           4 |      17 |     4 |      0
           5 |     563 |    49 |      0
-- exact numbers depend on what has run in the session`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Which relations occupy the buffer cache?',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_buffercache;

SELECT c.relname,
       c.relkind,
       count(*)                          AS buffers,
       pg_size_pretty(count(*) * 8192)   AS cached,
       round(100.0 * count(*) / greatest(c.relpages, 1), 1) AS pct_of_relation,
       sum(b.isdirty::int)               AS dirty,
       round(avg(b.usagecount), 2)       AS avg_usage
FROM   pg_buffercache b
JOIN   pg_class c
       ON b.relfilenode = pg_relation_filenode(c.oid)
      AND b.reldatabase IN (0, (SELECT oid FROM pg_database
                                WHERE datname = current_database()))
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
GROUP  BY c.relname, c.relkind, c.relpages
ORDER  BY buffers DESC
LIMIT  8;`,
      explain: `<p>Buffers are identified by relfilenode, so we join on <code>pg_relation_filenode(c.oid)</code> and restrict to the current database (or 0 for shared catalogs). <code>pct_of_relation</code> shows how much of each table/index is cached — for the hot OLTP tables you want close to 100%. Run a query against <code>customers</code> and re-run this to watch it enter the cache.</p>`,
      output: ` relname          | relkind | buffers | cached | pct_of_relation | dirty | avg_usage
------------------+---------+---------+--------+-----------------+-------+-----------
 order_items      | r       |     105 | 840 kB |           101.0 |     0 |      4.98
 orders           | r       |      90 | 720 kB |           101.1 |     0 |      5.00
 payments         | r       |      45 | 360 kB |           102.3 |     0 |      5.00
 order_items_pkey | i       |      37 | 296 kB |           ...   |     0 |      4.84
 orders_pkey      | i       |      30 | 240 kB |           ...   |     0 |      4.80
 ...`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Shared memory map and your backend\'s private memory contexts',
      sql: `-- Largest named areas in shared memory
SELECT name, pg_size_pretty(allocated_size) AS size
FROM   pg_shmem_allocations
ORDER  BY allocated_size DESC
LIMIT  8;

-- Your backend's local memory, by context
SELECT name, level, pg_size_pretty(total_bytes) AS total, pg_size_pretty(used_bytes) AS used
FROM   pg_backend_memory_contexts
ORDER  BY total_bytes DESC
LIMIT  6;`,
      explain: `<p><code>Buffer Blocks</code> is the shared buffer pool itself (= shared_buffers); <code>Buffer Descriptors</code> are its headers; <code>XLOG Ctl</code> holds WAL buffers; <code>Aio*</code> entries are PostgreSQL 18's asynchronous-IO handles. The second query shows the local memory tree of your backend: <code>CacheMemoryContext</code> (relation and catalog caches — grows with the number of tables a session touches), <code>TopMemoryContext</code>, and per-query contexts. A backend that touched 50,000 partitions can have hundreds of MB in CacheMemoryContext.</p>`,
      output: ` name               | size
--------------------+---------
 Buffer Blocks      | 128 MB
 XLOG Ctl           | 4110 kB
 <anonymous>        | 2735 kB
                    | 2456 kB
 AioHandle          | 1328 kB
 AioHandleData      | 1328 kB
 AioHandleIOV       | 1328 kB
 Buffer Descriptors | 1024 kB

 name               | level | total   | used
--------------------+-------+---------+-------
 CacheMemoryContext |     1 | 1024 kB | ...
 index info         |     2 | ...     | ...
 TopMemoryContext   |     0 | 94 kB   | ...
 ...`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Scanning every buffer descriptor every few seconds from monitoring
CREATE EXTENSION IF NOT EXISTS pg_buffercache;
SELECT count(*) FILTER (WHERE isdirty) AS dirty, count(*) AS total
FROM   pg_buffercache;`, why: 'pg_buffercache returns one row per buffer — 2 million rows for 16GB shared_buffers — and briefly locks buffer headers. Polling it frequently adds overhead to the very system you monitor.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS pg_buffercache;
SELECT buffers_used, buffers_unused, buffers_dirty, usagecount_avg
FROM   pg_buffercache_summary();`, why: 'pg_buffercache_summary() (PG16+) aggregates in C without producing a row per buffer and without taking buffer header locks — fine for regular monitoring.', run: true }
  },
  mistakes: [
    `Assuming a "read" in statistics means a physical disk read — it means "not in shared_buffers"; the OS cache may still serve it.`,
    `Expecting a big sequential scan to load a large table into shared_buffers — ring buffers deliberately prevent that.`,
    `Confusing <code>wal_buffers</code> with WAL disk usage; it is a small in-memory staging area.`,
    `Thinking memory is freed per row; PostgreSQL frees whole memory contexts at the end of a phase or query.`,
    `Setting <code>temp_buffers</code> after a session has already used temporary tables — it can only be changed before the first temp-table access in a session.`
  ],
  best: [
    `Use <code>pg_buffercache_summary()</code> / <code>pg_buffercache_usage_counts()</code> for routine monitoring; full <code>pg_buffercache</code> scans only for investigations.`,
    `Warm critical tables after a restart with <code>pg_prewarm</code> <span class="tag ext">extension</span> (its autoprewarm worker can do it automatically).`,
    `Keep catalog-cache memory in check: avoid thousands of partitions per query and long-lived sessions that touch every table.`,
    `Use <code>pg_log_backend_memory_contexts(pid)</code> to diagnose a backend that is using unexpected amounts of memory.`
  ],
  performance: `<p>A buffer hit costs a hash lookup, a pin and a lock — microseconds. A miss that hits the OS cache costs a system call and an 8KB copy; a real disk read costs 50–200 µs on NVMe, milliseconds on network storage. Contention points: buffer mapping partition locks (hot lookups), buffer content locks on hot pages (e.g. the rightmost B-tree leaf of an ever-increasing key), and the WAL insertion locks under extremely high write rates.</p>`,
  security: `<p><code>pg_buffercache</code> exposes which relations are cached, and pg_shmem_allocations/memory-context functions reveal internals; by default they are restricted to superusers and members of <code>pg_monitor</code>/<code>pg_read_all_stats</code>. Grant narrowly. Shared memory is accessible to the postgres OS user only — protect that account.</p>`,
  scenario: {
    title: 'Queries are fast after warm-up but terrible after every restart',
    steps: [
      '1. Confirm with EXPLAIN (ANALYZE, BUFFERS): "shared read" dominates on first run, "shared hit" afterwards.',
      '2. Check shared_buffers sizing versus the hot working set (pg_buffercache over a busy period).',
      '3. Enable pg_prewarm with autoprewarm (shared_preload_libraries = \'pg_prewarm\') so the buffer list is saved and reloaded across restarts.',
      '4. For failover, warm the standby (it already has a hot cache if it serves reads).',
      '5. Re-measure first-request latency after the next maintenance restart.'
    ]
  },
  widgets: ['diagram:memory'],
  interview: [
    { q: 'How does PostgreSQL choose which buffer to evict?', a: 'Clock-sweep: a pointer cycles over the buffer array, skipping pinned buffers and decrementing usage counts; the first unpinned buffer with usage count 0 is evicted (written first if dirty, after flushing WAL up to its LSN). Frequently used pages get their count bumped (max 5) and survive.' },
    { q: 'What is a ring buffer strategy?', a: 'Large sequential scans, VACUUM and bulk writes use a small private ring of buffers that are reused, instead of pulling the whole relation through shared_buffers. This prevents one-off big operations from evicting the hot OLTP working set.' },
    { q: 'What lives in shared memory vs local memory?', a: 'Shared: buffer pool, WAL buffers, lock table, proc array, SLRU caches (commit status etc.), statistics. Local: memory contexts per backend for catalog/relation caches, plans, sort/hash areas (work_mem), maintenance work areas and temp_buffers for temporary tables.' },
    { q: 'Why can a page not be written to disk before its WAL?', a: 'Write-ahead logging requires that the WAL describing a change reaches durable storage before the changed page does; otherwise a crash could leave a data page with changes that cannot be undone or redone consistently. The buffer manager flushes WAL up to the page LSN before writing a dirty page.' }
  ],
  exercises: [
    { task: 'Show how many buffers are used, unused and dirty using pg_buffercache_summary().', solution: `CREATE EXTENSION IF NOT EXISTS pg_buffercache;
SELECT buffers_used, buffers_unused, buffers_dirty
FROM   pg_buffercache_summary();`, run: true },
    { task: 'Compute shared_buffers in buffers and in bytes from pg_settings.', solution: `SELECT setting::int                         AS buffers,
       pg_size_pretty(setting::bigint * 8192)  AS bytes
FROM   pg_settings
WHERE  name = 'shared_buffers';`, run: true },
    { task: 'Show the total memory used by your backend\'s memory contexts.', solution: `SELECT pg_size_pretty(sum(total_bytes)) AS backend_memory
FROM   pg_backend_memory_contexts;`, run: true }
  ],
  challenge: {
    task: 'Read the whole customers table, then report how many of its pages are in shared buffers and what fraction of the relation that is. Do the same for its primary key index.',
    hint: 'Run a SELECT count(*) with a non-indexable filter first; then join pg_buffercache to pg_class for customers and customers_pkey.',
    solution: `CREATE EXTENSION IF NOT EXISTS pg_buffercache;
SELECT count(*) FROM customers WHERE name LIKE '%a%';
SELECT c.relname,
       c.relpages,
       count(b.bufferid)                                    AS cached_pages,
       round(100.0 * count(b.bufferid) / greatest(c.relpages, 1), 1) AS pct_cached
FROM   pg_class c
LEFT   JOIN pg_buffercache b
       ON b.relfilenode = pg_relation_filenode(c.oid)
      AND b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
WHERE  c.relname IN ('customers', 'customers_pkey')
GROUP  BY c.relname, c.relpages;`,
    run: true
  },
  related: ['internals-process-architecture', 'production-optimization-memory', 'internals-storage-layout', 'internals-life-of-query'],
  quiz: [
    { type: 'mcq', q: 'Maximum usage count a shared buffer can reach?', options: ['1', '5', '16', 'Unlimited'], answer: 1, explain: 'BM_MAX_USAGE_COUNT is 5, so popular pages survive at most ~5 sweeps without being touched.' },
    { type: 'tf', q: 'A sequential scan of a table larger than a quarter of shared_buffers uses a ring buffer instead of filling shared_buffers.', answer: true, explain: 'The bulk-read strategy uses a small ring (256kB) to avoid cache pollution.' },
    { type: 'mcq', q: 'Which memory area holds sort data for an ORDER BY?', options: ['shared_buffers', 'wal_buffers', 'Backend-local memory sized by work_mem', 'temp_buffers'], answer: 2, explain: 'Sorts use per-backend memory up to work_mem, then spill to temp files.' },
    { type: 'mcq', q: 'A buffer is selected for eviction when it is…', options: ['Dirty', 'Pinned and usage count 5', 'Unpinned and usage count 0', 'Older than checkpoint_timeout'], answer: 2, explain: 'Clock-sweep evicts the first unpinned buffer whose usage count has dropped to zero.' }
  ]
},
{
  id: 'internals-storage-layout',
  module: 'internals',
  title: 'Storage Layout: Data Directory, relfilenodes, 8KB Pages, Line Pointers and Tuple Headers',
  level: 5,
  minutes: 28,
  summary: 'Open up the files: PGDATA layout, relfilenode and forks (main, fsm, vm, init), the 8KB page header, line pointers, and tuple headers (t_xmin, t_xmax, t_ctid, infomask) — inspected live with pageinspect.',
  objectives: [
    'Navigate the data directory: base/, global/, pg_wal/, pg_xact/ and relation files',
    'Explain relfilenode vs OID and why TRUNCATE/VACUUM FULL change relfilenode',
    'Describe the four forks: main, fsm, vm, init',
    'Read a page header (lsn, lower, upper, special) and line pointers with pageinspect',
    'Interpret tuple headers: t_xmin, t_xmax, t_ctid and infomask flags, including HOT updates'
  ],
  concept: `<p>Every table and index is stored as ordinary files inside the <strong>data directory</strong> (PGDATA). Files are divided into fixed-size <strong>8KB pages</strong> (blocks); each page holds tuples (row versions) addressed by a <strong>line pointer</strong> number. A row's physical address is its <code>ctid</code> = (page number, line pointer).</p>
<p><strong>Analogy:</strong> a filing cabinet (the table's file) with numbered drawers (pages). Each drawer has an index card at the front listing slot positions (line pointers) and the documents grow from the back towards the front (tuples). Every document carries a stamp: who created it (t_xmin), who retired it (t_xmax) and where its newer version lives (t_ctid).</p>
<h4>Data directory layout</h4>
<table>
<tr><th>Path</th><th>Contents</th></tr>
<tr><td><code>base/&lt;db_oid&gt;/</code></td><td>One directory per database; relation files named by relfilenode</td></tr>
<tr><td><code>global/</code></td><td>Cluster-wide catalogs (pg_database, pg_authid…) and <code>pg_control</code></td></tr>
<tr><td><code>pg_wal/</code></td><td>WAL segment files (16MB each by default)</td></tr>
<tr><td><code>pg_xact/</code></td><td>Commit status of every transaction (CLOG), 2 bits per XID</td></tr>
<tr><td><code>pg_multixact/</code>, <code>pg_subtrans/</code></td><td>Multi-transaction row lockers, subtransaction parents</td></tr>
<tr><td><code>pg_tblspc/</code></td><td>Symlinks to tablespace locations</td></tr>
<tr><td><code>postgresql.conf</code>, <code>postgresql.auto.conf</code>, <code>pg_hba.conf</code></td><td>Configuration (Debian/Ubuntu keep them in /etc/postgresql)</td></tr>
</table>
<h4>Relation files and forks</h4>
<p>A table with relfilenode 16517 in database 5 lives at <code>base/5/16517</code>; when it exceeds 1GB, segments <code>16517.1</code>, <code>16517.2</code>… follow. Each relation may have <strong>forks</strong>: <code>main</code> (the data), <code>_fsm</code> (free space map: how much space is free per page), <code>_vm</code> (visibility map: 2 bits per page, all-visible and all-frozen) and <code>_init</code> (for UNLOGGED relations: the empty initial version restored after a crash).</p>
<h4>Page layout (8192 bytes)</h4>
<ul>
<li><strong>Page header</strong> (24 bytes): <code>pd_lsn</code> (LSN of the last WAL record that changed the page), checksum, flags, <code>pd_lower</code> (end of line pointer array), <code>pd_upper</code> (start of tuple space), <code>pd_special</code> (start of special space — used by indexes), version, <code>pd_prune_xid</code>.</li>
<li><strong>Line pointers</strong> (4 bytes each) grow downward from the header; each stores offset, length and state (unused, normal, redirect, dead).</li>
<li><strong>Free space</strong> between <code>pd_lower</code> and <code>pd_upper</code>.</li>
<li><strong>Tuples</strong> grow upward from the end of the page.</li>
</ul>
<h4>Tuple header (23 bytes + alignment)</h4>
<p><code>t_xmin</code> (inserting XID), <code>t_xmax</code> (deleting/locking XID, 0 if none), <code>t_cid</code> (command id within the transaction), <code>t_ctid</code> (own address, or the address of the newer version after an UPDATE), <code>t_infomask2</code> (number of attributes + HOT flags), <code>t_infomask</code> (hint bits like XMIN_COMMITTED, XMAX_INVALID, HASNULL, HASVARWIDTH), <code>t_hoff</code> (offset to user data), then an optional null bitmap.</p>`,
  why: `<p>Physical layout explains performance and behaviour: why an UPDATE creates a new row version (MVCC), why bloat happens, why HOT updates avoid index maintenance, why <code>ctid</code> changes, why a 1-byte boolean column can cost 8 bytes due to alignment, why TRUNCATE is instant (new empty file), and how index-only scans use the visibility map.</p>`,
  useCase: `<p>A payments company's <code>accounts</code> table grows from 4GB to 38GB in a month while row count stays constant. Using <code>pageinspect</code> <span class="tag ext">extension</span> on a few pages, the DBA sees most line pointers are dead tuples with t_xmax set and tuple chains via t_ctid — updates were not HOT because an indexed <code>updated_at</code> column changed on every update, and a stale replication slot pinned the xmin horizon. Dropping the slot, removing the unnecessary index, and lowering <code>fillfactor</code> to 90 made 95% of updates HOT; size stabilised at 5GB after a <code>pg_repack</code> <span class="tag tool">third-party tool</span>.</p>`,
  internals: `<p><strong>Visibility check</strong> uses the tuple header plus the snapshot: a tuple is visible if t_xmin committed and is visible to the snapshot, and t_xmax is empty, aborted, or not yet visible. Looking up commit status in pg_xact is costly, so the first reader sets <em>hint bits</em> (HEAP_XMIN_COMMITTED etc.) on the tuple — which dirties the page (that is why a SELECT can cause writes after a bulk load).</p>
<p><strong>HOT (heap-only tuple) updates:</strong> if no indexed column changes and the new version fits on the same page, the new tuple is marked HEAP_ONLY_TUPLE and the old one HEAP_HOT_UPDATED; indexes keep pointing at the old line pointer, which is later turned into a <em>redirect</em> by page pruning. No index entries are added — a big win for write-heavy tables. <code>fillfactor</code> &lt; 100 leaves room on each page for HOT updates.</p>
<p><strong>relfilenode vs OID:</strong> the OID identifies the relation in catalogs forever; the relfilenode names its current file. Operations that rewrite the table — TRUNCATE, VACUUM FULL, CLUSTER, some ALTER TABLE forms — create a new file with a new relfilenode, and the old file is removed at commit. <code>pg_relation_filepath()</code> returns the current path.</p>`,
  whenNot: `<p><code>pageinspect</code> is a diagnostic and teaching tool; it requires superuser and reads raw pages. Never build application logic on <code>ctid</code> (it changes on update and VACUUM FULL) and never edit files in PGDATA by hand — copying, deleting or "cleaning" files there corrupts the cluster. Use SQL-level tools (pgstattuple, pg_visibility) for routine checks.</p>`,
  syntax: `CREATE EXTENSION pageinspect;
SELECT * FROM page_header(get_raw_page('table', blkno));
SELECT * FROM heap_page_items(get_raw_page('table', blkno));
SELECT * FROM heap_tuple_infomask_flags(t_infomask, t_infomask2);
SELECT * FROM bt_metap('index');  SELECT * FROM bt_page_items('index', blkno);

SELECT pg_relation_filepath('table');          -- base/<dboid>/<relfilenode>
SELECT relfilenode FROM pg_class WHERE relname = 'table';
SELECT ctid, xmin, xmax, * FROM table;         -- system columns`,
  examples: [
    {
      label: 'Basic',
      title: 'Where is a table on disk? System columns ctid, xmin, xmax',
      sql: `SELECT c.oid,
       c.relfilenode,
       pg_relation_filepath(c.oid)          AS file_path,
       c.relpages,
       c.reltuples::bigint                  AS est_rows,
       current_setting('block_size')        AS block_size,
       current_setting('segment_size')      AS segment_size
FROM   pg_class c
WHERE  c.relname = 'departments';

SELECT ctid, xmin, xmax, id, name
FROM   departments
ORDER  BY id
LIMIT  4;`,
      explain: `<p>The table's file is <code>base/5/16385</code>: database OID 5, relfilenode 16385. It occupies 1 page holding all 8 rows. Every row has hidden <strong>system columns</strong>: <code>ctid</code> (page, line pointer), <code>xmin</code> (inserting transaction) and <code>xmax</code> (deleting/locking transaction, 0 if none). Your XID values will differ; in this dataset xmax may be non-zero because rows were key-share locked by foreign-key checks during loading — a lock, not a delete.</p>`,
      output: ` oid   | relfilenode | file_path    | relpages | est_rows | block_size | segment_size
-------+-------------+--------------+----------+----------+------------+--------------
 16385 |       16385 | base/5/16385 |        1 |        8 | 8192       | 1GB

 ctid  | xmin | xmax | id | name
-------+------+------+----+-------------
 (0,1) |  752 |  752 |  1 | Engineering
 (0,2) |  752 |  752 |  2 | Sales
 (0,3) |  752 |  752 |  3 | Marketing
 (0,4) |  752 |  752 |  4 | Finance`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Read a page header and line pointers with pageinspect',
      sql: `CREATE EXTENSION IF NOT EXISTS pageinspect;

SELECT lsn, checksum, lower, upper, special, pagesize, version
FROM   page_header(get_raw_page('departments', 0));

SELECT lp, lp_off, lp_len, t_xmin, t_xmax, t_ctid, t_hoff,
       t_infomask::bit(16) AS infomask_bits
FROM   heap_page_items(get_raw_page('departments', 0))
ORDER  BY lp
LIMIT  4;`,
      explain: `<p><strong>Page header:</strong> <code>lower = 56</code> means 24 bytes header + 8 line pointers × 4 bytes; <code>upper = 7696</code> is where tuple data begins; free space = upper − lower = 7,640 bytes. <code>special = 8192</code> (tables have no special space). <code>lsn</code> is the WAL position of the last change to this page — it can only be written to disk after WAL up to that LSN is flushed.</p><p><strong>Line pointers:</strong> tuple 1 sits at byte 8128, 64 bytes long; each next tuple is placed just below the previous one (8072, 8008…). <code>t_hoff = 24</code>: user data starts 24 bytes into the tuple (23-byte header rounded up to 8-byte alignment).</p>`,
      output: ` lsn       | checksum | lower | upper | special | pagesize | version
-----------+----------+-------+-------+---------+----------+---------
 0/1791E18 |        0 |    56 |  7696 |    8192 |     8192 |       4

 lp | lp_off | lp_len | t_xmin | t_xmax | t_ctid | t_hoff | infomask_bits
----+--------+--------+--------+--------+--------+--------+------------------
  1 |   8128 |     64 |    752 |    752 | (0,1)  |     24 | 0000000010010010
  2 |   8072 |     56 |    752 |    752 | (0,2)  |     24 | 0000000010010010
  3 |   8008 |     64 |    752 |    752 | (0,3)  |     24 | 0000000010010010
  4 |   7944 |     64 |    752 |    752 | (0,4)  |     24 | 0000000010010010`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Watch UPDATE (HOT) and DELETE change tuple headers',
      sql: `CREATE EXTENSION IF NOT EXISTS pageinspect;

CREATE TABLE page_demo (id int PRIMARY KEY, name text);
INSERT INTO page_demo VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma');
UPDATE page_demo SET name = 'BETA' WHERE id = 2;   -- non-indexed column: HOT
DELETE FROM page_demo WHERE id = 3;

SELECT h.lp, h.lp_off, h.lp_len, h.t_xmin, h.t_xmax, h.t_ctid, f.raw_flags
FROM   heap_page_items(get_raw_page('page_demo', 0)) h
CROSS  JOIN LATERAL heap_tuple_infomask_flags(h.t_infomask, h.t_infomask2) f
ORDER  BY h.lp;

SELECT relfilenode AS before_truncate FROM pg_class WHERE relname = 'page_demo';
TRUNCATE page_demo;
SELECT relfilenode AS after_truncate  FROM pg_class WHERE relname = 'page_demo';`,
      explain: `<p>Four tuples exist on the page although the table has two live rows:</p><ul><li><strong>lp 1</strong> — 'alpha', untouched: t_xmax = 0 (XMAX_INVALID).</li><li><strong>lp 2</strong> — old 'beta': t_xmax = updating XID, t_ctid → (0,4), flag <code>HEAP_HOT_UPDATED</code>.</li><li><strong>lp 3</strong> — 'gamma': t_xmax = deleting XID, t_ctid points to itself, <code>HEAP_KEYS_UPDATED</code> (a delete counts as changing the key).</li><li><strong>lp 4</strong> — new 'BETA': <code>HEAP_ONLY_TUPLE</code> + <code>HEAP_UPDATED</code>; no new index entry was made, the pkey still points to lp 2 and follows the HOT chain.</li></ul><p>Dead versions stay until pruning/VACUUM. Finally, TRUNCATE assigns a <strong>new relfilenode</strong> (new empty file). XID values depend on your session; when run inside a single transaction all t_xmin/t_xmax values are equal.</p>`,
      output: ` lp | lp_off | lp_len | t_xmin | t_xmax | t_ctid | raw_flags
----+--------+--------+--------+--------+--------+-------------------------------------------------------------
  1 |   8152 |     34 |    755 |      0 | (0,1)  | {HEAP_HASVARWIDTH,HEAP_XMAX_INVALID}
  2 |   8112 |     33 |    755 |    756 | (0,4)  | {HEAP_HASVARWIDTH,HEAP_XMIN_COMMITTED,HEAP_HOT_UPDATED}
  3 |   8072 |     34 |    755 |    757 | (0,3)  | {HEAP_HASVARWIDTH,HEAP_XMIN_COMMITTED,HEAP_KEYS_UPDATED}
  4 |   8032 |     33 |    756 |      0 | (0,4)  | {HEAP_HASVARWIDTH,HEAP_XMAX_INVALID,HEAP_UPDATED,HEAP_ONLY_TUPLE}

 before_truncate          after_truncate
-----------------        ----------------
           24622                    24630`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Using ctid as a stable row identifier
SELECT ctid, id FROM orders WHERE id = 10;
-- ...later: UPDATE orders SET status = 'paid' WHERE ctid = '(0,10)';`, why: 'ctid is a physical address. Any UPDATE creates a new version at a new ctid, and VACUUM FULL/CLUSTER rewrite everything; a stored ctid can point to a different row or nothing at all.', run: true },
    good: { sql: `-- Use the primary key for identity
SELECT id, status FROM orders WHERE id = 10;
-- UPDATE orders SET status = 'paid' WHERE id = 10;`, why: 'Primary keys are logical, stable identifiers. ctid is only useful for one-off maintenance tricks within a single statement or transaction.', run: true }
  },
  mistakes: [
    `Treating <code>ctid</code> as a permanent row id.`,
    `Assuming UPDATE modifies the row in place — PostgreSQL writes a new version and marks the old one with t_xmax.`,
    `Indexing frequently updated columns unnecessarily, which disables HOT updates and multiplies index writes.`,
    `Manually deleting files in <code>pg_wal</code> or <code>base/</code> to free space — guaranteed corruption.`,
    `Ignoring column order and alignment: interleaving <code>bool</code>/<code>int8</code> columns can waste several bytes per row of padding.`
  ],
  best: [
    `Use <code>pageinspect</code> on a copy or a small table to learn and debug; never in application code.`,
    `Set <code>fillfactor</code> (e.g. 90) on heavily updated tables to leave room for HOT updates; check <code>n_tup_hot_upd</code> vs <code>n_tup_upd</code> in pg_stat_user_tables.`,
    `Order columns from widest fixed-length (8-byte) to narrower, then variable-length, to minimise padding on very large tables.`,
    `Enable data checksums (default for new clusters created with <code>initdb</code> in PG18) to detect storage corruption.`
  ],
  performance: `<p>Pages are the unit of IO and caching: a query fetching 100 rows scattered across 100 pages costs 100 page reads; 100 rows clustered on 2 pages cost 2. That is why correlation (physical order) matters for index range scans and why BRIN indexes work on naturally ordered data. Tuple header overhead (~24 bytes) dominates narrow rows: a table of two <code>int4</code> columns uses ~36 bytes per row including the line pointer. HOT updates avoid index writes and allow pruning to reclaim space within the page without VACUUM.</p>`,
  security: `<p><code>get_raw_page</code> returns raw bytes including deleted-but-not-vacuumed data — that is why pageinspect functions are superuser-only. Deleted sensitive data physically remains in pages (and WAL, backups) until vacuumed and overwritten; for real erasure requirements, rely on encryption and key destruction rather than DELETE.</p>`,
  scenario: {
    title: 'A table keeps growing although row count is stable',
    steps: [
      '1. Compare n_live_tup with n_dead_tup and pg_relation_size over time.',
      '2. Check n_tup_hot_upd / n_tup_upd: low ratio → updates touch indexed columns or pages are full.',
      '3. Inspect a sample page with heap_page_items: many tuples with t_xmax set and long t_ctid chains confirm dead versions.',
      '4. Look for xmin-horizon blockers (long transactions, replication slots) that prevent cleanup.',
      '5. Fix causes (drop unneeded indexes on hot columns, ALTER TABLE ... SET (fillfactor = 90), tune autovacuum), then reclaim space with pg_repack (third-party) or VACUUM FULL in a window.'
    ]
  },
  widgets: ['diagram:storage-page', 'lab:mvcc'],
  interview: [
    { q: 'Describe the layout of a PostgreSQL heap page.', a: 'An 8KB page has a 24-byte header (LSN, checksum, flags, pd_lower, pd_upper, pd_special, prune xid), an array of 4-byte line pointers growing forward, free space in the middle, and tuples growing backward from the end. Indexes also use a special space at the end of the page.' },
    { q: 'What are t_xmin, t_xmax and t_ctid?', a: 't_xmin is the XID that inserted the tuple version, t_xmax the XID that deleted or locked it (0 if none), and t_ctid the tuple\'s own address or, after an update, the address of the newer version — forming the update chain.' },
    { q: 'What is a HOT update and why does it matter?', a: 'A heap-only tuple update happens when no indexed column changes and the new version fits on the same page. No new index entries are created; indexes reach the new version via the HOT chain, and page pruning can reclaim space without VACUUM. It greatly reduces write amplification.' },
    { q: 'Why does TRUNCATE change relfilenode?', a: 'TRUNCATE creates a new empty file for the relation and switches the catalog to it; the old file is unlinked at commit. That makes TRUNCATE O(1) and transactional, unlike DELETE which marks every row dead.' }
  ],
  exercises: [
    { task: 'Show the file path, relfilenode and number of pages of the orders table and its primary key index.', solution: `SELECT relname, relkind, relfilenode, pg_relation_filepath(oid) AS path, relpages
FROM   pg_class
WHERE  relname IN ('orders', 'orders_pkey');`, run: true },
    { task: 'Use pageinspect to compute the free space on page 0 of the customers table (upper - lower).', solution: `CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT lower, upper, upper - lower AS free_bytes
FROM   page_header(get_raw_page('customers', 0));`, run: true },
    { task: 'Count live line pointers on page 0 of orders and the average tuple length.', solution: `CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT count(*) AS tuples, round(avg(lp_len), 1) AS avg_tuple_bytes
FROM   heap_page_items(get_raw_page('orders', 0))
WHERE  lp_flags = 1;`, run: true }
  ],
  challenge: {
    task: 'Create a table with fillfactor 50 and one without, insert the same 1,000 rows into both, update a non-indexed column on every row, and compare: pages used, and how many updates were HOT (from heap_page_items flags on page 0 or from relpages after the update).',
    hint: 'CREATE TABLE ... WITH (fillfactor = 50). Use pg_relation_size before and after the UPDATE; HOT tuples have the HEAP_ONLY_TUPLE flag.',
    solution: `CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE TABLE ff100 (id int PRIMARY KEY, v int) WITH (fillfactor = 100);
CREATE TABLE ff50  (id int PRIMARY KEY, v int) WITH (fillfactor = 50);
INSERT INTO ff100 SELECT g, 0 FROM generate_series(1, 1000) g;
INSERT INTO ff50  SELECT g, 0 FROM generate_series(1, 1000) g;
UPDATE ff100 SET v = 1;
UPDATE ff50  SET v = 1;
SELECT 'ff100' AS t, pg_relation_size('ff100') / 8192 AS pages,
       (SELECT count(*) FROM heap_page_items(get_raw_page('ff100', 0)) h,
               LATERAL heap_tuple_infomask_flags(h.t_infomask, h.t_infomask2) f
        WHERE 'HEAP_ONLY_TUPLE' = ANY (f.raw_flags)) AS hot_tuples_on_page0
UNION ALL
SELECT 'ff50', pg_relation_size('ff50') / 8192,
       (SELECT count(*) FROM heap_page_items(get_raw_page('ff50', 0)) h,
               LATERAL heap_tuple_infomask_flags(h.t_infomask, h.t_infomask2) f
        WHERE 'HEAP_ONLY_TUPLE' = ANY (f.raw_flags));`,
    run: true
  },
  related: ['internals-toast', 'mvcc', 'vacuum', 'internals-memory', 'advanced-indexing'],
  quiz: [
    { type: 'mcq', q: 'What does pd_lower point to?', options: ['Start of tuple data', 'End of the line pointer array', 'Start of special space', 'The page LSN'], answer: 1, explain: 'pd_lower marks the end of the line pointer array; pd_upper the start of tuple data. Free space lies between them.' },
    { type: 'tf', q: 'An UPDATE in PostgreSQL overwrites the existing tuple in place.', answer: false, explain: 'It inserts a new tuple version and sets t_xmax/t_ctid on the old one (MVCC).' },
    { type: 'mcq', q: 'Which fork records whether all tuples on a page are visible to everyone?', options: ['main', 'fsm', 'vm', 'init'], answer: 2, explain: 'The visibility map (vm) has all-visible and all-frozen bits per page.' },
    { type: 'predict', q: 'What happens to relfilenode?', code: `SELECT relfilenode FROM pg_class WHERE relname = 't';  -- 24622
TRUNCATE t;
SELECT relfilenode FROM pg_class WHERE relname = 't';`, options: ['Stays 24622', 'Changes to a new value', 'Becomes 0', 'Becomes NULL'], answer: 1, explain: 'TRUNCATE creates a new, empty relation file with a new relfilenode.' },
    { type: 'mcq', q: 'An UPDATE changes only a non-indexed column and the page has free space. What kind of update is it?', options: ['In-place update', 'HOT update', 'TOAST update', 'Index-only update'], answer: 1, explain: 'Heap-only tuple: new version on the same page, no new index entries.' }
  ]
},
{
  id: 'internals-toast',
  module: 'internals',
  title: 'TOAST: How PostgreSQL Stores Large Values (Compression, Out-of-Line Storage, Strategies)',
  level: 5,
  minutes: 20,
  summary: 'The Oversized-Attribute Storage Technique: when values get compressed or moved out of line (~2KB threshold), pglz vs lz4, and the PLAIN / MAIN / EXTERNAL / EXTENDED storage strategies.',
  objectives: [
    'Explain why rows cannot span pages and how TOAST solves large values',
    'Describe the TOAST_TUPLE_THRESHOLD (~2KB) and the compress-then-move-out-of-line algorithm',
    'Compare pglz and lz4 compression and set default_toast_compression / column COMPRESSION',
    'Choose between PLAIN, MAIN, EXTERNAL and EXTENDED storage strategies',
    'Measure stored vs logical size with pg_column_size, octet_length and pg_column_compression'
  ],
  concept: `<p>A tuple must fit in one 8KB page, yet a <code>text</code>, <code>jsonb</code> or <code>bytea</code> value can be up to 1GB. <strong>TOAST</strong> (The Oversized-Attribute Storage Technique) <span class="tag core">core</span> handles this transparently: when a row is too wide, PostgreSQL first tries to <strong>compress</strong> large variable-length values inline, and if the row is still too big, moves values <strong>out of line</strong> into a companion TOAST table, chopped into ~2KB chunks, leaving an 18-byte pointer in the main row.</p>
<p><strong>Analogy:</strong> a hotel room (page) with limited space. Small luggage goes in the room. Big suitcases are first vacuum-packed (compression); if they still do not fit, they go to the luggage storage room (TOAST table) and you keep a claim ticket (TOAST pointer) in the room. You only fetch the suitcase when you actually need it.</p>
<h4>When does TOAST kick in?</h4>
<p>When a row's size exceeds <strong>TOAST_TUPLE_THRESHOLD ≈ 2KB</strong> (2032 bytes with 8KB pages), PostgreSQL processes toastable columns until the row is below <code>TOAST_TUPLE_TARGET</code> (also ~2KB by default; adjustable per table with <code>toast_tuple_target</code>): first compressing EXTENDED/MAIN columns, then moving EXTENDED/EXTERNAL columns out of line, and finally MAIN columns as a last resort.</p>
<h4>Storage strategies (per column)</h4>
<table>
<tr><th>Strategy</th><th>Compress?</th><th>Out of line?</th><th>Default for</th></tr>
<tr><td><code>PLAIN</code> (p)</td><td>No</td><td>No</td><td>Fixed-length types (int, timestamptz, …)</td></tr>
<tr><td><code>MAIN</code> (m)</td><td>Yes</td><td>Only as last resort</td><td>numeric</td></tr>
<tr><td><code>EXTERNAL</code> (e)</td><td>No</td><td>Yes</td><td>— (choose for already-compressed data or fast substring)</td></tr>
<tr><td><code>EXTENDED</code> (x)</td><td>Yes</td><td>Yes</td><td>Most varlena types: text, bytea, jsonb</td></tr>
</table>
<h4>Compression methods</h4>
<ul>
<li><code>pglz</code> — PostgreSQL's built-in LZ-family compressor; the default (<code>default_toast_compression = pglz</code>).</li>
<li><code>lz4</code> (PG14+, needs a build with lz4, standard in most distributions) — typically several times faster to compress and decompress with a similar ratio. Set globally or per column: <code>ALTER TABLE t ALTER COLUMN c SET COMPRESSION lz4</code> (applies to newly stored values).</li>
</ul>
<p>Compression is skipped if it does not save enough (e.g. random or already-compressed data such as JPEG or gzip).</p>`,
  why: `<p>TOAST lets PostgreSQL store documents, JSON, images and long text without application-side chunking, while keeping the main table narrow — so scans that do not touch large columns stay fast. Understanding it explains surprising behaviours: why <code>SELECT *</code> on a table with big JSON is slow, why updating a small column still rewrites a big row (unless the TOASTed value is unchanged and reused), and where disk space goes.</p>`,
  useCase: `<p>A legal-tech platform stores 3M contracts with full text (average 60KB) and a <code>jsonb</code> metadata column, in a table also queried for listing pages (id, title, status, dates). Because bodies are TOASTed, the main heap is only 900MB while the TOAST table is 70GB; listing queries never touch TOAST. Switching <code>body</code> to <code>COMPRESSION lz4</code> cut CPU of document-render endpoints by 35%. Already-gzipped PDF blobs moved to object storage, with only the URL kept in PostgreSQL.</p>`,
  internals: `<p>Each table with toastable columns has a TOAST relation <code>pg_toast.pg_toast_&lt;oid&gt;</code> (<code>pg_class.reltoastrelid</code>) with columns <code>chunk_id</code>, <code>chunk_seq</code>, <code>chunk_data</code> and a unique index on (chunk_id, chunk_seq). A TOAST pointer in the main tuple records the toast relation, value id, raw and stored sizes and compression method. Fetching a value reads its chunks via the index ("detoasting"); EXTERNAL (uncompressed) values support efficient <code>substr()</code> because only the needed chunks are fetched.</p>
<p>On UPDATE, if a TOASTed column is not modified, the new tuple version reuses the same TOAST pointer — the big value is not copied. Deleted TOAST chunks become dead tuples in the TOAST table and are vacuumed with it (autovacuum treats the TOAST table separately and it can be tuned with <code>toast.autovacuum_*</code> reloptions). Values in memory can also be "expanded" or compressed inline (varlena headers: 1-byte short, 4-byte, compressed, external).</p>`,
  whenNot: `<p>Do not store large binary files (videos, many-MB PDFs) in PostgreSQL by default — object storage plus a URL is usually cheaper, easier to serve via CDN, and keeps backups small. Do not change storage to PLAIN on a column that can grow — inserts will fail with "row is too big". Do not expect compression for data that is already compressed or random.</p>`,
  syntax: `ALTER TABLE t ALTER COLUMN c SET STORAGE { PLAIN | MAIN | EXTERNAL | EXTENDED | DEFAULT };
ALTER TABLE t ALTER COLUMN c SET COMPRESSION { pglz | lz4 | default };
CREATE TABLE t (c text COMPRESSION lz4);
SET default_toast_compression = 'lz4';
ALTER TABLE t SET (toast_tuple_target = 4080);

SELECT pg_column_size(c), octet_length(c), pg_column_compression(c) FROM t;
SELECT reltoastrelid::regclass FROM pg_class WHERE relname = 't';`,
  examples: [
    {
      label: 'Basic',
      title: 'Which columns can be TOASTed? (attstorage)',
      sql: `SELECT a.attname,
       format_type(a.atttypid, a.atttypmod) AS type,
       a.attstorage,
       CASE a.attstorage WHEN 'p' THEN 'PLAIN' WHEN 'm' THEN 'MAIN'
                         WHEN 'e' THEN 'EXTERNAL' WHEN 'x' THEN 'EXTENDED' END AS strategy,
       a.attcompression
FROM   pg_attribute a
WHERE  a.attrelid = 'documents'::regclass
  AND  a.attnum > 0 AND NOT a.attisdropped
ORDER  BY a.attnum;

SELECT reltoastrelid::regclass AS toast_table
FROM   pg_class
WHERE  relname = 'documents';`,
      explain: `<p>Fixed-width types (<code>integer</code>, <code>timestamptz</code>) are PLAIN; variable-length ones (<code>text</code>, <code>jsonb</code>, <code>tsvector</code>) are EXTENDED. An empty <code>attcompression</code> means "use <code>default_toast_compression</code> at write time". The second query shows the companion TOAST table in the <code>pg_toast</code> schema (its number is the table's OID at creation, so yours may differ).</p>`,
      output: ` attname    | type                     | attstorage | strategy | attcompression
------------+--------------------------+------------+----------+----------------
 id         | integer                  | p          | PLAIN    |
 title      | text                     | x          | EXTENDED |
 body       | text                     | x          | EXTENDED |
 category   | text                     | x          | EXTENDED |
 metadata   | jsonb                    | x          | EXTENDED |
 created_at | timestamp with time zone | p          | PLAIN    |
 search     | tsvector                 | x          | EXTENDED |

 toast_table
-------------------------
 pg_toast.pg_toast_16580`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Compressed inline vs out-of-line: measure it',
      sql: `CREATE TABLE toast_demo (id int, small text, big_repetitive text, big_random text);

INSERT INTO toast_demo VALUES (
  1,
  'hello',
  repeat('PostgreSQL ', 1000),                                        -- 11,000 bytes, compressible
  (SELECT string_agg(md5(g::text), '') FROM generate_series(1, 200) g) -- 6,400 bytes, not compressible
);

SELECT octet_length(small)                    AS small_len,
       pg_column_size(small)                  AS small_stored,
       octet_length(big_repetitive)           AS rep_len,
       pg_column_size(big_repetitive)         AS rep_stored,
       pg_column_compression(big_repetitive)  AS rep_method,
       octet_length(big_random)               AS rnd_len,
       pg_column_size(big_random)             AS rnd_stored,
       pg_column_compression(big_random)      AS rnd_method
FROM   toast_demo;`,
      explain: `<p><code>octet_length</code> = logical size; <code>pg_column_size</code> = bytes actually stored (compressed size, or size of the out-of-line datum). The row (~17KB) exceeds the 2KB threshold, so TOAST works column by column: the repetitive 11,000-byte string compresses with pglz to <strong>149 bytes</strong> and then fits inline; the hex string barely compresses, so compression is abandoned and it is moved <strong>out of line uncompressed</strong> (stored 6,400 bytes in the TOAST table, 18-byte pointer in the row). 'hello' uses 6 bytes (1-byte short varlena header + 5).</p>`,
      output: ` small_len | small_stored | rep_len | rep_stored | rep_method | rnd_len | rnd_stored | rnd_method
-----------+--------------+---------+------------+------------+---------+------------+------------
         5 |            6 |   11000 |        149 | pglz       |    6400 |       6400 |`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Change storage strategy and see the effect',
      sql: `CREATE TABLE toast_demo2 (id int, doc text);
INSERT INTO toast_demo2 VALUES (1, repeat('PostgreSQL ', 1000));       -- EXTENDED (default)

ALTER TABLE toast_demo2 ALTER COLUMN doc SET STORAGE EXTERNAL;        -- no compression from now on
INSERT INTO toast_demo2 VALUES (2, repeat('PostgreSQL ', 1000));

SELECT id,
       octet_length(doc)            AS logical_bytes,
       pg_column_size(doc)          AS stored_bytes,
       pg_column_compression(doc)   AS method
FROM   toast_demo2
ORDER  BY id;

SELECT c.relname,
       pg_size_pretty(pg_relation_size(c.oid))           AS heap,
       pg_size_pretty(pg_relation_size(c.reltoastrelid)) AS toast
FROM   pg_class c
WHERE  c.relname = 'toast_demo2';`,
      explain: `<p>Row 1 was stored with the default EXTENDED strategy: compressed to 149 bytes inline. After <code>SET STORAGE EXTERNAL</code>, row 2's identical value is stored <strong>uncompressed and out of line</strong> (11,000 bytes in TOAST). Existing rows are not rewritten — strategy and compression changes affect only newly written values. EXTERNAL makes sense for values already compressed by the application, or when you frequently read substrings of long text (only the necessary chunks are fetched).</p>`,
      output: ` id | logical_bytes | stored_bytes | method
----+---------------+--------------+--------
  1 |         11000 |          149 | pglz
  2 |         11000 |        11000 |

 relname     | heap       | toast
-------------+------------+-------
 toast_demo2 | 8192 bytes | 16 kB`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Listing page selects everything, detoasting big bodies for nothing
SELECT * FROM documents ORDER BY created_at DESC LIMIT 20;`, why: 'SELECT * fetches and decompresses every TOASTed body and search vector even though the listing shows only titles — extra IO and CPU per row, and more data over the network.', run: true },
    good: { sql: `SELECT id, title, category, created_at
FROM   documents
ORDER  BY created_at DESC
LIMIT  20;`, why: 'Selecting only needed columns never touches the TOAST table for large columns; the main heap stays narrow and cache-friendly.', run: true }
  },
  mistakes: [
    `Using <code>SELECT *</code> on tables with big TOASTed columns in hot paths.`,
    `Expecting <code>ALTER COLUMN … SET COMPRESSION lz4</code> to recompress existing data — only new values use it (a rewrite such as VACUUM FULL does not recompress either; you must update the values).`,
    `Storing already-compressed blobs with EXTENDED and paying CPU for failed compression attempts — use EXTERNAL.`,
    `Forgetting the TOAST table in size calculations: <code>pg_relation_size</code> excludes it; use <code>pg_table_size</code> / <code>pg_total_relation_size</code>.`,
    `Frequently updating a large JSONB document to change one small key — every update writes a new full TOASTed value.`
  ],
  best: [
    `Use <code>lz4</code> for TOAST compression where available (<code>default_toast_compression = lz4</code>) — faster with similar ratio.`,
    `Keep frequently-updated small fields out of large JSON documents (separate columns or a separate table).`,
    `Select only needed columns; consider a separate table for large rarely-read payloads.`,
    `Monitor TOAST table bloat — autovacuum handles TOAST separately (<code>toast.autovacuum_*</code> reloptions).`,
    `Put large binary objects in object storage and keep metadata + URL in PostgreSQL.`
  ],
  performance: `<p>Detoasting costs index lookups on the TOAST table plus decompression. pglz decompression is slower than lz4; for read-heavy JSON workloads lz4 can noticeably reduce CPU. Inline compressed values keep data in the main heap (one page read); out-of-line values need extra reads. Raising <code>toast_tuple_target</code> keeps more data inline (fewer TOAST lookups, wider heap); lowering it moves more out (narrower heap, faster scans that skip big columns).</p>`,
  security: `<p>Compression ratios can leak information about content in specific attack scenarios (compression side channels) when attackers control part of a value and can observe stored sizes — rarely practical in databases, but relevant for multi-tenant analytics exposing <code>pg_column_size</code>. TOAST tables inherit the main table's permissions; they cannot be accessed by unprivileged users directly.</p>`,
  scenario: {
    title: 'The documents table is 90% TOAST and API latency is high',
    steps: [
      '1. Measure: pg_relation_size(heap) vs pg_relation_size(reltoastrelid); avg pg_column_size of big columns.',
      '2. Check queries for SELECT * and columns returned but unused.',
      '3. Switch default_toast_compression / column COMPRESSION to lz4 for new data; rewrite hot rows by updating them in batches if worthwhile.',
      '4. Move rarely-read large payloads to a side table (1:1) or object storage.',
      '5. Re-measure endpoint latency and CPU.'
    ]
  },
  widgets: ['diagram:storage-page'],
  interview: [
    { q: 'What is TOAST and when is it used?', a: 'TOAST stores large variable-length values compressed and/or out of line in a companion pg_toast table, because a tuple must fit in a page. It triggers when a row exceeds about 2KB: PostgreSQL compresses eligible columns, then moves values out of line until the row fits the target size.' },
    { q: 'Explain the four storage strategies.', a: 'PLAIN: no compression, no out-of-line (fixed-length types). MAIN: compress, move out of line only as last resort. EXTERNAL: out of line without compression (good for pre-compressed data and fast substring). EXTENDED: compress then move out of line (default for text, jsonb, bytea).' },
    { q: 'pglz vs lz4?', a: 'pglz is the built-in default; lz4 (PG14+) compresses and decompresses much faster with a comparable ratio. Set default_toast_compression or per-column COMPRESSION; only newly written values are affected.' },
    { q: 'Does updating a non-TOASTed column copy the large TOASTed value?', a: 'No. The new tuple version reuses the existing TOAST pointer when the toasted column is unchanged, so the large value is not rewritten.' }
  ],
  exercises: [
    { task: 'Find the average logical and stored size of documents.body.', solution: `SELECT round(avg(octet_length(body)))   AS avg_logical,
       round(avg(pg_column_size(body))) AS avg_stored
FROM   documents;`, run: true },
    { task: 'List all tables in public with a TOAST table and the TOAST table size.', solution: `SELECT c.relname, c.reltoastrelid::regclass AS toast_table,
       pg_size_pretty(pg_relation_size(c.reltoastrelid)) AS toast_size
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND c.relkind = 'r' AND c.reltoastrelid <> 0
ORDER  BY pg_relation_size(c.reltoastrelid) DESC;`, run: true },
    { task: 'Create a table with a column using MAIN storage and insert a 20,000-character repetitive string; check how it was stored.', solution: `CREATE TABLE main_demo (id int, t text);
ALTER TABLE main_demo ALTER COLUMN t SET STORAGE MAIN;
INSERT INTO main_demo VALUES (1, repeat('abc', 6667));
SELECT octet_length(t), pg_column_size(t), pg_column_compression(t) FROM main_demo;`, run: true }
  ],
  challenge: {
    task: 'Show how compressible the documents bodies are: for each category, total logical bytes, total stored bytes, compression ratio, and how many values are compressed (pg_column_compression not null).',
    hint: 'GROUP BY category with sum(octet_length), sum(pg_column_size) and count(*) FILTER.',
    solution: `SELECT category,
       count(*)                                   AS docs,
       sum(octet_length(body))                    AS logical_bytes,
       sum(pg_column_size(body))                  AS stored_bytes,
       round(sum(octet_length(body))::numeric / nullif(sum(pg_column_size(body)), 0), 2) AS ratio,
       count(*) FILTER (WHERE pg_column_compression(body) IS NOT NULL) AS compressed_values
FROM   documents
GROUP  BY category
ORDER  BY logical_bytes DESC;`,
    run: true
  },
  related: ['internals-storage-layout', 'jsonb', 'data-types', 'internals-life-of-query'],
  quiz: [
    { type: 'mcq', q: 'Approximately when does PostgreSQL start TOASTing a row (8KB pages)?', options: ['When it exceeds 512 bytes', 'When it exceeds ~2KB', 'When it exceeds 8KB', 'Only when a value exceeds 1MB'], answer: 1, explain: 'TOAST_TUPLE_THRESHOLD is about 2KB (2032 bytes).' },
    { type: 'mcq', q: 'Which strategy stores values out of line without compression?', options: ['PLAIN', 'MAIN', 'EXTERNAL', 'EXTENDED'], answer: 2, explain: 'EXTERNAL = out-of-line, no compression.' },
    { type: 'tf', q: 'ALTER COLUMN ... SET COMPRESSION lz4 immediately recompresses all existing values.', answer: false, explain: 'Only newly stored values use the new method.' },
    { type: 'predict', q: 'What does pg_column_size return for a 11,000-byte highly repetitive text value stored with EXTENDED?', code: `SELECT pg_column_size(repeat('PostgreSQL ', 1000)::text);  -- after storing in a table`, options: ['11000', 'About 149 (compressed)', '18 (pointer)', '0'], answer: 1, explain: 'It compresses very well with pglz (~149 bytes) and then fits inline.' }
  ]
},
{
  id: 'internals-life-of-query',
  module: 'internals',
  title: 'Life of a Query and a Write: Parse → Rewrite → Plan → Execute, Buffers → WAL → Commit → Checkpoint',
  level: 5,
  minutes: 28,
  summary: 'Tie everything together: how a SELECT travels through parser, rewriter, planner and executor, and how an UPDATE flows through shared buffers, WAL, commit, the visibility map, the free space map and checkpoints — with LSNs to prove it.',
  objectives: [
    'Describe the four query stages and what each produces',
    'See the rewriter at work (view expansion) and the plan cache (generic vs custom plans)',
    'Trace a write: buffer pin/lock, WAL record, page LSN, commit record, CLOG',
    'Explain how checkpoints, the visibility map and the free space map fit in',
    'Measure WAL positions with LSN functions'
  ],
  concept: `<p>Every SQL statement goes through the same pipeline inside its backend:</p>
<ol>
<li><strong>Parse</strong> — the lexer/parser checks syntax and builds a raw parse tree; <em>parse analysis</em> resolves table and column names against catalogs, producing a <strong>Query tree</strong>.</li>
<li><strong>Rewrite</strong> — the rule system rewrites the query: views are expanded into their definitions, row-level security policies are added as quals, and rules (<code>CREATE RULE</code>) applied.</li>
<li><strong>Plan/Optimise</strong> — the planner generates candidate paths (scan methods, join orders, join algorithms), costs them using statistics and cost constants, and picks the cheapest <strong>plan tree</strong>.</li>
<li><strong>Execute</strong> — the executor runs the plan as a tree of nodes, pulling rows from the leaves upward (the "Volcano"/iterator model), reading pages through the buffer manager.</li>
</ol>
<p>A write adds a durability path: modify the page in shared buffers → write a WAL record → at <code>COMMIT</code>, write a commit record and flush WAL up to it → report success. Data pages reach disk later via the background writer, checkpointer or eviction.</p>
<p><strong>Analogy:</strong> ordering at a restaurant. The waiter checks your order makes sense (parse), translates "the usual" into actual dishes (rewrite), the chef decides the order and method of cooking (plan), the kitchen cooks (execute). For writes, the cashier first writes the order in the carbon-copy receipt book (WAL) — that is what makes it official; the stock ledger (data files) is updated in batches overnight (checkpoint).</p>`,
  why: `<p>When something is slow or surprising, knowing the stage tells you where to look: a syntax/name error is parse; a view that "ignores" an index may be a rewrite + planner issue; a bad join order is planning (statistics); a slow node is execution (IO, memory). For writes, the pipeline explains why COMMIT latency equals WAL fsync latency, why crash recovery works, why replicas are just WAL consumers, and why index-only scans depend on VACUUM.</p>`,
  useCase: `<p>A trading platform's order-insert latency is 4 ms p50 but 40 ms p99. Tracing the write path shows the time is in <code>IO:WALSync</code> waits at commit — the WAL volume shares a disk with nightly backups. Moving <code>pg_wal</code> to a dedicated NVMe and enabling group commit-friendly batching brings p99 to 6 ms. A separate issue — a reporting query via a view taking 12 s — is traced with EXPLAIN (VERBOSE) to the rewriter expanding a view that joins 6 tables; a narrower view brings it to 300 ms.</p>`,
  internals: `<p><strong>Plan caching:</strong> prepared statements (and PL/pgSQL statements) cache plans. For the first five executions PostgreSQL builds <em>custom plans</em> using the actual parameter values; then it compares their average cost with a <em>generic plan</em> and switches to the generic one if it is not more expensive. <code>plan_cache_mode</code> (auto, force_custom_plan, force_generic_plan) overrides this. <code>pg_prepared_statements</code> shows the counts.</p>
<p><strong>Write path in detail (UPDATE):</strong> (1) the executor finds the tuple, pins its buffer and takes an exclusive content lock; (2) it writes the new tuple version (HOT if possible) and sets t_xmax on the old one; (3) inside a critical section it inserts a WAL record (with a full-page image if this is the first change since the last checkpoint) into WAL buffers and stamps the page's <code>pd_lsn</code>; (4) it marks the buffer dirty and releases the lock; (5) the visibility-map bit for the page is cleared (the page is no longer all-visible); (6) at COMMIT a commit record is inserted, WAL is flushed up to it (unless <code>synchronous_commit = off</code>), waiting for synchronous standbys if configured; the transaction's status is set to committed in <code>pg_xact</code> (CLOG) and it disappears from the proc array, becoming visible to new snapshots.</p>
<p><strong>Afterwards:</strong> the checkpointer eventually writes the dirty page; replicas replay the WAL record; VACUUM later removes the dead version, records free space in the <strong>free space map</strong> (so future inserts reuse it) and sets the <strong>visibility map</strong> bit when all tuples are visible to everyone (enabling index-only scans to skip the heap and later vacuums to skip the page). If the server crashes before the page was written, recovery replays WAL from the last checkpoint's redo point; the page LSN tells recovery whether a record was already applied.</p>`,
  whenNot: `<p>You rarely need to influence stages directly. Avoid <code>plan_cache_mode = force_generic_plan</code> globally (it can lock in bad plans for skewed data) and avoid rules (<code>CREATE RULE</code>) for new designs — triggers and views are clearer. Do not use LSN arithmetic in application logic except for replication-aware reads (e.g. waiting for a replica to reach a commit LSN).</p>`,
  syntax: `EXPLAIN (VERBOSE) SELECT ...;                 -- see rewritten/expanded target lists
PREPARE q(int) AS SELECT ...; EXECUTE q(1);
SELECT * FROM pg_prepared_statements;          -- generic_plans / custom_plans
SET plan_cache_mode = auto | force_custom_plan | force_generic_plan;

SELECT pg_current_wal_lsn(), pg_current_wal_insert_lsn();
SELECT pg_wal_lsn_diff(lsn1, lsn2);            -- bytes between LSNs
SELECT * FROM pg_control_checkpoint();         -- last checkpoint / redo LSN`,
  examples: [
    {
      label: 'Basic',
      title: 'The rewriter expands a view',
      sql: `CREATE VIEW v_paid_orders AS
SELECT id, customer_id, total_amount
FROM   orders
WHERE  status = 'paid';

EXPLAIN (VERBOSE, COSTS OFF)
SELECT * FROM v_paid_orders WHERE customer_id = 7;`,
      explain: `<p>The query mentions only the view, but the plan scans <code>public.orders</code> directly with both conditions combined: the rewriter replaced the view reference with its definition, and the planner then merged the view's <code>WHERE status = 'paid'</code> with the outer <code>customer_id = 7</code>. <code>VERBOSE</code> shows the output columns of each node. Views cost nothing at runtime — they are macros applied at rewrite time.</p>`,
      output: ` QUERY PLAN
-------------------------------------------------------------------------
 Seq Scan on public.orders
   Output: orders.id, orders.customer_id, orders.total_amount
   Filter: ((orders.status = 'paid'::text) AND (orders.customer_id = 7))`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Plan cache: custom plans first, then generic',
      sql: `PREPARE order_by_id(int) AS
  SELECT id, status, total_amount FROM orders WHERE id = $1;

EXECUTE order_by_id(1);
EXECUTE order_by_id(2);
EXECUTE order_by_id(3);
EXECUTE order_by_id(4);
EXECUTE order_by_id(5);
EXECUTE order_by_id(6);

SELECT name, generic_plans, custom_plans
FROM   pg_prepared_statements
WHERE  name = 'order_by_id';`,
      explain: `<p>Parse and rewrite happen once at <code>PREPARE</code>. The first five <code>EXECUTE</code>s are planned with the actual value (custom plans); at the sixth, PostgreSQL compares costs and — because a primary-key lookup costs the same for any value — switches to a cached generic plan, skipping the planner from then on. This is how drivers using server-side prepared statements save planning time. For skewed columns (e.g. <code>status</code>), custom plans may remain better; <code>plan_cache_mode</code> lets you force either.</p>`,
      output: ` name        | generic_plans | custom_plans
-------------+---------------+--------------
 order_by_id |             1 |            5`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Trace a write: LSN, WAL bytes, visibility map and free space map',
      sql: `CREATE EXTENSION IF NOT EXISTS pg_visibility;
CREATE EXTENSION IF NOT EXISTS pg_freespacemap;

CREATE TABLE life_demo AS
SELECT g AS id, repeat('x', 200) AS pad FROM generate_series(1, 2000) g;
VACUUM life_demo;                               -- sets VM bits, builds FSM
SELECT 'after vacuum' AS step, * FROM pg_visibility_map_summary('life_demo');

CREATE TEMP TABLE lsn_mark AS SELECT pg_current_wal_insert_lsn() AS lsn;
UPDATE life_demo SET pad = repeat('y', 200) WHERE id <= 100;   -- touches ~3 pages
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_insert_lsn(), lsn)) AS wal_for_update
FROM   lsn_mark;
SELECT 'after update' AS step, * FROM pg_visibility_map_summary('life_demo');

DELETE FROM life_demo WHERE id % 2 = 0;
VACUUM life_demo;                               -- reclaims space, records it in the FSM
SELECT count(*) AS pages, pg_size_pretty(sum(avail)) AS free_space_recorded
FROM   pg_freespace('life_demo');
SELECT redo_lsn, checkpoint_lsn, redo_wal_file FROM pg_control_checkpoint();`,
      explain: `<p>Step by step: after the first VACUUM every page is <strong>all-visible</strong> in the visibility map. The UPDATE writes WAL (measured via LSN difference, including full-page images) and <strong>clears</strong> the VM bits of the pages it touched — so index-only scans would have to visit those heap pages again. After deleting half the rows and vacuuming, the <strong>free space map</strong> records roughly 4KB free per page, which future INSERTs will reuse instead of extending the file. <code>pg_control_checkpoint()</code> shows the redo LSN where crash recovery would start. Exact numbers depend on prior activity.</p>`,
      output: ` step         | all_visible | all_frozen
--------------+-------------+------------
 after vacuum |          59 |          0

 wal_for_update
----------------
 34 kB             -- varies with prior activity

 step         | all_visible | all_frozen
--------------+-------------+------------
 after update |          55 |          0

 pages | free_space_recorded
-------+---------------------
    62 | 259 kB

 redo_lsn  | checkpoint_lsn | redo_wal_file
-----------+----------------+--------------------------
 0/1DC7340 | 0/1DC7340      | 000000010000000000000001`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Building SQL by string concatenation for every request:
-- every call is parsed, analysed, rewritten and planned from scratch.
SELECT id, status FROM orders WHERE id = 42;`, why: 'Unparameterised literal SQL cannot reuse cached plans and is vulnerable to SQL injection; with high request rates, parse+plan time can exceed execution time for simple lookups.', run: true },
    good: { sql: `PREPARE get_order(bigint) AS SELECT id, status FROM orders WHERE id = $1;
EXECUTE get_order(42);
EXECUTE get_order(43);`, why: 'Prepared (parameterised) statements parse/rewrite once and can reuse a generic plan, saving CPU per call and eliminating injection. Most drivers do this for you with bind parameters.', run: true }
  },
  mistakes: [
    `Thinking COMMIT writes table data to disk — it only guarantees the WAL is flushed; data pages are written later.`,
    `Assuming views are materialised or "slow by nature" — they are expanded at rewrite time.`,
    `Forcing <code>plan_cache_mode = force_generic_plan</code> globally and getting bad plans for skewed parameter values.`,
    `Expecting index-only scans right after a bulk load or heavy update — the visibility map bits are not set until VACUUM.`,
    `Placing WAL on slow or shared storage: every commit waits for WAL fsync.`
  ],
  best: [
    `Use bind parameters/prepared statements (via the driver) for repeated queries.`,
    `Put <code>pg_wal</code> on fast low-latency storage; monitor <code>IO:WALSync</code>/<code>WALWrite</code> waits.`,
    `VACUUM (or let autovacuum) after bulk loads so the visibility map enables index-only scans; <code>VACUUM (ANALYZE)</code> also refreshes statistics.`,
    `Use <code>EXPLAIN (ANALYZE, BUFFERS, VERBOSE)</code> to see what each stage produced.`,
    `Use LSNs to measure WAL generated by batches and to implement read-your-writes on replicas when needed.`
  ],
  performance: `<p>Parse+plan for simple queries costs tens to hundreds of microseconds — negligible for big queries, significant for 50,000 point lookups per second (hence prepared statements and poolers that support them; PgBouncer 1.21+ supports protocol-level prepared statements in transaction mode). Execution cost depends on pages touched and memory. Commit latency ≈ WAL flush latency (plus network round-trip to synchronous standbys). Checkpoint pacing and full-page images determine background write volume.</p>`,
  security: `<p>Parameterisation (separating SQL text from values) is the primary defence against SQL injection — values never pass through the parser as code. The rewriter applies row-level security policies before planning, so RLS cannot be bypassed by query shape (except by roles with BYPASSRLS or table owners without FORCE ROW LEVEL SECURITY). WAL contains all changed data — protect archives and replication links.</p>`,
  scenario: {
    title: 'Commits are slow but queries are fast',
    steps: [
      '1. Sample pg_stat_activity wait events during load: many IO:WALSync / IO:WALWrite → WAL flush latency; IPC:SyncRep → waiting for synchronous standby.',
      '2. Measure WAL device latency (iostat await on the pg_wal device) and WAL volume (pg_stat_wal, LSN deltas).',
      '3. Reduce WAL volume (checkpoint tuning, wal_compression) and move pg_wal to dedicated low-latency storage.',
      '4. If SyncRep: check standby network latency/health or use remote_write / quorum commit.',
      '5. For low-value writes consider SET LOCAL synchronous_commit = off.'
    ]
  },
  widgets: ['diagram:query-pipeline', 'diagram:wal', 'lab:plan'],
  interview: [
    { q: 'Walk through what happens when PostgreSQL executes a SELECT.', a: 'The backend parses the text into a parse tree, analyses it against catalogs into a Query tree, the rewriter expands views and applies RLS/rules, the planner generates and costs alternative paths using statistics and picks the cheapest plan, and the executor runs the plan tree node by node, reading pages via the buffer manager, then sends rows to the client.' },
    { q: 'What does COMMIT actually guarantee and how?', a: 'That the transaction\'s WAL, including its commit record, is flushed to durable storage (and to synchronous standbys if configured). Data pages may still only be in memory; after a crash, replaying WAL reconstructs them. The commit status is recorded in pg_xact so snapshots see the transaction as committed.' },
    { q: 'How do the visibility map and free space map relate to VACUUM?', a: 'VACUUM removes dead tuples, records reusable space per page in the FSM (used by future inserts/updates), and sets VM bits for pages where all tuples are visible to all transactions (and all-frozen bits when frozen). Index-only scans and later vacuums use the VM to skip heap pages. Any modification clears the page\'s VM bit.' },
    { q: 'What is an LSN?', a: 'A Log Sequence Number: a 64-bit byte position in the WAL stream, displayed like 0/1DC7340. Each page stores the LSN of the last WAL record that modified it; replication and recovery progress, checkpoints and WAL volume are all expressed in LSNs.' }
  ],
  exercises: [
    { task: 'Show the current WAL insert LSN and the WAL position of the last checkpoint\'s redo point, and the bytes between them.', solution: `SELECT pg_current_wal_insert_lsn() AS now_lsn,
       redo_lsn,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_insert_lsn(), redo_lsn)) AS wal_since_redo
FROM   pg_control_checkpoint();`, run: true },
    { task: 'Prepare a statement that looks up customers by country and execute it for India and UAE; then show its plan counters.', solution: `PREPARE cust_by_country(text) AS
  SELECT count(*) FROM customers WHERE country = $1;
EXECUTE cust_by_country('India');
EXECUTE cust_by_country('UAE');
SELECT name, generic_plans, custom_plans FROM pg_prepared_statements;`, run: true },
    { task: 'After VACUUM, show the visibility map summary for orders.', solution: `CREATE EXTENSION IF NOT EXISTS pg_visibility;
VACUUM orders;
SELECT * FROM pg_visibility_map_summary('orders');`, run: true }
  ],
  challenge: {
    task: 'Demonstrate that an index-only scan needs heap fetches after an UPDATE and not after VACUUM: create a table with an index, VACUUM, run EXPLAIN ANALYZE of an index-only query, update some rows, run it again, VACUUM, run it a third time. Compare "Heap Fetches".',
    hint: 'Use EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF) and a query selecting only the indexed column.',
    solution: `CREATE TABLE ios_demo AS SELECT g AS id, g % 100 AS grp FROM generate_series(1, 20000) g;
CREATE INDEX ios_demo_id ON ios_demo (id);
VACUUM ANALYZE ios_demo;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
SELECT id FROM ios_demo WHERE id < 5000;
UPDATE ios_demo SET grp = grp + 1 WHERE id < 2000;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
SELECT id FROM ios_demo WHERE id < 5000;
VACUUM ios_demo;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
SELECT id FROM ios_demo WHERE id < 5000;`,
    run: true
  },
  related: ['internals-storage-layout', 'internals-memory', 'wal', 'query-optimization', 'explain'],
  quiz: [
    { type: 'mcq', q: 'Which stage expands views into their definitions?', options: ['Parser', 'Rewriter', 'Planner', 'Executor'], answer: 1, explain: 'The rewriter (rule system) replaces view references with the view query and applies RLS policies.' },
    { type: 'tf', q: 'When COMMIT returns (synchronous_commit = on), the modified table pages are guaranteed to be on disk.', answer: false, explain: 'Only the WAL is guaranteed flushed; pages are written later by bgwriter/checkpointer and recovered from WAL after a crash.' },
    { type: 'mcq', q: 'After how many executions does a prepared statement consider switching to a generic plan by default?', options: ['1', '5', '10', 'Never'], answer: 1, explain: 'After five custom plans, it compares against the generic plan cost (plan_cache_mode = auto).' },
    { type: 'scenario', q: 'Right after a bulk COPY, an index-only scan shows "Heap Fetches: 500000". Why?', options: ['The index is corrupt', 'The visibility map bits are not set until VACUUM runs', 'work_mem is too low', 'The table is TOASTed'], answer: 1, explain: 'Index-only scans skip the heap only for pages marked all-visible; run VACUUM after bulk loads.' },
    { type: 'mcq', q: 'What does a page\'s pd_lsn guarantee before the page can be written to disk?', options: ['That a checkpoint has finished', 'That WAL up to that LSN has been flushed', 'That all replicas confirmed it', 'That the page is all-visible'], answer: 1, explain: 'Write-ahead rule: WAL up to the page LSN must be durable before the page is written.' }
  ]
}
]);

/* -------------------------- SYSTEM CATALOGS -------------------------- */
PGM.addLessons([
{
  id: 'system-catalogs-pg-catalog',
  module: 'system-catalogs',
  title: 'pg_catalog vs information_schema: OIDs, regclass and the Core Catalog Tables',
  level: 4,
  minutes: 24,
  summary: 'Query PostgreSQL\'s own metadata: pg_catalog vs the SQL-standard information_schema, OIDs and reg* casts, and the core catalogs pg_class, pg_attribute, pg_namespace, pg_constraint, pg_index plus the friendly views pg_indexes and pg_tables.',
  objectives: [
    'Explain the difference between pg_catalog and information_schema and when to use each',
    'Use OIDs and the regclass/regtype/regnamespace/regproc casts fluently',
    'Query pg_class, pg_attribute, pg_namespace and pg_constraint to describe a table',
    'Read pg_index and pg_indexes to describe indexes',
    'Use helper functions: pg_get_constraintdef, pg_get_indexdef, format_type, pg_get_viewdef'
  ],
  concept: `<p>PostgreSQL stores all metadata — tables, columns, types, functions, constraints, privileges — in ordinary tables called <strong>system catalogs</strong>, in the schema <code>pg_catalog</code> <span class="tag core">core</span>. Every command like <code>CREATE TABLE</code> is ultimately a set of inserts into these catalogs. Tools such as psql's <code>\\d</code>, pgAdmin and ORMs read them.</p>
<p><strong>Analogy:</strong> a library's card catalogue. The books are your data; the catalogue (cards for every book, author, shelf) is itself stored in drawers you can browse. <code>pg_catalog</code> is the librarians' detailed internal catalogue; <code>information_schema</code> <span class="tag std">SQL standard</span> is the simplified public directory that looks the same in every library (database product).</p>
<h4>pg_catalog vs information_schema</h4>
<table>
<tr><th></th><th>pg_catalog</th><th>information_schema</th></tr>
<tr><td>Standard?</td><td>PostgreSQL-specific</td><td>SQL standard (portable)</td></tr>
<tr><td>Coverage</td><td>Everything (indexes, storage, OIDs, stats, extensions)</td><td>Only standard concepts (no indexes!, limited types)</td></tr>
<tr><td>Speed</td><td>Fast (real tables)</td><td>Views over pg_catalog with privilege checks — slower</td></tr>
<tr><td>Privileges</td><td>Shows all objects</td><td>Shows only objects you have some privilege on</td></tr>
<tr><td>Use for</td><td>DBA tooling, performance, PostgreSQL features</td><td>Portable application/introspection code</td></tr>
</table>
<h4>OIDs and reg* casts</h4>
<p>Catalog rows are identified by <strong>OIDs</strong> (object identifiers, 32-bit). Joining by OID is the norm: <code>pg_attribute.attrelid → pg_class.oid</code>. The <strong>reg* types</strong> convert between names and OIDs automatically: <code>'orders'::regclass</code> yields the table OID (respecting search_path), and casting an OID column to <code>regclass</code> prints its (schema-qualified if needed) name. Others: <code>regtype</code>, <code>regnamespace</code>, <code>regrole</code>, <code>regproc</code>/<code>regprocedure</code>, <code>regoper</code>, <code>regcollation</code>.</p>
<h4>The core catalogs</h4>
<table>
<tr><th>Catalog</th><th>One row per…</th><th>Key columns</th></tr>
<tr><td><code>pg_namespace</code></td><td>schema</td><td>oid, nspname, nspowner</td></tr>
<tr><td><code>pg_class</code></td><td>relation: table, index, sequence, view, matview, partitioned table, TOAST table</td><td>oid, relname, relnamespace, relkind (r,i,S,v,m,p,I,t,f,c), reltuples, relpages, relfilenode, reloptions</td></tr>
<tr><td><code>pg_attribute</code></td><td>column (incl. system columns, attnum &lt; 0)</td><td>attrelid, attname, attnum, atttypid, attnotnull, attisdropped</td></tr>
<tr><td><code>pg_type</code></td><td>data type</td><td>oid, typname, typlen, typcategory</td></tr>
<tr><td><code>pg_constraint</code></td><td>constraint</td><td>conname, contype (p,f,u,c,x,n,t), conrelid, conkey, confrelid, confkey</td></tr>
<tr><td><code>pg_index</code></td><td>index (extra info)</td><td>indexrelid, indrelid, indkey, indisunique, indisprimary, indisvalid, indpred, indexprs</td></tr>
<tr><td><code>pg_proc</code></td><td>function/procedure</td><td>proname, prorettype, prokind</td></tr>
</table>
<p>Friendly views over these: <code>pg_tables</code>, <code>pg_views</code>, <code>pg_matviews</code>, <code>pg_indexes</code> (with the full CREATE INDEX text), <code>pg_sequences</code>, <code>pg_roles</code>, <code>pg_settings</code>. Note that since PostgreSQL 18, <code>NOT NULL</code> constraints are also recorded in <code>pg_constraint</code> with <code>contype = 'n'</code>.</p>`,
  why: `<p>Catalog fluency turns guesswork into precise answers: "which tables have no primary key?", "which foreign keys lack indexes?", "what depends on this column before I drop it?", "how big is each partition?". It is also how you build migration checks, linting in CI, documentation generators and monitoring.</p>`,
  useCase: `<p>A platform team runs 140 microservice databases. A nightly CI job connects to each and runs catalog queries that fail the build if: any table lacks a primary key, any foreign key lacks a supporting index, any column uses <code>timestamp</code> without time zone, any index is <code>indisvalid = false</code> (a failed CONCURRENTLY build), or any table has no comment. Within a quarter, schema-related incidents (missing indexes found in production) dropped to zero.</p>`,
  internals: `<p>Catalogs are regular heap tables with indexes (e.g. <code>pg_class_oid_index</code>, <code>pg_class_relname_nsp_index</code>), MVCC-versioned like any table — which is why DDL is transactional in PostgreSQL. Backends cache catalog rows in the <em>syscache</em> and relation descriptors in the <em>relcache</em>; DDL sends invalidation messages so other backends refresh their caches. Some catalogs are shared across the cluster (<code>pg_database</code>, <code>pg_authid</code>, <code>pg_tablespace</code>) and stored in <code>global/</code>. Heavy DDL churn (e.g. creating and dropping thousands of temp tables per minute) bloats catalogs like pg_class and pg_attribute and makes cache invalidations frequent — vacuum them like any table.</p>`,
  whenNot: `<p>Never modify catalogs directly with INSERT/UPDATE/DELETE (even as superuser) — use DDL. Writing to catalogs can corrupt the database in ways not caught until much later. For portable tools that must work across RDBMS products, prefer information_schema despite its limitations; for anything PostgreSQL-specific (indexes, storage, statistics), use pg_catalog.</p>`,
  syntax: `SELECT 'schema.table'::regclass;               -- name → OID (as regclass)
SELECT oid::regclass FROM pg_class ...;         -- OID → name
SELECT format_type(atttypid, atttypmod) FROM pg_attribute ...;
SELECT pg_get_constraintdef(oid) FROM pg_constraint ...;
SELECT pg_get_indexdef(indexrelid) FROM pg_index ...;
SELECT pg_get_viewdef('view'::regclass, true);
SELECT obj_description('t'::regclass, 'pg_class'), col_description('t'::regclass, 1);`,
  examples: [
    {
      label: 'Basic',
      title: 'Describe a table\'s columns from pg_attribute (what \\d does)',
      sql: `SELECT a.attnum,
       a.attname,
       format_type(a.atttypid, a.atttypmod)  AS data_type,
       a.attnotnull                           AS not_null,
       pg_get_expr(d.adbin, d.adrelid)        AS default_value,
       a.attidentity                          AS identity
FROM   pg_attribute a
LEFT   JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE  a.attrelid = 'orders'::regclass
  AND  a.attnum > 0
  AND  NOT a.attisdropped
ORDER  BY a.attnum;`,
      explain: `<p><code>'orders'::regclass</code> resolves the name to the table's OID. <code>attnum &gt; 0</code> excludes system columns (ctid, xmin… have negative attnums) and <code>attisdropped</code> hides dropped columns (which keep their slot). <code>format_type</code> renders the full type including typmod (e.g. <code>numeric(12,2)</code>), and <code>pg_get_expr</code> decompiles default expressions. <code>attidentity = 'a'</code> means GENERATED ALWAYS AS IDENTITY.</p>`,
      output: ` attnum | attname      | data_type                | not_null | default_value | identity
--------+--------------+--------------------------+----------+---------------+----------
      1 | id           | bigint                   | t        |               | a
      2 | customer_id  | integer                  | t        |               |
      3 | status       | text                     | t        |               |
      4 | order_date   | timestamp with time zone | t        |               |
      5 | total_amount | numeric(12,2)            | t        | 0             |`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Constraints and indexes of a table, decompiled',
      sql: `SELECT conname,
       contype,
       pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'orders'::regclass
  AND  contype <> 'n'                 -- skip NOT NULL entries (PG18 stores them here too)
ORDER  BY contype, conname;

SELECT i.indexrelid::regclass             AS index_name,
       i.indisunique                      AS is_unique,
       i.indisprimary                     AS is_primary,
       i.indisvalid                       AS is_valid,
       pg_get_indexdef(i.indexrelid)      AS definition
FROM   pg_index i
WHERE  i.indrelid = 'employees'::regclass
ORDER  BY 1;`,
      explain: `<p><code>contype</code>: p = primary key, f = foreign key, u = unique, c = check, x = exclusion, n = not-null (PG18), t = constraint trigger. <code>pg_get_constraintdef</code> and <code>pg_get_indexdef</code> return the exact DDL — perfect for generating migration scripts or documentation. <code>indisvalid = false</code> marks an index whose <code>CREATE INDEX CONCURRENTLY</code> failed: it is maintained on writes but never used by queries — find and drop/rebuild such indexes.</p>`,
      output: ` conname                 | contype | definition
-------------------------+---------+-------------------------------------------------------------
 orders_status_check     | c       | CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, ...])))
 orders_customer_id_fkey | f       | FOREIGN KEY (customer_id) REFERENCES customers(id)
 orders_pkey             | p       | PRIMARY KEY (id)

 index_name               | is_unique | is_primary | is_valid | definition
--------------------------+-----------+------------+----------+--------------------------------------------------------------
 employees_email_key      | t         | f          | t        | CREATE UNIQUE INDEX employees_email_key ON public.employees USING btree (email)
 employees_pkey           | t         | t          | t        | CREATE UNIQUE INDEX employees_pkey ON public.employees USING btree (id)
 idx_employees_department | f         | f          | t        | CREATE INDEX idx_employees_department ON public.employees USING btree (department_id)`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'pg_catalog vs information_schema for the same question',
      sql: `-- information_schema: portable, standard names, privilege-filtered
SELECT table_name, column_name, data_type, is_nullable, is_identity
FROM   information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'orders'
ORDER  BY ordinal_position;

-- pg_catalog: every relation kind in a schema with counts, by relkind
SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'i' THEN 'index'
                      WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view'
                      WHEN 'm' THEN 'materialized view' WHEN 'p' THEN 'partitioned table'
                      WHEN 'I' THEN 'partitioned index' ELSE c.relkind::text END AS kind,
       count(*) AS objects
FROM   pg_class c
WHERE  c.relnamespace = 'public'::regnamespace
GROUP  BY 1
ORDER  BY 2 DESC;

-- reg* casts in both directions
SELECT 'orders'::regclass::oid        AS orders_oid,
       ('orders'::regclass::oid)::regclass AS back_to_name,
       'numeric'::regtype::oid        AS numeric_type_oid,
       'public'::regnamespace::oid    AS public_schema_oid;`,
      explain: `<p>information_schema gives standard column names (<code>is_nullable = 'NO'</code>, <code>data_type = 'numeric'</code> without precision unless you read <code>numeric_precision</code>) and works similarly on other databases. The pg_catalog query uses <code>relkind</code>, which has no standard equivalent — information_schema does not know about indexes at all. The reg* casts show how names and OIDs convert without explicit joins; the OIDs in your database will differ.</p>`,
      output: ` table_name | column_name  | data_type                | is_nullable | is_identity
------------+--------------+--------------------------+-------------+-------------
 orders     | id           | bigint                   | NO          | YES
 orders     | customer_id  | integer                  | NO          | NO
 orders     | status       | text                     | NO          | NO
 orders     | order_date   | timestamp with time zone | NO          | NO
 orders     | total_amount | numeric                  | NO          | NO

 kind     | objects
----------+---------
 index    |      21
 table    |      12
 sequence |      11
 ...

 orders_oid | back_to_name | numeric_type_oid | public_schema_oid
------------+--------------+------------------+-------------------
      16517 | orders       |             1700 |              2200`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Looking up a table OID by name with a join, ignoring schema
SELECT a.attname
FROM   pg_attribute a
JOIN   pg_class c ON c.oid = a.attrelid
WHERE  c.relname = 'orders' AND a.attnum > 0;`, why: 'relname is not unique across schemas: a shop.orders table would silently add its columns to the result. It also returns dropped columns.', run: true },
    good: { sql: `SELECT attname
FROM   pg_attribute
WHERE  attrelid = 'public.orders'::regclass
  AND  attnum > 0 AND NOT attisdropped
ORDER  BY attnum;`, why: 'regclass resolves a (schema-qualified) name to exactly one OID and errors if it does not exist; filtering attisdropped hides dropped columns.', run: true }
  },
  mistakes: [
    `Filtering by <code>relname</code> only and getting objects from multiple schemas.`,
    `Forgetting <code>attnum &gt; 0 AND NOT attisdropped</code> when listing columns.`,
    `Expecting information_schema to show indexes, or to show objects you have no privileges on.`,
    `Hard-coding OIDs in scripts — they differ between databases and change after dump/restore.`,
    `Updating catalogs directly to "fix" something instead of using DDL.`
  ],
  best: [
    `Use <code>'name'::regclass</code> for lookups and <code>oid::regclass</code> for display.`,
    `Use the decompiling functions (<code>pg_get_*def</code>, <code>format_type</code>, <code>pg_get_expr</code>) rather than reconstructing DDL by hand.`,
    `Use information_schema for portable code, pg_catalog for PostgreSQL-specific tooling.`,
    `Run psql with <code>-E</code> (ECHO_HIDDEN) to see the catalog queries behind <code>\\d</code> commands — a great way to learn.`,
    `Add <code>COMMENT ON TABLE/COLUMN</code> and read them back with <code>obj_description</code>/<code>col_description</code> for self-documenting schemas.`
  ],
  performance: `<p>Catalog queries are usually instant, but databases with hundreds of thousands of relations (heavy partitioning, many schemas per tenant) make naive catalog scans and information_schema views slow; filter by namespace OID early and prefer pg_catalog. ORMs that introspect information_schema on every startup can take seconds on such databases.</p>`,
  security: `<p>Most catalogs are readable by every role — users can see the names and definitions of all tables, functions and views even without privileges on them (but not the data). Function source (<code>pg_proc.prosrc</code>) and view definitions are visible too, so never embed secrets in them. <code>pg_authid</code> (password hashes) is restricted to superusers; <code>pg_roles</code> is the safe view.</p>`,
  scenario: {
    title: 'Before dropping a column, find everything that depends on it',
    steps: [
      '1. Find the column\'s attnum: SELECT attnum FROM pg_attribute WHERE attrelid = \'orders\'::regclass AND attname = \'status\'.',
      '2. Query pg_depend for objects referencing (refobjid = table oid, refobjsubid = attnum): views, indexes, constraints, triggers.',
      '3. Check pg_index.indkey and indexprs/indpred for indexes using the column.',
      '4. Search pg_proc.prosrc for function bodies referencing it (not tracked by pg_depend for SQL/PLpgSQL bodies except SQL-standard function bodies).',
      '5. Plan the expand/contract migration accordingly.'
    ]
  },
  widgets: ['diagram:pg-arch'],
  interview: [
    { q: 'What is the difference between pg_catalog and information_schema?', a: 'pg_catalog contains PostgreSQL\'s actual system catalog tables, covering every feature including indexes and storage. information_schema is a set of SQL-standard views built on top of pg_catalog: portable across databases but limited (no indexes) and filtered by privileges, and usually slower.' },
    { q: 'What does regclass do?', a: 'It is an OID alias type for relations. Casting a text name to regclass resolves it (using search_path) to the relation\'s OID, raising an error if missing; casting an OID to regclass displays the name. It makes catalog queries concise and schema-safe.' },
    { q: 'How do you find invalid indexes?', a: 'SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid. They result from failed CREATE INDEX CONCURRENTLY or REINDEX CONCURRENTLY, are still maintained on writes but never used for reads, and should be dropped and rebuilt.' },
    { q: 'Why is DDL transactional in PostgreSQL?', a: 'Because the catalogs are ordinary MVCC tables. CREATE/ALTER/DROP insert, update or delete catalog rows inside the current transaction, so a ROLLBACK undoes them like any other change.' }
  ],
  exercises: [
    { task: 'List all schemas except system ones (pg_catalog, information_schema, pg_toast) with their owners.', solution: `SELECT nspname, nspowner::regrole AS owner
FROM   pg_namespace
WHERE  nspname NOT IN ('pg_catalog', 'information_schema')
  AND  nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'
ORDER  BY nspname;`, run: true },
    { task: 'List every foreign key in public with source table, referenced table and definition.', solution: `SELECT conrelid::regclass  AS from_table,
       confrelid::regclass AS to_table,
       conname,
       pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  contype = 'f' AND connamespace = 'public'::regnamespace
ORDER  BY 1, 2;`, run: true },
    { task: 'Use pg_indexes to list index names and definitions for order_items.', solution: `SELECT indexname, indexdef
FROM   pg_indexes
WHERE  schemaname = 'public' AND tablename = 'order_items';`, run: true }
  ],
  challenge: {
    task: 'Build a one-row-per-table "schema report" for public: table name, column count, has primary key, number of foreign keys, number of indexes, and estimated rows.',
    hint: 'Start from pg_class (relkind = r) and use scalar subqueries against pg_attribute, pg_constraint and pg_index.',
    solution: `SELECT c.relname AS table_name,
       (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)   AS columns,
       EXISTS (SELECT 1 FROM pg_constraint k
                WHERE k.conrelid = c.oid AND k.contype = 'p')               AS has_pk,
       (SELECT count(*) FROM pg_constraint k
         WHERE k.conrelid = c.oid AND k.contype = 'f')                      AS foreign_keys,
       (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid)           AS indexes,
       c.reltuples::bigint                                                  AS est_rows
FROM   pg_class c
WHERE  c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
ORDER  BY est_rows DESC;`,
    run: true
  },
  related: ['system-catalogs-statistics-views', 'system-catalogs-dba-toolkit', 'database-design', 'constraints'],
  quiz: [
    { type: 'mcq', q: 'Which catalog has one row per column?', options: ['pg_class', 'pg_attribute', 'pg_type', 'pg_column'], answer: 1, explain: 'pg_attribute: one row per column of every relation (including system columns with negative attnum).' },
    { type: 'tf', q: 'information_schema shows indexes in a standard view.', answer: false, explain: 'Indexes are not part of the SQL standard; use pg_index / pg_indexes.' },
    { type: 'predict', q: 'What does this return?', code: `SELECT 'orders'::regclass::oid::regclass;`, options: ['An OID number', 'orders', 'An error', 'NULL'], answer: 1, explain: 'Name → OID → back to regclass, which displays as the relation name.' },
    { type: 'mcq', q: 'In pg_class, what does relkind = \'p\' mean?', options: ['Primary key', 'Partitioned table', 'Procedure', 'Page'], answer: 1, explain: 'p = partitioned table; I = partitioned index; r = ordinary table; i = index.' },
    { type: 'write', q: 'Write a query listing all invalid indexes in the database.', solution: `SELECT indexrelid::regclass AS index_name, indrelid::regclass AS table_name
FROM pg_index
WHERE NOT indisvalid;`, explain: 'indisvalid = false marks indexes from failed concurrent builds.' }
  ]
},
{
  id: 'system-catalogs-statistics-views',
  module: 'system-catalogs',
  title: 'Statistics Views: pg_stat_user_tables, pg_stat_user_indexes, pg_statio_*, pg_stat_database, pg_stat_io and pg_stats',
  level: 4,
  minutes: 22,
  summary: 'Two kinds of statistics: cumulative activity counters (pg_stat_*, pg_statio_*, pg_stat_io) that tell you what happened, and planner statistics (pg_stats) that tell the optimizer what the data looks like.',
  objectives: [
    'Distinguish cumulative activity statistics from planner (data distribution) statistics',
    'Use pg_stat_user_tables for scans, tuple churn, HOT ratio and vacuum/analyze activity',
    'Use pg_stat_user_indexes and pg_statio_* for index usage and cache behaviour',
    'Read pg_stat_io (PG16+) by backend type, object and context',
    'Interpret pg_stats: null_frac, n_distinct, most_common_vals, histogram_bounds, correlation'
  ],
  concept: `<p>PostgreSQL keeps two completely different kinds of statistics:</p>
<ol>
<li><strong>Cumulative activity statistics</strong> — counters of what the server <em>did</em>: sequential scans, index scans, rows inserted/updated/deleted, blocks read vs hit, vacuums, IO operations. Views: <code>pg_stat_*</code>, <code>pg_statio_*</code>. Reset on crash or by <code>pg_stat_reset()</code>.</li>
<li><strong>Planner statistics</strong> — samples describing what the <em>data looks like</em>: fraction of NULLs, number of distinct values, most common values, histograms, physical correlation. Collected by <code>ANALYZE</code>/autovacuum into <code>pg_statistic</code>; readable through the <code>pg_stats</code> view. Used by the planner to estimate row counts.</li>
</ol>
<p><strong>Analogy:</strong> a supermarket. Activity statistics are the till receipts and footfall counters — how many customers visited each aisle (scans), how often shelves were restocked (vacuum). Planner statistics are the inventory survey — what share of products are dairy, the most common brands, the price range — which the manager uses to plan staffing before customers arrive.</p>
<h4>Key views</h4>
<table>
<tr><th>View</th><th>Highlights</th></tr>
<tr><td><code>pg_stat_user_tables</code></td><td>seq_scan, seq_tup_read, idx_scan, idx_tup_fetch, n_tup_ins/upd/del, n_tup_hot_upd, n_live_tup, n_dead_tup, n_mod_since_analyze, last_(auto)vacuum, last_(auto)analyze, vacuum/analyze counts, (PG18) total_vacuum_time etc.</td></tr>
<tr><td><code>pg_stat_user_indexes</code></td><td>idx_scan, last_idx_scan (PG16+), idx_tup_read, idx_tup_fetch</td></tr>
<tr><td><code>pg_statio_user_tables</code> / <code>_indexes</code></td><td>heap/idx/toast blocks read vs hit</td></tr>
<tr><td><code>pg_stat_database</code></td><td>per-database commits, rollbacks, blocks, tuples, temp files, deadlocks, sessions</td></tr>
<tr><td><code>pg_stat_io</code> (PG16+)</td><td>reads/writes/extends/hits/evictions/fsyncs per backend_type × object × context; PG18 adds byte columns</td></tr>
<tr><td><code>pg_stats</code></td><td>planner statistics per column: null_frac, avg_width, n_distinct, most_common_vals/freqs, histogram_bounds, correlation</td></tr>
<tr><td><code>pg_stats_ext</code></td><td>extended statistics (CREATE STATISTICS): dependencies, ndistinct, MCV lists over column groups</td></tr>
</table>`,
  why: `<p>Activity statistics answer operational questions: which tables are seq-scanned millions of times (missing index?), which indexes are never used (wasted writes), is autovacuum keeping up, are updates HOT. Planner statistics explain plan choices: when EXPLAIN shows "rows=50" but reality is 500,000, pg_stats tells you why.</p>`,
  useCase: `<p>A food-delivery company sees a dashboard query flip to a nested loop that takes minutes. <code>pg_stats</code> for <code>orders.city_id</code> shows <code>n_distinct = 40</code> and Bengaluru missing from <code>most_common_vals</code>, because a new city launch quadrupled its share after the last ANALYZE on a 2-billion-row table with default statistics target 100. Raising the column's statistics target to 1000 and running ANALYZE adds it to the MCV list; the estimate becomes accurate and the planner picks a hash join again. Meanwhile pg_stat_user_tables showed <code>n_mod_since_analyze</code> at 300M — the analyze scale factor was then lowered for that table.</p>`,
  internals: `<p>Activity counters are accumulated per backend and flushed to shared memory (PG15+). <code>n_live_tup</code>/<code>n_dead_tup</code> are estimates maintained from these counters and corrected by VACUUM/ANALYZE. Planner statistics come from ANALYZE taking a random sample of <code>300 × statistics_target</code> rows (30,000 rows by default) per table, computing per-column summaries stored in <code>pg_statistic</code> (with typed "slots" for MCVs, histograms and correlation). <code>pg_stats</code> is a view that decodes those slots and hides columns you lack SELECT privilege on. <code>pg_class.reltuples</code> and <code>relpages</code> also come from VACUUM/ANALYZE and feed every estimate.</p>`,
  whenNot: `<p>Do not use <code>n_live_tup</code> as an exact row count — use <code>count(*)</code> when accuracy matters, or <code>reltuples</code> for a cheap estimate. Do not reset stats casually; you lose history (e.g. evidence that an index is unused). And do not set huge statistics targets globally: ANALYZE gets slower and planning reads bigger stats for every query; raise targets per column where estimates are wrong.</p>`,
  syntax: `SELECT * FROM pg_stat_user_tables WHERE relname = 't';
SELECT * FROM pg_stat_user_indexes WHERE relname = 't';
SELECT * FROM pg_statio_user_tables WHERE relname = 't';
SELECT * FROM pg_stat_io;                         -- PG16+
SELECT * FROM pg_stats WHERE tablename = 't' AND attname = 'c';
ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000; ANALYZE t;
SELECT pg_stat_reset();                           -- current database counters`,
  examples: [
    {
      label: 'Basic',
      title: 'Table activity after running some queries',
      sql: `-- Generate some activity
SELECT count(*) FROM orders WHERE status = 'paid';             -- seq scan
SELECT * FROM orders WHERE id = 100;                            -- index scan
UPDATE orders SET status = status WHERE id BETWEEN 1 AND 50;     -- 50 updates
SELECT pg_stat_force_next_flush();                              -- flush this backend's counters now

SELECT relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
       n_tup_upd, n_tup_hot_upd, n_live_tup, n_dead_tup, n_mod_since_analyze
FROM   pg_stat_user_tables
WHERE  relname = 'orders';`,
      explain: `<p>Counters are normally flushed at most once per second when the transaction ends; <code>pg_stat_force_next_flush()</code> (PG15+) makes this backend's pending counters visible immediately — handy for demos and tests. You see one or more sequential scans (5,000 tuples each), index scans, 50 updates of which most are HOT (status is not indexed; the rest did not fit on their page), and about 50 dead tuples awaiting vacuum (page pruning may already have removed a few). Exact numbers depend on what else ran in this session.</p>`,
      output: ` relname | seq_scan | seq_tup_read | idx_scan | idx_tup_fetch | n_tup_upd | n_tup_hot_upd | n_live_tup | n_dead_tup | n_mod_since_analyze
---------+----------+--------------+----------+---------------+-----------+---------------+------------+------------+---------------------
 orders  |        1 |         5000 |        3 |            52 |        50 |            35 |          0 |         49 |                  50`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Planner statistics: what the optimizer believes about orders',
      sql: `SELECT attname,
       null_frac,
       avg_width,
       n_distinct,
       most_common_vals::text   AS mcv,
       most_common_freqs::text  AS mcv_freqs,
       correlation
FROM   pg_stats
WHERE  schemaname = 'public' AND tablename = 'orders'
  AND  attname IN ('status', 'customer_id', 'order_date');`,
      explain: `<p><code>status</code>: 5 distinct values, all in the MCV list with their frequencies (delivered ≈ 50%), so estimates for <code>status = 'paid'</code> are exact-ish. <code>customer_id</code>: <code>n_distinct = 500</code> (positive = absolute count; negative = fraction of rows, e.g. -1 = all distinct, as for <code>order_date</code>). <code>correlation</code> near 0 means physical row order is unrelated to value order — range scans on that column will touch pages randomly; near ±1 means well-clustered (good for BRIN and range index scans).</p>`,
      output: ` attname     | null_frac | avg_width | n_distinct | mcv                                        | mcv_freqs                         | correlation
-------------+-----------+-----------+------------+--------------------------------------------+-----------------------------------+---------------
 customer_id |         0 |         4 |        500 | {436,459,452,174,...}                       | {...}                             | -0.0052633337
 status      |         0 |         7 |          5 | {delivered,shipped,paid,cancelled,pending} | {0.5054,0.1644,0.1616,0.0856,0.083} |    0.33279178
 order_date  |         0 |         8 |         -1 |                                            |                                   | -0.0020410593`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'IO by backend type and context with pg_stat_io (PG16+)',
      sql: `SELECT backend_type,
       object,
       context,
       reads,
       pg_size_pretty(read_bytes)  AS read_bytes,     -- PG18
       writes,
       extends,
       hits,
       evictions,
       reuses
FROM   pg_stat_io
WHERE  coalesce(reads, 0) + coalesce(writes, 0) + coalesce(hits, 0) + coalesce(extends, 0) > 0
ORDER  BY coalesce(reads, 0) + coalesce(hits, 0) DESC;`,
      explain: `<p><code>pg_stat_io</code> breaks IO down by <em>who</em> (client backend, autovacuum worker, checkpointer, background writer…), <em>what</em> (relation, temp relation, WAL in PG18) and <em>context</em> (normal, vacuum, bulkread, bulkwrite, init). Useful patterns: client backends doing many <code>writes</code> in normal context means the background writer/checkpointer are not keeping up (backends write dirty buffers themselves); high <code>reuses</code> in bulkread shows ring buffers in action; <code>evictions</code> show cache pressure.</p>`,
      output: ` backend_type   | object   | context | reads | read_bytes | writes | extends | hits  | evictions | reuses
----------------+----------+---------+-------+------------+--------+---------+-------+-----------+--------
 client backend | relation | normal  |   117 | 936 kB     |    611 |     ... | 84909 |         0 |
 client backend | wal      | normal  |   886 | ...        |      1 |     ... |       |           |
 ...`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Using n_live_tup as an exact row count in application logic
SELECT n_live_tup AS row_count
FROM   pg_stat_user_tables
WHERE  relname = 'orders';`, why: 'n_live_tup is an estimate maintained by counters and corrected by VACUUM/ANALYZE; after a restore or crash it can be 0, and it drifts between vacuums.', run: true },
    good: { sql: `-- Exact when needed:
SELECT count(*) AS exact_rows FROM orders;
-- Cheap estimate for huge tables (planner's view):
SELECT reltuples::bigint AS estimated_rows FROM pg_class WHERE oid = 'orders'::regclass;`, why: 'count(*) is exact; reltuples is the planner\'s estimate maintained by VACUUM/ANALYZE — appropriate for "about how many rows" UI hints on very large tables.', run: true }
  },
  mistakes: [
    `Mixing up <code>pg_stats</code> (planner statistics) with <code>pg_stat_*</code> (activity counters).`,
    `Judging an index "unused" from <code>idx_scan = 0</code> right after a stats reset, a restart following a crash, or on a primary while the index is used only on replicas (stats are per server).`,
    `Ignoring <code>n_mod_since_analyze</code>: big changes since the last ANALYZE explain misestimates.`,
    `Raising <code>default_statistics_target</code> globally to 10000 and slowing every ANALYZE and plan.`,
    `Forgetting that replicas have their own activity statistics (index usage on read replicas does not appear on the primary).`
  ],
  best: [
    `Track <code>n_tup_hot_upd / n_tup_upd</code> per table; a low ratio on update-heavy tables suggests fillfactor or index changes.`,
    `Watch <code>seq_scan</code> growth on large tables together with <code>seq_tup_read</code> — the classic missing-index signal.`,
    `Use per-column <code>ALTER TABLE … ALTER COLUMN … SET STATISTICS</code> for skewed columns, and <code>CREATE STATISTICS</code> for correlated columns.`,
    `Snapshot statistics views into a history table or time-series store so you can compute rates and compare periods.`,
    `Check index usage on all replicas before dropping an "unused" index.`
  ],
  performance: `<p>Statistics collection overhead is small and always worth it. <code>track_io_timing</code> adds timing calls per IO (cheap on modern systems; verify with <code>pg_test_timing</code>), enabling read/write time in pg_stat_io, pg_stat_database and pg_stat_statements. Planner statistics quality directly determines plan quality; a stale or coarse histogram can cost orders of magnitude in runtime.</p>`,
  security: `<p><code>pg_stats</code> only shows columns the user can SELECT, because MCV lists and histograms reveal actual data values (e.g. common emails or salaries). Do not grant direct access to <code>pg_statistic</code>. Cumulative statistics views are broadly readable; query text in pg_stat_activity is restricted unless the role has <code>pg_read_all_stats</code>.</p>`,
  scenario: {
    title: 'A query\'s row estimate is off by 1000x',
    steps: [
      '1. EXPLAIN ANALYZE: find the node where estimated rows diverge from actual.',
      '2. Check pg_stat_user_tables.last_analyze / last_autoanalyze and n_mod_since_analyze for the table.',
      '3. Inspect pg_stats for the filtered columns: is the value in most_common_vals? Is n_distinct plausible?',
      '4. ANALYZE the table; if still wrong, raise the column statistics target and ANALYZE again.',
      '5. For predicates on several correlated columns, CREATE STATISTICS (dependencies, mcv) and ANALYZE.',
      '6. Re-check the plan and timing.'
    ]
  },
  widgets: ['lab:plan'],
  interview: [
    { q: 'What is the difference between pg_stats and pg_stat_user_tables?', a: 'pg_stats shows planner statistics about data distribution per column (null fraction, distinct count, MCVs, histograms, correlation) gathered by ANALYZE. pg_stat_user_tables shows cumulative activity counters (scans, tuple changes, vacuum/analyze activity) gathered as the server runs.' },
    { q: 'How would you find tables that probably need an index?', a: 'Look in pg_stat_user_tables for large tables with high seq_scan and seq_tup_read relative to idx_scan, then find the queries responsible (pg_stat_statements) and their filters, and confirm with EXPLAIN.' },
    { q: 'What does correlation in pg_stats mean?', a: 'The statistical correlation between the physical row order and the logical order of column values, from -1 to 1. Near ±1 means index range scans read pages mostly sequentially and BRIN works well; near 0 means scattered access, so the planner charges more random IO.' },
    { q: 'What is pg_stat_io used for?', a: 'Introduced in PG16, it reports IO operations (reads, writes, extends, hits, evictions, reuses, fsyncs, and timings with track_io_timing) per backend type, object and context. It shows, for example, whether backends write dirty buffers themselves or how much IO autovacuum or checkpoints perform.' }
  ],
  exercises: [
    { task: 'Show, for every user table, the HOT update percentage.', solution: `SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM   pg_stat_user_tables
ORDER  BY n_tup_upd DESC;`, run: true },
    { task: 'Show null_frac and n_distinct for every column of customers from pg_stats.', solution: `SELECT attname, null_frac, n_distinct
FROM   pg_stats
WHERE  schemaname = 'public' AND tablename = 'customers'
ORDER  BY attname;`, run: true },
    { task: 'Raise the statistics target of orders.customer_id to 500, ANALYZE, and show how many MCVs are now stored.', solution: `ALTER TABLE orders ALTER COLUMN customer_id SET STATISTICS 500;
ANALYZE orders;
SELECT attname, array_length(most_common_vals::text::text[], 1) AS mcv_count
FROM   pg_stats
WHERE  tablename = 'orders' AND attname = 'customer_id';`, run: true }
  ],
  challenge: {
    task: 'Compare the planner\'s estimate with reality for status = \'paid\' on orders: compute the estimate from pg_stats (MCV frequency × reltuples) and the actual count, and show the ratio.',
    hint: 'Use array_position on most_common_vals (cast to text[]) to find the matching frequency.',
    solution: `WITH s AS (
  SELECT most_common_vals::text::text[] AS vals, most_common_freqs AS freqs
  FROM   pg_stats
  WHERE  schemaname = 'public' AND tablename = 'orders' AND attname = 'status'
)
SELECT round(freqs[array_position(vals, 'paid')] *
             (SELECT reltuples FROM pg_class WHERE oid = 'orders'::regclass)) AS estimated,
       (SELECT count(*) FROM orders WHERE status = 'paid')                   AS actual,
       round((freqs[array_position(vals, 'paid')] *
             (SELECT reltuples FROM pg_class WHERE oid = 'orders'::regclass)
             / (SELECT count(*) FROM orders WHERE status = 'paid'))::numeric, 3) AS ratio
FROM   s;`,
    run: true
  },
  related: ['system-catalogs-pg-catalog', 'system-catalogs-dba-toolkit', 'monitoring-health-metrics', 'query-optimization'],
  quiz: [
    { type: 'mcq', q: 'Which view shows most_common_vals for a column?', options: ['pg_stat_user_tables', 'pg_stats', 'pg_statio_user_tables', 'pg_stat_io'], answer: 1, explain: 'pg_stats exposes planner statistics, including MCV lists and histograms.' },
    { type: 'mcq', q: 'n_distinct = -1 for a column means…', options: ['Unknown', 'All values are distinct (distinct count scales with rows)', 'One distinct value', 'All values NULL'], answer: 1, explain: 'Negative n_distinct is a fraction of row count; -1 means every row has a unique value.' },
    { type: 'tf', q: 'Activity statistics in pg_stat_user_tables survive a crash.', answer: false, explain: 'They are written at clean shutdown only; after crash recovery they are reset.' },
    { type: 'scenario', q: 'An index shows idx_scan = 0 on the primary. Before dropping it you should…', options: ['Drop it immediately', 'Check it is not a unique/PK/constraint index, check replicas\' stats and how long stats have accumulated', 'REINDEX it', 'Run ANALYZE'], answer: 1, explain: 'Stats are per server and since the last reset; unique indexes enforce constraints even with zero scans.' }
  ]
},
{
  id: 'system-catalogs-dba-toolkit',
  module: 'system-catalogs',
  title: 'DBA Query Toolkit: Sizes, Missing FK Indexes, Unused and Duplicate Indexes, Tables Without Primary Keys',
  level: 4,
  minutes: 25,
  summary: 'A battle-tested set of catalog queries every DBA keeps in a runbook — all runnable on company_db: table sizes, foreign keys without indexes, unused and duplicate indexes, tables lacking primary keys, invalid indexes and more.',
  objectives: [
    'List tables with heap, index and total sizes in one query',
    'Find foreign keys without a supporting index (multi-column aware)',
    'Find unused indexes safely (excluding unique/PK and constraint indexes)',
    'Find duplicate and redundant (prefix) indexes',
    'Find tables without primary keys and invalid indexes'
  ],
  concept: `<p>Most schema problems in production are not exotic: a foreign key without an index, an index nobody uses but every write pays for, two identical indexes created by two developers, a table without a primary key that breaks logical replication. Each can be found with one catalog query. This lesson is your toolkit — copy it into your runbook.</p>
<p><strong>Analogy:</strong> a building inspection checklist. The inspector does not redesign the building; they walk through a list — fire exits, wiring, load-bearing walls — and flag deviations. These queries are the checklist for a PostgreSQL schema.</p>
<h4>The checklist</h4>
<ol>
<li><strong>Sizes</strong> — where is the space going? (pg_class + size functions)</li>
<li><strong>Foreign keys without indexes</strong> — every FK on the referencing side should usually have an index whose leading columns match; otherwise deleting/updating the parent row seq-scans the child table (under lock), and joins are slow.</li>
<li><strong>Unused indexes</strong> — <code>idx_scan = 0</code> over a long observation window, excluding indexes that enforce constraints (PK, unique, exclusion).</li>
<li><strong>Duplicate indexes</strong> — same table, same columns, same opclasses, same expressions and predicate.</li>
<li><strong>Redundant prefix indexes</strong> — an index on <code>(a)</code> is usually redundant when <code>(a, b)</code> exists (B-tree).</li>
<li><strong>Tables without primary keys</strong> — no reliable identity; logical replication cannot replicate UPDATE/DELETE without a replica identity.</li>
<li><strong>Invalid indexes</strong> — leftovers of failed concurrent builds.</li>
</ol>
<p>In company_db several FK indexes are deliberately missing (e.g. <code>orders.customer_id</code>, <code>payments.order_id</code>) — the toolkit will find them.</p>`,
  why: `<p>These checks catch the problems that cause the most common production incidents and wasted spend: lock-heavy cascades because of unindexed FKs, write amplification and bloated backups from useless indexes, and replication/migration surprises from missing primary keys. Running them weekly (or in CI) is cheap insurance.</p>`,
  useCase: `<p>A B2B SaaS deletes a tenant: <code>DELETE FROM accounts WHERE id = …</code> with <code>ON DELETE CASCADE</code> to 14 child tables. It runs for 47 minutes and blocks writes, because 6 child FK columns are unindexed — each cascade step seq-scans a multi-GB table. The missing-FK-index query found all 6; after adding them with <code>CREATE INDEX CONCURRENTLY</code>, tenant deletion takes 3 seconds. The same review found 31 unused indexes (110GB) whose removal reduced WAL volume by 18%.</p>`,
  internals: `<p><code>pg_index.indkey</code> is an <code>int2vector</code> of column numbers (0 for expression columns), zero-based when cast to <code>int2[]</code>; <code>pg_constraint.conkey</code> is a normal one-based <code>int2[]</code>. An FK is "covered" if some index's leading <code>n</code> key columns are exactly the FK's <code>n</code> columns (in any order for equality lookups). Duplicate detection groups by <code>indrelid, indkey, indclass, indcollation, indexprs, indpred</code>. Index-usage counters (<code>idx_scan</code>) are per server and reset with stats — always know your observation window (<code>pg_stat_database.stats_reset</code>).</p>`,
  whenNot: `<p>Do not drop an index just because <code>idx_scan = 0</code>: it may enforce uniqueness, be used only on a replica, only by a monthly job, or stats may have been reset recently. Do not blindly index every FK on tiny lookup tables where parent deletes never happen and the child is small. Use these queries to <em>find candidates</em>, then decide with context.</p>`,
  syntax: `-- building blocks used by the toolkit
pg_class, pg_namespace, pg_index (indkey, indisunique, indisprimary, indisvalid),
pg_constraint (contype = 'f', conkey, conrelid), pg_stat_user_indexes (idx_scan),
pg_relation_size(), pg_total_relation_size(), pg_indexes_size(), pg_size_pretty()`,
  examples: [
    {
      label: 'Basic',
      title: 'Tables with sizes and row estimates; tables without a primary key',
      sql: `SELECT c.relname                                       AS table_name,
       c.reltuples::bigint                             AS est_rows,
       pg_size_pretty(pg_relation_size(c.oid))         AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))          AS indexes,
       pg_size_pretty(pg_total_relation_size(c.oid))   AS total
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER  BY pg_total_relation_size(c.oid) DESC;

-- Tables without a primary key (create one to see it reported)
CREATE TABLE import_staging (raw_line text, loaded_at timestamptz DEFAULT now());

SELECT n.nspname AS schema, c.relname AS table_without_pk
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  c.relkind IN ('r', 'p')
  AND  n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND  n.nspname NOT LIKE 'pg_toast%'
  AND  NOT EXISTS (SELECT 1 FROM pg_constraint k
                   WHERE k.conrelid = c.oid AND k.contype = 'p')
ORDER  BY 1, 2;`,
      explain: `<p>The size report includes partitioned tables (<code>relkind = 'p'</code>) — for those, sum partitions with <code>pg_partition_tree()</code>. All company_db tables have primary keys, so we create <code>import_staging</code> to show the second query catching one. In production, staging/log tables without PKs are the usual offenders; they also lack a replica identity for logical replication.</p>`,
      output: ` table_name        | est_rows | heap       | indexes | total
-------------------+----------+------------+---------+---------
 order_items       |    12500 | 832 kB     | 512 kB  | 1368 kB
 orders            |     5000 | 712 kB     | 240 kB  | 984 kB
 payments          |     4585 | 352 kB     | 120 kB  | 504 kB
 ... (12 rows)

 schema | table_without_pk
--------+------------------
 public | import_staging`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Foreign keys without a supporting index (multi-column aware)',
      sql: `SELECT c.conrelid::regclass                         AS table_name,
       c.conname                                     AS fk_name,
       (SELECT string_agg(a.attname, ', ' ORDER BY x.ord)
          FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum)
                                                     AS fk_columns,
       c.confrelid::regclass                         AS referenced_table,
       pg_size_pretty(pg_relation_size(c.conrelid))  AS table_size,
       format('CREATE INDEX CONCURRENTLY ON %s (%s);',
              c.conrelid::regclass,
              (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY x.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum))
                                                     AS suggested_ddl
FROM   pg_constraint c
WHERE  c.contype = 'f'
  AND  NOT EXISTS (
         SELECT 1
         FROM   pg_index i
         WHERE  i.indrelid = c.conrelid
           AND  i.indpred IS NULL
           -- the first N index columns must be exactly the FK columns (any order)
           AND  (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
           AND  (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey)
ORDER  BY pg_relation_size(c.conrelid) DESC;`,
      explain: `<p>For each FK, we check whether any non-partial index starts with exactly the FK's columns: <code>indkey</code> cast to <code>int2[]</code> is zero-based, so the slice <code>[0:n-1]</code> is the first n index columns; mutual containment (<code>@&gt;</code> and <code>&lt;@</code>) means "same set". The composite PK of <code>employee_projects (employee_id, project_id)</code> covers the employee_id FK but not project_id. The query even generates the DDL. Biggest tables first — those are where missing indexes hurt most.</p>`,
      output: ` table_name        | fk_name                           | fk_columns    | referenced_table | table_size | suggested_ddl
-------------------+-----------------------------------+---------------+------------------+------------+-------------------------------------------------------------
 order_items       | order_items_product_id_fkey       | product_id    | products         | 832 kB     | CREATE INDEX CONCURRENTLY ON order_items (product_id);
 orders            | orders_customer_id_fkey           | customer_id   | customers        | 712 kB     | CREATE INDEX CONCURRENTLY ON orders (customer_id);
 payments          | payments_order_id_fkey            | order_id      | orders           | 352 kB     | CREATE INDEX CONCURRENTLY ON payments (order_id);
 employees         | employees_manager_id_fkey         | manager_id    | employees        | 24 kB      | CREATE INDEX CONCURRENTLY ON employees (manager_id);
 employee_projects | employee_projects_project_id_fkey | project_id    | projects         | 16 kB      | CREATE INDEX CONCURRENTLY ON employee_projects (project_id);
 projects          | projects_department_id_fkey       | department_id | departments      | 8192 bytes | CREATE INDEX CONCURRENTLY ON projects (department_id);`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Unused, duplicate and invalid indexes',
      sql: `-- Create a duplicate to detect (rolled back afterwards in the playground)
CREATE INDEX idx_employees_dept_copy ON employees (department_id);

-- 1) Unused indexes: never scanned, not enforcing a constraint
SELECT s.relname                                   AS table_name,
       s.indexrelname                              AS index_name,
       s.idx_scan,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
       (SELECT stats_reset FROM pg_stat_database
         WHERE datname = current_database())       AS stats_since
FROM   pg_stat_user_indexes s
JOIN   pg_index i ON i.indexrelid = s.indexrelid
WHERE  s.idx_scan = 0
  AND  NOT i.indisunique
  AND  NOT i.indisprimary
  AND  NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = s.indexrelid)
ORDER  BY pg_relation_size(s.indexrelid) DESC;

-- 2) Exact duplicates: same columns, opclasses, collations, expressions and predicate
SELECT i.indrelid::regclass                        AS table_name,
       array_agg(i.indexrelid::regclass ORDER BY i.indexrelid) AS duplicate_indexes,
       pg_size_pretty(sum(pg_relation_size(i.indexrelid)))     AS combined_size
FROM   pg_index i
GROUP  BY i.indrelid, i.indkey::text, i.indclass::text, i.indcollation::text,
          coalesce(i.indexprs::text, ''), coalesce(i.indpred::text, '')
HAVING count(*) > 1;

-- 3) Invalid indexes (failed CREATE INDEX CONCURRENTLY)
SELECT indexrelid::regclass AS invalid_index, indrelid::regclass AS table_name
FROM   pg_index
WHERE  NOT indisvalid;`,
      explain: `<p><strong>Unused:</strong> we exclude unique/PK indexes and anything backing a constraint (<code>conindid</code>), and show <code>stats_since</code> so you know the observation window — on the freshly restored playground everything shows 0 scans, which is exactly why you need a long window (weeks, including month-end jobs) and replica checks before dropping. <strong>Duplicates:</strong> grouping on the full index identity finds our deliberately created copy next to <code>idx_employees_department</code>. <strong>Invalid:</strong> none here; in production drop and recreate them.</p>`,
      output: ` table_name  | index_name               | idx_scan | index_size | stats_since
-------------+--------------------------+----------+------------+-------------
 order_items | idx_order_items_order    |        0 | 216 kB     | ...
 employees   | idx_employees_department |        0 | 16 kB      | ...
 documents   | idx_documents_search     |        0 | 16 kB      | ...
 employees   | idx_employees_dept_copy  |        0 | 16 kB      | ...

 table_name | duplicate_indexes                                  | combined_size
------------+----------------------------------------------------+---------------
 employees  | {idx_employees_department,idx_employees_dept_copy} | 32 kB

 invalid_index | table_name
---------------+------------
(0 rows)`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- "Find FKs without indexes" by column name only
SELECT tc.table_name, kcu.column_name
FROM   information_schema.table_constraints tc
JOIN   information_schema.key_column_usage kcu USING (constraint_name, table_schema)
WHERE  tc.constraint_type = 'FOREIGN KEY'
  AND  kcu.column_name NOT IN (SELECT indexdef FROM pg_indexes);`, why: 'Compares column names to full CREATE INDEX strings (never equal), ignores multi-column FKs and column positions, so it reports every FK — or nothing useful. Pattern-matching on text is fragile.', run: true },
    good: { sql: `SELECT c.conrelid::regclass AS table_name, c.conname
FROM   pg_constraint c
WHERE  c.contype = 'f'
  AND  NOT EXISTS (SELECT 1 FROM pg_index i
                   WHERE i.indrelid = c.conrelid
                     AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
                     AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey);`, why: 'Works with column numbers from the catalogs, checks that the FK columns are the leading index columns, and handles multi-column keys.', run: true }
  },
  mistakes: [
    `Dropping indexes with <code>idx_scan = 0</code> without checking replicas, the stats window, or whether they back a constraint.`,
    `Treating an index on <code>(b, a)</code> as covering an FK on <code>(a)</code> — the FK column must be a leading column.`,
    `Creating indexes from the toolkit's suggestions without <code>CONCURRENTLY</code> on busy production tables.`,
    `Dropping a "duplicate" that is actually different (different opclass, collation, predicate or INCLUDE columns).`,
    `Running the toolkit only once; schemas drift — schedule it.`
  ],
  best: [
    `Run the toolkit weekly and in CI against a migrated test database; fail builds on missing PKs and unindexed FKs above a size threshold.`,
    `Before dropping an unused index, record its definition (<code>pg_get_indexdef</code>) so you can recreate it; drop with <code>DROP INDEX CONCURRENTLY</code>.`,
    `Prefer one composite index that serves several queries over many overlapping single-column ones.`,
    `Keep the stats window known: note <code>stats_reset</code> and avoid ad-hoc resets.`,
    `Every table gets a primary key (identity column or natural key) — no exceptions for "temporary" tables that live for years.`
  ],
  performance: `<p>Each index adds write cost (every INSERT, and every non-HOT UPDATE, must update it), WAL volume, vacuum work, and memory pressure in shared_buffers. Unused indexes are pure overhead; duplicates double it. Missing FK indexes make parent DELETE/UPDATE and joins scan the child table — and cascading deletes do this under locks. Toolkit queries themselves are catalog-only and fast, except size functions over very many relations.</p>`,
  security: `<p>The toolkit only reads catalogs and statistics; a role with <code>pg_monitor</code> can run it. Executing the suggested DDL requires table ownership — have it reviewed and applied through your migration process rather than by the monitoring role.</p>`,
  scenario: {
    title: 'Deleting a customer takes 40 seconds and blocks orders',
    steps: [
      '1. Run the FK-without-index query; find child tables referencing customers without an index on the FK column.',
      '2. Confirm with EXPLAIN ANALYZE DELETE ... inside a transaction you roll back: look for long "Trigger for constraint" times.',
      '3. CREATE INDEX CONCURRENTLY on each child FK column (with lock_timeout and retries).',
      '4. Re-test the delete; cascades now use index lookups.',
      '5. Add the FK-index check to CI to prevent regressions.'
    ]
  },
  widgets: ['lab:index'],
  interview: [
    { q: 'Why should foreign key columns usually be indexed?', a: 'PostgreSQL automatically indexes the referenced (parent) key but not the referencing (child) columns. Without an index, every DELETE or key UPDATE on the parent must scan the child table to check or cascade, holding locks, and joins on the FK are slow.' },
    { q: 'How do you safely identify unused indexes?', a: 'Use pg_stat_user_indexes.idx_scan = 0 over a long, known window (check stats_reset), exclude unique/primary/constraint-backing indexes, check every replica\'s statistics too, and consider rare jobs. Save the definition, then drop with DROP INDEX CONCURRENTLY.' },
    { q: 'What makes two indexes duplicates?', a: 'Same table, same key columns in the same order, same operator classes and collations, same expressions and same partial predicate (and same INCLUDE columns). Indexes on (a) and (a, b) are not duplicates but (a) is often redundant for B-tree.' },
    { q: 'Why does every table need a primary key?', a: 'It guarantees row identity for updates/deletes and application logic, enables efficient lookups and joins, and is required (or a replica identity is) for logical replication to replicate UPDATE and DELETE. Tools like pg_repack also need one.' }
  ],
  exercises: [
    { task: 'Find all indexes larger than their table (index bloat or over-indexing hint).', solution: `SELECT i.indrelid::regclass AS table_name,
       i.indexrelid::regclass AS index_name,
       pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
       pg_size_pretty(pg_relation_size(i.indrelid))   AS table_size
FROM   pg_index i
JOIN   pg_class c ON c.oid = i.indrelid
WHERE  c.relnamespace = 'public'::regnamespace
  AND  pg_relation_size(i.indexrelid) > pg_relation_size(i.indrelid);`, run: true },
    { task: 'Create the missing index on payments(order_id) and re-run a check that the payments FK is now covered.', solution: `CREATE INDEX idx_payments_order ON payments (order_id);
SELECT c.conname,
       EXISTS (SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.conrelid
                 AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
                 AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey) AS covered
FROM   pg_constraint c
WHERE  c.conrelid = 'payments'::regclass AND c.contype = 'f';`, run: true },
    { task: 'List tables in public that have no indexes at all other than the primary key.', solution: `SELECT c.relname
FROM   pg_class c
WHERE  c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  AND  NOT EXISTS (SELECT 1 FROM pg_index i
                   WHERE i.indrelid = c.oid AND NOT i.indisprimary)
ORDER  BY 1;`, run: true }
  ],
  challenge: {
    task: 'Find redundant prefix indexes: B-tree indexes whose key columns are a leading prefix of another B-tree index on the same table (e.g. (a) when (a, b) exists). Create employees(department_id, job_title) first so the existing idx_employees_department is reported. Exclude unique indexes from the "redundant" side.',
    hint: 'Self-join pg_index on indrelid; compare the shorter indkey (as text) with the start of the longer one, ensure both use btree via pg_class.relam / pg_am.',
    solution: `CREATE INDEX idx_emp_dept_title ON employees (department_id, job_title);
SELECT a.indrelid::regclass  AS table_name,
       a.indexrelid::regclass AS redundant_index,
       b.indexrelid::regclass AS covered_by,
       pg_size_pretty(pg_relation_size(a.indexrelid)) AS reclaimable
FROM   pg_index a
JOIN   pg_index b ON b.indrelid = a.indrelid AND b.indexrelid <> a.indexrelid
JOIN   pg_class ca ON ca.oid = a.indexrelid
JOIN   pg_class cb ON cb.oid = b.indexrelid
JOIN   pg_am am ON am.oid = ca.relam AND am.amname = 'btree'
WHERE  cb.relam = ca.relam
  AND  NOT a.indisunique
  AND  a.indpred IS NULL AND b.indpred IS NULL
  AND  a.indexprs IS NULL AND b.indexprs IS NULL
  AND  a.indnkeyatts < b.indnkeyatts
  AND  (b.indkey::int2[])[0:a.indnkeyatts - 1] = (a.indkey::int2[])[0:a.indnkeyatts - 1];`,
    run: true
  },
  related: ['system-catalogs-pg-catalog', 'system-catalogs-statistics-views', 'indexes', 'advanced-indexing', 'monitoring-health-metrics'],
  quiz: [
    { type: 'mcq', q: 'Which index covers a foreign key on child(parent_id)?', options: ['child(created_at, parent_id)', 'child(parent_id, created_at)', 'A partial index on child(parent_id) WHERE deleted = false (always)', 'parent(id)'], answer: 1, explain: 'The FK column must be the leading column. A partial index only covers rows matching its predicate, so it may not serve the FK check.' },
    { type: 'tf', q: 'A unique index with idx_scan = 0 is safe to drop.', answer: false, explain: 'It enforces uniqueness on every insert/update even if never used for reads.' },
    { type: 'index', q: 'orders has indexes (customer_id) and (customer_id, order_date). Which is likely redundant?', options: ['(customer_id, order_date)', '(customer_id)', 'Neither', 'Both'], answer: 1, explain: 'A B-tree on (customer_id, order_date) serves lookups on customer_id alone; the single-column index is usually redundant (it is smaller, so keep it only if measurably better).' },
    { type: 'scenario', q: 'The duplicate-index query reports two indexes with the same columns, but one has a WHERE clause. Action?', options: ['Drop either', 'They are not duplicates — the query should group by predicate too', 'Drop the partial one', 'Reindex both'], answer: 1, explain: 'Different predicates (or opclasses/collations/expressions) mean different indexes; a correct duplicate query groups on all of them.' }
  ]
}
]);

/* --------------------------- CONFIGURATION --------------------------- */
PGM.addLessons([
{
  id: 'configuration-files-contexts',
  module: 'configuration',
  title: 'Configuration Files and Parameter Contexts: postgresql.conf, auto.conf, pg_hba.conf, pg_ident.conf',
  level: 4,
  minutes: 22,
  summary: 'Where PostgreSQL configuration lives, how files are layered (include, postgresql.auto.conf), how client authentication is configured in pg_hba.conf/pg_ident.conf, and what parameter contexts (postmaster, sighup, superuser, user...) mean for changing a setting.',
  objectives: [
    'Locate config files with SHOW config_file / hba_file / ident_file',
    'Explain the precedence of postgresql.conf, include files and postgresql.auto.conf',
    'Read pg_hba.conf rules (type, database, user, address, method) and pg_ident.conf mappings',
    'Classify parameters by context using pg_settings',
    'Diagnose configuration errors with pg_file_settings and pg_hba_file_rules'
  ],
  concept: `<p>PostgreSQL's server configuration is read from plain-text files:</p>
<ul>
<li><code>postgresql.conf</code> — the main file: <code>name = value</code> lines, comments with <code>#</code>. Supports <code>include 'file'</code>, <code>include_if_exists</code> and <code>include_dir 'conf.d'</code> (files read in name order).</li>
<li><code>postgresql.auto.conf</code> — written <strong>only</strong> by <code>ALTER SYSTEM</code>; read <em>after</em> postgresql.conf, so its values win. Never edit it by hand while the server runs.</li>
<li><code>pg_hba.conf</code> — host-based authentication: which clients may connect to which databases as which users from which addresses, using which method (<code>scram-sha-256</code>, <code>cert</code>, <code>peer</code>, <code>ldap</code>, <code>reject</code>…). First matching line wins.</li>
<li><code>pg_ident.conf</code> — user-name maps: map OS or certificate names to database role names (used with <code>peer</code>, <code>ident</code>, <code>cert</code>, <code>gss</code> methods via <code>map=</code>).</li>
</ul>
<p><strong>Analogy:</strong> a company policy binder. <code>postgresql.conf</code> is the official policy; include files are department appendices; <code>postgresql.auto.conf</code> is the sticky-note amendments the CEO adds with <code>ALTER SYSTEM</code> (they override the binder). <code>pg_hba.conf</code> is the security desk's guest list — checked top to bottom, first match decides. <code>pg_ident.conf</code> is the badge-to-employee mapping.</p>
<h4>Parameter contexts (pg_settings.context)</h4>
<table>
<tr><th>Context</th><th>How it can change</th><th>Examples</th></tr>
<tr><td><code>internal</code></td><td>Never (compile/initdb time)</td><td>block_size, data_checksums, segment_size</td></tr>
<tr><td><code>postmaster</code></td><td>Server restart only</td><td>shared_buffers, max_connections, listen_addresses, wal_level, io_method</td></tr>
<tr><td><code>sighup</code></td><td>Config file + reload (no per-session SET)</td><td>max_wal_size, checkpoint_timeout, autovacuum_*, log_line_prefix</td></tr>
<tr><td><code>superuser-backend</code> / <code>backend</code></td><td>File + reload, or at connection start; affects new sessions</td><td>log_connections, log_disconnections</td></tr>
<tr><td><code>superuser</code></td><td>SET by superusers (or roles granted SET on the parameter)</td><td>log_min_duration_statement, log_lock_waits, wal_compression</td></tr>
<tr><td><code>user</code></td><td>Any role can SET in its session</td><td>work_mem, statement_timeout, search_path, random_page_cost</td></tr>
</table>`,
  why: `<p>Configuration mistakes are among the most common causes of outages: a typo that stops the server from starting after a restart, a parameter changed in the wrong file and silently overridden by <code>postgresql.auto.conf</code>, a <code>pg_hba.conf</code> rule ordering that lets everyone in with <code>trust</code> or locks the application out. Knowing the files and contexts lets you change settings safely and predictably.</p>`,
  useCase: `<p>A DBA raises <code>max_wal_size</code> in <code>postgresql.conf</code> and reloads, but checkpoints remain frequent. <code>SELECT name, setting, sourcefile, sourceline FROM pg_settings WHERE name = 'max_wal_size'</code> reveals the active value comes from <code>postgresql.auto.conf</code> — a colleague had run <code>ALTER SYSTEM</code> months earlier. They standardise: all tuning via configuration management into <code>conf.d/</code> files, and <code>ALTER SYSTEM</code> only for emergencies (later copied back into the managed files and reset with <code>ALTER SYSTEM RESET</code>).</p>`,
  internals: `<p>At startup and on SIGHUP (reload), the postmaster parses all files; each child process re-reads them on its next idle point after a reload signal. Invalid lines are reported in the log and in <code>pg_file_settings.error</code>; on reload, a file with errors is ignored as a whole for sighup-level changes (the old values stay). <code>pg_settings</code> shows the effective value per session with <code>source</code> (default, configuration file, command line, database, user, session, override…), <code>sourcefile</code>/<code>sourceline</code>, and <code>pending_restart</code> when a postmaster-level value in the file differs from the running one. <code>pg_hba.conf</code> is loaded into memory by the postmaster on start/reload; <code>pg_hba_file_rules</code> shows the parsed rules and errors, so you can validate edits before reloading. Since PG16, pg_hba.conf and pg_ident.conf also support <code>include</code> directives and regular expressions for database and user fields.</p>`,
  whenNot: `<p>Do not edit <code>postgresql.auto.conf</code> manually. Do not put application-specific settings (like a role's <code>search_path</code> or <code>statement_timeout</code>) in postgresql.conf when they belong to one role or database — use <code>ALTER ROLE/DATABASE … SET</code>. On managed services (RDS, Cloud SQL, Azure) you do not have file access: use parameter groups/flags and their supported parameter list.</p>`,
  syntax: `SHOW config_file;   SHOW hba_file;   SHOW ident_file;   SHOW data_directory;

-- postgresql.conf
include_dir 'conf.d'          # e.g. conf.d/10-memory.conf, conf.d/20-wal.conf
shared_buffers = 16GB

-- pg_hba.conf:  TYPE  DATABASE  USER  ADDRESS  METHOD  [OPTIONS]
hostssl  shop  app_user  10.0.0.0/16  scram-sha-256
local    all   postgres               peer

-- pg_ident.conf: MAPNAME  SYSTEM-USERNAME  PG-USERNAME
ops   deploy   app_admin`,
  examples: [
    {
      label: 'Basic',
      title: 'Where are the configuration files and where did each value come from?',
      sql: `SELECT current_setting('config_file')     AS config_file,
       current_setting('hba_file')        AS hba_file,
       current_setting('ident_file')      AS ident_file,
       current_setting('data_directory')  AS data_directory;

SELECT name, setting, unit, source, sourcefile, sourceline
FROM   pg_settings
WHERE  source NOT IN ('default', 'override')
ORDER  BY source, name;`,
      explain: `<p>The first query locates the files (on Debian/Ubuntu they live under <code>/etc/postgresql/&lt;version&gt;/main/</code>; on RHEL-based systems inside PGDATA). The second lists every parameter not at its built-in default and <em>where</em> it was set — the fastest way to audit a server's configuration. (Values below are from the playground's embedded server.)</p>`,
      output: ` config_file                  | hba_file                 | ident_file                 | data_directory
------------------------------+--------------------------+----------------------------+----------------
 /pglite/data/postgresql.conf | /pglite/data/pg_hba.conf | /pglite/data/pg_ident.conf | /pglite/data

 name            | setting | unit | source             | sourcefile                   | sourceline
-----------------+---------+------+--------------------+------------------------------+------------
 ...             |         |      | command line       |                              |
 max_connections | 100     |      | configuration file | /pglite/data/postgresql.conf |         65
 shared_buffers  | 16384   | 8kB  | configuration file | /pglite/data/postgresql.conf |        132
 ...`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Parameter contexts: what needs a restart vs a reload vs nothing?',
      sql: `SELECT context, count(*) AS parameters
FROM   pg_settings
GROUP  BY context
ORDER  BY parameters DESC;

SELECT name, context, vartype, setting, min_val, max_val, enumvals
FROM   pg_settings
WHERE  name IN ('shared_buffers', 'max_wal_size', 'work_mem',
                'log_min_duration_statement', 'wal_level', 'log_connections')
ORDER  BY context, name;`,
      explain: `<p>About 70 parameters need a restart (<code>postmaster</code>), ~100 a reload (<code>sighup</code>), ~50 are superuser-settable and ~150 any user can set. <code>vartype</code>, <code>min_val</code>, <code>max_val</code> and <code>enumvals</code> document valid values — use them to validate configuration management templates. Before changing anything in production, check its context here.</p>`,
      output: ` context           | parameters
-------------------+------------
 user              |        155
 sighup            |        104
 postmaster        |         69
 superuser         |         49
 internal          |         20
 superuser-backend |          4
 backend           |          2

 name                       | context           | vartype | setting | min_val | max_val    | enumvals
----------------------------+-------------------+---------+---------+---------+------------+------------------------------
 shared_buffers             | postmaster        | integer | 16384   | 16      | 1073741823 |
 wal_level                  | postmaster        | enum    | replica |         |            | {minimal,replica,logical}
 max_wal_size               | sighup            | integer | 1024    | 2       | 2147483647 |
 log_min_duration_statement | superuser         | integer | -1      | -1      | 2147483647 |
 log_connections            | superuser-backend | string  |         |         |            |
 work_mem                   | user              | integer | 4096    | 64      | 2147483647 |`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Validate config and pg_hba.conf before reloading',
      sql: `-- Every line from all configuration files, with errors and whether it is applied
SELECT sourcefile, sourceline, name, setting, applied, error
FROM   pg_file_settings
ORDER  BY sourcefile, sourceline;

-- Parsed pg_hba.conf rules (first match wins), including parse errors
SELECT rule_number, type, database, user_name, address, netmask, auth_method, options, error
FROM   pg_hba_file_rules
ORDER  BY rule_number;

-- pg_ident.conf mappings (PG15+)
SELECT map_number, map_name, sys_name, pg_username, error
FROM   pg_ident_file_mappings;`,
      explain: `<p><code>pg_file_settings</code> re-reads the files <em>now</em>, so after editing you can see typos (<code>error</code>) and values that will not apply (<code>applied = false</code>, e.g. a duplicate setting later in the file or a postmaster parameter awaiting restart) <strong>before</strong> you reload. <code>pg_hba_file_rules</code> does the same for authentication rules. The playground's embedded server trusts local connections; a production file should use <code>scram-sha-256</code> or certificates — never <code>trust</code> on network lines.</p>`,
      output: ` sourcefile                   | sourceline | name                       | setting | applied | error
------------------------------+------------+----------------------------+---------+---------+-------
 /pglite/data/postgresql.conf |         65 | max_connections            | 100     | t       |
 /pglite/data/postgresql.conf |        132 | shared_buffers             | 128MB   | t       |
 ...

 rule_number | type  | database      | user_name | address   | netmask | auth_method | options | error
-------------+-------+---------------+-----------+-----------+---------+-------------+---------+-------
           1 | local | {all}         | {all}     |           |         | trust       |         |
           2 | host  | {all}         | {all}     | 127.0.0.1 | ...     | trust       |         |
 ...

(0 rows)  -- no ident mappings`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- pg_hba.conf with a broad rule first: everything below is unreachable
-- host  all  all  0.0.0.0/0     trust
-- hostssl shop app_user 10.0.0.0/16 scram-sha-256
SELECT rule_number, type, address, auth_method FROM pg_hba_file_rules ORDER BY rule_number;`, why: 'pg_hba.conf is first-match: a broad trust line at the top lets anyone from anywhere connect as any user without a password, and the stricter rules below are never evaluated.', run: true },
    good: { sql: `-- Specific rules first, TLS + SCRAM for network clients, explicit reject at the end
-- local   all       postgres                    peer
-- hostssl shop      app_user   10.0.0.0/16      scram-sha-256
-- hostssl shop      analyst    10.20.0.0/24     scram-sha-256
-- host    all       all        0.0.0.0/0        reject
SELECT rule_number, type, database, user_name, auth_method, error
FROM   pg_hba_file_rules ORDER BY rule_number;`, why: 'Narrow rules from most to least specific, require TLS (hostssl) and scram-sha-256 for network access, and end with an explicit reject. Validate with pg_hba_file_rules before reloading.', run: true }
  },
  mistakes: [
    `Changing a value in postgresql.conf that is overridden by <code>postgresql.auto.conf</code> (from an old <code>ALTER SYSTEM</code>).`,
    `Reloading after changing a <code>postmaster</code> parameter and assuming it took effect — check <code>pending_restart</code>.`,
    `Restarting with a typo in postgresql.conf: the server refuses to start. Validate with <code>pg_file_settings</code> first.`,
    `Using <code>trust</code> or <code>md5</code> in pg_hba.conf for network connections (md5 is deprecated in PG18; use scram-sha-256).`,
    `Ordering pg_hba.conf rules from broad to specific — first match wins.`
  ],
  best: [
    `Manage configuration as code: base postgresql.conf plus <code>include_dir 'conf.d'</code> with numbered files per topic.`,
    `Validate with <code>pg_file_settings</code> / <code>pg_hba_file_rules</code> before every reload.`,
    `Use <code>ALTER SYSTEM</code> sparingly, and reconcile it back into managed files.`,
    `Use <code>hostssl</code> + <code>scram-sha-256</code> (or <code>cert</code>) for all network access; finish with an explicit <code>reject</code>.`,
    `Comment every non-default setting with the reason and date.`
  ],
  performance: `<p>Configuration reading itself has no runtime cost. The parameters you set do: context tells you how disruptive a change is (restart = downtime or failover; reload = instant). Plan restart-level changes (memory, connections, WAL level, io_method) into maintenance windows or rolling restarts across replicas with switchover.</p>`,
  security: `<p>pg_hba.conf is the front door: prefer <code>scram-sha-256</code> (set <code>password_encryption = scram-sha-256</code>, default since PG14), TLS-only network rules, the smallest CIDR ranges possible and <code>peer</code> for local admin access. Config files should be owned by the postgres OS user with restrictive permissions. <code>pg_file_settings</code>, <code>pg_hba_file_rules</code> and <code>pg_ident_file_mappings</code> are superuser-only by default because they reveal security configuration.</p>`,
  scenario: {
    title: 'After a restart the server will not start',
    steps: [
      '1. Read the server log (or journalctl -u postgresql): it names the file, line and invalid parameter.',
      '2. Fix the line in postgresql.conf (or the include file / postgresql.auto.conf if ALTER SYSTEM wrote a bad value).',
      '3. For a bad ALTER SYSTEM value you can edit postgresql.auto.conf while the server is down, then start.',
      '4. Once up, run SELECT * FROM pg_file_settings WHERE error IS NOT NULL to confirm no other errors.',
      '5. Add validation (pg_file_settings check on a staging server) to your change process.'
    ]
  },
  widgets: ['lab:security'],
  interview: [
    { q: 'What is postgresql.auto.conf?', a: 'A file in PGDATA written only by ALTER SYSTEM. It is read after postgresql.conf, so its values override it. It should not be edited by hand while the server runs; ALTER SYSTEM RESET removes entries.' },
    { q: 'Explain the main parameter contexts.', a: 'internal: fixed; postmaster: requires restart; sighup: change in config and reload; backend/superuser-backend: effective for new sessions; superuser: settable per session by superusers or roles granted SET; user: any role can SET per session.' },
    { q: 'How does pg_hba.conf matching work?', a: 'Lines are evaluated top to bottom; the first line matching connection type, database, user and client address determines the authentication method. If no line matches, the connection is rejected. Changes apply on reload.' },
    { q: 'How do you check configuration for errors before reloading?', a: 'Query pg_file_settings (error column and applied flag) for postgresql.conf and includes, and pg_hba_file_rules / pg_ident_file_mappings for authentication files. Both reflect the files on disk at query time.' }
  ],
  exercises: [
    { task: 'List all parameters that require a restart to change, with their current values (first 15 alphabetically).', solution: `SELECT name, current_setting(name) AS value
FROM   pg_settings
WHERE  context = 'postmaster'
ORDER  BY name
LIMIT  15;`, run: true },
    { task: 'Show every parameter whose value comes from a configuration file, with file and line.', solution: `SELECT name, setting, sourcefile, sourceline
FROM   pg_settings
WHERE  source = 'configuration file'
ORDER  BY sourcefile, sourceline;`, run: true },
    { task: 'Show all pg_hba.conf rules that use the trust method.', solution: `SELECT rule_number, type, database, user_name, address
FROM   pg_hba_file_rules
WHERE  auth_method = 'trust';`, run: true }
  ],
  challenge: {
    task: 'Write an audit query that flags risky configuration: any pg_hba rule using trust or md5 on a non-local connection type, any configuration-file line with an error, and whether password_encryption is not scram-sha-256. Return one row per finding with a severity.',
    hint: 'UNION ALL three SELECTs over pg_hba_file_rules, pg_file_settings and pg_settings.',
    solution: `SELECT 'CRITICAL' AS severity,
       format('pg_hba rule %s: %s %s for %s from %s',
              rule_number, type, auth_method, user_name, coalesce(address, 'any')) AS finding
FROM   pg_hba_file_rules
WHERE  type <> 'local' AND auth_method IN ('trust', 'md5')
UNION ALL
SELECT 'ERROR', format('%s:%s %s - %s', sourcefile, sourceline, name, error)
FROM   pg_file_settings
WHERE  error IS NOT NULL
UNION ALL
SELECT 'WARNING', 'password_encryption = ' || setting
FROM   pg_settings
WHERE  name = 'password_encryption' AND setting <> 'scram-sha-256';`,
    run: true
  },
  related: ['configuration-set-alter-system', 'configuration-production-settings', 'security', 'production-optimization'],
  quiz: [
    { type: 'mcq', q: 'Which file does ALTER SYSTEM write to?', options: ['postgresql.conf', 'postgresql.auto.conf', 'pg_hba.conf', 'conf.d/99-system.conf'], answer: 1, explain: 'ALTER SYSTEM writes postgresql.auto.conf, which is read last and overrides postgresql.conf.' },
    { type: 'mcq', q: 'max_connections has which context?', options: ['user', 'sighup', 'postmaster', 'superuser'], answer: 2, explain: 'It sizes shared memory structures at startup, so a restart is required.' },
    { type: 'tf', q: 'In pg_hba.conf, the most specific matching line wins regardless of order.', answer: false, explain: 'The first matching line wins; order matters.' },
    { type: 'scenario', q: 'You changed max_wal_size in postgresql.conf and reloaded, but SHOW max_wal_size shows the old value. Most likely?', options: ['A restart is required', 'postgresql.auto.conf (ALTER SYSTEM) overrides it — check sourcefile in pg_settings', 'max_wal_size cannot be changed', 'The reload failed silently because of permissions'], answer: 1, explain: 'max_wal_size is sighup; if it did not change, another later source overrides it — typically postgresql.auto.conf.' }
  ]
},
{
  id: 'configuration-set-alter-system',
  module: 'configuration',
  title: 'Changing Settings: SHOW, SET, SET LOCAL, RESET, ALTER SYSTEM, ALTER DATABASE/ROLE … SET, Reload vs Restart',
  level: 4,
  minutes: 20,
  summary: 'All the ways to read and change parameters and their scope and precedence: session, transaction, role, database, role-in-database, cluster-wide via ALTER SYSTEM — plus pg_reload_conf() and pending_restart.',
  objectives: [
    'Read settings with SHOW, current_setting() and pg_settings',
    'Change settings per session (SET), per transaction (SET LOCAL) and undo with RESET',
    'Persist settings per role, per database and per role-in-database',
    'Use ALTER SYSTEM and pg_reload_conf() correctly, and detect pending restarts',
    'Explain the precedence order of all setting sources'
  ],
  concept: `<p>A parameter's effective value in a session is decided by a layered set of sources, from lowest to highest priority:</p>
<ol>
<li>Built-in default (<code>boot_val</code>)</li>
<li><code>postgresql.conf</code> (and includes), then <code>postgresql.auto.conf</code> (ALTER SYSTEM)</li>
<li>Command-line options of the server (<code>postgres -c …</code>)</li>
<li><code>ALTER DATABASE db SET …</code></li>
<li><code>ALTER ROLE r SET …</code></li>
<li><code>ALTER ROLE r IN DATABASE db SET …</code></li>
<li>Client connection options (e.g. <code>options='-c statement_timeout=5s'</code> in the connection string)</li>
<li><code>SET</code> in the session</li>
<li><code>SET LOCAL</code> inside the current transaction (reverts at COMMIT/ROLLBACK)</li>
</ol>
<p><strong>Analogy:</strong> a thermostat in an office building. The building default (postgresql.conf) sets 22°C; each floor (database) may override it; each employee's profile (role) may override that; and you can turn the dial in your own office for the day (SET) or just for this meeting (SET LOCAL).</p>
<h4>The commands</h4>
<ul>
<li><code>SHOW name</code> / <code>SHOW ALL</code>; <code>current_setting('name' [, missing_ok])</code> in SQL expressions.</li>
<li><code>SET name = value</code> (session), <code>SET LOCAL name = value</code> (transaction), <code>RESET name</code> / <code>RESET ALL</code>; <code>set_config(name, value, is_local)</code> as a function.</li>
<li><code>ALTER ROLE … SET</code>, <code>ALTER DATABASE … SET</code>, <code>ALTER ROLE … IN DATABASE … SET</code> — stored in <code>pg_db_role_setting</code>, applied at connection start.</li>
<li><code>ALTER SYSTEM SET name = value</code> / <code>ALTER SYSTEM RESET name</code> — writes postgresql.auto.conf; then <code>SELECT pg_reload_conf()</code> (sighup parameters) or restart (postmaster parameters).</li>
</ul>`,
  why: `<p>Getting the scope right is the difference between a safe change and an incident. A reporting role needs 512MB work_mem; the checkout service needs a 2-second statement_timeout; a migration needs a 3-second lock_timeout for one transaction. Each belongs at a different layer. And knowing which parameters need a restart avoids "we changed it but nothing happened" surprises.</p>`,
  useCase: `<p>An analytics company standardises settings by layer: cluster-wide safety defaults in managed config files; <code>ALTER ROLE app_api SET statement_timeout = '3s'</code> and <code>idle_in_transaction_session_timeout = '30s'</code>; <code>ALTER ROLE etl SET work_mem = '1GB'</code>, <code>statement_timeout = 0</code>; <code>ALTER DATABASE reporting SET default_transaction_read_only = on</code>; and migrations always begin with <code>SET LOCAL lock_timeout = '3s'</code>. Incidents caused by runaway queries dropped by 80% within a quarter.</p>`,
  internals: `<p>Each backend holds a GUC (Grand Unified Configuration) table with a stack per variable: <code>SET LOCAL</code> pushes a value popped at transaction end; <code>SET</code> inside a transaction that later rolls back is also undone. Role/database settings are read from <code>pg_db_role_setting</code> during connection start — so they apply to <em>new</em> sessions only. <code>pg_reload_conf()</code> sends SIGHUP to the postmaster, which re-reads files and signals all children; each child applies new sighup-level values at its next command boundary, unless the session has overridden them with SET. For postmaster-context parameters, the new value is recorded but <code>pending_restart = true</code> until a restart. Since PG15, superusers can <code>GRANT SET ON PARAMETER name TO role</code> (and <code>ALTER SYSTEM</code> privilege) for fine-grained delegation.</p>`,
  whenNot: `<p>Do not use <code>ALTER SYSTEM</code> for settings that belong to one application — use role/database settings. Do not use session-level <code>SET</code> through a transaction-mode connection pooler (PgBouncer): the next transaction on that server connection may belong to another client and inherit your setting — use <code>SET LOCAL</code> inside the transaction instead. Do not rely on <code>ALTER ROLE … SET</code> for existing connections — they keep their old values until reconnect.</p>`,
  syntax: `SHOW work_mem;  SELECT current_setting('work_mem');
SET work_mem = '64MB';        SET LOCAL work_mem = '256MB';   RESET work_mem;
SELECT set_config('work_mem', '64MB', true);   -- true = local to transaction

ALTER ROLE reporting SET work_mem = '512MB';
ALTER DATABASE shop SET timezone = 'Asia/Kolkata';
ALTER ROLE app IN DATABASE shop SET statement_timeout = '3s';
ALTER ROLE reporting RESET work_mem;

ALTER SYSTEM SET max_wal_size = '32GB';   ALTER SYSTEM RESET max_wal_size;
SELECT pg_reload_conf();
SELECT name FROM pg_settings WHERE pending_restart;`,
  examples: [
    {
      label: 'Basic',
      title: 'SHOW, SET, SET LOCAL and RESET',
      sql: `SHOW work_mem;

SET work_mem = '64MB';                 -- whole session
SHOW work_mem;

BEGIN;
SET LOCAL work_mem = '256MB';          -- only this transaction
SELECT current_setting('work_mem') AS inside_transaction;
COMMIT;

SELECT current_setting('work_mem') AS after_commit;   -- back to the session value
RESET work_mem;                                       -- back to the configured default
SHOW work_mem;`,
      explain: `<p>Session <code>SET</code> lasts until the connection closes or <code>RESET</code>. <code>SET LOCAL</code> applies until the end of the current transaction and then the previous value returns — the right tool inside migrations and when using transaction-mode poolers. <code>RESET</code> returns to the value the session started with (config file / role / database setting).</p>`,
      output: ` work_mem
----------
 4MB
 64MB

 inside_transaction
--------------------
 256MB

 after_commit
--------------
 64MB

 work_mem
----------
 4MB`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Per-role and per-database defaults (pg_db_role_setting)',
      sql: `CREATE ROLE reporting_demo NOLOGIN;
ALTER ROLE reporting_demo SET work_mem = '512MB';
ALTER ROLE reporting_demo SET statement_timeout = '15min';

-- Database-level setting for the current database (name varies, so use dynamic SQL)
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L',
                 current_database(), '60s');
END $$;

SELECT coalesce(r.rolname, '(all roles)')     AS role,
       coalesce(d.datname, '(all databases)') AS database,
       s.setconfig                            AS settings
FROM   pg_db_role_setting s
LEFT   JOIN pg_roles    r ON r.oid = s.setrole
LEFT   JOIN pg_database d ON d.oid = s.setdatabase
ORDER  BY 1, 2;`,
      explain: `<p>Role and database settings live in <code>pg_db_role_setting</code> and are applied whenever a <em>new</em> session starts for that role/database. They are the cleanest way to give each workload the right limits without touching cluster config: the reporting role gets big memory and a long timeout, while the database as a whole kills abandoned transactions after 60 s. (The example runs inside a rolled-back transaction in the playground.)</p>`,
      output: ` role           | database        | settings
----------------+-----------------+---------------------------------------------
 (all roles)    | postgres        | {idle_in_transaction_session_timeout=60s}
 reporting_demo | (all databases) | {work_mem=512MB,statement_timeout=15min}`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'ALTER SYSTEM, reload, restart and pending_restart (run on a real server)',
      sql: `-- Requires superuser (or GRANT ALTER SYSTEM ON PARAMETER ...). Not runnable in the playground.
ALTER SYSTEM SET log_min_duration_statement = '500ms';   -- superuser context: reload is enough
ALTER SYSTEM SET max_connections = 400;                 -- postmaster context: needs restart
SELECT pg_reload_conf();

SELECT name, setting, pending_restart
FROM   pg_settings
WHERE  name IN ('log_min_duration_statement', 'max_connections');

-- Undo an ALTER SYSTEM entry (removes the line from postgresql.auto.conf)
ALTER SYSTEM RESET max_connections;
SELECT pg_reload_conf();

-- Delegate a single parameter (PG15+)
GRANT SET ON PARAMETER log_min_duration_statement TO dba_oncall;
GRANT ALTER SYSTEM ON PARAMETER log_min_duration_statement TO dba_oncall;`,
      explain: `<p>After the reload, <code>log_min_duration_statement</code> is active immediately, whereas <code>max_connections</code> shows <code>pending_restart = t</code> with the old value still in effect until a restart. <code>ALTER SYSTEM RESET</code> removes the override. Parameter-level GRANTs (PG15+) let on-call engineers adjust logging without full superuser rights. ALTER SYSTEM cannot run inside a transaction block.</p>`,
      output: `ALTER SYSTEM
ALTER SYSTEM
 pg_reload_conf
----------------
 t

 name                       | setting | pending_restart
----------------------------+---------+-----------------
 log_min_duration_statement | 500     | f
 max_connections            | 100     | t`,
      run: false
    }
  ],
  compare: {
    bad: { sql: `-- Behind a transaction-mode pooler: session SET leaks to other clients
SET statement_timeout = '1s';
SELECT count(*) FROM orders;`, why: 'With PgBouncer in transaction mode, the server connection is handed to another client after this transaction; that client silently inherits statement_timeout = 1s (or your search_path, role etc.).', run: true },
    good: { sql: `BEGIN;
SET LOCAL statement_timeout = '1s';
SELECT count(*) FROM orders;
COMMIT;`, why: 'SET LOCAL is scoped to the transaction, so nothing leaks to the next user of the pooled connection. Persistent per-workload values belong in ALTER ROLE ... SET.', run: true }
  },
  mistakes: [
    `Using <code>ALTER SYSTEM</code> for workload-specific settings that should be per role or database.`,
    `Expecting <code>ALTER ROLE … SET</code> to affect already-connected sessions.`,
    `Forgetting <code>pg_reload_conf()</code> after <code>ALTER SYSTEM</code> for sighup parameters, or expecting it to apply postmaster parameters.`,
    `Running session-level <code>SET</code> through a transaction-mode pooler.`,
    `Using <code>SET</code> (not LOCAL) inside a function or migration and leaving the session changed afterwards.`
  ],
  best: [
    `Layer intentionally: cluster defaults in managed files, workload limits per role, environment specifics per database, one-off changes with SET LOCAL.`,
    `Always check <code>pending_restart</code> after configuration changes.`,
    `Use <code>current_setting('x', true)</code> (missing_ok) for custom application settings such as <code>app.tenant_id</code> to avoid errors.`,
    `Audit with <code>SELECT name, setting, source FROM pg_settings WHERE source &lt;&gt; 'default'</code> and <code>pg_db_role_setting</code>.`,
    `Delegate with <code>GRANT SET ON PARAMETER</code> instead of handing out superuser.`
  ],
  performance: `<p>SET is cheap (in-memory). Role/database settings add negligible connection-time cost. A reload is non-disruptive; a restart drops all connections and empties shared_buffers (cold cache) — schedule restarts and consider pg_prewarm. Per-transaction settings like <code>SET LOCAL work_mem</code> let you give heavy queries resources without raising risk globally.</p>`,
  security: `<p>Custom settings (<code>SET app.tenant_id = '42'</code>) are commonly used with row-level security — but any session can set them, so never trust them alone for security unless set by trusted code (e.g. via a SECURITY DEFINER function or the pooler). Superuser-context parameters cannot be changed by ordinary roles unless granted. Restrict who can run <code>ALTER SYSTEM</code>: it can change authentication-related settings and preload libraries.</p>`,
  scenario: {
    title: 'A runaway report keeps consuming CPU and memory every afternoon',
    steps: [
      '1. Identify the role/application in pg_stat_activity (usename, application_name).',
      '2. Set limits for that role only: ALTER ROLE reporting SET statement_timeout = \'10min\'; ALTER ROLE reporting SET work_mem = \'256MB\'.',
      '3. Ask the team to reconnect (role settings apply to new sessions) or terminate old sessions in a quiet moment.',
      '4. Verify with SELECT * FROM pg_db_role_setting and SHOW in a new session as that role.',
      '5. Consider routing reporting to a replica.'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'What is the difference between SET and SET LOCAL?', a: 'SET changes a parameter for the rest of the session (undone if the transaction rolls back); SET LOCAL changes it only until the end of the current transaction. SET LOCAL is safe with transaction-mode connection poolers and in migrations.' },
    { q: 'What is the precedence of setting sources?', a: 'From lowest to highest: built-in default, config files (postgresql.conf then postgresql.auto.conf), server command line, ALTER DATABASE, ALTER ROLE, ALTER ROLE IN DATABASE, client connection options, session SET, transaction SET LOCAL.' },
    { q: 'Does pg_reload_conf() apply every change?', a: 'It applies sighup, superuser and user-level defaults from the files. Postmaster-context parameters (shared_buffers, max_connections, wal_level...) need a restart; pg_settings.pending_restart shows them. Sessions that explicitly SET a parameter keep their value.' },
    { q: 'How do you give one application a statement timeout without affecting others?', a: 'ALTER ROLE app_role SET statement_timeout = \'3s\' (or ALTER ROLE ... IN DATABASE ... SET). It applies to new sessions of that role only.' }
  ],
  exercises: [
    { task: 'Use set_config to set statement_timeout to 5s for the current transaction only and read it back with current_setting.', solution: `BEGIN;
SELECT set_config('statement_timeout', '5s', true);
SELECT current_setting('statement_timeout');
ROLLBACK;`, run: true },
    { task: 'Read a custom application setting app.tenant_id safely when it is not set, then set it and read it again.', solution: `SELECT current_setting('app.tenant_id', true) AS before_set;
SET app.tenant_id = '42';
SELECT current_setting('app.tenant_id', true) AS after_set;`, run: true },
    { task: 'List all parameters changed in the current session (source = session).', solution: `SET work_mem = '32MB';
SET search_path = public;
SELECT name, setting, source
FROM   pg_settings
WHERE  source = 'session';`, run: true }
  ],
  challenge: {
    task: 'Create a role analytics_demo with work_mem 256MB and jit on, plus a role-in-database setting of statement_timeout 30min for the current database. Then report all its settings from pg_db_role_setting, distinguishing role-wide from database-specific ones.',
    hint: 'ALTER ROLE ... IN DATABASE needs the database name — use a DO block with format(). Join pg_db_role_setting to pg_roles and pg_database.',
    solution: `CREATE ROLE analytics_demo NOLOGIN;
ALTER ROLE analytics_demo SET work_mem = '256MB';
ALTER ROLE analytics_demo SET jit = on;
DO $$
BEGIN
  EXECUTE format('ALTER ROLE analytics_demo IN DATABASE %I SET statement_timeout = %L',
                 current_database(), '30min');
END $$;
SELECT r.rolname,
       CASE WHEN s.setdatabase = 0 THEN 'all databases' ELSE d.datname END AS scope,
       unnest(s.setconfig) AS setting
FROM   pg_db_role_setting s
JOIN   pg_roles r ON r.oid = s.setrole
LEFT   JOIN pg_database d ON d.oid = s.setdatabase
WHERE  r.rolname = 'analytics_demo'
ORDER  BY scope, setting;`,
    run: true
  },
  related: ['configuration-files-contexts', 'configuration-production-settings', 'roles-permissions', 'connection-pooling'],
  quiz: [
    { type: 'predict', q: 'What does the last SHOW print (default work_mem 4MB)?', code: `SET work_mem = '64MB';
BEGIN;
SET LOCAL work_mem = '1GB';
COMMIT;
SHOW work_mem;`, options: ['4MB', '64MB', '1GB', 'An error'], answer: 1, explain: 'SET LOCAL reverts at COMMIT to the session value set before (64MB).' },
    { type: 'mcq', q: 'Which has the highest precedence?', options: ['ALTER DATABASE ... SET', 'ALTER ROLE ... SET', 'ALTER ROLE ... IN DATABASE ... SET', 'postgresql.auto.conf'], answer: 2, explain: 'Role-in-database settings override role-only and database-only settings, which override config files.' },
    { type: 'tf', q: 'After ALTER SYSTEM SET shared_buffers = \'8GB\' and pg_reload_conf(), the new value is active.', answer: false, explain: 'shared_buffers is postmaster context; pending_restart = true until restart.' },
    { type: 'bug', q: 'Behind PgBouncer (transaction mode), other clients randomly hit 1-second timeouts. Why?', code: `-- in one service
SET statement_timeout = '1s';
SELECT ...;`, options: ['PgBouncer does not support timeouts', 'Session-level SET persists on the server connection that is later reused by other clients', 'statement_timeout is global', 'The SELECT is too slow'], answer: 1, explain: 'Use SET LOCAL inside a transaction, or role-level settings.' }
  ]
},
{
  id: 'configuration-production-settings',
  module: 'configuration',
  title: 'Common Production Settings Reference: Connections, Logging and Timeouts',
  level: 4,
  minutes: 22,
  summary: 'A reference of the settings every production server should consciously configure: listen_addresses, max_connections, logging (log_min_duration_statement, log_line_prefix, log_lock_waits, log_autovacuum_min_duration) and safety timeouts (statement_timeout, idle_in_transaction_session_timeout, lock_timeout, transaction_timeout).',
  objectives: [
    'Configure listen_addresses and max_connections safely',
    'Set up useful logging: slow statements, lock waits, autovacuum, temp files, checkpoints, connections',
    'Design a log_line_prefix that makes logs searchable',
    'Choose and scope statement_timeout, lock_timeout, idle_in_transaction_session_timeout and transaction_timeout',
    'Know which settings are restart-level and plan accordingly'
  ],
  concept: `<p>Beyond performance tuning, a small set of settings determines whether a production server is <strong>reachable only by the right clients</strong>, <strong>observable</strong> when things go wrong, and <strong>self-protecting</strong> against runaway sessions.</p>
<p><strong>Analogy:</strong> running a factory floor. <code>listen_addresses</code>/<code>max_connections</code> are the gates and the maximum number of workers allowed in. Logging is the CCTV and the incident log. Timeouts are the automatic machine cut-offs — a press that has been running for too long or a worker who left a machine locked while on a break gets stopped automatically.</p>
<h4>Reference table</h4>
<table>
<tr><th>Setting</th><th>Default</th><th>Recommended (OLTP)</th><th>Context</th><th>Why</th></tr>
<tr><td><code>listen_addresses</code></td><td>localhost</td><td>Private IP(s) only</td><td>postmaster</td><td>Never expose 5432 publicly; pair with firewall + pg_hba</td></tr>
<tr><td><code>port</code></td><td>5432</td><td>5432</td><td>postmaster</td><td>Changing it is not security</td></tr>
<tr><td><code>max_connections</code></td><td>100</td><td>100–500 with a pooler</td><td>postmaster</td><td>Each backend costs memory/CPU; pool instead of raising</td></tr>
<tr><td><code>superuser_reserved_connections</code></td><td>3</td><td>3–5</td><td>postmaster</td><td>Admin access during saturation</td></tr>
<tr><td><code>log_min_duration_statement</code></td><td>-1 (off)</td><td>250ms–1s</td><td>superuser</td><td>Log slow statements with duration</td></tr>
<tr><td><code>log_line_prefix</code></td><td><code>%m [%p] </code></td><td><code>%m [%p] %q%u@%d app=%a client=%h </code></td><td>sighup</td><td>Time, pid, user, db, app, host on every line</td></tr>
<tr><td><code>log_lock_waits</code></td><td>off</td><td>on</td><td>superuser</td><td>Logs waits longer than deadlock_timeout</td></tr>
<tr><td><code>log_autovacuum_min_duration</code></td><td>10min</td><td>1s–10s</td><td>sighup</td><td>See which tables autovacuum struggles with</td></tr>
<tr><td><code>log_temp_files</code></td><td>-1</td><td>0 or 10MB</td><td>superuser</td><td>Find work_mem spills</td></tr>
<tr><td><code>log_checkpoints</code></td><td>on</td><td>on</td><td>sighup</td><td>Checkpoint timing and volume</td></tr>
<tr><td><code>log_connections</code> / <code>log_disconnections</code></td><td>off</td><td>on (audit) or off (very high churn)</td><td>superuser-backend</td><td>Who connected, session length; PG18 accepts aspects like <code>receipt,authentication,authorization,setup_durations</code></td></tr>
<tr><td><code>log_statement</code></td><td>none</td><td><code>ddl</code></td><td>superuser</td><td>Audit schema changes; <code>all</code> is too noisy</td></tr>
<tr><td><code>statement_timeout</code></td><td>0 (off)</td><td>Per role: 2–30s for APIs</td><td>user</td><td>Cancel runaway statements</td></tr>
<tr><td><code>lock_timeout</code></td><td>0</td><td>Per migration: 2–5s</td><td>user</td><td>Give up instead of blocking a queue</td></tr>
<tr><td><code>idle_in_transaction_session_timeout</code></td><td>0</td><td>30s–5min</td><td>user</td><td>Terminate abandoned transactions</td></tr>
<tr><td><code>transaction_timeout</code> (PG17+)</td><td>0</td><td>Per role, e.g. 5–15min</td><td>user</td><td>Hard cap on whole transaction duration</td></tr>
<tr><td><code>idle_session_timeout</code></td><td>0</td><td>Use carefully (breaks poolers' idle connections)</td><td>user</td><td>Close idle connections</td></tr>
</table>`,
  why: `<p>Defaults are chosen for a laptop, not a production cluster: no slow-query logging, no lock-wait logging, no timeouts at all. The first serious incident on an unconfigured server usually has no logs to explain it and no timeout to stop it. Ten lines of configuration fix both.</p>`,
  useCase: `<p>A ticketing platform sells out concerts in minutes. Before configuration review, a single analyst query ran 4 hours during a sale and an app bug left transactions open, blocking seat updates. After: <code>statement_timeout = '5s'</code> for <code>ticket_api</code>, <code>'30min'</code> for <code>analyst</code>; <code>idle_in_transaction_session_timeout = '30s'</code> cluster-wide; <code>log_min_duration_statement = 300ms</code>, <code>log_lock_waits = on</code>, structured <code>log_line_prefix</code> shipped to their log platform. The next sale had zero lock pile-ups, and the 3 slow queries that appeared were visible in logs within minutes.</p>`,
  internals: `<p>Timeouts are implemented with per-backend timers: <code>statement_timeout</code> cancels the statement (SQLSTATE 57014) like <code>pg_cancel_backend</code>; <code>lock_timeout</code> aborts a statement whose single lock wait exceeds the limit (55P03); <code>idle_in_transaction_session_timeout</code> and <code>idle_session_timeout</code> terminate the session (FATAL); <code>transaction_timeout</code> (PG17) terminates the session when a transaction runs too long. Slow-statement logging measures from statement start to completion and writes duration plus statement text; <code>log_min_duration_sample</code> + <code>log_statement_sample_rate</code> allow sampling. Logs are written by the logging collector (<code>logging_collector = on</code>) or to stderr/journald; <code>log_destination = 'jsonlog'</code> (PG15+) produces structured JSON lines.</p>`,
  whenNot: `<p>Do not set a short <code>statement_timeout</code> globally — it will kill pg_dump, index builds, migrations and maintenance. Scope it to application roles. Do not enable <code>log_statement = 'all'</code> on a busy server (huge log volume, contains data). Do not use <code>idle_session_timeout</code> with connection poolers that keep idle server connections — they will be killed and reconnect constantly.</p>`,
  syntax: `listen_addresses = '10.0.1.15'
max_connections = 300
log_min_duration_statement = 500ms
log_line_prefix = '%m [%p] %q%u@%d app=%a client=%h '
log_lock_waits = on
log_autovacuum_min_duration = 10s
log_temp_files = 10MB
log_statement = 'ddl'
idle_in_transaction_session_timeout = 60s

ALTER ROLE app_api SET statement_timeout = '5s';
SET LOCAL lock_timeout = '3s';     -- in migrations
SET transaction_timeout = '10min'; -- PG17+`,
  examples: [
    {
      label: 'Basic',
      title: 'Audit the production-relevant settings in one query',
      sql: `SELECT name,
       current_setting(name) AS value,
       context,
       CASE
         WHEN name = 'listen_addresses' AND current_setting(name) = '*' THEN 'review: listening on all interfaces'
         WHEN name IN ('statement_timeout', 'idle_in_transaction_session_timeout', 'lock_timeout')
              AND current_setting(name) = '0' THEN 'no timeout (set per role/db)'
         WHEN name = 'log_min_duration_statement' AND current_setting(name) = '-1' THEN 'slow-query logging off'
         WHEN name = 'log_lock_waits' AND current_setting(name) = 'off' THEN 'consider on'
         ELSE 'ok'
       END AS advice
FROM   pg_settings
WHERE  name IN ('listen_addresses', 'max_connections', 'superuser_reserved_connections',
                'log_min_duration_statement', 'log_line_prefix', 'log_lock_waits',
                'log_autovacuum_min_duration', 'log_temp_files', 'log_checkpoints',
                'log_statement', 'statement_timeout', 'lock_timeout',
                'idle_in_transaction_session_timeout', 'transaction_timeout')
ORDER  BY name;`,
      explain: `<p>A quick self-audit: shows each setting's value and context and flags the usual gaps. On a default installation (like the playground) slow-query logging, lock-wait logging and all timeouts are off. Turn this into a scheduled check in your monitoring.</p>`,
      output: ` name                                | value     | context    | advice
-------------------------------------+-----------+------------+-------------------------------
 idle_in_transaction_session_timeout | 0         | user       | no timeout (set per role/db)
 listen_addresses                    | localhost | postmaster | ok
 lock_timeout                        | 0         | user       | no timeout (set per role/db)
 log_autovacuum_min_duration         | 10min     | sighup     | ok
 log_checkpoints                     | off       | sighup     | ok
 log_line_prefix                     | %m [%p]   | sighup     | ok
 log_lock_waits                      | off       | superuser  | consider on
 log_min_duration_statement          | -1        | superuser  | slow-query logging off
 log_statement                       | none      | superuser  | ok
 log_temp_files                      | -1        | superuser  | ok
 max_connections                     | 100       | postmaster | ok
 statement_timeout                   | 0         | user       | no timeout (set per role/db)
 superuser_reserved_connections      | 3         | postmaster | ok
 transaction_timeout                 | 0         | user       | ok`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'See statement_timeout and lock_timeout fire',
      sql: `-- statement_timeout cancels a long statement (SQLSTATE 57014)
DO $$
BEGIN
  SET LOCAL statement_timeout = '100ms';
  PERFORM pg_sleep(1);
EXCEPTION WHEN query_canceled THEN
  RAISE NOTICE 'statement_timeout fired: %', SQLERRM;
END $$;

-- Timeouts are best scoped: per transaction ...
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SELECT current_setting('lock_timeout') AS lock_timeout,
       current_setting('statement_timeout') AS statement_timeout;
ROLLBACK;`,
      explain: `<p>The DO block sets a 100 ms timeout and sleeps for 1 s: the statement is cancelled with <code>canceling statement due to statement timeout</code>, which we catch as <code>query_canceled</code> to demonstrate it without failing. In real migrations, <code>SET LOCAL lock_timeout</code> makes a DDL statement give up after 3 s of waiting for its lock instead of blocking all traffic behind it; you then retry later.</p>`,
      output: `NOTICE:  statement_timeout fired: canceling statement due to statement timeout

 lock_timeout | statement_timeout
--------------+-------------------
 3s           | 30s`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'A production logging + timeout block (postgresql.conf and role settings)',
      sql: `# ---- postgresql.conf (conf.d/30-logging.conf) ----
logging_collector = on                      # restart: captures stderr into log files
log_destination = 'stderr,jsonlog'          # jsonlog (PG15+) for log shippers
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d_%H%M.log'
log_rotation_age = 1d
log_rotation_size = 1GB
log_line_prefix = '%m [%p] %q%u@%d app=%a client=%h xid=%x '
log_min_duration_statement = 500ms          # every statement slower than 500 ms, with duration
log_lock_waits = on                         # waits > deadlock_timeout (1s)
log_autovacuum_min_duration = 10s
log_temp_files = 10MB
log_checkpoints = on
log_connections = on                        # PG18: or 'receipt,authentication,authorization'
log_disconnections = on
log_statement = 'ddl'                       # audit schema changes
idle_in_transaction_session_timeout = 60s

# ---- per-role timeouts (SQL) ----
ALTER ROLE app_api   SET statement_timeout = '5s';
ALTER ROLE app_api   SET lock_timeout = '2s';
ALTER ROLE app_api   SET transaction_timeout = '30s';     -- PG17+
ALTER ROLE reporting SET statement_timeout = '30min';
ALTER ROLE migrator  SET lock_timeout = '3s';
ALTER ROLE migrator  SET statement_timeout = 0;`,
      explain: `<p>Logging: <code>%q</code> stops the prefix there for non-session processes; <code>%a</code>/<code>%h</code>/<code>%x</code> add application, client host and transaction id — so every log line can be attributed. JSON logs simplify shipping to Loki/Elastic/CloudWatch. Timeouts are layered by role: the API fails fast, reporting gets a generous ceiling, the migration role never waits long for locks but may run long statements. This is configuration, not runnable SQL in the playground.</p>`,
      output: `-- log line example:
2026-10-05 10:15:42.123 UTC [48211] app_api@shop app=checkout client=10.0.3.17 xid=0 LOG:  duration: 812.334 ms  statement: SELECT ...`,
      run: false
    }
  ],
  compare: {
    bad: { sql: `-- Global, short statement_timeout for everyone
-- postgresql.conf: statement_timeout = 5s
SET statement_timeout = '5s';
SHOW statement_timeout;`, why: 'A global 5s timeout cancels pg_dump, CREATE INDEX, VACUUM-related admin work, migrations and legitimate reports, causing failed backups and half-finished maintenance.', run: true },
    good: { sql: `-- Scope timeouts to the workload
CREATE ROLE app_api_demo NOLOGIN;
ALTER ROLE app_api_demo SET statement_timeout = '5s';
ALTER ROLE app_api_demo SET idle_in_transaction_session_timeout = '30s';
SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'app_api_demo';`, why: 'Role-level timeouts protect the system from runaway application queries while leaving maintenance and reporting roles with appropriate limits.', run: true }
  },
  mistakes: [
    `<code>listen_addresses = '*'</code> on a host with a public interface and permissive pg_hba.conf.`,
    `Raising <code>max_connections</code> to thousands instead of using a pooler.`,
    `Turning on <code>log_statement = 'all'</code> in production — enormous logs containing sensitive data.`,
    `Setting a global <code>statement_timeout</code> that kills backups and migrations.`,
    `Not setting <code>log_line_prefix</code>, producing logs that cannot be attributed to a user, database or application.`,
    `Using <code>idle_session_timeout</code> with a connection pooler.`
  ],
  best: [
    `Bind to private addresses, firewall port 5432, and use hostssl + scram-sha-256 in pg_hba.conf.`,
    `Log slow statements (250ms–1s), lock waits, autovacuum runs, temp files, checkpoints and DDL; ship logs centrally.`,
    `Apply timeouts per role/database; use <code>SET LOCAL lock_timeout</code> in every migration.`,
    `Set <code>idle_in_transaction_session_timeout</code> cluster-wide as a safety net (30s–5min).`,
    `Review and version-control these settings; check them with an automated audit query.`
  ],
  performance: `<p>Logging has a cost proportional to volume: slow-query logging at 500ms is negligible; at 0ms (log everything) it can halve throughput on busy systems. Use sampling (<code>log_min_duration_sample</code>, <code>log_statement_sample_rate</code>) for low-threshold visibility and <code>pg_stat_statements</code> for aggregate statistics. Timeouts improve tail latency for everyone by removing pathological sessions early.</p>`,
  security: `<p>Logs can contain query text with personal data and literal secrets: restrict access to log files, prefer parameterised queries (parameters are logged separately and can be suppressed with <code>log_parameter_max_length = 0</code>), and avoid <code>log_statement = 'all'</code>. <code>log_connections</code> plus <code>log_disconnections</code> provide an access audit trail; for detailed auditing use <code>pgaudit</code> <span class="tag ext">extension</span>.</p>`,
  scenario: {
    title: 'Production readiness review of a new PostgreSQL server',
    steps: [
      '1. Run the audit query; record every setting at default that should not be.',
      '2. Network: listen_addresses = private IP; firewall; pg_hba.conf hostssl + scram-sha-256, explicit reject last.',
      '3. Connections: max_connections sized for pooler + admin + replication; superuser_reserved_connections = 5.',
      '4. Logging: slow statements, lock waits, autovacuum, temp files, checkpoints, connections, DDL; log_line_prefix with %u %d %a %h; ship logs.',
      '5. Timeouts: idle_in_transaction_session_timeout globally; statement/lock/transaction timeouts per role.',
      '6. Restart-level changes in a maintenance window; verify pending_restart is empty afterwards.'
    ]
  },
  widgets: ['diagram:prod-cluster'],
  interview: [
    { q: 'Which settings would you change first on a fresh production server?', a: 'Memory (shared_buffers, effective_cache_size, work_mem, maintenance_work_mem), WAL/checkpoints (max_wal_size, checkpoint_timeout), random_page_cost for SSD, logging (log_min_duration_statement, log_line_prefix, log_lock_waits, log_autovacuum_min_duration, log_temp_files), idle_in_transaction_session_timeout, listen_addresses with pg_hba.conf hardened, and per-role statement timeouts.' },
    { q: 'What is the difference between statement_timeout and lock_timeout?', a: 'statement_timeout limits the total runtime of a statement (including any lock waits). lock_timeout limits how long a statement waits to acquire any single lock. For migrations, lock_timeout is key: it prevents a DDL from waiting in the lock queue and blocking everyone behind it.' },
    { q: 'Why is idle_in_transaction_session_timeout important?', a: 'Abandoned open transactions hold locks and pin the xmin horizon, blocking vacuum database-wide. The timeout terminates such sessions automatically after the configured idle period.' },
    { q: 'Why not simply set max_connections to 5000?', a: 'Each connection is a process with its own memory and catalog caches; work_mem multiplies by active connections; snapshot and lock management costs rise; context switching hurts throughput. Use a connection pooler and keep server connections close to what the hardware can execute concurrently.' }
  ],
  exercises: [
    { task: 'Show log_line_prefix and explain its escapes by checking the current value.', solution: `SELECT name, setting, short_desc
FROM   pg_settings
WHERE  name IN ('log_line_prefix', 'log_destination', 'logging_collector');`, run: true },
    { task: 'Demonstrate idle_in_transaction_session_timeout being configurable per session: set it to 30s and show it.', solution: `SET idle_in_transaction_session_timeout = '30s';
SHOW idle_in_transaction_session_timeout;`, run: true },
    { task: 'List every timeout-related setting (name contains "timeout") with value and context.', solution: `SELECT name, current_setting(name) AS value, context
FROM   pg_settings
WHERE  name LIKE '%timeout%'
ORDER  BY name;`, run: true }
  ],
  challenge: {
    task: 'Write a DO block that sets lock_timeout to 1ms and statement_timeout to 200ms locally, then runs pg_sleep(0.5) inside a nested BEGIN/EXCEPTION, reporting which timeout fired via RAISE NOTICE, and finally returns a normal SELECT showing both settings were transaction-scoped (after the block, in a new transaction, they are back to default).',
    hint: 'Use SET LOCAL inside the DO block; catch query_canceled; after the DO, run SHOW statements.',
    solution: `DO $$
BEGIN
  SET LOCAL lock_timeout = '1ms';
  SET LOCAL statement_timeout = '200ms';
  BEGIN
    PERFORM pg_sleep(0.5);
  EXCEPTION WHEN query_canceled THEN
    RAISE NOTICE 'cancelled: %', SQLERRM;
  END;
END $$;
SELECT current_setting('lock_timeout') AS lock_timeout,
       current_setting('statement_timeout') AS statement_timeout;`,
    run: true
  },
  related: ['configuration-files-contexts', 'configuration-set-alter-system', 'monitoring-locks-connections', 'security', 'production-architecture-zero-downtime'],
  quiz: [
    { type: 'mcq', q: 'Which setting logs every statement slower than a threshold?', options: ['log_statement', 'log_min_duration_statement', 'log_min_messages', 'log_duration'], answer: 1, explain: 'log_min_duration_statement logs statement text plus duration when it exceeds the threshold.' },
    { type: 'mcq', q: 'Which timeout terminates sessions that sit idle inside an open transaction?', options: ['idle_session_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout', 'tcp_keepalives_idle'], answer: 2, explain: 'idle_in_transaction_session_timeout terminates the session after the idle period inside a transaction.' },
    { type: 'tf', q: 'listen_addresses can be changed with a reload.', answer: false, explain: 'It is postmaster context; a restart is required.' },
    { type: 'scenario', q: 'A migration needs AccessExclusiveLock on a busy table. Which setting prevents it from causing a pile-up?', options: ['statement_timeout = 0', 'lock_timeout = \'3s\' with retries', 'deadlock_timeout = 10s', 'max_locks_per_transaction = 1024'], answer: 1, explain: 'lock_timeout makes the DDL give up quickly instead of sitting in the lock queue blocking all subsequent queries.' }
  ]
}
]);

/* ---------------------- PRODUCTION ARCHITECTURE ---------------------- */
PGM.addLessons([
{
  id: 'production-architecture-migrations',
  module: 'production-architecture',
  title: 'Database Migrations: Schema Versioning, Migration Files, Rollbacks and Tools',
  level: 6,
  minutes: 22,
  summary: 'Treat schema as code: versioned migration files, a migration history table, forward-only vs reversible migrations, transactional DDL, and how Flyway, Liquibase, EF Core, Alembic and Prisma implement the same idea.',
  objectives: [
    'Explain why schema changes must be versioned, ordered and repeatable',
    'Design a migration history table with checksums and locking',
    'Write forward and rollback (down) migrations and know when rollback is unrealistic',
    'Use PostgreSQL transactional DDL and advisory locks to make migrations safe',
    'Compare common migration tools conceptually (Flyway, Liquibase, EF Core, Alembic, Prisma)'
  ],
  concept: `<p>A <strong>migration</strong> is a small, ordered, immutable script that moves the schema from version N to N+1 (e.g. <code>V042__add_orders_currency.sql</code>). The database records which migrations have run in a <strong>history table</strong>, so every environment — laptop, CI, staging, production — converges to the same schema by applying the missing scripts in order.</p>
<p><strong>Analogy:</strong> git for your schema. Each migration is a commit; the history table is the database's <code>git log</code>; deploying is <code>git pull</code> — apply what you are missing, in order. You never rewrite a commit that others have already pulled (never edit an applied migration); you add a new one.</p>
<h4>Core rules</h4>
<ul>
<li><strong>Immutable</strong>: once applied anywhere shared, a migration file never changes (tools store a checksum to detect edits).</li>
<li><strong>Ordered</strong>: version numbers or timestamps define order; merges of parallel branches need care.</li>
<li><strong>Idempotent environment, not idempotent scripts</strong>: the history table guarantees each script runs once; scripts may still use <code>IF NOT EXISTS</code> for safety.</li>
<li><strong>One logical change per migration</strong>, small enough to review and to reason about locks.</li>
<li><strong>Serialised</strong>: only one migrator at a time (tools take a lock — often a PostgreSQL advisory lock).</li>
</ul>
<h4>Forward vs rollback</h4>
<p>Many tools support "down" migrations. In production, true rollback is often impossible once data was written in the new shape (a dropped column's data is gone). Mature teams prefer <strong>roll-forward</strong>: fix a bad migration with a new migration, and make each change backward-compatible (expand/contract, next lesson) so the previous application version still works.</p>
<h4>Tools <span class="tag tool">third-party tool</span></h4>
<table>
<tr><th>Tool</th><th>Ecosystem</th><th>Style</th><th>History table</th></tr>
<tr><td>Flyway</td><td>JVM / CLI</td><td>Plain SQL files <code>V1__x.sql</code>, repeatable <code>R__x.sql</code></td><td><code>flyway_schema_history</code></td></tr>
<tr><td>Liquibase</td><td>JVM / CLI</td><td>Changelogs (XML/YAML/JSON/SQL) with changesets, rollback blocks</td><td><code>databasechangelog</code> + lock table</td></tr>
<tr><td>EF Core Migrations</td><td>.NET</td><td>Generated C# from model diffs (<code>Up()</code>/<code>Down()</code>), can emit SQL scripts</td><td><code>__EFMigrationsHistory</code></td></tr>
<tr><td>Alembic</td><td>Python / SQLAlchemy</td><td>Python revision files with <code>upgrade()</code>/<code>downgrade()</code>, DAG of revisions</td><td><code>alembic_version</code></td></tr>
<tr><td>Prisma Migrate</td><td>Node / TypeScript</td><td>SQL generated from <code>schema.prisma</code> diffs</td><td><code>_prisma_migrations</code></td></tr>
</table>`,
  why: `<p>Without migrations, schemas drift: production has a column staging lacks, an index someone added by hand disappears on the next rebuild, and nobody can recreate the database from scratch. Versioned migrations make schema changes reviewable (pull requests), testable (CI applies them to a fresh database), auditable (who changed what and when) and repeatable across hundreds of environments or tenants.</p>`,
  useCase: `<p>A fintech with 40 engineers deploys 25 times a day. Migrations live next to code (<code>db/migrations/V2026_10_05_1130__add_payment_method.sql</code>); CI spins up PostgreSQL 18, applies all migrations from zero, runs the catalog lint queries (missing FK indexes, tables without PKs), runs tests, and generates the migration SQL for review. Production deploys run Flyway with <code>lock_timeout</code> set, before the app rollout; any migration taking an ACCESS EXCLUSIVE lock on a large table must be marked and approved by a DBA.</p>`,
  internals: `<p>PostgreSQL's <strong>transactional DDL</strong> is a huge advantage: <code>CREATE TABLE</code>, <code>ALTER TABLE</code>, <code>CREATE INDEX</code> and most DDL can run inside a transaction and roll back atomically, so a failed migration leaves no half-applied schema (unlike MySQL, where each DDL commits implicitly). Exceptions that cannot run in a transaction block: <code>CREATE/DROP INDEX CONCURRENTLY</code>, <code>REINDEX CONCURRENTLY</code>, <code>VACUUM</code>, <code>CREATE DATABASE</code>, <code>ALTER SYSTEM</code>, and <code>ALTER TYPE … ADD VALUE</code> before PG12 — tools let you mark such migrations as non-transactional.</p>
<p>To prevent two deploys migrating concurrently, tools take a lock: a row lock on a lock table (Liquibase) or a session-level <strong>advisory lock</strong> such as <code>pg_advisory_lock(hash)</code> (Flyway, EF Core in recent versions). DDL itself takes table locks (often ACCESS EXCLUSIVE), so every migration should set <code>lock_timeout</code>.</p>`,
  whenNot: `<p>Do not run migrations automatically on every application instance start in a horizontally scaled service (20 pods racing, long migrations blocking startup and health checks) — run them once per deploy as a separate job. Do not rely on ORM auto-sync (<code>synchronize: true</code>, <code>EnsureCreated()</code>, <code>db push</code>) in production; it generates unreviewed, possibly destructive changes. Do not put large data backfills in the same transaction as DDL.</p>`,
  syntax: `-- File naming (Flyway style)
V001__create_customers.sql
V002__add_customers_country_index.sql
R__refresh_reporting_views.sql        -- repeatable (re-run when checksum changes)

-- Inside a migration
SET lock_timeout = '3s';
BEGIN;
  ALTER TABLE ...;
  INSERT INTO schema_migrations (version, description, checksum) VALUES (...);
COMMIT;`,
  examples: [
    {
      label: 'Basic',
      title: 'Design a migration history table',
      sql: `CREATE SCHEMA IF NOT EXISTS migrations;

CREATE TABLE migrations.schema_migrations (
  version        text        PRIMARY KEY,               -- e.g. '2026.10.05.1130'
  description    text        NOT NULL,
  script         text        NOT NULL,                  -- file name
  checksum       text        NOT NULL,                  -- detect edited files
  installed_by   text        NOT NULL DEFAULT current_user,
  installed_at   timestamptz NOT NULL DEFAULT now(),
  execution_ms   integer     NOT NULL CHECK (execution_ms >= 0),
  success        boolean     NOT NULL
);

INSERT INTO migrations.schema_migrations
       (version, description, script, checksum, execution_ms, success)
VALUES ('2026.10.01.0900', 'create customers',       'V2026.10.01.0900__create_customers.sql',   md5('create table customers ...'), 41, true),
       ('2026.10.05.1130', 'add customers country idx','V2026.10.05.1130__customers_country.sql', md5('create index ...'),            1200, true);

SELECT version, description, installed_by, execution_ms, success
FROM   migrations.schema_migrations
ORDER  BY version;`,
      explain: `<p>Every tool's history table has the same essentials: a version (primary key, sortable), a description, the script name, a <strong>checksum</strong> of the file content (if someone edits an applied migration, validation fails), who/when, duration, and success. Duration history is valuable: if migration 117 took 40 minutes on staging, you know before it hits production. Here we compute checksums with <code>md5()</code> for illustration; tools compute CRC32/SHA over the file.</p>`,
      output: ` version         | description               | installed_by | execution_ms | success
-----------------+---------------------------+--------------+--------------+---------
 2026.10.01.0900 | create customers          | postgres     |           41 | t
 2026.10.05.1130 | add customers country idx | postgres     |         1200 | t`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'A safe forward migration with its rollback',
      sql: `-- V2026.10.05.1200__add_customer_tier.sql  (UP)
SET lock_timeout = '3s';
BEGIN;
ALTER TABLE customers ADD COLUMN tier text NOT NULL DEFAULT 'standard'
      CHECK (tier IN ('standard', 'gold', 'platinum'));
COMMENT ON COLUMN customers.tier IS 'Loyalty tier; added 2026-10-05 (TICKET-4512)';
SELECT column_name, data_type, column_default
FROM   information_schema.columns
WHERE  table_name = 'customers' AND column_name = 'tier';
ROLLBACK;   -- playground: undo; a real migration would COMMIT

-- U2026.10.05.1200__add_customer_tier.sql  (DOWN / undo)
-- BEGIN;
-- ALTER TABLE customers DROP COLUMN tier;
-- COMMIT;`,
      explain: `<p>The UP migration sets <code>lock_timeout</code> (the ALTER needs ACCESS EXCLUSIVE briefly), adds a column with a constant default — metadata-only since PG11, no table rewrite — plus a CHECK constraint (validated against existing rows, which all get the default) and documents the change with a comment. Everything is in one transaction: if any statement fails, nothing is applied. The DOWN script is shown commented: dropping the column loses any tier data written since — which is why teams often prefer roll-forward over rollback.</p>`,
      output: `SET
BEGIN
ALTER TABLE
COMMENT
 column_name | data_type | column_default
-------------+-----------+--------------------
 tier        | text      | 'standard'::text
ROLLBACK`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Serialise migrators with an advisory lock and detect drift',
      sql: `-- 1) Only one migrator at a time: transaction-scoped advisory lock
BEGIN;
SELECT pg_try_advisory_xact_lock(hashtext('schema-migrations')) AS got_lock;
-- ... apply pending migrations here ...
SELECT locktype, objid, mode, granted
FROM   pg_locks
WHERE  locktype = 'advisory' AND pid = pg_backend_pid();
ROLLBACK;   -- lock released at transaction end

-- 2) Drift detection: fingerprint the live schema
SELECT md5(string_agg(format('%s.%s:%s:%s', table_schema, table_name, column_name, data_type),
                      ',' ORDER BY table_schema, table_name, ordinal_position)) AS schema_fingerprint,
       count(*) AS columns
FROM   information_schema.columns
WHERE  table_schema = 'public';`,
      explain: `<p><code>pg_try_advisory_xact_lock</code> returns <code>true</code> if this session got the lock, <code>false</code> immediately if another migrator holds it (the non-blocking variant is better for deploy jobs: fail fast and retry). The transaction-scoped version releases automatically at COMMIT/ROLLBACK. The fingerprint query hashes all column definitions; store it after each deploy and compare across environments — a mismatch means someone changed a schema outside the migration process (drift).</p>`,
      output: ` got_lock
----------
 t

 locktype | objid      | mode          | granted
----------+------------+---------------+---------
 advisory |  185367325 | ExclusiveLock | t

 schema_fingerprint               | columns
----------------------------------+---------
 22d0e4a5dffbf4d00cbc8a6d0e6fccfa |      82`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Editing an already-applied migration in place to "fix" it
-- V041__add_index.sql (changed after it ran in production)
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id, order_date);`, why: 'Environments that already ran the old version never get the change; the checksum no longer matches; schemas silently diverge between environments.', run: true },
    good: { sql: `-- V042__replace_orders_customer_index.sql (new migration)
CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date);
DROP INDEX IF EXISTS idx_orders_customer;`, why: 'A new, ordered migration applies the change everywhere consistently and leaves an audit trail. (In production, use CONCURRENTLY in a non-transactional migration.)', run: true }
  },
  mistakes: [
    `Editing applied migrations instead of adding new ones.`,
    `Running migrations from every app instance at startup, causing races and long boot times.`,
    `Mixing huge data backfills with DDL in one transaction — long locks and huge transactions.`,
    `Relying on down-migrations for production recovery when the change destroyed data.`,
    `No <code>lock_timeout</code>: a migration waiting for a lock blocks all traffic on the table.`,
    `Using ORM auto-sync features against production databases.`
  ],
  best: [
    `Keep migrations in the same repository as the application; review them like code.`,
    `CI: apply all migrations to an empty database and to a production-like snapshot; run catalog lints.`,
    `Every migration sets <code>lock_timeout</code> (and optionally <code>statement_timeout</code>); mark non-transactional ones (CONCURRENTLY) explicitly.`,
    `Prefer backward-compatible, roll-forward migrations (expand/contract).`,
    `Record duration per migration and per environment; flag anything slow before production.`
  ],
  performance: `<p>Migration performance is about locks and rewrites: metadata-only changes (add nullable column, add column with constant default, drop column, rename) take milliseconds but still need a brief ACCESS EXCLUSIVE lock; rewrites (change column type incompatibly, add a volatile default, <code>SET NOT NULL</code> without a validated CHECK on old versions) copy the whole table under lock. Index builds without CONCURRENTLY block writes for their duration.</p>`,
  security: `<p>Run migrations with a dedicated migration role that owns the schema objects; the application role should have only DML privileges (no DDL). Store credentials for the migrator in the deploy system, not in the app. Review migrations for privilege changes (<code>GRANT</code>, <code>ALTER DEFAULT PRIVILEGES</code>, RLS policies) as security-relevant code.</p>`,
  scenario: {
    title: 'A deploy failed halfway through migration 087',
    steps: [
      '1. Check the history table: is 087 recorded as failed or absent? Thanks to transactional DDL, a transactional migration is fully rolled back.',
      '2. For a non-transactional migration (CONCURRENTLY), check for invalid indexes (pg_index.indisvalid = false) and clean up.',
      '3. Fix forward: write 088 (or fix 087 only if it never succeeded anywhere shared and the tool supports repair).',
      '4. Re-run the deploy; verify schema fingerprint matches staging.',
      '5. Post-mortem: add the failing scenario to CI (e.g. test against a production-sized snapshot).'
    ]
  },
  widgets: ['diagram:prod-cluster'],
  interview: [
    { q: 'How do database migration tools know what to apply?', a: 'They keep a history table in the database recording applied versions with checksums. On deploy, they compare the migration files with the table, validate checksums, take a lock to serialise, and apply missing migrations in version order, recording each one.' },
    { q: 'Why is transactional DDL valuable for migrations?', a: 'In PostgreSQL most DDL can run inside a transaction, so a migration either applies completely or not at all. A failure halfway leaves no partial schema to clean up. Exceptions like CREATE INDEX CONCURRENTLY must be run outside a transaction.' },
    { q: 'Should you rely on down migrations in production?', a: 'Rarely. Once the new schema has accepted writes, reversing may lose data (e.g. dropping a column). Prefer backward-compatible changes and roll forward with a new migration; keep down migrations mainly for development.' },
    { q: 'How do you prevent two deploys from migrating at once?', a: 'Take a lock: a PostgreSQL advisory lock (pg_advisory_lock / pg_try_advisory_lock) or a lock-table row. Most tools do this automatically; deploy pipelines should also serialise migration jobs.' }
  ],
  exercises: [
    { task: 'Create a minimal schema_version table with a version primary key and applied_at timestamp, insert two versions, and select the latest.', solution: `CREATE TABLE schema_version (
  version    int PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_version (version) VALUES (1), (2);
SELECT max(version) AS current_version FROM schema_version;`, run: true },
    { task: 'Show that DDL is transactional: create a table inside a transaction, roll back, and prove it does not exist.', solution: `BEGIN;
CREATE TABLE will_vanish (id int);
ROLLBACK;
SELECT to_regclass('will_vanish') AS table_exists;`, run: true },
    { task: 'Take a transaction-level advisory lock keyed by the text "deploy" and confirm it is held.', solution: `BEGIN;
SELECT pg_advisory_xact_lock(hashtext('deploy'));
SELECT count(*) AS advisory_locks_held
FROM   pg_locks
WHERE  locktype = 'advisory' AND pid = pg_backend_pid();
ROLLBACK;`, run: true }
  ],
  challenge: {
    task: 'Write a function apply_migration(version text, description text, ddl text) that, in one transaction, takes an advisory xact lock, refuses to run if the version is already recorded, executes the DDL with EXECUTE, and records version, description and md5(ddl). Use it to add a nullable column notes to departments, and show the history.',
    hint: 'PL/pgSQL with EXISTS check and RAISE EXCEPTION; EXECUTE ddl; INSERT into a history table.',
    solution: `CREATE TABLE migration_history (
  version     text PRIMARY KEY,
  description text NOT NULL,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION apply_migration(p_version text, p_description text, p_ddl text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('migrations'));
  IF EXISTS (SELECT 1 FROM migration_history WHERE version = p_version) THEN
    RAISE EXCEPTION 'migration % already applied', p_version;
  END IF;
  EXECUTE p_ddl;
  INSERT INTO migration_history (version, description, checksum)
  VALUES (p_version, p_description, md5(p_ddl));
  RETURN 'applied ' || p_version;
END $$;
SELECT apply_migration('001', 'add departments.notes',
                       'ALTER TABLE departments ADD COLUMN notes text');
SELECT version, description, checksum FROM migration_history;`,
    run: true
  },
  related: ['production-architecture-zero-downtime', 'production-architecture-ecommerce-design', 'system-catalogs-dba-toolkit', 'transactions'],
  quiz: [
    { type: 'mcq', q: 'Why do migration tools store a checksum per migration?', options: ['To compress files', 'To detect that an already-applied migration file was modified', 'To speed up execution', 'For encryption'], answer: 1, explain: 'A changed checksum means the file differs from what ran, signalling drift.' },
    { type: 'tf', q: 'CREATE INDEX CONCURRENTLY can run inside a migration transaction.', answer: false, explain: 'It cannot run inside a transaction block; mark the migration non-transactional.' },
    { type: 'mcq', q: 'Which table does EF Core use to record applied migrations?', options: ['flyway_schema_history', '__EFMigrationsHistory', 'alembic_version', 'databasechangelog'], answer: 1, explain: '__EFMigrationsHistory; Flyway uses flyway_schema_history, Alembic alembic_version, Liquibase databasechangelog.' },
    { type: 'scenario', q: 'A migration dropped a column in v2; v2 has a bug and you need v1 back. Best approach?', options: ['Run the down migration to re-add the column', 'Roll forward: deploy a fix; restoring dropped data needs PITR — avoid by using expand/contract (drop only after v1 is gone)', 'Edit the v2 migration', 'Restart the database'], answer: 1, explain: 'Re-adding the column does not restore its data. Design changes so old versions keep working until the contract phase.' }
  ]
},
{
  id: 'production-architecture-zero-downtime',
  module: 'production-architecture',
  title: 'Zero-Downtime Migrations: Expand/Contract, Safe DDL, Concurrent Indexes and Batched Backfills',
  level: 6,
  minutes: 28,
  summary: 'Change schemas on busy production tables without outages: the expand/contract pattern, which DDL is instant vs rewriting, NOT NULL via CHECK NOT VALID, CREATE INDEX CONCURRENTLY, lock_timeout with retries, and batched backfills.',
  objectives: [
    'Apply the expand/contract pattern to add, rename, change and remove columns',
    'Know which ALTER TABLE operations are metadata-only and which rewrite or scan the table',
    'Add NOT NULL and foreign keys without long locks (NOT VALID + VALIDATE)',
    'Build and drop indexes concurrently and handle failures',
    'Backfill large tables in small committed batches with lock_timeout and retries'
  ],
  concept: `<p>On a busy table, the danger of DDL is rarely the work itself — it is the <strong>lock</strong>. Most <code>ALTER TABLE</code> forms need an ACCESS EXCLUSIVE lock; while waiting for it (behind a long query) they block every new query on the table, and while holding it during a rewrite they block everything for minutes or hours. Zero-downtime migration is the discipline of keeping every lock <strong>short</strong> and every step <strong>backward compatible</strong>.</p>
<p><strong>Analogy:</strong> renovating a busy road bridge. You do not close the bridge for a month. You build the new lane next to the old one (expand), divert traffic gradually (dual writes, backfill), and only when nobody uses the old lane do you remove it (contract). Each lane switch takes seconds, done at low traffic, with a flagger who stops the work if traffic backs up (lock_timeout).</p>
<h4>Expand / contract in six steps (e.g. rename <code>customers.name</code> → <code>full_name</code>)</h4>
<ol>
<li><strong>Expand</strong>: add the new column (nullable, instant).</li>
<li><strong>Dual write</strong>: deploy code that writes both columns (or a trigger that syncs them).</li>
<li><strong>Backfill</strong>: copy old → new in small batches.</li>
<li><strong>Switch reads</strong>: deploy code reading the new column.</li>
<li><strong>Enforce</strong>: add constraints (NOT NULL via CHECK NOT VALID → VALIDATE).</li>
<li><strong>Contract</strong>: stop writing the old column, then drop it in a later release.</li>
</ol>
<h4>Cheat sheet (PostgreSQL 11+)</h4>
<table>
<tr><th>Operation</th><th>Cost</th><th>Safe approach</th></tr>
<tr><td>ADD COLUMN (nullable, or constant/immutable default)</td><td>Metadata only (PG11+)</td><td>With lock_timeout</td></tr>
<tr><td>ADD COLUMN with volatile default (e.g. <code>clock_timestamp()</code>, <code>gen_random_uuid()</code>)</td><td>Full rewrite</td><td>Add nullable, backfill in batches, then set default</td></tr>
<tr><td>DROP COLUMN</td><td>Metadata only (space reclaimed later)</td><td>After code no longer references it</td></tr>
<tr><td>RENAME COLUMN / TABLE</td><td>Metadata only</td><td>Breaks running code → expand/contract or a compatibility view</td></tr>
<tr><td>ALTER COLUMN TYPE</td><td>Rewrite + index rebuild (except binary-compatible, e.g. varchar(n)→text, increasing varchar length)</td><td>New column + backfill + swap</td></tr>
<tr><td>SET NOT NULL</td><td>Full scan under ACCESS EXCLUSIVE</td><td>CHECK (col IS NOT NULL) NOT VALID → VALIDATE → SET NOT NULL (skips scan, PG12+) → drop CHECK</td></tr>
<tr><td>ADD FOREIGN KEY / CHECK</td><td>Scan while holding lock</td><td>ADD … NOT VALID (instant) → VALIDATE CONSTRAINT (SHARE UPDATE EXCLUSIVE, allows writes)</td></tr>
<tr><td>CREATE INDEX</td><td>Blocks writes for the whole build</td><td>CREATE INDEX CONCURRENTLY</td></tr>
<tr><td>ADD PRIMARY KEY / UNIQUE</td><td>Builds an index under lock</td><td>CREATE UNIQUE INDEX CONCURRENTLY → ADD CONSTRAINT … USING INDEX</td></tr>
</table>`,
  why: `<p>Modern products deploy many times a day and cannot schedule maintenance windows. A single careless <code>ALTER TABLE orders ALTER COLUMN total TYPE numeric(14,2)</code> on a 300GB table can take an hour under an exclusive lock — a full outage. Knowing the safe patterns lets teams evolve schemas continuously without customer impact.</p>`,
  useCase: `<p>A food-delivery app needs <code>orders.id</code> to move from <code>integer</code> to <code>bigint</code> at 1.9 billion rows (approaching the 2.1B limit). Plan: add <code>id_new bigint</code>; a trigger copies <code>id</code> into <code>id_new</code> for new rows; a background job backfills 10,000 rows per batch over 9 days (throttled by replica lag); <code>CREATE UNIQUE INDEX CONCURRENTLY</code> on <code>id_new</code>; in a 2-second window with <code>lock_timeout</code> and retries: swap column names, swap the primary key using the prepared index, update sequence ownership and FKs (prepared as NOT VALID and validated). Total customer-visible impact: under 3 seconds of elevated latency.</p>`,
  internals: `<p><strong>Fast defaults (PG11+):</strong> for a non-volatile default, PostgreSQL stores the value in <code>pg_attribute.attmissingval</code> (<code>atthasmissing = true</code>); existing rows physically lack the column and readers substitute the stored value. No rewrite. <strong>NOT VALID constraints</strong> are enforced for new writes immediately but existing rows are not checked; <code>VALIDATE CONSTRAINT</code> scans with only a SHARE UPDATE EXCLUSIVE lock (reads and writes continue). When a valid <code>CHECK (col IS NOT NULL)</code> exists, <code>SET NOT NULL</code> skips the full-table scan (PG12+). PostgreSQL 18 can also add a NOT NULL constraint as <code>NOT VALID</code> directly (<code>ALTER TABLE t ADD CONSTRAINT c NOT NULL col NOT VALID</code>) and validate it later.</p>
<p><strong>CREATE INDEX CONCURRENTLY</strong> builds the index in multiple phases with only a SHARE UPDATE EXCLUSIVE lock: it waits for existing transactions, scans the table, then scans again to catch changes, waiting for older snapshots between phases. It takes longer and cannot run in a transaction block; if it fails, it leaves an <em>invalid</em> index (<code>indisvalid = false</code>) that must be dropped (<code>DROP INDEX CONCURRENTLY</code>) and retried. <strong>Lock queue:</strong> a waiting ACCESS EXCLUSIVE request blocks later requests, so <code>lock_timeout</code> is essential: fail fast, retry with backoff.</p>`,
  whenNot: `<p>For small tables (a few thousand rows) and low traffic, the simple direct DDL is fine — do not over-engineer. For changes affecting most rows of huge tables (type changes on billions of rows), consider logical replication into a new table/cluster or tools such as <code>pg_repack</code> <span class="tag tool">third-party tool</span> / <code>pgroll</code> <span class="tag tool">third-party tool</span> rather than hand-rolled triggers. Never run backfills as one giant UPDATE: it creates one huge transaction, bloats the table by the full row count, and lags replicas.</p>`,
  syntax: `SET lock_timeout = '3s';                                     -- every migration
ALTER TABLE t ADD COLUMN c text;                              -- instant
ALTER TABLE t ADD CONSTRAINT c_nn CHECK (c IS NOT NULL) NOT VALID;
ALTER TABLE t VALIDATE CONSTRAINT c_nn;                       -- no write blocking
ALTER TABLE t ALTER COLUMN c SET NOT NULL;                    -- uses the valid CHECK
ALTER TABLE t DROP CONSTRAINT c_nn;
ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (x) REFERENCES p (id) NOT VALID;
ALTER TABLE t VALIDATE CONSTRAINT fk;
CREATE INDEX CONCURRENTLY idx ON t (c);                       -- outside a transaction
ALTER TABLE t ADD CONSTRAINT t_uq UNIQUE USING INDEX idx_uq;  -- after CONCURRENTLY build`,
  examples: [
    {
      label: 'Basic',
      title: 'Adding a column with a default is instant — volatile defaults are not',
      sql: `-- Constant default: metadata only (PG11+). Existing rows read the "missing value".
ALTER TABLE orders ADD COLUMN channel text NOT NULL DEFAULT 'web';

SELECT attname, atthasmissing, attmissingval
FROM   pg_attribute
WHERE  attrelid = 'orders'::regclass AND attname = 'channel';

SELECT relfilenode AS before FROM pg_class WHERE relname = 'orders';
-- Volatile default: every existing row needs its own value -> full table rewrite
ALTER TABLE orders ADD COLUMN created_trace timestamptz DEFAULT clock_timestamp();
SELECT relfilenode AS after_volatile_default FROM pg_class WHERE relname = 'orders';`,
      explain: `<p>The constant default is stored once in <code>attmissingval</code> (<code>atthasmissing = true</code>) — no row is touched, so even a billion-row table changes in milliseconds (still needs a brief ACCESS EXCLUSIVE lock: use lock_timeout). A <strong>volatile</strong> default like <code>clock_timestamp()</code> must be evaluated per row, so PostgreSQL rewrites the whole table — visible as a new <code>relfilenode</code>. On a large table that is a long outage; instead add the column without default, backfill in batches, then <code>ALTER COLUMN … SET DEFAULT</code> for new rows.</p>`,
      output: ` attname | atthasmissing | attmissingval
---------+---------------+---------------
 channel | t             | {web}

 before
--------
  16517

 after_volatile_default
------------------------
                  24589     -- new file: the table was rewritten (number varies)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'NOT NULL and FOREIGN KEY without long locks',
      sql: `SET lock_timeout = '3s';

-- 1) New column, populated for all rows (in production: batched backfill)
ALTER TABLE customers ADD COLUMN country_code char(2);
UPDATE customers SET country_code = CASE country
         WHEN 'India' THEN 'IN' WHEN 'USA' THEN 'US' WHEN 'UK' THEN 'GB'
         WHEN 'Germany' THEN 'DE' WHEN 'Singapore' THEN 'SG' WHEN 'UAE' THEN 'AE' END;

-- 2) NOT NULL the safe way
ALTER TABLE customers ADD CONSTRAINT customers_country_code_nn
      CHECK (country_code IS NOT NULL) NOT VALID;         -- instant, enforced for new rows
ALTER TABLE customers VALIDATE CONSTRAINT customers_country_code_nn;  -- scan, writes allowed
ALTER TABLE customers ALTER COLUMN country_code SET NOT NULL;         -- no scan: CHECK proves it
ALTER TABLE customers DROP CONSTRAINT customers_country_code_nn;

-- 3) Foreign key the safe way
CREATE TABLE countries (code char(2) PRIMARY KEY, name text NOT NULL);
INSERT INTO countries VALUES ('IN','India'),('US','USA'),('GB','UK'),('DE','Germany'),('SG','Singapore'),('AE','UAE');
ALTER TABLE customers ADD CONSTRAINT customers_country_fk
      FOREIGN KEY (country_code) REFERENCES countries (code) NOT VALID;
ALTER TABLE customers VALIDATE CONSTRAINT customers_country_fk;

SELECT conname, contype, convalidated
FROM   pg_constraint
WHERE  conrelid = 'customers'::regclass AND conname LIKE 'customers_country%';`,
      explain: `<p>Plain <code>SET NOT NULL</code> scans the whole table while holding ACCESS EXCLUSIVE. The four-step dance moves the scan to <code>VALIDATE CONSTRAINT</code>, which holds only SHARE UPDATE EXCLUSIVE (reads and writes keep flowing); then <code>SET NOT NULL</code> sees the validated CHECK and skips its own scan. Foreign keys follow the same NOT VALID → VALIDATE pattern. <code>convalidated = t</code> confirms both constraints are fully validated (the NOT NULL now appears as a <code>contype = 'n'</code> row in PG18).</p>`,
      output: ` conname                         | contype | convalidated
---------------------------------+---------+--------------
 customers_country_code_not_null | n       | t
 customers_country_fk            | f       | t
 customers_country_not_null      | n       | t      -- the pre-existing NOT NULL on country`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Concurrent index + batched backfill with COMMIT per batch',
      sql: `-- Runs outside a transaction block (each statement autocommits)
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY idx_orders_customer_date ON orders (customer_id, order_date);

SELECT indexrelid::regclass AS index_name, indisvalid, indisready
FROM   pg_index
WHERE  indexrelid = 'idx_orders_customer_date'::regclass;

-- Batched backfill: small transactions, resumable, throttle-able
ALTER TABLE order_items ADD COLUMN line_total numeric(14,2);

CREATE PROCEDURE backfill_line_total(batch_size int DEFAULT 2000)
LANGUAGE plpgsql AS $$
DECLARE
  rows_done int;
BEGIN
  LOOP
    UPDATE order_items
    SET    line_total = quantity * unit_price
    WHERE  id IN (SELECT id FROM order_items
                  WHERE line_total IS NULL
                  ORDER BY id
                  LIMIT batch_size
                  FOR UPDATE SKIP LOCKED);
    GET DIAGNOSTICS rows_done = ROW_COUNT;
    EXIT WHEN rows_done = 0;
    COMMIT;                          -- release locks, let vacuum/replicas keep up
    -- PERFORM pg_sleep(0.1);        -- throttle in production
  END LOOP;
END $$;

CALL backfill_line_total(2000);
SELECT count(*) FILTER (WHERE line_total IS NULL) AS remaining,
       count(*)                                    AS total
FROM   order_items;`,
      explain: `<p><code>CREATE INDEX CONCURRENTLY</code> builds without blocking writes; afterwards confirm <code>indisvalid = t</code> (a failed build leaves an invalid index to drop and retry). The backfill procedure updates 2,000 rows at a time and <strong>commits after each batch</strong> (procedures may COMMIT since PG11): locks are held briefly, autovacuum can clean up between batches, replicas do not fall far behind, and if the job dies it simply resumes (the <code>WHERE line_total IS NULL</code> predicate makes it idempotent). <code>FOR UPDATE SKIP LOCKED</code> avoids fighting with application writes. In production add a sleep and monitor replica lag.</p>`,
      output: `CREATE INDEX
 index_name               | indisvalid | indisready
--------------------------+------------+------------
 idx_orders_customer_date | t          | t
ALTER TABLE
CREATE PROCEDURE
CALL
 remaining | total
-----------+-------
         0 | 12500`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- One statement, one lock, one huge transaction
ALTER TABLE order_items ADD COLUMN line_total numeric(14,2);
UPDATE order_items SET line_total = quantity * unit_price;   -- all rows at once
ALTER TABLE order_items ALTER COLUMN line_total SET NOT NULL; -- full scan under ACCESS EXCLUSIVE`, why: 'On a large table: one giant transaction (bloat equal to the table size, replica lag, long row locks), then a full scan under an exclusive lock. Fine for 12,500 rows, an outage for 500 million.', run: true },
    good: { sql: `SET lock_timeout = '3s';
ALTER TABLE order_items ADD COLUMN line_total numeric(14,2);
-- backfill in batches (see example), then:
UPDATE order_items SET line_total = quantity * unit_price WHERE id <= 2000;  -- one batch shown
UPDATE order_items SET line_total = quantity * unit_price WHERE line_total IS NULL;
ALTER TABLE order_items ADD CONSTRAINT oi_line_total_nn CHECK (line_total IS NOT NULL) NOT VALID;
ALTER TABLE order_items VALIDATE CONSTRAINT oi_line_total_nn;
ALTER TABLE order_items ALTER COLUMN line_total SET NOT NULL;
ALTER TABLE order_items DROP CONSTRAINT oi_line_total_nn;`, why: 'Short locks (lock_timeout bounded), batched backfill, validation without blocking writes, and SET NOT NULL that skips the scan thanks to the validated CHECK.', run: true }
  },
  mistakes: [
    `Running <code>ALTER TABLE</code> on a hot table without <code>lock_timeout</code>.`,
    `Renaming or dropping a column in the same release that stops using it — old app instances still running crash.`,
    `<code>ALTER COLUMN … TYPE</code> on a large table assuming it is quick (it rewrites the table and rebuilds indexes unless binary-compatible).`,
    `Forgetting that <code>CREATE INDEX CONCURRENTLY</code> can fail and leave an invalid index.`,
    `Backfilling with one massive UPDATE.`,
    `Adding a column with a volatile default (now() is fine — it is stable; <code>clock_timestamp()</code>/<code>random()</code>/<code>gen_random_uuid()</code> are volatile and rewrite).`
  ],
  best: [
    `Always: <code>SET lock_timeout = '2s'..'5s'</code> + automatic retries with backoff.`,
    `Expand/contract: never remove or rename something the currently deployed code still uses.`,
    `Constraints via NOT VALID + VALIDATE; NOT NULL via validated CHECK; unique constraints via concurrent unique index + USING INDEX.`,
    `Backfill in batches of 1k–50k rows, committed, throttled by replica lag, idempotent and resumable.`,
    `Test migrations against a production-size copy to measure duration and lock behaviour.`
  ],
  performance: `<p>The real cost of DDL on large tables is lock duration × traffic. Metadata-only changes cost milliseconds once the lock is acquired. Concurrent index builds take roughly 2–3× longer than normal builds and need extra IO, but keep the table writable. Batched backfills generate the same WAL as a single UPDATE but spread it out; each batch creates dead tuples that autovacuum must clean — keep batches small enough that autovacuum and replicas keep up, and consider raising per-table autovacuum aggressiveness during the backfill.</p>`,
  security: `<p>Triggers used for dual-writes and procedures used for backfills run with the migrator's privileges — keep them in the migration schema, review them, and drop them during the contract phase. Temporary compatibility views must carry the same privileges (and <code>security_barrier</code>/<code>security_invoker</code> settings) as the tables they replace, or they may expose data.</p>`,
  scenario: {
    title: 'Rename customers.name to full_name with zero downtime',
    steps: [
      '1. Release A (expand): ALTER TABLE customers ADD COLUMN full_name text; plus a trigger keeping full_name = name on INSERT/UPDATE.',
      '2. Backfill: batched UPDATE customers SET full_name = name WHERE full_name IS NULL, committed per batch.',
      '3. Enforce: CHECK (full_name IS NOT NULL) NOT VALID → VALIDATE → SET NOT NULL → drop CHECK.',
      '4. Release B: application reads and writes full_name only.',
      '5. Release C (contract): drop the trigger, then ALTER TABLE customers DROP COLUMN name (with lock_timeout).',
      '6. Verify no queries reference name (pg_stat_statements, code search) before step 5.'
    ]
  },
  widgets: ['lab:txn'],
  interview: [
    { q: 'How do you add a NOT NULL constraint to a huge table without downtime?', a: 'Add CHECK (col IS NOT NULL) NOT VALID (instant), then VALIDATE CONSTRAINT (scans with a SHARE UPDATE EXCLUSIVE lock that allows reads and writes), then ALTER COLUMN SET NOT NULL, which skips the scan because a valid CHECK proves it (PG12+), then drop the CHECK. On PG18 you can also add a NOT NULL constraint NOT VALID and validate it.' },
    { q: 'Why is lock_timeout essential for migrations?', a: 'Most ALTER TABLE forms need ACCESS EXCLUSIVE. While waiting behind a long-running query, the waiting DDL blocks every new query on the table. lock_timeout makes it give up quickly; the migration retries later, avoiding a pile-up.' },
    { q: 'What is the expand/contract pattern?', a: 'Make schema changes in backward-compatible phases: expand (add new structures), migrate (dual-write, backfill, switch reads), and contract (remove old structures) only after no running code uses them. Each deploy remains compatible with the previous application version.' },
    { q: 'What happens if CREATE INDEX CONCURRENTLY fails?', a: 'It leaves an INVALID index (pg_index.indisvalid = false) which is maintained on writes but not used for reads. Drop it with DROP INDEX CONCURRENTLY and retry, or use REINDEX INDEX CONCURRENTLY.' }
  ],
  exercises: [
    { task: 'Add a NOT VALID check constraint ensuring products.price < 10000000, validate it, and confirm convalidated.', solution: `SET lock_timeout = '3s';
ALTER TABLE products ADD CONSTRAINT products_price_sane CHECK (price < 10000000) NOT VALID;
ALTER TABLE products VALIDATE CONSTRAINT products_price_sane;
SELECT conname, convalidated FROM pg_constraint WHERE conname = 'products_price_sane';`, run: true },
    { task: 'Find out which type changes rewrite the table: change departments.location from text to varchar(500), then to varchar(800), then back to text, printing relfilenode after each step. Which step rewrote the table?', solution: `SELECT relfilenode AS start FROM pg_class WHERE relname = 'departments';
ALTER TABLE departments ALTER COLUMN location TYPE varchar(500);   -- must check lengths: rewrite
SELECT relfilenode AS after_varchar_500 FROM pg_class WHERE relname = 'departments';
ALTER TABLE departments ALTER COLUMN location TYPE varchar(800);   -- widening: metadata only
SELECT relfilenode AS after_varchar_800 FROM pg_class WHERE relname = 'departments';
ALTER TABLE departments ALTER COLUMN location TYPE text;           -- binary compatible: metadata only
SELECT relfilenode AS after_text FROM pg_class WHERE relname = 'departments';`, run: true },
    { task: 'Create a unique index concurrently on users(lower(email)) and attach nothing; then verify it is valid.', solution: `CREATE UNIQUE INDEX CONCURRENTLY users_email_lower_uq ON users (lower(email));
SELECT indexrelid::regclass, indisvalid, indisunique
FROM   pg_index
WHERE  indexrelid = 'users_email_lower_uq'::regclass;`, run: true }
  ],
  challenge: {
    task: 'Add a primary-key-like unique constraint without a long lock: create a table events_demo (id bigint, payload text) with 5,000 rows, build a UNIQUE index CONCURRENTLY on id, then attach it as a PRIMARY KEY using the index (after making id NOT NULL the safe way). Show the resulting constraint.',
    hint: 'NOT NULL via CHECK NOT VALID + VALIDATE + SET NOT NULL; then ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY USING INDEX.',
    solution: `CREATE TABLE events_demo AS SELECT g::bigint AS id, md5(g::text) AS payload FROM generate_series(1, 5000) g;
CREATE UNIQUE INDEX CONCURRENTLY events_demo_id_uq ON events_demo (id);
ALTER TABLE events_demo ADD CONSTRAINT events_demo_id_nn CHECK (id IS NOT NULL) NOT VALID;
ALTER TABLE events_demo VALIDATE CONSTRAINT events_demo_id_nn;
ALTER TABLE events_demo ALTER COLUMN id SET NOT NULL;
ALTER TABLE events_demo DROP CONSTRAINT events_demo_id_nn;
ALTER TABLE events_demo ADD CONSTRAINT events_demo_pkey PRIMARY KEY USING INDEX events_demo_id_uq;
SELECT conname, contype, pg_get_constraintdef(oid)
FROM   pg_constraint
WHERE  conrelid = 'events_demo'::regclass AND contype = 'p';`,
    run: true
  },
  related: ['production-architecture-migrations', 'locks', 'constraints', 'indexes', 'configuration-production-settings'],
  quiz: [
    { type: 'mcq', q: 'Which change rewrites the whole table in PostgreSQL 16?', options: ['ADD COLUMN x int', 'ADD COLUMN x int DEFAULT 0', 'ADD COLUMN x uuid DEFAULT gen_random_uuid()', 'DROP COLUMN x'], answer: 2, explain: 'Volatile defaults must be computed per existing row → rewrite. Constant defaults are metadata-only since PG11.' },
    { type: 'tf', q: 'VALIDATE CONSTRAINT blocks inserts and updates on the table while it scans.', answer: false, explain: 'It takes SHARE UPDATE EXCLUSIVE, which allows reads and writes; only other DDL/vacuum is blocked.' },
    { type: 'bug', q: 'This migration caused a 20-minute outage on a 400GB table. Why?', code: `ALTER TABLE orders ALTER COLUMN amount TYPE numeric(14,2);`, options: ['numeric is slow', 'Type change rewrites the table and rebuilds indexes under ACCESS EXCLUSIVE', 'Missing CONCURRENTLY', 'It needed VACUUM first'], answer: 1, explain: 'Changing numeric precision/scale requires rewriting every row. Use new column + backfill + swap.' },
    { type: 'scenario', q: 'A dev wants to rename a column used by the running app. Safest plan?', options: ['RENAME in the same deploy', 'Expand/contract: add new column, dual-write, backfill, switch reads, drop old later', 'Use a view named like the table', 'Do it at night without telling anyone'], answer: 1, explain: 'Renames break running code instantly; expand/contract keeps every deployed version working.' }
  ]
},
{
  id: 'production-architecture-ecommerce-design',
  module: 'production-architecture',
  title: 'Production E-commerce Database Design: Full DDL with Constraints, Indexes, Partitioning, Audit and Security',
  level: 6,
  minutes: 35,
  summary: 'Design a production-grade e-commerce schema end to end — users, addresses, categories, products, inventory, orders (partitioned), order_items, payments, shipments and audit_logs — with the reasoning behind every key, constraint, index and privilege.',
  objectives: [
    'Model the core commerce entities with correct keys and relationships',
    'Use constraints (CHECK, UNIQUE, partial unique, generated columns) to make invalid states unrepresentable',
    'Partition orders by time and carry the partition key through foreign keys',
    'Choose indexes from access patterns, not guesses',
    'Add trigger-based auditing and least-privilege roles'
  ],
  concept: `<p>A production schema is a set of <strong>decisions</strong>, each answering "what must always be true?" and "how will this be read?". The DDL below (in its own schema <code>shop</code>, runnable in the playground) is a realistic starting point for an online store doing millions of orders per year.</p>
<p><strong>Analogy:</strong> designing a warehouse, not just shelves. You decide which doors trucks use (access patterns → indexes), which items can never be stored together (constraints), how to split the building into zones by season so old zones can be closed (partitioning), and who holds which keys (privileges), and you install CCTV (audit).</p>
<h4>Key decisions and WHY</h4>
<table>
<tr><th>Decision</th><th>Why</th></tr>
<tr><td><code>bigint GENERATED ALWAYS AS IDENTITY</code> keys</td><td>Standard SQL identity, no 2.1B int overflow, cannot be accidentally overridden by app inserts</td></tr>
<tr><td>Unique index on <code>lower(email)</code></td><td>Case-insensitive uniqueness without the citext extension; login lookups use it</td></tr>
<tr><td><code>numeric(12,2)</code> for money + <code>currency char(3)</code></td><td>Exact decimal arithmetic (never float); explicit currency</td></tr>
<tr><td><code>CHECK</code> on status columns</td><td>Cheap, explicit state sets (easier to evolve than ENUM types)</td></tr>
<tr><td><code>total</code> as a <code>GENERATED ALWAYS … STORED</code> column</td><td>Total can never disagree with its parts</td></tr>
<tr><td>Partial unique index "one default address per user"</td><td>Business rule enforced by the database, not by hope</td></tr>
<tr><td><code>inventory</code> with <code>CHECK (reserved &lt;= on_hand)</code> and non-negative checks</td><td>Overselling becomes a constraint violation, not a support ticket</td></tr>
<tr><td><code>orders</code> partitioned by <code>RANGE (created_at)</code>, PK <code>(id, created_at)</code></td><td>Old quarters can be detached/archived; queries by date prune partitions; vacuum and indexes per partition stay small. The PK must include the partition key</td></tr>
<tr><td>Children reference <code>(order_id, order_created_at)</code></td><td>Foreign keys to a partitioned table must reference its (composite) unique key</td></tr>
<tr><td><code>idempotency_key uuid</code></td><td>Clients retry safely without creating duplicate orders</td></tr>
<tr><td><code>payments UNIQUE (provider, provider_ref)</code></td><td>Webhook replays cannot double-record a payment</td></tr>
<tr><td>Indexes from access patterns</td><td>"My orders" → <code>(user_id, created_at DESC)</code>; ops queue → partial index on open statuses; product listing → partial index on active products; JSONB attribute filters → GIN <code>jsonb_path_ops</code></td></tr>
<tr><td>Partitioned <code>audit_logs</code> written by a SECURITY DEFINER trigger</td><td>Tamper-resistant change history; easy retention by dropping old partitions</td></tr>
<tr><td>Roles: owner, app (DML only), readonly</td><td>Least privilege; app cannot DROP tables or rewrite audit history</td></tr>
</table>`,
  why: `<p>Commerce data is money and promises to customers. Weak schemas leak bugs into finance: duplicate payments, negative stock, totals that do not add up, orders without items. A database that enforces invariants catches these at write time from every code path — including scripts, admin tools and future services written by people who never read the original design doc.</p>`,
  useCase: `<p>A D2C electronics brand in India processes ~40,000 orders/day (≈15M/year), peaking at 600 orders/minute during sales. With this design: orders are partitioned quarterly (each partition ~4M rows); "my orders" pages hit <code>(user_id, created_at DESC)</code> and touch only recent partitions; the warehouse dashboard uses the partial index on open statuses (a few thousand rows instead of millions); finance exports read a replica; audit partitions older than 7 years are detached and archived to object storage. Payment webhook retries are harmless thanks to <code>UNIQUE (provider, provider_ref)</code>.</p>`,
  internals: `<p>Partitioned tables in PostgreSQL are a parent with no storage plus child tables; indexes created on the parent are created on every partition (partitioned indexes); unique constraints must include the partition key because uniqueness is enforced per partition. Partition pruning happens at plan time (literal ranges) and at execution time (parameters, joins). Foreign keys referencing a partitioned table are supported since PG12. The generated <code>total</code> column is computed on INSERT/UPDATE and stored. AFTER ROW triggers on a partitioned parent are cloned to all partitions; <code>TG_TABLE_NAME</code> would be the partition name, which is why the audit trigger receives the logical table name as an argument.</p>`,
  whenNot: `<p>Do not partition small tables (&lt; tens of millions of rows) — partitioning adds planning overhead and complexity; start unpartitioned and partition when retention or size demands it (the expand/contract tools still apply). Do not put product catalogs entirely into JSONB — keep queried, constrained fields as columns and use JSONB for genuinely variable attributes. Do not store card numbers — use a payment provider's tokens (PCI DSS scope).</p>`,
  syntax: `CREATE SCHEMA shop;
CREATE TABLE ... (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ... CHECK (...), UNIQUE (...),
  total numeric(12,2) GENERATED ALWAYS AS (a + b) STORED
) PARTITION BY RANGE (created_at);
CREATE TABLE p PARTITION OF parent FOR VALUES FROM (...) TO (...);
FOREIGN KEY (order_id, order_created_at) REFERENCES orders (id, created_at);
CREATE UNIQUE INDEX ... WHERE is_default;     -- partial unique rule`,
  examples: [
    {
      label: 'Basic',
      title: 'Users, addresses, categories, products and inventory',
      sql: `CREATE SCHEMA shop;
SET search_path = shop, public;

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text        NOT NULL CHECK (position('@' IN email) > 1),
  full_name     text        NOT NULL,
  phone         text,
  password_hash text        NOT NULL,          -- e.g. argon2/bcrypt hash from the app, never plain text
  status        text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));   -- case-insensitive login

CREATE TABLE addresses (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label       text    NOT NULL DEFAULT 'home',
  line1       text    NOT NULL,
  line2       text,
  city        text    NOT NULL,
  state       text,
  postal_code text    NOT NULL,
  country     char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),    -- ISO 3166-1 alpha-2
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_idx ON addresses (user_id);                       -- FK index
CREATE UNIQUE INDEX addresses_one_default_uq ON addresses (user_id) WHERE is_default;

CREATE TABLE categories (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id int REFERENCES categories (id),                               -- tree
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL
);
CREATE INDEX categories_parent_idx ON categories (parent_id);

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku         text          NOT NULL UNIQUE,
  name        text          NOT NULL,
  description text,
  category_id int           NOT NULL REFERENCES categories (id),
  price       numeric(12,2) NOT NULL CHECK (price >= 0),
  currency    char(3)       NOT NULL DEFAULT 'INR',
  attributes  jsonb         NOT NULL DEFAULT '{}',
  is_active   boolean       NOT NULL DEFAULT true,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX products_category_active_idx ON products (category_id) WHERE is_active;
CREATE INDEX products_attributes_gin ON products USING gin (attributes jsonb_path_ops);

CREATE TABLE inventory (
  product_id bigint NOT NULL REFERENCES products (id),
  warehouse  text   NOT NULL,
  on_hand    int    NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved   int    NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse),
  CONSTRAINT inventory_reserved_le_on_hand CHECK (reserved <= on_hand)
);

-- Try the rules
INSERT INTO users (email, full_name, password_hash) VALUES ('Asha@Example.com', 'Asha Rao', 'x');
INSERT INTO addresses (user_id, line1, city, postal_code, country, is_default)
VALUES (1, '12 MG Road', 'Bengaluru', '560001', 'IN', true);
SELECT table_name, count(*) AS columns
FROM   information_schema.columns
WHERE  table_schema = 'shop'
GROUP  BY table_name ORDER BY table_name;`,
      explain: `<p>Each table encodes rules: case-insensitive unique emails via an expression index; addresses cascade-delete with their user and a <strong>partial unique index</strong> allows only one <code>is_default</code> address per user; categories form a tree via a self-reference; products keep queried facts as typed columns and variable specs in JSONB with a compact GIN index; inventory makes overselling impossible (<code>reserved &lt;= on_hand</code>, non-negative counts). Every FK column has an index (the toolkit query from System Catalogs would find none missing).</p>`,
      output: ` table_name | columns
------------+---------
 addresses  |      11
 categories |       4
 inventory  |       5
 products   |      11
 users      |       8`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Partitioned orders, items, payments and shipments',
      sql: `CREATE SCHEMA shop;
SET search_path = shop, public;
CREATE TABLE users (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text NOT NULL);
CREATE TABLE addresses (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        user_id bigint NOT NULL REFERENCES users (id));
CREATE TABLE products (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, sku text NOT NULL UNIQUE,
                       price numeric(12,2) NOT NULL CHECK (price >= 0));

CREATE TABLE orders (
  id                  bigint GENERATED ALWAYS AS IDENTITY,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  user_id             bigint        NOT NULL REFERENCES users (id),
  shipping_address_id bigint        REFERENCES addresses (id),
  status              text          NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','packed','shipped','delivered','cancelled','refunded')),
  currency            char(3)       NOT NULL DEFAULT 'INR',
  subtotal            numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  tax                 numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  shipping_fee        numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  total               numeric(12,2) GENERATED ALWAYS AS (subtotal + tax + shipping_fee) STORED,
  idempotency_key     uuid          NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY (id, created_at),                     -- must include the partition key
  UNIQUE (idempotency_key, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2026_q3 PARTITION OF orders FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE orders_2026_q4 PARTITION OF orders FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE orders_default PARTITION OF orders DEFAULT;   -- safety net; alert if it gets rows

CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC);             -- "my orders"
CREATE INDEX orders_open_idx ON orders (status, created_at)
       WHERE status IN ('pending', 'paid', 'packed');                                     -- ops queue

CREATE TABLE order_items (
  order_id         bigint        NOT NULL,
  order_created_at timestamptz   NOT NULL,
  line_no          smallint      NOT NULL,
  product_id       bigint        NOT NULL REFERENCES products (id),
  quantity         int           NOT NULL CHECK (quantity > 0),
  unit_price       numeric(12,2) NOT NULL CHECK (unit_price >= 0),   -- price at purchase time
  PRIMARY KEY (order_id, order_created_at, line_no),
  FOREIGN KEY (order_id, order_created_at) REFERENCES orders (id, created_at) ON DELETE CASCADE
);
CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE payments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         bigint        NOT NULL,
  order_created_at timestamptz   NOT NULL,
  provider         text          NOT NULL,
  provider_ref     text          NOT NULL,
  method           text          NOT NULL CHECK (method IN ('card','upi','netbanking','wallet','cod')),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  status           text          NOT NULL CHECK (status IN ('initiated','authorized','captured','failed','refunded')),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, order_created_at) REFERENCES orders (id, created_at),
  UNIQUE (provider, provider_ref)                      -- webhook replays are harmless
);
CREATE INDEX payments_order_idx ON payments (order_id, order_created_at);

CREATE TABLE shipments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         bigint      NOT NULL,
  order_created_at timestamptz NOT NULL,
  carrier          text        NOT NULL,
  tracking_number  text,
  status           text        NOT NULL DEFAULT 'label_created'
                   CHECK (status IN ('label_created','in_transit','out_for_delivery','delivered','returned')),
  shipped_at       timestamptz,
  delivered_at     timestamptz,
  FOREIGN KEY (order_id, order_created_at) REFERENCES orders (id, created_at),
  CHECK (delivered_at IS NULL OR (shipped_at IS NOT NULL AND delivered_at >= shipped_at))
);
CREATE INDEX shipments_order_idx ON shipments (order_id, order_created_at);
CREATE UNIQUE INDEX shipments_tracking_uq ON shipments (carrier, tracking_number)
       WHERE tracking_number IS NOT NULL;

-- Use it
INSERT INTO users (email) VALUES ('asha@example.com');
INSERT INTO products (sku, price) VALUES ('HP-100', 2999), ('SPK-200', 4999);
INSERT INTO orders (created_at, user_id, subtotal, tax) VALUES ('2026-08-14 10:00+05:30', 1, 7998, 1439.64);
INSERT INTO order_items VALUES (1, '2026-08-14 10:00+05:30', 1, 1, 1, 2999),
                               (1, '2026-08-14 10:00+05:30', 2, 2, 1, 4999);
SELECT tableoid::regclass AS partition, id, status, subtotal, tax, total FROM orders;
EXPLAIN (COSTS OFF)
SELECT * FROM orders WHERE user_id = 1 AND created_at >= '2026-07-01' AND created_at < '2026-08-01';`,
      explain: `<p>The row lands in <code>orders_2026_q3</code> automatically; <code>total</code> is computed (9437.64) and can never drift from its components. Child tables carry <code>order_created_at</code> so their foreign keys can reference the partitioned table's composite key. The EXPLAIN shows <strong>partition pruning</strong>: only Q3 is scanned, using the per-partition copy of <code>orders_user_created_idx</code>. Operationally you pre-create future partitions (cron job or <code>pg_partman</code> <span class="tag ext">extension</span>) and alert if the DEFAULT partition receives rows.</p>`,
      output: ` partition      | id | status  | subtotal | tax     | total
----------------+----+---------+----------+---------+---------
 orders_2026_q3 |  1 | pending |  7998.00 | 1439.64 | 9437.64

 QUERY PLAN
---------------------------------------------------------------------------
 Index Scan using orders_2026_q3_user_id_created_at_idx on orders_2026_q3 orders
   Index Cond: ((user_id = 1) AND (created_at >= ...) AND (created_at < ...))`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Audit trigger, least-privilege roles and the rules in action',
      sql: `CREATE SCHEMA shop;
SET search_path = shop, public;
CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0)
);
CREATE TABLE inventory (
  product_id bigint PRIMARY KEY,
  on_hand int NOT NULL CHECK (on_hand >= 0),
  reserved int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  CHECK (reserved <= on_hand)
);

-- Append-only, partitioned audit log
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  table_name  text        NOT NULL,
  operation   text        NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_pk      text        NOT NULL,
  actor       text        NOT NULL DEFAULT session_user,
  old_data    jsonb,
  new_data    jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
CREATE INDEX audit_logs_table_pk_idx ON audit_logs (table_name, row_pk);

CREATE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = shop, pg_temp AS $$
BEGIN
  INSERT INTO audit_logs (table_name, operation, row_pk, old_data, new_data)
  VALUES (TG_ARGV[0], TG_OP,
          COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id'),
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;
CREATE TRIGGER orders_audit AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_row('orders');

-- Roles: the app can do DML but cannot touch audit history or DDL
CREATE ROLE shop_app NOLOGIN;
CREATE ROLE shop_readonly NOLOGIN;
REVOKE ALL ON SCHEMA shop FROM PUBLIC;
GRANT USAGE ON SCHEMA shop TO shop_app, shop_readonly;
GRANT SELECT, INSERT, UPDATE ON orders, inventory TO shop_app;
GRANT SELECT ON ALL TABLES IN SCHEMA shop TO shop_readonly;
REVOKE ALL ON audit_logs FROM shop_app;                 -- only the trigger writes it

SET ROLE shop_app;
INSERT INTO orders (subtotal) VALUES (7998);
UPDATE orders SET status = 'paid' WHERE id = 1;
INSERT INTO inventory VALUES (1, 5, 0);
DO $$
BEGIN
  UPDATE inventory SET reserved = 6 WHERE product_id = 1;   -- oversell attempt
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'blocked: %', SQLERRM;
END $$;
RESET ROLE;

SELECT table_name, operation, row_pk, actor,
       old_data ->> 'status' AS old_status, new_data ->> 'status' AS new_status
FROM   audit_logs ORDER BY id;`,
      explain: `<p>The trigger function is <code>SECURITY DEFINER</code> with a pinned <code>search_path</code>, so it can write <code>audit_logs</code> even though <code>shop_app</code> has no privileges on it — the application can neither read nor forge audit history. The logical table name is passed as a trigger argument (on partitioned tables <code>TG_TABLE_NAME</code> would be the partition). Acting as <code>shop_app</code>, the insert and update are audited, and the oversell attempt is rejected by the CHECK constraint. <code>actor</code> uses <code>session_user</code> (the login role) rather than <code>current_user</code> (which is the function owner inside a SECURITY DEFINER function).</p>`,
      output: `NOTICE:  blocked: new row for relation "inventory" violates check constraint "inventory_check"

 table_name | operation | row_pk | actor    | old_status | new_status
------------+-----------+--------+----------+------------+------------
 orders     | INSERT    | 1      | postgres |            | pending
 orders     | UPDATE    | 1      | postgres | pending    | paid`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `CREATE TABLE bad_orders (
  id serial PRIMARY KEY,                 -- int: overflows at 2.1B
  customer_email text,                   -- denormalised, no FK, nullable
  status text,                           -- any string allowed
  total float,                           -- binary floating point for money
  items jsonb                            -- line items hidden in JSON: no FK, no per-item index
);
INSERT INTO bad_orders (customer_email, status, total, items)
VALUES ('x', 'payed', 0.1 + 0.2, '[{"sku":"HP-100","qty":-3}]');
SELECT total, total = 0.3 AS equals_point_three FROM bad_orders;`, why: 'Nothing is enforced: typo statuses, negative quantities, emails that are not emails, money that is not exact (0.1 + 0.2 <> 0.3 in float), and items that cannot be joined, indexed or referenced.', run: true },
    good: { sql: `CREATE TABLE good_orders (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  bigint NOT NULL REFERENCES users (id),
  status   text   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','shipped','delivered','cancelled')),
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  tax      numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total    numeric(12,2) GENERATED ALWAYS AS (subtotal + tax) STORED
);
INSERT INTO good_orders (user_id, subtotal, tax) VALUES (1, 0.1, 0.2);
SELECT total, total = 0.3 AS equals_point_three FROM good_orders;`, why: 'bigint identity, FK to users, constrained status, exact numeric money, and a generated total that cannot disagree with its parts.', run: true }
  },
  mistakes: [
    `Using <code>float</code>/<code>real</code> for money.`,
    `Storing line items inside a JSON column on orders — no FKs, no constraints, hard to report on.`,
    `Not copying the price into <code>order_items.unit_price</code> — historical orders change when the catalog price changes.`,
    `Partitioning without including the partition key in primary/unique keys (PostgreSQL rejects it) or without a plan to create future partitions.`,
    `Letting the application role own the tables (it can then DROP them or disable triggers).`,
    `Forgetting idempotency for order creation and payment webhooks — retries create duplicates.`
  ],
  best: [
    `Encode invariants as constraints: CHECK, UNIQUE (including partial), FK, generated columns.`,
    `Derive indexes from the top access patterns and verify with EXPLAIN; index every FK used for joins/deletes.`,
    `Partition large append-mostly tables (orders, events, audit) by time once size or retention requires it; automate partition creation.`,
    `Separate roles: owner/migrator (DDL), app (DML on specific tables), readonly (reporting), with <code>REVOKE ALL ON SCHEMA … FROM PUBLIC</code>.`,
    `Audit via triggers into an append-only, partitioned table the application cannot modify.`
  ],
  performance: `<p>Hot paths: checkout (insert order + items + reserve inventory in one short transaction; use <code>SELECT … FOR UPDATE</code> on inventory rows in product-id order to avoid deadlocks), "my orders" (index on user_id, created_at DESC; partition pruning on date), ops queues (partial indexes on open statuses stay tiny). Generated columns and CHECKs cost microseconds per row. Audit triggers add one insert per change — fine for orders/payments; for very high-volume tables consider logical decoding/CDC into an audit store instead.</p>`,
  security: `<p>No card data (use provider tokens). Password hashes only, computed by the application with a slow hash (argon2/bcrypt) — or <code>pgcrypto</code> <span class="tag ext">extension</span> <code>crypt()</code> if done in the database. PII columns (phone, address) protected by least privilege, column-level grants for analysts, and possibly RLS for multi-tenant or regional access. The SECURITY DEFINER audit function pins <code>search_path</code> to prevent object-hijacking attacks.</p>`,
  scenario: {
    title: 'Black Friday: 20x order volume',
    steps: [
      '1. Pre-create partitions for the next quarters; verify the default partition is empty.',
      '2. Confirm hot indexes are cached (pg_buffercache) and FK indexes exist on all children.',
      '3. Keep checkout transactions short: reserve inventory with ordered FOR UPDATE, insert order and items, commit; payment confirmation in a separate transaction.',
      '4. Route reports to a replica; enable statement_timeout for reporting roles.',
      '5. Watch lock waits, replication lag, connection usage and WAL rate; have the runbook ready.'
    ]
  },
  widgets: ['diagram:partitioning', 'diagram:normalization'],
  interview: [
    { q: 'Why must the primary key of a partitioned orders table include created_at?', a: 'PostgreSQL enforces unique constraints per partition using local indexes, so a unique/primary key must include the partition key to guarantee global uniqueness. Hence PRIMARY KEY (id, created_at), and children reference (order_id, order_created_at).' },
    { q: 'How do you prevent overselling inventory?', a: 'Enforce reserved <= on_hand and non-negative quantities with CHECK constraints, update stock in a transaction with row locks (SELECT ... FOR UPDATE in a consistent product order, or a single UPDATE ... WHERE on_hand - reserved >= qty RETURNING), and treat a constraint violation as out-of-stock.' },
    { q: 'Why copy the unit price into order_items?', a: 'Orders are historical facts: prices, names and taxes change over time. The order must keep what the customer actually paid, so it stores price (and often a product snapshot) at purchase time.' },
    { q: 'How would you make payment webhooks idempotent?', a: 'Give payments a UNIQUE (provider, provider_ref) constraint and insert with ON CONFLICT DO NOTHING (or DO UPDATE for status transitions), so replayed webhooks cannot create duplicates.' }
  ],
  exercises: [
    { task: 'Show that the partial unique index allows only one default address per user: create a minimal addresses table with the index, insert two default addresses for the same user and catch the error.', solution: `CREATE TABLE addr_demo (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id int NOT NULL, is_default boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX addr_demo_one_default ON addr_demo (user_id) WHERE is_default;
INSERT INTO addr_demo (user_id, is_default) VALUES (1, true), (1, false), (1, false);
DO $$
BEGIN
  INSERT INTO addr_demo (user_id, is_default) VALUES (1, true);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'second default rejected';
END $$;
SELECT user_id, count(*) FILTER (WHERE is_default) AS defaults, count(*) AS total FROM addr_demo GROUP BY user_id;`, run: true },
    { task: 'Implement idempotent payment recording: a payments_demo table with UNIQUE (provider, provider_ref); insert the same webhook twice using ON CONFLICT DO NOTHING and count rows.', solution: `CREATE TABLE payments_demo (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL, provider_ref text NOT NULL, amount numeric(12,2) NOT NULL,
  UNIQUE (provider, provider_ref)
);
INSERT INTO payments_demo (provider, provider_ref, amount) VALUES ('razorpay', 'pay_123', 9437.64)
ON CONFLICT (provider, provider_ref) DO NOTHING;
INSERT INTO payments_demo (provider, provider_ref, amount) VALUES ('razorpay', 'pay_123', 9437.64)
ON CONFLICT (provider, provider_ref) DO NOTHING;
SELECT count(*) FROM payments_demo;`, run: true },
    { task: 'Create a quarterly-partitioned events table with two partitions and a default, insert three rows and show which partition each landed in.', solution: `CREATE TABLE events_p (id bigint GENERATED ALWAYS AS IDENTITY, created_at timestamptz NOT NULL, kind text NOT NULL,
  PRIMARY KEY (id, created_at)) PARTITION BY RANGE (created_at);
CREATE TABLE events_p_2026_q3 PARTITION OF events_p FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE events_p_2026_q4 PARTITION OF events_p FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE events_p_default PARTITION OF events_p DEFAULT;
INSERT INTO events_p (created_at, kind) VALUES ('2026-08-01', 'a'), ('2026-11-15', 'b'), ('2025-01-01', 'c');
SELECT tableoid::regclass AS partition, kind, created_at FROM events_p ORDER BY created_at;`, run: true }
  ],
  challenge: {
    task: 'Write a stock-reservation statement that atomically reserves quantity 3 of product 1 only if enough unreserved stock exists, returning the new state — and show it failing gracefully (0 rows) when stock is insufficient.',
    hint: 'UPDATE inventory SET reserved = reserved + 3 WHERE product_id = 1 AND on_hand - reserved >= 3 RETURNING *.',
    solution: `CREATE TABLE inv_demo (
  product_id bigint PRIMARY KEY,
  on_hand int NOT NULL CHECK (on_hand >= 0),
  reserved int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  CHECK (reserved <= on_hand)
);
INSERT INTO inv_demo VALUES (1, 5, 0);
UPDATE inv_demo SET reserved = reserved + 3
WHERE  product_id = 1 AND on_hand - reserved >= 3
RETURNING product_id, on_hand, reserved, on_hand - reserved AS available;
UPDATE inv_demo SET reserved = reserved + 3
WHERE  product_id = 1 AND on_hand - reserved >= 3
RETURNING product_id, on_hand, reserved, on_hand - reserved AS available;`,
    run: true
  },
  related: ['production-architecture-zero-downtime', 'partitioning', 'constraints', 'database-design', 'row-level-security'],
  quiz: [
    { type: 'design', q: 'Best type for order totals?', options: ['float8', 'numeric(12,2)', 'money', 'text'], answer: 1, explain: 'numeric is exact; money is locale-dependent and awkward; floats are inexact.' },
    { type: 'mcq', q: 'How does a child table reference a partitioned orders table with PK (id, created_at)?', options: ['FOREIGN KEY (order_id) REFERENCES orders (id)', 'FOREIGN KEY (order_id, order_created_at) REFERENCES orders (id, created_at)', 'It cannot', 'Using a trigger only'], answer: 1, explain: 'The FK must reference a unique key of the parent, which includes the partition key.' },
    { type: 'index', q: 'The warehouse screen lists orders with status pending/paid/packed (~0.5% of rows) by age. Best index?', options: ['orders(status)', 'Partial index on (status, created_at) WHERE status IN (\'pending\',\'paid\',\'packed\')', 'GIN on status', 'No index'], answer: 1, explain: 'A partial index only contains open orders, stays tiny and serves the ordered scan.' },
    { type: 'tf', q: 'A generated STORED column can be written directly by an INSERT.', answer: false, explain: 'GENERATED ALWAYS columns are computed; inserting an explicit value errors (except DEFAULT).' }
  ]
},
{
  id: 'production-architecture-multi-tenant',
  module: 'production-architecture',
  title: 'Multi-Tenant Architecture Recap and Tenant Isolation Decision Matrix',
  level: 6,
  minutes: 24,
  summary: 'Shared tables with tenant_id + RLS, schema-per-tenant, database-per-tenant, cluster-per-tenant and distributed (Citus) — compared on isolation, cost, scale, operations and compliance, with a runnable RLS isolation demo.',
  objectives: [
    'Describe the four main tenancy models and their trade-offs',
    'Implement shared-table isolation with tenant_id and row-level security that fails closed',
    'Design keys and indexes that lead with tenant_id',
    'Use a decision matrix to choose a model per customer segment',
    'Plan noisy-neighbour mitigation and tenant moves'
  ],
  concept: `<p>A multi-tenant SaaS stores many customers' data. The core question is <strong>where the isolation boundary sits</strong>:</p>
<ol>
<li><strong>Shared schema (pool)</strong> — one set of tables, every row has <code>tenant_id</code>; isolation by application filters and <strong>row-level security</strong> (RLS).</li>
<li><strong>Schema per tenant</strong> — same tables in <code>tenant_42.orders</code>, <code>tenant_43.orders</code>…; <code>search_path</code> selects the tenant.</li>
<li><strong>Database per tenant</strong> — one database per tenant in a shared cluster (or several).</li>
<li><strong>Cluster/instance per tenant (silo)</strong> — dedicated server(s) per tenant.</li>
<li><strong>Distributed shared schema</strong> — shared tables sharded by <code>tenant_id</code> across nodes, e.g. Citus <span class="tag ext">extension / distributed database</span>.</li>
</ol>
<p><strong>Analogy:</strong> housing. Shared tables = a hostel dorm with labelled lockers (cheap, efficient, needs strict rules); schema per tenant = rooms in one hotel; database per tenant = apartments in one building (separate doors, shared plumbing); cluster per tenant = detached houses (expensive, fully private). Citus = a hostel chain spreading dorms across many buildings.</p>
<h4>Decision matrix</h4>
<table>
<tr><th>Criterion</th><th>Shared + RLS</th><th>Schema/tenant</th><th>DB/tenant</th><th>Cluster/tenant</th><th>Citus (sharded shared)</th></tr>
<tr><td>Isolation strength</td><td>Logical (policy)</td><td>Namespace</td><td>Strong (connection-level)</td><td>Physical</td><td>Logical (policy)</td></tr>
<tr><td>Tenants supported</td><td>Millions</td><td>Hundreds–low thousands</td><td>Hundreds</td><td>Tens</td><td>Millions</td></tr>
<tr><td>Cost per tenant</td><td>Lowest</td><td>Low</td><td>Medium</td><td>Highest</td><td>Low</td></tr>
<tr><td>Migrations</td><td>Once</td><td>N times (catalog bloat)</td><td>N times</td><td>N times</td><td>Once (distributed DDL)</td></tr>
<tr><td>Cross-tenant analytics</td><td>Trivial</td><td>UNION across schemas</td><td>Hard (ETL)</td><td>Hard (ETL)</td><td>Distributed queries</td></tr>
<tr><td>Noisy neighbour</td><td>Highest risk</td><td>High</td><td>Medium</td><td>None</td><td>Mitigated (tenant isolation to own shard)</td></tr>
<tr><td>Per-tenant backup/restore</td><td>Hard</td><td>Possible (pg_dump -n)</td><td>Easy</td><td>Easy</td><td>Hard</td></tr>
<tr><td>Compliance / data residency</td><td>Weakest</td><td>Weak</td><td>Good</td><td>Best</td><td>Placement by node/region possible</td></tr>
<tr><td>Typical use</td><td>SMB SaaS, freemium</td><td>B2B with few large tenants</td><td>Regulated mid-size</td><td>Enterprise / sovereign</td><td>Large-scale B2B SaaS</td></tr>
</table>
<p>Many companies run a <strong>hybrid</strong>: all small tenants in the shared pool, large or regulated tenants in dedicated databases/clusters, with a tenant directory routing connections.</p>`,
  why: `<p>The tenancy model is one of the hardest decisions to change later; it shapes every table, index, query, migration, backup and incident. Choosing well — and enforcing isolation in the database, not only in application code — prevents the worst SaaS incident: tenant A seeing tenant B's data.</p>`,
  useCase: `<p>A project-management SaaS has 80,000 small tenants and 30 enterprise customers. Small tenants share tables keyed by <code>(tenant_id, id)</code> with RLS policies driven by <code>app.tenant_id</code>, set per transaction by the API (<code>SET LOCAL</code>, safe with PgBouncer transaction pooling). Enterprise customers with data-residency requirements get a dedicated database in their region, created from the same migrations. A tenant directory table maps tenant → connection string. One noisy enterprise tenant was moved from the pool to a dedicated database with logical replication filtered by tenant_id in a 5-second cutover.</p>`,
  internals: `<p>RLS policies are added by the rewriter as extra quals on every query against the table, for roles subject to RLS (not superusers, not roles with BYPASSRLS, and not the table owner unless <code>FORCE ROW LEVEL SECURITY</code>). <code>USING</code> filters visible/affected rows; <code>WITH CHECK</code> validates new rows. Policies that call <code>current_setting()</code> are evaluated per query (stable function), and the planner can use an index on <code>tenant_id</code> for the policy qual. Leading composite keys and indexes with <code>tenant_id</code> keep each tenant's rows clustered in index order and make every tenant-scoped query an index range scan. In Citus, tables distributed by <code>tenant_id</code> co-locate all of a tenant's rows on one shard, so joins on <code>(tenant_id, …)</code> stay local.</p>`,
  whenNot: `<p>Avoid schema-per-tenant beyond a few thousand tenants: each schema multiplies catalog entries (tables × indexes × tenants), slowing pg_dump, planning cache warm-up, autovacuum scheduling and migrations. Avoid database-per-tenant when you need cross-tenant features (global search, analytics) or have tens of thousands of tenants. Do not rely on RLS alone if a tenant contract requires physical separation or separate encryption keys.</p>`,
  syntax: `-- Shared tables + RLS
CREATE TABLE t (tenant_id int NOT NULL, id bigint GENERATED ALWAYS AS IDENTITY,
                ..., PRIMARY KEY (tenant_id, id));
ALTER TABLE t ENABLE ROW LEVEL SECURITY;
ALTER TABLE t FORCE ROW LEVEL SECURITY;            -- apply to the owner too
CREATE POLICY tenant_isolation ON t
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int);
-- per request (transaction-pool safe):
BEGIN; SET LOCAL app.tenant_id = '42'; ...; COMMIT;`,
  examples: [
    {
      label: 'Basic',
      title: 'Tenant distribution in company_db.users',
      sql: `SELECT tenant_id,
       count(*)                                    AS users,
       count(*) FILTER (WHERE role = 'admin')      AS admins,
       count(*) FILTER (WHERE is_active)           AS active,
       max(last_login)                             AS last_activity
FROM   users
GROUP  BY tenant_id
ORDER  BY tenant_id;`,
      explain: `<p>company_db's <code>users</code> table already follows the shared-table model with a <code>tenant_id</code> column (tenants 1–3). Measuring per-tenant size and activity is the first step of any tenancy review: the distribution tells you whether a few tenants dominate (candidates for dedicated placement) or load is even.</p>`,
      output: ` tenant_id | users | admins | active | last_activity
-----------+-------+--------+--------+---------------
         1 |    20 |      4 |     19 | 2026-06-30 ...
         2 |    20 |      4 |     18 | 2026-06-24 ...
         3 |    20 |      4 |     18 | 2026-06-27 ...`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Row-level security that fails closed',
      sql: `CREATE SCHEMA saas;
CREATE TABLE saas.projects (
  tenant_id int    NOT NULL,
  id        bigint GENERATED ALWAYS AS IDENTITY,
  name      text   NOT NULL,
  PRIMARY KEY (tenant_id, id)                      -- tenant first: per-tenant range scans
);
INSERT INTO saas.projects (tenant_id, name)
VALUES (1, 'Apollo'), (1, 'Gemini'), (2, 'Zephyr'), (3, 'Orion');

ALTER TABLE saas.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas.projects
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int);

CREATE ROLE saas_app NOLOGIN;                      -- app role: subject to RLS
GRANT USAGE ON SCHEMA saas TO saas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON saas.projects TO saas_app;

SET ROLE saas_app;
SET app.tenant_id = '1';
SELECT tenant_id, id, name FROM saas.projects;     -- only tenant 1
SET app.tenant_id = '2';
SELECT tenant_id, id, name FROM saas.projects;     -- only tenant 2
RESET app.tenant_id;
SELECT count(*) AS rows_without_tenant FROM saas.projects;   -- fail closed: 0
RESET ROLE;`,
      explain: `<p>As <code>saas_app</code>, every query is automatically filtered by the policy. The <code>nullif(…, '')</code> matters: once a custom setting has been used in a session, <code>RESET</code> leaves it as an empty string, and <code>''::int</code> would raise an error; with <code>nullif</code> the comparison becomes <code>tenant_id = NULL</code> → no rows. Forgetting to set the tenant therefore returns <strong>nothing</strong> rather than everything — the policy fails closed. Superusers and the table owner bypass RLS unless <code>FORCE ROW LEVEL SECURITY</code> is set — which is why the app must not connect as the owner.</p>`,
      output: ` tenant_id | id | name
-----------+----+--------
         1 |  1 | Apollo
         1 |  2 | Gemini

 tenant_id | id | name
-----------+----+--------
         2 |  3 | Zephyr

 rows_without_tenant
---------------------
                   0`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'WITH CHECK blocks cross-tenant writes; tenant directory for hybrid placement',
      sql: `CREATE SCHEMA saas;
CREATE TABLE saas.projects (tenant_id int NOT NULL, id bigint GENERATED ALWAYS AS IDENTITY,
                            name text NOT NULL, PRIMARY KEY (tenant_id, id));
ALTER TABLE saas.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas.projects
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int);
CREATE ROLE saas_app NOLOGIN;
GRANT USAGE ON SCHEMA saas TO saas_app;
GRANT SELECT, INSERT, UPDATE ON saas.projects TO saas_app;

SET ROLE saas_app;
BEGIN;
SET LOCAL app.tenant_id = '1';                       -- per-transaction: pooler-safe
INSERT INTO saas.projects (tenant_id, name) VALUES (1, 'Mercury');   -- allowed
DO $$
BEGIN
  INSERT INTO saas.projects (tenant_id, name) VALUES (2, 'Sneaky');   -- other tenant
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'blocked: %', SQLERRM;
END $$;
SELECT tenant_id, name FROM saas.projects;
COMMIT;
RESET ROLE;

-- Hybrid model: a directory routes tenants to pool or dedicated databases
CREATE TABLE saas.tenant_directory (
  tenant_id   int PRIMARY KEY,
  name        text NOT NULL,
  tier        text NOT NULL CHECK (tier IN ('pool', 'dedicated')),
  region      text NOT NULL,
  dsn_secret  text NOT NULL            -- reference to a secret, never the password itself
);
INSERT INTO saas.tenant_directory VALUES
  (1, 'Acme SMB',     'pool',      'ap-south-1', 'secret/pool-ap-south-1'),
  (2, 'Globex Bank',  'dedicated', 'eu-central-1', 'secret/tenant-2-eu'),
  (3, 'Initech',      'pool',      'ap-south-1', 'secret/pool-ap-south-1');
SELECT tier, region, count(*) AS tenants FROM saas.tenant_directory GROUP BY 1, 2 ORDER BY 1, 2;`,
      explain: `<p><code>WITH CHECK</code> rejects inserting or updating a row into another tenant (SQLSTATE 42501, "new row violates row-level security policy"). <code>SET LOCAL</code> scopes the tenant to the transaction — essential with transaction-mode connection pooling, where the next transaction on the same server connection may belong to another tenant. The directory table is how hybrid architectures route: the app (or a proxy) looks up tier/region and connects to the shared pool or a dedicated database.</p>`,
      output: `NOTICE:  blocked: new row violates row-level security policy for table "projects"
 tenant_id | name
-----------+---------
         1 | Mercury

 tier      | region       | tenants
-----------+--------------+---------
 dedicated | eu-central-1 |       1
 pool      | ap-south-1   |       2`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Isolation only in application code; tenant_id last in the key
CREATE TABLE tasks_bad (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id int NOT NULL, title text);
-- every query must remember WHERE tenant_id = ? ... one forgotten filter leaks data
SELECT * FROM tasks_bad;`, why: 'A single missing WHERE clause in any code path (report, admin tool, new endpoint) exposes all tenants. A PK on id alone also scatters each tenant\'s rows across the index.', run: true },
    good: { sql: `CREATE TABLE tasks_good (tenant_id int NOT NULL, id bigint GENERATED ALWAYS AS IDENTITY,
                         title text, PRIMARY KEY (tenant_id, id));
ALTER TABLE tasks_good ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks_good FORCE ROW LEVEL SECURITY;
CREATE POLICY t_iso ON tasks_good
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int);
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr FROM pg_policy WHERE polrelid = 'tasks_good'::regclass;`, why: 'The database enforces isolation on every query (defence in depth), fails closed, and the tenant-leading key makes tenant-scoped queries index range scans.', run: true }
  },
  mistakes: [
    `Connecting the application as the table owner or a superuser — RLS is bypassed silently.`,
    `Using session-level <code>SET app.tenant_id</code> behind a transaction-mode pooler — the next client may inherit it.`,
    `Policies that fail open (e.g. <code>OR current_setting(...) IS NULL</code>) or error on empty strings.`,
    `Schema-per-tenant with 50,000 tenants — catalog bloat, very slow migrations and dumps.`,
    `Unique constraints without <code>tenant_id</code> (e.g. globally unique project names across tenants).`
  ],
  best: [
    `Lead primary keys, unique constraints and indexes with <code>tenant_id</code> in shared-table designs.`,
    `RLS as defence in depth, plus <code>FORCE ROW LEVEL SECURITY</code> and a non-owner app role; set the tenant with <code>SET LOCAL</code> per transaction.`,
    `Test isolation automatically: CI tests that query as tenant A and assert zero rows of tenant B.`,
    `Hybrid tiers: pool for the long tail, dedicated DB/cluster for large/regulated tenants, routed via a tenant directory.`,
    `Track per-tenant resource usage (rows, storage, query time via application tags) to spot noisy neighbours early.`
  ],
  performance: `<p>RLS quals are cheap when they can use an index on <code>tenant_id</code> (leading column). Avoid policies calling volatile or expensive functions per row. Large tenants in a shared pool skew statistics (one tenant with 40% of rows); consider extended statistics or moving them. In Citus, distribute by <code>tenant_id</code> and co-locate related tables so tenant queries route to a single shard.</p>`,
  security: `<p>Isolation layers: network and authentication (who can connect), roles and grants (which objects), RLS (which rows), and optionally encryption with per-tenant keys at the application layer. Audit cross-tenant access by support staff (use a separate role with BYPASSRLS only through an audited procedure). For data residency, place tenants in regional databases — RLS cannot move data to a jurisdiction.</p>`,
  scenario: {
    title: 'One enterprise tenant makes the shared pool slow for everyone',
    steps: [
      '1. Identify the tenant: per-tenant query time from application tags or pg_stat_statements with tenant comments; per-tenant row counts.',
      '2. Short term: rate-limit or route its heavy reports to a replica.',
      '3. Create a dedicated database with the same migrations; set up logical replication with a row filter WHERE tenant_id = X (PG15+).',
      '4. Cut over: pause writes for the tenant, wait for replication to catch up, flip the tenant directory entry, resume.',
      '5. Delete the tenant\'s rows from the pool in batches.'
    ]
  },
  widgets: ['diagram:multi-tenant', 'lab:security'],
  interview: [
    { q: 'Compare shared-table, schema-per-tenant and database-per-tenant models.', a: 'Shared tables with tenant_id scale to millions of tenants at lowest cost with one migration path, but isolation is logical and noisy neighbours are a risk. Schema-per-tenant gives namespace separation but catalog size and migration time grow with tenants. Database-per-tenant gives strong isolation and easy per-tenant backup at higher cost, practical for hundreds of tenants.' },
    { q: 'How do you make RLS-based tenancy safe?', a: 'Use a non-owner, non-superuser app role (or FORCE ROW LEVEL SECURITY), policies with USING and WITH CHECK that fail closed when the tenant is unset, set the tenant per transaction with SET LOCAL, tenant-leading keys, and automated cross-tenant isolation tests.' },
    { q: 'How would you move a large tenant out of a shared database?', a: 'Provision the target, apply the schema, replicate the tenant\'s rows with logical replication using row filters (PG15+) or a CDC tool, catch up, briefly pause the tenant\'s writes, switch the tenant directory, then delete the old rows in batches.' },
    { q: 'When would you choose Citus?', a: 'When a shared-schema multi-tenant app outgrows one node: distributing tables by tenant_id keeps each tenant\'s data co-located on one shard, so most queries route to a single node while the cluster scales horizontally. Citus is an extension/distributed database, not core PostgreSQL.' }
  ],
  exercises: [
    { task: 'List all RLS policies in the database with their table and USING expression.', solution: `SELECT schemaname, tablename, policyname, cmd, qual
FROM   pg_policies
ORDER  BY schemaname, tablename;`, run: true },
    { task: 'Find which tables in public have a tenant_id column.', solution: `SELECT table_name
FROM   information_schema.columns
WHERE  table_schema = 'public' AND column_name = 'tenant_id';`, run: true },
    { task: 'Enable RLS on a copy of users (users_rls) with a tenant policy, then as a non-owner role with app.tenant_id = 2 count visible rows.', solution: `CREATE TABLE users_rls AS SELECT * FROM users;
ALTER TABLE users_rls ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON users_rls USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int);
CREATE ROLE rls_reader NOLOGIN;
GRANT SELECT ON users_rls TO rls_reader;
SET ROLE rls_reader;
SET app.tenant_id = '2';
SELECT count(*) AS visible FROM users_rls;
RESET ROLE;`, run: true }
  ],
  challenge: {
    task: 'Add a per-tenant unique constraint on project names (unique within a tenant, duplicates allowed across tenants) to a saas.projects table and prove both behaviours.',
    hint: 'UNIQUE (tenant_id, name); insert the same name for two tenants (ok) and twice for one tenant (catch unique_violation).',
    solution: `CREATE SCHEMA saas;
CREATE TABLE saas.projects (tenant_id int NOT NULL, id bigint GENERATED ALWAYS AS IDENTITY,
                            name text NOT NULL, PRIMARY KEY (tenant_id, id),
                            UNIQUE (tenant_id, name));
INSERT INTO saas.projects (tenant_id, name) VALUES (1, 'Roadmap'), (2, 'Roadmap');
DO $$
BEGIN
  INSERT INTO saas.projects (tenant_id, name) VALUES (1, 'Roadmap');
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'duplicate within tenant 1 rejected';
END $$;
SELECT tenant_id, name FROM saas.projects ORDER BY tenant_id;`,
    run: true
  },
  related: ['row-level-security', 'production-architecture-ecommerce-design', 'sharding', 'distributed-postgresql', 'connection-pooling'],
  quiz: [
    { type: 'tf', q: 'Row-level security policies apply to the table owner by default.', answer: false, explain: 'Owners (and superusers, BYPASSRLS roles) bypass RLS unless ALTER TABLE ... FORCE ROW LEVEL SECURITY is set (superusers always bypass).' },
    { type: 'design', q: 'A SaaS has 200,000 small tenants. Best default model?', options: ['Database per tenant', 'Schema per tenant', 'Shared tables with tenant_id + RLS', 'Cluster per tenant'], answer: 2, explain: 'Only shared tables scale to hundreds of thousands of tenants economically; dedicated tiers can be added for large tenants.' },
    { type: 'bug', q: 'Behind PgBouncer (transaction mode) tenants occasionally see each other\'s data. Why?', code: `-- per request
SET app.tenant_id = :tenant;
SELECT * FROM projects;`, options: ['RLS is broken', 'Session-level SET persists on pooled server connections; another client\'s request may run with a stale tenant', 'PgBouncer caches results', 'tenant_id is not indexed'], answer: 1, explain: 'Use SET LOCAL inside a transaction (or set_config(..., true)).' },
    { type: 'mcq', q: 'Which is the main drawback of schema-per-tenant at large scale?', options: ['No isolation', 'Catalog bloat and N-times migrations/maintenance', 'Cannot use indexes', 'Requires Citus'], answer: 1, explain: 'Each tenant multiplies tables/indexes in the catalogs, slowing DDL, dumps, planning and autovacuum scheduling.' }
  ]
}
]);

/* ---------------- PRODUCTION ARCHITECTURE (continued) ---------------- */
PGM.addLessons([
{
  id: 'production-architecture-prod-cluster',
  module: 'production-architecture',
  title: 'Production PostgreSQL Cluster Reference Architecture',
  level: 6,
  minutes: 28,
  summary: 'A reference production cluster: primary with synchronous and asynchronous replicas, Patroni for HA, PgBouncer pooling, HAProxy routing, pgBackRest backups with WAL archiving to object storage, monitoring, and a disaster-recovery region.',
  objectives: [
    'Draw and explain each component of a production PostgreSQL cluster',
    'Choose between synchronous and asynchronous replication and quorum commit',
    'Explain how Patroni, a DCS (etcd/Consul), HAProxy and PgBouncer cooperate during failover',
    'Design backups with pgBackRest: full/differential/incremental + continuous WAL archiving to object storage',
    'Plan a DR region with RPO/RTO targets and verify the cluster from SQL'
  ],
  concept: `<p>No single PostgreSQL server is production-ready on its own. A reference cluster combines core PostgreSQL features (streaming replication, WAL archiving) with <span class="tag tool">third-party tools</span> for orchestration, pooling, routing and backup:</p>
<table>
<tr><th>Layer</th><th>Component</th><th>Role</th></tr>
<tr><td>Data</td><td><strong>Primary</strong> <span class="tag core">core</span></td><td>All writes; streams WAL to replicas</td></tr>
<tr><td>Data</td><td><strong>Sync replica</strong> (same region, other AZ)</td><td><code>synchronous_standby_names</code>: commits wait for it → RPO = 0 within region</td></tr>
<tr><td>Data</td><td><strong>Async replicas</strong></td><td>Read scaling, reporting; may lag slightly</td></tr>
<tr><td>HA</td><td><strong>Patroni</strong> + <strong>etcd/Consul</strong> (DCS)</td><td>Leader election with a lease, automatic failover, fencing, config management</td></tr>
<tr><td>Routing</td><td><strong>HAProxy</strong> (or a cloud LB / VIP)</td><td>Health-checks Patroni's REST API: port 5000 → leader, 5001 → replicas</td></tr>
<tr><td>Pooling</td><td><strong>PgBouncer</strong></td><td>Thousands of client connections → tens of server connections (transaction mode)</td></tr>
<tr><td>Backup</td><td><strong>pgBackRest</strong> (or Barman, WAL-G)</td><td>Full/diff/incremental backups + continuous WAL archive to object storage (S3/GCS/Azure Blob), encrypted, with retention; PITR</td></tr>
<tr><td>Observability</td><td>postgres_exporter, node_exporter, Prometheus, Grafana, log shipping</td><td>Metrics, alerts, logs</td></tr>
<tr><td>DR</td><td><strong>Standby cluster in another region</strong></td><td>Async streaming (or restore from archive); promoted manually or by runbook</td></tr>
</table>
<p><strong>Analogy:</strong> an airline. The captain (primary) flies; the first officer (sync replica) mirrors every action and can take over instantly; other crew (async replicas) handle passengers (reads). The airline operations centre (Patroni + etcd) decides who is captain if one is incapacitated — only one captain at a time (leader lease). Gate agents (HAProxy) send passengers to the right aircraft; the boarding queue manager (PgBouncer) prevents a stampede. The black box recorder (WAL archive) and periodic full inspections (base backups) let you reconstruct any moment. A second hub in another city (DR region) keeps flying if the first one closes.</p>`,
  why: `<p>Hardware fails, zones go down, humans run <code>DELETE</code> without <code>WHERE</code>. Each layer covers a different failure: replicas cover node failure (minutes of RTO without HA automation, seconds with it); sync replication covers data loss on node failure; backups + WAL archive cover logical errors and corruption (replicas faithfully replicate your mistakes!); the DR region covers regional disasters. Pooling and routing make failover transparent to applications.</p>`,
  useCase: `<p>A payments processor in India (RBI data-localisation) runs: primary + sync replica in Mumbai AZ-a/AZ-b, an async read replica in AZ-c for reporting, Patroni with a 3-node etcd across the three AZs, HAProxy pairs behind a cloud load balancer, PgBouncer on each app node, pgBackRest full backups weekly + differential daily + WAL archiving to an encrypted S3 bucket in Mumbai with 35-day retention, and a DR standby cluster in Hyderabad (async, ~1 s lag). Targets: RPO 0 / RTO &lt; 30 s for node or AZ failure; RPO &lt; 5 s / RTO &lt; 15 min for region failure; PITR to any second in 35 days. Quarterly they test failover and a full restore.</p>`,
  internals: `<p><strong>Synchronous commit</strong>: with <code>synchronous_standby_names = 'ANY 1 (replica_b, replica_c)'</code> (quorum), a commit returns only after at least one listed standby confirms flush (<code>synchronous_commit = on</code>) or apply (<code>remote_apply</code>). If no sync standby is available, commits block — Patroni's <code>synchronous_mode</code> manages the list so a healthy async replica is promoted to sync, and <code>synchronous_mode_strict</code> chooses blocking over availability.</p>
<p><strong>Failover with Patroni</strong>: each node runs a Patroni agent; the leader holds a key in etcd with a TTL and renews it. If it stops renewing (crash, partition), replicas race to acquire the key; Patroni picks the healthiest (least lag, sync standby preferred), promotes it (<code>pg_promote()</code>), and other replicas follow the new timeline (using <code>pg_rewind</code> for the old primary). A primary that loses the lease demotes itself — fencing that prevents split brain. HAProxy notices via Patroni's REST health endpoints and reroutes in seconds.</p>
<p><strong>Backups</strong>: pgBackRest takes base backups (in parallel, compressed, encrypted, with checksums), and <code>archive_command</code> (or <code>archive_library</code>) pushes each completed WAL segment to the repository. PITR restores a base backup and replays archived WAL up to <code>recovery_target_time</code>. PostgreSQL 17 also added native incremental base backups (<code>pg_basebackup --incremental</code> with <code>summarize_wal = on</code>, combined via <code>pg_combinebackup</code>).</p>`,
  whenNot: `<p>Small internal apps may only need a managed service (RDS/Aurora, Cloud SQL, Azure Flexible Server) which bundles HA, backups and monitoring — building this stack yourself costs engineering time. Synchronous replication across distant regions adds the round-trip time to every commit (e.g. 20–40 ms) — keep sync replicas in-region. Do not count replicas as backups.</p>`,
  syntax: `# primary postgresql.conf (managed by Patroni in practice)
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
synchronous_standby_names = 'ANY 1 (pg_b, pg_c)'
archive_mode = on
archive_command = 'pgbackrest --stanza=main archive-push %p'
max_slot_wal_keep_size = 100GB
hot_standby_feedback = on          # on replicas serving long reports (trade-off: bloat on primary)`,
  examples: [
    {
      label: 'Basic',
      title: 'Am I on the primary? What is the replication configuration?',
      sql: `SELECT pg_is_in_recovery()                        AS is_replica,
       pg_current_wal_lsn()                        AS current_lsn,
       (SELECT system_identifier FROM pg_control_system()) AS cluster_id;

SELECT name, current_setting(name) AS value
FROM   pg_settings
WHERE  name IN ('wal_level', 'max_wal_senders', 'max_replication_slots',
                'synchronous_standby_names', 'synchronous_commit',
                'archive_mode', 'archive_command', 'hot_standby',
                'hot_standby_feedback', 'max_slot_wal_keep_size', 'data_checksums')
ORDER  BY name;`,
      explain: `<p><code>pg_is_in_recovery()</code> is false on a primary and true on standbys — health checks and routing logic rely on it. <code>system_identifier</code> is shared by a primary and all its physical replicas (same cluster lineage). The settings show what this node is prepared for: <code>wal_level = replica</code> and WAL senders allow streaming replicas; <code>archive_mode = off</code> here means no PITR (the playground has no archive). In production you expect <code>archive_mode = on</code> with a pgBackRest/Barman/WAL-G command, data checksums on, and a capped <code>max_slot_wal_keep_size</code>.</p>`,
      output: ` is_replica | current_lsn | cluster_id
------------+-------------+---------------------
 f          | 0/1E6C260   | 7693148383034834986

 name                      | value
---------------------------+------------
 archive_command           | (disabled)
 archive_mode              | off
 data_checksums            | on
 hot_standby               | on
 hot_standby_feedback      | off
 max_replication_slots     | 10
 max_slot_wal_keep_size    | -1
 max_wal_senders           | 10
 synchronous_commit        | on
 synchronous_standby_names |
 wal_level                 | replica`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Replication health from the primary',
      sql: `-- One row per connected standby (empty in the single-node playground)
SELECT application_name,
       client_addr,
       state,                                         -- streaming / catchup
       sync_state,                                    -- sync / quorum / async / potential
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn))   AS send_lag,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS replay_lag_bytes,
       write_lag, flush_lag, replay_lag
FROM   pg_stat_replication
ORDER  BY application_name;

-- Replication slots and the WAL they retain
SELECT slot_name, slot_type, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
       wal_status, safe_wal_size
FROM   pg_replication_slots;

-- WAL archiving status
SELECT archived_count, failed_count, last_archived_wal, last_failed_wal
FROM   pg_stat_archiver;`,
      explain: `<p>These three queries are the core of replication monitoring. <code>pg_stat_replication</code> on the primary shows each standby's state, sync role and lag in bytes and time (<code>replay_lag</code> is the delay until a commit becomes visible on the replica). <code>pg_replication_slots</code> shows WAL retained for each slot; an inactive slot with growing <code>retained_wal</code> will fill the disk unless <code>max_slot_wal_keep_size</code> caps it (<code>wal_status = 'lost'</code> then). <code>pg_stat_archiver.failed_count</code> rising means PITR is broken. All empty/zero in the single-node playground.</p>`,
      output: `(0 rows)   -- pg_stat_replication: no standbys in the playground
(0 rows)   -- pg_replication_slots

 archived_count | failed_count | last_archived_wal | last_failed_wal
----------------+--------------+-------------------+-----------------
              0 |            0 |                   |`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Reference topology as configuration (Patroni, PgBouncer, HAProxy, pgBackRest)',
      sql: `# ---------------- patroni.yml (excerpt) ----------------
scope: payments-main
name: pg-a
restapi: { listen: 0.0.0.0:8008, connect_address: 10.0.1.11:8008 }
etcd3: { hosts: 10.0.1.21:2379,10.0.2.21:2379,10.0.3.21:2379 }   # 3 AZs, odd count
bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    maximum_lag_on_failover: 1048576     # never promote a replica > 1MB behind
    synchronous_mode: true               # Patroni manages synchronous_standby_names
    postgresql:
      use_pg_rewind: true
      parameters:
        wal_level: replica
        max_wal_senders: 10
        max_replication_slots: 10
        archive_mode: "on"
        archive_command: "pgbackrest --stanza=main archive-push %p"
        max_slot_wal_keep_size: 100GB

# ---------------- haproxy.cfg (excerpt) ----------------
listen primary
  bind *:5000
  option httpchk GET /primary            # Patroni returns 200 only on the leader
  http-check expect status 200
  server pg-a 10.0.1.11:6432 check port 8008
  server pg-b 10.0.2.11:6432 check port 8008
  server pg-c 10.0.3.11:6432 check port 8008
listen replicas
  bind *:5001
  balance roundrobin
  option httpchk GET /replica?lag=10MB    # only replicas with < 10MB lag
  server pg-b 10.0.2.11:6432 check port 8008
  server pg-c 10.0.3.11:6432 check port 8008

# ---------------- pgbouncer.ini (excerpt) ----------------
[databases]
payments = host=127.0.0.1 port=5432 dbname=payments
[pgbouncer]
pool_mode = transaction
max_client_conn = 5000
default_pool_size = 40
max_prepared_statements = 200            # protocol-level prepared statements (1.21+)

# ---------------- pgbackrest.conf (excerpt) ----------------
[global]
repo1-type=s3
repo1-s3-bucket=payments-pg-backups-mumbai
repo1-s3-region=ap-south-1
repo1-cipher-type=aes-256-cbc
repo1-retention-full=5
process-max=8
[main]
pg1-path=/var/lib/postgresql/18/main
# schedule: full weekly, diff daily; test restores quarterly`,
      explain: `<p>This is configuration for third-party tools, not SQL (not runnable). Key points: etcd has an odd number of members across AZs so a majority survives one AZ loss; Patroni's <code>maximum_lag_on_failover</code> prevents promoting a stale replica; <code>synchronous_mode</code> lets Patroni maintain the sync standby list; HAProxy routes by asking Patroni's REST API who is primary or a healthy replica (here pointing at PgBouncer on each node, port 6432); PgBouncer multiplexes 5,000 clients onto 40 server connections; pgBackRest stores encrypted backups in an in-region S3 bucket with retention. Apps connect to HAProxy:5000 for writes and :5001 for reads.</p>`,
      output: `# Resulting endpoints
writes  -> haproxy:5000 -> PgBouncer -> current Patroni leader
reads   -> haproxy:5001 -> PgBouncer -> healthy replicas (lag < 10MB)
backups -> s3://payments-pg-backups-mumbai (full + diff + WAL), PITR window 35 days
DR      -> standby cluster in second region (Patroni standby_cluster), promote by runbook`,
      run: false
    }
  ],
  compare: {
    bad: { sql: `-- "We have a replica, so we don't need backups"
SELECT pg_is_in_recovery() AS i_am_a_replica;
-- An accidental DELETE on the primary is replicated within milliseconds.`, why: 'Replication copies every change, including mistakes and logical corruption. Without base backups + WAL archive, you cannot go back to 10:04 before the bad DELETE.', run: true },
    good: { sql: `-- Verify the safety net exists: archiving works and is recent
SELECT current_setting('archive_mode') AS archive_mode,
       archived_count, failed_count,
       last_archived_time,
       now() - last_archived_time AS since_last_archive
FROM   pg_stat_archiver;`, why: 'Replicas for availability, backups + continuous WAL archiving for recoverability (PITR). Monitor archiving freshness and test restores regularly.', run: true }
  },
  mistakes: [
    `Treating replicas as backups.`,
    `Running etcd/Consul with 2 members or all in one AZ — no quorum after a single failure.`,
    `Synchronous replication to a distant region — every commit pays the WAL round trip.`,
    `Failover without fencing (scripts that promote a replica while the old primary is still accepting writes) → split brain.`,
    `Never testing restores; discovering during an incident that backups are incomplete or the restore takes 14 hours.`,
    `Unbounded replication slots filling the primary's disk after a replica dies.`
  ],
  best: [
    `Three nodes across three AZs, Patroni + 3/5-node DCS, sync replica in-region with quorum commit.`,
    `pgBackRest (or Barman / WAL-G) with full + differential/incremental backups, continuous WAL archiving to encrypted, versioned, in-region object storage; copy to a second region for DR.`,
    `Route via HAProxy/VIP using Patroni health endpoints; pool with PgBouncer; keep application connection strings pointing at the router, never at nodes.`,
    `Define and test RPO/RTO: quarterly failover drills and full restore tests with timing.`,
    `Cap slot retention (<code>max_slot_wal_keep_size</code>), enable data checksums, monitor lag/archiving/slots.`
  ],
  performance: `<p>Synchronous replication adds one network round trip plus standby fsync to commit latency (in-region typically 0.5–2 ms). Async replicas add read capacity; heavy reports on replicas may conflict with WAL replay (cancellations) or, with <code>hot_standby_feedback = on</code>, cause bloat on the primary. PgBouncer adds ~tens of microseconds per query but saves far more by avoiding connection overhead. Backups consume IO and network — run them from a replica where the tool supports it (pgBackRest <code>backup-standby</code>).</p>`,
  security: `<p>TLS for client, replication and backup traffic; SCRAM authentication; replication users with only the <code>REPLICATION</code> attribute; etcd with TLS and auth (it controls who becomes primary!); Patroni REST API protected; backup repository encrypted (pgBackRest cipher) with keys in a secrets manager and object-lock/versioning against ransomware deletion; network segmentation so only app subnets reach HAProxy/PgBouncer.</p>`,
  scenario: {
    title: 'The primary\'s availability zone goes dark',
    steps: [
      '1. Patroni on pg-a cannot renew the leader key; after ttl (30 s) the lease expires.',
      '2. Patroni on pg-b (sync standby, zero lag) acquires the key and promotes; pg-c follows the new timeline.',
      '3. HAProxy health checks: /primary now returns 200 on pg-b; port 5000 routes there within seconds; PgBouncer reconnects.',
      '4. Applications see a few seconds of errors and retry (idempotency keys make retries safe).',
      '5. When AZ-a returns, Patroni demotes pg-a, runs pg_rewind and re-joins it as a replica.',
      '6. Post-incident: verify no data loss (sync standby), check WAL archiving resumed from the new primary, record RTO.'
    ]
  },
  widgets: ['diagram:prod-cluster', 'diagram:ha', 'diagram:backup-pitr', 'diagram:pgbouncer'],
  interview: [
    { q: 'Describe a production-grade PostgreSQL HA architecture.', a: 'Three nodes across availability zones: a primary, an in-region synchronous (quorum) standby and async replicas; Patroni with an etcd/Consul quorum for leader election and fencing; HAProxy or a VIP routing writes to the leader and reads to healthy replicas via Patroni health checks; PgBouncer for pooling; pgBackRest base backups plus continuous WAL archiving to object storage for PITR; monitoring and alerting; a DR standby cluster in another region.' },
    { q: 'How does Patroni prevent split brain?', a: 'Leadership is a key with a TTL in a consensus store (etcd/Consul/ZooKeeper). Only the holder may be primary and must keep renewing it; a node that cannot renew demotes itself. Replicas promote only after acquiring the expired key, so two primaries cannot hold the lease at once.' },
    { q: 'Why are replicas not backups?', a: 'Replicas apply every change from the primary almost immediately, including accidental deletes, bad migrations and logical corruption. Backups with WAL archiving allow point-in-time recovery to before the error.' },
    { q: 'Sync vs async replication: how do you decide?', a: 'Sync gives RPO = 0 for node failure at the cost of commit latency and possible write blocking if no sync standby is available; use it in-region with quorum (ANY 1 of 2). Async has no commit penalty but may lose the last few transactions on failover; use it for read replicas and cross-region DR.' }
  ],
  exercises: [
    { task: 'Write a health-check query a load balancer could use to decide whether a node is a writable primary.', solution: `SELECT CASE WHEN pg_is_in_recovery() THEN 'replica' ELSE 'primary' END AS role,
       NOT pg_is_in_recovery() AS writable;`, run: true },
    { task: 'Report the total size of WAL currently in pg_wal.', solution: `SELECT count(*) AS segments, pg_size_pretty(sum(size)) AS wal_size
FROM   pg_ls_waldir();`, run: true },
    { task: 'List replication slots that are inactive (would retain WAL forever).', solution: `SELECT slot_name, slot_type, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM   pg_replication_slots
WHERE  NOT active;`, run: true }
  ],
  challenge: {
    task: 'Write one "cluster readiness" query returning rows (check, status, detail) for: archive_mode on, data_checksums on, max_slot_wal_keep_size set (not -1), synchronous_standby_names configured, and wal_level at least replica. Status is PASS/FAIL.',
    hint: 'Use a VALUES list of (check, condition, detail) built from current_setting().',
    solution: `SELECT chk AS check_name,
       CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status,
       detail
FROM (VALUES
  ('archive_mode on',            current_setting('archive_mode') IN ('on', 'always'),          current_setting('archive_mode')),
  ('data checksums',             current_setting('data_checksums') = 'on',                     current_setting('data_checksums')),
  ('slot WAL retention capped',  current_setting('max_slot_wal_keep_size') <> '-1',            current_setting('max_slot_wal_keep_size')),
  ('synchronous standby set',    current_setting('synchronous_standby_names') <> '',           coalesce(nullif(current_setting('synchronous_standby_names'), ''), '(none)')),
  ('wal_level >= replica',       current_setting('wal_level') IN ('replica', 'logical'),       current_setting('wal_level'))
) AS c(chk, ok, detail)
ORDER BY status, check_name;`,
    run: true
  },
  related: ['high-availability', 'replication', 'backup-restore', 'connection-pooling', 'failover'],
  quiz: [
    { type: 'mcq', q: 'Which component decides which node is primary in a Patroni cluster?', options: ['HAProxy', 'PgBouncer', 'The consensus store (etcd/Consul) leader key managed by Patroni', 'pgBackRest'], answer: 2, explain: 'Patroni agents compete for a leader key with TTL in the DCS; HAProxy only follows.' },
    { type: 'tf', q: 'A synchronous replica in another continent is a good way to get RPO = 0 with no performance impact.', answer: false, explain: 'Every commit would wait for an intercontinental round trip (often 100+ ms).' },
    { type: 'mcq', q: 'What enables point-in-time recovery?', options: ['Streaming replicas', 'Base backups plus continuous WAL archiving', 'pg_dump nightly', 'hot_standby_feedback'], answer: 1, explain: 'PITR replays archived WAL on top of a base backup up to a target time/LSN.' },
    { type: 'scenario', q: 'pg_replication_slots shows an inactive slot retaining 800GB of WAL; disk is 92% full. First action?', options: ['Restart PostgreSQL', 'Confirm the consumer is gone and drop the slot (pg_drop_replication_slot); then set max_slot_wal_keep_size', 'Delete files from pg_wal', 'Increase max_wal_size'], answer: 1, explain: 'Never delete WAL files manually. Drop the abandoned slot to release WAL and cap retention for the future.' }
  ]
},
{
  id: 'production-architecture-readiness',
  module: 'production-architecture',
  title: 'Production Readiness: Observability, Runbooks, Capacity Planning and Cost',
  level: 6,
  minutes: 24,
  summary: 'What "production ready" means for a PostgreSQL service: SLOs and observability, runbooks for the top incidents, capacity planning from growth data, and cost control — with SQL to measure growth and headroom.',
  objectives: [
    'Define SLOs and the observability needed to measure them',
    'Write runbooks for the most common PostgreSQL incidents',
    'Forecast storage, connection and IO capacity from measurements',
    'Identify the main cost drivers and levers (instance, storage, IOPS, replicas, backups, egress)',
    'Run a production readiness review checklist before launch'
  ],
  concept: `<p>"Production ready" is not a feature — it is a set of answered questions: <em>How do we know it is healthy? What do we do when it is not? Will it still fit in six months? What does it cost and why?</em></p>
<p><strong>Analogy:</strong> commissioning a hospital, not just building it. Monitors on every bed (observability), written protocols for cardiac arrest (runbooks), bed-capacity projections for flu season (capacity planning), and a budget that does not bankrupt the hospital (cost).</p>
<h4>1. Observability & SLOs</h4>
<ul>
<li>SLOs from the user's point of view: e.g. 99.95% of checkout transactions &lt; 200 ms, availability 99.95% monthly, RPO ≤ 5 s, RTO ≤ 60 s.</li>
<li>Metrics (exporter + Prometheus), logs (slow queries, lock waits, autovacuum, errors), query statistics (<code>pg_stat_statements</code> <span class="tag ext">extension</span>), traces (application spans with SQL timing), dashboards per service.</li>
</ul>
<h4>2. Runbooks (one page each)</h4>
<table>
<tr><th>Incident</th><th>First query / action</th></tr>
<tr><td>High latency</td><td>pg_stat_activity grouped by wait_event; top queries in pg_stat_statements</td></tr>
<tr><td>Lock pile-up</td><td>Blocking tree via pg_blocking_pids(); terminate root blocker</td></tr>
<tr><td>Connections exhausted</td><td>Connections by app/state; pooler status; terminate idle-in-transaction</td></tr>
<tr><td>Disk filling</td><td>WAL vs data; slots; archiver; largest relations</td></tr>
<tr><td>Replication lag</td><td>pg_stat_replication lags; long queries on replica; network</td></tr>
<tr><td>Failover happened</td><td>Patroni history; data loss check; archiving from new primary</td></tr>
<tr><td>Bad deploy / data deleted</td><td>Stop writes path; PITR to a new instance; extract & repair</td></tr>
<tr><td>XID wraparound warning</td><td>Oldest xmin holders; vacuum freeze on oldest tables</td></tr>
</table>
<h4>3. Capacity planning</h4>
<p>Measure growth (database size, top tables, WAL/day, TPS, peak connections, CPU, IOPS) weekly; project 6–12 months; keep headroom (e.g. CPU p95 &lt; 60%, disk &lt; 70%, connections &lt; 70%). Plan scale steps before they are urgent: bigger instance, read replicas, partitioning/archiving, then sharding.</p>
<h4>4. Cost</h4>
<p>Main drivers on cloud: instance size (CPU/RAM), storage GB, provisioned IOPS/throughput, number of replicas, backup storage and retention, cross-AZ/region data transfer, and licences for managed features. Levers: right-size from metrics, fix the top queries (often the cheapest "scale-up"), drop unused indexes, archive or partition-drop old data, compress, use reserved/committed pricing, and send analytics to cheaper replicas or a warehouse.</p>`,
  why: `<p>Most outages and budget surprises are predictable: a disk that was 2% from full, a query plan that changed after data grew, a backup nobody tested, an on-call engineer without instructions at 3 a.m. Readiness work converts those into routine tasks, and it is what separates a database that works in staging from one a business can rely on.</p>`,
  useCase: `<p>Before launching in a new market, an online grocery runs a production readiness review for its order database: SLO dashboards wired to Grafana; alerts mapped to 9 runbooks; a load test at 3× expected peak showing CPU at 55% and p99 at 140 ms; capacity forecast showing the 2TB volume reaching 70% in 7 months (partition-drop of orders older than 24 months scheduled); a quarterly restore test measured at 41 minutes for PITR of 600GB; and a cost review that removed 19 unused indexes (–310GB storage, –12% WAL) and moved BI dashboards to an async replica, avoiding an instance upgrade worth about 30% of the monthly bill.</p>`,
  internals: `<p>Capacity comes from measurable internals: storage = heap + indexes + TOAST + bloat + WAL retention + backups; IO = buffer misses × page size + WAL writes + checkpoint writes + autovacuum; CPU = query execution + parse/plan + background work; memory = shared_buffers + per-connection overhead + work_mem bursts. Statistics are cumulative counters, so capacity work always starts by <em>sampling</em> them over time (or using a metrics store) and computing rates.</p>`,
  whenNot: `<p>Do not gold-plate: an internal tool with 20 users does not need a DR region and 15 runbooks — scale the rigour to the business impact (tiered services). Do not forecast from a single data point or a week containing a one-off backfill. Do not optimise cost by removing safety (no replica, no PITR) without an explicit, documented risk decision.</p>`,
  syntax: `-- Snapshot sizes for trend analysis
CREATE TABLE capacity_snapshots (taken_at timestamptz, relname text, total_bytes bigint);
INSERT INTO capacity_snapshots SELECT now(), relname, pg_total_relation_size(relid) FROM pg_stat_user_tables;
-- Growth rate per table = (latest - earliest) / days between`,
  examples: [
    {
      label: 'Basic',
      title: 'Headroom snapshot: connections, size, cache, XID age',
      sql: `SELECT (SELECT count(*) FROM pg_stat_activity
         WHERE backend_type IN ('client backend', 'standalone backend'))          AS connections,
       current_setting('max_connections')::int                                   AS max_connections,
       pg_size_pretty(pg_database_size(current_database()))                      AS db_size,
       (SELECT round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2)
          FROM pg_stat_database WHERE datname = current_database())             AS cache_hit_pct,
       (SELECT max(age(datfrozenxid)) FROM pg_database)                          AS max_xid_age,
       (SELECT count(*) FROM pg_stat_activity
         WHERE state LIKE 'idle in transaction%')                                AS idle_in_tx,
       (SELECT max(now() - xact_start) FROM pg_stat_activity)                    AS oldest_xact;`,
      explain: `<p>A one-row "vital signs" query — ideal for the top of a dashboard or a readiness review. Each value maps to an alert threshold from the Monitoring module: connections vs max (&lt; 70–80%), cache hit (OLTP &gt; 98–99%), XID age (alert &gt; 500M), idle-in-transaction sessions (0) and oldest transaction (minutes, not hours).</p>`,
      output: ` connections | max_connections | db_size | cache_hit_pct | max_xid_age | idle_in_tx | oldest_xact
-------------+-----------------+---------+---------------+-------------+------------+-------------
           1 |             100 | 11 MB   |         92.89 |          10 |          0 | 00:00:00`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Capacity snapshots and growth forecasting',
      sql: `CREATE TABLE capacity_snapshots (
  taken_at    timestamptz NOT NULL,
  relname     text        NOT NULL,
  total_bytes bigint      NOT NULL,
  PRIMARY KEY (relname, taken_at)
);

-- Simulate 4 weekly snapshots: today's real sizes, scaled down for earlier weeks
INSERT INTO capacity_snapshots
SELECT now() - make_interval(weeks => w),
       relname,
       (pg_total_relation_size(relid) * (1 - 0.06 * w))::bigint
FROM   pg_stat_user_tables, generate_series(0, 3) AS w;

-- Weekly growth and 26-week projection per table (linear regression)
SELECT relname,
       pg_size_pretty(max(total_bytes))                                         AS current_size,
       pg_size_pretty((regr_slope(total_bytes, extract(epoch FROM taken_at)) * 7 * 86400)::bigint)
                                                                                AS growth_per_week,
       pg_size_pretty((max(total_bytes)
                      + regr_slope(total_bytes, extract(epoch FROM taken_at)) * 26 * 7 * 86400)::bigint)
                                                                                AS projected_in_26_weeks
FROM   capacity_snapshots
GROUP  BY relname
ORDER  BY max(total_bytes) DESC
LIMIT  5;`,
      explain: `<p>In production a scheduled job (cron, pg_cron <span class="tag ext">extension</span>, or your metrics system) inserts real snapshots daily or weekly. Here we fabricate four weekly points (each earlier week 6% smaller) to demonstrate the analysis. <code>regr_slope(y, x)</code> fits a least-squares line: bytes per second × seconds per week = weekly growth; extrapolating 26 weeks gives the projection. Compare projections with volume size and plan actions (archive, partition-drop, expand storage) well before 70%.</p>`,
      output: ` relname     | current_size | growth_per_week | projected_in_26_weeks
-------------+--------------+-----------------+-----------------------
 order_items | 1368 kB      | 82 kB           | 3502 kB
 orders      | 984 kB       | 59 kB           | 2519 kB
 payments    | 504 kB       | 30 kB           | 1290 kB
 customers   | 176 kB       | 11 kB           | 451 kB
 employees   | 120 kB       | 7373 bytes      | 307 kB`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Cost levers: reclaimable index space and cold data candidates',
      sql: `-- 1) Index space that is never used for reads (candidates; verify on replicas first)
SELECT pg_size_pretty(sum(pg_relation_size(s.indexrelid))) AS unused_index_space,
       count(*)                                           AS unused_indexes
FROM   pg_stat_user_indexes s
JOIN   pg_index i ON i.indexrelid = s.indexrelid
WHERE  s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary;

-- 2) Cold data: how much of orders is older than 12 months before the newest order?
WITH bounds AS (SELECT max(order_date) AS newest FROM orders)
SELECT count(*) FILTER (WHERE o.order_date < b.newest - interval '12 months')        AS cold_orders,
       count(*)                                                                    AS all_orders,
       round(100.0 * count(*) FILTER (WHERE o.order_date < b.newest - interval '12 months')
             / count(*), 1)                                                        AS cold_pct,
       pg_size_pretty((pg_total_relation_size('orders')
                       * count(*) FILTER (WHERE o.order_date < b.newest - interval '12 months')
                       / count(*))::bigint)                                         AS approx_cold_bytes
FROM   orders o CROSS JOIN bounds b;`,
      explain: `<p>Two of the largest cost levers in mature databases: indexes that cost storage, WAL, backup size and write IO without serving reads; and cold data that occupies premium storage although it is rarely queried. Here ~45% of orders are more than 12 months older than the newest order — with time partitioning, those partitions could be detached and moved to cheaper storage or an archive (e.g. Parquet in object storage) with a documented retrieval path.</p>`,
      output: ` unused_index_space | unused_indexes
--------------------+----------------
 248 kB             |              3

 cold_orders | all_orders | cold_pct | approx_cold_bytes
-------------+------------+----------+-------------------
        2242 |       5000 |     44.8 | 441 kB`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- "Capacity planning": look at today's size once a year
SELECT pg_size_pretty(pg_database_size(current_database())) AS size_today;`, why: 'A single point says nothing about growth rate, seasonality or when you will run out. Problems are discovered when the disk is full.', run: true },
    good: { sql: `-- Trend from stored snapshots (collected daily by a job)
CREATE TABLE db_size_history (taken_at date PRIMARY KEY, bytes bigint NOT NULL);
INSERT INTO db_size_history
SELECT current_date - d, (pg_database_size(current_database()) * (1 - 0.01 * d))::bigint
FROM   generate_series(0, 29) d;
SELECT pg_size_pretty((regr_slope(bytes, taken_at - DATE '2000-01-01'))::bigint) AS growth_per_day,
       pg_size_pretty(max(bytes)) AS current
FROM   db_size_history;`, why: 'Regular snapshots give growth rates and forecasts, so storage expansion, archiving or partitioning happens on a schedule rather than during an outage.', run: true }
  },
  mistakes: [
    `Alerts without runbooks — on-call gets paged with no idea what to do.`,
    `Never testing restore and failover; RTO/RPO are aspirations, not measurements.`,
    `Forecasting from data that includes one-off events (bulk imports, backfills).`,
    `Over-provisioning "to be safe" for years instead of right-sizing from metrics.`,
    `Cutting cost by dropping replicas/backups without an explicit risk decision.`
  ],
  best: [
    `Write SLOs first; derive alerts from SLO burn rates and from leading indicators (disk forecast, XID age, lag).`,
    `One-page runbooks for the top 10 incidents, linked from alerts; practise them in game days.`,
    `Weekly capacity review with 6–12 month forecasts and planned actions.`,
    `Cost review quarterly: top queries (CPU), unused indexes, cold data, replica utilisation, backup retention.`,
    `A production readiness checklist signed off before launch and after major changes.`
  ],
  performance: `<p>The cheapest capacity is usually query efficiency: fixing the top 5 queries by total time in <code>pg_stat_statements</code> often frees 30–70% of CPU and IO. Load-test with production-like data volumes and distribution (not empty tables) and with realistic concurrency through the pooler; measure p95/p99, not averages.</p>`,
  security: `<p>Readiness includes security readiness: least-privilege roles, TLS, SCRAM, secrets in a vault, audit logging, encrypted backups with tested key recovery, patching cadence (minor releases quarterly), and an incident response runbook for credential leaks (rotate passwords, revoke sessions, review audit logs).</p>`,
  scenario: {
    title: 'Production readiness review for a new service database',
    steps: [
      '1. Architecture: HA topology, backup + PITR, DR plan with RPO/RTO — documented and tested.',
      '2. Observability: dashboards (golden signals), pg_stat_statements, slow-query and lock logs, alerts with runbooks.',
      '3. Schema: catalog lint passes (PKs, FK indexes, no invalid indexes); migrations reviewed and timed on prod-sized data.',
      '4. Capacity: load test at 2–3× peak; 12-month storage and connection forecast; headroom targets met.',
      '5. Security: roles, TLS, secrets, audit, encrypted backups.',
      '6. Cost: estimate vs budget; levers identified; owners and review cadence assigned.'
    ]
  },
  widgets: ['diagram:prod-cluster'],
  interview: [
    { q: 'What would you include in a PostgreSQL production readiness review?', a: 'HA and backup/PITR design with tested RTO/RPO, monitoring dashboards and alerts linked to runbooks, query statistics, schema linting, migration review, load and capacity testing with forecasts, security controls (roles, TLS, secrets, audit, encrypted backups), and a cost estimate with owners.' },
    { q: 'How do you plan storage capacity?', a: 'Collect regular snapshots of database and table sizes and WAL volume, compute growth rates (e.g. linear regression), project 6–12 months, include bloat, indexes, WAL retention and backups, and schedule actions (archiving, partition drops, storage expansion) before crossing ~70% utilisation.' },
    { q: 'What are the biggest cost levers for a cloud PostgreSQL deployment?', a: 'Right-sizing the instance from metrics, optimising the top queries, removing unused indexes, archiving cold data, choosing storage/IOPS tiers correctly, using replicas only where they serve load or HA, backup retention policies, reserved pricing, and minimising cross-region transfer.' },
    { q: 'Why are runbooks important?', a: 'Incidents happen at bad times to tired people. A short, tested runbook with the exact queries and decision points reduces time to mitigation, prevents risky improvisation (like deleting WAL files) and spreads knowledge beyond one expert.' }
  ],
  exercises: [
    { task: 'Return the 5 largest relations (tables or indexes) in public with their kind and size.', solution: `SELECT c.relname, c.relkind, pg_size_pretty(pg_relation_size(c.oid)) AS size
FROM   pg_class c
WHERE  c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'i')
ORDER  BY pg_relation_size(c.oid) DESC
LIMIT  5;`, run: true },
    { task: 'Compute orders per month for 2025 and the busiest month (peak planning).', solution: `SELECT date_trunc('month', order_date)::date AS month, count(*) AS orders
FROM   orders
WHERE  order_date >= '2025-01-01' AND order_date < '2026-01-01'
GROUP  BY 1
ORDER  BY orders DESC
LIMIT  3;`, run: true },
    { task: 'Show what share of the database size is indexes.', solution: `SELECT pg_size_pretty(sum(pg_indexes_size(relid))) AS index_bytes,
       pg_size_pretty(pg_database_size(current_database())) AS db_bytes,
       round(100.0 * sum(pg_indexes_size(relid)) / pg_database_size(current_database()), 1) AS index_pct
FROM   pg_stat_user_tables;`, run: true }
  ],
  challenge: {
    task: 'Estimate peak write load for capacity planning: find the busiest hour (by order count) in the orders data, and the average items per order, then project inserts per second at 10x growth during that hour (orders + order_items).',
    hint: 'date_trunc(\'hour\', order_date), count per hour, max; items per order from order_items / orders.',
    solution: `WITH per_hour AS (
  SELECT date_trunc('hour', order_date) AS hr, count(*) AS orders
  FROM   orders GROUP BY 1
), peak AS (
  SELECT max(orders) AS peak_orders FROM per_hour
), items AS (
  SELECT (SELECT count(*) FROM order_items)::numeric / (SELECT count(*) FROM orders) AS items_per_order
)
SELECT peak_orders,
       round(items_per_order, 2)                                         AS items_per_order,
       round(peak_orders * 10 * (1 + items_per_order) / 3600.0, 3)       AS projected_inserts_per_sec_at_10x
FROM   peak, items;`,
    run: true
  },
  related: ['production-architecture-prod-cluster', 'monitoring-health-metrics', 'system-catalogs-dba-toolkit', 'production-optimization'],
  quiz: [
    { type: 'mcq', q: 'Which is the best basis for a storage forecast?', options: ['Today\'s database size', 'Regular size snapshots and a growth trend', 'The size of the largest table', 'The number of rows in orders'], answer: 1, explain: 'Growth rates over time (excluding one-off events) drive forecasts.' },
    { type: 'tf', q: 'If backups run successfully every night, RTO is known.', answer: false, explain: 'RTO is only known by timing actual restores (and failovers) regularly.' },
    { type: 'scenario', q: 'CPU is at 85% p95 and the team wants a bigger instance. First step?', options: ['Upgrade immediately', 'Check pg_stat_statements top queries by total time and optimise them', 'Add more indexes everywhere', 'Disable autovacuum'], answer: 1, explain: 'A handful of queries usually dominate; fixing them is often cheaper than scaling up.' },
    { type: 'mcq', q: 'Which item belongs in every alert?', options: ['The DBA\'s phone number', 'A link to the runbook', 'The full SQL log', 'A screenshot'], answer: 1, explain: 'Alerts should link to actionable runbooks.' }
  ]
}
]);

/* --------------------------- INTERVIEW PREP --------------------------- */
PGM.addLessons([
{
  id: 'interview-prep-sql-postgres',
  module: 'interview-prep',
  title: 'How to Approach SQL and PostgreSQL Interviews: Clarify, Think Aloud, Edge Cases, Complexity',
  level: 5,
  minutes: 22,
  summary: 'A repeatable method for SQL and PostgreSQL interview questions: ask clarifying questions, state assumptions, build the query incrementally out loud, test edge cases (NULLs, duplicates, ties, empty groups) and discuss indexes and complexity.',
  objectives: [
    'Use a 5-step framework for live SQL questions',
    'Ask the clarifying questions interviewers expect (grain, ties, NULLs, time zones, duplicates)',
    'Recognise classic traps: NOT IN with NULLs, COUNT(col) vs COUNT(*), ties in top-N, LEFT JOIN filters',
    'Explain query complexity and indexes in PostgreSQL terms',
    'Answer conceptual PostgreSQL questions with structure and precision'
  ],
  concept: `<p>Interviewers rarely want only the final query. They evaluate <strong>how you reason</strong>: whether you clarify ambiguity, handle edge cases, communicate, and know how PostgreSQL will execute your SQL. A structured approach turns a nervous whiteboard session into a calm, predictable conversation.</p>
<p><strong>Analogy:</strong> a doctor's consultation. A good doctor does not prescribe after the first sentence: they ask questions (clarify), say what they suspect and why (think aloud), order tests (examples and edge cases), then prescribe and explain side effects (complexity and indexes).</p>
<h4>The 5-step framework</h4>
<ol>
<li><strong>Clarify</strong> — What is one output row (the grain)? How to handle ties? NULLs? Duplicates? Time zone and date boundaries? Include zero-count groups? Expected size of tables?</li>
<li><strong>State assumptions and sketch the shape</strong> — "I'll aggregate orders per customer per month, then rank within month."</li>
<li><strong>Build incrementally, aloud</strong> — FROM/JOIN first, check row counts mentally, then WHERE, GROUP BY, window functions, final SELECT. Prefer CTEs for readability.</li>
<li><strong>Test edge cases</strong> — NULLs, duplicates, ties, empty input, a customer with no orders, boundary dates.</li>
<li><strong>Discuss performance</strong> — which indexes, what the plan would look like (scan types, join algorithm), complexity, and alternatives.</li>
</ol>
<h4>Classic traps (memorise these)</h4>
<table>
<tr><th>Trap</th><th>Why it bites</th><th>Fix</th></tr>
<tr><td><code>NOT IN (subquery)</code> where the subquery returns a NULL</td><td><code>x NOT IN (1, NULL)</code> is NULL, never true → zero rows</td><td><code>NOT EXISTS</code></td></tr>
<tr><td><code>COUNT(col)</code> vs <code>COUNT(*)</code></td><td>COUNT(col) skips NULLs</td><td>Choose deliberately</td></tr>
<tr><td>AVG with NULLs</td><td>NULLs are ignored, not treated as 0</td><td><code>avg(coalesce(x, 0))</code> if 0 is meant</td></tr>
<tr><td>Top-N with ties</td><td><code>LIMIT</code>/<code>ROW_NUMBER</code> drop tied rows arbitrarily</td><td><code>DENSE_RANK</code>/<code>RANK</code> or <code>FETCH FIRST n ROWS WITH TIES</code></td></tr>
<tr><td>Filtering the right table of a LEFT JOIN in WHERE</td><td>Turns it into an inner join</td><td>Move the condition into ON</td></tr>
<tr><td>Joining two one-to-many tables then summing</td><td>Fan-out double counts</td><td>Aggregate each side first</td></tr>
<tr><td>Date ranges with BETWEEN on timestamps</td><td>Misses or double counts boundaries</td><td><code>&gt;= start AND &lt; next_start</code></td></tr>
<tr><td>Integer division</td><td><code>1/2 = 0</code></td><td>Cast to numeric</td></tr>
</table>`,
  why: `<p>SQL is in almost every backend, data and DBA interview; PostgreSQL-specific questions (MVCC, VACUUM, indexes, EXPLAIN) separate juniors from seniors. Candidates usually fail not because they cannot write SQL, but because they rush into a query, miss an edge case the interviewer planted, and cannot explain performance.</p>`,
  useCase: `<p>Typical prompt: "Find the second-highest salary in each department." A strong candidate asks: "If two people share the highest salary, is the second-highest the next distinct value? Departments with only one salary level — return NULL or omit? Include inactive employees?" Then writes a DENSE_RANK solution, mentions ROW_NUMBER would be wrong with ties, notes an index on <code>(department_id, salary DESC)</code> would support it, and tests a department with one employee. This takes 6 minutes and scores far higher than a silent correct query.</p>`,
  internals: `<p>When discussing performance, speak PostgreSQL: "With an index on <code>orders(customer_id, order_date)</code> this becomes an index range scan per customer; without it, a sequential scan and a hash aggregate — O(n) over orders. The join to customers would likely be a hash join because both sides are large; for a single customer, a nested loop with index lookups." Mention that window functions require a sort (or an index providing the order), that <code>count(DISTINCT)</code> sorts/hashes, that <code>NOT EXISTS</code> becomes an anti-join, and that you would confirm with <code>EXPLAIN (ANALYZE, BUFFERS)</code>.</p>`,
  whenNot: `<p>Do not over-engineer simple questions (no CTE pyramids for a single GROUP BY). Do not argue with the interviewer's constraints — state your assumption and move on. Do not jump to product-specific features (LATERAL, DISTINCT ON) without saying they are PostgreSQL-specific when the role is database-agnostic; offer the standard SQL alternative too.</p>`,
  syntax: `-- Interview-friendly skeleton
WITH base AS (            -- 1. right grain, right filters
  SELECT ...
), agg AS (               -- 2. aggregate
  SELECT ..., count(*) ... GROUP BY ...
), ranked AS (            -- 3. rank / compare
  SELECT ..., dense_rank() OVER (PARTITION BY ... ORDER BY ... DESC) AS rnk FROM agg
)
SELECT ... FROM ranked WHERE rnk <= 3 ORDER BY ...;`,
  examples: [
    {
      label: 'Basic',
      title: 'The NOT IN + NULL trap, live on company_db',
      sql: `-- "Find employees who are not anyone's manager"
-- Attempt 1: NOT IN  (manager_id contains NULLs for department heads)
SELECT count(*) AS not_in_result
FROM   employees
WHERE  id NOT IN (SELECT manager_id FROM employees);

-- Attempt 2: NOT EXISTS (NULL-safe anti-join)
SELECT count(*) AS not_exists_result
FROM   employees e
WHERE  NOT EXISTS (SELECT 1 FROM employees r WHERE r.manager_id = e.id);

-- Why: what the subquery contains
SELECT count(*) AS all_rows, count(manager_id) AS non_null, count(DISTINCT manager_id) AS distinct_managers
FROM   employees;`,
      explain: `<p>The subquery returns 192 manager ids <em>and</em> 8 NULLs (department heads have no manager). <code>id NOT IN (…, NULL)</code> evaluates to NULL for every employee who is not a manager, so the first query returns <strong>0</strong> — silently wrong. <code>NOT EXISTS</code> returns the correct <strong>173</strong> (200 employees − 27 distinct managers). Saying this out loud in an interview is an instant credibility boost; also mention that PostgreSQL plans NOT EXISTS as an efficient hash anti-join.</p>`,
      output: ` not_in_result
---------------
             0

 not_exists_result
-------------------
               173

 all_rows | non_null | distinct_managers
----------+----------+-------------------
      200 |      192 |                27`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Second-highest salary per department — ties handled',
      sql: `WITH ranked AS (
  SELECT e.department_id,
         e.salary,
         dense_rank() OVER (PARTITION BY e.department_id ORDER BY e.salary DESC) AS dr
  FROM   employees e
)
SELECT d.name                                   AS department,
       max(r.salary) FILTER (WHERE r.dr = 2)     AS second_highest_salary
FROM   departments d
LEFT   JOIN ranked r ON r.department_id = d.id
GROUP  BY d.name
ORDER  BY d.name;`,
      explain: `<p>Clarifications assumed: "second highest" = second highest <em>distinct</em> salary (hence <code>DENSE_RANK</code>, not <code>ROW_NUMBER</code>, which would return a duplicate of the top salary when two people tie); departments with only one salary level should appear with NULL (hence <code>LEFT JOIN</code> from departments and a filtered aggregate). Performance talk: one pass over employees with a sort per department (or an index on <code>(department_id, salary DESC)</code>), then a small hash join to 8 departments.</p>`,
      output: ` department  | second_highest_salary
-------------+-----------------------
 Engineering |             149800.00
 Finance     |             149600.00
 HR          |             149700.00
 Marketing   |             149700.00
 Operations  |             144300.00
 Research    |             148800.00
 Sales       |             149300.00
 Support     |             144000.00`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Edge-case checklist in SQL: NULL aggregates, ties, fan-out',
      sql: `-- 1) NULLs in aggregates
SELECT avg(x) AS avg_x, sum(x) AS sum_x, count(x) AS count_x, count(*) AS count_star
FROM   (VALUES (10), (NULL), (20)) AS v(x);

-- 2) Ties: ROW_NUMBER vs RANK vs DENSE_RANK (deterministic tie-breaker on id)
SELECT first_name, salary,
       row_number() OVER w AS row_num,
       rank()       OVER w AS rnk,
       dense_rank() OVER w AS dense_rnk
FROM   employees
WHERE  salary IN (96500.00, 97800.00)
WINDOW w AS (ORDER BY salary DESC, id)
ORDER  BY salary DESC, id;

-- 3) Fan-out: summing an order-level column after joining a child table
SELECT sum(o.total_amount)                                          AS wrong_total_after_join,
       (SELECT sum(total_amount) FROM orders)                       AS correct_total,
       round(sum(o.total_amount) / (SELECT sum(total_amount) FROM orders), 2) AS inflation_factor
FROM   orders o
JOIN   order_items oi ON oi.order_id = o.id;`,
      explain: `<p>(1) <code>avg</code> ignores the NULL: (10 + 20) / 2 = 15, not 10; <code>count(x)</code> = 2 vs <code>count(*)</code> = 3. (2) With ties, ROW_NUMBER assigns arbitrary distinct numbers (we add <code>id</code> to make it deterministic), RANK leaves gaps (1, 1, 3), DENSE_RANK does not (1, 1, 2) — choose according to the clarified requirement. (3) Joining orders to their items repeats each order row once per item, so summing an order-level column (<code>total_amount</code>) triples the result (2.5 items per order on average, weighted by amount). Aggregate each child table separately (in CTEs or LATERAL subqueries) before joining, or sum at the correct grain.</p>`,
      output: ` avg_x               | sum_x | count_x | count_star
---------------------+-------+---------+------------
 15.0000000000000000 |    30 |       2 |          3

 first_name | salary   | row_num | rnk | dense_rnk
------------+----------+---------+-----+-----------
 Ananya     | 97800.00 |       1 |   1 |         1
 Isha       | 97800.00 |       2 |   1 |         1
 Isha       | 96500.00 |       3 |   3 |         2
 Vihaan     | 96500.00 |       4 |   3 |         2

 wrong_total_after_join | correct_total | inflation_factor
------------------------+---------------+------------------
          3705167035.74 | 1235923438.48 |             3.00`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Top 3 customers by spend: arbitrary cut at ties, includes cancelled orders
SELECT customer_id, sum(total_amount) AS spend
FROM   orders
GROUP  BY customer_id
ORDER  BY spend DESC
LIMIT  3;`, why: 'Did not clarify which statuses count as revenue, and LIMIT drops a customer tied with #3 arbitrarily. Interviewers plant exactly these ambiguities.', run: true },
    good: { sql: `-- Clarified: revenue = paid/shipped/delivered; ties at the cut-off are included
SELECT customer_id, sum(total_amount) AS spend
FROM   orders
WHERE  status IN ('paid', 'shipped', 'delivered')
GROUP  BY customer_id
ORDER  BY spend DESC
FETCH FIRST 3 ROWS WITH TIES;`, why: 'States the business definition explicitly and handles ties with the standard FETCH FIRST ... WITH TIES (PostgreSQL 13+).', run: true }
  },
  mistakes: [
    `Writing SQL before asking what one output row represents.`,
    `Using <code>NOT IN</code> with a nullable subquery.`,
    `Choosing ROW_NUMBER for "top N" when ties matter, or RANK when distinct values are wanted.`,
    `Putting right-table filters of a LEFT JOIN in WHERE.`,
    `Silent coding: the interviewer cannot give credit for reasoning they cannot hear.`,
    `Claiming an index "always" helps — selectivity and access pattern decide.`
  ],
  best: [
    `Repeat the problem in your own words and confirm the grain, ties, NULL and date-boundary rules.`,
    `Build with CTEs step by step and sanity-check row counts as you go.`,
    `Proactively list edge cases and how your query handles each.`,
    `Close with performance: indexes, likely plan, complexity, and how you would verify with EXPLAIN ANALYZE.`,
    `For PostgreSQL theory questions use the structure: what it is → how it works internally → trade-offs → a production example.`
  ],
  performance: `<p>Be ready to estimate: "orders has 50M rows; filtering one customer without an index scans 50M rows (seconds); with a B-tree on customer_id it reads a few pages (sub-millisecond); a GROUP BY over all rows is O(n) with a hash aggregate, memory bounded by work_mem or spilling to disk." Mention that window functions sort O(n log n) unless an index provides the order, and that LIMIT with ORDER BY on an indexed column can stop early.</p>`,
  security: `<p>Interviewers increasingly ask about SQL injection and least privilege: always mention parameterised queries for user input, never string concatenation; quote identifiers with <code>format('%I')</code> in dynamic SQL; and run applications with minimal privileges (no superuser, no DDL).</p>`,
  scenario: {
    title: 'Live interview: "Customers who ordered in every month of 2025"',
    steps: [
      '1. Clarify: which statuses count? Calendar months in which time zone? Exactly all 12 months?',
      '2. Shape: per customer, count distinct months with orders in 2025; keep those = 12.',
      '3. Write: SELECT customer_id FROM orders WHERE order_date >= \'2025-01-01\' AND order_date < \'2026-01-01\' AND status <> \'cancelled\' GROUP BY customer_id HAVING count(DISTINCT date_trunc(\'month\', order_date)) = 12.',
      '4. Edge cases: data only goes to October 2025 → result is empty; propose comparing to the number of months present in the data instead.',
      '5. Performance: index on (order_date) or (customer_id, order_date); hash aggregate over the year\'s rows.'
    ]
  },
  widgets: ['lab:join', 'lab:plan'],
  interview: [
    { q: 'Why can NOT IN return no rows unexpectedly?', a: 'If the subquery yields any NULL, x NOT IN (..., NULL) evaluates to NULL (unknown) rather than true for all non-matching x, so the WHERE filters everything out. NOT EXISTS has no such problem and is planned as an anti-join.' },
    { q: 'Difference between ROW_NUMBER, RANK and DENSE_RANK?', a: 'ROW_NUMBER gives unique sequential numbers, breaking ties arbitrarily (unless ORDER BY is unique). RANK gives tied rows the same rank and leaves gaps after ties. DENSE_RANK gives tied rows the same rank without gaps.' },
    { q: 'How do you approach a SQL question you have never seen?', a: 'Clarify the output grain and rules (ties, NULLs, dates), sketch the steps, build incrementally with CTEs while explaining, test edge cases, and finish with indexes, plan and complexity. If stuck, solve a simpler version first and extend it.' },
    { q: 'Explain MVCC in one minute.', a: 'Each row version stores the inserting and deleting transaction ids (xmin/xmax). Each statement or transaction uses a snapshot to decide which versions are visible, so readers never block writers and vice versa. Updates create new versions; VACUUM later removes versions no longer visible to anyone and freezes old ones to prevent XID wraparound.' }
  ],
  exercises: [
    { task: 'Find customers with more than 15 orders, including ties at the boundary, ordered by order count.', solution: `SELECT customer_id, count(*) AS orders
FROM   orders
GROUP  BY customer_id
HAVING count(*) > 15
ORDER  BY orders DESC, customer_id;`, run: true },
    { task: 'List departments with their employee count, including departments with zero employees (if any).', solution: `SELECT d.name, count(e.id) AS employees
FROM   departments d
LEFT   JOIN employees e ON e.department_id = d.id
GROUP  BY d.name
ORDER  BY employees DESC;`, run: true },
    { task: 'Return the top 3 products by units sold with ties included.', solution: `SELECT p.name, sum(oi.quantity) AS units
FROM   order_items oi
JOIN   products p ON p.id = oi.product_id
GROUP  BY p.name
ORDER  BY units DESC
FETCH FIRST 3 ROWS WITH TIES;`, run: true }
  ],
  challenge: {
    task: 'Classic: for each customer, find the longest streak of consecutive months with at least one non-cancelled order. Return the top 5 customers by streak length.',
    hint: 'Distinct (customer, month); subtract row_number() months from the month to build "islands" (gaps-and-islands); group by the island key.',
    solution: `WITH months AS (
  SELECT DISTINCT customer_id, date_trunc('month', order_date)::date AS m
  FROM   orders
  WHERE  status <> 'cancelled'
), islands AS (
  SELECT customer_id, m,
         (m - make_interval(months => (row_number() OVER (PARTITION BY customer_id ORDER BY m))::int))::date AS grp
  FROM   months
)
SELECT customer_id,
       count(*)    AS streak_months,
       min(m)      AS streak_start,
       max(m)      AS streak_end
FROM   islands
GROUP  BY customer_id, grp
ORDER  BY streak_months DESC, customer_id
LIMIT  5;`,
    run: true
  },
  related: ['interview-prep-system-design', 'window-functions', 'subqueries', 'joins', 'query-optimization'],
  quiz: [
    { type: 'predict', q: 'What does this return?', code: `SELECT 3 NOT IN (1, 2, NULL);`, options: ['true', 'false', 'NULL', 'Error'], answer: 2, explain: '3 <> NULL is unknown, so the whole NOT IN is NULL.' },
    { type: 'mcq', q: 'Which window function gives 1, 1, 2 for salaries 100, 100, 90 (descending)?', options: ['row_number', 'rank', 'dense_rank', 'ntile'], answer: 2, explain: 'dense_rank: ties share a rank, no gaps.' },
    { type: 'bug', q: 'Why does this return only customers with orders in 2025?', code: `SELECT c.name, count(o.id)
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.order_date >= '2025-01-01'
GROUP BY c.name;`, options: ['count(o.id) is wrong', 'The WHERE filter on o removes NULL-extended rows, turning the LEFT JOIN into an inner join', 'Missing ORDER BY', 'Dates need casting'], answer: 1, explain: 'Move the date condition into the ON clause to keep customers without 2025 orders.' },
    { type: 'tf', q: 'avg() treats NULL values as zero.', answer: false, explain: 'Aggregates ignore NULLs; avg(10, NULL, 20) = 15.' },
    { type: 'write', q: 'Write a NULL-safe query for products that were never ordered.', solution: `SELECT p.id, p.name
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id);`, explain: 'NOT EXISTS is NULL-safe and planned as an anti-join.' }
  ]
},
{
  id: 'interview-prep-system-design',
  module: 'interview-prep',
  title: 'Database System Design Interview Framework: Requirements → Entities → Access Patterns → Schema → Scale → Failure',
  level: 5,
  minutes: 24,
  summary: 'A step-by-step framework for database design interviews: requirements and numbers, entities, access patterns, schema and indexes, transactions and consistency, scaling, and failure handling — with a worked example and pointers to the app\'s Interview and Design pages.',
  objectives: [
    'Run a design interview with a clear structure and time budget',
    'Turn requirements into numbers (QPS, data size, growth) with back-of-envelope estimates',
    'Derive schema and indexes from access patterns',
    'Choose transaction boundaries and isolation, and explain consistency trade-offs',
    'Present scaling steps and failure handling for PostgreSQL credibly'
  ],
  concept: `<p>Design interviews test judgement under ambiguity. The interviewer wants to see you <strong>drive</strong>: gather requirements, quantify, propose a simple design, then evolve it under load and failure — explaining trade-offs at each step.</p>
<p><strong>Analogy:</strong> an architect meeting a client. They ask how many people will live in the house and how it will be used before drawing; they size the foundations from the numbers; they draw the floor plan around daily routines (access patterns); and they explain what happens in an earthquake (failure handling).</p>
<h4>The framework (≈45 minutes)</h4>
<table>
<tr><th>Step</th><th>Time</th><th>What you produce</th></tr>
<tr><td>1. Requirements</td><td>5 min</td><td>Functional (features) and non-functional (latency, availability, consistency, retention, compliance)</td></tr>
<tr><td>2. Numbers</td><td>3 min</td><td>Users, QPS read/write, peak factor, row sizes, data per year</td></tr>
<tr><td>3. Entities & relationships</td><td>5 min</td><td>ER sketch with cardinalities and keys</td></tr>
<tr><td>4. Access patterns</td><td>5 min</td><td>Top 5–10 queries with frequency and latency targets</td></tr>
<tr><td>5. Schema & indexes</td><td>8 min</td><td>Tables, types, constraints; one index per important access pattern</td></tr>
<tr><td>6. Transactions & consistency</td><td>5 min</td><td>Transaction boundaries, isolation, locking/idempotency</td></tr>
<tr><td>7. Scaling</td><td>7 min</td><td>Vertical → pooling → replicas → caching → partitioning → sharding (Citus or app-level)</td></tr>
<tr><td>8. Failure handling</td><td>5 min</td><td>HA, backups/PITR, DR, degradation, retries, monitoring</td></tr>
</table>
<div class="callout tip">The app's <strong>Interview</strong> page has question banks by level and topic, and the <strong>Design</strong> pages contain worked system-design case studies (schemas, access patterns, scaling and failure discussions). Practise the framework on those cases with a timer.</div>`,
  why: `<p>Senior roles are judged less on syntax and more on decisions: choosing keys, predicting hot spots, knowing when a single PostgreSQL instance is enough (more often than candidates think) and when to partition or shard. A framework keeps you from rambling or skipping failure handling — the most common reason for a "no hire" at senior level.</p>`,
  useCase: `<p>Prompt: "Design the database for a food-delivery app (orders, restaurants, riders) in one country." Numbers: 2M orders/day, peak 5× average → ~115 orders/s at peak, each with ~6 status changes and ~4 items → ~1,300 writes/s at peak; ~220 bytes per order row plus ~90 per item and index overhead → ~700GB/year. Conclusion: one well-sized PostgreSQL primary with replicas handles it; partition orders by month for retention; rider locations (high-frequency updates) go to a separate store or an unlogged/ephemeral table with PostGIS <span class="tag ext">extension</span> for nearest-rider search. Failure: Patroni HA, PITR, idempotent order creation, outbox pattern for events.</p>`,
  internals: `<p>Ground scaling claims in PostgreSQL mechanics: a single modern server handles tens of thousands of simple transactions per second; write throughput is bounded by WAL generation and fsync latency; read scaling via streaming replicas is asynchronous (replication lag → read-your-writes concerns); partitioning helps retention, vacuum and index size but not raw CPU; sharding (Citus <span class="tag ext">extension</span> or application-level) distributes writes but complicates cross-shard transactions and joins. Mention connection limits and pooling, hot rows (counters) and how to avoid them (sharded counters, batching), and MVCC bloat on update-heavy tables.</p>`,
  whenNot: `<p>Do not start with sharding, Kafka and five databases for a problem that fits on one server — interviewers penalise unjustified complexity. Do not ignore the numbers: "it's big" is not a requirement. Do not spend 20 minutes on one table's columns at the expense of scaling and failure handling.</p>`,
  syntax: `Back-of-envelope cheat sheet
  1 day = 86,400 s  (≈ 10^5)       peak factor: 3-10x average
  1M rows × 200 B ≈ 200 MB (+ indexes ≈ ×1.5–2)
  QPS = daily_requests / 86,400 × peak_factor
  storage/year = rows/day × 365 × row_bytes × (1 + index_overhead)`,
  examples: [
    {
      label: 'Basic',
      title: 'Back-of-envelope numbers in SQL',
      sql: `WITH assumptions AS (
  SELECT 2000000::numeric AS orders_per_day,
         5::numeric       AS peak_factor,
         4::numeric       AS items_per_order,
         6::numeric       AS status_updates_per_order,
         220::numeric     AS order_row_bytes,
         90::numeric      AS item_row_bytes,
         1.8::numeric     AS index_overhead
)
SELECT round(orders_per_day / 86400, 1)                                    AS avg_orders_per_sec,
       round(orders_per_day / 86400 * peak_factor, 1)                      AS peak_orders_per_sec,
       round(orders_per_day / 86400 * peak_factor
             * (1 + items_per_order + status_updates_per_order))           AS peak_writes_per_sec,
       pg_size_pretty((orders_per_day * 365
                       * (order_row_bytes + items_per_order * item_row_bytes)
                       * index_overhead)::bigint)                          AS storage_per_year
FROM   assumptions;`,
      explain: `<p>Interviewers love seeing estimates done explicitly. Two million orders a day is only ~23/s on average and ~116/s at a 5× peak; with items and status updates, ~1,270 writes/s at peak — comfortably within one PostgreSQL primary. Storage of roughly 700GB/year including indexes is large but manageable on one server for several years; partitioning by month is about retention, vacuum and index size rather than raw capacity. These numbers justify a simple design.</p>`,
      output: ` avg_orders_per_sec | peak_orders_per_sec | peak_writes_per_sec | storage_per_year
--------------------+---------------------+---------------------+------------------
               23.1 |               115.7 |                1273 | 710 GB`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'From access patterns to indexes (and proving it with EXPLAIN)',
      sql: `-- Access pattern AP1: "show a customer's latest orders" (very frequent, < 20 ms)
-- Access pattern AP2: "ops: unpaid orders older than 1 hour" (every minute)
-- Access pattern AP3: "revenue per day for the last 30 days" (dashboard, can be cached)

CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date DESC);        -- AP1
CREATE INDEX idx_orders_pending_date  ON orders (order_date) WHERE status = 'pending'; -- AP2
ANALYZE orders;

EXPLAIN (COSTS OFF)
SELECT id, status, total_amount, order_date
FROM   orders
WHERE  customer_id = 42
ORDER  BY order_date DESC
LIMIT  10;

EXPLAIN (COSTS OFF)
SELECT id, customer_id, order_date
FROM   orders
WHERE  status = 'pending' AND order_date < now() - interval '1 hour';`,
      explain: `<p>Each index exists because of a named access pattern — that is the argument interviewers want to hear. AP1's composite index serves the filter; customer 42 has only ~10 orders here, so the planner fetches them with a bitmap scan and sorts the handful of rows. For customers with hundreds of orders (or a larger table), the same index yields an Index Scan in <code>order_date DESC</code> order that stops after 10 entries with no Sort node — say this in the interview and verify with EXPLAIN on production-like data. AP2's partial index contains only pending orders (~8% here; in real life often &lt;1%), staying tiny. AP3 does not need an OLTP index at all: a materialized view or a rollup table refreshed every few minutes serves it (see the analytics case study).</p>`,
      output: ` Limit
   ->  Sort
         Sort Key: order_date DESC
         ->  Bitmap Heap Scan on orders
               Recheck Cond: (customer_id = 42)
               ->  Bitmap Index Scan on idx_orders_customer_date
                     Index Cond: (customer_id = 42)

 Bitmap Heap Scan on orders
   Recheck Cond: ((order_date < (now() - '01:00:00'::interval)) AND (status = 'pending'::text))
   ->  Bitmap Index Scan on idx_orders_pending_date
         Index Cond: (order_date < (now() - '01:00:00'::interval))`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Transactions and consistency: atomic order placement with idempotency',
      sql: `CREATE TABLE order_requests (
  idempotency_key uuid PRIMARY KEY,
  order_id        bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION place_order(p_key uuid, p_customer int, p_product int, p_qty int)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_order bigint;
  v_price numeric;
BEGIN
  -- 1) Idempotency: a retried request returns the original order
  SELECT order_id INTO v_order FROM order_requests WHERE idempotency_key = p_key;
  IF FOUND THEN RETURN v_order; END IF;

  -- 2) Reserve stock atomically (row lock on the product, no oversell)
  UPDATE products SET stock = stock - p_qty
  WHERE  id = p_product AND stock >= p_qty
  RETURNING price INTO v_price;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient stock for product %', p_product; END IF;

  -- 3) Create order and item in the same transaction
  INSERT INTO orders (customer_id, status, order_date, total_amount)
  VALUES (p_customer, 'pending', now(), v_price * p_qty)
  RETURNING id INTO v_order;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order, p_product, p_qty, v_price);

  INSERT INTO order_requests (idempotency_key, order_id) VALUES (p_key, v_order);
  RETURN v_order;
END $$;

SELECT place_order('7f8c1a52-0000-4000-8000-000000000001', 42, 1, 1) AS first_call,
       place_order('7f8c1a52-0000-4000-8000-000000000001', 42, 1, 1) AS retried_call;`,
      explain: `<p>The design talking points in code: one transaction for stock reservation, order and items (atomicity); a conditional <code>UPDATE … WHERE stock &gt;= qty</code> that locks the product row and prevents overselling without SERIALIZABLE; and an idempotency table so a client retry after a timeout returns the same order instead of creating a duplicate. Both calls return the same order id. In the interview, add: the unique constraint on the key handles concurrent retries (one insert fails → retry reads the existing row), and publishing events uses a transactional outbox table rather than calling a broker inside the transaction.</p>`,
      output: ` first_call | retried_call
------------+--------------
       5017 |         5017      -- same id twice; exact value depends on the identity sequence`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Design by guess: index everything "just in case"
CREATE INDEX ON orders (status);
CREATE INDEX ON orders (total_amount);
CREATE INDEX ON orders (order_date);
CREATE INDEX ON orders (customer_id);
SELECT count(*) AS indexes_on_orders FROM pg_index WHERE indrelid = 'orders'::regclass;`, why: 'Indexes not tied to access patterns slow every write, bloat storage and WAL, and still may not serve the real queries (e.g. customer + date order needs a composite index).', run: true },
    good: { sql: `-- Design from access patterns: one purposeful index per important query
CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date DESC);   -- "my orders"
CREATE INDEX idx_orders_pending_date  ON orders (order_date) WHERE status = 'pending';  -- ops queue
SELECT indexrelid::regclass AS index_name FROM pg_index WHERE indrelid = 'orders'::regclass;`, why: 'Each index is justified by a named, frequent query with a latency target — and can be verified with EXPLAIN.', run: true }
  },
  mistakes: [
    `Jumping to a schema before agreeing on requirements and numbers.`,
    `Proposing sharding or multiple databases without numbers that require it.`,
    `Indexes not linked to access patterns.`,
    `Ignoring transaction boundaries, idempotency and concurrency (double booking, oversell).`,
    `Skipping failure handling: HA, backups/PITR, DR, degraded modes.`,
    `Forgetting operational concerns: migrations, monitoring, data retention.`
  ],
  best: [
    `Drive the conversation with the framework; announce each step and timebox it.`,
    `Do arithmetic out loud; write the numbers on the board and reuse them for decisions.`,
    `Start simple (one primary + replicas), then scale step by step with clear triggers ("when writes exceed X / data exceeds Y").`,
    `Name PostgreSQL features precisely (partial index, partitioning, SKIP LOCKED, logical replication, RLS) and label extensions/tools as such.`,
    `End with risks and trade-offs you would revisit later.`
  ],
  performance: `<p>Tie performance to numbers: point lookups via B-tree are O(log n) and sub-millisecond when cached; 1,000 writes/s are routine on one node; replicas add read capacity but not write capacity; partition pruning cuts scanned data for time-bounded queries; caches (Redis) help read-heavy hot keys but add invalidation complexity; materialized views/rollups make dashboards O(rollup rows) instead of O(raw rows).</p>`,
  security: `<p>Mention PII handling (minimise, encrypt sensitive columns or the whole volume, mask in non-prod), least-privilege roles per service, RLS for multi-tenant data, audit logging for sensitive tables, and compliance constraints (data residency, retention and deletion requirements such as GDPR/DPDP Act).</p>`,
  scenario: {
    title: 'Interview prompt: "Design the database for a ticket-booking system for concerts"',
    steps: [
      '1. Requirements: browse events, hold seats for 10 minutes, pay, no double booking; peak on-sale bursts; strong consistency for seats.',
      '2. Numbers: 50k seats per big event; 500k users hitting on-sale in 2 minutes → thousands of seat-hold attempts per second on one event.',
      '3. Entities: venues, events, seats, holds, bookings, payments, users.',
      '4. Access patterns: seat map per event (read-heavy, cacheable); hold seat (contended write); confirm booking.',
      '5. Schema: seats(event_id, seat_id) PK; hold with UPDATE ... WHERE status = \'free\' or SELECT ... FOR UPDATE SKIP LOCKED for "best available"; EXCLUDE/UNIQUE to prevent double booking; expiry job releases holds.',
      '6. Scale & failure: queueing/waiting room in front, pooling, replicas for seat maps, partition by event, HA with sync replica, idempotent payment callbacks.'
    ]
  },
  widgets: ['diagram:read-replica', 'diagram:sharding', 'diagram:partitioning'],
  interview: [
    { q: 'How do you decide whether a single PostgreSQL instance is enough?', a: 'Estimate peak read/write QPS, data size and growth. Compare with realistic single-node capacity (tens of thousands of simple TPS, multi-TB data with good indexing and partitioning). If writes and data fit with headroom, use one primary plus replicas for reads and HA; plan partitioning for retention; consider sharding only when write throughput or data size exceeds one node.' },
    { q: 'How would you prevent double booking of a seat?', a: 'Make it a database invariant: a unique constraint on (event_id, seat_id) in bookings, or a conditional UPDATE seats SET status = \'held\' WHERE id = ? AND status = \'free\' that affects 0 rows if taken. For ranges (hotel rooms by date) use an EXCLUDE constraint with btree_gist on (room_id WITH =, stay WITH &&).' },
    { q: 'How do you scale reads in PostgreSQL?', a: 'Optimise queries and indexes first, then add a connection pooler, streaming read replicas behind a router (accepting replication lag or routing read-your-writes to the primary), caching for hot keys, and materialized views or rollups for analytics.' },
    { q: 'What is the transactional outbox pattern?', a: 'Instead of publishing an event to a message broker inside a database transaction (which can fail independently), write the event to an outbox table in the same transaction as the business change. A separate relay (polling with SKIP LOCKED or logical decoding/CDC) publishes events and marks them sent — giving atomicity between state change and event.' }
  ],
  exercises: [
    { task: 'Estimate storage per year for an events table receiving 50 million rows/day of 120 bytes each with 60% index overhead.', solution: `SELECT pg_size_pretty((50000000::numeric * 365 * 120 * 1.6)::bigint) AS storage_per_year;`, run: true },
    { task: 'Name the access pattern and create the index for: "list a department\'s active employees by hire date, newest first".', solution: `CREATE INDEX idx_emp_dept_active_hired ON employees (department_id, hire_date DESC) WHERE is_active;
EXPLAIN (COSTS OFF)
SELECT first_name, last_name, hire_date
FROM   employees
WHERE  department_id = 3 AND is_active
ORDER  BY hire_date DESC;`, run: true },
    { task: 'Implement a job queue claim with FOR UPDATE SKIP LOCKED on a small jobs table.', solution: `CREATE TABLE jobs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payload text, status text NOT NULL DEFAULT 'queued');
INSERT INTO jobs (payload) SELECT 'job ' || g FROM generate_series(1, 5) g;
UPDATE jobs SET status = 'running'
WHERE  id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, payload, status;`, run: true }
  ],
  challenge: {
    task: 'Design and implement a minimal transactional outbox: an outbox table, a function that updates an order status AND writes an outbox event in one transaction, and a relay query that claims up to 10 unsent events with SKIP LOCKED and marks them sent.',
    hint: 'outbox(id, aggregate, aggregate_id, event_type, payload jsonb, created_at, sent_at). Relay: UPDATE ... WHERE id IN (SELECT ... WHERE sent_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING.',
    solution: `CREATE TABLE outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate    text  NOT NULL,
  aggregate_id bigint NOT NULL,
  event_type   text  NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX outbox_unsent_idx ON outbox (id) WHERE sent_at IS NULL;
CREATE FUNCTION mark_order_shipped(p_order bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orders SET status = 'shipped' WHERE id = p_order AND status = 'paid';
  IF NOT FOUND THEN RAISE EXCEPTION 'order % not in paid state', p_order; END IF;
  INSERT INTO outbox (aggregate, aggregate_id, event_type, payload)
  VALUES ('order', p_order, 'OrderShipped', jsonb_build_object('order_id', p_order, 'at', now()));
END $$;
SELECT mark_order_shipped((SELECT id FROM orders WHERE status = 'paid' ORDER BY id LIMIT 1));
UPDATE outbox SET sent_at = now()
WHERE  id IN (SELECT id FROM outbox WHERE sent_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10)
RETURNING id, event_type, payload;`,
    run: true
  },
  related: ['interview-prep-sql-postgres', 'production-architecture-ecommerce-design', 'scaling', 'real-world-projects-approach', 'concurrency'],
  quiz: [
    { type: 'mcq', q: 'What should come first in a database design interview?', options: ['Choosing a sharding key', 'Clarifying requirements and estimating numbers', 'Writing CREATE TABLE statements', 'Picking a cache'], answer: 1, explain: 'Requirements and numbers drive every later decision.' },
    { type: 'design', q: '2M orders/day, 5x peak. Writes per second for orders alone at peak?', options: ['~23', '~116', '~1,160', '~11,600'], answer: 1, explain: '2,000,000 / 86,400 ≈ 23/s average × 5 ≈ 116/s peak.' },
    { type: 'tf', q: 'Read replicas increase write throughput.', answer: false, explain: 'All writes still go to the primary; replicas scale reads only.' },
    { type: 'scenario', q: 'Interviewer: "Prevent overselling under heavy concurrency". Best answer?', options: ['Check stock in the app, then update', 'Conditional UPDATE ... SET stock = stock - n WHERE id = ? AND stock >= n (or a CHECK constraint), inside the order transaction', 'Use a cache counter only', 'Use SERIALIZABLE for every query in the system'], answer: 1, explain: 'An atomic conditional update (backed by a non-negative CHECK) prevents races without global serialization.' }
  ]
}
]);

/* ------------------------- REAL-WORLD PROJECTS ------------------------- */
PGM.addLessons([
{
  id: 'real-world-projects-approach',
  module: 'real-world-projects',
  title: 'How to Approach a Real Database Project: Requirements → ER → DDL → Seed → Queries → Indexes → Load Test → Tuning',
  level: 5,
  minutes: 26,
  summary: 'An end-to-end method for building a database for a real product, demonstrated on a compact clinic-appointments project: requirements, ER model, DDL with constraints, seed data, core queries, indexes from EXPLAIN, a mini load test and tuning.',
  objectives: [
    'Turn product requirements into entities, rules and access patterns',
    'Write DDL that enforces business rules (including an exclusion constraint)',
    'Generate realistic seed data with generate_series',
    'Write the core queries and choose indexes using EXPLAIN',
    'Run a simple load test in SQL and tune based on measurements'
  ],
  concept: `<p>Real projects fail less from bad SQL than from skipped steps: no clear rules, no realistic data, indexes chosen by intuition, no load test. The method below is the same whether you build a clinic system, a marketplace or an IoT platform:</p>
<ol>
<li><strong>Requirements</strong> — features, rules ("a doctor cannot have overlapping appointments"), volumes, latency targets, retention, compliance.</li>
<li><strong>ER model</strong> — entities, relationships, cardinalities, keys; normalise to 3NF, denormalise later only with evidence.</li>
<li><strong>DDL</strong> — types, NOT NULL, CHECK, UNIQUE, FK, EXCLUDE; comments; roles.</li>
<li><strong>Seed data</strong> — realistic volume and distribution (skew!), generated with <code>generate_series</code> and random functions.</li>
<li><strong>Queries</strong> — the top access patterns written and verified for correctness.</li>
<li><strong>Indexes</strong> — from EXPLAIN (ANALYZE, BUFFERS) of those queries, not from guesses.</li>
<li><strong>Load test</strong> — concurrency similar to production (pgbench <span class="tag tool">bundled client tool</span> with custom scripts, k6, JMeter), measuring p95/p99.</li>
<li><strong>Tuning</strong> — fix the slowest queries, adjust configuration, re-test; document decisions.</li>
</ol>
<p><strong>Analogy:</strong> building a house: brief → architectural drawings → foundations and structure → furniture (data) → living in it for a week (queries) → adding handrails where people actually stumble (indexes) → a party with 50 guests (load test) → fixing the bottlenecks you saw (tuning).</p>`,
  why: `<p>Following the steps produces a schema whose rules are enforced by the database, indexes that match real queries, and performance numbers measured before launch — not discovered by customers. It also creates artefacts (ER diagram, DDL, seed scripts, query catalogue, test results) that make the system maintainable by others.</p>`,
  useCase: `<p>A chain of 40 clinics needs online booking: 600 doctors, ~25,000 appointments/day, patients booking via app and call centre. Rules: no overlapping appointments per doctor; slots within the doctor's working hours; cancellations allowed until 2 hours before. Following the method, the team used an <code>EXCLUDE</code> constraint (with <code>btree_gist</code> <span class="tag ext">extension</span>) to make double-booking impossible, generated a year of synthetic data (9M appointments) to test, found via EXPLAIN that "doctor's day view" needed <code>(doctor_id, starts_at)</code>, and load-tested 300 concurrent bookings/s with p99 at 35 ms.</p>`,
  internals: `<p>The exclusion constraint is implemented by a GiST index: on insert/update, PostgreSQL searches the index for any existing row whose <code>doctor_id</code> is equal (<code>=</code>, via btree_gist) and whose time range overlaps (<code>&amp;&amp;</code>); if found, the statement fails with SQLSTATE 23P01. Concurrent inserts are handled correctly — the second waits for the first transaction and then rechecks — so the rule holds under any concurrency without application locks. <code>tstzrange</code> with <code>'[)'</code> bounds (inclusive start, exclusive end) lets back-to-back appointments touch without overlapping.</p>`,
  whenNot: `<p>Do not spend weeks perfecting the schema before writing the queries — iterate: schema → queries → adjust. Do not seed with uniform random data only; real data is skewed (some doctors are far busier), and plans differ. Do not load test against an empty or tiny database.</p>`,
  syntax: `-- Seed data patterns
INSERT INTO t (...) SELECT ... FROM generate_series(1, 100000) g;
random(), floor(random() * n)::int + 1, now() - random() * interval '365 days'
-- Load test (shell, pgbench is bundled with PostgreSQL)
-- pgbench -n -c 50 -j 8 -T 120 -f book.sql clinicdb`,
  examples: [
    {
      label: 'Basic',
      title: 'Requirements → ER → DDL with rules enforced',
      sql: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA clinic;
SET search_path = clinic, public;

CREATE TABLE clinics (
  id   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  city text NOT NULL
);
CREATE TABLE doctors (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinic_id  int  NOT NULL REFERENCES clinics (id),
  full_name  text NOT NULL,
  speciality text NOT NULL
);
CREATE INDEX doctors_clinic_idx ON doctors (clinic_id);
CREATE TABLE patients (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name text NOT NULL,
  phone     text NOT NULL UNIQUE
);
CREATE TABLE appointments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id  int    NOT NULL REFERENCES doctors (id),
  patient_id bigint NOT NULL REFERENCES patients (id),
  slot       tstzrange NOT NULL CHECK (NOT isempty(slot) AND upper(slot) - lower(slot) <= interval '2 hours'),
  status     text   NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Rule: a doctor can never have two overlapping active appointments
  CONSTRAINT no_double_booking EXCLUDE USING gist
    (doctor_id WITH =, slot WITH &&) WHERE (status <> 'cancelled')
);
CREATE INDEX appointments_patient_idx ON appointments (patient_id);

INSERT INTO clinics (name, city) VALUES ('Indiranagar', 'Bengaluru');
INSERT INTO doctors (clinic_id, full_name, speciality) VALUES (1, 'Dr. Meera Nair', 'cardiology');
INSERT INTO patients (full_name, phone) VALUES ('Arjun', '+919800000001'), ('Divya', '+919800000002');
INSERT INTO appointments (doctor_id, patient_id, slot)
VALUES (1, 1, tstzrange('2026-10-06 10:00+05:30', '2026-10-06 10:30+05:30', '[)')),
       (1, 2, tstzrange('2026-10-06 10:30+05:30', '2026-10-06 11:00+05:30', '[)'));   -- touching: OK

DO $$
BEGIN
  INSERT INTO appointments (doctor_id, patient_id, slot)
  VALUES (1, 2, tstzrange('2026-10-06 10:15+05:30', '2026-10-06 10:45+05:30', '[)'));
EXCEPTION WHEN exclusion_violation THEN
  RAISE NOTICE 'double booking rejected: %', SQLERRM;
END $$;

SELECT a.id, d.full_name AS doctor, p.full_name AS patient, a.slot, a.status
FROM   appointments a JOIN doctors d ON d.id = a.doctor_id JOIN patients p ON p.id = a.patient_id
ORDER  BY lower(a.slot);`,
      explain: `<p>Requirements became rules in DDL: identity keys, FKs (with an index on each FK column), status CHECK, a sanity CHECK on slot length, and the key business rule as an <strong>exclusion constraint</strong>: for the same doctor (<code>=</code>), active slots may not overlap (<code>&amp;&amp;</code>). Cancelled appointments are excluded by the <code>WHERE</code> clause so their slot can be rebooked. Back-to-back appointments are allowed thanks to half-open <code>[)</code> ranges; the overlapping attempt is rejected with <code>exclusion_violation</code>.</p>`,
      output: `NOTICE:  double booking rejected: conflicting key value violates exclusion constraint "no_double_booking"

 id | doctor         | patient | slot                                                    | status
----+----------------+---------+---------------------------------------------------------+--------
  1 | Dr. Meera Nair | Arjun   | ["2026-10-06 04:30:00+00","2026-10-06 05:00:00+00")     | booked
  2 | Dr. Meera Nair | Divya   | ["2026-10-06 05:00:00+00","2026-10-06 05:30:00+00")     | booked
-- ranges are displayed in the session TimeZone (UTC shown here)`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Seed realistic, skewed data and write the core queries',
      sql: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA clinic;
SET search_path = clinic, public;
CREATE TABLE doctors (id int PRIMARY KEY, clinic_id int NOT NULL, speciality text NOT NULL);
CREATE TABLE appointments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id  int    NOT NULL REFERENCES doctors (id),
  patient_id bigint NOT NULL,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  status     text NOT NULL DEFAULT 'booked',
  CHECK (ends_at > starts_at)
);

-- 60 doctors in 10 clinics
INSERT INTO doctors
SELECT g, (g % 10) + 1, (ARRAY['cardiology','dermatology','general','orthopedics'])[(g % 4) + 1]
FROM   generate_series(1, 60) g;

-- 30,000 appointments over 90 days; skew: low doctor ids are much busier (power(random(), 2))
INSERT INTO appointments (doctor_id, patient_id, starts_at, ends_at, status)
SELECT d, p, s, s + interval '30 minutes',
       CASE WHEN random() < 0.1 THEN 'cancelled' ELSE 'booked' END
FROM (
  SELECT 1 + floor(power(random(), 2) * 60)::int                             AS d,
         1 + floor(random() * 20000)::int                                     AS p,
         date_trunc('hour', timestamptz '2026-07-01' + random() * interval '90 days') AS s
  FROM   generate_series(1, 30000)
) x;
ANALYZE appointments;

-- Q1: a doctor's day view
SELECT starts_at, ends_at, patient_id, status
FROM   appointments
WHERE  doctor_id = 1 AND starts_at >= '2026-08-01' AND starts_at < '2026-08-02'
ORDER  BY starts_at;

-- Q2: utilisation per speciality (booked hours per doctor)
SELECT d.speciality, count(*) FILTER (WHERE a.status = 'booked') AS booked,
       round(count(*) FILTER (WHERE a.status = 'booked')::numeric / count(DISTINCT d.id), 1) AS per_doctor
FROM   appointments a JOIN doctors d ON d.id = a.doctor_id
GROUP  BY d.speciality ORDER BY booked DESC;

-- Skew check
SELECT min(c) AS min_per_doctor, max(c) AS max_per_doctor
FROM  (SELECT doctor_id, count(*) AS c FROM appointments GROUP BY doctor_id) t;`,
      explain: `<p>Seed data should look like production: <code>power(random(), 2)</code> skews doctor ids so a few doctors have many times more appointments than others — exactly the kind of distribution that changes plans and reveals hot spots. ~10% cancellations add realism. Then write and verify the core queries (day view, utilisation). Exact numbers vary because the data is random; the skew check shows the busiest doctor has an order of magnitude more appointments than the quietest.</p>`,
      output: ` starts_at              | ends_at                | patient_id | status
------------------------+------------------------+------------+-----------
 2026-08-01 00:00:00+00 | 2026-08-01 00:30:00+00 |       5573 | booked
 2026-08-01 01:00:00+00 | 2026-08-01 01:30:00+00 |      10344 | booked
 ... (~40 rows: doctor 1 is one of the busiest)

 speciality  | booked | per_doctor
-------------+--------+------------
 dermatology |   8755 |      583.7
 general     |   6457 |      430.5
 orthopedics |   5948 |      396.5
 cardiology  |   5875 |      391.7

 min_per_doctor | max_per_doctor
----------------+----------------
            242 |           3915
-- random data: your numbers will differ slightly`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Indexes from EXPLAIN, then a mini load test in SQL',
      sql: `CREATE SCHEMA clinic;
SET search_path = clinic, public;
CREATE TABLE appointments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id int NOT NULL, patient_id bigint NOT NULL,
  starts_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'booked'
);
INSERT INTO appointments (doctor_id, patient_id, starts_at)
SELECT 1 + floor(power(random(), 2) * 60)::int, 1 + floor(random() * 20000)::int,
       timestamptz '2026-07-01' + random() * interval '90 days'
FROM   generate_series(1, 50000);
ANALYZE appointments;

-- Before: day view without a suitable index
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
SELECT * FROM appointments
WHERE  doctor_id = 7 AND starts_at >= '2026-08-01' AND starts_at < '2026-08-02'
ORDER  BY starts_at;

-- Index derived from the access pattern (equality column first, then range/sort column)
CREATE INDEX appointments_doctor_start_idx ON appointments (doctor_id, starts_at);

EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, BUFFERS OFF)
SELECT * FROM appointments
WHERE  doctor_id = 7 AND starts_at >= '2026-08-01' AND starts_at < '2026-08-02'
ORDER  BY starts_at;

-- Mini load test: run the day-view query 1,000 times with random doctors/days.
-- Parameters are computed into variables first: a volatile random() inside the
-- WHERE clause would be re-evaluated per row and prevent index use.
DO $$
DECLARE
  t0      timestamptz := clock_timestamp();
  v_doc   int;
  v_day   timestamptz;
  n       int;
BEGIN
  FOR i IN 1..1000 LOOP
    v_doc := 1 + floor(random() * 60)::int;
    v_day := timestamptz '2026-07-01' + floor(random() * 90)::int * interval '1 day';
    SELECT count(*) INTO n FROM appointments
    WHERE  doctor_id = v_doc AND starts_at >= v_day AND starts_at < v_day + interval '1 day';
  END LOOP;
  RAISE NOTICE '1000 day-view queries in % ms (avg % ms)',
    round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    round(extract(epoch FROM clock_timestamp() - t0) * 1000 / 1000.0, 3);
END $$;`,
      explain: `<p>Before the index, the day view is a Seq Scan over 50,000 rows with a filter and a Sort. After creating <code>(doctor_id, starts_at)</code> — equality column first, range/sort column second — the planner reads only that doctor's rows for the day through the index (here a bitmap scan of 16 heap blocks plus a trivial in-memory sort of 16 rows; with more matching rows it would use a plain Index Scan that returns them already ordered). The DO block is a crude single-session load test measuring average latency — note that parameters are computed into variables first, because a volatile <code>random()</code> directly in the WHERE clause is re-evaluated for every row and disables index use (that mistake made this loop about 50× slower in testing); for real concurrency use <code>pgbench</code> with a custom script (<code>\\set</code> random variables) and many clients, and look at p95/p99. Tuning loop: measure → fix the worst query → re-measure.</p>`,
      output: `-- before: reads all 50,000 rows
 Sort (actual rows=16.00 loops=1)
   Sort Key: starts_at
   Sort Method: quicksort  Memory: 17kB
   ->  Seq Scan on appointments (actual rows=16.00 loops=1)
         Filter: ((starts_at >= ...) AND (starts_at < ...) AND (doctor_id = 7))
         Rows Removed by Filter: 49984

-- after: touches only the 16 matching heap blocks
 Sort (actual rows=16.00 loops=1)
   Sort Key: starts_at
   Sort Method: quicksort  Memory: 17kB
   ->  Bitmap Heap Scan on appointments (actual rows=16.00 loops=1)
         Recheck Cond: ((doctor_id = 7) AND (starts_at >= ...) AND (starts_at < ...))
         Heap Blocks: exact=16
         ->  Bitmap Index Scan on appointments_doctor_start_idx (actual rows=16.00 loops=1)

NOTICE:  1000 day-view queries in 361 ms (avg 0.362 ms)   -- varies by machine; row counts vary (random data)`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Rule enforced only in application code (race condition under concurrency)
CREATE TABLE appt_bad (doctor_id int, starts_at timestamptz, ends_at timestamptz);
-- app: SELECT ... WHERE overlaps; if none -> INSERT   (two requests can both pass the check)
INSERT INTO appt_bad VALUES (1, '2026-10-06 10:00', '2026-10-06 10:30'),
                            (1, '2026-10-06 10:15', '2026-10-06 10:45');   -- overlap accepted
SELECT count(*) AS overlapping_rows FROM appt_bad;`, why: 'Check-then-insert in the application has a race window: two concurrent bookings both see "free" and both insert. Nothing stops bad data from scripts or other services either.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE appt_good (
  doctor_id int NOT NULL,
  slot tstzrange NOT NULL,
  EXCLUDE USING gist (doctor_id WITH =, slot WITH &&)
);
INSERT INTO appt_good VALUES (1, tstzrange('2026-10-06 10:00', '2026-10-06 10:30'));
DO $$ BEGIN
  INSERT INTO appt_good VALUES (1, tstzrange('2026-10-06 10:15', '2026-10-06 10:45'));
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'overlap rejected'; END $$;
SELECT count(*) AS rows FROM appt_good;`, why: 'The exclusion constraint makes overlapping bookings impossible for every writer and under any concurrency.', run: true }
  },
  mistakes: [
    `Starting with tables instead of rules and access patterns.`,
    `Testing on tiny or uniformly random data and being surprised by production plans.`,
    `Adding indexes by intuition rather than from EXPLAIN of real queries.`,
    `Load testing a single query in a loop and calling it a load test — concurrency and mixed workloads matter.`,
    `Not writing down decisions (why this key, why this index), so the next engineer undoes them.`
  ],
  best: [
    `Write the business rules first and map each one to a constraint (or a documented reason why not).`,
    `Generate seed data with realistic volume, skew and time distribution; keep the seed script in the repository.`,
    `Keep a query catalogue (the top access patterns) with their latency targets and EXPLAIN output.`,
    `Load test with pgbench custom scripts or k6 through the pooler at 2–3× expected peak; record p95/p99.`,
    `Tune iteratively: one change at a time, re-measure, document.`
  ],
  performance: `<p>For each access pattern, aim for plans that touch a number of pages proportional to the result, not the table (index range scans, partial indexes, covering indexes). Composite index order: equality columns first, then range/sort columns. Validate with BUFFERS: shared hit/read counts tell you how much data each query really touches. Under load, watch locks (hot rows), connection usage and WAL rate, not just single-query speed.</p>`,
  security: `<p>Health data (like appointments) is sensitive: least-privilege roles, encryption in transit and at rest, audit of access, masking in non-production copies (seed data instead of production dumps), and retention/deletion policies aligned with regulations (e.g. India's DPDP Act, HIPAA, GDPR).</p>`,
  scenario: {
    title: 'Kick-off: you have two weeks to build the booking database',
    steps: [
      '1. Day 1-2: requirements workshop → list of rules, volumes, top 10 access patterns with latency targets.',
      '2. Day 3: ER diagram reviewed with the team.',
      '3. Day 4-5: DDL with constraints + migration files; seed script with realistic skew (1 year of data).',
      '4. Day 6-7: query catalogue written and verified; EXPLAIN each; add indexes.',
      '5. Day 8-9: pgbench/k6 load test at 3x peak through PgBouncer; fix top offenders; tune config.',
      '6. Day 10: document decisions, runbook basics, monitoring dashboards; hand over.'
    ]
  },
  widgets: ['diagram:normalization', 'lab:index'],
  interview: [
    { q: 'How would you guarantee that a doctor is never double-booked?', a: 'Store the appointment time as a tstzrange and add an exclusion constraint EXCLUDE USING gist (doctor_id WITH =, slot WITH &&), with btree_gist for the equality on doctor_id, optionally WHERE status <> \'cancelled\'. The database rejects overlaps under any concurrency.' },
    { q: 'Why does seed data distribution matter?', a: 'The planner\'s choices depend on statistics: skewed values, correlations and table sizes change join orders and index usage. Uniform or tiny test data hides hot spots and bad plans that appear with production distributions.' },
    { q: 'How do you choose composite index column order?', a: 'Put columns used with equality first, then the range or ORDER BY column, matching the main access pattern; e.g. (doctor_id, starts_at) for "doctor X between times ordered by time". Verify with EXPLAIN that the index serves both filter and order.' },
    { q: 'What is your load-testing approach for PostgreSQL?', a: 'Realistic data volume and skew, a mixed workload script of the top access patterns with realistic ratios, concurrency through the same pooler as production, run long enough to include checkpoints and autovacuum, measure throughput and p95/p99, observe wait events and resources, then fix and repeat.' }
  ],
  exercises: [
    { task: 'Generate 1,000 random patients with unique phone numbers into a temp table and count distinct phones.', solution: `CREATE TEMP TABLE patients_seed AS
SELECT g AS id, 'Patient ' || g AS full_name, '+9198' || lpad(g::text, 8, '0') AS phone
FROM   generate_series(1, 1000) g;
SELECT count(*) AS patients, count(DISTINCT phone) AS distinct_phones FROM patients_seed;`, run: true },
    { task: 'Create a range-based availability check: given a tstzrange, return true if it overlaps any range in a small table of booked slots.', solution: `CREATE TEMP TABLE booked (slot tstzrange);
INSERT INTO booked VALUES (tstzrange('2026-10-06 10:00', '2026-10-06 10:30')),
                          (tstzrange('2026-10-06 11:00', '2026-10-06 11:30'));
SELECT EXISTS (SELECT 1 FROM booked WHERE slot && tstzrange('2026-10-06 10:30', '2026-10-06 11:00')) AS conflict_1030,
       EXISTS (SELECT 1 FROM booked WHERE slot && tstzrange('2026-10-06 10:15', '2026-10-06 10:45')) AS conflict_1015;`, run: true },
    { task: 'Using company_db, find the busiest hour of the day for orders (by count) — an input to load-test design.', solution: `SELECT extract(hour FROM order_date) AS hour_of_day, count(*) AS orders
FROM   orders
GROUP  BY 1
ORDER  BY orders DESC
LIMIT  3;`, run: true }
  ],
  challenge: {
    task: 'Build "find free 30-minute slots" for one doctor on one day: working hours 09:00–17:00, existing appointments in a table; return all free slots using generate_series and NOT EXISTS with range overlap.',
    hint: 'Generate candidate slots every 30 minutes with generate_series(start, end - 30min, 30min), make a tstzrange per candidate, exclude those overlapping booked ranges.',
    solution: `CREATE TEMP TABLE doctor_appts (doctor_id int, slot tstzrange);
INSERT INTO doctor_appts VALUES
  (1, tstzrange('2026-10-06 09:30+00', '2026-10-06 10:30+00')),
  (1, tstzrange('2026-10-06 13:00+00', '2026-10-06 13:30+00')),
  (1, tstzrange('2026-10-06 16:00+00', '2026-10-06 17:00+00'));
SELECT tstzrange(s, s + interval '30 minutes') AS free_slot
FROM   generate_series(timestamptz '2026-10-06 09:00+00',
                       timestamptz '2026-10-06 16:30+00',
                       interval '30 minutes') AS s
WHERE  NOT EXISTS (SELECT 1 FROM doctor_appts a
                   WHERE a.doctor_id = 1
                     AND a.slot && tstzrange(s, s + interval '30 minutes'))
ORDER  BY s;`,
    run: true
  },
  related: ['real-world-projects-analytics', 'database-design', 'constraints', 'indexes', 'production-architecture-ecommerce-design'],
  quiz: [
    { type: 'mcq', q: 'Which constraint prevents overlapping time ranges per doctor?', options: ['UNIQUE (doctor_id, slot)', 'CHECK (slot && slot)', 'EXCLUDE USING gist (doctor_id WITH =, slot WITH &&)', 'FOREIGN KEY on slot'], answer: 2, explain: 'Exclusion constraints generalise UNIQUE to arbitrary operators such as overlap (&&).' },
    { type: 'tf', q: 'Uniformly random seed data is sufficient to validate query plans for production.', answer: false, explain: 'Real data is skewed and correlated; plans can differ drastically.' },
    { type: 'index', q: 'Access pattern: WHERE doctor_id = ? AND starts_at BETWEEN ? AND ? ORDER BY starts_at. Best index?', options: ['(starts_at, doctor_id)', '(doctor_id, starts_at)', '(doctor_id) and (starts_at) separately', 'GIN (doctor_id)'], answer: 1, explain: 'Equality column first, range/sort column second: one index range scan, already ordered.' },
    { type: 'mcq', q: 'Why use half-open [) ranges for appointments?', options: ['They are faster', 'Back-to-back slots (10:00-10:30, 10:30-11:00) do not overlap', 'They allow NULLs', 'Required by GiST'], answer: 1, explain: 'With [) the end of one slot equals the start of the next without counting as overlap.' }
  ]
},
{
  id: 'real-world-projects-analytics',
  module: 'real-world-projects',
  title: 'Case Study: Building an Analytics Reporting Layer on company_db',
  level: 5,
  minutes: 30,
  summary: 'Build a reporting layer on company_db step by step: revenue by month, category and country, month-over-month growth, cohort retention with window functions, a materialized view with a unique index for concurrent refresh, and supporting indexes.',
  objectives: [
    'Define metrics precisely (what counts as revenue, which dates, which statuses)',
    'Write revenue reports by month, category and country with growth rates',
    'Build a cohort retention matrix with window functions',
    'Materialize a reporting table with a materialized view and refresh it concurrently',
    'Choose indexes and refresh strategies for a reporting workload'
  ],
  concept: `<p>Dashboards that query raw OLTP tables directly become slow and inconsistent as data grows: every chart recomputes joins over millions of rows, and different charts define "revenue" differently. A <strong>reporting layer</strong> fixes both: one place where metrics are defined, pre-aggregated at a useful grain, indexed for the dashboard's filters, and refreshed on a schedule.</p>
<p><strong>Analogy:</strong> a newspaper. Reporters (OLTP) write events as they happen; the editorial desk (reporting layer) compiles them into daily editions (materialized views) with consistent definitions, so readers (dashboards) get fast, consistent answers instead of reading every reporter's raw notes.</p>
<h4>Plan for company_db</h4>
<ol>
<li><strong>Metric definitions</strong>: revenue = <code>order_items.quantity × unit_price</code> for orders with status <code>paid</code>, <code>shipped</code> or <code>delivered</code>; order month = <code>date_trunc('month', order_date)</code>; country from <code>customers</code>.</li>
<li><strong>Exploratory queries</strong>: revenue by month, by category, by country; MoM growth with <code>LAG</code>.</li>
<li><strong>Cohort retention</strong>: customers grouped by first-order month; share active in each subsequent month.</li>
<li><strong>Materialize</strong>: a <code>mv_sales_daily</code> materialized view at (day, category, country) grain — small enough to scan, rich enough for all charts.</li>
<li><strong>Index &amp; refresh</strong>: unique index (enables <code>REFRESH … CONCURRENTLY</code>), filter indexes, scheduled refresh.</li>
</ol>`,
  why: `<p>A reporting layer turns 2-second-to-2-minute dashboard queries into millisecond lookups, protects the OLTP workload from heavy scans, and — just as important — guarantees that "revenue" means the same thing in every report. It is a staple of real projects and a frequent take-home assignment in data-engineering interviews.</p>`,
  useCase: `<p>The company behind company_db (an electronics retailer across India, the USA, the UK, Germany, Singapore and the UAE) wants a management dashboard: monthly revenue trend, category mix, country split and customer retention. Raw queries over orders and order_items are fine at 12,500 items, but the business expects 50M items within two years. The reporting layer built here keeps dashboard queries at a few thousand pre-aggregated rows regardless of raw volume, refreshed every 15 minutes.</p>`,
  internals: `<p>A materialized view stores the query result as a real table (heap + indexes). <code>REFRESH MATERIALIZED VIEW</code> recomputes it and swaps in the result under an ACCESS EXCLUSIVE lock (readers blocked during refresh). <code>REFRESH … CONCURRENTLY</code> computes the new result into a temporary table, diffs it against the current contents using a <strong>unique index</strong> (required) and applies inserts/updates/deletes, so readers are not blocked — it is slower and generates more WAL, but suits dashboards. Refreshes recompute everything; for very large data, an incremental rollup table maintained by a job (upserting only recent days) is the next step, or extensions such as <code>pg_ivm</code> <span class="tag ext">extension</span> for incremental view maintenance.</p>`,
  whenNot: `<p>Do not build a reporting layer for a handful of ad-hoc queries on small data — plain views suffice. For heavy, multi-terabyte analytics with many dimensions, consider a columnar store or warehouse (e.g. ClickHouse, BigQuery, or PostgreSQL extensions such as Citus columnar/Hydra) fed by CDC. Do not refresh materialized views on every write — schedule them.</p>`,
  syntax: `CREATE MATERIALIZED VIEW mv AS SELECT ... WITH DATA;
CREATE UNIQUE INDEX ON mv (key_columns);          -- required for CONCURRENTLY
REFRESH MATERIALIZED VIEW CONCURRENTLY mv;
-- cohort pattern
WITH first AS (SELECT customer_id, min(month) AS cohort ...),
activity AS (SELECT customer_id, month ...)
SELECT cohort, months_since, count(DISTINCT customer_id) ...`,
  examples: [
    {
      label: 'Basic',
      title: 'Revenue by month with month-over-month growth',
      sql: `WITH monthly AS (
  SELECT date_trunc('month', o.order_date)::date        AS month,
         count(DISTINCT o.id)                           AS orders,
         sum(oi.quantity * oi.unit_price)               AS revenue
  FROM   orders o
  JOIN   order_items oi ON oi.order_id = o.id
  WHERE  o.status IN ('paid', 'shipped', 'delivered')   -- metric definition
  GROUP  BY 1
)
SELECT month,
       orders,
       round(revenue, 2)                                                    AS revenue,
       round(revenue / orders, 2)                                           AS avg_order_value,
       round(100.0 * (revenue - lag(revenue) OVER (ORDER BY month))
             / lag(revenue) OVER (ORDER BY month), 1)                       AS mom_growth_pct
FROM   monthly
ORDER  BY month
LIMIT  6;`,
      explain: `<p>The metric definition is explicit in the WHERE clause (pending and cancelled orders are not revenue). Aggregation happens in a CTE at the month grain; then <code>LAG</code> compares each month with the previous one. <code>count(DISTINCT o.id)</code> is needed because the join to items multiplies order rows. The first month's growth is NULL — there is no previous month — which is correct, not a bug.</p>`,
      output: ` month      | orders | revenue     | avg_order_value | mom_growth_pct
------------+--------+-------------+-----------------+----------------
 2024-01-01 |    200 | 51473610.88 |       257368.05 |
 2024-02-01 |    193 | 44545043.25 |       230803.33 |          -13.5
 2024-03-01 |    225 | 56533568.79 |       251260.31 |           26.9
 2024-04-01 |    183 | 47659781.49 |       260435.96 |          -15.7
 2024-05-01 |    235 | 58273538.98 |       247972.51 |           22.3
 2024-06-01 |    202 | 48918213.61 |       242169.37 |          -16.1`,
      run: true
    },
    {
      label: 'Intermediate',
      title: 'Category and country breakdown + cohort retention matrix',
      sql: `-- Revenue by category with share of total
SELECT p.category,
       round(sum(oi.quantity * oi.unit_price), 2)                                     AS revenue,
       round(100.0 * sum(oi.quantity * oi.unit_price)
             / sum(sum(oi.quantity * oi.unit_price)) OVER (), 1)                      AS share_pct
FROM   order_items oi
JOIN   orders o   ON o.id = oi.order_id
JOIN   products p ON p.id = oi.product_id
WHERE  o.status IN ('paid', 'shipped', 'delivered')
GROUP  BY p.category
ORDER  BY revenue DESC;

-- Revenue and buyers by country
SELECT c.country,
       count(DISTINCT o.customer_id)       AS buyers,
       round(sum(o.total_amount), 2)       AS revenue,
       round(avg(o.total_amount), 2)       AS avg_order_value
FROM   orders o JOIN customers c ON c.id = o.customer_id
WHERE  o.status IN ('paid', 'shipped', 'delivered')
GROUP  BY c.country
ORDER  BY revenue DESC;

-- Cohort retention: % of each first-order-month cohort active N months later
WITH activity AS (
  SELECT DISTINCT customer_id, date_trunc('month', order_date)::date AS month
  FROM   orders
  WHERE  status <> 'cancelled'
), cohorts AS (
  SELECT customer_id, month,
         min(month) OVER (PARTITION BY customer_id) AS cohort
  FROM   activity
), aged AS (
  SELECT cohort,
         (extract(year FROM age(month, cohort)) * 12 + extract(month FROM age(month, cohort)))::int AS m,
         customer_id
  FROM   cohorts
)
SELECT cohort,
       count(*) FILTER (WHERE m = 0)                                              AS cohort_size,
       round(100.0 * count(*) FILTER (WHERE m = 1) / count(*) FILTER (WHERE m = 0), 1) AS m1_pct,
       round(100.0 * count(*) FILTER (WHERE m = 2) / count(*) FILTER (WHERE m = 0), 1) AS m2_pct,
       round(100.0 * count(*) FILTER (WHERE m = 3) / count(*) FILTER (WHERE m = 0), 1) AS m3_pct
FROM   aged
GROUP  BY cohort
ORDER  BY cohort
LIMIT  6;`,
      explain: `<p><code>sum(sum(...)) OVER ()</code> is a window over the grouped result — the grand total — giving each category's share in one pass. The country report uses <code>orders.total_amount</code> at order grain (no fan-out). The cohort query uses a window function <code>min(month) OVER (PARTITION BY customer_id)</code> to tag every activity month with the customer's first month, converts the distance to whole months with <code>age()</code>, and pivots with <code>FILTER</code>. Read it as: of customers who first ordered in January 2024, ~35% ordered again the next month.</p>`,
      output: ` category    | revenue      | share_pct
-------------+--------------+-----------
 furniture   | 251661390.82 |      24.3
 accessories | 193099532.76 |      18.6
 electronics | 192682391.21 |      18.6
 audio       | 126782529.21 |      12.2
 networking  | 115934150.49 |      11.2
 video       |  80813367.46 |       7.8
 storage     |  66427915.38 |       6.4

 country   | buyers | revenue      | avg_order_value
-----------+--------+--------------+-----------------
 India     |    188 | 375924950.37 |       244265.72
 Germany   |     62 | 135718672.88 |       253206.48
 USA       |     63 | 133622076.16 |       247907.38
 UK        |     63 | 133037632.05 |       241447.61
 UAE       |     62 | 128013315.81 |       258612.76
 Singapore |     62 | 121084630.06 |       243631.05

 cohort     | cohort_size | m1_pct | m2_pct | m3_pct
------------+-------------+--------+--------+--------
 2024-01-01 |         182 |   34.6 |   42.3 |   40.7
 2024-02-01 |         106 |   42.5 |   27.4 |   39.6
 2024-03-01 |          75 |   34.7 |   30.7 |   29.3
 2024-04-01 |          45 |   46.7 |   48.9 |   42.2
 2024-05-01 |          44 |   36.4 |   25.0 |   54.5
 2024-06-01 |          17 |   47.1 |   35.3 |   47.1`,
      run: true
    },
    {
      label: 'Advanced',
      title: 'Materialized reporting layer with concurrent refresh and indexes',
      sql: `CREATE SCHEMA IF NOT EXISTS reporting;

CREATE MATERIALIZED VIEW reporting.mv_sales_daily AS
SELECT date_trunc('day', o.order_date)::date        AS day,
       p.category,
       c.country,
       count(DISTINCT o.id)                          AS orders,
       count(DISTINCT o.customer_id)                 AS buyers,
       sum(oi.quantity)                              AS units,
       sum(oi.quantity * oi.unit_price)              AS revenue
FROM   orders o
JOIN   order_items oi ON oi.order_id = o.id
JOIN   products p     ON p.id = oi.product_id
JOIN   customers c    ON c.id = o.customer_id
WHERE  o.status IN ('paid', 'shipped', 'delivered')
GROUP  BY 1, 2, 3
WITH DATA;

-- Unique index = the grain; required for REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX mv_sales_daily_pk ON reporting.mv_sales_daily (day, category, country);
CREATE INDEX mv_sales_daily_country_day ON reporting.mv_sales_daily (country, day);

-- Dashboard queries now hit a few thousand rows instead of joining raw tables
SELECT date_trunc('month', day)::date AS month, round(sum(revenue), 2) AS revenue
FROM   reporting.mv_sales_daily
WHERE  country = 'India' AND day >= '2025-01-01'
GROUP  BY 1 ORDER BY 1 LIMIT 3;

-- New data arrives ... then refresh without blocking dashboard readers
REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.mv_sales_daily;

SELECT count(*)                                   AS mv_rows,
       (SELECT count(*) FROM order_items)         AS raw_item_rows,
       pg_size_pretty(pg_total_relation_size('reporting.mv_sales_daily')) AS mv_size;`,
      explain: `<p>The materialized view stores revenue at the (day, category, country) grain — every dashboard chart (trend, category mix, country split, filters by date range) can be answered by summing it. The unique index on the grain both documents it and enables <code>REFRESH … CONCURRENTLY</code>, which keeps the old contents readable during refresh. Note that <code>buyers</code> (distinct customers) cannot be summed across days — distinct counts are not additive; for monthly unique buyers compute from raw data or store HyperLogLog sketches (<code>hll</code> <span class="tag ext">extension</span>). Schedule refresh with cron/pg_cron <span class="tag ext">extension</span>, e.g. every 15 minutes, and monitor its duration.</p>`,
      output: ` month      | revenue
------------+-------------
 2025-01-01 | 18615530.43
 2025-02-01 | 14627351.40
 2025-03-01 | 16088052.05

REFRESH MATERIALIZED VIEW

 mv_rows | raw_item_rows | mv_size
---------+---------------+---------
    8068 |         12500 | 1040 kB   -- grows with days x categories x countries, not with raw rows`,
      run: true
    }
  ],
  compare: {
    bad: { sql: `-- Every dashboard tile recomputes from raw tables with its own "revenue" definition
SELECT sum(total_amount) AS revenue_tile_1 FROM orders;                                   -- includes cancelled!
SELECT sum(quantity * unit_price) AS revenue_tile_2 FROM order_items;                    -- includes pending!`, why: 'Two tiles, two different "revenues", both wrong by business definition, and each scans raw tables on every page load — slow and inconsistent as data grows.', run: true },
    good: { sql: `-- One definition, materialized once, reused everywhere
CREATE MATERIALIZED VIEW mv_revenue_monthly AS
SELECT date_trunc('month', o.order_date)::date AS month,
       sum(oi.quantity * oi.unit_price)          AS revenue
FROM   orders o JOIN order_items oi ON oi.order_id = o.id
WHERE  o.status IN ('paid', 'shipped', 'delivered')
GROUP  BY 1;
CREATE UNIQUE INDEX ON mv_revenue_monthly (month);
SELECT round(sum(revenue), 2) AS total_revenue FROM mv_revenue_monthly;`, why: 'The metric is defined once in the reporting layer; dashboards read small pre-aggregated rows; numbers agree across tiles.', run: true }
  },
  mistakes: [
    `Not defining metrics explicitly (statuses, dates, currency, refunds) — numbers differ across reports.`,
    `Summing distinct counts (daily unique buyers) across days — distinct counts are not additive.`,
    `Fan-out double counting when joining orders to items and payments in one query.`,
    `Refreshing materialized views without a unique index — readers are blocked (no CONCURRENTLY).`,
    `Running heavy reporting queries on the OLTP primary at peak instead of a replica or the reporting layer.`
  ],
  best: [
    `Write a metrics glossary and implement each metric once in the reporting layer.`,
    `Choose a grain that is additive (counts, sums) and small; keep non-additive metrics separate.`,
    `Unique index on the grain; <code>REFRESH … CONCURRENTLY</code> on a schedule; alert on refresh failures/duration.`,
    `Index the materialized view for dashboard filters (date ranges, country, category).`,
    `For large data, move to incremental rollups (upsert recent days) or a columnar warehouse fed by CDC.`
  ],
  performance: `<p>The raw revenue-by-month query joins orders and items (O(items)); the materialized version reads O(days × categories × countries) rows — at 50M items still only tens of thousands of rows. Refresh cost is the full query; schedule it off-peak or on a replica (materialized views can only be refreshed on the primary, but the source query can be optimised with indexes on <code>orders(status, order_date)</code> and <code>order_items(order_id)</code>). Cohort queries sort/hash all customer-month pairs — materialize them daily.</p>`,
  security: `<p>Expose the reporting schema to BI tools through a read-only role with <code>GRANT SELECT</code> on <code>reporting.*</code> only — not on raw tables containing PII (emails, addresses). Aggregates can still leak information about small groups (e.g. a country with one customer); apply minimum group sizes for externally shared reports.</p>`,
  scenario: {
    title: 'The management dashboard takes 40 seconds to load',
    steps: [
      '1. Capture the dashboard\'s queries (pg_stat_statements or the BI tool\'s query log).',
      '2. Write down the metric definitions they imply; resolve inconsistencies with the business.',
      '3. Design the grain (day × category × country) and build the materialized view with a unique index.',
      '4. Point the dashboard at the reporting schema via a read-only role.',
      '5. Schedule REFRESH ... CONCURRENTLY every 15 minutes; monitor duration.',
      '6. Result: dashboard loads in < 1 s; OLTP load from reporting drops to one refresh query per 15 minutes.'
    ]
  },
  widgets: ['lab:plan'],
  interview: [
    { q: 'How do you compute cohort retention in SQL?', a: 'Determine each customer\'s cohort (first activity month, e.g. min(month) OVER (PARTITION BY customer_id)), compute each activity month\'s distance from the cohort in months, then count distinct customers per (cohort, months_since) and divide by the cohort size, pivoting with FILTER or crosstab.' },
    { q: 'What is required for REFRESH MATERIALIZED VIEW CONCURRENTLY?', a: 'A unique index on the materialized view covering all rows (no WHERE clause, column-only). PostgreSQL computes the new result and applies a diff using that index so readers are not blocked. The view must already be populated.' },
    { q: 'Why are distinct counts not additive?', a: 'A customer who buys on two days is counted once per day; summing daily unique buyers counts them twice for the month. Compute distinct counts at the needed grain or use mergeable sketches such as HyperLogLog.' },
    { q: 'Materialized view vs rollup table?', a: 'A materialized view recomputes the whole query on refresh — simple, good up to moderate sizes. A rollup table maintained by a job can upsert only recent periods (incremental), scaling to much larger data at the cost of more code.' }
  ],
  exercises: [
    { task: 'Compute revenue by payment method for successful payments, with each method\'s share of the total.', solution: `SELECT method,
       round(sum(amount), 2) AS revenue,
       round(100.0 * sum(amount) / sum(sum(amount)) OVER (), 1) AS share_pct
FROM   payments
WHERE  status = 'success'
GROUP  BY method
ORDER  BY revenue DESC;`, run: true },
    { task: 'Find the top product per category by revenue (paid/shipped/delivered orders).', solution: `WITH r AS (
  SELECT p.category, p.name, sum(oi.quantity * oi.unit_price) AS revenue,
         rank() OVER (PARTITION BY p.category ORDER BY sum(oi.quantity * oi.unit_price) DESC) AS rnk
  FROM   order_items oi
  JOIN   orders o   ON o.id = oi.order_id
  JOIN   products p ON p.id = oi.product_id
  WHERE  o.status IN ('paid', 'shipped', 'delivered')
  GROUP  BY p.category, p.name
)
SELECT category, name, round(revenue, 2) AS revenue FROM r WHERE rnk = 1 ORDER BY revenue DESC;`, run: true },
    { task: 'Create a materialized view of revenue by country and month with a unique index, then refresh it concurrently.', solution: `CREATE MATERIALIZED VIEW mv_country_month AS
SELECT c.country, date_trunc('month', o.order_date)::date AS month, sum(o.total_amount) AS revenue
FROM   orders o JOIN customers c ON c.id = o.customer_id
WHERE  o.status IN ('paid', 'shipped', 'delivered')
GROUP  BY 1, 2;
CREATE UNIQUE INDEX mv_country_month_uq ON mv_country_month (country, month);
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_country_month;
SELECT count(*) FROM mv_country_month;`, run: true }
  ],
  challenge: {
    task: 'Build a 3-month rolling revenue per category (sum of the current and two previous months) and flag months where the category\'s monthly revenue dropped more than 30% versus the previous month.',
    hint: 'Aggregate to (category, month), then sum(...) OVER (PARTITION BY category ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) and lag().',
    solution: `WITH m AS (
  SELECT p.category,
         date_trunc('month', o.order_date)::date AS month,
         sum(oi.quantity * oi.unit_price)          AS revenue
  FROM   order_items oi
  JOIN   orders o   ON o.id = oi.order_id
  JOIN   products p ON p.id = oi.product_id
  WHERE  o.status IN ('paid', 'shipped', 'delivered')
  GROUP  BY 1, 2
)
SELECT category, month,
       round(revenue, 2)                                                            AS revenue,
       round(sum(revenue) OVER (PARTITION BY category ORDER BY month
                                ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2)      AS rolling_3m,
       round(100.0 * (revenue - lag(revenue) OVER w) / lag(revenue) OVER w, 1)      AS mom_pct,
       (revenue < 0.7 * lag(revenue) OVER w)                                        AS drop_alert
FROM   m
WINDOW w AS (PARTITION BY category ORDER BY month)
ORDER  BY category, month
LIMIT  12;`,
    run: true
  },
  related: ['real-world-projects-approach', 'materialized-views', 'window-functions', 'aggregations', 'interview-prep-system-design'],
  quiz: [
    { type: 'mcq', q: 'Which is required to refresh a materialized view CONCURRENTLY?', options: ['A primary key on the source table', 'A unique index on the materialized view', 'A partial index', 'pg_cron'], answer: 1, explain: 'The diff-based concurrent refresh needs a unique index on the MV.' },
    { type: 'tf', q: 'Daily unique buyers can be summed to get monthly unique buyers.', answer: false, explain: 'Distinct counts are not additive; a repeat buyer would be counted multiple times.' },
    { type: 'bug', q: 'Revenue looks 2-3x too high. Why?', code: `SELECT sum(oi.quantity * oi.unit_price)
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN payments p ON p.order_id = o.id;`, options: ['unit_price is wrong', 'Fan-out: orders with several payments multiply item rows', 'Missing GROUP BY', 'Payments should be LEFT JOIN'], answer: 1, explain: 'Joining two child tables multiplies rows; aggregate each separately first.' },
    { type: 'write', q: 'Write a query for month-over-month revenue growth % using LAG on a monthly aggregate of paid/shipped/delivered orders (total_amount).', solution: `WITH m AS (
  SELECT date_trunc('month', order_date)::date AS month, sum(total_amount) AS revenue
  FROM orders WHERE status IN ('paid','shipped','delivered') GROUP BY 1
)
SELECT month, revenue,
       round(100.0 * (revenue - lag(revenue) OVER (ORDER BY month)) / lag(revenue) OVER (ORDER BY month), 1) AS mom_pct
FROM m ORDER BY month;`, explain: 'Aggregate first, then apply LAG over the ordered months.' }
  ]
}
]);
