/* =====================================================================
   projects-2.js — More real-world database projects + system design
   PGM.PROJECTS       : +5 projects (chat, analytics, saas, dms, rag)
   PGM.SYSTEM_DESIGN  : 10 database design interview problems
   Each project's ddl + sampleData + indexes + queries is executed by the
   validator in its own schema (named after the project id) on PostgreSQL 18.
   ===================================================================== */

PGM.PROJECTS = PGM.PROJECTS || [];

/* ------------------------------------------------------------------ 8. CHAT */
PGM.PROJECTS.push({
  id: 'chat',
  title: 'Chat Application Database',
  icon: '💬',
  level: 3,
  summary: 'WhatsApp/Slack-style messaging: 1:1 and group conversations, per-member read cursors, unread counts, reactions, replies, edits and keyset-paginated history.',
  requirements: [
    'Users can start a 1:1 (direct) conversation; there must be at most ONE direct conversation per pair of users, even if both click "message" at the same moment.',
    'Group conversations have members with roles (owner, admin, member); members can leave and rejoin.',
    'Messages are ordered per conversation; history is loaded newest-first in pages of 50 (infinite scroll), and must stay fast with 100M+ messages.',
    'Each member has a read cursor; the inbox shows every conversation with its last message and the unread count, sorted by latest activity.',
    'Messages support replies (threads-lite), emoji reactions (one per user per emoji), edits and soft deletes ("This message was deleted").',
    'Users can full-text search the conversations they belong to — never conversations they are not a member of.'
  ],
  entities: [
    { name: 'users', desc: 'Accounts: handle, display name, last_seen_at for presence.' },
    { name: 'conversations', desc: 'A direct or group chat; caches last_message_id/last_message_at for the inbox.' },
    { name: 'conversation_members', desc: 'Membership + role + per-member read cursor (last_read_message_id) and mute flag.' },
    { name: 'messages', desc: 'Append-mostly message log: body, reply_to, edited_at, deleted_at, generated tsvector.' },
    { name: 'message_reactions', desc: 'One row per (message, user, emoji).' },
    { name: 'attachments', desc: 'Metadata for files/images stored in object storage (only the key lives in the DB).' }
  ],
  relationships: [
    { from: 'conversation_members', to: 'conversations', type: 'N:1', label: 'member of' },
    { from: 'conversation_members', to: 'users', type: 'N:1', label: 'is' },
    { from: 'messages', to: 'conversations', type: 'N:1', label: 'posted in' },
    { from: 'messages', to: 'users', type: 'N:1', label: 'sent by' },
    { from: 'messages', to: 'messages', type: 'N:1', label: 'replies to' },
    { from: 'message_reactions', to: 'messages', type: 'N:1', label: 'reacts to' },
    { from: 'attachments', to: 'messages', type: 'N:1', label: 'attached to' }
  ],
  ddl: `CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handle        text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_.]{3,30}$'),
  display_name  text NOT NULL,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('direct','group')),
  title            text,                       -- groups only
  -- For direct chats: 'smallerUserId:largerUserId'. UNIQUE => exactly one DM per pair.
  -- NULL for groups (NULLs never collide in a UNIQUE constraint).
  direct_key       text UNIQUE,
  created_by       bigint NOT NULL REFERENCES users(id),
  last_message_id  bigint,                     -- denormalised for the inbox
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CHECK (kind = 'group' OR title IS NULL)
);

CREATE TABLE conversation_members (
  conversation_id       bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id               bigint NOT NULL REFERENCES users(id),
  role                  text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  last_read_message_id  bigint NOT NULL DEFAULT 0,  -- read cursor: everything <= this id is read
  muted                 boolean NOT NULL DEFAULT false,
  joined_at             timestamptz NOT NULL DEFAULT now(),
  left_at               timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- monotonic => natural order
  conversation_id  bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        bigint NOT NULL REFERENCES users(id),
  body             text   NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  reply_to_id      bigint REFERENCES messages(id),
  client_msg_id    uuid   NOT NULL,       -- generated on the phone; dedupes retries
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  search           tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
  UNIQUE (sender_id, client_msg_id)
);

CREATE TABLE message_reactions (
  message_id  bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id),
  emoji       text   NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE attachments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id   bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  storage_key  text   NOT NULL,           -- e.g. s3 object key; bytes never go in the DB
  mime_type    text   NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600)
);`,
  sampleData: `INSERT INTO users (handle, display_name, last_seen_at) VALUES
 ('ananya',  'Ananya Rao',     '2025-06-01 10:05+05:30'),
 ('vikram',  'Vikram Singh',   '2025-06-01 10:02+05:30'),
 ('zoya',    'Zoya Khan',      '2025-06-01 09:40+05:30'),
 ('dev.ops', 'Dev Malhotra',   '2025-05-31 22:10+05:30'),
 ('neha_j',  'Neha Joshi',     '2025-06-01 08:15+05:30');

-- 1: DM ananya-vikram, 2: group "Platform Team", 3: DM zoya-ananya
INSERT INTO conversations (kind, title, direct_key, created_by, created_at) VALUES
 ('direct', NULL,            '1:2', 1, '2025-05-30 09:00+05:30'),
 ('group',  'Platform Team', NULL,  4, '2025-05-30 09:30+05:30'),
 ('direct', NULL,            '1:3', 3, '2025-05-31 18:00+05:30');

INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES
 (1, 1, 'member', '2025-05-30 09:00+05:30'), (1, 2, 'member', '2025-05-30 09:00+05:30'),
 (2, 4, 'owner',  '2025-05-30 09:30+05:30'), (2, 1, 'admin',  '2025-05-30 09:30+05:30'),
 (2, 2, 'member', '2025-05-30 09:31+05:30'), (2, 5, 'member', '2025-05-30 09:31+05:30'),
 (3, 3, 'member', '2025-05-31 18:00+05:30'), (3, 1, 'member', '2025-05-31 18:00+05:30');

INSERT INTO messages (conversation_id, sender_id, body, reply_to_id, client_msg_id, created_at) VALUES
 (1, 1, 'Hey Vikram, are we still on for the design review?', NULL, gen_random_uuid(), '2025-05-30 09:01+05:30'),
 (1, 2, 'Yes! 4 pm in the large meeting room.',               NULL, gen_random_uuid(), '2025-05-30 09:03+05:30'),
 (2, 4, 'Deploy of the payments service is scheduled for tonight.', NULL, gen_random_uuid(), '2025-05-31 17:00+05:30'),
 (2, 1, 'Has the database migration been tested on staging?',  3,  gen_random_uuid(), '2025-05-31 17:05+05:30'),
 (2, 4, 'Yes, migration ran in 42 seconds on staging.',        4,  gen_random_uuid(), '2025-05-31 17:07+05:30'),
 (2, 5, 'I will watch the replication lag dashboard.',         NULL, gen_random_uuid(), '2025-05-31 17:10+05:30'),
 (3, 3, 'Ananya, can you share the postgres tuning notes?',    NULL, gen_random_uuid(), '2025-05-31 18:01+05:30'),
 (1, 1, 'Thanks, see you at 4!',                                NULL, gen_random_uuid(), '2025-05-31 19:00+05:30'),
 (2, 2, 'Deploy finished, all green. Migration took 51 seconds.', NULL, gen_random_uuid(), '2025-05-31 23:30+05:30'),
 (2, 4, 'Great work everyone 🎉',                               9,  gen_random_uuid(), '2025-05-31 23:32+05:30'),
 (3, 3, 'Also the pgbouncer config please.',                   NULL, gen_random_uuid(), '2025-06-01 09:35+05:30'),
 (2, 5, 'Post-deploy error rate is back to baseline.',         NULL, gen_random_uuid(), '2025-06-01 09:50+05:30');

UPDATE messages SET body = 'Deploy finished, all green. Migration took 51 s.', edited_at = '2025-05-31 23:31+05:30' WHERE id = 9;

-- inbox cache: last message per conversation
UPDATE conversations c
SET last_message_id = m.id, last_message_at = m.created_at
FROM (SELECT DISTINCT ON (conversation_id) conversation_id, id, created_at
      FROM messages ORDER BY conversation_id, id DESC) m
WHERE m.conversation_id = c.id;

-- read cursors: ananya read DM 1 fully, group up to msg 6, DM 3 up to 0 (nothing)
UPDATE conversation_members SET last_read_message_id = 8  WHERE conversation_id = 1 AND user_id = 1;
UPDATE conversation_members SET last_read_message_id = 2  WHERE conversation_id = 1 AND user_id = 2;
UPDATE conversation_members SET last_read_message_id = 6  WHERE conversation_id = 2 AND user_id = 1;
UPDATE conversation_members SET last_read_message_id = 12 WHERE conversation_id = 2 AND user_id IN (4, 5);
UPDATE conversation_members SET last_read_message_id = 9  WHERE conversation_id = 2 AND user_id = 2;
UPDATE conversation_members SET last_read_message_id = 11 WHERE conversation_id = 3 AND user_id = 3;

INSERT INTO message_reactions (message_id, user_id, emoji) VALUES
 (9, 1, '🎉'), (9, 4, '🎉'), (9, 5, '🎉'), (9, 5, '👍'), (5, 1, '👍'), (2, 1, '👍');

INSERT INTO attachments (message_id, storage_key, mime_type, size_bytes) VALUES
 (11, 'chat/3/2025/06/01/pgbouncer.ini', 'text/plain', 2148),
 (5,  'chat/2/2025/05/31/migration-log.png', 'image/png', 348112);`,
  indexes: `-- THE chat index: history of one conversation newest-first, keyset paginated.
-- Serves WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 50 as a pure index range scan.
CREATE INDEX idx_messages_conv_id ON messages (conversation_id, id DESC);

-- Inbox: "my conversations" is driven from the member side.
CREATE INDEX idx_members_user ON conversation_members (user_id) WHERE left_at IS NULL;

-- Inbox ordering by activity (joined to members).
CREATE INDEX idx_conversations_activity ON conversations (last_message_at DESC);

-- Full-text search over messages (GIN on the generated tsvector).
CREATE INDEX idx_messages_search ON messages USING gin (search);

-- FK helpers: replies to a message, attachments of a message, a user's sent messages.
CREATE INDEX idx_messages_reply_to  ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX idx_attachments_msg    ON attachments (message_id);
CREATE INDEX idx_messages_sender    ON messages (sender_id, created_at);`,
  queries: [
    {
      title: 'Inbox for a user: last message + unread count, newest activity first',
      sql: `SELECT c.id AS conversation_id,
       COALESCE(c.title, other.display_name) AS chat_name,
       lm.body AS last_message,
       c.last_message_at,
       unread.n AS unread
FROM conversation_members me
JOIN conversations c ON c.id = me.conversation_id
JOIN messages lm     ON lm.id = c.last_message_id
LEFT JOIN LATERAL (                       -- the other person in a DM
  SELECT u.display_name
  FROM conversation_members om JOIN users u ON u.id = om.user_id
  WHERE om.conversation_id = c.id AND om.user_id <> me.user_id AND c.kind = 'direct'
  LIMIT 1
) other ON true
CROSS JOIN LATERAL (                      -- unread = messages after my cursor, not mine
  SELECT COUNT(*) AS n
  FROM messages m
  WHERE m.conversation_id = c.id
    AND m.id > me.last_read_message_id
    AND m.sender_id <> me.user_id
    AND m.deleted_at IS NULL
) unread
WHERE me.user_id = 1 AND me.left_at IS NULL
ORDER BY c.last_message_at DESC;`,
      explain: 'The read cursor turns "unread count" into a cheap range count: messages whose id is greater than last_read_message_id in that conversation, read from idx_messages_conv_id. No per-message "read" rows are needed (that design explodes to members x messages rows in big groups). LATERAL lets each inbox row run its own small correlated subquery. In production the unread count is usually capped (e.g. COUNT over a LIMIT 100 subquery, shown as "99+").'
    },
    {
      title: 'Keyset pagination of history (load older messages)',
      sql: `-- First page: newest 5 messages of the group. Next page: pass the smallest id seen.
SELECT m.id, u.display_name AS sender,
       CASE WHEN m.deleted_at IS NOT NULL THEN 'This message was deleted' ELSE m.body END AS body,
       m.edited_at IS NOT NULL AS edited,
       m.reply_to_id,
       m.created_at
FROM messages m
JOIN users u ON u.id = m.sender_id
WHERE m.conversation_id = 2
  AND m.id < 12            -- cursor from the previous page (use a huge number for page 1)
ORDER BY m.id DESC
LIMIT 5;`,
      explain: 'Keyset ("seek") pagination: the "id below the cursor" predicate jumps straight to the right place in the (conversation_id, id DESC) index, so page 2,000 costs the same as page 1. OFFSET 100000 would read and discard 100,000 rows. Using the monotonic identity id instead of created_at gives a unique, gap-tolerant cursor without tie-breakers.'
    },
    {
      title: 'Find or create the DM between two users (race-free upsert)',
      sql: `WITH pair AS (
  SELECT LEAST(2, 3)::text || ':' || GREATEST(2, 3)::text AS k
), ins AS (
  INSERT INTO conversations (kind, direct_key, created_by)
  SELECT 'direct', k, 2 FROM pair
  ON CONFLICT (direct_key) DO NOTHING
  RETURNING id
), conv AS (
  SELECT id FROM ins
  UNION ALL
  SELECT c.id FROM conversations c, pair WHERE c.direct_key = pair.k
  LIMIT 1
), mem AS (
  INSERT INTO conversation_members (conversation_id, user_id)
  SELECT conv.id, u FROM conv, unnest(ARRAY[2, 3]) AS u
  ON CONFLICT DO NOTHING
)
SELECT id AS conversation_id FROM conv;`,
      explain: 'Normalising the pair as LEAST:GREATEST makes (2,3) and (3,2) the same key, and the UNIQUE constraint on direct_key turns a check-then-insert race into a safe ON CONFLICT. If two phones create the DM at the same instant, one INSERT wins and the other gets nothing back, then the UNION ALL branch finds the winner. Note: a data-modifying CTE cannot see rows inserted by a sibling CTE in the same statement, which is why the members insert uses the ids returned through conv.'
    },
    {
      title: 'Reactions summary per message (jsonb_object_agg)',
      sql: `SELECT m.id, left(m.body, 40) AS message,
       jsonb_object_agg(r.emoji, r.cnt) AS reactions
FROM messages m
JOIN (SELECT message_id, emoji, COUNT(*) AS cnt
      FROM message_reactions GROUP BY message_id, emoji) r
  ON r.message_id = m.id
WHERE m.conversation_id = 2
GROUP BY m.id, m.body
ORDER BY m.id;`,
      explain: 'Aggregating first (per message, emoji) and then folding into one JSON object per message gives the exact payload the client renders: {"🎉": 3, "👍": 1}. Note that jsonb stores object keys in its own canonical order (shorter keys first, then bytewise) and keeps only the last value for duplicate keys, so the client must not rely on insertion order; use json_object_agg (text-based json) if order must be preserved.'
    },
    {
      title: 'Search only within conversations the user belongs to',
      sql: `SELECT m.id, c.id AS conversation_id, COALESCE(c.title, 'Direct chat') AS chat,
       ts_headline('simple', m.body, q, 'StartSel=[, StopSel=]') AS snippet,
       ts_rank(m.search, q) AS rank
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
JOIN conversation_members me ON me.conversation_id = m.conversation_id
                            AND me.user_id = 1 AND me.left_at IS NULL,
     to_tsquery('simple', 'migration | deploy') AS q
WHERE m.search @@ q
  AND m.deleted_at IS NULL
ORDER BY rank DESC, m.id DESC
LIMIT 20;`,
      explain: 'The membership join is the authorisation rule — search must never leak messages from chats the user is not in. The simple text search configuration avoids language-specific stemming, which suits chat (mixed languages, slang). The GIN index finds candidate messages; ts_headline builds the highlighted snippet only for the final 20 rows.'
    }
  ],
  transactions: `-- Send a message: idempotent (client_msg_id), updates the inbox cache atomically.
CREATE OR REPLACE FUNCTION send_message(p_conv bigint, p_sender bigint, p_body text,
                                        p_client_id uuid, p_reply_to bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_at timestamptz;
BEGIN
  -- 1. Authorisation: sender must be an active member.
  PERFORM 1 FROM conversation_members
  WHERE conversation_id = p_conv AND user_id = p_sender AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not a member' USING ERRCODE = '42501'; END IF;

  -- 2. Insert; a retry from a flaky mobile network hits the UNIQUE and returns the original.
  INSERT INTO messages (conversation_id, sender_id, body, reply_to_id, client_msg_id)
  VALUES (p_conv, p_sender, p_body, p_reply_to, p_client_id)
  ON CONFLICT (sender_id, client_msg_id) DO NOTHING
  RETURNING id, created_at INTO v_id, v_at;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM messages WHERE sender_id = p_sender AND client_msg_id = p_client_id;
    RETURN v_id;
  END IF;

  -- 3. Inbox cache. GREATEST guards against out-of-order commits of concurrent senders.
  UPDATE conversations
  SET last_message_id = GREATEST(COALESCE(last_message_id, 0), v_id),
      last_message_at = GREATEST(COALESCE(last_message_at, v_at), v_at)
  WHERE id = p_conv;

  -- 4. The sender has obviously read everything up to their own message.
  UPDATE conversation_members SET last_read_message_id = GREATEST(last_read_message_id, v_id)
  WHERE conversation_id = p_conv AND user_id = p_sender;

  -- 5. Wake up websocket gateways (they LISTEN on this channel) — delivered on COMMIT only.
  PERFORM pg_notify('chat_' || p_conv, v_id::text);
  RETURN v_id;
END $$;

BEGIN;
SELECT send_message(2, 1, 'Rollback plan is in the runbook.', 'f3a1c2d4-5b6e-4f70-8a91-b2c3d4e5f607');
COMMIT;

-- Mark as read: cursor only moves forward, even if two devices race.
UPDATE conversation_members
SET last_read_message_id = GREATEST(last_read_message_id, 12)
WHERE conversation_id = 2 AND user_id = 1;`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Hot conversation row</strong>: in a 10,000-member channel every message UPDATEs <code>conversations.last_message_id</code>, serialising senders on one row lock and creating dead tuples. Mitigations: only update when the new id is larger (<code>WHERE last_message_id &lt; v_id</code>), batch the cache update every ~100 ms, or keep the inbox cache in Redis.</li>
<li><strong>Unread counts</strong> for users in hundreds of groups: cap them (count over <code>LIMIT 100</code>) and cache per (user, conversation); recompute on read-cursor change.</li>
<li><strong>Read receipts</strong> ("seen by 14"): derive from cursors (<code>COUNT(*) WHERE last_read_message_id &gt;= msg_id</code>), never insert one row per reader per message.</li>
</ul>
<h4>Partitioning <span class="tag core">core</span></h4>
<p>Two common options for <code>messages</code>: <strong>hash by conversation_id</strong> (every history query hits one partition; good for even spread) or <strong>range by id/created_at</strong> (old months become cold and can be detached/archived; history queries for recent pages touch 1-2 partitions). Large chat systems often do range-by-time inside each shard. Remember the PK must include the partition key.</p>
<h4>At 100x scale</h4>
<ul>
<li>Shard by <code>conversation_id</code>: all messages of one chat live together, so history, unread counts and search for a chat stay single-shard. The inbox (fan-in across a user's chats) is served from a per-user inbox table/cache that is updated asynchronously.</li>
<li>Use time-sortable globally unique ids (Snowflake or <code>uuidv7()</code>, core in PostgreSQL 18) instead of a per-database identity so ids stay ordered across shards.</li>
<li>Real-time delivery belongs in a websocket gateway + message bus; <code>LISTEN/NOTIFY</code> is fine for one node but its payloads go through a single shared queue and do not scale to millions of connections.</li>
</ul>`,
  advanced: `<h4>Why a read cursor instead of per-message receipts</h4>
<p>A 500-member group with 2,000 messages/day would generate 1M receipt rows per day. A cursor is one integer per member that only moves forward (<code>GREATEST</code>), so marking-as-read is a single-row UPDATE and unread counts become index range counts.</p>
<h4>Edits and deletes</h4>
<ul>
<li>Soft delete (<code>deleted_at</code>) keeps reply chains intact; the API renders a tombstone. Purge bodies after N days for privacy (set <code>body</code> to a placeholder) while keeping ids.</li>
<li>For edit history, insert the previous body into <code>message_edits(message_id, body, edited_at)</code> in the same transaction.</li>
</ul>
<h4>End-to-end encryption</h4>
<p>With E2EE (Signal protocol) the server stores only ciphertext: <code>body</code> becomes <code>bytea</code>, server-side full-text search becomes impossible (search moves to the device), and the DB is purely a store-and-forward queue.</p>
<div class="callout warn">Do not order history by <code>created_at</code> alone: two messages in the same millisecond tie and pagination skips or repeats rows. Use the unique, monotonic id (or <code>(created_at, id)</code>) as the cursor.</div>`
});

/* ------------------------------------------------------------------ 9. ANALYTICS STAR SCHEMA */
PGM.PROJECTS.push({
  id: 'analytics',
  title: 'Analytics Data Warehouse (Star Schema)',
  icon: '📊',
  level: 4,
  summary: 'Kimball-style retail star schema: a sales fact table with date, store, product and slowly-changing (SCD Type 2) customer dimensions, plus ROLLUP/CUBE reporting, YoY growth and materialized aggregates.',
  requirements: [
    'Business users slice revenue, margin and units by day/month/quarter/fiscal year, store, region, product category and customer segment.',
    'Indian fiscal year (April to March) must be reportable alongside the calendar year without date arithmetic in every query.',
    'When a customer changes city or segment, historical sales must still be reported under the attributes valid AT THE TIME of the sale (SCD Type 2).',
    'Dashboards need subtotals and grand totals (ROLLUP/CUBE), running totals, moving averages and year-over-year growth.',
    'Fact table grows by millions of rows per day; nightly ETL loads must be atomic and reports must not read half-loaded data.',
    'Frequently used aggregates (monthly revenue by category/region) must answer in milliseconds.'
  ],
  entities: [
    { name: 'dim_date', desc: 'One row per calendar day with pre-computed year, quarter, month, week, weekday, weekend and fiscal-year attributes. Smart integer key YYYYMMDD.' },
    { name: 'dim_store', desc: 'Stores/channels with city, region and format (online, mall, high-street).' },
    { name: 'dim_product', desc: 'Products with brand, category, sub-category, list price and unit cost.' },
    { name: 'dim_customer', desc: 'SCD Type 2 dimension: one row per VERSION of a customer (surrogate customer_key, natural customer_id, valid_from/valid_to, is_current).' },
    { name: 'fact_sales', desc: 'Grain: one row per order line. Measures: quantity, gross, discount, net and cost amounts. Only foreign keys + measures.' }
  ],
  relationships: [
    { from: 'fact_sales', to: 'dim_date', type: 'N:1', label: 'sold on' },
    { from: 'fact_sales', to: 'dim_store', type: 'N:1', label: 'sold at' },
    { from: 'fact_sales', to: 'dim_product', type: 'N:1', label: 'sold item' },
    { from: 'fact_sales', to: 'dim_customer', type: 'N:1', label: 'bought by (version at sale time)' }
  ],
  ddl: `CREATE TABLE dim_date (
  date_key     int PRIMARY KEY,               -- 20250131: readable, sortable, partition-friendly
  full_date    date NOT NULL UNIQUE,
  year         smallint NOT NULL,
  quarter      smallint NOT NULL,
  month        smallint NOT NULL,
  month_name   text NOT NULL,
  iso_week     smallint NOT NULL,
  day_of_week  smallint NOT NULL,             -- ISO: 1 = Monday .. 7 = Sunday
  day_name     text NOT NULL,
  is_weekend   boolean NOT NULL,
  fiscal_year  text NOT NULL                  -- Indian FY: Apr 2024 - Mar 2025 = 'FY2024-25'
);

CREATE TABLE dim_store (
  store_key  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_code text NOT NULL UNIQUE,
  name       text NOT NULL,
  city       text NOT NULL,
  region     text NOT NULL CHECK (region IN ('North','South','East','West','Online')),
  format     text NOT NULL CHECK (format IN ('online','mall','high_street'))
);

CREATE TABLE dim_product (
  product_key   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku           text NOT NULL UNIQUE,
  name          text NOT NULL,
  brand         text NOT NULL,
  category      text NOT NULL,
  sub_category  text NOT NULL,
  list_price    numeric(10,2) NOT NULL,
  unit_cost     numeric(10,2) NOT NULL
);

-- SCD Type 2: history is preserved by adding a new row per change.
CREATE TABLE dim_customer (
  customer_key  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- surrogate (what facts reference)
  customer_id   int  NOT NULL,                                 -- natural/business key from OLTP
  name          text NOT NULL,
  city          text NOT NULL,
  segment       text NOT NULL CHECK (segment IN ('consumer','smb','enterprise')),
  valid_from    date NOT NULL,
  valid_to      date NOT NULL DEFAULT '9999-12-31',            -- exclusive upper bound
  is_current    boolean NOT NULL DEFAULT true,
  CHECK (valid_from < valid_to)
);
-- at most one current version per customer
CREATE UNIQUE INDEX uq_dim_customer_current ON dim_customer (customer_id) WHERE is_current;

CREATE TABLE fact_sales (
  sale_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date_key         int    NOT NULL REFERENCES dim_date(date_key),
  store_key        int    NOT NULL REFERENCES dim_store(store_key),
  product_key      int    NOT NULL REFERENCES dim_product(product_key),
  customer_key     int    NOT NULL REFERENCES dim_customer(customer_key),
  order_no         text   NOT NULL,                       -- degenerate dimension
  quantity         int    NOT NULL CHECK (quantity > 0),
  gross_amount     numeric(12,2) NOT NULL,
  discount_amount  numeric(12,2) NOT NULL DEFAULT 0,
  net_amount       numeric(12,2) NOT NULL,
  cost_amount      numeric(12,2) NOT NULL,
  CHECK (net_amount = gross_amount - discount_amount)
);`,
  sampleData: `-- Date dimension: two full years generated, never typed by hand.
INSERT INTO dim_date
SELECT to_char(d, 'YYYYMMDD')::int,
       d,
       extract(year FROM d)::smallint,
       extract(quarter FROM d)::smallint,
       extract(month FROM d)::smallint,
       to_char(d, 'Mon'),
       extract(week FROM d)::smallint,
       extract(isodow FROM d)::smallint,
       to_char(d, 'Dy'),
       extract(isodow FROM d) IN (6, 7),
       CASE WHEN extract(month FROM d) >= 4
            THEN 'FY' || extract(year FROM d) || '-' || lpad(((extract(year FROM d)::int + 1) % 100)::text, 2, '0')
            ELSE 'FY' || (extract(year FROM d)::int - 1) || '-' || lpad((extract(year FROM d)::int % 100)::text, 2, '0')
       END
FROM generate_series(DATE '2024-01-01', DATE '2025-12-31', INTERVAL '1 day') AS g(ts),
     LATERAL (SELECT g.ts::date AS d) x;

INSERT INTO dim_store (store_code, name, city, region, format) VALUES
 ('DEL-01', 'Select Citywalk',  'New Delhi', 'North',  'mall'),
 ('MUM-01', 'Linking Road',     'Mumbai',    'West',   'high_street'),
 ('BLR-01', 'Phoenix Marketcity','Bengaluru','South',  'mall'),
 ('WEB-01', 'Online Store',     'Gurugram',  'Online', 'online');

INSERT INTO dim_product (sku, name, brand, category, sub_category, list_price, unit_cost) VALUES
 ('LAP-001', 'UltraBook 14',        'Zenix',  'Electronics', 'Laptops',     72000, 61000),
 ('PHN-001', 'Pixelate 9',          'Pixel',  'Electronics', 'Phones',      45000, 36500),
 ('HDP-001', 'NoiseCancel 700',     'Sonora', 'Audio',       'Headphones',  18000, 11200),
 ('SPK-001', 'BoomBox Mini',        'Sonora', 'Audio',       'Speakers',     4500,  2600),
 ('CHR-001', 'ErgoChair Pro',       'Sitwell','Furniture',   'Chairs',      21000, 13800),
 ('DSK-001', 'Standing Desk 140',   'Sitwell','Furniture',   'Desks',       32000, 22500),
 ('CBL-001', 'USB-C Cable 2m',      'Linkit', 'Accessories', 'Cables',        799,   210),
 ('BAG-001', 'Laptop Backpack',     'Carryon','Accessories', 'Bags',         2999,  1350);

-- 10 customers; customer 3 moved city and customer 7 was upgraded to enterprise (SCD2 history).
INSERT INTO dim_customer (customer_id, name, city, segment, valid_from, valid_to, is_current) VALUES
 (1,  'Aditi Verma',        'New Delhi', 'consumer',   '2023-01-01', '9999-12-31', true),
 (2,  'Kiran Traders',      'Mumbai',    'smb',        '2023-01-01', '9999-12-31', true),
 (3,  'Rahul Mehta',        'Pune',      'consumer',   '2023-01-01', '2025-03-01', false),
 (4,  'Infosys Campus Ops', 'Bengaluru', 'enterprise', '2023-01-01', '9999-12-31', true),
 (5,  'Sneha Pillai',       'Kochi',     'consumer',   '2023-01-01', '9999-12-31', true),
 (6,  'Gupta Electronics',  'Jaipur',    'smb',        '2023-01-01', '9999-12-31', true),
 (7,  'Nimbus Startups',    'Gurugram',  'smb',        '2023-01-01', '2024-09-15', false),
 (8,  'Farah Ali',          'Hyderabad', 'consumer',   '2023-01-01', '9999-12-31', true),
 (9,  'Bharat Logistics',   'Chennai',   'enterprise', '2023-01-01', '9999-12-31', true),
 (10, 'Ishaan Kapoor',      'Kolkata',   'consumer',   '2023-01-01', '9999-12-31', true),
 (3,  'Rahul Mehta',        'Bengaluru', 'consumer',   '2025-03-01', '9999-12-31', true),
 (7,  'Nimbus Startups',    'Gurugram',  'enterprise', '2024-09-15', '9999-12-31', true);

-- 3,000 deterministic order lines spread over 731 days, loaded in date order
-- (physical order correlates with date => BRIN works). Each fact picks the customer
-- VERSION that was valid on the sale date: the core SCD2 lookup.
INSERT INTO fact_sales (date_key, store_key, product_key, customer_key, order_no,
                        quantity, gross_amount, discount_amount, net_amount, cost_amount)
SELECT dd.date_key, x.store, p.product_key, c.customer_key,
       'ORD-' || lpad(x.g::text, 6, '0'),
       x.qty,
       p.list_price * x.qty,
       round(p.list_price * x.qty * ((x.g / 3) % 4) * 0.05, 2),
       p.list_price * x.qty - round(p.list_price * x.qty * ((x.g / 3) % 4) * 0.05, 2),
       p.unit_cost * x.qty
FROM generate_series(1, 3000) AS gs(g)
CROSS JOIN LATERAL (
  SELECT gs.g AS g,
         DATE '2024-01-01' + (gs.g * 7919 % 731) AS sale_date,
         1 + gs.g % 4         AS store,
         1 + (gs.g * 31 + gs.g / 7) % 8 AS prod,
         1 + (gs.g * 17) % 10 AS cust,
         1 + gs.g % 3         AS qty
) x
JOIN dim_date dd    ON dd.full_date = x.sale_date
JOIN dim_product p  ON p.product_key = x.prod
JOIN dim_customer c ON c.customer_id = x.cust
                   AND x.sale_date >= c.valid_from AND x.sale_date < c.valid_to
ORDER BY x.sale_date, x.g;`,
  indexes: `-- Star-join pattern: filter dimensions, then fetch matching fact rows by FK.
CREATE INDEX idx_fact_date     ON fact_sales (date_key);
CREATE INDEX idx_fact_product  ON fact_sales (product_key);
CREATE INDEX idx_fact_store    ON fact_sales (store_key);
CREATE INDEX idx_fact_customer ON fact_sales (customer_key);

-- BRIN: a few KB summarising min/max date_key per 128-page block range.
-- Only effective because facts are appended in date order (high physical correlation).
CREATE INDEX brin_fact_date ON fact_sales USING brin (date_key) WITH (pages_per_range = 32);

-- SCD2 lookup during ETL: "which version of customer X was valid on date D?"
CREATE INDEX idx_dim_customer_nk ON dim_customer (customer_id, valid_from);

-- Dimension attributes used in WHERE clauses of reports
CREATE INDEX idx_dim_product_category ON dim_product (category);
CREATE INDEX idx_dim_date_ym          ON dim_date (year, month);`,
  queries: [
    {
      title: 'Revenue with subtotals: ROLLUP over year > quarter > month',
      sql: `SELECT d.year, d.quarter, d.month,
       SUM(f.net_amount)                    AS revenue,
       SUM(f.net_amount - f.cost_amount)    AS margin,
       GROUPING(d.year, d.quarter, d.month) AS grp_level
FROM fact_sales f
JOIN dim_date d ON d.date_key = f.date_key
WHERE d.year = 2025 AND d.quarter <= 2
GROUP BY ROLLUP (d.year, d.quarter, d.month)
ORDER BY d.year NULLS LAST, d.quarter NULLS LAST, d.month NULLS LAST;`,
      explain: 'ROLLUP(a,b,c) produces grouping sets (a,b,c), (a,b), (a) and the grand total () in one scan. Subtotal rows show NULL for rolled-up columns; GROUPING() returns a bitmask (0 = detail row, 1 = quarter subtotal, 3 = year subtotal, 7 = grand total) so the report layer can label them without confusing them with real NULLs.'
    },
    {
      title: 'Cross-tab with CUBE: category x region (every combination of subtotals)',
      sql: `SELECT COALESCE(p.category, 'ALL CATEGORIES') AS category,
       COALESCE(s.region,   'ALL REGIONS')    AS region,
       SUM(f.quantity)   AS units,
       SUM(f.net_amount) AS revenue
FROM fact_sales f
JOIN dim_product p ON p.product_key = f.product_key
JOIN dim_store   s ON s.store_key   = f.store_key
JOIN dim_date    d ON d.date_key    = f.date_key
WHERE d.fiscal_year = 'FY2024-25'
GROUP BY CUBE (p.category, s.region)
ORDER BY GROUPING(p.category), p.category, GROUPING(s.region), s.region;`,
      explain: 'CUBE(a,b) = grouping sets (a,b), (a), (b), () — totals per category, per region and overall, the classic pivot-table output. Filtering on the pre-computed fiscal_year attribute shows the value of a date dimension: no fiscal-year CASE logic is repeated across hundreds of reports. COALESCE labels are safe here only because category and region are NOT NULL in the dimensions.'
    },
    {
      title: 'Year-over-year growth per category and month (LAG)',
      sql: `WITH monthly AS (
  SELECT p.category, d.year, d.month, SUM(f.net_amount) AS revenue
  FROM fact_sales f
  JOIN dim_product p ON p.product_key = f.product_key
  JOIN dim_date d    ON d.date_key    = f.date_key
  GROUP BY p.category, d.year, d.month
)
SELECT category, year, month, revenue,
       LAG(revenue) OVER (PARTITION BY category, month ORDER BY year) AS revenue_last_year,
       ROUND(100.0 * (revenue - LAG(revenue) OVER (PARTITION BY category, month ORDER BY year))
             / NULLIF(LAG(revenue) OVER (PARTITION BY category, month ORDER BY year), 0), 1) AS yoy_pct
FROM monthly
WHERE month IN (1, 2, 3)
ORDER BY category, month, year;`,
      explain: 'Partitioning the window by (category, month) and ordering by year makes LAG return the same month one year earlier. This is robust even if a month is missing (unlike LAG(revenue, 12) over a month series, which silently compares the wrong months when gaps exist). NULLIF protects against division by zero.'
    },
    {
      title: 'SCD Type 2 in action: revenue by segment AT TIME OF SALE vs CURRENT segment',
      sql: `SELECT hist.segment AS segment_at_sale,
       cur.segment  AS segment_today,
       COUNT(*)            AS order_lines,
       SUM(f.net_amount)   AS revenue
FROM fact_sales f
JOIN dim_customer hist ON hist.customer_key = f.customer_key           -- version at sale time
JOIN dim_customer cur  ON cur.customer_id = hist.customer_id AND cur.is_current
WHERE hist.customer_id IN (3, 7)
GROUP BY hist.segment, cur.segment
ORDER BY 1, 2;`,
      explain: 'Because facts reference the surrogate customer_key of the version valid on the sale date, history is frozen: Nimbus Startups sales before 15 Sep 2024 stay under smb even though the customer is enterprise today. Joining to the is_current row via the natural key gives the "as of today" restatement. Both views are legitimate business questions; SCD2 supports both, SCD1 (overwrite) only the second.'
    },
    {
      title: 'Running total and 3-month moving average (window frames)',
      sql: `WITH m AS (
  SELECT date_trunc('month', d.full_date)::date AS month, SUM(f.net_amount) AS revenue
  FROM fact_sales f JOIN dim_date d ON d.date_key = f.date_key
  WHERE d.year = 2025
  GROUP BY 1
)
SELECT month, revenue,
       SUM(revenue) OVER (ORDER BY month ROWS UNBOUNDED PRECEDING)                 AS ytd_revenue,
       ROUND(AVG(revenue) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS moving_avg_3m,
       ROUND(100.0 * revenue / SUM(revenue) OVER (), 2)                             AS pct_of_year
FROM m
ORDER BY month;`,
      explain: 'ROWS UNBOUNDED PRECEDING gives a year-to-date running total; ROWS BETWEEN 2 PRECEDING AND CURRENT ROW a trailing 3-month average. Use ROWS (physical rows), not the default RANGE, when the intent is "previous N rows" — with RANGE, peer rows having equal ORDER BY values are included together.'
    },
    {
      title: 'Aggregate table as a materialized view (millisecond dashboards)',
      sql: `CREATE MATERIALIZED VIEW mv_sales_month_category AS
SELECT d.year, d.month, p.category, s.region,
       SUM(f.quantity) AS units, SUM(f.net_amount) AS revenue,
       SUM(f.net_amount - f.cost_amount) AS margin, COUNT(*) AS lines
FROM fact_sales f
JOIN dim_date d    ON d.date_key = f.date_key
JOIN dim_product p ON p.product_key = f.product_key
JOIN dim_store s   ON s.store_key = f.store_key
GROUP BY d.year, d.month, p.category, s.region;

-- A unique index is REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY later.
CREATE UNIQUE INDEX uq_mv_smc ON mv_sales_month_category (year, month, category, region);

REFRESH MATERIALIZED VIEW mv_sales_month_category;   -- nightly after the ETL load

SELECT category, SUM(revenue) AS revenue, ROUND(100.0 * SUM(margin) / SUM(revenue), 1) AS margin_pct
FROM mv_sales_month_category
WHERE year = 2025
GROUP BY category
ORDER BY revenue DESC;`,
      explain: 'The MV collapses 3,000 (in production: billions of) fact rows into at most months x categories x regions rows, so dashboard queries read a tiny table. Margin percentage is re-derived from summed measures (additive) — never average stored percentages. A plain REFRESH takes an ACCESS EXCLUSIVE lock and blocks readers; with the unique index, REFRESH ... CONCURRENTLY lets reads continue at the cost of a slower diff-based refresh.'
    }
  ],
  transactions: `-- Nightly SCD Type 2 load from a staging table, all-or-nothing.
-- Readers never see a customer with zero or two current versions.
BEGIN;

CREATE TEMP TABLE stg_customer (customer_id int, name text, city text, segment text) ON COMMIT DROP;
INSERT INTO stg_customer VALUES
 (5, 'Sneha Pillai', 'Mumbai', 'consumer'),       -- changed city   => new version
 (6, 'Gupta Electronics', 'Jaipur', 'smb'),       -- unchanged      => nothing
 (11, 'Orbit Retail', 'Lucknow', 'smb');          -- brand new      => first version

-- 1. Expire current versions whose tracked attributes changed.
UPDATE dim_customer d
SET valid_to = CURRENT_DATE, is_current = false
FROM stg_customer s
WHERE d.customer_id = s.customer_id AND d.is_current
  AND (d.city, d.segment, d.name) IS DISTINCT FROM (s.city, s.segment, s.name);

-- 2. Insert a new current version for changed + new customers
--    (anyone in staging who no longer has a current row).
INSERT INTO dim_customer (customer_id, name, city, segment, valid_from)
SELECT s.customer_id, s.name, s.city, s.segment, CURRENT_DATE
FROM stg_customer s
WHERE NOT EXISTS (SELECT 1 FROM dim_customer d
                  WHERE d.customer_id = s.customer_id AND d.is_current);

-- 3. Load today's facts, looking up the CURRENT surrogate keys.
-- INSERT INTO fact_sales (...) SELECT ... JOIN dim_customer c ON c.customer_id = stg.customer_id AND c.is_current;

COMMIT;
-- The partial unique index uq_dim_customer_current makes a buggy load that would
-- create two current versions fail loudly instead of corrupting reports.`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Fact table scans</strong>: analytic queries aggregate millions of rows; PostgreSQL parallel query (<code>max_parallel_workers_per_gather</code>) splits the scan and partial aggregates across workers. Check plans for <code>Gather</code> / <code>Partial HashAggregate</code>.</li>
<li><strong>Wide rows</strong>: keep facts narrow (int keys + numeric measures). Every byte is multiplied by billions of rows; e.g. <code>int</code> date_key (4 bytes) instead of a text date.</li>
<li><strong>Dimension joins</strong>: dimensions are small and get hashed once; the planner builds hash tables on dims and streams the fact table (star join).</li>
</ul>
<h4>Partitioning <span class="tag core">core</span></h4>
<p>Range-partition <code>fact_sales</code> by <code>date_key</code> (monthly: <code>FOR VALUES FROM (20250101) TO (20250201)</code>). Benefits: partition pruning for date-filtered reports, loading a day/month into a staging table and <code>ATTACH PARTITION</code> (near-instant after a matching CHECK constraint exists), and dropping expired history with <code>DROP TABLE</code> on a partition instead of a massive DELETE.</p>
<h4>BRIN vs B-tree</h4>
<p>On a 2-billion-row append-only fact table, a B-tree on date_key is tens of GB; a BRIN is a few MB and is enough for range filters because rows arrive in date order. Use B-tree when you need selective lookups on unordered columns.</p>
<h4>At 100x scale</h4>
<ul>
<li>Pre-aggregated rollup tables (daily/monthly) refreshed incrementally per new partition, rather than full REFRESH of a giant MV.</li>
<li>Columnar storage: <span class="tag ext">extension</span> options such as Citus columnar or Hydra, or move cold history to a columnar warehouse (ClickHouse, BigQuery, DuckDB over Parquet) — PostgreSQL heap storage is row-oriented.</li>
<li>Distribute the fact table by a high-cardinality key (e.g. customer or order) and replicate dimensions to all nodes (Citus "reference tables").</li>
</ul>`,
  advanced: `<h4>Star vs snowflake</h4>
<p>A star keeps dimensions denormalised (category text inside dim_product). A snowflake normalises them (dim_product to dim_category to dim_department). Stars mean fewer joins and simpler SQL for BI tools; snowflakes save a little space and avoid update anomalies in very large dimensions. Most warehouses choose star.</p>
<h4>SCD types in one line each</h4>
<ul>
<li><strong>Type 1</strong>: overwrite (no history). <strong>Type 2</strong>: new row per change (full history, used here). <strong>Type 3</strong>: previous value column (one level of history). <strong>Type 6</strong>: hybrid 1+2+3 (current value copied onto all versions).</li>
</ul>
<h4>Measures</h4>
<p>Store <em>additive</em> measures (amounts, quantities) in facts. Ratios (margin %, average price) are non-additive: compute them from summed numerators and denominators at query time.</p>
<div class="callout tip">Use a surrogate key for every dimension. Natural keys from source systems get re-used, merged and changed; the surrogate key is what makes SCD2 and late-arriving data possible.</div>`
});

/* ------------------------------------------------------------------ 10. MULTI-TENANT SAAS (RLS) */
PGM.PROJECTS.push({
  id: 'saas',
  title: 'Multi-tenant SaaS with Row-Level Security',
  icon: '🏢',
  level: 4,
  summary: 'Shared-schema multi-tenancy for a project-tracking SaaS: tenant_id on every row, composite tenant-safe foreign keys, and PostgreSQL Row-Level Security policies that make cross-tenant data leaks impossible even when application code forgets a WHERE clause.',
  requirements: [
    'Thousands of customer companies (tenants) share one database and one schema; each tenant must only ever see and modify its own rows.',
    'Isolation must be enforced by the DATABASE, so a missing "WHERE tenant_id = ?" in one of 400 API queries cannot leak data.',
    'A row must never reference a row of another tenant (a task of tenant A pointing at a project of tenant B).',
    'Plans (free / pro / enterprise) limit users and projects per tenant; billing needs per-tenant usage.',
    'A support team needs read-only access across all tenants; the web app must never have it.',
    'The app connects through a connection pool, so tenant context must be set per request/transaction, not per connection.'
  ],
  entities: [
    { name: 'plans', desc: 'Global (non-tenant) catalogue: limits and price per plan.' },
    { name: 'tenants', desc: 'Customer companies: slug, plan, status.' },
    { name: 'users', desc: 'People inside a tenant; email unique per tenant (same email may exist in two tenants).' },
    { name: 'projects', desc: 'Tenant-owned projects with an owner user of the same tenant.' },
    { name: 'tasks', desc: 'Work items in a project, optionally assigned to a user of the same tenant.' },
    { name: 'invoices', desc: 'Monthly billing records per tenant.' }
  ],
  relationships: [
    { from: 'tenants', to: 'plans', type: 'N:1', label: 'subscribes to' },
    { from: 'users', to: 'tenants', type: 'N:1', label: 'belongs to' },
    { from: 'projects', to: 'users', type: 'N:1', label: 'owned by (same tenant)' },
    { from: 'tasks', to: 'projects', type: 'N:1', label: 'part of (same tenant)' },
    { from: 'tasks', to: 'users', type: 'N:1', label: 'assigned to (same tenant)' },
    { from: 'invoices', to: 'tenants', type: 'N:1', label: 'billed to' }
  ],
  ddl: `-- Roles are CLUSTER-GLOBAL (not per database/schema): create them idempotently.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_app') THEN
    CREATE ROLE saas_app NOLOGIN;        -- the web/API application
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_support') THEN
    CREATE ROLE saas_support NOLOGIN;    -- read-only support staff
  END IF;
END $$;

CREATE TABLE plans (
  id            text PRIMARY KEY,
  max_users     int  NOT NULL,
  max_projects  int  NOT NULL,
  price_inr     numeric(10,2) NOT NULL
);

CREATE TABLE tenants (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text NOT NULL,
  plan_id     text NOT NULL REFERENCES plans(id),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('trial','active','suspended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  email       text   NOT NULL,
  full_name   text   NOT NULL,
  role        text   NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, id)            -- target for tenant-safe composite FKs
);

CREATE TABLE projects (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  name        text   NOT NULL,
  owner_id    bigint NOT NULL,
  archived    boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  -- composite FK: the owner must belong to the SAME tenant
  FOREIGN KEY (tenant_id, owner_id) REFERENCES users (tenant_id, id)
);

CREATE TABLE tasks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenants(id),
  project_id   bigint NOT NULL,
  assignee_id  bigint,
  title        text   NOT NULL,
  status       text   NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  due_date     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id)  REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, assignee_id) REFERENCES users (tenant_id, id)  -- MATCH SIMPLE: NULL assignee allowed
);

CREATE TABLE invoices (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  period      date   NOT NULL CHECK (extract(day FROM period) = 1),
  amount_inr  numeric(12,2) NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
  UNIQUE (tenant_id, period)
);

-- Tenant context: set per transaction by the app (set_config(..., true) / SET LOCAL).
-- Missing/empty setting => NULL => policies match NOTHING (fail closed).
CREATE FUNCTION current_tenant_id() RETURNS bigint
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::bigint $$;

-- Enable RLS; FORCE also applies it to the table owner (superusers and BYPASSRLS roles still bypass).
ALTER TABLE tenants  ENABLE ROW LEVEL SECURITY;  ALTER TABLE tenants  FORCE ROW LEVEL SECURITY;
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;  ALTER TABLE users    FORCE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;  ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks    ENABLE ROW LEVEL SECURITY;  ALTER TABLE tasks    FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;  ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

-- App: full CRUD, but only inside the current tenant. USING filters what can be read/updated/deleted;
-- WITH CHECK rejects INSERTed or UPDATEd rows that would land in another tenant.
CREATE POLICY tenant_isolation ON tenants  FOR ALL TO saas_app
  USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());
CREATE POLICY tenant_isolation ON users    FOR ALL TO saas_app
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON projects FOR ALL TO saas_app
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON tasks    FOR ALL TO saas_app
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
-- Invoices: the app may READ its own invoices but never write them (billing service does).
CREATE POLICY tenant_read ON invoices FOR SELECT TO saas_app
  USING (tenant_id = current_tenant_id());

-- Support: read-only across all tenants (policies are permissive and OR-ed per role).
CREATE POLICY support_read ON tenants  FOR SELECT TO saas_support USING (true);
CREATE POLICY support_read ON users    FOR SELECT TO saas_support USING (true);
CREATE POLICY support_read ON projects FOR SELECT TO saas_support USING (true);
CREATE POLICY support_read ON tasks    FOR SELECT TO saas_support USING (true);

-- Privileges: RLS only narrows rows; table privileges are still required.
DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO saas_app, saas_support', current_schema());
END $$;
GRANT SELECT ON plans TO saas_app, saas_support;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, users, projects, tasks TO saas_app;
GRANT SELECT ON invoices TO saas_app;
GRANT SELECT ON tenants, users, projects, tasks TO saas_support;`,
  sampleData: `-- Loaded by the schema owner/superuser (bypasses RLS), as a migration would.
INSERT INTO plans (id, max_users, max_projects, price_inr) VALUES
 ('free', 3, 2, 0), ('pro', 25, 50, 4999), ('enterprise', 1000, 10000, 49999);

INSERT INTO tenants (slug, name, plan_id, status, created_at) VALUES
 ('acme-infra',  'Acme Infra Pvt Ltd',   'pro',        'active', '2025-01-10'),
 ('bluepeak',    'BluePeak Analytics',   'free',       'trial',  '2025-04-02'),
 ('cityworks',   'CityWorks Consulting', 'enterprise', 'active', '2024-11-20');

INSERT INTO users (tenant_id, email, full_name, role) VALUES
 (1, 'meena@acme.in',      'Meena Iyer',     'owner'),
 (1, 'arjun@acme.in',      'Arjun Das',      'admin'),
 (1, 'pooja@acme.in',      'Pooja Shah',     'member'),
 (2, 'rahul@bluepeak.io',  'Rahul Bose',     'owner'),
 (2, 'tanvi@bluepeak.io',  'Tanvi Kulkarni', 'member'),
 (2, 'sam@bluepeak.io',    'Sam Thomas',     'member'),
 (3, 'kavya@cityworks.in', 'Kavya Reddy',    'owner'),
 (3, 'imran@cityworks.in', 'Imran Qureshi',  'admin'),
 (3, 'meena@acme.in',      'Meena Iyer',     'member');   -- same email, different tenant: allowed

INSERT INTO projects (tenant_id, name, owner_id) VALUES
 (1, 'Ring Road DPR',        1),
 (1, 'Bridge Inspection',    2),
 (2, 'Churn Dashboard',      4),
 (2, 'Data Pipeline',        4),
 (3, 'Smart City Phase 2',   7),
 (3, 'Water Supply Audit',   8);

INSERT INTO tasks (tenant_id, project_id, assignee_id, title, status, due_date) VALUES
 (1, 1, 2, 'Topographic survey upload',   'done',        '2025-05-10'),
 (1, 1, 3, 'Traffic count analysis',      'in_progress', '2025-06-15'),
 (1, 1, NULL, 'Cost estimate review',     'todo',        '2025-06-30'),
 (1, 2, 3, 'Bearing condition report',    'todo',        '2025-05-25'),
 (2, 3, 5, 'Define churn metric',         'done',        '2025-04-20'),
 (2, 3, 6, 'Build cohort chart',          'in_progress', '2025-05-30'),
 (2, 4, 4, 'Set up nightly ETL',          'todo',        '2025-06-05'),
 (3, 5, 8, 'Sensor vendor shortlist',     'in_progress', '2025-05-20'),
 (3, 5, 9, 'Citizen app wireframes',      'todo',        '2025-06-10'),
 (3, 6, 7, 'Leakage hotspot map',         'done',        '2025-04-30'),
 (3, 6, 8, 'Meter data reconciliation',   'todo',        '2025-05-15');

INSERT INTO invoices (tenant_id, period, amount_inr, status) VALUES
 (1, '2025-04-01',  4999, 'paid'), (1, '2025-05-01',  4999, 'open'),
 (3, '2025-04-01', 49999, 'paid'), (3, '2025-05-01', 49999, 'paid');`,
  indexes: `-- Every tenant-scoped access path starts with tenant_id: the RLS predicate
-- (tenant_id = current_tenant_id()) plus the app's own filter form one index range.
CREATE INDEX idx_tasks_tenant_project   ON tasks (tenant_id, project_id, status);
CREATE INDEX idx_tasks_tenant_assignee  ON tasks (tenant_id, assignee_id) WHERE status <> 'done';
CREATE INDEX idx_tasks_tenant_due       ON tasks (tenant_id, due_date) WHERE status <> 'done';
CREATE INDEX idx_projects_owner         ON projects (tenant_id, owner_id);
-- users(tenant_id, email), users(tenant_id, id), projects(tenant_id, id/name) and
-- invoices(tenant_id, period) are already indexed by their UNIQUE constraints.`,
  queries: [
    {
      title: 'Platform admin view: usage vs plan limits (runs as owner, sees all tenants)',
      sql: `SELECT t.slug, t.plan_id, t.status,
       (SELECT COUNT(*) FROM users u    WHERE u.tenant_id = t.id) AS users,
       p.max_users,
       (SELECT COUNT(*) FROM projects pr WHERE pr.tenant_id = t.id AND NOT pr.archived) AS projects,
       p.max_projects,
       (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) >= p.max_users AS at_user_limit
FROM tenants t
JOIN plans p ON p.id = t.plan_id
ORDER BY t.id;`,
      explain: 'Run by a superuser/migration role, which bypasses RLS, so all three tenants are visible. BluePeak (free plan, 3 users) is at its user limit: the API should block a 4th invite, ideally with a check inside the same transaction that inserts the user (or a trigger) so two concurrent invites cannot both pass.'
    },
    {
      title: 'The app as tenant 1: RLS silently scopes every query',
      sql: `SET ROLE saas_app;
SELECT set_config('app.tenant_id', '1', false);   -- per request; use is_local = true inside a transaction

-- No WHERE tenant_id anywhere, yet only Acme rows come back.
SELECT t.tenant_id, p.name AS project, t.title, t.status, u.full_name AS assignee
FROM tasks t
JOIN projects p ON p.id = t.project_id
LEFT JOIN users u ON u.id = t.assignee_id
ORDER BY t.id;

RESET ROLE;`,
      explain: 'Every table referenced (tasks, projects, users) gets the policy predicate tenant_id = current_tenant_id() appended by the rewriter, so even the joins cannot pull in another tenant rows. Four rows are returned, all with tenant_id 1. The final RESET ROLE returns the session to the owner role; in production the app logs in directly as a role like saas_app instead of using SET ROLE.'
    },
    {
      title: 'Cross-tenant write attempts: UPDATE matches nothing, INSERT is rejected',
      sql: `SET ROLE saas_app;
SELECT set_config('app.tenant_id', '2', false);   -- BluePeak

-- 1. Try to modify Acme's task 1: the USING clause hides it, so 0 rows are updated.
UPDATE tasks SET status = 'todo' WHERE id = 1;

-- 2. Try to insert a row into tenant 1: WITH CHECK raises SQLSTATE 42501.
DO $$
BEGIN
  INSERT INTO tasks (tenant_id, project_id, title) VALUES (1, 1, 'injected task');
  RAISE NOTICE 'BUG: cross-tenant insert succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Blocked by RLS: %', SQLERRM;
END $$;

-- 3. Read back what tenant 2 can see of task 1 (nothing):
SELECT COUNT(*) AS visible_acme_tasks FROM tasks WHERE tenant_id = 1;

RESET ROLE;`,
      explain: 'UPDATE and DELETE only touch rows that pass USING, so an attacker-supplied id from another tenant behaves exactly like a non-existent id (no information leak, 0 rows affected). INSERT and the new version of an UPDATE are validated by WITH CHECK; a violation raises "new row violates row-level security policy for table tasks" (SQLSTATE 42501, insufficient_privilege), caught here in a DO block so the example keeps running.'
    },
    {
      title: 'Fail closed: no tenant context means no rows',
      sql: `SET ROLE saas_app;
SELECT set_config('app.tenant_id', '', false);    -- e.g. a background job that forgot to set it

SELECT (SELECT COUNT(*) FROM tasks)    AS tasks_visible,
       (SELECT COUNT(*) FROM projects) AS projects_visible,
       (SELECT COUNT(*) FROM plans)    AS plans_visible;   -- plans has no RLS (global catalogue)

RESET ROLE;`,
      explain: 'current_tenant_id() turns an empty or missing setting into NULL, and NULL = anything is never true, so tenant tables return 0 rows rather than everything. This is the most important property of an RLS design: bugs result in empty pages, not data breaches. The global plans table is intentionally not tenant-scoped.'
    },
    {
      title: 'Support role: read-only across tenants (permissive policies are OR-ed)',
      sql: `SET ROLE saas_support;

SELECT te.slug, COUNT(t.id) FILTER (WHERE t.status <> 'done') AS open_tasks,
       COUNT(t.id) FILTER (WHERE t.status <> 'done' AND t.due_date < DATE '2025-06-01') AS overdue
FROM tenants te
LEFT JOIN tasks t ON t.tenant_id = te.id
GROUP BY te.slug
ORDER BY overdue DESC, te.slug;

RESET ROLE;`,
      explain: 'Policies are attached to roles with TO. saas_support matches only the support_read policies (USING true, FOR SELECT), so it sees every tenant, but it has no INSERT/UPDATE/DELETE privilege and no write policy: any write fails twice over. saas_app never matches support_read, so it can never widen its view. Invoices have no support policy, so support sees zero invoice rows: RLS is deny-by-default per role.'
    },
    {
      title: 'Prove the policy is in the plan (and index-friendly)',
      sql: `SET ROLE saas_app;
SELECT set_config('app.tenant_id', '3', false);

EXPLAIN (COSTS OFF)
SELECT id, title FROM tasks WHERE status <> 'done' AND due_date < DATE '2025-06-01';

SELECT id, title, due_date FROM tasks WHERE status <> 'done' AND due_date < DATE '2025-06-01';

RESET ROLE;`,
      explain: 'The plan shows the policy predicate ANDed with the query filter; because current_tenant_id() is a simple SQL function it is even inlined, so the Filter line contains NULLIF(current_setting(...))::bigint. Because current_tenant_id() is STABLE, the planner can use it as an index condition on indexes leading with tenant_id (on this tiny table it may still choose a sequential scan). A VOLATILE function here would be evaluated per row and prevent index use: always declare tenant-context helpers STABLE.'
    }
  ],
  transactions: `-- 1. Per-request pattern behind a transaction-mode pooler (PgBouncer):
--    tenant context must live and die with the transaction.
BEGIN;
SET LOCAL ROLE saas_app;                              -- if the pool logs in as a more privileged role
SELECT set_config('app.tenant_id', '1', true);        -- true = local to this transaction
UPDATE tasks SET status = 'done' WHERE id = 2;        -- RLS-scoped
INSERT INTO tasks (tenant_id, project_id, assignee_id, title)
VALUES (current_tenant_id(), 1, 3, 'Prepare final DPR');
COMMIT;                                               -- role and tenant_id revert automatically

-- 2. Tenant onboarding (run by a privileged provisioning role, not saas_app):
BEGIN;
WITH t AS (
  INSERT INTO tenants (slug, name, plan_id, status)
  VALUES ('delta-metro', 'Delta Metro Rail', 'pro', 'trial')
  RETURNING id
), u AS (
  INSERT INTO users (tenant_id, email, full_name, role)
  SELECT id, 'ceo@deltametro.in', 'Ritu Arora', 'owner' FROM t
  RETURNING tenant_id, id
)
INSERT INTO projects (tenant_id, name, owner_id)
SELECT tenant_id, 'Getting started', id FROM u;
COMMIT;`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Noisy neighbours</strong>: one enterprise tenant with 50M tasks shares buffers, I/O and autovacuum with 5,000 small tenants. Watch per-tenant query volume (log tenant_id via <code>application_name</code> or <span class="tag ext">extension</span> pg_stat_statements + app metrics) and move whales to their own database or shard.</li>
<li><strong>Index design</strong>: lead with <code>tenant_id</code>. An index on <code>(status)</code> alone is useless when every query is implicitly <code>tenant_id = X AND status = ...</code>.</li>
<li><strong>Policy functions</strong>: keep them STABLE and cheap; a policy that does a subquery per row (e.g. membership lookup) can multiply query cost. Prefer a simple equality on a column.</li>
</ul>
<h4>Partitioning <span class="tag core">core</span></h4>
<p>Hash-partition big tables by <code>tenant_id</code> (e.g. 16 partitions) or list-partition the largest tenants into dedicated partitions. Tenant-scoped queries prune to one partition; offboarding a dedicated-partition tenant is a <code>DETACH</code> + <code>DROP</code>.</p>
<h4>At 100x scale: the three tenancy models</h4>
<table>
<tr><th>Model</th><th>Isolation</th><th>Cost / ops</th></tr>
<tr><td>Shared schema + RLS (this project)</td><td>Logical (policies)</td><td>Cheapest; one migration for all; thousands of tenants</td></tr>
<tr><td>Schema per tenant</td><td>Namespace</td><td>Migrations x N schemas; catalog bloat beyond a few thousand schemas</td></tr>
<tr><td>Database / cluster per tenant</td><td>Physical</td><td>Strongest (compliance, per-tenant backup/restore), highest cost</td></tr>
</table>
<p>Shared-schema designs scale out by sharding on <code>tenant_id</code> — the <span class="tag ext">extension</span> Citus calls this "multi-tenant distribution": all tables distributed by tenant_id are co-located, so joins stay on one node.</p>`,
  advanced: `<h4>RLS gotchas</h4>
<ul>
<li><strong>Superusers and BYPASSRLS roles always bypass RLS</strong>, and table owners bypass it unless <code>FORCE ROW LEVEL SECURITY</code> is set. The app must never connect as the owner or a superuser.</li>
<li><strong>Foreign-key checks bypass RLS</strong> (they run internally as the table owner). That is why the composite FKs on <code>(tenant_id, id)</code> matter: RLS alone would not stop a task from referencing another tenant project id.</li>
<li><strong>Unique constraints leak existence</strong>: inserting <code>UNIQUE(slug)</code> 'acme-infra' from tenant 2 fails with a duplicate-key error, revealing that the slug exists. Scope uniqueness per tenant where possible.</li>
<li><strong>The tenant setting is just a GUC</strong>: any code that can run arbitrary SQL as saas_app can call <code>set_config('app.tenant_id', ...)</code>. RLS protects against forgotten WHERE clauses, not SQL injection; keep parameterised queries. For stronger guarantees, connect with one database role per tenant or verify a signed token in a SECURITY DEFINER function.</li>
<li><strong>Views</strong> run with the view owner's privileges unless created with <code>WITH (security_invoker = true)</code> (PostgreSQL 15+); otherwise a view owned by the table owner bypasses RLS.</li>
</ul>
<div class="callout danger">Never use <code>SET</code> (session-level) for the tenant id behind a transaction-mode pooler: the next request on that server connection, possibly for another tenant, inherits it. Use <code>set_config(..., true)</code> / <code>SET LOCAL</code> inside an explicit transaction.</div>`
});

/* ------------------------------------------------------------------ 11. DOCUMENT MANAGEMENT */
PGM.PROJECTS.push({
  id: 'dms',
  title: 'Document Management System',
  icon: '📁',
  level: 4,
  summary: 'SharePoint/Drive-style DMS: folder hierarchy, immutable document versions on content-addressed (deduplicated) storage, inherited folder ACLs for users and groups, check-out locking, full-text search over extracted text, and retention.',
  requirements: [
    'Documents live in a folder tree of arbitrary depth; sibling folders cannot have the same name.',
    'Every upload creates a new immutable version; users can view history and restore any earlier version.',
    'File bytes live in object storage. Identical files (same SHA-256) are stored once, even across documents (deduplication).',
    'Permissions (read / write / admin) are granted to users or groups on folders (inherited by everything below) or on single documents.',
    'Only one person can edit (check out) a document at a time; check-in must be atomic with the new version.',
    'Search finds documents by title and by text extracted from the file (OCR/PDF text), only among documents the user may read.',
    'Records have a retention date; deleted documents go to a recycle bin before purge.'
  ],
  entities: [
    { name: 'users / groups / group_members', desc: 'Principals; permissions can be granted to either.' },
    { name: 'folders', desc: 'Self-referencing tree (adjacency list) with UNIQUE NULLS NOT DISTINCT (parent_id, name).' },
    { name: 'documents', desc: 'Logical document: title, folder, status, pointer to current version, check-out lock, retention, soft delete.' },
    { name: 'blobs', desc: 'Content-addressed file store: SHA-256 hash is the primary key; size, MIME type, object-storage key.' },
    { name: 'document_versions', desc: 'Immutable versions (document_id, version_no) pointing at a blob, with extracted text + tsvector.' },
    { name: 'acl_entries', desc: 'Grant of read/write/admin to a user or group on a folder or a document.' },
    { name: 'document_tags', desc: 'Free-form labels (contract, invoice, drawing).' }
  ],
  relationships: [
    { from: 'folders', to: 'folders', type: 'N:1', label: 'child of' },
    { from: 'documents', to: 'folders', type: 'N:1', label: 'filed in' },
    { from: 'document_versions', to: 'documents', type: 'N:1', label: 'version of' },
    { from: 'documents', to: 'document_versions', type: '1:1', label: 'current version' },
    { from: 'document_versions', to: 'blobs', type: 'N:1', label: 'stores bytes in (dedup)' },
    { from: 'acl_entries', to: 'folders', type: 'N:1', label: 'grants on folder' },
    { from: 'acl_entries', to: 'documents', type: 'N:1', label: 'grants on document' },
    { from: 'acl_entries', to: 'groups', type: 'N:1', label: 'grants to group' },
    { from: 'group_members', to: 'groups', type: 'N:1', label: 'member of' },
    { from: 'document_tags', to: 'documents', type: 'N:1', label: 'labels' }
  ],
  ddl: `CREATE TABLE users (
  id     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email  text NOT NULL UNIQUE,
  name   text NOT NULL
);

CREATE TABLE groups (
  id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

CREATE TABLE group_members (
  group_id  int NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   int NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE folders (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id  int REFERENCES folders(id),
  name       text NOT NULL CHECK (name !~ '[/\\\\]'),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- PostgreSQL 15+: two root folders (parent NULL) with the same name also conflict
  UNIQUE NULLS NOT DISTINCT (parent_id, name),
  CHECK (parent_id <> id)
);

CREATE TABLE documents (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  folder_id           int    NOT NULL REFERENCES folders(id),
  title               text   NOT NULL,
  owner_id            int    NOT NULL REFERENCES users(id),
  status              text   NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','in_review','published','archived')),
  current_version_id  bigint,                 -- FK added after document_versions exists
  checked_out_by      int REFERENCES users(id),
  checked_out_at      timestamptz,
  retention_until     date,
  deleted_at          timestamptz,            -- recycle bin
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((checked_out_by IS NULL) = (checked_out_at IS NULL))
);
-- live titles unique per folder; deleted ones can be recreated
CREATE UNIQUE INDEX uq_documents_folder_title ON documents (folder_id, lower(title)) WHERE deleted_at IS NULL;

-- Content-addressed storage: the hash IS the identity => automatic deduplication.
CREATE TABLE blobs (
  content_hash  char(64) PRIMARY KEY CHECK (content_hash ~ '^[0-9a-f]{64}$'),  -- hex SHA-256
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  mime_type     text   NOT NULL,
  storage_key   text   NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_versions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id     bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no      int    NOT NULL CHECK (version_no > 0),
  blob_hash       char(64) NOT NULL REFERENCES blobs(content_hash),
  extracted_text  text,
  change_note     text,
  created_by      int NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  search          tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(extracted_text, ''))) STORED,
  UNIQUE (document_id, version_no)
);

ALTER TABLE documents
  ADD CONSTRAINT fk_documents_current_version
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id);

CREATE TABLE acl_entries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  folder_id    int    REFERENCES folders(id)   ON DELETE CASCADE,
  document_id  bigint REFERENCES documents(id) ON DELETE CASCADE,
  user_id      int    REFERENCES users(id)     ON DELETE CASCADE,
  group_id     int    REFERENCES groups(id)    ON DELETE CASCADE,
  permission   text   NOT NULL CHECK (permission IN ('read','write','admin')),
  CHECK (num_nonnulls(folder_id, document_id) = 1),   -- exactly one target
  CHECK (num_nonnulls(user_id, group_id) = 1)         -- exactly one principal
);

CREATE TABLE document_tags (
  document_id  bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag          text   NOT NULL,
  PRIMARY KEY (document_id, tag)
);`,
  sampleData: `INSERT INTO users (email, name) VALUES
 ('asha@rodicdemo.in',   'Asha Menon'),      -- 1 engineering lead
 ('bilal@rodicdemo.in',  'Bilal Ahmed'),     -- 2 engineer
 ('chitra@rodicdemo.in', 'Chitra Pandey'),   -- 3 finance
 ('dinesh@auditco.in',   'Dinesh Rao');      -- 4 external auditor

INSERT INTO groups (name) VALUES ('engineering'), ('finance'), ('all-staff');
INSERT INTO group_members (group_id, user_id) VALUES
 (1, 1), (1, 2), (2, 3), (3, 1), (3, 2), (3, 3);

INSERT INTO folders (parent_id, name) VALUES (NULL, 'Company');          -- 1
INSERT INTO folders (parent_id, name) VALUES
 (1, 'Engineering'),   -- 2
 (1, 'Finance'),       -- 3
 (1, 'Policies');      -- 4
INSERT INTO folders (parent_id, name) VALUES
 (2, 'Designs'),       -- 5
 (3, 'Invoices 2025'); -- 6

INSERT INTO documents (folder_id, title, owner_id, status, retention_until, created_at) VALUES
 (5, 'Bridge design basis report', 1, 'published', '2035-03-31', '2025-01-15'),
 (5, 'Pavement design memo',       2, 'in_review', '2035-03-31', '2025-03-02'),
 (6, 'Invoice INV-2025-041',       3, 'published', '2033-03-31', '2025-04-05'),
 (6, 'Invoice INV-2025-042',       3, 'published', '2033-03-31', '2025-04-20'),
 (4, 'Leave policy',               1, 'published', NULL,         '2024-12-01'),
 (4, 'Old travel policy',          1, 'archived',  '2024-12-31', '2023-06-01');

-- Blobs are keyed by the SHA-256 of their content (core sha256(), PostgreSQL 11+).
-- Here the "content" is a short label standing in for the real file bytes.
INSERT INTO blobs (content_hash, size_bytes, mime_type, storage_key)
SELECT h, v.size_bytes, v.mime, 'cas/' || substr(h, 1, 2) || '/' || h
FROM (VALUES
  ('bridge-v1', 1820000, 'application/pdf'),
  ('bridge-v2', 1910500, 'application/pdf'),
  ('bridge-v3', 2004200, 'application/pdf'),
  ('pavement-v1', 420000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  ('inv-041', 88000, 'application/pdf'),
  ('inv-042', 91000, 'application/pdf'),
  ('leave-v1', 150000, 'application/pdf'),
  ('leave-v2', 162000, 'application/pdf'),
  ('travel-v1', 99000, 'application/pdf')
) AS v(label, size_bytes, mime)
CROSS JOIN LATERAL (SELECT encode(sha256(convert_to(v.label, 'UTF8')), 'hex') AS h) x;

INSERT INTO document_versions (document_id, version_no, blob_hash, extracted_text, change_note, created_by, created_at)
SELECT v.doc, v.ver, encode(sha256(convert_to(v.label, 'UTF8')), 'hex'), v.txt, v.note, v.by_user, v.at::timestamptz
FROM (VALUES
  (1, 1, 'bridge-v1', 'Design basis for the river bridge: span arrangement 3 x 40 m, IRC loading class 70R, seismic zone IV.', 'Initial draft', 1, '2025-01-15'),
  (1, 2, 'bridge-v2', 'Design basis for the river bridge: span arrangement 3 x 40 m, IRC loading class 70R, seismic zone IV, scour depth revised.', 'Scour depth revised after hydrology study', 2, '2025-02-10'),
  (1, 3, 'bridge-v3', 'Design basis for the river bridge: span arrangement 3 x 40 m, IRC 70R loading, seismic zone IV, scour depth revised, bearing type elastomeric.', 'Bearing type finalised', 1, '2025-03-20'),
  (2, 1, 'pavement-v1', 'Flexible pavement design using IRC 37: design traffic 50 msa, CBR 8 percent, bituminous concrete wearing course.', 'For review', 2, '2025-03-02'),
  (3, 1, 'inv-041', 'Invoice INV-2025-041 consultancy fee for bridge design, amount 4,50,000 INR, GST 18 percent.', NULL, 3, '2025-04-05'),
  (4, 1, 'inv-042', 'Invoice INV-2025-042 site supervision charges April, amount 2,10,000 INR, GST 18 percent.', NULL, 3, '2025-04-20'),
  (5, 1, 'leave-v1', 'Leave policy: 24 days earned leave, 12 days casual leave per year.', 'Policy v1', 1, '2024-12-01'),
  (5, 2, 'leave-v2', 'Leave policy: 24 days earned leave, 12 days casual leave, 26 weeks maternity leave.', 'Added maternity leave clause', 1, '2025-02-01'),
  (5, 3, 'leave-v1', 'Leave policy: 24 days earned leave, 12 days casual leave per year.', 'Restored version 1 (legal review)', 1, '2025-02-15'),
  (6, 1, 'travel-v1', 'Travel policy: economy class for domestic travel, per diem 2,500 INR.', NULL, 1, '2023-06-01')
) AS v(doc, ver, label, txt, note, by_user, at);

-- Point every document at its latest version.
UPDATE documents d SET current_version_id = v.id
FROM (SELECT DISTINCT ON (document_id) document_id, id
      FROM document_versions ORDER BY document_id, version_no DESC) v
WHERE v.document_id = d.id;

-- Bilal has the pavement memo checked out.
UPDATE documents SET checked_out_by = 2, checked_out_at = '2025-05-28 11:00+05:30' WHERE id = 2;

INSERT INTO acl_entries (folder_id, document_id, user_id, group_id, permission) VALUES
 (1,    NULL, NULL, 3, 'read'),    -- all-staff can read everything under Company
 (2,    NULL, NULL, 1, 'write'),   -- engineering writes under Engineering
 (3,    NULL, NULL, 2, 'write'),   -- finance writes under Finance
 (1,    NULL, 1,    NULL, 'admin'),-- Asha administers the whole tree
 (NULL, 3,    4,    NULL, 'read'); -- external auditor may read ONE invoice only

INSERT INTO document_tags (document_id, tag) VALUES
 (1, 'bridge'), (1, 'design-basis'), (2, 'pavement'), (3, 'invoice'), (4, 'invoice'),
 (5, 'hr'), (5, 'policy'), (6, 'policy');`,
  indexes: `-- Tree navigation: children of a folder (the UNIQUE (parent_id, name) index already serves this).
-- Documents in a folder (live only), newest first.
CREATE INDEX idx_documents_folder ON documents (folder_id, created_at DESC) WHERE deleted_at IS NULL;

-- Version history of a document is served by UNIQUE (document_id, version_no).
-- Blob reference counting / garbage collection: "is this hash still used?"
CREATE INDEX idx_versions_blob ON document_versions (blob_hash);

-- Full-text search over extracted text.
CREATE INDEX idx_versions_search ON document_versions USING gin (search);

-- ACL lookups by target and by principal.
CREATE INDEX idx_acl_folder   ON acl_entries (folder_id)   WHERE folder_id   IS NOT NULL;
CREATE INDEX idx_acl_document ON acl_entries (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_acl_group    ON acl_entries (group_id)    WHERE group_id    IS NOT NULL;
CREATE INDEX idx_acl_user     ON acl_entries (user_id)     WHERE user_id     IS NOT NULL;
CREATE INDEX idx_group_members_user ON group_members (user_id);

-- Retention job scans only documents that have a retention date and are not yet archived.
CREATE INDEX idx_documents_retention ON documents (retention_until)
  WHERE retention_until IS NOT NULL AND status <> 'archived' AND deleted_at IS NULL;

-- Tag filter ("all invoices")
CREATE INDEX idx_document_tags_tag ON document_tags (tag);`,
  queries: [
    {
      title: 'Folder tree with full paths and document counts (recursive CTE)',
      sql: `WITH RECURSIVE tree AS (
  SELECT id, parent_id, name, 0 AS depth, name::text AS path, ARRAY[id] AS id_path
  FROM folders WHERE parent_id IS NULL
  UNION ALL
  SELECT f.id, f.parent_id, f.name, t.depth + 1, t.path || '/' || f.name, t.id_path || f.id
  FROM folders f
  JOIN tree t ON f.parent_id = t.id
  WHERE NOT f.id = ANY (t.id_path)            -- cycle guard
)
SELECT repeat('    ', depth) || name AS folder, path,
       (SELECT COUNT(*) FROM documents d WHERE d.folder_id = tree.id AND d.deleted_at IS NULL) AS docs
FROM tree
ORDER BY id_path;`,
      explain: 'The anchor selects root folders; the recursive term joins children to the rows found so far until no new rows appear. Accumulating id_path gives both a correct depth-first display order (ORDER BY array) and a cycle guard. PostgreSQL 14+ also offers the SQL-standard SEARCH DEPTH FIRST BY and CYCLE clauses for the same purpose.'
    },
    {
      title: 'Effective permissions: which documents can user 2 (Bilal) access, and how?',
      sql: `WITH RECURSIVE principals AS (           -- the user plus all their groups
  SELECT 'user'::text AS kind, 2 AS pid
  UNION ALL
  SELECT 'group', group_id FROM group_members WHERE user_id = 2
), ancestors AS (                            -- every document's folder and all parent folders
  SELECT d.id AS document_id, d.folder_id AS folder_id
  FROM documents d WHERE d.deleted_at IS NULL
  UNION ALL
  SELECT a.document_id, f.parent_id
  FROM ancestors a JOIN folders f ON f.id = a.folder_id
  WHERE f.parent_id IS NOT NULL
), grants AS (
  SELECT a.document_id, e.permission, e.user_id, e.group_id, 'inherited' AS via
  FROM ancestors a JOIN acl_entries e ON e.folder_id = a.folder_id
  UNION ALL
  SELECT e.document_id, e.permission, e.user_id, e.group_id, 'direct'
  FROM acl_entries e WHERE e.document_id IS NOT NULL
)
SELECT d.id, d.title,
       (ARRAY['read','write','admin'])[MAX(array_position(ARRAY['read','write','admin'], g.permission))] AS effective,
       string_agg(DISTINCT g.permission || ' (' || g.via || ')', ', ') AS from_grants
FROM documents d
JOIN grants g     ON g.document_id = d.id
JOIN principals p ON (p.kind = 'user'  AND g.user_id  = p.pid)
                  OR (p.kind = 'group' AND g.group_id = p.pid)
WHERE d.deleted_at IS NULL
GROUP BY d.id, d.title
ORDER BY d.id;`,
      explain: 'Three ideas combine: (1) the principal set is the user plus every group they belong to; (2) the recursive ancestors CTE expands each document into its folder and all parent folders, which is what makes folder grants inherit downwards; (3) the strongest permission wins, computed by mapping read/write/admin to positions 1/2/3 and taking MAX. Bilal gets write on engineering designs (group engineering on Engineering) and read on everything else (all-staff on Company).'
    },
    {
      title: 'Search extracted text of CURRENT versions, only in documents the user may read',
      sql: `WITH RECURSIVE ancestors AS (
  SELECT d.id AS document_id, d.folder_id FROM documents d WHERE d.deleted_at IS NULL
  UNION ALL
  SELECT a.document_id, f.parent_id FROM ancestors a JOIN folders f ON f.id = a.folder_id
  WHERE f.parent_id IS NOT NULL
), readable AS (                                     -- user 4 = external auditor
  SELECT DISTINCT a.document_id
  FROM ancestors a
  JOIN acl_entries e ON e.folder_id = a.folder_id OR e.document_id = a.document_id
  WHERE e.user_id = 4
     OR e.group_id IN (SELECT group_id FROM group_members WHERE user_id = 4)
)
SELECT d.id, d.title, v.version_no,
       ts_headline('english', v.extracted_text, q, 'MaxWords=12, MinWords=5') AS snippet,
       ts_rank(v.search, q) AS rank
FROM documents d
JOIN document_versions v ON v.id = d.current_version_id
JOIN readable r ON r.document_id = d.id,
     websearch_to_tsquery('english', 'invoice GST') AS q
WHERE v.search @@ q
ORDER BY rank DESC;`,
      explain: 'Both invoices contain "invoice" and "GST", but the auditor only has a document-level grant on INV-2025-041, so exactly one row is returned. Security trimming must happen in the same query as the search (not by filtering the top 10 afterwards, which leaks counts and breaks pagination). websearch_to_tsquery accepts Google-like input ("quoted phrases", -exclusions, or) and never throws a syntax error on user input.'
    },
    {
      title: 'Storage report: logical vs physical bytes (deduplication savings)',
      sql: `SELECT f.name AS folder,
       COUNT(v.id)                              AS versions,
       pg_size_pretty(SUM(b.size_bytes))        AS logical_size,
       pg_size_pretty(SUM(b.size_bytes) FILTER (WHERE v.first_use)) AS physical_size
FROM (
  SELECT v.*, ROW_NUMBER() OVER (PARTITION BY v.blob_hash ORDER BY v.id) = 1 AS first_use
  FROM document_versions v
) v
JOIN blobs b     ON b.content_hash = v.blob_hash
JOIN documents d ON d.id = v.document_id
JOIN folders f   ON f.id = d.folder_id
GROUP BY ROLLUP (f.name)
ORDER BY f.name NULLS LAST;`,
      explain: 'Logical size counts every version as if it were a separate file; physical size counts each distinct blob once (first_use marks the first version that references a hash). The Leave policy restore (v3 = v1) costs zero extra bytes because v3 points at the existing blob. ROLLUP adds the grand total row. pg_size_pretty formats bytes as kB/MB.'
    },
    {
      title: 'Version history with size change and author (LAG)',
      sql: `SELECT v.version_no, u.name AS author, v.created_at::date AS saved_on, v.change_note,
       b.size_bytes,
       b.size_bytes - LAG(b.size_bytes) OVER (ORDER BY v.version_no) AS size_delta,
       v.blob_hash = LAG(v.blob_hash) OVER (ORDER BY v.version_no) AS identical_to_previous,
       v.id = d.current_version_id AS is_current
FROM document_versions v
JOIN documents d ON d.id = v.document_id
JOIN blobs b ON b.content_hash = v.blob_hash
JOIN users u ON u.id = v.created_by
WHERE v.document_id = 5
ORDER BY v.version_no;`,
      explain: 'The UNIQUE (document_id, version_no) index returns versions in order without sorting. LAG compares each version to the previous one; comparing content hashes detects no-op uploads or restores without opening the files.'
    },
    {
      title: 'Retention and housekeeping: what should be archived, which blobs are orphaned',
      sql: `SELECT 'archive' AS action, d.id::text AS item, d.title AS detail
FROM documents d
WHERE d.retention_until < DATE '2025-06-01'
  AND d.status <> 'archived' AND d.deleted_at IS NULL
UNION ALL
SELECT 'stale checkout', d.id::text, d.title || ' (by user ' || d.checked_out_by || ' since ' || d.checked_out_at::date || ')'
FROM documents d
WHERE d.checked_out_at < TIMESTAMPTZ '2025-06-01 00:00+05:30' - INTERVAL '2 days'
UNION ALL
SELECT 'purge blob', b.content_hash, b.storage_key
FROM blobs b
WHERE NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.blob_hash = b.content_hash);`,
      explain: 'Nightly jobs as one report. The anti-join (NOT EXISTS) uses idx_versions_blob to find blobs no version references any more; they are deleted from object storage first and from the table second (a crash in between leaves a re-collectable row, never a dangling pointer). The archived travel policy is already archived, so nothing is returned for retention in this sample; the 3-day-old checkout is flagged.'
    }
  ],
  transactions: `-- Check-out: atomic "lock if free" (no read-then-write race).
UPDATE documents
SET checked_out_by = 1, checked_out_at = now()
WHERE id = 1 AND checked_out_by IS NULL AND deleted_at IS NULL
RETURNING id;            -- 0 rows => someone else has it; tell the user who

-- Check-in: new immutable version + pointer swap + unlock, all or nothing.
BEGIN;

-- 1. Lock the document row; verify the caller holds the checkout.
SELECT id FROM documents WHERE id = 1 AND checked_out_by = 1 FOR UPDATE;
-- (application aborts with ROLLBACK if no row is returned)

-- 2. Register the blob (already uploaded to object storage under its hash).
INSERT INTO blobs (content_hash, size_bytes, mime_type, storage_key)
VALUES ('9f2c1e7a4b3d5f6081a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8', 2051300,
        'application/pdf', 'cas/9f/9f2c1e7a4b3d5f6081a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8')
ON CONFLICT (content_hash) DO NOTHING;      -- identical file already stored => dedup

-- 3. Next version number is safe to compute: we hold the document row lock.
WITH nv AS (
  INSERT INTO document_versions (document_id, version_no, blob_hash, extracted_text, change_note, created_by)
  SELECT 1, COALESCE(MAX(version_no), 0) + 1,
         '9f2c1e7a4b3d5f6081a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8',
         'Design basis ... revised pier dimensions', 'Pier dimensions revised', 1
  FROM document_versions WHERE document_id = 1
  RETURNING id
)
UPDATE documents d
SET current_version_id = nv.id, checked_out_by = NULL, checked_out_at = NULL
FROM nv
WHERE d.id = 1;

COMMIT;

-- Restore an old version = create a NEW version pointing at the old blob (history stays linear).`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Permission checks</strong> on every list/search are the dominant cost. Recursive ancestor walks per request do not scale to millions of documents: materialise the effective ACL (<code>document_access(document_id, principal_id, permission)</code>) or store a materialised folder path and recompute on ACL/move changes, which are rare compared with reads.</li>
<li><strong>Large text</strong>: <code>extracted_text</code> can be megabytes; it is TOASTed (compressed, stored out of line) automatically. Keep it out of list queries; select it only for search snippets.</li>
<li><strong>tsvector limits</strong>: a single tsvector is limited to 1 MB; chunk very long documents into pages/sections (which also improves snippet relevance).</li>
</ul>
<h4>Partitioning <span class="tag core">core</span></h4>
<p><code>document_versions</code> and an access-log table grow fastest. Range-partition the access log by month (cheap retention via <code>DROP</code> of old partitions). Versions are usually fine unpartitioned until hundreds of millions of rows; then hash-partition by <code>document_id</code> so a document's history stays in one partition.</p>
<h4>At 100x scale</h4>
<ul>
<li>Bytes never touch PostgreSQL: clients upload directly to object storage with pre-signed URLs, and the DB stores only metadata + hash.</li>
<li>Search moves to a dedicated engine (OpenSearch/Elasticsearch) fed by logical decoding / an outbox table when relevance tuning, faceting or many languages are needed; PostgreSQL FTS stays the simple, transactional option.</li>
<li>Shard by tenant/site; the folder tree and ACLs of one tenant must be co-located with its documents.</li>
</ul>`,
  advanced: `<h4>Adjacency list vs materialised path</h4>
<p>This design uses <code>parent_id</code> + recursive CTEs (simple moves: change one row). The <span class="tag ext">extension</span> ltree stores paths like <code>company.engineering.designs</code> with GiST-indexed ancestor/descendant operators (<code>@&gt;</code>, <code>&lt;@</code>) — subtree queries become one index scan, but moving a folder rewrites the path of every descendant.</p>
<h4>Why content addressing</h4>
<ul>
<li>Deduplication for free; integrity verification (re-hash the object and compare); safe concurrent uploads of the same file (<code>ON CONFLICT DO NOTHING</code>).</li>
<li>Deleting a version never deletes bytes directly; a garbage collector removes unreferenced blobs.</li>
</ul>
<h4>Legal hold and immutability</h4>
<p>Revoke UPDATE/DELETE on <code>document_versions</code> from the app role and add a trigger that rejects deletes of documents under legal hold or before <code>retention_until</code>. Object storage should use WORM/object-lock for the same period.</p>
<div class="callout warn">Do not compute the next version number with <code>SELECT MAX(version_no)+1</code> without first locking the document row: two concurrent check-ins both read 3 and one fails on the UNIQUE (document_id, version_no) constraint (or, without the constraint, silently creates two version 4s).</div>`
});

/* ------------------------------------------------------------------ 12. AI RAG DATABASE (pgvector) */
PGM.PROJECTS.push({
  id: 'rag',
  title: 'AI RAG Database with pgvector',
  icon: '🤖',
  level: 7,
  summary: 'Retrieval-Augmented Generation store on PostgreSQL + the pgvector extension: sources, chunks with embeddings, HNSW indexing, permission-aware filtered vector search, hybrid (vector + full-text) ranking with Reciprocal Rank Fusion, prompt-context assembly within a token budget, and citation logging for evaluation.',
  requirements: [
    'Ingest documents (handbooks, FAQs, policies), split them into overlapping chunks and store one embedding per chunk next to the text and metadata.',
    'Answer questions by retrieving the k most similar chunks (cosine distance) in a few milliseconds, even with tens of millions of chunks.',
    'Retrieval must respect permissions: a user only retrieves chunks from sources their groups may see. Filters must not starve results.',
    'Exact keyword matches (error codes, product names, "SQLSTATE 40001") must not be lost: combine vector similarity with full-text search (hybrid search).',
    'Re-ingesting a changed document must atomically replace its chunks: no window where the bot sees half old, half new chunks.',
    'Every answer stores which chunks were cited, plus user feedback, to evaluate and improve retrieval quality.'
  ],
  entities: [
    { name: 'sources', desc: 'Ingested documents: URI, title, type, access group, content hash and version (to skip unchanged re-ingests).' },
    { name: 'chunks', desc: 'Text chunks with position (chunk_index), token count, metadata JSONB, embedding vector(N) and a generated tsvector.' },
    { name: 'chat_sessions', desc: 'A conversation of one user with the assistant.' },
    { name: 'chat_messages', desc: 'User questions and assistant answers (role, content, latency, model).' },
    { name: 'retrievals', desc: 'Which chunks were retrieved for an answer, at what rank and score, and whether the user found the answer helpful.' }
  ],
  relationships: [
    { from: 'chunks', to: 'sources', type: 'N:1', label: 'split from' },
    { from: 'chat_messages', to: 'chat_sessions', type: 'N:1', label: 'part of' },
    { from: 'retrievals', to: 'chat_messages', type: 'N:1', label: 'context for answer' },
    { from: 'retrievals', to: 'chunks', type: 'N:1', label: 'cites' }
  ],
  ddl: `CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector: an EXTENSION, not core PostgreSQL

CREATE TABLE sources (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uri           text NOT NULL UNIQUE,
  title         text NOT NULL,
  source_type   text NOT NULL CHECK (source_type IN ('handbook','faq','policy','ticket')),
  access_group  text NOT NULL DEFAULT 'all-staff',   -- who may retrieve it
  content_hash  text NOT NULL,                       -- skip re-embedding unchanged files
  version       int  NOT NULL DEFAULT 1,
  ingested_at   timestamptz NOT NULL DEFAULT now()
);

-- Real models produce 384-3072 dimensions (e.g. 1536). This course uses vector(4) toy
-- embeddings so you can read them: [databases, billing, hr/leave, travel].
CREATE TABLE chunks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id    bigint NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  chunk_index  int    NOT NULL,                      -- position inside the source
  content      text   NOT NULL,
  token_count  int    NOT NULL CHECK (token_count > 0),
  metadata     jsonb  NOT NULL DEFAULT '{}'::jsonb,  -- section, page, language ...
  embedding    vector(4) NOT NULL,                   -- dimension is enforced on insert
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (source_id, chunk_index)
);

CREATE TABLE chat_sessions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_email  text NOT NULL,
  user_groups text[] NOT NULL,                       -- resolved at login, used for filtering
  started_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  bigint NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        text   NOT NULL CHECK (role IN ('user','assistant')),
  content     text   NOT NULL,
  model       text,
  latency_ms  int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE retrievals (
  message_id  bigint NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,  -- assistant answer
  chunk_id    bigint NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  rank        int    NOT NULL,
  score       real   NOT NULL,
  cited       boolean NOT NULL DEFAULT false,         -- did the answer actually use it
  helpful     boolean,                                -- thumbs up/down from the user
  PRIMARY KEY (message_id, chunk_id)
);`,
  sampleData: `INSERT INTO sources (uri, title, source_type, access_group, content_hash, ingested_at) VALUES
 ('kb://dba/postgres-ops',   'PostgreSQL Operations Handbook', 'handbook', 'engineering', 'h-ops-1',   '2025-05-01'),
 ('kb://finance/billing-faq','Billing and Invoicing FAQ',      'faq',      'all-staff',   'h-bill-1',  '2025-05-03'),
 ('kb://hr/leave-policy',    'Leave Policy 2025',              'policy',   'all-staff',   'h-leave-1', '2025-04-15'),
 ('kb://hr/travel-policy',   'Travel and Expense Policy',      'policy',   'all-staff',   'h-trav-1',  '2025-04-15'),
 ('kb://finance/payroll',    'Payroll Runbook (restricted)',   'handbook', 'finance',     'h-pay-1',   '2025-05-05');

INSERT INTO chunks (source_id, chunk_index, content, token_count, metadata, embedding) VALUES
 (1, 0, 'Autovacuum removes dead tuples. For large tables lower autovacuum_vacuum_scale_factor to 0.01 so vacuum runs before bloat builds up.', 32, '{"section":"vacuum"}',      '[0.95, 0.05, 0.00, 0.00]'),
 (1, 1, 'If a transaction fails with SQLSTATE 40001 (serialization_failure) the application must retry the whole transaction.',                 28, '{"section":"transactions"}','[0.90, 0.10, 0.00, 0.05]'),
 (1, 2, 'Use pg_stat_statements to find the slowest queries by total_exec_time, then EXPLAIN (ANALYZE, BUFFERS) them.',                          27, '{"section":"tuning"}',      '[0.92, 0.00, 0.05, 0.00]'),
 (1, 3, 'Replication lag is visible in pg_stat_replication; alert when replay_lag exceeds 30 seconds.',                                          22, '{"section":"replication"}', '[0.88, 0.02, 0.00, 0.10]'),
 (2, 0, 'Invoices are generated on the 1st of every month and payment is due within 30 days.',                                                   20, '{"section":"invoices"}',    '[0.05, 0.95, 0.00, 0.00]'),
 (2, 1, 'Refunds for duplicate payments are processed within 7 working days to the original payment method.',                                    21, '{"section":"refunds"}',     '[0.02, 0.90, 0.00, 0.10]'),
 (2, 2, 'GST of 18 percent is added to consultancy invoices; the GSTIN must appear on every invoice.',                                            22, '{"section":"tax"}',         '[0.00, 0.92, 0.05, 0.00]'),
 (3, 0, 'Employees receive 24 days of earned leave and 12 days of casual leave per calendar year.',                                               19, '{"section":"entitlement"}', '[0.00, 0.05, 0.97, 0.05]'),
 (3, 1, 'Unused earned leave up to 30 days can be carried forward to the next year.',                                                            17, '{"section":"carry-forward"}','[0.00, 0.10, 0.93, 0.00]'),
 (4, 0, 'Domestic travel is booked in economy class; the daily allowance is 2,500 INR for metro cities.',                                         21, '{"section":"booking"}',     '[0.00, 0.15, 0.05, 0.95]'),
 (4, 1, 'Submit travel expense claims with receipts within 15 days of returning from the trip.',                                                  18, '{"section":"claims"}',      '[0.00, 0.35, 0.05, 0.90]'),
 (5, 0, 'Payroll is processed on the 28th; salary revisions need approval from the finance controller.',                                          19, '{"section":"schedule"}',    '[0.00, 0.85, 0.30, 0.00]'),
 -- the travel-claims paragraph was copy-pasted into the billing FAQ (a near-duplicate)
 (2, 3, 'Submit travel expense claims with receipts within 15 days of returning from your trip.',                                                 18, '{"section":"claims"}',      '[0.00, 0.36, 0.05, 0.90]');

INSERT INTO chat_sessions (user_email, user_groups, started_at) VALUES
 ('neha@rodicdemo.in', ARRAY['all-staff','engineering'], '2025-06-02 10:00+05:30'),
 ('omar@rodicdemo.in', ARRAY['all-staff'],               '2025-06-02 11:00+05:30');

INSERT INTO chat_messages (session_id, role, content, model, latency_ms, created_at) VALUES
 (1, 'user',      'How should I handle error 40001 in my service?', NULL, NULL, '2025-06-02 10:00:05+05:30'),
 (1, 'assistant', 'SQLSTATE 40001 is a serialization failure: retry the whole transaction with backoff.', 'llm-small', 1840, '2025-06-02 10:00:07+05:30'),
 (2, 'user',      'How many casual leaves do I get?', NULL, NULL, '2025-06-02 11:00:03+05:30'),
 (2, 'assistant', 'You get 12 days of casual leave per calendar year.', 'llm-small', 1210, '2025-06-02 11:00:05+05:30');

INSERT INTO retrievals (message_id, chunk_id, rank, score, cited, helpful) VALUES
 (2, 2, 1, 0.97, true,  true), (2, 1, 2, 0.91, false, true), (2, 3, 3, 0.89, false, true),
 (4, 8, 1, 0.98, true,  true), (4, 9, 2, 0.95, false, true), (4, 6, 3, 0.12, false, true);`,
  indexes: `-- Approximate nearest neighbour (ANN) index. HNSW = multi-layer proximity graph:
-- better recall/latency trade-off than IVFFlat and no training step, but slower to build
-- and more memory. The operator class MUST match the query operator: vector_cosine_ops <=> <=>.
CREATE INDEX idx_chunks_embedding_hnsw ON chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Full-text side of hybrid search.
CREATE INDEX idx_chunks_tsv ON chunks USING gin (tsv);

-- Metadata filters (containment queries: metadata @> '{"section":"vacuum"}').
CREATE INDEX idx_chunks_metadata ON chunks USING gin (metadata jsonb_path_ops);

-- FK / re-ingest: delete or fetch all chunks of a source (UNIQUE (source_id, chunk_index) covers it).
CREATE INDEX idx_sources_access ON sources (access_group);
CREATE INDEX idx_retrievals_chunk ON retrievals (chunk_id);
CREATE INDEX idx_messages_session ON chat_messages (session_id, created_at);`,
  queries: [
    {
      title: 'Top-k semantic search (cosine distance)',
      sql: `-- Question: "how do I tune autovacuum for a big table?" embedded by the model as:
SELECT c.id, s.title, c.metadata ->> 'section' AS section,
       round((c.embedding <=> '[0.93, 0.03, 0.02, 0.00]')::numeric, 4)     AS cosine_distance,
       round((1 - (c.embedding <=> '[0.93, 0.03, 0.02, 0.00]'))::numeric, 4) AS similarity,
       left(c.content, 60) AS preview
FROM chunks c
JOIN sources s ON s.id = c.source_id
ORDER BY c.embedding <=> '[0.93, 0.03, 0.02, 0.00]'
LIMIT 3;`,
      explain: 'The pgvector operators: <-> (L2 distance), <=> (cosine distance = 1 - cosine similarity), <#> (negative inner product). The ORDER BY distance LIMIT k shape is exactly what the HNSW index accelerates; computing distance only in the SELECT list (or wrapping it in an expression in ORDER BY) would force a full scan. On this 12-row table the planner sensibly uses a sequential scan.'
    },
    {
      title: 'Permission-aware filtered search with iterative index scans',
      sql: `-- pgvector 0.8+: keep scanning the HNSW graph until LIMIT rows pass the filter,
-- instead of returning too few rows when the filter is selective.
SET hnsw.iterative_scan = relaxed_order;
SET hnsw.ef_search = 100;

-- User omar (groups: all-staff) asks about "payroll salary processing date".
WITH q AS (SELECT '[0.00, 0.88, 0.25, 0.00]'::vector(4) AS v)
SELECT c.id, s.title, s.access_group,
       round((c.embedding <=> q.v)::numeric, 4) AS distance,
       left(c.content, 70) AS preview
FROM chunks c
JOIN sources s        ON s.id = c.source_id
JOIN chat_sessions cs ON cs.id = 2 AND s.access_group = ANY (cs.user_groups), q
ORDER BY c.embedding <=> q.v
LIMIT 3;`,
      explain: 'The restricted Payroll Runbook is the closest chunk but omar is not in finance, so it never appears: permission filtering happens inside the database query, before the LLM sees anything. With an HNSW index, a WHERE filter is applied after the graph search returns ef_search candidates, so selective filters used to return fewer than k rows; iterative_scan (relaxed_order or strict_order) continues the search until enough rows pass. relaxed_order may return results slightly out of distance order, so re-sort in an outer query if exact order matters.'
    },
    {
      title: 'Hybrid search: vector + full-text fused with Reciprocal Rank Fusion',
      sql: `-- Question: "what does SQLSTATE 40001 mean" — the exact token 40001 matters.
WITH q AS (
  SELECT '[0.85, 0.10, 0.05, 0.05]'::vector(4) AS v,
         websearch_to_tsquery('english', 'SQLSTATE 40001') AS ts
), semantic AS (
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.embedding <=> q.v) AS r
  FROM chunks c, q
  ORDER BY c.embedding <=> q.v
  LIMIT 20
), keyword AS (
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv, q.ts) DESC) AS r
  FROM chunks c, q
  WHERE c.tsv @@ q.ts
  ORDER BY ts_rank_cd(c.tsv, q.ts) DESC
  LIMIT 20
)
SELECT c.id, left(c.content, 70) AS preview,
       s.r AS semantic_rank, k.r AS keyword_rank,
       round((COALESCE(1.0 / (60 + s.r), 0) + COALESCE(1.0 / (60 + k.r), 0))::numeric, 5) AS rrf_score
FROM semantic s
FULL OUTER JOIN keyword k ON k.id = s.id
JOIN chunks c ON c.id = COALESCE(s.id, k.id)
ORDER BY rrf_score DESC
LIMIT 5;`,
      explain: 'Vector search finds paraphrases ("transaction conflict") but can miss exact identifiers; full-text search is the opposite. Reciprocal Rank Fusion scores each document as the sum of 1/(60 + rank) over the lists it appears in (60 is the constant from the original RRF paper), which needs no score normalisation between cosine distances and ts_rank values. FULL OUTER JOIN keeps documents found by only one method. Both CTEs are index-backed (HNSW and GIN).'
    },
    {
      title: 'Assemble the prompt context: top hits + neighbouring chunks within a token budget',
      sql: `WITH hits AS (
  SELECT c.source_id, c.chunk_index, c.embedding <=> '[0.02, 0.10, 0.95, 0.02]' AS dist
  FROM chunks c
  ORDER BY dist
  LIMIT 2
), expanded AS (          -- add the chunk before/after each hit for continuity
  SELECT DISTINCT c.id, c.source_id, c.chunk_index, c.content, c.token_count, MIN(h.dist) OVER (PARTITION BY c.id) AS dist
  FROM hits h
  JOIN chunks c ON c.source_id = h.source_id
               AND c.chunk_index BETWEEN h.chunk_index - 1 AND h.chunk_index + 1
), budgeted AS (
  SELECT e.*, SUM(token_count) OVER (ORDER BY dist, source_id, chunk_index) AS running_tokens
  FROM expanded e
)
SELECT string_agg(format('[%s #%s] %s', s.title, b.chunk_index, b.content), E'\\n\\n'
                  ORDER BY b.source_id, b.chunk_index) AS prompt_context,
       SUM(b.token_count) AS tokens_used
FROM budgeted b
JOIN sources s ON s.id = b.source_id
WHERE b.running_tokens <= 60;            -- context budget for the LLM`,
      explain: 'Small chunks retrieve precisely, but the LLM answers better with surrounding context, so each hit is expanded to its neighbours (chunk_index plus or minus 1). A running SUM of token_count, ordered by relevance, enforces the context budget: the most relevant chunks are kept first. The final string_agg orders by position so the text reads naturally, and the [title #chunk] labels let the model cite sources.'
    },
    {
      title: 'Retrieval quality dashboard from logged citations and feedback',
      sql: `SELECT s.title,
       COUNT(*)                                  AS times_retrieved,
       COUNT(*) FILTER (WHERE r.cited)           AS times_cited,
       ROUND(100.0 * COUNT(*) FILTER (WHERE r.cited) / COUNT(*), 1) AS cite_rate_pct,
       ROUND(AVG(r.score)::numeric, 3)           AS avg_score,
       COUNT(*) FILTER (WHERE r.helpful IS FALSE) AS thumbs_down
FROM retrievals r
JOIN chunks c  ON c.id = r.chunk_id
JOIN sources s ON s.id = c.source_id
GROUP BY s.title
ORDER BY times_retrieved DESC, s.title;`,
      explain: 'Logging (answer, chunk, rank, score, cited, helpful) turns RAG from guesswork into something measurable: sources that are retrieved often but rarely cited are noise (bad chunking or misleading text), low-score retrievals that still get cited suggest the similarity threshold is too strict. The billing refund chunk retrieved for a leave question with score 0.12 is a typical irrelevant neighbour that a minimum-similarity cut-off would remove.'
    },
    {
      title: 'Find near-duplicate chunks (deduplicate the knowledge base)',
      sql: `SELECT a.id AS chunk_a, b.id AS chunk_b,
       round((a.embedding <=> b.embedding)::numeric, 4) AS distance,
       left(a.content, 45) AS a_preview, left(b.content, 45) AS b_preview
FROM chunks a
JOIN LATERAL (
  SELECT b.id, b.embedding, b.content
  FROM chunks b
  WHERE b.id > a.id
  ORDER BY a.embedding <=> b.embedding
  LIMIT 1
) b ON true
WHERE (a.embedding <=> b.embedding) < 0.001
ORDER BY distance;`,
      explain: 'For each chunk, a LATERAL top-1 nearest-neighbour lookup (index-assisted on large tables) finds its closest other chunk; pairs under a tight distance threshold are likely duplicates (the same paragraph copied into two documents). Duplicates waste context tokens and crowd out diverse results. b.id greater than a.id avoids reporting each pair twice. The threshold must be tuned per embedding model.'
    }
  ],
  transactions: `-- Atomic re-ingestion of a changed source. Embeddings are computed BEFORE the
-- transaction (calling the embedding API inside it would hold locks for seconds).
BEGIN;

-- 1. Serialise concurrent ingests of the same source and check whether content changed.
SELECT id, content_hash FROM sources WHERE uri = 'kb://hr/leave-policy' FOR UPDATE;
-- application: if content_hash = new hash => ROLLBACK (nothing to do)

-- 2. Replace chunks. Readers keep seeing the OLD chunks (MVCC) until COMMIT,
--    then see only the NEW ones: never a half-updated document.
DELETE FROM chunks WHERE source_id = 3;

INSERT INTO chunks (source_id, chunk_index, content, token_count, metadata, embedding) VALUES
 (3, 0, 'Employees receive 24 days of earned leave and 12 days of casual leave per calendar year.', 19, '{"section":"entitlement"}', '[0.00, 0.05, 0.97, 0.05]'),
 (3, 1, 'Unused earned leave up to 45 days can be carried forward to the next year.',               17, '{"section":"carry-forward"}', '[0.00, 0.10, 0.93, 0.00]'),
 (3, 2, 'Employees may take 26 weeks of maternity leave and 15 days of paternity leave.',             17, '{"section":"parental"}', '[0.00, 0.03, 0.96, 0.02]');

UPDATE sources SET content_hash = 'h-leave-2', version = version + 1, ingested_at = now()
WHERE id = 3;

COMMIT;
-- Note: ON DELETE CASCADE also removes retrieval logs of the old chunks. If evaluation
-- history must survive re-ingestion, soft-version chunks (valid_to) instead of deleting.`,
  optimization: `<h4>Hotspots</h4>
<ul>
<li><strong>Index memory</strong>: an HNSW index should fit in RAM. 10M x 1536-dim float4 vectors are about 61 GB of raw vectors before graph overhead. Reduce with <code>halfvec</code> (16-bit floats, half the size), fewer dimensions (models that support shortened embeddings), or binary quantization (<code>binary_quantize()</code> + Hamming distance) with re-ranking on the full vectors.</li>
<li><strong>Index builds</strong> are CPU and memory heavy: raise <code>maintenance_work_mem</code> so the graph fits in memory during build, use <code>max_parallel_maintenance_workers</code> (pgvector supports parallel HNSW builds), and bulk-load data before creating the index.</li>
<li><strong>Recall vs latency</strong>: tune <code>hnsw.ef_search</code> (default 40) per query; measure recall against exact search (<code>SET enable_indexscan = off</code> on a sample) rather than guessing.</li>
</ul>
<h4>Partitioning <span class="tag core">core</span> + <span class="tag ext">extension</span></h4>
<p>Partition <code>chunks</code> by tenant or access group (list/hash). Each partition gets its own smaller HNSW index, so a tenant-filtered query searches only its graph: better recall than one giant index with a post-filter, and dropping a tenant is <code>DROP TABLE</code>. Partial HNSW indexes (<code>WHERE source_type = 'policy'</code>) serve a few very common filters.</p>
<h4>At 100x scale</h4>
<ul>
<li>Keep PostgreSQL as the source of truth (text, metadata, permissions, embeddings) and scale reads with replicas; ANN queries are read-only and parallelise well across replicas.</li>
<li>Shard by tenant (e.g. <span class="tag ext">extension</span> Citus) when a single node's RAM cannot hold the indexes.</li>
<li>Track the embedding model in the schema (<code>embedding_model</code> column or one table/column per model): changing models requires re-embedding everything, and vectors from different models are not comparable.</li>
</ul>`,
  advanced: `<h4>Choosing the distance operator</h4>
<ul>
<li>Cosine (<code>&lt;=&gt;</code>, <code>vector_cosine_ops</code>) is the default for text embeddings. If vectors are normalised to length 1, inner product (<code>&lt;#&gt;</code>, <code>vector_ip_ops</code>) gives the same order and is slightly faster. L2 (<code>&lt;-&gt;</code>, <code>vector_l2_ops</code>) suits image/feature vectors.</li>
<li>An index only accelerates the operator of its operator class: a cosine index does nothing for an L2 query.</li>
</ul>
<h4>HNSW vs IVFFlat</h4>
<table>
<tr><th></th><th>HNSW</th><th>IVFFlat</th></tr>
<tr><td>Build</td><td>Slower, more memory; can be built on an empty table</td><td>Faster; needs data present to train <code>lists</code> centroids</td></tr>
<tr><td>Query tuning</td><td><code>hnsw.ef_search</code></td><td><code>ivfflat.probes</code></td></tr>
<tr><td>Recall after many inserts</td><td>Stays good</td><td>Degrades as data drifts; rebuild periodically</td></tr>
</table>
<h4>Chunking matters more than the index</h4>
<p>Typical chunks are 200-800 tokens with 10-20% overlap, split on headings/paragraphs rather than fixed character counts. Store <code>chunk_index</code> so neighbours can be fetched, and metadata (section, page) for citations and filters.</p>
<div class="callout warn">Approximate indexes can silently return different results than exact search. Always keep an evaluation set (questions + expected chunks) and check recall@k after changing <code>m</code>, <code>ef_construction</code>, <code>ef_search</code>, quantization or the embedding model.</div>`
});

/* =====================================================================
   SYSTEM DESIGN — database design interview problems
   ===================================================================== */
PGM.SYSTEM_DESIGN = [

/* ------------------------------------------------------------------ UBER */
{
  id: 'uber',
  title: 'Design Uber\'s database',
  requirements: {
    functional: [
      'Riders request a ride with pickup/drop-off; the system matches the nearest available driver.',
      'Drivers stream their GPS location every ~4 seconds while online.',
      'A trip moves through a strict state machine: requested, accepted, arriving, in_progress, completed / cancelled.',
      'Fare is quoted up-front (distance, time, surge multiplier) and charged at the end; riders and drivers rate each other.',
      'Riders and drivers see their trip history and receipts.'
    ],
    nonFunctional: [
      'Matching latency under 1 s at p99; a driver can never be assigned two trips at once (strong consistency on assignment).',
      'Location ingestion of hundreds of thousands of writes per second; losing a few location pings is acceptable.',
      '99.99% availability for ride requests; a city outage must not affect other cities.',
      'Trip and payment records are durable and auditable for years (tax and dispute requirements).'
    ]
  },
  scale: `<ul>
<li>1M drivers online at peak, 1 ping / 4 s = <strong>250k location writes/s</strong> (about 50 bytes each = 12.5 MB/s, roughly 1 TB/day raw history).</li>
<li>20M trips/day = 230 trips/s average, roughly <strong>700-1,000 trips/s at peak</strong>; each trip produces about 10 state/event rows = 10k event writes/s.</li>
<li>Trip row about 1 KB: 20 GB/day, 7 TB/year for trips alone (plus events and payments).</li>
<li>Reads: rider app polls trip state / driver position about every 2 s during a trip: 1M concurrent trips = 500k reads/s, served from cache/streams, not the primary.</li>
</ul>`,
  entities: [
    { name: 'cities', desc: 'Operating regions; the unit of isolation and sharding.' },
    { name: 'riders / drivers', desc: 'Accounts; drivers have status (offline, available, on_trip) and a vehicle.' },
    { name: 'vehicles', desc: 'Car details and product type (auto, mini, sedan, XL).' },
    { name: 'driver_locations', desc: 'LATEST position per driver only (hot, overwritten); history goes to a time-series/log store.' },
    { name: 'trips', desc: 'One row per ride with state, fare quote, final fare and timestamps.' },
    { name: 'trip_events', desc: 'Append-only state transitions (audit, analytics, dispute resolution).' },
    { name: 'payments', desc: 'Charge attempts per trip with idempotency key and PSP reference.' },
    { name: 'ratings', desc: 'Two-way ratings, one per (trip, rater).' }
  ],
  relationships: [
    { from: 'drivers', to: 'cities', type: 'N:1', label: 'operates in' },
    { from: 'vehicles', to: 'drivers', type: 'N:1', label: 'driven by' },
    { from: 'driver_locations', to: 'drivers', type: '1:1', label: 'current position of' },
    { from: 'trips', to: 'riders', type: 'N:1', label: 'requested by' },
    { from: 'trips', to: 'drivers', type: 'N:1', label: 'served by' },
    { from: 'trip_events', to: 'trips', type: 'N:1', label: 'history of' },
    { from: 'payments', to: 'trips', type: 'N:1', label: 'charges' },
    { from: 'ratings', to: 'trips', type: 'N:1', label: 'rates' }
  ],
  tables: `CREATE TABLE cities (
  id        int PRIMARY KEY,
  name      text NOT NULL,
  timezone  text NOT NULL
);

CREATE TABLE riders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone       text NOT NULL UNIQUE,
  name        text NOT NULL,
  rating      numeric(3,2) NOT NULL DEFAULT 5.00
);

CREATE TABLE drivers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city_id     int  NOT NULL REFERENCES cities(id),
  phone       text NOT NULL UNIQUE,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'offline' CHECK (status IN ('offline','available','on_trip')),
  rating      numeric(3,2) NOT NULL DEFAULT 5.00
);

CREATE TABLE vehicles (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id    bigint NOT NULL REFERENCES drivers(id),
  plate        text NOT NULL UNIQUE,
  product      text NOT NULL CHECK (product IN ('auto','mini','sedan','xl')),
  is_active    boolean NOT NULL DEFAULT true
);

-- Latest position only: one row per driver, updated in place (HOT updates when no indexed
-- column changes). fillfactor leaves room on each page for those in-place updates.
CREATE TABLE driver_locations (
  driver_id   bigint PRIMARY KEY REFERENCES drivers(id),
  city_id     int    NOT NULL,
  cell_id     text   NOT NULL,              -- geohash / H3 cell for coarse proximity search
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  heading     smallint,
  updated_at  timestamptz NOT NULL
) WITH (fillfactor = 70);

CREATE TABLE trips (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city_id         int    NOT NULL REFERENCES cities(id),
  rider_id        bigint NOT NULL REFERENCES riders(id),
  driver_id       bigint REFERENCES drivers(id),
  product         text   NOT NULL,
  status          text   NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','accepted','arriving','in_progress','completed','cancelled')),
  pickup_lat      double precision NOT NULL,
  pickup_lng      double precision NOT NULL,
  drop_lat        double precision NOT NULL,
  drop_lng        double precision NOT NULL,
  surge           numeric(4,2) NOT NULL DEFAULT 1.00,
  quoted_fare     numeric(10,2) NOT NULL,
  final_fare      numeric(10,2),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  completed_at    timestamptz,
  CHECK (status = 'requested' OR status = 'cancelled' OR driver_id IS NOT NULL)
);

CREATE TABLE trip_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id     bigint NOT NULL REFERENCES trips(id),
  from_status text,
  to_status   text NOT NULL,
  actor       text NOT NULL CHECK (actor IN ('rider','driver','system')),
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id          bigint NOT NULL REFERENCES trips(id),
  idempotency_key  uuid   NOT NULL UNIQUE,
  amount           numeric(10,2) NOT NULL CHECK (amount > 0),
  method           text   NOT NULL,
  status           text   NOT NULL CHECK (status IN ('pending','succeeded','failed','refunded')),
  psp_reference    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ratings (
  trip_id   bigint NOT NULL REFERENCES trips(id),
  rater     text   NOT NULL CHECK (rater IN ('rider','driver')),
  stars     smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment   text,
  PRIMARY KEY (trip_id, rater)
);`,
  indexes: `-- A driver can be on at most ONE active trip: enforced by the database, not by luck.
CREATE UNIQUE INDEX uq_trips_active_driver ON trips (driver_id)
  WHERE status IN ('accepted','arriving','in_progress');

-- A rider cannot request two rides at the same time.
CREATE UNIQUE INDEX uq_trips_active_rider ON trips (rider_id)
  WHERE status IN ('requested','accepted','arriving','in_progress');

-- Candidate drivers near a pickup: same city + cell (+ neighbouring cells), freshest first.
CREATE INDEX idx_driver_loc_cell ON driver_locations (city_id, cell_id, updated_at DESC);

-- Trip history screens.
CREATE INDEX idx_trips_rider  ON trips (rider_id, requested_at DESC);
CREATE INDEX idx_trips_driver ON trips (driver_id, requested_at DESC);

-- Ops dashboard: unmatched requests per city (tiny partial index).
CREATE INDEX idx_trips_open ON trips (city_id, requested_at) WHERE status = 'requested';

CREATE INDEX idx_trip_events_trip ON trip_events (trip_id, at);
CREATE INDEX idx_payments_trip    ON payments (trip_id);`,
  transactions: `<p><strong>Driver accepts a trip</strong>: two drivers may tap "accept" on the same request within milliseconds, and one driver may receive several offers. Both races are resolved with conditional updates plus the partial unique index, with no long-held locks.</p>
<pre>BEGIN;
-- 1. Claim the trip only if it is still unassigned (0 rows = someone else won).
UPDATE trips
SET driver_id = 42, status = 'accepted', accepted_at = now()
WHERE id = 9001 AND status = 'requested'
RETURNING id;

-- 2. Claim the driver only if still available (guards against double offers).
UPDATE drivers SET status = 'on_trip'
WHERE id = 42 AND status = 'available'
RETURNING id;
-- application: if either UPDATE returned 0 rows =&gt; ROLLBACK and tell the driver "trip taken"

INSERT INTO trip_events (trip_id, from_status, to_status, actor)
VALUES (9001, 'requested', 'accepted', 'driver');
COMMIT;</pre>
<p>Even if application logic is buggy, <code>uq_trips_active_driver</code> makes a second active trip for driver 42 fail with a unique violation. Under READ COMMITTED a concurrent UPDATE on the same trip row waits for the first transaction, then re-checks <code>status = 'requested'</code> on the new row version and updates nothing: exactly one winner.</p>
<p><strong>Location pings</strong> are NOT transactions worth protecting: batch them (one multi-row <code>INSERT ... ON CONFLICT (driver_id) DO UPDATE</code> every second per gateway) and consider <code>synchronous_commit = off</code> for that session, which risks losing the last fraction of a second of pings on a crash but never corrupts data.</p>`,
  scaling: `<ul>
<li><strong>Separate hot and cold data</strong>: the live geo index (driver positions) usually lives in memory (Redis with geo commands or an in-memory H3 grid service); PostgreSQL holds the latest position for recovery plus trips, payments and ratings.</li>
<li><strong>Matching reads</strong> (nearby drivers) go to the in-memory index; the assignment write (above) goes to the primary of the city shard.</li>
<li><strong>Read replicas</strong> serve trip history, receipts and support tools. Trip state polling during a ride uses push (websocket) fed by trip_events, not polling the DB.</li>
<li><strong>Connection pooling</strong> with <span class="tag tool">third-party tool</span> PgBouncer (transaction mode): tens of thousands of service instances, a few hundred server connections.</li>
<li>Geospatial queries in SQL: <span class="tag ext">extension</span> PostGIS (<code>geography</code>, GiST index, <code>ST_DWithin</code>, KNN <code>&lt;-&gt;</code>) is the right tool when the DB itself must answer "drivers within 2 km".</li>
</ul>`,
  partitioning: `<ul>
<li><code>trips</code>: range-partition by <code>requested_at</code> (monthly). Recent months are hot; old partitions move to cheaper storage and are detached for archiving after the retention period.</li>
<li><code>trip_events</code> and payments: same monthly scheme, so a month can be dropped/archived as a unit.</li>
<li>Location <em>history</em> (1 TB/day) does not belong in an OLTP table at all: stream it to Kafka and a time-series store/data lake; if kept in PostgreSQL, use daily partitions and drop after N days.</li>
<li>Remember: a primary key/unique index on a partitioned table must include the partition key, so the active-trip unique index must be maintained per partition (fine: active trips are always in the current partition) or enforced on the driver row.</li>
</ul>`,
  replication: `<ul>
<li>Each city shard: one primary + synchronous standby in another availability zone (<code>synchronous_standby_names</code>) so an accepted trip is never lost on failover, plus async read replicas for history.</li>
<li>Failover orchestration with <span class="tag tool">third-party tool</span> Patroni (etcd/Consul consensus) and a virtual IP / HAProxy in front.</li>
<li>Logical replication / CDC (Debezium) streams trips and payments to the analytics warehouse and to the fraud/ETA ML pipelines without load on the primary.</li>
</ul>`,
  sharding: `<p><strong>Shard key: city_id (geographic region).</strong></p>
<ul>
<li>Almost every hot operation is local: a rider in Mumbai is matched with a driver in Mumbai, and the trip, events and payment for it live together. Assignment transactions never cross shards.</li>
<li>Failure isolation: a bad deploy or overloaded shard affects one region, not the world.</li>
<li>Cross-shard needs (a rider's lifetime trip history across cities, global fraud checks) are served by a separate rider-keyed history store fed by CDC, accepting seconds of lag.</li>
<li>Hot cities (Bengaluru on a rainy Friday) can be split further by zone within the city; the shard map lives in a small, highly cached directory service.</li>
</ul>`,
  failures: `<ul>
<li><strong>Primary fails mid-assignment</strong>: the transaction either committed (driver sees the trip after reconnect) or did not (offer expires, rider is re-matched). Clients must re-read trip state after reconnect, never assume.</li>
<li><strong>Driver app loses network</strong>: location goes stale; matching ignores drivers whose <code>updated_at</code> is older than ~15 s.</li>
<li><strong>Payment provider timeout</strong>: retry with the same <code>idempotency_key</code>; trip completion is not blocked on payment; a background job settles pending payments.</li>
<li><strong>Stuck trips</strong> (driver accepted then vanished): a sweeper cancels <code>accepted</code> trips without progress after N minutes and frees the driver.</li>
<li><strong>Replica lag</strong>: never use a replica to decide availability or assignment.</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Latest-position table vs location history</strong>: overwriting one row per driver keeps the hot table tiny and cache-resident; history is a different workload (append-only, huge) and gets a different store.</li>
<li><strong>Strong consistency only where it matters</strong>: assignment and payment are strongly consistent on one shard primary; positions, ETAs, and history are eventually consistent.</li>
<li><strong>Sharding by city</strong> makes cross-city queries harder, but those are rare and analytical; the alternative (rider_id) would split every trip from the drivers who serve it.</li>
<li><strong>In-memory geo index vs PostGIS</strong>: PostGIS is simpler and transactional; an in-memory grid handles 250k updates/s with lower latency. Many designs use both: memory for matching, PostgreSQL for truth.</li>
</ul>`
},

/* ------------------------------------------------------------------ AMAZON */
{
  id: 'amazon',
  title: 'Design Amazon\'s database (e-commerce marketplace)',
  requirements: {
    functional: [
      'Catalog of hundreds of millions of products; many sellers can offer the same product at different prices (offers).',
      'Customers search, add to cart, check out, pay, and track shipments; orders may contain items from several sellers and warehouses.',
      'Inventory per warehouse; checkout must never sell stock that does not exist (no overselling), including during flash sales.',
      'Orders keep a price snapshot; cancellations and returns release or restock inventory.',
      'Downstream systems (email, warehouse, analytics) react to order events reliably.'
    ],
    nonFunctional: [
      'Catalog/product pages: very read-heavy (100:1), p99 under 100 ms, tolerate seconds of staleness.',
      'Checkout: strongly consistent, idempotent (double clicks and retries must not create two orders), highly available.',
      'Peak events (Prime Day, Big Billion Days) at 10-20x normal load.',
      'Order history retained for years for returns, warranty and tax.'
    ]
  },
  scale: `<ul>
<li>300M customers, 500M products, 10M orders/day = 115 orders/s average, <strong>2,000+ orders/s at peak</strong>.</li>
<li>Product page views: 2B/day = 23k/s average, 200k+/s at peak (served from caches/CDN and search indexes).</li>
<li>Order + items + payment + shipment rows: about 5 KB per order = 50 GB/day, about 18 TB/year.</li>
<li>Inventory updates: every order line reserves stock, plus warehouse receipts: roughly 10k writes/s at peak, heavily skewed to hot SKUs.</li>
</ul>`,
  entities: [
    { name: 'customers / addresses', desc: 'Buyer accounts and shipping addresses.' },
    { name: 'products', desc: 'Catalog entries (ASIN-like id), title, brand, category, JSONB attributes.' },
    { name: 'sellers / offers', desc: 'Marketplace sellers and their price/condition for a product.' },
    { name: 'inventory', desc: 'Stock per (offer, warehouse): on_hand and reserved.' },
    { name: 'carts / cart_items', desc: 'Per-customer cart (often kept in a key-value store).' },
    { name: 'orders / order_items', desc: 'Order header with idempotency key; lines with price snapshot, seller and warehouse.' },
    { name: 'payments / shipments', desc: 'Payment attempts and per-warehouse shipments with tracking.' },
    { name: 'outbox_events', desc: 'Transactional outbox for reliable event publishing.' }
  ],
  relationships: [
    { from: 'offers', to: 'products', type: 'N:1', label: 'sells' },
    { from: 'offers', to: 'sellers', type: 'N:1', label: 'listed by' },
    { from: 'inventory', to: 'offers', type: 'N:1', label: 'stock of' },
    { from: 'orders', to: 'customers', type: 'N:1', label: 'placed by' },
    { from: 'order_items', to: 'orders', type: 'N:1', label: 'line of' },
    { from: 'order_items', to: 'offers', type: 'N:1', label: 'buys' },
    { from: 'payments', to: 'orders', type: 'N:1', label: 'pays' },
    { from: 'shipments', to: 'orders', type: 'N:1', label: 'fulfils' }
  ],
  tables: `CREATE TABLE customers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asin        char(10) NOT NULL UNIQUE,
  title       text NOT NULL,
  brand       text,
  category    text NOT NULL,
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE sellers (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL,
  gstin text UNIQUE
);

CREATE TABLE offers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES products(id),
  seller_id   bigint NOT NULL REFERENCES sellers(id),
  price       numeric(12,2) NOT NULL CHECK (price > 0),
  condition   text NOT NULL DEFAULT 'new' CHECK (condition IN ('new','refurbished','used')),
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (product_id, seller_id, condition)
);

CREATE TABLE inventory (
  offer_id      bigint NOT NULL REFERENCES offers(id),
  warehouse_id  int    NOT NULL,
  on_hand       int    NOT NULL CHECK (on_hand >= 0),
  reserved      int    NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  PRIMARY KEY (offer_id, warehouse_id),
  CHECK (reserved <= on_hand)                -- the anti-oversell invariant
);

CREATE TABLE orders (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id      bigint NOT NULL REFERENCES customers(id),
  idempotency_key  uuid   NOT NULL UNIQUE,   -- one checkout click = one order, however many retries
  status           text   NOT NULL DEFAULT 'pending_payment'
                   CHECK (status IN ('pending_payment','paid','shipped','delivered','cancelled','returned')),
  total_amount     numeric(12,2) NOT NULL,
  ship_address     jsonb  NOT NULL,          -- snapshot, not a FK: addresses change later
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id      bigint NOT NULL REFERENCES orders(id),
  line_no       smallint NOT NULL,
  offer_id      bigint NOT NULL REFERENCES offers(id),
  warehouse_id  int    NOT NULL,
  quantity      int    NOT NULL CHECK (quantity > 0),
  unit_price    numeric(12,2) NOT NULL,      -- price snapshot at purchase time
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE payments (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id       bigint NOT NULL REFERENCES orders(id),
  amount         numeric(12,2) NOT NULL,
  status         text NOT NULL CHECK (status IN ('initiated','authorized','captured','failed','refunded')),
  psp_reference  text UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shipments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      bigint NOT NULL REFERENCES orders(id),
  warehouse_id  int    NOT NULL,
  carrier       text,
  tracking_no   text UNIQUE,
  status        text NOT NULL DEFAULT 'created' CHECK (status IN ('created','packed','in_transit','delivered','returned')),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_id  bigint NOT NULL,
  event_type    text   NOT NULL,
  payload       jsonb  NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);`,
  indexes: `CREATE INDEX idx_orders_customer     ON orders (customer_id, created_at DESC);   -- "Your orders"
CREATE INDEX idx_offers_product       ON offers (product_id, price) WHERE is_active; -- buy box: cheapest active offers
CREATE INDEX idx_order_items_offer    ON order_items (offer_id);
CREATE INDEX idx_payments_order       ON payments (order_id);
CREATE INDEX idx_shipments_order      ON shipments (order_id);
CREATE INDEX idx_products_category    ON products (category);
CREATE INDEX idx_products_attrs       ON products USING gin (attributes jsonb_path_ops);
-- Outbox relay polls only unpublished events: tiny partial index.
CREATE INDEX idx_outbox_unpublished   ON outbox_events (id) WHERE published_at IS NULL;`,
  transactions: `<p><strong>Checkout</strong>: reserve stock, create the order with a price snapshot, and enqueue an event, all in one transaction. Idempotent and oversell-proof.</p>
<pre>BEGIN;
-- 1. Idempotency: a retried click returns the existing order.
INSERT INTO orders (customer_id, idempotency_key, total_amount, ship_address)
VALUES (77, 'b1c2d3e4-0000-4000-8000-00000000abcd', 2598.00, '{"city":"Pune","pincode":"411001"}')
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;          -- no row =&gt; already placed: SELECT it and return

-- 2. Reserve each line with a guarded UPDATE (no read-then-write race).
UPDATE inventory
SET reserved = reserved + 2
WHERE offer_id = 501 AND warehouse_id = 3
  AND on_hand - reserved &gt;= 2
RETURNING offer_id;    -- 0 rows =&gt; out of stock: ROLLBACK, show "only N left"

INSERT INTO order_items (order_id, line_no, offer_id, warehouse_id, quantity, unit_price)
VALUES (currval(pg_get_serial_sequence('orders','id')), 1, 501, 3, 2, 1299.00);

-- 3. Transactional outbox: the event is committed atomically with the order.
INSERT INTO outbox_events (aggregate_id, event_type, payload)
VALUES (currval(pg_get_serial_sequence('orders','id')), 'OrderPlaced', '{"lines":1}');
COMMIT;</pre>
<p>Lock ordering: when an order has several lines, update inventory rows in a fixed order (by offer_id, warehouse_id) so two carts with the same SKUs cannot deadlock. The CHECK <code>reserved &lt;= on_hand</code> is a last line of defence if any code path forgets the guard. Payment happens after the commit; an unpaid order's reservation is released by a timeout job.</p>`,
  scaling: `<ul>
<li><strong>Split by bounded context</strong>: catalog, inventory, orders, payments and customers are separate services with separate databases (Amazon itself moved from a monolithic Oracle to service-owned stores). No cross-service joins; services exchange events via the outbox.</li>
<li><strong>Catalog</strong> is read-mostly: serve product pages from caches and a search engine (OpenSearch/Elasticsearch) fed by CDC; PostgreSQL remains the system of record with read replicas.</li>
<li><strong>Carts</strong> are high-write, low-value per write: often a key-value store (DynamoDB-style) rather than the relational core.</li>
<li><strong>Hot SKUs in flash sales</strong>: split stock into N inventory "buckets" rows per SKU and reserve from a random bucket, or pre-allocate stock into a queue/token system so the DB sees smoothed load.</li>
</ul>`,
  partitioning: `<ul>
<li><code>orders</code>, <code>order_items</code>, <code>payments</code>, <code>shipments</code>: range-partition by <code>created_at</code> monthly; queries for "recent orders" prune to the newest partitions; years-old partitions are archived but still queryable for returns/warranty.</li>
<li><code>outbox_events</code>: daily partitions, dropped once published and past replay retention; much cheaper than DELETE + vacuum.</li>
<li>Catalog <code>products</code>: hash-partition by id only when a single table becomes operationally painful (vacuum/index rebuild time).</li>
</ul>`,
  replication: `<ul>
<li>Order and inventory databases: synchronous standby in another AZ (zero data loss on failover) plus async replicas for order history pages.</li>
<li>Read-your-writes after checkout: route the "order confirmation" page to the primary (or wait until the replica has replayed the commit LSN) to avoid "order not found" right after purchase.</li>
<li>Logical replication / CDC feeds search, recommendations and the data warehouse.</li>
</ul>`,
  sharding: `<ul>
<li><strong>Orders: shard key customer_id.</strong> "My orders", checkout and returns for one customer hit one shard; the order id embeds the shard id (or a lookup table maps order to shard) so seller/warehouse services can find it.</li>
<li><strong>Inventory: shard key offer_id / SKU (or warehouse_id).</strong> Reservations for a SKU are serialised on its own shard. Checkout with lines on several inventory shards uses a saga: reserve per shard, compensate (release) on failure, because a distributed 2PC across shards would hurt availability.</li>
<li><strong>Seller views</strong> ("orders containing my products") are built asynchronously into a seller-keyed read model from order events.</li>
</ul>`,
  failures: `<ul>
<li><strong>Client retry / double click</strong>: absorbed by the unique idempotency key.</li>
<li><strong>Crash after commit but before event publish</strong>: the outbox row is durable; the relay publishes it later (at-least-once; consumers deduplicate by event id).</li>
<li><strong>Payment succeeds but response is lost</strong>: payment service is idempotent per order; a reconciliation job matches PSP settlements to orders.</li>
<li><strong>Abandoned reservations</strong>: a job releases <code>reserved</code> for orders still <code>pending_payment</code> after 15-30 minutes.</li>
<li><strong>Inventory shard down</strong>: checkout for those SKUs fails fast; the rest of the store keeps selling (bulkheads).</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Reserve at checkout vs at add-to-cart</strong>: reserving at add-to-cart blocks stock for window-shoppers; reserving at checkout risks "sold out" at the last step. Most marketplaces reserve at checkout with a short payment window.</li>
<li><strong>Price snapshot</strong> duplicates data deliberately; historical correctness beats normalisation.</li>
<li><strong>Microservice databases</strong> remove cross-domain transactions; consistency between orders, payments and inventory becomes eventual and needs sagas, idempotency and reconciliation.</li>
<li><strong>JSONB attributes</strong> handle millions of category-specific attributes without thousands of columns, at the cost of weaker typing; validate per category in the application or with CHECK constraints on key fields.</li>
</ul>`
},

/* ------------------------------------------------------------------ INSTAGRAM */
{
  id: 'instagram',
  title: 'Design Instagram\'s database',
  requirements: {
    functional: [
      'Users upload photos/videos with captions and hashtags; media files go to object storage/CDN.',
      'Users follow other users (asymmetric graph); the home feed shows recent posts from followed accounts, newest/most relevant first.',
      'Users like and comment on posts; posts show like and comment counts.',
      'Profile pages list a user\'s posts in a grid with follower/following counts; hashtag pages list posts with a tag.'
    ],
    nonFunctional: [
      'Extremely read-heavy: feed and profile reads outnumber writes about 100:1; feed p99 under 200 ms.',
      'Celebrity accounts have 100M+ followers; a post by them must not melt the write path.',
      'Counts (likes, followers) may be approximately and eventually consistent; a like itself must never be lost or doubled.',
      'Globally available; media durability is paramount.'
    ]
  },
  scale: `<ul>
<li>500M daily active users, 100M new posts/day = <strong>1,200 posts/s</strong> average; 4B likes/day = <strong>46k likes/s</strong>.</li>
<li>Feed reads: 500M users x 10 refreshes/day = 5B/day, about <strong>60k feed reads/s</strong> (peaks 3x).</li>
<li>Post metadata about 500 bytes: 50 GB/day; likes about 30 bytes + index overhead: roughly 300 GB/day in the likes table alone; media itself is petabytes in object storage, not in the DB.</li>
<li>Follow graph: 500M users x 200 follows = 100B edges.</li>
</ul>`,
  entities: [
    { name: 'users', desc: 'Profile, handle, cached follower/following/post counts.' },
    { name: 'follows', desc: 'Directed edge follower to followee with created_at.' },
    { name: 'posts', desc: 'Caption, author, created_at, cached like/comment counts; time-sortable 64-bit id.' },
    { name: 'media', desc: 'One or more media objects per post (carousel): object key, type, dimensions.' },
    { name: 'likes', desc: 'One row per (post, user); the source of truth for like counts.' },
    { name: 'comments', desc: 'Comments on posts, newest/top ordering.' },
    { name: 'feed_items', desc: 'Pre-computed (fan-out-on-write) home timeline entries per user.' },
    { name: 'hashtags / post_hashtags', desc: 'Normalised tags for hashtag pages.' }
  ],
  relationships: [
    { from: 'follows', to: 'users', type: 'N:1', label: 'follower' },
    { from: 'follows', to: 'users', type: 'N:1', label: 'followee' },
    { from: 'posts', to: 'users', type: 'N:1', label: 'authored by' },
    { from: 'media', to: 'posts', type: 'N:1', label: 'belongs to' },
    { from: 'likes', to: 'posts', type: 'N:1', label: 'likes' },
    { from: 'comments', to: 'posts', type: 'N:1', label: 'comments on' },
    { from: 'feed_items', to: 'posts', type: 'N:1', label: 'shows' },
    { from: 'post_hashtags', to: 'hashtags', type: 'N:1', label: 'tagged' }
  ],
  tables: `CREATE TABLE users (
  id               bigint PRIMARY KEY,          -- generated by an id service (time + shard + sequence)
  handle           text NOT NULL UNIQUE,
  full_name        text,
  is_private       boolean NOT NULL DEFAULT false,
  follower_count   bigint NOT NULL DEFAULT 0,
  following_count  bigint NOT NULL DEFAULT 0,
  post_count       bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE follows (
  follower_id  bigint NOT NULL REFERENCES users(id),
  followee_id  bigint NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),        -- "whom do I follow"
  CHECK (follower_id <> followee_id)
);

CREATE TABLE posts (
  id             bigint PRIMARY KEY,             -- time-sortable: ORDER BY id = ORDER BY time
  author_id      bigint NOT NULL REFERENCES users(id),
  caption        text,
  like_count     bigint NOT NULL DEFAULT 0,
  comment_count  bigint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE media (
  post_id     bigint NOT NULL REFERENCES posts(id),
  position    smallint NOT NULL,
  object_key  text NOT NULL,                     -- CDN/object storage key
  media_type  text NOT NULL CHECK (media_type IN ('image','video')),
  width       int, height int,
  PRIMARY KEY (post_id, position)
);

CREATE TABLE likes (
  post_id     bigint NOT NULL REFERENCES posts(id),
  user_id     bigint NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)                 -- a user likes a post at most once
);

CREATE TABLE comments (
  id          bigint PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES posts(id),
  user_id     bigint NOT NULL REFERENCES users(id),
  body        text   NOT NULL CHECK (length(body) <= 2200),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fan-out-on-write timeline: written asynchronously by feed workers.
CREATE TABLE feed_items (
  user_id    bigint NOT NULL,                    -- the reader
  post_id    bigint NOT NULL,
  author_id  bigint NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE hashtags (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tag   text NOT NULL UNIQUE
);

CREATE TABLE post_hashtags (
  hashtag_id  bigint NOT NULL REFERENCES hashtags(id),
  post_id     bigint NOT NULL REFERENCES posts(id),
  PRIMARY KEY (hashtag_id, post_id)              -- hashtag page: newest posts by id
);`,
  indexes: `-- Followers of X (the reverse direction of the PK) for fan-out and follower lists.
CREATE INDEX idx_follows_followee ON follows (followee_id, follower_id);

-- Profile grid: an author's posts newest first (id is time-sortable).
CREATE INDEX idx_posts_author ON posts (author_id, id DESC) WHERE deleted_at IS NULL;

-- "Posts this user liked" (activity, GDPR export).
CREATE INDEX idx_likes_user ON likes (user_id, created_at DESC);

-- Comments under a post, newest first.
CREATE INDEX idx_comments_post ON comments (post_id, id DESC);

-- Home feed read: newest feed items of one reader. PK (user_id, post_id) already
-- supports ORDER BY post_id DESC via a backward index scan.`,
  transactions: `<p><strong>Like a post</strong>: exactly-once like, counter updated only when the like is new.</p>
<pre>BEGIN;
WITH ins AS (
  INSERT INTO likes (post_id, user_id) VALUES (7001, 55)
  ON CONFLICT DO NOTHING            -- double tap / retry: no duplicate
  RETURNING post_id
)
UPDATE posts SET like_count = like_count + 1
WHERE id IN (SELECT post_id FROM ins);
COMMIT;</pre>
<p>For celebrity posts, the counter UPDATE becomes a hot row (every like locks the same row and creates a new tuple version). Production fix: insert into <code>likes</code> only, and let a background job fold new likes into the counter every few seconds, or use sharded counters <code>post_counters(post_id, slot, n)</code> with a random slot per write and <code>SUM(n)</code> on read.</p>
<p><strong>Publish a post</strong>: insert <code>posts</code> + <code>media</code> + hashtags in one transaction, plus an outbox event. Feed fan-out (inserting into <code>feed_items</code> for each follower) runs asynchronously from that event; it is never part of the user's request transaction.</p>`,
  scaling: `<ul>
<li><strong>Hybrid feed</strong>: fan-out-on-write for normal authors (push post ids into followers' <code>feed_items</code> or Redis lists), fan-out-on-read for celebrities (merge their recent posts at read time). Writing 100M feed rows per celebrity post is not viable.</li>
<li><strong>Caching</strong>: post objects, counts and user profiles in Memcached/Redis; feed pages are mostly cache hits.</li>
<li><strong>Read replicas</strong> per shard for profile/post reads; writes (likes, posts, follows) go to shard primaries.</li>
<li><strong>Media</strong> in object storage + CDN; the database stores only keys and metadata.</li>
<li><strong>Ranking</strong>: the DB provides candidate posts; a ranking service orders them (ML), so SQL feeds are not "ORDER BY score" over billions of rows.</li>
</ul>`,
  partitioning: `<ul>
<li><code>likes</code> (largest table): hash-partition by <code>post_id</code> inside a shard so one post's likes are together; or range by time if old likes are rarely read.</li>
<li><code>feed_items</code>: keep only the newest N (for example 500) per user; trim with a background job. Range partitioning by time lets you drop whole old partitions instead of DELETEs.</li>
<li><code>posts</code> and <code>comments</code>: range by id (time) when per-shard tables become large; recent partitions are hot and cached.</li>
</ul>`,
  replication: `<ul>
<li>Each logical shard group: primary + standby (failover with <span class="tag tool">third-party tool</span> Patroni or managed equivalents) + read replicas.</li>
<li>Cross-region: async replicas in other regions for reads; writes for a user go to their home region. Accept replica lag for feeds and counts; read-your-own-writes for the author's own new post by reading the primary (or cache) for a few seconds after posting.</li>
</ul>`,
  sharding: `<p><strong>Shard key: user_id</strong> (author for posts, the user for their follows/likes/feed).</p>
<ul>
<li>Instagram publicly described running PostgreSQL with thousands of <em>logical shards</em> (schemas) mapped onto fewer physical servers, and 64-bit ids composed of 41 bits of milliseconds, 13 bits of logical shard id and 10 bits of sequence, generated inside PostgreSQL by a PL/pgSQL function. The id itself says which shard a post lives on, and ids sort by time.</li>
<li>Logical shards let you move a shard to a new server (rebalancing) without re-hashing data.</li>
<li><code>follows</code> is stored twice (by follower and by followee) so both "following" and "followers" lists are single-shard queries.</li>
<li><code>likes</code> sharded by post_id (with the post) answer "who liked this"; "what did I like" is a second copy keyed by user.</li>
</ul>`,
  failures: `<ul>
<li><strong>Fan-out backlog</strong> after a viral event: feeds become stale but correct; workers are idempotent (<code>ON CONFLICT DO NOTHING</code> on feed_items) so replays are safe.</li>
<li><strong>Counter drift</strong> (async counters, failed jobs): periodic repair job recomputes counts from <code>likes</code> for recently active posts.</li>
<li><strong>Shard primary failure</strong>: users on that shard cannot post or like for the failover window (seconds); reads continue from replicas and caches.</li>
<li><strong>Deleted posts</strong> remain in feed_items/caches: readers filter by <code>deleted_at</code> / cache invalidation event.</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Fan-out on write vs read</strong>: write amplification and storage vs read latency. Hybrid is the standard answer.</li>
<li><strong>Denormalised counters</strong> trade exactness for read speed; the likes table remains the truth.</li>
<li><strong>Duplicated edges</strong> (follows by both directions, likes by post and by user) double storage but keep every hot query single-shard.</li>
<li><strong>Relational store vs wide-column</strong> (Cassandra) for feeds/likes: PostgreSQL gives constraints and flexible queries; wide-column stores give cheaper massive write throughput. Many large social apps use both.</li>
</ul>`
},

/* ------------------------------------------------------------------ WHATSAPP */
{
  id: 'whatsapp',
  title: 'Design WhatsApp\'s database',
  requirements: {
    functional: [
      'One-to-one and group messaging (groups up to ~1,000 members) with text and media.',
      'Message states: sent (server received), delivered (to each recipient device), read; shown as ticks.',
      'Offline recipients receive messages when they reconnect, in order, exactly once from the user\'s point of view.',
      'Multi-device: a user may have a phone plus up to 4 linked devices; each device receives its own copy.',
      'End-to-end encryption: the server stores and forwards ciphertext only.'
    ],
    nonFunctional: [
      'Very high write throughput, low latency (under 200 ms server-side for online recipients).',
      'Messages are durable until delivered to every device, then may be deleted from the server (store-and-forward).',
      'Per-conversation ordering; no global ordering needed.',
      'Survive data-center failures without losing acknowledged messages.'
    ]
  },
  scale: `<ul>
<li>2B users, 100B messages/day = <strong>1.2M messages/s</strong> average, 3M/s at peaks (New Year).</li>
<li>Average fan-out (devices x group members) about 3: roughly <strong>3.5M device deliveries/s</strong>, each with a delivery ack and often a read receipt.</li>
<li>Ciphertext about 300 bytes average (media is uploaded separately to blob storage): 30 TB/day of message payload in transit, but most is deleted after delivery within seconds/minutes, so the live queue is small.</li>
</ul>`,
  entities: [
    { name: 'users / devices', desc: 'Phone-number accounts and their registered devices (with public identity keys).' },
    { name: 'conversations', desc: 'Direct or group; for groups, a membership list and version.' },
    { name: 'group_members', desc: 'Members and admins of a group.' },
    { name: 'messages', desc: 'Envelope metadata: id, conversation, sender, server timestamp, per-conversation sequence.' },
    { name: 'pending_deliveries', desc: 'Store-and-forward queue: one row per (recipient device, message) with the device-specific ciphertext, deleted on ack.' },
    { name: 'receipts', desc: 'Delivered/read state per recipient for the sender\'s ticks.' }
  ],
  relationships: [
    { from: 'devices', to: 'users', type: 'N:1', label: 'belongs to' },
    { from: 'group_members', to: 'conversations', type: 'N:1', label: 'member of' },
    { from: 'messages', to: 'conversations', type: 'N:1', label: 'in' },
    { from: 'pending_deliveries', to: 'devices', type: 'N:1', label: 'queued for' },
    { from: 'pending_deliveries', to: 'messages', type: 'N:1', label: 'copy of' },
    { from: 'receipts', to: 'messages', type: 'N:1', label: 'status of' }
  ],
  tables: `CREATE TABLE users (
  id          bigint PRIMARY KEY,
  phone_e164  text NOT NULL UNIQUE CHECK (phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  user_id       bigint   NOT NULL REFERENCES users(id),
  device_no     smallint NOT NULL,              -- 0 = primary phone, 1-4 linked devices
  identity_key  bytea    NOT NULL,              -- public key for E2EE sessions
  last_seen_at  timestamptz,
  PRIMARY KEY (user_id, device_no)
);

CREATE TABLE conversations (
  id          bigint PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('direct','group')),
  next_seq    bigint NOT NULL DEFAULT 1,        -- per-conversation ordering
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  conversation_id  bigint NOT NULL REFERENCES conversations(id),
  user_id          bigint NOT NULL REFERENCES users(id),
  is_admin         boolean NOT NULL DEFAULT false,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  conversation_id  bigint NOT NULL,
  seq              bigint NOT NULL,             -- order within the conversation
  message_id       uuid   NOT NULL UNIQUE,      -- client-generated: dedupes resends
  sender_id        bigint NOT NULL,
  sender_device    smallint NOT NULL,
  server_ts        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq)
);

-- The store-and-forward queue: rows exist only until the device acks.
CREATE TABLE pending_deliveries (
  user_id          bigint   NOT NULL,
  device_no        smallint NOT NULL,
  conversation_id  bigint   NOT NULL,
  seq              bigint   NOT NULL,
  ciphertext       bytea    NOT NULL,           -- encrypted separately for each device
  enqueued_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_no, conversation_id, seq)
);

CREATE TABLE receipts (
  conversation_id  bigint NOT NULL,
  seq              bigint NOT NULL,
  recipient_id     bigint NOT NULL,
  delivered_at     timestamptz,
  read_at          timestamptz,
  PRIMARY KEY (conversation_id, seq, recipient_id)
);`,
  indexes: `-- Device reconnect: drain my queue in order (PK prefix user_id, device_no serves it).
-- Expiry sweeper: messages undelivered for 30 days are dropped.
CREATE INDEX idx_pending_age ON pending_deliveries (enqueued_at);

-- "Which groups am I in" on login / contact sync.
CREATE INDEX idx_group_members_user ON group_members (user_id);

-- Sender's outbox view of ticks: receipts for my recent messages.
CREATE INDEX idx_messages_sender ON messages (sender_id, server_ts DESC);`,
  transactions: `<p><strong>Accept a message from a sender</strong> (one transaction on the conversation's shard): assign the next sequence number, store the envelope, enqueue one ciphertext per recipient device.</p>
<pre>BEGIN;
-- 1. Per-conversation sequence: row lock on the conversation serialises senders in this chat only.
UPDATE conversations SET next_seq = next_seq + 1
WHERE id = 31 RETURNING next_seq - 1 AS seq;          -- e.g. 1042

-- 2. Envelope; a client resend with the same message_id is a no-op.
INSERT INTO messages (conversation_id, seq, message_id, sender_id, sender_device)
VALUES (31, 1042, '0b7d1c9e-2f3a-4b5c-8d6e-7f8091a2b3c4', 900, 0)
ON CONFLICT (message_id) DO NOTHING;

-- 3. Fan out to every recipient device (ciphertexts were produced by the sender's device).
INSERT INTO pending_deliveries (user_id, device_no, conversation_id, seq, ciphertext)
VALUES (901, 0, 31, 1042, '\\x8f3a...'::bytea),
       (901, 1, 31, 1042, '\\x1c77...'::bytea);
COMMIT;   -- only now does the sender get the single grey tick ("sent")</pre>
<p><strong>Device ack</strong>: <code>DELETE FROM pending_deliveries WHERE user_id = 901 AND device_no = 0 AND conversation_id = 31 AND seq &lt;= 1042 RETURNING seq;</code> then upsert <code>receipts.delivered_at</code> and notify the sender (double tick). Deletion after ack is what keeps the queue small: the server is a transit buffer, not an archive.</p>`,
  scaling: `<ul>
<li><strong>Connection layer</strong>: hundreds of millions of persistent connections terminate on chat servers (WhatsApp famously used Erlang/FreeBSD); online delivery goes server-to-server in memory, and the DB queue is the durable fallback for offline devices.</li>
<li><strong>Write path is append + delete</strong>: in PostgreSQL that means heavy vacuum work; tune autovacuum aggressively for the queue table (low scale factor, high cost limit) or partition by time and drop old partitions.</li>
<li>Large groups: fan-out happens on the server per recipient device; cap group size and use "sender keys" (encrypt once per group) to avoid encrypting per device.</li>
<li>Many large messaging systems use wide-column stores (Cassandra/HBase/ScyllaDB) for this exact queue workload; PostgreSQL works per shard with careful vacuum and partitioning.</li>
</ul>`,
  partitioning: `<ul>
<li><code>pending_deliveries</code>: range-partition by <code>enqueued_at</code> (hourly or daily). Delivered rows are deleted individually, and partitions older than the 30-day undelivered limit are dropped wholesale.</li>
<li><code>receipts</code> and <code>messages</code> envelopes: daily partitions with short retention (receipts are only needed until the sender's device has them).</li>
</ul>`,
  replication: `<ul>
<li>A message is acknowledged to the sender only after it is durable on two machines: synchronous replication (<code>synchronous_commit = on</code> with a synchronous standby) inside the region.</li>
<li>Cross-region async replicas for disaster recovery; on regional failover a few unacknowledged messages may be resent by clients (deduped by <code>message_id</code>).</li>
</ul>`,
  sharding: `<ul>
<li><strong>Queue shard key: recipient user_id.</strong> A reconnecting device drains one shard; all of its pending rows are in one place.</li>
<li><strong>Conversation/sequence shard key: conversation_id.</strong> The sequence counter for a chat lives on exactly one shard.</li>
<li>Sending to a recipient on another shard is therefore a cross-shard step: write the envelope on the conversation shard, then enqueue on the recipient shard via an internal durable message bus; the sender's tick is given once the conversation shard has committed and the fan-out is durably queued.</li>
</ul>`,
  failures: `<ul>
<li><strong>Sender retries after timeout</strong>: same <code>message_id</code>; dedupe on insert and on the recipient device.</li>
<li><strong>Device offline for 30+ days</strong>: queued messages expire (by design); the sender sees no double tick.</li>
<li><strong>Ack lost</strong>: device receives the message again; the client dedupes by (conversation_id, seq) / message_id.</li>
<li><strong>Shard failover</strong>: in-flight sends fail, clients resend; synchronous standby guarantees acknowledged messages survive.</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Store-and-forward vs server-side history</strong>: deleting after delivery minimises storage, privacy exposure and cost, but history/backup becomes the client's job (encrypted backups). Slack/Telegram-cloud-chat choose the opposite: server-side history and search.</li>
<li><strong>Per-device ciphertext</strong> multiplies writes by device count but is required for E2EE multi-device.</li>
<li><strong>Per-conversation sequence</strong> gives simple ordering and gap detection but serialises writes per chat (fine: a single chat rarely exceeds a few messages per second).</li>
</ul>`
},

/* ------------------------------------------------------------------ BANKING */
{
  id: 'banking',
  title: 'Design a core banking system database',
  requirements: {
    functional: [
      'Customers open accounts (savings, current, loan); each account has a currency and status.',
      'Deposits, withdrawals, internal transfers and incoming/outgoing interbank payments (NEFT/RTGS/IMPS/UPI).',
      'Holds (authorisations) reduce available balance before final posting, e.g. card authorisations.',
      'Statements with running balance; interest accrual at day end; regulatory reports.',
      'Every money movement is double-entry and auditable; nothing is ever updated in place or deleted.'
    ],
    nonFunctional: [
      'Correctness above all: no lost or duplicated money, no negative balances beyond limits, under any concurrency or failure.',
      'Strong consistency (serializable effects) for balance changes; RPO = 0 (no committed transaction lost).',
      'High availability (99.99%), with disaster recovery to another region.',
      'Retention of 8-10 years; tamper evidence for audit.'
    ]
  },
  scale: `<ul>
<li>50M customers, 80M accounts; 30M transactions/day = 350 TPS average, <strong>3,000-5,000 TPS at salary day / festival peaks</strong>.</li>
<li>Each transaction = 1 transfer row + 2+ ledger entries (about 400 bytes total with indexes): about 12 GB/day, 4.5 TB/year; 10-year retention = 45 TB of ledger.</li>
<li>Reads: balance checks and mini-statements about 10x writes; mostly served by the primary for balances (must be current) and replicas for statements.</li>
</ul>`,
  entities: [
    { name: 'customers', desc: 'KYC-verified individuals and businesses.' },
    { name: 'accounts', desc: 'Account number, product, currency, status, overdraft limit, cached ledger and available balances.' },
    { name: 'transactions', desc: 'Business operation (transfer, deposit, payment) with idempotency key and channel.' },
    { name: 'ledger_entries', desc: 'Immutable debit/credit lines; for each transaction, debits = credits.' },
    { name: 'holds', desc: 'Authorised-but-not-posted amounts that reduce available balance until captured or expired.' },
    { name: 'gl_accounts', desc: 'Internal general-ledger accounts (cash, suspense, interest expense, NEFT clearing).' }
  ],
  relationships: [
    { from: 'accounts', to: 'customers', type: 'N:1', label: 'owned by' },
    { from: 'ledger_entries', to: 'transactions', type: 'N:1', label: 'posted by' },
    { from: 'ledger_entries', to: 'accounts', type: 'N:1', label: 'affects' },
    { from: 'holds', to: 'accounts', type: 'N:1', label: 'blocks funds on' },
    { from: 'transactions', to: 'holds', type: '1:1', label: 'captures' }
  ],
  tables: `CREATE TABLE customers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cif         text NOT NULL UNIQUE,               -- customer information file number
  name        text NOT NULL,
  kyc_status  text NOT NULL CHECK (kyc_status IN ('pending','verified','expired'))
);

CREATE TABLE accounts (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_no         text NOT NULL UNIQUE,
  customer_id        bigint REFERENCES customers(id),   -- NULL for internal GL accounts
  kind               text NOT NULL CHECK (kind IN ('savings','current','loan','gl')),
  currency           char(3) NOT NULL DEFAULT 'INR',
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  overdraft_limit    numeric(18,2) NOT NULL DEFAULT 0,
  ledger_balance     numeric(18,2) NOT NULL DEFAULT 0,  -- sum of posted entries
  held_amount        numeric(18,2) NOT NULL DEFAULT 0 CHECK (held_amount >= 0),
  version            bigint NOT NULL DEFAULT 0,
  CHECK (kind = 'gl' OR ledger_balance - held_amount >= -overdraft_limit)  -- available >= -limit
);

CREATE TABLE transactions (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key  text   NOT NULL UNIQUE,
  kind             text   NOT NULL,                  -- transfer, neft_out, upi_in, interest ...
  channel          text   NOT NULL,                  -- branch, mobile, upi, batch
  amount           numeric(18,2) NOT NULL CHECK (amount > 0),
  currency         char(3) NOT NULL,
  status           text   NOT NULL CHECK (status IN ('posted','reversed','failed')),
  value_date       date   NOT NULL DEFAULT CURRENT_DATE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id  bigint NOT NULL REFERENCES transactions(id),
  account_id      bigint NOT NULL REFERENCES accounts(id),
  direction       char(1) NOT NULL CHECK (direction IN ('D','C')),
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  balance_after   numeric(18,2) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE holds (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   bigint NOT NULL REFERENCES accounts(id),
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  reason       text   NOT NULL,                      -- card auth, cheque clearing, lien
  status       text   NOT NULL DEFAULT 'active' CHECK (status IN ('active','captured','released','expired')),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);`,
  indexes: `-- Statement / mini-statement: entries of one account in posting order.
CREATE INDEX idx_ledger_account ON ledger_entries (account_id, id);
-- Balance-check per transaction (debits = credits) and drill-down.
CREATE INDEX idx_ledger_txn ON ledger_entries (transaction_id);
CREATE INDEX idx_accounts_customer ON accounts (customer_id);
-- Hold expiry sweeper: only active holds.
CREATE INDEX idx_holds_active ON holds (expires_at) WHERE status = 'active';
CREATE INDEX idx_holds_account ON holds (account_id) WHERE status = 'active';
CREATE INDEX idx_txn_value_date ON transactions (value_date);`,
  transactions: `<p><strong>Internal transfer</strong>: idempotent, deadlock-free, never overdraws, always balanced.</p>
<pre>BEGIN;
INSERT INTO transactions (idempotency_key, kind, channel, amount, currency, status)
VALUES ('mob-7f3e2a', 'transfer', 'mobile', 5000.00, 'INR', 'posted')
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;                        -- no row =&gt; duplicate request: return the original result

-- Lock both accounts in ascending id order: A-&gt;B and B-&gt;A cannot deadlock.
SELECT id FROM accounts WHERE id IN (101, 202) ORDER BY id FOR UPDATE;

UPDATE accounts SET ledger_balance = ledger_balance - 5000, version = version + 1
WHERE id = 101 AND status = 'active'
  AND ledger_balance - held_amount - 5000 &gt;= -overdraft_limit
RETURNING ledger_balance;            -- 0 rows =&gt; insufficient available balance: ROLLBACK

UPDATE accounts SET ledger_balance = ledger_balance + 5000, version = version + 1
WHERE id = 202 AND status = 'active'
RETURNING ledger_balance;

INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, balance_after)
VALUES (currval(pg_get_serial_sequence('transactions','id')), 101, 'D', 5000, 45000),
       (currval(pg_get_serial_sequence('transactions','id')), 202, 'C', 5000, 75000);
COMMIT;</pre>
<p>The same works at SERIALIZABLE isolation without explicit locks, but then every caller must retry on SQLSTATE <code>40001</code>. A deferred constraint trigger can assert <code>SUM(debits) = SUM(credits)</code> per transaction at commit time.</p>`,
  scaling: `<ul>
<li><strong>Scale up first</strong>: a single well-tuned PostgreSQL primary on fast NVMe handles thousands of short write transactions per second; banks avoid distributed transactions in the core ledger as long as possible.</li>
<li><strong>CQRS</strong>: statements, analytics and regulatory reports read from replicas or a warehouse fed by CDC; the primary only does postings and balance checks.</li>
<li><strong>Hot accounts</strong> (a merchant/payroll/GL account touched by thousands of transactions per second): post to N sub-accounts and aggregate, or post to the ledger and update the balance cache in batches.</li>
<li>Batch jobs (interest accrual, EOD) run in chunks of a few thousand accounts per transaction to avoid long transactions and replication lag.</li>
</ul>`,
  partitioning: `<ul>
<li><code>ledger_entries</code> and <code>transactions</code>: range by <code>created_at</code>/<code>value_date</code> monthly. The PK becomes <code>(id, created_at)</code>. Statement queries for "last 3 months" prune to 3-4 partitions.</li>
<li>Closed financial years are detached, verified (checksums/hash chain), and moved to cheaper storage; still restorable for audits.</li>
<li>Monthly balance snapshots avoid replaying 10 years of entries for a statement.</li>
</ul>`,
  replication: `<ul>
<li><strong>RPO = 0</strong>: synchronous replication to at least one standby in another AZ (<code>synchronous_standby_names = 'ANY 1 (s1, s2)'</code>, <code>synchronous_commit = on</code> or <code>remote_apply</code> if replicas must serve read-after-write).</li>
<li>DR region: async standby (RPO of seconds), plus WAL archiving and base backups with <span class="tag tool">third-party tool</span> pgBackRest for point-in-time recovery (e.g. to just before an erroneous batch job).</li>
<li>Failover managed by <span class="tag tool">third-party tool</span> Patroni with fencing so two primaries can never accept writes (split brain would corrupt the ledger).</li>
</ul>`,
  sharding: `<p><strong>If sharding becomes unavoidable: shard key account_id (or customer_id).</strong></p>
<ul>
<li>Transfers within a shard stay ACID. Cross-shard transfers become a <strong>saga</strong>: debit A and credit an internal "funds in transit" (suspense) GL account on shard 1, then credit B and debit the suspense account on shard 2; a reconciler guarantees each leg completes or is reversed.</li>
<li>Customer-level sharding keeps all of a customer's accounts together, making most own-account transfers single-shard.</li>
<li>Distributed SQL databases (CockroachDB, YugabyteDB, Spanner) offer cross-shard ACID at higher latency; some newer banks choose them.</li>
</ul>`,
  failures: `<ul>
<li><strong>Timeout after commit</strong>: client retries with the same idempotency key and gets the original result, never a second debit.</li>
<li><strong>Crash mid-transaction</strong>: atomicity rolls everything back; there is no half-transfer.</li>
<li><strong>Interbank payment sent, response lost</strong>: the outgoing payment stays in <code>pending</code> with a debit to a clearing GL account; reconciliation with the clearing house settles or reverses it.</li>
<li><strong>Bad batch job posted wrong interest</strong>: never DELETE; post reversing transactions. PITR is for disasters, not for business corrections.</li>
<li><strong>Daily reconciliation</strong>: cached balance = SUM(ledger) per account, debits = credits per transaction, GL totals = sum of customer balances.</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Cached balance vs computed</strong>: a cached balance makes debit checks O(1) but must be kept in sync in the same transaction; the ledger stays the truth.</li>
<li><strong>Pessimistic locks vs SERIALIZABLE</strong>: explicit <code>FOR UPDATE</code> with ordered locking is predictable; SERIALIZABLE is simpler to reason about but needs retry logic everywhere.</li>
<li><strong>Single primary vs distributed</strong>: one primary is simpler and strongly consistent but has a vertical ceiling; sharding adds sagas, suspense accounts and reconciliation complexity.</li>
<li><strong>numeric vs bigint paise</strong>: numeric is exact and readable; bigint minor units are faster. Never float.</li>
</ul>`
},

/* ------------------------------------------------------------------ PAYMENT SYSTEM */
{
  id: 'payment',
  title: 'Design a payment system database (Stripe/Razorpay-style)',
  requirements: {
    functional: [
      'Merchants create payment intents for an amount; customers pay by card, UPI, netbanking or wallet through external payment service providers (PSPs) and banks.',
      'A payment may need several attempts (card declined, then UPI succeeds); only one may succeed.',
      'Capture, partial and full refunds, chargebacks/disputes.',
      'Merchants receive webhooks for status changes and periodic settlements (payouts) net of fees.',
      'Every API call is idempotent; every money movement is recorded in an internal double-entry ledger and reconciled against PSP/bank reports.'
    ],
    nonFunctional: [
      'Exactly-once money movement under retries, timeouts and duplicate webhooks.',
      'High availability for payment creation (lost availability = lost sales); strong consistency for payment state.',
      'Complete audit trail; PCI-DSS: raw card numbers never stored in the core database (tokenised in a separate vault).',
      'p99 API latency under 300 ms excluding PSP time.'
    ]
  },
  scale: `<ul>
<li>20M payments/day = 230/s average, <strong>3,000-5,000/s at sale-event peaks</strong>; each payment has about 1.3 attempts, 3 status events, 2-4 ledger entries and 1-3 webhooks.</li>
<li>About 3 KB per payment including events, ledger and webhook logs: 60 GB/day, about 22 TB/year (financial records retained 7-10 years).</li>
<li>Idempotency records: one per mutating API call, kept 24-72 hours.</li>
</ul>`,
  entities: [
    { name: 'merchants', desc: 'Accounts with API keys, fee plan and settlement bank account.' },
    { name: 'idempotency_keys', desc: 'Per-merchant key, request fingerprint and stored response.' },
    { name: 'payment_intents', desc: 'The merchant-facing payment object with its state machine.' },
    { name: 'payment_attempts', desc: 'Each try with a PSP: method, PSP reference, outcome.' },
    { name: 'refunds', desc: 'Partial/full refunds against a succeeded payment.' },
    { name: 'ledger_entries', desc: 'Internal double-entry accounting (customer funds, merchant payable, fees, PSP receivable).' },
    { name: 'webhook_deliveries', desc: 'Outgoing notifications to merchants with retry schedule.' },
    { name: 'psp_events', desc: 'Inbound PSP callbacks/webhooks, deduplicated by provider event id.' }
  ],
  relationships: [
    { from: 'payment_intents', to: 'merchants', type: 'N:1', label: 'belongs to' },
    { from: 'payment_attempts', to: 'payment_intents', type: 'N:1', label: 'tries to pay' },
    { from: 'refunds', to: 'payment_intents', type: 'N:1', label: 'refunds' },
    { from: 'ledger_entries', to: 'payment_intents', type: 'N:1', label: 'accounts for' },
    { from: 'webhook_deliveries', to: 'merchants', type: 'N:1', label: 'notifies' },
    { from: 'psp_events', to: 'payment_attempts', type: 'N:1', label: 'updates' }
  ],
  tables: `CREATE TABLE merchants (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  fee_bps     int  NOT NULL DEFAULT 200,            -- 2.00%
  webhook_url text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  merchant_id     bigint NOT NULL REFERENCES merchants(id),
  key             text   NOT NULL,
  request_hash    text   NOT NULL,                  -- same key + different body => 422 error
  response_code   int,
  response_body   jsonb,                            -- NULL while the first request is in flight
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, key)
);

CREATE TABLE payment_intents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   bigint NOT NULL REFERENCES merchants(id),
  amount        bigint NOT NULL CHECK (amount > 0),  -- minor units (paise)
  currency      char(3) NOT NULL,
  status        text NOT NULL DEFAULT 'requires_payment'
                CHECK (status IN ('requires_payment','processing','succeeded','failed','cancelled')),
  amount_refunded bigint NOT NULL DEFAULT 0,
  merchant_order_ref text,
  version       int NOT NULL DEFAULT 0,             -- optimistic concurrency
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_refunded BETWEEN 0 AND amount)
);

CREATE TABLE payment_attempts (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_intent_id  uuid   NOT NULL REFERENCES payment_intents(id),
  method             text   NOT NULL CHECK (method IN ('card','upi','netbanking','wallet')),
  psp                text   NOT NULL,
  psp_reference      text,
  status             text   NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  failure_code       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (psp, psp_reference)
);

CREATE TABLE refunds (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_intent_id  uuid   NOT NULL REFERENCES payment_intents(id),
  amount             bigint NOT NULL CHECK (amount > 0),
  status             text   NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_id         uuid   NOT NULL,                -- groups the balanced lines of one event
  account            text   NOT NULL,                -- 'psp_receivable', 'merchant_payable:42', 'fees_revenue'
  payment_intent_id  uuid   REFERENCES payment_intents(id),
  debit              bigint NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit             bigint NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit = 0) <> (credit = 0))
);

CREATE TABLE psp_events (
  psp            text NOT NULL,
  psp_event_id   text NOT NULL,
  payload        jsonb NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  PRIMARY KEY (psp, psp_event_id)                    -- duplicate webhooks are no-ops
);

CREATE TABLE webhook_deliveries (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id    bigint NOT NULL REFERENCES merchants(id),
  event_type     text   NOT NULL,
  payload        jsonb  NOT NULL,
  attempts       int    NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at   timestamptz
);`,
  indexes: `-- Only ONE successful attempt per payment intent, enforced by the database.
CREATE UNIQUE INDEX uq_attempt_success ON payment_attempts (payment_intent_id) WHERE status = 'succeeded';

CREATE INDEX idx_attempts_intent ON payment_attempts (payment_intent_id);
CREATE INDEX idx_intents_merchant ON payment_intents (merchant_id, created_at DESC);
CREATE INDEX idx_intents_order_ref ON payment_intents (merchant_id, merchant_order_ref);
CREATE INDEX idx_ledger_journal ON ledger_entries (journal_id);
CREATE INDEX idx_ledger_account ON ledger_entries (account, created_at);
CREATE INDEX idx_refunds_intent ON refunds (payment_intent_id);
-- Webhook worker queue: due and undelivered only.
CREATE INDEX idx_webhooks_due ON webhook_deliveries (next_attempt_at) WHERE delivered_at IS NULL;
-- Expire old idempotency keys.
CREATE INDEX idx_idem_created ON idempotency_keys (created_at);`,
  transactions: `<p><strong>1. Idempotent API request</strong> (Stripe-style): claim the key first, do the work, store the response.</p>
<pre>INSERT INTO idempotency_keys (merchant_id, key, request_hash, locked_until)
VALUES (42, 'order-8812-pay', 'sha256-of-body', now() + interval '30 seconds')
ON CONFLICT (merchant_id, key) DO NOTHING
RETURNING key;
-- no row =&gt; SELECT response_body: return it if present, 409 "in progress" if NULL,
--            422 if request_hash differs (same key reused for a different request)</pre>
<p><strong>2. PSP webhook says the attempt succeeded</strong> (may arrive twice, or after the synchronous response already updated the state):</p>
<pre>BEGIN;
INSERT INTO psp_events (psp, psp_event_id, payload)
VALUES ('razorpay', 'evt_9xK2', '{"status":"captured"}')
ON CONFLICT DO NOTHING RETURNING psp_event_id;     -- no row =&gt; duplicate: COMMIT and stop

UPDATE payment_attempts SET status = 'succeeded'
WHERE psp = 'razorpay' AND psp_reference = 'pay_77' AND status = 'pending'
RETURNING payment_intent_id;                      -- uq_attempt_success blocks a 2nd success

UPDATE payment_intents SET status = 'succeeded', version = version + 1
WHERE id = '5f0c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f50' AND status IN ('requires_payment','processing');

-- Balanced journal: 10,000 paise payment, 2% fee.
INSERT INTO ledger_entries (journal_id, account, payment_intent_id, debit, credit) VALUES
 ('a1b2c3d4-0000-4000-8000-000000000001', 'psp_receivable',      '5f0c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f50', 10000, 0),
 ('a1b2c3d4-0000-4000-8000-000000000001', 'merchant_payable:42', '5f0c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f50', 0, 9800),
 ('a1b2c3d4-0000-4000-8000-000000000001', 'fees_revenue',        '5f0c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f50', 0, 200);

INSERT INTO webhook_deliveries (merchant_id, event_type, payload)
VALUES (42, 'payment.succeeded', '{"id":"5f0c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f50"}');
COMMIT;</pre>
<p><strong>Refund</strong>: <code>UPDATE payment_intents SET amount_refunded = amount_refunded + 3000 WHERE id = ... AND status = 'succeeded' AND amount_refunded + 3000 &lt;= amount</code>: the guarded update makes over-refunding impossible even with concurrent refund requests.</p>`,
  scaling: `<ul>
<li><strong>Never call the PSP inside a database transaction</strong>: record the attempt as <code>pending</code>, commit, call the PSP, then update in a new transaction. Long transactions holding row locks for seconds kill throughput.</li>
<li><strong>Webhook delivery workers</strong> pull due rows with <code>SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100</code>, so many workers share the queue without blocking each other.</li>
<li>Read replicas for the merchant dashboard and reporting; a warehouse (CDC) for settlement analytics and fraud models.</li>
<li>Pool connections (<span class="tag tool">third-party tool</span> PgBouncer); keep transactions to a few milliseconds.</li>
</ul>`,
  partitioning: `<ul>
<li><code>payment_intents</code>, <code>payment_attempts</code>, <code>ledger_entries</code>: range by <code>created_at</code> (monthly). With UUIDv7 ids (core <code>uuidv7()</code> in PostgreSQL 18) the id itself is time-ordered, which also helps index locality.</li>
<li><code>idempotency_keys</code> and <code>psp_events</code>: daily partitions dropped after 3-30 days instead of mass DELETE.</li>
<li><code>webhook_deliveries</code>: daily partitions; delivered rows age out.</li>
</ul>`,
  replication: `<ul>
<li>Synchronous standby per shard (RPO 0) because a lost "succeeded" state means a merchant ships goods without a record of payment.</li>
<li>Cross-region async replica + PITR backups; regular restore drills.</li>
<li>CDC (logical decoding) to an event bus feeds ledger reconciliation, fraud scoring and merchant analytics.</li>
</ul>`,
  sharding: `<p><strong>Shard key: merchant_id</strong> (payment ids encode or map to the merchant shard).</p>
<ul>
<li>All API calls are authenticated per merchant, so routing is trivial and every payment lifecycle (intent, attempts, refunds, webhooks, idempotency keys) is single-shard ACID.</li>
<li>Very large merchants (a marketplace doing 30% of volume) can be split by merchant_id + sub-key or given dedicated shards.</li>
<li>The platform-wide ledger view (total PSP receivable) is aggregated asynchronously across shards.</li>
</ul>`,
  failures: `<ul>
<li><strong>PSP timeout (unknown outcome)</strong>: leave the attempt <code>pending</code>; never assume failure and retry blindly with a new PSP call. Query the PSP status API or wait for the webhook; reconciliation catches leftovers.</li>
<li><strong>Duplicate or out-of-order webhooks</strong>: deduped by <code>(psp, psp_event_id)</code>; state transitions are guarded (<code>WHERE status IN (...)</code>), so a late "failed" cannot overwrite "succeeded".</li>
<li><strong>Merchant endpoint down</strong>: exponential backoff on webhook_deliveries for up to 3 days; merchants can also poll.</li>
<li><strong>Daily reconciliation</strong>: match PSP settlement files line by line with succeeded attempts; mismatches raise incidents (missing capture, unexpected refund, fee differences).</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Synchronous vs asynchronous confirmation</strong>: UPI/netbanking are inherently async (redirects, callbacks); the state machine must treat "processing" as a normal long-lived state.</li>
<li><strong>Internal ledger</strong> adds writes but turns "where is the money?" into a query and makes reconciliation possible; status columns alone are not accounting.</li>
<li><strong>Bigint minor units</strong> vs numeric: exact and fast, but every currency needs its exponent (JPY has 0 decimals, KWD has 3).</li>
<li><strong>Idempotency storage</strong> costs one extra write per request but is non-negotiable for money APIs.</li>
</ul>`
},

/* ------------------------------------------------------------------ TICKET BOOKING */
{
  id: 'ticket-booking',
  title: 'Design a ticket booking system (BookMyShow/Ticketmaster) without double booking',
  requirements: {
    functional: [
      'Browse events (movies, concerts, matches) by city/date and see a live seat map.',
      'Select specific seats; they are held for the user for ~10 minutes while they pay.',
      'On successful payment the hold becomes a confirmed booking with e-tickets; on timeout or failure the seats are released.',
      'General-admission (standing) categories sell a fixed number of tickets with no seat numbers.',
      'Cancellations and refunds per event policy.'
    ],
    nonFunctional: [
      'A seat can NEVER be sold twice, even when thousands of users click the same seat in the same second.',
      'Flash sales (a cricket final or a big concert): 1M+ users arrive at on-sale time for 50k seats.',
      'Seat map reads may be a second or two stale; the hold/confirm path must be strongly consistent.',
      'Fairness: first successful hold wins; no inventory leaks from abandoned carts.'
    ]
  },
  scale: `<ul>
<li>Normal: 10M bookings/month = about 4 bookings/s average, 100/s at evening peaks.</li>
<li>Flash sale: 1M users in the first minute, 200k hold attempts/s on 50k seats of ONE event: extreme contention on a tiny data set (the hard part is concurrency, not volume).</li>
<li>event_seats rows: 5,000 shows/day x 300 seats = 1.5M rows/day (small); seat map reads: 50k/s at peaks (cached).</li>
</ul>`,
  entities: [
    { name: 'venues / seats', desc: 'Physical layout: section, row, number, seat category.' },
    { name: 'events', desc: 'A show at a venue and time, with on-sale time and status.' },
    { name: 'price_categories', desc: 'Price per category per event (Gold, Platinum, GA).' },
    { name: 'event_seats', desc: 'Inventory: one row per (event, seat) with status available / held / booked, hold owner and expiry.' },
    { name: 'ga_inventory', desc: 'Counter-based inventory for unnumbered categories.' },
    { name: 'bookings / booking_seats', desc: 'Confirmed purchases; booking_seats has UNIQUE (event_id, seat_id) as the final guard.' },
    { name: 'payments', desc: 'Payment attempts for a hold/booking.' }
  ],
  relationships: [
    { from: 'seats', to: 'venues', type: 'N:1', label: 'located in' },
    { from: 'events', to: 'venues', type: 'N:1', label: 'held at' },
    { from: 'event_seats', to: 'events', type: 'N:1', label: 'inventory of' },
    { from: 'event_seats', to: 'seats', type: 'N:1', label: 'for seat' },
    { from: 'bookings', to: 'events', type: 'N:1', label: 'for' },
    { from: 'booking_seats', to: 'bookings', type: 'N:1', label: 'part of' },
    { from: 'payments', to: 'bookings', type: 'N:1', label: 'pays' }
  ],
  tables: `CREATE TABLE venues (
  id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL,
  city  text NOT NULL
);

CREATE TABLE seats (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venue_id  int  NOT NULL REFERENCES venues(id),
  section   text NOT NULL,
  row_label text NOT NULL,
  seat_no   int  NOT NULL,
  category  text NOT NULL,
  UNIQUE (venue_id, section, row_label, seat_no)
);

CREATE TABLE events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venue_id    int  NOT NULL REFERENCES venues(id),
  title       text NOT NULL,
  starts_at   timestamptz NOT NULL,
  on_sale_at  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','on_sale','sold_out','cancelled','finished'))
);

CREATE TABLE price_categories (
  event_id  bigint NOT NULL REFERENCES events(id),
  category  text   NOT NULL,
  price     numeric(10,2) NOT NULL,
  PRIMARY KEY (event_id, category)
);

CREATE TABLE event_seats (
  event_id         bigint NOT NULL REFERENCES events(id),
  seat_id          bigint NOT NULL REFERENCES seats(id),
  status           text   NOT NULL DEFAULT 'available' CHECK (status IN ('available','held','booked')),
  hold_token       uuid,
  hold_expires_at  timestamptz,
  booking_id       bigint,
  PRIMARY KEY (event_id, seat_id),
  CHECK ((status = 'held') = (hold_token IS NOT NULL AND hold_expires_at IS NOT NULL)),
  CHECK ((status = 'booked') = (booking_id IS NOT NULL))
) WITH (fillfactor = 80);   -- frequent status updates: leave room for HOT updates

CREATE TABLE ga_inventory (
  event_id  bigint NOT NULL REFERENCES events(id),
  category  text   NOT NULL,
  capacity  int    NOT NULL CHECK (capacity >= 0),
  sold      int    NOT NULL DEFAULT 0,
  held      int    NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, category),
  CHECK (sold >= 0 AND held >= 0 AND sold + held <= capacity)   -- cannot oversell
);

CREATE TABLE bookings (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id),
  user_id     bigint NOT NULL,
  hold_token  uuid   NOT NULL UNIQUE,         -- one booking per hold (idempotent confirm)
  amount      numeric(10,2) NOT NULL,
  status      text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','refunded')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Belt and braces: even a buggy code path cannot attach the same seat to two bookings.
CREATE TABLE booking_seats (
  booking_id  bigint NOT NULL REFERENCES bookings(id),
  event_id    bigint NOT NULL,
  seat_id     bigint NOT NULL,
  PRIMARY KEY (booking_id, seat_id),
  UNIQUE (event_id, seat_id)
);

CREATE TABLE payments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hold_token  uuid   NOT NULL,
  amount      numeric(10,2) NOT NULL,
  status      text   NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  psp_ref     text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);`,
  indexes: `-- Seat map for an event: PK (event_id, seat_id) already serves it.
-- Expiry sweeper: only held seats, by expiry.
CREATE INDEX idx_event_seats_hold_exp ON event_seats (hold_expires_at) WHERE status = 'held';
-- Confirm/release by hold token.
CREATE INDEX idx_event_seats_token ON event_seats (hold_token) WHERE hold_token IS NOT NULL;
-- Browse: events in a city by date (join venues) and on-sale lists.
CREATE INDEX idx_events_venue_time ON events (venue_id, starts_at);
CREATE INDEX idx_bookings_user ON bookings (user_id, created_at DESC);
CREATE INDEX idx_payments_hold ON payments (hold_token);`,
  transactions: `<p><strong>Hold seats</strong>: one atomic, conditional UPDATE. Whoever's UPDATE reaches a row first wins; later transactions wait for the row lock, re-check the WHERE clause against the committed new version, and skip the row.</p>
<pre>BEGIN;
UPDATE event_seats
SET status = 'held',
    hold_token = '3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
    hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 77
  AND seat_id IN (1201, 1202, 1203)
  AND (status = 'available' OR (status = 'held' AND hold_expires_at &lt; now()))
RETURNING seat_id;
-- application: if fewer than 3 rows came back =&gt; ROLLBACK ("some seats were just taken")
COMMIT;</pre>
<p><strong>Confirm after payment</strong> (idempotent through UNIQUE hold_token on bookings):</p>
<pre>BEGIN;
INSERT INTO bookings (event_id, user_id, hold_token, amount)
VALUES (77, 5001, '3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a', 2400.00)
ON CONFLICT (hold_token) DO NOTHING
RETURNING id;                                    -- say 9001; no row =&gt; already confirmed

UPDATE event_seats SET status = 'booked', booking_id = 9001,
       hold_token = NULL, hold_expires_at = NULL
WHERE event_id = 77 AND hold_token = '3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a' AND status = 'held'
RETURNING seat_id;
-- fewer rows than held =&gt; the hold expired and was re-sold: ROLLBACK and refund the payment

INSERT INTO booking_seats (booking_id, event_id, seat_id)
SELECT 9001, 77, unnest(ARRAY[1201, 1202, 1203]::bigint[]);
COMMIT;</pre>
<p><strong>General admission</strong>: <code>UPDATE ga_inventory SET held = held + 2 WHERE event_id = 77 AND category = 'GA' AND sold + held + 2 &lt;= capacity</code>. "Any 2 seats in Gold" can use <code>SELECT ... FOR UPDATE SKIP LOCKED LIMIT 2</code> so concurrent buyers grab different free seats instead of queueing on the same rows.</p>`,
  scaling: `<ul>
<li><strong>Virtual waiting room</strong> in front of flash sales: admit users at the rate the hold path can sustain (a few thousand per second); the database never sees 1M simultaneous clicks.</li>
<li><strong>Seat maps from cache</strong>: publish status changes (via outbox/CDC) to a cache or websocket fan-out; seat map reads never hit the primary. Staleness is fine because the hold UPDATE is the real check.</li>
<li><strong>Short transactions</strong>: no payment calls inside a transaction; holds are committed immediately, payment happens outside, confirm is a second short transaction.</li>
<li>Read replicas for browsing, search and "my bookings".</li>
</ul>`,
  partitioning: `<ul>
<li><code>event_seats</code>: list/range partition by event date (e.g. weekly). Past events' partitions are detached/archived; the active set stays small and cached.</li>
<li><code>bookings</code> and <code>payments</code>: range by <code>created_at</code> for retention and reporting.</li>
</ul>`,
  replication: `<ul>
<li>Synchronous standby for the booking primary (a confirmed booking must survive failover).</li>
<li>Async replicas for browsing/seat maps; any decision ("is this seat free?") shown from a replica is advisory only.</li>
</ul>`,
  sharding: `<p><strong>Shard key: event_id.</strong></p>
<ul>
<li>All contention for a show is on its own seats; holds and confirms for one event are single-shard transactions, which is what makes "never double book" a simple local guarantee.</li>
<li>A mega-event can be placed on a dedicated shard ahead of on-sale; the rest of the platform is unaffected.</li>
<li>User-centric views ("my bookings") are a secondary, user-keyed read model built from booking events.</li>
</ul>`,
  failures: `<ul>
<li><strong>User abandons checkout</strong>: hold expires; seats become available implicitly (the WHERE clause treats expired holds as free) and a sweeper cleans them up for accurate seat maps.</li>
<li><strong>Payment succeeds after the hold expired</strong> and the seat was resold: confirm detects it (fewer rows updated) and triggers an automatic refund. Hold expiry should be longer than the PSP timeout to make this rare.</li>
<li><strong>Double submit of confirm</strong>: UNIQUE hold_token on bookings makes it idempotent.</li>
<li><strong>Primary failover during sale</strong>: holds created in the last moments may be lost with async replication; with synchronous replication they survive. Clients re-read hold status after reconnect.</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Conditional UPDATE vs SELECT ... FOR UPDATE then UPDATE</strong>: the single statement is shorter and avoids a read-then-write window; FOR UPDATE is needed when logic between read and write is complex.</li>
<li><strong>SKIP LOCKED</strong> maximises throughput for "any seat" allocation but is unfair for specific seat requests; use it only where any free item is acceptable.</li>
<li><strong>Row per seat vs counter</strong>: rows give seat maps and per-seat guarantees; counters are faster for GA but cannot assign numbered seats.</li>
<li><strong>Optimistic (version column) vs pessimistic</strong>: under extreme contention optimistic retries waste work; a conditional UPDATE is effectively an optimistic check executed atomically by the database.</li>
</ul>`
},

/* ------------------------------------------------------------------ HOTEL BOOKING */
{
  id: 'hotel-booking',
  title: 'Design a hotel booking system database (Booking.com/MakeMyTrip-style)',
  requirements: {
    functional: [
      'Search hotels by city and dates; show room types with availability and price for every night of the stay.',
      'Reserve N rooms of a room type for a date range (check-in to check-out); pay now or at hotel.',
      'Hotels manage inventory and nightly rates per room type; a controlled overbooking percentage may be allowed.',
      'At check-in, a specific physical room is assigned; a room can never be assigned to two overlapping stays.',
      'Modify or cancel reservations according to cancellation policies.'
    ],
    nonFunctional: [
      'No overselling of a room type on any night (beyond the configured overbooking limit).',
      'Search is extremely read-heavy (look-to-book about 1000:1) and may be slightly stale; reservations must be strongly consistent.',
      'Integration with channel managers (the same inventory is sold on several sites) needs idempotent, ordered updates.'
    ]
  },
  scale: `<ul>
<li>1M hotels x 5 room types x 365 nights = <strong>1.8B inventory rows</strong> per year of availability (about 60 bytes each plus index: roughly 200 GB).</li>
<li>Searches: 50k/s at peak (cached/precomputed); reservations: 1M/day = about 12/s average, 200/s peak.</li>
<li>A 3-night reservation updates 3 inventory rows; hot hotels on long weekends see heavy contention on the same few rows.</li>
</ul>`,
  entities: [
    { name: 'hotels', desc: 'Property with city, star rating, timezone.' },
    { name: 'room_types', desc: 'Deluxe, Suite, etc. per hotel with max occupancy.' },
    { name: 'rooms', desc: 'Physical rooms (number, floor) of a room type.' },
    { name: 'room_inventory', desc: 'One row per (room type, night): total, booked, rate, overbooking allowance.' },
    { name: 'reservations', desc: 'Guest booking for a room type, quantity and date range (daterange).' },
    { name: 'room_assignments', desc: 'Physical room per reservation; an exclusion constraint forbids overlapping stays in one room.' }
  ],
  relationships: [
    { from: 'room_types', to: 'hotels', type: 'N:1', label: 'offered by' },
    { from: 'rooms', to: 'room_types', type: 'N:1', label: 'is a' },
    { from: 'room_inventory', to: 'room_types', type: 'N:1', label: 'nightly stock of' },
    { from: 'reservations', to: 'room_types', type: 'N:1', label: 'books' },
    { from: 'room_assignments', to: 'reservations', type: 'N:1', label: 'fulfils' },
    { from: 'room_assignments', to: 'rooms', type: 'N:1', label: 'occupies' }
  ],
  tables: `CREATE EXTENSION IF NOT EXISTS btree_gist;   -- extension: lets GiST combine "=" on room_id with "&&" on ranges

CREATE TABLE hotels (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name      text NOT NULL,
  city      text NOT NULL,
  stars     smallint CHECK (stars BETWEEN 1 AND 5),
  timezone  text NOT NULL DEFAULT 'Asia/Kolkata'
);

CREATE TABLE room_types (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hotel_id      bigint NOT NULL REFERENCES hotels(id),
  name          text   NOT NULL,
  max_guests    smallint NOT NULL,
  UNIQUE (hotel_id, name)
);

CREATE TABLE rooms (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_type_id  bigint NOT NULL REFERENCES room_types(id),
  room_no       text   NOT NULL,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE room_inventory (
  room_type_id   bigint NOT NULL REFERENCES room_types(id),
  night          date   NOT NULL,
  total_rooms    int    NOT NULL CHECK (total_rooms >= 0),
  overbook_pct   int    NOT NULL DEFAULT 0 CHECK (overbook_pct BETWEEN 0 AND 20),
  booked         int    NOT NULL DEFAULT 0 CHECK (booked >= 0),
  rate           numeric(10,2) NOT NULL,
  PRIMARY KEY (room_type_id, night),
  CHECK (booked <= total_rooms + (total_rooms * overbook_pct) / 100)   -- never oversell
);

CREATE TABLE reservations (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_type_id      bigint NOT NULL REFERENCES room_types(id),
  guest_name        text   NOT NULL,
  rooms_qty         int    NOT NULL CHECK (rooms_qty > 0),
  check_in          date   NOT NULL,
  check_out         date   NOT NULL,
  stay              daterange GENERATED ALWAYS AS (daterange(check_in, check_out, '[)')) STORED,
  status            text   NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','checked_in','checked_out','no_show')),
  total_amount      numeric(12,2) NOT NULL,
  idempotency_key   text   NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);

CREATE TABLE room_assignments (
  reservation_id  bigint NOT NULL REFERENCES reservations(id),
  room_id         bigint NOT NULL REFERENCES rooms(id),
  stay            daterange NOT NULL,
  PRIMARY KEY (reservation_id, room_id),
  -- The core guarantee: one physical room, no overlapping stays. '[)' ranges let
  -- one guest check out on the 23rd and the next check in on the 23rd.
  EXCLUDE USING gist (room_id WITH =, stay WITH &&)
);`,
  indexes: `-- Search: availability of all room types of hotels in a city for a date range.
CREATE INDEX idx_room_types_hotel ON room_types (hotel_id);
CREATE INDEX idx_hotels_city ON hotels (city);
-- room_inventory PK (room_type_id, night) serves the per-stay range read and the reservation UPDATE.
CREATE INDEX idx_rooms_type ON rooms (room_type_id) WHERE is_active;
-- Arrivals list for the front desk and overlap queries for a room type.
CREATE INDEX idx_reservations_arrival ON reservations (room_type_id, check_in) WHERE status = 'confirmed';
CREATE INDEX idx_reservations_stay ON reservations USING gist (stay);`,
  transactions: `<p><strong>Reserve 1 Deluxe room for 20-23 Dec (3 nights)</strong>: every night must have capacity; partial success is not allowed.</p>
<pre>BEGIN;
-- 1. Lock the nights in a fixed order (by date) so overlapping stays cannot deadlock.
SELECT night FROM room_inventory
WHERE room_type_id = 12 AND night &gt;= DATE '2025-12-20' AND night &lt; DATE '2025-12-23'
ORDER BY night
FOR UPDATE;

-- 2. Guarded increment; expect exactly 3 rows (one per night).
UPDATE room_inventory
SET booked = booked + 1
WHERE room_type_id = 12
  AND night &gt;= DATE '2025-12-20' AND night &lt; DATE '2025-12-23'
  AND booked + 1 &lt;= total_rooms + (total_rooms * overbook_pct) / 100
RETURNING night, rate;
-- application: fewer than 3 rows =&gt; some night is full =&gt; ROLLBACK

INSERT INTO reservations (room_type_id, guest_name, rooms_qty, check_in, check_out, total_amount, idempotency_key)
VALUES (12, 'Ravi Kumar', 1, '2025-12-20', '2025-12-23', 25500.00, 'web-5b1e9c');
COMMIT;</pre>
<p><strong>Assign a physical room at check-in</strong>: <code>INSERT INTO room_assignments (reservation_id, room_id, stay) VALUES (555, 1207, '[2025-12-20,2025-12-23)');</code> fails with an exclusion-constraint violation (SQLSTATE <code>23P01</code>) if room 1207 is occupied on any of those nights, even under concurrency, because the GiST exclusion check is enforced like a unique index.</p>`,
  scaling: `<ul>
<li><strong>Search path separated from booking path</strong>: availability and lowest-price per hotel per date are precomputed into a search index/cache (updated from inventory changes via CDC). The relational DB is consulted only for the final quote and reservation.</li>
<li><strong>Read replicas</strong> for hotel details, reviews and "my trips".</li>
<li><strong>Channel manager sync</strong>: inbound rate/inventory updates are applied with idempotency keys and a version per (room_type, night) to reject out-of-order messages.</li>
</ul>`,
  partitioning: `<ul>
<li><code>room_inventory</code>: range-partition by <code>night</code> (monthly). Past nights are read-only history; the next 12-18 months are the hot set. Dropping or archiving past months is instant.</li>
<li><code>reservations</code>: range by <code>check_in</code> (or <code>created_at</code>) for operational queries and retention.</li>
<li>Note: exclusion constraints on a partitioned table must include the partition key with equality, so <code>room_assignments</code> is usually left unpartitioned (it is small) or partitioned by hotel.</li>
</ul>`,
  replication: `<ul>
<li>Synchronous standby for the reservation primary; async replicas for search feeds and reporting.</li>
<li>Show availability from replicas/caches, but always re-check on the primary inside the reservation transaction.</li>
</ul>`,
  sharding: `<p><strong>Shard key: hotel_id.</strong></p>
<ul>
<li>A reservation touches one hotel's room types and nights: single-shard ACID, including the exclusion constraint.</li>
<li>Search across a city fans out to a search index, not to shards.</li>
<li>Large chains do not break this: each property is independent inventory.</li>
</ul>`,
  failures: `<ul>
<li><strong>Payment fails after reserving</strong>: reservation stays <code>pending</code> with a short TTL (or is created only after payment authorisation); a sweeper releases inventory (<code>booked = booked - 1</code> for each night) for expired pending reservations.</li>
<li><strong>Duplicate submit</strong>: UNIQUE idempotency_key.</li>
<li><strong>Channel overbooking</strong> (another site sold the last room before sync): the overbooking allowance absorbs small races; beyond it, the hotel relocates the guest; that is a business process, which is why the DB enforces the hard limit.</li>
<li><strong>Cancellation</strong>: decrement inventory for the same nights in the same transaction that sets <code>status = 'cancelled'</code>.</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Counter per night vs room-level ranges</strong>: counters make availability search cheap (sum per night) and allow late room assignment (hotels prefer this); room-level exclusion constraints give exact per-room guarantees. Using both is common: counters for selling, exclusion for assignment.</li>
<li><strong>Half-open ranges</strong> <code>[check_in, check_out)</code> model hotel nights correctly; closed ranges would make back-to-back stays overlap.</li>
<li><strong>Allowing overbooking</strong> increases revenue (no-shows) at the cost of occasional relocations; it is a parameter, not a bug.</li>
</ul>`
},

/* ------------------------------------------------------------------ JIRA */
{
  id: 'jira',
  title: 'Design a project management system database (Jira)',
  requirements: {
    functional: [
      'Multi-tenant: organisations (sites) have projects with short keys (PLAT); issues get human keys PLAT-1, PLAT-2 ... without gaps caused by concurrency bugs.',
      'Issues have type (epic, story, task, bug, sub-task), status, priority, assignee, reporter, labels, story points, parent and arbitrary custom fields per project.',
      'Configurable workflows: only allowed status transitions (To Do to In Progress to In Review to Done) are permitted.',
      'Sprints/boards, comments, watchers, links between issues (blocks, duplicates, relates to).',
      'Full change history per issue; powerful filtering (JQL-like) and text search.'
    ],
    nonFunctional: [
      'Strict tenant isolation; large tenants (100k users, 10M issues) next to tiny ones.',
      'Board and issue views p95 under 300 ms; filters over millions of issues in a tenant should return in about 1 s.',
      'Strong consistency for issue updates (no lost updates when two people edit the same issue).'
    ]
  },
  scale: `<ul>
<li>200k tenants, 1B issues total; largest tenant 10M issues.</li>
<li>Writes: 50M issue updates/day (status changes, edits, comments) = <strong>600 writes/s</strong>, peaks 3k/s during working hours across time zones.</li>
<li>Reads: boards, issue views and filters about 20x writes = 12k-60k reads/s.</li>
<li>History grows fastest: about 5 history rows per update = 250M rows/day across all tenants.</li>
</ul>`,
  entities: [
    { name: 'organizations', desc: 'Tenants (sites).' },
    { name: 'projects', desc: 'Project key, workflow, and the issue counter next_issue_no.' },
    { name: 'workflows / statuses / workflow_transitions', desc: 'Allowed state machine per project.' },
    { name: 'issues', desc: 'Core work item: type, status, assignee, parent, sprint, custom_fields JSONB, labels array, search tsvector.' },
    { name: 'sprints', desc: 'Time-boxed iterations on a board.' },
    { name: 'comments', desc: 'Discussion on an issue.' },
    { name: 'issue_links', desc: 'Typed directed links between issues.' },
    { name: 'issue_history', desc: 'Append-only field change log (who changed what, from, to, when).' }
  ],
  relationships: [
    { from: 'projects', to: 'organizations', type: 'N:1', label: 'belongs to' },
    { from: 'issues', to: 'projects', type: 'N:1', label: 'in' },
    { from: 'issues', to: 'issues', type: 'N:1', label: 'child of (epic/sub-task)' },
    { from: 'issues', to: 'statuses', type: 'N:1', label: 'currently in' },
    { from: 'issues', to: 'sprints', type: 'N:1', label: 'planned in' },
    { from: 'workflow_transitions', to: 'statuses', type: 'N:1', label: 'from / to' },
    { from: 'comments', to: 'issues', type: 'N:1', label: 'on' },
    { from: 'issue_links', to: 'issues', type: 'N:1', label: 'source / target' },
    { from: 'issue_history', to: 'issues', type: 'N:1', label: 'changes of' }
  ],
  tables: `CREATE TABLE organizations (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL,
  slug  text NOT NULL UNIQUE
);

CREATE TABLE workflows (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id  bigint NOT NULL REFERENCES organizations(id),
  name    text NOT NULL
);

CREATE TABLE statuses (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id  bigint NOT NULL REFERENCES workflows(id),
  name         text NOT NULL,
  category     text NOT NULL CHECK (category IN ('todo','in_progress','done')),
  UNIQUE (workflow_id, name)
);

CREATE TABLE workflow_transitions (
  workflow_id     bigint NOT NULL REFERENCES workflows(id),
  from_status_id  bigint NOT NULL REFERENCES statuses(id),
  to_status_id    bigint NOT NULL REFERENCES statuses(id),
  name            text   NOT NULL,              -- "Start progress", "Resolve"
  PRIMARY KEY (workflow_id, from_status_id, to_status_id)
);

CREATE TABLE projects (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         bigint NOT NULL REFERENCES organizations(id),
  key            text   NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name           text   NOT NULL,
  workflow_id    bigint NOT NULL REFERENCES workflows(id),
  next_issue_no  int    NOT NULL DEFAULT 1,     -- gapless per-project counter
  UNIQUE (org_id, key)
);

CREATE TABLE sprints (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id),
  name        text NOT NULL,
  starts_on   date, ends_on date,
  state       text NOT NULL DEFAULT 'future' CHECK (state IN ('future','active','closed'))
);

CREATE TABLE issues (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         bigint NOT NULL REFERENCES organizations(id),   -- denormalised for tenant filtering / sharding
  project_id     bigint NOT NULL REFERENCES projects(id),
  issue_no       int    NOT NULL,                                -- PLAT-123 => 123
  issue_type     text   NOT NULL CHECK (issue_type IN ('epic','story','task','bug','subtask')),
  summary        text   NOT NULL,
  description    text,
  status_id      bigint NOT NULL REFERENCES statuses(id),
  priority       smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  assignee_id    bigint,
  reporter_id    bigint NOT NULL,
  parent_id      bigint REFERENCES issues(id),
  sprint_id      bigint REFERENCES sprints(id),
  story_points   numeric(4,1),
  labels         text[] NOT NULL DEFAULT '{}',
  custom_fields  jsonb  NOT NULL DEFAULT '{}'::jsonb,            -- per-project field schema
  rank           text   NOT NULL DEFAULT 'm',                    -- lexicographic rank for drag-and-drop ordering
  version        int    NOT NULL DEFAULT 1,                      -- optimistic locking
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  search         tsvector GENERATED ALWAYS AS (
                   setweight(to_tsvector('english', coalesce(summary, '')), 'A') ||
                   setweight(to_tsvector('english', coalesce(description, '')), 'B')) STORED,
  UNIQUE (project_id, issue_no)
);

CREATE TABLE comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_id    bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_id   bigint NOT NULL,
  body        text   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issue_links (
  source_id  bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  target_id  bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  link_type  text   NOT NULL CHECK (link_type IN ('blocks','duplicates','relates_to','clones')),
  PRIMARY KEY (source_id, target_id, link_type),
  CHECK (source_id <> target_id)
);

CREATE TABLE issue_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_id    bigint NOT NULL,
  actor_id    bigint NOT NULL,
  field       text   NOT NULL,
  old_value   text,
  new_value   text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);`,
  indexes: `-- Board: issues of a sprint by column (status) in rank order.
CREATE INDEX idx_issues_sprint_board ON issues (sprint_id, status_id, rank);
-- "Assigned to me" across projects of a tenant, unresolved first.
CREATE INDEX idx_issues_assignee ON issues (org_id, assignee_id, updated_at DESC);
-- Backlog per project, epics' children.
CREATE INDEX idx_issues_project_updated ON issues (project_id, updated_at DESC);
CREATE INDEX idx_issues_parent ON issues (parent_id) WHERE parent_id IS NOT NULL;
-- JQL-ish filters: labels = 'x', custom field containment, free text.
CREATE INDEX idx_issues_labels ON issues USING gin (labels);
CREATE INDEX idx_issues_custom ON issues USING gin (custom_fields jsonb_path_ops);
CREATE INDEX idx_issues_search ON issues USING gin (search);
-- History and comments of one issue in time order; reverse link lookups.
CREATE INDEX idx_history_issue ON issue_history (issue_id, changed_at);
CREATE INDEX idx_comments_issue ON comments (issue_id, created_at);
CREATE INDEX idx_links_target ON issue_links (target_id);`,
  transactions: `<p><strong>Create issue with a gapless, race-free key.</strong> A sequence would be faster but can leave gaps and is global; the per-project counter row gives PLAT-124 exactly once.</p>
<pre>BEGIN;
WITH n AS (
  UPDATE projects SET next_issue_no = next_issue_no + 1
  WHERE id = 7
  RETURNING org_id, id AS project_id, next_issue_no - 1 AS issue_no, workflow_id
)
INSERT INTO issues (org_id, project_id, issue_no, issue_type, summary, status_id, reporter_id)
SELECT n.org_id, n.project_id, n.issue_no, 'bug', 'Login fails with SSO', s.id, 301
FROM n
JOIN LATERAL (SELECT id FROM statuses WHERE workflow_id = n.workflow_id AND category = 'todo'
              ORDER BY id LIMIT 1) s ON true
RETURNING issue_no;     -- display as PLAT-124
COMMIT;</pre>
<p><strong>Transition with workflow validation, optimistic locking and history</strong>:</p>
<pre>BEGIN;
UPDATE issues i
SET status_id = 42, version = version + 1, updated_at = now()
FROM projects p
WHERE i.id = 9001 AND p.id = i.project_id
  AND i.version = 17                                  -- the version the user's screen loaded
  AND EXISTS (SELECT 1 FROM workflow_transitions t
              WHERE t.workflow_id = p.workflow_id
                AND t.from_status_id = i.status_id AND t.to_status_id = 42)
RETURNING i.id;
-- 0 rows =&gt; either someone else edited it (reload) or the transition is not allowed

INSERT INTO issue_history (issue_id, actor_id, field, old_value, new_value)
VALUES (9001, 301, 'status', 'In Progress', 'In Review');
COMMIT;</pre>
<p>The counter UPDATE serialises issue creation per project (one row lock), which is fine: even busy projects create a few issues per second.</p>`,
  scaling: `<ul>
<li><strong>Tenant-aware everything</strong>: every query carries <code>org_id</code>; every index on tenant data starts with a tenant-scoped column; RLS policies or a mandatory query layer enforce isolation.</li>
<li><strong>Search and complex filters</strong> (JQL across many fields, sorting by any column) are offloaded to a search engine (Atlassian uses one) fed by CDC; PostgreSQL GIN indexes serve simpler filters and smaller tenants.</li>
<li><strong>Read replicas</strong> for boards, dashboards and reports; writes and the issue detail view after an edit go to the primary.</li>
<li><strong>Caching</strong> of workflow/field configuration (rarely changes, read on every request).</li>
</ul>`,
  partitioning: `<ul>
<li><code>issue_history</code> and audit/activity: range by <code>changed_at</code> monthly; drop or archive by retention policy per plan.</li>
<li><code>issues</code>: hash by <code>org_id</code> within a shard if the table grows to billions of rows; queries always include org_id, so they prune to one partition.</li>
</ul>`,
  replication: `<ul>
<li>Primary + synchronous standby per shard, async replicas for reporting.</li>
<li>Per-tenant data residency (EU/US/IN) is handled by placing a tenant's shard in the right region, not by replicating everything everywhere.</li>
</ul>`,
  sharding: `<p><strong>Shard key: org_id (tenant).</strong></p>
<ul>
<li>All joins (issues, projects, workflows, comments, links) stay within a tenant, so they are single-shard. This is the classic multi-tenant SaaS pattern (Citus calls it tenant-based distribution).</li>
<li>Small tenants are packed many per shard; whale tenants get dedicated shards; a tenant directory maps org to shard and supports moving tenants (logical replication of one tenant's rows, then cut over).</li>
<li>Cross-tenant features are rare (global admin, billing) and use aggregated, asynchronously built data.</li>
</ul>`,
  failures: `<ul>
<li><strong>Concurrent edits</strong>: optimistic version check prevents lost updates; the UI shows "this issue was updated, reload".</li>
<li><strong>Invalid transitions</strong> from stale UIs or API scripts are rejected by the EXISTS check, not just hidden buttons.</li>
<li><strong>Bulk edits</strong> (move 10,000 issues to a new sprint): run as background jobs in batches of a few hundred rows per transaction to avoid long locks and replica lag.</li>
<li><strong>Search index lag</strong>: newly created issues may take a second to appear in filters; the creator sees it immediately from the primary.</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>JSONB custom fields vs EAV vs columns</strong>: JSONB keeps one row per issue and supports GIN containment; EAV (issue_id, field_id, value) is flexible but join-heavy; real columns are fastest but cannot be per-project. JSONB plus a field-definition table is the pragmatic middle.</li>
<li><strong>Gapless counter vs sequence</strong>: the counter row serialises creation per project but gives human-friendly keys; sequences scale better but have gaps.</li>
<li><strong>Lexicographic rank strings</strong> (LexoRank-style) allow drag-and-drop reordering by updating one row instead of renumbering a whole backlog.</li>
<li><strong>History as rows vs JSON diffs</strong>: one row per changed field is easy to query ("who changed priority?"); JSON diffs are more compact.</li>
</ul>`
},

/* ------------------------------------------------------------------ DOCUMENT MANAGEMENT (Drive-scale) */
{
  id: 'document-management',
  title: 'Design a document management / cloud drive database (Google Drive/Dropbox-style)',
  requirements: {
    functional: [
      'Users upload, download, rename, move and delete files and folders; trash with restore for 30 days.',
      'Large files upload in resumable chunks; identical content is stored once (deduplication).',
      'Every save creates a version; users can restore older versions.',
      'Share files/folders with users, groups or by link with viewer/commenter/editor roles; folder sharing is inherited.',
      'Desktop/mobile clients sync changes incrementally ("give me everything that changed since cursor X").',
      'Per-user storage quotas.'
    ],
    nonFunctional: [
      'Metadata operations (list folder, rename, share) p99 under 200 ms; strongly consistent within a user\'s namespace.',
      'File bytes are durable (11 nines) in object storage; metadata is the system of record and must never point at missing bytes.',
      'Hundreds of millions of users, tens of billions of files; quota can never be exceeded through concurrent uploads.'
    ]
  },
  scale: `<ul>
<li>500M users x 2,000 files = <strong>1 trillion file-version metadata rows</strong> over time; about 300 bytes each = roughly 300 TB of metadata (hence sharding).</li>
<li>Uploads: 2B files/day = 23k/s; metadata reads (listing, sync polling) 10-50x that.</li>
<li>Bytes: average 2 MB x 2B/day = 4 PB/day before dedup, all in object storage (block-level dedup can save 30-50% in practice).</li>
</ul>`,
  entities: [
    { name: 'accounts / quotas', desc: 'Users and their storage limit and used bytes.' },
    { name: 'nodes', desc: 'Files AND folders in one tree table (parent_id), with name, kind, size, current version, trash state.' },
    { name: 'file_versions', desc: 'Immutable versions of a file pointing at a content blob.' },
    { name: 'blobs', desc: 'Content-addressed storage objects (SHA-256) with a reference count.' },
    { name: 'upload_sessions', desc: 'Resumable chunked uploads in progress.' },
    { name: 'shares', desc: 'Role grants on a node to a user, group or anyone-with-link.' },
    { name: 'change_journal', desc: 'Per-namespace, monotonically increasing change log for client sync cursors.' }
  ],
  relationships: [
    { from: 'nodes', to: 'nodes', type: 'N:1', label: 'inside folder' },
    { from: 'nodes', to: 'accounts', type: 'N:1', label: 'owned by' },
    { from: 'file_versions', to: 'nodes', type: 'N:1', label: 'version of' },
    { from: 'file_versions', to: 'blobs', type: 'N:1', label: 'content' },
    { from: 'shares', to: 'nodes', type: 'N:1', label: 'grants access to' },
    { from: 'upload_sessions', to: 'nodes', type: 'N:1', label: 'uploads into' },
    { from: 'change_journal', to: 'nodes', type: 'N:1', label: 'records change of' }
  ],
  tables: `CREATE TABLE accounts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        text NOT NULL UNIQUE,
  quota_bytes  bigint NOT NULL DEFAULT 16106127360,   -- 15 GiB
  used_bytes   bigint NOT NULL DEFAULT 0,
  CHECK (used_bytes BETWEEN 0 AND quota_bytes)        -- the quota invariant
);

CREATE TABLE blobs (
  sha256      bytea  PRIMARY KEY CHECK (octet_length(sha256) = 32),
  size_bytes  bigint NOT NULL,
  ref_count   bigint NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
  storage_key text   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nodes (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id            bigint NOT NULL REFERENCES accounts(id),
  parent_id           bigint REFERENCES nodes(id),          -- NULL = root of "My Drive"
  kind                text   NOT NULL CHECK (kind IN ('file','folder')),
  name                text   NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  mime_type           text,
  size_bytes          bigint NOT NULL DEFAULT 0,
  current_version_id  bigint,
  trashed_at          timestamptz,
  modified_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'file' OR current_version_id IS NULL)
);

CREATE TABLE file_versions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id     bigint NOT NULL REFERENCES nodes(id),
  version_no  int    NOT NULL,
  blob_sha256 bytea  NOT NULL REFERENCES blobs(sha256),
  size_bytes  bigint NOT NULL,
  created_by  bigint NOT NULL REFERENCES accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, version_no)
);

CREATE TABLE upload_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      bigint NOT NULL REFERENCES accounts(id),
  parent_id       bigint NOT NULL REFERENCES nodes(id),
  file_name       text   NOT NULL,
  total_bytes     bigint NOT NULL,
  received_bytes  bigint NOT NULL DEFAULT 0,
  chunk_hashes    bytea[] NOT NULL DEFAULT '{}',     -- per-chunk SHA-256 for resume/dedup
  expires_at      timestamptz NOT NULL,
  CHECK (received_bytes <= total_bytes)
);

CREATE TABLE shares (
  node_id      bigint NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  grantee_type text   NOT NULL CHECK (grantee_type IN ('user','group','link')),
  grantee_id   bigint NOT NULL DEFAULT 0,             -- 0 for link shares
  role         text   NOT NULL CHECK (role IN ('viewer','commenter','editor','owner')),
  link_token   text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, grantee_type, grantee_id)
);

-- Sync feed: clients store the last seq they processed and ask for seq > cursor.
CREATE TABLE change_journal (
  namespace_id  bigint NOT NULL,                     -- owner account (or shared drive)
  seq           bigint NOT NULL,
  node_id       bigint NOT NULL,
  change_type   text   NOT NULL CHECK (change_type IN ('create','update','move','rename','trash','restore','delete')),
  changed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace_id, seq)
);`,
  indexes: `-- Folder listing: live children of a folder, by name; and name uniqueness among live siblings.
CREATE UNIQUE INDEX uq_nodes_sibling_name ON nodes (owner_id, parent_id, lower(name))
  WHERE trashed_at IS NULL;
CREATE INDEX idx_nodes_parent ON nodes (parent_id, kind, name) WHERE trashed_at IS NULL;
-- "Recent" view and trash purge job.
CREATE INDEX idx_nodes_owner_recent ON nodes (owner_id, modified_at DESC) WHERE trashed_at IS NULL;
CREATE INDEX idx_nodes_trash ON nodes (trashed_at) WHERE trashed_at IS NOT NULL;
-- "Shared with me": all grants to a user.
CREATE INDEX idx_shares_grantee ON shares (grantee_type, grantee_id);
-- Version history and blob GC.
CREATE INDEX idx_versions_blob ON file_versions (blob_sha256);
CREATE INDEX idx_blobs_unreferenced ON blobs (created_at) WHERE ref_count = 0;
CREATE INDEX idx_upload_expiry ON upload_sessions (expires_at);`,
  transactions: `<p><strong>Commit a finished upload</strong>: the bytes are already in object storage; now atomically charge quota, register the blob, create the version and update the file node, and append to the sync journal.</p>
<pre>BEGIN;
-- 1. Quota: guarded increment; the CHECK constraint is the backstop.
UPDATE accounts SET used_bytes = used_bytes + 5242880
WHERE id = 10 AND used_bytes + 5242880 &lt;= quota_bytes
RETURNING used_bytes;                          -- 0 rows =&gt; over quota: ROLLBACK, delete the object

-- 2. Content-addressed blob with reference counting (dedup across users).
INSERT INTO blobs (sha256, size_bytes, ref_count, storage_key)
VALUES (sha256('file-bytes'::bytea), 5242880, 1, 'blobs/ab/cd/abcd...')
ON CONFLICT (sha256) DO UPDATE SET ref_count = blobs.ref_count + 1;

-- 3. New version (lock the node row so version numbers are sequential).
SELECT id FROM nodes WHERE id = 555 FOR UPDATE;
INSERT INTO file_versions (node_id, version_no, blob_sha256, size_bytes, created_by)
SELECT 555, COALESCE(MAX(version_no), 0) + 1, sha256('file-bytes'::bytea), 5242880, 10
FROM file_versions WHERE node_id = 555;

UPDATE nodes SET current_version_id = currval(pg_get_serial_sequence('file_versions','id')),
                 size_bytes = 5242880, modified_at = now()
WHERE id = 555;

-- 4. Sync journal: per-namespace sequence via a counter row or advisory lock.
INSERT INTO change_journal (namespace_id, seq, node_id, change_type)
SELECT 10, COALESCE(MAX(seq), 0) + 1, 555, 'update' FROM change_journal WHERE namespace_id = 10;
COMMIT;</pre>
<p>Order of operations across systems: upload bytes to object storage FIRST, commit metadata SECOND. A crash in between leaves an orphan object (cleaned up by GC), never metadata pointing to missing bytes. The journal MAX+1 is safe here only because the account row is already locked by step 1, serialising writers in this namespace.</p>`,
  scaling: `<ul>
<li><strong>Metadata vs bytes</strong>: PostgreSQL (or a sharded metadata store) holds metadata only; bytes go directly from client to object storage via pre-signed URLs, and downloads come from a CDN.</li>
<li><strong>Sync is the dominant read load</strong>: clients long-poll "changes since cursor"; the change_journal PK makes that an index range scan per namespace. Notifications (push) tell clients when to poll.</li>
<li><strong>Folder listings</strong> of huge folders (100k files) use keyset pagination on (parent_id, name).</li>
<li><strong>Permission checks</strong>: cache effective permissions per (user, top shared folder); inheritance is resolved by walking up the parent chain, which is short (depth rarely beyond 20) and cached.</li>
</ul>`,
  partitioning: `<ul>
<li><code>change_journal</code>: range by time (daily/weekly); clients with cursors older than retention perform a full re-sync. Dropping old partitions keeps it small.</li>
<li><code>file_versions</code>: hash by <code>node_id</code> within a shard; old versions beyond the plan's history limit are pruned by background jobs that also decrement blob ref counts.</li>
<li><code>nodes</code>: hash by <code>owner_id</code> within a shard if a shard's table becomes unwieldy.</li>
</ul>`,
  replication: `<ul>
<li>Synchronous standby per metadata shard; async replicas for search indexing and analytics.</li>
<li>Object storage is replicated by the storage system itself (multi-AZ / multi-region); the DB stores the hash, so integrity can be verified end to end.</li>
</ul>`,
  sharding: `<p><strong>Shard key: namespace (owner account / shared drive id).</strong></p>
<ul>
<li>A user's tree, versions, quota and sync journal live on one shard: moves, renames, uploads and quota checks are single-shard ACID. Dropbox publicly describes a namespace-sharded metadata layer for the same reason.</li>
<li>Sharing across namespaces stores the grant in the owner's shard plus a "shared with me" reference in the recipient's shard (built asynchronously).</li>
<li>Blobs (dedup) are keyed by hash in a separate global, hash-sharded store; cross-namespace dedup is therefore a cross-shard reference counted asynchronously (garbage collection must be conservative: delete only after a grace period with ref_count 0).</li>
</ul>`,
  failures: `<ul>
<li><strong>Interrupted upload</strong>: the upload_session keeps received chunk hashes; the client resumes from the last confirmed chunk. Expired sessions are cleaned up with their partial objects.</li>
<li><strong>Concurrent edits from two devices</strong>: both commit as sequential versions; clients detect that their base version is not the current one and create a "conflicted copy" instead of silently overwriting.</li>
<li><strong>Move creating a cycle</strong> (moving a folder into its own descendant): check ancestry inside the move transaction with a recursive CTE while holding locks on the involved folders.</li>
<li><strong>Blob GC race</strong> (a new upload references a blob being deleted): GC only deletes blobs whose ref_count has been 0 for longer than the maximum upload duration, re-checking under lock.</li>
</ul>`,
  tradeoffs: `<ul>
<li><strong>Single nodes table for files and folders</strong> simplifies moves and listings; separate tables give stricter typing.</li>
<li><strong>Content-addressed dedup</strong> saves storage but complicates deletion (reference counting, GC) and has privacy considerations (cross-user dedup can leak "this file exists"); many systems dedup only within a user/tenant.</li>
<li><strong>Change journal vs timestamps</strong>: "modified since T" polling misses changes with clock skew or same-timestamp commits; a per-namespace sequence gives exact, gap-free cursors.</li>
<li><strong>Adjacency list vs materialised path</strong>: parent_id makes moves O(1); materialised paths make subtree queries and permission inheritance cheap but moves rewrite every descendant.</li>
</ul>`
}
];
