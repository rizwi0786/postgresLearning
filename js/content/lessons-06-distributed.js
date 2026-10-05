/* PostgreSQL Mastery — Level 5/6: Replication, HA, Failover, Pooling, Sharding, Distributed, Scaling */
PGM.addLessons([
/* ======================================================================
   MODULE: replication (4)
   ====================================================================== */
{
  id: 'replication-streaming',
  module: 'replication',
  title: 'Streaming (Physical) Replication: Primary, Standby and the WAL Pipeline',
  level: 5,
  minutes: 30,
  summary: 'How a primary ships WAL bytes to hot standbys over walsender/walreceiver, and how to build, verify and monitor a standby with pg_basebackup -R.',
  objectives: [
    'Explain how WAL records travel from primary to standby (walsender, walreceiver, startup process)',
    'Configure a primary for replication (wal_level, max_wal_senders, replication role, pg_hba.conf)',
    'Build a standby with pg_basebackup -R and understand standby.signal and primary_conninfo',
    'Use hot_standby read-only queries and understand recovery conflicts',
    'Measure replication lag in bytes and time with pg_stat_replication and pg_stat_wal_receiver',
    'Decide when physical replication is the right tool versus logical replication or backups'
  ],
  concept: `<p><strong>Streaming replication</strong> <span class="tag core">core</span> keeps one or more <em>standby</em> servers as byte-for-byte copies of a <em>primary</em> by continuously shipping the primary's <strong>Write-Ahead Log (WAL)</strong> and replaying it. It is called <em>physical</em> replication because it replicates changes to data <em>pages</em> (block 4711 of relfilenode 16384 got these bytes), not rows or SQL statements. The standby therefore must be the same major version, the same architecture, and contains every database of the cluster — you cannot pick tables.</p>
<p><strong>Analogy:</strong> think of a court stenographer (the primary's WAL writer) typing every word spoken, and a live satellite feed (walsender → walreceiver) carrying the transcript to a second courtroom where an actor (the startup process) re-enacts every word in exactly the same order. The second courtroom is always a faithful copy, slightly behind; spectators may watch it (hot standby reads) but no one may speak there (read-only).</p>
<p>The moving parts:</p>
<ul>
<li><strong>walsender</strong> — a backend process on the primary, one per connected standby (limited by <code>max_wal_senders</code>, default 10). It reads WAL from <code>pg_wal/</code> (or WAL buffers) and streams it over a normal libpq connection opened in replication mode.</li>
<li><strong>walreceiver</strong> — a process on the standby that receives WAL, writes it to the standby's own <code>pg_wal/</code>, fsyncs it, and reports positions (write / flush / replay LSN) back to the primary.</li>
<li><strong>startup process</strong> — on the standby, continuously replays WAL into the data files. It is single-threaded, which matters for lag (see Performance).</li>
<li><strong>standby.signal</strong> — an empty file in the data directory (PG12+) that tells the server to start in standby mode. Its sibling <code>recovery.signal</code> means "targeted recovery then promote" (PITR). <code>recovery.conf</code> no longer exists since PG12; its settings live in <code>postgresql.conf</code> / <code>postgresql.auto.conf</code>.</li>
<li><strong>primary_conninfo</strong> — the libpq connection string the walreceiver uses, e.g. <code>host=10.0.1.10 port=5432 user=replicator application_name=pg-b</code>. The <code>application_name</code> is how the primary identifies this standby in <code>pg_stat_replication</code> and <code>synchronous_standby_names</code>.</li>
<li><strong>hot_standby</strong> (default <code>on</code>) — allows read-only queries on the standby while it replays.</li>
</ul>
<p>The easiest way to create a standby is <code>pg_basebackup -h primary -U replicator -D /var/lib/postgresql/18/main -X stream -R -C -S pg_b_slot</code>. <code>-X stream</code> streams the WAL generated during the copy so the backup is consistent, <code>-R</code> writes <code>standby.signal</code> and appends <code>primary_conninfo</code> (plus <code>primary_slot_name</code> when <code>-S</code> is given) to <code>postgresql.auto.conf</code>, and <code>-C</code> creates the replication slot on the primary. Start the server and it connects and streams.</p>
<div class="callout info">Physical replication is <strong>asynchronous by default</strong>: a commit on the primary returns as soon as WAL is flushed locally. The standby may be milliseconds — or, under heavy load, minutes — behind. Synchronous replication is covered in the next lessons.</div>`,
  why: `<p>A single PostgreSQL server is a single point of failure and a single box of read capacity. Streaming replication solves three problems at once with almost no application change: <strong>(1) high availability</strong> — a warm copy that can be promoted in seconds instead of restoring a multi-TB backup for hours; <strong>(2) read scaling</strong> — reporting, analytics and read-heavy API endpoints can query hot standbys; <strong>(3) disaster recovery</strong> — a standby in another region keeps a near-real-time copy of the data. Because it reuses the WAL that PostgreSQL writes anyway for crash safety, its overhead on the primary is small: mostly network bandwidth and one walsender process per standby.</p>`,
  useCase: `<p>An e-commerce platform running <code>company_db</code> on a 32-vCPU primary (2.1 TB, ~8,000 TPS at peak, ~40 MB/s of WAL during sales) runs two hot standbys: <strong>pg-b</strong> in the same region but a different availability zone (HA target, Patroni-managed) and <strong>pg-c</strong> in another region (DR, also serving the BI dashboards). Order placement writes go to the primary; the "My Orders" history page and the nightly finance export read from pg-b/pg-c. During the Diwali sale the finance export began causing <em>recovery conflicts</em> on pg-c (queries cancelled with "canceling statement due to conflict with recovery"); the team moved the export to a dedicated standby with a larger <code>max_standby_streaming_delay</code>, keeping the HA standby lag-free.</p>`,
  internals: `<p><strong>LSNs.</strong> Every WAL byte has a <em>Log Sequence Number</em>, a 64-bit position printed as <code>X/YYYYYYYY</code>. Replication progress is just comparing LSNs: <code>sent_lsn</code> (walsender read it), <code>write_lsn</code> (standby wrote it to OS), <code>flush_lsn</code> (standby fsynced it), <code>replay_lsn</code> (startup process applied it). Byte lag = <code>pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)</code>.</p>
<p><strong>Protocol.</strong> The walreceiver connects with <code>replication=true</code> in its connection string, runs <code>IDENTIFY_SYSTEM</code> (system identifier and timeline must match), then <code>START_REPLICATION [SLOT name] PHYSICAL X/Y TIMELINE n</code>. From then on the primary pushes <code>XLogData</code> messages and the standby periodically sends <em>standby status updates</em> (every <code>wal_receiver_status_interval</code>, default 10s, and whenever it flushes when synchronous replication needs it). Those feedback messages are what fill <code>write_lag/flush_lag/replay_lag</code> in <code>pg_stat_replication</code>.</p>
<p><strong>WAL retention.</strong> If the standby falls further behind than the WAL the primary still keeps, the primary recycles segments the standby still needs and the standby fails with "requested WAL segment ... has already been removed". Protection comes from <code>wal_keep_size</code> (a fixed buffer), a <strong>replication slot</strong> (primary keeps everything the slot has not confirmed — next lesson) or a WAL archive plus <code>restore_command</code> on the standby (fallback fetch from archive).</p>
<p><strong>Hot standby conflicts.</strong> Replay may need to remove row versions or take an AccessExclusiveLock that a running standby query still needs. The startup process waits up to <code>max_standby_streaming_delay</code> (default 30s) and then cancels the query. <code>hot_standby_feedback = on</code> makes the standby report its oldest xmin to the primary, preventing VACUUM from removing those rows — fewer cancellations, but potential bloat on the primary.</p>`,
  whenNot: `<ul><li><strong>Only some tables or a different major version</strong> → logical replication (physical copies the whole cluster, same major version only).</li>
<li><strong>Protection against human error</strong> (<code>DROP TABLE</code>, bad <code>UPDATE</code>) → replicas faithfully replay mistakes within milliseconds. You still need backups + PITR, or a deliberately delayed standby (<code>recovery_min_apply_delay = '4h'</code>).</li>
<li><strong>Write scaling</strong> → standbys are read-only. Write scale needs partitioning/sharding or a bigger primary.</li>
<li><strong>Cross-platform copies</strong> (x86 → ARM with different page layout, different compile options) → use logical replication or dump/restore.</li></ul>`,
  syntax: `# --- primary: postgresql.conf ---
wal_level = replica                 # default; 'logical' also works
max_wal_senders = 10
max_replication_slots = 10
wal_keep_size = '2GB'               # optional safety buffer
# --- primary: pg_hba.conf ---
host  replication  replicator  10.0.0.0/16  scram-sha-256

# --- build the standby (run on standby host, empty data dir) ---
pg_basebackup -h 10.0.1.10 -U replicator -D /var/lib/postgresql/18/main \\
  -X stream -R -C -S pg_b_slot -P

# --- result in standby postgresql.auto.conf (written by -R) ---
primary_conninfo = 'host=10.0.1.10 port=5432 user=replicator application_name=pg-b'
primary_slot_name = 'pg_b_slot'
# + empty file  /var/lib/postgresql/18/main/standby.signal`,
  examples: [
    { label: 'Basic', title: 'Is this server ready to be a replication primary?',
      sql: `SELECT name, setting, unit, context
FROM pg_settings
WHERE name IN ('wal_level', 'max_wal_senders', 'max_replication_slots',
               'wal_keep_size', 'hot_standby', 'wal_sender_timeout')
ORDER BY name;`,
      explain: `<p>Every streaming setup starts with these settings. <code>wal_level</code> must be <code>replica</code> or <code>logical</code> (<code>minimal</code> cannot feed a standby). <code>max_wal_senders</code> and <code>max_replication_slots</code> must be at least the number of standbys plus base-backup sessions. <code>context = postmaster</code> means a restart is required to change it — plan those before go-live. <code>hot_standby</code> is read on the standby side, but it is useful to keep configs identical so any node can take any role.</p>`,
      output: ` name                  | setting | unit | context
-----------------------+---------+------+-----------
 hot_standby           | on      |      | postmaster
 max_replication_slots | 10      |      | postmaster
 max_wal_senders       | 10      |      | postmaster
 wal_keep_size         | 0       | MB   | sighup
 wal_level             | replica |      | postmaster
 wal_sender_timeout    | 60000   | ms   | user`, run: true },
    { label: 'Intermediate', title: 'Where am I, and how far has WAL advanced?',
      sql: `SELECT pg_is_in_recovery()                        AS is_standby,
       pg_current_wal_lsn()                       AS current_lsn,
       pg_walfile_name(pg_current_wal_lsn())      AS current_wal_file,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')) AS wal_generated_since_initdb;`,
      explain: `<p><code>pg_is_in_recovery()</code> is the single most important health-check function in replication: <code>false</code> on a primary, <code>true</code> on a standby. Load balancers and HA tools use it to route writes. <code>pg_current_wal_lsn()</code> only works on a primary (on a standby use <code>pg_last_wal_receive_lsn()</code> / <code>pg_last_wal_replay_lsn()</code>). The WAL file name encodes the <strong>timeline</strong> (first 8 hex digits) — after a failover it changes from <code>00000001</code> to <code>00000002</code>. <code>pg_wal_lsn_diff</code> subtracts two LSNs and returns bytes, the basis of every lag metric.</p>`,
      output: ` is_standby | current_lsn | current_wal_file         | wal_generated_since_initdb
------------+-------------+--------------------------+---------------------------
 f          | 0/1DC73B8   | 000000010000000000000001 | 30 MB
(LSN values differ on every server)`, run: true },
    { label: 'Advanced', title: 'Production replication lag dashboard (run on the primary)',
      sql: `SELECT application_name,
       client_addr,
       state,                 -- startup | catchup | streaming | backup
       sync_state,            -- async | potential | sync | quorum
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn))   AS not_yet_sent,
       pg_size_pretty(pg_wal_lsn_diff(sent_lsn, flush_lsn))               AS in_flight,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS replay_lag_bytes,
       write_lag, flush_lag, replay_lag,
       reply_time
FROM pg_stat_replication
ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) DESC NULLS FIRST;`,
      explain: `<p>One row per connected walsender. Split the lag into stages to know <em>where</em> the bottleneck is: large <code>not_yet_sent</code> = primary-side/network throughput; large <code>in_flight</code> = network or standby disk; large replay lag with small flush lag = the standby's single-threaded replay (or a recovery conflict pausing it). The <code>*_lag</code> interval columns measure the time between local WAL flush and the standby's acknowledgement for recent commits; they become <code>NULL</code> when the server is idle, so alert on bytes <em>and</em> time. A missing row means the standby is <em>disconnected</em> — your alert must check for absence, not just high values. In this single-node sandbox the view exists but returns no rows.</p>`,
      output: `(0 rows)  -- sandbox has no standbys. On a real primary:
 application_name | state     | sync_state | replay_lag_bytes | replay_lag
------------------+-----------+------------+------------------+-----------------
 pg-b             | streaming | async      | 312 kB           | 00:00:00.004112
 pg-c             | streaming | async      | 48 MB            | 00:00:02.871903`, run: true }
  ],
  compare: {
    bad: { sql: `-- Monitoring only "is there a row?" and the state column
SELECT application_name, state
FROM pg_stat_replication;`, why: 'Tells you a standby is connected and "streaming" even when it is 40 GB behind and replaying 3 hours late. A failover to it would lose data or take very long to catch up.', run: true },
    good: { sql: `SELECT application_name, state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes,
       replay_lag,
       now() - reply_time AS since_last_feedback
FROM pg_stat_replication;`, why: 'Measures lag in bytes and time and detects a stalled feedback loop (since_last_feedback growing beyond wal_receiver_status_interval). Alert on all three plus the absence of an expected application_name.', run: true }
  },
  mistakes: [
    'Forgetting the <code>replication</code> pseudo-database in <code>pg_hba.conf</code>: a line for <code>all</code> databases does <strong>not</strong> match replication connections.',
    'Not setting <code>application_name</code> in <code>primary_conninfo</code> — every standby appears as <code>walreceiver</code>, making monitoring and <code>synchronous_standby_names</code> ambiguous.',
    'Treating a replica as a backup. A <code>DELETE</code> without <code>WHERE</code> is on every standby within milliseconds.',
    'Running long analytics on the HA standby with <code>hot_standby_feedback = on</code> — the primary cannot vacuum and bloats; with it off, queries get cancelled. Use a separate reporting replica.',
    'Copying the data directory with <code>rsync</code> while the primary runs, without <code>pg_backup_start()</code>/<code>pg_backup_stop()</code>: an inconsistent, silently corrupt standby. Use <code>pg_basebackup</code>.',
    'Leaving <code>max_wal_senders</code> exactly equal to the number of standbys: a base backup or a reconnect needs a spare sender slot.'
  ],
  best: [
    'Create a dedicated role: <code>CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD ...</code>, authenticate with <code>scram-sha-256</code>, and restrict by CIDR in <code>pg_hba.conf</code>; use TLS (<code>sslmode=verify-full</code> in <code>primary_conninfo</code>) across untrusted networks.',
    'Always pair a standby with WAL retention: a replication slot <em>with</em> <code>max_slot_wal_keep_size</code>, or a WAL archive and <code>restore_command</code>.',
    'Keep <code>postgresql.conf</code> identical on all nodes (memory settings, <code>max_connections</code>, <code>max_worker_processes</code>, etc.). A standby refuses to start if certain settings (e.g. <code>max_connections</code>) are lower than the primary\'s.',
    'Alert on byte lag, time lag, and missing standbys; graph <code>pg_stat_replication</code> every 10-15 seconds.',
    'Separate roles: an HA standby (no heavy queries, near-zero lag) and reporting replicas (tolerant <code>max_standby_streaming_delay</code>).'
  ],
  performance: `<p>The primary's cost is small: one walsender per standby reading recently written WAL (usually from OS cache) and network bandwidth equal to the WAL rate (e.g. 40 MB/s ≈ 320 Mbit/s per standby; with 3 standbys plus archiving the primary's NIC carries 4× the WAL rate). Enabling <code>wal_compression = zstd</code> (or <code>lz4</code>) shrinks full-page images and cuts WAL volume 30-60% on update-heavy workloads.</p>
<p>The standby's bottleneck is <strong>single-threaded replay</strong>: one startup process applies all WAL. A primary with 32 cores writing in parallel can generate WAL faster than one core can replay random I/O. Symptoms: <code>flush_lag</code> tiny, <code>replay_lag</code> growing. Mitigations: fast storage on the standby (replay is mostly random reads of pages to modify — <code>recovery_prefetch = try</code>, default since PG15, prefetches referenced blocks), large <code>shared_buffers</code>, avoid giant single transactions (bulk loads in batches), and keep standbys on the same instance class as the primary.</p>`,
  security: `<p>A replication connection can read <strong>every byte of every database</strong> in the cluster — treat the <code>replicator</code> credential like a superuser credential. Restrict it in <code>pg_hba.conf</code> to standby IPs, use <code>scram-sha-256</code>, store passwords in <code>~/.pgpass</code> (mode 0600) rather than in <code>primary_conninfo</code> if possible, and enable TLS. Standbys contain the same PII as the primary and need the same encryption-at-rest, patching and access controls.</p>`,
  scenario: { title: 'Replica lag hits 30 minutes during a nightly bulk load', steps: [
    '1. Alert fires: pg-c replay_lag = 00:31:12, replay_lag_bytes = 58 GB, but flush_lag is 2 seconds → network and standby disk writes are fine; replay is the bottleneck.',
    '2. On the standby, check SELECT pid, wait_event_type, wait_event FROM pg_stat_activity WHERE backend_type = \'startup\'; — a wait on a lock or "RecoveryConflict*" means a standby query is blocking replay; IO waits mean storage is too slow.',
    '3. Found: a 25-minute BI query held a lock-conflicting snapshot and max_standby_streaming_delay = -1 (wait forever) had been set by someone to "stop cancellations". Replay paused for 25 minutes.',
    '4. Immediate fix: cancel the BI query (pg_cancel_backend); replay catches up at ~120 MB/s in ~8 minutes.',
    '5. Structural fix: restore max_standby_streaming_delay = 30s on the HA standby; create a separate reporting replica with a 15-minute delay tolerance; split the bulk load into 50k-row batches so WAL arrives smoothly; enable wal_compression = zstd.',
    '6. Add an alert on replay_lag over 60s for the HA standby and over 15 min for reporting replicas, and route reads away from replicas above their threshold.'
  ] },
  widgets: ['diagram:streaming-replication', 'diagram:read-replica', 'diagram:wal'],
  interview: [
    { q: 'What exactly is replicated in streaming replication and what follows from that?', a: 'WAL records describing physical page changes, for the whole cluster. Therefore the standby must run the same major version and platform, contains all databases, cannot be written to, and replays every change, including mistakes. Selective, cross-version or writable targets require logical replication.' },
    { q: 'What do pg_basebackup -R, -X stream, -C and -S do?', a: '-X stream streams WAL produced during the copy over a second connection so the backup is self-consistent. -R writes standby.signal and adds primary_conninfo (and primary_slot_name) to postgresql.auto.conf so the server starts as a standby. -C -S name create and use a physical replication slot so the primary retains WAL for this standby.' },
    { q: 'replay_lag is growing but flush_lag is near zero. What is happening?', a: 'WAL is arriving and being persisted on the standby promptly, but the single startup process is not applying it fast enough. Causes: a recovery conflict pausing replay (long standby query with a high max_standby_streaming_delay), slow random-read storage on the standby, or a burst of WAL from a bulk operation. Check the startup process wait events and standby queries.' },
    { q: 'What are the trade-offs of hot_standby_feedback?', a: 'With it on, the standby sends its oldest snapshot xmin to the primary, so VACUUM on the primary will not remove rows standby queries still see — fewer query cancellations, but long standby queries cause bloat on the primary. With it off, the primary vacuums freely and standby queries may be cancelled after max_standby_streaming_delay.' }
  ],
  exercises: [
    { task: 'Compute how many megabytes separate two LSNs: 0/3000000 (standby replay position) and 0/5A00000 (primary current position).', solution: `SELECT pg_wal_lsn_diff('0/5A00000', '0/3000000') AS lag_bytes,
       round(pg_wal_lsn_diff('0/5A00000', '0/3000000') / 1024 / 1024, 1) AS lag_mb;`, run: true },
    { task: 'Write a health-check query a load balancer could use that returns the single word primary or standby.', solution: `SELECT CASE WHEN pg_is_in_recovery() THEN 'standby' ELSE 'primary' END AS role;`, run: true },
    { task: 'Create the dedicated replication role (with a connection limit) that standbys will use, then confirm its attributes.', solution: `CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'change-me-Str0ng!' CONNECTION LIMIT 5;
SELECT rolname, rolreplication, rolcanlogin, rolconnlimit
FROM pg_roles WHERE rolname = 'replicator';`, run: true }
  ],
  challenge: { task: 'Build a single query that classifies each standby into OK / WARN / CRITICAL: CRITICAL if replay lag over 1 GB or replay_lag over 5 minutes, WARN if over 64 MB or over 30 seconds, otherwise OK. It must run on a primary (it will return zero rows in the sandbox).', hint: 'Use pg_wal_lsn_diff for bytes and compare the interval column replay_lag with interval literals; COALESCE NULL lag intervals to 0.', solution: `SELECT application_name,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS lag_bytes,
       replay_lag,
       CASE
         WHEN pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) > 1024^3
           OR COALESCE(replay_lag, interval '0') > interval '5 minutes'  THEN 'CRITICAL'
         WHEN pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) > 64 * 1024^2
           OR COALESCE(replay_lag, interval '0') > interval '30 seconds' THEN 'WARN'
         ELSE 'OK'
       END AS status
FROM pg_stat_replication
ORDER BY status;`, run: true },
  related: ['replication-slots', 'replication-sync-async', 'high-availability', 'wal', 'backup-restore'],
  quiz: [
    { type: 'mcq', q: 'Which file makes a PostgreSQL 16+ server start as a streaming standby?', options: ['recovery.conf', 'standby.signal', 'replica.conf', 'postmaster.opts'], answer: 1, explain: 'Since PostgreSQL 12, recovery.conf is gone; an empty standby.signal file in the data directory plus primary_conninfo puts the server in standby mode.' },
    { type: 'tf', q: 'A physical standby can replicate only the orders database out of a cluster that has five databases.', answer: false, explain: 'Physical replication copies the whole cluster at the block level. Selecting databases or tables requires logical replication.' },
    { type: 'predict', q: 'On a hot standby, what does this return?', code: `SELECT pg_is_in_recovery();`, options: ['false', 'true', 'ERROR: recovery is in progress', 'NULL'], answer: 1, explain: 'A standby is permanently "in recovery" (replaying WAL), so the function returns true. It flips to false after promotion.' },
    { type: 'bug', q: 'The standby logs "no pg_hba.conf entry for replication connection from host 10.0.2.15". What is wrong with this pg_hba.conf line?', code: `host  all  replicator  10.0.0.0/16  scram-sha-256`, options: ['The CIDR is wrong', 'Replication connections must match the special database name replication, not all', 'scram-sha-256 is not allowed for replication', 'The user must be postgres'], answer: 1, explain: 'The keyword all does not match physical replication connections; you need a line whose database field is replication.' },
    { type: 'scenario', q: 'Your HA standby shows flush_lag 3 ms but replay_lag 4 minutes and growing. First thing to check?', options: ['Network bandwidth between AZs', 'Whether a long-running query on the standby is blocking replay (recovery conflict) or the startup process is IO-bound', 'Increase max_wal_senders', 'Restart the primary'], answer: 1, explain: 'WAL is arriving and flushed promptly, so network and receive path are fine; the apply side is stuck or slow.' }
  ]
},
{
  id: 'replication-slots',
  module: 'replication',
  title: 'Replication Slots: Guaranteed WAL Retention and the Abandoned-Slot Disk Bomb',
  level: 5,
  minutes: 25,
  summary: 'Physical and logical replication slots, how they pin WAL and xmin, max_slot_wal_keep_size, idle timeouts and how to find and remove abandoned slots before the disk fills.',
  objectives: [
    'Explain what a replication slot persists and why it prevents "WAL segment already removed" errors',
    'Create, inspect and drop physical and logical slots',
    'Read wal_status, safe_wal_size, inactive_since and invalidation_reason',
    'Cap the damage with max_slot_wal_keep_size and idle_replication_slot_timeout (PG18)',
    'Build alerting for inactive and lagging slots'
  ],
  concept: `<p>A <strong>replication slot</strong> <span class="tag core">core</span> is a small, crash-safe bookmark on the primary that remembers how far a particular consumer has confirmed receiving changes. As long as the slot exists, the primary will <strong>not delete WAL</strong> the consumer still needs — even if the consumer is offline for a week.</p>
<p><strong>Analogy:</strong> a slot is a "hold mail" request at the post office. The post office keeps every letter for you until you collect it. Wonderful while you are on holiday — and a disaster if you move away forever and never cancel the request: the back room fills with your mail until the post office cannot accept anything at all.</p>
<ul>
<li><strong>Physical slots</strong> are used by streaming standbys (<code>primary_slot_name</code>) and <code>pg_basebackup -S</code>. They store <code>restart_lsn</code> (oldest WAL needed) and, with <code>hot_standby_feedback</code>, the standby's <code>xmin</code>.</li>
<li><strong>Logical slots</strong> are used by logical replication subscriptions and CDC tools (Debezium, pg_recvlogical). They are tied to <strong>one database</strong> and an <strong>output plugin</strong> (<code>pgoutput</code> for built-in logical replication, <code>test_decoding</code>, <code>wal2json</code> <span class="tag ext">extension</span>). Besides WAL they also hold <code>catalog_xmin</code>: the primary must keep old <em>catalog</em> row versions so it can decode old WAL with the schema that was valid at the time.</li>
</ul>
<p>Without a slot, a primary keeps WAL only according to <code>wal_keep_size</code> and checkpoints; a standby offline for longer than that must be rebuilt. With a slot, it never needs rebuilding — at the price that an <strong>abandoned slot retains WAL forever</strong>. This is one of the most common causes of "PostgreSQL disk 100% full, database stopped" incidents in production, typically after someone decommissions a replica or stops a Debezium connector without dropping its slot.</p>
<p>Since PG13, <code>max_slot_wal_keep_size</code> caps the WAL a slot may retain; beyond it the slot is <em>invalidated</em> (<code>wal_status = 'lost'</code>) and the consumer must be re-initialized — you trade a broken replica for a living primary. PG17 added <code>inactive_since</code> and <code>invalidation_reason</code>; PG18 added <code>idle_replication_slot_timeout</code>, which invalidates slots inactive for longer than the configured time.</p>`,
  why: `<p>Before slots (PG ≤ 9.3) DBAs guessed a <code>wal_keep_segments</code> value: too small and a standby that disconnected during a network blip had to be rebuilt from a multi-hour base backup; too large and disk was wasted permanently. Logical decoding is impossible without slots because the decoder must restart exactly where the consumer left off with no gaps and no duplicates. Slots make retention <em>exact</em>: keep precisely what each consumer still needs.</p>`,
  useCase: `<p>A fintech runs CDC from <code>company_db.payments</code> to Kafka using Debezium (logical slot <code>debezium_payments</code>) and two physical standbys with slots. The WAL rate is ~25 GB/hour on weekdays. When the Kafka Connect cluster was down for a 9-hour maintenance window, the logical slot retained ~225 GB of WAL. Because the team had set <code>max_slot_wal_keep_size = '300GB'</code> on a 1 TB WAL volume and an alert at 50 GB retained per slot, the on-call engineer saw the growth early, confirmed the outage was planned, and the slot was consumed once Kafka returned — no invalidation, no disk outage.</p>`,
  internals: `<p>Slots are stored as small files under <code>pg_replslot/&lt;name&gt;/state</code> and loaded into shared memory (<code>max_replication_slots</code> entries). At each checkpoint PostgreSQL computes the minimum <code>restart_lsn</code> over all slots (and <code>wal_keep_size</code>) and only removes/recycles WAL segments older than that. Similarly, the global xmin horizon used by VACUUM is held back by the slot's <code>xmin</code> (physical slot with feedback) and <code>catalog_xmin</code> (logical slot), so an abandoned logical slot also causes <strong>catalog bloat</strong> and can, in extreme cases, push the cluster toward transaction-ID wraparound protection.</p>
<p><code>wal_status</code> values: <code>reserved</code> (within <code>max_wal_size</code>), <code>extended</code> (beyond it but retained because of <code>wal_keep_size</code>/slot), <code>unreserved</code> (will be removed at next checkpoint — consumer about to be lost), <code>lost</code> (already removed; slot unusable). <code>safe_wal_size</code> = bytes that may still be written before the slot hits <code>unreserved</code> (NULL when <code>max_slot_wal_keep_size = -1</code>).</p>
<p><strong>Failover of logical slots (PG17+):</strong> logical slots used to exist only on the primary, so after failover CDC consumers had to resync. With <code>failover = true</code> on the slot, <code>sync_replication_slots = on</code> on the standby and <code>synchronized_standby_slots</code> on the primary, logical slots are synchronized to physical standbys and survive promotion.</p>`,
  whenNot: `<ul><li>Short-lived or experimental consumers ("let me try Debezium on prod for a day") — create the slot only with an owner, an alert and a removal plan.</li>
<li>Standbys that can tolerate rebuilds and you have a robust WAL archive with <code>restore_command</code> — a slot is optional; the archive is the retention mechanism.</li>
<li>Never use a slot without a cap (<code>max_slot_wal_keep_size</code>) on a server whose WAL volume is shared with data: one forgotten slot then takes down the whole database.</li></ul>`,
  syntax: `-- Physical slot (reserve WAL immediately = true)
SELECT pg_create_physical_replication_slot('pg_b_slot', true);

-- Logical slot (needs wal_level = logical; one database; output plugin)
SELECT pg_create_logical_replication_slot('cdc_orders', 'pgoutput');
-- PG17+: SELECT pg_create_logical_replication_slot('cdc', 'pgoutput', false, false, true); -- failover = true

-- Inspect / drop
SELECT * FROM pg_replication_slots;
SELECT pg_drop_replication_slot('pg_b_slot');     -- slot must be inactive

-- Safety caps (postgresql.conf)
max_slot_wal_keep_size = '200GB'           # PG13+, -1 = unlimited (default)
idle_replication_slot_timeout = '2d'       # PG18+, 0 = disabled (default)`,
  examples: [
    { label: 'Basic', title: 'Create, inspect and drop a physical slot',
      sql: `SELECT pg_create_physical_replication_slot('standby_b', true);

SELECT slot_name, slot_type, active,
       restart_lsn IS NOT NULL AS wal_reserved,
       wal_status
FROM pg_replication_slots;

SELECT pg_drop_replication_slot('standby_b');`,
      explain: `<p>The second argument <code>true</code> (<em>immediately_reserve</em>) makes the slot start retaining WAL from now — without it, <code>restart_lsn</code> stays NULL until a standby first connects. <code>active = false</code> because nothing is streaming from it yet. Note: slot creation is <strong>not transactional</strong>; a <code>ROLLBACK</code> does not remove it, so always drop test slots explicitly (as done here).</p>`,
      output: ` pg_create_physical_replication_slot
-------------------------------------
 (standby_b,0/1DC7340)

 slot_name | slot_type | active | wal_reserved | wal_status
-----------+-----------+--------+--------------+------------
 standby_b | physical  | f      | t            | reserved

 pg_drop_replication_slot
--------------------------
 (void)`, run: true },
    { label: 'Intermediate', title: 'How much WAL is each slot holding back?',
      sql: `SELECT slot_name,
       slot_type,
       database,
       active,
       wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
       pg_size_pretty(safe_wal_size)                                      AS safe_wal_left,
       inactive_since,          -- PG17+
       invalidation_reason      -- PG17+: wal_removed, rows_removed, idle_timeout (PG18) ...
FROM pg_replication_slots
ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC NULLS LAST;`,
      explain: `<p>This is the query to put on every primary's dashboard. <code>retained_wal</code> is the disk the slot is forcing PostgreSQL to keep. <code>safe_wal_left</code> is how much more WAL may be generated before the slot is invalidated (NULL when no cap is configured — itself a finding). <code>inactive_since</code> tells you for how long nobody consumed the slot. The sandbox has no slots, so the result is empty.</p>`,
      output: `(0 rows)  -- in production, e.g.:
 slot_name         | type     | active | wal_status | retained_wal | safe_wal_left | inactive_since
-------------------+----------+--------+------------+--------------+---------------+------------------------
 debezium_payments | logical  | f      | extended   | 187 GB       | 113 GB        | 2026-10-04 22:10:03+00
 pg_b_slot         | physical | t      | reserved   | 2104 kB      | 300 GB        |`, run: true },
    { label: 'Advanced', title: 'Cap retention and auto-expire idle slots (configuration)',
      sql: `-- Run as superuser on the primary; takes effect on reload
ALTER SYSTEM SET max_slot_wal_keep_size = '200GB';
ALTER SYSTEM SET idle_replication_slot_timeout = '2d';   -- PG18+
SELECT pg_reload_conf();

-- Emergency: a decommissioned replica's slot is filling the disk
SELECT pg_drop_replication_slot('old_replica_slot');

-- If the slot is still 'active' (a ghost connection), terminate the sender first
SELECT pg_terminate_backend(active_pid)
FROM pg_replication_slots
WHERE slot_name = 'old_replica_slot' AND active;`,
      explain: `<p><code>max_slot_wal_keep_size</code> is reloadable (SIGHUP). Size it so that <em>retained WAL + data growth</em> can never fill the WAL volume: on a 500 GB WAL disk, 200 GB per-slot cap and an alert at 50 GB. <code>idle_replication_slot_timeout</code> (PG18) invalidates slots inactive longer than the setting at checkpoint time; their <code>invalidation_reason</code> becomes <code>idle_timeout</code>. To drop an active slot you must first kill the walsender using it. Not runnable here: <code>ALTER SYSTEM</code> and real slots are outside the sandbox.</p>`,
      output: `ALTER SYSTEM
ALTER SYSTEM
 pg_reload_conf
----------------
 t`, run: false }
  ],
  compare: {
    bad: { sql: `-- Decommissioning a replica:
-- 1. shut down the standby VM
-- 2. delete the VM
-- (slot pg_c_slot still exists on the primary, active = false)`, why: 'The primary keeps every WAL segment from the moment the standby stopped. At 25 GB/hour the WAL volume fills in hours or days, and PostgreSQL PANICs when it cannot write WAL.', run: false },
    good: { sql: `-- Decommissioning checklist on the PRIMARY
SELECT slot_name, active, wal_status
FROM pg_replication_slots WHERE slot_name = 'pg_c_slot';
-- after the standby is stopped:
-- SELECT pg_drop_replication_slot('pg_c_slot');
-- and remove it from synchronous_standby_names / monitoring`, why: 'Slots belong to the decommissioning runbook. Dropping the slot lets the next checkpoint recycle the retained WAL immediately.', run: false }
  },
  mistakes: [
    'Leaving <code>max_slot_wal_keep_size = -1</code> (unlimited, the default) in production — one forgotten slot can fill the disk and stop the primary.',
    'Testing Debezium/CDC tools against production, then deleting the connector but not its logical slot.',
    'Assuming <code>ROLLBACK</code> undoes <code>pg_create_*_replication_slot</code>; slots are non-transactional.',
    'Monitoring only disk usage instead of per-slot retained WAL — by the time the disk alert fires, you have minutes, not hours.',
    'Not knowing that logical slots also hold <code>catalog_xmin</code>, causing <code>pg_catalog</code> bloat and growing transaction-ID age.',
    'Re-creating a standby with a new slot name and forgetting the old slot.'
  ],
  best: [
    'Name slots after their consumer and owner (<code>pg_b_ha</code>, <code>debezium_payments_teamx</code>) and track them in your CMDB.',
    'Set <code>max_slot_wal_keep_size</code> on every primary that has slots, sized below WAL-volume free space; PG18: also <code>idle_replication_slot_timeout</code>.',
    'Alert when retained WAL per slot exceeds a threshold (e.g. 20% of disk) and when a slot is inactive longer than N minutes.',
    'Put WAL (<code>pg_wal</code>) on a volume with headroom and monitoring; never let it share a tiny root filesystem.',
    'For CDC on PG17+, create logical slots with <code>failover = true</code> and configure slot synchronization so consumers survive a failover.'
  ],
  performance: `<p>An active, healthy slot costs nothing measurable. A lagging slot costs disk space (WAL) and, for logical slots, catalog bloat and slower decoding (decoders may spill large transactions to disk: see <code>spill_bytes</code> in <code>pg_stat_replication_slots</code>; raise <code>logical_decoding_work_mem</code>, default 64 MB, to reduce spilling). Hot standby feedback via a physical slot's xmin can hold back VACUUM on the primary, causing table and index bloat and slower queries everywhere.</p>`,
  security: `<p>Creating slots requires the <code>REPLICATION</code> attribute or superuser. A logical slot plus <code>pg_logical_slot_get_changes()</code> exposes every change in the database (including PII columns not otherwise granted), so limit who has <code>REPLICATION</code>. Dropping a slot is a destructive operation for the consumer; restrict it through runbooks.</p>`,
  scenario: { title: 'Primary disk at 94% and rising 1% every 10 minutes', steps: [
    '1. df shows pg_wal is 410 GB on a 500 GB volume. Run the retained-WAL query: slot "analytics_cdc" (logical) is inactive since 3 days, retaining 402 GB, wal_status = extended.',
    '2. Ask: is the consumer coming back within the remaining headroom (~1.5 hours at current WAL rate)? The analytics team confirms the connector was retired.',
    '3. SELECT pg_drop_replication_slot(\'analytics_cdc\'); then CHECKPOINT; — WAL segments are removed/recycled; pg_wal drops to 6 GB within a minute.',
    '4. If the consumer had still been needed: temporarily extend the volume (cloud disks can grow online) rather than drop the slot, then fix the consumer.',
    '5. Prevent recurrence: ALTER SYSTEM SET max_slot_wal_keep_size = \'150GB\'; on PG18 also idle_replication_slot_timeout = \'1d\'; add per-slot retained-WAL alerts at 20 GB and an inactive-slot alert at 30 minutes.'
  ] },
  widgets: ['diagram:streaming-replication', 'diagram:wal'],
  interview: [
    { q: 'Why are replication slots dangerous and how do you mitigate it?', a: 'A slot retains WAL (and xmin/catalog_xmin) until its consumer confirms it, regardless of how long the consumer is gone. An abandoned slot fills the WAL volume and causes bloat. Mitigate with max_slot_wal_keep_size, idle_replication_slot_timeout on PG18, per-slot retained-WAL and inactivity alerts, and decommissioning runbooks that drop slots.' },
    { q: 'What is the difference between a physical and a logical slot?', a: 'A physical slot tracks a streaming standby position (restart_lsn and optionally xmin) and is cluster-wide. A logical slot belongs to one database, has an output plugin (e.g. pgoutput), tracks confirmed_flush_lsn and holds catalog_xmin so historic catalog versions remain available for decoding.' },
    { q: 'What does wal_status = unreserved mean?', a: 'The slot needs WAL beyond max_slot_wal_keep_size; at the next checkpoint those segments will be removed and the slot becomes lost. The consumer must catch up immediately or will need to be re-initialized.' },
    { q: 'How do logical slots survive failover in PostgreSQL 17+?', a: 'Create them with failover = true; on the physical standby enable sync_replication_slots and hot_standby_feedback with a primary_slot_name; on the primary list the standby slot in synchronized_standby_slots so logical consumers never get ahead of the standby. After promotion the synced slot is usable.' }
  ],
  exercises: [
    { task: 'List all slots with retained WAL in human-readable form, worst first (zero rows in the sandbox is fine).', solution: `SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots
ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC NULLS LAST;`, run: true },
    { task: 'Show the current values of every slot-related safety setting.', solution: `SELECT name, setting, unit
FROM pg_settings
WHERE name IN ('max_replication_slots', 'max_slot_wal_keep_size',
               'idle_replication_slot_timeout', 'wal_keep_size',
               'logical_decoding_work_mem', 'sync_replication_slots');`, run: true }
  ],
  challenge: { task: 'Write an alert query that returns a row only for slots that are a problem: inactive for more than 30 minutes, OR retaining more than 20 GB, OR in wal_status unreserved/lost. Include a human-readable reason column.', hint: 'Use CASE with ordered conditions and filter with WHERE on the same conditions; inactive_since is a timestamptz (PG17+).', solution: `SELECT slot_name, slot_type, active, wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained,
       CASE
         WHEN wal_status IN ('unreserved', 'lost') THEN 'slot invalidated or about to be'
         WHEN pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) > 20 * 1024^3 THEN 'retaining > 20 GB'
         ELSE 'inactive > 30 min'
       END AS reason
FROM pg_replication_slots
WHERE wal_status IN ('unreserved', 'lost')
   OR pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) > 20 * 1024^3
   OR (NOT active AND inactive_since < now() - interval '30 minutes');`, run: true },
  related: ['replication-streaming', 'replication-logical', 'wal', 'monitoring'],
  quiz: [
    { type: 'mcq', q: 'Which setting caps how much WAL a single slot may retain before it is invalidated?', options: ['wal_keep_size', 'max_wal_size', 'max_slot_wal_keep_size', 'min_wal_size'], answer: 2, explain: 'max_slot_wal_keep_size (PG13+) limits retention for slots; wal_keep_size is a fixed retention independent of slots.' },
    { type: 'tf', q: 'Running ROLLBACK after pg_create_physical_replication_slot() removes the slot.', answer: false, explain: 'Slot creation is non-transactional. Drop the slot explicitly with pg_drop_replication_slot().' },
    { type: 'scenario', q: 'A Debezium connector was deleted two weeks ago. Disk usage keeps climbing on the primary. Most likely cause?', options: ['Autovacuum is disabled', 'The connector\'s logical replication slot still exists and retains WAL', 'Checkpoints are too frequent', 'shared_buffers is too large'], answer: 1, explain: 'Deleting the consumer does not drop its slot; the slot pins WAL from the last confirmed position.' },
    { type: 'mcq', q: 'Besides WAL, what does a logical slot hold back on the primary?', options: ['Nothing', 'catalog_xmin, preventing removal of old system-catalog row versions', 'All table locks', 'The checkpoint process'], answer: 1, explain: 'Logical decoding needs historic catalog versions, so the slot pins catalog_xmin, causing catalog bloat if it lags.' }
  ]
},
{
  id: 'replication-sync-async',
  module: 'replication',
  title: 'Synchronous vs Asynchronous Replication: Durability, Latency and Quorum Commit',
  level: 5,
  minutes: 30,
  summary: 'synchronous_commit levels, synchronous_standby_names with FIRST and ANY quorum, the latency cost of zero data loss, and how to monitor sync state and lag.',
  objectives: [
    'Explain what a commit waits for at each synchronous_commit level (off, local, remote_write, on, remote_apply)',
    'Configure synchronous_standby_names with FIRST n and ANY n quorum syntax',
    'Quantify commit latency added by cross-AZ and cross-region synchronous replication',
    'Use per-transaction synchronous_commit to mix durability levels in one application',
    'Recognize the availability trap: a synchronous primary with no reachable standby blocks commits',
    'Monitor sync_state, sync_priority and lag in pg_stat_replication'
  ],
  concept: `<p>With <strong>asynchronous</strong> replication (the default) the primary acknowledges <code>COMMIT</code> as soon as its own WAL is flushed to disk. If the primary dies a moment later, transactions already acknowledged to clients but not yet received by the standby are <strong>lost</strong> on failover. Data loss window = replication lag (typically milliseconds, but seconds or minutes under load).</p>
<p>With <strong>synchronous</strong> replication <span class="tag core">core</span>, the committing backend additionally waits until one or more standbys listed in <code>synchronous_standby_names</code> confirm they have the commit's WAL. Then a failover to such a standby loses nothing: <strong>RPO = 0</strong>.</p>
<p><strong>Analogy:</strong> async is posting a letter and walking away; sync is sending it by registered mail and waiting at the counter until the recipient signs. Safer — but you stand at the counter for the round trip every time, and if the recipient never answers you stand there forever.</p>
<p>What exactly is waited for is controlled by <code>synchronous_commit</code> (settable per session or even per transaction):</p>
<table><tr><th>Value</th><th>Commit returns when…</th><th>Survives</th></tr>
<tr><td><code>off</code></td><td>WAL is in memory; flushed by walwriter within ~3×<code>wal_writer_delay</code></td><td>nothing guaranteed; a crash may lose the last ~600 ms (no corruption)</td></tr>
<tr><td><code>local</code></td><td>local WAL flush only, even if sync standbys are configured</td><td>primary crash</td></tr>
<tr><td><code>remote_write</code></td><td>sync standby(s) wrote WAL to their OS (not fsynced)</td><td>primary loss; not simultaneous standby OS crash</td></tr>
<tr><td><code>on</code> (default)</td><td>sync standby(s) <strong>flushed</strong> WAL to durable storage</td><td>loss of primary, even with standby crash</td></tr>
<tr><td><code>remote_apply</code></td><td>sync standby(s) <strong>replayed</strong> it — visible to queries there</td><td>as <code>on</code> + read-your-writes on the standby</td></tr></table>
<p>If <code>synchronous_standby_names</code> is empty, <code>on</code>, <code>remote_write</code> and <code>remote_apply</code> all behave like <code>local</code>.</p>
<p><code>synchronous_standby_names</code> matches standbys by their <code>application_name</code>:</p>
<ul><li><code>'FIRST 1 (pg_b, pg_c)'</code> — priority-based: wait for the highest-priority connected standby (pg_b); pg_c is <em>potential</em> and takes over if pg_b disconnects. A bare list <code>'pg_b, pg_c'</code> means the same as <code>FIRST 1</code>.</li>
<li><code>'ANY 2 (pg_b, pg_c, pg_d)'</code> — quorum-based: wait for any 2 of 3. Commits continue if any one standby is down or slow — the most robust choice for zero data loss.</li>
<li><code>'*'</code> matches any standby name.</li></ul>`,
  why: `<p>Some data cannot be lost: payments, ledger entries, order confirmations already emailed to customers. With asynchronous replication, an automated failover after a hardware failure can silently drop the last few hundred committed transactions — customers have receipts for orders the database no longer has. Synchronous replication closes that gap. Conversely, much data (clickstream, logs, session caches) is fine with async or even <code>synchronous_commit = off</code>, and paying the latency for it would be waste. PostgreSQL lets you decide <em>per transaction</em>.</p>`,
  useCase: `<p>A payments provider runs <code>company_db</code> in three availability zones: primary pg-a (AZ1), standbys pg-b (AZ2) and pg-c (AZ3), cross-AZ round trip ≈ 0.8-1.2 ms. They set <code>synchronous_standby_names = 'ANY 1 (pg_b, pg_c)'</code> and <code>synchronous_commit = on</code>. Payment commits went from 1.1 ms to 2.3 ms median — acceptable — and an AZ1 power loss later caused a 22-second failover with zero lost payments. Their analytics event ingestion sets <code>SET synchronous_commit = local</code> at session start, keeping 40k events/s throughput unaffected. A DR standby in another region (~70 ms RTT) is deliberately <strong>async</strong>: making it synchronous would add 70 ms to every payment commit.</p>`,
  internals: `<p>When a backend commits, it flushes its commit record locally, then inserts itself into a wait queue in shared memory (<code>SyncRepWaitForLSN</code>) keyed by its commit LSN. Walsenders receive status updates from standbys with their write/flush/apply LSNs; the walsender for a synchronous standby computes the new "safe" LSN (for <code>FIRST n</code> the n-th highest-priority positions; for <code>ANY n</code> the n-th greatest LSN among all listed standbys) and wakes backends whose commit LSN is ≤ it. The wait event shown in <code>pg_stat_activity</code> is <code>SyncRep</code>.</p>
<p>Important subtleties:</p>
<ul><li>The transaction is <strong>already committed locally</strong> while it waits. If you cancel the wait (Ctrl-C, <code>pg_cancel_backend</code>, or a client timeout), PostgreSQL emits a warning that the transaction committed locally but might not have been replicated. Other sessions can already see the row on the primary. Synchronous replication guarantees durability on failover, not atomic visibility across nodes.</li>
<li>If no synchronous standby is connected, <strong>commits block indefinitely</strong>. PostgreSQL does not fall back to async automatically. HA tools such as Patroni's <code>synchronous_mode</code> manage the list dynamically to avoid this (and <code>synchronous_mode_strict</code> chooses blocking over possible data loss).</li>
<li>Read-only transactions and transactions that wrote no WAL don't wait.</li></ul>`,
  whenNot: `<ul><li><strong>Cross-region</strong> synchronous standbys for OLTP: every commit pays the inter-region RTT (40-150 ms). Use async DR and accept a small RPO, or use a quorum of nearby standbys.</li>
<li><strong>Only one standby with FIRST 1</strong>: losing that standby (or just restarting it for patching) stops all writes. Use at least two candidates or ANY quorum, or an HA manager that edits the list.</li>
<li><strong>High-volume, low-value writes</strong> (telemetry, logs): use <code>synchronous_commit = local</code> or <code>off</code> for those transactions.</li></ul>`,
  syntax: `# postgresql.conf on the primary
synchronous_standby_names = 'FIRST 1 (pg_b, pg_c)'   # priority
synchronous_standby_names = 'ANY 2 (pg_b, pg_c, pg_d)' # quorum
synchronous_commit = on        # off | local | remote_write | on | remote_apply

-- per session / per transaction overrides
SET synchronous_commit = local;
BEGIN; SET LOCAL synchronous_commit = remote_apply; ... COMMIT;
ALTER ROLE etl_user SET synchronous_commit = off;`,
  examples: [
    { label: 'Basic', title: 'Inspect the durability configuration',
      sql: `SELECT name, setting, context, short_desc
FROM pg_settings
WHERE name IN ('synchronous_commit', 'synchronous_standby_names',
               'wal_writer_delay', 'commit_delay')
ORDER BY name;`,
      explain: `<p>Empty <code>synchronous_standby_names</code> means replication is asynchronous regardless of <code>synchronous_commit</code>. Both settings are <code>sighup</code>/<code>user</code> context, so they can be changed without restart — HA managers rely on that to promote a standby to "sync" dynamically.</p>`,
      output: ` name                      | setting | context   | short_desc
---------------------------+---------+-----------+---------------------------------------------
 commit_delay              | 0       | superuser | Sets the delay in microseconds between ...
 synchronous_commit        | on      | user      | Sets the current transaction's synchronization level.
 synchronous_standby_names |         | sighup    | Number of synchronous standbys and list of names ...
 wal_writer_delay          | 200     | sighup    | Time between WAL flushes performed in the WAL writer.`, run: true },
    { label: 'Intermediate', title: 'Mixing durability levels per transaction',
      sql: `-- High-value write: wait for the sync standby to APPLY (read-your-writes on replica)
BEGIN;
SET LOCAL synchronous_commit = remote_apply;
INSERT INTO audit_logs (table_name, operation, row_id, new_data, changed_by)
VALUES ('payments', 'INSERT', 4586, '{"amount": 1999.00}', 'payment-api');
SHOW synchronous_commit;
COMMIT;

-- Low-value write: don't even wait for the local WAL flush
BEGIN;
SET LOCAL synchronous_commit = off;
INSERT INTO audit_logs (table_name, operation, row_id, new_data, changed_by)
VALUES ('products', 'UPDATE', 17, '{"views": 1}', 'clickstream');
COMMIT;

SHOW synchronous_commit;   -- back to the session default`,
      explain: `<p><code>SET LOCAL</code> lasts only until the end of the transaction, so a connection pool never leaks the setting to the next user. In the sandbox there are no standbys, so both commits complete instantly, but the semantics are exactly what you would deploy: payments wait for the standby to replay; clickstream does not even wait for its own fsync (a crash may lose that row, but never corrupts the database or reorders it with respect to synchronous commits).</p>`,
      output: `BEGIN
SET
INSERT 0 1
 synchronous_commit
--------------------
 remote_apply
COMMIT
BEGIN
SET
INSERT 0 1
COMMIT
 synchronous_commit
--------------------
 on`, run: true },
    { label: 'Advanced', title: 'Who is synchronous right now, and who is waiting?',
      sql: `-- Which standbys count for the commit guarantee?
SELECT application_name, sync_priority, sync_state,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), flush_lsn)) AS flush_lag_bytes,
       flush_lag, replay_lag
FROM pg_stat_replication
ORDER BY sync_priority, application_name;

-- Which sessions are stuck waiting for a synchronous standby?
SELECT pid, usename, state, wait_event_type, wait_event,
       now() - xact_start AS waiting_for,
       left(query, 60) AS query
FROM pg_stat_activity
WHERE wait_event = 'SyncRep';`,
      explain: `<p><code>sync_state</code>: <code>sync</code> (counted with FIRST), <code>quorum</code> (candidate with ANY), <code>potential</code> (would become sync if a higher priority one disappears), <code>async</code>. If you configured FIRST 1 and see no <code>sync</code> row, every write is blocked: the second query will show sessions in <code>wait_event = 'SyncRep'</code>. This pair of queries is the first thing to run when "all writes hang but reads work".</p>`,
      output: `(0 rows)   -- sandbox; production example:
 application_name | sync_priority | sync_state | flush_lag_bytes | flush_lag
------------------+---------------+------------+-----------------+-----------------
 pg_b             | 1             | quorum     | 0 bytes         | 00:00:00.000912
 pg_c             | 1             | quorum     | 16 kB           | 00:00:00.001104
 pg_dr            | 0             | async      | 52 MB           | 00:00:00.612000

(0 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `# Single synchronous standby, priority mode
synchronous_standby_names = 'pg_b'
synchronous_commit = on`, why: 'pg_b reboots for a kernel patch → every write transaction on the primary hangs in SyncRep until it is back. Your "HA" setup turned a standby restart into a full write outage.', run: false },
    good: { sql: `# Quorum over two nearby standbys, async DR elsewhere
synchronous_standby_names = 'ANY 1 (pg_b, pg_c)'
synchronous_commit = on
# pg_dr (other region) not listed → async`, why: 'Either AZ standby can acknowledge; one can be patched or lost without blocking writes, and the distant DR replica never adds its 70 ms RTT to commits.', run: false }
  },
  mistakes: [
    'Configuring a single synchronous standby and discovering during patching that writes block when it is down.',
    'Believing a cancelled SyncRep wait rolls back the transaction — it is already committed locally and visible on the primary.',
    'Making a cross-region DR replica synchronous and then wondering why every commit takes 80 ms.',
    'Using <code>synchronous_commit = off</code> globally to "speed up" a database that stores payments — it trades away durability of the last ~0.6 s of commits on crash.',
    'Expecting <code>remote_write</code> to be as safe as <code>on</code>; a simultaneous primary loss and standby OS crash can still lose data.',
    'Mismatched names: <code>synchronous_standby_names</code> lists <code>pg_b</code> but the standby connects with <code>application_name=walreceiver</code> — nothing ever becomes sync and commits block.'
  ],
  best: [
    'Prefer <code>ANY n</code> quorum across at least n+1 standbys in different failure domains (AZs).',
    'Keep synchronous standbys close (same region, &lt;2 ms RTT); keep distant DR replicas async.',
    'Set durability per workload: <code>ALTER ROLE etl SET synchronous_commit = local</code>; <code>SET LOCAL synchronous_commit = remote_apply</code> for transactions whose next read goes to a replica.',
    'Let the HA manager (e.g. Patroni <code>synchronous_mode</code>) own <code>synchronous_standby_names</code> so failover and replica loss update it consistently.',
    'Alert on sessions waiting in <code>SyncRep</code> for more than a few seconds.'
  ],
  performance: `<p>Synchronous commit adds at least one network round trip plus the standby's fsync to every write transaction: same-AZ ≈ 0.1-0.3 ms, cross-AZ ≈ 0.5-2 ms, cross-region 30-150 ms. With <code>remote_apply</code> you also wait for replay, which can be much slower under load. Throughput is less affected than latency if you have concurrency: many backends wait in parallel and are released together by one standby acknowledgement (group effect). Single-threaded batch jobs committing row by row suffer most — 10,000 commits × 1.5 ms = 15 extra seconds; batch them or use <code>SET LOCAL synchronous_commit = local</code> where appropriate. <code>synchronous_commit = off</code> can multiply small-transaction throughput several-fold on slow disks because commits no longer wait for fsync.</p>`,
  security: `<p>Durability is a business/security control: regulated ledgers often require RPO = 0 documented and tested. Document which roles may lower <code>synchronous_commit</code> (any user can <code>SET</code> it for their own session — it is a <code>user</code>-context parameter). If that is unacceptable, review application code and use <code>ALTER ROLE ... SET</code> defaults plus code review; there is no way to forbid a session from lowering it.</p>`,
  scenario: { title: 'All writes hang at 02:10 while reads work fine', steps: [
    '1. pg_stat_activity shows 380 sessions with wait_event = SyncRep; reads are unaffected.',
    '2. pg_stat_replication shows only pg_dr (async). The sync standby pg_b is missing: its VM was rebooted by an automated patch job.',
    '3. Immediate mitigation (if business accepts temporary async): ALTER SYSTEM SET synchronous_standby_names = \'\'; SELECT pg_reload_conf(); — blocked sessions are released immediately.',
    '4. When pg_b reconnects and catches up (state = streaming, lag ≈ 0), restore the setting.',
    '5. Permanent fix: add pg_c in another AZ and switch to ANY 1 (pg_b, pg_c); coordinate patch windows so at most one sync candidate restarts at a time; or let Patroni synchronous_mode manage the list.'
  ] },
  widgets: ['diagram:streaming-replication', 'diagram:ha'],
  interview: [
    { q: 'Explain FIRST 1 (a, b) vs ANY 1 (a, b).', a: 'FIRST 1 is priority-based: the first listed connected standby (a) is the synchronous one; b only becomes synchronous if a is gone. ANY 1 is quorum: a commit is released as soon as any one of the listed standbys confirms. ANY is usually faster (takes the quickest ack) and more resilient to a slow standby.' },
    { q: 'What guarantee does synchronous_commit = remote_apply add over on?', a: 'With on, the standby has durably flushed the WAL, so no data loss on failover, but the change may not yet be visible to queries on that standby. remote_apply waits until it has been replayed, so a subsequent read on that standby sees the write (read-your-writes), at higher latency.' },
    { q: 'A client times out waiting for a synchronous commit and retries the transaction. What can go wrong?', a: 'The original transaction was already committed locally (and may be replicated later); the cancel only stopped the wait. Retrying a non-idempotent insert can create a duplicate payment. Use idempotency keys or unique constraints so retries are safe.' },
    { q: 'Why does PostgreSQL not automatically fall back to async when the sync standby disappears?', a: 'Because that would silently break the RPO = 0 promise: transactions committed during the fallback could be lost on a subsequent failover. PostgreSQL chooses consistency (blocking) and leaves the availability decision to the operator or HA manager.' }
  ],
  exercises: [
    { task: 'Within one transaction set synchronous_commit to remote_write and prove it applies only inside that transaction.', solution: `BEGIN;
SET LOCAL synchronous_commit = remote_write;
SHOW synchronous_commit;
COMMIT;
SHOW synchronous_commit;`, run: true },
    { task: 'Write a query showing every session currently waiting for synchronous replication, with how long its transaction has been open.', solution: `SELECT pid, usename, application_name, now() - xact_start AS open_for, left(query, 80) AS query
FROM pg_stat_activity
WHERE wait_event = 'SyncRep';`, run: true }
  ],
  challenge: { task: 'Your company wants RPO = 0 for payments, tolerance of one AZ failure without write blocking, and DR in a far region. Three AZs (A primary, B, C) plus region R. Write the synchronous_standby_names value and explain which application_names you would give, and write the SQL the payment service should run so its follow-up read on a replica always sees its write.', hint: 'Quorum across B and C; R not listed; per-transaction remote_apply.', solution: `-- postgresql.conf (primary, and identical on candidates for after failover):
-- synchronous_standby_names = 'ANY 1 (pg_az_b, pg_az_c, pg_az_a)'
--   (listing all three lets the same config work whichever node is primary;
--    a node never counts itself)
-- pg_dr_region_r is not listed → asynchronous

-- payment service, per transaction:
BEGIN;
SET LOCAL synchronous_commit = remote_apply;
INSERT INTO audit_logs (table_name, operation, row_id, new_data, changed_by)
VALUES ('payments', 'INSERT', 1, '{"status":"success"}', 'payment-api');
COMMIT;`, run: true },
  related: ['replication-streaming', 'failover-split-brain', 'high-availability', 'scaling-read-replicas'],
  quiz: [
    { type: 'mcq', q: 'synchronous_standby_names = \'ANY 2 (s1, s2, s3)\'. When does a commit return (synchronous_commit = on)?', options: ['When s1 and s2 have flushed', 'When any two of the three have flushed the WAL', 'When all three have replayed', 'Immediately; ANY means asynchronous'], answer: 1, explain: 'ANY n is quorum commit: any n listed standbys must confirm the flush.' },
    { type: 'tf', q: 'If the only synchronous standby disconnects, PostgreSQL automatically switches to asynchronous replication.', answer: false, explain: 'Commits block (wait_event SyncRep) until a synchronous standby is available or the configuration is changed.' },
    { type: 'predict', q: 'What does the final SHOW return?', code: `SET synchronous_commit = local;
BEGIN;
SET LOCAL synchronous_commit = off;
COMMIT;
SHOW synchronous_commit;`, options: ['off', 'local', 'on', 'remote_apply'], answer: 1, explain: 'SET LOCAL reverts at transaction end to the session value, which is local.' },
    { type: 'design', q: 'Primary in Mumbai, a standby in the same region, and a DR standby in Singapore (60 ms RTT). Requirement: no data loss on single-node failure, commit p99 under 10 ms. Best config?', options: ['FIRST 1 (singapore)', 'ANY 1 (mumbai_standby, singapore)', 'Mumbai standby synchronous (ideally a second nearby standby in ANY 1), Singapore async', 'All async'], answer: 2, explain: 'Any sync wait involving Singapore costs 60 ms. Keep sync replication local; ANY 1 with Singapore would usually be fine but risks 60 ms whenever the local one is slow.' }
  ]
},
{
  id: 'replication-logical',
  module: 'replication',
  title: 'Logical Replication: Publications, Subscriptions, Row Filters and CDC',
  level: 5,
  minutes: 35,
  summary: 'Row-level replication with CREATE PUBLICATION / SUBSCRIPTION, PG15+ row filters and column lists, replica identity, and using it for zero-downtime upgrades, selective sync and CDC — plus its hard limitations (DDL, sequences).',
  objectives: [
    'Explain how logical decoding turns WAL into row changes and how pgoutput delivers them',
    'Create publications (table lists, schemas, row filters, column lists) and subscriptions',
    'Choose a correct REPLICA IDENTITY and understand why UPDATE/DELETE can fail without it',
    'Plan a major-version upgrade or migration with logical replication',
    'Handle limitations: DDL, sequences, large objects, conflicts',
    'Monitor subscriptions and resolve apply conflicts'
  ],
  concept: `<p><strong>Logical replication</strong> <span class="tag core">core</span> (PG10+) replicates <em>row changes</em> — "INSERT into orders (id=5001, customer_id=42, ...)", "UPDATE customers SET city='Pune' WHERE id=7" — instead of physical page images. A <strong>publication</strong> on the source defines <em>what</em> to send; a <strong>subscription</strong> on the target connects, copies the initial data, and then applies a continuous change stream.</p>
<p><strong>Analogy:</strong> physical replication is photocopying every page of a ledger as it is written; logical replication is a clerk reading the ledger and phoning another office: "add this customer", "change that order's status". The other office can keep its own extra books, use a newer ledger format (major version), or only want calls about Indian customers.</p>
<p>Because the target is an ordinary read-write database, logical replication enables things physical replication cannot:</p>
<ul><li><strong>Major-version upgrades</strong> with minutes of downtime (PG14 → PG18): replicate into the new cluster, then switch the application.</li>
<li><strong>Selective sync</strong>: only some tables, only some rows (row filters, PG15+), only some columns (column lists, PG15+) — e.g. ship non-PII customer columns to an analytics DB.</li>
<li><strong>Consolidation / fan-in</strong>: several regional databases publish into one reporting database.</li>
<li><strong>CDC</strong> (change data capture) to Kafka/data lakes through tools like Debezium <span class="tag tool">third-party tool</span> that consume the same logical decoding stream.</li>
<li><strong>Writable targets</strong>: the subscriber can have extra indexes, extra tables, different partitioning.</li></ul>
<p>The source must have <code>wal_level = logical</code> (restart required). Each subscription uses a <em>logical replication slot</em> on the publisher. Initial sync copies each table with <code>COPY</code> in parallel workers (<code>max_sync_workers_per_subscription</code>), then switches to streaming.</p>
<div class="callout warn"><strong>Hard limitations:</strong> DDL is <em>not</em> replicated (apply schema changes on the subscriber first, then the publisher); <strong>sequence values are not replicated</strong> (after cutover, set them with <code>setval</code>); large objects are not replicated; the target tables must already exist with compatible columns; UPDATE/DELETE need a <strong>replica identity</strong> (a primary key by default).</div>`,
  why: `<p>Physical replication is all-or-nothing and version-locked. Businesses need to move a subset of data between systems, upgrade major versions without hours of <code>pg_dump</code>/<code>pg_upgrade</code> downtime, feed downstream analytics in real time, and split monoliths into services with their own databases. Before PG10 that required trigger-based tools (Slony, Londiste, Bucardo) that doubled write cost. Logical replication reads changes from the WAL that is written anyway, so the publisher's overhead is decoding CPU, not extra writes per row.</p>`,
  useCase: `<p>A retailer upgrades a 3.4 TB <code>company_db</code> from PG13 to PG18. A <code>pg_dump</code>/<code>pg_restore</code> would take ~9 hours; <code>pg_upgrade --link</code> is fast but has no fallback once the new cluster writes. They (1) build an empty PG18 cluster with the schema (<code>pg_dump --schema-only</code>), (2) <code>CREATE PUBLICATION upg FOR ALL TABLES</code> on PG13, (3) <code>CREATE SUBSCRIPTION</code> on PG18 — initial copy takes 6 hours while production runs, (4) wait until lag is ~0, (5) during a 4-minute window stop writes, verify row counts, run generated <code>setval</code> statements for all sequences, point PgBouncer to PG18. They also keep a reverse subscription (PG18 → PG13, <code>origin = none</code>) ready for rollback. In parallel, a second publication with a <strong>row filter</strong> ships only <code>country = 'India'</code> customers and their orders to a GST-reporting database in another account, and a <strong>column list</strong> excludes <code>email</code> from the analytics copy.</p>`,
  internals: `<p><strong>Decoding.</strong> A walsender running for the subscription reads WAL through its logical slot and the <code>pgoutput</code> output plugin reassembles each transaction's changes (in memory up to <code>logical_decoding_work_mem</code>, spilling to disk beyond it, or <em>streaming</em> in-progress large transactions when the subscription has <code>streaming = on/parallel</code>). Only <strong>committed</strong> transactions are applied, in commit order. To decode, it needs the catalog as it was at that point in time — hence <code>catalog_xmin</code> on the slot.</p>
<p><strong>Replica identity.</strong> An UPDATE/DELETE in WAL must say <em>which</em> row changed. <code>REPLICA IDENTITY DEFAULT</code> logs the old primary key; <code>USING INDEX idx</code> uses a unique, non-partial, NOT NULL index; <code>FULL</code> logs the whole old row (heavy WAL, and the subscriber must find the row — PG16+ can use a suitable index, otherwise a sequential scan per change!); <code>NOTHING</code> logs nothing. A published table without a usable identity <strong>rejects UPDATE/DELETE on the publisher</strong> with "cannot update table ... because it does not have a replica identity and publishes updates". With a row filter or column list, the columns referenced must be covered by the replica identity when UPDATE/DELETE are published.</p>
<p><strong>Apply.</strong> On the subscriber a logical replication <em>apply worker</em> applies changes as normal DML (triggers fire only if set <code>ENABLE REPLICA</code>/<code>ALWAYS</code>; constraints are checked). A unique violation or missing-table error stops the apply worker, which retries in a loop; the slot on the publisher then retains WAL. PG15+ can <code>disable_on_error</code>, and <code>ALTER SUBSCRIPTION ... SKIP (lsn = ...)</code> skips the failing transaction. PG16+: <code>origin = none</code> avoids ping-pong loops in bidirectional setups, <code>streaming = parallel</code> applies large transactions with parallel workers, and logical decoding works on standbys. PG17: <code>pg_createsubscriber</code> converts a physical standby into a logical subscriber without an initial copy, and <code>pg_upgrade</code> preserves slots and subscriptions.</p>`,
  whenNot: `<ul><li><strong>Plain HA/failover of the whole cluster</strong> → physical streaming replication: simpler, replicates DDL, sequences and everything else, lower lag.</li>
<li><strong>Very high write rates with huge transactions</strong> and strict lag needs → decoding and single-apply-worker throughput may not keep up (parallel streaming in PG16+ helps for large transactions).</li>
<li><strong>Frequent DDL / schema churn</strong> → every migration must be coordinated on both sides; forgotten steps break replication.</li>
<li><strong>Tables without primary keys</strong> where you need UPDATE/DELETE → add a PK first; <code>REPLICA IDENTITY FULL</code> is a last resort.</li>
<li><strong>Multi-master conflict-free writes</strong> → core PostgreSQL has no conflict resolution beyond "stop and error"; bidirectional setups must partition write ownership.</li></ul>`,
  syntax: `-- Publisher (wal_level = logical)
CREATE PUBLICATION name
  FOR TABLE t1 [ (col, ...) ] [ WHERE (expr) ] [, ...]
  | FOR TABLES IN SCHEMA s [, ...]
  | FOR ALL TABLES
  [ WITH (publish = 'insert, update, delete, truncate', publish_via_partition_root = false) ];
ALTER PUBLICATION name ADD TABLE t2;
ALTER TABLE t REPLICA IDENTITY { DEFAULT | USING INDEX idx | FULL | NOTHING };

-- Subscriber (tables must already exist)
CREATE SUBSCRIPTION name
  CONNECTION 'host=pub-host dbname=company_db user=repl_user'
  PUBLICATION pub_name
  [ WITH (copy_data = true, streaming = parallel, origin = any, disable_on_error = false) ];
ALTER SUBSCRIPTION name REFRESH PUBLICATION;   -- pick up newly added tables
ALTER SUBSCRIPTION name SKIP (lsn = '0/14C0378');`,
  examples: [
    { label: 'Basic', title: 'Publish the order pipeline tables',
      sql: `CREATE PUBLICATION pub_orders FOR TABLE orders, order_items, payments;

SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'pub_orders'
ORDER BY tablename;

SELECT pubname, pubinsert, pubupdate, pubdelete, pubtruncate
FROM pg_publication WHERE pubname = 'pub_orders';`,
      explain: `<p>A publication is just catalog metadata — creating it costs nothing and sends nothing until a subscription (or another logical consumer) connects through a slot. By default it publishes all four operation types. The sandbox runs with <code>wal_level = replica</code>, so the publication can be created and inspected but not consumed; in production set <code>wal_level = logical</code> first (restart).</p>`,
      output: ` pubname    | schemaname | tablename
------------+------------+-------------
 pub_orders | public     | order_items
 pub_orders | public     | orders
 pub_orders | public     | payments

 pubname    | pubinsert | pubupdate | pubdelete | pubtruncate
------------+-----------+-----------+-----------+-------------
 pub_orders | t         | t         | t         | t`, run: true },
    { label: 'Intermediate', title: 'Row filter + column list (PG15+): India-only, no PII',
      sql: `-- Insert-only feed of Indian customers without email (PII stays home)
CREATE PUBLICATION pub_in_customers
  FOR TABLE customers (id, name, country, city, segment, created_at)
  WHERE (country = 'India')
  WITH (publish = 'insert');

SELECT pubname, tablename, attnames, rowfilter
FROM pg_publication_tables
WHERE pubname = 'pub_in_customers';

-- How many rows would the initial copy send?
SELECT count(*) AS rows_in_initial_sync
FROM customers WHERE country = 'India';`,
      explain: `<p>The column list removes <code>email</code> from both the initial copy and the change stream; the row filter evaluates on each change. Why <code>publish = 'insert'</code>? Because if UPDATE or DELETE are published, every column used in the <code>WHERE</code> filter (here <code>country</code>) must be part of the <strong>replica identity</strong> (normally just <code>id</code>) — otherwise PostgreSQL rejects every <code>UPDATE customers</code> on the publisher with <em>"cannot update table customers — Column used in the publication WHERE expression is not part of the replica identity"</em>. Alternatives: <code>REPLICA IDENTITY FULL</code> on the table, or filter only on PK columns.</p>`,
      output: ` pubname          | tablename | attnames                                      | rowfilter
------------------+-----------+-----------------------------------------------+---------------------------
 pub_in_customers | customers | {id,name,country,city,segment,created_at}     | (country = 'India'::text)

 rows_in_initial_sync
----------------------
                  188`, run: true },
    { label: 'Advanced', title: 'Cutover kit: replica identity check and sequence sync script',
      sql: `-- 1. Which published tables can't replicate UPDATE/DELETE safely?
SELECT c.relname,
       CASE c.relreplident WHEN 'd' THEN 'default (PK)' WHEN 'f' THEN 'full'
                           WHEN 'i' THEN 'index' WHEN 'n' THEN 'nothing' END AS replica_identity,
       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary) AS has_pk
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY has_pk, c.relname;

-- 2. Sequences are NOT replicated: generate setval() for the subscriber at cutover
SELECT format('SELECT setval(%L, %s, true);',
              schemaname || '.' || sequencename,
              COALESCE(last_value, 1) + 1000)     -- safety gap
FROM pg_sequences
WHERE schemaname = 'public'
ORDER BY sequencename;`,
      explain: `<p>Part 1 lists tables whose replica identity is <code>default</code> but that lack a primary key — those would break UPDATE/DELETE once published. Part 2 is the standard cutover step: after writes stop on the old primary, run these generated statements on the new one, adding a gap so identity columns never collide (the gap also tells you at a glance which IDs were created after cutover). In the subscriber, CREATE SUBSCRIPTION itself is not runnable in this sandbox (no network/libpqwalreceiver), but the SQL shown here is.</p>`,
      output: ` relname           | replica_identity | has_pk
-------------------+------------------+--------
 audit_logs        | default (PK)     | t
 customers         | default (PK)     | t
 ... (all company_db tables have primary keys)

 format
---------------------------------------------------------------
 SELECT setval('public.audit_logs_id_seq', 1330, true);
 SELECT setval('public.customers_id_seq', 1528, true);
 SELECT setval('public.departments_id_seq', 1033, true);
 ... (11 rows)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Publish a table that has no primary key
CREATE TABLE page_views (url text, viewed_at timestamptz);
CREATE PUBLICATION pv FOR TABLE page_views;
-- later: UPDATE page_views SET url = lower(url);
-- ERROR: cannot update table "page_views" because it does not have
--        a replica identity and publishes updates`, why: 'The publisher itself starts rejecting UPDATE/DELETE statements — the application breaks on the primary, not only the replica.', run: false },
    good: { sql: `CREATE TABLE page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text, viewed_at timestamptz);
CREATE PUBLICATION pv FOR TABLE page_views;
UPDATE page_views SET url = lower(url);`, why: 'A primary key gives a compact, indexed replica identity: only the key is logged for UPDATE/DELETE and the subscriber finds rows by index.', run: true }
  },
  mistakes: [
    'Forgetting sequences at cutover: the first INSERT on the new primary fails with duplicate key on <code>id</code>.',
    'Running a migration (<code>ALTER TABLE ADD COLUMN</code>) on the publisher first — the subscriber\'s apply worker errors on the unknown column and replication stops while the slot retains WAL.',
    'Using a row filter on a non-replica-identity column while publishing UPDATE/DELETE, which makes UPDATEs fail on the publisher.',
    'Using <code>REPLICA IDENTITY FULL</code> on big tables without a usable index on the subscriber: each UPDATE becomes a sequential scan there.',
    'Dropping a subscription while the publisher is unreachable with <code>slot_name</code> still set — then manually forgetting the orphan slot on the publisher.',
    'Assuming writes on the subscriber are prevented — they are allowed and will cause conflicts (duplicate keys) with replicated rows.'
  ],
  best: [
    'Ensure every published table has a primary key; audit with a catalog query before publishing.',
    'Apply DDL to the subscriber first (additive changes), then the publisher; for column drops reverse the order.',
    'Use <code>publish_via_partition_root = true</code> when publishing partitioned tables to a differently partitioned (or unpartitioned) target.',
    'Monitor <code>pg_stat_subscription</code> / <code>pg_stat_subscription_stats</code> (apply errors) on the subscriber and slot lag on the publisher.',
    'Rehearse upgrades end-to-end: initial copy time, lag catch-up, sequence sync, row-count/checksum validation, rollback path.',
    'Use <code>origin = none</code> (PG16+) for bidirectional replication to prevent loops, and give each node exclusive write ownership of its rows.'
  ],
  performance: `<p>Publisher cost: decoding CPU in the walsender (roughly proportional to WAL volume of published and unpublished tables, since all WAL is read), plus <code>wal_level = logical</code> adding slightly more WAL. Large transactions spill to disk above <code>logical_decoding_work_mem</code>; use <code>streaming = parallel</code> (PG16+) to stream them before commit. Subscriber cost: one apply worker per subscription applying changes serially — throughput per subscription is often 5-30k rows/s depending on indexes. Split very hot tables into separate subscriptions to parallelize (but cross-subscription ordering is not guaranteed). Initial sync uses <code>COPY</code> per table; very large tables dominate — consider <code>pg_createsubscriber</code> (PG17) from a physical standby to skip the copy entirely.</p>`,
  security: `<p>The subscription connection user needs the <code>REPLICATION</code> attribute (or superuser) and <code>SELECT</code> on published tables. Since PG16 the apply worker runs as the subscription <em>owner</em> (with <code>run_as_owner = false</code> by default it switches to the table owner) — understand this before letting non-superusers create subscriptions (<code>pg_create_subscription</code> role, PG16+). Column lists and row filters are a good way to keep PII out of downstream systems; document them as data-protection controls. Use TLS in <code>CONNECTION</code> strings and store passwords outside SQL if possible (<code>passfile</code>).</p>`,
  scenario: { title: 'Logical replication stopped after a deployment; publisher disk is filling', steps: [
    '1. Publisher: slot "sub_analytics" retained WAL grows 2 GB/hour, active = true but confirmed_flush_lsn is not moving.',
    '2. Subscriber log: ERROR: logical replication target relation "public.orders" is missing replicated column: "discount_code". The deploy ran ALTER TABLE orders ADD COLUMN discount_code text on the publisher only.',
    '3. Fix: run the same ALTER TABLE on the subscriber; the apply worker retries automatically and catches up.',
    '4. If an apply error is caused by a conflicting row (duplicate key), either delete the conflicting row on the subscriber or use ALTER SUBSCRIPTION sub_analytics SKIP (lsn = ...) with the LSN from the error context — accepting that the skipped transaction is lost there.',
    '5. Prevent: migration tooling applies DDL to subscribers first; CI check that every published table has a PK; alert on pg_stat_subscription_stats.apply_error_count and on slot lag.'
  ] },
  widgets: ['diagram:logical-replication', 'diagram:wal'],
  interview: [
    { q: 'How would you upgrade a 5 TB database from PG13 to PG18 with minimal downtime?', a: 'Create the PG18 cluster with the schema, publish all tables on PG13 (wal_level = logical), subscribe from PG18 and let the initial copy and streaming catch up. At cutover, stop writes, wait for zero lag, validate counts, setval all sequences on PG18, and switch connections (e.g. via PgBouncer). Keep a reverse replication path for rollback. Alternatively pg_createsubscriber can avoid the initial copy.' },
    { q: 'Why can an UPDATE on the publisher fail because of a publication?', a: 'If the table publishes UPDATE/DELETE, PostgreSQL must log a replica identity for the old row. With no PK and REPLICA IDENTITY DEFAULT, or a row filter/column list referencing columns not covered by the replica identity, the UPDATE is rejected on the publisher.' },
    { q: 'What is not replicated by logical replication?', a: 'DDL, sequence values, large objects, and (before PG18) generated column values are not replicated; views/materialized views are not replicated as such. TRUNCATE is replicated since PG11. Schema changes must be applied manually on both sides and sequences synced at cutover.' },
    { q: 'Physical vs logical replication: which for HA, and why?', a: 'Physical for HA: it replicates everything including DDL and sequences, has lower overhead and lag, and the standby is an exact promotable copy. Logical is for selective sync, cross-version moves, consolidation and CDC.' }
  ],
  exercises: [
    { task: 'Create a publication for all tables of the public schema, then count how many tables it covers.', solution: `CREATE PUBLICATION pub_all_public FOR TABLES IN SCHEMA public;
SELECT count(*) AS published_tables
FROM pg_publication_tables WHERE pubname = 'pub_all_public';`, run: true },
    { task: 'Publish only enterprise customers (inserts only), excluding email, and show the row filter as PostgreSQL stored it.', solution: `CREATE PUBLICATION pub_enterprise
  FOR TABLE customers (id, name, country, segment) WHERE (segment = 'enterprise')
  WITH (publish = 'insert');
SELECT tablename, attnames, rowfilter
FROM pg_publication_tables WHERE pubname = 'pub_enterprise';`, run: true },
    { task: 'Change employee_projects (composite PK) to use its primary key index explicitly as replica identity, then show relreplident.', solution: `ALTER TABLE employee_projects REPLICA IDENTITY USING INDEX employee_projects_pkey;
SELECT relname, relreplident FROM pg_class WHERE relname = 'employee_projects';`, run: true }
  ],
  challenge: { task: 'Generate a complete cutover verification script: for every public table produce one SQL statement that returns the table name and its row count, so it can be run on both publisher and subscriber and diffed.', hint: 'Use format() with %I for identifiers and string_agg to join the statements with UNION ALL.', solution: `SELECT string_agg(
         format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I', c.relname, n.nspname, c.relname),
         E'\\nUNION ALL\\n' ORDER BY c.relname) || ';' AS verification_sql
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');`, run: true },
  related: ['replication-slots', 'replication-streaming', 'partitioning', 'scaling'],
  quiz: [
    { type: 'tf', q: 'ALTER TABLE ... ADD COLUMN on the publisher is automatically applied on subscribers.', answer: false, explain: 'DDL is not replicated by logical replication; apply it to subscribers yourself (usually first).' },
    { type: 'mcq', q: 'Which minimum PostgreSQL version supports row filters and column lists in publications?', options: ['PG10', 'PG13', 'PG15', 'PG17'], answer: 2, explain: 'Row filters (WHERE) and column lists in CREATE PUBLICATION arrived in PostgreSQL 15.' },
    { type: 'bug', q: 'After this, every UPDATE of customers fails on the publisher. Why?', code: `CREATE PUBLICATION p FOR TABLE customers WHERE (country = 'India');`, options: ['Row filters cannot use text columns', 'The publication publishes UPDATE/DELETE, and country is not part of the replica identity (the PK)', 'wal_level must be minimal', 'customers has no primary key'], answer: 1, explain: 'With UPDATE/DELETE published, filter columns must be covered by the replica identity. Publish inserts only, use REPLICA IDENTITY FULL, or filter on key columns.' },
    { type: 'scenario', q: 'After cutting over to the new cluster, the first INSERT into orders fails with duplicate key value violates unique constraint "orders_pkey". Cause?', options: ['Logical replication corrupted the index', 'Sequences/identity counters were not replicated; the new cluster\'s sequence starts at an old value', 'The row filter was wrong', 'The subscriber still had the subscription enabled'], answer: 1, explain: 'Sequence state is not replicated; run setval() for every sequence on the new primary at cutover.' },
    { type: 'mcq', q: 'What does a logical replication publisher need that a physical-only primary does not?', options: ['wal_level = logical', 'hot_standby = on', 'archive_mode = on', 'max_connections > 1000'], answer: 0, explain: 'Logical decoding requires wal_level = logical (restart required).' }
  ]
}
]);
PGM.addLessons([
/* ======================================================================
   MODULE: high-availability (3)
   ====================================================================== */
{
  id: 'high-availability-fundamentals',
  module: 'high-availability',
  title: 'HA Fundamentals: RPO, RTO, Nines, Single Points of Failure and Connection Routing',
  level: 5,
  minutes: 25,
  summary: 'The vocabulary and arithmetic of high availability — RPO/RTO, availability nines, eliminating single points of failure, and routing reads and writes to the right PostgreSQL node.',
  objectives: [
    'Define RPO and RTO and map them to PostgreSQL mechanisms (sync/async replication, backups, failover automation)',
    'Convert availability percentages into allowed downtime per year/month',
    'Identify single points of failure across database, network, storage, DNS, pooler and people',
    'Explain how clients find the primary: VIP, DNS, proxy (HAProxy), or libpq multi-host strings',
    'Design read/write routing with read replicas and know its consistency cost'
  ],
  concept: `<p><strong>High availability (HA)</strong> means the database service keeps working — or recovers quickly and automatically — when components fail. PostgreSQL core gives you the building blocks (replication, promotion, <code>pg_rewind</code>); turning them into an HA <em>system</em> needs failure detection, leader election, client routing and fencing, usually from third-party tools.</p>
<p><strong>Analogy:</strong> a hospital's emergency power. RPO is "how much work in progress may be lost when the lights go out" (unsaved patient notes); RTO is "how many seconds until the generator is running". Nines are the yearly budget of minutes the lights may be off. A generator with a single fuel line is still a single point of failure.</p>
<ul>
<li><strong>RPO — Recovery Point Objective</strong>: maximum acceptable data loss, measured in time. Async replication → RPO ≈ replication lag (ms to minutes). Synchronous replication → RPO = 0 for single-node failure. Restore from backup + WAL archive → RPO = time since last archived WAL segment (<code>archive_timeout</code>).</li>
<li><strong>RTO — Recovery Time Objective</strong>: maximum acceptable time to restore service. Automated failover to a hot standby: 10-60 s. Manual failover at 3 a.m.: 15-45 min. Restoring a 2 TB backup: hours.</li>
<li><strong>Availability</strong> = uptime / total time, expressed in "nines". 99.9% allows ~8.8 hours/year of downtime; 99.99% allows ~53 minutes/year — less than one manual failover per year.</li>
<li><strong>Single point of failure (SPOF)</strong>: any component whose failure alone stops the service. Classic hidden SPOFs: one PgBouncer VM, one HAProxy, one DNS record with a 1-hour TTL, the etcd cluster of 2 nodes, a shared SAN, a single AZ, and the one DBA who knows the runbook.</li>
</ul>
<p><strong>Read replicas and routing.</strong> Clients must reach the <em>current</em> primary for writes and may use replicas for reads. Options: (1) a <strong>virtual IP</strong> that moves to the primary (same L2 network; vip-manager, keepalived <span class="tag tool">third-party tool</span>); (2) <strong>DNS</strong> update (simple, but TTL caching delays clients); (3) a <strong>proxy</strong> such as HAProxy <span class="tag tool">third-party tool</span> that health-checks nodes and forwards port 5000 → primary, 5001 → replicas; (4) <strong>client-side</strong> libpq multi-host connection strings with <code>target_session_attrs=read-write</code> <span class="tag core">core</span> (libpq tries hosts in order and keeps the first writable one); (5) Kubernetes Services maintained by an operator.</p>`,
  why: `<p>Hardware fails (a disk every few years per server, a whole AZ every few years per region), software is patched (a kernel update needs a reboot) and people make mistakes. Without HA, each of these is an outage measured in the time it takes a human to notice, diagnose and rebuild. Business requirements are expressed as RPO/RTO and SLA percentages; HA architecture is how a DBA turns those into concrete replicas, sync settings and automation — and how they explain the cost of each extra nine.</p>`,
  useCase: `<p>A food-delivery app processes ~1,800 orders/minute at dinner peak. Product sets an SLA of 99.95% (≈ 4.4 h/year) and says "losing even a confirmed order is unacceptable" (RPO = 0). The DBA designs: primary + two standbys in three AZs, <code>ANY 1</code> synchronous quorum, Patroni for automatic failover (RTO ≈ 30 s), HAProxy pair behind a cloud load balancer, PgBouncer on each app host, and pgBackRest backups to object storage for disasters beyond the cluster. Planned maintenance is done by <em>switchover</em> (≈ 5 s write pause) so it barely consumes the downtime budget.</p>`,
  internals: `<p>An HA system is a control loop: <strong>detect</strong> (health checks on PostgreSQL, network and host), <strong>decide</strong> (is the primary really dead, or am I partitioned? — needs a quorum/consensus store), <strong>act</strong> (promote the most up-to-date standby, fence the old primary, re-point clients), <strong>repair</strong> (rewind or re-clone the old primary as a standby). Total RTO = detection time (e.g. Patroni <code>ttl</code> 30 s) + decision + promotion (a few seconds: end recovery, checkpoint, new timeline) + client re-routing (health-check interval × fall count, DNS TTL, pool reconnects).</p>
<p>The data-loss side: when the primary dies, transactions it acknowledged but that no standby received are lost. Choosing the standby with the highest received/replayed LSN minimizes loss; Patroni's <code>maximum_lag_on_failover</code> refuses to promote a standby lagging more than a threshold (trading RTO for RPO).</p>`,
  whenNot: `<ul><li>Internal tools with 99% SLAs: a single instance with good backups and a tested restore may be cheaper and simpler. HA automation adds failure modes of its own (false failovers, split brain).</li>
<li>Don't confuse HA with backups: HA protects against node failure, not against <code>DROP TABLE</code>, corruption replicated to standbys, or ransomware.</li>
<li>Don't route reads to replicas by default if the app expects read-your-writes everywhere; start with the primary and add replica reads deliberately.</li></ul>`,
  syntax: `-- RPO/RTO knobs (core PostgreSQL)
synchronous_standby_names = 'ANY 1 (pg_b, pg_c)'   -- RPO 0
archive_timeout = '60s'                             -- bounds RPO for archive-only recovery
-- client routing with libpq (core)
postgresql://app@pg-a:5432,pg-b:5432,pg-c:5432/company_db?target_session_attrs=read-write
postgresql://app@pg-b:5432,pg-c:5432/company_db?target_session_attrs=prefer-standby&load_balance_hosts=random`,
  examples: [
    { label: 'Basic', title: 'What each nine really costs in downtime',
      sql: `SELECT nines,
       pct || '%' AS availability,
       round((1 - pct / 100) * 365.25 * 24 * 60, 1) AS downtime_min_per_year,
       round((1 - pct / 100) * 30 * 24 * 60, 1)     AS downtime_min_per_month
FROM (VALUES (2, 99.0), (3, 99.9), (4, 99.99), (5, 99.999)) AS v(nines, pct)
ORDER BY nines;`,
      explain: `<p>Each extra nine divides the downtime budget by ten. At 99.99% you have ~4.3 minutes per month — a single manual failover (page, wake up, log in, diagnose, promote) does not fit; automation is mandatory. At 99.999% even automated failover (30 s) can occur only ~10 times a year, and planned maintenance must be zero-downtime.</p>`,
      output: ` nines | availability | downtime_min_per_year | downtime_min_per_month
-------+--------------+-----------------------+------------------------
     2 | 99.0%        |                5259.6 |                  432.0
     3 | 99.9%        |                 526.0 |                   43.2
     4 | 99.99%       |                  52.6 |                    4.3
     5 | 99.999%      |                   5.3 |                    0.4`, run: true },
    { label: 'Intermediate', title: 'A routing health check that also reports replica freshness',
      sql: `SELECT CASE WHEN pg_is_in_recovery() THEN 'replica' ELSE 'primary' END AS role,
       current_setting('transaction_read_only')                         AS read_only,
       CASE WHEN pg_is_in_recovery()
            THEN round(extract(epoch FROM now() - pg_last_xact_replay_timestamp())::numeric, 1)
       END AS replica_staleness_s,
       (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend') AS client_connections;`,
      explain: `<p>Routing layers need three facts: is this node writable, how stale is it (on a replica, time since the last replayed transaction; beware it also grows when the primary is simply idle), and is it overloaded. A proxy or service mesh can take a node out of the read pool when staleness exceeds, say, 5 seconds. On the sandbox (a primary) staleness is NULL.</p>`,
      output: ` role    | read_only | replica_staleness_s | client_connections
---------+-----------+---------------------+--------------------
 primary | off       |                     |                  0
(the sandbox runs as a single embedded backend, so no 'client backend' rows)`, run: true },
    { label: 'Advanced', title: 'RTO budget calculator for an automated failover',
      sql: `WITH params(component, seconds) AS (
  VALUES ('leader key TTL expiry (detection)',          30),
         ('election + choose most advanced standby',     2),
         ('promotion: end recovery + checkpoint',        3),
         ('HAProxy health check: inter 3s x fall 3',     9),
         ('application pool reconnect / retries',        5)
)
SELECT component, seconds,
       sum(seconds) OVER (ORDER BY seconds DESC ROWS UNBOUNDED PRECEDING) AS cumulative_s
FROM params
UNION ALL
SELECT 'TOTAL RTO (worst case, approx.)', sum(seconds), NULL FROM params;`,
      explain: `<p>RTO is a sum of timers, not a single number. This model makes the trade-offs visible: lowering Patroni's <code>ttl</code> from 30 s to 10 s speeds detection but increases false failovers during network blips; tightening HAProxy checks speeds re-routing but makes flapping more likely. Present this table to the business when they ask for "zero downtime".</p>`,
      output: ` component                                 | seconds | cumulative_s
-------------------------------------------+---------+--------------
 leader key TTL expiry (detection)         |      30 |           30
 HAProxy health check: inter 3s x fall 3   |       9 |           39
 application pool reconnect / retries      |       5 |           44
 promotion: end recovery + checkpoint      |       3 |           47
 election + choose most advanced standby   |       2 |           49
 TOTAL RTO (worst case, approx.)           |      49 |`, run: true }
  ],
  compare: {
    bad: { sql: `# "HA" design reviewed in an incident post-mortem
app servers -> pgbouncer-01 (single VM) -> pg-primary
                                        \\-> pg-standby (manual promotion runbook)
DNS: db.internal  A  10.0.1.10   TTL 3600`, why: 'The pooler VM is a SPOF, failover depends on a human, and clients cache the old IP for up to an hour after the DNS change — real RTO measured in hours.', run: false },
    good: { sql: `# Redundant at every layer
app servers (PgBouncer sidecar each) -> HAProxy x2 (behind cloud LB / VIP)
   -> port 5000: health check GET /primary  -> current leader only
   -> port 5001: health check GET /replica  -> healthy standbys
Patroni + 3-node etcd across 3 AZs; pg-a / pg-b / pg-c in 3 AZs`, why: 'No single component (pooler, proxy, DCS node, database node, AZ) can take the service down; detection and promotion are automated.', run: false }
  },
  mistakes: [
    'Quoting RPO = 0 while running asynchronous replication.',
    'Ignoring the RTO contribution of clients: DNS TTLs, JVM DNS caching, connection pools that never re-resolve.',
    'Two-node etcd/Consul clusters — losing either node loses quorum, which makes the HA layer itself less available.',
    'Testing failover only once, at go-live. Failover paths rot as configs drift.',
    'Sending all reads to replicas without handling replication lag (users don\'t see the comment they just posted).'
  ],
  best: [
    'Write down RPO/RTO per data class and derive replication mode, standby count and automation from them.',
    'Eliminate SPOFs layer by layer: compute, storage, AZ, pooler, proxy, DCS, DNS, credentials, people (runbooks).',
    'Prefer client routing that does not depend on DNS TTLs: VIP, proxy, or multi-host libpq strings.',
    'Run game days: kill the primary, partition the network, fill the disk, and measure actual RPO/RTO.',
    'Keep backups and PITR as the last line of defense independent of the HA cluster.'
  ],
  performance: `<p>HA itself costs little throughput: physical replication overhead is small, and health checks are trivial queries/HTTP calls. The measurable cost is commit latency if synchronous replication is used (one RTT per commit) and capacity: standbys sized like the primary are "idle" insurance — use them for reads to earn their keep, but never load the HA standby so heavily that it falls behind or cannot absorb the primary's load after failover.</p>`,
  security: `<p>HA components expand the attack surface: DCS (etcd) can decide who is primary — protect it with TLS and authentication; Patroni's REST API can trigger switchovers — restrict it; HAProxy stats pages leak topology. Replication credentials must be present on every node. Ensure standbys and backups receive the same security patches, encryption and auditing as the primary, because any of them may become the primary.</p>`,
  scenario: { title: 'The business asks for "five nines" for the order database', steps: [
    '1. Translate: 99.999% = 5.3 minutes/year. One unplanned failover of 45 s plus four planned switchovers of 10 s already uses ~1.4 minutes.',
    '2. Inventory SPOFs: single AZ, single PgBouncer, DNS TTL 300 s. Each alone could blow the budget.',
    '3. Propose a tiered answer: 99.99% (52 min/year) with 3-AZ Patroni cluster, quorum sync replication, redundant HAProxy and pooler — realistic and testable.',
    '4. Show the cost of 99.999%: multi-region active-active design, application-level conflict handling, strict deployment discipline — weeks of engineering and ongoing complexity.',
    '5. Agree on RPO = 0 within region, RPO ≤ 1 minute cross-region, RTO ≤ 60 s, and quarterly failover drills with measured results.'
  ] },
  widgets: ['diagram:ha', 'diagram:read-replica'],
  interview: [
    { q: 'Define RPO and RTO and give a PostgreSQL mechanism that controls each.', a: 'RPO is the maximum acceptable data loss (time); synchronous replication gives RPO 0 for node failure, async gives RPO ≈ lag, archive-based recovery bounds it via archive_timeout. RTO is the maximum time to restore service; automated failover (Patroni) gives tens of seconds, manual failover minutes, restoring from backup hours.' },
    { q: 'How can an application always connect to the current primary without a proxy?', a: 'Use a libpq multi-host connection string with target_session_attrs=read-write (or primary): libpq tries each host and keeps the first one that accepts writes. JDBC has targetServerType=primary, Npgsql Target Session Attributes. Combine with short connect_timeout and retries.' },
    { q: 'List hidden single points of failure in a typical PostgreSQL HA deployment.', a: 'A single PgBouncer or HAProxy instance, a DCS with fewer than 3 nodes or all in one AZ, shared storage, DNS records with long TTLs, a single network path between AZs, certificates expiring together, and runbooks known by only one person.' }
  ],
  exercises: [
    { task: 'Calculate the yearly downtime budget in minutes for 99.95% availability.', solution: `SELECT round((1 - 99.95 / 100) * 365.25 * 24 * 60, 1) AS downtime_min_per_year;`, run: true },
    { task: 'Write the query a read-pool health check would run to decide whether a node is a replica and its replay is fresher than 5 seconds (returns false on a primary).', solution: `SELECT pg_is_in_recovery()
       AND COALESCE(now() - pg_last_xact_replay_timestamp() < interval '5 seconds', false) AS healthy_replica;`, run: true }
  ],
  challenge: { task: 'Given incidents (minutes of downtime) for last year, compute achieved availability and whether a 99.95% SLA was met.', hint: 'Sum minutes, divide by minutes in a year, subtract from 1.', solution: `WITH incidents(cause, minutes) AS (
  VALUES ('AZ network partition', 12), ('failed upgrade rollback', 95),
         ('disk full from abandoned slot', 41), ('planned switchover x4', 2)
)
SELECT sum(minutes) AS total_down_min,
       round(100 * (1 - sum(minutes) / (365.25 * 24 * 60)), 4) AS achieved_pct,
       (100 * (1 - sum(minutes) / (365.25 * 24 * 60))) >= 99.95 AS met_99_95
FROM incidents;`, run: true },
  related: ['high-availability-patroni', 'high-availability-prod-architecture', 'failover', 'replication-sync-async'],
  quiz: [
    { type: 'mcq', q: 'Your primary fails; with async replication the best standby was 800 ms behind. What is the actual RPO of this event?', options: ['0', 'About 800 ms of committed transactions', 'The time until promotion', 'One WAL segment'], answer: 1, explain: 'Transactions acknowledged in the last ~800 ms never reached the standby and are lost when it is promoted.' },
    { type: 'tf', q: '99.99% availability allows roughly 52 minutes of downtime per year.', answer: true, explain: '0.0001 × 525,960 min ≈ 52.6 minutes.' },
    { type: 'scenario', q: 'Failover completed in 20 s, but some app servers kept failing for 30 minutes. Most likely cause?', options: ['The new primary was corrupt', 'Clients resolved a DNS name with a long TTL or a JVM DNS cache kept the old IP', 'Synchronous replication was enabled', 'Autovacuum'], answer: 1, explain: 'Client-side routing caches (DNS TTL, JVM networkaddress.cache.ttl, pools that never reconnect) often dominate real RTO.' },
    { type: 'mcq', q: 'Which libpq parameter makes a multi-host connection string connect only to a writable server?', options: ['sslmode=require', 'target_session_attrs=read-write', 'load_balance_hosts=disable', 'application_name=primary'], answer: 1, explain: 'target_session_attrs=read-write (or primary) skips hosts that are read-only/in recovery.' }
  ]
},
{
  id: 'high-availability-patroni',
  module: 'high-availability',
  title: 'Patroni, etcd, HAProxy and Kubernetes Operators: Automating PostgreSQL HA',
  level: 5,
  minutes: 35,
  summary: 'How Patroni (third-party) uses a distributed consensus store for leader election, how HAProxy routes using Patroni health endpoints, where PgBouncer belongs, and how CloudNativePG / Zalando operators do the same on Kubernetes.',
  objectives: [
    'Explain leader election with a DCS (etcd, Consul, ZooKeeper, Kubernetes API) and the leader key TTL',
    'Read and write a production patroni.yml (bootstrap.dcs, postgresql, tags, synchronous_mode)',
    'Configure HAProxy health checks against Patroni REST endpoints (/primary, /replica)',
    'Decide where PgBouncer sits relative to HAProxy and Patroni',
    'Compare Patroni on VMs with Kubernetes operators (CloudNativePG, Zalando postgres-operator)',
    'Perform switchovers and inspect cluster state with patronictl'
  ],
  concept: `<p>PostgreSQL core can <em>promote</em> a standby but has no built-in mechanism to decide <em>when</em> and <em>which</em> one, or to stop the old primary from accepting writes. <strong>Patroni</strong> <span class="tag tool">third-party tool</span> (open source, by Zalando) fills that gap. A Patroni daemon runs next to each PostgreSQL instance, manages its lifecycle (start, stop, configure, promote, rewind, re-clone) and coordinates with the other daemons through a <strong>DCS — Distributed Configuration Store</strong>: etcd, Consul, ZooKeeper <span class="tag tool">third-party tool</span>, or the Kubernetes API.</p>
<p><strong>Analogy:</strong> the DCS is a talking stick held by the current leader with a timer on it. The leader must keep re-grabbing the stick every <code>loop_wait</code> seconds; if it fails to refresh it within <code>ttl</code> seconds, the stick drops and the healthiest follower may grab it. Because the stick lives in a consensus system (Raft in etcd/Consul), only one node can hold it, even if the network splits.</p>
<ul>
<li><strong>Leader key</strong>: <code>/service/&lt;scope&gt;/leader</code> with a TTL (default 30 s). The primary's Patroni renews it every <code>loop_wait</code> (10 s). If the primary's Patroni cannot reach the DCS for <code>retry_timeout</code>, it <strong>demotes its own PostgreSQL to read-only</strong> — self-fencing, the core split-brain protection.</li>
<li><strong>Election</strong>: when the key expires, replicas race to acquire it; each checks it is healthy and not lagging more than <code>maximum_lag_on_failover</code> bytes (and, in synchronous mode, that it was a synchronous standby). The winner runs <code>pg_promote</code>; others follow the new timeline (using <code>pg_rewind</code> if needed, when <code>use_pg_rewind: true</code>).</li>
<li><strong>REST API</strong> (port 8008): <code>GET /primary</code> returns 200 only on the leader; <code>GET /replica</code> returns 200 on healthy streaming replicas (optionally <code>?lag=16MB</code>); <code>/health</code>, <code>/read-only</code> etc. These endpoints are what load balancers check.</li>
<li><strong>synchronous_mode</strong>: Patroni manages <code>synchronous_standby_names</code> itself and only fails over to a node that was synchronous, guaranteeing no acknowledged commit is lost.</li>
<li><strong>Watchdog</strong>: optional Linux <code>/dev/watchdog</code> integration resets a node whose Patroni hangs while holding the leader role.</li>
</ul>
<p><strong>HAProxy</strong> <span class="tag tool">third-party tool</span> is a TCP proxy: clients connect to it on port 5000 (writes) / 5001 (reads); it health-checks every node's Patroni REST API and forwards only to nodes answering 200 on the relevant endpoint. <strong>PgBouncer</strong> <span class="tag tool">third-party tool</span> multiplexes connections (see Connection Pooling) and is usually placed either beside each app (sidecar) pointing at HAProxy, or on the DB nodes behind HAProxy.</p>
<p>On <strong>Kubernetes</strong>, operators <span class="tag tool">third-party tool</span> encode the same logic as controllers: <strong>CloudNativePG</strong> (CNCF project) manages a <code>Cluster</code> resource with its own instance manager (no Patroni), uses the Kubernetes API as the source of truth, and exposes Services <code>&lt;name&gt;-rw</code>, <code>&lt;name&gt;-ro</code>, <code>&lt;name&gt;-r</code>; the <strong>Zalando postgres-operator</strong> runs Spilo images, i.e. Patroni inside pods with Kubernetes as DCS. Crunchy PGO also uses Patroni.</p>`,
  why: `<p>Manual failover means minutes to hours of downtime and is error prone under stress — the classic fatal mistake is promoting a standby while the old primary is still alive (split brain). Patroni-style automation provides fast, consistent decisions backed by a consensus store, safe self-demotion, and a uniform API for switchovers, restarts and config changes. It turns the RTO from "the time to wake someone" into "ttl + a few seconds".</p>`,
  useCase: `<p>A SaaS company runs 40 PostgreSQL clusters on VMs: each cluster has three nodes across three AZs, Patroni with a shared 5-node etcd cluster (one etcd per AZ plus two more), HAProxy pairs behind a cloud TCP load balancer, and PgBouncer sidecars in each application pod. Patching: <code>patronictl switchover --leader pg-a --candidate pg-b</code> moves the primary in ~4 seconds of write unavailability, then pg-a is patched and rejoined. A year later they move new clusters to Kubernetes with CloudNativePG: same architecture (3 instances, sync quorum, backups to object storage) described in a 40-line YAML manifest.</p>`,
  internals: `<p>Each Patroni runs a loop every <code>loop_wait</code> seconds (the "HA cycle"): read cluster state from the DCS, check local PostgreSQL, then act. The leader updates the leader key with a compare-and-set on its own name; failure to update within <code>ttl</code> lets it expire. Replicas publish their status (xlog position, tags such as <code>nofailover</code>, <code>noloadbalance</code>, <code>clonefrom</code>) as member keys. Global settings in <code>bootstrap.dcs</code> are written to the DCS at cluster creation and afterwards changed with <code>patronictl edit-config</code> (Patroni applies PostgreSQL parameters and reloads/restarts as needed — pending restarts are flagged).</p>
<p>Timing constraint: <code>loop_wait + 2 × retry_timeout ≤ ttl</code> so that a primary that loses the DCS demotes itself <em>before</em> its key could expire and a new leader be elected. Defaults are ttl 30, loop_wait 10, retry_timeout 10.</p>
<p>HAProxy's <code>on-marked-down shutdown-sessions</code> kills existing client connections to a node that stops being primary, forcing clients to reconnect through the proxy to the new one instead of lingering on a demoted (read-only) node.</p>`,
  whenNot: `<ul><li>Managed services (Amazon RDS/Aurora, Cloud SQL, Azure Flexible Server) already include failover — don't layer Patroni on top.</li>
<li>Single-node dev/test environments: unnecessary complexity.</li>
<li>Teams without the capacity to operate etcd/Consul properly — a flaky DCS causes more outages than it prevents; prefer a managed service or an operator with the Kubernetes API as DCS.</li>
<li>repmgr <span class="tag tool">third-party tool</span> or pg_auto_failover <span class="tag tool">third-party tool</span> are alternatives; avoid mixing two HA managers on one cluster.</li></ul>`,
  syntax: `# patronictl (third-party CLI)
patronictl -c /etc/patroni/patroni.yml list
patronictl -c /etc/patroni/patroni.yml switchover --leader pg-a --candidate pg-b --force
patronictl -c /etc/patroni/patroni.yml failover --candidate pg-c
patronictl -c /etc/patroni/patroni.yml edit-config      # change DCS-level settings
patronictl -c /etc/patroni/patroni.yml restart orders-cluster pg-b
curl -s -o /dev/null -w '%{http_code}' http://pg-a:8008/primary   # 200 on leader, 503 elsewhere`,
  examples: [
    { label: 'Basic', title: 'A production patroni.yml (one node)',
      sql: `scope: orders-cluster          # cluster name = DCS namespace key
name: pg-a                     # unique per node
restapi:
  listen: 0.0.0.0:8008
  connect_address: 10.0.1.10:8008
etcd3:
  hosts: 10.0.1.5:2379,10.0.2.5:2379,10.0.3.5:2379
bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576     # bytes; don't promote a laggard
    synchronous_mode: true               # Patroni manages synchronous_standby_names
    postgresql:
      use_pg_rewind: true
      use_slots: true                    # Patroni-managed physical slots
      parameters:
        wal_level: replica
        hot_standby: "on"
        max_wal_senders: 10
        max_replication_slots: 10
        wal_log_hints: "on"              # needed by pg_rewind (or data checksums)
        max_slot_wal_keep_size: 100GB
postgresql:
  listen: 0.0.0.0:5432
  connect_address: 10.0.1.10:5432
  data_dir: /var/lib/postgresql/18/main
  authentication:
    replication: { username: replicator, password: "from-secret-store" }
    superuser:   { username: postgres,   password: "from-secret-store" }
watchdog:
  mode: automatic                        # use /dev/watchdog if available
tags:
  nofailover: false
  noloadbalance: false`,
      explain: `<p>Identical on all nodes except <code>name</code> and addresses. <code>bootstrap.dcs</code> is only used when the cluster is first initialized; later changes go through <code>patronictl edit-config</code>. <code>use_slots</code> makes Patroni create a slot per replica automatically (and drop it when the member disappears). <code>synchronous_mode</code> plus <code>maximum_lag_on_failover</code> express the RPO policy. Third-party YAML — not runnable SQL.</p>`,
      output: `$ patronictl -c /etc/patroni/patroni.yml list
+ Cluster: orders-cluster ----+--------------+-----------+----+-----------+
| Member | Host      | Role         | State     | TL | Lag in MB |
+--------+-----------+--------------+-----------+----+-----------+
| pg-a   | 10.0.1.10 | Leader       | running   |  4 |           |
| pg-b   | 10.0.2.10 | Sync Standby | streaming |  4 |         0 |
| pg-c   | 10.0.3.10 | Replica      | streaming |  4 |         0 |
+--------+-----------+--------------+-----------+----+-----------+`, run: false },
    { label: 'Intermediate', title: 'haproxy.cfg routing writes and reads via Patroni health checks',
      sql: `global
    maxconn 4000
defaults
    mode tcp
    timeout connect 4s
    timeout client  30m
    timeout server  30m
    timeout check   5s

listen stats
    mode http
    bind 127.0.0.1:7000
    stats enable
    stats uri /

listen primary                       # applications write here
    bind *:5000
    option httpchk OPTIONS /primary
    http-check expect status 200
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server pg-a 10.0.1.10:5432 maxconn 500 check port 8008
    server pg-b 10.0.2.10:5432 maxconn 500 check port 8008
    server pg-c 10.0.3.10:5432 maxconn 500 check port 8008

listen replicas                      # read-only traffic
    bind *:5001
    balance leastconn
    option httpchk OPTIONS /replica?lag=16MB
    http-check expect status 200
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server pg-a 10.0.1.10:5432 maxconn 500 check port 8008
    server pg-b 10.0.2.10:5432 maxconn 500 check port 8008
    server pg-c 10.0.3.10:5432 maxconn 500 check port 8008`,
      explain: `<p>HAProxy proxies the PostgreSQL port (5432) but health-checks the Patroni REST port (8008). On port 5000 exactly one server is "UP" (the leader); on 5001 the healthy replicas lagging less than 16 MB. <code>inter 3s fall 3</code> means a node is marked down after ~9 s of failed checks; <code>shutdown-sessions</code> kills established connections to a node that just lost the leader role. Run two HAProxy instances (with keepalived VIP or a cloud LB) so HAProxy is not a SPOF.</p>`,
      output: `HAProxy stats (port 7000):
primary   pg-a  UP     pg-b  DOWN (503)  pg-c  DOWN (503)
replicas  pg-a  DOWN   pg-b  UP          pg-c  UP`, run: false },
    { label: 'Advanced', title: 'The SQL behind a custom health check (and what Patroni verifies)',
      sql: `-- What a role-aware health endpoint must establish
SELECT CASE WHEN pg_is_in_recovery() THEN 'replica' ELSE 'primary' END AS role,
       current_setting('in_hot_standby')        AS in_hot_standby,     -- PG14+, reported to libpq
       current_setting('transaction_read_only') AS read_only,
       (SELECT timeline_id FROM pg_control_checkpoint()) AS timeline,
       CASE WHEN pg_is_in_recovery()
            THEN pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())
       END AS replay_backlog_bytes,
       (SELECT setting FROM pg_settings WHERE name = 'synchronous_standby_names') AS sync_names;`,
      explain: `<p>Patroni does more than this (it also checks DCS membership and leader-key ownership — a writable PostgreSQL that does <em>not</em> hold the leader key must not get traffic), but this is the PostgreSQL-side truth. The timeline is useful to spot a node that missed a failover: all healthy members should report the same timeline. Note the sandbox is a primary, so replica-only columns are NULL.</p>`,
      output: ` role    | in_hot_standby | read_only | timeline | replay_backlog_bytes | sync_names
---------+----------------+-----------+----------+----------------------+------------
 primary | off            | off       |        1 |                      |`, run: true }
  ],
  compare: {
    bad: { sql: `# HAProxy health check by TCP connect only
listen primary
    bind *:5000
    server pg-a 10.0.1.10:5432 check
    server pg-b 10.0.2.10:5432 check backup`, why: 'A TCP check only proves the port is open: a demoted read-only node, or an isolated old primary, still passes and receives writes. "backup" ordering is not leadership.', run: false },
    good: { sql: `listen primary
    bind *:5000
    option httpchk OPTIONS /primary
    http-check expect status 200
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server pg-a 10.0.1.10:5432 check port 8008
    server pg-b 10.0.2.10:5432 check port 8008`, why: 'Only the node holding the DCS leader key returns 200 on /primary, so writes follow leadership decisions made by consensus.', run: false }
  },
  mistakes: [
    'Running etcd on the same three DB nodes without considering that a DB node failure also removes a DCS member (acceptable with 3 AZs, risky with 2).',
    'Two-AZ deployments: a 2+1 etcd split means losing the AZ with 2 members stops elections entirely.',
    'Setting <code>ttl</code> very low (e.g. 5 s) to "fail over faster" — network jitter then causes unnecessary failovers.',
    'Editing <code>postgresql.conf</code> directly on a Patroni node — Patroni overwrites it; use <code>patronictl edit-config</code> or the <code>postgresql.parameters</code> section.',
    'Pointing applications directly at node IPs instead of HAProxy/VIP/service names, bypassing all routing logic.',
    'Forgetting <code>wal_log_hints</code> or checksums, so <code>pg_rewind</code> cannot run and every failover requires a full re-clone of the old primary.'
  ],
  best: [
    'Use 3 or 5 DCS members in at least 3 failure domains; monitor DCS latency and health like a database.',
    'Enable <code>synchronous_mode</code> where RPO = 0 is required; tune <code>maximum_lag_on_failover</code> otherwise.',
    'Use <code>patronictl switchover</code> for all planned maintenance and rehearse <code>failover</code> quarterly.',
    'Run HAProxy (or the pooler tier) redundantly; health-check Patroni endpoints, not TCP ports.',
    'Label operators and tools clearly in runbooks: Patroni, HAProxy, PgBouncer, CloudNativePG are third-party; know their versions and upgrade paths.',
    'On Kubernetes, use an operator rather than hand-built StatefulSets; pin storage classes and anti-affinity across zones.'
  ],
  performance: `<p>Patroni's own overhead is negligible (a loop every 10 s, a few DCS writes). HAProxy adds ~tens of microseconds per packet and handles tens of thousands of connections per instance; its <code>maxconn</code> per server should not exceed PostgreSQL's capacity — combine with PgBouncer so thousands of client connections become a few hundred server connections. Synchronous mode adds the usual commit RTT. DCS performance matters: etcd needs low-latency fsync disks; slow etcd → leader key renewal failures → spurious demotions.</p>`,
  security: `<p>Secure the DCS (etcd client TLS + auth): anyone able to write the leader key can redirect your writes. Protect the Patroni REST API with TLS and authentication for unsafe methods (switchover, restart, reload) — Patroni supports <code>restapi.authentication</code> and certificates. Store replication and superuser passwords in a secret store and inject them; never commit them in YAML. Restrict HAProxy stats to localhost or authenticated users.</p>`,
  scenario: { title: 'Planned kernel patching of a 3-node Patroni cluster during business hours', steps: [
    '1. patronictl list: pg-a Leader, pg-b Sync Standby, pg-c Replica, lag 0, all on timeline 4.',
    '2. Patch replicas first: patronictl restart is not enough for a kernel — stop Patroni on pg-c (it stops PostgreSQL), patch, reboot, start; wait for streaming and lag 0. Repeat for pg-b.',
    '3. patronictl switchover --leader pg-a --candidate pg-b: Patroni checkpoints, demotes pg-a, promotes pg-b (timeline 5); HAProxy marks pg-b UP on :5000 within ~6 s; shutdown-sessions closes old write connections; apps reconnect via retry logic.',
    '4. Patch and reboot pg-a; it rejoins as a replica of pg-b (pg_rewind if needed).',
    '5. Optional: switch back. Record measured write unavailability (typically 3-10 s) in the maintenance log.'
  ] },
  widgets: ['diagram:ha', 'diagram:prod-cluster', 'diagram:pgbouncer'],
  interview: [
    { q: 'How does Patroni prevent two primaries during a network partition?', a: 'Leadership is a key with a TTL in a consensus-based DCS; only one member can hold it. A primary that cannot renew the key within retry_timeout demotes itself to read-only before the key expires (loop_wait + 2*retry_timeout <= ttl). Optional watchdog resets a hung node. Load balancers route by /primary, which only the key holder answers with 200.' },
    { q: 'Why does HAProxy health-check port 8008 instead of 5432?', a: 'Port 5432 being open says nothing about role. Patroni REST endpoints encode cluster-level truth (/primary only on the DCS leader, /replica for healthy replicas within a lag limit), so routing follows consensus decisions.' },
    { q: 'Compare CloudNativePG with Patroni-based operators.', a: 'CloudNativePG uses its own instance manager and the Kubernetes API server as the source of truth (no Patroni, no separate DCS), and exposes -rw/-ro/-r Services. Zalando postgres-operator and Crunchy PGO run Patroni inside pods, typically using Kubernetes objects as DCS. All automate failover, replicas and backups declaratively.' },
    { q: 'Where would you put PgBouncer in a Patroni + HAProxy architecture?', a: 'Commonly as a sidecar or local process on each app host pointing to the HAProxy write/read ports — this scales with the app and survives failover since HAProxy re-routes. Alternatively on each DB node behind HAProxy, so HAProxy checks Patroni and forwards to the local PgBouncer. Avoid a single central PgBouncer VM (SPOF).' }
  ],
  exercises: [
    { task: 'Write the query you would add to a monitoring check to confirm every node reports the same timeline (run it here to see this node\'s timeline).', solution: `SELECT timeline_id, redo_wal_file FROM pg_control_checkpoint();`, run: true },
    { task: 'Verify pg_rewind prerequisites on this node: is wal_log_hints on, or are data checksums enabled?', solution: `SELECT current_setting('wal_log_hints') AS wal_log_hints,
       current_setting('data_checksums') AS data_checksums,
       current_setting('wal_log_hints') = 'on' OR current_setting('data_checksums') = 'on' AS rewind_possible;`, run: true }
  ],
  challenge: { task: 'Check the Patroni timing rule loop_wait + 2 × retry_timeout ≤ ttl for several candidate configurations and flag unsafe ones.', hint: 'Use VALUES with (ttl, loop_wait, retry_timeout).', solution: `SELECT ttl, loop_wait, retry_timeout,
       loop_wait + 2 * retry_timeout AS demote_deadline,
       loop_wait + 2 * retry_timeout <= ttl AS safe
FROM (VALUES (30, 10, 10), (20, 10, 10), (15, 5, 5), (10, 5, 5)) AS c(ttl, loop_wait, retry_timeout);`, run: true },
  related: ['high-availability-fundamentals', 'high-availability-prod-architecture', 'failover-switchover-promote', 'connection-pooling'],
  quiz: [
    { type: 'mcq', q: 'What does Patroni use to make sure only one node is the leader?', options: ['PostgreSQL advisory locks', 'A leader key with TTL in a consensus DCS such as etcd', 'Multicast heartbeats', 'The pg_hba.conf file'], answer: 1, explain: 'The DCS provides linearizable compare-and-set on the leader key; only its holder may run as primary.' },
    { type: 'tf', q: 'Patroni is part of core PostgreSQL.', answer: false, explain: 'Patroni is a third-party open-source tool (Python), as are HAProxy, PgBouncer, etcd and the Kubernetes operators.' },
    { type: 'bug', q: 'Why might this HAProxy config send writes to a read-only node after failover?', code: `listen primary
    bind *:5000
    server pg-a 10.0.1.10:5432 check
    server pg-b 10.0.2.10:5432 check backup`, options: ['maxconn missing', 'TCP checks only test port reachability, not leadership', 'mode tcp is wrong', 'Port 5000 is reserved'], answer: 1, explain: 'Use HTTP checks against Patroni /primary on port 8008.' },
    { type: 'mcq', q: 'In CloudNativePG, which Service should an application use for writes?', options: ['<cluster>-ro', '<cluster>-r', '<cluster>-rw', 'Any pod IP'], answer: 2, explain: 'The operator keeps <cluster>-rw pointed at the current primary; -ro targets replicas, -r any instance.' },
    { type: 'scenario', q: 'etcd runs on 2 nodes in AZ1 and 1 node in AZ2. AZ1 loses power. What happens?', options: ['Failover to AZ2 proceeds', 'etcd loses quorum (1 of 3), no leader can be elected, and Patroni keeps/sets PostgreSQL read-only', 'Both AZs become primary', 'Nothing; etcd is optional'], answer: 1, explain: 'Quorum needs a majority (2 of 3). Spread DCS members across three failure domains.' }
  ]
},
{
  id: 'high-availability-prod-architecture',
  module: 'high-availability',
  title: 'Production HA Reference Architecture: Multi-AZ, Backups, Monitoring and Runbooks',
  level: 5,
  minutes: 30,
  summary: 'A complete, defensible production PostgreSQL cluster design — three AZs, quorum sync replication, Patroni, redundant routing and pooling, pgBackRest/WAL archiving, monitoring and the runbooks that keep it honest.',
  objectives: [
    'Draw and justify a 3-AZ PostgreSQL HA architecture end to end',
    'Combine HA replication with independent backups and PITR',
    'Define the monitoring signals and alert thresholds for an HA cluster',
    'Write the core runbooks: failover, switchover, re-clone, restore, disk full',
    'Size standbys and network for post-failover load'
  ],
  concept: `<p>A production PostgreSQL deployment is a <em>system</em> of layers, each with redundancy and a clear owner. A widely used reference design for a business-critical OLTP database:</p>
<ol>
<li><strong>Compute &amp; data</strong>: 3 PostgreSQL nodes (same instance type) in 3 availability zones. pg-a primary, pg-b and pg-c hot standbys with physical replication slots.</li>
<li><strong>Durability</strong>: <code>synchronous_standby_names = 'ANY 1 (...)'</code> managed by Patroni <code>synchronous_mode</code> → RPO 0 for single-node/AZ loss.</li>
<li><strong>Coordination</strong>: Patroni <span class="tag tool">third-party tool</span> with a 3-node etcd <span class="tag tool">third-party tool</span> (one per AZ) → automated failover, RTO 30-60 s.</li>
<li><strong>Routing</strong>: 2+ HAProxy <span class="tag tool">third-party tool</span> behind a cloud internal load balancer: :5000 writes, :5001 reads (lag-aware).</li>
<li><strong>Pooling</strong>: PgBouncer <span class="tag tool">third-party tool</span> sidecars/local on app hosts in transaction mode → thousands of clients on a few hundred server connections.</li>
<li><strong>Backups</strong>: pgBackRest or Barman <span class="tag tool">third-party tool</span> — weekly full, daily differential/incremental, continuous WAL archive to object storage in another region, encrypted, with retention (e.g. 30 days PITR). PG17+ also has core incremental backups (<code>pg_basebackup --incremental</code> + <code>pg_combinebackup</code>).</li>
<li><strong>DR</strong>: an async standby (or a standby cluster) in a second region, plus the off-region backups.</li>
<li><strong>Observability</strong>: metrics (postgres_exporter + Prometheus/Grafana or a vendor), logs centralised, <code>pg_stat_statements</code> <span class="tag ext">extension</span>, alerting on the signals below.</li>
<li><strong>Operations</strong>: runbooks, quarterly failover and restore drills, change management through <code>patronictl edit-config</code> and IaC.</li>
</ol>
<p><strong>Analogy:</strong> an airliner: two engines (primary + sync standby), a third for redundancy, autopilot (Patroni), air traffic control (etcd), multiple radios (HAProxy pair), the black box (WAL archive + backups), cockpit instruments (monitoring) and checklists (runbooks). Remove any of them and it might still fly — until the day it can't.</p>`,
  why: `<p>Each layer covers a failure the others cannot: replication covers node loss but replicates mistakes; backups cover mistakes and corruption but restore slowly; DR covers region loss; monitoring catches slow degradations (bloat, lag, disk) before they become outages; runbooks make 3 a.m. decisions consistent. Auditors and enterprise customers increasingly ask for this design explicitly (RPO/RTO evidence, restore test logs).</p>`,
  useCase: `<p>An Indian B2B marketplace (~4 TB, 6k TPS peak, SLA 99.95%, RPO 0 in-region / 5 min cross-region, RTO 60 s / 2 h): three <code>r7i.4xlarge</code>-class nodes in ap-south-1a/b/c with 4 TB gp3 volumes (16k IOPS), Patroni + etcd, HAProxy pair behind an NLB, PgBouncer sidecars; pgBackRest to S3 in ap-south-1 with cross-region replication to ap-southeast-1; an async standby cluster in ap-southeast-1 for DR. Monthly: switchover drill and a timed PITR restore of a random day into a scratch instance (measured 1 h 40 min for 4 TB with parallel restore — within the 2 h DR RTO).</p>`,
  internals: `<p><strong>Post-failover capacity.</strong> After failover one node is gone; the remaining nodes must carry 100% of writes and the read load previously spread over three nodes. Size each node to run the whole workload alone, and cap replica read traffic so that losing one replica doesn't overload the other.</p>
<p><strong>Backups vs replicas.</strong> Backups are taken from a standby (pgBackRest <code>backup-standby=y</code>) to avoid primary I/O, but WAL archiving runs from the primary (<code>archive_command</code>/<code>archive_library</code>); on failover the new primary must also archive — configure <code>archive_mode = on</code> on all nodes (or <code>always</code> on standbys for redundancy).</p>
<p><strong>Key signals.</strong> Replication: lag bytes/time, missing standbys, slot retained WAL. Availability: Patroni leader changes, timeline changes, DCS health. Saturation: connections vs <code>max_connections</code>, PgBouncer <code>cl_waiting</code>, CPU, IOPS, disk % for data and WAL. Health: <code>pg_stat_archiver.failed_count</code>, last successful backup age, transaction ID age (<code>age(datfrozenxid)</code>), long-running transactions, checkpoint frequency (<code>pg_stat_checkpointer</code>), deadlocks, errors in logs.</p>`,
  whenNot: `<ul><li>Small internal apps: a single node + managed backups or a managed service HA tier is more cost-effective.</li>
<li>If you can use a managed service (RDS Multi-AZ, Cloud SQL HA, Azure Flexible HA) and its limits fit, it removes most of the operational layers — but you still own query performance, connection management, schema design and restore testing.</li>
<li>Don't build multi-region <em>active-active</em> writes on core PostgreSQL unless the application partitions write ownership; it is not a drop-in extension of this design.</li></ul>`,
  syntax: `# Minimal per-node essentials (managed through Patroni parameters)
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=orders archive-push %p'   # third-party tool
max_wal_senders = 10
max_replication_slots = 10
max_slot_wal_keep_size = '200GB'
wal_log_hints = on                 # or initdb --data-checksums (default in PG18)
hot_standby_feedback = on          # HA standby only lightly used for reads
shared_preload_libraries = 'pg_stat_statements'`,
  examples: [
    { label: 'Basic', title: 'Is WAL archiving healthy? (the backbone of PITR)',
      sql: `SELECT archived_count,
       last_archived_wal,
       last_archived_time,
       failed_count,
       last_failed_wal,
       last_failed_time,
       CASE WHEN last_failed_time > COALESCE(last_archived_time, '-infinity')
            THEN 'ARCHIVING FAILING' ELSE 'ok' END AS status
FROM pg_stat_archiver;`,
      explain: `<p>If archiving fails, WAL accumulates in <code>pg_wal</code> (PostgreSQL never deletes un-archived WAL) and your PITR window silently stops growing. Alert when the last failure is newer than the last success, or when <code>last_archived_time</code> is older than <code>archive_timeout</code> + margin on a busy system. The sandbox has archiving off, so counts are zero.</p>`,
      output: ` archived_count | last_archived_wal | last_archived_time | failed_count | last_failed_wal | last_failed_time | status
----------------+-------------------+--------------------+--------------+-----------------+------------------+--------
              0 |                   |                    |            0 |                 |                  | ok`, run: true },
    { label: 'Intermediate', title: 'Saturation snapshot: connections, long transactions, wraparound age',
      sql: `SELECT
  (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend') AS client_conns,
  current_setting('max_connections')::int                                          AS max_conns,
  (SELECT count(*) FROM pg_stat_activity
     WHERE state = 'idle in transaction'
       AND now() - state_change > interval '1 minute')                            AS idle_in_txn_over_1m,
  (SELECT max(now() - xact_start) FROM pg_stat_activity
     WHERE xact_start IS NOT NULL)                                                AS longest_txn,
  (SELECT max(age(datfrozenxid)) FROM pg_database)                                AS max_xid_age,
  round(100.0 * (SELECT max(age(datfrozenxid)) FROM pg_database) / 2000000000, 2) AS pct_to_wraparound;`,
      explain: `<p>Five numbers that predict most PostgreSQL outages: connection exhaustion, idle-in-transaction sessions (hold locks and block VACUUM), very long transactions (bloat, replication conflicts, slow failover recovery), and transaction-ID age approaching wraparound protection (~2 billion). Graph them for every node — after failover, a standby becomes the primary with whatever state it has.</p>`,
      output: ` client_conns | max_conns | idle_in_txn_over_1m | longest_txn     | max_xid_age | pct_to_wraparound
--------------+-----------+---------------------+-----------------+-------------+-------------------
            0 |       100 |                   0 | 00:00:00        |           9 |              0.00
(values vary)`, run: true },
    { label: 'Advanced', title: 'CloudNativePG Cluster manifest: the same architecture on Kubernetes',
      sql: `apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: orders
spec:
  instances: 3                       # 1 primary + 2 replicas, spread by anti-affinity
  imageName: ghcr.io/cloudnative-pg/postgresql:18
  primaryUpdateStrategy: unsupervised
  postgresql:
    parameters:
      max_connections: "300"
      shared_buffers: "8GB"
      max_slot_wal_keep_size: "100GB"
    synchronous:
      method: any                    # quorum: ANY 1 (...)
      number: 1
  storage:
    size: 1Ti
    storageClass: gp3-encrypted
  walStorage:
    size: 200Gi                      # WAL on its own volume
  affinity:
    topologyKey: topology.kubernetes.io/zone
  monitoring:
    enablePodMonitor: true
# Services created by the operator: orders-rw (primary), orders-ro (replicas), orders-r (any)
# Backups: configured through the Barman Cloud plugin / ObjectStore resource to S3/GCS/Azure`,
      explain: `<p>The operator <span class="tag tool">third-party tool</span> encodes the reference architecture declaratively: three instances across zones, quorum synchronous replication, separate WAL volume, metrics, and Services that always point at the right role. Exact field names evolve between operator versions — check the version you deploy. Not runnable in the sandbox.</p>`,
      output: `$ kubectl get cluster orders
NAME     AGE   INSTANCES   READY   STATUS                     PRIMARY
orders   12d   3           3       Cluster in healthy state   orders-1`, run: false }
  ],
  compare: {
    bad: { sql: `# "We have replicas, so we don't need backups"
pg-a (primary) --stream--> pg-b, pg-c
archive_mode = off
# 14:02 developer runs: DELETE FROM orders WHERE created_at < now();  -- missing "- interval"`, why: 'The DELETE replays to both standbys within milliseconds. Without WAL archive + base backups there is no way to recover the deleted orders.', run: false },
    good: { sql: `archive_mode = on
archive_command = 'pgbackrest --stanza=orders archive-push %p'
# pgBackRest: full weekly, diff daily, retention 30 days, repo in object storage (other region)
# PITR: restore to 14:01:59 into a scratch cluster, copy back missing rows`, why: 'Independent backups + continuous WAL archiving allow point-in-time recovery to just before the mistake, without touching the HA cluster.', run: false }
  },
  mistakes: [
    'Sizing standbys smaller than the primary to save cost — after failover the smaller node collapses under full load.',
    'Configuring <code>archive_command</code> only on the original primary; after failover the new primary does not archive and PITR breaks.',
    'Never restoring a backup. An untested backup is a hypothesis.',
    'Alerting on everything (alert fatigue) or only on "database down" — the slow failures (lag, slot growth, wraparound age) are missed.',
    'Putting all three nodes in one AZ "for latency" — an AZ outage then takes everything down.',
    'No runbook for "old primary came back" — someone restarts it as a primary and creates split brain.'
  ],
  best: [
    'Three nodes, three AZs, quorum sync replication, automated failover, redundant proxies and poolers.',
    'Backups independent of the cluster, off-region, encrypted, with monthly timed restore tests and documented RTO.',
    'Separate volumes for data and WAL with free-space alerts; cap slot retention.',
    'Infrastructure as code for nodes, Patroni/operator config and monitoring, so rebuilding a node is a routine action.',
    'Track SLOs: availability, p99 latency, replication lag, backup age, restore duration.'
  ],
  performance: `<p>Plan capacity for the degraded state (N-1 nodes). Put WAL on low-latency storage: commit latency = WAL fsync + (sync replication RTT + standby fsync). Take backups from a standby and throttle them (pgBackRest <code>process-max</code>, bandwidth limits) to avoid starving replication. Monitoring itself should be cheap: scrape intervals of 15-30 s and avoid heavy catalog queries on huge schemas every few seconds.</p>`,
  security: `<p>Encrypt everything in transit (TLS between apps ↔ pooler ↔ PostgreSQL, replication, etcd, Patroni REST, backup uploads) and at rest (volumes, backup repositories with pgBackRest repo encryption or object-storage KMS). Least privilege: separate roles for apps, migrations, replication, monitoring (<code>pg_monitor</code> predefined role), backups. Backups contain all data — restrict and audit access, and test restores into isolated networks.</p>`,
  scenario: { title: 'Designing HA for a new payments database from scratch (90-minute design review)', steps: [
    '1. Requirements: RPO 0 in region, RTO ≤ 60 s, 99.95%, 7-year audit retention, PITR 35 days, ~3k TPS growing 2×/year.',
    '2. Topology: 3 nodes × 3 AZs, Patroni synchronous_mode, etcd ×3, HAProxy ×2 behind internal LB, PgBouncer sidecars (transaction mode).',
    '3. Backups: pgBackRest full weekly + diff daily + WAL archive, repo1 in-region S3 (35 days), repo2 cross-region; monthly restore drill.',
    '4. DR: async standby cluster in second region; documented manual promotion with RTO 30 min.',
    '5. Monitoring: lag, slots, archiver, backup age, connections, xid age, disk, Patroni leader changes; paging only for user-impacting or fast-moving signals.',
    '6. Capacity: each node sized for 2× current peak alone; WAL volume 500 GB with max_slot_wal_keep_size 200 GB.',
    '7. Sign-off includes a failover game day before go-live with measured RTO/RPO.'
  ] },
  widgets: ['diagram:prod-cluster', 'diagram:ha', 'diagram:backup-pitr'],
  interview: [
    { q: 'Walk me through a production PostgreSQL HA architecture you would recommend.', a: 'Three nodes in three AZs with physical streaming replication and quorum synchronous commit; Patroni with a 3-node etcd for leader election and automated failover; HAProxy pair (health checks on Patroni /primary and /replica) behind an internal LB; PgBouncer near the apps; pgBackRest backups and WAL archive to off-region object storage; async DR standby in another region; monitoring and runbooks with regular drills.' },
    { q: 'Why do you still need backups if you have two synchronous replicas?', a: 'Replicas copy every change, including accidental deletes, bad migrations and logical corruption, within milliseconds. Backups with WAL archiving enable point-in-time recovery to before the incident and protect against cluster-wide loss.' },
    { q: 'What must be true after a failover for backups to keep working?', a: 'The new primary must archive WAL (archive_mode/archive_command configured on all nodes), the backup tool must follow the new timeline, and monitoring must confirm archiving success and new backups. Otherwise the PITR chain breaks at the failover point.' }
  ],
  exercises: [
    { task: 'Write a query that lists sessions idle in transaction for more than 30 seconds, oldest first.', solution: `SELECT pid, usename, application_name, now() - state_change AS idle_for, left(query, 60) AS last_query
FROM pg_stat_activity
WHERE state = 'idle in transaction' AND now() - state_change > interval '30 seconds'
ORDER BY state_change;`, run: true },
    { task: 'Show checkpoint activity (timed vs requested) from pg_stat_checkpointer (PG17+). Many requested checkpoints suggest max_wal_size is too small.', solution: `SELECT num_timed, num_requested, buffers_written,
       round(100.0 * num_requested / NULLIF(num_timed + num_requested, 0), 1) AS pct_requested
FROM pg_stat_checkpointer;`, run: true }
  ],
  challenge: { task: 'Build a single "cluster health" query that returns one row per check (name, value, status OK/ALERT) for: client connections over 80% of max_connections, archiver failing, any replication slot inactive, transaction ID age over 1 billion.', hint: 'Use UNION ALL of small SELECTs, each computing its own status.', solution: `SELECT 'connections_pct' AS check_name,
       round(100.0 * count(*) / current_setting('max_connections')::int, 1)::text AS value,
       CASE WHEN count(*) > 0.8 * current_setting('max_connections')::int THEN 'ALERT' ELSE 'OK' END AS status
FROM pg_stat_activity WHERE backend_type = 'client backend'
UNION ALL
SELECT 'archiver', failed_count::text,
       CASE WHEN last_failed_time > COALESCE(last_archived_time, '-infinity') THEN 'ALERT' ELSE 'OK' END
FROM pg_stat_archiver
UNION ALL
SELECT 'inactive_slots', count(*)::text, CASE WHEN count(*) > 0 THEN 'ALERT' ELSE 'OK' END
FROM pg_replication_slots WHERE NOT active
UNION ALL
SELECT 'xid_age', max(age(datfrozenxid))::text,
       CASE WHEN max(age(datfrozenxid)) > 1000000000 THEN 'ALERT' ELSE 'OK' END
FROM pg_database;`, run: true },
  related: ['high-availability-patroni', 'backup-restore', 'monitoring', 'failover', 'connection-pooling'],
  quiz: [
    { type: 'mcq', q: 'Which failure does WAL archiving + base backups protect against that replicas cannot?', options: ['Primary hardware failure', 'Accidental DELETE that already replicated', 'Network partition', 'High read load'], answer: 1, explain: 'Replicas faithfully replay mistakes; PITR lets you recover to just before them.' },
    { type: 'tf', q: 'Standbys can be smaller than the primary because they only serve reads.', answer: false, explain: 'Any standby may become the primary and must carry the full workload after failover.' },
    { type: 'design', q: 'Where should backups be taken in a 3-node Patroni cluster to minimise primary impact?', options: ['Always from the primary', 'From a standby (WAL still archived by the primary)', 'From etcd', 'From HAProxy'], answer: 1, explain: 'Tools like pgBackRest support backup-standby to read data files from a replica while coordinating with the primary.' },
    { type: 'scenario', q: 'After a failover, PITR restores fail for any time after the failover. Likely cause?', options: ['Backups were encrypted', 'The new primary was not archiving WAL', 'Too many replicas', 'hot_standby was on'], answer: 1, explain: 'archive_mode/archive_command must be configured on all candidates so the new primary continues the archive on its new timeline.' }
  ]
},

/* ======================================================================
   MODULE: failover (2)
   ====================================================================== */
{
  id: 'failover-switchover-promote',
  module: 'failover',
  title: 'Failover vs Switchover: Promotion, Timelines, pg_rewind and Fencing',
  level: 5,
  minutes: 30,
  summary: 'What happens when a standby is promoted (pg_promote, pg_ctl promote), how timelines fork history, how pg_rewind turns an old primary into a standby, and why fencing comes first.',
  objectives: [
    'Distinguish planned switchover from unplanned failover and their data-loss properties',
    'Promote a standby with pg_promote() or pg_ctl promote and verify the result',
    'Explain timelines, .history files and recovery_target_timeline = latest',
    'Use pg_rewind to resynchronise a diverged old primary and know its prerequisites',
    'Apply fencing before promotion and describe a safe manual failover runbook'
  ],
  concept: `<p><strong>Switchover</strong> is a <em>planned</em> role change: the primary is healthy, you stop writes cleanly, make sure a standby has received everything, promote it and turn the old primary into a standby. Zero data loss, seconds of write unavailability. <strong>Failover</strong> is <em>unplanned</em>: the primary died or is unreachable, and a standby is promoted with whatever WAL it has. Possible data loss (async) and the old primary may come back with diverged history.</p>
<p><strong>Analogy:</strong> switchover is a pilot handing controls to the co-pilot during calm flight ("your aircraft" — "my aircraft"). Failover is the co-pilot taking over because the pilot fainted — first making sure the pilot can't suddenly grab the stick again (fencing).</p>
<p><strong>Promotion</strong> <span class="tag core">core</span>: <code>SELECT pg_promote();</code> (PG12+, waits up to 60 s by default) or <code>pg_ctl promote -D $PGDATA</code>. The standby finishes replaying available WAL, exits recovery, picks a new <strong>timeline ID</strong>, writes a <code>.history</code> file, performs a checkpoint and starts accepting writes. (<code>promote_trigger_file</code> was removed in PG16.)</p>
<p><strong>Timelines</strong> are PostgreSQL's way to fork history. Before failover all nodes are on timeline 1 (WAL files <code>00000001...</code>). The promoted node switches to timeline 2 at LSN X and writes <code>00000002.history</code>: "timeline 1 ended at 0/5A000A0". Other standbys follow the new timeline automatically (<code>recovery_target_timeline = 'latest'</code>, default since PG12). An old primary that wrote extra WAL on timeline 1 after X has diverged — it cannot simply stream from the new primary.</p>
<p><strong>pg_rewind</strong> <span class="tag core">core</span> fixes that cheaply: it compares the old primary's data directory with the new primary, finds the divergence point from timeline history, and copies only the blocks changed since then (plus all config/non-relation files), so the old primary can start as a standby — minutes instead of a full re-clone. It requires <code>wal_log_hints = on</code> or data checksums (checksums are enabled by default by <code>initdb</code> in PG18), and the target must be shut down cleanly.</p>
<p><strong>Fencing</strong>: before promoting during a failover, make sure the old primary cannot accept writes — stop it, power it off via the cloud API (STONITH), revoke its network/VIP, or rely on self-demotion (Patroni). Promoting first and fencing later is how split brain happens.</p>`,
  why: `<p>Every HA design reduces to "promote the right standby at the right time and make sure the old primary is out of the way". Knowing the mechanics lets you run manual failovers safely when automation is unavailable, debug what Patroni or an operator did, rejoin old primaries without multi-hour re-clones, and reason about which transactions were lost.</p>`,
  useCase: `<p>A logistics company runs a 1.8 TB cluster with one async standby and no HA manager. At 03:12 the primary's host panics. On-call follows the runbook: confirm the primary is unreachable and power it off via the cloud API (fence), check the standby's last received LSN, <code>SELECT pg_promote();</code>, move the DNS/VIP, start the apps. RTO: 14 minutes; RPO: 1.3 s of transactions (measured afterwards by comparing the old primary's WAL with the fork point). The next morning they <code>pg_rewind</code> the repaired old host (rewound 2.1 GB of changed blocks in 4 minutes instead of a 3-hour <code>pg_basebackup</code>) and rejoin it as a standby. A month later they adopt Patroni.</p>`,
  internals: `<p>On promotion the startup process stops at the end of available WAL, writes an <em>end-of-recovery</em> record, increments the timeline (newest timeline ID + 1 among those in the archive/pg_wal), renames the last partial WAL segment (<code>.partial</code>) and starts the checkpointer to complete a checkpoint (PG uses a fast end-of-recovery path to allow connections sooner). <code>pg_control</code> records the new timeline (<code>pg_control_checkpoint().timeline_id</code>).</p>
<p>A switchover done right: (1) stop the primary cleanly (<code>pg_ctl stop -m fast</code>) — the shutdown checkpoint is streamed to connected standbys; (2) verify the standby replayed up to the primary's final checkpoint LSN; (3) promote the standby; (4) configure the old primary with <code>standby.signal</code> + <code>primary_conninfo</code> pointing to the new primary and start it — because it wrote nothing beyond what the standby has, it follows the new timeline without rewind. Patroni automates exactly this.</p>
<p><code>pg_rewind</code> details: run as <code>pg_rewind --target-pgdata=$PGDATA --source-server='host=new-primary user=postgres dbname=postgres' -R -P</code>. It needs WAL on the target from before the divergence point to determine changed blocks (<code>--restore-target-wal</code> uses <code>restore_command</code> to fetch missing segments). After rewinding the target replays WAL from the source to become consistent.</p>`,
  whenNot: `<ul><li>Don't fail over for transient blips (a 5-second network hiccup) — the cost of an unnecessary failover (lost transactions with async, client disconnects) can exceed the blip.</li>
<li>Don't use <code>pg_rewind</code> when the old primary's disk is suspected corrupt — re-clone with <code>pg_basebackup</code>.</li>
<li>Don't manually promote in a Patroni/operator-managed cluster — use <code>patronictl failover/switchover</code> or the operator, otherwise the manager and you fight over roles.</li></ul>`,
  syntax: `-- promote (on the standby)
SELECT pg_promote(wait => true, wait_seconds => 60);
-- or shell: pg_ctl promote -D /var/lib/postgresql/18/main

-- check
SELECT pg_is_in_recovery();
SELECT timeline_id FROM pg_control_checkpoint();

-- rejoin old primary (shell, old primary stopped cleanly)
pg_rewind --target-pgdata=/var/lib/postgresql/18/main \\
          --source-server='host=10.0.2.10 user=postgres dbname=postgres' \\
          --write-recovery-conf --progress`,
  examples: [
    { label: 'Basic', title: 'Where am I on the timeline?',
      sql: `SELECT pg_is_in_recovery() AS in_recovery,
       timeline_id,
       prev_timeline_id,
       redo_wal_file,
       substr(redo_wal_file, 1, 8) AS timeline_hex_in_filename,
       checkpoint_time
FROM pg_control_checkpoint();`,
      explain: `<p>The timeline ID appears in <code>pg_control</code> and as the first 8 hex digits of every WAL file name. On a fresh cluster it is 1. After the first promotion it becomes 2, and so on. Comparing timelines across nodes immediately shows which ones followed a failover and which one is a "ghost" of an old history.</p>`,
      output: ` in_recovery | timeline_id | prev_timeline_id | redo_wal_file            | timeline_hex_in_filename | checkpoint_time
-------------+-------------+------------------+--------------------------+--------------------------+------------------------
 f           |           1 |                1 | 000000010000000000000001 | 00000001                 | 2026-10-05 ...`, run: true },
    { label: 'Intermediate', title: 'Promote a standby and verify (run on the standby)',
      sql: `-- 1. Before: confirm this is a standby and how much WAL it has
SELECT pg_is_in_recovery(), pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(),
       pg_last_xact_replay_timestamp();

-- 2. Promote and wait up to 60 seconds for it to finish
SELECT pg_promote(true, 60);

-- 3. After: writable, new timeline
SELECT pg_is_in_recovery() AS still_standby,
       (SELECT timeline_id FROM pg_control_checkpoint()) AS timeline;`,
      explain: `<p><code>pg_promote</code> returns <code>true</code> once promotion completed within the wait time. On a primary (like this sandbox) it raises <em>"recovery is not in progress"</em>, so this example is marked non-runnable. In a real failover you would fence the old primary <strong>before</strong> step 2 and re-point clients after step 3. The <code>.history</code> file for the new timeline appears in <code>pg_wal/</code>, e.g. <code>00000002.history</code> containing <code>1	0/5A0000A0	no recovery target specified</code>.</p>`,
      output: ` pg_is_in_recovery | pg_last_wal_receive_lsn | pg_last_wal_replay_lsn | pg_last_xact_replay_timestamp
-------------------+-------------------------+------------------------+-------------------------------
 t                 | 0/5A0000A0              | 0/5A0000A0             | 2026-10-05 03:12:41.18+00

 pg_promote
------------
 t

 still_standby | timeline
---------------+----------
 f             |        2`, run: false },
    { label: 'Advanced', title: 'Is this cluster ready for a fast rejoin with pg_rewind?',
      sql: `SELECT current_setting('data_checksums')  AS data_checksums,
       current_setting('wal_log_hints')   AS wal_log_hints,
       current_setting('full_page_writes') AS full_page_writes,
       (current_setting('data_checksums') = 'on'
        OR current_setting('wal_log_hints') = 'on')  AS pg_rewind_supported,
       current_setting('wal_keep_size')    AS wal_keep_size,
       current_setting('archive_mode')     AS archive_mode;`,
      explain: `<p><code>pg_rewind</code> must detect every block changed after the fork, including hint-bit-only changes, which are WAL-logged only with checksums or <code>wal_log_hints</code>. <code>full_page_writes</code> must be on. It also needs the target's WAL back to the fork point — keep some <code>wal_keep_size</code> or an archive with <code>restore_command</code>. This sandbox has data checksums on, so rewind would be possible.</p>`,
      output: ` data_checksums | wal_log_hints | full_page_writes | pg_rewind_supported | wal_keep_size | archive_mode
----------------+---------------+------------------+---------------------+---------------+--------------
 on             | off           | on               | t                   | 0             | off`, run: true }
  ],
  compare: {
    bad: { sql: `-- Manual failover, order of operations from an incident review
-- 03:14  SELECT pg_promote();            -- on standby
-- 03:15  update DNS to standby
-- 03:20  old primary's host recovers from network issue, still primary,
--        app servers with cached DNS keep writing to it
-- 03:40  someone notices two primaries with different data`, why: 'Promoting before fencing allowed two writable primaries (split brain). Writes to the old one between 03:14 and 03:40 are on a diverged timeline and must be reconciled by hand.', run: false },
    good: { sql: `-- 1. FENCE: stop/power-off old primary (cloud API), or block its port / remove VIP
-- 2. VERIFY: the old primary is unreachable for writes
-- 3. CHOOSE: the standby with the highest pg_last_wal_receive_lsn()
-- 4. PROMOTE: SELECT pg_promote();
-- 5. ROUTE: move VIP / update proxy; clients reconnect
-- 6. REPAIR later: pg_rewind old primary -> start as standby`, why: 'Fencing first guarantees only one writable node; choosing the most advanced standby minimizes data loss; rewind makes the rejoin cheap.', run: false }
  },
  mistakes: [
    'Promoting before fencing the old primary.',
    'Promoting the first standby you think of instead of the one with the highest received LSN.',
    'Starting the old primary again "to check something" without <code>standby.signal</code> — it comes up as a writable primary on the old timeline.',
    'Using <code>pg_rewind</code> without <code>wal_log_hints</code>/checksums — it refuses to run, and you discover this at 3 a.m.',
    'Forgetting other standbys: they must follow the new primary (change <code>primary_conninfo</code>, timeline <code>latest</code>), and slots must exist on the new primary.',
    'Not re-enabling WAL archiving/backups on the new primary.'
  ],
  best: [
    'Practice switchovers monthly; they exercise the same machinery as failovers without data loss.',
    'Automate with Patroni or an operator; keep a manual runbook for when automation is down.',
    'Enable data checksums (default in PG18 initdb) or <code>wal_log_hints</code> on every cluster.',
    'Record fork LSN and time for every failover to quantify actual data loss.',
    'After failover: verify timelines on all nodes, replication, archiving, backups, monitoring targets and connection routing.'
  ],
  performance: `<p>Promotion itself takes seconds; most RTO is detection and client routing. A standby with large replay backlog must finish replaying before promotion completes (<code>pg_promote</code> waits) — another reason to keep replay lag low on HA candidates. After promotion the new primary has a cold cache for workloads that previously ran on the old primary; expect elevated latency for minutes (consider <code>pg_prewarm</code> <span class="tag ext">extension</span> autoprewarm). <code>pg_rewind</code> copies only changed blocks, usually a tiny fraction of the cluster.</p>`,
  security: `<p>Fencing mechanisms (cloud API credentials to stop instances, power management access) are powerful — restrict and audit them. <code>pg_rewind</code> needs a superuser (or a role granted the required functions) connection to the source. Only authorised operators/automation should be able to call <code>pg_promote()</code> (superuser or explicitly granted).</p>`,
  scenario: { title: 'Unplanned failover at 03:12 with async replication and no HA manager', steps: [
    '1. Detect: primary unreachable for 90 s, host console shows kernel panic.',
    '2. Fence: stop the instance via cloud API and detach its network interface — confirm it is stopped.',
    '3. Choose: compare pg_last_wal_receive_lsn() on both standbys; pg-b 0/9C3F1A80, pg-c 0/9C3E0010 → promote pg-b.',
    '4. Promote: SELECT pg_promote(); → timeline 3. Repoint pg-c\'s primary_conninfo to pg-b and reload; it follows timeline 3.',
    '5. Route: move the VIP / update HAProxy backends; check application error rates return to normal.',
    '6. Post-incident: record fork LSN, estimate lost transactions, verify archiving/backups on pg-b, later pg_rewind the old primary and rejoin as standby.'
  ] },
  widgets: ['diagram:ha', 'diagram:streaming-replication', 'diagram:wal'],
  interview: [
    { q: 'What is a timeline in PostgreSQL and why does it exist?', a: 'A timeline identifies a branch of WAL history. Each promotion (or PITR to a target) starts a new timeline with a .history file recording the fork point, so WAL from different histories never gets mixed in the archive and standbys can follow the right branch (recovery_target_timeline = latest).' },
    { q: 'What does pg_rewind do and what does it require?', a: 'It synchronises a diverged old primary with the new primary by copying only blocks changed after the fork point (plus non-relation files), so it can restart as a standby. It requires the target to be cleanly shut down, wal_log_hints = on or data checksums, full_page_writes, and the target WAL back to the divergence point.' },
    { q: 'How does a switchover avoid data loss?', a: 'The primary is shut down cleanly; its final WAL including the shutdown checkpoint is streamed to the standby; once the standby has replayed to that LSN it is promoted. The old primary has no extra WAL, so it can follow the new timeline without rewinding.' },
    { q: 'Why fence before promoting?', a: 'If the old primary is only partitioned, not dead, it may continue accepting writes from some clients. Promoting a standby then creates two writable primaries with diverging data (split brain). Fencing guarantees the old one cannot accept writes.' }
  ],
  exercises: [
    { task: 'Decode the timeline, log number and segment number from a WAL file name (use 00000003000000A2000000F1).', solution: `SELECT ('x' || substr(f, 1, 8))::bit(32)::int  AS timeline,
       ('x' || substr(f, 9, 8))::bit(32)::int  AS log_id,
       ('x' || substr(f, 17, 8))::bit(32)::int AS segment
FROM (VALUES ('00000003000000A2000000F1')) AS v(f);`, run: true },
    { task: 'Show the WAL file name that contains the current LSN and the byte offset within it.', solution: `SELECT file_name, file_offset FROM pg_walfile_name_offset(pg_current_wal_lsn());`, run: true }
  ],
  challenge: { task: 'Given candidate standbys and their last received LSNs, write a query that picks the promotion candidate (highest LSN) and reports how many bytes the others are behind it.', hint: 'Cast text to pg_lsn and use pg_wal_lsn_diff with a window max.', solution: `WITH standbys(name, received) AS (
  VALUES ('pg-b', '0/9C3F1A80'::pg_lsn), ('pg-c', '0/9C3E0010'::pg_lsn), ('pg-dr', '0/9B000000'::pg_lsn)
)
SELECT name, received,
       pg_wal_lsn_diff(max(received) OVER (), received) AS bytes_behind_best,
       received = max(received) OVER () AS promote_this
FROM standbys
ORDER BY received DESC;`, run: true },
  related: ['failover-split-brain', 'high-availability-patroni', 'replication-streaming', 'backup-restore'],
  quiz: [
    { type: 'mcq', q: 'What happens to the timeline ID when a standby is promoted?', options: ['Stays the same', 'Increments, and a .history file records the fork point', 'Resets to 1', 'Becomes the system identifier'], answer: 1, explain: 'Promotion creates a new timeline so the new history can be distinguished from the old one.' },
    { type: 'tf', q: 'pg_rewind requires wal_log_hints = on or data checksums enabled.', answer: true, explain: 'Without them hint-bit-only page changes are not WAL-logged and pg_rewind cannot reliably identify changed blocks.' },
    { type: 'predict', q: 'What happens when you run this on a primary?', code: `SELECT pg_promote();`, options: ['Returns true', 'Returns false', 'ERROR: recovery is not in progress', 'Creates a new timeline'], answer: 2, explain: 'Only a server in recovery (standby) can be promoted.' },
    { type: 'scenario', q: 'During a planned switchover, what must be verified before promoting the standby?', options: ['That autovacuum is off', 'That the standby has replayed up to the old primary\'s final shutdown checkpoint LSN', 'That max_connections is doubled', 'That the old primary is still accepting writes'], answer: 1, explain: 'Then no committed transaction is missing and the old primary can follow the new timeline without rewind.' }
  ]
},
{
  id: 'failover-split-brain',
  module: 'failover',
  title: 'Split Brain: Causes, Quorum, Fencing, Sync Replication and Client Reconnection',
  level: 5,
  minutes: 30,
  summary: 'Why two primaries can appear, how quorum, leases, STONITH and self-demotion prevent it, how synchronous replication interacts, and how clients find the one true primary with target_session_attrs.',
  objectives: [
    'Explain how network partitions and naive automation create split brain',
    'Apply quorum (majority) reasoning to DCS and replica placement',
    'Describe fencing techniques: STONITH, self-demotion, watchdog, network fencing, fencing tokens',
    'Explain how synchronous replication limits damage of a stray primary',
    'Configure client reconnection with libpq multi-host strings and target_session_attrs',
    'Recover from a split brain incident and reconcile diverged data'
  ],
  concept: `<p><strong>Split brain</strong> is the state where <em>two</em> nodes both believe they are the primary and both accept writes. The data diverges: order 5001 is "paid" on one node and "cancelled" on the other, identity values collide, and there is no automatic way to merge. It is the worst outcome of an HA system — worse than downtime, because downtime loses availability while split brain loses <em>correctness</em>.</p>
<p><strong>Analogy:</strong> two captains on one ship after the radio fails, each convinced the other is lost overboard, each steering. The cure is a rule: you may only steer while holding the single, physical captain's key — and if you cannot confirm you hold it, you let go of the wheel.</p>
<p><strong>Causes</strong>: network partition between primary and the failover decider (the primary is alive but "looks dead"); a two-node setup where each side promotes itself; a long GC/VM pause or I/O freeze, after which the old primary "wakes up" still believing it leads; DNS/VIP not moved for all clients; humans restarting an old primary without <code>standby.signal</code>.</p>
<p><strong>Defences</strong>:</p>
<ul><li><strong>Quorum</strong>: decisions require a majority of an odd number of voters (3 or 5 DCS nodes across 3 failure domains). A minority partition cannot elect a leader, and a primary that cannot reach the majority must step down.</li>
<li><strong>Leases + self-demotion</strong>: leadership is a lease with TTL; the primary demotes itself if it can't renew it in time (Patroni).</li>
<li><strong>STONITH</strong> ("Shoot The Other Node In The Head"): forcibly power off / isolate the old primary via IPMI or cloud APIs before promoting.</li>
<li><strong>Watchdog</strong>: a hardware/software timer that reboots a node whose HA agent stops responding (Patroni <code>watchdog</code>).</li>
<li><strong>Fencing tokens</strong>: every leadership term gets a monotonically increasing number; downstream systems reject writes carrying an older term.</li>
<li><strong>Synchronous replication</strong>: with <code>synchronous_standby_names</code> requiring a standby acknowledgement, an isolated old primary <em>cannot complete commits</em> once its standbys follow the new primary — clients hang instead of silently writing divergent data (the transaction is still committed locally, but never acknowledged).</li>
<li><strong>Client routing</strong> by role: libpq <code>target_session_attrs=read-write</code> <span class="tag core">core</span> with multi-host strings, HAProxy checks on Patroni <code>/primary</code>, Kubernetes <code>-rw</code> services.</li></ul>`,
  why: `<p>Automatic failover is only safe if it cannot produce two primaries. Every serious HA tool is designed primarily around this problem; understanding it lets you evaluate tools, configure their timers correctly, place DCS members, and recognise the symptoms quickly if it happens anyway.</p>`,
  useCase: `<p>A ride-hailing company once ran a homegrown failover script: "if the primary does not answer a ping for 20 s, promote the standby". A switch failure isolated the primary from the standby and the monitoring host but <em>not</em> from half the app servers. For 11 minutes both nodes accepted trips and payments; reconciliation took three engineers two days, and some riders were charged twice. The redesign: Patroni with 5 etcd members across 3 zones, <code>synchronous_mode</code>, watchdog enabled, HAProxy checks on <code>/primary</code>, and application connection strings with <code>target_session_attrs=read-write</code>. A later identical switch failure caused the isolated old primary to demote itself after ~20 s; clients errored briefly and reconnected to the new primary.</p>`,
  internals: `<p><strong>Quorum arithmetic:</strong> with N voters a partition can act only if it holds ⌊N/2⌋+1. N = 3 tolerates 1 failure; N = 5 tolerates 2; N = 4 still tolerates only 1 (even numbers add cost, not resilience). Place voters so that no single failure domain contains a majority.</p>
<p><strong>Timing:</strong> self-demotion must occur <em>before</em> another node can be elected: Patroni ensures <code>loop_wait + 2 × retry_timeout ≤ ttl</code>. Process pauses longer than <code>ttl</code> (e.g. a VM frozen for 60 s) are where watchdogs and fencing tokens matter: the paused node may wake up after a new leader exists, but its PostgreSQL is reset by the watchdog or its writes stall on synchronous replication.</p>
<p><strong>libpq routing:</strong> with <code>host=pg-a,pg-b,pg-c</code> and <code>target_session_attrs=read-write</code>, libpq connects to each host in turn and checks whether the session is writable (using the <code>in_hot_standby</code>/<code>default_transaction_read_only</code> parameters servers report at connection start since PG14, otherwise <code>SHOW transaction_read_only</code>), skipping read-only ones. Values: <code>any</code> (default), <code>read-write</code>, <code>read-only</code>, <code>primary</code>, <code>standby</code>, <code>prefer-standby</code>. <code>load_balance_hosts=random</code> (PG16 libpq) shuffles hosts. This routing is only evaluated at <em>connect</em> time — existing connections to a demoted node must be closed (Patroni restarts PostgreSQL on demotion, HAProxy <code>shutdown-sessions</code>) and the app must reconnect.</p>`,
  whenNot: `<ul><li>Don't use ping-based or two-node "promote if the other is silent" scripts in production — they cannot distinguish a dead primary from a partition.</li>
<li>Don't rely solely on <code>target_session_attrs</code> to prevent split brain: if two nodes are both writable, libpq happily connects to whichever comes first. It is routing, not fencing.</li>
<li>Don't run strict synchronous mode with a single standby unless you accept write outages whenever that standby is down.</li></ul>`,
  syntax: `# libpq multi-host URIs (core libpq, all drivers built on it)
postgresql://app@pg-a:5432,pg-b:5432,pg-c:5432/company_db?target_session_attrs=read-write&connect_timeout=3
postgresql://app@pg-b,pg-c/company_db?target_session_attrs=prefer-standby&load_balance_hosts=random

# keyword/value form
host=pg-a,pg-b,pg-c port=5432,5432,5432 dbname=company_db user=app target_session_attrs=primary connect_timeout=3

# JDBC (pgJDBC): jdbc:postgresql://pg-a,pg-b,pg-c/company_db?targetServerType=primary
# Npgsql: Host=pg-a,pg-b,pg-c;Target Session Attributes=primary`,
  examples: [
    { label: 'Basic', title: 'What libpq checks to decide "read-write"',
      sql: `SELECT current_setting('transaction_read_only')          AS transaction_read_only,
       current_setting('default_transaction_read_only')  AS default_transaction_read_only,
       current_setting('in_hot_standby')                 AS in_hot_standby,
       pg_is_in_recovery()                               AS in_recovery;`,
      explain: `<p>A standby reports <code>in_hot_standby = on</code> and all sessions are read-only. A primary reports <code>off</code>. <code>target_session_attrs=read-write</code> skips any server where the session would be read-only — including a primary with <code>default_transaction_read_only = on</code>, which is a handy way to "soft-fence" a node during maintenance: set it, reload, and new libpq connections using <code>read-write</code> go elsewhere. (<code>primary</code> checks only recovery state, ignoring that setting.)</p>`,
      output: ` transaction_read_only | default_transaction_read_only | in_hot_standby | in_recovery
-----------------------+-------------------------------+----------------+-------------
 off                   | off                           | off            | f`, run: true },
    { label: 'Intermediate', title: 'Fencing tokens: reject writes from a stale leader term',
      sql: `-- Leadership term table (in real systems this lives in the DCS / coordinator)
CREATE TABLE cluster_term (
  id         int PRIMARY KEY CHECK (id = 1),
  term       bigint NOT NULL,
  leader     text   NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cluster_term VALUES (1, 41, 'pg-a', now() - interval '1 hour');

-- Failover: pg-b becomes leader with term 42
UPDATE cluster_term SET term = 42, leader = 'pg-b', granted_at = now() WHERE id = 1;

-- A downstream job (e.g. payout batch) accepts work only with the current token
CREATE TABLE payout_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issued_by text, issued_term bigint, amount numeric(12,2));

-- stale leader pg-a (term 41) wakes up from a 60 s VM pause and tries to issue a batch:
INSERT INTO payout_batches (issued_by, issued_term, amount)
SELECT 'pg-a', 41, 125000
WHERE 41 >= (SELECT term FROM cluster_term WHERE id = 1);   -- inserts 0 rows

-- current leader pg-b with term 42:
INSERT INTO payout_batches (issued_by, issued_term, amount)
SELECT 'pg-b', 42, 125000
WHERE 42 >= (SELECT term FROM cluster_term WHERE id = 1);   -- inserts 1 row

SELECT issued_by, issued_term, amount FROM payout_batches;`,
      explain: `<p>Fencing tokens solve the "zombie leader" problem that timeouts cannot: a process paused longer than its lease may resume and act on stale authority. If every side effect carries the term number and the resource rejects lower terms, the zombie's actions are harmless. PostgreSQL timelines play a similar role for WAL; DCS revisions (etcd) give you monotonic tokens for free.</p>`,
      output: `INSERT 0 0
INSERT 0 1
 issued_by | issued_term | amount
-----------+-------------+-----------
 pg-b      |          42 | 125000.00`, run: true },
    { label: 'Advanced', title: 'Detecting split brain after the fact',
      sql: `-- Run on EVERY node that might have been primary and compare results
SELECT pg_is_in_recovery()                              AS in_recovery,
       (SELECT timeline_id FROM pg_control_checkpoint()) AS timeline,
       (SELECT system_identifier FROM pg_control_system()) AS system_id,
       pg_current_wal_lsn()                             AS current_lsn,
       (SELECT max(id) FROM orders)                     AS max_order_id,
       (SELECT max(order_date) FROM orders)             AS last_order_at;`,
      explain: `<p>Two nodes with <code>in_recovery = false</code>, the same <code>system_identifier</code> (same cluster origin) but different timelines — or the same timeline with diverging LSNs and overlapping <code>max_order_id</code> ranges — confirm split brain. Next step: freeze writes on the node that will be discarded, export rows written on it after the fork time (e.g. <code>order_date &gt;</code> fork timestamp, or audit/CDC logs), reconcile them into the surviving primary with business review, then <code>pg_rewind</code> or re-clone the losing node.</p>`,
      output: ` in_recovery | timeline | system_id           | current_lsn | max_order_id | last_order_at
-------------+----------+---------------------+-------------+--------------+------------------------
 f           |        1 | 7693148383034834986 | 0/1DC73B8   |         5000 | 2025-10-01 ...
(values differ per node)`, run: true }
  ],
  compare: {
    bad: { sql: `# Application connection string pinned to one IP
DATABASE_URL=postgresql://app@10.0.1.10:5432/company_db
# after failover the app keeps connecting to the old primary
# (which may still be up and writable if it was only partitioned)`, why: 'Clients do not follow the leader at all, and if the old node is alive they continue writing to it — split brain from the client side.', run: false },
    good: { sql: `DATABASE_URL=postgresql://app@pg-a:5432,pg-b:5432,pg-c:5432/company_db?target_session_attrs=read-write&connect_timeout=3
# + Patroni self-demotion & watchdog, synchronous_mode
# + app retries the transaction on connection errors (idempotent operations)`, why: 'Clients locate the writable node at connect time; fencing and sync replication make sure only one node can be writable and acknowledged; retries make the switch transparent.', run: false }
  },
  mistakes: [
    'Two-node clusters with automatic failover and no external witness.',
    'Even numbers of DCS voters or all voters in one AZ.',
    'Long-lived connections that never re-validate: after a demotion, apps keep using connections to a read-only node and get "cannot execute INSERT in a read-only transaction".',
    'Treating <code>target_session_attrs</code> as a fencing mechanism.',
    'Restarting an old primary without <code>standby.signal</code> after an incident.',
    'Not designing idempotent retries: a client that times out during failover retries and creates duplicates.'
  ],
  best: [
    'Odd number of voters (3/5) across ≥3 failure domains; witness nodes if you only have two data centres.',
    'Layered fencing: self-demotion + watchdog + STONITH via cloud API + sync replication.',
    'Clients: multi-host strings or role-aware proxies, short <code>connect_timeout</code>, retry with backoff, idempotency keys.',
    'Make the read-only error (SQLSTATE <code>25006</code>) trigger a reconnect in the app or pool.',
    'Game-day test network partitions (iptables, security groups), not just process kills.'
  ],
  performance: `<p>Fencing and quorum add little runtime cost; their cost is in timing: conservative TTLs lengthen RTO. Synchronous replication adds commit latency but bounds the damage of partitions. Client-side multi-host connection attempts add up to <code>connect_timeout</code> × (unreachable hosts) to a reconnect — keep the writable host first when known and use short timeouts (2-3 s).</p>`,
  security: `<p>Fencing credentials (cloud APIs, IPMI) and DCS write access effectively control which node is primary — protect them like superuser passwords. A compromised DCS could cause intentional split brain. Use TLS on all client connections; with multi-host strings use <code>sslmode=verify-full</code> and certificates valid for all hostnames.</p>`,
  scenario: { title: 'Two primaries detected 8 minutes after a network partition', steps: [
    '1. Alert: two nodes report pg_is_in_recovery() = false; pg-a timeline 4, pg-b timeline 5. Patroni was disabled on pg-a during maintenance ("pause" mode) and an engineer promoted pg-b manually.',
    '2. Contain: set pg-a read-only immediately (ALTER SYSTEM SET default_transaction_read_only = on; reload) and terminate its client sessions; remove it from HAProxy.',
    '3. Quantify: identify the fork time from 00000005.history on pg-b; extract rows written on pg-a after it (orders, payments, audit_logs by timestamp/ID ranges).',
    '4. Reconcile: business-reviewed re-insert or merge into pg-b with new IDs where collisions exist; notify affected customers if needed.',
    '5. Rebuild pg-a: pg_rewind against pg-b (or pg_basebackup), start as standby; resume Patroni.',
    '6. Prevent: forbid manual promotion while Patroni is paused (runbook), enable watchdog, alert on more than one writable node.'
  ] },
  widgets: ['diagram:ha', 'diagram:prod-cluster'],
  interview: [
    { q: 'What is split brain and why is it worse than downtime?', a: 'Two nodes acting as primary and accepting writes concurrently, so data diverges. Downtime loses availability temporarily; split brain loses correctness — conflicting rows, duplicate IDs, lost updates — that requires manual, business-level reconciliation.' },
    { q: 'How does synchronous replication help against split brain?', a: 'An isolated old primary cannot get acknowledgements from standbys that now follow the new primary, so its commits block instead of being acknowledged to clients. The data still commits locally, but clients do not receive success, limiting divergent acknowledged writes.' },
    { q: 'How does target_session_attrs=read-write work and what are its limits?', a: 'libpq tries each host in the multi-host list and keeps the first whose session is writable, skipping standbys. It is evaluated only at connect time and does not prevent two writable nodes; it is a routing aid, not a fencing mechanism.' },
    { q: 'What is a fencing token?', a: 'A monotonically increasing number tied to each leadership term. Resources accept operations only with the highest token they have seen, so a paused former leader that wakes up with an old token cannot cause harm.' }
  ],
  exercises: [
    { task: 'Write the single query a client-side health probe would use to decide that a node is a valid write target.', solution: `SELECT NOT pg_is_in_recovery()
       AND current_setting('default_transaction_read_only') = 'off' AS writable;`, run: true },
    { task: 'Quorum math: for N = 2..7 voters compute the majority needed and how many failures are tolerated.', solution: `SELECT n AS voters, n / 2 + 1 AS majority, n - (n / 2 + 1) AS failures_tolerated
FROM generate_series(2, 7) AS n;`, run: true }
  ],
  challenge: { task: 'Simulate a lease: write a single UPDATE that grants leadership to a node only if the current lease has expired or is already held by that node, and returns whether it succeeded. Test it for two nodes.', hint: 'Use UPDATE ... WHERE (expires_at < now() OR holder = $node) RETURNING; a zero-row result means "not leader".', solution: `CREATE TABLE leader_lease (id int PRIMARY KEY, holder text, term bigint, expires_at timestamptz);
INSERT INTO leader_lease VALUES (1, 'pg-a', 7, now() + interval '30 seconds');

-- pg-b tries while pg-a's lease is valid: 0 rows → not leader
UPDATE leader_lease SET holder = 'pg-b', term = term + 1, expires_at = now() + interval '30 seconds'
WHERE id = 1 AND (expires_at < now() OR holder = 'pg-b')
RETURNING holder, term;

-- pg-a renews its own lease: 1 row → still leader, same term
UPDATE leader_lease SET expires_at = now() + interval '30 seconds'
WHERE id = 1 AND (expires_at < now() OR holder = 'pg-a')
RETURNING holder, term;`, run: true },
  related: ['failover-switchover-promote', 'high-availability-patroni', 'replication-sync-async', 'distributed-postgresql'],
  quiz: [
    { type: 'mcq', q: 'How many DCS voters are needed to tolerate two simultaneous failures?', options: ['2', '3', '4', '5'], answer: 3, explain: 'Majority of 5 is 3, so 2 can fail. 4 voters still tolerate only 1.' },
    { type: 'tf', q: 'target_session_attrs=read-write prevents split brain.', answer: false, explain: 'It only routes new connections to a writable server; if two servers are writable it will connect to whichever it tries first.' },
    { type: 'scenario', q: 'A primary is partitioned from the etcd majority but still reachable by some apps. With Patroni defaults, what happens?', options: ['It stays primary indefinitely', 'It fails to renew the leader key and demotes itself to read-only before the TTL lets a new leader be elected', 'etcd promotes it again', 'It shuts down the other nodes'], answer: 1, explain: 'Self-demotion within loop_wait + 2*retry_timeout <= ttl is Patroni\'s primary split-brain guard.' },
    { type: 'mcq', q: 'Which libpq target_session_attrs value prefers standbys but falls back to the primary?', options: ['standby', 'read-only', 'prefer-standby', 'any'], answer: 2, explain: 'prefer-standby (PG14+) tries standbys first and accepts any server if none is available.' },
    { type: 'bug', q: 'After failover, an app logs "cannot execute INSERT in a read-only transaction" for 20 minutes. Why?', code: `pool: minIdle=50, maxLifetime=0 (never recycle), no validation query
url: postgresql://app@pg-a,pg-b/company_db?target_session_attrs=read-write`, options: ['target_session_attrs is misspelled', 'Pooled connections opened before failover are still attached to the demoted node; routing applies only at connect time', 'pg-b is down', 'INSERTs need SERIALIZABLE'], answer: 1, explain: 'Recycle connections on SQLSTATE 25006 / use maxLifetime and validation so the pool reconnects through the routing logic.' }
  ]
}
]);
PGM.addLessons([
/* ======================================================================
   MODULE: connection-pooling (3)
   ====================================================================== */
{
  id: 'connection-pooling-why',
  module: 'connection-pooling',
  title: 'Why Connections Are Expensive: Process-per-Connection and Application-Side Pools',
  level: 5,
  minutes: 25,
  summary: 'PostgreSQL forks one OS process per connection; learn what that costs in memory, CPU and contention, why max_connections = 5000 is a trap, and how application pools (HikariCP, Npgsql, pgx, SQLAlchemy) fix most of it.',
  objectives: [
    'Explain the postmaster fork model and the per-connection cost (memory, snapshot work, context switches)',
    'Understand why throughput drops when active connections exceed CPU cores',
    'Inspect connections by state and spot idle and idle-in-transaction waste',
    'Configure application-side pools (HikariCP, Npgsql, pgx, SQLAlchemy) with sane sizes and timeouts',
    'Use server timeouts (idle_in_transaction_session_timeout, idle_session_timeout) as guardrails'
  ],
  concept: `<p>PostgreSQL uses a <strong>process-per-connection</strong> model <span class="tag core">core</span>: the <em>postmaster</em> listens on port 5432 and, for every new client connection, <code>fork()</code>s a dedicated <strong>backend process</strong> that lives until the client disconnects. Each backend has its own private memory (catalog and relation caches, prepared plans, <code>work_mem</code> allocations for sorts/hashes, <code>temp_buffers</code>) and shares <code>shared_buffers</code>, WAL buffers and lock tables with everyone else.</p>
<p><strong>Analogy:</strong> a restaurant that hires a dedicated waiter for every guest who walks in — even guests who only sit and read the menu for an hour. Hiring takes time (connection setup with TLS and authentication: 2-20 ms), each waiter needs a locker and uniform (memory), and with 2,000 waiters in a kitchen built for 32 cooks (CPU cores) they mostly bump into each other. A <strong>pool</strong> is a small, fixed team of waiters who serve many guests in turn.</p>
<p>Costs of a connection:</p>
<ul>
<li><strong>Setup</strong>: TCP + TLS handshake + SCRAM authentication + fork + backend initialisation; often more expensive than the query itself for short web requests.</li>
<li><strong>Memory</strong>: an idle backend uses a few MB of private memory; after touching many tables/partitions, its catalog caches can grow to tens of MB. A query can additionally use <code>work_mem</code> × (number of sort/hash nodes) × (parallel workers) — 300 active connections × 3 nodes × 64 MB = 57 GB worst case.</li>
<li><strong>CPU and contention</strong>: more concurrently <em>active</em> backends than cores means context switching, lock and LWLock contention, cache thrashing. Throughput typically peaks around 2-4× cores of active work and then <em>falls</em>.</li>
<li><strong>Snapshot cost</strong>: every snapshot scans the array of running transactions; PG14 made this much cheaper, but thousands of connections still add overhead in places (lock manager, <code>ProcArray</code>).</li>
</ul>
<p><code>max_connections</code> (default 100) caps the number of backends; it is allocated at startup (restart required) and also sizes shared structures. Raising it to 5,000 does not create capacity — it removes the safety valve.</p>
<p><strong>Application-side pools</strong> keep a fixed number of long-lived connections per application instance and lend them to requests: HikariCP (Java), Npgsql built-in pooling (.NET, on by default), <code>pgxpool</code> (Go), SQLAlchemy <code>QueuePool</code> (Python), node-postgres <code>Pool</code>. Once you have many app instances (e.g. 60 Kubernetes pods × 20 connections = 1,200), you also need a server-side pooler such as PgBouncer (next lesson).</p>`,
  why: `<p>Web applications make many short requests, each needing a database round trip of a few milliseconds. Opening a connection per request would spend most time on setup; keeping one connection per user/thread wastes memory and creates thousands of mostly-idle backends. Pooling decouples <em>client concurrency</em> (thousands) from <em>database concurrency</em> (tens to a few hundred), which is the single most effective change for PostgreSQL stability under load.</p>`,
  useCase: `<p>A .NET + PostgreSQL SaaS on a 16-vCPU server had <code>max_connections = 2000</code> because "we kept hitting the limit". At peak, 1,700 backends existed, 1,450 idle, ~150 active, and p99 latency spiked whenever a burst made 400 active simultaneously (CPU run queue 25+). They set the Npgsql pool to <code>Maximum Pool Size=20</code> per pod (30 pods), put PgBouncer in transaction mode in front with <code>default_pool_size = 40</code>, lowered <code>max_connections</code> to 200, and set <code>idle_in_transaction_session_timeout = '60s'</code>. Peak backends: ~45; p99 dropped from 1.9 s to 85 ms; memory freed allowed raising <code>shared_buffers</code> from 8 GB to 16 GB.</p>`,
  internals: `<p><strong>Fork model:</strong> postmaster forks a backend; it authenticates (pg_hba.conf), attaches to shared memory, builds its relcache/catcache lazily as tables are touched. Memory used by a backend can be inspected with <code>pg_backend_memory_contexts</code> (own backend) or <code>pg_log_backend_memory_contexts(pid)</code> (any backend, logged).</p>
<p><strong>States</strong> in <code>pg_stat_activity.state</code>: <code>active</code> (running a query), <code>idle</code> (waiting for the client), <code>idle in transaction</code> (inside BEGIN, waiting for the client — holds locks and its snapshot holds back VACUUM), <code>idle in transaction (aborted)</code>, <code>fastpath function call</code>, <code>disabled</code>. Only <em>active</em> sessions do work; idle ones still cost memory and slots, idle-in-transaction ones actively harm.</p>
<p><strong>Guardrails</strong> <span class="tag core">core</span>: <code>idle_in_transaction_session_timeout</code> terminates sessions idle inside a transaction; <code>idle_session_timeout</code> (PG14+) terminates idle sessions (careful with poolers that expect long-lived connections); <code>statement_timeout</code> and <code>transaction_timeout</code> (PG17+) bound runaway work; <code>superuser_reserved_connections</code> (default 3) and <code>reserved_connections</code> (PG16+, for roles with <code>pg_use_reserved_connections</code>) keep a few slots for admins when the limit is hit.</p>`,
  whenNot: `<ul><li>A handful of long-running batch workers or a single admin session: pooling adds nothing.</li>
<li>Workloads relying on session state across transactions (temp tables, session advisory locks, <code>LISTEN</code>) need a dedicated connection or a session-mode pool, not a transaction pool.</li>
<li>Don't "fix" pool exhaustion by enlarging pools; first find slow queries and leaked/long transactions holding connections.</li></ul>`,
  syntax: `-- server limits (postgresql.conf; max_connections needs restart)
max_connections = 200
superuser_reserved_connections = 3
idle_in_transaction_session_timeout = '60s'
statement_timeout = '30s'            -- often better per role/app
-- per role
ALTER ROLE app_api SET statement_timeout = '5s';
ALTER ROLE app_api CONNECTION LIMIT 150;

# HikariCP:  maximumPoolSize=20, minimumIdle=20, connectionTimeout=3000, maxLifetime=1800000
# Npgsql:    Host=pgb;Maximum Pool Size=20;Timeout=3;Connection Idle Lifetime=300
# pgx:       postgres://app@pgb/company_db?pool_max_conns=20&pool_max_conn_lifetime=30m
# SQLAlchemy: create_engine(url, pool_size=10, max_overflow=5, pool_pre_ping=True, pool_recycle=1800)`,
  examples: [
    { label: 'Basic', title: 'Who is connected and what are they doing?',
      sql: `SELECT COALESCE(state, backend_type) AS state,
       count(*)                          AS sessions,
       max(now() - state_change)         AS longest_in_state
FROM pg_stat_activity
GROUP BY 1
ORDER BY sessions DESC;`,
      explain: `<p>The first diagnostic for any connection problem. Rows with <code>state</code> NULL are background processes (checkpointer, walwriter...) — grouped here by <code>backend_type</code>. In production you typically see a few <em>active</em>, many <em>idle</em> (pooled, fine if bounded) and hopefully zero long <em>idle in transaction</em>. The sandbox has a single session.</p>`,
      output: ` state  | sessions | longest_in_state
--------+----------+------------------
 active |        1 | 00:00:00
(production: active 14, idle 186, idle in transaction 3, ...)`, run: true },
    { label: 'Intermediate', title: 'What does one backend cost in memory?',
      sql: `-- Private memory of THIS backend right now
SELECT pg_size_pretty(sum(total_bytes)) AS allocated,
       pg_size_pretty(sum(used_bytes))  AS used,
       count(*)                          AS memory_contexts
FROM pg_backend_memory_contexts;

-- Worst-case work_mem budget if every allowed connection ran 2 sort/hash nodes
SELECT current_setting('max_connections')::int                         AS max_conn,
       current_setting('work_mem')                                       AS work_mem,
       pg_size_pretty(current_setting('max_connections')::bigint * 2
                      * pg_size_bytes(current_setting('work_mem')))    AS worst_case_work_mem;`,
      explain: `<p>Even an idle-ish backend holds ~2 MB of contexts here; in production backends that touched hundreds of tables or partitions often hold 10-50 MB in caches. The second query shows why <code>work_mem</code> and <code>max_connections</code> must be sized together: the server can promise far more memory than it has. Pools cap <em>how many</em> backends can be active, which bounds this product.</p>`,
      output: ` allocated | used    | memory_contexts
-----------+---------+-----------------
 1970 kB   | 1114 kB |             133

 max_conn | work_mem | worst_case_work_mem
----------+----------+---------------------
      100 | 4MB      | 800 MB`, run: true },
    { label: 'Advanced', title: 'Guardrails per role, not globally',
      sql: `CREATE ROLE app_api LOGIN CONNECTION LIMIT 150;
ALTER ROLE app_api SET statement_timeout = '5s';
ALTER ROLE app_api SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_api SET lock_timeout = '2s';

CREATE ROLE app_reporting LOGIN CONNECTION LIMIT 10;
ALTER ROLE app_reporting SET statement_timeout = '10min';

SELECT r.rolname, r.rolconnlimit, s.setconfig
FROM pg_roles r
LEFT JOIN pg_db_role_setting s ON s.setrole = r.oid AND s.setdatabase = 0
WHERE r.rolname IN ('app_api', 'app_reporting')
ORDER BY r.rolname;`,
      explain: `<p>Different workloads need different limits: the API must fail fast (5 s) and never sit idle in a transaction, while reporting may run 10-minute queries but only 10 at a time. <code>CONNECTION LIMIT</code> stops one runaway service from consuming all of <code>max_connections</code>. Settings stored with <code>ALTER ROLE ... SET</code> apply at login and are visible in <code>pg_db_role_setting</code>.</p>`,
      output: ` rolname       | rolconnlimit | setconfig
---------------+--------------+------------------------------------------------------------------------------
 app_api       |          150 | {statement_timeout=5s,idle_in_transaction_session_timeout=30s,lock_timeout=2s}
 app_reporting |           10 | {statement_timeout=10min}`, run: true }
  ],
  compare: {
    bad: { sql: `# "We ran out of connections, so:"
max_connections = 3000
# HikariCP maximumPoolSize = 100 on each of 30 pods
# no idle_in_transaction_session_timeout`, why: 'Thousands of mostly idle backends waste memory; bursts make hundreds active at once on 16 cores, collapsing throughput; one leaked transaction can block VACUUM for hours.', run: false },
    good: { sql: `max_connections = 200
idle_in_transaction_session_timeout = '60s'
# HikariCP maximumPoolSize = 10 per pod (30 pods = 300 client conns)
# -> PgBouncer transaction mode, default_pool_size = 40
#    (≈ 2-3x cores of real concurrency to PostgreSQL)`, why: 'Client concurrency is absorbed by pools and queues; PostgreSQL runs a number of active backends it can actually execute efficiently.', run: false }
  },
  mistakes: [
    'Raising <code>max_connections</code> into the thousands instead of pooling.',
    'Pool size per app instance multiplied by the number of instances exceeding <code>max_connections</code> after autoscaling.',
    'Opening a connection per HTTP request (serverless functions without a pooler/proxy).',
    'Holding a pooled connection during slow external calls (HTTP to a payment gateway) inside a transaction — "idle in transaction".',
    'Setting <code>idle_session_timeout</code> globally while using poolers that keep idle connections, causing constant reconnect churn and errors.',
    'No pool <code>connectionTimeout</code> — requests queue forever instead of failing fast.'
  ],
  best: [
    'Start with small pools (≈ 2-4 × cores total active connections at the DB) and measure; bigger is rarely better.',
    'Use a fixed-size pool (min = max) for predictable behaviour; set connection max lifetime (e.g. 30 min) to rebalance after failover.',
    'Keep transactions short; never perform network calls inside a database transaction.',
    'Set per-role timeouts and connection limits; set <code>idle_in_transaction_session_timeout</code>.',
    'Monitor connections by state and pool wait time (HikariCP <code>pending</code> threads, PgBouncer <code>cl_waiting</code>).'
  ],
  performance: `<p>Connection setup with TLS + SCRAM costs ~2-10 ms of client latency and noticeable server CPU; at 2,000 new connections/s that alone can saturate cores. Throughput vs. active connections is a curve that rises until roughly the point where CPU or I/O is saturated and then declines due to contention — pool sizes beyond that point increase latency for everyone. Memory saved by fewer backends is better spent on <code>shared_buffers</code> and OS page cache.</p>`,
  security: `<p>Pools hold authenticated connections for long periods: rotate credentials with overlapping validity, and set <code>maxLifetime</code> so connections re-authenticate. Use separate roles (and pools) per service for least privilege and auditability — a single shared "app" role makes <code>pg_stat_activity</code> and audit logs useless. Connection limits per role also contain the blast radius of a compromised or buggy service.</p>`,
  scenario: { title: 'FATAL: sorry, too many clients already — during a marketing campaign', steps: [
    '1. Superuser connects via reserved slots: SELECT state, usename, count(*) FROM pg_stat_activity GROUP BY 1,2; → 180 idle, 15 active, 2 idle in transaction (12 minutes old).',
    '2. Cause: Kubernetes HPA scaled the API from 10 to 40 pods; each opens a 5-connection minimum pool → 200 connections.',
    '3. Immediate: terminate stale idle-in-transaction sessions; temporarily cap HPA max replicas.',
    '4. Fix: introduce PgBouncer (transaction mode) between pods and PostgreSQL; pods\' pools point to PgBouncer; PgBouncer default_pool_size = 30; max_connections stays 200.',
    '5. Guardrails: idle_in_transaction_session_timeout = 60s for app roles; alert when connections exceed 80% of max_connections.'
  ] },
  widgets: ['diagram:process-model', 'diagram:pgbouncer', 'diagram:client-server'],
  interview: [
    { q: 'Why is a PostgreSQL connection expensive?', a: 'Each connection is a forked OS process with private memory (caches, work_mem allocations), setup costs (TCP, TLS, authentication, fork, cache warm-up), and adds to contention in shared structures. Many concurrent active backends beyond the core count increase context switching and lock contention, reducing throughput.' },
    { q: 'Why can more connections make a database slower?', a: 'Beyond the saturation point of CPU/IO, extra active connections don\'t add capacity; they add contention (LWLocks, buffer mapping), cache misses and context switches, so total throughput falls and latency rises. A pool queues excess work outside the database instead.' },
    { q: 'What is idle in transaction and why is it harmful?', a: 'A session that started a transaction and is waiting for the client without committing. It holds locks (blocking DDL and other writers) and its snapshot prevents VACUUM from removing dead tuples, causing bloat. Use idle_in_transaction_session_timeout and fix app code.' }
  ],
  exercises: [
    { task: 'List sessions per user and state, so you can see which service holds the most connections.', solution: `SELECT usename, state, count(*) AS sessions
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY usename, state
ORDER BY sessions DESC;`, run: true },
    { task: 'Compute how many app pods can run with a per-pod pool of 15 connections if max_connections is 200 and 10 are reserved for admin/monitoring/replication.', solution: `SELECT floor((200 - 10) / 15.0) AS max_pods_without_pgbouncer;`, run: true }
  ],
  challenge: { task: 'Write a query that reports, for every role, its connection limit, current connections and the percent used, flagging roles above 80%.', hint: 'Join pg_roles with an aggregate of pg_stat_activity by usename; rolconnlimit = -1 means unlimited.', solution: `SELECT r.rolname,
       NULLIF(r.rolconnlimit, -1)                         AS conn_limit,
       COALESCE(a.sessions, 0)                            AS current_sessions,
       round(100.0 * COALESCE(a.sessions, 0) / NULLIF(r.rolconnlimit, -1), 1) AS pct_used,
       COALESCE(a.sessions, 0) > 0.8 * NULLIF(r.rolconnlimit, -1)  AS over_80_pct
FROM pg_roles r
LEFT JOIN (SELECT usename, count(*) AS sessions
           FROM pg_stat_activity GROUP BY usename) a ON a.usename = r.rolname
WHERE r.rolcanlogin
ORDER BY current_sessions DESC;`, run: true },
  related: ['connection-pooling-pgbouncer', 'connection-pooling-sizing', 'internals', 'scaling'],
  quiz: [
    { type: 'mcq', q: 'What does PostgreSQL create for each client connection?', options: ['A thread in a shared pool', 'A forked OS backend process', 'A coroutine', 'Nothing until the first query'], answer: 1, explain: 'The postmaster forks one backend process per connection.' },
    { type: 'tf', q: 'Raising max_connections from 200 to 5000 increases the throughput a 16-core server can deliver.', answer: false, explain: 'Capacity is bounded by CPU/IO; more active connections beyond saturation reduce throughput through contention.' },
    { type: 'scenario', q: 'pg_stat_activity shows 40 sessions idle in transaction for 20+ minutes and table bloat rising. Best immediate guardrail?', options: ['Increase work_mem', 'Set idle_in_transaction_session_timeout for the app role and fix the code path', 'Increase max_connections', 'Disable autovacuum'], answer: 1, explain: 'The timeout terminates such sessions, releasing locks and the xmin horizon; then fix the application bug.' },
    { type: 'mcq', q: 'Which value is the best starting point for total active DB connections on an 8-core server with SSDs?', options: ['8-32', '500', '2000', 'Equal to number of app threads'], answer: 0, explain: 'Roughly 2-4× cores of active connections is a common efficient range; measure from there.' }
  ]
},
{
  id: 'connection-pooling-pgbouncer',
  module: 'connection-pooling',
  title: 'PgBouncer: Session, Transaction and Statement Pooling — and What Breaks',
  level: 5,
  minutes: 35,
  summary: 'PgBouncer (third-party) multiplexes thousands of client connections onto a few server connections; learn its pooling modes, what session features break in transaction mode, prepared statement support since 1.21, and safe patterns.',
  objectives: [
    'Explain how PgBouncer multiplexes client connections onto server connections',
    'Choose between session, transaction and statement pooling modes',
    'List session features that break in transaction mode (SET, session advisory locks, LISTEN, temp tables, WITH HOLD cursors, SQL PREPARE)',
    'Enable protocol-level prepared statement support with max_prepared_statements (PgBouncer 1.21+)',
    'Rewrite application patterns to be transaction-pooling safe',
    'Configure authentication (auth_type, auth_query) and the admin console'
  ],
  concept: `<p><strong>PgBouncer</strong> <span class="tag tool">third-party tool</span> is a lightweight, single-threaded, event-driven connection pooler. Clients connect to PgBouncer exactly as if it were PostgreSQL (same wire protocol, usually port 6432); PgBouncer keeps a small pool of real server connections per (database, user) pair and assigns them to clients only when needed. A few KB of memory per client connection lets one PgBouncer hold 10,000+ client connections while PostgreSQL sees 20-100 backends.</p>
<p><strong>Analogy:</strong> a call centre switchboard. Thousands of customers are "on the line" (client connections), but only 30 agents (server connections) exist. In <em>session</em> mode a customer keeps their agent until they hang up; in <em>transaction</em> mode they get an agent for one conversation topic (a transaction) and are put back in the queue afterwards — a different agent may answer next time, who doesn't remember what was said before.</p>
<table><tr><th>pool_mode</th><th>Server connection is returned to the pool…</th><th>Use when</th></tr>
<tr><td><code>session</code></td><td>when the client disconnects</td><td>apps needing full session semantics; fixes connection-setup cost, not concurrency</td></tr>
<tr><td><code>transaction</code></td><td>after each transaction (COMMIT/ROLLBACK, or each autocommit statement)</td><td>the standard choice for web/OLTP apps — biggest multiplexing gain</td></tr>
<tr><td><code>statement</code></td><td>after each statement; multi-statement transactions are disallowed</td><td>rare: autocommit-only workloads (e.g. some PL/Proxy setups)</td></tr></table>
<p><strong>What breaks in transaction mode</strong> — anything that relies on <em>session state</em> surviving between transactions, because the next transaction may run on a different backend:</p>
<ul>
<li><code>SET</code> / <code>RESET</code> of session parameters (<code>SET search_path</code>, <code>SET statement_timeout</code>) — leaks to other clients and is lost for you. Use <code>SET LOCAL</code> inside the transaction, or role/database defaults, or connection startup parameters PgBouncer tracks (<code>client_encoding</code>, <code>DateStyle</code>, <code>TimeZone</code>, <code>standard_conforming_strings</code>, <code>application_name</code>, plus extra ones via <code>track_extra_parameters</code> in 1.20+).</li>
<li><strong>Session-level advisory locks</strong> (<code>pg_advisory_lock</code>) — the lock stays on a backend you no longer own. Use <code>pg_advisory_xact_lock</code>.</li>
<li><code>LISTEN</code>/<code>NOTIFY</code> receiving — <code>LISTEN</code> registers on a backend you lose after the transaction. Use a dedicated direct (or session-pooled) connection for listeners. (<code>NOTIFY</code> sending works.)</li>
<li>Temporary tables kept across transactions, <code>WITH HOLD</code> cursors, session variables via <code>set_config(..., false)</code>.</li>
<li><strong>Prepared statements</strong>: historically broken. Since <strong>PgBouncer 1.21</strong>, setting <code>max_prepared_statements</code> &gt; 0 lets PgBouncer track <em>protocol-level</em> named prepared statements (Parse/Bind/Execute used by drivers like JDBC, Npgsql, pgx, asyncpg) and transparently prepare them on whichever server connection is used. SQL-level <code>PREPARE</code>/<code>EXECUTE</code> statements are still not supported.</li>
</ul>`,
  why: `<p>Application-side pools fix per-instance connection churn but multiply with the number of instances: 200 pods × 10 = 2,000 connections. PgBouncer sits between them and PostgreSQL and turns that into a few dozen backends doing real work, absorbs reconnect storms after deployments or failovers, and allows pausing traffic for maintenance (<code>PAUSE</code>/<code>RESUME</code>) — e.g. a switchover without clients seeing errors.</p>`,
  useCase: `<p>A Django + Celery platform with 120 web pods and 80 workers (each with a few connections) generated ~1,400 client connections to a 32-core PostgreSQL. With PgBouncer in transaction mode on each DB node (behind HAProxy), <code>default_pool_size = 60</code>, PostgreSQL ran ~60-90 backends. Two problems surfaced in testing: a migration library used <code>pg_advisory_lock</code> (session) — fixed by running migrations through a direct connection; and a feature using <code>SET search_path</code> per tenant — rewritten to <code>SET LOCAL search_path</code> at the start of each transaction. After upgrading to PgBouncer 1.22 with <code>max_prepared_statements = 200</code>, they re-enabled server-side prepared statements in the driver, cutting CPU 18% on hot queries.</p>`,
  internals: `<p>PgBouncer is single-threaded (libevent); one process typically handles 10-50k queries/s depending on query size. Scale by running several processes on the same port with <code>so_reuseport = 1</code>, or several instances behind a load balancer. Pools are keyed by (database, user); <code>default_pool_size</code> server connections per pool, <code>min_pool_size</code> pre-opened, <code>reserve_pool_size</code> extra connections allowed after clients wait <code>reserve_pool_timeout</code> seconds. <code>max_client_conn</code> caps client connections; <code>max_db_connections</code>/<code>max_user_connections</code> cap server connections across pools.</p>
<p>In session mode PgBouncer runs <code>server_reset_query</code> (default <code>DISCARD ALL</code>) when a client releases the connection; in transaction mode it is not used by default (no session state is supposed to exist). <code>server_check_query</code> validates idle server connections, <code>server_lifetime</code> recycles them (default 3600 s), <code>server_idle_timeout</code> closes idle ones.</p>
<p><strong>Authentication</strong>: <code>auth_type = scram-sha-256</code>, users in <code>auth_file</code> (userlist.txt) or looked up dynamically via <code>auth_query</code> (e.g. a SECURITY DEFINER function returning <code>usename, passwd</code> from <code>pg_shadow</code>) using <code>auth_user</code>. The admin console is a virtual database <code>pgbouncer</code>: <code>SHOW POOLS</code>, <code>SHOW STATS</code>, <code>SHOW CLIENTS</code>, <code>SHOW SERVERS</code>, <code>PAUSE</code>, <code>RESUME</code>, <code>RELOAD</code>, <code>RECONNECT</code>.</p>`,
  whenNot: `<ul><li>Workloads that fundamentally need session state (long-lived <code>LISTEN</code> consumers, session temp tables across transactions, apps that <code>SET</code> per session and can't change) — use session mode or direct connections for those components.</li>
<li>A single application with a well-sized internal pool and few instances: PgBouncer adds a hop and an operational component for little gain.</li>
<li>Very long transactions (analytics, migrations): they pin a server connection for their duration anyway — route them around PgBouncer or to a separate pool.</li>
<li>Alternatives: Pgpool-II <span class="tag tool">third-party tool</span> (pooling + routing, heavier), Odyssey and PgCat/Supavisor <span class="tag tool">third-party tool</span> (multi-threaded poolers), RDS Proxy (managed).</li></ul>`,
  syntax: `; pgbouncer.ini (third-party tool) — minimal transaction-pooling setup
[databases]
company_db = host=127.0.0.1 port=5432 dbname=company_db

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 5000
default_pool_size = 40
max_prepared_statements = 200        ; PgBouncer 1.21+
admin_users = pgbouncer_admin

; connect: psql "host=pgb port=6432 dbname=company_db user=app"
; admin:   psql "host=pgb port=6432 dbname=pgbouncer user=pgbouncer_admin" -c "SHOW POOLS;"`,
  examples: [
    { label: 'Basic', title: 'Production pgbouncer.ini with annotations',
      sql: `[databases]
; route by logical name; HAProxy :5000 always points to the current primary
company_db     = host=haproxy.internal port=5000 dbname=company_db
company_db_ro  = host=haproxy.internal port=5001 dbname=company_db pool_size=30

[pgbouncer]
listen_addr          = 0.0.0.0
listen_port          = 6432
unix_socket_dir      = /var/run/postgresql
so_reuseport         = 1              ; allow several pgbouncer processes on one port

auth_type            = scram-sha-256
auth_user            = pgbouncer_auth ; looks up passwords via auth_query
auth_query           = SELECT usename, passwd FROM pgbouncer.get_auth($1)

pool_mode            = transaction
max_client_conn      = 5000
default_pool_size    = 40
min_pool_size        = 10
reserve_pool_size    = 10
reserve_pool_timeout = 3              ; seconds a client waits before reserve kicks in
max_db_connections   = 80             ; hard cap of server conns per database
max_prepared_statements = 200

server_lifetime      = 3600
server_idle_timeout  = 600
query_wait_timeout   = 30             ; client gets an error after waiting 30 s for a server conn
client_tls_sslmode   = require
server_tls_sslmode   = verify-full
admin_users          = pgbouncer_admin
stats_users          = monitoring`,
      explain: `<p>Two logical databases separate write and read traffic. <code>auth_query</code> avoids maintaining a userlist file for every role. <code>query_wait_timeout</code> turns a silent queue into a fast, visible error when the database is saturated. <code>max_db_connections</code> protects PostgreSQL even if someone adds pools. TLS on both legs. Configuration file of a third-party tool — not runnable here.</p>`,
      output: `$ psql -h pgb -p 6432 -U pgbouncer_admin pgbouncer -c "SHOW POOLS;"
 database      | user | cl_active | cl_waiting | sv_active | sv_idle | sv_used | maxwait | pool_mode
---------------+------+-----------+------------+-----------+---------+---------+---------+-------------
 company_db    | app  |      1830 |          0 |        27 |      13 |       0 |       0 | transaction
 company_db_ro | app  |       410 |          0 |         9 |      21 |       0 |       0 | transaction`, run: false },
    { label: 'Intermediate', title: 'Transaction-mode-safe versions of session features',
      sql: `-- UNSAFE in transaction pooling: SET search_path ...; SET statement_timeout ...;
-- SAFE: everything scoped to the transaction
BEGIN;
SET LOCAL search_path = public;
SET LOCAL statement_timeout = '3s';
-- serialize a job per customer with a TRANSACTION-level advisory lock
SELECT pg_advisory_xact_lock(hashtext('invoice-run'), 42) AS locked_customer_42;
SELECT count(*) AS open_orders
FROM orders WHERE customer_id = 42 AND status IN ('pending', 'paid');
COMMIT;   -- lock and settings released automatically

-- After COMMIT nothing leaks to the next client on this server connection
SHOW statement_timeout;`,
      explain: `<p>The rule for transaction pooling: <strong>all state must begin and end inside one transaction</strong>. <code>SET LOCAL</code> resets at COMMIT/ROLLBACK; <code>pg_advisory_xact_lock</code> releases automatically at transaction end (the two-key form lets you namespace locks). Run as one transaction, this behaves identically with or without PgBouncer.</p>`,
      output: `BEGIN
SET
SET
 locked_customer_42
--------------------
 (void)
 open_orders
-------------
           4
COMMIT
 statement_timeout
-------------------
 0`, run: true },
    { label: 'Advanced', title: 'Audit a session for state that transaction pooling would break',
      sql: `-- Simulate an app that uses session features
PREPARE top_customers(text) AS
  SELECT id, name FROM customers WHERE country = $1 ORDER BY id LIMIT 3;
LISTEN order_events;
SELECT pg_advisory_lock(777);
SET application_name = 'billing-worker';

-- What session state exists right now?
SELECT 'prepared statement' AS kind, name AS detail FROM pg_prepared_statements
UNION ALL
SELECT 'LISTEN channel', pg_listening_channels()
UNION ALL
SELECT 'session advisory lock', objid::text
FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
UNION ALL
SELECT 'non-default setting', name || '=' || setting
FROM pg_settings WHERE source = 'session';

-- clean up (these objects are session-scoped and survive ROLLBACK)
DEALLOCATE top_customers;
UNLISTEN *;
SELECT pg_advisory_unlock(777);
RESET application_name;`,
      explain: `<p>Each row is something that would silently misbehave behind a transaction pooler: the SQL-level prepared statement would not exist on the next backend (and PgBouncer's <code>max_prepared_statements</code> only covers protocol-level prepares), notifications would go to a backend nobody reads, the advisory lock would stay held by a backend now serving someone else, and the session setting would leak. Run this kind of audit (or grep your code) before switching a service to transaction mode. Note that <code>LISTEN</code> inside a transaction block only takes effect at commit, so the channel may not appear when the example runs as one rolled-back unit.</p>`,
      output: ` kind                  | detail
-----------------------+------------------------------
 prepared statement    | top_customers
 LISTEN channel        | order_events
 session advisory lock | 777
 non-default setting   | application_name=billing-worker
 ...`, run: true }
  ],
  compare: {
    bad: { sql: `-- Multi-tenant app behind PgBouncer (transaction mode)
SET search_path = tenant_17;           -- runs as its own autocommit "transaction"
SELECT * FROM invoices WHERE id = 5;   -- may run on a DIFFERENT backend
-- → reads public.invoices or another tenant's search_path`, why: 'The SET and the SELECT can be executed on different server connections; worse, the SET leaks into whichever client gets that backend next — a cross-tenant data exposure risk.', run: false },
    good: { sql: `BEGIN;
SET LOCAL search_path = public;   -- e.g. tenant schema in a real app
SELECT id, status FROM orders WHERE id = 5;
COMMIT;`, why: 'SET LOCAL lives exactly as long as the transaction that PgBouncer pins to one server connection, so there is no leakage and no misrouting.', run: true }
  },
  mistakes: [
    'Switching to transaction mode without auditing for <code>SET</code>, session advisory locks, <code>LISTEN</code>, temp tables and SQL <code>PREPARE</code>.',
    'Assuming <code>max_prepared_statements</code> also covers SQL-level <code>PREPARE</code>/<code>EXECUTE</code> — it covers protocol-level (driver) prepared statements only.',
    'Running a single PgBouncer process at 100% CPU (it is single-threaded) and blaming PostgreSQL; use <code>so_reuseport</code> with several processes.',
    'Pool size × number of PgBouncer instances exceeding <code>max_connections</code>.',
    'Running schema migrations (which often use session advisory locks) through a transaction pooler.',
    'Leaving <code>query_wait_timeout</code> at its default (120 s) so overload manifests as hanging requests instead of fast errors.'
  ],
  best: [
    'Use transaction mode for web/OLTP; give LISTEN consumers, migrations and long analytics their own direct or session-mode connections.',
    'Prefer <code>SET LOCAL</code>, role-level defaults (<code>ALTER ROLE ... SET</code>), and transaction-scoped advisory locks.',
    'Upgrade to PgBouncer ≥ 1.21 and set <code>max_prepared_statements</code> (e.g. 100-500) to keep driver-side prepared statements.',
    'Run PgBouncer redundantly (sidecars or ≥2 instances) — never a single central VM.',
    'Monitor <code>SHOW POOLS</code> (<code>cl_waiting</code>, <code>maxwait</code>) and <code>SHOW STATS</code> (avg_wait_time); alert on sustained waiting.'
  ],
  performance: `<p>PgBouncer adds ~0.1-0.3 ms per round trip (an extra network hop and parsing of protocol messages) — negligible compared to the savings from fewer backends and no connection setup. Transaction mode gives the highest multiplexing: a 2,000-client app with 5 ms transactions and 2,000 tx/s needs only ~10 busy server connections (Little's law). Without protocol prepared statement support, drivers must use unnamed statements or simple protocol, costing re-planning CPU on every query; PgBouncer 1.21+ removes that penalty.</p>`,
  security: `<p>PgBouncer terminates client authentication: configure <code>auth_type = scram-sha-256</code> and TLS on client and server sides. Protect <code>userlist.txt</code> (it contains SCRAM secrets) or use <code>auth_query</code> with a restricted SECURITY DEFINER lookup function. In transaction mode, session-state leakage (<code>SET role</code>, <code>SET search_path</code>, <code>set_config(..., false)</code>) can cross tenant boundaries — forbid session-level <code>SET</code> in code review. Restrict the admin console (<code>admin_users</code>) — <code>SHUTDOWN</code> and <code>KILL</code> are available there.</p>`,
  scenario: { title: 'After moving to PgBouncer transaction mode, a nightly job runs twice', steps: [
    '1. Symptom: invoices generated in duplicate on some nights since the PgBouncer rollout.',
    '2. The job used SELECT pg_try_advisory_lock(1001) as a "singleton" guard and kept the lock for its run.',
    '3. Behind transaction pooling, the lock was taken on backend A by an autocommit statement; the job\'s subsequent statements ran on backends B, C...; a second scheduler instance connected and also acquired... on backend B — success, because the lock was held by A, which now serves other clients, and a later pg_advisory_unlock ran on a different backend (returned false with a warning).',
    '4. Fix: run the singleton job through a direct (or session-mode) connection, or restructure into one transaction with pg_advisory_xact_lock, or use a lease row (UPDATE ... WHERE expires_at < now()).',
    '5. Add a CI lint rule flagging pg_advisory_lock, LISTEN, and session SET in code paths that use the pooled DSN.'
  ] },
  widgets: ['diagram:pgbouncer', 'diagram:process-model'],
  interview: [
    { q: 'Explain PgBouncer\'s three pooling modes.', a: 'Session: a client keeps one server connection until it disconnects — full compatibility, limited multiplexing. Transaction: the server connection is assigned per transaction and returned at COMMIT/ROLLBACK — high multiplexing, but no session state across transactions. Statement: returned after each statement; multi-statement transactions are not allowed.' },
    { q: 'What breaks in transaction pooling mode?', a: 'Session-level SET/RESET, session advisory locks, LISTEN, temp tables and WITH HOLD cursors across transactions, session variables via set_config(..., false), and SQL-level PREPARE. Protocol-level prepared statements work since PgBouncer 1.21 with max_prepared_statements > 0.' },
    { q: 'How do you scale PgBouncer beyond one CPU core?', a: 'Run multiple PgBouncer processes sharing the port with so_reuseport = 1, or several instances behind a load balancer/sidecars, keeping total server connections under max_connections via max_db_connections and pool sizes.' },
    { q: 'How can PgBouncer help with a zero-error switchover?', a: 'Issue PAUSE (waits for in-flight transactions to finish and holds new ones), switch the backend target (e.g. after promoting the standby), then RESUME. Clients experience a brief delay instead of connection errors.' }
  ],
  exercises: [
    { task: 'Rewrite this session-level setting so it is safe behind a transaction pooler, and verify it reverts: SET statement_timeout = \'2s\'; SELECT count(*) FROM orders;', solution: `BEGIN;
SET LOCAL statement_timeout = '2s';
SELECT count(*) FROM orders;
COMMIT;
SHOW statement_timeout;`, run: true },
    { task: 'Take a transaction-scoped advisory lock keyed on the order id 5000, then show it in pg_locks within the same transaction.', solution: `BEGIN;
SELECT pg_advisory_xact_lock(5000);
SELECT locktype, objid, mode, granted FROM pg_locks WHERE locktype = 'advisory';
COMMIT;`, run: true }
  ],
  challenge: { task: 'Implement a pooler-safe "run once at a time" guard for a job named invoice-run: inside a single transaction, try to take a transaction-level advisory lock without waiting; if it was acquired, record a run in a job_runs table; otherwise record nothing. Return whether this invocation acquired the lock.', hint: 'pg_try_advisory_xact_lock returns boolean; use it in a CTE and INSERT ... SELECT WHERE acquired.', solution: `CREATE TABLE job_runs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job text, started_at timestamptz DEFAULT now());

BEGIN;
WITH guard AS (SELECT pg_try_advisory_xact_lock(hashtext('invoice-run')) AS acquired)
INSERT INTO job_runs (job)
SELECT 'invoice-run' FROM guard WHERE acquired
RETURNING id, job;
-- ... do the work inside this same transaction ...
COMMIT;`, run: true },
  related: ['connection-pooling-why', 'connection-pooling-sizing', 'high-availability-patroni', 'transactions'],
  quiz: [
    { type: 'mcq', q: 'In transaction pooling mode, when is a server connection returned to the pool?', options: ['When the client disconnects', 'At the end of each transaction', 'After each statement only', 'Never'], answer: 1, explain: 'Transaction mode releases the server connection at COMMIT/ROLLBACK (or after an autocommit statement).' },
    { type: 'tf', q: 'PgBouncer 1.21+ with max_prepared_statements > 0 supports SQL-level PREPARE/EXECUTE statements in transaction mode.', answer: false, explain: 'It supports protocol-level named prepared statements (as used by drivers), not SQL PREPARE commands.' },
    { type: 'bug', q: 'Behind PgBouncer in transaction mode, why is this unsafe?', code: `SELECT pg_advisory_lock(42);
UPDATE inventory SET stock = stock - 1 WHERE product_id = 42;
SELECT pg_advisory_unlock(42);`, options: ['Advisory locks need superuser', 'Each autocommit statement may run on a different backend, so the lock is held on one backend while others run the UPDATE/unlock', 'UPDATE cannot follow SELECT', 'Advisory locks are deprecated'], answer: 1, explain: 'Use a single transaction with pg_advisory_xact_lock.' },
    { type: 'mcq', q: 'Which SHOW POOLS column indicates clients queued waiting for a server connection?', options: ['sv_idle', 'cl_active', 'cl_waiting', 'sv_used'], answer: 2, explain: 'cl_waiting > 0 sustained (with maxwait growing) means the pool is too small or queries are too slow.' },
    { type: 'design', q: 'A service consumes LISTEN notifications and also runs many short API queries. Best setup with PgBouncer?', options: ['Everything through transaction pooling', 'API through transaction pooling; the LISTEN consumer uses a direct or session-mode connection', 'Disable NOTIFY', 'Statement pooling for everything'], answer: 1, explain: 'LISTEN needs a stable session; the bulk of short queries benefits from transaction pooling.' }
  ]
},
{
  id: 'connection-pooling-sizing',
  module: 'connection-pooling',
  title: 'Pool Sizing Math: Cores, Little\'s Law, pgbouncer.ini and SHOW POOLS',
  level: 5,
  minutes: 25,
  summary: 'Size pools with numbers instead of guesses — the (cores × 2) + effective spindles heuristic, Little\'s law L = λW, a full layered connection budget, and how to read SHOW POOLS / SHOW STATS to tune.',
  objectives: [
    'Apply the (core_count × 2) + effective_spindle_count heuristic and know its limits',
    'Use Little\'s law to compute required concurrency from throughput and latency',
    'Build a connection budget across app pools, PgBouncer and max_connections',
    'Read SHOW POOLS and SHOW STATS to detect undersized or oversized pools',
    'Load-test to find the throughput knee'
  ],
  concept: `<p>How many connections should PostgreSQL actually work on at once? Two tools give a starting point:</p>
<p><strong>1. The core heuristic</strong> (popularised by the HikariCP project): <code>connections = (core_count × 2) + effective_spindle_count</code>. Rationale: each core can run one backend while another waits on I/O; spindles (disks that can serve independent requests) add more useful concurrency. On a 16-core server with SSD storage, start around 32-40 active connections. With fast NVMe and an I/O-heavy workload the effective "spindle" count is higher; with a CPU-bound workload fully cached in RAM it's closer to cores × 1-2.</p>
<p><strong>2. Little's law</strong>: <strong>L = λ × W</strong> — the average number of items in a system equals arrival rate × time each spends in it. For databases: <em>busy connections</em> = <em>transactions per second</em> × <em>average transaction duration (seconds)</em>. 3,000 TPS × 0.008 s = 24 connections busy on average. Add headroom for bursts and variance (×1.5-2) → ~40-50.</p>
<p><strong>Analogy:</strong> a toll plaza. If 30 cars arrive per minute and each takes 2 minutes at a booth, on average 60 booths are occupied. More booths than that sit empty; fewer means queues. But if the road behind the booths (CPU/disk) can only carry 40 cars at a time, building 60 booths just moves the jam onto the road.</p>
<p>The two must agree: Little's law tells you the concurrency the workload <em>needs</em>; the core heuristic tells you the concurrency the hardware can <em>serve</em> efficiently. If needed &gt; serveable, a bigger pool won't help — make transactions shorter (query tuning, fewer round trips) or scale hardware.</p>
<p><strong>Layered budget</strong>: <code>max_connections</code> ≥ (PgBouncer server connections across all instances and pools) + direct connections (migrations, admin, monitoring, replication walsenders are separate from <code>max_connections</code> but count toward process limits) + <code>superuser_reserved_connections</code>. Client-side app pools only need to be large enough to keep PgBouncer fed — they don't hit PostgreSQL directly.</p>`,
  why: `<p>Pools sized by guesswork are either too small (requests queue, timeouts) or — far more common — too large (contention, memory pressure, latency collapse under bursts, connection exhaustion after autoscaling). A few lines of arithmetic, verified by a load test, produce stable systems and give you numbers to defend in design reviews.</p>`,
  useCase: `<p>A ticketing company expects 6,000 TPS at a concert on-sale, average transaction 6 ms, p99 25 ms, on a 32-vCPU (16 physical cores) primary with NVMe. Little's law: 6,000 × 0.006 = 36 busy connections on average; bursts → ~60. Core heuristic: 16 × 2 + ~8 ≈ 40 on physical cores, ~70 counting vCPUs. They set PgBouncer <code>default_pool_size = 60</code>, <code>reserve_pool_size = 10</code>, <code>max_db_connections = 80</code> across 2 PgBouncer instances (40 each), <code>max_connections = 200</code>. Load testing at 7,000 TPS showed throughput flat between pool sizes 48 and 80, and p99 rising sharply above 96 — confirming the chosen range.</p>`,
  internals: `<p><strong>Why throughput falls beyond the knee:</strong> more active backends than cores → OS scheduler time-slicing; CPU caches thrash; contention on LWLocks (buffer mapping, WAL insertion, lock manager partitions) grows superlinearly; more concurrent dirty buffers compete for I/O. The Universal Scalability Law models this as throughput X(N) = λN / (1 + σ(N−1) + κN(N−1)) — contention σ and coherency κ eventually make X decrease as N grows.</p>
<p><strong>Reading PgBouncer stats</strong> <span class="tag tool">third-party tool</span>: <code>SHOW POOLS</code> — <code>cl_active</code> (clients paired with a server conn or idle), <code>cl_waiting</code> (clients waiting for a server conn), <code>sv_active</code> (server conns in use), <code>sv_idle</code> (available), <code>maxwait</code>/<code>maxwait_us</code> (oldest waiting client). <code>SHOW STATS</code> — per database <code>total_xact_count</code>, <code>avg_xact_time</code>, <code>avg_query_time</code>, <code>avg_wait_time</code> (µs clients waited for a server connection). Sustained <code>cl_waiting &gt; 0</code> with <code>sv_idle = 0</code> means demand exceeds pool size — check whether the DB has spare capacity before increasing it.</p>`,
  whenNot: `<ul><li>Don't apply the heuristic blindly to long-running analytical queries: each may use parallel workers (<code>max_parallel_workers_per_gather</code>), so 8 concurrent queries can already saturate 32 cores.</li>
<li>Don't size for the theoretical peak of every service simultaneously; use measured concurrency and queueing.</li>
<li>If Little's law says you need 500 busy connections, the fix is shorter transactions or more hardware/shards — not a 500-connection pool.</li></ul>`,
  syntax: `-- Little's law:            busy_connections = TPS × avg_txn_seconds
-- Core heuristic:          pool = cores × 2 + effective_spindles
-- Budget:                  max_connections ≥ Σ(pgbouncer pools × instances) + direct + reserved

; pgbouncer.ini
default_pool_size  = 40
reserve_pool_size  = 10
max_db_connections = 80
max_client_conn    = 5000

-- admin console (PgBouncer)
SHOW POOLS;  SHOW STATS;  SHOW CLIENTS;  SHOW SERVERS;  SHOW CONFIG;`,
  examples: [
    { label: 'Basic', title: 'Little\'s law for several services',
      sql: `SELECT service, tps, avg_txn_ms,
       round(tps * avg_txn_ms / 1000.0, 1)        AS avg_busy_conns,      -- L = λW
       ceil(tps * avg_txn_ms / 1000.0 * 1.75)     AS pool_with_headroom   -- burst factor
FROM (VALUES ('checkout-api',   1200,  9.0),
             ('catalog-api',    4500,  2.5),
             ('order-history',   800, 14.0),
             ('nightly-export',    5, 4000.0)) AS s(service, tps, avg_txn_ms)
ORDER BY avg_busy_conns DESC;`,
      explain: `<p>Throughput alone says nothing; the product with duration does. The catalog API has the highest TPS but needs only ~11 busy connections because its transactions are 2.5 ms; the nightly export at 5 TPS needs 20 because each transaction takes 4 seconds. The 1.75 burst factor is a starting assumption — calibrate it from measured p95 concurrency.</p>`,
      output: ` service        | tps  | avg_txn_ms | avg_busy_conns | pool_with_headroom
----------------+------+------------+----------------+--------------------
 nightly-export |    5 |     4000.0 |           20.0 |                 35
 catalog-api    | 4500 |        2.5 |           11.3 |                 20
 order-history  |  800 |       14.0 |           11.2 |                 20
 checkout-api   | 1200 |        9.0 |           10.8 |                 19`, run: true },
    { label: 'Intermediate', title: 'End-to-end connection budget',
      sql: `WITH layers(layer, count_per_unit, units) AS (
  VALUES ('app pods → PgBouncer (client conns)',   10, 60),   -- 60 pods × 10
         ('PgBouncer → PostgreSQL (server conns)', 40,  2),   -- 2 instances × default_pool_size
         ('PgBouncer reserve pool',                10,  2),
         ('direct: migrations / cron / admin',     10,  1),
         ('monitoring exporters',                   3,  1),
         ('superuser_reserved_connections',         3,  1)
)
SELECT layer, count_per_unit * units AS connections,
       CASE WHEN layer LIKE 'app pods%' THEN 'terminates at PgBouncer'
            ELSE 'counts toward max_connections' END AS where_it_counts
FROM layers
UNION ALL
SELECT 'REQUIRED max_connections (min)',
       sum(count_per_unit * units) FILTER (WHERE layer NOT LIKE 'app pods%'),
       'set max_connections ≥ this + ~25% growth'
FROM layers;`,
      explain: `<p>600 client connections from the apps collapse into at most 100 server connections (2 × (40 + 10)), plus 16 for direct/monitoring/reserved: ~116, so <code>max_connections = 150-200</code> is ample. When autoscaling doubles the pods to 120, client connections double to 1,200 but PostgreSQL still sees ≤ 116 — that is the point of the pooler tier.</p>`,
      output: ` layer                                  | connections | where_it_counts
----------------------------------------+-------------+------------------------------------------
 app pods → PgBouncer (client conns)    |         600 | terminates at PgBouncer
 PgBouncer → PostgreSQL (server conns)  |          80 | counts toward max_connections
 PgBouncer reserve pool                 |          20 | counts toward max_connections
 direct: migrations / cron / admin      |          10 | counts toward max_connections
 monitoring exporters                   |           3 | counts toward max_connections
 superuser_reserved_connections         |           3 | counts toward max_connections
 REQUIRED max_connections (min)         |         116 | set max_connections ≥ this + ~25% growth`, run: true },
    { label: 'Advanced', title: 'Interpreting SHOW POOLS / SHOW STATS during an incident',
      sql: `-- psql -h pgb -p 6432 -U monitoring pgbouncer
SHOW POOLS;
--  database   | user | cl_active | cl_waiting | sv_active | sv_idle | sv_used | maxwait | maxwait_us | pool_mode
-- ------------+------+-----------+------------+-----------+---------+---------+---------+------------+-------------
--  company_db | app  |      1450 |        310 |        40 |       0 |       0 |       4 |     512000 | transaction

SHOW STATS;
--  database   | total_xact_count | avg_xact_count | avg_xact_time | avg_query_time | avg_wait_time
-- ------------+------------------+----------------+---------------+----------------+---------------
--  company_db |       9134221004 |           2950 |         13560 |           4200 |        96000

-- Diagnosis: sv_active = pool size (40), sv_idle = 0, 310 clients waiting up to 4.5 s.
-- avg_xact_time 13.6 ms but avg_query_time 4.2 ms → ~9 ms per transaction spent OUTSIDE
-- queries (app think time / network round trips while holding the transaction open).
-- Little: 2950 tx/s × 0.0136 s ≈ 40 → the pool is exactly saturated.`,
      explain: `<p>Before enlarging the pool, ask why each transaction holds a connection for 13.6 ms when its queries take 4.2 ms: the app is doing work between statements inside the transaction (ORM lazy loading, external calls). Fixing that to ~5 ms per transaction would halve required connections. If the database CPU is already high, increasing the pool would only add contention. PgBouncer admin output — not runnable here (times in µs).</p>`,
      output: `Action taken: moved an HTTP call out of the transaction and batched 6 ORM queries into 1
→ avg_xact_time 5.1 ms, cl_waiting 0, sv_active ~16 at the same 2950 tx/s.`, run: false }
  ],
  compare: {
    bad: { sql: `; "Clients are waiting, double the pool!"
default_pool_size = 200
; DB: 16 cores already at 95% CPU`, why: '200 concurrent active queries on 16 cores means heavy time-slicing and LWLock contention: throughput drops and p99 latency explodes. The wait moved from PgBouncer (cheap) into PostgreSQL (expensive).', run: false },
    good: { sql: `; Keep the pool near the throughput knee and fix the demand
default_pool_size = 40
query_wait_timeout = 10      ; fail fast instead of piling up
; + shorten transactions, add the missing index, cache hot reads`, why: 'Queueing at the pooler is cheap and bounded; reducing per-transaction time increases throughput at the same concurrency (Little\'s law).', run: false }
  },
  mistakes: [
    'Sizing pools from thread counts ("the app has 200 threads, so 200 connections").',
    'Forgetting that each PgBouncer instance has its own pools — 4 instances × 50 = 200 server connections.',
    'Ignoring parallel query workers when estimating CPU concurrency for analytical workloads.',
    'Increasing the pool when the database is already CPU-saturated.',
    'Not load testing: the knee depends on workload, hardware and PostgreSQL version.'
  ],
  best: [
    'Start from Little\'s law with measured TPS and transaction time; cross-check with cores × 2 + spindles.',
    'Load-test pool sizes (e.g. 16, 32, 48, 64, 96) and pick the smallest size at peak throughput.',
    'Set <code>max_db_connections</code> as a hard safety cap and <code>query_wait_timeout</code> to fail fast.',
    'Track <code>avg_xact_time</code> vs <code>avg_query_time</code> — the gap is time connections are held idle inside transactions.',
    'Separate pools (or databases in PgBouncer) for OLTP and reporting so long queries can\'t starve short ones.'
  ],
  performance: `<p>The goal is maximum throughput at acceptable p99. Below the knee, adding connections increases throughput nearly linearly; at the knee throughput plateaus; beyond it latency grows and throughput may fall. Queueing in PgBouncer costs microseconds per waiting client; queueing inside PostgreSQL costs CPU and locks. Shortening transactions is the highest-leverage optimization: halving W halves L for the same λ.</p>`,
  security: `<p>Pool limits are also a denial-of-service defence: <code>max_client_conn</code>, <code>max_db_connections</code>, role <code>CONNECTION LIMIT</code> and <code>query_wait_timeout</code> prevent one misbehaving client from exhausting the database. Give the monitoring user only <code>stats_users</code> rights in PgBouncer, not <code>admin_users</code>.</p>`,
  scenario: { title: 'p99 latency jumps from 40 ms to 2 s at 9 a.m. every Monday', steps: [
    '1. SHOW POOLS at 09:02: cl_waiting 250, sv_active 40 (= pool size), sv_idle 0, maxwait 2 s.',
    '2. PostgreSQL CPU only 45% → the DB has spare capacity; the pool is the bottleneck for this burst.',
    '3. SHOW STATS: avg_xact_time 18 ms vs avg_query_time 6 ms → transactions hold connections 3× longer than needed.',
    '4. Short term: raise default_pool_size 40 → 56 (still below the measured knee of ~70) and reserve_pool_size 10.',
    '5. Long term: fix the "load dashboard" endpoint that runs 12 queries in one transaction with app-side processing between them; p99 returns to 45 ms with the original pool size.'
  ] },
  widgets: ['diagram:pgbouncer', 'lab:txn'],
  interview: [
    { q: 'How do you choose a connection pool size?', a: 'Estimate needed concurrency with Little\'s law (TPS × average transaction time, plus burst headroom), compare with what the hardware serves efficiently (≈ cores × 2 + effective spindles), then load-test around that value and choose the smallest pool that achieves peak throughput with acceptable p99. Enforce caps with max_db_connections and max_connections.' },
    { q: 'State Little\'s law and apply it to a database.', a: 'L = λW: average items in system equals arrival rate times time in system. 2,000 transactions/s each holding a connection for 10 ms need on average 20 busy connections.' },
    { q: 'cl_waiting is high in PgBouncer. Should you increase the pool?', a: 'Only if PostgreSQL has spare CPU/IO capacity. First check avg_xact_time vs avg_query_time and database load; often transactions hold connections too long or queries are slow. If the DB is saturated, a bigger pool makes things worse.' }
  ],
  exercises: [
    { task: 'A service runs 2,400 transactions per second with an average duration of 7.5 ms. Compute the average number of busy connections and a pool size with 2× headroom.', solution: `SELECT 2400 * 0.0075 AS avg_busy, ceil(2400 * 0.0075 * 2) AS pool_size;`, run: true },
    { task: 'Apply the core heuristic for servers with 8, 16, 32 and 64 cores assuming effective_spindle_count = 4.', solution: `SELECT cores, cores * 2 + 4 AS suggested_pool
FROM unnest(ARRAY[8, 16, 32, 64]) AS cores;`, run: true }
  ],
  challenge: { task: 'Given load-test results (pool size, throughput, p99), find the smallest pool size that achieves at least 97% of the best throughput while keeping p99 under 50 ms.', hint: 'Compute max(throughput) in a window or subquery, filter, then ORDER BY pool_size LIMIT 1.', solution: `WITH results(pool_size, tps, p99_ms) AS (
  VALUES (16, 4100, 22), (32, 6900, 26), (48, 7600, 31),
         (64, 7750, 44), (96, 7400, 95), (128, 6800, 210)
)
SELECT pool_size, tps, p99_ms
FROM results
WHERE tps >= 0.97 * (SELECT max(tps) FROM results)
  AND p99_ms < 50
ORDER BY pool_size
LIMIT 1;`, run: true },
  related: ['connection-pooling-pgbouncer', 'connection-pooling-why', 'scaling-capacity-planning', 'monitoring'],
  quiz: [
    { type: 'mcq', q: 'By Little\'s law, 5,000 TPS with 4 ms average transactions need about how many busy connections?', options: ['4', '20', '200', '5000'], answer: 1, explain: '5,000 × 0.004 = 20.' },
    { type: 'tf', q: 'If PgBouncer shows clients waiting and the database CPU is at 98%, increasing default_pool_size will improve throughput.', answer: false, explain: 'The database is saturated; more concurrency adds contention. Reduce work per transaction or scale the database.' },
    { type: 'predict', q: 'Two PgBouncer instances each with default_pool_size = 50 and reserve_pool_size = 10 for one database/user. Maximum server connections to PostgreSQL?', options: ['50', '60', '100', '120'], answer: 3, explain: 'Each instance can open 50 + 10 = 60; two instances → 120 (unless max_db_connections caps it).' },
    { type: 'optimize', q: 'SHOW STATS: avg_xact_time 20 ms, avg_query_time 3 ms. Best improvement?', options: ['Double the pool', 'Shorten transactions: remove app-side work/external calls inside transactions, batch queries', 'Increase max_connections', 'Switch to statement pooling'], answer: 1, explain: '17 ms of each transaction is spent outside queries while holding the connection.' }
  ]
}
]);
PGM.addLessons([
/* ======================================================================
   MODULE: sharding (5)
   ====================================================================== */
{
  id: 'sharding-what-is-sharding',
  module: 'sharding',
  title: 'What Is Sharding? Horizontal vs Vertical Partitioning, Why and When Not To',
  level: 6,
  minutes: 25,
  summary: 'A beginner-friendly but precise introduction to sharding: splitting one logical dataset across several independent PostgreSQL servers — what it buys, what it costs, and why most systems should exhaust every other option first.',
  objectives: [
    'Define sharding and distinguish it from partitioning and replication',
    'Explain horizontal (row) vs vertical (column/table) splitting with examples',
    'Simulate hash-based shard assignment of company_db customers and their orders',
    'List the real reasons to shard (write throughput, data size, isolation, locality)',
    'Recognise the costs: cross-shard queries, transactions, operations, rebalancing',
    'Know the cheaper alternatives to try first'
  ],
  concept: `<p><strong>Sharding</strong> means splitting one logical dataset across <strong>several independent database servers</strong> (shards), each holding a subset of the rows and each handling reads <em>and writes</em> for its subset. Every shard is a complete PostgreSQL instance with its own CPU, memory, disk and WAL. Together they behave like one big database — but only if the application (or a layer such as Citus) knows which shard holds which rows.</p>
<p><strong>Analogy:</strong> a library that outgrew its building. Making the building taller (vertical scaling) eventually hits limits. Adding photocopies of the whole library in other towns (replication) helps with readers but every new book must still be catalogued in the main building. <em>Sharding</em> opens branch libraries, each owning books by author surname A-F, G-M, N-S, T-Z: each branch catalogues its own new books independently — but a reader wanting "all books published in 2024" must visit every branch.</p>
<p>Three terms that are often confused:</p>
<ul>
<li><strong>Partitioning</strong> <span class="tag core">core</span> — splitting a table into pieces <em>inside one server</em> (declarative partitioning). Helps maintenance and pruning; does not add CPU, RAM or write capacity.</li>
<li><strong>Replication</strong> — <em>copying</em> the same data to more servers. Scales reads and availability, not writes or storage.</li>
<li><strong>Sharding</strong> — <em>distributing different data</em> to different servers. Scales writes, storage and working-set memory.</li>
</ul>
<p><strong>Horizontal vs vertical:</strong></p>
<ul>
<li><strong>Horizontal partitioning / sharding</strong> splits <em>rows</em>: customers 1-1000 on shard A, 1001-2000 on shard B (or by hash). Every shard has the same schema.</li>
<li><strong>Vertical partitioning</strong> splits <em>columns or tables</em>: move <code>documents</code> and <code>audit_logs</code> to their own database ("functional partitioning"), or move rarely used wide columns (<code>products.attributes</code>) to a side table. Often the first and cheapest step — it is how many companies split a monolith database by service.</li>
</ul>
<p>In company_db a natural horizontal design is: shard <code>customers</code> by <code>customer_id</code> and put each customer's <code>orders</code>, <code>order_items</code> and <code>payments</code> on the <em>same</em> shard, so "show me my orders" touches one shard. Small, rarely changing tables like <code>products</code> or <code>departments</code> would be <em>replicated to every shard</em> (reference tables).</p>`,
  why: `<p>A single PostgreSQL primary has hard ceilings: one machine's write I/O and WAL throughput (one WAL stream), CPU for writes, RAM for the hot working set, and operational limits (a 40 TB table takes days to back up, restore, or rebuild an index). When a workload exceeds the largest affordable machine — or when one tenant's load must be isolated from others — splitting data across machines is the only way to keep scaling writes. Sharding also limits blast radius: an incident on one shard affects a fraction of customers.</p>`,
  useCase: `<p>A multi-tenant B2B invoicing SaaS reached 18 TB on one primary with 25k writes/s at month-end close; vacuum on the largest tables ran for days and a single tenant's bulk import slowed everybody. They sharded by <code>tenant_id</code> into 16 shards (Citus, later 32), keeping each tenant's invoices, line items and payments together. Month-end writes spread across 16 primaries, the largest shard holds ~1.4 TB, backups/restores run in parallel per shard, and the three largest tenants were isolated on dedicated shards. Cost: cross-tenant analytics moved to a separate warehouse, and schema migrations now run across 32 nodes.</p>`,
  internals: `<p>A sharded system has three pieces: (1) a <strong>sharding function</strong> mapping a key to a logical shard (e.g. <code>hash(customer_id) mod 64</code>); (2) a <strong>placement map</strong> from logical shards to physical servers (64 logical shards on 4 servers, 16 each — moving a logical shard later is how you rebalance); (3) a <strong>router</strong> — application code, a proxy, or a coordinator such as Citus — that sends each query to the right shard(s). Queries containing the shard key (<code>WHERE customer_id = 42</code>) are routed to one shard; queries without it must <em>scatter-gather</em> to all shards and merge results.</p>
<p>Each shard is an independent PostgreSQL with its own MVCC, WAL and transaction IDs: there is no global snapshot or global transaction for free. Cross-shard atomicity needs two-phase commit or sagas; global uniqueness needs a global ID scheme; and every shard needs its own replicas, backups and monitoring.</p>`,
  whenNot: `<p><strong>Most databases should never be sharded.</strong> Before sharding try, roughly in order of cost: query and index tuning, connection pooling, bigger hardware (a 96-core, 1 TB RAM server with NVMe handles a lot), read replicas for read load, caching, partitioning for large tables, archiving cold data, and vertical/functional splits by service. Don't shard when:</p>
<ul><li>Data is under a few TB and writes fit one primary — the operational and development tax is permanent.</li>
<li>Most important queries don't contain a single natural key (heavy ad-hoc analytics, many-to-many graphs) — everything becomes scatter-gather.</li>
<li>You need frequent multi-entity ACID transactions across arbitrary keys (e.g. transfers between any two accounts) without an appetite for 2PC/saga complexity.</li>
<li>The team has no capacity to operate N clusters.</li></ul>`,
  syntax: `-- conceptual shard routing (application or proxy)
shard_no   = hash(shard_key) mod NUM_LOGICAL_SHARDS        -- e.g. 64
server     = placement_map[shard_no]                        -- e.g. 'pg-shard-03'

-- simulate in SQL
SELECT abs(hashtext(customer_id::text)) % 4 AS shard, count(*) FROM orders GROUP BY 1;`,
  examples: [
    { label: 'Basic', title: 'Assign company_db customers to 4 shards by hash',
      sql: `SELECT abs(hashtext(id::text)) % 4 AS shard,
       count(*)                      AS customers,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM customers
GROUP BY 1
ORDER BY 1;`,
      explain: `<p><code>hashtext()</code> is PostgreSQL's internal text hash function (undocumented but stable within a major version; Citus and partitioning use their own hash functions). Taking <code>abs(...) % 4</code> maps each customer to shard 0-3. With 500 customers the split is roughly even (23-27%), which is what a good hash on a high-cardinality key gives you. In production use a stable, well-defined hash (e.g. the one your router library implements) because routing must be identical across languages and versions.</p>`,
      output: ` shard | customers | pct
-------+-----------+------
     0 |       132 | 26.4
     1 |       115 | 23.0
     2 |       133 | 26.6
     3 |       120 | 24.0`, run: true },
    { label: 'Intermediate', title: 'Co-locate each customer\'s orders on the customer\'s shard',
      sql: `SELECT abs(hashtext(o.customer_id::text)) % 4 AS shard,
       count(*)                      AS orders,
       count(DISTINCT o.customer_id) AS customers,
       round(sum(o.total_amount))    AS revenue,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct_of_orders
FROM orders o
GROUP BY 1
ORDER BY 1;`,
      explain: `<p>Hashing <code>orders</code> by <code>customer_id</code> (not by <code>orders.id</code>) puts every order on the same shard as its customer. "Customer 42's orders with items and payments" is then a single-shard query with local joins. Notice the order share (22.8%-27.9%) varies more than the customer share — some customers order more. That is the seed of the <em>hot shard</em> problem covered later.</p>`,
      output: ` shard | orders | customers |  revenue  | pct_of_orders
-------+--------+-----------+-----------+---------------
     0 |   1264 |       132 | 310751252 |          25.3
     1 |   1141 |       115 | 285733017 |          22.8
     2 |   1395 |       133 | 346964809 |          27.9
     3 |   1200 |       120 | 292474361 |          24.0`, run: true },
    { label: 'Advanced', title: 'Should we shard at all? A sizing reality check',
      sql: `SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
       (SELECT count(*) FROM orders)                            AS orders,
       (SELECT round(count(*) / 21.0) FROM orders)              AS orders_per_month,
       -- extrapolate: 1000x growth in volume
       pg_size_pretty(pg_database_size(current_database()) * 1000) AS size_at_1000x,
       (SELECT round(count(*) / 21.0 * 1000 / (30 * 24 * 3600.0), 1) FROM orders) AS writes_per_sec_at_1000x;`,
      explain: `<p>Even at 1000× today's volume company_db would be ~11 GB and ~0.1 order inserts per second (≈ a few row writes/s with items and payments) — trivially handled by one modest server. A single well-tuned PostgreSQL primary comfortably handles tens of thousands of writes per second and multi-TB datasets. Do this arithmetic with your real numbers before considering sharding.</p>`,
      output: ` db_size | orders | orders_per_month | size_at_1000x | writes_per_sec_at_1000x
---------+--------+------------------+---------------+-------------------------
 11 MB   |   5000 |              238 | 11 GB         |                     0.1`, run: true }
  ],
  compare: {
    bad: { sql: `-- Sharding orders by their own id
SELECT abs(hashtext(id::text)) % 4 AS order_shard,
       count(*) AS orders
FROM orders GROUP BY 1 ORDER BY 1;
-- "show customer 42's orders" must now query ALL shards,
-- and order -> customer joins are cross-shard`, why: 'Even distribution but no locality: the most common query (a customer\'s orders) becomes scatter-gather, and joining to the customer usually crosses shards.', run: true },
    good: { sql: `SELECT abs(hashtext(customer_id::text)) % 4 AS shard,
       count(*) AS orders
FROM orders GROUP BY 1 ORDER BY 1;
-- customer 42 and all their orders/items/payments live on one shard`, why: 'Still well distributed, and the dominant access path (by customer) hits exactly one shard with local joins.', run: true }
  },
  mistakes: [
    'Sharding prematurely — at a few hundred GB with spare CPU, when indexes and a bigger instance would have sufficed.',
    'Confusing partitioning (one server) with sharding (many servers) and expecting partitioning to add write capacity.',
    'Choosing a shard key that the main queries do not filter on, turning everything into scatter-gather.',
    'Mapping keys directly to physical servers (hash mod N servers) so that adding a server moves most data.',
    'Forgetting per-shard operations: N× backups, replicas, monitoring, migrations and upgrades.'
  ],
  best: [
    'Exhaust the scaling roadmap first (tuning → hardware → replicas → caching → partitioning → archiving → vertical split).',
    'Shard by the entity that owns most queries and transactions (tenant, customer, account).',
    'Use many logical shards (e.g. 64-1024) mapped onto few servers to make rebalancing a matter of moving logical shards.',
    'Replicate small, read-mostly tables (reference tables) to every shard.',
    'Design global IDs, cross-shard reporting (warehouse/CDC) and migration tooling before the first shard split.'
  ],
  performance: `<p>For single-shard queries, sharding adds only routing overhead (microseconds in-app, ~1 network hop through a coordinator). Total write throughput, storage and buffer cache scale roughly linearly with shard count when access is evenly distributed and shard-local. Scatter-gather queries cost N× the work plus merge time and are limited by the slowest shard (tail latency amplification: with 32 shards, the p99 of a fan-out query approaches the p99.97 of an individual shard).</p>`,
  security: `<p>Sharding by tenant can strengthen isolation (a tenant's data physically separated, per-shard encryption keys, data residency by region), but routing bugs can send a query to the wrong shard — always include the tenant key in queries and enforce it with constraints/RLS on each shard. Credentials and network policies multiply with the number of shards; automate them.</p>`,
  scenario: { title: 'The CTO asks: "Should we shard before Black Friday?"', steps: [
    '1. Measure: 2.3 TB database, 4,200 writes/s peak, primary CPU 55% at peak, p99 30 ms; projected peak 2.5× → ~10,500 writes/s.',
    '2. Find headroom without sharding: top 10 queries in pg_stat_statements consume 70% of time; two missing indexes and one N+1 ORM pattern found.',
    '3. Hardware: move from 32 to 64 vCPU and to faster storage; add PgBouncer; route catalog reads to replicas.',
    '4. Load test at 3× expected peak: CPU 60%, p99 40 ms. Conclusion: no sharding needed this year.',
    '5. Prepare anyway: adopt UUIDv7/global IDs for new tables, add tenant_id/customer_id to child tables, so a future shard split is feasible.'
  ] },
  widgets: ['diagram:sharding', 'lab:shard', 'diagram:partitioning'],
  interview: [
    { q: 'What is the difference between partitioning, replication and sharding?', a: 'Partitioning splits a table inside one server (maintenance, pruning). Replication copies the same data to more servers (reads, HA). Sharding distributes different subsets of data to different servers, each handling its own writes — the only one that scales write throughput and storage beyond one machine.' },
    { q: 'When would you not shard a PostgreSQL database?', a: 'When it fits on one well-sized primary after tuning, replicas, caching, partitioning and archiving; when the main queries lack a natural shard key; when cross-entity transactions are frequent; or when the team cannot operate many clusters. Sharding is a permanent complexity tax.' },
    { q: 'What is vertical partitioning?', a: 'Splitting by columns or tables rather than rows: moving wide/rarely used columns to a side table, or moving whole tables (e.g. audit logs, documents) to separate databases per service. It is often the first step before horizontal sharding.' },
    { q: 'Why use many logical shards on few physical servers?', a: 'Because adding capacity then means moving whole logical shards to new servers, without re-hashing every row. It keeps the hash function fixed and makes rebalancing incremental.' }
  ],
  exercises: [
    { task: 'Assign customers to 8 shards by hash of id and show the min, max and ratio max/avg of customers per shard.', solution: `SELECT min(c) AS min_per_shard, max(c) AS max_per_shard,
       round(max(c) / avg(c), 2) AS max_to_avg
FROM (SELECT abs(hashtext(id::text)) % 8 AS shard, count(*) AS c
      FROM customers GROUP BY 1) s;`, run: true },
    { task: 'Vertical split: create a side table holding the wide products.attributes column separately from the hot product columns, and fill it.', solution: `CREATE TABLE product_attributes AS
SELECT id AS product_id, attributes FROM products;
ALTER TABLE product_attributes ADD PRIMARY KEY (product_id);
SELECT count(*) AS rows_moved,
       pg_size_pretty(pg_total_relation_size('product_attributes')) AS side_table_size
FROM product_attributes;`, run: true }
  ],
  challenge: { task: 'For each of 4 hash shards (by customer_id), compute orders, order_items and payments that would live there, proving that all three tables can be co-located by joining back to orders.', hint: 'Join order_items and payments to orders to get customer_id, then hash it.', solution: `SELECT abs(hashtext(o.customer_id::text)) % 4 AS shard,
       count(DISTINCT o.id)  AS orders,
       count(DISTINCT oi.id) AS order_items,
       count(DISTINCT p.id)  AS payments
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN payments p     ON p.order_id  = o.id
GROUP BY 1
ORDER BY 1;`, run: true },
  related: ['sharding-strategies', 'sharding-shard-key', 'partitioning', 'scaling-roadmap', 'distributed-postgresql'],
  quiz: [
    { type: 'mcq', q: 'Which technique increases total WRITE capacity beyond a single server?', options: ['Read replicas', 'Declarative partitioning on one server', 'Sharding', 'Adding indexes'], answer: 2, explain: 'Only sharding gives each subset of data its own primary with its own write capacity.' },
    { type: 'tf', q: 'Declarative partitioning of a table into 16 partitions on one server gives 16× write throughput.', answer: false, explain: 'All partitions share one server\'s CPU, memory, WAL and disks.' },
    { type: 'design', q: 'In company_db, which shard key keeps "show my orders with items and payments" on a single shard?', options: ['orders.id', 'order_items.id', 'customer_id (with orders, items, payments co-located)', 'payments.method'], answer: 2, explain: 'Sharding all customer-owned tables by customer_id co-locates them.' },
    { type: 'mcq', q: 'What is vertical partitioning?', options: ['Splitting rows by key', 'Splitting columns/tables into separate tables or databases', 'Adding CPU', 'Copying data to replicas'], answer: 1, explain: 'Vertical = by columns or tables; horizontal = by rows.' }
  ]
},
{
  id: 'sharding-strategies',
  module: 'sharding',
  title: 'Sharding Strategies: Hash, Range, Directory, Tenant, Geo — and Consistent Hashing',
  level: 6,
  minutes: 35,
  summary: 'Compare hash, range, directory/lookup, tenant-based and geographic sharding; understand why naive hash mod N reshuffles everything and how consistent hashing with virtual nodes moves only ~1/N of keys — simulated in SQL.',
  objectives: [
    'Describe hash, range, directory-based, tenant-based and geo sharding with pros and cons',
    'Explain why hash mod N is fragile when N changes',
    'Build a consistent-hashing ring with virtual nodes in SQL and measure key movement',
    'Implement a directory (lookup) table for flexible placement',
    'Pick a strategy for a given workload'
  ],
  concept: `<p>A <strong>sharding strategy</strong> is the rule that maps a row's shard key to a shard.</p>
<table><tr><th>Strategy</th><th>Rule</th><th>Strengths</th><th>Weaknesses</th></tr>
<tr><td><strong>Hash</strong></td><td><code>hash(key) mod S</code></td><td>even spread, no hotspots for random keys</td><td>range scans hit all shards; changing S moves data</td></tr>
<tr><td><strong>Range</strong></td><td>key ranges: ids 1-1M → A, 1M-2M → B; or dates</td><td>efficient range queries, easy to split a range</td><td>hot "latest" shard for monotonically increasing keys (time, sequences)</td></tr>
<tr><td><strong>Directory / lookup</strong></td><td>a table maps each key (or key group) → shard</td><td>total flexibility, move individual tenants</td><td>extra lookup (cache it), directory is critical infrastructure</td></tr>
<tr><td><strong>Tenant-based</strong></td><td>all rows of a tenant on one shard (via hash or directory)</td><td>perfect locality, isolation, per-tenant moves</td><td>large tenants can outgrow a shard (whales)</td></tr>
<tr><td><strong>Geo</strong></td><td>by region/country: India → Mumbai shard, EU → Frankfurt</td><td>latency and data residency (GDPR, DPDP Act)</td><td>uneven sizes, cross-region users</td></tr></table>
<p><strong>The modulo problem.</strong> With <code>hash(key) mod 3</code>, adding a 4th shard changes the result for ~75% of keys (only keys where <code>h mod 3 = h mod 4</code> stay). Moving three quarters of your data to add 33% capacity is unacceptable at scale.</p>
<p><strong>Consistent hashing</strong> fixes this. <strong>Analogy:</strong> picture a clock face (the hash ring, 0 to 2³²). Each shard plants several flags at pseudo-random positions (<em>virtual nodes</em>). Each key is placed on the clock by its hash and walks clockwise to the first flag; that flag's shard owns it. Adding a new shard plants new flags; only keys between a new flag and the previous flag change owner — about 1/N of keys, taken evenly from all existing shards. Virtual nodes (dozens to hundreds per shard) smooth the distribution and let you weight bigger servers with more flags.</p>
<p>An equivalent, simpler approach used by Citus and many systems is a <strong>fixed number of logical shards</strong> (e.g. 32, 64, 1024 hash ranges) assigned to servers through a placement table: the hash function never changes; rebalancing moves whole logical shards. Jump consistent hash and rendezvous (HRW) hashing are other well-known algorithms.</p>`,
  why: `<p>The strategy determines which queries are cheap, where hotspots appear, and how painful growth is. Hash sharding is the default for OLTP entities with point lookups; range sharding suits time-series and ordered scans but needs care with hot tails; directory-based sharding is what multi-tenant SaaS products adopt once they need to move a big customer to dedicated hardware; geo sharding is driven by law and latency. Getting rebalancing right (consistent hashing or logical shards) decides whether adding capacity is a routine task or a quarter-long project.</p>`,
  useCase: `<p>A SaaS CRM serves 40,000 tenants. They start with 256 logical shards (hash of <code>tenant_id</code>) placed on 4 servers. Year two: a directory table overrides placement for the 30 largest tenants, giving 6 of them dedicated servers. EU tenants are assigned by a geo rule to an EU cluster for GDPR. When the general pool needs more capacity, they add 2 servers and move 85 logical shards (one third) — about 1/3 of data in the general pool moves, in background, one logical shard at a time.</p>`,
  internals: `<p><strong>Consistent hashing math:</strong> with N nodes, adding one node moves ≈ 1/(N+1) of keys. With V virtual nodes per server, the standard deviation of load is roughly proportional to 1/√V; 100-200 vnodes per node gives a few percent imbalance. Lookups: binary search over the sorted vnode positions (O(log(N·V))).</p>
<p><strong>Range sharding internals</strong>: a metadata table of [low, high) → shard; shards split when they exceed a size threshold (as in HBase/Bigtable, CockroachDB ranges, YugabyteDB tablets). Monotonic keys concentrate all inserts in the last range — mitigations: hash-prefix the key, use a composite key (tenant, time), or pre-split.</p>
<p><strong>Directory</strong>: a small, highly available table (often in its own PostgreSQL with replicas, plus caches in each app) mapping tenant → shard. Moves update the directory atomically after data copy completes (with a short write freeze for that tenant).</p>`,
  whenNot: `<ul><li>Range sharding on auto-increment IDs or timestamps for write-heavy tables without mitigation — all writes go to one shard.</li>
<li>Hash sharding when the dominant queries are range scans across keys ("all orders between dates for all customers") — every query hits every shard.</li>
<li>Directory sharding for billions of individual keys — map groups (tenants, logical shards) instead of single rows.</li>
<li>Geo sharding when users routinely interact across regions (marketplaces with global buyers/sellers) — cross-shard traffic dominates.</li></ul>`,
  syntax: `-- hash:       shard = abs(hashtext(key::text)) % S
-- range:      shard = (SELECT shard FROM ranges WHERE key >= lo AND key < hi)
-- directory:  shard = (SELECT shard FROM tenant_directory WHERE tenant_id = $1)
-- consistent: shard = owner of first vnode position >= hash(key) on the ring (wrap around)`,
  examples: [
    { label: 'Basic', title: 'Range sharding by order date: the hot-tail problem',
      sql: `SELECT date_trunc('quarter', order_date)::date AS shard_range_start,
       count(*)                                  AS orders,
       repeat('#', (count(*) / 25)::int)         AS bar
FROM orders
GROUP BY 1
ORDER BY 1;`,
      explain: `<p>If each quarter were a shard, history is evenly distributed (~700 orders/quarter) — great for "orders in Q3 2024" queries (one shard). But <strong>all new writes</strong> go to the newest range (here 2025-Q4 just started): one shard does 100% of the insert work while the rest sit idle. That is why time-range sharding is reserved for append-mostly data where old shards become read-only (and can be archived), not for spreading write load.</p>`,
      output: ` shard_range_start | orders | bar
-------------------+--------+------------------------------
 2024-01-01        |    731 | #############################
 2024-04-01        |    761 | ##############################
 2024-07-01        |    739 | #############################
 2024-10-01        |    671 | ##########################
 2025-01-01        |    688 | ###########################
 2025-04-01        |    711 | ############################
 2025-07-01        |    693 | ###########################
 2025-10-01        |      6 |`, run: true },
    { label: 'Intermediate', title: 'Directory (lookup) sharding with per-tenant overrides',
      sql: `CREATE TABLE shard_directory (
  tenant_id  int PRIMARY KEY,
  shard_name text NOT NULL,
  reason     text
);
-- default placement: hash; overrides for special tenants
INSERT INTO shard_directory VALUES
  (1, 'shard-dedicated-01', 'largest tenant, isolated'),
  (3, 'shard-eu-01',        'EU data residency');

CREATE FUNCTION shard_for_tenant(p_tenant int) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT shard_name FROM shard_directory WHERE tenant_id = p_tenant),
    'shard-' || lpad((abs(hashtext(p_tenant::text)) % 4)::text, 2, '0'))
$$;

SELECT u.tenant_id, shard_for_tenant(u.tenant_id) AS shard, count(*) AS users
FROM users u
GROUP BY u.tenant_id
ORDER BY u.tenant_id;`,
      explain: `<p>The directory gives you an escape hatch from pure hashing: move tenant 1 to dedicated hardware or pin tenant 3 to the EU by inserting a row, without touching the hash function for everyone else. In production the router caches this mapping (with versioning/TTL) because it is on every request's path, and the directory database is replicated and highly available.</p>`,
      output: ` tenant_id | shard              | users
-----------+--------------------+-------
         1 | shard-dedicated-01 |    20
         2 | shard-02           |    20
         3 | shard-eu-01        |    20
(tenant 2 falls back to its hash shard)`, run: true },
    { label: 'Advanced', title: 'Consistent hashing ring with virtual nodes vs hash mod N',
      sql: `WITH ring3 AS (      -- 3 shards x 64 virtual nodes
  SELECT node, hashtext(node || '#' || v) AS pos
  FROM unnest(ARRAY['shard-a', 'shard-b', 'shard-c']) AS node,
       generate_series(1, 64) AS v
), ring4 AS (        -- add shard-d
  SELECT node, hashtext(node || '#' || v) AS pos
  FROM unnest(ARRAY['shard-a', 'shard-b', 'shard-c', 'shard-d']) AS node,
       generate_series(1, 64) AS v
), keys AS (
  SELECT id, hashtext('cust:' || id) AS h FROM customers
), placed AS (
  SELECT k.id,
         COALESCE((SELECT node FROM ring3 WHERE pos >= k.h ORDER BY pos LIMIT 1),
                  (SELECT node FROM ring3 ORDER BY pos LIMIT 1)) AS ring_before,  -- wrap around
         COALESCE((SELECT node FROM ring4 WHERE pos >= k.h ORDER BY pos LIMIT 1),
                  (SELECT node FROM ring4 ORDER BY pos LIMIT 1)) AS ring_after,
         abs(k.h) % 3 AS mod_before,
         abs(k.h) % 4 AS mod_after
  FROM keys k
)
SELECT count(*)                                                     AS keys,
       count(*) FILTER (WHERE ring_before <> ring_after)            AS moved_consistent,
       round(100.0 * count(*) FILTER (WHERE ring_before <> ring_after) / count(*), 1) AS pct_consistent,
       count(*) FILTER (WHERE mod_before <> mod_after)              AS moved_modulo,
       round(100.0 * count(*) FILTER (WHERE mod_before <> mod_after) / count(*), 1)   AS pct_modulo
FROM placed;`,
      explain: `<p>Each shard places 64 virtual nodes on the 32-bit ring. A key belongs to the first vnode clockwise from its hash (wrapping to the smallest position). Adding <code>shard-d</code> moves only keys that now fall just before one of d's new vnodes: ~26% here (ideal 1/4 = 25%), and all of them move <em>to</em> d. With <code>mod 3 → mod 4</code>, 75% of keys change shard, mostly between old shards — pure waste. Try changing 64 to 4 virtual nodes and watch the balance get worse.</p>`,
      output: ` keys | moved_consistent | pct_consistent | moved_modulo | pct_modulo
------+------------------+----------------+--------------+------------
  500 |              130 |           26.0 |          375 |       75.0`, run: true }
  ],
  compare: {
    bad: { sql: `-- Physical servers addressed directly by modulo
-- server = hash(key) % number_of_servers
SELECT abs(hashtext('cust:' || id)) % 3 AS server_now,
       abs(hashtext('cust:' || id)) % 4 AS server_after_adding_one,
       count(*) AS customers
FROM customers
GROUP BY 1, 2
ORDER BY 1, 2;`, why: 'Adding a 4th server reassigns ~75% of all keys, most of them between existing servers; a full-cluster reshuffle for 33% more capacity.', run: true },
    good: { sql: `-- Fixed logical shards (never change), placement table maps them to servers
CREATE TABLE shard_placement (logical_shard int PRIMARY KEY, server text NOT NULL);
INSERT INTO shard_placement
SELECT s, 'pg-' || (s % 3) FROM generate_series(0, 63) s;

-- add pg-3: move every 4th logical shard (16 of 64), the hash function is untouched
UPDATE shard_placement SET server = 'pg-3' WHERE logical_shard % 4 = 3;
SELECT server, count(*) AS logical_shards FROM shard_placement GROUP BY 1 ORDER BY 1;`, why: 'Keys always map to the same logical shard (hash mod 64). Adding a server moves a chosen subset of logical shards — exactly the data needed to rebalance, one shard at a time.', run: true }
  },
  mistakes: [
    'Range sharding on a sequence or timestamp for write-heavy tables, creating a single hot shard.',
    'Using <code>hash mod number_of_servers</code> so that every topology change reshuffles most data.',
    'Too few virtual nodes (e.g. 1 per server) → very uneven ring segments.',
    'Directory lookups on every query without caching, making the directory a bottleneck and SPOF.',
    'Using different hash implementations in different services/languages, routing the same key to different shards.'
  ],
  best: [
    'Default to hash sharding on a high-cardinality entity key, with many logical shards and a placement map.',
    'Add a directory override layer for whales, isolation and data residency.',
    'Use range sharding for time-series only when old ranges become read-only and archivable.',
    'Version the routing metadata and roll changes out atomically to all routers.',
    'Document the exact hash function and test cross-language routing equality in CI.'
  ],
  performance: `<p>Hash routing is O(1); consistent-hash ring lookup is O(log V·N) — microseconds either way. The performance difference lies in data movement and query shape: hash spreads load but makes range queries fan out; range keeps ranges local but concentrates writes; directory costs a lookup (sub-millisecond when cached). Rebalancing throughput is bounded by copy speed per logical shard (e.g. logical replication or COPY at 50-200 MB/s) and is best run online, shard by shard.</p>`,
  security: `<p>Geo and directory strategies are frequently compliance controls (data residency): the directory becomes a regulated system — audit changes, restrict who can move tenants, and verify that backups and replicas of EU shards also stay in the EU. Routing metadata must be integrity-protected; a tampered map could route one tenant's queries to another tenant's shard.</p>`,
  scenario: { title: 'Adding capacity to a 3-server hash-mod-3 cluster without a 2-week migration', steps: [
    '1. Current: server = hash(customer_id) % 3; disks 85% full; adding a 4th server would move ~75% of 9 TB.',
    '2. Introduce logical shards: logical = hash(customer_id) % 192 (192 = divisible by 3, 4, 6, 8, 12); since 192 % 3 = 0, logical % 3 equals the old server number — so the initial placement (logical % 3 → server) matches the current layout with zero data movement.',
    '3. Add pg-3: move 48 logical shards (1/4 of data, ~2.25 TB) — one at a time, via logical replication of filtered ranges, then flip placement.',
    '4. Each move: copy rows where hash % 192 = k, catch up, brief write freeze for shard k, update placement, delete source rows.',
    '5. Result: 4 balanced servers, ~25% of data moved, future expansions to 6/8/12 servers are equally incremental.'
  ] },
  widgets: ['diagram:sharding', 'lab:shard'],
  interview: [
    { q: 'Why is hash(key) mod N a problem and how does consistent hashing help?', a: 'When N changes, most keys map to a different shard (about (N)/(N+1) of them when going N→N+1), forcing massive data movement. Consistent hashing places nodes (via many virtual nodes) and keys on a ring; a key belongs to the next node clockwise, so adding a node moves only about 1/(N+1) of keys, all to the new node.' },
    { q: 'When would you choose range sharding?', a: 'When queries are dominated by ordered range scans on the key (time windows, alphabetical ranges) and new writes are not concentrated in one range, or when old ranges become immutable and can be archived. Mitigate hot tails with composite keys or pre-splitting.' },
    { q: 'What is directory-based sharding and its risks?', a: 'A lookup table maps keys (usually tenants or logical shards) to shards, enabling arbitrary placement and moves. Risks: the directory becomes a critical dependency (availability and latency), caches can be stale during moves, and it must be kept consistent with actual data location.' },
    { q: 'How does Citus avoid the modulo problem?', a: 'It hashes the distribution column into a fixed number of hash-range shards (shard_count, default 32) whose placements on worker nodes are stored in metadata; rebalancing moves whole shards to new nodes without changing the hash mapping.' }
  ],
  exercises: [
    { task: 'Show how evenly 64 logical shards distribute customers: min, max and average customers per logical shard.', solution: `SELECT min(c) AS min_c, max(c) AS max_c, round(avg(c), 1) AS avg_c
FROM (SELECT abs(hashtext(id::text)) % 64 AS logical_shard, count(*) AS c
      FROM customers GROUP BY 1) s;`, run: true },
    { task: 'Geo sharding: map customers to regional shards (India → ap-south, UK/Germany → eu-central, else → us-east) and count customers per region.', solution: `SELECT CASE WHEN country = 'India' THEN 'ap-south'
            WHEN country IN ('UK', 'Germany') THEN 'eu-central'
            ELSE 'us-east' END AS geo_shard,
       count(*) AS customers
FROM customers
GROUP BY 1
ORDER BY 2 DESC;`, run: true }
  ],
  challenge: { task: 'Using the consistent-hash ring with 3 shards, measure how the balance improves with more virtual nodes: for 1, 8, 64 and 256 vnodes per shard, compute the max/min customers per shard ratio.', hint: 'Generate rings for each vnode count in one CTE with a vnodes column, then place each key per ring.', solution: `WITH cfg AS (SELECT unnest(ARRAY[1, 8, 64, 256]) AS vn),
ring AS (
  SELECT cfg.vn, node, hashtext(node || '#' || v) AS pos
  FROM cfg, unnest(ARRAY['shard-a', 'shard-b', 'shard-c']) AS node,
       LATERAL generate_series(1, cfg.vn) AS v
),
placed AS (
  SELECT cfg.vn, c.id,
         COALESCE((SELECT node FROM ring r WHERE r.vn = cfg.vn AND r.pos >= hashtext('cust:' || c.id) ORDER BY r.pos LIMIT 1),
                  (SELECT node FROM ring r WHERE r.vn = cfg.vn ORDER BY r.pos LIMIT 1)) AS owner
  FROM cfg, customers c
),
counts AS (SELECT vn, owner, count(*) AS n FROM placed GROUP BY vn, owner)
SELECT vn AS vnodes_per_shard, min(n) AS min_keys, max(n) AS max_keys,
       round(max(n)::numeric / min(n), 2) AS max_min_ratio
FROM counts GROUP BY vn ORDER BY vn;`, run: true },
  related: ['sharding-what-is-sharding', 'sharding-shard-key', 'sharding-cross-shard', 'distributed-postgresql'],
  quiz: [
    { type: 'mcq', q: 'Going from hash mod 3 to hash mod 4, roughly what fraction of keys change shard?', options: ['~25%', '~33%', '~50%', '~75%'], answer: 3, explain: 'A key stays only if h mod 3 = h mod 4, which holds for about 3 of every 12 values (25%), so ~75% move.' },
    { type: 'tf', q: 'With consistent hashing, adding a 4th node to 3 moves roughly 1/4 of keys, all to the new node.', answer: true, explain: 'Only keys falling in the new node\'s ring segments move, and they move to it.' },
    { type: 'scenario', q: 'An IoT platform range-shards readings by timestamp. Symptom?', options: ['Even write load', 'One hot shard receives all inserts while others idle', 'Cross-shard joins on every insert', 'Lost writes'], answer: 1, explain: 'Monotonic keys concentrate writes in the newest range.' },
    { type: 'design', q: 'A SaaS must keep EU tenants in the EU and move its biggest tenant to dedicated hardware. Strategy?', options: ['Pure hash mod N', 'Range by tenant_id', 'Hash/logical shards plus a directory with overrides (geo + dedicated)', 'Statement-based replication'], answer: 2, explain: 'A directory layer allows placement rules beyond the hash.' },
    { type: 'mcq', q: 'What do virtual nodes improve in consistent hashing?', options: ['Security', 'Load balance across nodes (and weighting)', 'Transaction isolation', 'Compression'], answer: 1, explain: 'More points per node smooths segment sizes; more vnodes on bigger servers gives them proportionally more keys.' }
  ]
},
{
  id: 'sharding-shard-key',
  module: 'sharding',
  title: 'Choosing a Shard Key: Cardinality, Distribution, Query Locality and Hot Shards',
  level: 6,
  minutes: 30,
  summary: 'The single most important sharding decision — evaluate candidate keys by cardinality, evenness, query locality and growth; spot hot shards and the celebrity problem; learn from bad shard key examples using company_db data.',
  objectives: [
    'Evaluate shard key candidates by cardinality, skew and growth',
    'Measure query locality: what fraction of joins/queries stay on one shard',
    'Recognise hot shards and the celebrity (whale) problem and mitigation options',
    'Identify classic bad shard keys (low cardinality, monotonic, mutable, not in queries)',
    'Denormalise the shard key into child tables for co-location'
  ],
  concept: `<p>The <strong>shard key</strong> (Citus: <em>distribution column</em>) decides where every row lives — and therefore which queries are cheap forever. It is extremely expensive to change later, because changing it means moving almost all data. Evaluate candidates against four criteria:</p>
<ol>
<li><strong>Cardinality</strong> — many distinct values (≫ number of shards). <code>country</code> (6 values) or <code>segment</code> (3 values) can never spread over 32 shards.</li>
<li><strong>Even distribution</strong> — rows <em>and load</em> per key value roughly uniform. A skewed key creates <strong>hot shards</strong>.</li>
<li><strong>Query locality</strong> — the most frequent and most latency-sensitive queries and transactions filter on the key, so they hit one shard; related tables can share the key so joins are local (co-location).</li>
<li><strong>Stability</strong> — the key never changes for a row (moving a row between shards on update is a distributed transaction) and isn't monotonic if hashed by range.</li>
</ol>
<p><strong>Analogy:</strong> assigning students to dormitories. By birth month (12 values) — too few buildings and uneven. By student ID hash — even, but roommates in the same project end up in different buildings (no locality). By project team — teammates together (locality) — until one "team" is the 2,000-person marching band (the celebrity/whale problem).</p>
<p><strong>The celebrity problem.</strong> Social networks sharding by <code>user_id</code> find that a celebrity with 100M followers makes their shard hot: every like and comment hits it. B2B SaaS sharded by <code>tenant_id</code> finds that the largest customer is 30% of all data. Mitigations: dedicated shards for whales (directory override), sub-sharding a whale by a secondary key (<code>(tenant_id, user_id)</code>), caching/fan-out-on-write for read hotspots, or rate-limiting per key.</p>`,
  why: `<p>Choosing well makes 95% of queries single-shard, transactions local and growth linear. Choosing badly produces a cluster where every query fans out, joins move data across the network, one shard melts while others idle, and the fix is a full re-shard. Interviewers ask about shard keys more than anything else in distributed database design for this reason.</p>`,
  useCase: `<p>A food-delivery platform considered three keys for <code>orders</code>: <code>city_id</code> (≈300 values, Mumbai and Delhi = 35% of orders → hot shards; also cross-city users), <code>order_id</code> (even, but a customer's order history fans out across all shards), and <code>customer_id</code> (high cardinality, customer history local, checkout transaction touches one customer). Restaurants' dashboards ("my orders today") are served by a separate restaurant-keyed read model built via CDC. They chose <code>customer_id</code> for the transactional store and kept city-level analytics in the warehouse.</p>`,
  internals: `<p>Locality at the join level requires that joined rows share the shard key and use the same hash function and shard count (<strong>co-location</strong>). If <code>order_items</code> only has <code>order_id</code>, the router cannot tell which shard an item belongs to without looking up the order. The standard fix is to <strong>denormalise</strong> the shard key: add <code>customer_id</code> to <code>order_items</code> and <code>payments</code> and include it in primary keys/foreign keys (Citus requires unique constraints and foreign keys between distributed tables to include the distribution column).</p>
<p>Load skew is not just row count: a key with even rows may still have uneven <em>traffic</em> (a few customers placing thousands of orders a day). Measure both data per key and requests per key (from logs or <code>pg_stat_statements</code> with parameter sampling).</p>`,
  whenNot: `<ul><li>Don't pick the key only from the schema — pick it from the query and transaction workload.</li>
<li>Don't use a mutable attribute (email, status, region a user can change) as shard key.</li>
<li>Don't use low-cardinality keys (country, status, boolean flags) except as part of a composite or for geo placement over a few large regions.</li>
<li>Don't use a monotonic key with range distribution.</li></ul>`,
  syntax: `-- evaluate a candidate key
SELECT count(DISTINCT key) AS cardinality,
       max(cnt)::numeric / avg(cnt) AS skew           -- 1.0 = perfect
FROM (SELECT key, count(*) AS cnt FROM t GROUP BY key) s;

-- denormalise the shard key into child tables
ALTER TABLE order_items ADD COLUMN customer_id int;
UPDATE order_items oi SET customer_id = o.customer_id FROM orders o WHERE o.id = oi.order_id;`,
  examples: [
    { label: 'Basic', title: 'Score candidate keys: cardinality and skew',
      sql: `SELECT 'country' AS candidate, count(*) AS distinct_values,
       max(c) AS biggest_group, round(max(c) / avg(c), 2) AS max_to_avg
FROM (SELECT country, count(*) AS c FROM customers GROUP BY 1) s
UNION ALL
SELECT 'segment', count(*), max(c), round(max(c) / avg(c), 2)
FROM (SELECT segment, count(*) AS c FROM customers GROUP BY 1) s
UNION ALL
SELECT 'hash(id) % 8', count(*), max(c), round(max(c) / avg(c), 2)
FROM (SELECT abs(hashtext(id::text)) % 8, count(*) AS c FROM customers GROUP BY 1) s
ORDER BY max_to_avg DESC;`,
      explain: `<p><code>country</code> has only 6 values and India alone holds 188 of 500 customers: its shard would carry 2.26× the average load, and you could never use more than 6 shards. <code>segment</code> has 3 values. Hashing the high-cardinality <code>id</code> into 8 shards gives a max/avg of ~1.1. Cardinality bounds the number of useful shards; skew bounds efficiency.</p>`,
      output: ` candidate    | distinct_values | biggest_group | max_to_avg
--------------+-----------------+---------------+------------
 country      |               6 |           188 |       2.26
 segment      |               3 |           250 |       1.50
 hash(id) % 8 |               8 |            70 |       1.12`, run: true },
    { label: 'Intermediate', title: 'Query locality: shard orders by order id vs customer id',
      sql: `SELECT round(100.0 * avg((abs(hashtext(o.id::text)) % 4
                         = abs(hashtext(o.customer_id::text)) % 4)::int), 1)
         AS pct_orders_on_customer_shard_if_keyed_by_order_id,
       100.0 AS pct_if_keyed_by_customer_id
FROM orders o;`,
      explain: `<p>If <code>orders</code> were sharded by <code>orders.id</code> and <code>customers</code> by <code>customers.id</code>, only ~25% (1 in 4 shards, by chance) of orders would sit on the same shard as their customer — every customer→orders join would be 75% remote. Sharding orders by <code>customer_id</code> makes it 100% local by construction. The general rule: tables that are joined and transacted together must share the shard key.</p>`,
      output: ` pct_orders_on_customer_shard_if_keyed_by_order_id | pct_if_keyed_by_customer_id
---------------------------------------------------+-----------------------------
                                              25.3 |                       100.0`, run: true },
    { label: 'Advanced', title: 'Detect hot keys and simulate a celebrity tenant',
      sql: `-- 1. Real skew: share of orders from the top 1% of customers
WITH per_customer AS (
  SELECT customer_id, count(*) AS orders FROM orders GROUP BY 1
)
SELECT count(*) FILTER (WHERE rk <= 5)                         AS top_customers,
       sum(orders) FILTER (WHERE rk <= 5)                      AS their_orders,
       round(100.0 * sum(orders) FILTER (WHERE rk <= 5) / sum(orders), 2) AS pct_of_all_orders
FROM (SELECT *, row_number() OVER (ORDER BY orders DESC) AS rk FROM per_customer) r;

-- 2. Simulated celebrity: customer 42 suddenly generates 3000 extra orders
WITH load AS (
  SELECT customer_id, count(*) AS orders FROM orders GROUP BY 1
  UNION ALL SELECT 42, 3000
)
SELECT abs(hashtext(customer_id::text)) % 4 AS shard,
       sum(orders) AS orders,
       round(sum(orders) / avg(sum(orders)) OVER (), 2) AS load_vs_avg
FROM load
GROUP BY 1
ORDER BY 1;`,
      explain: `<p>Today the top 5 customers place ~2% of orders: healthy. But one celebrity key adding 3,000 orders makes its shard carry 2.2× the average while the others sit near 0.6 — and no amount of hashing fixes that, because a single key always maps to a single shard. Remedies: move the whale to a dedicated shard (directory override), split it with a composite key, or absorb reads with caching/read models.</p>`,
      output: ` top_customers | their_orders | pct_of_all_orders
---------------+--------------+-------------------
             5 |           97 |              1.94

 shard | orders | load_vs_avg
-------+--------+-------------
     0 |   1264 |        0.63
     1 |   1141 |        0.57
     2 |   4395 |        2.20
     3 |   1200 |        0.60
(customer 42 hashes to shard 2, which now carries 2.2x the average)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Shard key = country (low cardinality, skewed, mutable for movers)
SELECT country AS shard, count(*) AS customers
FROM customers GROUP BY 1 ORDER BY 2 DESC;`, why: 'Only 6 possible shards, India\'s shard holds 3× the others, and a customer who relocates must be moved between shards.', run: true },
    good: { sql: `-- Shard key = customer_id (high cardinality, stable, in every hot query)
SELECT abs(hashtext(id::text)) % 6 AS shard, count(*) AS customers
FROM customers GROUP BY 1 ORDER BY 1;`, why: 'Hundreds of distinct values per shard, near-even distribution, never changes, and the main queries ("my orders") filter on it.', run: true }
  },
  mistakes: [
    'Choosing a low-cardinality key (country, status, plan) that caps the number of shards and is skewed.',
    'Choosing a key not present in the main queries, so everything scatter-gathers.',
    'Not denormalising the key into child tables; joins then require lookups or cross-shard traffic.',
    'Ignoring traffic skew — counting rows per key but not requests per key.',
    'Using a mutable attribute as the key (email, region), forcing cross-shard moves on update.',
    'Planning for average tenants and being surprised by the whale that is 30% of data.'
  ],
  best: [
    'Derive the key from the top queries and transactions (by frequency × latency sensitivity).',
    'Prefer the owning entity: tenant_id for B2B SaaS, customer/user/account id for B2C.',
    'Include the key in all child tables, primary keys and foreign keys to enable co-location.',
    'Keep a whale strategy ready: directory overrides, dedicated shards, composite sub-keys.',
    'Simulate distribution with production data (as in these examples) before committing.'
  ],
  performance: `<p>With a good key, the vast majority of queries carry the key and are routed to one shard with local joins: latency equals single-node latency plus a routing hop. With a poor key, every query pays fan-out cost (N parallel queries, merge, slowest-shard latency) and distributed joins may repartition data over the network — often 10-100× slower. A skewed key caps cluster throughput at the hot shard's capacity regardless of how many shards you add.</p>`,
  security: `<p>For multi-tenant systems, <code>tenant_id</code> as shard key also simplifies isolation: row-level security policies and per-tenant encryption keys align with physical placement, and a tenant can be exported or deleted by dropping their shard data. Ensure every query includes the tenant key — a missing predicate in a scatter-gather query can leak data across tenants.</p>`,
  scenario: { title: 'One shard at 95% CPU while seven others idle at 20%', steps: [
    '1. Identify the hot shard\'s top statements and top keys (query logs sampled by tenant_id): tenant 8812 = 41% of the shard\'s queries.',
    '2. Short term: add read replicas for that shard and route the tenant\'s dashboard reads there; rate-limit its bulk API.',
    '3. Medium term: move tenant 8812 to a dedicated shard via the directory (logical replication of its rows, brief write freeze, flip directory).',
    '4. If the tenant still outgrows one server: sub-shard by (tenant_id, project_id) for that tenant only, with the router aware of the composite key.',
    '5. Add per-tenant load metrics and alerts so the next whale is detected early.'
  ] },
  widgets: ['diagram:sharding', 'lab:shard'],
  interview: [
    { q: 'What makes a good shard key?', a: 'High cardinality, even distribution of data and traffic, present in the most important queries and transactions (locality), stable/immutable, and shared by related tables for co-located joins. Typical choices: tenant_id, customer_id, account_id.' },
    { q: 'What is the celebrity (hot key) problem and how do you mitigate it?', a: 'A single key value with disproportionate data or traffic overloads its shard, since one key always maps to one shard. Mitigate by isolating it on a dedicated shard, splitting it with a composite key, caching reads, fan-out on write for feeds, or throttling.' },
    { q: 'Why add customer_id to order_items when it is derivable from orders?', a: 'So order_items can be routed and distributed by the same key as orders and customers, making joins and transactions co-located on one shard. Distributed databases like Citus require foreign keys and unique constraints to include the distribution column.' }
  ],
  exercises: [
    { task: 'Evaluate users.tenant_id as a shard key: cardinality and rows per value. What is the maximum number of useful shards?', solution: `SELECT count(DISTINCT tenant_id) AS cardinality_max_useful_shards,
       min(c) AS min_rows, max(c) AS max_rows
FROM (SELECT tenant_id, count(*) AS c FROM users GROUP BY 1) s;`, run: true },
    { task: 'Denormalise the shard key: add customer_id to a copy of order_items and verify every item got one.', solution: `CREATE TABLE order_items_sharded AS
SELECT oi.*, o.customer_id
FROM order_items oi JOIN orders o ON o.id = oi.order_id;
SELECT count(*) AS items, count(customer_id) AS items_with_shard_key
FROM order_items_sharded;`, run: true }
  ],
  challenge: { task: 'Compare three candidate keys for the payments table — method, order_id and the order\'s customer_id — reporting for each: distinct values, max/avg skew over 8 hash shards (or over values when fewer than 8), and whether "all payments of a customer" would be single-shard.', hint: 'Join payments to orders for customer_id; use UNION ALL of three aggregates.', solution: `WITH p AS (
  SELECT p.id, p.method, p.order_id, o.customer_id
  FROM payments p JOIN orders o ON o.id = p.order_id
)
SELECT 'method' AS candidate, (SELECT count(DISTINCT method) FROM p) AS distinct_values,
       round(max(c) / avg(c), 2) AS skew, false AS customer_payments_single_shard
FROM (SELECT method, count(*) AS c FROM p GROUP BY 1) s
UNION ALL
SELECT 'order_id', (SELECT count(DISTINCT order_id) FROM p),
       round(max(c) / avg(c), 2), false
FROM (SELECT abs(hashtext(order_id::text)) % 8, count(*) AS c FROM p GROUP BY 1) s
UNION ALL
SELECT 'customer_id', (SELECT count(DISTINCT customer_id) FROM p),
       round(max(c) / avg(c), 2), true
FROM (SELECT abs(hashtext(customer_id::text)) % 8, count(*) AS c FROM p GROUP BY 1) s;`, run: true },
  related: ['sharding-strategies', 'sharding-cross-shard', 'sharding-postgresql-approaches', 'database-design'],
  quiz: [
    { type: 'mcq', q: 'customers.country has 6 values. What is the maximum number of shards it can usefully populate?', options: ['3', '6', '32', 'Unlimited'], answer: 1, explain: 'Each distinct value maps to exactly one shard; 6 values → at most 6 non-empty shards.' },
    { type: 'tf', q: 'Hashing a key evenly distributes load even if a single key value receives 40% of all traffic.', answer: false, explain: 'All rows/requests for one key value go to the same shard; hashing cannot split a single value.' },
    { type: 'design', q: 'Which shard key best fits a B2B SaaS where almost all queries filter by organisation?', options: ['created_at', 'organisation_id', 'user email', 'plan_type'], answer: 1, explain: 'High cardinality, stable, present in every query, co-locates all of an organisation\'s data.' },
    { type: 'bug', q: 'Orders are distributed by customer_id, order_items by item id. Why are order pages slow?', code: `SELECT o.*, oi.* FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 42;`, options: ['Missing LIMIT', 'order_items is not co-located with orders; items are spread over all shards, so the join is distributed', 'customer_id should be text', 'JOIN syntax is wrong'], answer: 1, explain: 'Distribute order_items by customer_id as well (denormalise the key).' }
  ]
},
{
  id: 'sharding-cross-shard',
  module: 'sharding',
  title: 'Cross-Shard Queries, Distributed Joins, Transactions (2PC, Sagas), Global IDs and Resharding',
  level: 6,
  minutes: 40,
  summary: 'What gets hard once data lives on many servers: scatter-gather queries and correct aggregate merging, distributed joins, atomicity with two-phase commit or sagas, globally unique IDs (Snowflake, UUIDv7), and rebalancing/resharding online.',
  objectives: [
    'Execute scatter-gather queries correctly (merge partial aggregates, global top-N, pagination)',
    'Explain distributed join strategies: co-located, broadcast/reference, repartition',
    'Compare two-phase commit with sagas (and the outbox pattern) for cross-shard writes',
    'Generate globally unique, roughly time-ordered IDs (Snowflake-style bigint, UUIDv7)',
    'Plan an online rebalancing / resharding operation'
  ],
  concept: `<p>Once data is spread across shards, four classes of problems appear that a single PostgreSQL instance solved for free.</p>
<p><strong>1. Cross-shard queries (scatter-gather).</strong> A query without the shard key is sent to all shards; partial results are merged. Merging must be <em>algebraically correct</em>: <code>count</code> and <code>sum</code> add up, <code>avg</code> must be recomputed as Σsum/Σcount (never the average of averages), <code>count(DISTINCT)</code> needs all distinct values or an approximation (HyperLogLog), global <code>ORDER BY ... LIMIT 10</code> needs each shard's top 10 then a final sort, and deep <code>OFFSET</code> pagination is very expensive (each shard returns OFFSET+LIMIT rows) — use keyset pagination.</p>
<p><strong>2. Distributed joins.</strong> Strategies: <em>co-located</em> (both tables share shard key → join locally, best), <em>broadcast/reference</em> (small table copied to every shard), <em>repartition/shuffle</em> (re-hash one or both inputs over the network by the join key — expensive), or <em>pull to coordinator</em> (only for small results).</p>
<p><strong>3. Cross-shard transactions.</strong> Each shard has its own commit; moving money from a customer on shard 1 to one on shard 3 must be atomic. Options: <strong>two-phase commit (2PC)</strong> — a coordinator runs <code>PREPARE TRANSACTION 'gid'</code> <span class="tag core">core</span> on every participant, then <code>COMMIT PREPARED</code> when all succeeded (blocking if the coordinator fails mid-way; requires <code>max_prepared_transactions &gt; 0</code>); or <strong>sagas</strong> — a sequence of local transactions with <em>compensating actions</em> on failure (reserve stock → charge card → if charging fails, release stock), usually driven by an <strong>outbox</strong> table and a message relay for reliable event delivery. Sagas give availability but only eventual consistency.</p>
<p><strong>4. Global unique IDs.</strong> Per-shard sequences collide. Options: <strong>UUIDv4</strong> (random, 16 bytes, poor index locality), <strong>UUIDv7</strong> (time-ordered, <code>uuidv7()</code> is core in PG18), <strong>Snowflake-style bigint</strong> (41 bits milliseconds + 10 bits shard/node + 12 bits sequence — 8 bytes, sortable by time, encodes the shard), or sequences with per-shard offsets/increments.</p>
<p><strong>5. Rebalancing and resharding.</strong> <em>Rebalancing</em> moves existing logical shards to new servers (the mapping function stays the same). <em>Resharding</em> changes the shard count or key (splitting shards), which re-maps rows. Both are done online: copy (snapshot + change stream via logical replication), catch up, brief write freeze for the moving range, switch routing, clean up.</p>
<p><strong>Analogy:</strong> branch libraries again. "How many books in total?" — phone every branch and add (scatter-gather). "Average book age?" — ask each for total age and count, not their averages. Moving a book from branch A to B atomically — either both ledgers change (2PC: both branch managers sign, then the head office says "go"), or you move it and, if B rejects it, send it back with a note (saga).</p>`,
  why: `<p>These are the costs that make sharding a serious architectural decision. Systems that ignore them ship wrong numbers (averaged averages), slow dashboards (deep pagination across 64 shards), inconsistent money movements (half-applied transfers) or duplicate IDs. Designing them deliberately — co-location to avoid most cross-shard work, explicit patterns for the rest — is what separates a working sharded system from a distributed outage generator.</p>`,
  useCase: `<p>A wallet app shards accounts by <code>account_id</code> across 16 shards. 92% of transactions are single-account (top-up, payment to merchant on a shared reference shard) and stay local. Peer-to-peer transfers between accounts on different shards (8%) use a <strong>saga</strong>: debit the sender with a <code>transfer_out</code> row and an outbox event in one local transaction; a relay delivers the event; the receiver's shard credits idempotently (unique <code>transfer_id</code>); a timeout triggers a compensating refund. IDs are Snowflake bigints embedding the shard number, so support staff can route any transaction ID to its shard instantly. Global reports run in the warehouse, fed by CDC.</p>`,
  internals: `<p><strong>2PC in PostgreSQL:</strong> <code>PREPARE TRANSACTION 'gid'</code> persists the transaction's state (locks held!) to disk and detaches it from the session; <code>COMMIT PREPARED 'gid'</code> or <code>ROLLBACK PREPARED 'gid'</code> finishes it from any session. Orphaned prepared transactions (coordinator crashed) keep holding locks and block VACUUM's xmin horizon; monitor <code>pg_prepared_xacts</code>. Citus implements such a coordinator with a recovery log (<code>pg_dist_transaction</code>) that finishes or aborts orphaned prepared transactions automatically; core postgres_fdw does <em>not</em> use 2PC.</p>
<p><strong>Snowflake layout</strong> (one common variant): bit 63 unused (sign), 41 bits = ms since a custom epoch (~69 years), 10 bits = node/shard id (1024), 12 bits = per-ms sequence (4096 IDs/ms/node). IDs are k-sorted by time, fit in <code>bigint</code>, and the shard id can be extracted with bit operations.</p>
<p><strong>UUIDv7</strong>: 48-bit Unix ms timestamp + version/variant bits + random bits; sorted by creation time, so B-tree inserts are append-mostly (unlike UUIDv4, which scatters inserts across the whole index). PG18 provides <code>uuidv7()</code> and <code>uuid_extract_timestamp()</code> <span class="tag core">core</span>.</p>`,
  whenNot: `<ul><li>Don't use 2PC across services/shards for high-throughput paths if you can redesign for co-location — 2PC multiplies latency (two round trips + fsyncs) and blocks on coordinator failure.</li>
<li>Don't run real-time OLAP across all OLTP shards — replicate to a warehouse/columnar store.</li>
<li>Don't use random UUIDv4 as primary key for huge write-heavy tables if index locality matters — prefer UUIDv7 or Snowflake IDs.</li>
<li>Don't reshard (change shard count or key) when rebalancing (moving logical shards) would do.</li></ul>`,
  syntax: `-- 2PC (core; needs max_prepared_transactions > 0 on each participant)
BEGIN; UPDATE accounts SET balance = balance - 100 WHERE id = 1; PREPARE TRANSACTION 'xfer-77-s1';
BEGIN; UPDATE accounts SET balance = balance + 100 WHERE id = 9; PREPARE TRANSACTION 'xfer-77-s3';
COMMIT PREPARED 'xfer-77-s1';  COMMIT PREPARED 'xfer-77-s3';     -- or ROLLBACK PREPARED
SELECT gid, prepared, owner FROM pg_prepared_xacts;

-- global IDs
SELECT uuidv7();                                  -- PG18 core
SELECT uuid_extract_timestamp(uuidv7());`,
  examples: [
    { label: 'Basic', title: 'Scatter-gather done right: merging partial aggregates',
      sql: `-- Each "shard" returns partial aggregates (simulated with hash buckets)
WITH partials AS (
  SELECT abs(hashtext(customer_id::text)) % 4 AS shard,
         count(*)          AS n,
         sum(total_amount) AS s,
         avg(total_amount) AS shard_avg
  FROM orders
  GROUP BY 1
)
SELECT round(sum(s) / sum(n), 2)  AS correct_global_avg,     -- Σsum / Σcount
       round(avg(shard_avg), 2)    AS wrong_avg_of_avgs,
       (SELECT round(avg(total_amount), 2) FROM orders) AS single_node_truth
FROM partials;`,
      explain: `<p>Each shard can only compute its own partial result. A correct coordinator asks for <code>sum</code> and <code>count</code> and divides at the end. Averaging the shard averages weights a shard with 1,141 orders the same as one with 1,395 — the error grows with skew. Distributed engines (Citus, Spark, etc.) rewrite <code>avg</code> into sum/count automatically; hand-written application scatter-gather often gets this wrong.</p>`,
      output: ` correct_global_avg | wrong_avg_of_avgs | single_node_truth
--------------------+-------------------+-------------------
          247184.69 |         247179.94 |         247184.69
(the average of shard averages is off by ~4.75)`, run: true },
    { label: 'Intermediate', title: 'Globally unique IDs: Snowflake-style bigint and UUIDv7',
      sql: `-- Snowflake-style: 41 bits ms since custom epoch | 10 bits shard | 12 bits sequence
CREATE SEQUENCE snowflake_seq;
CREATE FUNCTION snowflake_id(p_shard int) RETURNS bigint
LANGUAGE sql VOLATILE AS $$
  SELECT ((floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
           - 1704067200000)                   -- custom epoch 2024-01-01 UTC
          << 22)
       | ((p_shard & 1023)::bigint << 12)
       | (nextval('snowflake_seq') & 4095)
$$;

WITH ids AS (SELECT snowflake_id(7) AS id FROM generate_series(1, 3))
SELECT id,
       (id >> 22) + 1704067200000                     AS unix_ms,
       to_timestamp(((id >> 22) + 1704067200000) / 1000.0) AS created_at,
       (id >> 12) & 1023                                AS shard,
       id & 4095                                        AS seq
FROM ids;

-- UUIDv7 (PG18 core): time-ordered UUIDs
SELECT u, uuid_extract_version(u) AS version, uuid_extract_timestamp(u) AS ts
FROM (SELECT uuidv7() AS u FROM generate_series(1, 3)) s;`,
      explain: `<p>The Snowflake ID packs creation time, shard and a sequence into a sortable 64-bit integer — 8 bytes instead of 16 for UUIDs, and the shard number is recoverable with bit shifts (<code>&gt;&gt;</code>, <code>&amp;</code>), so any ID can be routed without a lookup. Real implementations also handle clock skew (never go backwards) and per-ms sequence overflow. UUIDv7 needs no coordination at all and is time-ordered, keeping B-tree inserts at the right edge of the index.</p>`,
      output: `         id         |    unix_ms    |         created_at         | shard | seq
--------------------+---------------+----------------------------+-------+-----
 365472266709921793 | 1791202578530 | 2026-10-05 12:16:18.53+00  |     7 |   1
 365472266718310402 | 1791202578532 | 2026-10-05 12:16:18.532+00 |     7 |   2
 365472266718310403 | 1791202578532 | 2026-10-05 12:16:18.532+00 |     7 |   3

                  u                   | version |             ts
--------------------------------------+---------+----------------------------
 01a10bfe-5067-7000-ac31-6f65c1a35dc8 |       7 | 2026-10-05 12:16:18.535+00
 01a10bfe-5067-7001-825a-0c6647ada5e4 |       7 | 2026-10-05 12:16:18.535+00
 01a10bfe-5067-7002-b624-970ec8943190 |       7 | 2026-10-05 12:16:18.535+00
(values depend on the current time)`, run: true },
    { label: 'Advanced', title: 'A saga with an outbox for a cross-shard transfer',
      sql: `-- Shard 1 (sender) — ONE local transaction: debit + outbox event
CREATE TABLE wallet (account_id int PRIMARY KEY, balance numeric(12,2) NOT NULL CHECK (balance >= 0));
CREATE TABLE outbox (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE TABLE transfers (transfer_id uuid PRIMARY KEY, from_acct int, to_acct int,
                        amount numeric(12,2), state text NOT NULL);
INSERT INTO wallet VALUES (101, 5000), (909, 100);   -- pretend 909 is on another shard

WITH t AS (SELECT uuidv7() AS id)
, debit AS (
  UPDATE wallet SET balance = balance - 1200 WHERE account_id = 101 RETURNING account_id)
, rec AS (
  INSERT INTO transfers SELECT t.id, 101, 909, 1200, 'DEBITED' FROM t, debit RETURNING transfer_id)
INSERT INTO outbox (event_type, payload)
SELECT 'TransferDebited', jsonb_build_object('transfer_id', transfer_id, 'to', 909, 'amount', 1200)
FROM rec;

-- Relay picks unpublished events (FOR UPDATE SKIP LOCKED allows parallel relays)
SELECT id, event_type, payload->>'amount' AS amount
FROM outbox WHERE published_at IS NULL
ORDER BY id
FOR UPDATE SKIP LOCKED;

-- Shard 2 would credit idempotently (ON CONFLICT on transfer_id).
-- If crediting fails permanently: compensating transaction on shard 1
UPDATE wallet SET balance = balance + 1200 WHERE account_id = 101;
UPDATE transfers SET state = 'COMPENSATED' WHERE from_acct = 101 AND state = 'DEBITED';
SELECT account_id, balance FROM wallet ORDER BY account_id;`,
      explain: `<p>The debit, the transfer record and the outbox event commit atomically on the sender's shard — so the event can never be lost or published for a debit that didn't happen. A relay publishes events (Kafka/queue or direct call) and marks them published; the receiving shard applies the credit idempotently keyed by <code>transfer_id</code>. On permanent failure a compensating local transaction refunds the sender. Between steps the system is temporarily inconsistent (money "in flight") — that is the saga trade-off versus 2PC's blocking.</p>`,
      output: ` id | event_type      | amount
----+-----------------+--------
  1 | TransferDebited | 1200

 account_id | balance
------------+---------
        101 | 5000.00
        909 |  100.00
(after compensation the sender is whole again)`, run: true }
  ],
  compare: {
    bad: { sql: `-- Deep offset pagination across shards
SELECT id, order_date, total_amount
FROM orders
ORDER BY order_date DESC, id DESC
OFFSET 4000 LIMIT 20;
-- on 16 shards each shard must return 4020 rows → 64,320 rows merged to show 20`, why: 'OFFSET cost grows with page depth on every shard; the coordinator sorts and discards almost everything.', run: true },
    good: { sql: `-- Keyset pagination: each shard returns at most 20 rows after the cursor
SELECT id, order_date, total_amount
FROM orders
WHERE (order_date, id) < ('2024-03-01 00:00:00+00', 1000)
ORDER BY order_date DESC, id DESC
LIMIT 20;`, why: 'Each shard seeks directly past the cursor (index on (order_date, id)) and returns ≤ LIMIT rows; merge cost is constant per page.', run: true }
  },
  mistakes: [
    'Averaging shard averages or summing per-shard distinct counts.',
    'Using per-shard sequences without offsets → duplicate IDs across shards.',
    'Leaving orphaned prepared transactions (2PC) holding locks and blocking VACUUM.',
    'Implementing a saga without idempotency, so retries double-credit or double-charge.',
    'Publishing events outside the database transaction (dual write) instead of an outbox.',
    'Resharding by stop-the-world dump/reload instead of online copy + catch-up per logical shard.'
  ],
  best: [
    'Design for co-location so cross-shard operations are the exception, not the rule.',
    'Merge aggregates algebraically; use keyset pagination; push down filters and LIMIT to shards.',
    'Use sagas + outbox + idempotency keys for business workflows; reserve 2PC for infrastructure-level atomicity with monitoring of <code>pg_prepared_xacts</code>.',
    'Adopt UUIDv7 or Snowflake-style IDs before sharding; encode the shard in IDs where routing by ID is needed.',
    'Rehearse rebalancing on production-size data; move one logical shard at a time with automated verification.'
  ],
  performance: `<p>Scatter-gather latency = slowest shard + merge; with 32 shards the query's p99 approximates a single shard's p99.97, so tail latency matters more than averages. Repartition joins move data across the network — often the dominant cost. 2PC adds at least one extra round trip and fsync per participant and holds locks across the prepare phase. Sagas keep each step local and fast but add asynchronous delay (milliseconds to seconds) before global consistency. Snowflake/UUIDv7 IDs keep B-tree inserts sequential (good cache locality) versus UUIDv4's random page writes and higher WAL volume (full-page images).</p>`,
  security: `<p>Cross-shard workflows carry payloads between systems — sign or authenticate outbox messages, avoid PII in events where not needed, and log saga state transitions for audit. 2PC coordinators need credentials to every shard; restrict them. Snowflake IDs leak creation time and shard number, and UUIDv7 leaks creation time — acceptable for most internal IDs but avoid exposing them where that is sensitive (use a separate opaque public ID).</p>`,
  scenario: { title: 'Rebalancing: adding 4 servers to a 4-server, 64-logical-shard cluster under load', steps: [
    '1. Plan: move 32 logical shards (8 per new server) — ~50% of data; order by size, largest last.',
    '2. For logical shard k: start logical replication (or Citus shard move) of rows with hash % 64 = k to the target; wait for initial copy and catch-up.',
    '3. Cutover for shard k: block writes for k (router returns retryable error or queues ~1-3 s), wait for zero lag, verify row counts/checksums, update placement, unblock.',
    '4. Clean up: delete shard k\'s rows on the source (in batches), VACUUM; monitor replication slots so no orphan remains.',
    '5. Throttle: one or two moves at a time, outside peak hours; the whole rebalance takes days, but each customer sees at most a few seconds of retry.',
    '6. Afterwards: verify per-server load and storage are even; update capacity dashboards.'
  ] },
  widgets: ['diagram:sharding', 'diagram:citus', 'lab:shard'],
  interview: [
    { q: 'How do you compute a global average over shards?', a: 'Collect sum and count from each shard and compute Σsum/Σcount at the coordinator. Averaging per-shard averages is wrong unless all shards have the same count.' },
    { q: 'Compare 2PC and sagas.', a: '2PC gives atomic commit across participants: prepare everywhere, then commit; it holds locks during the protocol and blocks if the coordinator fails after prepare. Sagas split work into local transactions with compensating actions; they avoid distributed locks and stay available but are only eventually consistent and require idempotency and careful compensation design.' },
    { q: 'What are the options for globally unique IDs in a sharded system?', a: 'UUIDv4 (random, no coordination, poor index locality), UUIDv7 (time-ordered, PG18 uuidv7()), Snowflake-style 64-bit IDs combining timestamp, node/shard and sequence (sortable, compact, routable), or per-shard sequences with offsets/increments or ranges allocated from a central service.' },
    { q: 'What is the outbox pattern?', a: 'Write the business change and an event row into an outbox table in the same local transaction; a separate relay reads the outbox (e.g. FOR UPDATE SKIP LOCKED or CDC) and publishes the event, marking it sent. It avoids the dual-write problem where the DB commit and message publish can diverge.' }
  ],
  exercises: [
    { task: 'Compute the global top 5 customers by revenue the scatter-gather way: each of 4 hash shards returns its own top 5, then merge.', solution: `WITH per_shard AS (
  SELECT shard, customer_id, revenue
  FROM (SELECT abs(hashtext(customer_id::text)) % 4 AS shard, customer_id,
               sum(total_amount) AS revenue,
               row_number() OVER (PARTITION BY abs(hashtext(customer_id::text)) % 4
                                  ORDER BY sum(total_amount) DESC) AS rk
        FROM orders GROUP BY customer_id) s
  WHERE rk <= 5
)
SELECT customer_id, shard, revenue
FROM per_shard
ORDER BY revenue DESC
LIMIT 5;`, run: true },
    { task: 'Generate 5 UUIDv7 values and prove they sort in creation order.', solution: `WITH g AS (SELECT n, uuidv7() AS u FROM generate_series(1, 5) n)
SELECT n, u, row_number() OVER (ORDER BY u) AS sort_position
FROM g ORDER BY n;`, run: true }
  ],
  challenge: { task: 'Simulate two-phase commit bookkeeping without real PREPARE (disabled in the sandbox): create a coordinator log with states PREPARING/PREPARED/COMMITTED per participant, mark two participants prepared, decide COMMIT only if all are prepared, and return the decision.', hint: 'A table (gid, participant, state); decision = bool_and(state = \'PREPARED\').', solution: `CREATE TABLE twopc_log (gid text, participant text, state text, PRIMARY KEY (gid, participant));
INSERT INTO twopc_log VALUES ('xfer-77', 'shard-1', 'PREPARING'), ('xfer-77', 'shard-3', 'PREPARING');
UPDATE twopc_log SET state = 'PREPARED' WHERE gid = 'xfer-77';     -- both voted yes

WITH decision AS (
  SELECT gid, CASE WHEN bool_and(state = 'PREPARED') THEN 'COMMIT' ELSE 'ROLLBACK' END AS outcome
  FROM twopc_log WHERE gid = 'xfer-77' GROUP BY gid
)
UPDATE twopc_log l SET state = CASE d.outcome WHEN 'COMMIT' THEN 'COMMITTED' ELSE 'ROLLED_BACK' END
FROM decision d WHERE l.gid = d.gid
RETURNING l.participant, l.state;`, run: true },
  related: ['sharding-shard-key', 'sharding-postgresql-approaches', 'distributed-postgresql-transactions', 'transactions'],
  quiz: [
    { type: 'mcq', q: 'Shards return (count, avg): (100, 10) and (300, 20). Correct global average?', options: ['15', '17.5', '20', '30'], answer: 1, explain: '(100×10 + 300×20) / 400 = 7000/400 = 17.5.' },
    { type: 'tf', q: 'A prepared transaction (PREPARE TRANSACTION) keeps its locks until COMMIT PREPARED or ROLLBACK PREPARED, even if the session disconnects.', answer: true, explain: 'Prepared transactions are persisted and detached from the session, holding locks and the xmin horizon.' },
    { type: 'predict', q: 'Bits: 41 ms | 10 shard | 12 seq. What does (id >> 12) & 1023 extract?', code: `SELECT (id >> 12) & 1023 FROM ids;`, options: ['Timestamp', 'Shard/node id', 'Sequence', 'Sign bit'], answer: 1, explain: 'Shift away the 12 sequence bits, then mask 10 bits — the shard id.' },
    { type: 'design', q: 'A cross-shard order workflow (reserve stock, charge card, create shipment) must stay available during partial outages. Pattern?', options: ['2PC across all services', 'Saga with compensations, outbox events and idempotent steps', 'One global lock', 'Distributed SERIALIZABLE'], answer: 1, explain: 'Sagas keep each step local and available, compensating on failure.' },
    { type: 'optimize', q: 'Page 500 of a sorted list across 32 shards is very slow. Best fix?', code: `SELECT * FROM orders ORDER BY order_date DESC OFFSET 10000 LIMIT 20;`, options: ['Bigger coordinator', 'Keyset pagination with a (order_date, id) cursor', 'More shards', 'Disable sorting'], answer: 1, explain: 'Each shard then returns ≤ 20 rows after the cursor instead of 10,020.' }
  ]
},
{
  id: 'sharding-postgresql-approaches',
  module: 'sharding',
  title: 'Sharding PostgreSQL in Practice: Application-Level, Citus, postgres_fdw + Partitioning',
  level: 6,
  minutes: 35,
  summary: 'The concrete ways to shard PostgreSQL — routing in the application, the Citus extension, and postgres_fdw foreign partitions — with local hash-partitioning demos, configuration, and a trade-offs table.',
  objectives: [
    'Implement application-level shard routing with a shard map',
    'Explain how Citus (extension) distributes tables and routes queries',
    'Build a poor-man\'s sharding layout with declarative partitioning + postgres_fdw foreign tables',
    'Use local hash partitioning to rehearse shard layouts and partition-wise joins',
    'Compare approaches on transactions, joins, operations and maturity'
  ],
  concept: `<p>There are three mainstream ways to shard PostgreSQL:</p>
<p><strong>1. Application-level sharding.</strong> The application (or a shared library/service) computes the shard for each request and holds a connection pool per shard. Each shard is an ordinary PostgreSQL cluster (with its own HA). Used by many large companies (Instagram's early design, Notion's shard migration, Figma's horizontally sharded Postgres). <em>Pros:</em> no special database software, full control, each shard independently operable. <em>Cons:</em> all cross-shard logic (scatter-gather, joins, global IDs, rebalancing, migrations) is your code.</p>
<p><strong>2. Citus</strong> <span class="tag ext">extension</span> (open source, by Microsoft; also Azure Cosmos DB for PostgreSQL). A PostgreSQL extension that turns a cluster of PostgreSQL servers into a distributed database: a coordinator (and optionally all workers) holds metadata; <code>create_distributed_table('orders', 'customer_id')</code> splits a table into hash shards (default 32) on workers; <code>create_reference_table</code> replicates small tables everywhere; queries are routed, pushed down or parallelised automatically; distributed transactions use 2PC internally; shards can be rebalanced online. Covered in depth in the Distributed PostgreSQL module.</p>
<p><strong>3. Declarative partitioning + postgres_fdw</strong> <span class="tag core">core</span> + <span class="tag ext">extension (contrib)</span>. A parent table on a "router" server is partitioned (e.g. <code>PARTITION BY HASH (customer_id)</code>), and each partition is a <em>foreign table</em> pointing to a table on another server via <code>postgres_fdw</code>. The planner prunes partitions and pushes down WHERE clauses, aggregates, sorts and joins where possible; <code>async_capable</code> (PG14+) scans remote partitions in parallel. <em>Cons:</em> no distributed transaction guarantees (no 2PC in postgres_fdw — a multi-shard write commits per server), limited pushdown for complex joins, INSERT routing works but bulk performance and DDL are manual, no rebalancer. Good for archives, analytics federation and prototypes; rarely the main OLTP sharding mechanism.</p>
<p><strong>Analogy:</strong> app-level sharding is running your own fleet of delivery vans with your own dispatch software; Citus is hiring a logistics company whose dispatch system plugs into your warehouse; postgres_fdw is phoning partner warehouses and asking them to ship items — works, but you coordinate every call.</p>
<p>Before any of these, <strong>local hash partitioning</strong> on one server is a great rehearsal: same shard key, same co-location rules, partition-wise joins — and later each partition could become a shard.</p>`,
  why: `<p>Choosing the mechanism determines how much distributed-systems code your team writes and operates. Many teams underestimate application-level sharding's long tail (migrations across N shards, rebalancing tooling, reporting) or adopt an extension without understanding its constraints (distribution column in unique keys, function and DDL propagation). A trade-offs table grounded in the workload avoids both.</p>`,
  useCase: `<p>Three companies, three choices: (1) a B2B SaaS with 30k tenants and simple tenant-scoped queries adopts <strong>Citus</strong> — mostly a schema change (add <code>tenant_id</code> to keys) and <code>create_distributed_table</code> calls; (2) a consumer social app with a large platform team keeps <strong>application-level</strong> sharding across 512 logical shards on 32 Patroni clusters for full control; (3) a logistics firm keeps 2 years of shipments locally and attaches older years as <strong>postgres_fdw</strong> foreign partitions on a cheap archive server, so occasional historical queries still work through the same parent table.</p>`,
  internals: `<p><strong>Partition-wise operations</strong> <span class="tag core">core</span>: with <code>enable_partitionwise_join = on</code> and both tables partitioned identically on the join key, the planner joins matching partitions pairwise (exactly what a sharded engine does with co-located shards). <code>enable_partitionwise_aggregate</code> pushes GROUP BY below the Append. Both are off by default because they increase planning cost.</p>
<p><strong>postgres_fdw</strong>: foreign server + user mapping + foreign table; remote queries are deparsed SQL sent over libpq. <code>use_remote_estimate</code>, <code>fetch_size</code>, <code>batch_size</code> (bulk inserts, PG14+), <code>async_capable</code> tune it. Each remote server commits independently; postgres_fdw keeps remote transactions open while the local transaction runs and commits them at local commit (with <code>parallel_commit</code> PG15+), but a crash between remote commits can leave some committed and some not.</p>
<p><strong>Citus routing</strong>: the coordinator hashes the distribution column value with PostgreSQL's hash functions into one of N shard hash ranges (metadata in <code>pg_dist_shard</code>, placements in <code>pg_dist_placement</code>). Router queries (key equality) go to one worker; multi-shard queries are parallelised and merged; co-located joins are pushed down; non-co-located joins may be repartitioned.</p>`,
  whenNot: `<ul><li>Application-level sharding when your team cannot invest in tooling for migrations, rebalancing and cross-shard reporting.</li>
<li>Citus when you need features it restricts (some unique constraints without the distribution column, certain cross-shard foreign keys, some DDL/function patterns) or when a managed service you depend on doesn't offer it.</li>
<li>postgres_fdw as an OLTP sharding layer requiring atomic multi-shard writes or heavy cross-shard joins.</li>
<li>Any of them if a single node with partitioning still fits — local partitioning keeps full ACID and simplicity.</li></ul>`,
  syntax: `-- Local hash partitioning (core) — rehearsal for sharding
CREATE TABLE orders_h (LIKE orders) PARTITION BY HASH (customer_id);
CREATE TABLE orders_h_0 PARTITION OF orders_h FOR VALUES WITH (MODULUS 4, REMAINDER 0);

-- postgres_fdw foreign partition (extension shipped with PostgreSQL contrib)
CREATE EXTENSION postgres_fdw;
CREATE SERVER shard1 FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'pg-shard-1', dbname 'company_db');
CREATE USER MAPPING FOR app SERVER shard1 OPTIONS (user 'app', password '...');
CREATE FOREIGN TABLE orders_h_1 PARTITION OF orders_h FOR VALUES WITH (MODULUS 4, REMAINDER 1)
  SERVER shard1 OPTIONS (table_name 'orders_h_1');

-- Citus (extension)
SELECT create_distributed_table('orders', 'customer_id');
SELECT create_reference_table('products');`,
  examples: [
    { label: 'Basic', title: 'Rehearse a 4-shard layout with local hash partitioning',
      sql: `CREATE TABLE orders_sharded (
  id           bigint,
  customer_id  int NOT NULL,
  status       text,
  order_date   timestamptz,
  total_amount numeric,
  PRIMARY KEY (customer_id, id)          -- key must include the partition (shard) key
) PARTITION BY HASH (customer_id);

CREATE TABLE orders_sharded_0 PARTITION OF orders_sharded FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE orders_sharded_1 PARTITION OF orders_sharded FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE orders_sharded_2 PARTITION OF orders_sharded FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE orders_sharded_3 PARTITION OF orders_sharded FOR VALUES WITH (MODULUS 4, REMAINDER 3);

INSERT INTO orders_sharded
SELECT id, customer_id, status, order_date, total_amount FROM orders;

SELECT tableoid::regclass AS shard, count(*) AS orders, count(DISTINCT customer_id) AS customers
FROM orders_sharded
GROUP BY 1 ORDER BY 1;

EXPLAIN (COSTS OFF)
SELECT * FROM orders_sharded WHERE customer_id = 42;`,
      explain: `<p>Hash partitioning uses PostgreSQL's own partition hash function (not <code>hashtext</code>), so counts differ from the earlier simulation but are similarly even. The primary key must contain the partition key — exactly the constraint Citus imposes on distributed tables. The plan shows <strong>partition pruning</strong>: a query with the key touches one partition, the single-node equivalent of a router query to one shard.</p>`,
      output: ` shard            | orders | customers
------------------+--------+-----------
 orders_sharded_0 |   1343 |       139
 orders_sharded_1 |   1217 |       120
 orders_sharded_2 |   1300 |       129
 orders_sharded_3 |   1140 |       112

 QUERY PLAN
-----------------------------------------------------
 Bitmap Heap Scan on orders_sharded_2 orders_sharded
   Recheck Cond: (customer_id = 42)
   ->  Bitmap Index Scan on orders_sharded_2_pkey
         Index Cond: (customer_id = 42)`, run: true },
    { label: 'Intermediate', title: 'Co-located (partition-wise) join — what a sharded engine does',
      sql: `CREATE TABLE cust_sh (id int PRIMARY KEY, name text, country text) PARTITION BY HASH (id);
CREATE TABLE ord_sh  (id bigint, customer_id int, total_amount numeric,
                      PRIMARY KEY (customer_id, id)) PARTITION BY HASH (customer_id);
DO $$
BEGIN
  FOR r IN 0..3 LOOP
    EXECUTE format('CREATE TABLE cust_sh_%s PARTITION OF cust_sh FOR VALUES WITH (MODULUS 4, REMAINDER %s)', r, r);
    EXECUTE format('CREATE TABLE ord_sh_%s  PARTITION OF ord_sh  FOR VALUES WITH (MODULUS 4, REMAINDER %s)', r, r);
  END LOOP;
END $$;
INSERT INTO cust_sh SELECT id, name, country FROM customers;
INSERT INTO ord_sh  SELECT id, customer_id, total_amount FROM orders;
ANALYZE cust_sh; ANALYZE ord_sh;

SET enable_partitionwise_join = on;
SET enable_partitionwise_aggregate = on;

EXPLAIN (COSTS OFF)
SELECT c.country, count(*), sum(o.total_amount)
FROM cust_sh c JOIN ord_sh o ON o.customer_id = c.id
GROUP BY c.country;`,
      explain: `<p>Because both tables are hash-partitioned with the same modulus on the join key, the planner joins <code>cust_sh_0</code> with <code>ord_sh_0</code>, <code>cust_sh_1</code> with <code>ord_sh_1</code>, etc. — four independent joins under an Append, each of which could run on a different server. With <code>enable_partitionwise_aggregate</code> a <em>Partial HashAggregate</em> also runs per pair and only small partial results are combined by <em>Finalize GroupAggregate</em> — the same two-phase aggregation a distributed engine pushes to its workers. This is <strong>co-location</strong>: Citus does exactly this across workers. If the tables were partitioned differently, the plan would join the full Append outputs — the single-node analogue of a costly repartition join.</p>`,
      output: ` QUERY PLAN
-----------------------------------------------------------------
 Finalize GroupAggregate
   Group Key: c.country
   ->  Sort
         Sort Key: c.country
         ->  Append
               ->  Partial HashAggregate
                     Group Key: c.country
                     ->  Hash Join
                           Hash Cond: (o.customer_id = c.id)
                           ->  Seq Scan on ord_sh_0 o
                           ->  Hash
                                 ->  Seq Scan on cust_sh_0 c
               ->  Partial HashAggregate
                     Group Key: c_1.country
                     ->  Hash Join
                           Hash Cond: (o_1.customer_id = c_1.id)
                           ->  Seq Scan on ord_sh_1 o_1
                           ->  Hash
                                 ->  Seq Scan on cust_sh_1 c_1
               ... (same for partitions 2 and 3)`, run: true },
    { label: 'Advanced', title: 'Application-level shard map and routing function',
      sql: `-- Central (replicated, cached) metadata used by the application router
CREATE TABLE shard_map (
  logical_shard int PRIMARY KEY CHECK (logical_shard BETWEEN 0 AND 63),
  dsn           text NOT NULL,      -- connection target for that shard's primary
  state         text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'moving', 'readonly'))
);
INSERT INTO shard_map
SELECT s,
       format('postgresql://app@pg-shard-%s.internal:6432/company_db?target_session_attrs=read-write', s % 4),
       'active'
FROM generate_series(0, 63) AS s;

CREATE FUNCTION route(p_customer_id int)
RETURNS TABLE (logical_shard int, dsn text, state text)
LANGUAGE sql STABLE AS $$
  SELECT m.logical_shard, m.dsn, m.state
  FROM shard_map m
  WHERE m.logical_shard = abs(hashtext(p_customer_id::text)) % 64
$$;

SELECT c.id AS customer_id, r.logical_shard, r.dsn
FROM customers c, LATERAL route(c.id) r
WHERE c.id IN (1, 2, 42, 500)
ORDER BY c.id;`,
      explain: `<p>The application calls the equivalent of <code>route()</code> (in its own language, with the map cached in memory) and uses the pool for that DSN. 64 logical shards on 4 servers leave room to grow to 8, 16, 32 or 64 servers by moving logical shards. The <code>state</code> column lets the router reject or queue writes for a shard that is being moved. Pair every DSN with HA (Patroni + PgBouncer) — each shard is a full cluster.</p>`,
      output: ` customer_id | logical_shard | dsn
-------------+---------------+--------------------------------------------------------------------------------------
           1 |             7 | postgresql://app@pg-shard-3.internal:6432/company_db?target_session_attrs=read-write
           2 |            62 | postgresql://app@pg-shard-2.internal:6432/company_db?target_session_attrs=read-write
          42 |            62 | postgresql://app@pg-shard-2.internal:6432/company_db?target_session_attrs=read-write
         500 |            61 | postgresql://app@pg-shard-1.internal:6432/company_db?target_session_attrs=read-write`, run: true }
  ],
  compare: {
    bad: { sql: `-- Partitioned differently → no partition-wise join possible
CREATE TABLE c2 (id int PRIMARY KEY, country text) PARTITION BY HASH (id);
CREATE TABLE c2_0 PARTITION OF c2 FOR VALUES WITH (MODULUS 2, REMAINDER 0);
CREATE TABLE c2_1 PARTITION OF c2 FOR VALUES WITH (MODULUS 2, REMAINDER 1);
CREATE TABLE o2 (id bigint PRIMARY KEY, customer_id int, total numeric) PARTITION BY HASH (id);
CREATE TABLE o2_0 PARTITION OF o2 FOR VALUES WITH (MODULUS 2, REMAINDER 0);
CREATE TABLE o2_1 PARTITION OF o2 FOR VALUES WITH (MODULUS 2, REMAINDER 1);
SET enable_partitionwise_join = on;
EXPLAIN (COSTS OFF)
SELECT count(*) FROM c2 JOIN o2 ON o2.customer_id = c2.id;`, why: 'Orders partitioned by their own id cannot be joined partition-by-partition with customers: the planner must join the full appended inputs — on a real sharded cluster, a network repartition.', run: true },
    good: { sql: `CREATE TABLE c3 (id int PRIMARY KEY, country text) PARTITION BY HASH (id);
CREATE TABLE c3_0 PARTITION OF c3 FOR VALUES WITH (MODULUS 2, REMAINDER 0);
CREATE TABLE c3_1 PARTITION OF c3 FOR VALUES WITH (MODULUS 2, REMAINDER 1);
CREATE TABLE o3 (id bigint, customer_id int, total numeric, PRIMARY KEY (customer_id, id)) PARTITION BY HASH (customer_id);
CREATE TABLE o3_0 PARTITION OF o3 FOR VALUES WITH (MODULUS 2, REMAINDER 0);
CREATE TABLE o3_1 PARTITION OF o3 FOR VALUES WITH (MODULUS 2, REMAINDER 1);
SET enable_partitionwise_join = on;
EXPLAIN (COSTS OFF)
SELECT count(*) FROM c3 JOIN o3 ON o3.customer_id = c3.id;`, why: 'Same key, same modulus → the planner joins matching partitions pairwise; in a sharded system these joins run locally on each shard.', run: true }
  },
  mistakes: [
    'Using postgres_fdw foreign partitions for OLTP writes that span shards and expecting atomicity.',
    'Adopting Citus without adding the distribution column to primary keys, unique constraints and foreign keys.',
    'App-level sharding with the shard map hard-coded in config files across services (no versioning, inconsistent rollouts).',
    'Forgetting that each shard needs its own HA, backups and monitoring — N clusters, not one.',
    'Choosing hash partition modulus/shard counts that cannot grow (e.g. 3) instead of a highly divisible logical count (32, 64, 192).'
  ],
  best: [
    'Rehearse shard keys and co-location with local hash partitioning and partition-wise joins.',
    'Start with Citus for multi-tenant SaaS with tenant-scoped queries; consider app-level sharding when you need maximal control and have platform capacity.',
    'Use postgres_fdw for federation, archives and migrations — not as a general OLTP sharding layer.',
    'Keep shard metadata in a replicated database with caching and versioning.',
    'Automate per-shard operations: migrations, vacuum/analyze checks, upgrades, backups.'
  ],
  performance: `<p>Local partition pruning makes single-key lookups touch one partition; partition-wise join/aggregate reduce memory per join and enable parallelism. postgres_fdw adds a network round trip per remote scan (mitigated with <code>fetch_size</code>, <code>async_capable</code>, pushdown); joins between foreign tables on different servers are executed locally after fetching data — potentially huge transfers. Citus pushes down co-located joins and aggregates and parallelises multi-shard queries over worker cores; router queries add a coordinator hop (~0.5-1 ms) unless the app connects to the right worker directly.</p>`,
  security: `<p>postgres_fdw user mappings store remote credentials (visible to superusers; use <code>password_required</code> and certificate auth where possible). App-level shard maps contain connection strings — keep secrets out of the table (reference secret names instead). Citus internal connections between nodes need authentication (certificates or .pgpass) and TLS. Apply the same roles, RLS policies and auditing on every shard.</p>`,
  scenario: { title: 'Choosing a sharding approach for a 12 TB multi-tenant analytics SaaS', steps: [
    '1. Workload: 95% of queries filter by tenant_id; dashboards aggregate within a tenant; 3 tenants are 40% of data.',
    '2. App-level: full control but the team of 4 would need to build routing, migrations, rebalancing and cross-tenant admin queries.',
    '3. postgres_fdw: no atomic multi-shard writes, limited pushdown for dashboards — rejected for the primary store.',
    '4. Citus: add tenant_id to all keys, create_distributed_table on tenant_id, reference tables for plans/currencies; isolate the 3 whales with tenant isolation onto dedicated shards (isolate_tenant_to_new_shard) — accepted.',
    '5. Rehearsal: local hash partitioning on staging to validate keys and co-located joins; then a Citus PoC with production-size data and the top 50 queries.'
  ] },
  widgets: ['diagram:sharding', 'diagram:citus', 'diagram:partitioning', 'lab:partition'],
  interview: [
    { q: 'What are the main ways to shard PostgreSQL?', a: 'Application-level sharding (app routes to independent PostgreSQL clusters via a shard map), the Citus extension (distributed tables, coordinator/workers, automatic routing, 2PC, rebalancer), and declarative partitioning with postgres_fdw foreign-table partitions on remote servers (federation; limited transactional guarantees).' },
    { q: 'Why must the primary key of a hash-partitioned table include the partition key?', a: 'Uniqueness is enforced per partition by local indexes; PostgreSQL can only guarantee global uniqueness if the partition key is part of the unique key, so equal key values always land in the same partition. Distributed databases like Citus impose the same rule for shards.' },
    { q: 'What is a partition-wise join and how does it relate to sharding?', a: 'When two tables are partitioned identically on the join key, the planner joins matching partition pairs separately (enable_partitionwise_join). It is the single-node analogue of co-located joins in a sharded cluster, where each pair lives on the same shard.' },
    { q: 'What are the limitations of postgres_fdw for sharding?', a: 'No two-phase commit: multi-server writes are not atomic on failure; limited pushdown of joins between different servers; no automatic rebalancing; DDL and schema management are manual; performance depends on network round trips and pushdown.' }
  ],
  exercises: [
    { task: 'Create customers hash-partitioned into 3 partitions by id, load all customers, and count rows per partition.', solution: `CREATE TABLE customers_p (LIKE customers INCLUDING DEFAULTS) PARTITION BY HASH (id);
CREATE TABLE customers_p0 PARTITION OF customers_p FOR VALUES WITH (MODULUS 3, REMAINDER 0);
CREATE TABLE customers_p1 PARTITION OF customers_p FOR VALUES WITH (MODULUS 3, REMAINDER 1);
CREATE TABLE customers_p2 PARTITION OF customers_p FOR VALUES WITH (MODULUS 3, REMAINDER 2);
INSERT INTO customers_p OVERRIDING SYSTEM VALUE SELECT * FROM customers;
SELECT tableoid::regclass AS part, count(*) FROM customers_p GROUP BY 1 ORDER BY 1;`, run: true },
    { task: 'Use satisfies_hash_partition() to find which of 4 hash partitions customer_id 42 would go to for a table partitioned by an int column.', solution: `CREATE TABLE t_hash (customer_id int) PARTITION BY HASH (customer_id);
CREATE TABLE t_hash_0 PARTITION OF t_hash FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE t_hash_1 PARTITION OF t_hash FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE t_hash_2 PARTITION OF t_hash FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE t_hash_3 PARTITION OF t_hash FOR VALUES WITH (MODULUS 4, REMAINDER 3);
SELECT r AS remainder
FROM generate_series(0, 3) r
WHERE satisfies_hash_partition('t_hash'::regclass, 4, r, 42);`, run: true }
  ],
  challenge: { task: 'Extend the shard_map design: mark logical shard 5 as "moving", then write a routing query that, for a list of customers, returns the DSN or the text RETRY when their shard is moving.', hint: 'Join customers to shard_map on the computed logical shard and use CASE on state.', solution: `CREATE TABLE shard_map (logical_shard int PRIMARY KEY, dsn text NOT NULL, state text NOT NULL DEFAULT 'active');
INSERT INTO shard_map SELECT s, 'pg-shard-' || (s % 4) || '.internal', 'active' FROM generate_series(0, 63) s;
UPDATE shard_map SET state = 'moving' WHERE logical_shard = 5;

SELECT c.id,
       m.logical_shard,
       CASE WHEN m.state = 'moving' THEN 'RETRY' ELSE m.dsn END AS target
FROM customers c
JOIN shard_map m ON m.logical_shard = abs(hashtext(c.id::text)) % 64
WHERE c.id <= 40
ORDER BY (m.state = 'moving') DESC, c.id
LIMIT 10;`, run: true },
  related: ['sharding-cross-shard', 'distributed-postgresql-citus', 'partitioning', 'sharding-strategies'],
  quiz: [
    { type: 'mcq', q: 'Which approach provides automatic distributed transactions (2PC) across shards?', options: ['postgres_fdw foreign partitions', 'Citus', 'Plain hash partitioning', 'pgbouncer'], answer: 1, explain: 'Citus coordinates multi-shard writes with two-phase commit; postgres_fdw does not.' },
    { type: 'tf', q: 'Citus is a PostgreSQL extension, not core PostgreSQL partitioning.', answer: true, explain: 'Citus is an open-source extension that adds distributed tables on top of PostgreSQL.' },
    { type: 'predict', q: 'What happens with this table definition?', code: `CREATE TABLE t (id bigint PRIMARY KEY, customer_id int) PARTITION BY HASH (customer_id);`, options: ['Works', 'ERROR: unique constraint on partitioned table must include all partitioning columns', 'Creates 4 partitions automatically', 'Partitions by id'], answer: 1, explain: 'The PK must include customer_id.' },
    { type: 'design', q: 'You want to keep 10 years of orders queryable but move years older than 2 to a cheap server, through the same parent table. Best fit?', options: ['Citus reference tables', 'Range partitioning with old partitions as postgres_fdw foreign tables', 'Application-level hash sharding', 'Logical replication only'], answer: 1, explain: 'Foreign partitions allow transparent federation of archival data.' }
  ]
}
]);
PGM.addLessons([
/* ======================================================================
   MODULE: distributed-postgresql (3)
   ====================================================================== */
{
  id: 'distributed-postgresql-citus',
  module: 'distributed-postgresql',
  title: 'Distributed SQL Concepts with Citus: Coordinator, Workers, Distributed and Reference Tables, Co-location',
  level: 6,
  minutes: 35,
  summary: 'How a distributed PostgreSQL engine (Citus, an extension) splits tables into shards across worker nodes, replicates reference tables, co-locates related tables, and plans router, multi-shard and repartition queries — with the exact Citus commands (not runnable in this sandbox) and local simulations you can run.',
  objectives: [
    'Describe the roles of coordinator and worker nodes and where metadata lives',
    'Distribute tables with create_distributed_table and replicate small ones with create_reference_table',
    'Explain shards, hash ranges, placements and co-location groups',
    'Predict whether a query is a router, multi-shard (pushdown) or repartition query',
    'Adapt a schema (keys, foreign keys, unique constraints) for distribution',
    'Rebalance shards when adding nodes'
  ],
  concept: `<p><strong>Distributed SQL</strong> engines present many servers as one SQL database. <strong>Citus</strong> <span class="tag ext">extension</span> does this <em>inside</em> PostgreSQL: every node is a normal PostgreSQL server with the Citus extension loaded (<code>shared_preload_libraries = 'citus'</code>), so you keep PostgreSQL's SQL, data types, indexes and extensions. Citus code and commands below are <strong>not runnable in this single-node sandbox</strong>; the examples simulate the mechanics with core SQL.</p>
<ul>
<li><strong>Coordinator</strong> — the node applications connect to (in Citus 11+ any worker can also accept queries since metadata is synced to all nodes). It stores metadata: which tables are distributed, their shards (<code>pg_dist_shard</code>), and where each shard lives (<code>pg_dist_placement</code>, <code>pg_dist_node</code>). It plans queries and merges results.</li>
<li><strong>Workers</strong> — store shards as ordinary tables named like <code>orders_102008</code> and execute fragments of queries in parallel.</li>
<li><strong>Distributed table</strong> — <code>SELECT create_distributed_table('orders', 'customer_id');</code> hashes the <em>distribution column</em> into <code>citus.shard_count</code> (default 32) hash ranges, creates one shard table per range on the workers, and moves existing data.</li>
<li><strong>Reference table</strong> — <code>SELECT create_reference_table('products');</code> keeps a full copy on every node; joins with any distributed table are local. Ideal for small, read-mostly dimension tables. Writes go to all copies (2PC).</li>
<li><strong>Local tables</strong> — tables left on the coordinator only.</li>
<li><strong>Co-location</strong> — distributed tables with the same distribution column type and shard count are placed in the same <em>co-location group</em>: shard <em>i</em> of <code>customers</code> and shard <em>i</em> of <code>orders</code> cover the same hash range and live on the same worker. Joins and foreign keys on the distribution column are then executed locally per shard.</li>
</ul>
<p><strong>Analogy:</strong> the coordinator is a head chef taking orders; workers are line cooks each owning a station with their own fridges (shards). A dish involving one customer goes to one cook (router query). A banquet for everyone is split across all cooks and plated at the pass (multi-shard). Salt and pepper (reference tables) sit at every station. If one dish needs ingredients from two different cooks' fridges (non-co-located join), someone has to run between stations (repartition) — slow.</p>
<p>Query types: <strong>router</strong> (filter on the distribution column equals a value → one shard; full SQL supported, single-node latency), <strong>multi-shard / pushdown</strong> (no key filter; the query is sent to all shards in parallel and partial results merged — aggregates are split into partial/final), <strong>repartition joins</strong> (joining distributed tables on a non-distribution column — data is shuffled between workers; must be enabled with <code>citus.enable_repartition_joins</code>).</p>`,
  why: `<p>Distributed SQL lets you keep relational modelling, SQL and ACID for single-shard work while scaling storage, memory and CPU across machines — without writing your own router, scatter-gather merger, 2PC coordinator and rebalancer as with application-level sharding. For multi-tenant SaaS and real-time analytics on large event tables, it often turns a 6-month sharding project into weeks of schema adjustment.</p>`,
  useCase: `<p>A marketing analytics SaaS stores 9 billion events (14 TB) for 6,000 customers. With Citus: <code>events</code>, <code>campaigns</code>, <code>customers</code> distributed by <code>customer_id</code> (co-located), <code>countries</code>, <code>plans</code> and <code>currencies</code> as reference tables, 64 shards on 8 workers (each 32 vCPU). Customer dashboards are router queries (p95 120 ms). Internal "all customers" reports are multi-shard queries parallelised across 256 cores (40 s instead of 25 minutes on one node). Adding two workers and running <code>citus_rebalance_start()</code> moved 16 shards online over a weekend.</p>`,
  internals: `<p><strong>Shard ranges</strong>: the distribution column value is hashed with PostgreSQL's hash function for that type (for <code>int</code> it is the same function used by hash partitioning/hash indexes, e.g. <code>hashint4</code>) into the signed 32-bit space [-2³¹, 2³¹-1], which is divided evenly into <code>shard_count</code> ranges stored as <code>shardminvalue</code>/<code>shardmaxvalue</code>. A router query hashes the constant, finds the range, and sends the query to that shard's placement.</p>
<p><strong>Planning</strong>: the distributed planner tries, in order, fast-path router planning, router planning, pushdown planning (the whole query can run per shard and results concatenated/merged), then recursive planning (subqueries/CTEs that can't be pushed down are executed first and their results broadcast as intermediate results), and repartition joins. The adaptive executor opens multiple connections per worker to parallelise across shards (<code>citus.max_adaptive_executor_pool_size</code>).</p>
<p><strong>Schema rules</strong>: primary keys and unique constraints on distributed tables must include the distribution column; foreign keys between distributed tables must be between co-located tables and include the distribution column; foreign keys from distributed to reference tables are allowed. Sequences/identity: generate IDs that are unique cluster-wide (Citus handles <code>bigserial</code>/identity on distributed tables with node-specific ranges, or use UUIDs).</p>
<p><strong>Operations</strong>: <code>citus_add_node</code>, <code>citus_rebalance_start()</code> (background, online shard moves using logical replication), <code>isolate_tenant_to_new_shard</code> for whales, <code>alter_distributed_table</code> to change shard count/column, <code>create_distributed_table_concurrently</code> to distribute without long write locks. Citus 12 added <strong>schema-based sharding</strong>: each schema (e.g. per tenant) becomes a unit placed on a node.</p>`,
  whenNot: `<ul><li>Datasets that fit one node comfortably — Citus adds a network hop and operational complexity.</li>
<li>Workloads dominated by complex queries joining many tables on different keys (graph-like, ad-hoc BI across every dimension) — expect repartition joins; a columnar warehouse may fit better.</li>
<li>Applications that cannot add the distribution column to keys and queries.</li>
<li>When you need globally consistent snapshots for multi-shard reads under concurrent distributed writes (Citus multi-shard reads are not a single global snapshot).</li></ul>`,
  syntax: `-- Citus extension — run on coordinator (not available in this sandbox)
CREATE EXTENSION citus;
SELECT citus_set_coordinator_host('coord.internal', 5432);
SELECT citus_add_node('worker-1.internal', 5432);
SELECT citus_add_node('worker-2.internal', 5432);

SELECT create_distributed_table('customers', 'id');
SELECT create_distributed_table('orders', 'customer_id', colocate_with => 'customers');
SELECT create_reference_table('products');

SELECT * FROM citus_tables;          -- distribution info
SELECT * FROM citus_shards;          -- shard placement and sizes
SELECT citus_rebalance_start();      -- move shards to new nodes in background`,
  examples: [
    { label: 'Basic', title: 'Distributing company_db with Citus (reference, not runnable here)',
      sql: `-- 1. keys must include the distribution column
ALTER TABLE orders DROP CONSTRAINT orders_pkey;
ALTER TABLE orders ADD PRIMARY KEY (customer_id, id);
ALTER TABLE order_items ADD COLUMN customer_id int;            -- denormalised shard key
UPDATE order_items oi SET customer_id = o.customer_id FROM orders o WHERE o.id = oi.order_id;
ALTER TABLE order_items DROP CONSTRAINT order_items_pkey;
ALTER TABLE order_items ADD PRIMARY KEY (customer_id, id);

-- 2. distribute and co-locate by customer
SELECT create_distributed_table('customers',   'id');
SELECT create_distributed_table('orders',      'customer_id', colocate_with => 'customers');
SELECT create_distributed_table('order_items', 'customer_id', colocate_with => 'orders');
SELECT create_distributed_table('payments',    'customer_id', colocate_with => 'orders'); -- after adding customer_id

-- 3. small dimension tables everywhere
SELECT create_reference_table('products');
SELECT create_reference_table('departments');

SELECT table_name, citus_table_type, distribution_column, colocation_id, shard_count
FROM citus_tables;`,
      explain: `<p>The real work is schema preparation: adding the distribution column to child tables and to every PK/UK/FK. After that, distribution is one call per table. All customer-owned tables share colocation id, so "customer 42's orders with items and products" is a router query with local joins (products is a reference table present on every worker).</p>`,
      output: ` table_name  | citus_table_type | distribution_column | colocation_id | shard_count
-------------+------------------+---------------------+---------------+-------------
 customers   | distributed      | id                  |             2 |          32
 departments | reference        | <none>              |             1 |           1
 order_items | distributed      | customer_id         |             2 |          32
 orders      | distributed      | customer_id         |             2 |          32
 payments    | distributed      | customer_id         |             2 |          32
 products    | reference        | <none>              |             1 |           1`, run: false },
    { label: 'Intermediate', title: 'Simulate Citus shard ranges and route a key',
      sql: `-- 32 hash ranges over the signed 32-bit space, like pg_dist_shard
WITH shards AS (
  SELECT n AS shard_index,
         102008 + n AS shardid,
         (-2147483648::bigint + n * (4294967296 / 32))                         AS shardminvalue,
         CASE WHEN n = 31 THEN 2147483647
              ELSE -2147483648::bigint + (n + 1) * (4294967296 / 32) - 1 END AS shardmaxvalue,
         'worker-' || (n % 4 + 1)                                            AS node
  FROM generate_series(0, 31) AS n
)
SELECT k.customer_id,
       hashint4(k.customer_id) AS hash_value,
       s.shardid,
       'orders_' || s.shardid  AS shard_table,
       s.node
FROM (VALUES (1), (42), (500)) AS k(customer_id)
JOIN shards s ON hashint4(k.customer_id) BETWEEN s.shardminvalue AND s.shardmaxvalue
ORDER BY k.customer_id;`,
      explain: `<p>This mirrors how a router query is planned: hash the constant with the column type's hash function (<code>hashint4</code> for <code>int</code>), find the shard whose [min, max] range contains it, and send the query to the worker holding that shard. Shard IDs and node assignment here are illustrative; in Citus they come from <code>pg_dist_shard</code> and <code>pg_dist_placement</code>. Because <code>orders</code> and <code>customers</code> are co-located, the same shard index holds customer 42 in both tables.</p>`,
      output: ` customer_id | hash_value  | shardid | shard_table   | node
-------------+-------------+---------+---------------+----------
           1 | -1905060026 |  102009 | orders_102009 | worker-2
          42 |  1509752520 |  102035 | orders_102035 | worker-4
         500 |   265850202 |  102025 | orders_102025 | worker-2`, run: true },
    { label: 'Advanced', title: 'Router vs multi-shard vs repartition: reading Citus EXPLAIN',
      sql: `-- Router query: distribution column equality → one shard
EXPLAIN SELECT o.id, o.total_amount, p.name
FROM orders o JOIN order_items oi USING (customer_id) JOIN products p ON p.id = oi.product_id
WHERE o.customer_id = 42 AND oi.order_id = o.id;
--  Custom Scan (Citus Adaptive)
--    Task Count: 1
--    Tasks Shown: All
--    ->  Task
--          Node: host=worker-4 port=5432 dbname=company_db
--          ->  Nested Loop ... on orders_102035 / order_items_102099 / products_102001

-- Multi-shard aggregate: pushed down to all 32 shards, merged on coordinator
EXPLAIN SELECT status, count(*), sum(total_amount) FROM orders GROUP BY status;
--  HashAggregate  (merge of partial results)
--    ->  Custom Scan (Citus Adaptive)
--          Task Count: 32
--          ->  Task  ->  HashAggregate  ->  Seq Scan on orders_102008 ...

-- Non-co-located join (orders.status vs payments.status) → repartition join
SET citus.enable_repartition_joins = on;
EXPLAIN SELECT count(*) FROM orders o JOIN payments p ON p.status = o.status;
--  Custom Scan (Citus Adaptive)
--    Task Count: 4 ...  MapMergeJob / repartition tasks`,
      explain: `<p>Task Count is the first thing to read: 1 = router (fast, single-node semantics), N = fan-out. For multi-shard aggregates, each shard computes a partial aggregate and the coordinator finalises. A join not on the distribution column requires shuffling rows between workers (repartition) — the most expensive pattern; redesign keys or use reference tables to avoid it. Output shapes are illustrative of Citus EXPLAIN; not runnable here.</p>`,
      output: `Router:       Task Count: 1
Multi-shard:  Task Count: 32 (one per shard), coordinator merges
Repartition:  map tasks + merge tasks across workers`, run: false }
  ],
  compare: {
    bad: { sql: `-- Distributing a small, frequently joined lookup table
SELECT create_distributed_table('departments', 'id');
-- every join employees -> departments now needs cross-shard lookups`, why: 'Small dimension tables distributed by their own id are never co-located with the big tables joining them, forcing repartition or coordinator joins.', run: false },
    good: { sql: `SELECT create_reference_table('departments');
-- a full copy on every worker: joins from any distributed table are local`, why: 'Reference tables are replicated to every node, so joins with any shard happen locally; writes are rare and replicated with 2PC.', run: false }
  },
  mistakes: [
    'Distributing tables without adding the distribution column to PKs, unique constraints and FKs — the call fails or constraints must be dropped.',
    'Distributing related tables by different columns, making their joins non-co-located.',
    'Making large, frequently updated tables reference tables (every write goes to every node).',
    'Choosing shard_count too small to rebalance across future nodes (e.g. 8 shards cannot spread over 16 workers).',
    'Sending all traffic through a single coordinator connection pool without PgBouncer — Citus opens several connections per worker per query.',
    'Assuming multi-shard reads see a globally consistent snapshot under concurrent distributed writes.'
  ],
  best: [
    'Distribute by the tenant/customer key; co-locate everything owned by it; make small dimensions reference tables.',
    'Use a shard count that is a multiple of the expected maximum node count (e.g. 32-128).',
    'Check Task Count in EXPLAIN for the top queries; keep latency-critical queries as router queries.',
    'Use <code>citus_rebalance_start()</code> after adding nodes; monitor with <code>citus_rebalance_status()</code>.',
    'Pool connections in front of the coordinator (and tune <code>citus.max_shared_pool_size</code>).'
  ],
  performance: `<p>Router queries cost one extra hop compared to a single node (~0.3-1 ms), or none when the app connects to the right worker. Multi-shard queries run in parallel across all workers' cores — near-linear speed-ups for scans and aggregates — but are bound by the slowest shard and merge cost. Repartition joins move data over the network and can be orders of magnitude slower. Reference table writes are slower (2PC to all nodes). Shard size sweet spot is typically a few GB to tens of GB per shard: big enough to amortise overhead, small enough to move quickly.</p>`,
  security: `<p>Nodes connect to each other with internal credentials: use certificate authentication or .pgpass, TLS (<code>citus.node_conninfo = 'sslmode=verify-full'</code>), and restrict pg_hba.conf to cluster subnets. Roles and grants are propagated from the coordinator to workers by Citus; RLS policies can be used on distributed tables (verify version support). Shard tables on workers should not be accessed directly by applications.</p>`,
  scenario: { title: 'Migrating a 4 TB multi-tenant database to Citus with minimal downtime', steps: [
    '1. Schema prep on the single node: add tenant_id to child tables, backfill in batches, change PK/FK to include tenant_id, update application queries to always filter by tenant_id.',
    '2. Build the Citus cluster (coordinator + 6 workers, each with HA), create the schema, distribute tables (empty) and reference tables.',
    '3. Replicate data with logical replication from the old primary into the Citus coordinator (distributed tables accept replicated rows).',
    '4. Validate counts and top queries (Task Count = 1 for tenant queries), load test.',
    '5. Cutover: stop writes, wait for lag 0, sync sequences, switch PgBouncer target; rollback path kept via reverse replication for 48 h.'
  ] },
  widgets: ['diagram:citus', 'diagram:sharding', 'lab:shard'],
  interview: [
    { q: 'What is the difference between a distributed table and a reference table in Citus?', a: 'A distributed table is split into hash shards by its distribution column and spread across workers; each row lives in one shard. A reference table is replicated in full to every node so it can be joined locally with any shard; it suits small, read-mostly dimension tables.' },
    { q: 'What is co-location and why does it matter?', a: 'Tables distributed on the same column type with the same shard count share hash ranges and placements, so matching rows sit on the same worker. Joins, foreign keys and transactions on the distribution column then execute locally per shard without network shuffling.' },
    { q: 'What is a router query?', a: 'A query that filters on the distribution column with equality (and only touches co-located tables or reference tables), so the planner can send it to a single shard. It supports full SQL and has single-node latency.' },
    { q: 'How do you add capacity to a Citus cluster?', a: 'Add worker nodes with citus_add_node and run citus_rebalance_start(), which moves shards (using logical replication, online) until data is balanced. Shard count must be large enough to spread across the new node count.' }
  ],
  exercises: [
    { task: 'Compute the hash range boundaries (min and max) for shard index 0, 15 and 31 of a 32-shard table.', solution: `SELECT n AS shard_index,
       -2147483648::bigint + n * (4294967296 / 32) AS shardminvalue,
       CASE WHEN n = 31 THEN 2147483647
            ELSE -2147483648::bigint + (n + 1) * (4294967296 / 32) - 1 END AS shardmaxvalue
FROM unnest(ARRAY[0, 15, 31]) AS n;`, run: true },
    { task: 'Using hashint4, compute how many company_db customers fall into each of 8 equal hash ranges (simulating an 8-shard distributed table).', solution: `SELECT floor((hashint4(id)::bigint + 2147483648) / (4294967296 / 8)) AS shard_index,
       count(*) AS customers
FROM customers
GROUP BY 1
ORDER BY 1;`, run: true }
  ],
  challenge: { task: 'Classify sample queries as ROUTER, MULTI-SHARD or REPARTITION for a schema where customers/orders/order_items are distributed by customer (column id / customer_id) and products is a reference table. Write the result as a VALUES table with a reason column.', hint: 'Ask: does it filter on the distribution column with equality? Are all joins on the distribution column or with reference tables?', solution: `SELECT q, kind, reason FROM (VALUES
  ('SELECT * FROM orders WHERE customer_id = 7', 'ROUTER', 'equality on distribution column'),
  ('SELECT o.*, p.name FROM orders o JOIN order_items i ON i.customer_id = o.customer_id AND i.order_id = o.id JOIN products p ON p.id = i.product_id WHERE o.customer_id = 7', 'ROUTER', 'co-located join + reference table, single key'),
  ('SELECT status, count(*) FROM orders GROUP BY status', 'MULTI-SHARD', 'no key filter; pushdown aggregate to all shards'),
  ('SELECT c.country, sum(o.total_amount) FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY 1', 'MULTI-SHARD', 'co-located join pushed down to every shard'),
  ('SELECT count(*) FROM orders o JOIN payments p ON p.status = o.status', 'REPARTITION', 'join on a non-distribution column')
) AS t(q, kind, reason);`, run: true },
  related: ['distributed-postgresql-transactions', 'distributed-postgresql-landscape', 'sharding-postgresql-approaches', 'sharding-shard-key'],
  quiz: [
    { type: 'mcq', q: 'Which Citus function replicates a small table to every node?', options: ['create_distributed_table', 'create_reference_table', 'citus_add_node', 'alter_distributed_table'], answer: 1, explain: 'create_reference_table keeps a full copy on every node for local joins.' },
    { type: 'tf', q: 'In Citus, a primary key on a distributed table must include the distribution column.', answer: true, explain: 'Uniqueness is enforced per shard, so the distribution column must be part of unique constraints.' },
    { type: 'predict', q: 'orders is distributed by customer_id across 32 shards. What Task Count does EXPLAIN show?', code: `SELECT count(*) FROM orders WHERE status = 'paid';`, options: ['1', '4', '32', '0'], answer: 2, explain: 'No distribution-column filter → the query runs on all 32 shards.' },
    { type: 'design', q: 'employees (distributed by its own id) joins departments (8 rows) constantly. What should departments be?', options: ['Distributed by id', 'Reference table', 'Local coordinator table only', 'Foreign table'], answer: 1, explain: 'Small dimension tables should be reference tables so every shard joins locally.' },
    { type: 'mcq', q: 'Is Citus part of core PostgreSQL?', options: ['Yes, since PG14', 'No, it is an open-source extension', 'Only in PG18', 'Only on Azure'], answer: 1, explain: 'Citus is an extension (also offered as a managed Azure service).' }
  ]
},
{
  id: 'distributed-postgresql-transactions',
  module: 'distributed-postgresql',
  title: 'Distributed Transactions and Consistency: 2PC, CAP, PACELC and Consistency Models',
  level: 6,
  minutes: 35,
  summary: 'What changes when one transaction spans many nodes — two-phase commit and its failure modes, CAP and PACELC applied honestly, consistency models from linearizable to eventual, and how distributed PostgreSQL differs from a single node.',
  objectives: [
    'Walk through two-phase commit with PREPARE TRANSACTION / COMMIT PREPARED and its blocking failure mode',
    'State CAP precisely and apply PACELC to real PostgreSQL deployments',
    'Distinguish consistency models (linearizable, sequential, causal, read-your-writes, eventual) from isolation levels',
    'Explain why a sharded system lacks a global snapshot and what that means for queries',
    'Use LSN tokens to provide read-your-writes on replicas'
  ],
  concept: `<p>On a single PostgreSQL node, a transaction is atomic, isolated by one MVCC snapshot system and durable through one WAL. Distribute data over several nodes and each property needs a protocol.</p>
<p><strong>Two-phase commit (2PC)</strong> <span class="tag core">core</span> provides <em>atomicity</em> across nodes. Phase 1 (<em>prepare</em>): the coordinator asks every participant to <code>PREPARE TRANSACTION 'gid'</code> — each makes the transaction durable but undecided and votes yes. Phase 2 (<em>commit</em>): if all voted yes, the coordinator records the decision and sends <code>COMMIT PREPARED 'gid'</code>; otherwise <code>ROLLBACK PREPARED</code>. PostgreSQL disables this by default (<code>max_prepared_transactions = 0</code>). The weakness: if the coordinator dies after participants prepared, they are <strong>blocked</strong> — holding locks — until a decision is recovered. Distributed databases make the coordinator's log highly available (Citus' recovery, Raft-replicated transaction records in CockroachDB/YugabyteDB).</p>
<p><strong>CAP theorem</strong>: during a network <strong>P</strong>artition, a distributed system must choose between <strong>C</strong>onsistency (linearizability — every read sees the latest write) and <strong>A</strong>vailability (every non-failed node answers). It says nothing about normal operation. <strong>PACELC</strong> completes it: if <strong>P</strong>artition, choose <strong>A</strong> or <strong>C</strong>; <strong>E</strong>lse (normal operation) choose <strong>L</strong>atency or <strong>C</strong>onsistency.</p>
<ul><li>PostgreSQL primary + async replicas: PA/EL for replica reads (stale reads possible, low latency), but writes are CP-ish (only the primary accepts them; a partitioned minority stops writes with Patroni).</li>
<li>Synchronous replication with <code>remote_apply</code>: PC/EC — consistent reads from sync standbys, paid in latency, and writes block if no standby answers.</li>
<li>CockroachDB/YugabyteDB/Spanner: PC/EC — Raft quorum per range; a minority partition becomes unavailable.</li></ul>
<p><strong>Consistency models</strong> (about what reads may observe across nodes) are not the same as <strong>isolation levels</strong> (about interleaving of concurrent transactions): <em>linearizable</em> (real-time order, as if one copy), <em>sequential</em>, <em>causal</em> (cause before effect everywhere), session guarantees — <em>read-your-writes</em>, <em>monotonic reads</em> — and <em>eventual</em> (replicas converge if writes stop). PostgreSQL's isolation levels (Read Committed default, Repeatable Read = snapshot isolation, Serializable = SSI) apply to one node's snapshot.</p>
<p><strong>Analogy:</strong> a wedding with guests in two halls connected by a phone line. 2PC is the officiant asking both halls "do you agree?" and only then announcing — if the officiant faints after the question, both halls wait frozen. CAP: when the phone line is cut, each hall must either stop the ceremony (consistency) or continue on its own and reconcile later (availability).</p>`,
  why: `<p>Architects choose between single-node PostgreSQL, primary-replica setups, sharded PostgreSQL and NewSQL systems largely on these properties. Misunderstanding them causes real incidents: stale replica reads showing an unpaid order as unpaid after payment, distributed writes left half-applied, or reports summing numbers from different points in time. Precise vocabulary (CAP vs PACELC, isolation vs consistency) also prevents talking past each other in design reviews.</p>`,
  useCase: `<p>A brokerage stores accounts sharded by <code>account_id</code> on Citus. Internal transfers between two accounts on different shards use a distributed transaction (Citus 2PC under the hood) — correctness over latency (extra ~2 ms). Portfolio pages read from async replicas, but immediately after a trade the app passes the commit LSN as a token and reads from a replica only once it has replayed that LSN (read-your-writes); otherwise it reads the primary. End-of-day regulatory reports run on a consistent snapshot taken from a PITR restore at 23:59:59 rather than querying live shards concurrently.</p>`,
  internals: `<p><strong>PostgreSQL 2PC internals</strong>: <code>PREPARE TRANSACTION</code> writes the transaction state to WAL and a state file (<code>pg_twophase/</code> at checkpoint), releases the session but keeps locks and the xid as running (it holds back the xmin horizon). Monitor <code>pg_prepared_xacts</code> (<code>gid</code>, <code>prepared</code> time, <code>owner</code>, <code>database</code>) and alert on anything older than seconds — an orphan blocks VACUUM and can cause wraparound pressure. Set <code>max_prepared_transactions</code> ≥ <code>max_connections</code> on participants that use it.</p>
<p><strong>No global snapshot</strong>: each node has its own transaction IDs and snapshots. A multi-shard query in Citus takes a snapshot per shard at slightly different moments; a distributed transaction committing concurrently can be visible on one shard and not yet on another. Systems like Spanner (TrueTime), CockroachDB (hybrid logical clocks), and YugabyteDB use timestamps to give global snapshot reads; core PostgreSQL across independent nodes does not.</p>
<p><strong>Read-your-writes with LSNs</strong>: after a write commits on the primary, <code>pg_current_wal_lsn()</code> returns a position at or after its commit record. A replica whose <code>pg_last_wal_replay_lsn()</code> ≥ that token has applied the write. Routers can pick a replica that has caught up or fall back to the primary.</p>`,
  whenNot: `<ul><li>Don't use 2PC for long workflows involving external systems or users — use sagas.</li>
<li>Don't distribute a workload that needs frequent cross-entity serializable transactions unless the engine provides distributed serializable isolation (and you accept its latency).</li>
<li>Don't promise linearizable reads from async replicas.</li>
<li>Don't invoke CAP to justify inconsistency during normal operation — that is the PACELC "else" trade-off, a latency choice.</li></ul>`,
  syntax: `-- 2PC (core): participants need max_prepared_transactions > 0 (restart)
BEGIN;
UPDATE accounts SET balance = balance - 500 WHERE id = 1;
PREPARE TRANSACTION 'xfer-9001-p1';
-- later, from any session:
COMMIT PREPARED 'xfer-9001-p1';      -- or ROLLBACK PREPARED 'xfer-9001-p1'
SELECT gid, prepared, owner, database FROM pg_prepared_xacts;

-- read-your-writes token
SELECT pg_current_wal_lsn();                       -- on primary after commit
SELECT pg_last_wal_replay_lsn() >= '0/1DC73B8';    -- on replica`,
  examples: [
    { label: 'Basic', title: 'Is two-phase commit enabled here? Any orphaned prepared transactions?',
      sql: `SELECT current_setting('max_prepared_transactions') AS max_prepared_transactions,
       current_setting('max_prepared_transactions')::int > 0 AS two_phase_enabled;

SELECT gid, prepared, now() - prepared AS age, owner, database
FROM pg_prepared_xacts
ORDER BY prepared;`,
      explain: `<p>With the default <code>max_prepared_transactions = 0</code>, <code>PREPARE TRANSACTION</code> fails with "prepared transactions are disabled" — a safety default because orphans are dangerous. Nodes acting as 2PC participants (Citus workers, XA transaction managers in Java EE) must raise it. The second query is the monitoring check: any row older than a minute deserves an alert.</p>`,
      output: ` max_prepared_transactions | two_phase_enabled
---------------------------+-------------------
 0                         | f

 gid | prepared | age | owner | database
-----+----------+-----+-------+----------
(0 rows)`, run: true },
    { label: 'Intermediate', title: 'Read-your-writes routing with LSN tokens',
      sql: `-- On the primary, right after the user's write commits:
INSERT INTO audit_logs (table_name, operation, row_id, new_data, changed_by)
VALUES ('orders', 'UPDATE', 5000, '{"status": "paid"}', 'checkout');
SELECT pg_current_wal_lsn() AS commit_token;     -- returned to the client (cookie/header)

-- The router knows each replica's replay position (polled every few hundred ms)
WITH replicas(name, replay_lsn) AS (
  VALUES ('replica-a', pg_current_wal_lsn()),                 -- fully caught up
         ('replica-b', '0/1000000'::pg_lsn),                  -- behind
         ('replica-c', pg_current_wal_lsn() - 64)             -- 64 bytes behind
)
SELECT name,
       replay_lsn >= pg_current_wal_lsn() AS can_serve_read_your_writes,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS bytes_behind
FROM replicas
ORDER BY bytes_behind;`,
      explain: `<p>Session consistency without making replication synchronous: the client carries the LSN of its last write; the router sends its reads only to replicas whose replay LSN is at least that token, otherwise to the primary. On a real replica the check is <code>pg_last_wal_replay_lsn() &gt;= token</code>. Subtracting a number from a <code>pg_lsn</code> (PG14+) yields an earlier LSN — used here to fake a lagging replica.</p>`,
      output: ` commit_token
--------------
 0/1DC9A10     (varies)

 name      | can_serve_read_your_writes | bytes_behind
-----------+----------------------------+--------------
 replica-a | t                          |            0
 replica-c | f                          |           64
 replica-b | f                          |     14453264 (varies)`, run: true },
    { label: 'Advanced', title: 'Two-phase commit across two participants (needs max_prepared_transactions > 0)',
      sql: `-- Participant A (shard holding account 1)
BEGIN;
UPDATE accounts SET balance = balance - 500 WHERE id = 1 AND balance >= 500;
PREPARE TRANSACTION 'xfer-9001-A';          -- vote YES (durable, locks held)

-- Participant B (shard holding account 9)
BEGIN;
UPDATE accounts SET balance = balance + 500 WHERE id = 9;
PREPARE TRANSACTION 'xfer-9001-B';          -- vote YES

-- Coordinator: both prepared → log decision durably, then
COMMIT PREPARED 'xfer-9001-A';              -- on A
COMMIT PREPARED 'xfer-9001-B';              -- on B
-- If any PREPARE failed: ROLLBACK PREPARED on those that succeeded.

-- Recovery after coordinator crash: on each participant
SELECT gid, prepared FROM pg_prepared_xacts WHERE gid LIKE 'xfer-%';
-- consult the coordinator's decision log, then COMMIT/ROLLBACK PREPARED each gid`,
      explain: `<p>The "in-doubt" window between PREPARE and COMMIT PREPARED is where 2PC blocks: participants cannot decide alone, because the other might have voted no. That is why the decision must be durably logged before phase 2 and why orphan monitoring is mandatory. Not runnable in the sandbox: prepared transactions are disabled (and need two servers to be meaningful).</p>`,
      output: `PREPARE TRANSACTION
PREPARE TRANSACTION
COMMIT PREPARED
COMMIT PREPARED`, run: false }
  ],
  compare: {
    bad: { sql: `-- "Distributed transaction" without 2PC: two independent commits
-- shard A:  BEGIN; UPDATE accounts SET balance = balance - 500 WHERE id = 1; COMMIT;
-- (application crashes here)
-- shard B:  BEGIN; UPDATE accounts SET balance = balance + 500 WHERE id = 9; COMMIT;`, why: 'A crash between the commits loses 500 permanently — atomicity is violated. postgres_fdw multi-server writes have the same exposure.', run: false },
    good: { sql: `-- Either 2PC (prepare both, durable decision, commit both),
-- or a saga: local debit + outbox event in ONE transaction on shard A,
-- idempotent credit on shard B keyed by transfer_id,
-- compensating refund on permanent failure.`, why: '2PC guarantees all-or-nothing at the cost of blocking risk; sagas guarantee eventual all-or-compensated with high availability. Both are explicit about failure handling.', run: false }
  },
  mistakes: [
    'Saying "CAP means we can only pick two" as if partitions were optional — partitions happen; the choice is C or A during them.',
    'Confusing isolation levels (SERIALIZABLE) with distributed consistency (linearizability across replicas).',
    'Enabling <code>max_prepared_transactions</code> without monitoring <code>pg_prepared_xacts</code>.',
    'Assuming multi-shard reports reflect one instant in time while writes are ongoing.',
    'Reading from async replicas immediately after a write without a token or fallback.',
    'Setting <code>max_prepared_transactions</code> lower than concurrent 2PC transactions require.'
  ],
  best: [
    'Minimise distributed transactions by design (co-location); make the remaining ones explicit (2PC by the engine, or sagas).',
    'Alert on prepared transactions older than a short threshold.',
    'Offer session guarantees (read-your-writes, monotonic reads) via LSN tokens or sticky primary reads after writes.',
    'Document the PACELC choice per feature (e.g. "profile reads: EL; balances: EC").',
    'For point-in-time-consistent global reports, use a consistent source (warehouse snapshot, PITR restore) rather than concurrent multi-shard queries.'
  ],
  performance: `<p>2PC adds a round trip and an fsync per participant for prepare plus another for commit — typically 2-5 ms within a region, much more across regions — and holds locks for the whole protocol, increasing contention. Consensus-based systems pay a quorum round trip per write (cross-AZ ~1-2 ms; cross-region tens of ms). Read-your-writes via LSN tokens costs nothing on the primary and keeps most reads on replicas. Strong consistency on reads (sync replication with remote_apply, or reading the leader) costs latency and primary capacity.</p>`,
  security: `<p>Prepared transactions survive restarts and can be committed by any superuser or the owner — restrict who can see/finish them, and log 2PC decisions for audit. Inconsistent reads can be a security issue (e.g. permission revocations not yet visible on a replica) — route authorization-critical reads to the primary or require a fresh token.</p>`,
  scenario: { title: 'Customers see "payment pending" right after paying', steps: [
    '1. Flow: payment API commits on the primary; redirect to order page; order page reads from the replica pool.',
    '2. Replica lag at peak is 200-800 ms; the redirect arrives in ~150 ms → stale status shown, users retry payment.',
    '3. Fix option A: after commit, return pg_current_wal_lsn() in a cookie; order page routes to a replica only if pg_last_wal_replay_lsn() >= token, else to the primary.',
    '4. Fix option B: SET LOCAL synchronous_commit = remote_apply for payment transactions (sync standby serves the page) — costs commit latency.',
    '5. Chose A; added idempotency key on the payment API so retries never double-charge.'
  ] },
  widgets: ['diagram:citus', 'diagram:read-replica', 'lab:txn'],
  interview: [
    { q: 'Explain two-phase commit and its main weakness.', a: 'A coordinator asks all participants to prepare (make the transaction durable and vote); if all vote yes it commits everywhere, otherwise rolls back. The weakness is blocking: if the coordinator fails after prepare, participants hold locks in doubt until the decision is recovered; orphaned prepared transactions also block VACUUM.' },
    { q: 'What is the difference between CAP and PACELC?', a: 'CAP only covers behaviour during a network partition: choose consistency or availability. PACELC adds that, else (no partition), a system trades latency against consistency. E.g. async replicas: PA/EL; synchronous quorum systems: PC/EC.' },
    { q: 'How do consistency models differ from isolation levels?', a: 'Isolation levels define how concurrent transactions interleave (anomalies like non-repeatable reads, write skew) on a database; consistency models define what reads may observe across replicas/nodes relative to real time and causality (linearizable, causal, read-your-writes, eventual).' },
    { q: 'How would you give read-your-writes on async replicas?', a: 'Return the commit LSN (pg_current_wal_lsn() after commit) to the client; route its subsequent reads to a replica only if pg_last_wal_replay_lsn() >= token, otherwise to the primary. Alternatively pin the session to the primary for a short time after writes.' }
  ],
  exercises: [
    { task: 'Show the current WAL LSN, then compute whether a hypothetical replica at 0/1000000 could serve a read-your-writes request for that token.', solution: `SELECT pg_current_wal_lsn() AS token,
       '0/1000000'::pg_lsn >= pg_current_wal_lsn() AS replica_ok,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/1000000')) AS replica_behind;`, run: true },
    { task: 'Write the monitoring query that returns prepared transactions older than 60 seconds.', solution: `SELECT gid, prepared, now() - prepared AS age, owner, database
FROM pg_prepared_xacts
WHERE prepared < now() - interval '60 seconds';`, run: true }
  ],
  challenge: { task: 'Model PACELC choices as data: list five components of a system (primary writes, async replica reads, sync standby reads with remote_apply, Citus multi-shard report, CockroachDB table) with their partition and else choices, then count how many favour consistency in normal operation.', hint: 'A VALUES list with columns (component, if_partition, else_choice); count FILTER on else_choice.', solution: `WITH pacelc(component, if_partition, else_choice) AS (
  VALUES ('PostgreSQL primary writes (Patroni)',      'C', 'C'),
         ('Async replica reads',                       'A', 'L'),
         ('Sync standby reads (remote_apply)',         'C', 'C'),
         ('Citus multi-shard report during writes',    'C', 'L'),
         ('CockroachDB/YugabyteDB table (Raft)',       'C', 'C')
)
SELECT component, 'P' || if_partition || '/E' || else_choice AS pacelc
FROM pacelc
UNION ALL
SELECT 'TOTAL favouring consistency in normal operation',
       count(*) FILTER (WHERE else_choice = 'C')::text
FROM pacelc;`, run: true },
  related: ['distributed-postgresql-citus', 'sharding-cross-shard', 'scaling-read-replicas', 'transactions', 'replication-sync-async'],
  quiz: [
    { type: 'mcq', q: 'What happens with default settings when you run PREPARE TRANSACTION?', options: ['It works', 'ERROR: prepared transactions are disabled', 'It commits immediately', 'It creates a savepoint'], answer: 1, explain: 'max_prepared_transactions defaults to 0.' },
    { type: 'tf', q: 'The CAP theorem describes the latency/consistency trade-off during normal operation.', answer: false, explain: 'CAP applies during partitions; PACELC\'s "else" part covers normal operation.' },
    { type: 'scenario', q: 'A coordinator crashed after all participants prepared. What state are participants in?', options: ['Committed', 'Rolled back automatically', 'In doubt, holding locks until COMMIT/ROLLBACK PREPARED', 'Corrupted'], answer: 2, explain: 'Prepared transactions wait for a decision; recovery must consult the coordinator log.' },
    { type: 'mcq', q: 'Which guarantee does an LSN token provide for replica reads?', options: ['Linearizability for all users', 'Read-your-writes for that session', 'Serializable isolation', 'Partition tolerance'], answer: 1, explain: 'It ensures a session reads data at least as new as its own last write.' }
  ]
},
{
  id: 'distributed-postgresql-landscape',
  module: 'distributed-postgresql',
  title: 'The Distributed PostgreSQL Landscape: Citus, YugabyteDB, CockroachDB, Aurora, AlloyDB, Neon',
  level: 6,
  minutes: 30,
  summary: 'A clearly labelled map of "distributed Postgres" options — extensions on real PostgreSQL, PostgreSQL-compatible distributed databases that are not PostgreSQL, and managed services with disaggregated storage — plus a decision guide.',
  objectives: [
    'Classify options: PostgreSQL + extension, PostgreSQL-compatible (different engine), managed/disaggregated-storage PostgreSQL',
    'Explain what scales (reads, writes, storage) in each category',
    'Identify compatibility risks (extensions, isolation defaults, SQL features)',
    'Apply a decision guide based on workload, team and constraints'
  ],
  concept: `<p>"Distributed PostgreSQL" is used for very different things. Classify before comparing:</p>
<h4>1. Real PostgreSQL, distributed by an extension</h4>
<ul><li><strong>Citus</strong> <span class="tag ext">extension</span> — PostgreSQL + extension; sharded tables across PostgreSQL nodes; full PostgreSQL compatibility on each node; scales writes, storage, and parallel queries. Self-hosted or managed (Azure Cosmos DB for PostgreSQL).</li>
<li>Multi-master replication products such as EDB Postgres Distributed (PGD) or pgEdge (Spock) <span class="tag tool">third-party tool</span> replicate between writable PostgreSQL nodes with conflict resolution — geo-distribution and availability, not sharding.</li></ul>
<h4>2. PostgreSQL-compatible distributed databases (not PostgreSQL)</h4>
<ul><li><strong>YugabyteDB</strong> <span class="tag tool">third-party</span> — reuses a fork of the PostgreSQL query layer (YSQL) on top of DocDB, a distributed, Raft-replicated storage layer (tablets). High compatibility with PostgreSQL SQL, but storage, MVCC, and many extensions differ.</li>
<li><strong>CockroachDB</strong> <span class="tag tool">third-party</span> — speaks the PostgreSQL wire protocol and much of its SQL dialect with its own engine (ranges replicated by Raft, hybrid logical clocks); SERIALIZABLE by default. Not PostgreSQL: no PostgreSQL extensions, different performance characteristics and SQL gaps.</li>
<li>Others: Google Spanner's PostgreSQL interface, TiDB (MySQL-compatible, for contrast).</li></ul>
<h4>3. Managed PostgreSQL with disaggregated (cloud-native) storage</h4>
<ul><li><strong>Amazon Aurora PostgreSQL</strong> — PostgreSQL-compatible compute on a distributed storage layer that keeps 6 copies across 3 AZs (write quorum 4/6); up to 15 low-lag replicas share the same storage; fast failover. Still <em>one writer</em> (Aurora Limitless adds sharding as a separate offering).</li>
<li><strong>Google AlloyDB</strong> — PostgreSQL-compatible, disaggregated storage, read pools, a columnar engine for analytics; one primary writer.</li>
<li><strong>Neon</strong> — open-source-based serverless PostgreSQL: separate compute and storage (pageservers + safekeepers for WAL), copy-on-write branching, scale-to-zero; one writer per branch.</li></ul>
<p><strong>Analogy:</strong> category 1 is your own car with a trailer hitch (same engine, more capacity); category 2 is a different car brand with the same pedal layout (drives familiarly, different engine and parts); category 3 is your car model leased with a magic fuel tank shared by many (same engine, storage managed by someone else, still one driver).</p>
<div class="callout warn">"PostgreSQL-compatible" is a spectrum. Always test your actual schema, queries, extensions (PostGIS, pgvector, pg_trgm), isolation behaviour, and operational tools (pg_dump, logical replication, monitoring) against the target.</div>`,
  why: `<p>Vendors use the same words for fundamentally different architectures. An architect must know whether an option scales <em>writes</em> or only reads and storage, whether it is real PostgreSQL (extensions, planner, behaviour) or an emulation, and what operational model it implies. Picking the wrong category leads to migrations that fail late (missing extension, different isolation semantics) or to paying for distributed complexity that the workload never needed.</p>`,
  useCase: `<p>Three evaluations: (1) a fintech needing multi-region active-active writes with strict serializability chose a Raft-based NewSQL database after a 6-week PoC that rewrote 8% of queries; (2) a SaaS on RDS with 4 TB and heavy read load moved to Aurora PostgreSQL for faster failover and 5 replicas with millisecond lag — no sharding needed; (3) a multi-tenant analytics company stayed on real PostgreSQL with Citus to keep pg_partman, PostGIS and pgvector, sharding by tenant.</p>`,
  internals: `<p><strong>What scales</strong>:</p>
<table><tr><th>Option</th><th>Writes</th><th>Reads</th><th>Storage</th><th>Real PostgreSQL?</th></tr>
<tr><td>Single PostgreSQL + replicas</td><td>1 node</td><td>N replicas</td><td>1 node</td><td>yes</td></tr>
<tr><td>Citus</td><td>N workers</td><td>N workers (+replicas)</td><td>N workers</td><td>yes + extension</td></tr>
<tr><td>Aurora / AlloyDB</td><td>1 writer</td><td>many replicas on shared storage</td><td>auto-growing (very large)</td><td>compatible fork</td></tr>
<tr><td>Neon</td><td>1 writer per branch</td><td>read replicas</td><td>separate storage service</td><td>PostgreSQL compute + custom storage</td></tr>
<tr><td>YugabyteDB / CockroachDB</td><td>all nodes (per range leader)</td><td>all nodes</td><td>all nodes</td><td>no (compatible)</td></tr></table>
<p><strong>Consistency</strong>: Raft-based systems replicate each range/tablet to a quorum (usually 3), giving RPO 0 and automatic failover per range, with cross-region write latency equal to quorum RTT. Aurora's storage quorum gives durable writes across AZs with a single writer. Citus inherits each node's PostgreSQL semantics plus 2PC for multi-node writes; multi-shard reads lack a global snapshot.</p>`,
  whenNot: `<ul><li>Don't move to a distributed database to fix slow queries, missing indexes or connection storms — those follow you.</li>
<li>Avoid PostgreSQL-compatible engines if you depend on extensions or exotic PostgreSQL features (custom types, PL languages, logical decoding plugins) unless verified.</li>
<li>Avoid serverless/scale-to-zero for latency-critical always-on OLTP if cold starts matter.</li>
<li>Avoid multi-master replication without a conflict strategy (partitioned write ownership).</li></ul>`,
  syntax: `-- Quick compatibility probes to run on any candidate engine
SELECT version();
SHOW server_version;
SHOW default_transaction_isolation;
SELECT name, default_version FROM pg_available_extensions ORDER BY name;
SELECT count(*) FROM pg_proc;              -- rough catalog completeness signal`,
  examples: [
    { label: 'Basic', title: 'What am I actually connected to?',
      sql: `SELECT version()                                        AS version,
       current_setting('server_version_num')            AS version_num,
       current_setting('default_transaction_isolation') AS default_isolation,
       (SELECT count(*) FROM pg_available_extensions)   AS available_extensions,
       EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'citus') AS citus_available;`,
      explain: `<p>Run this first on any "Postgres" endpoint. The version string reveals forks (Aurora, YugabyteDB and others add identifiers), the default isolation differs (CockroachDB defaults to SERIALIZABLE), and the extension catalog shows what you can actually use. This sandbox is PostgreSQL 18 in WebAssembly (PGlite) — without Citus.</p>`,
      output: ` version                                                   | version_num | default_isolation | available_extensions | citus_available
-----------------------------------------------------------+-------------+-------------------+----------------------+-----------------
 PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten ... | 180003  | read committed    | (bundled set, ~15) | f`, run: true },
    { label: 'Intermediate', title: 'Extension dependency inventory before evaluating alternatives',
      sql: `-- Extensions and features your application relies on (installed in this database)
SELECT e.extname, e.extversion, n.nspname AS schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

-- Feature usage signals that commonly break on "compatible" engines
SELECT 'jsonb columns'      AS feature, count(*) AS uses FROM information_schema.columns WHERE data_type = 'jsonb' AND table_schema = 'public'
UNION ALL
SELECT 'array columns',     count(*) FROM information_schema.columns WHERE data_type = 'ARRAY' AND table_schema = 'public'
UNION ALL
SELECT 'generated columns', count(*) FROM information_schema.columns WHERE is_generated = 'ALWAYS' AND table_schema = 'public'
UNION ALL
SELECT 'GIN indexes',       count(*) FROM pg_indexes WHERE indexdef ILIKE '%USING gin%' AND schemaname = 'public'
UNION ALL
SELECT 'triggers',          count(*) FROM information_schema.triggers WHERE trigger_schema = 'public'
UNION ALL
SELECT 'plpgsql functions', count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                            JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE l.lanname = 'plpgsql' AND n.nspname = 'public';`,
      explain: `<p>Before a PoC, list what the schema uses: extensions, jsonb, arrays, generated <code>tsvector</code> columns (company_db's <code>documents.search</code>), GIN indexes, triggers and PL/pgSQL. Each line is a test case for the candidate engine. Real PostgreSQL + Citus keeps all of them; PostgreSQL-compatible engines support many but not all, often with different performance.</p>`,
      output: ` extname | extversion | schema
---------+------------+------------
 plpgsql | 1.0        | pg_catalog

 feature           | uses
-------------------+------
 jsonb columns     |    4
 array columns     |    1
 generated columns |    1
 GIN indexes       |    1
 triggers          |    0
 plpgsql functions |    0`, run: true },
    { label: 'Advanced', title: 'Weighted decision matrix for a concrete workload',
      sql: `WITH weights(criterion, w) AS (
  VALUES ('write scale-out', 3), ('extension compatibility', 3), ('ops simplicity', 2),
         ('multi-region RPO 0', 1), ('read scale', 2)
),
scores(option, criterion, score) AS (       -- 1 (poor) .. 5 (excellent), for THIS workload
  VALUES ('Single PG + replicas', 'write scale-out', 1), ('Single PG + replicas', 'extension compatibility', 5),
         ('Single PG + replicas', 'ops simplicity', 5),  ('Single PG + replicas', 'multi-region RPO 0', 2),
         ('Single PG + replicas', 'read scale', 4),
         ('Citus',                'write scale-out', 5), ('Citus',                'extension compatibility', 4),
         ('Citus',                'ops simplicity', 3),  ('Citus',                'multi-region RPO 0', 2),
         ('Citus',                'read scale', 4),
         ('Aurora PostgreSQL',    'write scale-out', 2), ('Aurora PostgreSQL',    'extension compatibility', 4),
         ('Aurora PostgreSQL',    'ops simplicity', 5),  ('Aurora PostgreSQL',    'multi-region RPO 0', 3),
         ('Aurora PostgreSQL',    'read scale', 5),
         ('YugabyteDB/CockroachDB','write scale-out', 5), ('YugabyteDB/CockroachDB','extension compatibility', 2),
         ('YugabyteDB/CockroachDB','ops simplicity', 3),  ('YugabyteDB/CockroachDB','multi-region RPO 0', 5),
         ('YugabyteDB/CockroachDB','read scale', 4)
)
SELECT s.option, sum(s.score * w.w) AS weighted_score,
       rank() OVER (ORDER BY sum(s.score * w.w) DESC) AS rank
FROM scores s JOIN weights w USING (criterion)
GROUP BY s.option
ORDER BY weighted_score DESC;`,
      explain: `<p>The scores are illustrative judgements for a hypothetical multi-tenant SaaS that relies on extensions and needs write scale-out — change the weights and the winner changes (raise "multi-region RPO 0" to 4 and lower "extension compatibility" to 1, as in the challenge, and the Raft-based databases jump to first place). The point is to make trade-offs explicit and reviewable instead of choosing by vendor marketing; validate the top two with a PoC on real queries.</p>`,
      output: ` option                 | weighted_score | rank
------------------------+----------------+------
 Citus                  |             43 |    1
 Aurora PostgreSQL      |             41 |    2
 YugabyteDB/CockroachDB |             40 |    3
 Single PG + replicas   |             38 |    4`, run: true }
  ],
  compare: {
    bad: { sql: `-- Decision: "we'll move to a distributed DB, it's Postgres-compatible"
-- discovered in week 10 of migration:
--   pgvector / PostGIS not supported or behave differently
--   default SERIALIZABLE → many retry errors (SQLSTATE 40001) in app code
--   logical decoding plugin for CDC unavailable`, why: 'Compatibility claims were not verified against the actual schema, extensions, isolation semantics and tooling.', run: false },
    good: { sql: `-- Decision process
-- 1. inventory extensions/features (queries above)
-- 2. replay top 200 queries from pg_stat_statements on the candidate
-- 3. run the app test suite + failure drills (node kill, partition)
-- 4. compare cost and latency at target scale; then decide`, why: 'A short, evidence-based PoC exposes incompatibilities and performance surprises before commitment.', run: false }
  },
  mistakes: [
    'Treating "PostgreSQL-compatible" as "PostgreSQL" (extensions, planner, MVCC/vacuum behaviour, locking semantics differ).',
    'Assuming Aurora/AlloyDB/Neon scale writes horizontally — they have a single writer (per cluster/branch).',
    'Choosing a distributed database before fixing indexes, queries and pooling.',
    'Ignoring retry handling for serialization failures in SERIALIZABLE-by-default systems.',
    'Underestimating egress/cross-AZ/cross-region costs of distributed architectures.'
  ],
  best: [
    'Classify each option first: extension on real PostgreSQL, compatible engine, or managed fork with custom storage.',
    'Decide by workload: write scale-out → Citus or NewSQL; read scale/HA/ops simplicity → managed single-writer; geo RPO 0 → Raft-based systems.',
    'Run a PoC with production-like data, top queries and failure drills.',
    'Keep the exit path in mind: pg_dump/logical replication compatibility for migrating back.',
    'Re-evaluate yearly — this space changes fast; verify current feature lists rather than old blog posts.'
  ],
  performance: `<p>Single-node PostgreSQL has the lowest latency per query; Citus adds a hop for routed queries but scales throughput; Raft-based engines add quorum latency to every write (and cross-region quorums make that tens of ms) but scale reads and writes across nodes; Aurora/AlloyDB reduce write I/O amplification by shipping only WAL to storage and offer replicas with very low lag, but the single writer remains the write ceiling. Always benchmark your workload — the differences are workload-specific.</p>`,
  security: `<p>Managed services shift responsibility: understand the shared-responsibility model (patching, encryption, network isolation, IAM integration). Data residency in multi-region systems must be configured explicitly (placement policies, region pinning). Extensions and superuser access are often restricted in managed services — plan for that in security tooling (pgaudit availability, custom roles).</p>`,
  scenario: { title: 'Board asks: "Should we move to a distributed database for growth?"', steps: [
    '1. Facts: 3 TB, 9k TPS peak, primary CPU 50%, growth 60%/year, extensions: PostGIS, pg_trgm, pgvector.',
    '2. Runway on single primary + replicas with tuning: ~2 years at current growth.',
    '3. Options: Aurora (ops, read scale, still one writer), Citus (write scale, keeps extensions), NewSQL (geo, RPO 0, extension gaps).',
    '4. PoC Citus with tenant_id distribution for the 6 largest tables; replay top queries; 92% become router queries.',
    '5. Recommendation: stay on PostgreSQL now, prepare schema (tenant_id in keys), revisit at 70% capacity with Citus as the planned path.'
  ] },
  widgets: ['diagram:citus', 'diagram:prod-cluster'],
  interview: [
    { q: 'Is Aurora PostgreSQL a distributed database?', a: 'Its storage is distributed (6 copies over 3 AZs with quorum writes) and it supports many replicas on shared storage, but there is a single writer instance; it does not shard writes across nodes (Aurora Limitless is a separate sharded offering).' },
    { q: 'How is CockroachDB different from Citus?', a: 'Citus is real PostgreSQL with an extension that shards tables across PostgreSQL nodes. CockroachDB is a separate engine that speaks the PostgreSQL wire protocol and much of its SQL, with Raft-replicated ranges and serializable default isolation; PostgreSQL extensions don\'t run on it.' },
    { q: 'What would you check before migrating to a PostgreSQL-compatible database?', a: 'Extension support, SQL feature coverage (types, functions, PL/pgSQL, triggers), isolation defaults and retry semantics, performance of top queries, tooling (pg_dump, logical replication/CDC, monitoring), failure behaviour, and cost at target scale — via a PoC with real workload.' }
  ],
  exercises: [
    { task: 'List the installed extensions in this database with their versions.', solution: `SELECT extname, extversion FROM pg_extension ORDER BY extname;`, run: true },
    { task: 'Check which of these extensions are available to install here: citus, postgres_fdw, vector, pg_trgm, postgis.', solution: `SELECT n AS extension,
       EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = n) AS available
FROM unnest(ARRAY['citus', 'postgres_fdw', 'vector', 'pg_trgm', 'postgis']) AS n;`, run: true }
  ],
  challenge: { task: 'Modify the decision matrix weights so that "multi-region RPO 0" has weight 4 and "extension compatibility" weight 1, and show the new ranking.', hint: 'Only the weights CTE changes.', solution: `WITH weights(criterion, w) AS (
  VALUES ('write scale-out', 3), ('extension compatibility', 1), ('ops simplicity', 2),
         ('multi-region RPO 0', 4), ('read scale', 2)
),
scores(option, criterion, score) AS (
  VALUES ('Single PG + replicas', 'write scale-out', 1), ('Single PG + replicas', 'extension compatibility', 5),
         ('Single PG + replicas', 'ops simplicity', 5),  ('Single PG + replicas', 'multi-region RPO 0', 2),
         ('Single PG + replicas', 'read scale', 4),
         ('Citus', 'write scale-out', 5), ('Citus', 'extension compatibility', 4),
         ('Citus', 'ops simplicity', 3),  ('Citus', 'multi-region RPO 0', 2), ('Citus', 'read scale', 4),
         ('Aurora PostgreSQL', 'write scale-out', 2), ('Aurora PostgreSQL', 'extension compatibility', 4),
         ('Aurora PostgreSQL', 'ops simplicity', 5),  ('Aurora PostgreSQL', 'multi-region RPO 0', 3),
         ('Aurora PostgreSQL', 'read scale', 5),
         ('YugabyteDB/CockroachDB', 'write scale-out', 5), ('YugabyteDB/CockroachDB', 'extension compatibility', 2),
         ('YugabyteDB/CockroachDB', 'ops simplicity', 3),  ('YugabyteDB/CockroachDB', 'multi-region RPO 0', 5),
         ('YugabyteDB/CockroachDB', 'read scale', 4)
)
SELECT s.option, sum(s.score * w.w) AS weighted_score
FROM scores s JOIN weights w USING (criterion)
GROUP BY s.option
ORDER BY weighted_score DESC;`, run: true },
  related: ['distributed-postgresql-citus', 'distributed-postgresql-transactions', 'scaling-roadmap', 'high-availability'],
  quiz: [
    { type: 'mcq', q: 'Which option is real PostgreSQL with an extension that shards tables?', options: ['CockroachDB', 'YugabyteDB', 'Citus', 'TiDB'], answer: 2, explain: 'Citus is a PostgreSQL extension; the others are separate engines.' },
    { type: 'tf', q: 'Amazon Aurora PostgreSQL scales writes across multiple writer instances in a standard cluster.', answer: false, explain: 'A standard Aurora cluster has one writer; replicas share storage for reads.' },
    { type: 'design', q: 'Requirement: active-active writes in three regions with RPO 0 and automatic per-region failover. Which category fits best?', options: ['Single PostgreSQL + async replicas', 'Raft-based distributed SQL (e.g. YugabyteDB/CockroachDB)', 'Neon branching', 'PgBouncer'], answer: 1, explain: 'Quorum-replicated ranges across regions give RPO 0 and multi-region writes (at write-latency cost).' },
    { type: 'mcq', q: 'What does Neon primarily change compared to vanilla PostgreSQL?', options: ['The SQL dialect', 'Separates compute from a custom storage layer (branching, scale-to-zero)', 'Adds multi-writer sharding', 'Removes MVCC'], answer: 1, explain: 'Neon keeps PostgreSQL compute but replaces local storage with pageservers/safekeepers.' }
  ]
},

/* ======================================================================
   MODULE: scaling (3)
   ====================================================================== */
{
  id: 'scaling-roadmap',
  module: 'scaling',
  title: 'The PostgreSQL Scaling Roadmap: From Query Tuning to Sharding, in Order of Cost',
  level: 6,
  minutes: 30,
  summary: 'A pragmatic, ordered path to scale PostgreSQL — measure, tune queries and indexes, scale vertically, pool connections, cache, add read replicas, partition, archive, split by service, and only then shard — with the signals that tell you to move to the next step.',
  objectives: [
    'Order scaling techniques by cost, risk and payoff',
    'Use pg_stat_statements, table statistics and EXPLAIN to find the cheapest wins',
    'Know when vertical scaling, caching, replicas, partitioning and archiving apply',
    'Recognise the signals that justify sharding',
    'Build a scaling plan with measurable triggers'
  ],
  concept: `<p>Scaling is a ladder. Each rung is more expensive (money, complexity, risk) than the one before; climb only when measurements show the current rung is exhausted.</p>
<ol>
<li><strong>Measure</strong> — <code>pg_stat_statements</code> <span class="tag ext">extension</span> (top queries by total time), <code>pg_stat_user_tables</code> (seq scans, dead tuples), wait events, OS metrics. Most "scaling problems" are 3-5 bad queries.</li>
<li><strong>Query &amp; index tuning</strong> — missing indexes (company_db deliberately lacks <code>orders(customer_id)</code>), N+1 ORM patterns, <code>SELECT *</code>, unbounded OFFSET pagination, bad plans from stale statistics. Payoff: often 10-100×, cost: hours.</li>
<li><strong>Configuration</strong> — <code>shared_buffers</code>, <code>work_mem</code>, <code>effective_cache_size</code>, autovacuum tuning, checkpoints, <code>random_page_cost</code> for SSD.</li>
<li><strong>Connection pooling</strong> — PgBouncer; removes connection overhead and contention.</li>
<li><strong>Vertical scaling</strong> — more cores, RAM (fit the working set), faster NVMe/IOPS. Cloud instances reach 192+ vCPUs and multiple TB of RAM; a resize is a switchover away.</li>
<li><strong>Caching</strong> — application cache or Redis <span class="tag tool">third-party tool</span> for hot, read-heavy, tolerant-to-staleness data (product catalog, sessions, rendered pages); materialized views for expensive aggregates.</li>
<li><strong>Read replicas</strong> — offload reads (reports, search, list pages); handle replica lag.</li>
<li><strong>Partitioning</strong> <span class="tag core">core</span> — for very large tables: pruning, cheaper maintenance, instant archiving with <code>DETACH PARTITION</code>.</li>
<li><strong>Archiving</strong> — move cold data (orders older than 2 years) to cheaper storage/a separate database or object storage; keeps the hot set small.</li>
<li><strong>Vertical/functional split</strong> — move independent domains (audit logs, documents, analytics) to separate databases.</li>
<li><strong>Sharding / distributed PostgreSQL</strong> — when one primary cannot handle the writes or the data even after all of the above.</li>
</ol>
<p><strong>Analogy:</strong> a busy restaurant. First fix the slow recipes (queries), then organise the kitchen (config), add a host to manage the queue (pooler), buy a bigger stove (vertical), prepare popular dishes in advance (cache), open a takeaway counter (read replicas), reorganise the storeroom (partitioning), clear out old stock (archiving), split the bakery into its own shop (functional split) — and only then open a second restaurant (sharding).</p>`,
  why: `<p>Teams under pressure often jump to the most complex solution (sharding, a new database) when the bottleneck is a missing index. The ladder keeps effort proportional to need: early rungs are cheap, reversible and often give the biggest gains; later rungs are expensive and permanent. It also gives management a clear narrative: "we have N months of runway on this rung; here is the trigger for the next".</p>`,
  useCase: `<p>An e-commerce company's checkout p99 rose to 3 s at 2,500 TPS on a 16-vCPU server. Step 2 found that "my orders" did a sequential scan on 40M orders (no <code>orders(customer_id)</code> index) and the product page ran 48 queries (N+1). Fixes cut CPU from 85% to 35%. Step 4 (PgBouncer) removed connection storms during deploys. Step 6 cached the catalog in Redis (95% hit rate). A year later step 7 added two replicas for search and reporting, and step 8 partitioned <code>orders</code> by month with 24 months hot and older months detached to an archive database. Three years in, still one primary — at 6× the original traffic.</p>`,
  internals: `<p><strong>Signals per rung</strong>: high total time in a few statements → tuning; CPU saturated with efficient queries → vertical or replicas (if reads); I/O bound with working set &gt; RAM (cache hit ratio dropping, high <code>blks_read</code>) → RAM, partitioning, archiving; many connections/fork churn → pooling; read share &gt; 80% and lag-tolerant → replicas/caching; WAL generation near disk/network limits, single-table vacuum unable to keep up, or dataset beyond a single node's storage/backup window → partitioning, archiving, then sharding.</p>
<p><strong>Write ceiling of one primary</strong>: one WAL stream (WAL insertion locks, fsync), one checkpointer, single-node I/O. Modern hardware sustains tens of thousands of transactions/s and hundreds of MB/s of WAL — well beyond most applications, but finite.</p>`,
  whenNot: `<ul><li>Don't cache what must be strongly consistent (balances, inventory decrements) without careful invalidation.</li>
<li>Don't add replicas to fix write bottlenecks — every replica replays all writes.</li>
<li>Don't partition small tables (&lt; tens of GB) "for performance" — planning overhead and complexity can make things slower.</li>
<li>Don't skip rungs because a later rung "sounds more scalable".</li></ul>`,
  syntax: `-- Measure (pg_stat_statements is an extension; preload + CREATE EXTENSION)
SELECT queryid, calls, round(total_exec_time) AS total_ms, round(mean_exec_time, 2) AS mean_ms, rows, left(query, 80)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;

-- Tables read by sequential scans
SELECT relname, seq_scan, seq_tup_read, idx_scan FROM pg_stat_user_tables ORDER BY seq_tup_read DESC;

-- Tune (index without blocking writes)
CREATE INDEX CONCURRENTLY idx_orders_customer ON orders (customer_id);`,
  examples: [
    { label: 'Basic', title: 'Rung 2: the missing index that saves you a shard',
      sql: `-- Before: "my orders" page
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, order_date, total_amount FROM orders WHERE customer_id = 42 ORDER BY order_date DESC;

CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date DESC);
ANALYZE orders;

-- After
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, order_date, total_amount FROM orders WHERE customer_id = 42 ORDER BY order_date DESC;`,
      explain: `<p>Before: a sequential scan reads every page of <code>orders</code> (89 buffers here; 40M rows in production = millions of pages) and discards 4,990 of 5,000 rows. After: the index finds the 10 rows touching ~10 buffers. On this tiny table the planner still sorts 10 rows after a bitmap scan (cheaper than an ordered index scan here); on a large table it would use an ordered index scan and skip the sort entirely. At production scale this one index turns a 2-second query into 1 ms and can remove most of a server's load. In production use <code>CREATE INDEX CONCURRENTLY</code> to avoid blocking writes.</p>`,
      output: ` QUERY PLAN (before)
------------------------------------------------------
 Sort (actual rows=10.00 loops=1)
   Sort Key: order_date DESC
   Sort Method: quicksort  Memory: 17kB
   ->  Seq Scan on orders (actual rows=10.00 loops=1)
         Filter: (customer_id = 42)
         Rows Removed by Filter: 4990
         Buffers: shared hit=89

 QUERY PLAN (after)
---------------------------------------------------------------------------------------
 Sort (actual rows=10.00 loops=1)
   Sort Key: order_date DESC
   ->  Bitmap Heap Scan on orders (actual rows=10.00 loops=1)
         Recheck Cond: (customer_id = 42)
         Heap Blocks: exact=8
         Buffers: shared hit=8 read=2
         ->  Bitmap Index Scan on idx_orders_customer_date (actual rows=10.00 loops=1)
               Index Cond: (customer_id = 42)`, run: true },
    { label: 'Intermediate', title: 'Find the biggest tables, their index overhead and cache efficiency',
      sql: `SELECT c.relname,
       c.reltuples::bigint                                   AS est_rows,
       pg_size_pretty(pg_relation_size(c.oid))               AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))                AS indexes,
       pg_size_pretty(pg_total_relation_size(c.oid))         AS total,
       round(pg_relation_size(c.oid) / NULLIF(c.reltuples, 0)) AS bytes_per_row
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 6;

SELECT datname,
       round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct
FROM pg_stat_database
WHERE datname = current_database();`,
      explain: `<p>The largest tables are where partitioning, archiving and storage planning start; bytes per row feeds capacity planning. A cache hit ratio persistently below ~99% on an OLTP system suggests the working set exceeds memory (more RAM, archiving cold data, or better indexes reducing pages read). In this small sandbox the ratio is lower because data was just loaded.</p>`,
      output: ` relname     | est_rows | heap   | indexes | total   | bytes_per_row
-------------+----------+--------+---------+---------+---------------
 order_items |    12500 | 832 kB | 512 kB  | 1368 kB |            68
 orders      |     5000 | 712 kB | 240 kB  | 984 kB  |           146
 payments    |     4585 | 352 kB | 120 kB  | 504 kB  |            79
 ...

 datname  | cache_hit_pct
----------+---------------
 postgres |         92.89
(sandbox just loaded; production OLTP should be > 99)`, run: true },
    { label: 'Advanced', title: 'Rungs 6 and 8: cache an aggregate and partition for archiving',
      sql: `-- Rung 6: precompute an expensive dashboard aggregate (refresh every few minutes)
CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT date_trunc('day', order_date)::date AS day,
       count(*) AS orders, sum(total_amount) AS revenue
FROM orders WHERE status <> 'cancelled'
GROUP BY 1;
CREATE UNIQUE INDEX ON mv_daily_sales (day);    -- enables REFRESH ... CONCURRENTLY
SELECT * FROM mv_daily_sales ORDER BY day DESC LIMIT 3;

-- Rung 8/9: monthly partitions; old months can be detached and archived
CREATE TABLE orders_part (LIKE orders INCLUDING DEFAULTS) PARTITION BY RANGE (order_date);
CREATE TABLE orders_2024 PARTITION OF orders_part FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE orders_2025 PARTITION OF orders_part FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE orders_old  PARTITION OF orders_part FOR VALUES FROM (MINVALUE) TO ('2024-01-01');
INSERT INTO orders_part SELECT * FROM orders;
ALTER TABLE orders_part DETACH PARTITION orders_2024;   -- now an ordinary table: dump/move/drop
SELECT tableoid::regclass AS partition, count(*) FROM orders_part GROUP BY 1 ORDER BY 1;`,
      explain: `<p>A materialized view turns a full scan per dashboard view into a tiny lookup, at the cost of staleness (refresh schedule) — the in-database equivalent of a cache. Range partitioning by month/year makes archiving a metadata operation: <code>DETACH PARTITION</code> (with <code>CONCURRENTLY</code> in production, PG14+) removes a year from the hot table instantly; it can then be dumped to cheap storage or attached to an archive database (e.g. as a postgres_fdw foreign partition).</p>`,
      output: `    day     | orders | revenue
------------+--------+---------------
 2025-10-01 |    ... |           ...
 ... (3 rows)

 partition   | count
-------------+-------
 orders_2025 |  2098
(orders_2024 detached → no longer part of orders_part)`, run: true }
  ],
  compare: {
    bad: { sql: `-- "Database is slow → let's shard"
-- 6 months of engineering, 8 new clusters,
-- the slowest query is still:
SELECT * FROM orders WHERE customer_id = 42;   -- seq scan on every shard`, why: 'Sharding multiplied infrastructure while the actual problem — a missing index — remains on every shard.', run: true },
    good: { sql: `CREATE INDEX idx_orders_customer ON orders (customer_id);
ANALYZE orders;
EXPLAIN (COSTS OFF) SELECT * FROM orders WHERE customer_id = 42;`, why: 'Minutes of work, orders-of-magnitude improvement, zero new infrastructure. Climb the ladder from the bottom.', run: true }
  },
  mistakes: [
    'Skipping measurement and guessing the bottleneck.',
    'Scaling reads with replicas when the bottleneck is writes, or vice versa.',
    'Caching without an invalidation strategy (stale prices, inventory).',
    'Partitioning small tables, or partitioning on a key the queries do not filter on (no pruning).',
    'Never archiving: 10 years of rows in hot tables, with indexes and vacuum paying for all of them.',
    'Sharding as the first response to load.'
  ],
  best: [
    'Install <code>pg_stat_statements</code> everywhere and review the top 10 queries weekly.',
    'Fix queries/indexes first; then config; then pooling; then hardware.',
    'Cache read-heavy, staleness-tolerant data with explicit TTL/invalidation.',
    'Partition tables that are both large and naturally time-ordered; automate partition creation and archiving.',
    'Define triggers (e.g. CPU &gt; 60% at peak, storage &gt; 70%, WAL &gt; X MB/s) for moving to the next rung.'
  ],
  performance: `<p>Typical payoffs: indexing/query fixes 10-1000× for affected queries; config tuning 10-50%; pooling large gains under high connection counts; vertical scaling ~linear until contention; caching removes a share of reads entirely; replicas add read capacity per node but not write capacity; partitioning speeds maintenance and time-range queries, not necessarily point lookups; sharding scales writes linearly for shard-local workloads at large complexity cost.</p>`,
  security: `<p>Every rung adds attack surface: caches may hold sensitive data (encrypt, set TTLs, avoid caching PII), replicas and archives need the same access controls and encryption as the primary, and detached partitions dumped to object storage must be encrypted and access-controlled. Least-privilege roles should be preserved when splitting databases.</p>`,
  scenario: { title: 'Traffic will triple in 6 months — produce a scaling plan', steps: [
    '1. Baseline: 4,000 TPS peak, CPU 58%, 1.8 TB, cache hit 99.2%, WAL 18 MB/s, replicas: none.',
    '2. Rung 2 (2 weeks): top 10 statements from pg_stat_statements → 3 indexes, 2 query rewrites → CPU 38%.',
    '3. Rung 4/5: PgBouncer in transaction mode; instance from 32 to 64 vCPU via switchover.',
    '4. Rung 6/7: Redis for catalog; 2 read replicas for search and reporting with lag-aware routing.',
    '5. Rung 8/9: partition orders/order_items by month; archive data older than 24 months (−45% storage).',
    '6. Projected peak at 3×: CPU ~55% on 64 vCPU; trigger for sharding evaluation set at CPU 65% sustained or storage 6 TB.'
  ] },
  widgets: ['diagram:read-replica', 'diagram:partitioning', 'lab:plan', 'lab:index'],
  interview: [
    { q: 'Your PostgreSQL database is slow under growing load. What do you do, in order?', a: 'Measure (pg_stat_statements, waits, OS), fix top queries and indexes, tune configuration and autovacuum, add connection pooling, scale vertically, cache hot reads, add read replicas for read load, partition and archive large tables, split independent domains, and only then consider sharding or distributed PostgreSQL.' },
    { q: 'When do read replicas not help?', a: 'When the bottleneck is writes (replicas replay all writes), when reads require strict read-your-writes without routing support, or when the problem is a few inefficient queries that are just as slow on a replica.' },
    { q: 'What are signals that you need sharding?', a: 'After tuning, pooling, vertical scaling, replicas, caching, partitioning and archiving: the primary\'s write throughput, WAL volume or storage still exceed a single node, maintenance (vacuum, backups, index builds) no longer fits windows, or tenant isolation requires physical separation.' }
  ],
  exercises: [
    { task: 'Find which company_db tables have no index on a column that looks like a foreign key (column name ending in _id) — candidates for indexing.', solution: `SELECT c.table_name, c.column_name
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.column_name LIKE '%\\_id'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
      AND a.attname = c.column_name)
ORDER BY 1, 2;`, run: true },
    { task: 'Create a materialized view of revenue per customer segment and query it.', solution: `CREATE MATERIALIZED VIEW mv_segment_revenue AS
SELECT c.segment, count(o.id) AS orders, round(sum(o.total_amount), 2) AS revenue
FROM customers c JOIN orders o ON o.customer_id = c.id
GROUP BY c.segment;
SELECT * FROM mv_segment_revenue ORDER BY revenue DESC;`, run: true }
  ],
  challenge: { task: 'Build a "scaling rung recommender": given metrics (cpu_pct, read_share_pct, storage_tb, top10_query_time_share_pct, connections), return the next recommended rung using ordered rules.', hint: 'CASE evaluated top-down; first matching rule wins.', solution: `WITH m(cpu_pct, read_share_pct, storage_tb, top10_share_pct, connections) AS (
  VALUES (78, 85, 2.5, 72, 900)
)
SELECT CASE
         WHEN top10_share_pct >= 50 THEN '2: tune the top queries and indexes'
         WHEN connections > 500     THEN '4: add connection pooling (PgBouncer)'
         WHEN cpu_pct > 70 AND read_share_pct >= 80 THEN '6/7: cache hot reads and add read replicas'
         WHEN cpu_pct > 70          THEN '5: scale vertically'
         WHEN storage_tb > 5        THEN '8/9: partition and archive'
         ELSE 'no action: monitor'
       END AS next_rung
FROM m;`, run: true },
  related: ['scaling-read-replicas', 'scaling-capacity-planning', 'sharding-what-is-sharding', 'query-optimization', 'partitioning'],
  quiz: [
    { type: 'mcq', q: 'Which is usually the cheapest, highest-payoff first step for a slow PostgreSQL system?', options: ['Sharding', 'Query and index tuning based on pg_stat_statements', 'Migrating to a NewSQL database', 'Adding 5 replicas'], answer: 1, explain: 'A handful of inefficient queries usually dominate load.' },
    { type: 'tf', q: 'Adding read replicas increases write throughput.', answer: false, explain: 'Every replica replays all writes; only reads are offloaded.' },
    { type: 'scenario', q: 'CPU 90%, 92% of load is reads of the product catalog that can be 60 s stale. Best next step?', options: ['Shard by product id', 'Cache catalog reads (Redis / materialized view) and/or add read replicas', 'Increase max_connections', 'Disable autovacuum'], answer: 1, explain: 'Staleness-tolerant reads are ideal for caching and replicas.' },
    { type: 'optimize', q: 'A query filters orders by customer_id and sorts by order_date DESC. Best index?', options: ['(order_date)', '(customer_id, order_date DESC)', '(status)', 'GIN on orders'], answer: 1, explain: 'Equality column first, then sort column — no sort step, minimal pages read.' }
  ]
},
{
  id: 'scaling-read-replicas',
  module: 'scaling',
  title: 'Read Scaling with Replicas: Routing, Replica Lag and Read-Your-Writes Consistency',
  level: 6,
  minutes: 30,
  summary: 'How to scale reads with streaming replicas without surprising users: which queries to route, lag-aware load balancing, read-your-writes via LSN tokens or sticky sessions, monotonic reads, and recovery-conflict behaviour of long replica queries.',
  objectives: [
    'Decide which queries can go to replicas and which must stay on the primary',
    'Implement routing: separate pools, proxies, libpq target_session_attrs',
    'Provide read-your-writes and monotonic reads despite asynchronous lag',
    'Measure replica staleness correctly (bytes vs time, idle primary pitfalls)',
    'Handle long-running replica queries vs recovery conflicts'
  ],
  concept: `<p>Read replicas (hot standbys) serve <code>SELECT</code>s from an asynchronously updated copy. Each replica adds read capacity roughly equal to one server. The catch is <strong>replica lag</strong>: a replica shows the database as it was some milliseconds — or minutes — ago.</p>
<p><strong>Analogy:</strong> a newspaper printed every few seconds from the newsroom's whiteboard. Most readers are fine with news a few seconds old. But the reporter who just wrote a correction and immediately reads the paper expects to see it ("read-your-writes"), and a reader must never see tomorrow's edition followed by yesterday's (monotonic reads).</p>
<p><strong>What to route to replicas</strong>: reporting and analytics, search/listing pages, public catalog pages, exports, dashboards, background jobs that tolerate staleness. <strong>Keep on the primary</strong>: reads inside write transactions, reads that decide writes (check-then-act: inventory, balances, uniqueness checks), reads immediately after the user's own write, authorization-critical reads.</p>
<p><strong>Routing mechanisms</strong>: two connection pools/DSNs in the application (writer and reader — most frameworks support this: Rails multiple databases, Django database routers, Spring <code>AbstractRoutingDataSource</code>, EF Core with separate contexts); a proxy (HAProxy port per role, Pgpool-II query routing <span class="tag tool">third-party tool</span>); or libpq <code>target_session_attrs=prefer-standby/standby</code> with <code>load_balance_hosts=random</code> <span class="tag core">core</span>.</p>
<p><strong>Consistency techniques</strong>:</p>
<ul><li><strong>Sticky primary after write</strong> — after a user writes, route that user's reads to the primary for N seconds (simple; uses a cookie/session flag).</li>
<li><strong>LSN token</strong> — return <code>pg_current_wal_lsn()</code> after the write; read from a replica only if <code>pg_last_wal_replay_lsn() &gt;= token</code>; else wait briefly or use the primary. Precise and efficient.</li>
<li><strong>Synchronous apply</strong> — <code>SET LOCAL synchronous_commit = remote_apply</code> for specific writes with a sync standby; reads from that standby see the write. Costs commit latency.</li>
<li><strong>Monotonic reads</strong> — pin a session to one replica, or keep the max LSN seen per session and only use replicas at or beyond it.</li></ul>`,
  why: `<p>Many applications are 80-95% reads. Offloading them to replicas can multiply capacity at low cost and without application redesign — <em>if</em> stale-read bugs are prevented. The classic failure: a user updates their address, the next page loads from a lagging replica showing the old address, the user updates again, support tickets follow. Getting routing and consistency right is what makes read scaling safe.</p>`,
  useCase: `<p>A travel booking site serves 30k reads/s and 1.2k writes/s. Search results and hotel pages (95% of reads) go to 4 replicas behind HAProxy (<code>/replica?lag=8MB</code> health check, leastconn). After a booking, the API returns the commit LSN in a header; the "My trips" page reads from any replica that has replayed it (median wait 0 ms, p99 40 ms) and falls back to the primary after 100 ms. Primary CPU dropped from 85% to 30%. A nightly report replica with <code>max_standby_streaming_delay = 30min</code> runs long queries without affecting the serving replicas.</p>`,
  internals: `<p><strong>Measuring lag</strong>: bytes (<code>pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)</code> on the primary) is precise; time lag from <code>pg_stat_replication.replay_lag</code> reflects recent commits. On the replica, <code>now() - pg_last_xact_replay_timestamp()</code> is popular but misleading when the primary is idle (no new transactions → value grows although the replica is fully caught up). Combine: if <code>pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn()</code>, the replica is caught up regardless of the timestamp.</p>
<p><strong>Recovery conflicts</strong>: replay may need to remove row versions a replica query still sees (after VACUUM on the primary) or to take an exclusive lock (DDL, <code>DROP TABLE</code>, some VACUUM truncations). The replica waits up to <code>max_standby_streaming_delay</code> and then cancels the query ("canceling statement due to conflict with recovery"). Options: <code>hot_standby_feedback = on</code> (fewer cancellations, primary bloat), longer delay on reporting replicas (more lag), or shorter queries. Conflicts are counted in <code>pg_stat_database_conflicts</code> on the replica.</p>
<p><strong>Load balancing</strong>: leastconn usually beats round robin for uneven query costs; exclude replicas above a lag threshold; keep capacity headroom so losing one replica doesn't overload the others.</p>`,
  whenNot: `<ul><li>Write-heavy workloads — replicas don't help, and they consume primary network/WAL sender capacity.</li>
<li>Strongly consistent read-modify-write flows (inventory, balances) — keep on the primary, use row locks.</li>
<li>When a cache would do better: very hot, small, repeated reads (a replica still parses, plans and executes every query).</li></ul>`,
  syntax: `-- Application side (pseudo-config)
writer: postgresql://app@pg-primary:6432/company_db
reader: postgresql://app@pg-r1,pg-r2,pg-r3:6432/company_db?target_session_attrs=standby&load_balance_hosts=random

-- Read-your-writes
-- primary, after commit:  SELECT pg_current_wal_lsn();          → token
-- replica, before read:   SELECT pg_last_wal_replay_lsn() >= :token::pg_lsn;

-- Replica staleness (on replica)
SELECT pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() AS caught_up,
       now() - pg_last_xact_replay_timestamp()               AS since_last_replayed_commit;`,
  examples: [
    { label: 'Basic', title: 'Replica staleness check that is correct even when the primary is idle',
      sql: `SELECT pg_is_in_recovery()                                         AS is_replica,
       pg_last_wal_receive_lsn()                                    AS received,
       pg_last_wal_replay_lsn()                                     AS replayed,
       CASE WHEN NOT pg_is_in_recovery() THEN 'primary: not applicable'
            WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN 'caught up'
            ELSE 'lagging ' || pg_size_pretty(pg_wal_lsn_diff(pg_last_wal_receive_lsn(),
                                                              pg_last_wal_replay_lsn()))
       END AS status,
       now() - pg_last_xact_replay_timestamp()                      AS since_last_replayed_commit;`,
      explain: `<p>On a replica, comparing received vs replayed LSN tells you whether everything that arrived has been applied. The timestamp-based value can show "10 minutes" on a perfectly healthy replica when the primary had no commits for 10 minutes — don't alert on it alone. (For WAL not yet received you still need the primary-side view in <code>pg_stat_replication</code>.) On this sandbox (a primary) the function values are not meaningful.</p>`,
      output: ` is_replica | received | replayed | status                  | since_last_replayed_commit
------------+----------+----------+-------------------------+----------------------------
 f          |          | ...      | primary: not applicable |
(on a healthy replica: t | 3/5A0010F8 | 3/5A0010F8 | caught up | 00:00:00.41)`, run: true },
    { label: 'Intermediate', title: 'A routing table: which reads may go to replicas?',
      sql: `WITH endpoints(endpoint, kind, staleness_ok_ms, follows_own_write) AS (
  VALUES ('GET /products/:id',          'read',  60000, false),
         ('GET /search',                'read',  30000, false),
         ('GET /my/orders (after pay)', 'read',      0, true),
         ('POST /checkout',             'write',     0, false),
         ('GET /admin/report',          'read', 900000, false),
         ('GET /cart (check stock)',    'read',      0, false)
)
SELECT endpoint,
       CASE
         WHEN kind = 'write'                THEN 'primary'
         WHEN follows_own_write             THEN 'replica if replay_lsn >= token, else primary'
         WHEN staleness_ok_ms = 0           THEN 'primary'
         WHEN staleness_ok_ms >= 600000     THEN 'reporting replica (long queries allowed)'
         ELSE 'serving replicas (lag-aware LB)'
       END AS route
FROM endpoints;`,
      explain: `<p>Make routing an explicit, reviewed decision per endpoint rather than "all GETs go to replicas". Stock checks that lead to a purchase need fresh data (primary or row locks); post-write reads use tokens; long reports get a separate replica with a lenient conflict policy so they neither get cancelled nor slow down the serving replicas.</p>`,
      output: ` endpoint                   | route
----------------------------+-----------------------------------------------
 GET /products/:id          | serving replicas (lag-aware LB)
 GET /search                | serving replicas (lag-aware LB)
 GET /my/orders (after pay) | replica if replay_lsn >= token, else primary
 POST /checkout             | primary
 GET /admin/report          | reporting replica (long queries allowed)
 GET /cart (check stock)    | primary`, run: true },
    { label: 'Advanced', title: 'LSN-token read-your-writes with a timeout fallback (router logic in SQL)',
      sql: `-- 1. Write on the primary and capture the token
UPDATE customers SET city = 'Pune' WHERE id = 7;
SELECT pg_current_wal_lsn() AS token \\gset_placeholder

-- 2. Router state: replicas and their last polled replay LSN + current load
CREATE TEMP TABLE replica_state (name text, replay_lsn pg_lsn, active_queries int);
INSERT INTO replica_state VALUES
  ('pg-r1', pg_current_wal_lsn(),        42),
  ('pg-r2', pg_current_wal_lsn() - 4096, 10),     -- 4 kB behind the token
  ('pg-r3', pg_current_wal_lsn(),        17);

-- 3. Choose: least-loaded replica that has replayed the token, else the primary
SELECT COALESCE(
  (SELECT name FROM replica_state
   WHERE replay_lsn >= pg_current_wal_lsn()
   ORDER BY active_queries LIMIT 1),
  'primary') AS read_from;`,
      explain: `<p>pg-r2 is the least loaded but hasn't replayed the user's write, so the router picks pg-r3 (caught up, 17 active queries) over pg-r1 (42). If none qualifies, it either waits a few ms and re-polls or falls back to the primary. Real routers keep replica LSNs fresh by polling <code>pg_last_wal_replay_lsn()</code> every 100-500 ms or by reading <code>pg_stat_replication</code> on the primary. The <code>\\gset_placeholder</code> line marks where a client would store the token (it is not SQL), so this example is not runnable as a whole.</p>`,
      output: ` read_from
-----------
 pg-r3`, run: false }
  ],
  compare: {
    bad: { sql: `-- Framework config: all SELECTs to replicas
-- POST /profile  → UPDATE customers SET city = 'Pune' WHERE id = 7;   (primary)
-- 302 redirect → GET /profile → SELECT city FROM customers WHERE id = 7; (replica, 300 ms behind)
-- user sees the OLD city and edits again`, why: 'Blind read routing breaks read-your-writes and causes duplicate actions and support tickets.', run: false },
    good: { sql: `-- After the write, carry the token; route the next read accordingly
SELECT pg_current_wal_lsn() AS token;          -- on the primary after COMMIT
-- replica check before serving GET /profile:
SELECT pg_last_wal_replay_lsn() >= pg_current_wal_lsn() AS replica_has_my_write;`, why: 'Reads go to a replica only when it provably contains the user\'s write; otherwise the primary serves it. Most reads still go to replicas.', run: true }
  },
  mistakes: [
    'Routing all reads (including check-then-act reads) to replicas.',
    'Alerting on <code>now() - pg_last_xact_replay_timestamp()</code> alone (false alarms on idle primaries).',
    'Running long reports on serving replicas, causing recovery-conflict cancellations or (with feedback) primary bloat.',
    'No health-based removal of lagging replicas from the pool.',
    'Forgetting that replicas need the same indexes and capacity — and replay all writes.',
    'Using a reader DSN that silently falls back to the primary under load and overloads it (no capacity planning for fallback).'
  ],
  best: [
    'Classify endpoints by staleness tolerance; route explicitly.',
    'Use LSN tokens or sticky-primary windows for read-your-writes; pin sessions for monotonic reads.',
    'Health-check replicas with a lag threshold (e.g. Patroni <code>/replica?lag=</code>) and use leastconn balancing.',
    'Separate serving replicas from reporting replicas with different conflict settings.',
    'Monitor <code>pg_stat_database_conflicts</code> on replicas and replication lag on the primary.'
  ],
  performance: `<p>Each replica adds roughly one server of read capacity, minus the CPU/IO spent replaying writes (small for read-heavy systems, significant for write-heavy ones). Replica caches warm independently; route similar queries to the same replicas (e.g. by tenant hash) to improve cache hit ratios. Lag grows with write bursts and long transactions; LSN-token waits are usually zero but can spike — always cap waiting and fall back. Ensure the primary can absorb the fallback load if all replicas lag.</p>`,
  security: `<p>Replicas hold all the primary's data: apply the same network policies, TLS, roles and auditing. Read-only routing is not an authorization boundary — use database roles with only <code>SELECT</code> grants for reporting users. Don't route permission checks to lagging replicas: a revoked permission might still appear granted.</p>`,
  scenario: { title: 'Users intermittently see old data right after saving', steps: [
    '1. Reproduce: save profile → redirect → old value about 1 in 20 times at peak.',
    '2. Measure: replica replay lag p99 = 450 ms at peak; redirect takes ~120 ms.',
    '3. Quick fix: sticky-primary for 2 s after any write by that user (cookie flag) — stale reads disappear; primary read load +4%.',
    '4. Proper fix: return commit LSN token; reader pool chooses a replica with replay_lsn >= token, waits up to 50 ms, else primary.',
    '5. Monitor: share of reads served by replicas (target > 90%) and fallback rate; alert if fallback > 10% (lag problem).'
  ] },
  widgets: ['diagram:read-replica', 'diagram:streaming-replication'],
  interview: [
    { q: 'How do you scale reads in PostgreSQL without breaking consistency?', a: 'Add streaming replicas, route only staleness-tolerant reads to them via separate pools/proxies, keep check-then-act and post-write reads on the primary or use LSN tokens (read from a replica only once pg_last_wal_replay_lsn() >= the write\'s LSN), pin sessions for monotonic reads, and remove lagging replicas from the pool.' },
    { q: 'Why can now() - pg_last_xact_replay_timestamp() be misleading?', a: 'It measures time since the last replayed transaction commit. If the primary has no new commits, the value keeps growing even though the replica is fully caught up. Compare receive and replay LSNs or use primary-side byte lag.' },
    { q: 'What happens to long queries on a replica?', a: 'They may conflict with WAL replay (removed row versions, exclusive locks). Replay waits up to max_standby_streaming_delay, then cancels the query. hot_standby_feedback reduces cancellations at the cost of primary bloat; reporting replicas can use longer delays.' }
  ],
  exercises: [
    { task: 'Show the recovery-conflict related settings relevant to replica queries.', solution: `SELECT name, setting, unit
FROM pg_settings
WHERE name IN ('max_standby_streaming_delay', 'max_standby_archive_delay',
               'hot_standby_feedback', 'hot_standby', 'wal_receiver_status_interval');`, run: true },
    { task: 'Query the recovery conflict counters (meaningful on a replica).', solution: `SELECT datname, confl_tablespace, confl_lock, confl_snapshot, confl_bufferpin, confl_deadlock
FROM pg_stat_database_conflicts
WHERE datname = current_database();`, run: true }
  ],
  challenge: { task: 'Implement "monotonic reads": given a session\'s highest LSN seen so far and the replicas\' replay LSNs, select the replicas the session may use (replay ≥ max seen), preferring the one it used last if eligible.', hint: 'Order by (name = last_used) DESC, then by load.', solution: `WITH session_state(max_seen, last_used) AS (
  VALUES (pg_current_wal_lsn() - 1000, 'pg-r2')
), replicas(name, replay_lsn, load) AS (
  VALUES ('pg-r1', pg_current_wal_lsn(),        30),
         ('pg-r2', pg_current_wal_lsn() - 500,  12),
         ('pg-r3', pg_current_wal_lsn() - 5000,  5)
)
SELECT r.name, r.replay_lsn >= s.max_seen AS eligible
FROM replicas r CROSS JOIN session_state s
WHERE r.replay_lsn >= s.max_seen
ORDER BY (r.name = s.last_used) DESC, r.load
LIMIT 1;`, run: true },
  related: ['scaling-roadmap', 'replication-streaming', 'distributed-postgresql-transactions', 'failover-split-brain'],
  quiz: [
    { type: 'mcq', q: 'Which read must stay on the primary (or use row locks)?', options: ['Product description page', 'Search results', 'Checking stock before decrementing it', 'Monthly report'], answer: 2, explain: 'Check-then-act decisions on stale data cause overselling.' },
    { type: 'tf', q: 'If now() - pg_last_xact_replay_timestamp() is 5 minutes, the replica is necessarily 5 minutes behind.', answer: false, explain: 'With an idle primary there is nothing to replay; compare LSNs instead.' },
    { type: 'predict', q: 'Replica replay LSN 0/5000000, user token 0/5000100. Where should the user\'s next read go?', code: `SELECT '0/5000000'::pg_lsn >= '0/5000100'::pg_lsn;`, options: ['That replica', 'Another replica that has replayed the token, or the primary', 'Nowhere — fail', 'The replica after VACUUM'], answer: 1, explain: 'The comparison is false: this replica hasn\'t applied the write yet.' },
    { type: 'scenario', q: 'Reports on a serving replica get "canceling statement due to conflict with recovery". Best structural fix?', options: ['Disable WAL', 'Separate reporting replica with larger max_standby_streaming_delay (and/or hot_standby_feedback)', 'Run reports on the primary during peak', 'Increase work_mem'], answer: 1, explain: 'Isolate long queries on a replica tuned for them.' }
  ]
},
{
  id: 'scaling-capacity-planning',
  module: 'scaling',
  title: 'Capacity Planning: Growth Estimation, Storage, IOPS and Connection Budgets — a Worked Example',
  level: 6,
  minutes: 35,
  summary: 'Turn business forecasts into PostgreSQL resources: bytes per row from real tables, compound growth projections, index/bloat/WAL/backup overheads, IOPS and throughput, memory working set and connection budgets — with a complete worked example in runnable SQL.',
  objectives: [
    'Measure real bytes per row and per business event from company_db',
    'Project storage with compound growth, indexes, bloat, WAL and backups',
    'Estimate write IOPS/throughput and WAL rate from transaction volume',
    'Size memory for the working set and connections for peak concurrency',
    'Set capacity triggers and review cadence'
  ],
  concept: `<p><strong>Capacity planning</strong> answers: <em>when will we run out of what, and what do we buy before then?</em> Resources to plan: <strong>storage</strong> (data + indexes + bloat + WAL + temp + backups), <strong>IOPS/throughput</strong>, <strong>memory</strong> (working set in shared_buffers + OS cache), <strong>CPU</strong>, <strong>connections</strong>, and <strong>network</strong> (replication, backups).</p>
<p><strong>Analogy:</strong> planning a warehouse. Count how much shelf space one order uses (bytes per order), how many orders arrive per month and how fast that grows (compound growth), add aisles and packing space (indexes, bloat), trucks per hour at the loading dock (IOPS), staff on shift (connections), and leave room for the holiday peak.</p>
<p>The method:</p>
<ol>
<li><strong>Unit cost</strong>: bytes per business event (one order = 1 orders row + ~2.5 order_items + ~0.9 payments + indexes), measured from real tables (<code>pg_relation_size / reltuples</code>, <code>pg_indexes_size</code>).</li>
<li><strong>Volume forecast</strong>: events per month now, growth rate (e.g. 6% month over month = ~2× per year), seasonal peak factor (e.g. 3× in festive season).</li>
<li><strong>Overheads</strong>: bloat/fillfactor (15-30%), future indexes (+20%), TOAST, WAL retained (<code>max_wal_size</code>, slots), temp files, free-space headroom (keep disks &lt; 70-80%).</li>
<li><strong>Retention</strong>: hot retention (e.g. 24 months), archive policy — storage stops growing linearly once archiving kicks in.</li>
<li><strong>Throughput</strong>: peak TPS = average × peak factor; each transaction's WAL bytes and page writes → WAL MB/s, IOPS (checkpoint and background writes, index updates), replication bandwidth.</li>
<li><strong>Concurrency</strong>: Little's law for connections; CPU cores from per-transaction CPU time.</li>
<li><strong>Triggers</strong>: thresholds (storage 70%, CPU 60% at peak, cache hit &lt; 99%) that start procurement/scaling before limits.</li>
</ol>`,
  why: `<p>Running out of disk stops PostgreSQL (WAL can't be written); running out of IOPS makes latency explode non-linearly; running out of connections returns errors to users. All are predictable from numbers you already have. Planning 6-18 months ahead turns emergencies into routine changes (a volume resize, an instance switchover) and gives finance a budget with a rationale.</p>`,
  useCase: `<p>An Indian D2C brand processing ~2 million orders/month expects 6% monthly growth and a 3× festive peak. Using company_db's measured ~600 bytes per order (with items, payments and indexes) plus 25% bloat/headroom, they project ~1.2 KB per order including WAL/temp overheads and index growth; with 24-month hot retention and archiving, hot storage stabilises around 70-80 GB of order data — far below the 2 TB volume — but WAL volume at festive peak (~800 orders/s) and backup windows become the drivers. Result: keep the current instance, enable <code>wal_compression</code>, move backups to incremental, and revisit at 60% CPU.</p>`,
  internals: `<p><strong>Where bytes go</strong>: heap tuples have a 23-byte header (+ alignment) and a 4-byte line pointer; pages are 8 kB with ~24 bytes of header; <code>fillfactor</code> &lt; 100 leaves space for HOT updates; indexes typically add 30-100% of heap size for OLTP tables; dead tuples between vacuums (bloat) add 10-50% depending on update patterns. WAL per transaction ≈ changed tuple data + index entries + full-page images after each checkpoint (the first modification of each page after a checkpoint writes the whole 8 kB page unless <code>wal_compression</code> shrinks it) — so WAL volume depends heavily on <code>checkpoint_timeout</code>/<code>max_wal_size</code>.</p>
<p><strong>IOPS</strong>: reads hit storage only on cache misses (working set vs RAM); writes reach storage via WAL fsync (sequential, small) and checkpoints/background writer (random 8 kB pages). Cloud volumes cap both IOPS and MB/s (e.g. gp3 baseline 3,000 IOPS / 125 MB/s, provisionable higher) — check both.</p>
<p><strong>Memory</strong>: hot working set = frequently accessed tables/index pages (often recent months). Aim for it to fit in shared_buffers + OS cache; <code>pg_buffercache</code> <span class="tag ext">extension</span> shows what is cached.</p>`,
  whenNot: `<ul><li>Don't plan from averages only — peaks (sales, month-end, batch windows) set the requirement.</li>
<li>Don't extrapolate linear growth for a product growing exponentially, or vice versa — fit the actual curve.</li>
<li>Don't count only table sizes — indexes, WAL, bloat, temp and backups often double the footprint.</li></ul>`,
  syntax: `-- unit costs
SELECT pg_relation_size('orders') / NULLIF(reltuples, 0) FROM pg_class WHERE relname = 'orders';
SELECT pg_size_pretty(pg_total_relation_size('orders'));
-- compound growth: volume_m = volume_0 × (1 + g)^m
SELECT m, round(2000000 * power(1.06, m)) FROM generate_series(0, 24) m;
-- Little's law for connections: busy = TPS × avg_txn_seconds`,
  examples: [
    { label: 'Basic', title: 'Step 1 — bytes per order, measured from company_db',
      sql: `WITH t AS (
  SELECT relname,
         pg_total_relation_size(oid) AS total_bytes,     -- heap + indexes + TOAST
         reltuples
  FROM pg_class
  WHERE relname IN ('orders', 'order_items', 'payments') AND relkind = 'r'
)
SELECT relname,
       reltuples::bigint                                   AS rows,
       round(reltuples::numeric / 5000, 2)                 AS rows_per_order,
       round(total_bytes / NULLIF(reltuples, 0))           AS bytes_per_row_incl_indexes,
       round(total_bytes / 5000.0)                         AS bytes_per_order
FROM t
UNION ALL
SELECT 'TOTAL per order', NULL, NULL, NULL, round(sum(total_bytes) / 5000.0) FROM t;`,
      explain: `<p>One business event ("an order") touches several tables: 1 order row, ~2.5 items, ~0.92 payments, each with its index entries. Measuring from real tables captures actual row widths, alignment and index overhead — ~585 bytes per order here. Repeat this on production (sizes after vacuum) because real rows (longer text, jsonb) are often larger than test data.</p>`,
      output: ` relname         | rows  | rows_per_order | bytes_per_row_incl_indexes | bytes_per_order
-----------------+-------+----------------+----------------------------+-----------------
 orders          |  5000 |           1.00 |                        202 |             202
 order_items     | 12500 |           2.50 |                        112 |             280
 payments        |  4585 |           0.92 |                        113 |             103
 TOTAL per order |       |                |                            |             585`, run: true },
    { label: 'Intermediate', title: 'Step 2 — 24-month storage projection with growth, overheads and archiving',
      sql: `WITH params AS (
  SELECT 2000000::numeric AS orders_per_month_now,   -- business forecast input
         0.06              AS monthly_growth,         -- 6% MoM ≈ 2x per year
         585               AS bytes_per_order,        -- measured above
         1.25              AS bloat_factor,           -- dead tuples, fillfactor
         1.20              AS future_index_factor,    -- indexes we'll add
         24                AS hot_retention_months    -- older months archived
), months AS (
  SELECT m,
         round(p.orders_per_month_now * power(1 + p.monthly_growth, m)) AS orders_in_month
  FROM params p, generate_series(1, 24) AS m
), cumulative AS (
  SELECT m, orders_in_month,
         sum(orders_in_month) OVER (ORDER BY m ROWS BETWEEN 23 PRECEDING AND CURRENT ROW) AS hot_orders
  FROM months
)
SELECT m AS month,
       orders_in_month,
       hot_orders,
       pg_size_pretty((hot_orders * p.bytes_per_order * p.bloat_factor * p.future_index_factor)::bigint) AS hot_storage
FROM cumulative, params p
WHERE m IN (1, 6, 12, 18, 24)
ORDER BY m;`,
      explain: `<p>Compound growth (<code>power(1.06, m)</code>) doubles monthly volume in a year. The rolling 24-month window models retention: data older than 24 months is archived, so hot storage tracks the sum of the last 24 months rather than all history. Multiply by bloat and future-index factors. Then add WAL (<code>max_wal_size</code> + slot retention headroom), temp space, and keep the volume under ~70% utilisation.</p>`,
      output: ` month | orders_in_month | hot_orders | hot_storage
-------+-----------------+------------+-------------
     1 |         2120000 |    2120000 | 1774 MB
     6 |         2837038 |   14787675 | 12 GB
    12 |         4024393 |   35764275 | 29 GB
    18 |         5708678 |   65519983 | 54 GB
    24 |         8097869 |  107729023 | 88 GB`, run: true },
    { label: 'Advanced', title: 'Step 3 — peak throughput: TPS, WAL rate, IOPS and connections',
      sql: `WITH inputs AS (
  SELECT 8097869::numeric AS orders_month_24,   -- from the projection
         3.0  AS festive_peak_factor,
         6.0  AS db_txns_per_order,             -- create order, items, payment, status updates
         4.0  AS reads_per_write_txn,           -- page views/APIs per write txn
         2500 AS wal_bytes_per_write_txn,       -- measure: pg_stat_wal / txns (incl. FPIs)
         6.0  AS avg_write_txn_ms,
         1.5  AS avg_read_txn_ms
), rates AS (
  SELECT *,
         orders_month_24 / (30 * 24 * 3600.0)                         AS avg_orders_per_s,
         orders_month_24 / (30 * 24 * 3600.0) * festive_peak_factor * 4 AS peak_orders_per_s -- daily curve: peak hour ≈ 4x avg
  FROM inputs
)
SELECT round(peak_orders_per_s, 1)                                               AS peak_orders_s,
       round(peak_orders_per_s * db_txns_per_order)                               AS peak_write_tps,
       round(peak_orders_per_s * db_txns_per_order * reads_per_write_txn)         AS peak_read_tps,
       pg_size_pretty((peak_orders_per_s * db_txns_per_order * wal_bytes_per_write_txn)::bigint) || '/s' AS peak_wal_rate,
       ceil(peak_orders_per_s * db_txns_per_order * avg_write_txn_ms / 1000
          + peak_orders_per_s * db_txns_per_order * reads_per_write_txn * avg_read_txn_ms / 1000) AS busy_connections_littles_law,
       ceil(2 * (peak_orders_per_s * db_txns_per_order * avg_write_txn_ms / 1000
          + peak_orders_per_s * db_txns_per_order * reads_per_write_txn * avg_read_txn_ms / 1000)) AS pool_size_with_2x_headroom
FROM rates;`,
      explain: `<p>Month-24 volume averages ~3 orders/s, but sizing must target the festive peak hour (×3 season × ~4 daily peak ≈ 37 orders/s → ~225 write TPS and ~900 read TPS). WAL ≈ 550 kB/s — trivial for one primary and for replication bandwidth. Little's law gives ~3 busy connections — the database needs very little concurrency, so a small PgBouncer pool suffices. Conclusion for this business: one well-tuned primary with replicas has years of headroom; sharding is not on the horizon. Replace the assumed WAL bytes per transaction with your measured value (e.g. <code>pg_stat_wal.wal_bytes</code> delta / transactions).</p>`,
      output: ` peak_orders_s | peak_write_tps | peak_read_tps | peak_wal_rate | busy_connections_littles_law | pool_size_with_2x_headroom
---------------+----------------+---------------+---------------+------------------------------+----------------------------
          37.5 |            225 |           900 |   549 kB/s    |                            3 |                          6`, run: true }
  ],
  compare: {
    bad: { sql: `-- "Plan": current table size × 2
SELECT pg_size_pretty(pg_total_relation_size('orders') * 2) AS next_year_orders_size;`, why: 'Ignores the other tables per event, compound growth, bloat, new indexes, WAL, retention and peaks — and the real limit may be IOPS or connections, not size.', run: true },
    good: { sql: `-- Unit cost × forecast × overheads, per resource, at peak
SELECT round(585 * 1.25 * 1.20)                        AS planned_bytes_per_order,
       pg_size_pretty((585 * 1.25 * 1.20 * 35764275)::bigint) AS hot_storage_month_12;`, why: 'A transparent model with measured unit costs and explicit assumptions, re-validated against actuals every quarter.', run: true }
  },
  mistakes: [
    'Sizing from averages instead of peak hour of peak season.',
    'Counting heap size only (forgetting indexes, TOAST, bloat, WAL, temp, backups).',
    'Ignoring IOPS/throughput caps of cloud volumes until latency spikes.',
    'Linear extrapolation of exponential growth (or the reverse).',
    'No retention/archiving assumptions — projecting unbounded growth that never happens, or forgetting it does.',
    'Never comparing forecasts with actuals.'
  ],
  best: [
    'Measure unit costs from production (bytes per event, WAL per transaction, CPU ms per transaction).',
    'Model compound growth, seasonality and retention explicitly; keep the model in version control.',
    'Plan every resource: storage, IOPS/MB/s, memory working set, CPU, connections, network, backup windows.',
    'Keep disks below 70-80% and CPU below ~60% at peak; define triggers and lead times (procurement, migrations).',
    'Review quarterly; update the model with actuals.'
  ],
  performance: `<p>Capacity limits are rarely hit gracefully: latency rises sharply as CPU approaches saturation or as volumes hit IOPS caps (queueing), and a full disk stops the database. Headroom is therefore a performance requirement. Measured per-transaction resource costs (CPU ms, WAL bytes, buffers read) — from <code>pg_stat_statements</code> and <code>pg_stat_wal</code> — make projections accurate and also show the payoff of optimisations (halving WAL per transaction halves replication and archiving bandwidth).</p>`,
  security: `<p>Capacity models contain business-sensitive forecasts; share appropriately. Plan capacity for security features too: TLS CPU overhead, audit logging (pgaudit log volume can rival WAL), encryption of backups, longer retention for compliance (archive storage), and extra replicas/regions for residency requirements.</p>`,
  scenario: { title: 'Finance asks for next year\'s database budget in one week', steps: [
    '1. Measure unit costs: bytes/order (585 B incl. indexes), WAL per write transaction (pg_stat_wal delta), CPU ms per transaction (pg_stat_statements total_exec_time / calls).',
    '2. Get forecasts from business: orders/month now, growth curve, festive multiplier, new features (e.g. returns module +15% writes).',
    '3. Project per resource at peak: storage (with overheads, retention), IOPS/MB/s, WAL rate, CPU cores at 60% target, connections (Little\'s law).',
    '4. Compare with current capacity: storage OK for 30 months; CPU hits 60% at month 14 at festive peak → plan a vertical upgrade in month 12 (switchover), plus one more read replica.',
    '5. Deliver: a table of resources × quarters with costs, triggers, and the assumptions list; schedule quarterly re-validation.'
  ] },
  widgets: ['diagram:storage-page', 'diagram:prod-cluster', 'lab:partition'],
  interview: [
    { q: 'How do you estimate storage for a database a year from now?', a: 'Measure bytes per business event across all affected tables including indexes, multiply by forecast event volume with compound growth over the retention window, add bloat, future indexes, TOAST, WAL, temp and backup space, and keep utilisation below ~70-80%. Validate with actual growth monthly.' },
    { q: 'Which resources besides storage do you plan for?', a: 'IOPS and throughput (volume caps), memory for the working set, CPU at peak, connections (Little\'s law), network for replication and backups, WAL rate, and maintenance windows (vacuum, backups, index builds).' },
    { q: 'Why plan for peak rather than average?', a: 'Systems fail at peaks: queueing latency rises non-linearly near saturation. Seasonal and daily peaks can be 5-15× the monthly average rate, so average-based sizing can be off by an order of magnitude.' }
  ],
  exercises: [
    { task: 'Compute the monthly order volume after 12 and 24 months if today it is 500,000/month growing 4% per month.', solution: `SELECT m AS months_from_now, round(500000 * power(1.04, m)) AS orders_per_month
FROM unnest(ARRAY[0, 12, 24]) AS m;`, run: true },
    { task: 'Measure bytes per row (heap only, and heap + indexes) for customers and products.', solution: `SELECT relname,
       round(pg_relation_size(oid) / NULLIF(reltuples, 0))       AS heap_bytes_per_row,
       round(pg_total_relation_size(oid) / NULLIF(reltuples, 0)) AS total_bytes_per_row
FROM pg_class
WHERE relname IN ('customers', 'products') AND relkind = 'r';`, run: true }
  ],
  challenge: { task: 'A 2 TB volume currently holds 900 GB growing 3.5% per month (compound). Find the first month when usage exceeds the 70% threshold and when it would hit 100%.', hint: 'generate_series over months, 900 * 1.035^m, compare against 1400 and 2000 GB, take min(m).', solution: `WITH proj AS (
  SELECT m, 900 * power(1.035, m) AS used_gb
  FROM generate_series(0, 60) AS m
)
SELECT min(m) FILTER (WHERE used_gb > 0.70 * 2000) AS month_exceeds_70pct,
       min(m) FILTER (WHERE used_gb > 2000)        AS month_full,
       round(max(used_gb) FILTER (WHERE m = 12))   AS used_gb_at_month_12
FROM proj;`, run: true },
  related: ['scaling-roadmap', 'connection-pooling-sizing', 'high-availability-prod-architecture', 'partitioning'],
  quiz: [
    { type: 'mcq', q: 'Volume grows 6% per month. Approximately how much larger is monthly volume after 12 months?', options: ['1.06×', '1.72×', '2.01×', '12×'], answer: 2, explain: '1.06^12 ≈ 2.01.' },
    { type: 'tf', q: 'Planning storage from heap table sizes alone is sufficient.', answer: false, explain: 'Indexes, bloat, TOAST, WAL, temp files and backups add substantially.' },
    { type: 'predict', q: 'Peak 400 TPS, average transaction 10 ms. Busy connections by Little\'s law?', code: `SELECT 400 * 0.010;`, options: ['0.4', '4', '40', '400'], answer: 1, explain: 'L = λW = 400 × 0.01 = 4.' },
    { type: 'scenario', q: 'Storage is fine but p99 latency explodes every day at 19:00 when writes peak; volume metrics show IOPS at the provisioned cap. Fix?', options: ['Add disk space', 'Provision more IOPS/throughput (or faster storage), and reduce write amplification (checkpoint tuning, wal_compression)', 'Increase max_connections', 'Add a read replica'], answer: 1, explain: 'The limit is IOPS, not capacity.' }
  ]
}
]);
