/* =====================================================================
   data.js — course structure: levels, the 57 course sections (modules),
   learning paths and helpers that lesson files use to register content.
   Lesson content itself lives in js/content/lessons-*.js.
   ===================================================================== */
window.PGM = window.PGM || {};

PGM.LEVELS = [
  { id: 1, key: 'beginner',     name: 'Beginner',                 color: '#22c55e', blurb: 'What PostgreSQL is, tables, types and your first queries.' },
  { id: 2, key: 'intermediate', name: 'Intermediate',             color: '#38bdf8', blurb: 'Joins, aggregation, CTEs, window functions, transactions, indexes.' },
  { id: 3, key: 'advanced',     name: 'Advanced',                 color: '#a78bfa', blurb: 'Query optimization, PL/pgSQL, triggers, JSONB, full-text search.' },
  { id: 4, key: 'engineer',     name: 'Database Engineer',        color: '#f59e0b', blurb: 'MVCC, locks, vacuum, WAL, backup, security, monitoring.' },
  { id: 5, key: 'architect',    name: 'Database Architect',       color: '#f97316', blurb: 'Replication, HA, pooling, internals, production tuning.' },
  { id: 6, key: 'distributed',  name: 'Production / Distributed', color: '#ef4444', blurb: 'Sharding, distributed PostgreSQL, scaling, production architecture.' },
  { id: 7, key: 'ai',           name: 'AI + Vector Databases',    color: '#ec4899', blurb: 'Embeddings, pgvector, HNSW/IVFFlat, RAG and hybrid search.' }
];

/* id, title, default level, icon (short glyph), one-line description */
PGM.MODULES = [
  ['fundamentals',            'PostgreSQL Fundamentals',      1, 'Database, RDBMS, architecture, installation, psql and tools'],
  ['sql-fundamentals',        'SQL Fundamentals',             1, 'SQL language categories, statements and your first queries'],
  ['database-design',         'Database Design',              1, 'Keys, relationships, normalization, naming and modelling'],
  ['data-types',              'Data Types',                   1, 'Numeric, text, date/time, UUID, network, geometric, JSON, ranges'],
  ['crud',                    'CRUD Operations',              1, 'INSERT, UPDATE, DELETE, RETURNING and UPSERT'],
  ['querying',                'Querying',                     1, 'Filtering, sorting, pagination, CASE, COALESCE and casting'],
  ['joins',                   'Joins',                        2, 'INNER, OUTER, CROSS, SELF, LATERAL joins and join algorithms'],
  ['aggregations',            'Aggregations',                 2, 'GROUP BY, HAVING, FILTER and aggregate functions'],
  ['subqueries',              'Subqueries',                   2, 'Scalar, correlated, EXISTS, IN, ANY and ALL'],
  ['ctes',                    'CTEs',                         2, 'WITH queries, multiple CTEs and WITH RECURSIVE hierarchies'],
  ['window-functions',        'Window Functions',             2, 'Ranking, LAG/LEAD, running totals and frames'],
  ['transactions',            'Transactions',                 2, 'BEGIN, COMMIT, ROLLBACK, SAVEPOINT and ACID'],
  ['constraints',             'Constraints',                  2, 'PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, EXCLUDE, deferrable'],
  ['indexes',                 'Indexes',                      2, 'B-tree, composite, partial, expression and covering indexes'],
  ['advanced-indexing',       'Advanced Indexing',            3, 'GIN, GiST, SP-GiST, BRIN, Hash, Bloom, bloat and maintenance'],
  ['query-optimization',      'Query Optimization',           3, 'Planner, statistics, scan types, join strategies, rewrites'],
  ['functions',               'PostgreSQL Functions',         3, 'SQL and PL/pgSQL functions, control flow, exceptions'],
  ['procedures',              'Procedures',                   3, 'CREATE PROCEDURE, CALL and transaction control'],
  ['triggers',                'Triggers',                     3, 'BEFORE/AFTER/INSTEAD OF, row and statement triggers, auditing'],
  ['views',                   'Views',                        2, 'Views, updatable views and security barriers'],
  ['materialized-views',      'Materialized Views',           3, 'Precomputed results and concurrent refresh'],
  ['extensions',              'PostgreSQL Extensions',        3, 'CREATE EXTENSION, pg_stat_statements, pgcrypto, citext, pg_trgm'],
  ['jsonb',                   'JSON / JSONB',                 3, 'Operators, JSON path, updates and GIN indexing'],
  ['arrays',                  'Arrays',                       3, 'Array types, operators, UNNEST and GIN indexes'],
  ['full-text-search',        'Full Text Search',             3, 'tsvector, tsquery, ranking and search indexes'],
  ['partitioning',            'Partitioning',                 4, 'Range, list, hash partitioning and pruning'],
  ['concurrency',             'Concurrency',                  4, 'Concurrent writers, row locking, SKIP LOCKED queues'],
  ['mvcc',                    'MVCC',                         4, 'Tuple versions, xmin/xmax, snapshots and visibility'],
  ['locks',                   'Locks',                        4, 'Table and row lock modes, deadlocks, advisory locks'],
  ['isolation-levels',        'Isolation Levels',             4, 'READ COMMITTED, REPEATABLE READ, SERIALIZABLE and anomalies'],
  ['transaction-internals',   'Transactions Internals',       4, 'XIDs, commit log, subtransactions, 2PC'],
  ['vacuum',                  'Vacuum',                       4, 'Dead tuples, autovacuum, bloat and wraparound'],
  ['wal',                     'WAL',                          4, 'Write-ahead log, checkpoints, archiving and durability'],
  ['backup-restore',          'Backup & Restore',             4, 'pg_dump, pg_restore, COPY, base backups and PITR'],
  ['replication',             'Replication',                  5, 'Streaming and logical replication, slots, sync vs async'],
  ['high-availability',       'High Availability',            5, 'Patroni, HAProxy, leader election and routing'],
  ['failover',                'Failover',                     5, 'Failover, switchover, split brain and recovery'],
  ['sharding',                'Sharding',                     6, 'Shard keys, hash/range/directory sharding, rebalancing'],
  ['distributed-postgresql',  'Distributed PostgreSQL',       6, 'Citus, coordinators, workers, distributed transactions, CAP'],
  ['pgvector',                'pgvector',                     7, 'The vector extension: types, operators, HNSW and IVFFlat'],
  ['vector-search',           'Vector Search',                7, 'Embeddings, similarity metrics, filtering and tuning recall'],
  ['ai-rag',                  'AI / RAG with PostgreSQL',     7, 'Ingestion, chunking, hybrid search and RAG architecture'],
  ['security',                'Security',                     4, 'Authentication, pg_hba.conf, SCRAM, TLS and hardening'],
  ['roles-permissions',       'Roles & Permissions',          4, 'Roles, GRANT/REVOKE, default privileges, least privilege'],
  ['row-level-security',      'Row Level Security',           4, 'Policies, USING/WITH CHECK and multi-tenancy'],
  ['monitoring',              'Monitoring',                   4, 'pg_stat_activity, pg_stat_statements, locks, sizes, cache'],
  ['query-analysis',          'Query Analysis',               4, 'Finding slow queries and diagnosing them systematically'],
  ['explain',                 'EXPLAIN / EXPLAIN ANALYZE',    3, 'Reading plans: cost, rows, loops, buffers and timing'],
  ['production-optimization', 'Production Optimization',      5, 'Memory, IO, WAL, checkpoint and autovacuum tuning'],
  ['internals',               'PostgreSQL Internals',         5, 'Processes, memory, pages, tuples, TOAST, LSN'],
  ['system-catalogs',         'System Catalogs',              4, 'pg_catalog, information_schema and statistics views'],
  ['configuration',           'Configuration',                4, 'postgresql.conf, SHOW/SET, ALTER SYSTEM, reload vs restart'],
  ['connection-pooling',      'Connection Pooling',           5, 'PgBouncer modes, pool sizing and max_connections'],
  ['scaling',                 'Scaling PostgreSQL',           6, 'Vertical, read scaling, partitioning, caching and sharding'],
  ['production-architecture', 'Production Architecture',      6, 'Migrations, multi-tenancy, production schema design, clusters'],
  ['interview-prep',          'Interview Preparation',        5, 'How to answer SQL, PostgreSQL and design interviews'],
  ['real-world-projects',     'Real-World Projects',          5, 'End-to-end database projects from requirements to tuning']
].map(function (m, i) {
  return { id: m[0], title: m[1], level: m[2], desc: m[3], num: i + 1 };
});

PGM.MODULE_BY_ID = {};
PGM.MODULES.forEach(function (m) { PGM.MODULE_BY_ID[m.id] = m; });

/* Recommended learning paths (module ids in order). */
PGM.PATHS = [
  { id: 'backend', name: 'Backend Developer', icon: '⌘', desc: 'Write correct, fast SQL for application code.',
    modules: ['sql-fundamentals', 'querying', 'joins', 'aggregations', 'transactions', 'indexes', 'functions', 'jsonb', 'connection-pooling', 'query-optimization'] },
  { id: 'data', name: 'Data Engineer', icon: '⇄', desc: 'Model, transform and report on large datasets.',
    modules: ['sql-fundamentals', 'aggregations', 'ctes', 'window-functions', 'jsonb', 'partitioning', 'backup-restore', 'query-optimization', 'production-optimization'] },
  { id: 'dbe', name: 'Database Engineer', icon: '⚙', desc: 'Run PostgreSQL reliably in production.',
    modules: ['sql-fundamentals', 'internals', 'mvcc', 'wal', 'vacuum', 'replication', 'backup-restore', 'monitoring', 'high-availability'] },
  { id: 'architect', name: 'Database Architect', icon: '▦', desc: 'Design systems that scale and survive failure.',
    modules: ['database-design', 'scaling', 'partitioning', 'replication', 'sharding', 'distributed-postgresql', 'production-architecture'] },
  { id: 'ai', name: 'AI Engineer', icon: '✦', desc: 'Build semantic search and RAG on PostgreSQL.',
    modules: ['sql-fundamentals', 'jsonb', 'full-text-search', 'pgvector', 'vector-search', 'ai-rag'] }
];

/* ---------- registration helpers used by content files ---------- */
PGM.LESSONS = PGM.LESSONS || [];
PGM.addLessons = function (list) { Array.prototype.push.apply(PGM.LESSONS, list); };
